import logger from "@calcom/lib/logger";

import type { CalendarCancellationSyncService } from "../CalendarCancellationSyncService";

// biome-ignore lint/nursery/useExplicitType: logger type is inferred
const log = logger.getSubLogger({ prefix: ["OutlookCancellationHandler"] });

// ---------------------------------------------------------------------------
// Microsoft Graph Change Notification Types
// ---------------------------------------------------------------------------

/**
 * Microsoft Graph change notification change types.
 * @see https://learn.microsoft.com/en-us/graph/api/resources/changenotification
 */
type GraphChangeType = "created" | "updated" | "deleted";

/**
 * A single change notification from Microsoft Graph.
 * Represents one event change within a notification batch.
 */
interface GraphChangeNotification {
  /** The subscription ID that triggered this notification */
  subscriptionId: string;
  /** The subscription expiration date-time (ISO 8601) */
  subscriptionExpirationDateTime?: string;
  /** The type of change: created, updated, or deleted */
  changeType: GraphChangeType;
  /** The resource path that changed (e.g., "me/events/{id}") */
  resource: string;
  /** Additional resource data provided by Graph */
  resourceData?: {
    /** The OData type of the resource */
    "@odata.type"?: string;
    /** The OData ID of the resource */
    "@odata.id"?: string;
    /** The OData etag of the resource */
    "@odata.etag"?: string;
    /** The resource ID */
    id?: string;
  };
  /** The client state token for validation (set during subscription creation) */
  clientState?: string;
  /** The tenant ID for multi-tenant applications */
  tenantId?: string;
}

/**
 * The full change notification request body from Microsoft Graph.
 * Contains an array of change notifications delivered in a single POST.
 */
interface GraphChangeNotificationPayload {
  /** Array of change notifications in this batch */
  value: GraphChangeNotification[];
}

/**
 * Result of handling a single change notification.
 * Provides observability into per-notification processing outcomes.
 */
interface NotificationResult {
  /** Whether the notification was processed successfully */
  success: boolean;
  /** Human-readable outcome description */
  message: string;
  /** The Cal.com booking ID that was cancelled, if applicable */
  bookingId?: number;
  /** The change type from the original notification */
  changeType: string;
  /** The resource path from the original notification */
  resource: string;
}

// ---------------------------------------------------------------------------
// OutlookCancellationHandler
// ---------------------------------------------------------------------------

/**
 * Processes Microsoft Graph change notification payloads to detect event
 * deletions and attendee declines in Outlook / Office 365 calendars, then
 * delegates cancellation propagation to {@link CalendarCancellationSyncService}.
 *
 * Part of the CI-001 gap closure — Calendar-Driven Cancellation Sync.
 *
 * Architecture:
 * ```
 * Microsoft Graph Change Notification (POST to webhook endpoint)
 *   → OutlookCancellationHandler.handleNotification(request)
 *     → Handle subscription validation flow (validationToken in query params)
 *     → Validate clientState for security
 *     → Parse change notification payload from request body
 *     → Detect deleted/cancelled events from changeType
 *     → Delegate to CalendarCancellationSyncService.handleExternalCancellation()
 * ```
 *
 * Security model:
 * - Validates `clientState` against `MICROSOFT_WEBHOOK_TOKEN` env var before
 *   processing any notification — same pattern as
 *   {@link Office365CalendarSubscriptionAdapter.validate}.
 * - Handles Graph subscription validation handshake (validationToken query
 *   parameter) so the API route can echo the token back as `text/plain`.
 *
 * Feature flag gating:
 * - The `calendar-cancellation-sync` feature flag is checked inside
 *   `CalendarCancellationSyncService.handleExternalCancellation()`, not here.
 *   This handler focuses solely on notification parsing and validation.
 *
 * Data safety:
 * - Does NOT access any database tables directly — all DB operations are
 *   delegated to CalendarCancellationSyncService.
 * - Does NOT modify webhook payloads — cancellation webhooks flow through
 *   the standard handleCancelBooking pipeline.
 */
export class OutlookCancellationHandler {
  /**
   * Webhook token used to validate incoming Microsoft Graph change
   * notifications. Must match the `clientState` value set during
   * subscription creation.
   */
  private MICROSOFT_WEBHOOK_TOKEN = process.env.MICROSOFT_WEBHOOK_TOKEN;

