import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { CalendarCancellationSyncService } from "@calcom/features/calendars/lib/cancellation-sync/CalendarCancellationSyncService";
import { GoogleCancellationHandler } from "@calcom/features/calendars/lib/cancellation-sync/handlers/GoogleCancellationHandler";
import { PrismaFeatureRepository } from "@calcom/features/flags/repositories/PrismaFeatureRepository";
import prisma from "@calcom/prisma";

import { defaultResponderForAppDir } from "app/api/defaultResponderForAppDir";

/**
 * Google Calendar Push Notification Webhook Handler
 *
 * Receives push notification payloads from the Google Calendar API when
 * watched calendar resources change (events created, updated, or deleted).
 *
 * Google sends notification metadata via HTTP headers:
 * - X-Goog-Channel-ID: The channel ID specified when the watch was set up
 * - X-Goog-Channel-Token: The token set when the watch was created (used for validation)
 * - X-Goog-Resource-ID: An opaque identifier for the watched resource
 * - X-Goog-Resource-State: "sync" (initial), "exists" (changed), "not_exists" (deleted)
 * - X-Goog-Resource-URI: The API URI of the changed resource
 * - X-Goog-Message-Number: Incrementing message counter
 * - X-Goog-Channel-Expiration: Channel expiration time
 *
 * This route validates the channel token, parses headers into a structured payload,
 * and forwards to the existing GoogleCancellationHandler for processing.
 * It does NOT implement sync logic directly.
 *
 * @see https://developers.google.com/calendar/api/guides/push
 */

/** Shape of the parsed Google Calendar notification payload */
interface GoogleCalendarNotificationPayload {
  channelId: string;
  resourceId: string;
  resourceState: string;
  channelToken: string;
  resourceUri?: string;
  messageNumber?: string;
  channelExpiration?: string;
}

/**
 * Validates that the required Google push notification headers are present
 * and that the channel token matches the configured webhook token.
 */
function validateRequest(request: NextRequest): {
  valid: boolean;
  error?: string;
  payload?: GoogleCalendarNotificationPayload;
} {
  const channelToken = request.headers.get("x-goog-channel-token");
  const resourceState = request.headers.get("x-goog-resource-state");
  const channelId = request.headers.get("x-goog-channel-id");
  const resourceId = request.headers.get("x-goog-resource-id");

  // Channel token is required for authentication
  if (!channelToken) {
    return { valid: false, error: "Missing X-Goog-Channel-Token header" };
  }

  // Resource state is required to determine the notification type
  if (!resourceState) {
    return { valid: false, error: "Missing X-Goog-Resource-State header" };
  }

  // Validate channel token against the configured webhook token
  const expectedToken = process.env.GOOGLE_WEBHOOK_TOKEN;
  if (expectedToken && channelToken !== expectedToken) {
    return { valid: false, error: "Invalid channel token" };
  }

  return {
    valid: true,
    payload: {
      channelId: channelId || "",
      resourceId: resourceId || "",
      resourceState,
      channelToken,
      resourceUri: request.headers.get("x-goog-resource-uri") || undefined,
      messageNumber: request.headers.get("x-goog-message-number") || undefined,
      channelExpiration: request.headers.get("x-goog-channel-expiration") || undefined,
    },
  };
}

async function postHandler(request: NextRequest) {
  const validation = validateRequest(request);

  if (!validation.valid || !validation.payload) {
    return NextResponse.json({ error: validation.error }, { status: 401 });
  }

  const { payload } = validation;

  // For "sync" resource state, Google is confirming the watch was set up.
  // We acknowledge it immediately without further processing.
  if (payload.resourceState === "sync") {
    return NextResponse.json({ status: "ok", message: "Sync notification acknowledged" }, { status: 200 });
  }

  // Forward notification to the existing cancellation sync handler for processing.
  // The handler will determine whether the event was deleted/declined and
  // propagate cancellations through the Cal.com booking lifecycle.
  try {
    const featureRepository = new PrismaFeatureRepository(prisma);
    const cancellationSyncService = new CalendarCancellationSyncService({ featureRepository });
    const handler = new GoogleCancellationHandler(cancellationSyncService);

    await handler.handleNotification(request);
  } catch (error) {
    // Log the error but still return 200 to prevent Google from retrying
    // failed notifications indefinitely. The error will be captured by
    // the defaultResponderForAppDir wrapper's Sentry integration.
    console.error("Error processing Google Calendar push notification:", error);
  }

  return NextResponse.json({ status: "ok" }, { status: 200 });
}

/**
 * POST /api/webhooks/google-calendar
 *
 * Handles incoming Google Calendar push notifications.
 * Returns HTTP 200 on successful receipt to acknowledge the notification.
 */
export const POST = defaultResponderForAppDir(postHandler);
