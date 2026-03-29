# Notifications & Workflows

## Overview

Sprint 8: Notifications & Workflows (F-011) achieves behavioral parity between Cal.com's multi-channel notification infrastructure and Calendly's notification and workflow automation system. This feature encompasses four core epics — email notification template parity with Calendly confirmations and reminders (NF-001), SMS/WhatsApp reminder parity via Twilio (NF-002), workflow automation trigger and action parity through the existing `packages/features/ee/workflows/` engine (NF-003), and in-app notification and activity feed parity (NF-004). Key parity gaps being closed include email template content alignment with Calendly's notification format (attendee name, event title, date/time, location, timezone, and ICS calendar attachment), SMS reminder location information enrichment, workflow trigger extensibility for scheduling automations, and a new in-app activity feed for booking lifecycle and team events.

## How to Use

### Step 1: Configure Email Notification Templates and Verify Calendly-Format Content

Navigate to your workflow automation settings to configure email notifications for booking lifecycle events. Booking confirmation emails now include all Calendly-equivalent content elements: the attendee name, event title, date and time with timezone, location, meeting link, and an ICS calendar attachment for one-click calendar addition. Reminder emails follow the same comprehensive content format as confirmations, ensuring attendees receive consistent information at every touchpoint. Cancellation emails include the cancellation reason alongside the original event details so attendees have full context.

The `EmailType` enum governs notification categories across the platform, with nine values controlling dispatch behavior: `CONFIRMATION`, `CANCELLATION`, `RESCHEDULED`, `REQUEST`, `REASSIGNED`, `AWAITING_PAYMENT`, `RESCHEDULE_REQUEST`, `LOCATION_CHANGE`, and `NEW_EVENT`. Each value maps to a specific email template and is checked against organization-level disable flags — administrators can suppress specific notification categories by configuring `disableStandardEmails.all.attendee` and `disableStandardEmails.all.host` in organization settings, providing fine-grained control over which emails are sent to attendees and organizers respectively.

*Screenshot: Navigate to email notification settings to view template content and configuration options. Capture this screenshot when the email template preview is available and save as ./screenshots/step-1.png.*

### Step 2: Configure Workflow Automation Triggers and SMS/WhatsApp Reminders

Navigate to **Settings → Workflows** to create and configure workflow automations for automated pre-event and post-event notifications. Configure trigger types including `BEFORE_EVENT` and `AFTER_EVENT` triggers to schedule reminders at specific intervals before or after a booking. Each workflow can combine multiple actions — such as sending an email to the attendee and an SMS to a specific number — to create multi-channel notification sequences.

SMS and WhatsApp reminders are delivered via Twilio and now include location information matching Calendly's SMS reminder format, so attendees receive meeting venue or link details directly in their text messages. SMS reminders respect Twilio's 1600 character limit when appending the location suffix to ensure messages are delivered without truncation. SMS delivery is gated by the CreditService for credit-based authorization and by organization-level opt-out settings via `disablePhoneOnlySMSNotifications`. When SMS credits are unavailable, the system automatically falls back to email delivery via `sendSmsOrFallbackEmail`, ensuring attendees still receive their reminders. Rate limiting is enforced via `handleSendingSMS` using a hierarchical identifier strategy based on team ID, organizer ID, or hashed recipient number, preventing abuse while maintaining reliable delivery.

*Screenshot: Navigate to Settings → Workflows to view trigger and action configuration for automated reminders with SMS/WhatsApp settings. Capture this screenshot when the workflow automation UI is available and save as ./screenshots/step-2.png.*

## Configuration Options

| Option | Description | Default |
|--------|-------------|---------|
| `EmailType` enum | Governs notification categories for email dispatch. Values: `CONFIRMATION`, `CANCELLATION`, `RESCHEDULED`, `REQUEST`, `REASSIGNED`, `AWAITING_PAYMENT`, `RESCHEDULE_REQUEST`, `LOCATION_CHANGE`, `NEW_EVENT`. Each value maps to a specific email template and is checked against organization-level disable flags via `shouldSkipAttendeeEmailWithSettings`. | All 9 types enabled |
| `WorkflowTriggerEvents` | Prisma enum controlling when workflow automations fire. Includes `BEFORE_EVENT` and `AFTER_EVENT` triggers for scheduling reminders. New trigger values are additive-only per zero-downtime migration rules. Workflow triggers are configured per-event-type via the `WorkflowsOnEventTypes` relation. | `BEFORE_EVENT` and `AFTER_EVENT` available |
| `WorkflowActions` | Prisma enum controlling what actions workflow automations perform. Includes `EMAIL_HOST`, `EMAIL_ATTENDEE`, `SMS_ATTENDEE`, `SMS_NUMBER`, `WHATSAPP_ATTENDEE`, `WHATSAPP_NUMBER`, `EMAIL_ADDRESS`, and `CAL_AI_PHONE_CALL`. New action values are additive-only. | All 8 action types available |
| SMS/WhatsApp via Twilio | SMS and WhatsApp reminders are delivered via Twilio. Delivery is gated by `CreditService.hasAvailableCredits` for credit checks, hierarchical rate limiting in `handleSendingSMS` (team ID → organizer ID → hashed recipient number), and organization-level opt-out via `disablePhoneOnlySMSNotifications`. When credits are unavailable, SMS falls back to email via `sendSmsOrFallbackEmail`. | Enabled when Twilio credentials are configured and credits are available |
| In-app notifications | New notification system for booking lifecycle events (created, cancelled, rescheduled) and team events (invitations, role changes). Notifications are stored in the `Notification` Prisma model with read/unread state and support paginated activity feed queries. | Enabled by default for all users |

