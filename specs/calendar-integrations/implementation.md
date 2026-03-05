# Calendar Integrations Implementation

## Status: not-started

## Completed

## In Progress

## Blocked

## Next Steps

1. PR 1: Spec artifacts creation — create `specs/calendar-integrations/` folder with `design.md`, `implementation.md`, `decisions.md`, `CLAUDE.md`, `prompts.md`, `future-work.md`, and `docs/README.md`
2. PR 2: Database migration (CI-004, CI-001 gap, CI-002 gap) — additive schema additions (`syncBuffersToCalendar` nullable Boolean on `EventType`, `externalCancellationSyncEnabled` nullable Boolean on `Credential`) + feature flag rows (`calendar-cancellation-sync`, `calendar-buffer-sync`) in `packages/prisma/migrations/` and `packages/prisma/schema.prisma`
3. PR 3: Google Calendar parity verification (CI-001) — verify and align `packages/app-store/googlecalendar/lib/CalendarService.ts` `createEvent`, `updateEvent`, `deleteEvent`, `getAvailability` with Calendly behavior; FreeBusy API chunking for 90-day windows; recurring event support; Google Meet integration
4. PR 4: Outlook/O365 parity verification (CI-002) — verify and align `packages/app-store/office365calendar/lib/CalendarService.ts` with Calendly behavior, including `showAs` status filtering (Busy, Tentative, Away, WorkingElsewhere, Oof), batch API handling via `@odata.nextLink`, and retry-after logic for HTTP 429 responses
5. PR 5: Apple Calendar parity verification (CI-003) — verify `packages/app-store/applecalendar/lib/CalendarService.ts` CalDAV operations against Calendly's (now-discontinued) iCloud behavior; validate `getAvailability` via CalDAV `REPORT` method
6. PR 6: Conflict detection alignment (CI-004) — extend `packages/features/busyTimes/services/getBusyTimes.ts` with configurable status filtering; add optional `statusFilter` to `GetAvailabilityParams` in `packages/types/Calendar.d.ts`; thread `statusFilter` through `packages/features/calendars/lib/CalendarManager.ts` to individual adapters
7. PR 7: Bi-directional sync verification tests (CI-005) — end-to-end integration tests in `packages/features/calendars/lib/__tests__/bidirectionalSync.integration.test.ts` for the complete booking → `CalendarEventBuilder` → `CalendarManager` → adapter → external calendar pipeline, covering create, reschedule, and cancel flows for Google and Outlook adapters
8. PR 8: Calendar-driven cancellation sync (CI-001 gap) — create `packages/features/calendars/lib/cancellation-sync/CalendarCancellationSyncService.ts`, `handlers/GoogleCancellationHandler.ts`, `handlers/OutlookCancellationHandler.ts`; integrate with `packages/features/bookings/lib/handleCancelBooking.ts` via `source: "external_calendar"` indicator; gated behind `calendar-cancellation-sync` feature flag
9. PR 9: Buffer time visualization (CI-002 gap) — create `packages/features/calendars/lib/buffer-sync/BufferTimeEventService.ts`; extend `packages/features/CalendarEventBuilder.ts` with `buildBufferEvent(booking, bufferType)` method; integrate with `packages/features/calendars/lib/CalendarManager.ts` for optional buffer event creation; gated behind `calendar-buffer-sync` feature flag
10. PR 10: Documentation updates and Gate 3 validation evidence — update `docs/gap-report/calendar-integrations.mdx` parity status, mark CI-001 through CI-005 as completed in `docs/sprint-roadmap/epic-catalog.mdx`, record validation evidence in `docs/sprint-roadmap/validation-criteria.mdx` across all five gate dimensions (behavioral, regression, data preservation, webhook compatibility, cross-domain integration)

## Session Notes
