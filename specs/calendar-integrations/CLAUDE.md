# AGENTS.md — Calendar Integrations

## Project Context

Sprint 3: Calendar Integrations (F-003) of the Calendly gap closure initiative. This sprint ensures behavioral parity between Cal.com's calendar integration subsystem and Calendly's native calendar connections across Google Calendar, Outlook/Office 365, and Apple Calendar/iCloud. It encompasses 5 epics (CI-001 through CI-005) and 2 gap closures (calendar-driven cancellation sync, buffer time visualization).

## Before Starting Work

1. Read `specs/calendar-integrations/design.md`
2. Check `specs/calendar-integrations/implementation.md` for current progress
3. Look at existing patterns in these relevant directories:
   - `packages/app-store/googlecalendar/` — Google Calendar adapter
   - `packages/app-store/office365calendar/` — Outlook/O365 adapter
   - `packages/app-store/applecalendar/` — Apple Calendar adapter
   - `packages/features/calendars/` — Calendar feature infrastructure (CalendarManager, repositories, taskers, DI)
   - `packages/features/calendar-subscription/` — Calendar subscription adapters and services
   - `packages/features/busyTimes/` — Busy time aggregation service
   - `packages/features/availability/` — Availability orchestration layer
   - `packages/features/bookings/lib/` — Booking lifecycle handlers
   - `packages/types/Calendar.d.ts` — Calendar type definitions
   - `packages/prisma/schema.prisma` — Database schema (Credential, SelectedCalendar, DestinationCalendar, EventType, Feature models)
   - `apps/api/v2/src/ee/calendars/` — API v2 calendar surface
   - `docs/gap-report/calendar-integrations.mdx` — Calendar gap report
   - `docs/sprint-roadmap/` — Sprint roadmap, epic catalog, validation criteria
   - `docs/migration/zero-downtime-strategy.mdx` — Migration safety patterns

## Code Patterns

Key patterns to follow and reference implementations:

- **Calendar adapter pattern**: Each adapter in `packages/app-store/*/lib/CalendarService.ts` implements the `Calendar` interface from `packages/types/Calendar.d.ts` with `createEvent`, `updateEvent`, `deleteEvent`, `getAvailability` methods
- **Credential encryption**: AES-256 encryption via `CALENDSO_ENCRYPTION_KEY` — never modify the encryption algorithm, key derivation, or storage format
- **Feature flag pattern**: New features gated behind `Feature` model rows with `enabled: false` by default — check `packages/prisma/schema.prisma` Feature model (line 1735)
- **Zero-downtime migrations**: Only additive patterns from `docs/migration/zero-downtime-strategy.mdx` — nullable columns (Pattern 2), feature flags (Pattern 5)
- **DI pattern**: `@evyweb/ioctopus` IoC container for service registration in `packages/features/calendars/di/`
- **Test patterns**: Vitest-based tests following existing patterns in `packages/app-store/googlecalendar/lib/__tests__/`
- **CalendarEventBuilder pattern**: Fluent builder in `packages/features/CalendarEventBuilder.ts` for constructing CalendarEvent objects from booking data
- **BusyTimes aggregation**: `packages/features/busyTimes/services/getBusyTimes.ts` aggregates busy times from all connected calendars

## Don't

- Don't add features not in design.md
- Don't skip tests
- Don't modify existing webhook payload structures (`v2021-10-20` format) — backward compatibility is mandatory
- Don't use column renames, type changes, NOT NULL without defaults, or any other anti-patterns in migrations
- Don't modify the AES-256 credential encryption implementation
- Don't change behavior of non-primary calendar adapters (CalDAV, Exchange, Lark, Feishu, Zoho, ICS Feed)
- Don't delete or modify existing `Credential`, `SelectedCalendar`, or `DestinationCalendar` records
- Don't enable feature flags by default — `calendar-cancellation-sync` and `calendar-buffer-sync` must be disabled by default
- Don't combine parity verification with gap closure features in the same PR
- Don't exceed 5-7 files changed (excluding tests) or 500 lines per PR
