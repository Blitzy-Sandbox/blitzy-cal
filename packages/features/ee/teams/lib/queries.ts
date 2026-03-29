import { z } from "zod";

import { getAppFromSlug } from "@calcom/app-store/utils";
import { getBookerBaseUrlSync } from "@calcom/features/ee/organizations/lib/getBookerBaseUrlSync";
import { getTeam, getOrg } from "@calcom/features/ee/teams/repositories/TeamRepository";
import { UserRepository } from "@calcom/features/users/repositories/UserRepository";
import { DATABASE_CHUNK_SIZE } from "@calcom/lib/constants";
import { parseBookingLimit } from "@calcom/lib/intervalLimits/isBookingLimits";
import logger from "@calcom/lib/logger";
import { safeStringify } from "@calcom/lib/safeStringify";
import prisma from "@calcom/prisma";
import type { Prisma } from "@calcom/prisma/client";
import type { Team } from "@calcom/prisma/client";
import { MembershipRole, SchedulingType } from "@calcom/prisma/enums";
import { baseEventTypeSelect } from "@calcom/prisma/selects";
import {
  EventTypeMetaDataSchema,
  allManagedEventTypeProps,
  allManagedEventTypePropsForZod,
  unlockedManagedEventTypePropsForZod,
  eventTypeLocations,
} from "@calcom/prisma/zod-utils";
import { EventTypeSchema } from "@calcom/prisma/zod/modelSchema/EventTypeSchema";

export type TeamWithMembers = Awaited<ReturnType<typeof getTeamWithMembers>>;

/**
 * AG-002: Represents a team member eligible for scheduling in round-robin or collective event types.
 * Contains the minimal fields needed for scheduling distribution decisions.
 */
export type SchedulingEligibleMember = {
  /** The user ID of the team member */
  userId: number;
  /** The member's role within the team (MEMBER, ADMIN, OWNER) */
  role: MembershipRole;
  /** When the membership was created — used for fair rotation state tracking in round-robin distribution */
  createdAt: Date | null;
};

/**
 * AG-003: Configuration for managed event type push behavior.
 * Controls which fields propagate from admin-templated event types to child instances,
 * enabling Calendly-compatible admin push behavior where admins control field inheritance.
 */
export type ManagedEventPushSettings = {
  /** Whether to inherit the parent event type's schedule configuration */
  inheritSchedule?: boolean;
  /** Whether to inherit the parent event type's buffer time settings */
  inheritBufferTime?: boolean;
  /** Whether to inherit the parent event type's minimum notice period */
  inheritMinNotice?: boolean;
};

/**
 * AG-002: Represents a round-robin assignment result, indicating the next user
 * to be assigned based on rotation logic.
 */
export type RoundRobinAssignment = {
  /** The user ID of the member next in line for assignment */
  userId: number;
};

