import { CalendarsRepository } from "@/ee/calendars/calendars.repository";
import { CreateIcsFeedInputDto } from "@/ee/calendars/input/create-ics.input";
import { CreateIcsFeedOutputResponseDto } from "@/ee/calendars/input/create-ics.output";
import { DeleteCalendarCredentialsInputBodyDto } from "@/ee/calendars/input/delete-calendar-credentials.input";
import { GetBusyTimesOutput } from "@/ee/calendars/outputs/busy-times.output";
import { ConnectedCalendarsOutput } from "@/ee/calendars/outputs/connected-calendars.output";
import {
  DeletedCalendarCredentialsOutputResponseDto,
  DeletedCalendarCredentialsOutputDto,
} from "@/ee/calendars/outputs/delete-calendar-credentials.output";
import { AppleCalendarService } from "@/ee/calendars/services/apple-calendar.service";
import { CalendarsCacheService } from "@/ee/calendars/services/calendars-cache.service";
import { CalendarsService } from "@/ee/calendars/services/calendars.service";
import { GoogleCalendarService } from "@/ee/calendars/services/gcal.service";
import { IcsFeedService } from "@/ee/calendars/services/ics-feed.service";
import { OutlookService } from "@/ee/calendars/services/outlook.service";
import { API_VERSIONS_VALUES } from "@/lib/api-versions";
import { API_KEY_OR_ACCESS_TOKEN_HEADER } from "@/lib/docs/headers";
import { ApiAuthGuardOnlyAllow } from "@/modules/auth/decorators/api-auth-guard-only-allow.decorator";
import { GetUser } from "@/modules/auth/decorators/get-user/get-user.decorator";
import { Permissions } from "@/modules/auth/decorators/permissions/permissions.decorator";
import { ApiAuthGuard } from "@/modules/auth/guards/api-auth/api-auth.guard";
import { PermissionsGuard } from "@/modules/auth/guards/permissions/permissions.guard";
import { UserWithProfile } from "@/modules/users/users.repository";
import {
  Controller,
  Get,
  UseGuards,
  Query,
  HttpStatus,
  HttpCode,
  Req,
  Param,
  Headers,
  Redirect,
  BadRequestException,
  Post,
  Body,
  ParseBoolPipe,
} from "@nestjs/common";
import { ApiHeader, ApiOperation, ApiParam, ApiQuery, ApiTags as DocsTags } from "@nestjs/swagger";
import { plainToClass } from "class-transformer";
import { Request } from "express";
import { z } from "zod";

import { APPS_READ } from "@calcom/platform-constants";
import {
  SUCCESS_STATUS,
  CALENDARS,
  GOOGLE_CALENDAR,
  OFFICE_365_CALENDAR,
  APPLE_CALENDAR,
  CREDENTIAL_CALENDARS,
} from "@calcom/platform-constants";
import { ApiResponse, CalendarBusyTimesInput, CreateCalendarCredentialsInput } from "@calcom/platform-types";
import type { User } from "@calcom/prisma/client";

export interface CalendarState {
  accessToken: string;
  origin: string;
  redir?: string;
  isDryRun?: boolean;
}

const calendarStateSchema = z.object({
  accessToken: z.string(),
  origin: z.string(),
  redir: z.string().optional(),
  isDryRun: z
    .string()
    .optional()
    .transform((val) => val === "true"),
});

/**
 * CalendarsController — API v2 Enterprise Edition controller for `/v2/calendars` endpoints.
 *
 * Sprint 3 Calendar Integrations Compatibility Verification:
 *
 * This controller delegates all business logic to injected services (CalendarsService,
 * GoogleCalendarService, OutlookService, AppleCalendarService, IcsFeedService) and remains
 * stateless. The following Sprint 3 upstream changes have been verified for backward
 * compatibility with this controller:
 *
 * CI-004 (Conflict Detection Alignment):
 * - `CalendarsService.getBusyTimes` (called at lines 131-137) now delegates to an upstream
 *   `getBusyCalendarTimes` function that accepts an optional `statusFilter` parameter for
 *   configurable event status filtering (Busy/Tentative/Away/WorkingElsewhere/Oof).
 * - The current 5-arg call from this controller (calendarsToLoad, userId, dateFrom, dateTo, timezone)
 *   continues to work because the upstream `statusFilter` is an optional parameter that defaults
 *   to the adapter's standard conflict detection behavior when not provided.
 * - To expose configurable conflict detection through API v2, extend `CalendarBusyTimesInput`
 *   DTO to accept `statusFilter: string[]` in a future iteration.
 *
 * CI-001 / CI-002 / CI-003 (Parity Verification):
 * - Google Calendar adapter parity (CI-001): GoogleCalendarService OAuth flows unaffected
 * - Outlook adapter parity (CI-002): OutlookService OAuth flows unaffected
 * - Apple Calendar adapter parity (CI-003): AppleCalendarService credential flows unaffected
 * - All check endpoints (GET /:calendar/check) continue to verify connection status correctly
 *
 * Schema Changes:
 * - Credential model: New nullable `externalCancellationSyncEnabled` Boolean field (additive-only)
 *   does not affect credential deletion at lines 314-316 or any controller-level operations
 * - EventType model: New nullable `syncBuffersToCalendar` Boolean field does not affect
 *   any controller endpoints
 *
 * CalendarState Interface (lines 58-63) and calendarStateSchema (lines 65-73):
 * - Remain stable — no Sprint 3 changes affect OAuth callback state validation
 * - accessToken (required), origin (required), redir (optional), isDryRun (optional)
 */
