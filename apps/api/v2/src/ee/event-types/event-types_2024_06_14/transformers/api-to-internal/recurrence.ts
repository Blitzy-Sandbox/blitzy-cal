import { Frequency } from "@calcom/platform-enums";
import type { Recurrence_2024_06_14 } from "@calcom/platform-types";
import { type TransformRecurringEventSchema_2024_06_14 } from "@calcom/platform-types";

/**
 * Transforms an API recurrence payload into the internal recurring event schema.
 *
 * This transformer is paradigm-agnostic — it handles recurrence configuration
 * for all scheduling types where recurrence is applicable:
 * - One-on-one events (ET-001): primary use case for recurring bookings
 * - Group/seated events (ET-002): recurring group sessions with `seatsPerTimeSlot`
 *
 * Round-robin (ET-003) and collective (ET-004) events typically do not use recurrence,
 * but no paradigm-specific restriction is enforced here; the caller
 * (`InputEventTypesService_2024_06_14.transformInputRecurrignEvent`) guards against
 * null/undefined/disabled recurrence before invoking this function.
 *
 * Property mapping:
 * - `interval` → `interval` (direct copy: recurrence interval, e.g., every N weeks)
 * - `occurrences` → `count` (renamed: maximum number of recurring event instances)
 * - `frequency` → `freq` (enum lookup: string frequency name to numeric RRule value)
 *
 * @param recurrence - The API recurrence payload with `interval`, `occurrences`, and `frequency` fields
 * @returns The internal recurring event schema with `interval`, `count`, and `freq` fields
 */
export function transformRecurrenceApiToInternal(
  recurrence: Recurrence_2024_06_14
): TransformRecurringEventSchema_2024_06_14 {
  return {
    // Direct copy: interval between recurrences (e.g., every 2 weeks → interval=2)
    interval: recurrence.interval,
    // Renamed: API uses "occurrences", internal schema uses "count" for max event instances
    count: recurrence.occurrences,
    // Enum lookup: converts FrequencyInput string ("yearly"|"monthly"|"weekly") to numeric value (0|1|2)
    freq: Frequency[recurrence.frequency as keyof typeof Frequency],
  } satisfies TransformRecurringEventSchema_2024_06_14;
}
