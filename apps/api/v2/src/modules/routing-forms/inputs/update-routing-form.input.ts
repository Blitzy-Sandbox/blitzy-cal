import { ApiPropertyOptional, PartialType } from "@nestjs/swagger";
import { IsObject, IsOptional } from "class-validator";

import { CreateRoutingFormInput } from "./create-routing-form.input";

/**
 * Input DTO for the PATCH /v2/routing-forms/:routingFormId endpoint.
 * Extends CreateRoutingFormInput with all properties made optional via PartialType,
 * plus an additional `settings` property for form display and behavior configuration.
 *
 * @see RF-004 — API v2 Routing Forms CRUD parity with Calendly
 */
export class UpdateRoutingFormInput extends PartialType(CreateRoutingFormInput) {
  @IsOptional()
  @IsObject()
  @ApiPropertyOptional({
    description: "Form display and behavior settings",
    type: "object",
    example: { emailOwnerOnSubmission: true },
  })
  readonly settings?: Record<string, unknown>;
}
