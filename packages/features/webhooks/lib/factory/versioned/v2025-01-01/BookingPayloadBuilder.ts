import { getUTCOffsetByTimezone } from "@calcom/lib/dayjs";
import { BookingStatus, WebhookTriggerEvents } from "@calcom/prisma/enums";
import type { CalEventResponses } from "@calcom/types/Calendar";

import type { BookingWebhookEventDTO } from "../../../dto/types";
import {
  BaseBookingPayloadBuilder,
  type BookingExtraDataMap,
  type BookingPayloadParams,
} from "../../base/BaseBookingPayloadBuilder";
import type { WebhookPayload } from "../../types";
import type { V20250101BookingEventPayload } from "./types";

/** Default labels for system booking fields (form-builder / E2E expectation) */
const SYSTEM_FIELD_DEFAULT_LABELS: Record<string, string> = {
  name: "your_name",
  email: "email_address",
};

/**
 * Calendly parity field keys that may be present on booking DTOs (WH-001, WH-002, WH-004).
 *
 * These keys are extracted from the DTO and placed as first-class properties
 * on the v2025-01-01 payload, providing Calendly-aligned field semantics:
 * - utmParams      → UTM tracking parameters (Calendly invitee.created)
 * - inviteeUri     → Canonical invitee resource URI
 * - eventUri       → Canonical event resource URI
 * - schedulingUrl  → The booking link URL used by the invitee
 * - rescheduleUri  → URI for the rescheduled-from booking
 * - cancellationTimestamp → ISO 8601 cancellation time
 * - oldInviteeUri  → Previous invitee URI (reschedule variant)
 * - newInviteeUri  → New invitee URI (reschedule variant)
 */
const CALENDLY_PARITY_KEYS = [
  "utmParams",
  "inviteeUri",
  "eventUri",
  "schedulingUrl",
  "rescheduleUri",
  "cancellationTimestamp",
  "oldInviteeUri",
  "newInviteeUri",
] as const;

/**
 * Normalize responses so system fields use default labels when label equals field name.
 * getCalEventResponses uses field name as label when bookingFields is missing;
 * E2E expects default labels (your_name, email_address).
 */
function normalizeResponses(responses: CalEventResponses | null | undefined): CalEventResponses | undefined {
  if (!responses || typeof responses !== "object") return undefined;
  const out: CalEventResponses = {};
  for (const [name, entry] of Object.entries(responses)) {
    if (!entry || typeof entry !== "object") continue;
    const defaultLabel = SYSTEM_FIELD_DEFAULT_LABELS[name];
    const label =
      defaultLabel && (entry.label === name || entry.label === undefined)
        ? defaultLabel
        : (entry.label ?? name);
    out[name] = { ...entry, label };
  }
  return out;
}

/**
 * Derive firstName/lastName from name for legacy payload parity
 * (attendees[].firstName, attendees[].lastName).
 */
function nameToFirstAndLast(name: string): { firstName: string; lastName: string } {
  const trimmed = (name ?? "").trim();
  if (!trimmed) return { firstName: "", lastName: "" };
  const firstSpace = trimmed.indexOf(" ");
  if (firstSpace === -1) return { firstName: trimmed, lastName: "" };
  return {
    firstName: trimmed.slice(0, firstSpace),
    lastName: trimmed.slice(firstSpace + 1).trim(),
  };
}

/**
 * Booking payload builder for webhook version v2025-01-01.
 *
 * Core booking event builder implementing Calendly parity for the v2025-01-01
 * webhook version (WH-004, WH-005). Handles all 9 booking trigger events:
 *   BOOKING_CREATED, BOOKING_CANCELLED, BOOKING_REQUESTED, BOOKING_REJECTED,
 *   BOOKING_RESCHEDULED, BOOKING_RESCHEDULED_BY_ATTENDEE, BOOKING_PAID,
 *   BOOKING_PAYMENT_INITIATED, BOOKING_NO_SHOW_UPDATED.
 *
 * Key difference from v2021-10-20:
 * Uses an explicit `enrichWithCalendlyFields()` method to populate Calendly-parity
 * fields as first-class properties on the V20250101BookingEventPayload type,
 * rather than the v2021-10-20 approach of accumulating fields in a private
 * `_calendlyFields` map and spraying them via Object.assign.
 *
 * Preserves full backward compatibility with the v2021-10-20 payload shape —
 * consumers parsing the standard booking fields (title, attendees, organizer,
 * status, etc.) see identical structures.
 */
