import { useCallback, useEffect, useMemo, useState } from "react";

import type { Slots, Slot } from "../lib/types";

/**
 * Returns a memoized array of slots for a specific date from the slot map.
 *
 * Returns an empty array when `date` is null or `slots` is undefined, ensuring
 * safe rendering during loading and unselected states. The result is memoized
 * on `[date, slots]` so downstream components receive a stable reference as long
 * as the inputs remain unchanged.
 *
 * @param date - ISO date string in YYYY-MM-DD format, or null when no date is selected.
 * @param slots - The slot map keyed by ISO date string, sourced from the schedule query.
 * @returns A stable `Slot[]` for the requested date, or `[]` if inputs are absent.
 */

export const useSlotsForDate = (date: string | null, slots?: Slots) => {
  const slotsForDate = useMemo(() => {
    if (!date || typeof slots === "undefined") return [];
    return slots[date] || [];
  }, [date, slots]);

  return slotsForDate;
};

/**
 * Manages a per-day slot state array for multi-date availability views.
 *
 * Slot data is synchronized from the source `slots` map via a `useEffect` that
 * uses `JSON.stringify` for deep comparison of `dates` and `slots`, ensuring the
 * effect re-fires when content changes rather than only on reference identity.
 * When `slots` is undefined (loading or error state), the internal state is reset
 * to an empty array.
 *
 * Exposes `toggleConfirmButton` which implements single-selection semantics: when
 * a slot is toggled, its `showConfirmButton` flag flips while all other slots are
 * reset to `false`, ensuring at most one slot displays the confirm button at a time.
 *
 * @param dates - Array of ISO date strings (YYYY-MM-DD) or nulls for unresolved days.
 * @param slots - The slot map keyed by ISO date string, sourced from the schedule query.
 * @returns A readonly object with `slotsPerDay` state, `setSlotsPerDay` setter, and
 *          `toggleConfirmButton` action for single-selection confirm button toggling.
 */
export const useSlotsForAvailableDates = (dates: (string | null)[], slots?: Slots) => {
  const [slotsPerDay, setSlotsPerDay] = useState<{ date: string | null; slots: Slots[string] }[]>([]);

  const toggleConfirmButton = useCallback((selectedSlot: Slot) => {
    setSlotsPerDay((prevSlotsPerDay) =>
      prevSlotsPerDay.map(({ date, slots }) => ({
        date,
        slots: slots.map((slot) => ({
          ...slot,
          showConfirmButton: slot.time === selectedSlot.time ? !selectedSlot?.showConfirmButton : false,
        })),
      }))
    );
    // Empty deps is safe: the callback only uses `setSlotsPerDay` (stable setState
    // reference) and `selectedSlot` (received as a parameter), so it never goes stale.
  }, []);

  useEffect(() => {
    if (slots === undefined) {
      setSlotsPerDay([]);
      return;
    }

    const updatedSlots = dates
      .filter((date) => date !== null)
      .map((date) => ({
        slots: slots[`${date}`] || [],
        date,
      }));

    setSlotsPerDay(updatedSlots);
  }, [JSON.stringify(dates), JSON.stringify(slots)]);

  return { slotsPerDay, setSlotsPerDay, toggleConfirmButton } as const;
};
