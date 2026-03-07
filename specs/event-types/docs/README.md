# Event Types (Sprint 2)

## Overview

Cal.com's event type system supports six scheduling paradigms: one-on-one (default), group (seats-based), round-robin, collective, managed, and dynamic. Sprint 2 of the Calendly gap closure roadmap verifies and hardens behavioral parity between Cal.com's event type system and Calendly's event type capabilities across six epics: ET-001 (1:1 Events), ET-002 (Group Events), ET-003 (Round-Robin), ET-004 (Collective), ET-005 (Booking Windows), and ET-006 (Custom Fields). Cal.com exceeds Calendly with 6 paradigms versus Calendly's 4, full API management, managed types (admin-pushed templates for teams), and dynamic links (ad-hoc meeting URLs), all of which are Cal.com-exclusive advantages.

## How to Use

### Step 1: Create an Event Type

Navigate to the Event Types page and click "New Event Type". Select the scheduling paradigm: one-on-one (default for personal events), group (enable seats for multi-attendee), round-robin or collective (available for team event types), managed (admin-pushed templates for teams), or dynamic (ad-hoc meeting links). The paradigm determines how hosts and invitees are matched and how availability is calculated.

<!-- Screenshot placeholder: Save event type creation form screenshot as ./screenshots/step-1.png -->
![Step 1 — Create Event Type](./screenshots/step-1.png)

### Step 2: Configure Event Type Settings

Configure the event type settings based on the selected paradigm:

- **1:1 Events:** Set duration, location, and booking fields. The default scheduling paradigm (`schedulingType: null`) pairs a single host with a single invitee.
- **Group Events:** Set `seatsPerTimeSlot` to define the maximum number of attendees per slot. Toggle `seatsShowAttendees` and `seatsShowAvailabilityCount` to control visibility of attendee details and remaining seat counts.
- **Round-Robin:** Assign team hosts with optional weights (`isRRWeightsEnabled`) and priorities. Configure segment-based filtering (`rrSegmentQueryValue`) to route bookings to specific host subsets.
- **Collective:** Assign team hosts — all must be simultaneously available. Only mutually available time slots are presented to invitees.
- **Booking Windows:** Configure `periodType` (UNLIMITED, ROLLING, ROLLING_WINDOW, RANGE), set `minimumBookingNotice`, and define date restrictions via `periodStartDate`/`periodEndDate` or `periodDays`.
- **Custom Fields:** Add booking fields matching Calendly's question types: text, radio, checkbox, phone, and dropdown.

<!-- Screenshot placeholder: Save event type settings configuration screenshot as ./screenshots/step-2.png -->
![Step 2 — Configure Settings](./screenshots/step-2.png)

### Step 3: Verify Booking Page

Preview the booking page to verify correct slot generation, host assignment, and custom field rendering for the selected paradigm. For group events, verify the remaining seat count display. For round-robin, verify host distribution across bookings. For collective, verify that only mutually available slots are presented.

<!-- Screenshot placeholder: Save booking page verification screenshot as ./screenshots/step-3.png -->
![Step 3 — Verify Booking Page](./screenshots/step-3.png)

### Step 4: Validate Webhook Compatibility

Verify that booking lifecycle events (`BOOKING_CREATED`, `BOOKING_RESCHEDULED`, `BOOKING_CANCELLED`) fire correctly for the configured event type paradigm and that existing `v2021-10-20` webhook payloads remain unchanged. All six scheduling paradigms must produce correct webhook payloads without altering the existing payload structure.

<!-- Screenshot placeholder: Save webhook validation screenshot as ./screenshots/step-4.png -->
![Step 4 — Webhook Validation](./screenshots/step-4.png)

## Configuration Options

