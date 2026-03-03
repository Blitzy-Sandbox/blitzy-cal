import type { Dayjs } from "@calcom/dayjs";
import dayjs from "@calcom/dayjs";
import type { IOutOfOfficeData } from "@calcom/features/availability/lib/getUserAvailability";
import type { Availability } from "@calcom/prisma/client";

/**
 * The fundamental date-range interval type for the Cal.com scheduling engine.
 * Represents a half-open time window [start, end) using Dayjs instances that
 * carry timezone context. Every availability computation — slot generation,
 * busy-time subtraction, multi-host intersection — operates on arrays of
 * DateRange objects. Zero-length ranges (start === end) are used as sentinel
 * markers (e.g., out-of-office cancellation) and are filtered before final output.
 */
export type DateRange = {
  start: Dayjs;
  end: Dayjs;
};

/**
 * A date-specific availability override extracted from the Prisma `Availability` model.
 * Date overrides allow users to set custom working hours for a particular calendar date,
 * completely replacing the regular weekly schedule for that day. The `date` field identifies
 * the override day, while `startTime` and `endTime` are stored as UTC `Date` objects whose
 * hours/minutes represent the local working window.
 */
export type DateOverride = Pick<Availability, "date" | "startTime" | "endTime">;

/**
 * Weekly recurring working-hours configuration extracted from the Prisma `Availability` model.
 * The `days` array contains day-of-week indices (0 = Sunday … 6 = Saturday) when the user
 * is available. `startTime` and `endTime` are UTC `Date` objects whose hours and minutes
 * encode the daily working window boundaries in the user's local timezone. These are processed
 * by {@link processWorkingHours} with full DST normalization.
 */
export type WorkingHours = Pick<Availability, "days" | "startTime" | "endTime">;

/**
 * Represents a user's travel schedule that overrides their base timezone for a
 * specific date range. When a user travels, their availability should reflect the
 * destination timezone rather than their home timezone. The override is active for
 * dates within [startDate, endDate] (inclusive). If `endDate` is undefined, the
 * travel schedule is treated as open-ended (active from `startDate` onward).
 */
type TravelSchedule = { startDate: Dayjs; endDate?: Dayjs; timeZone: string };

/**
 * Determines the effective timezone for a given date by checking travel schedule overrides.
 *
 * Iterates through the `travelSchedules` array and returns the timezone of the first
 * travel schedule whose [startDate, endDate] range inclusively contains `date`. If no
 * travel schedule matches, falls back to the user's base `timeZone`.
 *
 * The comparison uses inclusive bounds: `!date.isBefore(startDate)` (start is inclusive)
 * and `!date.isAfter(endDate)` (end is inclusive). Open-ended travel schedules (no endDate)
 * match any date on or after startDate. First-match-wins semantics apply — order matters.
 *
 * @param date - The date to check against travel schedules
 * @param timeZone - The user's base (home) timezone as an IANA string
 * @param travelSchedules - Array of travel schedule overrides, checked in order
 * @returns The effective IANA timezone string for the given date
 */
function getAdjustedTimezone(date: Dayjs, timeZone: string, travelSchedules: TravelSchedule[]) {
  let adjustedTimezone = timeZone;

  for (const travelSchedule of travelSchedules) {
    if (
      !date.isBefore(travelSchedule.startDate) &&
      (!travelSchedule.endDate || !date.isAfter(travelSchedule.endDate))
    ) {
      adjustedTimezone = travelSchedule.timeZone;
      break;
    }
  }
  return adjustedTimezone;
}

