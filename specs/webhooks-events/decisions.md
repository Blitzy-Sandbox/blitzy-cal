# Webhooks and Events Decisions

Architecture Decision Records (ADRs) for Sprint 4: Webhooks and Events (F-010) of the Calendly gap closure initiative. Each ADR documents the context, options evaluated, final decision, and consequences for a key architectural trade-off encountered during Sprint 4 implementation.

---

## ADR-001: Whether to Create `v2025-01-01` Version or Use Additive-Only Changes to Existing `v2021-10-20`

### Context

Sprint 4 (WH-004, WH-005) requires aligning webhook payloads with Calendly's event semantics — specifically ensuring that `BOOKING_CREATED`, `BOOKING_CANCELLED`, `BOOKING_RESCHEDULED`, and `FORM_SUBMITTED` trigger events produce payloads that map correctly to Calendly's `invitee.created`, `invitee.canceled`, and `routing_form_submission.created` expectations. This alignment includes adding Calendly-equivalent data such as UTM tracking parameters, reschedule URI references, and cancellation context to Cal.com's webhook payloads.

The existing `PayloadBuilderFactory` at `packages/features/webhooks/lib/factory/versioned/PayloadBuilderFactory.ts` routes trigger events to versioned builders via `TRIGGER_TO_BUILDER_CATEGORY` — a `Record<WebhookTriggerEvents, BuilderCategory>` typed constant that provides compile-time validation ensuring every one of Cal.com's 21 trigger events maps to exactly one of the 7 builder categories (booking, form, ooo, recording, meeting, instantMeeting, delegation).

At the start of Sprint 4, only one version existed: `v2021-10-20`, defined in the `WebhookVersion` const object in `packages/features/webhooks/lib/interface/IWebhookRepository.ts`. It was both the default and the only registered version. The `PayloadBuilderFactory` constructor takes a default version and its `PayloadBuilderSet`, and the `registry.ts` composition root registers versions in the internal `Map<WebhookVersion, PayloadBuilderSet>`.

The AAP mandates that the `v2021-10-20` payload structure is preserved exactly — no field removals, renames, or type changes — per the rules documented in `docs/migration/webhook-compatibility.mdx`. New Calendly-equivalent fields (nested `utmParams` object, URI references such as `inviteeUri`/`eventUri`/`schedulingUrl`/`rescheduleUri`, and `cancellationTimestamp`) need to be added to booking payloads to achieve parity with Calendly's inline payload data.

### Options Considered

1. **Additive-only changes to v2021-10-20** — Add new optional fields directly to existing v2021-10-20 builder payload output without creating a new version.

   - Pros:
     - Simplest approach: no new version infrastructure needed — no new builder classes, no new directory under `packages/features/webhooks/lib/factory/versioned/`, no registry changes
     - All existing subscribers automatically receive the new Calendly-equivalent fields without needing to update their webhook subscription's `version` field
     - No changes needed to `WebhookVersion` enum in `IWebhookRepository.ts`, `WEBHOOK_VERSION_LABELS` or `WEBHOOK_VERSION_DOCS` in `constants.ts`, or the `registry.ts` composition root
     - Lower implementation complexity and smaller PR scope — stays well within the 5–7 file / 500 line PR limit
     - Follows the additive payload field rules (R-1 through R-6) documented in `docs/migration/webhook-compatibility.mdx` — new fields are optional, existing field types and names are unchanged
   - Cons:
     - The v2021-10-20 payload envelope grows over time with accumulated additive fields, with no clean boundary between the "original v2021-10-20 shape" and "Calendly-parity extensions"
     - Consumers parsing with strict schemas (e.g., JSON Schema with `additionalProperties: false`) may reject payloads containing unexpected new fields, though this is non-standard JSON practice
     - No explicit opt-in mechanism — all subscribers receive the expanded payload regardless of whether they need the new fields