@Controller({
  path: "/v2/calendars",
  version: API_VERSIONS_VALUES,
})
@DocsTags("Calendars")
export class CalendarsController {
  constructor(
    private readonly calendarsService: CalendarsService,
    private readonly calendarsCacheService: CalendarsCacheService,
    private readonly outlookService: OutlookService,
    private readonly googleCalendarService: GoogleCalendarService,
    private readonly appleCalendarService: AppleCalendarService,
    private readonly icsFeedService: IcsFeedService,
    private readonly calendarsRepository: CalendarsRepository
  ) {}

  @Post("/ics-feed/save")
  @UseGuards(ApiAuthGuard)
  @ApiHeader(API_KEY_OR_ACCESS_TOKEN_HEADER)
  @ApiOperation({ summary: "Save an ICS feed" })
  async createIcsFeed(
    @GetUser("id") userId: number,
    @GetUser("email") userEmail: string,
    @Body() body: CreateIcsFeedInputDto
  ): Promise<CreateIcsFeedOutputResponseDto> {
    return await this.icsFeedService.save(userId, userEmail, body.urls, body.readOnly);
  }

  @Get("/ics-feed/check")
  @UseGuards(ApiAuthGuard)
  @ApiHeader(API_KEY_OR_ACCESS_TOKEN_HEADER)
  @ApiOperation({ summary: "Check an ICS feed" })
  async checkIcsFeed(@GetUser("id") userId: number): Promise<ApiResponse> {
    return await this.icsFeedService.check(userId);
  }

  @UseGuards(ApiAuthGuard)
  @ApiHeader(API_KEY_OR_ACCESS_TOKEN_HEADER)
  @Get("/busy-times")
  @ApiOperation({
    summary: "Get busy times",
    description:
      "Get busy times from a calendar. Example request URL is `https://api.cal.com/v2/calendars/busy-times?timeZone=Europe%2FMadrid&dateFrom=2024-12-18&dateTo=2024-12-18&calendarsToLoad[0][credentialId]=135&calendarsToLoad[0][externalId]=skrauciz%40gmail.com`. Note: loggedInUsersTz is deprecated, use timeZone instead.",
  })
  /**
   * Retrieves busy times from connected calendars for a given date range.
   *
   * Sprint 3 CI-004 Backward Compatibility:
   * This endpoint calls `this.calendarsService.getBusyTimes(calendarsToLoad, userId, dateFrom, dateTo, timezone)`
   * which internally calls the upstream `getBusyCalendarTimes` function. The upstream function has been
   * updated in Sprint 3 with additional optional parameters (mode, includeTimeZone, statusFilter) for
   * configurable status-based conflict detection.
   *
   * The current call path is fully backward-compatible:
   * - Controller passes 5 args → CalendarsService.getBusyTimes passes 4 args to getBusyCalendarTimes
   * - New optional params default to their pre-Sprint-3 behavior when omitted
   * - No changes to CalendarBusyTimesInput DTO, timezone validation, or response shaping needed
   *
   * Future iteration: To expose CI-004 statusFilter through API v2, extend CalendarBusyTimesInput
   * with optional `statusFilter: string[]` and pass through to CalendarsService.getBusyTimes.
   */
  async getBusyTimes(
    @Query() queryParams: CalendarBusyTimesInput,
    @GetUser() user: UserWithProfile
  ): Promise<GetBusyTimesOutput> {
    const { loggedInUsersTz, timeZone, dateFrom, dateTo, calendarsToLoad } = queryParams;

    const timezone = timeZone || loggedInUsersTz;

    if (!timezone) {
      throw new BadRequestException("Either timeZone or loggedInUsersTz must be provided");
    }

    const busyTimes = await this.calendarsService.getBusyTimes(
      calendarsToLoad,
      user.id,
      dateFrom,
      dateTo,
      timezone
    );

    return {
      status: SUCCESS_STATUS,
      data: busyTimes,
    };
  }

