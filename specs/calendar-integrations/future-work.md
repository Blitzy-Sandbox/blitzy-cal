# Calendar Integrations Future Work

Ideas and enhancements deferred from the Sprint 3: Calendar Integrations initial implementation.

## Enhancements

- CalDAV-based cancellation sync for Apple Calendar (CalDAV protocol lacks push notifications; would require polling-based change detection with configurable intervals)
- Lark Calendar push notification integration for the Lark/Feishu adapter to enable real-time event change detection
- Feishu Calendar push notification integration to mirror Lark adapter capabilities for Feishu-specific deployments
- Exchange adapter (2013/2016) push notification support via EWS streaming subscriptions for on-premises Exchange Server environments
- Unified notification handler abstraction across all adapters (Google push notifications, Microsoft Graph change notifications, CalDAV polling, EWS streaming subscriptions) to reduce per-adapter handler duplication
- Buffer event customization — allow users to configure buffer event title prefix, color, and busy/free status beyond the default "Buffer: [Event Title]" pattern
- Per-event-type conflict detection status filter configuration (currently user-level only) to allow different event types to treat Tentative/Away/Working Elsewhere statuses differently
- Real-time calendar sync status dashboard showing subscription health, last sync timestamp, and error counts per connected calendar

## Technical Debt

- Consolidate Google Calendar FreeBusy API chunking logic that currently has duplication between `CalendarService.getAvailability` and the subscription adapter
- Standardize error handling across all three primary calendar adapters (Google, Outlook, Apple) — currently each has bespoke retry logic with different backoff strategies and error classification
- Extract shared CalDAV protocol logic from Apple Calendar adapter into a reusable CalDAV client library that can be leveraged by other CalDAV-compatible calendar providers

## Nice to Have

- Visual calendar overlay in Cal.com UI showing buffer time events alongside booking events for at-a-glance schedule visualization
- Calendar connection health monitoring with proactive alerting when OAuth tokens expire or API quotas are approached
- Bulk calendar re-sync tool for administrators to force refresh all calendar subscriptions across the platform
- Export calendar integration audit log for compliance reporting including sync events, credential rotations, and error history
