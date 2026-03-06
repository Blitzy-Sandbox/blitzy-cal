/**
 * CI-002 Gap Closure: Buffer Time Calendar Visualization Tests
 *
 * Tests the BufferTimeEventService which optionally creates separate calendar events
 * for pre-event and post-event buffer time periods alongside booking events. Verifies:
 *
 *  - Phase 1: Feature flag gating (calendar-buffer-sync global flag)
 *  - Phase 2: Per-EventType syncBuffersToCalendar toggle (false/null/undefined/true)
 *  - Phase 3: Buffer event creation lifecycle (before + after, only before, neither)
 *  - Phase 4: Buffer event title pattern ("Buffer: [Event Title]")
 *  - Phase 5: Buffer event deletion on booking cancellation
 *  - Phase 6: Edge cases (missing destination calendar, missing eventType)
 *
 * Both gates (feature flag + EventType toggle) must be enabled for buffer events to be created.
 * Deletion is best-effort — individual failures do not block other deletions.
 *
 * @see BufferTimeEventService — ../buffer-sync/BufferTimeEventService.ts
 * @see CalendarEventBuilder.buildBufferEvent — @calcom/features/CalendarEventBuilder
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CalendarEvent, NewCalendarEventType } from "@calcom/types/Calendar";
import type { CredentialForCalendarService } from "@calcom/types/Credential";
import type { EventResult } from "@calcom/types/EventManager";

// ─── Hoisted Mock Declarations ──────────────────────────────────────────────────
// vi.hoisted() creates values in the hoisted scope, making them available when
// vi.mock() factory functions execute (both are hoisted before any other code).

const {
  mockCreateEvent,
  mockDeleteEvent,
  mockBuildBufferEvent,
  mockCheckIfFeatureIsEnabledGlobally,
  mockPrismaBookingReference,
} = vi.hoisted(() => ({
  mockCreateEvent: vi.fn(),
  mockDeleteEvent: vi.fn(),
  mockBuildBufferEvent: vi.fn(),
  mockCheckIfFeatureIsEnabledGlobally: vi.fn(),
  mockPrismaBookingReference: {
    create: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock("@calcom/features/calendars/lib/CalendarManager", () => ({
  createEvent: mockCreateEvent,
  deleteEvent: mockDeleteEvent,
}));

vi.mock("@calcom/features/CalendarEventBuilder", () => ({
  CalendarEventBuilder: {
    buildBufferEvent: mockBuildBufferEvent,
  },
}));

// Use a class mock so that `new FeaturesRepository(prisma)` works correctly
// — vi.fn().mockImplementation() does not support the `new` operator properly.
vi.mock("@calcom/features/flags/features.repository", () => ({
  FeaturesRepository: class {
    checkIfFeatureIsEnabledGlobally = mockCheckIfFeatureIsEnabledGlobally;
  },
}));

vi.mock("@calcom/prisma", () => ({
  default: {
    bookingReference: mockPrismaBookingReference,
  },
}));

vi.mock("@calcom/lib/logger", () => ({
  default: {
    getSubLogger: () => ({
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  },
}));

// ─── Module Under Test (imported AFTER mocks) ───────────────────────────────────
import { BufferTimeEventService } from "../buffer-sync/BufferTimeEventService";

// ─── Helper Functions ───────────────────────────────────────────────────────────

/**
 * Builds a mock CredentialForCalendarService matching the pattern used
 * in CalendarManager.test.ts — minimal but type-compatible credential object.
 */
function buildCredential(
  overrides: Partial<{ id: number; type: string }> = {}
): CredentialForCalendarService {
  return {
    id: overrides.id ?? 1,
    type: overrides.type ?? "google_calendar",
    appId: "google-calendar",
    delegatedToId: null,
    user: { email: "organizer@example.com" },
    teamId: null,
    invalid: false,
    key: { access_token: "mock-token" },
    userId: 10000,
    delegatedTo: {
      serviceAccountKey: {
        client_email: "mock@sa.com",
        tenant_id: "mock-tenant",
        client_id: "mock-client",
        private_key: "mock-key",
      },
    },
  } as CredentialForCalendarService;
}

/**
 * Builds a minimal CalendarEvent for use in buffer event tests.
 * Uses string-based startTime/endTime consistent with the CalendarEvent interface.
 */
