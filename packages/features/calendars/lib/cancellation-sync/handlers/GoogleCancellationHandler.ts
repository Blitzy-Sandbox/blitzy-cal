import logger from "@calcom/lib/logger";

import type { CalendarCancellationSyncService } from "../CalendarCancellationSyncService";

// biome-ignore lint/nursery/useExplicitType: logger type is inferred
const log = logger.getSubLogger({ prefix: ["GoogleCancellationHandler"] });

/**
 * Google Calendar push notification resource states.
 *
 * Google delivers push notifications with an `X-Goog-Resource-State` header
 * indicating the type of change that occurred on the watched resource.
 *
 * @see https://developers.google.com/calendar/api/guides/push#understanding-the-notification-message
 */
type GoogleResourceState = "sync" | "exists" | "not_exists";

/**
 * Parsed notification data extracted from Google Calendar push notification headers.
 *
 * Google Calendar push notifications deliver information exclusively through
 * HTTP headers — NOT through the request body. This interface captures all
 * relevant headers for processing cancellation events.
 */
interface GoogleNotificationPayload {
  /** The channel ID from X-Goog-Channel-ID header — UUID identifier from the events.watch subscription */
  channelId: string;
  /** The resource ID from X-Goog-Resource-ID header — opaque identifier for the watched resource */
  resourceId: string;
  /** The resource state from X-Goog-Resource-State header — indicates the type of change */
  resourceState: GoogleResourceState;
  /** The resource URI from X-Goog-Resource-URI header — API URI of the changed resource (optional) */
  resourceUri?: string;
  /** The message number from X-Goog-Message-Number header — incrementing counter per channel (optional) */
  messageNumber?: string;
  /** The channel expiration from X-Goog-Channel-Expiration header — ISO 8601 expiry time (optional) */
  channelExpiration?: string;
}

/**
 * GoogleCancellationHandler — Processes Google Calendar push notification payloads
 * to detect event deletions and attendee declines, then delegates cancellation
 * propagation to CalendarCancellationSyncService.
 *
 * Part of the CI-001 gap closure — Calendar-Driven Cancellation Sync.
 *
 * Architecture:
 * ```
 * Google Calendar Push Notification (POST to webhook endpoint)
 *   → GoogleCancellationHandler.handleNotification(request)
 *     → Validate X-Goog-Channel-Token header for security
 *     → Extract X-Goog-Resource-State header to determine notification type
 *     → For "exists" / "not_exists" notifications: check for cancellation
 *     → Delegate to CalendarCancellationSyncService.handleExternalCancellation()
 * ```
 *
 * This handler follows the adapter pattern established in
 * `GoogleCalendarSubscription.adapter.ts`:
 * - Uses structured logging with `logger.getSubLogger`
 * - Validates `X-Goog-Channel-Token` header against configured GOOGLE_WEBHOOK_TOKEN
 * - Class-based with clear methods for validation, extraction, and processing
 *
 * Security:
 * - All requests are validated against the GOOGLE_WEBHOOK_TOKEN environment variable
 *   before any notification processing occurs.
 *
 * Feature flag:
 * - The `calendar-cancellation-sync` feature flag check is handled by
 *   `CalendarCancellationSyncService.handleExternalCancellation()` — this handler
 *   delegates to it, which checks the flag BEFORE any cancellation processing.
 *
 * Data safety:
 * - Does NOT access any database tables directly — all DB operations are delegated
 *   to CalendarCancellationSyncService.
 * - Does NOT modify any webhook payloads — cancellation webhooks are triggered by
 *   handleCancelBooking via the sync service.
 */
export class GoogleCancellationHandler {
  /**
   * The webhook token used to validate incoming Google Calendar push notifications.
   * Must match the token configured when the events.watch subscription was created.
   * Read from the GOOGLE_WEBHOOK_TOKEN environment variable.
   */
  private GOOGLE_WEBHOOK_TOKEN = process.env.GOOGLE_WEBHOOK_TOKEN;

  /**
   * Constructs the GoogleCancellationHandler with its required dependencies.
   *
   * @param cancellationSyncService - The service responsible for propagating
   *   cancellations from external calendar events to Cal.com bookings. Injected
   *   via constructor dependency injection following the DI pattern used in
   *   CalendarSubscriptionService.
   */
  constructor(private cancellationSyncService: CalendarCancellationSyncService) {}

