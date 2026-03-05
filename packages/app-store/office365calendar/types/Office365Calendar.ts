export type O365AuthCredentials = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
};

/**
 * Microsoft Graph API v1.0 — Change Notification Resource Data
 *
 * Represents the resource data included in a Graph change notification.
 * Contains OData annotation properties identifying the resource type,
 * location, and version, along with the resource identifier.
 *
 * @see https://learn.microsoft.com/en-us/graph/api/resources/changenotification
 */
export interface GraphChangeNotificationResourceData {
  "@odata.type": string;
  "@odata.id": string;
  "@odata.etag"?: string;
  id: string;
}

/**
 * Microsoft Graph API v1.0 — Change Notification
 *
 * Represents a single change notification received from a Microsoft Graph
 * subscription. Each notification indicates a change (created, updated, or
 * deleted) to a subscribed resource such as a calendar event.
 *
 * Used by the OutlookCancellationHandler to detect when calendar events
 * are deleted or declined in Outlook/Office 365, enabling calendar-driven
 * cancellation sync back to Cal.com bookings (CI-001 gap closure).
 *
 * @see https://learn.microsoft.com/en-us/graph/api/resources/changenotification
 */
export interface GraphChangeNotification {
  subscriptionId: string;
  subscriptionExpirationDateTime: string;
  changeType: "created" | "updated" | "deleted";
  resource: string;
  resourceData: GraphChangeNotificationResourceData;
  clientState?: string;
  tenantId: string;
}

/**
 * Microsoft Graph API v1.0 — Change Notification Payload
 *
 * Top-level webhook payload structure received from Microsoft Graph
 * change notification subscriptions. Wraps an array of individual
 * change notifications in the `value` property.
 *
 * @see https://learn.microsoft.com/en-us/graph/webhooks
 */
export interface GraphChangeNotificationPayload {
  value: GraphChangeNotification[];
}

/**
 * Microsoft Graph API v1.0 — Subscription Creation Request
 *
 * Defines the shape of a request body for creating a new Microsoft Graph
 * change notification subscription. Used to subscribe to calendar event
 * changes (created, updated, deleted) for a specific user's calendar.
 *
 * Note: `changeType` is a comma-separated string (e.g., "created,updated,deleted"),
 * NOT a union type — Microsoft Graph API accepts it as a single delimited string.
 *
 * @see https://learn.microsoft.com/en-us/graph/api/subscription-post-subscriptions
 */
export interface GraphSubscriptionRequest {
  changeType: string;
  notificationUrl: string;
  resource: string;
  expirationDateTime: string;
  clientState?: string;
}

/**
 * Microsoft Graph API v1.0 — Subscription Creation Response
 *
 * Defines the shape of the response body returned by Microsoft Graph
 * after successfully creating a change notification subscription.
 * Includes the server-assigned subscription `id` along with the
 * echoed request parameters.
 *
 * @see https://learn.microsoft.com/en-us/graph/api/subscription-post-subscriptions
 */
export interface GraphSubscriptionResponse {
  id: string;
  resource: string;
  changeType: string;
  notificationUrl: string;
  expirationDateTime: string;
  clientState?: string;
}
