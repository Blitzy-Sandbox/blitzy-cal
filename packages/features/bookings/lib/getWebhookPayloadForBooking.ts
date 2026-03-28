import type { EventPayloadType, EventTypeInfo } from "@calcom/features/webhooks/lib/sendPayload";
import type { CalendarEvent } from "@calcom/types/Calendar";

export const getWebhookPayloadForBooking = ({
  booking,
  evt,
}: {
  booking: {
    eventType: {
      title: string;
      description: string | null;
      requiresConfirmation: boolean;
      price: number;
      currency: string;
      length: number;
      id: number;
      slug?: string;
    } | null;
    id: number;
    eventTypeId: number | null;
    userId: number | null;
    uid?: string;
    startTime?: string | Date;
    metadata?: Record<string, string | number | boolean | null | undefined>;
  };
  evt: CalendarEvent;
}) => {
  const eventTypeInfo: EventTypeInfo = {
    eventTitle: booking.eventType?.title,
    eventDescription: booking.eventType?.description,
    requiresConfirmation: booking.eventType?.requiresConfirmation || null,
    price: booking.eventType?.price,
    currency: booking.eventType?.currency,
    length: booking.eventType?.length,
  };

  // WH-001: Extract UTM parameters from booking metadata for Calendly invitee.created parity
  const utmParams = booking.metadata
    ? {
        utmSource: booking.metadata.utm_source != null ? String(booking.metadata.utm_source) : undefined,
        utmMedium: booking.metadata.utm_medium != null ? String(booking.metadata.utm_medium) : undefined,
        utmCampaign: booking.metadata.utm_campaign != null ? String(booking.metadata.utm_campaign) : undefined,
        utmTerm: booking.metadata.utm_term != null ? String(booking.metadata.utm_term) : undefined,
        utmContent: booking.metadata.utm_content != null ? String(booking.metadata.utm_content) : undefined,
      }
    : undefined;

  // WH-001: Construct Calendly-equivalent invitee resource URI
  const inviteeUri = booking.uid
    ? `/bookings/${booking.uid}`
    : evt.uid
      ? `/bookings/${evt.uid}`
      : undefined;

  // WH-001: Construct Calendly-equivalent event resource URI
  const eventUri = booking.eventTypeId
    ? `/event-types/${booking.eventTypeId}`
    : undefined;

  // WH-001: Construct scheduling URL from booker URL and event type context
  const schedulingUrl = evt.bookerUrl && booking.eventType?.slug
    ? `${evt.bookerUrl}/${booking.eventType.slug}`
    : evt.bookerUrl && evt.type
      ? `${evt.bookerUrl}/${evt.type}`
      : undefined;

  // WH-002: Construct Calendly-equivalent reschedule URI
  const rescheduleUri = evt.platformRescheduleUrl
    ? evt.platformRescheduleUrl
    : booking.uid
      ? `/booking/${booking.uid}/reschedule`
      : evt.uid
        ? `/booking/${evt.uid}/reschedule`
        : undefined;

  // WH-002: Provide cancellation timestamp for invitee.canceled alignment
  const cancellationTimestamp = evt.cancellationReason != null
    ? new Date().toISOString()
    : undefined;

  const { assignmentReason: _emailAssignmentReason, ...evtWithoutAssignmentReason } = evt;
  const payload: EventPayloadType = {
    ...evtWithoutAssignmentReason,
    ...eventTypeInfo,
    bookingId: booking.id,
    // Calendly parity fields (WH-001, WH-002, WH-004)
    ...(utmParams !== undefined && { utmParams }),
    ...(inviteeUri !== undefined && { inviteeUri }),
    ...(eventUri !== undefined && { eventUri }),
    ...(schedulingUrl !== undefined && { schedulingUrl }),
    ...(rescheduleUri !== undefined && { rescheduleUri }),
    ...(cancellationTimestamp !== undefined && { cancellationTimestamp }),
  };

  return payload;
};