| Option | Description | Default |
|--------|-------------|---------|
| `schedulingType` | Scheduling paradigm: `null` (1:1), `ROUND_ROBIN`, `COLLECTIVE`, `MANAGED` | `null` (one-on-one) |
| `seatsPerTimeSlot` | Number of attendees per slot for group events | `null` (disabled) |
| `seatsShowAttendees` | Whether attendee details are visible in group events | `false` |
| `seatsShowAvailabilityCount` | Whether remaining seat count is shown | `true` |
| `periodType` | Booking window type: `UNLIMITED`, `ROLLING`, `ROLLING_WINDOW`, `RANGE` | `UNLIMITED` |
| `periodDays` | Number of days for rolling booking window | `null` |
| `periodStartDate` / `periodEndDate` | Date range for RANGE period type | `null` |
| `periodCountCalendarDays` | Whether rolling window counts calendar days (vs. business days) | `true` |
| `minimumBookingNotice` | Minimum minutes of advance notice for booking | `120` (2 hours) |
| `isRRWeightsEnabled` | Enable weight-based round-robin distribution | `false` |
| `rrSegmentQueryValue` | Segment filter for round-robin host selection | `null` |
| `assignAllTeamMembers` | Auto-assign all team members as hosts | `false` |
| `bookingFields` | JSON configuration for custom booking fields (text, radio, checkbox, phone, dropdown) | System defaults (name, email) |
| `beforeEventBuffer` | Buffer time in minutes before event | `0` |
| `afterEventBuffer` | Buffer time in minutes after event | `0` |

## Common Use Cases

### 1:1 Meetings

A host creates a one-on-one event type for individual consultations. The default scheduling paradigm (`schedulingType: null`) pairs a single host with a single invitee. Configure duration, location, and custom fields to collect relevant information during booking.

### Group Sessions

A host creates a group event type for webinars or classes. Set `seatsPerTimeSlot` to the maximum number of attendees (e.g., 10 for a workshop). Multiple attendees can book the same time slot until the seat limit is reached. The (N+1)th attendee is rejected with an appropriate error.

### Team Round-Robin

A team admin creates a round-robin event type to distribute bookings equitably among team members. When `isRRWeightsEnabled` is false (default), distribution is equitable. When enabled, hosts can have different weights and priorities. Segment-based filtering via `rrSegmentQueryValue` allows routing to specific host subsets.

### Collective Scheduling

A team admin creates a collective event type requiring all assigned hosts to be simultaneously available. Only mutually available time slots are presented to invitees. This ensures all required team members can attend the meeting.

## FAQ

### What scheduling paradigms does Cal.com support?

Cal.com supports six scheduling paradigms: one-on-one (default), group (seats-based), round-robin, collective, managed (admin-pushed templates), and dynamic (ad-hoc links). This exceeds Calendly's four formats (one-on-one, group, round-robin, collective). Managed and dynamic are Cal.com-exclusive advantages.

### How do booking windows work?

Booking windows control when invitees can schedule. Three options are available: (1) Days into future (`ROLLING`/`ROLLING_WINDOW` with `periodDays`) — limits booking to N days ahead, with calendar or business day counting; (2) Date range (`RANGE` with `periodStartDate`/`periodEndDate`) — restricts booking to a specific date window; (3) Indefinitely (`UNLIMITED`) — no time restriction on booking. These align with Calendly's three booking window options.

### What custom field types are supported?

Cal.com supports all Calendly question types through the `bookingFields` configuration: text (free-form input), radio (single selection from options), checkbox (multiple selections), phone (phone number with international format support), and dropdown (single selection from a list). These are configured in the event type settings and rendered on the booking page.

### How does round-robin distribution ensure fairness?

When `isRRWeightsEnabled` is false (default), round-robin distributes bookings equitably across all assigned hosts, matching Calendly's behavior. When weights are enabled, distribution respects configured host weights and priorities. Cal.com's advanced features (weights, priorities, segment-based filtering) exceed Calendly's simpler equitable distribution model.

---

> **Screenshots:** Save screenshots to `specs/event-types/docs/screenshots/` following the naming convention: `step-1.png`, `step-2.png`, `step-3.png`, `step-4.png`. Screenshots should capture key UI states for each scheduling paradigm.