  /**
   * Creates a new OutlookCancellationHandler.
   *
   * @param cancellationSyncService - Service handling the cancellation
   *   propagation from external calendar events to Cal.com bookings.
   *   Injected via constructor dependency injection.
   */
  constructor(private cancellationSyncService: CalendarCancellationSyncService) {}

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Validates the incoming Microsoft Graph change notification request.
   *
   * Microsoft Graph has two validation scenarios:
   * 1. **Subscription validation**: When creating a subscription, Graph
   *    sends a validation request with a `validationToken` query parameter.
   *    The handler must respond with the token value (handled at the API
   *    route level, not here — we return the token for the route to echo).
   * 2. **Notification validation**: For actual change notifications, we
   *    validate the `clientState` field against the configured
   *    `MICROSOFT_WEBHOOK_TOKEN` environment variable.
   *
   * @param request - The incoming HTTP request.
   * @returns Object with `isValid` flag and optional `validationToken` for
   *   the subscription handshake flow.
   */
  async validateRequest(
    request: Request
  ): Promise<{ isValid: boolean; validationToken?: string }> {
    // Step 1: Check for subscription validation handshake
    if (request?.url) {
      try {
        const urlObj = new URL(request.url);
        const validationToken = urlObj.searchParams.get("validationToken");
        if (validationToken) {
          log.debug("Microsoft Graph subscription validation handshake received");
          return { isValid: true, validationToken };
        }
      } catch {
        log.warn("Invalid request URL during validation token check", {
          url: request.url,
        });
      }
    }

    // Step 2: Validate clientState for notification security
    if (!this.MICROSOFT_WEBHOOK_TOKEN) {
      log.warn("MICROSOFT_WEBHOOK_TOKEN not configured — cannot validate change notification");
      return { isValid: false };
    }

    // Extract clientState from headers or body (mirroring
    // Office365CalendarSubscription.adapter.ts validate() logic)
    let clientState: string | undefined;

    // Try headers first
    clientState = request?.headers?.get("clientState") ?? undefined;

    // Fall back to request body (may be pre-parsed by NestJS / Next.js
    // middleware, in which case `request.body` is a plain object rather
    // than the native ReadableStream).
    if (!clientState && request?.body && typeof request.body === "object" && request.body !== null) {
      // Cast via `unknown` first to satisfy TypeScript — the native
      // Request.body is ReadableStream, but API frameworks overwrite it
      // with a parsed object before it reaches this handler.
      const body = request.body as unknown as Record<string, unknown>;
      if ("clientState" in body) {
        clientState = body.clientState as string;
      }
      // Also check within the value array notifications
      if (!clientState && "value" in body && Array.isArray(body.value) && body.value.length > 0) {
        const firstNotification = body.value[0] as GraphChangeNotification;
        clientState = firstNotification?.clientState;
      }
    }

    if (clientState !== this.MICROSOFT_WEBHOOK_TOKEN) {
      log.warn("Invalid clientState in Microsoft Graph change notification");
      return { isValid: false };
    }

    return { isValid: true };
  }

  /**
   * Extracts change notification entries from the Microsoft Graph request body.
   *
   * Microsoft Graph delivers change notifications as a JSON body with a
   * `value` array containing one or more {@link GraphChangeNotification}
   * objects.
   *
   * @param requestBody - The parsed JSON request body.
   * @returns Array of change notifications, or empty array if parsing fails.
   */
  extractNotifications(requestBody: unknown): GraphChangeNotification[] {
    if (!requestBody || typeof requestBody !== "object") {
      log.warn("Invalid or missing request body for Microsoft Graph change notification");
      return [];
    }

    const body = requestBody as Record<string, unknown>;

    if (!("value" in body) || !Array.isArray(body.value)) {
      log.warn("Missing 'value' array in Microsoft Graph change notification payload");
      return [];
    }

    return body.value as GraphChangeNotification[];
  }

