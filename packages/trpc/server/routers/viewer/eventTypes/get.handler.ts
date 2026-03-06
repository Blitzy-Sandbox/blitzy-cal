/**
 * Handler for the `viewer.eventTypes.get` tRPC query.
 *
 * Fetches a single event type by ID for the authenticated viewer, delegating all
 * enrichment to {@link getEventTypeById} from `@calcom/features/eventtypes/lib/getEventTypeById`.
 *
 * @module viewer.eventTypes.get.handler
 */
import getEventTypeById from "@calcom/features/eventtypes/lib/getEventTypeById";
import type { PrismaClient } from "@calcom/prisma";

import type { TrpcSessionUser } from "../../../types";
import type { TGetInputSchema } from "./get.schema";

type GetOptions = {
  ctx: {
    user: NonNullable<TrpcSessionUser>;
    prisma: PrismaClient;
  };
  input: TGetInputSchema;
};

/**
 * Retrieves a single event type by ID for the authenticated viewer.
 *
 * This handler is a thin pass-through that delegates entirely to
 * {@link getEventTypeById}. All enrichment logic — including metadata parsing,
 * booking field assembly, host enrichment, location configuration, team membership
 * resolution, and children event type loading — is performed by `getEventTypeById`.
 *
 * ## Paradigm Support
 *
 * The returned data supports ALL six Cal.com scheduling paradigms:
 *
 * - **1:1 (ET-001):** `schedulingType` is `null` — single host paired with a single invitee.
 * - **Group (ET-002):** `seatsPerTimeSlot > 0` — multiple attendees can book the same time slot
 *   up to the configured seat limit.
 * - **Round-Robin (ET-003):** `schedulingType === "ROUND_ROBIN"` — equitable host distribution
 *   with configurable weights (`isRRWeightsEnabled`), priority, and segment-based filtering
 *   (`rrSegmentQueryValue`).
 * - **Collective (ET-004):** `schedulingType === "COLLECTIVE"` — requires all fixed hosts to be
 *   simultaneously available before a slot is offered.
 * - **Managed:** `schedulingType === "MANAGED"` — admin-owned template that propagates
 *   configuration to children event types across team members.
 * - **Dynamic:** Multi-host ad-hoc link — note that dynamic event types are typically resolved
 *   via `getPublicEvent.ts` rather than this handler.
 *
 * ## Cross-Agent Coordination (Sprint 2)
 *
 * The upstream `getEventTypeById` function in
 * `@calcom/features/eventtypes/lib/getEventTypeById.ts` is being hardened for
 * paradigm-specific enrichment as part of Sprint 2 epics ET-001 through ET-004.
 * This handler requires no structural changes — it inherits all enrichment
 * improvements automatically through delegation.
 *
 * @param options - Destructured handler options.
 * @param options.ctx - tRPC context containing the authenticated session.
 * @param options.ctx.user - The authenticated viewer (non-nullable `TrpcSessionUser`).
 * @param options.ctx.prisma - Prisma client instance from the tRPC context.
 * @param options.input - Validated input conforming to `TGetInputSchema` (`{ id: number }`).
 *
 * @returns The enriched event type data from `getEventTypeById`, including:
 *   - `currentOrganizationId` — derived from `ctx.user.profile?.organizationId`, used for
 *     org-scoped event type resolution.
 *   - `eventTypeId` — the target event type ID from `input.id`.
 *   - `userId` — the current viewer's user ID, used for authorization checks.
 *   - `prisma` — the Prisma client instance for database queries.
 *   - `isTrpcCall: true` — signals this call originates from a tRPC route, which may
 *     affect enrichment behavior (e.g., additional fields included in the response).
 *   - `isUserOrganizationAdmin` — whether the current user holds org admin privileges,
 *     derived from `ctx.user.organization?.isOrgAdmin`.
 *   - `userLocale` — the viewer's locale preference for i18n-aware field formatting.
 */
export const getHandler = ({ ctx, input }: GetOptions) => {
  return getEventTypeById({
    currentOrganizationId: ctx.user.profile?.organizationId ?? null,
    eventTypeId: input.id,
    userId: ctx.user.id,
    prisma: ctx.prisma,
    isTrpcCall: true,
    isUserOrganizationAdmin: !!ctx.user?.organization?.isOrgAdmin,
    userLocale: ctx.user.locale,
  });
};
