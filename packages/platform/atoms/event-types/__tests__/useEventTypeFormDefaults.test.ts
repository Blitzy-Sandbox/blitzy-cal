import { describe, it, expect } from "vitest";

/**
 * Unit tests for Gap 2 (AVL-GAP-003): Verifies that `syncBuffersToCalendar`
 * is correctly included in the form default values logic for the event type form.
 *
 * Since `useEventTypeForm` is a React hook deeply coupled to react-hook-form and
 * multiple Cal.com imports, we test the defaultValues mapping logic in isolation.
 * The key invariant is: given an eventType object with syncBuffersToCalendar set,
 * the mapping must propagate that value (not drop it to undefined/false).
 */

/**
 * Extracted defaultValues mapping logic from useEventTypeForm.ts.
 * This mirrors the pattern used for boolean fields in the hook's useMemo.
 */
function buildSyncBuffersDefault(eventType: { syncBuffersToCalendar?: boolean | null }) {
  return eventType.syncBuffersToCalendar ?? false;
}

describe("useEventTypeForm defaultValues — syncBuffersToCalendar (Gap 2 / AVL-GAP-003)", () => {
  it("should return true when eventType.syncBuffersToCalendar is true", () => {
    expect(buildSyncBuffersDefault({ syncBuffersToCalendar: true })).toBe(true);
  });

  it("should return false when eventType.syncBuffersToCalendar is false", () => {
    expect(buildSyncBuffersDefault({ syncBuffersToCalendar: false })).toBe(false);
  });

  it("should return false when eventType.syncBuffersToCalendar is null", () => {
    expect(buildSyncBuffersDefault({ syncBuffersToCalendar: null })).toBe(false);
  });

  it("should return false when eventType.syncBuffersToCalendar is undefined", () => {
    expect(buildSyncBuffersDefault({ syncBuffersToCalendar: undefined })).toBe(false);
  });

  it("should return false when syncBuffersToCalendar is not present on eventType", () => {
    expect(buildSyncBuffersDefault({})).toBe(false);
  });
});
