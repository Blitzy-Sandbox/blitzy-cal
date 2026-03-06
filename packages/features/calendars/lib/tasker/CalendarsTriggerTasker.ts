import type { ITaskerDependencies } from "@calcom/lib/tasker/types";
import type { TriggerOptions } from "@trigger.dev/sdk";
import type { ICalendarsTasker } from "./types";

export class CalendarsTriggerTasker implements ICalendarsTasker {
  constructor(public readonly dependencies: ITaskerDependencies) {}

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
   */
  async triggerCancellationSync(payload: {
    externalEventUid: string;
    externalCalendarId?: string;
    provider: "google_calendar" | "office365_calendar";
    reason?: string;
  }): Promise<{ runId: string; success: boolean }> {
    try {
      // Lazy import cancellation handlers to avoid loading heavy dependencies at module init
      const { CalendarCancellationSyncService } = await import(
        "../cancellation-sync/CalendarCancellationSyncService"
      );

      // Construct the service with minimal dependency injection
      const cancellationSyncService = new CalendarCancellationSyncService({
        featureRepository: {
          checkIfFeatureIsEnabledGlobally: async (slug: string) => {
            const { FeaturesRepository } = await import(
              "@calcom/features/flags/features.repository"
            );
            const prisma = (await import("@calcom/prisma")).default;
            const featuresRepo = new FeaturesRepository(prisma);
            return featuresRepo.checkIfFeatureIsEnabledGlobally(slug as any);
          },
        },
      });

      const result = await cancellationSyncService.handleExternalCancellation(payload);
      return { runId: `cancellation_trigger_${Date.now()}`, success: result.success };
    } catch (error) {
      this.dependencies.logger?.error?.(
        "CalendarsTriggerTasker triggerCancellationSync failed",
        { provider: payload.provider, externalEventUid: payload.externalEventUid }
      );
      return { runId: `cancellation_trigger_${Date.now()}`, success: false };
    }
  }
}
