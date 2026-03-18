import type { CalendarCancellationSyncService } from "@calcom/features/calendars/lib/cancellation-sync/CalendarCancellationSyncService";
import type { ITaskerDependencies } from "@calcom/lib/tasker/types";
import logger from "@calcom/lib/logger";
import { nanoid } from "nanoid";

import type { CalendarsTaskService } from "./CalendarsTaskService";
import type { ICalendarsTasker } from "./types";

// biome-ignore lint/nursery/useExplicitType: logger type is inferred
const log = logger.getSubLogger({ prefix: ["CalendarsSyncTasker"] });

export interface ICalendarsSyncTaskerDependencies {
  calendarsTaskService: CalendarsTaskService;
  cancellationSyncService?: CalendarCancellationSyncService;
}

export class CalendarsSyncTasker implements ICalendarsTasker {
  constructor(public readonly dependencies: ITaskerDependencies & ICalendarsSyncTaskerDependencies) {}

  async ensureDefaultCalendars(
    payload: Parameters<ICalendarsTasker["ensureDefaultCalendars"]>[0]
  ): Promise<{ runId: string }> {
    const runId = `sync_${nanoid(10)}`;
    await this.dependencies.calendarsTaskService.ensureDefaultCalendars(payload);
    return { runId };
  }

  /**
   * Process a cancellation sync event from an external calendar provider.
   * CI-001 gap: Detects event deletions/declines in external calendars
   * (Google push notifications, Microsoft Graph change notifications)
   * and propagates cancellations back to Cal.com.
   *
   * The CalendarCancellationSyncService is resolved from the DI container via the
   * CALENDAR_CANCELLATION_SYNC_SERVICE token registered in CalendarsTaskService.module.ts.
   *
   * Gated behind the 'calendar-cancellation-sync' feature flag (checked inside the service).
   */
  async processCancellationSyncEvent(payload: {
    externalEventUid: string;
    externalCalendarId?: string;
    provider: "google_calendar" | "office365_calendar";
    reason?: string;
  }): Promise<{ runId: string; success: boolean }> {
    const runId = `cancellation_sync_${nanoid(10)}`;

    try {
      const cancellationSyncService = this.dependencies.cancellationSyncService;
      if (!cancellationSyncService) {
        log.error("CalendarsSyncTasker: cancellationSyncService not available in DI container");
        return { runId, success: false };
      }

      const result = await cancellationSyncService.handleExternalCancellation(payload);
      return { runId, success: result.success };
    } catch (error) {
      log.error("Failed to process cancellation sync event", {
        provider: payload.provider,
        externalEventUid: payload.externalEventUid,
        error: error instanceof Error ? error.message : String(error),
      });
      return { runId, success: false };
    }
  }
}
