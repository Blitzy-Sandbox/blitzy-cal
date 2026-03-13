/**
 * Unit tests for OutlookCancellationHandler
 *
 * Tests the handler that processes Microsoft Graph change notification payloads
 * to detect event deletions and attendee declines in Outlook/Office 365 calendars,
 * then delegates cancellation propagation to CalendarCancellationSyncService.
 *
 * Covers:
 *  - Request validation (clientState token verification, subscription validation handshake)
 *  - Notification extraction from request body (valid, malformed, empty payloads)
 *  - Notification handling for all change types (deleted, updated, created)
 *  - Event ID extraction from resource paths and resourceData
 *  - Sync delta event processing (cancelled vs. non-cancelled)
 *  - Subscription renewal detection (expiring vs. non-expiring subscriptions)
 *  - Batch notification processing (multiple notifications in a single request)
 *  - Edge cases (unknown change types, missing event IDs, empty value arrays)
 *
 * @see OutlookCancellationHandler — ../OutlookCancellationHandler.ts
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
import { OutlookCancellationHandler } from "../OutlookCancellationHandler";

// ─── Helper Functions ───────────────────────────────────────────────────────────

/**
 * Builds a mock CalendarCancellationSyncService for DI injection.
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
 * Builds a Microsoft Graph change notification payload body.
 */
function buildGraphNotificationPayload(
  notifications: Array<{
    changeType?: string;
    resource?: string;
    subscriptionId?: string;
    clientState?: string;
    subscriptionExpirationDateTime?: string;
    resourceData?: { id?: string; "@odata.type"?: string };
  }> = []
): Record<string, unknown> {
  return {
    value: notifications.map((n) => ({
      changeType: n.changeType ?? "deleted",
      resource: n.resource ?? "me/events/event-id-123",
      subscriptionId: n.subscriptionId ?? "sub-id-456",
      clientState: n.clientState ?? "test-ms-webhook-token",
      subscriptionExpirationDateTime: n.subscriptionExpirationDateTime,
      resourceData: n.resourceData,
    })),
  };
}

/**
 * Builds a mock Request with Microsoft Graph change notification body.
 * The body is provided as a pre-parsed object (simulating NestJS/Next.js middleware).
 */
