# Calendar Integrations Prompts

## Sync Implementation Status

Review what's been implemented for calendar-integrations and update specs/calendar-integrations/implementation.md

Specifically check progress on:

- **CI-001**: Google Calendar sync behavioral parity — `packages/app-store/googlecalendar/lib/CalendarService.ts` FreeBusy API chunking, recurring events, Google Meet integration
- **CI-002**: Outlook/Office 365 sync behavioral parity — `packages/app-store/office365calendar/lib/CalendarService.ts` Microsoft Graph `showAs` filtering, batch API, retry-after handling
- **CI-003**: Apple Calendar sync parity — `packages/app-store/applecalendar/lib/CalendarService.ts` CalDAV CRUD and availability queries
- **CI-004**: Conflict detection alignment — `packages/features/busyTimes/services/getBusyTimes.ts` configurable status filtering (Busy/Tentative/Away/Working Elsewhere)
- **CI-005**: Bi-directional sync verification — end-to-end tests for booking creation, rescheduling, and cancellation across Google and Outlook adapters
- **CI-001 gap**: Calendar-driven cancellation sync — `packages/features/calendars/lib/cancellation-sync/CalendarCancellationSyncService.ts` and handlers
- **CI-002 gap**: Buffer time visualization — `packages/features/calendars/lib/buffer-sync/BufferTimeEventService.ts`

## Generate Tests

Write tests for CalendarService adapters (Google, Outlook, Apple), BusyTimesService, CalendarManager, CalendarCancellationSyncService, and BufferTimeEventService. Follow existing test patterns in `packages/app-store/googlecalendar/lib/__tests__/` and `packages/features/busyTimes/services/`.

Target test files to create or extend:

- `packages/app-store/googlecalendar/lib/__tests__/CalendarService.parity.test.ts` — Calendly parity-specific behavioral tests for Google Calendar adapter
- `packages/app-store/office365calendar/lib/__tests__/CalendarService.test.ts` — Unit tests for Outlook adapter
- `packages/app-store/office365calendar/lib/__tests__/CalendarService.parity.test.ts` — Calendly parity-specific behavioral tests for Outlook adapter
- `packages/app-store/applecalendar/lib/__tests__/CalendarService.test.ts` — Unit tests for Apple Calendar adapter
- `packages/features/calendars/lib/__tests__/conflictDetection.test.ts` — Conflict detection alignment tests across all providers (CI-004)
- `packages/features/calendars/lib/__tests__/bidirectionalSync.integration.test.ts` — End-to-end bi-directional sync verification (CI-005)
- `packages/features/calendar-subscription/lib/__tests__/CalendarCancellationSync.test.ts` — Calendar-driven cancellation sync tests (CI-001 gap)
- `packages/features/calendars/lib/__tests__/bufferTimeVisualization.test.ts` — Buffer time calendar event creation tests (CI-002 gap)

Test coverage areas:

- Event CRUD operations (create, update, delete) with correct external API payloads
- FreeBusy API 90-day window chunking for Google Calendar
- Microsoft Graph `showAs` status filtering for Outlook
- CalDAV `REPORT` method availability queries for Apple Calendar
- Configurable status-based conflict detection across all providers
- Booking lifecycle integration: creation → rescheduling → cancellation → external calendar propagation
- Cancellation sync: external event deletion → change notification → Cal.com booking cancellation
- Buffer time events: creation alongside booking events, deletion on cancellation, correct busy/free status
- Credential encryption integrity (AES-256 via `CALENDSO_ENCRYPTION_KEY`)
- Feature flag gating for gap closure features (`calendar-cancellation-sync`, `calendar-buffer-sync`)

## Code Review

Review changes for:

- **Type safety**: Strict TypeScript types for all calendar event data, credential schemas, and API responses
- **Error handling**: Graceful degradation on API failures, token refresh errors, network timeouts, and rate limiting (HTTP 429 retry-after)
- **Security**: Credential encryption integrity (AES-256 via `CALENDSO_ENCRYPTION_KEY`), OAuth2 token storage, no credential leakage in logs or error messages
- **Edge cases**: Recurring event instances, all-day events, multi-timezone bookings, concurrent calendar operations, expired tokens during long-running sync

