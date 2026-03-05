import { beforeEach, describe, expect, test, vi, afterEach } from "vitest";

import dayjs from "@calcom/dayjs";
import type { SelectedCalendar } from "@calcom/prisma/client";
import type { CredentialForCalendarServiceWithEmail } from "@calcom/types/Credential";

import { Office365CalendarSubscriptionAdapter } from "../Office365CalendarSubscription.adapter";

const today = dayjs().startOf("day");
const oneWeekFromNow = today.add(7, "days");
const eventEndTime = oneWeekFromNow.add(1, "hours");

const mockSelectedCalendar: SelectedCalendar = {
  id: "test-calendar-id",
  userId: 1,
  credentialId: 1,
  integration: "office365_calendar",
  externalId: "test@example.com",
  eventTypeId: null,
  delegationCredentialId: null,
  domainWideDelegationCredentialId: null,
  googleChannelId: null,
  googleChannelKind: null,
  googleChannelResourceId: null,
  googleChannelResourceUri: null,
  googleChannelExpiration: null,
  error: null,
  lastErrorAt: null,
  watchAttempts: 0,
  maxAttempts: 3,
  unwatchAttempts: 0,
  createdAt: today.toDate(),
  updatedAt: today.toDate(),
  channelId: "test-channel-id",
  channelKind: "web_hook",
  channelResourceId: "test-resource-id",
  channelResourceUri: "test-resource-uri",
  channelExpiration: new Date(Date.now() + 86400000),
  syncSubscribedAt: today.toDate(),
  syncSubscribedErrorAt: null,
  syncSubscribedErrorCount: 0,
  syncToken: "test-sync-token",
  syncedAt: today.toDate(),
  syncErrorAt: null,
  syncErrorCount: 0,
};

const mockCredential = {
  id: 1,
  key: "test-access-token",
  user: { email: "test@example.com" },
  delegatedTo: null,
  type: null,
  teamId: null,
} as unknown as CredentialForCalendarServiceWithEmail;

