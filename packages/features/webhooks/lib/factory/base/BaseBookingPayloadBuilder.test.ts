import { describe, it, expect, vi } from "vitest";
import { BookingStatus, WebhookTriggerEvents } from "@calcom/prisma/enums";
import type { CalendarEvent } from "@calcom/types/Calendar";

import type { BookingWebhookEventDTO, EventTypeInfo } from "../../dto/types";
import { BookingPayloadBuilder } from "../versioned/v2021-10-20/BookingPayloadBuilder";

vi.mock("@calcom/lib/dayjs", () => ({
  getUTCOffsetByTimezone: vi.fn(() => 0),
}));

describe("BookingPayloadBuilder (v2021-10-20)", () => {
  const mockEventType: EventTypeInfo = {
    eventTitle: "Test Event",
    eventDescription: "Test Description",
    requiresConfirmation: false,
    price: 0,
    currency: "USD",
    length: 30,
  };

  const mockCalendarEvent: CalendarEvent = {
    type: "test-event",
    title: "Test Meeting",
    description: "Meeting description",
    additionalNotes: "Additional notes",
    startTime: "2024-01-15T10:00:00Z",
    endTime: "2024-01-15T10:30:00Z",
    organizer: {
      id: 1,
      email: "organizer@test.com",
      name: "Test Organizer",
      timeZone: "UTC",
      language: { locale: "en" },
    },
    attendees: [
      {
        email: "attendee@test.com",
        name: "Test Attendee",
        timeZone: "UTC",
        language: { locale: "en" },
      },
    ],
    location: "https://cal.com/video/123",
    uid: "booking-uid-123",
    customInputs: {},
    responses: {},
    userFieldsResponses: {},
  };

  const createMockDTO = (
    triggerEvent: WebhookTriggerEvents,
    extra: Partial<BookingWebhookEventDTO> = {}
  ): BookingWebhookEventDTO => ({
    triggerEvent,
    createdAt: "2024-01-15T10:00:00Z",
    booking: {
      id: 1,
      eventTypeId: 1,
      userId: 1,
      smsReminderNumber: null,
    },
    eventType: mockEventType,
    evt: mockCalendarEvent,
    ...extra,
  });

  const builder = new BookingPayloadBuilder();

  describe("BOOKING_CREATED", () => {
    it("should build payload with ACCEPTED status", () => {
      const dto = createMockDTO(WebhookTriggerEvents.BOOKING_CREATED);
      const payload = builder.build(dto);

      expect(payload.triggerEvent).toBe(WebhookTriggerEvents.BOOKING_CREATED);
      expect(payload.payload.status).toBe(BookingStatus.ACCEPTED);
      expect(payload.payload.bookingId).toBe(1);
      expect(payload.payload.title).toBe("Test Meeting");
      expect(payload.payload.organizer.email).toBe("organizer@test.com");
      expect(payload.payload.attendees).toHaveLength(1);
    });

    it("should include eventType fields", () => {
      const dto = createMockDTO(WebhookTriggerEvents.BOOKING_CREATED);
      const payload = builder.build(dto);

      expect(payload.payload.eventTitle).toBe("Test Event");
      expect(payload.payload.eventDescription).toBe("Test Description");
      expect(payload.payload.price).toBe(0);
      expect(payload.payload.currency).toBe("USD");
      expect(payload.payload.length).toBe(30);
    });
  });

  describe("BOOKING_CANCELLED", () => {
    it("should build payload with CANCELLED status and extra fields", () => {
      const dto = createMockDTO(WebhookTriggerEvents.BOOKING_CANCELLED, {
        cancelledBy: "user@test.com",
        cancellationReason: "Schedule conflict",
      });
      const payload = builder.build(dto);

      expect(payload.triggerEvent).toBe(WebhookTriggerEvents.BOOKING_CANCELLED);
      expect(payload.payload.status).toBe(BookingStatus.CANCELLED);
      expect(payload.payload.cancelledBy).toBe("user@test.com");
      expect(payload.payload.cancellationReason).toBe("Schedule conflict");
    });
  });

  describe("BOOKING_REQUESTED", () => {
    it("should build payload with PENDING status", () => {
      const dto = createMockDTO(WebhookTriggerEvents.BOOKING_REQUESTED);
      const payload = builder.build(dto);

      expect(payload.triggerEvent).toBe(WebhookTriggerEvents.BOOKING_REQUESTED);
      expect(payload.payload.status).toBe(BookingStatus.PENDING);
    });
  });

  describe("BOOKING_REJECTED", () => {
    it("should build payload with REJECTED status", () => {
      const dto = createMockDTO(WebhookTriggerEvents.BOOKING_REJECTED);
      const payload = builder.build(dto);

      expect(payload.triggerEvent).toBe(WebhookTriggerEvents.BOOKING_REJECTED);
      expect(payload.payload.status).toBe(BookingStatus.REJECTED);
    });
  });

  describe("BOOKING_RESCHEDULED", () => {
    it("should build payload with reschedule extra fields", () => {
      const dto = createMockDTO(WebhookTriggerEvents.BOOKING_RESCHEDULED, {
        rescheduleId: 2,
        rescheduleUid: "reschedule-uid-456",
        rescheduleStartTime: "2024-01-16T10:00:00Z",
        rescheduleEndTime: "2024-01-16T10:30:00Z",
        rescheduledBy: "user@test.com",
      });
      const payload = builder.build(dto);

      expect(payload.triggerEvent).toBe(WebhookTriggerEvents.BOOKING_RESCHEDULED);
      expect(payload.payload.status).toBe(BookingStatus.ACCEPTED);
      expect(payload.payload.rescheduleId).toBe(2);
      expect(payload.payload.rescheduleUid).toBe("reschedule-uid-456");
      expect(payload.payload.rescheduledBy).toBe("user@test.com");
    });
  });

  describe("BOOKING_PAID", () => {
    it("should build payload with payment extra fields", () => {
      const dto = createMockDTO(WebhookTriggerEvents.BOOKING_PAID, {
        paymentId: 123,
        paymentData: { stripeId: "stripe_123" },
      });
      const payload = builder.build(dto);

      expect(payload.triggerEvent).toBe(WebhookTriggerEvents.BOOKING_PAID);
      expect(payload.payload.paymentId).toBe(123);
      expect(payload.payload.paymentData).toEqual({ stripeId: "stripe_123" });
    });
  });

  describe("BOOKING_PAYMENT_INITIATED", () => {
    it("should build payload with payment extra fields", () => {
      const dto = createMockDTO(WebhookTriggerEvents.BOOKING_PAYMENT_INITIATED, {
        paymentId: 456,
        paymentData: { status: "pending" },
      });
      const payload = builder.build(dto);

      expect(payload.triggerEvent).toBe(WebhookTriggerEvents.BOOKING_PAYMENT_INITIATED);
      expect(payload.payload.paymentId).toBe(456);
    });
  });

  describe("BOOKING_NO_SHOW_UPDATED", () => {
    it("should build no-show specific payload", () => {
      const dto: BookingWebhookEventDTO = {
        triggerEvent: WebhookTriggerEvents.BOOKING_NO_SHOW_UPDATED,
        createdAt: "2024-01-15T10:00:00Z",
        bookingUid: "booking-uid-123",
        bookingId: 1,
        attendees: [{ email: "attendee@test.com", noShow: true }],
        message: "Attendee marked as no-show",
      } as BookingWebhookEventDTO;

      const payload = builder.build(dto);

      expect(payload.triggerEvent).toBe(WebhookTriggerEvents.BOOKING_NO_SHOW_UPDATED);
      expect(payload.payload.bookingUid).toBe("booking-uid-123");
      expect(payload.payload.bookingId).toBe(1);
      expect(payload.payload.message).toBe("Attendee marked as no-show");
    });
  });

  describe("attendee UTC offset", () => {
    it("should add utcOffset to each attendee", () => {
      const dto = createMockDTO(WebhookTriggerEvents.BOOKING_CREATED);
      const payload = builder.build(dto);

      expect(payload.payload.attendees[0]).toHaveProperty("utcOffset");
    });
  });

  describe("organizer UTC offset", () => {
    it("should add utcOffset to organizer", () => {
      const dto = createMockDTO(WebhookTriggerEvents.BOOKING_CREATED);
      const payload = builder.build(dto);

      expect(payload.payload.organizer).toHaveProperty("utcOffset");
    });
  });
});

