import {
  BookingWindowPeriodInputTypeEnum_2024_06_14,
  BookingWindowPeriodOutputTypeEnum_2024_06_14,
} from "@calcom/platform-enums";
import {
  type BusinessDaysWindow_2024_06_14,
  type CalendarDaysWindow_2024_06_14,
  type CreateEventTypeInput_2024_06_14,
  type RangeWindow_2024_06_14,
  type TransformFutureBookingsLimitSchema_2024_06_14,
} from "@calcom/platform-types";

/**
 * Transforms API booking window input into the internal `TransformFutureBookingsLimitSchema_2024_06_14` format.
 *
 * Supports all three Calendly-equivalent booking window options (ET-005 parity):
 *  - "Days into future" → `businessDays` / `calendarDays` with `rolling: false` → `periodType: ROLLING`
 *  - "Date range"       → `range` with start/end dates                         → `periodType: RANGE`
 *  - "Indefinitely"     → `disabled: true`                                     → `periodType: UNLIMITED`
 *
 * Cal.com additionally supports `ROLLING_WINDOW` (rolling: true) which exceeds Calendly's capabilities.
 *
 * AVL-GAP-001 compliance: The business day vs. calendar day distinction is preserved via
 * `periodCountCalendarDays` (false = business days only, true = all calendar days).
 *
 * @param inputBookingLimits - The booking window configuration from the API payload
 * @returns The internal booking limit schema, or `undefined` if no booking window is specified
 */
export function transformFutureBookingLimitsApiToInternal(
  inputBookingLimits: CreateEventTypeInput_2024_06_14["bookingWindow"]
): TransformFutureBookingsLimitSchema_2024_06_14 | undefined {
  if (!inputBookingLimits) {
    return undefined;
  }
  // ET-005: Disabled/indefinite booking window — corresponds to Calendly's "indefinitely" option
  if (inputBookingLimits.disabled) {
    return {
      periodType: BookingWindowPeriodOutputTypeEnum_2024_06_14.UNLIMITED,
    };
  }
  switch (inputBookingLimits?.type) {
    // ET-005: Business days — counts weekdays only (AVL-GAP-001: periodCountCalendarDays = false)
    case BookingWindowPeriodInputTypeEnum_2024_06_14.businessDays:
      return {
        periodDays: (inputBookingLimits as BusinessDaysWindow_2024_06_14).value,
        periodType: (inputBookingLimits as BusinessDaysWindow_2024_06_14).rolling
          ? BookingWindowPeriodOutputTypeEnum_2024_06_14.ROLLING_WINDOW
          : BookingWindowPeriodOutputTypeEnum_2024_06_14.ROLLING,
        periodCountCalendarDays: false,
      };
    // ET-005: Calendar days — counts all days (AVL-GAP-001: periodCountCalendarDays = true)
    case BookingWindowPeriodInputTypeEnum_2024_06_14.calendarDays:
      return {
        periodDays: (inputBookingLimits as CalendarDaysWindow_2024_06_14).value,
        periodType: (inputBookingLimits as CalendarDaysWindow_2024_06_14).rolling
          ? BookingWindowPeriodOutputTypeEnum_2024_06_14.ROLLING_WINDOW
          : BookingWindowPeriodOutputTypeEnum_2024_06_14.ROLLING,
        periodCountCalendarDays: true,
      };
    // ET-005: Date range — explicit start/end dates (Calendly "date range" option)
    case BookingWindowPeriodInputTypeEnum_2024_06_14.range: {
      // Normalize ISO date strings to YYYY-MM-DD by stripping timezone offsets via .slice(0, 10).
      // This ensures timezone safety: "2024-08-06T00:00:00.000+04:00" → "2024-08-06" → UTC midnight,
      // preventing date-shifting across timezones for clients in non-UTC zones.
      const startDateStr = (inputBookingLimits as RangeWindow_2024_06_14).value[0].slice(0, 10);
      const endDateStr = (inputBookingLimits as RangeWindow_2024_06_14).value[1].slice(0, 10);
      return {
        periodType: BookingWindowPeriodOutputTypeEnum_2024_06_14.RANGE,
        periodStartDate: new Date(startDateStr),
        periodEndDate: new Date(endDateStr),
      };
    }
    default: {
      // Exhaustiveness guard: all BookingWindowPeriodInputTypeEnum_2024_06_14 values must be handled above.
      // If a new enum value is added without updating this switch, TypeScript will flag it at compile time
      // via the `never` assertion, and this will throw at runtime for safety.
      const _exhaustiveCheck: never = inputBookingLimits.type as never;
      throw new Error(`Unsupported booking window period type: '${_exhaustiveCheck}'`);
    }
  }
}
