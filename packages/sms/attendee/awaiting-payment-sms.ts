import { WEBAPP_URL } from "@calcom/lib/constants";
import type { CalendarEvent, Person } from "@calcom/types/Calendar";

import SMSManager from "../sms-manager";

export default class AwaitingPaymentSMS extends SMSManager {
  constructor(calEvent: CalendarEvent) {
    super(calEvent);
  }

  getMessage(attendee: Person) {
    const t = attendee.language.translate;

    // Personalized greeting with attendee name and event title (Calendly parity — NF-002)
    const greetingText = `${t("hey_there")} ${attendee.name}, ${this.calEvent.title}`;

    // Payment awaiting notification with event details
    const messageText = `${t("meeting_awaiting_payment")}: ${t("complete_your_booking_subject", {
      title: this.calEvent.title,
      date: this.getFormattedDate(attendee.timeZone, attendee.language.locale),
      interpolation: { escapeValue: false },
    })}`;

    // Payment completion link
    const bookingUrl = `${this.calEvent.bookerUrl ?? WEBAPP_URL}/booking/${this.calEvent.uid}?changes=true`;

    const urlText = t("you_can_view_booking_details_with_this_url", {
      url: bookingUrl,
      interpolation: { escapeValue: false },
    });

    // Cancel/reschedule link for Calendly parity (NF-002)
    const cancelUrl = `${this.calEvent.bookerUrl ?? WEBAPP_URL}/booking/${this.calEvent.uid}?cancel=true`;
    const cancelText = `${t("need_to_reschedule_or_cancel")} ${cancelUrl}`;

    return `${greetingText}\n\n${messageText}\n\n${urlText}\n\n${cancelText}`;
  }
}
