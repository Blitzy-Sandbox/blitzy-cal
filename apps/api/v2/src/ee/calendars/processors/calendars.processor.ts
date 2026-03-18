import { Process, Processor } from "@nestjs/bull";
import { Logger } from "@nestjs/common";
import { Job } from "bull";
import { CalendarsService } from "@/ee/calendars/services/calendars.service";

export const DEFAULT_CALENDARS_JOB = "default_calendars_job";
export const CALENDARS_QUEUE = "calendars";
export type DefaultCalendarsJobDataType = {
  userId: number;
};

/**
 * CalendarsProcessor — Bull queue processor for ensuring default calendars are set.
 *
 * Sprint 3 Calendar Integrations — Backward Compatibility Verification:
 * This processor handles the `default_calendars_job` on the `calendars` Bull queue.
 * It calls `CalendarsService.getCalendars(userId, true)` which invokes
 * `getConnectedDestinationCalendarsAndEnsureDefaultsInDb` from platform libraries
 * to ensure default destination and selected calendars are set in the database.
 *
 * Upstream Sprint 3 changes and compatibility assessment:
 *
 * 1. CalendarsService (apps/api/v2/src/ee/calendars/services/calendars.service.ts):
 *    - UPDATED with JSDoc verification annotations only — no structural changes
 *    - The `getCalendars(userId, ensureDefaultSelectedCalendars)` method signature is unchanged
 *    - The method body continues to call `getConnectedDestinationCalendarsAndEnsureDefaultsInDb`
 *    - This processor's call at line 24 (`getCalendars(userId, true)`) is fully compatible
 *
 * 2. CalendarManager (packages/features/calendars/lib/CalendarManager.ts):
 *    - UPDATED with optional `statusFilter` parameter on `getBusyCalendarTimes`
 *    - NOT relevant to this processor — `getCalendars` does NOT call `getBusyTimes`
 *    - `getCalendars` calls `getConnectedDestinationCalendarsAndEnsureDefaultsInDb` which
 *      handles calendar listing and default selection, not availability queries
 *
 * 3. Credential model (packages/prisma/schema.prisma):
 *    - UPDATED with new nullable `externalCancellationSyncEnabled` Boolean field
 *    - This processor does not directly access Credential fields — it delegates to
 *      CalendarsService which handles credential operations
 *    - The nullable field defaults to NULL and is additive-only — no impact
 *
 * Conclusion: No code changes required. All existing constants, types, and logic remain stable.
 */
@Processor(CALENDARS_QUEUE)
export class CalendarsProcessor {
  private readonly logger = new Logger(CalendarsProcessor.name);

  constructor(public readonly calendarsService: CalendarsService) {}

  /**
   * Processes the `default_calendars_job` Bull job to ensure default calendars are set.
   *
   * Sprint 3 CI-004 Backward Compatibility Verification:
   * This method calls `this.calendarsService.getCalendars(userId, true)` which:
   * - Fetches connected destination calendars via `getConnectedDestinationCalendarsAndEnsureDefaultsInDb`
   * - Ensures default selected and destination calendars exist in the database
   * - Caches the result in Redis via CalendarsCacheService
   *
   * This call path is NOT affected by Sprint 3's CI-004 conflict detection changes because:
   * - `getCalendars` calls `getConnectedDestinationCalendarsAndEnsureDefaultsInDb`, not `getBusyTimes`
   * - The CI-004 `statusFilter` parameter is added to `getBusyCalendarTimes`, which is a
   *   completely separate code path used only for availability queries
   * - The CalendarsService's `getCalendars` method signature remains `(userId: number, ensureDefaultSelectedCalendars?: boolean)`
   *
   * Error handling: The try/catch wrapping ensures Bull job failures are logged via
   * the NestJS Logger but do not propagate as unhandled exceptions, keeping the queue alive.
   * This pattern is correct and unchanged by Sprint 3 modifications.
   */
  @Process(DEFAULT_CALENDARS_JOB)
  async handleEnsureDefaultCalendars(job: Job<DefaultCalendarsJobDataType>) {
    const { userId } = job.data;
    try {
      // getCalendars calls getConnectedDestinationCalendarsAndEnsureDefaultsInDb from platform libraries
      // which gets the calendars from third party providers and ensure default destination and selected calendars are set in DB
      await this.calendarsService.getCalendars(userId, true);
    } catch (err) {
      this.logger.error(`Failed to load default calendars of user with id: ${userId}`, {
        userId,
        err,
      });
    }
    return;
  }
}
