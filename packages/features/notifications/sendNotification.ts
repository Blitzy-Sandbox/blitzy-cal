/**
 * Notification dispatch module — Web Push, In-App, and Activity Feed (NF-004).
 *
 * Original capability: Web Push notifications via the `web-push` library with VAPID
 * authentication. Extended (NF-004) to support multi-channel delivery including
 * persistent in-app notifications and activity feed entries for Calendly parity.
 *
 * Architectural rules enforced:
 * - Backward compatibility: existing callers passing no `channels` parameter receive
 *   identical PUSH-only behavior; no existing code paths are removed or modified.
 * - Error isolation: every new channel operation is wrapped in try/catch to prevent
 *   cross-channel failure propagation (matching the existing web-push pattern).
 * - TypeScript strict mode: no `any` type escapes; proper typing throughout.
 *
 * @see packages/features/notifications/types.ts — shared enum and DTO definitions
 * @see packages/features/notifications/services/InAppNotificationService.ts — service layer
 * @see packages/features/notifications/repositories/ActivityFeedRepository.ts — data access
 */
import { Logger } from "@nestjs/common";
import webpush from "web-push";

import { ActivityFeedRepository } from "./repositories/ActivityFeedRepository";
import { InAppNotificationService } from "./services/InAppNotificationService";
import { ActivityType, NotificationChannel, NotificationType } from "./types";

// ---------------------------------------------------------------------------
// Loggers
// ---------------------------------------------------------------------------

/** Logger for the existing web-push channel. */
const logger = new Logger("WebPush");

/** Supplementary logger for NF-004 in-app notification and activity feed operations. */
const inAppLogger = new Logger("InAppNotification");

// ---------------------------------------------------------------------------
// VAPID Configuration (existing — preserved exactly)
// ---------------------------------------------------------------------------

let isVapidConfigured = false;

const vapidKeys = {
  publicKey: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || "",
  privateKey: process.env.VAPID_PRIVATE_KEY || "",
};

if (vapidKeys.publicKey && vapidKeys.privateKey) {
  try {
    // The mail to email address should be the one at which push service providers can reach you. It can also be a URL.
    webpush.setVapidDetails("mailto:support@cal.com", vapidKeys.publicKey, vapidKeys.privateKey);
    logger.log("VAPID keys loaded. Web push enabled.");
    isVapidConfigured = true;
  } catch (err) {
    logger.error("Failed to initialize web push", err);
  }
} else {
  logger.warn("Missing VAPID keys. Web push notifications are disabled.");
}

// ---------------------------------------------------------------------------
// Module-level service instances (lazy singleton pattern for non-DI consumers)
// ---------------------------------------------------------------------------

/**
 * Singleton InAppNotificationService instance for in-app notification creation
 * and activity feed operations within the sendNotification channel routing and
 * the sendInAppNotification helper function.
 */
const inAppNotificationService = new InAppNotificationService();

/**
 * Singleton ActivityFeedRepository instance used directly by the
 * recordActivityFeedItem helper function for low-level activity feed persistence.
 */
const activityFeedRepository = new ActivityFeedRepository();

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Web Push subscription shape expected by the `web-push` library.
 * Matches the PushSubscription interface from the Push API specification.
 */
type Subscription = {
  endpoint: string;
  keys: {
    auth: string;
    p256dh: string;
  };
};

// ---------------------------------------------------------------------------
// Internal Helpers
// ---------------------------------------------------------------------------

/**
 * Maps a `NotificationType` to the most appropriate `ActivityType` for activity
 * feed entries. Used internally by the ACTIVITY_FEED channel in `sendNotification`
 * to derive the activity type from the notification type when no explicit
 * activity type is provided.
 *
 * @param notifType - The notification type to map
 * @returns The corresponding ActivityType enum value
 */