describe("Calendly Event Mapping Regression Tests", () => {
  // Self-contained fixtures duplicated from the main describe block for test isolation
  const mockEventType: EventTypeInfo = {
    eventTitle: "Test Event",
    eventDescription: "Test Description",
    requiresConfirmation: false,
    price: 0,
    currency: "USD",
    length: 30,
  };

  const mockCalendarEvent: CalendarEvent = {
    type: "test-event",
    title: "Test Meeting",
    description: "Meeting description",
    additionalNotes: "Additional notes",
    startTime: "2024-01-15T10:00:00Z",
    endTime: "2024-01-15T10:30:00Z",
    organizer: {
      id: 1,
      email: "organizer@test.com",
      name: "Test Organizer",
      timeZone: "UTC",
      language: { locale: "en" },
    },
    attendees: [
      {
        email: "attendee@test.com",
        name: "Test Attendee",
        timeZone: "UTC",
        language: { locale: "en" },
      },
    ],
    location: "https://cal.com/video/123",
    uid: "booking-uid-123",
    customInputs: {},
    responses: {},
    userFieldsResponses: {},
  };

  const createMockDTO = (
    triggerEvent: WebhookTriggerEvents,
    extra: Partial<BookingWebhookEventDTO> = {}
  ): BookingWebhookEventDTO => ({
    triggerEvent,
    createdAt: "2024-01-15T10:00:00Z",
    booking: {
      id: 1,
      eventTypeId: 1,
      userId: 1,
      smsReminderNumber: null,
    },
    eventType: mockEventType,
    evt: mockCalendarEvent,
    ...extra,
  });

  const builder = new BookingPayloadBuilder();

  it("should include UTM params in BOOKING_CREATED payload when provided (WH-001)", () => {
    const dto = createMockDTO(WebhookTriggerEvents.BOOKING_CREATED, {
      utmParams: {
        utmSource: "google",
        utmMedium: "cpc",
        utmCampaign: "calendly-parity",
      },
    });
    const payload = builder.build(dto);

    expect(payload.triggerEvent).toBe(WebhookTriggerEvents.BOOKING_CREATED);
    expect(payload.payload.utmParams).toBeDefined();
    expect(payload.payload.utmParams).toEqual({
      utmSource: "google",
      utmMedium: "cpc",
      utmCampaign: "calendly-parity",
    });
  });

  it("should include invitee and event URIs in BOOKING_CREATED payload when provided (WH-001)", () => {
    const dto = createMockDTO(WebhookTriggerEvents.BOOKING_CREATED, {
      inviteeUri: "https://api.cal.com/v2/invitees/abc123",
      eventUri: "https://api.cal.com/v2/events/def456",
      schedulingUrl: "https://cal.com/user/30min",
    });
    const payload = builder.build(dto);

    expect(payload.triggerEvent).toBe(WebhookTriggerEvents.BOOKING_CREATED);
    expect(payload.payload.inviteeUri).toBe("https://api.cal.com/v2/invitees/abc123");
    expect(payload.payload.eventUri).toBe("https://api.cal.com/v2/events/def456");
    expect(payload.payload.schedulingUrl).toBe("https://cal.com/user/30min");
  });

  it("should include cancellation metadata in BOOKING_CANCELLED payload when provided (WH-002)", () => {
    const dto = createMockDTO(WebhookTriggerEvents.BOOKING_CANCELLED, {
      cancelledBy: "user@test.com",
      cancellationReason: "Schedule conflict",
      rescheduleUri: "https://cal.com/reschedule/abc",
      cancellationTimestamp: "2024-01-15T11:00:00Z",
    });
    const payload = builder.build(dto);

    expect(payload.triggerEvent).toBe(WebhookTriggerEvents.BOOKING_CANCELLED);
    expect(payload.payload.rescheduleUri).toBe("https://cal.com/reschedule/abc");
    expect(payload.payload.cancellationTimestamp).toBe("2024-01-15T11:00:00Z");
    // Existing cancellation fields still present
    expect(payload.payload.cancelledBy).toBe("user@test.com");
    expect(payload.payload.cancellationReason).toBe("Schedule conflict");
  });

  it("should include old and new invitee URIs in BOOKING_RESCHEDULED payload when provided (WH-001)", () => {
    const dto = createMockDTO(WebhookTriggerEvents.BOOKING_RESCHEDULED, {
      rescheduleId: 2,
      rescheduleUid: "reschedule-uid-456",
      rescheduleStartTime: "2024-01-16T10:00:00Z",
      rescheduleEndTime: "2024-01-16T10:30:00Z",
      rescheduledBy: "user@test.com",
      oldInviteeUri: "https://api.cal.com/v2/invitees/old-abc",
      newInviteeUri: "https://api.cal.com/v2/invitees/new-def",
    });
    const payload = builder.build(dto);

    expect(payload.triggerEvent).toBe(WebhookTriggerEvents.BOOKING_RESCHEDULED);
    expect(payload.payload.oldInviteeUri).toBe("https://api.cal.com/v2/invitees/old-abc");
    expect(payload.payload.newInviteeUri).toBe("https://api.cal.com/v2/invitees/new-def");
    // Existing reschedule fields still present
    expect(payload.payload.rescheduleId).toBe(2);
    expect(payload.payload.rescheduleUid).toBe("reschedule-uid-456");
    expect(payload.payload.rescheduledBy).toBe("user@test.com");
  });

  it("should NOT include Calendly parity fields when not provided in DTO (WH-004 backward compatibility)", () => {
    const dto = createMockDTO(WebhookTriggerEvents.BOOKING_CREATED);
    const payload = builder.build(dto);

    expect(payload.payload.utmParams).toBeUndefined();
    expect(payload.payload.inviteeUri).toBeUndefined();
    expect(payload.payload.eventUri).toBeUndefined();
    expect(payload.payload.schedulingUrl).toBeUndefined();
    expect(payload.payload.rescheduleUri).toBeUndefined();
    expect(payload.payload.cancellationTimestamp).toBeUndefined();
    expect(payload.payload.oldInviteeUri).toBeUndefined();
    expect(payload.payload.newInviteeUri).toBeUndefined();
  });

  it("should preserve all existing v2021-10-20 payload fields (WH-005 regression guard)", () => {
    const dto = createMockDTO(WebhookTriggerEvents.BOOKING_CREATED);
    const payload = builder.build(dto);

    // Core booking fields
    expect(payload.payload.bookingId).toBe(1);
    expect(payload.payload.title).toBe("Test Meeting");
    expect(payload.payload.status).toBe(BookingStatus.ACCEPTED);
    expect(payload.payload.uid).toBe("booking-uid-123");

    // Organizer fields
    expect(payload.payload.organizer).toBeDefined();
    expect(payload.payload.organizer.email).toBe("organizer@test.com");
    expect(payload.payload.organizer.name).toBe("Test Organizer");
    expect(payload.payload.organizer).toHaveProperty("utcOffset");

    // Attendees fields
    expect(payload.payload.attendees).toHaveLength(1);
    expect(payload.payload.attendees[0].email).toBe("attendee@test.com");
    expect(payload.payload.attendees[0]).toHaveProperty("utcOffset");

    // Event type fields
    expect(payload.payload.eventTitle).toBe("Test Event");
    expect(payload.payload.eventDescription).toBe("Test Description");
    expect(payload.payload.price).toBe(0);
    expect(payload.payload.currency).toBe("USD");
    expect(payload.payload.length).toBe(30);

    // Location and metadata
    expect(payload.payload.location).toBe("https://cal.com/video/123");

    // Trigger event metadata
    expect(payload.triggerEvent).toBe(WebhookTriggerEvents.BOOKING_CREATED);
    expect(payload.createdAt).toBe("2024-01-15T10:00:00Z");
  });
});