/**
 * Reducer that transforms weekly working-hours definitions into concrete UTC-aware
 * DateRange entries, handling DST transitions and travel-schedule timezone overrides.
 *
 * **Algorithm overview:**
 * 1. Iterates day-by-day from `dateFrom` to `dateTo` (UTC upper bound).
 * 2. For each day, resolves the effective timezone via {@link getAdjustedTimezone}
 *    (travel schedule override or base timezone).
 * 3. Applies a **double DST offset correction**:
 *    - First correction (line ~59): compensates for the difference between the
 *      `dateFrom` timezone offset and the current date's offset, ensuring the
 *      day iteration always lands on local midnight even across DST boundaries.
 *    - Second correction (lines ~70-74): compares the constructed start time's
 *      UTC offset against the beginning-of-day offset in the adjusted timezone,
 *      handling intra-day DST transitions (e.g., clocks changing at 2 AM).
 * 4. Clamps results to the [dateFrom, dateTo] window via `dayjs.max` / `dayjs.min`.
 * 5. Normalizes 23:59 end times to midnight (adds 1 minute) so users who set
 *    availability to 11:59 PM are available through the end of the day.
 * 6. Detects and merges overlapping ranges using a **lazy-initialized endTimeToKeyMap**
 *    (`Map<number, number[]>`) that provides O(1) lookup by end-time valueOf for
 *    collision detection. Overlapping ranges with the same end time are merged by
 *    taking the earliest start. Ranges sharing a start time merge end times via
 *    `dayjs.max`. Non-overlapping ranges are inserted as new entries.
 *
 * **Mutability pattern:** The `results` Record is mutated in-place (keyed by numeric
 * timestamps) for accumulation efficiency across multiple reduce iterations.
 *
 * @param results - Mutable accumulator Record keyed by numeric timestamps
 * @param params.item - The weekly working-hours definition to process
 * @param params.timeZone - The user's base IANA timezone
 * @param params.dateFrom - Start of the query window (inclusive)
 * @param params.dateTo - End of the query window (exclusive)
 * @param params.travelSchedules - Travel schedule overrides for timezone adjustment
 * @returns The mutated results Record with new/merged DateRange entries
 */
