import { EventTypesRepository_2024_06_14 } from "@/ee/event-types/event-types_2024_06_14/event-types.repository";
import { Injectable, BadRequestException } from "@nestjs/common";
import { DateTime } from "luxon";

import { SlotFormat } from "@calcom/platform-enums";
import type {
  GetReservedSlotOutput_2024_09_04,
  RangeSlot_2024_09_04,
  RangeSlotsOutput_2024_09_04,
  ReserveSlotOutput_2024_09_04,
  SeatedRangeSlot_2024_09_04,
  SeatedSlot_2024_09_04,
  Slot_2024_09_04,
  SlotsOutput_2024_09_04,
} from "@calcom/platform-types";
import type { SelectedSlots } from "@calcom/prisma/client";

type GetAvailableSlots = {
  slots: Record<string, { time: string; attendees?: number; bookingUid?: string; away?: boolean }[]>;
};

/**
 * Output transformation service for the 2024-09-04 Slots API.
 *
 * Transforms raw availability dictionaries (`GetAvailableSlots`) and Prisma `SelectedSlots`
 * records into typed API response DTOs for the slots endpoint.
 *
 * Supports two output formats:
 * - **`SlotFormat.Time`** (default): Returns slots with `start` time only (`Slot_2024_09_04`).
 * - **`SlotFormat.Range`**: Returns slots with `start` and `end` times (`RangeSlot_2024_09_04`),
 *   where `end = start + duration` computed via Luxon `DateTime.plus({ minutes: slotDuration })`.
 *
 * Each format has seated and non-seated variants:
 * - **Non-seated**: Returns only time fields.
 * - **Seated**: Includes `seatsBooked`, `seatsRemaining`, `seatsTotal`, and `bookingUid`.
 *   Seat arithmetic: `seatsRemaining = seatsTotal - seatsBooked`.
 *
 * Timezone handling:
 * - When a `timeZone` parameter is provided, slot times are converted from UTC via
 *   `DateTime.fromISO(time, { zone: "utc" }).setZone(timeZone).toISO()`.
 * - Throws `BadRequestException` if Luxon fails to produce a valid ISO string.
 *
 * Filtering:
 * - Slots with `away: true` are excluded from output.
 * - Date keys with no remaining slots after filtering are omitted.
 *
 * Reservation output:
 * - Converts Prisma `SelectedSlots` records to `GetReservedSlotOutput_2024_09_04` or
 *   `ReserveSlotOutput_2024_09_04` DTOs with UTC-based Luxon conversions and
 *   duration computation via `DateTime.diff("minutes")`.
 */
@Injectable()
export class SlotsOutputService_2024_09_04 {
  constructor(private readonly eventTypesRepository: EventTypesRepository_2024_06_14) {}

  /**
   * Dispatches available slot formatting based on the requested output format.
   *
   * Routes to `getAvailableTimeSlots` when `format` is `SlotFormat.Time` or undefined (default),
   * and to `getAvailableRangeSlots` when `format` is `SlotFormat.Range`.
   *
   * @param availableSlots - Raw availability dictionary keyed by date string.
   * @param eventTypeId - Event type ID used to fetch seat metadata.
   * @param duration - Optional override for slot duration in minutes (range format only).
   * @param format - Slot output format: `SlotFormat.Time` (default) or `SlotFormat.Range`.
   * @param timeZone - Optional IANA timezone for output conversion; UTC if omitted.
   * @returns Formatted slots dictionary matching the requested format.
   */
  async getAvailableSlots(
    availableSlots: GetAvailableSlots,
    eventTypeId: number,
    duration?: number,
    format?: SlotFormat,
    timeZone?: string
  ): Promise<SlotsOutput_2024_09_04 | RangeSlotsOutput_2024_09_04> {
    if (!format || format === SlotFormat.Time) {
      return this.getAvailableTimeSlots(availableSlots, eventTypeId, timeZone);
    }

    return this.getAvailableRangeSlots(availableSlots, eventTypeId, timeZone, duration);
  }

