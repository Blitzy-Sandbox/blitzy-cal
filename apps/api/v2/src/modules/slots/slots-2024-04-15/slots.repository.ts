import { PrismaReadService } from "@/modules/prisma/prisma-read.service";
import { PrismaWriteService } from "@/modules/prisma/prisma-write.service";
import { Injectable } from "@nestjs/common";
import { DateTime } from "luxon";

import { MINUTES_TO_BOOK } from "@calcom/platform-libraries";
import { ReserveSlotInput_2024_04_15 } from "@calcom/platform-types";

/**
 * Prisma-backed persistence gateway for the 2024-04-15 versioned slots module.
 *
 * Accesses the `SelectedSlots` model (via {@link PrismaWriteService}) for slot
 * reservation lifecycle operations and the `Booking` model (via {@link PrismaReadService})
 * for attendee lookups used in seat-capacity checks.
 *
 * Public API:
 * - {@link getBookingWithAttendees} — Fetches booking attendees for seat capacity validation.
 * - {@link upsertSelectedSlot} — Idempotent slot reservation using the `selectedSlotUnique`
 *   composite constraint `(userId, slotUtcStartDate, slotUtcEndDate, uid)`, with a
 *   time-limited hold computed via Luxon and the shared `MINUTES_TO_BOOK` constant.
 * - {@link deleteSelectedSlots} — Removes all slot holds for a given booking UID on
 *   completion or explicit release.
 *
 * This is the **only** repository wired into `SlotsModule_2024_04_15` and is consumed
 * exclusively by `SlotsService_2024_04_15`.
 */
@Injectable()
export class SlotsRepository_2024_04_15 {
  constructor(private readonly dbRead: PrismaReadService, private readonly dbWrite: PrismaWriteService) {}

  /**
   * Retrieves a booking's attendee list for seat-capacity validation.
   *
   * Uses the read-only Prisma service to fetch a minimal `{ attendees: true }`
   * projection from the `Booking` model. Returns `null` when no booking matches
   * the provided UID, or when `bookingUid` is `undefined`.
   *
   * @param bookingUid - Optional booking UID to look up. When omitted the query
   *   targets `undefined`, which causes Prisma to return `null`.
   * @returns The booking with its attendees array, or `null` if not found.
   */
  async getBookingWithAttendees(bookingUid?: string) {
    return this.dbRead.prisma.booking.findUnique({
      where: { uid: bookingUid },
      select: { attendees: true },
    });
  }

  /**
   * Creates or refreshes a time-limited slot reservation using an idempotent upsert.
   *
   * The upsert targets the `selectedSlotUnique` composite unique constraint
   * `(userId, slotUtcStartDate, slotUtcEndDate, uid)` on the `SelectedSlots` model.
   * When an existing record matches, only the mutable fields (`slotUtcEndDate`,
   * `slotUtcStartDate`, `releaseAt`, `eventTypeId`) are refreshed. When no record
   * exists, a full row is created — including the `isSeat` flag for seated events.
   *
   * The `releaseAt` timestamp is computed as `DateTime.utc().plus({ minutes: MINUTES_TO_BOOK })`
   * via Luxon, giving the caller a fixed window to finalise the booking before the
   * hold is automatically released by the platform's cleanup job.
   *
   * @param userId - Numeric ID of the user reserving the slot.
   * @param input  - DTO containing `slotUtcStartDate`, `slotUtcEndDate`, and `eventTypeId`.
   * @param uid    - Unique booking identifier used as part of the composite key.
   * @param isSeat - Whether this reservation is for a seated event (only set on create).
   * @returns The upserted `SelectedSlots` record.
   */
  async upsertSelectedSlot(userId: number, input: ReserveSlotInput_2024_04_15, uid: string, isSeat: boolean) {
    const { slotUtcEndDate, slotUtcStartDate, eventTypeId } = input;

    const releaseAt = DateTime.utc()
      .plus({ minutes: parseInt(MINUTES_TO_BOOK) })
      .toISO();
    return this.dbWrite.prisma.selectedSlots.upsert({
      where: {
        selectedSlotUnique: { userId, slotUtcStartDate, slotUtcEndDate, uid },
      },
      update: {
        slotUtcEndDate,
        slotUtcStartDate,
        releaseAt,
        eventTypeId,
      },
      create: {
        userId,
        eventTypeId,
        slotUtcStartDate,
        slotUtcEndDate,
        uid,
        releaseAt,
        isSeat,
      },
    });
  }

  /**
   * Removes all slot holds associated with the given booking UID.
   *
   * Performs a `deleteMany` via the write Prisma service, matching every
   * `SelectedSlots` row whose `uid` equals the provided value. This is
   * invoked after a booking is finalised or when a slot reservation is
   * explicitly released by the caller.
   *
   * @param uid - The booking UID whose slot holds should be purged.
   * @returns A Prisma `BatchPayload` indicating the number of deleted records.
   */
  async deleteSelectedSlots(uid: string) {
    return this.dbWrite.prisma.selectedSlots.deleteMany({
      where: { uid: { equals: uid } },
    });
  }
}
