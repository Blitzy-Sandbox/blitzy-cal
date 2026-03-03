import type { Dayjs } from "@calcom/dayjs";
import dayjs from "@calcom/dayjs";
import type {
  IFromUser,
  IOutOfOfficeData,
  IToUser,
} from "@calcom/features/availability/lib/getUserAvailability";
import type { DateRange } from "@calcom/features/schedules/lib/date-ranges";
import { getTimeZone } from "@calcom/lib/dayjs";
import { withReporting } from "@calcom/lib/sentryWrapper";

/**
 * Input configuration for the slot generation engine.
 *
 * @property inviteeDate - The reference date in the invitee's local timezone, used to derive the
 *   display timezone for all generated slot times via `getTimeZone`.
 * @property frequency - The recurrence interval in minutes between consecutive slot start times
 *   (e.g., 15, 30, 60). Clamped to a minimum of 1 by `minimumOfOne`.
 * @property dateRanges - Array of available `DateRange` windows (start/end Dayjs pairs) produced
 *   by the upstream date-range processor after subtracting busy times and applying working hours.
 * @property minimumBookingNotice - Number of minutes from the current UTC moment within which
 *   slots are filtered out, enforcing the event type's minimum notice period.
 * @property eventLength - Duration of the event in minutes. A candidate slot is only emitted if
 *   the full event length fits within the remaining range (inclusive 1-second boundary).
 * @property offsetStart - Optional additional minutes to add to each slot start time, shifting
 *   the entire slot grid forward. Defaults to 0 and is clamped to a minimum of 1 when provided.
 * @property datesOutOfOffice - Optional lookup map keyed by "YYYY-MM-DD" containing OOO metadata
 *   (away flag, fromUser, toUser, reason, emoji, notes, showNotePublicly) to merge into slot data.
 * @property showOptimizedSlots - When true, the slot alignment algorithm attempts to nudge start
 *   times to cleaner boundaries (interval → 15-min → 5-min) while preserving maximum slot count.
 *   When false or absent, snaps to the top of the hour and rounds up to the nearest interval.
 * @property datesOutOfOfficeTimeZone - Optional IANA timezone string for resolving OOO date keys.
 *   When set, slot dates are converted to this timezone before looking up OOO data; otherwise UTC.
 */
export type GetSlots = {
  inviteeDate: Dayjs;
  frequency: number;
  dateRanges: DateRange[];
  minimumBookingNotice: number;
  eventLength: number;
  offsetStart?: number;
  datesOutOfOffice?: IOutOfOfficeData;
  showOptimizedSlots?: boolean | null;
  datesOutOfOfficeTimeZone?: string;
};
/**
 * Represents a discrete time window associated with one or more users.
 *
 * @property userIds - Optional array of user IDs whose availability contributes to this frame.
 * @property startTime - Numeric start boundary (minutes from midnight in working-hours context).
 * @property endTime - Numeric end boundary (minutes from midnight in working-hours context).
 */
export type TimeFrame = { userIds?: number[]; startTime: number; endTime: number };

/**
 * Safety guard that clamps a numeric input to a minimum value of 1.
 * Applied to `frequency`, `eventLength`, and `offsetStart` before slot generation
 * to prevent zero-division, infinite loops, or nonsensical zero-length events.
 */
const minimumOfOne = (input: number) => (input < 1 ? 1 : input);

/**
 * Aligns a candidate slot start time to a clean boundary within the given date range.
 *
 * This function implements two distinct alignment strategies:
 *
 * **Optimized mode** (`showOptimizedSlots = true`):
 * Attempts a three-tier boundary nudge while preserving maximum possible slot count:
 *   1. Tries to advance to the next full interval boundary (e.g., top of the hour for 60-min events)
 *   2. Falls back to the next 15-minute boundary if insufficient extra minutes exist
 *   3. Falls back to the next 5-minute boundary as a final attempt
 * Each nudge is only applied when the "extra minutes" (total range remainder after fitting
 * maximum slots) are sufficient to cover the required forward shift. This guarantees no slot
 * loss while producing cleaner start times for the invitee.
 *
 * **Standard mode** (`showOptimizedSlots = false | null | undefined`):
 * Snaps to the top of the current hour, then rounds up to the nearest interval multiple.
 * This may produce fewer slots than optimized mode for ranges starting mid-interval.
 *
 * @param slotStartTime - The raw candidate start time (already in target timezone).
 * @param range - The date range window constraining available minutes.
 * @param showOptimizedSlots - Flag selecting the alignment strategy.
 * @param interval - The highest divisor of frequency from [60, 30, 20, 15, 10, 5] used for snapping.
 * @returns The corrected slot start time aligned to the appropriate boundary.
 */
