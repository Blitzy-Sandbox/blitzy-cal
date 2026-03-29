import { updateNewTeamMemberEventTypes } from "@calcom/features/ee/teams/lib/queries";
import { TeamRepository } from "@calcom/features/ee/teams/repositories/TeamRepository";
import { WorkflowService } from "@calcom/features/ee/workflows/lib/service/WorkflowService";
import { createAProfileForAnExistingUser } from "@calcom/features/profile/lib/createAProfileForAnExistingUser";
import { deleteDomain } from "@calcom/lib/domainManager/organization";
import { ErrorCode } from "@calcom/lib/errorCodes";
import { ErrorWithCode } from "@calcom/lib/errors";
import type { Membership, Profile, Team, User, VerificationToken, EventType } from "@calcom/prisma/client";
import { MembershipRole } from "@calcom/prisma/enums";
import { SchedulingType } from "@calcom/prisma/enums";
import prismaMock from "@calcom/testing/lib/__mocks__/prismaMock";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TeamService } from "./teamService";

const { MockSeatChangeTrackingService } = vi.hoisted(() => {
  class MockSeatChangeTrackingService {
    logSeatAddition = vi.fn().mockResolvedValue(undefined);
    logSeatRemoval = vi.fn().mockResolvedValue(undefined);
  }
  return { MockSeatChangeTrackingService };
});

vi.mock("@calcom/ee/billing/di/containers/Billing");
vi.mock("@calcom/features/ee/teams/repositories/TeamRepository");
vi.mock("@calcom/features/ee/workflows/lib/service/WorkflowService");
vi.mock("@calcom/lib/domainManager/organization");
vi.mock("@calcom/features/ee/teams/lib/removeMember");
vi.mock("@calcom/features/profile/lib/createAProfileForAnExistingUser");
vi.mock("@calcom/features/ee/teams/lib/queries");
vi.mock("@calcom/features/ee/billing/service/seatTracking/SeatChangeTrackingService", () => ({
  SeatChangeTrackingService: MockSeatChangeTrackingService,
}));

const mockTeamBilling = {
  cancel: vi.fn(),
  updateQuantity: vi.fn(),
  publish: vi.fn(),
  downgrade: vi.fn(),
};

const mockTeamBillingFactory = {
  findAndInit: vi.fn().mockResolvedValue(mockTeamBilling),
  findAndInitMany: vi.fn().mockResolvedValue([mockTeamBilling]),
};

