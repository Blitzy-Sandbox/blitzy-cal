import { ApiExtraModels, ApiProperty, getSchemaPath } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsNotEmptyObject, ValidateNested } from "class-validator";

import { ApiResponseWithoutData, TeamEventTypeOutput_2024_06_14 } from "@calcom/platform-types";

/**
 * Update team event type response DTO.
 *
 * Sprint 2 parity verification (ET-001 through ET-006): This output correctly handles
 * all 6 scheduling paradigms supported by Cal.com team event types.
 *
 * **Single response (non-MANAGED):**
 * Returned when updating one-on-one, group (seats), round-robin, or collective event types.
 * Contains a full `TeamEventTypeOutput_2024_06_14` with updated paradigm-specific fields:
 * - `schedulingType` — reflects the current scheduling type after update
 * - `hosts` — updated host list with `priority` and `mandatory` per host
 * - `assignAllTeamMembers` — reflects the toggle state after update
 * - `seatsPerTimeSlot` — reflects updated seat capacity for group events (ET-002)
 * - `bookingFields` — reflects updated custom booking fields (ET-006)
 * - `bookingWindow`, `minimumBookingNotice` — reflects updated booking windows (ET-005)
 * - `rescheduleWithSameRoundRobinHost` — reflects RR rescheduling preference (ET-003)
 *
 * **Array response (MANAGED):**
 * Returned when updating a managed scheduling type. The array contains the updated parent
 * event type followed by its updated children. Each child retains its own `schedulingType`
 * and paradigm-specific fields.
 *
 * **Update-specific behavior:**
 * The `TeamsEventTypesService.updateTeamEventType()` method reloads the event type from
 * `TeamsEventTypesRepository.getEventTypeById()` after the platform-libraries `updateEventType`
 * mutation, ensuring the response always reflects the latest persisted state including any
 * cascade effects from managed type propagation.
 *
 * **Known output gaps (outside this module's scope — in `@calcom/platform-types`):**
 * `isRRWeightsEnabled`, `rrSegmentQueryValue`, `assignRRMembersUsingSegment`, and
 * `weight`/`isFixed` on Host are not yet surfaced in `TeamEventTypeOutput_2024_06_14`.
 */
@ApiExtraModels(TeamEventTypeOutput_2024_06_14)
export class UpdateTeamEventTypeOutput extends ApiResponseWithoutData {
  @IsNotEmptyObject()
  @ValidateNested()
  @ApiProperty({
    description:
      "Updated team event type. Returns a single event type for standard updates (one-on-one, group/seats, round-robin, collective), " +
      "or an array containing the parent and child event types for managed scheduling type updates. " +
      "Each event type includes paradigm-specific fields: schedulingType, hosts (with priority/mandatory), " +
      "assignAllTeamMembers, seatsPerTimeSlot, bookingFields, booking windows, and more. " +
      "Updates to paradigm-specific fields (e.g., toggling assignAllTeamMembers, changing hosts weights/priorities, " +
      "modifying seatsPerTimeSlot, updating bookingFields) are reflected in the response.",
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
