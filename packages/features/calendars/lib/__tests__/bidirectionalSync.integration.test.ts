import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CalendarEvent, CalendarServiceEvent } from "@calcom/types/Calendar";
import type { CredentialForCalendarService } from "@calcom/types/Credential";

// ---------------------------------------------------------------------------
// vi.hoisted: Define mock objects accessible in vi.mock() factory closures.
// Vitest hoists vi.mock() calls to the top of the file. Complex expressions
// like `{ createEvent: vi.fn() }` are NOT auto-hoisted, so we use vi.hoisted()
// to ensure these objects exist when the vi.mock() factories execute.
// ---------------------------------------------------------------------------
const { mockCalendar, mockGetCalendarsEvents, mockGetCalendarsEventsWithTimezones } = vi.hoisted(() => ({
  mockCalendar: {
    createEvent: vi.fn(),
    updateEvent: vi.fn(),
    deleteEvent: vi.fn(),
    getAvailability: vi.fn(),
    listCalendars: vi.fn(),
  },
  mockGetCalendarsEvents: vi.fn(),
  mockGetCalendarsEventsWithTimezones: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Module-level vi.mock() calls — executed BEFORE any import of the modules
// they mock, thanks to vitest hoisting.
// ---------------------------------------------------------------------------

// Mock the calendar adapter factory — getCalendar resolves to our shared mock adapter
vi.mock("@calcom/app-store/_utils/getCalendar", () => ({
  getCalendar: vi.fn(() => Promise.resolve(mockCalendar)),
}));

// Mock getApps (used by getCalendarCredentials inside CalendarManager)
vi.mock("@calcom/app-store/utils", () => ({
  default: vi.fn(() => [
    {
      type: "google_calendar",
      variant: "calendar",
      credentials: [],
    },
  ]),
}));

// Mock constants used in processEvent
vi.mock("@calcom/lib/constants", () => ({
  ORGANIZER_EMAIL_EXEMPT_DOMAINS: "",
  IS_PRODUCTION: false,
}));

// Mock CalEventParser (used in processEvent and createEvent/updateEvent)
vi.mock("@calcom/lib/CalEventParser", () => ({
  getRichDescription: vi.fn(() => "Test rich description"),
  getUid: vi.fn(() => "test-uid-123"),
}));

// Mock delegation credential utilities (used in getBusyCalendarTimes deduplication)
vi.mock("@calcom/lib/delegationCredential", () => ({
  buildNonDelegationCredentials: vi.fn((creds: unknown) => creds),
}));

// Mock formatCalEvent (used in createEvent and updateEvent before processEvent)
vi.mock("@calcom/lib/formatCalendarEvent", () => ({
  formatCalEvent: vi.fn((event: unknown) => event),
}));

// Mock logger — suppress console output during tests
vi.mock("@calcom/lib/logger", () => ({
  default: {
    getSubLogger: () => ({
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
    error: vi.fn(),
  },
}));

// Mock PII-free data utilities (used in logging throughout CalendarManager)
vi.mock("@calcom/lib/piiFreeData", () => ({
  getPiiFreeCalendarEvent: vi.fn((e: unknown) => e),
  getPiiFreeCredential: vi.fn((c: unknown) => c),
}));

// Mock safeStringify (used in logging throughout CalendarManager)
vi.mock("@calcom/lib/safeStringify", () => ({
  safeStringify: vi.fn((x: unknown) => JSON.stringify(x)),
}));

// Mock locations (used in processEvent for Google Meet location type check)
vi.mock("@calcom/app-store/locations", () => ({
  MeetLocationType: "integrations:google:meet",
}));

// Mock getCalendarsEvents for inbound pipeline tests (getBusyCalendarTimes)
vi.mock("@calcom/features/calendars/lib/getCalendarsEvents", () => ({
  default: mockGetCalendarsEvents,
  getCalendarsEventsWithTimezones: mockGetCalendarsEventsWithTimezones,
}));

// ---------------------------------------------------------------------------
// Import modules under test AFTER all vi.mock() calls are declared
// ---------------------------------------------------------------------------
import {
  createEvent,
  updateEvent,
  deleteEvent,
  processEvent,
  getBusyCalendarTimes,
} from "../CalendarManager";

// ---------------------------------------------------------------------------
// Helper Functions — matching patterns from CalendarManager.test.ts
// ---------------------------------------------------------------------------

/**
 * Build a mock CredentialForCalendarService for testing calendar adapters.
 * Supports overriding type, appId, id, delegatedToId, user, and appName
 * to simulate Google, Outlook, and Apple Calendar credentials.
 */
function buildCredential(
  overrides: Partial<{
    type: string;
    appId: string;
    id: number;
    delegatedToId: string | null;
    user: { email: string } | null;
    appName: string;
  }> = {}
): CredentialForCalendarService {
  return {
    type: overrides.type ?? "google_calendar",
    appId: overrides.appId ?? "google-calendar",
    id: overrides.id ?? 1,
    delegatedToId: overrides.delegatedToId ?? null,
    user: overrides.user ?? { email: "organizer@example.com" },
    teamId: null,
    invalid: false,
    key: { access_token: "mock-access-token" },
    userId: 10000,
    appName: overrides.appName,
    delegatedTo: {
      serviceAccountKey: {
        client_email: "mock@serviceaccount.com",
        tenant_id: "mock-tenant",
        client_id: "mock-client",
        private_key: "mock-key",
      },
    },
  } as CredentialForCalendarService;
}

/**
 * Build a mock CalendarEvent for testing outbound pipeline operations.
 * Supports partial overrides to simulate different booking scenarios.
 */
function buildCalendarEvent(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    type: "test-event-type",
    title: "Test Booking Event",
    startTime: "2024-01-15T10:00:00Z",
    endTime: "2024-01-15T11:00:00Z",
    organizer: {
      name: "Organizer Name",
      email: "organizer@example.com",
      timeZone: "America/New_York",
      language: { translate: (x: string) => x, locale: "en" },
    },
    attendees: [
      {
        name: "Attendee One",
        email: "attendee1@example.com",
        timeZone: "America/New_York",
        language: { translate: (x: string) => x, locale: "en" },
      },
    ],
    destinationCalendar: null,
    hideOrganizerEmail: false,
    location: null,
    uid: "booking-uid-123",
    ...overrides,
  } as CalendarEvent;
}

/**
 * Build a mock SelectedCalendar for inbound pipeline (busy time) tests.
 * Minimal structure matching the SelectedCalendar Pick type used by getBusyCalendarTimes.
 */
function buildSelectedCalendar(
  overrides: Partial<{
    userId: number;
    integration: string;
    externalId: string;
    credentialId: number;
  }> = {}
) {
  return {
    userId: overrides.userId ?? 10000,
    integration: overrides.integration ?? "google_calendar",
    externalId: overrides.externalId ?? "organizer@example.com",
    credentialId: overrides.credentialId ?? 1,
  };
}

// ===========================================================================
// CI-005: Bi-Directional Sync Verification
//
// Verifies the complete booking lifecycle flows through the calendar adapter
// pipeline for Google, Outlook, and Apple Calendar:
//
// OUTBOUND: booking → processEvent → adapter.createEvent/updateEvent/deleteEvent
// INBOUND:  external calendar → getCalendarsEvents → busy time aggregation
// ===========================================================================
describe("Bi-Directional Sync Verification (CI-005)", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Reset inbound pipeline mocks
    mockGetCalendarsEvents.mockResolvedValue([]);
    mockGetCalendarsEventsWithTimezones.mockResolvedValue([]);

    // Reset mock calendar adapter responses for outbound pipeline
    mockCalendar.createEvent.mockResolvedValue({
      uid: "external-event-uid-123",
      id: "external-id-123",
      type: "google_calendar",
      password: "",
      url: "",
      additionalInfo: {},
      iCalUID: "ical-uid-123@google.com",
    });
    mockCalendar.updateEvent.mockResolvedValue({
      uid: "external-event-uid-123",
      id: "external-id-123",
      type: "google_calendar",
      password: "",
      url: "",
      additionalInfo: {},
    });
    mockCalendar.deleteEvent.mockResolvedValue(undefined);
    mockCalendar.getAvailability.mockResolvedValue([]);
  });

  // =========================================================================
  // Phase 1: Outbound Pipeline — Event Creation (Booking → External Calendar)
  // =========================================================================
  describe("Outbound Pipeline — Event Creation", () => {
    it("should create calendar event in external calendar via adapter on booking creation", async () => {
      const credential = buildCredential();
      const calendarEvent = buildCalendarEvent();

      const result = await createEvent(credential, calendarEvent);

      // Verify adapter createEvent was invoked exactly once
      expect(mockCalendar.createEvent).toHaveBeenCalledTimes(1);

      // Verify the event passed to the adapter includes calendarDescription from processEvent
      const calEventArg = mockCalendar.createEvent.mock.calls[0][0];
      expect(calEventArg).toHaveProperty("calendarDescription");

      // Verify result shape from createEvent
      expect(result.success).toBe(true);
      expect(result.uid).toBe("test-uid-123");
      expect(result.createdEvent).toBeDefined();
      expect(result.createdEvent?.uid).toBe("external-event-uid-123");
    });

    it("should process event with rich description before sending to adapter", async () => {
      const credential = buildCredential();
      const calendarEvent = buildCalendarEvent({ title: "Important Meeting" });

      await createEvent(credential, calendarEvent);

      // Verify the processEvent pipeline enriched the event with calendarDescription
      const calEventArg = mockCalendar.createEvent.mock.calls[0][0] as CalendarServiceEvent;
      expect(calEventArg.calendarDescription).toBe("Test rich description");
      expect(calEventArg.title).toBe("Important Meeting");
    });

    it("should handle Google Calendar credential for event creation", async () => {
      const credential = buildCredential({
        type: "google_calendar",
        appId: "google-calendar",
        appName: "Google Calendar",
      });
      const calendarEvent = buildCalendarEvent();

      const result = await createEvent(credential, calendarEvent);

      expect(result.type).toBe("google_calendar");
      expect(result.appName).toBe("Google Calendar");
      expect(result.success).toBe(true);
    });

    it("should handle Outlook credential for event creation", async () => {
      const credential = buildCredential({
        type: "office365_calendar",
        appId: "office365-calendar",
      });
      const calendarEvent = buildCalendarEvent();

      const result = await createEvent(credential, calendarEvent);

      expect(result.type).toBe("office365_calendar");
      expect(result.success).toBe(true);
    });

    it("should handle Apple Calendar credential for event creation", async () => {
      const credential = buildCredential({
        type: "apple_calendar",
        appId: "apple-calendar",
      });
      const calendarEvent = buildCalendarEvent();

      const result = await createEvent(credential, calendarEvent);

      expect(result.type).toBe("apple_calendar");
      expect(result.success).toBe(true);
    });

    it("should include delegation credential externalId when delegatedToId is present", async () => {
      const credential = buildCredential({
        delegatedToId: "delegation-id-123",
      });
      const calendarEvent = buildCalendarEvent();

      await createEvent(credential, calendarEvent, "external-cal-id-456");

      // When delegatedToId is present, externalId is forwarded to adapter.createEvent
      const externalIdArg = mockCalendar.createEvent.mock.calls[0][2];
      expect(externalIdArg).toBe("external-cal-id-456");
    });

    it("should pass externalId to adapter even when delegatedToId is null", async () => {
      const credential = buildCredential({ delegatedToId: null });
      const calendarEvent = buildCalendarEvent();

      await createEvent(credential, calendarEvent, "external-cal-id-456");

      // externalId is forwarded to adapter.createEvent for all credentials (not only
      // delegation credentials) so that Apple Calendar / CalDAV buffer events target
      // only the destination calendar instead of being created on every user calendar.
      const externalIdArg = mockCalendar.createEvent.mock.calls[0][2];
      expect(externalIdArg).toBe("external-cal-id-456");
    });

    it("should return iCalUID from adapter creation result", async () => {
      mockCalendar.createEvent.mockResolvedValue({
        uid: "ext-uid",
        id: "ext-id",
        type: "google_calendar",
        password: "",
        url: "",
        additionalInfo: {},
        iCalUID: "ical-123@google.com",
      });

      const credential = buildCredential();
      const calendarEvent = buildCalendarEvent();

      const result = await createEvent(credential, calendarEvent);

      // iCalUID is critical for bidirectional sync — links Cal.com booking to external calendar event
      expect(result.iCalUID).toBe("ical-123@google.com");
    });

    it("should pass credential id to adapter createEvent as second argument", async () => {
      const credential = buildCredential({ id: 42 });
      const calendarEvent = buildCalendarEvent();

      await createEvent(credential, calendarEvent);

      // The credential ID is passed as second argument to adapter.createEvent
      const credentialIdArg = mockCalendar.createEvent.mock.calls[0][1];
      expect(credentialIdArg).toBe(42);
    });

    it("should include credentialId and delegatedToId in the result", async () => {
      const credential = buildCredential({
        id: 99,
        delegatedToId: "delegation-xyz",
      });
      const calendarEvent = buildCalendarEvent();

      const result = await createEvent(credential, calendarEvent);

      expect(result.credentialId).toBe(99);
      expect(result.delegatedToId).toBe("delegation-xyz");
    });

    it("should return empty calWarnings array when adapter provides none", async () => {
      const credential = buildCredential();
      const calendarEvent = buildCalendarEvent();

      const result = await createEvent(credential, calendarEvent);

      expect(result.calWarnings).toEqual([]);
    });
  });

  // =========================================================================
  // Phase 2: Outbound Pipeline — Event Update (Rescheduling)
  // =========================================================================
  describe("Outbound Pipeline — Event Update (Rescheduling)", () => {
    it("should update existing calendar event via adapter on rescheduling", async () => {
      const credential = buildCredential();
      const calendarEvent = buildCalendarEvent({
        startTime: "2024-01-16T14:00:00Z",
        endTime: "2024-01-16T15:00:00Z",
      });

      const result = await updateEvent(
        credential,
        calendarEvent,
        "external-event-uid-123",
        "external-cal-id"
      );

      expect(mockCalendar.updateEvent).toHaveBeenCalledTimes(1);

      // Verify arguments passed to adapter.updateEvent
      const [bookingRefUidArg, calEventArg, externalCalIdArg] = mockCalendar.updateEvent.mock.calls[0];
      expect(bookingRefUidArg).toBe("external-event-uid-123");
      expect(calEventArg).toHaveProperty("calendarDescription");
      expect(externalCalIdArg).toBe("external-cal-id");

      expect(result.success).toBe(true);
    });

    it("should pass processed event with calendarDescription to updateEvent adapter", async () => {
      const credential = buildCredential();
      const calendarEvent = buildCalendarEvent();

      await updateEvent(credential, calendarEvent, "ref-uid", null);

      // Verify processEvent was invoked — calendarDescription is set on the event
      const calEventArg = mockCalendar.updateEvent.mock.calls[0][1] as CalendarServiceEvent;
      expect(calEventArg.calendarDescription).toBe("Test rich description");
    });

    it("should return success false when bookingRefUid is empty string", async () => {
      const credential = buildCredential();
      const calendarEvent = buildCalendarEvent();

      const result = await updateEvent(credential, calendarEvent, "", null);

      // Empty bookingRefUid is falsy — adapter.updateEvent should NOT be called
      expect(mockCalendar.updateEvent).not.toHaveBeenCalled();
      expect(result.success).toBe(false);
    });

    it("should return success false when bookingRefUid is null", async () => {
      const credential = buildCredential();
      const calendarEvent = buildCalendarEvent();

      const result = await updateEvent(credential, calendarEvent, null, null);

      expect(mockCalendar.updateEvent).not.toHaveBeenCalled();
      expect(result.success).toBe(false);
    });

    it("should include updatedEvent in the result on success", async () => {
      const credential = buildCredential();
      const calendarEvent = buildCalendarEvent();

      const result = await updateEvent(credential, calendarEvent, "external-event-uid-123", null);

      expect(result.success).toBe(true);
      expect(result.updatedEvent).toBeDefined();
    });

    it("should return result with correct type from credential", async () => {
      const credential = buildCredential({
        type: "office365_calendar",
        appId: "office365-calendar",
      });
      const calendarEvent = buildCalendarEvent();

      const result = await updateEvent(credential, calendarEvent, "ref-uid", null);

      expect(result.type).toBe("office365_calendar");
    });
  });

  // =========================================================================
  // Phase 3: Outbound Pipeline — Event Deletion (Cancellation)
  // =========================================================================
  describe("Outbound Pipeline — Event Deletion (Cancellation)", () => {
    it("should delete calendar event via adapter on booking cancellation", async () => {
      const credential = buildCredential();
      const calendarEvent = buildCalendarEvent();

      await deleteEvent({
        credential,
        bookingRefUid: "external-event-uid-123",
        event: calendarEvent,
      });

      expect(mockCalendar.deleteEvent).toHaveBeenCalledTimes(1);

      // Verify arguments: bookingRefUid, event, and undefined externalCalendarId
      const [bookingRefUidArg, eventArg, externalCalIdArg] = mockCalendar.deleteEvent.mock.calls[0];
      expect(bookingRefUidArg).toBe("external-event-uid-123");
      expect(eventArg).toBeDefined();
      expect(externalCalIdArg).toBeUndefined();
    });

    it("should pass externalCalendarId to deleteEvent adapter when provided", async () => {
      const credential = buildCredential();
      const calendarEvent = buildCalendarEvent();

      await deleteEvent({
        credential,
        bookingRefUid: "ref-uid",
        event: calendarEvent,
        externalCalendarId: "ext-cal-id",
      });

      expect(mockCalendar.deleteEvent).toHaveBeenCalledTimes(1);
      const externalCalIdArg = mockCalendar.deleteEvent.mock.calls[0][2];
      expect(externalCalIdArg).toBe("ext-cal-id");
    });

    it("should not call adapter deleteEvent when bookingRefUid is empty", async () => {
      const credential = buildCredential();
      const calendarEvent = buildCalendarEvent();

      const result = await deleteEvent({
        credential,
        bookingRefUid: "",
        event: calendarEvent,
      });

      // Empty bookingRefUid triggers early return with empty object (prevents malformed API request)
      expect(mockCalendar.deleteEvent).not.toHaveBeenCalled();
      expect(result).toEqual({});
    });

    it("should handle deletion with Google Calendar credential", async () => {
      const credential = buildCredential({
        type: "google_calendar",
        appId: "google-calendar",
      });
      const calendarEvent = buildCalendarEvent();

      await deleteEvent({
        credential,
        bookingRefUid: "google-event-uid",
        event: calendarEvent,
      });

      expect(mockCalendar.deleteEvent).toHaveBeenCalledTimes(1);
    });

    it("should handle deletion with Outlook credential", async () => {
      const credential = buildCredential({
        type: "office365_calendar",
        appId: "office365-calendar",
      });
      const calendarEvent = buildCalendarEvent();

      await deleteEvent({
        credential,
        bookingRefUid: "outlook-event-uid",
        event: calendarEvent,
      });

      expect(mockCalendar.deleteEvent).toHaveBeenCalledTimes(1);
    });

    it("should handle deletion with Apple Calendar credential", async () => {
      const credential = buildCredential({
        type: "apple_calendar",
        appId: "apple-calendar",
      });
      const calendarEvent = buildCalendarEvent();

      await deleteEvent({
        credential,
        bookingRefUid: "apple-event-uid",
        event: calendarEvent,
      });

      expect(mockCalendar.deleteEvent).toHaveBeenCalledTimes(1);
    });
  });

  // =========================================================================
  // Phase 4: Inbound Pipeline — Availability Reading
  // =========================================================================
  describe("Inbound Pipeline — Availability Reading", () => {
    const dateFrom = "2024-01-15T00:00:00Z";
    const dateTo = "2024-01-15T23:59:59Z";

    it("should fetch busy times from external calendars for availability check", async () => {
      mockGetCalendarsEvents.mockResolvedValue([
        [{ start: "2024-01-15T10:00:00Z", end: "2024-01-15T11:00:00Z", source: "google_calendar" }],
      ]);

      const credential = buildCredential();
      const selectedCalendar = buildSelectedCalendar();

      const result = await getBusyCalendarTimes([credential], dateFrom, dateTo, [selectedCalendar]);

      // Verify inbound pipeline: external calendar → busy time aggregation
      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
      expect(result.data[0]).toMatchObject({
        start: "2024-01-15T10:00:00Z",
        end: "2024-01-15T11:00:00Z",
        source: "google_calendar",
      });
    });

    it("should aggregate busy times from multiple connected calendars", async () => {
      mockGetCalendarsEvents.mockResolvedValue([
        [{ start: "2024-01-15T10:00:00Z", end: "2024-01-15T11:00:00Z" }],
        [{ start: "2024-01-15T14:00:00Z", end: "2024-01-15T15:00:00Z" }],
      ]);

      const credential = buildCredential();
      const selectedCalendar = buildSelectedCalendar();

      const result = await getBusyCalendarTimes([credential], dateFrom, dateTo, [selectedCalendar]);

      // All busy times should be flattened into a single array
      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2);
    });

    it("should use timezone-aware fetching for Google Calendar when includeTimeZone is true", async () => {
      mockGetCalendarsEventsWithTimezones.mockResolvedValue([
        [{ start: "2024-01-15T10:00:00Z", end: "2024-01-15T11:00:00Z", timeZone: "America/New_York" }],
      ]);

      const credential = buildCredential();
      const selectedCalendar = buildSelectedCalendar();

      await getBusyCalendarTimes([credential], dateFrom, dateTo, [selectedCalendar], undefined, true);

      // When includeTimeZone is true, the timezone-aware variant should be called
      expect(mockGetCalendarsEventsWithTimezones).toHaveBeenCalled();
      expect(mockGetCalendarsEvents).not.toHaveBeenCalled();
    });

    it("should use standard fetching when includeTimeZone is false or undefined", async () => {
      const credential = buildCredential();
      const selectedCalendar = buildSelectedCalendar();

      await getBusyCalendarTimes([credential], dateFrom, dateTo, [selectedCalendar], undefined, false);

      expect(mockGetCalendarsEvents).toHaveBeenCalled();
      expect(mockGetCalendarsEventsWithTimezones).not.toHaveBeenCalled();
    });

    it("should handle empty credentials array and return empty data", async () => {
      const result = await getBusyCalendarTimes([], dateFrom, dateTo, []);

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(0);
    });

    it("should return all-day event busy times correctly", async () => {
      mockGetCalendarsEvents.mockResolvedValue([
        [{ start: "2024-01-15T00:00:00Z", end: "2024-01-16T00:00:00Z", source: "google_calendar" }],
      ]);

      const credential = buildCredential();
      const selectedCalendar = buildSelectedCalendar();

      const result = await getBusyCalendarTimes([credential], dateFrom, dateTo, [selectedCalendar]);

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
      expect(result.data[0]).toMatchObject({
        start: "2024-01-15T00:00:00Z",
        end: "2024-01-16T00:00:00Z",
      });
    });

    it("should include recurring event instances in busy time aggregation", async () => {
      mockGetCalendarsEvents.mockResolvedValue([
        [
          { start: "2024-01-15T10:00:00Z", end: "2024-01-15T11:00:00Z", source: "google_calendar" },
          { start: "2024-01-22T10:00:00Z", end: "2024-01-22T11:00:00Z", source: "google_calendar" },
        ],
      ]);

      const credential = buildCredential();
      const selectedCalendar = buildSelectedCalendar();

      const result = await getBusyCalendarTimes([credential], dateFrom, dateTo, [selectedCalendar]);

      // All recurring event instances should be included in the flat result
      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2);
    });
  });

  // =========================================================================
  // Phase 5: Error Resilience
  // =========================================================================
  describe("Error Resilience", () => {
    const dateFrom = "2024-01-15T00:00:00Z";
    const dateTo = "2024-01-15T23:59:59Z";

    it("should return success:false with error placeholder when adapter throws during busy time fetch", async () => {
      mockGetCalendarsEvents.mockRejectedValue(new Error("API Error"));

      const credential = buildCredential();
      const selectedCalendar = buildSelectedCalendar();

      const result = await getBusyCalendarTimes([credential], dateFrom, dateTo, [selectedCalendar]);

      expect(result.success).toBe(false);
      expect(result.data).toHaveLength(1);
      expect(result.data[0].source).toBe("error-placeholder");
    });

    it("should return success:false on createEvent when adapter throws with code 500", async () => {
      mockCalendar.createEvent.mockRejectedValue({ code: 500, calError: "Server error" });

      const credential = buildCredential();
      const calendarEvent = buildCalendarEvent();

      const result = await createEvent(credential, calendarEvent);

      expect(result.success).toBe(false);
    });

    it("should handle 404 error on createEvent gracefully", async () => {
      mockCalendar.createEvent.mockRejectedValue({ code: 404, calError: "Not found" });

      const credential = buildCredential();
      const calendarEvent = buildCalendarEvent();

      const result = await createEvent(credential, calendarEvent);

      expect(result.success).toBe(false);
      // 404 error returns undefined createdEvent (calendar externalId mismatch)
      expect(result.createdEvent).toBeUndefined();
    });

    it("should capture calError message on createEvent failure", async () => {
      mockCalendar.createEvent.mockRejectedValue({ code: 500, calError: "Server error occurred" });

      const credential = buildCredential();
      const calendarEvent = buildCalendarEvent();

      const result = await createEvent(credential, calendarEvent);

      expect(result.success).toBe(false);
      expect(result.calError).toBe("Server error occurred");
    });

    it("should return success:false on updateEvent when adapter throws", async () => {
      mockCalendar.updateEvent.mockRejectedValue({ calError: "Update failed" });

      const credential = buildCredential();
      const calendarEvent = buildCalendarEvent();

      const result = await updateEvent(credential, calendarEvent, "external-event-uid-123", null);

      expect(result.success).toBe(false);
      expect(result.calError).toBe("Update failed");
    });

    it("should still return result with credential info on createEvent failure", async () => {
      mockCalendar.createEvent.mockRejectedValue({ code: 500, calError: "Error" });

      const credential = buildCredential({ id: 77, type: "google_calendar" });
      const calendarEvent = buildCalendarEvent();

      const result = await createEvent(credential, calendarEvent);

      // Even on failure, the result should include credential metadata
      expect(result.credentialId).toBe(77);
      expect(result.type).toBe("google_calendar");
      expect(result.uid).toBe("test-uid-123");
    });
  });

  // =========================================================================
  // processEvent enrichment verification
  // =========================================================================
  describe("processEvent enrichment", () => {
    it("should add calendarDescription to the event via getRichDescription", () => {
      const calendarEvent = buildCalendarEvent();

      const result = processEvent(calendarEvent);

      expect(result.calendarDescription).toBe("Test rich description");
    });

    it("should preserve original event data while adding calendarDescription", () => {
      const calendarEvent = buildCalendarEvent({ title: "My Special Event" });

      const result = processEvent(calendarEvent);

      expect(result.title).toBe("My Special Event");
      expect(result.calendarDescription).toBe("Test rich description");
      expect(result.organizer.email).toBe("organizer@example.com");
    });

    it("should clear responses, additionalNotes, and customInputs for seated events", () => {
      const calendarEvent = buildCalendarEvent({
        seatsPerTimeSlot: 5,
        responses: { field1: { label: "Field 1", value: "test" } } as CalendarEvent["responses"],
        additionalNotes: "Some notes",
        customInputs: { input1: "value1" } as CalendarEvent["customInputs"],
        userFieldsResponses: { field1: { label: "Field 1", value: "test" } } as CalendarEvent["userFieldsResponses"],
      });

      const result = processEvent(calendarEvent);

      expect(result.responses).toBeNull();
      expect(result.userFieldsResponses).toBeNull();
      expect(result.additionalNotes).toBeNull();
      expect(result.customInputs).toBeNull();
    });

    it("should clear attendees when hideOrganizerEmail is true and no Zoho destination", () => {
      const calendarEvent = buildCalendarEvent({
        hideOrganizerEmail: true,
        destinationCalendar: [
          { integration: "google_calendar", externalId: "calendar-1" },
        ] as CalendarEvent["destinationCalendar"],
      });

      const result = processEvent(calendarEvent);

      expect(result.attendees).toEqual([]);
    });

    it("should preserve attendees when hideOrganizerEmail is false", () => {
      const calendarEvent = buildCalendarEvent({
        hideOrganizerEmail: false,
      });

      const result = processEvent(calendarEvent);

      expect(result.attendees).toHaveLength(1);
      expect(result.attendees[0].email).toBe("attendee1@example.com");
    });
  });
});
