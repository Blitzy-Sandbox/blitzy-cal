"use client";

import type { JSX } from "react";
import { useCallback, useEffect, useRef, useState } from "react";

import { trpc } from "@calcom/trpc/react";
import { Icon } from "@calcom/ui/components/icon";

/**
 * NF-004 — Notification Bell Component
 *
 * Renders a bell icon in the top navigation / sidebar header with an unread
 * count badge. Clicking the bell opens a dropdown panel listing recent
 * notifications. Clicking a notification marks it as read and navigates to
 * the associated URL.
 *
 * Uses the `viewer.inAppNotifications` tRPC router for data fetching and
 * mutations. Polls for unread count every 30 seconds to keep the badge
 * up-to-date without WebSocket infrastructure.
 */

/** Interval in milliseconds for polling unread count */
const POLL_INTERVAL_MS = 30_000;

/** Minimal type for notification items returned by the tRPC list endpoint */
interface NotificationItem {
  id: number;
  title: string;
  body: string | null;
  url: string | null;
  status: string;
  createdAt: string | Date;
}

/**
 * Formats a date into a human-readable relative time string.
 * Examples: "just now", "5m ago", "2h ago", "3d ago"
 */
function formatRelativeTime(date: string | Date): string {
  const now = new Date();
  const then = new Date(date);
  const diffMs = now.getTime() - then.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);

  if (diffSeconds < 60) return "just now";
  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) return `${diffDays}d ago`;
  const diffMonths = Math.floor(diffDays / 30);
  return `${diffMonths}mo ago`;
}

/** Build the aria-label string for the bell button. */
function buildAriaLabel(unreadCount: number): string {
  if (unreadCount > 0) return `Notifications (${unreadCount} unread)`;
  return "Notifications";
}

/** Determine the badge display text (caps at 99+). */
function formatBadgeCount(count: number): string {
  return count > 99 ? "99+" : String(count);
}

export function NotificationBell(): JSX.Element {
  const [isOpen, setIsOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Fetch unread count for badge — auto-refetches on interval
  const { data: unreadData } = trpc.viewer.inAppNotifications.unreadCount.useQuery(undefined, {
    refetchInterval: POLL_INTERVAL_MS,
    refetchIntervalInBackground: false,
  });

  // Fetch notification list (only when dropdown is open)
  const { data: notifications, refetch: refetchList } = trpc.viewer.inAppNotifications.list.useQuery(
    { limit: 10 },
    { enabled: isOpen }
  );

  // Mutations
  const utils = trpc.useUtils();
  const markAsReadMutation = trpc.viewer.inAppNotifications.markAsRead.useMutation({
    onSuccess: (): void => {
      utils.viewer.inAppNotifications.unreadCount.invalidate();
      refetchList();
    },
  });
  const markAllAsReadMutation = trpc.viewer.inAppNotifications.markAllAsRead.useMutation({
    onSuccess: (): void => {
      utils.viewer.inAppNotifications.unreadCount.invalidate();
      refetchList();
    },
  });

  const unreadCount = unreadData?.count ?? 0;

  // Close dropdown when clicking outside
  useEffect((): (() => void) | undefined => {
    if (!isOpen) return undefined;
    const handleClickOutside = (event: MouseEvent): void => {
      if (
        panelRef.current &&
        !panelRef.current.contains(event.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return (): void => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  // Close dropdown on Escape key
  useEffect((): (() => void) | undefined => {
    if (!isOpen) return undefined;
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setIsOpen(false);
    };
    document.addEventListener("keydown", handleKeyDown);
    return (): void => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  const handleToggle = useCallback((): void => {
    setIsOpen((prev) => !prev);
  }, []);

  const handleNotificationClick = useCallback(
    (id: number, url?: string | null): void => {
      markAsReadMutation.mutate({ id });
      if (url) {
        window.location.href = url;
      }
      setIsOpen(false);
    },
    [markAsReadMutation]
  );

  const handleMarkAllAsRead = useCallback((): void => {
    markAllAsReadMutation.mutate();
  }, [markAllAsReadMutation]);

  return (
    <div className="relative">
      {/* Bell button */}
      <button
        ref={buttonRef}
        data-testid="notification-bell"
        onClick={handleToggle}
        className="relative rounded-full p-1 text-muted transition hover:bg-cal-muted hover:text-subtle focus:outline-none focus:ring-2 focus:ring-black focus:ring-offset-2"
        aria-label={buildAriaLabel(unreadCount)}>
        <Icon name="bell" size={16} className="h-4 w-4 text-default" />
        {/* Unread count badge */}
        {unreadCount > 0 && (
          <span
            data-testid="notification-badge"
            className="absolute -top-0.5 -right-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-brand-default px-1 font-bold text-[10px] text-white">
            {formatBadgeCount(unreadCount)}
          </span>
        )}
      </button>

      {/* Dropdown panel */}
      {isOpen && (
        <div
          ref={panelRef}
          data-testid="notification-panel"
          className="absolute top-full right-0 z-50 mt-2 w-80 overflow-hidden rounded-lg border border-subtle bg-default shadow-lg">
          {/* Header */}
          <div className="flex items-center justify-between border-subtle border-b px-4 py-3">
            <h3 className="font-semibold text-emphasis text-sm">Notifications</h3>
            {unreadCount > 0 && (
              <button
                data-testid="mark-all-read"
                onClick={handleMarkAllAsRead}
                className="font-medium text-subtle text-xs transition hover:text-emphasis">
                Mark all as read
              </button>
            )}
          </div>

          {/* Notification list */}
          <div className="max-h-80 overflow-y-auto">
            {!notifications || notifications.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-subtle">No notifications</div>
            ) : (
              <ul className="divide-y divide-subtle">
                {notifications.map((notification: NotificationItem) => (
                  <li key={notification.id}>
                    <button
                      onClick={() => handleNotificationClick(notification.id, notification.url)}
                      className={`w-full px-4 py-3 text-left transition hover:bg-muted ${
                        notification.status === "READ" ? "opacity-60" : ""
                      }`}>
                      <div className="flex items-start gap-3">
                        {/* Unread indicator dot */}
                        {notification.status !== "READ" && (
                          <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand-default" />
                        )}
                        <div className={notification.status === "READ" ? "pl-5" : ""}>
                          <p className="font-medium text-emphasis text-sm leading-tight">
                            {notification.title}
                          </p>
                          {notification.body && (
                            <p className="mt-0.5 line-clamp-2 text-subtle text-xs">{notification.body}</p>
                          )}
                          <p className="mt-1 text-muted text-xs">
                            {formatRelativeTime(notification.createdAt)}
                          </p>
                        </div>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
