import { describe, expect, it, vi, beforeEach } from "vitest";

import type { EventTypeMetadata } from "@calcom/prisma/zod-utils";
import type { CalendarEvent, Person } from "@calcom/types/Calendar";

import {
  shouldSkipAttendeeEmailWithSettings,
  sendScheduledEmailsAndSMS,
  sendCancelledEmailsAndSMS,
  sendRescheduledEmailsAndSMS,
} from "./email-manager";
import { EmailType } from "./email-types";
import AttendeeCancelledEmail from "./templates/attendee-cancelled-email";
import AttendeeRescheduledEmail from "./templates/attendee-rescheduled-email";
import AttendeeScheduledEmail from "./templates/attendee-scheduled-email";
import OrganizerCancelledEmail from "./templates/organizer-cancelled-email";
import OrganizerRescheduledEmail from "./templates/organizer-rescheduled-email";
import OrganizerScheduledEmail from "./templates/organizer-scheduled-email";

const mockGetEmailSettings = vi.fn();

vi.mock("@calcom/features/organizations/repositories/OrganizationSettingsRepository", () => ({
  OrganizationSettingsRepository: vi.fn().mockImplementation(function () {
    return {
      getEmailSettings: mockGetEmailSettings,
    };
  }),
}));

vi.mock("@calcom/prisma", () => ({
  prisma: {},
}));

// Mock dependencies for AttendeeScheduledEmail tests
vi.mock("./lib/generateIcsFile", () => ({
  default: vi.fn(() => "mock-ical-content"),
  GenerateIcsRole: {
    ATTENDEE: "ATTENDEE",
    ORGANIZER: "ORGANIZER",
  },
}));

vi.mock("./src/renderEmail", () => ({
  default: vi.fn(() => Promise.resolve("<html>mock-email</html>")),
}));

vi.mock("@calcom/lib/getReplyToHeader", () => ({
  getReplyToHeader: vi.fn(() => ({})),
}));

vi.mock("@calcom/lib/CalEventParser", () => ({
  getRichDescription: vi.fn(() => "mock-description"),
  getCancelLink: vi.fn(() => "https://cal.com/cancel/mock-uid"),
  getRescheduleLink: vi.fn(() => "https://cal.com/reschedule/mock-uid"),
  getBookingUrl: vi.fn(() => "https://cal.com/booking/mock-uid"),
}));

vi.mock("./templates/_base-email", () => {
  return {
    default: class MockBaseEmail {
      name = "";
      getMailerOptions() {
        return { from: "test@cal.com" };
      }
      sendEmail() {
        return Promise.resolve();
      }
      protected getTimezone() {
        return "UTC";
      }
      protected getLocale() {
        return "en";
      }
      protected getFormattedRecipientTime({ time }: { time: string; format: string }) {
        // Return a predictable time representation for testing
        return time;
      }
    },
  };
});

vi.mock("@calcom/lib/constants", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@calcom/lib/constants")>();
  return {
    ...actual,
    EMAIL_FROM_NAME: "Cal.com",
    WEBAPP_URL: "http://localhost:3000",
    SENDER_ID: "Cal",
  };
});

// Additional mocks needed for dispatch function and template parity testing
vi.mock("@calcom/lib/formatCalendarEvent", () => ({
  formatCalEvent: vi.fn((event: Record<string, unknown>) => event),
}));

vi.mock("@calcom/lib/sentryWrapper", () => ({
  withReporting: vi.fn((fn: (...args: unknown[]) => unknown) => fn),
}));

