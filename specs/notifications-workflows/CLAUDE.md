# AGENTS.md — Notifications & Workflows

## Project Context

Sprint 8: Notifications & Workflows (F-011) of the Calendly gap closure initiative. This sprint brings Cal.com's multi-channel notification infrastructure and workflow automation engine to full behavioral parity with Calendly's notification lifecycle. It encompasses 4 epics: NF-001 (Email notification template parity with Calendly confirmations and reminders), NF-002 (SMS/WhatsApp reminder parity via Twilio), NF-003 (Workflow automation trigger and action parity through the existing `packages/features/ee/workflows/` engine), and NF-004 (In-app notification and activity feed parity). Sprint 8 is part of Wave 4 execution — it depends on BOTH Sprint 4 (Webhooks & Events) AND Sprint 7 (Admin & Teams) completing all five validation gate dimensions (behavioral testing, regression testing, data preservation, webhook compatibility, and cross-domain integration) before any implementation work can begin. There are 10 NF-VAL validation criteria defined in `docs/sprint-roadmap/validation-criteria.mdx` that must all pass for this sprint to clear its gate. Notification triggers share booking lifecycle events with webhook triggers (Sprint 4), and notification delivery rules and branding are affected by team and organization governance settings (Sprint 7), which is why both must be fully validated before Sprint 8 proceeds.

## Before Starting Work

