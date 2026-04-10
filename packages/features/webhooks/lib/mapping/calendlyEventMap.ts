import { WebhookTriggerEvents } from "@calcom/prisma/enums";

/**
 * Calendly webhook event types.
 *
 * Calendly's webhook API exposes exactly 3 event types, compared to Cal.com's
 * 21-event superset. This type represents the complete set of Calendly webhook
 * event identifiers as documented at {@link https://developer.calendly.com}.
 *
 * - `"invitee.created"` — Fired when a new invitee is created (booking or reschedule)
 * - `"invitee.canceled"` — Fired when an invitee cancels their booking
 * - `"routing_form_submission.created"` — Fired when a routing form submission occurs
 */
export type CalendlyEventType = "invitee.created" | "invitee.canceled" | "routing_form_submission.created";

/**
 * Exhaustive mapping from every Cal.com `WebhookTriggerEvents` enum value to its
 * Calendly-equivalent event type, or `null` if no Calendly counterpart exists.
 *
 * Cal.com exposes a 21-event webhook trigger superset compared to Calendly's 3
 * event types. This mapping serves as the authoritative cross-reference for
 * Sprint 4 epics WH-001 (invitee.created mapping), WH-002 (invitee.canceled
 * mapping), and WH-003 (routing_form_submission.created mapping).
 *
 * **Key semantic rules:**
 * - Both `BOOKING_CREATED` and `BOOKING_RESCHEDULED` (including the attendee-
 *   initiated variant) map to Calendly's `invitee.created`, because Calendly
 *   re-fires `invitee.created` on reschedule rather than emitting a separate event.
 * - `BOOKING_CANCELLED` maps directly to Calendly's `invitee.canceled`.
 * - `FORM_SUBMITTED` maps to Calendly's `routing_form_submission.created`.
 * - All other Cal.com events (`null` entries) are Cal.com-only events with no
 *   Calendly counterpart, representing Cal.com's superset advantage in webhook
 *   granularity covering payments, meetings, recordings, no-shows, instant
 *   meetings, out-of-office, delegations, and assignment reports.
 *
 * The `Record<WebhookTriggerEvents, CalendlyEventType | null>` type provides
 * compile-time exhaustiveness enforcement — if a new `WebhookTriggerEvents` value
 * is added to the Prisma schema, TypeScript will flag a compile error until the
 * map is updated.
 *
 * @see {@link https://developer.calendly.com | Calendly API Documentation}
 * @see {@link https://cal.com/docs/developing/guides/automation/webhooks | Cal.com Webhook Docs}
 */
export const CALCOM_TO_CALENDLY_MAP: Record<WebhookTriggerEvents, CalendlyEventType | null> = {
  // ── Calendly invitee.created equivalents (WH-001) ──────────────────────
  [WebhookTriggerEvents.BOOKING_CREATED]: "invitee.created",
  [WebhookTriggerEvents.BOOKING_RESCHEDULED]: "invitee.created",
  [WebhookTriggerEvents.BOOKING_RESCHEDULED_BY_ATTENDEE]: "invitee.created",

  // ── Calendly invitee.canceled equivalent (WH-002) ──────────────────────
  [WebhookTriggerEvents.BOOKING_CANCELLED]: "invitee.canceled",

  // ── Calendly routing_form_submission.created equivalent (WH-003) ───────
  [WebhookTriggerEvents.FORM_SUBMITTED]: "routing_form_submission.created",

  // ── Cal.com-only events — no Calendly equivalent ───────────────────────
  [WebhookTriggerEvents.BOOKING_PAYMENT_INITIATED]: null,
  [WebhookTriggerEvents.BOOKING_PAID]: null,
  [WebhookTriggerEvents.BOOKING_REQUESTED]: null,
  [WebhookTriggerEvents.BOOKING_REJECTED]: null,
  [WebhookTriggerEvents.BOOKING_NO_SHOW_UPDATED]: null,
  [WebhookTriggerEvents.MEETING_ENDED]: null,
  [WebhookTriggerEvents.MEETING_STARTED]: null,
  [WebhookTriggerEvents.RECORDING_READY]: null,
  [WebhookTriggerEvents.INSTANT_MEETING]: null,
  [WebhookTriggerEvents.RECORDING_TRANSCRIPTION_GENERATED]: null,
  [WebhookTriggerEvents.OOO_CREATED]: null,
  [WebhookTriggerEvents.AFTER_HOSTS_CAL_VIDEO_NO_SHOW]: null,
  [WebhookTriggerEvents.AFTER_GUESTS_CAL_VIDEO_NO_SHOW]: null,
  [WebhookTriggerEvents.FORM_SUBMITTED_NO_EVENT]: null,
  [WebhookTriggerEvents.DELEGATION_CREDENTIAL_ERROR]: null,
  [WebhookTriggerEvents.WRONG_ASSIGNMENT_REPORT]: null,
};

