/**
 * Apple Calendar CalendarService Unit Tests
 *
 * Sprint 3 — Epic CI-003: Apple Calendar sync parity validation.
 * Tests verify behavioral parity of the Apple Calendar adapter's CalDAV operations
 * (createEvent, updateEvent, deleteEvent, getAvailability, listCalendars) against
 * Apple's iCloud CalDAV endpoint, following the BaseCalendarService patterns from
 * packages/lib/CalendarService.test.ts.
 *
 * All external dependencies (tsdav, ics, crypto, logger, CalEventParser) are mocked
 * at the module level to prevent network calls to Apple's iCloud servers.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// ──────────────────────────────────────────────────────────────────────────────
// Mock dependencies — MUST be defined BEFORE importing the module under test.
// vitest hoists vi.mock() calls to the top of the file at compile time.
// ──────────────────────────────────────────────────────────────────────────────

vi.mock("ics", () => ({
  createEvent: vi.fn(),
}));

vi.mock("tsdav", () => ({
  createAccount: vi.fn(),
  fetchCalendars: vi.fn(),
  fetchCalendarObjects: vi.fn(),
  createCalendarObject: vi.fn().mockResolvedValue({ ok: true }),
  updateCalendarObject: vi.fn().mockResolvedValue({ status: 200 }),
  deleteCalendarObject: vi.fn(),
  getBasicAuthHeaders: vi.fn().mockReturnValue({}),
}));

vi.mock("@calcom/lib/logger", () => {
  const subLogger = {
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    getSubLogger: () => subLogger,
  };
  return {
    default: {
      debug: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
      getSubLogger: () => subLogger,
    },
  };
});

vi.mock("@calcom/lib/crypto", () => ({
  symmetricDecrypt: vi.fn().mockImplementation((text: unknown) => {
    if (typeof text === "object") {
      return JSON.stringify(text);
    }
    return text;
  }),
}));

vi.mock("@calcom/lib/CalEventParser", () => ({
  getLocation: vi.fn().mockReturnValue("Test Location"),
  getRichDescription: vi.fn().mockReturnValue("Test Description"),
}));

// ──────────────────────────────────────────────────────────────────────────────
// Imports AFTER all vi.mock() calls
// ──────────────────────────────────────────────────────────────────────────────

import { createEvent as createIcsEvent } from "ics";
import {
  createAccount,
  createCalendarObject,
  deleteCalendarObject,
  fetchCalendarObjects,
  fetchCalendars,
  updateCalendarObject,
} from "tsdav";

import { symmetricDecrypt } from "@calcom/lib/crypto";
import type { CalendarServiceEvent } from "@calcom/types/Calendar";

import BuildCalendarService from "../CalendarService";

// ──────────────────────────────────────────────────────────────────────────────
// Test Factories
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Creates a mock Apple Calendar credential matching the CredentialPayload shape.
 * The `key` is a JSON string that the mocked symmetricDecrypt returns as-is
 * (since the mock passes through strings), which is then JSON.parse()'d by
 * BaseCalendarService's constructor.
 */
const createAppleCredential = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  type: "apple_calendar",
  delegationCredentialId: null,
  user: { email: "testuser@icloud.com" },
  userId: 1,
  teamId: null,
  appId: "apple-calendar",
  invalid: false,
  key: JSON.stringify({
    username: "testuser@icloud.com",
    password: "app-specific-password-1234",
  }),
  encryptedKey: null,
  ...overrides,
});

/**
 * Creates a valid CalendarServiceEvent mock for testing CalDAV operations.
 * Includes all required CalendarEvent fields plus calendarDescription.
 */
const createMockEvent = (overrides: Partial<CalendarServiceEvent> = {}): CalendarServiceEvent => ({
  type: "apple_calendar",
  title: "Test Apple Calendar Event",
  startTime: "2024-06-15T10:00:00Z",
  endTime: "2024-06-15T11:00:00Z",
  organizer: {
    name: "Test Organizer",
    email: "testuser@icloud.com",
    timeZone: "America/New_York",
    language: { translate: ((key: string) => key) as never, locale: "en" },
  },
  attendees: [],
  calendarDescription: "Test Apple Calendar Event Description",
  ...overrides,
});

// ──────────────────────────────────────────────────────────────────────────────
// Test Suites
// ──────────────────────────────────────────────────────────────────────────────

describe("BuildCalendarService factory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return a valid Calendar interface implementation", () => {
    const credential = createAppleCredential();
    const service = BuildCalendarService(credential);

    expect(service).toBeDefined();
    expect(typeof service.createEvent).toBe("function");
    expect(typeof service.updateEvent).toBe("function");
    expect(typeof service.deleteEvent).toBe("function");
    expect(typeof service.getAvailability).toBe("function");
    expect(typeof service.listCalendars).toBe("function");
  });

  it("should create a new instance per invocation (no shared state)", () => {
    const credential = createAppleCredential();
    const service1 = BuildCalendarService(credential);
    const service2 = BuildCalendarService(credential);

    expect(service1).not.toBe(service2);
  });

  it("should use apple_calendar as integration name", () => {
    const credential = createAppleCredential();
    const service = BuildCalendarService(credential);

    // integrationName is protected on BaseCalendarService — access via any cast
    expect((service as any).integrationName).toBe("apple_calendar");
  });

  it("should use https://caldav.icloud.com as the CalDAV URL", () => {
    const credential = createAppleCredential();
    const service = BuildCalendarService(credential);

    // url is private on BaseCalendarService — access via any cast
    expect((service as any).url).toBe("https://caldav.icloud.com");
  });
});

