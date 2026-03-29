# AGENTS.md — Webhooks and Events

## Project Context

Sprint 4: Webhooks and Events (F-010) of the Calendly gap closure initiative. This sprint aligns Cal.com's 20-event webhook system with Calendly's 3 webhook event semantics by implementing event mapping for `invitee.created` equivalents (WH-001), `invitee.canceled` equivalents (WH-002), `routing_form_submission.created` parity (WH-003), payload structure alignment with Calendly expectations (WH-004), and webhook versioning strategy for gap closure additions using the existing `PayloadBuilderFactory` architecture (WH-005). All changes must preserve the existing `v2021-10-20` payload format without breaking changes.

## Before Starting Work

1. Read `specs/webhooks-events/design.md`
2. Check `specs/webhooks-events/implementation.md` for current progress
3. Look at existing patterns in these relevant directories:
   - `packages/features/webhooks/lib/factory/versioned/` — PayloadBuilderFactory, version registry, v2021-10-20 builder implementations
   - `packages/features/webhooks/lib/factory/versioned/v2021-10-20/` — Current version builders that MUST be preserved
   - `packages/features/webhooks/lib/dto/` — All webhook DTO types (BaseEventDTO, BookingCreatedDTO, BookingCancelledDTO, FormSubmittedDTO, etc.)
   - `packages/features/webhooks/lib/service/` — WebhookNotificationHandler, WebhookService, WebhookNotifier
   - `packages/features/webhooks/lib/interface/` — IWebhookRepository, WebhookVersion enum, DEFAULT_WEBHOOK_VERSION
   - `packages/features/webhooks/lib/constants.ts` — Version labels, trigger/group mappings, documentation URLs
   - `packages/features/webhooks/lib/sendPayload.ts` — Payload dispatch with HMAC-SHA256 signing and Handlebars templating
   - `packages/features/bookings/lib/getWebhookPayloadForBooking.ts` — Booking-to-webhook payload transformer
   - `packages/features/webhooks/lib/factory/base/BaseBookingPayloadBuilder.ts` — Base booking payload builder with existing tests
   - `packages/features/webhooks/lib/factory/base/BaseBookingPayloadBuilder.test.ts` — Existing payload builder regression tests
   - `packages/prisma/schema.prisma` — WebhookTriggerEvents enum (20 events), Webhook model
   - `docs/gap-report/webhooks-events.mdx` — Webhook gap analysis (source of truth for gaps)
   - `docs/migration/webhook-compatibility.mdx` — Webhook backward compatibility rules
   - `docs/migration/zero-downtime-strategy.mdx` — Migration safety patterns
   - `docs/sprint-roadmap/validation-criteria.mdx` — WH-VAL validation criteria (11 criteria)

## Code Patterns

Key patterns to follow and reference implementations:

- **PayloadBuilderFactory versioned builder architecture**: The factory at `packages/features/webhooks/lib/factory/versioned/PayloadBuilderFactory.ts` routes trigger events to versioned builders via the `TRIGGER_TO_BUILDER_CATEGORY` map. Each version has a `PayloadBuilderSet` containing typed builders for each category (booking, form, OOO, recording, meeting, instant meeting, delegation). Use `getBuilder(version, triggerEvent)` to obtain the correct builder for a given version and event type.
- **IPayloadBuilder/IBookingPayloadBuilder interfaces**: All builders implement `build(dto)` with strict DTO typing. `IPayloadBuilder` is the base; specializations include `IBookingPayloadBuilder`, `IFormPayloadBuilder`, `IOOOPayloadBuilder`, `IRecordingPayloadBuilder`, `IMeetingPayloadBuilder`, `IInstantMeetingBuilder`, `IDelegationPayloadBuilder`. The `PayloadBuilderSet` interface requires all 7 builders for every registered version.
- **DI with symbol-based tokens**: Webhook services use dependency injection with interface contracts (`IWebhookRepository`, `IWebhookService`, `IWebhookScheduler`). New services must register through the same token-based DI pattern found in `packages/features/webhooks/di/`.
- **Repository pattern**: All data access goes through repository classes (e.g., `WebhookRepository` implementing `IWebhookRepository`) rather than direct Prisma client calls. The `IWebhookRepository` interface defines `getSubscribers()`, `getWebhookById()`, `findByWebhookId()`, `findByOrgIdAndTrigger()`, `getFilteredWebhooksForUser()`, and `listWebhooks()`.
- **HMAC-SHA256 signing**: `sendPayload.ts` computes HMAC-SHA256 over the JSON body using the subscriber's secret. The `X-Cal-Signature-256` header carries the signature (`sha256=<hex_digest>`). The `X-Cal-Webhook-Version` header identifies the payload version. If no secret is configured, the signature header defaults to `no-secret-provided`.
- **Handlebars templating**: Subscribers can define custom `payloadTemplate` using Handlebars syntax. The `sendPayload.ts` module renders the template with the webhook payload data before delivery, supporting expressions like `{{triggerEvent}}`, `{{payload.uid}}`, `{{payload.attendees[0].email}}`.
- **Version registry pattern**: `registry.ts` manages version-to-builder-set mappings. `PayloadBuilderFactory.registerVersion()` adds new versions. `getBuilderSet()` resolves versions with fallback to `DEFAULT_WEBHOOK_VERSION` (`v2021-10-20`). The `createPayloadBuilderFactory()` function in `registry.ts` is the composition root for instantiating a fully configured factory.
- **Test patterns**: Vitest-based tests following patterns in `packages/features/webhooks/lib/factory/base/BaseBookingPayloadBuilder.test.ts`. Tests verify payload shape, field presence, type correctness, and backward compatibility. Every new builder or payload extension must include regression tests confirming the existing `v2021-10-20` payload shape is unchanged.

## Don't

- Don't add features not in design.md
- Don't skip tests
- Don't modify v2021-10-20 payload structure — the existing payload shape at `packages/features/webhooks/lib/factory/versioned/v2021-10-20/` must be preserved exactly; no field removals, renames, or type changes
- Don't remove or rename existing webhook fields in any DTO — all changes must be additive (new optional fields only)
- Don't reorder `WebhookTriggerEvents` enum values in `packages/prisma/schema.prisma` — new values must be appended at the end only
- Don't break HMAC-SHA256 signing — the `X-Cal-Signature-256` header computation in `sendPayload.ts` must remain unchanged
- Don't exceed 5-7 files changed (excluding tests) or 500 lines per PR
- Don't combine multiple epics (WH-001 through WH-005) in a single PR — one focused change per PR
- Don't modify the `X-Cal-Webhook-Version` or `X-Cal-Signature-256` HTTP header semantics
- Don't perform destructive database schema changes — only additive-only per `docs/migration/zero-downtime-strategy.mdx`
- Don't start Wave 4 work (Sprint 6 or Sprint 8) until Wave 3 gate passes
