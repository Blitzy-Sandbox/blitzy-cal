import { CreateAvailabilityInput_2024_04_15 } from "@/ee/schedules/schedules_2024_04_15/inputs/create-availability.input";
import { CreateScheduleInput_2024_04_15 } from "@/ee/schedules/schedules_2024_04_15/inputs/create-schedule.input";
import { SchedulesRepository_2024_04_15 } from "@/ee/schedules/schedules_2024_04_15/schedules.repository";
import { PrismaScheduleRepository } from "@/lib/repositories/prisma-schedule.repository";
import { PrismaWriteService } from "@/modules/prisma/prisma-write.service";
import { UserWithProfile, UsersRepository } from "@/modules/users/users.repository";
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";

import { updateSchedule } from "@calcom/platform-libraries/schedules";
import type { UpdateScheduleInput_2024_04_15 } from "@calcom/platform-types";
import type { PrismaClient } from "@calcom/prisma";
import type { Schedule } from "@calcom/prisma/client";

/**
 * NestJS injectable service orchestrating CRUD operations for the April 15, 2024
 * versioned enterprise schedule API (`VERSION_2024_04_15`).
 *
 * Coordinates between four DI-injected dependencies:
 * - `SchedulesRepository_2024_04_15` — Versioned Prisma repository for schedule CRUD.
 * - `UsersRepository` — Shared user lookup and default schedule assignment.
 * - `PrismaWriteService` — Shared Prisma write client passed to `updateSchedule`.
 * - `PrismaScheduleRepository` — Shared feature-level repository wrapping
 *   `@calcom/features/schedules/repositories/ScheduleRepository.ts`.
 *
 * @remarks
 * Registered in `SchedulesModule_2024_04_15` and consumed by `SchedulesController_2024_04_15`.
 *
 * Enforces ownership via `checkUserOwnsSchedule` on all mutation and read-by-id operations.
 */
@Injectable()
export class SchedulesService_2024_04_15 {
  constructor(
    private readonly schedulesRepository: SchedulesRepository_2024_04_15,
    private readonly usersRepository: UsersRepository,
    private readonly dbWrite: PrismaWriteService,
    private readonly prismaScheduleRepository: PrismaScheduleRepository
  ) {}

  /**
   * Creates a default schedule for a user with the canonical "Default schedule" name
   * and the given timezone.
   *
   * @param userId - The ID of the user to create the default schedule for.
   * @param timeZone - The IANA timezone string for the schedule.
   * @returns The enriched created schedule with availability details.
   *
   * @remarks
   * Delegates to `createUserSchedule` with `isDefault: true`.
   */
  async createUserDefaultSchedule(userId: number, timeZone: string) {
    const schedule = {
      isDefault: true,
      name: "Default schedule",
      timeZone,
    };

    return this.createUserSchedule(userId, schedule);
  }

  /**
   * Creates a schedule with associated availability entries for a user.
   *
   * @param userId - The owning user's ID.
   * @param schedule - The schedule creation input including name, timezone, isDefault flag,
   *   and optional availabilities.
   * @returns The enriched created schedule reloaded via `getUserSchedule`.
   *
   * @remarks
   * Falls back to `getDefaultAvailabilityInput()` (Mon-Fri 09:00-17:00 UTC) when
   * `schedule.availabilities` is empty or absent.
   *
   * Sets the schedule as user's default via `UsersRepository.setDefaultSchedule` when
   * `schedule.isDefault` is true.
   */
  async createUserSchedule(userId: number, schedule: CreateScheduleInput_2024_04_15) {
    const availabilities = schedule.availabilities?.length
      ? schedule.availabilities
      : [this.getDefaultAvailabilityInput()];

    const createdSchedule = await this.schedulesRepository.createScheduleWithAvailabilities(
      userId,
      schedule,
      availabilities
    );

    if (schedule.isDefault) {
      await this.usersRepository.setDefaultSchedule(userId, createdSchedule.id);
    }

    const formattedSchedule = await this.getUserSchedule(userId, createdSchedule.id);

    return formattedSchedule;
  }

  /**
   * Retrieves the user's default schedule with full availability details.
   *
   * @param userId - The ID of the user whose default schedule is requested.
   * @returns The detailed default schedule, or `null` if the user has no default schedule set.
   *
   * @remarks
   * Uses `PrismaScheduleRepository.findDetailedScheduleById` for Atom-compatible detailed
   * schedule retrieval.
   */
  async getUserScheduleDefault(userId: number) {
    const user = await this.usersRepository.findById(userId);

    if (!user?.defaultScheduleId) return null;
    return await this.prismaScheduleRepository.findDetailedScheduleById({
      scheduleId: user.defaultScheduleId,
      isManagedEventType: undefined,
      userId,
      timeZone: user.timeZone,
      defaultScheduleId: user.defaultScheduleId,
    });
  }

