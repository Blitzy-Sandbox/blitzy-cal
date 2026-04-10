import { getBookingUrl } from "@calcom/lib/CalEventParser";
import { getReplyToHeader } from "@calcom/lib/getReplyToHeader";
import type { CalendarEvent, Person } from "@calcom/types/Calendar";

import generateIcsFile, { GenerateIcsRole } from "../lib/generateIcsFile";
import renderEmail from "../src/renderEmail";
import AttendeeScheduledEmail from "./attendee-scheduled-email";

export default class AttendeeCancelledEmail extends AttendeeScheduledEmail {
  protected async getNodeMailerPayload(): Promise<Record<string, unknown>> {
    return {
      icalEvent: generateIcsFile({
        calEvent: this.calEvent,
        role: GenerateIcsRole.ATTENDEE,
        status: "CANCELLED",
      }),
      to: `${this.attendee.name} <${this.attendee.email}>`,
      from: `${this.calEvent.organizer.name} <${this.getMailerOptions().from}>`,
      ...getReplyToHeader(this.calEvent),
      subject: `${this.t("event_cancelled_subject", {
        title: this.calEvent.title,
        date: this.getFormattedDate(),
      })}`,
      html: await this.getHtml(this.calEvent, this.attendee),
      text: this.getTextBody("event_request_cancelled", "emailed_you_and_any_other_attendees"),
    };
  }

  /**
   * NF-001 Calendly parity: Constructs a rebooking URL that allows the attendee to book
   * the same event type again after cancellation. Uses the bookerUrl + organizer username +
   * event type slug pattern (e.g., https://cal.com/jane/30min), matching Calendly's
   * cancellation email rebooking CTA pattern.
   *
   * Returns an empty string when the required URL components (bookerUrl, organizer username)
   * are not available, so callers can safely check truthiness before rendering a CTA.
   */
  private getRebookingUrl(): string {
    if (this.calEvent.bookerUrl && this.calEvent.organizer.username) {
      return `${this.calEvent.bookerUrl}/${this.calEvent.organizer.username}/${this.calEvent.type}`;
    }
    return "";
  }

  /**
   * NF-001 Calendly parity: Renders the cancellation email HTML via the AttendeeCancelledEmail
   * React template.  The rich-HTML rebooking CTA is handled by the ManageLink component inside
   * BaseScheduledEmail, which internally computes the rebook link from calEvent.bookerUrl,
   * calEvent.organizer.username, and calEvent.type when showRebookLink is enabled.
   *
   * getBookingUrl is used below to produce the booking-detail deep link included in the
   * plain-text fallback body (see getTextBody).
   */
  async getHtml(calEvent: CalendarEvent, attendee: Person) {
    return await renderEmail("AttendeeCancelledEmail", {
      calEvent,
      attendee,
    });
  }

  /**
   * NF-001 Calendly parity: Enhanced plain-text body that appends cancellation reason,
   * a booking detail reference link, and a rebooking URL when available — matching
   * Calendly's cancellation email content pattern.
   *
   * The "$RCH$" prefix is an internal Cal.com marker that distinguishes a reschedule-
   * triggered cancellation from a true user-initiated cancellation.  It is stripped
   * before display so end users see only the human-readable reason text.
   *
   * getBookingUrl produces a deep link to the cancelled booking's detail / changes page,
   * giving the attendee a reference to the specific cancelled event.
   */
  protected getTextBody(
    title = "event_request_cancelled",
    subtitle = "emailed_you_and_any_other_attendees"
  ): string {
    let text = super.getTextBody(title, subtitle);

    // Append cancellation reason to the plain-text body when provided
    if (this.calEvent.cancellationReason) {
      const reason = this.calEvent.cancellationReason.replace("$RCH$", "");
      if (reason.trim()) {
        text += `\n\n${this.t("cancellation_reason")}: ${reason}`;
      }
    }

    // Include a deep link to the cancelled booking detail page for attendee reference
    const bookingDetailUrl = getBookingUrl(this.calEvent);
    if (bookingDetailUrl) {
      text += `\n\n${this.t("view_booking")}: ${bookingDetailUrl}`;
    }

    // Append rebooking URL so plain-text email clients also surface the rebook CTA
    const rebookingUrl = this.getRebookingUrl();
    if (rebookingUrl) {
      text += `\n\n${this.t("book_a_new_time")}: ${rebookingUrl}`;
    }

    return text;
  }
}
