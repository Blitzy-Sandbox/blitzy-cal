# Event Types (Sprint 2) Future Work

Ideas and enhancements deferred from Sprint 2 event type parity implementation.

## Enhancements

- **Meeting Polls (ET-001 gap)** — Medium priority gap identified in `docs/gap-report/event-types.mdx`. Meeting polls represent net-new functionality rather than behavioral parity with Calendly. Cal.com does not currently have a meeting poll feature equivalent to Calendly's polling workflow where an organizer proposes multiple candidate times and invitees vote on preferred slots. This is deferred because Sprint 2 focuses exclusively on closing existing behavioral gaps in the six scheduling paradigms, not adding new capabilities that Calendly offers but Cal.com has never implemented.

- **RR Fairness Cap Visualization (ET-002 gap)** — Low priority UI enhancement identified in `docs/gap-report/event-types.mdx`. An analytics dashboard showing round-robin distribution fairness across hosts would provide visibility into how equitably bookings are distributed among team members over time. Deferred as a cosmetic enhancement not required for behavioral parity — the underlying round-robin distribution algorithm achieves equitable assignment without a visualization layer.

- **Performance Optimizations** — No performance tuning beyond what is required for correct parity behavior is included in Sprint 2. Performance improvements to event type queries, slot generation for large seat counts, or round-robin distribution calculations across teams with many hosts can be addressed in future sprints once behavioral correctness is fully validated.

## Technical Debt

- **Event type paradigm consolidation** — The 6 scheduling paradigms (one-on-one, group, round-robin, collective, managed, dynamic) are governed by a mix of enum values (`SchedulingType`), configuration fields (`seatsPerTimeSlot`), and runtime behavior (dynamic links via URL patterns). A future refactoring could provide a more unified paradigm abstraction that encapsulates paradigm detection, validation, and behavior behind a single discriminated type or strategy pattern, reducing the scattered conditional logic across the booking and availability pipelines.

- **Booking field type normalization** — The `bookingFields` JSON column and the legacy `customInputs` system coexist in the `EventType` model. The `bookingFields` approach is the modern path forward, but `customInputs` remains for backward compatibility. A future migration could consolidate both into a single flexible field system, removing the dual-path normalization logic in `bookingFieldsManager.ts` and simplifying the booking form rendering pipeline.

## Nice to Have

- **Paradigm-specific analytics** — Dashboard showing booking distribution and utilization per event type paradigm (one-on-one, group, round-robin, collective, managed, dynamic). This would help team administrators understand which scheduling paradigms are most used and optimize their event type configurations accordingly.

- **Advanced RR distribution strategies** — Additional distribution algorithms beyond the current weight/priority-based round-robin (e.g., least-recent-booking assignment, skill-based routing using host metadata, timezone-affinity matching to pair invitees with hosts in similar timezones). These strategies would extend `SchedulingType.ROUND_ROBIN` without replacing the existing equitable distribution logic.

- **Group event waitlist** — Allow attendees to join a waitlist when all seats for a time slot are filled, with automatic booking if a seat opens due to cancellation. This would improve the group event experience for popular time slots and reduce the need for organizers to manually manage overflow demand.
