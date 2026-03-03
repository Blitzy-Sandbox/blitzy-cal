import { hasReadPermissionsForUserId } from "@calcom/lib/hasEditPermissionForUser";
import {
  transformAvailabilityForAtom,
  transformDateOverridesForAtom,
  transformWorkingHoursForAtom,
} from "@calcom/lib/schedules/transformers";
import type { PrismaClient } from "@calcom/prisma";
import type { User } from "@calcom/prisma/client";

/**
 * Stable type alias representing the return type of
 * {@link ScheduleRepository.findDetailedScheduleById}.
 *
 * This type is part of the Platform SDK contract and is re-exported via
 * `packages/platform/libraries/schedules.ts`. Changing or removing this type
 * would break downstream platform consumers (Rule 0.7.4).
 */
export type FindDetailedScheduleByIdReturnType = Awaited<
  ReturnType<ScheduleRepository["findDetailedScheduleById"]>
>;

/**
 * Prisma-backed schedule CRUD repository with permission enforcement,
 * default schedule lifecycle management, and Atom-compatible payload transformation.
 *
 * This class is the foundational data access layer for the entire availability engine.
 * All database access for `Schedule` and related `Availability` records flows through
 * this repository, enforcing ownership and team-membership permissions on every operation.
 *
 * **Dependency Injection:** Instantiated via `@evyweb/ioctopus` in
 * `packages/features/di/modules/Schedule.ts` with a `PrismaClient` injected at construction time.
 *
 * **Platform SDK Surface:**
 * - Re-exported as `ScheduleRepository` via `packages/platform/libraries/schedules.ts`
 * - Re-exported as `PrismaScheduleRepository` via `packages/platform/libraries/repositories.ts`
 * - Consumed by 10+ tRPC handlers, web app modules, and API v2 NestJS providers.
 *
 * **Backward Compatibility (Rule 0.7.4):** The class name, method signatures, return types,
 * and the {@link FindDetailedScheduleByIdReturnType} type alias are part of the stable
 * Platform SDK contract and must not be changed.
 */
export class ScheduleRepository {
  // when instantiating, prismaClient injection is required
  constructor(private readonly prismaClient: PrismaClient) {
    if (!prismaClient) {
      throw new Error("PrismaClient is required for ScheduleRepository");
    }
  }

