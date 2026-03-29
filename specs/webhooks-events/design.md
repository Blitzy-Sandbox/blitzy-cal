# Webhooks and Events Design

## Overview

Sprint 4: Webhooks and Events (F-010) aligns Cal.com's 20-event webhook system with Calendly's 3 webhook event semantics (`invitee.created`, `invitee.canceled`, `routing_form_submission.created`). This sprint ensures that Cal.com's `BOOKING_CREATED`, `BOOKING_CANCELLED`, `BOOKING_RESCHEDULED`, and `FORM_SUBMITTED` trigger events produce payloads that map correctly to Calendly's expected event structures while preserving the existing `v2021-10-20` payload format without breaking changes. It encompasses 5 epics (WH-001 through WH-005) and is part of Wave 3 which executes in parallel with Sprint 5 (Routing Forms) and Sprint 7 (Admin and Teams).

## Problem Statement

Cal.com's webhook system already significantly exceeds Calendly in event breadth and architectural sophistication. Cal.com supports 20 distinct `WebhookTriggerEvents` (8 booking lifecycle, 2 form, 4 meeting, 2 recording, 4 other) compared to Calendly's 3 webhook events (`invitee.created`, `invitee.canceled`, `routing_form_submission.created`). Cal.com's versioned `PayloadBuilderFactory` architecture with 7 typed builder interfaces, strict DTO typing, HMAC-SHA256 payload signing, Handlebars templating, and multi-level subscriber scoping (user, team, org, platform) represent clear architectural advantages.

However, the gap analysis documented in `docs/gap-report/webhooks-events.mdx` identifies five areas where semantic alignment is needed to ensure Cal.com webhook payloads provide equivalent data to consumers migrating from Calendly:

- **WH-001 — `invitee.created` event mapping parity**: The `BOOKING_CREATED` payload must semantically map to Calendly's `invitee.created` event — booking confirmation with attendee details, event metadata, and scheduling context must be present in the payload output.
- **WH-002 — `invitee.canceled` event mapping parity**: The `BOOKING_CANCELLED` payload must semantically map to Calendly's `invitee.canceled` event — cancellation reason, booking reference, reschedule context, and attendee notification status must be included.
- **WH-003 — `routing_form_submission.created` parity**: The `FORM_SUBMITTED` payload must semantically map to Calendly's `routing_form_submission.created` event — form fields, routing decisions, and submission metadata must align.
- **WH-004 — Payload structure alignment**: Calendly payloads include UTM tracking parameters, reschedule URI references, cancel URI references, and additional event metadata that Cal.com's current payloads may not include. These are additive field extensions.
- **WH-005 — Webhook versioning strategy**: Establish the documented pattern for future webhook version additions using the existing `PayloadBuilderFactory` architecture, while confirming the Sprint 4 approach of additive-only changes to `v2021-10-20`.

All identified gaps are Low severity, reflecting Cal.com's architectural superiority in this domain. The changes required are additive enhancements to an already robust system — no breaking changes, no structural rearchitecture, and no new dependencies.

| Epic ID | Name | Priority | Complexity |
|---------|------|----------|------------|
| WH-001 | `invitee.created` event mapping parity | Low | S |
| WH-002 | `invitee.canceled` event mapping parity | Low | S |
| WH-003 | `routing_form_submission.created` parity | Low | S |
| WH-004 | Payload structure alignment | Low | M |
| WH-005 | Webhook versioning strategy | Low | M |

## User Stories

1. **As a webhook consumer integrating with Cal.com**, I want booking creation webhooks to include all the attendee and event metadata that Calendly's `invitee.created` event provides, so that I can process booking notifications without requesting additional data from the API.

2. **As a webhook consumer**, I want booking cancellation webhooks to include the cancellation reason and reschedule context that Calendly's `invitee.canceled` event provides, so that my integration handles cancellations and reschedules identically to my Calendly integration.

3. **As a webhook consumer using routing forms**, I want form submission webhooks to include the same routing decision metadata that Calendly's `routing_form_submission.created` provides, so that I can track form submission outcomes.

4. **As a Cal.com platform developer**, I want a clear webhook versioning strategy so that future payload changes can be introduced without breaking existing subscribers.

5. **As a Cal.com admin**, I want to configure webhook subscriptions with specific trigger events that map to Calendly-equivalent events so that my integrations work correctly after migrating from Calendly.

## Technical Design

### Database Changes

