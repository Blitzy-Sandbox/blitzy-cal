# Notifications & Workflows Design

## Overview

Sprint 8: Notifications & Workflows (F-011) achieves behavioral parity between Cal.com's multi-channel notification infrastructure and Calendly's notification and workflow automation system. This sprint covers 4 epics (NF-001 through NF-004) spanning email notification template parity, SMS/WhatsApp reminder parity via Twilio, workflow automation trigger and action parity, and in-app notification and activity feed parity. Sprint 8 is a Wave 4 sprint, starting only after both Sprint 4 (Webhooks & Events) and Sprint 7 (Admin & Teams) complete their validation gates.

Cal.com's notification architecture already surpasses Calendly in channel breadth — supporting email, SMS, WhatsApp, and AI phone calls (CalAI) — and in workflow automation depth, with 15+ dispatch functions in `email-manager.ts`, 8 `WorkflowAction` types, and configurable triggers via the `packages/features/ee/workflows/` engine. This sprint closes the remaining content-level and behavioral alignment gaps to ensure Cal.com users experience notification quality at parity with or exceeding Calendly's notification lifecycle.

## Problem Statement

Cal.com's notification infrastructure already exceeds Calendly in channel breadth (email, SMS, WhatsApp, AI phone calls via CalAI) and workflow automation depth (15+ dispatch functions in `email-manager.ts`, 8+ `WorkflowAction` types, configurable triggers through the `packages/features/ee/workflows/` engine). However, four content-level and behavioral alignment gaps exist compared to Calendly's notification system:

1. **Email template content alignment (NF-001)**: Cal.com's email templates include core booking details but may not consistently present all content elements that Calendly shows in its notification emails. Calendly's booking confirmation, reminder, and cancellation emails include: attendee name, event title, date/time with timezone, location/meeting link, organizer contact information, and an ICS calendar attachment. Cal.com's templates must be audited and extended to ensure complete content parity across all notification lifecycle emails — confirmation (`AttendeeScheduledEmail`, `OrganizerScheduledEmail`), reminder (workflow-triggered), cancellation (`AttendeeCancelledEmail`, `OrganizerCancelledEmail`), and rescheduled (`AttendeeRescheduledEmail`, `OrganizerRescheduledEmail`).

2. **SMS/WhatsApp reminder format (NF-002)**: Default SMS reminder templates dispatched via `SMSManager` (in `packages/sms/sms-manager.ts`) and its concrete subclasses (`EventSuccessfullyScheduledSMS`, `EventCancelledSMS`, etc.) may lack meeting location information. Calendly's SMS reminders include the meeting location or a link to the virtual meeting room. The `getMessage()` abstract method implementations in `packages/sms/attendee/` must be extended to include location data when available, while respecting Twilio's 1600-character SMS segment limit.

3. **Workflow automation trigger coverage (NF-003)**: The trigger guard in `scheduleBookingReminders.ts` (line 32) and `scheduleWorkflowNotifications.ts` (line 80) is hard-coded to only accept `WorkflowTriggerEvents.BEFORE_EVENT` and `WorkflowTriggerEvents.AFTER_EVENT`, returning early for all other trigger types. This prevents extensibility for future Calendly-parity triggers. Additionally, the `bookingSelect` in `scheduleWorkflowNotifications.ts` (lines 8–57) does not include `location` or `description` fields, meaning workflow-triggered notifications lack this content. The `bookingInfo` construction in `scheduleBookingReminders.ts` (lines 42–76) similarly omits these fields. Finally, mandatory email reminders dispatched by `scheduleEmailReminders.ts` do not include ICS calendar attachments, which Calendly includes in all reminder emails.

4. **In-app notification absence (NF-004)**: Cal.com currently has no in-app notification or activity feed system. All booking lifecycle notifications (confirmations, cancellations, rescheduling, team invitations) are delivered exclusively through external channels (email, SMS, WhatsApp). Calendly provides an in-app notification bell with an activity feed that shows recent booking events. Cal.com needs a new `packages/features/notifications/` module to deliver in-app notifications alongside existing channel dispatch.

This sprint encompasses four cataloged epics:

| Epic ID | Name | Priority | Complexity |
|---------|------|----------|------------|
| NF-001 | Email notification template parity | High | M |
| NF-002 | SMS/WhatsApp reminder parity via Twilio | Medium | M |
| NF-003 | Workflow automation trigger and action parity | High | L |
| NF-004 | In-app notification and activity feed | Medium | L |

