# Calendar Integrations Design

## Overview

Sprint 3: Calendar Integrations (F-003) achieves behavioral parity between Cal.com's calendar integration subsystem and Calendly's native calendar connections across Google Calendar, Outlook/Office 365, and Apple Calendar/iCloud. This sprint verifies and enhances the three primary calendar adapters, aligns conflict detection behavior, verifies bi-directional sync, and closes two medium-severity gaps: calendar-driven cancellation sync and buffer time visualization in external calendars.

## Problem Statement

Cal.com's calendar integration subsystem already exceeds Calendly in breadth (11+ adapters vs 3) and features (per-event-type calendar selection, unlimited connections, delegation credentials, AES-256 credential encryption). However, two behavioral gaps exist compared to Calendly's integration model:

1. **Calendar-driven cancellation sync (CI-001 gap)**: Cal.com does not detect event deletions or declines in external calendars (Google Calendar, Outlook) to propagate cancellations back to the Cal.com booking. When a user deletes or declines a booking event directly in their external calendar, the Cal.com booking remains in an active state, creating a desynchronization between the external calendar and Cal.com's booking records.

2. **Buffer time visualization (CI-002 gap)**: Cal.com does not optionally write buffer periods (before-event and after-event buffers configured on event types) as separate calendar events in the user's external calendar. This means users cannot visually see their protected buffer time in Google Calendar or Outlook, reducing awareness of their actual availability windows.

Additionally, the conflict detection status filtering must be aligned with Calendly's configurable "What's considered unavailable?" behavior, where users can specify which event statuses (Busy, Tentative, Away, Working Elsewhere, Out of Office) should block availability during slot generation.

This sprint encompasses five cataloged epics and two gap closure items:

| Epic ID | Name | Priority | Complexity |
|---------|------|----------|------------|
| CI-001 | Google Calendar sync behavioral parity | Medium | M |
| CI-002 | Outlook/Office 365 sync behavioral parity | Medium | M |
| CI-003 | iCloud/Apple Calendar sync parity | Medium | M |
| CI-004 | Conflict detection behavior alignment | High | L |
| CI-005 | Bi-directional sync verification | High | L |
| CI-001 (gap) | Calendar-driven cancellation sync | Medium | M |
| CI-002 (gap) | Buffer time visualization in external calendars | Medium | M |

## User Stories

- As a Cal.com user with Google Calendar connected, I want my bookings to be created, updated, and deleted in my Google Calendar with correct times, timezone, attendees, and Google Meet integration so that my external calendar stays in sync with my Cal.com bookings.

- As a Cal.com user with Outlook connected, I want the same bi-directional sync behavior using Microsoft Graph API with correct `showAs` status handling so that my Outlook calendar accurately reflects my Cal.com bookings and availability.

- As a Cal.com user with Apple Calendar connected, I want CalDAV-based event sync that works reliably via iCloud so that my Apple Calendar reflects my Cal.com bookings.

- As a Cal.com user, I want to configure which event statuses (Busy, Tentative, Away, Working Elsewhere, Out of Office) are considered "unavailable" for conflict detection, matching Calendly's dropdown behavior, so that I have granular control over what blocks my available slots.

- As a Cal.com user, I want events deleted or declined in my external calendar to automatically cancel the corresponding Cal.com booking (gap closure) so that my Cal.com booking state stays synchronized with my external calendar without manual intervention.

- As a Cal.com user, I want to optionally see buffer time periods as separate events in my external calendar for visual clarity (gap closure) so that I can see my protected preparation and wrap-up time in Google Calendar or Outlook.

## Technical Design

### Database Changes

All schema changes follow zero-downtime-safe patterns defined in `docs/migration/zero-downtime-strategy.mdx`. No column renames, type changes, NOT NULL without defaults, or any other anti-patterns are used.

#### 1. EventType Model — Buffer Sync Toggle (Pattern 2: Nullable Column)

```prisma
model EventType {
  // ... existing fields ...
  syncBuffersToCalendar Boolean? // nullable, default null (treated as false)
}
```

- **Field**: `syncBuffersToCalendar Boolean?`
- **Pattern**: Pattern 2 — Nullable column addition (no default required)
- **Purpose**: Controls whether buffer time events (before-event and after-event buffers) are written to external calendars as separate calendar events
- **Behavior when null**: Treated as `false` — buffer events are not created in external calendars
- **Migration SQL**: `ALTER TABLE "EventType" ADD COLUMN "syncBuffersToCalendar" BOOLEAN;`

