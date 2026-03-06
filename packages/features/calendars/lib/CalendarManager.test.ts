import { prisma } from "@calcom/prisma/__mocks__/prisma";
import type { CalendarEvent } from "@calcom/types/Calendar";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  deduplicateCredentialsBasedOnSelectedCalendars,
  deleteEvent,
  getBusyCalendarTimes,
  getCalendarCredentials,
  processEvent,
} from "./CalendarManager";
import { getCalendar } from "@calcom/app-store/_utils/getCalendar";
import getCalendarsEvents from "@calcom/features/calendars/lib/getCalendarsEvents";

vi.mock("@calcom/prisma", () => ({
  prisma,
}));

vi.mock("@calcom/app-store/_utils/getCalendar", () => ({
  getCalendar: vi.fn(),
}));

vi.mock("@calcom/lib/constants", () => ({
  ORGANIZER_EMAIL_EXEMPT_DOMAINS: "",
  IS_PRODUCTION: false,
}));

vi.mock("@calcom/app-store/locations", () => ({
  MeetLocationType: "integrations:google:meet",
}));

vi.mock("@calcom/lib/CalEventParser", () => ({
  getRichDescription: vi.fn(() => "Test description"),
}));

vi.mock("@calcom/features/calendars/lib/getCalendarsEvents", () => ({
  default: vi.fn().mockResolvedValue([]),
  getCalendarsEventsWithTimezones: vi.fn().mockResolvedValue([]),
}));

function buildCredential(data: {
  type: string;
  appId: string;
  id: number;
  delegatedToId: string | null;
  user: { email: string } | null;
}) {
  return {
    ...data,
    teamId: null,
    invalid: false,
    key: { access_token: "DONT_MATTER" },
    userId: 10000,
    delegatedTo: {
      serviceAccountKey: {
        client_email: "DONT_MATTER",
        tenant_id: "DONT_MATTER",
        client_id: "DONT_MATTER",
        private_key: "DONT_MATTER",
      },
    },
  };
}

function buildCalendarEvent(overrides = {}) {
  return {
    type: "test-event",
    title: "Test Event",
    startTime: "2024-01-01T10:00:00Z",
    endTime: "2024-01-01T11:00:00Z",
    organizer: {
      name: "Organizer",
      email: "organizer@example.com",
      timeZone: "UTC",
      language: { translate: (x: string) => x, locale: "en" },
    },
    attendees: [
      {
        name: "Attendee 1",
        email: "attendee1@example.com",
        timeZone: "UTC",
        language: { translate: (x: string) => x, locale: "en" },
      },
      {
        name: "Attendee 2",
        email: "attendee2@example.com",
        timeZone: "UTC",
        language: { translate: (x: string) => x, locale: "en" },
      },
    ],
    destinationCalendar: null,
    hideOrganizerEmail: false,
    location: null,
    ...overrides,
  };
}

