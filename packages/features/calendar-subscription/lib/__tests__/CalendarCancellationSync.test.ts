import { beforeEach, describe, expect, test, vi } from "vitest";

// Mock @sentry/nextjs before any imports that may reference it.
// Exact same pattern as CalendarSubscriptionService.test.ts (lines 5-10).
vi.mock("@sentry/nextjs", () => ({
  metrics: {
    count: vi.fn(),
    distribution: vi.fn(),
  },
}));

// Mock @calcom/prisma — the CalendarCancellationSyncService uses prisma directly
// (not injected via DI) for booking reference lookup.
vi.mock("@calcom/prisma", () => ({
  default: {
    bookingReference: {
      findFirst: vi.fn(),
    },
  },
}));

// Mock handleCancelBooking — the service lazy-imports this via dynamic import.
// vi.mock intercepts dynamic imports as well, so this covers the
// `(await import("@calcom/features/bookings/lib/handleCancelBooking")).default` call.
vi.mock("@calcom/features/bookings/lib/handleCancelBooking", () => ({
  default: vi.fn().mockResolvedValue(undefined),
}));

import { CalendarCancellationSyncService } from "@calcom/features/calendars/lib/cancellation-sync/CalendarCancellationSyncService";
import prisma from "@calcom/prisma";
import { BookingStatus } from "@calcom/prisma/enums";

// Access the mocked handleCancelBooking default export for assertion in tests.
// We use a lazy accessor since vi.mock is hoisted and intercepts dynamic imports.
const getHandleCancelBookingMock = async () => {
  const mod = await import("@calcom/features/bookings/lib/handleCancelBooking");
  return mod.default as ReturnType<typeof vi.fn>;
};

// --------------------------------------------------------------------------
// Mock Data — follows the exact patterns from CalendarSubscriptionService.test.ts
// --------------------------------------------------------------------------

const mockBookingReference = {
  id: 1,
  type: "google_calendar",
  uid: "external-event-uid-123",
  meetingId: null,
  meetingPassword: null,
  meetingUrl: null,
  bookingId: 100,
  externalCalendarId: "test@example.com",
  deleted: null,
  credentialId: null,
  booking: {
    id: 100,
    uid: "cal-booking-uid-abc",
    status: BookingStatus.ACCEPTED,
    userId: 1,
  },
};

const mockCancelledBookingReference = {
  ...mockBookingReference,
  booking: {
    ...mockBookingReference.booking,
    status: BookingStatus.CANCELLED,
  },
};

// biome-ignore lint/correctness/noUnusedVariables: Mock data defined for REJECTED booking edge case — available for extended test scenarios
const mockRejectedBookingReference = {
  ...mockBookingReference,
  booking: {
    ...mockBookingReference.booking,
    status: BookingStatus.REJECTED,
  },
};

// --------------------------------------------------------------------------
// Test Suite
// --------------------------------------------------------------------------

