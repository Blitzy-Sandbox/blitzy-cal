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

import type { CalendarEvent, NewCalendarEventType } from "@calcom/types/Calendar";
import type { CredentialForCalendarService } from "@calcom/types/Credential";
import type { EventResult } from "@calcom/types/EventManager";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
function buildSuccessfulEventResult(uid: string = "buffer-uid-123"): EventResult<NewCalendarEventType> {
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
        .mockReturnValueOnce(buildCalendarEvent({ title: "Buffer: Team Meeting" }))
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
      // IMPORTANT: uid must be the external calendar event ID (result.createdEvent.id)
      // NOT Cal.com's internal UID (result.uid), so deleteEvent can locate the buffer
      // event on the external calendar provider (Google, Outlook, Apple).
      expect(mockPrismaBookingReference.create).toHaveBeenCalledTimes(2);

      const firstCallArgs = mockPrismaBookingReference.create.mock.calls[0][0];
      expect(firstCallArgs.data).toMatchObject({
        bookingId: 123,
        type: "buffer_time_before",
        uid: "event-before-uid",
        credentialId: 5,
        externalCalendarId: "cal-123",
      });

      // Verify the second BookingReference create call (after buffer)
      const secondCallArgs = mockPrismaBookingReference.create.mock.calls[1][0];
      expect(secondCallArgs.data).toMatchObject({
        bookingId: 123,
        type: "buffer_time_after",
        uid: "event-after-uid",
        credentialId: 5,
        externalCalendarId: "cal-123",
      });
    });

    it("should continue creating after buffer event even if before buffer event fails", async () => {
      mockBuildBufferEvent
        .mockReturnValueOnce(buildCalendarEvent({ title: "Buffer: Team Meeting" }))
        .mockReturnValueOnce(buildCalendarEvent({ title: "Buffer: Team Meeting" }));

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
      mockDeleteEvent.mockRejectedValueOnce(new Error("API Error")).mockResolvedValueOnce(undefined);

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

  // ── Phase 7: Multi-Adapter Coverage (Google, Outlook, Apple) ──────────────
  //
  // The phases above use google_calendar fixtures exclusively. This phase
  // verifies that buffer event creation and deletion work identically for all
  // three primary calendar adapters, and that the correct external calendar
  // event ID (result.createdEvent.id) is stored for each provider.

  describe("Multi-Adapter Coverage — Google Calendar", () => {
    it("should create buffer events and store external Google Calendar event IDs", async () => {
      mockBuildBufferEvent
        .mockReturnValueOnce(buildCalendarEvent({ title: "Buffer: Google Meeting" }))
        .mockReturnValueOnce(buildCalendarEvent({ title: "Buffer: Google Meeting" }));

      const googleBeforeResult = buildSuccessfulEventResult("gcal-before-uid");
      const googleAfterResult = buildSuccessfulEventResult("gcal-after-uid");
      mockCreateEvent.mockResolvedValueOnce(googleBeforeResult).mockResolvedValueOnce(googleAfterResult);

      const googleCredential = buildCredential({ id: 10, type: "google_calendar" });

      const results = await service.createBufferEvents({
        booking: buildMockBooking() as any,
        credential: googleCredential,
        externalCalendarId: "primary",
      });

      // Both buffer events created successfully
      expect(results).toHaveLength(2);
      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(true);

      // Verify external calendar event ID (createdEvent.id) was stored, NOT Cal.com UID
      expect(mockPrismaBookingReference.create).toHaveBeenCalledTimes(2);

      const beforeRef = mockPrismaBookingReference.create.mock.calls[0][0];
      expect(beforeRef.data).toMatchObject({
        bookingId: 123,
        type: "buffer_time_before",
        uid: "event-gcal-before-uid", // External Google Calendar event ID
        credentialId: 10,
        externalCalendarId: "primary",
      });

      const afterRef = mockPrismaBookingReference.create.mock.calls[1][0];
      expect(afterRef.data).toMatchObject({
        bookingId: 123,
        type: "buffer_time_after",
        uid: "event-gcal-after-uid", // External Google Calendar event ID
        credentialId: 10,
        externalCalendarId: "primary",
      });
    });

    it("should delete buffer events using stored external Google Calendar event IDs", async () => {
      mockPrismaBookingReference.findMany.mockResolvedValue([
        {
          id: 101,
          uid: "event-gcal-before-uid", // External ID as stored by createBufferEvents
          type: "buffer_time_before",
          externalCalendarId: "primary",
          bookingId: 123,
        },
        {
          id: 102,
          uid: "event-gcal-after-uid",
          type: "buffer_time_after",
          externalCalendarId: "primary",
          bookingId: 123,
        },
      ]);

      mockDeleteEvent.mockResolvedValue(undefined);

      const googleCredential = buildCredential({ id: 10, type: "google_calendar" });

      await service.deleteBufferEvents({
        bookingId: 123,
        credential: googleCredential,
        event: buildCalendarEvent(),
      });

      // deleteEvent called with the stored external event IDs
      expect(mockDeleteEvent).toHaveBeenCalledTimes(2);
      expect(mockDeleteEvent).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          bookingRefUid: "event-gcal-before-uid",
          externalCalendarId: "primary",
        })
      );
      expect(mockDeleteEvent).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          bookingRefUid: "event-gcal-after-uid",
          externalCalendarId: "primary",
        })
      );

      // Both soft-deleted
      expect(mockPrismaBookingReference.update).toHaveBeenCalledTimes(2);
    });
  });

  describe("Multi-Adapter Coverage — Outlook / Office 365", () => {
    it("should create buffer events and store external Outlook event IDs", async () => {
      mockBuildBufferEvent
        .mockReturnValueOnce(buildCalendarEvent({ title: "Buffer: Outlook Meeting" }))
        .mockReturnValueOnce(buildCalendarEvent({ title: "Buffer: Outlook Meeting" }));

      // Outlook adapter returns event results with outlook-specific IDs
      const outlookBeforeResult: EventResult<NewCalendarEventType> = {
        appName: "office365-calendar",
        type: "office365_calendar",
        success: true,
        uid: "outlook-internal-before",
        iCalUID: "outlook-before@outlook.com",
        createdEvent: {
          uid: "outlook-internal-before",
          id: "AAMkAG-outlook-before-event-id",
          type: "office365_calendar",
          password: "",
          url: "",
          additionalInfo: {},
          iCalUID: "outlook-before@outlook.com",
        },
        originalEvent: {} as CalendarEvent,
        calError: undefined,
        calWarnings: [],
        externalId: undefined,
        credentialId: 20,
      };
      const outlookAfterResult: EventResult<NewCalendarEventType> = {
        ...outlookBeforeResult,
        uid: "outlook-internal-after",
        iCalUID: "outlook-after@outlook.com",
        createdEvent: {
          ...outlookBeforeResult.createdEvent!,
          uid: "outlook-internal-after",
          id: "AAMkAG-outlook-after-event-id",
          iCalUID: "outlook-after@outlook.com",
        },
      };
      mockCreateEvent.mockResolvedValueOnce(outlookBeforeResult).mockResolvedValueOnce(outlookAfterResult);

      const outlookCredential = buildCredential({ id: 20, type: "office365_calendar" });

      const results = await service.createBufferEvents({
        booking: buildMockBooking() as any,
        credential: outlookCredential,
        externalCalendarId: "outlook-calendar-id",
      });

      expect(results).toHaveLength(2);

      // Verify external Outlook event IDs (AAMkAG-*) were stored, NOT internal UIDs
      expect(mockPrismaBookingReference.create).toHaveBeenCalledTimes(2);

      const beforeRef = mockPrismaBookingReference.create.mock.calls[0][0];
      expect(beforeRef.data).toMatchObject({
        bookingId: 123,
        type: "buffer_time_before",
        uid: "AAMkAG-outlook-before-event-id",
        credentialId: 20,
        externalCalendarId: "outlook-calendar-id",
      });

      const afterRef = mockPrismaBookingReference.create.mock.calls[1][0];
      expect(afterRef.data).toMatchObject({
        bookingId: 123,
        type: "buffer_time_after",
        uid: "AAMkAG-outlook-after-event-id",
        credentialId: 20,
        externalCalendarId: "outlook-calendar-id",
      });
    });

    it("should delete buffer events using stored external Outlook event IDs", async () => {
      mockPrismaBookingReference.findMany.mockResolvedValue([
        {
          id: 201,
          uid: "AAMkAG-outlook-before-event-id",
          type: "buffer_time_before",
          externalCalendarId: "outlook-calendar-id",
          bookingId: 456,
        },
        {
          id: 202,
          uid: "AAMkAG-outlook-after-event-id",
          type: "buffer_time_after",
          externalCalendarId: "outlook-calendar-id",
          bookingId: 456,
        },
      ]);

      mockDeleteEvent.mockResolvedValue(undefined);

      const outlookCredential = buildCredential({ id: 20, type: "office365_calendar" });

      await service.deleteBufferEvents({
        bookingId: 456,
        credential: outlookCredential,
        event: buildCalendarEvent(),
      });

      expect(mockDeleteEvent).toHaveBeenCalledTimes(2);
      expect(mockDeleteEvent).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          bookingRefUid: "AAMkAG-outlook-before-event-id",
          externalCalendarId: "outlook-calendar-id",
        })
      );
      expect(mockDeleteEvent).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          bookingRefUid: "AAMkAG-outlook-after-event-id",
          externalCalendarId: "outlook-calendar-id",
        })
      );

      expect(mockPrismaBookingReference.update).toHaveBeenCalledTimes(2);
    });
  });

  describe("Multi-Adapter Coverage — Apple Calendar (CalDAV)", () => {
    it("should create buffer events and store external Apple Calendar event IDs", async () => {
      mockBuildBufferEvent
        .mockReturnValueOnce(buildCalendarEvent({ title: "Buffer: iCloud Meeting" }))
        .mockReturnValueOnce(buildCalendarEvent({ title: "Buffer: iCloud Meeting" }));

      // Apple Calendar / CalDAV adapter returns event results with CalDAV-specific UIDs
      const appleBeforeResult: EventResult<NewCalendarEventType> = {
        appName: "apple-calendar",
        type: "apple_calendar",
        success: true,
        uid: "apple-internal-before",
        iCalUID: "apple-before@caldav.icloud.com",
        createdEvent: {
          uid: "apple-internal-before",
          id: "caldav-event-uuid-before-12345",
          type: "apple_calendar",
          password: "",
          url: "",
          additionalInfo: {},
          iCalUID: "apple-before@caldav.icloud.com",
        },
        originalEvent: {} as CalendarEvent,
        calError: undefined,
        calWarnings: [],
        externalId: undefined,
        credentialId: 30,
      };
      const appleAfterResult: EventResult<NewCalendarEventType> = {
        ...appleBeforeResult,
        uid: "apple-internal-after",
        iCalUID: "apple-after@caldav.icloud.com",
        createdEvent: {
          ...appleBeforeResult.createdEvent!,
          uid: "apple-internal-after",
          id: "caldav-event-uuid-after-67890",
          iCalUID: "apple-after@caldav.icloud.com",
        },
      };
      mockCreateEvent.mockResolvedValueOnce(appleBeforeResult).mockResolvedValueOnce(appleAfterResult);

      const appleCredential = buildCredential({ id: 30, type: "apple_calendar" });

      const results = await service.createBufferEvents({
        booking: buildMockBooking() as any,
        credential: appleCredential,
        externalCalendarId: "caldav-calendar-home",
      });

      expect(results).toHaveLength(2);

      // Verify CalDAV external event IDs were stored, NOT internal UIDs
      expect(mockPrismaBookingReference.create).toHaveBeenCalledTimes(2);

      const beforeRef = mockPrismaBookingReference.create.mock.calls[0][0];
      expect(beforeRef.data).toMatchObject({
        bookingId: 123,
        type: "buffer_time_before",
        uid: "caldav-event-uuid-before-12345",
        credentialId: 30,
        externalCalendarId: "caldav-calendar-home",
      });

      const afterRef = mockPrismaBookingReference.create.mock.calls[1][0];
      expect(afterRef.data).toMatchObject({
        bookingId: 123,
        type: "buffer_time_after",
        uid: "caldav-event-uuid-after-67890",
        credentialId: 30,
        externalCalendarId: "caldav-calendar-home",
      });
    });

    it("should delete buffer events using stored external Apple Calendar event IDs", async () => {
      mockPrismaBookingReference.findMany.mockResolvedValue([
        {
          id: 301,
          uid: "caldav-event-uuid-before-12345",
          type: "buffer_time_before",
          externalCalendarId: "caldav-calendar-home",
          bookingId: 789,
        },
        {
          id: 302,
          uid: "caldav-event-uuid-after-67890",
          type: "buffer_time_after",
          externalCalendarId: "caldav-calendar-home",
          bookingId: 789,
        },
      ]);

      mockDeleteEvent.mockResolvedValue(undefined);

      const appleCredential = buildCredential({ id: 30, type: "apple_calendar" });

      await service.deleteBufferEvents({
        bookingId: 789,
        credential: appleCredential,
        event: buildCalendarEvent(),
      });

      expect(mockDeleteEvent).toHaveBeenCalledTimes(2);
      expect(mockDeleteEvent).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          bookingRefUid: "caldav-event-uuid-before-12345",
          externalCalendarId: "caldav-calendar-home",
        })
      );
      expect(mockDeleteEvent).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          bookingRefUid: "caldav-event-uuid-after-67890",
          externalCalendarId: "caldav-calendar-home",
        })
      );

      expect(mockPrismaBookingReference.update).toHaveBeenCalledTimes(2);
    });
  });

  // ── Phase 8: Apple Calendar Destination Calendar Targeting ─────────────────
  //
  // Verifies that buffer events for Apple Calendar (CalDAV) are created only on
  // the specified destination calendar, not on ALL user calendars. This prevents
  // partial failures on read-only calendars (e.g. iCloud subscribed calendars)
  // which would prevent storeBufferReference from being called.

  describe("Apple Calendar Destination Calendar Targeting", () => {
    it("should pass externalCalendarId to CalendarManager.createEvent for Apple Calendar buffer events", async () => {
      mockBuildBufferEvent
        .mockReturnValueOnce(buildCalendarEvent({ title: "Buffer: iCloud Targeted" }))
        .mockReturnValueOnce(buildCalendarEvent({ title: "Buffer: iCloud Targeted" }));

      const appleBeforeResult: EventResult<NewCalendarEventType> = {
        appName: "apple-calendar",
        type: "apple_calendar",
        success: true,
        uid: "apple-targeted-before",
        createdEvent: {
          uid: "apple-targeted-before",
          id: "caldav-targeted-before-uid",
          type: "apple_calendar",
          password: "",
          url: "",
          additionalInfo: {},
        },
        originalEvent: {} as CalendarEvent,
        calError: undefined,
        calWarnings: [],
        externalId: "caldav-primary-calendar",
        credentialId: 30,
      };
      const appleAfterResult: EventResult<NewCalendarEventType> = {
        ...appleBeforeResult,
        uid: "apple-targeted-after",
        createdEvent: {
          ...appleBeforeResult.createdEvent!,
          uid: "apple-targeted-after",
          id: "caldav-targeted-after-uid",
        },
      };
      mockCreateEvent.mockResolvedValueOnce(appleBeforeResult).mockResolvedValueOnce(appleAfterResult);

      const appleCredential = buildCredential({ id: 30, type: "apple_calendar" });
      const targetCalendarId = "caldav-primary-calendar";

      await service.createBufferEvents({
        booking: buildMockBooking() as any,
        credential: appleCredential,
        externalCalendarId: targetCalendarId,
      });

      // Verify CalendarManager.createEvent receives the externalCalendarId for each buffer event
      expect(mockCreateEvent).toHaveBeenCalledTimes(2);
      // First call: before buffer
      expect(mockCreateEvent).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ id: 30 }), // credential
        expect.objectContaining({ title: "Buffer: iCloud Targeted" }), // calEvent
        targetCalendarId // externalCalendarId — ensures only target calendar is used
      );
      // Second call: after buffer
      expect(mockCreateEvent).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ id: 30 }),
        expect.objectContaining({ title: "Buffer: iCloud Targeted" }),
        targetCalendarId
      );

      // Verify BookingReference stores the target calendar ID
      expect(mockPrismaBookingReference.create).toHaveBeenCalledTimes(2);
      const beforeRef = mockPrismaBookingReference.create.mock.calls[0][0];
      expect(beforeRef.data.externalCalendarId).toBe(targetCalendarId);
      const afterRef = mockPrismaBookingReference.create.mock.calls[1][0];
      expect(afterRef.data.externalCalendarId).toBe(targetCalendarId);
    });

    it("should create buffer events without externalCalendarId when none is specified", async () => {
      mockBuildBufferEvent
        .mockReturnValueOnce(buildCalendarEvent({ title: "Buffer: No Target" }))
        .mockReturnValueOnce(null);

      const result: EventResult<NewCalendarEventType> = {
        appName: "apple-calendar",
        type: "apple_calendar",
        success: true,
        uid: "no-target-uid",
        createdEvent: {
          uid: "no-target-uid",
          id: "caldav-no-target-id",
          type: "apple_calendar",
          password: "",
          url: "",
          additionalInfo: {},
        },
        originalEvent: {} as CalendarEvent,
        calError: undefined,
        calWarnings: [],
        externalId: undefined,
        credentialId: 30,
      };
      mockCreateEvent.mockResolvedValueOnce(result);

      const appleCredential = buildCredential({ id: 30, type: "apple_calendar" });

      // No externalCalendarId provided
      await service.createBufferEvents({
        booking: buildMockBooking() as any,
        credential: appleCredential,
      });

      expect(mockCreateEvent).toHaveBeenCalledTimes(1);
      // Third argument (externalCalendarId) should be undefined
      expect(mockCreateEvent).toHaveBeenCalledWith(expect.anything(), expect.anything(), undefined);

      // BookingReference stores null for externalCalendarId
      expect(mockPrismaBookingReference.create).toHaveBeenCalledTimes(1);
      const ref = mockPrismaBookingReference.create.mock.calls[0][0];
      expect(ref.data.externalCalendarId).toBeNull();
    });

    it("should store buffer references even when externalCalendarId targets a specific Apple calendar", async () => {
      mockBuildBufferEvent
        .mockReturnValueOnce(buildCalendarEvent({ title: "Buffer: Targeted Store" }))
        .mockReturnValueOnce(null); // only before buffer

      const result: EventResult<NewCalendarEventType> = {
        appName: "apple-calendar",
        type: "apple_calendar",
        success: true,
        uid: "store-uid",
        createdEvent: {
          uid: "store-uid",
          id: "caldav-stored-id-99",
          type: "apple_calendar",
          password: "",
          url: "",
          additionalInfo: {},
        },
        originalEvent: {} as CalendarEvent,
        calError: undefined,
        calWarnings: [],
        externalId: "caldav-work-calendar",
        credentialId: 30,
      };
      mockCreateEvent.mockResolvedValueOnce(result);

      const appleCredential = buildCredential({ id: 30, type: "apple_calendar" });

      await service.createBufferEvents({
        booking: buildMockBooking() as any,
        credential: appleCredential,
        externalCalendarId: "caldav-work-calendar",
      });

      // Verify that storeBufferReference was called (BookingReference.create)
      // This confirms the flow succeeds end-to-end when targeting a specific calendar
      expect(mockPrismaBookingReference.create).toHaveBeenCalledTimes(1);
      const ref = mockPrismaBookingReference.create.mock.calls[0][0];
      expect(ref.data).toMatchObject({
        bookingId: 123,
        type: "buffer_time_before",
        uid: "caldav-stored-id-99", // external event ID stored, not internal
        credentialId: 30,
        externalCalendarId: "caldav-work-calendar", // target calendar preserved
      });
    });
  });

  // ── Phase 9: Cross-Adapter Consistency Verification ───────────────────────
  //
  // Verifies that the external ID storage pattern (result.createdEvent.id)
  // works consistently across provider-specific ID formats.

  describe("Cross-Adapter External ID Consistency", () => {
    it("should consistently store createdEvent.id (not result.uid) regardless of adapter", async () => {
      // Adapter-specific ID patterns:
      // - Google: short alphanumeric (e.g., "event-gcal-before-uid")
      // - Outlook: long AAMkAG-prefixed (e.g., "AAMkAG-outlook-id")
      // - Apple: CalDAV UUID (e.g., "caldav-uuid-12345")
      //
      // All three should store createdEvent.id, never result.uid.

      const adapterConfigs = [
        { type: "google_calendar", externalId: "gcal-ext-id-1234", internalUid: "gcal-internal-uid" },
        { type: "office365_calendar", externalId: "AAMkAG-ext-id-5678", internalUid: "o365-internal-uid" },
        { type: "apple_calendar", externalId: "caldav-ext-uuid-9012", internalUid: "apple-internal-uid" },
      ];

      for (const config of adapterConfigs) {
        // Reset mocks between adapter iterations
        mockBuildBufferEvent.mockReset();
        mockCreateEvent.mockReset();
        mockPrismaBookingReference.create.mockReset();

        // Only test "before" buffer to keep it focused
        mockBuildBufferEvent
          .mockReturnValueOnce(buildCalendarEvent({ title: `Buffer: ${config.type}` }))
          .mockReturnValueOnce(null); // no after buffer

        mockCreateEvent.mockResolvedValueOnce({
          appName: config.type,
          type: config.type,
          success: true,
          uid: config.internalUid, // Cal.com internal UID — should NOT be stored
          iCalUID: `${config.internalUid}@cal.com`,
          createdEvent: {
            uid: config.internalUid,
            id: config.externalId, // External calendar event ID — SHOULD be stored
            type: config.type,
            password: "",
            url: "",
            additionalInfo: {},
            iCalUID: `${config.internalUid}@cal.com`,
          },
          originalEvent: {} as CalendarEvent,
          calError: undefined,
          calWarnings: [],
          externalId: undefined,
          credentialId: 1,
        });

        const credential = buildCredential({ type: config.type });

        await service.createBufferEvents({
          booking: buildMockBooking() as any,
          credential,
        });

        // Verify the stored uid is the EXTERNAL ID, not the internal uid
        const storedRef = mockPrismaBookingReference.create.mock.calls[0]?.[0];
        expect(storedRef?.data?.uid).toBe(config.externalId);
        expect(storedRef?.data?.uid).not.toBe(config.internalUid);
      }
    });
  });
});