function mapNotificationTypeToActivityType(notifType: NotificationType): ActivityType {
  switch (notifType) {
    case NotificationType.BOOKING_CREATED:
    case NotificationType.BOOKING_CONFIRMED:
    case NotificationType.BOOKING_REQUESTED:
      return ActivityType.BOOKING_ACTIVITY;
    case NotificationType.BOOKING_CANCELLED:
    case NotificationType.BOOKING_REJECTED:
      return ActivityType.CANCELLATION_ACTIVITY;
    case NotificationType.BOOKING_RESCHEDULED:
      return ActivityType.RESCHEDULE_ACTIVITY;
    case NotificationType.FORM_SUBMITTED:
      return ActivityType.FORM_ACTIVITY;
    case NotificationType.MEMBER_INVITED:
    case NotificationType.MEMBER_JOINED:
      return ActivityType.TEAM_ACTIVITY;
    case NotificationType.WORKFLOW_TRIGGERED:
      return ActivityType.WORKFLOW_ACTIVITY;
    case NotificationType.MEETING_STARTED:
    case NotificationType.MEETING_ENDED:
    case NotificationType.INSTANT_MEETING:
    case NotificationType.TEST_NOTIFICATION:
    case NotificationType.SYSTEM:
    case NotificationType.CUSTOM:
      return ActivityType.SYSTEM_ACTIVITY;
    default: {
      // Exhaustive guard — ensures all NotificationType values are handled at compile time.
      const _exhaustive: never = notifType;
      return _exhaustive;
    }
  }
}

// ---------------------------------------------------------------------------
// sendNotification — Extended with multi-channel support (NF-004)
// ---------------------------------------------------------------------------

/**
 * Send a notification across one or more delivery channels.
 *
 * **Backward-compatible:** When `channels` is omitted, defaults to `[PUSH]` which
 * preserves the original web-push-only behavior exactly. Existing callers in
 * `InstantBookingCreateService` and `addNotificationsSubscription.handler` continue
 * to work without any changes.
 *
 * **NF-004 extensions:**
 * - `NotificationChannel.IN_APP` — Persists an in-app notification via `InAppNotificationService`
 * - `NotificationChannel.ACTIVITY_FEED` — Records an activity feed entry via `InAppNotificationService`
 *
 * Both new channels require `userId` to be provided; they are silently skipped otherwise.
 *
 * @param params - Notification parameters including subscription, content, and optional channel routing
 */
export const sendNotification = async ({
  subscription,
  title,
  body,
  icon,
  url,
  actions,
  requireInteraction,
  type = "INSTANT_MEETING",
  userId,
  notificationType,
  channels,
}: {
  /** Web Push subscription object with endpoint and encryption keys. */
  subscription: Subscription;
  /** Short, human-readable notification title. */
  title: string;
  /** Notification body/message with additional context. */
  body: string;
  /** Optional icon URL for the notification. */
  icon?: string;
  /** Optional deep-link URL the user can navigate to when acting on the notification. */
  url?: string;
  /** Optional notification action buttons (web-push specific). */
  actions?: { action: string; title: string; type: string; image: string | null }[];
  /** Whether the notification should require explicit user interaction to dismiss. */
  requireInteraction?: boolean;
  /** Legacy string type identifier (preserved for backward compatibility). */
  type?: string;
  /** NF-004: Target user ID for in-app notification and activity feed targeting. */
  userId?: number;
  /** NF-004: Typed notification categorisation for in-app and activity feed entries. */
  notificationType?: NotificationType;
  /** NF-004: Delivery channels to use. Defaults to `[PUSH]` for backward compatibility. */
  channels?: NotificationChannel[];
}) => {
  // Resolve effective channels — default to PUSH-only for backward compatibility
  const effectiveChannels = channels ?? [NotificationChannel.PUSH];

  // Preserve original early-return behavior for PUSH-only calls when VAPID is not configured
  if (
    effectiveChannels.length === 1 &&
    effectiveChannels.includes(NotificationChannel.PUSH) &&
    !isVapidConfigured
  ) {
    logger.error("Cannot send notification. VAPID keys not configured.");
    return;
  }

  // Collect independent channel dispatches for parallel execution via Promise.allSettled.
  // Each channel has its own error handling so one channel failure does not block others.
  // Total latency = max(channel_times) instead of sum(channel_times).
  const channelPromises: Promise<void>[] = [];

  // === Web Push channel ===
  if (effectiveChannels.includes(NotificationChannel.PUSH)) {
    if (!isVapidConfigured) {
      logger.error("Cannot send notification. VAPID keys not configured.");
    } else {
      channelPromises.push(
        (async () => {
          try {
            const payload = JSON.stringify({
              title,
              body,
              icon,
              data: {
                url,
                type,
              },
              actions,
              requireInteraction,
              tag: `cal-notification-${Date.now()}`,
            });
            await webpush.sendNotification(subscription, payload);
          } catch (error) {
            logger.error("Error sending notification", error);
          }
        })()
      );
    }
  }

  // === NF-004: In-app notification channel ===
  if (effectiveChannels.includes(NotificationChannel.IN_APP) && userId !== undefined) {
    channelPromises.push(
      (async () => {
        try {
          await inAppNotificationService.createNotification({
            userId,
            title,
            body,
            type: notificationType ?? NotificationType.INSTANT_MEETING,
            url,
            icon,
          });
        } catch (error) {
          inAppLogger.error("Error creating in-app notification", error);
        }
      })()
    );
  }

  // === NF-004: Activity feed channel ===
  if (effectiveChannels.includes(NotificationChannel.ACTIVITY_FEED) && userId !== undefined) {
    channelPromises.push(
      (async () => {
        try {
          const derivedActivityType = notificationType
            ? mapNotificationTypeToActivityType(notificationType)
            : ActivityType.SYSTEM_ACTIVITY;

          await inAppNotificationService.createActivityFeedItem({
            userId,
            activityType: derivedActivityType,
            title,
            description: body,
          });
        } catch (error) {
          inAppLogger.error("Error recording activity feed item", error);
        }
      })()
    );
  }

  // Dispatch all channels in parallel — individual errors are already caught above
  if (channelPromises.length > 0) {
    await Promise.allSettled(channelPromises);
  }
};