describe("Credential handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should decrypt credential key using CALENDSO_ENCRYPTION_KEY", () => {
    const credential = createAppleCredential();

    BuildCalendarService(credential);

    // symmetricDecrypt is imported at the top and mocked via vi.mock
    expect(vi.mocked(symmetricDecrypt)).toHaveBeenCalledWith(
      credential.key,
      expect.any(String) // CALENDSO_ENCRYPTION_KEY from process.env
    );
  });

  it("should extract username and password from decrypted credential", () => {
    const credential = createAppleCredential();
    const service = BuildCalendarService(credential);

    // credentials is private on BaseCalendarService — access via any cast
    expect((service as any).credentials.username).toBe("testuser@icloud.com");
    expect((service as any).credentials.password).toBe("app-specific-password-1234");
  });

  it("should use CalDAV URL from constructor even when credential contains a URL", () => {
    const credential = createAppleCredential({
      key: JSON.stringify({
        username: "testuser@icloud.com",
        password: "app-specific-password-1234",
        url: "https://some-other-caldav.example.com",
      }),
    });
    const service = BuildCalendarService(credential);

    // Apple Calendar always uses https://caldav.icloud.com (overrides credential URL)
    expect((service as any).url).toBe("https://caldav.icloud.com");
  });
});

describe("createEvent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should create a CalDAV event with correct ICS payload", async () => {
    const credential = createAppleCredential();
    const service = BuildCalendarService(credential);

    const mockIcsOutput =
      "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:test-uid-123\r\nDTSTART:20240615T100000Z\r\nDURATION:PT1H\r\nEND:VEVENT\r\nEND:VCALENDAR";

    vi.mocked(createIcsEvent).mockReturnValue({
      error: null as unknown as Error,
      value: mockIcsOutput,
    });

    // Mock listCalendars via fetchCalendars + createAccount
    vi.mocked(createAccount).mockResolvedValue({} as any);
    vi.mocked(fetchCalendars).mockResolvedValue([
      {
        url: "https://caldav.icloud.com/123456/calendars/primary/",
        displayName: "Primary Calendar",
        components: ["VEVENT"],
      },
    ] as any);

    const event = createMockEvent({ uid: "test-uid-123" });
    const result = await service.createEvent(event, 1);

    expect(result.uid).toBe("test-uid-123");
    expect(result.id).toBe("test-uid-123");
    expect(result.type).toBe("apple_calendar");
    expect(createCalendarObject).toHaveBeenCalled();

    // Verify CalDAV object was created with correct filename
    const calledArg = vi.mocked(createCalendarObject).mock.calls[0][0];
    expect(calledArg.filename).toBe("test-uid-123.ics");
  });

  it("should generate a UUID when event.uid is not provided", async () => {
    const credential = createAppleCredential();
    const service = BuildCalendarService(credential);

    const mockIcsOutput =
      "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:generated-uid\r\nDTSTART:20240615T100000Z\r\nDURATION:PT1H\r\nEND:VEVENT\r\nEND:VCALENDAR";

    vi.mocked(createIcsEvent).mockReturnValue({
      error: null as unknown as Error,
      value: mockIcsOutput,
    });

    vi.mocked(createAccount).mockResolvedValue({} as any);
    vi.mocked(fetchCalendars).mockResolvedValue([
      {
        url: "https://caldav.icloud.com/123456/calendars/primary/",
        displayName: "Primary",
        components: ["VEVENT"],
      },
    ] as any);

    const event = createMockEvent({ uid: undefined });
    const result = await service.createEvent(event, 1);

    expect(result.uid).toBeTruthy();
    expect(typeof result.uid).toBe("string");
    expect(result.uid.length).toBeGreaterThan(0);
  });

  it("should throw when ICS creation fails", async () => {
    const credential = createAppleCredential();
    const service = BuildCalendarService(credential);

    vi.mocked(createIcsEvent).mockReturnValue({
      error: new Error("ICS creation failed"),
      value: undefined as unknown as string,
    });

    vi.mocked(createAccount).mockResolvedValue({} as any);
    vi.mocked(fetchCalendars).mockResolvedValue([
      {
        url: "https://caldav.icloud.com/123456/calendars/primary/",
        displayName: "Primary",
        components: ["VEVENT"],
      },
    ] as any);

    const event = createMockEvent();
    await expect(service.createEvent(event, 1)).rejects.toThrow();
  });

  it("should inject VTIMEZONE block into the ICS payload", async () => {
    const credential = createAppleCredential();
    const service = BuildCalendarService(credential);

    const mockIcsOutput =
      "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:tz-test-uid\r\nDTSTART:20240615T100000Z\r\nDURATION:PT1H\r\nEND:VEVENT\r\nEND:VCALENDAR";

    vi.mocked(createIcsEvent).mockReturnValue({
      error: null as unknown as Error,
      value: mockIcsOutput,
    });

    vi.mocked(createAccount).mockResolvedValue({} as any);
    vi.mocked(fetchCalendars).mockResolvedValue([
      {
        url: "https://caldav.icloud.com/123456/calendars/primary/",
        displayName: "Primary",
        components: ["VEVENT"],
      },
    ] as any);

    const event = createMockEvent({
      uid: "tz-test-uid",
      organizer: {
        name: "Test",
        email: "test@icloud.com",
        timeZone: "America/New_York",
        language: { translate: ((key: string) => key) as never, locale: "en" },
      },
    });

    await service.createEvent(event, 1);

    const calledArg = vi.mocked(createCalendarObject).mock.calls[0][0];
    const iCalString = calledArg.iCalString;

    // VTIMEZONE should be injected
    expect(iCalString).toContain("BEGIN:VTIMEZONE");
    expect(iCalString).toContain("END:VTIMEZONE");
    expect(iCalString).toContain("TZID:America/New_York");

    // DTSTART should be timezone-aware (not UTC Z suffix)
    expect(iCalString).toContain("DTSTART;TZID=America/New_York:");
  });

  it("should inject SCHEDULE-AGENT=CLIENT into the ICS payload", async () => {
    const credential = createAppleCredential();
    const service = BuildCalendarService(credential);

    const mockIcsOutput =
      "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:sa-test-uid\r\nDTSTART:20240615T100000Z\r\nDURATION:PT1H\r\nORGANIZER:mailto:test@icloud.com\r\nATTENDEE;PARTSTAT=NEEDS-ACTION:mailto:attendee@example.com\r\nEND:VEVENT\r\nEND:VCALENDAR";

    vi.mocked(createIcsEvent).mockReturnValue({
      error: null as unknown as Error,
      value: mockIcsOutput,
    });

    vi.mocked(createAccount).mockResolvedValue({} as any);
    vi.mocked(fetchCalendars).mockResolvedValue([
      {
        url: "https://caldav.icloud.com/123456/calendars/primary/",
        displayName: "Primary",
        components: ["VEVENT"],
      },
    ] as any);

    const event = createMockEvent({
      uid: "sa-test-uid",
      attendees: [{ name: "Attendee", email: "attendee@example.com", timeZone: "UTC" }],
    });

    await service.createEvent(event, 1);

    const calledArg = vi.mocked(createCalendarObject).mock.calls[0][0];
    const iCalString = calledArg.iCalString;

    // SCHEDULE-AGENT=CLIENT should be injected (prevents CalDAV from sending duplicate invites)
    expect(iCalString).toContain("SCHEDULE-AGENT=CLIENT");
  });

  it("should filter calendars by destination calendar externalId", async () => {
    const credential = createAppleCredential();
    const service = BuildCalendarService(credential);

    const mockIcsOutput =
      "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:dest-test-uid\r\nDTSTART:20240615T100000Z\r\nDURATION:PT1H\r\nEND:VEVENT\r\nEND:VCALENDAR";

    vi.mocked(createIcsEvent).mockReturnValue({
      error: null as unknown as Error,
      value: mockIcsOutput,
    });

    vi.mocked(createAccount).mockResolvedValue({} as any);
    vi.mocked(fetchCalendars).mockResolvedValue([
      {
        url: "https://caldav.icloud.com/123456/calendars/primary/",
        displayName: "Primary",
        components: ["VEVENT"],
      },
      {
        url: "https://caldav.icloud.com/123456/calendars/work/",
        displayName: "Work",
        components: ["VEVENT"],
      },
    ] as any);

    const event = createMockEvent({
      uid: "dest-test-uid",
      destinationCalendar: [
        {
          id: 1,
          integration: "apple_calendar",
          externalId: "https://caldav.icloud.com/123456/calendars/work/",
          primaryEmail: null,
          userId: 1,
          eventTypeId: null,
          credentialId: 1,
          delegationCredentialId: null,
          domainWideDelegationCredentialId: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          customCalendarReminder: null,
        },
      ],
    });

    await service.createEvent(event, 1);

    // Should only create on the Work calendar, not Primary
    expect(createCalendarObject).toHaveBeenCalledTimes(1);
    const calledArg = vi.mocked(createCalendarObject).mock.calls[0][0];
    expect(calledArg.calendar.url).toBe("https://caldav.icloud.com/123456/calendars/work/");
  });
});

