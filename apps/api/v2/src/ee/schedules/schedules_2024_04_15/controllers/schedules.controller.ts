import { CreateScheduleOutput_2024_04_15 } from "@/ee/schedules/schedules_2024_04_15/outputs/create-schedule.output";
import { DeleteScheduleOutput_2024_04_15 } from "@/ee/schedules/schedules_2024_04_15/outputs/delete-schedule.output";
import { GetDefaultScheduleOutput_2024_04_15 } from "@/ee/schedules/schedules_2024_04_15/outputs/get-default-schedule.output";
import { GetScheduleOutput_2024_04_15 } from "@/ee/schedules/schedules_2024_04_15/outputs/get-schedule.output";
import { GetSchedulesOutput_2024_04_15 } from "@/ee/schedules/schedules_2024_04_15/outputs/get-schedules.output";
import { UpdateScheduleOutput_2024_04_15 } from "@/ee/schedules/schedules_2024_04_15/outputs/update-schedule.output";
import { SchedulesService_2024_04_15 } from "@/ee/schedules/schedules_2024_04_15/services/schedules.service";
import { VERSION_2024_04_15_VALUE } from "@/lib/api-versions";
import { GetUser } from "@/modules/auth/decorators/get-user/get-user.decorator";
import { Permissions } from "@/modules/auth/decorators/permissions/permissions.decorator";
import { ApiAuthGuard } from "@/modules/auth/guards/api-auth/api-auth.guard";
import { PermissionsGuard } from "@/modules/auth/guards/permissions/permissions.guard";
import { UserWithProfile } from "@/modules/users/users.repository";
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Patch,
  UseGuards,
} from "@nestjs/common";
import { ApiExcludeController as DocsExcludeController } from "@nestjs/swagger";

import { SCHEDULE_READ, SCHEDULE_WRITE, SUCCESS_STATUS } from "@calcom/platform-constants";
import { UpdateScheduleInput_2024_04_15 } from "@calcom/platform-types";

import { CreateScheduleInput_2024_04_15 } from "../inputs/create-schedule.input";

/**
 * Versioned NestJS REST controller for the April 15, 2024 enterprise schedule API.
 *
 * Routes HTTP requests for `/v2/schedules` to {@link SchedulesService_2024_04_15}.
 * Applies {@link ApiAuthGuard} and {@link PermissionsGuard} globally — all endpoints require
 * authentication and appropriate `SCHEDULE_READ`/`SCHEDULE_WRITE` permissions.
 * Hidden from Swagger documentation via `@DocsExcludeController(true)`.
 * Version-locked to {@link VERSION_2024_04_15_VALUE} — only clients sending the April 15, 2024
 * API version header reach these endpoints.
 */
@Controller({
  path: "/v2/schedules",
  version: VERSION_2024_04_15_VALUE,
})
@UseGuards(ApiAuthGuard, PermissionsGuard)
@DocsExcludeController(true)
export class SchedulesController_2024_04_15 {
  constructor(private readonly schedulesService: SchedulesService_2024_04_15) {}

  /**
   * Creates a new schedule for the authenticated user.
   *
   * @param user - The authenticated user with profile, injected via `@GetUser()`.
   * @param bodySchedule - The schedule creation input (name, timeZone, isDefault, optional availabilities).
   * @returns `CreateScheduleOutput_2024_04_15` with `SUCCESS_STATUS` and the created schedule data.
   * @remarks Requires `SCHEDULE_WRITE` permission.
   */
  @Post("/")
  @Permissions([SCHEDULE_WRITE])
  async createSchedule(
    @GetUser() user: UserWithProfile,
    @Body() bodySchedule: CreateScheduleInput_2024_04_15
  ): Promise<CreateScheduleOutput_2024_04_15> {
    const schedule = await this.schedulesService.createUserSchedule(user.id, bodySchedule);

    return {
      status: SUCCESS_STATUS,
      data: schedule,
    };
  }

