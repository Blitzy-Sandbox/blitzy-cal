/**
 * Next.js catch-all API route for the `/api/trpc/availability/[trpc]` endpoint.
 * Passthrough adapter that delegates all requests to the {@link availabilityRouter},
 * routing availability procedures: `list`, `user`, `listTeam`, `schedule` (sub-router), and `calendarOverlay`.
 * Authentication, input validation, context construction, and error handling are fully managed by the tRPC layer.
 */
import { createNextApiHandler } from "@calcom/trpc/server/createNextApiHandler";
import { availabilityRouter } from "@calcom/trpc/server/routers/viewer/availability/_router";

export default createNextApiHandler(availabilityRouter);