export async function getTeamWithMembers(args: {
  id?: number;
  slug?: string;
  userId?: number;
  orgSlug?: string | null;
  isTeamView?: boolean;
  currentOrg?: Pick<Team, "id"> | null;
  /**
   * If true, means that you are fetching an organization and not a team
   */
  isOrgView?: boolean;
}) {
  const { id, slug, currentOrg: _currentOrg, userId, orgSlug, isTeamView, isOrgView } = args;

  // This should improve performance saving already app data found.
  const appDataMap = new Map();

  // Minimal user select for event type hosts in team view - only fields needed for avatar display
  // This significantly reduces data transfer for teams with many event types/hosts
  const minimalUserSelectForHosts = {
    username: true,
    name: true,
    avatarUrl: true,
    id: true,
  } satisfies Prisma.UserSelect;

  // Full user select for members (includes credentials for connectedApps when !isTeamView)
  const userSelect = {
    username: true,
    email: true,
    name: true,
    avatarUrl: true,
    id: true,
    bio: true,
    teams: {
      select: {
        team: {
          select: {
            slug: true,
            id: true,
          },
        },
      },
    },
    credentials: {
      select: {
        app: {
          select: {
            slug: true,
            categories: true,
          },
        },
        destinationCalendars: {
          select: {
            externalId: true,
          },
        },
      },
    },
  } satisfies Prisma.UserSelect;
  let lookupBy;

  if (id) {
    lookupBy = { id, havingMemberWithId: userId };
  } else if (slug) {
    lookupBy = { slug, havingMemberWithId: userId };
  } else {
    throw new Error("Must provide either id or slug");
  }

  const arg = {
    lookupBy,
    forOrgWithSlug: orgSlug ?? null,
    isOrg: !!isOrgView,
    teamSelect: {
      id: true,
      name: true,
      slug: true,
      isOrganization: true,
      logoUrl: true,
      bio: true,
      hideBranding: true,
      hideBookATeamMember: true,
      isPrivate: true,
      metadata: true,
      parent: {
        select: {
          id: true,
          slug: true,
          name: true,
          isPrivate: true,
          isOrganization: true,
          logoUrl: true,
          metadata: true,
          organizationSettings: {
            select: {
              allowSEOIndexing: true,
              orgProfileRedirectsToVerifiedDomain: true,
              orgAutoAcceptEmail: true,
              disableAutofillOnBookingPage: true,
            },
          },
        },
      },
      parentId: true,
      children: {
        select: {
          name: true,
          slug: true,
        },
      },
      // AG-002: Round-robin and collective scheduling parity fields — consistent with getTeamWithoutMembers
      bookingLimits: true,
      rrResetInterval: true,
      rrTimestampBasis: true,
      includeManagedEventsInLimits: true,
      members: {
        select: {
          accepted: true,
          role: true,
          disableImpersonation: true,
          // AG-002: Include membership creation timestamp for round-robin rotation state tracking
          createdAt: true,
          user: {
            select: userSelect,
          },
        },
      },
      theme: true,
      brandColor: true,
      darkBrandColor: true,
      eventTypes: {
        where: {
          hidden: false,
          schedulingType: {
            not: SchedulingType.MANAGED,
          },
        },
        orderBy: [
          {
            position: "desc",
          },
          {
            id: "asc",
          },
        ] as Prisma.EventTypeOrderByWithRelationInput[],
        select: {
          hosts: {
            select: {
              user: {
                // For team view, we only need minimal user info for avatar display
                // This significantly reduces data transfer for teams with many event types/hosts
                select: isTeamView ? minimalUserSelectForHosts : userSelect,
              },
            },
          },
          metadata: true,
          ...baseEventTypeSelect,
        },
      },
      inviteTokens: {
        select: {
          token: true,
          expires: true,
          expiresInDays: true,
          identifier: true,
        },
      },
      organizationSettings: {
        select: {
          allowSEOIndexing: true,
          orgProfileRedirectsToVerifiedDomain: true,
          orgAutoAcceptEmail: true,
          disableAutofillOnBookingPage: true,
        },
      },
    },
  } as const;

  const teamOrOrg = isOrgView ? await getOrg(arg) : await getTeam(arg);

  if (!teamOrOrg) return null;

  const teamOrOrgMemberships = [];
  const userRepo = new UserRepository(prisma);
  for (const membership of teamOrOrg.members) {
    teamOrOrgMemberships.push({
      ...membership,
      user: await userRepo.enrichUserWithItsProfile({
        user: membership.user,
      }),
    });
  }
  const members = teamOrOrgMemberships.map((m) => {
    const { credentials, profile, ...restUser } = m.user;
    return {
      ...restUser,
      username: profile?.username ?? restUser.username,
      role: m.role,
      profile: profile,
      organizationId: profile?.organizationId ?? null,
      organization: profile?.organization,
      accepted: m.accepted,
      disableImpersonation: m.disableImpersonation,
      // AG-002: Membership creation date for round-robin rotation state tracking
      createdAt: m.createdAt,
      subteams: orgSlug
        ? m.user.teams
            .filter((membership) => membership.team.id !== teamOrOrg.id)
            .map((membership) => membership.team.slug)
        : null,
      bookerUrl: getBookerBaseUrlSync(profile?.organization?.slug || ""),
      connectedApps: !isTeamView
        ? credentials?.map((cred) => {
            const appSlug = cred.app?.slug;
            let appData = appDataMap.get(appSlug);

            if (!appData) {
              appData = getAppFromSlug(appSlug);
              appDataMap.set(appSlug, appData);
            }

            const isCalendar = cred?.app?.categories?.includes("calendar") ?? false;
            const externalId = isCalendar ? cred.destinationCalendars?.[0]?.externalId : null;
            return {
              name: appData?.name ?? null,
              logo: appData?.logo ?? null,
              app: cred.app,
              externalId: externalId ?? null,
            };
          })
        : null,
    };
  });

  const eventTypesWithUsersUserProfile = [];
  for (const eventType of teamOrOrg.eventTypes) {
    const usersWithUserProfile = [];
    for (const { user } of eventType.hosts) {
      usersWithUserProfile.push(
        await userRepo.enrichUserWithItsProfile({
          user,
        })
      );
    }
    eventTypesWithUsersUserProfile.push({
      ...eventType,
      users: usersWithUserProfile,
    });
  }
  const eventTypes = eventTypesWithUsersUserProfile.map((eventType) => ({
    ...eventType,
    metadata: EventTypeMetaDataSchema.parse(eventType.metadata),
  }));

  // Don't leak invite tokens to the frontend
  const { inviteTokens, ...teamWithoutInviteTokens } = teamOrOrg;

  // Don't leak stripe payment ids
  const teamMetadata = teamOrOrg.metadata;
  const {
    paymentId: _,
    subscriptionId: __,
    subscriptionItemId: ___,
    ...restTeamMetadata
  } = teamMetadata || {};

  return {
    ...teamWithoutInviteTokens,
    ...(teamWithoutInviteTokens.logoUrl ? { logo: teamWithoutInviteTokens.logoUrl } : {}),
    /** To prevent breaking we only return non-email attached token here, if we have one */
    inviteToken: inviteTokens.find(
      (token) =>
        token.identifier === `invite-link-for-teamId-${teamOrOrg.id}` &&
        token.expires > new Date(new Date().setHours(24))
    ),
    metadata: restTeamMetadata,
    eventTypes: !isOrgView ? eventTypes : null,
    members,
  };
}

