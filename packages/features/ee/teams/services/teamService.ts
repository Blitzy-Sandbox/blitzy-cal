import { randomBytes } from "node:crypto";
import { getTeamBillingServiceFactory } from "@calcom/ee/billing/di/containers/Billing";
import { SeatChangeTrackingService } from "@calcom/features/ee/billing/service/seatTracking/SeatChangeTrackingService";
import { deleteWorkfowRemindersOfRemovedMember } from "@calcom/features/ee/teams/lib/deleteWorkflowRemindersOfRemovedMember";
import { updateNewTeamMemberEventTypes } from "@calcom/features/ee/teams/lib/queries";
import { TeamRepository } from "@calcom/features/ee/teams/repositories/TeamRepository";
import { WorkflowService } from "@calcom/features/ee/workflows/lib/service/WorkflowService";
import { OnboardingPathService } from "@calcom/features/onboarding/lib/onboarding-path.service";
import { createAProfileForAnExistingUser } from "@calcom/features/profile/lib/createAProfileForAnExistingUser";
import { ProfileRepository } from "@calcom/features/profile/repositories/ProfileRepository";
import { WEBAPP_URL } from "@calcom/lib/constants";
import { deleteDomain } from "@calcom/lib/domainManager/organization";
import { ErrorCode } from "@calcom/lib/errorCodes";
import { ErrorWithCode } from "@calcom/lib/errors";
import logger from "@calcom/lib/logger";
import { prisma } from "@calcom/prisma";
import type { Membership } from "@calcom/prisma/client";
import { Prisma } from "@calcom/prisma/client";
import { MembershipRole } from "@calcom/prisma/enums";
import { SchedulingType } from "@calcom/prisma/enums";

const log = logger.getSubLogger({ prefix: ["TeamService"] });

type MembershipWithRelations = Pick<
  Membership,
  "id" | "userId" | "teamId" | "role" | "accepted" | "disableImpersonation"
>;

type TeamWithSettings = {
  id: number;
  isOrganization: boolean | null;
  organizationSettings: unknown;
  metadata: unknown;
  activeOrgWorkflows: unknown;
  parentId: number | null;
};

type UserWithTeams = {
  id: number;
  movedToProfileId: number | null;
  email: string;
  username: string | null;
  completedOnboarding: boolean;
  teams: {
    team: {
      id: number;
      parentId: number | null;
    };
  }[];
};

export type RemoveMemberResult = {
  membership: MembershipWithRelations;
};

export class TeamService {
  static async createInvite(
    teamId: number,
    options?: { token?: string }
  ): Promise<{ token: string; inviteLink: string }> {
    const team = await prisma.team.findUnique({
      where: { id: teamId },
      select: { parentId: true, isOrganization: true },
    });

    if (!team) throw new ErrorWithCode(ErrorCode.NotFound, "Team not found");

    const isOrganizationOrATeamInOrganization = !!(team.parentId || team.isOrganization);

    if (options?.token) {
      const existingToken = await prisma.verificationToken.findFirst({
        where: {
          token: options.token,
          identifier: `invite-link-for-teamId-${teamId}`,
          teamId,
        },
      });
      if (!existingToken) throw new ErrorWithCode(ErrorCode.NotFound, "Invite token not found");
      return {
        token: existingToken.token,
        inviteLink: await TeamService.buildInviteLink(
          existingToken.token,
          isOrganizationOrATeamInOrganization
        ),
      };
    }

    const token = randomBytes(32).toString("hex");
    await prisma.verificationToken.create({
      data: {
        identifier: `invite-link-for-teamId-${teamId}`,
        token,
        expires: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // +1 week
        expiresInDays: 7,
        teamId,
      },
    });

    return {
      token,
      inviteLink: await TeamService.buildInviteLink(token, isOrganizationOrATeamInOrganization),
    };
  }

