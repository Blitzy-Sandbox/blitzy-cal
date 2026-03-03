import type { NextApiRequest, NextApiResponse } from "next";

import publicProcedure from "../../../procedures/publicProcedure";
import { router } from "../../../trpc";
import { ZIsAvailableInputSchema, ZIsAvailableOutputSchema } from "./isAvailable.schema";
import { ZRemoveSelectedSlotInputSchema } from "./removeSelectedSlot.schema";
import { ZReserveSlotInputSchema } from "./reserveSlot.schema";
import { ZGetScheduleInputSchema } from "./types";

/**
 * Cache type for lazily-imported slot route handlers.
 *
 * Each property holds a reference to a dynamically imported handler function.
 * By deferring the imports until the procedure is invoked, the router's initial
 * bundle stays lightweight — only the Zod schemas and tRPC wiring are loaded
 * eagerly. The `removeSelectedSlotMark` handler is intentionally excluded
 * because its logic is inlined directly in the router definition.
 */
type SlotsRouterHandlerCache = {
  getSchedule?: typeof import("./getSchedule.handler").getScheduleHandler;
  reserveSlot?: typeof import("./reserveSlot.handler").reserveSlotHandler;
  isAvailable?: typeof import("./isAvailable.handler").isAvailableHandler;
};

/**
 * Public-facing viewer slots tRPC router for slot availability, reservation,
 * and cleanup operations.
 *
 * All four procedures use `publicProcedure` (NOT `authedProcedure`) because
 * slot availability is displayed on the public booker page and must be
 * accessible without authentication.
 *
 * Procedures:
 * - `getSchedule`           — Query: returns date-keyed slot maps via DI-wired AvailableSlotsService
 * - `reserveSlot`           — Mutation: reserves a time slot by upserting SelectedSlots records
 * - `isAvailable`           — Query: checks slot availability with input AND output schema validation
 * - `removeSelectedSlotMark` — Mutation (inline): cleans up SelectedSlots by uid from cookies or input
 *
 * @see SlotsRouterHandlerCache for the lazy handler loading pattern used by the
 *   first three procedures.
 */
export const slotsRouter = router({
  /**
   * Query procedure that delegates to the DI-wired `AvailableSlotsService` via
   * `getScheduleHandler`. Input is validated by `ZGetScheduleInputSchema`
   * (defined in `./types.ts`). Returns date-keyed slot maps for the booker UI.
   */
  getSchedule: publicProcedure.input(ZGetScheduleInputSchema).query(async ({ input, ctx }) => {
    const { getScheduleHandler } = await import("./getSchedule.handler");

    return getScheduleHandler({
      ctx,
      input,
    });
  }),
  /**
   * Mutation that reserves a time slot by upserting `SelectedSlots` records.
   * The tRPC context's `req`/`res` are cast to Next.js `NextApiRequest`/
   * `NextApiResponse` types because the handler requires cookie access for
   * session-based slot ownership tracking.
   */
  reserveSlot: publicProcedure.input(ZReserveSlotInputSchema).mutation(async ({ input, ctx }) => {
    const { reserveSlotHandler } = await import("./reserveSlot.handler");

    return reserveSlotHandler({
      ctx: { ...ctx, req: ctx.req as NextApiRequest, res: ctx.res as NextApiResponse },
      input,
    });
  }),
  /**
   * Query that checks slot availability status. This is the only procedure in
   * the router with both input AND output schema validation — the output
   * schema (`ZIsAvailableOutputSchema`) enforces the response shape at runtime,
   * providing an additional contract guarantee for consumers.
   */
  isAvailable: publicProcedure
    .input(ZIsAvailableInputSchema)
    .output(ZIsAvailableOutputSchema)
    .query(async ({ input, ctx }) => {
      const { isAvailableHandler } = await import("./isAvailable.handler");

      return isAvailableHandler({
        ctx: { ...ctx, req: ctx.req as NextApiRequest },
        input,
      });
    }),
  /**
   * Inline mutation (no dedicated handler file) that cleans up `SelectedSlots`
   * records by resolving the uid from request cookies or the input payload.
   * Intentionally kept inline because it has no service dependencies — it
   * performs a direct Prisma `deleteMany` on the `selectedSlots` table.
   */
  removeSelectedSlotMark: publicProcedure
    .input(ZRemoveSelectedSlotInputSchema)
    .mutation(async ({ input, ctx }) => {
      const { req, prisma } = ctx;
      const uid = req?.cookies?.uid || input.uid;
      if (uid) {
        await prisma.selectedSlots.deleteMany({ where: { uid: { equals: uid } } });
      }
      return;
    }),
});
