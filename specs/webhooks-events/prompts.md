# Webhooks & Events Prompts

## Sync Implementation Status

Review what's been implemented for webhooks-events and update specs/webhooks-events/implementation.md

Specifically check progress on:

- **WH-001**: `invitee.created` event mapping — check `PayloadBuilderFactory.ts` `TRIGGER_TO_BUILDER_CATEGORY` mapping for `BOOKING_CREATED`, verify the v2021-10-20 `BookingPayloadBuilder` produces payloads semantically aligned with Calendly's `invitee.created` event (inline attendee details, event metadata, scheduling context)
- **WH-002**: `invitee.canceled` event mapping — check `BOOKING_CANCELLED` payload alignment in v2021-10-20 builders, verify cancellation reason field presence, confirm `BOOKING_RESCHEDULED` fires a dedicated event with reschedule context rather than Calendly's cancel-plus-rebook pattern
- **WH-003**: `routing_form_submission.created` parity — check `FORM_SUBMITTED` webhook payload structure in `FormPayloadBuilder`, verify form ID, form name, response ID, and response data fields match Calendly's `routing_form_submission.created` semantics
- **WH-004**: Payload structure alignment — check `BookingCreatedDTO`, `BookingCancelledDTO`, `BookingRescheduledDTO` for Calendly-equivalent fields (UTM tracking parameters: `utmSource`, `utmMedium`, `utmCampaign`, `utmTerm`, `utmContent`; reschedule URI references; invitee timezone), verify additive-only changes to `V20211020BookingEventPayload`
- **WH-005**: Webhook versioning strategy — check `registry.ts` for new version registration (e.g., `v2025-01-01`), check `constants.ts` for updated version labels and documentation URLs, check `IWebhookRepository.ts` for `WebhookVersion` enum extension, verify `DEFAULT_WEBHOOK_VERSION` remains `V_2021_10_20`

## Generate Tests

Write tests for webhook payload builders and event mapping. Follow existing test patterns in `packages/features/webhooks/lib/factory/base/BaseBookingPayloadBuilder.test.ts`.

Target test files to create or extend:

- `packages/features/webhooks/lib/factory/versioned/PayloadBuilderFactory.test.ts` — Extended trigger-to-builder mapping tests verifying every `WebhookTriggerEvents` enum value routes to the correct `BuilderCategory` via `TRIGGER_TO_BUILDER_CATEGORY`
- `packages/features/webhooks/lib/factory/base/BaseBookingPayloadBuilder.test.ts` — Calendly-mapping regression tests confirming `BOOKING_CREATED`, `BOOKING_CANCELLED`, and `BOOKING_RESCHEDULED` payloads contain all expected fields for Calendly parity
- `packages/features/webhooks/lib/dto/types.test.ts` — DTO validation tests for any new optional fields added to `BookingCreatedDTO`, `BookingCancelledDTO`, and `FormSubmittedDTO`

Test coverage areas:

- `BOOKING_CREATED` → `invitee.created` semantic alignment: verify payload includes attendee name, email, timezone, event title, start/end time, location, and event type metadata
- `BOOKING_CANCELLED` → `invitee.canceled` semantic alignment: verify payload includes cancellation reason, cancelled-by context, and original booking reference
- `BOOKING_RESCHEDULED` → `invitee.created` with reschedule context: verify payload includes previous booking UID, old start/end times, reschedule reason, and rescheduled-by context
- `FORM_SUBMITTED` → `routing_form_submission.created` alignment: verify payload includes form ID, form name, response ID, response data with field values, and matched event type reference
- v2021-10-20 payload backward compatibility: snapshot tests confirming zero field removals, zero field renames, zero type changes — compare current payload output against known-good baseline
- HMAC-SHA256 signing integrity preservation: verify `createWebhookSignature` produces correct `X-Cal-Signature-256` header values with known secret/payload pairs, including the `no-secret-provided` fallback
- New version registration via `PayloadBuilderFactory.registerVersion()`: verify new versions can be registered and resolved without affecting existing version resolution, verify fallback to `DEFAULT_WEBHOOK_VERSION` when unknown version is requested
- `TRIGGER_TO_BUILDER_CATEGORY` exhaustiveness: verify the mapping covers all 20 `WebhookTriggerEvents` enum values with no gaps, leveraging TypeScript's `Record<WebhookTriggerEvents, BuilderCategory>` compile-time check
- `WebhookNotificationHandler` orchestration: verify subscriber discovery, payload construction, and webhook processing lifecycle for booking, form, and meeting trigger events
- Handlebars custom template rendering: verify templates using `{{triggerEvent}}`, `{{payload.uid}}`, `{{payload.attendees[0].email}}` render correctly with new optional fields present and absent