export async function getTeamWithoutMembers(args: {
  id?: number;
  slug?: string;
  userId?: number;
  orgSlug?: string | null;
  /**
   * If true, means that you are fetching an organization and not a team
   */
  isOrgView?: boolean;
}) {
  const { id, slug, userId, orgSlug, isOrgView } = args;

  let lookupBy;

  if (id) {
    lookupBy = { id, havingMemberWithId: userId };
  } else if (slug) {
    lookupBy = { slug, havingMemberWithId: userId };
  } else {
    throw new Error("Must provide either id or slug");
  }

  const arg = {
    lookupBy,
    forOrgWithSlug: orgSlug ?? null,
    isOrg: !!isOrgView,
    teamSelect: {
      id: true,
      name: true,
      slug: true,
      isOrganization: true,
      logoUrl: true,
      bio: true,
      hideBranding: true,
      hideBookATeamMember: true,
      hideTeamProfileLink: true,
      isPrivate: true,
      metadata: true,
      bookingLimits: true,
      rrResetInterval: true,
      rrTimestampBasis: true,
      includeManagedEventsInLimits: true,
      parent: {
        select: {
          id: true,
          slug: true,
          name: true,
          isPrivate: true,
          isOrganization: true,
          logoUrl: true,
          metadata: true,
        },
      },
      parentId: true,
      children: {
        select: {
          name: true,
          slug: true,
        },
      },
      theme: true,
      brandColor: true,
      darkBrandColor: true,
      inviteTokens: {
        select: {
          token: true,
          expires: true,
          expiresInDays: true,
          identifier: true,
        },
      },
    },
  } as const;

  const teamOrOrg = isOrgView ? await getOrg(arg) : await getTeam(arg);

  if (!teamOrOrg) return null;

  // Don't leak invite tokens to the frontend
  const { inviteTokens, ...teamWithoutInviteTokens } = teamOrOrg;

  // Don't leak stripe payment ids
  const teamMetadata = teamOrOrg.metadata;
  const {
    paymentId: _,
    subscriptionId: __,
    subscriptionItemId: ___,
    ...restTeamMetadata
  } = teamMetadata || {};

  return {
    ...teamWithoutInviteTokens,
    ...(teamWithoutInviteTokens.logoUrl ? { logo: teamWithoutInviteTokens.logoUrl } : {}),
    /** To prevent breaking we only return non-email attached token here, if we have one */
    inviteToken: inviteTokens.find(
      (token) =>
        token.identifier === `invite-link-for-teamId-${teamOrOrg.id}` &&
        token.expires > new Date(new Date().setHours(24))
    ),
    metadata: restTeamMetadata,
    bookingLimits: parseBookingLimit(teamOrOrg.bookingLimits),
  };
}

