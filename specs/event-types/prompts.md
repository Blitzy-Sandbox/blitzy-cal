# Event Types (Sprint 2) Prompts

## Sync Implementation Status

Review what's been implemented for event types and update specs/event-types/implementation.md. Check status of all 6 epics: ET-001 (1:1 Events), ET-002 (Group Events), ET-003 (Round-Robin), ET-004 (Collective), ET-005 (Booking Windows), ET-006 (Custom Fields).

## Generate Tests

Write Vitest parity tests for event types. Follow existing test patterns in packages/features/eventtypes/. Generate tests covering:
- ET-VAL-001: 1:1 event type bookability and host assignment
- ET-VAL-002: Group event seatsPerTimeSlot behavior
- ET-VAL-003: Round-robin equitable distribution
- ET-VAL-004: Collective simultaneous availability
- ET-VAL-005: Custom field type coverage (text, radio, checkbox, phone, dropdown)
- ET-VAL-006: Booking window settings integration
Use vi.mock for Prisma mocking. Place tests in packages/features/eventtypes/lib/__tests__/ and packages/features/ee/round-robin/__tests__/.

## Code Review

Review changes for: type safety, error handling, security, edge cases. Additionally verify:
- Webhook backward compatibility (v2021-10-20 payloads unchanged)
- Zero-downtime migration compliance (additive-only columns)
- SchedulingType enum preservation
- PR size constraints (5-7 files, ≤500 lines, single change)
- All behavioral changes have corresponding parity tests

## Continue Feature

Continue working on event types. Read specs/event-types/implementation.md for current status of ET-001 through ET-006. Check specs/event-types/decisions.md for any architectural decisions made.

## Generate Docs with Screenshots

Generate documentation for event types with screenshots:

1. Open the event type configuration UI in the browser
2. Take screenshots of key UI states: creation form (all paradigm options), booking window config, custom fields builder, round-robin host editing, collective host selection
3. Save screenshots to specs/event-types/docs/screenshots/
4. Create/update specs/event-types/docs/README.md with:
   - Feature overview covering all 6 scheduling paradigms
   - How to use (step-by-step with screenshots for each paradigm)
   - Configuration options (booking windows, custom fields, seats, RR weights)
   - Common use cases (1:1 meetings, group sessions, team round-robin, collective scheduling)

## Promote Docs to Public

Promote internal docs to public Mintlify docs:

1. Review specs/event-types/docs/README.md
2. Copy/adapt content to docs/event-types.mdx (Mintlify format)
3. Move screenshots to docs/images/event-types/
4. Update docs/mint.json navigation
5. Ensure customer-appropriate language (no internal details, no gap closure references)
