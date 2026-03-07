import { BookingLimitsEnum_2024_06_14 } from "@calcom/platform-enums";
import {
  type CreateEventTypeInput_2024_06_14,
  type BookingLimitsKeyOutputType_2024_06_14,
  type TransformBookingLimitsSchema_2024_06_14,
} from "@calcom/platform-types";

/**
 * Transforms API-level booking limits count payload into the internal
 * {@link TransformBookingLimitsSchema_2024_06_14} format used by the Cal.com booking engine.
 *
 * Remaps API input keys (`day`, `week`, `month`, `year`) to canonical internal keys
 * (`PER_DAY`, `PER_WEEK`, `PER_MONTH`, `PER_YEAR`) via {@link BookingLimitsEnum_2024_06_14},
 * preserving the numeric count values without transformation.
 *
 * Verified behaviors (Sprint 2 — ET-005 Booking Window Configuration Alignment):
 * - All four limit type mappings: day→PER_DAY, week→PER_WEEK, month→PER_MONTH, year→PER_YEAR
 * - Disabled flag short-circuit: returns empty schema when limits are explicitly disabled
 * - Numeric count passthrough: values assigned directly without transformation
 * - Undefined/null input safety: optional chaining and guard clause prevent iteration errors
 * - Partial limits: only provided keys appear in output
 *
 * @param inputBookingLimits - The booking limits count from the API request payload,
 *   extracted from `CreateEventTypeInput_2024_06_14["bookingLimitsCount"]`.
 *   May be `undefined` if no limits are provided, or contain a `disabled: true` flag.
 * @returns A {@link TransformBookingLimitsSchema_2024_06_14} object mapping canonical limit
 *   period keys to numeric booking count values. Returns empty `{}` when input is
 *   undefined or explicitly disabled.
 */
export function transformIntervalLimitsApiToInternal(
  inputBookingLimits: CreateEventTypeInput_2024_06_14["bookingLimitsCount"]
) {
  const res: TransformBookingLimitsSchema_2024_06_14 = {};
  // Short-circuit: if limits are explicitly disabled, return an empty schema
  // representing "no booking limits applied"
  if (inputBookingLimits?.disabled) {
    return res;
  }
  // Iterate over provided limit entries and remap API keys to internal canonical keys
  // via BookingLimitsEnum_2024_06_14 (e.g., "day" → "PER_DAY").
  // The `satisfies` assertion ensures compile-time correctness of the key mapping.
  inputBookingLimits &&
    Object.entries(inputBookingLimits).map(([key, value]) => {
      const outputKey: BookingLimitsKeyOutputType_2024_06_14 = BookingLimitsEnum_2024_06_14[
        key as keyof typeof BookingLimitsEnum_2024_06_14
      ] satisfies BookingLimitsKeyOutputType_2024_06_14;
      res[outputKey] = value;
    });
  return res;
}