export class BookingPayloadBuilder extends BaseBookingPayloadBuilder {
  /**
   * Build the complete booking webhook payload for v2025-01-01.
   *
   * Routes each trigger event to the appropriate status and extra data,
   * then delegates to `buildBookingPayload` for payload construction
   * with Calendly parity field enrichment.
   */
  build(dto: BookingWebhookEventDTO): WebhookPayload {
    switch (dto.triggerEvent) {
      case WebhookTriggerEvents.BOOKING_CREATED:
        return this.buildBookingPayload(dto, {
          booking: dto.booking,
          eventType: dto.eventType,
          evt: dto.evt,
          status: BookingStatus.ACCEPTED,
          triggerEvent: dto.triggerEvent,
          createdAt: dto.createdAt,
        });

      case WebhookTriggerEvents.BOOKING_CANCELLED:
        return this.buildBookingPayload(dto, {
          booking: dto.booking,
          eventType: dto.eventType,
          evt: dto.evt,
          status: BookingStatus.CANCELLED,
          triggerEvent: dto.triggerEvent,
          createdAt: dto.createdAt,
          extra: {
            cancelledBy: dto.cancelledBy,
            cancellationReason: dto.cancellationReason,
            requestReschedule: dto.requestReschedule ?? false,
          },
        });

      case WebhookTriggerEvents.BOOKING_REQUESTED:
        return this.buildBookingPayload(dto, {
          booking: dto.booking,
          eventType: dto.eventType,
          evt: dto.evt,
          status: BookingStatus.PENDING,
          triggerEvent: dto.triggerEvent,
          createdAt: dto.createdAt,
          extra: {
            metadata: (dto.metadata ?? {}) as { [key: string]: string | number | boolean | null },
          },
        });

      case WebhookTriggerEvents.BOOKING_REJECTED:
        return this.buildBookingPayload(dto, {
          booking: dto.booking,
          eventType: dto.eventType,
          evt: dto.evt,
          status: BookingStatus.REJECTED,
          triggerEvent: dto.triggerEvent,
          createdAt: dto.createdAt,
        });

      case WebhookTriggerEvents.BOOKING_RESCHEDULED:
        return this.buildBookingPayload(dto, {
          booking: dto.booking,
          eventType: dto.eventType,
          evt: dto.evt,
          status: BookingStatus.ACCEPTED,
          triggerEvent: dto.triggerEvent,
          createdAt: dto.createdAt,
          extra: {
            rescheduleId: dto.rescheduleId,
            rescheduleUid: dto.rescheduleUid,
            rescheduleStartTime: dto.rescheduleStartTime,
            rescheduleEndTime: dto.rescheduleEndTime,
            rescheduledBy: dto.rescheduledBy,
          },
        });

      case WebhookTriggerEvents.BOOKING_RESCHEDULED_BY_ATTENDEE:
        return this.buildBookingPayload(dto, {
          booking: dto.booking,
          eventType: dto.eventType,
          evt: dto.evt,
          status: BookingStatus.ACCEPTED,
          triggerEvent: dto.triggerEvent,
          createdAt: dto.createdAt,
          extra: {
            rescheduleId: dto.rescheduleId,
            rescheduleUid: dto.rescheduleUid,
            rescheduleStartTime: dto.rescheduleStartTime,
            rescheduleEndTime: dto.rescheduleEndTime,
            rescheduledBy: dto.rescheduledBy,
          },
        });

      case WebhookTriggerEvents.BOOKING_PAID:
        return this.buildBookingPayload(dto, {
          booking: dto.booking,
          eventType: dto.eventType,
          evt: dto.evt,
          status: BookingStatus.ACCEPTED,
          triggerEvent: dto.triggerEvent,
          createdAt: dto.createdAt,
          extra: {
            paymentId: dto.paymentId,
            paymentData: dto.paymentData,
          },
        });

      case WebhookTriggerEvents.BOOKING_PAYMENT_INITIATED:
        return this.buildBookingPayload(dto, {
          booking: dto.booking,
          eventType: dto.eventType,
          evt: dto.evt,
          status: BookingStatus.ACCEPTED,
          triggerEvent: dto.triggerEvent,
          createdAt: dto.createdAt,
          extra: {
            paymentId: dto.paymentId,
            paymentData: dto.paymentData,
          },
        });

      case WebhookTriggerEvents.BOOKING_NO_SHOW_UPDATED:
        return this.buildNoShowPayload(dto);

      default: {
        const _exhaustiveCheck: never = dto;
        throw new Error(`Unsupported booking trigger: ${JSON.stringify(_exhaustiveCheck)}`);
      }
    }
  }

  /**
   * Enrich a payload object with Calendly parity fields extracted from the DTO.
   *
   * Unlike the v2021-10-20 approach (which accumulates fields in a private map
   * and sprays via Object.assign), this method explicitly sets typed properties
   * on the V20250101BookingEventPayload, providing compile-time safety for the
   * Calendly parity field contract.
   *
   * Only fields present (not undefined) on the DTO are copied to the payload,
   * ensuring backward-compatible payloads for consumers that do not expect them.
   *
   * @param payload - The booking event payload to enrich
   * @param dto - The source DTO potentially containing Calendly parity fields
   */
  private enrichWithCalendlyFields(
    payload: V20250101BookingEventPayload,
    dto: BookingWebhookEventDTO
  ): void {
    const dtoRecord = dto as unknown as Record<string, unknown>;
    for (const key of CALENDLY_PARITY_KEYS) {
      if (dtoRecord[key] !== undefined) {
        // Type-safe assignment — V20250101BookingEventPayload declares all 8 keys as optional
        (payload as Record<string, unknown>)[key] = dtoRecord[key];
      }
    }
  }

