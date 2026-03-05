import { z } from "zod";

import getParsedAppKeysFromSlug from "../../_utils/getParsedAppKeysFromSlug";

/**
 * Zod schema for Google Calendar OAuth2 app credentials.
 *
 * CI-001 gap Verification:
 * These credentials (client_id, client_secret, redirect_uris) are sufficient for ALL
 * Google Calendar API v3 operations including push notification channels (channels.watch/stop).
 * Push notifications use the same OAuth2 credentials as event CRUD and FreeBusy queries —
 * no additional API keys or configuration needed.
 *
 * The credentials are used by CalendarAuth to create OAuth2Client instances that authenticate
 * all API calls including the new subscribeToChanges/unsubscribeFromChanges methods.
 */
const googleAppKeysSchema = z.object({
  client_id: z.string(),
  client_secret: z.string(),
  redirect_uris: z.array(z.string()),
});

/**
 * Retrieves validated Google Calendar OAuth2 app credentials from the app store.
 * Delegates to getParsedAppKeysFromSlug which fetches from the database App model
 * for the "google-calendar" slug and validates against googleAppKeysSchema.
 *
 * Used by CalendarAuth for both OAuth2 client creation and JWT delegation setup.
 */
export const getGoogleAppKeys = async () => {
  return getParsedAppKeysFromSlug("google-calendar", googleAppKeysSchema);
};
