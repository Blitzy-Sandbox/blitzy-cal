import { WEBAPP_URL } from "@calcom/lib/constants";
import type { CalendarEvent, Person } from "@calcom/types/Calendar";

import SMSManager from "../sms-manager";

export default class EventSuccessfullyReScheduledSMS extends SMSManager {
  constructor(calEvent: CalendarEvent) {
    super(calEvent);
  }

  getMessage(attendee: Person) {
    const t = attendee.language.translate;

    // Booking details URL — base URL for viewing, cancelling, and rescheduling
    const bookerUrl = `${this.calEvent.bookerUrl ?? WEBAPP_URL}/booking/${this.calEvent.uid}`;
    const bookerUrlText = t("you_can_view_booking_details_with_this_url", {
      url: bookerUrl,
      interpolation: { escapeValue: false },
    });

    // Rescheduled notice with event title and NEW date/time
    const eventTypeHasBeenRescheduledOnTimeDateText = t("event_type_has_been_rescheduled_on_time_date", {
      title: this.calEvent.title,
      date: this.getFormattedDate(attendee.timeZone, attendee.language.locale),
      interpolation: { escapeValue: false },
    });

    // Original date/time context — Calendly shows what the booking was changed FROM (from → to).
    // CalendarEvent may carry rescheduleStartTime when populated by the booking service for
    // reschedule operations. Use optional chaining since the property may not be present.
    const calEventWithRescheduleCtx = this.calEvent as CalendarEvent & {
      rescheduleStartTime?: string;
    };
    let originalDateText = "";
    if (calEventWithRescheduleCtx.rescheduleStartTime) {
      const formattedOriginalTime = this.getFormattedTime(
        attendee.timeZone,
        attendee.language.locale,
        calEventWithRescheduleCtx.rescheduleStartTime
      );
      originalDateText = `\n${t("previous")}: ${formattedOriginalTime}`;
    }

    // Cancel and reschedule links for Calendly SMS parity (NF-002)
    const cancelUrl = `${bookerUrl}?cancel=true`;
    const rescheduleUrl = `${bookerUrl}?reschedule=true`;
    const rescheduleOrCancelText = `${t("need_to_reschedule_or_cancel")}\n${t("cancel")}: ${cancelUrl}\n${t("reschedule")}: ${rescheduleUrl}`;

    // Enhanced message structure matching Calendly reschedule confirmation format:
    // 1. Greeting with attendee name
    // 2. Rescheduled notice with event title and new date/time
    // 3. Original date/time context (conditional — shown only when available)
    // 4. Booking details link
    // 5. Cancel/reschedule action links
    const messageText = `${t("hey_there")} ${attendee.name}, ${eventTypeHasBeenRescheduledOnTimeDateText}${originalDateText}\n\n${bookerUrlText}\n\n${rescheduleOrCancelText}`;

    return messageText;
  }
}