2. **New `v2025-01-01` version** — Create a new versioned builder set at `packages/features/webhooks/lib/factory/versioned/v2025-01-01/` with restructured payloads that include the Calendly-equivalent fields.

   - Pros:
     - Clean payload boundary: consumers explicitly opt into the new version by updating their webhook subscription's `version` field via `PATCH /v2/webhooks/{webhookId}`
     - Allows payload restructuring (field renaming, reorganization, type changes) without breaking existing consumers on v2021-10-20
     - Future-proofs the versioning system by establishing the pattern for multi-version support — validates that the `PayloadBuilderFactory.registerVersion()` and `getBuilderSet()` fallback mechanisms work with multiple registered versions
     - More aligned with Calendly's own API versioning approach where consumers explicitly request a version
   - Cons:
     - Higher implementation complexity: requires implementing all 7 builder interfaces (`IBookingPayloadBuilder`, `IFormPayloadBuilder`, `IOOOPayloadBuilder`, `IRecordingPayloadBuilder`, `IMeetingPayloadBuilder`, `IInstantMeetingBuilder`, `IDelegationPayloadBuilder`) in the new version's `PayloadBuilderSet`, even for categories with no payload changes
     - Existing subscribers must explicitly migrate to the new version to receive Calendly-aligned payloads, adding a migration burden for all existing integrations
     - Potential confusion with two versions coexisting if the payload differences are minor additive fields
     - Exceeds PR scope limits (5–7 files, 500 lines) if combined with other WH epic work — a full `PayloadBuilderSet` with 7 builders plus types, index, and registry changes would require a dedicated PR
     - The `WEBHOOK_VERSION_LABELS`, `WEBHOOK_VERSION_OPTIONS`, and `WEBHOOK_VERSION_DOCS` maps in `constants.ts` would all need extension, and the `WebhookVersion` const object and `VALID_WEBHOOK_VERSIONS` set in `IWebhookRepository.ts` would require updates

### Decision

Create a **new `v2025-01-01` versioned builder set** alongside the existing `v2021-10-20`. The Calendly-equivalent fields (UTM tracking via nested `utmParams`, URI references such as `inviteeUri`, `eventUri`, `schedulingUrl`, `rescheduleUri`, and `cancellationTimestamp`) are added to the shared DTOs as optional fields, while v2025-01-01 provides a clean builder set that fully implements Calendly-aligned payload construction. The v2021-10-20 builder set is preserved unchanged for backward compatibility.

This approach future-proofs the versioning system by establishing the pattern for multi-version support — validating that the `PayloadBuilderFactory.registerVersion()` and `getBuilderSet()` fallback mechanisms work with multiple registered versions. Consumers can explicitly opt into the new version by updating their webhook subscription's `payloadVersion` field.

### Consequences

- A new v2025-01-01 builder set is created at `packages/features/webhooks/lib/factory/versioned/v2025-01-01/` with all 7 builder interfaces implemented plus types and index files (10 files total)
- The `WebhookVersion` const object in `IWebhookRepository.ts` is extended with `V_2025_01_01: "2025-01-01"` alongside the existing `V_2021_10_20: "2021-10-20"`
- `DEFAULT_WEBHOOK_VERSION` remains `WebhookVersion.V_2021_10_20` — existing subscribers are unaffected
- `WEBHOOK_VERSION_LABELS` in `constants.ts` is extended to include the `V_2025_01_01` label
- The `registry.ts` composition root (`createPayloadBuilderFactory()`) registers both v2021-10-20 and v2025-01-01 builder sets
- v2021-10-20 builders remain unchanged — no modifications to any files in the `v2021-10-20/` directory
- DTOs in `packages/features/webhooks/lib/dto/types.ts` gain new optional fields on `BookingCreatedDTO` (nested `utmParams` object, `inviteeUri`, `eventUri`, `schedulingUrl`) and `BookingCancelledDTO` (`rescheduleUri`, `cancellationTimestamp`)
- Existing webhook subscribers on `v2021-10-20` continue to receive unchanged payload shapes — no automatic migration
- Per-subscriber version override is supported via the `Webhook.payloadVersion` field in the Prisma schema