export async function isTeamOwner(userId: number, teamId: number) {
  return !!(await prisma.membership.findFirst({
    where: {
      userId,
      teamId,
      accepted: true,
      role: "OWNER",
    },
  }));
}

export async function isTeamMember(userId: number, teamId: number) {
  return !!(await prisma.membership.findFirst({
    where: {
      userId,
      teamId,
      accepted: true,
    },
  }));
}

/**
 * AG-002: Retrieves team members eligible for scheduling in round-robin or collective event types.
 *
 * For both round-robin and collective scheduling, all accepted members are eligible.
 * The distinction between scheduling types is handled by the downstream scheduling infrastructure:
 * - Round-robin: one eligible member is selected per booking (rotation-based)
 * - Collective: all eligible members must be available simultaneously
 *
 * @param teamId - The team to query members for
 * @param schedulingType - Optional scheduling type context for future filtering extensions
 * @returns Array of scheduling-eligible members with minimal fields for distribution decisions
 */
export async function getSchedulingEligibleMembers({
  teamId,
  schedulingType: _schedulingType,
}: {
  teamId: number;
  schedulingType?: SchedulingType;
}): Promise<SchedulingEligibleMember[]> {
  const memberships = await prisma.membership.findMany({
    where: {
      teamId,
      accepted: true,
    },
    select: {
      userId: true,
      role: true,
      createdAt: true,
    },
    orderBy: {
      createdAt: "asc",
    },
  });

  return memberships.map((m) => ({
    userId: m.userId,
    role: m.role as MembershipRole,
    createdAt: m.createdAt,
  }));
}

/**
 * AG-002: Filters team members by specific membership roles.
 *
 * Useful for role-based team event routing decisions, such as determining
 * which members have admin or owner privileges for managed event type governance.
 *
 * @param teamId - The team to query members for
 * @param roles - Array of MembershipRole values to filter by (MEMBER, ADMIN, OWNER)
 * @returns Array of members matching the specified roles
 */
export async function getTeamMembersByRole({
  teamId,
  roles,
}: {
  teamId: number;
  roles: MembershipRole[];
}): Promise<{ userId: number; role: MembershipRole; accepted: boolean }[]> {
  const memberships = await prisma.membership.findMany({
    where: {
      teamId,
      role: {
        in: roles,
      },
    },
    select: {
      userId: true,
      role: true,
      accepted: true,
    },
  });

  return memberships.map((m) => ({
    userId: m.userId,
    role: m.role as MembershipRole,
    accepted: m.accepted,
  }));
}

// Type derived from the actual query result to ensure type safety at call sites
type EventTypeForChildCreation = Awaited<ReturnType<typeof getEventTypesToAddNewMembers>>[number];

