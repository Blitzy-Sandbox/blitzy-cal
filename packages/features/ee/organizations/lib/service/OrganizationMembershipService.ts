import type { IOrganizationRepository } from "../repository/IOrganizationRepository";

import type { OrganizationPermissionService } from "@calcom/features/ee/organizations/lib/OrganizationPermissionService";
import type { OrganizationRepository } from "@calcom/features/ee/organizations/repositories/OrganizationRepository";
import type { MembershipRole } from "@calcom/prisma/enums";

export interface IOrganizationMembershipServiceDependencies {
  organizationRepository: IOrganizationRepository;
  permissionService?: OrganizationPermissionService;
  fullOrganizationRepository?: OrganizationRepository;
}

export class OrganizationMembershipService {
  constructor(private readonly deps: IOrganizationMembershipServiceDependencies) {}

  /**
   * Determines if user should be auto-accepted to an organization or its sub-teams based on email domain
   */
  async shouldAutoAccept({
    organizationId,
    userEmail,
  }: {
    organizationId: number;
    userEmail: string;
  }): Promise<boolean> {
    const orgSettings =
      await this.deps.organizationRepository.getOrganizationAutoAcceptSettings(organizationId);

    if (!orgSettings) return false;

    const { orgAutoAcceptEmail, isOrganizationVerified } = orgSettings;

    if (!isOrganizationVerified || !orgAutoAcceptEmail) return false;

    // Case-insensitive comparison (email domains are case-insensitive per RFC)
    const emailDomain = userEmail.split("@")[1]?.trim().toLowerCase();
    const autoAcceptEmailDomain = orgAutoAcceptEmail.trim().toLowerCase();

    if (!emailDomain) return false;

    return emailDomain === autoAcceptEmailDomain;
  }

  /**
   * Transitions a member's role within an organization after permission validation.
   * Ensures the actor has sufficient privileges to assign the target role.
   * Used for Calendly-equivalent admin panel role management (AG-001).
   */
  async transitionRole({
    organizationId,
    userId,
    fromRole: _fromRole,
    toRole,
    actorRole,
  }: {
    organizationId: number;
    userId: number;
    fromRole: MembershipRole;
    toRole: MembershipRole;
    actorRole: MembershipRole;
  }): Promise<boolean> {
    const { permissionService, fullOrganizationRepository } = this.deps;

    if (!permissionService || !fullOrganizationRepository) {
      throw new Error("Permission service and organization repository are required for role transitions");
    }

    if (!permissionService.canAssignRoles(actorRole, toRole)) {
      throw new Error(
        `Role ${actorRole} does not have permission to assign role ${toRole}`
      );
    }

    await fullOrganizationRepository.transitionMemberRole({
      orgId: organizationId,
      userId,
      newRole: toRole,
    });

    return true;
  }

  /**
   * Returns members of an organization filtered by a specific role.
   * Used for Calendly-equivalent admin panel member listing (AG-001).
   */
  async getMembersByRole({
    organizationId,
    role,
  }: {
    organizationId: number;
    role: MembershipRole;
  }): Promise<{ userId: number; role: MembershipRole }[]> {
    const { fullOrganizationRepository } = this.deps;

    if (!fullOrganizationRepository) {
      throw new Error("Organization repository is required for member queries");
    }

    const members = await fullOrganizationRepository.findMembersByRole({
      orgId: organizationId,
      role,
    });

    return members.map((member) => ({
      userId: member.user.id,
      role: member.role as MembershipRole,
    }));
  }
}
