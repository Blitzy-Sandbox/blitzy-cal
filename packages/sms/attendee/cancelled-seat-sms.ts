import { WEBAPP_URL } from "@calcom/lib/constants";
import type { CalendarEvent, Person } from "@calcom/types/Calendar";

import SMSManager from "../sms-manager";

export default class CancelledSeatSMS extends SMSManager {
  constructor(calEvent: CalendarEvent) {
    super(calEvent);
  }

  getMessage(attendee: Person): string {
    const t = attendee.language.translate;

    // Seat cancellation notice with attendee name (Calendly parity — personalized notification)
    const seatCancellationText = t("no_longer_attending", {
      name: attendee.name,
    });

    // Event details with team/organizer name and formatted date
    const eventDetailsText = t("event_no_longer_attending_subject", {
      name: this.calEvent.team?.name || this.calEvent.organizer.name,
      date: this.getFormattedDate(attendee.timeZone, attendee.language.locale),
      interpolation: { escapeValue: false },
    });

    // Event title for Calendly parity — attendee sees which event lost their seat
    const eventTitle = typeof this.calEvent.title === "string" ? this.calEvent.title : "Untitled Event";

    // Rebooking link URL for Calendly parity — attendee can view booking details or re-book
    const bookingUrl = `${this.calEvent.bookerUrl ?? WEBAPP_URL}/booking/${this.calEvent.uid}`;
    const urlText = t("you_can_view_booking_details_with_this_url", {
      url: bookingUrl,
      interpolation: { escapeValue: false },
    });

    return `${seatCancellationText}\n\n${eventDetailsText}\n\n${eventTitle}\n\n${urlText}`;
  }
}
