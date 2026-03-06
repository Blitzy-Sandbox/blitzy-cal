# CLAUDE.md — Event Types (Sprint 2)

## Project Context

This is Sprint 2 of the Calendly gap closure roadmap for Cal.com's open-source scheduling platform. The focus is closing all identified behavioral gaps between Cal.com's event type system and Calendly's event type capabilities. Sprint 2 covers 6 epics: ET-001 (1:1 Events), ET-002 (Group Events), ET-003 (Round-Robin Distribution), ET-004 (Collective Scheduling), ET-005 (Booking Windows), and ET-006 (Custom Fields/Questions). This sprint depends on Sprint 1 (Availability & Scheduling, F-004) having passed Gate 1 — the availability engine must produce correct results before event type slot generation, buffer enforcement, and booking windows can be validated.

## Before Starting Work

1. Read `specs/event-types/design.md` for the comprehensive design spec
2. Check `specs/event-types/implementation.md` for current progress on ET-001 through ET-006
3. Review `docs/gap-report/event-types.mdx` for the full gap analysis
4. Review `docs/sprint-roadmap/validation-criteria.mdx` for acceptance criteria (ET-VAL-001 through ET-VAL-009)
5. Look at existing patterns in:
   - `packages/features/eventtypes/` — Core event type feature module
   - `packages/features/ee/round-robin/` — Enterprise round-robin distribution
   - `packages/features/availability/` — Upstream availability integration
   - `packages/prisma/schema.prisma` — EventType model and SchedulingType enum

## Code Patterns

- Use `@evyweb/ioctopus` for dependency injection — follow DI container patterns in `packages/features/di/`
- Use Prisma repositories for database access — never query Prisma directly from service/UI layers
- Use Zod schemas for input validation — validate at the API boundary; parse metadata with `EventTypeMetaDataSchema`
- Use `@calcom/dayjs` for all date/time operations — never use native `Date` or raw `dayjs`
- Use Vitest for tests — follow existing patterns with `vi.mock` for Prisma mocking
- Use `useLocale()` / `ServerTrans` for all user-facing strings — maintain i18n compliance
- Follow PR size constraints: max 5–7 files changed (excluding tests), max 500 lines, one focused change per PR

## Don't

- Don't add features not in design.md
- Don't skip tests — every behavioral change needs a corresponding parity test
- Don't modify `v2021-10-20` webhook payload structures — backward compatibility is mandatory
- Don't rename or remove enum values from `SchedulingType` or any other Prisma enum
- Don't add NOT NULL columns without defaults in schema migrations
- Don't implement Meeting Polls (deferred to future-work.md)
- Don't implement RR Fairness Cap Visualization (deferred to future-work.md)
- Don't modify Sprint 1 (Availability) code unless bugs are discovered during validation