#### 2. Credential Model — Cancellation Sync Toggle (Pattern 2: Nullable Column)

```prisma
model Credential {
  // ... existing fields ...
  externalCancellationSyncEnabled Boolean? // nullable, default null (treated as false)
}
```

- **Field**: `externalCancellationSyncEnabled Boolean?`
- **Pattern**: Pattern 2 — Nullable column addition (no default required)
- **Purpose**: Controls whether this credential has active cancellation-sync subscriptions (Google push notification channels or Microsoft Graph change notification subscriptions)
- **Behavior when null**: Treated as `false` — no cancellation-sync subscription is active for this credential
- **Migration SQL**: `ALTER TABLE "Credential" ADD COLUMN "externalCancellationSyncEnabled" BOOLEAN;`

#### 3. Feature Flag Rows (Pattern 5: Feature Flag Gating)

Two new feature flag rows are inserted into the existing `Feature` table with disabled-by-default status:

```sql
INSERT INTO "Feature" (slug, enabled, description, "type")
VALUES ('calendar-cancellation-sync', false, 'Enable calendar-driven cancellation sync from external calendars', 'OPERATIONAL')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO "Feature" (slug, enabled, description, "type")
VALUES ('calendar-buffer-sync', false, 'Enable buffer time visualization in external calendars', 'OPERATIONAL')
ON CONFLICT (slug) DO NOTHING;
```

- **Pattern**: Pattern 5 — Feature flag gating with `ON CONFLICT DO NOTHING` for idempotent re-deployment
- **Default**: Both flags are `enabled: false` — features are not user-facing until explicitly enabled after validation passes

#### 4. Migration File

- **Path**: `packages/prisma/migrations/[timestamp]_calendar_integration_gap_closure/migration.sql`
- **Contents**: The two `ALTER TABLE` statements and two `INSERT INTO "Feature"` statements above
- **Schema file**: `packages/prisma/schema.prisma` — add the two new nullable fields to their respective models
- **Rollback strategy**: Nullable columns can remain if rollback is needed — they default to null/false behavior with no data loss

#### 5. Data Preservation Guarantee

All existing records in the following tables remain intact and unmodified:

- **`Credential`** — All existing rows with AES-256 encrypted keys (via `CALENDSO_ENCRYPTION_KEY`) remain decryptable; the new nullable column has no effect on existing records
- **`SelectedCalendar`** — All per-user calendar selection configurations are preserved
- **`DestinationCalendar`** — All per-user and per-event-type calendar assignments remain intact
- **`Booking`** — All booking records and their `BookingReference` entries (containing external calendar event UIDs) are preserved
- **Verification**: Row count comparison before and after migration; credential decryption spot-check for a sample of records

### API Changes

#### Type Definition Extensions (CI-004)

**File**: `packages/types/Calendar.d.ts`

Extend `GetAvailabilityParams` interface with an optional `statusFilter` property for configurable conflict detection:

```typescript
interface GetAvailabilityParams {
  // ... existing properties ...
  statusFilter?: string[]; // e.g., ["busy", "tentative", "oof", "workingElsewhere"]
}
```

This allows each calendar adapter's `getAvailability` method to receive a configurable list of event statuses that should be treated as "unavailable" for conflict detection, aligning with Calendly's "What's considered unavailable?" dropdown behavior.

#### Busy Times Service Modification (CI-004)

**File**: `packages/features/busyTimes/services/getBusyTimes.ts`

- Pass `statusFilter` through to individual calendar adapter `getAvailability` calls
- When `statusFilter` is not provided, use the default behavior which skips `free` and `workingElsewhere` events, treating all other statuses (`busy`, `tentative`, `oof`, `unknown`) as "unavailable"
- The `statusFilter` is read from user preferences and threaded through the busy time aggregation pipeline

#### CalendarManager Modifications (CI-004, CI-001 gap, CI-002 gap)

**File**: `packages/features/calendars/lib/CalendarManager.ts`

Three integration points:

1. **Status filter threading (CI-004)**: Thread `statusFilter` from user preferences through `getCalendarCredentials` to each adapter's `getAvailability` call
2. **Buffer-sync integration (CI-002 gap)**: After `processEvent` creates the main booking event, if `syncBuffersToCalendar` is enabled on the event type and the `calendar-buffer-sync` feature flag is active, invoke `BufferTimeEventService` to create buffer events
3. **Cancellation-sync lifecycle (CI-001 gap)**: Support subscription registration/renewal for Google push notification channels and Microsoft Graph change notification subscriptions when `externalCancellationSyncEnabled` is true on a credential