Sprint 4 requires minimal database changes — primarily verification of existing Prisma enum coverage with a potential for additive-only extensions.

**WebhookTriggerEvents Enum (Additive Only)**

The `WebhookTriggerEvents` Prisma enum at `packages/prisma/schema.prisma` currently defines 21 trigger events:

- **Booking lifecycle (9):** `BOOKING_CREATED`, `BOOKING_PAID`, `BOOKING_PAYMENT_INITIATED`, `BOOKING_RESCHEDULED`, `BOOKING_REQUESTED`, `BOOKING_CANCELLED`, `BOOKING_REJECTED`, `BOOKING_NO_SHOW_UPDATED`, `BOOKING_RESCHEDULED_BY_ATTENDEE`
- **Form events (2):** `FORM_SUBMITTED`, `FORM_SUBMITTED_NO_EVENT`
- **Meeting events (2):** `MEETING_ENDED`, `MEETING_STARTED`
- **Recording events (2):** `RECORDING_READY`, `RECORDING_TRANSCRIPTION_GENERATED`
- **Instant meeting (1):** `INSTANT_MEETING`
- **Other events (5):** `OOO_CREATED`, `AFTER_HOSTS_CAL_VIDEO_NO_SHOW`, `AFTER_GUESTS_CAL_VIDEO_NO_SHOW`, `DELEGATION_CREDENTIAL_ERROR`, `WRONG_ASSIGNMENT_REPORT`

Sprint 4 change: **Likely NO new enum values are needed.** The existing trigger events already map to all 3 Calendly events:

- `BOOKING_CREATED` → Calendly `invitee.created`
- `BOOKING_CANCELLED` → Calendly `invitee.canceled`
- `BOOKING_RESCHEDULED` → Calendly `invitee.created` (with reschedule context)
- `FORM_SUBMITTED` → Calendly `routing_form_submission.created`

If new values are identified during implementation, they must be appended at the END of the enum only (never reorder existing values). The migration pattern follows Pattern 1 (additive enum extension) from `docs/migration/zero-downtime-strategy.mdx`:

```sql
ALTER TYPE "WebhookTriggerEvents" ADD VALUE IF NOT EXISTS '{new_value}';
```

**Migration File Naming Convention:**
`packages/prisma/migrations/[timestamp]_webhook_event_parity/migration.sql` (if needed)

**No Destructive Changes:**

- No column removals, renames, or type changes to existing columns
- No table drops or modifications to existing models
- No NOT NULL constraints without defaults on existing columns
- All existing `Webhook` subscription records, delivery logs, and trigger event configurations remain intact and unmodified

**Data Preservation Guarantee:**

Per `docs/migration/data-preservation.mdx`, all existing webhook subscription records (including the sensitive `secret` field used for HMAC-SHA256 signing) must be preserved without modification. The `CALENDSO_ENCRYPTION_KEY` used for AES-256 credential encryption is not affected by Sprint 4 changes, but adjacent table integrity must be verified.

### API Changes

#### PayloadBuilderFactory Extension (WH-001, WH-002, WH-004, WH-005)

**File:** `packages/features/webhooks/lib/factory/versioned/PayloadBuilderFactory.ts`

The `TRIGGER_TO_BUILDER_CATEGORY` exhaustive mapping ensures every `WebhookTriggerEvents` value routes to the correct builder category. Sprint 4 verifies and documents the Calendly-equivalent semantic mapping:

| Cal.com Trigger Event | Builder Category | Calendly Equivalent |
|---|---|---|
| `BOOKING_CREATED` | `booking` | `invitee.created` |
| `BOOKING_CANCELLED` | `booking` | `invitee.canceled` |
| `BOOKING_RESCHEDULED` | `booking` | `invitee.created` (with reschedule context) |
| `BOOKING_RESCHEDULED_BY_ATTENDEE` | `booking` | `invitee.created` (attendee-initiated reschedule variant) |
| `FORM_SUBMITTED` | `form` | `routing_form_submission.created` |
| `BOOKING_PAID` | `booking` | Cal.com advantage (no Calendly equivalent) |
| `BOOKING_PAYMENT_INITIATED` | `booking` | Cal.com advantage |
| `BOOKING_REQUESTED` | `booking` | Cal.com advantage |
| `BOOKING_REJECTED` | `booking` | Cal.com advantage |
| `BOOKING_NO_SHOW_UPDATED` | `booking` | Cal.com advantage |
| `FORM_SUBMITTED_NO_EVENT` | `form` | Cal.com advantage |
| `MEETING_ENDED` | `meeting` | Cal.com advantage |
| `MEETING_STARTED` | `meeting` | Cal.com advantage |
| `INSTANT_MEETING` | `instantMeeting` | Cal.com advantage |
| `RECORDING_READY` | `recording` | Cal.com advantage |
| `RECORDING_TRANSCRIPTION_GENERATED` | `recording` | Cal.com advantage |
| `OOO_CREATED` | `ooo` | Cal.com advantage |
| `AFTER_HOSTS_CAL_VIDEO_NO_SHOW` | `meeting` | Cal.com advantage |
| `AFTER_GUESTS_CAL_VIDEO_NO_SHOW` | `meeting` | Cal.com advantage |
| `DELEGATION_CREDENTIAL_ERROR` | `delegation` | Cal.com advantage |
| `WRONG_ASSIGNMENT_REPORT` | `booking` | Cal.com advantage |

