import type { EventTypeAssignedUsers, EventTypeHosts } from "./types";
import type { ManagedEventTypePushConfig } from "./types";

// This function checks if EventType requires assignment.
// returns true: if EventType requires assignment but there is no assignment yet done by the user.
// returns false: for all other scenarios.
export function checkForEmptyAssignment({
  assignedUsers,
  hosts,
  isManagedEventType,
  assignAllTeamMembers,
}: {
  assignedUsers: EventTypeAssignedUsers;
  hosts: EventTypeHosts;
  isManagedEventType: boolean;
  assignAllTeamMembers: boolean;
}): boolean {
  // If Team-events have assignAllTeamMembers checked, return false as assignment is complete.
  if (assignAllTeamMembers) {
    return false;
  }

  // For managed eventtype check if assigned users are empty.
  // For non-managed eventtype check if hosts are empty.
  if (isManagedEventType ? assignedUsers.length === 0 : hosts.length === 0) {
    return true;
  }

  return false;
}

/**
 * Validates preconditions for pushing a managed event type template to team members (AG-003).
 *
 * Returns an object with `isValid` boolean and an optional `reason` string explaining
 * why the push cannot proceed. Used by the managed event type push workflow to verify
 * that a managed template has the required configuration before distribution.
 *
 * Preconditions checked:
 * 1. The event type must have `schedulingType === "MANAGED"` (only managed templates can be pushed)
 * 2. The event type must be associated with a team (`teamId` must be present)
 * 3. There must be at least one target member to push to (`targetMemberIds` must not be empty)
 * 4. The template must have a valid title and slug
 *
 * @param config - The managed event type push configuration to validate
 * @returns Object with `isValid` and optional `reason` for failure
 */
export function validateManagedEventTypePushPreconditions(config: ManagedEventTypePushConfig): {
  isValid: boolean;
  reason?: string;
} {
  // Check 1: Must be a MANAGED scheduling type
  if (config.schedulingType !== "MANAGED") {
    return {
      isValid: false,
      reason: "Only managed event types (schedulingType: MANAGED) can be pushed to team members",
    };
  }

  // Check 2: Must be associated with a team
  if (!config.teamId) {
    return {
      isValid: false,
      reason: "Managed event type must be associated with a team to be pushed",
    };
  }

  // Check 3: Must have at least one target member
  if (!config.targetMemberIds || config.targetMemberIds.length === 0) {
    return {
      isValid: false,
      reason: "At least one target team member must be specified for push distribution",
    };
  }

  // Check 4: Must have a valid title and slug
  if (!config.title || config.title.trim().length === 0) {
    return {
      isValid: false,
      reason: "Managed event type template must have a valid title before push",
    };
  }

  if (!config.slug || config.slug.trim().length === 0) {
    return {
      isValid: false,
      reason: "Managed event type template must have a valid slug before push",
    };
  }

  return { isValid: true };
}
