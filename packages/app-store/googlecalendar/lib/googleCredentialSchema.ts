import { z } from "zod";

/**
 * Zod schema for Google Calendar OAuth2 credential token validation.
 *
 * Core fields (scope, token_type, expiry_date, access_token, refresh_token) are required
 * for OAuth2 token lifecycle management.
 *
 * Push notification channel fields (CI-001 gap) are optional and store metadata for
 * active Google Calendar push notification channels used by the cancellation-sync feature.
 * These fields are populated when subscribeToChanges() is called on the GoogleCalendarService
 * and cleared when unsubscribeFromChanges() is called.
 */
export const googleCredentialSchema = z.object({
  scope: z.string(),
  token_type: z.literal("Bearer"),
  expiry_date: z.number(),
  access_token: z.string(),
  refresh_token: z.string(),
  // Push notification channel metadata (CI-001 gap: calendar-driven cancellation sync)
  channelId: z.string().optional(),
  resourceId: z.string().optional(),
  channelExpiration: z.number().optional(),
});
