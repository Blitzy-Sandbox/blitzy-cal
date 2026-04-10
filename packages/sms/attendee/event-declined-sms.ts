import { WEBAPP_URL } from "@calcom/lib/constants";
import type { CalendarEvent, Person } from "@calcom/types/Calendar";

import SMSManager from "../sms-manager";

export default class EventDeclinedSMS extends SMSManager {
  constructor(calEvent: CalendarEvent) {
    super(calEvent);
  }

  getMessage(attendee: Person) {
    const t = attendee.language.translate;

    const eventDeclinedText = t("event_declined_subject", {
      title: this.calEvent.title,
      date: this.getFormattedDate(attendee.timeZone, attendee.language.locale),
      interpolation: { escapeValue: false },
    });

    const messageText = `${t("hey_there")} ${attendee.name}, ${t(
      "event_request_declined"
    )} ${eventDeclinedText}`;

    // Construct booking URL for viewing details or rebooking (Calendly NF-002 parity)
    const bookingUrl = `${this.calEvent.bookerUrl ?? WEBAPP_URL}/booking/${this.calEvent.uid}`;

    const urlText = t("you_can_view_booking_details_with_this_url", {
      url: bookingUrl,
      interpolation: { escapeValue: false },
    });

    return `${messageText}\n\n${urlText}`;
  }
}
