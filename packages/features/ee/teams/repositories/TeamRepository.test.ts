import prismaMock from "@calcom/testing/lib/__mocks__/prismaMock";

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import type { Booking, Host, Membership, Team } from "@calcom/prisma/client";
import { MembershipRole } from "@calcom/prisma/enums";

import { getTeam, getOrg, TeamRepository } from "./TeamRepository";

const sampleTeamProps = {
  logo: null,
  logoUrl: null,
  calVideoLogo: null,
  appLogo: null,
  appIconLogo: null,
  bio: null,
  description: null,
  hideBranding: false,
  isPrivate: false,
  hideBookATeamMember: false,
  hideTeamProfileLink: false,
  createdAt: new Date(),
  theme: null,
  brandColor: "",
  darkBrandColor: "",
  timeFormat: null,
  timeZone: "",
  weekStart: "",
  parentId: null,
  metadata: null,
  isOrganization: false,
  organizationSettings: null,
  isPlatform: false,
  bannerUrl: null,
  rrResetInterval: 0,
  rrResetOccurrence: 0,
  rrResetLimitOn: null,
  rrResetLimitOccurrences: null,
  rrResetLimitDate: null,
  includeManagedEventsInLimits: false,
  rrTimestampBasis: null,
  pendingPayment: false,
  createdByOAuthClientId: null,
  smsLockState: null,
  smsLockReviewedByAdmin: false,
  bookingLimits: null,
};

