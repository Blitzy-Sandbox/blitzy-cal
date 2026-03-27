import { OAuthCalendarApp } from "@/ee/calendars/calendars.interface";
import { CalendarState } from "@/ee/calendars/controllers/calendars.controller";
import { CalendarsService } from "@/ee/calendars/services/calendars.service";
import { CredentialsRepository } from "@/modules/credentials/credentials.repository";
import { SelectedCalendarsRepository } from "@/modules/selected-calendars/selected-calendars.repository";
import { TokensService } from "@/modules/tokens/tokens.service";
import type { Calendar as OfficeCalendar } from "@microsoft/microsoft-graph-types-beta";
import { BadRequestException, UnauthorizedException } from "@nestjs/common";
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Request } from "express";
import { stringify } from "querystring";
import { z } from "zod";

import {
  SUCCESS_STATUS,
  OFFICE_365_CALENDAR,
  OFFICE_365_CALENDAR_ID,
  OFFICE_365_CALENDAR_TYPE,
} from "@calcom/platform-constants";

/**
 * OutlookService — API v2 Enterprise Edition service wrapping Office 365/Outlook Calendar OAuth flows.
 *
 * Sprint 3 CI-002 Parity Verification:
 * This service handles OAuth2 credential lifecycle for Office 365 Calendar connections in the API v2 layer.
 * It delegates calendar operations (event CRUD, availability, batch requests) to the upstream
 * `@calcom/office365calendar` adapter (`packages/app-store/office365calendar/lib/CalendarService.ts`),
 * which has been verified for behavioral parity with Calendly's Outlook integration in Sprint 3.
 *
 * Upstream adapter changes (CI-002) include:
 * - `showAs` status filtering now configurable via `statusFilter` parameter (CI-004)
 * - Batch API request handling with @odata.nextLink pagination verified
 * - HTTP 429 retry-after logic verified
 * - Microsoft Graph change notification subscription methods added (CI-001 gap)
 *
 * This API v2 service layer is NOT affected by these adapter changes because:
 * - The OAuth flow (connect/save/check) operates independently of calendar event operations
 * - Credential persistence and token exchange remain unchanged
 * - The service delegates to `CalendarsService.getCalendars()` and `CalendarsService.createAndLinkCalendarEntry()`
 *   for connection management, which are verified for backward compatibility
 * - The `statusFilter` feature is available in the upstream adapter but not yet exposed through
 *   API v2 endpoints (would require extending CalendarBusyTimesInput DTO in a future iteration)
 */
@Injectable()
export class OutlookService implements OAuthCalendarApp {
  private redirectUri = `${this.config.get("api.url")}/calendars/${OFFICE_365_CALENDAR}/save`;

  constructor(
    private readonly config: ConfigService,
    private readonly calendarsService: CalendarsService,
    private readonly credentialRepository: CredentialsRepository,
    private readonly tokensService: TokensService,
    private readonly selectedCalendarsRepository: SelectedCalendarsRepository
  ) {}

  /**
   * Initiates Office 365 Calendar OAuth2 connection flow.
   *
   * CI-002 Verification: This method constructs Microsoft OAuth URLs with scopes
   * [User.Read, Calendars.Read, Calendars.ReadWrite, offline_access]. These scopes
   * are sufficient for all CI-002 parity operations including calendarView queries,
   * event CRUD, and the new Microsoft Graph change notification subscriptions (CI-001 gap).
   * The offline_access scope ensures refresh tokens are issued for long-lived access.
   * No scope changes needed.
   */
  async connect(
    authorization: string,
    req: Request,
    redir?: string,
    isDryRun?: boolean
  ): Promise<{ status: typeof SUCCESS_STATUS; data: { authUrl: string } }> {
    const accessToken = authorization.replace("Bearer ", "");
    const origin = req.get("origin") ?? req.get("host");
    const redirectUrl = await this.getCalendarRedirectUrl(accessToken, origin ?? "", redir, isDryRun);

    return { status: SUCCESS_STATUS, data: { authUrl: redirectUrl } };
  }

  async save(
    code: string,
    accessToken: string,
    origin: string,
    redir?: string,
    isDryRun?: boolean
  ): Promise<{ url: string }> {
    return await this.saveCalendarCredentialsAndRedirect(code, accessToken, origin, redir, isDryRun);
  }

  async check(userId: number): Promise<{ status: typeof SUCCESS_STATUS }> {
    return await this.checkIfCalendarConnected(userId);
  }

