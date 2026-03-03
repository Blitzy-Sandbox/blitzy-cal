/**
 * Narrower Schedule type specifically shaped for schedule list item rendering.
 *
 * This type is distinct from the canonical `Schedule` type in `@calcom/types/schedule`,
 * which is defined as `TimeRange[][]`. Instead, this type mirrors a subset of the Prisma
 * `Schedule` model (id, name, timeZone, isDefault) along with its nested `Availability`
 * relation records (id, userId, startTime, endTime, eventTypeId, date, days, scheduleId).
 *
 * It is consumed by:
 * - Platform atoms (`useEnsureDefaultSchedule`, `ListSchedulesPlatformWrapper`) as a type-only
 *   and runtime import for schedule list rendering.
 * - The web app availability page (`apps/web/.../availability/page.tsx`) for server-component
 *   schedule data transformation before passing to client components.
 */
export type Schedule = {
  isDefault: boolean;
  id: number;
  name: string;
  timeZone: string | null;
  availability: {
    id: number;
    userId: number | null;
    startTime: Date;
    endTime: Date;
    eventTypeId: number | null;
    date: Date | null;
    days: number[];
    scheduleId: number | null;
  }[];
};

/**
 * Creates a shallow clone of the given schedule with defensively cloned Date fields
 * in each availability entry, preventing mutation bugs during UI rendering.
 *
 * Date fields (`startTime`, `endTime`, `date`) are reconstructed via `new Date()` to
 * handle two common data-transport scenarios:
 * - **Native Date objects** (from direct Prisma queries): `new Date(existingDate)` produces
 *   an independent copy, so downstream consumers cannot accidentally mutate the source.
 * - **Serialized ISO strings** (from Next.js server components or `JSON.parse` round-trips):
 *   `new Date("2024-01-01T09:00:00.000Z")` correctly parses the string back into a Date.
 *
 * The nullable `date` field is passed through as `null` when absent, avoiding an
 * invalid `new Date(null)` construction.
 *
 * Primitive fields (`isDefault`, `id`, `name`, `timeZone`) and the `days` number array
 * are shallow-copied, which is safe because they are either primitives or arrays of
 * primitives used only for read-only rendering.
 *
 * @param schedule - A {@link Schedule} object typically sourced from `ScheduleRepository`
 *   queries or tRPC list handlers.
 * @returns A new Schedule object structurally identical to the input but with fresh,
 *   independent Date instances for all date-typed availability fields.
 */
export const getScheduleListItemData = (schedule: Schedule) => ({
  ...schedule,
  availability: schedule.availability.map((avail) => ({
    ...avail,
    startTime: new Date(avail.startTime),
    endTime: new Date(avail.endTime),
    date: avail.date ? new Date(avail.date) : null,
  })),
});