## User Stories

- As a Cal.com event organizer, I want my booking confirmation emails to include the attendee name, event title, date/time with timezone, location, and an ICS calendar attachment so that they match Calendly's professional notification format and attendees have all information needed to join the meeting.

- As a Cal.com attendee, I want to receive SMS reminders that include the meeting location or virtual meeting link so that I can easily find my way to the meeting without needing to search through emails.

- As a Cal.com admin, I want to configure workflow automations with extensible trigger types so that I can set up reminders and follow-ups that match Calendly's workflow capabilities and accommodate future trigger additions without code changes.

- As a Cal.com user, I want to see booking notifications in an in-app activity feed so that I don't have to rely solely on email and SMS for booking updates and can quickly see my recent booking activity at a glance.

- As a Cal.com team admin, I want notification templates to respect team branding and organizational settings (including per-organization email disable toggles) so that notifications maintain professional consistency across all team members.

- As a Cal.com workflow author, I want workflow-triggered email reminders to include an ICS calendar attachment so that recipients can add the event to their calendar directly from the reminder email, matching Calendly's reminder behavior.

## Technical Design

### Database Changes

All schema changes follow zero-downtime-safe patterns defined in `docs/migration/zero-downtime-strategy.mdx`. No column renames, type changes, NOT NULL without defaults, or any other anti-patterns are used. All changes are fully additive.

#### 1. WorkflowTriggerEvents Enum — Additive Extension (If Needed)

```sql
ALTER TYPE "WorkflowTriggerEvents" ADD VALUE 'NEW_VALUE_IF_NEEDED';
```

- **Pattern**: Pattern 1 — Additive enum value addition
- **Purpose**: Reserve capacity for future Calendly-parity trigger types beyond `BEFORE_EVENT` and `AFTER_EVENT`
- **Constraint**: No removal or reordering of existing enum values (`BEFORE_EVENT`, `AFTER_EVENT`, `NEW_EVENT`, `EVENT_CANCELLED`, `RESCHEDULE_EVENT`, `NEW_EVENT_BUFFER`, `AFTER_HOSTS_CAL_VIDEO_NO_SHOW`, `AFTER_GUESTS_CAL_VIDEO_NO_SHOW`)
- **Implementation note**: If no new trigger types are required for NF-003 parity, this migration step is skipped. The code refactoring to use an extensible `SCHEDULABLE_TRIGGERS` set still proceeds regardless.

#### 2. WorkflowActions Enum — Additive Extension

```sql
ALTER TYPE "WorkflowActions" ADD VALUE 'IN_APP_NOTIFICATION';
```

- **Pattern**: Pattern 1 — Additive enum value addition
- **Purpose**: Support the new in-app notification delivery channel for NF-004
- **Constraint**: No removal or reordering of existing enum values (`EMAIL_HOST`, `EMAIL_ATTENDEE`, `EMAIL_ADDRESS`, `SMS_ATTENDEE`, `SMS_NUMBER`, `WHATSAPP_ATTENDEE`, `WHATSAPP_NUMBER`, `CAL_AI_PHONE_CALL`)
- **Behavior**: When a workflow step uses `IN_APP_NOTIFICATION`, the system creates an `InAppNotification` record instead of dispatching an external message

#### 3. InAppNotification Model — Table for NF-004

```prisma
model InAppNotification {
  id          Int       @id @default(autoincrement())
  userId      Int
  title       String
  body        String
  type        String
  status      String    @default("UNREAD")
  url         String?
  icon        String?
  metadata    Json?
  createdAt   DateTime  @default(now())
  readAt      DateTime?
  dismissedAt DateTime?
  user        User      @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@index([userId, status])
  @@index([userId, createdAt])
}
```

- **Pattern**: New table creation (fully additive)
- **Purpose**: Store in-app notifications for the activity feed (NF-004)
- **No modifications to existing tables** — the `User` model gains only a new back-relation
- **Key design choices**:
  - `body` (not `message`) — stores the notification body content
  - `status` as `String` (not `Boolean read`) — supports multiple states (e.g., `"UNREAD"`, `"READ"`, `"DISMISSED"`) with default `"UNREAD"`
  - `url` (not `actionUrl`) — URL to navigate to when the notification is clicked
  - `icon` — optional icon identifier for visual differentiation
  - `metadata` as `Json` — flexible key-value storage for notification-specific context
  - `readAt` and `dismissedAt` as optional `DateTime` — track when notifications were read or dismissed, replacing a simple boolean flag
  - No `uid` field — notifications are identified by auto-incremented `id`
  - No `updatedAt` field — state changes are tracked via `readAt` and `dismissedAt` timestamps
