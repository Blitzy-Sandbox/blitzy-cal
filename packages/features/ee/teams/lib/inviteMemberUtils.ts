import { randomBytes } from "node:crypto";
import { getOrgFullOrigin } from "@calcom/ee/organizations/lib/orgDomains";
import { sendTeamInviteEmail } from "@calcom/emails/organization-email-service";
import { checkAdminOrOwner } from "@calcom/features/auth/lib/checkAdminOrOwner";
import { SeatChangeTrackingService } from "@calcom/features/ee/billing/service/seatTracking/SeatChangeTrackingService";
import { OnboardingPathService } from "@calcom/features/onboarding/lib/onboarding-path.service";
import { WEBAPP_URL } from "@calcom/lib/constants";
import logger from "@calcom/lib/logger";
import { safeStringify } from "@calcom/lib/safeStringify";
import { prisma } from "@calcom/prisma";
import type {
  Membership,
  Profile as ProfileType,
  UserPassword,
  User as UserType,
} from "@calcom/prisma/client";
import { Prisma } from "@calcom/prisma/client";
import { MembershipRole } from "@calcom/prisma/enums";
import { teamMetadataSchema } from "@calcom/prisma/zod-utils";
import { TRPCError } from "@trpc/server";
import type { TFunction } from "i18next";

const log = logger.getSubLogger({ prefix: ["inviteMember.utils"] });

const isEmail = (str: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str);

export type Invitee = Pick<
  UserType,
  "id" | "email" | "username" | "identityProvider" | "completedOnboarding"
>;

export type UserWithMembership = Invitee & {
  teams?: Pick<Membership, "userId" | "teamId" | "accepted" | "role">[];
  profiles: ProfileType[];
  password: UserPassword | null;
};

type InvitableExistingUser = UserWithMembership & {
  newRole: MembershipRole;
};

type InvitableExistingUserWithProfile = InvitableExistingUser & {
  profile: {
    username: string;
  } | null;
};

/**
 * Represents the lifecycle state of a team/org invitation.
 * Aligns with Calendly's explicit pending → accepted/rejected state transitions (AG-004).
 */
export type InvitationState = "PENDING" | "ACCEPTED" | "REJECTED" | "EXPIRED";

/**
 * Records a state transition in the invitation lifecycle for audit trail purposes.
 * Used by downstream MembershipRepository and MembershipService for tracking invitation history.
 */
export interface InvitationStateTransition {
  /** The state the invitation is transitioning from */
  fromState: InvitationState;
  /** The state the invitation is transitioning to */
  toState: InvitationState;
  /** When the transition occurred */
  timestamp: Date;
  /** The user who triggered the transition (e.g., the invitee accepting/rejecting) */
  userId?: number;
}

export async function getTeamOrThrow(teamId: number) {
  const team = await prisma.team.findUnique({
    where: {
      id: teamId,
    },
    include: {
      organizationSettings: true,
      parent: {
        include: {
          organizationSettings: true,
        },
      },
    },
  });

  if (!team)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: `Team not found`,
    });

  return { ...team, metadata: teamMetadataSchema.parse(team.metadata) };
}

/**
 * Creates a verification token for team/org invitation email links.
 * @param identifier - The email address of the invitee
 * @param teamId - The team to associate the token with
 * @param expiryDays - Number of days until the token expires (default: 7, preserving original behavior)
 */
const createVerificationToken = async (identifier: string, teamId: number, expiryDays = 7) => {
  const token = randomBytes(32).toString("hex");
  return prisma.verificationToken.create({
    data: {
      identifier,
      token,
      expires: new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000),
      expiresInDays: expiryDays,
      team: {
        connect: {
          id: teamId,
        },
      },
    },
  });
};

export async function sendSignupToOrganizationEmail({
  usernameOrEmail,
  team,
  translation,
  inviterName,
  teamId,
  isOrg,
  role,
}: {
  usernameOrEmail: string;
  team: { name: string; parent: { name: string } | null };
  translation: TFunction;
  inviterName: string;
  teamId: number;
  isOrg: boolean;
  /** Optional role being assigned to the invitee — used for audit logging and future email template integration (NF-001) */
  role?: MembershipRole;
}) {
  try {
    if (role) {
      log.debug("Sending signup invitation with role context", safeStringify({ usernameOrEmail, teamId, role }));
    }
    const verificationToken = await createVerificationToken(usernameOrEmail, teamId);
    const gettingStartedPath = await OnboardingPathService.getGettingStartedPathWhenInvited();
    await sendTeamInviteEmail({
      language: translation,
      from: inviterName || `${team.name}'s admin`,
      to: usernameOrEmail,
      teamName: team.name,
      joinLink: `${WEBAPP_URL}/signup?token=${verificationToken.token}&callbackUrl=${gettingStartedPath}`,
      isCalcomMember: false,
      isOrg: isOrg,
      parentTeamName: team?.parent?.name,
      isAutoJoin: false,
      isExistingUserMovedToOrg: false,
      // For a new user there is no prev and new links.
      prevLink: null,
      newLink: null,
    });
  } catch (error) {
    log.error(
      "Failed to send signup to organization email",
      safeStringify({
        usernameOrEmail,
        orgId: teamId,
        role,
      }),
      error
    );
  }
}

