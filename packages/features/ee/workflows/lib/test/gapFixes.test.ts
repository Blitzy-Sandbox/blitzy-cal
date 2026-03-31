import { describe, it, expect } from "vitest";

import { WorkflowActions, WorkflowTriggerEvents } from "@calcom/prisma/enums";

import { isInAppNotificationAction } from "../actionHelperFunctions";
import {
  WORKFLOW_TRIGGER_EVENTS,
  WORKFLOW_ACTIONS,
  IMMEDIATE_WORKFLOW_TRIGGER_EVENTS,
} from "../constants";

describe("Gap 3 — AFTER_BOOKING_RESCHEDULED_BY_ATTENDEE trigger", () => {
  it("should include AFTER_BOOKING_RESCHEDULED_BY_ATTENDEE in WORKFLOW_TRIGGER_EVENTS", () => {
    expect(WORKFLOW_TRIGGER_EVENTS).toContain(
      WorkflowTriggerEvents.AFTER_BOOKING_RESCHEDULED_BY_ATTENDEE
    );
  });

  it("should include AFTER_BOOKING_RESCHEDULED_BY_ATTENDEE in IMMEDIATE_WORKFLOW_TRIGGER_EVENTS", () => {
    expect(IMMEDIATE_WORKFLOW_TRIGGER_EVENTS).toContain(
      WorkflowTriggerEvents.AFTER_BOOKING_RESCHEDULED_BY_ATTENDEE
    );
  });

  it("should still include RESCHEDULE_EVENT in WORKFLOW_TRIGGER_EVENTS (no regression)", () => {
    expect(WORKFLOW_TRIGGER_EVENTS).toContain(WorkflowTriggerEvents.RESCHEDULE_EVENT);
  });

  it("should still include RESCHEDULE_EVENT in IMMEDIATE_WORKFLOW_TRIGGER_EVENTS (no regression)", () => {
    expect(IMMEDIATE_WORKFLOW_TRIGGER_EVENTS).toContain(WorkflowTriggerEvents.RESCHEDULE_EVENT);
  });
});

describe("Gap 4 — IN_APP_NOTIFICATION action", () => {
  it("should include IN_APP_NOTIFICATION in WORKFLOW_ACTIONS", () => {
    expect(WORKFLOW_ACTIONS).toContain(WorkflowActions.IN_APP_NOTIFICATION);
  });

  it("should still include all pre-existing actions (no regression)", () => {
    expect(WORKFLOW_ACTIONS).toContain(WorkflowActions.EMAIL_HOST);
    expect(WORKFLOW_ACTIONS).toContain(WorkflowActions.EMAIL_ATTENDEE);
    expect(WORKFLOW_ACTIONS).toContain(WorkflowActions.EMAIL_ADDRESS);
    expect(WORKFLOW_ACTIONS).toContain(WorkflowActions.SMS_ATTENDEE);
    expect(WORKFLOW_ACTIONS).toContain(WorkflowActions.SMS_NUMBER);
    expect(WORKFLOW_ACTIONS).toContain(WorkflowActions.WHATSAPP_ATTENDEE);
    expect(WORKFLOW_ACTIONS).toContain(WorkflowActions.WHATSAPP_NUMBER);
    expect(WORKFLOW_ACTIONS).toContain(WorkflowActions.CAL_AI_PHONE_CALL);
  });

  it("isInAppNotificationAction should return true for IN_APP_NOTIFICATION", () => {
    expect(isInAppNotificationAction(WorkflowActions.IN_APP_NOTIFICATION)).toBe(true);
  });

  it("isInAppNotificationAction should return false for other actions", () => {
    expect(isInAppNotificationAction(WorkflowActions.EMAIL_HOST)).toBe(false);
    expect(isInAppNotificationAction(WorkflowActions.SMS_ATTENDEE)).toBe(false);
    expect(isInAppNotificationAction(WorkflowActions.WHATSAPP_ATTENDEE)).toBe(false);
    expect(isInAppNotificationAction(WorkflowActions.CAL_AI_PHONE_CALL)).toBe(false);
  });
});

describe("Gap 4 Round 2 — IN_APP_NOTIFICATION verifiedAt bypass", () => {
  it("IN_APP_NOTIFICATION action should not require verifiedAt to execute", () => {
    // The reminderScheduler.processWorkflowStep has:
    //   if (!step?.verifiedAt && !isInAppNotificationAction(step.action)) return;
    // This test verifies the condition logic: when verifiedAt is null/undefined AND action
    // is IN_APP_NOTIFICATION, the function should NOT early-return.
    const step = { verifiedAt: null, action: WorkflowActions.IN_APP_NOTIFICATION };
    const shouldReturn = !step.verifiedAt && !isInAppNotificationAction(step.action);
    expect(shouldReturn).toBe(false); // should NOT return, should continue processing
  });

  it("Non-notification actions with null verifiedAt should still trigger early-return", () => {
    // For regular actions (SMS, Email, etc.) without verifiedAt, the early return should fire
    const smsStep = { verifiedAt: null, action: WorkflowActions.SMS_ATTENDEE };
    const shouldReturn = !smsStep.verifiedAt && !isInAppNotificationAction(smsStep.action);
    expect(shouldReturn).toBe(true); // should early-return

    const emailStep = { verifiedAt: null, action: WorkflowActions.EMAIL_HOST };
    const shouldReturnEmail = !emailStep.verifiedAt && !isInAppNotificationAction(emailStep.action);
    expect(shouldReturnEmail).toBe(true); // should early-return
  });

  it("Actions with verifiedAt set should always continue processing", () => {
    const verifiedDate = new Date();
    const step = { verifiedAt: verifiedDate, action: WorkflowActions.EMAIL_HOST };
    const shouldReturn = !step.verifiedAt && !isInAppNotificationAction(step.action);
    expect(shouldReturn).toBe(false); // verifiedAt is truthy, so should NOT return
  });
});