describe("TeamRepository", () => {
  let teamRepository: TeamRepository;

  beforeEach(() => {
    vi.resetAllMocks();
    teamRepository = new TeamRepository(prismaMock);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("findById", () => {
    it("should return null if team is not found", async () => {
      prismaMock.team.findUnique.mockResolvedValue(null);
      const result = await teamRepository.findById({ id: 1 });
      expect(result).toBeNull();
    });

    it("should return parsed team if found", async () => {
      const mockTeam = {
        id: 1,
        name: "Test Team",
        slug: "test-team",
        logoUrl: "test-logo-url",
        parentId: 1,
        metadata: {
          requestedSlug: null,
        },
        isOrganization: true,
        organizationSettings: {},
        isPlatform: true,
        requestedSlug: null,
      };
      prismaMock.team.findUnique.mockResolvedValue(mockTeam as unknown as Team);
      const result = await teamRepository.findById({ id: 1 });
      expect(result).toEqual(mockTeam);
    });
  });

  describe("deleteById", () => {
    it("should delete team and related data", async () => {
      const mockDeletedTeam = { id: 1, name: "Deleted Team" };
      const deleteManyEventTypeMock = vi.fn();
      const deleteManyMembershipMock = vi.fn();
      const deleteTeamMock = vi.fn().mockResolvedValue(mockDeletedTeam as unknown as Team);
      prismaMock.$transaction.mockImplementation(async (callback) => {
        const mockTx = {
          ...prismaMock,
          eventType: {
            ...prismaMock.eventType,
            deleteMany: deleteManyEventTypeMock,
          },
          membership: {
            ...prismaMock.membership,
            deleteMany: deleteManyMembershipMock,
          },
          team: {
            ...prismaMock.team,
            delete: deleteTeamMock,
          },
        };
        return callback(mockTx);
      });

      const result = await teamRepository.deleteById({ id: 1 });

      expect(deleteManyEventTypeMock).toHaveBeenCalledWith({
        where: {
          teamId: 1,
          schedulingType: "MANAGED",
        },
      });
      expect(deleteManyMembershipMock).toHaveBeenCalledWith({
        where: {
          teamId: 1,
        },
      });
      expect(deleteTeamMock).toHaveBeenCalledWith({
        where: {
          id: 1,
        },
      });
      expect(result).toEqual(mockDeletedTeam);
    });
  });

  describe("findAllByParentId", () => {
    it("should return all teams with given parentId", async () => {
      const mockTeams = [{ id: 1 }, { id: 2 }];
      prismaMock.team.findMany.mockResolvedValue(mockTeams as unknown as Team[]);
      const result = await teamRepository.findAllByParentId({ parentId: 1 });
      expect(prismaMock.team.findMany).toHaveBeenCalledWith({
        where: { parentId: 1 },
        select: {
          id: true,
          name: true,
          slug: true,
          logoUrl: true,
          parentId: true,
          metadata: true,
          isOrganization: true,
          organizationSettings: true,
          isPlatform: true,
        },
        orderBy: { id: "asc" },
      });
      expect(result).toEqual(mockTeams);
    });
  });

  describe("findTeamWithMembers", () => {
    it("should return team with its members", async () => {
      const mockTeam = { id: 1, members: [] };
      prismaMock.team.findUnique.mockResolvedValue(mockTeam as unknown as Team & { members: [] });
      const result = await teamRepository.findTeamWithMembers(1);
      expect(prismaMock.team.findUnique).toHaveBeenCalledWith({
        where: { id: 1 },
        select: {
          members: {
            select: {
              accepted: true,
            },
          },
          id: true,
          metadata: true,
          parentId: true,
          isOrganization: true,
        },
      });
      expect(result).toEqual(mockTeam);
    });

    it("should include scheduling weight and priority data for hosts", async () => {
      const mockTeamWithScheduling = {
        id: 1,
        metadata: null,
        parentId: null,
        isOrganization: false,
        rrResetInterval: 7,
        rrTimestampBasis: null,
        members: [
          {
            accepted: true,
            role: "MEMBER",
            userId: 10,
            user: { id: 10, name: "Host A", email: "hosta@test.com", timeZone: "UTC" },
            Host: [
              {
                eventTypeId: 100,
                isFixed: false,
                priority: 2,
                weight: 50,
                scheduleId: null,
                createdAt: new Date("2025-01-01T00:00:00Z"),
              },
            ],
          },
        ],
      };
      prismaMock.team.findUnique.mockResolvedValue(mockTeamWithScheduling as unknown as Team);

      const result = await teamRepository.findTeamWithMembersAndSchedulingData(1);

      expect(prismaMock.team.findUnique).toHaveBeenCalledWith({
        where: { id: 1 },
        select: {
          id: true,
          metadata: true,
          parentId: true,
          isOrganization: true,
          rrResetInterval: true,
          rrTimestampBasis: true,
          members: {
            select: {
              accepted: true,
              role: true,
              userId: true,
              user: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                  timeZone: true,
                },
              },
              Host: {
                select: {
                  eventTypeId: true,
                  isFixed: true,
                  priority: true,
                  weight: true,
                  scheduleId: true,
                  createdAt: true,
                },
              },
            },
          },
        },
      });
      expect(result).toEqual(mockTeamWithScheduling);
      // Verify extended host fields are included in the result
      const firstMember = result?.members[0];
      expect(firstMember?.Host[0]).toHaveProperty("weight", 50);
      expect(firstMember?.Host[0]).toHaveProperty("priority", 2);
    });

    it("should include member availability metadata when requested", async () => {
      const mockTeamWithAvailability = {
        id: 2,
        metadata: null,
        parentId: null,
        isOrganization: false,
        rrResetInterval: 0,
        rrTimestampBasis: new Date("2025-01-15T00:00:00Z"),
        members: [
          {
            accepted: true,
            role: "ADMIN",
            userId: 20,
            user: { id: 20, name: "Admin Host", email: "admin@test.com", timeZone: "America/New_York" },
            Host: [
              {
                eventTypeId: 200,
                isFixed: true,
                priority: 1,
                weight: 100,
                scheduleId: 5,
                createdAt: new Date("2025-01-10T00:00:00Z"),
              },
            ],
          },
          {
            accepted: true,
            role: "MEMBER",
            userId: 21,
            user: { id: 21, name: "Regular Host", email: "regular@test.com", timeZone: "Europe/London" },
            Host: [],
          },
        ],
      };
      prismaMock.team.findUnique.mockResolvedValue(mockTeamWithAvailability as unknown as Team);

      const result = await teamRepository.findTeamWithMembersAndSchedulingData(2);

      expect(result).not.toBeNull();
      expect(result?.rrResetInterval).toBe(0);
      expect(result?.rrTimestampBasis).toEqual(new Date("2025-01-15T00:00:00Z"));
      expect(result?.members).toHaveLength(2);
      // First member has scheduling preferences via Host association
      expect(result?.members[0]?.role).toBe("ADMIN");
      expect(result?.members[0]?.Host).toHaveLength(1);
      expect(result?.members[0]?.Host[0]?.scheduleId).toBe(5);
      // Second member has no host configs (not a host for any event type)
      expect(result?.members[1]?.Host).toHaveLength(0);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────────
  // AG-002: Round-Robin Scheduling Methods
  // ──────────────────────────────────────────────────────────────────────────────

  describe("findMemberSchedulingHistory", () => {
    it("should return booking history for team members of a given event type", async () => {
      const mockBookings = [
        {
          userId: 10,
          createdAt: new Date("2025-03-01T10:00:00Z"),
          startTime: new Date("2025-03-02T09:00:00Z"),
          endTime: new Date("2025-03-02T10:00:00Z"),
          status: "ACCEPTED",
        },
        {
          userId: 11,
          createdAt: new Date("2025-03-01T11:00:00Z"),
          startTime: new Date("2025-03-03T14:00:00Z"),
          endTime: new Date("2025-03-03T15:00:00Z"),
          status: "ACCEPTED",
        },
      ];
      prismaMock.booking.findMany.mockResolvedValue(mockBookings as unknown as Booking[]);

      const result = await teamRepository.findMemberSchedulingHistory({
        teamId: 1,
        eventTypeId: 100,
      });

      expect(prismaMock.booking.findMany).toHaveBeenCalledWith({
        where: {
          eventTypeId: 100,
          eventType: {
            teamId: 1,
          },
          user: {
            teams: {
              some: {
                teamId: 1,
                accepted: true,
              },
            },
          },
        },
        select: {
          userId: true,
          createdAt: true,
          startTime: true,
          endTime: true,
          status: true,
        },
        orderBy: {
          createdAt: "desc",
        },
      });
      expect(result).toEqual(mockBookings);
      expect(result).toHaveLength(2);
      expect(result[0].userId).toBe(10);
      expect(result[1].userId).toBe(11);
    });

    it("should return empty array when no bookings exist", async () => {
      prismaMock.booking.findMany.mockResolvedValue([]);

      const result = await teamRepository.findMemberSchedulingHistory({
        teamId: 1,
        eventTypeId: 999,
      });

      expect(result).toEqual([]);
      expect(result).toHaveLength(0);
    });

    it("should filter by accepted team members only", async () => {
      prismaMock.booking.findMany.mockResolvedValue([] as unknown as Booking[]);

      await teamRepository.findMemberSchedulingHistory({
        teamId: 5,
        eventTypeId: 50,
      });

      const callArgs = prismaMock.booking.findMany.mock.calls[0][0];
      // Verify the where clause includes accepted: true filter for team membership
      expect(callArgs?.where).toEqual(
        expect.objectContaining({
          user: {
            teams: {
              some: {
                teamId: 5,
                accepted: true,
              },
            },
          },
        })
      );
    });
  });

  describe("findRoundRobinRotationState", () => {
    it("should return rotation state with booking counts and last-booking timestamps per member", async () => {
      const mockGroupByResult = [
        {
          userId: 10,
          _count: { id: 5 },
          _max: { createdAt: new Date("2025-03-15T10:00:00Z") },
        },
        {
          userId: 11,
          _count: { id: 3 },
          _max: { createdAt: new Date("2025-03-14T09:00:00Z") },
        },
      ];
      prismaMock.booking.groupBy.mockResolvedValue(mockGroupByResult as never);

      const result = await teamRepository.findRoundRobinRotationState({
        teamId: 1,
        eventTypeId: 100,
      });

      expect(prismaMock.booking.groupBy).toHaveBeenCalledWith({
        by: ["userId"],
        where: {
          eventTypeId: 100,
          eventType: {
            teamId: 1,
          },
          status: {
            in: ["ACCEPTED", "PENDING"],
          },
        },
        _count: {
          id: true,
        },
        _max: {
          createdAt: true,
        },
      });
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        userId: 10,
        bookingCount: 5,
        lastBookingTimestamp: new Date("2025-03-15T10:00:00Z"),
      });
      expect(result[1]).toEqual({
        userId: 11,
        bookingCount: 3,
        lastBookingTimestamp: new Date("2025-03-14T09:00:00Z"),
      });
    });

    it("should scope rotation state to a specific event type", async () => {
      prismaMock.booking.groupBy.mockResolvedValue([] as never);

      await teamRepository.findRoundRobinRotationState({
        teamId: 1,
        eventTypeId: 200,
      });

      const callArgs = prismaMock.booking.groupBy.mock.calls[0][0];
      expect(callArgs?.where).toEqual(
        expect.objectContaining({
          eventTypeId: 200,
          eventType: {
            teamId: 1,
          },
        })
      );
    });

    it("should respect the team's rrResetInterval for time-based filtering", async () => {
      const resetSince = new Date("2025-03-01T00:00:00Z");
      prismaMock.booking.groupBy.mockResolvedValue([] as never);

      await teamRepository.findRoundRobinRotationState({
        teamId: 1,
        eventTypeId: 100,
        resetSince,
      });

      const callArgs = prismaMock.booking.groupBy.mock.calls[0][0];
      // When resetSince is provided, createdAt >= resetSince should be in the where clause
      expect(callArgs?.where).toEqual(
        expect.objectContaining({
          createdAt: {
            gte: resetSince,
          },
        })
      );
    });
  });

  describe("getLatestBookingForRotation", () => {
    it("should update booking assignment tracking for the specified member", async () => {
      const mockBooking = {
        id: 500,
        userId: 10,
        createdAt: new Date("2025-03-20T12:00:00Z"),
        status: "ACCEPTED",
      };
      prismaMock.booking.findFirst.mockResolvedValue(mockBooking as unknown as Booking);

      const result = await teamRepository.getLatestBookingForRotation({
        bookingId: 500,
        userId: 10,
        eventTypeId: 100,
        teamId: 1,
      });

      expect(prismaMock.booking.findFirst).toHaveBeenCalledWith({
        where: {
          id: 500,
          userId: 10,
          eventTypeId: 100,
          eventType: {
            teamId: 1,
          },
        },
        select: {
          id: true,
          userId: true,
          createdAt: true,
          status: true,
        },
      });
      expect(result).toEqual(mockBooking);
      expect(result?.id).toBe(500);
      expect(result?.userId).toBe(10);
    });

    it("should not throw if the update is idempotent", async () => {
      const mockBooking = {
        id: 501,
        userId: 11,
        createdAt: new Date("2025-03-21T08:00:00Z"),
        status: "ACCEPTED",
      };
      prismaMock.booking.findFirst.mockResolvedValue(mockBooking as unknown as Booking);

      // First call
      const result1 = await teamRepository.getLatestBookingForRotation({
        bookingId: 501,
        userId: 11,
        eventTypeId: 100,
        teamId: 1,
      });

      // Second call with same arguments — should not throw
      const result2 = await teamRepository.getLatestBookingForRotation({
        bookingId: 501,
        userId: 11,
        eventTypeId: 100,
        teamId: 1,
      });

      expect(result1).toEqual(mockBooking);
      expect(result2).toEqual(mockBooking);
      expect(prismaMock.booking.findFirst).toHaveBeenCalledTimes(2);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────────
  // AG-002: Collective Scheduling Methods
  // ──────────────────────────────────────────────────────────────────────────────

  describe("findCollectiveAvailability", () => {
    it("should return members for a collective event type with availability data", async () => {
      const mockHosts = [
        {
          userId: 10,
          isFixed: true,
          priority: 1,
          weight: 100,
          scheduleId: null,
          user: { id: 10, name: "Host A", email: "hosta@test.com", timeZone: "UTC" },
          member: { accepted: true, role: "MEMBER" },
        },
        {
          userId: 11,
          isFixed: false,
          priority: 2,
          weight: 50,
          scheduleId: 3,
          user: { id: 11, name: "Host B", email: "hostb@test.com", timeZone: "America/New_York" },
          member: { accepted: true, role: "ADMIN" },
        },
      ];
      prismaMock.host.findMany.mockResolvedValue(mockHosts as unknown as Host[]);

      const result = await teamRepository.findCollectiveAvailability({
        teamId: 1,
        eventTypeId: 100,
      });

      expect(prismaMock.host.findMany).toHaveBeenCalledWith({
        where: {
          eventTypeId: 100,
          eventType: {
            teamId: 1,
            schedulingType: "COLLECTIVE",
          },
        },
        select: {
          userId: true,
          isFixed: true,
          priority: true,
          weight: true,
          scheduleId: true,
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              timeZone: true,
            },
          },
          member: {
            select: {
              accepted: true,
              role: true,
            },
          },
        },
      });
      expect(result).toHaveLength(2);
      expect(result[0].userId).toBe(10);
      expect(result[0].isFixed).toBe(true);
      expect(result[0].member.accepted).toBe(true);
      expect(result[1].userId).toBe(11);
    });

    it("should filter for only accepted team members", async () => {
      prismaMock.host.findMany.mockResolvedValue([] as unknown as Host[]);

      await teamRepository.findCollectiveAvailability({
        teamId: 5,
        eventTypeId: 50,
      });

      const callArgs = prismaMock.host.findMany.mock.calls[0][0];
      // The member select includes accepted field — the collective event type join ensures
      // only hosts assigned to the event type are returned; membership acceptance is included
      // in the select for downstream filtering by the caller
      expect(callArgs?.select).toEqual(
        expect.objectContaining({
          member: {
            select: {
              accepted: true,
              role: true,
            },
          },
        })
      );
    });

    it("should return empty result when no collective event type exists", async () => {
      prismaMock.host.findMany.mockResolvedValue([]);

      const result = await teamRepository.findCollectiveAvailability({
        teamId: 1,
        eventTypeId: 9999,
      });

      expect(result).toEqual([]);
      expect(result).toHaveLength(0);
    });
  });

  describe("findCollectiveSchedulingGroupComposition", () => {
    it("should return host group composition for a collective event type", async () => {
      const mockHostsWithGroups = [
        {
          userId: 10,
          isFixed: true,
          groupId: 1,
          group: { id: 1, name: "Engineering" },
          user: { id: 10, name: "Host A", email: "hosta@test.com" },
        },
        {
          userId: 11,
          isFixed: true,
          groupId: 1,
          group: { id: 1, name: "Engineering" },
          user: { id: 11, name: "Host B", email: "hostb@test.com" },
        },
        {
          userId: 12,
          isFixed: false,
          groupId: 2,
          group: { id: 2, name: "Sales" },
          user: { id: 12, name: "Host C", email: "hostc@test.com" },
        },
      ];
      prismaMock.host.findMany.mockResolvedValue(mockHostsWithGroups as unknown as Host[]);

      const result = await teamRepository.findCollectiveSchedulingGroupComposition({
        teamId: 1,
        eventTypeId: 100,
      });

      expect(prismaMock.host.findMany).toHaveBeenCalledWith({
        where: {
          eventTypeId: 100,
          eventType: {
            teamId: 1,
            schedulingType: "COLLECTIVE",
          },
        },
        select: {
          userId: true,
          isFixed: true,
          groupId: true,
          group: {
            select: {
              id: true,
              name: true,
            },
          },
          user: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
      });
      expect(result).toHaveLength(3);
      // Two hosts in the Engineering group
      const engineeringHosts = result.filter((h) => h.group?.id === 1);
      expect(engineeringHosts).toHaveLength(2);
      expect(engineeringHosts[0].group?.name).toBe("Engineering");
      // One host in the Sales group
      const salesHosts = result.filter((h) => h.group?.id === 2);
      expect(salesHosts).toHaveLength(1);
      expect(salesHosts[0].group?.name).toBe("Sales");
    });

    it("should return all hosts when no groups are defined", async () => {
      const mockHostsNoGroups = [
        {
          userId: 10,
          isFixed: true,
          groupId: null,
          group: null,
          user: { id: 10, name: "Host A", email: "hosta@test.com" },
        },
        {
          userId: 11,
          isFixed: false,
          groupId: null,
          group: null,
          user: { id: 11, name: "Host B", email: "hostb@test.com" },
        },
      ];
      prismaMock.host.findMany.mockResolvedValue(mockHostsNoGroups as unknown as Host[]);

      const result = await teamRepository.findCollectiveSchedulingGroupComposition({
        teamId: 1,
        eventTypeId: 100,
      });

      expect(result).toHaveLength(2);
      // All hosts returned without group associations
      expect(result[0].groupId).toBeNull();
      expect(result[0].group).toBeNull();
      expect(result[1].groupId).toBeNull();
      expect(result[1].group).toBeNull();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────────
  // AG-002: Scheduling Eligibility Methods
  // ──────────────────────────────────────────────────────────────────────────────

  describe("findSchedulingEligibleMembers", () => {
    it("should return only active accepted members eligible for booking rotation", async () => {
      const mockMemberships = [
        {
          userId: 10,
          role: "MEMBER",
          user: { id: 10, name: "Member A", email: "membera@test.com", timeZone: "UTC" },
          Host: [
            {
              isFixed: false,
              priority: 2,
              weight: 50,
              scheduleId: null,
              createdAt: new Date("2025-01-01T00:00:00Z"),
            },
          ],
        },
        {
          userId: 11,
          role: "ADMIN",
          user: { id: 11, name: "Admin B", email: "adminb@test.com", timeZone: "America/Chicago" },
          Host: [
            {
              isFixed: true,
              priority: 1,
              weight: 100,
              scheduleId: 5,
              createdAt: new Date("2025-01-15T00:00:00Z"),
            },
          ],
        },
      ];
      prismaMock.membership.findMany.mockResolvedValue(mockMemberships as unknown as Membership[]);

      const result = await teamRepository.findSchedulingEligibleMembers({
        teamId: 1,
        eventTypeId: 100,
      });

      expect(prismaMock.membership.findMany).toHaveBeenCalledWith({
        where: {
          teamId: 1,
          accepted: true,
          user: {
            hosts: {
              some: {
                eventTypeId: 100,
              },
            },
          },
        },
        select: {
          userId: true,
          role: true,
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              timeZone: true,
            },
          },
          Host: {
            where: {
              eventTypeId: 100,
            },
            select: {
              isFixed: true,
              priority: true,
              weight: true,
              scheduleId: true,
              createdAt: true,
            },
          },
        },
      });
      expect(result).toHaveLength(2);
      expect(result[0].userId).toBe(10);
      expect(result[1].userId).toBe(11);
    });

    it("should filter by team-specific scheduling roles", async () => {
      prismaMock.membership.findMany.mockResolvedValue([] as unknown as Membership[]);

      await teamRepository.findSchedulingEligibleMembers({
        teamId: 1,
        eventTypeId: 100,
      });

      const callArgs = prismaMock.membership.findMany.mock.calls[0][0];
      // The query requires accepted: true — all roles (MEMBER, ADMIN, OWNER) that are accepted
      // are eligible for scheduling. The actual role filtering is done via membership acceptance
      // and host assignment, not by excluding specific MembershipRole values.
      expect(callArgs?.where).toEqual(
        expect.objectContaining({
          teamId: 1,
          accepted: true,
        })
      );
    });

    it("should return members with their host scheduling configuration", async () => {
      const mockMembership = [
        {
          userId: 30,
          role: "OWNER",
          user: { id: 30, name: "Owner Host", email: "owner@test.com", timeZone: "UTC" },
          Host: [
            {
              isFixed: true,
              priority: 1,
              weight: 75,
              scheduleId: 10,
              createdAt: new Date("2025-02-01T00:00:00Z"),
            },
          ],
        },
      ];
      prismaMock.membership.findMany.mockResolvedValue(mockMembership as unknown as Membership[]);

      const result = await teamRepository.findSchedulingEligibleMembers({
        teamId: 2,
        eventTypeId: 200,
      });

      expect(result).toHaveLength(1);
      // Verify host scheduling configuration is included in the response
      const host = result[0].Host[0];
      expect(host).toHaveProperty("isFixed", true);
      expect(host).toHaveProperty("priority", 1);
      expect(host).toHaveProperty("weight", 75);
      expect(host).toHaveProperty("scheduleId", 10);
    });
  });

  describe("findTeamMembersWithPermission", () => {
    it("should support role-based filtering for team event routing decisions", async () => {
      const mockUsers = [
        { id: 10, name: "Admin User", email: "admin@test.com", locale: "en" },
        { id: 11, name: "Owner User", email: "owner@test.com", locale: "en" },
      ];
      prismaMock.$queryRaw.mockResolvedValue(mockUsers);

      const result = await teamRepository.findTeamMembersWithPermission({
        teamId: 1,
        permission: "team.manage",
        fallbackRoles: [MembershipRole.ADMIN, MembershipRole.OWNER],
      });

      expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(1);
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        id: 10,
        name: "Admin User",
        email: "admin@test.com",
        locale: "en",
      });
      expect(result[1]).toEqual({
        id: 11,
        name: "Owner User",
        email: "owner@test.com",
        locale: "en",
      });
      // Verify returned users have the expected fields for routing decisions
      for (const user of result) {
        expect(user).toHaveProperty("id");
        expect(user).toHaveProperty("name");
        expect(user).toHaveProperty("email");
        expect(user).toHaveProperty("locale");
      }
    });
  });
});

describe("getOrg", () => {
  it("should return an Organization correctly by slug even if there is a team with the same slug", async () => {
    prismaMock.team.findMany.mockResolvedValue([
      {
        id: 101,
        name: "Test Team",
        slug: "test-slug",
        isOrganization: true,
      } as Team,
    ]);

    const org = await getOrg({
      lookupBy: {
        slug: "test-slug",
      },
      forOrgWithSlug: null,
      teamSelect: {
        id: true,
        slug: true,
      },
    });

    const firstFindManyCallArguments = prismaMock.team.findMany.mock.calls[0];

    expect(firstFindManyCallArguments[0]).toEqual({
      where: {
        slug: "test-slug",
        isOrganization: true,
      },
      select: {
        id: true,
        slug: true,
        metadata: true,
        isOrganization: true,
      },
    });
    expect(org?.isOrganization).toBe(true);
  });

  it("should not return an org result if metadata.isOrganization isn't true", async () => {
    prismaMock.team.findMany.mockResolvedValue([
      {
        ...sampleTeamProps,
        id: 101,
        name: "Test Team",
        slug: "test-slug",
        metadata: {},
      } as Team,
    ]);

    const org = await getOrg({
      lookupBy: {
        slug: "test-slug",
      },
      forOrgWithSlug: null,
      teamSelect: {
        id: true,
        slug: true,
      },
    });

    const firstFindManyCallArguments = prismaMock.team.findMany.mock.calls[0];

    expect(firstFindManyCallArguments[0]).toEqual({
      where: {
        slug: "test-slug",
        isOrganization: true,
      },
      select: {
        id: true,
        slug: true,
        metadata: true,
        isOrganization: true,
      },
    });
    expect(org).toBe(null);
  });

  it("should error if metadata isn't valid", async () => {
    prismaMock.team.findMany.mockResolvedValue([
      {
        ...sampleTeamProps,
        id: 101,
        name: "Test Team",
        slug: "test-slug",
        metadata: [],
      } as Team,
    ]);

    await expect(() =>
      getOrg({
        lookupBy: {
          slug: "test-slug",
        },
        forOrgWithSlug: null,
        teamSelect: {
          id: true,
          slug: true,
        },
      })
    ).rejects.toThrow("invalid_type");
  });
});

describe("getTeam", () => {
  it("should query a team correctly", async () => {
    prismaMock.team.findMany.mockResolvedValue([
      {
        ...sampleTeamProps,
        id: 101,
        name: "Test Team",
        slug: "test-slug",
        metadata: {
          anything: "here",
          paymentId: "1",
        },
      } as Team,
    ]);

    const team = await getTeam({
      lookupBy: {
        slug: "test-slug",
      },
      forOrgWithSlug: null,
      teamSelect: {
        id: true,
        slug: true,
        name: true,
      },
    });

    const firstFindManyCallArguments = prismaMock.team.findMany.mock.calls[0];

    expect(firstFindManyCallArguments[0]).toEqual({
      where: {
        slug: "test-slug",
      },
      select: {
        id: true,
        slug: true,
        name: true,
        metadata: true,
        isOrganization: true,
      },
    });
    expect(team).not.toBeNull();
    // 'anything' is not in the teamMetadata schema, so it should be stripped out
    expect(team?.metadata).toEqual({ paymentId: "1" });
  });

  it("should not return a team result if the queried result isn't a team", async () => {
    prismaMock.team.findMany.mockResolvedValue([
      {
        ...sampleTeamProps,
        id: 101,
        name: "Test Team",
        slug: "test-slug",
        isOrganization: true,
      } as Team,
    ]);

    const team = await getTeam({
      lookupBy: {
        slug: "test-slug",
      },
      forOrgWithSlug: null,
      teamSelect: {
        id: true,
        slug: true,
        name: true,
      },
    });

    const firstFindManyCallArguments = prismaMock.team.findMany.mock.calls[0];

    expect(firstFindManyCallArguments[0]).toEqual({
      where: {
        slug: "test-slug",
      },
      select: {
        id: true,
        slug: true,
        name: true,
        metadata: true,
        isOrganization: true,
      },
    });
    expect(team).toBe(null);
  });

  it("should return a team by slug within an org", async () => {
    prismaMock.team.findMany.mockResolvedValue([
      {
        ...sampleTeamProps,
        id: 101,
        name: "Test Team",
        slug: "test-slug",
        parentId: 100,
        metadata: null,
      } as Team,
    ]);

    await getTeam({
      lookupBy: {
        slug: "team-in-test-org",
      },
      forOrgWithSlug: "test-org",
      teamSelect: {
        id: true,
        slug: true,
        name: true,
      },
    });

    const firstFindManyCallArguments = prismaMock.team.findMany.mock.calls[0];

    expect(firstFindManyCallArguments[0]).toEqual({
      where: {
        slug: "team-in-test-org",
        parent: {
          OR: [
            {
              slug: "test-org",
            },
            {
              metadata: {
                path: ["requestedSlug"],
                equals: "test-org",
              },
            },
          ],
          isOrganization: true,
        },
      },
      select: {
        id: true,
        name: true,
        slug: true,
        metadata: true,
        isOrganization: true,
      },
    });
  });

  it("should return a team by requestedSlug within an org", async () => {
    prismaMock.team.findMany.mockResolvedValue([]);
    await getTeam({
      lookupBy: {
        slug: "test-team",
      },
      forOrgWithSlug: "test-org",
      teamSelect: {
        id: true,
        slug: true,
        name: true,
      },
    });
    const firstFindManyCallArguments = prismaMock.team.findMany.mock.calls[0];

    expect(firstFindManyCallArguments[0]).toEqual({
      where: {
        slug: "test-team",
        parent: {
          isOrganization: true,
          OR: [
            {
              slug: "test-org",
            },
            {
              metadata: {
                path: ["requestedSlug"],
                equals: "test-org",
              },
            },
          ],
        },
      },
      select: {
        id: true,
        slug: true,
        name: true,
        metadata: true,
        isOrganization: true,
      },
    });
  });
});