  /**
   * Fetches minimal schedule metadata required by the date-range builder pipeline.
   *
   * Returns the schedule's core fields (`id`, `timeZone`, `userId`) along with nested
   * `availability` entries (days, startTime, endTime, date) and the owning user's
   * `travelSchedules` (id, timeZone, startDate, endDate). The travel schedule data is
   * consumed by `getAdjustedTimezone` in `packages/features/schedules/lib/date-ranges.ts`
   * for DST normalization during working-hour processing.
   *
   * Also includes `user.defaultScheduleId` which is used during schedule resolution flows.
   *
   * @param params.scheduleId - The unique ID of the schedule to fetch.
   * @returns The schedule with nested availability and travel schedule data, or `null` if not found.
   */
  async findScheduleByIdForBuildDateRanges({ scheduleId }: { scheduleId: number }) {
    const schedule = await this.prismaClient.schedule.findUnique({
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

    return schedule;
  }

  /**
   * Performs a lean fetch returning only the `userId` for ownership verification.
   *
   * Used by `packages/features/schedules/services/ScheduleService.ts` to verify that the
   * requesting user owns a schedule before allowing update or delete operations. Only the
   * `userId` field is selected to minimize data transfer.
   *
   * @param params.scheduleId - The unique ID of the schedule to check ownership for.
   * @returns An object containing `userId`, or `null` if the schedule does not exist.
   */
  async findScheduleByIdForOwnershipCheck({ scheduleId }: { scheduleId: number }) {
    const schedule = await this.prismaClient.schedule.findUnique({
      where: {
        id: scheduleId,
      },
      select: {
        userId: true,
      },
    });
    return schedule;
  }

  /**
   * Fetches a schedule by its ID with standard core fields.
   *
   * Retrieves the schedule record including `id`, `userId`, `name`, `availability`,
   * and `timeZone`. This is used by general-purpose schedule reads where the full
   * Atom-transformed payload is not required.
   *
   * @param params.id - The unique ID of the schedule to retrieve.
   * @returns The schedule object with core fields, or `null` if not found.
   */
  async findScheduleById({ id }: { id: number }) {
    const schedule = await this.prismaClient.schedule.findUnique({
      where: {
        id,
      },
      select: {
        id: true,
        userId: true,
        name: true,
        availability: true,
        timeZone: true,
      },
    });

    return schedule;
  }

  /**
   * Primary schedule detail resolver with permission enforcement and Atom transformation.
   *
   * This is the centerpiece method of the repository. Its return type defines the
   * Platform SDK's {@link FindDetailedScheduleByIdReturnType} contract.
   *
   * Resolution flow:
   * 1. **Default resolution** — If no `scheduleId` is provided, resolves via
   *    {@link getDefaultScheduleId} using the user's persisted default or first available schedule.
   * 2. **Existence check** — Throws `"Schedule not found"` if the resolved ID yields no record.
   * 3. **Permission check** — Verifies the requesting user is either the schedule owner or a
   *    team member via `hasReadPermissionsForUserId`.
   * 4. **Atom transformation** — Converts raw Prisma data to the Atom-compatible payload using
   *    `transformWorkingHoursForAtom`, `transformAvailabilityForAtom`, and
   *    `transformDateOverridesForAtom`.
   * 5. **Metadata flags** — Computes `isManaged`, `isDefault`, `isLastSchedule`, and `readOnly`.
   *
   * @param params.scheduleId - Optional explicit schedule ID. When omitted, the user's default is resolved.
   * @param params.userId - The ID of the requesting user (used for permission checks and ownership).
   * @param params.defaultScheduleId - The user's current default schedule ID (or `null`).
   * @param params.timeZone - The user's profile timezone, used as fallback when the schedule has no timezone set.
   * @param params.isManagedEventType - Optional flag indicating a managed event type context;
   *   when `true`, non-owner schedules are not marked as `readOnly`.
   * @returns An Atom-compatible schedule detail object with working hours, availability,
   *   date overrides, timezone, and metadata flags.
   * @throws {Error} "Schedule not found" if the resolved schedule ID does not exist.
   * @throws {Error} "UNAUTHORIZED" if the requesting user is neither the owner nor a team member.
   */
  async findDetailedScheduleById({
    isManagedEventType,
    scheduleId,
    userId,
    defaultScheduleId,
    timeZone: userTimeZone,
  }: {
    timeZone: string;
    userId: number;
    defaultScheduleId: number | null;
    scheduleId?: number;
    isManagedEventType?: boolean;
  }) {
    const schedule = await this.prismaClient.schedule.findUnique({
      where: {
        id: scheduleId || (await this.getDefaultScheduleId(userId)),
      },
      select: {
        id: true,
        userId: true,
        name: true,
        availability: true,
        timeZone: true,
      },
    });

    if (!schedule) {
      throw new Error("Schedule not found");
    }
    const isCurrentUserPartOfTeam = await hasReadPermissionsForUserId({ memberId: schedule?.userId, userId });

    const isCurrentUserOwner = schedule?.userId === userId;

    if (!isCurrentUserPartOfTeam && !isCurrentUserOwner) {
      throw new Error("UNAUTHORIZED");
    }

    const timeZone = schedule.timeZone || userTimeZone;

    const schedulesCount = await this.prismaClient.schedule.count({
      where: {
        userId: userId,
      },
    });
    // disabling utc casting while fetching WorkingHours
    return {
      id: schedule.id,
      name: schedule.name,
      isManaged: schedule.userId !== userId,
      workingHours: transformWorkingHoursForAtom(schedule),
      schedule: schedule.availability,
      availability: transformAvailabilityForAtom(schedule),
      timeZone,
      dateOverrides: transformDateOverridesForAtom(schedule, timeZone),
      isDefault: !scheduleId || defaultScheduleId === schedule.id,
      isLastSchedule: schedulesCount <= 1,
      readOnly: schedule.userId !== userId && !isManagedEventType,
      userId: schedule.userId,
    };
  }

  /**
   * Retrieves all schedules for a user with the same Atom-compatible shape as
   * {@link findDetailedScheduleById}.
   *
   * Fetches every `Schedule` record belonging to the given `userId`, verifies read
   * permissions once using the first schedule's `userId`, then maps each schedule
   * through the Atom transformer pipeline (`transformWorkingHoursForAtom`,
   * `transformAvailabilityForAtom`, `transformDateOverridesForAtom`).
   *
   * Each schedule in the returned array includes metadata flags: `isManaged`,
   * `isDefault` (matched against `defaultScheduleId`), `isLastSchedule`,
   * `readOnly`, and `userId`.
   *
   * @param params.userId - The ID of the requesting user.
   * @param params.defaultScheduleId - The user's current default schedule ID (or `null`).
   * @param params.timeZone - The user's profile timezone, used as fallback when a schedule has no timezone set.
   * @param params.isManagedEventType - Optional flag indicating a managed event type context;
   *   when `true`, non-owner schedules are not marked as `readOnly`.
   * @returns An array of Atom-compatible schedule detail objects.
   * @throws {Error} "Schedules not found" if the user has zero schedule records.
   * @throws {Error} "UNAUTHORIZED" if the requesting user is neither the owner nor a team member.
   */
  async findManyDetailedScheduleByUserId({
    isManagedEventType,
    userId,
    defaultScheduleId,

    timeZone: userTimeZone,
  }: {
    timeZone: string;
    userId: number;
    defaultScheduleId: number | null;

    isManagedEventType?: boolean;
  }) {
    const schedules = await this.prismaClient.schedule.findMany({
      where: {
        userId: userId,
      },
      select: {
        id: true,
        userId: true,
        name: true,
        availability: true,
        timeZone: true,
      },
    });

    if (!schedules?.length) {
      throw new Error("Schedules not found");
    }

    const isCurrentUserPartOfTeam = await hasReadPermissionsForUserId({
      memberId: schedules[0].userId,
      userId,
    });

    const schedulesFormatted = schedules.map((schedule) => {
      const isCurrentUserOwner = schedule?.userId === userId;

      if (!isCurrentUserPartOfTeam && !isCurrentUserOwner) {
        throw new Error("UNAUTHORIZED");
      }

      const timeZone = schedule.timeZone || userTimeZone;
      // disabling utc casting while fetching WorkingHours
      return {
        id: schedule.id,
        name: schedule.name,
        isManaged: schedule.userId !== userId,
        workingHours: transformWorkingHoursForAtom(schedule),
        schedule: schedule.availability,
        availability: transformAvailabilityForAtom(schedule),
        timeZone,
        isDefault: schedule.id === defaultScheduleId,
        dateOverrides: transformDateOverridesForAtom(schedule, timeZone),
        readOnly: schedule.userId !== userId && !isManagedEventType,
        isLastSchedule: schedules.length <= 1,
        userId: schedule.userId,
      };
    });

    return schedulesFormatted;
  }

  /**
   * Resolves the user's default schedule ID using a priority-based fallback chain.
   *
   * Resolution priority:
   * 1. `user.defaultScheduleId` — If already persisted on the User record, return it immediately.
   * 2. `schedule.findFirst` — If no default is set, find any schedule belonging to the user and return its ID.
   * 3. Throw — If no schedules exist at all for the user.
   *
   * **Note:** This method intentionally does NOT call {@link setupDefaultSchedule} to persist
   * the fallback result, avoiding side effects during read operations.
   *
   * @param userId - The ID of the user whose default schedule should be resolved.
   * @returns The resolved default schedule ID.
   * @throws {Error} "No schedules found for user" if the user has zero schedule records.
   */
  async getDefaultScheduleId(userId: number) {
    const user = await this.prismaClient.user.findUnique({
      where: {
        id: userId,
      },
      select: {
        defaultScheduleId: true,
      },
    });

    if (user?.defaultScheduleId) {
      return user.defaultScheduleId;
    }

    // If we're returning the default schedule for the first time then we should set it in the user record
    const defaultSchedule = await this.prismaClient.schedule.findFirst({
      where: {
        userId,
      },
      select: {
        id: true,
      },
    });

    if (!defaultSchedule) {
      // Handle case where defaultSchedule is null by throwing an error
      throw new Error("No schedules found for user");
    }

    return defaultSchedule.id;
  }

  /**
   * Checks whether a user has at least one schedule or has a default schedule ID already set.
   *
   * Returns `true` if either `user.defaultScheduleId` is truthy or at least one `Schedule`
   * record exists for the given user. This is used during onboarding and schedule creation
   * flows to determine if a default schedule backfill is necessary.
   *
   * @param user - A partial User object; must include `id` and optionally `defaultScheduleId`.
   * @returns `true` if the user has a default schedule ID or at least one schedule exists; `false` otherwise.
   */
  async hasDefaultSchedule(user: Partial<User>) {
    const defaultSchedule = await this.prismaClient.schedule.findFirst({
      where: {
        userId: user.id,
      },
    });
    return !!user.defaultScheduleId || !!defaultSchedule;
  }

  /**
   * Atomically sets the user's default schedule ID.
   *
   * Performs a direct `prisma.user.update` to persist the default schedule association.
   * Used during schedule creation to establish the initial default schedule and during
   * explicit default assignment when a user selects a different schedule as their default.
   *
   * @param userId - The ID of the user whose default schedule is being set.
   * @param scheduleId - The ID of the schedule to mark as the user's default.
   * @returns The updated User record from Prisma.
   */
  async setupDefaultSchedule(userId: number, scheduleId: number) {
    return this.prismaClient.user.update({
      where: {
        id: userId,
      },
      data: {
        defaultScheduleId: scheduleId,
      },
    });
  }
}