  /**
   * Retrieves the authenticated user's default schedule.
   *
   * @param user - The authenticated user with profile.
   * @returns `GetDefaultScheduleOutput_2024_04_15` with `SUCCESS_STATUS` and the default schedule data, or null if no default exists.
   * @remarks Requires `SCHEDULE_READ` permission.
   */
  @Get("/default")
  @Permissions([SCHEDULE_READ])
  async getDefaultSchedule(
    @GetUser() user: UserWithProfile
  ): Promise<GetDefaultScheduleOutput_2024_04_15 | null> {
    const schedule = await this.schedulesService.getUserScheduleDefault(user.id);

    return {
      status: SUCCESS_STATUS,
      data: schedule,
    };
  }

  /**
   * Retrieves a specific schedule by ID for the authenticated user.
   *
   * @param user - The authenticated user with profile.
   * @param scheduleId - The schedule ID from the URL path parameter.
   * @returns `GetScheduleOutput_2024_04_15` with `SUCCESS_STATUS` and the schedule data.
   * @remarks Requires `SCHEDULE_READ` permission.
   */
  @Get("/:scheduleId")
  @Permissions([SCHEDULE_READ])
  async getSchedule(
    @GetUser() user: UserWithProfile,
    @Param("scheduleId") scheduleId: number
  ): Promise<GetScheduleOutput_2024_04_15> {
    const schedule = await this.schedulesService.getUserSchedule(user.id, scheduleId);

    return {
      status: SUCCESS_STATUS,
      data: schedule,
    };
  }

  /**
   * Retrieves all schedules for the authenticated user.
   *
   * @param user - The authenticated user with profile (provides timeZone and defaultScheduleId for enrichment).
   * @returns `GetSchedulesOutput_2024_04_15` with `SUCCESS_STATUS` and the list of schedules.
   * @remarks Requires `SCHEDULE_READ` permission.
   */
  @Get("/")
  @Permissions([SCHEDULE_READ])
  async getSchedules(@GetUser() user: UserWithProfile): Promise<GetSchedulesOutput_2024_04_15> {
    const schedules = await this.schedulesService.getUserSchedules(
      user.id,
      user.timeZone,
      user.defaultScheduleId
    );

    return {
      status: SUCCESS_STATUS,
      data: schedules,
    };
  }

  /**
   * Updates an existing schedule by ID for the authenticated user. Currently used by Atoms only.
   *
   * @param user - The authenticated user with profile.
   * @param bodySchedule - The schedule update input (partial fields).
   * @param scheduleId - The schedule ID from the URL path parameter (string, converted to number internally).
   * @returns `UpdateScheduleOutput_2024_04_15` with `SUCCESS_STATUS` and the updated schedule data.
   * @remarks Requires `SCHEDULE_WRITE` permission.
   */
  // note(Lauris): currently this endpoint is atoms only
  @Patch("/:scheduleId")
  @Permissions([SCHEDULE_WRITE])
  async updateSchedule(
    @GetUser() user: UserWithProfile,
    @Body() bodySchedule: UpdateScheduleInput_2024_04_15,
    @Param("scheduleId") scheduleId: string
  ): Promise<UpdateScheduleOutput_2024_04_15> {
    const updatedSchedule = await this.schedulesService.updateUserSchedule(
      user,
      Number(scheduleId),
      bodySchedule
    );

    return {
      status: SUCCESS_STATUS,
      data: updatedSchedule,
    };
  }

  /**
   * Deletes a schedule by ID for the authenticated user.
   *
   * @param userId - The authenticated user's ID, extracted via `@GetUser("id")`.
   * @param scheduleId - The schedule ID from the URL path parameter.
   * @returns `DeleteScheduleOutput_2024_04_15` with `SUCCESS_STATUS` (no data payload).
   * @remarks Requires `SCHEDULE_WRITE` permission. Uses `@HttpCode(HttpStatus.OK)` to standardize the success response code.
   */
  @Delete("/:scheduleId")
  @HttpCode(HttpStatus.OK)
  @Permissions([SCHEDULE_WRITE])
  async deleteSchedule(
    @GetUser("id") userId: number,
    @Param("scheduleId") scheduleId: number
  ): Promise<DeleteScheduleOutput_2024_04_15> {
    await this.schedulesService.deleteUserSchedule(userId, scheduleId);

    return {
      status: SUCCESS_STATUS,
    };
  }
}