describe("CalendarCancellationSyncService", () => {
  let service: CalendarCancellationSyncService;
  let mockFeatureRepository: {
    checkIfFeatureIsEnabledGlobally: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockFeatureRepository = {
      checkIfFeatureIsEnabledGlobally: vi.fn().mockResolvedValue(true),
    };

    service = new CalendarCancellationSyncService({
      featureRepository: mockFeatureRepository,
    });
  });

  // -----------------------------------------------------------------------
  // Test Block 1: Integration with webhook pipeline
  // -----------------------------------------------------------------------
  describe("integration with webhook pipeline", () => {
    test("should process cancellation when triggered from CalendarSubscriptionService webhook pipeline", async () => {
      // Setup: Feature enabled (default), Prisma returns a valid booking reference
      (prisma.bookingReference.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(
        mockBookingReference
      );

      const result = await service.handleExternalCancellation({
        externalEventUid: "external-event-uid-123",
        provider: "google_calendar",
      });

      // Assert: Success response with correct bookingId
      expect(result).toEqual({
        success: true,
        message: "Booking cancelled",
        bookingId: 100,
      });

      // Assert: Feature flag was checked with the correct slug
      expect(mockFeatureRepository.checkIfFeatureIsEnabledGlobally).toHaveBeenCalledWith(
        "calendar-cancellation-sync"
      );

      // Assert: Prisma bookingReference.findFirst was called with correct where/include
      expect(prisma.bookingReference.findFirst).toHaveBeenCalledWith({
        where: {
          uid: "external-event-uid-123",
          deleted: null,
        },
        include: {
          booking: {
            select: {
              id: true,
              uid: true,
              status: true,
              userId: true,
            },
          },
        },
      });

      // Assert: handleCancelBooking was called to propagate the cancellation
      const handleCancelBooking = await getHandleCancelBookingMock();
      expect(handleCancelBooking).toHaveBeenCalledTimes(1);
    });
  });

  // -----------------------------------------------------------------------
  // Test Block 2: Google push notification flow
  // -----------------------------------------------------------------------
  describe("Google push notification flow", () => {
    test("should handle Google Calendar push notification with cancelled event", async () => {
      (prisma.bookingReference.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(
        mockBookingReference
      );

      const result = await service.handleExternalCancellation({
        externalEventUid: "google-event-uid",
        provider: "google_calendar",
        reason: "Deleted in Google Calendar",
      });

      // Assert: Returns success
      expect(result.success).toBe(true);

      // Assert: handleCancelBooking was called with the cancellation reason from the notification
      const handleCancelBooking = await getHandleCancelBookingMock();
      expect(handleCancelBooking).toHaveBeenCalledWith(
        expect.objectContaining({
          bookingData: expect.objectContaining({
            cancellationReason: "Deleted in Google Calendar",
          }),
          actionSource: "SYSTEM",
        })
      );
    });
  });

  // -----------------------------------------------------------------------
  // Test Block 3: Microsoft Graph change notification flow
  // -----------------------------------------------------------------------
  describe("Microsoft Graph change notification flow", () => {
    test("should handle Microsoft Graph change notification with cancelled event", async () => {
      // Use a booking reference typed as office365_calendar for Outlook scenarios
      const outlookBookingReference = {
        ...mockBookingReference,
        type: "office365_calendar",
      };
      (prisma.bookingReference.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(
        outlookBookingReference
      );

      const result = await service.handleExternalCancellation({
        externalEventUid: "outlook-event-uid",
        provider: "office365_calendar",
        reason: "Declined in Outlook",
      });

      // Assert: Returns success
      expect(result.success).toBe(true);

      // Assert: handleCancelBooking was called with the Outlook cancellation reason
      const handleCancelBooking = await getHandleCancelBookingMock();
      expect(handleCancelBooking).toHaveBeenCalledWith(
        expect.objectContaining({
          bookingData: expect.objectContaining({
            cancellationReason: "Declined in Outlook",
          }),
          actionSource: "SYSTEM",
        })
      );
    });
  });

  // -----------------------------------------------------------------------
  // Test Block 4: Feature flag gating
  // -----------------------------------------------------------------------
  describe("feature flag gating", () => {
    test("should NOT process cancellation when calendar-cancellation-sync flag is disabled", async () => {
      // Setup: Feature flag is disabled
      mockFeatureRepository.checkIfFeatureIsEnabledGlobally.mockResolvedValue(false);

      const result = await service.handleExternalCancellation({
        externalEventUid: "event-uid",
        provider: "google_calendar",
      });

      // Assert: Returns feature-disabled response
      expect(result).toEqual({
        success: false,
        message: "Feature disabled",
      });

      // Assert: Prisma bookingReference.findFirst was NOT called (early return)
      expect(prisma.bookingReference.findFirst).not.toHaveBeenCalled();

      // Assert: handleCancelBooking was NOT called
      const handleCancelBooking = await getHandleCancelBookingMock();
      expect(handleCancelBooking).not.toHaveBeenCalled();
    });

    test("should process cancellation when flag is enabled and emit metrics", async () => {
      // Setup: Feature enabled (default), valid booking reference
      (prisma.bookingReference.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(
        mockBookingReference
      );

      const result = await service.handleExternalCancellation({
        externalEventUid: "external-event-uid-123",
        provider: "google_calendar",
      });

      // Assert: Returns success
      expect(result.success).toBe(true);

      // Assert: Feature flag was checked with the correct slug
      expect(mockFeatureRepository.checkIfFeatureIsEnabledGlobally).toHaveBeenCalledWith(
        "calendar-cancellation-sync"
      );

      // Assert: The static feature slug matches the expected constant
      expect(CalendarCancellationSyncService.CALENDAR_CANCELLATION_SYNC_FEATURE).toBe(
        "calendar-cancellation-sync"
      );
    });
  });

  // -----------------------------------------------------------------------
  // Test Block 5: Booking lookup
  // -----------------------------------------------------------------------
  describe("booking lookup", () => {
    test("should successfully find and cancel booking by external event UID", async () => {
      (prisma.bookingReference.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(
        mockBookingReference
      );

      const result = await service.handleExternalCancellation({
        externalEventUid: "external-event-uid-123",
        provider: "google_calendar",
      });

      // Assert: Prisma bookingReference.findFirst was called with correct query
      expect(prisma.bookingReference.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            uid: "external-event-uid-123",
            deleted: null,
          },
        })
      );

      // Assert: handleCancelBooking was called with the booking ID and UID from the reference
      const handleCancelBooking = await getHandleCancelBookingMock();
      expect(handleCancelBooking).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 1,
          bookingData: expect.objectContaining({
            id: 100,
            uid: "cal-booking-uid-abc",
            skipCancellationReasonValidation: true,
          }),
          actionSource: "SYSTEM",
        })
      );

      // Assert: Returns success with the booking ID
      expect(result).toEqual({
        success: true,
        message: "Booking cancelled",
        bookingId: 100,
      });
    });

    test("should gracefully skip when no matching booking found for external event UID", async () => {
      // Setup: Prisma returns null — no matching booking reference
      (prisma.bookingReference.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const result = await service.handleExternalCancellation({
        externalEventUid: "nonexistent-uid",
        provider: "google_calendar",
      });

      // Assert: Returns not-found response
      expect(result).toEqual({
        success: false,
        message: "No matching booking found",
      });

      // Assert: handleCancelBooking was NOT called
      const handleCancelBooking = await getHandleCancelBookingMock();
      expect(handleCancelBooking).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // Test Block 6: Booking status edge cases
  // -----------------------------------------------------------------------
  describe("booking status edge cases", () => {
    test("should skip already-cancelled booking gracefully", async () => {
      // Setup: Prisma returns a booking reference with CANCELLED status
      (prisma.bookingReference.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(
        mockCancelledBookingReference
      );

      const result = await service.handleExternalCancellation({
        externalEventUid: "external-event-uid-123",
        provider: "google_calendar",
      });

      // Assert: Returns success with already-cancelled message (no error for idempotent behavior)
      expect(result).toEqual({
        success: true,
        message: "Booking already cancelled",
      });

      // Assert: handleCancelBooking was NOT called — no double-cancel
      const handleCancelBooking = await getHandleCancelBookingMock();
      expect(handleCancelBooking).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // Test Block 7: Error handling
  // -----------------------------------------------------------------------
  describe("error handling", () => {
    test("should handle invalid notification payloads — missing externalEventUid", async () => {
      // Validate with empty externalEventUid
      const resultEmptyUid = await service.validateNotificationPayload({
        externalEventUid: "",
        provider: "google_calendar",
      });
      expect(resultEmptyUid).toBe(false);

      // Validate with empty provider
      const resultEmptyProvider = await service.validateNotificationPayload({
        externalEventUid: "valid-uid",
        provider: "",
      });
      expect(resultEmptyProvider).toBe(false);

      // Validate with both present — should return true
      const resultValid = await service.validateNotificationPayload({
        externalEventUid: "valid-uid",
        provider: "google_calendar",
      });
      expect(resultValid).toBe(true);
    });

    test("should handle missing credentials gracefully", async () => {
      // Setup: Prisma returns a booking reference with booking: null (no booking attached)
      const refWithoutBooking = {
        ...mockBookingReference,
        booking: null,
      };
      (prisma.bookingReference.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(
        refWithoutBooking
      );

      const result = await service.handleExternalCancellation({
        externalEventUid: "uid",
        provider: "google_calendar",
      });

      // Assert: Returns not-found response because the booking reference lacks a booking
      expect(result).toEqual({
        success: false,
        message: "No matching booking found",
      });

      // Assert: handleCancelBooking was NOT called
      const handleCancelBooking = await getHandleCancelBookingMock();
      expect(handleCancelBooking).not.toHaveBeenCalled();
    });
  });
});
