import { WEBAPP_URL } from "@calcom/lib/constants";
import type { CalendarEvent, Person } from "@calcom/types/Calendar";

import SMSManager from "../sms-manager";

export default class EventSuccessfullyScheduledSMS extends SMSManager {
  constructor(calEvent: CalendarEvent) {
    super(calEvent);
  }

  getMessage(attendee: Person) {
    const t = attendee.language.translate;

    const confirmationText = t("confirming_your_booking_sms", {
      name: attendee.name,
      date: this.getFormattedDate(attendee.timeZone, attendee.language.locale),
      interpolation: { escapeValue: false },
    });

    // Prominently display the event title for Calendly SMS parity (NF-002)
    const eventTitle = this.calEvent.title;

    const bookingUrl = `${this.calEvent.bookerUrl ?? WEBAPP_URL}/booking/${this.calEvent.uid}`;

    const urlText = t("you_can_view_booking_details_with_this_url", {
      url: bookingUrl,
      interpolation: { escapeValue: false },
    });

    // Cancel and reschedule links for Calendly SMS parity (NF-002)
    const cancelUrl = `${bookingUrl}?cancel=true`;
    const rescheduleUrl = `${bookingUrl}?reschedule=true`;
    const rescheduleOrCancelText = `${t("need_to_reschedule_or_cancel")}\n${t("cancel")}: ${cancelUrl}\n${t("reschedule")}: ${rescheduleUrl}`;

    return `${confirmationText}\n${eventTitle}\n\n${urlText}\n\n${rescheduleOrCancelText}`;
  }
}
