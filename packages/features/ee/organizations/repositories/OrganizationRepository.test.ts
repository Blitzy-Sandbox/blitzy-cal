import prismock from "@calcom/testing/lib/__mocks__/prisma";

import { describe, it, expect, beforeEach, vi } from "vitest";

import { OrganizationRepository } from "@calcom/features/ee/organizations/repositories/OrganizationRepository";
import type { Prisma } from "@calcom/prisma/client";
import { MembershipRole } from "@calcom/prisma/enums";

vi.mock("@calcom/features/ee/teams/lib/getParsedTeam", () => ({
  getParsedTeam: <T>(org: T) => org,
}));

const organizationRepository = new OrganizationRepository({ prismaClient: prismock });

async function createOrganization(
  data: Prisma.TeamCreateInput & {
    organizationSettings: {
      create: Prisma.OrganizationSettingsCreateWithoutOrganizationInput;
    };
  }
) {
  return await prismock.team.create({
    data: {
      isOrganization: true,
      ...data,
    },
  });
}

async function createReviewedOrganization({
  name = "Test Org",
  orgAutoAcceptEmail,
}: {
  name: string;
  orgAutoAcceptEmail: string;
}) {
  return await createOrganization({
    name,
    organizationSettings: {
      create: {
        orgAutoAcceptEmail,
        isOrganizationVerified: true,
        isAdminReviewed: true,
      },
    },
  });
}

async function createTeam({
  name = "Test Team",
  orgAutoAcceptEmail,
}: {
  name: string;
  orgAutoAcceptEmail: string;
}) {
  return await prismock.team.create({
    data: {
      name,
      isOrganization: false,
      organizationSettings: {
        create: {
          orgAutoAcceptEmail,
        },
      },
    },
  });
}

async function createUser({ email, name }: { email: string; name: string }) {
  return await prismock.user.create({
    data: {
      email,
      name,
      username: email.split("@")[0],
    },
  });
}

async function createMembership({
  teamId,
  userId,
  role,
  accepted = true,
}: {
  teamId: number;
  userId: number;
  role: MembershipRole;
  accepted?: boolean;
}) {
  return await prismock.membership.create({
    data: {
      teamId,
      userId,
      role,
      accepted,
    },
  });
}

beforeEach(async () => {
  vi.resetAllMocks();
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  await prismock.reset();
});