export function processWorkingHours(
  results: Record<number, DateRange>,
  {
    item,
    timeZone,
    dateFrom,
    dateTo,
    travelSchedules,
  }: {
    item: WorkingHours;
    timeZone: string;
    dateFrom: Dayjs;
    dateTo: Dayjs;
    travelSchedules: TravelSchedule[];
  }
) {
  const utcDateTo = dateTo.utc();
  let endTimeToKeyMap: Map<number, number[]> | undefined;

  for (let date = dateFrom.startOf("day"); utcDateTo.isAfter(date); date = date.add(1, "day")) {
    const fromOffset = dateFrom.startOf("day").utcOffset();

    const adjustedTimezone = getAdjustedTimezone(date, timeZone, travelSchedules);

    const offset = date.tz(adjustedTimezone).utcOffset();

    // it always has to be start of the day (midnight) even when DST changes
    const dateInTz = date.add(fromOffset - offset, "minutes").tz(adjustedTimezone);
    if (!item.days.includes(dateInTz.day())) {
      continue;
    }

    let start = dateInTz
      .add(item.startTime.getUTCHours(), "hours")
      .add(item.startTime.getUTCMinutes(), "minutes");

    let end = dateInTz.add(item.endTime.getUTCHours(), "hours").add(item.endTime.getUTCMinutes(), "minutes");

    const offsetBeginningOfDay = dayjs(start.format("YYYY-MM-DD hh:mm")).tz(adjustedTimezone).utcOffset();
    const offsetDiff = start.utcOffset() - offsetBeginningOfDay; // there will be 60 min offset on the day day of DST change

    start = start.add(offsetDiff, "minute");
    end = end.add(offsetDiff, "minute");

    const startResult = dayjs.max(start, dateFrom);
    let endResult = dayjs.min(end, dateTo.tz(adjustedTimezone));

    // INFO: We only allow users to set availability up to 11:59PM which ends up not making them available
    // up to midnight.
    if (endResult.hour() === 23 && endResult.minute() === 59) {
      endResult = endResult.add(1, "minute");
    }

    if (endResult.isBefore(startResult)) {
      // if an event ends before start, it's not a result.
      continue;
    }

    const endTimeKey = endResult.valueOf();

    // Create a map of end times to range keys for O(1) lookup
    if (!endTimeToKeyMap) {
      endTimeToKeyMap = new Map<number, number[]>();
      for (const [key, range] of Object.entries(results)) {
        const endTime = range.end.valueOf();
        if (!endTimeToKeyMap.has(endTime)) {
          endTimeToKeyMap.set(endTime, []);
        }
        endTimeToKeyMap.get(endTime)!.push(Number(key));
      }
    }

    // Check for overlapping ranges with the same end time using O(1) lookup
    const keysWithSameEndTime = endTimeToKeyMap.get(endTimeKey) || [];
    let foundOverlapping = false;

    for (const key of keysWithSameEndTime) {
      const existingRange = results[key];
      if (
        startResult.valueOf() <= existingRange.end.valueOf() &&
        endResult.valueOf() >= existingRange.start.valueOf()
      ) {
        // Merge by taking the earliest start time and keeping the same end time
        results[key] = {
          start: dayjs.min(existingRange.start, startResult),
          end: endResult,
        };
        foundOverlapping = true;
        break;
      }
    }

    if (foundOverlapping) {
      continue;
    }

    if (results[startResult.valueOf()]) {
      // if a result already exists, we merge the end time
      const oldKey = startResult.valueOf();
      const newKey = endResult.valueOf();

      results[newKey] = {
        start: results[oldKey].start,
        end: dayjs.max(results[oldKey].end, endResult),
      };

      if (endTimeToKeyMap) {
        const oldEndTime = results[oldKey].end.valueOf();
        const oldKeys = endTimeToKeyMap.get(oldEndTime) || [];
        const filteredKeys = oldKeys.filter((k) => k !== oldKey);
        if (filteredKeys.length === 0) {
          endTimeToKeyMap.delete(oldEndTime);
        } else {
          endTimeToKeyMap.set(oldEndTime, filteredKeys);
        }

        if (!endTimeToKeyMap.has(endTimeKey)) {
          endTimeToKeyMap.set(endTimeKey, []);
        }
        endTimeToKeyMap.get(endTimeKey)!.push(newKey);
      }

      delete results[oldKey]; // delete the previous end time
      continue;
    }
    // otherwise we create a new result
    const newKey = endResult.valueOf();
    results[newKey] = {
      start: startResult,
      end: endResult,
    };

    if (endTimeToKeyMap) {
      if (!endTimeToKeyMap.has(endTimeKey)) {
        endTimeToKeyMap.set(endTimeKey, []);
      }
      endTimeToKeyMap.get(endTimeKey)!.push(newKey);
    }
  }

  return results;
}

/**
 * Converts a date-specific availability override into a concrete DateRange.
 *
 * Constructs start and end Dayjs instances from the override's UTC-encoded
 * hours/minutes, applied to the override date's start-of-day. The timezone is
 * resolved via {@link getAdjustedTimezone} to respect travel schedule overrides,
 * and applied using `tz(timezone, true)` (keepLocal mode) to preserve the local
 * wall-clock time rather than converting across offsets.
 *
 * **Midnight-bounding semantics:** If the end time is 23:59, the override is
 * treated as extending to the start of the next day (adds 1 day) to ensure full
 * end-of-day coverage. This mirrors the 23:59 normalization in
 * {@link processWorkingHours}.
 *
 * @param params.item - The date override with date, startTime, and endTime
 * @param params.itemDateAsUtc - The override date as a UTC Dayjs instance
 * @param params.timeZone - The user's base IANA timezone
 * @param params.travelSchedules - Travel schedule overrides for timezone adjustment
 * @returns A DateRange representing the override's availability window
 */
