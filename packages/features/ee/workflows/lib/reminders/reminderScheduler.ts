import { BookingSeatRepository } from "@calcom/features/bookings/repositories/BookingSeatRepository";
import type { CreditCheckFn } from "@calcom/features/ee/billing/credit-service";
import {
  isAttendeeAction,
  isSMSAction,
  isSMSOrWhatsappAction,
  isWhatsappAction,
  isCalAIAction,
  isInAppNotificationAction,
} from "@calcom/features/ee/workflows/lib/actionHelperFunctions";
import { isEmailAction } from "@calcom/features/ee/workflows/lib/actionHelperFunctions";
import { EmailWorkflowService } from "@calcom/features/ee/workflows/lib/service/EmailWorkflowService";
import { WorkflowService } from "@calcom/features/ee/workflows/lib/service/WorkflowService";
import type { Workflow, WorkflowStep } from "@calcom/features/ee/workflows/lib/types";
import { WorkflowReminderRepository } from "@calcom/features/ee/workflows/repositories/WorkflowReminderRepository";
import { formatCalEventExtended } from "@calcom/lib/formatCalendarEvent";
import logger from "@calcom/lib/logger";
import { withReporting } from "@calcom/lib/sentryWrapper";
import { getTranslation } from "@calcom/lib/server/i18n";
import { checkSMSRateLimit } from "@calcom/lib/smsLockState";
import { prisma } from "@calcom/prisma";
import { SchedulingType } from "@calcom/prisma/enums";
import { WorkflowActions, WorkflowTriggerEvents } from "@calcom/prisma/enums";
import type { CalendarEvent } from "@calcom/types/Calendar";

import type { FormSubmissionData } from "../types";
import type { BookingInfo } from "../types";
import type { ScheduleTextReminderAction } from "./smsReminderManager";

export type WorkflowContextData =
  | { evt: BookingInfo; formData?: never }
  | {
      evt?: never;
      formData: FormSubmissionData;
    };

export type ExtendedCalendarEvent = Omit<CalendarEvent, "bookerUrl"> & {
  metadata?: { videoCallUrl: string | undefined };
  eventType: {
    slug: string;
    schedulingType?: SchedulingType | null;
    hosts?: { user: { email: string; destinationCalendar?: { primaryEmail: string | null } | null } }[];
  };
  rescheduleReason?: string | null;
  cancellationReason?: string | null;
  bookerUrl: string;
};

type ProcessWorkflowStepParams = (
  | { calendarEvent: ExtendedCalendarEvent; formData?: never }
  | {
      calendarEvent?: never;
      formData: FormSubmissionData;
    }
) & {
  smsReminderNumber: string | null;
  emailAttendeeSendToOverride?: string;
  hideBranding?: boolean;
  seatReferenceUid?: string;
};

export type ScheduleWorkflowRemindersArgs = ProcessWorkflowStepParams & {
  workflows: Workflow[];
  isDryRun?: boolean;
  creditCheckFn: CreditCheckFn;
};

const getReminderPhoneNumber = async (
  action: WorkflowActions,
  seatReferenceUid: string | undefined,
  smsReminderNumber: string | null,
  stepSendTo: string | null
) => {
  const isAttendeeAction =
    action === WorkflowActions.SMS_ATTENDEE || action === WorkflowActions.WHATSAPP_ATTENDEE;

  if (!isAttendeeAction) {
    return stepSendTo;
  }

  if (seatReferenceUid) {
    const bookingSeatRepository = new BookingSeatRepository(prisma);
    const seatAttendeeData =
      await bookingSeatRepository.getByReferenceUidWithAttendeeDetails(seatReferenceUid);
    return seatAttendeeData?.attendee?.phoneNumber || smsReminderNumber;
  }

  return smsReminderNumber;
};

