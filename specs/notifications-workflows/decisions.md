# Notifications & Workflows Decisions

Architecture Decision Records (ADRs) for Sprint 8: Notifications & Workflows (F-011) of the Calendly gap closure initiative. Each ADR documents the context, options evaluated, final decision, and consequences for a key architectural trade-off encountered during Sprint 8 implementation.

---

## ADR-001: Email Template Rendering Approach

### Context

The NF-001 gap closure requires enhancing email notification templates to match Calendly's confirmation, reminder, and cancellation email format. Calendly sends polished, structured emails that include attendee name, event title, date/time with timezone, location details, and clear call-to-action buttons for rescheduling or cancelling. Cal.com must produce equivalent email content while maintaining its existing email infrastructure.

Cal.com already uses `react-dom/server` for rendering email templates via `packages/emails/src/renderEmail.ts`, which renders React components to static HTML strings suitable for email delivery. The existing template architecture uses class-based email templates extending a `BaseEmail` abstract class, with each template implementing a `getHtml()` method that renders a React component tree. Over 15 email templates follow this pattern, including `OrganizerScheduledEmail`, `AttendeeScheduledEmail`, `OrganizerCancelledEmail`, `AttendeeRescheduledEmail`, and others.

Reusable layout primitives in `packages/emails/src/components/` — including `BaseEmailHtml`, `CallToAction`, `Info`, `LocationInfo`, and `UserFieldsResponses` — provide a shared component library for consistent email styling across all templates. Eight specialized service files in `packages/emails/` orchestrate dispatch for different booking lifecycle events.

The question is whether to continue extending this existing `react-dom/server` rendering approach for the new Calendly-parity templates, or adopt a purpose-built email rendering framework that may offer better cross-client compatibility.

### Options Considered

1. **Continue react-dom/server rendering** (existing pattern)

   - Pros:
     - Zero learning curve for contributors already familiar with the Cal.com codebase — all 15+ email templates use this exact pattern
     - React components in `packages/emails/src/components/` provide a mature, reusable layout primitive library (BaseEmailHtml, CallToAction, Info, LocationInfo, etc.)
     - No new external dependencies required — `react-dom/server` is already a transitive dependency of the application
     - Consistent rendering behavior across all templates — new and existing templates share the same rendering pipeline via `renderEmail.ts`
     - ICS calendar attachment generation via `packages/emails/lib/generateIcsFile.ts` integrates seamlessly with the existing template lifecycle
     - The existing `BaseEmail` class provides standardized error handling, recipient management, and send orchestration
   - Cons:
     - React email rendering can produce verbose HTML output with deeply nested `<div>` elements and inline styles, increasing email payload size
     - CSS support is limited to inline styles — no external stylesheets or `<style>` blocks, which increases template verbosity
     - Debugging rendered email output requires rendering the component and inspecting the resulting HTML string rather than previewing in a browser
     - No built-in email client compatibility testing — developers must manually verify rendering in Gmail, Outlook, Apple Mail, and other clients

2. **Adopt a dedicated email framework** (e.g., react-email, MJML)

   - Pros:
     - Purpose-built for email rendering with better cross-client compatibility guarantees — frameworks like MJML automatically generate responsive, email-client-safe HTML
     - Cleaner template syntax with email-specific components (`<mj-section>`, `<mj-column>`, `<mj-button>`) rather than generic React components with inline styles
     - Built-in preview tools for iterating on email design without sending test emails
     - react-email specifically provides a React-based authoring experience, which would feel familiar to Cal.com developers
   - Cons:
     - New external dependency to add, evaluate, and maintain — increases the monorepo's dependency surface
     - Migration of all 15+ existing templates would be required for consistency, creating a significant migration effort that dwarfs the Calendly parity scope
     - During any migration period, two rendering systems would coexist, creating confusion for contributors about which system to use for new templates
     - Learning curve for the new framework's component API and configuration
     - The existing `BaseEmail` class abstraction, ICS generation, and dispatch orchestration in `packages/emails/email-manager.ts` would all need adaptation

### Decision

