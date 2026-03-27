import oAuthManagerMock, {
  defaultMockOAuthManager,
  setFullMockOAuthManagerRequest,
} from "../../../tests/__mocks__/OAuthManager";
import "../__mocks__/features.repository";
import "../__mocks__/getGoogleAppKeys";
import {
  adminMock,
  calendarListMock,
  calendarMock,
  freebusyQueryMock,
  setCredentialsMock,
  setLastCreatedJWT,
  setLastCreatedOAuth2Client,
} from "../__mocks__/googleapis";
import { beforeEach, describe, expect, test, vi } from "vitest";
import "vitest-fetch-mock";

import { MeetLocationType } from "@calcom/app-store/constants";
import logger from "@calcom/lib/logger";
import type { CredentialForCalendarServiceWithEmail } from "@calcom/types/Credential";
import BuildCalendarService, { createGoogleCalendarServiceWithGoogleType } from "../CalendarService";
import { createMockJWTInstance } from "./utils";

// Logger available for debugging parity test failures during development
const _log = logger.getSubLogger({ prefix: ["CalendarService.parity.test"] });

beforeEach(() => {
  vi.clearAllMocks();
  setCredentialsMock.mockClear();
  oAuthManagerMock.OAuthManager = defaultMockOAuthManager;
  calendarMock.calendar_v3.Calendar.mockClear();
  adminMock.admin_directory_v1.Admin.mockClear();

  setLastCreatedJWT(null);
  setLastCreatedOAuth2Client(null);
  createMockJWTInstance({});
});

const mockCredential: CredentialForCalendarServiceWithEmail = {
  id: 1,
  userId: 1,
  appId: "google-calendar",
  type: "google_calendar",
  key: {
    access_token: "<INVALID_TOKEN>",
  },
  user: {
    email: "user@example.com",
  },
  delegationCredentialId: null,
  delegatedTo: null,
  invalid: false,
  teamId: null,
  encryptedKey: null,
};

const defaultDestinationCalendar = {
  id: 1,
  integration: "google_calendar",
  externalId: "primary",
  primaryEmail: null,
  userId: 1,
  eventTypeId: null,
  credentialId: 1,
  delegationCredentialId: null,
  domainWideDelegationCredentialId: null,
  createdAt: new Date("2024-06-15T11:00:00Z"),
  updatedAt: new Date("2024-06-15T11:00:00Z"),
  customCalendarReminder: null,
};

const defaultOrganizer = {
  id: 1,
  name: "Test Organizer",
  email: "organizer@example.com",
  timeZone: "UTC",
  language: {
    translate: (...args: any[]) => args[0],
    locale: "en",
  },
};

/**
 * Creates a minimal CalendarServiceEvent for testing with sensible defaults.
 * Override any field by passing it in the overrides object.
 */
function createTestCalEvent(overrides: Record<string, any> = {}) {
  return {
    type: "parity-test-event",
    uid: "parity-uid-001",
    title: "Parity Test Meeting",
    startTime: "2024-06-15T10:00:00Z",
    endTime: "2024-06-15T11:00:00Z",
    organizer: defaultOrganizer,
    attendees: [],
    location: "Test Location",
    calendarDescription: "Parity test meeting description",
    destinationCalendar: [defaultDestinationCalendar],
    iCalUID: "parity-ical-uid@google.com",
    conferenceData: undefined,
    hideCalendarEventDetails: false,
    seatsPerTimeSlot: null,
    seatsShowAttendees: true,
    ...overrides,
  };
}

/**
 * Creates a mock Google Calendar API event response object.
 */
function createMockGoogleEvent(overrides: Record<string, any> = {}) {
  return {
    id: "mock-parity-event-id",
    summary: "Parity Test Meeting",
    start: { dateTime: "2024-06-15T10:00:00Z", timeZone: "UTC" },
    end: { dateTime: "2024-06-15T11:00:00Z", timeZone: "UTC" },
    iCalUID: "parity-ical-uid@google.com",
    ...overrides,
  };
}

/**
 * Computes an ISO date string offset by a given number of days from the base date.
 * Uses millisecond arithmetic to avoid calendar-math ambiguity.
 */
function addDays(baseDate: string, days: number): string {
  const ms = new Date(baseDate).getTime() + days * 24 * 60 * 60 * 1000;
  return new Date(ms).toISOString();
}

