import { z } from "zod";

import authedProcedure from "../../../procedures/authedProcedure";
import { router } from "../../../trpc";

/**
 * NF-004 — In-App Notifications tRPC Router
 *
 * Provides authenticated endpoints for the notification bell UI:
 * - list: Paginated notification list for the logged-in user
 * - unreadCount: Badge count for the notification bell
 * - markAsRead: Mark a single notification as read (on click)
 * - markAllAsRead: Bulk mark all notifications as read
 */
export const inAppNotificationsRouter = router({
  /** Fetch paginated notifications for the logged-in user. */
  list: authedProcedure
    .input(
      z
        .object({
          limit: z.number().min(1).max(50).optional().default(20),
          cursor: z.number().optional(),
        })
        .optional()
        .default({})
    )
    .query(async ({ ctx, input }) => {
      const { InAppNotificationService } = await import(
        "@calcom/features/notifications/services/InAppNotificationService"
      );
      const service = new InAppNotificationService();
      const notifications = await service.getNotifications({
        userId: ctx.user.id,
        limit: input.limit,
        cursor: input.cursor,
      });
      return notifications;
    }),

  /** Get the number of unread notifications for the bell badge. */
  unreadCount: authedProcedure.query(async ({ ctx }) => {
    const { InAppNotificationService } = await import(
      "@calcom/features/notifications/services/InAppNotificationService"
    );
    const service = new InAppNotificationService();
    const count = await service.getUnreadCount({ userId: ctx.user.id });
    return { count };
  }),

  /** Mark a single notification as read. */
  markAsRead: authedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const { InAppNotificationService } = await import(
        "@calcom/features/notifications/services/InAppNotificationService"
      );
      const service = new InAppNotificationService();
      const notification = await service.markAsRead({ id: input.id, userId: ctx.user.id });
      return notification;
    }),

  /** Mark all notifications as read for the logged-in user. */
  markAllAsRead: authedProcedure.mutation(async ({ ctx }) => {
    const { InAppNotificationService } = await import(
      "@calcom/features/notifications/services/InAppNotificationService"
    );
    const service = new InAppNotificationService();
    const result = await service.markAllAsRead({ userId: ctx.user.id });
    return result;
  }),
});
