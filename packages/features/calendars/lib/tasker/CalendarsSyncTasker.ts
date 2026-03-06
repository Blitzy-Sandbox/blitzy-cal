import type { ITaskerDependencies } from "@calcom/lib/tasker/types";
import { nanoid } from "nanoid";

import type { CalendarsTaskService } from "./CalendarsTaskService";
import type { ICalendarsTasker } from "./types";

export interface ICalendarsSyncTaskerDependencies {
  calendarsTaskService: CalendarsTaskService;
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
   * Gated behind the 'calendar-cancellation-sync' feature flag.
   */
  async processCancellationSyncEvent(payload: {
    externalEventUid: string;
    externalCalendarId?: string;
    provider: "google_calendar" | "office365_calendar";
    reason?: string;
  }): Promise<{ runId: string; success: boolean }> {
    const runId = `cancellation_sync_${nanoid(10)}`;

    try {
      // Lazy import to avoid circular dependencies and heavy bootstrapping
      const { CalendarCancellationSyncService } = await import(
        "../cancellation-sync/CalendarCancellationSyncService"
      );

      // Minimal dependency injection — the service uses Prisma directly
      // Feature flag check happens inside the service
      const cancellationSyncService = new CalendarCancellationSyncService({
        featureRepository: {
          checkIfFeatureIsEnabledGlobally: async (slug: string) => {
            // Lazy import of features repository to check feature flag
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
      return { runId, success: result.success };
    } catch (error) {
      return { runId, success: false };
    }
  }
}
