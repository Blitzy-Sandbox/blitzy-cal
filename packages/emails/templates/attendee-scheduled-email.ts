import { getCancelLink, getRescheduleLink, getRichDescription } from "@calcom/lib/CalEventParser";
import { getReplyToHeader } from "@calcom/lib/getReplyToHeader";
import { TimeFormat } from "@calcom/lib/timeFormat";
import type { CalendarEvent, Person } from "@calcom/types/Calendar";
import type { TFunction } from "i18next";
import { default as cloneDeep } from "lodash/cloneDeep";
import generateIcsFile, { GenerateIcsRole } from "../lib/generateIcsFile";
import renderEmail from "../src/renderEmail";
import BaseEmail from "./_base-email";

export default class AttendeeScheduledEmail extends BaseEmail {
  calEvent: CalendarEvent;
  attendee: Person;
  showAttendees: boolean | undefined;
  t: TFunction;

  constructor(calEvent: CalendarEvent, attendee: Person, showAttendees?: boolean | undefined) {
    super();
    let shouldShowAttendees: boolean;
    if (showAttendees !== undefined) {
      shouldShowAttendees = showAttendees;
    } else if (calEvent.seatsPerTimeSlot) {
      shouldShowAttendees = calEvent.seatsShowAttendees ?? false;
    } else {
      shouldShowAttendees = true;
    }

    if (!shouldShowAttendees && calEvent.seatsPerTimeSlot) {
      this.calEvent = cloneDeep(calEvent);
      this.calEvent.attendees = [attendee];
    } else {
      this.calEvent = calEvent;
    }
    this.name = "SEND_BOOKING_CONFIRMATION";
    this.attendee = attendee;
    this.t = attendee.language.translate;
  }

  protected async getNodeMailerPayload(): Promise<Record<string, unknown>> {
    const clonedCalEvent = cloneDeep(this.calEvent);

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
      subject: `${this.calEvent.title}`,
      html: await this.getHtml(clonedCalEvent, this.attendee),
      text: this.getTextBody(),
    };
  }

  async getHtml(calEvent: CalendarEvent, attendee: Person) {
    return await renderEmail("AttendeeScheduledEmail", {
      calEvent,
      attendee,
    });
  }

  protected getTextBody(title = "", subtitle = "emailed_you_and_any_other_attendees"): string {
    let text = `
${this.t(
  title
    ? title
    : this.calEvent.recurringEvent?.count
      ? "your_event_has_been_scheduled_recurring"
      : "your_event_has_been_scheduled"
)}
${this.t(subtitle)}

${getRichDescription(this.calEvent, this.t)}
`.trim();

    // NF-001: Append cancel/reschedule action links to the plain text body for Calendly parity.
    // These links mirror the ManageLink component behavior in the HTML email version,
    // ensuring text-only email clients also display booking management deep links.
    if (this.calEvent.uid) {
      if (!this.calEvent.recurringEvent && !this.calEvent.disableRescheduling) {
        const rescheduleLink = getRescheduleLink({ calEvent: this.calEvent, attendee: this.attendee });
        if (rescheduleLink) {
          text += `\n\n${this.t("reschedule")}: ${rescheduleLink}`;
        }
      }

      if (!this.calEvent.disableCancelling) {
        const cancelLink = getCancelLink(
          {
            platformClientId: this.calEvent.platformClientId,
            platformCancelUrl: this.calEvent.platformCancelUrl,
            type: this.calEvent.type,
            organizer: this.calEvent.organizer,
            recurringEvent: this.calEvent.recurringEvent,
            bookerUrl: this.calEvent.bookerUrl,
            uid: this.calEvent.uid,
            attendeeSeatId: this.calEvent.attendeeSeatId,
            team: this.calEvent.team,
          },
          this.attendee
        );
        if (cancelLink) {
          text += `\n${this.t("cancel")}: ${cancelLink}`;
        }
      }
    }

    return text;
  }

  protected getTimezone(): string {
    return this.attendee.timeZone;
  }

  protected getLocale(): string {
    return this.attendee.language.locale;
  }

  protected getInviteeStart(format: string) {
    return this.getFormattedRecipientTime({
      time: this.calEvent.startTime,
      format,
    });
  }

  protected getInviteeEnd(format: string) {
    return this.getFormattedRecipientTime({
      time: this.calEvent.endTime,
      format,
    });
  }

  public getFormattedDate() {
    const inviteeTimeFormat = this.calEvent.organizer.timeFormat || TimeFormat.TWELVE_HOUR;

    return `${this.getInviteeStart(inviteeTimeFormat)} - ${this.getInviteeEnd(inviteeTimeFormat)}, ${this.t(
      this.getInviteeStart("dddd").toLowerCase()
    )}, ${this.t(this.getInviteeStart("MMMM").toLowerCase())} ${this.getInviteeStart("D, YYYY")}`;
  }
}