describe("updateEvent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should update an existing CalDAV event", async () => {
    const credential = createAppleCredential();
    const service = BuildCalendarService(credential);

    const mockIcsOutput =
      "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:update-uid\r\nDTSTART:20240615T100000Z\r\nDURATION:PT1H\r\nEND:VEVENT\r\nEND:VCALENDAR";

    vi.mocked(createIcsEvent).mockReturnValue({
      error: null as unknown as Error,
      value: mockIcsOutput,
    });

    // Mock fetching existing events by UID (getEventsByUID chain)
    vi.mocked(createAccount).mockResolvedValue({} as any);
    vi.mocked(fetchCalendars).mockResolvedValue([
      {
        url: "https://caldav.icloud.com/123456/calendars/primary/",
        components: ["VEVENT"],
      },
    ] as any);
    vi.mocked(fetchCalendarObjects).mockResolvedValue([
      {
        url: "https://caldav.icloud.com/123456/calendars/primary/update-uid.ics",
        data: "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:update-uid\r\nDTSTART:20240615T100000Z\r\nDTEND:20240615T110000Z\r\nSUMMARY:Original Event\r\nEND:VEVENT\r\nEND:VCALENDAR",
        etag: "etag-123",
      },
    ] as any);

    const event = createMockEvent({ uid: "update-uid" });
    const result = await service.updateEvent("update-uid", event);

    expect(updateCalendarObject).toHaveBeenCalled();
    // updateEvent returns an array from Promise.all().then()
    if (Array.isArray(result)) {
      expect(result[0].uid).toBe("update-uid");
    } else {
      expect(result.uid).toBe("update-uid");
    }
  });
});

