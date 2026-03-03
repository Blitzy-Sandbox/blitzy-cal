import type { GetUserAvailabilityInitialData } from "./getUserAvailability";

/**
 * Represents a schedule entity without a guaranteed timezone.
 *
 * This is an intermediate type used during schedule resolution before the timezone
 * fallback chain is applied. The `availability` array defines recurring or date-specific
 * working windows, where `days` maps to ISO weekday numbers (1=Monday … 7=Sunday),
 * `startTime`/`endTime` are epoch-anchored time-of-day markers (1970-01-01),
 * and `date` is non-null only for date-specific overrides.
 */
export type ScheduleWithoutTimeZone = {
  id: number;
  availability?: {
    days: number[];
    startTime: Date;
    endTime: Date;
    date: Date | null;
  }[];
};

/**
 * Canonical fallback schedule used when no user, host, or event-type schedule is found.
 *
 * - **id**: `0` — sentinel value indicating this is not a persisted schedule.
 * - **availability**: Monday through Friday (`[1, 2, 3, 4, 5]`), 09:00–17:00 UTC.
 * - **date overrides**: none (`date: null`).
 *
 * This constant is the terminal node in the priority hierarchy of
 * {@link detectEventTypeScheduleForUser}. It guarantees that the availability engine
 * always has a valid schedule to process, even for users with no configured schedules.
 */
export const DEFAULT_SCHEDULE_DATA: ScheduleWithoutTimeZone = {
  availability: [
    {
      startTime: new Date("1970-01-01T09:00:00Z"),
      endTime: new Date("1970-01-01T17:00:00Z"),
      days: [1, 2, 3, 4, 5], // Monday to Friday
      date: null,
    },
  ],
  id: 0,
};

/**
 * Input contract for {@link detectEventTypeScheduleForUser}.
 *
 * @property eventType - The event type context (optional/nullable). When present:
 *   - `schedule`: The event-type–level schedule override — highest priority in the hierarchy.
 *   - `hosts`: Per-host schedule overrides — second priority (matched by `user.id`).
 *   - `timeZone`: Preferred display timezone for the event type; used as the first
 *     timezone fallback when the resolved schedule has no explicit timezone.
 * @property user - The user whose schedule is being resolved. Must include:
 *   - `schedules`: All schedules owned by this user (from Prisma with availability relation).
 *   - `defaultScheduleId`: The user's preferred default schedule ID (`null` if unset,
 *     in which case the first schedule in the array is selected).
 *   - `timeZone`: The user's profile timezone — final timezone fallback.
 *   - `id`: Used to match against `eventType.hosts[].user.id` for host-level resolution.
 */
export type DetectEventTypeScheduleForUserInput = {
  eventType?: {
    hosts: {
      user: {
        id: number;
      };
      schedule:
        | (ScheduleWithoutTimeZone & {
            timeZone: string | null;
          })
        | null;
    }[];
    timeZone: string | null;
    schedule:
      | (ScheduleWithoutTimeZone & {
          timeZone: string | null;
        })
      | null;
  } | null;
  user: {
    schedules: NonNullable<GetUserAvailabilityInitialData["user"]>["schedules"];
    defaultScheduleId: number | null;
    timeZone: string;
    id: number;
  };
};

/**
 * Output contract for {@link detectEventTypeScheduleForUser}.
 *
 * The `schedule` field is **guaranteed** to have a non-null `timeZone` string,
 * resolved through the fallback chain: schedule.timeZone → eventType.timeZone → user.timeZone.
 *
 * @property isDefaultSchedule - `true` only when the user's own default schedule (resolved via
 *   `defaultScheduleId`) was selected as the final schedule. `false` when an event-type
 *   schedule, host schedule, or the `DEFAULT_SCHEDULE_DATA` fallback was chosen instead.
 * @property isTimezoneSet - `true` only when a non-fallback schedule was found **and** that
 *   schedule carries an explicit (non-null) timezone. `false` when the fallback timezone
 *   chain was needed or when no real schedule was resolved.
 * @property schedule - The resolved schedule with a guaranteed `timeZone: string` field.
 */
export type DetectEventTypeScheduleForUserOutput = {
  isDefaultSchedule: boolean;
  isTimezoneSet: boolean;
  schedule: ScheduleWithoutTimeZone & {
    timeZone: string;
  };
};

/**
 * Resolves the effective schedule for a user within the context of an event type.
 *
 * Implements a **4-level priority hierarchy** (highest → lowest):
 *
 * 1. **Event-type schedule** (`eventType.schedule`) — An explicit schedule attached to the
 *    event type itself. Takes absolute precedence when present.
 * 2. **Host schedule** (`eventType.hosts[].schedule`) — A per-host override found by matching
 *    `host.user.id === user.id`. Used when no event-type schedule exists.
 * 3. **User default schedule** (`user.schedules` filtered by `defaultScheduleId`) — The user's
 *    own preferred schedule. When `defaultScheduleId` is `null`, `!null` evaluates to `true`,
 *    so all schedules pass the filter and the first one is selected.
 * 4. **Fallback** (`DEFAULT_SCHEDULE_DATA`) — The canonical Mon–Fri 9:00–17:00 UTC schedule
 *    with `id: 0`. Applied only when none of the above yields a schedule.
 *
 * **Timezone fallback chain** (applied to the resolved schedule):
 * `schedule.timeZone` → `eventType.timeZone` → `user.timeZone`
 * This guarantees the returned `schedule.timeZone` is always a non-null string.
 *
 * @param input - See {@link DetectEventTypeScheduleForUserInput}
 * @returns See {@link DetectEventTypeScheduleForUserOutput} — always includes a schedule
 *   with a guaranteed timezone, plus `isDefaultSchedule` and `isTimezoneSet` metadata flags.
 */
export function detectEventTypeScheduleForUser({
  eventType,
  user,
}: DetectEventTypeScheduleForUserInput): DetectEventTypeScheduleForUserOutput {
  // When `defaultScheduleId` is null, `!null` evaluates to `true`, so every schedule
  // passes the filter and the first one in the array is selected as the default.
  // When `defaultScheduleId` is set, only the schedule with a matching `id` passes.
  const userSchedule = user.schedules.filter(
    (schedule) => !user?.defaultScheduleId || schedule.id === user?.defaultScheduleId
  )[0];
  const hostSchedule = eventType?.hosts?.find((host) => host.user.id === user.id)?.schedule;

  // TODO: It uses default timezone of user. Should we use timezone of team ?
  const fallbackTimezoneIfScheduleIsMissing = eventType?.timeZone || user.timeZone;

  const fallbackSchedule = {
    ...DEFAULT_SCHEDULE_DATA,
    timeZone: fallbackTimezoneIfScheduleIsMissing,
  };

  let potentialSchedule = null;

  if (eventType?.schedule) {
    potentialSchedule = eventType.schedule;
  } else if (hostSchedule) {
    potentialSchedule = hostSchedule;
  } else if (userSchedule) {
    potentialSchedule = userSchedule;
  }

  const schedule = potentialSchedule ?? fallbackSchedule;

  const isDefaultSchedule = !!(userSchedule && userSchedule.id === schedule?.id);

  const isTimezoneSet = Boolean(potentialSchedule && potentialSchedule.timeZone !== null);

  return {
    isDefaultSchedule,
    isTimezoneSet,
    schedule: {
      ...schedule,
      timeZone: schedule.timeZone || fallbackTimezoneIfScheduleIsMissing,
    },
  };
}
