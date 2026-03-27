import {
  BookingWindowPeriodInputTypeEnum_2024_06_14,
  BookingWindowPeriodOutputTypeEnum_2024_06_14,
} from "@calcom/platform-enums";
import type {
  TransformFutureBookingsLimitSchema_2024_06_14,
  BookingWindow_2024_06_14,
  RangeWindow_2024_06_14,
  CalendarDaysWindow_2024_06_14,
  BusinessDaysWindow_2024_06_14,
  Disabled_2024_06_14,
} from "@calcom/platform-types";

/**
 * Transforms internal future booking limit fields into the API-facing booking window format.
 *
 * Calendly booking window equivalence (ET-005):
 *  1. "Days into the future" → Cal.com ROLLING (fixed) or ROLLING_WINDOW (rolling)
 *     - periodCountCalendarDays === true  → calendarDays (AVL-GAP-001)
 *     - periodCountCalendarDays === false → businessDays (AVL-GAP-001)
 *  2. "Date range"            → Cal.com RANGE with periodStartDate / periodEndDate (YYYY-MM-DD)
 *  3. "Indefinitely"          → Cal.com UNLIMITED → { disabled: true }
 *
 * All four BookingWindowPeriodOutputTypeEnum_2024_06_14 values are exhaustively handled:
 *   RANGE, ROLLING_WINDOW, ROLLING, UNLIMITED.
 * Unrecognized period types fall through to the default branch and return undefined (never throws).
 */
export function transformFutureBookingLimitsInternalToApi(
  transformedFutureBookingsLimitsFields: TransformFutureBookingsLimitSchema_2024_06_14
): BookingWindow_2024_06_14 | undefined {
  switch (transformedFutureBookingsLimitsFields?.periodType) {
    // Calendly equivalent: "Date range" booking window.
    // Produces YYYY-MM-DD ISO date strings via .toISOString().split("T")[0].
    // Note: `as` is retained here because periodStartDate/periodEndDate are optional in
    // TransformFutureBookingsLimitSchema_2024_06_14, making the value array elements
    // potentially undefined — incompatible with RangeWindow_2024_06_14's required string[].
    // Upstream input validation ensures these fields are populated when periodType is RANGE.
    case BookingWindowPeriodOutputTypeEnum_2024_06_14.RANGE:
      return {
        type: BookingWindowPeriodInputTypeEnum_2024_06_14.range,
        value: [
          transformedFutureBookingsLimitsFields?.periodStartDate?.toISOString().split("T")[0],
          transformedFutureBookingsLimitsFields?.periodEndDate?.toISOString().split("T")[0],
        ],
      } as RangeWindow_2024_06_14;

    // Calendly equivalent: "Days into the future" with a rolling window — the number of
    // bookable days always equals `value` and adjusts dynamically as bookings fill.
    // AVL-GAP-001: periodCountCalendarDays distinguishes calendar days vs. business days.
    // Note: `as` is retained because periodDays is optional in the input schema, producing
    // number | undefined which is incompatible with the required `value: number` on the
    // output types. Upstream validation guarantees periodDays is set for ROLLING_WINDOW.
    case BookingWindowPeriodOutputTypeEnum_2024_06_14.ROLLING_WINDOW:
      return {
        type: transformedFutureBookingsLimitsFields.periodCountCalendarDays
          ? BookingWindowPeriodInputTypeEnum_2024_06_14.calendarDays
          : BookingWindowPeriodInputTypeEnum_2024_06_14.businessDays,
        value: transformedFutureBookingsLimitsFields.periodDays,
        rolling: true,
      } as CalendarDaysWindow_2024_06_14 | BusinessDaysWindow_2024_06_14;

    // Calendly equivalent: "Days into the future" with a fixed (non-rolling) window —
    // the booking window only considers the next `value` days from the current moment.
    // AVL-GAP-001: periodCountCalendarDays distinguishes calendar days vs. business days.
    // Note: `as` retained for the same reason as ROLLING_WINDOW (see above).
    case BookingWindowPeriodOutputTypeEnum_2024_06_14.ROLLING:
      return {
        type: transformedFutureBookingsLimitsFields.periodCountCalendarDays
          ? BookingWindowPeriodInputTypeEnum_2024_06_14.calendarDays
          : BookingWindowPeriodInputTypeEnum_2024_06_14.businessDays,
        value: transformedFutureBookingsLimitsFields.periodDays,
        rolling: false,
      } as CalendarDaysWindow_2024_06_14 | BusinessDaysWindow_2024_06_14;

    // Calendly equivalent: "Indefinitely" — no booking window restrictions.
    // `satisfies` is used here (instead of `as`) for compile-time shape verification,
    // consistent with the pattern in seats.ts and recurrence.ts.
    case BookingWindowPeriodOutputTypeEnum_2024_06_14.UNLIMITED:
      return {
        disabled: true,
      } satisfies Disabled_2024_06_14;

    default:
      return undefined;
  }
}
