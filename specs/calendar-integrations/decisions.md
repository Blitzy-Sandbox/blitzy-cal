# Calendar Integrations Decisions

Architecture Decision Records (ADRs) for Sprint 3: Calendar Integrations (F-003) of the Calendly gap closure initiative.

Each ADR documents the context, options evaluated, final decision, and consequences for a key architectural trade-off encountered during Sprint 3 implementation.

---

## ADR-001: Push vs. Polling for Calendar-Driven Cancellation Sync

### Context

The CI-001 gap closure requires detecting event deletions and declines in external calendars (Google Calendar, Outlook/Office 365) and propagating those cancellations back to Cal.com bookings. Two fundamentally different approaches exist for detecting changes in external calendar systems: push-based notifications where the provider informs Cal.com of changes, and pull-based polling where Cal.com periodically queries the provider for updates.

Google Calendar supports push notifications via the `channels` resource in the Google Calendar API v3, allowing Cal.com to receive HTTP POST callbacks when calendar events change. Microsoft Graph API v1.0 supports change notifications via subscription objects that deliver webhook payloads when subscribed resources (calendar events) are created, updated, or deleted.

The existing codebase already contains adapter scaffolding in `packages/features/calendar-subscription/adapters/` with `GoogleCalendarSubscription.adapter.ts` and `Office365CalendarSubscription.adapter.ts`, providing a foundation for either approach.

### Options Considered

1. **Push Notifications** — Google Calendar push notification channels + Microsoft Graph change notification subscriptions

   - Pros:
     - Near-real-time detection of event deletions and declines (typically under 1 minute latency)
     - Lower API quota consumption since Cal.com only processes changes when they occur rather than polling on a fixed interval
     - Aligns with both Google and Microsoft's recommended integration patterns for change detection
     - Existing adapter scaffolding in `packages/features/calendar-subscription/adapters/` can be extended rather than building from scratch
     - Scales linearly with change volume rather than with connected calendar count
   - Cons:
     - Requires publicly accessible webhook endpoint URLs (`GOOGLE_CALENDAR_PUSH_NOTIFICATION_URL`, `OUTLOOK_GRAPH_NOTIFICATION_URL`)
     - Subscription lifecycle management adds complexity: Google channels have a configurable TTL and must be renewed before expiry; Outlook subscriptions have a maximum lifetime of 3 days and require proactive renewal
     - Webhook delivery is not guaranteed — missed notifications require a fallback reconciliation mechanism
     - More complex error handling: must handle duplicate notifications, out-of-order delivery, and verification challenges (Google sends `X-Goog-Resource-State` headers; Microsoft sends validation tokens)

2. **Periodic Polling** — Cron-based polling of Google `events.list` (with `updatedMin` filter) and Outlook `calendarView` endpoints at a configurable interval

   - Pros:
     - Simpler implementation with no webhook infrastructure requirements
     - Works in environments behind NAT, firewalls, or without public-facing URLs (e.g., local development, self-hosted instances)
     - No subscription lifecycle management — just a cron schedule
     - Guaranteed to eventually detect all changes (no missed webhook risk)
   - Cons:
     - Higher API quota consumption: every connected calendar must be polled on every interval regardless of whether changes occurred
     - Delayed detection: cancellations are only detected at the next poll interval, which could be minutes to hours depending on configuration
     - Scales poorly with the number of connected calendars — a Cal.com instance with 10,000 users each having 2 connected calendars would require 20,000 API calls per polling cycle
     - Increased load on external provider APIs, risking HTTP 429 rate-limiting responses

### Decision

Use **push notifications** for both Google Calendar (push notification channels via the `channels` resource) and Microsoft Outlook (Graph change notification subscriptions). The existing `packages/features/calendar-subscription/` infrastructure already provides adapter interfaces for both providers, making push the natural extension path.

Polling is not viable at the scale of Cal.com's user base. A Cal.com instance with thousands of connected calendars would exhaust API quotas rapidly under a polling model, while push notifications scale with actual change volume.

A lightweight polling-based reconciliation job will run on a less frequent schedule (e.g., every 6 hours) as a fallback safety net to catch any missed push notifications, but push is the primary detection mechanism.

### Consequences

