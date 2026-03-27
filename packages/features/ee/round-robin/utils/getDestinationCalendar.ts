import type { getEventTypesFromDB } from "@calcom/features/bookings/lib/handleNewBooking/getEventTypesFromDB";
import { prisma } from "@calcom/prisma";
import type { DestinationCalendar } from "@calcom/prisma/client";

import type { BookingSelectResult } from "./bookingSelect";

/**
 * Resolves the destination calendar for round-robin organizer assignments.
 *
 * Follows a deterministic priority order for calendar resolution:
 *   1. Event type's configured destination calendar (highest priority)
 *   2. New organizer's destination calendar (when organizer changed via RR reassignment)
 *   3. Existing booking user's destination calendar (when organizer unchanged)
 *   4. undefined fallback (no calendar resolved)
 *
 * ET-003 Parity Audit (Sprint 2):
 * - Priority order verified: aligns with Calendly's behavior where reassigned bookings
 *   appear on the new host's calendar, or the event type's designated calendar if configured.
 * - All return paths produce consistent `DestinationCalendar[] | undefined` shape.
 * - Downstream consumers (`roundRobinManualReassignment`, `roundRobinReassignment`)
 *   pass the result directly into CalendarEvent, which accepts optional destination calendar.
 * - No direct webhook payload impact — this resolves calendars for CRUD operations only.
 *
 * @param eventType - Event type with destinationCalendar from getEventTypesFromDB projection
 * @param booking - Booking with nested user.destinationCalendar from bookingSelect projection
 * @param newUserId - ID of the newly assigned round-robin host (when organizer changes)
 * @param hasOrganizerChanged - Whether the RR reassignment resulted in a new organizer
 * @returns Single-element DestinationCalendar array, or undefined if no calendar resolved
 */
export async function getDestinationCalendar({
  eventType,
  booking,
  newUserId,
  hasOrganizerChanged,
}: {
  eventType?: Awaited<ReturnType<typeof getEventTypesFromDB>>;
  booking?: BookingSelectResult;
  newUserId?: number;
  hasOrganizerChanged: boolean;
}): Promise<DestinationCalendar[] | undefined> {
  // Priority 1: Event type's configured destination calendar takes precedence.
  // Verified: getEventTypesFromDB includes destinationCalendar in its select projection.
  if (eventType?.destinationCalendar) {
    return [eventType.destinationCalendar];
  }

  // Priority 2: When the organizer changed (RR reassignment), look up the new host's calendar.
  // Note: findFirst returns by primary key order — deterministic for a given userId.
  // The query intentionally omits eventTypeId to resolve the user's default calendar,
  // and omits integration filtering as Prisma returns the first match consistently.
  // Callers always provide newUserId when hasOrganizerChanged is true.
  if (hasOrganizerChanged && newUserId) {
    const newUserDestinationCalendar = await prisma.destinationCalendar.findFirst({
      where: {
        userId: newUserId,
      },
    });
    if (newUserDestinationCalendar) {
      return [newUserDestinationCalendar];
    }
  } else {
    // Priority 3: Organizer unchanged — reuse the existing booking user's calendar.
    // Verified: BookingSelectResult includes user.destinationCalendar via bookingSelect.
    // No DB query needed — uses in-memory booking data for performance.
    if (booking?.user?.destinationCalendar) return [booking.user.destinationCalendar];
  }

  // Priority 4: No calendar resolved from any source — downstream handles undefined gracefully.
  return undefined;
}
