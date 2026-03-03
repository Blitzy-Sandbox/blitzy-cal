/**
 * Busy-time limit enforcement pipeline for the availability engine.
 *
 * This module orchestrates the evaluation of booking-count-based, duration-based,
 * and team-scoped booking limits to produce busy-time intervals that the availability
 * engine subtracts from working hours. All functions are instrumented via `withReporting`
 * for Sentry error capture and performance telemetry.
 *
 * Pipeline ordering rationale: Booking-limit enforcement always runs BEFORE duration-limit
 * enforcement because counting bookings is computationally cheaper than aggregating durations
 * (especially for yearly periods). This ordering is intentional and must not be changed.
 *
 * Exported functions:
 * - `getBusyTimesFromLimits` — Main orchestrator composing booking + duration limits
 * - `getBusyTimesFromBookingLimits` — Booking-count limit evaluation with yearly delegation
 * - `getBusyTimesFromTeamLimits` — Team-scoped booking limit evaluation
 *
 * Module-scoped (not exported):
 * - `getBusyTimesFromDurationLimits` — Duration-based limit evaluation
 *
 * @module getBusyTimesFromLimits
 * @see packages/features/busyTimes/services/getBusyTimes.ts for the BusyTimesService that consumes these
 * @see packages/features/di/containers/BusyTimes.ts for DI container wiring
 */
import type { Dayjs } from "@calcom/dayjs";
import dayjs from "@calcom/dayjs";
import type { EventType } from "@calcom/features/availability/lib/getUserAvailability";
import { BookingRepository } from "@calcom/features/bookings/repositories/BookingRepository";
import { getCheckBookingLimitsService } from "@calcom/features/di/containers/BookingLimits";
import { getBusyTimesService } from "@calcom/features/di/containers/BusyTimes";
import { descendingLimitKeys, intervalLimitKeyToUnit } from "@calcom/lib/intervalLimits/intervalLimit";
import type { IntervalLimit } from "@calcom/lib/intervalLimits/intervalLimitSchema";
import LimitManager from "@calcom/lib/intervalLimits/limitManager";
import { isBookingWithinPeriod } from "@calcom/lib/intervalLimits/utils";
import { getPeriodStartDatesBetween } from "@calcom/lib/intervalLimits/utils/getPeriodStartDatesBetween";
import { withReporting } from "@calcom/lib/sentryWrapper";
import { performance } from "@calcom/lib/server/perfObserver";
import prisma from "@calcom/prisma";
import type { EventBusyDetails } from "@calcom/types/Calendar";

/**
 * Core orchestrator for busy-time limit enforcement.
 *
 * Creates a shared `LimitManager` instance and runs two enforcement passes in sequence:
 * 1. **Booking-limit enforcement** (when `bookingLimits` is non-null) — cheaper O(n) counting
 * 2. **Duration-limit enforcement** (when `durationLimits` is non-null) — more expensive minute-level aggregation
 *
 * This ordering is intentional: booking counts are always cheaper to compute than duration
 * sums (especially yearly aggregations), so we run them first to mark periods as busy early,
 * allowing the duration pass to skip already-busy periods via `limitManager.isAlreadyBusy()`.
 *
 * Performance instrumentation via `performance.mark`/`performance.measure` brackets each pass
 * and the overall orchestration for observability.
 *
 * @param bookingLimits - Per-interval booking count limits (e.g., { PER_DAY: 5, PER_WEEK: 20 }), or null
 * @param durationLimits - Per-interval duration limits in minutes (e.g., { PER_DAY: 480 }), or null
 * @param dateFrom - Start of the query window
 * @param dateTo - End of the query window
 * @param duration - Requested event duration in minutes (may be undefined)
 * @param eventType - The event type being checked (non-nullable)
 * @param bookings - Pre-fetched booking busy details for non-yearly limit checks
 * @param timeZone - IANA timezone string for period boundary calculations
 * @param rescheduleUid - Optional UID of a booking being rescheduled (excluded from counts)
 * @returns Aggregated busy-time intervals from the shared LimitManager
 */
