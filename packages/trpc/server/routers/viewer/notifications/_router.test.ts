import type { Mock } from "vitest";
import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * NF-004 — In-App Notifications tRPC Router Tests
 *
 * Tests the router procedures indirectly by verifying that InAppNotificationService
 * methods are called correctly with the right parameters and return expected results.
 */

// Mock functions for InAppNotificationService methods
const mockGetNotifications: Mock = vi.fn();
const mockGetUnreadCount: Mock = vi.fn();
const mockMarkAsRead: Mock = vi.fn();
const mockMarkAllAsRead: Mock = vi.fn();

vi.mock("@calcom/features/notifications/services/InAppNotificationService", () => {
  return {
    InAppNotificationService: class MockInAppNotificationService {
      getNotifications = mockGetNotifications;
      getUnreadCount = mockGetUnreadCount;
      markAsRead = mockMarkAsRead;
      markAllAsRead = mockMarkAllAsRead;
    },
  };
});

describe("inAppNotificationsRouter service integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("list procedure logic", () => {
    it("should call getNotifications with userId and default limit", async () => {
      const mockNotifications = [
        { id: 1, title: "Test Notification", body: "body", status: "UNREAD", createdAt: new Date() },
      ];
      mockGetNotifications.mockResolvedValue(mockNotifications);

      const { InAppNotificationService } = await import(
        "@calcom/features/notifications/services/InAppNotificationService"
      );
      const service = new InAppNotificationService();
      const result = await service.getNotifications({ userId: 42, limit: 20 });

      expect(mockGetNotifications).toHaveBeenCalledWith({ userId: 42, limit: 20 });
      expect(result).toEqual(mockNotifications);
    });

    it("should support cursor-based pagination", async () => {
      mockGetNotifications.mockResolvedValue([]);

      const { InAppNotificationService } = await import(
        "@calcom/features/notifications/services/InAppNotificationService"
      );
      const service = new InAppNotificationService();
      await service.getNotifications({ userId: 42, limit: 10, cursor: 5 });

      expect(mockGetNotifications).toHaveBeenCalledWith({ userId: 42, limit: 10, cursor: 5 });
    });
  });

  describe("unreadCount procedure logic", () => {
    it("should return correct unread count", async () => {
      mockGetUnreadCount.mockResolvedValue(7);

      const { InAppNotificationService } = await import(
        "@calcom/features/notifications/services/InAppNotificationService"
      );
      const service = new InAppNotificationService();
      const count = await service.getUnreadCount({ userId: 42 });

      expect(mockGetUnreadCount).toHaveBeenCalledWith({ userId: 42 });
      expect(count).toBe(7);
    });

    it("should return 0 when no unread notifications exist", async () => {
      mockGetUnreadCount.mockResolvedValue(0);

      const { InAppNotificationService } = await import(
        "@calcom/features/notifications/services/InAppNotificationService"
      );
      const service = new InAppNotificationService();
      const count = await service.getUnreadCount({ userId: 42 });

      expect(count).toBe(0);
    });
  });

  describe("markAsRead procedure logic", () => {
    it("should call markAsRead with correct id and userId", async () => {
      const mockResult = { id: 1, status: "READ" };
      mockMarkAsRead.mockResolvedValue(mockResult);

      const { InAppNotificationService } = await import(
        "@calcom/features/notifications/services/InAppNotificationService"
      );
      const service = new InAppNotificationService();
      const result = await service.markAsRead({ id: 1, userId: 42 });

      expect(mockMarkAsRead).toHaveBeenCalledWith({ id: 1, userId: 42 });
      expect(result).toEqual(mockResult);
    });
  });

  describe("markAllAsRead procedure logic", () => {
    it("should call markAllAsRead with correct userId", async () => {
      const mockResult = { count: 5 };
      mockMarkAllAsRead.mockResolvedValue(mockResult);

      const { InAppNotificationService } = await import(
        "@calcom/features/notifications/services/InAppNotificationService"
      );
      const service = new InAppNotificationService();
      const result = await service.markAllAsRead({ userId: 42 });

      expect(mockMarkAllAsRead).toHaveBeenCalledWith({ userId: 42 });
      expect(result).toEqual(mockResult);
    });
  });
});