export function processDateOverride({
  item,
  itemDateAsUtc,
  timeZone,
  travelSchedules,
}: {
  item: DateOverride;
  itemDateAsUtc: Dayjs;
  timeZone: string;
  travelSchedules: TravelSchedule[];
}) {
  const overrideDate = dayjs(item.date);

  const adjustedTimezone = getAdjustedTimezone(overrideDate, timeZone, travelSchedules);

  const itemDateStartOfDay = itemDateAsUtc.startOf("day");
  const startDate = itemDateStartOfDay
    .add(item.startTime.getUTCHours(), "hours")
    .add(item.startTime.getUTCMinutes(), "minutes")
    .second(0)
    .tz(adjustedTimezone, true);

  let endDate = itemDateStartOfDay;
  const endTimeHours = item.endTime.getUTCHours();
  const endTimeMinutes = item.endTime.getUTCMinutes();

  if (endTimeHours === 23 && endTimeMinutes === 59) {
    endDate = endDate.add(1, "day").tz(timeZone, true);
  } else {
    endDate = itemDateStartOfDay
      .add(endTimeHours, "hours")
      .add(endTimeMinutes, "minutes")
      .second(0)
      .tz(adjustedTimezone, true);
  }

  return {
    start: startDate,
    end: endDate,
  };
}

/**
 * Processes an out-of-office date into a zero-length DateRange sentinel marker.
 *
 * The returned range has `start === end`, which is the convention used by
 * {@link buildDateRanges} to cancel out working hours for a specific date.
 * When the OOO marker is grouped by date and spread into the merged availability
 * map, it replaces the working hours for that date. The zero-length filter in
 * `buildDateRanges` then removes these markers from the final output, effectively
 * blocking availability for the entire OOO day.
 *
 * The date is localized to the organizer's timezone using `tz(timeZone, true)`
 * (keepLocal mode) to ensure correct date grouping.
 *
 * @param outOfOffice - The OOO date as a UTC Dayjs instance
 * @param timeZone - The organizer's IANA timezone for date localization
 * @returns A zero-length DateRange that acts as an availability cancellation marker
 */
function processOOO(outOfOffice: Dayjs, timeZone: string) {
  const OOOdate = outOfOffice.tz(timeZone, true);
  return {
    start: OOOdate,
    end: OOOdate,
  };
}

/**
 * Orchestrates the construction of availability date ranges from weekly schedules,
 * date overrides, and out-of-office entries. This is the primary entry point for
 * converting user-defined availability into concrete time windows.
 *
 * **Pipeline:**
 * 1. Normalizes `dateFrom` to the organizer's timezone for consistent day iteration.
 * 2. Reduces all `WorkingHours` items through {@link processWorkingHours} to produce
 *    DST-normalized, timezone-aware DateRange entries, then groups them by date.
 * 3. Processes out-of-office dates into zero-length sentinel markers via
 *    {@link processOOO} and groups them by date.
 * 4. Reduces all `DateOverride` items through {@link processDateOverride}, applying
 *    a ±1-day expansion for UTC/local date mismatch tolerance (see TODO comment),
 *    then groups by date.
 * 5. **Merge strategy:** Date overrides REPLACE working hours for the same date
 *    via object spread (`{...groupedWorkingHours, ...groupedDateOverrides}`).
 *    This ensures that if a user sets custom hours for a specific date, the weekly
 *    schedule is completely overridden.
 * 6. Filters out zero-length ranges (OOO markers, empty overrides).
 * 7. Produces two result sets:
 *    - `dateRanges`: Working hours merged with date overrides (OOO not applied).
 *    - `oooExcludedDateRanges`: Same merge but also includes OOO markers, which
 *      cancel availability for OOO dates via the zero-length filter.
 *
 * @param params.availability - Array of WorkingHours and DateOverride entries
 * @param params.timeZone - The organizer's IANA timezone
 * @param params.dateFrom - Start of the query window (attendee's perspective)
 * @param params.dateTo - End of the query window (attendee's perspective)
 * @param params.travelSchedules - Travel schedule overrides for timezone adjustment
 * @param params.outOfOffice - Optional map of OOO dates with associated metadata
 * @returns Object with `dateRanges` and `oooExcludedDateRanges` arrays
 */
