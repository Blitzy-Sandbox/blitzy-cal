import { shallow } from "zustand/shallow";

import dayjs from "@calcom/dayjs";
import { useBookerStoreContext } from "@calcom/features/bookings/Booker/BookerStoreProvider";
import type { BookerState } from "@calcom/features/bookings/Booker/types";
import { getPrefetchMonthCount } from "@calcom/features/bookings/Booker/utils/getPrefetchMonthCount";
import { isPrefetchNextMonthEnabled } from "@calcom/features/bookings/Booker/utils/isPrefetchNextMonthEnabled";

/**
 * Full argument set for schedule-fetching hooks that need cache integration.
 *
 * Consumed by downstream hooks (e.g. `useSchedule`, Platform Atoms `BookerPlatformWrapper`,
 * `EventTypeCalendarViewComponent`) to derive cache keys and configure the schedule query.
 *
 * @remarks
 * This type is part of the public API contract consumed by Platform SDK atoms and
 * web app hooks. Changes to field names or types are breaking changes — see Rule 0.7.4.
 */
type UseScheduleWithCacheArgs = {
  /** Booking user's username slug */
  username?: string | null;
  /** Event type slug for the booking page */
  eventSlug?: string | null;
  /** Numeric event type ID */
  eventId?: number | null;
  /** ISO-8601 month string (e.g. "2024-01") — overridden by BookerStore when present */
  month?: string | null;
  /** IANA timezone identifier for the invitee's display context */
  timezone?: string | null;
  /** ISO-8601 date string of the user's selected date (e.g. "2024-01-15") */
  selectedDate?: string | null;
  /** Requested event duration in minutes */
  duration?: number | null;
  /** Number of days to fetch when in day-count mode (e.g. week/column layouts) */
  dayCount?: number | null;
  /** UID of an existing booking being rescheduled — excludes it from busy-time checks */
  rescheduleUid?: string | null;
  /** Whether this schedule belongs to a team event type */
  isTeamEvent?: boolean;
  /** Organization slug for multi-tenant routing */
  orgSlug?: string;
  /** Team member email for team event host resolution */
  teamMemberEmail?: string | null;
  /** Feature flag to route requests through API v2 instead of tRPC */
  useApiV2?: boolean;
  /** Controls whether the query is enabled — false prevents fetching */
  enabled?: boolean;
  /**
   * Required when prefetching is needed.
   *
   * Provides the current booker layout string and the extra-day offsets used to
   * determine whether the next month's data should be prefetched.
   */
  bookerLayout?: {
    layout: string;
    extraDays: number;
    columnViewExtraDays: { current: number };
  };
};

type UseTimesForScheduleProps = Pick<
  UseScheduleWithCacheArgs,
  "month" | "dayCount" | "selectedDate" | "bookerLayout"
>;

interface UsePrefetchParams {
  date: string;
  month: string | null;
  bookerLayout?: {
    layout: string;
    extraDays: number;
    columnViewExtraDays: { current: number };
  };
  bookerState: BookerState;
}

/**
 * Internal helper that determines how many additional months to prefetch based on
 * the current booker layout and navigation state.
 *
 * Delegates to shared booking utilities (`isPrefetchNextMonthEnabled`,
 * `getPrefetchMonthCount`) to keep layout heuristics DRY with the Booker system.
 *
 * @returns `{ monthsToPrefetch: number }` when prefetching is warranted, or `null`
 *          when no prefetch is needed (missing layout or prefetch disabled).
 */