1. Read `specs/notifications-workflows/design.md`
2. Check `specs/notifications-workflows/implementation.md` for current progress
3. Read the source-of-truth gap report at `docs/gap-report/notifications-workflows.mdx`
4. Read the validation criteria for NF-VAL in `docs/sprint-roadmap/validation-criteria.mdx`
5. Read the migration safety constraints at `docs/migration/zero-downtime-strategy.mdx` and `docs/migration/data-preservation.mdx`
6. Confirm that Sprint 4 (Webhooks) and Sprint 7 (Admin/Teams) have passed their Wave 3 validation gates before starting any implementation
7. Look at existing patterns in these relevant directories:
   - `packages/emails/email-manager.ts` — Central email dispatch orchestrator with 15+ functions including `sendScheduledEmailsAndSMS`, `sendCancelledEmailsAndSMS`, `sendRescheduledEmailsAndSMS`, `sendAwaitingPaymentEmailAndSMS`, `sendLocationChangeEmailsAndSMS`, `sendDeclinedEmailsAndSMS`, `sendOrganizerRequestEmail`, and `sendAttendeeRequestEmailAndSMS`
   - `packages/emails/email-types.ts` — `EmailType` enum with 9 values: `CONFIRMATION`, `CANCELLATION`, `RESCHEDULED`, `REQUEST`, `REASSIGNED`, `AWAITING_PAYMENT`, `RESCHEDULE_REQUEST`, `LOCATION_CHANGE`, `NEW_EVENT`
   - `packages/emails/templates/` — All email template implementations (scheduling confirmations, cancellations, reminders, admin, billing, workflow templates) plus `BaseEmail` subclasses with ICS attachments and localization constants
   - `packages/emails/src/renderEmail.ts` — Email rendering entry point using `react-dom/server` to render React email components to production-safe HTML strings with Outlook namespace injection and markup sanitization
   - `packages/emails/src/components/` — Email layout primitives: `BaseEmailHtml`, `BaseTable`, `EmailHead`, `CallToAction`, `ManageLink`, `RawHtml`, location/time helper components
   - `packages/emails/lib/` — ICS generation utilities (`generateIcsString`, `createIcsFile` with `BookingAction` and `GenerateIcsRole` enums), shared email utility functions
   - `packages/emails/workflow-email-service.ts` — Workflow-triggered email dispatch service following the private `sendEmail` wrapper pattern
   - `packages/emails/email-manager.test.ts` — Existing test suite for email dispatch guards, privacy controls, and organization settings overrides
   - `packages/sms/sms-manager.ts` — Abstract `SMSManager` class with `handleSendingSMS` centralized dispatcher enforcing hierarchical rate limits (team, organizer, hashed phone number), `CreditService` integration, `sendSmsOrFallbackEmail` delegation, and organization-level opt-out compliance
   - `packages/sms/attendee/` — 9 attendee-specific SMS template subclasses: `EventSuccessfullyScheduledSMS`, `AwaitingPaymentSMS`, `CancelledSeatSMS`, `EventCancelledSMS`, `EventDeclinedSMS`, `EventLocationChangedSMS`, `EventRequestSMS`, `EventRequestToRescheduleSMS`, `EventSuccessfullyReScheduledSMS`
   - `packages/sms/test/sms-manager.test.ts` — Vitest suite for SMS guards, formatting helpers, and Twilio dispatcher interactions
   - `packages/features/ee/workflows/lib/actionHelperFunctions.ts` — Deterministic predicates for channel detection, CalAI awareness, and template resolution tied to `WorkflowAction`/`WorkflowTemplate`/`WorkflowTrigger` enums
   - `packages/features/ee/workflows/lib/constants.ts` — Canonical trigger/action/template/time-unit lists, placeholder tokens, and trigger/operator subsets (`IMMEDIATE`, `FORM_TRIGGER`, `ATTENDEE`, `WHATSAPP`, `BASIC`)
   - `packages/features/ee/workflows/lib/scheduleBookingReminders.ts` — Per-channel reminder scheduler dispatching email, SMS, WhatsApp, and CalAI reminders for `BEFORE_EVENT`/`AFTER_EVENT` triggers with credit checks and verified email sender enforcement
   - `packages/features/ee/workflows/lib/scheduleWorkflowNotifications.ts` — Booking loader and trigger gatekeeper that validates triggers, loads bookings scoped by org/team/user, deduplicates via `alreadyScheduledActiveOnIds`, and funnels context into `scheduleBookingReminders`
   - `packages/features/ee/workflows/lib/variableTranslations.ts` — Mapping between canonical placeholder tokens and localized variants using `DYNAMIC_TEXT_VARIABLES` and `FORMATTED_DYNAMIC_TEXT_VARIABLES`
   - `packages/features/ee/workflows/lib/types.ts` — Shared `Workflow`/`WorkflowStep` typings, `ZWorkflow` schema, `WorkflowListType`, `BookingInfo`, `FormSubmissionData` interfaces
   - `packages/features/ee/workflows/repositories/WorkflowRepository.ts` — Static data-access façade with Zod schemas, shared select fragments, verified contact aggregators, permission-aware selectors, and reminder cleanup helpers
   - `packages/features/ee/workflows/repositories/WorkflowReminderRepository.ts` — Reminder-specific CRUD (create, find scheduled/cancellable, update channel metadata) using injected `PrismaClient`
   - `packages/features/ee/workflows/repositories/WorkflowRelationsRepository.ts` — Active relationship maintenance for `workflowsOnTeams`, `workflowsOnRoutingForms`, and `workflowsOnEventTypes` join tables
   - `packages/features/ee/workflows/repositories/WorkflowStepRepository.ts` — Workflow step persistence
   - `packages/features/ee/workflows/api/scheduleEmailReminders.ts` — `CRON_API_KEY`-guarded Next.js API handler for reconciling enterprise reminder emails with SendGrid or Tasker fallback dispatcher, using a 2-hour look-ahead scheduling horizon
   - `packages/features/ee/workflows/api/scheduleSMSReminders.ts` — `CRON_API_KEY`-guarded cron handler for Twilio SMS dispatch with 2-hour look-ahead, credit checks via `CreditService.hasAvailableCredits`, and opt-out instructions via `WorkflowOptOutService.addOptOutMessage`
   - `packages/features/ee/workflows/api/scheduleWhatsappReminders.ts` — WhatsApp reminder dispatch handler
   - `packages/features/ee/workflows/api/handleSMSResponse.ts` — Twilio webhook bridge for processing opt-out replies via `determineOptOutType` and `WorkflowOptOutService`
   - `packages/features/ee/workflows/lib/verifyEmailSender.ts` — Verified email sender enforcement across `verifiedEmail`, `user`, `secondaryEmail`, and team member records
   - `packages/features/ee/workflows/lib/isAuthorized.ts` — Workflow authorization with ownership resolution and team permission checks via `PermissionCheckService`
   - `packages/features/ee/workflows/lib/getOptions.ts` — Localized dropdown option builders for actions, triggers, and templates
   - `packages/prisma/schema.prisma` — `Workflow`, `WorkflowStep`, `WorkflowsOnEventTypes`, `WorkflowsOnTeams`, `WorkflowsOnRoutingForms`, `WorkflowReminder` models; `WorkflowTriggerEvents`, `WorkflowActions`, `WorkflowTemplates`, `WorkflowMethods`, `TimeUnit` enums