export function buildDateRanges({
  availability,
  timeZone /* Organizer timeZone */,
  dateFrom /* Attendee dateFrom */,
  dateTo /* `` dateTo */,
  travelSchedules,
  outOfOffice,
}: {
  timeZone: string;
  availability: (DateOverride | WorkingHours)[];
  dateFrom: Dayjs;
  dateTo: Dayjs;
  travelSchedules: TravelSchedule[];
  outOfOffice?: IOutOfOfficeData;
}): { dateRanges: DateRange[]; oooExcludedDateRanges: DateRange[] } {
  const dateFromOrganizerTZ = dateFrom.tz(timeZone);

  const groupedWorkingHours = groupByDate(
    Object.values(
      availability.reduce((processed: Record<number, DateRange>, item) => {
        if (!("days" in item)) {
          return processed;
        }

        processed = processWorkingHours(processed, {
          item,
          timeZone,
          dateFrom: dateFromOrganizerTZ,
          dateTo,
          travelSchedules,
        });

        return processed;
      }, {})
    )
  );

  const groupedOOO = groupByDate(
    outOfOffice
      ? Object.keys(outOfOffice).map((outOfOffice) => processOOO(dayjs.utc(outOfOffice), timeZone))
      : []
  );

  const groupedDateOverrides = groupByDate(
    Object.values(
      availability.reduce((processed: Record<number, DateRange>, item) => {
        // early return if item is not a date override
        if (!("date" in item && !!item.date)) {
          return processed;
        }
        const itemDateAsUtc = dayjs.utc(item.date);
        // TODO: Remove the .subtract(1, "day") and .add(1, "day") part and
        // refactor this to actually work with correct dates.
        // As of 2024-02-20, there are mismatches between local and UTC dates for overrides
        // and the dateFrom and dateTo fields, resulting in this if not returning true, which
        // results in "no available users found" errors.
        if (
          itemDateAsUtc.isBetween(
            dateFrom.subtract(1, "day").startOf("day"),
            dateTo.add(1, "day").endOf("day"),
            null,
            "[]"
          )
        ) {
          // unlike working hours, date overrides are always one. No loop per day.
          const newProcessedDateOverride = processDateOverride({
            item,
            itemDateAsUtc,
            timeZone,
            travelSchedules,
          });
          if (processed[newProcessedDateOverride.start.valueOf()]) {
            // if a result already exists, we merge the end time
            processed[newProcessedDateOverride.start.valueOf()].end = dayjs.max(
              processed[newProcessedDateOverride.start.valueOf()].end,
              newProcessedDateOverride.end
            );
            return processed;
          }
          processed[newProcessedDateOverride.end.valueOf()] = newProcessedDateOverride;
        }
        return processed;
      }, {})
    )
  );

  const dateRanges = Object.values({
    ...groupedWorkingHours,
    ...groupedDateOverrides,
  }).map(
    // remove 0-length overrides that were kept to cancel out working dates until now.
    (ranges) => ranges.filter((range) => range.start.valueOf() !== range.end.valueOf())
  );

  const oooExcludedDateRanges = Object.values({
    ...groupedWorkingHours,
    ...groupedDateOverrides,
    ...groupedOOO,
  }).map(
    // remove 0-length overrides && OOO dates that were kept to cancel out working dates until now.
    (ranges) => ranges.filter((range) => range.start.valueOf() !== range.end.valueOf())
  );

  return { dateRanges: dateRanges.flat(), oooExcludedDateRanges: oooExcludedDateRanges.flat() };
}

/**
 * Groups an array of DateRange objects by their start date, keyed as "YYYY-MM-DD" strings.
 *
 * This grouping enables the date-override replacement strategy in {@link buildDateRanges}:
 * when working hours and date overrides are both grouped by date, spreading the override
 * group after the working hours group causes overrides to replace working hours for
 * matching dates. Ranges whose start dates fall on the same calendar day are collected
 * into the same array.
 *
 * @param ranges - Array of DateRange objects to group
 * @returns Object keyed by "YYYY-MM-DD" date strings, with arrays of DateRange values
 */
export function groupByDate(ranges: DateRange[]): { [x: string]: DateRange[] } {
  const results = ranges.reduce(
    (
      previousValue: {
        [date: string]: DateRange[];
      },
      currentValue
    ) => {
      const dateString = dayjs(currentValue.start).format("YYYY-MM-DD");

      previousValue[dateString] =
        typeof previousValue[dateString] === "undefined"
          ? [currentValue]
          : [...previousValue[dateString], currentValue];
      return previousValue;
    },
    {}
  );

  return results;
}

