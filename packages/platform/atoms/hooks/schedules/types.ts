/**
 * Local subset of the Prisma `Schedule` model (schema.prisma) representing the core
 * identity fields returned by schedule CRUD operations.
 *
 * Maps to Prisma fields: `id` (Int), `userId` (Int), `name` (String), `timeZone` (String?).
 *
 * @remarks This type is intentionally kept minimal to match what tRPC schedule handlers
 * (`create.handler.ts`, `duplicate.handler.ts`) include in their serialized responses.
 * It is NOT exported — consumers access it through the handler return types below.
 */
type Schedule = {
  id: number;
  userId: number;
  name: string;
  timeZone: string | null;
};

/**
 * Return type for the schedule creation tRPC handler.
 *
 * Mirrors `Awaited<ReturnType<typeof createHandler>>` from
 * `packages/trpc/server/routers/viewer/availability/schedule/create.handler.ts`.
 *
 * @see {@link Schedule} for the shape of the nested `schedule` object.
 */
export type CreateScheduleHandlerReturn = {
  schedule: Schedule;
};

/**
 * Return type for the schedule duplication tRPC handler.
 *
 * Mirrors `Awaited<ReturnType<typeof duplicateHandler>>` from
 * `packages/trpc/server/routers/viewer/availability/schedule/duplicate.handler.ts`.
 *
 * @see {@link Schedule} for the shape of the nested `schedule` object.
 */
export type DuplicateScheduleHandlerReturn = {
  schedule: Schedule;
};

/**
 * Return type for the availability list tRPC handler.
 *
 * Mirrors `Awaited<ReturnType<typeof listHandler>>` from
 * `packages/trpc/server/routers/viewer/availability/list.handler.ts`.
 *
 * Each schedule in the array omits `userId` for the listing context and includes:
 * - `availability` — nested array matching the Prisma `Availability` model fields
 *   (`id`, `userId`, `eventTypeId`, `days`, `startTime`, `endTime`, `date`, `scheduleId`)
 * - `isDefault` — whether this schedule is the user's current default
 */
export type GetAvailabilityListHandlerReturn = {
  schedules: (Omit<Schedule, "userId"> & {
    availability: {
      id: number;
      userId: number | null;
      eventTypeId: number | null;
      days: number[];
      startTime: Date;
      endTime: Date;
      date: Date | null;
      scheduleId: number | null;
    }[];
    isDefault: boolean;
  })[];
};

/**
 * Input payload for creating a new schedule via the atoms HTTP layer.
 *
 * @property name - Display name for the new schedule.
 * @property schedule - Optional two-dimensional array of time ranges (outer = days, inner = slots per day).
 *   When omitted, the system applies `DEFAULT_SCHEDULE` (Mon-Fri, 09:00-17:00).
 * @property eventTypeId - Optional event type ID to associate the new schedule with.
 */
export type CreateScheduleInput = {
  name: string;
  schedule?: { start: Date; end: Date }[][];
  eventTypeId?: number;
};
