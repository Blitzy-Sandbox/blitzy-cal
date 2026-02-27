import {
  SUCCESS_STATUS,
  VERSION_2024_04_15,
  VERSION_2024_06_11,
  VERSION_2024_06_14,
  VERSION_2024_08_13,
} from "@calcom/platform-constants";
import { TRPCError } from "@calcom/platform-libraries";
import {
  ApiResponse,
  GetAvailableSlotsInput_2024_04_15,
  RemoveSelectedSlotInput_2024_04_15,
  ReserveSlotInput_2024_04_15,
} from "@calcom/platform-types";
import { BadRequestException, Body, Controller, Delete, Get, Post, Query, Req, Res } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiExcludeController as DocsExcludeController,
} from "@nestjs/swagger";
import { Request as ExpressRequest, Response as ExpressResponse } from "express";
import { TRPC_ERROR_CODE, TRPC_ERROR_MAP, TRPCErrorCode } from "@/filters/trpc-exception.filter";
import { AvailableSlotsService } from "@/lib/services/available-slots.service";
import { SlotsService_2024_04_15 } from "@/modules/slots/slots-2024-04-15/services/slots.service";
import type { RangeSlots, TimeSlots } from "@/modules/slots/slots-2024-04-15/services/slots-output.service";
import { SlotsOutputService_2024_04_15 } from "@/modules/slots/slots-2024-04-15/services/slots-output.service";
import { SlotsWorkerService_2024_04_15 } from "@/modules/slots/slots-2024-04-15/services/slots-worker.service";

/**
 * Slots controller for the Cal.com Platform API v2.
 *
 * Handles slot reservation, deletion, and availability queries for the `/v2/slots` endpoint path.
 *
 * @remarks
 * **Versioning Strategy:**
 * Routes are served across 4 API versions: `VERSION_2024_04_15`, `VERSION_2024_06_11`,
 * `VERSION_2024_06_14`, and `VERSION_2024_08_13`.
 *
 * **Injected Dependencies:**
 * 1. {@link SlotsService_2024_04_15} — slot reservation persistence and team-event detection
 * 2. {@link ConfigService} — feature flag access (`e2e`, `enableSlotsWorkers`)
 * 3. {@link SlotsOutputService_2024_04_15} — response normalization (time vs range format)
 * 4. {@link SlotsWorkerService_2024_04_15} — worker-based slot computation path
 * 5. {@link AvailableSlotsService} — synchronous slot computation path (extends
 *    `BaseAvailableSlotsService` from `@calcom/platform-libraries/slots`)
 *
 * **Endpoints:**
 * - `POST /reserve` — Reserve a slot for booking
 * - `DELETE /selected-slot` — Remove a previously reserved slot
 * - `GET /available` — Retrieve available time slots for an event type
 *
 * **Cookie Management:**
 * `reserveSlot` sets a `uid` cookie via `res.cookie("uid", uid)` using `@Res({ passthrough: true })`.
 * `deleteSelectedSlot` reads the UID from `req.cookies?.uid`, falling back to `params.uid`.
 *
 * **Worker/Sync Toggle:**
 * `getAvailableSlots` checks `config.get<boolean>("e2e")` and `config.get<boolean>("enableSlotsWorkers")`.
 * When E2E mode is active or workers are disabled, the synchronous `availableSlotsService.getAvailableSlots`
 * path is used; otherwise, computation delegates to `slotsWorkerService.getAvailableSlotsInWorker`.
 *
 * **Error Mapping:**
 * The catch block in `getAvailableSlots` maps `"Invalid time range given"` to `BadRequestException`,
 * and recognized TRPC error codes (via `TRPC_ERROR_MAP`) to `TRPCError`. All other errors are rethrown.
 *
 * **Documentation:** `@DocsExcludeController(true)` hides this controller from Swagger/OpenAPI docs.
 *
 * **Authorization:** No explicit guard decorators — relies on module-level guards for authentication
 * and authorization enforcement.
 */
@Controller({
  path: "/v2/slots",
  version: [VERSION_2024_04_15, VERSION_2024_06_11, VERSION_2024_06_14, VERSION_2024_08_13],
})
@DocsExcludeController(true)
export class SlotsController_2024_04_15 {
  constructor(
    private readonly slotsService: SlotsService_2024_04_15,
    private readonly config: ConfigService,
    private readonly slotsOutputService: SlotsOutputService_2024_04_15,
    private readonly slotsWorkerService: SlotsWorkerService_2024_04_15,
    private readonly availableSlotsService: AvailableSlotsService
  ) {}

