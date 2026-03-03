/**
 * Viewer Availability tRPC Router
 *
 * Top-level router for all availability-related tRPC procedures in the viewer namespace.
 * Orchestrates five procedures:
 *
 * - `list` — Fetches all schedules for the authenticated user
 * - `user` — Fetches availability for a specific user with date range and optional event type
 * - `listTeam` — Fetches team member availability with pagination and timezone support
 * - `schedule` — Delegates to {@link scheduleRouter} for full schedule CRUD operations
 * - `calendarOverlay` — Fetches calendar overlay busy times for specified calendars
 *
 * All procedures require authentication via `authedProcedure`. Handlers are dynamically
 * imported to enable tree-shaking and code-splitting at build time.
 *
 * @module viewer/availability
 */
import authedProcedure from "../../../procedures/authedProcedure";
import { router } from "../../../trpc";
import { ZCalendarOverlayInputSchema } from "./calendarOverlay.schema";
import { scheduleRouter } from "./schedule/_router";
import { ZListTeamAvailaiblityScheme } from "./team/listTeamAvailability.schema";
import { ZUserInputSchema } from "./user.schema";

/**
 * Lazy-loaded handler cache for non-delegated availability procedures.
 *
 * Enables type-safe dynamic imports and tree-shaking by caching handler references
 * after their first invocation. The `schedule` procedure is excluded because it
 * delegates entirely to {@link scheduleRouter} rather than using a local handler.
 */
type AvailabilityRouterHandlerCache = {
  list?: typeof import("./list.handler").listHandler;
  user?: typeof import("./user.handler").userHandler;
  calendarOverlay?: typeof import("./calendarOverlay.handler").calendarOverlayHandler;
  listTeamAvailability?: typeof import("./team/listTeamAvailability.handler").listTeamAvailabilityHandler;
};

/**
 * Viewer availability tRPC router.
 *
 * Defines the following authenticated procedures:
 *
 * - **`list`** — Fetches all schedules for the authenticated user. No input required;
 *   uses only `ctx.user.id` from the authenticated session context.
 * - **`user`** — Fetches availability for a specific user, validated by {@link ZUserInputSchema},
 *   with date range and optional event type filtering.
 * - **`listTeam`** — Fetches team member availability, validated by {@link ZListTeamAvailaiblityScheme},
 *   with pagination and timezone support.
 * - **`schedule`** — Delegates entirely to {@link scheduleRouter} for full schedule CRUD
 *   operations (get, create, update, delete, duplicate, and more). Authentication is
 *   handled internally by the sub-router.
 * - **`calendarOverlay`** — Fetches calendar overlay busy times for specified calendars,
 *   validated by {@link ZCalendarOverlayInputSchema}.
 *
 * All procedures require authentication via `authedProcedure` to enforce permission
 * boundaries. Handlers are dynamically imported for optimal code-splitting.
 */
export const availabilityRouter = router({
  list: authedProcedure.query(async ({ ctx }) => {
    const { listHandler } = await import("./list.handler");

    return listHandler({
      ctx,
    });
  }),

  user: authedProcedure.input(ZUserInputSchema).query(async ({ ctx, input }) => {
    const { userHandler } = await import("./user.handler");

    return userHandler({
      ctx,
      input,
    });
  }),
  listTeam: authedProcedure.input(ZListTeamAvailaiblityScheme).query(async ({ ctx, input }) => {
    const { listTeamAvailabilityHandler } = await import("./team/listTeamAvailability.handler");

    return listTeamAvailabilityHandler({
      ctx,
      input,
    });
  }),
  schedule: scheduleRouter,
  calendarOverlay: authedProcedure.input(ZCalendarOverlayInputSchema).query(async ({ ctx, input }) => {
    const { calendarOverlayHandler } = await import("./calendarOverlay.handler");

    return calendarOverlayHandler({
      ctx,
      input,
    });
  }),
});
