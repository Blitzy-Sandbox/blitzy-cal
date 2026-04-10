import { WEBAPP_URL } from "@calcom/lib/constants";
import type { CalendarEvent, Person } from "@calcom/types/Calendar";

import SMSManager from "../sms-manager";

export default class EventLocationChangedSMS extends SMSManager {
  constructor(calEvent: CalendarEvent) {
    super(calEvent);
  }

  getMessage(attendee: Person) {
    const t = attendee.language.translate;

    // Personalized greeting with attendee name (Calendly parity: every notification is personalized)
    const greetingText = `${t("hey_there")} ${attendee.name},`;

    // Location change notice with event title and date/time context so the attendee
    // knows which event's location changed — matching Calendly's detailed notification format
    const locationChangedText = `${t("event_location_changed")}\n\n${t("event_cancelled_subject", {
      title: typeof this.calEvent.title === "string" ? this.calEvent.title : "Untitled Event",
      date: this.getFormattedDate(attendee.timeZone, attendee.language.locale),
      interpolation: { escapeValue: false },
    })}`;

    // Conditionally include new location details if available (Calendly shows the updated venue/link)
    const locationDetail = this.calEvent.location
      ? `\n\n${t("location")}: ${this.calEvent.location}`
      : "";

    const bookingUrl = `${this.calEvent.bookerUrl ?? WEBAPP_URL}/booking/${this.calEvent.uid}?changes=true`;

    const urlText = t("you_can_view_booking_details_with_this_url", {
      url: bookingUrl,
      interpolation: { escapeValue: false },
    });

    return `${greetingText} ${locationChangedText}${locationDetail}\n\n${urlText}`;
  }
}
