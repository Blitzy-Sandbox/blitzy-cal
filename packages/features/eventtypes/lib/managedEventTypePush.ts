import type {
  ManagedEventTypePushConfig,
  ManagedEventTypeDistributionResult,
  ManagedEventTypePushMember,
} from "./types";

import { validateManagedEventTypePushPreconditions } from "./checkForEmptyAssignment";

// ============================================================================
// MANAGED EVENT TYPE PUSH — PURE BUSINESS LOGIC (AG-003)
// ============================================================================
// This module encapsulates the business rules for managed event type push
// operations. All functions are pure — they perform no database access and
// produce no side effects. They compute the distribution delta, validate
// push preconditions, and generate human-readable summaries.
//
// The actual Prisma operations for creating/updating/deleting child event
// types are handled by `handleChildrenEventTypes.ts` in the managed-event-types
// package. This module provides the complementary decision logic that
// determines WHAT should be pushed before the handler executes HOW.
//
// Consumers:
//   - packages/features/ee/managed-event-types/lib/handleChildrenEventTypes.ts
//   - packages/features/ee/teams/services/teamService.ts
//   - packages/features/eventtypes/lib/__tests__/eventTypeParity.test.ts
// ============================================================================

/**
 * Computes the distribution delta for a managed event type push operation (AG-003).
 *
 * Given the push configuration and the list of existing child event types,
 * determines which team members need new child event types, which already have
 * them (and need updates), and which should have their child event types removed.
 *
 * This is a pure function that performs no database operations — it computes
 * the delta that the caller can then use to orchestrate the actual push via
 * `handleChildrenEventTypes` or repository methods.
 *
 * The logic mirrors the existing delta computation in `handleChildrenEventTypes.ts`
 * which computes `newUserIds`, `oldUserIds`, `deletedUserIds` by comparing
 * previous children with the current payload.
 *
 * @param config - The managed event type push configuration with target member IDs.
 *   Uses `config.eventTypeId` as the parent event type identifier,
 *   `config.targetMemberIds` as the desired member set, and
 *   `config.schedulingType` for context (must be "MANAGED" for valid pushes).
 * @param existingChildren - Array of existing child event types with their owner
 *   user IDs. Each entry maps a `userId` (nullable — orphaned children are
 *   filtered out) to its `childEventTypeId`.
 * @returns The distribution delta as a `ManagedEventTypeDistributionResult`
 *   containing `parentEventTypeId`, categorized member ID arrays
 *   (`newMemberIds`, `existingMemberIds`, `removedMemberIds`), detailed
 *   per-member status in `members`, and `totalAffected` count.
 *
 * @example
 * ```typescript
 * const delta = computeManagedEventTypePushDelta(
 *   { eventTypeId: 1, title: "Team Meeting", slug: "team-meeting",
 *     schedulingType: "MANAGED", teamId: 10, assignAllTeamMembers: false,
 *     targetMemberIds: [101, 102, 103] },
 *   [{ userId: 101, childEventTypeId: 50 }, { userId: 104, childEventTypeId: 51 }]
 * );
 * // delta.newMemberIds = [102, 103]      — need new child event types
 * // delta.existingMemberIds = [101]       — already have, may need update
 * // delta.removedMemberIds = [104]        — no longer targeted, clean up
 * // delta.totalAffected = 4
 * ```
 */