  /**
   * Retrieves a specific schedule by ID for a user, with ownership validation.
   *
   * @param userId - The ID of the user requesting the schedule.
   * @param scheduleId - The ID of the schedule to retrieve.
   * @returns The detailed schedule with availability entries.
   * @throws {NotFoundException} If the user or schedule does not exist.
   * @throws {ForbiddenException} If the user does not own the schedule.
   */
  async getUserSchedule(userId: number, scheduleId: number) {
    const user = await this.usersRepository.findById(userId);

    if (!user) {
      throw new NotFoundException(`User with ID=${userId} does not exist.`);
    }

    const existingSchedule = await this.prismaScheduleRepository.findDetailedScheduleById({
      scheduleId: scheduleId,
      isManagedEventType: undefined,
      userId,
      timeZone: user.timeZone,
      defaultScheduleId: user.defaultScheduleId,
    });

    if (!existingSchedule) {
      throw new NotFoundException(`Schedule with ID=${scheduleId} does not exist.`);
    }

    this.checkUserOwnsSchedule(userId, existingSchedule);

    return existingSchedule;
  }

  /**
   * Retrieves all schedules for a user with full availability details.
   *
   * @param userId - The ID of the user.
   * @param timeZone - The IANA timezone for schedule display.
   * @param defaultScheduleId - The user's current default schedule ID (or null).
   * @returns Array of detailed schedules with availability.
   */
  async getUserSchedules(userId: number, timeZone: string, defaultScheduleId: number | null) {
    return this.prismaScheduleRepository.findManyDetailedScheduleByUserId({
      userId,
      timeZone,
      defaultScheduleId,
    });
  }

  /**
   * Updates an existing schedule with ownership validation and availability backfill.
   *
   * @param user - The authenticated user with profile context (`UserWithProfile`).
   * @param scheduleId - The ID of the schedule to update.
   * @param bodySchedule - The update payload (`UpdateScheduleInput_2024_04_15`).
   * @returns The result of the Platform SDK `updateSchedule` call.
   * @throws {NotFoundException} If the schedule does not exist.
   * @throws {ForbiddenException} If the user does not own the schedule.
   *
   * @remarks
   * When `bodySchedule.schedule` is absent, backfills with current availability to prevent
   * data wipe during metadata-only updates.
   *
   * Delegates final update to `updateSchedule` from `@calcom/platform-libraries/schedules`
   * (Platform SDK contract — Rule 0.7.4).
   */
  async updateUserSchedule(
    user: UserWithProfile,
    scheduleId: number,
    bodySchedule: UpdateScheduleInput_2024_04_15
  ) {
    const existingSchedule = await this.schedulesRepository.getScheduleById(scheduleId);

    if (!existingSchedule) {
      throw new NotFoundException(`Schedule with ID=${scheduleId} does not exist.`);
    }

    this.checkUserOwnsSchedule(user.id, existingSchedule);

    const schedule = await this.getUserSchedule(user.id, Number(scheduleId));

    if (!bodySchedule.schedule) {
      // note(Lauris): When updating an availability in cal web app, lets say only its name, also
      // the schedule is sent and then passed to the update handler. Notably, availability is passed too
      // and they have same shape, so to match shapes I attach "scheduleFormatted.availability" to reflect
      // schedule that would be passed by the web app. If we don't, then updating schedule name will erase
      // schedule.
      bodySchedule.schedule = schedule.availability;
    }

    return updateSchedule({
      input: {
        scheduleId: Number(scheduleId),
        ...bodySchedule,
      },
      user,
      prisma: this.dbWrite.prisma as unknown as PrismaClient,
    });
  }

  /**
   * Deletes a schedule after validating existence and ownership.
   *
   * @param userId - The ID of the requesting user.
   * @param scheduleId - The ID of the schedule to delete.
   * @returns The deleted schedule record.
   * @throws {BadRequestException} If the schedule does not exist.
   * @throws {ForbiddenException} If the user does not own the schedule.
   */
  async deleteUserSchedule(userId: number, scheduleId: number) {
    const existingSchedule = await this.schedulesRepository.getScheduleById(scheduleId);

    if (!existingSchedule) {
      throw new BadRequestException(`Schedule with ID=${scheduleId} does not exist.`);
    }

    this.checkUserOwnsSchedule(userId, existingSchedule);

    return this.schedulesRepository.deleteScheduleById(scheduleId);
  }

  /**
   * Validates that a user owns a given schedule. Used as a permission gate before all
   * mutations and read-by-id operations (Rule 0.7.6).
   *
   * @param userId - The ID of the requesting user.
   * @param schedule - The schedule to check, requiring at minimum `id` and `userId` fields.
   * @throws {ForbiddenException} When `userId !== schedule.userId`.
   */
  checkUserOwnsSchedule(userId: number, schedule: Pick<Schedule, "id" | "userId">) {
    if (userId !== schedule.userId) {
      throw new ForbiddenException(`User with ID=${userId} does not own schedule with ID=${schedule.id}`);
    }
  }

  /**
   * Generates the canonical default availability input: weekdays 1-5 (Mon-Fri), 09:00-17:00 UTC.
   *
   * @returns A `CreateAvailabilityInput_2024_04_15` with deterministic Mon-Fri 09:00-17:00 UTC range.
   *
   * @remarks
   * Used as fallback when `createUserSchedule` receives no availability entries.
   */
  getDefaultAvailabilityInput(): CreateAvailabilityInput_2024_04_15 {
    const startTime = new Date(new Date().setUTCHours(9, 0, 0, 0));
    const endTime = new Date(new Date().setUTCHours(17, 0, 0, 0));

    return {
      days: [1, 2, 3, 4, 5],
      startTime,
      endTime,
    };
  }
}
