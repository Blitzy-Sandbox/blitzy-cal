import { Injectable, PipeTransform } from "@nestjs/common";
import { plainToClass } from "class-transformer";

import { EventTypeOutput_2024_06_14 } from "@calcom/platform-types";

import {
  DatabaseEventType,
  OutputEventTypesService_2024_06_14,
} from "../services/output-event-types.service";

/**
 * Represents a personal event type record enriched with the owner identifier.
 *
 * `DatabaseEventType` is the FULL Prisma `EventType` model intersected with
 * `EventTypeRelations` (users, schedule, destinationCalendar, calVideoSettings).
 * It carries ALL paradigm-specific scalar columns — including group/seated fields
 * (`seatsPerTimeSlot`, `seatsShowAttendees`, `seatsShowAvailabilityCount`), booking
 * window fields (`periodType`, `periodDays`, `periodStartDate`, `periodEndDate`,
 * `periodCountCalendarDays`), custom booking questions (`bookingFields`), and notice
 * thresholds (`minimumBookingNotice`).
 *
 * This type is the entry point for **personal** event types only (ET-001 1:1 and
 * ET-002 group/seated). Team event types (round-robin ET-003, collective ET-004,
 * managed) are dispatched to `OutputTeamEventTypesResponsePipe` by the controller
 * before reaching this pipe.
 */
type EventTypeResponse = DatabaseEventType & { ownerId: number };

@Injectable()
export class EventTypeResponseTransformPipe implements PipeTransform {
  constructor(private readonly outputEventTypesService: OutputEventTypesService_2024_06_14) {}

  /**
   * Transforms a single personal event type database record into the versioned
   * `EventTypeOutput_2024_06_14` API response DTO.
   *
   * Paradigm-specific field transformations performed by the underlying service:
   *
   * - **ET-001 (1:1):** Basic scalar fields (title, slug, description, length,
   *   locations, etc.) pass through directly — this is the default personal path
   *   where `schedulingType` is `null`.
   * - **ET-002 (Group/Seated):** `seatsPerTimeSlot`, `seatsShowAttendees`, and
   *   `seatsShowAvailabilityCount` are transformed into a unified `seats` property
   *   via `transformSeats()`.
   * - **ET-005 (Booking Windows):** `periodType`, `periodDays`, `periodStartDate`,
   *   `periodEndDate`, and `periodCountCalendarDays` are transformed into a
   *   `bookingWindow` property via `transformBookingWindow()`. The
   *   `minimumBookingNotice` value passes through as a direct numeric property.
   * - **ET-006 (Custom Fields):** `bookingFields` JSON is parsed and transformed
   *   into an `OutputBookingField_2024_06_14[]` array via `transformBookingFields()`,
   *   supporting all Calendly-parity question types (text, radio, checkbox, phone,
   *   dropdown, and additional Cal.com types).
   *
   * @param eventType - The personal event type record with `ownerId` attached.
   * @returns The versioned DTO with all paradigm fields correctly transformed.
   *
   * @remarks
   * The third argument to `getResponseEventType` is `isOrgTeamEvent = false`,
   * which is correct for personal (non-team) event types. The `strategy: "exposeAll"`
   * option on `plainToClass` ensures every property returned by the service is
   * preserved on the class instance, preventing accidental field stripping by
   * `class-transformer` decorators.
   */
  private transformEventType(eventType: EventTypeResponse): EventTypeOutput_2024_06_14 {
    return plainToClass(
      EventTypeOutput_2024_06_14,
      this.outputEventTypesService.getResponseEventType(eventType.ownerId, eventType, false),
      { strategy: "exposeAll" }
    );
  }

  /**
   * PipeTransform implementation with function overloads ensuring type-safe
   * handling of both single-record and array inputs.
   *
   * Both overload paths delegate to the shared `transformEventType` method,
   * producing identical per-record output regardless of whether a single
   * `EventTypeResponse` or an array is provided. This guarantees consistent
   * paradigm-specific field transformation across all controller call sites.
   */
  transform(value: EventTypeResponse[]): EventTypeOutput_2024_06_14[];

  transform(value: EventTypeResponse): EventTypeOutput_2024_06_14;

  transform(
    value: EventTypeResponse | EventTypeResponse[]
  ): EventTypeOutput_2024_06_14 | EventTypeOutput_2024_06_14[] {
    if (Array.isArray(value)) {
      return value.map((item) => this.transformEventType(item));
    } else {
      return this.transformEventType(value);
    }
  }
}