## Code Review

Review changes for:

- **Type safety**: Strict TypeScript types for all webhook DTOs (`BookingCreatedDTO`, `BookingCancelledDTO`, `BookingRescheduledDTO`, `FormSubmittedDTO`), payload builder interfaces (`IBookingPayloadBuilder`, `IFormPayloadBuilder`, and all 7 builder interfaces), version enums (`WebhookVersion`), and the `TRIGGER_TO_BUILDER_CATEGORY` exhaustive mapping typed as `Record<WebhookTriggerEvents, BuilderCategory>`
- **Error handling**: Graceful fallback to `DEFAULT_WEBHOOK_VERSION` when unknown version is requested in `PayloadBuilderFactory.getBuilderSet()`, proper error context logging in `WebhookNotificationHandler` (trigger event, booking ID, event type ID), error re-throw for upstream handling, dry-run mode bypass
- **Security**: HMAC-SHA256 signing preservation via `createWebhookSignature` in `sendPayload.ts`, no credential leakage in webhook payloads or server logs, `no-secret-provided` fallback when secret is not configured, webhook secret not exposed in error messages or debug output
- **Edge cases**: Unknown trigger events in `TRIGGER_TO_BUILDER_CATEGORY` (compile-time enforced), unregistered versions falling back to default, dry-run mode skipping notification dispatch, empty subscriber lists returning early without error, Zapier-specific payload formatting, `TASKER_ENABLE_WEBHOOKS` toggle between sync and async delivery

Webhook-specific review items:

- **v2021-10-20 backward compatibility**: Confirm the existing `V20211020BookingEventPayload` type definition is unchanged — the legacy `assignmentReason` format `[{ reasonEnum, reasonString }]` is preserved, no existing fields in `EventPayloadType` (uid, metadata, bookingId, status, reschedule info, payment info) are removed, renamed, or have their types changed
- **Additive-only changes**: Verify any new DTO fields (UTM tracking parameters, reschedule URI references) are typed as optional (`?`) and backward-compatible — existing consumers that do not expect new fields will ignore them during JSON deserialization
- **WebhookTriggerEvents enum stability**: Verify no existing enum values in the Prisma `WebhookTriggerEvents` enum are reordered, removed, or renamed — new values are appended only, following additive-only Prisma enum extension rules
- **Handlebars template safety**: Ensure custom payload templates configured on webhook subscriptions still render correctly when new optional fields are present or absent — verify Handlebars does not throw on undefined optional variables
- **HTTP header integrity**: Confirm `X-Cal-Webhook-Version` and `X-Cal-Signature-256` headers continue to be sent on every delivery with correct values, including for new trigger events and new payload versions
- **PayloadBuilderSet completeness**: Verify any new registered version provides all 7 required builders (`booking`, `form`, `ooo`, `recording`, `meeting`, `instantMeeting`, `delegation`) — the `PayloadBuilderSet` interface enforces this at compile time
- **Cross-domain impact**: Confirm webhook changes do not break the `FORM_SUBMITTED` event for routing forms, the booking lifecycle events shared with notification dispatch, or team/organization-scoped subscriber discovery

## Continue Feature

Continue working on webhooks-events. Read specs/webhooks-events/implementation.md for current status.

Key directories to reference:

- `packages/features/webhooks/lib/factory/versioned/` — `PayloadBuilderFactory.ts` (version-aware factory with `TRIGGER_TO_BUILDER_CATEGORY` mapping), `registry.ts` (composition root and version registration), v2021-10-20 builders (7 builder implementations preserving legacy payload format)
- `packages/features/webhooks/lib/factory/base/` — `BaseBookingPayloadBuilder.ts` (base booking payload builder), `BaseBookingPayloadBuilder.test.ts` (existing regression test suite — must pass after all changes)
- `packages/features/webhooks/lib/dto/` — `types.ts` (all webhook DTO types: `BaseEventDTO`, `BookingCreatedDTO`, `BookingCancelledDTO`, `BookingRescheduledDTO`, `FormSubmittedDTO`, and 15+ specialized DTOs)
- `packages/features/webhooks/lib/service/` — `WebhookNotificationHandler.ts` (notification orchestrator: subscriber discovery → payload construction → webhook processing), `WebhookService.ts` (subscriber queries and webhook dispatch)
- `packages/features/webhooks/lib/interface/` — `IWebhookRepository.ts` (`WebhookVersion` enum, `DEFAULT_WEBHOOK_VERSION`, `VALID_WEBHOOK_VERSIONS`, `isValidWebhookVersion()`, `parseWebhookVersion()`)
- `packages/features/webhooks/lib/constants.ts` — Version labels, trigger-to-group mappings, documentation URLs
- `packages/features/webhooks/lib/sendPayload.ts` — Payload dispatch with HMAC-SHA256 signing (`createWebhookSignature`), Handlebars template compilation, Zapier integration, `X-Cal-Signature-256` and `X-Cal-Webhook-Version` headers
- `packages/features/webhooks/lib/sendOrSchedulePayload.ts` — Synchronous/async delivery toggle based on `TASKER_ENABLE_WEBHOOKS` environment variable
- `packages/features/bookings/lib/getWebhookPayloadForBooking.ts` — Booking-to-webhook payload transformer that merges event type metadata with calendar event data
- `packages/prisma/schema.prisma` — `WebhookTriggerEvents` enum (20 events), `Webhook` model (subscription entity with `version`, `secret`, `payloadTemplate` fields)
- `specs/webhooks-events/design.md` — Design specification (source of truth for Sprint 4 architecture and decisions)
- `specs/webhooks-events/decisions.md` — Architecture Decision Records (versioning strategy, backward compatibility rationale, UTM field placement)
- `docs/gap-report/webhooks-events.mdx` — Full Calendly-vs-Cal.com webhook comparison with gap inventory (WH-001 through WH-005)
- `docs/migration/webhook-compatibility.mdx` — Backward compatibility guide: additive payload field rules, version extension patterns, consumer migration path, rollback procedures

## Generate Docs with Screenshots

Generate documentation for webhooks-events with screenshots:

1. Open the webhook settings page (`/settings/developer/webhooks`) in the browser
2. Take screenshots of key UI states:
   - Webhook subscription list showing active subscriptions with trigger event badges and version indicators
   - Webhook subscription creation dialog with trigger event multi-select (showing all 20 available trigger events)
   - Webhook version selector dropdown (showing `v2021-10-20` and any new registered versions)
   - Webhook secret configuration field with HMAC signing explanation
   - Custom payload template editor (Handlebars template input with variable reference)
   - Webhook delivery log showing recent deliveries with HTTP status codes and payload previews
3. Open a webhook delivery detail view and capture:
   - Request headers showing `X-Cal-Signature-256` and `X-Cal-Webhook-Version`
   - Request body showing the full JSON payload for a `BOOKING_CREATED` event
   - Response status and timing information
4. Save screenshots to `specs/webhooks-events/docs/screenshots/`
5. Create/update `specs/webhooks-events/docs/README.md` with:
   - Feature overview: Sprint 4 Webhook event mapping and payload alignment for Calendly parity — Cal.com's 20 trigger events across 7 categories covering bookings, forms, meetings, recordings, OOO, delegation, and no-show tracking
   - How to use: Creating webhook subscriptions, selecting trigger events from the 20 available events, choosing the payload version, configuring HMAC secrets for signature verification, using Handlebars templates for custom payload formats
   - Configuration options: Trigger event selection (multi-select from `WebhookTriggerEvents` enum), payload version (`v2021-10-20` default, plus any new versions), HMAC secret for `X-Cal-Signature-256` signing, custom Handlebars payload template, subscription scoping (user, event type, team, organization, platform)
   - Common use cases: Booking lifecycle notifications (created, rescheduled, cancelled), routing form submission tracking (`FORM_SUBMITTED`), payment lifecycle monitoring (`BOOKING_PAYMENT_INITIATED`, `BOOKING_PAID`), meeting participation tracking (`MEETING_STARTED`, `MEETING_ENDED`), no-show detection (`AFTER_HOSTS_CAL_VIDEO_NO_SHOW`, `AFTER_GUESTS_CAL_VIDEO_NO_SHOW`), reschedule detection with context

## Promote Docs to Public

Promote internal docs to public Mintlify docs:

1. Review `specs/webhooks-events/docs/README.md` for completeness and accuracy
2. Copy/adapt content to `docs/webhooks-events.mdx` — rewrite for external audience
3. Move screenshots to `docs/images/webhooks-events/`
4. Update `docs/docs.json` navigation to include the new webhooks-events page
5. Ensure customer-appropriate language:
   - Remove internal implementation details (PayloadBuilderFactory class names, DI tokens, Prisma schema references, builder interface names)
   - Focus on user-facing functionality (creating webhook subscriptions, selecting trigger events, configuring secrets, using custom payload templates, understanding retry behavior)
   - Use consistent terminology matching Cal.com's public documentation style
   - Omit references to Calendly parity or gap closure — present features as Cal.com webhook capabilities
   - Include code examples for signature verification (HMAC-SHA256 with `X-Cal-Signature-256` header) and Handlebars template usage
