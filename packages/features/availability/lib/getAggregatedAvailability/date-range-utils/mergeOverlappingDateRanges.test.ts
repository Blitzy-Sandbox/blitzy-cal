import { describe, it, expect } from "vitest";

import dayjs from "@calcom/dayjs";
import type { DateRange } from "@calcom/features/schedules/lib/date-ranges";

import { mergeOverlappingDateRanges } from "./mergeOverlappingDateRanges";

const november2 = "2023-11-02";
const november3 = "2023-11-03";

/**
 * Test coverage matrix for mergeOverlappingDateRanges:
 *
 * - Full containment: multiple ranges collapse to one when an enclosing range exists
 * - Cross-day overlaps: overlapping ranges merge across day boundaries; disjoint ranges preserved
 * - Same-day overlaps: contiguous blocks merge on the same day; separate ranges preserved
 * - Empty input: empty array returns empty array
 * - Single input: single range returns unchanged
 * - Non-overlapping: completely disjoint ranges remain separate
 */
describe("mergeOverlappingDateRanges", () => {
  it("should merge all ranges into one when one range includes all others", () => {
    const dateRanges = [
      createDateRange(`${november2}T23:00:00.000Z`, `${november3}T07:00:00.000Z`), // Includes all others
      createDateRange(`${november2}T23:15:00.000Z`, `${november3}T00:00:00.000Z`),
      createDateRange(`${november3}T00:15:00.000Z`, `${november3}T01:00:00.000Z`),
      createDateRange(`${november3}T01:15:00.000Z`, `${november3}T02:00:00.000Z`),
    ];

    const mergedRanges = mergeOverlappingDateRanges(dateRanges);
    expect(mergedRanges).toHaveLength(1);
    expect(mergedRanges[0].start.isSame(dayjs(dateRanges[0].start))).toBe(true);
    expect(mergedRanges[0].end.isSame(dayjs(dateRanges[0].end))).toBe(true);
  });

  it("should merge only overlapping ranges over 2 days and leave non-overlapping ranges as is", () => {
    const dateRanges = [
      createDateRange(`${november2}T23:00:00.000Z`, `${november3}T07:00:00.000Z`),
      createDateRange(`${november3}T05:00:00.000Z`, `${november3}T06:00:00.000Z`),
      createDateRange(`${november3}T08:00:00.000Z`, `${november3}T10:00:00.000Z`), // This range should not be merged
    ];

    const mergedRanges = mergeOverlappingDateRanges(dateRanges);
    expect(mergedRanges).toHaveLength(2);
    expect(mergedRanges[0].start.isSame(dayjs(dateRanges[0].start))).toBe(true);
    expect(mergedRanges[0].end.isSame(dayjs(dateRanges[0].end))).toBe(true);
    expect(mergedRanges[1].start.isSame(dayjs(dateRanges[2].start))).toBe(true);
    expect(mergedRanges[1].end.isSame(dayjs(dateRanges[2].end))).toBe(true);
  });

  it("should merge ranges that overlap on the same day", () => {
    const dateRanges = [
      createDateRange(`${november2}T01:00:00.000Z`, `${november2}T04:00:00.000Z`),
      createDateRange(`${november2}T02:00:00.000Z`, `${november2}T03:00:00.000Z`), // This overlaps with the first range
      createDateRange(`${november2}T05:00:00.000Z`, `${november2}T06:00:00.000Z`), // This doesn't overlap with above
    ];

    const mergedRanges = mergeOverlappingDateRanges(dateRanges);
    expect(mergedRanges).toHaveLength(2);
    expect(mergedRanges[0].start.isSame(dayjs(dateRanges[0].start))).toBe(true);
    expect(mergedRanges[0].end.isSame(dayjs(dateRanges[0].end))).toBe(true);
    expect(mergedRanges[1].start.isSame(dayjs(dateRanges[2].start))).toBe(true);
    expect(mergedRanges[1].end.isSame(dayjs(dateRanges[2].end))).toBe(true);
  });

  it("should return an empty array for empty input", () => {
    const result = mergeOverlappingDateRanges([]);
    expect(result).toHaveLength(0);
    expect(result).toEqual([]);
  });

  it("should return the same single range when given one input", () => {
    const dateRanges = [createDateRange(`${november2}T09:00:00.000Z`, `${november2}T17:00:00.000Z`)];
    const mergedRanges = mergeOverlappingDateRanges(dateRanges);
    expect(mergedRanges).toHaveLength(1);
    expect(mergedRanges[0].start.isSame(dayjs(dateRanges[0].start))).toBe(true);
    expect(mergedRanges[0].end.isSame(dayjs(dateRanges[0].end))).toBe(true);
  });

  it("should preserve completely disjoint ranges without merging", () => {
    const dateRanges = [
      createDateRange(`${november2}T09:00:00.000Z`, `${november2}T10:00:00.000Z`),
      createDateRange(`${november2}T12:00:00.000Z`, `${november2}T13:00:00.000Z`),
    ];
    const mergedRanges = mergeOverlappingDateRanges(dateRanges);
    expect(mergedRanges).toHaveLength(2);
    expect(mergedRanges[0].start.isSame(dayjs(dateRanges[0].start))).toBe(true);
    expect(mergedRanges[0].end.isSame(dayjs(dateRanges[0].end))).toBe(true);
    expect(mergedRanges[1].start.isSame(dayjs(dateRanges[1].start))).toBe(true);
    expect(mergedRanges[1].end.isSame(dayjs(dateRanges[1].end))).toBe(true);
  });
});

function createDateRange(start: string, end: string): DateRange {
  return {
    start: dayjs(start),
    end: dayjs(end),
  };
}
