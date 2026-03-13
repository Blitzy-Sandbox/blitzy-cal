/**
 * Unit tests for GoogleCancellationHandler
 *
 * Tests the handler that processes Google Calendar push notification payloads
 * to detect event deletions and attendee declines, then delegates cancellation
 * propagation to CalendarCancellationSyncService.
 *
 * Covers:
 *  - Request validation (token verification, missing/invalid tokens)
 *  - Notification payload extraction from Google-specific HTTP headers
 *  - Notification handling for all resource states (sync, exists, not_exists)
 *  - Direct cancellation propagation when externalEventUid is provided
 *  - Notification-only mode when no externalEventUid is provided
 *  - Sync delta event processing (cancelled vs. non-cancelled status)
 *  - Edge cases (unknown resource state, missing headers, missing env var)
 *
 * @see GoogleCancellationHandler — ../GoogleCancellationHandler.ts
 * @see CalendarCancellationSyncService — ../../CalendarCancellationSyncService.ts
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// ─── Mock Logger ────────────────────────────────────────────────────────────────
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

// ─── Module Under Test ──────────────────────────────────────────────────────────
import { GoogleCancellationHandler } from "../GoogleCancellationHandler";

// ─── Helper Functions ───────────────────────────────────────────────────────────

/**
 * Builds a mock CalendarCancellationSyncService for DI injection.
 * Returns a fresh mock instance for each test.
 */
function buildMockCancellationSyncService() {
  return {
    handleExternalCancellation: vi.fn().mockResolvedValue({
      success: true,
      message: "Booking cancelled",
      bookingId: 42,
    }),
    validateNotificationPayload: vi.fn().mockReturnValue(true),
  };
}

/**
 * Builds a mock Request with Google Calendar push notification headers.
 * All required and optional headers can be overridden via the `headers` parameter.
 */
function buildGooglePushRequest(headers: Record<string, string> = {}): Request {
  const defaultHeaders: Record<string, string> = {
    "X-Goog-Channel-ID": "channel-uuid-123",
    "X-Goog-Resource-ID": "resource-id-456",
    "X-Goog-Resource-State": "exists",
    "X-Goog-Channel-Token": "test-webhook-token",
  };

  const mergedHeaders = { ...defaultHeaders, ...headers };
  return new Request("https://cal.com/api/webhooks/google-calendar", {
    method: "POST",
    headers: mergedHeaders,
  });
}

// ─── Test Suite ─────────────────────────────────────────────────────────────────

