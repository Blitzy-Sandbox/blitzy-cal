/**
 * Availability List Handler
 *
 * Fetches all schedules for the authenticated user, resolves the default schedule ID
 * via {@link ScheduleRepository.getDefaultScheduleId}, and enriches each schedule with
 * an `isDefault` flag. Includes a self-healing backfill that persists the resolved
 * default when the user's stored `defaultScheduleId` is null.
 *
 * Consumed by the viewer availability router (`_router.tsx`) via dynamic import.
 *
 * @module viewer/availability/list.handler
 */
import { ScheduleRepository } from "@calcom/features/schedules/repositories/ScheduleRepository";
import { prisma } from "@calcom/prisma";

import type { TrpcSessionUser } from "../../../types";

/**
 * Narrowed context type for the list handler.
 *
 * Picks only the fields consumed by this handler from the authenticated session user:
 * - `id` — used to scope all Prisma queries to the authenticated user (ownership enforcement).
 * - `defaultScheduleId` — inspected to determine whether the self-healing backfill
 *   should persist a newly resolved default schedule ID.
 */
type ListOptions = {
  ctx: {
    user: Pick<NonNullable<TrpcSessionUser>, "id" | "defaultScheduleId">;
  };
};

/**
 * Inferred return type of {@link listHandler}.
 *
 * Tracks the handler's response shape for downstream router type inference and test consumers.
 * The resolved type is `{ schedules: Array<{ id, name, availability, timeZone, isDefault }> }`.
 */
export type GetAvailabilityListHandlerReturn = Awaited<ReturnType<typeof listHandler>>;

/**
 * Handles the `list` procedure for the viewer availability router.
 *
 * Execution flow:
 * 1. Fetches all schedules for the authenticated user via `prisma.schedule.findMany`,
 *    scoped to `user.id` with deterministic `id: "asc"` ordering.
 * 2. Returns `{ schedules: [] }` early if no schedules exist for the user.
 * 3. Resolves the default schedule ID via {@link ScheduleRepository.getDefaultScheduleId},
 *    which follows the chain: `user.defaultScheduleId` → `schedule.findFirst` → throw.
 * 4. **Self-healing backfill**: if `user.defaultScheduleId` is null (e.g., after migration
 *    or data cleanup), persists the resolved default via `prisma.user.update` so future
 *    queries skip the resolution step.
 * 5. Gracefully falls back to `defaultScheduleId = null` on any error during default
 *    resolution or backfill persistence, ensuring the endpoint always returns data.
 * 6. Enriches each schedule with an `isDefault` boolean flag by comparing `schedule.id`
 *    against the resolved `defaultScheduleId`.
 *
 * **Security**: `authedProcedure` is enforced at the router level in `_router.tsx`.
 * All Prisma queries are scoped to the authenticated `user.id`.
 *
 * @param options - The handler options containing the authenticated user context.
 * @returns An object with a `schedules` array, each enriched with `isDefault`.
 */
export const listHandler = async ({ ctx }: ListOptions) => {
  const { user } = ctx;

  const schedules = await prisma.schedule.findMany({
    where: {
      userId: user.id,
    },
    select: {
      id: true,
      name: true,
      availability: true,
      timeZone: true,
    },
    orderBy: {
      id: "asc",
    },
  });

  if (schedules.length === 0) {
    return {
      schedules: [],
    };
  }

  let defaultScheduleId: number | null;
  try {
    const scheduleRepository = new ScheduleRepository(prisma);
    defaultScheduleId = await scheduleRepository.getDefaultScheduleId(user.id);

    if (!user.defaultScheduleId) {
      await prisma.user.update({
        where: {
          id: user.id,
        },
        data: {
          defaultScheduleId,
        },
      });
    }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (error) {
    defaultScheduleId = null;
  }

  return {
    schedules: schedules.map((schedule) => ({
      ...schedule,
      isDefault: schedule.id === defaultScheduleId,
    })),
  };
};
