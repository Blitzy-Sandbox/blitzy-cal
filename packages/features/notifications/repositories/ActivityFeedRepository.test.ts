import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PrismaClient } from "@calcom/prisma/client";

import type { ActivityFeedItemCreateInput, ActivityFeedListOptions } from "../types";
import { ActivityFeedRepository } from "./ActivityFeedRepository";

/**
 * Unit tests for ActivityFeedRepository (NF-004).
 *
 * Covers all 6 public methods:
 *   create, findByUser, findRecentActivity, findById, countByUser, deleteOldActivity
 *
 * Tests verify:
 *   - CRUD operations with correct Prisma arguments
 *   - Cursor-based pagination wiring
 *   - Ownership-scoped access (userId in where clauses)
 *   - Edge cases (empty results, zero counts, boundary dates)
 */

const mockActivity = {
  id: 1,
  userId: 10,
  activityType: "BOOKING_CREATED",
  title: "Booking confirmed",
  description: "30-minute meeting with Jane Doe",
  resourceId: "booking-123",
  resourceType: "BOOKING",
  metadata: { attendee: "jane@example.com" },
  createdAt: new Date("2024-01-15T10:00:00Z"),
};

const mockActivity2 = {
  ...mockActivity,
  id: 2,
  activityType: "FORM_SUBMITTED",
  title: "Form submission received",
  description: null,
  resourceId: "form-456",
  resourceType: "ROUTING_FORM",
  createdAt: new Date("2024-01-15T11:00:00Z"),
};

/** Creates a mocked PrismaClient with activityFeedItem model methods */
function createMockPrismaClient() {
  return {
    activityFeedItem: {
      create: vi.fn().mockResolvedValue(mockActivity),
      findMany: vi.fn().mockResolvedValue([mockActivity, mockActivity2]),
      findFirst: vi.fn().mockResolvedValue(mockActivity),
      count: vi.fn().mockResolvedValue(12),
      deleteMany: vi.fn().mockResolvedValue({ count: 5 }),
    },
  } as unknown as PrismaClient;
}

