import { EMAIL_FROM_NAME } from "@calcom/lib/constants";
import type { CalendarEvent, Person } from "@calcom/types/Calendar";

import generateIcsFile, { GenerateIcsRole } from "../lib/generateIcsFile";
import renderEmail from "../src/renderEmail";
import OrganizerScheduledEmail from "./organizer-scheduled-email";
import type { Reassigned } from "./organizer-scheduled-email";

export default class OrganizerCancelledEmail extends OrganizerScheduledEmail {
  protected async getNodeMailerPayload(): Promise<Record<string, unknown>> {
    const toAddresses = [this.teamMember?.email || this.calEvent.organizer.email];
    const subject = this.reassigned ? "event_reassigned_subject" : "event_cancelled_subject";

    return {
      icalEvent: generateIcsFile({
        calEvent: this.calEvent,
        status: "CANCELLED",
        role: GenerateIcsRole.ORGANIZER,
      }),
      from: `${EMAIL_FROM_NAME} <${this.getMailerOptions().from}>`,
      to: toAddresses.join(","),
      subject: `${this.t(subject, {
        title: this.calEvent.title,
        date: this.getFormattedDate(),
      })}`,
      html: await this.getHtml(this.calEvent, this.calEvent.organizer, this.reassigned),
      text: this.getTextBody("event_request_cancelled"),
    };
  }

  /**
   * Returns the HTML content for the organizer cancellation email.
   *
   * When the email is not a reassignment notification (pure cancellation), the cancelled
   * attendee is passed prominently so the React template can highlight who cancelled.
   * For reassignment scenarios, the organizer is passed as the attendee to preserve
   * the existing reassignment rendering behavior.
   *
   * The `calEvent.attendees` array is always available in the template via `calEvent`
   * for the `WhoInfo` component to render the full attendee list.
   */
  async getHtml(calEvent: CalendarEvent, organizer: Person, reassigned: Reassigned | undefined) {
    // For pure cancellations (not reassignment), highlight the cancelled attendee
    // by passing the first attendee from the event. The WhoInfo component in the
    // React template renders all attendees from calEvent.attendees regardless, but
    // the `attendee` prop controls the primary displayed person in the header area.
    const prominentAttendee =
      !reassigned && calEvent.attendees.length > 0 ? calEvent.attendees[0] : organizer;

    return await renderEmail("OrganizerCancelledEmail", {
      calEvent,
      attendee: prominentAttendee,
      reassigned,
    });
  }

  /**
   * Generates the plain text body for the organizer cancellation email.
   *
   * Enhances the base text body with cancellation context for Calendly parity:
   * - The cancellation reason is already included by the parent's `getRichDescription`
   *   via `getCancellationReason()`, so it is not duplicated here.
   * - Appends the cancelled attendee's name and email so the organizer knows who
   *   cancelled directly from the plain text version of the email. This "cancelled by"
   *   context is not present in the parent implementation and provides Calendly parity
   *   for organizer-facing cancellation notifications.
   */
  protected getTextBody(
    title = "event_request_cancelled",
    subtitle = "",
    extraInfo = "",
    callToAction = ""
  ): string {
    let text = super.getTextBody(title, subtitle, extraInfo, callToAction);

    // Append the cancelled attendee's information for organizer visibility (Calendly parity).
    // For reassignment scenarios, the attendee info is not relevant since the booking is being
    // reassigned rather than cancelled by the attendee.
    if (!this.reassigned && this.calEvent.attendees.length > 0) {
      const cancelledAttendee = this.calEvent.attendees[0];
      text += `\n${this.t("cancelled_by")}: ${cancelledAttendee.name} (${cancelledAttendee.email})`;
    }

    return text;
  }
}
