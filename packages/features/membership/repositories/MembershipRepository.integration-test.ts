import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";

import { prisma } from "@calcom/prisma";
import { MembershipRole } from "@calcom/prisma/enums";

import { MembershipRepository } from "./MembershipRepository";

const createdMembershipIds: number[] = [];
let testTeamId: number;
let createdTeamId: number | null = null;

async function clearTestMemberships() {
  if (createdMembershipIds.length > 0) {
    await prisma.membership.deleteMany({
      where: { id: { in: createdMembershipIds } },
    });
    createdMembershipIds.length = 0;
  }
}

describe("MembershipRepository (Integration Tests)", () => {
  beforeAll(async () => {
    let testTeam = await prisma.team.findFirst({
      where: { slug: { not: null } },
    });

    if (!testTeam) {
      testTeam = await prisma.team.create({
        data: {
          name: "Test Team for MembershipRepository",
          slug: `test-team-membership-repo-${Date.now()}`,
        },
      });
      createdTeamId = testTeam.id;
    }
    testTeamId = testTeam.id;
  });

  afterAll(async () => {
    if (createdTeamId) {
      await prisma.team.delete({ where: { id: createdTeamId } });
    }
  });

  afterEach(async () => {
    await clearTestMemberships();
  });

  describe("hasPendingInviteByUserId", () => {
    it("should return true when user has a pending invite (accepted: false)", async () => {
      const newUser = await prisma.user.create({
        data: {
          email: `test-pending-invite-${Date.now()}@example.com`,
          username: `test-pending-${Date.now()}`,
        },
      });

      const membership = await prisma.membership.create({
        data: {
          userId: newUser.id,
          teamId: testTeamId,
          role: MembershipRole.MEMBER,
          accepted: false,
        },
      });
      createdMembershipIds.push(membership.id);

      const result = await MembershipRepository.hasPendingInviteByUserId({ userId: newUser.id });

      expect(result).toBe(true);

      await prisma.membership.delete({ where: { id: membership.id } });
      createdMembershipIds.length = 0;
      await prisma.user.delete({ where: { id: newUser.id } });
    });

    it("should return false when user has no pending invites (all accepted)", async () => {
      const newUser = await prisma.user.create({
        data: {
          email: `test-accepted-invite-${Date.now()}@example.com`,
          username: `test-accepted-${Date.now()}`,
        },
      });

      const membership = await prisma.membership.create({
        data: {
          userId: newUser.id,
          teamId: testTeamId,
          role: MembershipRole.MEMBER,
          accepted: true,
        },
      });
      createdMembershipIds.push(membership.id);

      const result = await MembershipRepository.hasPendingInviteByUserId({ userId: newUser.id });

      expect(result).toBe(false);

      await prisma.membership.delete({ where: { id: membership.id } });
      createdMembershipIds.length = 0;
      await prisma.user.delete({ where: { id: newUser.id } });
    });

    it("should return false when user has no memberships at all", async () => {
      const newUser = await prisma.user.create({
        data: {
          email: `test-no-membership-${Date.now()}@example.com`,
          username: `test-no-membership-${Date.now()}`,
        },
      });

      const result = await MembershipRepository.hasPendingInviteByUserId({ userId: newUser.id });

      expect(result).toBe(false);

      await prisma.user.delete({ where: { id: newUser.id } });
    });

    it("should return true when user has both accepted and pending invites", async () => {
      const newUser = await prisma.user.create({
        data: {
          email: `test-mixed-invites-${Date.now()}@example.com`,
          username: `test-mixed-${Date.now()}`,
        },
      });

      const team2 = await prisma.team.findFirst({
        where: {
          slug: { not: null },
          id: { not: testTeamId },
        },
      });

      const acceptedMembership = await prisma.membership.create({
        data: {
          userId: newUser.id,
          teamId: testTeamId,
          role: MembershipRole.MEMBER,
          accepted: true,
        },
      });
      createdMembershipIds.push(acceptedMembership.id);

      if (team2) {
        const pendingMembership = await prisma.membership.create({
          data: {
            userId: newUser.id,
            teamId: team2.id,
            role: MembershipRole.MEMBER,
            accepted: false,
          },
        });
        createdMembershipIds.push(pendingMembership.id);
      }

      const result = await MembershipRepository.hasPendingInviteByUserId({ userId: newUser.id });

      expect(result).toBe(team2 ? true : false);

      await clearTestMemberships();
      await prisma.user.delete({ where: { id: newUser.id } });
    });
  });

  // --- AG-004: Invitation Lifecycle Instance Method Tests ---

  describe("findPendingInvitations", () => {
    it("should return pending invitations for a user", async () => {
      const repo = new MembershipRepository();
      const ts = Date.now();
      const user = await prisma.user.create({
        data: {
          email: `test-findpending-${ts}@example.com`,
          username: `test-findpending-${ts}`,
        },
      });

      const extraTeam = await prisma.team.create({
        data: {
          name: `Test Team FindPending ${ts}`,
          slug: `test-findpending-${ts}`,
        },
      });

      const pendingMembership = await prisma.membership.create({
        data: {
          userId: user.id,
          teamId: testTeamId,
          role: MembershipRole.MEMBER,
          accepted: false,
        },
      });
      createdMembershipIds.push(pendingMembership.id);

      const acceptedMembership = await prisma.membership.create({
        data: {
          userId: user.id,
          teamId: extraTeam.id,
          role: MembershipRole.MEMBER,
          accepted: true,
        },
      });
      createdMembershipIds.push(acceptedMembership.id);

      const results = await repo.findPendingInvitations({ userId: user.id });

      expect(results).toHaveLength(1);
      expect(results[0].teamId).toBe(testTeamId);
      expect(results[0].accepted).toBe(false);
      expect(results[0].team).toBeDefined();
      expect(results[0].team.name).toBeDefined();
      expect(results[0].team.slug).toBeDefined();

      await clearTestMemberships();
      await prisma.user.delete({ where: { id: user.id } });
      await prisma.team.delete({ where: { id: extraTeam.id } });
    });

    it("should filter by teamId when provided", async () => {
      const repo = new MembershipRepository();
      const ts = Date.now();
      const user = await prisma.user.create({
        data: {
          email: `test-findpending-filter-${ts}@example.com`,
          username: `test-findpending-filter-${ts}`,
        },
      });

      const extraTeam = await prisma.team.create({
        data: {
          name: `Test Team FindPending Filter ${ts}`,
          slug: `test-findpending-filter-${ts}`,
        },
      });

      const m1 = await prisma.membership.create({
        data: {
          userId: user.id,
          teamId: testTeamId,
          role: MembershipRole.MEMBER,
          accepted: false,
        },
      });
      createdMembershipIds.push(m1.id);

      const m2 = await prisma.membership.create({
        data: {
          userId: user.id,
          teamId: extraTeam.id,
          role: MembershipRole.MEMBER,
          accepted: false,
        },
      });
      createdMembershipIds.push(m2.id);

      const results = await repo.findPendingInvitations({ userId: user.id, teamId: extraTeam.id });

      expect(results).toHaveLength(1);
      expect(results[0].teamId).toBe(extraTeam.id);

      await clearTestMemberships();
      await prisma.user.delete({ where: { id: user.id } });
      await prisma.team.delete({ where: { id: extraTeam.id } });
    });

    it("should return empty array when no pending invitations", async () => {
      const repo = new MembershipRepository();
      const ts = Date.now();
      const user = await prisma.user.create({
        data: {
          email: `test-findpending-empty-${ts}@example.com`,
          username: `test-findpending-empty-${ts}`,
        },
      });

      const membership = await prisma.membership.create({
        data: {
          userId: user.id,
          teamId: testTeamId,
          role: MembershipRole.MEMBER,
          accepted: true,
        },
      });
      createdMembershipIds.push(membership.id);

      const results = await repo.findPendingInvitations({ userId: user.id });

      expect(results).toHaveLength(0);

      await clearTestMemberships();
      await prisma.user.delete({ where: { id: user.id } });
    });
  });

  describe("findPendingInvitationsByTeamId", () => {
    it("should return all pending invitations for a team", async () => {
      const repo = new MembershipRepository();
      const ts = Date.now();

      const dedicatedTeam = await prisma.team.create({
        data: {
          name: `Test Team PendingByTeam ${ts}`,
          slug: `test-pendingbyteam-${ts}`,
        },
      });

      const user1 = await prisma.user.create({
        data: {
          email: `test-pendingbyteam-1-${ts}@example.com`,
          username: `test-pendingbyteam-1-${ts}`,
          name: "Pending User One",
        },
      });

      const user2 = await prisma.user.create({
        data: {
          email: `test-pendingbyteam-2-${ts}@example.com`,
          username: `test-pendingbyteam-2-${ts}`,
          name: "Pending User Two",
        },
      });

      const m1 = await prisma.membership.create({
        data: {
          userId: user1.id,
          teamId: dedicatedTeam.id,
          role: MembershipRole.MEMBER,
          accepted: false,
        },
      });
      createdMembershipIds.push(m1.id);

      const m2 = await prisma.membership.create({
        data: {
          userId: user2.id,
          teamId: dedicatedTeam.id,
          role: MembershipRole.MEMBER,
          accepted: false,
        },
      });
      createdMembershipIds.push(m2.id);

      const results = await repo.findPendingInvitationsByTeamId({ teamId: dedicatedTeam.id });

      expect(results).toHaveLength(2);
      const userIds = results.map((r) => r.userId);
      expect(userIds).toContain(user1.id);
      expect(userIds).toContain(user2.id);

      const resultForUser1 = results.find((r) => r.userId === user1.id);
      expect(resultForUser1?.user).toBeDefined();
      expect(resultForUser1?.user.email).toBeDefined();
      expect(resultForUser1?.user.name).toBeDefined();

      await clearTestMemberships();
      await prisma.user.delete({ where: { id: user1.id } });
      await prisma.user.delete({ where: { id: user2.id } });
      await prisma.team.delete({ where: { id: dedicatedTeam.id } });
    });

    it("should not include accepted memberships", async () => {
      const repo = new MembershipRepository();
      const ts = Date.now();

      const dedicatedTeam = await prisma.team.create({
        data: {
          name: `Test Team PendingByTeam Accept ${ts}`,
          slug: `test-pendingbyteam-accept-${ts}`,
        },
      });

      const pendingUser = await prisma.user.create({
        data: {
          email: `test-pendingbyteam-pending-${ts}@example.com`,
          username: `test-pendingbyteam-pending-${ts}`,
        },
      });

      const acceptedUser = await prisma.user.create({
        data: {
          email: `test-pendingbyteam-accepted-${ts}@example.com`,
          username: `test-pendingbyteam-accepted-${ts}`,
        },
      });

      const pendingMembership = await prisma.membership.create({
        data: {
          userId: pendingUser.id,
          teamId: dedicatedTeam.id,
          role: MembershipRole.MEMBER,
          accepted: false,
        },
      });
      createdMembershipIds.push(pendingMembership.id);

      const acceptedMembership = await prisma.membership.create({
        data: {
          userId: acceptedUser.id,
          teamId: dedicatedTeam.id,
          role: MembershipRole.MEMBER,
          accepted: true,
        },
      });
      createdMembershipIds.push(acceptedMembership.id);

      const results = await repo.findPendingInvitationsByTeamId({ teamId: dedicatedTeam.id });

      expect(results).toHaveLength(1);
      expect(results[0].userId).toBe(pendingUser.id);

      await clearTestMemberships();
      await prisma.user.delete({ where: { id: pendingUser.id } });
      await prisma.user.delete({ where: { id: acceptedUser.id } });
      await prisma.team.delete({ where: { id: dedicatedTeam.id } });
    });

    it("should return empty array for team with no pending invitations", async () => {
      const repo = new MembershipRepository();
      const ts = Date.now();

      const dedicatedTeam = await prisma.team.create({
        data: {
          name: `Test Team PendingByTeam Empty ${ts}`,
          slug: `test-pendingbyteam-empty-${ts}`,
        },
      });

      const user = await prisma.user.create({
        data: {
          email: `test-pendingbyteam-nopending-${ts}@example.com`,
          username: `test-pendingbyteam-nopending-${ts}`,
        },
      });

      const membership = await prisma.membership.create({
        data: {
          userId: user.id,
          teamId: dedicatedTeam.id,
          role: MembershipRole.MEMBER,
          accepted: true,
        },
      });
      createdMembershipIds.push(membership.id);

      const results = await repo.findPendingInvitationsByTeamId({ teamId: dedicatedTeam.id });

      expect(results).toHaveLength(0);

      await clearTestMemberships();
      await prisma.user.delete({ where: { id: user.id } });
      await prisma.team.delete({ where: { id: dedicatedTeam.id } });
    });
  });

  describe("acceptMembership", () => {
    it("should accept a pending membership", async () => {
      const repo = new MembershipRepository();
      const ts = Date.now();
      const user = await prisma.user.create({
        data: {
          email: `test-accept-${ts}@example.com`,
          username: `test-accept-${ts}`,
        },
      });

      const membership = await prisma.membership.create({
        data: {
          userId: user.id,
          teamId: testTeamId,
          role: MembershipRole.MEMBER,
          accepted: false,
        },
      });
      createdMembershipIds.push(membership.id);

      const result = await repo.acceptMembership({ userId: user.id, teamId: testTeamId });

      expect(result).not.toBeNull();
      expect(result?.accepted).toBe(true);

      // Verify in DB that the membership was updated
      const dbRecord = await prisma.membership.findUnique({
        where: { id: membership.id },
      });
      expect(dbRecord?.accepted).toBe(true);

      await clearTestMemberships();
      await prisma.user.delete({ where: { id: user.id } });
    });

    it("should return null for already-accepted membership", async () => {
      const repo = new MembershipRepository();
      const ts = Date.now();
      const user = await prisma.user.create({
        data: {
          email: `test-accept-already-${ts}@example.com`,
          username: `test-accept-already-${ts}`,
        },
      });

      const membership = await prisma.membership.create({
        data: {
          userId: user.id,
          teamId: testTeamId,
          role: MembershipRole.MEMBER,
          accepted: true,
        },
      });
      createdMembershipIds.push(membership.id);

      const result = await repo.acceptMembership({ userId: user.id, teamId: testTeamId });

      // Prisma P2025: record not found when accepted: false guard doesn't match
      expect(result).toBeNull();

      await clearTestMemberships();
      await prisma.user.delete({ where: { id: user.id } });
    });

    it("should return null for non-existent membership", async () => {
      const repo = new MembershipRepository();
      const nonExistentUserId = 999999999;

      const result = await repo.acceptMembership({ userId: nonExistentUserId, teamId: testTeamId });

      expect(result).toBeNull();
    });
  });

  describe("rejectMembership", () => {
    it("should delete a pending membership", async () => {
      const repo = new MembershipRepository();
      const ts = Date.now();
      const user = await prisma.user.create({
        data: {
          email: `test-reject-${ts}@example.com`,
          username: `test-reject-${ts}`,
        },
      });

      const membership = await prisma.membership.create({
        data: {
          userId: user.id,
          teamId: testTeamId,
          role: MembershipRole.MEMBER,
          accepted: false,
        },
      });
      // Not tracked in createdMembershipIds — rejectMembership deletes it

      const result = await repo.rejectMembership({ userId: user.id, teamId: testTeamId });

      expect(result).not.toBeNull();
      expect(result?.userId).toBe(user.id);
      expect(result?.teamId).toBe(testTeamId);

      // Verify membership no longer exists in DB
      const dbRecord = await prisma.membership.findUnique({
        where: { id: membership.id },
      });
      expect(dbRecord).toBeNull();

      await prisma.user.delete({ where: { id: user.id } });
    });

    it("should return null for non-existent membership", async () => {
      const repo = new MembershipRepository();
      const nonExistentUserId = 999999999;

      const result = await repo.rejectMembership({ userId: nonExistentUserId, teamId: testTeamId });

      expect(result).toBeNull();
    });

    it("should not delete accepted memberships", async () => {
      const repo = new MembershipRepository();
      const ts = Date.now();
      const user = await prisma.user.create({
        data: {
          email: `test-reject-accepted-${ts}@example.com`,
          username: `test-reject-accepted-${ts}`,
        },
      });

      const membership = await prisma.membership.create({
        data: {
          userId: user.id,
          teamId: testTeamId,
          role: MembershipRole.MEMBER,
          accepted: true,
        },
      });
      createdMembershipIds.push(membership.id);

      const result = await repo.rejectMembership({ userId: user.id, teamId: testTeamId });

      // Prisma P2025: accepted: false guard prevents deletion of accepted memberships
      expect(result).toBeNull();

      // Verify the accepted membership still exists in DB
      const dbRecord = await prisma.membership.findUnique({
        where: { id: membership.id },
      });
      expect(dbRecord).not.toBeNull();
      expect(dbRecord?.accepted).toBe(true);

      await clearTestMemberships();
      await prisma.user.delete({ where: { id: user.id } });
    });
  });

  describe("updateMembershipRole", () => {
    it("should update MEMBER to ADMIN", async () => {
      const repo = new MembershipRepository();
      const ts = Date.now();
      const user = await prisma.user.create({
        data: {
          email: `test-updaterole-member-${ts}@example.com`,
          username: `test-updaterole-member-${ts}`,
        },
      });

      const membership = await prisma.membership.create({
        data: {
          userId: user.id,
          teamId: testTeamId,
          role: MembershipRole.MEMBER,
          accepted: true,
        },
      });
      createdMembershipIds.push(membership.id);

      const result = await repo.updateMembershipRole({
        userId: user.id,
        teamId: testTeamId,
        newRole: MembershipRole.ADMIN,
      });

      expect(result.role).toBe(MembershipRole.ADMIN);

      await clearTestMemberships();
      await prisma.user.delete({ where: { id: user.id } });
    });

    it("should update ADMIN to OWNER", async () => {
      const repo = new MembershipRepository();
      const ts = Date.now();
      const user = await prisma.user.create({
        data: {
          email: `test-updaterole-admin-${ts}@example.com`,
          username: `test-updaterole-admin-${ts}`,
        },
      });

      const membership = await prisma.membership.create({
        data: {
          userId: user.id,
          teamId: testTeamId,
          role: MembershipRole.ADMIN,
          accepted: true,
        },
      });
      createdMembershipIds.push(membership.id);

      const result = await repo.updateMembershipRole({
        userId: user.id,
        teamId: testTeamId,
        newRole: MembershipRole.OWNER,
      });

      expect(result.role).toBe(MembershipRole.OWNER);

      await clearTestMemberships();
      await prisma.user.delete({ where: { id: user.id } });
    });

    it("should update OWNER to MEMBER", async () => {
      const repo = new MembershipRepository();
      const ts = Date.now();
      const user = await prisma.user.create({
        data: {
          email: `test-updaterole-owner-${ts}@example.com`,
          username: `test-updaterole-owner-${ts}`,
        },
      });

      const membership = await prisma.membership.create({
        data: {
          userId: user.id,
          teamId: testTeamId,
          role: MembershipRole.OWNER,
          accepted: true,
        },
      });
      createdMembershipIds.push(membership.id);

      const result = await repo.updateMembershipRole({
        userId: user.id,
        teamId: testTeamId,
        newRole: MembershipRole.MEMBER,
      });

      expect(result.role).toBe(MembershipRole.MEMBER);

      await clearTestMemberships();
      await prisma.user.delete({ where: { id: user.id } });
    });
  });

  describe("findMembersByRole", () => {
    it("should return members with specified role", async () => {
      const repo = new MembershipRepository();
      const ts = Date.now();

      const dedicatedTeam = await prisma.team.create({
        data: {
          name: `Test Team FindByRole ${ts}`,
          slug: `test-findbyrole-${ts}`,
        },
      });

      const ownerUser = await prisma.user.create({
        data: {
          email: `test-findbyrole-owner-${ts}@example.com`,
          username: `test-findbyrole-owner-${ts}`,
        },
      });

      const adminUser = await prisma.user.create({
        data: {
          email: `test-findbyrole-admin-${ts}@example.com`,
          username: `test-findbyrole-admin-${ts}`,
        },
      });

      const memberUser = await prisma.user.create({
        data: {
          email: `test-findbyrole-member-${ts}@example.com`,
          username: `test-findbyrole-member-${ts}`,
        },
      });

      const m1 = await prisma.membership.create({
        data: {
          userId: ownerUser.id,
          teamId: dedicatedTeam.id,
          role: MembershipRole.OWNER,
          accepted: true,
        },
      });
      createdMembershipIds.push(m1.id);

      const m2 = await prisma.membership.create({
        data: {
          userId: adminUser.id,
          teamId: dedicatedTeam.id,
          role: MembershipRole.ADMIN,
          accepted: true,
        },
      });
      createdMembershipIds.push(m2.id);

      const m3 = await prisma.membership.create({
        data: {
          userId: memberUser.id,
          teamId: dedicatedTeam.id,
          role: MembershipRole.MEMBER,
          accepted: true,
        },
      });
      createdMembershipIds.push(m3.id);

      const results = await repo.findMembersByRole({
        teamId: dedicatedTeam.id,
        role: MembershipRole.ADMIN,
      });

      expect(results).toHaveLength(1);
      expect(results[0].userId).toBe(adminUser.id);
      expect(results[0].role).toBe(MembershipRole.ADMIN);

      await clearTestMemberships();
      await prisma.user.delete({ where: { id: ownerUser.id } });
      await prisma.user.delete({ where: { id: adminUser.id } });
      await prisma.user.delete({ where: { id: memberUser.id } });
      await prisma.team.delete({ where: { id: dedicatedTeam.id } });
    });

    it("should filter by acceptance status when provided", async () => {
      const repo = new MembershipRepository();
      const ts = Date.now();

      const dedicatedTeam = await prisma.team.create({
        data: {
          name: `Test Team FindByRole Accept ${ts}`,
          slug: `test-findbyrole-accept-${ts}`,
        },
      });

      const acceptedAdmin = await prisma.user.create({
        data: {
          email: `test-findbyrole-admin-accepted-${ts}@example.com`,
          username: `test-findbyrole-admin-accepted-${ts}`,
        },
      });

      const pendingAdmin = await prisma.user.create({
        data: {
          email: `test-findbyrole-admin-pending-${ts}@example.com`,
          username: `test-findbyrole-admin-pending-${ts}`,
        },
      });

      const m1 = await prisma.membership.create({
        data: {
          userId: acceptedAdmin.id,
          teamId: dedicatedTeam.id,
          role: MembershipRole.ADMIN,
          accepted: true,
        },
      });
      createdMembershipIds.push(m1.id);

      const m2 = await prisma.membership.create({
        data: {
          userId: pendingAdmin.id,
          teamId: dedicatedTeam.id,
          role: MembershipRole.ADMIN,
          accepted: false,
        },
      });
      createdMembershipIds.push(m2.id);

      const results = await repo.findMembersByRole({
        teamId: dedicatedTeam.id,
        role: MembershipRole.ADMIN,
        accepted: true,
      });

      expect(results).toHaveLength(1);
      expect(results[0].userId).toBe(acceptedAdmin.id);
      expect(results[0].accepted).toBe(true);

      await clearTestMemberships();
      await prisma.user.delete({ where: { id: acceptedAdmin.id } });
      await prisma.user.delete({ where: { id: pendingAdmin.id } });
      await prisma.team.delete({ where: { id: dedicatedTeam.id } });
    });

    it("should return empty array when no members match role", async () => {
      const repo = new MembershipRepository();
      const ts = Date.now();

      const dedicatedTeam = await prisma.team.create({
        data: {
          name: `Test Team FindByRole Empty ${ts}`,
          slug: `test-findbyrole-empty-${ts}`,
        },
      });

      const user = await prisma.user.create({
        data: {
          email: `test-findbyrole-nomatch-${ts}@example.com`,
          username: `test-findbyrole-nomatch-${ts}`,
        },
      });

      const membership = await prisma.membership.create({
        data: {
          userId: user.id,
          teamId: dedicatedTeam.id,
          role: MembershipRole.MEMBER,
          accepted: true,
        },
      });
      createdMembershipIds.push(membership.id);

      const results = await repo.findMembersByRole({
        teamId: dedicatedTeam.id,
        role: MembershipRole.OWNER,
      });

      expect(results).toHaveLength(0);

      await clearTestMemberships();
      await prisma.user.delete({ where: { id: user.id } });
      await prisma.team.delete({ where: { id: dedicatedTeam.id } });
    });
  });

  describe("countMembersByTeamId", () => {
    it("should count all members in a team", async () => {
      const repo = new MembershipRepository();
      const ts = Date.now();

      const dedicatedTeam = await prisma.team.create({
        data: {
          name: `Test Team Count ${ts}`,
          slug: `test-count-${ts}`,
        },
      });

      const users = await Promise.all(
        [1, 2, 3].map((i) =>
          prisma.user.create({
            data: {
              email: `test-count-${i}-${ts}@example.com`,
              username: `test-count-${i}-${ts}`,
            },
          })
        )
      );

      for (const user of users) {
        const membership = await prisma.membership.create({
          data: {
            userId: user.id,
            teamId: dedicatedTeam.id,
            role: MembershipRole.MEMBER,
            accepted: true,
          },
        });
        createdMembershipIds.push(membership.id);
      }

      const count = await repo.countMembersByTeamId({ teamId: dedicatedTeam.id });

      expect(count).toBe(3);

      await clearTestMemberships();
      for (const user of users) {
        await prisma.user.delete({ where: { id: user.id } });
      }
      await prisma.team.delete({ where: { id: dedicatedTeam.id } });
    });

    it("should count only accepted members when filtered", async () => {
      const repo = new MembershipRepository();
      const ts = Date.now();

      const dedicatedTeam = await prisma.team.create({
        data: {
          name: `Test Team Count Accepted ${ts}`,
          slug: `test-count-accepted-${ts}`,
        },
      });

      const acceptedUsers = await Promise.all(
        [1, 2].map((i) =>
          prisma.user.create({
            data: {
              email: `test-count-accepted-${i}-${ts}@example.com`,
              username: `test-count-accepted-${i}-${ts}`,
            },
          })
        )
      );

      const pendingUser = await prisma.user.create({
        data: {
          email: `test-count-pending-${ts}@example.com`,
          username: `test-count-pending-${ts}`,
        },
      });

      for (const user of acceptedUsers) {
        const membership = await prisma.membership.create({
          data: {
            userId: user.id,
            teamId: dedicatedTeam.id,
            role: MembershipRole.MEMBER,
            accepted: true,
          },
        });
        createdMembershipIds.push(membership.id);
      }

      const pendingMembership = await prisma.membership.create({
        data: {
          userId: pendingUser.id,
          teamId: dedicatedTeam.id,
          role: MembershipRole.MEMBER,
          accepted: false,
        },
      });
      createdMembershipIds.push(pendingMembership.id);

      const count = await repo.countMembersByTeamId({ teamId: dedicatedTeam.id, accepted: true });

      expect(count).toBe(2);

      await clearTestMemberships();
      for (const user of acceptedUsers) {
        await prisma.user.delete({ where: { id: user.id } });
      }
      await prisma.user.delete({ where: { id: pendingUser.id } });
      await prisma.team.delete({ where: { id: dedicatedTeam.id } });
    });

    it("should return 0 for team with no members", async () => {
      const repo = new MembershipRepository();
      const ts = Date.now();

      const emptyTeam = await prisma.team.create({
        data: {
          name: `Test Team Count Empty ${ts}`,
          slug: `test-count-empty-${ts}`,
        },
      });

      const count = await repo.countMembersByTeamId({ teamId: emptyTeam.id });

      expect(count).toBe(0);

      await prisma.team.delete({ where: { id: emptyTeam.id } });
    });
  });
});
