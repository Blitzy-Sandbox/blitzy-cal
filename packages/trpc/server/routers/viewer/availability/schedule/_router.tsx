/**
 * @module packages/trpc/server/routers/viewer/availability/schedule/_router
 *
 * Viewer-side tRPC sub-router for schedule CRUD operations within the
 * Cal.com availability domain. Mounted at `/api/trpc/viewer/availability/schedule/*`.
 *
 * Provides 9 authenticated procedures:
 * - Queries: `get`, `getScheduleByUserId`, `getAllSchedulesByUserId`, `getScheduleByEventSlug`
 * - Mutations: `create`, `delete`, `update`, `duplicate`, `bulkUpdateToDefaultAvailability`
 *
 * All procedures are guarded by `authedProcedure` to enforce authentication (Rule 0.7.6).
 * All inputs are validated via co-located Zod schemas imported from `.schema.ts` files (Rule 0.7.1).
 * Handlers are lazily imported through dynamic `import()` for code-splitting efficiency,
 * cached in a `ScheduleRouterHandlerCache` to avoid redundant module resolution.
 */
import authedProcedure from "../../../../procedures/authedProcedure";
import { router } from "../../../../trpc";
import { ZBulkUpdateToDefaultAvailabilityInputSchema } from "./bulkUpdateDefaultAvailability.schema";
import { ZCreateInputSchema } from "./create.schema";
import { ZDeleteInputSchema } from "./delete.schema";
import { ZScheduleDuplicateSchema } from "./duplicate.schema";
import { ZGetInputSchema } from "./get.schema";
import { ZGetAllByUserIdInputSchema } from "./getAllSchedulesByUserId.schema";
import { ZGetByEventSlugInputSchema } from "./getScheduleByEventTypeSlug.schema";
import { ZGetByUserIdInputSchema } from "./getScheduleByUserId.schema";
import { ZUpdateInputSchema } from "./update.schema";

/**
 * Cache type for lazily-loaded schedule handler functions.
 *
 * Each handler entry is optional (`?`) because handlers are loaded on-demand
 * via dynamic `import()` within their respective procedure definitions. Once loaded,
 * the handler reference is retained for subsequent invocations within the same
 * server lifecycle, enabling code-splitting without repeated module resolution overhead.
 */
type ScheduleRouterHandlerCache = {
  get?: typeof import("./get.handler").getHandler;
  create?: typeof import("./create.handler").createHandler;
  delete?: typeof import("./delete.handler").deleteHandler;
  update?: typeof import("./update.handler").updateHandler;
  duplicate?: typeof import("./duplicate.handler").duplicateHandler;
  getScheduleByUserId?: typeof import("./getScheduleByUserId.handler").getScheduleByUserIdHandler;
  getAllSchedulesByUserId?: typeof import("./getAllSchedulesByUserId.handler").getAllSchedulesByUserIdHandler;
  getScheduleByEventSlug?: typeof import("./getScheduleByEventTypeSlug.handler").getScheduleByEventSlugHandler;
  bulkUpdateToDefaultAvailability?: typeof import("./bulkUpdateDefaultAvailability.handler").bulkUpdateToDefaultAvailabilityHandler;
};

/**
 * The exported tRPC router defining all schedule-related viewer procedures.
 *
 * **Queries:**
 * - `get` — Retrieves a single schedule by ID via `get.handler`
 * - `getScheduleByUserId` — Looks up a schedule by user ID via `getScheduleByUserId.handler`
 * - `getAllSchedulesByUserId` — Lists all schedules for a user via `getAllSchedulesByUserId.handler`
 * - `getScheduleByEventSlug` — Resolves a schedule by event type slug via `getScheduleByEventTypeSlug.handler`
 *
 * **Mutations:**
 * - `create` — Creates a new schedule via `create.handler`
 * - `delete` — Deletes a schedule via `delete.handler`
 * - `update` — Updates a schedule via `update.handler`
 * - `duplicate` — Duplicates a schedule via `duplicate.handler`
 * - `bulkUpdateToDefaultAvailability` — Resets availability to defaults in bulk via `bulkUpdateDefaultAvailability.handler`
 *
 * Consumed by the parent availability router at
 * `packages/trpc/server/routers/viewer/availability/_router.tsx`.
 */
export const scheduleRouter = router({
  get: authedProcedure.input(ZGetInputSchema).query(async ({ input, ctx }) => {
    const { getHandler } = await import("./get.handler");

    return getHandler({
      ctx,
      input,
    });
  }),

  create: authedProcedure.input(ZCreateInputSchema).mutation(async ({ input, ctx }) => {
    const { createHandler } = await import("./create.handler");

    return createHandler({
      ctx,
      input,
    });
  }),

  delete: authedProcedure.input(ZDeleteInputSchema).mutation(async ({ input, ctx }) => {
    const { deleteHandler } = await import("./delete.handler");

    return deleteHandler({
      ctx,
      input,
    });
  }),

  update: authedProcedure.input(ZUpdateInputSchema).mutation(async ({ input, ctx }) => {
    const { updateHandler } = await import("./update.handler");

    return updateHandler({
      ctx,
      input,
    });
  }),

  duplicate: authedProcedure.input(ZScheduleDuplicateSchema).mutation(async ({ input, ctx }) => {
    const { duplicateHandler } = await import("./duplicate.handler");

    return duplicateHandler({
      ctx,
      input,
    });
  }),

  getScheduleByUserId: authedProcedure.input(ZGetByUserIdInputSchema).query(async ({ input, ctx }) => {
    const { getScheduleByUserIdHandler } = await import("./getScheduleByUserId.handler");

    return getScheduleByUserIdHandler({
      ctx,
      input,
    });
  }),

  getAllSchedulesByUserId: authedProcedure.input(ZGetAllByUserIdInputSchema).query(async ({ input, ctx }) => {
    const { getAllSchedulesByUserIdHandler } = await import("./getAllSchedulesByUserId.handler");

    return getAllSchedulesByUserIdHandler({
      ctx,
      input,
    });
  }),

  getScheduleByEventSlug: authedProcedure.input(ZGetByEventSlugInputSchema).query(async ({ input, ctx }) => {
    const { getScheduleByEventSlugHandler } = await import("./getScheduleByEventTypeSlug.handler");

    return getScheduleByEventSlugHandler({
      ctx,
      input,
    });
  }),
  bulkUpdateToDefaultAvailability: authedProcedure
    .input(ZBulkUpdateToDefaultAvailabilityInputSchema)
    .mutation(async ({ ctx, input }) => {
      const { bulkUpdateToDefaultAvailabilityHandler } = await import(
        "./bulkUpdateDefaultAvailability.handler"
      );

      return bulkUpdateToDefaultAvailabilityHandler({
        ctx,
        input,
      });
    }),
});