export function generateNewChildEventTypeDataForDB({
  eventType,
  userId,
  includeWorkflow = true,
  includeUserConnect = true,
  pushSettings,
}: {
  eventType: EventTypeForChildCreation;
  userId: number;
  includeWorkflow?: boolean;
  includeUserConnect?: boolean;
  /** AG-003: Optional managed event push settings controlling which fields propagate from admin templates */
  pushSettings?: ManagedEventPushSettings;
}) {
  const allManagedEventTypePropsZod = EventTypeSchema.pick(allManagedEventTypePropsForZod).extend({
    bookingFields: EventTypeSchema.shape.bookingFields.nullish(),
    locations: z
      .preprocess((val: unknown) => (val === null ? undefined : val), eventTypeLocations)
      .optional(),
  });

  const managedEventTypeValues = allManagedEventTypePropsZod
    .omit(unlockedManagedEventTypePropsForZod)
    .parse(eventType);

  // Define the values for unlocked properties to use on creation, not updation
  const unlockedEventTypeValues = allManagedEventTypePropsZod
    .pick(unlockedManagedEventTypePropsForZod)
    .parse(eventType);

  // Calculate if there are new workflows for which assigned members will get too
  const currentWorkflowIds = Array.isArray(eventType.workflows)
    ? eventType.workflows.map((wf) => wf.workflowId)
    : [];

  // AG-003: Build push settings overrides for managed event type field inheritance.
  // When pushSettings is provided, selectively strip fields that should NOT propagate
  // from the admin template to child instances. If a field's inherit flag is false,
  // the child event type will use its own default rather than the parent's value.
  const pushOverrides: Record<string, undefined> = {};
  if (pushSettings) {
    if (pushSettings.inheritSchedule === false) {
      pushOverrides.scheduleId = undefined;
    }
    if (pushSettings.inheritBufferTime === false) {
      pushOverrides.beforeEventBuffer = undefined;
      pushOverrides.afterEventBuffer = undefined;
    }
    if (pushSettings.inheritMinNotice === false) {
      pushOverrides.minimumBookingNotice = undefined;
    }
  }

  return {
    ...managedEventTypeValues,
    ...unlockedEventTypeValues,
    bookingLimits: (managedEventTypeValues.bookingLimits as unknown as Prisma.InputJsonObject) ?? undefined,
    recurringEvent: (managedEventTypeValues.recurringEvent as unknown as Prisma.InputJsonValue) ?? undefined,
    metadata: (managedEventTypeValues.metadata as Prisma.InputJsonValue) ?? undefined,
    bookingFields: (managedEventTypeValues.bookingFields as Prisma.InputJsonValue) ?? undefined,
    durationLimits: (managedEventTypeValues.durationLimits as Prisma.InputJsonValue) ?? undefined,
    eventTypeColor: (managedEventTypeValues.eventTypeColor as Prisma.InputJsonValue) ?? undefined,
    rrSegmentQueryValue: undefined,
    onlyShowFirstAvailableSlot: managedEventTypeValues.onlyShowFirstAvailableSlot ?? false,
    userId,
    ...(includeUserConnect && {
      users: {
        connect: [{ id: userId }],
      },
    }),
    parentId: eventType.id,
    hidden: false,
    ...(includeWorkflow && {
      workflows: currentWorkflowIds && {
        create: currentWorkflowIds.map((wfId) => ({ workflowId: wfId })),
      },
    }),
    // AG-003: Apply push settings overrides — fields set to undefined will use child defaults
    ...pushOverrides,
  };
}

async function getEventTypesToAddNewMembers(teamId: number) {
  return await prisma.eventType.findMany({
    where: {
      team: { id: teamId },
      assignAllTeamMembers: true,
    },
    select: {
      ...allManagedEventTypeProps,
      id: true,
      schedulingType: true,
    },
  });
}

export async function updateNewTeamMemberEventTypes(
  userId: number,
  teamId: number,
  /** AG-003: Optional push configuration controlling which fields propagate from admin templates */
  pushConfig?: ManagedEventPushSettings
) {
  const eventTypesToAdd = await getEventTypesToAddNewMembers(teamId);

  if (eventTypesToAdd.length > 0) {
    await prisma.$transaction(
      eventTypesToAdd.map((eventType) => {
        if (eventType.schedulingType === "MANAGED") {
          return prisma.eventType.create({
            data: generateNewChildEventTypeDataForDB({
              eventType,
              userId,
              // AG-003: Pass push settings to control field inheritance for managed event type push
              pushSettings: pushConfig,
            }),
          });
        } else {
          return prisma.eventType.update({
            where: { id: eventType.id },
            data: { hosts: { create: [{ userId, isFixed: eventType.schedulingType === "COLLECTIVE" }] } },
          });
        }
      })
    );
  }
}

