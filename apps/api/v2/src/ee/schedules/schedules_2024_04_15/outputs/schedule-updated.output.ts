import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsBoolean, IsInt, IsOptional, IsString, ValidateNested, IsArray } from "class-validator";

/**
 * Nested model representing an event type reference within a schedule update response.
 * Contains the event type ID and optional display name.
 */
class EventTypeModel_2024_04_15 {
  @IsInt()
  @ApiProperty()
  id!: number;

  @IsOptional()
  @IsString()
  @ApiPropertyOptional({ type: String, nullable: true })
  eventName?: string | null;
}

/**
 * Nested model representing an availability entry within a schedule update response.
 * Contains day-of-week arrays, optional time boundaries, and relationship IDs.
 */
class AvailabilityModel_2024_04_15 {
  @IsInt()
  @ApiProperty()
  id!: number;

  @IsOptional()
  @IsInt()
  @ApiPropertyOptional({ type: Number, nullable: true })
  userId?: number | null;

  @IsOptional()
  @IsInt()
  @ApiPropertyOptional({ type: Number, nullable: true })
  scheduleId?: number | null;

  @IsOptional()
  @IsInt()
  @ApiPropertyOptional({ type: Number, nullable: true })
  eventTypeId?: number | null;

  @IsArray()
  @IsInt({ each: true })
  @ApiProperty({ type: [Number] })
  days!: number[];

  @IsOptional()
  @Type(() => Date)
  @IsString()
  @ApiPropertyOptional()
  startTime?: Date;

  @IsOptional()
  @Type(() => Date)
  @IsString()
  @ApiPropertyOptional()
  endTime?: Date;

  @IsOptional()
  @Type(() => Date)
  @IsString()
  @ApiPropertyOptional({ type: String, nullable: true })
  date?: Date | null;
}

/**
 * Nested model representing the full schedule entity within a schedule update response.
 * Includes user ID, name, timezone, and optional nested event types and availability entries.
 */
class ScheduleModel_2024_04_15 {
  @IsInt()
  @ApiProperty()
  id!: number;

  @IsInt()
  @ApiProperty()
  userId!: number;

  @IsString()
  @ApiProperty()
  name!: string;

  @IsOptional()
  @IsString()
  @ApiPropertyOptional({ type: String, nullable: true })
  timeZone?: string | null;

  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => EventTypeModel_2024_04_15)
  @IsArray()
  @ApiPropertyOptional({ type: [EventTypeModel_2024_04_15] })
  eventType?: EventTypeModel_2024_04_15[];

  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => AvailabilityModel_2024_04_15)
  @IsArray()
  @ApiPropertyOptional({ type: [AvailabilityModel_2024_04_15] })
  availability?: AvailabilityModel_2024_04_15[];
}

/**
 * Response DTO payload for the enterprise schedule update endpoint (API v2, version 2024-04-15).
 * Contains the updated schedule model, default-flag status, and optional metadata about
 * default schedule transitions (previous and current default IDs).
 */
export class UpdatedScheduleOutput_2024_04_15 {
  /** The updated schedule model with full details. */
  @ValidateNested()
  @Type(() => ScheduleModel_2024_04_15)
  @ApiProperty({ type: ScheduleModel_2024_04_15 })
  schedule!: ScheduleModel_2024_04_15;

  /** Whether this schedule is now the user's default. */
  @IsBoolean()
  @ApiProperty()
  isDefault!: boolean;

  /** The schedule's timezone (optional, returned when set). */
  @IsOptional()
  @IsString()
  @ApiPropertyOptional()
  timeZone?: string;

  /** ID of the schedule that was previously the default (null if none). */
  @IsOptional()
  @IsInt()
  @ApiPropertyOptional({ type: Number, nullable: true })
  prevDefaultId?: number | null;

  /** ID of the schedule that is now the default (null if none). */
  @IsOptional()
  @IsInt()
  @ApiPropertyOptional({ type: Number, nullable: true })
  currentDefaultId?: number | null;
}