- Two new environment variables are required: `GOOGLE_CALENDAR_PUSH_NOTIFICATION_URL` and `OUTLOOK_GRAPH_NOTIFICATION_URL`, pointing to publicly accessible webhook endpoints on the Cal.com instance
- Subscription renewal logic must be implemented with exponential backoff retry for both providers, managed by the existing `CalendarsTriggerTasker` infrastructure in `packages/features/calendars/lib/tasker/`
- New notification handler classes are required: `GoogleCancellationHandler` and `OutlookCancellationHandler` in `packages/features/calendars/lib/cancellation-sync/handlers/`
- Apple Calendar (CalDAV) does not support server-initiated push notifications; Apple Calendar cancellation sync is deferred to `future-work.md` and would require a polling approach if implemented
- Self-hosted Cal.com instances without public URLs will need to configure a reverse proxy or tunnel for webhook receipt, or the cancellation sync feature will be unavailable for those deployments
- The `calendar-cancellation-sync` feature flag (ADR-004) gates the entire push notification subscription lifecycle, so no subscriptions are created until the flag is explicitly enabled

---

## ADR-002: Buffer Event Naming Convention

### Context

The CI-002 gap closure creates separate calendar events in external calendars (Google Calendar, Outlook, Apple Calendar) for pre-event and post-event buffer periods alongside the main booking event. These buffer events provide visual clarity in the user's calendar, showing when they need to prepare before or decompress after a meeting.

The event title naming convention directly affects user experience: buffer events must be immediately distinguishable from actual bookings while maintaining a clear relationship to the parent event. The convention must work reliably across all three target calendar providers, each with different rendering characteristics (title truncation thresholds, emoji support, search capabilities).

The `BufferTimeEventService` in `packages/features/calendars/lib/buffer-sync/` will use this convention when constructing `CalendarEvent` objects via `CalendarEventBuilder.buildBufferEvent()`.

### Options Considered