- **Related model**: `ActivityFeedItem` — a separate model for the activity feed, also present in the Prisma schema
- **Indexes**: Index on `(userId)` for user-scoped queries; composite index on `(userId, status)` for efficient unread count queries; composite index on `(userId, createdAt)` for chronological feed pagination
- **Migration SQL**:
  ```sql
  CREATE TABLE "InAppNotification" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'UNREAD',
    "url" TEXT,
    "icon" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMP(3),
    "dismissedAt" TIMESTAMP(3),
    CONSTRAINT "InAppNotification_pkey" PRIMARY KEY ("id")
  );
  CREATE INDEX "InAppNotification_userId_idx" ON "InAppNotification"("userId");
  CREATE INDEX "InAppNotification_userId_status_idx" ON "InAppNotification"("userId", "status");
  CREATE INDEX "InAppNotification_userId_createdAt_idx" ON "InAppNotification"("userId", "createdAt");
  ALTER TABLE "InAppNotification" ADD CONSTRAINT "InAppNotification_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  ```

#### 4. Migration File

- **Path**: `packages/prisma/migrations/[timestamp]_notifications_workflows_parity/migration.sql`
- **Contents**: The `WorkflowActions` enum addition, `InAppNotification` table creation, and index creation statements above
- **Schema file**: `packages/prisma/schema.prisma` — `InAppNotification` model and `IN_APP_NOTIFICATION` in `WorkflowActions`
- **Rollback strategy**: New table can be dropped; new enum value can be left in place (unused values cause no harm). No data loss on rollback.

#### 5. Data Preservation Guarantee

All existing records in the following tables remain intact and unmodified:

- **`Workflow`** — All existing workflow definitions preserved. No field changes.
- **`WorkflowStep`** — All existing step configurations preserved. Existing `action` enum values continue to work identically.
- **`WorkflowsOnEventTypes`** — All workflow-to-event-type bindings preserved.
- **`WorkflowReminder`** — All scheduled and sent reminders preserved. No schema changes to this table.
- **`EmailType` enum** — All 9 existing values preserved: `CONFIRMATION`, `CANCELLATION`, `RESCHEDULED`, `REQUEST`, `REASSIGNED`, `AWAITING_PAYMENT`, `RESCHEDULE_REQUEST`, `LOCATION_CHANGE`, `NEW_EVENT`.
- **Email templates** — All existing template classes and their rendering pipeline remain unchanged. Content additions are additive only.
- **Verification**: Row count comparison before and after migration for `Workflow`, `WorkflowStep`, `WorkflowsOnEventTypes`, and `WorkflowReminder` tables.

### API Changes

#### File: `packages/features/ee/workflows/lib/scheduleWorkflowNotifications.ts` (NF-003)

Extend `bookingSelect` (lines 8–57) with location and description fields for Calendly-equivalent notification content:

```typescript
export const bookingSelect = {
  // ... existing fields preserved ...
  location: true,    // NEW: Include meeting location for notification content
  description: true, // NEW: Include event description for notification content
  // ... rest unchanged ...
};
```

Replace the hard-coded trigger guard (line 80) with an extensible `SCHEDULABLE_TRIGGERS` set:

```typescript
// Before (hard-coded):
if (trigger !== WorkflowTriggerEvents.BEFORE_EVENT && trigger !== WorkflowTriggerEvents.AFTER_EVENT) return;

// After (extensible):
const SCHEDULABLE_TRIGGERS = new Set<WorkflowTriggerEvents>([
  WorkflowTriggerEvents.BEFORE_EVENT,
  WorkflowTriggerEvents.AFTER_EVENT,
]);
if (!SCHEDULABLE_TRIGGERS.has(trigger)) return;
```

The `getBookings` function (lines 96–193) automatically picks up the new `bookingSelect` fields — no additional changes needed to this function.

#### File: `packages/features/ee/workflows/lib/scheduleBookingReminders.ts` (NF-003)

Replace the hard-coded trigger guard (line 32) with the same extensible `SCHEDULABLE_TRIGGERS` pattern:

