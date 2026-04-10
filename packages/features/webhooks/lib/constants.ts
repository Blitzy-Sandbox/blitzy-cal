import { WebhookTriggerEvents } from "@calcom/prisma/enums";

import { WebhookVersion } from "./interface/IWebhookRepository";

// this is exported as we can't use `WebhookTriggerEvents` in the frontend straight-off

/**
 * Version label map - transforms version enum values to display labels.
 * Since our version values ARE date strings (e.g., "2021-10-20"), labels match values.
 * This map allows for custom labels if needed in the future.
 */
export const WEBHOOK_VERSION_LABELS: Record<WebhookVersion, string> = {
  [WebhookVersion.V_2021_10_20]: "2021-10-20",
  [WebhookVersion.V_2025_01_01]: "2025-01-01",
  // Add new versions here: [WebhookVersion.V_YYYY_MM_DD]: "YYYY-MM-DD",
};

/**
 * Pre-built options for Select components - automatically generated from all versions
 */
export const WEBHOOK_VERSION_OPTIONS = Object.values(WebhookVersion).map((version) => ({
  value: version,
  label: WEBHOOK_VERSION_LABELS[version] ?? version,
}));

/**
 * Get display label for a version
 */
export const getWebhookVersionLabel = (version: WebhookVersion): string =>
  WEBHOOK_VERSION_LABELS[version] ?? version;

/**
 * Documentation URLs for each webhook version.
 * Links to the specific version's payload documentation.
 */
export const WEBHOOK_VERSION_DOCS: Record<WebhookVersion, string> = {
  [WebhookVersion.V_2021_10_20]: "https://cal.com/docs/developing/guides/automation/webhooks#2021-10-20",
  [WebhookVersion.V_2025_01_01]: "https://cal.com/docs/developing/guides/automation/webhooks#2025-01-01",
  // Add new versions here: [WebhookVersion.V_YYYY_MM_DD]: "https://cal.com/docs/webhooks/v-yyyy-mm-dd",
};

/**
 * Get documentation URL for a specific webhook version
 */
export const getWebhookVersionDocsUrl = (version: WebhookVersion): string =>
  WEBHOOK_VERSION_DOCS[version] ?? "https://cal.com/docs/developing/guides/automation/webhooks";

/**
 * Webhook trigger events grouped by application domain.
 *
 * **Calendly Event Mapping (WH-001 through WH-003):**
 *
 * Cal.com provides a superset of Calendly's webhook event model. Calendly exposes
 * only 3 webhook event types, while Cal.com offers 20 trigger events across two
 * domains (core booking lifecycle and routing forms). The mapping is as follows:
 *
 * | Cal.com Event              | Calendly Equivalent                      | Notes                                   |
 * |----------------------------|------------------------------------------|-----------------------------------------|
 * | `BOOKING_CREATED`          | `invitee.created`                        | New booking creation (WH-001)           |
 * | `BOOKING_RESCHEDULED`      | `invitee.created` (reschedule variant)   | Calendly re-fires invitee.created       |
 * | `BOOKING_CANCELLED`        | `invitee.canceled`                       | Booking cancellation (WH-002)           |
 * | `FORM_SUBMITTED`           | `routing_form_submission.created`        | Routing form submission (WH-003)        |
 *
 * The remaining 16 Cal.com trigger events have no Calendly equivalent, representing
 * Cal.com's superset advantage in webhook granularity. These cover payments, meetings,
 * recordings, no-shows, instant meetings, out-of-office, delegations, and more.
 *
 * @see {@link https://developer.calendly.com | Calendly API Documentation}
 * @see {@link https://cal.com/docs/developing/guides/automation/webhooks | Cal.com Webhook Docs}
 */
export const WEBHOOK_TRIGGER_EVENTS_GROUPED_BY_APP = {
  core: [
    WebhookTriggerEvents.BOOKING_CANCELLED, // → Calendly: invitee.canceled
    WebhookTriggerEvents.BOOKING_CREATED, // → Calendly: invitee.created (new booking)
    WebhookTriggerEvents.BOOKING_RESCHEDULED, // → Calendly: invitee.created (reschedule variant)
    WebhookTriggerEvents.BOOKING_PAID, // No Calendly equivalent
    WebhookTriggerEvents.BOOKING_PAYMENT_INITIATED, // No Calendly equivalent
    WebhookTriggerEvents.MEETING_ENDED, // No Calendly equivalent
    WebhookTriggerEvents.MEETING_STARTED, // No Calendly equivalent
    WebhookTriggerEvents.BOOKING_REQUESTED, // No Calendly equivalent
    WebhookTriggerEvents.BOOKING_REJECTED, // No Calendly equivalent
    WebhookTriggerEvents.RECORDING_READY, // No Calendly equivalent
    WebhookTriggerEvents.INSTANT_MEETING, // No Calendly equivalent
    WebhookTriggerEvents.RECORDING_TRANSCRIPTION_GENERATED, // No Calendly equivalent
    WebhookTriggerEvents.BOOKING_NO_SHOW_UPDATED, // No Calendly equivalent
    WebhookTriggerEvents.OOO_CREATED, // No Calendly equivalent
    WebhookTriggerEvents.AFTER_HOSTS_CAL_VIDEO_NO_SHOW, // No Calendly equivalent
    WebhookTriggerEvents.AFTER_GUESTS_CAL_VIDEO_NO_SHOW, // No Calendly equivalent
    WebhookTriggerEvents.DELEGATION_CREDENTIAL_ERROR, // No Calendly equivalent
    WebhookTriggerEvents.WRONG_ASSIGNMENT_REPORT, // No Calendly equivalent
  ] as const,
  "routing-forms": [
    WebhookTriggerEvents.FORM_SUBMITTED, // → Calendly: routing_form_submission.created
    WebhookTriggerEvents.FORM_SUBMITTED_NO_EVENT, // No Calendly equivalent
  ] as const,
};

export const WEBHOOK_TRIGGER_EVENTS = [
  ...WEBHOOK_TRIGGER_EVENTS_GROUPED_BY_APP.core,
  ...WEBHOOK_TRIGGER_EVENTS_GROUPED_BY_APP["routing-forms"],
] as const;
