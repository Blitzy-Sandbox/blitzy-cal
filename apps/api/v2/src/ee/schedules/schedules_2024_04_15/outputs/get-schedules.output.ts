import { ScheduleOutput } from "@/ee/schedules/schedules_2024_04_15/outputs/schedule.output";
import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsArray, IsEnum, IsNotEmptyObject, ValidateNested } from "class-validator";

import { SUCCESS_STATUS, ERROR_STATUS } from "@calcom/platform-constants";

/**
 * Response DTO for the enterprise "list all schedules" endpoint (API v2, version 2024-04-15).
 *
 * Wraps an array of {@link ScheduleOutput} in a standard `{ status, data }` envelope.
 * Each element in the `data` array is a complete schedule representation including
 * working hours, date overrides, and timezone configuration.
 */
export class GetSchedulesOutput_2024_04_15 {
  /** Indicates whether the operation succeeded or failed. */
  @ApiProperty({ example: SUCCESS_STATUS, enum: [SUCCESS_STATUS, ERROR_STATUS] })
  @IsEnum([SUCCESS_STATUS, ERROR_STATUS])
  status!: typeof SUCCESS_STATUS | typeof ERROR_STATUS;

  /** Array of all schedules belonging to the authenticated user. */
  @ApiProperty({
    type: ScheduleOutput,
  })
  @IsNotEmptyObject()
  @ValidateNested({ each: true })
  @Type(() => ScheduleOutput)
  @IsArray()
  data!: ScheduleOutput[];
}