---

## ADR-002: HMAC-SHA256 Signing Preservation Strategy

### Context

Cal.com signs every webhook delivery with an HMAC-SHA256 signature using the webhook subscriber's configured secret key. The `sendPayload.ts` module at `packages/features/webhooks/lib/sendPayload.ts` computes the signature via `createHmac("sha256", secret).update(body).digest("hex")` and attaches it as the `X-Cal-Signature-256` header (formatted as `sha256=<hex_digest>`). Every delivery also includes the `X-Cal-Webhook-Version` header identifying the payload format version. If no secret is configured, the header defaults to `"no-secret-provided"`.

Sprint 4 adds new optional fields to webhook payloads (nested `utmParams`, URI references, `cancellationTimestamp`). These additive fields change the JSON serialization of the payload body, which means the HMAC-SHA256 digest will be different from what it would have been without the new fields. Consumers verifying HMAC signatures must compute the digest over the full received body — which they already do per standard webhook verification practice.

The question is whether the signing infrastructure needs any modifications to accommodate the expanded payload bodies.

### Options Considered

1. **No signing changes — let additive payload fields change the HMAC naturally** — The HMAC-SHA256 signature is computed over the raw JSON body as serialized. Adding new fields to the JSON body naturally produces a different digest, but consumers already compute HMAC over whatever body they receive.

   - Pros:
     - Zero changes to the signing infrastructure in `sendPayload.ts` — no code modifications, no new headers, no new configuration
     - Standard webhook practice: HMAC-SHA256 is computed over the full body, and consumers always verify against the full received body — this is how GitHub, Stripe, Shopify, and all major webhook providers operate
     - The `X-Cal-Signature-256` header semantics remain unchanged — it always represents the HMAC-SHA256 of the full body
     - The `X-Cal-Webhook-Version` header continues to identify the payload version, allowing consumers to correlate signature verification with expected payload shape
     - No risk of breaking existing consumer signature verification logic
   - Cons:
     - Consumers with hardcoded expected payload sizes or fields in their verification logic may be surprised by larger payloads, but this is a non-standard and fragile consumer pattern

2. **Version-scoped signing with separate signature headers per version** — Introduce a new header (e.g., `X-Cal-Signature-256-v2021-10-20`) that signs only the fields present in the original v2021-10-20 payload shape, alongside the existing full-body signature.

   - Pros:
     - Consumers could verify signatures against a stable subset of fields, isolating them from additive payload changes
     - Explicit versioned signature verification for advanced consumers
   - Cons:
     - Overcomplicated for additive changes — the industry standard is full-body signing, not field-subset signing
     - Breaks the existing header contract — consumers expect a single `X-Cal-Signature-256` header, not multiple version-scoped headers
     - Adds significant implementation complexity: extracting and serializing a version-specific field subset for signing requires maintaining a parallel serialization path per version
     - No major webhook provider uses this pattern — it would be unique to Cal.com and confusing for integration developers
     - Violates the AAP constraint that `X-Cal-Signature-256` header semantics must remain unchanged

### Decision

Use **option 1** — no changes to signing infrastructure. HMAC-SHA256 signing operates on the raw JSON body, which naturally includes any additive fields. This is standard webhook practice across the industry (matching the approach used by GitHub, Stripe, and other major webhook providers) and does not constitute a breaking change. The `X-Cal-Signature-256` and `X-Cal-Webhook-Version` headers continue to be sent with existing semantics.

Consumers already compute HMAC-SHA256 over the full received body using their stored secret — the presence of additional fields in the body does not affect this computation. The signature will be different from what it would have been without the new fields, but consumers verify against the body they actually received, not against an expected body shape.

