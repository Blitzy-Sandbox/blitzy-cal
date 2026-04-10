import { TeamService } from "@calcom/features/ee/teams/services/teamService";
import { rejectTeamInvitation } from "@calcom/features/ee/teams/lib/inviteMemberUtils";
import { prisma } from "@calcom/prisma";
import type { TrpcSessionUser } from "@calcom/trpc/server/types";

import type { TAcceptOrLeaveInputSchema } from "./acceptOrLeave.schema";

type AcceptOrLeaveOptions = {
  ctx: {
    user: NonNullable<TrpcSessionUser>;
  };
  input: TAcceptOrLeaveInputSchema;
};

export const acceptOrLeaveHandler = async ({ ctx, input }: AcceptOrLeaveOptions) => {
  if (input.accept) {
    await TeamService.acceptTeamMembership({
      userId: ctx.user.id,
      teamId: input.teamId,
      userEmail: ctx.user.email,
      username: ctx.user.username,
    });
  } else {
    // AG-004: Check if the membership is pending (not yet accepted). If so, use
    // rejectTeamInvitation to set declinedAt for audit trail rather than deleting.
    const membership = await prisma.membership.findUnique({
      where: { userId_teamId: { userId: ctx.user.id, teamId: input.teamId } },
      select: { accepted: true },
    });

    if (membership && !membership.accepted) {
      // Pending invitation — decline with audit trail (sets declinedAt timestamp)
      await rejectTeamInvitation({
        userId: ctx.user.id,
        teamId: input.teamId,
      });
    } else {
      // Already-accepted membership — leave as before (deletes the membership record)
      await TeamService.leaveTeamMembership({
        userId: ctx.user.id,
        teamId: input.teamId,
      });
    }
  }
};

export default acceptOrLeaveHandler;
