import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Tests for Gap 4 (NF-004): IN_APP_NOTIFICATION workflow step error isolation.
 *
 * Verifies:
 * - IN_APP_NOTIFICATION step failures are caught and logged (never re-thrown)
 * - _sendCancelledReminders wraps each step in try-catch so one failure doesn't abort others
 * - Normal booking flow (processWorkflowStep callers) is unaffected by IN_APP errors
 */

// Track logger.error calls for assertion
const loggedErrors: Array<{ message: string; meta: Record<string, unknown> }> = [];

vi.mock("@calcom/lib/logger", () => ({
  default: {
    error: (message: string, meta: Record<string, unknown>) => {
      loggedErrors.push({ message, meta });
    },
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

// Configurable mock for Prisma user lookup (NF-004 organizer resolution)
let mockPrismaUserFindFirst: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue(null);

vi.mock("@calcom/prisma", () => ({
  prisma: {
    user: {
      get findFirst() {
        return mockPrismaUserFindFirst;
      },
    },
  },
}));

vi.mock("@calcom/prisma/enums", () => ({
  SchedulingType: { ROUND_ROBIN: "ROUND_ROBIN" },
  WorkflowActions: {
    SMS_ATTENDEE: "SMS_ATTENDEE",
    SMS_NUMBER: "SMS_NUMBER",
    WHATSAPP_ATTENDEE: "WHATSAPP_ATTENDEE",
    WHATSAPP_NUMBER: "WHATSAPP_NUMBER",
    EMAIL_HOST: "EMAIL_HOST",
    EMAIL_ATTENDEE: "EMAIL_ATTENDEE",
    EMAIL_ADDRESS: "EMAIL_ADDRESS",
    CAL_AI: "CAL_AI",
    IN_APP_NOTIFICATION: "IN_APP_NOTIFICATION",
  },
  WorkflowTriggerEvents: {
    NEW_EVENT: "NEW_EVENT",
    EVENT_CANCELLED: "EVENT_CANCELLED",
    RESCHEDULE_EVENT: "RESCHEDULE_EVENT",
    BEFORE_EVENT: "BEFORE_EVENT",
    AFTER_EVENT: "AFTER_EVENT",
    AFTER_BOOKING_RESCHEDULED_BY_ATTENDEE: "AFTER_BOOKING_RESCHEDULED_BY_ATTENDEE",
    BOOKING_REQUESTED: "BOOKING_REQUESTED",
    BOOKING_REJECTED: "BOOKING_REJECTED",
    FORM_SUBMITTED: "FORM_SUBMITTED",
  },
  WorkflowMethods: { EMAIL: "EMAIL", SMS: "SMS" },
}));

vi.mock("@calcom/features/ee/workflows/lib/actionHelperFunctions", () => ({
  isAttendeeAction: vi.fn(() => false),
  isSMSAction: vi.fn(() => false),
  isSMSOrWhatsappAction: vi.fn(() => false),
  isWhatsappAction: vi.fn(() => false),
  isCalAIAction: vi.fn(() => false),
  isEmailAction: vi.fn(() => false),
  isInAppNotificationAction: vi.fn((action: string) => action === "IN_APP_NOTIFICATION"),
}));

vi.mock("@calcom/features/ee/workflows/lib/service/WorkflowService", () => ({
  WorkflowService: {
    generateCommonScheduleFunctionParams: vi.fn(() => ({
      triggerEvent: "NEW_EVENT",
      time: null,
      timeUnit: null,
      workflowStepId: 1,
    })),
    scheduleLazyEmailWorkflow: vi.fn(),
  },
}));

vi.mock("@calcom/features/ee/workflows/lib/service/EmailWorkflowService", () => ({
  EmailWorkflowService: vi.fn(),
}));

vi.mock("@calcom/features/ee/workflows/repositories/WorkflowReminderRepository", () => ({
  WorkflowReminderRepository: vi.fn(),
}));

vi.mock("@calcom/features/bookings/repositories/BookingSeatRepository", () => ({
  BookingSeatRepository: vi.fn(),
}));

vi.mock("@calcom/lib/formatCalendarEvent", () => ({
  formatCalEventExtended: vi.fn((evt: unknown) => evt),
}));

vi.mock("@calcom/lib/sentryWrapper", () => ({
  withReporting: vi.fn((fn: unknown) => fn),
}));

vi.mock("@calcom/lib/smsLockState", () => ({
  checkSMSRateLimit: vi.fn(),
}));

vi.mock("@calcom/lib/server/i18n", () => ({
  getTranslation: vi.fn(),
}));

// Track createNotification calls
let createNotificationCalls: unknown[] = [];
let createNotificationBehavior: "resolve" | "reject" = "resolve";
let createNotificationError: Error | null = null;

vi.mock("@calcom/features/notifications/services/InAppNotificationService", () => ({
  InAppNotificationService: class MockInAppNotificationService {
    createNotification(args: unknown) {
      createNotificationCalls.push(args);
      if (createNotificationBehavior === "reject" && createNotificationError) {
        throw createNotificationError;
      }
      return Promise.resolve({ id: createNotificationCalls.length });
    }
  },
}));

vi.mock("@calcom/features/notifications/types", () => ({
  NotificationType: {
    BOOKING_CREATED: "BOOKING_CREATED",
    BOOKING_CANCELLED: "BOOKING_CANCELLED",
    BOOKING_RESCHEDULED: "BOOKING_RESCHEDULED",
    BOOKING_REQUESTED: "BOOKING_REQUESTED",
    BOOKING_REJECTED: "BOOKING_REJECTED",
    WORKFLOW_TRIGGERED: "WORKFLOW_TRIGGERED",
  },
}));

// Import after mocks
import type { SendCancelledRemindersArgs, ScheduleWorkflowRemindersArgs } from "./reminderScheduler";

const { scheduleWorkflowReminders, sendCancelledReminders } = await import("./reminderScheduler");

function makeWorkflow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1,
    trigger: "NEW_EVENT",
    time: null,
    timeUnit: null,
    userId: 100,
    teamId: null,
    steps: [
      {
        id: 10,
        action: "IN_APP_NOTIFICATION",
        verifiedAt: new Date(),
        reminderBody: "Test notification",
        sendTo: null,
        sender: null,
        numberVerificationPending: false,
      },
    ],
    ...overrides,
  };
}

function makeCalendarEvent() {
  return {
    title: "Test Booking",
    type: "test",
    description: "",
    startTime: new Date().toISOString(),
    endTime: new Date().toISOString(),
    organizer: { email: "org@test.com", name: "Org", timeZone: "UTC", language: { locale: "en" } },
    attendees: [{ email: "att@test.com", name: "Att", timeZone: "UTC", language: { locale: "en" } }],
    uid: "booking-uid-1",
    bookerUrl: "https://cal.com/test",
    eventType: { slug: "test-event" },
  };
}

const noopCreditCheck = vi.fn().mockResolvedValue(true);

describe("IN_APP_NOTIFICATION error isolation (NF-004)", () => {
  beforeEach(() => {
    // Reset tracking state
    createNotificationCalls = [];
    createNotificationBehavior = "resolve";
    createNotificationError = null;
    loggedErrors.length = 0;
    noopCreditCheck.mockClear();
    // Default: organizer email lookup returns null (not found)
    mockPrismaUserFindFirst = vi.fn().mockResolvedValue(null);
  });

  it("should catch and log errors from createNotification without throwing", async () => {
    createNotificationBehavior = "reject";
    createNotificationError = new Error("DB connection failed");

    // This call must NOT throw — error should be caught internally
    await scheduleWorkflowReminders({
      workflows: [makeWorkflow()],
      smsReminderNumber: null,
      calendarEvent: makeCalendarEvent() as any,
      creditCheckFn: noopCreditCheck,
    } as ScheduleWorkflowRemindersArgs);

    // createNotification was attempted
    expect(createNotificationCalls.length).toBe(1);

    // Error was logged via logger.error with the expected message
    const inAppErrors = loggedErrors.filter(
      (e) => e.message === "IN_APP_NOTIFICATION workflow step failed"
    );
    expect(inAppErrors.length).toBe(1);
    expect(inAppErrors[0].meta).toMatchObject({
      workflowId: 1,
      stepId: 10,
      trigger: "NEW_EVENT",
    });
  });

  it("should successfully create notification when no error occurs", async () => {
    createNotificationBehavior = "resolve";

    await scheduleWorkflowReminders({
      workflows: [makeWorkflow()],
      smsReminderNumber: null,
      calendarEvent: makeCalendarEvent() as any,
      creditCheckFn: noopCreditCheck,
    } as ScheduleWorkflowRemindersArgs);

    // createNotification was called with correct params
    expect(createNotificationCalls.length).toBe(1);
    const callArg = createNotificationCalls[0] as Record<string, unknown>;
    expect(callArg).toMatchObject({
      userId: 100,
      type: "BOOKING_CREATED",
    });

    // No error was logged
    const inAppErrors = loggedErrors.filter(
      (e) => e.message === "IN_APP_NOTIFICATION workflow step failed"
    );
    expect(inAppErrors.length).toBe(0);
  });

  it("should not skip remaining steps when IN_APP step fails in _sendCancelledReminders", async () => {
    // Two IN_APP steps: first will fail (via mock), second will succeed
    const cancelWorkflow = {
      ...makeWorkflow({ trigger: "EVENT_CANCELLED" }),
      steps: [
        {
          id: 10,
          action: "IN_APP_NOTIFICATION",
          verifiedAt: new Date(),
          reminderBody: "Cancel notification 1",
          sendTo: null,
          sender: null,
          numberVerificationPending: false,
        },
        {
          id: 11,
          action: "IN_APP_NOTIFICATION",
          verifiedAt: new Date(),
          reminderBody: "Cancel notification 2",
          sendTo: null,
          sender: null,
          numberVerificationPending: false,
        },
      ],
    };

    // Override the mock behavior: first call throws, second succeeds
    // We do this by making all calls throw but using the outer try/catch in _sendCancelledReminders
    createNotificationBehavior = "reject";
    createNotificationError = new Error("First step fails");

    await sendCancelledReminders({
      workflows: [cancelWorkflow],
      smsReminderNumber: null,
      evt: makeCalendarEvent() as any,
      creditCheckFn: noopCreditCheck,
    } as SendCancelledRemindersArgs);

    // Both steps should have been attempted (not just the first)
    // Each step's processWorkflowStep call is wrapped in try-catch in _sendCancelledReminders
    expect(createNotificationCalls.length).toBe(2);
  });

  it("should not call createNotification when there is no evt (form submission)", async () => {
    await scheduleWorkflowReminders({
      workflows: [makeWorkflow()],
      smsReminderNumber: null,
      formData: { someField: "value" } as any,
      creditCheckFn: noopCreditCheck,
    } as unknown as ScheduleWorkflowRemindersArgs);

    // IN_APP_NOTIFICATION should early-return when !evt
    expect(createNotificationCalls.length).toBe(0);
  });

  it("should map NEW_EVENT trigger to BOOKING_CREATED notification type", async () => {
    await scheduleWorkflowReminders({
      workflows: [makeWorkflow({ trigger: "NEW_EVENT" })],
      smsReminderNumber: null,
      calendarEvent: makeCalendarEvent() as any,
      creditCheckFn: noopCreditCheck,
    } as ScheduleWorkflowRemindersArgs);

    expect(createNotificationCalls.length).toBe(1);
    expect((createNotificationCalls[0] as any).type).toBe("BOOKING_CREATED");
  });

  it("should map EVENT_CANCELLED trigger to BOOKING_CANCELLED notification type", async () => {
    const cancelWorkflow = makeWorkflow({ trigger: "EVENT_CANCELLED" });

    await sendCancelledReminders({
      workflows: [cancelWorkflow],
      smsReminderNumber: null,
      evt: makeCalendarEvent() as any,
      creditCheckFn: noopCreditCheck,
    } as SendCancelledRemindersArgs);

    expect(createNotificationCalls.length).toBe(1);
    expect((createNotificationCalls[0] as any).type).toBe("BOOKING_CANCELLED");
  });

  // --- NF-004 organizer resolution tests ---

  it("should also notify the booking organizer when their userId differs from workflow.userId", async () => {
    // Organizer email resolves to a DIFFERENT user than the workflow owner
    mockPrismaUserFindFirst = vi.fn().mockResolvedValue({ id: 200 });

    await scheduleWorkflowReminders({
      workflows: [makeWorkflow({ userId: 100 })],
      smsReminderNumber: null,
      calendarEvent: makeCalendarEvent() as any,
      creditCheckFn: noopCreditCheck,
    } as ScheduleWorkflowRemindersArgs);

    // Should have 2 notifications: one for workflow owner (100), one for organizer (200)
    expect(createNotificationCalls.length).toBe(2);
    const userIds = createNotificationCalls.map((c: any) => c.userId);
    expect(userIds).toContain(100);
    expect(userIds).toContain(200);
  });

  it("should deduplicate when organizer userId matches workflow.userId", async () => {
    // Organizer resolves to the SAME user as the workflow owner
    mockPrismaUserFindFirst = vi.fn().mockResolvedValue({ id: 100 });

    await scheduleWorkflowReminders({
      workflows: [makeWorkflow({ userId: 100 })],
      smsReminderNumber: null,
      calendarEvent: makeCalendarEvent() as any,
      creditCheckFn: noopCreditCheck,
    } as ScheduleWorkflowRemindersArgs);

    // Should have exactly 1 notification (deduplicated via Set)
    expect(createNotificationCalls.length).toBe(1);
    expect((createNotificationCalls[0] as any).userId).toBe(100);
  });

  it("should notify the organizer when workflow.userId is null (team workflow)", async () => {
    // Team workflow: userId is null, only organizer should be notified
    mockPrismaUserFindFirst = vi.fn().mockResolvedValue({ id: 300 });

    await scheduleWorkflowReminders({
      workflows: [makeWorkflow({ userId: null, teamId: 5 })],
      smsReminderNumber: null,
      calendarEvent: makeCalendarEvent() as any,
      creditCheckFn: noopCreditCheck,
    } as ScheduleWorkflowRemindersArgs);

    // Should have 1 notification for the organizer
    expect(createNotificationCalls.length).toBe(1);
    expect((createNotificationCalls[0] as any).userId).toBe(300);
  });

  it("should gracefully handle organizer lookup failure and still notify workflow owner", async () => {
    // Organizer lookup throws an error
    mockPrismaUserFindFirst = vi.fn().mockRejectedValue(new Error("DB timeout"));

    await scheduleWorkflowReminders({
      workflows: [makeWorkflow({ userId: 100 })],
      smsReminderNumber: null,
      calendarEvent: makeCalendarEvent() as any,
      creditCheckFn: noopCreditCheck,
    } as ScheduleWorkflowRemindersArgs);

    // Should still notify workflow owner despite organizer lookup failure
    expect(createNotificationCalls.length).toBe(1);
    expect((createNotificationCalls[0] as any).userId).toBe(100);

    // No fatal error logged (only a warn)
    const fatalErrors = loggedErrors.filter(
      (e) => e.message === "IN_APP_NOTIFICATION workflow step failed"
    );
    expect(fatalErrors.length).toBe(0);
  });
});
