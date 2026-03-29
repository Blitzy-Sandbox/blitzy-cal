# Notifications & Workflows Future Work

Ideas and enhancements deferred from the Sprint 8: Notifications & Workflows initial implementation.

## Enhancements

- NF-005: SMS reminder configuration parity — not included in the Sprint 8 scope (NF-001 through NF-004 only). Would align the SMS reminder timing configuration UI with Calendly's reminder setup, offering preset intervals (15 min, 30 min, 1 hr, 24 hr) and custom timing options that mirror the Calendly attendee reminder experience
- Push notification delivery channel — extend the multi-channel notification system beyond email, SMS, and WhatsApp to include mobile push notifications via Firebase Cloud Messaging or Apple Push Notification Service, enabling real-time booking alerts on native mobile devices
- Notification preference center — a Calendly-style notification preferences page allowing users to configure which notification types they receive and through which channels (email, SMS, in-app), replacing the current per-workflow opt-in model with a centralized control surface
- Rich HTML email template builder — a visual email template editor allowing admins to customize confirmation, reminder, and cancellation email layouts beyond the current React-based template system in `packages/emails/templates/`, enabling drag-and-drop block editing with brand color and logo injection
- In-app notification real-time delivery — WebSocket-based real-time push for in-app notifications rather than polling-based activity feed updates, reducing notification latency from seconds to milliseconds for the NF-004 activity feed implementation

## Technical Debt

- Consolidate the 15+ email dispatch functions in `packages/emails/email-manager.ts` into a more maintainable pattern — currently each booking lifecycle event (scheduled, cancelled, rescheduled, etc.) has its own dedicated function with similar guard/dispatch logic that could be unified through a strategy or registry-based dispatcher
- Standardize SMS template rendering across `packages/sms/attendee/` subclasses — currently each SMS template class (EventSuccessfullyScheduledSMS, EventSuccessfullyReScheduledSMS, etc.) implements its own `getMessage()` pattern with minor inconsistencies in date formatting, timezone handling, and fallback text
- Extract shared workflow reminder scheduling logic from the three cron handlers (`scheduleEmailReminders.ts`, `scheduleSMSReminders.ts`, `scheduleWhatsappReminders.ts`) in `packages/features/ee/workflows/api/` into a common base scheduler to reduce duplication of reminder window calculation, batch query construction, and retry logic

## Nice to Have

- Email open/click tracking analytics for notification performance monitoring, enabling admins to see which email templates have the highest engagement rates
- A/B testing framework for email template variations to data-drive improvements in booking confirmation and reminder email effectiveness
- Digest notification mode — batch multiple booking notifications into a single daily summary email for high-volume users who receive dozens of booking events per day
- Workflow automation marketplace where users can share and import workflow templates, enabling community-driven notification automation recipes
- International SMS sender ID management for country-specific alphanumeric sender ID requirements beyond the current blocklist, supporting regulatory compliance in markets that mandate registered sender IDs