  @Post("/reserve")
  @ApiCreatedResponse({
    description: "Successful response returning uid of reserved slot.",
    schema: {
      type: "object",
      properties: {
        status: { type: "string", example: "success" },
        data: {
          type: "object",
          properties: {
            uid: { type: "string", example: "e2a7bcf9-cc7b-40a0-80d3-657d391775a6" },
          },
        },
      },
    },
  })
  @ApiOperation({ summary: "Reserve a slot" })
  /**
   * Reserves a time slot for a potential booking.
   *
   * @remarks
   * **Endpoint:** `POST /v2/slots/reserve`
   *
   * Accepts a {@link ReserveSlotInput_2024_04_15} body containing `eventTypeId`,
   * `slotUtcStartDate`, and `slotUtcEndDate`. Reads an existing `uid` from
   * `req.cookies?.uid` for slot reuse (update scenario). On success, sets a
   * `uid` cookie on the response for subsequent requests (e.g., confirming the booking
   * or deleting the reserved slot).
   *
   * **Swagger:** Decorated with `@ApiCreatedResponse` showing `{ status, data: { uid } }`.
   *
   * @param body - The slot reservation payload with event type and UTC time boundaries
   * @param res - Express response used to set the `uid` cookie (passthrough mode)
   * @param req - Express request used to read existing `uid` cookie
   * @returns An {@link ApiResponse} containing the reserved slot UID string
   */
  async reserveSlot(
    @Body() body: ReserveSlotInput_2024_04_15,
    @Res({ passthrough: true }) res: ExpressResponse,
    @Req() req: ExpressRequest
  ): Promise<ApiResponse<string>> {
    const uid = await this.slotsService.reserveSlot(body, req.cookies?.uid);

    res.cookie("uid", uid);
    return {
      status: SUCCESS_STATUS,
      data: uid,
    };
  }

  @Delete("/selected-slot")
  @ApiOkResponse({
    description: "Response deleting reserved slot by uid.",
    schema: {
      type: "object",
      properties: {
        status: { type: "string", example: "success" },
      },
    },
  })
  @ApiOperation({ summary: "Delete a selected slot" })
  /**
   * Deletes a previously reserved time slot.
   *
   * @remarks
   * **Endpoint:** `DELETE /v2/slots/selected-slot`
   *
   * Reads the `uid` from cookies first (`req.cookies?.uid`), falling back to the
   * query parameter (`params.uid`). Delegates to `slotsService.deleteSelectedslot(uid)`
   * (note: lowercase 's' in `deleteSelectedslot` is intentional — existing API contract).
   *
   * **Swagger:** Decorated with `@ApiOkResponse` showing `{ status: SUCCESS_STATUS }`.
   *
   * @param params - Query parameters containing an optional `uid` fallback
   * @param req - Express request used to read the `uid` cookie
   * @returns An {@link ApiResponse} with status only (no data payload)
   */
  async deleteSelectedSlot(
    @Query() params: RemoveSelectedSlotInput_2024_04_15,
    @Req() req: ExpressRequest
  ): Promise<ApiResponse> {
    const uid = req.cookies?.uid || params.uid;

    await this.slotsService.deleteSelectedslot(uid);

    return {
      status: SUCCESS_STATUS,
    };
  }

