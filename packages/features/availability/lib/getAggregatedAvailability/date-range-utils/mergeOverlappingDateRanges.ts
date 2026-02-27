import type { DateRange } from "@calcom/features/schedules/lib/date-ranges";

/**
 * Merges chronologically ordered DateRanges when they overlap, producing
 * disjoint, canonical DateRanges that cover the same temporal footprint.
 *
 * Algorithm:
 * 1. Sort input array in-place by start timestamp (ascending)
 * 2. Initialize accumulator with the first range
 * 3. For each subsequent range:
 *    - If it overlaps the current accumulator range, extend the end to the farthest timestamp
 *    - If it does not overlap, push the accumulator to results and reset to the new range
 * 4. Push the final accumulator range
 *
 * Overlap detection uses exclusive end bounds: `current.end > next.start` (strict greater-than),
 * meaning ranges that merely touch (end === start) are NOT considered overlapping and remain separate.
 *
 * Complexity: O(n log n) for sort + O(n) for merge pass = O(n log n) overall.
 *
 * @param dateRanges - Array of DateRange objects to merge (may be unsorted)
 * @returns Array of disjoint, sorted DateRange objects with no overlapping intervals
 */
export function mergeOverlappingDateRanges(dateRanges: DateRange[]) {
  dateRanges.sort((a, b) => a.start.valueOf() - b.start.valueOf());

  const mergedDateRanges: DateRange[] = [];

  let currentRange = dateRanges[0];
  if (!currentRange) {
    return [];
  }

  for (let i = 1; i < dateRanges.length; i++) {
    const nextRange = dateRanges[i];

    if (isCurrentRangeOverlappingNext(currentRange, nextRange)) {
      currentRange = {
        start: currentRange.start,
        end: currentRange.end.valueOf() > nextRange.end.valueOf() ? currentRange.end : nextRange.end,
      };
    } else {
      mergedDateRanges.push(currentRange);
      currentRange = nextRange;
    }
  }
  mergedDateRanges.push(currentRange);

  return mergedDateRanges;
}

/**
 * Determines whether the current accumulator range overlaps with the next range.
 *
 * Uses exclusive end bound semantics: returns true only when `current.end > next.start`
 * (strict greater-than). Ranges that merely touch at a boundary (end === start) are NOT
 * considered overlapping, so adjacent ranges remain separate in the output.
 *
 * Precondition: Both ranges should be sorted such that `currentRange.start <= nextRange.start`.
 *
 * @param currentRange - The current accumulator DateRange
 * @param nextRange - The next DateRange to test for overlap
 * @returns true if the ranges overlap; false if they are disjoint or merely touching
 */
function isCurrentRangeOverlappingNext(currentRange: DateRange, nextRange: DateRange): boolean {
  return (
    currentRange.start.valueOf() <= nextRange.start.valueOf() &&
    currentRange.end.valueOf() > nextRange.start.valueOf()
  );
}