The `PayloadBuilderFactory` class exposes:

- `registerVersion(version, builderSet)` — registers a `PayloadBuilderSet` for a given version
- `getBuilder(version, triggerEvent)` — returns the typed builder for a version/trigger combination with fallback to `defaultBuilderSet`
- `getRegisteredVersions()` — lists all registered versions
- `isVersionSupported(version)` — checks version availability

The factory's type-safe overloaded `getBuilder` method ensures compile-time validation that the correct builder interface is returned per trigger event category. The 7 builder interfaces are: `IBookingPayloadBuilder`, `IFormPayloadBuilder`, `IOOOPayloadBuilder`, `IRecordingPayloadBuilder`, `IMeetingPayloadBuilder`, `IInstantMeetingPayloadBuilder`, and `IDelegationPayloadBuilder`.

#### DTO Extensions (WH-004)

**File:** `packages/features/webhooks/lib/dto/types.ts`

Additive field extensions to existing DTOs for Calendly payload parity. **All new fields MUST be optional** (TypeScript `?` suffix). No existing fields may be modified, removed, or renamed.

**BookingCreatedDTO extensions:**

```typescript
// Additive fields for Calendly invitee.created parity
utmParams?: {
  utmSource?: string;                    // UTM source parameter from booking link
  utmMedium?: string;                    // UTM medium parameter
  utmCampaign?: string;                  // UTM campaign parameter
  utmTerm?: string;                      // UTM search term parameter
  utmContent?: string;                   // UTM content identifier
};
inviteeUri?: string;                     // URI identifying the invitee resource
eventUri?: string;                       // URI identifying the event resource
schedulingUrl?: string;                  // Direct URL for scheduling
```

**BookingCancelledDTO extensions:**

```typescript
// Additive fields for Calendly invitee.canceled parity
rescheduleUri?: string;            // URI to reschedule the cancelled booking
cancellationTimestamp?: string;    // ISO-8601 timestamp of when the cancellation occurred
```

**Existing fields preserved (non-exhaustive):**

- `BookingCreatedDTO.evt` — `CalendarEvent` object (unchanged)
- `BookingCreatedDTO.eventType` — Event type metadata (unchanged)
- `BookingCreatedDTO.booking` — Booking reference with `id`, `eventTypeId`, `userId`, `startTime`, `smsReminderNumber` (unchanged)
- `BookingCreatedDTO.status`, `BookingCreatedDTO.metadata`, `BookingCreatedDTO.platformParams` (unchanged)
- `BookingCancelledDTO.evt`, `BookingCancelledDTO.eventType`, `BookingCancelledDTO.booking` (unchanged)
- `BookingCancelledDTO.cancelledBy`, `BookingCancelledDTO.cancellationReason`, `BookingCancelledDTO.requestReschedule` (unchanged)
- `BookingRescheduledDTO.rescheduleId`, `rescheduleUid`, `rescheduleStartTime`, `rescheduleEndTime`, `rescheduledBy` (unchanged)

**CRITICAL**: The `v2021-10-20` payload type `V20211020BookingEventPayload` existing field set must remain byte-identical for backward compatibility per `docs/migration/webhook-compatibility.mdx`.

#### v2021-10-20 Builder Modifications (WH-004)

**Directory:** `packages/features/webhooks/lib/factory/versioned/v2021-10-20/`

The v2021-10-20 builder set contains 7 typed builders implementing the `PayloadBuilderSet` interface. Sprint 4 modifications are limited to:

