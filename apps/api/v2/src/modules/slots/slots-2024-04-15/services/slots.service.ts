import { EventTypesRepository_2024_04_15 } from "@/ee/event-types/event-types_2024_04_15/event-types.repository";
import { SlotsRepository_2024_04_15 } from "@/modules/slots/slots-2024-04-15/slots.repository";
import { Injectable, NotFoundException } from "@nestjs/common";
import { v4 as uuid } from "uuid";

import { ReserveSlotInput_2024_04_15 } from "@calcom/platform-types";

/**
 * Business logic coordinator for the 2024-04-15 versioned slots API.
 *
 * Orchestrates slot reservation, deletion, and team-event detection by coordinating
 * two injected repositories:
 * - {@link EventTypesRepository_2024_04_15} — provides event type metadata and seat configuration
 * - {@link SlotsRepository_2024_04_15} — handles slot persistence via the `SelectedSlots` Prisma model
 *
 * Exposes three public methods:
 * - `reserveSlot` — reserves time slots for all event-type users with seat capacity enforcement
 * - `deleteSelectedslot` — removes slot holds by booking UID for cleanup after completion or release
 * - `checkIfIsTeamEvent` — determines whether an event type belongs to a team
 *
 * Exported by `SlotsModule_2024_04_15` for dependency injection into higher-level modules.
 * Consumed by `SlotsController_2024_04_15` for HTTP endpoint handling.
 */
@Injectable()
export class SlotsService_2024_04_15 {
  constructor(
    private readonly eventTypeRepo: EventTypesRepository_2024_04_15,
    private readonly slotsRepo: SlotsRepository_2024_04_15
  ) {}

  /**
   * Reserves time slots for all users associated with an event type.
   *
   * Resolves or generates a unique identifier via the `headerUid` parameter or a `uuid()` fallback.
   * Loads the event type with its seat configuration and team members from the repository.
   *
   * @throws {NotFoundException} If the event type identified by `input.eventTypeId` does not exist.
   *
   * **Seat capacity enforcement**: When `seatsPerTimeSlot` is configured on the event type,
   * the method loads the booking's attendees and checks remaining seats. If no seats remain
   * (i.e. `seatsLeft < 1`), the reservation is blocked. If no attendees are found for the
   * booking, the reservation is also blocked to prevent invalid state.
   *
   * **Dry-run support**: When `input._isDryRun` is `true`, persistence is skipped entirely.
   * This is useful for validation-only flows that need to verify slot availability without
   * actually reserving.
   *
   * **Multi-user slot reservation**: Upserts `SelectedSlots` rows for ALL team members in
   * parallel via `Promise.all`. The `isSeat` flag on each upserted row is derived from
   * `eventType.seatsPerTimeSlot !== null`.
   *
   * @param input - {@link ReserveSlotInput_2024_04_15} containing `eventTypeId`,
   *   `slotUtcStartDate`, `slotUtcEndDate`, optional `bookingUid`, and optional `_isDryRun`.
   * @param headerUid - Optional pre-existing UID from request headers. When provided, this
   *   UID is reused instead of generating a new one.
   * @returns The reservation UID — either the provided `headerUid` or a newly generated UUID.
   */
  async reserveSlot(input: ReserveSlotInput_2024_04_15, headerUid?: string) {
    const uid = headerUid || uuid();
    const eventType = await this.eventTypeRepo.getEventTypeWithSeats(input.eventTypeId);
    if (!eventType) {
      throw new NotFoundException("Event Type not found");
    }

    let shouldReserveSlot = true;
    if (eventType.seatsPerTimeSlot) {
      const bookingWithAttendees = input.bookingUid
        ? await this.slotsRepo.getBookingWithAttendees(input.bookingUid)
        : undefined;
      const bookingAttendeesLength = bookingWithAttendees?.attendees?.length;
      if (bookingAttendeesLength) {
        const seatsLeft = eventType.seatsPerTimeSlot - bookingAttendeesLength;
        if (seatsLeft < 1) shouldReserveSlot = false;
      } else {
        shouldReserveSlot = false;
      }
    }

    if (eventType && shouldReserveSlot && !input._isDryRun) {
      await Promise.all(
        eventType.users.map((user) =>
          this.slotsRepo.upsertSelectedSlot(user.id, input, uid, eventType.seatsPerTimeSlot !== null)
        )
      );
    }

    return uid;
  }

  /**
   * Deletes all selected slot holds associated with a given booking UID.
   *
   * Guards against an undefined `uid` by returning early as a no-op, ensuring
   * callers do not need to perform their own null checks.
   *
   * Delegates to {@link SlotsRepository_2024_04_15.deleteSelectedSlots} for persistence.
   * Used for cleanup after booking completion or explicit slot release by the client.
   *
   * @param uid - Optional booking UID whose slot holds should be removed.
   *   When `undefined`, the method returns immediately without side effects.
   */
  async deleteSelectedslot(uid?: string) {
    if (!uid) return;

    return this.slotsRepo.deleteSelectedSlots(uid);
  }

  /**
   * Determines whether a given event type belongs to a team.
   *
   * Returns `false` immediately when `eventTypeId` is `undefined`, avoiding
   * unnecessary database lookups for callers that may not have an event type context.
   *
   * Loads the event type via {@link EventTypesRepository_2024_04_15.getEventTypeById}
   * and checks for a non-null `teamId` field on the result.
   *
   * Used by the controller to toggle team-specific flows such as multi-user
   * slot reservation across all team members.
   *
   * @param eventTypeId - Optional event type ID to check for team membership.
   * @returns `true` if the event type belongs to a team, `false` otherwise.
   */
  async checkIfIsTeamEvent(eventTypeId?: number) {
    if (!eventTypeId) return false;

    const event = await this.eventTypeRepo.getEventTypeById(eventTypeId);
    return !!event?.teamId;
  }
}