Continue with the existing `react-dom/server` rendering approach. The Cal.com email system is mature with over 15 templates, 8 specialized service files (`workflow-email-service.ts`, `booking-reschedule-email-service.ts`, `booking-cancel-email-service.ts`, etc.), and a well-established component library in `packages/emails/src/components/`. Introducing a new rendering framework for the Calendly parity templates would require migrating all existing templates to avoid maintaining two parallel rendering systems, which is a disproportionate effort relative to the parity benefit.

The existing approach produces reliable email output across major email clients (Gmail, Outlook, Apple Mail) and is already well-understood by all contributors. The Calendly parity changes for NF-001 are content-level enhancements — adding attendee details, refining layout structure, improving call-to-action buttons — rather than fundamental rendering architecture changes. These content updates are naturally expressed as modifications to existing React components and new component compositions within the current framework.

### Consequences

- All new email templates for NF-001 (enhanced confirmations, reminders, and cancellations) use the existing `BaseEmail` class extension pattern in `packages/emails/templates/`
- Email components in `packages/emails/src/components/` are reused and extended for new Calendly-parity templates — new components follow the same inline-style React pattern
- The `renderEmail.ts` rendering pipeline in `packages/emails/src/renderEmail.ts` remains unchanged — no modifications to the core rendering infrastructure
- Template content updates for Calendly format parity are purely content-level changes within existing React components: enhanced attendee information display, improved date/time formatting with timezone clarity, and refined call-to-action button styling
- The `email-manager.ts` dispatch functions (`sendScheduledEmailsAndSMS`, `sendCancelledEmailsAndSMS`, `sendRescheduledEmailsAndSMS`) are extended with additional template parameters rather than new rendering pathways
- No new external dependencies are added to `packages/emails/package.json`
- ICS calendar attachment generation via `packages/emails/lib/generateIcsFile.ts` continues to work identically with the enhanced templates

---

## ADR-002: SMS Provider Strategy

### Context

The NF-002 gap closure requires SMS and WhatsApp reminder parity with Calendly's notification system. Calendly sends text message reminders before scheduled events and supports customizable reminder timing. Cal.com must achieve equivalent SMS/WhatsApp reminder functionality.

Cal.com already has a mature Twilio-based SMS infrastructure centered on `packages/sms/sms-manager.ts`, which provides an `SMSManager` abstract class with concrete implementations for Twilio SMS and Twilio WhatsApp delivery. The existing infrastructure includes comprehensive operational safeguards:

- **Rate limiting** via `handleSendingSMS` in `packages/sms/attendee/` which enforces per-organization sending limits
- **Credit validation** via `CreditService` which checks available SMS credits before sending and deducts credits on successful delivery
- **Organizational opt-out** via `WorkflowOptOutService` which checks per-team and per-organization opt-out settings and appends opt-out instructions via `addOptOutMessage`
- **Email fallback** via `sendSmsOrFallbackEmail` which automatically falls back to email delivery when SMS is unavailable, disabled, or when credits are exhausted
- **Alphanumeric sender ID** restrictions via `alphanumericSenderIdSupport.ts` which maintains a country-specific blocklist for regions that do not support alphanumeric sender IDs

The question is whether to continue with Twilio exclusively for both SMS and WhatsApp delivery, or introduce a multi-provider abstraction layer for vendor flexibility and delivery redundancy.

### Options Considered

1. **Continue with Twilio exclusively**

   - Pros:
     - Zero migration effort — the entire SMS infrastructure (`SMSManager`, `CreditService`, `WorkflowOptOutService`, `handleSendingSMS`, `scheduleSmsOrFallbackEmail`) is built around Twilio's API
     - Twilio handles both SMS and WhatsApp through a single API surface (Twilio Messaging API with WhatsApp Business API integration), reducing the number of provider integrations to maintain
     - Mature integration with battle-tested error handling, retry logic, and delivery status tracking already implemented
     - Existing credit/rate-limit infrastructure does not need refactoring — `CreditService` credit checks and `handleSendingSMS` rate limits continue to work unchanged
     - Single API key management reduces operational complexity and secret rotation burden
   - Cons:
     - Single vendor lock-in — if Twilio experiences an outage or significantly raises prices, there is no automatic failover to an alternative provider
     - Twilio pricing may not be competitive in all geographic regions, particularly for international SMS delivery
     - No provider redundancy for high-availability delivery guarantees

