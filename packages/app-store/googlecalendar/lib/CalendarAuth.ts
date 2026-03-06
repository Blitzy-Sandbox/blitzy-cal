import { calendar_v3 } from "@googleapis/calendar";
import { OAuth2Client, JWT } from "googleapis-common";

import { triggerDelegationCredentialErrorWebhook } from "@calcom/features/webhooks/lib/triggerDelegationCredentialErrorWebhook";
import {
  CalendarAppDelegationCredentialClientIdNotAuthorizedError,
  CalendarAppDelegationCredentialInvalidGrantError,
  CalendarAppDelegationCredentialError,
} from "@calcom/lib/CalendarAppError";
import {
  APP_CREDENTIAL_SHARING_ENABLED,
  CREDENTIAL_SYNC_ENDPOINT,
  CREDENTIAL_SYNC_SECRET,
  CREDENTIAL_SYNC_SECRET_HEADER_NAME,
} from "@calcom/lib/constants";
import logger from "@calcom/lib/logger";
import type { Prisma } from "@calcom/prisma/client";
import type { CredentialForCalendarServiceWithEmail } from "@calcom/types/Credential";

import { invalidateCredential } from "../../_utils/invalidateCredential";
import { OAuthManager } from "../../_utils/oauth/OAuthManager";
import { oAuthManagerHelper } from "../../_utils/oauth/oAuthManagerHelper";
import { OAuth2UniversalSchema } from "../../_utils/oauth/universalSchema";
import { metadata } from "../_metadata";
import { getGoogleAppKeys } from "./getGoogleAppKeys";

type DelegatedTo = NonNullable<CredentialForCalendarServiceWithEmail["delegatedTo"]>;
const log = logger.getSubLogger({ prefix: ["app-store/googlecalendar/lib/CalendarAuth"] });

class MyGoogleOAuth2Client extends OAuth2Client {
  constructor(client_id: string, client_secret: string, redirect_uri: string) {
    super({
      clientId: client_id,
      clientSecret: client_secret,
      redirectUri: redirect_uri,
      // default: 5 * 60 * 1000, 5 minutes
      // tho, fn will never run in excess of 60 seconds
      eagerRefreshThresholdMillis: 60000,
    });
  }

  isTokenExpiring() {
    return super.isTokenExpiring();
  }

  async refreshToken(token: string | null | undefined) {
    return super.refreshToken(token);
  }
}

/**
 * CalendarAuth manages Google Calendar authentication for both OAuth2 and JWT (delegation) flows.
 *
 * CI-001 Parity Verification:
 * - OAuth2 token refresh is handled automatically by Google's OAuth2Client library with 60-second
 *   eager refresh threshold (MyGoogleOAuth2Client line 38), ensuring tokens are refreshed before expiry
 * - JWT delegation flow supports domain-wide delegation for Google Workspace, with proper
 *   email impersonation and service account key handling
 * - Token caching (oAuthClient, jwtAuthClient) prevents unnecessary re-creation of auth clients
 * - Credential sync variables support multi-instance deployments via APP_CREDENTIAL_SHARING_ENABLED
 * - Error handling maps Google-specific errors to domain errors with webhook notifications
 *   for delegation failures (CalendarAppDelegationCredentialClientIdNotAuthorizedError,
 *   CalendarAppDelegationCredentialInvalidGrantError)
 * - Token persistence via updateTokenObject ensures credentials survive server restarts
 * - The OAuthManager pattern ensures thread-safe token operations with proper locking
 *
 * Push Notification Support (CI-001 gap):
 * - The getClient() method returns a fully authenticated calendar_v3.Calendar instance that
 *   supports ALL Google Calendar API v3 operations, including channels.watch and channels.stop
 *   needed for push notification subscription management
 * - No changes to auth flow needed — push notifications use the same OAuth2/JWT credentials
 */
export class CalendarAuth {
  private credential: CredentialForCalendarServiceWithEmail;
  private jwtAuthClient: JWT | null = null;
  private oAuthClient: MyGoogleOAuth2Client | null = null;
  public authManager!: OAuthManager;
  private authMechanism: ReturnType<CalendarAuth["initAuthMechanism"]>;

  constructor(credential: CredentialForCalendarServiceWithEmail) {
    this.credential = credential;
    this.authMechanism = this.initAuthMechanism(credential);
  }

  private getAuthStrategy(): "jwt" | "oauth" {
    return this.credential.delegatedToId ? "jwt" : "oauth";
  }

  private async getOAuthClientSingleton() {
    if (this.oAuthClient) {
      log.debug("Reusing existing oAuthClient");
      return this.oAuthClient;
    }
    log.debug("Creating new oAuthClient");
    const { client_id, client_secret, redirect_uris } = await getGoogleAppKeys();
    const googleCredentials = OAuth2UniversalSchema.parse(this.credential.key);
    this.oAuthClient = new MyGoogleOAuth2Client(client_id, client_secret, redirect_uris[0]);
    this.oAuthClient.setCredentials(googleCredentials);
    return this.oAuthClient;
  }