describe("CalendarManager tests", () => {
  describe("fn: processEvent", () => {
    it("should clear attendees when hideOrganizerEmail is true and no Zoho Calendar destination", () => {
      const calEvent = buildCalendarEvent({
        hideOrganizerEmail: true,
        destinationCalendar: [
          {
            integration: "google_calendar",
            externalId: "calendar-1",
          },
        ],
      });

      const result = processEvent(calEvent as any);

      expect(result.attendees).toEqual([]);
    });

    it("should NOT clear attendees when hideOrganizerEmail is true and destination is Zoho Calendar", () => {
      const calEvent = buildCalendarEvent({
        hideOrganizerEmail: true,
        destinationCalendar: [
          {
            integration: "zoho_calendar",
            externalId: "calendar-1",
          },
        ],
      });

      const result = processEvent(calEvent as any);

      // Zoho Calendar requires at least one attendee, so attendees should NOT be cleared
      expect(result.attendees).toHaveLength(2);
      expect(result.attendees[0].email).toBe("attendee1@example.com");
      expect(result.attendees[1].email).toBe("attendee2@example.com");
    });

    it("should NOT clear attendees when hideOrganizerEmail is true and one of multiple destinations is Zoho Calendar", () => {
      const calEvent = buildCalendarEvent({
        hideOrganizerEmail: true,
        destinationCalendar: [
          {
            integration: "google_calendar",
            externalId: "google-calendar-1",
          },
          {
            integration: "zoho_calendar",
            externalId: "zoho-calendar-1",
          },
        ],
      });

      const result = processEvent(calEvent as any);

      // Zoho Calendar is in the list, so attendees should NOT be cleared
      expect(result.attendees).toHaveLength(2);
    });

    it("should NOT clear attendees when hideOrganizerEmail is false", () => {
      const calEvent = buildCalendarEvent({
        hideOrganizerEmail: false,
        destinationCalendar: [
          {
            integration: "google_calendar",
            externalId: "calendar-1",
          },
        ],
      });

      const result = processEvent(calEvent as any);

      expect(result.attendees).toHaveLength(2);
    });

    it("should NOT clear attendees when location is MeetLocationType even with hideOrganizerEmail true", () => {
      const calEvent = buildCalendarEvent({
        hideOrganizerEmail: true,
        location: "integrations:google:meet",
        destinationCalendar: [
          {
            integration: "google_calendar",
            externalId: "calendar-1",
          },
        ],
      });

      const result = processEvent(calEvent as any);

      expect(result.attendees).toHaveLength(2);
    });

    it("should handle null destinationCalendar with hideOrganizerEmail true", () => {
      const calEvent = buildCalendarEvent({
        hideOrganizerEmail: true,
        destinationCalendar: null,
      });

      const result = processEvent(calEvent as any);

      expect(result.attendees).toEqual([]);
    });

    it("should handle empty destinationCalendar array with hideOrganizerEmail true", () => {
      const calEvent = buildCalendarEvent({
        hideOrganizerEmail: true,
        destinationCalendar: [],
      });

      const result = processEvent(calEvent as any);

      expect(result.attendees).toEqual([]);
    });

    it("should include calendarDescription from getRichDescription", () => {
      const calEvent = buildCalendarEvent();

      const result = processEvent(calEvent as any);

      expect(result.calendarDescription).toBe("Test description");
    });

    it("should clear responses for seatsPerTimeSlot events", () => {
      const calEvent = buildCalendarEvent({
        seatsPerTimeSlot: 5,
        responses: { field1: { label: "Field 1", value: "test" } },
        userFieldsResponses: { field1: { label: "Field 1", value: "test" } },
        additionalNotes: "Test notes",
        customInputs: { input1: "value1" },
      });

      const result = processEvent(calEvent as any);

      expect(result.responses).toBeNull();
      expect(result.userFieldsResponses).toBeNull();
      expect(result.additionalNotes).toBeNull();
      expect(result.customInputs).toBeNull();
    });
  });

  describe("fn: getCalendarCredentials", () => {
    it("should only return credentials for calendar apps", async () => {
      const googleCalendarCredentials = {
        id: "1",
        appId: "google-calendar",
        type: "google_calendar",
        userId: "3",
        key: {
          access_token: "google_calendar_key",
        },
        invalid: false,
        delegatedTo: null,
      };

      const credentials = [
        googleCalendarCredentials,
        {
          id: "2",
          appId: "office365-video",
          type: "office365_video",
          userId: "4",
          key: {
            access_token: "office365_video_key",
          },
          invalid: false,
        },
      ];

      const calendarCredentials = getCalendarCredentials(credentials);
      expect(calendarCredentials).toHaveLength(1);
      expect(calendarCredentials[0].credential).toEqual(googleCalendarCredentials);
    });
  });

  describe("fn: deduplicateCredentialsBasedOnSelectedCalendars", () => {
    it("should remove a regular credential for which a delegation credential exists i.e. both are fetching events for same externalId", () => {
      const calcomUser = {
        email: "owner@hariombalhara.net",
      };

      const externalIdSameAsCalcomUserEmail = calcomUser.email;
      const externalIdDifferentFromCalcomUserEmail = "hariombalhara@gmail.com";

      // Delegation Credential(Calendar)
      const delegationCredentialCalendarForCalcomEmail = buildCredential({
        type: "google_calendar",
        appId: "google-calendar",
        id: -1,
        delegatedToId: "45fa8f04-e891-417b-98e1-abf48e8ae18a",
        user: calcomUser,
      });

      // Delegation Credential(Conferencing)
      const delegationCredentialConferencingForCalcomEmail = buildCredential({
        type: "google_video",
        appId: "google-meet",
        id: -1,
        delegatedToId: "45fa8f04-e891-417b-98e1-abf48e8ae18a",
        user: calcomUser,
      });

      // Regular Credential for owner@hariombalhara.net
      const regularCredentialForCalcomEmail = buildCredential({
        id: 2,
        appId: "google-calendar",
        type: "google_calendar",
        delegatedToId: null,
        user: calcomUser,
      });

      // Regular Credential for hariombalhara@gmail.com
      const regularCredentialForSomeOtherEmail = buildCredential({
        id: 3,
        appId: "google-calendar",
        type: "google_calendar",
        delegatedToId: null,
        user: calcomUser,
      });

      const credentials = [
        delegationCredentialCalendarForCalcomEmail,
        delegationCredentialConferencingForCalcomEmail,
        // This one is duplicate
        regularCredentialForCalcomEmail,
        // Regular Credential for hariombalhara@gmail.com
        regularCredentialForSomeOtherEmail,
      ];

      const selectedCalendars = [
        {
          id: "62f4f3b7-c65b-4199-8052-25b91ee25ff2",
          userId: 23,
          integration: "google_calendar",
          externalId: externalIdDifferentFromCalcomUserEmail,
          credentialId: regularCredentialForSomeOtherEmail.id,
          delegationCredentialId: null,
          eventTypeId: null,
        },
        {
          id: "418e1bd0-7bde-4ea6-b03a-b2b6de6af497",
          userId: 23,
          integration: "google_calendar",
          externalId: externalIdSameAsCalcomUserEmail,
          credentialId: regularCredentialForCalcomEmail.id,
          delegationCredentialId: null,
          eventTypeId: null,
        },
      ];

      const uniqueCredentials = deduplicateCredentialsBasedOnSelectedCalendars({
        credentials,
        selectedCalendars,
      });
      expect(uniqueCredentials).toHaveLength(3);
      expect(uniqueCredentials).toEqual([
        delegationCredentialCalendarForCalcomEmail,
        delegationCredentialConferencingForCalcomEmail,
        regularCredentialForSomeOtherEmail,
      ]);
    });

    it("should not remove a regular credential for which a delegation credential exists i.e. both are fetching events for same externalId if integration is different", () => {
      const calcomUser = {
        email: "owner@hariombalhara.net",
      };

      const externalIdSameAsCalcomUserEmail = calcomUser.email;
      const externalIdDifferentFromCalcomUserEmail = "hariombalhara@gmail.com";

      // Delegation Credential(Calendar) - wrong integration type
      const delegationCredentialCalendarForCalcomEmail = buildCredential({
        type: "google_calendar_wrong_type",
        appId: "google-calendar",
        id: -1,
        delegatedToId: "45fa8f04-e891-417b-98e1-abf48e8ae18a",
        user: calcomUser,
      });

      // Delegation Credential(Conferencing)
      const delegationCredentialConferencingForCalcomEmail = buildCredential({
        type: "google_video",
        appId: "google-meet",
        id: -1,
        delegatedToId: "45fa8f04-e891-417b-98e1-abf48e8ae18a",
        user: calcomUser,
      });

      // Regular Credential for owner@hariombalhara.net
      const regularCredentialForCalcomEmail = buildCredential({
        id: 2,
        appId: "google-calendar",
        type: "google_calendar",
        delegatedToId: null,
        user: calcomUser,
      });

      // Regular Credential for hariombalhara@gmail.com
      const regularCredentialForSomeOtherEmail = buildCredential({
        id: 3,
        appId: "google-calendar",
        type: "google_calendar",
        delegatedToId: null,
        user: calcomUser,
      });

      const credentials = [
        delegationCredentialCalendarForCalcomEmail,
        delegationCredentialConferencingForCalcomEmail,
        // This one won't be removed as integration is different
        regularCredentialForCalcomEmail,
        // Regular Credential for hariombalhara@gmail.com
        regularCredentialForSomeOtherEmail,
      ];

      const selectedCalendars = [
        {
          id: "62f4f3b7-c65b-4199-8052-25b91ee25ff2",
          userId: 23,
          integration: "google_calendar",
          externalId: externalIdDifferentFromCalcomUserEmail,
          credentialId: regularCredentialForSomeOtherEmail.id,
          delegationCredentialId: null,
          eventTypeId: null,
        },
        {
          id: "418e1bd0-7bde-4ea6-b03a-b2b6de6af497",
          userId: 23,
          integration: "google_calendar",
          externalId: externalIdSameAsCalcomUserEmail,
          credentialId: regularCredentialForCalcomEmail.id,
          delegationCredentialId: null,
          eventTypeId: null,
        },
      ];

      const uniqueCredentials = deduplicateCredentialsBasedOnSelectedCalendars({
        credentials,
        selectedCalendars,
      });
      expect(uniqueCredentials).toHaveLength(4);
      expect(uniqueCredentials).toEqual([
        delegationCredentialCalendarForCalcomEmail,
        delegationCredentialConferencingForCalcomEmail,
        regularCredentialForCalcomEmail,
        regularCredentialForSomeOtherEmail,
      ]);
    });

    it("should return empty array when credentials array is empty", () => {
      const selectedCalendars = [
        {
          id: "calendar-1",
          userId: 23,
          integration: "google_calendar",
          externalId: "test@example.com",
          credentialId: 1,
          delegationCredentialId: null,
          eventTypeId: null,
        },
      ];

      const uniqueCredentials = deduplicateCredentialsBasedOnSelectedCalendars({
        credentials: [],
        selectedCalendars,
      });
      expect(uniqueCredentials).toHaveLength(0);
    });

    it("should return original credentials when user email is not present", () => {
      const credentialsWithoutUserEmail = [
        buildCredential({
          type: "google_calendar",
          appId: "google-calendar",
          id: 1,
          delegatedToId: null,
          user: null,
        }),
        buildCredential({
          type: "google_calendar",
          appId: "google-calendar",
          id: -1,
          delegatedToId: "delegation-1",
          user: null,
        }),
      ];

      const selectedCalendars = [
        {
          id: "calendar-1",
          userId: 23,
          integration: "google_calendar",
          externalId: "test@example.com",
          credentialId: 1,
          delegationCredentialId: null,
          eventTypeId: null,
        },
      ];

      const uniqueCredentials = deduplicateCredentialsBasedOnSelectedCalendars({
        credentials: credentialsWithoutUserEmail,
        selectedCalendars,
      });
      expect(uniqueCredentials).toEqual(credentialsWithoutUserEmail);
    });

    it("should return original credentials when no delegation credentials exist", () => {
      const regularCredentials = [
        buildCredential({
          type: "google_calendar",
          appId: "google-calendar",
          id: 1,
          delegatedToId: null,
          user: { email: "test@example.com" },
        }),
        buildCredential({
          type: "google_calendar",
          appId: "google-calendar",
          id: 2,
          delegatedToId: null,
          user: { email: "test@example.com" },
        }),
      ];

      const selectedCalendars = [
        {
          id: "calendar-1",
          userId: 23,
          integration: "google_calendar",
          externalId: "test@example.com",
          credentialId: 1,
          delegationCredentialId: null,
          eventTypeId: null,
        },
      ];

      const uniqueCredentials = deduplicateCredentialsBasedOnSelectedCalendars({
        credentials: regularCredentials,
        selectedCalendars,
      });
      expect(uniqueCredentials).toEqual(regularCredentials);
    });

    it("should return original credentials when no matching selected calendars exist", () => {
      const credentials = [
        buildCredential({
          type: "google_calendar",
          appId: "google-calendar",
          id: 1,
          delegatedToId: "delegation-1",
          user: { email: "test@example.com" },
        }),
        buildCredential({
          type: "google_calendar",
          appId: "google-calendar",
          id: 2,
          delegatedToId: null,
          user: { email: "test@example.com" },
        }),
      ];

      const selectedCalendars = [
        {
          id: "calendar-1",
          userId: 23,
          integration: "google_calendar",
          externalId: "different@example.com", // Different email than the credentials
          credentialId: 1,
          delegationCredentialId: null,
          eventTypeId: null,
        },
      ];

      const uniqueCredentials = deduplicateCredentialsBasedOnSelectedCalendars({
        credentials,
        selectedCalendars,
      });
      expect(uniqueCredentials).toEqual(credentials);
    });
  });

  describe("fn: deleteEvent", () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("should return early when bookingRefUid is empty string", async () => {
      vi.mocked(getCalendar).mockResolvedValue({ deleteEvent: vi.fn() } as any);

      const credential = {
        id: 1,
        type: "google_calendar",
        key: { access_token: "test_token" },
        encryptedKey: null,
        userId: 1,
        user: { email: "test@example.com" },
        teamId: null,
        appId: "google-calendar",
        invalid: false,
        delegationCredentialId: null,
        delegatedTo: null,
      };

      const result = await deleteEvent({
        credential,
        bookingRefUid: "",
        event: buildCalendarEvent(),
        externalCalendarId: "calendar-id",
      });

      expect(result).toEqual({});
    });
  });

  /**
   * CI-004: Conflict detection alignment tests
   *
   * These tests verify that getBusyCalendarTimes correctly handles the credential
   * deduplication pipeline and threads parameters (including statusFilter) to the
   * underlying getCalendarsEvents call. This is part of aligning Cal.com's busy time
   * aggregation with Calendly's configurable conflict detection behavior.
   */
  describe("fn: getBusyCalendarTimes - statusFilter threading (CI-004)", () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("should pass through deduplication and call getCalendarsEvents with provided credentials", async () => {
      const googleCredential = buildCredential({
        type: "google_calendar",
        appId: "google-calendar",
        id: 1,
        delegatedToId: null,
        user: { email: "user@example.com" },
      });

      const outlookCredential = buildCredential({
        type: "office365_calendar",
        appId: "office365-calendar",
        id: 2,
        delegatedToId: null,
        user: { email: "user@example.com" },
      });

      const selectedCalendars = [
        {
          id: "cal-1",
          userId: 1,
          integration: "google_calendar",
          externalId: "user@example.com",
          credentialId: 1,
          delegationCredentialId: null,
          eventTypeId: null,
        },
        {
          id: "cal-2",
          userId: 1,
          integration: "office365_calendar",
          externalId: "user@example.com",
          credentialId: 2,
          delegationCredentialId: null,
          eventTypeId: null,
        },
      ];

      vi.mocked(getCalendarsEvents).mockResolvedValue([]);

      const result = await getBusyCalendarTimes(
        [googleCredential, outlookCredential] as any,
        "2024-01-01T00:00:00Z",
        "2024-01-31T23:59:59Z",
        selectedCalendars as any
      );

      // Validate the pipeline returns a well-formed result
      expect(result).toBeDefined();
      expect(result).toHaveProperty("success");
      expect(result).toHaveProperty("data");
      expect(result.success).toBe(true);
      expect(Array.isArray(result.data)).toBe(true);

      // Verify getCalendarsEvents was called with the credentials
      expect(vi.mocked(getCalendarsEvents)).toHaveBeenCalledTimes(1);
      const passedCredentials = vi.mocked(getCalendarsEvents).mock.calls[0][0];
      // Both credentials should be passed since neither is a duplicate
      expect(passedCredentials).toHaveLength(2);
    });

    it("should handle empty credentials array gracefully", async () => {
      vi.mocked(getCalendarsEvents).mockResolvedValue([]);

      const result = await getBusyCalendarTimes(
        [],
        "2024-01-01T00:00:00Z",
        "2024-01-31T23:59:59Z",
        []
      );

      // An empty credentials array should still return a success result with empty data
      expect(result).toBeDefined();
      expect(result.success).toBe(true);
      expect(result.data).toEqual([]);
    });

    it("should apply credential deduplication before fetching busy times", async () => {
      const calcomUser = {
        email: "owner@example.com",
      };

      // Delegation Credential (Calendar) — handles owner@example.com via DWD
      const delegationCredential = buildCredential({
        type: "google_calendar",
        appId: "google-calendar",
        id: -1,
        delegatedToId: "delegation-uuid-1",
        user: calcomUser,
      });

      // Regular Credential for the same email — this is the duplicate that should be removed
      const regularCredential = buildCredential({
        id: 2,
        appId: "google-calendar",
        type: "google_calendar",
        delegatedToId: null,
        user: calcomUser,
      });

      // SelectedCalendar entry connecting the regular credential to the user's email
      const selectedCalendars = [
        {
          id: "cal-1",
          userId: 23,
          integration: "google_calendar",
          externalId: calcomUser.email,
          credentialId: regularCredential.id,
          delegationCredentialId: null,
          eventTypeId: null,
        },
      ];

      vi.mocked(getCalendarsEvents).mockResolvedValue([]);

      const result = await getBusyCalendarTimes(
        [delegationCredential, regularCredential] as any,
        "2024-01-01T00:00:00Z",
        "2024-01-31T23:59:59Z",
        selectedCalendars as any
      );

      expect(result.success).toBe(true);

      // Verify getCalendarsEvents was called with deduplicated credentials.
      // The delegation credential should remain, and the regular credential
      // should be removed since both serve the same externalId (calcomUser.email).
      expect(vi.mocked(getCalendarsEvents)).toHaveBeenCalledTimes(1);
      const passedCredentials = vi.mocked(getCalendarsEvents).mock.calls[0][0];
      expect(passedCredentials).toHaveLength(1);
      expect(passedCredentials[0]).toEqual(delegationCredential);
    });

    it("should thread statusFilter parameter through to getCalendarsEvents", async () => {
      const credential = buildCredential({
        type: "google_calendar",
        appId: "google-calendar",
        id: 1,
        delegatedToId: null,
        user: { email: "user@example.com" },
      });

      const selectedCalendars = [
        {
          id: "cal-1",
          userId: 1,
          integration: "google_calendar",
          externalId: "user@example.com",
          credentialId: 1,
          delegationCredentialId: null,
          eventTypeId: null,
        },
      ];

      vi.mocked(getCalendarsEvents).mockResolvedValue([]);

      const statusFilter = ["Busy", "Tentative", "OutOfOffice"];

      await getBusyCalendarTimes(
        [credential] as any,
        "2024-01-01T00:00:00Z",
        "2024-01-31T23:59:59Z",
        selectedCalendars as any,
        undefined, // mode
        undefined, // includeTimeZone
        statusFilter
      );

      // Verify getCalendarsEvents was called and received the statusFilter
      expect(vi.mocked(getCalendarsEvents)).toHaveBeenCalledTimes(1);
      const callArgs = vi.mocked(getCalendarsEvents).mock.calls[0];
      // The statusFilter is the 6th argument (index 5) in the getCalendarsEvents call
      expect(callArgs[5]).toEqual(statusFilter);
    });

    it("should return error result when getCalendarsEvents throws", async () => {
      const credential = buildCredential({
        type: "google_calendar",
        appId: "google-calendar",
        id: 1,
        delegatedToId: null,
        user: { email: "user@example.com" },
      });

      const selectedCalendars = [
        {
          id: "cal-1",
          userId: 1,
          integration: "google_calendar",
          externalId: "user@example.com",
          credentialId: 1,
          delegationCredentialId: null,
          eventTypeId: null,
        },
      ];

      vi.mocked(getCalendarsEvents).mockRejectedValue(new Error("Calendar API unavailable"));

      const result = await getBusyCalendarTimes(
        [credential] as any,
        "2024-01-01T00:00:00Z",
        "2024-01-31T23:59:59Z",
        selectedCalendars as any
      );

      // When getCalendarsEvents throws, getBusyCalendarTimes catches it and returns an error result
      expect(result.success).toBe(false);
      expect(result.data).toHaveLength(1);
      expect(result.data[0]).toHaveProperty("source", "error-placeholder");
    });

    it("should flatten nested results from getCalendarsEvents into a single data array", async () => {
      const credential = buildCredential({
        type: "google_calendar",
        appId: "google-calendar",
        id: 1,
        delegatedToId: null,
        user: { email: "user@example.com" },
      });

      const selectedCalendars = [
        {
          id: "cal-1",
          userId: 1,
          integration: "google_calendar",
          externalId: "user@example.com",
          credentialId: 1,
          delegationCredentialId: null,
          eventTypeId: null,
        },
      ];

      // Mock getCalendarsEvents to return nested arrays (one per calendar adapter)
      const busyTimes = [
        [
          { start: "2024-01-10T09:00:00Z", end: "2024-01-10T10:00:00Z" },
          { start: "2024-01-10T14:00:00Z", end: "2024-01-10T15:00:00Z" },
        ],
        [
          { start: "2024-01-11T11:00:00Z", end: "2024-01-11T12:00:00Z" },
        ],
      ];
      vi.mocked(getCalendarsEvents).mockResolvedValue(busyTimes as any);

      const result = await getBusyCalendarTimes(
        [credential] as any,
        "2024-01-01T00:00:00Z",
        "2024-01-31T23:59:59Z",
        selectedCalendars as any
      );

      expect(result.success).toBe(true);
      // Results from all calendars should be flattened into a single array
      expect(result.data).toHaveLength(3);
      expect(result.data[0]).toEqual({ start: "2024-01-10T09:00:00Z", end: "2024-01-10T10:00:00Z" });
      expect(result.data[1]).toEqual({ start: "2024-01-10T14:00:00Z", end: "2024-01-10T15:00:00Z" });
      expect(result.data[2]).toEqual({ start: "2024-01-11T11:00:00Z", end: "2024-01-11T12:00:00Z" });
    });
  });

  /**
   * CI-002 gap: Buffer time calendar visualization integration tests
   *
   * These tests verify that the processEvent pipeline and CalendarManager
   * functions continue to work correctly when buffer-sync features are
   * available in the codebase. When syncBuffersToCalendar is not enabled
   * (default), all existing behavior must be preserved identically.
   * The BufferTimeEventService handles actual buffer event creation separately.
   */
  describe("buffer event creation integration (CI-002 gap)", () => {
    it("should process event normally when buffer sync is not enabled", () => {
      const calEvent = buildCalendarEvent();

      const result = processEvent(calEvent as any);

      // Core event properties are preserved
      expect(result).toBeDefined();
      expect(result.calendarDescription).toBe("Test description");
      expect(result.type).toBe("test-event");
      expect(result.title).toBe("Test Event");
      expect(result.startTime).toBe("2024-01-01T10:00:00Z");
      expect(result.endTime).toBe("2024-01-01T11:00:00Z");
      // Organizer is preserved
      expect(result.organizer.email).toBe("organizer@example.com");
      expect(result.organizer.name).toBe("Organizer");
    });

    it("should maintain all existing processEvent behavior when buffer sync is available", () => {
      const calEvent = buildCalendarEvent({
        hideOrganizerEmail: false,
        destinationCalendar: [
          {
            integration: "google_calendar",
            externalId: "calendar-1",
          },
        ],
      });

      const result = processEvent(calEvent as any);

      // Verify attendees are preserved when hideOrganizerEmail is false
      expect(result.attendees).toHaveLength(2);
      expect(result.attendees[0].email).toBe("attendee1@example.com");
      expect(result.attendees[0].name).toBe("Attendee 1");
      expect(result.attendees[1].email).toBe("attendee2@example.com");
      expect(result.attendees[1].name).toBe("Attendee 2");
      // Verify calendarDescription is set from getRichDescription mock
      expect(result.calendarDescription).toBe("Test description");
      // Verify organizer is preserved
      expect(result.organizer.email).toBe("organizer@example.com");
      // Verify destination calendar is preserved
      expect(result.destinationCalendar).toEqual([
        {
          integration: "google_calendar",
          externalId: "calendar-1",
        },
      ]);
    });

    it("should preserve seatsPerTimeSlot clearing behavior regardless of buffer sync state", () => {
      const calEvent = buildCalendarEvent({
        seatsPerTimeSlot: 5,
        responses: { field1: { label: "Field 1", value: "test" } },
        userFieldsResponses: { field1: { label: "Field 1", value: "test" } },
        additionalNotes: "Test notes",
        customInputs: { input1: "value1" },
      });

      const result = processEvent(calEvent as any);

      // seatsPerTimeSlot clearing should still work identically
      expect(result.responses).toBeNull();
      expect(result.userFieldsResponses).toBeNull();
      expect(result.additionalNotes).toBeNull();
      expect(result.customInputs).toBeNull();
      // calendarDescription is still generated
      expect(result.calendarDescription).toBe("Test description");
    });
  });
});