export const sendEmails = async (emailPromises: Promise<void>[]) => {
  const sentEmails = await Promise.allSettled(emailPromises);
  sentEmails.forEach((sentEmail) => {
    if (sentEmail.status === "rejected") {
      log.error("Could not send email to user. Reason:", sentEmail.reason);
    }
  });
};

export const sendExistingUserTeamInviteEmails = async ({
  existingUsersWithMemberships,
  language,
  currentUserTeamName,
  currentUserName,
  currentUserParentTeamName,
  isOrg,
  teamId,
  isAutoJoin,
  orgSlug,
  memberRole,
}: {
  language: TFunction;
  isAutoJoin: boolean;
  existingUsersWithMemberships: Omit<InvitableExistingUserWithProfile, "canBeInvited" | "newRole">[];
  currentUserTeamName?: string;
  currentUserParentTeamName: string | undefined;
  currentUserName?: string | null;
  isOrg: boolean;
  teamId: number;
  orgSlug: string | null;
  /** Optional role context for the invitation — passed to email templates for display (AG-004) */
  memberRole?: MembershipRole;
}) => {
  const sendEmailsPromises = existingUsersWithMemberships.map(async (user) => {
    let sendTo = user.email;
    if (!isEmail(user.email)) {
      sendTo = user.email;
    }

    log.debug(
      "Sending team invite email to",
      safeStringify({ user, currentUserName, currentUserTeamName, memberRole })
    );

    if (!currentUserTeamName) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "The team doesn't have a name",
      });
    }

    // inform user of membership by email
    if (currentUserTeamName) {
      const inviteTeamOptions: {
        joinLink: string;
        declineLink?: string;
        isCalcomMember: boolean;
      } = {
        joinLink: `${WEBAPP_URL}/auth/login?callbackUrl=/settings/teams`,
        isCalcomMember: true,
      };
      /**
       * Here we want to redirect to a different place if onboarding has been completed or not. This prevents the flash of going to teams -> Then to onboarding - also show a different email template.
       * This only changes if the user is a CAL user and has not completed onboarding and has no password
       */
      if (!user.completedOnboarding && !user.password?.hash && user.identityProvider === "CAL") {
        const verificationToken = await createVerificationToken(user.email, teamId);

        const gettingStartedPath = await OnboardingPathService.getGettingStartedPathWhenInvited();
        inviteTeamOptions.joinLink = `${WEBAPP_URL}/signup?token=${verificationToken.token}&callbackUrl=${gettingStartedPath}`;
        inviteTeamOptions.isCalcomMember = false;
        // AG-004: Build decline link for not-onboarded users via public endpoint (no login required)
        inviteTeamOptions.declineLink = `${WEBAPP_URL}/api/auth/teams/decline?token=${verificationToken.token}`;
      } else if (!isAutoJoin) {
        let verificationToken = await prisma.verificationToken.findFirst({
          where: {
            identifier: user.email,
            teamId: teamId,
          },
        });

        if (!verificationToken) {
          verificationToken = await createVerificationToken(user.email, teamId);
        }
        inviteTeamOptions.joinLink = `${WEBAPP_URL}/teams?token=${verificationToken.token}&autoAccept=true`;
        // AG-004: Build decline link via public endpoint (no login required)
        inviteTeamOptions.declineLink = `${WEBAPP_URL}/api/auth/teams/decline?token=${verificationToken.token}`;
      }

      return sendTeamInviteEmail({
        language,
        isAutoJoin,
        from: currentUserName ?? `${currentUserTeamName}'s admin`,
        to: sendTo,
        teamName: currentUserTeamName,
        ...inviteTeamOptions,
        isOrg: isOrg,
        parentTeamName: currentUserParentTeamName,
        isExistingUserMovedToOrg: true,
        prevLink: `${getOrgFullOrigin("")}/${user.username || ""}`,
        newLink: user.profile ? `${getOrgFullOrigin(orgSlug ?? "")}/${user.profile.username}` : null,
      });
    }
  });

  await sendEmails(sendEmailsPromises);
};

