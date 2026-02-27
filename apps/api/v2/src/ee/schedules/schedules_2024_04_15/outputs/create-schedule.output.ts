import { ScheduleOutput } from "@/ee/schedules/schedules_2024_04_15/outputs/schedule.output";
import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsEnum, IsNotEmptyObject, ValidateNested } from "class-validator";

import { SUCCESS_STATUS, ERROR_STATUS } from "@calcom/platform-constants";

/**
 * Response DTO for the enterprise schedule creation endpoint (API v2, version 2024-04-15).
 *
 * Wraps {@link ScheduleOutput} in a standard `{ status, data }` envelope used across
 * all Cal.com platform API v2 responses. Consumed by the NestJS controller layer for
 * automatic serialization, class-validator validation, and Swagger documentation generation.
 */
export class CreateScheduleOutput_2024_04_15 {
  /** Indicates the outcome of the schedule creation operation — either success or error. */
  @ApiProperty({ example: SUCCESS_STATUS, enum: [SUCCESS_STATUS, ERROR_STATUS] })
  @IsEnum([SUCCESS_STATUS, ERROR_STATUS])
  status!: typeof SUCCESS_STATUS | typeof ERROR_STATUS;

  /** The newly created schedule's full representation, including availability windows and metadata. */
  @ApiProperty({
    type: ScheduleOutput,
  })
  @IsNotEmptyObject()
  @ValidateNested()
  @Type(() => ScheduleOutput)
  data!: ScheduleOutput;
}