const _getBusyTimesFromLimits = async (
  bookingLimits: IntervalLimit | null,
  durationLimits: IntervalLimit | null,
  dateFrom: Dayjs,
  dateTo: Dayjs,
  duration: number | undefined,
  eventType: NonNullable<EventType>,
  bookings: EventBusyDetails[],
  timeZone: string,
  rescheduleUid?: string
) => {
  performance.mark("limitsStart");

  // shared amongst limiters to prevent processing known busy periods
  const limitManager = new LimitManager();

  // run this first, as counting bookings should always run faster..
  if (bookingLimits) {
    performance.mark("bookingLimitsStart");
    await getBusyTimesFromBookingLimits({
      bookings,
      bookingLimits,
      dateFrom,
      dateTo,
      eventTypeId: eventType.id,
      limitManager,
      rescheduleUid,
      timeZone,
    });
    performance.mark("bookingLimitsEnd");
    performance.measure(`checking booking limits took $1'`, "bookingLimitsStart", "bookingLimitsEnd");
  }

  // ..than adding up durations (especially for the whole year)
  if (durationLimits) {
    performance.mark("durationLimitsStart");
    await getBusyTimesFromDurationLimits(
      bookings,
      durationLimits,
      dateFrom,
      dateTo,
      duration,
      eventType,
      limitManager,
      timeZone,
      rescheduleUid
    );
    performance.mark("durationLimitsEnd");
    performance.measure(`checking duration limits took $1'`, "durationLimitsStart", "durationLimitsEnd");
  }

  performance.mark("limitsEnd");
  performance.measure(`checking all limits took $1'`, "limitsStart", "limitsEnd");

  return limitManager.getBusyTimes();
};

/**
 * Evaluates booking-count limits across all configured interval types.
 *
 * Algorithm:
 * 1. Iterates interval keys in descending order (yearly → monthly → weekly → daily) via `descendingLimitKeys`
 * 2. For each configured limit, generates period start dates covering [dateFrom, dateTo]
 * 3. Skips periods already marked busy by `limitManager.isAlreadyBusy()` (optimization)
 * 4. **Yearly intervals**: Delegates to `getCheckBookingLimitsService()` (DI-provided) for database-level
 *    counting, which avoids loading all yearly bookings into memory. Catches limit-exceeded exceptions
 *    and marks the period busy. Performs early return if ALL periods in the range are busy.
 * 5. **Finer intervals** (month, week, day): Iterates pre-fetched `bookings` array, using
 *    `isBookingWithinPeriod()` for overlap detection. Marks period busy when `totalBookings >= limit`.
 *
 * The descending-key ordering ensures that if a larger interval (e.g., yearly) is fully busy,
 * smaller intervals within it can be skipped in subsequent passes.
 *
 * @param params.bookings - Pre-fetched booking busy details for non-yearly counting
 * @param params.bookingLimits - Per-interval booking count limits
 * @param params.dateFrom - Start of the query window
 * @param params.dateTo - End of the query window
 * @param params.limitManager - Shared LimitManager for cross-limit coordination
 * @param params.rescheduleUid - Optional UID to exclude from counts
 * @param params.eventTypeId - Event type ID for yearly delegation
 * @param params.teamId - Optional team ID for team-scoped limits
 * @param params.user - Optional user for yearly delegation
 * @param params.includeManagedEvents - Whether to include managed events in yearly counts
 * @param params.timeZone - IANA timezone for period boundary and overlap calculations
 */