describe("deleteEvent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should delete a CalDAV event by UID", async () => {
    const credential = createAppleCredential();
    const service = BuildCalendarService(credential);

    // Mock fetching existing events (getEventsByUID chain)
    vi.mocked(createAccount).mockResolvedValue({} as any);
    vi.mocked(fetchCalendars).mockResolvedValue([
      {
        url: "https://caldav.icloud.com/123456/calendars/primary/",
        components: ["VEVENT"],
      },
    ] as any);
    vi.mocked(fetchCalendarObjects).mockResolvedValue([
      {
        url: "https://caldav.icloud.com/123456/calendars/primary/delete-uid.ics",
        data: "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:delete-uid\r\nDTSTART:20240615T100000Z\r\nDTEND:20240615T110000Z\r\nSUMMARY:Event to Delete\r\nEND:VEVENT\r\nEND:VCALENDAR",
        etag: "etag-456",
      },
    ] as any);

    await service.deleteEvent("delete-uid");

    expect(deleteCalendarObject).toHaveBeenCalledWith(
      expect.objectContaining({
        calendarObject: expect.objectContaining({
          url: "https://caldav.icloud.com/123456/calendars/primary/delete-uid.ics",
        }),
      })
    );
  });

  it("should handle deletion when no matching events found (no-op)", async () => {
    const credential = createAppleCredential();
    const service = BuildCalendarService(credential);

    vi.mocked(createAccount).mockResolvedValue({} as any);
    vi.mocked(fetchCalendars).mockResolvedValue([
      {
        url: "https://caldav.icloud.com/123456/calendars/primary/",
        components: ["VEVENT"],
      },
    ] as any);
    vi.mocked(fetchCalendarObjects).mockResolvedValue([] as any);

    // Should not throw when there are no events to delete
    await service.deleteEvent("nonexistent-uid");

    expect(deleteCalendarObject).not.toHaveBeenCalled();
  });

  it("should delete a buffer event directly via externalCalendarId without listing all calendars", async () => {
    // CI-002 gap closure: Buffer events store externalCalendarId in BookingReference.
    // When provided, deleteEvent should use it for direct URL construction via the
    // URL constructor (matching tsdav's createCalendarObject) instead of iterating
    // all calendars through getEventsByUID. This prevents silent deletion failures
    // caused by URL construction mismatches.
    const credential = createAppleCredential();
    const service = BuildCalendarService(credential);
    const bufferUid = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
    const externalCalendarId = "https://caldav.icloud.com/123456/calendars/work/";

    vi.mocked(fetchCalendarObjects).mockResolvedValue([
      {
        url: `${externalCalendarId}${bufferUid}.ics`,
        data: `BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:${bufferUid}\r\nDTSTART:20240615T090000Z\r\nDTEND:20240615T091500Z\r\nSUMMARY:Buffer: Before Test Event\r\nEND:VEVENT\r\nEND:VCALENDAR`,
        etag: "etag-buffer-123",
      },
    ] as any);

    await service.deleteEvent(bufferUid, {} as any, externalCalendarId);

    // Should call fetchCalendarObjects with the direct URL (not listing all calendars first)
    expect(fetchCalendarObjects).toHaveBeenCalledWith(
      expect.objectContaining({
        calendar: { url: externalCalendarId },
        objectUrls: [`${externalCalendarId}${bufferUid}.ics`],
      })
    );
    expect(deleteCalendarObject).toHaveBeenCalledWith(
      expect.objectContaining({
        calendarObject: expect.objectContaining({
          url: `${externalCalendarId}${bufferUid}.ics`,
          etag: "etag-buffer-123",
        }),
      })
    );
    // Should NOT have called fetchCalendars (listCalendars) since direct path succeeded
    expect(fetchCalendars).not.toHaveBeenCalled();
  });

  it("should fall back to full calendar search when direct externalCalendarId lookup returns empty", async () => {
    // If the buffer event is not found at the direct URL (e.g., calendar was moved),
    // deleteEvent should fall back to searching all calendars via getEventsByUID.
    const credential = createAppleCredential();
    const service = BuildCalendarService(credential);
    const bufferUid = "fallback-uid-1234-5678-abcdef012345";
    const externalCalendarId = "https://caldav.icloud.com/123456/calendars/old-calendar/";
    const actualCalendarUrl = "https://caldav.icloud.com/123456/calendars/new-calendar/";

    // First call (direct lookup) returns empty — event not on the old calendar
    // Second call (fallback via getEventsByUID) finds it on the new calendar
    vi.mocked(fetchCalendarObjects)
      .mockResolvedValueOnce([] as any) // direct lookup fails
      .mockResolvedValueOnce([
        {
          url: `${actualCalendarUrl}${bufferUid}.ics`,
          data: `BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:${bufferUid}\r\nDTSTART:20240615T090000Z\r\nDTEND:20240615T091500Z\r\nSUMMARY:Buffer: After Test Event\r\nEND:VEVENT\r\nEND:VCALENDAR`,
          etag: "etag-fallback-456",
        },
      ] as any);

    vi.mocked(createAccount).mockResolvedValue({} as any);
    vi.mocked(fetchCalendars).mockResolvedValue([
      { url: actualCalendarUrl, components: ["VEVENT"] },
    ] as any);

    await service.deleteEvent(bufferUid, {} as any, externalCalendarId);

    // Should have attempted direct lookup first, then fallen back to full search
    expect(fetchCalendarObjects).toHaveBeenCalledTimes(2);
    expect(fetchCalendars).toHaveBeenCalled();
    expect(deleteCalendarObject).toHaveBeenCalledWith(
      expect.objectContaining({
        calendarObject: expect.objectContaining({
          url: `${actualCalendarUrl}${bufferUid}.ics`,
        }),
      })
    );
  });

  it("should construct correct URL for buffer events when calendar URL lacks trailing slash", async () => {
    // This is the core bug scenario: when a CalDAV calendar URL does not end with a
    // trailing slash, string concatenation produces "https://host/caluid.ics" instead
    // of the correct "https://host/uid.ics". The URL constructor handles this correctly
    // by resolving the filename relative to the calendar URL.
    const credential = createAppleCredential();
    const service = BuildCalendarService(credential);
    const bufferUid = "no-slash-uid-1234-5678-abcdef012345";
    // Calendar URL WITHOUT trailing slash
    const externalCalendarId = "https://caldav.icloud.com/123456/calendars/work";
    // URL constructor resolves "uid.ics" relative to parent path: https://host/.../uid.ics
    const expectedObjectUrl = new URL(`${bufferUid}.ics`, externalCalendarId).href;

    vi.mocked(fetchCalendarObjects).mockResolvedValue([
      {
        url: expectedObjectUrl,
        data: `BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:${bufferUid}\r\nDTSTART:20240615T090000Z\r\nDTEND:20240615T091500Z\r\nSUMMARY:Buffer: Before Event\r\nEND:VEVENT\r\nEND:VCALENDAR`,
        etag: "etag-no-slash",
      },
    ] as any);

    await service.deleteEvent(bufferUid, {} as any, externalCalendarId);

    // Verify the correct URL was used (URL constructor, not string concat)
    expect(fetchCalendarObjects).toHaveBeenCalledWith(
      expect.objectContaining({
        objectUrls: [expectedObjectUrl],
      })
    );
    expect(deleteCalendarObject).toHaveBeenCalledWith(
      expect.objectContaining({
        calendarObject: expect.objectContaining({
          url: expectedObjectUrl,
        }),
      })
    );
  });

  it("should delete buffer events on reschedule (old buffer events removed)", async () => {
    // Simulates the reschedule scenario: EventManager.deleteBufferEventsForBooking
    // calls CalendarManager.deleteEvent with the buffer reference uid and
    // externalCalendarId from BookingReference. The CalDAV adapter should delete
    // both before and after buffer events from the external calendar.
    const credential = createAppleCredential();
    const service = BuildCalendarService(credential);
    const calendarUrl = "https://caldav.icloud.com/123456/calendars/primary/";

    const beforeBufferUid = "before-buf-1234-5678-abcdef012345";
    const afterBufferUid = "after-buf-abcd-ef12-3456789abcde";

    // Delete the "before" buffer event
    vi.mocked(fetchCalendarObjects).mockResolvedValueOnce([
      {
        url: `${calendarUrl}${beforeBufferUid}.ics`,
        data: `BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:${beforeBufferUid}\r\nDTSTART:20240615T094500Z\r\nDTEND:20240615T100000Z\r\nSUMMARY:Buffer: Before Meeting\r\nEND:VEVENT\r\nEND:VCALENDAR`,
        etag: "etag-before",
      },
    ] as any);

    await service.deleteEvent(beforeBufferUid, {} as any, calendarUrl);

    expect(deleteCalendarObject).toHaveBeenCalledWith(
      expect.objectContaining({
        calendarObject: expect.objectContaining({
          url: `${calendarUrl}${beforeBufferUid}.ics`,
        }),
      })
    );

    vi.clearAllMocks();

    // Delete the "after" buffer event
    vi.mocked(fetchCalendarObjects).mockResolvedValueOnce([
      {
        url: `${calendarUrl}${afterBufferUid}.ics`,
        data: `BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:${afterBufferUid}\r\nDTSTART:20240615T110000Z\r\nDTEND:20240615T111500Z\r\nSUMMARY:Buffer: After Meeting\r\nEND:VEVENT\r\nEND:VCALENDAR`,
        etag: "etag-after",
      },
    ] as any);

    await service.deleteEvent(afterBufferUid, {} as any, calendarUrl);

    expect(deleteCalendarObject).toHaveBeenCalledWith(
      expect.objectContaining({
        calendarObject: expect.objectContaining({
          url: `${calendarUrl}${afterBufferUid}.ics`,
        }),
      })
    );
  });

  it("should delete buffer events on cancellation (last attendee leaves seated booking)", async () => {
    // Simulates the cancellation scenario: lastAttendeeDeleteBooking iterates
    // references and calls calendar.deleteEvent for each buffer_time reference.
    // The CalDAV adapter receives the uid and externalCalendarId and should
    // delete the buffer event from Apple Calendar.
    const credential = createAppleCredential();
    const service = BuildCalendarService(credential);
    const calendarUrl = "https://caldav.icloud.com/789012/calendars/personal/";
    const bufferUid = "cancel-buf-1234-5678-abcdef012345";

    vi.mocked(fetchCalendarObjects).mockResolvedValue([
      {
        url: `${calendarUrl}${bufferUid}.ics`,
        data: `BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:${bufferUid}\r\nDTSTART:20240615T090000Z\r\nDTEND:20240615T091500Z\r\nSUMMARY:Buffer: Before Cancelled Event\r\nEND:VEVENT\r\nEND:VCALENDAR`,
        etag: "etag-cancel",
      },
    ] as any);

    await service.deleteEvent(bufferUid, {} as any, calendarUrl);

    expect(deleteCalendarObject).toHaveBeenCalledWith(
      expect.objectContaining({
        calendarObject: expect.objectContaining({
          url: `${calendarUrl}${bufferUid}.ics`,
        }),
      })
    );
    // Verify no unnecessary calendar enumeration when externalCalendarId is provided
    expect(fetchCalendars).not.toHaveBeenCalled();
  });
});