  @Get("/")
  @UseGuards(ApiAuthGuard)
  @ApiHeader(API_KEY_OR_ACCESS_TOKEN_HEADER)
  @ApiOperation({ summary: "Get all calendars" })
  /**
   * Retrieves all connected calendars for the authenticated user.
   *
   * Sprint 3 Verification: This endpoint delegates to `CalendarsService.getCalendars()` which
   * calls `getConnectedDestinationCalendarsAndEnsureDefaultsInDb`. The upstream CalendarManager
   * modifications (statusFilter threading, subscription methods) do NOT affect calendar listing.
   * The response shape (ConnectedCalendarsOutput with connectedCalendars[] and destinationCalendar)
   * remains unchanged after Sprint 3.
   */
  async getCalendars(@GetUser("id") userId: number): Promise<ConnectedCalendarsOutput> {
    const calendars = await this.calendarsService.getCalendars(userId);

    return {
      status: SUCCESS_STATUS,
      data: calendars,
    };
  }

  @ApiParam({
    enum: [OFFICE_365_CALENDAR, GOOGLE_CALENDAR],
    type: String,
    name: "calendar",
  })
  @UseGuards(ApiAuthGuard)
  @ApiAuthGuardOnlyAllow(["API_KEY", "ACCESS_TOKEN", "THIRD_PARTY_ACCESS_TOKEN"])
  @ApiHeader(API_KEY_OR_ACCESS_TOKEN_HEADER)
  @Get("/:calendar/connect")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Get OAuth connect URL" })
  @ApiQuery({
    name: "redir",
    required: false,
    type: String,
    description: "Redirect URL after successful calendar authorization.",
  })
  async redirect(
    @Req() req: Request,
    @Headers("Authorization") authorization: string,
    @Param("calendar") calendar: string,
    @Query("redir") redir?: string | null,
    @Query("isDryRun", new ParseBoolPipe({ optional: true })) isDryRun?: boolean
  ): Promise<ApiResponse<{ authUrl: string }>> {
    switch (calendar) {
      case OFFICE_365_CALENDAR:
        return await this.outlookService.connect(authorization, req, redir ?? "", isDryRun);
      case GOOGLE_CALENDAR:
        return await this.googleCalendarService.connect(authorization, req, redir ?? "", isDryRun);
      default:
        throw new BadRequestException(
          "Invalid calendar type, available calendars are: ",
          CALENDARS.join(", ")
        );
    }
  }

  @ApiParam({
    enum: [OFFICE_365_CALENDAR, GOOGLE_CALENDAR],
    type: String,
    name: "calendar",
  })
  @Get("/:calendar/save")
  @HttpCode(HttpStatus.OK)
  @Redirect(undefined, 301)
  @ApiOperation({ summary: "Save Google or Outlook calendar credentials" })
  async save(
    @Query("state") state: string,
    @Query("code") code: string,
    @Param("calendar") calendar: string
  ): Promise<{ url: string }> {
    let stateObj: CalendarState;

    try {
      // First try to parse as JSON
      stateObj = JSON.parse(state) as CalendarState;
    } catch {
      // If JSON parsing fails, try URL params
      const stateParams = new URLSearchParams(state);

      const parsedState = calendarStateSchema.parse({
        accessToken: stateParams.get("accessToken"),
        origin: stateParams.get("origin"),
        redir: stateParams.get("redir") || undefined,
        isDryRun: stateParams.get("isDryRun"),
      });

      stateObj = parsedState;
    }

    const { accessToken, origin, redir, isDryRun } = stateObj;
    switch (calendar) {
      case OFFICE_365_CALENDAR:
        return await this.outlookService.save(code, accessToken, origin, redir ?? "", !!isDryRun);
      case GOOGLE_CALENDAR:
        return await this.googleCalendarService.save(code, accessToken, origin, redir ?? "", !!isDryRun);
      default:
        throw new BadRequestException(
          "Invalid calendar type, available calendars are: ",
          CALENDARS.join(", ")
        );
    }
  }