```typescript
const SCHEDULABLE_TRIGGERS = new Set<WorkflowTriggerEvents>([
  WorkflowTriggerEvents.BEFORE_EVENT,
  WorkflowTriggerEvents.AFTER_EVENT,
]);
if (!SCHEDULABLE_TRIGGERS.has(trigger)) return;
```

Add `location` and `description` fields to the `bookingInfo` construction (lines 42–76):

```typescript
const bookingInfo = {
  // ... existing fields preserved ...
  location: booking.location || undefined, // NEW: Pass location to notification templates
  description: booking.description || undefined, // NEW: Pass description to notification templates
  // ... rest unchanged ...
};
```

All 8 existing `WorkflowActions` handling paths (EMAIL_HOST, EMAIL_ATTENDEE, EMAIL_ADDRESS, SMS_NUMBER, WHATSAPP_NUMBER, SMS_ATTENDEE, WHATSAPP_ATTENDEE, CAL_AI_PHONE_CALL) remain unchanged.

Add a new handler branch for the `IN_APP_NOTIFICATION` action (NF-004 integration):

```typescript
} else if (step.action === WorkflowActions.IN_APP_NOTIFICATION) {
  // Create in-app notification via NotificationService
  // Implementation deferred to NF-004 epic implementation
}
```

#### File: `packages/features/ee/workflows/api/scheduleEmailReminders.ts` (NF-003)

Enhance the mandatory reminder section with ICS calendar attachment generation. Calendly includes `.ics` files in all reminder emails:

- Construct an event object from the booking data for ICS generation using the existing `generateIcsString` utility from `packages/emails/lib/`
- Attach the generated ICS string to the email template's `ics` property
- Wrap ICS generation in try/catch — if generation fails (e.g., invalid date data), the email is still sent without the attachment
- All existing template rendering paths preserved unchanged

#### File: `packages/features/ee/workflows/api/scheduleSMSReminders.ts` (NF-003)

Append location information to default `REMINDER` template SMS messages:

- When the booking has a `location` field and the workflow step uses the default `REMINDER` template, append the location as a suffix to the SMS body
- Respect Twilio's 1600-character SMS segment limit — if appending the location would exceed the limit, truncate or omit the location suffix
- All existing SMS dispatch logic preserved unchanged

#### File: `packages/emails/email-manager.ts` (NF-001)

The existing 15+ dispatch functions (`sendScheduledEmailsAndSMS`, `sendCancelledEmailsAndSMS`, `sendRescheduledEmailsAndSMS`, `sendReassignedScheduledEmailsAndSMS`, `sendRoundRobinRescheduledEmailsAndSMS`, `sendRoundRobinCancelledEmailsAndSMS`, `sendReassignedEmailsAndSMS`, `sendRescheduledSeatEmailAndSMS`, `sendScheduledSeatsEmailsAndSMS`, `sendCancelledSeatEmailsAndSMS`, `sendOrganizerRequestEmail`, `sendAttendeeRequestEmailAndSMS`, `sendDeclinedEmailsAndSMS`, `sendAwaitingPaymentEmailAndSMS`, `sendRequestRescheduleEmailAndSMS`, `sendLocationChangeEmailsAndSMS`, `sendAddGuestsEmails`, `sendAddGuestsEmailsAndSMS`, `sendAddAttendeeEmailsAndSMS`) are verified for Calendly content parity:

- **Confirmation emails** (`_sendScheduledEmailsAndSMS`): Verify `AttendeeScheduledEmail` and `OrganizerScheduledEmail` templates include attendee name, event title, date/time with timezone, location, and ICS calendar attachment
- **Cancellation emails** (`sendCancelledEmailsAndSMS`): Verify `AttendeeCancelledEmail` includes cancellation reason (if provided), original event details, and organizer contact
- **Rescheduled emails** (`_sendRescheduledEmailsAndSMS`): Verify `AttendeeRescheduledEmail` includes original and new date/time with timezone, location, and updated ICS attachment
- **Reminder emails** (workflow-triggered): Ensure content matches confirmation email content
- All existing function signatures preserved — no breaking changes to the public API surface
- The `sendEmail` helper (lines 50–59) with its try/catch error handling remains unchanged
- Organization-level email settings integration via `shouldSkipAttendeeEmailWithSettings` (checking all 9 `EmailType` values) remains unchanged

#### File: `packages/emails/templates/` (NF-001)

