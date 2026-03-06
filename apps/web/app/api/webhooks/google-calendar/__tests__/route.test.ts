import type { NextRequest } from "next/server";
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockHandleNotification, MockGoogleHandler } = vi.hoisted(() => {
  const mockHandleNotification = vi.fn().mockResolvedValue(undefined);
  const MockGoogleHandler = vi.fn().mockImplementation(function () {
    return { handleNotification: mockHandleNotification };
  });
  return { mockHandleNotification, MockGoogleHandler };
});

// Mock defaultResponderForAppDir to pass-through the handler, preserving the
// 2-argument signature that the real implementation expects.
vi.mock("app/api/defaultResponderForAppDir", () => ({
  defaultResponderForAppDir:
    (
      handler: (req: NextRequest, context: { params: Promise<Record<string, string>> }) => Promise<Response>
    ) =>
    async (req: NextRequest, context?: { params: Promise<Record<string, string>> }) =>
      await handler(req, context || { params: Promise.resolve({}) }),
}));

// Mock the cancellation handler and its dependencies.
// All mock implementations use `function()` (not arrow functions) because
// they are invoked with `new` in the route, and arrow functions are not valid constructors.
vi.mock("@calcom/features/calendars/lib/cancellation-sync/handlers/GoogleCancellationHandler", () => ({
  GoogleCancellationHandler: MockGoogleHandler,
}));
vi.mock("@calcom/features/calendars/lib/cancellation-sync/CalendarCancellationSyncService", () => ({
  CalendarCancellationSyncService: vi.fn().mockImplementation(function () {
    return {};
  }),
}));
vi.mock("@calcom/features/flags/repositories/PrismaFeatureRepository", () => ({
  PrismaFeatureRepository: vi.fn().mockImplementation(function () {
    return { checkIfFeatureIsEnabledGlobally: vi.fn().mockResolvedValue(false) };
  }),
}));
vi.mock("@calcom/prisma", () => ({ default: {} }));

import { POST } from "../route";

/** Helper that provides the required second argument to the wrapped handler. */
const callPOST = (request: NextRequest) => POST(request, { params: Promise.resolve({}) });

function createMockRequest(headers: Record<string, string> = {}): NextRequest {
  const req = new Request("https://app.cal.com/api/webhooks/google-calendar", {
    method: "POST",
    headers,
  });
  return req as unknown as NextRequest;
}