/**
 * Cal.com trigger events that correspond to Calendly's `invitee.created` event.
 *
 * In Calendly's model, both new bookings and reschedules fire `invitee.created`.
 * Cal.com distinguishes these with separate trigger events for finer-grained
 * webhook control, but they all map to the same Calendly semantic.
 *
 * @see WH-001 — invitee.created mapping epic
 */
export const CALENDLY_INVITEE_CREATED_TRIGGERS = [
  WebhookTriggerEvents.BOOKING_CREATED,
  WebhookTriggerEvents.BOOKING_RESCHEDULED,
  WebhookTriggerEvents.BOOKING_RESCHEDULED_BY_ATTENDEE,
] as const;

/**
 * Cal.com trigger events that correspond to Calendly's `invitee.canceled` event.
 *
 * Calendly fires `invitee.canceled` when an invitee cancels their event.
 * Cal.com maps this directly to its `BOOKING_CANCELLED` trigger event.
 *
 * @see WH-002 — invitee.canceled mapping epic
 */
export const CALENDLY_INVITEE_CANCELED_TRIGGERS = [WebhookTriggerEvents.BOOKING_CANCELLED] as const;

/**
 * Cal.com trigger events that correspond to Calendly's `routing_form_submission.created` event.
 *
 * Calendly fires `routing_form_submission.created` when a routing form is submitted.
 * Cal.com maps this directly to its `FORM_SUBMITTED` trigger event. Note that
 * `FORM_SUBMITTED_NO_EVENT` is a Cal.com-specific variant that has no Calendly equivalent.
 *
 * @see WH-003 — routing_form_submission.created mapping epic
 */
export const CALENDLY_FORM_SUBMITTED_TRIGGERS = [WebhookTriggerEvents.FORM_SUBMITTED] as const;

/**
 * Returns the Calendly-equivalent event type for a given Cal.com webhook trigger event.
 *
 * Performs a direct lookup in the exhaustive `CALCOM_TO_CALENDLY_MAP`. Since the map
 * covers every `WebhookTriggerEvents` value, the lookup is guaranteed to return a valid
 * result for any enum member.
 *
 * @param trigger - A Cal.com `WebhookTriggerEvents` enum value
 * @returns The corresponding Calendly event type string, or `null` if the Cal.com
 *          event has no Calendly equivalent
 *
 * @example
 * ```ts
 * getCalendlyEquivalent(WebhookTriggerEvents.BOOKING_CREATED);
 * // → "invitee.created"
 *
 * getCalendlyEquivalent(WebhookTriggerEvents.BOOKING_CANCELLED);
 * // → "invitee.canceled"
 *
 * getCalendlyEquivalent(WebhookTriggerEvents.MEETING_STARTED);
 * // → null (Cal.com-only event)
 * ```
 */
export function getCalendlyEquivalent(trigger: WebhookTriggerEvents): CalendlyEventType | null {
  return CALCOM_TO_CALENDLY_MAP[trigger];
}

/**
 * Returns all Cal.com webhook trigger events that correspond to a given Calendly event type.
 *
 * This is the reverse mapping of `getCalendlyEquivalent`. It filters the exhaustive
 * `CALCOM_TO_CALENDLY_MAP` to find all Cal.com trigger events that map to the
 * specified Calendly event type.
 *
 * @param calendlyEvent - A Calendly event type string (e.g., `"invitee.created"`)
 * @returns An array of `WebhookTriggerEvents` values that map to the specified
 *          Calendly event type. Returns an empty array if no Cal.com events
 *          correspond (which should not occur for valid `CalendlyEventType` values).
 *
 * @example
 * ```ts
 * getCalcomTriggersForCalendlyEvent("invitee.created");
 * // → [WebhookTriggerEvents.BOOKING_CREATED,
 * //    WebhookTriggerEvents.BOOKING_RESCHEDULED,
 * //    WebhookTriggerEvents.BOOKING_RESCHEDULED_BY_ATTENDEE]
 *
 * getCalcomTriggersForCalendlyEvent("invitee.canceled");
 * // → [WebhookTriggerEvents.BOOKING_CANCELLED]
 *
 * getCalcomTriggersForCalendlyEvent("routing_form_submission.created");
 * // → [WebhookTriggerEvents.FORM_SUBMITTED]
 * ```
 */
export function getCalcomTriggersForCalendlyEvent(calendlyEvent: CalendlyEventType): WebhookTriggerEvents[] {
  return (
    Object.entries(CALCOM_TO_CALENDLY_MAP) as [WebhookTriggerEvents, CalendlyEventType | null][]
  )
    .filter(([, value]) => value === calendlyEvent)
    .map(([key]) => key);
}