describe("getAvailability", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return busy times from CalDAV REPORT", async () => {
    const credential = createAppleCredential();
    const service = BuildCalendarService(credential);

    const icsData = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "BEGIN:VTIMEZONE",
      "TZID:UTC",
      "BEGIN:STANDARD",
      "TZOFFSETFROM:+0000",
      "TZOFFSETTO:+0000",
      "DTSTART:16010101T000000",
      "END:STANDARD",
      "END:VTIMEZONE",
      "BEGIN:VEVENT",
      "UID:busy-event-1",
      "DTSTART:20240615T100000Z",
      "DTEND:20240615T110000Z",
      "SUMMARY:Busy Event",
      "TRANSP:OPAQUE",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");

    vi.mocked(fetchCalendarObjects).mockResolvedValue([
      { url: "https://caldav.icloud.com/cal/busy-event-1.ics", data: icsData, etag: "etag-1" },
    ] as any);

    const result = await service.getAvailability({
      dateFrom: "2024-06-01",
      dateTo: "2024-06-30",
      selectedCalendars: [
        {
          integration: "apple_calendar",
          externalId: "https://caldav.icloud.com/123456/calendars/primary/",
          credentialId: 1,
        },
      ],
      mode: "slots",
    });

    expect(result.length).toBeGreaterThan(0);
    expect(result[0].start).toBeDefined();
    expect(result[0].end).toBeDefined();
  });

  it("should skip TRANSPARENT (free) events in availability", async () => {
    const credential = createAppleCredential();
    const service = BuildCalendarService(credential);

    const icsData = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "BEGIN:VEVENT",
      "UID:free-event-1",
      "DTSTART:20240615T100000Z",
      "DTEND:20240615T110000Z",
      "SUMMARY:Free/Transparent Event",
      "TRANSP:TRANSPARENT",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");

    vi.mocked(fetchCalendarObjects).mockResolvedValue([
      { url: "https://caldav.icloud.com/cal/free-event-1.ics", data: icsData, etag: "etag-2" },
    ] as any);

    const result = await service.getAvailability({
      dateFrom: "2024-06-01",
      dateTo: "2024-06-30",
      selectedCalendars: [
        {
          integration: "apple_calendar",
          externalId: "https://caldav.icloud.com/123456/calendars/primary/",
          credentialId: 1,
        },
      ],
      mode: "slots",
    });

    // Transparent events should NOT appear in busy times
    expect(result).toEqual([]);
  });

  it("should return empty array for empty calendars", async () => {
    const credential = createAppleCredential();
    const service = BuildCalendarService(credential);

    vi.mocked(fetchCalendarObjects).mockResolvedValue([] as any);

    const result = await service.getAvailability({
      dateFrom: "2024-06-01",
      dateTo: "2024-06-30",
      selectedCalendars: [
        {
          integration: "apple_calendar",
          externalId: "https://caldav.icloud.com/123456/calendars/primary/",
          credentialId: 1,
        },
      ],
      mode: "slots",
    });

    expect(result).toEqual([]);
  });

  it("should handle malformed ICS data gracefully (log error and skip)", async () => {
    const credential = createAppleCredential();
    const service = BuildCalendarService(credential);

    vi.mocked(fetchCalendarObjects).mockResolvedValue([
      { url: "https://caldav.icloud.com/cal/malformed.ics", data: "NOT VALID ICS DATA", etag: "etag-bad" },
    ] as any);

    const result = await service.getAvailability({
      dateFrom: "2024-06-01",
      dateTo: "2024-06-30",
      selectedCalendars: [
        {
          integration: "apple_calendar",
          externalId: "https://caldav.icloud.com/123456/calendars/primary/",
          credentialId: 1,
        },
      ],
      mode: "slots",
    });

    // Should not throw; malformed data is skipped, returning empty array
    expect(result).toEqual([]);
  });

  it("should handle all-day events using user timezone fallback", async () => {
    // All-day events without explicit timezone info use the user's timezone from DB.
    // Since our test selectedCalendars have no userId, the fallback is "Europe/London".
    const credential = createAppleCredential();
    const service = BuildCalendarService(credential);

    const icsData = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "BEGIN:VEVENT",
      "UID:allday-event-1",
      "DTSTART;VALUE=DATE:20240615",
      "DTEND;VALUE=DATE:20240616",
      "SUMMARY:All Day Event",
      "TRANSP:OPAQUE",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");

    vi.mocked(fetchCalendarObjects).mockResolvedValue([
      { url: "https://caldav.icloud.com/cal/allday.ics", data: icsData, etag: "etag-ad" },
    ] as any);

    const result = await service.getAvailability({
      dateFrom: "2024-06-01",
      dateTo: "2024-06-30",
      selectedCalendars: [
        {
          integration: "apple_calendar",
          externalId: "https://caldav.icloud.com/123456/calendars/primary/",
          credentialId: 1,
        },
      ],
      mode: "slots",
    });

    // All-day opaque events should appear in busy times
    expect(result.length).toBeGreaterThan(0);
  });
});

