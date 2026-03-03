import { EventTypesRepository_2024_04_15 } from "@/ee/event-types/event-types_2024_04_15/event-types.repository";
import { Injectable, BadRequestException } from "@nestjs/common";
import { DateTime } from "luxon";

import { SlotFormat } from "@calcom/platform-enums";

/**
 * Defines the raw time-slot response contract for the 2024-04-15 versioned slots API.
 *
 * `slots` is a date-keyed record where each date (e.g. `"2024-04-15"`) maps to an array of
 * slot objects. Each slot contains a `time` property (ISO 8601 timestamp), an optional
 * `attendees` count, and an optional `bookingUid` reference.
 *
 * This type is the default output format when no `slotFormat` query parameter is specified.
 * Consumed by `SlotsController_2024_04_15`, `SlotsWorkerService_2024_04_15`, and the worker thread.
 *
 * @remarks This type definition is part of the API response contract and MUST NOT be modified (Rule 0.7.4).
 */
export type TimeSlots = {
  slots: Record<string, { time: string; attendees?: number; bookingUid?: string }[]>;
};
/**
 * Defines the range-format slot response contract for the 2024-04-15 versioned slots API.
 *
 * `slots` is a date-keyed record where each date maps to an array of range objects. Each range
 * contains `startTime` and `endTime` (ISO 8601 timestamps), an optional `attendees` count, and
 * an optional `bookingUid` reference.
 *
 * This type is used when the `slotFormat=range` query parameter is specified. Duration is resolved
 * from the event type's `length` field or an explicit `duration` parameter.
 *
 * @remarks This type definition is part of the API response contract and MUST NOT be modified (Rule 0.7.4).
 */
export type RangeSlots = {
  slots: Record<string, { startTime: string; endTime: string; attendees?: number; bookingUid?: string }[]>;
};

/**
 * Output formatter and timezone normalizer for the 2024-04-15 versioned slots API.
 *
 * Transforms raw {@link TimeSlots} into presentation-ready responses, optionally converting
 * to {@link RangeSlots} format when a `slotFormat` parameter is specified. Handles timezone
 * normalization using Luxon `DateTime` for IANA timezone conversion, ensuring all timestamps
 * are presented in the caller's requested timezone.
 *
 * Resolves slot duration from explicit parameters or event type metadata via
 * {@link EventTypesRepository_2024_04_15} for range end-time computation.
 *
 * Injected and used by `SlotsController_2024_04_15` to format slot availability responses.
 */
@Injectable()
export class SlotsOutputService_2024_04_15 {
  constructor(private readonly eventTypesRepository: EventTypesRepository_2024_04_15) {}

  /**
   * Entry point for formatting slot availability responses.
   *
   * Decision tree:
   * 1. Without `slotFormat`: returns raw {@link TimeSlots}, optionally shifted to target `timeZone`.
   * 2. With `slotFormat`: converts to {@link RangeSlots} (adding `endTime` = `startTime` + duration),
   *    optionally shifted to target `timeZone`.
   *
   * @param availableSlots - Raw {@link TimeSlots} from the availability engine.
   * @param duration - Optional explicit duration in minutes for range calculation.
   * @param eventTypeId - Optional event type ID for duration fallback lookup.
   * @param slotFormat - Optional {@link SlotFormat} enum value (`'range'`) to convert to {@link RangeSlots}.
   * @param timeZone - Optional IANA timezone string for timestamp normalization.
   * @returns {@link TimeSlots} when no format is specified, or {@link RangeSlots} when format is `'range'`.
   */
  async getOutputSlots(
    availableSlots: TimeSlots,
    duration?: number,
    eventTypeId?: number,
    slotFormat?: SlotFormat,
    timeZone?: string
  ): Promise<TimeSlots | RangeSlots> {
    if (!slotFormat) {
      return timeZone ? this.setTimeZone(availableSlots, timeZone) : availableSlots;
    }

    const formattedSlots = await this.formatSlots(availableSlots, duration, eventTypeId, slotFormat);
    return timeZone ? this.setTimeZoneRange(formattedSlots, timeZone) : formattedSlots;
  }

  /**
   * Converts all `time` timestamps in {@link TimeSlots} to the target IANA timezone using Luxon.
   *
   * Preserves optional `attendees` and `bookingUid` metadata on each slot.
   * Falls back to `"unknown-time"` if Luxon conversion returns null.
   *
   * @param slots - The {@link TimeSlots} to timezone-shift.
   * @param timeZone - IANA timezone string (e.g. `"America/New_York"`).
   * @returns A new {@link TimeSlots} with all timestamps converted to the target timezone.
   */
  private setTimeZone(slots: TimeSlots, timeZone: string): TimeSlots {
    const formattedSlots = Object.entries(slots.slots).reduce((acc, [date, daySlots]) => {
      acc[date] = daySlots.map((slot) => ({
        time: DateTime.fromISO(slot.time).setZone(timeZone).toISO() || "unknown-time",
        ...(slot.attendees ? { attendees: slot.attendees } : {}),
        ...(slot.bookingUid ? { bookingUid: slot.bookingUid } : {}),
      }));
      return acc;
    }, {} as Record<string, { time: string }[]>);

    return { slots: formattedSlots };
  }