  /**
   * Validates the incoming Google Calendar push notification request.
   *
   * Checks the `X-Goog-Channel-Token` header against the configured
   * `GOOGLE_WEBHOOK_TOKEN` environment variable. This prevents unauthorized
   * or spoofed push notifications from being processed.
   *
   * Mirrors the validation logic in `GoogleCalendarSubscription.adapter.ts`
   * with enhanced diagnostic logging for each failure case.
   *
   * @param request - The incoming HTTP request with Google push notification headers.
   * @returns `true` if the request is valid, `false` otherwise.
   */
  async validateRequest(request: Request): Promise<boolean> {
    const token = request?.headers?.get("X-Goog-Channel-Token");

    if (!this.GOOGLE_WEBHOOK_TOKEN) {
      log.warn("GOOGLE_WEBHOOK_TOKEN not configured — cannot validate push notification");
      return false;
    }

    if (!token) {
      log.warn("Missing X-Goog-Channel-Token header in push notification");
      return false;
    }

    if (token !== this.GOOGLE_WEBHOOK_TOKEN) {
      log.warn("Invalid X-Goog-Channel-Token in push notification");
      return false;
    }

    return true;
  }

  /**
   * Extracts the notification payload from Google Calendar push notification headers.
   *
   * Google push notifications encode all information in HTTP headers:
   * - `X-Goog-Channel-ID` — UUID channel identifier from the events.watch subscription
   * - `X-Goog-Resource-ID` — Opaque ID of the watched resource
   * - `X-Goog-Resource-State` — Type of change: "sync", "exists", or "not_exists"
   * - `X-Goog-Resource-URI` — API URI of the changed resource (optional)
   * - `X-Goog-Message-Number` — Incrementing message counter (optional)
   * - `X-Goog-Channel-Expiration` — Channel expiry time (optional)
   *
   * @param request - The incoming HTTP request with Google push notification headers.
   * @returns The parsed notification payload, or `null` if required headers are missing.
   */
  extractNotificationPayload(request: Request): GoogleNotificationPayload | null {
    const channelId = request?.headers?.get("X-Goog-Channel-ID");
    const resourceId = request?.headers?.get("X-Goog-Resource-ID");
    const resourceState = request?.headers?.get("X-Goog-Resource-State") as GoogleResourceState | null;

    if (!channelId || !resourceId || !resourceState) {
      log.warn("Missing required headers in Google push notification", {
        hasChannelId: !!channelId,
        hasResourceId: !!resourceId,
        hasResourceState: !!resourceState,
      });
      return null;
    }

    return {
      channelId,
      resourceId,
      resourceState,
      resourceUri: request?.headers?.get("X-Goog-Resource-URI") ?? undefined,
      messageNumber: request?.headers?.get("X-Goog-Message-Number") ?? undefined,
      channelExpiration: request?.headers?.get("X-Goog-Channel-Expiration") ?? undefined,
    };
  }

