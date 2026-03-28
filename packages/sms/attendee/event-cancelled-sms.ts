import { WEBAPP_URL } from "@calcom/lib/constants";
import type { CalendarEvent, Person } from "@calcom/types/Calendar";

import SMSManager from "../sms-manager";

export default class EventCancelledSMS extends SMSManager {
  constructor(calEvent: CalendarEvent) {
    super(calEvent);
  }

  getMessage(attendee: Person): string {
    const t = attendee.language.translate;
    const bookingUrl = `${this.calEvent.bookerUrl ?? WEBAPP_URL}/booking/${this.calEvent.uid}`;

    // Greeting + cancellation notice + event details (preserved)
    const messageText = `${t("hey_there")} ${attendee.name}, ${t("event_request_cancelled")}\n\n${t(
      "event_cancelled_subject",
      {
        title: typeof this.calEvent.title === "string" ? this.calEvent.title : "Untitled Event",
        date: this.getFormattedDate(attendee.timeZone, attendee.language.locale),
        interpolation: { escapeValue: false },
      }
    )}`;

    // Who cancelled — organizer or team name for Calendly parity (NF-002)
    const cancelledByName = this.calEvent.team?.name || this.calEvent.organizer.name;
    const cancelledByText = `${t("cancelled_by")}: ${cancelledByName}`;

    // Cancellation reason — only included when a genuine cancellation reason is provided.
    // Reasons prefixed with "$RCH$" are reschedule markers and must be excluded.
    const cancellationReason = this.calEvent.cancellationReason;
    const hasValidCancellationReason =
      !!cancellationReason && !cancellationReason.startsWith("$RCH$");
    const reasonText = hasValidCancellationReason
      ? `\n${t("reason")}: ${cancellationReason}`
      : "";

    // Booking details link (preserved)
    const urlText = t("you_can_view_booking_details_with_this_url", {
      url: bookingUrl,
      interpolation: { escapeValue: false },
    });

    // Rebooking link — directs attendee to the organizer's booking page for Calendly parity (NF-002)
    const rebookBaseUrl = this.calEvent.bookerUrl ?? WEBAPP_URL;
    const rebookUrl = this.calEvent.organizer.username
      ? `${rebookBaseUrl}/${this.calEvent.organizer.username}`
      : rebookBaseUrl;
    const rebookText = `${t("book_a_new_time")}: ${rebookUrl}`;

    return `${messageText}\n\n${cancelledByText}${reasonText}\n\n${urlText}\n\n${rebookText}`;
  }
}