// ---------------------------------------------------------------------------
// sendInAppNotification — Dedicated in-app notification helper (NF-004)
// ---------------------------------------------------------------------------

/**
 * Send an in-app notification to a specific user.
 *
 * Convenience helper that wraps `InAppNotificationService.createNotification()`
 * with error isolation matching the existing web-push error handling pattern.
 * Use this when you only need to create an in-app notification without web-push
 * or activity feed delivery.
 *
 * @param params - In-app notification parameters
 */
export const sendInAppNotification = async ({
  userId,
  title,
  body,
  type,
  url,
  metadata,
}: {
  /** Target user ID to receive the in-app notification. */
  userId: number;
  /** Short, human-readable notification title. */
  title: string;
  /** Notification body/message with additional context. */
  body: string;
  /** Categorisation of the notification event. */
  type: NotificationType;
  /** Optional deep-link URL the user can navigate to when acting on the notification. */
  url?: string;
  /** Optional extensible metadata for downstream consumers (e.g., booking ID, attendee info). */
  metadata?: Record<string, unknown>;
}): Promise<void> => {
  try {
    await inAppNotificationService.createNotification({
      userId,
      title,
      body,
      type,
      url,
      metadata,
    });
  } catch (error) {
    inAppLogger.error("Error sending in-app notification", error);
  }
};

// ---------------------------------------------------------------------------
// recordActivityFeedItem — Dedicated activity feed helper (NF-004)
// ---------------------------------------------------------------------------

/**
 * Record an activity feed item for a user's activity timeline.
 *
 * Convenience helper that wraps `ActivityFeedRepository.create()` with error
 * isolation matching the existing web-push error handling pattern. Use this when
 * you need to create a standalone activity feed entry without an accompanying
 * notification or web-push delivery.
 *
 * @param params - Activity feed item parameters
 */
export const recordActivityFeedItem = async ({
  userId,
  activityType,
  title,
  description,
  resourceId,
  resourceType,
  metadata,
}: {
  /** Target user ID whose activity feed receives the item. */
  userId: number;
  /** Category of the activity event (should match an ActivityType enum value). */
  activityType: string;
  /** Short, human-readable activity title. */
  title: string;
  /** Optional longer description providing additional context. */
  description?: string;
  /** Optional identifier of the related resource (booking ID, team ID, form ID, etc.). */
  resourceId?: string;
  /** Optional type descriptor for the related resource (e.g., "booking", "team", "form"). */
  resourceType?: string;
  /** Optional extensible metadata for downstream consumers. */
  metadata?: Record<string, unknown>;
}): Promise<void> => {
  try {
    await activityFeedRepository.create({
      userId,
      activityType: activityType as ActivityType,
      title,
      description,
      resourceId,
      resourceType,
      metadata,
    });
  } catch (error) {
    inAppLogger.error("Error recording activity feed item", error);
  }
};
