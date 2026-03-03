import type { ConfigType } from "@calcom/dayjs";
import dayjs from "@calcom/dayjs";
import type { Availability } from "@calcom/prisma/client";
import type { Schedule, TimeRange, WorkingHours } from "@calcom/types/schedule";

import { nameOfDay } from "./weekday";

/**
 * Default working-hours time range representing 9:00 AM – 5:00 PM UTC.
 *
 * Uses the **current date** with UTC hours so that downstream DST translation
 * (via `processWorkingHours` in `date-ranges.ts`) correctly resolves the
 * UTC-to-local offset for the user's timezone on the date being evaluated.
 */
export const defaultDayRange: TimeRange = {
  start: new Date(new Date().setUTCHours(9, 0, 0, 0)),
  end: new Date(new Date().setUTCHours(17, 0, 0, 0)),
};

/**
 * Canonical default weekly schedule used when a user has no stored schedule.
 *
 * Structure: 7-element array indexed by day-of-week (0 = Sunday … 6 = Saturday).
 *  - Index 0 (Sunday):    empty — no working hours
 *  - Indices 1–5 (Mon–Fri): `[defaultDayRange]` — 9 AM to 5 PM UTC
 *  - Index 6 (Saturday):  empty — no working hours
 *
 * Consumed by `ScheduleRepository.setupDefaultSchedule`, `detectEventTypeScheduleForUser`,
 * and the Platform SDK as the fallback schedule data.
 */
export const DEFAULT_SCHEDULE: Schedule = [
  [],
  [defaultDayRange],
  [defaultDayRange],
  [defaultDayRange],
  [defaultDayRange],
  [defaultDayRange],
  [],
];

/**
 * Reduces a 7-day `Schedule` (array of `TimeRange[]` per weekday) into a compact
 * `Availability[]` by deduplicating identical start/end time pairs and grouping
 * their associated day indices.
 *
 * Deduplication compares `Date.toString()` representations of `start` and `end`
 * to detect structurally identical time windows across different days.  When a
 * duplicate is found the day index is appended to the existing entry's `days`
 * array; otherwise a new `Availability` record is created.
 *
 * @param schedule - A 7-element array where each element is a list of `TimeRange`
 *   objects for that weekday (index 0 = Sunday … 6 = Saturday).
 * @returns Deduplicated `Availability[]` suitable for Prisma persistence.
 */
export function getAvailabilityFromSchedule(schedule: Schedule): Availability[] {
  return schedule.reduce((availability: Availability[], times: TimeRange[], day: number) => {
    const addNewTime = (time: TimeRange) =>
      ({
        days: [day],
        startTime: time.start,
        endTime: time.end,
      }) as Availability;

    const filteredTimes = times.filter((time) => {
      let idx: number;
      if (
        (idx = availability.findIndex(
          (schedule) =>
            schedule.startTime.toString() === time.start.toString() &&
            schedule.endTime.toString() === time.end.toString()
        )) !== -1
      ) {
        availability[idx].days.push(day);
        return false;
      }
      return true;
    });
    filteredTimes.forEach((time) => {
      availability.push(addNewTime(time));
    });
    return availability;
  }, [] as Availability[]);
}

/** Total minutes in a 24-hour day (1440). Used as the upper bound for day-overflow detection. */
export const MINUTES_IN_DAY = 60 * 24;
/** Last representable minute of a day (1439 = 23:59). Used for clamping end-of-day boundaries. */
export const MINUTES_DAY_END = MINUTES_IN_DAY - 1;
/** First minute of a day (0 = 00:00). Used for clamping start-of-day boundaries. */
export const MINUTES_DAY_START = 0;

/**
 * Converts UTC-based availability records into localised `WorkingHours[]` for a
 * given timezone or explicit UTC offset.
 *
 * **Three-path overflow mechanism:**
 * 1. **Same-day path** — start/end are clamped to `[0, 1439]` and emitted when the
 *    resulting range has positive duration.
 * 2. **Previous-day overflow** — if the offset shifts the start or end *before*
 *    midnight (negative minutes), an additional entry is created on the preceding
 *    weekday with `+MINUTES_IN_DAY` applied to both offsets and `endTime` capped
 *    at `MINUTES_DAY_END`.
 * 3. **Next-day overflow** — if the offset shifts the start or end *past* 23:59
 *    (> 1439 or > 1440), an additional entry is created on the following weekday
 *    with `-MINUTES_IN_DAY` applied and `startTime` floored at `MINUTES_DAY_START`.
 *
 * Weekday indices wrap around using modulo arithmetic (0 = Sunday … 6 = Saturday).
 *
 * @param relativeTimeUnit - Either `{ timeZone }` (IANA string resolved via
 *   `dayjs().tz()`) or `{ utcOffset }` (minutes from UTC). If both are supplied,
 *   `utcOffset` takes precedence.
 * @param availability - Array of recurring availability records. Entries with an
 *   empty `days` array (date-specific overrides) are skipped.
 * @returns Sorted `WorkingHours[]` in ascending `startTime` order, with an
 *   optional `userId` passthrough.
 */