const processWorkflowStep = async (
  workflow: Workflow,
  step: WorkflowStep,
  {
    smsReminderNumber,
    calendarEvent,
    emailAttendeeSendToOverride,
    hideBranding,
    seatReferenceUid,
    formData,
  }: ProcessWorkflowStepParams,
  creditCheckFn: CreditCheckFn
) => {
  // IN_APP_NOTIFICATION actions don't require sender verification (no phone/email needed),
  // so we skip the verifiedAt check for them. All other actions (SMS, email, WhatsApp) must be verified.
  if (!step?.verifiedAt && !isInAppNotificationAction(step.action)) return;

  const evt = calendarEvent ? formatCalEventExtended(calendarEvent) : undefined;

  if (!evt && !formData) return;

  const contextData: WorkflowContextData = evt ? { evt } : { formData: formData as FormSubmissionData };

  if (isSMSOrWhatsappAction(step.action)) {
    await checkSMSRateLimit({
      identifier: `sms:${workflow.teamId ? "team:" : "user:"}${workflow.teamId || workflow.userId}`,
      rateLimitingType: "sms",
    });
  }

  // Common parameters for all scheduling functions
  const scheduleFunctionParams = WorkflowService.generateCommonScheduleFunctionParams({
    workflow,
    workflowStep: step,
    seatReferenceUid: seatReferenceUid,
    creditCheckFn,
  });

  if (isSMSAction(step.action)) {
    const { scheduleSMSReminder } = await import("./smsReminderManager");
    const sendTo = await getReminderPhoneNumber(
      step.action,
      seatReferenceUid,
      smsReminderNumber,
      step.sendTo
    );

    await scheduleSMSReminder({
      ...scheduleFunctionParams,
      reminderPhone: sendTo,
      action: step.action as ScheduleTextReminderAction,
      message: step.reminderBody || "",
      sender: step.sender,
      isVerificationPending: step.numberVerificationPending,
      ...contextData,
    });
  } else if (isEmailAction(step.action)) {
    const { scheduleEmailReminder } = await import("./emailReminderManager");
    if (!evt && step.action === WorkflowActions.EMAIL_HOST) {
      // EMAIL_HOST is not supported for form triggers
      return;
    }

    const workflowReminderRepository = new WorkflowReminderRepository(prisma);
    const bookingSeatRepository = new BookingSeatRepository(prisma);
    const emailWorkflowService = new EmailWorkflowService(workflowReminderRepository, bookingSeatRepository);
    const emailParams = await emailWorkflowService.generateParametersToBuildEmailWorkflowContent({
      evt,
      workflowStep: step,
      workflow,
      emailAttendeeSendToOverride,
      formData,
      commonScheduleFunctionParams: scheduleFunctionParams,
      hideBranding,
    });
    await scheduleEmailReminder(emailParams);
  } else if (isWhatsappAction(step.action)) {
    if (!evt) {
      // Whatsapp action not not yet supported for form triggers
      return;
    }

    const { scheduleWhatsappReminder } = await import("./whatsappReminderManager");
    const sendTo = await getReminderPhoneNumber(
      step.action,
      seatReferenceUid,
      smsReminderNumber,
      step.sendTo
    );

    await scheduleWhatsappReminder({
      ...scheduleFunctionParams,
      verifiedAt: step.verifiedAt ?? null,
      reminderPhone: sendTo,
      action: step.action as ScheduleTextReminderAction,
      message: step.reminderBody || "",
      isVerificationPending: step.numberVerificationPending,
      evt,
    });
  } else if (isCalAIAction(step.action)) {
    const { scheduleAIPhoneCall } = await import("./aiPhoneCallManager");
    await scheduleAIPhoneCall({
      triggerEvent: workflow.trigger,
      timeSpan: {
        time: workflow.time,
        timeUnit: workflow.timeUnit,
      },
      workflowStepId: step.id,
      userId: workflow.userId,
      teamId: workflow.teamId,
      seatReferenceUid,
      submittedPhoneNumber: smsReminderNumber,
      verifiedAt: step.verifiedAt ?? null,
      routedEventTypeId: formData ? formData.routedEventTypeId : null,
      ...contextData,
    });
  } else if (isInAppNotificationAction(step.action)) {
    // IN_APP_NOTIFICATION action: delegate to the InAppNotificationService implemented in NF-004.
    // Only booking-context notifications are supported (not form submissions).
    if (!evt) return;

    // NF-004 fix: Wrap the entire IN_APP_NOTIFICATION branch in try-catch to prevent
    // errors (dynamic import failures, DB write failures, type mismatches) from propagating
    // out of processWorkflowStep and breaking the surrounding booking flow (reschedule,
    // cancel, buffer sync). Errors are logged but never re-thrown.
    try {
      const { InAppNotificationService } = await import(
        "@calcom/features/notifications/services/InAppNotificationService"
      );
      const { NotificationType } = await import("@calcom/features/notifications/types");
      const inAppService = new InAppNotificationService();

      // Map the workflow trigger to the appropriate notification type for categorisation.
      // Use a plain record with string values and cast the result to satisfy the enum-typed
      // `type` field on `InAppNotificationCreateInput`.  The dynamic import returns
      // `NotificationType` as a *value* so it cannot be used in a TS type-position directly.
      const triggerToNotificationType: Record<string, string> = {
        [WorkflowTriggerEvents.NEW_EVENT]: NotificationType.BOOKING_CREATED,
        [WorkflowTriggerEvents.EVENT_CANCELLED]: NotificationType.BOOKING_CANCELLED,
        [WorkflowTriggerEvents.RESCHEDULE_EVENT]: NotificationType.BOOKING_RESCHEDULED,
        [WorkflowTriggerEvents.AFTER_BOOKING_RESCHEDULED_BY_ATTENDEE]: NotificationType.BOOKING_RESCHEDULED,
        [WorkflowTriggerEvents.BOOKING_REQUESTED]: NotificationType.BOOKING_REQUESTED,
        [WorkflowTriggerEvents.BOOKING_REJECTED]: NotificationType.BOOKING_REJECTED,
      };
      const notifType = (triggerToNotificationType[workflow.trigger] ||
        NotificationType.WORKFLOW_TRIGGERED) as (typeof NotificationType)[keyof typeof NotificationType];

      // NF-004 fix: Collect all user IDs who should receive the notification.
      // For personal workflows, `workflow.userId` is the organizer — one notification.
      // For team workflows, `workflow.userId` may be the workflow creator (admin), not
      // the booking organizer. We also resolve the organizer by email to ensure the
      // person who actually received the booking always gets an in-app notification.
      const userIdsToNotify = new Set<number>();

      if (workflow.userId) {
        userIdsToNotify.add(workflow.userId);
      }

      // Also resolve the booking organizer's userId from their email address so that
      // team members who are organizers (but not workflow owners) see notifications.
      if (evt.organizer?.email) {
        try {
          const { prisma: prismaCli } = await import("@calcom/prisma");
          const organizerUser = await prismaCli.user.findFirst({
            where: { email: evt.organizer.email },
            select: { id: true },
          });
          if (organizerUser) {
            userIdsToNotify.add(organizerUser.id);
          }
        } catch (lookupError) {
          logger.warn("Failed to resolve organizer userId for in-app notification", {
            email: evt.organizer.email,
            error: lookupError,
          });
        }
      }

      const notificationPayload = {
        title: step.reminderBody || evt.title || "Booking notification",
        body: step.reminderBody || `Booking: ${evt.title}`,
        type: notifType,
        url: evt.uid ? `/booking/${evt.uid}` : "/bookings",
        metadata: {
          workflowId: workflow.id,
          workflowStepId: step.id,
          trigger: workflow.trigger,
          bookingUid: evt.uid,
        },
      };

      // Send notification to all collected user IDs (deduplicated via Set)
      for (const userId of userIdsToNotify) {
        await inAppService.createNotification({
          userId,
          ...notificationPayload,
        });
      }
    } catch (inAppError) {
      // Log but never re-throw — IN_APP_NOTIFICATION failures must not disrupt the booking flow
      logger.error("IN_APP_NOTIFICATION workflow step failed", {
        workflowId: workflow.id,
        stepId: step.id,
        trigger: workflow.trigger,
        error: inAppError,
      });
    }
  }
};