Update email template content for Calendly format alignment:

- **Confirmation templates** (`AttendeeScheduledEmail`, `OrganizerScheduledEmail`): Ensure templates render attendee name, event title, date/time with timezone, meeting location (physical or virtual), organizer contact information, and ICS calendar attachment
- **Reminder templates** (workflow-triggered via `scheduleEmailReminders.ts`): Same content as confirmation, with "Reminder:" prefix in subject line
- **Cancellation templates** (`AttendeeCancelledEmail`, `OrganizerCancelledEmail`): Cancellation reason (when available), original event details (title, date/time, location), and organizer contact
- **Rescheduled templates** (`AttendeeRescheduledEmail`, `OrganizerRescheduledEmail`): Previous and updated date/time, location, and updated ICS attachment
- All existing template class hierarchies and base `BaseEmailHtml` layout components remain unchanged
- React-based email rendering via `react-dom/server` (`packages/emails/src/renderEmail.ts`) remains unchanged

#### File: `packages/sms/sms-manager.ts` (NF-002)

The abstract `SMSManager` class (lines 75–156) is enhanced:

- No changes to the abstract class itself — the abstract `getMessage(attendee: Person)` method signature is preserved
- Enhancement is in the concrete subclasses in `packages/sms/attendee/`:
  - `EventSuccessfullyScheduledSMS` — Include meeting location in the message when `calEvent.location` is available
  - `EventCancelledSMS` — Include original meeting location for reference
  - `EventSuccessfullyReScheduledSMS` — Include updated meeting location
  - `EventRequestSMS`, `EventDeclinedSMS`, `EventLocationChangedSMS` — Include location where applicable
- The `handleSendingSMS` function (lines 13–59) with its hierarchical rate limiting via `checkSMSRateLimit` (team ID → organizer user ID → hashed phone number) remains unchanged
- The `isSMSNotificationEnabled` private method (lines 89–105) with organization settings caching remains unchanged

#### New Module: `packages/features/notifications/` (NF-004)

A new feature module for in-app notifications and activity feed:

- **`repositories/InAppNotificationRepository.ts`** — Prisma-based CRUD repository following the existing repository pattern:
  - `create(data)` — Create a new in-app notification
  - `findByUserId(userId, options)` — Paginated query with cursor-based pagination, sorted by `createdAt` descending
  - `countUnread(userId)` — Count notifications with `status: "UNREAD"` for badge display
  - `markAsRead(id, userId)` — Set `status` to `"READ"` and `readAt` to current timestamp with ownership verification
  - `markAllAsRead(userId)` — Mark all notifications as read for a user
  - `dismiss(id, userId)` — Set `dismissedAt` timestamp
  - `deleteOlderThan(days)` — TTL-based cleanup for notifications older than the specified threshold (default: 90 days)

- **`services/InAppNotificationService.ts`** — Business logic service:
  - `createBookingNotification(userId, bookingData, type)` — Create a notification for booking lifecycle events
  - `createTeamNotification(userId, teamData, type)` — Create a notification for team-related events
  - `getNotificationFeed(userId, cursor?, limit?)` — Retrieve paginated notification feed
  - `getUnreadCount(userId)` — Get count of notifications with `status: "UNREAD"`
  - `markRead(notificationId, userId)` — Mark notification as read (sets `readAt` and updates `status`)
  - `markAllRead(userId)` — Mark all notifications as read
  - `cleanupExpired()` — Remove notifications older than 90 days (designed for cron job invocation)

- **`di/tokens.ts`** — DI token definitions following existing patterns in `packages/features/routing-forms/di/tokens.ts` and `packages/features/ee/organizations/di/`:
  - `NOTIFICATION_DI_TOKENS.IN_APP_NOTIFICATION_REPOSITORY` — Symbol token for repository injection
  - `NOTIFICATION_DI_TOKENS.ACTIVITY_FEED_REPOSITORY` — Symbol token for activity feed repository injection
  - `NOTIFICATION_DI_TOKENS.IN_APP_NOTIFICATION_SERVICE` — Symbol token for service injection
  - `NOTIFICATION_DI_TOKENS.IN_APP_NOTIFICATION_SERVICE_MODULE` — Symbol token for service module injection

- **`types/index.ts`** — TypeScript interfaces:
  - `NotificationType` — String union type for notification categories
  - `CreateNotificationInput` — Input type for notification creation
  - `NotificationFeedOptions` — Pagination options (cursor, limit)
  - `NotificationFeedResult` — Paginated result with notifications and next cursor

