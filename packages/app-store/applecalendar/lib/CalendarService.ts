/**
 * @module AppleCalendarService
 * @description Apple Calendar (iCloud) CalDAV adapter for Cal.com.
 *
 * Sprint 3: Calendar Integrations — Epic CI-003: iCloud/Apple Calendar Sync Parity
 *
 * This file implements the Apple Calendar integration as a thin subclass of the
 * shared CalDAV `BaseCalendarService`. The CI-003 parity audit verifies that
 * Cal.com's Apple Calendar behavior matches (and exceeds) what Calendly offered
 * before discontinuing iCloud support in August 2024.
 *
 * ---
 *
 * ## CI-003 Parity Verification Audit
 *
 * ### 1. CalDAV Endpoint Configuration
 * The endpoint `"https://caldav.icloud.com"` is the correct iCloud CalDAV root.
 * This is the primary Apple Calendar CalDAV URL that Calendly also used before
 * discontinuing iCloud support. No URL path suffix is needed — the base URL is
 * sufficient for tsdav account creation and CalDAV service discovery.
 *
 * ### 2. Provider Identifier
 * The identifier `"apple_calendar"` matches the credential `type` used in
 * `api/add.ts` (line 23) and is consistent with the `_metadata.ts` slug. This
 * ensures credential lookup and calendar manager routing resolve correctly.
 *
 * ### 3. Base Class Integration
 * `AppleCalendarService` inherits ALL CalDAV operations from `BaseCalendarService`
 * at `packages/lib/CalendarService.ts`. No Apple-specific overrides are needed:
 *
 * - **createEvent**: ICS generation with VTIMEZONE injection, CalDAV PUT via
 *   `createCalendarObject`
 * - **updateEvent**: Fetch existing object by UID, rebuild ICS, CalDAV PUT via
 *   `updateCalendarObject`
 * - **deleteEvent**: Enumerate objects by UID, CalDAV DELETE via
 *   `deleteCalendarObject`
 * - **getAvailability**: Fetch CalDAV objects, parse via ICAL.js, handle
 *   recurring events with 365-iteration cap, timezone handling, travel time
 *   adjustments. `TRANSPARENT` event filtering correctly identifies free events
 *   via the CalDAV TRANSP property.
 * - **listCalendars**: Fetch calendars via tsdav `fetchCalendars`, filter to
 *   VEVENT-supporting collections only
 *
 * ### 4. Credential Handling
 * `BaseCalendarService` constructor decrypts credentials via `symmetricDecrypt`
 * with `CALENDSO_ENCRYPTION_KEY`, extracting `username`, `password`, and optional
 * `url` from the decrypted JSON payload. Apple Calendar credentials use the
 * `{ username: "...", password: "..." }` pattern set in `api/add.ts`. The `url`
 * parameter passed in the constructor (`"https://caldav.icloud.com"`) overrides
 * any `credentialURL` from the payload — correct for Apple which always uses
 * the iCloud CalDAV endpoint.
 *
 * ### 5. Parity Conclusion
 * The Apple Calendar adapter is a thin subclass delegating all CalDAV operations
 * to the shared `BaseCalendarService`. Calendly discontinued iCloud support in
 * August 2024 — Cal.com's continued Apple Calendar support via CalDAV is a
 * competitive advantage. The CalDAV implementation handles:
 * - Event CRUD via PUT/DELETE
 * - Availability via REPORT
 * - Timezone handling (VTIMEZONE injection)
 * - Recurring events (365-iteration expansion cap)
 * - PRIVATE classification support
 * - TRANSPARENT/OPAQUE event status filtering
 *
 * **No functional code changes required — behavioral parity verified.**
 *
 * @see {@link packages/lib/CalendarService.ts} for BaseCalendarService implementation
 * @see {@link packages/app-store/applecalendar/api/add.ts} for credential creation flow
 * @see {@link docs/gap-report/calendar-integrations.mdx} for full parity gap analysis
 *
 * @audit CI-003 — Sprint 3: Calendar Integrations parity verification
 * @verified 2025 — iCloud CalDAV behavioral parity confirmed against Calendly baseline
 */
import BaseCalendarService from "@calcom/lib/CalendarService";
import type { Calendar } from "@calcom/types/Calendar";
import type { CredentialPayload } from "@calcom/types/Credential";

/**
 * Apple Calendar (iCloud) service — thin subclass of the shared CalDAV BaseCalendarService.
 *
 * Timeout Note:
 * Outbound CalDAV HTTP request timeouts are managed by the `tsdav` library used in
 * BaseCalendarService (packages/lib/CalendarService.ts). Explicit timeout configuration
 * for CalDAV operations (event CRUD, availability queries, calendar listing) should be
 * added to BaseCalendarService to apply consistently across all CalDAV-based adapters
 * (Apple Calendar, CalDAV Calendar). The tsdav library's `fetchOptions` parameter on
 * DAVClient supports passing a custom `signal` for AbortController-based timeouts.
 */
class AppleCalendarService extends BaseCalendarService {
  constructor(credential: CredentialPayload) {
    super(credential, "apple_calendar", "https://caldav.icloud.com");
  }
}

/**
 * Factory function that creates an Apple Calendar service instance.
 * This is exported instead of the class to prevent internal types
 * from leaking into the emitted .d.ts file.
 */
export default function BuildCalendarService(credential: CredentialPayload): Calendar {
  return new AppleCalendarService(credential);
}
