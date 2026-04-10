import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsArray, IsBoolean, IsNumber, IsOptional, IsString, ValidateNested } from "class-validator";

/**
 * Represents a single option for select/multiselect routing form fields.
 * Aligns with FieldOption from packages/features/routing-forms/lib/zod.ts:
 * { label: string; id: string | null }
 */
export class RoutingFormFieldOptionInput {
  @IsString()
  @ApiProperty({
    description: "Human-readable label for the option",
    example: "Football",
  })
  readonly label!: string;

  @IsOptional()
  @IsString()
  @ApiProperty({
    description: "Unique identifier for the option, null for legacy options",
    nullable: true,
    example: "opt-1",
  })
  readonly id!: string | null;
}

/**
 * Represents a single field definition within a routing form.
 * Aligns with zodNonRouterField from packages/features/routing-forms/lib/zod.ts.
 * Supported field types are defined in packages/app-store/routing-forms/lib/FieldTypes.ts:
 * text, number, textarea, select, multiselect, phone, email
 */
export class RoutingFormFieldInput {
  @IsString()
  @ApiProperty({
    description: "Unique identifier for the field",
    example: "field-1",
  })
  readonly id!: string;

  @IsString()
  @ApiProperty({
    description: "Display label for the field",
    example: "What sport?",
  })
  readonly label!: string;

  @IsString()
  @ApiProperty({
    description: "Field type — one of: text, number, textarea, select, multiselect, phone, email",
    example: "select",
    enum: ["text", "number", "textarea", "select", "multiselect", "phone", "email"],
  })
  readonly type!: string;

  @IsOptional()
  @IsString()
  @ApiPropertyOptional({
    description: "Machine-readable identifier for the field",
  })
  readonly identifier?: string;

  @IsOptional()
  @IsString()
  @ApiPropertyOptional({
    description: "Placeholder text for the field input",
  })
  readonly placeholder?: string;

  @IsOptional()
  @IsBoolean()
  @ApiPropertyOptional({
    description: "Whether the field is required",
    default: false,
  })
  readonly required?: boolean;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RoutingFormFieldOptionInput)
  @ApiPropertyOptional({
    description: "Options for select/multiselect fields",
    type: [RoutingFormFieldOptionInput],
  })
  readonly options?: RoutingFormFieldOptionInput[];
}

/**
 * Represents the action configuration for a routing form route.
 * Aligns with RouteActionType enum from packages/app-store/routing-forms/zod.ts:
 * customPageMessage, externalRedirectUrl, eventTypeRedirectUrl
 */
export class RoutingFormRouteActionInput {
  @IsString()
  @ApiProperty({
    description: "Route action type",
    enum: ["customPageMessage", "externalRedirectUrl", "eventTypeRedirectUrl"],
    example: "eventTypeRedirectUrl",
  })
  readonly type!: string;

  @IsOptional()
  @IsString()
  @ApiPropertyOptional({
    description: "Action value — custom message text, redirect URL, etc.",
  })
  readonly value?: string;

  @IsOptional()
  @IsNumber()
  @ApiPropertyOptional({
    description: "Event type ID to redirect to",
    example: 12345,
  })
  readonly eventTypeId?: number;
}

/**
 * Represents a single route definition within a routing form.
 * Aligns with zodNonRouterRoute from packages/app-store/routing-forms/zod.ts.
 * Routes define conditional matching logic (via RAQB queryValue) and
 * the action to perform when the route matches.
 */
export class RoutingFormRouteInput {
  @IsString()
  @ApiProperty({
    description: "Unique identifier for the route",
    example: "route-1",
  })
  readonly id!: string;

  @IsOptional()
  @IsBoolean()
  @ApiPropertyOptional({
    description: "Whether this is the fallback route",
    default: false,
  })
  readonly isFallback?: boolean;

  @ValidateNested()
  @Type(() => RoutingFormRouteActionInput)
  @ApiProperty({
    description: "Action to perform when route matches",
    type: RoutingFormRouteActionInput,
  })
  readonly action!: RoutingFormRouteActionInput;

  @IsOptional()
  @ApiPropertyOptional({
    description: "RAQB query value for route matching conditions",
  })
  readonly queryValue?: Record<string, unknown>;
}

/**
 * Input DTO for the POST /v2/routing-forms endpoint.
 * Validates the routing form creation payload including nested field
 * definitions and route definitions for conditional routing logic.
 */
export class CreateRoutingFormInput {
  @IsString()
  @ApiProperty({
    description: "Name of the routing form",
    example: "Sport Selection Form",
  })
  readonly name!: string;

  @IsOptional()
  @IsString()
  @ApiPropertyOptional({
    description: "Description of the routing form",
  })
  readonly description?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RoutingFormFieldInput)
  @ApiProperty({
    description: "Array of field definitions for the form",
    type: [RoutingFormFieldInput],
  })
  readonly fields!: RoutingFormFieldInput[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RoutingFormRouteInput)
  @ApiPropertyOptional({
    description: "Array of route definitions for conditional routing",
    type: [RoutingFormRouteInput],
  })
  readonly routes?: RoutingFormRouteInput[];

  @IsOptional()
  @IsNumber()
  @ApiPropertyOptional({
    description: "Team ID to associate the form with",
    example: 42,
  })
  readonly teamId?: number;

  @IsOptional()
  @IsBoolean()
  @ApiPropertyOptional({
    description: "Whether the form is disabled",
    default: false,
  })
  readonly disabled?: boolean;
}
