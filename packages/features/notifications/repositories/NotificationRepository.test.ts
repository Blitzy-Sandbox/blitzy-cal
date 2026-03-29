import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PrismaClient } from "@calcom/prisma/client";

import type { InAppNotificationCreateInput, InAppNotificationListOptions } from "../types";
import { InAppNotificationRepository } from "./InAppNotificationRepository";

/**
 * Unit tests for InAppNotificationRepository (NF-004).
 *
 * Covers all 8 public methods:
 *   create, findById, findByUser, markAsRead, markAsDismissed,
 *   countUnread, markAllAsRead, deleteOldNotifications
 *
 * Tests verify:
 *   - CRUD operations with correct Prisma arguments
 *   - Cursor-based pagination wiring
 *   - Error paths (P2025 record-not-found)
 *   - Ownership-scoped updates (userId in where clauses)
 *   - Edge cases (empty results, zero counts, boundary dates)
 */

const mockNotification = {
  id: 1,
  userId: 10,
  title: "New booking",
  body: "You have a new booking request",
  type: "BOOKING_CREATED",
  status: "UNREAD",
  url: "/bookings/123",
  icon: "calendar",
  metadata: { bookingId: 123 },
  createdAt: new Date("2024-01-15T10:00:00Z"),
  readAt: null,
  dismissedAt: null,
};

const mockReadNotification = {
  ...mockNotification,
  status: "READ",
  readAt: new Date("2024-01-15T12:00:00Z"),
};

const mockDismissedNotification = {
  ...mockNotification,
  status: "DISMISSED",
  dismissedAt: new Date("2024-01-15T14:00:00Z"),
};

/** Creates a mocked PrismaClient with inAppNotification model methods */
function createMockPrismaClient() {
  return {
    inAppNotification: {
      create: vi.fn().mockResolvedValue(mockNotification),
      findUnique: vi.fn().mockResolvedValue(mockNotification),
      findMany: vi.fn().mockResolvedValue([mockNotification]),
      update: vi.fn().mockResolvedValue(mockReadNotification),
      updateMany: vi.fn().mockResolvedValue({ count: 3 }),
      count: vi.fn().mockResolvedValue(5),
      deleteMany: vi.fn().mockResolvedValue({ count: 2 }),
    },
  } as unknown as PrismaClient;
}

