import dayjs from "@calcom/dayjs";
import { getWorkingHours } from "@calcom/lib/availability";
import { yyyymmdd } from "@calcom/lib/dayjs";
import type { Availability } from "@calcom/prisma/client";
import type { Schedule, TimeRange } from "@calcom/types/schedule";

/** Narrowed Availability type containing only days, startTime, and endTime for weekly schedule processing. */
type ScheduleAvailability = Pick<Availability, "days" | "startTime" | "endTime">[];

/** Narrowed Availability type containing only date, startTime, and endTime for date-specific override processing. */
type ScheduleOverride = Pick<Availability, "date" | "startTime" | "endTime">[];

/**
 * Transforms a Cal.com schedule's weekly availability into Atom-compatible WorkingHours[].
 *
 * Always passes `utcOffset: 0` so Atom consumers receive canonical zero-offset working hours
 * without timezone-specific adjustments — Atom consumers are expected to apply their own offsets.
 * Handles a nullable timezone by falling back to `undefined`, which `getWorkingHours` accepts.
 *
 * @param schedule - Object with an optional timezone (`string | null`) and a weekly availability array.
 * @returns WorkingHours[] — Zero-offset working hours suitable for Atom API consumption.
 */
export function transformWorkingHoursForAtom(schedule: {
  timeZone: string | null;
  availability: ScheduleAvailability;
}) {
  return getWorkingHours(
    { timeZone: schedule.timeZone || undefined, utcOffset: 0 },
    schedule.availability || []
  );
}

/**
 * Transforms schedule availability into a 7-day Schedule (TimeRange[][]) with inclusive end-of-day semantics.
 *
 * Delegates to {@link transformScheduleToAvailabilityForAtom} for the 7-day bucket construction,
 * then post-processes each slot: end times exactly at `23:59:00.000Z` are rounded up to
 * `23:59:59.999Z` for inclusive Atom end-of-day handling. Creates NEW Date objects and does
 * not mutate the originals.
 *
 * @param schedule - Object with a weekly availability array.
 * @returns Schedule — 7-element array (index 0 = Sunday through 6 = Saturday) of TimeRange arrays with inclusive end times.
 */
export function transformAvailabilityForAtom(schedule: { availability: ScheduleAvailability }) {
  return transformScheduleToAvailabilityForAtom(schedule).map((a) =>
    a.map((startAndEnd) => ({
      ...startAndEnd,
      end: new Date(startAndEnd.end.toISOString().replace("23:59:00.000Z", "23:59:59.999Z")),
    }))
  );
}

/**
 * Transforms date-specific overrides into chronologically sorted, grouped override ranges for the Atom API.
 *
 * Processing steps:
 * 1. Filters out overrides that have no date or whose date falls before "today" in the specified timezone.
 * 2. Constructs each range by anchoring the override date in UTC and overlaying stored hours/minutes.
 * 3. Groups same-day overrides together using `yyyymmdd` date matching.
 * 4. Sorts the resulting groups chronologically by the first range's start time for deterministic output.
 *
 * @param schedule - Object with date-specific availability overrides (each having date, startTime, endTime).
 * @param timeZone - IANA timezone string used for computing "today" when filtering past overrides.
 * @returns Chronologically sorted array of `{ ranges: TimeRange[] }` grouped by override date.
 */
export function transformDateOverridesForAtom(
  schedule: { availability: ScheduleOverride },
  timeZone: string
) {
  const acc = schedule.availability.reduce(
    (acc, override) => {
      // only if future date override
      const currentUtcOffset = dayjs().tz(timeZone).utcOffset();
      const currentTimeInTz = dayjs().utc().add(currentUtcOffset, "minute");

      if (!override.date || dayjs(override.date).isBefore(currentTimeInTz, "day")) {
        return acc;
      }
      const newValue = {
        start: dayjs
          .utc(override.date)
          .hour(override.startTime.getUTCHours())
          .minute(override.startTime.getUTCMinutes())
          .toDate(),
        end: dayjs
          .utc(override.date)
          .hour(override.endTime.getUTCHours())
          .minute(override.endTime.getUTCMinutes())
          .toDate(),
      };
      const dayRangeIndex = acc.findIndex(
        // early return prevents override.date from ever being empty.
        (item) => override.date && yyyymmdd(item.ranges[0].start) === yyyymmdd(override.date)
      );
      if (dayRangeIndex === -1) {
        acc.push({ ranges: [newValue] });
        return acc;
      }
      acc[dayRangeIndex].ranges.push(newValue);
      return acc;
    },
    [] as { ranges: TimeRange[] }[]
  );

  acc.sort((a, b) => {
    const aTime = a.ranges?.[0]?.start?.getTime?.() ?? 0;
    const bTime = b.ranges?.[0]?.start?.getTime?.() ?? 0;
    return aTime - bTime;
  });
  return acc;
}

/**
 * Internal helper that builds a 7-day Schedule (TimeRange[][]) from availability records.
 *
 * Each day bucket is initialized as an empty array (7 total: index 0 = Sunday through 6 = Saturday).
 * For every availability record, the stored hours and minutes are overlaid onto today's UTC date
 * to produce TimeRange start/end values. Each day's slots are then sorted chronologically by
 * start time for deterministic output.
 *
 * @param schedule - Object with a weekly availability array (each entry having days, startTime, endTime).
 * @returns Schedule — 7-element array of sorted TimeRange arrays.
 */
export const transformScheduleToAvailabilityForAtom = (schedule: { availability: ScheduleAvailability }) => {
  const result = schedule.availability.reduce(
    (schedule: Schedule, availability) => {
      availability.days.forEach((day) => {
        schedule[day].push({
          start: new Date(
            Date.UTC(
              new Date().getUTCFullYear(),
              new Date().getUTCMonth(),
              new Date().getUTCDate(),
              availability.startTime.getUTCHours(),
              availability.startTime.getUTCMinutes()
            )
          ),
          end: new Date(
            Date.UTC(
              new Date().getUTCFullYear(),
              new Date().getUTCMonth(),
              new Date().getUTCDate(),
              availability.endTime.getUTCHours(),
              availability.endTime.getUTCMinutes()
            )
          ),
        });
      });
      return schedule;
    },
    Array.from([...Array(7)]).map(() => [])
  );

  result.forEach((daySlots) => {
    daySlots.sort((a, b) => {
      const aTime = a?.start?.getTime?.() ?? 0;
      const bTime = b?.start?.getTime?.() ?? 0;
      return aTime - bTime;
    });
  });

  return result;
};
