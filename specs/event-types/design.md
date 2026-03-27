# Event Types (Sprint 2) Design

## Overview

Sprint 2 of the Calendly gap closure roadmap systematically closes behavioral gaps between Cal.com's event type system and Calendly's event type capabilities across 6 epics: ET-001 (1:1 Events), ET-002 (Group Events), ET-003 (Round-Robin), ET-004 (Collective), ET-005 (Booking Windows), and ET-006 (Custom Fields). Cal.com already exceeds Calendly with 6 scheduling paradigms (vs. Calendly's 4) and full programmatic API management — this sprint verifies and hardens parity for shared capabilities while preserving Cal.com advantages. All behavioral targets reference Calendly's API at [developer.calendly.com](https://developer.calendly.com); validation criteria ET-VAL-001 through ET-VAL-009 from `docs/sprint-roadmap/validation-criteria.mdx` serve as the acceptance gate.

**Per-Epic Validation Criteria Mapping:**
- **ET-001 (1:1 Events):** ET-VAL-001 (1:1 booking flow with correct host assignment)
- **ET-002 (Group Events):** ET-VAL-002 (group seat booking via `seatsPerTimeSlot`)
- **ET-003 (Round-Robin):** ET-VAL-003 (equitable round-robin distribution among team members)
- **ET-004 (Collective):** ET-VAL-004 (all-hosts-available simultaneous intersection)
- **ET-005 (Booking Windows):** ET-VAL-006 (booking window enforcement with availability integration)
- **ET-006 (Custom Fields):** ET-VAL-005 (custom field capture matching Calendly question types)
- **Cross-cutting (verified during Sprint 2):** ET-VAL-007 (location configuration), ET-VAL-008 (managed type propagation — Cal.com advantage), ET-VAL-009 (dynamic link resolution — Cal.com advantage)

## Problem Statement

Cal.com's gap report (`docs/gap-report/event-types.mdx`) identifies 2 gaps in the event type domain: ET-001 (Meeting Polls, Medium priority — deferred to `specs/event-types/future-work.md` as net-new functionality) and ET-002 (RR Fairness Cap Visualization, Low priority — deferred to `specs/event-types/future-work.md` as a UI enhancement). While Cal.com exceeds Calendly overall — offering 6 scheduling paradigms (one-on-one, group, round-robin, collective, managed, dynamic) versus Calendly's 4 types, plus full programmatic event type creation via API v2 — Sprint 2 ensures behavioral parity for all shared event type capabilities by verifying and hardening each scheduling paradigm against Calendly's documented behavior. The epic catalog (`docs/sprint-roadmap/epic-catalog.mdx`) defines 6 epics with a clear dependency graph: ET-001 depends on AV-001 (availability engine), ET-002/ET-003/ET-004/ET-006 depend on ET-001 (1:1 baseline), and ET-005 depends on AV-005 (booking window availability). Sprint 2 must pass Gate 2 validation across all 5 dimensions — behavioral testing, regression testing, data preservation, webhook compatibility, and cross-domain integration — before Sprint 3 (Calendar Integrations) can begin.

## User Stories

- **ET-001 (1:1 Events):** As a meeting host, I want to create a 1:1 event type so that a single invitee can book a meeting with me with correct host assignment and confirmation.
- **ET-002 (Group Events):** As a meeting host, I want to create a group event type with seat limits so that multiple attendees can book the same time slot up to the configured capacity.
- **ET-003 (Round-Robin):** As a team admin, I want round-robin event types to distribute bookings equitably among team members so that no single host is overwhelmed.
- **ET-004 (Collective):** As a team admin, I want collective event types to require all hosts to be available simultaneously so that team meetings only occur when everyone can attend.
- **ET-005 (Booking Windows):** As a meeting host, I want to configure booking windows (days into future, date range, or indefinitely) so that invitees can only book within my preferred time frame.
- **ET-006 (Custom Fields):** As a meeting host, I want to add custom booking fields (text, radio, checkbox, phone, dropdown) so that I can collect the information I need from invitees during booking.

## Technical Design

### Database Changes

All 6 epics are expected to require **zero schema changes** — Cal.com's existing Prisma schema already contains the necessary fields for full Calendly event type parity. Verification of existing schema fields is the primary database activity.

**ET-001 (1:1 Events):**

- No schema changes expected — one-on-one is the default event type when `schedulingType` is `null` on the `EventType` model.
- Verify existing fields: `userId` (host assignment), `title`, `slug`, `length`, `hidden`, `position`.
- Source: `packages/prisma/schema.prisma` (model EventType)

**ET-002 (Group Events):**

- No schema changes expected — group events are configured via existing fields: `seatsPerTimeSlot` (Int?), `seatsShowAttendees` (Boolean?), `seatsShowAvailabilityCount` (Boolean?).
- Verify the `BookingSeat` model handles seat occupancy correctly — each booking creates a `BookingSeat` record, and the slot remains available until `seatsPerTimeSlot` seats are filled.
- Source: `packages/prisma/schema.prisma` (model EventType, model BookingSeat)

**ET-003 (Round-Robin):**

- No schema changes expected — round-robin is configured via existing fields on the `EventType` model: `isRRWeightsEnabled` (Boolean, default: false), `rrSegmentQueryValue` (Json?), `assignRRMembersUsingSegment` (Boolean, default: false), `assignAllTeamMembers` (Boolean, default: false), `rescheduleWithSameRoundRobinHost` (Boolean, default: false), `includeNoShowInRRCalculation` (Boolean, default: false).
- Verify the `Host` model relation includes `weight` (Int?, application default: 100) and `priority` (Int?, application default: 2) fields for weighted round-robin distribution. These fields are nullable at the database level; defaults of 100 and 2 are applied at the application layer in the tRPC update handler.
- The `SchedulingType.ROUND_ROBIN` enum value (mapped to `"roundRobin"` in database) governs paradigm selection.
- Source: `packages/prisma/schema.prisma` (enum SchedulingType, model EventType, model Host)

**ET-004 (Collective):**

- No schema changes expected — collective scheduling uses `SchedulingType.COLLECTIVE` (mapped to `"collective"` in database) with the `hosts` relation on `EventType`.
- Verify fixed-host intersection logic in availability aggregation (`packages/features/availability/lib/getAggregatedAvailability/`) correctly computes the intersection of all hosts' availability schedules.
- All hosts defined via the `hosts` relation must be simultaneously available for a slot to be presented.
- Source: `packages/prisma/schema.prisma` (enum SchedulingType, model EventType)

**ET-005 (Booking Windows):**

- No schema changes expected — booking windows are configured via existing fields: `periodType` (PeriodType enum: `UNLIMITED`, `ROLLING`, `ROLLING_WINDOW`, `RANGE`), `periodDays` (Int?), `periodStartDate` (DateTime?), `periodEndDate` (DateTime?), `periodCountCalendarDays` (Boolean?), `minimumBookingNotice` (Int, default: 120).
- Verify `PeriodType` enum covers all Calendly equivalents:
  - Days into future = `ROLLING` / `ROLLING_WINDOW` (with `periodCountCalendarDays` distinguishing calendar vs. business days per AVL-GAP-001)
  - Date range = `RANGE` (using `periodStartDate` and `periodEndDate`)
  - Indefinitely = `UNLIMITED`
- Source: `packages/prisma/schema.prisma` (model EventType, enum PeriodType)

**ET-006 (Custom Fields):**

- No schema changes expected — custom fields are configured via the existing `bookingFields` (Json?) column on `EventType` and the legacy `customInputs` relation to the `EventTypeCustomInput` model.
- Verify Zod schema for `bookingFields` supports all Calendly question types: text, radio, checkbox, phone, and dropdown.
- The `bookingFields` JSON structure defines field type, label, required flag, options (for radio/checkbox/dropdown), and placeholder text.
- Source: `packages/prisma/schema.prisma` (model EventType, model EventTypeCustomInput)

**Migration Safety Note:**

If any schema additions are discovered as necessary during implementation, they must follow additive-only migration patterns from `docs/migration/zero-downtime-strategy.mdx`:

- Nullable columns with sensible defaults only — no NOT NULL columns without defaults
- No column renames, type changes, or column drops in the same deployment as code changes
- No enum value renames or removals from `SchedulingType`, `PeriodType`, or any other Prisma enum
- Migration SQL placed in `packages/prisma/migrations/[timestamp]_event_type_parity_fields/migration.sql`
- Each migration must include a rollback SQL script tested in staging
- Follow blue-green deployment approach: schema first, then application code, then backfill
- Per ADR-001 in `specs/event-types/decisions.md`: prefer existing dedicated columns over metadata-based approaches; use the `metadata` JSON field only for truly new flags that do not warrant a dedicated column

### API Changes

Sprint 2 focuses on **verification and alignment** of existing API surfaces across all 4 API layers. No new API endpoints are expected.

**tRPC Routes (`packages/trpc/server/routers/viewer/eventTypes/`):**

- Verify `viewer.eventTypes.create` — creation supports all 6 paradigms with correct Zod validation. The creation mutation must accept `schedulingType` (null for 1:1, ROUND_ROBIN, COLLECTIVE, MANAGED), `seatsPerTimeSlot` (for group events), host assignment configuration, and all booking window fields.
- Verify `viewer.eventTypes.update` — update handles paradigm-specific fields. Updates to `schedulingType`, `seatsPerTimeSlot`, round-robin weights/priorities, collective host lists, booking window configurations, and custom booking fields must all persist correctly.
- Verify `viewer.eventTypes.get` — retrieval returns enriched data for all paradigms via `packages/features/eventtypes/lib/getEventTypeById.ts`. The enrichment pipeline must correctly assemble host data, booking fields, metadata, and paradigm-specific configuration.
- Verify `viewer.eventTypes.list` — listing includes paradigm metadata. Each event type in the list response must indicate its scheduling paradigm and key configuration (seat count, host count, etc.).

**API v2 (`apps/api/v2/src/ee/event-types/`):**

- Verify POST/PATCH/GET/DELETE for event types support all 6 paradigms via the `event-types_2024_06_14` versioned module.
- Verify team event type routes (`apps/api/v2/src/modules/teams/event-types/`) correctly handle round-robin and collective event type CRUD flows, including host assignment and weight/priority configuration.
- Verify backward compatibility with the `event-types_2024_04_15` version — existing API consumers must not experience breaking changes.

**Platform SDK (`packages/platform/`):**

- Verify `packages/platform/libraries/event-types.ts` re-exports all necessary event type helpers for atom consumers.
- Verify atom types in `packages/platform/atoms/event-types/` cover all 6 paradigms — `AtomEventTypeListItem` and `AtomEventTypesResponse` types must include paradigm-discriminating fields.

**Webhook Compatibility (CRITICAL):**

- No changes to existing `v2021-10-20` webhook payloads are permitted.
- Verify `BOOKING_CREATED`, `BOOKING_RESCHEDULED`, and `BOOKING_CANCELLED` webhook events fire correctly for bookings made through all 6 event type paradigms.
- Verify `PayloadBuilderFactory` routing remains intact — all 20 `WebhookTriggerEvents` must continue mapping to their correct builder categories (booking, form, ooo, recording, meeting, instantMeeting, delegation).
- Verify the `V20211020BookingEventPayload` type with its legacy `assignmentReason` format is preserved exactly — no field removals, renames, or type changes.
- Rules per `docs/migration/webhook-compatibility.mdx`: existing payloads are immutable; new optional fields may be added (Rule R-1); `DEFAULT_WEBHOOK_VERSION` must remain `V_2021_10_20`.

### UI Changes

Sprint 2 UI work is primarily **verification and alignment** of existing components, with targeted modifications for booking window controls (ET-005).

**ET-001 — Event Type Creation (`packages/features/eventtypes/components/CreateEventTypeForm.tsx`):**

- Verify all 6 paradigm options are available in the creation flow: one-on-one (default, no explicit selection needed), group (via seats toggle when `seatsPerTimeSlot` is set), round-robin (`SchedulingType.ROUND_ROBIN`), collective (`SchedulingType.COLLECTIVE`), managed (`SchedulingType.MANAGED`, team admins only), and dynamic (ad-hoc links).
- Verify form validation uses Zod schemas from `packages/features/eventtypes/lib/schemas.ts` — all paradigm-specific fields must validate correctly on creation.

**ET-003 — Round-Robin Host Configuration (`packages/features/eventtypes/components/dialogs/HostEditDialogs.tsx`, `packages/features/eventtypes/components/WeightDescription.tsx`):**

- Verify host weight and priority editing UI for round-robin events — the host edit dialog must expose `weight` (integer, default 100) and `priority` (integer, default 2) controls.
- Verify the `WeightDescription` component accurately describes the distribution impact of weight values — higher weight means proportionally more bookings assigned.

**ET-004 — Collective Host Assignment (`packages/features/eventtypes/components/AssignAllTeamMembers.tsx`, `packages/features/eventtypes/components/CheckedTeamSelect.tsx`):**

- Verify the `AssignAllTeamMembers` toggle correctly assigns all team members as collective hosts when enabled.
- Verify `CheckedTeamSelect` multi-select allows individual host selection for collective events when the assign-all toggle is disabled.

**ET-005 — Booking Window Controls (`packages/features/eventtypes/components/tabs/limits/EventLimitsTab.tsx`):**

- Align booking window UI controls with Calendly's three booking window options:
  1. **Days into future** — maps to `periodType: ROLLING` or `ROLLING_WINDOW` with `periodDays` value; includes calendar vs. business day distinction via `periodCountCalendarDays` (per AVL-GAP-001 from `docs/gap-report/availability-scheduling.mdx`)
  2. **Date range** — maps to `periodType: RANGE` with `periodStartDate` and `periodEndDate` date pickers
  3. **Indefinitely** — maps to `periodType: UNLIMITED` (no restriction on future bookings)
- Verify the UI correctly maps user selections to the `periodType` enum values and associated fields.
- Verify `minimumBookingNotice` (minutes) input integrates correctly with the booking window to filter out slots that fall within the notice period.

**ET-006 — Booking Fields Configuration (Booking fields UI):**

- Verify booking field configuration supports all Calendly question types: text (free-form input), radio (single-select from options), checkbox (multi-select from options), phone (with international format validation), and dropdown (single-select from options list). Note: Calendly's "dropdown" type maps to Cal.com's `select` field type in `bookingFieldsManager.ts` (see `CALENDLY_FIELD_TYPE_MAP` at line 63–64). The design uses "dropdown" to match Calendly's terminology, but implementers should use `select` as the Cal.com internal type name.
- Verify field rendering on the booking page matches the configured field type — each field type must render the appropriate HTML input control.
- Verify the booking fields manager (`packages/features/eventtypes/lib/bookingFieldsManager.ts`) correctly normalizes field definitions for both new `bookingFields` JSON and legacy `customInputs`.

## Edge Cases

### ET-001 (1:1 Events)

- **Host with no connected calendars:** The event type should still be bookable with manual confirmation enabled (`requiresConfirmation: true`). The booking flow must not error when no external calendar is available to create the event.
- **Event type with `hidden: true`:** The event type must not appear in public profile listings but must remain bookable via its direct URL (`/{username}/{slug}`). The `getPublicEvent` resolver must still return the event type data when accessed directly.
- **Deleted or deactivated host:** If the `userId` references a deactivated user account, the event type should not show available slots. Existing bookings must remain accessible for cancellation/rescheduling.

### ET-002 (Group Events)

- **Seat limit exactly reached:** When `seatsPerTimeSlot` seats are filled, the (N+1)th booking attempt for that slot must be rejected with an appropriate capacity error. The slot must no longer appear as available on the booking page.
- **Cancellation of one attendee:** Canceling a single attendee's booking seat must free exactly one seat without affecting other attendees' bookings for the same slot. The slot should reappear as available if it was previously at capacity.
- **`seatsPerTimeSlot` set to 1:** The event must behave identically to a standard 1:1 event type — only one attendee can book the slot, and it becomes unavailable after booking.
- **Concurrent booking race condition:** Two attendees attempting to book the last available seat simultaneously — the system must handle this atomically, accepting one and rejecting the other.

### ET-003 (Round-Robin)

- **All RR hosts unavailable:** When no round-robin host has any available slots in the requested time range, the booking page must show no available slots rather than erroring.
- **Single host in RR pool:** With only one host assigned, the round-robin event type must behave like a 1:1 event type — all bookings go to the single host.
- **Host weight set to 0:** A host with weight 0 must never receive bookings through the round-robin distribution. The distribution algorithm must skip zero-weight hosts entirely.
- **Segment filter returning no hosts:** When `assignRRMembersUsingSegment` is enabled and `rrSegmentQueryValue` filters out all hosts, the booking page must show no available slots.
- **Host removed mid-distribution cycle:** Removing a host from the round-robin pool must not affect already-confirmed bookings assigned to that host. Future bookings must distribute only among remaining hosts.

### ET-004 (Collective)

- **One host unavailable:** If any single host in the collective group is unavailable for a time slot, the entire slot must be blocked. Availability is the strict intersection of all hosts' schedules.
- **Host added mid-week:** Adding a new host to a collective event type must not affect already-booked slots. Future slot calculations must include the new host's availability in the intersection.
- **All hosts share identical schedules:** When all collective hosts have the same availability, the intersection must equal the full shared schedule — no spurious slot reduction.
- **Host timezone differences:** Collective hosts in different timezones must have their availability correctly intersected in UTC before converting to the invitee's display timezone.

### ET-005 (Booking Windows)

- **`periodType: ROLLING` with `periodDays: 0`:** Zero rolling days must block all future bookings — no slots should be available.
- **`periodType: RANGE` with past `periodEndDate`:** When the end date is in the past, no slots should be available. The booking page must handle this gracefully without errors.
- **`minimumBookingNotice` exceeding event start time:** Slots where the current time plus `minimumBookingNotice` minutes exceeds the slot start time must be filtered out of available slots.
- **`periodCountCalendarDays: false` (business days):** When counting business days, weekends and configured holidays must be excluded from the rolling window calculation.
- **Timezone boundary for rolling windows:** The rolling window calculation must use the invitee's timezone to determine which calendar dates fall within the window.

### ET-006 (Custom Fields)

- **Required custom field left empty:** A booking submission with an empty required field must be blocked with a validation error. The form must not submit until all required fields have values.
- **Phone field with international format:** Phone fields must accept and validate international phone numbers (E.164 format). The input should support country code selection.
- **Dropdown with single option:** A dropdown field with only one option must render correctly and not auto-select the option unless configured to do so.
- **HTML injection in text fields:** Text field values must be sanitized to prevent XSS. Raw HTML submitted in text fields must be escaped before storage and display.
- **Maximum field count:** The system must handle event types with many custom fields (10+) without UI degradation or form submission failures.

## Out of Scope

The following items are explicitly excluded from Sprint 2 per the scope boundaries defined in the Agent Action Plan:

- **Sprint 1 (Availability & Scheduling) rework:** Sprint 1 must already be complete with Gate 1 passed. No availability engine modifications are in scope unless bugs are discovered during event type validation.
- **Sprint 3+ feature domains:** Calendar Integrations (F-003), Webhooks (F-013), Routing Forms (F-015), Embed (F-008), Admin/Teams (F-009), and Notifications (F-018) are all out of scope for Sprint 2.
- **Meeting Polls (ET-001 gap from gap report):** The gap report identifies Meeting Polls as a Medium priority gap representing net-new functionality. This is deferred to `specs/event-types/future-work.md`.
- **RR Fairness Cap Visualization (ET-002 gap from gap report):** Low priority UI enhancement for round-robin distribution analytics. Deferred to `specs/event-types/future-work.md`.
- **Performance optimizations:** No performance tuning beyond what is required for correct parity behavior.
- **Structural refactoring:** No refactoring of existing code unrelated to parity alignment.
- **New webhook payload versions:** No new `PayloadBuilderFactory` versions. Only verification of backward compatibility for existing `v2021-10-20` payloads.
- **Email/SMS template changes:** Notification content changes are out of scope (Sprint 8 — Notifications F-018).
- **Embed behavior changes:** Embed rendering changes are out of scope (Sprint 6 — Embed F-008).
- **Admin/team governance changes:** Role model and team routing changes are out of scope (Sprint 7 — Admin/Teams F-009).