function getCorrectedSlotStartTime({
  slotStartTime,
  range,
  showOptimizedSlots,
  interval,
}: {
  showOptimizedSlots: boolean | null | undefined;
  interval: number;
  slotStartTime: Dayjs;
  range: DateRange;
}) {
  if (showOptimizedSlots) {
    let correctedSlotStartTime = slotStartTime;
    // if showOptimizedSlots option is selected, the slotStartTime should not be modified,
    // so that maximum possible slots are shown.
    // The below logic in this entire `if branch` only tries to add an increment if sufficient minutes are available (after max possible slots are consumed),
    // so that slots are shown respecting the 'Start of the Hour'.
    const minutesRequiredToMoveToNextSlot = interval - (slotStartTime.minute() % interval);
    const minutesRequiredToMoveTo15MinSlot = 15 - (slotStartTime.minute() % 15);
    const minutesRequiredToMoveTo5MinSlot = 5 - (slotStartTime.minute() % 5);
    const extraMinutesAvailable = range.end.diff(slotStartTime, "minutes") % interval;

    if (extraMinutesAvailable >= minutesRequiredToMoveToNextSlot) {
      // For cases like, Availability -> 9:05 - 12:00, 60Min EventTypes.
      // Total available minutes are 175, so only 2 60Min slots can be provided max
      // And still 175-120 = 55mins are available, hence 'slotStartTime' is pushed to 10:00 to respect 'Start of the Hour'.
      // Slots will be shown as '10:00, 11:00' instead of '09:05, 10:05'
      correctedSlotStartTime = slotStartTime.add(minutesRequiredToMoveToNextSlot, "minute");
    } else if (extraMinutesAvailable >= minutesRequiredToMoveTo15MinSlot) {
      // For cases like, Availability -> 9:05 - 11:55, 60Min EventTypes.
      // Total available minutes are 170, so only 2 60Min slots can be provided max
      // And still 175-120 = 50mins are available, but it is less 55mins which is required to push to 10:00
      // so slotStartTime is pushed to next 15Min slot 09:15, instead of showing slots like 9:05,10:05 now slots will be 9:15,10:15
      correctedSlotStartTime = slotStartTime.add(minutesRequiredToMoveTo15MinSlot, "minute");
    } else if (extraMinutesAvailable >= minutesRequiredToMoveTo5MinSlot) {
      // so slotStartTime is pushed to next 5Min, instead of showing slots like 11:22,11:37 now slots will be 11:25,11:40
      correctedSlotStartTime = slotStartTime.add(minutesRequiredToMoveTo5MinSlot, "minute");
    }
    return correctedSlotStartTime;
  }

  return slotStartTime.startOf("hour").add(Math.ceil(slotStartTime.minute() / interval) * interval, "minute");
}