1. **Prefix pattern** — `"Buffer: [Event Title]"` (e.g., "Buffer: Team Standup")

   - Pros:
     - Immediately identifiable as a buffer event when scanning a calendar view
     - Consistent and predictable pattern across all calendar providers
     - Fully searchable: users can search for `"Buffer:"` to find all buffer events in any calendar client
     - Clear parent-child relationship — the original event title is preserved after the prefix
     - Works reliably in Google Calendar, Outlook, and Apple Calendar without rendering issues
   - Cons:
     - Increases title length by 8 characters, which may cause truncation in calendar UIs with limited horizontal space (e.g., Outlook's month view)
     - The prefix takes up prime visual real estate in the title, pushing the actual event name to the right

2. **Emoji prefix** — `"⏸️ [Event Title]"` (e.g., "⏸️ Team Standup")

   - Pros:
     - Visually distinctive with minimal character overhead (2 characters including space)
     - Shorter than text-based prefix, reducing truncation risk
     - Eye-catching in calendar views that render emoji
   - Cons:
     - Emoji rendering is inconsistent across calendar clients: some corporate Outlook environments render emoji as `?` or empty boxes
     - Screen readers may announce the emoji inconsistently (e.g., "double vertical bar" vs. "pause button"), creating accessibility concerns
     - Non-professional appearance in corporate calendar environments
     - Not reliably searchable — searching for an emoji character varies across calendar platforms

3. **Suffix pattern** — `"[Event Title] (Buffer)"` (e.g., "Team Standup (Buffer)")

   - Pros:
     - The original event title is immediately readable without any prefix obstruction
     - Familiar convention from other scheduling tools that use parenthetical metadata
   - Cons:
     - Less scannable when quickly reviewing a busy calendar — the distinguishing text is at the end
     - In truncated calendar views (week view, month view), the `(Buffer)` suffix is the first part to be hidden
     - Less effective for search — users must remember to include parentheses in the search query

### Decision

Use the **prefix pattern** `"Buffer: [Event Title]"`. This is the most reliable approach across all three target calendar clients (Google Calendar, Outlook, Apple Calendar). The prefix ensures buffer events are immediately identifiable even in truncated views, is fully searchable across all platforms, and clearly communicates the event's purpose without ambiguity.

Buffer events created by `BufferTimeEventService` will additionally be marked with `showAs: "busy"` status to ensure they block availability in conflict detection, and will include a structured `extendedProperties` (Google) or `singleValueExtendedProperties` (Outlook) entry linking back to the parent booking event's UID for lifecycle management (e.g., deleting buffer events when the parent booking is cancelled).

### Consequences

- Buffer events will appear as `"Buffer: [Event Title]"` in all external calendar views, providing a consistent and recognizable pattern for Cal.com users
- Users can search for `"Buffer:"` in any calendar client to locate all buffer-related events
- Title length increases by 8 characters per buffer event; this is within acceptable limits for all three target calendar providers (Google Calendar supports up to 1024 characters, Outlook up to 255, Apple Calendar up to 1024)
- The `CalendarEventBuilder.buildBufferEvent()` method will prepend `"Buffer: "` to the parent event's title and set `showAs: "busy"`
- Buffer events will include extended properties linking to the parent booking UID, enabling the `BufferTimeEventService` to clean up buffer events when the parent booking is cancelled or rescheduled

---

## ADR-003: Status Filter Storage Location

### Context

The CI-004 conflict detection alignment requires Cal.com to support configurable event status filtering for conflict detection, matching Calendly's "What's considered unavailable?" dropdown behavior. Calendly allows users to configure which calendar event statuses (Busy, Tentative, Away, Working Elsewhere, Out of Office) are treated as conflicts that block availability slots.

Currently, Cal.com's `getBusyTimes` service in `packages/features/busyTimes/services/getBusyTimes.ts` aggregates busy times from all connected calendars, but the status interpretation is largely hardcoded per adapter: Google's FreeBusy API returns aggregate busy windows without status granularity, while Outlook's `calendarView` endpoint filters by `showAs` with a fixed set of values. To achieve parity, a user-configurable preference must be stored and threaded through the availability pipeline.

The question is where in the data model this preference should live to balance simplicity, extensibility, and alignment with Calendly's user-level configuration.

### Options Considered

1. **User model** — Store as a nullable JSON array field on the `User` model (e.g., `unavailableStatuses JSON`)

   - Pros:
     - Simple single-location storage with one preference per user
     - Easy to query during availability calculations — the user record is already loaded in the `getBusyTimes` pipeline
     - Matches Calendly's user-level configuration model where the setting applies to all of a user's calendars and event types
     - Minimal migration impact: one nullable JSON column addition following zero-downtime Pattern 2
   - Cons:
     - Does not support per-calendar or per-event-type customization — all event types for a user share the same status filter
     - If a user wants "tentative" to block on their work calendar but not their personal calendar, this model cannot accommodate that

2. **EventType model** — Store on the `EventType` model (e.g., `unavailableStatuses JSON` on EventType)

   - Pros:
     - Most granular control — each event type can have its own conflict detection rules
     - Aligns with Cal.com's existing per-event-type calendar selection advantage (destination calendar per event type)
     - Power users can configure different conflict rules for different meeting types
   - Cons:
     - More complex implementation: requires fallback logic to a user-level default when the event-type-level preference is null
     - Calendly does not offer per-event-type status filtering, so this exceeds parity scope and adds complexity without immediate user demand
     - Every `EventType` query in the availability pipeline would need to include this field

3. **SelectedCalendar model** — Store per selected calendar entry

   - Pros:
     - Per-calendar granularity: users could treat tentative events differently on personal vs. work calendars
     - Most flexible model for complex multi-calendar setups
   - Cons:
     - Significantly more complex UX — users would need to configure status filters per calendar, which is confusing
     - No precedent in Calendly's model or Cal.com's existing UI for per-calendar conflict configuration
     - The `getBusyTimes` aggregation pipeline would need per-calendar filter logic, complicating the already-complex busy time calculation

### Decision

Store the status filter preference on the **User model** as a nullable JSON array column (`unavailableStatuses`). When the value is `null`, the system defaults to Calendly's default behavior where Busy, Tentative, Away, and Working Elsewhere statuses are all treated as "unavailable" and block availability.

This is the simplest approach that achieves full Calendly parity. Calendly's own "What's considered unavailable?" setting is a user-level preference, not per-event-type or per-calendar, so matching that granularity is the correct parity target. Per-event-type override capability is documented in `future-work.md` as a potential Cal.com advantage to pursue in a later sprint.

### Consequences

- Requires adding a nullable JSON column `unavailableStatuses` to the `User` model via a zero-downtime migration using Pattern 2 (nullable column, no default required)
- The `getBusyTimes` service in `packages/features/busyTimes/services/getBusyTimes.ts` will read the user's `unavailableStatuses` preference and pass it as a `statusFilter` parameter to each adapter's `getAvailability` method
- The `GetAvailabilityParams` interface in `packages/types/Calendar.d.ts` will be extended with an optional `statusFilter?: string[]` property
- The Outlook adapter's `getAvailability` method will map `statusFilter` values to the `showAs` property filter when querying `calendarView` via Microsoft Graph API
- For the Google adapter, status filtering has limited applicability since the FreeBusy API returns aggregate busy windows without per-event status; fine-grained status filtering for Google requires switching to `events.list` with per-event status inspection, which is documented as a future optimization in `future-work.md`
- Default behavior when `unavailableStatuses` is `null` matches Calendly's defaults: `["busy", "tentative", "away", "workingElsewhere", "oof"]`
- No UI changes are required in Sprint 3 for this storage decision; the preference will initially be managed via API v2 endpoints, with a Settings UI toggle deferred to a future sprint

---

## ADR-004: Feature Flag Gating Strategy

### Context

The two gap closure features introduced in Sprint 3 — calendar-driven cancellation sync (CI-001 gap) and buffer time calendar visualization (CI-002 gap) — represent new behaviors that could affect existing users' calendars if deployed without safeguards. Calendar-driven cancellation sync automatically cancels Cal.com bookings when external calendar events are deleted, which is a destructive operation. Buffer time visualization creates additional events in users' external calendars, which modifies calendar state.

Both features must be safely deployable with the ability to enable and disable them independently without code deployment. Cal.com's existing codebase includes a `Feature` model in `packages/prisma/schema.prisma` that provides instance-level feature flag support with `slug`, `enabled`, `description`, and timestamp fields.

### Options Considered

1. **Database Feature model flags** — Use Cal.com's existing `Feature` table with `slug` and `enabled` columns

   - Pros:
     - Infrastructure already exists: the `Feature` model is defined in `packages/prisma/schema.prisma` and is queryable via Prisma client
     - Toggleable at runtime without code deployment — an admin can flip the `enabled` flag via direct database update or an admin API endpoint
     - Per-instance control: different Cal.com deployments (cloud, self-hosted) can enable features independently based on their readiness
     - Audit trail via `createdAt` and `updatedAt` timestamps on the Feature model
     - Follows Pattern 5 from the zero-downtime migration strategy document (`docs/migration/zero-downtime-strategy.mdx`)
     - Migration insertion uses `ON CONFLICT ("slug") DO NOTHING` for idempotent re-deployment safety
   - Cons:
     - Instance-wide granularity only — no per-user or per-team rollout capability
     - No built-in percentage rollout mechanism (e.g., enable for 10% of users)
     - Feature check requires a database query (can be mitigated by caching at service initialization)

2. **Environment variable flags** — Use environment variables (e.g., `ENABLE_CALENDAR_CANCELLATION_SYNC=true`, `ENABLE_CALENDAR_BUFFER_SYNC=true`)

   - Pros:
     - Simplest implementation — just check `process.env` at runtime
     - No schema changes required
     - Familiar pattern for Node.js application configuration
   - Cons:
     - Requires application redeployment to toggle a flag, which is slow and risky for a feature that may need to be disabled urgently
     - No runtime flexibility — cannot respond to issues in production without a deploy cycle
     - No audit trail or history of flag changes
     - Environment variables are not exposed via admin UI, making it harder for self-hosted operators to manage
     - Does not align with the existing `Feature` model pattern already established in the codebase

### Decision

Use the **database Feature model** flags. Two new rows will be inserted via the Sprint 3 database migration:

- `calendar-cancellation-sync` with `enabled: false` — gates all push notification subscription creation and cancellation propagation logic in `CalendarCancellationSyncService`
- `calendar-buffer-sync` with `enabled: false` — gates buffer event creation in `BufferTimeEventService` and the `syncBuffersToCalendar` toggle visibility

Both rows are inserted using `ON CONFLICT ("slug") DO NOTHING` to ensure idempotent migration execution, following Pattern 5 from the zero-downtime migration strategy.

This decision aligns with Cal.com's existing feature flag infrastructure and provides runtime toggleability without code deployment — critical for safely rolling out features that modify external calendar state.

### Consequences

- Two new `Feature` rows are added via `packages/prisma/migrations/[timestamp]_calendar_integration_gap_closure/migration.sql`, both disabled by default in all environments (development, staging, production)
- The `CalendarCancellationSyncService` checks the `calendar-cancellation-sync` flag at service initialization and short-circuits all subscription and notification handling when disabled
- The `BufferTimeEventService` checks the `calendar-buffer-sync` flag before creating, updating, or deleting buffer events in external calendars
- Features can be enabled per-instance after Gate 3 validation passes, by updating the `Feature` table: `UPDATE "Feature" SET "enabled" = true WHERE "slug" = 'calendar-cancellation-sync'`
- The migration is idempotent: re-running it on an instance that already has these feature flag rows will not error or duplicate records
- Feature flag checks are performed at service initialization (cached in memory) rather than per-request to avoid per-request database overhead
- Per-user or percentage-based rollout is not supported by this approach; if needed in the future, a more sophisticated feature flag system (e.g., LaunchDarkly integration or a custom `UserFeature` join table) would be required, but this is out of scope for Sprint 3
