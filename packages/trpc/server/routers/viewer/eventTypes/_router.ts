/**
 * @module eventTypesRouter
 *
 * Viewer-scoped event type tRPC router — the primary API surface for event type
 * CRUD operations consumed by the Cal.com web UI.
 *
 * ## Sprint 2 — Paradigm Coverage (F-002)
 *
 * This router exposes procedures that span all six Cal.com scheduling paradigms:
 *   1. **One-on-One** (schedulingType = null) — default single-host / single-invitee
 *   2. **Group / Seated** (seatsPerTimeSlot > 0) — multiple attendees per slot
 *   3. **Round-Robin** (ROUND_ROBIN) — equitable host distribution with weights & priority
 *   4. **Collective** (COLLECTIVE) — all hosts must be simultaneously available
 *   5. **Managed** (MANAGED) — admin-defined templates propagated to team members
 *   6. **Dynamic** — ad-hoc links composed from multiple user slugs
 *
 * ### Paradigm-Relevant vs Paradigm-Agnostic Procedures
 *
 * | Procedure                    | Paradigm Relevance |
 * |------------------------------|--------------------|
 * | getByViewer                  | Relevant — accepts `schedulingTypes` filter |
 * | list                         | Relevant — returns `schedulingType` and paradigm metadata |
 * | listWithTeam                 | Relevant — enhanced with `schedulingType` awareness |
 * | get                          | Relevant — fully enriched for all 6 paradigms |
 * | getHostsWithLocationOptions  | Relevant — host data for RR / collective |
 * | massApplyHostLocation        | Relevant — team host location propagation |
 * | delete                       | Agnostic — works uniformly across all paradigms |
 * | getUserEventGroups           | Agnostic |
 * | getEventTypesFromGroup       | Agnostic |
 * | getActiveOnOptions           | Agnostic |
 * | bulkEventFetch               | Agnostic |
 * | bulkUpdateToDefaultLocation  | Agnostic |
 * | getHashedLink                | Agnostic |
 * | getHashedLinks               | Agnostic |
 *
 * ### Heavy Sub-Router (code-splitting)
 *
 * The `create`, `duplicate`, and `update` mutations live in the `heavy/` sub-router
 * (`./heavy/_router.ts`) and are composed at a higher level in the viewer router
 * tree. Those mutations handle paradigm-specific fields (schedulingType, seats,
 * RR weights, collective settings, booking fields, booking windows) and are
 * intentionally separated for bundle-size optimization.
 */
import { z } from "zod";

import { logP } from "@calcom/lib/perf";
import { MembershipRole } from "@calcom/prisma/enums";

import authedProcedure from "../../../procedures/authedProcedure";
import { router } from "../../../trpc";
import { ZDeleteInputSchema } from "./delete.schema";
import { ZGetActiveOnOptionsSchema } from "./getActiveOnOptions.schema";
import { ZEventTypeInputSchema, ZGetEventTypesFromGroupSchema } from "./getByViewer.schema";
import { ZGetHashedLinkInputSchema } from "./getHashedLink.schema";
import { ZGetHashedLinksInputSchema } from "./getHashedLinks.schema";
import { ZGetHostsWithLocationOptionsInputSchema } from "./getHostsWithLocationOptions.schema";
import { ZMassApplyHostLocationInputSchema } from "./massApplyHostLocation.schema";
import { get } from "./procedures/get";
import { createEventPbacProcedure } from "./util";