export async function createMemberships({
  teamId,
  language,
  invitees,
  parentId,
  accepted,
  invitedByUserId,
}: {
  teamId: number;
  language: string;
  invitees: (UserWithMembership & {
    newRole: MembershipRole;
    needToCreateOrgMembership: boolean | null;
  })[];
  parentId: number | null;
  accepted: boolean;
  /** AG-004: The user ID of the person sending the invitation, for audit trail */
  invitedByUserId?: number;
}) {
  log.debug("Creating memberships for", safeStringify({ teamId, language, invitees, parentId, accepted, invitedByUserId }));
  try {
    const invitedAt = new Date();
    await prisma.membership.createMany({
      data: invitees.flatMap((invitee) => {
        const organizationRole = parentId
          ? invitee?.teams?.find((membership) => membership.teamId === parentId)?.role
          : undefined;
        const data = [];
        const createdAt = new Date();
        // membership for the team
        data.push({
          createdAt,
          teamId,
          userId: invitee.id,
          accepted,
          role: checkAdminOrOwner(organizationRole) ? organizationRole : invitee.newRole,
          // AG-004: Populate invitation tracking columns for audit trail
          ...(invitedByUserId !== undefined && { invitedByUserId }),
          invitedAt,
        });

        // membership for the org
        if (parentId && invitee.needToCreateOrgMembership) {
          data.push({
            createdAt,
            accepted,
            teamId: parentId,
            userId: invitee.id,
            role: MembershipRole.MEMBER,
            // AG-004: Populate invitation tracking columns for org membership too
            ...(invitedByUserId !== undefined && { invitedByUserId }),
            invitedAt,
          });
        }
        return data;
      }),
    });

    const seatTracker = new SeatChangeTrackingService();
    const teamSeatAdditions = parentId ? 0 : invitees.length;
    const organizationSeatAdditions = parentId
      ? invitees.filter((invitee) => invitee.needToCreateOrgMembership).length
      : 0;

    const trackingPromises: Promise<void>[] = [];
    if (teamSeatAdditions > 0) {
      trackingPromises.push(
        seatTracker.logSeatAddition({
          teamId,
          seatCount: teamSeatAdditions,
        })
      );
    }

    if (parentId && organizationSeatAdditions > 0) {
      trackingPromises.push(
        seatTracker.logSeatAddition({
          teamId: parentId,
          seatCount: organizationSeatAdditions,
        })
      );
    }

    await Promise.all(trackingPromises);
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      log.error("Failed to create memberships", teamId);
    } else {
      throw e;
    }
  }
}

/**
 * Checks whether a verification token has expired by comparing its `expires` timestamp to now.
 * @param tokenExpires - The expiration Date of the verification token
 * @returns true if the token's expiry is in the past
 */
function isInvitationExpired(tokenExpires: Date): boolean {
  return tokenExpires.getTime() < Date.now();
}

/**
 * Determines the current invitation state for a user within a team.
 *
 * State resolution logic (AG-004 — Calendly parity):
 *  - Membership exists & accepted → ACCEPTED
 *  - Membership exists & declined (declinedAt set) → REJECTED
 *  - Membership exists & not accepted, verification token not expired → PENDING
 *  - Membership exists & not accepted, verification token expired (or missing) → EXPIRED
 *  - No membership record → null (never invited)
 *
 * @param params.userId - The user whose invitation state to look up
 * @param params.teamId - The team to check membership against
 * @returns The current InvitationState, or null if no invitation exists
 */
export async function getInvitationState({
  userId,
  teamId,
}: {
  userId: number;
  teamId: number;
}): Promise<InvitationState | null> {
  const membership = await prisma.membership.findFirst({
    where: { userId, teamId },
    include: { user: { select: { email: true } } },
  });

  if (!membership) {
    return null;
  }

  // Already accepted
  if (membership.accepted) {
    return "ACCEPTED";
  }

  // Explicitly rejected (declinedAt is set via rejectTeamInvitation)
  if (membership.declinedAt) {
    return "REJECTED";
  }

  // Not yet accepted — check whether the invitation token is still valid
  const verificationToken = await prisma.verificationToken.findFirst({
    where: {
      identifier: membership.user.email,
      teamId,
    },
    orderBy: { createdAt: "desc" },
  });

  // If there is no token or the token has expired, the invitation is expired
  if (!verificationToken || isInvitationExpired(verificationToken.expires)) {
    return "EXPIRED";
  }

  return "PENDING";
}