describe("Organization.findUniqueNonPlatformOrgsByMatchingAutoAcceptEmail", () => {
  it("should return null if no organization matches the email domain", async () => {
    const result = await organizationRepository.findUniqueNonPlatformOrgsByMatchingAutoAcceptEmail({
      email: "test@example.com",
    });

    expect(result).toBeNull();
  });

  it("should return null if multiple organizations match the email domain", async () => {
    await createReviewedOrganization({ name: "Test Org 1", orgAutoAcceptEmail: "example.com" });
    await createReviewedOrganization({ name: "Test Org 2", orgAutoAcceptEmail: "example.com" });

    const result = await organizationRepository.findUniqueNonPlatformOrgsByMatchingAutoAcceptEmail({
      email: "test@example.com",
    });

    expect(result).toBeNull();
  });

  it("should return the parsed organization if a single match is found", async () => {
    const organization = await createReviewedOrganization({
      name: "Test Org",
      orgAutoAcceptEmail: "example.com",
    });

    const result = await organizationRepository.findUniqueNonPlatformOrgsByMatchingAutoAcceptEmail({
      email: "test@example.com",
    });

    expect(result).toEqual(organization);
  });

  it("should not confuse a team with organization", async () => {
    await createTeam({ name: "Test Team", orgAutoAcceptEmail: "example.com" });

    const result = await organizationRepository.findUniqueNonPlatformOrgsByMatchingAutoAcceptEmail({
      email: "test@example.com",
    });

    expect(result).toEqual(null);
  });

  it("should correctly match orgAutoAcceptEmail", async () => {
    await createReviewedOrganization({ name: "Test Org", orgAutoAcceptEmail: "noexample.com" });

    const result = await organizationRepository.findUniqueNonPlatformOrgsByMatchingAutoAcceptEmail({
      email: "test@example.com",
    });

    expect(result).toEqual(null);
  });

  it("should return null when orgAutoJoinOnSignup is false", async () => {
    await prismock.team.create({
      data: {
        name: "Test Org",
        isOrganization: true,
        organizationSettings: {
          create: {
            orgAutoAcceptEmail: "example.com",
            isOrganizationVerified: true,
            isAdminReviewed: true,
            orgAutoJoinOnSignup: false,
          },
        },
      },
    });

    const result = await organizationRepository.findUniqueNonPlatformOrgsByMatchingAutoAcceptEmail({
      email: "test@example.com",
    });

    expect(result).toBeNull();
  });

  it("should return organization when orgAutoJoinOnSignup is true", async () => {
    const organization = await prismock.team.create({
      data: {
        name: "Test Org",
        isOrganization: true,
        organizationSettings: {
          create: {
            orgAutoAcceptEmail: "example.com",
            isOrganizationVerified: true,
            isAdminReviewed: true,
            orgAutoJoinOnSignup: true,
          },
        },
      },
    });

    const result = await organizationRepository.findUniqueNonPlatformOrgsByMatchingAutoAcceptEmail({
      email: "test@example.com",
    });

    expect(result).toEqual(organization);
  });

  it("should return organization when orgAutoJoinOnSignup is not explicitly set (defaults to true)", async () => {
    const organization = await createReviewedOrganization({
      name: "Test Org",
      orgAutoAcceptEmail: "example.com",
    });

    const result = await organizationRepository.findUniqueNonPlatformOrgsByMatchingAutoAcceptEmail({
      email: "test@example.com",
    });

    expect(result).toEqual(organization);
  });
});

describe("Organization.getVerifiedOrganizationByAutoAcceptEmailDomain", () => {
  it("should return organization when domain matches and organization is verified", async () => {
    const verifiedOrganization = await createOrganization({
      name: "Test Org",
      organizationSettings: { create: { orgAutoAcceptEmail: "cal.com", isOrganizationVerified: true } },
    });

    const result = await organizationRepository.getVerifiedOrganizationByAutoAcceptEmailDomain("cal.com");

    expect(result).toEqual({
      id: verifiedOrganization.id,
      organizationSettings: {
        orgAutoAcceptEmail: "cal.com",
      },
    });
  });

  it("should not return organization when organization is not verified", async () => {
    await createOrganization({
      name: "Test Org",
      organizationSettings: { create: { orgAutoAcceptEmail: "cal.com", isOrganizationVerified: false } },
    });

    const result = await organizationRepository.getVerifiedOrganizationByAutoAcceptEmailDomain("cal.com");

    expect(result).toEqual(null);
  });
});

describe("Organization.create", () => {
  it("should create organization with branding data (logoUrl, brandColor, bannerUrl)", async () => {
    const orgData = {
      name: "Test Organization",
      slug: "test-org",
      isOrganizationConfigured: true,
      isOrganizationAdminReviewed: true,
      autoAcceptEmail: "test.com",
      seats: 10,
      pricePerSeat: 15,
      isPlatform: false,
      billingPeriod: "MONTHLY" as const,
      logoUrl: "https://example.com/logo.png",
      bio: "Test organization bio",
      brandColor: "#FF5733",
      bannerUrl: "https://example.com/banner.jpg",
    };

    const organization = await organizationRepository.create(orgData);

    expect(organization).toMatchObject({
      name: "Test Organization",
      slug: "test-org",
      isOrganization: true,
      logoUrl: "https://example.com/logo.png",
      bio: "Test organization bio",
      brandColor: "#FF5733",
      bannerUrl: "https://example.com/banner.jpg",
    });
  });

  it("should create organization with null branding data", async () => {
    const orgData = {
      name: "Test Organization",
      slug: "test-org-2",
      isOrganizationConfigured: true,
      isOrganizationAdminReviewed: true,
      autoAcceptEmail: "test.com",
      seats: null,
      pricePerSeat: null,
      isPlatform: false,
      logoUrl: null,
      bio: null,
      brandColor: null,
      bannerUrl: null,
    };

    const organization = await organizationRepository.create(orgData);

    expect(organization).toMatchObject({
      name: "Test Organization",
      slug: "test-org-2",
      isOrganization: true,
      logoUrl: null,
      bio: null,
      brandColor: null,
      bannerUrl: null,
    });
  });
});

