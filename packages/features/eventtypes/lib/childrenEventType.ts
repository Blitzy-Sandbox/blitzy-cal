import type { MembershipRole } from "@calcom/prisma/enums";
import type { UserProfile } from "@calcom/types/UserProfile";

export type ChildrenEventType = {
  value: string;
  label: string;
  created: boolean;
  owner: {
    avatar: string;
    id: number;
    email: string;
    name: string;
    username: string;
    membership: MembershipRole;
    eventTypeSlugs: string[];
    profile: UserProfile;
  };
  slug: string;
  hidden: boolean;
  /**
   * Status of the managed event type push operation (AG-003).
   * - "pending": Push initiated but not yet completed
   * - "active": Successfully pushed and active for the team member
   * - "failed": Push attempted but failed (e.g., slug conflict)
   * - undefined: Legacy children created before push tracking was added
   */
  pushStatus?: "pending" | "active" | "failed";
  /**
   * ISO 8601 timestamp of when this managed event type was last pushed
   * to the team member (AG-003). Used for tracking distribution timing
   * and identifying stale child event types.
   */
  pushedAt?: string;
};
