import logger from "@calcom/lib/logger";

import { ActivityFeedRepository } from "../repositories/ActivityFeedRepository";
import { InAppNotificationRepository } from "../repositories/InAppNotificationRepository";
import type {
	ActivityFeedItemCreateInput,
	ActivityFeedListOptions,
	ActivityType,
	InAppNotificationCreateInput,
	InAppNotificationListOptions,
	NotificationCountSummary,
	NotificationType,
} from "../types";

const log = logger.getSubLogger({
	prefix: ["features/notifications/services/InAppNotificationService"],
});

/**
 * Service layer for in-app notification and activity feed operations (NF-004).
 *
 * Manages the full notification lifecycle: creating notifications, retrieving
 * notification lists with pagination, marking notifications as read/dismissed,
 * counting unread notifications, managing notification cleanup, and coordinating
 * activity feed entries.
 *
 * Follows the Cal.com service pattern established by `MembershipService`:
 * - Constructor-injected repositories with default instantiation
 * - Async instance methods delegating all data access to repositories
 * - Error isolation: mutation methods catch errors, log them, and return safe defaults
 * - Module-scoped logger with prefixed sub-logger
 *
 * @see packages/features/membership/services/membershipService.ts — constructor and method pattern
 * @see packages/features/ee/teams/services/teamService.ts — logger pattern
 * @see packages/features/notifications/sendNotification.ts — error isolation pattern
 */
export class InAppNotificationService {
	constructor(
		private readonly notificationRepository: InAppNotificationRepository = new InAppNotificationRepository(),
		private readonly activityFeedRepository: ActivityFeedRepository = new ActivityFeedRepository()
	) {}

	// ---------------------------------------------------------------------------
	// Notification CRUD Methods
	// ---------------------------------------------------------------------------

	/**
	 * Create a new in-app notification for a user.
	 *
	 * Delegates to the notification repository for persistence and returns the
	 * created notification record. On failure, the error is logged and `null` is
	 * returned — matching the error isolation pattern from `sendNotification.ts`.
	 *
	 * @param input - Notification creation payload including userId, title, body, type
	 * @returns The created notification or `null` if creation failed
	 */
	async createNotification(input: InAppNotificationCreateInput) {
		try {
			const notification = await this.notificationRepository.create(input);
			log.debug("In-app notification created", {
				userId: input.userId,
				type: input.type,
			});
			return notification;
		} catch (error) {
			log.error("Failed to create in-app notification", {
				userId: input.userId,
				type: input.type,
				error,
			});
			return null;
		}
	}

	/**
	 * Retrieve a single notification by its unique identifier.
	 *
	 * Simple read delegation — Prisma returns `null` for non-existent records,
	 * so no try/catch wrapper is needed.
	 *
	 * @param params - Object containing the notification `id`
	 * @returns The notification record or `null` if not found
	 */
	async getNotification({ id }: { id: number }) {
		return this.notificationRepository.findById({ id });
	}

	/**
	 * Retrieve notifications for a user with optional status/type filtering
	 * and cursor-based forward pagination.
	 *
	 * @param options - Query options including userId, optional filters, limit, and cursor
	 * @returns Array of notification records matching the query criteria
	 */
	async getNotifications(options: InAppNotificationListOptions) {
		return this.notificationRepository.findByUser(options);
	}

	/**
	 * Mark a specific notification as read.
	 *
	 * The `userId` parameter ensures ownership validation — only the notification
	 * owner can mark their notifications as read. On failure, the error is logged
	 * and `null` is returned.
	 *
	 * @param params - Object containing the notification `id` and owning `userId`
	 * @returns The updated notification record or `null` on failure
	 */
	async markAsRead({ id, userId }: { id: number; userId: number }) {
		try {
			const result = await this.notificationRepository.markAsRead({ id, userId });
			if (result) {
				log.debug("Notification marked as read", { id, userId });
			}
			return result;
		} catch (error) {
			log.error("Failed to mark notification as read", { id, userId, error });
			return null;
		}
	}