vi.mock("@calcom/lib/logger", () => ({
  default: {
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock("@calcom/lib/safeStringify", () => ({
  safeStringify: vi.fn((obj: unknown) => JSON.stringify(obj)),
}));

// Mock SMS classes — no-op for email-focused tests.
// Each SMS class is used with `new`, so the mock must be a proper constructor (class).
const mockSendSMSToAttendees: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue(undefined);
const mockSendSMSToAttendee: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue(undefined);

type MockSMSClass = new () => { sendSMSToAttendees: typeof mockSendSMSToAttendees; sendSMSToAttendee: typeof mockSendSMSToAttendee };
function createMockSMSClass(): MockSMSClass {
  return class MockSMS {
    sendSMSToAttendees = mockSendSMSToAttendees;
    sendSMSToAttendee = mockSendSMSToAttendee;
  };
}

vi.mock("../sms/attendee/event-scheduled-sms", () => ({
  default: createMockSMSClass(),
}));

vi.mock("../sms/attendee/event-cancelled-sms", () => ({
  default: createMockSMSClass(),
}));

vi.mock("../sms/attendee/event-rescheduled-sms", () => ({
  default: createMockSMSClass(),
}));

vi.mock("../sms/attendee/awaiting-payment-sms", () => ({
  default: createMockSMSClass(),
}));

vi.mock("../sms/attendee/cancelled-seat-sms", () => ({
  default: createMockSMSClass(),
}));

vi.mock("../sms/attendee/event-declined-sms", () => ({
  default: createMockSMSClass(),
}));

vi.mock("../sms/attendee/event-location-changed-sms", () => ({
  default: createMockSMSClass(),
}));

vi.mock("../sms/attendee/event-request-sms", () => ({
  default: createMockSMSClass(),
}));

vi.mock("../sms/attendee/event-request-to-reschedule-sms", () => ({
  default: createMockSMSClass(),
}));

vi.mock("@calcom/features/eventtypes/lib/eventNaming", () => ({
  getEventName: vi.fn(({ eventType }: { eventType?: string }) => eventType || "Test Event"),
}));

describe("shouldSkipAttendeeEmailWithSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe.each([
    [EmailType.CONFIRMATION, "disableAttendeeConfirmationEmail"],
    [EmailType.CANCELLATION, "disableAttendeeCancellationEmail"],
    [EmailType.RESCHEDULED, "disableAttendeeRescheduledEmail"],
    [EmailType.REQUEST, "disableAttendeeRequestEmail"],
    [EmailType.REASSIGNED, "disableAttendeeReassignedEmail"],
    [EmailType.AWAITING_PAYMENT, "disableAttendeeAwaitingPaymentEmail"],
    [EmailType.RESCHEDULE_REQUEST, "disableAttendeeRescheduleRequestEmail"],
    [EmailType.LOCATION_CHANGE, "disableAttendeeLocationChangeEmail"],
    [EmailType.NEW_EVENT, "disableAttendeeNewEventEmail"],
  ] as const)("Email type: %s", (emailType, settingKey) => {
    it(`should skip email when organization has ${settingKey} enabled`, async () => {
      const orgSettings = {
        disableAttendeeConfirmationEmail: settingKey === "disableAttendeeConfirmationEmail",
        disableAttendeeCancellationEmail: settingKey === "disableAttendeeCancellationEmail",
        disableAttendeeRescheduledEmail: settingKey === "disableAttendeeRescheduledEmail",
        disableAttendeeRequestEmail: settingKey === "disableAttendeeRequestEmail",
        disableAttendeeReassignedEmail: settingKey === "disableAttendeeReassignedEmail",
        disableAttendeeAwaitingPaymentEmail: settingKey === "disableAttendeeAwaitingPaymentEmail",
        disableAttendeeRescheduleRequestEmail: settingKey === "disableAttendeeRescheduleRequestEmail",
        disableAttendeeLocationChangeEmail: settingKey === "disableAttendeeLocationChangeEmail",
        disableAttendeeNewEventEmail: settingKey === "disableAttendeeNewEventEmail",
      };

      const result = shouldSkipAttendeeEmailWithSettings(undefined, orgSettings, emailType);
      expect(result).toBe(true);
    });

    it(`should send email when organization has ${settingKey} disabled`, async () => {
      const orgSettings = {
        disableAttendeeConfirmationEmail: false,
        disableAttendeeCancellationEmail: false,
        disableAttendeeRescheduledEmail: false,
        disableAttendeeRequestEmail: false,
        disableAttendeeReassignedEmail: false,
        disableAttendeeAwaitingPaymentEmail: false,
        disableAttendeeRescheduleRequestEmail: false,
        disableAttendeeLocationChangeEmail: false,
        disableAttendeeNewEventEmail: false,
      };

      const result = shouldSkipAttendeeEmailWithSettings(undefined, orgSettings, emailType);
      expect(result).toBe(false);
    });
  });

  describe("Metadata fallback", () => {
    it("should skip email when metadata has disableStandardEmails.all.attendee enabled", () => {
      const metadata: EventTypeMetadata = {
        disableStandardEmails: {
          all: {
            attendee: true,
          },
        },
      };

      const result = shouldSkipAttendeeEmailWithSettings(metadata, null, EmailType.CONFIRMATION);
      expect(result).toBe(true);
    });
  });

  describe("Priority: organization settings override metadata", () => {
    it("should skip email when org setting is enabled even if metadata allows", () => {
      const orgSettings = {
        disableAttendeeConfirmationEmail: true,
        disableAttendeeCancellationEmail: false,
        disableAttendeeRescheduledEmail: false,
        disableAttendeeRequestEmail: false,
        disableAttendeeReassignedEmail: false,
        disableAttendeeAwaitingPaymentEmail: false,
        disableAttendeeRescheduleRequestEmail: false,
        disableAttendeeLocationChangeEmail: false,
        disableAttendeeNewEventEmail: false,
      };

      const metadata: EventTypeMetadata = {
        disableStandardEmails: {
          confirmation: {
            attendee: false,
          },
        },
      };

      const result = shouldSkipAttendeeEmailWithSettings(metadata, orgSettings, EmailType.CONFIRMATION);
      expect(result).toBe(true);
    });
  });

  describe("Edge cases", () => {
    it("should send email when organizationSettings is null", () => {
      const result = shouldSkipAttendeeEmailWithSettings(undefined, null, EmailType.CONFIRMATION);
      expect(result).toBe(false);
    });

    it("should send email when emailType is undefined", () => {
      const orgSettings = {
        disableAttendeeConfirmationEmail: true,
        disableAttendeeCancellationEmail: false,
        disableAttendeeRescheduledEmail: false,
        disableAttendeeRequestEmail: false,
        disableAttendeeReassignedEmail: false,
        disableAttendeeAwaitingPaymentEmail: false,
        disableAttendeeRescheduleRequestEmail: false,
        disableAttendeeLocationChangeEmail: false,
        disableAttendeeNewEventEmail: false,
      };

      const result = shouldSkipAttendeeEmailWithSettings(undefined, orgSettings, undefined);
      expect(result).toBe(false);
    });

    it("should send email when metadata is undefined and org settings are disabled", () => {
      const orgSettings = {
        disableAttendeeConfirmationEmail: false,
        disableAttendeeCancellationEmail: false,
        disableAttendeeRescheduledEmail: false,
        disableAttendeeRequestEmail: false,
        disableAttendeeReassignedEmail: false,
        disableAttendeeAwaitingPaymentEmail: false,
        disableAttendeeRescheduleRequestEmail: false,
        disableAttendeeLocationChangeEmail: false,
        disableAttendeeNewEventEmail: false,
      };

      const result = shouldSkipAttendeeEmailWithSettings(undefined, orgSettings, EmailType.CONFIRMATION);
      expect(result).toBe(false);
    });
  });
});

describe("AttendeeScheduledEmail - Privacy fix for seated events", () => {
  const createMockPerson = (name: string, email: string): Person => ({
    name,
    email,
    timeZone: "America/New_York",
    language: {
      translate: vi.fn((key: string) => key) as unknown as Person["language"]["translate"],
      locale: "en",
    },
  });

  const createMockCalendarEvent = (
    options: {
      seatsPerTimeSlot?: number | null;
      seatsShowAttendees?: boolean | null;
      attendees?: Person[];
    } = {}
  ): CalendarEvent => {
    const attendees = options.attendees || [
      createMockPerson("Alice", "alice@example.com"),
      createMockPerson("Bob", "bob@example.com"),
      createMockPerson("Charlie", "charlie@example.com"),
    ];

    return {
      title: "Test Event",
      type: "Test Event Type",
      startTime: "2024-01-01T10:00:00Z",
      endTime: "2024-01-01T11:00:00Z",
      organizer: createMockPerson("Organizer", "organizer@example.com"),
      attendees,
      seatsPerTimeSlot: options.seatsPerTimeSlot ?? null,
      seatsShowAttendees: options.seatsShowAttendees ?? null,
    } as CalendarEvent;
  };

  describe("Privacy: seatsShowAttendees setting", () => {
    it("should filter attendees to only recipient when seatsShowAttendees is false for seated events", () => {
      const calEvent = createMockCalendarEvent({
        seatsPerTimeSlot: 5,
        seatsShowAttendees: false,
      });
      const recipient = calEvent.attendees[0];

      const email = new AttendeeScheduledEmail(calEvent, recipient);

      // Should only contain the recipient
      expect(email.calEvent.attendees).toHaveLength(1);
      expect(email.calEvent.attendees[0].email).toBe(recipient.email);
      expect(email.calEvent.attendees[0].name).toBe(recipient.name);
    });

    it("should include all attendees when seatsShowAttendees is true for seated events", () => {
      const calEvent = createMockCalendarEvent({
        seatsPerTimeSlot: 5,
        seatsShowAttendees: true,
      });
      const recipient = calEvent.attendees[0];

      const email = new AttendeeScheduledEmail(calEvent, recipient);

      // Should contain all attendees
      expect(email.calEvent.attendees).toHaveLength(3);
      expect(email.calEvent.attendees.map((a) => a.email)).toEqual([
        "alice@example.com",
        "bob@example.com",
        "charlie@example.com",
      ]);
    });

    it("should filter attendees when seatsShowAttendees is null for seated events (defaults to false)", () => {
      const calEvent = createMockCalendarEvent({
        seatsPerTimeSlot: 5,
        seatsShowAttendees: null,
      });
      const recipient = calEvent.attendees[0];

      const email = new AttendeeScheduledEmail(calEvent, recipient);

      // Should only contain the recipient (null defaults to false)
      expect(email.calEvent.attendees).toHaveLength(1);
      expect(email.calEvent.attendees[0].email).toBe(recipient.email);
    });

    it("should include all attendees for non-seated events regardless of seatsShowAttendees", () => {
      const calEvent = createMockCalendarEvent({
        seatsPerTimeSlot: null,
        seatsShowAttendees: false, // This shouldn't matter for non-seated events
      });
      const recipient = calEvent.attendees[0];

      const email = new AttendeeScheduledEmail(calEvent, recipient);

      // Should contain all attendees (non-seated events always show all)
      expect(email.calEvent.attendees).toHaveLength(3);
    });
  });

  describe("Explicit showAttendees parameter", () => {
    it("should use explicit showAttendees=true parameter even when seatsShowAttendees is false", () => {
      const calEvent = createMockCalendarEvent({
        seatsPerTimeSlot: 5,
        seatsShowAttendees: false,
      });
      const recipient = calEvent.attendees[0];

      const email = new AttendeeScheduledEmail(calEvent, recipient, true);

      // Should contain all attendees because explicit parameter overrides
      expect(email.calEvent.attendees).toHaveLength(3);
    });

    it("should use explicit showAttendees=false parameter even when seatsShowAttendees is true", () => {
      const calEvent = createMockCalendarEvent({
        seatsPerTimeSlot: 5,
        seatsShowAttendees: true,
      });
      const recipient = calEvent.attendees[0];

      const email = new AttendeeScheduledEmail(calEvent, recipient, false);

      // Should only contain recipient because explicit parameter overrides
      expect(email.calEvent.attendees).toHaveLength(1);
      expect(email.calEvent.attendees[0].email).toBe(recipient.email);
    });
  });

  describe("Edge cases", () => {
    it("should handle single attendee correctly when filtering", () => {
      const calEvent = createMockCalendarEvent({
        seatsPerTimeSlot: 5,
        seatsShowAttendees: false,
        attendees: [createMockPerson("Solo", "solo@example.com")],
      });
      const recipient = calEvent.attendees[0];

      const email = new AttendeeScheduledEmail(calEvent, recipient);

      expect(email.calEvent.attendees).toHaveLength(1);
      expect(email.calEvent.attendees[0].email).toBe("solo@example.com");
    });

    it("should not mutate original calEvent when filtering attendees", () => {
      const calEvent = createMockCalendarEvent({
        seatsPerTimeSlot: 5,
        seatsShowAttendees: false,
      });
      const originalAttendeesCount = calEvent.attendees.length;
      const recipient = calEvent.attendees[0];

      const email = new AttendeeScheduledEmail(calEvent, recipient);

      // Original calEvent should remain unchanged
      expect(calEvent.attendees).toHaveLength(originalAttendeesCount);
      // Email's calEvent should be filtered
      expect(email.calEvent.attendees).toHaveLength(1);
      // They should be different objects (cloned)
      expect(email.calEvent).not.toBe(calEvent);
    });

    it("should use same calEvent reference when not filtering (performance optimization)", () => {
      const calEvent = createMockCalendarEvent({
        seatsPerTimeSlot: 5,
        seatsShowAttendees: true,
      });
      const recipient = calEvent.attendees[0];

      const email = new AttendeeScheduledEmail(calEvent, recipient);

      // Should use same reference when not filtering
      expect(email.calEvent).toBe(calEvent);
    });
  });

  describe("Real-world scenarios", () => {
    it("should protect privacy for paid seated events with sharing disabled", () => {
      // This is the reported bug scenario
      const calEvent = createMockCalendarEvent({
        seatsPerTimeSlot: 10,
        seatsShowAttendees: false, // Privacy setting disabled
        attendees: [
          createMockPerson("Customer 1", "customer1@example.com"),
          createMockPerson("Customer 2", "customer2@example.com"),
          createMockPerson("Customer 3", "customer3@example.com"),
        ],
      });
      const recipient = calEvent.attendees[1]; // Customer 2

      const email = new AttendeeScheduledEmail(calEvent, recipient);

      // Customer 2 should only see their own information
      expect(email.calEvent.attendees).toHaveLength(1);
      expect(email.calEvent.attendees[0].email).toBe("customer2@example.com");
      expect(email.calEvent.attendees[0].name).toBe("Customer 2");
      // Should not contain other customers' information
      expect(email.calEvent.attendees.some((a) => a.email === "customer1@example.com")).toBe(false);
      expect(email.calEvent.attendees.some((a) => a.email === "customer3@example.com")).toBe(false);
    });

    it("should allow sharing when explicitly enabled for seated events", () => {
      const calEvent = createMockCalendarEvent({
        seatsPerTimeSlot: 10,
        seatsShowAttendees: true, // Sharing enabled
        attendees: [
          createMockPerson("Attendee 1", "attendee1@example.com"),
          createMockPerson("Attendee 2", "attendee2@example.com"),
        ],
      });
      const recipient = calEvent.attendees[0];

      const email = new AttendeeScheduledEmail(calEvent, recipient);

      // Should see all attendees when sharing is enabled
      expect(email.calEvent.attendees).toHaveLength(2);
      expect(email.calEvent.attendees.map((a) => a.email)).toEqual([
        "attendee1@example.com",
        "attendee2@example.com",
      ]);
    });
  });
});

// ============================================================================
// NF-001: Calendly Parity Test Suites
// ============================================================================
//
// These test suites validate that email content matches Calendly's notification
// patterns for confirmation, cancellation, and rescheduled emails, as required
// by Sprint 8 NF-001.

/**
 * Helper to access protected getNodeMailerPayload() in tests.
 * TypeScript enforces protected visibility at compile time, but we need
 * access in tests to validate email content. This helper uses a type
 * assertion to access the method safely in the test context.
 */
function getPayload(email: unknown): Promise<Record<string, unknown>> {
  return (email as { getNodeMailerPayload(): Promise<Record<string, unknown>> }).getNodeMailerPayload();
}

/**
 * Creates a mock Person with timezone-aware language settings.
 * Extended from the existing createMockPerson in the privacy test suite
 * with additional Calendly-parity fields.
 */
function createParityPerson(
  name: string,
  email: string,
  timeZone: string = "America/New_York",
  locale: string = "en"
): Person {
  return {
    name,
    email,
    timeZone,
    language: {
      translate: vi.fn((key: string, params?: Record<string, string>) => {
        if (params) {
          return Object.entries(params).reduce(
            (result, [paramKey, paramValue]) => result.replace(`{{${paramKey}}}`, paramValue),
            key
          );
        }
        return key;
      }) as unknown as Person["language"]["translate"],
      locale,
    },
  };
}

/**
 * Creates a comprehensive mock CalendarEvent with all Calendly-parity fields.
 * Includes bookerUrl, location, responses, additionalNotes, recurringEvent,
 * and timezone-aware data for thorough parity testing.
 */
function createParityCalendarEvent(
  overrides: Partial<CalendarEvent> = {}
): CalendarEvent {
  const organizer = createParityPerson("Jane Organizer", "jane@example.com", "America/Los_Angeles");
  const attendees = [
    createParityPerson("John Attendee", "john@example.com", "America/New_York"),
    createParityPerson("Alice Attendee", "alice@example.com", "Europe/London"),
  ];

  return {
    title: "30 Minute Meeting",
    type: "30min",
    startTime: "2025-03-15T14:00:00Z",
    endTime: "2025-03-15T14:30:00Z",
    organizer,
    attendees,
    uid: "cal-booking-uid-abc123",
    bookerUrl: "https://cal.com",
    location: "https://meet.google.com/abc-defg-hij",
    additionalNotes: "Looking forward to our discussion about the project roadmap.",
    responses: {
      name: { label: "Your Name", value: "John Attendee" },
      email: { label: "Email", value: "john@example.com" },
      notes: { label: "Additional Notes", value: "Looking forward to it" },
    } as CalendarEvent["responses"],
    description: "A 30-minute introductory call.",
    ...overrides,
  } as CalendarEvent;
}

/**
 * Creates a CalendarEvent with physical address location for testing
 * in-person meeting email content.
 */
function createPhysicalLocationEvent(
  overrides: Partial<CalendarEvent> = {}
): CalendarEvent {
  return createParityCalendarEvent({
    location: "123 Main Street, Suite 400, San Francisco, CA 94105",
    ...overrides,
  });
}

/**
 * Creates a CalendarEvent with recurring event configuration for testing
 * recurring event email content patterns.
 */
function createRecurringEvent(
  overrides: Partial<CalendarEvent> = {}
): CalendarEvent {
  return createParityCalendarEvent({
    recurringEvent: {
      interval: 1,
      count: 4,
      freq: 2,
    },
    ...overrides,
  });
}

/**
 * Creates a CalendarEvent with cancellation context for testing
 * cancellation-specific email content.
 */
function createCancelledEvent(
  overrides: Partial<CalendarEvent> = {}
): CalendarEvent {
  return createParityCalendarEvent({
    cancellationReason: "Schedule conflict with another meeting",
    ...overrides,
  });
}

/**
 * Creates a CalendarEvent with reschedule context for testing
 * rescheduled-specific email content.
 */
function createRescheduledEvent(
  overrides: Partial<CalendarEvent> = {}
): CalendarEvent {
  return createParityCalendarEvent({
    rescheduledBy: "john@example.com",
    cancellationReason: "$RCH$Need to move to a later time slot",
    ...overrides,
  });
}

// ============================================================================
// Test Suite 1: Email Content Parity with Calendly Notifications
// ============================================================================

describe("Email Content Parity with Calendly Notifications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // --------------------------------------------------------------------------
  // 1.1 Confirmation Email Content Parity (NF-001)
  // --------------------------------------------------------------------------
  describe("Confirmation Email Content Parity (NF-001)", () => {
    describe("AttendeeScheduledEmail - Calendly parity fields", () => {
      it("should include attendee name in the to field of the email payload", async () => {
        const calEvent = createParityCalendarEvent();
        const attendee = calEvent.attendees[0];
        const email = new AttendeeScheduledEmail(calEvent, attendee);

        const payload = await getPayload(email);

        expect(payload.to).toContain(attendee.name);
        expect(payload.to).toContain(attendee.email);
      });

      it("should include event title prominently in the subject line", async () => {
        const calEvent = createParityCalendarEvent({ title: "Discovery Call with Jane" });
        const attendee = calEvent.attendees[0];
        const email = new AttendeeScheduledEmail(calEvent, attendee);

        const payload = await getPayload(email);

        expect(payload.subject).toBe("Discovery Call with Jane");
      });

      it("should use organizer name in the from field", async () => {
        const calEvent = createParityCalendarEvent();
        const attendee = calEvent.attendees[0];
        const email = new AttendeeScheduledEmail(calEvent, attendee);

        const payload = await getPayload(email);

        expect(payload.from).toContain(calEvent.organizer.name);
      });

      it("should produce an icalEvent attachment for calendar integration", async () => {
        const calEvent = createParityCalendarEvent();
        const attendee = calEvent.attendees[0];
        const email = new AttendeeScheduledEmail(calEvent, attendee);

        const payload = await getPayload(email);

        expect(payload.icalEvent).toBeDefined();
      });

      it("should include cancel and reschedule action links in text body when uid is present", async () => {
        const calEvent = createParityCalendarEvent({
          uid: "booking-uid-12345",
          disableRescheduling: false,
          disableCancelling: false,
        });
        const attendee = calEvent.attendees[0];
        const email = new AttendeeScheduledEmail(calEvent, attendee);

        const payload = await getPayload(email);
        const textBody = payload.text as string;

        expect(textBody).toContain("reschedule");
        expect(textBody).toContain("cancel");
      });

      it("should include HTML content for rich email rendering", async () => {
        const calEvent = createParityCalendarEvent();
        const attendee = calEvent.attendees[0];
        const email = new AttendeeScheduledEmail(calEvent, attendee);

        const payload = await getPayload(email);

        expect(payload.html).toBeDefined();
        expect(typeof payload.html).toBe("string");
      });

      it("should preserve video call location in calEvent for template rendering", () => {
        const videoLocation = "https://meet.google.com/abc-defg-hij";
        const calEvent = createParityCalendarEvent({ location: videoLocation });
        const attendee = calEvent.attendees[0];
        const email = new AttendeeScheduledEmail(calEvent, attendee);

        expect(email.calEvent.location).toBe(videoLocation);
      });

      it("should preserve physical address location in calEvent", () => {
        const calEvent = createPhysicalLocationEvent();
        const attendee = calEvent.attendees[0];
        const email = new AttendeeScheduledEmail(calEvent, attendee);

        expect(email.calEvent.location).toBe("123 Main Street, Suite 400, San Francisco, CA 94105");
      });

      it("should preserve additionalNotes for template rendering", () => {
        const calEvent = createParityCalendarEvent({
          additionalNotes: "Please bring your laptop for the demo.",
        });
        const attendee = calEvent.attendees[0];
        const email = new AttendeeScheduledEmail(calEvent, attendee);

        expect(email.calEvent.additionalNotes).toBe("Please bring your laptop for the demo.");
      });

      it("should preserve responses (booking field answers) for template rendering", () => {
        const responses = {
          company: { label: "Company", value: "Acme Corp" },
          phone: { label: "Phone", value: "+1-555-0100" },
        } as CalendarEvent["responses"];
        const calEvent = createParityCalendarEvent({ responses });
        const attendee = calEvent.attendees[0];
        const email = new AttendeeScheduledEmail(calEvent, attendee);

        expect(email.calEvent.responses).toEqual(responses);
      });

      it("should work correctly with recurring event configuration", () => {
        const calEvent = createRecurringEvent();
        const attendee = calEvent.attendees[0];
        const email = new AttendeeScheduledEmail(calEvent, attendee);

        expect(email.calEvent.recurringEvent).toBeDefined();
        expect(email.calEvent.recurringEvent?.count).toBe(4);
        expect(email.calEvent.recurringEvent?.freq).toBe(2);
      });

      it("should handle timezone-aware formatting via getFormattedDate", () => {
        const calEvent = createParityCalendarEvent();
        const attendee = calEvent.attendees[0];
        const email = new AttendeeScheduledEmail(calEvent, attendee);

        const formattedDate = email.getFormattedDate();
        expect(typeof formattedDate).toBe("string");
        expect(formattedDate.length).toBeGreaterThan(0);
      });
    });

    describe("OrganizerScheduledEmail - Calendly parity fields", () => {
      it("should send to the organizer email address", async () => {
        const calEvent = createParityCalendarEvent();
        const email = new OrganizerScheduledEmail({ calEvent });

        const payload = await getPayload(email);

        expect(payload.to).toContain(calEvent.organizer.email);
      });

      it("should include event title in the subject line", async () => {
        const calEvent = createParityCalendarEvent({ title: "Strategy Session" });
        const email = new OrganizerScheduledEmail({ calEvent });

        const payload = await getPayload(email);

        expect(payload.subject).toContain("Strategy Session");
      });

      it("should prefix subject with new_attendee indicator for new seat bookings", async () => {
        const calEvent = createParityCalendarEvent();
        const email = new OrganizerScheduledEmail({ calEvent, newSeat: true });

        const payload = await getPayload(email);
        const subject = payload.subject as string;

        expect(subject).toContain("new_attendee");
        expect(subject).toContain(calEvent.title);
      });

      it("should use EMAIL_FROM_NAME in the from field", async () => {
        const calEvent = createParityCalendarEvent();
        const email = new OrganizerScheduledEmail({ calEvent });

        const payload = await getPayload(email);

        expect(payload.from).toContain("Cal.com");
      });

      it("should send to team member email when teamMember is specified", async () => {
        const calEvent = createParityCalendarEvent();
        const teamMember = createParityPerson("Team Member", "team@example.com");
        const email = new OrganizerScheduledEmail({ calEvent, teamMember });

        const payload = await getPayload(email);

        expect(payload.to).toContain("team@example.com");
      });

      it("should produce an ICS attachment with ORGANIZER role", async () => {
        const calEvent = createParityCalendarEvent();
        const email = new OrganizerScheduledEmail({ calEvent });

        const payload = await getPayload(email);

        expect(payload.icalEvent).toBeDefined();
      });

      it("should include rich description in text body with event details", async () => {
        const calEvent = createParityCalendarEvent();
        const email = new OrganizerScheduledEmail({ calEvent });

        const payload = await getPayload(email);
        const textBody = payload.text as string;

        expect(textBody).toContain("mock-description");
      });

      it("should handle recurring event scheduling text variant", async () => {
        const calEvent = createRecurringEvent();
        const email = new OrganizerScheduledEmail({ calEvent });

        const payload = await getPayload(email);
        const textBody = payload.text as string;

        expect(textBody).toContain("new_event_scheduled_recurring");
      });
    });

    describe("Timezone-aware date formatting across multiple timezones", () => {
      const timezones = [
        { tz: "America/New_York", locale: "en", label: "US Eastern" },
        { tz: "Europe/London", locale: "en", label: "UK" },
        { tz: "Asia/Tokyo", locale: "ja", label: "Japan" },
        { tz: "Australia/Sydney", locale: "en", label: "Australia Eastern" },
        { tz: "America/Los_Angeles", locale: "en", label: "US Pacific" },
      ];

      it.each(timezones)(
        "should produce a formatted date string for $label timezone ($tz)",
        ({ tz, locale }) => {
          const attendee = createParityPerson("Tz Attendee", "tz@example.com", tz, locale);
          const calEvent = createParityCalendarEvent({ attendees: [attendee] });
          const email = new AttendeeScheduledEmail(calEvent, attendee);

          const formattedDate = email.getFormattedDate();

          expect(typeof formattedDate).toBe("string");
          expect(formattedDate.length).toBeGreaterThan(0);
          expect(formattedDate).toContain(" - ");
        }
      );
    });
  });

  // --------------------------------------------------------------------------
  // 1.2 Cancellation Email Content Parity (NF-001)
  // --------------------------------------------------------------------------
  describe("Cancellation Email Content Parity (NF-001)", () => {
    describe("AttendeeCancelledEmail - Calendly parity fields", () => {
      it("should include cancellation-specific subject line with event title and date", async () => {
        const calEvent = createCancelledEvent();
        const attendee = calEvent.attendees[0];
        const email = new AttendeeCancelledEmail(calEvent, attendee);

        const payload = await getPayload(email);
        const subject = payload.subject as string;

        expect(subject).toContain("event_cancelled_subject");
      });

      it("should send to the correct attendee", async () => {
        const calEvent = createCancelledEvent();
        const attendee = calEvent.attendees[0];
        const email = new AttendeeCancelledEmail(calEvent, attendee);

        const payload = await getPayload(email);

        expect(payload.to).toContain(attendee.name);
        expect(payload.to).toContain(attendee.email);
      });

      it("should include cancellation reason in the text body when available", async () => {
        const calEvent = createCancelledEvent({
          cancellationReason: "Emergency came up, need to reschedule",
        });
        const attendee = calEvent.attendees[0];
        const email = new AttendeeCancelledEmail(calEvent, attendee);

        const payload = await getPayload(email);
        const textBody = payload.text as string;

        expect(textBody).toContain("cancellation_reason");
        expect(textBody).toContain("Emergency came up, need to reschedule");
      });

      it("should strip the $RCH$ prefix from reschedule-triggered cancellation reasons", async () => {
        const calEvent = createCancelledEvent({
          cancellationReason: "$RCH$Moved to a different day",
        });
        const attendee = calEvent.attendees[0];
        const email = new AttendeeCancelledEmail(calEvent, attendee);

        const payload = await getPayload(email);
        const textBody = payload.text as string;

        expect(textBody).not.toContain("$RCH$");
        expect(textBody).toContain("Moved to a different day");
      });

      it("should include rebooking URL when bookerUrl and organizer username are available", async () => {
        const calEvent = createCancelledEvent({
          bookerUrl: "https://cal.com",
          organizer: {
            ...createParityPerson("Jane Organizer", "jane@example.com"),
            username: "jane",
          } as CalendarEvent["organizer"],
        });
        const attendee = calEvent.attendees[0];
        const email = new AttendeeCancelledEmail(calEvent, attendee);

        const payload = await getPayload(email);
        const textBody = payload.text as string;

        expect(textBody).toContain("book_a_new_time");
        expect(textBody).toContain("https://cal.com/jane/");
      });

      it("should include booking detail URL from getBookingUrl", async () => {
        const calEvent = createCancelledEvent();
        const attendee = calEvent.attendees[0];
        const email = new AttendeeCancelledEmail(calEvent, attendee);

        const payload = await getPayload(email);
        const textBody = payload.text as string;

        expect(textBody).toContain("view_booking");
        expect(textBody).toContain("https://cal.com/booking/mock-uid");
      });

      it("should produce an ICS attachment with CANCELLED status", async () => {
        const calEvent = createCancelledEvent();
        const attendee = calEvent.attendees[0];
        const email = new AttendeeCancelledEmail(calEvent, attendee);

        const payload = await getPayload(email);

        expect(payload.icalEvent).toBeDefined();
      });

      it("should not include rebooking URL when bookerUrl is missing", async () => {
        const calEvent = createCancelledEvent({
          bookerUrl: undefined,
        });
        const attendee = calEvent.attendees[0];
        const email = new AttendeeCancelledEmail(calEvent, attendee);

        const payload = await getPayload(email);
        const textBody = payload.text as string;

        expect(textBody).not.toContain("book_a_new_time");
      });

      it("should not include cancellation reason when reason is empty or whitespace", async () => {
        const calEvent = createCancelledEvent({
          cancellationReason: "   ",
        });
        const attendee = calEvent.attendees[0];
        const email = new AttendeeCancelledEmail(calEvent, attendee);

        const payload = await getPayload(email);
        const textBody = payload.text as string;

        expect(textBody).not.toContain("cancellation_reason");
      });
    });

    describe("OrganizerCancelledEmail - Calendly parity fields", () => {
      it("should include cancellation subject with event title and date", async () => {
        const calEvent = createCancelledEvent();
        const email = new OrganizerCancelledEmail({ calEvent });

        const payload = await getPayload(email);
        const subject = payload.subject as string;

        expect(subject).toContain("event_cancelled_subject");
      });

      it("should send to the organizer email address", async () => {
        const calEvent = createCancelledEvent();
        const email = new OrganizerCancelledEmail({ calEvent });

        const payload = await getPayload(email);

        expect(payload.to).toContain(calEvent.organizer.email);
      });

      it("should include the cancelled attendee information in the text body", async () => {
        const calEvent = createCancelledEvent();
        const email = new OrganizerCancelledEmail({ calEvent });

        const payload = await getPayload(email);
        const textBody = payload.text as string;

        expect(textBody).toContain("cancelled_by");
        expect(textBody).toContain(calEvent.attendees[0].name);
        expect(textBody).toContain(calEvent.attendees[0].email);
      });

      it("should use reassigned subject when reassigned context is provided", async () => {
        const calEvent = createCancelledEvent();
        const reassigned = { name: "New Host", email: "newhost@example.com", reason: "Unavailable" };
        const email = new OrganizerCancelledEmail({ calEvent, reassigned });

        const payload = await getPayload(email);
        const subject = payload.subject as string;

        expect(subject).toContain("event_reassigned_subject");
      });

      it("should not include cancelled-by info when event is a reassignment", async () => {
        const calEvent = createCancelledEvent();
        const reassigned = { name: "New Host", email: "newhost@example.com" };
        const email = new OrganizerCancelledEmail({ calEvent, reassigned });

        const payload = await getPayload(email);
        const textBody = payload.text as string;

        expect(textBody).not.toContain("cancelled_by");
      });

      it("should send to team member email when teamMember is specified", async () => {
        const calEvent = createCancelledEvent();
        const teamMember = createParityPerson("Team Lead", "teamlead@example.com");
        const email = new OrganizerCancelledEmail({ calEvent, teamMember });

        const payload = await getPayload(email);

        expect(payload.to).toContain("teamlead@example.com");
      });

      it("should use EMAIL_FROM_NAME in the from field", async () => {
        const calEvent = createCancelledEvent();
        const email = new OrganizerCancelledEmail({ calEvent });

        const payload = await getPayload(email);

        expect(payload.from).toContain("Cal.com");
      });
    });
  });

  // --------------------------------------------------------------------------
  // 1.3 Rescheduled Email Content Parity (NF-001)
  // --------------------------------------------------------------------------
  describe("Rescheduled Email Content Parity (NF-001)", () => {
    describe("AttendeeRescheduledEmail - Calendly parity fields", () => {
      it("should include rescheduled subject with event title and formatted date", async () => {
        const calEvent = createRescheduledEvent();
        const attendee = calEvent.attendees[0];
        const email = new AttendeeRescheduledEmail(calEvent, attendee);

        const payload = await getPayload(email);
        const subject = payload.subject as string;

        expect(subject).toContain("event_type_has_been_rescheduled_on_time_date");
      });

      it("should send to the correct attendee with name and email", async () => {
        const calEvent = createRescheduledEvent();
        const attendee = calEvent.attendees[0];
        const email = new AttendeeRescheduledEmail(calEvent, attendee);

        const payload = await getPayload(email);

        expect(payload.to).toContain(attendee.name);
        expect(payload.to).toContain(attendee.email);
      });

      it("should include rescheduler identity in text body when rescheduledBy is present", async () => {
        const calEvent = createRescheduledEvent({
          rescheduledBy: "organizer@example.com",
        });
        const attendee = calEvent.attendees[0];
        const email = new AttendeeRescheduledEmail(calEvent, attendee);

        const payload = await getPayload(email);
        const textBody = payload.text as string;

        expect(textBody).toContain("rescheduled_by");
        expect(textBody).toContain("organizer@example.com");
      });

      it("should include reschedule reason in text body when $RCH$ prefixed reason is present", async () => {
        const calEvent = createRescheduledEvent({
          cancellationReason: "$RCH$Conflicting meeting moved to this time",
        });
        const attendee = calEvent.attendees[0];
        const email = new AttendeeRescheduledEmail(calEvent, attendee);

        const payload = await getPayload(email);
        const textBody = payload.text as string;

        expect(textBody).toContain("reason_for_reschedule");
        expect(textBody).toContain("Conflicting meeting moved to this time");
        expect(textBody).not.toContain("$RCH$");
      });

      it("should not include reschedule reason when cancellationReason lacks $RCH$ prefix", async () => {
        const calEvent = createRescheduledEvent({
          cancellationReason: "Regular cancellation reason without prefix",
          rescheduledBy: undefined,
        });
        const attendee = calEvent.attendees[0];
        const email = new AttendeeRescheduledEmail(calEvent, attendee);

        const payload = await getPayload(email);
        const textBody = payload.text as string;

        expect(textBody).not.toContain("reason_for_reschedule");
      });

      it("should preserve updated location in calEvent for template rendering", () => {
        const calEvent = createRescheduledEvent({
          location: "https://zoom.us/j/new-meeting-id",
        });
        const attendee = calEvent.attendees[0];
        const email = new AttendeeRescheduledEmail(calEvent, attendee);

        expect(email.calEvent.location).toBe("https://zoom.us/j/new-meeting-id");
      });

      it("should produce a CONFIRMED ICS attachment for rescheduled events", async () => {
        const calEvent = createRescheduledEvent();
        const attendee = calEvent.attendees[0];
        const email = new AttendeeRescheduledEmail(calEvent, attendee);

        const payload = await getPayload(email);

        expect(payload.icalEvent).toBeDefined();
      });

      it("should use organizer name in the from field", async () => {
        const calEvent = createRescheduledEvent();
        const attendee = calEvent.attendees[0];
        const email = new AttendeeRescheduledEmail(calEvent, attendee);

        const payload = await getPayload(email);

        expect(payload.from).toContain(calEvent.organizer.name);
      });
    });

    describe("OrganizerRescheduledEmail - Calendly parity fields", () => {
      it("should include rescheduled subject with event title", async () => {
        const calEvent = createRescheduledEvent();
        const email = new OrganizerRescheduledEmail({ calEvent });

        const payload = await getPayload(email);
        const subject = payload.subject as string;

        expect(subject).toContain("event_type_has_been_rescheduled_on_time_date");
      });

      it("should send to the organizer email", async () => {
        const calEvent = createRescheduledEvent();
        const email = new OrganizerRescheduledEmail({ calEvent });

        const payload = await getPayload(email);

        expect(payload.to).toContain(calEvent.organizer.email);
      });

      it("should include rescheduler identity in text body", async () => {
        const calEvent = createRescheduledEvent({
          rescheduledBy: "attendee@example.com",
        });
        const email = new OrganizerRescheduledEmail({ calEvent });

        const payload = await getPayload(email);
        const textBody = payload.text as string;

        expect(textBody).toContain("rescheduled_by");
        expect(textBody).toContain("attendee@example.com");
      });

      it("should include reschedule reason in text body when $RCH$ prefixed", async () => {
        const calEvent = createRescheduledEvent({
          cancellationReason: "$RCH$Client requested afternoon slot instead",
        });
        const email = new OrganizerRescheduledEmail({ calEvent });

        const payload = await getPayload(email);
        const textBody = payload.text as string;

        expect(textBody).toContain("reason_for_reschedule");
        expect(textBody).toContain("Client requested afternoon slot instead");
        expect(textBody).not.toContain("$RCH$");
      });

      it("should send to team member when specified", async () => {
        const calEvent = createRescheduledEvent();
        const teamMember = createParityPerson("Support Rep", "support@example.com");
        const email = new OrganizerRescheduledEmail({ calEvent, teamMember });

        const payload = await getPayload(email);

        expect(payload.to).toContain("support@example.com");
      });

      it("should use EMAIL_FROM_NAME in the from field", async () => {
        const calEvent = createRescheduledEvent();
        const email = new OrganizerRescheduledEmail({ calEvent });

        const payload = await getPayload(email);

        expect(payload.from).toContain("Cal.com");
      });

      it("should produce an ICS attachment with CONFIRMED status", async () => {
        const calEvent = createRescheduledEvent();
        const email = new OrganizerRescheduledEmail({ calEvent });

        const payload = await getPayload(email);

        expect(payload.icalEvent).toBeDefined();
      });
    });
  });

  // --------------------------------------------------------------------------
  // 1.4 Reminder Email Content Parity (NF-001)
  // --------------------------------------------------------------------------
  describe("Reminder Email Content Parity (NF-001)", () => {
    it("should preserve event title for reminder template rendering", () => {
      const calEvent = createParityCalendarEvent({ title: "Quarterly Review" });
      const attendee = calEvent.attendees[0];
      const email = new AttendeeScheduledEmail(calEvent, attendee);

      expect(email.calEvent.title).toBe("Quarterly Review");
    });

    it("should preserve date/time and timezone for reminder content", () => {
      const calEvent = createParityCalendarEvent({
        startTime: "2025-06-01T09:00:00Z",
        endTime: "2025-06-01T10:00:00Z",
      });
      const attendee = createParityPerson("Reminder User", "reminder@example.com", "Asia/Tokyo");
      calEvent.attendees = [attendee];
      const email = new AttendeeScheduledEmail(calEvent, attendee);

      expect(email.calEvent.startTime).toBe("2025-06-01T09:00:00Z");
      expect(email.calEvent.endTime).toBe("2025-06-01T10:00:00Z");
      expect(email.attendee.timeZone).toBe("Asia/Tokyo");
    });

    it("should preserve attendee name for reminder personalization", () => {
      const attendee = createParityPerson("Important Client", "client@example.com");
      const calEvent = createParityCalendarEvent({ attendees: [attendee] });
      const email = new AttendeeScheduledEmail(calEvent, attendee);

      expect(email.attendee.name).toBe("Important Client");
    });

    it("should preserve location details for reminder content", () => {
      const calEvent = createParityCalendarEvent({
        location: "Conference Room B, Floor 3",
      });
      const attendee = calEvent.attendees[0];
      const email = new AttendeeScheduledEmail(calEvent, attendee);

      expect(email.calEvent.location).toBe("Conference Room B, Floor 3");
    });

    it("should preserve bookerUrl for cancel/reschedule link generation in reminders", () => {
      const calEvent = createParityCalendarEvent({
        bookerUrl: "https://custom-domain.cal.com",
      });
      const attendee = calEvent.attendees[0];
      const email = new AttendeeScheduledEmail(calEvent, attendee);

      expect(email.calEvent.bookerUrl).toBe("https://custom-domain.cal.com");
    });
  });
});

