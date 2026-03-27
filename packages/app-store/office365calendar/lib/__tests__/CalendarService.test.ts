import { beforeEach, describe, expect, test, vi } from "vitest";

// ---------------------------------------------------------------------------
// Central mock functions for OAuthManager — declared via vi.hoisted() so they
// are available inside vi.mock() factory functions (which Vitest hoists above
// all other declarations). Using vi.hoisted ensures these variables exist when
// the mock factories execute.
// ---------------------------------------------------------------------------
const { mockRequestRaw, mockGetTokenObjectOrFetch } = vi.hoisted(() => ({
  mockRequestRaw: vi.fn(),
  mockGetTokenObjectOrFetch: vi.fn().mockResolvedValue({
    token: { access_token: "FAKE_ACCESS_TOKEN" },
  }),
}));

// ---------------------------------------------------------------------------
// vi.mock() calls — MUST be hoisted before any non-vitest imports.
// IMPORTANT: OAuthManager mock uses `function()` (not arrow fn) because
// the CalendarService constructor calls `new OAuthManager({...})` and
// arrow functions cannot be used as constructors in JavaScript.
// ---------------------------------------------------------------------------

vi.mock("../../../_utils/oauth/OAuthManager", () => ({
  OAuthManager: vi.fn().mockImplementation(function () {
    return {
      getTokenObjectOrFetch: mockGetTokenObjectOrFetch,
      request: vi.fn().mockResolvedValue({ json: { calendars: [] } }),
      requestRaw: mockRequestRaw,
    };
  }),
}));

vi.mock("../../../_utils/oauth/getTokenObjectFromCredential", () => ({
  getTokenObjectFromCredential: vi.fn().mockReturnValue({
    access_token: "FAKE_ACCESS_TOKEN",
    refresh_token: "FAKE_REFRESH_TOKEN",
    expires_in: 3600,
  }),
}));

