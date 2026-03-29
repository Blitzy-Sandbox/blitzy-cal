import logger from "@calcom/lib/logger";
import { prisma } from "@calcom/prisma";
import type { Prisma, PrismaClient } from "@calcom/prisma/client";

import type { InAppNotificationCreateInput, InAppNotificationListOptions } from "../types";

const log = logger.getSubLogger({
  prefix: ["features/notifications/repositories/InAppNotificationRepository"],
});

/**
 * Select fragment for consistent notification return shapes across all query methods.
 * Includes all persisted fields of the InAppNotification model while excluding
 * the User relation to keep payloads lightweight.
 */
const notificationSelect = {
  id: true,
  userId: true,
  title: true,
  body: true,
  type: true,
  status: true,
  url: true,
  icon: true,
  metadata: true,
  createdAt: true,
  readAt: true,
  dismissedAt: true,
} satisfies Prisma.InAppNotificationSelect;

/**
 * Repository class providing Prisma-based data access for in-app notifications.
 *
 * Follows the Cal.com repository pattern established by `MembershipRepository`:
 * - Constructor-injected PrismaClient with a default singleton for non-transactional use
 * - Module-scoped logger with prefixed sub-logger
 * - Select fragments for consistent return shapes
 * - Destructured object parameters for all public methods
 *
 * All instance methods operate through `this.prismaClient` to support both
 * standard and transactional contexts via dependency injection.
 *
 * @see packages/features/membership/repositories/MembershipRepository.ts — pattern reference
 * @see packages/features/ee/workflows/repositories/WorkflowReminderRepository.ts — updateMany pattern
 */
export class InAppNotificationRepository {
  constructor(private readonly prismaClient: PrismaClient = prisma) {}

  /**
   * Create a new in-app notification for the specified user.
   *
   * New notifications always start with `status: "UNREAD"` and no read/dismissed timestamps.
   * Optional fields (`url`, `icon`, `metadata`) default to `null`/`undefined` when not provided.
   *
   * @param input - Notification creation payload including userId, title, body, type, and optional fields
   * @returns The created notification record matching the `notificationSelect` shape
   */
  async create(input: InAppNotificationCreateInput) {
    log.debug("Creating in-app notification", { userId: input.userId, type: input.type });

    return this.prismaClient.inAppNotification.create({
      data: {
        userId: input.userId,
        title: input.title,
        body: input.body,
        type: input.type,
        status: "UNREAD",
        url: input.url ?? null,
        icon: input.icon ?? null,
        metadata: input.metadata !== undefined ? (input.metadata as Prisma.InputJsonValue) : undefined,
      },
      select: notificationSelect,
    });
  }

  /**
   * Find a single notification by its unique identifier.
   *
   * @param params - Object containing the notification `id`
   * @returns The notification record or `null` if not found
   */
  async findById({ id }: { id: number }) {
    return this.prismaClient.inAppNotification.findUnique({
      where: { id },
      select: notificationSelect,
    });
  }

  /**
   * Find notifications for a specific user with optional status/type filtering
   * and cursor-based forward pagination.
   *
   * Results are ordered by `createdAt: "desc"` (most recent first).
   * When a `cursor` is provided, results start after the notification with that ID.
   *
   * @param options - Query parameters including userId, optional status/type filters, limit, and cursor
   * @returns Array of notification records matching the query criteria
   */
  async findByUser(options: InAppNotificationListOptions) {
    const { userId, status, type, limit = 20, cursor } = options;

    log.debug("Finding notifications for user", { userId, status, type, limit, cursor });

    return this.prismaClient.inAppNotification.findMany({
      where: {
        userId,
        ...(status !== undefined && { status }),
        ...(type !== undefined && { type }),
      },
      select: notificationSelect,
      orderBy: { createdAt: "desc" },
      take: limit,
      ...(cursor !== undefined && {
        skip: 1,
        cursor: { id: cursor },
      }),
    });
  }

  /**
   * Mark a specific notification as read by setting its status to `"READ"`
   * and recording the current timestamp in `readAt`.
   *
   * The `userId` parameter ensures ownership validation — only the notification
   * owner can mark their notifications as read.
   *
   * Returns `null` if the notification does not exist or does not belong to the
   * specified user (Prisma P2025 record-not-found error).
   *
   * @param params - Object containing the notification `id` and owning `userId`
   * @returns The updated notification record or `null` if not found
   */
  async markAsRead({ id, userId }: { id: number; userId: number }) {
    try {
      return await this.prismaClient.inAppNotification.update({
        where: { id, userId },
        data: {
          status: "READ",
          readAt: new Date(),
        },
        select: notificationSelect,
      });
    } catch (error) {
      log.debug("Failed to mark notification as read", { id, userId, error });
      return null;
    }
  }

  /**
   * Mark a specific notification as dismissed by setting its status to `"DISMISSED"`
   * and recording the current timestamp in `dismissedAt`.
   *
   * The `userId` parameter ensures ownership validation — only the notification
   * owner can dismiss their notifications.
   *
   * Returns `null` if the notification does not exist or does not belong to the
   * specified user (Prisma P2025 record-not-found error).
   *
   * @param params - Object containing the notification `id` and owning `userId`
   * @returns The updated notification record or `null` if not found
   */
  async markAsDismissed({ id, userId }: { id: number; userId: number }) {
    try {
      return await this.prismaClient.inAppNotification.update({
        where: { id, userId },
        data: {
          status: "DISMISSED",
          dismissedAt: new Date(),
        },
        select: notificationSelect,
      });
    } catch (error) {
      log.debug("Failed to mark notification as dismissed", { id, userId, error });
      return null;
    }
  }

  /**
   * Count the number of unread notifications for a specific user.
   *
   * This is typically used for notification badge counters in the UI.
   *
   * @param params - Object containing the `userId` to count unread notifications for
   * @returns The number of unread notifications
   */
  async countUnread({ userId }: { userId: number }) {
    return this.prismaClient.inAppNotification.count({
      where: {
        userId,
        status: "UNREAD",
      },
    });
  }

  /**
   * Bulk-mark all unread notifications as read for a specific user.
   *
   * Only notifications with `status: "UNREAD"` are affected. Already-read or
   * dismissed notifications are left unchanged.
   *
   * @param params - Object containing the `userId` whose notifications should be marked as read
   * @returns Prisma `BatchPayload` with the `count` of updated records
   */
  async markAllAsRead({ userId }: { userId: number }) {
    log.debug("Marking all notifications as read", { userId });

    return this.prismaClient.inAppNotification.updateMany({
      where: {
        userId,
        status: "UNREAD",
      },
      data: {
        status: "READ",
        readAt: new Date(),
      },
    });
  }

  /**
   * Delete notifications older than the specified date for a specific user.
   *
   * This is used for notification lifecycle management and storage cleanup,
   * typically invoked by a scheduled cron job or manual cleanup trigger.
   *
   * @param params - Object containing the `userId` and `olderThan` date threshold
   * @returns Prisma `BatchPayload` with the `count` of deleted records
   */
  async deleteOldNotifications({ userId, olderThan }: { userId: number; olderThan: Date }) {
    log.debug("Deleting old notifications", { userId, olderThan: olderThan.toISOString() });

    return this.prismaClient.inAppNotification.deleteMany({
      where: {
        userId,
        createdAt: {
          lt: olderThan,
        },
      },
    });
  }
}
