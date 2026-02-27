import { ScheduleRepository } from "@calcom/features/schedules/repositories/ScheduleRepository";
import { prisma } from "@calcom/prisma";

import type { TrpcSessionUser } from "../../../../types";
import type { TGetInputSchema } from "./get.schema";

/**
 * Options type for the schedule GET handler.
 *
 * @property ctx.user - Picks only the three fields required by `ScheduleRepository.findDetailedScheduleById`:
 *   `id` (ownership/permission check), `timeZone` (fallback when the schedule has no timezone),
 *   and `defaultScheduleId` (for default schedule resolution).
 * @property input - Validated by `ZGetInputSchema` co-located in `get.schema.ts`
 *   (`scheduleId: z.number()`, `isManagedEventType: z.boolean().optional()`).
 */
type GetOptions = {
  ctx: {
    user: Pick<NonNullable<TrpcSessionUser>, "id" | "timeZone" | "defaultScheduleId">;
  };
  input: TGetInputSchema;
};

/**
 * Thin proxy handler that delegates schedule detail retrieval to
 * {@link ScheduleRepository.findDetailedScheduleById}.
 *
 * A fresh `ScheduleRepository` is instantiated per request with the shared Prisma client.
 * The handler passes all fields required for:
 *  - **Default schedule resolution** (`defaultScheduleId`)
 *  - **Managed event type detection** (`isManagedEventType`)
 *  - **Permission enforcement** (`userId` — ownership + team membership checks are
 *    enforced inside the repository via `hasReadPermissionsForUserId`)
 *  - **Timezone fallback** (`timeZone` — used when the schedule has no explicit timezone)
 *
 * The return type is `FindDetailedScheduleByIdReturnType`, which is part of the
 * Platform SDK public contract (Rule 0.7.4) and must remain stable.
 *
 * @remarks `ScheduleRepository` handles all error throwing (not-found, unauthorized).
 *   No additional error handling is added in this handler intentionally.
 */
export const getHandler = async ({ ctx, input }: GetOptions) => {
  const scheduleRepo = new ScheduleRepository(prisma);
  return await scheduleRepo.findDetailedScheduleById({
    scheduleId: input.scheduleId,
    isManagedEventType: input.isManagedEventType,
    userId: ctx.user.id,
    timeZone: ctx.user.timeZone,
    defaultScheduleId: ctx.user.defaultScheduleId,
  });
};
