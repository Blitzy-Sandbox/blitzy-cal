import { prisma } from "@calcom/prisma";
import type { TrpcSessionUser } from "@calcom/trpc/server/types";

type ListInvitesOptions = {
  ctx: {
    user: NonNullable<TrpcSessionUser>;
  };
};

export const listInvitesHandler = async ({ ctx }: ListInvitesOptions) => {
  const userId = ctx.user.id;
  return await prisma.membership.findMany({
    where: {
      user: {
        id: userId,
      },
      accepted: false,
      // AG-004: Exclude declined invitations from the pending list.
      // Declined invitations have declinedAt set and should no longer appear as pending.
      declinedAt: null,
    },
  });
};

export default listInvitesHandler;
