import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsNotEmptyObject, ValidateNested } from "class-validator";

import {
  ApiResponseWithoutData,
  ReserveSlotOutput_2024_09_04 as ReserveSlotOutputType_2024_09_04,
} from "@calcom/platform-types";

/**
 * Canonical API v2 response envelope for the `POST /v2/slots/reservations` endpoint
 * (version 2024-09-04).
 *
 * Extends {@link ApiResponseWithoutData} to inherit the shared response envelope
 * fields (status, metadata) while adding a strongly-typed `data` payload.
 *
 * The `data` field is typed as {@link ReserveSlotOutputType_2024_09_04} and is
 * non-nullable — successful slot reservations always produce a result containing:
 *   - `reservationUid` — unique identifier for the reservation hold
 *   - `reservationUntil` — ISO-8601 timestamp when the hold expires
 *   - `slotStart` — ISO-8601 start of the reserved time slot
 *   - `slotEnd` — ISO-8601 end of the reserved time slot
 *   - `slotDuration` — duration of the slot in minutes
 *   - `reservationDuration` — duration of the reservation hold in minutes
 *
 * Decorator responsibilities:
 *   - `@ApiProperty({ type: ReserveSlotOutputType_2024_09_04 })` — ensures
 *     Swagger/OpenAPI correctly documents the nested schema in generated specs.
 *   - `@ValidateNested()` — cascades class-validator constraints into the nested
 *     platform type so that each nested field is validated at runtime.
 *   - `@Type(() => ReserveSlotOutputType_2024_09_04)` — enables class-transformer
 *     to instantiate the correct type during deserialization (plain → class).
 *   - `@IsNotEmptyObject()` — prevents empty objects from passing validation,
 *     guaranteeing the response payload is substantive.
 *
 * Note: The import alias maps `ReserveSlotOutput_2024_09_04` from
 * `@calcom/platform-types` to `ReserveSlotOutputType_2024_09_04` locally, avoiding
 * a naming collision with this response wrapper class.
 *
 * Constructed by `SlotsOutputService_2024_09_04.getReservationSlotCreated()` and
 * returned by `SlotsController_2024_09_04.reserveSlot()`.
 */
export class ReserveSlotOutputResponse_2024_09_04 extends ApiResponseWithoutData {
  @ApiProperty({
    type: ReserveSlotOutputType_2024_09_04,
  })
  @IsNotEmptyObject()
  @ValidateNested()
  @Type(() => ReserveSlotOutputType_2024_09_04)
  data!: ReserveSlotOutputType_2024_09_04;
}