describe("Google Calendar Webhook Route - POST /api/webhooks/google-calendar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.GOOGLE_WEBHOOK_TOKEN;
  });

  describe("Header Validation", () => {
    it("returns 401 when X-Goog-Channel-Token header is missing", async () => {
      const request = createMockRequest({
        "x-goog-resource-state": "exists",
        "x-goog-channel-id": "test-channel-id",
        "x-goog-resource-id": "test-resource-id",
      });

      const response = await callPOST(request);
      expect(response.status).toBe(401);

      const body = await response.json();
      expect(body.error).toBe("Missing X-Goog-Channel-Token header");
    });

    it("returns 401 when X-Goog-Resource-State header is missing", async () => {
      const request = createMockRequest({
        "x-goog-channel-token": "valid-token",
        "x-goog-channel-id": "test-channel-id",
        "x-goog-resource-id": "test-resource-id",
      });

      const response = await callPOST(request);
      expect(response.status).toBe(401);

      const body = await response.json();
      expect(body.error).toBe("Missing X-Goog-Resource-State header");
    });

    it("returns 401 when channel token does not match configured GOOGLE_WEBHOOK_TOKEN", async () => {
      process.env.GOOGLE_WEBHOOK_TOKEN = "correct-secret-token";

      const request = createMockRequest({
        "x-goog-channel-token": "wrong-token",
        "x-goog-resource-state": "exists",
        "x-goog-channel-id": "test-channel-id",
        "x-goog-resource-id": "test-resource-id",
      });

      const response = await callPOST(request);
      expect(response.status).toBe(401);

      const body = await response.json();
      expect(body.error).toBe("Invalid channel token");
    });

    it("allows requests when GOOGLE_WEBHOOK_TOKEN is not configured (no validation)", async () => {
      const request = createMockRequest({
        "x-goog-channel-token": "any-token",
        "x-goog-resource-state": "exists",
        "x-goog-channel-id": "test-channel-id",
        "x-goog-resource-id": "test-resource-id",
      });

      const response = await callPOST(request);
      expect(response.status).toBe(200);
    });
  });

  describe("Sync Notification", () => {
    it("returns 200 with sync acknowledgment for sync resource state", async () => {
      const request = createMockRequest({
        "x-goog-channel-token": "valid-token",
        "x-goog-resource-state": "sync",
        "x-goog-channel-id": "test-channel-id",
        "x-goog-resource-id": "test-resource-id",
      });

      const response = await callPOST(request);
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body.status).toBe("ok");
      expect(body.message).toBe("Sync notification acknowledged");
    });

    it("does not invoke the handler for sync notifications", async () => {
      const request = createMockRequest({
        "x-goog-channel-token": "valid-token",
        "x-goog-resource-state": "sync",
        "x-goog-channel-id": "test-channel-id",
        "x-goog-resource-id": "test-resource-id",
      });

      await callPOST(request);
      expect(MockGoogleHandler).not.toHaveBeenCalled();
    });
  });

  describe("Valid POST on 'exists' State", () => {
    it("returns 200 on valid POST with exists resource state", async () => {
      process.env.GOOGLE_WEBHOOK_TOKEN = "correct-secret";

      const request = createMockRequest({
        "x-goog-channel-token": "correct-secret",
        "x-goog-resource-state": "exists",
        "x-goog-channel-id": "channel-123",
        "x-goog-resource-id": "resource-456",
        "x-goog-resource-uri": "https://www.googleapis.com/calendar/v3/calendars/primary/events",
        "x-goog-message-number": "42",
      });

      const response = await callPOST(request);
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body.status).toBe("ok");
    });

    it("invokes the cancellation handler for exists notifications", async () => {
      const request = createMockRequest({
        "x-goog-channel-token": "valid-token",
        "x-goog-resource-state": "exists",
        "x-goog-channel-id": "channel-123",
        "x-goog-resource-id": "resource-456",
      });

      await callPOST(request);
      expect(MockGoogleHandler).toHaveBeenCalledTimes(1);
      expect(mockHandleNotification).toHaveBeenCalledTimes(1);
    });
  });

  describe("Valid POST on 'not_exists' State", () => {
    it("returns 200 on valid POST with not_exists resource state", async () => {
      const request = createMockRequest({
        "x-goog-channel-token": "valid-token",
        "x-goog-resource-state": "not_exists",
        "x-goog-channel-id": "channel-123",
        "x-goog-resource-id": "resource-456",
      });

      const response = await callPOST(request);
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body.status).toBe("ok");
    });

    it("invokes the cancellation handler for not_exists notifications", async () => {
      const request = createMockRequest({
        "x-goog-channel-token": "valid-token",
        "x-goog-resource-state": "not_exists",
        "x-goog-channel-id": "channel-123",
        "x-goog-resource-id": "resource-456",
      });

      await callPOST(request);
      expect(MockGoogleHandler).toHaveBeenCalledTimes(1);
      expect(mockHandleNotification).toHaveBeenCalledTimes(1);
    });
  });

  describe("Error Handling", () => {
    it("returns 200 even when handler throws an error (prevents Google retries)", async () => {
      mockHandleNotification.mockRejectedValueOnce(new Error("Handler processing failed"));

      const request = createMockRequest({
        "x-goog-channel-token": "valid-token",
        "x-goog-resource-state": "exists",
        "x-goog-channel-id": "channel-123",
        "x-goog-resource-id": "resource-456",
      });

      const response = await callPOST(request);
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body.status).toBe("ok");
    });
  });
});
