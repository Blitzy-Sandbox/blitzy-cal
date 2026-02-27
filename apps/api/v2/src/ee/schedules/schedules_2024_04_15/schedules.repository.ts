import { CreateAvailabilityInput_2024_04_15 } from "@/ee/schedules/schedules_2024_04_15/inputs/create-availability.input";
import { CreateScheduleInput_2024_04_15 } from "@/ee/schedules/schedules_2024_04_15/inputs/create-schedule.input";
import { PrismaReadService } from "@/modules/prisma/prisma-read.service";
import { PrismaWriteService } from "@/modules/prisma/prisma-write.service";
import { Injectable } from "@nestjs/common";
import type { Prisma } from "@calcom/prisma/client";


/**
 * Prisma-backed schedule repository for the April 15, 2024 versioned API.
 *
 * Enforces read/write separation via {@link PrismaReadService} (reads) and
 * {@link PrismaWriteService} (writes) to support read-replica database topologies.
 *
 * @remarks
 * Ownership enforcement is NOT handled in this repository — callers
 * (`SchedulesService_2024_04_15`) must validate ownership before invoking
 * any mutation methods such as {@link createScheduleWithAvailabilities} or
 * {@link deleteScheduleById}.
 *
 * Registered as a provider in `SchedulesModule_2024_04_15` and exported
 * for downstream service consumption.
 */
@Injectable()
export class SchedulesRepository_2024_04_15 {
  constructor(private readonly dbRead: PrismaReadService, private readonly dbWrite: PrismaWriteService) {}

  /**
   * Creates a new schedule with associated availability entries for a user.
   *
   * Builds a `Prisma.ScheduleCreateInput` connecting the schedule to the
   * specified user. When the `availabilities` array is non-empty, each entry
   * is mapped to a nested `createMany` record containing `days`, `startTime`,
   * `endTime`, and `userId`.
   *
   * @param userId - The owning user ID, used for `user.connect` and
   *   per-availability `userId` assignment.
   * @param schedule - The schedule creation input containing `name` and `timeZone`.
   * @param availabilities - Array of availability inputs. When non-empty, each is
   *   mapped to a nested `createMany` entry with `days`, `startTime`, `endTime`,
   *   and `userId`.
   * @returns The created schedule with eager-loaded availability rows.
   */
  async createScheduleWithAvailabilities(
    userId: number,
    schedule: CreateScheduleInput_2024_04_15,
    availabilities: CreateAvailabilityInput_2024_04_15[]
  ) {
    const createScheduleData: Prisma.ScheduleCreateInput = {
      user: {
        connect: {
          id: userId,
        },
      },
      name: schedule.name,
      timeZone: schedule.timeZone,
    };

    if (availabilities.length > 0) {
      createScheduleData.availability = {
        createMany: {
          data: availabilities.map((availability) => {
            return {
              days: availability.days,
              startTime: availability.startTime,
              endTime: availability.endTime,
              userId,
            };
          }),
        },
      };
    }

    const createdSchedule = await this.dbWrite.prisma.schedule.create({
      data: {
        ...createScheduleData,
      },
      include: {
        availability: true,
      },
    });

    return createdSchedule;
  }

  /**
   * Fetches a single schedule by ID with associated availability entries.
   *
   * Uses the read service (`PrismaReadService`) for read-replica safety.
   *
   * @param scheduleId - The unique identifier of the schedule to retrieve.
   * @returns The schedule with eager-loaded availability rows, or `null` if not found.
   */
  async getScheduleById(scheduleId: number) {
    const schedule = await this.dbRead.prisma.schedule.findUnique({
      where: {
        id: scheduleId,
      },
      include: {
        availability: true,
      },
    });

    return schedule;
  }

  /**
   * Fetches all schedules for a given user with associated availability entries.
   *
   * Uses the read service (`PrismaReadService`) for read-replica safety.
   *
   * @param userId - The user ID whose schedules should be retrieved.
   * @returns An array of schedules, each with eager-loaded availability rows.
   */
  async getSchedulesByUserId(userId: number) {
    const schedules = await this.dbRead.prisma.schedule.findMany({
      where: {
        userId,
      },
      include: {
        availability: true,
      },
    });

    return schedules;
  }

  /**
   * Deletes a schedule by its ID.
   *
   * Uses the write service (`PrismaWriteService`). The caller must validate
   * ownership before invoking this method — no permission checks are performed here.
   *
   * @param scheduleId - The unique identifier of the schedule to delete.
   * @returns The deleted schedule record.
   */
  async deleteScheduleById(scheduleId: number) {
    return this.dbWrite.prisma.schedule.delete({
      where: {
        id: scheduleId,
      },
    });
  }

  /**
   * Returns the count of schedules owned by a user.
   *
   * Lightweight count query using the read service (`PrismaReadService`)
   * for read-replica safety.
   *
   * @param userId - The user ID whose schedule count should be retrieved.
   * @returns The number of schedules owned by the specified user.
   */
  async getUserSchedulesCount(userId: number) {
    return this.dbRead.prisma.schedule.count({
      where: {
        userId,
      },
    });
  }
}