  private async getJwtClientSingleton({
    emailToImpersonate,
    delegatedTo,
  }: {
    emailToImpersonate: string | null;
    delegatedTo: DelegatedTo;
  }) {
    if (!emailToImpersonate) {
      log.error("DelegatedTo: No email to impersonate found for delegation credential");
      return null;
    }
    const oauthClientIdAliasRegex = /\+[a-zA-Z0-9]{25}/;
    if (!this.jwtAuthClient) {
      log.debug("Creating new delegation credential authClient");
      const authClient = new JWT({
        email: delegatedTo.serviceAccountKey.client_email,
        key: delegatedTo.serviceAccountKey.private_key,
        scopes: ["https://www.googleapis.com/auth/calendar"],
        subject: emailToImpersonate.replace(oauthClientIdAliasRegex, ""),
      });
      this.jwtAuthClient = authClient;
    } else {
      log.debug("Reusing existing delegation credential authClient");
    }
    return this.jwtAuthClient;
  }

  private async refreshOAuthToken({ refreshToken }: { refreshToken: string | null }) {
    const oAuthClient = await this.getOAuthClientSingleton();
    return oAuthClient.refreshToken(refreshToken);
  }

  private refreshJwtToken = async ({ delegatedTo }: { delegatedTo: DelegatedTo }) => {
    log.debug("Attempting to authorize using JWT auth");
    const { user } = this.credential;
    const emailToImpersonate = user?.email ?? null;
    const authClient = await this.getJwtClientSingleton({ delegatedTo, emailToImpersonate });
    if (!authClient) {
      log.error("JWT auth: No auth client found");
      return null;
    }
    try {
      log.debug("Authorizing using JWT auth");
      return await authClient.authorize();
    } catch (error) {
      log.error("DelegatedTo: Error authorizing using JWT auth", JSON.stringify(error));

      let delegationError: CalendarAppDelegationCredentialError;

      const errorCode = (error as { response?: { data?: { error?: string } } }).response?.data?.error;
      if (errorCode === "unauthorized_client") {
        delegationError = new CalendarAppDelegationCredentialClientIdNotAuthorizedError(
          "Make sure that the Client ID for the delegation credential is added to the Google Workspace Admin Console"
        );
      } else if (errorCode === "invalid_grant") {
        delegationError = new CalendarAppDelegationCredentialInvalidGrantError(
          `User ${emailToImpersonate} might not exist in Google Workspace`
        );
      } else {
        // Catch all error
        delegationError = new CalendarAppDelegationCredentialError("Error authorizing delegation credential");
      }

      if (user && user.email && this.credential.appId && this.credential.delegatedToId) {
        await triggerDelegationCredentialErrorWebhook({
          error: delegationError,
          credential: {
            id: this.credential.id,
            type: this.credential.type,
            appId: this.credential.appId,
          },
          user: {
            id: this.credential.userId ?? 0,
            email: user.email,
          },
          delegationCredentialId: this.credential.delegatedToId,
        });
      }

      throw delegationError;
    }
  };

