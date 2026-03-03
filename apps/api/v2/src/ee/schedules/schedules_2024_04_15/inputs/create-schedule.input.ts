import { CreateAvailabilityInput_2024_04_15 } from "@/ee/schedules/schedules_2024_04_15/inputs/create-availability.input";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsArray, IsBoolean, IsTimeZone, IsOptional, IsString, ValidateNested } from "class-validator";

/**
 * DTO for creating a new schedule in the April 15, 2024 versioned enterprise API (`VERSION_2024_04_15`).
 *
 * Validated by NestJS's `ValidationPipe` using class-validator decorators.
 * Swagger metadata is generated from `@ApiProperty` / `@ApiPropertyOptional` decorators
 * for OpenAPI documentation.
 *
 * The nested `availabilities` array uses `@Type(() => CreateAvailabilityInput_2024_04_15)`
 * from class-transformer to ensure correct deserialization and nested validation.
 */
export class CreateScheduleInput_2024_04_15 {
  /**
   * The human-readable name for the schedule (e.g., "Working Hours", "Weekend Availability").
   *
   * Required field. Validated as a non-empty string by `@IsString()`.
   */
  @IsString()
  @ApiProperty()
  name!: string;

  /**
   * The IANA timezone identifier for the schedule (e.g., "America/New_York", "Europe/London").
   *
   * Required field. Validated against the IANA timezone database by class-validator's
   * built-in `@IsTimeZone()` decorator.
   */
  @IsTimeZone()
  @ApiProperty()
  timeZone!: string;

  /**
   * Optional array of availability time slot entries defining the working hours for this schedule.
   *
   * When provided, each entry is validated as a `CreateAvailabilityInput_2024_04_15` instance
   * via `@ValidateNested({ each: true })`.
   *
   * `@Type(() => CreateAvailabilityInput_2024_04_15)` from class-transformer ensures correct
   * hydration of plain objects into class instances during the validation pipeline.
   *
   * When omitted, the service layer applies default availability (Mon-Fri 09:00-17:00 UTC).
   */
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateAvailabilityInput_2024_04_15)
  @IsOptional()
  @ApiPropertyOptional({ type: [CreateAvailabilityInput_2024_04_15] })
  availabilities?: CreateAvailabilityInput_2024_04_15[];

  /**
   * Whether this schedule should be set as the user's default schedule.
   *
   * Required boolean field. When `true`, the service updates the user's
   * `defaultScheduleId` to point to this schedule.
   */
  @IsBoolean()
  @ApiProperty()
  isDefault!: boolean;
}
