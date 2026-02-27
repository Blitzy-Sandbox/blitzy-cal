/**
 * Represents a contiguous block of time with an optional user association.
 *
 * `start` and `end` are native JavaScript `Date` objects representing the
 * boundaries of the time range in UTC. The optional `userId` field identifies
 * which user this range belongs to, enabling multi-host availability
 * calculations where individual participant windows must be tracked and
 * intersected independently.
 *
 * @see packages/lib/availability.ts — `defaultDayRange` for the canonical 9 AM–5 PM default
 * @see packages/features/schedules/lib/date-ranges.ts — `DateRange` class wrapping this type with Dayjs
 */
export type TimeRange = {
  userId?: number | null;
  start: Date;
  end: Date;
};

/**
 * A seven-element two-dimensional array representing a weekly schedule.
 *
 * Each outer index corresponds to a day of the week (0 = Sunday through
 * 6 = Saturday). Each inner array contains zero or more `TimeRange` entries
 * defining the available time slots for that day. An empty inner array
 * indicates the day is unavailable.
 *
 * @example
 * ```ts
 * // Monday 9 AM–5 PM, all other days empty
 * const schedule: Schedule = [[], [{ start: mon9am, end: mon5pm }], [], [], [], [], []];
 * ```
 *
 * @see packages/lib/availability.ts — `DEFAULT_SCHEDULE` for the canonical Mon–Fri 9–5 default
 * @see packages/lib/availability.ts — `getAvailabilityFromSchedule` for deduplication and grouping
 */
export type Schedule = TimeRange[][];

/**
 * Derived working-hours representation with day-of-week grouping and
 * minute-offset time boundaries.
 *
 * `startTime` and `endTime` are expressed as **minutes since midnight**
 * (range 0–1439) serialized to UTC using the organizer's timezone — either
 * the schedule-level `timeZone` or the user-level `timeZone` fallback.
 *
 * `days` is an array of day-of-week indices (0 = Sunday through 6 = Saturday)
 * that share the same start/end boundaries. Ranges that cross midnight are
 * split into two `WorkingHours` entries with overflow days handled separately.
 *
 * The optional `userId` field is populated when computing per-user working
 * hours for multi-host event types, allowing downstream aggregation to
 * attribute windows to individual participants.
 *
 * @see packages/lib/availability.ts — `getWorkingHours(timeZone, availability)` for the reduction algorithm
 * @see packages/features/availability/lib/getUserAvailability.ts — imports as `WorkingHoursWithUserId`
 */
export type WorkingHours = {
  days: number[];
  startTime: number;
  endTime: number;
  userId?: number | null;
};

/**
 * Portable representation of a user's travel schedule, mirroring the Prisma
 * `TravelSchedule` model without a direct ORM dependency.
 *
 * When a user is traveling, `timeZone` reflects the IANA timezone at the
 * travel destination. `prevTimeZone` captures the user's home timezone
 * before travel began, enabling the availability engine to restore the
 * original timezone context when the travel period ends.
 *
 * `startDate` marks when the travel period begins and `endDate` marks when
 * it ends; a `null` value for `endDate` indicates an open-ended (ongoing)
 * travel period.
 *
 * @see packages/features/schedules/lib/date-ranges.ts — `getAdjustedTimezone` for travel override logic
 * @see packages/prisma/schema.prisma — `model TravelSchedule` for the canonical database schema
 */
export type TravelSchedule = {
  id: number;
  timeZone: string;
  userId: number;
  startDate: Date;
  endDate: Date | null;
  prevTimeZone: string | null;
};