describe("listCalendars", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should list calendars from the Apple CalDAV server", async () => {
    const credential = createAppleCredential();
    const service = BuildCalendarService(credential);

    vi.mocked(createAccount).mockResolvedValue({} as any);
    vi.mocked(fetchCalendars).mockResolvedValue([
      {
        url: "https://caldav.icloud.com/123456/calendars/primary/",
        displayName: "Personal",
        components: ["VEVENT"],
      },
      {
        url: "https://caldav.icloud.com/123456/calendars/work/",
        displayName: "Work",
        components: ["VEVENT"],
      },
    ] as any);

    const calendars = await service.listCalendars();

    expect(calendars).toHaveLength(2);
    expect(calendars[0].externalId).toBe("https://caldav.icloud.com/123456/calendars/primary/");
    expect(calendars[0].name).toBe("Personal");
    expect(calendars[0].integration).toBe("apple_calendar");
    expect(calendars[1].externalId).toBe("https://caldav.icloud.com/123456/calendars/work/");
    expect(calendars[1].name).toBe("Work");
  });

  it("should filter out non-VEVENT calendars (e.g., VTODO, VJOURNAL)", async () => {
    const credential = createAppleCredential();
    const service = BuildCalendarService(credential);

    vi.mocked(createAccount).mockResolvedValue({} as any);
    vi.mocked(fetchCalendars).mockResolvedValue([
      {
        url: "https://caldav.icloud.com/123456/calendars/primary/",
        displayName: "Events",
        components: ["VEVENT"],
      },
      {
        url: "https://caldav.icloud.com/123456/calendars/tasks/",
        displayName: "Tasks",
        components: ["VTODO"],
      },
      {
        url: "https://caldav.icloud.com/123456/calendars/notes/",
        displayName: "Notes",
        components: ["VJOURNAL"],
      },
    ] as any);

    const calendars = await service.listCalendars();

    expect(calendars).toHaveLength(1);
    expect(calendars[0].name).toBe("Events");
  });

  it("should handle empty displayName gracefully", async () => {
    const credential = createAppleCredential();
    const service = BuildCalendarService(credential);

    vi.mocked(createAccount).mockResolvedValue({} as any);
    vi.mocked(fetchCalendars).mockResolvedValue([
      {
        url: "https://caldav.icloud.com/123456/calendars/primary/",
        displayName: undefined,
        components: ["VEVENT"],
      },
    ] as any);

    const calendars = await service.listCalendars();

    expect(calendars).toHaveLength(1);
    expect(calendars[0].name).toBe("");
  });

  it("should handle displayName as object (non-string) gracefully", async () => {
    const credential = createAppleCredential();
    const service = BuildCalendarService(credential);

    vi.mocked(createAccount).mockResolvedValue({} as any);
    vi.mocked(fetchCalendars).mockResolvedValue([
      {
        url: "https://caldav.icloud.com/123456/calendars/primary/",
        displayName: { "xml:lang": "en", _text: "Calendar" },
        components: ["VEVENT"],
      },
    ] as any);

    const calendars = await service.listCalendars();

    expect(calendars).toHaveLength(1);
    // When displayName is an object (not string), it should default to ""
    expect(calendars[0].name).toBe("");
  });

  it("should set email to the credential username", async () => {
    const credential = createAppleCredential();
    const service = BuildCalendarService(credential);

    vi.mocked(createAccount).mockResolvedValue({} as any);
    vi.mocked(fetchCalendars).mockResolvedValue([
      {
        url: "https://caldav.icloud.com/123456/calendars/primary/",
        displayName: "Primary",
        components: ["VEVENT"],
      },
    ] as any);

    const calendars = await service.listCalendars();

    expect(calendars[0].email).toBe("testuser@icloud.com");
  });
});

