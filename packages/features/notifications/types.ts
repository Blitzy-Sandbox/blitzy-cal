/**
 * NF-004 — In-App Notification and Activity Feed Type Definitions
 *
 * This file serves as the single source of truth for all notification type definitions
 * consumed by services, repositories, and the extended `sendNotification.ts` within the
 * in-app notification and activity feed module (NF-004).
 *
 * Architectural rules enforced:
 * - TypeScript strict mode — no `any` types; `Record<string, unknown>` for generic metadata
 * - SCREAMING_SNAKE_CASE for all enum values (matching Cal.com Prisma conventions)
 * - Pure type file — no runtime logic, only type definitions, enums, and interfaces
 * - Zero external dependencies — this file has no imports
 * - Extensible design — optional fields and discriminated patterns where appropriate
 *
 * @see packages/features/notifications/sendNotification.ts — existing web-push notification sender
 * @see packages/features/webhooks/lib/dto/types.ts — DTO patterns used in webhook features
 * @see packages/emails/email-types.ts — EmailType enum pattern for notification governance
 */

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

/**
 * Delivery channels through which notifications can be sent.
 *
 * - `PUSH`          — Web-push via the existing VAPID-based infrastructure
 * - `IN_APP`        — Persistent in-app notification visible in the notification center
 * - `ACTIVITY_FEED` — Activity feed entry for the user's activity timeline
 */
export enum NotificationChannel {
  /** Existing web-push channel using VAPID keys and the web-push library. */
  PUSH = "PUSH",
  /** New in-app notification channel persisted to the notification store. */
  IN_APP = "IN_APP",
  /** New activity feed channel that records items in the user's activity timeline. */
  ACTIVITY_FEED = "ACTIVITY_FEED",
}

/**
 * Comprehensive set of notification types aligned with the Calendly notification
 * lifecycle and Cal.com booking events. Each value maps to a specific event in
 * the platform that can trigger user-facing notifications.
 *
 * Values are intentionally aligned with `WebhookTriggerEvents` in the Prisma schema
 * where applicable, ensuring consistent event semantics across webhooks and
 * in-app notifications.
 */
export enum NotificationType {
  /** A new booking has been created (maps to Calendly `invitee.created`). */
  BOOKING_CREATED = "BOOKING_CREATED",
  /** A booking has been cancelled (maps to Calendly `invitee.canceled`). */
  BOOKING_CANCELLED = "BOOKING_CANCELLED",
  /** A booking has been rescheduled to a new time slot. */
  BOOKING_RESCHEDULED = "BOOKING_RESCHEDULED",
  /** A pending booking has been confirmed by the host. */
  BOOKING_CONFIRMED = "BOOKING_CONFIRMED",
  /** A booking request has been rejected by the host. */
  BOOKING_REJECTED = "BOOKING_REJECTED",
  /** A booking has been requested and is awaiting host confirmation. */
  BOOKING_REQUESTED = "BOOKING_REQUESTED",
  /** A routing form has been submitted (maps to Calendly `routing_form_submission.created`). */
  FORM_SUBMITTED = "FORM_SUBMITTED",
  /** A scheduled meeting has started (video call joined or start time reached). */
  MEETING_STARTED = "MEETING_STARTED",
  /** A scheduled meeting has ended. */
  MEETING_ENDED = "MEETING_ENDED",
  /** A team member invitation has been sent. */
  MEMBER_INVITED = "MEMBER_INVITED",
  /** A team member has accepted an invitation and joined the team. */
  MEMBER_JOINED = "MEMBER_JOINED",
  /** A workflow automation has been triggered. */
  WORKFLOW_TRIGGERED = "WORKFLOW_TRIGGERED",
  /** An instant meeting has been initiated — preserves existing type from sendNotification.ts. */
  INSTANT_MEETING = "INSTANT_MEETING",
  /** A test notification for verifying push subscription delivery. */
  TEST_NOTIFICATION = "TEST_NOTIFICATION",
  /** System-level notifications (maintenance, announcements, etc.). */
  SYSTEM = "SYSTEM",
  /** Custom notification type for extensibility. */
  CUSTOM = "CUSTOM",
}

/**
 * Lifecycle status of an in-app notification. Tracks the progression from
 * delivery through user interaction to eventual archival.
 */
export enum NotificationStatus {
  /** Notification has been delivered but not yet seen by the user. */
  UNREAD = "UNREAD",
  /** Notification has been viewed/read by the user. */
  READ = "READ",
  /** Notification has been explicitly dismissed by the user. */
  DISMISSED = "DISMISSED",
  /** Notification has been archived (retained for history but hidden from active view). */
  ARCHIVED = "ARCHIVED",
}

/**
 * Categorisation for activity feed items. Each value represents a distinct
 * class of activity that appears in the user's activity timeline.
 */
export enum ActivityType {
  /** Activity related to a new or confirmed booking. */
  BOOKING_ACTIVITY = "BOOKING_ACTIVITY",
  /** Activity related to a booking cancellation. */
  CANCELLATION_ACTIVITY = "CANCELLATION_ACTIVITY",
  /** Activity related to a booking reschedule. */
  RESCHEDULE_ACTIVITY = "RESCHEDULE_ACTIVITY",
  /** Activity related to team management (invitations, role changes, etc.). */
  TEAM_ACTIVITY = "TEAM_ACTIVITY",
  /** Activity related to routing form submissions. */
  FORM_ACTIVITY = "FORM_ACTIVITY",
  /** Activity related to workflow automation triggers. */
  WORKFLOW_ACTIVITY = "WORKFLOW_ACTIVITY",
  /** System-level activity entries (maintenance, configuration changes, etc.). */
  SYSTEM_ACTIVITY = "SYSTEM_ACTIVITY",
}

