# Calendar Integrations

## Overview

Sprint 3: Calendar Integrations (F-003) ensures behavioral parity between Cal.com's calendar integration subsystem and Calendly's native calendar connections across Google Calendar, Outlook/Office 365, and Apple Calendar/iCloud. This feature encompasses five core epics — Google Calendar sync parity (CI-001), Outlook sync parity (CI-002), Apple Calendar sync parity (CI-003), conflict detection alignment (CI-004), and bi-directional sync verification (CI-005) — plus two gap closures: calendar-driven cancellation sync and buffer time visualization in external calendars.

## How to Use

### Step 1: Connect Calendars and Enable Sync Features

Navigate to **Settings → My Account → Calendars** to connect your Google Calendar, Outlook/Office 365, or Apple Calendar accounts. Each connected calendar will be available for bi-directional sync, meaning bookings created in Cal.com will automatically appear in your external calendar and vice versa. Select which connected calendars should be checked for conflicts using the calendar selection checkboxes.

![Step 1 Screenshot](./screenshots/step-1.png)

### Step 2: Configure Buffer-Sync Toggle and Conflict Detection Status Filter

For buffer time visualization, enable the **Sync buffer times to calendar** toggle on your event type settings. This creates separate calendar events for pre-event and post-event buffer periods in your connected calendars, providing visual clarity in your schedule. For conflict detection configuration, select which event statuses (Busy, Tentative, Away, Working Elsewhere, Out of Office) should be considered 'unavailable' when checking for scheduling conflicts — this matches Calendly's 'What's considered unavailable?' behavior.

![Step 2 Screenshot](./screenshots/step-2.png)

## Configuration Options

| Option | Description | Default |
|--------|-------------|---------|
| `syncBuffersToCalendar` | When enabled, creates separate calendar events for pre-event and post-event buffer periods in connected external calendars. Set per event type on the EventType model. | `off` (null, treated as false) |
| `externalCancellationSyncEnabled` | When enabled on a credential, activates calendar-driven cancellation sync subscriptions so that events deleted or declined in the external calendar automatically cancel the corresponding Cal.com booking. | `off` (null, treated as false) |
| `statusFilter` | JSON array of event statuses considered "unavailable" for conflict detection. Configurable values: `Busy`, `Tentative`, `Away`, `WorkingElsewhere`, `OutOfOffice`. Stored on the User model. | All statuses unavailable (`["Busy", "Tentative", "Away", "WorkingElsewhere", "OutOfOffice"]`) |
| `calendar-cancellation-sync` | Feature flag controlling the calendar-driven cancellation sync behavior. Stored in the Feature model. Must be explicitly enabled after validation. | `false` (disabled by default) |
| `calendar-buffer-sync` | Feature flag controlling the buffer time visualization behavior. Stored in the Feature model. Must be explicitly enabled after validation. | `false` (disabled by default) |

## Common Use Cases

### Multi-Provider Conflict Detection

When a user has both Google Calendar and Outlook connected, the conflict detection system aggregates busy times from all connected calendars before determining availability. The configurable status filter ensures consistent behavior across providers — for example, marking 'Tentative' events as unavailable across both Google and Outlook calendars simultaneously. This matches Calendly's 'What's considered unavailable?' dropdown behavior and prevents double-bookings across calendar providers.

### Bi-Directional Cancellation Sync

With the `calendar-cancellation-sync` feature flag enabled and `externalCancellationSyncEnabled` activated on a credential, cancellations flow in both directions. When a Cal.com booking is cancelled, the corresponding external calendar event is automatically deleted. Conversely, when an event is deleted or declined in the external calendar (Google via push notifications, Outlook via Microsoft Graph change notifications), the corresponding Cal.com booking is automatically cancelled and attendees are notified. This ensures calendar state stays consistent without manual intervention.

## FAQ

### How do I enable the new calendar sync features?

The calendar-driven cancellation sync and buffer time visualization features are gated behind feature flags (`calendar-cancellation-sync` and `calendar-buffer-sync`) that are disabled by default. An instance administrator must enable these flags in the Feature table after validation testing passes. Once enabled, individual users can activate buffer sync per event type via the `syncBuffersToCalendar` toggle, and cancellation sync per credential via the `externalCancellationSyncEnabled` setting.

### What do buffer events look like in my external calendar?

Buffer events appear as separate calendar events with the title prefix 'Buffer: ' followed by the original event title (e.g., 'Buffer: Team Standup'). They are marked with 'Busy' status so they block availability in your external calendar. Buffer events are automatically created when a booking is made and deleted when the booking is cancelled, ensuring your calendar accurately reflects your complete schedule including preparation and wind-down time.

### Is the database migration safe for production?

Yes. All schema changes follow zero-downtime migration patterns from Cal.com's migration strategy. New columns (`syncBuffersToCalendar` on EventType, `externalCancellationSyncEnabled` on Credential) are nullable with no default constraint, meaning existing rows are unaffected (Pattern 2). Feature flag rows are inserted with `ON CONFLICT DO NOTHING` for idempotent deployment (Pattern 5). No existing data is modified or deleted — all `Credential`, `SelectedCalendar`, `DestinationCalendar`, and `Booking` records remain intact.