  /**
   * Build the standard booking payload structure for v2025-01-01.
   *
   * Constructs the full booking event payload with:
   * - Organizer and attendee UTC offset calculations
   * - Event type metadata (title, description, price, currency, length)
   * - Response label normalization for form-builder fields
   * - Trigger-specific extra fields (cancellation reason, reschedule info, etc.)
   * - Calendly parity fields via enrichWithCalendlyFields()
   *
   * @param dto - The raw BookingWebhookEventDTO for Calendly field extraction
   * @param params - Structured booking payload parameters
   * @returns Complete WebhookPayload ready for dispatch
   */
  private buildBookingPayload<T extends keyof BookingExtraDataMap>(
    dto: BookingWebhookEventDTO,
    params: BookingPayloadParams<T>
  ): WebhookPayload {
    const utcOffsetOrganizer = getUTCOffsetByTimezone(params.evt.organizer?.timeZone, params.evt.startTime);
    const organizer = {
      ...params.evt.organizer,
      utcOffset: utcOffsetOrganizer,
      usernameInOrg: params.evt.organizer?.usernameInOrg,
    };

    const attendeesWithLegacyFields =
      params.evt.attendees?.map((a) => {
        const utcOffset = getUTCOffsetByTimezone(a.timeZone, params.evt.startTime);
        const nameParts =
          "firstName" in a && "lastName" in a
            ? {
                firstName: (a as { firstName?: string }).firstName ?? "",
                lastName: (a as { lastName?: string }).lastName ?? "",
              }
            : nameToFirstAndLast(a.name ?? "");
        return {
          ...a,
          utcOffset,
          firstName: nameParts.firstName,
          lastName: nameParts.lastName,
        };
      }) ?? [];

    // Destructure assignmentReason out of evt so it doesn't leak via the
    // spread — this version uses its own legacy-shaped field instead.
    const { assignmentReason: _evtAssignmentReason, ...evtWithoutAssignmentReason } = params.evt;

    const payload: V20250101BookingEventPayload = {
      ...evtWithoutAssignmentReason,
      bookingId: params.booking.id,
      startTime: params.evt.startTime,
      endTime: params.evt.endTime,
      title: params.evt.title,
      type: params.evt.type,
      hashedLink: params.evt.hashedLink ?? null,
      conferenceData: params.evt.conferenceData,
      organizer,
      attendees: attendeesWithLegacyFields,
      location: params.evt.location,
      uid: params.evt.uid,
      customInputs: params.evt.customInputs,
      responses: normalizeResponses(params.evt.responses) ?? params.evt.responses,
      userFieldsResponses: params.evt.userFieldsResponses,
      status: params.status,
      eventTitle: params.eventType?.eventTitle,
      eventDescription: params.eventType?.eventDescription ?? null,
      requiresConfirmation: params.eventType?.requiresConfirmation ?? null,
      price: params.eventType?.price ?? 0,
      currency: params.eventType?.currency ?? "usd",
      length: params.eventType?.length ?? null,
      smsReminderNumber: params.booking.smsReminderNumber || undefined,
      additionalNotes: params.evt.additionalNotes ?? "",
      description: params.evt.description ?? params.evt.additionalNotes ?? "",
      assignmentReason: params.booking.assignmentReason ?? null,
      destinationCalendar: params.evt.destinationCalendar ?? null,
      ...(params.extra || {}),
    };

    // Enrich with Calendly parity fields (WH-001, WH-002, WH-004)
    this.enrichWithCalendlyFields(payload, dto);

    return {
      triggerEvent: params.triggerEvent,
      createdAt: params.createdAt,
      payload: payload as WebhookPayload["payload"],
    };
  }

  /**
   * Build the no-show updated payload for v2025-01-01.
   *
   * Handles BOOKING_NO_SHOW_UPDATED with bookingUid, bookingId, attendees, and message.
   * Identical to v2021-10-20 format — no Calendly-specific no-show events exist.
   */
  private buildNoShowPayload(dto: BookingWebhookEventDTO): WebhookPayload {
    if (dto.triggerEvent !== WebhookTriggerEvents.BOOKING_NO_SHOW_UPDATED) {
      throw new Error("Invalid trigger event for no-show payload");
    }
    return {
      triggerEvent: dto.triggerEvent,
      createdAt: dto.createdAt,
      payload: {
        bookingUid: dto.bookingUid,
        bookingId: dto.bookingId,
        attendees: dto.attendees,
        message: dto.message,
      },
    };
  }
}