const _getBusyTimesFromBookingLimits = async (params: {
  bookings: EventBusyDetails[];
  bookingLimits: IntervalLimit;
  dateFrom: Dayjs;
  dateTo: Dayjs;
  limitManager: LimitManager;
  rescheduleUid?: string;
  eventTypeId?: number;
  teamId?: number;
  user?: { id: number; email: string };
  includeManagedEvents?: boolean;
  timeZone?: string | null;
}) => {
  const {
    bookings,
    bookingLimits,
    dateFrom,
    dateTo,
    limitManager,
    eventTypeId,
    teamId,
    user,
    rescheduleUid,
    includeManagedEvents = false,
    timeZone,
  } = params;

  for (const key of descendingLimitKeys) {
    const limit = bookingLimits?.[key];
    if (!limit) continue;

    const unit = intervalLimitKeyToUnit(key);
    const periodStartDates = getPeriodStartDatesBetween(dateFrom, dateTo, unit);

    for (const periodStart of periodStartDates) {
      if (limitManager.isAlreadyBusy(periodStart, unit)) continue;

      // special handling of yearly limits to improve performance
      if (unit === "year") {
        try {
          const checkBookingLimitsService = getCheckBookingLimitsService();
          await checkBookingLimitsService.checkBookingLimit({
            eventStartDate: periodStart.toDate(),
            limitingNumber: limit,
            eventId: eventTypeId,
            key,
            teamId,
            user,
            rescheduleUid,
            includeManagedEvents,
            timeZone,
          });
        } catch (_) {
          limitManager.addBusyTime(periodStart, unit);
          if (periodStartDates.every((start) => limitManager.isAlreadyBusy(start, unit))) {
            return;
          }
        }
        continue;
      }

      const periodEnd = periodStart.endOf(unit);
      let totalBookings = 0;

      for (const booking of bookings) {
        // consider booking part of period independent of end date
        if (!isBookingWithinPeriod(booking, periodStart, periodEnd, timeZone || "UTC")) {
          continue;
        }
        totalBookings++;
        if (totalBookings >= limit) {
          limitManager.addBusyTime(periodStart, unit);
          break;
        }
      }
    }
  }
};
/**
 * Evaluates duration-based limits across all configured interval types.
 *
 * Algorithm:
 * 1. Iterates interval keys in descending order via `descendingLimitKeys`
 * 2. For each configured limit, generates period start dates covering [dateFrom, dateTo]
 * 3. Skips periods already marked busy by `limitManager.isAlreadyBusy()`
 * 4. Computes `selectedDuration` from explicit `duration` parameter or `eventType.length` (fallback to 0)
 * 5. **Immediate busy**: If `selectedDuration > limit`, marks period busy without further checking
 * 6. **Yearly intervals**: Delegates to `BookingRepository.getTotalBookingDuration()` for
 *    database-level aggregation. Marks busy when `totalYearlyDuration + selectedDuration > limit`.
 *    Performs early return if ALL periods are busy.
 * 7. **Finer intervals**: Initializes `totalDuration` with `selectedDuration`, then sums
 *    overlapping booking durations via `dayjs(booking.end).diff(dayjs(booking.start), "minute")`.
 *    Marks busy when `totalDuration > limit`.
 *
 * NOTE: The duration threshold uses strict `>` (not `>=`) — a period is only marked busy when
 * the total duration EXCEEDS the limit, allowing exact-limit bookings to proceed.
 *
 * @param bookings - Pre-fetched booking busy details for non-yearly summing
 * @param durationLimits - Per-interval duration limits in minutes
 * @param dateFrom - Start of the query window
 * @param dateTo - End of the query window
 * @param duration - Requested event duration in minutes (may be undefined)
 * @param eventType - The event type being checked (provides `length` fallback and `id`)
 * @param limitManager - Shared LimitManager for cross-limit coordination
 * @param timeZone - IANA timezone for period boundary calculations
 * @param rescheduleUid - Optional UID to exclude from duration aggregation
 */
const _getBusyTimesFromDurationLimits = async (
  bookings: EventBusyDetails[],
  durationLimits: IntervalLimit,
  dateFrom: Dayjs,
  dateTo: Dayjs,
  duration: number | undefined,
  eventType: NonNullable<EventType>,
  limitManager: LimitManager,
  timeZone: string,
  rescheduleUid?: string
) => {
  for (const key of descendingLimitKeys) {
    const limit = durationLimits?.[key];
    if (!limit) continue;

    const unit = intervalLimitKeyToUnit(key);
    const periodStartDates = getPeriodStartDatesBetween(dateFrom, dateTo, unit);

    for (const periodStart of periodStartDates) {
      if (limitManager.isAlreadyBusy(periodStart, unit)) continue;

      const selectedDuration = (duration || eventType.length) ?? 0;

      if (selectedDuration > limit) {
        limitManager.addBusyTime(periodStart, unit);
        continue;
      }

      // special handling of yearly limits to improve performance
      if (unit === "year") {
        const bookingRepo = new BookingRepository(prisma);
        const totalYearlyDuration = await bookingRepo.getTotalBookingDuration({
          eventId: eventType.id,
          startDate: periodStart.toDate(),
          endDate: periodStart.endOf(unit).toDate(),
          rescheduleUid,
        });
        if (totalYearlyDuration + selectedDuration > limit) {
          limitManager.addBusyTime(periodStart, unit);
          if (periodStartDates.every((start) => limitManager.isAlreadyBusy(start, unit))) {
            return;
          }
        }
        continue;
      }

      const periodEnd = periodStart.endOf(unit);
      let totalDuration = selectedDuration;

      for (const booking of bookings) {
        // consider booking part of period independent of end date
        if (!isBookingWithinPeriod(booking, periodStart, periodEnd, timeZone || "UTC")) {
          continue;
        }
        totalDuration += dayjs(booking.end).diff(dayjs(booking.start), "minute");
        if (totalDuration > limit) {
          limitManager.addBusyTime(periodStart, unit);
          break;
        }
      }
    }
  }
};