  private static async buildInviteLink(token: string, isOrgContext: boolean): Promise<string> {
    const teamInviteLink = `${WEBAPP_URL}/teams?token=${token}`;
    if (!isOrgContext) {
      return teamInviteLink;
    }
    const gettingStartedPath = await OnboardingPathService.getGettingStartedPathWhenInvited();
    const orgInviteLink = `${WEBAPP_URL}/signup?token=${token}&callbackUrl=${gettingStartedPath}`;
    return orgInviteLink;
  }
  /**
   * Deletes a team and all its associated data in a safe, transactional order.
   * External, critical services like billing are handled first to prevent data inconsistencies.
   */
  static async delete({ id }: { id: number }) {
    // Step 1: Cancel the external billing subscription first.
    // If this fails, the entire operation aborts, leaving the team and its data intact.
    // This prevents a state where the user is billed for a deleted team.
    // const teamBilling = await TeamBillingService.findAndInit(id);
    const teamBillingServiceFactory = getTeamBillingServiceFactory();
    const teamBillingService = await teamBillingServiceFactory.findAndInit(id);
    await teamBillingService.cancel();

    // Step 2: Clean up internal, related data like workflow reminders.
    try {
      await WorkflowService.deleteWorkflowRemindersOfRemovedTeam(id);
    } catch (e) {
      // Log the error, but don't abort the deletion.
      // It's better to have a deleted team with orphaned reminders than to halt the process
      // after the subscription has already been canceled.
      logger.error(`Failed to delete workflow reminders for team ${id}`, e);
    }

    // Step 3: Delete the team from the database. This is the core "commit" point.
    const teamRepo = new TeamRepository(prisma);
    const deletedTeam = await teamRepo.deleteById({ id });

    // Step 4: Clean up any final, non-critical external state.
    if (deletedTeam && deletedTeam.isOrganization && deletedTeam.slug) {
      deleteDomain(deletedTeam.slug);
    }

    return deletedTeam;
  }

  static async removeMembers({
    teamIds,
    userIds,
    isOrg = false,
  }: {
    teamIds: number[];
    userIds: number[];
    isOrg?: boolean;
  }) {
    const deleteMembershipPromises: Promise<RemoveMemberResult>[] = [];

    for (const userId of userIds) {
      for (const teamId of teamIds) {
        deleteMembershipPromises.push(
          TeamService.removeMember({
            teamId,
            userId,
            isOrg,
          })
        );
      }
    }

    await Promise.all(deleteMembershipPromises);
    const teamBillingServiceFactory = getTeamBillingServiceFactory();
    const teamBillingServices = await teamBillingServiceFactory.findAndInitMany(teamIds);
    const teamBillingPromises = teamBillingServices.map((teamBillingService) =>
      teamBillingService.updateQuantity("removal")
    );
    await Promise.allSettled(teamBillingPromises);
  }

