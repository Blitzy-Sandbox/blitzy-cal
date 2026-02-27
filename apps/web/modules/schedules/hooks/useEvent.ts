import { shallow } from "zustand/shallow";

import { useBookerStoreContext } from "@calcom/features/bookings/Booker/BookerStoreProvider";
import { useSchedule } from "@calcom/web/modules/schedules/hooks/useSchedule";
import { useCompatSearchParams } from "@calcom/lib/hooks/useCompatSearchParams";
import { trpc } from "@calcom/trpc/react";

import { useBookerTime } from "@calcom/features/bookings/Booker/hooks/useBookerTime";
import { useStableTimezone } from "@calcom/features/bookings/Booker/hooks/useStableTimezone";

export type useEventReturnType = ReturnType<typeof useEvent>;
export type useScheduleForEventReturnType = ReturnType<typeof useScheduleForEvent>;

/**
 * Wrapper hook around the trpc query that fetches
 * the event currently viewed in the booker. It will get
 * the current event slug and username from the booker store.
 *
 * Using this hook means you only need to use one hook, instead
 * of combining multiple conditional hooks.
 */
export const useEvent = (props?: { fromRedirectOfNonOrgLink?: boolean; disabled?: boolean }) => {
  const [username, eventSlug, isTeamEvent, org] = useBookerStoreContext(
    (state) => [state.username, state.eventSlug, state.isTeamEvent, state.org],
    shallow
  );

  const event = trpc.viewer.public.event.useQuery(
    {
      username: username ?? "",
      eventSlug: eventSlug ?? "",
      isTeamEvent,
      org: org ?? null,
      fromRedirectOfNonOrgLink: props?.fromRedirectOfNonOrgLink,
    },
    {
      refetchOnWindowFocus: false,
      enabled: !props?.disabled && Boolean(username) && Boolean(eventSlug),
    }
  );

  return {
    data: event?.data,
    isSuccess: event?.isSuccess,
    isError: event?.isError,
    isPending: event?.isPending,
  };
};

/**
 * Gets schedule for the current event and current month.
 * Gets all values right away and not the store because it increases network timing, only for the first render.
 * We can read from the store if we want to get the latest values.
 *
 * Using this hook means you only need to use one hook, instead
 * of combining multiple conditional hooks.
 *
 * The prefetchNextMonth argument can be used to prefetch two months at once,
 * useful when the user is viewing dates near the end of the month,
 * this way the multi day view will show data of both months.
 *
 * **Store vs Props Priority Resolution:**
 * For `username`, `eventSlug`, `month`, and `duration`, values from the
 * BookerStoreContext take priority over the prop values via the nullish
 * coalescing (`??`) operator. This ensures the most recent booker state is
 * always used while still allowing initial values to be passed as props for
 * the first render.
 *
 * **Timezone Stabilization:**
 * The raw timezone obtained from `useBookerTime()` is passed through
 * `useStableTimezone`, which factors in the `restrictionSchedule`'s
 * `useBookerTimezone` flag to produce a stable timezone value that does not
 * flip-flop between renders.
 *
 * **Reschedule UID:**
 * The `rescheduleUid` is extracted from the URL search params
 * (`?rescheduleUid=...`) via `useCompatSearchParams` and forwarded to the
 * underlying `useSchedule` hook so that busy-time calculations can exclude
 * the booking being rescheduled.
 *
 * **Delegation:**
 * After resolving store/prop values and stabilizing the timezone, this hook
 * delegates entirely to `useSchedule` which handles the actual data fetching
 * (via tRPC or API v2) and cache invalidation.
 *
 * **Return Shape:**
 * Returns a curated subset of React Query state — `data`, `isPending`,
 * `isError`, `isSuccess`, `isLoading`, `invalidate`, and `dataUpdatedAt` —
 * to prevent leaking internal React Query internals to consumers.
 */
export const useScheduleForEvent = ({
  username,
  eventSlug,
  eventId,
  month,
  duration,
  dayCount,
  selectedDate,
  orgSlug,
  teamMemberEmail,
  isTeamEvent,
  // Defaults to `true` here (the higher-level composition hook) while `useSchedule`
  // (the lower-level query hook) defaults to `false`. This layered defaulting ensures
  // backward compatibility for direct `useSchedule` consumers while pushing callers
  // that go through `useScheduleForEvent` toward the newer API v2 path.
  useApiV2 = true,
  bookerLayout,
  restrictionSchedule,
}: {
  username?: string | null;
  eventSlug?: string | null;
  eventId?: number | null;
  month?: string | null;
  duration?: number | null;
  dayCount?: number | null;
  selectedDate?: string | null;
  orgSlug?: string;
  teamMemberEmail?: string | null;
  fromRedirectOfNonOrgLink?: boolean;
  isTeamEvent?: boolean;
  useApiV2?: boolean;
  /**
   * Required when prefetching is needed
   */
  bookerLayout?: {
    layout: string;
    extraDays: number;
    columnViewExtraDays: { current: number };
  };
  restrictionSchedule?: { id: number | null; useBookerTimezone: boolean };
}) => {
  const { timezone: rawTimezone } = useBookerTime();
  const [usernameFromStore, eventSlugFromStore, monthFromStore, durationFromStore] = useBookerStoreContext(
    (state) => [state.username, state.eventSlug, state.month, state.selectedDuration],
    shallow
  );

  const effectiveTimezone = useStableTimezone(rawTimezone, restrictionSchedule);

  const searchParams = useCompatSearchParams();
  const rescheduleUid = searchParams?.get("rescheduleUid");

  const schedule = useSchedule({
    username: usernameFromStore ?? username,
    eventSlug: eventSlugFromStore ?? eventSlug,
    eventId,
    timezone: effectiveTimezone,
    selectedDate,
    dayCount,
    rescheduleUid,
    month: monthFromStore ?? month,
    duration: durationFromStore ?? duration,
    isTeamEvent,
    orgSlug,
    teamMemberEmail,
    useApiV2: useApiV2,
    bookerLayout,
  });

  return {
    data: schedule?.data,
    isPending: schedule?.isPending,
    isError: schedule?.isError,
    isSuccess: schedule?.isSuccess,
    isLoading: schedule?.isLoading,
    invalidate: schedule?.invalidate,
    dataUpdatedAt: schedule?.dataUpdatedAt,
  };
};
