import { Frequency, FrequencyInput } from "@calcom/platform-enums";
import type { Recurrence_2024_06_14, TransformRecurringEventSchema_2024_06_14 } from "@calcom/platform-types";

/**
 * Transforms an internal recurrence configuration to the API v2024-06-14 output format.
 *
 * Field mappings:
 *   - `interval`  → copied directly
 *   - `count`     → renamed to `occurrences`
 *   - `freq`      → double-lookup through Frequency/FrequencyInput enums to API string
 *
 * Frequency enum resolution (double-lookup):
 *   1. Numeric `freq` → `Frequency[freq]` → enum key string (e.g. 2 → "weekly")
 *   2. Enum key string → `FrequencyInput[key]` → API string identifier (e.g. "weekly")
 *
 * Supported mappings: 0→"yearly", 1→"monthly", 2→"weekly"
 */
export function transformRecurrenceInternalToApi(
  transformRecurringEvent: TransformRecurringEventSchema_2024_06_14
): Recurrence_2024_06_14 {
  const frequencyKey = Frequency[transformRecurringEvent.freq] as keyof typeof FrequencyInput | undefined;
  const frequency = frequencyKey != null ? FrequencyInput[frequencyKey] : undefined;

  if (!frequency) {
    throw new Error(
      `Unsupported recurrence frequency value: ${transformRecurringEvent.freq}. ` +
        `Expected one of: ${Object.entries(Frequency)
          .filter(([, v]) => typeof v === "number")
          .map(([k, v]) => `${k}=${v}`)
          .join(", ")}`
    );
  }

  return {
    interval: transformRecurringEvent.interval,
    occurrences: transformRecurringEvent.count,
    frequency,
  } satisfies Recurrence_2024_06_14;
}