- **API endpoints** (tRPC or REST):
  - `GET /notifications` — List notifications with cursor-based pagination
  - `PATCH /notifications/:id/read` — Mark a single notification as read
  - `PATCH /notifications/read-all` — Mark all notifications as read
  - `GET /notifications/unread-count` — Get unread notification count for badge display

### UI Changes

#### Notification Templates (NF-001)

Email templates in `packages/emails/templates/` are updated for Calendly format content alignment. This is a content-only change — no visual UI redesign of the email layout or CSS overhaul is in scope. The existing `BaseEmailHtml` component structure and `react-dom/server` rendering pipeline remain unchanged. Changes target the data fields included in each template:

- Confirmation emails: Attendee name, event title, date/time with timezone, location/meeting link, organizer information, ICS calendar attachment
- Cancellation emails: Cancellation reason, original event details
- Rescheduled emails: Previous and new date/time, updated location, updated ICS attachment

#### In-App Notification Feed (NF-004)

A new UI component in the Cal.com web application:

- **Notification bell icon** in the navigation header with an unread count badge
- **Dropdown feed** showing recent notifications, sorted chronologically (newest first)
- **Each notification item** displays: icon, title, body preview, timestamp (relative — e.g., "2 hours ago"), and a link (`url`) to the relevant booking or page
- **Mark as read** — clicking a notification sets `status` to `"READ"` (recording `readAt` timestamp) and navigates to the `url`
- **Mark all as read** — bulk action to clear unread state for all notifications
- **Empty state** — friendly message when no notifications exist
- Implementation details deferred to the NF-004 epic implementation phase

#### Workflow Settings (NF-003)

No UI changes needed to the workflow automation settings pages. The existing workflow builder UI already supports trigger and action configuration via dropdowns populated from `getOptions.ts`. New trigger types and action types (e.g., `IN_APP_NOTIFICATION`) automatically appear in the dropdown options when added to the Prisma enums. The existing `WorkflowAction` display components handle unknown action types gracefully.

## Edge Cases

### 1. Concurrent Notification Dispatch Across Channels

A booking creation triggers email, SMS, and in-app notification simultaneously. If one channel fails (e.g., Twilio returns an error for SMS), the other channels should still succeed independently. **Mitigation**: Each channel dispatch in `email-manager.ts` uses independent `sendEmail` promises wrapped in try/catch (lines 50–59). SMS dispatch in `SMSManager.sendSMSToAttendee` has its own error handling. In-app notification creation is an independent database write. All three channels execute via separate `Promise.all` entries, so individual failures do not cascade.

### 2. SMS Credit Exhaustion Mid-Batch

The `CreditService` check passes for the first attendee in a multi-attendee booking, but SMS credits run out before the second attendee's message is sent. **Mitigation**: The `sendSmsOrFallbackEmail` function in `packages/features/ee/workflows/lib/reminders/messageDispatcher.ts` falls back to email dispatch when credits are unavailable. Each attendee's SMS send is an independent promise, so partial failures result in a mix of SMS and email delivery rather than total failure.

### 3. Organization-Level Notification Disable

An organization disables SMS notifications via `disablePhoneOnlySMSNotifications` in organization settings. Individual user preferences must still be respected for non-phone-only bookings. **Mitigation**: `SMSManager.isSMSNotificationEnabled()` (lines 89–105 in `sms-manager.ts`) checks org settings via `getTeamWithOrganizationSettings` and caches the result in `_isSMSNotificationEnabled`. The check only applies to phone-only SMS bookings (where `isSmsCalEmail(attendee.email)` returns true). Regular email notifications continue unaffected.

### 4. Email Template Rendering Failure

`react-dom/server` rendering throws an exception for a corrupted or malformed email template. **Mitigation**: Each email send is wrapped in try/catch in `email-manager.ts`'s `sendEmail` helper (lines 50–59), which catches the preparation error and logs it via `console.error`. The promise rejects but does not crash the process. Other emails in the same `Promise.all` batch continue to send successfully.

### 5. Workflow Trigger Race Condition