function buildCalendarEvent(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    type: "test-event",
    title: "Team Meeting",
    startTime: "2024-01-15T10:00:00Z",
    endTime: "2024-01-15T11:00:00Z",
    organizer: {
      name: "Organizer",
      email: "organizer@example.com",
      timeZone: "UTC",
      language: { translate: (x: string) => x, locale: "en" },
    },
    attendees: [
      {
        name: "Attendee",
        email: "attendee@example.com",
        timeZone: "UTC",
        language: { translate: (x: string) => x, locale: "en" },
      },
    ],
    destinationCalendar: null,
    hideOrganizerEmail: false,
    location: null,
    uid: "booking-uid-456",
    ...overrides,
  } as CalendarEvent;
}

/**
 * Builds a mock booking object compatible with BufferTimeEventService.createBufferEvents.
 * Mirrors the BookingForCalEventBuilder shape with eventType buffer configuration.
 */
function buildMockBooking(overrides: Record<string, unknown> = {}) {
  return {
    id: 123,
    uid: "booking-uid-456",
    title: "Team Meeting",
    startTime: new Date("2024-01-15T10:00:00Z"),
    endTime: new Date("2024-01-15T11:00:00Z"),
    eventType: {
      id: 1,
      slug: "team-meeting",
      beforeEventBuffer: 15,
      afterEventBuffer: 10,
      syncBuffersToCalendar: true,
    },
    ...overrides,
  };
}

/**
 * Builds a successful EventResult<NewCalendarEventType> for createEvent mock returns.
 * Matches the shape returned by CalendarManager.createEvent on success.
 */
function buildSuccessfulEventResult(
  uid: string = "buffer-uid-123"
): EventResult<NewCalendarEventType> {
  return {
    appName: "google-calendar",
    type: "google_calendar",
    success: true,
    uid,
    iCalUID: `${uid}@google.com`,
    createdEvent: {
      uid,
      id: `event-${uid}`,
      type: "google_calendar",
      password: "",
      url: "",
      additionalInfo: {},
      iCalUID: `${uid}@google.com`,
    },
    originalEvent: {} as CalendarEvent,
    calError: undefined,
    calWarnings: [],
    externalId: undefined,
    credentialId: 1,
  };
}

// ─── Test Suite ─────────────────────────────────────────────────────────────────

