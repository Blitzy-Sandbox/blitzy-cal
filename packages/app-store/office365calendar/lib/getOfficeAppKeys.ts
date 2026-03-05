import { z } from "zod";

import getParsedAppKeysFromSlug from "../../_utils/getParsedAppKeysFromSlug";

/**
 * Zod validation schema for Office 365 Calendar app credentials.
 * Validates the Azure AD application registration credentials (client_id, client_secret)
 * required for:
 * - OAuth2 token management (user and delegated authentication flows)
 * - Microsoft Graph API requests (calendar CRUD, availability queries)
 * - Microsoft Graph change notification subscription setup (CI-001 gap: calendar-driven cancellation sync)
 *
 * These keys are stored in the Cal.com app store configuration under the "office365-calendar" slug.
 */
const officeAppKeysSchema = z.object({
  client_id: z.string(),
  client_secret: z.string(),
});

/**
 * Retrieves and validates the Office 365 Calendar app credentials from the Cal.com app store.
 * Returns the Azure AD application's `client_id` and `client_secret` used for OAuth2 token
 * management and Microsoft Graph API interactions, including change notification subscriptions
 * for calendar-driven cancellation sync.
 *
 * @returns Promise resolving to `{ client_id: string; client_secret: string }`
 * @throws If the app keys are missing or fail Zod schema validation
 */
export const getOfficeAppKeys = async () => {
  return getParsedAppKeysFromSlug("office365-calendar", officeAppKeysSchema);
};