// ============================================================================
// Test Suite 2: Email Dispatch Function Parity
// ============================================================================

describe("Email Dispatch Function Parity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetEmailSettings.mockResolvedValue(null);
  });

  // --------------------------------------------------------------------------
  // 2.1 sendScheduledEmailsAndSMS parity
  // --------------------------------------------------------------------------
  describe("sendScheduledEmailsAndSMS - Calendly parity dispatch", () => {
    it("should complete without errors for a standard booking with parity fields", async () => {
      const calEvent = createParityCalendarEvent();
      await expect(sendScheduledEmailsAndSMS(calEvent)).resolves.not.toThrow();
    });

    it("should complete without errors when bookerUrl is missing (graceful degradation)", async () => {
      const calEvent = createParityCalendarEvent({ bookerUrl: undefined });
      await expect(sendScheduledEmailsAndSMS(calEvent)).resolves.not.toThrow();
    });

    it("should complete without errors when location is missing", async () => {
      const calEvent = createParityCalendarEvent({ location: undefined });
      await expect(sendScheduledEmailsAndSMS(calEvent)).resolves.not.toThrow();
    });

    it("should complete without errors for recurring event bookings", async () => {
      const calEvent = createRecurringEvent();
      await expect(sendScheduledEmailsAndSMS(calEvent)).resolves.not.toThrow();
    });

    it("should complete without errors when additionalNotes are present", async () => {
      const calEvent = createParityCalendarEvent({
        additionalNotes: "Special requirements: wheelchair accessible room needed.",
      });
      await expect(sendScheduledEmailsAndSMS(calEvent)).resolves.not.toThrow();
    });

    it("should complete without errors when responses/booking fields are populated", async () => {
      const calEvent = createParityCalendarEvent({
        responses: {
          companyName: { label: "Company", value: "Acme Inc." },
          role: { label: "Role", value: "Engineering Manager" },
        } as CalendarEvent["responses"],
      });
      await expect(sendScheduledEmailsAndSMS(calEvent)).resolves.not.toThrow();
    });

    it("should respect host email disabled flag", async () => {
      const calEvent = createParityCalendarEvent();
      await expect(
        sendScheduledEmailsAndSMS(calEvent, undefined, true, false, undefined)
      ).resolves.not.toThrow();
    });

    it("should respect attendee email disabled flag", async () => {
      const calEvent = createParityCalendarEvent();
      await expect(
        sendScheduledEmailsAndSMS(calEvent, undefined, false, true, undefined)
      ).resolves.not.toThrow();
    });

    it("should handle events with multiple attendees across different timezones", async () => {
      const calEvent = createParityCalendarEvent({
        attendees: [
          createParityPerson("NYC User", "nyc@example.com", "America/New_York"),
          createParityPerson("London User", "london@example.com", "Europe/London"),
          createParityPerson("Tokyo User", "tokyo@example.com", "Asia/Tokyo"),
        ],
      });
      await expect(sendScheduledEmailsAndSMS(calEvent)).resolves.not.toThrow();
    });
  });

  // --------------------------------------------------------------------------
  // 2.2 sendCancelledEmailsAndSMS parity
  // --------------------------------------------------------------------------
  describe("sendCancelledEmailsAndSMS - Calendly parity dispatch", () => {
    it("should complete without errors for a cancellation with reason", async () => {
      const calEvent = createCancelledEvent();
      const eventNameObject = { eventName: "30 Minute Meeting" };
      await expect(sendCancelledEmailsAndSMS(calEvent, eventNameObject)).resolves.not.toThrow();
    });

    it("should complete without errors when cancellationReason is empty", async () => {
      const calEvent = createParityCalendarEvent({ cancellationReason: undefined });
      const eventNameObject = { eventName: "Quick Chat" };
      await expect(sendCancelledEmailsAndSMS(calEvent, eventNameObject)).resolves.not.toThrow();
    });

    it("should complete without errors with rebooking URL components present", async () => {
      const calEvent = createCancelledEvent({
        bookerUrl: "https://cal.com",
        organizer: {
          ...createParityPerson("Host", "host@example.com"),
          username: "host",
        } as CalendarEvent["organizer"],
      });
      const eventNameObject = { eventName: "Cancelled Meeting" };
      await expect(sendCancelledEmailsAndSMS(calEvent, eventNameObject)).resolves.not.toThrow();
    });

    it("should complete without errors for cancellation with team members", async () => {
      const calEvent = createCancelledEvent({
        team: {
          name: "Sales Team",
          id: 1,
          members: [
            createParityPerson("Sales Rep 1", "rep1@example.com"),
            createParityPerson("Sales Rep 2", "rep2@example.com"),
          ],
        } as CalendarEvent["team"],
      });
      const eventNameObject = { eventName: "Team Call" };
      await expect(sendCancelledEmailsAndSMS(calEvent, eventNameObject)).resolves.not.toThrow();
    });

    it("should respect eventTypeMetadata disable host email setting", async () => {
      const calEvent = createCancelledEvent();
      const eventNameObject = { eventName: "Meeting" };
      const metadata = { disableHostEmail: true } as EventTypeMetadata;
      await expect(
        sendCancelledEmailsAndSMS(calEvent, eventNameObject, metadata)
      ).resolves.not.toThrow();
    });
  });

  // --------------------------------------------------------------------------
  // 2.3 sendRescheduledEmailsAndSMS parity
  // --------------------------------------------------------------------------
  describe("sendRescheduledEmailsAndSMS - Calendly parity dispatch", () => {
    it("should complete without errors for a reschedule with context", async () => {
      const calEvent = createRescheduledEvent();
      await expect(sendRescheduledEmailsAndSMS(calEvent)).resolves.not.toThrow();
    });

    it("should complete without errors when rescheduledBy is missing", async () => {
      const calEvent = createParityCalendarEvent({ rescheduledBy: undefined });
      await expect(sendRescheduledEmailsAndSMS(calEvent)).resolves.not.toThrow();
    });

    it("should complete without errors with updated location after reschedule", async () => {
      const calEvent = createRescheduledEvent({
        location: "https://teams.microsoft.com/new-link",
      });
      await expect(sendRescheduledEmailsAndSMS(calEvent)).resolves.not.toThrow();
    });

    it("should complete without errors for reschedule with team members", async () => {
      const calEvent = createRescheduledEvent({
        team: {
          name: "Engineering",
          id: 2,
          members: [createParityPerson("Engineer", "eng@example.com")],
        } as CalendarEvent["team"],
      });
      await expect(sendRescheduledEmailsAndSMS(calEvent)).resolves.not.toThrow();
    });

    it("should complete without errors when hideCalendarNotes is set", async () => {
      const calEvent = createRescheduledEvent({
        hideCalendarNotes: true,
        additionalNotes: "These notes should be hidden in attendee emails",
      });
      await expect(sendRescheduledEmailsAndSMS(calEvent)).resolves.not.toThrow();
    });
  });

  // --------------------------------------------------------------------------
  // 2.4 Backward compatibility of dispatch functions
  // --------------------------------------------------------------------------
  describe("Backward compatibility of dispatch functions", () => {
    it("sendScheduledEmailsAndSMS should accept the original function signature", async () => {
      const calEvent = createParityCalendarEvent();
      await expect(sendScheduledEmailsAndSMS(calEvent)).resolves.not.toThrow();
    });

    it("sendCancelledEmailsAndSMS should accept the original function signature", async () => {
      const calEvent = createParityCalendarEvent();
      const eventNameObject = { eventName: "Test" };
      await expect(sendCancelledEmailsAndSMS(calEvent, eventNameObject)).resolves.not.toThrow();
    });

    it("sendRescheduledEmailsAndSMS should accept the original function signature", async () => {
      const calEvent = createParityCalendarEvent();
      await expect(sendRescheduledEmailsAndSMS(calEvent)).resolves.not.toThrow();
    });

    it("sendScheduledEmailsAndSMS should handle minimal CalendarEvent", async () => {
      const minimalEvent = {
        title: "Minimal Event",
        type: "minimal",
        startTime: "2025-01-01T10:00:00Z",
        endTime: "2025-01-01T10:30:00Z",
        organizer: createParityPerson("Org", "org@example.com"),
        attendees: [createParityPerson("Att", "att@example.com")],
      } as CalendarEvent;
      await expect(sendScheduledEmailsAndSMS(minimalEvent)).resolves.not.toThrow();
    });

    it("sendCancelledEmailsAndSMS should handle minimal CalendarEvent", async () => {
      const minimalEvent = {
        title: "Minimal Cancel",
        type: "minimal",
        startTime: "2025-01-01T10:00:00Z",
        endTime: "2025-01-01T10:30:00Z",
        organizer: createParityPerson("Org", "org@example.com"),
        attendees: [createParityPerson("Att", "att@example.com")],
      } as CalendarEvent;
      await expect(
        sendCancelledEmailsAndSMS(minimalEvent, { eventName: "Minimal" })
      ).resolves.not.toThrow();
    });

    it("sendRescheduledEmailsAndSMS should handle minimal CalendarEvent", async () => {
      const minimalEvent = {
        title: "Minimal Reschedule",
        type: "minimal",
        startTime: "2025-01-01T10:00:00Z",
        endTime: "2025-01-01T10:30:00Z",
        organizer: createParityPerson("Org", "org@example.com"),
        attendees: [createParityPerson("Att", "att@example.com")],
      } as CalendarEvent;
      await expect(sendRescheduledEmailsAndSMS(minimalEvent)).resolves.not.toThrow();
    });
  });

  // --------------------------------------------------------------------------
  // 2.5 shouldSkipAttendeeEmailWithSettings - new EmailType values
  // --------------------------------------------------------------------------
  describe("shouldSkipAttendeeEmailWithSettings - new EmailType values (NF-001/NF-003)", () => {
    it("should handle EmailType.REMINDER without throwing", () => {
      const result = shouldSkipAttendeeEmailWithSettings(undefined, null, EmailType.REMINDER);
      expect(typeof result).toBe("boolean");
    });

    it("should handle EmailType.FOLLOW_UP without throwing", () => {
      const result = shouldSkipAttendeeEmailWithSettings(undefined, null, EmailType.FOLLOW_UP);
      expect(typeof result).toBe("boolean");
    });

    it("should handle EmailType.WORKFLOW without throwing", () => {
      const result = shouldSkipAttendeeEmailWithSettings(undefined, null, EmailType.WORKFLOW);
      expect(typeof result).toBe("boolean");
    });

    it("should respect eventTypeMetadata for REMINDER EmailType", () => {
      const metadata = {
        disableStandardEmails: { all: { attendee: true } },
      } as EventTypeMetadata;
      const result = shouldSkipAttendeeEmailWithSettings(metadata, null, EmailType.REMINDER);
      expect(result).toBe(true);
    });

    it("should not skip REMINDER when no disable settings are active", () => {
      const result = shouldSkipAttendeeEmailWithSettings(undefined, null, EmailType.REMINDER);
      expect(result).toBe(false);
    });

    it("should not skip FOLLOW_UP when no disable settings are active", () => {
      const result = shouldSkipAttendeeEmailWithSettings(undefined, null, EmailType.FOLLOW_UP);
      expect(result).toBe(false);
    });

    it("should not skip WORKFLOW when no disable settings are active", () => {
      const result = shouldSkipAttendeeEmailWithSettings(undefined, null, EmailType.WORKFLOW);
      expect(result).toBe(false);
    });
  });
});
