import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { ValidateNested } from "class-validator";

import { ApiResponseWithoutData, TeamEventTypeOutput_2024_06_14 } from "@calcom/platform-types";

/**
 * Sprint 2 parity verification (ET-001 through ET-006):
 * Delete response intentionally returns only `id` and `title` — no paradigm-specific fields
 * are needed in the delete response. This is confirmed for all 6 scheduling paradigms:
 * one-on-one (schedulingType: null), group (seatsPerTimeSlot), round-robin (ROUND_ROBIN),
 * collective (COLLECTIVE), managed (MANAGED), and dynamic.
 *
 * `Pick<TeamEventTypeOutput_2024_06_14, "id" | "title">` is correct for all scheduling types.
 */
export class DeleteTeamEventTypeOutput extends ApiResponseWithoutData {
  @ApiProperty({
    description: "Deleted team event type identifier and title",
    type: "object",
    properties: {
      id: { type: "number", example: 1 },
      title: { type: "string", example: "Team Meeting" },
    },
  })
  @ValidateNested()
  @Type(() => TeamEventTypeOutput_2024_06_14)
  data!: Pick<TeamEventTypeOutput_2024_06_14, "id" | "title">;
}