/** Module-scoped (not exported) — wrapped with withReporting for instrumentation. */
const getBusyTimesFromDurationLimits = withReporting(
  _getBusyTimesFromDurationLimits,
  "getBusyTimesFromDurationLimits"
);

/**
 * Evaluates booking-count limits scoped to a specific team.
 *
 * Pipeline:
 * 1. Uses `getBusyTimesService()` (DI-provided) to determine the precise query window
 *    via `getStartEndDateforLimitCheck()`, expanding [dateFrom, dateTo] to calendar-unit boundaries
 * 2. Fetches the user's accepted team bookings via `BookingRepository.getAllAcceptedTeamBookingsOfUser()`,
 *    optionally including managed events based on `includeManagedEvents` flag
 * 3. Maps Prisma booking results to `EventBusyDetails` format (start, end, title, source, userId)
 * 4. Creates a fresh `LimitManager` (separate from the main orchestrator's instance)
 * 5. Reuses `getBusyTimesFromBookingLimits` with team metadata (teamId, user, includeManagedEvents)
 *    to leverage the same descending-key iteration and yearly delegation logic
 * 6. Returns team-aware busy intervals from the team-specific LimitManager
 *
 * NOTE: This function creates its own LimitManager rather than sharing the one from
 * `_getBusyTimesFromLimits`, because team limits operate on a different booking set
 * (team bookings vs. individual bookings).
 *
 * @param user - User identity (id + email) for team booking queries
 * @param bookingLimits - Per-interval booking count limits for the team
 * @param dateFrom - Start of the query window
 * @param dateTo - End of the query window
 * @param teamId - Team ID to scope the booking query
 * @param includeManagedEvents - Whether to include managed events in team counts
 * @param timeZone - IANA timezone for period boundary calculations
 * @param rescheduleUid - Optional UID to exclude from team counts
 */
const _getBusyTimesFromTeamLimits = async (
  user: { id: number; email: string },
  bookingLimits: IntervalLimit,
  dateFrom: Dayjs,
  dateTo: Dayjs,
  teamId: number,
  includeManagedEvents: boolean,
  timeZone: string,
  rescheduleUid?: string
) => {
  const busyTimesService = getBusyTimesService();
  const { limitDateFrom, limitDateTo } = busyTimesService.getStartEndDateforLimitCheck(
    dateFrom.toISOString(),
    dateTo.toISOString(),
    bookingLimits
  );

  const bookingRepo = new BookingRepository(prisma);
  const bookings = await bookingRepo.getAllAcceptedTeamBookingsOfUser({
    user,
    teamId,
    startDate: limitDateFrom.toDate(),
    endDate: limitDateTo.toDate(),
    excludedUid: rescheduleUid,
    includeManagedEvents,
  });

  const busyTimes = bookings.map(({ id, startTime, endTime, eventTypeId, title, userId }) => ({
    start: dayjs(startTime).toDate(),
    end: dayjs(endTime).toDate(),
    title,
    source: `eventType-${eventTypeId}-booking-${id}`,
    userId,
  }));

  const limitManager = new LimitManager();

  await getBusyTimesFromBookingLimits({
    bookings: busyTimes,
    bookingLimits,
    dateFrom,
    dateTo,
    limitManager,
    rescheduleUid,
    teamId,
    user,
    includeManagedEvents,
    timeZone,
  });

  return limitManager.getBusyTimes();
};

/** Main orchestrator — composes booking-limit + duration-limit enforcement. */
export const getBusyTimesFromLimits = withReporting(_getBusyTimesFromLimits, "getBusyTimesFromLimits");

/** Booking-count limit evaluator — also reused by team limits. */
export const getBusyTimesFromBookingLimits = withReporting(
  _getBusyTimesFromBookingLimits,
  "getBusyTimesFromBookingLimits"
);

/** Team-scoped booking limit evaluator — fetches team bookings and delegates to booking-count logic. */
export const getBusyTimesFromTeamLimits = withReporting(
  _getBusyTimesFromTeamLimits,
  "getBusyTimesFromTeamLimits"
);
