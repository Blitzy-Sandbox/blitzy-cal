# CLAUDE.md — Event Types (Sprint 2)

## Project Context

Sprint 2 of the Calendly gap closure sprint roadmap focuses on systematically closing all identified behavioral gaps between Cal.com's event type system and Calendly's event type capabilities. This sprint encompasses 6 epics: ET-001 (1:1 Event Type Behavioral Parity), ET-002 (Group Event Type Parity via `seatsPerTimeSlot`), ET-003 (Round-Robin Distribution Parity — highest priority), ET-004 (Collective Scheduling Parity), ET-005 (Booking Window Configuration Alignment), and ET-006 (Custom Fields/Questions Parity). Sprint 2 depends on Sprint 1 (Availability & Scheduling, F-004) having passed Gate 1 — event type slot generation, buffer enforcement, and booking windows all rely on the availability engine producing correct results. All behavioral targets reference Calendly's API at developer.calendly.com as the authoritative benchmark for expected scheduling platform behavior.

## Before Starting Work

1. Read `specs/event-types/design.md` for the comprehensive technical design
2. Check `specs/event-types/implementation.md` for current progress status on all 6 epics
3. Review `specs/event-types/decisions.md` for any ADRs and trade-off decisions
4. Look at existing patterns in:
   - `packages/features/eventtypes/` — Core event type feature module (lib, components, repositories)
   - `packages/features/ee/round-robin/` — Enterprise round-robin distribution logic
   - `packages/features/availability/lib/` — Upstream availability integration (getUserAvailability, getAggregatedAvailability)
   - `packages/prisma/schema.prisma` — EventType model, SchedulingType enum, BookingSeat model
   - `packages/trpc/server/routers/viewer/eventTypes/` — tRPC event type routes
   - `apps/api/v2/src/ee/event-types/` — NestJS API v2 event type modules

## Code Patterns

- **DI Pattern:** `@evyweb/ioctopus` dependency injection — see `packages/features/di/` for container setup
- **Repository Pattern:** Prisma repositories for data access — see `packages/features/eventtypes/repositories/eventTypeRepository.ts`
- **Validation:** Zod schemas at API boundaries — see `packages/features/eventtypes/lib/schemas.ts`
- **Date/Time:** `@calcom/dayjs` for all date operations — never native `Date`
- **Testing:** Vitest with `vi.mock` for Prisma mocking
- **i18n:** `useLocale()` / `ServerTrans` for user-facing strings
- **PR Constraints:** Max 5-7 files (excluding tests), max 500 lines, one focused change per PR
- **Migration Safety:** Additive-only columns with defaults, nullable columns, feature flag gating per `docs/migration/zero-downtime-strategy.mdx`

## Don't

- Don't add features not in design.md
- Don't skip tests — every epic needs behavioral parity test coverage
- Don't modify existing `v2021-10-20` webhook payload structures
- Don't rename/remove SchedulingType enum values or break backward compatibility
- Don't implement Meeting Polls or RR Fairness Visualization (see future-work.md)
- Don't modify Sprint 1 availability code unless a bug is discovered
- Don't add NOT NULL columns without defaults in migrations
- Don't exceed PR size constraints (5-7 files, 500 lines)
