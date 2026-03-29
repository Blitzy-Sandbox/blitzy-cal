# Webhooks and Events Implementation

## Status: not-started

## Completed

## In Progress

## Blocked

## Next Steps

1. Create spec artifacts — `specs/webhooks-events/` folder with design.md, implementation.md, decisions.md, CLAUDE.md, prompts.md, future-work.md, and docs/README.md
2. WH-001: Verify and extend TRIGGER_TO_BUILDER_CATEGORY mapping in `PayloadBuilderFactory.ts` for `BOOKING_CREATED` → `invitee.created` semantic alignment
3. WH-002: Verify and extend `BOOKING_CANCELLED` payload alignment with Calendly's `invitee.canceled` semantics in v2021-10-20 builders
4. WH-003: Verify `FORM_SUBMITTED` webhook payload aligns with Calendly's `routing_form_submission.created` event structure
5. WH-004: Extend `BookingCreatedDTO` and `BookingCancelledDTO` in `packages/features/webhooks/lib/dto/types.ts` with Calendly-equivalent additive fields (UTM tracking parameters, reschedule URI references)
6. WH-004: Align payload structure in v2021-10-20 builders — add Calendly-equivalent fields while preserving existing payload shape exactly
7. WH-005: Evaluate need for new `v2025-01-01` version registration — decide via ADR in `decisions.md`
8. WH-005: If new version needed, register in `registry.ts`, add version labels in `constants.ts`, extend `WebhookVersion` enum in `IWebhookRepository.ts`
9. Extend test suite in `BaseBookingPayloadBuilder.test.ts` with Calendly-mapping regression tests for all modified trigger events
10. Update `docs/gap-report/webhooks-events.mdx` with gap closure evidence
11. Update `docs/sprint-roadmap/epic-catalog.mdx` to mark WH-001 through WH-005 as completed
12. Record validation evidence in `docs/sprint-roadmap/validation-criteria.mdx` for WH-VAL criteria (11 criteria)

## Session Notes