export async function addNewMembersToEventTypes({
  userIds,
  teamId,
  pushConfig,
}: {
  userIds: number[];
  teamId: number;
  /** AG-003: Optional push configuration controlling which fields propagate from admin templates */
  pushConfig?: ManagedEventPushSettings;
}) {
  const log = logger.getSubLogger({
    prefix: ["addNewMembersToEventTypes"],
  });

  const eventTypesToAdd = await getEventTypesToAddNewMembers(teamId);

  const managedEventTypes = eventTypesToAdd.filter((eventType) => eventType.schedulingType === "MANAGED");
  const teamEventTypes = eventTypesToAdd.filter((eventType) => eventType.schedulingType !== "MANAGED");

  await Promise.allSettled([
    prisma.eventType
      .createMany({
        data: managedEventTypes
          .map((eventType) =>
            userIds.map((userId) =>
              generateNewChildEventTypeDataForDB({
                eventType,
                userId,
                includeWorkflow: false,
                includeUserConnect: false,
                // AG-003: Pass push settings to control field inheritance for managed event type push
                pushSettings: pushConfig,
              })
            )
          )
          .flat(),
        skipDuplicates: true,
      })
      .catch((error) => {
        log.error(
          `Failed to add new members to managed event types`,
          safeStringify({
            teamId,
            error,
          })
        );
      }),
    prisma.host
      .createMany({
        data: teamEventTypes
          .map((eventType) => {
            return userIds.map((userId) => {
              return {
                userId,
                eventTypeId: eventType.id,
                isFixed: eventType.schedulingType === "COLLECTIVE",
              };
            });
          })
          .flat(),
        skipDuplicates: true,
      })
      .catch((error) => {
        log.error(
          `Failed to add new members as hosts`,
          safeStringify({
            teamId,
            error,
          })
        );
      }),
  ]);

  // Connect to users and workflows
  const createdChildrenEventTypes = await prisma.eventType.findMany({
    where: {
      userId: {
        in: userIds,
      },
      parent: {
        id: {
          in: managedEventTypes.map((eventType) => eventType.id),
        },
      },
    },
    select: {
      id: true,
      userId: true,
      workflows: {
        select: {
          id: true,
        },
      },
    },
  });

  if (createdChildrenEventTypes.length > 0) {
    await Promise.allSettled([
      prisma.workflowsOnEventTypes
        .createMany({
          data: createdChildrenEventTypes
            .map((eventType) =>
              eventType.workflows.map((workflow) => ({
                eventTypeId: eventType.id,
                workflowId: workflow.id,
              }))
            )
            .flat(),
          skipDuplicates: true,
        })
        .catch((error) => {
          log.error(
            `Failed to connect new children event types to workflows`,
            safeStringify({
              teamId,
              error,
            })
          );
        }),
    ]);
    // Connect children event types to users
    for (let i = 0; i < createdChildrenEventTypes.length; i += DATABASE_CHUNK_SIZE) {
      const childrenEventTypeBatch = createdChildrenEventTypes.slice(i, i + DATABASE_CHUNK_SIZE);

      await Promise.allSettled([
        childrenEventTypeBatch.map((childEventType) => {
          if (!childEventType.userId) return;
          return prisma.eventType
            .update({
              where: {
                id: childEventType.id,
              },
              data: {
                users: {
                  connect: [{ id: childEventType.userId }],
                },
              },
            })
            .catch((error) => {
              log.error(
                `Failed to connect new children event types to users`,
                safeStringify({
                  teamId,
                  childEventTypeId: childEventType.id,
                  userId: childEventType.userId,
                  error,
                })
              );
            });
        }),
      ]);
    }
  }
}

/**
 * AG-002: Determines the next team member to assign in a round-robin scheduling rotation.
 *
 * The assignment algorithm queries the most recent booking assignments across the team's
 * round-robin event types and selects the eligible member who was least recently assigned.
 * If no booking history exists (e.g., new team), falls back to the first eligible member
 * by creation order to ensure deterministic initial distribution.
 *
 * This provides Calendly-compatible round-robin distribution where each team member
 * receives bookings in a fair rotation sequence.
 *
 * @param teamId - The team whose event types to check for booking history
 * @param eligibleMemberIds - Array of user IDs eligible for the next assignment
 * @param rrTimestampBasis - Optional timestamp basis for rotation tracking (defaults to booking creation time)
 * @returns The next member to assign, or null if no eligible members exist
 */
