import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { ValidateNested } from "class-validator";

import { ApiResponseWithoutData, TeamEventTypeOutput_2024_06_14 } from "@calcom/platform-types";

/**
 * Response DTO for retrieving a single team event type.
 *
 * Sprint 2 Event Type Parity Verification (ET-001 through ET-006):
 * The wrapped `TeamEventTypeOutput_2024_06_14` carries all paradigm-specific fields
 * required for complete event type detail responses.
 *
 * Fields verified present in `TeamEventTypeOutput_2024_06_14`:
 *  - `schedulingType` (roundRobin | collective | managed | null) — ET-001/ET-003/ET-004
 *  - `hosts: TeamEventTypeResponseHost[]` with userId, mandatory, priority, name, username, avatarUrl — ET-003 (RR host data)
 *  - `assignAllTeamMembers` — ET-003/ET-004
 *  - `rescheduleWithSameRoundRobinHost` — ET-003
 *  - `rrHostSubsetEnabled` (hidden) — ET-003
 *
 * Fields verified in `BaseEventTypeOutput_2024_06_14` (inherited):
 *  - `seatsPerTimeSlot`, `seatsShowAvailabilityCount` — ET-002 (Group events)
 *  - `bookingFields: OutputBookingField_2024_06_14[]` — ET-006 (Custom fields)
 *  - `bookingWindow`, `bookingLimitsCount`, `bookingLimitsDuration` — ET-005 (Booking windows)
 *  - `minimumBookingNotice`, `beforeEventBuffer`, `afterEventBuffer` — ET-005
 *
 * Known gaps in `@calcom/platform-types` (not this module's responsibility):
 *  - `isRRWeightsEnabled`, `rrSegmentQueryValue`, `assignRRMembersUsingSegment` not surfaced
 *  - `weight` / `isFixed` on Host not present in `TeamEventTypeResponseHost`
 */
export class GetTeamEventTypeOutput extends ApiResponseWithoutData {
  @ApiProperty({
    description:
      "Team event type data including scheduling paradigm fields (schedulingType, hosts with weights/priorities, seatsPerTimeSlot, bookingFields, booking windows, etc.)",
    type: () => TeamEventTypeOutput_2024_06_14,
  })
  @ValidateNested()
  @Type(() => TeamEventTypeOutput_2024_06_14)
  data!: TeamEventTypeOutput_2024_06_14;
}
