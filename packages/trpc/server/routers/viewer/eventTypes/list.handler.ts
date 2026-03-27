import { checkRateLimitAndThrowError } from "@calcom/lib/checkRateLimitAndThrowError";
import { prisma } from "@calcom/prisma";

import type { TrpcSessionUser } from "../../../types";

type ListOptions = {
  ctx: {
    user: NonNullable<TrpcSessionUser>;
  };
};

/**
 * Lists the current user's personal (non-team) event types with paradigm metadata.
 *
 * The `schedulingType` field identifies the scheduling paradigm:
 * - `null` → one-on-one (1:1) event
 * - `ROUND_ROBIN` → round-robin distribution across hosts
 * - `COLLECTIVE` → collective scheduling requiring all hosts available
 * - `MANAGED` → admin-managed template event type
 *
 * Additional paradigm metadata fields:
 * - `seatsPerTimeSlot` (number | null) — When non-null, identifies a group/seated
 *   event type where multiple attendees may book the same slot (ET-002).
 * - `assignAllTeamMembers` (boolean) — When true, all team members are automatically
 *   assigned as hosts, relevant for collective auto-assign events (ET-004).
 * - `isRRWeightsEnabled` (boolean) — When true, host weights are used for equitable
 *   round-robin distribution instead of simple rotation (ET-003).
 *
 * These fields are ADDITIVE — the existing return shape is fully preserved with
 * additional paradigm metadata appended.
 */
export const listHandler = async ({ ctx }: ListOptions) => {
  await checkRateLimitAndThrowError({
    identifier: `eventTypes:list:${ctx.user.id}`,
    rateLimitingType: "common",
  });
  return await prisma.eventType.findMany({
    where: {
      userId: ctx.user.id,
      team: null,
    },
    select: {
      id: true,
      title: true,
      description: true,
      length: true,
      schedulingType: true,
      slug: true,
      hidden: true,
      metadata: true,
      seatsPerTimeSlot: true,
      assignAllTeamMembers: true,
      isRRWeightsEnabled: true,
    },
  });
};
