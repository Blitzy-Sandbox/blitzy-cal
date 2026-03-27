import {
  BookerLayoutsInputEnum_2024_06_14,
  BookerLayoutsOutputEnum_2024_06_14,
} from "@calcom/platform-enums";
import { type CreateEventTypeInput_2024_06_14 } from "@calcom/platform-types";

/**
 * Transforms booker layout preferences from the external API representation
 * into the internal layout constants used by the Cal.com booking page.
 *
 * This transformer is **paradigm-agnostic** — booker layouts control the visual
 * presentation of the booking page (month view, week view, or column view) and
 * apply uniformly across all six scheduling paradigms:
 *   - 1:1 (one-on-one) events (ET-001)
 *   - Group events via `seatsPerTimeSlot` (ET-002)
 *   - Round-robin distribution (ET-003)
 *   - Collective scheduling (ET-004)
 *   - Managed event types
 *   - Dynamic group links
 *
 * Layout mapping:
 *   - `month`  → `month_view`
 *   - `week`   → `week_view`
 *   - `column` → `column_view`
 *
 * @param inputBookerLayout - Optional booker layout configuration from the API payload.
 *   Contains `defaultLayout` (the initially rendered view) and `enabledLayouts`
 *   (the set of views the invitee can switch between).
 * @returns The transformed layout with internal enum values, or `undefined` if
 *   no layout configuration was provided (layouts are optional on event types).
 *
 * @see {@link BookerLayoutsInputEnum_2024_06_14} for external API enum values
 * @see {@link BookerLayoutsOutputEnum_2024_06_14} for internal enum values
 */
export function transformBookerLayoutsApiToInternal(
  inputBookerLayout: CreateEventTypeInput_2024_06_14["bookerLayouts"]
) {
  // Layouts are optional — when omitted the platform uses its default layout configuration.
  if (!inputBookerLayout) return undefined;

  // Map each external API layout identifier to its internal `_view` suffixed counterpart.
  // All three Calendly-equivalent layout options are covered:
  //   month  → month_view  (calendar grid)
  //   week   → week_view   (weekly time slots)
  //   column → column_view (single-day column)
  const inputToOutputMap = {
    [BookerLayoutsInputEnum_2024_06_14.month]: BookerLayoutsOutputEnum_2024_06_14.month_view,
    [BookerLayoutsInputEnum_2024_06_14.week]: BookerLayoutsOutputEnum_2024_06_14.week_view,
    [BookerLayoutsInputEnum_2024_06_14.column]: BookerLayoutsOutputEnum_2024_06_14.column_view,
  };

  return {
    defaultLayout: inputToOutputMap[inputBookerLayout.defaultLayout],
    enabledLayouts: inputBookerLayout.enabledLayouts.map((layout) => inputToOutputMap[layout]),
  };
}
