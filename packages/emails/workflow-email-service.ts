import type BaseEmail from "@calcom/emails/templates/_base-email";
import logger from "@calcom/lib/logger";
import { withReporting } from "@calcom/lib/sentryWrapper";

import type { MonthlyDigestEmailData } from "./src/templates/MonthlyDigestEmail";
import type { IBookingRedirect } from "./templates/booking-redirect-notification";
import BookingRedirectEmailNotification from "./templates/booking-redirect-notification";
import type { Feedback } from "./templates/feedback-email";
import FeedbackEmail from "./templates/feedback-email";
import MonthlyDigestEmail from "./templates/monthly-digest-email";
import type { WorkflowEmailData } from "./templates/workflow-email";
import WorkflowEmail from "./templates/workflow-email";

const log = logger.getSubLogger({ prefix: ["workflow-email-service"] });

const sendEmail = (prepare: () => BaseEmail) => {
  return new Promise((resolve, reject) => {
    try {
      const email = prepare();
      resolve(email.sendEmail());
    } catch (e) {
      reject(console.error(`${prepare.constructor.name}.sendEmail failed`, e));
    }
  });
};

/**
 * Dispatches a workflow-triggered reminder email with configurable timing context.
 * Supports Calendly's automated workflow reminder actions (e.g., "24h before event", "1h before event").
 * Uses the WorkflowEmail template with reminder-specific metadata for content rendering.
 *
 * @param emailData - Standard workflow email data extended with reminder timing context
 *                    (reminderType, reminderInterval, eventTitle, eventDateTime, etc.)
 * @see NF-003 — Workflow automation trigger and action parity
 */
const _sendWorkflowReminderEmail = async (emailData: WorkflowEmailData) => {
  log.debug("Dispatching workflow reminder email", {
    to: emailData.to,
    subject: emailData.subject,
  });
  try {
    await sendEmail(() => new WorkflowEmail(emailData));
  } catch (error) {
    log.error("Failed to dispatch workflow reminder email", {
      to: emailData.to,
      subject: emailData.subject,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
};

/**
 * Dispatches a workflow-triggered booking confirmation email distinct from the standard
 * confirmation flow. Supports Calendly's "send confirmation email" workflow action.
 * Uses the WorkflowEmail template with confirmation-specific content and metadata.
 *
 * @param emailData - Standard workflow email data with booking confirmation content
 * @see NF-003 — Workflow automation trigger and action parity
 */
const _sendWorkflowConfirmationEmail = async (emailData: WorkflowEmailData) => {
  log.debug("Dispatching workflow confirmation email", {
    to: emailData.to,
    subject: emailData.subject,
  });
  try {
    await sendEmail(() => new WorkflowEmail(emailData));
  } catch (error) {
    log.error("Failed to dispatch workflow confirmation email", {
      to: emailData.to,
      subject: emailData.subject,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
};

/**
 * Dispatches a workflow-triggered cancellation follow-up email.
 * Supports Calendly's "send email after cancellation" workflow action.
 * Includes cancellation context such as reason and rebooking link in the email content.
 *
 * @param emailData - Standard workflow email data with cancellation follow-up content
 * @see NF-003 — Workflow automation trigger and action parity
 */
const _sendWorkflowCancellationEmail = async (emailData: WorkflowEmailData) => {
  log.debug("Dispatching workflow cancellation follow-up email", {
    to: emailData.to,
    subject: emailData.subject,
  });
  try {
    await sendEmail(() => new WorkflowEmail(emailData));
  } catch (error) {
    log.error("Failed to dispatch workflow cancellation follow-up email", {
      to: emailData.to,
      subject: emailData.subject,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
};

/**
 * Dispatches a post-event follow-up email triggered by workflow automation.
 * Supports Calendly's "send follow-up email after event" workflow action.
 * Can include survey links, feedback requests, or thank-you messages in the content.
 *
 * @param emailData - Standard workflow email data with follow-up content
 * @see NF-003 — Workflow automation trigger and action parity
 */
const _sendWorkflowFollowUpEmail = async (emailData: WorkflowEmailData) => {
  log.debug("Dispatching workflow follow-up email", {
    to: emailData.to,
    subject: emailData.subject,
  });
  try {
    await sendEmail(() => new WorkflowEmail(emailData));
  } catch (error) {
    log.error("Failed to dispatch workflow follow-up email", {
      to: emailData.to,
      subject: emailData.subject,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
};

/**
 * Categorizes workflow-triggered email actions for Calendly workflow automation parity.
 * Each action type maps to a specific email dispatch function.
 *
 * @see NF-003 — Workflow email automation trigger and action parity
 */
export enum WorkflowEmailAction {
  /** Time-based reminder before event — dispatched by sendWorkflowReminderEmail. */
  REMINDER = "REMINDER",
  /** Workflow-triggered booking confirmation — dispatched by sendWorkflowConfirmationEmail. */
  CONFIRMATION = "CONFIRMATION",
  /** Post-cancellation follow-up — dispatched by sendWorkflowCancellationEmail. */
  CANCELLATION_FOLLOW_UP = "CANCELLATION_FOLLOW_UP",
  /** Post-event follow-up — dispatched by sendWorkflowFollowUpEmail. */
  FOLLOW_UP = "FOLLOW_UP",
  /** Custom workflow email — dispatched by existing sendCustomWorkflowEmail. */
  CUSTOM = "CUSTOM",
}

export const sendFeedbackEmail = async (feedback: Feedback) => {
  await sendEmail(() => new FeedbackEmail(feedback));
};

export const sendCustomWorkflowEmail = async (emailData: WorkflowEmailData) => {
  await sendEmail(() => new WorkflowEmail(emailData));
};

export const sendMonthlyDigestEmail = async (eventData: MonthlyDigestEmailData) => {
  await sendEmail(() => new MonthlyDigestEmail(eventData));
};

export const sendBookingRedirectNotification = async (bookingRedirect: IBookingRedirect) => {
  await sendEmail(() => new BookingRedirectEmailNotification(bookingRedirect));
};

export const sendWorkflowReminderEmail = withReporting(
  _sendWorkflowReminderEmail,
  "sendWorkflowReminderEmail"
);

export const sendWorkflowConfirmationEmail = withReporting(
  _sendWorkflowConfirmationEmail,
  "sendWorkflowConfirmationEmail"
);

export const sendWorkflowCancellationEmail = withReporting(
  _sendWorkflowCancellationEmail,
  "sendWorkflowCancellationEmail"
);

export const sendWorkflowFollowUpEmail = withReporting(
  _sendWorkflowFollowUpEmail,
  "sendWorkflowFollowUpEmail"
);