/**
 * Computes the intersection of multiple users' availability ranges using a
 * multi-stream two-pointer algorithm. Returns only the time windows where
 * ALL participants are simultaneously available.
 *
 * **Algorithm:**
 * 1. **Pre-processing:** Each user's ranges are sorted by start time and
 *    augmented with cached `startValue`/`endValue` numeric timestamps to
 *    avoid repeated `.valueOf()` calls during comparison.
 * 2. **Pairwise intersection:** Starting with the first user's ranges as the
 *    initial common availability, the algorithm iteratively intersects with
 *    each subsequent user's ranges using a two-pointer traversal:
 *    - The intersection of two ranges is `[max(starts), min(ends)]`.
 *    - A valid intersection exists only when `intersectStart < intersectEnd`
 *      (strict inequality — zero-length intersections are excluded).
 *    - The pointer for the range with the smaller end value advances.
 * 3. **Early exit:** If common availability becomes empty at any point,
 *    returns immediately (no further users can add availability).
 * 4. **Post-processing:** Cached numeric values are stripped before returning
 *    to match the expected `DateRange[]` contract.
 *
 * Used by {@link getAggregatedAvailability} for multi-host scheduling
 * (fixed-host intersection and round-robin group contributions).
 *
 * @param ranges - Array of arrays, where each inner array is one user's sorted DateRange list
 * @returns Array of DateRange objects representing common availability across all users
 */
export function intersect(ranges: DateRange[][]): DateRange[] {
  if (!ranges.length) {
    return [];
  }

  type ProcessedDateRange = DateRange & { startValue: number; endValue: number };

  // Pre-sort all user ranges and cache timestamp values.
  const sortedRanges: ProcessedDateRange[][] = ranges.map((userRanges) =>
    userRanges
      .map((r) => ({
        ...r,
        startValue: r.start.valueOf(),
        endValue: r.end.valueOf(),
      }))
      .sort((a, b) => a.startValue - b.startValue)
  );

  let commonAvailability: ProcessedDateRange[] = sortedRanges[0];

  for (let i = 1; i < sortedRanges.length; i++) {
    // Early exit if no common availability is left.
    if (commonAvailability.length === 0) {
      return [];
    }

    const userRanges = sortedRanges[i];
    const intersectedRanges: ProcessedDateRange[] = [];

    let commonIndex = 0;
    let userIndex = 0;

    while (commonIndex < commonAvailability.length && userIndex < userRanges.length) {
      const commonRange = commonAvailability[commonIndex];
      const userRange = userRanges[userIndex];

      const intersectStartValue = Math.max(commonRange.startValue, userRange.startValue);
      const intersectEndValue = Math.min(commonRange.endValue, userRange.endValue);

      if (intersectStartValue < intersectEndValue) {
        const intersectStart =
          commonRange.startValue > userRange.startValue ? commonRange.start : userRange.start;
        const intersectEnd = commonRange.endValue < userRange.endValue ? commonRange.end : userRange.end;
        intersectedRanges.push({
          start: intersectStart,
          end: intersectEnd,
          startValue: intersectStartValue,
          endValue: intersectEndValue,
        });
      }

      if (commonRange.endValue <= userRange.endValue) {
        commonIndex++;
      } else {
        userIndex++;
      }
    }
    commonAvailability = intersectedRanges;
  }

  // Strip the cached values before returning to match the expected DateRange[] type.
  return commonAvailability.map(({ start, end }) => ({ start, end }));
}