describe("GoogleCancellationHandler", () => {
  let handler: GoogleCancellationHandler;
  let mockSyncService: ReturnType<typeof buildMockCancellationSyncService>;

  beforeEach(() => {
    vi.restoreAllMocks();
    // Set the environment variable that validateRequest checks
    process.env.GOOGLE_WEBHOOK_TOKEN = "test-webhook-token";
    mockSyncService = buildMockCancellationSyncService();
    handler = new GoogleCancellationHandler(mockSyncService as any);
  });

  // ── Request Validation ──────────────────────────────────────────────────────

  describe("validateRequest", () => {
    it("should return true when X-Goog-Channel-Token matches GOOGLE_WEBHOOK_TOKEN", async () => {
      const request = buildGooglePushRequest();
      const result = await handler.validateRequest(request);
      expect(result).toBe(true);
    });

    it("should return false when GOOGLE_WEBHOOK_TOKEN env var is not configured", async () => {
      delete process.env.GOOGLE_WEBHOOK_TOKEN;
      // Re-create handler to pick up the missing env var
      handler = new GoogleCancellationHandler(mockSyncService as any);

      const request = buildGooglePushRequest();
      const result = await handler.validateRequest(request);
      expect(result).toBe(false);
    });

    it("should return false when X-Goog-Channel-Token header is missing", async () => {
      const headers = {
        "X-Goog-Channel-ID": "channel-uuid-123",
        "X-Goog-Resource-ID": "resource-id-456",
        "X-Goog-Resource-State": "exists",
      };
      // Build a request with explicit headers (no token)
      const request = new Request("https://cal.com/api/webhooks/google-calendar", {
        method: "POST",
        headers,
      });
      const result = await handler.validateRequest(request);
      expect(result).toBe(false);
    });

    it("should return false when X-Goog-Channel-Token does not match", async () => {
      const request = buildGooglePushRequest({
        "X-Goog-Channel-Token": "wrong-token",
      });
      const result = await handler.validateRequest(request);
      expect(result).toBe(false);
    });
  });

  // ── Notification Payload Extraction ─────────────────────────────────────────

  describe("extractNotificationPayload", () => {
    it("should extract all required and optional headers into payload object", () => {
      const request = buildGooglePushRequest({
        "X-Goog-Channel-ID": "ch-id-1",
        "X-Goog-Resource-ID": "res-id-2",
        "X-Goog-Resource-State": "not_exists",
        "X-Goog-Resource-URI": "https://www.googleapis.com/calendar/v3/calendars/primary/events",
        "X-Goog-Message-Number": "5",
        "X-Goog-Channel-Expiration": "2024-06-15T12:00:00Z",
      });

      const payload = handler.extractNotificationPayload(request);

      expect(payload).not.toBeNull();
      expect(payload!.channelId).toBe("ch-id-1");
      expect(payload!.resourceId).toBe("res-id-2");
      expect(payload!.resourceState).toBe("not_exists");
      expect(payload!.resourceUri).toBe("https://www.googleapis.com/calendar/v3/calendars/primary/events");
      expect(payload!.messageNumber).toBe("5");
      expect(payload!.channelExpiration).toBe("2024-06-15T12:00:00Z");
    });

    it("should return null when X-Goog-Channel-ID header is missing", () => {
      const request = new Request("https://cal.com/api/webhooks/google-calendar", {
        method: "POST",
        headers: {
          "X-Goog-Resource-ID": "resource-id-456",
          "X-Goog-Resource-State": "exists",
        },
      });

      const payload = handler.extractNotificationPayload(request);
      expect(payload).toBeNull();
    });

    it("should return null when X-Goog-Resource-ID header is missing", () => {
      const request = new Request("https://cal.com/api/webhooks/google-calendar", {
        method: "POST",
        headers: {
          "X-Goog-Channel-ID": "channel-uuid-123",
          "X-Goog-Resource-State": "exists",
        },
      });

      const payload = handler.extractNotificationPayload(request);
      expect(payload).toBeNull();
    });

    it("should return null when X-Goog-Resource-State header is missing", () => {
      const request = new Request("https://cal.com/api/webhooks/google-calendar", {
        method: "POST",
        headers: {
          "X-Goog-Channel-ID": "channel-uuid-123",
          "X-Goog-Resource-ID": "resource-id-456",
        },
      });

      const payload = handler.extractNotificationPayload(request);
      expect(payload).toBeNull();
    });

    it("should handle missing optional headers gracefully", () => {
      const request = buildGooglePushRequest();
      const payload = handler.extractNotificationPayload(request);

      expect(payload).not.toBeNull();
      expect(payload!.resourceUri).toBeUndefined();
      expect(payload!.messageNumber).toBeUndefined();
      expect(payload!.channelExpiration).toBeUndefined();
    });
  });

  // ── Notification Handling: sync state ───────────────────────────────────────

  describe("handleNotification — sync state", () => {
    it("should acknowledge sync confirmation without triggering cancellation", async () => {
      const request = buildGooglePushRequest({
        "X-Goog-Resource-State": "sync",
      });

      const result = await handler.handleNotification(request);

      expect(result.success).toBe(true);
      expect(result.message).toBe("Sync confirmation acknowledged");
      expect(result.bookingId).toBeUndefined();
      // Cancellation sync service should NOT be called
      expect(mockSyncService.handleExternalCancellation).not.toHaveBeenCalled();
    });
  });

  // ── Notification Handling: not_exists state ─────────────────────────────────

  describe("handleNotification — not_exists state", () => {
    it("should propagate cancellation when externalEventUid is provided", async () => {
      const request = buildGooglePushRequest({
        "X-Goog-Resource-State": "not_exists",
      });

      const result = await handler.handleNotification(request, "ext-event-uid-789");

      expect(result.success).toBe(true);
      expect(result.bookingId).toBe(42);
      expect(mockSyncService.handleExternalCancellation).toHaveBeenCalledWith({
        externalEventUid: "ext-event-uid-789",
        provider: "google_calendar",
        reason: "Event deleted from Google Calendar",
      });
    });

    it("should return success without propagation when no externalEventUid", async () => {
      const request = buildGooglePushRequest({
        "X-Goog-Resource-State": "not_exists",
      });

      const result = await handler.handleNotification(request);

      expect(result.success).toBe(true);
      expect(result.message).toContain("awaiting sync delta resolution");
      expect(mockSyncService.handleExternalCancellation).not.toHaveBeenCalled();
    });
  });

  // ── Notification Handling: exists state ─────────────────────────────────────

  describe("handleNotification — exists state", () => {
    it("should propagate cancellation when externalEventUid is provided", async () => {
      const request = buildGooglePushRequest({
        "X-Goog-Resource-State": "exists",
      });

      const result = await handler.handleNotification(request, "ext-event-uid-abc");

      expect(result.success).toBe(true);
      expect(result.bookingId).toBe(42);
      expect(mockSyncService.handleExternalCancellation).toHaveBeenCalledWith({
        externalEventUid: "ext-event-uid-abc",
        provider: "google_calendar",
        reason: "Event cancelled or declined in Google Calendar",
      });
    });

    it("should return success without propagation when no externalEventUid", async () => {
      const request = buildGooglePushRequest({
        "X-Goog-Resource-State": "exists",
      });

      const result = await handler.handleNotification(request);

      expect(result.success).toBe(true);
      expect(result.message).toContain("awaiting sync delta resolution");
      expect(mockSyncService.handleExternalCancellation).not.toHaveBeenCalled();
    });
  });

  // ── Notification Handling: unknown state ────────────────────────────────────

  describe("handleNotification — unknown state", () => {
    it("should return failure for unknown resource state", async () => {
      const request = buildGooglePushRequest({
        "X-Goog-Resource-State": "unknown_state",
      });

      const result = await handler.handleNotification(request);

      expect(result.success).toBe(false);
      expect(result.message).toContain("Unknown resource state");
      expect(mockSyncService.handleExternalCancellation).not.toHaveBeenCalled();
    });
  });

  // ── Notification Handling: validation failures ──────────────────────────────

  describe("handleNotification — validation failures", () => {
    it("should return failure when request validation fails (invalid token)", async () => {
      const request = buildGooglePushRequest({
        "X-Goog-Channel-Token": "wrong-token",
      });

      const result = await handler.handleNotification(request);

      expect(result.success).toBe(false);
      expect(result.message).toBe("Invalid request");
      expect(mockSyncService.handleExternalCancellation).not.toHaveBeenCalled();
    });

    it("should return failure when notification payload extraction fails", async () => {
      // Valid token but missing required notification headers
      const request = new Request("https://cal.com/api/webhooks/google-calendar", {
        method: "POST",
        headers: {
          "X-Goog-Channel-Token": "test-webhook-token",
          // Missing Channel-ID, Resource-ID, Resource-State
        },
      });

      const result = await handler.handleNotification(request);

      expect(result.success).toBe(false);
      expect(result.message).toBe("Missing notification payload");
      expect(mockSyncService.handleExternalCancellation).not.toHaveBeenCalled();
    });
  });

  // ── Sync Delta Event Processing ─────────────────────────────────────────────

  describe("handleSyncDeltaEvent", () => {
    it("should propagate cancellation when event status is 'cancelled'", async () => {
      const result = await handler.handleSyncDeltaEvent("google-event-123", "cancelled");

      expect(result.success).toBe(true);
      expect(result.bookingId).toBe(42);
      expect(mockSyncService.handleExternalCancellation).toHaveBeenCalledWith({
        externalEventUid: "google-event-123",
        provider: "google_calendar",
        reason: "Event cancelled in Google Calendar (detected via sync delta)",
      });
    });

    it("should skip non-cancelled event statuses ('confirmed')", async () => {
      const result = await handler.handleSyncDeltaEvent("google-event-123", "confirmed");

      expect(result.success).toBe(true);
      expect(result.message).toBe("Event not cancelled");
      expect(mockSyncService.handleExternalCancellation).not.toHaveBeenCalled();
    });

    it("should skip non-cancelled event statuses ('tentative')", async () => {
      const result = await handler.handleSyncDeltaEvent("google-event-123", "tentative");

      expect(result.success).toBe(true);
      expect(result.message).toBe("Event not cancelled");
      expect(mockSyncService.handleExternalCancellation).not.toHaveBeenCalled();
    });

    it("should handle cancellation sync service failure gracefully", async () => {
      mockSyncService.handleExternalCancellation.mockResolvedValue({
        success: false,
        message: "No matching booking found",
      });

      const result = await handler.handleSyncDeltaEvent("google-event-missing", "cancelled");

      expect(result.success).toBe(false);
      expect(result.message).toBe("No matching booking found");
    });
  });

  // ── End-to-End Cancellation Flow ────────────────────────────────────────────

  describe("End-to-End Cancellation Flow", () => {
    it("should correctly chain validation → extraction → cancellation for not_exists with eventUid", async () => {
      const request = buildGooglePushRequest({
        "X-Goog-Channel-ID": "my-channel",
        "X-Goog-Resource-ID": "my-resource",
        "X-Goog-Resource-State": "not_exists",
        "X-Goog-Channel-Token": "test-webhook-token",
        "X-Goog-Message-Number": "10",
      });

      const result = await handler.handleNotification(request, "deleted-event-id");

      // Full chain should succeed
      expect(result.success).toBe(true);
      expect(result.bookingId).toBe(42);

      // Verify the cancellation was called with the correct provider and event UID
      expect(mockSyncService.handleExternalCancellation).toHaveBeenCalledTimes(1);
      expect(mockSyncService.handleExternalCancellation).toHaveBeenCalledWith(
        expect.objectContaining({
          externalEventUid: "deleted-event-id",
          provider: "google_calendar",
        })
      );
    });

    it("should handle cancellation sync service rejection without throwing", async () => {
      mockSyncService.handleExternalCancellation.mockRejectedValue(new Error("Database connection lost"));

      const request = buildGooglePushRequest({
        "X-Goog-Resource-State": "not_exists",
      });

      // The handler should propagate the rejection (it does not catch errors from the sync service)
      await expect(handler.handleNotification(request, "event-uid")).rejects.toThrow(
        "Database connection lost"
      );
    });
  });
});