describe("Buffer Time Calendar Visualization (CI-002 gap)", () => {
  let service: BufferTimeEventService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new BufferTimeEventService();

    // Default mock behaviors — overridden per-test as needed
    mockCheckIfFeatureIsEnabledGlobally.mockResolvedValue(true);
    mockBuildBufferEvent.mockReturnValue(null);
    mockCreateEvent.mockResolvedValue(buildSuccessfulEventResult());
    mockPrismaBookingReference.findMany.mockResolvedValue([]);
    mockPrismaBookingReference.create.mockResolvedValue({ id: 1 });
    mockPrismaBookingReference.update.mockResolvedValue({});
  });

  // ── Phase 1: Feature Flag Gating ──────────────────────────────────────────

  describe("Feature Flag Gating (calendar-buffer-sync)", () => {
    it("should return false from isBufferSyncEnabled when calendar-buffer-sync feature flag is disabled", async () => {
      mockCheckIfFeatureIsEnabledGlobally.mockResolvedValue(false);

      const result = await service.isBufferSyncEnabled();

      expect(result).toBe(false);
      expect(mockCheckIfFeatureIsEnabledGlobally).toHaveBeenCalledWith("calendar-buffer-sync");
    });

    it("should return true from isBufferSyncEnabled when calendar-buffer-sync feature flag is enabled", async () => {
      mockCheckIfFeatureIsEnabledGlobally.mockResolvedValue(true);

      const result = await service.isBufferSyncEnabled();

      expect(result).toBe(true);
      expect(mockCheckIfFeatureIsEnabledGlobally).toHaveBeenCalledWith("calendar-buffer-sync");
    });

    it("should return false from isBufferSyncEnabled when feature flag check throws an error", async () => {
      mockCheckIfFeatureIsEnabledGlobally.mockRejectedValue(new Error("DB connection failed"));

      const result = await service.isBufferSyncEnabled();

      // Fail-safe: disabled when the check fails
      expect(result).toBe(false);
    });
  });

  // ── Phase 2: syncBuffersToCalendar Toggle ─────────────────────────────────

  describe("syncBuffersToCalendar Toggle", () => {
    it("should return false from shouldCreateBufferEvents when syncBuffersToCalendar is false", async () => {
      const result = await service.shouldCreateBufferEvents({ syncBuffersToCalendar: false });

      expect(result).toBe(false);
      // Short-circuit: feature flag check should NOT be called
      expect(mockCheckIfFeatureIsEnabledGlobally).not.toHaveBeenCalled();
    });

    it("should return false from shouldCreateBufferEvents when syncBuffersToCalendar is null", async () => {
      const result = await service.shouldCreateBufferEvents({ syncBuffersToCalendar: null });

      expect(result).toBe(false);
      expect(mockCheckIfFeatureIsEnabledGlobally).not.toHaveBeenCalled();
    });

    it("should return false from shouldCreateBufferEvents when syncBuffersToCalendar is undefined", async () => {
      const result = await service.shouldCreateBufferEvents({ syncBuffersToCalendar: undefined });

      expect(result).toBe(false);
      expect(mockCheckIfFeatureIsEnabledGlobally).not.toHaveBeenCalled();
    });

    it("should return false from shouldCreateBufferEvents when toggle is true but feature flag is disabled", async () => {
      mockCheckIfFeatureIsEnabledGlobally.mockResolvedValue(false);

      const result = await service.shouldCreateBufferEvents({ syncBuffersToCalendar: true });

      // Both gates must pass — feature flag is disabled so result is false
      expect(result).toBe(false);
      expect(mockCheckIfFeatureIsEnabledGlobally).toHaveBeenCalledOnce();
    });

    it("should return true from shouldCreateBufferEvents when toggle is true AND feature flag is enabled", async () => {
      mockCheckIfFeatureIsEnabledGlobally.mockResolvedValue(true);

      const result = await service.shouldCreateBufferEvents({ syncBuffersToCalendar: true });

      expect(result).toBe(true);
      expect(mockCheckIfFeatureIsEnabledGlobally).toHaveBeenCalledOnce();
    });
  });

  // ── Phase 3: Buffer Event Creation ────────────────────────────────────────

  describe("Buffer Event Creation", () => {
    it("should create before and after buffer events when both are configured", async () => {
      // Before buffer: 09:45–10:00 (15 minutes before 10:00 start)
      mockBuildBufferEvent
        .mockReturnValueOnce(
          buildCalendarEvent({
            title: "Buffer: Team Meeting",
            startTime: "2024-01-15T09:45:00Z",
            endTime: "2024-01-15T10:00:00Z",
          })
        )
        // After buffer: 11:00–11:10 (10 minutes after 11:00 end)
        .mockReturnValueOnce(
          buildCalendarEvent({
            title: "Buffer: Team Meeting",
            startTime: "2024-01-15T11:00:00Z",
            endTime: "2024-01-15T11:10:00Z",
          })
        );

      mockCreateEvent
        .mockResolvedValueOnce(buildSuccessfulEventResult("before-uid"))
        .mockResolvedValueOnce(buildSuccessfulEventResult("after-uid"));

      const results = await service.createBufferEvents({
        booking: buildMockBooking() as any,
        credential: buildCredential(),
        externalCalendarId: "cal-id",
      });

      // Both buffer types attempted
      expect(mockBuildBufferEvent).toHaveBeenCalledTimes(2);
      expect(mockCreateEvent).toHaveBeenCalledTimes(2);
      // Both BookingReferences stored
      expect(mockPrismaBookingReference.create).toHaveBeenCalledTimes(2);
      // Results array has 2 entries
      expect(results).toHaveLength(2);
      expect(results[0].success).toBe(true);
      expect(results[0].uid).toBe("before-uid");
      expect(results[1].success).toBe(true);
      expect(results[1].uid).toBe("after-uid");
    });

    it("should create only before buffer event when after buffer returns null", async () => {
      mockBuildBufferEvent
        .mockReturnValueOnce(
          buildCalendarEvent({ title: "Buffer: Team Meeting" })
        )
        .mockReturnValueOnce(null); // No after buffer configured

      mockCreateEvent.mockResolvedValueOnce(buildSuccessfulEventResult("before-uid"));

      const results = await service.createBufferEvents({
        booking: buildMockBooking() as any,
        credential: buildCredential(),
      });

      expect(mockCreateEvent).toHaveBeenCalledTimes(1);
      expect(results).toHaveLength(1);
      expect(results[0].uid).toBe("before-uid");
    });

    it("should create no buffer events when both before and after return null (0-minute buffer)", async () => {
      // Default: mockBuildBufferEvent returns null for both calls
      mockBuildBufferEvent.mockReturnValue(null);

      const results = await service.createBufferEvents({
        booking: buildMockBooking() as any,
        credential: buildCredential(),
      });

      expect(mockCreateEvent).not.toHaveBeenCalled();
      expect(results).toHaveLength(0);
    });

    it("should store BookingReference for successfully created buffer events", async () => {
      mockBuildBufferEvent
        .mockReturnValueOnce(
          buildCalendarEvent({
            title: "Buffer: Team Meeting",
            startTime: "2024-01-15T09:45:00Z",
            endTime: "2024-01-15T10:00:00Z",
          })
        )
        .mockReturnValueOnce(
          buildCalendarEvent({
            title: "Buffer: Team Meeting",
            startTime: "2024-01-15T11:00:00Z",
            endTime: "2024-01-15T11:10:00Z",
          })
        );

      mockCreateEvent
        .mockResolvedValueOnce(buildSuccessfulEventResult("before-uid"))
        .mockResolvedValueOnce(buildSuccessfulEventResult("after-uid"));

      await service.createBufferEvents({
        booking: buildMockBooking() as any,
        credential: buildCredential({ id: 5 }),
        externalCalendarId: "cal-123",
      });

      // Verify the first BookingReference create call (before buffer)
      expect(mockPrismaBookingReference.create).toHaveBeenCalledTimes(2);

      const firstCallArgs = mockPrismaBookingReference.create.mock.calls[0][0];
      expect(firstCallArgs.data).toMatchObject({
        bookingId: 123,
        type: "buffer_time_before",
        uid: "before-uid",
        credentialId: 5,
        externalCalendarId: "cal-123",
      });

      // Verify the second BookingReference create call (after buffer)
      const secondCallArgs = mockPrismaBookingReference.create.mock.calls[1][0];
      expect(secondCallArgs.data).toMatchObject({
        bookingId: 123,
        type: "buffer_time_after",
        uid: "after-uid",
        credentialId: 5,
        externalCalendarId: "cal-123",
      });
    });

    it("should continue creating after buffer event even if before buffer event fails", async () => {
      mockBuildBufferEvent
        .mockReturnValueOnce(
          buildCalendarEvent({ title: "Buffer: Team Meeting" })
        )
        .mockReturnValueOnce(
          buildCalendarEvent({ title: "Buffer: Team Meeting" })
        );

      // First createEvent (before) rejects, second (after) succeeds
      mockCreateEvent
        .mockRejectedValueOnce(new Error("API Error"))
        .mockResolvedValueOnce(buildSuccessfulEventResult("after-uid"));

      const results = await service.createBufferEvents({
        booking: buildMockBooking() as any,
        credential: buildCredential(),
      });

      // Both buffer types attempted despite first failure
      expect(mockCreateEvent).toHaveBeenCalledTimes(2);
      // Only the successful after buffer event is in results
      expect(results).toHaveLength(1);
      expect(results[0].uid).toBe("after-uid");
    });
  });

  // ── Phase 4: Buffer Event Title Pattern ───────────────────────────────────

  describe("Buffer Event Title Pattern", () => {
    it("should pass the booking and buffer type to CalendarEventBuilder.buildBufferEvent", async () => {
      mockBuildBufferEvent.mockReturnValue(null);

      const booking = buildMockBooking();

      await service.createBufferEvents({
        booking: booking as any,
        credential: buildCredential(),
      });

      // Verify buildBufferEvent was called with correct arguments for "before" and "after"
      expect(mockBuildBufferEvent).toHaveBeenCalledTimes(2);
      expect(mockBuildBufferEvent).toHaveBeenNthCalledWith(1, booking, "before");
      expect(mockBuildBufferEvent).toHaveBeenNthCalledWith(2, booking, "after");
    });
  });

  // ── Phase 5: Buffer Event Deletion ────────────────────────────────────────

  describe("Buffer Event Deletion", () => {
    it("should delete all buffer events when booking is cancelled", async () => {
      mockPrismaBookingReference.findMany.mockResolvedValue([
        {
          id: 1,
          uid: "buffer-before-uid",
          type: "buffer_time_before",
          externalCalendarId: "cal-123",
          bookingId: 123,
        },
        {
          id: 2,
          uid: "buffer-after-uid",
          type: "buffer_time_after",
          externalCalendarId: "cal-123",
          bookingId: 123,
        },
      ]);

      mockDeleteEvent.mockResolvedValue(undefined);

      await service.deleteBufferEvents({
        bookingId: 123,
        credential: buildCredential(),
        event: buildCalendarEvent(),
      });

      // Both buffer references deleted from external calendar
      expect(mockDeleteEvent).toHaveBeenCalledTimes(2);
      // Both BookingReferences soft-deleted
      expect(mockPrismaBookingReference.update).toHaveBeenCalledTimes(2);

      // Verify soft-delete data for first reference
      expect(mockPrismaBookingReference.update).toHaveBeenNthCalledWith(1, {
        where: { id: 1 },
        data: { deleted: true },
      });
      // Verify soft-delete data for second reference
      expect(mockPrismaBookingReference.update).toHaveBeenNthCalledWith(2, {
        where: { id: 2 },
        data: { deleted: true },
      });
    });

    it("should query buffer references with correct filters", async () => {
      mockPrismaBookingReference.findMany.mockResolvedValue([]);

      await service.deleteBufferEvents({
        bookingId: 123,
        credential: buildCredential(),
        event: buildCalendarEvent(),
      });

      expect(mockPrismaBookingReference.findMany).toHaveBeenCalledWith({
        where: {
          bookingId: 123,
          type: { startsWith: "buffer_time" },
          deleted: null,
        },
      });
    });

    it("should handle no buffer references gracefully on deletion", async () => {
      mockPrismaBookingReference.findMany.mockResolvedValue([]);

      await service.deleteBufferEvents({
        bookingId: 123,
        credential: buildCredential(),
        event: buildCalendarEvent(),
      });

      // No external calendar deletion attempted
      expect(mockDeleteEvent).not.toHaveBeenCalled();
      // No BookingReference updates attempted
      expect(mockPrismaBookingReference.update).not.toHaveBeenCalled();
    });

    it("should continue deleting remaining buffer events if one deletion fails", async () => {
      mockPrismaBookingReference.findMany.mockResolvedValue([
        {
          id: 1,
          uid: "buffer-before-uid",
          type: "buffer_time_before",
          externalCalendarId: "cal-123",
          bookingId: 123,
        },
        {
          id: 2,
          uid: "buffer-after-uid",
          type: "buffer_time_after",
          externalCalendarId: "cal-123",
          bookingId: 123,
        },
      ]);

      // First deleteEvent fails, second succeeds
      mockDeleteEvent
        .mockRejectedValueOnce(new Error("API Error"))
        .mockResolvedValueOnce(undefined);

      await service.deleteBufferEvents({
        bookingId: 123,
        credential: buildCredential(),
        event: buildCalendarEvent(),
      });

      // Both deletions attempted despite first failure (best-effort)
      expect(mockDeleteEvent).toHaveBeenCalledTimes(2);
      // Only the second reference was soft-deleted (first errored before update)
      expect(mockPrismaBookingReference.update).toHaveBeenCalledTimes(1);
      expect(mockPrismaBookingReference.update).toHaveBeenCalledWith({
        where: { id: 2 },
        data: { deleted: true },
      });
    });
  });

  // ── Phase 6: Edge Cases ───────────────────────────────────────────────────

  describe("Edge Cases", () => {
    it("should handle booking without destination calendar", async () => {
      mockBuildBufferEvent.mockReturnValue(buildCalendarEvent());
      mockCreateEvent.mockResolvedValue(buildSuccessfulEventResult());

      // No externalCalendarId passed — simulates booking with no destination calendar
      const results = await service.createBufferEvents({
        booking: buildMockBooking() as any,
        credential: buildCredential(),
      });

      // Should proceed normally without errors
      expect(results).toBeDefined();
      expect(mockCreateEvent).toHaveBeenCalled();
    });

    it("should handle missing eventType in booking gracefully", async () => {
      // buildBufferEvent returns null when eventType is missing
      mockBuildBufferEvent.mockReturnValue(null);

      const results = await service.createBufferEvents({
        booking: buildMockBooking({ eventType: undefined }) as any,
        credential: buildCredential(),
      });

      // No errors thrown, returns empty results
      expect(results).toHaveLength(0);
      expect(mockCreateEvent).not.toHaveBeenCalled();
    });
  });
});
