import type { DateRange } from "@calcom/features/schedules/lib/date-ranges";
import { IntervalTree, ContainmentSearchAlgorithm, createIntervalNodes } from "@calcom/lib/intervalTree";

/**
 * Filters out date ranges that are completely covered by other date ranges.
 * Uses an interval tree for O(n log n) worst-case complexity.
 * Unlike mergeOverlappingDateRanges, this doesn't merge overlapping ranges,
 * it only removes ranges that are completely contained within others.
 *
 * @param dateRanges - Array of DateRange objects to filter (may contain duplicates, nested, or invalid ranges)
 * @returns Sorted, filtered subset of DateRange objects with fully-contained ranges removed
 */
export function filterRedundantDateRanges(dateRanges: DateRange[]): DateRange[] {
  if (dateRanges.length <= 1) return dateRanges;

  const sortedRanges = [...dateRanges].sort((a, b) => a.start.valueOf() - b.start.valueOf());
  const intervalNodes = createIntervalNodes(
    sortedRanges,
    (range) => range.start.valueOf(),
    (range) => range.end.valueOf()
  );
  const intervalTree = new IntervalTree(intervalNodes);
  const searchAlgorithm = new ContainmentSearchAlgorithm(intervalTree);

  return sortedRanges.filter((range, index) => {
    if (range.end.valueOf() < range.start.valueOf()) {
      return true;
    }

    const containingIntervals = searchAlgorithm.findContainingIntervals(
      range.start.valueOf(),
      range.end.valueOf(),
      index
    );

    // Walk through all intervals that fully contain (or are identical to) the current range.
    // For each containing interval, decide whether to keep or discard the current range.
    for (const containingNode of containingIntervals) {
      const otherRange = containingNode.item;
      const otherIndex = containingNode.index;

      // Duplicate handling: when two ranges have identical start and end timestamps,
      // keep only the first occurrence (lowest index) to ensure deterministic deduplication.
      // Returns true (keep) only if the other duplicate has a higher index than the current one.
      if (
        otherRange.start.valueOf() === range.start.valueOf() &&
        otherRange.end.valueOf() === range.end.valueOf()
      ) {
        return otherIndex > index;
      }

      // The other range strictly contains this range (same or wider boundaries) — discard it.
      return false;
    }

    return true; // Keep this range
  });
}
