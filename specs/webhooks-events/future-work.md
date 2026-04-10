# Webhooks and Events Future Work

Ideas and enhancements deferred from the Sprint 4: Webhooks and Events initial implementation.

## Enhancements

- Webhook retry policy configuration parity — allow per-webhook retry strategy with configurable max retries, backoff intervals, and failure thresholds (beyond Calendly's basic retry model)
- Webhook event filtering granularity — allow subscribers to filter webhook deliveries by event type metadata (e.g., only receive BOOKING_CREATED for specific event type IDs)
- Webhook delivery analytics dashboard — visual display of delivery success rates, latency percentiles, failure counts per subscriber
- Per-subscriber payload version override — allow individual webhook subscribers to opt into newer payload versions while others remain on v2021-10-20
- Calendly-compatible webhook API surface — REST API endpoints mimicking Calendly's `/webhook_subscriptions` endpoint semantics for easier migration by integration partners
- Batch webhook delivery — deliver multiple events in a single HTTP payload for high-volume consumers to reduce HTTP overhead

## Technical Debt

- Consolidate payload builder test coverage — existing `BaseBookingPayloadBuilder.test.ts` has partial coverage; unified test suite covering all trigger-to-builder-category mappings
- Standardize error logging across webhook delivery pipeline — currently has inconsistent error context between `sendPayload.ts`, `WebhookNotificationHandler.ts`, and `WebhookService.ts`
- Extract `TRIGGER_TO_BUILDER_CATEGORY` mapping into a declarative configuration file to reduce factory class complexity

## Nice to Have

- GraphQL subscription alternative to webhook HTTP POST delivery
- Webhook signature verification SDK for common languages (Python, Ruby, Go, Java) to simplify consumer implementation
- Webhook payload schema documentation auto-generation from TypeScript DTO types
