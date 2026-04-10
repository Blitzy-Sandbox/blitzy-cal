import { describe, it, expect, vi } from "vitest";
import { BookingStatus, WebhookTriggerEvents } from "@calcom/prisma/enums";
import type { CalendarEvent } from "@calcom/types/Calendar";

import type {
  BookingWebhookEventDTO,
  EventPayloadType,
  EventTypeInfo,
} from "../../../dto/types";
import { BookingPayloadBuilder } from "./BookingPayloadBuilder";
import type { V20250101BookingEventPayload } from "./types";

vi.mock("@calcom/lib/dayjs", () => ({
  getUTCOffsetByTimezone: vi.fn(() => 0),
}));

describe("v2025-01-01/BookingPayloadBuilder", () => {
  const builder = new BookingPayloadBuilder();

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

  it("should be instance of BookingPayloadBuilder", () => {
    expect(builder).toBeInstanceOf(BookingPayloadBuilder);
  });

  it("should correctly build BOOKING_CREATED payload", () => {
    const dto = createMockDTO(WebhookTriggerEvents.BOOKING_CREATED);
    const payload = builder.build(dto);

    expect(payload.triggerEvent).toBe(WebhookTriggerEvents.BOOKING_CREATED);
    expect(payload.payload.status).toBe(BookingStatus.ACCEPTED);
    expect(payload.payload.bookingId).toBe(1);
    expect(payload.payload.title).toBe("Test Meeting");
  });

  it("should correctly build BOOKING_CANCELLED payload", () => {
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

  it("should correctly build BOOKING_REQUESTED payload", () => {
    const dto = createMockDTO(WebhookTriggerEvents.BOOKING_REQUESTED, {
      metadata: { source: "calendly-import" },
    });
    const payload = builder.build(dto);

    expect(payload.triggerEvent).toBe(WebhookTriggerEvents.BOOKING_REQUESTED);
    expect(payload.payload.status).toBe(BookingStatus.PENDING);
    expect(payload.payload.metadata).toEqual({ source: "calendly-import" });
  });

  it("should correctly build BOOKING_REJECTED payload", () => {
    const dto = createMockDTO(WebhookTriggerEvents.BOOKING_REJECTED);
    const payload = builder.build(dto);

    expect(payload.triggerEvent).toBe(WebhookTriggerEvents.BOOKING_REJECTED);
    expect(payload.payload.status).toBe(BookingStatus.REJECTED);
  });

  it("should correctly build BOOKING_RESCHEDULED payload", () => {
    const dto = createMockDTO(WebhookTriggerEvents.BOOKING_RESCHEDULED, {
      rescheduleId: 42,
      rescheduleUid: "reschedule-uid-42",
      rescheduleStartTime: "2024-01-16T10:00:00Z",
      rescheduleEndTime: "2024-01-16T10:30:00Z",
      rescheduledBy: "user@test.com",
    });
    const payload = builder.build(dto);

    expect(payload.triggerEvent).toBe(WebhookTriggerEvents.BOOKING_RESCHEDULED);
    expect(payload.payload.status).toBe(BookingStatus.ACCEPTED);
    expect(payload.payload.rescheduleId).toBe(42);
    expect(payload.payload.rescheduleUid).toBe("reschedule-uid-42");
    expect(payload.payload.rescheduledBy).toBe("user@test.com");
  });

  it("should correctly build BOOKING_RESCHEDULED_BY_ATTENDEE payload", () => {
    const dto = createMockDTO(WebhookTriggerEvents.BOOKING_RESCHEDULED_BY_ATTENDEE, {
      rescheduleId: 55,
      rescheduleUid: "attendee-reschedule-uid-55",
      rescheduledBy: "attendee@test.com",
    });
    const payload = builder.build(dto);

    expect(payload.triggerEvent).toBe(WebhookTriggerEvents.BOOKING_RESCHEDULED_BY_ATTENDEE);
    expect(payload.payload.status).toBe(BookingStatus.ACCEPTED);
    expect(payload.payload.rescheduleId).toBe(55);
    expect(payload.payload.rescheduledBy).toBe("attendee@test.com");
  });

  it("should correctly build BOOKING_PAID payload", () => {
    const dto = createMockDTO(WebhookTriggerEvents.BOOKING_PAID, {
      paymentId: 100,
      paymentData: { method: "stripe", amount: 2500 },
    });
    const payload = builder.build(dto);

    expect(payload.triggerEvent).toBe(WebhookTriggerEvents.BOOKING_PAID);
    expect(payload.payload.status).toBe(BookingStatus.ACCEPTED);
    expect(payload.payload.paymentId).toBe(100);
  });

  it("should correctly build BOOKING_PAYMENT_INITIATED payload", () => {
    const dto = createMockDTO(WebhookTriggerEvents.BOOKING_PAYMENT_INITIATED, {
      paymentId: 200,
    });
    const payload = builder.build(dto);

    expect(payload.triggerEvent).toBe(WebhookTriggerEvents.BOOKING_PAYMENT_INITIATED);
    expect(payload.payload.paymentId).toBe(200);
  });

  it("should correctly build BOOKING_NO_SHOW_UPDATED payload", () => {
    const dto: BookingWebhookEventDTO = {
      triggerEvent: WebhookTriggerEvents.BOOKING_NO_SHOW_UPDATED,
      createdAt: "2024-01-15T10:00:00Z",
      bookingUid: "booking-uid-123",
      bookingId: 1,
      attendees: [{ email: "attendee@test.com", noShow: true }],
      message: "No-show recorded",
    } as BookingWebhookEventDTO;

    const payload = builder.build(dto);

    expect(payload.triggerEvent).toBe(WebhookTriggerEvents.BOOKING_NO_SHOW_UPDATED);
    expect(payload.payload.bookingUid).toBe("booking-uid-123");
    expect(payload.payload.bookingId).toBe(1);
    expect(payload.payload.message).toBe("No-show recorded");
  });

  it("should handle all booking trigger events without throwing", () => {
    const triggers = [
      WebhookTriggerEvents.BOOKING_CREATED,
      WebhookTriggerEvents.BOOKING_CANCELLED,
      WebhookTriggerEvents.BOOKING_REQUESTED,
      WebhookTriggerEvents.BOOKING_RESCHEDULED,
      WebhookTriggerEvents.BOOKING_RESCHEDULED_BY_ATTENDEE,
      WebhookTriggerEvents.BOOKING_REJECTED,
      WebhookTriggerEvents.BOOKING_PAID,
      WebhookTriggerEvents.BOOKING_PAYMENT_INITIATED,
      WebhookTriggerEvents.BOOKING_NO_SHOW_UPDATED,
    ];

    triggers.forEach((trigger) => {
      let dto: BookingWebhookEventDTO;

      if (trigger === WebhookTriggerEvents.BOOKING_NO_SHOW_UPDATED) {
        dto = {
          triggerEvent: trigger,
          createdAt: "2024-01-15T10:00:00Z",
          bookingUid: "booking-uid-123",
          bookingId: 1,
          attendees: [{ email: "attendee@test.com", noShow: true }],
          message: "No-show",
        } as BookingWebhookEventDTO;
      } else {
        dto = createMockDTO(trigger);
      }

      const payload = builder.build(dto);
      expect(payload.triggerEvent).toBe(trigger);
      expect(payload.payload).toBeDefined();
    });
  });

  it("should never throw on missing optional fields", () => {
    const minimalDTO: BookingWebhookEventDTO = {
      triggerEvent: WebhookTriggerEvents.BOOKING_CREATED,
      createdAt: "2024-01-15T10:00:00Z",
      booking: {
        id: 1,
        eventTypeId: 1,
        userId: 1,
        smsReminderNumber: null,
      },
      eventType: mockEventType,
      evt: {
        ...mockCalendarEvent,
        organizer: null,
        attendees: [],
      },
    };

    expect(() => builder.build(minimalDTO)).not.toThrow();
  });

  describe("Calendly parity fields enrichment (WH-001, WH-002, WH-004)", () => {
    it("should populate utmParams when present on DTO", () => {
      const utmParams = {
        utmSource: "google",
        utmMedium: "cpc",
        utmCampaign: "summer-2024",
      };
      const dto = createMockDTO(WebhookTriggerEvents.BOOKING_CREATED, {
        utmParams,
      } as unknown as Partial<BookingWebhookEventDTO>);

      const payload = builder.build(dto);
      const p = payload.payload as V20250101BookingEventPayload;

      expect(p.utmParams).toEqual(utmParams);
    });

    it("should populate inviteeUri and eventUri when present on DTO", () => {
      const dto = createMockDTO(WebhookTriggerEvents.BOOKING_CREATED, {
        inviteeUri: "https://api.calendly.com/scheduled_events/abc/invitees/123",
        eventUri: "https://api.calendly.com/scheduled_events/abc",
      } as unknown as Partial<BookingWebhookEventDTO>);

      const payload = builder.build(dto);
      const p = payload.payload as V20250101BookingEventPayload;

      expect(p.inviteeUri).toBe("https://api.calendly.com/scheduled_events/abc/invitees/123");
      expect(p.eventUri).toBe("https://api.calendly.com/scheduled_events/abc");
    });

    it("should populate schedulingUrl when present on DTO", () => {
      const dto = createMockDTO(WebhookTriggerEvents.BOOKING_CREATED, {
        schedulingUrl: "https://cal.com/user/30min",
      } as unknown as Partial<BookingWebhookEventDTO>);

      const payload = builder.build(dto);
      const p = payload.payload as V20250101BookingEventPayload;

      expect(p.schedulingUrl).toBe("https://cal.com/user/30min");
    });

    it("should populate cancellation fields for BOOKING_CANCELLED", () => {
      const dto = createMockDTO(WebhookTriggerEvents.BOOKING_CANCELLED, {
        cancelledBy: "user@test.com",
        cancellationReason: "No longer needed",
        cancellationTimestamp: "2024-01-15T12:00:00Z",
        rescheduleUri: "https://api.calendly.com/scheduled_events/abc/invitees/456",
      } as unknown as Partial<BookingWebhookEventDTO>);

      const payload = builder.build(dto);
      const p = payload.payload as V20250101BookingEventPayload;

      expect(p.cancellationTimestamp).toBe("2024-01-15T12:00:00Z");
      expect(p.rescheduleUri).toBe("https://api.calendly.com/scheduled_events/abc/invitees/456");
    });

    it("should populate old/new invitee URIs for BOOKING_RESCHEDULED", () => {
      const dto = createMockDTO(WebhookTriggerEvents.BOOKING_RESCHEDULED, {
        rescheduleId: 10,
        rescheduleUid: "reschedule-uid",
        oldInviteeUri: "https://api.calendly.com/invitees/old-123",
        newInviteeUri: "https://api.calendly.com/invitees/new-456",
      } as unknown as Partial<BookingWebhookEventDTO>);

      const payload = builder.build(dto);
      const p = payload.payload as V20250101BookingEventPayload;

      expect(p.oldInviteeUri).toBe("https://api.calendly.com/invitees/old-123");
      expect(p.newInviteeUri).toBe("https://api.calendly.com/invitees/new-456");
    });

    it("should NOT include Calendly parity fields when absent from DTO", () => {
      const dto = createMockDTO(WebhookTriggerEvents.BOOKING_CREATED);
      const payload = builder.build(dto);
      const p = payload.payload as V20250101BookingEventPayload;

      expect(p.utmParams).toBeUndefined();
      expect(p.inviteeUri).toBeUndefined();
      expect(p.eventUri).toBeUndefined();
      expect(p.schedulingUrl).toBeUndefined();
      expect(p.rescheduleUri).toBeUndefined();
      expect(p.cancellationTimestamp).toBeUndefined();
      expect(p.oldInviteeUri).toBeUndefined();
      expect(p.newInviteeUri).toBeUndefined();
    });

    it("should populate all 8 Calendly parity fields simultaneously", () => {
      const dto = createMockDTO(WebhookTriggerEvents.BOOKING_RESCHEDULED, {
        rescheduleId: 10,
        rescheduleUid: "reschedule-uid",
        utmParams: { utmSource: "test" },
        inviteeUri: "https://invitee/123",
        eventUri: "https://event/456",
        schedulingUrl: "https://cal.com/user/30min",
        rescheduleUri: "https://reschedule/789",
        cancellationTimestamp: "2024-01-15T12:00:00Z",
        oldInviteeUri: "https://old-invitee/111",
        newInviteeUri: "https://new-invitee/222",
      } as unknown as Partial<BookingWebhookEventDTO>);

      const payload = builder.build(dto);
      const p = payload.payload as V20250101BookingEventPayload;

      expect(p.utmParams).toEqual({ utmSource: "test" });
      expect(p.inviteeUri).toBe("https://invitee/123");
      expect(p.eventUri).toBe("https://event/456");
      expect(p.schedulingUrl).toBe("https://cal.com/user/30min");
      expect(p.rescheduleUri).toBe("https://reschedule/789");
      expect(p.cancellationTimestamp).toBe("2024-01-15T12:00:00Z");
      expect(p.oldInviteeUri).toBe("https://old-invitee/111");
      expect(p.newInviteeUri).toBe("https://new-invitee/222");
    });
  });

  describe("Legacy payload shape compatibility (v2025-01-01)", () => {
    it("normalizes response labels to your_name and email_address for BOOKING_REQUESTED", () => {
      const dto = createMockDTO(WebhookTriggerEvents.BOOKING_REQUESTED, {
        evt: {
          ...mockCalendarEvent,
          responses: {
            name: { value: "Test Testson", label: "name" },
            email: { value: "test@example.com", label: "email" },
          },
          userFieldsResponses: {},
        },
      });
      const result = builder.build(dto);
      const p = result.payload as EventPayloadType;

      expect(p.responses?.name?.label).toBe("your_name");
      expect(p.responses?.name?.value).toBe("Test Testson");
      expect(p.responses?.email?.label).toBe("email_address");
    });

    it("derives firstName and lastName from attendee name", () => {
      const dto = createMockDTO(WebhookTriggerEvents.BOOKING_CREATED, {
        evt: {
          ...mockCalendarEvent,
          attendees: [
            {
              email: "attendee@test.com",
              name: "Jane Doe",
              timeZone: "America/New_York",
              language: { locale: "en" },
            },
          ],
        },
      });

      const result = builder.build(dto);
      const p = result.payload as EventPayloadType;
      const attendee = p.attendees?.[0] as Record<string, unknown>;

      expect(attendee?.firstName).toBe("Jane");
      expect(attendee?.lastName).toBe("Doe");
    });

    it("preserves assignmentReason from booking in legacy format", () => {
      const assignmentReason = [
        { reasonEnum: "ROUND_ROBIN", reasonString: "Next in rotation" },
      ];
      const dto = createMockDTO(WebhookTriggerEvents.BOOKING_CREATED, {
        booking: {
          id: 1,
          eventTypeId: 1,
          userId: 1,
          smsReminderNumber: null,
          assignmentReason,
        },
      });

      const result = builder.build(dto);
      const p = result.payload as V20250101BookingEventPayload;

      expect(p.assignmentReason).toEqual(assignmentReason);
    });

    it("includes event type metadata fields in payload", () => {
      const dto = createMockDTO(WebhookTriggerEvents.BOOKING_CREATED);
      const result = builder.build(dto);
      const p = result.payload as EventPayloadType;

      expect(p.eventTitle).toBe("Test Event");
      expect(p.eventDescription).toBe("Test Description");
      expect(p.requiresConfirmation).toBe(false);
      expect(p.price).toBe(0);
      expect(p.currency).toBe("USD");
      expect(p.length).toBe(30);
    });
  });
});
