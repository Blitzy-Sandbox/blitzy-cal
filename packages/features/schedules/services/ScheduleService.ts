import { getAvailabilityFromSchedule } from "@calcom/lib/availability";
import { timeZoneSchema } from "@calcom/lib/dayjs/timeZone.schema";
import { hasEditPermissionForUserID } from "@calcom/lib/hasEditPermissionForUser";
import { HttpError } from "@calcom/lib/http-error";
import { transformScheduleToAvailabilityForAtom } from "@calcom/lib/schedules/transformers/for-atom";
import type { PrismaClient } from "@calcom/prisma";
import type { TrpcSessionUser } from "@calcom/trpc/server/types";
import { z } from "zod";
import { ScheduleRepository } from "../repositories/ScheduleRepository";

/**
 * Zod 3.25.76 input validation schema for schedule update mutations.
 *
 * Validates all fields accepted by the {@link ScheduleService.update} method:
 *
 * - `scheduleId` — **Required** numeric ID of the schedule to update.
 * - `timeZone` — Optional IANA timezone string, validated via `timeZoneSchema`
 *   to ensure only recognized timezone identifiers are accepted.
 * - `name` — Optional schedule display name. Trimmed of leading/trailing
 *   whitespace and rejected if the result is empty (min length 1).
 * - `isDefault` — Optional boolean flag. When `true`, the schedule is promoted
 *   to the user's default schedule via {@link ScheduleRepository.setupDefaultSchedule}.
 * - `schedule` — Optional 7-element outer array (one per weekday) of inner
 *   arrays containing `{ start: Date, end: Date }` time-range objects
 *   representing weekly recurring availability windows.
 * - `dateOverrides` — Optional flat array of `{ start: Date, end: Date }`
 *   objects representing one-off date-specific availability overrides.
 *
 * @remarks
 * Re-exported as `ZUpdateInputSchema` via
 * `packages/trpc/server/routers/viewer/availability/schedule/update.schema.ts`.
 */
export const ZUpdateInputSchema = z.object({
  scheduleId: z.number(),
  timeZone: timeZoneSchema.optional(),
  name: z.string().trim().min(1, "Schedule name cannot be empty").optional(),
  isDefault: z.boolean().optional(),
  schedule: z
    .array(
      z.array(
        z.object({
          start: z.date(),
          end: z.date(),
        })
      )
    )
    .optional(),
  dateOverrides: z
    .array(
      z.object({
        start: z.date(),
        end: z.date(),
      })
    )
    .optional(),
});

/**
 * TypeScript type derived from {@link ZUpdateInputSchema} via `z.infer`.
 *
 * Represents the validated input shape for schedule update operations after
 * Zod parsing. Used as the `input` field of {@link IUpdateScheduleOptions}.
 *
 * @remarks
 * Re-exported as `TUpdateInputSchema` via
 * `packages/trpc/server/routers/viewer/availability/schedule/update.schema.ts`.
 */
export type TUpdateInputSchema = z.infer<typeof ZUpdateInputSchema>;

/**
 * Internal parameter interface for the {@link ScheduleService.update} method.
 *
 * @property input - Validated schedule update payload conforming to {@link TUpdateInputSchema}.
 * @property user  - A minimal pick of the authenticated session user containing only the
 *   three fields consumed by the update flow:
 *   - `id` — The requesting user's numeric ID, used for ownership verification.
 *   - `defaultScheduleId` — The user's current default schedule ID, used to compute
 *     `isDefault`, `prevDefaultId`, and `currentDefaultId` in the response.
 *   - `timeZone` — The user's profile timezone, used as a fallback when the schedule
 *     itself does not specify a timezone.
 */
interface IUpdateScheduleOptions {
  input: TUpdateInputSchema;
  user: Pick<NonNullable<TrpcSessionUser>, "id" | "defaultScheduleId" | "timeZone">;
}

/**
 * Awaited return type of {@link ScheduleService.update}.
 *
 * This type dynamically tracks the `update` method's return shape, which varies
 * depending on whether the name-less short-circuit path is taken:
 * - **Short-circuit** (no `name`): Returns `{ schedule, isDefault }`.
 * - **Full update**: Returns `{ schedule, availability, timeZone, isDefault,
 *   prevDefaultId, currentDefaultId }`.
 *
 * @remarks
 * **Platform SDK contract type** — re-exported in
 * `packages/platform/libraries/schedules.ts`. Do NOT change the export name
 * or the underlying method signature (Rule 0.7.4).
 */
export type UpdateScheduleResponse = Awaited<ReturnType<ScheduleService["update"]>>;

/**
 * Centralized service for schedule mutation operations.
 *
 * Receives a DI-injected {@link PrismaClient} and exposes the {@link update}
 * method, which is the sole entry-point for modifying schedule records.
 *
 * **Security**: Enforces ownership and edit-permission checks via
 * `hasEditPermissionForUserID` before any mutation is applied — a direct
 * owner check is performed first, and a team-/managed-event permission
 * check is used as a fallback (Rule 0.7.6).
 *
 * **Repository delegation**: Uses {@link ScheduleRepository.setupDefaultSchedule}
 * for default-schedule lifecycle management, adhering to the repository
 * pattern (Rule 0.7.1).
 *
 * Consumed by:
 * - The tRPC update handler at
 *   `packages/trpc/server/routers/viewer/availability/schedule/update.handler.ts`.
 * - The exported {@link updateSchedule} convenience helper in this file.
 */
export class ScheduleService {
  constructor(private prisma: PrismaClient) {}

