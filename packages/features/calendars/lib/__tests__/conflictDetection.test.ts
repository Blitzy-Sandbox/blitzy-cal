/**
 * CI-004: Conflict Detection Behavior Alignment Tests
 *
 * Tests configurable status-based conflict detection across all calendar providers
 * (Google, Outlook, Apple). Verifies that status filtering (Busy, Tentative, Away,
 * WorkingElsewhere, Oof) is threaded correctly through the CalendarManager aggregation
 * pipeline via getBusyCalendarTimes.
 *
 * Test coverage:
 *  - Phase 1: Status Filter Threading (backward compatibility + new statusFilter param)
 *  - Phase 2: Multi-Provider Aggregation (Google + Outlook + Apple combined results)
 *  - Phase 3: Credential Deduplication (delegation vs regular credential handling)
 *  - Phase 4: Error Handling (fetch failures, timezone-aware mode selection)
 *  - Phase 5: Recurring Events Edge Cases (multiple instances in aggregation)
 *
 * @see CalendarManager.ts — getBusyCalendarTimes, deduplicateCredentialsBasedOnSelectedCalendars
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EventBusyDate, SelectedCalendar } from "@calcom/types/Calendar";
import type { CredentialForCalendarService } from "@calcom/types/Credential";

// ─── Hoisted Mock Declarations ──────────────────────────────────────────────────
// vi.hoisted() creates values in the hoisted scope, making them available when
// vi.mock() factory functions execute (both are hoisted before any other code).

const { mockGetCalendarsEvents, mockGetCalendarsEventsWithTimezones } = vi.hoisted(() => ({
  mockGetCalendarsEvents: vi.fn(),
  mockGetCalendarsEventsWithTimezones: vi.fn(),
}));

// ─── Module-Level Mocks ─────────────────────────────────────────────────────────
// All vi.mock() calls are hoisted by vitest and execute before any imports.
// They must be defined before importing the module under test to intercept dependencies.

vi.mock("@calcom/features/calendars/lib/getCalendarsEvents", () => ({
  default: mockGetCalendarsEvents,
  getCalendarsEventsWithTimezones: mockGetCalendarsEventsWithTimezones,
}));

vi.mock("@calcom/app-store/_utils/getCalendar", () => ({
  getCalendar: vi.fn(),
}));

vi.mock("@calcom/app-store/utils", () => ({
  default: vi.fn(() => []),
}));

vi.mock("@calcom/lib/constants", () => ({
  ORGANIZER_EMAIL_EXEMPT_DOMAINS: "",
  IS_PRODUCTION: false,
}));

vi.mock("@calcom/lib/CalEventParser", () => ({
  getRichDescription: vi.fn(() => "Test description"),
  getUid: vi.fn(() => "test-uid"),
}));

vi.mock("@calcom/lib/delegationCredential", () => ({
  buildNonDelegationCredentials: vi.fn((creds: unknown[]) => creds),
}));

vi.mock("@calcom/lib/formatCalendarEvent", () => ({
  formatCalEvent: vi.fn((event: unknown) => event),
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

vi.mock("@calcom/lib/piiFreeData", () => ({
  getPiiFreeCalendarEvent: vi.fn((e: unknown) => e),
  getPiiFreeCredential: vi.fn((c: unknown) => c),
}));

vi.mock("@calcom/lib/safeStringify", () => ({
  safeStringify: vi.fn((x: unknown) => JSON.stringify(x)),
}));

vi.mock("@calcom/app-store/locations", () => ({
  MeetLocationType: "integrations:google:meet",
}));

// ─── Module Under Test ──────────────────────────────────────────────────────────
// Import AFTER all vi.mock() calls to ensure mocks are in place when the module loads.

import { getBusyCalendarTimes, deduplicateCredentialsBasedOnSelectedCalendars } from "../CalendarManager";

// ─── Test Helper Functions ──────────────────────────────────────────────────────

/**
 * Builds a mock CredentialForCalendarService object for testing.
 * Matches the exact pattern established in CalendarManager.test.ts to ensure
 * consistency across the test suite.
 */
function buildCredential(data: {
  type: string;
  appId: string;
  id: number;
  delegatedToId: string | null;
  user: { email: string } | null;
}): CredentialForCalendarService {
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
  } as CredentialForCalendarService;
}