## Code Patterns

Key patterns to follow and reference implementations:

- **Multi-provider email system**: `packages/emails/email-manager.ts` exposes 15+ dispatch functions, each following the same orchestration pipeline: `formatCalEvent` → fetch org settings via `OrganizationSettingsRepository` → evaluate guards (`shouldSkipAttendeeEmailWithSettings`, `eventTypeDisableHostEmail`) → enqueue organizer/attendee templates → `Promise.all` for parallel delivery → SMS dispatch via attendee SMS subclasses. New email dispatch functions must follow this exact pipeline and use the `withReporting` wrapper for telemetry.

- **`EmailType` enum governance**: Every email action in `email-manager.ts` is gated by the `EmailType` enum defined in `packages/emails/email-types.ts`. The enum controls metadata-level disable flags via `shouldSkipAttendeeEmailWithSettings` and `eventTypeDisableHostEmail` guards. New notification types must add values to `EmailType` additively and integrate with the existing guard system — never bypass these guards.

- **react-dom/server email rendering**: `packages/emails/src/renderEmail.ts` is the single rendering entry point that resolves template components by name, dynamically imports `react-dom/server`, sanitizes generated markup (removing `RawHtml` script tags, adding Outlook XML namespaces), and returns production-safe HTML. All email templates must render through this pipeline — never use alternative rendering paths.

- **SMS/WhatsApp via Twilio**: `packages/sms/sms-manager.ts` defines the abstract `SMSManager` class. The delivery chain is: `sendSMSToAttendee` → validate attendee eligibility (phone presence, `@sms.cal.com` email guard, notification flag) → resolve Twilio sender via `getSenderId`/`SENDER_ID` → `handleSendingSMS` → enforce hierarchical rate limits (team, organizer, hashed phone) → `CreditService.hasAvailableCredits` → `sendSmsOrFallbackEmail`. Each attendee SMS subclass in `packages/sms/attendee/` only overrides `getMessage()` for localized copy while inheriting the full delivery orchestration from the base class.

- **Workflow engine architecture**: `packages/features/ee/workflows/` uses `WorkflowAction`/`WorkflowTrigger`/`WorkflowTemplates` enums as the canonical source of truth. The scheduling pipeline flows: `scheduleWorkflowNotifications.ts` (entry point: trigger validation, booking loading, deduplication) → `scheduleBookingReminders.ts` (per-channel dispatch for email, SMS, WhatsApp, CalAI with credit checks and verified sender enforcement). All new workflow triggers and actions must be registered in the Prisma enum and the constants defined in `constants.ts`.

- **DI pattern for repositories**: Workflow repositories (`WorkflowRepository`, `WorkflowReminderRepository`, `WorkflowRelationsRepository`, `WorkflowStepRepository`) use constructor-injected `PrismaClient` instances. `WorkflowRepository` additionally exposes static methods for data access. New repository classes must follow the same constructor injection pattern and use shared select fragments.

- **Cron-based reminder scheduling**: `scheduleEmailReminders.ts` and `scheduleSMSReminders.ts` in `packages/features/ee/workflows/api/` are `CRON_API_KEY`-guarded Next.js API handlers that operate with a 2-hour look-ahead window. They query unscheduled reminders, resolve recipients, render localized content, schedule via SendGrid/Twilio (or fallback), and update `workflowReminder` rows with batch IDs and scheduled flags. New cron handlers must follow the same auth pattern, look-ahead window convention, retry logic (`retryCount < 3`), and Prisma update pattern.

- **Template variable system**: `VariablesType` canonical placeholders include `{EVENT_NAME}`, `{ORGANIZER_NAME}`, `{ATTENDEE_NAME}`, `{EVENT_DATE}`, `{EVENT_TIME}`, `{TIME_ZONE}`, `{LOCATION}`, `{MEETING_URL}`, `{CANCEL_URL}`, `{RESCHEDULE_URL}`, and others defined in `packages/features/ee/workflows/lib/constants.ts`. `variableTranslations.ts` maps these between canonical tokens and localized variants using `DYNAMIC_TEXT_VARIABLES` and `FORMATTED_DYNAMIC_TEXT_VARIABLES`. All new template variables must be registered in both files.

