import { EMAIL_FROM_NAME } from "@calcom/lib/constants";
import { getReplyToHeader } from "@calcom/lib/getReplyToHeader";
import type { CalendarEvent, Person } from "@calcom/types/Calendar";

import generateIcsFile, { GenerateIcsRole } from "../lib/generateIcsFile";
import renderEmail from "../src/renderEmail";
import OrganizerScheduledEmail from "./organizer-scheduled-email";

export default class OrganizerRescheduledEmail extends OrganizerScheduledEmail {
  protected async getNodeMailerPayload(): Promise<Record<string, unknown>> {
    const toAddresses = [this.teamMember?.email || this.calEvent.organizer.email];
    return {
      icalEvent: generateIcsFile({
        calEvent: this.calEvent,
        role: GenerateIcsRole.ORGANIZER,
        status: "CONFIRMED",
      }),
      from: `${EMAIL_FROM_NAME} <${this.getMailerOptions().from}>`,
      to: toAddresses.join(","),
      ...getReplyToHeader(
        this.calEvent,
        this.calEvent.attendees.map(({ email }) => email),
        true
      ),
      subject: `${this.calEvent.organizer.language.translate("event_type_has_been_rescheduled_on_time_date", {
        title: this.calEvent.title,
        date: this.getFormattedDate(),
      })}`,
      html: await this.getHtml(
        { ...this.calEvent, attendeeSeatId: undefined },
        this.calEvent.organizer,
        this.teamMember
      ),
      text: this.getTextBody("event_has_been_rescheduled"),
    };
  }

  /**
   * Override getTextBody to include reschedule context in the plain text version
   * of the email, achieving parity with Calendly's organizer-facing reschedule
   * notifications which include who rescheduled and the reason.
   *
   * When `rescheduledBy` is present on the calendar event, the rescheduler's
   * identity is appended. When `cancellationReason` carries the `$RCH$` prefix
   * (indicating a reschedule reason rather than a cancellation reason), the
   * stripped reason text is appended as well.
   */
  protected getTextBody(
    title = "event_has_been_rescheduled",
    subtitle = "",
    extraInfo = "",
    callToAction = ""
  ): string {
    let text = super.getTextBody(title, subtitle, extraInfo, callToAction);

    if (this.calEvent.rescheduledBy) {
      text += `\n${this.t("rescheduled_by")}: ${this.calEvent.rescheduledBy}`;
    }

    if (this.calEvent.cancellationReason?.startsWith("$RCH$")) {
      const reason = this.calEvent.cancellationReason.replace("$RCH$", "");
      if (reason) {
        text += `\n${this.t("reason_for_reschedule")}: ${reason}`;
      }
    }

    return text;
  }

  async getHtml(calEvent: CalendarEvent, attendee: Person, teamMember?: Person) {
    return await renderEmail("OrganizerRescheduledEmail", {
      calEvent,
      attendee,
      teamMember,
    });
  }
}