  /**
   * Produces time-format slot output (`SlotsOutput_2024_09_04`).
   *
   * For each date key in the raw availability:
   * 1. Filters out slots marked as `away`.
   * 2. Skips date keys with no remaining slots.
   * 3. Optionally converts slot times to the target timezone via Luxon.
   * 4. Dispatches to seated or non-seated DTO builder based on `seatsPerTimeSlot`.
   *
   * @param availableSlots - Raw availability dictionary keyed by date string.
   * @param eventTypeId - Event type ID for fetching seat configuration.
   * @param timeZone - Optional IANA timezone; if provided, times are converted from UTC.
   * @returns Dictionary of date keys to arrays of `Slot_2024_09_04` or `SeatedSlot_2024_09_04`.
   * @throws BadRequestException if Luxon timezone conversion produces a null ISO string.
   */
  private async getAvailableTimeSlots(
    availableSlots: GetAvailableSlots,
    eventTypeId: number,
    timeZone: string | undefined
  ): Promise<SlotsOutput_2024_09_04> {
    const eventType = await this.eventTypesRepository.getEventTypeById(eventTypeId);

    const slots: { [key: string]: (Slot_2024_09_04 | SeatedSlot_2024_09_04)[] } = {};
    for (const date in availableSlots.slots) {
      const availableTimeSlots = availableSlots.slots[date].filter((slot) => !slot.away);
      if (availableTimeSlots.length > 0) {
        slots[date] = availableTimeSlots.map((slot) => {
          if (!timeZone) {
            if (!eventType?.seatsPerTimeSlot) {
              return this.getAvailableTimeSlot(slot.time);
            }
            return this.getAvailableTimeSlotSeated(
              slot.time,
              slot.attendees || 0,
              eventType.seatsPerTimeSlot || 0,
              slot.bookingUid
            );
          }
          const slotTimezoneAdjusted = DateTime.fromISO(slot.time, { zone: "utc" }).setZone(timeZone).toISO();
          if (!slotTimezoneAdjusted) {
            throw new BadRequestException(
              `Could not adjust timezone for slot ${slot.time} with timezone ${timeZone}`
            );
          }
          if (!eventType?.seatsPerTimeSlot) {
            return this.getAvailableTimeSlot(slotTimezoneAdjusted);
          }
          return this.getAvailableTimeSlotSeated(
            slotTimezoneAdjusted,
            slot.attendees || 0,
            eventType.seatsPerTimeSlot || 0,
            slot.bookingUid
          );
        });
      }
    }

    return slots;
  }

  /**
   * Builds a non-seated time slot DTO containing only the start time.
   *
   * @param start - ISO 8601 start time string (UTC or timezone-adjusted).
   * @returns A `Slot_2024_09_04` with the `start` field.
   */
  private getAvailableTimeSlot(start: string): Slot_2024_09_04 | SeatedSlot_2024_09_04 {
    return {
      start,
    };
  }

  /**
   * Builds a seated time slot DTO with seat availability metadata.
   *
   * Seat arithmetic: `seatsRemaining = eventTypeSeatsPerTimeslot - seatsBooked`.
   *
   * @param start - ISO 8601 start time string (UTC or timezone-adjusted).
   * @param seatsBooked - Number of seats already booked for this slot.
   * @param eventTypeSeatsPerTimeslot - Total seats configured for the event type.
   * @param bookingUid - Optional UID of the existing booking occupying seats.
   * @returns A `SeatedSlot_2024_09_04` with start, seat counts, and booking UID.
   */
  private getAvailableTimeSlotSeated(
    start: string,
    seatsBooked: number,
    eventTypeSeatsPerTimeslot: number,
    bookingUid: string | undefined
  ): Slot_2024_09_04 | SeatedSlot_2024_09_04 {
    return {
      start,
      seatsBooked,
      seatsRemaining: eventTypeSeatsPerTimeslot - seatsBooked,
      seatsTotal: eventTypeSeatsPerTimeslot,
      bookingUid,
    };
  }

