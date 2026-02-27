import { ScheduleOutput } from "@/ee/schedules/schedules_2024_04_15/outputs/schedule.output";
import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsEnum, IsNotEmptyObject, ValidateNested } from "class-validator";

import { SUCCESS_STATUS, ERROR_STATUS } from "@calcom/platform-constants";

/**
 * Response DTO for the enterprise "get schedule by ID" endpoint (API v2, version 2024-04-15).
 * Wraps a single {@link ScheduleOutput} in a standard `{ status, data }` envelope.
 */
export class GetScheduleOutput_2024_04_15 {
  /** Indicates whether the operation succeeded or failed. */
  @ApiProperty({ example: SUCCESS_STATUS, enum: [SUCCESS_STATUS, ERROR_STATUS] })
  @IsEnum([SUCCESS_STATUS, ERROR_STATUS])
  status!: typeof SUCCESS_STATUS | typeof ERROR_STATUS;

  /** The requested schedule's full representation. */
  @ApiProperty({
    type: ScheduleOutput,
  })
  @IsNotEmptyObject()
  @ValidateNested()
  @Type(() => ScheduleOutput)
  data!: ScheduleOutput;
}