export async function getNextRoundRobinAssignee({
  teamId,
  eligibleMemberIds,
  rrTimestampBasis: _rrTimestampBasis,
}: {
  teamId: number;
  eligibleMemberIds: number[];
  rrTimestampBasis?: string;
}): Promise<RoundRobinAssignment | null> {
  const log = logger.getSubLogger({ prefix: ["getNextRoundRobinAssignee"] });

  if (eligibleMemberIds.length === 0) {
    return null;
  }

  try {
    // Fetch the team's round-robin event type IDs to scope the booking history query
    const teamEventTypes = await prisma.eventType.findMany({
      where: {
        teamId,
        schedulingType: SchedulingType.ROUND_ROBIN,
      },
      select: {
        id: true,
      },
    });

    const eventTypeIds = teamEventTypes.map((et) => et.id);

    if (eventTypeIds.length === 0) {
      // No round-robin event types configured — return the first eligible member by default
      return { userId: eligibleMemberIds[0] };
    }

    // Query the most recent booking per eligible member across round-robin event types.
    // Members with no recent bookings are prioritized (least recently assigned).
    const recentBookings = await prisma.booking.findMany({
      where: {
        eventTypeId: {
          in: eventTypeIds,
        },
        userId: {
          in: eligibleMemberIds,
        },
        status: {
          not: "CANCELLED",
        },
      },
      select: {
        userId: true,
        createdAt: true,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    // Build a map of userId -> most recent booking timestamp
    const lastAssignedMap = new Map<number, Date>();
    for (const booking of recentBookings) {
      if (booking.userId !== null && !lastAssignedMap.has(booking.userId)) {
        lastAssignedMap.set(booking.userId, booking.createdAt);
      }
    }

    // Find eligible members with NO booking history (they get priority)
    const unassignedMembers = eligibleMemberIds.filter((id) => !lastAssignedMap.has(id));
    if (unassignedMembers.length > 0) {
      return { userId: unassignedMembers[0] };
    }

    // All members have history — select the one least recently assigned
    let leastRecentUserId = eligibleMemberIds[0];
    let leastRecentTime = lastAssignedMap.get(eligibleMemberIds[0]) ?? new Date();

    for (const memberId of eligibleMemberIds) {
      const lastTime = lastAssignedMap.get(memberId);
      if (lastTime && lastTime < leastRecentTime) {
        leastRecentTime = lastTime;
        leastRecentUserId = memberId;
      }
    }

    return { userId: leastRecentUserId };
  } catch (error) {
    log.error(
      "Failed to determine next round-robin assignee",
      safeStringify({ teamId, eligibleMemberIds, error })
    );
    // Graceful fallback: return the first eligible member to avoid blocking the booking flow
    return eligibleMemberIds.length > 0 ? { userId: eligibleMemberIds[0] } : null;
  }
}

/**
 * AG-002: Resolves the member set required for collective scheduling availability.
 *
 * In collective scheduling, ALL specified members must be simultaneously available
 * for a booking slot to be offered. This lightweight helper packages the member set
 * with the scheduling type marker for downstream availability computation.
 *
 * The actual availability intersection computation is handled by the existing
 * scheduling infrastructure in `packages/features/schedules/` — this function
 * provides the member resolution layer that feeds into it.
 *
 * @param teamId - The team context for collective scheduling (used for logging/tracing)
 * @param memberIds - Array of user IDs that must all be available for collective slots
 * @returns Object containing the member set and scheduling type marker
 */
export function resolveCollectiveAvailability({
  teamId: _teamId,
  memberIds,
}: {
  teamId: number;
  memberIds: number[];
}): { memberIds: number[]; schedulingType: "COLLECTIVE" } {
  return {
    memberIds,
    schedulingType: "COLLECTIVE" as const,
  };
}
