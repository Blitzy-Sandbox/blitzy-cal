import { ApiExtraModels, ApiProperty, getSchemaPath } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { ValidateNested } from "class-validator";

import { ApiResponseWithoutData, SlotsOutput_2024_09_04 } from "@calcom/platform-types";
import { RangeSlotsOutput_2024_09_04 } from "@calcom/platform-types";

/**
 * Canonical API v2 response envelope for the `GET /v2/slots` endpoint (version 2024-09-04).
 *
 * Extends {@link ApiResponseWithoutData} to inherit the shared response envelope fields
 * (status, metadata) while adding a polymorphic `data` payload specific to slot retrieval.
 *
 * The `data` field is a **polymorphic union** of:
 * - {@link SlotsOutput_2024_09_04} — map-based time slots keyed by date (used when
 *   the `format` query parameter is `SlotFormat.Time`)
 * - {@link RangeSlotsOutput_2024_09_04} — range-based slots with explicit start and end
 *   timestamps (used when the `format` query parameter is `SlotFormat.Range`)
 *
 * Decorator details:
 * - `@ApiExtraModels` registers both union variant classes with Swagger so that their
 *   `$ref` schema paths resolve correctly in the generated OpenAPI specification.
 * - `@ApiProperty({ oneOf: [...] })` combined with `getSchemaPath()` emits an OpenAPI
 *   `oneOf` discriminator in the generated spec, documenting the polymorphic nature
 *   of the `data` field.
 * - `@ValidateNested()` cascades class-validator constraints into whichever union
 *   variant is assigned at runtime, enabling deep validation of nested DTOs.
 * - `@Type(() => Object)` provides class-transformer metadata for the polymorphic
 *   field — since runtime typing cannot statically distinguish between the two union
 *   variants, it treats the payload as a generic object for serialization/deserialization.
 *
 * Consumed by `SlotsController_2024_09_04` for the GET available slots endpoint.
 */
@ApiExtraModels(SlotsOutput_2024_09_04, RangeSlotsOutput_2024_09_04)
export class GetSlotsOutput_2024_09_04 extends ApiResponseWithoutData {
  @ValidateNested()
  @ApiProperty({
    oneOf: [
      { $ref: getSchemaPath(SlotsOutput_2024_09_04) },
      { $ref: getSchemaPath(RangeSlotsOutput_2024_09_04) },
    ],
  })
  @Type(() => Object)
  data!: SlotsOutput_2024_09_04 | RangeSlotsOutput_2024_09_04;
}
