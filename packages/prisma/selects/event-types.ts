import type { Prisma } from "../client";

/**
 * Minimal event-type select for summary/listing contexts.
 *
 * Projects lightweight scalars used by list views, cards, and search results.
 * Includes `seatsPerTimeSlot` for seat-limited event display badges.
 */
export const baseEventTypeSelect = {
  id: true,
  title: true,
  description: true,
  length: true,
  schedulingType: true,
  recurringEvent: true,
  slug: true,
  hidden: true,
  price: true,
  currency: true,
  lockTimeZoneToggleOnBookingPage: true,
  lockedTimeZone: true,
  requiresConfirmation: true,
  requiresBookerEmailVerification: true,
  canSendCalVideoTranscriptionEmails: true,
  /** Used by PrismaSelectedSlotRepository for seat-limited event types. */
  seatsPerTimeSlot: true,
} satisfies Prisma.EventTypeSelect;

/**
 * Extended event-type select for booking flow contexts.
 *
 * Projects all fields required during the booking creation pipeline including
 * bookable-window restrictions (`periodType`, `periodDays`, `periodStartDate`,
 * `periodEndDate`, `periodCountCalendarDays`), workflow triggers, user/team
 * relations, and seat configuration.
 */
export const bookEventTypeSelect = {
  id: true,
  title: true,
  slug: true,
  description: true,
  length: true,
  locations: true,
  customInputs: true,
  /** Bookable-window restriction type (UNLIMITED | ROLLING | RANGE). */
  periodType: true,
  /** Rolling window length in days when periodType is ROLLING. */
  periodDays: true,
  /** Fixed range start when periodType is RANGE. */
  periodStartDate: true,
  /** Fixed range end when periodType is RANGE. */
  periodEndDate: true,
  recurringEvent: true,
  lockTimeZoneToggleOnBookingPage: true,
  lockedTimeZone: true,
  requiresConfirmation: true,
  canSendCalVideoTranscriptionEmails: true,
  requiresBookerEmailVerification: true,
  metadata: true,
  /** When true, periodDays counts calendar days instead of business days. */
  periodCountCalendarDays: true,
  price: true,
  currency: true,
  disableGuests: true,
  userId: true,
  seatsPerTimeSlot: true,
  bookingFields: true,
  workflows: {
    include: {
      workflow: {
        include: {
          steps: true,
        },
      },
    },
  },
  users: {
    select: {
      id: true,
      username: true,
      name: true,
      email: true,
      bio: true,
      avatarUrl: true,
      theme: true,
    },
  },
  successRedirectUrl: true,
  team: {
    select: {
      logoUrl: true,
      parent: {
        select: {
          logoUrl: true,
          name: true,
        },
      },
    },
  },
} satisfies Prisma.EventTypeSelect;

/**
 * Availability-focused event-type select for the scheduling engine.
 *
 * This is the primary projection consumed by the availability pipeline:
 * - `UserAvailabilityService` (getUserAvailability.ts) for orchestrated availability queries
 * - `detectEventTypeScheduleForUser` for schedule priority resolution
 * - `buildSlotsWithDateRanges` (slots.ts) for slot generation
 * - `BusyTimesService` (getBusyTimes.ts) for buffer time enforcement
 * - `getAggregatedAvailability` for multi-host intersection
 *
 * NOTE: The export name retains the known typo ("availiblity") for backward
 * compatibility with all downstream consumers including the Platform SDK.
 */
export const availiblityPageEventTypeSelect = {
  id: true,
  title: true,
  /** Direct EventType → Availability[] relation (date-specific overrides at the event-type level). */
  availability: true,
  description: true,
  /** Event duration in minutes — used by slots.ts to verify each candidate slot fits before range end. */
  length: true,
  /** Offset in minutes added to slot start times (EventType.offsetStart Int @default(0)). */
  offsetStart: true,
  price: true,
  currency: true,
  /** Bookable-window restriction fields — consumed by the slot generation pipeline to clamp the date range. */
  periodType: true,
  periodStartDate: true,
  periodEndDate: true,
  periodDays: true,
  periodCountCalendarDays: true,
  locations: true,
  /** Consumed by getAggregatedAvailability for fixed-host vs round-robin group semantics. */
  schedulingType: true,
  recurringEvent: true,
  requiresConfirmation: true,
  /**
   * Nested Schedule relation — provides the schedule-level working hours and timezone.
   * - `availability`: The Schedule's Availability[] rows (days[], startTime, endTime, date?)
   *   consumed by processWorkingHours in date-ranges.ts for DST-normalized interval generation.
   * - `timeZone`: The schedule-level timezone (String?) used by detectEventTypeScheduleForUser
   *   for timezone priority resolution (event-type schedule → host → user → fallback).
   */
  schedule: {
    select: {
      availability: true,
      timeZone: true,
    },
  },
  hidden: true,
  /** Required for permission enforcement in ScheduleRepository and schedule detection. */
  userId: true,
  slug: true,
  /**
   * Minimum notice period in minutes (EventType.minimumBookingNotice Int @default(120)).
   * Consumed by buildSlotsWithDateRanges in slots.ts — any candidate slot whose start time
   * falls within this window relative to the current UTC moment is filtered out.
   */
  minimumBookingNotice: true,
  /**
   * Minutes to block before the event start (EventType.beforeEventBuffer Int @default(0)).
   * Consumed by BusyTimesService._getBusyTimes to extend booking start boundaries so
   * adjacent meetings never overlap the configured gap.
   */
  beforeEventBuffer: true,
  /**
   * Minutes to block after the event end (EventType.afterEventBuffer Int @default(0)).
   * Consumed by BusyTimesService._getBusyTimes to extend booking end boundaries.
   */
  afterEventBuffer: true,
  /**
   * Event-type level timezone (String?), distinct from schedule.timeZone.
   * Used in timezone priority resolution within detectEventTypeScheduleForUser.
   */
  timeZone: true,
  metadata: true,
  /**
   * Custom slot interval in minutes (EventType.slotInterval Int?).
   * When set, overrides the NEXT_PUBLIC_AVAILABILITY_SCHEDULE_INTERVAL environment
   * variable in slots.ts for this specific event type.
   */
  slotInterval: true,
  /**
   * Maximum attendees per time slot (EventType.seatsPerTimeSlot Int?).
   * Consumed by PrismaSelectedSlotRepository for seat-limited reservation tracking
   * and by the slot generation pipeline for seat count reporting.
   */
  seatsPerTimeSlot: true,
  users: {
    select: {
      id: true,
      avatarUrl: true,
      name: true,
      username: true,
      hideBranding: true,
      timeZone: true,
    },
  },
  team: {
    select: {
      logoUrl: true,
      parent: {
        select: {
          logoUrl: true,
          name: true,
        },
      },
    },
  },
} satisfies Prisma.EventTypeSelect;