## Common Use Cases

### Multi-Channel Booking Confirmation (Email + SMS + In-App)

When a booking is created, the email-manager dispatches `sendScheduledEmailsAndSMS` which formats the CalendarEvent, fetches organization settings, checks disable flags via `shouldSkipAttendeeEmailWithSettings` and `eventTypeDisableHostEmail`, enqueues `OrganizerScheduledEmail` for the host and `AttendeeScheduledEmail` for each attendee (unless `EmailType.CONFIRMATION` is disabled at the organization level), and then triggers `EventSuccessfullyScheduledSMS` for SMS delivery to phone-only attendees. Simultaneously, an in-app notification is created for the organizer via the new `packages/features/notifications/` module, recording the booking event in the activity feed. This ensures the organizer and attendees receive consistent booking information across all channels — email with ICS calendar attachment, SMS with location details, and in-app notification with a direct action URL to manage the booking.

### Workflow-Driven Pre-Event Reminders with Calendar Attachment

Workflow automations configured with a `BEFORE_EVENT` trigger and `EMAIL_ATTENDEE` plus `SMS_ATTENDEE` actions send reminders at a specified interval before the event. The `scheduleWorkflowNotifications.ts` entry point loads upcoming bookings with location and description fields, applies the trigger guard to filter eligible bookings, and routes to `scheduleBookingReminders.ts` for per-channel dispatch. Email reminders are enhanced with an ICS calendar attachment via `scheduleEmailReminders.ts`, matching Calendly's reminder format that includes .ics files for one-click calendar re-confirmation. SMS reminders are enhanced with location information via `scheduleSMSReminders.ts`, so attendees receive meeting venue details in their text messages. Cron-based scheduling handlers fire within a 2-hour look-ahead window, ensuring reminders are delivered at the configured time before the event without requiring persistent connections.

## FAQ

### How do I enable the notification parity features?

Email template content alignment (NF-001) applies automatically to all email dispatch — no feature flag is needed. The updated templates include Calendly-equivalent content (attendee name, event title, date/time with timezone, location, and calendar attachment) and are used whenever `email-manager.ts` dispatch functions are called. SMS/WhatsApp enhancements (NF-002) apply to existing Twilio-based delivery when Twilio credentials are configured and SMS credits are available through the CreditService. Workflow automation enhancements (NF-003) apply to the existing workflow engine — new trigger and action values appear automatically in the workflow configuration dropdowns via `getOptions.ts`. In-app notifications (NF-004) are enabled by default for all users once the `Notification` model migration is applied and the `packages/features/notifications/` module is deployed.

### How do notifications interact with team and organization settings?

Organization-level email disable flags are respected via `shouldSkipAttendeeEmailWithSettings` and `eventTypeDisableHostEmail` — these check `disableStandardEmails.all.attendee` and `disableStandardEmails.all.host` respectively, allowing administrators to suppress specific notification categories for their entire organization. Organization-level SMS opt-out via `disablePhoneOnlySMSNotifications` on organization settings gates all SMS delivery for team events, ensuring compliance with organizational communication policies. Team event routing directly affects notification recipients — round-robin and collective scheduling determine which team members receive organizer notifications based on the booking assignment. Additionally, `WorkflowOptOutService.addOptOutMessage` appends opt-out instructions to SMS reminders, ensuring compliance with messaging regulations and giving recipients control over future SMS communications.

### Is the database migration safe for production?

Yes. All schema changes follow zero-downtime migration patterns from `docs/migration/zero-downtime-strategy.mdx`. WorkflowTriggerEvents and WorkflowActions enum extensions are additive-only — using `ALTER TYPE ... ADD VALUE` with no removal or reordering of existing values, so all existing workflows continue to function without any changes. The new `Notification` model is a new table creation — fully additive, with no modifications to existing tables. All existing `Workflow`, `WorkflowStep`, `WorkflowsOnEventTypes`, and `WorkflowReminder` records are preserved with their current data intact. All existing email templates and the rendering pipeline remain unchanged. No data loss occurs under any circumstance — the data preservation mandate per `docs/migration/data-preservation.mdx` is enforced across all Sprint 8 migrations.