describe("Organization.findMembersByRole", () => {
  it("should return members with the specified OWNER role", async () => {
    const org = await createReviewedOrganization({ name: "Role Test Org", orgAutoAcceptEmail: "role.com" });
    const ownerUser = await createUser({ email: "owner@role.com", name: "Owner User" });
    const memberUser = await createUser({ email: "member@role.com", name: "Member User" });
    await createMembership({ teamId: org.id, userId: ownerUser.id, role: MembershipRole.OWNER });
    await createMembership({ teamId: org.id, userId: memberUser.id, role: MembershipRole.MEMBER });

    const result = await organizationRepository.findMembersByRole({
      orgId: org.id,
      role: MembershipRole.OWNER,
    });

    expect(result).toHaveLength(1);
    expect(result[0].user.id).toBe(ownerUser.id);
    expect(result[0].user.email).toBe("owner@role.com");
    expect(result[0].role).toBe(MembershipRole.OWNER);
  });

  it("should return empty array when no members have the specified role", async () => {
    const org = await createReviewedOrganization({ name: "No Admin Org", orgAutoAcceptEmail: "noadmin.com" });
    const memberUser = await createUser({ email: "member@noadmin.com", name: "Member User" });
    await createMembership({ teamId: org.id, userId: memberUser.id, role: MembershipRole.MEMBER });

    const result = await organizationRepository.findMembersByRole({
      orgId: org.id,
      role: MembershipRole.ADMIN,
    });

    expect(result).toHaveLength(0);
  });

  it("should return multiple members with the same role", async () => {
    const org = await createReviewedOrganization({ name: "Multi Admin Org", orgAutoAcceptEmail: "multi.com" });
    const admin1 = await createUser({ email: "admin1@multi.com", name: "Admin One" });
    const admin2 = await createUser({ email: "admin2@multi.com", name: "Admin Two" });
    const admin3 = await createUser({ email: "admin3@multi.com", name: "Admin Three" });
    await createMembership({ teamId: org.id, userId: admin1.id, role: MembershipRole.ADMIN });
    await createMembership({ teamId: org.id, userId: admin2.id, role: MembershipRole.ADMIN });
    await createMembership({ teamId: org.id, userId: admin3.id, role: MembershipRole.ADMIN });

    const result = await organizationRepository.findMembersByRole({
      orgId: org.id,
      role: MembershipRole.ADMIN,
    });

    expect(result).toHaveLength(3);
  });

  it("should only return members from the specified organization", async () => {
    const org1 = await createReviewedOrganization({ name: "Org One", orgAutoAcceptEmail: "org1.com" });
    const org2 = await createReviewedOrganization({ name: "Org Two", orgAutoAcceptEmail: "org2.com" });
    const user = await createUser({ email: "crossorg@test.com", name: "Cross Org User" });
    await createMembership({ teamId: org1.id, userId: user.id, role: MembershipRole.OWNER });
    await createMembership({ teamId: org2.id, userId: user.id, role: MembershipRole.MEMBER });

    const result = await organizationRepository.findMembersByRole({
      orgId: org1.id,
      role: MembershipRole.OWNER,
    });

    expect(result).toHaveLength(1);
    expect(result[0].user.id).toBe(user.id);
    expect(result[0].teamId).toBe(org1.id);
  });
});