vi.mock("../../../_utils/oauth/oAuthManagerHelper", () => ({
  oAuthManagerHelper: {
    credentialSyncVariables: {},
    invalidateCredential: vi.fn().mockResolvedValue(undefined),
    markTokenAsExpired: vi.fn().mockResolvedValue(undefined),
    updateTokenObject: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../getOfficeAppKeys", () => ({
  getOfficeAppKeys: vi.fn().mockResolvedValue({
    client_id: "FAKE_CLIENT_ID",
    client_secret: "FAKE_CLIENT_SECRET",
  }),
}));

vi.mock("../../_metadata", () => ({
  default: {
    name: "Outlook Calendar",
    type: "office365_calendar",
    slug: "office365-calendar",
    dirName: "office365calendar",
    isOAuth: true,
  },
}));

vi.mock("@calcom/features/webhooks/lib/triggerDelegationCredentialErrorWebhook", () => ({
  triggerDelegationCredentialErrorWebhook: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@calcom/lib/CalendarAppError", () => ({
  CalendarAppDelegationCredentialConfigurationError: class extends Error {
    constructor(msg: string) {
      super(msg);
      this.name = "CalendarAppDelegationCredentialConfigurationError";
    }
  },
  CalendarAppDelegationCredentialInvalidGrantError: class extends Error {
    constructor(msg: string) {
      super(msg);
      this.name = "CalendarAppDelegationCredentialInvalidGrantError";
    }
  },
}));

// ---------------------------------------------------------------------------
// Import the System Under Test AFTER mocks are established
// ---------------------------------------------------------------------------
import BuildCalendarService from "../CalendarService";
import type { CredentialForCalendarServiceWithTenantId } from "@calcom/types/Credential";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const API_GRAPH_URL = "https://graph.microsoft.com/v1.0";

// ---------------------------------------------------------------------------
// Mock credential fixtures
// ---------------------------------------------------------------------------
const mockCredential: CredentialForCalendarServiceWithTenantId = {
  id: 1,
  userId: 1,
  appId: "office365-calendar",
  type: "office365_calendar",
  key: {
    access_token: "FAKE_ACCESS_TOKEN",
    refresh_token: "FAKE_REFRESH_TOKEN",
    expires_in: 3600,
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

const mockDelegationCredential: CredentialForCalendarServiceWithTenantId = {
  ...mockCredential,
  id: 2,
  delegationCredentialId: 100,
  delegatedTo: {
    serviceAccountKey: {
      client_email: undefined,
      tenant_id: "fake-tenant-id",
      client_id: "fake-delegation-client-id",
      private_key: "fake-delegation-secret",
    },
  },
};

// ---------------------------------------------------------------------------
// Mock Graph API response fixtures
// ---------------------------------------------------------------------------
const mockGraphEvent = {
  id: "AAMkAGI0YTRlNzZlLT",
  iCalUId: "040000008200E00074C5B7101A82E008",
  subject: "Test Meeting",
  start: { dateTime: "2024-06-15T10:00:00.0000000", timeZone: "UTC" },
  end: { dateTime: "2024-06-15T11:00:00.0000000", timeZone: "UTC" },
  organizer: { emailAddress: { name: "Test User", address: "user@example.com" } },
  attendees: [],
  onlineMeeting: null,
  webLink: "https://outlook.office365.com/calendar/item/AAMk",
};

const mockTeamsGraphEvent = {
  ...mockGraphEvent,
  isOnlineMeeting: true,
  onlineMeeting: {
    joinUrl: "https://teams.microsoft.com/l/meetup-join/19%3ameeting_test",
  },
};

const mockCalendarListResponse = {
  value: [
    { id: "calendar-1", name: "My Calendar", isDefaultCalendar: true, canEdit: true },
    { id: "calendar-2", name: "Work Calendar", isDefaultCalendar: false, canEdit: true },
  ],
};

// ---------------------------------------------------------------------------
// CalendarServiceEvent mock for createEvent / updateEvent tests
// ---------------------------------------------------------------------------
function createMockCalendarServiceEvent(overrides: Record<string, unknown> = {}) {
  return {
    type: "test-event-type",
    title: "Test Meeting",
    startTime: "2024-06-15T10:00:00Z",
    endTime: "2024-06-15T11:00:00Z",
    organizer: {
      id: 1,
      name: "Test Organizer",
      email: "organizer@example.com",
      timeZone: "UTC",
      language: {
        translate: (key: string) => key,
        locale: "en",
      },
    },
    attendees: [
      {
        name: "Attendee 1",
        email: "attendee1@example.com",
        timeZone: "UTC",
        language: {
          translate: (key: string) => key,
          locale: "en",
        },
      },
    ],
    calendarDescription: "Test meeting description",
    destinationCalendar: [
      {
        id: 1,
        integration: "office365_calendar",
        externalId: "calendar-1",
        primaryEmail: "user@example.com",
        userId: 1,
        eventTypeId: null,
        credentialId: 1,
        delegationCredentialId: null,
        domainWideDelegationCredentialId: null,
      },
    ],
    uid: "test-uid-12345",
    ...overrides,
  } as any;
}

// ---------------------------------------------------------------------------
// Helper: create a mock Response simulating Microsoft Graph API
// For batch endpoints, set content-encoding: gzip so the CalendarService
// uses the text() path which is the production-correct code path.
// ---------------------------------------------------------------------------
function createMockGraphResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {}
): Response {
  const responseHeaders = new Headers({
    "Content-Type": "application/json",
    ...headers,
  });
  return new Response(JSON.stringify(body), {
    status,
    statusText: status === 200 ? "OK" : status === 204 ? "No Content" : "Error",
    headers: responseHeaders,
  });
}

/**
 * Creates a mock batch Response with content-encoding: gzip header.
 * The Office365CalendarService.handleErrorJsonOffice365Calendar method
 * checks this header and routes gzip responses through response.text()
 * → handleTextJsonResponseWithHtmlInBody, which is the correct
 * production code path for Microsoft Graph batch responses.
 */
function createMockBatchResponse(batchBody: {
  responses: Array<{
    id: string;
    status: number;
    headers: Record<string, string>;
    body: Record<string, unknown>;
  }>;
}): Response {
  return new Response(JSON.stringify(batchBody), {
    status: 200,
    statusText: "OK",
    headers: new Headers({
      "Content-Type": "application/json",
      "content-encoding": "gzip",
    }),
  });
}

/**
 * Creates a mock 204 No Content Response (used for DELETE operations).
 */
function createMock204Response(): Response {
  return new Response(null, {
    status: 204,
    statusText: "No Content",
    headers: new Headers({ "Content-Type": "application/json" }),
  });
}

/**
 * Sets up mockRequestRaw to handle specific URL patterns.
 * Accepts a list of handlers with URL pattern → Response factory.
 * Handlers are evaluated in order; first match wins.
 */
function setupMockRequestRaw(
  handlers: Array<{
    urlPattern: string | RegExp;
    method?: string;
    response: Response | (() => Response);
  }>
) {
  mockRequestRaw.mockImplementation(
    ({ url, options }: { url: string; options?: RequestInit }): Promise<Response> => {
      for (const handler of handlers) {
        const urlMatch =
          typeof handler.urlPattern === "string"
            ? url.includes(handler.urlPattern)
            : handler.urlPattern.test(url);
        const methodMatch =
          !handler.method ||
          (options?.method?.toUpperCase() ?? "GET") === handler.method.toUpperCase();
        if (urlMatch && methodMatch) {
          const response =
            typeof handler.response === "function" ? handler.response() : handler.response;
          return Promise.resolve(response);
        }
      }
      // Default: return empty 200 JSON response
      return Promise.resolve(createMockGraphResponse({}));
    }
  );
}

// ---------------------------------------------------------------------------
// beforeEach — reset all mocks between tests
// ---------------------------------------------------------------------------
beforeEach(() => {
  vi.clearAllMocks();
  mockRequestRaw.mockReset();
  mockGetTokenObjectOrFetch.mockResolvedValue({
    token: { access_token: "FAKE_ACCESS_TOKEN" },
  });
});

// ===========================================================================
// TEST SUITES
// ===========================================================================
describe("Office365CalendarService", () => {
  // =========================================================================
  // createEvent
  // =========================================================================
  describe("createEvent", () => {
    test("should POST event to correct Graph API endpoint for destination calendar", async () => {
      const service = BuildCalendarService(mockCredential);
      const event = createMockCalendarServiceEvent();

      setupMockRequestRaw([
        {
          urlPattern: "/calendars/calendar-1/events",
          method: "POST",
          response: () => createMockGraphResponse(mockGraphEvent),
        },
      ]);

      const result = await service.createEvent(event, 1);

      expect(mockRequestRaw).toHaveBeenCalled();
      const callArgs = mockRequestRaw.mock.calls[0][0];
      expect(callArgs.url).toContain("/me/calendars/calendar-1/events");
      expect(callArgs.options.method).toBe("POST");

      // Verify the returned result maps iCalUId → iCalUID
      expect(result.iCalUID).toBe("040000008200E00074C5B7101A82E008");
      expect(result.id).toBe("AAMkAGI0YTRlNzZlLT");
    });

    test("should fall back to /me/calendar/events when no destination calendar resolved", async () => {
      const service = BuildCalendarService(mockCredential);
      const event = createMockCalendarServiceEvent({ destinationCalendar: null });

      setupMockRequestRaw([
        {
          urlPattern: "/calendar/events",
          method: "POST",
          response: () => createMockGraphResponse(mockGraphEvent),
        },
      ]);

      const result = await service.createEvent(event, 1);

      const callArgs = mockRequestRaw.mock.calls[0][0];
      expect(callArgs.url).toBe(`${API_GRAPH_URL}/me/calendar/events`);
      expect(result.id).toBe("AAMkAGI0YTRlNzZlLT");
    });

    test("should fall back to /me/calendar/events when destination calendar has no externalId", async () => {
      const service = BuildCalendarService(mockCredential);
      const event = createMockCalendarServiceEvent({
        destinationCalendar: [{ credentialId: 1, externalId: null }],
      });

      setupMockRequestRaw([
        {
          urlPattern: "/calendar/events",
          method: "POST",
          response: () => createMockGraphResponse(mockGraphEvent),
        },
      ]);

      await service.createEvent(event, 1);

      const callArgs = mockRequestRaw.mock.calls[0][0];
      expect(callArgs.url).toBe(`${API_GRAPH_URL}/me/calendar/events`);
    });

    test("should normalize iCalUID from iCalUId in response", async () => {
      const service = BuildCalendarService(mockCredential);
      const event = createMockCalendarServiceEvent();
      const customUId = "CUSTOM-UID-VALUE-123456";

      setupMockRequestRaw([
        {
          urlPattern: "/calendars/calendar-1/events",
          method: "POST",
          response: () => createMockGraphResponse({ ...mockGraphEvent, iCalUId: customUId }),
        },
      ]);

      const result = await service.createEvent(event, 1);

      expect(result.iCalUID).toBe(customUId);
    });

    test("should promote onlineMeeting.joinUrl to response url when present", async () => {
      const service = BuildCalendarService(mockCredential);
      const event = createMockCalendarServiceEvent();

      setupMockRequestRaw([
        {
          urlPattern: "/calendars/calendar-1/events",
          method: "POST",
          response: () => createMockGraphResponse(mockTeamsGraphEvent),
        },
      ]);

      const result = await service.createEvent(event, 1);

      expect(result.url).toBe("https://teams.microsoft.com/l/meetup-join/19%3ameeting_test");
    });

    test("should throw on JSON error response", async () => {
      const service = BuildCalendarService(mockCredential);
      const event = createMockCalendarServiceEvent();

      setupMockRequestRaw([
        {
          urlPattern: "/calendars/calendar-1/events",
          method: "POST",
          response: () =>
            createMockGraphResponse({ error: { code: "BadRequest", message: "Invalid payload" } }, 400),
        },
      ]);

      await expect(service.createEvent(event, 1)).rejects.toThrow();
    });

    test("should select correct destination calendar by credentialId matching", async () => {
      const service = BuildCalendarService(mockCredential);
      const event = createMockCalendarServiceEvent({
        destinationCalendar: [
          { credentialId: 999, externalId: "wrong-calendar", integration: "office365_calendar" },
          { credentialId: 1, externalId: "correct-calendar", integration: "office365_calendar" },
        ],
      });

      setupMockRequestRaw([
        {
          urlPattern: "/calendars/correct-calendar/events",
          method: "POST",
          response: () => createMockGraphResponse(mockGraphEvent),
        },
      ]);

      await service.createEvent(event, 1);

      const callArgs = mockRequestRaw.mock.calls[0][0];
      expect(callArgs.url).toContain("/calendars/correct-calendar/events");
    });
  });

  // =========================================================================
  // updateEvent
  // =========================================================================
  describe("updateEvent", () => {
    test("should PATCH event at correct endpoint", async () => {
      const service = BuildCalendarService(mockCredential);
      const event = createMockCalendarServiceEvent();

      setupMockRequestRaw([
        {
          urlPattern: "/calendar/events/event-uid-123",
          method: "PATCH",
          response: () => createMockGraphResponse(mockGraphEvent),
        },
        {
          urlPattern: "/calendar/events/event-uid-123",
          method: "GET",
          response: () => createMockGraphResponse(mockGraphEvent),
        },
      ]);

      const result = await service.updateEvent("event-uid-123", event);

      // Find the PATCH call
      const patchCall = mockRequestRaw.mock.calls.find(
        (call) => call[0].options?.method === "PATCH"
      );
      expect(patchCall).toBeDefined();
      expect(patchCall![0].url).toContain("/calendar/events/event-uid-123");
      expect(result.iCalUID).toBe(mockGraphEvent.iCalUId);
    });

    test("should preserve existing HTML body for Teams meetings during rescheduling", async () => {
      const service = BuildCalendarService(mockCredential);
      const teamsHtmlBody =
        '<div>Original Teams Meeting</div><div class="me-email-text">Join Microsoft Teams Meeting</div>';
      const event = createMockCalendarServiceEvent({
        location: "integrations:office365_video",
      });

      setupMockRequestRaw([
        {
          urlPattern: "/calendar/events/event-uid-teams",
          method: "GET",
          response: () =>
            createMockGraphResponse({
              ...mockGraphEvent,
              isOnlineMeeting: true,
              body: { contentType: "html", content: teamsHtmlBody },
            }),
        },
        {
          urlPattern: "/calendar/events/event-uid-teams",
          method: "PATCH",
          response: () => createMockGraphResponse(mockTeamsGraphEvent),
        },
      ]);

      await service.updateEvent("event-uid-teams", event);

      // Verify GET was called first to retrieve existing event
      const getCall = mockRequestRaw.mock.calls.find(
        (call) => call[0].options?.method === "GET"
      );
      expect(getCall).toBeDefined();

      // Verify PATCH was called with preserved Teams body
      const patchCall = mockRequestRaw.mock.calls.find(
        (call) => call[0].options?.method === "PATCH"
      );
      expect(patchCall).toBeDefined();
      const patchBody = JSON.parse(patchCall![0].options.body);
      // The preserved body should contain the original Teams HTML
      expect(patchBody.body.content).toContain(teamsHtmlBody);
      expect(patchBody.body.contentType).toBe("html");
    });

    test("should use rich description when no Teams body in existing event", async () => {
      const service = BuildCalendarService(mockCredential);
      const event = createMockCalendarServiceEvent({
        location: "integrations:office365_video",
      });

      setupMockRequestRaw([
        {
          urlPattern: "/calendar/events/event-uid-noteams",
          method: "GET",
          response: () =>
            createMockGraphResponse({
              ...mockGraphEvent,
              isOnlineMeeting: false,
              body: { contentType: "text", content: "plain text body" },
            }),
        },
        {
          urlPattern: "/calendar/events/event-uid-noteams",
          method: "PATCH",
          response: () => createMockGraphResponse(mockGraphEvent),
        },
      ]);

      await service.updateEvent("event-uid-noteams", event);

      const patchCall = mockRequestRaw.mock.calls.find(
        (call) => call[0].options?.method === "PATCH"
      );
      expect(patchCall).toBeDefined();
      const patchBody = JSON.parse(patchCall![0].options.body);
      // Body should use HTML contentType for Teams location events
      expect(patchBody.body.contentType).toBe("html");
    });

    test("should promote onlineMeeting.joinUrl on update response", async () => {
      const service = BuildCalendarService(mockCredential);
      const event = createMockCalendarServiceEvent();

      setupMockRequestRaw([
        {
          urlPattern: "/calendar/events/",
          method: "PATCH",
          response: () => createMockGraphResponse(mockTeamsGraphEvent),
        },
      ]);

      const result = await service.updateEvent("event-uid-123", event);

      expect(result.url).toBe("https://teams.microsoft.com/l/meetup-join/19%3ameeting_test");
    });
  });

  // =========================================================================
  // deleteEvent
  // =========================================================================
  describe("deleteEvent", () => {
    test("should DELETE event at correct endpoint", async () => {
      const service = BuildCalendarService(mockCredential);

      setupMockRequestRaw([
        {
          urlPattern: "/calendar/events/event-uid-delete",
          method: "DELETE",
          response: () => createMock204Response(),
        },
      ]);

      await service.deleteEvent("event-uid-delete");

      const callArgs = mockRequestRaw.mock.calls[0][0];
      expect(callArgs.url).toBe(`${API_GRAPH_URL}/me/calendar/events/event-uid-delete`);
      expect(callArgs.options.method).toBe("DELETE");
    });

    test("should use /me/calendar/events/{uid} endpoint pattern", async () => {
      const service = BuildCalendarService(mockCredential);
      const uid = "AAMk-test-uid-456";

      setupMockRequestRaw([
        {
          urlPattern: `/calendar/events/${uid}`,
          method: "DELETE",
          response: () => createMock204Response(),
        },
      ]);

      await service.deleteEvent(uid);

      expect(mockRequestRaw.mock.calls[0][0].url).toBe(
        `${API_GRAPH_URL}/me/calendar/events/${uid}`
      );
    });

    test("should handle deletion of non-existent event gracefully (404)", async () => {
      const service = BuildCalendarService(mockCredential);

      setupMockRequestRaw([
        {
          urlPattern: "/calendar/events/nonexistent",
          method: "DELETE",
          response: () =>
            new Response("Not Found", {
              status: 404,
              statusText: "Not Found",
              headers: new Headers({ "Content-Type": "text/plain" }),
            }),
        },
      ]);

      // handleErrorsRaw throws for non-2xx responses
      await expect(service.deleteEvent("nonexistent")).rejects.toThrow();
    });
  });

  // =========================================================================
  // getAvailability — batch API, processBusyTimes, status filtering
  // =========================================================================
  describe("getAvailability", () => {
    /**
     * Helper to create selectedCalendars that match office365_calendar integration
     * so getAvailability uses them directly without calling listCalendars.
     */
    function makeSelectedCalendars(ids: string[]) {
      return ids.map((id) => ({
        integration: "office365_calendar",
        externalId: id,
        userId: 1,
        credentialId: 1,
      }));
    }

    test("should POST batch requests to /$batch endpoint", async () => {
      const service = BuildCalendarService(mockCredential);

      setupMockRequestRaw([
        {
          urlPattern: "/$batch",
          method: "POST",
          response: () =>
            createMockBatchResponse({
              responses: [
                {
                  id: "0",
                  status: 200,
                  headers: { "Retry-After": "", "Content-Type": "application/json" },
                  body: { value: [] },
                },
              ],
            }),
        },
      ]);

      await service.getAvailability({
        dateFrom: "2024-01-15T00:00:00Z",
        dateTo: "2024-01-16T00:00:00Z",
        selectedCalendars: makeSelectedCalendars(["cal-1"]),
        mode: "slots" as const,
      });

      const batchCall = mockRequestRaw.mock.calls.find((call) => call[0].url.includes("/$batch"));
      expect(batchCall).toBeDefined();
      expect(batchCall![0].options.method).toBe("POST");

      const batchBody = JSON.parse(batchCall![0].options.body);
      expect(batchBody.requests).toHaveLength(1);
      expect(batchBody.requests[0].method).toBe("GET");
      expect(batchBody.requests[0].url).toContain("/me/calendars/cal-1/calendarView");
    });

    test("should construct correct calendarView URLs with date range and select params", async () => {
      const service = BuildCalendarService(mockCredential);

      setupMockRequestRaw([
        {
          urlPattern: "/$batch",
          method: "POST",
          response: () =>
            createMockBatchResponse({
              responses: [
                {
                  id: "0",
                  status: 200,
                  headers: { "Retry-After": "", "Content-Type": "application/json" },
                  body: { value: [] },
                },
                {
                  id: "1",
                  status: 200,
                  headers: { "Retry-After": "", "Content-Type": "application/json" },
                  body: { value: [] },
                },
              ],
            }),
        },
      ]);

      await service.getAvailability({
        dateFrom: "2024-01-15T00:00:00Z",
        dateTo: "2024-01-16T00:00:00Z",
        selectedCalendars: makeSelectedCalendars(["cal-1", "cal-2"]),
        mode: "slots" as const,
      });

      const batchCall = mockRequestRaw.mock.calls.find((call) => call[0].url.includes("/$batch"));
      const batchBody = JSON.parse(batchCall![0].options.body);
      expect(batchBody.requests).toHaveLength(2);

      // Verify date range and select params in URLs
      for (const req of batchBody.requests) {
        expect(req.url).toContain("startDateTime=");
        expect(req.url).toContain("endDateTime=");
        expect(req.url).toContain("$select=showAs,start,end");
        expect(req.url).toContain("$top=999");
      }
    });

    test("should include 'busy' events in availability results", async () => {
      const service = BuildCalendarService(mockCredential);

      setupMockRequestRaw([
        {
          urlPattern: "/$batch",
          method: "POST",
          response: () =>
            createMockBatchResponse({
              responses: [
                {
                  id: "0",
                  status: 200,
                  headers: { "Retry-After": "", "Content-Type": "application/json" },
                  body: {
                    value: [
                      {
                        showAs: "busy",
                        start: { dateTime: "2024-01-15T10:00:00" },
                        end: { dateTime: "2024-01-15T11:00:00" },
                      },
                    ],
                  },
                },
              ],
            }),
        },
      ]);

      const result = await service.getAvailability({
        dateFrom: "2024-01-15T00:00:00Z",
        dateTo: "2024-01-16T00:00:00Z",
        selectedCalendars: makeSelectedCalendars(["cal-1"]),
        mode: "slots" as const,
      });

      expect(result).toHaveLength(1);
      expect(result[0].start).toBe("2024-01-15T10:00:00Z");
      expect(result[0].end).toBe("2024-01-15T11:00:00Z");
    });

    test("should include 'tentative' events in availability results", async () => {
      const service = BuildCalendarService(mockCredential);

      setupMockRequestRaw([
        {
          urlPattern: "/$batch",
          method: "POST",
          response: () =>
            createMockBatchResponse({
              responses: [
                {
                  id: "0",
                  status: 200,
                  headers: { "Retry-After": "", "Content-Type": "application/json" },
                  body: {
                    value: [
                      {
                        showAs: "tentative",
                        start: { dateTime: "2024-01-15T14:00:00" },
                        end: { dateTime: "2024-01-15T15:00:00" },
                      },
                    ],
                  },
                },
              ],
            }),
        },
      ]);

      const result = await service.getAvailability({
        dateFrom: "2024-01-15T00:00:00Z",
        dateTo: "2024-01-16T00:00:00Z",
        selectedCalendars: makeSelectedCalendars(["cal-1"]),
        mode: "slots" as const,
      });

      expect(result).toHaveLength(1);
      expect(result[0].start).toBe("2024-01-15T14:00:00Z");
    });

    test("should include 'oof' (Out of Office) events in availability results", async () => {
      const service = BuildCalendarService(mockCredential);

      setupMockRequestRaw([
        {
          urlPattern: "/$batch",
          method: "POST",
          response: () =>
            createMockBatchResponse({
              responses: [
                {
                  id: "0",
                  status: 200,
                  headers: { "Retry-After": "", "Content-Type": "application/json" },
                  body: {
                    value: [
                      {
                        showAs: "oof",
                        start: { dateTime: "2024-01-15T09:00:00" },
                        end: { dateTime: "2024-01-15T17:00:00" },
                      },
                    ],
                  },
                },
              ],
            }),
        },
      ]);

      const result = await service.getAvailability({
        dateFrom: "2024-01-15T00:00:00Z",
        dateTo: "2024-01-16T00:00:00Z",
        selectedCalendars: makeSelectedCalendars(["cal-1"]),
        mode: "slots" as const,
      });

      expect(result).toHaveLength(1);
    });

    test("should skip 'free' events from availability results", async () => {
      const service = BuildCalendarService(mockCredential);

      setupMockRequestRaw([
        {
          urlPattern: "/$batch",
          method: "POST",
          response: () =>
            createMockBatchResponse({
              responses: [
                {
                  id: "0",
                  status: 200,
                  headers: { "Retry-After": "", "Content-Type": "application/json" },
                  body: {
                    value: [
                      {
                        showAs: "free",
                        start: { dateTime: "2024-01-15T10:00:00" },
                        end: { dateTime: "2024-01-15T11:00:00" },
                      },
                    ],
                  },
                },
              ],
            }),
        },
      ]);

      const result = await service.getAvailability({
        dateFrom: "2024-01-15T00:00:00Z",
        dateTo: "2024-01-16T00:00:00Z",
        selectedCalendars: makeSelectedCalendars(["cal-1"]),
        mode: "slots" as const,
      });

      expect(result).toHaveLength(0);
    });

    test("should skip 'workingElsewhere' events from availability results", async () => {
      const service = BuildCalendarService(mockCredential);

      setupMockRequestRaw([
        {
          urlPattern: "/$batch",
          method: "POST",
          response: () =>
            createMockBatchResponse({
              responses: [
                {
                  id: "0",
                  status: 200,
                  headers: { "Retry-After": "", "Content-Type": "application/json" },
                  body: {
                    value: [
                      {
                        showAs: "workingElsewhere",
                        start: { dateTime: "2024-01-15T10:00:00" },
                        end: { dateTime: "2024-01-15T11:00:00" },
                      },
                    ],
                  },
                },
              ],
            }),
        },
      ]);

      const result = await service.getAvailability({
        dateFrom: "2024-01-15T00:00:00Z",
        dateTo: "2024-01-16T00:00:00Z",
        selectedCalendars: makeSelectedCalendars(["cal-1"]),
        mode: "slots" as const,
      });

      expect(result).toHaveLength(0);
    });

    test("should append 'Z' suffix to dateTime values for UTC consistency", async () => {
      const service = BuildCalendarService(mockCredential);

      setupMockRequestRaw([
        {
          urlPattern: "/$batch",
          method: "POST",
          response: () =>
            createMockBatchResponse({
              responses: [
                {
                  id: "0",
                  status: 200,
                  headers: { "Retry-After": "", "Content-Type": "application/json" },
                  body: {
                    value: [
                      {
                        showAs: "busy",
                        start: { dateTime: "2024-01-15T10:30:00" },
                        end: { dateTime: "2024-01-15T11:30:00" },
                      },
                    ],
                  },
                },
              ],
            }),
        },
      ]);

      const result = await service.getAvailability({
        dateFrom: "2024-01-15T00:00:00Z",
        dateTo: "2024-01-16T00:00:00Z",
        selectedCalendars: makeSelectedCalendars(["cal-1"]),
        mode: "slots" as const,
      });

      expect(result[0].start).toBe("2024-01-15T10:30:00Z");
      expect(result[0].end).toBe("2024-01-15T11:30:00Z");
    });

    test("should handle empty body.value gracefully", async () => {
      const service = BuildCalendarService(mockCredential);

      setupMockRequestRaw([
        {
          urlPattern: "/$batch",
          method: "POST",
          response: () =>
            createMockBatchResponse({
              responses: [
                {
                  id: "0",
                  status: 200,
                  headers: { "Retry-After": "", "Content-Type": "application/json" },
                  body: {},
                },
              ],
            }),
        },
      ]);

      const result = await service.getAvailability({
        dateFrom: "2024-01-15T00:00:00Z",
        dateTo: "2024-01-16T00:00:00Z",
        selectedCalendars: makeSelectedCalendars(["cal-1"]),
        mode: "slots" as const,
      });

      expect(result).toHaveLength(0);
    });

    test("should handle body with error instead of value", async () => {
      const service = BuildCalendarService(mockCredential);

      setupMockRequestRaw([
        {
          urlPattern: "/$batch",
          method: "POST",
          response: () =>
            createMockBatchResponse({
              responses: [
                {
                  id: "0",
                  status: 200,
                  headers: { "Retry-After": "", "Content-Type": "application/json" },
                  body: { error: { code: "ErrorAccessDenied", message: "Access denied" } },
                },
              ],
            }),
        },
      ]);

      const result = await service.getAvailability({
        dateFrom: "2024-01-15T00:00:00Z",
        dateTo: "2024-01-16T00:00:00Z",
        selectedCalendars: makeSelectedCalendars(["cal-1"]),
        mode: "slots" as const,
      });

      // Error sub-responses have no body.value, so they are skipped
      expect(result).toHaveLength(0);
    });

    test("should return empty array when only non-matching integration calendars selected", async () => {
      const service = BuildCalendarService(mockCredential);

      const result = await service.getAvailability({
        dateFrom: "2024-01-15T00:00:00Z",
        dateTo: "2024-01-16T00:00:00Z",
        selectedCalendars: [
          { integration: "google_calendar", externalId: "gcal-1", userId: 1, credentialId: 2 },
        ],
        mode: "slots" as const,
      });

      // No office365_calendar integration calendars → early return []
      expect(result).toEqual([]);
      expect(mockRequestRaw).not.toHaveBeenCalled();
    });

    test("should handle multiple sub-responses in batch", async () => {
      const service = BuildCalendarService(mockCredential);

      setupMockRequestRaw([
        {
          urlPattern: "/$batch",
          method: "POST",
          response: () =>
            createMockBatchResponse({
              responses: [
                {
                  id: "0",
                  status: 200,
                  headers: { "Retry-After": "", "Content-Type": "application/json" },
                  body: {
                    value: [
                      {
                        showAs: "busy",
                        start: { dateTime: "2024-01-15T10:00:00" },
                        end: { dateTime: "2024-01-15T11:00:00" },
                      },
                    ],
                  },
                },
                {
                  id: "1",
                  status: 200,
                  headers: { "Retry-After": "", "Content-Type": "application/json" },
                  body: {
                    value: [
                      {
                        showAs: "busy",
                        start: { dateTime: "2024-01-15T14:00:00" },
                        end: { dateTime: "2024-01-15T15:00:00" },
                      },
                    ],
                  },
                },
              ],
            }),
        },
      ]);

      const result = await service.getAvailability({
        dateFrom: "2024-01-15T00:00:00Z",
        dateTo: "2024-01-16T00:00:00Z",
        selectedCalendars: makeSelectedCalendars(["cal-1", "cal-2"]),
        mode: "slots" as const,
      });

      expect(result).toHaveLength(2);
      expect(result[0].start).toBe("2024-01-15T10:00:00Z");
      expect(result[1].start).toBe("2024-01-15T14:00:00Z");
    });

    test("should filter mixed showAs statuses correctly", async () => {
      const service = BuildCalendarService(mockCredential);

      setupMockRequestRaw([
        {
          urlPattern: "/$batch",
          method: "POST",
          response: () =>
            createMockBatchResponse({
              responses: [
                {
                  id: "0",
                  status: 200,
                  headers: { "Retry-After": "", "Content-Type": "application/json" },
                  body: {
                    value: [
                      { showAs: "busy", start: { dateTime: "2024-01-15T09:00:00" }, end: { dateTime: "2024-01-15T10:00:00" } },
                      { showAs: "free", start: { dateTime: "2024-01-15T10:00:00" }, end: { dateTime: "2024-01-15T11:00:00" } },
                      { showAs: "tentative", start: { dateTime: "2024-01-15T11:00:00" }, end: { dateTime: "2024-01-15T12:00:00" } },
                      { showAs: "workingElsewhere", start: { dateTime: "2024-01-15T12:00:00" }, end: { dateTime: "2024-01-15T13:00:00" } },
                      { showAs: "oof", start: { dateTime: "2024-01-15T13:00:00" }, end: { dateTime: "2024-01-15T14:00:00" } },
                    ],
                  },
                },
              ],
            }),
        },
      ]);

      const result = await service.getAvailability({
        dateFrom: "2024-01-15T00:00:00Z",
        dateTo: "2024-01-16T00:00:00Z",
        selectedCalendars: makeSelectedCalendars(["cal-1"]),
        mode: "slots" as const,
      });

      // busy, tentative, oof included; free, workingElsewhere excluded
      expect(result).toHaveLength(3);
      expect(result.map((r) => r.start)).toEqual([
        "2024-01-15T09:00:00Z",
        "2024-01-15T11:00:00Z",
        "2024-01-15T13:00:00Z",
      ]);
    });
  });

  // =========================================================================
  // fetchRequestWithRetryAfter — rate limiting (via getAvailability)
  // =========================================================================
  describe("rate limiting (fetchRequestWithRetryAfter)", () => {
    function makeSelectedCalendars(ids: string[]) {
      return ids.map((id) => ({
        integration: "office365_calendar",
        externalId: id,
        userId: 1,
        credentialId: 1,
      }));
    }

    test("should retry batch requests that return 429 status", async () => {
      const service = BuildCalendarService(mockCredential);
      let callCount = 0;

      mockRequestRaw.mockImplementation(
        ({ url, options }: { url: string; options?: RequestInit }): Promise<Response> => {
          if (url.includes("/$batch")) {
            callCount++;
            if (callCount === 1) {
              // First batch call: calendar-1 succeeds, calendar-2 gets 429
              return Promise.resolve(
                createMockBatchResponse({
                  responses: [
                    {
                      id: "0",
                      status: 200,
                      headers: { "Retry-After": "", "Content-Type": "application/json" },
                      body: {
                        value: [
                          { showAs: "busy", start: { dateTime: "2024-01-15T10:00:00" }, end: { dateTime: "2024-01-15T11:00:00" } },
                        ],
                      },
                    },
                    {
                      id: "1",
                      status: 429,
                      headers: { "Retry-After": "0", "Content-Type": "application/json" },
                      body: {},
                    },
                  ],
                })
              );
            }
            // Retry batch call: calendar-2 now succeeds
            return Promise.resolve(
              createMockBatchResponse({
                responses: [
                  {
                    id: "0",
                    status: 200,
                    headers: { "Retry-After": "", "Content-Type": "application/json" },
                    body: {
                      value: [
                        { showAs: "busy", start: { dateTime: "2024-01-15T14:00:00" }, end: { dateTime: "2024-01-15T15:00:00" } },
                      ],
                    },
                  },
                ],
              })
            );
          }
          return Promise.resolve(createMockGraphResponse({}));
        }
      );

      const result = await service.getAvailability({
        dateFrom: "2024-01-15T00:00:00Z",
        dateTo: "2024-01-16T00:00:00Z",
        selectedCalendars: makeSelectedCalendars(["cal-1", "cal-2"]),
        mode: "slots" as const,
      });

      // Verify batch was called twice (initial + retry)
      const batchCalls = mockRequestRaw.mock.calls.filter((call) =>
        call[0].url.includes("/$batch")
      );
      expect(batchCalls.length).toBe(2);

      // Results should include events from both successful responses
      expect(result.length).toBeGreaterThanOrEqual(1);
    });

    test("should stop retrying after maxRetries", async () => {
      const service = BuildCalendarService(mockCredential);

      // All batch responses return 429
      mockRequestRaw.mockImplementation(
        ({ url }: { url: string }): Promise<Response> => {
          if (url.includes("/$batch")) {
            return Promise.resolve(
              createMockBatchResponse({
                responses: [
                  {
                    id: "0",
                    status: 429,
                    headers: { "Retry-After": "0", "Content-Type": "application/json" },
                    body: { error: { code: "TooManyRequests", message: "Rate limit exceeded" } },
                  },
                ],
              })
            );
          }
          return Promise.resolve(createMockGraphResponse({}));
        }
      );

      const result = await service.getAvailability({
        dateFrom: "2024-01-15T00:00:00Z",
        dateTo: "2024-01-16T00:00:00Z",
        selectedCalendars: makeSelectedCalendars(["cal-1"]),
        mode: "slots" as const,
      });

      // After max retries (2), should return whatever it has (empty/429 responses)
      const batchCalls = mockRequestRaw.mock.calls.filter((call) =>
        call[0].url.includes("/$batch")
      );
      // Initial call + up to 2 retries = at most 3 calls
      expect(batchCalls.length).toBeLessThanOrEqual(3);
      // 429 responses have no value, so result is empty
      expect(result).toHaveLength(0);
    });

    test("should preserve already-successful responses during retry", async () => {
      const service = BuildCalendarService(mockCredential);
      let batchCallCount = 0;

      mockRequestRaw.mockImplementation(
        ({ url }: { url: string }): Promise<Response> => {
          if (url.includes("/$batch")) {
            batchCallCount++;
            if (batchCallCount === 1) {
              return Promise.resolve(
                createMockBatchResponse({
                  responses: [
                    {
                      id: "0",
                      status: 200,
                      headers: { "Retry-After": "", "Content-Type": "application/json" },
                      body: {
                        value: [
                          { showAs: "busy", start: { dateTime: "2024-01-15T09:00:00" }, end: { dateTime: "2024-01-15T10:00:00" } },
                        ],
                      },
                    },
                    {
                      id: "1",
                      status: 429,
                      headers: { "Retry-After": "0", "Content-Type": "application/json" },
                      body: {},
                    },
                    {
                      id: "2",
                      status: 200,
                      headers: { "Retry-After": "", "Content-Type": "application/json" },
                      body: {
                        value: [
                          { showAs: "busy", start: { dateTime: "2024-01-15T16:00:00" }, end: { dateTime: "2024-01-15T17:00:00" } },
                        ],
                      },
                    },
                  ],
                })
              );
            }
            // Retry: the failed calendar now succeeds
            return Promise.resolve(
              createMockBatchResponse({
                responses: [
                  {
                    id: "0",
                    status: 200,
                    headers: { "Retry-After": "", "Content-Type": "application/json" },
                    body: {
                      value: [
                        { showAs: "busy", start: { dateTime: "2024-01-15T12:00:00" }, end: { dateTime: "2024-01-15T13:00:00" } },
                      ],
                    },
                  },
                ],
              })
            );
          }
          return Promise.resolve(createMockGraphResponse({}));
        }
      );

      const result = await service.getAvailability({
        dateFrom: "2024-01-15T00:00:00Z",
        dateTo: "2024-01-16T00:00:00Z",
        selectedCalendars: makeSelectedCalendars(["cal-1", "cal-2", "cal-3"]),
        mode: "slots" as const,
      });

      // Should include events from all successful responses
      // cal-1: 09:00-10:00, cal-3: 16:00-17:00, cal-2 retry: 12:00-13:00
      expect(result.length).toBeGreaterThanOrEqual(2);
    });
  });

  // =========================================================================
  // translateEvent — tested indirectly via createEvent
  // =========================================================================
  describe("translateEvent (via createEvent)", () => {
    test("should set isOnlineMeeting=true for MSTeams location type", async () => {
      const service = BuildCalendarService(mockCredential);
      const event = createMockCalendarServiceEvent({
        location: "integrations:office365_video",
      });

      setupMockRequestRaw([
        {
          urlPattern: "/calendars/calendar-1/events",
          method: "POST",
          response: () => createMockGraphResponse(mockTeamsGraphEvent),
        },
      ]);

      await service.createEvent(event, 1);

      const callArgs = mockRequestRaw.mock.calls[0][0];
      const requestBody = JSON.parse(callArgs.options.body);
      expect(requestBody.isOnlineMeeting).toBe(true);
      expect(requestBody.onlineMeetingProvider).toBe("teamsForBusiness");
    });

    test("should NOT set isOnlineMeeting for non-Teams locations", async () => {
      const service = BuildCalendarService(mockCredential);
      const event = createMockCalendarServiceEvent({
        location: "123 Main St, Anytown, USA",
      });

      setupMockRequestRaw([
        {
          urlPattern: "/calendars/calendar-1/events",
          method: "POST",
          response: () => createMockGraphResponse(mockGraphEvent),
        },
      ]);

      await service.createEvent(event, 1);

      const callArgs = mockRequestRaw.mock.calls[0][0];
      const requestBody = JSON.parse(callArgs.options.body);
      expect(requestBody.isOnlineMeeting).toBeUndefined();
      expect(requestBody.onlineMeetingProvider).toBeUndefined();
    });

    test("should format event body with text contentType for non-Teams events", async () => {
      const service = BuildCalendarService(mockCredential);
      const event = createMockCalendarServiceEvent({
        location: null,
        calendarDescription: "Plain text description for the event",
      });

      setupMockRequestRaw([
        {
          urlPattern: "/calendars/calendar-1/events",
          method: "POST",
          response: () => createMockGraphResponse(mockGraphEvent),
        },
      ]);

      await service.createEvent(event, 1);

      const callArgs = mockRequestRaw.mock.calls[0][0];
      const requestBody = JSON.parse(callArgs.options.body);
      expect(requestBody.body.contentType).toBe("text");
      expect(requestBody.body.content).toBe("Plain text description for the event");
    });

    test("should format event body with HTML contentType for Teams events", async () => {
      const service = BuildCalendarService(mockCredential);
      const event = createMockCalendarServiceEvent({
        location: "integrations:office365_video",
      });

      setupMockRequestRaw([
        {
          urlPattern: "/calendars/calendar-1/events",
          method: "POST",
          response: () => createMockGraphResponse(mockTeamsGraphEvent),
        },
      ]);

      await service.createEvent(event, 1);

      const callArgs = mockRequestRaw.mock.calls[0][0];
      const requestBody = JSON.parse(callArgs.options.body);
      expect(requestBody.body.contentType).toBe("html");
    });

    test("should set sensitivity to 'private' when hideCalendarEventDetails is true", async () => {
      const service = BuildCalendarService(mockCredential);
      const event = createMockCalendarServiceEvent({
        hideCalendarEventDetails: true,
      });

      setupMockRequestRaw([
        {
          urlPattern: "/calendars/calendar-1/events",
          method: "POST",
          response: () => createMockGraphResponse(mockGraphEvent),
        },
      ]);

      await service.createEvent(event, 1);

      const callArgs = mockRequestRaw.mock.calls[0][0];
      const requestBody = JSON.parse(callArgs.options.body);
      expect(requestBody.sensitivity).toBe("private");
    });

    test("should NOT set sensitivity when hideCalendarEventDetails is falsy", async () => {
      const service = BuildCalendarService(mockCredential);
      const event = createMockCalendarServiceEvent({
        hideCalendarEventDetails: false,
      });

      setupMockRequestRaw([
        {
          urlPattern: "/calendars/calendar-1/events",
          method: "POST",
          response: () => createMockGraphResponse(mockGraphEvent),
        },
      ]);

      await service.createEvent(event, 1);

      const callArgs = mockRequestRaw.mock.calls[0][0];
      const requestBody = JSON.parse(callArgs.options.body);
      expect(requestBody.sensitivity).toBeUndefined();
    });

    test("should include team members in attendees array when present", async () => {
      const service = BuildCalendarService(mockCredential);
      const event = createMockCalendarServiceEvent({
        team: {
          name: "Test Team",
          id: 1,
          members: [
            {
              id: 2,
              name: "Team Member",
              email: "member@example.com",
              timeZone: "UTC",
              language: { translate: (key: string) => key, locale: "en" },
            },
          ],
        },
      });

      setupMockRequestRaw([
        {
          urlPattern: "/calendars/calendar-1/events",
          method: "POST",
          response: () => createMockGraphResponse(mockGraphEvent),
        },
      ]);

      await service.createEvent(event, 1);

      const callArgs = mockRequestRaw.mock.calls[0][0];
      const requestBody = JSON.parse(callArgs.options.body);

      // Regular attendees + team members (excluding credential user)
      const attendeeEmails = requestBody.attendees.map(
        (a: { emailAddress: { address: string } }) => a.emailAddress.address
      );
      expect(attendeeEmails).toContain("attendee1@example.com");
      expect(attendeeEmails).toContain("member@example.com");
    });

    test("should not include team members whose email matches credential user email", async () => {
      const service = BuildCalendarService(mockCredential);
      const event = createMockCalendarServiceEvent({
        team: {
          name: "Test Team",
          id: 1,
          members: [
            {
              id: 1,
              name: "Credential User",
              email: "user@example.com", // Same as mockCredential.user.email
              timeZone: "UTC",
              language: { translate: (key: string) => key, locale: "en" },
            },
            {
              id: 2,
              name: "Other Member",
              email: "other@example.com",
              timeZone: "UTC",
              language: { translate: (key: string) => key, locale: "en" },
            },
          ],
        },
      });

      setupMockRequestRaw([
        {
          urlPattern: "/calendars/calendar-1/events",
          method: "POST",
          response: () => createMockGraphResponse(mockGraphEvent),
        },
      ]);

      await service.createEvent(event, 1);

      const callArgs = mockRequestRaw.mock.calls[0][0];
      const requestBody = JSON.parse(callArgs.options.body);
      const attendeeEmails = requestBody.attendees.map(
        (a: { emailAddress: { address: string } }) => a.emailAddress.address
      );
      // Credential user should be excluded from team members
      expect(attendeeEmails).not.toContain("user@example.com");
      expect(attendeeEmails).toContain("other@example.com");
    });

    test("should format start/end datetimes using organizer timezone", async () => {
      const service = BuildCalendarService(mockCredential);
      const event = createMockCalendarServiceEvent({
        organizer: {
          id: 1,
          name: "Test Organizer",
          email: "organizer@example.com",
          timeZone: "America/New_York",
          language: { translate: (key: string) => key, locale: "en" },
        },
        startTime: "2024-06-15T14:00:00Z",
        endTime: "2024-06-15T15:00:00Z",
      });

      setupMockRequestRaw([
        {
          urlPattern: "/calendars/calendar-1/events",
          method: "POST",
          response: () => createMockGraphResponse(mockGraphEvent),
        },
      ]);

      await service.createEvent(event, 1);

      const callArgs = mockRequestRaw.mock.calls[0][0];
      const requestBody = JSON.parse(callArgs.options.body);
      expect(requestBody.start.timeZone).toBe("America/New_York");
      expect(requestBody.end.timeZone).toBe("America/New_York");
      // The dateTime should be formatted in the organizer's timezone
      expect(requestBody.start.dateTime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
    });

    test("should set event subject from event title", async () => {
      const service = BuildCalendarService(mockCredential);
      const event = createMockCalendarServiceEvent({ title: "Important Board Meeting" });

      setupMockRequestRaw([
        {
          urlPattern: "/calendars/calendar-1/events",
          method: "POST",
          response: () => createMockGraphResponse(mockGraphEvent),
        },
      ]);

      await service.createEvent(event, 1);

      const callArgs = mockRequestRaw.mock.calls[0][0];
      const requestBody = JSON.parse(callArgs.options.body);
      expect(requestBody.subject).toBe("Important Board Meeting");
    });

    test("should include location displayName when location is provided", async () => {
      const service = BuildCalendarService(mockCredential);
      const event = createMockCalendarServiceEvent({
        location: "Conference Room A",
      });

      setupMockRequestRaw([
        {
          urlPattern: "/calendars/calendar-1/events",
          method: "POST",
          response: () => createMockGraphResponse(mockGraphEvent),
        },
      ]);

      await service.createEvent(event, 1);

      const callArgs = mockRequestRaw.mock.calls[0][0];
      const requestBody = JSON.parse(callArgs.options.body);
      expect(requestBody.location).toBeDefined();
      expect(requestBody.location.displayName).toBeDefined();
    });
  });

  // =========================================================================
  // listCalendars
  // =========================================================================
  describe("listCalendars", () => {
    test("should return normalized IntegrationCalendar objects", async () => {
      const service = BuildCalendarService(mockCredential);

      setupMockRequestRaw([
        {
          urlPattern: "/me/calendars",
          method: "GET",
          response: () => createMockGraphResponse(mockCalendarListResponse),
        },
        {
          urlPattern: /\/me$/,
          method: "GET",
          response: () => createMockGraphResponse({ mail: "mailbox@example.com" }),
        },
      ]);

      const calendars = await service.listCalendars();

      expect(calendars).toHaveLength(2);
      expect(calendars[0]).toEqual(
        expect.objectContaining({
          externalId: "calendar-1",
          integration: "office365_calendar",
          name: "My Calendar",
          primary: true,
          email: "mailbox@example.com",
        })
      );
      expect(calendars[1]).toEqual(
        expect.objectContaining({
          externalId: "calendar-2",
          integration: "office365_calendar",
          name: "Work Calendar",
          primary: false,
          email: "mailbox@example.com",
        })
      );
    });

    test("should follow @odata.nextLink for paginated calendar lists", async () => {
      const service = BuildCalendarService(mockCredential);
      let calendarFetchCount = 0;

      mockRequestRaw.mockImplementation(
        ({ url }: { url: string }): Promise<Response> => {
          if (url.includes("/me/calendars") || url.includes("nextpage")) {
            calendarFetchCount++;
            if (calendarFetchCount === 1) {
              return Promise.resolve(
                createMockGraphResponse({
                  value: [{ id: "cal-page1", name: "Page 1 Cal", isDefaultCalendar: true, canEdit: true }],
                  "@odata.nextLink": `${API_GRAPH_URL}/me/calendars?$skiptoken=abc123`,
                })
              );
            }
            return Promise.resolve(
              createMockGraphResponse({
                value: [{ id: "cal-page2", name: "Page 2 Cal", isDefaultCalendar: false, canEdit: true }],
              })
            );
          }
          if (url.match(/\/me$/)) {
            return Promise.resolve(
              createMockGraphResponse({ mail: "user@example.com" })
            );
          }
          return Promise.resolve(createMockGraphResponse({}));
        }
      );

      const calendars = await service.listCalendars();

      expect(calendars).toHaveLength(2);
      expect(calendars[0].externalId).toBe("cal-page1");
      expect(calendars[1].externalId).toBe("cal-page2");
    });

    test("should augment calendars with user mailbox email", async () => {
      const service = BuildCalendarService(mockCredential);

      setupMockRequestRaw([
        {
          urlPattern: "/me/calendars",
          method: "GET",
          response: () =>
            createMockGraphResponse({
              value: [{ id: "cal-1", name: "Test", isDefaultCalendar: true, canEdit: true }],
            }),
        },
        {
          urlPattern: /\/me$/,
          method: "GET",
          response: () => createMockGraphResponse({ mail: "specific-mailbox@company.com" }),
        },
      ]);

      const calendars = await service.listCalendars();

      expect(calendars[0].email).toBe("specific-mailbox@company.com");
    });

    test("should use userPrincipalName when mail is not available", async () => {
      const service = BuildCalendarService(mockCredential);

      setupMockRequestRaw([
        {
          urlPattern: "/me/calendars",
          method: "GET",
          response: () =>
            createMockGraphResponse({
              value: [{ id: "cal-1", name: "Test", isDefaultCalendar: true, canEdit: true }],
            }),
        },
        {
          urlPattern: /\/me$/,
          method: "GET",
          response: () =>
            createMockGraphResponse({ mail: null, userPrincipalName: "upn@company.com" }),
        },
      ]);

      const calendars = await service.listCalendars();

      expect(calendars[0].email).toBe("upn@company.com");
    });

    test("should handle empty calendar list", async () => {
      const service = BuildCalendarService(mockCredential);

      setupMockRequestRaw([
        {
          urlPattern: "/me/calendars",
          method: "GET",
          response: () => createMockGraphResponse({ value: [] }),
        },
        {
          urlPattern: /\/me$/,
          method: "GET",
          response: () => createMockGraphResponse({ mail: "user@example.com" }),
        },
      ]);

      const calendars = await service.listCalendars();

      expect(calendars).toHaveLength(0);
    });

    test("should set readOnly=true for calendars that cannot be edited", async () => {
      const service = BuildCalendarService(mockCredential);

      setupMockRequestRaw([
        {
          urlPattern: "/me/calendars",
          method: "GET",
          response: () =>
            createMockGraphResponse({
              value: [
                { id: "cal-readonly", name: "Shared Calendar", isDefaultCalendar: false, canEdit: false },
              ],
            }),
        },
        {
          urlPattern: /\/me$/,
          method: "GET",
          response: () => createMockGraphResponse({ mail: "user@example.com" }),
        },
      ]);

      const calendars = await service.listCalendars();

      expect(calendars[0].readOnly).toBe(true);
    });
  });

  // =========================================================================
  // getMainTimeZone
  // =========================================================================
  describe("getMainTimeZone", () => {
    test("should convert Windows timezone to IANA format", async () => {
      const service = BuildCalendarService(mockCredential);

      setupMockRequestRaw([
        {
          urlPattern: "/me/mailboxSettings/timeZone",
          response: () =>
            createMockGraphResponse({ value: "Pacific Standard Time" }),
        },
      ]);

      // Access the public method via type cast since it's not on the Calendar interface
      const timezone = await (service as any).getMainTimeZone();

      // Pacific Standard Time → America/Los_Angeles (or related IANA timezone)
      expect(timezone).toBeDefined();
      expect(typeof timezone).toBe("string");
      // The findIana function should convert to an IANA timezone
      expect(timezone).not.toBe("Pacific Standard Time");
    });

    test("should handle object format timezone response (new Graph API format)", async () => {
      const service = BuildCalendarService(mockCredential);

      setupMockRequestRaw([
        {
          urlPattern: "/me/mailboxSettings/timeZone",
          response: () =>
            createMockGraphResponse({ value: "Eastern Standard Time" }),
        },
      ]);

      const timezone = await (service as any).getMainTimeZone();

      expect(timezone).toBeDefined();
      expect(typeof timezone).toBe("string");
    });

    test("should return legacy string format timezone as-is", async () => {
      const service = BuildCalendarService(mockCredential);

      // When handleErrorsJson returns a string (legacy format), the method
      // checks typeof and returns it directly
      setupMockRequestRaw([
        {
          urlPattern: "/me/mailboxSettings/timeZone",
          response: () => {
            // Simulate a gzip-like response that returns a string via text() path
            return new Response(JSON.stringify("America/Chicago"), {
              status: 200,
              headers: new Headers({
                "Content-Type": "application/json",
                "content-encoding": "gzip",
              }),
            });
          },
        },
      ]);

      const timezone = await (service as any).getMainTimeZone();

      expect(timezone).toBe("America/Chicago");
    });

    test("should default to Europe/London when timezone response is empty", async () => {
      const service = BuildCalendarService(mockCredential);

      setupMockRequestRaw([
        {
          urlPattern: "/me/mailboxSettings/timeZone",
          response: () => createMockGraphResponse(null),
        },
      ]);

      const timezone = await (service as any).getMainTimeZone();

      expect(timezone).toBe("Europe/London");
    });
  });

  // =========================================================================
  // handleTextJsonResponseWithHtmlInBody — tested via getAvailability
  // =========================================================================
  describe("handleTextJsonResponseWithHtmlInBody (via getAvailability)", () => {
    function makeSelectedCalendars(ids: string[]) {
      return ids.map((id) => ({
        integration: "office365_calendar",
        externalId: id,
        userId: 1,
        credentialId: 1,
      }));
    }

    test("should handle batch response where body contains valid JSON string", async () => {
      const service = BuildCalendarService(mockCredential);

      // The gzip content-encoding triggers the text() path, which returns a string
      // that handleTextJsonResponseWithHtmlInBody then parses with JSON.parse
      setupMockRequestRaw([
        {
          urlPattern: "/$batch",
          method: "POST",
          response: () =>
            createMockBatchResponse({
              responses: [
                {
                  id: "0",
                  status: 200,
                  headers: { "Retry-After": "", "Content-Type": "application/json" },
                  body: {
                    value: [
                      {
                        showAs: "busy",
                        start: { dateTime: "2024-01-15T10:00:00" },
                        end: { dateTime: "2024-01-15T11:00:00" },
                      },
                    ],
                  },
                },
              ],
            }),
        },
      ]);

      const result = await service.getAvailability({
        dateFrom: "2024-01-15T00:00:00Z",
        dateTo: "2024-01-16T00:00:00Z",
        selectedCalendars: makeSelectedCalendars(["cal-1"]),
        mode: "slots" as const,
      });

      expect(result).toHaveLength(1);
      expect(result[0].start).toBe("2024-01-15T10:00:00Z");
    });
  });

  // =========================================================================
  // fetchResponsesWithNextLink — @odata.nextLink pagination
  // =========================================================================
  describe("fetchResponsesWithNextLink (via getAvailability)", () => {
    function makeSelectedCalendars(ids: string[]) {
      return ids.map((id) => ({
        integration: "office365_calendar",
        externalId: id,
        userId: 1,
        credentialId: 1,
      }));
    }

    test("should follow @odata.nextLink in batch sub-responses", async () => {
      const service = BuildCalendarService(mockCredential);
      let batchCallCount = 0;

      mockRequestRaw.mockImplementation(
        ({ url }: { url: string }): Promise<Response> => {
          if (url.includes("/$batch")) {
            batchCallCount++;
            if (batchCallCount === 1) {
              // First batch: sub-response with nextLink
              return Promise.resolve(
                createMockBatchResponse({
                  responses: [
                    {
                      id: "0",
                      status: 200,
                      headers: { "Retry-After": "", "Content-Type": "application/json" },
                      body: {
                        value: [
                          { showAs: "busy", start: { dateTime: "2024-01-15T09:00:00" }, end: { dateTime: "2024-01-15T10:00:00" } },
                        ],
                        "@odata.nextLink": `${API_GRAPH_URL}/me/calendars/cal-1/calendarView?$skip=1`,
                      },
                    },
                  ],
                })
              );
            }
            // Follow-up batch for nextLink
            return Promise.resolve(
              createMockBatchResponse({
                responses: [
                  {
                    id: "0",
                    status: 200,
                    headers: { "Retry-After": "", "Content-Type": "application/json" },
                    body: {
                      value: [
                        { showAs: "busy", start: { dateTime: "2024-01-15T14:00:00" }, end: { dateTime: "2024-01-15T15:00:00" } },
                      ],
                    },
                  },
                ],
              })
            );
          }
          return Promise.resolve(createMockGraphResponse({}));
        }
      );

      const result = await service.getAvailability({
        dateFrom: "2024-01-15T00:00:00Z",
        dateTo: "2024-01-16T00:00:00Z",
        selectedCalendars: makeSelectedCalendars(["cal-1"]),
        mode: "slots" as const,
      });

      // Should have events from both pages
      expect(batchCallCount).toBe(2);
      expect(result.length).toBeGreaterThanOrEqual(2);
    });

    test("should handle sub-responses without @odata.nextLink", async () => {
      const service = BuildCalendarService(mockCredential);

      setupMockRequestRaw([
        {
          urlPattern: "/$batch",
          method: "POST",
          response: () =>
            createMockBatchResponse({
              responses: [
                {
                  id: "0",
                  status: 200,
                  headers: { "Retry-After": "", "Content-Type": "application/json" },
                  body: {
                    value: [
                      { showAs: "busy", start: { dateTime: "2024-01-15T10:00:00" }, end: { dateTime: "2024-01-15T11:00:00" } },
                    ],
                  },
                },
              ],
            }),
        },
      ]);

      const result = await service.getAvailability({
        dateFrom: "2024-01-15T00:00:00Z",
        dateTo: "2024-01-16T00:00:00Z",
        selectedCalendars: makeSelectedCalendars(["cal-1"]),
        mode: "slots" as const,
      });

      // Only one batch call, no pagination
      const batchCalls = mockRequestRaw.mock.calls.filter((call) =>
        call[0].url.includes("/$batch")
      );
      expect(batchCalls).toHaveLength(1);
      expect(result).toHaveLength(1);
    });
  });

  // =========================================================================
  // Delegation credentials
  // =========================================================================
  describe("delegation credentials", () => {
    test("should use /me endpoint for non-delegation credentials", async () => {
      const service = BuildCalendarService(mockCredential);

      setupMockRequestRaw([
        {
          urlPattern: "/me/calendar/events",
          method: "POST",
          response: () => createMockGraphResponse(mockGraphEvent),
        },
      ]);

      const event = createMockCalendarServiceEvent({ destinationCalendar: null });
      await service.createEvent(event, 1);

      const callArgs = mockRequestRaw.mock.calls[0][0];
      expect(callArgs.url).toContain("/me/");
      expect(callArgs.url).not.toContain("/users/");
    });

    test("should use /users/{id} endpoint for delegation credentials after Azure AD lookup", async () => {
      // Mock global fetch for Azure AD user lookup (getAzureUserId uses fetch directly)
      const originalFetch = global.fetch;
      const mockFetch = vi.fn()
        .mockResolvedValueOnce(
          // First call: Azure AD token fetch
          new Response(JSON.stringify({ access_token: "DELEGATION_TOKEN" }), { status: 200 })
        )
        .mockResolvedValueOnce(
          // Second call: User lookup
          new Response(
            JSON.stringify({ value: [{ id: "azure-user-id-123" }] }),
            { status: 200 }
          )
        );
      global.fetch = mockFetch;

      try {
        const service = BuildCalendarService(mockDelegationCredential);

        setupMockRequestRaw([
          {
            urlPattern: "/users/azure-user-id-123/calendar/events",
            method: "POST",
            response: () => createMockGraphResponse(mockGraphEvent),
          },
        ]);

        const event = createMockCalendarServiceEvent({ destinationCalendar: null });
        await service.createEvent(event, 2);

        const callArgs = mockRequestRaw.mock.calls[0][0];
        expect(callArgs.url).toContain("/users/azure-user-id-123/");
      } finally {
        global.fetch = originalFetch;
      }
    });

    test("should cache azureUserId after first resolution", async () => {
      const originalFetch = global.fetch;
      const mockFetch = vi.fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ access_token: "DELEGATION_TOKEN" }), { status: 200 })
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ value: [{ id: "cached-user-id" }] }), { status: 200 })
        );
      global.fetch = mockFetch;

      try {
        const service = BuildCalendarService(mockDelegationCredential);

        setupMockRequestRaw([
          {
            urlPattern: "/users/cached-user-id",
            response: () => createMockGraphResponse(mockGraphEvent),
          },
        ]);

        const event = createMockCalendarServiceEvent({ destinationCalendar: null });

        // First call triggers Azure AD lookup
        await service.createEvent(event, 2);
        // Second call should use cached azureUserId
        await service.createEvent(event, 2);

        // fetch should only be called once for user lookup (2 calls total: token + user)
        expect(mockFetch).toHaveBeenCalledTimes(2);
      } finally {
        global.fetch = originalFetch;
      }
    });

    test("should throw error for delegation credential when Azure AD user not found", async () => {
      const originalFetch = global.fetch;
      const mockFetch = vi.fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ access_token: "DELEGATION_TOKEN" }), { status: 200 })
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ value: [] }), { status: 200 })
        );
      global.fetch = mockFetch;

      try {
        const service = BuildCalendarService(mockDelegationCredential);

        const event = createMockCalendarServiceEvent({ destinationCalendar: null });
        await expect(service.createEvent(event, 2)).rejects.toThrow(
          "User might not exist in Microsoft Azure Active Directory"
        );
      } finally {
        global.fetch = originalFetch;
      }
    });
  });

  // =========================================================================
  // handleErrorJsonOffice365Calendar
  // =========================================================================
  describe("handleErrorJsonOffice365Calendar (via getAvailability)", () => {
    function makeSelectedCalendars(ids: string[]) {
      return ids.map((id) => ({
        integration: "office365_calendar",
        externalId: id,
        userId: 1,
        credentialId: 1,
      }));
    }

    test("should handle gzip-encoded batch responses via text() path", async () => {
      const service = BuildCalendarService(mockCredential);

      setupMockRequestRaw([
        {
          urlPattern: "/$batch",
          method: "POST",
          response: () =>
            createMockBatchResponse({
              responses: [
                {
                  id: "0",
                  status: 200,
                  headers: { "Retry-After": "", "Content-Type": "application/json" },
                  body: {
                    value: [
                      {
                        showAs: "busy",
                        start: { dateTime: "2024-01-15T10:00:00" },
                        end: { dateTime: "2024-01-15T11:00:00" },
                      },
                    ],
                  },
                },
              ],
            }),
        },
      ]);

      const result = await service.getAvailability({
        dateFrom: "2024-01-15T00:00:00Z",
        dateTo: "2024-01-16T00:00:00Z",
        selectedCalendars: makeSelectedCalendars(["cal-1"]),
        mode: "slots" as const,
      });

      expect(result).toHaveLength(1);
    });

    test("should handle 204 No Content batch response gracefully", async () => {
      const service = BuildCalendarService(mockCredential);

      setupMockRequestRaw([
        {
          urlPattern: "/$batch",
          method: "POST",
          response: () => createMock204Response(),
        },
      ]);

      // 204 from handleErrorJsonOffice365Calendar returns {} which has no responses
      // This results in the catch block being hit due to processing empty data
      const result = await service.getAvailability({
        dateFrom: "2024-01-15T00:00:00Z",
        dateTo: "2024-01-16T00:00:00Z",
        selectedCalendars: makeSelectedCalendars(["cal-1"]),
        mode: "slots" as const,
      });

      // Result should be empty or the promise rejects
      // The processBusyTimes handles undefined responses gracefully
      expect(Array.isArray(result) ? result.length : 0).toBe(0);
    });
  });

  // =========================================================================
  // Edge cases and error handling
  // =========================================================================
  describe("edge cases", () => {
    test("should handle getAvailability when exception is thrown", async () => {
      const service = BuildCalendarService(mockCredential);

      mockRequestRaw.mockRejectedValue(new Error("Network error"));

      await expect(
        service.getAvailability({
          dateFrom: "2024-01-15T00:00:00Z",
          dateTo: "2024-01-16T00:00:00Z",
          selectedCalendars: [
            { integration: "office365_calendar", externalId: "cal-1", userId: 1, credentialId: 1 },
          ],
          mode: "slots" as const,
        })
      ).rejects.toEqual([]);
    });

    test("BuildCalendarService returns a Calendar-compatible instance", () => {
      const service = BuildCalendarService(mockCredential);

      expect(typeof service.createEvent).toBe("function");
      expect(typeof service.updateEvent).toBe("function");
      expect(typeof service.deleteEvent).toBe("function");
      expect(typeof service.getAvailability).toBe("function");
      expect(typeof service.listCalendars).toBe("function");
    });

    test("should set hideAttendees based on seatsPerTimeSlot and seatsShowAttendees", async () => {
      const service = BuildCalendarService(mockCredential);
      const event = createMockCalendarServiceEvent({
        seatsPerTimeSlot: 5,
        seatsShowAttendees: false,
      });

      setupMockRequestRaw([
        {
          urlPattern: "/calendars/calendar-1/events",
          method: "POST",
          response: () => createMockGraphResponse(mockGraphEvent),
        },
      ]);

      await service.createEvent(event, 1);

      const callArgs = mockRequestRaw.mock.calls[0][0];
      const requestBody = JSON.parse(callArgs.options.body);
      expect(requestBody.hideAttendees).toBe(true);
    });

    test("should set hideAttendees to false when no seatsPerTimeSlot", async () => {
      const service = BuildCalendarService(mockCredential);
      const event = createMockCalendarServiceEvent({ seatsPerTimeSlot: null });

      setupMockRequestRaw([
        {
          urlPattern: "/calendars/calendar-1/events",
          method: "POST",
          response: () => createMockGraphResponse(mockGraphEvent),
        },
      ]);

      await service.createEvent(event, 1);

      const callArgs = mockRequestRaw.mock.calls[0][0];
      const requestBody = JSON.parse(callArgs.options.body);
      expect(requestBody.hideAttendees).toBe(false);
    });

    test("should use organizer email as organizer address when no destination calendar matches", async () => {
      const service = BuildCalendarService(mockCredential);
      const event = createMockCalendarServiceEvent({
        destinationCalendar: null,
        organizer: {
          id: 1,
          name: "Test Organizer",
          email: "organizer-fallback@example.com",
          timeZone: "UTC",
          language: { translate: (key: string) => key, locale: "en" },
        },
      });

      setupMockRequestRaw([
        {
          urlPattern: "/calendar/events",
          method: "POST",
          response: () => createMockGraphResponse(mockGraphEvent),
        },
      ]);

      await service.createEvent(event, 1);

      const callArgs = mockRequestRaw.mock.calls[0][0];
      const requestBody = JSON.parse(callArgs.options.body);
      expect(requestBody.organizer.emailAddress.address).toBe("organizer-fallback@example.com");
    });

    test("should set allowNewTimeProposals when isOnlineMeeting", async () => {
      const service = BuildCalendarService(mockCredential);
      const event = createMockCalendarServiceEvent({
        location: "integrations:office365_video",
      });

      setupMockRequestRaw([
        {
          urlPattern: "/calendars/calendar-1/events",
          method: "POST",
          response: () => createMockGraphResponse(mockTeamsGraphEvent),
        },
      ]);

      await service.createEvent(event, 1);

      const callArgs = mockRequestRaw.mock.calls[0][0];
      const requestBody = JSON.parse(callArgs.options.body);
      expect(requestBody.allowNewTimeProposals).toBe(true);
    });
  });
});
