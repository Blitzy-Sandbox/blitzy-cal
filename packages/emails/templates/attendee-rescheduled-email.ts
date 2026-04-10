import { getReplyToHeader } from "@calcom/lib/getReplyToHeader";
import type { CalendarEvent, Person } from "@calcom/types/Calendar";

import generateIcsFile, { GenerateIcsRole } from "../lib/generateIcsFile";
import renderEmail from "../src/renderEmail";
import AttendeeScheduledEmail from "./attendee-scheduled-email";

export default class AttendeeRescheduledEmail extends AttendeeScheduledEmail {
  protected async getNodeMailerPayload(): Promise<Record<string, unknown>> {
    return {
      icalEvent: generateIcsFile({
        calEvent: this.calEvent,
        role: GenerateIcsRole.ATTENDEE,
        status: "CONFIRMED",
      }),
      to: `${this.attendee.name} <${this.attendee.email}>`,
      from: `${this.calEvent.organizer.name} <${this.getMailerOptions().from}>`,
      ...getReplyToHeader(
        this.calEvent,
        this.calEvent.attendees.filter(({ email }) => email !== this.attendee.email).map(({ email }) => email)
      ),
      subject: `${this.attendee.language.translate("event_type_has_been_rescheduled_on_time_date", {
        title: this.calEvent.title,
        date: this.getFormattedDate(),
      })}`,
      html: await this.getHtml(this.calEvent, this.attendee),
      text: this.getTextBody("event_has_been_rescheduled", "emailed_you_and_any_other_attendees"),
    };
  }

  /**
   * Overrides the parent plain-text body to include reschedule context
   * (who rescheduled and why) for Calendly notification parity (NF-001).
   * The HTML template already renders this via BaseScheduledEmail.tsx,
   * but the plain-text fallback needs the same information.
   */
  protected getTextBody(
    title = "event_has_been_rescheduled",
    subtitle = "emailed_you_and_any_other_attendees"
  ): string {
    let text = super.getTextBody(title, subtitle);

    // Append who triggered the reschedule, if available
    if (this.calEvent.rescheduledBy) {
      text += `\n${this.t("rescheduled_by")}: ${this.calEvent.rescheduledBy}`;
    }

    // Append the reschedule reason when the cancellationReason carries
    // the $RCH$ prefix (convention used throughout the codebase to
    // distinguish reschedule reasons from cancellation reasons)
    if (this.calEvent.cancellationReason?.startsWith("$RCH$")) {
      const reason = this.calEvent.cancellationReason.replace("$RCH$", "");
      if (reason) {
        text += `\n${this.t("reason_for_reschedule")}: ${reason}`;
      }
    }

    return text;
  }

  async getHtml(calEvent: CalendarEvent, attendee: Person) {
    return await renderEmail("AttendeeRescheduledEmail", {
      calEvent,
      attendee,
    });
  }
}