  /**
   * Handles an incoming Google Calendar push notification.
   *
   * Google push notifications are "thin" — they indicate that a resource has changed
   * but do NOT include the event details in the payload. The notification only conveys
   * "something changed" via the `X-Goog-Resource-State` header.
   *
   * For cancellation detection, we process:
   * - `"sync"` state: Initial sync confirmation — acknowledged and skipped.
   * - `"exists"` state: The resource was modified — may indicate event deletion or
   *   attendee decline. If an `externalEventUid` is provided (from pre-processed
   *   sync delta), directly trigger cancellation propagation.
   * - `"not_exists"` state: The resource was explicitly deleted — strongest signal
   *   of deletion. If an `externalEventUid` is provided, propagate cancellation.
   *
   * This handler supports two modes:
   * 1. **Direct mode** — When `externalEventUid` is provided (from pre-processed
   *    sync delta), directly delegate to CalendarCancellationSyncService.
   * 2. **Notification-only mode** — When no `externalEventUid`, acknowledge the
   *    notification and log it for the sync pipeline to process.
   *
   * @param request - The incoming HTTP request with Google push notification headers.
   * @param externalEventUid - Optional pre-resolved external event UID (from sync
   *   delta processing). When provided, enables direct cancellation propagation
   *   without requiring a separate sync delta resolution step.
   * @returns Result of the notification handling, including success status, message,
   *   and optionally the cancelled booking ID.
   */
  async handleNotification(
    request: Request,
    externalEventUid?: string
  ): Promise<{ success: boolean; message: string; bookingId?: number }> {
    // Step 1: Validate the request against the configured webhook token
    const isValid = await this.validateRequest(request);
    if (!isValid) {
      return { success: false, message: "Invalid request" };
    }

    // Step 2: Extract notification payload from Google-specific headers
    const payload = this.extractNotificationPayload(request);
    if (!payload) {
      return { success: false, message: "Missing notification payload" };
    }

    log.info("Processing Google Calendar push notification", {
      channelId: payload.channelId,
      resourceState: payload.resourceState,
      messageNumber: payload.messageNumber,
    });

    // Step 3: Handle based on resource state
    switch (payload.resourceState) {
      case "sync":
        // Initial sync confirmation — acknowledge without further processing.
        // Google sends this when a watch channel is first established.
        log.debug("Google Calendar sync confirmation received", {
          channelId: payload.channelId,
        });
        return { success: true, message: "Sync confirmation acknowledged" };

      case "not_exists":
        // Resource was deleted — this is the strongest signal of event removal.
        // If we have a pre-resolved event UID, propagate cancellation immediately.
        if (externalEventUid) {
          log.info("Google Calendar resource deleted, propagating cancellation", {
            channelId: payload.channelId,
            externalEventUid,
          });
          return this.cancellationSyncService.handleExternalCancellation({
            externalEventUid,
            provider: "google_calendar",
            reason: "Event deleted from Google Calendar",
          });
        }
        // No pre-resolved event UID — the sync infrastructure needs to fetch
        // the actual event changes via the Google Calendar API.
        log.info(
          "Google Calendar resource deleted but no event UID provided — requires sync delta resolution",
          {
            channelId: payload.channelId,
            resourceId: payload.resourceId,
          }
        );
        return { success: true, message: "Resource deletion noted, awaiting sync delta resolution" };

      case "exists":
        // Resource was modified — may indicate deletion, decline, or other changes.
        // With a pre-resolved event UID, we can propagate cancellation directly.
        if (externalEventUid) {
          log.info("Google Calendar resource changed, propagating cancellation", {
            channelId: payload.channelId,
            externalEventUid,
          });
          return this.cancellationSyncService.handleExternalCancellation({
            externalEventUid,
            provider: "google_calendar",
            reason: "Event cancelled or declined in Google Calendar",
          });
        }
        // No pre-resolved event UID — log for the sync pipeline to process.
        log.debug(
          "Google Calendar resource changed but no event UID — requires sync delta processing",
          {
            channelId: payload.channelId,
            resourceId: payload.resourceId,
          }
        );
        return { success: true, message: "Resource change noted, awaiting sync delta resolution" };

      default:
        // Unknown resource state — log a warning and indicate failure.
        log.warn("Unknown Google Calendar resource state", {
          resourceState: payload.resourceState,
          channelId: payload.channelId,
        });
        return { success: false, message: `Unknown resource state: ${payload.resourceState}` };
    }
  }

  /**
   * Processes a pre-resolved sync delta event for cancellation detection.
   *
   * This method is called when the calendar sync infrastructure has already
   * fetched the changed events from Google Calendar (via events.list with
   * syncToken) and determined that a specific event was deleted or cancelled.
   *
   * Only events with status `"cancelled"` trigger cancellation propagation.
   * All other statuses (e.g., "confirmed", "tentative") are acknowledged
   * but not processed as cancellations.
   *
   * @param eventUid - The external calendar event UID (Google event ID).
   * @param eventStatus - The status of the event as returned by the Google
   *   Calendar API (e.g., "cancelled", "confirmed", "tentative").
   * @returns Result of the cancellation handling, including success status,
   *   message, and optionally the cancelled booking ID.
   */
  async handleSyncDeltaEvent(
    eventUid: string,
    eventStatus: string
  ): Promise<{ success: boolean; message: string; bookingId?: number }> {
    if (eventStatus !== "cancelled") {
      log.debug("Google Calendar sync delta event is not a cancellation, skipping", {
        eventUid,
        eventStatus,
      });
      return { success: true, message: "Event not cancelled" };
    }

    log.info("Processing Google Calendar sync delta cancellation", {
      eventUid,
      eventStatus,
    });

    return this.cancellationSyncService.handleExternalCancellation({
      externalEventUid: eventUid,
      provider: "google_calendar",
      reason: "Event cancelled in Google Calendar (detected via sync delta)",
    });
  }
}