export function getWorkingHours(
  relativeTimeUnit: {
    timeZone?: string;
    utcOffset?: number;
  },
  availability: { userId?: number | null; days: number[]; startTime: ConfigType; endTime: ConfigType }[]
) {
  if (!availability.length) {
    return [];
  }
  const utcOffset =
    relativeTimeUnit.utcOffset ??
    (relativeTimeUnit.timeZone ? dayjs().tz(relativeTimeUnit.timeZone).utcOffset() : 0);

  const workingHours = availability.reduce((currentWorkingHours: WorkingHours[], schedule) => {
    // Include only recurring weekly availability, not date overrides
    if (!schedule.days.length) return currentWorkingHours;
    // Get times localised to the given utcOffset/timeZone
    const startTime =
      dayjs.utc(schedule.startTime).get("hour") * 60 +
      dayjs.utc(schedule.startTime).get("minute") -
      utcOffset;
    const endTime =
      dayjs.utc(schedule.endTime).get("hour") * 60 + dayjs.utc(schedule.endTime).get("minute") - utcOffset;
    // add to working hours, keeping startTime and endTimes between bounds (0-1439)
    const sameDayStartTime = Math.max(MINUTES_DAY_START, Math.min(MINUTES_DAY_END, startTime));
    const sameDayEndTime = Math.max(MINUTES_DAY_START, Math.min(MINUTES_DAY_END, endTime));
    if (sameDayEndTime < sameDayStartTime) {
      return currentWorkingHours;
    }
    if (sameDayStartTime !== sameDayEndTime) {
      const newWorkingHours: WorkingHours = {
        days: schedule.days,
        startTime: sameDayStartTime,
        endTime: sameDayEndTime,
      };
      if (schedule.userId) newWorkingHours.userId = schedule.userId;
      currentWorkingHours.push(newWorkingHours);
    }
    // check for overflow to the previous day
    // overflowing days constraint to 0-6 day range (Sunday-Saturday)
    if (startTime < MINUTES_DAY_START || endTime < MINUTES_DAY_START) {
      const newWorkingHours: WorkingHours = {
        days: schedule.days.map((day) => (day - 1 >= 0 ? day - 1 : 6)),
        startTime: startTime + MINUTES_IN_DAY,
        endTime: Math.min(endTime + MINUTES_IN_DAY, MINUTES_DAY_END),
      };
      if (schedule.userId) newWorkingHours.userId = schedule.userId;
      currentWorkingHours.push(newWorkingHours);
    }
    // else, check for overflow in the next day
    else if (startTime > MINUTES_DAY_END || endTime > MINUTES_IN_DAY) {
      const newWorkingHours: WorkingHours = {
        days: schedule.days.map((day) => (day + 1) % 7),
        startTime: Math.max(startTime - MINUTES_IN_DAY, MINUTES_DAY_START),
        endTime: endTime - MINUTES_IN_DAY,
      };
      if (schedule.userId) newWorkingHours.userId = schedule.userId;
      currentWorkingHours.push(newWorkingHours);
    }

    return currentWorkingHours;
  }, []);

  workingHours.sort((a, b) => a.startTime - b.startTime);
  return workingHours;
}

/**
 * Formats an `Availability` record into a human-readable, locale-aware string
 * such as `"Mon - Wed, 9:00 AM - 5:00 PM"`.
 *
 * **Day span logic (`weekSpan`):** Adjacent day indices are merged into ranges
 * using a sliding-window algorithm. Non-adjacent days are separated by commas.
 * Day names are localised via `nameOfDay(locale, day, "short")`.
 *
 * **Time span logic (`timeSpan`):** Start and end times are formatted with
 * `Intl.DateTimeFormat` using the supplied `locale` and `hour12` toggle.
 * The trailing `"Z"` is stripped from `toISOString()` before parsing so that
 * the formatter treats the timestamp as local time rather than UTC.
 *
 * @param availability - An object containing `days` (weekday indices), `startTime`,
 *   and `endTime` (Date instances).
 * @param options - `locale` for `Intl.DateTimeFormat` and `hour12` toggle.
 * @returns Formatted string combining the day range and the time range.
 */
export function availabilityAsString(
  availability: Pick<Availability, "days" | "startTime" | "endTime">,
  { locale, hour12 }: { locale?: string; hour12?: boolean }
) {
  const weekSpan = (availability: Pick<Availability, "days" | "startTime" | "endTime">) => {
    const days = availability.days.slice(1).reduce(
      (days, day) => {
        if (days[days.length - 1].length === 1 && days[days.length - 1][0] === day - 1) {
          // append if the range is not complete (but the next day needs adding)
          days[days.length - 1].push(day);
        } else if (days[days.length - 1][days[days.length - 1].length - 1] === day - 1) {
          // range complete, overwrite if the last day directly precedes the current day
          days[days.length - 1] = [days[days.length - 1][0], day];
        } else {
          // new range
          days.push([day]);
        }
        return days;
      },
      [[availability.days[0]]] as number[][]
    );
    return days
      .map((dayRange) => dayRange.map((day) => nameOfDay(locale, day, "short")).join(" - "))
      .join(", ");
  };

  const timeSpan = (availability: Pick<Availability, "days" | "startTime" | "endTime">) => {
    return `${new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "numeric", hour12 }).format(
      new Date(availability.startTime.toISOString().slice(0, -1))
    )} - ${new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "numeric", hour12 }).format(
      new Date(availability.endTime.toISOString().slice(0, -1))
    )}`;
  };

  return `${weekSpan(availability)}, ${timeSpan(availability)}`;
}