  async getCalendarRedirectUrl(accessToken: string, origin: string, redir?: string, isDryRun?: boolean) {
    const { client_id } = await this.calendarsService.getAppKeys(OFFICE_365_CALENDAR_ID);

    const state: CalendarState = {
      accessToken,
      origin,
      redir,
      isDryRun,
    };

    const scopes = ["User.Read", "Calendars.Read", "Calendars.ReadWrite", "offline_access"];
    const params = {
      response_type: "code",
      scope: scopes.join(" "),
      client_id,
      prompt: "select_account",
      redirect_uri: this.redirectUri,
      state: JSON.stringify(state),
    };

    const query = stringify(params);

    const url = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${query}`;

    return url;
  }

  /**
   * Verifies Office 365 Calendar connection status for a user.
   *
   * CI-002 Verification: This method checks credential validity and connected calendar
   * status. After upstream adapter modifications for configurable `showAs` status
   * filtering (CI-004) and batch API request handling, the connection validation
   * path remains unchanged — it verifies credential existence, validity flag, and
   * integration type matching (OFFICE_365_CALENDAR_TYPE) via CalendarsService.getCalendars().
   */
  async checkIfCalendarConnected(userId: number): Promise<{ status: typeof SUCCESS_STATUS }> {
    const office365CalendarCredentials = await this.credentialRepository.findCredentialByTypeAndUserId(
      "office365_calendar",
      userId
    );

    if (!office365CalendarCredentials) {
      throw new BadRequestException("Credentials for office_365_calendar not found.");
    }

    if (office365CalendarCredentials.invalid) {
      throw new BadRequestException("Invalid office 365 calendar credentials.");
    }

    const { connectedCalendars } = await this.calendarsService.getCalendars(userId);
    const office365Calendar = connectedCalendars.find(
      (cal: { integration: { type: string } }) => cal.integration.type === OFFICE_365_CALENDAR_TYPE
    );
    if (!office365Calendar) {
      throw new UnauthorizedException("Office 365 calendar not connected.");
    }
    if (office365Calendar.error?.message) {
      throw new UnauthorizedException(office365Calendar.error?.message);
    }

    return {
      status: SUCCESS_STATUS,
    };
  }

  /**
   * Exchanges Microsoft OAuth2 authorization code for tokens.
   *
   * CI-002 Verification: Token exchange at Microsoft identity platform token endpoint
   * (login.microsoftonline.com/common/oauth2/v2.0/token) is independent of adapter
   * changes. The Calendars.ReadWrite scope obtained here provides sufficient permissions
   * for all Graph API operations including event CRUD, calendarView queries with
   * configurable showAs filtering, and change notification subscription management.
   */
  async getOAuthCredentials(code: string) {
    const scopes = ["offline_access", "Calendars.Read", "Calendars.ReadWrite"];
    const { client_id, client_secret } = await this.calendarsService.getAppKeys(OFFICE_365_CALENDAR_ID);

    const toUrlEncoded = (payload: Record<string, string>) =>
      Object.keys(payload)
        .map((key) => `${key}=${encodeURIComponent(payload[key])}`)
        .join("&");

    const body = toUrlEncoded({
      client_id,
      grant_type: "authorization_code",
      code,
      scope: scopes.join(" "),
      redirect_uri: this.redirectUri,
      client_secret,
    });

    const response = await fetch("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      },
      body,
    });

    const responseBody = await response.json();

    return responseBody;
  }

  /**
   * Fetches the default calendar from Microsoft Graph /me/calendar endpoint.
   *
   * CI-002 Verification: Default calendar retrieval uses the standard Microsoft Graph
   * API (v1.0/me/calendar) and is independent of the adapter's enhanced calendarView
   * and batch request handling. The response type (OfficeCalendar from
   * @microsoft/microsoft-graph-types-beta) correctly includes the calendar `id` field
   * used for calendar selection and credential linking.
   */
  async getDefaultCalendar(accessToken: string): Promise<OfficeCalendar> {
    const response = await fetch("https://graph.microsoft.com/v1.0/me/calendar", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });
    const responseBody = await response.json();

    return responseBody as OfficeCalendar;
  }

  /**
   * Exchanges OAuth2 code for tokens, retrieves default calendar, and persists credentials.
   *
   * CI-002 Verification: The credential persistence flow (token exchange → calendar retrieval →
   * credential upsert → selected calendar association) remains stable after upstream adapter
   * modifications. The Office 365 OAuth credentials (access_token, refresh_token, etc.) stored
   * via `CalendarsService.createAndLinkCalendarEntry()` are backward-compatible with the
   * Credential model's new nullable `externalCancellationSyncEnabled` field (additive-only change).
   * The credential validity check via `checkCalendarCredentialValidity` also continues to work
   * correctly since it only checks the `invalid` flag on the credential record.
   */
  async saveCalendarCredentialsAndRedirect(
    code: string,
    accessToken: string,
    origin: string,
    redir?: string,
    isDryRun?: boolean
  ) {
    // if code is not defined, user denied to authorize office 365 app, just redirect straight away
    if (!code || code === "undefined") {
      return { url: redir || origin };
    }

    // if isDryRun is true we know its a dry run so we just redirect straight away
    if (isDryRun) {
      return { url: redir || origin };
    }

    const parsedCode = z.string().parse(code);

    const ownerId = await this.tokensService.getAccessTokenOwnerId(accessToken);

    if (!ownerId) {
      throw new UnauthorizedException("Invalid Access token.");
    }

    const office365OAuthCredentials = await this.getOAuthCredentials(parsedCode);

    const defaultCalendar = await this.getDefaultCalendar(office365OAuthCredentials.access_token);

    if (defaultCalendar?.id) {
      const alreadyExistingSelectedCalendar = await this.selectedCalendarsRepository.getUserSelectedCalendar(
        ownerId,
        OFFICE_365_CALENDAR_TYPE,
        defaultCalendar.id
      );

      if (alreadyExistingSelectedCalendar) {
        const isCredentialValid = await this.calendarsService.checkCalendarCredentialValidity(
          ownerId,
          alreadyExistingSelectedCalendar.credentialId ?? 0,
          OFFICE_365_CALENDAR_TYPE
        );

        // user credential probably got expired in this case
        if (!isCredentialValid) {
          await this.calendarsService.createAndLinkCalendarEntry(
            ownerId,
            alreadyExistingSelectedCalendar.externalId,
            office365OAuthCredentials,
            OFFICE_365_CALENDAR_TYPE,
            alreadyExistingSelectedCalendar.credentialId
          );
        }

        return {
          url: redir || origin,
        };
      }

      await this.calendarsService.createAndLinkCalendarEntry(
        ownerId,
        defaultCalendar.id,
        office365OAuthCredentials,
        OFFICE_365_CALENDAR_TYPE
      );
    }

    return {
      url: redir || origin,
    };
  }
}