  /**
   * Handles an incoming Microsoft Graph change notification batch.
   *
   * Unlike Google push notifications (which use only HTTP headers),
   * Microsoft Graph change notifications include structured data in the
   * request body with:
   * - `changeType`: "created", "updated", or "deleted"
   * - `resource`: The resource path that changed
   * - `resourceData`: Optional embedded resource data
   *
   * For cancellation detection, we process:
   * - `"deleted"` changeType → event was deleted from the calendar
   * - `"updated"` changeType → logged; cancellation detection is deferred
   *   to the sync delta pipeline where full event data can be inspected
   * - `"created"` changeType → skipped (not relevant for cancellation)
   *
   * @param request - The incoming HTTP request.
   * @param requestBody - The parsed JSON request body (may be pre-parsed
   *   by the API framework such as NestJS or Next.js).
   * @returns Aggregated result with per-notification details and an optional
   *   `validationToken` for subscription handshake flows.
   */
  async handleNotification(
    request: Request,
    requestBody?: unknown
  ): Promise<{
    success: boolean;
    message: string;
    results: NotificationResult[];
    validationToken?: string;
  }> {
    // Step 1: Validate the request
    const validation = await this.validateRequest(request);

    if (validation.validationToken) {
      // Subscription validation handshake — return the token for the
      // API route to respond with (text/plain, raw token value).
      return {
        success: true,
        message: "Subscription validation",
        results: [],
        validationToken: validation.validationToken,
      };
    }

    if (!validation.isValid) {
      return { success: false, message: "Invalid request", results: [] };
    }

    // Step 2: Extract notifications from body
    const body = requestBody ?? request.body;
    const notifications = this.extractNotifications(body);

    if (notifications.length === 0) {
      log.warn("No change notifications found in Microsoft Graph payload");
      return { success: false, message: "No notifications found", results: [] };
    }

    log.info("Processing Microsoft Graph change notifications", {
      notificationCount: notifications.length,
    });

    // Step 3: Process each notification in the batch sequentially
    const results: NotificationResult[] = [];

    for (const notification of notifications) {
      const result = await this.processChangeNotification(notification);
      results.push(result);
    }

    const successCount = results.filter((r) => r.success).length;
    return {
      success: successCount > 0 || results.length === 0,
      message: `Processed ${results.length} notifications (${successCount} successful)`,
      results,
    };
  }

  /**
   * Processes a pre-resolved sync delta event for cancellation detection.
   *
   * Called by the calendar sync infrastructure when it has already fetched
   * the changed events via Microsoft Graph delta queries and determined
   * that an event was cancelled (via `isCancelled` property on the Graph
   * event resource — see Office365CalendarSubscription.adapter.ts
   * parseEvents).
   *
   * @param eventUid - The external calendar event UID (from Graph).
   * @param isCancelled - Whether the event has been marked as cancelled.
   * @returns Result of the cancellation handling.
   */
  async handleSyncDeltaEvent(
    eventUid: string,
    isCancelled: boolean
  ): Promise<{ success: boolean; message: string; bookingId?: number }> {
    if (!isCancelled) {
      log.debug("Outlook sync delta event is not a cancellation, skipping", {
        eventUid,
      });
      return { success: true, message: "Event not cancelled" };
    }

    log.info("Processing Outlook sync delta cancellation", {
      eventUid,
    });

    return this.cancellationSyncService.handleExternalCancellation({
      externalEventUid: eventUid,
      provider: "office365_calendar",
      reason: "Event cancelled in Outlook calendar (detected via sync delta)",
    });
  }

