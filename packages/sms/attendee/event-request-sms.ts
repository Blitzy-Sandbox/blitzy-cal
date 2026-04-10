import { WEBAPP_URL } from "@calcom/lib/constants";
import type { CalendarEvent, Person } from "@calcom/types/Calendar";

import SMSManager from "../sms-manager";

export default class EventRequestSMS extends SMSManager {
  constructor(calEvent: CalendarEvent) {
    super(calEvent);
  }

  getMessage(attendee: Person) {
    const t = attendee.language.translate;

    // 1. Booking submitted notice with attendee name
    const bookingSubmittedText = t("booking_submitted", {
      name: attendee.name,
      interpolation: { escapeValue: false },
    });

    // 2. Event details — title and localized date/time with timezone for Calendly parity (NF-002)
    const formattedDate = this.getFormattedDate(attendee.timeZone, attendee.language.locale);
    const eventDetailsText = `${this.calEvent.title} - ${formattedDate}`;

    // 3. Confirmation pending notice with organizer name
    const userNeedsToConfirmOrRejectBookingText = t("user_needs_to_confirm_or_reject_booking", {
      user: this.calEvent.organizer.name,
      interpolation: { escapeValue: false },
    });

    // 4. Booking details link
    const bookingUrl = `${this.calEvent.bookerUrl ?? WEBAPP_URL}/booking/${this.calEvent.uid}`;
    const urlText = t("you_can_view_booking_details_with_this_url", {
      url: bookingUrl,
      interpolation: { escapeValue: false },
    });

    // 5. Cancel/modify link for Calendly parity (NF-002)
    const cancelUrl = `${this.calEvent.bookerUrl ?? WEBAPP_URL}/booking/${this.calEvent.uid}?cancel=true`;
    const cancelModifyText = `${t("need_to_reschedule_or_cancel")}: ${cancelUrl}`;

    const messageText = `${bookingSubmittedText}. ${eventDetailsText}\n\n${userNeedsToConfirmOrRejectBookingText}\n\n${urlText}\n\n${cancelModifyText}`;

    return messageText;
  }
}