- **Booking builders** (`IBookingPayloadBuilder` implementations): Populate new optional fields (`utmParams` nested object with `utmSource`, `utmMedium`, `utmCampaign`, `utmTerm`, `utmContent`; plus `inviteeUri`, `eventUri`, `schedulingUrl`, `rescheduleUri`, `cancellationTimestamp`) in the payload output when source data is available in the DTO. When source data is absent, these fields must be omitted entirely (not set to `null` or empty string).
- **Form builders** (`IFormPayloadBuilder` implementations): Verify the `FORM_SUBMITTED` payload shape includes form fields, routing decisions, and submission metadata matching Calendly's `routing_form_submission.created` structure.
- **All other builders** (OOO, recording, meeting, instant meeting, delegation): No modifications needed — these trigger events are Cal.com advantages with no Calendly equivalent.

**CRITICAL PRESERVATION RULES:**

- Existing payload fields retain their exact types, names, and positions
- The `V20211020BookingEventPayload` type shape for existing fields must be unchanged
- New fields are appended to the payload output object — never inserted between existing fields
- The `build(dto)` method signature remains unchanged
- All existing regression tests in `BaseBookingPayloadBuilder.test.ts` must continue to pass without modification

#### WebhookNotificationHandler (WH-001, WH-002, WH-003)

**File:** `packages/features/webhooks/lib/service/WebhookNotificationHandler.ts`

The `WebhookNotificationHandler` requires **no structural changes** for Sprint 4. The handler already correctly:

1. Checks `isDryRun` flag and short-circuits if true
2. Discovers subscribers via `webhookService.getSubscribers(triggerEvent, ...)`
3. Creates payload via `payloadBuilderFactory.getBuilder(DEFAULT_WEBHOOK_VERSION, dto.triggerEvent).build(dto)`
4. Dispatches via `processWebhooks(subscribers, payload)` which delegates to `sendOrSchedulePayload`

The handler's `createPayload` private method defaults to `DEFAULT_WEBHOOK_VERSION` (currently `V_2021_10_20` = `"2021-10-20"`) and passes through to the factory. This pattern naturally supports the additive payload changes — the enhanced builders produce expanded payloads that flow through the existing handler without modification.

Future enhancement: per-subscriber version override (documented in `specs/webhooks-events/future-work.md`), where the handler reads `webhook.version` from each subscriber record and passes it to `getBuilder()` instead of the global `DEFAULT_WEBHOOK_VERSION`.

#### Booking Payload Transformer (WH-001, WH-002, WH-004)

**File:** `packages/features/bookings/lib/getWebhookPayloadForBooking.ts`

The `getWebhookPayloadForBooking` function currently merges `eventType` info (title, description, requiresConfirmation, price, currency, length) with `CalendarEvent` data (minus `assignmentReason`) and `bookingId` to produce an `EventPayloadType`.

Sprint 4 changes ensure the transformer includes Calendly-equivalent fields when available:

- **UTM tracking data**: Sourced from booking metadata or the query parameters stored during booking creation. If UTM data is not available (e.g., direct link booking), the fields are `undefined` — not empty strings.
- **Reschedule URL**: Constructed from booking UID and Cal.com base URL: `${WEBAPP_URL}/booking/${bookingUid}?reschedule=true`
- **Cancel URL**: Constructed from booking UID: `${WEBAPP_URL}/booking/${bookingUid}?cancel=true`
- **Event metadata**: Additional context from the booking's metadata JSON field, if present.

#### Webhook Version Registry (WH-005)

**File:** `packages/features/webhooks/lib/factory/versioned/registry.ts`

Sprint 4 versioning strategy decision (see ADR-001 in `specs/webhooks-events/decisions.md`):

- **Sprint 4 uses additive-only changes to v2021-10-20 — no new version is created.**
- `registry.ts` remains single-version, registering only the `V_2021_10_20` builder set
- The `PayloadBuilderFactory.registerVersion()` API is validated to support future version additions
- A future `v2025-01-01` version is documented in `specs/webhooks-events/future-work.md`

**Related constants files that remain unchanged:**

- `packages/features/webhooks/lib/constants.ts` — `WEBHOOK_VERSION_LABELS` (`V_2021_10_20: "2021-10-20"`), `WEBHOOK_VERSION_OPTIONS`, `WEBHOOK_VERSION_DOCS` retain existing values
- `packages/features/webhooks/lib/interface/IWebhookRepository.ts` — `WebhookVersion` enum (`V_2021_10_20`), `DEFAULT_WEBHOOK_VERSION`, `VALID_WEBHOOK_VERSIONS` Set remain unchanged