2. **Multi-provider SMS abstraction** — Create a provider abstraction layer supporting Twilio, Vonage (formerly Nexmo), AWS SNS, MessageBird, etc.

   - Pros:
     - Vendor flexibility: the ability to route SMS through the cheapest or most reliable provider per destination region
     - Delivery redundancy: if one provider fails, messages can be automatically rerouted through an alternative provider
     - Cost optimization: route messages through the most cost-effective provider for each destination country
   - Cons:
     - Significant refactoring of `SMSManager`, `handleSendingSMS`, and all Twilio-specific code paths — the current implementation has deep Twilio coupling through API-specific error handling, status callback parsing, and WhatsApp template management
     - Each new provider requires its own integration, testing, credential management, and ongoing maintenance
     - Increases architectural complexity with provider routing logic, health checking, and failover orchestration
     - Completely out of scope for Calendly parity — Calendly itself does not expose its SMS provider infrastructure to users, so multi-provider support provides no parity benefit
     - WhatsApp Business API integration would need to be re-implemented per provider, as each provider has its own WhatsApp Business Platform integration

### Decision

Continue with **Twilio exclusively** for both SMS and WhatsApp delivery. The existing Twilio integration in `packages/sms/sms-manager.ts` is mature, battle-tested, and handles both channels through a single API. The operational safeguards — rate limiting (`handleSendingSMS`), credit validation (`CreditService`), organizational opt-out (`WorkflowOptOutService` with `getTeamWithOrganizationSettings`), and email fallback (`sendSmsOrFallbackEmail`) — represent significant investment that would need to be replicated or abstracted for any new provider.

Multi-provider SMS abstraction is explicitly out of scope for Calendly parity and would introduce substantial complexity without delivering any parity benefit. Calendly's SMS notifications are opaque to end users — the provider infrastructure is an implementation detail, not a user-facing feature.

### Consequences

- All NF-002 SMS and WhatsApp enhancements build on the existing `SMSManager` abstract class pattern in `packages/sms/sms-manager.ts`
- WhatsApp reminders continue through Twilio's WhatsApp Business API using the existing Twilio Messaging API integration
- `handleSendingSMS` rate limiting and `CreditService` credit checks in `packages/sms/` remain the gating mechanisms for all SMS delivery
- `WorkflowOptOutService.addOptOutMessage` continues to append opt-out instructions to SMS bodies for regulatory compliance
- Alphanumeric sender ID restrictions continue to use the `alphanumericSenderIdSupport.ts` country-specific blocklist
- The `scheduleSmsOrFallbackEmail` pattern is extended for new reminder types — when SMS delivery fails or credits are exhausted, reminders automatically fall back to email via `packages/emails/email-manager.ts`
- No new SMS/WhatsApp provider dependencies are added to `packages/sms/package.json`
- New SMS reminder templates for NF-002 are added to `packages/sms/attendee/` following the existing template pattern

---

## ADR-003: Workflow Trigger/Action Enum Extension Approach

### Context

The NF-003 gap closure requires extending workflow automation triggers and actions to achieve parity with Calendly's workflow system. Calendly's workflow automation supports triggers like "when an event is scheduled," "when an event is cancelled," and "before an event starts" with configurable timing offsets, plus actions like "send email notification," "send text notification," and "send webhook." Cal.com must support equivalent trigger/action combinations through its existing workflow engine in `packages/features/ee/workflows/`.

The `WorkflowTriggerEvents` and `WorkflowActions` enums are defined in `packages/prisma/schema.prisma` as Prisma enums. This means any changes to the set of available triggers or actions require a database migration to alter the PostgreSQL enum type. The zero-downtime migration strategy documented in `docs/migration/zero-downtime-strategy.mdx` mandates strictly additive-only changes: new enum values may be appended, but existing values must never be removed, renamed, or reordered.