  /**
   * Produces range-format slot output (`RangeSlotsOutput_2024_09_04`) with start and end times.
   *
   * End time is computed as `start + slotDuration` where `slotDuration = duration ?? eventType.length`.
   * Luxon `DateTime.plus({ minutes: slotDuration })` is used for the computation.
   *
   * For each date key in the raw availability:
   * 1. Filters out slots marked as `away`.
   * 2. Skips date keys with no remaining slots.
   * 3. Converts start and end times to the target timezone via Luxon (or stays in UTC).
   * 4. Dispatches to seated or non-seated range DTO builder based on `seatsPerTimeSlot`.
   *
   * @param availableSlots - Raw availability dictionary keyed by date string.
   * @param eventTypeId - Event type ID for fetching seat configuration and default duration.
   * @param timeZone - Optional IANA timezone; if provided, times are converted from UTC.
   * @param duration - Optional override for slot duration in minutes; falls back to event type length.
   * @returns Dictionary of date keys to arrays of `RangeSlot_2024_09_04` or `SeatedRangeSlot_2024_09_04`.
   * @throws BadRequestException if Luxon timezone conversion or UTC formatting produces a null ISO string.
   */
  private async getAvailableRangeSlots(
    availableSlots: GetAvailableSlots,
    eventTypeId: number,
    timeZone?: string,
    duration?: number
  ): Promise<RangeSlotsOutput_2024_09_04> {
    const eventType = await this.eventTypesRepository.getEventTypeById(eventTypeId);

    const slotDuration = duration ?? eventType?.length;

    const slots = Object.entries(availableSlots.slots).reduce<
      Record<string, (RangeSlot_2024_09_04 | SeatedRangeSlot_2024_09_04)[]>
    >((acc, [date, slots]) => {
      const availableTimeSlots = slots.filter((slot) => !slot.away);
      if (availableTimeSlots.length > 0) {
        acc[date] = availableTimeSlots.map((slot) => {
          if (timeZone) {
            const start = DateTime.fromISO(slot.time, { zone: "utc" }).setZone(timeZone).toISO();
            if (!start) {
              throw new BadRequestException(
                `Could not adjust timezone for slot ${slot.time} with timezone ${timeZone}`
              );
            }

            const end = DateTime.fromISO(slot.time, { zone: "utc" })
              .plus({ minutes: slotDuration })
              .setZone(timeZone)
              .toISO();

            if (!end) {
              throw new BadRequestException(
                `Could not adjust timezone for slot end time ${slot.time} with timezone ${timeZone}`
              );
            }

            if (!eventType?.seatsPerTimeSlot) {
              return this.getAvailableRangeSlot(start, end);
            }
            return this.getAvailableRangeSlotSeated(
              start,
              end,
              slot.attendees || 0,
              eventType.seatsPerTimeSlot ?? undefined,
              slot.bookingUid
            );
          } else {
            const start = DateTime.fromISO(slot.time, { zone: "utc" }).toISO();
            const end = DateTime.fromISO(slot.time, { zone: "utc" }).plus({ minutes: slotDuration }).toISO();

            if (!start || !end) {
              throw new BadRequestException(`Could not create UTC time for slot ${slot.time}`);
            }

            if (!eventType?.seatsPerTimeSlot) {
              return this.getAvailableRangeSlot(start, end);
            }
            return this.getAvailableRangeSlotSeated(
              start,
              end,
              slot.attendees || 0,
              eventType.seatsPerTimeSlot ?? undefined,
              slot.bookingUid
            );
          }
        });
      }
      return acc;
    }, {});

    return slots;
  }

  /**
   * Builds a non-seated range slot DTO containing start and end times.
   *
   * @param start - ISO 8601 start time string (UTC or timezone-adjusted).
   * @param end - ISO 8601 end time string (UTC or timezone-adjusted).
   * @returns A `RangeSlot_2024_09_04` with `start` and `end` fields.
   */
  private getAvailableRangeSlot(
    start: string,
    end: string
  ): RangeSlot_2024_09_04 | SeatedRangeSlot_2024_09_04 {
    return {
      start,
      end,
    };
  }