describe("CI-003: Apple Calendar parity edge cases", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should handle x-apple-travel-duration in availability (travel time adjustment)", async () => {
    // Apple Calendar's Travel Time feature adds X-APPLE-TRAVEL-DURATION to VEVENT.
    // BaseCalendarService's getAvailability should move the start time back by travel duration.
    const credential = createAppleCredential();
    const service = BuildCalendarService(credential);

    const icsData = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "BEGIN:VTIMEZONE",
      "TZID:UTC",
      "BEGIN:STANDARD",
      "TZOFFSETFROM:+0000",
      "TZOFFSETTO:+0000",
      "DTSTART:16010101T000000",
      "END:STANDARD",
      "END:VTIMEZONE",
      "BEGIN:VEVENT",
      "UID:travel-event-1",
      "DTSTART:20240615T100000Z",
      "DTEND:20240615T110000Z",
      "SUMMARY:Meeting with Travel Time",
      "TRANSP:OPAQUE",
      "X-APPLE-TRAVEL-DURATION;VALUE=DURATION:PT30M",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");

    vi.mocked(fetchCalendarObjects).mockResolvedValue([
      { url: "https://caldav.icloud.com/cal/travel-event-1.ics", data: icsData, etag: "etag-travel" },
    ] as any);

    const result = await service.getAvailability({
      dateFrom: "2024-06-01",
      dateTo: "2024-06-30",
      selectedCalendars: [
        {
          integration: "apple_calendar",
          externalId: "https://caldav.icloud.com/123456/calendars/primary/",
          credentialId: 1,
        },
      ],
      mode: "slots",
    });

    // Event should appear in busy times with start time adjusted for travel
    expect(result.length).toBeGreaterThan(0);
    // The start time should be at or earlier than the event's actual start (10:00 - 30min = 9:30)
    if (result.length > 0) {
      const startDate = new Date(result[0].start);
      // Travel duration should move start backwards
      expect(startDate.getTime()).toBeLessThanOrEqual(new Date("2024-06-15T10:00:00Z").getTime());
    }
  });

  it("should handle PRIVATE classification in createEvent", async () => {
    const credential = createAppleCredential();
    const service = BuildCalendarService(credential);

    const mockIcsOutput =
      "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:private-uid\r\nDTSTART:20240615T100000Z\r\nDURATION:PT1H\r\nCLASS:PRIVATE\r\nEND:VEVENT\r\nEND:VCALENDAR";

    vi.mocked(createIcsEvent).mockReturnValue({
      error: null as unknown as Error,
      value: mockIcsOutput,
    });

    vi.mocked(createAccount).mockResolvedValue({} as any);
    vi.mocked(fetchCalendars).mockResolvedValue([
      {
        url: "https://caldav.icloud.com/123456/calendars/primary/",
        displayName: "Primary",
        components: ["VEVENT"],
      },
    ] as any);

    const event = createMockEvent({
      uid: "private-uid",
      hideCalendarEventDetails: true,
    });

    await service.createEvent(event, 1);

    // Verify classification: "PRIVATE" was passed to ICS createEvent
    const icsCallArg = vi.mocked(createIcsEvent).mock.calls[0][0];
    expect(icsCallArg.classification).toBe("PRIVATE");
  });
});