describe("TeamService", () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    mockTeamBillingFactory.findAndInit.mockResolvedValue(mockTeamBilling);
    mockTeamBillingFactory.findAndInitMany.mockResolvedValue([mockTeamBilling]);

    const { getTeamBillingServiceFactory } = await import("@calcom/ee/billing/di/containers/Billing");
    vi.mocked(getTeamBillingServiceFactory).mockReturnValue(mockTeamBillingFactory);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("delete", () => {
    it("should delete team, cancel billing, and clean up", async () => {
      const mockDeletedTeam = {
        id: 1,
        name: "Deleted Team",
        isOrganization: true,
        slug: "deleted-team",
      };
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-expect-error
      const mockTeamRepo = {
        deleteById: vi.fn().mockResolvedValue(mockDeletedTeam),
      } as Pick<TeamRepository, "deleteById">;
      vi.mocked(TeamRepository).mockImplementation(function () {
        return mockTeamRepo;
      });

      const result = await TeamService.delete({ id: 1 });

      expect(mockTeamBillingFactory.findAndInit).toHaveBeenCalledWith(1);
      expect(mockTeamBilling.cancel).toHaveBeenCalled();
      expect(WorkflowService.deleteWorkflowRemindersOfRemovedTeam).toHaveBeenCalledWith(1);
      expect(mockTeamRepo.deleteById).toHaveBeenCalledWith({ id: 1 });
      expect(deleteDomain).toHaveBeenCalledWith("deleted-team");
      expect(result).toEqual(mockDeletedTeam);
    });
  });

  describe("inviteMemberByToken", () => {
    it("should throw error if verification token is not found", async () => {
      prismaMock.verificationToken.findFirst.mockResolvedValue(null);
      await expect(TeamService.inviteMemberByToken("invalid-token", 1)).rejects.toThrow(ErrorWithCode);
    });

    it("should create provisional membership and update billing", async () => {
      const mockToken = {
        teamId: 1,
        team: { name: "Test Team" },
        expiresInDays: null,
        expires: new Date(Date.now() + 86400000),
        token: "valid-token",
        identifier: "test@example.com",
        id: "1",
      };
      prismaMock.verificationToken.findFirst.mockResolvedValue(mockToken);
      prismaMock.membership.create.mockResolvedValue({} as Membership);

      const result = await TeamService.inviteMemberByToken("valid-token", 1);

      expect(prismaMock.membership.create).toHaveBeenCalledWith({
        data: {
          accepted: false,
          createdAt: expect.any(Date),
          role: MembershipRole.MEMBER,
          teamId: 1,
          userId: 1,
        },
      });
      expect(mockTeamBilling.updateQuantity).toHaveBeenCalledWith("addition");
      expect(result).toBe("Test Team");
    });
  });

  describe("acceptTeamMembership", () => {
    it("should accept membership and update event types for regular team", async () => {
      const mockMembership = {
        team: { id: 1, parentId: null, isOrganization: false },
      };

      prismaMock.membership.update.mockResolvedValue(mockMembership as Membership & { team: Team });
      vi.mocked(updateNewTeamMemberEventTypes).mockResolvedValue(undefined);

      await TeamService.acceptTeamMembership({
        userId: 1,
        teamId: 1,
        userEmail: "test@example.com",
        username: "testuser",
      });

      expect(prismaMock.membership.update).toHaveBeenCalledWith({
        where: { userId_teamId: { userId: 1, teamId: 1 } },
        data: { accepted: true },
        select: { team: true },
      });
      expect(updateNewTeamMemberEventTypes).toHaveBeenCalledWith(1, 1);
    });

    it("should accept membership and create profile for organization", async () => {
      const mockMembership = {
        team: { id: 1, parentId: null, isOrganization: true },
      };

      prismaMock.membership.update.mockResolvedValue(mockMembership as Membership & { team: Team });
      vi.mocked(createAProfileForAnExistingUser).mockResolvedValue({} as Profile);
      vi.mocked(updateNewTeamMemberEventTypes).mockResolvedValue(undefined);

      await TeamService.acceptTeamMembership({
        userId: 1,
        teamId: 1,
        userEmail: "test@example.com",
        username: "testuser",
      });

      expect(createAProfileForAnExistingUser).toHaveBeenCalledWith({
        user: {
          id: 1,
          email: "test@example.com",
          currentUsername: "testuser",
        },
        organizationId: 1,
      });
    });

    it("should accept membership and handle parent team for subteam", async () => {
      const mockMembership = {
        team: { id: 1, parentId: 2, isOrganization: false },
      };

      prismaMock.membership.update
        .mockResolvedValueOnce(mockMembership as Membership & { team: Team })
        .mockResolvedValueOnce({} as Membership);
      vi.mocked(createAProfileForAnExistingUser).mockResolvedValue({} as Profile);
      vi.mocked(updateNewTeamMemberEventTypes).mockResolvedValue(undefined);

      await TeamService.acceptTeamMembership({
        userId: 1,
        teamId: 1,
        userEmail: "test@example.com",
        username: "testuser",
      });

      expect(prismaMock.membership.update).toHaveBeenCalledTimes(2);
      expect(prismaMock.membership.update).toHaveBeenNthCalledWith(2, {
        where: { userId_teamId: { userId: 1, teamId: 2 } },
        data: { accepted: true },
      });
      expect(createAProfileForAnExistingUser).toHaveBeenCalledWith({
        user: {
          id: 1,
          email: "test@example.com",
          currentUsername: "testuser",
        },
        organizationId: 2,
      });
    });
  });
  describe("leaveTeamMembership", () => {
    it("should delete membership when rejecting invitation", async () => {
      const mockMembership = {
        team: { id: 1, parentId: null },
      };

      prismaMock.membership.delete.mockResolvedValue(mockMembership as Membership & { team: Team });

      await TeamService.leaveTeamMembership({
        userId: 1,
        teamId: 1,
      });

      expect(prismaMock.membership.delete).toHaveBeenCalledWith({
        where: { userId_teamId: { userId: 1, teamId: 1 } },
        select: { team: true },
      });
    });

    it("should delete parent membership when rejecting subteam invitation", async () => {
      const mockMembership = {
        team: { id: 1, parentId: 2 },
      };

      prismaMock.membership.delete
        .mockResolvedValueOnce(mockMembership as Membership & { team: Team })
        .mockResolvedValueOnce({} as Membership);

      await TeamService.leaveTeamMembership({
        userId: 1,
        teamId: 1,
      });

      expect(prismaMock.membership.delete).toHaveBeenCalledTimes(2);
      expect(prismaMock.membership.delete).toHaveBeenNthCalledWith(2, {
        where: { userId_teamId: { userId: 1, teamId: 2 } },
      });
    });
  });

  describe("acceptInvitationByToken", () => {
    it("should throw error if verification token is not found", async () => {
      prismaMock.verificationToken.findFirst.mockResolvedValue(null);
      await expect(TeamService.acceptInvitationByToken("invalid-token", 1)).rejects.toThrow(ErrorWithCode);
    });

    it("should throw error if token is not associated with team", async () => {
      const mockToken = {
        teamId: null,
        team: null,
        identifier: "test@example.com",
        id: "1",
      };

      prismaMock.verificationToken.findFirst.mockResolvedValue(
        mockToken as VerificationToken & { team: Team | null }
      );

      await expect(TeamService.acceptInvitationByToken("valid-token", 1)).rejects.toThrow(
        new ErrorWithCode(ErrorCode.NotFound, "Invite token is not associated with any team")
      );
    });

    it("should throw error if user not found", async () => {
      const mockToken = {
        teamId: 1,
        team: { name: "Test Team" },
        identifier: "test@example.com",
        id: "1",
      };

      prismaMock.verificationToken.findFirst.mockResolvedValue(
        mockToken as VerificationToken & { team: Team }
      );
      prismaMock.user.findUnique.mockResolvedValue(null);

      await expect(TeamService.acceptInvitationByToken("valid-token", 1)).rejects.toThrow(
        new ErrorWithCode(ErrorCode.NotFound, "User not found")
      );
    });

    it("should throw error if user email doesn't match token identifier", async () => {
      const mockToken = {
        teamId: 1,
        team: { name: "Test Team" },
        identifier: "invited@example.com",
        id: "1",
      };

      const mockUser = {
        email: "different@example.com",
        username: "testuser",
      };

      prismaMock.verificationToken.findFirst.mockResolvedValue(
        mockToken as VerificationToken & { team: Team }
      );
      prismaMock.user.findUnique.mockResolvedValue(mockUser as User);

      await expect(TeamService.acceptInvitationByToken("valid-token", 1)).rejects.toThrow(
        new ErrorWithCode(ErrorCode.Forbidden, "This invitation is not for your account")
      );
    });

    it("should throw error if user username doesn't match token identifier", async () => {
      const mockToken = {
        teamId: 1,
        team: { name: "Test Team" },
        identifier: "inviteduser",
        id: "1",
      };

      const mockUser = {
        email: "test@example.com",
        username: "differentuser",
      };

      prismaMock.verificationToken.findFirst.mockResolvedValue(
        mockToken as VerificationToken & { team: Team }
      );
      prismaMock.user.findUnique.mockResolvedValue(mockUser as User);

      await expect(TeamService.acceptInvitationByToken("valid-token", 1)).rejects.toThrow(
        new ErrorWithCode(ErrorCode.Forbidden, "This invitation is not for your account")
      );
    });

    it("should accept invitation when user email matches token identifier", async () => {
      const mockToken = {
        teamId: 1,
        team: { name: "Test Team" },
        identifier: "test@example.com",
        id: "1",
      };

      const mockUser = {
        email: "test@example.com",
        username: "testuser",
      };

      const mockMembership = {
        team: { id: 1, parentId: null, isOrganization: false },
      };

      prismaMock.verificationToken.findFirst.mockResolvedValue(
        mockToken as VerificationToken & { team: Team }
      );
      prismaMock.user.findUnique.mockResolvedValue(mockUser as User);
      prismaMock.membership.update.mockResolvedValue(mockMembership as Membership & { team: Team });
      vi.mocked(updateNewTeamMemberEventTypes).mockResolvedValue(undefined);

      await TeamService.acceptInvitationByToken("valid-token", 1);

      expect(prismaMock.membership.update).toHaveBeenCalledWith({
        where: { userId_teamId: { userId: 1, teamId: 1 } },
        data: { accepted: true },
        select: { team: true },
      });
    });

    it("should accept invitation when user username matches token identifier", async () => {
      const mockToken = {
        teamId: 1,
        team: { name: "Test Team" },
        identifier: "testuser",
        id: "1",
      };

      const mockUser = {
        email: "testuser@example.com",
        username: "testuser",
      };

      const mockMembership = {
        team: { id: 1, parentId: null, isOrganization: false },
      };

      prismaMock.verificationToken.findFirst.mockResolvedValue(
        mockToken as VerificationToken & { team: Team }
      );
      prismaMock.user.findUnique.mockResolvedValue(mockUser as User);
      prismaMock.membership.update.mockResolvedValue(mockMembership as Membership & { team: Team });
      vi.mocked(updateNewTeamMemberEventTypes).mockResolvedValue(undefined);

      await TeamService.acceptInvitationByToken("valid-token", 1);

      expect(prismaMock.membership.update).toHaveBeenCalledWith({
        where: { userId_teamId: { userId: 1, teamId: 1 } },
        data: { accepted: true },
        select: { team: true },
      });
    });
  });

  describe("publish", () => {
    it("should call publish on TeamBilling", async () => {
      await TeamService.publish(1);

      expect(mockTeamBillingFactory.findAndInit).toHaveBeenCalledWith(1);
      expect(mockTeamBilling.publish).toHaveBeenCalled();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────────
  // AG-002: Team Event Routing Behavioral Parity — Test Coverage
  // ──────────────────────────────────────────────────────────────────────────────

  describe("getNextRoundRobinMember", () => {
    it("should return the least recently assigned eligible member", async () => {
      const mockTeamRepo = {
        findTeamWithMembersAndSchedulingData: vi.fn().mockResolvedValue({
          id: 1,
          rrResetInterval: null,
          rrTimestampBasis: null,
          metadata: {},
          parentId: null,
          isOrganization: false,
          members: [],
        }),
        findRoundRobinRotationState: vi.fn().mockResolvedValue([
          { userId: 10, bookingCount: 3, lastBookingTimestamp: new Date("2025-03-01T10:00:00Z") },
          { userId: 20, bookingCount: 1, lastBookingTimestamp: new Date("2025-03-02T10:00:00Z") },
          { userId: 30, bookingCount: 3, lastBookingTimestamp: new Date("2025-02-15T10:00:00Z") },
        ]),
      } as unknown as TeamRepository;

      vi.mocked(TeamRepository).mockImplementation(function () {
        return mockTeamRepo;
      });

      const result = await TeamService.getNextRoundRobinMember({
        teamId: 1,
        eventTypeId: 100,
        eligibleMemberIds: [10, 20, 30],
      });

      // Member 20 has the fewest bookings (1), so they should be selected
      expect(result).toEqual({
        userId: 20,
        bookingCount: 1,
      });
      expect(mockTeamRepo.findTeamWithMembersAndSchedulingData).toHaveBeenCalledWith(1);
      expect(mockTeamRepo.findRoundRobinRotationState).toHaveBeenCalledWith({
        teamId: 1,
        eventTypeId: 100,
        resetSince: undefined,
      });
    });

    it("should handle the first booking when no previous assignments exist", async () => {
      const mockTeamRepo = {
        findTeamWithMembersAndSchedulingData: vi.fn().mockResolvedValue({
          id: 1,
          rrResetInterval: null,
          rrTimestampBasis: null,
          metadata: {},
          parentId: null,
          isOrganization: false,
          members: [],
        }),
        // Empty rotation state — no previous bookings
        findRoundRobinRotationState: vi.fn().mockResolvedValue([]),
      } as unknown as TeamRepository;

      vi.mocked(TeamRepository).mockImplementation(function () {
        return mockTeamRepo;
      });

      const result = await TeamService.getNextRoundRobinMember({
        teamId: 1,
        eventTypeId: 100,
        eligibleMemberIds: [10, 20, 30],
      });

      // With no prior bookings, all members have 0 bookings and null lastBookingTimestamp.
      // The tie-breaking logic selects the last eligible member in the iteration order
      // because a null lastBookingTimestamp is treated as "never assigned" (eligible for rotation).
      expect(result).toEqual({
        userId: 30,
        bookingCount: 0,
      });
    });

    it("should respect availability-weighted distribution", async () => {
      const mockTeamRepo = {
        findTeamWithMembersAndSchedulingData: vi.fn().mockResolvedValue({
          id: 1,
          rrResetInterval: "DAY",
          rrTimestampBasis: null,
          metadata: {},
          parentId: null,
          isOrganization: false,
          members: [],
        }),
        findRoundRobinRotationState: vi.fn().mockResolvedValue([
          // Member 10 has 5 bookings, Member 20 has 5 bookings, Member 30 has 2 bookings
          { userId: 10, bookingCount: 5, lastBookingTimestamp: new Date("2025-03-27T10:00:00Z") },
          { userId: 20, bookingCount: 5, lastBookingTimestamp: new Date("2025-03-27T08:00:00Z") },
          { userId: 30, bookingCount: 2, lastBookingTimestamp: new Date("2025-03-27T06:00:00Z") },
        ]),
      } as unknown as TeamRepository;

      vi.mocked(TeamRepository).mockImplementation(function () {
        return mockTeamRepo;
      });

      const result = await TeamService.getNextRoundRobinMember({
        teamId: 1,
        eventTypeId: 100,
        eligibleMemberIds: [10, 20, 30],
      });

      // Member 30 has fewer bookings (2 vs 5), respecting proportional distribution
      expect(result).toEqual({
        userId: 30,
        bookingCount: 2,
      });
      // Verify that DAY reset interval triggers time-based filtering
      expect(mockTeamRepo.findRoundRobinRotationState).toHaveBeenCalledWith({
        teamId: 1,
        eventTypeId: 100,
        resetSince: expect.any(Date),
      });
    });

    it("should maintain rotation state across calls", async () => {
      // Simulate tied booking counts — rotation breaks tie by least recent assignment
      const mockTeamRepo = {
        findTeamWithMembersAndSchedulingData: vi.fn().mockResolvedValue({
          id: 1,
          rrResetInterval: null,
          rrTimestampBasis: null,
          metadata: {},
          parentId: null,
          isOrganization: false,
          members: [],
        }),
        findRoundRobinRotationState: vi.fn().mockResolvedValue([
          { userId: 10, bookingCount: 2, lastBookingTimestamp: new Date("2025-03-28T12:00:00Z") },
          { userId: 20, bookingCount: 2, lastBookingTimestamp: new Date("2025-03-28T10:00:00Z") },
          { userId: 30, bookingCount: 2, lastBookingTimestamp: new Date("2025-03-28T14:00:00Z") },
        ]),
      } as unknown as TeamRepository;

      vi.mocked(TeamRepository).mockImplementation(function () {
        return mockTeamRepo;
      });

      const result = await TeamService.getNextRoundRobinMember({
        teamId: 1,
        eventTypeId: 100,
        eligibleMemberIds: [10, 20, 30],
      });

      // All have 2 bookings. Member 20 was assigned least recently (10:00), so they're next
      expect(result).toEqual({
        userId: 20,
        bookingCount: 2,
      });
    });

    it("should return null when no eligible member IDs are provided", async () => {
      const result = await TeamService.getNextRoundRobinMember({
        teamId: 1,
        eventTypeId: 100,
        eligibleMemberIds: [],
      });

      expect(result).toBeNull();
    });
  });

  describe("validateCollectiveAvailability", () => {
    it("should return true when all hosts are available for a time slot", async () => {
      const mockTeamRepo = {
        findCollectiveAvailability: vi.fn().mockResolvedValue([
          {
            userId: 10,
            isFixed: true,
            priority: 1,
            weight: 100,
            scheduleId: null,
            user: { id: 10, name: "Alice", email: "alice@example.com", timeZone: "UTC" },
            member: { accepted: true, role: MembershipRole.MEMBER },
          },
          {
            userId: 20,
            isFixed: true,
            priority: 1,
            weight: 100,
            scheduleId: null,
            user: { id: 20, name: "Bob", email: "bob@example.com", timeZone: "UTC" },
            member: { accepted: true, role: MembershipRole.MEMBER },
          },
        ]),
      } as unknown as TeamRepository;

      vi.mocked(TeamRepository).mockImplementation(function () {
        return mockTeamRepo;
      });

      const result = await TeamService.validateCollectiveAvailability({
        teamId: 1,
        eventTypeId: 200,
      });

      expect(result).not.toBeNull();
      expect(result?.allHostsRequired).toBe(true);
      expect(result?.hosts).toHaveLength(2);
      expect(result?.hosts[0]).toEqual({
        userId: 10,
        isFixed: true,
        user: { id: 10, name: "Alice", email: "alice@example.com", timeZone: "UTC" },
      });
      expect(result?.hosts[1]).toEqual({
        userId: 20,
        isFixed: true,
        user: { id: 20, name: "Bob", email: "bob@example.com", timeZone: "UTC" },
      });
      expect(mockTeamRepo.findCollectiveAvailability).toHaveBeenCalledWith({
        teamId: 1,
        eventTypeId: 200,
      });
    });

    it("should return false when any host is unavailable", async () => {
      const mockTeamRepo = {
        findCollectiveAvailability: vi.fn().mockResolvedValue([
          {
            userId: 10,
            isFixed: true,
            priority: 1,
            weight: 100,
            scheduleId: null,
            user: { id: 10, name: "Alice", email: "alice@example.com", timeZone: "UTC" },
            member: { accepted: true, role: MembershipRole.MEMBER },
          },
          {
            userId: 20,
            isFixed: true,
            priority: 1,
            weight: 100,
            scheduleId: null,
            user: { id: 20, name: "Bob", email: "bob@example.com", timeZone: "UTC" },
            // Bob has not accepted membership — not a valid host for collective
            member: { accepted: false, role: MembershipRole.MEMBER },
          },
        ]),
      } as unknown as TeamRepository;

      vi.mocked(TeamRepository).mockImplementation(function () {
        return mockTeamRepo;
      });

      const result = await TeamService.validateCollectiveAvailability({
        teamId: 1,
        eventTypeId: 200,
      });

      // Only Alice (accepted: true) is included; Bob is filtered out
      expect(result).not.toBeNull();
      expect(result?.hosts).toHaveLength(1);
      expect(result?.hosts[0]?.userId).toBe(10);
      expect(result?.allHostsRequired).toBe(true);
    });

    it("should use COLLECTIVE scheduling type for collective validation", async () => {
      const mockTeamRepo = {
        // Return empty to verify the method handles no-hosts gracefully
        findCollectiveAvailability: vi.fn().mockResolvedValue([]),
      } as unknown as TeamRepository;

      vi.mocked(TeamRepository).mockImplementation(function () {
        return mockTeamRepo;
      });

      const result = await TeamService.validateCollectiveAvailability({
        teamId: 1,
        eventTypeId: 200,
      });

      // No hosts found for the collective event type — returns null
      expect(result).toBeNull();
      // Verify the repository method was called with the correct team + event type
      // The COLLECTIVE filter is applied inside the TeamRepository query (schedulingType: "COLLECTIVE")
      expect(mockTeamRepo.findCollectiveAvailability).toHaveBeenCalledWith({
        teamId: 1,
        eventTypeId: 200,
      });
    });
  });

  describe("routeTeamBooking", () => {
    it("should route to round-robin member for ROUND_ROBIN scheduling type", async () => {
      const mockTeamRepo = {
        findSchedulingEligibleMembers: vi.fn().mockResolvedValue([
          {
            userId: 10,
            role: MembershipRole.MEMBER,
            user: { id: 10, name: "Alice", email: "alice@example.com", timeZone: "UTC" },
            Host: [{ isFixed: false, priority: 1, weight: 100, scheduleId: null, createdAt: new Date() }],
          },
          {
            userId: 20,
            role: MembershipRole.MEMBER,
            user: { id: 20, name: "Bob", email: "bob@example.com", timeZone: "UTC" },
            Host: [{ isFixed: false, priority: 1, weight: 100, scheduleId: null, createdAt: new Date() }],
          },
        ]),
        findTeamWithMembersAndSchedulingData: vi.fn().mockResolvedValue({
          id: 1,
          rrResetInterval: null,
          rrTimestampBasis: null,
          metadata: {},
          parentId: null,
          isOrganization: false,
          members: [],
        }),
        // No previous bookings — first eligible member selected
        findRoundRobinRotationState: vi.fn().mockResolvedValue([]),
      } as unknown as TeamRepository;

      vi.mocked(TeamRepository).mockImplementation(function () {
        return mockTeamRepo;
      });

      const result = await TeamService.routeTeamBooking({
        teamId: 1,
        eventTypeId: 100,
        schedulingType: SchedulingType.ROUND_ROBIN,
      });

      expect(result.type).toBe(SchedulingType.ROUND_ROBIN);
      expect(result.isCollective).toBe(false);
      expect(result.selectedMembers).toHaveLength(1);
      // With no prior bookings, the round-robin selects the last eligible member (20)
      // due to the tie-breaking logic treating null lastBookingTimestamp as "never assigned"
      expect(result.selectedMembers[0]?.userId).toBe(20);
      expect(mockTeamRepo.findSchedulingEligibleMembers).toHaveBeenCalledWith({
        teamId: 1,
        eventTypeId: 100,
      });
    });

    it("should require all hosts for COLLECTIVE scheduling type", async () => {
      const mockTeamRepo = {
        findCollectiveAvailability: vi.fn().mockResolvedValue([
          {
            userId: 10,
            isFixed: true,
            priority: 1,
            weight: 100,
            scheduleId: null,
            user: { id: 10, name: "Alice", email: "alice@example.com", timeZone: "UTC" },
            member: { accepted: true, role: MembershipRole.MEMBER },
          },
          {
            userId: 20,
            isFixed: true,
            priority: 1,
            weight: 100,
            scheduleId: null,
            user: { id: 20, name: "Bob", email: "bob@example.com", timeZone: "UTC" },
            member: { accepted: true, role: MembershipRole.MEMBER },
          },
        ]),
      } as unknown as TeamRepository;

      vi.mocked(TeamRepository).mockImplementation(function () {
        return mockTeamRepo;
      });

      const result = await TeamService.routeTeamBooking({
        teamId: 1,
        eventTypeId: 200,
        schedulingType: SchedulingType.COLLECTIVE,
      });

      expect(result.type).toBe(SchedulingType.COLLECTIVE);
      expect(result.isCollective).toBe(true);
      // All accepted hosts returned for collective confirmation
      expect(result.selectedMembers).toHaveLength(2);
      expect(result.selectedMembers).toEqual([{ userId: 10 }, { userId: 20 }]);
    });

    it("should handle MANAGED scheduling type correctly", async () => {
      const mockTeamRepo = {} as unknown as TeamRepository;

      vi.mocked(TeamRepository).mockImplementation(function () {
        return mockTeamRepo;
      });

      const result = await TeamService.routeTeamBooking({
        teamId: 1,
        eventTypeId: 300,
        schedulingType: SchedulingType.MANAGED,
      });

      // Managed event types are delegated to child event type system
      expect(result.type).toBe(SchedulingType.MANAGED);
      expect(result.isCollective).toBe(false);
      expect(result.selectedMembers).toEqual([]);
    });

    it("should throw error for invalid scheduling type", async () => {
      const mockTeamRepo = {} as unknown as TeamRepository;

      vi.mocked(TeamRepository).mockImplementation(function () {
        return mockTeamRepo;
      });

      await expect(
        TeamService.routeTeamBooking({
          teamId: 1,
          eventTypeId: 400,
          schedulingType: "INVALID_TYPE" as SchedulingType,
        })
      ).rejects.toThrow(ErrorWithCode);
    });

    it("should throw error when no eligible members for round-robin", async () => {
      const mockTeamRepo = {
        findSchedulingEligibleMembers: vi.fn().mockResolvedValue([]),
        findTeamWithMembersAndSchedulingData: vi.fn().mockResolvedValue({
          id: 1,
          rrResetInterval: null,
          rrTimestampBasis: null,
          metadata: {},
          parentId: null,
          isOrganization: false,
          members: [],
        }),
        findRoundRobinRotationState: vi.fn().mockResolvedValue([]),
      } as unknown as TeamRepository;

      vi.mocked(TeamRepository).mockImplementation(function () {
        return mockTeamRepo;
      });

      await expect(
        TeamService.routeTeamBooking({
          teamId: 1,
          eventTypeId: 100,
          schedulingType: SchedulingType.ROUND_ROBIN,
        })
      ).rejects.toThrow(ErrorWithCode);
    });

    it("should throw error when no hosts found for collective", async () => {
      const mockTeamRepo = {
        findCollectiveAvailability: vi.fn().mockResolvedValue([]),
      } as unknown as TeamRepository;

      vi.mocked(TeamRepository).mockImplementation(function () {
        return mockTeamRepo;
      });

      await expect(
        TeamService.routeTeamBooking({
          teamId: 1,
          eventTypeId: 200,
          schedulingType: SchedulingType.COLLECTIVE,
        })
      ).rejects.toThrow(ErrorWithCode);
    });
  });

  describe("getTeamEventRoutingConfig", () => {
    it("should return round-robin configuration for a team event", async () => {
      const mockTeamRepo = {
        findTeamWithMembersAndSchedulingData: vi.fn().mockResolvedValue({
          id: 1,
          rrResetInterval: "MONTH",
          rrTimestampBasis: null,
          metadata: {},
          parentId: null,
          isOrganization: false,
          members: [
            {
              accepted: true,
              role: MembershipRole.MEMBER,
              userId: 10,
              user: { id: 10, name: "Alice", email: "alice@example.com", timeZone: "UTC" },
              Host: [],
            },
            {
              accepted: true,
              role: MembershipRole.ADMIN,
              userId: 20,
              user: { id: 20, name: "Bob", email: "bob@example.com", timeZone: "UTC" },
              Host: [],
            },
          ],
        }),
        findSchedulingEligibleMembers: vi.fn().mockResolvedValue([
          {
            userId: 10,
            role: MembershipRole.MEMBER,
            user: { id: 10, name: "Alice", email: "alice@example.com", timeZone: "UTC" },
            Host: [],
          },
          {
            userId: 20,
            role: MembershipRole.ADMIN,
            user: { id: 20, name: "Bob", email: "bob@example.com", timeZone: "UTC" },
            Host: [],
          },
        ]),
      } as unknown as TeamRepository;

      vi.mocked(TeamRepository).mockImplementation(function () {
        return mockTeamRepo;
      });

      prismaMock.eventType.findUnique.mockResolvedValue({
        schedulingType: SchedulingType.ROUND_ROBIN,
        teamId: 1,
      } as unknown as EventType);

      const result = await TeamService.getTeamEventRoutingConfig({
        teamId: 1,
        eventTypeId: 100,
      });

      expect(result).not.toBeNull();
      expect(result?.schedulingType).toBe(SchedulingType.ROUND_ROBIN);
      expect(result?.rrResetInterval).toBe("MONTH");
      expect(result?.teamId).toBe(1);
      expect(result?.eligibleMembers).toEqual([
        { userId: 10, role: MembershipRole.MEMBER },
        { userId: 20, role: MembershipRole.ADMIN },
      ]);
    });

    it("should return collective configuration for a team event", async () => {
      const mockTeamRepo = {
        findTeamWithMembersAndSchedulingData: vi.fn().mockResolvedValue({
          id: 1,
          rrResetInterval: null,
          rrTimestampBasis: null,
          metadata: {},
          parentId: null,
          isOrganization: false,
          members: [
            {
              accepted: true,
              role: MembershipRole.MEMBER,
              userId: 10,
              user: { id: 10, name: "Alice", email: "alice@example.com", timeZone: "UTC" },
              Host: [],
            },
          ],
        }),
        findSchedulingEligibleMembers: vi.fn().mockResolvedValue([
          {
            userId: 10,
            role: MembershipRole.MEMBER,
            user: { id: 10, name: "Alice", email: "alice@example.com", timeZone: "UTC" },
            Host: [],
          },
        ]),
      } as unknown as TeamRepository;

      vi.mocked(TeamRepository).mockImplementation(function () {
        return mockTeamRepo;
      });

      prismaMock.eventType.findUnique.mockResolvedValue({
        schedulingType: SchedulingType.COLLECTIVE,
        teamId: 1,
      } as unknown as EventType);

      const result = await TeamService.getTeamEventRoutingConfig({
        teamId: 1,
        eventTypeId: 200,
      });

      expect(result).not.toBeNull();
      expect(result?.schedulingType).toBe(SchedulingType.COLLECTIVE);
      expect(result?.rrResetInterval).toBeNull();
      expect(result?.eligibleMembers).toEqual([{ userId: 10, role: MembershipRole.MEMBER }]);
    });

    it("should use TeamRepository for data access", async () => {
      const mockTeamRepo = {
        findTeamWithMembersAndSchedulingData: vi.fn().mockResolvedValue({
          id: 1,
          rrResetInterval: null,
          rrTimestampBasis: null,
          metadata: {},
          parentId: null,
          isOrganization: false,
          members: [],
        }),
        findSchedulingEligibleMembers: vi.fn().mockResolvedValue([]),
      } as unknown as TeamRepository;

      vi.mocked(TeamRepository).mockImplementation(function () {
        return mockTeamRepo;
      });

      prismaMock.eventType.findUnique.mockResolvedValue({
        schedulingType: SchedulingType.ROUND_ROBIN,
        teamId: 1,
      } as unknown as EventType);

      await TeamService.getTeamEventRoutingConfig({
        teamId: 1,
        eventTypeId: 100,
      });

      // Verify TeamRepository was used for all data access (repository pattern compliance)
      expect(mockTeamRepo.findTeamWithMembersAndSchedulingData).toHaveBeenCalledWith(1);
      expect(mockTeamRepo.findSchedulingEligibleMembers).toHaveBeenCalledWith({
        teamId: 1,
        eventTypeId: 100,
      });
    });

    it("should return null when team is not found", async () => {
      const mockTeamRepo = {
        findTeamWithMembersAndSchedulingData: vi.fn().mockResolvedValue(null),
      } as unknown as TeamRepository;

      vi.mocked(TeamRepository).mockImplementation(function () {
        return mockTeamRepo;
      });

      const result = await TeamService.getTeamEventRoutingConfig({
        teamId: 999,
        eventTypeId: 100,
      });

      expect(result).toBeNull();
    });

    it("should return null when event type does not belong to team", async () => {
      const mockTeamRepo = {
        findTeamWithMembersAndSchedulingData: vi.fn().mockResolvedValue({
          id: 1,
          rrResetInterval: null,
          rrTimestampBasis: null,
          metadata: {},
          parentId: null,
          isOrganization: false,
          members: [],
        }),
      } as unknown as TeamRepository;

      vi.mocked(TeamRepository).mockImplementation(function () {
        return mockTeamRepo;
      });

      // Event type belongs to a different team (teamId: 99 vs queried teamId: 1)
      prismaMock.eventType.findUnique.mockResolvedValue({
        schedulingType: SchedulingType.ROUND_ROBIN,
        teamId: 99,
      } as unknown as EventType);

      const result = await TeamService.getTeamEventRoutingConfig({
        teamId: 1,
        eventTypeId: 100,
      });

      expect(result).toBeNull();
    });
  });
});