describe("Organization.countMembersByRole", () => {
  it("should return role distribution counts", async () => {
    const org = await createReviewedOrganization({ name: "Count Org", orgAutoAcceptEmail: "count.com" });
    const owner = await createUser({ email: "owner@count.com", name: "Owner" });
    const admin1 = await createUser({ email: "admin1@count.com", name: "Admin 1" });
    const admin2 = await createUser({ email: "admin2@count.com", name: "Admin 2" });
    const member1 = await createUser({ email: "member1@count.com", name: "Member 1" });
    const member2 = await createUser({ email: "member2@count.com", name: "Member 2" });
    const member3 = await createUser({ email: "member3@count.com", name: "Member 3" });
    await createMembership({ teamId: org.id, userId: owner.id, role: MembershipRole.OWNER });
    await createMembership({ teamId: org.id, userId: admin1.id, role: MembershipRole.ADMIN });
    await createMembership({ teamId: org.id, userId: admin2.id, role: MembershipRole.ADMIN });
    await createMembership({ teamId: org.id, userId: member1.id, role: MembershipRole.MEMBER });
    await createMembership({ teamId: org.id, userId: member2.id, role: MembershipRole.MEMBER });
    await createMembership({ teamId: org.id, userId: member3.id, role: MembershipRole.MEMBER });

    const result = await organizationRepository.countMembersByRole({ orgId: org.id });

    const ownerCount = result.find((r) => r.role === MembershipRole.OWNER);
    const adminCount = result.find((r) => r.role === MembershipRole.ADMIN);
    const memberCount = result.find((r) => r.role === MembershipRole.MEMBER);
    expect(ownerCount?._count.role).toBe(1);
    expect(adminCount?._count.role).toBe(2);
    expect(memberCount?._count.role).toBe(3);
  });

  it("should return empty results when no members exist", async () => {
    const org = await createReviewedOrganization({ name: "Empty Org", orgAutoAcceptEmail: "empty.com" });

    const result = await organizationRepository.countMembersByRole({ orgId: org.id });

    expect(result).toHaveLength(0);
  });
});

describe("Organization.transitionMemberRole", () => {
  it("should update member role from MEMBER to ADMIN", async () => {
    const org = await createReviewedOrganization({
      name: "Transition Org",
      orgAutoAcceptEmail: "transition.com",
    });
    const user = await createUser({ email: "promote@transition.com", name: "Promote User" });
    await createMembership({ teamId: org.id, userId: user.id, role: MembershipRole.MEMBER });

    const result = await organizationRepository.transitionMemberRole({
      orgId: org.id,
      userId: user.id,
      newRole: MembershipRole.ADMIN,
    });

    expect(result.role).toBe(MembershipRole.ADMIN);
    expect(result.userId).toBe(user.id);
    expect(result.teamId).toBe(org.id);
  });

  it("should update member role from ADMIN to OWNER", async () => {
    const org = await createReviewedOrganization({
      name: "Transition Org 2",
      orgAutoAcceptEmail: "transition2.com",
    });
    const user = await createUser({ email: "adminup@transition2.com", name: "Admin Up User" });
    await createMembership({ teamId: org.id, userId: user.id, role: MembershipRole.ADMIN });

    const result = await organizationRepository.transitionMemberRole({
      orgId: org.id,
      userId: user.id,
      newRole: MembershipRole.OWNER,
    });

    expect(result.role).toBe(MembershipRole.OWNER);
    expect(result.userId).toBe(user.id);
    expect(result.teamId).toBe(org.id);
  });
});