  /**
   * Converts `startTime` and `endTime` timestamps in {@link RangeSlots} to the target IANA timezone.
   *
   * Preserves optional `attendees` and `bookingUid` metadata on each slot.
   * Falls back to `"unknown-start-time"` / `"unknown-end-time"` for null conversions.
   *
   * @param slots - The {@link RangeSlots} to timezone-shift.
   * @param timeZone - IANA timezone string (e.g. `"America/New_York"`).
   * @returns A new {@link RangeSlots} with all timestamps converted to the target timezone.
   */
  private setTimeZoneRange(slots: RangeSlots, timeZone: string): RangeSlots {
    const formattedSlots = Object.entries(slots.slots).reduce((acc, [date, daySlots]) => {
      acc[date] = daySlots.map((slot) => ({
        startTime: DateTime.fromISO(slot.startTime).setZone(timeZone).toISO() || "unknown-start-time",
        endTime: DateTime.fromISO(slot.endTime).setZone(timeZone).toISO() || "unknown-end-time",
        ...(slot.attendees ? { attendees: slot.attendees } : {}),
        ...(slot.bookingUid ? { bookingUid: slot.bookingUid } : {}),
      }));
      return acc;
    }, {} as Record<string, { startTime: string; endTime: string }[]>);

    return { slots: formattedSlots };
  }

  /**
   * Converts {@link TimeSlots} into {@link RangeSlots} by computing `endTime` from
   * `startTime` + resolved duration.
   *
   * Validates the {@link SlotFormat} enum, throwing `BadRequestException` for invalid values.
   * Resolves duration via {@link getDuration} helper (explicit param or event type metadata).
   * Duration is in minutes, converted to milliseconds (`* 60000`) for Date arithmetic.
   *
   * @param availableSlots - Raw {@link TimeSlots} from the availability engine.
   * @param duration - Optional explicit duration in minutes.
   * @param eventTypeId - Optional event type ID for fallback duration lookup.
   * @param slotFormat - Optional {@link SlotFormat} to validate.
   * @returns A new {@link RangeSlots} with computed `startTime` and `endTime` pairs.
   * @throws {BadRequestException} If `slotFormat` is not a valid `SlotFormat` enum value.
   */
  private async formatSlots(
    availableSlots: TimeSlots,
    duration?: number,
    eventTypeId?: number,
    slotFormat?: SlotFormat
  ): Promise<RangeSlots> {
    if (slotFormat && !Object.values(SlotFormat).includes(slotFormat)) {
      throw new BadRequestException("Invalid slot format. Must be either 'range' or 'time'");
    }

    const slotDuration = await this.getDuration(duration, eventTypeId);

    const slots = Object.entries(availableSlots.slots).reduce<
      Record<string, { startTime: string; endTime: string; attendees?: number; bookingUid?: string }[]>
    >((acc, [date, slots]) => {
      acc[date] = (slots as { time: string; attendees?: number; bookingUid?: string }[]).map((slot) => {
        const startTime = new Date(slot.time);
        const endTime = new Date(startTime.getTime() + slotDuration * 60000);
        return {
          startTime: startTime.toISOString(),
          endTime: endTime.toISOString(),
          ...(slot.attendees ? { attendees: slot.attendees } : {}),
          ...(slot.bookingUid ? { bookingUid: slot.bookingUid } : {}),
        };
      });
      return acc;
    }, {});

    return { slots };
  }

  /**
   * Resolves slot duration in minutes from one of the following sources (in priority order):
   * 1. Explicit `duration` parameter if provided.
   * 2. Event type `length` field via {@link EventTypesRepository_2024_04_15.getEventTypeWithDuration}.
   * 3. Throws an `Error` if neither source is available.
   *
   * Called by {@link formatSlots} to determine range end time calculation.
   *
   * @param duration - Optional explicit duration in minutes.
   * @param eventTypeId - Optional event type ID for fallback duration lookup.
   * @returns Duration in minutes.
   * @throws {Error} If neither `duration` nor `eventTypeId` is provided.
   * @throws {Error} If event type is not found for the given `eventTypeId`.
   */
  private async getDuration(duration?: number, eventTypeId?: number): Promise<number> {
    if (duration) {
      return duration;
    }

    if (eventTypeId) {
      const eventType = await this.eventTypesRepository.getEventTypeWithDuration(eventTypeId);
      if (!eventType) {
        throw new Error("Event type not found");
      }
      return eventType.length;
    }

    throw new Error("duration or eventTypeId is required");
  }
}