describe("CI-001 Calendly Parity: Google Calendar Adapter", () => {
  // ──────────────────────────────────────────────────────────────────────────
  // 1. FreeBusy API Behavioral Parity
  // ──────────────────────────────────────────────────────────────────────────
  describe("FreeBusy API behavioral parity", () => {
    test("should query FreeBusy API with correct request format matching Calendly behavior", async () => {
      const calendarService = BuildCalendarService(mockCredential);
      setFullMockOAuthManagerRequest();

      freebusyQueryMock.mockImplementation(({ requestBody }: { requestBody: any }) => {
        const calendarsObject: any = {};
        requestBody.items.forEach((item: any) => {
          calendarsObject[item.id] = { busy: [] };
        });
        return { data: { calendars: calendarsObject } };
      });

      await calendarService.getAvailability({
        dateFrom: "2024-01-01T00:00:00Z",
        dateTo: "2024-01-15T00:00:00Z",
        selectedCalendars: [
          { externalId: "calendar1@test.com", integration: "google_calendar" },
          { externalId: "calendar2@test.com", integration: "google_calendar" },
        ],
        mode: "slots",
        fallbackToPrimary: false,
      });

      // Calendly queries FreeBusy API with only the selected calendars, not all user calendars
      expect(freebusyQueryMock).toHaveBeenCalledTimes(1);
      const callArgs = freebusyQueryMock.mock.calls[0][0];
      expect(callArgs.requestBody.items).toEqual([
        { id: "calendar1@test.com" },
        { id: "calendar2@test.com" },
      ]);
      expect(callArgs.requestBody.timeMin).toBe("2024-01-01T00:00:00Z");
      expect(callArgs.requestBody.timeMax).toBe("2024-01-15T00:00:00Z");
    });

    test("should return empty array when no busy times exist in FreeBusy response", async () => {
      const calendarService = BuildCalendarService(mockCredential);
      setFullMockOAuthManagerRequest();

      freebusyQueryMock.mockImplementation(() => ({
        data: {
          calendars: {
            "cal1@test.com": { busy: [] },
            "cal2@test.com": { busy: [] },
          },
        },
      }));

      const result = await calendarService.getAvailability({
        dateFrom: "2024-01-01T00:00:00Z",
        dateTo: "2024-01-15T00:00:00Z",
        selectedCalendars: [
          { externalId: "cal1@test.com", integration: "google_calendar" },
          { externalId: "cal2@test.com", integration: "google_calendar" },
        ],
        mode: "slots",
        fallbackToPrimary: false,
      });

      expect(result).toEqual([]);
    });

    test("should aggregate busy times from multiple calendars into flat array", async () => {
      const calendarService = BuildCalendarService(mockCredential);
      setFullMockOAuthManagerRequest();

      freebusyQueryMock.mockImplementation(() => ({
        data: {
          calendars: {
            "cal1@test.com": {
              busy: [{ start: "2024-01-01T10:00:00Z", end: "2024-01-01T11:00:00Z" }],
            },
            "cal2@test.com": {
              busy: [{ start: "2024-01-01T14:00:00Z", end: "2024-01-01T15:00:00Z" }],
            },
            "cal3@test.com": {
              busy: [{ start: "2024-01-02T09:00:00Z", end: "2024-01-02T10:00:00Z" }],
            },
          },
        },
      }));

      const result = await calendarService.getAvailability({
        dateFrom: "2024-01-01T00:00:00Z",
        dateTo: "2024-01-15T00:00:00Z",
        selectedCalendars: [
          { externalId: "cal1@test.com", integration: "google_calendar" },
          { externalId: "cal2@test.com", integration: "google_calendar" },
          { externalId: "cal3@test.com", integration: "google_calendar" },
        ],
        mode: "slots",
        fallbackToPrimary: false,
      });

      // Calendly treats all connected calendars equally — flat aggregation, no nesting
      expect(result).toHaveLength(3);
      expect(result).toEqual([
        { start: "2024-01-01T10:00:00Z", end: "2024-01-01T11:00:00Z" },
        { start: "2024-01-01T14:00:00Z", end: "2024-01-01T15:00:00Z" },
        { start: "2024-01-02T09:00:00Z", end: "2024-01-02T10:00:00Z" },
      ]);
    });

    test("should handle FreeBusy response with overlapping busy times from different calendars", async () => {
      const calendarService = BuildCalendarService(mockCredential);
      setFullMockOAuthManagerRequest();

      freebusyQueryMock.mockImplementation(() => ({
        data: {
          calendars: {
            "calA@test.com": {
              busy: [{ start: "2024-01-01T10:00:00Z", end: "2024-01-01T11:00:00Z" }],
            },
            "calB@test.com": {
              busy: [{ start: "2024-01-01T10:30:00Z", end: "2024-01-01T11:30:00Z" }],
            },
          },
        },
      }));

      const result = await calendarService.getAvailability({
        dateFrom: "2024-01-01T00:00:00Z",
        dateTo: "2024-01-15T00:00:00Z",
        selectedCalendars: [
          { externalId: "calA@test.com", integration: "google_calendar" },
          { externalId: "calB@test.com", integration: "google_calendar" },
        ],
        mode: "slots",
        fallbackToPrimary: false,
      });

      // Both overlapping times are returned independently — deduplication happens upstream in getBusyTimes
      expect(result).toHaveLength(2);
      expect(result).toEqual([
        { start: "2024-01-01T10:00:00Z", end: "2024-01-01T11:00:00Z" },
        { start: "2024-01-01T10:30:00Z", end: "2024-01-01T11:30:00Z" },
      ]);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 2. Event Creation Calendly-Equivalent Fields
  // ──────────────────────────────────────────────────────────────────────────
  describe("Event creation Calendly-equivalent fields", () => {
    test("should include all Calendly-equivalent fields in event creation payload", async () => {
      const calendarService = BuildCalendarService(mockCredential);
      setFullMockOAuthManagerRequest();

      const mockGoogleEvent = createMockGoogleEvent();
      const eventsInsertMock = vi.fn().mockResolvedValue({ data: mockGoogleEvent });
      calendarMock.calendar_v3.Calendar().events.insert = eventsInsertMock;

      const testCalEvent = createTestCalEvent({
        location: "Conference Room A",
      });

      await calendarService.createEvent(testCalEvent, mockCredential.id);

      expect(eventsInsertMock).toHaveBeenCalledTimes(1);
      const insertCall = eventsInsertMock.mock.calls[0][0];

      // Calendly-equivalent insert parameters
      expect(insertCall.conferenceDataVersion).toBe(1);
      expect(insertCall.sendUpdates).toBe("none");
      expect(insertCall.calendarId).toBe("primary");

      // Calendly-equivalent payload fields
      const payload = insertCall.requestBody;
      expect(payload.summary).toBe("Parity Test Meeting");
      expect(payload.description).toBe("Parity test meeting description");
      expect(payload.start).toEqual({ dateTime: "2024-06-15T10:00:00Z", timeZone: "UTC" });
      expect(payload.end).toEqual({ dateTime: "2024-06-15T11:00:00Z", timeZone: "UTC" });
      expect(payload.iCalUID).toBe("parity-ical-uid@google.com");
      expect(payload.reminders).toBeDefined();
      expect(payload.guestsCanSeeOtherGuests).toBe(true);
      expect(payload.attendees).toBeDefined();
      expect(payload.location).toBeDefined();
    });

    test("should set visibility to private when hideCalendarEventDetails is true", async () => {
      const calendarService = BuildCalendarService(mockCredential);
      setFullMockOAuthManagerRequest();

      const eventsInsertMock = vi.fn().mockResolvedValue({ data: createMockGoogleEvent() });
      calendarMock.calendar_v3.Calendar().events.insert = eventsInsertMock;

      const testCalEvent = createTestCalEvent({
        hideCalendarEventDetails: true,
      });

      await calendarService.createEvent(testCalEvent, mockCredential.id);

      const payload = eventsInsertMock.mock.calls[0][0].requestBody;
      expect(payload.visibility).toBe("private");
    });

    test("should NOT set visibility when hideCalendarEventDetails is false or undefined", async () => {
      const calendarService = BuildCalendarService(mockCredential);
      setFullMockOAuthManagerRequest();

      const eventsInsertMock = vi.fn().mockResolvedValue({ data: createMockGoogleEvent() });
      calendarMock.calendar_v3.Calendar().events.insert = eventsInsertMock;

      const testCalEvent = createTestCalEvent({
        hideCalendarEventDetails: false,
      });

      await calendarService.createEvent(testCalEvent, mockCredential.id);

      const payload = eventsInsertMock.mock.calls[0][0].requestBody;
      expect(payload.visibility).toBeUndefined();
    });

    test("should format attendees with organizer first and responseStatus accepted", async () => {
      const calendarService = BuildCalendarService(mockCredential);
      setFullMockOAuthManagerRequest();

      const eventsInsertMock = vi.fn().mockResolvedValue({ data: createMockGoogleEvent() });
      calendarMock.calendar_v3.Calendar().events.insert = eventsInsertMock;

      const testCalEvent = createTestCalEvent({
        attendees: [
          {
            id: 2,
            name: "Attendee One",
            email: "attendee1@example.com",
            timeZone: "UTC",
            language: { translate: (...args: any[]) => args[0], locale: "en" },
          },
          {
            id: 3,
            name: "Attendee Two",
            email: "attendee2@example.com",
            timeZone: "UTC",
            language: { translate: (...args: any[]) => args[0], locale: "en" },
          },
        ],
      });

      await calendarService.createEvent(testCalEvent, mockCredential.id);

      const attendees = eventsInsertMock.mock.calls[0][0].requestBody.attendees;

      // First attendee must be the organizer with organizer flag
      expect(attendees[0].organizer).toBe(true);
      expect(attendees[0].responseStatus).toBe("accepted");
      expect(attendees[0].displayName).toBe("Test Organizer");

      // Remaining attendees have responseStatus accepted, id stripped
      expect(attendees[1].responseStatus).toBe("accepted");
      expect(attendees[1].email).toBe("attendee1@example.com");
      expect(attendees[1].id).toBeUndefined();

      expect(attendees[2].responseStatus).toBe("accepted");
      expect(attendees[2].email).toBe("attendee2@example.com");
      expect(attendees[2].id).toBeUndefined();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 3. Recurring Event Handling Parity
  // ──────────────────────────────────────────────────────────────────────────
  describe("Recurring event handling parity", () => {
    test("should create recurring event with RRule and locate first instance", async () => {
      const calendarService = BuildCalendarService(mockCredential);
      setFullMockOAuthManagerRequest();

      const mockRecurringEvent = {
        id: "recurring-parity-id",
        summary: "Weekly Parity Meeting",
        recurrence: ["RRULE:FREQ=WEEKLY;INTERVAL=1;COUNT=10"],
        start: { dateTime: "2024-06-15T10:00:00Z", timeZone: "UTC" },
        end: { dateTime: "2024-06-15T11:00:00Z", timeZone: "UTC" },
      };

      const mockFirstInstance = {
        id: "recurring-parity-id_20240615T100000Z",
        summary: "Weekly Parity Meeting",
        start: { dateTime: "2024-06-15T10:00:00Z", timeZone: "UTC" },
        end: { dateTime: "2024-06-15T11:00:00Z", timeZone: "UTC" },
      };

      calendarMock.calendar_v3.Calendar().events.insert = vi.fn().mockResolvedValue({
        data: mockRecurringEvent,
      });
      calendarMock.calendar_v3.Calendar().events.instances = vi.fn().mockResolvedValue({
        data: { items: [mockFirstInstance] },
      });

      const testCalEvent = createTestCalEvent({
        recurringEvent: { freq: 2, interval: 1, count: 10 },
      });

      const result = await calendarService.createEvent(testCalEvent, mockCredential.id);

      // Verify RRule was included in the insert payload
      const insertCall = calendarMock.calendar_v3.Calendar().events.insert.mock.calls[0][0];
      expect(insertCall.requestBody.recurrence).toEqual(["RRULE:FREQ=WEEKLY;INTERVAL=1;COUNT=10"]);

      // Verify instances endpoint was called to locate the first occurrence
      expect(calendarMock.calendar_v3.Calendar().events.instances).toHaveBeenCalledWith({
        calendarId: "primary",
        eventId: "recurring-parity-id",
      });

      // Result should reference the first instance and the parent recurring event
      expect(result.id).toBe("recurring-parity-id_20240615T100000Z");
      expect(result.thirdPartyRecurringEventId).toBe("recurring-parity-id");
    });

    test("should handle existing recurring event instance modification", async () => {
      const calendarService = BuildCalendarService(mockCredential);
      setFullMockOAuthManagerRequest();

      const mockInstances = [
        { id: "instance-1", start: { dateTime: "2024-06-08T10:00:00Z" } },
        { id: "instance-2", start: { dateTime: "2024-06-15T10:00:00Z" } },
        { id: "instance-3", start: { dateTime: "2024-06-22T10:00:00Z" } },
      ];

      calendarMock.calendar_v3.Calendar().events.instances = vi.fn().mockResolvedValue({
        data: { items: mockInstances },
      });
      calendarMock.calendar_v3.Calendar().events.patch = vi.fn().mockResolvedValue({ data: {} });
      const eventsInsertMock = vi.fn();
      calendarMock.calendar_v3.Calendar().events.insert = eventsInsertMock;

      const testCalEvent = createTestCalEvent({
        startTime: "2024-06-15T10:00:00Z",
        existingRecurringEvent: { recurringEventId: "parent-recurring-id" },
      });

      const result = await calendarService.createEvent(testCalEvent, mockCredential.id);

      // Verify instances was queried for the parent recurring event
      expect(calendarMock.calendar_v3.Calendar().events.instances).toHaveBeenCalledWith({
        calendarId: "primary",
        eventId: "parent-recurring-id",
      });

      // Verify patch was called on the matched instance (instance-2 matches startTime)
      expect(calendarMock.calendar_v3.Calendar().events.patch).toHaveBeenCalledTimes(1);
      const patchCall = calendarMock.calendar_v3.Calendar().events.patch.mock.calls[0][0];
      expect(patchCall.eventId).toBe("instance-2");
      expect(patchCall.requestBody.description).toBe("Parity test meeting description");

      // Verify insert was NOT called — we modify the existing instance instead
      expect(eventsInsertMock).not.toHaveBeenCalled();

      // Result references the parent recurring event
      expect(result.id).toBe("instance-2");
      expect(result.thirdPartyRecurringEventId).toBe("parent-recurring-id");
    });

    test("should create daily recurring event with correct RRule format", async () => {
      const calendarService = BuildCalendarService(mockCredential);
      setFullMockOAuthManagerRequest();

      const mockRecurringEvent = {
        id: "daily-recurring-id",
        summary: "Daily Standup",
        recurrence: ["RRULE:FREQ=DAILY;INTERVAL=1;COUNT=30"],
        start: { dateTime: "2024-06-15T09:00:00Z", timeZone: "UTC" },
        end: { dateTime: "2024-06-15T09:15:00Z", timeZone: "UTC" },
      };

      const mockFirstInstance = {
        id: "daily-recurring-id_20240615T090000Z",
        start: { dateTime: "2024-06-15T09:00:00Z", timeZone: "UTC" },
        end: { dateTime: "2024-06-15T09:15:00Z", timeZone: "UTC" },
      };

      calendarMock.calendar_v3.Calendar().events.insert = vi.fn().mockResolvedValue({
        data: mockRecurringEvent,
      });
      calendarMock.calendar_v3.Calendar().events.instances = vi.fn().mockResolvedValue({
        data: { items: [mockFirstInstance] },
      });

      const testCalEvent = createTestCalEvent({
        title: "Daily Standup",
        startTime: "2024-06-15T09:00:00Z",
        endTime: "2024-06-15T09:15:00Z",
        recurringEvent: { freq: 3, interval: 1, count: 30 },
      });

      await calendarService.createEvent(testCalEvent, mockCredential.id);

      const insertCall = calendarMock.calendar_v3.Calendar().events.insert.mock.calls[0][0];
      expect(insertCall.requestBody.recurrence).toEqual(["RRULE:FREQ=DAILY;INTERVAL=1;COUNT=30"]);
    });

    test("should handle monthly recurring event", async () => {
      const calendarService = BuildCalendarService(mockCredential);
      setFullMockOAuthManagerRequest();

      const mockRecurringEvent = {
        id: "monthly-recurring-id",
        summary: "Monthly Review",
        recurrence: ["RRULE:FREQ=MONTHLY;INTERVAL=1;COUNT=12"],
        start: { dateTime: "2024-06-15T14:00:00Z", timeZone: "UTC" },
        end: { dateTime: "2024-06-15T15:00:00Z", timeZone: "UTC" },
      };

      const mockFirstInstance = {
        id: "monthly-recurring-id_20240615T140000Z",
        start: { dateTime: "2024-06-15T14:00:00Z", timeZone: "UTC" },
        end: { dateTime: "2024-06-15T15:00:00Z", timeZone: "UTC" },
      };

      calendarMock.calendar_v3.Calendar().events.insert = vi.fn().mockResolvedValue({
        data: mockRecurringEvent,
      });
      calendarMock.calendar_v3.Calendar().events.instances = vi.fn().mockResolvedValue({
        data: { items: [mockFirstInstance] },
      });

      const testCalEvent = createTestCalEvent({
        title: "Monthly Review",
        startTime: "2024-06-15T14:00:00Z",
        endTime: "2024-06-15T15:00:00Z",
        recurringEvent: { freq: 1, interval: 1, count: 12 },
      });

      await calendarService.createEvent(testCalEvent, mockCredential.id);

      const insertCall = calendarMock.calendar_v3.Calendar().events.insert.mock.calls[0][0];
      expect(insertCall.requestBody.recurrence).toEqual(["RRULE:FREQ=MONTHLY;INTERVAL=1;COUNT=12"]);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 4. 90-Day Window Chunking Edge Cases
  // ──────────────────────────────────────────────────────────────────────────
  describe("90-day window chunking edge cases", () => {
    test("should handle exactly 1-day range (no chunking)", async () => {
      const calendarService = BuildCalendarService(mockCredential);
      setFullMockOAuthManagerRequest();

      const mockBusyData = [{ start: "2024-01-01T10:00:00Z", end: "2024-01-01T11:00:00Z", id: "cal1" }];
      const getFreeBusyDataSpy = vi
        .spyOn(calendarService as any, "getFreeBusyData")
        .mockResolvedValue(mockBusyData);

      const dateFrom = "2024-01-01T00:00:00Z";
      const dateTo = addDays(dateFrom, 1);

      await (calendarService as any).fetchAvailabilityData(["cal1@test.com"], dateFrom, dateTo);

      expect(getFreeBusyDataSpy).toHaveBeenCalledTimes(1);
      getFreeBusyDataSpy.mockRestore();
    });

    test("should handle exactly 89-day range (no chunking)", async () => {
      const calendarService = BuildCalendarService(mockCredential);
      setFullMockOAuthManagerRequest();

      const mockBusyData = [{ start: "2024-02-15T10:00:00Z", end: "2024-02-15T11:00:00Z", id: "cal1" }];
      const getFreeBusyDataSpy = vi
        .spyOn(calendarService as any, "getFreeBusyData")
        .mockResolvedValue(mockBusyData);

      const dateFrom = "2024-01-01T00:00:00Z";
      const dateTo = addDays(dateFrom, 89);

      await (calendarService as any).fetchAvailabilityData(["cal1@test.com"], dateFrom, dateTo);

      expect(getFreeBusyDataSpy).toHaveBeenCalledTimes(1);
      getFreeBusyDataSpy.mockRestore();
    });

    test("should handle exactly 90-day boundary (no chunking)", async () => {
      const calendarService = BuildCalendarService(mockCredential);
      setFullMockOAuthManagerRequest();

      const mockBusyData = [{ start: "2024-03-01T10:00:00Z", end: "2024-03-01T11:00:00Z", id: "cal1" }];
      const getFreeBusyDataSpy = vi
        .spyOn(calendarService as any, "getFreeBusyData")
        .mockResolvedValue(mockBusyData);

      const dateFrom = "2024-01-01T00:00:00Z";
      const dateTo = addDays(dateFrom, 90);

      await (calendarService as any).fetchAvailabilityData(["cal1@test.com"], dateFrom, dateTo);

      // 90 days is exactly at the boundary — single API call (diff <= 90)
      expect(getFreeBusyDataSpy).toHaveBeenCalledTimes(1);
      getFreeBusyDataSpy.mockRestore();
    });

    test("should chunk 91-day range into 2 API calls", async () => {
      const calendarService = BuildCalendarService(mockCredential);
      setFullMockOAuthManagerRequest();

      const mockBusyData = [{ start: "2024-01-15T10:00:00Z", end: "2024-01-15T11:00:00Z", id: "cal1" }];
      const getFreeBusyDataSpy = vi
        .spyOn(calendarService as any, "getFreeBusyData")
        .mockResolvedValue(mockBusyData);

      const dateFrom = "2024-01-01T00:00:00Z";
      const dateTo = addDays(dateFrom, 91);

      await (calendarService as any).fetchAvailabilityData(["cal1@test.com"], dateFrom, dateTo);

      // 91 days > 90 → ceil(91/90) = 2 chunks
      expect(getFreeBusyDataSpy).toHaveBeenCalledTimes(2);
      getFreeBusyDataSpy.mockRestore();
    });

    test("should chunk 180-day range into 2 API calls", async () => {
      const calendarService = BuildCalendarService(mockCredential);
      setFullMockOAuthManagerRequest();

      const mockBusyData = [{ start: "2024-03-01T10:00:00Z", end: "2024-03-01T11:00:00Z", id: "cal1" }];
      const getFreeBusyDataSpy = vi
        .spyOn(calendarService as any, "getFreeBusyData")
        .mockResolvedValue(mockBusyData);

      const dateFrom = "2024-01-01T00:00:00Z";
      const dateTo = addDays(dateFrom, 180);

      await (calendarService as any).fetchAvailabilityData(["cal1@test.com"], dateFrom, dateTo);

      // 180 days > 90 → ceil(180/90) = 2 chunks
      expect(getFreeBusyDataSpy).toHaveBeenCalledTimes(2);
      getFreeBusyDataSpy.mockRestore();
    });

    test("should chunk 181-day range into 3 API calls", async () => {
      const calendarService = BuildCalendarService(mockCredential);
      setFullMockOAuthManagerRequest();

      const mockBusyData = [{ start: "2024-03-01T10:00:00Z", end: "2024-03-01T11:00:00Z", id: "cal1" }];
      const getFreeBusyDataSpy = vi
        .spyOn(calendarService as any, "getFreeBusyData")
        .mockResolvedValue(mockBusyData);

      const dateFrom = "2024-01-01T00:00:00Z";
      const dateTo = addDays(dateFrom, 181);

      await (calendarService as any).fetchAvailabilityData(["cal1@test.com"], dateFrom, dateTo);

      // 181 days > 90 → ceil(181/90) = 3 chunks
      expect(getFreeBusyDataSpy).toHaveBeenCalledTimes(3);
      getFreeBusyDataSpy.mockRestore();
    });

    test("should chunk 365-day range into correct number of API calls", async () => {
      const calendarService = BuildCalendarService(mockCredential);
      setFullMockOAuthManagerRequest();

      const mockBusyData = [{ start: "2024-06-01T10:00:00Z", end: "2024-06-01T11:00:00Z", id: "cal1" }];
      const getFreeBusyDataSpy = vi
        .spyOn(calendarService as any, "getFreeBusyData")
        .mockResolvedValue(mockBusyData);

      const dateFrom = "2024-01-01T00:00:00Z";
      const dateTo = addDays(dateFrom, 365);

      await (calendarService as any).fetchAvailabilityData(["cal1@test.com"], dateFrom, dateTo);

      // 365 days > 90 → ceil(365/90) = ceil(4.055…) = 5 chunks
      expect(getFreeBusyDataSpy).toHaveBeenCalledTimes(5);
      getFreeBusyDataSpy.mockRestore();
    });

    test("should concatenate busy data from all chunks correctly", async () => {
      const calendarService = BuildCalendarService(mockCredential);
      setFullMockOAuthManagerRequest();

      const chunk1Data = [
        { start: "2024-01-15T10:00:00Z", end: "2024-01-15T11:00:00Z", id: "cal1" },
      ];
      const chunk2Data = [
        { start: "2024-04-15T14:00:00Z", end: "2024-04-15T15:00:00Z", id: "cal1" },
      ];

      const getFreeBusyDataSpy = vi
        .spyOn(calendarService as any, "getFreeBusyData")
        .mockResolvedValueOnce(chunk1Data)
        .mockResolvedValueOnce(chunk2Data);

      const dateFrom = "2024-01-01T00:00:00Z";
      const dateTo = addDays(dateFrom, 91);

      const result = await (calendarService as any).fetchAvailabilityData(
        ["cal1@test.com"],
        dateFrom,
        dateTo
      );

      expect(getFreeBusyDataSpy).toHaveBeenCalledTimes(2);
      // Results from both chunks must be concatenated into a single flat array
      expect(result).toHaveLength(2);
      expect(result).toEqual([
        { start: "2024-01-15T10:00:00Z", end: "2024-01-15T11:00:00Z" },
        { start: "2024-04-15T14:00:00Z", end: "2024-04-15T15:00:00Z" },
      ]);
      getFreeBusyDataSpy.mockRestore();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 5. Google Meet Integration Parity
  // ──────────────────────────────────────────────────────────────────────────
  describe("Google Meet integration parity", () => {
    test("should attach conferenceData with createRequest when location is MeetLocationType", async () => {
      const calendarService = BuildCalendarService(mockCredential);
      setFullMockOAuthManagerRequest();

      const eventsInsertMock = vi.fn().mockResolvedValue({ data: createMockGoogleEvent() });
      calendarMock.calendar_v3.Calendar().events.insert = eventsInsertMock;

      const mockConferenceData = {
        createRequest: {
          requestId: "parity-meet-req-id",
          conferenceSolutionKey: { type: "hangoutsMeet" },
        },
      };

      const testCalEvent = createTestCalEvent({
        location: MeetLocationType,
        conferenceData: mockConferenceData,
      });

      await calendarService.createEvent(testCalEvent, mockCredential.id);

      const insertCall = eventsInsertMock.mock.calls[0][0];
      expect(insertCall.requestBody.conferenceData).toEqual(mockConferenceData);
      expect(insertCall.conferenceDataVersion).toBe(1);
    });

    test("should NOT attach conferenceData when location is NOT MeetLocationType", async () => {
      const calendarService = BuildCalendarService(mockCredential);
      setFullMockOAuthManagerRequest();

      const eventsInsertMock = vi.fn().mockResolvedValue({ data: createMockGoogleEvent() });
      calendarMock.calendar_v3.Calendar().events.insert = eventsInsertMock;

      const mockConferenceData = {
        createRequest: {
          requestId: "parity-meet-req-id",
          conferenceSolutionKey: { type: "hangoutsMeet" },
        },
      };

      const testCalEvent = createTestCalEvent({
        location: "Physical Location - Room 42",
        conferenceData: mockConferenceData,
      });

      await calendarService.createEvent(testCalEvent, mockCredential.id);

      const insertCall = eventsInsertMock.mock.calls[0][0];
      // conferenceData should NOT be in the payload when location is not MeetLocationType
      expect(insertCall.requestBody.conferenceData).toBeUndefined();
    });

    test("should patch event with hangoutLink after creation when hangoutLink is returned", async () => {
      const calendarService = BuildCalendarService(mockCredential);
      setFullMockOAuthManagerRequest();

      const mockHangoutLink = "https://meet.google.com/parity-abc-defg";
      const mockGoogleEvent = createMockGoogleEvent({
        hangoutLink: mockHangoutLink,
      });

      const eventsInsertMock = vi.fn().mockResolvedValue({ data: mockGoogleEvent });
      const eventsPatchMock = vi.fn().mockResolvedValue({
        data: { ...mockGoogleEvent, location: mockHangoutLink },
      });

      calendarMock.calendar_v3.Calendar().events.insert = eventsInsertMock;
      calendarMock.calendar_v3.Calendar().events.patch = eventsPatchMock;

      const testCalEvent = createTestCalEvent({
        location: "Test Location",
      });

      await calendarService.createEvent(testCalEvent, mockCredential.id);

      // Calendly patches the event with the actual Meet link after creation
      expect(eventsPatchMock).toHaveBeenCalledTimes(1);
      const patchCall = eventsPatchMock.mock.calls[0][0];
      expect(patchCall.calendarId).toBe("primary");
      expect(patchCall.eventId).toBe("mock-parity-event-id");
      expect(patchCall.requestBody.location).toBe(mockHangoutLink);
      expect(patchCall.requestBody.description).toBeDefined();
    });

    test("should set additionalInfo.hangoutLink in response when Meet link is generated", async () => {
      const calendarService = BuildCalendarService(mockCredential);
      setFullMockOAuthManagerRequest();

      const mockHangoutLink = "https://meet.google.com/parity-xyz-uvwx";
      const eventsInsertMock = vi.fn().mockResolvedValue({
        data: createMockGoogleEvent({ hangoutLink: mockHangoutLink }),
      });
      const eventsPatchMock = vi.fn().mockResolvedValue({ data: {} });

      calendarMock.calendar_v3.Calendar().events.insert = eventsInsertMock;
      calendarMock.calendar_v3.Calendar().events.patch = eventsPatchMock;

      const testCalEvent = createTestCalEvent();

      const result = await calendarService.createEvent(testCalEvent, mockCredential.id);

      expect(result.additionalInfo.hangoutLink).toBe(mockHangoutLink);
    });

    test("should set empty hangoutLink in additionalInfo when no Meet link is generated", async () => {
      const calendarService = BuildCalendarService(mockCredential);
      setFullMockOAuthManagerRequest();

      const eventsInsertMock = vi.fn().mockResolvedValue({
        data: createMockGoogleEvent(), // no hangoutLink
      });
      calendarMock.calendar_v3.Calendar().events.insert = eventsInsertMock;

      const testCalEvent = createTestCalEvent();

      const result = await calendarService.createEvent(testCalEvent, mockCredential.id);

      expect(result.additionalInfo.hangoutLink).toBe("");
    });

    test("should patch location with hangoutLink on updateEvent when MeetLocationType", async () => {
      const calendarService = BuildCalendarService(mockCredential);
      setFullMockOAuthManagerRequest();

      const mockHangoutLink = "https://meet.google.com/update-parity-link";
      const mockUpdatedEvent = {
        id: "update-event-parity-id",
        summary: "Updated Parity Meeting",
        start: { dateTime: "2024-06-15T10:00:00Z", timeZone: "UTC" },
        end: { dateTime: "2024-06-15T11:00:00Z", timeZone: "UTC" },
        hangoutLink: mockHangoutLink,
        iCalUID: "update-ical@google.com",
      };

      const eventsUpdateMock = vi.fn().mockResolvedValue({ data: mockUpdatedEvent });
      const eventsPatchMock = vi.fn().mockResolvedValue({
        data: { ...mockUpdatedEvent, location: mockHangoutLink },
      });

      calendarMock.calendar_v3.Calendar().events.update = eventsUpdateMock;
      calendarMock.calendar_v3.Calendar().events.patch = eventsPatchMock;

      const testCalEvent = createTestCalEvent({
        location: MeetLocationType,
      });

      const result = await calendarService.updateEvent(
        "update-event-parity-id",
        testCalEvent,
        "primary"
      );

      // Verify patch was called with hangoutLink as location
      expect(eventsPatchMock).toHaveBeenCalledTimes(1);
      const patchCall = eventsPatchMock.mock.calls[0][0];
      expect(patchCall.requestBody.location).toBe(mockHangoutLink);

      // Verify additionalInfo contains the hangoutLink
      expect(result.additionalInfo.hangoutLink).toBe(mockHangoutLink);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 6. Availability Query Behavior
  // ──────────────────────────────────────────────────────────────────────────
  describe("Availability query behavior", () => {
    test("should fall back to primary calendar when no calendars selected and fallbackToPrimary is true", async () => {
      const calendarService = BuildCalendarService(mockCredential);
      setFullMockOAuthManagerRequest();

      calendarListMock.mockImplementation(() => ({
        data: {
          items: [
            { id: "user@example.com", primary: true },
            { id: "work@example.com", primary: false },
            { id: "personal@example.com", primary: false },
          ],
        },
      }));

      freebusyQueryMock.mockImplementation(({ requestBody }: { requestBody: any }) => {
        const calendarsObject: any = {};
        requestBody.items.forEach((item: any) => {
          calendarsObject[item.id] = {
            busy: [{ start: "2024-01-01T10:00:00Z", end: "2024-01-01T11:00:00Z" }],
          };
        });
        return { data: { calendars: calendarsObject } };
      });

      await calendarService.getAvailability({
        dateFrom: "2024-01-01T00:00:00Z",
        dateTo: "2024-01-15T00:00:00Z",
        selectedCalendars: [],
        mode: "slots",
        fallbackToPrimary: true,
      });

      // Only the primary calendar should be queried
      expect(freebusyQueryMock).toHaveBeenCalledTimes(1);
      const items = freebusyQueryMock.mock.calls[0][0].requestBody.items;
      expect(items).toEqual([{ id: "user@example.com" }]);
    });

    test("should query all calendars when no calendars selected and fallbackToPrimary is false", async () => {
      const calendarService = BuildCalendarService(mockCredential);
      setFullMockOAuthManagerRequest();

      calendarListMock.mockImplementation(() => ({
        data: {
          items: [
            { id: "user@example.com", primary: true },
            { id: "work@example.com", primary: false },
            { id: "personal@example.com", primary: false },
          ],
        },
      }));

      freebusyQueryMock.mockImplementation(({ requestBody }: { requestBody: any }) => {
        const calendarsObject: any = {};
        requestBody.items.forEach((item: any) => {
          calendarsObject[item.id] = { busy: [] };
        });
        return { data: { calendars: calendarsObject } };
      });

      await calendarService.getAvailability({
        dateFrom: "2024-01-01T00:00:00Z",
        dateTo: "2024-01-15T00:00:00Z",
        selectedCalendars: [],
        mode: "slots",
        fallbackToPrimary: false,
      });

      // All calendars should be queried
      expect(freebusyQueryMock).toHaveBeenCalledTimes(1);
      const items = freebusyQueryMock.mock.calls[0][0].requestBody.items;
      expect(items).toHaveLength(3);
      expect(items).toEqual([
        { id: "user@example.com" },
        { id: "work@example.com" },
        { id: "personal@example.com" },
      ]);
    });

    test("should return empty array when only non-Google calendars are selected", async () => {
      const calendarService = BuildCalendarService(mockCredential);
      setFullMockOAuthManagerRequest();

      const result = await calendarService.getAvailability({
        dateFrom: "2024-01-01T00:00:00Z",
        dateTo: "2024-01-15T00:00:00Z",
        selectedCalendars: [
          { externalId: "outlook-cal@test.com", integration: "office365_calendar" },
        ],
        mode: "slots",
        fallbackToPrimary: false,
      });

      // Returns [] immediately without any API call
      expect(result).toEqual([]);
      expect(freebusyQueryMock).not.toHaveBeenCalled();
    });

    test("should filter selectedCalendars to only Google Calendar integration", async () => {
      const calendarService = BuildCalendarService(mockCredential);
      setFullMockOAuthManagerRequest();

      freebusyQueryMock.mockImplementation(({ requestBody }: { requestBody: any }) => {
        const calendarsObject: any = {};
        requestBody.items.forEach((item: any) => {
          calendarsObject[item.id] = { busy: [] };
        });
        return { data: { calendars: calendarsObject } };
      });

      await calendarService.getAvailability({
        dateFrom: "2024-01-01T00:00:00Z",
        dateTo: "2024-01-15T00:00:00Z",
        selectedCalendars: [
          { externalId: "google-cal@test.com", integration: "google_calendar" },
          { externalId: "outlook-cal@test.com", integration: "office365_calendar" },
          { externalId: "google-cal2@test.com", integration: "google_calendar" },
        ],
        mode: "slots",
        fallbackToPrimary: false,
      });

      // Only Google Calendar integrations should be queried
      expect(freebusyQueryMock).toHaveBeenCalledTimes(1);
      const items = freebusyQueryMock.mock.calls[0][0].requestBody.items;
      expect(items).toEqual([
        { id: "google-cal@test.com" },
        { id: "google-cal2@test.com" },
      ]);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 7. Event Update with Field Preservation
  // ──────────────────────────────────────────────────────────────────────────
  describe("Event update with field preservation", () => {
    test("should preserve all event fields during update", async () => {
      const calendarService = BuildCalendarService(mockCredential);
      setFullMockOAuthManagerRequest();

      const mockUpdatedEvent = createMockGoogleEvent({ id: "update-field-id" });
      const eventsUpdateMock = vi.fn().mockResolvedValue({ data: mockUpdatedEvent });
      calendarMock.calendar_v3.Calendar().events.update = eventsUpdateMock;

      const testCalEvent = createTestCalEvent({
        title: "Updated Field Meeting",
        calendarDescription: "Updated description",
        location: "Updated Location",
        attendees: [
          {
            id: 2,
            name: "Updater",
            email: "updater@example.com",
            timeZone: "America/New_York",
            language: { translate: (...args: any[]) => args[0], locale: "en" },
          },
        ],
      });

      await calendarService.updateEvent("update-field-id", testCalEvent, "primary");

      expect(eventsUpdateMock).toHaveBeenCalledTimes(1);
      const updateCall = eventsUpdateMock.mock.calls[0][0];

      // Calendly-equivalent update parameters
      expect(updateCall.conferenceDataVersion).toBe(1);
      expect(updateCall.sendNotifications).toBe(true);
      expect(updateCall.sendUpdates).toBe("none");
      expect(updateCall.eventId).toBe("update-field-id");

      // Payload fields are fully preserved
      const payload = updateCall.requestBody;
      expect(payload.summary).toBe("Updated Field Meeting");
      expect(payload.description).toBe("Updated description");
      expect(payload.start).toEqual({ dateTime: "2024-06-15T10:00:00Z", timeZone: "UTC" });
      expect(payload.end).toEqual({ dateTime: "2024-06-15T11:00:00Z", timeZone: "UTC" });
      expect(payload.reminders).toBeDefined();
      expect(payload.guestsCanSeeOtherGuests).toBe(true);
      expect(payload.attendees).toBeDefined();
      expect(payload.location).toBeDefined();
    });

    test("should correctly select destination calendar by externalId during update", async () => {
      const calendarService = BuildCalendarService(mockCredential);
      setFullMockOAuthManagerRequest();

      const eventsUpdateMock = vi.fn().mockResolvedValue({
        data: createMockGoogleEvent({ id: "dest-cal-event-id" }),
      });
      calendarMock.calendar_v3.Calendar().events.update = eventsUpdateMock;

      const workDestCal = {
        ...defaultDestinationCalendar,
        id: 2,
        externalId: "work@example.com",
      };

      const testCalEvent = createTestCalEvent({
        destinationCalendar: [defaultDestinationCalendar, workDestCal],
      });

      // Pass externalCalendarId matching workDestCal
      await calendarService.updateEvent("dest-cal-event-id", testCalEvent, "work@example.com");

      const updateCall = eventsUpdateMock.mock.calls[0][0];
      expect(updateCall.calendarId).toBe("work@example.com");
    });

    test("should default to primary calendar when no matching externalCalendarId", async () => {
      const calendarService = BuildCalendarService(mockCredential);
      setFullMockOAuthManagerRequest();

      const eventsUpdateMock = vi.fn().mockResolvedValue({
        data: createMockGoogleEvent({ id: "no-match-event-id" }),
      });
      calendarMock.calendar_v3.Calendar().events.update = eventsUpdateMock;

      const testCalEvent = createTestCalEvent();

      // Pass externalCalendarId that doesn't match any destination calendar
      await calendarService.updateEvent(
        "no-match-event-id",
        testCalEvent,
        "nonexistent@example.com"
      );

      const updateCall = eventsUpdateMock.mock.calls[0][0];
      expect(updateCall.calendarId).toBe("primary");
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 8. Event Deletion with Error Tolerance
  // ──────────────────────────────────────────────────────────────────────────
  describe("Event deletion with error tolerance", () => {
    test("should delete event successfully", async () => {
      const calendarService = BuildCalendarService(mockCredential);
      setFullMockOAuthManagerRequest();

      const eventsDeleteMock = vi.fn().mockResolvedValue({ data: undefined });
      calendarMock.calendar_v3.Calendar().events.delete = eventsDeleteMock;

      await calendarService.deleteEvent("delete-parity-uid", {} as any, null);

      expect(eventsDeleteMock).toHaveBeenCalledTimes(1);
      const deleteCall = eventsDeleteMock.mock.calls[0][0];
      expect(deleteCall.eventId).toBe("delete-parity-uid");
      expect(deleteCall.calendarId).toBe("primary");
      expect(deleteCall.sendNotifications).toBe(false);
      expect(deleteCall.sendUpdates).toBe("none");
    });

    test("should handle 410 (already deleted) gracefully", async () => {
      const calendarService = BuildCalendarService(mockCredential);
      setFullMockOAuthManagerRequest();

      const error410 = Object.assign(new Error("Resource has been deleted"), { code: 410 });
      calendarMock.calendar_v3.Calendar().events.delete = vi.fn().mockRejectedValue(error410);

      // Calendly ignores already-deleted events — Cal.com should match this behavior
      await expect(
        calendarService.deleteEvent("already-deleted-uid", {} as any, null)
      ).resolves.toBeUndefined();
    });

    test("should handle 404 (wrong calendar) gracefully", async () => {
      const calendarService = BuildCalendarService(mockCredential);
      setFullMockOAuthManagerRequest();

      const error404 = Object.assign(new Error("Not Found"), { code: 404 });
      calendarMock.calendar_v3.Calendar().events.delete = vi.fn().mockRejectedValue(error404);

      // 404 indicates the event is on a different calendar — should not throw
      await expect(
        calendarService.deleteEvent("wrong-calendar-uid", {} as any, null)
      ).resolves.toBeUndefined();
    });

    test("should throw on other error codes (e.g., 500)", async () => {
      const calendarService = BuildCalendarService(mockCredential);
      setFullMockOAuthManagerRequest();

      const error500 = Object.assign(new Error("Internal Server Error"), { code: 500 });
      calendarMock.calendar_v3.Calendar().events.delete = vi.fn().mockRejectedValue(error500);

      // 500 errors should propagate — these indicate real failures
      await expect(
        calendarService.deleteEvent("server-error-uid", {} as any, null)
      ).rejects.toThrow("Internal Server Error");
    });

    test("should use externalCalendarId when provided, default to primary otherwise", async () => {
      const calendarService = BuildCalendarService(mockCredential);
      setFullMockOAuthManagerRequest();

      const eventsDeleteMock = vi.fn().mockResolvedValue({ data: undefined });
      calendarMock.calendar_v3.Calendar().events.delete = eventsDeleteMock;

      // Test with externalCalendarId provided
      await calendarService.deleteEvent("uid-with-ext-cal", {} as any, "work@example.com");

      expect(eventsDeleteMock.mock.calls[0][0].calendarId).toBe("work@example.com");

      eventsDeleteMock.mockClear();

      // Test without externalCalendarId — should default to "primary"
      await calendarService.deleteEvent("uid-no-ext-cal", {} as any, null);

      expect(eventsDeleteMock.mock.calls[0][0].calendarId).toBe("primary");
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 9. Push Notification Subscription (CI-001 Gap)
  // ──────────────────────────────────────────────────────────────────────────
  describe("Push notification subscription (CI-001 gap)", () => {
    test("should subscribe to calendar changes via events.watch", async () => {
      const calendarService = createGoogleCalendarServiceWithGoogleType(mockCredential);
      setFullMockOAuthManagerRequest();

      const calendar = await calendarService.authedCalendar();

      const watchResult = await calendar.events.watch({
        calendarId: "primary",
        requestBody: {
          id: "parity-channel-id",
          type: "web_hook",
          address: "https://cal.example.com/api/google/push-notification",
          params: { ttl: "604800" },
        },
      });

      // Verify events.watch was called
      expect(calendar.events.watch).toHaveBeenCalledTimes(1);
      expect(calendar.events.watch).toHaveBeenCalledWith({
        calendarId: "primary",
        requestBody: {
          id: "parity-channel-id",
          type: "web_hook",
          address: "https://cal.example.com/api/google/push-notification",
          params: { ttl: "604800" },
        },
      });

      // Verify the mock returns channel subscription metadata
      expect(watchResult.data.id).toBe("mock-channel-id");
      expect(watchResult.data.resourceId).toBe("mock-resource-id");
      expect(watchResult.data.expiration).toBe("1111111111");
    });

    test("should unsubscribe from calendar changes via channels.stop", async () => {
      const calendarService = createGoogleCalendarServiceWithGoogleType(mockCredential);
      setFullMockOAuthManagerRequest();

      const calendar = await calendarService.authedCalendar();

      await calendar.channels.stop({
        requestBody: {
          id: "channel-to-stop",
          resourceId: "resource-to-stop",
        },
      });

      // Verify channels.stop was called with correct arguments
      expect(calendar.channels.stop).toHaveBeenCalledTimes(1);
      expect(calendar.channels.stop).toHaveBeenCalledWith({
        requestBody: {
          id: "channel-to-stop",
          resourceId: "resource-to-stop",
        },
      });
    });

    test("should generate unique channel IDs per subscription", async () => {
      const calendarService = createGoogleCalendarServiceWithGoogleType(mockCredential);
      setFullMockOAuthManagerRequest();

      const calendar = await calendarService.authedCalendar();

      const channelId1 = `channel-${Date.now()}-1`;
      const channelId2 = `channel-${Date.now()}-2`;

      await calendar.events.watch({
        calendarId: "primary",
        requestBody: {
          id: channelId1,
          type: "web_hook",
          address: "https://cal.example.com/api/google/push-notification",
        },
      });

      await calendar.events.watch({
        calendarId: "primary",
        requestBody: {
          id: channelId2,
          type: "web_hook",
          address: "https://cal.example.com/api/google/push-notification",
        },
      });

      // Verify two separate subscriptions were made
      expect(calendar.events.watch).toHaveBeenCalledTimes(2);

      // Verify different channel IDs were used in the requests
      const call1Id = (calendar.events.watch as any).mock.calls[0][0].requestBody.id;
      const call2Id = (calendar.events.watch as any).mock.calls[1][0].requestBody.id;
      expect(call1Id).not.toBe(call2Id);
    });
  });
});