Calendar-integration-specific review items:

- **Credential encryption integrity**: Verify all `Credential` records remain decryptable after schema changes — no modifications to encryption algorithm, key derivation, or storage format
- **Webhook payload backward compatibility**: Confirm existing `v2021-10-20` webhook payloads for `BOOKING_CREATED`, `BOOKING_CANCELLED`, and `BOOKING_RESCHEDULED` events remain unchanged
- **Zero-downtime migration compliance**: Verify all schema changes use exclusively safe patterns (nullable columns, additive defaults, feature flag rows) per `docs/migration/zero-downtime-strategy.mdx`
- **Feature flag gating**: Confirm gap closure features (`calendar-cancellation-sync`, `calendar-buffer-sync`) are gated behind disabled-by-default feature flags and not user-facing until explicitly enabled
- **Data preservation**: Verify no existing `SelectedCalendar`, `DestinationCalendar`, `Booking`, or `BookingReference` records are modified or deleted

## Continue Feature

Continue working on calendar-integrations. Read specs/calendar-integrations/implementation.md for current status.

Key directories to reference:

- `packages/app-store/googlecalendar/` — Google Calendar adapter
- `packages/app-store/office365calendar/` — Outlook/Office 365 adapter
- `packages/app-store/applecalendar/` — Apple Calendar adapter
- `packages/features/calendars/` — Calendar feature infrastructure (CalendarManager, taskers, DI)
- `packages/features/busyTimes/` — Busy time aggregation and conflict detection
- `packages/features/calendar-subscription/` — Calendar subscription adapters and sync services
- `packages/features/CalendarEventBuilder.ts` — Event construction builder
- `packages/features/bookings/lib/` — Booking lifecycle handlers
- `packages/types/Calendar.d.ts` — Shared calendar type definitions
- `packages/prisma/schema.prisma` — Database schema
- `specs/calendar-integrations/design.md` — Design specification (source of truth)
- `specs/calendar-integrations/decisions.md` — Architecture Decision Records

## Generate Docs with Screenshots

Generate documentation for calendar-integrations with screenshots:

1. Open the calendar settings page (`/settings/my-account/calendars`) in the browser
2. Take screenshots of key UI states:
   - Connected calendars list showing Google, Outlook, and Apple Calendar connections
   - Destination calendar selector dropdown (per-user and per-event-type)
   - Buffer time sync toggle (when `calendar-buffer-sync` feature flag is enabled)
   - Cancellation sync status indicator (when `calendar-cancellation-sync` feature flag is enabled)
3. Open the event type calendar selection page and capture:
   - Per-event-type calendar selection interface
   - Buffer time configuration with sync toggle
4. Save screenshots to `specs/calendar-integrations/docs/screenshots/`
5. Create/update `specs/calendar-integrations/docs/README.md` with:
   - Feature overview: Sprint 3 Calendar Integrations covering Google, Outlook, and Apple Calendar bi-directional sync with Calendly behavioral parity
   - How to use: Connecting calendars, enabling buffer-sync toggle, enabling cancellation-sync, selecting destination calendars per event type
   - Configuration options: `syncBuffersToCalendar` toggle, `externalCancellationSyncEnabled` credential setting, feature flags (`calendar-cancellation-sync`, `calendar-buffer-sync`)
   - Common use cases: Multi-calendar conflict detection, buffer time visualization in external calendars, automatic cancellation propagation from external calendar changes

## Promote Docs to Public

Promote internal docs to public Mintlify docs:

1. Review `specs/calendar-integrations/docs/README.md` for completeness and accuracy
2. Copy/adapt content to `docs/calendar-integrations.mdx` — rewrite for external audience
3. Move screenshots to `docs/images/calendar-integrations/`
4. Update `docs/mint.json` navigation to include the new calendar integrations page
5. Ensure customer-appropriate language:
   - Remove internal implementation details (DI tokens, service class names, Prisma schema references)
   - Focus on user-facing functionality (connecting calendars, configuring sync behavior, understanding conflict detection)
   - Use consistent terminology matching Cal.com's public documentation style
   - Omit references to Calendly parity or gap closure — present features as Cal.com capabilities