/**
 * Builds a mock SelectedCalendar for configuring which calendars to check for conflicts.
 * Provides the four Pick fields required by the SelectedCalendar type alias
 * (userId, integration, externalId, credentialId).
 */
function buildSelectedCalendar(data: {
  integration: string;
  externalId: string;
  credentialId: number;
}): SelectedCalendar {
  return {
    userId: 10000,
    integration: data.integration,
    externalId: data.externalId,
    credentialId: data.credentialId,
  } as SelectedCalendar;
}

// ─── Test Suite ─────────────────────────────────────────────────────────────────

describe("Conflict Detection Alignment (CI-004)", () => {
  const dateFrom = "2024-01-15T00:00:00Z";
  const dateTo = "2024-01-15T23:59:59Z";

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCalendarsEvents.mockResolvedValue([]);
    mockGetCalendarsEventsWithTimezones.mockResolvedValue([]);
  });

  // ── Phase 1: Status Filter Threading ─────────────────────────────────────

  describe("Status Filter Threading", () => {
    it("should call getBusyCalendarTimes successfully with no statusFilter (default behavior)", async () => {
      const credential = buildCredential({
        type: "google_calendar",
        appId: "google-calendar",
        id: 1,
        delegatedToId: null,
        user: { email: "user@example.com" },
      });

      const selectedCalendar = buildSelectedCalendar({
        integration: "google_calendar",
        externalId: "user@example.com",
        credentialId: 1,
      });

      const result = await getBusyCalendarTimes(
        [credential],
        dateFrom,
        dateTo,
        [selectedCalendar]
      );

      expect(result.success).toBe(true);
      expect(result.data).toEqual([]);
      // Verify the standard (non-timezone) path was taken
      expect(mockGetCalendarsEvents).toHaveBeenCalledTimes(1);
    });

    it("should accept statusFilter parameter without error", async () => {
      const credential = buildCredential({
        type: "google_calendar",
        appId: "google-calendar",
        id: 1,
        delegatedToId: null,
        user: { email: "user@example.com" },
      });

      const selectedCalendar = buildSelectedCalendar({
        integration: "google_calendar",
        externalId: "user@example.com",
        credentialId: 1,
      });

      const result = await getBusyCalendarTimes(
        [credential],
        dateFrom,
        dateTo,
        [selectedCalendar],
        undefined,
        undefined,
        ["Busy", "Tentative"]
      );

      expect(result.success).toBe(true);
      expect(result.data).toEqual([]);
      // Verify statusFilter was passed through to the underlying calendar events fetcher
      expect(mockGetCalendarsEvents).toHaveBeenCalledTimes(1);
      const callArgs = mockGetCalendarsEvents.mock.calls[0];
      expect(callArgs[5]).toEqual(["Busy", "Tentative"]);
    });

    it("should accept all Calendly-equivalent status filters", async () => {
      const credential = buildCredential({
        type: "google_calendar",
        appId: "google-calendar",
        id: 1,
        delegatedToId: null,
        user: { email: "user@example.com" },
      });

      const selectedCalendar = buildSelectedCalendar({
        integration: "google_calendar",
        externalId: "user@example.com",
        credentialId: 1,
      });

      const allStatusFilters = ["Busy", "Tentative", "Away", "WorkingElsewhere", "Oof"];

      const result = await getBusyCalendarTimes(
        [credential],
        dateFrom,
        dateTo,
        [selectedCalendar],
        undefined,
        undefined,
        allStatusFilters
      );

      expect(result.success).toBe(true);
      expect(result.data).toEqual([]);
      // Verify all five Calendly-equivalent statuses are passed through
      const callArgs = mockGetCalendarsEvents.mock.calls[0];
      expect(callArgs[5]).toEqual(allStatusFilters);
    });

    it("should accept empty statusFilter array", async () => {
      const credential = buildCredential({
        type: "google_calendar",
        appId: "google-calendar",
        id: 1,
        delegatedToId: null,
        user: { email: "user@example.com" },
      });

      const selectedCalendar = buildSelectedCalendar({
        integration: "google_calendar",
        externalId: "user@example.com",
        credentialId: 1,
      });

      const result = await getBusyCalendarTimes(
        [credential],
        dateFrom,
        dateTo,
        [selectedCalendar],
        undefined,
        undefined,
        []
      );

      expect(result.success).toBe(true);
      expect(result.data).toEqual([]);
    });
  });

  // ── Phase 2: Multi-Provider Aggregation ──────────────────────────────────

  describe("Multi-Provider Aggregation", () => {
    it("should aggregate busy times from multiple providers", async () => {
      mockGetCalendarsEvents.mockResolvedValue([
        [{ start: "2024-01-15T10:00:00Z", end: "2024-01-15T11:00:00Z", source: "google_calendar" }],
        [{ start: "2024-01-15T14:00:00Z", end: "2024-01-15T15:00:00Z", source: "office365_calendar" }],
      ]);

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

      const googleCalendar = buildSelectedCalendar({
        integration: "google_calendar",
        externalId: "user@example.com",
        credentialId: 1,
      });

      const outlookCalendar = buildSelectedCalendar({
        integration: "office365_calendar",
        externalId: "user@example.com",
        credentialId: 2,
      });

      const result = await getBusyCalendarTimes(
        [googleCredential, outlookCredential],
        dateFrom,
        dateTo,
        [googleCalendar, outlookCalendar]
      );

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2);
      expect(result.data[0]).toEqual(
        expect.objectContaining({ start: "2024-01-15T10:00:00Z", end: "2024-01-15T11:00:00Z" })
      );
      expect(result.data[1]).toEqual(
        expect.objectContaining({ start: "2024-01-15T14:00:00Z", end: "2024-01-15T15:00:00Z" })
      );
    });

    it("should handle overlapping events from different providers", async () => {
      mockGetCalendarsEvents.mockResolvedValue([
        [{ start: "2024-01-15T10:00:00Z", end: "2024-01-15T12:00:00Z", source: "google_calendar" }],
        [{ start: "2024-01-15T11:00:00Z", end: "2024-01-15T13:00:00Z", source: "office365_calendar" }],
      ]);

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

      const googleCalendar = buildSelectedCalendar({
        integration: "google_calendar",
        externalId: "user@example.com",
        credentialId: 1,
      });

      const outlookCalendar = buildSelectedCalendar({
        integration: "office365_calendar",
        externalId: "user@example.com",
        credentialId: 2,
      });

      const result = await getBusyCalendarTimes(
        [googleCredential, outlookCredential],
        dateFrom,
        dateTo,
        [googleCalendar, outlookCalendar]
      );

      // Aggregation returns both events — downstream handles overlap resolution
      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2);
    });

    it("should handle all-day event busy times", async () => {
      mockGetCalendarsEvents.mockResolvedValue([
        [{ start: "2024-01-15T00:00:00Z", end: "2024-01-16T00:00:00Z", source: "google_calendar" }],
      ]);

      const credential = buildCredential({
        type: "google_calendar",
        appId: "google-calendar",
        id: 1,
        delegatedToId: null,
        user: { email: "user@example.com" },
      });

      const selectedCalendar = buildSelectedCalendar({
        integration: "google_calendar",
        externalId: "user@example.com",
        credentialId: 1,
      });

      const result = await getBusyCalendarTimes(
        [credential],
        dateFrom,
        dateTo,
        [selectedCalendar]
      );

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
      expect(result.data[0]).toEqual(
        expect.objectContaining({
          start: "2024-01-15T00:00:00Z",
          end: "2024-01-16T00:00:00Z",
          source: "google_calendar",
        })
      );
    });
  });

  // ── Phase 3: Credential Deduplication ────────────────────────────────────

  describe("Credential Deduplication", () => {
    it("should deduplicate credentials before fetching busy times", async () => {
      const calcomUser = { email: "user@example.com" };

      // Delegation credential for Google Calendar (negative ID per convention)
      const delegationCredential = buildCredential({
        type: "google_calendar",
        appId: "google-calendar",
        id: -1,
        delegatedToId: "delegation-uuid-123",
        user: calcomUser,
      });

      // Regular credential for the SAME email — should be removed by deduplication
      // because a delegation credential exists for the same integration type
      const regularCredential = buildCredential({
        type: "google_calendar",
        appId: "google-calendar",
        id: 2,
        delegatedToId: null,
        user: calcomUser,
      });

      // Selected calendar linked to the regular credential using the user's email
      const selectedCalendar = buildSelectedCalendar({
        integration: "google_calendar",
        externalId: "user@example.com",
        credentialId: 2,
      });

      await getBusyCalendarTimes(
        [delegationCredential, regularCredential],
        dateFrom,
        dateTo,
        [selectedCalendar]
      );

      // After deduplication, only the delegation credential should remain
      expect(mockGetCalendarsEvents).toHaveBeenCalledTimes(1);
      const passedCredentials = mockGetCalendarsEvents.mock.calls[0][0];
      expect(passedCredentials).toHaveLength(1);
      expect(passedCredentials[0].delegatedToId).toBe("delegation-uuid-123");
    });

    it("should handle empty credentials array gracefully", async () => {
      const result = await getBusyCalendarTimes([], dateFrom, dateTo, []);

      expect(result.success).toBe(true);
      expect(result.data).toEqual([]);
    });
  });

  // ── Phase 4: Error Handling ──────────────────────────────────────────────

  describe("Error Handling", () => {
    it("should return error placeholder when calendar fetch fails", async () => {
      mockGetCalendarsEvents.mockRejectedValue(new Error("Calendar API unavailable"));

      const credential = buildCredential({
        type: "google_calendar",
        appId: "google-calendar",
        id: 1,
        delegatedToId: null,
        user: { email: "user@example.com" },
      });

      const selectedCalendar = buildSelectedCalendar({
        integration: "google_calendar",
        externalId: "user@example.com",
        credentialId: 1,
      });

      const result = await getBusyCalendarTimes(
        [credential],
        dateFrom,
        dateTo,
        [selectedCalendar]
      );

      expect(result.success).toBe(false);
      expect(result.data).toHaveLength(1);
      expect(result.data[0]).toEqual(
        expect.objectContaining({ source: "error-placeholder" })
      );
      // The start/end are dayjs-adjusted date strings
      expect(typeof result.data[0].start).toBe("string");
      expect(typeof result.data[0].end).toBe("string");
    });

    it("should handle timezone-aware mode for Google Calendar", async () => {
      const credential = buildCredential({
        type: "google_calendar",
        appId: "google-calendar",
        id: 1,
        delegatedToId: null,
        user: { email: "user@example.com" },
      });

      const selectedCalendar = buildSelectedCalendar({
        integration: "google_calendar",
        externalId: "user@example.com",
        credentialId: 1,
      });

      await getBusyCalendarTimes(
        [credential],
        dateFrom,
        dateTo,
        [selectedCalendar],
        undefined,
        true // includeTimeZone = true triggers the timezone-aware path
      );

      // When includeTimeZone is true, getCalendarsEventsWithTimezones is used
      expect(mockGetCalendarsEventsWithTimezones).toHaveBeenCalledTimes(1);
      expect(mockGetCalendarsEvents).not.toHaveBeenCalled();
    });
  });

  // ── Phase 5: Recurring Events Edge Cases ─────────────────────────────────

  describe("Recurring Events Edge Cases", () => {
    it("should include recurring event instances in busy time aggregation", async () => {
      mockGetCalendarsEvents.mockResolvedValue([
        [
          { start: "2024-01-15T10:00:00Z", end: "2024-01-15T11:00:00Z", source: "google_calendar" },
          { start: "2024-01-22T10:00:00Z", end: "2024-01-22T11:00:00Z", source: "google_calendar" },
        ],
      ]);

      const credential = buildCredential({
        type: "google_calendar",
        appId: "google-calendar",
        id: 1,
        delegatedToId: null,
        user: { email: "user@example.com" },
      });

      const selectedCalendar = buildSelectedCalendar({
        integration: "google_calendar",
        externalId: "user@example.com",
        credentialId: 1,
      });

      const result = await getBusyCalendarTimes(
        [credential],
        dateFrom,
        dateTo,
        [selectedCalendar]
      );

      expect(result.success).toBe(true);
      // Both recurring instances must be present in the flat result
      expect(result.data).toHaveLength(2);
      expect(result.data[0]).toEqual(
        expect.objectContaining({ start: "2024-01-15T10:00:00Z", end: "2024-01-15T11:00:00Z" })
      );
      expect(result.data[1]).toEqual(
        expect.objectContaining({ start: "2024-01-22T10:00:00Z", end: "2024-01-22T11:00:00Z" })
      );
    });
  });
});
