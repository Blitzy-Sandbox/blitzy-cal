# Notifications & Workflows Prompts

## Sync Implementation Status

Review what's been implemented for notifications-workflows and update specs/notifications-workflows/implementation.md

Specifically check progress on:

- **NF-001**: Email notification template parity — `packages/emails/email-manager.ts` dispatch functions (`sendScheduledEmailsAndSMS`, `sendCancelledEmailsAndSMS`, `sendRescheduledEmailsAndSMS`), `packages/emails/templates/` for content alignment with Calendly format (attendee name, event title, date/time, location, timezone)
- **NF-002**: SMS/WhatsApp reminder parity via Twilio — `packages/sms/sms-manager.ts` for multi-channel delivery, `packages/sms/attendee/` templates for attendee-specific SMS content
- **NF-003**: Workflow automation trigger and action parity — `packages/features/ee/workflows/lib/scheduleWorkflowNotifications.ts` for trigger scheduling, `packages/features/ee/workflows/lib/scheduleBookingReminders.ts` for booking reminders, `packages/features/ee/workflows/api/scheduleEmailReminders.ts` for email reminder cron handlers, `packages/features/ee/workflows/api/scheduleSMSReminders.ts` for SMS reminder cron handlers
- **NF-004**: In-app notification and activity feed parity — `packages/features/notifications/` (new module) for real-time notification delivery and activity feed queries

## Generate Tests

Write tests for email dispatch functions, SMS/WhatsApp delivery, workflow automation triggers and actions, and in-app notification services. Follow existing test patterns in `packages/emails/` and `packages/features/ee/workflows/`.

Target test files to create or extend:

- `packages/emails/email-manager.test.ts` — Extended notification parity tests for NF-001 covering confirmation, reminder, and cancellation email dispatch
- `packages/sms/sms-manager.test.ts` — SMS reminder parity tests for NF-002 covering Twilio delivery, WhatsApp channel routing, and opt-out handling
- `packages/features/ee/workflows/lib/test/` — Workflow trigger and action tests for NF-003 covering trigger eligibility, action routing, and reminder scheduling
- `packages/features/notifications/__tests__/` — In-app notification tests for NF-004 covering notification creation, activity feed queries, and read/unread state management

Test coverage areas:

- Email template content matching Calendly format (attendee name, event title, date/time, location, timezone)
- Email rendering pipeline integrity via `react-dom/server` through `renderEmail.ts`
- ICS file attachment generation for confirmation and rescheduled emails via `packages/emails/lib/`
- SMS/WhatsApp message content and delivery via Twilio SDK
- SMS rate limiting, credit-based gating for SMS/WhatsApp reminders, and opt-out service compliance
- Workflow trigger eligibility (BEFORE_EVENT, AFTER_EVENT, NEW_EVENT, RESCHEDULE, CANCELLATION) and action routing
- Workflow reminder scheduling for both email and SMS channels via cron handlers
- Multi-channel dispatch (email + SMS for same booking event) ensuring parallel delivery
- Organization-level notification disable flags and team-level override behavior
- In-app notification creation, persistence, and activity feed query pagination
- Credential encryption integrity (AES-256 via `CALENDSO_ENCRYPTION_KEY`) for Twilio and email provider credentials

## Code Review

Review changes for:

- **Type safety**: Strict TypeScript types for all notification payloads, email template props, SMS message schemas, workflow trigger/action definitions, and in-app notification models
- **Error handling**: Graceful degradation on email delivery failures, SMS API errors, Twilio rate limiting (HTTP 429), workflow scheduling conflicts, and notification persistence failures
- **Security**: Credential encryption integrity (AES-256 via `CALENDSO_ENCRYPTION_KEY`), no credential leakage in logs or error messages, Twilio auth token protection, email content sanitization
- **Edge cases**: Timezone-sensitive reminder scheduling, concurrent workflow executions for the same booking, duplicate notification prevention, missing attendee email/phone fields, expired Twilio credentials

Notification-specific review items:

- **Email dispatch signatures preserved**: Existing email dispatch function signatures in `email-manager.ts` (`sendScheduledEmailsAndSMS`, `sendCancelledEmailsAndSMS`, `sendRescheduledEmailsAndSMS`, and all 15+ dispatch functions) must not have breaking changes — parameter types and return types must remain backward-compatible
- **`EmailType` enum stability**: `EmailType` enum values in `packages/emails/email-types.ts` must not be destructively modified — new values may be added but existing values must not be removed, reordered, or renamed
- **Email rendering pipeline preserved**: The `react-dom/server` rendering pipeline via `packages/emails/src/renderEmail.ts` and base components (`BaseEmailHtml`, `CallToAction`, etc.) in `packages/emails/src/components/` must remain unchanged
- **SMS/Twilio integration integrity**: `packages/sms/sms-manager.ts` integration must not break existing rate limiting, credit check, or opt-out service behavior
- **`WorkflowAction`/`WorkflowTrigger` enum stability**: Workflow enum values in the Prisma schema must not be destructively changed — new values may be added but existing values must not be removed or renamed
- **Workflow reminder scheduling backward-compatible**: Changes to `scheduleWorkflowNotifications.ts` and `scheduleBookingReminders.ts` must not alter behavior for existing workflow configurations
- **Zero-downtime migration compliance**: Any new Prisma enum values (e.g., new `WorkflowAction` or `WorkflowTrigger` entries) must follow additive-only patterns per `docs/migration/zero-downtime-strategy.mdx` — no column removals, no type changes, no NOT NULL without defaults
- **No changes to AES-256 credential encryption**: Encryption algorithm, key derivation (`CALENDSO_ENCRYPTION_KEY`), and storage format for Twilio credentials, email provider credentials, and all `Credential` records must remain intact
- **Data preservation**: Verify no existing `Workflow`, `WorkflowStep`, `WorkflowsOnEventTypes`, `WorkflowReminder`, or `BookingReference` records are modified or deleted