### Consequences

- `sendPayload.ts` at `packages/features/webhooks/lib/sendPayload.ts` requires zero modifications for Sprint 4 — the `createWebhookSignature` function and HTTP header attachment logic remain unchanged
- HMAC-SHA256 signatures naturally cover the expanded payload including all new Calendly-equivalent fields — consumers verify the full body, which includes the new fields
- Consumers must compute HMAC over the full received body (which they already do per standard practice) — no consumer-side changes required
- No new HTTP headers are introduced — `X-Cal-Signature-256` and `X-Cal-Webhook-Version` remain the only webhook-specific headers
- The `sendOrSchedulePayload.ts` toggle between synchronous and Tasker-based async delivery is unaffected
- Handlebars template compilation in `sendPayload.ts` is also unaffected — templates that reference new fields (`{{utmSource}}`, `{{rescheduleUrl}}`) will resolve correctly after the payload data includes them; templates that don't reference them continue to work unchanged

---

## ADR-003: WebhookTriggerEvents Enum Extension Strategy

### Context

The `WebhookTriggerEvents` Prisma enum at `packages/prisma/schema.prisma` defines all valid webhook trigger events — currently 21 events across 7 categories (booking, form, OOO, recording, meeting, instant meeting, delegation). These 21 events are exhaustively mapped in the `TRIGGER_TO_BUILDER_CATEGORY` constant in `PayloadBuilderFactory.ts`, which is typed as `Record<WebhookTriggerEvents, BuilderCategory>` to provide compile-time validation that every enum value has a mapping.

Sprint 4 requires verifying that Cal.com's existing trigger events map correctly to Calendly's 3 webhook events:
- `BOOKING_CREATED` → Calendly's `invitee.created` (WH-001)
- `BOOKING_CANCELLED` → Calendly's `invitee.canceled` (WH-002)
- `FORM_SUBMITTED` → Calendly's `routing_form_submission.created` (WH-003)