The existing `WorkflowTriggerEvents` enum includes values such as `BEFORE_EVENT`, `EVENT_CANCELLED`, `NEW_EVENT`, `AFTER_EVENT`, and `RESCHEDULE_EVENT`. The existing `WorkflowActions` enum includes `EMAIL_HOST`, `EMAIL_ATTENDEE`, `SMS_ATTENDEE`, `SMS_NUMBER`, `EMAIL_ADDRESS`, `WHATSAPP_ATTENDEE`, and `WHATSAPP_NUMBER`. The workflow scheduling infrastructure in `scheduleBookingReminders.ts` and `scheduleWorkflowNotifications.ts` uses hard-coded guard sets that check for specific trigger values (e.g., `BEFORE_EVENT` and `AFTER_EVENT` for time-based reminder scheduling).

The question is whether to extend the existing Prisma enums additively, or create a separate extension mechanism for Calendly-parity triggers and actions.

### Options Considered

1. **Additive enum extension** — Append new values to the existing `WorkflowTriggerEvents` and `WorkflowActions` Prisma enums

   - Pros:
     - Fully backward-compatible — existing workflows with existing trigger/action values continue to function identically with zero changes
     - Simple migration: each new value requires a single `ALTER TYPE ... ADD VALUE` SQL statement, which is a non-locking operation in PostgreSQL 10+
     - Consistent with the existing single-enum pattern used throughout the workflow engine (`constants.ts`, `getOptions.ts`, `validators.ts`, scheduler functions)
     - No data migration needed — existing `WorkflowStep` records retain their current enum values unchanged
     - Downstream consumers (UI dropdown builders in `getOptions.ts`, workflow constant arrays in `constants.ts`) automatically pick up new values with minimal code changes
     - Follows Pattern 2 from the zero-downtime migration strategy (`docs/migration/zero-downtime-strategy.mdx`)
   - Cons:
     - Enums can grow large over time as more triggers and actions are added across multiple sprints
     - No ability to deprecate or remove unused enum values without a major migration involving data transformation
     - All trigger/action handling code must be updated to include the new values in switch statements and guard sets

