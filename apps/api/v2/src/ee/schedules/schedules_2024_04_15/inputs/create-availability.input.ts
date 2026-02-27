import { BadRequestException } from "@nestjs/common";
import { ApiProperty } from "@nestjs/swagger";
import { Transform, TransformFnParams } from "class-transformer";
import { IsArray, IsDate, IsNumber } from "class-validator";

/**
 * DTO for a single availability time slot entry in the April 15, 2024 versioned
 * enterprise schedule API.
 *
 * Validated by NestJS's `ValidationPipe` using class-validator decorators.
 * The `@Transform` decorator on `startTime` and `endTime` uses the
 * `transformStringToDate` helper to convert ISO-formatted strings into normalized
 * UTC `Date` objects before `@IsDate()` validation runs.
 *
 * This class is used as a nested type within `CreateScheduleInput_2024_04_15`
 * via `@ValidateNested({ each: true })` and
 * `@Type(() => CreateAvailabilityInput_2024_04_15)`.
 */
export class CreateAvailabilityInput_2024_04_15 {
  /**
   * Array of weekday indices indicating which days this availability applies to.
   *
   * Values correspond to day-of-week numbers (e.g., 0 = Sunday, 1 = Monday, ..., 6 = Saturday).
   * Validated as a numeric array by `@IsArray()` + `@IsNumber({}, { each: true })`.
   *
   * @example [1, 2] // Represents Monday and Tuesday.
   */
  @IsArray()
  @IsNumber({}, { each: true })
  @ApiProperty({ example: [1, 2] })
  days!: number[];

  /**
   * The start time of the availability window, normalized to a UTC `Date` object.
   *
   * The incoming ISO-formatted string (e.g., `"2025-04-12T09:00:00.000Z"`) is transformed
   * by `transformStringToDate` which extracts the time component, validates HH:MM:SS bounds,
   * and creates a UTC Date anchored on the current day with zeroed milliseconds.
   */
  @IsDate()
  @Transform(({ value, key }: TransformFnParams) => transformStringToDate(value, key))
  startTime!: Date;

  /**
   * The end time of the availability window, normalized to a UTC `Date` object.
   *
   * Same transformation and validation as `startTime` via `transformStringToDate`.
   */
  @IsDate()
  @Transform(({ value, key }: TransformFnParams) => transformStringToDate(value, key))
  endTime!: Date;
}

/**
 * Parses an ISO 8601-formatted date-time string and extracts the time component
 * to create a normalized UTC `Date` object.
 *
 * Parsing pipeline:
 * 1. Rejects missing/falsy values with a `BadRequestException`.
 * 2. Splits on `"T"` separator — rejects if not exactly 2 parts (date + time).
 * 3. Strips milliseconds from the time part (splits on `"."`).
 * 4. Splits on `":"` — rejects if not exactly 3 parts (HH:MM:SS).
 * 5. Validates hours (0-23), minutes (0-59), seconds (0-59) ranges.
 * 6. Creates a UTC `Date` via `new Date(new Date().setUTCHours(hours, minutes, seconds, 0))`,
 *    zeroing milliseconds.
 *
 * @param value - The raw ISO-formatted string from the request body.
 * @param key - The field name (e.g., `"startTime"` or `"endTime"`) used in error messages.
 * @returns A normalized UTC `Date` object with only the time component significant;
 *          the date portion is anchored to the current day.
 * @throws BadRequestException If the value is missing, not in ISO format, or has
 *         out-of-range time components.
 */
function transformStringToDate(value: string, key: string): Date {
  if (!value) {
    throw new BadRequestException(
      `Missing ${key}. Expected value is in ISO8061 format e.g. 2025-0412T13:17:56.324Z`
    );
  }

  const dateTimeParts = value.split("T");
  if (dateTimeParts.length !== 2) {
    throw new BadRequestException(
      `Invalid datestring format. Expected format(ISO8061): 2025-04-12T13:17:56.324Z. Received: ${value}`
    );
  }

  const timePart = dateTimeParts[1].split(".")[0]; // Removes milliseconds
  const parts = timePart.split(":");

  if (parts.length !== 3) {
    throw new BadRequestException(
      `Invalid time format. Expected format(ISO8061): 2025-0412T13:17:56.324Z. Received: ${value}`
    );
  }
  const [hours, minutes, seconds] = parts.map(Number);

  if (hours < 0 || hours > 23) {
    throw new BadRequestException(`Invalid ${key} hours. Expected value between 0 and 23`);
  }

  if (minutes < 0 || minutes > 59) {
    throw new BadRequestException(`Invalid ${key} minutes. Expected value between 0 and 59`);
  }

  if (seconds < 0 || seconds > 59) {
    throw new BadRequestException(`Invalid ${key} seconds. Expected value between 0 and 59`);
  }

  return new Date(new Date().setUTCHours(hours, minutes, seconds, 0));
}