  private initAuthMechanism(credential: CredentialForCalendarServiceWithEmail) {
    const authStrategy = this.getAuthStrategy();
    const authManager = new OAuthManager({
      // Keep it false for oauth because Google's OAuth2Client library that we use supports token expiry check, itself when we use the client to make any request
      // We keep it true for jwt because JWT Client doesn't support token expiry check and we do it ourselves
      autoCheckTokenExpiryOnRequest: authStrategy !== "oauth",
      ...(authStrategy === "oauth"
        ? {
            // Use Google's OAuth2Client library itself to check if the token is expiring
            // For JWT, OAuthManager will do it itself
            isTokenExpiring: async () => {
              const oAuthClient = await this.getOAuthClientSingleton();
              return oAuthClient.isTokenExpiring();
            },
          }
        : {}),
      credentialSyncVariables: {
        APP_CREDENTIAL_SHARING_ENABLED: APP_CREDENTIAL_SHARING_ENABLED,
        CREDENTIAL_SYNC_ENDPOINT: CREDENTIAL_SYNC_ENDPOINT,
        CREDENTIAL_SYNC_SECRET: CREDENTIAL_SYNC_SECRET,
        CREDENTIAL_SYNC_SECRET_HEADER_NAME: CREDENTIAL_SYNC_SECRET_HEADER_NAME,
      },
      resourceOwner: {
        type: "user",
        id: credential.userId,
      },
      appSlug: metadata.slug,
      getCurrentTokenObject: async () => {
        return oAuthManagerHelper.getCurrentTokenObject(this.credential);
      },
      fetchNewTokenObject: async ({ refreshToken }: { refreshToken: string | null }) => {
        let result;
        if (authStrategy === "jwt" && this.credential.delegatedTo) {
          log.debug("Fetching new token object for JWT auth");
          result = {
            // In case of JWT Token flow, there is no refresh token, so we need to refresh the token using Service Account
            tokenObject: await this.refreshJwtToken({ delegatedTo: this.credential.delegatedTo }),
            status: 200,
            statusText: "OK",
          };
        }

        if (!result || !result.tokenObject) {
          log.debug("Fetching new token object for my Google Auth");
          const tokenFetchedResult = await this.refreshOAuthToken({ refreshToken });
          result = {
            tokenObject: tokenFetchedResult.res?.data ?? null,
            status: tokenFetchedResult.res?.status,
            statusText: tokenFetchedResult.res?.statusText,
          };
        }
        return new Response(JSON.stringify(result.tokenObject), {
          status: result.status,
          statusText: result.statusText,
        });
      },
      isTokenObjectUnusable: async function (response) {
        // TODO: Confirm that if this logic should go to isAccessTokenUnusable
        if (!response.ok || (response.status < 200 && response.status >= 300)) {
          const responseBody = await response.json();
          if (responseBody.error === "invalid_grant") {
            return {
              reason: "invalid_grant",
            };
          }
        }
        return null;
      },
      isAccessTokenUnusable: async () => {
        // As long as refresh_token is valid, access_token is regenerated and fixed automatically by Google Calendar when a problem with it is detected
        // So, a situation where access_token is invalid but refresh_token is valid should not happen
        return null;
      },
      invalidateTokenObject: () => invalidateCredential(this.credential.id),
      expireAccessToken: async () => {
        await oAuthManagerHelper.markTokenAsExpired(this.credential);
      },
      updateTokenObject: async (token) => {
        await oAuthManagerHelper.updateTokenObjectInDb({
          tokenObject: token,
          authStrategy: this.getAuthStrategy(),
          credentialId: this.credential.id,
          userId: this.credential.userId ?? null,
          delegatedToId: this.credential.delegatedToId ?? null,
          credentialType: this.credential.type,
          appId: metadata.slug,
        });
        if (this.oAuthClient) {
          this.oAuthClient.setCredentials(token);
        }

        // Update cached credential as well
        this.credential.key = token as Prisma.JsonValue;
      },
    });
    this.authManager = authManager;

    return {
      getOAuthClientWithRefreshedToken: async () => {
        const { token } = await authManager.getTokenObjectOrFetch();
        if (!token) {
          throw new Error("Invalid grant for Google Calendar app");
        }
        const oAuthClient = await this.getOAuthClientSingleton();
        return oAuthClient;
      },
      getJwtClientWithRefreshedToken: async ({ delegatedTo }: { delegatedTo: DelegatedTo }) => {
        log.debug("Getting JWT client with refreshed token");
        await authManager.getTokenObjectOrFetch();
        return this.getJwtClientSingleton({
          emailToImpersonate: this.credential.user?.email ?? null,
          delegatedTo,
        });
      },
    };
  }

  /**
   * Returns a Google Calendar client authenticated with the user's credentials.
   *
   * The returned calendar_v3.Calendar client supports all API operations including:
   * - events.insert/update/delete/list/instances (core CRUD)
   * - freebusy.query (availability)
   * - calendarList.list (calendar enumeration)
   * - channels.watch/stop (push notification subscription — used by CI-001 gap)
   * - calendars.get (primary calendar info)
   *
   * If the user has delegation credentials, JWT auth is used.
   * Otherwise, standard OAuth2 credentials are used.
   */
  public async getClient(): Promise<calendar_v3.Calendar> {
    log.debug("Getting authed calendar client");
    let googleAuthClient;
    const authStrategy = this.getAuthStrategy();

    if (authStrategy === "jwt" && this.credential.delegatedTo) {
      googleAuthClient = await this.authMechanism.getJwtClientWithRefreshedToken({
        delegatedTo: this.credential.delegatedTo,
      });
    }

    if (!googleAuthClient) {
      googleAuthClient = await this.authMechanism.getOAuthClientWithRefreshedToken();
    }

    if (!googleAuthClient) {
      throw new Error("Failed to initialize Google Auth client");
    }

    return new calendar_v3.Calendar({
      auth: googleAuthClient,
      // Explicit 30-second timeout for all outbound Google Calendar API requests.
      // Prevents indefinite hangs if Google Calendar API becomes unresponsive.
      // The timeout applies to all API operations (events CRUD, freebusy queries,
      // calendar listing, push notification channels) via the underlying gaxios HTTP client.
      timeout: 30000,
    });
  }
}