WH-005 evaluates whether any new trigger events need to be added for Calendly parity. Since Calendly only has 3 events and Cal.com already has 20 (including direct equivalents for all 3 of Calendly's events), new enum values are unlikely to be needed for Sprint 4.

However, future sprints or edge cases may require adding new trigger events. The question is how to handle `WebhookTriggerEvents` enum extensions safely.

Per `docs/migration/zero-downtime-strategy.mdx`, only additive-only changes to Prisma enums are permitted. Per `docs/migration/webhook-compatibility.mdx`, existing enum values must not be reordered or removed. New values appended to the end of the enum do not affect existing database rows, as PostgreSQL enums preserve insertion order independently of declaration order.

### Options Considered

1. **Additive enum extension only — append new values at the end of the Prisma enum definition**

   - Pros:
     - Zero risk to existing webhook subscribers — their subscribed `eventTriggers` arrays continue to reference valid enum values
     - Database migration is safe and zero-downtime: `ALTER TYPE "WebhookTriggerEvents" ADD VALUE IF NOT EXISTS '{new_value}'` is a non-blocking DDL operation in PostgreSQL
     - The `IF NOT EXISTS` clause makes the migration idempotent — safe to re-run without errors
     - Prisma client regeneration automatically includes the new enum value without breaking existing code
     - The `TRIGGER_TO_BUILDER_CATEGORY` exhaustive type constraint in `PayloadBuilderFactory.ts` will produce a compile-time error if a new enum value is added without a corresponding mapping, preventing coverage gaps
     - The `WEBHOOK_TRIGGER_EVENTS_GROUPED_BY_APP` groupings in `constants.ts` can be extended by adding the new value to the appropriate group (`core` or `routing-forms`)
   - Cons:
     - The Prisma enum may grow large over time as new trigger events are added across sprints, though this is a minor cosmetic concern
     - New enum values must be manually added to the `TRIGGER_TO_BUILDER_CATEGORY` map, `WEBHOOK_TRIGGER_EVENTS_GROUPED_BY_APP` groupings, and potentially the `WEBHOOK_TRIGGER_EVENTS` flat array — there is no automatic propagation beyond the TypeScript compile-time check

2. **Reorganized enum with grouped values by domain** — Reorder the Prisma enum to group trigger events logically (all booking events together, all form events together, all meeting events together, etc.).

   - Pros:
     - Cleaner logical grouping of trigger events by domain, improving readability of the Prisma schema
     - Easier to identify which events belong to which builder category
   - Cons:
     - **VIOLATES** the zero-downtime migration rules documented in `docs/migration/zero-downtime-strategy.mdx` — PostgreSQL does not support reordering enum values in an `ALTER TYPE` statement; reordering would require creating a new type, migrating all data, and dropping the old type, which is a destructive and risky operation
     - **VIOLATES** the webhook backward compatibility rules in `docs/migration/webhook-compatibility.mdx` — existing database rows reference enum values by their string representation, not by ordinal position, but the migration path itself is unsafe
     - Breaks existing Prisma client compatibility during the migration window, risking webhook delivery failures
     - Incompatible with the `ALTER TYPE ... ADD VALUE IF NOT EXISTS` idempotent migration pattern

### Decision

Use **additive enum extension only** (option 1). Any new `WebhookTriggerEvents` values must be appended at the end of the Prisma enum definition in `packages/prisma/schema.prisma`. No reordering, no removal of existing values. This follows the mandatory constraints from `docs/migration/zero-downtime-strategy.mdx` and `docs/migration/webhook-compatibility.mdx`.

For Sprint 4, the existing 21 trigger events already cover the Calendly mapping without needing new enum values:
- `BOOKING_CREATED` → Calendly's `invitee.created` (direct equivalent)
- `BOOKING_CANCELLED` → Calendly's `invitee.canceled` (direct equivalent)
- `BOOKING_RESCHEDULED` → Calendly's `invitee.canceled` + `invitee.created` (Cal.com advantage: dedicated reschedule event)
- `FORM_SUBMITTED` → Calendly's `routing_form_submission.created` (direct equivalent)

New enum values are only added if a Calendly event has no existing Cal.com equivalent — which is not the case for Sprint 4, since Cal.com's 21 events are a superset of Calendly's 3.

### Consequences

- `TRIGGER_TO_BUILDER_CATEGORY` in `PayloadBuilderFactory.ts` remains exhaustive with the existing 20 enum values — no new entries needed for Sprint 4
- If new enum values are added in future sprints, they must appear at the end of the Prisma `WebhookTriggerEvents` enum definition — never inserted between existing values
- New migration files follow the naming convention: `packages/prisma/migrations/[timestamp]_add_webhook_trigger_events/migration.sql`
- Migration SQL uses `ALTER TYPE "WebhookTriggerEvents" ADD VALUE IF NOT EXISTS '{new_value}'` for idempotent execution — safe to re-run in any environment
- All new trigger events (if any are added in the future) must have corresponding entries in:
  - `TRIGGER_TO_BUILDER_CATEGORY` map in `PayloadBuilderFactory.ts` (compile-time enforced)
  - `WEBHOOK_TRIGGER_EVENTS_GROUPED_BY_APP` groupings in `constants.ts` (runtime groupings for UI)
  - `WEBHOOK_TRIGGER_EVENTS` flat array in `constants.ts` (comprehensive trigger list)
  - Each registered version's `PayloadBuilderSet` must have a builder that handles the new event's category
- The `WebhookTriggerEvents` enum in `constants.ts` (the `WEBHOOK_TRIGGER_EVENTS_GROUPED_BY_APP` mapping) separates events into `core` and `routing-forms` groups — new events must be placed in the appropriate group
- No Prisma schema migration is required for Sprint 4 since no new enum values are needed