A booking is created and immediately cancelled before the `BEFORE_EVENT` workflow reminder fires. The workflow scheduler might attempt to send a reminder for a cancelled booking. **Mitigation**: The `getBookings` function in `scheduleWorkflowNotifications.ts` (lines 96–193) filters to `status: BookingStatus.ACCEPTED` and `startTime: { gte: new Date() }`, ensuring that cancelled bookings and past bookings are excluded from reminder scheduling. The `scheduleBookingReminders.ts` function also exits early if `bookings.length === 0`.

### 6. In-App Notification Table Growth

Active users with many bookings generate large notification volumes over time. Without cleanup, the `Notification` table could grow unboundedly. **Mitigation**: Implement a TTL-based cleanup function in `NotificationService.cleanupExpired()` that deletes notifications older than 90 days. This function is designed for invocation by a periodic cron job. Feed queries use cursor-based pagination via `@@index([userId, createdAt])` to maintain constant-time performance regardless of total notification count.

### 7. Twilio Rate Limiting

Twilio returns HTTP 429 when the SMS sending rate is exceeded, either globally or per-number. **Mitigation**: `handleSendingSMS` in `sms-manager.ts` (lines 13–59) already implements hierarchical rate limiting via `checkSMSRateLimit` using identifiers based on team ID, organizer user ID, or a hashed recipient phone number. This pre-flight rate check prevents most 429 responses. For Twilio-side rate limits, the `sendSmsOrFallbackEmail` function in `messageDispatcher.ts` falls back to email when SMS dispatch fails.

### 8. ICS Attachment Generation Failure

The `generateIcsString` utility (from `packages/emails/lib/`) fails for a booking with invalid date data (e.g., `endTime` before `startTime` due to a data integrity issue). **Mitigation**: ICS generation is wrapped in a dedicated try/catch block within the email reminder flow. If ICS generation fails, the email is still sent without the calendar attachment. A warning is logged for the failed ICS generation. This ensures the notification reaches the recipient even when the ICS file cannot be generated.

## Out of Scope

The following items are explicitly excluded from Sprint 8: Notifications & Workflows:

1. **NF-005: SMS reminder configuration parity** — Listed in the epic catalog but explicitly not included in Sprint 8 scope. The user's scope is NF-001 through NF-004 only. SMS reminder timing configuration (e.g., user-configurable reminder intervals) is deferred.

2. **Sprint 1–3 and Sprint 4–7 implementations** — Upstream sprints are assumed complete with validation gates passed. Sprint 8 depends on Sprint 4 (Webhooks) and Sprint 7 (Admin/Teams) passing their gates but does not modify their code. No modifications to `packages/features/webhooks/`, `packages/features/ee/organizations/`, or `packages/features/ee/teams/` beyond verifying integration points.

3. **New email delivery provider integration** — No addition of SendGrid, Resend, Mailgun, or other email providers beyond the existing multi-provider system in `packages/emails/`. The existing SMTP/provider routing via `nodemailer` (v7.0.12) remains unchanged.

4. **New SMS provider integration** — No addition of Vonage, AWS SNS, MessageBird, or other SMS/WhatsApp providers. Twilio remains the exclusive SMS/WhatsApp delivery provider through `packages/sms/`.

5. **Email template visual redesign** — Only content alignment with Calendly's notification format is in scope. No visual redesign of email layouts, CSS overhaul, or `BaseEmailHtml` component restructuring. The existing react-based email rendering pipeline remains unchanged.

6. **Real-time push notifications** — WebSocket-based or Server-Sent Events (SSE) real-time notification delivery is deferred. NF-004 implements a polling-based activity feed only. Real-time push can be added as a future enhancement without breaking the polling API.

7. **Notification analytics and tracking** — Email open tracking, click tracking, delivery rate analytics, bounce handling improvements, and notification delivery dashboards are deferred. These are monitoring enhancements, not behavioral parity items.

8. **CalAI phone call enhancements** — The existing `CAL_AI_PHONE_CALL` WorkflowAction (handled in `scheduleBookingReminders.ts` lines 201–215 via `scheduleAIPhoneCall`) is out of scope. NF-003 focuses on email, SMS, WhatsApp, and in-app notification action parity only.

9. **Workflow template marketplace** — Sharing, exporting, and importing workflow templates between users or organizations is deferred. This is a feature enhancement beyond Calendly parity.

10. **Performance optimization of email-manager.ts** — No refactoring of the existing 15+ dispatch functions for performance, code deduplication, or architectural improvement unless directly required for behavioral parity. The current `Promise.all` batching pattern is sufficient for notification delivery.