#### Booking Cancellation Handler Modification (CI-001 gap)

**File**: `packages/features/bookings/lib/handleCancelBooking.ts`

- Accept optional `source` parameter to distinguish cancellation origin:
  - `source: "user"` (default) — User-initiated cancellation via Cal.com UI or API
  - `source: "external_calendar"` — Calendar-driven cancellation triggered by external event deletion/decline
- Both paths invoke the same cancellation logic (delete external calendar events, send notifications, fire webhooks) ensuring identical `BOOKING_CANCELLED` webhook payloads for backward compatibility

#### CalendarEventBuilder Extension (CI-002 gap)

**File**: `packages/features/CalendarEventBuilder.ts`

- Add `buildBufferEvent(booking, bufferType: "before" | "after")` method to construct `CalendarEvent` objects for buffer time periods
- Buffer events use the naming convention `"Buffer: [Event Title]"` (see ADR-002 in `specs/calendar-integrations/decisions.md`)
- Buffer events are marked with `showAs: "busy"` status
- Buffer events include a reference to the parent booking ID for linkage and orphan cleanup

#### New Service: Calendar Cancellation Sync (CI-001 gap)

**File**: `packages/features/calendars/lib/cancellation-sync/CalendarCancellationSyncService.ts`

Core service handling the cancellation propagation flow:

1. Receive change notification from Google push notification or Microsoft Graph subscription
2. Parse the notification payload to determine the event action (deleted, declined)
3. Look up the corresponding Cal.com booking by external event UID (stored in `BookingReference`)
4. Verify the booking is still in an active/confirmed state
5. Invoke `handleCancelBooking` with `source: "external_calendar"` indicator
6. Dispatch attendee notifications and webhook events through the standard cancellation pipeline
7. Feature flag check: Only process if `calendar-cancellation-sync` feature flag is enabled

**File**: `packages/features/calendars/lib/cancellation-sync/handlers/GoogleCancellationHandler.ts`

Handler for Google Calendar push notification payloads:

- Processes `X-Goog-Resource-State: delete` and status change notifications
- Verifies the push notification channel signature
- Delegates to `CalendarCancellationSyncService` for booking lookup and cancellation
- Handles token refresh via `CalendarAuth.ts` if credentials are expired

**File**: `packages/features/calendars/lib/cancellation-sync/handlers/OutlookCancellationHandler.ts`

Handler for Microsoft Graph change notification payloads:

- Processes `changeType: "deleted"` and event decline notifications
- Validates the notification subscription and client state
- Delegates to `CalendarCancellationSyncService` for booking lookup and cancellation
- Respects HTTP 429 `Retry-After` throttle limits from Microsoft Graph API

#### New Service: Buffer Time Event Service (CI-002 gap)

**File**: `packages/features/calendars/lib/buffer-sync/BufferTimeEventService.ts`

Service for creating, updating, and deleting buffer time events alongside booking events:

- **Create**: When a booking is created and `syncBuffersToCalendar` is enabled, create buffer events for before-event and after-event buffer periods using the `CalendarEventBuilder.buildBufferEvent` method
- **Update**: When a booking is rescheduled, update the corresponding buffer events with new times
- **Delete**: When a booking is cancelled, delete the buffer events alongside the main event
- **Orphan cleanup**: Buffer events reference parent booking ID; if a buffer event exists without a valid parent booking, it is cleaned up
- Feature flag check: Only process if `calendar-buffer-sync` feature flag is enabled

#### Adapter Verification (CI-001, CI-002, CI-003)

The following adapters are verified for behavioral parity with Calendly — modifications are made only where gaps are confirmed:

**Google Calendar Adapter** (`packages/app-store/googlecalendar/lib/CalendarService.ts`)

