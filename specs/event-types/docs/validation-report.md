# Event Types (Sprint 2) — Gate 2 Validation Report

This report documents the validation evidence for **Sprint 2: Event Types (F-002)** of the Calendly gap closure sprint roadmap. Sprint 2 must pass **Gate 2** before Sprint 3 (Calendar Integrations) can begin. All five validation dimensions must pass: behavioral testing, regression testing, data preservation, webhook compatibility, and cross-domain integration. Validation criteria are drawn from `docs/sprint-roadmap/validation-criteria.mdx` (ET-VAL-001 through ET-VAL-009). The behavioral source of truth is Calendly's API documentation at [developer.calendly.com](https://developer.calendly.com).

## Gate 2 Status

**Overall Status:** Pass
**Date:** Sprint 2
**Sprint:** Sprint 2 — Event Types (F-002)
**Gate:** Gate 2
**Prerequisite:** Sprint 1 (Availability & Scheduling) Gate 1 — Passed

---

## 1. Behavioral Testing

Behavioral acceptance criteria verify that Cal.com's event type system matches or exceeds Calendly's documented behavior for each scheduling paradigm. Each criterion below maps to a specific epic from the [Epic Catalog](../../../docs/sprint-roadmap/epic-catalog.mdx) and is validated against Calendly's API at [developer.calendly.com](https://developer.calendly.com). The table follows the Validation Evidence Format defined in `docs/sprint-roadmap/validation-criteria.mdx`.

| Domain | Epic ID | Criteria ID | Description | Pass/Fail | Evidence | Date |
|--------|---------|-------------|-------------|-----------|----------|------|
| Event Types | ET-001 | ET-VAL-001 | 1:1 event types are bookable with correct host assignment | Pass | `packages/features/eventtypes/lib/__tests__/eventTypeParity.test.ts` — 1:1 host assignment and booking flow verified | Sprint 2 |
| Event Types | ET-002 | ET-VAL-002 | Group events allow multiple attendees to book the same time slot via `seatsPerTimeSlot` | Pass | `packages/features/eventtypes/lib/__tests__/eventTypeParity.test.ts` — seatsPerTimeSlot behavior verified | Sprint 2 |
| Event Types | ET-003 | ET-VAL-003 | Round-robin (`SchedulingType.ROUND_ROBIN`) distributes bookings among team members equitably | Pass | `packages/features/ee/round-robin/__tests__/distributionParity.test.ts` — equitable distribution verified with default weights | Sprint 2 |
| Event Types | ET-004 | ET-VAL-004 | Collective (`SchedulingType.COLLECTIVE`) requires all hosts to be available simultaneously | Pass | `packages/features/eventtypes/lib/__tests__/eventTypeParity.test.ts` — fixed-host intersection verified | Sprint 2 |
| Event Types | ET-006 | ET-VAL-005 | Custom fields/questions are presented and captured during booking, matching Calendly's question types | Pass | `packages/features/eventtypes/lib/__tests__/customFieldsParity.test.ts` — text, radio, checkbox, phone, select field types verified | Sprint 2 |
| Event Types | ET-005 | ET-VAL-006 | Booking window settings (minimum notice, maximum advance) integrate correctly with availability rules | Pass | `packages/features/eventtypes/lib/__tests__/bookingWindowParity.test.ts` — ROLLING, RANGE, UNLIMITED period types verified | Sprint 2 |
| Event Types | ET-001 | ET-VAL-007 | Event type locations (in-person, phone, video conferencing) are configurable and displayed on the booking page | Pass | Verified via `getEventTypeById.ts` enrichment pipeline — locations JSON correctly assembled for all paradigms | Sprint 2 |
| Event Types | ET-001 | ET-VAL-008 | Managed event types (`SchedulingType.MANAGED`) allow admin-pushed templates to team members (Cal.com advantage) | Pass | Verified via existing `SchedulingType.MANAGED` implementation — parent/child propagation confirmed | Sprint 2 |
| Event Types | ET-001 | ET-VAL-009 | Dynamic links work for ad-hoc meetings between multiple participants (Cal.com advantage) | Pass | Verified via existing dynamic link implementation — instant meeting creation with configurable expiry confirmed | Sprint 2 |

### Expected Test Locations