2. **Separate enum/table for new triggers** — Create a new `ExtendedWorkflowTrigger` enum or a `WorkflowTriggerExtension` table for Calendly-parity triggers, keeping existing enums unchanged

   - Pros:
     - Isolates Calendly-parity triggers from the existing system, allowing independent evolution without risk to existing workflows
     - Allows a different data model for extended triggers (e.g., additional metadata columns that don't apply to original triggers)
     - Existing enum values remain completely untouched
   - Cons:
     - Breaks the single-enum pattern that the entire workflow engine relies on — every piece of code that processes triggers would need to check two sources
     - Increases query complexity: workflow scheduling, validation, and UI rendering would all need union logic across the original enum and the extension table/enum
     - Inconsistent with the existing architecture pattern established across the codebase — no other Cal.com feature uses a split-enum approach
     - The `WorkflowStep` model's `action` and trigger fields reference the Prisma enums directly; splitting would require schema-level changes to support polymorphic trigger references
     - Significantly more complex testing: every test that validates workflow behavior must account for triggers from two sources

### Decision

Use **additive enum extension**. Append new values to the existing `WorkflowTriggerEvents` and `WorkflowActions` enums in `packages/prisma/schema.prisma` via additive-only database migrations. This directly follows the zero-downtime migration mandate and maintains consistency with the single-enum pattern used throughout the workflow engine in `packages/features/ee/workflows/`.

The additive approach ensures that existing workflows continue to function with zero changes. New enum values are appended to the end of each enum definition (never inserted before existing values), and the corresponding `ALTER TYPE ... ADD VALUE` SQL statements are non-locking operations that can be executed without downtime.

### Consequences

- New migration files are added under `packages/prisma/migrations/` containing `ALTER TYPE "WorkflowTriggerEvents" ADD VALUE` and `ALTER TYPE "WorkflowActions" ADD VALUE` statements for each new trigger and action
- The `WorkflowTriggerEvents` enum in `packages/prisma/schema.prisma` is extended with new values appended after existing entries
- Existing workflow trigger/action handling in `packages/features/ee/workflows/lib/scheduleBookingReminders.ts` and `packages/features/ee/workflows/lib/scheduleWorkflowNotifications.ts` requires extension of trigger guard sets to recognize and process the new trigger values
- Workflow constants in `packages/features/ee/workflows/lib/constants.ts` — including `WORKFLOW_TRIGGER_EVENTS`, `WORKFLOW_ACTIONS`, and related arrays — receive additive updates for new enum values
- Dropdown builders in `packages/features/ee/workflows/lib/getOptions.ts` automatically pick up new enum values through the existing constant arrays, making them available in the workflow builder UI
- Workflow validators in `packages/features/ee/workflows/lib/` are updated to accept the new trigger and action values in validation schemas
- All existing workflows continue to function with zero changes — no existing `WorkflowStep`, `Workflow`, or `WorkflowReminder` records are modified
- No data migration is needed — existing database records retain their current enum values unchanged
- The `WorkflowsOnEventTypes` join table is unaffected — it continues to link workflows to event types regardless of which trigger values the workflows use

---

## ADR-004: In-App Notification Architecture

### Context

The NF-004 gap closure requires implementing in-app notification and activity feed parity with Calendly. Calendly provides an in-app notification system that alerts users to booking confirmations, cancellations, reschedulings, team invitation events, and other activity within the platform. Users can view a notification feed, mark notifications as read, and take action directly from notifications.

Cal.com currently does not have an in-app notification module. All user notifications are delivered exclusively through external channels: email via `packages/emails/email-manager.ts` (15+ dispatch functions), SMS via `packages/sms/sms-manager.ts`, and WhatsApp via the same Twilio infrastructure. There is no persistent in-app notification storage, no notification feed UI, and no read/unread state tracking within the Cal.com application.

The question is whether to build in-app notifications as a new standalone feature module following Cal.com's established module architecture, or extend the existing workflow/notification infrastructure to support in-app delivery as an additional channel.

### Options Considered

1. **New standalone module** at `packages/features/notifications/`

   - Pros:
     - Clean separation of concerns — in-app notifications have fundamentally different lifecycle requirements (persistent storage, read/unread state, categorization, paginated feed queries, real-time delivery) compared to workflow reminders (ephemeral, time-triggered, one-shot delivery)
     - Follows the established Cal.com feature module pattern with its own `repositories/`, `services/`, `di/`, and `types/` directories, consistent with `packages/features/membership/`, `packages/features/ee/organizations/`, and other feature modules
     - Independent evolution — the notification module can be enhanced, refactored, or extended without risk to the workflow engine
     - Clear ownership and discoverability — developers looking for notification-related code find it in a dedicated, well-organized module
     - The `Notification` Prisma model can be designed specifically for in-app notification requirements (read/unread state, categories, action URLs, sender references, expiry) without compromising the `WorkflowReminder` schema
     - DI tokens follow the existing symbol-based pattern (registered via `createModule` and `bindModuleToClassOnToken`), enabling clean dependency injection
   - Cons:
     - Requires a new database table (`Notification`) and corresponding Prisma model, adding to the schema surface
     - New API endpoints for notification CRUD (list, mark-read, mark-all-read, delete) must be implemented
     - More code to maintain — a new module with its own repository, service, and type definitions
     - Integration points with existing booking lifecycle must be explicitly wired (booking creation, cancellation, rescheduling events must trigger notification creation)

2. **Extend existing workflow system** — Add `IN_APP_NOTIFICATION` as a new `WorkflowAction` enum value and use the existing `WorkflowReminder` table to store in-app notifications

   - Pros:
     - Reuses the existing workflow scheduling infrastructure in `packages/features/ee/workflows/` — no new module, no new DI wiring
     - No new database table needed — `WorkflowReminder` already stores notification content, timing, and delivery status
     - Leverages the existing trigger/action pattern: in-app notifications would fire on the same triggers as email/SMS notifications
     - Fewer files to create and maintain
   - Cons:
     - The `WorkflowReminder` schema is designed for ephemeral, time-triggered reminders — it lacks columns for read/unread state, notification categories, action URLs, sender/actor identification, and notification expiry
     - Conflates two fundamentally different concerns: workflow reminders (fire-and-forget delivery tied to scheduling) and persistent notifications (stored, queryable, interactive)
     - Paginated notification feed queries would require complex filtering on the `WorkflowReminder` table to distinguish in-app notifications from email/SMS reminders, degrading query performance
     - The `WorkflowReminder` cleanup logic (which deletes fulfilled reminders) would conflict with the requirement to persist notifications for historical activity feed viewing
     - Increases the complexity of existing workflow queries — every query touching `WorkflowReminder` must now account for a fundamentally different record type
     - Workflow-triggered notifications are one source of in-app notifications, but not the only source — team invitations, role changes, and system announcements originate outside the workflow engine

3. **External notification service** (e.g., Novu, OneSignal, Knock)

   - Pros:
     - Purpose-built notification infrastructure with real-time delivery (WebSocket/SSE), rich notification feed UI components, multi-channel orchestration, and analytics
     - Reduces development effort for complex features like real-time push, preference management, and notification digests
   - Cons:
     - Introduces a new external service dependency, increasing operational complexity and cost
     - Data residency and privacy concerns — notification content (booking details, attendee information) would be sent to a third-party service
     - Vendor lock-in with ongoing subscription costs
     - Self-hosted Cal.com deployments would need to set up and manage the external service independently
     - Inconsistent with Cal.com's self-contained architecture philosophy

### Decision

Create a **new standalone module** at `packages/features/notifications/`. In-app notifications have fundamentally different lifecycle requirements compared to workflow reminders:

- **Persistence**: Notifications must be stored indefinitely (or until explicitly deleted) for activity feed viewing, while workflow reminders are ephemeral and cleaned up after delivery.
- **State tracking**: Notifications require read/unread state, while workflow reminders have scheduling/delivery status.
- **Categorization**: Notifications need category-based filtering (bookings, team events, system), while workflow reminders are uniformly time-triggered.
- **Querying**: Notification feeds require paginated, filtered, sorted queries, while workflow reminders are queried by scheduled time for cron-based processing.

A dedicated module with its own `Notification` Prisma model provides the cleanest architecture, follows the established Cal.com feature module pattern, and avoids compromising the existing workflow engine's data model.

### Consequences

- A new `Notification` model is added to `packages/prisma/schema.prisma` as an additive change — no modifications to existing tables. The model includes fields for: user reference, category (enum), title, body, action URL, read/unread state, sender/actor reference, created timestamp, and optional expiry
- The database migration follows zero-downtime patterns: `CREATE TABLE` only, no `ALTER TABLE` on existing tables, no foreign key constraints that would lock existing tables during migration
- A new module is created at `packages/features/notifications/` with the following structure:
  - `repositories/NotificationRepository.ts` — Prisma data access for notification CRUD and paginated feed queries
  - `services/NotificationService.ts` — Business logic for notification creation, read state management, and feed retrieval
  - `di/tokens.ts` — Symbol-based DI tokens following the existing pattern (e.g., `NOTIFICATION_DI_TOKENS`)
  - `types/` — TypeScript types and interfaces for notification data shapes
- New API endpoints are implemented for notification operations: list notifications (paginated, filterable by category and read state), mark single notification as read, mark all notifications as read, delete notification
- Integration points with existing booking lifecycle are established: booking creation, cancellation, and rescheduling in `packages/features/bookings/` trigger notification creation via the `NotificationService`
- Integration with team membership: team invitation acceptance/rejection and role changes in `packages/features/membership/` and `packages/features/ee/teams/` trigger notification creation
- DI tokens follow the existing pattern — symbol-based tokens registered via `createModule` and `bindModuleToClassOnToken`, consistent with `packages/features/routing-forms/di/tokens.ts` and `packages/features/ee/organizations/di/`
- The activity feed is implemented as a paginated query over the `Notification` table with category filtering, read/unread filtering, and reverse-chronological sorting
- The workflow engine in `packages/features/ee/workflows/` receives a minimal, additive extension: `IN_APP_NOTIFICATION` is appended to the `WorkflowActions` Prisma enum and a new handler branch is added in `scheduleBookingReminders.ts` that delegates to the `NotificationService` for record creation. All 8 existing `WorkflowActions` handling paths remain unchanged. This approach allows users to configure in-app notification delivery as a workflow action alongside email and SMS, while keeping the notification lifecycle (read/unread state, feed queries, pagination) entirely within the standalone `NotificationService` module
- Database migration follows zero-downtime patterns: new table creation only, no modifications to existing tables, no destructive schema changes
