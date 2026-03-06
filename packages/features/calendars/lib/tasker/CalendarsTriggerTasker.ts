import type { CalendarCancellationSyncService } from "@calcom/features/calendars/lib/cancellation-sync/CalendarCancellationSyncService";
import type { ITaskerDependencies } from "@calcom/lib/tasker/types";
import type { TriggerOptions } from "@trigger.dev/sdk";

import type { ICalendarsTasker } from "./types";

/**
 * Extended dependency interface for CalendarsTriggerTasker.
 * Adds the optional cancellation sync service that is resolved from the DI container
 * via the CALENDAR_CANCELLATION_SYNC_SERVICE token in CalendarsTriggerTasker.module.ts.
 */
export interface ICalendarsTriggerTaskerDependencies {
  cancellationSyncService?: CalendarCancellationSyncService;
}

export class CalendarsTriggerTasker implements ICalendarsTasker {
  constructor(
    public readonly dependencies: ITaskerDependencies & ICalendarsTriggerTaskerDependencies
  ) {}

  async ensureDefaultCalendars(
    payload: Parameters<ICalendarsTasker["ensureDefaultCalendars"]>[0],
    options?: TriggerOptions
  ): Promise<{ runId: string }> {
    const { ensureDefaultCalendars } = await import("./trigger/ensure-default-calendars");
    const handle = await ensureDefaultCalendars.trigger(payload, options);
    return { runId: handle.id };
  }

  /**
   * Trigger a cancellation sync task when an external calendar change notification arrives.
   * CI-001 gap: Dispatches cancellation-sync processing for Google Calendar push notifications
   * and Microsoft Graph change notifications that indicate event deletion or decline.
   *
   * Unlike ensureDefaultCalendars which uses Trigger.dev's schemaTask infrastructure,
   * this method delegates to CalendarCancellationSyncService directly since cancellation
   * sync is a lightweight, latency-sensitive operation that doesn't require queue-based
   * scheduling. The feature flag check happens inside CalendarCancellationSyncService.
   *
   * The CalendarCancellationSyncService is resolved from the DI container via the
   * CALENDAR_CANCELLATION_SYNC_SERVICE token registered in CalendarsTaskService.module.ts.
   */
  async triggerCancellationSync(payload: {
    externalEventUid: string;
    externalCalendarId?: string;
    provider: "google_calendar" | "office365_calendar";
    reason?: string;
  }): Promise<{ runId: string; success: boolean }> {
    const runId = `cancellation_trigger_${crypto.randomUUID()}`;
    try {
      const cancellationSyncService = this.dependencies.cancellationSyncService;
      if (!cancellationSyncService) {
        this.dependencies.logger?.error?.(
          "CalendarsTriggerTasker: cancellationSyncService not available in DI container"
        );
        return { runId, success: false };
      }

      const result = await cancellationSyncService.handleExternalCancellation(payload);
      return { runId, success: result.success };
    } catch (error) {
      this.dependencies.logger?.error?.(
        "CalendarsTriggerTasker triggerCancellationSync failed",
        { provider: payload.provider, externalEventUid: payload.externalEventUid }
      );
      return { runId, success: false };
    }
  }
}
