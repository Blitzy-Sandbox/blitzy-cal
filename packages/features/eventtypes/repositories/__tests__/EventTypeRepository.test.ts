import { describe, expect, it, vi, beforeEach } from "vitest";

import { EventTypeRepository } from "@calcom/features/eventtypes/repositories/eventTypeRepository";
import { readonlyPrisma } from "@calcom/prisma";

vi.mock("@calcom/prisma", () => ({
  readonlyPrisma: {
    eventType: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
    team: {
      findMany: vi.fn(),
    },
    membership: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

describe("EventTypeRepository", () => {
  let eventTypeRepository: EventTypeRepository;

  beforeEach(() => {
    vi.resetAllMocks();
    eventTypeRepository = new EventTypeRepository(readonlyPrisma);
  });

  const mockUser = {
    id: 1,
    organizationId: 10,
    isOwnerAdminOfParentTeam: false,
  };

  const mockEventTypes = [
    {
      id: 1,
      slug: "personal-event",
      title: "Personal Event",
      teamId: null,
      userId: 1,
      team: null,
    },
    {
      id: 2,
      slug: "team-event",
      title: "Team Event",
      teamId: 5,
      userId: null,
      team: { name: "Team A" },
    },
  ];

  describe("getEventTypeList", () => {
    describe("Early return scenarios", () => {
      it("should return empty array when no teamId, userId, or isAll provided", async () => {
        const result = await eventTypeRepository.getEventTypeList({
          teamId: null,
          userId: null,
          isAll: false,
          user: mockUser,
        });

        expect(result).toEqual([]);
        expect(readonlyPrisma.eventType.findMany).not.toHaveBeenCalled();
      });
    });

    describe("Personal events filtering", () => {
      it("should return only user's personal events when userId provided", async () => {
        const personalEvents = [mockEventTypes[0]];
        vi.mocked(readonlyPrisma.eventType.findMany).mockResolvedValue(personalEvents);

        const result = await eventTypeRepository.getEventTypeList({
          teamId: null,
          userId: 1,
          isAll: false,
          user: mockUser,
        });

        expect(readonlyPrisma.eventType.findMany).toHaveBeenCalledWith({
          select: {
            id: true,
            slug: true,
            title: true,
            teamId: true,
            userId: true,
            team: {
              select: {
                name: true,
              },
            },
          },
          where: {
            userId: mockUser.id,
            teamId: null,
          },
        });
        expect(result).toEqual(personalEvents);
      });
    });

    describe("Organization-wide view (isAll = true)", () => {
      it("should return team events and user's personal events for owner/admin", async () => {
        const childTeams = [{ id: 11 }, { id: 12 }];
        const allEvents = [...mockEventTypes];

        vi.mocked(readonlyPrisma.team.findMany).mockResolvedValue(childTeams);
        vi.mocked(readonlyPrisma.eventType.findMany).mockResolvedValue(allEvents);

        const ownerUser = { ...mockUser, isOwnerAdminOfParentTeam: true };

        const result = await eventTypeRepository.getEventTypeList({
          teamId: null,
          userId: null,
          isAll: true,
          user: ownerUser,
        });

        expect(readonlyPrisma.eventType.findMany).toHaveBeenCalledWith({
          select: {
            id: true,
            slug: true,
            title: true,
            teamId: true,
            userId: true,
            team: {
              select: {
                name: true,
              },
            },
          },
          where: {
            OR: [
              {
                teamId: {
                  in: [10, 11, 12],
                },
              },
              {
                userId: ownerUser.id,
                teamId: null,
              },
            ],
          },
        });
        expect(result).toEqual(allEvents);
      });
    });

    describe("Team-specific view", () => {
      it("should return team events for team members", async () => {
        const membership = { teamId: 5, userId: 1, role: "MEMBER" };
        vi.mocked(readonlyPrisma.membership.findFirst).mockResolvedValue(membership);
        vi.mocked(readonlyPrisma.eventType.findMany).mockResolvedValue([mockEventTypes[1]]);

        const result = await eventTypeRepository.getEventTypeList({
          teamId: 5,
          userId: null,
          isAll: false,
          user: mockUser,
        });

        expect(readonlyPrisma.eventType.findMany).toHaveBeenCalledWith({
          select: {
            id: true,
            slug: true,
            title: true,
            teamId: true,
            userId: true,
            team: {
              select: {
                name: true,
              },
            },
          },
          where: {
            teamId: 5,
            OR: [{ userId: mockUser.id }, { users: { some: { id: mockUser.id } } }],
          },
        });
        expect(result).toEqual([mockEventTypes[1]]);
      });

      it("should throw error when user is not part of team and not owner/admin", async () => {
        vi.mocked(readonlyPrisma.membership.findFirst).mockResolvedValue(null);

        await expect(
          eventTypeRepository.getEventTypeList({
            teamId: 5,
            userId: null,
            isAll: false,
            user: mockUser,
          })
        ).rejects.toThrow("User is not part of a team/org");
      });
    });
  });

  // TODO: Add tests for other EventTypeRepository methods as they are added
  // Examples:
  // - describe("findById", () => { ... })
  // - describe("create", () => { ... })
  // - describe("findAllByUpId", () => { ... })
  // etc.

  describe("findManagedEventTypeTemplate", () => {
    it("should return a managed event type template when found", async () => {
      const mockTemplate = {
        id: 100,
        title: "Managed Meeting",
        slug: "managed-meeting",
        schedulingType: "MANAGED" as const,
        teamId: 5,
        assignAllTeamMembers: true,
        metadata: { someKey: "someValue" },
      };
      vi.mocked(readonlyPrisma.eventType.findFirst).mockResolvedValue(mockTemplate);

      const result = await eventTypeRepository.findManagedEventTypeTemplate(5, 100);

      expect(result).toEqual(mockTemplate);
    });

    it("should return null when event type is not MANAGED", async () => {
      vi.mocked(readonlyPrisma.eventType.findFirst).mockResolvedValue(null);

      const result = await eventTypeRepository.findManagedEventTypeTemplate(5, 100);

      expect(result).toBeNull();
    });

    it("should return null when event type belongs to a different team", async () => {
      vi.mocked(readonlyPrisma.eventType.findFirst).mockResolvedValue(null);

      const result = await eventTypeRepository.findManagedEventTypeTemplate(999, 100);

      expect(result).toBeNull();
      expect(readonlyPrisma.eventType.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ teamId: 999 }),
        })
      );
    });

    it("should pass correct Prisma query parameters", async () => {
      vi.mocked(readonlyPrisma.eventType.findFirst).mockResolvedValue(null);

      await eventTypeRepository.findManagedEventTypeTemplate(5, 100);

      expect(readonlyPrisma.eventType.findFirst).toHaveBeenCalledWith({
        where: {
          id: 100,
          teamId: 5,
          schedulingType: "MANAGED",
        },
        select: {
          id: true,
          title: true,
          slug: true,
          schedulingType: true,
          teamId: true,
          assignAllTeamMembers: true,
          metadata: true,
        },
      });
    });
  });

  describe("findChildEventTypesByParentId", () => {
    it("should return child event types for a parent", async () => {
      const mockChildren = [
        { id: 201, userId: 1, slug: "child-1", hidden: false },
        { id: 202, userId: 2, slug: "child-2", hidden: true },
      ];
      vi.mocked(readonlyPrisma.eventType.findMany).mockResolvedValue(mockChildren);

      const result = await eventTypeRepository.findChildEventTypesByParentId(100);

      expect(result).toEqual(mockChildren);
    });

    it("should return empty array when no children exist", async () => {
      vi.mocked(readonlyPrisma.eventType.findMany).mockResolvedValue([]);

      const result = await eventTypeRepository.findChildEventTypesByParentId(100);

      expect(result).toEqual([]);
    });

    it("should pass correct Prisma query parameters", async () => {
      vi.mocked(readonlyPrisma.eventType.findMany).mockResolvedValue([]);

      await eventTypeRepository.findChildEventTypesByParentId(100);

      expect(readonlyPrisma.eventType.findMany).toHaveBeenCalledWith({
        where: {
          parentId: 100,
        },
        select: {
          id: true,
          userId: true,
          slug: true,
          hidden: true,
        },
      });
    });
  });

  describe("findManagedEventTypesForTeam", () => {
    it("should return managed templates with child counts", async () => {
      const mockTemplates = [
        {
          id: 100,
          title: "Managed 1",
          slug: "managed-1",
          assignAllTeamMembers: true,
          _count: { children: 3 },
        },
        {
          id: 101,
          title: "Managed 2",
          slug: "managed-2",
          assignAllTeamMembers: false,
          _count: { children: 0 },
        },
      ];
      vi.mocked(readonlyPrisma.eventType.findMany).mockResolvedValue(mockTemplates);

      const result = await eventTypeRepository.findManagedEventTypesForTeam(5);

      expect(result).toEqual([
        { id: 100, title: "Managed 1", slug: "managed-1", assignAllTeamMembers: true, childCount: 3 },
        { id: 101, title: "Managed 2", slug: "managed-2", assignAllTeamMembers: false, childCount: 0 },
      ]);
    });

    it("should return empty array when team has no managed templates", async () => {
      vi.mocked(readonlyPrisma.eventType.findMany).mockResolvedValue([]);

      const result = await eventTypeRepository.findManagedEventTypesForTeam(5);

      expect(result).toEqual([]);
    });

    it("should filter for parent templates only (parentId: null)", async () => {
      vi.mocked(readonlyPrisma.eventType.findMany).mockResolvedValue([]);

      await eventTypeRepository.findManagedEventTypesForTeam(5);

      expect(readonlyPrisma.eventType.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            parentId: null,
            schedulingType: "MANAGED",
            teamId: 5,
          }),
        })
      );
    });
  });

  describe("findTeamMembersWithoutManagedEventType", () => {
    it("should return members without the managed event type", async () => {
      const existingChildren = [{ userId: 1 }, { userId: 2 }];
      const membersWithout = [{ userId: 3 }, { userId: 4 }];

      vi.mocked(readonlyPrisma.eventType.findMany).mockResolvedValue(existingChildren);
      vi.mocked(readonlyPrisma.membership.findMany).mockResolvedValue(membersWithout);

      const result = await eventTypeRepository.findTeamMembersWithoutManagedEventType(100, 5);

      expect(result).toEqual([{ userId: 3 }, { userId: 4 }]);
    });

    it("should return empty array when all members have the event type", async () => {
      const existingChildren = [{ userId: 1 }, { userId: 2 }];
      vi.mocked(readonlyPrisma.eventType.findMany).mockResolvedValue(existingChildren);
      vi.mocked(readonlyPrisma.membership.findMany).mockResolvedValue([]);

      const result = await eventTypeRepository.findTeamMembersWithoutManagedEventType(100, 5);

      expect(result).toEqual([]);
    });

    it("should filter out null userId values from children", async () => {
      const existingChildren = [{ userId: 1 }, { userId: null }, { userId: 2 }];
      vi.mocked(readonlyPrisma.eventType.findMany).mockResolvedValue(existingChildren);
      vi.mocked(readonlyPrisma.membership.findMany).mockResolvedValue([]);

      await eventTypeRepository.findTeamMembersWithoutManagedEventType(100, 5);

      expect(readonlyPrisma.membership.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            userId: {
              notIn: [1, 2],
            },
          }),
        })
      );
    });

    it("should only include accepted team members", async () => {
      vi.mocked(readonlyPrisma.eventType.findMany).mockResolvedValue([]);
      vi.mocked(readonlyPrisma.membership.findMany).mockResolvedValue([]);

      await eventTypeRepository.findTeamMembersWithoutManagedEventType(100, 5);

      expect(readonlyPrisma.membership.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            accepted: true,
            teamId: 5,
          }),
        })
      );
    });
  });
});