const _scheduleWorkflowReminders = async (args: ScheduleWorkflowRemindersArgs) => {
  const {
    workflows,
    smsReminderNumber,
    calendarEvent: evt,
    emailAttendeeSendToOverride = "",
    hideBranding,
    seatReferenceUid,
    isDryRun = false,
    formData,
    creditCheckFn,
  } = args;
  if (isDryRun || !workflows.length) return;

  // Parallelize across independent workflows using Promise.allSettled.
  // Steps within a single workflow are processed sequentially (ordering may matter),
  // but separate workflows are independent and can execute concurrently.
  const workflowResults = await Promise.allSettled(
    workflows.map(async (workflow) => {
      if (workflow.steps.length === 0) return;

      for (const step of workflow.steps) {
        if (
          // These tasks currently write the entire payload in the task
          (workflow.trigger === WorkflowTriggerEvents.BEFORE_EVENT ||
            workflow.trigger === WorkflowTriggerEvents.AFTER_EVENT) &&
          isEmailAction(step.action) &&
          evt
        ) {
          await WorkflowService.scheduleLazyEmailWorkflow({
            evt,
            workflowStepId: step.id,
            workflowTriggerEvent: workflow.trigger,
            workflow,
            seatReferenceId: args.seatReferenceUid,
          });
          continue;
        }

        await processWorkflowStep(
          workflow,
          step,
          {
            emailAttendeeSendToOverride,
            smsReminderNumber,
            hideBranding,
            seatReferenceUid,
            ...(evt ? { calendarEvent: evt } : { formData }),
          },
          creditCheckFn
        );
      }
    })
  );

  // Log any per-workflow failures without blocking other workflows
  for (const result of workflowResults) {
    if (result.status === "rejected") {
      logger.error("Failed to schedule workflow reminders", { reason: result.reason });
    }
  }
};

