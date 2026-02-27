import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsDate, IsOptional, IsArray, IsBoolean, IsInt, IsString, ValidateNested } from "class-validator";

/**
 * Nested model representing a single availability entry within a schedule.
 * Captures the day-of-week pattern, start/end times, optional date override,
 * and relationships to user, event type, and schedule entities.
 * Used for both weekly recurring availability and date-specific overrides.
 * All Date fields use `@Type(() => Date)` for class-transformer hydration.
 */
class AvailabilityModel {
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
  eventTypeId?: number | null;

  @IsArray()
  @IsInt({ each: true })
  @ApiProperty({ type: [Number] })
  days!: number[];

  @IsDate()
  @Type(() => Date)
  @ApiProperty({ type: Date })
  startTime!: Date;

  @IsDate()
  @Type(() => Date)
  @ApiProperty({ type: Date })
  endTime!: Date;

  @IsOptional()
  @IsDate()
  @Type(() => Date)
  @ApiPropertyOptional({ type: Date, nullable: true })
  date?: Date | null;

  @IsOptional()
  @IsInt()
  @ApiPropertyOptional({ type: Number, nullable: true })
  scheduleId?: number | null;
}

/**
 * Nested model representing aggregated working hours derived from a schedule's
 * availability entries. `startTime` and `endTime` are minute-of-day integers
 * (e.g., 540 = 9:00 AM, 1020 = 5:00 PM). `days` is an array of ISO weekday
 * numbers (0=Sunday through 6=Saturday).
 */
class WorkingHours {
  @IsArray()
  @IsInt({ each: true })
  @ApiProperty({ type: [Number] })
  days!: number[];

  @IsInt()
  @ApiProperty()
  startTime!: number;

  @IsInt()
  @ApiProperty()
  endTime!: number;

  @IsOptional()
  @IsInt()
  @ApiPropertyOptional({ type: Number, nullable: true })
  userId?: number | null;
}

/**
 * Nested model representing a concrete time window within the schedule's
 * computed availability. Uses absolute `Date` timestamps for `start` and
 * `end`, with an optional `userId` for multi-host scenarios.
 */
class TimeRange {
  @IsOptional()
  @IsInt()
  @ApiPropertyOptional({ type: Number, nullable: true })
  userId?: number | null;

  @IsDate()
  @ApiProperty({ type: Date })
  start!: Date;

  @IsDate()
  @ApiProperty({ type: Date })
  end!: Date;
}

/**
 * Canonical response DTO for schedule data in the API v2 enterprise schedule
 * endpoints (version 2024-04-15). This is the base output model imported by
 * all schedule response DTOs (`CreateScheduleOutput`, `GetScheduleOutput`,
 * `GetSchedulesOutput`, `GetDefaultScheduleOutput`). Contains the schedule's
 * identity, computed working hours, raw availability entries, computed time
 * ranges, timezone, date overrides, and status flags. The `dateOverrides`
 * field uses `unknown[]` due to a known Swagger generation limitation
 * (see inline comment).
 */
export class ScheduleOutput {
  /** Unique schedule identifier. */
  @IsInt()
  @ApiProperty()
  id!: number;

  /** User-assigned schedule name. */
  @IsString()
  @ApiProperty()
  name!: string;

  /** Whether this schedule is managed by an organization admin. */
  @IsBoolean()
  @ApiProperty()
  isManaged!: boolean;

  /** Aggregated working hours derived from availability entries. */
  @ValidateNested({ each: true })
  @Type(() => WorkingHours)
  @ApiProperty({ type: [WorkingHours] })
  workingHours!: WorkingHours[];

  /** Raw availability entries (the `Availability` model rows from the database). */
  @ValidateNested({ each: true })
  @Type(() => AvailabilityModel)
  @IsArray()
  @ApiProperty({ type: [AvailabilityModel] })
  schedule!: AvailabilityModel[];

  /** Computed time ranges grouped by date, representing actual bookable windows. */
  @ApiProperty({ type: [[TimeRange]] })
  availability!: TimeRange[][];

  /** IANA timezone identifier for this schedule. */
  @IsString()
  @ApiProperty()
  timeZone!: string;

  /** Date-specific override ranges (typed as `unknown[]` due to Swagger limitation). */
  @ValidateNested({ each: true })
  @IsArray()
  @ApiPropertyOptional({ type: [Object] })
  // note(Lauris) it should be
  // dateOverrides!: { ranges: TimeRange[] }[];
  // but docs aren't generating correctly it results in array of strings
  dateOverrides!: unknown[];

  /** Whether this is the user's default schedule. */
  @IsBoolean()
  @ApiProperty()
  isDefault!: boolean;

  /** Whether this is the user's only remaining schedule (prevents deletion). */
  @IsBoolean()
  @ApiProperty()
  isLastSchedule!: boolean;

  /** Whether the current viewer has read-only access to this schedule. */
  @IsBoolean()
  @ApiProperty()
  readOnly!: boolean;
}