describe("Office365CalendarSubscriptionAdapter", () => {
  let adapter: Office365CalendarSubscriptionAdapter;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    adapter = new Office365CalendarSubscriptionAdapter({
      baseUrl: "https://graph.microsoft.com/v1.0",
      webhookToken: "test-webhook-token",
      webhookUrl: "https://example.com/api/webhooks/calendar-subscription/office365_calendar",
      subscriptionTtlMs: 3 * 24 * 60 * 60 * 1000,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("subscribe", () => {
    test("should create a Graph subscription with correct parameters", async () => {
      const mockResponse = {
        id: "sub-id-123",
        resource: `me/calendars/${mockSelectedCalendar.externalId}/events`,
        expirationDateTime: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
      };

      fetchSpy.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockResponse,
      });

      const result = await adapter.subscribe(mockSelectedCalendar, mockCredential);

      expect(fetchSpy).toHaveBeenCalledWith(
        "https://graph.microsoft.com/v1.0/subscriptions",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Authorization: "Bearer test-access-token",
            "Content-Type": "application/json",
          }),
        })
      );

      // Verify the body contains the correct subscription parameters
      const callArgs = fetchSpy.mock.calls[0];
      const requestBody = JSON.parse(callArgs[1].body);
      expect(requestBody.resource).toBe(`me/calendars/${mockSelectedCalendar.externalId}/events`);
      expect(requestBody.changeType).toBe("created,updated,deleted");
      expect(requestBody.notificationUrl).toBe(
        "https://example.com/api/webhooks/calendar-subscription/office365_calendar"
      );
      expect(requestBody.clientState).toBe("test-webhook-token");

      expect(result).toEqual({
        provider: "office365_calendar",
        id: "sub-id-123",
        resourceId: mockResponse.resource,
        resourceUri: `https://graph.microsoft.com/v1.0/${mockResponse.resource}`,
        expiration: new Date(mockResponse.expirationDateTime),
      });
    });

    test("should throw error when webhook config is missing", async () => {
      const adapterNoWebhook = new Office365CalendarSubscriptionAdapter({
        webhookUrl: null,
        webhookToken: null,
      });

      await expect(adapterNoWebhook.subscribe(mockSelectedCalendar, mockCredential)).rejects.toThrow(
        "Webhook config missing"
      );
    });
  });

  describe("subscribeCancellationSync", () => {
    test("should create a Graph subscription with cancellation-sync webhook URL", async () => {
      const mockResponse = {
        id: "cancel-sub-id-456",
        resource: `me/calendars/${mockSelectedCalendar.externalId}/events`,
        expirationDateTime: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
      };

      fetchSpy.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockResponse,
      });

      await adapter.subscribeCancellationSync(mockSelectedCalendar, mockCredential);

      const callArgs = fetchSpy.mock.calls[0];
      const requestBody = JSON.parse(callArgs[1].body);

      // Verify the cancellation-sync URL appends "/cancellation-sync"
      expect(requestBody.notificationUrl).toBe(
        "https://example.com/api/webhooks/calendar-subscription/office365_calendar/cancellation-sync"
      );
    });

    test("should use 'updated,deleted' changeType for cancellation-sync subscriptions", async () => {
      const mockResponse = {
        id: "cancel-sub-id-456",
        resource: `me/calendars/${mockSelectedCalendar.externalId}/events`,
        expirationDateTime: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
      };

      fetchSpy.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockResponse,
      });

      await adapter.subscribeCancellationSync(mockSelectedCalendar, mockCredential);

      const callArgs = fetchSpy.mock.calls[0];
      const requestBody = JSON.parse(callArgs[1].body);

      // Cancellation sync should only listen for "updated" (declined) and "deleted" (removed),
      // NOT "created" — unlike the regular subscribe which uses "created,updated,deleted"
      expect(requestBody.changeType).toBe("updated,deleted");
    });

    test("should return CalendarSubscriptionResult with correct provider and fields", async () => {
      const expirationDate = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
      const mockResponse = {
        id: "cancel-sub-id-789",
        resource: `me/calendars/${mockSelectedCalendar.externalId}/events`,
        expirationDateTime: expirationDate.toISOString(),
      };

      fetchSpy.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockResponse,
      });

      const result = await adapter.subscribeCancellationSync(mockSelectedCalendar, mockCredential);

      expect(result).toEqual({
        provider: "office365_calendar",
        id: "cancel-sub-id-789",
        resourceId: mockResponse.resource,
        resourceUri: `https://graph.microsoft.com/v1.0/${mockResponse.resource}`,
        expiration: new Date(expirationDate.toISOString()),
      });
    });

    test("should include clientState for webhook validation", async () => {
      const mockResponse = {
        id: "cancel-sub-id-456",
        resource: `me/calendars/${mockSelectedCalendar.externalId}/events`,
        expirationDateTime: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
      };

      fetchSpy.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockResponse,
      });

      await adapter.subscribeCancellationSync(mockSelectedCalendar, mockCredential);

      const callArgs = fetchSpy.mock.calls[0];
      const requestBody = JSON.parse(callArgs[1].body);
      expect(requestBody.clientState).toBe("test-webhook-token");
    });

    test("should throw error when webhook URL is missing for cancellation sync", async () => {
      const adapterNoWebhook = new Office365CalendarSubscriptionAdapter({
        webhookUrl: null,
        webhookToken: "test-token",
      });

      await expect(
        adapterNoWebhook.subscribeCancellationSync(mockSelectedCalendar, mockCredential)
      ).rejects.toThrow("Webhook config missing for cancellation sync");
    });

    test("should throw error when webhook token is missing for cancellation sync", async () => {
      const adapterNoToken = new Office365CalendarSubscriptionAdapter({
        webhookUrl: "https://example.com",
        webhookToken: null,
      });

      await expect(
        adapterNoToken.subscribeCancellationSync(mockSelectedCalendar, mockCredential)
      ).rejects.toThrow("Webhook config missing for cancellation sync");
    });
  });

  describe("getCancelledEventIds", () => {
    test("should return IDs of cancelled events", () => {
      const events = [
        {
          id: "event-1",
          iCalUID: "event-1@cal.com",
          start: oneWeekFromNow.toDate(),
          end: eventEndTime.toDate(),
          busy: true,
          summary: "Cancelled Meeting",
          description: null,
          location: null,
          kind: "microsoftgraph#event",
          etag: null,
          status: "cancelled",
          isAllDay: false,
          timeZone: "UTC",
          recurringEventId: null,
          originalStartDate: null,
          createdAt: null,
          updatedAt: null,
        },
        {
          id: "event-2",
          iCalUID: "event-2@cal.com",
          start: oneWeekFromNow.toDate(),
          end: eventEndTime.toDate(),
          busy: true,
          summary: "Another Cancelled",
          description: null,
          location: null,
          kind: "microsoftgraph#event",
          etag: null,
          status: "cancelled",
          isAllDay: false,
          timeZone: "UTC",
          recurringEventId: null,
          originalStartDate: null,
          createdAt: null,
          updatedAt: null,
        },
      ];

      const result = adapter.getCancelledEventIds(events);

      expect(result).toEqual(["event-1", "event-2"]);
    });

    test("should return empty array when no events are cancelled", () => {
      const events = [
        {
          id: "event-1",
          iCalUID: "event-1@cal.com",
          start: oneWeekFromNow.toDate(),
          end: eventEndTime.toDate(),
          busy: true,
          summary: "Active Event",
          description: null,
          location: null,
          kind: "microsoftgraph#event",
          etag: null,
          status: "confirmed",
          isAllDay: false,
          timeZone: "UTC",
          recurringEventId: null,
          originalStartDate: null,
          createdAt: null,
          updatedAt: null,
        },
      ];

      const result = adapter.getCancelledEventIds(events);

      expect(result).toEqual([]);
    });

    test("should exclude events with confirmed status", () => {
      const events = [
        {
          id: "event-cancelled",
          iCalUID: "event-cancelled@cal.com",
          start: oneWeekFromNow.toDate(),
          end: eventEndTime.toDate(),
          busy: true,
          summary: "Cancelled Event",
          description: null,
          location: null,
          kind: "microsoftgraph#event",
          etag: null,
          status: "cancelled",
          isAllDay: false,
          timeZone: "UTC",
          recurringEventId: null,
          originalStartDate: null,
          createdAt: null,
          updatedAt: null,
        },
        {
          id: "event-confirmed",
          iCalUID: "event-confirmed@cal.com",
          start: oneWeekFromNow.toDate(),
          end: eventEndTime.toDate(),
          busy: true,
          summary: "Confirmed Event",
          description: null,
          location: null,
          kind: "microsoftgraph#event",
          etag: null,
          status: "confirmed",
          isAllDay: false,
          timeZone: "UTC",
          recurringEventId: null,
          originalStartDate: null,
          createdAt: null,
          updatedAt: null,
        },
      ];

      const result = adapter.getCancelledEventIds(events);

      expect(result).toEqual(["event-cancelled"]);
    });
  });

  describe("fetchEvents", () => {
    test("should fetch events using delta query for initial sync", async () => {
      const calendarWithNoToken: SelectedCalendar = {
        ...mockSelectedCalendar,
        syncToken: null,
      };

      const mockDeltaResponse = {
        "@odata.deltaLink":
          "https://graph.microsoft.com/v1.0/me/calendars/test@example.com/events/delta?$deltatoken=new-token",
        value: [
          {
            id: "event-1",
            iCalUId: "event-1@outlook.com",
            subject: "Team Meeting",
            bodyPreview: "Discuss project",
            location: { displayName: "Room A" },
            showAs: "busy",
            isAllDay: false,
            isCancelled: false,
            type: "singleInstance",
            start: { dateTime: oneWeekFromNow.toISOString(), timeZone: "UTC" },
            end: { dateTime: eventEndTime.toISOString(), timeZone: "UTC" },
          },
        ],
      };

      fetchSpy.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockDeltaResponse,
      });

      const result = await adapter.fetchEvents(calendarWithNoToken, mockCredential);

      expect(result.provider).toBe("office365_calendar");
      expect(result.syncToken).toBe(mockDeltaResponse["@odata.deltaLink"]);
      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe("event-1");
      expect(result.items[0].iCalUID).toBe("event-1@outlook.com");
      expect(result.items[0].summary).toBe("Team Meeting");
      expect(result.items[0].status).toBe("confirmed");
      expect(result.items[0].busy).toBe(true);
    });

    test("should include cancelled events in fetch results", async () => {
      const calendarWithNoToken: SelectedCalendar = {
        ...mockSelectedCalendar,
        syncToken: null,
      };

      const mockDeltaResponse = {
        "@odata.deltaLink": "https://graph.microsoft.com/v1.0/delta?$deltatoken=new",
        value: [
          {
            id: "event-cancelled",
            iCalUId: "event-cancelled@outlook.com",
            subject: "Cancelled Meeting",
            bodyPreview: "Was cancelled",
            location: { displayName: "Room A" },
            showAs: "free",
            isAllDay: false,
            isCancelled: true,
            type: "singleInstance",
            start: { dateTime: oneWeekFromNow.toISOString(), timeZone: "UTC" },
            end: { dateTime: eventEndTime.toISOString(), timeZone: "UTC" },
          },
        ],
      };

      fetchSpy.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockDeltaResponse,
      });

      const result = await adapter.fetchEvents(calendarWithNoToken, mockCredential);

      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe("event-cancelled");
      expect(result.items[0].status).toBe("cancelled");
    });

    test("should correctly set status for confirmed vs cancelled events", async () => {
      const calendarWithNoToken: SelectedCalendar = {
        ...mockSelectedCalendar,
        syncToken: null,
      };

      const mockDeltaResponse = {
        "@odata.deltaLink": "https://graph.microsoft.com/v1.0/delta?$deltatoken=new",
        value: [
          {
            id: "event-confirmed",
            iCalUId: "confirmed@outlook.com",
            subject: "Active Meeting",
            showAs: "busy",
            isAllDay: false,
            isCancelled: false,
            start: { dateTime: oneWeekFromNow.toISOString(), timeZone: "UTC" },
            end: { dateTime: eventEndTime.toISOString(), timeZone: "UTC" },
          },
          {
            id: "event-cancelled",
            iCalUId: "cancelled@outlook.com",
            subject: "Declined Meeting",
            showAs: "free",
            isAllDay: false,
            isCancelled: true,
            start: { dateTime: oneWeekFromNow.toISOString(), timeZone: "UTC" },
            end: { dateTime: eventEndTime.toISOString(), timeZone: "UTC" },
          },
        ],
      };

      fetchSpy.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockDeltaResponse,
      });

      const result = await adapter.fetchEvents(calendarWithNoToken, mockCredential);

      expect(result.items).toHaveLength(2);
      const confirmed = result.items.find((i) => i.id === "event-confirmed");
      const cancelled = result.items.find((i) => i.id === "event-cancelled");
      expect(confirmed?.status).toBe("confirmed");
      expect(cancelled?.status).toBe("cancelled");
    });

    test("should use existing sync token for delta queries", async () => {
      const mockDeltaResponse = {
        "@odata.deltaLink": "https://graph.microsoft.com/v1.0/delta?$deltatoken=updated-token",
        value: [
          {
            id: "event-updated",
            iCalUId: "updated@outlook.com",
            subject: "Updated Meeting",
            showAs: "tentative",
            isAllDay: false,
            isCancelled: false,
            start: { dateTime: oneWeekFromNow.toISOString(), timeZone: "UTC" },
            end: { dateTime: eventEndTime.toISOString(), timeZone: "UTC" },
          },
        ],
      };

      fetchSpy.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockDeltaResponse,
      });

      const result = await adapter.fetchEvents(mockSelectedCalendar, mockCredential);

      // Should use the existing sync token as the delta link
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining("test-sync-token"),
        expect.any(Object)
      );
      expect(result.syncToken).toBe(mockDeltaResponse["@odata.deltaLink"]);
    });
  });

  describe("unsubscribe", () => {
    test("should delete the subscription via Graph API", async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        status: 204,
      });

      await adapter.unsubscribe(mockSelectedCalendar, mockCredential);

      expect(fetchSpy).toHaveBeenCalledWith(
        "https://graph.microsoft.com/v1.0/subscriptions/test-resource-id",
        expect.objectContaining({
          method: "DELETE",
          headers: expect.objectContaining({
            Authorization: "Bearer test-access-token",
          }),
        })
      );
    });

    test("should skip unsubscribe when channelResourceId is missing", async () => {
      const calendarNoResourceId: SelectedCalendar = {
        ...mockSelectedCalendar,
        channelResourceId: null,
      };

      await adapter.unsubscribe(calendarNoResourceId, mockCredential);

      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe("validate", () => {
    test("should return true for validation token handshake requests", async () => {
      const mockRequest = new Request(
        "https://example.com/webhook?validationToken=test-validation-token"
      );

      const result = await adapter.validate(mockRequest);

      expect(result).toBe(true);
    });

    test("should return true when clientState matches webhook token", async () => {
      const mockRequest = new Request("https://example.com/webhook", {
        method: "POST",
        headers: {
          clientState: "test-webhook-token",
        },
      });

      const result = await adapter.validate(mockRequest);

      expect(result).toBe(true);
    });

    test("should return false when clientState does not match webhook token", async () => {
      const mockRequest = new Request("https://example.com/webhook", {
        method: "POST",
        headers: {
          clientState: "wrong-token",
        },
      });

      const result = await adapter.validate(mockRequest);

      expect(result).toBe(false);
    });
  });

  describe("extractChannelId", () => {
    test("should extract subscriptionId from request body", async () => {
      const mockRequest = {
        body: { subscriptionId: "sub-123" },
        url: "https://example.com/webhook",
        headers: { get: () => null },
      } as unknown as Request;

      const result = await adapter.extractChannelId(mockRequest);

      expect(result).toBe("sub-123");
    });

    test("should return null when subscriptionId is missing", async () => {
      const mockRequest = {
        body: {},
        url: "https://example.com/webhook",
        headers: { get: () => null },
      } as unknown as Request;

      const result = await adapter.extractChannelId(mockRequest);

      expect(result).toBeNull();
    });
  });
});
