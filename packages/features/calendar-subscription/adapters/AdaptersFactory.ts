import { GoogleCalendarSubscriptionAdapter } from "@calcom/features/calendar-subscription/adapters/GoogleCalendarSubscription.adapter";
import { Office365CalendarSubscriptionAdapter } from "@calcom/features/calendar-subscription/adapters/Office365CalendarSubscription.adapter";
import type { ICalendarSubscriptionPort } from "@calcom/features/calendar-subscription/lib/CalendarSubscriptionPort.interface";

export type CalendarSubscriptionProvider = "google_calendar" | "office365_calendar";

/**
 * Generic calendar suffixes that should be excluded from subscription.
 * These are special calendars (holidays, contacts, shared, imported, resources)
 * that are not user's personal calendars and shouldn't be subscribed to for sync.
 */
export const GENERIC_CALENDAR_SUFFIXES: Record<CalendarSubscriptionProvider, string[]> = {
  google_calendar: [
    "@group.v.calendar.google.com",
    "@group.calendar.google.com",
    "@import.calendar.google.com",
    "@resource.calendar.google.com",
  ],
  office365_calendar: [],
};

/**
 * Providers that support cancellation-sync push notification channels.
 * These adapters can subscribe to external calendar change notifications
 * to detect event deletions/declines and propagate cancellations back to Cal.com.
 *
 * Google Calendar: Uses push notification channels via events.watch
 * Office 365: Uses Microsoft Graph change notifications via POST /subscriptions
 *
 * @see CI-001 gap closure — Calendar-driven cancellation sync
 */
export const CANCELLATION_SYNC_CAPABLE_PROVIDERS: CalendarSubscriptionProvider[] = [
  "google_calendar",
  "office365_calendar",
];

export interface AdapterFactory {
  get(provider: CalendarSubscriptionProvider): ICalendarSubscriptionPort;
  getProviders(): CalendarSubscriptionProvider[];
  getGenericCalendarSuffixes(): string[];
  /** Returns providers that support cancellation-sync push notification channels (CI-001 gap) */
  getCancellationSyncCapableProviders(): CalendarSubscriptionProvider[];
}

/**
 * Default adapter factory
 */
export class DefaultAdapterFactory implements AdapterFactory {
  private singletons = {
    google_calendar: new GoogleCalendarSubscriptionAdapter(),
    office365_calendar: new Office365CalendarSubscriptionAdapter(),
  } as const;

  /**
   * Returns the adapter for the given provider
   *
   * @param provider
   * @returns
   */
  get(provider: CalendarSubscriptionProvider): ICalendarSubscriptionPort {
    const adapter = this.singletons[provider];
    if (!adapter) {
      throw new Error(`No adapter found for provider ${provider}`);
    }
    return adapter;
  }

  /**
   * Returns all available providers
   *
   * @returns
   */
  getProviders(): CalendarSubscriptionProvider[] {
    const providers: CalendarSubscriptionProvider[] = ["google_calendar"];
    return providers;
  }

  /**
   * Returns all generic calendar suffixes that should be excluded from subscription
   * across all supported providers.
   *
   * @returns
   */
  getGenericCalendarSuffixes(): string[] {
    return this.getProviders().flatMap((provider) => GENERIC_CALENDAR_SUFFIXES[provider]);
  }

  /**
   * Returns all providers that support cancellation-sync push notification channels.
   * Used by CalendarCancellationSyncService to determine which adapters can be
   * enrolled for external calendar change notification subscriptions.
   *
   * @returns Array of provider identifiers supporting cancellation-sync
   */
  getCancellationSyncCapableProviders(): CalendarSubscriptionProvider[] {
    return CANCELLATION_SYNC_CAPABLE_PROVIDERS;
  }
}
