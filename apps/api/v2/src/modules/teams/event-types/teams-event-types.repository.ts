import { PrismaReadService } from "@/modules/prisma/prisma-read.service";
import { PrismaWriteService } from "@/modules/prisma/prisma-write.service";
import { Injectable } from "@nestjs/common";

import type { SortOrderType } from "@calcom/platform-types";

/**
 * Prisma-backed persistence layer for team-scoped event type queries.
 *
 * Paradigm scalar field coverage (ET-002 through ET-006):
 * Queries that use Prisma `include` (not `select`) on the EventType model automatically
 * return ALL scalar fields, including paradigm-specific fields such as:
 *   - schedulingType, seatsPerTimeSlot, seatsShowAttendees, seatsShowAvailabilityCount (ET-002 Group)
 *   - isRRWeightsEnabled, rrSegmentQueryValue, assignRRMembersUsingSegment (ET-003 Round-Robin)
 *   - assignAllTeamMembers (ET-004 Collective)
 *   - periodType, periodDays, periodStartDate, periodEndDate, minimumBookingNotice,
 *     beforeEventBuffer, afterEventBuffer, bookingLimits, durationLimits (ET-005 Booking Windows)
 *   - bookingFields, customInputs (ET-006 Custom Fields)
 *
 * Host scalar field coverage (ET-003):
 * Queries that use `include: { hosts: true }` return ALL Host model scalar fields,
 * including id, userId, eventTypeId, isFixed, priority, weight, weightAdjustment,
 * scheduleId, and createdAt — sufficient for round-robin weight/priority support.
 */
@Injectable()
export class TeamsEventTypesRepository {
  constructor(private readonly dbRead: PrismaReadService, private readonly dbWrite: PrismaWriteService) {}

  async getTeamEventType(teamId: number, eventTypeId: number) {
    return this.dbRead.prisma.eventType.findUnique({
      where: {
        id: eventTypeId,
        teamId,
      },
      include: {
        users: true,
        schedule: true,
        // hosts: true returns all Host scalar fields including weight, priority,
        // weightAdjustment, isFixed, userId, scheduleId — sufficient for ET-003 round-robin parity.
        hosts: true,
        destinationCalendar: true,
        calVideoSettings: true,
        team: {
          select: {
            bannerUrl: true,
            name: true,
            logoUrl: true,
            slug: true,
            weekStart: true,
            brandColor: true,
            darkBrandColor: true,
            theme: true,
          },
        },
      },
    });
  }

  async getTeamEventTypeBySlug(teamId: number, eventTypeSlug: string, hostsLimit?: number) {
    return this.dbRead.prisma.eventType.findUnique({
      where: {
        teamId_slug: {
          teamId,
          slug: eventTypeSlug,
        },
      },
      include: {
        users: true,
        schedule: true,
        hosts: hostsLimit
          ? {
              take: hostsLimit,
            }
          : true,
        destinationCalendar: true,
        calVideoSettings: true,
        team: {
          select: {
            bannerUrl: true,
            name: true,
            logoUrl: true,
            slug: true,
            weekStart: true,
            brandColor: true,
            darkBrandColor: true,
            theme: true,
          },
        },
      },
    });
  }

  async getEventTypeByTeamIdAndSlug(teamId: number, eventTypeSlug: string) {
    return this.dbRead.prisma.eventType.findUnique({
      where: {
        teamId_slug: {
          teamId,
          slug: eventTypeSlug,
        },
      },
    });
  }

  async getEventTypeByTeamIdAndSlugWithOwnerAndTeam(teamId: number, eventTypeSlug: string) {
    return this.dbRead.prisma.eventType.findUnique({
      where: {
        teamId_slug: {
          teamId,
          slug: eventTypeSlug,
        },
      },
      include: { owner: true, team: true },
    });
  }

  async getTeamEventTypes(teamId: number, sortCreatedAt?: SortOrderType) {
    return this.dbRead.prisma.eventType.findMany({
      where: {
        teamId,
      },
      ...(sortCreatedAt && { orderBy: { id: sortCreatedAt } }),
      include: {
        users: true,
        schedule: true,
        hosts: true,
        destinationCalendar: true,
        calVideoSettings: true,
        team: {
          select: {
            bannerUrl: true,
            name: true,
            logoUrl: true,
            slug: true,
            weekStart: true,
            brandColor: true,
            darkBrandColor: true,
            theme: true,
          },
        },
      },
    });
  }

  async getEventTypeById(eventTypeId: number) {
    return this.dbRead.prisma.eventType.findUnique({
      where: { id: eventTypeId },
      include: {
        users: true,
        schedule: true,
        // hosts: true returns all Host scalar fields including weight, priority,
        // weightAdjustment, isFixed, userId, scheduleId — sufficient for ET-003 round-robin parity.
        hosts: true,
        destinationCalendar: true,
        calVideoSettings: true,
        team: {
          select: {
            bannerUrl: true,
            name: true,
            logoUrl: true,
            slug: true,
            weekStart: true,
            brandColor: true,
            darkBrandColor: true,
            theme: true,
          },
        },
      },
    });
  }

  async getEventTypeChildren(eventTypeId: number) {
    return this.dbRead.prisma.eventType.findMany({
      where: { parentId: eventTypeId },
      include: { users: true, schedule: true, hosts: true, destinationCalendar: true },
    });
  }

  async getEventTypeByIdWithChildren(eventTypeId: number) {
    return this.dbRead.prisma.eventType.findUnique({
      where: { id: eventTypeId },
      include: { children: true },
    });
  }

  async deleteUserManagedTeamEventTypes(userId: number, teamId: number) {
    return this.dbWrite.prisma.eventType.deleteMany({
      where: {
        parent: {
          teamId,
        },
        userId,
      },
    });
  }

  async removeUserFromTeamEventTypesHosts(userId: number, teamId: number) {
    return this.dbWrite.prisma.host.deleteMany({
      where: {
        userId,
        eventType: {
          teamId,
        },
      },
    });
  }

  async getByIdIncludeHostsAndUserDefaultSchedule(eventTypeId: number, teamId: number) {
    return this.dbRead.prisma.eventType.findUnique({
      where: {
        id: eventTypeId,
        teamId,
      },
      select: {
        id: true,
        scheduleId: true,
        hosts: {
          select: {
            scheduleId: true,
            userId: true,
            user: {
              select: {
                defaultScheduleId: true,
              },
            },
          },
        },
      },
    });
  }
}