describe("InAppNotificationRepository", () => {
  let mockPrisma: PrismaClient;
  let repo: InAppNotificationRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma = createMockPrismaClient();
    repo = new InAppNotificationRepository(mockPrisma);
  });

  // ---------------------------------------------------------------------------
  // create
  // ---------------------------------------------------------------------------
  describe("create", () => {
    it("should create a notification with all required fields", async () => {
      const input: InAppNotificationCreateInput = {
        userId: 10,
        title: "New booking",
        body: "You have a new booking request",
        type: "BOOKING_CREATED",
      };

      const result = await repo.create(input);

      expect(result).toEqual(mockNotification);
      expect(mockPrisma.inAppNotification.create).toHaveBeenCalledWith({
        data: {
          userId: 10,
          title: "New booking",
          body: "You have a new booking request",
          type: "BOOKING_CREATED",
          status: "UNREAD",
          url: null,
          icon: null,
          metadata: undefined,
        },
        select: expect.objectContaining({
          id: true,
          userId: true,
          title: true,
          status: true,
        }),
      });
    });

    it("should create a notification with optional fields", async () => {
      const input: InAppNotificationCreateInput = {
        userId: 10,
        title: "Meeting link",
        body: "Join your meeting",
        type: "MEETING_STARTED",
        url: "/video/abc",
        icon: "video",
        metadata: { meetingId: 456 },
      };

      await repo.create(input);

      expect(mockPrisma.inAppNotification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            url: "/video/abc",
            icon: "video",
            metadata: { meetingId: 456 },
          }),
        })
      );
    });

    it("should always set initial status to UNREAD", async () => {
      const input: InAppNotificationCreateInput = {
        userId: 10,
        title: "Test",
        body: "Test body",
        type: "SYSTEM",
      };

      await repo.create(input);

      expect(mockPrisma.inAppNotification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: "UNREAD" }),
        })
      );
    });
  });

  // ---------------------------------------------------------------------------
  // findById
  // ---------------------------------------------------------------------------
  describe("findById", () => {
    it("should find a notification by id", async () => {
      const result = await repo.findById({ id: 1 });

      expect(result).toEqual(mockNotification);
      expect(mockPrisma.inAppNotification.findUnique).toHaveBeenCalledWith({
        where: { id: 1 },
        select: expect.objectContaining({ id: true, userId: true }),
      });
    });

    it("should return null when notification does not exist", async () => {
      (mockPrisma.inAppNotification.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const result = await repo.findById({ id: 999 });

      expect(result).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // findByUser
  // ---------------------------------------------------------------------------
  describe("findByUser", () => {
    it("should find notifications for a user with default pagination", async () => {
      const options: InAppNotificationListOptions = { userId: 10 };

      const result = await repo.findByUser(options);

      expect(result).toEqual([mockNotification]);
      expect(mockPrisma.inAppNotification.findMany).toHaveBeenCalledWith({
        where: { userId: 10 },
        select: expect.objectContaining({ id: true }),
        orderBy: { createdAt: "desc" },
        take: 20,
      });
    });

    it("should apply status filter when provided", async () => {
      const options: InAppNotificationListOptions = {
        userId: 10,
        status: "UNREAD",
      };

      await repo.findByUser(options);

      expect(mockPrisma.inAppNotification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 10, status: "UNREAD" },
        })
      );
    });

    it("should apply type filter when provided", async () => {
      const options: InAppNotificationListOptions = {
        userId: 10,
        type: "BOOKING_CREATED",
      };

      await repo.findByUser(options);

      expect(mockPrisma.inAppNotification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 10, type: "BOOKING_CREATED" },
        })
      );
    });

    it("should apply custom limit", async () => {
      const options: InAppNotificationListOptions = { userId: 10, limit: 50 };

      await repo.findByUser(options);

      expect(mockPrisma.inAppNotification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 50 })
      );
    });

    it("should apply cursor-based pagination with skip:1", async () => {
      const options: InAppNotificationListOptions = {
        userId: 10,
        cursor: 42,
      };

      await repo.findByUser(options);

      expect(mockPrisma.inAppNotification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 1,
          cursor: { id: 42 },
        })
      );
    });

    it("should return empty array when user has no notifications", async () => {
      (mockPrisma.inAppNotification.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const result = await repo.findByUser({ userId: 999 });

      expect(result).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // markAsRead
  // ---------------------------------------------------------------------------
  describe("markAsRead", () => {
    it("should mark a notification as read with userId ownership check", async () => {
      const result = await repo.markAsRead({ id: 1, userId: 10 });

      expect(result).toEqual(mockReadNotification);
      expect(mockPrisma.inAppNotification.update).toHaveBeenCalledWith({
        where: { id: 1, userId: 10 },
        data: {
          status: "READ",
          readAt: expect.any(Date),
        },
        select: expect.objectContaining({ id: true }),
      });
    });

    it("should return null when notification does not exist (P2025)", async () => {
      const prismaError = new Error("Record not found");
      (prismaError as Record<string, unknown>).code = "P2025";
      (mockPrisma.inAppNotification.update as ReturnType<typeof vi.fn>).mockRejectedValue(prismaError);

      const result = await repo.markAsRead({ id: 999, userId: 10 });

      expect(result).toBeNull();
    });

    it("should return null when userId does not match (ownership failure)", async () => {
      (mockPrisma.inAppNotification.update as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("Record not found")
      );

      const result = await repo.markAsRead({ id: 1, userId: 999 });

      expect(result).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // markAsDismissed
  // ---------------------------------------------------------------------------
  describe("markAsDismissed", () => {
    it("should mark a notification as dismissed with userId ownership check", async () => {
      (mockPrisma.inAppNotification.update as ReturnType<typeof vi.fn>).mockResolvedValue(
        mockDismissedNotification
      );

      const result = await repo.markAsDismissed({ id: 1, userId: 10 });

      expect(result).toEqual(mockDismissedNotification);
      expect(mockPrisma.inAppNotification.update).toHaveBeenCalledWith({
        where: { id: 1, userId: 10 },
        data: {
          status: "DISMISSED",
          dismissedAt: expect.any(Date),
        },
        select: expect.objectContaining({ id: true }),
      });
    });

    it("should return null when notification does not exist", async () => {
      (mockPrisma.inAppNotification.update as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("Record not found")
      );

      const result = await repo.markAsDismissed({ id: 999, userId: 10 });

      expect(result).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // countUnread
  // ---------------------------------------------------------------------------
  describe("countUnread", () => {
    it("should count unread notifications for user", async () => {
      const result = await repo.countUnread({ userId: 10 });

      expect(result).toBe(5);
      expect(mockPrisma.inAppNotification.count).toHaveBeenCalledWith({
        where: {
          userId: 10,
          status: "UNREAD",
        },
      });
    });

    it("should return 0 when user has no unread notifications", async () => {
      (mockPrisma.inAppNotification.count as ReturnType<typeof vi.fn>).mockResolvedValue(0);

      const result = await repo.countUnread({ userId: 999 });

      expect(result).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // markAllAsRead
  // ---------------------------------------------------------------------------
  describe("markAllAsRead", () => {
    it("should bulk-update all UNREAD notifications to READ", async () => {
      const result = await repo.markAllAsRead({ userId: 10 });

      expect(result).toEqual({ count: 3 });
      expect(mockPrisma.inAppNotification.updateMany).toHaveBeenCalledWith({
        where: {
          userId: 10,
          status: "UNREAD",
        },
        data: {
          status: "READ",
          readAt: expect.any(Date),
        },
      });
    });

    it("should return count: 0 when no unread notifications exist", async () => {
      (mockPrisma.inAppNotification.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({
        count: 0,
      });

      const result = await repo.markAllAsRead({ userId: 999 });

      expect(result).toEqual({ count: 0 });
    });
  });

  // ---------------------------------------------------------------------------
  // deleteOldNotifications
  // ---------------------------------------------------------------------------
  describe("deleteOldNotifications", () => {
    it("should delete notifications older than specified date", async () => {
      const olderThan = new Date("2024-01-01T00:00:00Z");

      const result = await repo.deleteOldNotifications({ userId: 10, olderThan });

      expect(result).toEqual({ count: 2 });
      expect(mockPrisma.inAppNotification.deleteMany).toHaveBeenCalledWith({
        where: {
          userId: 10,
          createdAt: { lt: olderThan },
        },
      });
    });

    it("should return count: 0 when no old notifications exist", async () => {
      (mockPrisma.inAppNotification.deleteMany as ReturnType<typeof vi.fn>).mockResolvedValue({
        count: 0,
      });

      const olderThan = new Date("2020-01-01T00:00:00Z");
      const result = await repo.deleteOldNotifications({ userId: 10, olderThan });

      expect(result).toEqual({ count: 0 });
    });

    it("should only delete notifications for the specified user", async () => {
      const olderThan = new Date("2024-06-01T00:00:00Z");

      await repo.deleteOldNotifications({ userId: 42, olderThan });

      expect(mockPrisma.inAppNotification.deleteMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ userId: 42 }),
        })
      );
    });
  });
});
