import { DateTime } from "luxon";

import { HttpError } from "@calcom/lib/http-error";
import { prisma } from "@calcom/prisma";
import type { Host } from "@calcom/prisma/client";
import { BookingStatus } from "@calcom/prisma/enums";

/**
 * Validates that a round-robin event type has at least one available host for
 * the requested time slot before committing a slot reservation.
 *
 * Hosts are split into fixed (required) and non-fixed (pool) categories:
 * - **Fixed hosts** must ALL be available — any conflict blocks the slot entirely.
 * - **Non-fixed hosts** need at least ONE available — the slot is blocked only when
 *   every pool member is either reserved or already booked.
 *
 * **Upstream assumptions (verified for ET-003 / ET-005 parity):**
 * - Buffer times (`beforeEventBuffer`, `afterEventBuffer`) are enforced at the
 *   slot generation layer in the availability engine, not at reservation time.
 *   The `startDate`/`endDate` passed here represent the exact bookable slot
 *   boundaries as surfaced to the invitee.
 * - Booking window restrictions (`periodType`, `periodDays`, `periodStartDate`,
 *   `periodEndDate`) are enforced upstream during slot generation and are not
 *   re-validated here.
 *
 * @param eventTypeId - The round-robin event type ID
 * @param startDate   - Slot start as a Luxon DateTime (UTC)
 * @param endDate     - Slot end as a Luxon DateTime (UTC)
 * @param hosts       - All hosts assigned to the event type
 * @throws {HttpError} 422 when no available hosts remain for the slot
 */
export async function validateRoundRobinSlotAvailability(
  eventTypeId: number,
  startDate: DateTime,
  endDate: DateTime,
  hosts: Host[]
) {
  const fixedHosts = hosts.filter((host) => host.isFixed === true);
  const nonFixedHosts = hosts.filter((host) => host.isFixed === false);

  if (fixedHosts.length > 0) {
    await validateFixedHostsAvailability(eventTypeId, startDate, endDate, fixedHosts);
  } else {
    await validateNonFixedHostsAvailability(eventTypeId, startDate, endDate, nonFixedHosts);
  }
}

async function validateFixedHostsAvailability(
  eventTypeId: number,
  startDate: DateTime,
  endDate: DateTime,
  hosts: Host[]
) {
  // Use overlapping time range check — a booking conflicts if it starts before
  // the requested slot ends AND ends after the requested slot starts.  This
  // replaces the previous exact-match query that missed partial overlaps
  // (e.g., a 10:00–10:30 booking would not have blocked a 10:00–11:00 request).
  // Only active bookings should block; cancelled and rejected bookings are excluded.
  const existingBookings = await prisma.booking.findMany({
    where: {
      eventTypeId,
      startTime: { lt: endDate.toJSDate() },
      endTime: { gt: startDate.toJSDate() },
      status: { in: [BookingStatus.ACCEPTED, BookingStatus.PENDING, BookingStatus.AWAITING_HOST] },
    },
    select: { userId: true },
  });

  const existingSlotReservation = await prisma.selectedSlots.count({
    where: {
      eventTypeId,
      slotUtcStartDate: startDate.toISO() ?? "",
      slotUtcEndDate: endDate.toISO() ?? "",
      // Only consider non-expired reservations
      releaseAt: { gt: DateTime.utc().toJSDate() },
    },
  });

  // Check if any fixed host is the organizer of an existing overlapping booking.
  // In round-robin scheduling, the assigned host is recorded as booking.userId.
  const hasHostConflict = hosts.some((host) =>
    existingBookings.some((booking) => booking.userId === host.userId)
  );

  if (existingSlotReservation > 0) {
    throw new HttpError({
      statusCode: 422,
      message: `Can't reserve the slot because the round robin event type has no available hosts left at this time slot.`,
    });
  }

  if (hasHostConflict) {
    throw new HttpError({
      statusCode: 422,
      message: `Can't reserve a slot if the event is already booked.`,
    });
  }
}

async function validateNonFixedHostsAvailability(
  eventTypeId: number,
  startDate: DateTime,
  endDate: DateTime,
  hosts: Host[]
) {
  const existingSlotReservations = await prisma.selectedSlots.count({
    where: {
      eventTypeId,
      slotUtcStartDate: startDate.toISO() ?? "",
      slotUtcEndDate: endDate.toISO() ?? "",
      // Only consider non-expired reservations
      releaseAt: { gt: DateTime.utc().toJSDate() },
    },
  });

  // Also count non-fixed hosts that already have active overlapping bookings.
  // A host with an existing confirmed booking at this time cannot accept a
  // new round-robin assignment.  Using `distinct` on userId ensures each host
  // is counted at most once even if they have multiple overlapping bookings.
  const bookedHosts = await prisma.booking.findMany({
    where: {
      eventTypeId,
      startTime: { lt: endDate.toJSDate() },
      endTime: { gt: startDate.toJSDate() },
      status: { in: [BookingStatus.ACCEPTED, BookingStatus.PENDING, BookingStatus.AWAITING_HOST] },
      userId: { in: hosts.map((h) => h.userId) },
    },
    select: { userId: true },
    distinct: ["userId"],
  });

  // Available capacity = total pool size minus hosts already committed to bookings.
  // The slot is full when all remaining capacity is consumed by active reservations.
  const availableHostCount = hosts.length - bookedHosts.length;
  if (existingSlotReservations >= availableHostCount) {
    throw new HttpError({
      statusCode: 422,
      message: `Can't reserve the slot because the round robin event type has no available hosts left at this time slot.`,
    });
  }
}
