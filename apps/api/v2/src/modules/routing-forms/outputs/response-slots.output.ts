import { ApiExtraModels, ApiProperty, ApiPropertyOptional, getSchemaPath } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsArray, IsBoolean, IsDateString, IsNumber, IsOptional, IsString, ValidateNested } from "class-validator";

import { ApiResponseWithoutData, SlotsOutput_2024_09_04 } from "@calcom/platform-types";
import { RangeSlotsOutput_2024_09_04 } from "@calcom/platform-types";

@ApiExtraModels(SlotsOutput_2024_09_04, RangeSlotsOutput_2024_09_04)
export class ResponseSlotsOutputData {
  @IsNumber()
  @ApiProperty()
  eventTypeId!: number;

  @ValidateNested()
  @ApiProperty({
    oneOf: [
      { $ref: getSchemaPath(SlotsOutput_2024_09_04) },
      { $ref: getSchemaPath(RangeSlotsOutput_2024_09_04) },
    ],
  })
  @Type(() => Object)
  slots!: SlotsOutput_2024_09_04 | RangeSlotsOutput_2024_09_04;
}

export class ResponseSlotsOutput extends ApiResponseWithoutData {
  @ValidateNested()
  @ApiProperty({
    type: ResponseSlotsOutputData,
  })
  @Type(() => ResponseSlotsOutputData)
  data!: ResponseSlotsOutputData;
}

export class RoutingFormFieldsOutput {
  @IsString()
  @ApiProperty({
    description: "Unique identifier for the field",
    example: "field-abc123",
  })
  id!: string;

  @IsString()
  @ApiProperty({
    description: "Field type — one of: text, number, textarea, select, multiselect, phone, email",
    example: "select",
    enum: ["text", "number", "textarea", "select", "multiselect", "phone", "email"],
  })
  type!: string;

  @IsString()
  @ApiProperty({
    description: "Display label for the field",
    example: "What sport are you interested in?",
  })
  label!: string;

  @IsBoolean()
  @ApiProperty({
    description: "Whether this field is required",
    example: true,
  })
  required!: boolean;

  @IsOptional()
  @IsArray()
  @ApiPropertyOptional({
    description: "Options for select and multiselect field types",
    type: [Object],
    example: [{ label: "Football", id: "opt-1" }, { label: "Basketball", id: "opt-2" }],
  })
  options?: { label: string; id: string | null }[];
}

export class RoutingFormOutputData {
  @IsString()
  @ApiProperty({
    description: "Unique identifier of the routing form",
    example: "clxxxxxxxxxxxxxxxxx",
  })
  id!: string;

  @IsString()
  @ApiProperty({
    description: "Name of the routing form",
    example: "Sport Selection Form",
  })
  name!: string;

  @IsOptional()
  @IsString()
  @ApiPropertyOptional({
    description: "Description of the routing form",
    example: "Select your preferred sport for scheduling",
  })
  description?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RoutingFormFieldsOutput)
  @ApiProperty({
    description: "Array of field definitions for the form",
    type: [RoutingFormFieldsOutput],
  })
  fields!: RoutingFormFieldsOutput[];

  @IsArray()
  @ApiProperty({
    description: "Array of route definitions with conditional logic and actions",
    type: [Object],
  })
  routes!: Record<string, unknown>[];

  @ApiProperty({
    description: "Form display and behavior settings",
    type: Object,
  })
  settings!: Record<string, unknown>;

  @IsOptional()
  @IsNumber()
  @ApiPropertyOptional({
    description: "Team ID the form is associated with",
    example: 42,
  })
  teamId?: number;

  @IsNumber()
  @ApiProperty({
    description: "User ID of the form owner",
    example: 101,
  })
  userId!: number;

  @IsBoolean()
  @ApiProperty({
    description: "Whether the form is disabled",
    example: false,
  })
  disabled!: boolean;

  @IsDateString()
  @ApiProperty({
    description: "ISO 8601 timestamp of form creation",
    example: "2025-01-15T10:30:00.000Z",
  })
  createdAt!: Date;

  @IsDateString()
  @ApiProperty({
    description: "ISO 8601 timestamp of last form update",
    example: "2025-03-20T14:00:00.000Z",
  })
  updatedAt!: Date;
}

export class RoutingFormOutput extends ApiResponseWithoutData {
  @ValidateNested()
  @ApiProperty({
    type: RoutingFormOutputData,
  })
  @Type(() => RoutingFormOutputData)
  data!: RoutingFormOutputData;
}

export class RoutingFormListOutput extends ApiResponseWithoutData {
  @ApiProperty({
    description: "Array of routing form objects",
    type: [RoutingFormOutputData],
  })
  @ValidateNested({ each: true })
  @Type(() => RoutingFormOutputData)
  data!: RoutingFormOutputData[];

  @IsBoolean()
  @ApiProperty({
    description: "Whether more results are available beyond this page",
    example: true,
  })
  hasMore!: boolean;

  @IsOptional()
  @IsString()
  @ApiPropertyOptional({
    description: "Cursor to pass as the 'cursor' query parameter to fetch the next page",
    example: "clxxxxxxxxxxxxxxxxx",
  })
  nextCursor?: string;
}

export class RoutingFormSubmissionOutputData {
  @IsString()
  @ApiProperty({
    description: "The ID of the routing form that was submitted",
    example: "clxxxxxxxxxxxxxxxxx",
  })
  formId!: string;

  @IsString()
  @ApiProperty({
    description: "The ID of the form response record",
    example: "resp-abc123",
  })
  responseId!: string;

  @ApiProperty({
    description:
      "Routing result describing where the submission was routed to — may be an event type redirect URL, custom page message, or external redirect URL",
    type: Object,
  })
  routedTo!: Record<string, unknown>;
}

export class RoutingFormSubmissionOutput extends ApiResponseWithoutData {
  @ValidateNested()
  @ApiProperty({
    type: RoutingFormSubmissionOutputData,
  })
  @Type(() => RoutingFormSubmissionOutputData)
  data!: RoutingFormSubmissionOutputData;
}
