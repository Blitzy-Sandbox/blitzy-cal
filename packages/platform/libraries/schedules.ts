/**
 * Platform SDK — Schedule & Availability Public API Surface
 *
 * This barrel module re-exports curated services, repositories, handlers, schemas,
 * and types from the internal Cal.com feature packages. These exports form the
 * **public contract** consumed by third-party platform integrators and API v2
 * consumers via `@calcom/platform-libraries`.
 *
 * **Backward Compatibility Contract (Rule 0.7.4)**:
 * Every export name, alias, function signature, and return type in this file is
 * part of the stable Platform SDK surface. Any modification — renaming, removal,
 * or signature change — constitutes a **BREAKING CHANGE** for platform consumers
 * and must follow a formal deprecation process.
 *
 * @module @calcom/platform-libraries/schedules
 */

/**
 * Schedule Repository — Prisma-backed schedule CRUD with permission enforcement.
 *
 * - `ScheduleRepository`: Class providing `findDetailedScheduleById`, `getDefaultScheduleId`,
 *   `setupDefaultSchedule`, and other schedule data-access methods with ownership guards.
 * - `FindDetailedScheduleByIdReturnType`: Stable type alias for the resolved return value
 *   of `ScheduleRepository.findDetailedScheduleById`.
 *
 * @source {@link @calcom/features/schedules/repositories/ScheduleRepository}
 */
export {
  ScheduleRepository,
  type FindDetailedScheduleByIdReturnType,
} from "@calcom/features/schedules/repositories/ScheduleRepository";

/**
 * Schedule Service — Schedule mutation logic with Zod validation and ownership enforcement.
 *
 * - `updateSchedule`: Convenience function wrapping `ScheduleService.update` for transactional
 *   schedule updates (timezone, name, availability delete/recreate) with edit-permission checks.
 * - `UpdateScheduleResponse`: Return type contract for schedule update operations.
 *
 * @source {@link @calcom/features/schedules/services/ScheduleService}
 */
export {
  updateSchedule,
  type UpdateScheduleResponse,
} from "@calcom/features/schedules/services/ScheduleService";
/**
 * User Availability Service — Orchestration core for user availability computation.
 *
 * Composes schedule detection (`detectEventTypeScheduleForUser`), holiday blocking
 * (`calculateHolidayBlockedDates`), busy-time services (`BusyTimesService`), and
 * date-range arithmetic (`buildDateRanges` / `subtract` / `getWorkingHours`) into
 * a unified availability response with Redis caching support.
 *
 * @source {@link @calcom/features/availability/lib/getUserAvailability}
 */
export { UserAvailabilityService } from "@calcom/features/availability/lib/getUserAvailability";

/**
 * Schedule Creation Handler — tRPC handler for creating a new schedule.
 *
 * - `createScheduleHandler`: Aliased from `createHandler`; performs ownership checks,
 *   normalized availability construction, and default-schedule backfill.
 * - `CreateScheduleHandlerReturn`: Return type contract for the creation handler.
 * - `CreateScheduleSchema`: Aliased from `ZCreateInputSchema`; Zod validation schema
 *   for schedule creation input payloads.
 *
 * @source {@link @calcom/trpc/server/routers/viewer/availability/schedule/create.handler}
 * @source {@link @calcom/trpc/server/routers/viewer/availability/schedule/create.schema}
 */
export {
  createHandler as createScheduleHandler,
  type CreateScheduleHandlerReturn,
} from "@calcom/trpc/server/routers/viewer/availability/schedule/create.handler";
export { ZCreateInputSchema as CreateScheduleSchema } from "@calcom/trpc/server/routers/viewer/availability/schedule/create.schema";

/**
 * Availability List Handler — tRPC handler for listing all user schedules.
 *
 * - `getAvailabilityListHandler`: Aliased from `listHandler`; returns schedules with
 *   default-schedule resolution and backfill for users without a configured default.
 * - `GetAvailabilityListHandlerReturn`: Return type contract for the list handler.
 *
 * @source {@link @calcom/trpc/server/routers/viewer/availability/list.handler}
 */
export {
  listHandler as getAvailabilityListHandler,
  type GetAvailabilityListHandlerReturn,
} from "@calcom/trpc/server/routers/viewer/availability/list.handler";
/**
 * Schedule Duplication Handler — tRPC handler for duplicating an existing schedule.
 *
 * - `duplicateScheduleHandler`: Aliased from `duplicateHandler`; clones a schedule
 *   including its availability entries and metadata.
 * - `DuplicateScheduleHandlerReturn`: Return type contract for the duplication handler.
 *
 * @source {@link @calcom/trpc/server/routers/viewer/availability/schedule/duplicate.handler}
 */
export {
  duplicateHandler as duplicateScheduleHandler,
  type DuplicateScheduleHandlerReturn,
} from "@calcom/trpc/server/routers/viewer/availability/schedule/duplicate.handler";

/**
 * Schedule-by-Event-Slug Handler — tRPC handler for looking up a schedule by event type slug.
 *
 * Resolves the schedule associated with a given event type's URL slug, enabling
 * platform consumers to retrieve availability configuration without knowing the
 * internal schedule ID.
 *
 * @source {@link @calcom/trpc/server/routers/viewer/availability/schedule/getScheduleByEventTypeSlug.handler}
 */
export { getScheduleByEventSlugHandler } from "@calcom/trpc/server/routers/viewer/availability/schedule/getScheduleByEventTypeSlug.handler";