// ---------------------------------------------------------------------------
// In-App Notification DTOs
// ---------------------------------------------------------------------------

/**
 * Input payload for creating a new in-app notification.
 *
 * Used by `InAppNotificationService.createNotification()` and the extended
 * `sendNotification()` when the `IN_APP` channel is selected.
 */
export type InAppNotificationCreateInput = {
  /** Target user ID to receive the notification. */
  userId: number;
  /** Short, human-readable notification title. */
  title: string;
  /** Notification body/message with additional context. */
  body: string;
  /** Categorisation of the notification event. */
  type: NotificationType;
  /** Optional deep-link URL the user can navigate to when acting on the notification. */
  url?: string;
  /** Optional icon URL displayed alongside the notification. */
  icon?: string;
  /** Optional extensible metadata for downstream consumers (e.g., booking ID, attendee info). */
  metadata?: Record<string, unknown>;
  /** Delivery channels for this notification. Defaults to `[NotificationChannel.IN_APP]` when omitted. */
  channels?: NotificationChannel[];
};

/**
 * Data Transfer Object representing a persisted in-app notification as
 * returned by queries and list endpoints.
 */
export type InAppNotificationDTO = {
  /** Unique notification identifier. */
  id: number;
  /** User ID of the notification recipient. */
  userId: number;
  /** Notification title. */
  title: string;
  /** Notification body text. */
  body: string;
  /** Categorisation of the notification event. */
  type: NotificationType;
  /** Current lifecycle status of the notification. */
  status: NotificationStatus;
  /** Deep-link action URL, or `null` if none was provided. */
  url: string | null;
  /** Icon URL, or `null` if none was provided. */
  icon: string | null;
  /** Extensible metadata, or `null` if none was provided. */
  metadata: Record<string, unknown> | null;
  /** Timestamp when the notification was created. */
  createdAt: Date;
  /** Timestamp when the notification was read, or `null` if still unread. */
  readAt: Date | null;
  /** Timestamp when the notification was dismissed, or `null` if not dismissed. */
  dismissedAt: Date | null;
};

/**
 * Query options for listing in-app notifications with cursor-based pagination.
 */
export type InAppNotificationListOptions = {
  /** Filter notifications belonging to this user. */
  userId: number;
  /** Optional filter by notification lifecycle status. */
  status?: NotificationStatus;
  /** Optional filter by notification type. */
  type?: NotificationType;
  /** Maximum number of notifications to return per page. */
  limit?: number;
  /** Cursor (notification ID) for cursor-based forward pagination. */
  cursor?: number;
};

// ---------------------------------------------------------------------------
// Activity Feed DTOs
// ---------------------------------------------------------------------------

/**
 * Input payload for creating a new activity feed item.
 *
 * Used by `ActivityFeedRepository.create()` and the `recordActivityFeedItem()`
 * helper in `sendNotification.ts`.
 */
export type ActivityFeedItemCreateInput = {
  /** Target user ID whose activity feed receives the item. */
  userId: number;
  /** Category of the activity event. */
  activityType: ActivityType;
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
};

/**
 * Data Transfer Object representing a persisted activity feed item as
 * returned by queries and list endpoints.
 */
export type ActivityFeedItemDTO = {
  /** Unique feed item identifier. */
  id: number;
  /** User ID of the activity feed owner. */
  userId: number;
  /** Category of the activity event. */
  activityType: ActivityType;
  /** Activity title. */
  title: string;
  /** Activity description, or `null` if none was provided. */
  description: string | null;
  /** Related resource identifier, or `null` if none was provided. */
  resourceId: string | null;
  /** Related resource type descriptor, or `null` if none was provided. */
  resourceType: string | null;
  /** Extensible metadata, or `null` if none was provided. */
  metadata: Record<string, unknown> | null;
  /** Timestamp when the activity feed item was created. */
  createdAt: Date;
};

/**
 * Query options for listing activity feed items with cursor-based pagination.
 */
export type ActivityFeedListOptions = {
  /** Filter activity feed items belonging to this user. */
  userId: number;
  /** Optional filter by activity type category. */
  activityType?: ActivityType;
  /** Maximum number of feed items to return per page. */
  limit?: number;
  /** Cursor (feed item ID) for cursor-based forward pagination. */
  cursor?: number;
};

// ---------------------------------------------------------------------------
// Notification Count / Summary
// ---------------------------------------------------------------------------

/**
 * Aggregated notification count summary for a user, typically used by
 * the notification badge and dashboard widgets.
 */
export type NotificationCountSummary = {
  /** Total number of notifications (all statuses). */
  total: number;
  /** Count of notifications with `UNREAD` status. */
  unread: number;
  /**
   * Breakdown of notification counts by type.
   *
   * Keyed by `NotificationType`; values represent the count for each type.
   * This is a partial record — only types with at least one notification are
   * guaranteed to be present.
   */
  byType: Partial<Record<NotificationType, number>>;
};
