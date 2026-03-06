import type { NextRequest } from "next/server";
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockHandleNotification, MockOutlookHandler } = vi.hoisted(() => {
  const mockHandleNotification = vi.fn().mockResolvedValue(undefined);
  const MockOutlookHandler = vi.fn().mockImplementation(function () {
    return { handleNotification: mockHandleNotification };
  });
  return { mockHandleNotification, MockOutlookHandler };
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
vi.mock("@calcom/features/calendars/lib/cancellation-sync/handlers/OutlookCancellationHandler", () => ({
  OutlookCancellationHandler: MockOutlookHandler,
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

import { GET, POST } from "../route";

/** Helpers that provide the required second argument to the wrapped handler. */
const callGET = (request: NextRequest) => GET(request, { params: Promise.resolve({}) });
const callPOST = (request: NextRequest) => POST(request, { params: Promise.resolve({}) });

function createMockGetRequest(queryParams: Record<string, string> = {}): NextRequest {
  const params = new URLSearchParams(queryParams);
  const req = new Request(
    `https://app.cal.com/api/webhooks/microsoft-graph?${params.toString()}`,
    { method: "GET" }
  );
  return req as unknown as NextRequest;
}

function createMockPostRequest(
  body: unknown,
  headers: Record<string, string> = {}
): NextRequest {
  const req = new Request("https://app.cal.com/api/webhooks/microsoft-graph", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
  return req as unknown as NextRequest;
}

describe("Microsoft Graph Webhook Route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.OUTLOOK_WEBHOOK_TOKEN;
  });

  describe("GET /api/webhooks/microsoft-graph (Validation Handshake)", () => {
    it("returns validationToken as plain text with 200 status", async () => {
      const request = createMockGetRequest({ validationToken: "test-validation-token-abc123" });

      const response = await callGET(request);
      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe("text/plain");

      const text = await response.text();
      expect(text).toBe("test-validation-token-abc123");
    });

    it("returns 400 when validationToken query parameter is missing", async () => {
      const request = createMockGetRequest({});

      const response = await callGET(request);
      expect(response.status).toBe(400);

      const body = await response.json();
      expect(body.error).toBe("Missing validationToken query parameter");
    });

    it("handles URL-encoded validation tokens correctly", async () => {
      // URLSearchParams encodes '+' as '+' (literal) and spaces as '+';
      // searchParams.get() decodes '+' to spaces per URL spec.
      // We test that the exact token value from the query string is echoed back.
      const request = createMockGetRequest({
        validationToken: "token-with-special_chars.123",
      });

      const response = await callGET(request);
      expect(response.status).toBe(200);

      const text = await response.text();
      expect(text).toBe("token-with-special_chars.123");
    });
  });

  describe("POST /api/webhooks/microsoft-graph (Change Notifications)", () => {
    describe("Payload Validation", () => {
      it("returns 400 for invalid JSON payload", async () => {
        const req = new Request("https://app.cal.com/api/webhooks/microsoft-graph", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "not-valid-json",
        });

        const response = await callPOST(req as unknown as NextRequest);
        expect(response.status).toBe(400);

        const body = await response.json();
        expect(body.error).toBe("Invalid JSON payload");
      });

      it("returns 400 when value array is missing from payload", async () => {
        const request = createMockPostRequest({});

        const response = await callPOST(request);
        expect(response.status).toBe(400);

        const body = await response.json();
        expect(body.error).toBe("Missing or empty value array in payload");
      });

      it("returns 400 when value is not an array", async () => {
        const request = createMockPostRequest({ value: "not-an-array" });

        const response = await callPOST(request);
        expect(response.status).toBe(400);

        const body = await response.json();
        expect(body.error).toBe("Missing or empty value array in payload");
      });

      it("returns 400 when value array is empty", async () => {
        const request = createMockPostRequest({ value: [] });

        const response = await callPOST(request);
        expect(response.status).toBe(400);

        const body = await response.json();
        expect(body.error).toBe("Missing or empty value array in payload");
      });
    });

    describe("Client State Validation", () => {
      it("returns 401 when clientState does not match configured OUTLOOK_WEBHOOK_TOKEN", async () => {
        process.env.OUTLOOK_WEBHOOK_TOKEN = "correct-client-state";

        const request = createMockPostRequest({
          value: [
            {
              subscriptionId: "sub-123",
              changeType: "updated",
              resource: "me/events/event-123",
              clientState: "wrong-client-state",
            },
          ],
        });

        const response = await callPOST(request);
        expect(response.status).toBe(401);

        const body = await response.json();
        expect(body.error).toBe("Invalid clientState in notification");
      });

      it("allows requests when OUTLOOK_WEBHOOK_TOKEN is not configured (no validation)", async () => {
        const request = createMockPostRequest({
          value: [
            {
              subscriptionId: "sub-123",
              changeType: "updated",
              resource: "me/events/event-123",
              clientState: "any-state",
            },
          ],
        });

        const response = await callPOST(request);
        expect(response.status).toBe(202);
      });

      it("allows notifications without clientState when OUTLOOK_WEBHOOK_TOKEN is configured", async () => {
        process.env.OUTLOOK_WEBHOOK_TOKEN = "secret";

        const request = createMockPostRequest({
          value: [
            {
              subscriptionId: "sub-123",
              changeType: "created",
              resource: "me/events/event-456",
            },
          ],
        });

        const response = await callPOST(request);
        expect(response.status).toBe(202);
      });
    });

    describe("Successful Notification Processing", () => {
      it("returns 202 Accepted on valid change notification", async () => {
        process.env.OUTLOOK_WEBHOOK_TOKEN = "secret";

        const request = createMockPostRequest({
          value: [
            {
              subscriptionId: "sub-123",
              changeType: "deleted",
              resource: "me/events/event-789",
              clientState: "secret",
              tenantId: "tenant-abc",
            },
          ],
        });

        const response = await callPOST(request);
        expect(response.status).toBe(202);

        const body = await response.json();
        expect(body.status).toBe("accepted");
      });

      it("invokes the OutlookCancellationHandler for valid notifications", async () => {
        const notifications = [
          {
            subscriptionId: "sub-1",
            changeType: "updated",
            resource: "me/events/event-1",
          },
          {
            subscriptionId: "sub-2",
            changeType: "deleted",
            resource: "me/events/event-2",
          },
        ];

        const request = createMockPostRequest({ value: notifications });

        await callPOST(request);
        expect(MockOutlookHandler).toHaveBeenCalledTimes(1);
        expect(mockHandleNotification).toHaveBeenCalledTimes(1);
      });

      it("processes multiple notifications in a single payload", async () => {
        const notifications = [
          { subscriptionId: "sub-1", changeType: "created", resource: "me/events/e1" },
          { subscriptionId: "sub-1", changeType: "updated", resource: "me/events/e2" },
          { subscriptionId: "sub-1", changeType: "deleted", resource: "me/events/e3" },
        ];

        const request = createMockPostRequest({ value: notifications });

        const response = await callPOST(request);
        expect(response.status).toBe(202);
        expect(MockOutlookHandler).toHaveBeenCalledTimes(1);
        expect(mockHandleNotification).toHaveBeenCalledTimes(1);
      });
    });

    describe("Error Handling", () => {
      it("returns 202 even when handler throws an error (prevents Graph retries)", async () => {
        mockHandleNotification.mockRejectedValueOnce(new Error("Handler processing failed"));

        const request = createMockPostRequest({
          value: [
            {
              subscriptionId: "sub-123",
              changeType: "deleted",
              resource: "me/events/event-fail",
            },
          ],
        });

        const response = await callPOST(request);
        expect(response.status).toBe(202);

        const body = await response.json();
        expect(body.status).toBe("accepted");
      });
    });
  });
});