export interface SendCancelledRemindersArgs {
  workflows: Workflow[];
  smsReminderNumber: string | null;
  evt: ExtendedCalendarEvent;
  hideBranding?: boolean;
  creditCheckFn: CreditCheckFn;
}

const _sendCancelledReminders = async (args: SendCancelledRemindersArgs) => {
  const { smsReminderNumber, evt, workflows, hideBranding, creditCheckFn } = args;

  if (!workflows.length) return;

  for (const workflow of workflows) {
    if (workflow.trigger !== WorkflowTriggerEvents.EVENT_CANCELLED) continue;

    for (const step of workflow.steps) {
      // NF-004 fix: Wrap each step in try-catch so that a failure in one step
      // (particularly IN_APP_NOTIFICATION) does not abort remaining steps or
      // break the cancellation flow that calls sendCancelledReminders.
      try {
        await processWorkflowStep(
          workflow,
          step,
          {
            smsReminderNumber,
            hideBranding,
            calendarEvent: evt,
          },
          creditCheckFn
        );
      } catch (stepError) {
        logger.error("Failed to process workflow step during cancellation", {
          workflowId: workflow.id,
          stepId: step.id,
          action: step.action,
          error: stepError,
        });
      }
    }
  }
};

const _cancelScheduledMessagesAndScheduleEmails = async ({
  teamId,
  userIdsWithNoCredits,
}: {
  teamId?: number | null;
  userIdsWithNoCredits: number[];
}) => {
  const { WorkflowReminderRepository } = await import(
    "@calcom/features/ee/workflows/repositories/WorkflowReminderRepository"
  );

  const workflowReminderRepository = new WorkflowReminderRepository(prisma);
  const scheduledMessages = await workflowReminderRepository.findScheduledMessagesToCancel({
    teamId,
    userIdsWithNoCredits,
  });

  const [twilio, { sendOrScheduleWorkflowEmails }] = await Promise.all([
    import("./providers/twilioProvider"),
    import("./providers/emailProvider"),
  ]);

  await Promise.allSettled(scheduledMessages.map((msg) => twilio.cancelSMS(msg.referenceId ?? "")));

  await Promise.allSettled(
    scheduledMessages.map(async (msg) => {
      if (msg.workflowStep?.action && isAttendeeAction(msg.workflowStep.action)) {
        const messageBody = await twilio.getMessageBody(msg.referenceId ?? "");
        const sendTo = msg.booking?.attendees?.[0];

        if (sendTo) {
          const t = await getTranslation(sendTo.locale ?? "en", "common");
          await sendOrScheduleWorkflowEmails({
            to: [sendTo.email],
            subject: t("notification_about_your_booking"),
            html: messageBody,
            replyTo: msg.booking?.user?.email ?? "",
            sendAt: msg.scheduledDate,
            referenceUid: msg.uuid || undefined,
          });
        }
      }
    })
  );

  await workflowReminderRepository.updateRemindersToEmail({
    reminderIds: scheduledMessages.map((msg) => msg.id),
  });
};
// Export functions wrapped with withReporting
export const scheduleWorkflowReminders = withReporting(
  _scheduleWorkflowReminders,
  "scheduleWorkflowReminders"
);
export const sendCancelledReminders = withReporting(_sendCancelledReminders, "sendCancelledReminders");
export const cancelScheduledMessagesAndScheduleEmails = withReporting(
  _cancelScheduledMessagesAndScheduleEmails,
  "cancelScheduledMessagesAndScheduleEmails"
);
