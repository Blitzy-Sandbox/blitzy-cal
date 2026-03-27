import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { CalendarCancellationSyncService } from "@calcom/features/calendars/lib/cancellation-sync/CalendarCancellationSyncService";
import { OutlookCancellationHandler } from "@calcom/features/calendars/lib/cancellation-sync/handlers/OutlookCancellationHandler";
import { PrismaFeatureRepository } from "@calcom/features/flags/repositories/PrismaFeatureRepository";
import prisma from "@calcom/prisma";

import { defaultResponderForAppDir } from "app/api/defaultResponderForAppDir";

/**
 * Microsoft Graph Change Notification Webhook Handler
 *
 * Receives change notification payloads from the Microsoft Graph API when
 * subscribed calendar resources change (events created, updated, or deleted).
 *
 * Microsoft Graph uses two interaction patterns:
 * 1. Validation handshake (GET): When a subscription is created, Graph sends a
 *    GET request with a `validationToken` query parameter. The endpoint must
 *    respond with the token as plain text with HTTP 200 to confirm the endpoint.
 * 2. Change notifications (POST): After validation, Graph sends POST requests
 *    containing a `value[]` array of change notification objects.
 *
 * Each change notification includes:
 * - subscriptionId: The subscription that generated this notification
 * - changeType: "created", "updated", or "deleted"
 * - resource: The Graph API resource path (e.g., "me/events/{eventId}")
 * - resourceData: Additional data about the changed resource
 * - clientState: A validation token set when the subscription was created
 *
 * This route handles the validation handshake and forwards change notifications
 * to the existing OutlookCancellationHandler for processing.
 * It does NOT implement sync logic directly.
 *
 * @see https://learn.microsoft.com/en-us/graph/webhooks
 */

/** Shape of a single Microsoft Graph change notification */
interface GraphChangeNotification {
  subscriptionId: string;
  changeType: string;
  resource: string;
  resourceData?: {
    "@odata.type"?: string;
    "@odata.id"?: string;
    "@odata.etag"?: string;
    id?: string;
  };
  clientState?: string;
  tenantId?: string;
  subscriptionExpirationDateTime?: string;
}

/** Shape of the Microsoft Graph change notification payload */
interface GraphNotificationPayload {
  value: GraphChangeNotification[];
}

/**
 * GET /api/webhooks/microsoft-graph
 *
 * Handles the Microsoft Graph subscription validation handshake.
 * When creating a subscription, Graph sends a GET request with a `validationToken`
 * query parameter. The endpoint must echo the token back as plain text.
 */
async function getHandler(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const validationToken = searchParams.get("validationToken");

  if (!validationToken) {
    return NextResponse.json({ error: "Missing validationToken query parameter" }, { status: 400 });
  }

  // Microsoft Graph requires the validation token to be returned as plain text
  // with Content-Type: text/plain and HTTP 200 status.
  return new NextResponse(validationToken, {
    status: 200,
    headers: {
      "Content-Type": "text/plain",
    },
  });
}

/**
 * Validates that the change notifications contain valid clientState tokens
 * matching the configured webhook token.
 */
function validateNotifications(notifications: GraphChangeNotification[]): {
  valid: boolean;
  error?: string;
} {
  const expectedClientState = process.env.OUTLOOK_WEBHOOK_TOKEN;

  // If no token is configured, skip client state validation
  if (!expectedClientState) {
    return { valid: true };
  }

  // Validate clientState for each notification
  for (const notification of notifications) {
    if (notification.clientState && notification.clientState !== expectedClientState) {
      return { valid: false, error: "Invalid clientState in notification" };
    }
  }

  return { valid: true };
}

/**
 * POST /api/webhooks/microsoft-graph
 *
 * Handles incoming Microsoft Graph change notifications.
 * Parses the notification payload, validates clientState, and forwards
 * to the existing Outlook cancellation handler for processing.
 */
async function postHandler(request: NextRequest) {
  let body: GraphNotificationPayload;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  // Validate the notification payload structure
  if (!body.value || !Array.isArray(body.value) || body.value.length === 0) {
    return NextResponse.json({ error: "Missing or empty value array in payload" }, { status: 400 });
  }

  // Validate clientState tokens
  const validation = validateNotifications(body.value);
  if (!validation.valid) {
    return NextResponse.json({ error: validation.error }, { status: 401 });
  }

  // Forward notifications to the existing Outlook cancellation handler.
  // The handler will determine whether events were deleted/declined and
  // propagate cancellations through the Cal.com booking lifecycle.
  try {
    const featureRepository = new PrismaFeatureRepository(prisma);
    const cancellationSyncService = new CalendarCancellationSyncService({ featureRepository });
    const handler = new OutlookCancellationHandler(cancellationSyncService);

    await handler.handleNotification(request, body.value);
  } catch (error) {
    // Log the error but still return 202 to prevent Microsoft Graph from
    // retrying failed notifications indefinitely. The error will be captured
    // by the defaultResponderForAppDir wrapper's Sentry integration.
    console.error("Error processing Microsoft Graph change notification:", error);
  }

  // Microsoft Graph expects 202 Accepted for successful notification processing
  return NextResponse.json({ status: "accepted" }, { status: 202 });
}

export const GET = defaultResponderForAppDir(getHandler);
export const POST = defaultResponderForAppDir(postHandler);
