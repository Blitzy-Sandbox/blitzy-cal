import { describe, expect, it, vi, beforeEach } from "vitest";

import { prisma } from "@calcom/prisma";
import type { TrpcSessionUser } from "@calcom/trpc/server/trpc";

import { MembershipRole } from "@calcom/prisma/enums";

import { OrganizationPermissionService } from "./OrganizationPermissionService";

vi.mock("@calcom/prisma", () => ({
  prisma: {
    organizationOnboarding: {
      findUnique: vi.fn(),
    },
    membership: {
      findMany: vi.fn(),
    },
    team: {
      findFirst: vi.fn(),
    },
  },
}));

describe("OrganizationPermissionService", () => {
  let service: OrganizationPermissionService;
  const mockUser: TrpcSessionUser = {
    id: 1,
    email: "test@example.com",
    role: "USER",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    service = new OrganizationPermissionService(mockUser);
  });

  describe("hasPermissionToCreateForEmail", () => {
    it("should allow users to create for their own email", async () => {
      const result = await service.hasPermissionToCreateForEmail("test@example.com");
      expect(result).toBe(true);
    });

    it("should not allow users to create for other emails", async () => {
      const result = await service.hasPermissionToCreateForEmail("other@example.com");
      expect(result).toBe(false);
    });

    it("should allow admins to create for any email", async () => {
      const adminService = new OrganizationPermissionService({ ...mockUser, role: "ADMIN" });
      const result = await adminService.hasPermissionToCreateForEmail("other@example.com");
      expect(result).toBe(true);
    });
  });

  describe("hasPermissionToMigrateTeams", () => {
    it("should return true if user has required permissions for all teams", async () => {
      vi.mocked(prisma.membership.findMany).mockResolvedValue([
        { userId: 1, teamId: 1, role: "OWNER" },
        { userId: 1, teamId: 2, role: "ADMIN" },
      ]);

      const result = await service.hasPermissionToMigrateTeams([1, 2]);
      expect(result).toBe(true);
    });

    it("should return false if user lacks permissions for any team", async () => {
      vi.mocked(prisma.membership.findMany).mockResolvedValue([{ userId: 1, teamId: 1, role: "OWNER" }]);

      const result = await service.hasPermissionToMigrateTeams([1, 2]);
      expect(result).toBe(false);
    });

    it("should return true for empty team list", async () => {
      const result = await service.hasPermissionToMigrateTeams([]);
      expect(result).toBe(true);
    });
  });

  describe("validatePermissions", () => {
    it("should validate all permissions successfully", async () => {
      vi.mocked(prisma.organizationOnboarding.findUnique).mockResolvedValue(null);
      vi.mocked(prisma.membership.findMany).mockResolvedValue([{ userId: 1, teamId: 1, role: "OWNER" }]);

      const result = await service.validatePermissions({
        orgOwnerEmail: "test@example.com",
        teams: [{ id: 1, isBeingMigrated: true }],
      });

      expect(result).toBe(true);
    });

    it("should throw error for unauthorized email", async () => {
      await expect(
        service.validatePermissions({
          orgOwnerEmail: "other@example.com",
        })
      ).rejects.toThrow("you_do_not_have_permission_to_create_an_organization_for_this_email");
    });
  });

  // ---------------------------------------------------------------------------
  // Calendly Role Parity Tests (AG-001)
  // ---------------------------------------------------------------------------

  describe("canManageOrganizationSettings", () => {
    it("should return true for OWNER role", () => {
      const result = service.canManageOrganizationSettings(MembershipRole.OWNER);
      expect(result).toBe(true);
    });

    it("should return true for ADMIN role", () => {
      const result = service.canManageOrganizationSettings(MembershipRole.ADMIN);
      expect(result).toBe(true);
    });

    it("should return false for MEMBER role", () => {
      const result = service.canManageOrganizationSettings(MembershipRole.MEMBER);
      expect(result).toBe(false);
    });
  });

  describe("canManageMembers", () => {
    it("should return true for OWNER role", () => {
      const result = service.canManageMembers(MembershipRole.OWNER);
      expect(result).toBe(true);
    });

    it("should return true for ADMIN role", () => {
      const result = service.canManageMembers(MembershipRole.ADMIN);
      expect(result).toBe(true);
    });

    it("should return false for MEMBER role", () => {
      const result = service.canManageMembers(MembershipRole.MEMBER);
      expect(result).toBe(false);
    });
  });

  describe("canManageTeams", () => {
    it("should return true for OWNER role", () => {
      const result = service.canManageTeams(MembershipRole.OWNER);
      expect(result).toBe(true);
    });

    it("should return true for ADMIN role", () => {
      const result = service.canManageTeams(MembershipRole.ADMIN);
      expect(result).toBe(true);
    });

    it("should return false for MEMBER role", () => {
      const result = service.canManageTeams(MembershipRole.MEMBER);
      expect(result).toBe(false);
    });
  });

  describe("canManageBilling", () => {
    it("should return true for OWNER role", () => {
      const result = service.canManageBilling(MembershipRole.OWNER);
      expect(result).toBe(true);
    });

    it("should return false for ADMIN role", () => {
      const result = service.canManageBilling(MembershipRole.ADMIN);
      expect(result).toBe(false);
    });

    it("should return false for MEMBER role", () => {
      const result = service.canManageBilling(MembershipRole.MEMBER);
      expect(result).toBe(false);
    });
  });

  describe("canAssignRoles", () => {
    it("OWNER can assign any role including OWNER", () => {
      expect(service.canAssignRoles(MembershipRole.OWNER, MembershipRole.OWNER)).toBe(true);
    });

    it("OWNER can assign ADMIN role", () => {
      expect(service.canAssignRoles(MembershipRole.OWNER, MembershipRole.ADMIN)).toBe(true);
    });

    it("OWNER can assign MEMBER role", () => {
      expect(service.canAssignRoles(MembershipRole.OWNER, MembershipRole.MEMBER)).toBe(true);
    });

    it("ADMIN can assign ADMIN role", () => {
      expect(service.canAssignRoles(MembershipRole.ADMIN, MembershipRole.ADMIN)).toBe(true);
    });

    it("ADMIN can assign MEMBER role", () => {
      expect(service.canAssignRoles(MembershipRole.ADMIN, MembershipRole.MEMBER)).toBe(true);
    });

    it("ADMIN cannot assign OWNER role", () => {
      expect(service.canAssignRoles(MembershipRole.ADMIN, MembershipRole.OWNER)).toBe(false);
    });

    it("MEMBER cannot assign any role", () => {
      expect(service.canAssignRoles(MembershipRole.MEMBER, MembershipRole.ADMIN)).toBe(false);
      expect(service.canAssignRoles(MembershipRole.MEMBER, MembershipRole.MEMBER)).toBe(false);
    });
  });

  describe("canRemoveMember", () => {
    it("OWNER can remove ADMIN", () => {
      expect(service.canRemoveMember(MembershipRole.OWNER, MembershipRole.ADMIN)).toBe(true);
    });

    it("OWNER can remove MEMBER", () => {
      expect(service.canRemoveMember(MembershipRole.OWNER, MembershipRole.MEMBER)).toBe(true);
    });

    it("OWNER can remove another OWNER", () => {
      expect(service.canRemoveMember(MembershipRole.OWNER, MembershipRole.OWNER)).toBe(true);
    });

    it("ADMIN can remove MEMBER", () => {
      expect(service.canRemoveMember(MembershipRole.ADMIN, MembershipRole.MEMBER)).toBe(true);
    });

    it("ADMIN cannot remove ADMIN", () => {
      expect(service.canRemoveMember(MembershipRole.ADMIN, MembershipRole.ADMIN)).toBe(false);
    });

    it("ADMIN cannot remove OWNER", () => {
      expect(service.canRemoveMember(MembershipRole.ADMIN, MembershipRole.OWNER)).toBe(false);
    });

    it("MEMBER cannot remove anyone", () => {
      expect(service.canRemoveMember(MembershipRole.MEMBER, MembershipRole.MEMBER)).toBe(false);
      expect(service.canRemoveMember(MembershipRole.MEMBER, MembershipRole.ADMIN)).toBe(false);
    });
  });

  describe("getCalendlyEquivalentRole", () => {
    it("should map OWNER to 'owner'", () => {
      expect(service.getCalendlyEquivalentRole(MembershipRole.OWNER)).toBe("owner");
    });

    it("should map ADMIN to 'admin'", () => {
      expect(service.getCalendlyEquivalentRole(MembershipRole.ADMIN)).toBe("admin");
    });

    it("should map MEMBER to 'user'", () => {
      expect(service.getCalendlyEquivalentRole(MembershipRole.MEMBER)).toBe("user");
    });
  });

  describe("getPermissionsForRole", () => {
    it("should return all-true permissions for OWNER", () => {
      const permissions = service.getPermissionsForRole(MembershipRole.OWNER);
      expect(permissions).toEqual({
        canManageOrganizationSettings: true,
        canManageMembers: true,
        canManageTeams: true,
        canManageBilling: true,
        canViewReports: true,
        canManageEventTypes: true,
      });
    });

    it("should return correct permissions for ADMIN", () => {
      const permissions = service.getPermissionsForRole(MembershipRole.ADMIN);
      expect(permissions).toEqual({
        canManageOrganizationSettings: true,
        canManageMembers: true,
        canManageTeams: true,
        canManageBilling: false,
        canViewReports: true,
        canManageEventTypes: true,
      });
    });

    it("should return correct permissions for MEMBER", () => {
      const permissions = service.getPermissionsForRole(MembershipRole.MEMBER);
      expect(permissions).toEqual({
        canManageOrganizationSettings: false,
        canManageMembers: false,
        canManageTeams: false,
        canManageBilling: false,
        canViewReports: false,
        canManageEventTypes: true,
      });
    });
  });
});