/**
 * Core slot generation engine that transforms timezone-aware date ranges into bookable time slots.
 *
 * **Pipeline overview:**
 * 1. **Input normalization** — `frequency`, `eventLength`, and `offsetStart` are clamped via
 *    `minimumOfOne` to prevent zero-division or infinite-loop edge cases.
 * 2. **Range sorting** — Date ranges are sorted ascending by start time to ensure deterministic
 *    slot ordering and correct boundary coordination between adjacent ranges.
 * 3. **Interval detection** — Reads `NEXT_PUBLIC_AVAILABILITY_SCHEDULE_INTERVAL` env var, then
 *    selects the highest divisor from [60, 30, 20, 15, 10, 5] that evenly divides the frequency.
 *    This determines the alignment grid for slot start times.
 * 4. **Notice window enforcement** — Computes `dayjs.utc().add(minimumBookingNotice, "minute")` as
 *    the earliest allowable slot start. Slots before this threshold are skipped.
 * 5. **Timezone conversion** — Each range's start is converted to the target timezone BEFORE
 *    checking interval alignment. This prevents misalignment in half-hour offset timezones
 *    like Asia/Kolkata (GMT+5:30).
 * 6. **Slot alignment** — If the local-time minute is not aligned to the interval grid,
 *    `getCorrectedSlotStartTime` applies optimized or standard boundary snapping.
 * 7. **Boundary tracking** — A `slotBoundaries` Map records the start timestamp of every emitted
 *    slot. When processing subsequent overlapping ranges, boundary coordination ensures slots
 *    align with previously emitted boundaries rather than creating duplicates or gaps.
 * 8. **Event length fit check** — A slot is only emitted when `slotStart + eventLength - 1s` does
 *    not exceed the range end (the 1-second subtraction makes the boundary inclusive).
 * 9. **ISO-keyed deduplication** — A `Map<string, SlotData>` keyed by the ISO timestamp ensures
 *    each start time appears at most once, even across overlapping date ranges.
 * 10. **OOO metadata propagation** — For each slot, the generator looks up the corresponding date
 *     in `datesOutOfOffice` (using `datesOutOfOfficeTimeZone` when set, otherwise UTC) and merges
 *     away status, fromUser, toUser, reason, emoji, notes, and showNotePublicly into the slot data.
 *
 * **Complexity**: O(total_slots) — each range is iterated once, each slot is a constant-time Map
 * insertion, and boundary coordination is linear in the number of previously emitted boundaries.
 *
 * @param dateRanges - Available time windows after busy-time subtraction.
 * @param frequency - Interval in minutes between consecutive slot starts.
 * @param eventLength - Duration in minutes of the event being scheduled.
 * @param timeZone - IANA timezone for slot display (derived from invitee date).
 * @param minimumBookingNotice - Minutes of advance notice required before a slot is bookable.
 * @param offsetStart - Optional forward shift in minutes applied to every slot start.
 * @param datesOutOfOffice - Optional OOO metadata map keyed by "YYYY-MM-DD".
 * @param showOptimizedSlots - Controls the slot alignment strategy (optimized vs. standard).
 * @param datesOutOfOfficeTimeZone - Optional timezone for OOO date key resolution.
 * @returns Array of slot objects, each containing a `time` Dayjs and optional OOO metadata.
 */