	/**
	 * Mark a specific notification as dismissed.
	 *
	 * The `userId` parameter ensures ownership validation — only the notification
	 * owner can dismiss their notifications. On failure, the error is logged and
	 * `null` is returned.
	 *
	 * @param params - Object containing the notification `id` and owning `userId`
	 * @returns The updated notification record or `null` on failure
	 */
	async markAsDismissed({ id, userId }: { id: number; userId: number }) {
		try {
			const result = await this.notificationRepository.markAsDismissed({ id, userId });
			if (result) {
				log.debug("Notification dismissed", { id, userId });
			}
			return result;
		} catch (error) {
			log.error("Failed to dismiss notification", { id, userId, error });
			return null;
		}
	}

	/**
	 * Bulk-mark all unread notifications as read for a user.
	 *
	 * Returns a Prisma `BatchPayload`-compatible object with the `count` of
	 * updated records. On failure, returns `{ count: 0 }` as a safe default.
	 *
	 * @param params - Object containing the `userId`
	 * @returns Object with `count` of updated notifications
	 */
	async markAllAsRead({ userId }: { userId: number }) {
		try {
			const result = await this.notificationRepository.markAllAsRead({ userId });
			log.debug("All notifications marked as read", { userId, count: result.count });
			return result;
		} catch (error) {
			log.error("Failed to mark all notifications as read", { userId, error });
			return { count: 0 };
		}
	}

	/**
	 * Count unread notifications for a user.
	 *
	 * Typically used for notification badge counters in the UI. Simple read
	 * delegation with no error wrapping needed.
	 *
	 * @param params - Object containing the `userId`
	 * @returns The number of unread notifications
	 */
	async getUnreadCount({ userId }: { userId: number }): Promise<number> {
		return this.notificationRepository.countUnread({ userId });
	}

	/**
	 * Get a full notification count summary for a user.
	 *
	 * Aggregates total count, unread count, and per-type breakdown into a
	 * `NotificationCountSummary` object for dashboard widgets and notification
	 * center headers.
	 *
	 * @param params - Object containing the `userId`
	 * @returns Aggregated notification count summary
	 */
	async getNotificationSummary({ userId }: { userId: number }): Promise<NotificationCountSummary> {
		try {
			const unread = await this.notificationRepository.countUnread({ userId });
			const allNotifications = await this.notificationRepository.findByUser({
				userId,
				limit: 100,
			});
			const total = allNotifications.length;

			const byType: Partial<Record<NotificationType, number>> = {};
			for (const notification of allNotifications) {
				const notifType = notification.type as NotificationType;
				byType[notifType] = (byType[notifType] ?? 0) + 1;
			}

			return { total, unread, byType };
		} catch (error) {
			log.error("Failed to get notification summary", { userId, error });
			return { total: 0, unread: 0, byType: {} };
		}
	}

	/**
	 * Delete notifications older than a specified date for a user.
	 *
	 * Used for notification lifecycle management and storage cleanup, typically
	 * invoked by a scheduled cron job or manual cleanup trigger.
	 *
	 * @param params - Object containing `userId` and `olderThan` date threshold
	 * @returns Object with `count` of deleted notifications
	 */
	async cleanupOldNotifications({ userId, olderThan }: { userId: number; olderThan: Date }) {
		try {
			const result = await this.notificationRepository.deleteOldNotifications({ userId, olderThan });
			log.debug("Old notifications cleaned up", {
				userId,
				count: result.count,
				olderThan,
			});
			return result;
		} catch (error) {
			log.error("Failed to clean up old notifications", { userId, olderThan, error });
			return { count: 0 };
		}
	}

	// ---------------------------------------------------------------------------
	// Activity Feed Methods
	// ---------------------------------------------------------------------------