  static async inviteMemberByToken(token: string, userId: number) {
    const verificationToken = await prisma.verificationToken.findFirst({
      where: {
        token,
        OR: [{ expiresInDays: null }, { expires: { gte: new Date() } }],
      },
      select: {
        teamId: true,
        team: {
          select: {
            name: true,
            parentId: true,
          },
        },
      },
    });

    if (!verificationToken) throw new ErrorWithCode(ErrorCode.NotFound, "Invite not found");
    if (!verificationToken.teamId || !verificationToken.team)
      throw new ErrorWithCode(ErrorCode.NotFound, "Invite token is not associated with any team");

    try {
      await prisma.membership.create({
        data: {
          createdAt: new Date(),
          teamId: verificationToken.teamId,
          userId: userId,
          role: MembershipRole.MEMBER,
          accepted: false,
        },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError) {
        if (e.code === "P2002") {
          throw new ErrorWithCode(
            ErrorCode.Forbidden,
            "This user is a member of this team / has a pending invitation."
          );
        }
      } else throw e;
    }

    if (!verificationToken.team.parentId) {
      const seatTracker = new SeatChangeTrackingService();
      await seatTracker.logSeatAddition({
        teamId: verificationToken.teamId,
        userId,
        triggeredBy: userId,
      });
    }

    const teamBillingServiceFactory = getTeamBillingServiceFactory();
    const teamBillingService = await teamBillingServiceFactory.findAndInit(verificationToken.teamId);
    await teamBillingService.updateQuantity("addition");

    return verificationToken.team.name;
  }

  static async acceptTeamMembership({
    userId,
    teamId,
    userEmail,
    username,
  }: {
    userId: number;
    teamId: number;
    userEmail: string;
    username: string | null;
  }) {
    const teamMembership = await prisma.membership.update({
      where: {
        userId_teamId: { userId, teamId },
      },
      data: {
        accepted: true,
      },
      select: {
        team: true,
      },
    });

    const team = teamMembership.team;

    if (team.parentId) {
      await prisma.membership.update({
        where: {
          userId_teamId: { userId, teamId: team.parentId },
        },
        data: {
          accepted: true,
        },
      });
    }

    const isASubteam = team.parentId !== null;
    const idOfOrganizationInContext = team.isOrganization ? team.id : isASubteam ? team.parentId : null;
    const needProfileUpdate = !!idOfOrganizationInContext;

    if (needProfileUpdate) {
      await createAProfileForAnExistingUser({
        user: {
          id: userId,
          email: userEmail,
          currentUsername: username,
        },
        organizationId: idOfOrganizationInContext,
      });
    }

    await updateNewTeamMemberEventTypes(userId, teamId);
  }
  static async leaveTeamMembership({ userId, teamId }: { userId: number; teamId: number }) {
    try {
      const membership = await prisma.membership.delete({
        where: {
          userId_teamId: { userId, teamId },
        },
        select: {
          team: true,
        },
      });

      if (membership.team.parentId) {
        await prisma.membership.delete({
          where: {
            userId_teamId: { userId, teamId: membership.team.parentId },
          },
        });
      }

      if (!membership.team.parentId) {
        const seatTracker = new SeatChangeTrackingService();
        await seatTracker.logSeatRemoval({
          teamId,
          userId,
          triggeredBy: userId,
        });
      }
    } catch (e) {
      console.log(e);
    }
  }

  static async acceptInvitationByToken(acceptanceToken: string, userId: number) {
    const verificationToken = await prisma.verificationToken.findFirst({
      where: {
        token: acceptanceToken,
        expires: { gte: new Date() },
      },
      select: {
        identifier: true,
        teamId: true,
        team: { select: { name: true } },
      },
    });

    if (!verificationToken) {
      throw new ErrorWithCode(ErrorCode.NotFound, "Invite not found");
    }

    if (!verificationToken.teamId || !verificationToken.team) {
      throw new ErrorWithCode(ErrorCode.NotFound, "Invite token is not associated with any team");
    }

    const currentUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, username: true },
    });

    if (!currentUser) {
      throw new ErrorWithCode(ErrorCode.NotFound, "User not found");
    }

    if (
      currentUser.email !== verificationToken.identifier &&
      currentUser.username !== verificationToken.identifier
    ) {
      throw new ErrorWithCode(ErrorCode.Forbidden, "This invitation is not for your account");
    }

    await TeamService.acceptTeamMembership({
      userId,
      teamId: verificationToken.teamId,
      userEmail: currentUser.email,
      username: currentUser.username,
    });
  }

  static async publish(teamId: number) {
    const teamBillingServiceFactory = getTeamBillingServiceFactory();
    const teamBillingService = await teamBillingServiceFactory.findAndInit(teamId);
    return teamBillingService.publish();
  }

  // ──────────────────────────────────────────────────────────────────────────────
  // AG-002: Team Event Routing Behavioral Parity — Round-Robin & Collective Methods
  // ──────────────────────────────────────────────────────────────────────────────

  /**
   * Determine the next team member for round-robin booking assignment (AG-002).
   * Implements Calendly-equivalent round-robin distribution:
   * - Fair rotation across team members (even distribution of bookings)
   * - Availability-weighted distribution (members with more availability get proportionally more)
   * - Respects the team's round-robin reset interval for rotation state tracking
   *
   * @param teamId - The team ID
   * @param eventTypeId - The event type ID configured with ROUND_ROBIN scheduling
   * @param eligibleMemberIds - Array of accepted team member user IDs eligible for assignment
   * @returns The next member to assign based on rotation state, or null if no eligible members
   */
  static async getNextRoundRobinMember({
    teamId,
    eventTypeId,
    eligibleMemberIds,
  }: {
    teamId: number;
    eventTypeId: number;
    eligibleMemberIds: number[];
  }): Promise<{ userId: number; bookingCount: number } | null> {
    if (eligibleMemberIds.length === 0) return null;

    const teamRepo = new TeamRepository(prisma);

    // Get the team's round-robin reset interval for time-based filtering
    const teamData = await teamRepo.findTeamWithMembersAndSchedulingData(teamId);

    // Convert the RRResetInterval enum to a cutoff date for rotation state queries
    let resetSince: Date | undefined;
    if (teamData?.rrResetInterval) {
      const now = Date.now();
      const intervalMs =
        teamData.rrResetInterval === "DAY"
          ? 1 * 24 * 60 * 60 * 1000
          : 30 * 24 * 60 * 60 * 1000; // MONTH = 30 days
      resetSince = new Date(now - intervalMs);
    }

    // Get the rotation state: booking counts and last-booking timestamps per member
    const rotationState = await teamRepo.findRoundRobinRotationState({
      teamId,
      eventTypeId,
      resetSince,
    });

    // Build a map of userId -> { bookingCount, lastBookingTimestamp }
    // Filter out entries with null userId (bookings without an assigned user are irrelevant for rotation)
    const rotationMap = new Map<number, { bookingCount: number; lastBookingTimestamp: Date | null }>();
    for (const entry of rotationState) {
      if (entry.userId != null) {
        rotationMap.set(entry.userId, {
          bookingCount: entry.bookingCount,
          lastBookingTimestamp: entry.lastBookingTimestamp,
        });
      }
    }

    // Find the eligible member with the fewest bookings (fair rotation)
    // If tied, select the one least recently assigned (or not yet assigned)
    let bestCandidate: {
      userId: number;
      bookingCount: number;
      lastBookingTimestamp: Date | null;
    } | null = null;

    for (const memberId of eligibleMemberIds) {
      const state = rotationMap.get(memberId) ?? { bookingCount: 0, lastBookingTimestamp: null };

      if (
        !bestCandidate ||
        state.bookingCount < bestCandidate.bookingCount ||
        (state.bookingCount === bestCandidate.bookingCount &&
          (state.lastBookingTimestamp === null ||
            (bestCandidate.lastBookingTimestamp !== null &&
              state.lastBookingTimestamp < bestCandidate.lastBookingTimestamp)))
      ) {
        bestCandidate = {
          userId: memberId,
          bookingCount: state.bookingCount,
          lastBookingTimestamp: state.lastBookingTimestamp,
        };
      }
    }

    if (!bestCandidate) return null;

    return {
      userId: bestCandidate.userId,
      bookingCount: bestCandidate.bookingCount,
    };
  }

  /**
   * Record a round-robin booking assignment for rotation state tracking (AG-002).
   * Called after a booking is confirmed for a round-robin team event type.
   * The booking record itself captures the assignment; this method verifies/confirms
   * the team-level rotation tracking by looking up the booking assignment.
   *
   * @param bookingId - The booking ID that was just created
   * @param userId - The team member who was assigned the booking
   * @param eventTypeId - The event type ID
   * @param teamId - The team ID
   * @returns The confirmed booking assignment data, or null if not found
   */
  static async recordRoundRobinAssignment({
    bookingId,
    userId,
    eventTypeId,
    teamId,
  }: {
    bookingId: number;
    userId: number;
    eventTypeId: number;
    teamId: number;
  }) {
    const teamRepo = new TeamRepository(prisma);
    const result = await teamRepo.getLatestBookingForRotation({
      bookingId,
      userId,
      eventTypeId,
      teamId,
    });

    if (!result) {
      log.warn("Round-robin assignment recording failed: booking not found", {
        bookingId,
        userId,
        eventTypeId,
        teamId,
      });
    }

    return result;
  }

  /**
   * Validate that all hosts are available for a collective scheduling event type (AG-002).
   * For Calendly-equivalent collective scheduling:
   * - ALL hosts must be available for a booking slot to be offered
   * - Returns the list of hosts that must all confirm for simultaneous booking
   *
   * @param teamId - The team ID
   * @param eventTypeId - The event type ID configured with COLLECTIVE scheduling
   * @returns Object with hosts array and whether all hosts are found. Returns null if event type not found.
   */
  static async validateCollectiveAvailability({
    teamId,
    eventTypeId,
  }: {
    teamId: number;
    eventTypeId: number;
  }): Promise<{
    hosts: Array<{
      userId: number;
      isFixed: boolean;
      user: { id: number; name: string | null; email: string; timeZone: string };
    }>;
    allHostsRequired: boolean;
  } | null> {
    const teamRepo = new TeamRepository(prisma);
    const collectiveHosts = await teamRepo.findCollectiveAvailability({
      teamId,
      eventTypeId,
    });

    if (!collectiveHosts || collectiveHosts.length === 0) {
      return null;
    }

    // Filter to only accepted team members
    const acceptedHosts = collectiveHosts.filter((host) => host.member?.accepted === true);

    return {
      hosts: acceptedHosts.map((host) => ({
        userId: host.userId,
        isFixed: host.isFixed,
        user: host.user,
      })),
      allHostsRequired: true, // Collective scheduling always requires all hosts
    };
  }

  /**
   * Retrieve the host group composition for a collective event type (AG-002).
   * Returns hosts grouped by their HostGroup for collective scheduling,
   * identifying which members must all be available for simultaneous booking confirmation.
   *
   * @param teamId - The team ID
   * @param eventTypeId - The event type ID
   * @returns Array of host group compositions, or null if no collective event found
   */
  static async getCollectiveHostGroup({
    teamId,
    eventTypeId,
  }: {
    teamId: number;
    eventTypeId: number;
  }) {
    const teamRepo = new TeamRepository(prisma);
    const hosts = await teamRepo.findCollectiveSchedulingGroupComposition({
      teamId,
      eventTypeId,
    });

    if (!hosts || hosts.length === 0) {
      return null;
    }

    // Group hosts by their group assignment
    const groupMap = new Map<
      string | null,
      Array<{
        userId: number;
        isFixed: boolean;
        user: { id: number; name: string | null; email: string };
      }>
    >();

    for (const host of hosts) {
      const groupKey = host.groupId ?? null;
      if (!groupMap.has(groupKey)) {
        groupMap.set(groupKey, []);
      }
      groupMap.get(groupKey)?.push({
        userId: host.userId,
        isFixed: host.isFixed,
        user: host.user,
      });
    }

    return Array.from(groupMap.entries()).map(([groupId, members]) => ({
      groupId,
      members,
    }));
  }

  /**
   * Route a team booking based on the event type's scheduling type configuration (AG-002).
   * This is the main entry point for team event routing that correctly routes bookings
   * based on the scheduling type: ROUND_ROBIN, COLLECTIVE, or MANAGED.
   *
   * Implements Calendly-equivalent team event routing:
   * - ROUND_ROBIN: Fair rotation across eligible team members
   * - COLLECTIVE: All hosts must be available; simultaneous confirmation
   * - MANAGED: Routes to the specific managed member (existing behavior)
   *
   * @param teamId - The team ID
   * @param eventTypeId - The event type ID
   * @param schedulingType - The scheduling type for this event
   * @returns Routing result with selected member(s) and routing metadata
   */
  static async routeTeamBooking({
    teamId,
    eventTypeId,
    schedulingType,
  }: {
    teamId: number;
    eventTypeId: number;
    schedulingType: SchedulingType;
  }): Promise<{
    type: SchedulingType;
    selectedMembers: Array<{ userId: number }>;
    isCollective: boolean;
  }> {
    const teamRepo = new TeamRepository(prisma);

    switch (schedulingType) {
      case SchedulingType.ROUND_ROBIN: {
        // Get eligible members for round-robin rotation
        const eligibleMembers = await teamRepo.findSchedulingEligibleMembers({
          teamId,
          eventTypeId,
        });

        const eligibleMemberIds = eligibleMembers.map((m) => m.userId);

        // Determine next member via round-robin
        const nextMember = await TeamService.getNextRoundRobinMember({
          teamId,
          eventTypeId,
          eligibleMemberIds,
        });

        if (!nextMember) {
          throw new ErrorWithCode(
            ErrorCode.NoAvailableUsersFound,
            "No eligible team members available for round-robin assignment"
          );
        }

        return {
          type: SchedulingType.ROUND_ROBIN,
          selectedMembers: [{ userId: nextMember.userId }],
          isCollective: false,
        };
      }

      case SchedulingType.COLLECTIVE: {
        // For collective: ALL hosts must be available
        const collectiveResult = await TeamService.validateCollectiveAvailability({
          teamId,
          eventTypeId,
        });

        if (!collectiveResult || collectiveResult.hosts.length === 0) {
          throw new ErrorWithCode(
            ErrorCode.EventTypeNoHosts,
            "No hosts found for collective scheduling event type"
          );
        }

        return {
          type: SchedulingType.COLLECTIVE,
          selectedMembers: collectiveResult.hosts.map((h) => ({ userId: h.userId })),
          isCollective: true,
        };
      }

      case SchedulingType.MANAGED: {
        // Managed event types are routed to specific users via child event types
        // The existing managed event type system handles this routing
        log.debug("Managed event type routing delegated to child event type system", {
          teamId,
          eventTypeId,
        });
        return {
          type: SchedulingType.MANAGED,
          selectedMembers: [],
          isCollective: false,
        };
      }

      default: {
        throw new ErrorWithCode(
          ErrorCode.BadRequest,
          `Unsupported scheduling type for team event routing: ${schedulingType}`
        );
      }
    }
  }

  /**
   * Get the full routing configuration for a team event type (AG-002).
   * Returns the team's scheduling configuration including member list, rotation state,
   * and distribution settings needed for Calendly-equivalent team event routing.
   *
   * @param teamId - The team ID
   * @param eventTypeId - The event type ID
   * @returns Routing configuration object with scheduling type, eligible members, and team metadata
   */
  static async getTeamEventRoutingConfig({
    teamId,
    eventTypeId,
  }: {
    teamId: number;
    eventTypeId: number;
  }): Promise<{
    schedulingType: SchedulingType | null;
    eligibleMembers: Array<{ userId: number; role: MembershipRole }>;
    rrResetInterval: string | null;
    teamId: number;
  } | null> {
    const teamRepo = new TeamRepository(prisma);

    // Get team data with scheduling configuration
    const teamData = await teamRepo.findTeamWithMembersAndSchedulingData(teamId);
    if (!teamData) return null;

    // Get the event type to determine scheduling type
    const eventType = await prisma.eventType.findUnique({
      where: { id: eventTypeId },
      select: {
        schedulingType: true,
        teamId: true,
      },
    });

    if (!eventType || eventType.teamId !== teamId) return null;

    // Get eligible members for this event type
    const eligibleMembers = await teamRepo.findSchedulingEligibleMembers({
      teamId,
      eventTypeId,
    });

    return {
      schedulingType: eventType.schedulingType as SchedulingType | null,
      eligibleMembers: eligibleMembers.map((m) => ({
        userId: m.userId,
        role: m.role as MembershipRole,
      })),
      rrResetInterval: teamData.rrResetInterval ?? null,
      teamId,
    };
  }

  private static async removeMember({
    userId,
    teamId,
    isOrg,
  }: {
    userId: number;
    teamId: number;
    isOrg: boolean;
  }) {
    const membership = await TeamService.fetchMembershipOrThrow(userId, teamId);
    const team = await TeamService.fetchTeamOrThrow(teamId);
    const user = await TeamService.fetchUserOrThrow(userId);

    if (isOrg) {
      log.debug("Removing a member from the organization");
      await TeamService.removeFromOrganization(membership, team, user);
    } else {
      log.debug("Removing a member from a team");
      await TeamService.removeFromTeam(membership, teamId);
    }

    await deleteWorkfowRemindersOfRemovedMember(team, userId, isOrg);

    if (!team.parentId) {
      const seatTracker = new SeatChangeTrackingService();
      await seatTracker.logSeatRemoval({
        teamId,
        userId,
      });
    }

    return { membership };
  }

  // TODO: Needs to be moved to repository
  private static async fetchMembershipOrThrow(
    userId: number,
    teamId: number
  ): Promise<MembershipWithRelations> {
    const membership = await prisma.membership.findUnique({
      where: {
        userId_teamId: { userId: userId, teamId: teamId },
      },
      select: {
        id: true,
        userId: true,
        teamId: true,
        role: true,
        accepted: true,
        disableImpersonation: true,
      },
    });

    if (!membership) {
      throw new ErrorWithCode(ErrorCode.NotFound, "Membership not found");
    }

    return membership;
  }

  // TODO: Needs to be moved to repository
  static async fetchTeamOrThrow(teamId: number): Promise<TeamWithSettings> {
    const team = await prisma.team.findUnique({
      where: { id: teamId },
      select: {
        isOrganization: true,
        organizationSettings: true,
        id: true,
        metadata: true,
        activeOrgWorkflows: true,
        parentId: true,
      },
    });

    if (!team) {
      throw new ErrorWithCode(ErrorCode.NotFound, "Team not found");
    }

    return team;
  }

  // TODO: Needs to be moved to repository
  private static async fetchUserOrThrow(userId: number): Promise<UserWithTeams> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        movedToProfileId: true,
        email: true,
        username: true,
        completedOnboarding: true,
        teams: {
          select: {
            team: {
              select: {
                id: true,
                parentId: true,
              },
            },
          },
        },
      },
    });

    if (!user) {
      throw new ErrorWithCode(ErrorCode.NotFound, "User not found");
    }

    return user;
  }

  // TODO: Needs to be moved to repository
  private static async cleanupTempOrgRedirect(user: UserWithTeams, team: TeamWithSettings) {
    const profileToDelete = await ProfileRepository.findByUserIdAndOrgId({
      userId: user.id,
      organizationId: team.id,
    });

    if (user.username && user.movedToProfileId === profileToDelete?.id) {
      log.debug("Cleaning up tempOrgRedirect for user", user.username);
      await prisma.tempOrgRedirect.deleteMany({
        where: {
          from: user.username,
        },
      });
    }
  }

  private static async removeFromOrganization(
    membership: MembershipWithRelations,
    team: TeamWithSettings,
    user: UserWithTeams
  ) {
    await TeamService.cleanupTempOrgRedirect(user, team);
    const newUsername = generateNewUsername(user);

    const subTeamIds = await prisma.team.findMany({
      where: {
        parentId: team.id,
      },
      select: {
        id: true,
      },
    });
    const subTeamIdArray = subTeamIds.map((t) => t.id);

    await prisma.$transaction(async (tx) => {
      if (subTeamIdArray.length > 0) {
        // Remove user from all sub-teams event type hosts
        await tx.host.deleteMany({
          where: {
            userId: membership.userId,
            eventType: {
              teamId: {
                in: subTeamIdArray,
              },
            },
          },
        });
        // Delete managed child events in sub-teams
        await tx.eventType.deleteMany({
          where: {
            userId: membership.userId,
            parent: {
              teamId: {
                in: subTeamIdArray,
              },
            },
          },
        });
        // Delete all sub-team memberships where this team is the organization
        await tx.membership.deleteMany({
          where: {
            teamId: {
              in: subTeamIdArray,
            },
            userId: membership.userId,
          },
        });
      }

      // Remove organizationId from the user
      await tx.user.update({
        where: { id: membership.userId },
        data: {
          organizationId: null,
          username: newUsername,
        },
      });
      // Delete the profile of the user from the organization
      await tx.profile.deleteMany({
        where: {
          userId: membership.userId,
          organizationId: team.id,
        },
      });
      // Delete the membership of the user from the organization
      await tx.membership.delete({
        where: {
          userId_teamId: { userId: membership.userId, teamId: team.id },
        },
      });
    });

    // Generate new username for user leaving organization
    function generateNewUsername(user: UserWithTeams): string | null {
      // We ensure that new username would be unique across all users in the global namespace outside any organization
      return user.username != null ? `${user.username}-${user.id}` : null;
    }
  }

  // Remove member from regular team
  private static async removeFromTeam(membership: MembershipWithRelations, teamId: number) {
    await prisma.$transaction([
      // Remove user from all team event types' hosts
      prisma.host.deleteMany({
        where: {
          userId: membership.userId,
          eventType: {
            teamId: teamId,
          },
        },
      }),
      // Deleted managed event types from this team for this member
      prisma.eventType.deleteMany({
        where: { parent: { teamId: teamId }, userId: membership.userId },
      }),
      // Delete the membership of the user from the team
      prisma.membership.delete({
        where: {
          userId_teamId: { userId: membership.userId, teamId: teamId },
        },
      }),
    ]);
  }
}