const usePrefetch = ({ date, month, bookerLayout, bookerState }: UsePrefetchParams) => {
  // Bail out early when no booker layout is provided — prefetch cannot be determined
  if (!bookerLayout) {
    return null;
  }

  const dateMonth = dayjs(date).month();
  const monthAfterAdding1Month = dayjs(date).add(1, "month").month();
  const monthAfterAddingExtraDays = dayjs(date).add(bookerLayout.extraDays, "day").month();
  const monthAfterAddingExtraDaysColumnView = dayjs(date)
    .add(bookerLayout.columnViewExtraDays.current, "day")
    .month();

  const prefetchNextMonth = isPrefetchNextMonthEnabled(
    bookerLayout.layout,
    date,
    dateMonth,
    monthAfterAddingExtraDays,
    monthAfterAddingExtraDaysColumnView,
    month,
    bookerLayout.extraDays
  );

  if (!prefetchNextMonth) {
    return null;
  }

  const monthCount = getPrefetchMonthCount(
    bookerLayout.layout,
    bookerState,
    monthAfterAdding1Month,
    monthAfterAddingExtraDaysColumnView,
    prefetchNextMonth
  );

  // Normalize to at least 1 month when prefetching is enabled — ensures we always
  // extend the window even if getPrefetchMonthCount returns null.
  return { monthsToPrefetch: monthCount ?? 1 };
};

/**
 * Single source of truth for the schedule time-range window used by booker layouts.
 *
 * Computes a `[startTime, endTime]` ISO-8601 UTC tuple that defines the date window
 * for which availability data should be fetched. The window is determined by two
 * distinct strategies:
 *
 * 1. **Day-count mode** (`dayCount > 0`): Used by week, column, and mobile layouts.
 *    The window spans exactly `dayCount` days from the selected date (or today / month
 *    start as fallback).
 *
 * 2. **Month mode** (default): The window spans at least one full calendar month,
 *    optionally extended by `monthsToPrefetch` additional months when the booker layout
 *    heuristics indicate the user is likely to navigate forward.
 *
 * **Month resolution priority**: BookerStore `month` → props `month` → current date.
 *
 * @returns A `[startTime, endTime]` tuple of ISO-8601 UTC strings.
 *
 * @remarks
 * All date-time operations use `@calcom/dayjs` (Rule 0.7.2). The `toISOString()`
 * output is always UTC-based, so DST transitions do not affect the window boundaries.
 */
export const useTimesForSchedule = ({
  month: monthFromProps,
  selectedDate,
  dayCount,
  bookerLayout,
}: UseTimesForScheduleProps): [string, string] => {
  const [monthFromStore, bookerState] = useBookerStoreContext((state) => [state.month, state.state], shallow);
  // Month resolution priority: store value > props value > null (falls back to current date below)
  const month = monthFromStore ?? monthFromProps ?? null;
  // NOTE: When selectedDate is null/undefined, dayjs(null).format() produces "Invalid Date".
  // This is safe because the "Invalid Date" string is only consumed by usePrefetch where it
  // may produce NaN month indexes, but usePrefetch's result does not affect startTime/endTime
  // in the non-dayCount path (which uses monthDayjs instead).
  const date = dayjs(selectedDate).format("YYYY-MM-DD");
  const prefetchData = usePrefetch({
    date,
    month,
    bookerLayout,
    bookerState,
  });

  const now = dayjs();
  const monthDayjs = month ? dayjs(month) : now;

  let startTime;
  let endTime;

  // Guard filters out 0, negative, null, and undefined — all fall through to the month-based path.
  if (!!dayCount && dayCount > 0) {
    if (selectedDate) {
      startTime = dayjs(selectedDate).toISOString();
      endTime = dayjs(selectedDate).add(dayCount, "day").toISOString();
    } else if (monthDayjs.month() === now.month()) {
      startTime = now.startOf("day").toISOString();
      endTime = now.startOf("day").add(dayCount, "day").toISOString();
    } else {
      startTime = monthDayjs.startOf("month").toISOString();
      endTime = monthDayjs.startOf("month").add(dayCount, "day").toISOString();
    }
  } else {
    const monthsToPrefetch = prefetchData?.monthsToPrefetch;
    const lastMonthToPrefetchDayjs = monthsToPrefetch ? monthDayjs.add(monthsToPrefetch, "month") : null;
    startTime = monthDayjs.startOf("month").toISOString();
    endTime = (lastMonthToPrefetchDayjs ? lastMonthToPrefetchDayjs : monthDayjs).endOf("month").toISOString();
  }
  return [startTime, endTime];
};
