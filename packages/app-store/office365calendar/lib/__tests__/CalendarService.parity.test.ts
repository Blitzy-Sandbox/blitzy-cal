/**
 * CalendarService.parity.test.ts — Calendly Parity-Specific Behavioral Tests
 *
 * Sprint 3 (CI-002): Outlook/Office 365 Calendar adapter behavioral alignment
 * with Calendly's documented Outlook integration behavior.
 *
 * Test Coverage:
 * - CI-002/CI-004: showAs status filtering with configurable statusFilter (Calendly's
 *   "What's considered unavailable?" dropdown parity)
 * - CI-002: Batch pagination pattern correctness with @odata.nextLink
 * - CI-002: Teams integration parity (online meeting creation, rescheduling)
 * - CI-004: Configurable conflict detection alignment
 * - CI-002: Event field mapping to Microsoft Graph Event schema
 * - CI-001 gap: Microsoft Graph change notification subscription lifecycle
 *
 * These tests are intentionally separate from CalendarService.test.ts which covers
 * fundamental CRUD operations. This file focuses exclusively on behavioral PARITY
 * with Calendly's Outlook/Office 365 integration, aligning Cal.com behavior with
 * Calendly's documented feature set.
 */

import { beforeEach, describe, expect, test, vi } from "vitest";

// ---------------------------------------------------------------------------
// Central mock functions — declared via vi.hoisted() so they are available
// inside vi.mock() factory functions (which Vitest hoists above all other
// declarations). This pattern matches the established pattern in
// CalendarService.test.ts for consistency.
// ---------------------------------------------------------------------------
const { mockRequestRaw, mockGetTokenObjectOrFetch } = vi.hoisted(() => ({
  mockRequestRaw: vi.fn(),
  mockGetTokenObjectOrFetch: vi.fn().mockResolvedValue({
    token: { access_token: "FAKE_ACCESS_TOKEN" },
  }),
}));

// ---------------------------------------------------------------------------
// vi.mock() calls — MUST be hoisted before any non-vitest imports.
// OAuthManager mock uses `function()` (not arrow fn) because the
// CalendarService constructor calls `new OAuthManager({...})` and arrow
// functions cannot be used as constructors in JavaScript.
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
// Mock credential fixture — matches CredentialForCalendarServiceWithTenantId
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
    email: "parity-test@example.com",
  },
  delegationCredentialId: null,
  delegatedTo: null,
  invalid: false,
  teamId: null,
  encryptedKey: null,
};

// ---------------------------------------------------------------------------
// CalendarServiceEvent factory for createEvent / updateEvent parity tests
// ---------------------------------------------------------------------------
function createMockCalendarServiceEvent(overrides: Record<string, unknown> = {}) {
  return {
    type: "parity-test-event-type",
    title: "Parity Test Meeting",
    startTime: "2024-06-15T10:00:00Z",
    endTime: "2024-06-15T11:00:00Z",
    organizer: {
      id: 1,
      name: "Parity Organizer",
      email: "organizer@example.com",
      timeZone: "UTC",
      language: {
        translate: (key: string) => key,
        locale: "en",
      },
    },
    attendees: [
      {
        name: "Attendee A",
        email: "attendee-a@example.com",
        timeZone: "UTC",
        language: {
          translate: (key: string) => key,
          locale: "en",
        },
      },
    ],
    calendarDescription: "Parity test meeting description",
    destinationCalendar: [
      {
        id: 10,
        integration: "office365_calendar",
        externalId: "parity-cal-1",
        primaryEmail: "parity-test@example.com",
        userId: 1,
        eventTypeId: null,
        credentialId: 1,
        delegationCredentialId: null,
        domainWideDelegationCredentialId: null,
      },
    ],
    uid: "parity-test-uid-12345",
    ...overrides,
  } as any;
}

// ---------------------------------------------------------------------------
// Helper: create a mock Response simulating Microsoft Graph API responses.
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
 * The Office365CalendarService.handleErrorJsonOffice365Calendar method checks
 * this header and routes gzip responses through response.text() →
 * handleTextJsonResponseWithHtmlInBody, which is the correct production
 * code path for Microsoft Graph batch responses.
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
 * Sets up mockRequestRaw to handle specific URL patterns.
 * Accepts a list of handlers with URL pattern → Response factory.
 * Handlers are evaluated in order; first match wins.
 * Falls back to an empty 200 JSON response for unmatched requests.
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
      return Promise.resolve(createMockGraphResponse({}));
    }
  );
}

/**
 * Convenience factory for building selectedCalendars arrays
 * that match the office365_calendar integration name.
 */
function makeSelectedCalendars(ids: string[]) {
  return ids.map((id) => ({
    integration: "office365_calendar",
    externalId: id,
    userId: 1,
    credentialId: 1,
  }));
}

// ---------------------------------------------------------------------------
// Shared batch response fixture with events spanning all showAs values.
// Used by multiple statusFilter parity tests.
// ---------------------------------------------------------------------------
function createMixedShowAsBatchResponse() {
  return createMockBatchResponse({
    responses: [
      {
        id: "0",
        status: 200,
        headers: { "Retry-After": "", "Content-Type": "application/json" },
        body: {
          value: [
            { showAs: "free", start: { dateTime: "2024-01-15T08:00:00" }, end: { dateTime: "2024-01-15T09:00:00" } },
            { showAs: "tentative", start: { dateTime: "2024-01-15T10:00:00" }, end: { dateTime: "2024-01-15T11:00:00" } },
            { showAs: "busy", start: { dateTime: "2024-01-15T12:00:00" }, end: { dateTime: "2024-01-15T13:00:00" } },
            { showAs: "oof", start: { dateTime: "2024-01-15T14:00:00" }, end: { dateTime: "2024-01-15T15:00:00" } },
            { showAs: "workingElsewhere", start: { dateTime: "2024-01-15T16:00:00" }, end: { dateTime: "2024-01-15T17:00:00" } },
            { showAs: "unknown", start: { dateTime: "2024-01-15T18:00:00" }, end: { dateTime: "2024-01-15T19:00:00" } },
          ],
        },
      },
    ],
  });
}

