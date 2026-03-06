# Event Types (Sprint 2) Implementation

## Status: in-progress

## Completed

- Spec-first design artifacts created (`specs/event-types/` folder populated from `specs/_templates/`)
- Gap analysis reviewed (`docs/gap-report/event-types.mdx`)
- Validation criteria identified (ET-VAL-001 through ET-VAL-009 from `docs/sprint-roadmap/validation-criteria.mdx`)
- ADRs documented (ADR-001: Schema vs. Metadata, ADR-002: RR Fairness Approach)

## In Progress

- **ET-001 — 1:1 Event Type Behavioral Parity (Medium, M):** Verify one-on-one event types produce correct bookable flows with single host, single invitee, host assignment, and confirmation workflow. Key files: `packages/features/eventtypes/lib/getEventTypeById.ts`, `packages/features/eventtypes/lib/getPublicEvent.ts`
- **ET-002 — Group Event Type Parity via seatsPerTimeSlot (Medium, M):** Verify group event behavior where multiple attendees book the same time slot up to seat limit. Key files: `packages/features/schedules/lib/slots.ts`, EventType `seatsPerTimeSlot` field
- **ET-003 — Round-Robin Distribution Parity (High, L):** Audit and align RR distribution logic including weight/priority handling and segment-based filtering. Key files: `packages/features/ee/round-robin/**/*.ts`, `packages/features/availability/lib/getAggregatedAvailability/`
- **ET-004 — Collective Scheduling Parity (Medium, M):** Verify COLLECTIVE type requires all hosts simultaneously available. Key files: `packages/features/availability/lib/getAggregatedAvailability/getAggregatedAvailability.ts`
- **ET-005 — Booking Window Configuration Alignment (Medium, S):** Verify booking window settings match Calendly's options (days into future, date range, indefinitely). Key files: `packages/features/eventtypes/components/tabs/limits/EventLimitsTab.tsx`
- **ET-006 — Custom Fields/Questions Parity (Low, M):** Verify booking field types match Calendly's question types (text, radio, checkbox, phone, dropdown). Key files: `packages/features/eventtypes/lib/bookingFieldsManager.ts`

## Blocked

- Sprint 2 depends on Sprint 1 (Availability & Scheduling, F-004) passing Gate 1. If Gate 1 is not passed, all event type epics are blocked.

## Next Steps

1. Begin ET-001 verification: Audit `getEventTypeById.ts` enrichment pipeline for 1:1 event types
2. Create behavioral parity test suite: `packages/features/eventtypes/lib/__tests__/eventTypeParity.test.ts`
3. Begin ET-003 audit: Review round-robin distribution in `packages/features/ee/round-robin/`
4. Create RR distribution test suite: `packages/features/ee/round-robin/__tests__/distributionParity.test.ts`
5. Begin ET-005 alignment: Review `EventLimitsTab.tsx` booking window controls
6. Create booking window test suite: `packages/features/eventtypes/lib/__tests__/bookingWindowParity.test.ts`
7. Begin ET-006 audit: Review `bookingFieldsManager.ts` for custom field type coverage
8. Create custom fields test suite: `packages/features/eventtypes/lib/__tests__/customFieldsParity.test.ts`
9. Run Gate 2 validation across all five dimensions (behavioral, regression, data preservation, webhook compatibility, cross-domain integration)
10. Update `docs/gap-report/event-types.mdx` and `docs/sprint-roadmap/epic-catalog.mdx` with completion status

## Session Notes

<!-- Add notes from each working session here for continuity -->