#### Webhook Delivery Pipeline (WH-004)

**Files:**
- `packages/features/webhooks/lib/sendPayload.ts`
- `packages/features/webhooks/lib/sendOrSchedulePayload.ts`

Both files require **no changes** for Sprint 4:

- **HMAC-SHA256 signing** naturally covers the expanded payload. The signature is computed over the raw JSON body string, which includes any new additive fields. This is standard webhook practice and does not constitute a breaking change (see ADR-002 in `specs/webhooks-events/decisions.md`).
- **Handlebars templating** supports new fields automatically. Subscribers using custom `payloadTemplate` can reference new fields like `{{utmSource}}` after Sprint 4. Undefined template variables produce empty string via Handlebars' safe default behavior, not errors.
- **HTTP headers** remain unchanged:
  - `X-Cal-Signature-256` — HMAC-SHA256 signature over body
  - `X-Cal-Webhook-Version` — Payload version identifier (`2021-10-20`)
  - `Content-Type: application/json`

#### WebhookService Subscriber Discovery (WH-001, WH-002)

**File:** `packages/features/webhooks/lib/service/WebhookService.ts`

The `WebhookService.getSubscribers()` method discovers webhook subscribers by trigger event and scope (user, team, org, platform). Sprint 4 requires **no changes** to subscriber discovery — the existing multi-level scoping correctly identifies subscribers for all 21 trigger events including `BOOKING_CREATED`, `BOOKING_CANCELLED`, and `FORM_SUBMITTED`.

#### Base Booking Payload Builder (WH-004)

**File:** `packages/features/webhooks/lib/factory/base/BaseBookingPayloadBuilder.ts`

The abstract `BaseBookingPayloadBuilder` class defines `BookingExtraDataMap` with per-trigger extra data types and `BookingPayloadParams<T>` generic type. Sprint 4 may extend `BookingExtraDataMap` to include new field types for UTM and URL data, with the `BookingPayloadParams<T>` generic automatically adapting.

**Test file:** `packages/features/webhooks/lib/factory/base/BaseBookingPayloadBuilder.test.ts`

Sprint 4 extends the existing test suite with Calendly-mapping regression tests:

- Snapshot tests for v2021-10-20 payload shapes (golden file comparison)
- Verification that new optional fields appear when source data is present in the DTO
- Verification that new optional fields are absent (not set to `null` or empty string) when source data is missing
- Backward compatibility assertion: all existing payload fields are present and unchanged after Sprint 4 modifications
- Type-safety tests confirming the `TRIGGER_TO_BUILDER_CATEGORY` map correctly routes all 21 events

### UI Changes

Sprint 4 has **minimal to no UI changes**:

- **Webhook subscription creation UI**: May show updated documentation links referencing Calendly-equivalent event descriptions to aid migrating users. This is a content update to existing help text, not a structural UI change.
- **No new pages, dialogs, or components** are required.
- **Existing webhook configuration UI** at admin settings pages is sufficient for all Sprint 4 functionality.
- **Webhook trigger event selector**: The existing event selection dropdown/checkbox list already displays all 21 trigger events grouped by application (`core`: 19 events, `routing-forms`: 2 events) as defined in `WEBHOOK_TRIGGER_EVENTS_GROUPED_BY_APP` in `constants.ts`.

## Edge Cases

1. **Missing UTM Data in Booking Source**: When a booking is created without UTM parameters (e.g., direct link booking vs. marketing campaign link), the UTM fields in the webhook payload must be `undefined`/omitted, not empty strings. Consumers must handle absent UTM data gracefully. The `getWebhookPayloadForBooking` transformer must not synthesize UTM values when none exist in the booking metadata. This ensures consistent behavior for payload consumers using strict property presence checks.

2. **Reschedule Chain Tracking**: When a booking is rescheduled multiple times, each `BOOKING_RESCHEDULED` event should include the immediate previous booking UID via `BookingRescheduledDTO.rescheduleUid` and the previous booking ID via `rescheduleId`. Calendly's model tracks the full reschedule chain — Cal.com currently provides immediate-previous references but not the original booking UID across a multi-hop reschedule chain. If original UID tracking is not feasible in Sprint 4, the limitation must be documented and deferred to `future-work.md`.

