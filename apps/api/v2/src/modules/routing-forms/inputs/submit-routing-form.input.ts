import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsDefined, IsObject, IsOptional, IsString } from "class-validator";

/**
 * Represents a single field's response value within a routing form submission.
 * Aligns with the value schema from routingFormResponseInDbSchema in
 * packages/features/routing-forms/lib/zod.ts:
 *   z.object({ label: z.string().optional(), value: z.union([z.string(), z.number(), z.array(z.string())]) })
 *
 * The value property accepts string (TEXT, TEXTAREA, EMAIL, PHONE, SINGLE_SELECT),
 * number (NUMBER), or string[] (MULTI_SELECT) to cover all routing form field types
 * defined in packages/app-store/routing-forms/lib/FieldTypes.ts.
 */
export class RoutingFormResponseValueDto {
  @IsDefined()
  @ApiProperty({
    description: "Response value — text string, number, or array of strings for multi-select",
    oneOf: [{ type: "string" }, { type: "number" }, { type: "array", items: { type: "string" } }],
  })
  readonly value!: string | number | string[];

  @IsOptional()
  @IsString()
  @ApiPropertyOptional({
    description: "Human-readable label for the response field",
  })
  readonly label?: string;
}

/**
 * Input DTO for the POST /v2/routing-forms/:routingFormId/submit endpoint.
 * Validates the routing form submission payload containing field responses
 * keyed by fieldId.
 *
 * The responses record aligns with routingFormResponseInDbSchema from
 * packages/features/routing-forms/lib/zod.ts:
 *   z.record(z.object({ label: z.string().optional(), value: z.union([z.string(), z.number(), z.array(z.string())]) }))
 *
 * Each key in the record is a field ID (string), and each value is a
 * RoutingFormResponseValueDto containing the response value and an optional label.
 */
export class SubmitRoutingFormInput {
  @IsObject()
  @Type(() => RoutingFormResponseValueDto)
  @ApiProperty({
    description: "Map of field IDs to response values",
    type: "object",
    additionalProperties: {
      type: "object",
      properties: {
        value: {
          oneOf: [{ type: "string" }, { type: "number" }, { type: "array", items: { type: "string" } }],
        },
        label: { type: "string" },
      },
    },
  })
  readonly responses!: Record<string, RoutingFormResponseValueDto>;
}
