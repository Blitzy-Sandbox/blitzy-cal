import { UpdatedScheduleOutput_2024_04_15 } from "@/ee/schedules/schedules_2024_04_15/outputs/schedule-updated.output";
import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsEnum, IsNotEmptyObject, ValidateNested } from "class-validator";

import { SUCCESS_STATUS, ERROR_STATUS } from "@calcom/platform-constants";

/**
 * Response DTO for the enterprise schedule update endpoint (API v2, version 2024-04-15).
 *
 * Wraps {@link UpdatedScheduleOutput_2024_04_15} in a standard `{ status, data }` envelope.
 * The `data` payload includes the updated schedule model, default-flag changes,
 * and timezone metadata.
 */
export class UpdateScheduleOutput_2024_04_15 {
  /** Indicates the outcome of the update operation (`SUCCESS_STATUS` or `ERROR_STATUS`). */
  @ApiProperty({ example: SUCCESS_STATUS, enum: [SUCCESS_STATUS, ERROR_STATUS] })
  @IsEnum([SUCCESS_STATUS, ERROR_STATUS])
  status!: typeof SUCCESS_STATUS | typeof ERROR_STATUS;

  /** The updated schedule details, including default schedule transition metadata. */
  @ApiProperty({
    type: UpdatedScheduleOutput_2024_04_15,
  })
  @IsNotEmptyObject()
  @ValidateNested()
  @Type(() => UpdatedScheduleOutput_2024_04_15)
  data!: UpdatedScheduleOutput_2024_04_15;
}