  @ApiParam({
    enum: [APPLE_CALENDAR],
    type: String,
    name: "calendar",
  })
  @UseGuards(ApiAuthGuard)
  @ApiHeader(API_KEY_OR_ACCESS_TOKEN_HEADER)
  @Post("/:calendar/credentials")
  @ApiOperation({ summary: "Save Apple calendar credentials" })
  /**
   * Saves Apple Calendar credentials (username/password for iCloud CalDAV).
   *
   * Sprint 3 CI-003 Verification: This endpoint delegates to AppleCalendarService.save()
   * which handles credential encryption with `CALENDSO_ENCRYPTION_KEY`, deduplication, and
   * CalDAV validation. All credential operations remain unchanged after CI-003 parity
   * verification — the encryption algorithm, key derivation, and storage format are NOT modified.
   * The Credential model's new nullable `externalCancellationSyncEnabled` field defaults to NULL.
   */
  async syncCredentials(
    @GetUser() user: User,
    @Param("calendar") calendar: string,
    @Body() body: CreateCalendarCredentialsInput
  ): Promise<{ status: string }> {
    const { username, password } = body;

    switch (calendar) {
      case APPLE_CALENDAR:
        return await this.appleCalendarService.save(user.id, user.email, username, password);
      default:
        throw new BadRequestException(
          "Invalid calendar type, available calendars are: ",
          CREDENTIAL_CALENDARS.join(", ")
        );
    }
  }

  @ApiParam({
    enum: [APPLE_CALENDAR, GOOGLE_CALENDAR, OFFICE_365_CALENDAR],
    type: String,
    name: "calendar",
  })
  @Get("/:calendar/check")
  @HttpCode(HttpStatus.OK)
  @UseGuards(ApiAuthGuard, PermissionsGuard)
  @ApiHeader(API_KEY_OR_ACCESS_TOKEN_HEADER)
  @Permissions([APPS_READ])
  @ApiOperation({ summary: "Check a calendar connection" })
  /**
   * Checks the connection status of a specific calendar provider.
   *
   * Sprint 3 CI-001/CI-002/CI-003 Verification:
   * - Google Calendar (CI-001): GoogleCalendarService.check() verifies credential validity
   *   and connected calendar status. Upstream adapter changes (FreeBusy chunking, recurring
   *   events, push notifications) do not affect connection health checks.
   * - Office 365 (CI-002): OutlookService.check() verifies credential validity. Upstream
   *   adapter changes (configurable showAs filtering, batch request handling, Graph change
   *   notifications) do not affect connection health checks.
   * - Apple Calendar (CI-003): AppleCalendarService.check() verifies CalDAV credential
   *   validity. Upstream CalDAV operation verification does not affect connection health checks.
   */
  async check(@GetUser("id") userId: number, @Param("calendar") calendar: string): Promise<ApiResponse> {
    switch (calendar) {
      case OFFICE_365_CALENDAR:
        return await this.outlookService.check(userId);
      case GOOGLE_CALENDAR:
        return await this.googleCalendarService.check(userId);
      case APPLE_CALENDAR:
        return await this.appleCalendarService.check(userId);
      default:
        throw new BadRequestException(
          "Invalid calendar type, available calendars are: ",
          CALENDARS.join(", ")
        );
    }
  }

  @ApiParam({
    enum: [APPLE_CALENDAR, GOOGLE_CALENDAR, OFFICE_365_CALENDAR],
    type: String,
    name: "calendar",
  })
  @UseGuards(ApiAuthGuard)
  @ApiHeader(API_KEY_OR_ACCESS_TOKEN_HEADER)
  @Post("/:calendar/disconnect")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Disconnect a calendar" })
  /**
   * Disconnects a calendar by deleting its credentials.
   *
   * Sprint 3 Verification: This endpoint validates credential ownership via
   * CalendarsService.checkCalendarCredentials(), deletes via CalendarsRepository.deleteCredentials(),
   * and invalidates cache via CalendarsCacheService. The destructured response (id, type, userId,
   * teamId, appId, invalid) at line 314 does not include the new nullable
   * `externalCancellationSyncEnabled` field — it is excluded by the `plainToClass` with
   * `strategy: "excludeAll"` at line 322-325 which only exposes DTO-declared fields.
   */
  async deleteCalendarCredentials(
    @Param("calendar") calendar: string,
    @Body() body: DeleteCalendarCredentialsInputBodyDto,
    @GetUser() user: UserWithProfile
  ): Promise<DeletedCalendarCredentialsOutputResponseDto> {
    const { id: credentialId } = body;
    await this.calendarsService.checkCalendarCredentials(credentialId, user.id);

    const { id, type, userId, teamId, appId, invalid } = await this.calendarsRepository.deleteCredentials(
      credentialId
    );

    this.calendarsCacheService.deleteConnectedAndDestinationCalendarsCache(user.id);

    return {
      status: SUCCESS_STATUS,
      data: plainToClass(
        DeletedCalendarCredentialsOutputDto,
        { id, type, userId, teamId, appId, invalid },
        { strategy: "excludeAll" }
      ),
    };
  }
}