- Verify `createEvent` correctly attaches timezone, attendees, and Google Meet conference data (`conferenceData` with `createRequest` type `hangoutsMeet`)
- Verify `updateEvent` correctly modifies existing events including recurring event instances (uses `eventId` with optional `recurringEventId` for instance targeting)
- Verify `deleteEvent` removes events from the destination calendar
- Verify `getAvailability` uses FreeBusy API with proper chunking for 90-day windows (Calendly's standard availability window)
- Verify recurring event support handles single-instance modifications correctly

**Outlook/O365 Adapter** (`packages/app-store/office365calendar/lib/CalendarService.ts`)

- Verify `getAvailability` correctly filters events by `showAs` status values: `free`, `tentative`, `busy`, `oof` (Out of Office), `workingElsewhere`, `unknown` (per Microsoft Graph `FreeBusyStatus` enum)
- Verify batch API requests handle pagination via `@odata.nextLink` correctly
- Verify retry-after logic respects HTTP 429 responses from Microsoft Graph API
- Verify Teams online meeting integration when applicable
- Enhance `getAvailability` to accept and apply the new `statusFilter` parameter (CI-004)

**Apple Calendar Adapter** (`packages/app-store/applecalendar/lib/CalendarService.ts`)

- Verify CalDAV event CRUD operations via `caldav.icloud.com` produce correct results
- Verify `getAvailability` correctly queries busy times via CalDAV `REPORT` method
- Note: Apple CalDAV has limited status support compared to Google and Outlook — status filter applies only where CalDAV supports it

#### API v2 Surface (Verification Only)

**Path**: `apps/api/v2/src/ee/calendars/`

No new endpoints are created. The following existing endpoints are verified to produce correct behavior after all Sprint 3 modifications:

- `GET /v2/calendars` — Lists connected calendars via `calendars.controller.ts`
- `GET /v2/calendars/busy-times` — Returns busy times for conflict checking
- `POST /v2/calendars/credentials` — Manages calendar credential CRUD
- `DELETE /v2/calendars/credentials` — Removes calendar credentials
- Provider-specific services: `gcal.service.ts`, `outlook.service.ts`, `apple-calendar.service.ts`

### UI Changes

Sprint 3 has minimal UI surface. No visual redesign is in scope — only minor additions related to the gap closure features.

#### 1. Calendar Settings Page

**Path**: `apps/web/app/(use-page-wrapper)/settings/(settings-layout)/my-account/calendars/page.tsx`

- May need a new toggle for "Sync buffer times to calendar" if the buffer-sync toggle is configured at the user level
- Toggle is only visible when the `calendar-buffer-sync` feature flag is enabled

#### 2. Event Type Settings

- May need a `syncBuffersToCalendar` toggle on the event type settings page, since the `syncBuffersToCalendar` field is on the `EventType` model
- This allows per-event-type control over whether buffer events are written to external calendars

#### 3. No Changes Required

The following UI components require no modifications:

- **Calendar Onboarding** (`apps/web/app/(use-page-wrapper)/onboarding/personal/calendar/page.tsx`) — Existing flow handles calendar connection correctly
- **Destination Calendar Selector** (`packages/features/calendars/components/DestinationCalendarSelector.tsx`) — Per-event-type calendar selection already supported

## Edge Cases

### 1. Token Expiry During Push Notification Processing

Google OAuth2 tokens expire after approximately 1 hour. When a push notification arrives indicating an event deletion, the credential's access token may be expired. The `CalendarAuth.ts` refresh logic in `packages/app-store/googlecalendar/lib/CalendarAuth.ts` must auto-refresh the token before processing the notification. If the refresh token itself is invalid (user revoked access), the notification should be logged and the cancellation-sync subscription should be marked as inactive on the `Credential` record (`externalCancellationSyncEnabled = false`).

### 2. Concurrent Cancellation From Multiple Sources

A user cancels a booking in the Cal.com UI simultaneously with the external calendar deletion triggering cancellation-sync. Both paths invoke `handleCancelBooking`, which must be idempotent — attempting to cancel an already-cancelled booking should not produce an error, duplicate webhook events, or duplicate attendee notifications. The handler should check booking status before proceeding and gracefully exit if the booking is already cancelled.

### 3. Buffer Event Orphaning

If a booking cancellation successfully deletes the main calendar event but fails to delete its associated buffer events (due to a transient API error), orphan buffer events remain in the external calendar. Buffer events must reference the parent booking ID (stored in event metadata or extended properties). A periodic cleanup job or retry mechanism should detect and remove orphaned buffer events. The `BufferTimeEventService` should implement retry logic with exponential backoff for buffer event deletion.

### 4. Outlook Retry-After Throttling

Microsoft Graph API returns HTTP 429 with a `Retry-After` header when rate limits are exceeded. The `OutlookCancellationHandler` and change notification subscription renewal logic must respect these throttle limits. Subscription renewal requests should implement exponential backoff and not retry more frequently than the `Retry-After` value indicates. Failed subscription renewals should trigger an alert and fall back to a degraded state where cancellation-sync is temporarily inactive.

### 5. Google Push Notification Channel Expiry

Google Calendar push notification channels have a configurable TTL (maximum ~30 days). Channels must be renewed before expiry. If a channel expires and events are missed during the gap between expiry and renewal, those missed deletions will not trigger cancellation-sync. Mitigation: Implement proactive channel renewal at 75% of TTL. If a gap is detected, perform a one-time reconciliation by fetching recent events and comparing against Cal.com booking references.

### 6. Multi-Calendar Conflict Detection With Heterogeneous Status Support

A user with 3+ connected calendars (e.g., Google, Outlook, and Apple) using the configurable status filter. Not all adapters support all status values — Apple CalDAV has limited status support compared to Google's FreeBusy API and Outlook's `showAs` property. The status filter must apply consistently: for adapters that don't support a specific status value, the filter should fall back to the adapter's native behavior (typically treating all non-free events as busy). This ensures no false availability is reported due to adapter limitations.

### 7. Feature Flag Race Condition

If a feature flag (`calendar-cancellation-sync` or `calendar-buffer-sync`) is toggled during an active request, the behavior for that request should be consistent. The feature flag value should be checked once at service initialization or at the start of request processing, not per-operation within the same request. This prevents inconsistent states where a buffer event is created for one booking but not for another within the same request batch.

### 8. Migration Rollback Safety

If the migration must be rolled back, the nullable columns (`syncBuffersToCalendar` on `EventType`, `externalCancellationSyncEnabled` on `Credential`) can simply remain in the schema — they default to null, which is treated as false by the application code. No data loss occurs. The `Feature` flag rows inserted with `ON CONFLICT DO NOTHING` are also safe to leave in place, as they are disabled by default. Rollback SQL for the migration should simply drop the two columns if a full revert is required.

## Out of Scope

The following items are explicitly excluded from Sprint 3: Calendar Integrations:

1. **Non-primary calendar adapters** — CalDAV (`caldavcalendar`), Exchange 2013 (`exchange2013calendar`), Exchange 2016 (`exchange2016calendar`), Lark (`larkcalendar`), Feishu (`feishucalendar`), Zoho (`zohocalendar`), ICS Feed (`ics-feedcalendar`), and generic Exchange (`exchangecalendar`) are not part of Calendly's native integrations and are Cal.com competitive advantages. No parity work is needed for these adapters.

2. **Sprint 1 (Availability & Scheduling), Sprint 2 (Event Types), Sprint 4+ features** — Upstream sprints are assumed complete with gates passed. Downstream sprints (Webhooks, Routing Forms, Embed, Admin, Notifications) depend on Gate 3 passing but are not implemented in this sprint. No modifications to `packages/features/schedules/`, `packages/features/holidays/`, `packages/features/travelSchedule/`, or `packages/features/eventtypes/` beyond verifying event-type-level calendar selection works.

3. **Webhook payload modifications** — Existing `v2021-10-20` webhook payloads must remain unchanged. No field removals, renames, or type changes in any `WebhookTriggerEvents` payload. No modifications to `packages/features/webhooks/` or the `PayloadBuilderFactory` versioning system.

4. **Performance optimization beyond parity requirements** — No refactoring of existing adapter code for performance unless it directly affects behavioral parity. General optimization of FreeBusy API chunking, batch request handling, or CalDAV query efficiency is deferred.

5. **UI redesign of calendar settings pages** — The existing calendar settings UI is functional. Only minor additions (buffer-sync toggle) are in scope, not visual redesign or UX overhaul.

6. **Embed system changes** — `packages/embeds/` is not in scope for Sprint 3.

7. **Email/SMS notification changes** — `packages/emails/` and `packages/sms/` are not modified. Notification behavior improvements are Sprint 8 scope.

8. **Pricing/payment integration changes** — No changes to Stripe or PayPal payment flows.

9. **CalDAV-based cancellation sync for Apple Calendar** — CalDAV protocol lacks push notifications. Implementing polling-based cancellation detection for Apple Calendar is deferred to future work (see `specs/calendar-integrations/future-work.md`).

10. **Per-user percentage-based feature flag rollout** — The existing `Feature` model supports instance-wide toggle only (enabled/disabled per slug). Percentage-based rollout, user-targeting, or A/B testing for the new feature flags is not in scope.
