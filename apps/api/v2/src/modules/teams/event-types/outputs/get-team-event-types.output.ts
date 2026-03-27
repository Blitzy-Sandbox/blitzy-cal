import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { ValidateNested } from "class-validator";

import { ApiResponseWithoutData, TeamEventTypeOutput_2024_06_14 } from "@calcom/platform-types";

/**
 * Response DTO for listing team event types (GET /v2/teams/:teamId/event-types).
 *
 * Sprint 2 parity verification (ET-001 through ET-006):
 * - The `data` array contains `TeamEventTypeOutput_2024_06_14` items that correctly
 *   support mixed scheduling paradigm types within a single response. A team may have
 *   round-robin, collective, managed, and one-on-one event types simultaneously, and
 *   all are returned together in the same array.
 * - `@ValidateNested({ each: true })` ensures every item in the array is recursively
 *   validated against the `TeamEventTypeOutput_2024_06_14` class-validator decorators.
 * - `@Type(() => TeamEventTypeOutput_2024_06_14)` ensures class-transformer correctly
 *   deserializes each array element into a `TeamEventTypeOutput_2024_06_14` instance.
 * - Each item carries its own paradigm-specific fields: `schedulingType`, `hosts`,
 *   `assignAllTeamMembers`, `seatsPerTimeSlot`, `bookingFields`, `bookingLimits`,
 *   `periodType`, `periodDays`, `periodStartDate`, `periodEndDate`, etc.
 */
export class GetTeamEventTypesOutput extends ApiResponseWithoutData {
  @ApiProperty({
    description:
      "Array of team event types, each containing scheduling paradigm fields. Array may contain mixed paradigm types (round-robin, collective, managed, one-on-one).",
    type: [TeamEventTypeOutput_2024_06_14],
  })
  @ValidateNested({ each: true })
  @Type(() => TeamEventTypeOutput_2024_06_14)
  data!: TeamEventTypeOutput_2024_06_14[];
}