function buildOutlookRequest(
  body?: Record<string, unknown>,
  options: {
    url?: string;
    headers?: Record<string, string>;
  } = {}
): Request {
  const url = options.url ?? "https://cal.com/api/webhooks/microsoft-graph";
  const headers = options.headers ?? {};

  // Microsoft Graph sends clientState in the notification body, but some
  // middleware may also set it as a header. We support both.
  const request = new Request(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  // Simulate pre-parsed body (NestJS / Next.js middleware overwrites request.body
  // with a plain object before it reaches handlers)
  if (body) {
    Object.defineProperty(request, "body", {
      value: body,
      writable: true,
      configurable: true,
    });
  }

  return request;
}

// ─── Test Suite ─────────────────────────────────────────────────────────────────

describe("OutlookCancellationHandler", () => {
  let handler: OutlookCancellationHandler;
  let mockSyncService: ReturnType<typeof buildMockCancellationSyncService>;

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.MICROSOFT_WEBHOOK_TOKEN = "test-ms-webhook-token";
    mockSyncService = buildMockCancellationSyncService();
    handler = new OutlookCancellationHandler(mockSyncService as any);
  });

  // ── Request Validation ──────────────────────────────────────────────────────

  describe("validateRequest", () => {
    it("should return isValid true when clientState matches MICROSOFT_WEBHOOK_TOKEN in body", async () => {
      const body = buildGraphNotificationPayload([
        { clientState: "test-ms-webhook-token", changeType: "deleted", resource: "me/events/e1" },
      ]);
      const request = buildOutlookRequest(body);

      const result = await handler.validateRequest(request);
      expect(result.isValid).toBe(true);
      expect(result.validationToken).toBeUndefined();
    });

    it("should return isValid true with validationToken for subscription handshake", async () => {
      const url = "https://cal.com/api/webhooks/microsoft-graph?validationToken=abc123-validation-token";
      const request = buildOutlookRequest(undefined, { url });

      const result = await handler.validateRequest(request);
      expect(result.isValid).toBe(true);
      expect(result.validationToken).toBe("abc123-validation-token");
    });

    it("should return isValid false when MICROSOFT_WEBHOOK_TOKEN env var is not configured", async () => {
      delete process.env.MICROSOFT_WEBHOOK_TOKEN;
      handler = new OutlookCancellationHandler(mockSyncService as any);

      const body = buildGraphNotificationPayload([
        { clientState: "test-ms-webhook-token", changeType: "deleted", resource: "me/events/e1" },
      ]);
      const request = buildOutlookRequest(body);

      const result = await handler.validateRequest(request);
      expect(result.isValid).toBe(false);
    });

    it("should return isValid false when clientState does not match", async () => {
      const body = buildGraphNotificationPayload([
        { clientState: "wrong-token", changeType: "deleted", resource: "me/events/e1" },
      ]);
      const request = buildOutlookRequest(body);

      const result = await handler.validateRequest(request);
      expect(result.isValid).toBe(false);
    });

    it("should return isValid true when clientState is provided via header", async () => {
      const request = buildOutlookRequest(undefined, {
        headers: { clientState: "test-ms-webhook-token" },
      });

      const result = await handler.validateRequest(request);
      expect(result.isValid).toBe(true);
    });
  });

  // ── Notification Extraction ─────────────────────────────────────────────────

  describe("extractNotifications", () => {
    it("should extract valid notifications from payload body", () => {
      const body = buildGraphNotificationPayload([
        { changeType: "deleted", resource: "me/events/event-1" },
        { changeType: "updated", resource: "me/events/event-2" },
      ]);

      const notifications = handler.extractNotifications(body);
      expect(notifications).toHaveLength(2);
      expect(notifications[0].changeType).toBe("deleted");
      expect(notifications[1].changeType).toBe("updated");
    });

    it("should return empty array when body is null", () => {
      const notifications = handler.extractNotifications(null);
      expect(notifications).toHaveLength(0);
    });

    it("should return empty array when body has no 'value' array", () => {
      const notifications = handler.extractNotifications({ foo: "bar" });
      expect(notifications).toHaveLength(0);
    });

    it("should return empty array when 'value' is not an array", () => {
      const notifications = handler.extractNotifications({ value: "not-an-array" });
      expect(notifications).toHaveLength(0);
    });

    it("should filter out malformed notification elements", () => {
      const body = {
        value: [
          { changeType: "deleted", resource: "me/events/event-1" }, // valid
          { changeType: "updated" }, // missing resource
          { resource: "me/events/event-3" }, // missing changeType
          null, // null element
          { changeType: 123, resource: "me/events/event-4" }, // non-string changeType
        ],
      };

      const notifications = handler.extractNotifications(body);
      expect(notifications).toHaveLength(1);
      expect(notifications[0].changeType).toBe("deleted");
    });
  });

  // ── Notification Handling: subscription validation ──────────────────────────

  describe("handleNotification — subscription validation", () => {
    it("should return validationToken for subscription handshake request", async () => {
      const url = "https://cal.com/api/webhooks/microsoft-graph?validationToken=handshake-token-xyz";
      const request = buildOutlookRequest(undefined, { url });

      const result = await handler.handleNotification(request);

      expect(result.success).toBe(true);
      expect(result.message).toBe("Subscription validation");
      expect(result.validationToken).toBe("handshake-token-xyz");
      expect(result.results).toHaveLength(0);
      expect(mockSyncService.handleExternalCancellation).not.toHaveBeenCalled();
    });
  });

  // ── Notification Handling: deleted change type ──────────────────────────────

  describe("handleNotification — deleted change type", () => {
    it("should propagate cancellation for deleted event", async () => {
      const body = buildGraphNotificationPayload([
        {
          changeType: "deleted",
          resource: "me/events/outlook-event-789",
          clientState: "test-ms-webhook-token",
        },
      ]);
      const request = buildOutlookRequest(body);

      const result = await handler.handleNotification(request, body);

      expect(result.success).toBe(true);
      expect(result.results).toHaveLength(1);
      expect(result.results[0].success).toBe(true);
      expect(result.results[0].changeType).toBe("deleted");
      expect(mockSyncService.handleExternalCancellation).toHaveBeenCalledWith({
        externalEventUid: "outlook-event-789",
        provider: "office365_calendar",
        reason: "Event deleted from Outlook calendar",
      });
    });

    it("should extract event ID from resourceData.id when available", async () => {
      const body = buildGraphNotificationPayload([
        {
          changeType: "deleted",
          resource: "me/events/some-path",
          clientState: "test-ms-webhook-token",
          resourceData: { id: "resourcedata-event-id" },
        },
      ]);
      const request = buildOutlookRequest(body);

      const result = await handler.handleNotification(request, body);

      expect(result.results[0].success).toBe(true);
      expect(mockSyncService.handleExternalCancellation).toHaveBeenCalledWith(
        expect.objectContaining({
          externalEventUid: "resourcedata-event-id",
        })
      );
    });
  });

  // ── Notification Handling: updated change type ──────────────────────────────

  describe("handleNotification — updated change type", () => {
    it("should note update without triggering cancellation", async () => {
      const body = buildGraphNotificationPayload([
        {
          changeType: "updated",
          resource: "me/events/updated-event-id",
          clientState: "test-ms-webhook-token",
        },
      ]);
      const request = buildOutlookRequest(body);

      const result = await handler.handleNotification(request, body);

      expect(result.success).toBe(true);
      expect(result.results[0].success).toBe(true);
      expect(result.results[0].message).toContain("deferred to sync delta");
      expect(mockSyncService.handleExternalCancellation).not.toHaveBeenCalled();
    });
  });

  // ── Notification Handling: created change type ──────────────────────────────

  describe("handleNotification — created change type", () => {
    it("should skip created events (not relevant for cancellation)", async () => {
      const body = buildGraphNotificationPayload([
        {
          changeType: "created",
          resource: "me/events/new-event-id",
          clientState: "test-ms-webhook-token",
        },
      ]);
      const request = buildOutlookRequest(body);

      const result = await handler.handleNotification(request, body);

      expect(result.success).toBe(true);
      expect(result.results[0].success).toBe(true);
      expect(result.results[0].message).toContain("not relevant for cancellation sync");
      expect(mockSyncService.handleExternalCancellation).not.toHaveBeenCalled();
    });
  });

  // ── Notification Handling: validation failures ──────────────────────────────

  describe("handleNotification — validation failures", () => {
    it("should return failure when clientState is invalid", async () => {
      const body = buildGraphNotificationPayload([
        {
          changeType: "deleted",
          resource: "me/events/e1",
          clientState: "bad-token",
        },
      ]);
      const request = buildOutlookRequest(body);

      const result = await handler.handleNotification(request, body);

      expect(result.success).toBe(false);
      expect(result.message).toBe("Invalid request");
      expect(mockSyncService.handleExternalCancellation).not.toHaveBeenCalled();
    });

    it("should return failure when no notifications found in body", async () => {
      const body = { value: [] };
      const request = buildOutlookRequest(body, {
        headers: { clientState: "test-ms-webhook-token" },
      });

      const result = await handler.handleNotification(request, body);

      expect(result.success).toBe(false);
      expect(result.message).toContain("No notifications");
    });
  });

  // ── Batch Notification Processing ───────────────────────────────────────────

  describe("handleNotification — batch processing", () => {
    it("should process multiple notifications in a single batch", async () => {
      const body = buildGraphNotificationPayload([
        {
          changeType: "deleted",
          resource: "me/events/event-1",
          clientState: "test-ms-webhook-token",
        },
        {
          changeType: "updated",
          resource: "me/events/event-2",
          clientState: "test-ms-webhook-token",
        },
        {
          changeType: "deleted",
          resource: "me/events/event-3",
          clientState: "test-ms-webhook-token",
        },
      ]);
      const request = buildOutlookRequest(body);

      const result = await handler.handleNotification(request, body);

      expect(result.success).toBe(true);
      expect(result.results).toHaveLength(3);

      // First and third are deleted → cancellation triggered
      expect(mockSyncService.handleExternalCancellation).toHaveBeenCalledTimes(2);
      expect(mockSyncService.handleExternalCancellation).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ externalEventUid: "event-1" })
      );
      expect(mockSyncService.handleExternalCancellation).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ externalEventUid: "event-3" })
      );
    });
  });

  // ── Event ID Extraction ─────────────────────────────────────────────────────

  describe("Event ID extraction from resource paths", () => {
    it("should extract event ID from 'me/events/{id}' path", async () => {
      const body = buildGraphNotificationPayload([
        {
          changeType: "deleted",
          resource: "me/events/abc-123-def",
          clientState: "test-ms-webhook-token",
        },
      ]);
      const request = buildOutlookRequest(body);

      await handler.handleNotification(request, body);

      expect(mockSyncService.handleExternalCancellation).toHaveBeenCalledWith(
        expect.objectContaining({ externalEventUid: "abc-123-def" })
      );
    });

    it("should extract event ID from 'users/{userId}/events/{id}' path", async () => {
      const body = buildGraphNotificationPayload([
        {
          changeType: "deleted",
          resource: "users/user-uuid/events/event-uuid-456",
          clientState: "test-ms-webhook-token",
        },
      ]);
      const request = buildOutlookRequest(body);

      await handler.handleNotification(request, body);

      expect(mockSyncService.handleExternalCancellation).toHaveBeenCalledWith(
        expect.objectContaining({ externalEventUid: "event-uuid-456" })
      );
    });

    it("should extract event ID from 'me/calendars/{calId}/events/{id}' path", async () => {
      const body = buildGraphNotificationPayload([
        {
          changeType: "deleted",
          resource: "me/calendars/cal-uuid/events/deep-event-789",
          clientState: "test-ms-webhook-token",
        },
      ]);
      const request = buildOutlookRequest(body);

      await handler.handleNotification(request, body);

      expect(mockSyncService.handleExternalCancellation).toHaveBeenCalledWith(
        expect.objectContaining({ externalEventUid: "deep-event-789" })
      );
    });

    it("should return failure when event ID cannot be extracted", async () => {
      const body = buildGraphNotificationPayload([
        {
          changeType: "deleted",
          resource: "me/calendars/no-events-segment",
          clientState: "test-ms-webhook-token",
        },
      ]);
      const request = buildOutlookRequest(body);

      const result = await handler.handleNotification(request, body);

      expect(result.results[0].success).toBe(false);
      expect(result.results[0].message).toContain("Could not extract event ID");
      expect(mockSyncService.handleExternalCancellation).not.toHaveBeenCalled();
    });

    it("should prefer resourceData.id over resource path extraction", async () => {
      const body = buildGraphNotificationPayload([
        {
          changeType: "deleted",
          resource: "me/events/path-event-id",
          clientState: "test-ms-webhook-token",
          resourceData: { id: "preferred-resource-data-id" },
        },
      ]);
      const request = buildOutlookRequest(body);

      await handler.handleNotification(request, body);

      expect(mockSyncService.handleExternalCancellation).toHaveBeenCalledWith(
        expect.objectContaining({ externalEventUid: "preferred-resource-data-id" })
      );
    });
  });

  // ── Sync Delta Event Processing ─────────────────────────────────────────────

  describe("handleSyncDeltaEvent", () => {
    it("should propagate cancellation when isCancelled is true", async () => {
      const result = await handler.handleSyncDeltaEvent("outlook-event-456", true);

      expect(result.success).toBe(true);
      expect(result.bookingId).toBe(42);
      expect(mockSyncService.handleExternalCancellation).toHaveBeenCalledWith({
        externalEventUid: "outlook-event-456",
        provider: "office365_calendar",
        reason: "Event cancelled in Outlook calendar (detected via sync delta)",
      });
    });

    it("should skip non-cancelled events (isCancelled is false)", async () => {
      const result = await handler.handleSyncDeltaEvent("outlook-event-456", false);

      expect(result.success).toBe(true);
      expect(result.message).toBe("Event not cancelled");
      expect(mockSyncService.handleExternalCancellation).not.toHaveBeenCalled();
    });

    it("should handle cancellation sync service returning failure", async () => {
      mockSyncService.handleExternalCancellation.mockResolvedValue({
        success: false,
        message: "No matching booking found",
      });

      const result = await handler.handleSyncDeltaEvent("unknown-event", true);

      expect(result.success).toBe(false);
      expect(result.message).toBe("No matching booking found");
    });
  });

  // ── Subscription Renewal Detection ──────────────────────────────────────────

  describe("isSubscriptionRenewalNeeded", () => {
    it("should return true when subscription expires in less than 24 hours", () => {
      const nearExpiration = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(); // 12h from now
      const notification = {
        subscriptionId: "sub-1",
        subscriptionExpirationDateTime: nearExpiration,
        changeType: "updated" as const,
        resource: "me/events/e1",
      };

      expect(handler.isSubscriptionRenewalNeeded(notification)).toBe(true);
    });

    it("should return false when subscription expiration is more than 24 hours away", () => {
      const farExpiration = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(); // 48h from now
      const notification = {
        subscriptionId: "sub-2",
        subscriptionExpirationDateTime: farExpiration,
        changeType: "updated" as const,
        resource: "me/events/e2",
      };

      expect(handler.isSubscriptionRenewalNeeded(notification)).toBe(false);
    });

    it("should return false when no subscriptionExpirationDateTime is present", () => {
      const notification = {
        subscriptionId: "sub-3",
        changeType: "deleted" as const,
        resource: "me/events/e3",
      };

      expect(handler.isSubscriptionRenewalNeeded(notification)).toBe(false);
    });

    it("should return true when subscription has already expired", () => {
      const pastExpiration = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 1h ago
      const notification = {
        subscriptionId: "sub-4",
        subscriptionExpirationDateTime: pastExpiration,
        changeType: "updated" as const,
        resource: "me/events/e4",
      };

      expect(handler.isSubscriptionRenewalNeeded(notification)).toBe(true);
    });
  });

  // ── Unknown Change Types ────────────────────────────────────────────────────

  describe("handleNotification — unknown change type", () => {
    it("should return failure for unknown change type in notification", async () => {
      const body = {
        value: [
          {
            changeType: "unknown_type",
            resource: "me/events/event-1",
            subscriptionId: "sub-1",
            clientState: "test-ms-webhook-token",
          },
        ],
      };
      const request = buildOutlookRequest(body, {
        headers: { clientState: "test-ms-webhook-token" },
      });

      const result = await handler.handleNotification(request, body);

      expect(result.results[0].success).toBe(false);
      expect(result.results[0].message).toContain("Unknown change type");
      expect(mockSyncService.handleExternalCancellation).not.toHaveBeenCalled();
    });
  });
});