function buildSlotsWithDateRanges({
  dateRanges,
  frequency,
  eventLength,
  timeZone,
  minimumBookingNotice,
  offsetStart,
  datesOutOfOffice,
  showOptimizedSlots,
  datesOutOfOfficeTimeZone,
}: {
  dateRanges: DateRange[];
  frequency: number;
  eventLength: number;
  timeZone: string;
  minimumBookingNotice: number;
  offsetStart?: number;
  datesOutOfOffice?: IOutOfOfficeData;
  showOptimizedSlots?: boolean | null;
  datesOutOfOfficeTimeZone?: string;
}) {
  // keep the old safeguards in; may be needed.
  frequency = minimumOfOne(frequency);
  eventLength = minimumOfOne(eventLength);
  offsetStart = offsetStart ? minimumOfOne(offsetStart) : 0;

  const orderedDateRanges = dateRanges.sort((a, b) => a.start.valueOf() - b.start.valueOf());

  // there can only ever be one slot at a given start time, and based on duration also only a single length.
  const slots = new Map<
    string,
    {
      time: Dayjs;
      userIds?: number[];
      away?: boolean;
      fromUser?: IFromUser;
      toUser?: IToUser;
      reason?: string;
      emoji?: string;
    }
  >();

  let interval = Number(process.env.NEXT_PUBLIC_AVAILABILITY_SCHEDULE_INTERVAL) || 1;
  const intervalsWithDefinedStartTimes = [60, 30, 20, 15, 10, 5];

  for (let i = 0; i < intervalsWithDefinedStartTimes.length; i++) {
    if (frequency % intervalsWithDefinedStartTimes[i] === 0) {
      interval = intervalsWithDefinedStartTimes[i];
      break;
    }
  }

  const startTimeWithMinNotice = dayjs.utc().add(minimumBookingNotice, "minute");

  const slotBoundaries = new Map<number, true>();

  orderedDateRanges.forEach((range) => {
    let slotStartTime = range.start.utc().isAfter(startTimeWithMinNotice)
      ? range.start
      : startTimeWithMinNotice;

    // For current day bookings, normalizing the seconds to zero to avoid issues with time calculations
    slotStartTime = slotStartTime.set("second", 0).set("millisecond", 0);

    // Convert to target timezone BEFORE checking if rounding is needed
    // This ensures we check minute alignment in the local timezone, not UTC
    // This prevents issues with half-hour offset timezones like Asia/Kolkata (GMT+5:30)
    slotStartTime = slotStartTime.tz(timeZone);

    if (slotStartTime.minute() % interval !== 0) {
      slotStartTime = getCorrectedSlotStartTime({
        showOptimizedSlots,
        interval,
        slotStartTime,
        range,
      });
    }

    slotStartTime = slotStartTime.add(offsetStart ?? 0, "minutes");

    // Find the nearest appropriate slot boundary if this time falls within an existing slot
    const slotBoundariesValueArray = Array.from(slotBoundaries.keys());
    if (slotBoundariesValueArray.length > 0) {
      slotBoundariesValueArray.sort((a, b) => a - b);

      let prevBoundary = null;
      for (let i = slotBoundariesValueArray.length - 1; i >= 0; i--) {
        if (slotBoundariesValueArray[i] < slotStartTime.valueOf()) {
          prevBoundary = slotBoundariesValueArray[i];
          break;
        }
      }

      if (prevBoundary) {
        const prevBoundaryEnd = dayjs(prevBoundary).add(frequency + (offsetStart ?? 0), "minutes");
        if (prevBoundaryEnd.isAfter(slotStartTime)) {
          const dayjsPrevBoundary = dayjs(prevBoundary);
          if (!dayjsPrevBoundary.isBefore(range.start)) {
            slotStartTime = dayjsPrevBoundary;
          } else {
            slotStartTime = prevBoundaryEnd;
          }
          slotStartTime = slotStartTime.tz(timeZone);
        }
      }
    }

    while (!slotStartTime.add(eventLength, "minutes").subtract(1, "second").utc().isAfter(range.end)) {
      const slotKey = slotStartTime.toISOString();
      if (slots.has(slotKey)) {
        slotStartTime = slotStartTime.add(frequency + (offsetStart ?? 0), "minutes");
        continue;
      }

      slotBoundaries.set(slotStartTime.valueOf(), true);

      let dateOutOfOfficeExists = undefined;
      if (datesOutOfOffice) {
        const slotDateYYYYMMDD = datesOutOfOfficeTimeZone
          ? slotStartTime.tz(datesOutOfOfficeTimeZone).format("YYYY-MM-DD")
          : slotStartTime.utc().format("YYYY-MM-DD");
        dateOutOfOfficeExists = datesOutOfOffice?.[slotDateYYYYMMDD];
      }

      let slotData: {
        time: Dayjs;
        userIds?: number[];
        away?: boolean;
        fromUser?: IFromUser;
        toUser?: IToUser;
        reason?: string;
        emoji?: string;
        notes?: string | null;
        showNotePublicly?: boolean;
      } = {
        time: slotStartTime,
      };

      if (dateOutOfOfficeExists) {
        const { toUser, fromUser, reason, emoji, notes, showNotePublicly } = dateOutOfOfficeExists;

        slotData = {
          time: slotStartTime,
          away: true,
          ...(fromUser && { fromUser }),
          ...(toUser && { toUser }),
          ...(reason && { reason }),
          ...(emoji && { emoji }),
          ...(notes && showNotePublicly && { notes }),
          ...(showNotePublicly !== undefined && { showNotePublicly }),
        };
      }

      slots.set(slotKey, slotData);
      slotStartTime = slotStartTime.add(frequency + (offsetStart ?? 0), "minutes");
    }
  });

  return Array.from(slots.values());
}

/**
 * Public API entry point for slot generation.
 *
 * Resolves the invitee's display timezone from `inviteeDate` via `getTimeZone`, then delegates
 * to `buildSlotsWithDateRanges` for the full generation pipeline. This function is wrapped with
 * `withReporting` (Sentry instrumentation) and exported as the module's default export.
 *
 * @param config - A `GetSlots` configuration object containing all scheduling parameters.
 * @returns Array of slot objects with `time` (Dayjs in invitee timezone) and optional metadata
 *   including `userIds`, `away`, `fromUser`, `toUser`, `reason`, `emoji`.
 */
const getSlots = ({
  inviteeDate,
  frequency,
  minimumBookingNotice,
  dateRanges,
  eventLength,
  offsetStart = 0,
  datesOutOfOffice,
  showOptimizedSlots,
  datesOutOfOfficeTimeZone,
}: GetSlots): {
  time: Dayjs;
  userIds?: number[];
  away?: boolean;
  fromUser?: IFromUser;
  toUser?: IToUser;
  reason?: string;
  emoji?: string;
}[] => {
  return buildSlotsWithDateRanges({
    dateRanges,
    frequency,
    eventLength,
    timeZone: getTimeZone(inviteeDate),
    minimumBookingNotice,
    offsetStart,
    datesOutOfOffice,
    showOptimizedSlots,
    datesOutOfOfficeTimeZone,
  });
};

export default withReporting(getSlots, "getSlots");
