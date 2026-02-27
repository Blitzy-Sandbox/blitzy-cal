import { updateSchedule } from "@calcom/features/schedules/services/ScheduleService";
import { prisma } from "@calcom/prisma";
import type { TrpcSessionUser } from "@calcom/trpc/server/types";

import type { TUpdateInputSchema } from "./update.schema";

/** Helper type alias extracting the non-null session user from {@link TrpcSessionUser}. */
type User = NonNullable<TrpcSessionUser>;
/**
 * Options type for the schedule UPDATE handler.
 *
 * - `ctx.user` destructures `id`, `defaultScheduleId`, and `timeZone` from
 *   the session user via indexed access types (`User["id"]`, etc.) so only the
 *   fields required by {@link updateSchedule} are forwarded.
 * - `input` is validated by `ZUpdateInputSchema` (re-exported from
 *   `ScheduleService.ts` via `update.schema.ts`) with fields:
 *     - `scheduleId` — required number identifying the target schedule
 *     - `timeZone` — optional IANA timezone string
 *     - `name` — optional trimmed non-empty string
 *     - `isDefault` — optional boolean to toggle the default schedule
 *     - `schedule` — optional 7-day availability array
 *     - `dateOverrides` — optional date-specific override entries
 */
type UpdateOptions = {
  ctx: {
    user: { id: User["id"]; defaultScheduleId: User["defaultScheduleId"]; timeZone: User["timeZone"] };
  };
  input: TUpdateInputSchema;
};

/**
 * Thin delegation handler that forwards validated schedule update inputs to
 * {@link updateSchedule} from `ScheduleService`.
 *
 * This handler does **not** perform any business logic — all ownership
 * verification, permission enforcement (via `hasEditPermissionForUserID`),
 * default-schedule toggling, availability normalization, transactional Prisma
 * update, and Atom transformation are handled entirely by the service layer.
 *
 * @param options - Destructured handler options
 * @param options.input - Zod-validated `TUpdateInputSchema` containing the
 *   schedule mutation payload
 * @param options.ctx - tRPC context carrying the authenticated session user
 * @returns `UpdateScheduleResponse` — the Platform SDK contract type
 *   (see Rule 0.7.4). Includes `schedule`, `availability`, `timeZone`,
 *   `isDefault`, `prevDefaultId`, and `currentDefaultId`.
 *
 * @remarks
 * `ScheduleService.ts` is a concurrent validation target for JSDoc additions
 * only — no signature changes to `updateSchedule` or `UpdateScheduleResponse`.
 */
export const updateHandler = async ({ input, ctx }: UpdateOptions) => {
  const { user } = ctx;
  return updateSchedule({
    input,
    user,
    prisma,
  });
};
