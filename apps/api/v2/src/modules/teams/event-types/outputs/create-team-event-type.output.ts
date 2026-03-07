import { ApiExtraModels, ApiProperty, getSchemaPath } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsNotEmptyObject, ValidateNested } from "class-validator";

import { ApiResponseWithoutData, TeamEventTypeOutput_2024_06_14 } from "@calcom/platform-types";

/**
 * Output DTO for team event type creation endpoint.
 *
 * Sprint 2 Parity Verification (ET-001 through ET-006):
 * This response correctly handles all 6 scheduling paradigms supported by Cal.com.
 *
 * **Single response (non-MANAGED):**
 * Returned when creating one-on-one, group (seats), round-robin, or collective event types.
 * The `TeamEventTypeOutput_2024_06_14` includes paradigm-specific fields:
 * - `schedulingType`: null (1:1 — ET-001), "roundRobin" (ET-003), "collective" (ET-004)
 * - `hosts`: `TeamEventTypeResponseHost[]` with `userId`, `mandatory`, `priority`, `name`, `username`, `avatarUrl`
 * - `assignAllTeamMembers`: boolean for round-robin (ET-003) and collective (ET-004) auto-assignment
 * - `seatsPerTimeSlot`: number for group event capacity (ET-002)
 * - `bookingFields`: custom booking question configuration (ET-006)
 * - `bookingWindow` / `minimumBookingNotice`: booking window constraints (ET-005)
 * - `rescheduleWithSameRoundRobinHost`: boolean for round-robin reschedule behavior (ET-003)
 *
 * **Array response (MANAGED):**
 * Returned when creating managed scheduling type. Array contains the parent event type
 * followed by one child event type per assigned team member.
 *
 * **Known platform-types gaps (not in this module's scope):**
 * `isRRWeightsEnabled`, `rrSegmentQueryValue`, `assignRRMembersUsingSegment`, and
 * `weight`/`isFixed` on Host are NOT surfaced in `TeamEventTypeOutput_2024_06_14`.
 * These are gaps in `@calcom/platform-types`, tracked separately.
 */
@ApiExtraModels(TeamEventTypeOutput_2024_06_14)
export class CreateTeamEventTypeOutput extends ApiResponseWithoutData {
  @IsNotEmptyObject()
  @ValidateNested()
  @ApiProperty({
    description:
      "Created team event type. Returns a single event type for standard creation (one-on-one, group/seats, round-robin, collective), " +
      "or an array containing the parent and child event types for managed scheduling type creation. " +
      "Each event type includes paradigm-specific fields: schedulingType, hosts (with priority/mandatory), " +
      "assignAllTeamMembers, seatsPerTimeSlot, bookingFields, booking windows, and more.",
    oneOf: [
      { $ref: getSchemaPath(TeamEventTypeOutput_2024_06_14) },
      {
        type: "array",
        items: { $ref: getSchemaPath(TeamEventTypeOutput_2024_06_14) },
      },
    ],
  })
  @Type(() => TeamEventTypeOutput_2024_06_14)
  data!: TeamEventTypeOutput_2024_06_14 | TeamEventTypeOutput_2024_06_14[];
}