/**
 * Rejects a pending team invitation for a user.
 *
 * This function implements the Calendly-equivalent "decline invitation" flow (AG-004):
 *  1. Finds the pending (not-yet-accepted) membership
 *  2. Marks it as declined (sets declinedAt timestamp)
 *  3. Cleans up associated verification tokens
 *  4. Does NOT trigger seat additions (only acceptance adds seats)
 *
 * @param params.userId - The user rejecting the invitation
 * @param params.teamId - The team whose invitation is being rejected
 * @returns Object with success flag and the resulting REJECTED state
 * @throws TRPCError NOT_FOUND if no pending invitation exists for this user/team pair
 */
export async function rejectTeamInvitation({
  userId,
  teamId,
}: {
  userId: number;
  teamId: number;
}): Promise<{ success: true; state: InvitationState }> {
  const pendingMembership = await prisma.membership.findFirst({
    where: {
      userId,
      teamId,
      accepted: false,
    },
    include: {
      user: { select: { email: true } },
    },
  });

  if (!pendingMembership) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "No pending invitation found for this user and team",
    });
  }

  log.debug(
    "Rejecting team invitation",
    safeStringify({ userId, teamId, email: pendingMembership.user.email })
  );

  // Mark the membership as declined rather than deleting, to preserve audit trail
  await prisma.membership.update({
    where: {
      userId_teamId: {
        userId,
        teamId,
      },
    },
    data: {
      declinedAt: new Date(),
    },
  });

  // Clean up associated verification tokens for this email+team pair
  await prisma.verificationToken.deleteMany({
    where: {
      identifier: pendingMembership.user.email,
      teamId,
    },
  });

  log.debug("Team invitation rejected successfully", safeStringify({ userId, teamId }));

  return { success: true, state: "REJECTED" as InvitationState };
}

/**
 * Sends a reminder email for a pending team/org invitation.
 *
 * Implements Calendly-equivalent invitation reminder capability (AG-004):
 *  - If the existing verification token is still valid, re-sends the invite email with the current join link
 *  - If the token has expired, generates a fresh token and sends a new invitation email
 *
 * @param params.email - The invitee's email address
 * @param params.teamId - The team the invitation belongs to
 * @param params.teamName - Display name of the team for the email template
 * @param params.inviterName - Display name of the person sending the reminder
 * @param params.translation - i18next translation function for email localization
 * @param params.isOrg - Whether this is an organization-level invitation
 * @param params.parentTeamName - The parent organization name (for sub-team invitations)
 */
export async function sendInvitationReminder({
  email,
  teamId,
  teamName,
  inviterName,
  translation,
  isOrg,
  parentTeamName,
}: {
  email: string;
  teamId: number;
  teamName: string;
  inviterName: string;
  translation: TFunction;
  isOrg: boolean;
  parentTeamName?: string | null;
}): Promise<void> {
  log.debug("Sending invitation reminder", safeStringify({ email, teamId, teamName }));

  // Look up the most recent verification token for this email + team
  let verificationToken = await prisma.verificationToken.findFirst({
    where: {
      identifier: email,
      teamId,
    },
    orderBy: { createdAt: "desc" },
  });

  // If the token is missing or expired, create a fresh one
  if (!verificationToken || isInvitationExpired(verificationToken.expires)) {
    log.debug("Existing token expired or missing, creating fresh token", safeStringify({ email, teamId }));

    // Clean up any expired tokens for this email+team pair
    await prisma.verificationToken.deleteMany({
      where: {
        identifier: email,
        teamId,
      },
    });

    verificationToken = await createVerificationToken(email, teamId);
  }

  // Construct the join and decline links (same pattern as sendExistingUserTeamInviteEmails)
  const joinLink = `${WEBAPP_URL}/teams?token=${verificationToken.token}&autoAccept=true`;
  // AG-004: Build decline link via public endpoint (no login required)
  const declineLink = `${WEBAPP_URL}/api/auth/teams/decline?token=${verificationToken.token}`;

  try {
    await sendTeamInviteEmail({
      language: translation,
      from: inviterName || `${teamName}'s admin`,
      to: email,
      teamName,
      joinLink,
      declineLink,
      isCalcomMember: true,
      isOrg,
      parentTeamName: parentTeamName ?? undefined,
      isAutoJoin: false,
      isExistingUserMovedToOrg: false,
      prevLink: null,
      newLink: null,
    });

    log.debug("Invitation reminder sent successfully", safeStringify({ email, teamId }));
  } catch (error) {
    log.error(
      "Failed to send invitation reminder email",
      safeStringify({ email, teamId }),
      error
    );
  }
}