- **Credit-based gating**: `CreditService.hasAvailableCredits` gates all SMS and WhatsApp dispatch before any message is sent. This credit check runs inside `handleSendingSMS` in `sms-manager.ts` and inside `scheduleSMSReminders.ts` for cron-based dispatch. New SMS/WhatsApp notification paths must always pass through credit verification — never send messages without confirming credits are available.

- **Opt-out service**: `WorkflowOptOutService.addOptOutMessage` appends opt-out instructions to every outgoing SMS in `scheduleSMSReminders.ts`. The `handleSMSResponse.ts` Twilio webhook processes incoming opt-out replies via `determineOptOutType` and persists them through `WorkflowOptOutService.optOutPhoneNumber` or `WorkflowOptOutContactRepository.removePhoneNumber`. New SMS notification channels must integrate with the opt-out service — never send SMS without opt-out instructions.

## Don't

- Don't break existing email dispatch functions — `sendScheduledEmailsAndSMS`, `sendCancelledEmailsAndSMS`, `sendRescheduledEmailsAndSMS`, `sendAwaitingPaymentEmailAndSMS`, `sendDeclinedEmailsAndSMS`, `sendLocationChangeEmailsAndSMS`, and `sendOrganizerRequestEmail` signatures must be preserved exactly
- Don't modify existing email template rendering pipeline destructively — `renderEmail.ts`, `BaseEmailHtml`, and email component primitives in `packages/emails/src/components/` must remain backward-compatible
- Don't change `EmailType` enum values destructively — only additive new values are permitted; never remove, rename, or reorder existing values (`CONFIRMATION`, `CANCELLATION`, `RESCHEDULED`, `REQUEST`, `REASSIGNED`, `AWAITING_PAYMENT`, `RESCHEDULE_REQUEST`, `LOCATION_CHANGE`, `NEW_EVENT`)
- Don't change `WorkflowAction`, `WorkflowTrigger`, `WorkflowTemplates`, or `WorkflowMethods` enum values destructively — only additive new values; existing enum members and their ordinal positions must be preserved in the Prisma schema
- Don't break SMS/Twilio integration — the hierarchical rate limiting (team, organizer, hashed phone), `CreditService` credit checks, `WorkflowOptOutService` opt-out compliance, and `sendSmsOrFallbackEmail` fallback chain in `sms-manager.ts` must remain intact
- Don't exceed 5–7 files changed (excluding tests) or 500 lines per PR — decompose larger changes into focused, single-concern pull requests
- Don't add features not in `specs/notifications-workflows/design.md` — all implementation must trace back to a documented requirement
- Don't skip tests — every epic must have corresponding unit, integration, or end-to-end tests covering its validation criteria
- Don't modify the AES-256 credential encryption implementation — `CALENDSO_ENCRYPTION_KEY` usage and encrypted data integrity must be preserved
- Don't combine notification parity with gap closure features from other sprints (Webhooks, Routing Forms, Embed, Admin/Teams) in the same PR
- Don't use column renames, type changes, NOT NULL without defaults, or any other destructive anti-patterns in migrations — all schema changes must be additive-only per `docs/migration/zero-downtime-strategy.mdx`
- Don't start implementation before Sprint 4 (Webhooks) AND Sprint 7 (Admin/Teams) pass their Wave 3 validation gates — all five gate dimensions (behavioral, regression, data preservation, webhook compatibility, cross-domain integration) must be verified
- Don't bypass the `shouldSkipAttendeeEmailWithSettings` or `eventTypeDisableHostEmail` guards when adding new email dispatch paths — all notification delivery must respect organization settings and metadata-level disable flags
- Don't send SMS or WhatsApp messages without passing through `CreditService.hasAvailableCredits` — credit verification is mandatory for all paid messaging channels
- Don't omit opt-out instructions from outgoing SMS — every SMS must include opt-out text via `WorkflowOptOutService.addOptOutMessage`
