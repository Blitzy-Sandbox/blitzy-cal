import type { DateRange } from "@calcom/features/schedules/lib/date-ranges";
import { intersect } from "@calcom/features/schedules/lib/date-ranges";
import { DEFAULT_GROUP_ID } from "@calcom/lib/constants";
import { SchedulingType } from "@calcom/prisma/enums";

import { filterRedundantDateRanges } from "./date-range-utils/filterRedundantDateRanges";
import { mergeOverlappingDateRanges } from "./date-range-utils/mergeOverlappingDateRanges";

/**
 * Sorts date ranges by start time (then end time as tiebreaker) and removes
 * duplicates identified by matching numeric start/end valueOf() pairs.
 *
 * This ensures the aggregation pipeline receives canonical, deterministically
 * ordered inputs before containment-aware pruning.
 *
 * @param ranges - Unsorted, potentially duplicated DateRange array
 * @returns Sorted, deduplicated DateRange array
 */
function uniqueAndSortedDateRanges(ranges: DateRange[]): DateRange[] {
  const seen = new Set<string>();

  return ranges
    .sort((a, b) => {
      const startDiff = a.start.valueOf() - b.start.valueOf();
      return startDiff !== 0 ? startDiff : a.end.valueOf() - b.end.valueOf();
    })
    .filter((range) => {
      const key = `${range.start.valueOf()}-${range.end.valueOf()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

/**
 * Computes deterministic aggregated availability windows across multiple hosts
 * for team scheduling scenarios (COLLECTIVE and ROUND_ROBIN).
 *
 * Algorithm:
 * 1. Determine if this is a team event (COLLECTIVE, ROUND_ROBIN, or >1 participant)
 * 2. Identify fixed hosts: all hosts when COLLECTIVE or no scheduling type; otherwise only isFixed hosts
 * 3. Intersect fixed hosts' ranges and merge overlapping intervals to form the fixed constraint
 * 4. Group round-robin hosts by groupId (or DEFAULT_GROUP_ID for ungrouped hosts)
 * 5. Each group's ranges are flattened and added as a separate entry in dateRangesToIntersect
 * 6. Intersect all entries in dateRangesToIntersect — every group MUST contribute at least one range
 * 7. Sort, deduplicate, and prune redundant (fully contained) ranges
 *
 * For team events, uses oooExcludedDateRanges (availability minus OOO) instead of raw dateRanges.
 *
 * @param userAvailability - Array of per-user availability with dateRanges, oooExcludedDateRanges, and user metadata
 * @param schedulingType - The event's scheduling type (COLLECTIVE, ROUND_ROBIN, or null)
 * @returns Canonical, sorted, deduplicated DateRange[] representing available windows
 */
export const getAggregatedAvailability = (
  userAvailability: {
    dateRanges: DateRange[];
    oooExcludedDateRanges: DateRange[];
    user?: { isFixed?: boolean; groupId?: string | null };
  }[],
  schedulingType: SchedulingType | null
): DateRange[] => {
  const isTeamEvent =
    schedulingType === SchedulingType.COLLECTIVE ||
    schedulingType === SchedulingType.ROUND_ROBIN ||
    userAvailability.length > 1;

  const fixedHosts = userAvailability.filter(
    ({ user }) => !schedulingType || schedulingType === SchedulingType.COLLECTIVE || user?.isFixed
  );

  const fixedDateRanges = mergeOverlappingDateRanges(
    intersect(fixedHosts.map((s) => (!isTeamEvent ? s.dateRanges : s.oooExcludedDateRanges)))
  );
  const dateRangesToIntersect = fixedDateRanges.length ? [fixedDateRanges] : [];
  const roundRobinHosts = userAvailability.filter(({ user }) => user?.isFixed !== true);
  if (roundRobinHosts.length) {
    // Group round robin hosts by their groupId
    const hostsByGroup = roundRobinHosts.reduce(
      (groups, host) => {
        const groupId = host.user?.groupId || DEFAULT_GROUP_ID;
        if (!groups[groupId]) {
          groups[groupId] = [];
        }
        groups[groupId].push(host);
        return groups;
      },
      {} as Record<string, typeof roundRobinHosts>
    );

    // at least one host from each group needs to be available
    Object.values(hostsByGroup).forEach((groupHosts) => {
      if (groupHosts.length > 0) {
        const groupDateRanges = groupHosts.flatMap((s) =>
          !isTeamEvent ? s.dateRanges : s.oooExcludedDateRanges
        );
        dateRangesToIntersect.push(groupDateRanges ?? []);
      }
    });
  }

  const availability = intersect(dateRangesToIntersect);

  const uniqueRanges = uniqueAndSortedDateRanges(availability);

  return filterRedundantDateRanges(uniqueRanges);
};