describe("ActivityFeedRepository", () => {
  let mockPrisma: PrismaClient;
  let repo: ActivityFeedRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma = createMockPrismaClient();
    repo = new ActivityFeedRepository(mockPrisma);
  });

  // ---------------------------------------------------------------------------
  // create
  // ---------------------------------------------------------------------------
  describe("create", () => {
    it("should create an activity feed item with all required fields", async () => {
      const input: ActivityFeedItemCreateInput = {
        userId: 10,
        activityType: "BOOKING_CREATED",
        title: "Booking confirmed",
      };

      const result = await repo.create(input);

      expect(result).toEqual(mockActivity);
      expect(mockPrisma.activityFeedItem.create).toHaveBeenCalledWith({
        data: {
          userId: 10,
          activityType: "BOOKING_CREATED",
          title: "Booking confirmed",
          description: null,
          resourceId: null,
          resourceType: null,
          metadata: undefined,
        },
        select: expect.objectContaining({
          id: true,
          userId: true,
          activityType: true,
          title: true,
        }),
      });
    });

    it("should create with all optional fields", async () => {
      const input: ActivityFeedItemCreateInput = {
        userId: 10,
        activityType: "BOOKING_CREATED",
        title: "Booking confirmed",
        description: "30-minute meeting",
        resourceId: "booking-123",
        resourceType: "BOOKING",
        metadata: { attendee: "jane@example.com" },
      };

      await repo.create(input);

      expect(mockPrisma.activityFeedItem.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            description: "30-minute meeting",
            resourceId: "booking-123",
            resourceType: "BOOKING",
            metadata: { attendee: "jane@example.com" },
          }),
        })
      );
    });
  });

  // ---------------------------------------------------------------------------
  // findByUser
  // ---------------------------------------------------------------------------
  describe("findByUser", () => {
    it("should find activity items for a user with default pagination", async () => {
      const options: ActivityFeedListOptions = { userId: 10 };

      const result = await repo.findByUser(options);

      expect(result).toHaveLength(2);
      expect(mockPrisma.activityFeedItem.findMany).toHaveBeenCalledWith({
        where: { userId: 10 },
        select: expect.objectContaining({ id: true }),
        orderBy: { createdAt: "desc" },
        take: 20,
      });
    });

    it("should apply activityType filter when provided", async () => {
      const options: ActivityFeedListOptions = {
        userId: 10,
        activityType: "BOOKING_CREATED" as ActivityFeedListOptions["activityType"],
      };

      await repo.findByUser(options);

      expect(mockPrisma.activityFeedItem.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 10, activityType: "BOOKING_CREATED" },
        })
      );
    });

    it("should apply custom limit", async () => {
      const options: ActivityFeedListOptions = { userId: 10, limit: 50 };

      await repo.findByUser(options);

      expect(mockPrisma.activityFeedItem.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 50 })
      );
    });

    it("should apply cursor-based pagination with skip:1", async () => {
      const options: ActivityFeedListOptions = {
        userId: 10,
        cursor: 42,
      };

      await repo.findByUser(options);

      expect(mockPrisma.activityFeedItem.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 1,
          cursor: { id: 42 },
        })
      );
    });

    it("should return empty array when user has no activity items", async () => {
      (mockPrisma.activityFeedItem.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const result = await repo.findByUser({ userId: 999 });

      expect(result).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // findRecentActivity
  // ---------------------------------------------------------------------------
  describe("findRecentActivity", () => {
    it("should find recent activity with default limit of 10", async () => {
      await repo.findRecentActivity({ userId: 10 });

      expect(mockPrisma.activityFeedItem.findMany).toHaveBeenCalledWith({
        where: { userId: 10 },
        select: expect.objectContaining({ id: true }),
        orderBy: { createdAt: "desc" },
        take: 10,
      });
    });

    it("should apply custom limit", async () => {
      await repo.findRecentActivity({ userId: 10, limit: 5 });

      expect(mockPrisma.activityFeedItem.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 5 })
      );
    });

    it("should return empty array when no recent activity exists", async () => {
      (mockPrisma.activityFeedItem.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const result = await repo.findRecentActivity({ userId: 999 });

      expect(result).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // findById
  // ---------------------------------------------------------------------------
  describe("findById", () => {
    it("should find an activity feed item by id scoped to userId", async () => {
      const result = await repo.findById({ id: 1, userId: 10 });

      expect(result).toEqual(mockActivity);
      expect(mockPrisma.activityFeedItem.findFirst).toHaveBeenCalledWith({
        where: { id: 1, userId: 10 },
        select: expect.objectContaining({ id: true, userId: true }),
      });
    });

    it("should return null when activity item does not exist or belongs to another user", async () => {
      (mockPrisma.activityFeedItem.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const result = await repo.findById({ id: 999, userId: 10 });

      expect(result).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // countByUser
  // ---------------------------------------------------------------------------
  describe("countByUser", () => {
    it("should count all activity items for a user", async () => {
      const result = await repo.countByUser({ userId: 10 });

      expect(result).toBe(12);
      expect(mockPrisma.activityFeedItem.count).toHaveBeenCalledWith({
        where: { userId: 10 },
      });
    });

    it("should count items filtered by activityType", async () => {
      await repo.countByUser({
        userId: 10,
        activityType: "BOOKING_CREATED" as import("../types").ActivityType,
      });

      expect(mockPrisma.activityFeedItem.count).toHaveBeenCalledWith({
        where: { userId: 10, activityType: "BOOKING_CREATED" },
      });
    });

    it("should return 0 when user has no activity items", async () => {
      (mockPrisma.activityFeedItem.count as ReturnType<typeof vi.fn>).mockResolvedValue(0);

      const result = await repo.countByUser({ userId: 999 });

      expect(result).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // deleteOldActivity
  // ---------------------------------------------------------------------------
  describe("deleteOldActivity", () => {
    it("should delete activity items older than specified date", async () => {
      const olderThan = new Date("2024-01-01T00:00:00Z");

      const result = await repo.deleteOldActivity({ userId: 10, olderThan });

      expect(result).toEqual({ count: 5 });
      expect(mockPrisma.activityFeedItem.deleteMany).toHaveBeenCalledWith({
        where: {
          userId: 10,
          createdAt: { lt: olderThan },
        },
      });
    });

    it("should return count: 0 when no old items exist", async () => {
      (mockPrisma.activityFeedItem.deleteMany as ReturnType<typeof vi.fn>).mockResolvedValue({
        count: 0,
      });

      const olderThan = new Date("2020-01-01T00:00:00Z");
      const result = await repo.deleteOldActivity({ userId: 10, olderThan });

      expect(result).toEqual({ count: 0 });
    });

    it("should only delete items for the specified user", async () => {
      const olderThan = new Date("2024-06-01T00:00:00Z");

      await repo.deleteOldActivity({ userId: 42, olderThan });

      expect(mockPrisma.activityFeedItem.deleteMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ userId: 42 }),
        })
      );
    });
  });
});