## Continue Feature

Continue working on notifications-workflows. Read specs/notifications-workflows/implementation.md for current status.

Key directories to reference:

- `packages/emails/` — email-manager.ts (central dispatch orchestrator with 15+ functions), email-types.ts (`EmailType` enum), templates/ (all email template implementations), src/ (renderEmail.ts, components/), lib/ (ICS generation, utilities)
- `packages/emails/workflow-email-service.ts` — Workflow-triggered email dispatch service
- `packages/sms/` — sms-manager.ts (SMS/WhatsApp delivery via Twilio), attendee/ (attendee-specific SMS templates)
- `packages/features/ee/workflows/` — lib/ (helpers, validators, schedulers including scheduleWorkflowNotifications.ts and scheduleBookingReminders.ts), repositories/ (WorkflowRepository, WorkflowReminderRepository), api/ (scheduleEmailReminders.ts, scheduleSMSReminders.ts cron handlers)
- `packages/features/notifications/` — new in-app notification and activity feed module
- `packages/prisma/schema.prisma` — Workflow, WorkflowStep, WorkflowsOnEventTypes, WorkflowReminder models and related enums (WorkflowAction, WorkflowTrigger, WorkflowMethods)
- `specs/notifications-workflows/design.md` — Design specification (source of truth for Sprint 8 architectural decisions)
- `specs/notifications-workflows/decisions.md` — Architecture Decision Records for multi-channel notification strategy, in-app notification model, and workflow trigger extensions

## Generate Docs with Screenshots

Generate documentation for notifications-workflows with screenshots:

1. Open the workflow automation settings page (`/settings/workflows`) in the browser
2. Take screenshots of key UI states:
   - Workflow automation settings page showing trigger/action configuration (BEFORE_EVENT, AFTER_EVENT, NEW_EVENT triggers with email/SMS actions)
   - Workflow step editor showing action type selection (email notification, SMS reminder, WhatsApp message)
   - Workflow template gallery (if available) showing pre-built notification workflows
3. Open the email notification preview and capture:
   - Email notification preview for booking confirmation (attendee name, event title, date/time, location, timezone)
   - Email notification preview for booking reminder
   - Email notification preview for booking cancellation
4. Open the SMS reminder configuration and capture:
   - SMS reminder configuration with Twilio settings and credit balance display
   - SMS opt-out management interface
5. Capture in-app notification UI (if UI is implemented):
   - In-app notification feed showing recent activity
   - Notification preferences panel
6. Save screenshots to `specs/notifications-workflows/docs/screenshots/`
7. Create/update `specs/notifications-workflows/docs/README.md` with:
   - Feature overview: Sprint 8 Notifications & Workflows covering email template parity, SMS/WhatsApp reminders, workflow automation, and in-app notifications with Calendly behavioral parity
   - How to use: Configuring workflow automations, customizing email notification templates, setting up SMS reminders via Twilio, managing in-app notification preferences
   - Configuration options: Workflow triggers (BEFORE_EVENT, AFTER_EVENT, NEW_EVENT, RESCHEDULE, CANCELLATION), action types (email, SMS, WhatsApp), reminder timing, organization-level notification disable flags, credit-based SMS gating
   - Common use cases: Automated booking confirmation emails, pre-event SMS reminders, post-event follow-up workflows, multi-channel notification dispatch for team bookings

## Promote Docs to Public

Promote internal docs to public Mintlify docs:

1. Review `specs/notifications-workflows/docs/README.md` for completeness and accuracy
2. Copy/adapt content to `docs/notifications-workflows.mdx` — rewrite for external audience
3. Move screenshots to `docs/images/notifications-workflows/`
4. Update `docs/docs.json` navigation to include the new notifications and workflows page
5. Ensure customer-appropriate language:
   - Remove internal implementation details (DI tokens, service class names, Prisma schema references, repository patterns)
   - Focus on user-facing functionality (configuring workflows, customizing email templates, setting up SMS reminders, managing notification preferences)
   - Use consistent terminology matching Cal.com's public documentation style
   - Omit references to Calendly parity or gap closure — present features as Cal.com capabilities