export function computeManagedEventTypePushDelta(
  config: ManagedEventTypePushConfig,
  existingChildren: Array<{ userId: number | null; childEventTypeId: number }>
): ManagedEventTypeDistributionResult {
  const targetSet = new Set(config.targetMemberIds);

  // Build a map of existing children by userId for O(1) lookups.
  // Children with null userId are orphaned records and are excluded from
  // delta computation — they have no owning user to categorize.
  const existingByUserId = new Map<number, number>();
  for (const child of existingChildren) {
    if (child.userId !== null) {
      existingByUserId.set(child.userId, child.childEventTypeId);
    }
  }

  const members: ManagedEventTypePushMember[] = [];
  const newMemberIds: number[] = [];
  const existingMemberIds: number[] = [];
  const removedMemberIds: number[] = [];

  // Phase 1: Categorize each target member as "new" or "existing" by checking
  // whether they already have a child event type in the existing set.
  for (const targetUserId of config.targetMemberIds) {
    const existingChildId = existingByUserId.get(targetUserId);

    if (existingChildId !== undefined) {
      // Member already has a child event type — mark for update
      existingMemberIds.push(targetUserId);
      members.push({
        userId: targetUserId,
        childEventTypeId: existingChildId,
        status: "existing",
      });
    } else {
      // Member does not have a child event type — mark for creation
      newMemberIds.push(targetUserId);
      members.push({
        userId: targetUserId,
        status: "new",
      });
    }
  }

  // Phase 2: Identify removed members — existing children whose userId is
  // NOT in the target set. These child event types should be cleaned up.
  // Uses .forEach() instead of for-of to maintain ES5 target compatibility
  // without requiring the --downlevelIteration flag.
  existingByUserId.forEach((childEventTypeId, userId) => {
    if (!targetSet.has(userId)) {
      removedMemberIds.push(userId);
      members.push({
        userId,
        childEventTypeId,
        status: "removed",
      });
    }
  });

  return {
    parentEventTypeId: config.eventTypeId,
    newMemberIds,
    existingMemberIds,
    removedMemberIds,
    members,
    totalAffected: newMemberIds.length + existingMemberIds.length + removedMemberIds.length,
  };
}

/**
 * Determines whether a managed event type push configuration is eligible
 * for distribution (AG-003).
 *
 * Combines precondition validation (via `validateManagedEventTypePushPreconditions`)
 * with a check that the push would actually result in changes — i.e., there is
 * at least one member in the new, existing, or removed category.
 *
 * A push is NOT eligible when:
 * - The `schedulingType` is not `"MANAGED"` (precondition failure)
 * - The `teamId` is null or missing (precondition failure)
 * - The `targetMemberIds` array is empty (precondition failure)
 * - The `title` or `slug` are empty/whitespace (precondition failure)
 * - The computed delta has zero affected members (no-op push)
 *
 * @param config - The managed event type push configuration to evaluate
 * @param existingChildren - Array of existing child event types with owner user IDs
 * @returns `true` if the push is valid and would result in at least one change
 */
export function isManagedEventTypePushEligible(
  config: ManagedEventTypePushConfig,
  existingChildren: Array<{ userId: number | null; childEventTypeId: number }>
): boolean {
  // Validate preconditions: schedulingType must be MANAGED, teamId must
  // be present, targetMemberIds must be non-empty, title/slug must be valid
  const validation = validateManagedEventTypePushPreconditions(config);
  if (!validation.isValid) {
    return false;
  }

  // Even if preconditions pass, verify the push would actually do something
  const delta = computeManagedEventTypePushDelta(config, existingChildren);
  return delta.totalAffected > 0;
}

/**
 * Generates a human-readable summary of a managed event type push
 * distribution result (AG-003).
 *
 * Useful for logging, audit trails, and UI feedback during push operations.
 * The summary format is:
 *   `"Managed event type {id}: {N} new, {M} existing, {K} removed ({T} total)"`
 *
 * When no changes are needed, returns:
 *   `"Managed event type {id}: no changes needed"`
 *
 * @param result - The distribution result from `computeManagedEventTypePushDelta`.
 *   Reads `result.parentEventTypeId` for identification, `result.newMemberIds`,
 *   `result.existingMemberIds`, `result.removedMemberIds` for counts, and
 *   `result.totalAffected` for the total.
 * @returns A concise summary string describing the push distribution
 */
export function getManagedEventTypePushSummary(
  result: ManagedEventTypeDistributionResult
): string {
  const parts: string[] = [];

  if (result.newMemberIds.length > 0) {
    parts.push(`${result.newMemberIds.length} new`);
  }
  if (result.existingMemberIds.length > 0) {
    parts.push(`${result.existingMemberIds.length} existing`);
  }
  if (result.removedMemberIds.length > 0) {
    parts.push(`${result.removedMemberIds.length} removed`);
  }

  if (parts.length === 0) {
    return `Managed event type ${result.parentEventTypeId}: no changes needed`;
  }

  return `Managed event type ${result.parentEventTypeId}: ${parts.join(", ")} (${result.totalAffected} total)`;
}