  /**
   * Builds a seated range slot DTO with start/end times and seat availability metadata.
   *
   * Seat arithmetic: `seatsRemaining = eventTypeSeatsPerTimeslot - seatsBooked`.
   *
   * @param start - ISO 8601 start time string (UTC or timezone-adjusted).
   * @param end - ISO 8601 end time string (UTC or timezone-adjusted).
   * @param seatsBooked - Number of seats already booked for this slot.
   * @param eventTypeSeatsPerTimeslot - Total seats configured for the event type.
   * @param bookingUid - Optional UID of the existing booking occupying seats.
   * @returns A `SeatedRangeSlot_2024_09_04` with start, end, seat counts, and booking UID.
   */
  private getAvailableRangeSlotSeated(
    start: string,
    end: string,
    seatsBooked: number,
    eventTypeSeatsPerTimeslot: number,
    bookingUid: string | undefined
  ): RangeSlot_2024_09_04 | SeatedRangeSlot_2024_09_04 {
    return {
      start,
      end,
      seatsBooked,
      seatsRemaining: eventTypeSeatsPerTimeslot - seatsBooked,
      seatsTotal: eventTypeSeatsPerTimeslot,
      bookingUid,
    };
  }

  /**
   * Converts a Prisma `SelectedSlots` record into a `GetReservedSlotOutput_2024_09_04` DTO.
   *
   * Uses Luxon to convert `slotUtcStartDate` and `slotUtcEndDate` from JS `Date` to ISO strings
   * in UTC, falling back to `"unknown-slot-start"` / `"unknown-slot-end"` if conversion fails.
   * Slot duration is computed via `DateTime.diff("minutes")` between end and start.
   *
   * @param slot - Prisma `SelectedSlots` record with UTC date fields and release metadata.
   * @returns Reservation output DTO with slot times, duration, reservation UID, and expiry.
   */
  getReservationSlot(slot: SelectedSlots): GetReservedSlotOutput_2024_09_04 {
    return {
      eventTypeId: slot.eventTypeId,
      slotStart: DateTime.fromJSDate(slot.slotUtcStartDate, { zone: "utc" }).toISO() || "unknown-slot-start",
      slotEnd: DateTime.fromJSDate(slot.slotUtcEndDate, { zone: "utc" }).toISO() || "unknown-slot-end",
      slotDuration: DateTime.fromJSDate(slot.slotUtcEndDate, { zone: "utc" }).diff(
        DateTime.fromJSDate(slot.slotUtcStartDate, { zone: "utc" }),
        "minutes"
      ).minutes,
      reservationUid: slot.uid,
      reservationUntil:
        DateTime.fromJSDate(slot.releaseAt, { zone: "utc" }).toISO() || "unknown-reserved-until",
    };
  }

  /**
   * Converts a Prisma `SelectedSlots` record into a `ReserveSlotOutput_2024_09_04` DTO,
   * extending the base reservation output with the configured reservation duration.
   *
   * Uses Luxon to convert `slotUtcStartDate` and `slotUtcEndDate` from JS `Date` to ISO strings
   * in UTC, falling back to `"unknown-slot-start"` / `"unknown-slot-end"` if conversion fails.
   * Slot duration is computed via `DateTime.diff("minutes")` between end and start.
   *
   * @param slot - Prisma `SelectedSlots` record with UTC date fields and release metadata.
   * @param reservationDuration - Duration in minutes for which the slot reservation is held.
   * @returns Extended reservation output DTO including reservation duration.
   */
  getReservationSlotCreated(slot: SelectedSlots, reservationDuration: number): ReserveSlotOutput_2024_09_04 {
    return {
      eventTypeId: slot.eventTypeId,
      slotStart: DateTime.fromJSDate(slot.slotUtcStartDate, { zone: "utc" }).toISO() || "unknown-slot-start",
      slotEnd: DateTime.fromJSDate(slot.slotUtcEndDate, { zone: "utc" }).toISO() || "unknown-slot-end",
      slotDuration: DateTime.fromJSDate(slot.slotUtcEndDate, { zone: "utc" }).diff(
        DateTime.fromJSDate(slot.slotUtcStartDate, { zone: "utc" }),
        "minutes"
      ).minutes,
      reservationDuration,
      reservationUid: slot.uid,
      reservationUntil:
        DateTime.fromJSDate(slot.releaseAt, { zone: "utc" }).toISO() || "unknown-reserved-until",
    };
  }
}