  @Get("/available")
  @ApiOkResponse({
    description: "Available time slots retrieved successfully",
    schema: {
      type: "object",
      properties: {
        status: { type: "string", example: "success" },
        data: {
          type: "object",
          properties: {
            slots: {
              type: "object",
              additionalProperties: {
                type: "array",
                items: {
                  type: "object",
                  oneOf: [
                    {
                      properties: {
                        time: {
                          type: "string",
                          format: "date-time",
                          example: "2024-09-25T08:00:00.000Z",
                        },
                      },
                    },
                    {
                      properties: {
                        startTime: {
                          type: "string",
                          format: "date-time",
                          example: "2024-09-25T08:00:00.000Z",
                        },
                        endTime: {
                          type: "string",
                          format: "date-time",
                          example: "2024-09-25T08:30:00.000Z",
                        },
                      },
                    },
                  ],
                },
              },
            },
          },
        },
      },
      example: {
        status: "success",
        data: {
          slots: {
            // Default format (when slotFormat is 'time' or not provided)
            "2024-09-25": [{ time: "2024-09-25T08:00:00.000Z" }, { time: "2024-09-25T08:15:00.000Z" }],
            // Alternative format (when slotFormat is 'range')
            "2024-09-26": [
              {
                startTime: "2024-09-26T08:00:00.000Z",
                endTime: "2024-09-26T08:30:00.000Z",
              },
              {
                startTime: "2024-09-26T08:15:00.000Z",
                endTime: "2024-09-26T08:45:00.000Z",
              },
            ],
          },
        },
      },
    },
  })
  @ApiOperation({ summary: "Get available slots" })
  /**
   * Retrieves available time slots for a given event type within a date range.
   *
   * @remarks
   * **Endpoint:** `GET /v2/slots/available`
   *
   * Accepts {@link GetAvailableSlotsInput_2024_04_15} query parameters including
   * `eventTypeId`, `startTime`, `endTime`, `timeZone`, `slotFormat`, `eventTypeSlug`,
   * `usernameList`, `routingFormResponseId`, and `_isDryRun`.
   *
   * **Team Event Resolution:** If `isTeamEvent` is not provided in the query, it is
   * resolved via `slotsService.checkIfIsTeamEvent(query.eventTypeId)`.
   *
   * **Worker/Sync Toggle:** Uses `availableSlotsService.getAvailableSlots` (synchronous)
   * when E2E mode is active (`config.get<boolean>("e2e")`) or workers are explicitly
   * disabled (`!config.get<boolean>("enableSlotsWorkers")`). Otherwise, delegates to
   * `slotsWorkerService.getAvailableSlotsInWorker` for worker-based computation.
   *
   * **Output Normalization:** Raw slot data is passed through
   * `slotsOutputService.getOutputSlots` for time vs range format conversion based on
   * the `slotFormat` query parameter.
   *
   * **Error Handling:** Catches `Error` instances and maps `"Invalid time range given"`
   * to `BadRequestException`. Recognized TRPC error codes (via `TRPC_ERROR_MAP`) are
   * mapped to `TRPCError`. All other errors are rethrown as-is.
   *
   * **Swagger:** Decorated with `@ApiOkResponse` using a `oneOf` schema for time-format
   * and range-format slot representations.
   *
   * @param query - The availability query parameters (event type, date range, timezone, format)
   * @param req - Express request forwarded to the slot computation context
   * @returns An {@link ApiResponse} containing slots in either time or range format
   * @throws {BadRequestException} When the provided time range is invalid
   * @throws {TRPCError} When the underlying service raises a recognized TRPC error code
   */
  async getAvailableSlots(
    @Query() query: GetAvailableSlotsInput_2024_04_15,
    @Req() req: ExpressRequest
  ): Promise<ApiResponse<{ slots: TimeSlots["slots"] | RangeSlots["slots"] }>> {
    try {
      const isTeamEvent =
        query.isTeamEvent ?? (await this.slotsService.checkIfIsTeamEvent(query.eventTypeId));

      // Do not use workers in E2E, not supported by TS-JEST
      // Or if explicitly disabled via specific env var
      const shouldUseAvailableSlotsService =
        this.config.get<boolean>("e2e") || !this.config.get<boolean>("enableSlotsWorkers");
      const slotsArgs = {
        input: {
          ...query,
          isTeamEvent,
        },
        ctx: {
          req,
        },
      };

      let availableSlots: TimeSlots;

      if (shouldUseAvailableSlotsService) {
        availableSlots = await this.availableSlotsService.getAvailableSlots(slotsArgs);
      } else {
        availableSlots = await this.slotsWorkerService.getAvailableSlotsInWorker(slotsArgs);
      }

      const { slots } = await this.slotsOutputService.getOutputSlots(
        availableSlots,
        query.duration,
        query.eventTypeId,
        query.slotFormat,
        query.timeZone
      );

      return {
        data: {
          slots,
        },
        status: SUCCESS_STATUS,
      };
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes("Invalid time range given")) {
          throw new BadRequestException(
            "Invalid time range given - check the 'startTime' and 'endTime' query parameters."
          );
        }

        if (TRPC_ERROR_MAP[error.message as keyof typeof TRPC_ERROR_CODE]) {
          throw new TRPCError({ code: error.message as TRPCErrorCode });
        }
      }

      throw error;
    }
  }
}