describe("Organization.findMembersWithRoleAtOrAbove", () => {
  it("should return ADMIN and OWNER when minimumRole is ADMIN", async () => {
    const org = await createReviewedOrganization({
      name: "Hierarchy Org",
      orgAutoAcceptEmail: "hierarchy.com",
    });
    const owner = await createUser({ email: "owner@hierarchy.com", name: "Owner" });
    const admin = await createUser({ email: "admin@hierarchy.com", name: "Admin" });
    const member1 = await createUser({ email: "member1@hierarchy.com", name: "Member 1" });
    const member2 = await createUser({ email: "member2@hierarchy.com", name: "Member 2" });
    await createMembership({ teamId: org.id, userId: owner.id, role: MembershipRole.OWNER });
    await createMembership({ teamId: org.id, userId: admin.id, role: MembershipRole.ADMIN });
    await createMembership({ teamId: org.id, userId: member1.id, role: MembershipRole.MEMBER });
    await createMembership({ teamId: org.id, userId: member2.id, role: MembershipRole.MEMBER });

    const result = await organizationRepository.findMembersWithRoleAtOrAbove({
      orgId: org.id,
      minimumRole: MembershipRole.ADMIN,
    });

    expect(result).toHaveLength(2);
    const roles = result.map((r) => r.role);
    expect(roles).toContain(MembershipRole.OWNER);
    expect(roles).toContain(MembershipRole.ADMIN);
  });

  it("should return only OWNER when minimumRole is OWNER", async () => {
    const org = await createReviewedOrganization({
      name: "Hierarchy Org 2",
      orgAutoAcceptEmail: "hierarchy2.com",
    });
    const owner = await createUser({ email: "owner@hierarchy2.com", name: "Owner" });
    const admin = await createUser({ email: "admin@hierarchy2.com", name: "Admin" });
    const member1 = await createUser({ email: "member1@hierarchy2.com", name: "Member 1" });
    const member2 = await createUser({ email: "member2@hierarchy2.com", name: "Member 2" });
    await createMembership({ teamId: org.id, userId: owner.id, role: MembershipRole.OWNER });
    await createMembership({ teamId: org.id, userId: admin.id, role: MembershipRole.ADMIN });
    await createMembership({ teamId: org.id, userId: member1.id, role: MembershipRole.MEMBER });
    await createMembership({ teamId: org.id, userId: member2.id, role: MembershipRole.MEMBER });

    const result = await organizationRepository.findMembersWithRoleAtOrAbove({
      orgId: org.id,
      minimumRole: MembershipRole.OWNER,
    });

    expect(result).toHaveLength(1);
    expect(result[0].role).toBe(MembershipRole.OWNER);
    expect(result[0].user.id).toBe(owner.id);
  });

  it("should return all members when minimumRole is MEMBER", async () => {
    const org = await createReviewedOrganization({
      name: "Hierarchy Org 3",
      orgAutoAcceptEmail: "hierarchy3.com",
    });
    const owner = await createUser({ email: "owner@hierarchy3.com", name: "Owner" });
    const admin = await createUser({ email: "admin@hierarchy3.com", name: "Admin" });
    const member1 = await createUser({ email: "member1@hierarchy3.com", name: "Member 1" });
    const member2 = await createUser({ email: "member2@hierarchy3.com", name: "Member 2" });
    await createMembership({ teamId: org.id, userId: owner.id, role: MembershipRole.OWNER });
    await createMembership({ teamId: org.id, userId: admin.id, role: MembershipRole.ADMIN });
    await createMembership({ teamId: org.id, userId: member1.id, role: MembershipRole.MEMBER });
    await createMembership({ teamId: org.id, userId: member2.id, role: MembershipRole.MEMBER });

    const result = await organizationRepository.findMembersWithRoleAtOrAbove({
      orgId: org.id,
      minimumRole: MembershipRole.MEMBER,
    });

    expect(result).toHaveLength(4);
    const roles = result.map((r) => r.role);
    expect(roles).toContain(MembershipRole.OWNER);
    expect(roles).toContain(MembershipRole.ADMIN);
    expect(roles).toContain(MembershipRole.MEMBER);
  });
});
