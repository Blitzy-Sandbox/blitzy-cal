import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsNotEmptyObject, ValidateNested } from "class-validator";

import {
  ApiResponseWithoutData,
  GetReservedSlotOutput_2024_09_04 as GetReservedSlotOutputType_2024_09_04,
} from "@calcom/platform-types";

/**
 * Canonical API v2 response envelope for the `GET /v2/slots/reservations/:uid` endpoint
 * (version 2024-09-04).
 *
 * Extends {@link ApiResponseWithoutData} to inherit the shared response envelope fields
 * (status, metadata) while adding a typed `data` payload specific to reserved-slot retrieval.
 *
 * ### `data` Field
 * Typed as `GetReservedSlotOutputType_2024_09_04 | null`:
 * - Returns the reserved slot details when a reservation exists for the given UID.
 * - Returns `null` when no reservation is found for the provided UID.
 *
 * ### Decorator Rationale
 * - `@ApiProperty({ type: GetReservedSlotOutputType_2024_09_04 })` — Ensures Swagger/OpenAPI
 *   correctly documents the nested schema in generated API documentation.
 * - `@IsNotEmptyObject()` — Prevents empty objects (`{}`) from passing validation when the
 *   `data` field is non-null, enforcing that a valid reservation payload is always populated.
 * - `@ValidateNested()` — Cascades class-validator constraints into the nested platform type,
 *   ensuring deep validation of the reservation data structure.
 * - `@Type(() => GetReservedSlotOutputType_2024_09_04)` — Enables class-transformer to
 *   instantiate the correct concrete type during deserialization of plain objects.
 *
 * ### Import Alias Note
 * The platform-types package exports its own `GetReservedSlotOutput_2024_09_04` which is
 * aliased here as `GetReservedSlotOutputType_2024_09_04` to avoid a naming collision with
 * this local DTO class that wraps the platform type in the API response envelope.
 */
export class GetReservedSlotOutput_2024_09_04 extends ApiResponseWithoutData {
  @ApiProperty({
    type: GetReservedSlotOutputType_2024_09_04,
  })
  @IsNotEmptyObject()
  @ValidateNested()
  @Type(() => GetReservedSlotOutputType_2024_09_04)
  data!: GetReservedSlotOutputType_2024_09_04 | null;
}
