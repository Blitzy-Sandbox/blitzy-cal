/**
 * ScheduleRepository Regression Suite
 *
 * Vitest tests for {@link ScheduleRepository}, the Prisma-backed data-access
 * layer for the Schedule, Availability, and User default-schedule lifecycle.
 *
 * Covers: constructor guard, getDefaultScheduleId, hasDefaultSchedule,
 * setupDefaultSchedule, findDetailedScheduleById, findScheduleByIdForBuildDateRanges,
 * findScheduleByIdForOwnershipCheck, findScheduleById, and findManyDetailedScheduleByUserId.
 */
import prismaMock from "@calcom/testing/lib/__mocks__/prismaMock";

import { describe, expect, it, vi, beforeEach } from "vitest";

import type { Schedule, User } from "@calcom/prisma/client";

import { ScheduleRepository } from "./ScheduleRepository";

vi.mock("@calcom/lib/hasEditPermissionForUser", () => ({
  hasReadPermissionsForUserId: vi.fn(),
}));

import { hasReadPermissionsForUserId } from "@calcom/lib/hasEditPermissionForUser";

const mockHasReadPermissions = vi.mocked(hasReadPermissionsForUserId);

describe("ScheduleRepository", () => {
  let scheduleRepository: ScheduleRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    scheduleRepository = new ScheduleRepository(prismaMock);
  });

  /** Validates that the constructor enforces PrismaClient injection. */
  describe("constructor", () => {
    it("should throw error if prismaClient is not provided", () => {
      // @ts-expect-error - testing invalid input
      expect(() => new ScheduleRepository(null)).toThrow("PrismaClient is required for ScheduleRepository");
      // @ts-expect-error - testing invalid input
      expect(() => new ScheduleRepository(undefined)).toThrow(
        "PrismaClient is required for ScheduleRepository"
      );
    });

    it("should create instance successfully with valid prismaClient", () => {
      const repo = new ScheduleRepository(prismaMock);
      expect(repo).toBeInstanceOf(ScheduleRepository);
    });
  });

  /** Validates default schedule ID resolution: user field → fallback findFirst → error. */
  describe("getDefaultScheduleId", () => {
    it("should return defaultScheduleId if user has one", async () => {
      const userId = 1;
      const defaultScheduleId = 123;

      prismaMock.user.findUnique.mockResolvedValue({ defaultScheduleId } as User);

      const result = await scheduleRepository.getDefaultScheduleId(userId);

      expect(prismaMock.user.findUnique).toHaveBeenCalledWith({
        where: { id: userId },
        select: { defaultScheduleId: true },
      });
      expect(result).toBe(defaultScheduleId);
    });

    it("should find and return first schedule if user has no defaultScheduleId", async () => {
      const userId = 1;
      const scheduleId = 456;

      prismaMock.user.findUnique.mockResolvedValue({ defaultScheduleId: null } as User);
      prismaMock.schedule.findFirst.mockResolvedValue({ id: scheduleId } as Schedule);

      const result = await scheduleRepository.getDefaultScheduleId(userId);

      expect(prismaMock.schedule.findFirst).toHaveBeenCalledWith({
        where: { userId },
        select: { id: true },
      });
      expect(result).toBe(scheduleId);
    });

    it("should throw error if no schedules found", async () => {
      const userId = 1;

      prismaMock.user.findUnique.mockResolvedValue({ defaultScheduleId: null } as User);
      prismaMock.schedule.findFirst.mockResolvedValue(null);

      await expect(scheduleRepository.getDefaultScheduleId(userId)).rejects.toThrow(
        "No schedules found for user"
      );
    });
  });

  /** Validates boolean check for whether a user has any schedule configured. */
  describe("hasDefaultSchedule", () => {
    it("should return true if user has defaultScheduleId", async () => {
      const user = { id: 1, defaultScheduleId: 123 };

      const result = await scheduleRepository.hasDefaultSchedule(user);

      expect(result).toBe(true);
    });

    it("should return true if user has a schedule", async () => {
      const user = { id: 1, defaultScheduleId: null };

      prismaMock.schedule.findFirst.mockResolvedValue({ id: 456 } as Schedule);

      const result = await scheduleRepository.hasDefaultSchedule(user);

      expect(prismaMock.schedule.findFirst).toHaveBeenCalledWith({
        where: { userId: user.id },
      });
      expect(result).toBe(true);
    });

    it("should return false if user has no defaultScheduleId and no schedules", async () => {
      const user = { id: 1, defaultScheduleId: null };

      prismaMock.schedule.findFirst.mockResolvedValue(null);

      const result = await scheduleRepository.hasDefaultSchedule(user);

      expect(result).toBe(false);
    });
  });

  /** Validates that the user record is updated with a new defaultScheduleId. */
  describe("setupDefaultSchedule", () => {
    it("should update user with new defaultScheduleId", async () => {
      const userId = 1;
      const scheduleId = 123;
      const updatedUser = { id: userId, defaultScheduleId: scheduleId } as User;

      prismaMock.user.update.mockResolvedValue(updatedUser);

      const result = await scheduleRepository.setupDefaultSchedule(userId, scheduleId);

      expect(prismaMock.user.update).toHaveBeenCalledWith({
        where: { id: userId },
        data: { defaultScheduleId: scheduleId },
      });
      expect(result).toEqual(updatedUser);
    });
  });

  /** Validates detailed schedule retrieval with permission checks, Atom transforms, and metadata flags. */
  describe("findDetailedScheduleById", () => {
    const createMockSchedule = (overrides: Partial<Schedule> = {}): Partial<Schedule> => ({
      id: 100,
      userId: 2,
      name: "Working Hours",
      availability: [],
      timeZone: "America/New_York",
      ...overrides,
    });

    beforeEach(() => {
      prismaMock.schedule.count.mockResolvedValue(1);
    });

    it("should allow access when user is the schedule owner", async () => {
      const ownerId = 2;
      const mockSchedule = createMockSchedule({ userId: ownerId });

      prismaMock.schedule.findUnique.mockResolvedValue(mockSchedule as Schedule);
      mockHasReadPermissions.mockResolvedValue(false);

      const result = await scheduleRepository.findDetailedScheduleById({
        scheduleId: 100,
        userId: ownerId,
        timeZone: "UTC",
        defaultScheduleId: 100,
      });

      expect(result).toMatchObject({
        id: 100,
        name: "Working Hours",
        userId: ownerId,
      });
    });

    it("should allow access when user is part of the same team", async () => {
      const scheduleOwnerId = 2;
      const teamMemberId = 3;
      const mockSchedule = createMockSchedule({ userId: scheduleOwnerId });

      prismaMock.schedule.findUnique.mockResolvedValue(mockSchedule as Schedule);
      mockHasReadPermissions.mockResolvedValue(true);

      const result = await scheduleRepository.findDetailedScheduleById({
        scheduleId: 100,
        userId: teamMemberId,
        timeZone: "UTC",
        defaultScheduleId: null,
      });

      expect(mockHasReadPermissions).toHaveBeenCalledWith({
        memberId: scheduleOwnerId,
        userId: teamMemberId,
      });
      expect(result).toMatchObject({
        id: 100,
        name: "Working Hours",
        userId: scheduleOwnerId,
      });
    });

    it("should deny access when user is not owner and not part of team", async () => {
      const scheduleOwnerId = 2;
      const unauthorizedUserId = 999;
      const mockSchedule = createMockSchedule({ userId: scheduleOwnerId });

      prismaMock.schedule.findUnique.mockResolvedValue(mockSchedule as Schedule);
      mockHasReadPermissions.mockResolvedValue(false);

      await expect(
        scheduleRepository.findDetailedScheduleById({
          scheduleId: 100,
          userId: unauthorizedUserId,
          timeZone: "UTC",
          defaultScheduleId: null,
        })
      ).rejects.toThrow("UNAUTHORIZED");

      expect(mockHasReadPermissions).toHaveBeenCalledWith({
        memberId: scheduleOwnerId,
        userId: unauthorizedUserId,
      });
    });

    it("should throw error when schedule is not found", async () => {
      prismaMock.schedule.findUnique.mockResolvedValue(null);

      await expect(
        scheduleRepository.findDetailedScheduleById({
          scheduleId: 999,
          userId: 1,
          timeZone: "UTC",
          defaultScheduleId: null,
        })
      ).rejects.toThrow("Schedule not found");
    });
  });

  /**
   * Validates the lightweight schedule projection used by the date-range builder,
   * including nested user.travelSchedules and availability fields.
   */
  describe("findScheduleByIdForBuildDateRanges", () => {
    it("should return schedule with nested availability and user travel schedules", async () => {
      const scheduleId = 10;
      const mockSchedule = {
        id: scheduleId,
        timeZone: "America/New_York",
        userId: 5,
        availability: [
          {
            days: [1, 2, 3, 4, 5],
            startTime: new Date("1970-01-01T09:00:00.000Z"),
            endTime: new Date("1970-01-01T17:00:00.000Z"),
            date: null,
          },
        ],
        user: {
          id: 5,
          defaultScheduleId: 10,
          travelSchedules: [
            {
              id: 1,
              timeZone: "Europe/London",
              startDate: new Date("2025-06-01"),
              endDate: new Date("2025-06-15"),
            },
          ],
        },
      };

      prismaMock.schedule.findUnique.mockResolvedValue(mockSchedule as any);

      const result = await scheduleRepository.findScheduleByIdForBuildDateRanges({ scheduleId });

      expect(result).toEqual(mockSchedule);
      expect(prismaMock.schedule.findUnique).toHaveBeenCalledWith({
        where: { id: scheduleId },
        select: {
          id: true,
          timeZone: true,
          userId: true,
          availability: {
            select: {
              days: true,
              startTime: true,
              endTime: true,
              date: true,
            },
          },
          user: {
            select: {
              id: true,
              defaultScheduleId: true,
              travelSchedules: {
                select: {
                  id: true,
                  timeZone: true,
                  startDate: true,
                  endDate: true,
                },
              },
            },
          },
        },
      });
    });

    it("should verify the exact select projection matches the source implementation", async () => {
      const scheduleId = 20;
      const mockSchedule = {
        id: scheduleId,
        timeZone: null,
        userId: 7,
        availability: [],
        user: {
          id: 7,
          defaultScheduleId: null,
          travelSchedules: [],
        },
      };

      prismaMock.schedule.findUnique.mockResolvedValue(mockSchedule as any);

      const result = await scheduleRepository.findScheduleByIdForBuildDateRanges({ scheduleId });

      expect(result).toEqual(mockSchedule);

      // Verify the exact call arguments match the source select projection
      const callArgs = prismaMock.schedule.findUnique.mock.calls[0][0];
      expect(callArgs).toHaveProperty("where.id", scheduleId);
      expect(callArgs).toHaveProperty("select.id", true);
      expect(callArgs).toHaveProperty("select.timeZone", true);
      expect(callArgs).toHaveProperty("select.userId", true);
      expect(callArgs).toHaveProperty("select.availability.select.days", true);
      expect(callArgs).toHaveProperty("select.availability.select.startTime", true);
      expect(callArgs).toHaveProperty("select.availability.select.endTime", true);
      expect(callArgs).toHaveProperty("select.availability.select.date", true);
      expect(callArgs).toHaveProperty("select.user.select.id", true);
      expect(callArgs).toHaveProperty("select.user.select.defaultScheduleId", true);
      expect(callArgs).toHaveProperty("select.user.select.travelSchedules.select.id", true);
      expect(callArgs).toHaveProperty("select.user.select.travelSchedules.select.timeZone", true);
      expect(callArgs).toHaveProperty("select.user.select.travelSchedules.select.startDate", true);
      expect(callArgs).toHaveProperty("select.user.select.travelSchedules.select.endDate", true);
    });

    it("should return null when schedule is not found (does not throw)", async () => {
      prismaMock.schedule.findUnique.mockResolvedValue(null);

      const result = await scheduleRepository.findScheduleByIdForBuildDateRanges({ scheduleId: 999 });

      expect(result).toBeNull();
    });
  });

  /**
   * Validates the minimal ownership-check projection (only userId) for schedule
   * permission validation without fetching full schedule data.
   */
  describe("findScheduleByIdForOwnershipCheck", () => {
    it("should return schedule userId for ownership verification", async () => {
      const scheduleId = 50;
      const mockSchedule = { userId: 42 };

      prismaMock.schedule.findUnique.mockResolvedValue(mockSchedule as any);

      const result = await scheduleRepository.findScheduleByIdForOwnershipCheck({ scheduleId });

      expect(result).toEqual({ userId: 42 });
      expect(prismaMock.schedule.findUnique).toHaveBeenCalledWith({
        where: { id: scheduleId },
        select: { userId: true },
      });
    });

    it("should return null when schedule does not exist (does not throw)", async () => {
      const scheduleId = 999;

      prismaMock.schedule.findUnique.mockResolvedValue(null);

      const result = await scheduleRepository.findScheduleByIdForOwnershipCheck({ scheduleId });

      expect(result).toBeNull();
      expect(prismaMock.schedule.findUnique).toHaveBeenCalledWith({
        where: { id: scheduleId },
        select: { userId: true },
      });
    });
  });

  /**
   * Validates the standard schedule retrieval projection (id, userId, name,
   * availability, timeZone) used by findDetailedScheduleById and other callers.
   */
  describe("findScheduleById", () => {
    it("should return schedule with id, userId, name, availability, and timeZone", async () => {
      const mockSchedule = {
        id: 30,
        userId: 8,
        name: "Office Hours",
        availability: [
          {
            days: [1, 2, 3],
            startTime: new Date("1970-01-01T08:00:00.000Z"),
            endTime: new Date("1970-01-01T16:00:00.000Z"),
            date: null,
          },
        ],
        timeZone: "Europe/Berlin",
      };

      prismaMock.schedule.findUnique.mockResolvedValue(mockSchedule as any);

      const result = await scheduleRepository.findScheduleById({ id: 30 });

      expect(result).toEqual(mockSchedule);
      expect(prismaMock.schedule.findUnique).toHaveBeenCalledWith({
        where: { id: 30 },
        select: {
          id: true,
          userId: true,
          name: true,
          availability: true,
          timeZone: true,
        },
      });
    });

    it("should return null when schedule does not exist (does not throw)", async () => {
      prismaMock.schedule.findUnique.mockResolvedValue(null);

      const result = await scheduleRepository.findScheduleById({ id: 404 });

      expect(result).toBeNull();
      expect(prismaMock.schedule.findUnique).toHaveBeenCalledWith({
        where: { id: 404 },
        select: {
          id: true,
          userId: true,
          name: true,
          availability: true,
          timeZone: true,
        },
      });
    });
  });

  /**
   * Validates bulk schedule retrieval for a user with permission checks,
   * Atom-transformed output shape, isDefault/isLastSchedule flags, and timezone fallback.
   */
  describe("findManyDetailedScheduleByUserId", () => {
    const createMockScheduleForMany = (overrides: Partial<Schedule> = {}): Partial<Schedule> => ({
      id: 200,
      userId: 10,
      name: "Default Schedule",
      availability: [],
      timeZone: "America/Chicago",
      ...overrides,
    });

    it("should return formatted schedules when user is the owner", async () => {
      const ownerId = 10;
      const defaultScheduleId = 200;
      const mockSchedules = [
        createMockScheduleForMany({ id: 200, userId: ownerId, name: "Morning" }),
        createMockScheduleForMany({ id: 201, userId: ownerId, name: "Evening" }),
      ];

      prismaMock.schedule.findMany.mockResolvedValue(mockSchedules as Schedule[]);
      mockHasReadPermissions.mockResolvedValue(false);

      const result = await scheduleRepository.findManyDetailedScheduleByUserId({
        userId: ownerId,
        defaultScheduleId,
        timeZone: "UTC",
      });

      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({
        id: 200,
        name: "Morning",
        isManaged: false,
        timeZone: "America/Chicago",
        isDefault: true,
        isLastSchedule: false,
        readOnly: false,
        userId: ownerId,
      });
      expect(result[1]).toMatchObject({
        id: 201,
        name: "Evening",
        isManaged: false,
        timeZone: "America/Chicago",
        isDefault: false,
        isLastSchedule: false,
        readOnly: false,
        userId: ownerId,
      });
    });

    it("should allow team member access when hasReadPermissionsForUserId returns true", async () => {
      const scheduleOwnerId = 10;
      const teamMemberId = 20;
      const mockSchedules = [
        createMockScheduleForMany({ id: 300, userId: scheduleOwnerId, name: "Team Schedule" }),
      ];

      prismaMock.schedule.findMany.mockResolvedValue(mockSchedules as Schedule[]);
      mockHasReadPermissions.mockResolvedValue(true);

      const result = await scheduleRepository.findManyDetailedScheduleByUserId({
        userId: teamMemberId,
        defaultScheduleId: null,
        timeZone: "UTC",
      });

      expect(mockHasReadPermissions).toHaveBeenCalledWith({
        memberId: scheduleOwnerId,
        userId: teamMemberId,
      });
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: 300,
        name: "Team Schedule",
        isManaged: true,
        readOnly: true,
        userId: scheduleOwnerId,
      });
    });

    it("should throw UNAUTHORIZED when user is not owner and not part of team", async () => {
      const scheduleOwnerId = 10;
      const unauthorizedUserId = 999;
      const mockSchedules = [
        createMockScheduleForMany({ id: 400, userId: scheduleOwnerId }),
      ];

      prismaMock.schedule.findMany.mockResolvedValue(mockSchedules as Schedule[]);
      mockHasReadPermissions.mockResolvedValue(false);

      await expect(
        scheduleRepository.findManyDetailedScheduleByUserId({
          userId: unauthorizedUserId,
          defaultScheduleId: null,
          timeZone: "UTC",
        })
      ).rejects.toThrow("UNAUTHORIZED");

      expect(mockHasReadPermissions).toHaveBeenCalledWith({
        memberId: scheduleOwnerId,
        userId: unauthorizedUserId,
      });
    });

    it("should throw 'Schedules not found' when no schedules exist for user", async () => {
      prismaMock.schedule.findMany.mockResolvedValue([]);

      await expect(
        scheduleRepository.findManyDetailedScheduleByUserId({
          userId: 10,
          defaultScheduleId: null,
          timeZone: "UTC",
        })
      ).rejects.toThrow("Schedules not found");
    });

    it("should set isDefault to true only for the schedule matching defaultScheduleId", async () => {
      const ownerId = 10;
      const defaultId = 502;
      const mockSchedules = [
        createMockScheduleForMany({ id: 501, userId: ownerId, name: "First" }),
        createMockScheduleForMany({ id: 502, userId: ownerId, name: "Second" }),
        createMockScheduleForMany({ id: 503, userId: ownerId, name: "Third" }),
      ];

      prismaMock.schedule.findMany.mockResolvedValue(mockSchedules as Schedule[]);
      mockHasReadPermissions.mockResolvedValue(false);

      const result = await scheduleRepository.findManyDetailedScheduleByUserId({
        userId: ownerId,
        defaultScheduleId: defaultId,
        timeZone: "UTC",
      });

      expect(result[0].isDefault).toBe(false);
      expect(result[1].isDefault).toBe(true);
      expect(result[2].isDefault).toBe(false);
    });

    it("should set isLastSchedule to true when only one schedule exists", async () => {
      const ownerId = 10;
      const mockSchedules = [
        createMockScheduleForMany({ id: 600, userId: ownerId }),
      ];

      prismaMock.schedule.findMany.mockResolvedValue(mockSchedules as Schedule[]);
      mockHasReadPermissions.mockResolvedValue(false);

      const result = await scheduleRepository.findManyDetailedScheduleByUserId({
        userId: ownerId,
        defaultScheduleId: 600,
        timeZone: "UTC",
      });

      expect(result).toHaveLength(1);
      expect(result[0].isLastSchedule).toBe(true);
    });

    it("should set isLastSchedule to false when multiple schedules exist", async () => {
      const ownerId = 10;
      const mockSchedules = [
        createMockScheduleForMany({ id: 700, userId: ownerId }),
        createMockScheduleForMany({ id: 701, userId: ownerId }),
      ];

      prismaMock.schedule.findMany.mockResolvedValue(mockSchedules as Schedule[]);
      mockHasReadPermissions.mockResolvedValue(false);

      const result = await scheduleRepository.findManyDetailedScheduleByUserId({
        userId: ownerId,
        defaultScheduleId: 700,
        timeZone: "UTC",
      });

      expect(result).toHaveLength(2);
      expect(result[0].isLastSchedule).toBe(false);
      expect(result[1].isLastSchedule).toBe(false);
    });

    it("should use schedule.timeZone when present, fall back to userTimeZone when null", async () => {
      const ownerId = 10;
      const mockSchedules = [
        createMockScheduleForMany({ id: 800, userId: ownerId, timeZone: "Asia/Tokyo" }),
        createMockScheduleForMany({ id: 801, userId: ownerId, timeZone: null }),
        createMockScheduleForMany({ id: 802, userId: ownerId, timeZone: "" }),
      ];

      prismaMock.schedule.findMany.mockResolvedValue(mockSchedules as Schedule[]);
      mockHasReadPermissions.mockResolvedValue(false);

      const result = await scheduleRepository.findManyDetailedScheduleByUserId({
        userId: ownerId,
        defaultScheduleId: 800,
        timeZone: "Europe/Paris",
      });

      // Schedule with timeZone set → uses its own timeZone
      expect(result[0].timeZone).toBe("Asia/Tokyo");
      // Schedule with null timeZone → falls back to userTimeZone
      expect(result[1].timeZone).toBe("Europe/Paris");
      // Schedule with empty string timeZone → falls back to userTimeZone (falsy)
      expect(result[2].timeZone).toBe("Europe/Paris");
    });

    it("should mark schedules as readOnly when user is not owner and not managed event type", async () => {
      const scheduleOwnerId = 10;
      const viewerId = 20;
      const mockSchedules = [
        createMockScheduleForMany({ id: 900, userId: scheduleOwnerId }),
      ];

      prismaMock.schedule.findMany.mockResolvedValue(mockSchedules as Schedule[]);
      mockHasReadPermissions.mockResolvedValue(true);

      const result = await scheduleRepository.findManyDetailedScheduleByUserId({
        userId: viewerId,
        defaultScheduleId: null,
        timeZone: "UTC",
      });

      // readOnly should be true: schedule.userId !== userId && !isManagedEventType
      expect(result[0].readOnly).toBe(true);
    });

    it("should set readOnly to false for managed event types even when user is not owner", async () => {
      const scheduleOwnerId = 10;
      const viewerId = 20;
      const mockSchedules = [
        createMockScheduleForMany({ id: 950, userId: scheduleOwnerId }),
      ];

      prismaMock.schedule.findMany.mockResolvedValue(mockSchedules as Schedule[]);
      mockHasReadPermissions.mockResolvedValue(true);

      const result = await scheduleRepository.findManyDetailedScheduleByUserId({
        userId: viewerId,
        defaultScheduleId: null,
        timeZone: "UTC",
        isManagedEventType: true,
      });

      // readOnly should be false because isManagedEventType is true
      expect(result[0].readOnly).toBe(false);
    });

    it("should call prisma.schedule.findMany with correct where and select arguments", async () => {
      const ownerId = 10;
      const mockSchedules = [
        createMockScheduleForMany({ id: 100, userId: ownerId }),
      ];

      prismaMock.schedule.findMany.mockResolvedValue(mockSchedules as Schedule[]);
      mockHasReadPermissions.mockResolvedValue(false);

      await scheduleRepository.findManyDetailedScheduleByUserId({
        userId: ownerId,
        defaultScheduleId: 100,
        timeZone: "UTC",
      });

      expect(prismaMock.schedule.findMany).toHaveBeenCalledWith({
        where: { userId: ownerId },
        select: {
          id: true,
          userId: true,
          name: true,
          availability: true,
          timeZone: true,
        },
      });
    });
  });
});
