import logger from "@calcom/lib/logger";
import { prisma } from "@calcom/prisma";
import type { Prisma, PrismaClient } from "@calcom/prisma/client";
import type { ActivityFeedItemCreateInput, ActivityFeedListOptions, ActivityType } from "../types";

const log = logger.getSubLogger({ prefix: ["features/notifications/repositories/ActivityFeedRepository"] });

const activityFeedItemSelect = {
  id: true,
  userId: true,
  activityType: true,
  title: true,
  description: true,
  resourceId: true,
  resourceType: true,
  metadata: true,
  createdAt: true,
} satisfies Prisma.ActivityFeedItemSelect;

export class ActivityFeedRepository {
  constructor(private readonly prismaClient: PrismaClient = prisma) {}

  /**
   * Creates a new activity feed entry for a user.
   *
   * @param input - The activity feed item data including userId, activityType, title,
   *                and optional description, resourceId, resourceType, and metadata.
   * @returns The newly created activity feed item with fields defined by activityFeedItemSelect.
   */
  async create(input: ActivityFeedItemCreateInput) {
    log.debug("Creating activity feed item", { userId: input.userId, activityType: input.activityType });

    return this.prismaClient.activityFeedItem.create({
      data: {
        userId: input.userId,
        activityType: input.activityType,
        title: input.title,
        description: input.description ?? null,
        resourceId: input.resourceId ?? null,
        resourceType: input.resourceType ?? null,
        metadata: input.metadata !== undefined ? (input.metadata as Prisma.InputJsonValue) : undefined,
      },
      select: activityFeedItemSelect,
    });
  }

  /**
   * Finds activity feed items for a user with cursor-based pagination and optional filtering.
   *
   * Supports filtering by activityType and cursor-based pagination via the `cursor` parameter.
   * Results are ordered by createdAt descending (most recent first).
   *
   * @param options - Query options including userId, optional activityType filter,
   *                  limit (default 20), and optional cursor for pagination.
   * @returns An array of activity feed items matching the query criteria.
   */
  async findByUser(options: ActivityFeedListOptions) {
    const { userId, activityType, limit = 20, cursor } = options;

    log.debug("Finding activity feed items by user", { userId, activityType, limit, cursor });

    return this.prismaClient.activityFeedItem.findMany({
      where: {
        userId,
        ...(activityType !== undefined && { activityType }),
      },
      select: activityFeedItemSelect,
      orderBy: { createdAt: "desc" },
      take: limit,
      ...(cursor !== undefined && {
        skip: 1,
        cursor: { id: cursor },
      }),
    });
  }

  /**
   * Retrieves recent activity feed items for a user — a simplified query for dashboards and widgets.
   *
   * Unlike findByUser, this method does not support cursor-based pagination or
   * activity type filtering. It returns the most recent items up to the specified limit.
   *
   * @param params - Object containing userId and optional limit (default 10).
   * @returns An array of the most recent activity feed items for the user.
   */
  async findRecentActivity({ userId, limit = 10 }: { userId: number; limit?: number }) {
    log.debug("Finding recent activity", { userId, limit });

    return this.prismaClient.activityFeedItem.findMany({
      where: { userId },
      select: activityFeedItemSelect,
      orderBy: { createdAt: "desc" },
      take: limit,
    });
  }

  /**
   * Finds a single activity feed item by its unique ID, scoped to the owning user.
   *
   * The `userId` parameter enforces ownership validation at the data-access layer,
   * preventing any authenticated user from reading another user's activity feed items
   * by enumerating IDs.
   *
   * @param params - Object containing the activity feed item `id` and owning `userId`.
   * @returns The activity feed item if found and owned by the user, or `null` otherwise.
   */
  async findById({ id, userId }: { id: number; userId: number }) {
    log.debug("Finding activity feed item by id", { id, userId });

    return this.prismaClient.activityFeedItem.findFirst({
      where: { id, userId },
      select: activityFeedItemSelect,
    });
  }

  /**
   * Counts the total number of activity feed items for a user, with optional filtering by activity type.
   *
   * @param params - Object containing userId and optional activityType filter.
   * @returns The count of matching activity feed items.
   */
  async countByUser({ userId, activityType }: { userId: number; activityType?: ActivityType }) {
    log.debug("Counting activity feed items by user", { userId, activityType });

    return this.prismaClient.activityFeedItem.count({
      where: {
        userId,
        ...(activityType !== undefined && { activityType }),
      },
    });
  }

  /**
   * Deletes activity feed items older than a specified date for a given user.
   *
   * Used for activity feed retention and cleanup to prevent unbounded growth
   * of the activity_feed_item table.
   *
   * @param params - Object containing userId and the olderThan date threshold.
   * @returns A Prisma BatchPayload with the count of deleted records.
   */
  async deleteOldActivity({ userId, olderThan }: { userId: number; olderThan: Date }) {
    log.debug("Deleting old activity feed items", { userId, olderThan: olderThan.toISOString() });

    return this.prismaClient.activityFeedItem.deleteMany({
      where: {
        userId,
        createdAt: {
          lt: olderThan,
        },
      },
    });
  }
}