	/**
	 * Create a new activity feed entry for a user.
	 *
	 * Delegates to the activity feed repository for persistence and returns the
	 * created feed item. On failure, the error is logged and `null` is returned.
	 *
	 * @param input - Activity feed creation payload including userId, activityType, title
	 * @returns The created activity feed item or `null` if creation failed
	 */
	async createActivityFeedItem(input: ActivityFeedItemCreateInput) {
		try {
			const item = await this.activityFeedRepository.create(input);
			log.debug("Activity feed item created", {
				userId: input.userId,
				activityType: input.activityType,
			});
			return item;
		} catch (error) {
			log.error("Failed to create activity feed item", {
				userId: input.userId,
				activityType: input.activityType,
				error,
			});
			return null;
		}
	}

	/**
	 * Retrieve activity feed items for a user with optional type filtering
	 * and cursor-based forward pagination.
	 *
	 * @param options - Query options including userId, optional activityType filter, limit, and cursor
	 * @returns Array of activity feed items matching the query criteria
	 */
	async getActivityFeed(options: ActivityFeedListOptions) {
		return this.activityFeedRepository.findByUser(options);
	}

	/**
	 * Get recent activity for a user — a simplified query for dashboards and widgets.
	 *
	 * Returns the most recent activity feed items up to the specified limit,
	 * defaulting to 10 items for a quick-glance dashboard view.
	 *
	 * @param params - Object containing `userId` and optional `limit` (default 10)
	 * @returns Array of the most recent activity feed items
	 */
	async getRecentActivity({ userId, limit = 10 }: { userId: number; limit?: number }) {
		return this.activityFeedRepository.findRecentActivity({ userId, limit });
	}

	/**
	 * Delete old activity feed items for a user.
	 *
	 * Used for activity feed retention and cleanup to prevent unbounded growth
	 * of the activity feed table.
	 *
	 * @param params - Object containing `userId` and `olderThan` date threshold
	 * @returns Object with `count` of deleted activity feed items
	 */
	async cleanupOldActivity({ userId, olderThan }: { userId: number; olderThan: Date }) {
		try {
			const result = await this.activityFeedRepository.deleteOldActivity({ userId, olderThan });
			log.debug("Old activity feed items cleaned up", {
				userId,
				count: result.count,
				olderThan,
			});
			return result;
		} catch (error) {
			log.error("Failed to clean up old activity", { userId, olderThan, error });
			return { count: 0 };
		}
	}

	// ---------------------------------------------------------------------------
	// Combined Notification + Activity Feed
	// ---------------------------------------------------------------------------

	/**
	 * Create both an in-app notification and an activity feed entry in parallel.
	 *
	 * This is the primary integration point for booking, team, and workflow events
	 * that need both a user-facing notification and activity timeline tracking.
	 * Uses `Promise.allSettled` to prevent one failure from blocking the other,
	 * ensuring maximum reliability of the notification pipeline.
	 *
	 * @param params - Combined object with notification and activity feed fields
	 * @returns Object with both `notification` and `activity` results (either value or `null`)
	 */
	async notifyWithActivity({
		userId,
		title,
		body,
		type,
		activityType,
		url,
		icon,
		metadata,
		resourceId,
		resourceType,
	}: {
		userId: number;
		title: string;
		body: string;
		type: NotificationType;
		activityType: ActivityType;
		url?: string;
		icon?: string;
		metadata?: Record<string, unknown>;
		resourceId?: string;
		resourceType?: string;
	}) {
		const [notification, activity] = await Promise.allSettled([
			this.createNotification({ userId, title, body, type, url, icon, metadata }),
			this.createActivityFeedItem({
				userId,
				activityType,
				title,
				description: body,
				resourceId,
				resourceType,
				metadata,
			}),
		]);

		return {
			notification: notification.status === "fulfilled" ? notification.value : null,
			activity: activity.status === "fulfilled" ? activity.value : null,
		};
	}
}
