import { MembershipRepository } from "@calcom/features/membership/repositories/MembershipRepository";
import { MembershipRole } from "@calcom/prisma/enums";

export type MembershipCheckResult = {
  isMember: boolean;
  isAdmin: boolean;
  isOwner: boolean;
  role?: MembershipRole;
  isPending: boolean;
  calendlyRoleEquivalent?: "admin" | "owner" | "user";
};

export class MembershipService {
  constructor(private readonly membershipRepository: MembershipRepository = new MembershipRepository()) {}

  /**
   * Maps Cal.com MembershipRole to Calendly's role equivalent.
   * OWNER → "owner", ADMIN → "admin", MEMBER → "user"
   */
  private mapRoleToCalendlyEquivalent(role: MembershipRole): "admin" | "owner" | "user" {
    switch (role) {
      case MembershipRole.OWNER:
        return "owner";
      case MembershipRole.ADMIN:
        return "admin";
      case MembershipRole.MEMBER:
        return "user";
    }
  }

  /**
   * Checks the membership status of a user within a specific team.
   */
  async checkMembership(teamId: number, userId: number): Promise<MembershipCheckResult> {
    const membership = await this.membershipRepository.findUniqueByUserIdAndTeamId({ teamId, userId });

    if (!membership) {
      return {
        isMember: false,
        isAdmin: false,
        isOwner: false,
        role: undefined,
        isPending: false,
        calendlyRoleEquivalent: undefined,
      };
    }

    if (!membership.accepted) {
      return {
        isMember: false,
        isAdmin: false,
        isOwner: false,
        role: membership.role,
        isPending: true,
        calendlyRoleEquivalent: this.mapRoleToCalendlyEquivalent(membership.role),
      };
    }

    const { role } = membership;
    const isOwner = role === MembershipRole.OWNER;
    const isAdmin = isOwner || role === MembershipRole.ADMIN;

    return {
      isMember: true,
      isAdmin,
      isOwner,
      role,
      isPending: false,
      calendlyRoleEquivalent: this.mapRoleToCalendlyEquivalent(role),
    };
  }

  /**
   * Extended membership check that includes invitation-aware state.
   * Returns richer result including invitation state, role assignment, and Calendly role mapping.
   * Enables AG-004 invitation workflow parity where membership status must distinguish
   * "not invited", "invited but pending", and "accepted member".
   */
  async checkMembershipWithInviteStatus(
    teamId: number,
    userId: number
  ): Promise<MembershipCheckResult & { invitationState: "none" | "pending" | "accepted" }> {
    const result = await this.checkMembership(teamId, userId);

    let invitationState: "none" | "pending" | "accepted";
    if (result.isMember) {
      invitationState = "accepted";
    } else if (result.isPending) {
      invitationState = "pending";
    } else {
      invitationState = "none";
    }

    return {
      ...result,
      invitationState,
    };
  }

  /**
   * Returns numeric hierarchy level for role comparison.
   * OWNER = 3, ADMIN = 2, MEMBER = 1.
   * Used for role transition validation — can only be promoted by someone with higher or equal level.
   * Aligns with Calendly's role hierarchy enforcement.
   */
  static getRoleHierarchyLevel(role: MembershipRole): number {
    switch (role) {
      case MembershipRole.OWNER:
        return 3;
      case MembershipRole.ADMIN:
        return 2;
      case MembershipRole.MEMBER:
        return 1;
    }
  }

  /**
   * Determines if an actor with the given role can manage (invite/change/remove) a member with the target role.
   * OWNER can manage all, ADMIN can manage MEMBER and ADMIN, MEMBER cannot manage anyone.
   * Supports AG-001 PBAC alignment with Calendly's role-based permission hierarchy.
   */
  static canManageRole(actorRole: MembershipRole, targetRole: MembershipRole): boolean {
    if (actorRole === MembershipRole.MEMBER) {
      return false;
    }
    const actorLevel = MembershipService.getRoleHierarchyLevel(actorRole);
    const targetLevel = MembershipService.getRoleHierarchyLevel(targetRole);
    return actorLevel >= targetLevel;
  }

  /**
   * Validates whether an invitation can be accepted by the given user for the given team.
   * Returns validation result with the pending membership's role if found.
   */
  async validateInvitation(
    userId: number,
    teamId: number
  ): Promise<{ canAccept: boolean; reason?: string; role?: MembershipRole }> {
    const membership = await this.membershipRepository.findUniqueByUserIdAndTeamId({ teamId, userId });

    if (!membership) {
      return { canAccept: false, reason: "No invitation found" };
    }

    if (membership.accepted) {
      return { canAccept: false, reason: "Membership already accepted", role: membership.role };
    }

    return { canAccept: true, role: membership.role };
  }

  /**
   * Accepts a pending invitation for the given user and team.
   * Delegates to repository to update accepted status.
   * Returns the updated membership check result or null if no pending invitation found.
   */
  async acceptInvitation(userId: number, teamId: number): Promise<MembershipCheckResult | null> {
    const accepted = await this.membershipRepository.acceptMembership({ userId, teamId });

    if (!accepted) {
      return null;
    }

    return this.checkMembership(teamId, userId);
  }

  /**
   * Rejects (deletes) a pending invitation for the given user and team.
   * Delegates to repository to delete the pending membership.
   * Returns true if the invitation was successfully rejected, false otherwise.
   */
  async rejectInvitation(userId: number, teamId: number): Promise<boolean> {
    const rejected = await this.membershipRepository.rejectMembership({ userId, teamId });
    return rejected !== null;
  }
}
