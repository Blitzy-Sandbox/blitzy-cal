import { JSDOM } from "jsdom";

import { SENDER_NAME } from "@calcom/lib/constants";

import BaseEmail from "./_base-email";

export type Attachment = {
  content: string;
  filename: string;
  [key: string]: any;
};

/** Union type for workflow reminder timing classification (NF-001 Calendly reminder parity). */
export type WorkflowReminderType = "BEFORE_EVENT" | "AFTER_EVENT" | null;

export type WorkflowEmailData = {
  to: string;
  subject: string;
  html: string;
  replyTo?: string;
  sender?: string | null;
  attachments?: Attachment[];
  /** Indicates whether the reminder fires before or after the event (NF-001). */
  reminderType?: WorkflowReminderType;
  /** Human-readable reminder interval, e.g. "24h", "1h", "15m" (NF-001). */
  reminderInterval?: string | null;
  /** Title of the scheduled event for reminder context (NF-001). */
  eventTitle?: string | null;
  /** ISO-8601 date-time string of the event start (NF-001). */
  eventDateTime?: string | null;
  /** IANA timezone identifier for event display, e.g. "America/New_York" (NF-001). */
  eventTimezone?: string | null;
  /** Display name of the primary attendee (NF-001). */
  attendeeName?: string | null;
  /** Formatted location or conferencing details (NF-001). */
  locationDetails?: string | null;
  /** URL allowing the attendee to cancel the booking (NF-001). */
  cancelLink?: string | null;
  /** URL allowing the attendee to reschedule the booking (NF-001). */
  rescheduleLink?: string | null;
};

export default class WorkflowEmail extends BaseEmail {
  mailData: WorkflowEmailData;

  constructor(mailData: WorkflowEmailData) {
    super();
    this.mailData = mailData;
  }

  protected async getNodeMailerPayload(): Promise<Record<string, unknown>> {
    return {
      to: this.mailData.to,
      from: `${this.mailData.sender || SENDER_NAME} <${this.getMailerOptions().from}>`,
      ...(this.mailData.replyTo && { replyTo: this.mailData.replyTo }),
      subject: this.mailData.subject,
      html: addHTMLStyles(this.mailData.html),
      attachments: this.mailData.attachments,
    };
  }
}

export function addHTMLStyles(html?: string) {
  if (!html) {
    return "";
  }
  const dom = new JSDOM(html);
  // Select all <a> tags inside <h6> elements --> only used for emojis in rating template
  const links = Array.from(dom.window.document.querySelectorAll("h6 a")).map((link) => link as HTMLElement);

  links.forEach((link) => {
    link.style.fontSize = "20px";
    link.style.textDecoration = "none";
  });

  // NF-001: Style reminder-specific elements for Calendly reminder parity.
  // These classes are emitted by the workflow HTML composition layer when building
  // automated reminder emails (BEFORE_EVENT / AFTER_EVENT reminders).
  const reminderElements = Array.from(
    dom.window.document.querySelectorAll(".reminder-context, .reminder-time")
  ).map((el) => el as HTMLElement);

  reminderElements.forEach((el) => {
    el.style.fontFamily = "Roboto, Helvetica, sans-serif";
    el.style.fontSize = "14px";
    el.style.color = "#4B5563";
  });

  return dom.serialize();
}