export const eventTypesRouter = router({
  // REVIEW: What should we name this procedure?
  /**
   * Returns event types visible to the authenticated viewer, with support for
   * paradigm-specific filtering via the `schedulingTypes` field in
   * {@link ZEventTypeInputSchema}. Results include paradigm metadata such as
   * `schedulingType`, enabling the UI to render paradigm-aware listings.
   *
   * @remarks Paradigm-relevant — accepts optional `schedulingTypes` filter to
   * narrow results to specific scheduling paradigms (e.g. ROUND_ROBIN only).
   */
  getByViewer: authedProcedure.input(ZEventTypeInputSchema).query(async ({ ctx, input }) => {
    const { getByViewerHandler } = await import("./getByViewer.handler");

    const timer = logP(`getByViewer(${ctx.user.id})`);

    const result = await getByViewerHandler({
      ctx,
      input,
    });

    timer();

    return result;
  }),
  getUserEventGroups: authedProcedure.input(ZEventTypeInputSchema).query(async ({ ctx, input }) => {
    const { getUserEventGroups } = await import("./getUserEventGroups.handler");

    const timer = logP(`getUserEventGroups(${ctx.user.id})`);

    const result = await getUserEventGroups({
      ctx,
      input,
    });

    timer();

    return result;
  }),

  getEventTypesFromGroup: authedProcedure
    .input(ZGetEventTypesFromGroupSchema)
    .query(async ({ ctx, input }) => {
      const { getEventTypesFromGroup } = await import("./getEventTypesFromGroup.handler");

      const timer = logP(`getEventTypesFromGroup(${ctx.user.id})`);

      const result = await getEventTypesFromGroup({
        ctx,
        input,
      });

      timer();

      return result;
    }),

  getActiveOnOptions: authedProcedure.input(ZGetActiveOnOptionsSchema).query(async ({ ctx, input }) => {
    const { getActiveOnOptions } = await import("./getActiveOnOptions.handler");

    const timer = logP(`getActiveOnOptions(${ctx.user.id})`);

    const result = await getActiveOnOptions({
      ctx,
      input,
    });

    timer();

    return result;
  }),

  /**
   * Lists event types for the authenticated user with paradigm-aware metadata.
   * The underlying Prisma select returns `schedulingType` along with
   * `seatsPerTimeSlot`, `assignAllTeamMembers`, and `isRRWeightsEnabled`,
   * giving consumers enough context to distinguish all six scheduling paradigms
   * without a full `get` call.
   *
   * @remarks Paradigm-relevant — returns paradigm metadata in the select projection.
   */
  list: authedProcedure.query(async ({ ctx }) => {
    const { listHandler } = await import("./list.handler");

    return listHandler({
      ctx,
    });
  }),

  /**
   * Lists event types from both personal and team scopes via a raw SQL UNION
   * query. The query is enhanced with `schedulingType` for paradigm awareness,
   * enabling the UI to render a unified, paradigm-annotated list across
   * individual and team-owned event types.
   *
   * @remarks Paradigm-relevant — raw SQL UNION enhanced with `schedulingType`.
   */
  listWithTeam: authedProcedure.query(async ({ ctx }) => {
    const { listWithTeamHandler } = await import("./listWithTeam.handler");

    return listWithTeamHandler({
      ctx,
    });
  }),

  /**
   * Retrieves a single event type by ID with fully enriched data for ALL six
   * scheduling paradigms. Delegates to {@link getEventTypeById} which assembles:
   *   - **Round-Robin:** host weights, priorities, `isRRWeightsEnabled`, segment query
   *   - **Group / Seated:** `seatsPerTimeSlot`, remaining seat counts
   *   - **Collective:** fixed-host list, `assignAllTeamMembers`
   *   - **Managed:** parent/child relationships, propagation metadata
   *   - **Booking Windows:** `periodType`, `periodDays`, date range, minimum notice
   *   - **Custom Fields:** `bookingFields` configuration for all question types
   *
   * @remarks Paradigm-relevant — the most complete paradigm-enriched procedure.
   * @see ./procedures/get
   */
  get,

  /**
   * Deletes an event type by ID. Protected via PBAC with `eventType.delete`
   * permission requiring ADMIN or OWNER membership role. This procedure is
   * paradigm-agnostic — it works uniformly for one-on-one, group, round-robin,
   * collective, managed, and dynamic event types.
   *
   * @remarks Paradigm-agnostic — deletion logic is identical across all paradigms.
   */
  delete: createEventPbacProcedure("eventType.delete", [MembershipRole.ADMIN, MembershipRole.OWNER])
    .input(ZDeleteInputSchema)
    .mutation(async ({ ctx, input }) => {
      const { deleteHandler } = await import("./delete.handler");

      return deleteHandler({
        ctx,
        input,
      });
    }),

  bulkEventFetch: authedProcedure.query(async ({ ctx }) => {
    const { bulkEventFetchHandler } = await import("./bulkEventFetch.handler");

    return bulkEventFetchHandler({
      ctx,
    });
  }),

  bulkUpdateToDefaultLocation: authedProcedure
    .input(
      z.object({
        eventTypeIds: z.array(z.number()),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { bulkUpdateToDefaultLocationHandler } = await import("./bulkUpdateToDefaultLocation.handler");

      return bulkUpdateToDefaultLocationHandler({
        ctx,
        input,
      });
    }),

  getHashedLink: authedProcedure.input(ZGetHashedLinkInputSchema).query(async ({ ctx, input }) => {
    const { getHashedLinkHandler } = await import("./getHashedLink.handler");

    return getHashedLinkHandler({
      ctx,
      input,
    });
  }),

  getHashedLinks: authedProcedure.input(ZGetHashedLinksInputSchema).query(async ({ ctx, input }) => {
    const { getHashedLinksHandler } = await import("./getHashedLinks.handler");

    return getHashedLinksHandler({
      ctx,
      input,
    });
  }),

  /**
   * Returns host data with associated location options for a team event type.
   * Used by the Round-Robin and Collective paradigms to display per-host
   * location configuration, and by the host editing UI to present available
   * location choices when configuring team scheduling.
   *
   * @remarks Paradigm-relevant — serves host configuration for RR and collective types.
   */
  getHostsWithLocationOptions: createEventPbacProcedure("eventType.update", [
    MembershipRole.ADMIN,
    MembershipRole.OWNER,
  ])
    .input(ZGetHostsWithLocationOptionsInputSchema)
    .query(async ({ ctx, input }) => {
      const { getHostsWithLocationOptionsHandler } = await import("./getHostsWithLocationOptions.handler");

      return getHostsWithLocationOptionsHandler({
        ctx,
        input,
      });
    }),

  /**
   * Applies a location setting across all hosts of a team event type in a
   * single operation. Paradigm-relevant for Round-Robin and Collective types
   * where multiple hosts share a common location configuration.
   *
   * @remarks Paradigm-relevant — bulk location propagation for team event hosts.
   */
  massApplyHostLocation: createEventPbacProcedure("eventType.update", [
    MembershipRole.ADMIN,
    MembershipRole.OWNER,
  ])
    .input(ZMassApplyHostLocationInputSchema)
    .mutation(async ({ ctx, input }) => {
      const { massApplyHostLocationHandler } = await import("./massApplyHostLocation.handler");

      return massApplyHostLocationHandler({
        ctx,
        input,
      });
    }),
});
