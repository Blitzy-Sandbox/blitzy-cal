import { useMemo } from "react";

import type { Slots } from "../lib/types";

/**
 * Pure filtering function that extracts date strings containing at least one actionable slot.
 *
 * A day is considered non-empty when it has at least one slot that is NOT an unassigned,
 * hidden Out-of-Office entry. Specifically, a slot is excluded only when all three conditions
 * hold simultaneously: `away === true`, `toUser` is falsy (not assigned to another user),
 * and `showNotePublicly` is falsy (OOO note is not publicly visible).
 *
 * This means:
 * - Regular available slots (no `away` flag) → included
 * - OOO slots assigned to another user (`toUser` truthy) → included
 * - OOO slots with a public note (`showNotePublicly` truthy) → included
 * - OOO slots that are unassigned and hidden → excluded
 *
 * @param slots - Map of ISO date strings to slot arrays, derived from the TRPC
 *   `viewer.slots.getSchedule` query output. `undefined` during initial loading.
 * @returns Array of ISO date strings that contain at least one actionable slot.
 */
const getNonEmptyScheduleDays = (slots?: Slots) => {
  if (typeof slots === "undefined") return [];

  const nonEmptyDays: string[] = [];

  Object.keys(slots).forEach((date) => {
    if (
      slots[date].some(
        (slot) => !(slot?.away && !slot.toUser && !slot.showNotePublicly) && slots[date].length > 0
      )
    ) {
      nonEmptyDays.push(date);
    }
  });

  return nonEmptyDays;
};

/**
 * Memoized React hook that returns date strings containing actionable slots.
 *
 * Wraps {@link getNonEmptyScheduleDays} in `useMemo` keyed on the `slots` reference.
 * Recalculation is triggered when TRPC returns a new query result (new object reference).
 *
 * @param slots - Slot map from the TRPC `viewer.slots.getSchedule` query, or `undefined`
 *   while the query is loading.
 * @returns Memoized array of ISO date strings with at least one actionable (non-hidden-OOO) slot.
 */
export const useNonEmptyScheduleDays = (slots?: Slots) => {
  const days = useMemo(() => getNonEmptyScheduleDays(slots), [slots]);

  return days;
};
