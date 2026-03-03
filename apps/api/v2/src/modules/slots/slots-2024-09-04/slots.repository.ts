import { PrismaReadService } from "@/modules/prisma/prisma-read.service";
import { PrismaWriteService } from "@/modules/prisma/prisma-write.service";
import { Injectable } from "@nestjs/common";
import { DateTime } from "luxon";
import { v4 as uuid } from "uuid";

/**
 * Stateless, dependency-injected persistence layer for the `SelectedSlots` Prisma model
 * in the 2024-09-04 API version. Delegates exclusively to `PrismaReadService` for query
 * operations and `PrismaWriteService` for mutation operations.
 *
 * All time computations use Luxon `DateTime.utc()` (following the API v2 NestJS convention,
 * not `@calcom/dayjs`). The `releaseAt` field serves as the reservation expiration deadline,
 * computed as `now + duration` minutes from the current UTC time.
 *
 * Note: `deleteSlot` uses `deleteMany` because the `uid` field is not marked as unique
 * in the `SelectedSlots` Prisma schema.
 *
 * @see {@link packages/prisma/schema.prisma} for the `SelectedSlots` model definition
 */
@Injectable()
export class SlotsRepository_2024_09_04 {
  constructor(private readonly dbRead: PrismaReadService, private readonly dbWrite: PrismaWriteService) {}

  /**
   * Fetches a single SelectedSlot by its unique identifier.
   *
   * @param uid - The unique identifier of the slot reservation
   * @returns The matching `SelectedSlots` record, or `null` if not found
   */
  async getByUid(uid: string) {
    return this.dbRead.prisma.selectedSlots.findFirst({ where: { uid } });
  }

  /**
   * Checks for bookings with ACCEPTED, PENDING, or AWAITING_HOST status that overlap
   * a proposed slot window. Used to prevent double-booking during slot reservation.
   *
   * Overlap is determined by: booking starts before slot ends AND booking ends after slot starts.
   *
   * @param eventTypeId - The event type ID to check bookings against
   * @param slotStartTime - The proposed slot start time
   * @param slotEndTime - The proposed slot end time
   * @returns The first overlapping active booking with attendees and status, or `null` if none
   */
  async findActiveOverlappingBooking(eventTypeId: number, slotStartTime: Date, slotEndTime: Date) {
    return this.dbRead.prisma.booking.findFirst({
      where: {
        eventTypeId,
        startTime: {
          // note(Lauris): booking starts before the potential slot reservation ends.
          lt: slotEndTime,
        },
        endTime: {
          // note(Lauris): booking ends after the potential slot reservation begins.
          gt: slotStartTime,
        },
        status: {
          in: ["ACCEPTED", "PENDING", "AWAITING_HOST"],
        },
      },
      select: { attendees: true, status: true },
    });
  }

  /**
   * Checks for active (non-expired) slot reservations that overlap a proposed time window.
   * Covers all four possible overlap scenarios:
   *   1. New slot starts during an existing slot
   *   2. New slot ends during an existing slot
   *   3. New slot is completely inside an existing slot
   *   4. New slot completely overlaps an existing slot
   *
   * Only reservations with a `releaseAt` in the future (i.e., not yet expired) are considered.
   *
   * @param eventTypeId - The event type ID to check reservations against
   * @param startDate - The proposed slot start date as an ISO string
   * @param endDate - The proposed slot end date as an ISO string
   * @returns The first overlapping active reservation, or `null` if none
   */
  async getOverlappingSlotReservation(eventTypeId: number, startDate: string, endDate: string) {
    return this.dbRead.prisma.selectedSlots.findFirst({
      where: {
        eventTypeId,
        AND: [
          {
            OR: [
              // Case 1: New slot starts during an existing slot
              { slotUtcStartDate: { lte: startDate }, slotUtcEndDate: { gt: startDate } },
              // Case 2: New slot ends during an existing slot
              { slotUtcStartDate: { lt: endDate }, slotUtcEndDate: { gte: endDate } },
              // Case 3: New slot is completely inside an existing slot
              { slotUtcStartDate: { lte: startDate }, slotUtcEndDate: { gte: endDate } },
              // Case 4: New slot completely overlaps an existing slot
              { slotUtcStartDate: { gte: startDate }, slotUtcEndDate: { lte: endDate } },
            ],
          },
          // Only consider non-expired reservations
          { releaseAt: { gt: DateTime.utc().toJSDate() } },
        ],
      },
    });
  }

  /**
   * Creates a new slot reservation with an auto-generated UUID and a Luxon-computed
   * `releaseAt` expiration deadline. The `releaseAt` is set to `now + duration` minutes
   * from the current UTC time, controlling how long the reservation hold remains active.
   *
   * @param userId - The ID of the user creating the reservation
   * @param eventTypeId - The event type ID for the slot
   * @param slotUtcStartDate - The slot start date/time as an ISO string in UTC
   * @param slotUtcEndDate - The slot end date/time as an ISO string in UTC
   * @param isSeat - Whether this reservation is for a seat-based event
   * @param duration - The reservation hold duration in minutes (used to compute `releaseAt`)
   * @returns The newly created `SelectedSlots` record
   */
  async createSlot(
    userId: number,
    eventTypeId: number,
    slotUtcStartDate: string,
    slotUtcEndDate: string,
    isSeat: boolean,
    duration: number
  ) {
    const uid = uuid();
    const reservationUntil = DateTime.utc().plus({ minutes: duration }).toISO();

    return this.dbWrite.prisma.selectedSlots.create({
      data: {
        uid,
        userId,
        eventTypeId,
        slotUtcStartDate,
        slotUtcEndDate,
        releaseAt: reservationUntil,
        isSeat,
      },
    });
  }

  /**
   * Updates an existing slot reservation by its primary key ID, recomputing the `releaseAt`
   * expiration deadline based on the new duration.
   *
   * @param eventTypeId - The updated event type ID
   * @param slotUtcStartDate - The updated slot start date/time as an ISO string in UTC
   * @param slotUtcEndDate - The updated slot end date/time as an ISO string in UTC
   * @param id - The primary key ID of the SelectedSlots record to update
   * @param duration - The reservation hold duration in minutes (used to recompute `releaseAt`)
   * @returns The updated `SelectedSlots` record
   */
  async updateSlot(
    eventTypeId: number,
    slotUtcStartDate: string,
    slotUtcEndDate: string,
    id: number,
    duration: number
  ) {
    const reservationUntil = DateTime.utc().plus({ minutes: duration }).toISO();

    return this.dbWrite.prisma.selectedSlots.update({
      where: {
        id,
      },
      data: {
        slotUtcEndDate,
        slotUtcStartDate,
        releaseAt: reservationUntil,
        eventTypeId,
      },
    });
  }

  /**
   * Removes slot reservations by UID. Uses `deleteMany` instead of `delete` because
   * the `uid` field is not marked as unique in the `SelectedSlots` Prisma schema.
   *
   * @param uid - The UID of the slot reservation(s) to remove
   * @returns A batch payload indicating how many records were deleted
   */
  async deleteSlot(uid: string) {
    // note(Lauris): we have deleteMany because for some reason uid is not unique in the prisma schema
    return this.dbWrite.prisma.selectedSlots.deleteMany({
      where: { uid: { equals: uid } },
    });
  }
}