/**
 * Subtracts exclusion ranges from source availability ranges, preserving any
 * additional metadata properties on the source ranges via rest spread passthrough.
 *
 * **Algorithm:**
 * 1. Sorts excluded ranges by start time for efficient single-pass processing.
 * 2. For each source range, walks through the sorted exclusions:
 *    - **Early break:** If the exclusion starts at or after the source end,
 *      no further exclusions can affect this source range.
 *    - **Skip:** If the exclusion ends at or before the current position,
 *      it has already been passed.
 *    - **Gap emission:** If the exclusion starts after the current position,
 *      emits the gap [currentStart, exclusionStart] as available time.
 *    - **Advance:** Moves currentStart past the exclusion's end.
 * 3. After all exclusions, emits any trailing remainder [currentStart, sourceEnd].
 *
 * **Metadata passthrough:** Source ranges may carry additional properties beyond
 * `start` and `end` (e.g., OOO metadata, slot information). These are preserved
 * via `...passThrough` destructuring and spread onto all emitted result ranges.
 *
 * Used by {@link UserAvailabilityService} to remove busy times from working hours,
 * and by the slot generation pipeline to exclude booked windows.
 *
 * @param sourceRanges - Available time ranges (may include extra metadata properties)
 * @param excludedRanges - Busy/blocked time ranges to subtract
 * @returns Array of remaining available ranges with metadata preserved
 */
export function subtract(
  sourceRanges: (DateRange & { [x: string]: unknown })[],
  excludedRanges: DateRange[]
) {
  const result = [];
  const sortedExcludedRanges = [...excludedRanges].sort((a, b) => a.start.valueOf() - b.start.valueOf());

  for (const { start: sourceStart, end: sourceEnd, ...passThrough } of sourceRanges) {
    let currentStart = sourceStart;

    for (const excludedRange of sortedExcludedRanges) {
      if (excludedRange.start.valueOf() >= sourceEnd.valueOf()) break;
      if (excludedRange.end.valueOf() <= currentStart.valueOf()) continue;

      if (excludedRange.start.valueOf() > currentStart.valueOf()) {
        result.push({ start: currentStart, end: excludedRange.start, ...passThrough });
      }

      if (excludedRange.end.valueOf() > currentStart.valueOf()) {
        currentStart = excludedRange.end;
      }
    }

    if (sourceEnd.valueOf() > currentStart.valueOf()) {
      result.push({ start: currentStart, end: sourceEnd, ...passThrough });
    }
  }

  return result;
}

/**
 * Merges overlapping or adjacent time ranges into non-overlapping consolidated ranges.
 *
 * **Important:** This function operates on native JavaScript `Date` objects (not Dayjs)
 * for use in contexts where ranges have already been converted from Dayjs to plain Date
 * objects (e.g., aggregated availability output, API response formatting).
 *
 * **Algorithm (sort-then-merge):**
 * 1. Sorts ranges by start time using `.valueOf()` comparison.
 * 2. Seeds the merged result with the first sorted range.
 * 3. For each subsequent range, checks if it overlaps or is adjacent to the last
 *    merged range (i.e., `currentStart <= lastMergedEnd`). If so, extends the
 *    merged range's end to `Math.max(lastEnd, currentEnd)`. Otherwise, appends
 *    the current range as a new entry.
 *
 * Time complexity: O(n log n) due to sorting, O(n) for the merge pass.
 *
 * Used by the aggregated availability pipeline to deduplicate overlapping
 * date ranges from multiple sources before returning to consumers.
 *
 * @param ranges - Array of Date-based time ranges, potentially overlapping
 * @returns Array of non-overlapping, sorted time ranges
 */
export function mergeOverlappingRanges(ranges: { start: Date; end: Date }[]): { start: Date; end: Date }[] {
  if (ranges.length === 0) return [];

  const sortedRanges = ranges.sort((a, b) => a.start.valueOf() - b.start.valueOf());

  const mergedRanges: { start: Date; end: Date }[] = [sortedRanges[0]];

  for (let i = 1; i < sortedRanges.length; i++) {
    const lastMergedRange = mergedRanges[mergedRanges.length - 1];
    const currentRange = sortedRanges[i];

    if (currentRange.start.getTime() <= lastMergedRange.end.getTime()) {
      lastMergedRange.end = new Date(Math.max(lastMergedRange.end.getTime(), currentRange.end.getTime()));
    } else {
      mergedRanges.push(currentRange);
    }
  }
  return mergedRanges;
}