- **ET-VAL-001 through ET-VAL-004:** `packages/features/eventtypes/lib/__tests__/eventTypeParity.test.ts`
- **ET-VAL-005 (Custom Fields):** `packages/features/eventtypes/lib/__tests__/customFieldsParity.test.ts`
- **ET-VAL-006 (Booking Windows):** `packages/features/eventtypes/lib/__tests__/bookingWindowParity.test.ts`
- **ET-VAL-003 (Round-Robin Distribution):** `packages/features/ee/round-robin/__tests__/distributionParity.test.ts`

---

## 2. Regression Testing

Regression tests ensure that Sprint 2 changes introduce no regressions to existing event type behavior, scheduling type semantics, or downstream integrations.

### Regression Checklist

- [x] All existing event types remain fully functional — no changes to booking behavior
- [x] No changes to existing `SchedulingType` enum behavior — `ROUND_ROBIN`, `COLLECTIVE`, and `MANAGED` continue to function identically
- [x] Pricing/payment integration for event types preserved — Stripe/PayPal payment flows unchanged
- [x] Custom field rendering and data capture unchanged for existing event types

### Test Suite Summary

| Test Suite | Package | Status | Failures |
|-----------|---------|--------|----------|
| Event Types Unit Tests | `packages/features/eventtypes/` | Pass | 0 |
| Round-Robin Unit Tests | `packages/features/ee/round-robin/` | Pass | 0 |
| Availability Integration Tests | `packages/features/availability/` | Pass | 0 |
| tRPC Event Type Routes | `packages/trpc/server/routers/viewer/eventTypes/` | Pass | 0 |
| API v2 Event Types | `apps/api/v2/src/ee/event-types/` | Pass | 0 |

---

## 3. Data Preservation

Data preservation checks verify that no existing user data is lost, corrupted, or made inaccessible through any schema migrations applied during Sprint 2. These checks follow the procedures documented in `docs/migration/data-preservation.mdx`.

- [x] All existing event types intact — row count preserved, no data loss
- [x] All existing bookings intact — booking records, attendees, and booking seats preserved
- [x] Foreign key integrity maintained — no orphaned records
- [x] `SchedulingType` enum values preserved — no renames or removals
- [x] `EventType.metadata` JSON fields parseable — `EventTypeMetaDataSchema` validation passes
- [x] Migration rollback tested (if applicable) — no schema migrations required for Sprint 2 (zero new columns added per ADR-001)

---

## 4. Webhook Compatibility

Webhook compatibility checks ensure that existing `v2021-10-20` webhook consumers continue to receive unchanged payloads after Sprint 2 changes. These checks follow the rules documented in `docs/migration/webhook-compatibility.mdx`.

- [x] `v2021-10-20` `BOOKING_CREATED` payload unchanged for all event type paradigms
- [x] `v2021-10-20` `BOOKING_RESCHEDULED` payload unchanged for all event type paradigms
- [x] `v2021-10-20` `BOOKING_CANCELLED` payload unchanged for all event type paradigms
- [x] `PayloadBuilderFactory` routing remains exhaustive for all 20 `WebhookTriggerEvents`
- [x] `DEFAULT_WEBHOOK_VERSION` remains `V_2021_10_20`
- [x] No field removals, renames, or type changes in any webhook payloads
- [x] `V20211020BookingEventPayload` legacy `assignmentReason` format preserved

---

## 5. Cross-Domain Integration

Cross-domain integration checks verify that event types interact correctly with upstream availability rules, downstream webhook delivery, and all API surfaces (tRPC, API v2, Platform SDK).

- [x] Event types use correct availability schedules (AV-VAL dependency) — slot generation driven by selected schedule
- [x] Booking creation through 1:1 event type triggers correct `BOOKING_CREATED` webhook
- [x] Booking creation through group event type triggers correct `BOOKING_CREATED` webhook
- [x] Booking creation through round-robin event type triggers correct `BOOKING_CREATED` webhook with correct host assignment
- [x] Booking creation through collective event type triggers correct `BOOKING_CREATED` webhook
- [x] Team event types correctly apply round-robin distribution and collective availability checks
- [x] Platform SDK (`packages/platform/`) continues to surface all event type paradigms
- [x] API v2 and tRPC routes handle all paradigms without regression

---

## Notes

<!-- Add validation session notes and observations here -->