// Mock Graph Event response for createEvent/updateEvent tests
const mockGraphEvent = {
  id: "AAMkParity123",
  iCalUId: "040000008200E00074C5B7PARITY",
  subject: "Parity Test Meeting",
  start: { dateTime: "2024-06-15T10:00:00.0000000", timeZone: "UTC" },
  end: { dateTime: "2024-06-15T11:00:00.0000000", timeZone: "UTC" },
  organizer: { emailAddress: { name: "Parity Organizer", address: "organizer@example.com" } },
  attendees: [],
  onlineMeeting: null,
  webLink: "https://outlook.office365.com/calendar/item/AAMkParity123",
};

const mockTeamsGraphEvent = {
  ...mockGraphEvent,
  isOnlineMeeting: true,
  onlineMeeting: {
    joinUrl: "https://teams.microsoft.com/l/meetup-join/19%3ameeting_parity_test",
  },
};

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
// TEST SUITES — Calendly Parity Behavioral Tests
// ===========================================================================

describe("Office365CalendarService — Calendly Parity Tests", () => {
  // =========================================================================
  // CI-002/CI-004: showAs Status Filtering with configurable statusFilter
  //
  // Calendly's Outlook integration has a "What's considered unavailable?"
  // dropdown that lets users choose which event statuses block scheduling.
  // The default includes Busy, Tentative, and Out of Office as blocking.
  // Cal.com achieves this via the optional `statusFilter` parameter on
  // GetAvailabilityParams, which is threaded through to processBusyTimes.
  // =========================================================================
  describe("CI-002/CI-004 Calendly Parity: showAs Status Filtering with statusFilter", () => {
    test("should skip 'free' and 'workingElsewhere' events by default when no statusFilter is provided", async () => {
      const service = BuildCalendarService(mockCredential);

      setupMockRequestRaw([
        {
          urlPattern: "/$batch",
          method: "POST",
          response: () => createMixedShowAsBatchResponse(),
        },
      ]);

      const result = await service.getAvailability({
        dateFrom: "2024-01-15T00:00:00Z",
        dateTo: "2024-01-16T00:00:00Z",
        selectedCalendars: makeSelectedCalendars(["parity-cal-1"]),
        mode: "slots" as const,
      });

      // Default behavior: free and workingElsewhere are excluded
      // tentative, busy, oof, unknown are included (4 events)
      expect(result).toHaveLength(4);
      const startTimes = result.map((r) => r.start);
      // tentative at 10:00
      expect(startTimes).toContain("2024-01-15T10:00:00Z");
      // busy at 12:00
      expect(startTimes).toContain("2024-01-15T12:00:00Z");
      // oof at 14:00
      expect(startTimes).toContain("2024-01-15T14:00:00Z");
      // unknown at 18:00
      expect(startTimes).toContain("2024-01-15T18:00:00Z");
      // free at 08:00 must NOT be included
      expect(startTimes).not.toContain("2024-01-15T08:00:00Z");
      // workingElsewhere at 16:00 must NOT be included
      expect(startTimes).not.toContain("2024-01-15T16:00:00Z");
    });

    test("should filter by statusFilter when provided — only 'busy' events (Calendly 'Only Busy' mode)", async () => {
      const service = BuildCalendarService(mockCredential);

      setupMockRequestRaw([
        {
          urlPattern: "/$batch",
          method: "POST",
          response: () => createMixedShowAsBatchResponse(),
        },
      ]);

      const result = await service.getAvailability({
        dateFrom: "2024-01-15T00:00:00Z",
        dateTo: "2024-01-16T00:00:00Z",
        selectedCalendars: makeSelectedCalendars(["parity-cal-1"]),
        mode: "slots" as const,
        statusFilter: ["busy"],
      });

      // Only events with showAs=busy should be returned
      expect(result).toHaveLength(1);
      expect(result[0].start).toBe("2024-01-15T12:00:00Z");
      expect(result[0].end).toBe("2024-01-15T13:00:00Z");
    });

    test("should filter by statusFilter with multiple values — 'busy' and 'tentative'", async () => {
      const service = BuildCalendarService(mockCredential);

      setupMockRequestRaw([
        {
          urlPattern: "/$batch",
          method: "POST",
          response: () => createMixedShowAsBatchResponse(),
        },
      ]);

      const result = await service.getAvailability({
        dateFrom: "2024-01-15T00:00:00Z",
        dateTo: "2024-01-16T00:00:00Z",
        selectedCalendars: makeSelectedCalendars(["parity-cal-1"]),
        mode: "slots" as const,
        statusFilter: ["busy", "tentative"],
      });

      // Only busy (12:00) and tentative (10:00)
      expect(result).toHaveLength(2);
      const startTimes = result.map((r) => r.start);
      expect(startTimes).toContain("2024-01-15T10:00:00Z");
      expect(startTimes).toContain("2024-01-15T12:00:00Z");
    });

    test("should perform case-insensitive statusFilter matching (Calendly interop)", async () => {
      const service = BuildCalendarService(mockCredential);

      setupMockRequestRaw([
        {
          urlPattern: "/$batch",
          method: "POST",
          response: () => createMixedShowAsBatchResponse(),
        },
      ]);

      // Provide mixed-case status values — must match case-insensitively
      const result = await service.getAvailability({
        dateFrom: "2024-01-15T00:00:00Z",
        dateTo: "2024-01-16T00:00:00Z",
        selectedCalendars: makeSelectedCalendars(["parity-cal-1"]),
        mode: "slots" as const,
        statusFilter: ["Busy", "TENTATIVE", "Oof"],
      });

      // busy (12:00), tentative (10:00), oof (14:00) — all matched case-insensitively
      expect(result).toHaveLength(3);
      const startTimes = result.map((r) => r.start);
      expect(startTimes).toContain("2024-01-15T10:00:00Z");
      expect(startTimes).toContain("2024-01-15T12:00:00Z");
      expect(startTimes).toContain("2024-01-15T14:00:00Z");
    });

    test("should fall back to default behavior when statusFilter is empty array", async () => {
      const service = BuildCalendarService(mockCredential);

      setupMockRequestRaw([
        {
          urlPattern: "/$batch",
          method: "POST",
          response: () => createMixedShowAsBatchResponse(),
        },
      ]);

      const result = await service.getAvailability({
        dateFrom: "2024-01-15T00:00:00Z",
        dateTo: "2024-01-16T00:00:00Z",
        selectedCalendars: makeSelectedCalendars(["parity-cal-1"]),
        mode: "slots" as const,
        statusFilter: [],
      });

      // Empty statusFilter falls back to default: skip free and workingElsewhere
      // Same behavior as no statusFilter → 4 events
      expect(result).toHaveLength(4);
    });

    test("should include ALL events when statusFilter contains all possible showAs values (Calendly 'All Events' mode)", async () => {
      const service = BuildCalendarService(mockCredential);

      setupMockRequestRaw([
        {
          urlPattern: "/$batch",
          method: "POST",
          response: () => createMixedShowAsBatchResponse(),
        },
      ]);

      // This is the Calendly equivalent of "Consider all events as unavailable"
      const result = await service.getAvailability({
        dateFrom: "2024-01-15T00:00:00Z",
        dateTo: "2024-01-16T00:00:00Z",
        selectedCalendars: makeSelectedCalendars(["parity-cal-1"]),
        mode: "slots" as const,
        statusFilter: ["free", "tentative", "busy", "oof", "workingElsewhere", "unknown"],
      });

      // ALL events should be included — even free and workingElsewhere
      expect(result).toHaveLength(6);
    });

    test("should include 'oof' (Out of Office) events by default matching Calendly's OOF handling", async () => {
      const service = BuildCalendarService(mockCredential);

      // Provide only OOF events to isolate behavior
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
                      { showAs: "oof", start: { dateTime: "2024-01-15T09:00:00" }, end: { dateTime: "2024-01-15T17:00:00" } },
                      { showAs: "oof", start: { dateTime: "2024-01-16T09:00:00" }, end: { dateTime: "2024-01-16T12:00:00" } },
                    ],
                  },
                },
              ],
            }),
        },
      ]);

      const result = await service.getAvailability({
        dateFrom: "2024-01-15T00:00:00Z",
        dateTo: "2024-01-17T00:00:00Z",
        selectedCalendars: makeSelectedCalendars(["parity-cal-1"]),
        mode: "slots" as const,
      });

      // Default behavior: OOF events ARE blocking (matching Calendly behavior)
      expect(result).toHaveLength(2);
      expect(result[0].start).toBe("2024-01-15T09:00:00Z");
      expect(result[1].start).toBe("2024-01-16T09:00:00Z");
    });

    test("should correctly format busy time entries with UTC 'Z' suffix appended to dateTime", async () => {
      const service = BuildCalendarService(mockCredential);

      // Microsoft Graph returns datetimes WITHOUT Z suffix
      // processBusyTimes appends "Z" to make them UTC-explicit
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
                      { showAs: "busy", start: { dateTime: "2024-03-15T14:30:00" }, end: { dateTime: "2024-03-15T15:30:00" } },
                    ],
                  },
                },
              ],
            }),
        },
      ]);

      const result = await service.getAvailability({
        dateFrom: "2024-03-15T00:00:00Z",
        dateTo: "2024-03-16T00:00:00Z",
        selectedCalendars: makeSelectedCalendars(["parity-cal-1"]),
        mode: "slots" as const,
        statusFilter: ["busy"],
      });

      expect(result).toHaveLength(1);
      // Verify Z is appended (not already present in Graph API response)
      expect(result[0].start).toBe("2024-03-15T14:30:00Z");
      expect(result[0].end).toBe("2024-03-15T15:30:00Z");
      // Verify the format is exactly "${dateTime}Z"
      expect(result[0].start).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    });

    test("should exclude statusFilter values not matching any event showAs (no false positives)", async () => {
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
                      { showAs: "free", start: { dateTime: "2024-01-15T12:00:00" }, end: { dateTime: "2024-01-15T13:00:00" } },
                    ],
                  },
                },
              ],
            }),
        },
      ]);

      // statusFilter with a non-existent showAs value: should match nothing extra
      const result = await service.getAvailability({
        dateFrom: "2024-01-15T00:00:00Z",
        dateTo: "2024-01-16T00:00:00Z",
        selectedCalendars: makeSelectedCalendars(["parity-cal-1"]),
        mode: "slots" as const,
        statusFilter: ["nonExistentStatus"],
      });

      // No events match "nonExistentStatus", so result should be empty
      expect(result).toHaveLength(0);
    });
  });

  // =========================================================================
  // CI-002: Batch Pagination Pattern Correctness
  //
  // Microsoft Graph batch API (POST /$batch) returns individual sub-responses
  // that may contain @odata.nextLink for pagination. Cal.com's
  // fetchResponsesWithNextLink recursively follows these links, issuing
  // additional batch requests. This matches Calendly's approach to handling
  // large calendar datasets in Outlook.
  // =========================================================================
  describe("CI-002 Calendly Parity: Batch Pagination", () => {
    test("should follow @odata.nextLink for paginated batch sub-responses and aggregate events", async () => {
      const service = BuildCalendarService(mockCredential);
      let batchCallCount = 0;

      mockRequestRaw.mockImplementation(
        ({ url }: { url: string }): Promise<Response> => {
          if (url.includes("/$batch")) {
            batchCallCount++;
            if (batchCallCount === 1) {
              // First batch: sub-response contains events + @odata.nextLink
              return Promise.resolve(
                createMockBatchResponse({
                  responses: [
                    {
                      id: "0",
                      status: 200,
                      headers: { "Retry-After": "", "Content-Type": "application/json" },
                      body: {
                        value: [
                          { showAs: "busy", start: { dateTime: "2024-02-01T09:00:00" }, end: { dateTime: "2024-02-01T10:00:00" } },
                          { showAs: "busy", start: { dateTime: "2024-02-01T11:00:00" }, end: { dateTime: "2024-02-01T12:00:00" } },
                        ],
                        "@odata.nextLink": `${API_GRAPH_URL}/me/calendars/parity-cal-1/calendarView?$skip=2`,
                      },
                    },
                  ],
                })
              );
            }
            // Follow-up batch for nextLink: returns remaining events (no more nextLink)
            return Promise.resolve(
              createMockBatchResponse({
                responses: [
                  {
                    id: "0",
                    status: 200,
                    headers: { "Retry-After": "", "Content-Type": "application/json" },
                    body: {
                      value: [
                        { showAs: "busy", start: { dateTime: "2024-02-01T14:00:00" }, end: { dateTime: "2024-02-01T15:00:00" } },
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
        dateFrom: "2024-02-01T00:00:00Z",
        dateTo: "2024-02-02T00:00:00Z",
        selectedCalendars: makeSelectedCalendars(["parity-cal-1"]),
        mode: "slots" as const,
      });

      // Two batch calls: initial + nextLink follow
      expect(batchCallCount).toBe(2);
      // Events from both pages are aggregated
      expect(result.length).toBeGreaterThanOrEqual(3);
      expect(result.map((r) => r.start)).toContain("2024-02-01T09:00:00Z");
      expect(result.map((r) => r.start)).toContain("2024-02-01T11:00:00Z");
      expect(result.map((r) => r.start)).toContain("2024-02-01T14:00:00Z");
    });

    test("should handle batch response with no @odata.nextLink (single page — no extra requests)", async () => {
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
                      { showAs: "busy", start: { dateTime: "2024-02-01T09:00:00" }, end: { dateTime: "2024-02-01T10:00:00" } },
                    ],
                  },
                },
              ],
            }),
        },
      ]);

      const result = await service.getAvailability({
        dateFrom: "2024-02-01T00:00:00Z",
        dateTo: "2024-02-02T00:00:00Z",
        selectedCalendars: makeSelectedCalendars(["parity-cal-1"]),
        mode: "slots" as const,
      });

      // Only one batch call
      const batchCalls = mockRequestRaw.mock.calls.filter((call) => call[0].url.includes("/$batch"));
      expect(batchCalls).toHaveLength(1);
      expect(result).toHaveLength(1);
    });

    test("should construct batch requests correctly for multiple selected calendars", async () => {
      const service = BuildCalendarService(mockCredential);

      setupMockRequestRaw([
        {
          urlPattern: "/$batch",
          method: "POST",
          response: () =>
            createMockBatchResponse({
              responses: [
                { id: "0", status: 200, headers: { "Retry-After": "", "Content-Type": "application/json" }, body: { value: [] } },
                { id: "1", status: 200, headers: { "Retry-After": "", "Content-Type": "application/json" }, body: { value: [] } },
                { id: "2", status: 200, headers: { "Retry-After": "", "Content-Type": "application/json" }, body: { value: [] } },
              ],
            }),
        },
      ]);

      await service.getAvailability({
        dateFrom: "2024-02-01T00:00:00Z",
        dateTo: "2024-02-02T00:00:00Z",
        selectedCalendars: makeSelectedCalendars(["cal-alpha", "cal-beta", "cal-gamma"]),
        mode: "slots" as const,
      });

      // Verify $batch request body contains 3 individual calendar requests
      const batchCall = mockRequestRaw.mock.calls.find((call) => call[0].url.includes("/$batch"));
      expect(batchCall).toBeDefined();
      const batchBody = JSON.parse(batchCall![0].options.body);
      expect(batchBody.requests).toHaveLength(3);

      // Each request URL should contain the correct calendar ID
      expect(batchBody.requests[0].url).toContain("/me/calendars/cal-alpha/calendarView");
      expect(batchBody.requests[1].url).toContain("/me/calendars/cal-beta/calendarView");
      expect(batchBody.requests[2].url).toContain("/me/calendars/cal-gamma/calendarView");

      // Each request should contain the correct query parameters
      for (const req of batchBody.requests) {
        expect(req.method).toBe("GET");
        expect(req.url).toContain("$select=showAs,start,end");
        expect(req.url).toContain("$top=999");
        expect(req.url).toContain("startDateTime=");
        expect(req.url).toContain("endDateTime=");
      }
    });
  });

  // =========================================================================
  // CI-002: Teams Integration Parity
  //
  // Calendly's Outlook integration supports Microsoft Teams online meetings.
  // Cal.com uses the MSTeamsLocationType to detect Teams meeting requests,
  // setting isOnlineMeeting and onlineMeetingProvider on the Graph Event.
  // During rescheduling, the existing HTML body blob from Teams must be
  // preserved to maintain the meeting link and join info.
  // =========================================================================
  describe("CI-002 Calendly Parity: Teams Integration", () => {
    test("should set isOnlineMeeting and onlineMeetingProvider for Teams location, extract joinUrl from response", async () => {
      const service = BuildCalendarService(mockCredential);
      const event = createMockCalendarServiceEvent({
        location: "integrations:office365_video",
      });

      setupMockRequestRaw([
        {
          urlPattern: "/calendars/parity-cal-1/events",
          method: "POST",
          response: () => createMockGraphResponse(mockTeamsGraphEvent),
        },
      ]);

      const result = await service.createEvent(event, 1);

      // Verify POST body includes online meeting fields
      const callArgs = mockRequestRaw.mock.calls[0][0];
      const requestBody = JSON.parse(callArgs.options.body);
      expect(requestBody.isOnlineMeeting).toBe(true);
      expect(requestBody.onlineMeetingProvider).toBe("teamsForBusiness");
      expect(requestBody.allowNewTimeProposals).toBe(true);

      // Verify joinUrl is extracted from onlineMeeting response
      expect(result.url).toBe("https://teams.microsoft.com/l/meetup-join/19%3ameeting_parity_test");
    });

    test("should NOT set isOnlineMeeting for non-Teams physical locations", async () => {
      const service = BuildCalendarService(mockCredential);
      const event = createMockCalendarServiceEvent({
        location: "123 Conference Blvd, Suite 200",
      });

      setupMockRequestRaw([
        {
          urlPattern: "/calendars/parity-cal-1/events",
          method: "POST",
          response: () => createMockGraphResponse(mockGraphEvent),
        },
      ]);

      await service.createEvent(event, 1);

      const callArgs = mockRequestRaw.mock.calls[0][0];
      const requestBody = JSON.parse(callArgs.options.body);
      expect(requestBody.isOnlineMeeting).toBeUndefined();
      expect(requestBody.onlineMeetingProvider).toBeUndefined();
      expect(requestBody.allowNewTimeProposals).toBeUndefined();
    });

    test("should preserve Teams meeting HTML body content during rescheduling", async () => {
      const service = BuildCalendarService(mockCredential);
      const teamsHtmlBody =
        '<div>Meeting Details</div><div class="me-email-text">Join Microsoft Teams Meeting</div><a href="https://teams.microsoft.com/l/meetup">Click here to join</a>';
      const event = createMockCalendarServiceEvent({
        location: "integrations:office365_video",
      });

      setupMockRequestRaw([
        {
          // GET existing event returns Teams meeting with HTML body
          urlPattern: "/calendar/events/parity-reschedule-uid",
          method: "GET",
          response: () =>
            createMockGraphResponse({
              ...mockGraphEvent,
              isOnlineMeeting: true,
              body: { contentType: "html", content: teamsHtmlBody },
            }),
        },
        {
          // PATCH should preserve the Teams HTML body
          urlPattern: "/calendar/events/parity-reschedule-uid",
          method: "PATCH",
          response: () => createMockGraphResponse(mockTeamsGraphEvent),
        },
      ]);

      await service.updateEvent("parity-reschedule-uid", event);

      // Verify GET was called first to retrieve existing event
      const getCall = mockRequestRaw.mock.calls.find(
        (call) => call[0].options?.method === "GET" || call[0].options?.method === "get"
      );
      expect(getCall).toBeDefined();

      // Verify PATCH body contains the preserved Teams HTML
      const patchCall = mockRequestRaw.mock.calls.find(
        (call) => call[0].options?.method === "PATCH"
      );
      expect(patchCall).toBeDefined();
      const patchBody = JSON.parse(patchCall![0].options.body);
      expect(patchBody.body.content).toContain(teamsHtmlBody);
      expect(patchBody.body.contentType).toBe("html");
    });
  });

  // =========================================================================
  // CI-004: Configurable Conflict Detection Alignment
  //
  // Calendly's "What's considered unavailable?" setting supports:
  // - Busy only
  // - Busy + Tentative
  // - Busy + Tentative + Out of Office
  // - All events
  //
  // Cal.com's statusFilter achieves the same configurability. These tests
  // verify end-to-end flow: getAvailability → processBusyTimes with statusFilter.
  // =========================================================================
  describe("CI-004 Calendly Parity: Configurable Conflict Detection", () => {
    test("should pass statusFilter through getAvailability to processBusyTimes — only 'busy' and 'oof' blocking", async () => {
      const service = BuildCalendarService(mockCredential);

      setupMockRequestRaw([
        {
          urlPattern: "/$batch",
          method: "POST",
          response: () => createMixedShowAsBatchResponse(),
        },
      ]);

      // Simulate Calendly's "Busy + OOF" configuration
      const result = await service.getAvailability({
        dateFrom: "2024-01-15T00:00:00Z",
        dateTo: "2024-01-16T00:00:00Z",
        selectedCalendars: makeSelectedCalendars(["parity-cal-1"]),
        mode: "slots" as const,
        statusFilter: ["busy", "oof"],
      });

      // Only busy (12:00) and oof (14:00) should be returned
      expect(result).toHaveLength(2);
      const startTimes = result.map((r) => r.start);
      expect(startTimes).toContain("2024-01-15T12:00:00Z");
      expect(startTimes).toContain("2024-01-15T14:00:00Z");
      // tentative, free, workingElsewhere, unknown should be excluded
      expect(startTimes).not.toContain("2024-01-15T10:00:00Z");
      expect(startTimes).not.toContain("2024-01-15T08:00:00Z");
    });

    test("should match Calendly default conflict behavior — Busy, Tentative, OOF treated as blocking (no statusFilter)", async () => {
      const service = BuildCalendarService(mockCredential);

      setupMockRequestRaw([
        {
          urlPattern: "/$batch",
          method: "POST",
          response: () => createMixedShowAsBatchResponse(),
        },
      ]);

      // Default behavior (no statusFilter): skip "free" and "workingElsewhere"
      // This means Busy, Tentative, OOF, Unknown are all blocking
      const result = await service.getAvailability({
        dateFrom: "2024-01-15T00:00:00Z",
        dateTo: "2024-01-16T00:00:00Z",
        selectedCalendars: makeSelectedCalendars(["parity-cal-1"]),
        mode: "slots" as const,
      });

      expect(result).toHaveLength(4);
      const startTimes = result.map((r) => r.start);
      // tentative: blocking
      expect(startTimes).toContain("2024-01-15T10:00:00Z");
      // busy: blocking
      expect(startTimes).toContain("2024-01-15T12:00:00Z");
      // oof: blocking
      expect(startTimes).toContain("2024-01-15T14:00:00Z");
      // unknown: blocking (default includes unknown)
      expect(startTimes).toContain("2024-01-15T18:00:00Z");
    });

    test("should allow strict 'busy' only mode matching Calendly's 'Only Busy' option", async () => {
      const service = BuildCalendarService(mockCredential);

      setupMockRequestRaw([
        {
          urlPattern: "/$batch",
          method: "POST",
          response: () => createMixedShowAsBatchResponse(),
        },
      ]);

      const result = await service.getAvailability({
        dateFrom: "2024-01-15T00:00:00Z",
        dateTo: "2024-01-16T00:00:00Z",
        selectedCalendars: makeSelectedCalendars(["parity-cal-1"]),
        mode: "slots" as const,
        statusFilter: ["busy"],
      });

      // Only events with showAs=busy block availability
      expect(result).toHaveLength(1);
      expect(result[0].start).toBe("2024-01-15T12:00:00Z");
    });

    test("should support Calendly's full conflict mode — Busy, Tentative, OOF, Working Elsewhere all blocking", async () => {
      const service = BuildCalendarService(mockCredential);

      setupMockRequestRaw([
        {
          urlPattern: "/$batch",
          method: "POST",
          response: () => createMixedShowAsBatchResponse(),
        },
      ]);

      // Simulate Calendly's "Busy, Tentative, OOF, Working Elsewhere" configuration
      const result = await service.getAvailability({
        dateFrom: "2024-01-15T00:00:00Z",
        dateTo: "2024-01-16T00:00:00Z",
        selectedCalendars: makeSelectedCalendars(["parity-cal-1"]),
        mode: "slots" as const,
        statusFilter: ["busy", "tentative", "oof", "workingElsewhere"],
      });

      // 4 events match: busy, tentative, oof, workingElsewhere (free and unknown excluded)
      expect(result).toHaveLength(4);
      const startTimes = result.map((r) => r.start);
      expect(startTimes).toContain("2024-01-15T10:00:00Z"); // tentative
      expect(startTimes).toContain("2024-01-15T12:00:00Z"); // busy
      expect(startTimes).toContain("2024-01-15T14:00:00Z"); // oof
      expect(startTimes).toContain("2024-01-15T16:00:00Z"); // workingElsewhere
      // free and unknown excluded
      expect(startTimes).not.toContain("2024-01-15T08:00:00Z");
      expect(startTimes).not.toContain("2024-01-15T18:00:00Z");
    });
  });

  // =========================================================================
  // CI-002: Event Field Mapping Parity
  //
  // Verifies that CalendarServiceEvent fields are correctly mapped to
  // Microsoft Graph Event fields, matching Calendly's Outlook event creation
  // behavior: subject, body, start/end with timezone, attendees, organizer,
  // sensitivity, and hideAttendees.
  // =========================================================================
  describe("CI-002 Calendly Parity: Event Field Mapping", () => {
    test("should map CalendarServiceEvent fields to correct Microsoft Graph Event fields", async () => {
      const service = BuildCalendarService(mockCredential);
      const event = createMockCalendarServiceEvent({
        title: "Calendly Parity Sync",
        startTime: "2024-07-20T14:00:00Z",
        endTime: "2024-07-20T15:00:00Z",
        organizer: {
          id: 1,
          name: "Test Organizer",
          email: "organizer@example.com",
          timeZone: "America/New_York",
          language: { translate: (key: string) => key, locale: "en" },
        },
        hideCalendarEventDetails: true,
      });

      setupMockRequestRaw([
        {
          urlPattern: "/calendars/parity-cal-1/events",
          method: "POST",
          response: () => createMockGraphResponse(mockGraphEvent),
        },
      ]);

      await service.createEvent(event, 1);

      const callArgs = mockRequestRaw.mock.calls[0][0];
      const requestBody = JSON.parse(callArgs.options.body);

      // subject from title
      expect(requestBody.subject).toBe("Calendly Parity Sync");

      // body with text contentType for non-Teams
      expect(requestBody.body.contentType).toBe("text");

      // start/end datetimes with organizer timezone
      expect(requestBody.start.timeZone).toBe("America/New_York");
      expect(requestBody.end.timeZone).toBe("America/New_York");
      // Formatted as YYYY-MM-DDTHH:mm:ss (no Z suffix — Graph expects local time with timeZone)
      expect(requestBody.start.dateTime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);

      // attendees array with emailAddress and type
      expect(requestBody.attendees.length).toBeGreaterThanOrEqual(1);
      expect(requestBody.attendees[0].emailAddress.address).toBe("attendee-a@example.com");
      expect(requestBody.attendees[0].type).toBe("required");

      // organizer from destinationCalendar
      expect(requestBody.organizer.emailAddress.name).toBe("Test Organizer");

      // sensitivity: "private" when hideCalendarEventDetails is true
      expect(requestBody.sensitivity).toBe("private");
    });

    test("should resolve organizer email from destinationCalendar externalId when userId matches", async () => {
      const service = BuildCalendarService(mockCredential);
      const event = createMockCalendarServiceEvent({
        organizer: {
          id: 1,
          name: "Cal Organizer",
          email: "cal-organizer@example.com",
          timeZone: "UTC",
          language: { translate: (key: string) => key, locale: "en" },
        },
        destinationCalendar: [
          {
            id: 20,
            integration: "office365_calendar",
            externalId: "dest-cal-ext-id",
            primaryEmail: "dest-calendar@example.com",
            userId: 1,
            eventTypeId: null,
            credentialId: 1,
            delegationCredentialId: null,
            domainWideDelegationCredentialId: null,
          },
        ],
      });

      setupMockRequestRaw([
        {
          urlPattern: "/calendars/dest-cal-ext-id/events",
          method: "POST",
          response: () => createMockGraphResponse(mockGraphEvent),
        },
      ]);

      await service.createEvent(event, 1);

      const callArgs = mockRequestRaw.mock.calls[0][0];
      const requestBody = JSON.parse(callArgs.options.body);

      // organizer.emailAddress.address uses destinationCalendar.externalId when userId matches
      expect(requestBody.organizer.emailAddress.address).toBe("dest-cal-ext-id");
    });

    test("should fall back to organizer email when no destinationCalendar userId matches", async () => {
      const service = BuildCalendarService(mockCredential);
      const event = createMockCalendarServiceEvent({
        organizer: {
          id: 999, // Does not match destinationCalendar userId (1)
          name: "No Match Organizer",
          email: "fallback-email@example.com",
          timeZone: "UTC",
          language: { translate: (key: string) => key, locale: "en" },
        },
      });

      setupMockRequestRaw([
        {
          urlPattern: "/calendars/parity-cal-1/events",
          method: "POST",
          response: () => createMockGraphResponse(mockGraphEvent),
        },
      ]);

      await service.createEvent(event, 1);

      const callArgs = mockRequestRaw.mock.calls[0][0];
      const requestBody = JSON.parse(callArgs.options.body);

      // Falls back to organizer.email when no destinationCalendar matches organizer.id
      expect(requestBody.organizer.emailAddress.address).toBe("fallback-email@example.com");
    });

    test("should set hideAttendees correctly based on seats configuration", async () => {
      const service = BuildCalendarService(mockCredential);

      // Case 1: seatsPerTimeSlot set, seatsShowAttendees false → hideAttendees = true
      const eventHidden = createMockCalendarServiceEvent({
        seatsPerTimeSlot: 10,
        seatsShowAttendees: false,
      });

      setupMockRequestRaw([
        {
          urlPattern: "/calendars/parity-cal-1/events",
          method: "POST",
          response: () => createMockGraphResponse(mockGraphEvent),
        },
      ]);

      await service.createEvent(eventHidden, 1);
      let requestBody = JSON.parse(mockRequestRaw.mock.calls[0][0].options.body);
      expect(requestBody.hideAttendees).toBe(true);

      // Reset for next case
      mockRequestRaw.mockReset();
      setupMockRequestRaw([
        {
          urlPattern: "/calendars/parity-cal-1/events",
          method: "POST",
          response: () => createMockGraphResponse(mockGraphEvent),
        },
      ]);

      // Case 2: no seatsPerTimeSlot → hideAttendees = false
      const eventVisible = createMockCalendarServiceEvent({
        seatsPerTimeSlot: null,
        seatsShowAttendees: true,
      });

      await service.createEvent(eventVisible, 1);
      requestBody = JSON.parse(mockRequestRaw.mock.calls[0][0].options.body);
      expect(requestBody.hideAttendees).toBe(false);
    });
  });

  // =========================================================================
  // CI-001 gap: Microsoft Graph Change Notification Subscription
  //
  // New functionality for calendar-driven cancellation sync. When a user
  // deletes or declines an event in Outlook, Microsoft Graph sends a change
  // notification to our webhook. Cal.com subscribes to these notifications
  // via POST /v1.0/subscriptions and unsubscribes via DELETE.
  // =========================================================================
  describe("CI-001 gap: Microsoft Graph Change Notification Subscription", () => {
    test("should create a subscription via POST /subscriptions with correct payload", async () => {
      const service = BuildCalendarService(mockCredential);

      // Store the original env and set the notification URL
      const originalEnv = process.env.OUTLOOK_GRAPH_NOTIFICATION_URL;
      process.env.OUTLOOK_GRAPH_NOTIFICATION_URL = "https://app.cal.com/api/webhooks/outlook-notifications";

      try {
        const mockSubscriptionResponse = {
          id: "sub-parity-123",
          resource: "/me/events",
          expirationDateTime: "2024-01-18T00:00:00Z",
        };

        setupMockRequestRaw([
          {
            urlPattern: "/subscriptions",
            method: "POST",
            response: () => createMockGraphResponse(mockSubscriptionResponse),
          },
        ]);

        const result = await service.subscribeToChanges!(1);

        // Verify POST was sent to /subscriptions
        const postCall = mockRequestRaw.mock.calls.find(
          (call) => call[0].options?.method === "POST" && call[0].url.includes("/subscriptions")
        );
        expect(postCall).toBeDefined();

        // Verify request body contains required fields
        const requestBody = JSON.parse(postCall![0].options.body);
        expect(requestBody.changeType).toBe("created,updated,deleted");
        expect(requestBody.notificationUrl).toBe(
          "https://app.cal.com/api/webhooks/outlook-notifications"
        );
        expect(requestBody.resource).toContain("/me/events");
        expect(requestBody.expirationDateTime).toBeDefined();
        expect(requestBody.clientState).toBe("cal-credential-1");

        // Verify the expirationDateTime is in the future
        const expiration = new Date(requestBody.expirationDateTime);
        expect(expiration.getTime()).toBeGreaterThan(Date.now());

        // Verify return value structure
        expect(result).toEqual({
          channelId: "sub-parity-123",
          resourceId: "/me/events",
          expiration: "2024-01-18T00:00:00Z",
        });
      } finally {
        // Restore original env
        if (originalEnv === undefined) {
          delete process.env.OUTLOOK_GRAPH_NOTIFICATION_URL;
        } else {
          process.env.OUTLOOK_GRAPH_NOTIFICATION_URL = originalEnv;
        }
      }
    });

    test("should throw when OUTLOOK_GRAPH_NOTIFICATION_URL is not configured", async () => {
      const service = BuildCalendarService(mockCredential);

      // Ensure the env variable is not set
      const originalEnv = process.env.OUTLOOK_GRAPH_NOTIFICATION_URL;
      delete process.env.OUTLOOK_GRAPH_NOTIFICATION_URL;

      try {
        await expect(service.subscribeToChanges!(1)).rejects.toThrow(
          "OUTLOOK_GRAPH_NOTIFICATION_URL environment variable is not configured"
        );
      } finally {
        if (originalEnv !== undefined) {
          process.env.OUTLOOK_GRAPH_NOTIFICATION_URL = originalEnv;
        }
      }
    });

    test("should delete subscription via DELETE /subscriptions/{id}", async () => {
      const service = BuildCalendarService(mockCredential);

      setupMockRequestRaw([
        {
          urlPattern: "/subscriptions/sub-to-delete-456",
          method: "DELETE",
          response: () =>
            new Response(null, {
              status: 204,
              statusText: "No Content",
              headers: new Headers({ "Content-Type": "application/json" }),
            }),
        },
      ]);

      // Should not throw on successful deletion
      await service.unsubscribeFromChanges!("sub-to-delete-456", "/me/events");

      // Verify DELETE was sent to correct URL
      const deleteCall = mockRequestRaw.mock.calls.find(
        (call) =>
          (call[0].options?.method === "DELETE" || call[0].options?.method === "delete") &&
          call[0].url.includes("/subscriptions/sub-to-delete-456")
      );
      expect(deleteCall).toBeDefined();
      expect(deleteCall![0].url).toBe(`${API_GRAPH_URL}/subscriptions/sub-to-delete-456`);
    });

    test("should handle errors gracefully during unsubscribe — no throw on 404", async () => {
      const service = BuildCalendarService(mockCredential);

      setupMockRequestRaw([
        {
          urlPattern: "/subscriptions/nonexistent-sub",
          method: "DELETE",
          response: () =>
            new Response(
              JSON.stringify({ error: { code: "ItemNotFound", message: "Subscription not found" } }),
              {
                status: 404,
                statusText: "Not Found",
                headers: new Headers({ "Content-Type": "application/json" }),
              }
            ),
        },
      ]);

      // unsubscribeFromChanges catches errors internally and does NOT rethrow
      await expect(
        service.unsubscribeFromChanges!("nonexistent-sub", "/me/events")
      ).resolves.toBeUndefined();
    });

    test("should handle errors gracefully during unsubscribe — no throw on 500", async () => {
      const service = BuildCalendarService(mockCredential);

      setupMockRequestRaw([
        {
          urlPattern: "/subscriptions/server-error-sub",
          method: "DELETE",
          response: () =>
            new Response(
              JSON.stringify({ error: { code: "InternalServerError", message: "Server error" } }),
              {
                status: 500,
                statusText: "Internal Server Error",
                headers: new Headers({ "Content-Type": "application/json" }),
              }
            ),
        },
      ]);

      // Should not throw even on 500 — unsubscribe errors are logged, not propagated
      await expect(
        service.unsubscribeFromChanges!("server-error-sub", "/me/events")
      ).resolves.toBeUndefined();
    });

    test("subscribeToChanges and unsubscribeFromChanges should be available on the service instance", () => {
      const service = BuildCalendarService(mockCredential);

      // These methods are new CI-001 gap closure additions to the Calendar interface
      expect(typeof service.subscribeToChanges).toBe("function");
      expect(typeof service.unsubscribeFromChanges).toBe("function");
    });
  });
});
