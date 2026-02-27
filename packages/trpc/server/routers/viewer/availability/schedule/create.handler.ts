import { DEFAULT_SCHEDULE, getAvailabilityFromSchedule } from "@calcom/lib/availability";
import { prisma } from "@calcom/prisma";
import type { Prisma } from "@calcom/prisma/client";

import { TRPCError } from "@trpc/server";

import type { TrpcSessionUser } from "../../../../types";
import type { TCreateInputSchema } from "./create.schema";

/**
 * Options type for the schedule CREATE handler.
 *
 * @property ctx.user - Authenticated session user, picking only `id`, `timeZone`, and
 *   `defaultScheduleId` from `TrpcSessionUser`. The `timeZone` field is used to initialize the
 *   new schedule's timezone (Rule 0.7.2), and `defaultScheduleId` determines whether the
 *   newly created schedule should be set as the user's default.
 * @property input - Validated by `ZCreateInputSchema` (co-located in `create.schema.ts`).
 *   Fields: `name` (required string — schedule display name), `schedule` (optional 7-element
 *   `TimeRange[][]` representing weekly availability windows), and `eventTypeId` (optional
 *   number — links the schedule to an existing event type owned by the user).
 */
type CreateOptions = {
  ctx: {
    user: Pick<NonNullable<TrpcSessionUser>, "id" | "timeZone" | "defaultScheduleId">;
  };
  input: TCreateInputSchema;
};

/**
 * Exported return type for the schedule create handler, consumed by platform SDK
 * (`packages/platform/libraries/schedules.ts`) and other downstream callers.
 *
 * Resolves to `{ schedule: Schedule }` where `Schedule` is the full Prisma-created
 * record including all auto-generated fields (`id`, `createdAt`, `updatedAt`, etc.).
 * Backward compatibility of this type alias is critical — see Rule 0.7.4.
 */
export type CreateScheduleHandlerReturn = Awaited<ReturnType<typeof createHandler>>;

/**
 * Creates a new schedule with normalized availability data for the authenticated user.
 *
 * **Execution Flow:**
 * 1. **Ownership verification** — If `eventTypeId` is provided, confirms the event type
 *    belongs to the authenticated user via `prisma.eventType.findUnique`. Throws
 *    `TRPCError({ code: "UNAUTHORIZED" })` on mismatch (Rule 0.7.6).
 * 2. **Availability normalization** — Derives availability records from `input.schedule`
 *    (user-defined weekly windows) or falls back to `DEFAULT_SCHEDULE` (Mon–Fri 09:00–17:00
 *    UTC, sourced from `@calcom/lib/availability`). Uses `getAvailabilityFromSchedule` which
 *    deduplicates identical time ranges and groups day indices for storage efficiency.
 * 3. **Prisma schedule creation** — Persists the schedule with `name`, `user` connection,
 *    optional `eventType` connection, normalized `availability` records, and `timeZone`
 *    inherited from the user's profile (Rule 0.7.2: timezone storage convention).
 * 4. **Default schedule backfill** — If the user has no `defaultScheduleId` set, the newly
 *    created schedule is automatically promoted to the user's default via `prisma.user.update`.
 *
 * @param options - Destructured `CreateOptions` containing authenticated `ctx` and validated `input`.
 * @returns `{ schedule }` — The Prisma-created schedule record (Rule 0.7.4: response shape stability).
 * @throws {TRPCError} `UNAUTHORIZED` when `eventTypeId` is provided but belongs to another user.
 */
export const createHandler = async ({ input, ctx }: CreateOptions) => {
  const { user } = ctx;
  if (input.eventTypeId) {
    const eventType = await prisma.eventType.findUnique({
      where: {
        id: input.eventTypeId,
      },
      select: {
        userId: true,
      },
    });
    if (!eventType || eventType.userId !== user.id) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "You are not authorized to create a schedule for this event type",
      });
    }
  }
  const data: Prisma.ScheduleCreateInput = {
    name: input.name,
    user: {
      connect: {
        id: user.id,
      },
    },
    // If an eventTypeId is provided then connect the new schedule to that event type
    ...(input.eventTypeId && { eventType: { connect: { id: input.eventTypeId } } }),
  };

  const availability = getAvailabilityFromSchedule(input.schedule || DEFAULT_SCHEDULE);
  data.availability = {
    createMany: {
      data: availability.map((schedule) => ({
        days: schedule.days,
        startTime: schedule.startTime,
        endTime: schedule.endTime,
      })),
    },
  };

  data.timeZone = user.timeZone;

  const schedule = await prisma.schedule.create({
    data,
  });

  if (!user.defaultScheduleId) {
    await prisma.user.update({
      where: {
        id: user.id,
      },
      data: {
        defaultScheduleId: schedule.id,
      },
    });
  }

  return { schedule };
};