  /**
   * Validates ownership, enforces permissions, optionally toggles default
   * status, and performs a transactional schedule update.
   *
   * **Execution flow:**
   * 1. **Normalize availability** — If `input.schedule` is provided, delegates
   *    to `getAvailabilityFromSchedule` to transform the 7-day weekly array
   *    into normalized availability records. Otherwise, maps `dateOverrides`
   *    into availability format with `startTime`, `endTime`, `date`, and
   *    empty `days[]`.
   * 2. **Fetch schedule** — Retrieves the target schedule by ID for ownership
   *    verification (workaround for Prisma bug #7290).
   * 3. **Permission check** — If the requesting user is not the schedule owner,
   *    falls back to `hasEditPermissionForUserID` to check team membership or
   *    managed event-type permissions.
   * 4. **Default toggle** — When `input.isDefault` is `true`, delegates to
   *    {@link ScheduleRepository.setupDefaultSchedule} to atomically promote
   *    this schedule as the user's default.
   * 5. **Name-less short-circuit** — When `input.name` is omitted, returns
   *    early with `{ schedule, isDefault }` to prevent inadvertently wiping
   *    existing availability data.
   * 6. **Transactional update** — Atomically deletes all existing availability
   *    rows and re-creates them from the normalized availability plus
   *    `dateOverrides`, updating `timeZone` and `name` simultaneously.
   * 7. **Atom transformation** — Converts the updated schedule via
   *    `transformScheduleToAvailabilityForAtom` for Platform Atom consumers.
   * 8. **Response construction** — Returns the full schedule object, Atom-
   *    friendly availability, resolved timezone (schedule or user fallback),
   *    `isDefault` flag, and previous/current default schedule IDs.
   *
   * @param options - Destructured {@link IUpdateScheduleOptions} containing
   *   the validated input payload and the authenticated session user.
   * @returns The updated schedule with availability, timezone, default status,
   *   and default-ID change tracking fields.
   * @throws {HttpError} `401 Unauthorized` if the schedule is not found or
   *   the requesting user lacks ownership or edit permission.
   */
  async update({ input, user }: IUpdateScheduleOptions) {
    const availability = input.schedule
      ? getAvailabilityFromSchedule(input.schedule)
      : (input.dateOverrides || []).map((dateOverride) => ({
          startTime: dateOverride.start,
          endTime: dateOverride.end,
          date: dateOverride.start,
          days: [],
        }));

    // Not able to update the schedule with userId where clause, so fetch schedule separately and then validate
    // Bug: https://github.com/prisma/prisma/issues/7290
    const userSchedule = await this.prisma.schedule.findUnique({
      where: {
        id: input.scheduleId,
      },
      select: {
        userId: true,
        name: true,
        id: true,
      },
    });

    if (!userSchedule) {
      throw new HttpError({
        statusCode: 401,
        message: "Unauthorized",
      });
    }

    if (userSchedule?.userId !== user.id) {
      const hasEditPermission = await hasEditPermissionForUserID({
        ctx: {
          user,
        },
        input: { memberId: userSchedule.userId },
      });
      if (!hasEditPermission) {
        throw new HttpError({
          statusCode: 401,
          message: "Unauthorized",
        });
      }
    }

    let updatedUser;
    if (input.isDefault) {
      const scheduleRepo = new ScheduleRepository(this.prisma);

      const setupDefault = await scheduleRepo.setupDefaultSchedule(user.id, input.scheduleId);
      updatedUser = setupDefault;
    }

    if (!input.name) {
      // TODO: Improve
      // We don't want to pass the full schedule for just a set as default update
      // but in the current logic, this wipes the existing availability.
      // Return early to prevent this from happening.
      return {
        schedule: userSchedule,
        isDefault: updatedUser
          ? updatedUser.defaultScheduleId === input.scheduleId
          : user.defaultScheduleId === input.scheduleId,
      };
    }

    const schedule = await this.prisma.schedule.update({
      where: {
        id: input.scheduleId,
      },
      data: {
        timeZone: input.timeZone,
        name: input.name,
        availability: {
          deleteMany: {
            scheduleId: {
              equals: input.scheduleId,
            },
          },
          createMany: {
            data: [
              ...availability,
              ...(input.dateOverrides || []).map((override) => ({
                date: override.start,
                startTime: override.start,
                endTime: override.end,
              })),
            ],
          },
        },
      },
      select: {
        id: true,
        userId: true,
        name: true,
        availability: true,
        timeZone: true,
        eventType: {
          select: {
            id: true,
            eventName: true,
          },
        },
      },
    });

    const userAvailability = transformScheduleToAvailabilityForAtom(schedule);

    return {
      schedule,
      availability: userAvailability,
      timeZone: schedule.timeZone || user.timeZone,
      isDefault: updatedUser
        ? updatedUser.defaultScheduleId === schedule.id
        : user.defaultScheduleId === schedule.id,
      prevDefaultId: user.defaultScheduleId,
      currentDefaultId: updatedUser ? updatedUser.defaultScheduleId : user.defaultScheduleId,
    };
  }
}

/**
 * Convenience helper that instantiates a {@link ScheduleService} with the
 * provided {@link PrismaClient} and forwards the update request.
 *
 * **Platform SDK public contract** — this function is re-exported in
 * `packages/platform/libraries/schedules.ts` and must not have its signature
 * or return type changed (Rule 0.7.4).
 *
 * @param options - Combines {@link IUpdateScheduleOptions} (validated input
 *   and authenticated user) with an additional `prisma` field supplying the
 *   database client instance.
 * @returns The result of {@link ScheduleService.update} — see
 *   {@link UpdateScheduleResponse} for the full return shape.
 */
export const updateSchedule = async ({
  input,
  user,
  prisma,
}: IUpdateScheduleOptions & { prisma: PrismaClient }) => {
  const service = new ScheduleService(prisma);
  return service.update({ input, user });
};