  /**
   * Detects if a notification indicates the subscription needs renewal.
   *
   * Microsoft Graph subscriptions have limited lifetimes — calendar event
   * subscriptions default to a 3-day TTL (see
   * Office365CalendarSubscription.adapter.ts `subscriptionTtlMs`). This
   * method inspects the `subscriptionExpirationDateTime` field and returns
   * `true` when less than 24 hours remain, allowing the subscription
   * management layer to proactively renew before expiry.
   *
   * @param notification - The change notification to inspect.
   * @returns `true` if the subscription should be renewed.
   */
  isSubscriptionRenewalNeeded(notification: GraphChangeNotification): boolean {
    if (notification.subscriptionExpirationDateTime) {
      const expiration = new Date(notification.subscriptionExpirationDateTime);
      const now = new Date();
      const hoursUntilExpiry = (expiration.getTime() - now.getTime()) / (1000 * 60 * 60);

      if (hoursUntilExpiry < 24) {
        log.info("Microsoft Graph subscription nearing expiration", {
          subscriptionId: notification.subscriptionId,
          expirationDateTime: notification.subscriptionExpirationDateTime,
          hoursUntilExpiry: Math.round(hoursUntilExpiry),
        });
        return true;
      }
    }
    return false;
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  /**
   * Extracts the event ID from a Microsoft Graph resource path.
   *
   * Resource paths follow patterns like:
   * - `"me/events/{eventId}"`
   * - `"users/{userId}/events/{eventId}"`
   * - `"me/calendars/{calendarId}/events/{eventId}"`
   *
   * When `resourceData` is present and contains an `id` field, that value
   * is preferred over parsing the resource path string.
   *
   * @param resource - The Graph resource path.
   * @param resourceData - Optional resource data containing the ID directly.
   * @returns The extracted event ID, or `null` if extraction fails.
   */
  private extractEventIdFromResource(
    resource: string,
    resourceData?: GraphChangeNotification["resourceData"]
  ): string | null {
    // Prefer the ID from resourceData if available
    if (resourceData?.id) {
      return resourceData.id;
    }

    // Extract from resource path: look for the segment after "events/"
    const eventsIndex = resource.indexOf("/events/");
    if (eventsIndex !== -1) {
      const afterEvents = resource.substring(eventsIndex + "/events/".length);
      // Take everything up to the next "/" or end of string
      const eventId = afterEvents.split("/")[0];
      if (eventId) {
        return eventId;
      }
    }

    return null;
  }

  /**
   * Processes a single Microsoft Graph change notification.
   *
   * Routing logic by change type:
   * - `"deleted"` → Directly triggers cancellation via
   *   `CalendarCancellationSyncService.handleExternalCancellation()`
   * - `"updated"` → Logged; cancellation detection deferred to sync delta
   *   pipeline (update payloads may or may not represent cancellations —
   *   full event data is needed to determine status)
   * - `"created"` → Skipped (new events are not relevant for cancellation)
   *
   * @param notification - The change notification to process.
   * @returns Result of processing this notification.
   */
  private async processChangeNotification(
    notification: GraphChangeNotification
  ): Promise<NotificationResult> {
    const eventId = this.extractEventIdFromResource(
      notification.resource,
      notification.resourceData
    );

    const baseResult = {
      changeType: notification.changeType,
      resource: notification.resource,
    };

    if (!eventId) {
      log.warn("Could not extract event ID from Microsoft Graph change notification", {
        resource: notification.resource,
        changeType: notification.changeType,
      });
      return {
        ...baseResult,
        success: false,
        message: "Could not extract event ID",
      };
    }

    switch (notification.changeType) {
      case "deleted": {
        log.info("Microsoft Graph event deletion detected", {
          eventId,
          subscriptionId: notification.subscriptionId,
        });

        const result = await this.cancellationSyncService.handleExternalCancellation({
          externalEventUid: eventId,
          provider: "office365_calendar",
          reason: "Event deleted from Outlook calendar",
        });

        return { ...baseResult, ...result };
      }

      case "updated": {
        // Updated events may include cancellations/declines.
        // The actual status needs to be checked by fetching the full event
        // data — if resourceData includes cancellation info, it can be
        // detected here. Otherwise, this is handled by the sync delta
        // pipeline where the full event object is available.
        log.debug("Microsoft Graph event update detected", {
          eventId,
          subscriptionId: notification.subscriptionId,
        });
        return {
          ...baseResult,
          success: true,
          message: "Event update noted — cancellation detection deferred to sync delta",
        };
      }

      case "created": {
        // New events are not relevant for cancellation detection
        log.debug("Microsoft Graph event creation detected — skipping for cancellation sync", {
          eventId,
        });
        return {
          ...baseResult,
          success: true,
          message: "Event creation — not relevant for cancellation sync",
        };
      }

      default:
        log.warn("Unknown Microsoft Graph change type", {
          changeType: notification.changeType,
          eventId,
        });
        return {
          ...baseResult,
          success: false,
          message: `Unknown change type: ${notification.changeType}`,
        };
    }
  }
}