3. **Handlebars Template Compatibility**: Subscribers using custom `payloadTemplate` (Handlebars syntax) must not break when new fields are added to the payload data context. Handlebars safely ignores undefined template variables — referencing `{{utmSource}}` in a template before Sprint 4 produces empty string, not an error. After Sprint 4, templates can reference the new fields. No migration or notification to existing template users is required.

4. **Concurrent Webhook Delivery**: Multiple webhook subscribers may receive the same event payload concurrently via the Tasker async delivery mechanism. Payload construction must be idempotent — calling `builder.build(dto)` multiple times with the same DTO must produce identical payloads. No mutable state should be shared between concurrent deliveries. The `PayloadBuilderFactory.getBuilder()` returns builder instances that must not retain state between `build()` invocations.

5. **FORM_SUBMITTED Without Routing Decision**: If a routing form submission does not trigger a routing decision (e.g., form is misconfigured, has no matching routes, or the routing results in `FORM_SUBMITTED_NO_EVENT`), the `FORM_SUBMITTED` webhook should still fire with the submission data but without routing destination metadata. This matches Calendly's behavior where `routing_form_submission.created` fires regardless of routing outcome. The `FormSubmittedDTO` and `FormSubmittedNoEventDTO` both carry submission data independently of routing success.

6. **WebhookTriggerEvents Enum Drift**: If the Prisma schema adds new enum values between the time this spec is written and implementation begins (e.g., via another sprint's concurrent work in Wave 3), the `TRIGGER_TO_BUILDER_CATEGORY` exhaustive map in `PayloadBuilderFactory.ts` must be updated to include any new values. The TypeScript compiler will flag unmapped values as errors due to the exhaustive type constraint — this is a safety net that guarantees compile-time detection.

7. **Backward Compatibility Regression Detection**: Any modification to v2021-10-20 builder output must be tested against a snapshot of the existing payload shape. A regression test should serialize a known DTO through each modified builder, compare against a golden snapshot, and fail if any existing field is missing, renamed, or has a changed type. New additive fields should be tested separately to confirm presence and correct typing. The existing test file at `packages/features/webhooks/lib/factory/base/BaseBookingPayloadBuilder.test.ts` provides the baseline for this regression coverage.

## Out of Scope

1. **New webhook payload version (v2025-01-01)** — Creating a new versioned builder set at `packages/features/webhooks/lib/factory/versioned/v2025-01-01/` is deferred to future work. Sprint 4 uses additive-only changes to v2021-10-20. See `specs/webhooks-events/future-work.md`.

2. **Webhook retry policy configuration** — Per-subscriber retry strategies, backoff configurations, and failure thresholds are not in the WH-001 through WH-005 scope. Cal.com's existing retry policy (5 retries with exponential backoff) is preserved unchanged.

3. **Webhook delivery analytics** — Dashboard for delivery success rates, latency percentiles, and failure counts per subscriber is not in scope.

4. **Calendly-compatible REST API surface** — Mimicking Calendly's `/webhook_subscriptions` endpoint structure or request/response formats is not in scope. Cal.com's existing webhook management API is preserved.

5. **Sprints 1–3 modifications** — Completed sprints (Availability, Event Types, Calendar Integrations) are not modified unless cross-domain integration testing reveals a critical regression need.

6. **Sprint 5+ features** — Routing Forms (S5), Embed and Share (S6), Admin and Teams (S7), Notifications and Workflows (S8) are out of scope for Sprint 4 design and implementation.

7. **Performance optimization** — No refactoring of the webhook delivery pipeline, payload serialization, subscriber discovery query optimization, or Tasker scheduling for performance unless directly required for behavioral parity.

8. **Webhook event filtering** — Per-subscriber event metadata filtering (e.g., only receive `BOOKING_CREATED` for specific event type IDs or user IDs) is not in the WH-001 through WH-005 scope.

9. **Email/SMS notification changes** — `packages/emails/` and `packages/sms/` are not modified in Sprint 4. Notification parity is Sprint 8 (NF-001 through NF-004).

10. **Breaking changes to existing payloads** — Any change that removes, renames, or changes the type of an existing field in any webhook payload is categorically out of scope and prohibited per `docs/migration/webhook-compatibility.mdx`. This includes the `v2021-10-20` payload structure, HTTP header semantics (`X-Cal-Signature-256`, `X-Cal-Webhook-Version`), and HMAC-SHA256 signing algorithm.
