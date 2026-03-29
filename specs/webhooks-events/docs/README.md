# Webhooks and Events

## Overview

Sprint 4: Webhooks and Events (F-010) aligns Cal.com's 20-event webhook system with Calendly's 3 webhook event semantics — `invitee.created`, `invitee.canceled`, and `routing_form_submission.created` — ensuring that integrations migrating from Calendly can consume Cal.com webhook payloads with minimal adaptation. This feature encompasses five core epics: `invitee.created` event mapping parity (WH-001), `invitee.canceled` event mapping parity (WH-002), `routing_form_submission.created` parity (WH-003), payload structure alignment with Calendly expectations (WH-004), and webhook versioning strategy for gap closure additions (WH-005). All changes are additive-only — the existing `v2021-10-20` payload format is preserved exactly without breaking changes, so existing webhook consumers continue to function without modification. Cal.com already significantly exceeds Calendly in webhook capabilities (20 trigger events across 7 categories versus Calendly's 3 events, plus versioned payload builders, HMAC-SHA256 signing, Handlebars custom templates, and Tasker async delivery), so this sprint focuses on semantic alignment and additive field enrichment rather than new infrastructure. This sprint is part of Wave 3, which executes in parallel with Sprint 5 (Routing Forms) and Sprint 7 (Admin and Teams).

## How to Use

### Step 1: Create Webhook Subscriptions and Select Trigger Events

Navigate to **Settings → Developer → Webhooks** (or team/organization settings for team-scoped webhooks) to create new webhook subscriptions. When creating a subscription, select the trigger events that correspond to the Calendly events your integration expects:

- **`BOOKING_CREATED`** → maps to Calendly's `invitee.created` — fires when a new booking is confirmed
- **`BOOKING_RESCHEDULED`** → maps to Calendly's `invitee.created` with reschedule context — fires when an existing booking is moved to a new time
- **`BOOKING_CANCELLED`** → maps to Calendly's `invitee.canceled` — fires when a booking is cancelled by the organizer or an attendee
- **`FORM_SUBMITTED`** → maps to Calendly's `routing_form_submission.created` — fires when a routing form is submitted and matched to an event type

Enter your subscriber URL (the HTTPS endpoint that will receive webhook payloads) and optionally configure an HMAC secret for payload signature verification. Cal.com supports 20 total trigger events — including payment, meeting, recording, out-of-office, delegation, and no-show events — well beyond Calendly's 3, giving your integration access to the full booking lifecycle.

*Screenshot: Navigate to Settings → Developer → Webhooks to view webhook subscription management. Capture this screenshot when the webhook settings UI is available and save as `./screenshots/step-1.png`.*

### Step 2: Configure Payload Options and Verify Delivery

After creating a webhook subscription:

- The payload version is automatically set to `v2021-10-20` (the current default and only registered version). Every delivery includes an `X-Cal-Webhook-Version` header identifying this format version (currently `2021-10-20`).
- Optionally configure a custom payload template using Handlebars syntax to restructure the payload for your integration's specific needs (e.g., `{{triggerEvent}}`, `{{payload.title}}`, `{{payload.attendees[0].email}}`).
- If you configured an HMAC secret, webhook deliveries include an `X-Cal-Signature-256` header containing the HMAC-SHA256 signature (`sha256=<hex>`) computed over the raw JSON body — use this to verify payload authenticity before processing.
- Sprint 4 adds Calendly-equivalent additive fields to booking payloads: UTM tracking parameters (`utmSource`, `utmMedium`, `utmCampaign`, `utmTerm`, `utmContent`) for campaign attribution, reschedule and cancel URL references for direct-action links, and enhanced event metadata — these are available automatically without configuration changes.

*Screenshot: Navigate to webhook subscription detail to view payload version, HMAC secret, and custom template configuration. Capture this screenshot when the webhook detail UI is available and save as `./screenshots/step-2.png`.*

## Configuration Options

| Option | Description | Default |
|--------|-------------|---------|
| Trigger Events | Select which booking lifecycle events fire webhooks to your subscriber URL. Calendly-equivalent mappings: `BOOKING_CREATED` → `invitee.created`, `BOOKING_CANCELLED` → `invitee.canceled`, `BOOKING_RESCHEDULED` → `invitee.created` (reschedule), `FORM_SUBMITTED` → `routing_form_submission.created`. Cal.com supports 20 total trigger events including payment, meeting, recording, and out-of-office events beyond Calendly's 3. | All trigger events enabled for new subscriptions |
| Payload Version | The webhook payload format version. Identifies which versioned builder set constructs the payload body. Currently `v2021-10-20` is the only registered version. The `X-Cal-Webhook-Version` HTTP header communicates this to consumers. | `v2021-10-20` (the only registered version; used as default and fallback) |
| HMAC Secret | An optional shared secret for payload authenticity verification. When configured, the `X-Cal-Signature-256` header contains the HMAC-SHA256 signature (`sha256=<hex>`) computed over the raw JSON body using this secret. Consumers should verify this signature before processing the payload. | No secret (header value: `no-secret-provided`) |
| Custom Payload Template | An optional Handlebars template that restructures the webhook payload before delivery. When set, the template is rendered with the full webhook payload data as the template context. Supports all Handlebars helpers and references any payload field including Sprint 4's new Calendly-equivalent additive fields (UTM tracking, reschedule URL, cancel URL). | No template (full JSON payload delivered as-is) |
| Subscription Scope | The organizational scope of the webhook subscription. Webhooks can be scoped to: user (personal), event type (specific event), team, organization, or platform OAuth client. This exceeds Calendly's organization-scoped and user-scoped subscription model. | User-scoped |

## Common Use Cases

### Booking Lifecycle Notifications for CRM Integrations

When migrating a CRM integration from Calendly to Cal.com, subscribe to `BOOKING_CREATED`, `BOOKING_RESCHEDULED`, and `BOOKING_CANCELLED` trigger events to replicate the `invitee.created` and `invitee.canceled` webhook flows. Sprint 4's payload alignment ensures that booking payloads include attendee details, event metadata, scheduling context, and Calendly-equivalent additive fields (UTM tracking parameters for campaign attribution, reschedule and cancel URL references for direct-action links). Your CRM integration can process these payloads identically to Calendly's webhook format, enabling seamless migration without rewriting integration logic.

### Routing Form Submission Tracking

For integrations that previously consumed Calendly's `routing_form_submission.created` webhook, subscribe to Cal.com's `FORM_SUBMITTED` trigger event. When a visitor submits a routing form and is matched to an event type, the webhook fires with the form fields, routing decision metadata, and submission context. If the form submission does not match any event type, the `FORM_SUBMITTED_NO_EVENT` trigger fires instead — this provides richer tracking than Calendly's single event. Both events include the form identifier, form name, response data, and routing outcome.

### Reschedule Detection Workflows

Cal.com fires separate `BOOKING_RESCHEDULED` events (in addition to `BOOKING_CANCELLED` and `BOOKING_CREATED`) when a booking is moved to a new time. Calendly handles this as an `invitee.canceled` followed by an `invitee.created`. Sprint 4's payload alignment adds reschedule context references to both `BOOKING_RESCHEDULED` and `BOOKING_CANCELLED` payloads, including whether the cancellation was triggered by a reschedule (`isReschedule`) and the UID of the new booking (`rescheduledToBookingUid`). This enables integrations to distinguish pure cancellations from reschedule-induced cancellations and maintain accurate booking lifecycle tracking.

## FAQ

### Will existing webhook integrations break?

No. All Sprint 4 changes are additive-only. The `v2021-10-20` payload structure is preserved exactly — no existing fields are removed, renamed, or have their types changed. Existing webhook consumers continue to receive identical payload structures. New Calendly-equivalent fields (UTM tracking, reschedule URL references, enhanced event metadata) are added as optional fields that appear alongside existing data. The HMAC-SHA256 signature (`X-Cal-Signature-256`) and version header (`X-Cal-Webhook-Version`) continue to function with their current semantics. Consumers that strictly parse known fields and ignore unknown fields will experience zero impact.

### How do Cal.com trigger events map to Calendly webhook events?

Calendly supports 3 webhook event types; Cal.com supports 20. The mapping is: `BOOKING_CREATED` → Calendly's `invitee.created` (new booking confirmation), `BOOKING_RESCHEDULED` → Calendly's `invitee.created` with reschedule context (booking moved to new time), `BOOKING_CANCELLED` → Calendly's `invitee.canceled` (booking cancelled), and `FORM_SUBMITTED` → Calendly's `routing_form_submission.created` (routing form submission). Cal.com's additional 16 trigger events (payment, meeting, recording, out-of-office, delegation, instant meeting, no-show) have no Calendly equivalents and represent Cal.com's broader webhook capability.

### Are UTM tracking parameters available in webhook payloads?

Yes, after Sprint 4 implementation. Booking webhook payloads (for `BOOKING_CREATED`, `BOOKING_RESCHEDULED`, and related events) include optional UTM tracking fields (`utmSource`, `utmMedium`, `utmCampaign`, `utmTerm`, `utmContent`) when the booking originated from a link with UTM parameters. This aligns with Calendly's `invitee.created` payload which includes UTM data for campaign attribution. When a booking is created without UTM parameters (e.g., a direct link without marketing tracking), these fields are `undefined`/omitted — consumers should handle absent UTM data gracefully.
