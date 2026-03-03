import { ApiProperty } from "@nestjs/swagger";
import { IsEnum } from "class-validator";

import { SUCCESS_STATUS, ERROR_STATUS } from "@calcom/platform-constants";

/**
 * Response DTO for the enterprise schedule deletion endpoint (API v2, version 2024-04-15).
 *
 * Contains only a status field indicating whether the deletion succeeded or failed.
 * No data payload is returned since delete operations do not produce an entity.
 */
export class DeleteScheduleOutput_2024_04_15 {
  /**
   * Operation result indicator. Returns {@link SUCCESS_STATUS} when the schedule
   * was deleted successfully, or {@link ERROR_STATUS} if the deletion failed.
   */
  @ApiProperty({ example: SUCCESS_STATUS, enum: [SUCCESS_STATUS, ERROR_STATUS] })
  @IsEnum([SUCCESS_STATUS, ERROR_STATUS])
  status!: typeof SUCCESS_STATUS | typeof ERROR_STATUS;
}
