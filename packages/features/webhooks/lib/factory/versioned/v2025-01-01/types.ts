import type { EventPayloadType } from "../../../dto/types";

/**
 * v2025-01-01 booking event payload.
 *
 * Calendly-aligned payload type with Calendly-parity fields as explicit
 * properties (WH-001, WH-002, WH-004).
 *
 * Extends EventPayloadType with:
 * - Legacy assignmentReason format (same as v2021-10-20 for consistency)
 * - UTM tracking parameters (Calendly invitee.created alignment)
 * - Invitee/Event URI references (Calendly resource URI pattern)
 * - Scheduling URL (the booking link URL)
 * - Reschedule URI (Calendly invitee.canceled alignment)
 * - Cancellation timestamp (ISO 8601)
 * - Old/New invitee URIs (Calendly reschedule variant)
 *
 * Note: EventPayloadType (from dto/types.ts) is also being extended by
 * a sibling agent to include these fields as optional. This version-specific
 * type re-declares them to document the v2025-01-01 contract explicitly.
 */
export type V20250101BookingEventPayload = Omit<EventPayloadType, "assignmentReason"> & {
  assignmentReason?: { reasonEnum: string; reasonString: string }[] | null;

  // Calendly parity fields (WH-001: invitee.created alignment)
  utmParams?: {
    utmSource?: string;
    utmMedium?: string;
    utmCampaign?: string;
    utmTerm?: string;
    utmContent?: string;
  };
  inviteeUri?: string;
  eventUri?: string;
  schedulingUrl?: string;

  // Calendly parity fields (WH-002: invitee.canceled alignment)
  rescheduleUri?: string;
  cancellationTimestamp?: string;

  // Calendly parity fields (WH-001: invitee.created reschedule variant)
  oldInviteeUri?: string;
  newInviteeUri?: string;
};
