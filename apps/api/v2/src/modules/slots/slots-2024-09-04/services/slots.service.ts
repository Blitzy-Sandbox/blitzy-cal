import { EventTypesRepository_2024_06_14 } from "@/ee/event-types/event-types_2024_06_14/event-types.repository";
import { AvailableSlotsService } from "@/lib/services/available-slots.service";
import { MembershipsRepository } from "@/modules/memberships/memberships.repository";
import { MembershipsService } from "@/modules/memberships/services/memberships.service";
import { TimeSlots } from "@/modules/slots/slots-2024-04-15/services/slots-output.service";
import {
  SlotsInputService_2024_09_04,
  InternalGetSlotsQuery,
  InternalGetSlotsQueryWithRouting,
} from "@/modules/slots/slots-2024-09-04/services/slots-input.service";
import { SlotsOutputService_2024_09_04 } from "@/modules/slots/slots-2024-09-04/services/slots-output.service";
import { SlotsRepository_2024_09_04 } from "@/modules/slots/slots-2024-09-04/slots.repository";
import { TeamsRepository } from "@/modules/teams/teams/teams.repository";
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { DateTime } from "luxon";
import { z } from "zod";

import { SlotFormat } from "@calcom/platform-enums";
import { SchedulingType } from "@calcom/platform-libraries";
import { validateRoundRobinSlotAvailability } from "@calcom/platform-libraries/slots";
import type {
  GetSlotsInput_2024_09_04,
  GetSlotsInputWithRouting_2024_09_04,
  ReserveSlotInput_2024_09_04,
} from "@calcom/platform-types";
import type { EventType } from "@calcom/prisma/client";

const eventTypeMetadataSchema = z
  .object({
    multipleDuration: z.number().array().optional(),
  })
  .nullable();

const DEFAULT_RESERVATION_DURATION = 5;

type InternalSlotsQuery = InternalGetSlotsQuery | InternalGetSlotsQueryWithRouting;

/**
 * Main business logic service for the 2024-09-04 versioned Slots API.
 *
 * Orchestrates the full slot availability and reservation lifecycle:
 * 1. **Query transformation** — {@link SlotsInputService_2024_09_04} normalizes external DTOs
 *    (`GetSlotsInput_2024_09_04`, `GetSlotsInputWithRouting_2024_09_04`) into internal query shapes.
 * 2. **Availability computation** — {@link AvailableSlotsService} delegates to the platform
 *    availability engine (`getAvailableSlots`) to produce raw time-slot data.
 * 3. **DTO formatting** — {@link SlotsOutputService_2024_09_04} converts raw slots into the
 *    versioned API response format, respecting the requested `SlotFormat` and time zone.
 *
 * Reservation CRUD operations (reserve / get / update / delete) delegate persistence to
 * {@link SlotsRepository_2024_09_04} which manages `SelectedSlots` rows in the database.
 *
 * **Constructor dependencies** (8 total):
 * - `eventTypeRepository` — Event type lookups including host resolution
 * - `slotsRepository` — SelectedSlots persistence (create, read, update, delete, overlap checks)
 * - `slotsOutputService` — Response DTO formatting for slots and reservations
 * - `slotsInputService` — Query DTO normalization for standard and routing-aware requests
 * - `membershipsService` — Shared membership checks for permission enforcement
 * - `membershipsRepository` — Direct membership lookups by team/org
 * - `teamsRepository` — Team and organization hierarchy lookups
 * - `availableSlotsService` — Platform availability engine integration
 *
 * **Key design decisions:**
 * - The module-level `eventTypeMetadataSchema` (Zod) validates the `multipleDuration` array
 *   for variable-length event types at the API boundary (Rule 0.7.1).
 * - Error translation converts platform-level "Invalid time range given" errors into HTTP
 *   `BadRequestException` responses with actionable messages.
 * - Round-robin slot validation uses `validateRoundRobinSlotAvailability` from
 *   `@calcom/platform-libraries/slots` to ensure at least one host remains available.
 * - Custom reservation duration permission follows a strict hierarchy:
 *   user ownership → shared memberships → team membership → org membership.
 *
 * Exported by `SlotsModule_2024_09_04` and consumed by `SlotsController_2024_09_04`.
 */
@Injectable()
export class SlotsService_2024_09_04 {
  constructor(
    private readonly eventTypeRepository: EventTypesRepository_2024_06_14,
    private readonly slotsRepository: SlotsRepository_2024_09_04,
    private readonly slotsOutputService: SlotsOutputService_2024_09_04,
    private readonly slotsInputService: SlotsInputService_2024_09_04,
    private readonly membershipsService: MembershipsService,
    private readonly membershipsRepository: MembershipsRepository,
    private readonly teamsRepository: TeamsRepository,
    private readonly availableSlotsService: AvailableSlotsService
  ) {}

  /**
   * Fetches available time slots from the platform availability engine and formats
   * them into the versioned API response shape.
   *
   * Delegation pipeline:
   * 1. Calls {@link AvailableSlotsService.getAvailableSlots} with the transformed
   *    internal query to obtain raw `TimeSlots` data.
   * 2. Passes the raw slots through {@link SlotsOutputService_2024_09_04.getAvailableSlots}
   *    for DTO formatting, applying the requested `SlotFormat` and time zone.
   *
   * Error translation: If the platform engine throws an error whose message includes
   * "Invalid time range given", it is caught and re-thrown as a NestJS
   * `BadRequestException` with guidance to check the `start` and `end` query parameters.
   * All other errors are re-thrown unmodified.
   *
   * @param queryTransformed - The normalized internal slots query (standard or routing-aware)
   * @param format - Optional slot format override (e.g., JSON or iCal)
   * @returns Formatted available slots in the versioned response shape
   * @throws {BadRequestException} When the platform reports an invalid time range
   */
  private async fetchAndFormatSlots(queryTransformed: InternalSlotsQuery, format?: SlotFormat) {
    try {
      const availableSlots: TimeSlots = await this.availableSlotsService.getAvailableSlots({
        input: queryTransformed,
        ctx: {},
      });

      const formatted = await this.slotsOutputService.getAvailableSlots(
        availableSlots,
        queryTransformed.eventTypeId,
        queryTransformed.duration,
        format,
        queryTransformed.timeZone
      );

      return formatted;
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes("Invalid time range given")) {
          throw new BadRequestException(
            "Invalid time range given - check the 'start' and 'end' query parameters."
          );
        }
      }
      throw error;
    }
  }

  /**
   * Non-routing entry point for fetching available time slots.
   *
   * Transforms the external `GetSlotsInput_2024_09_04` DTO into an internal query via
   * {@link SlotsInputService_2024_09_04.transformGetSlotsQuery}, then delegates to
   * {@link fetchAndFormatSlots} for availability computation and DTO formatting.
   *
   * @param query - The external slots query DTO with event type, date range, and format
   * @returns Formatted available slots in the versioned response shape
   * @throws {BadRequestException} When the platform reports an invalid time range
   */
  async getAvailableSlots(query: GetSlotsInput_2024_09_04) {
    const queryTransformed = await this.slotsInputService.transformGetSlotsQuery(query);
    return this.fetchAndFormatSlots(queryTransformed, query.format);
  }

  /**
   * Routing-aware entry point for fetching available time slots.
   *
   * Transforms the external `GetSlotsInputWithRouting_2024_09_04` DTO — which includes
   * routing form metadata — into an internal query via
   * {@link SlotsInputService_2024_09_04.transformRoutingGetSlotsQuery}, then delegates to
   * {@link fetchAndFormatSlots} for availability computation and DTO formatting.
   *
   * @param query - The routing-aware external slots query DTO with routing form responses
   * @returns Formatted available slots in the versioned response shape
   * @throws {BadRequestException} When the platform reports an invalid time range
   */
  async getAvailableSlotsWithRouting(query: GetSlotsInputWithRouting_2024_09_04) {
    const queryTransformed = await this.slotsInputService.transformRoutingGetSlotsQuery(query);
    return this.fetchAndFormatSlots(queryTransformed, query.format);
  }

  /**
   * Reserves a time slot for a given event type, executing the full validation pipeline.
   *
   * Reservation pipeline steps:
   * 1. **Auth guard** — If `reservationDuration` is specified, an authenticated user is required;
   *    otherwise throws `UnauthorizedException`.
   * 2. **Event type fetch** — Retrieves the event type with hosts; throws `NotFoundException` if missing.
   * 3. **Permission check** — If a custom `reservationDuration` is requested, verifies the
   *    authenticated user has permission via {@link canSpecifyCustomReservationDuration};
   *    throws `ForbiddenException` on denial.
   * 4. **Start date parsing** — Parses `slotStart` via Luxon in UTC; throws `BadRequestException`
   *    if invalid.
   * 5. **Slot duration validation** — If `slotDuration` is provided, validates it against the
   *    event type's `multipleDuration` via {@link validateSlotDuration}.
   * 6. **End date computation** — Calculates the slot end as `startDate + (slotDuration ?? eventType.length)`.
   * 7. **Overlap booking check** — Queries for active overlapping bookings in the time window.
   * 8. **Seated event check** — For seated events, verifies remaining seat capacity;
   *    throws `UnprocessableEntityException` if no seats remain.
   * 9. **Non-seated already-booked check** — For non-seated, non-round-robin events with an
   *    existing booking, throws `UnprocessableEntityException`.
   * 10. **Round-robin validation** — For round-robin events, delegates to
   *     `validateRoundRobinSlotAvailability` from `@calcom/platform-libraries/slots`;
   *     throws `UnprocessableEntityException` if no hosts are available.
   * 11. **Non-round-robin overlap check** — For standard events, checks for overlapping
   *     slot reservations via {@link checkSlotOverlap}.
   * 12. **Slot creation** — Creates a `SelectedSlots` row for either the user-owned event
   *     or the first team host, using the specified or default reservation duration
   *     ({@link DEFAULT_RESERVATION_DURATION} = 5 minutes).
   *
   * @param input - The reservation input DTO with event type ID, slot start, and optional duration/reservation settings
   * @param authUserId - Optional authenticated user ID (required for custom reservation durations)
   * @returns The created reservation slot in the versioned response shape
   * @throws {UnauthorizedException} When reservationDuration is used without authentication
   * @throws {NotFoundException} When the event type does not exist
   * @throws {ForbiddenException} When the user lacks permission for custom reservation durations
   * @throws {BadRequestException} When start/end dates are invalid or slot duration is not allowed
   * @throws {UnprocessableEntityException} When the slot is already booked, has no seats, or no round-robin hosts are available
   */
  async reserveSlot(input: ReserveSlotInput_2024_09_04, authUserId?: number) {
    if (input.reservationDuration && !authUserId) {
      throw new UnauthorizedException(
        "reservationDuration can only be used for authenticated requests - use access token, api key or OAuth credentials"
      );
    }

    const eventType = await this.eventTypeRepository.getEventTypeWithHosts(input.eventTypeId);
    if (!eventType) {
      throw new NotFoundException(`Event Type with ID=${input.eventTypeId} not found`);
    }

    if (input.reservationDuration && authUserId) {
      const canSpecifyCustomReservationDuration = await this.canSpecifyCustomReservationDuration(
        authUserId,
        eventType
      );
      if (!canSpecifyCustomReservationDuration) {
        throw new ForbiddenException(
          "authenticated user is not owner of event type, does not have memberships in common with owner of the event type, nor does belong to event type's team or org."
        );
      }
    }

    const startDate = DateTime.fromISO(input.slotStart, { zone: "utc" });
    if (!startDate.isValid) {
      throw new BadRequestException("Invalid start date");
    }

    if (input.slotDuration) {
      this.validateSlotDuration(eventType, input.slotDuration);
    }

    const endDate = startDate.plus({ minutes: input.slotDuration ?? eventType.length });
    if (!endDate.isValid) {
      throw new BadRequestException("Invalid end date");
    }

    const booking = await this.slotsRepository.findActiveOverlappingBooking(
      input.eventTypeId,
      startDate.toJSDate(),
      endDate.toJSDate()
    );

    if (eventType.seatsPerTimeSlot) {
      const attendeesCount = booking?.attendees?.length;
      if (attendeesCount) {
        const seatsLeft = eventType.seatsPerTimeSlot - attendeesCount;
        if (seatsLeft < 1) {
          throw new UnprocessableEntityException(
            `Booking with id=${input.eventTypeId} at ${input.slotStart} has no more seats left.`
          );
        }
      }
    }

    const nonSeatedEventAlreadyBooked = !eventType.seatsPerTimeSlot && booking;
    const isRoundRobinEvent = eventType.schedulingType === SchedulingType.ROUND_ROBIN;

    if (nonSeatedEventAlreadyBooked && !isRoundRobinEvent) {
      throw new UnprocessableEntityException(`Can't reserve a slot if the event is already booked.`);
    }

    if (isRoundRobinEvent) {
      try {
        await validateRoundRobinSlotAvailability(input.eventTypeId, startDate, endDate, eventType.hosts);
      } catch (error) {
        if (error instanceof Error) {
          throw new UnprocessableEntityException(error?.message);
        }
        throw error;
      }
    } else {
      await this.checkSlotOverlap(input.eventTypeId, startDate.toISO(), endDate.toISO());
    }

    const reservationDuration = input.reservationDuration ?? DEFAULT_RESERVATION_DURATION;

    if (eventType.userId) {
      const slot = await this.slotsRepository.createSlot(
        eventType.userId,
        eventType.id,
        startDate.toISO(),
        endDate.toISO(),
        eventType.seatsPerTimeSlot !== null,
        reservationDuration
      );
      return this.slotsOutputService.getReservationSlotCreated(slot, reservationDuration);
    }

    const host = eventType.hosts[0];
    if (!host) {
      throw new BadRequestException("Cannot reserve a slot for a team event without any hosts");
    }

    const slot = await this.slotsRepository.createSlot(
      host.userId,
      eventType.id,
      startDate.toISO(),
      endDate.toISO(),
      eventType.seatsPerTimeSlot !== null,
      reservationDuration
    );

    return this.slotsOutputService.getReservationSlotCreated(slot, reservationDuration);
  }

  /**
   * Checks for overlapping slot reservations within the given time window for a specific event type.
   *
   * Queries the slots repository for any existing `SelectedSlots` reservation that overlaps
   * with the provided start/end range. If an overlap is found, throws an
   * `UnprocessableEntityException` to prevent double-reservations.
   *
   * @param eventTypeId - The event type ID to check reservations against
   * @param startDate - ISO 8601 UTC start date string of the candidate slot
   * @param endDate - ISO 8601 UTC end date string of the candidate slot
   * @throws {UnprocessableEntityException} When an overlapping reservation already exists
   */
  private async checkSlotOverlap(eventTypeId: number, startDate: string, endDate: string) {
    const overlappingReservation = await this.slotsRepository.getOverlappingSlotReservation(
      eventTypeId,
      startDate,
      endDate
    );

    if (overlappingReservation) {
      throw new UnprocessableEntityException(
        `This time slot is already reserved by another user. Please choose a different time.`
      );
    }
  }

  /**
   * Validates the requested slot duration against the event type's allowed variable durations.
   *
   * Uses the module-level `eventTypeMetadataSchema` (Zod) to parse the event type's metadata
   * and extract the `multipleDuration` array. Validation enforces two constraints:
   * 1. The event type must be a variable-length type (i.e., `multipleDuration` must exist).
   * 2. The requested `inputSlotDuration` must be one of the allowed values in `multipleDuration`.
   *
   * @param eventType - The event type entity whose metadata contains duration options
   * @param inputSlotDuration - The requested slot duration in minutes
   * @throws {BadRequestException} When the event type is not variable-length or the duration is not allowed
   */
  validateSlotDuration(eventType: EventType, inputSlotDuration: number) {
    const eventTypeMetadata = eventTypeMetadataSchema.parse(eventType.metadata);
    if (!eventTypeMetadata?.multipleDuration) {
      throw new BadRequestException(
        "You passed 'slotDuration' but this event type is not a variable length event type."
      );
    }

    if (!eventTypeMetadata.multipleDuration.includes(inputSlotDuration)) {
      throw new BadRequestException(
        `Provided 'slotDuration' is not one of the possible lengths for the event type. The possible lengths for this variable length event type are: ${eventTypeMetadata.multipleDuration.join(
          ", "
        )}`
      );
    }
  }

  /**
   * Determines whether the authenticated user is permitted to specify a custom reservation duration.
   *
   * Implements a hierarchical permission check:
   * - **Individual events** (event type has `userId`): delegates to
   *   {@link canSpecifyCustomReservationDurationIndividualEvent} which checks direct ownership
   *   or shared organization memberships.
   * - **Team events** (event type has `teamId`): delegates to
   *   {@link canSpecifyCustomReservationDurationTeamEvent} which checks accepted team membership,
   *   falling back to accepted organization membership if the team has a parent org.
   * - Returns `false` if the event type has neither `userId` nor `teamId`.
   *
   * @param authUserId - The authenticated user's ID
   * @param eventType - The event type entity to check permissions against
   * @returns `true` if the user is permitted to set a custom reservation duration
   */
  async canSpecifyCustomReservationDuration(authUserId: number, eventType: EventType) {
    if (eventType.userId) {
      return await this.canSpecifyCustomReservationDurationIndividualEvent(authUserId, eventType.userId);
    }
    if (eventType.teamId) {
      return await this.canSpecifyCustomReservationDurationTeamEvent(authUserId, eventType.teamId);
    }
    return false;
  }

  /**
   * Checks custom reservation duration permission for an individual (user-owned) event type.
   *
   * Permission is granted if:
   * 1. The authenticated user is the direct owner of the event type (`authUserId === eventTypeOwnerId`), OR
   * 2. The authenticated user and the event type owner share at least one common organization membership
   *    (verified via {@link MembershipsService.haveMembershipsInCommon}).
   *
   * @param authUserId - The authenticated user's ID
   * @param eventTypeOwnerId - The user ID of the event type owner
   * @returns `true` if the user is the owner or shares memberships with the owner
   */
  async canSpecifyCustomReservationDurationIndividualEvent(authUserId: number, eventTypeOwnerId: number) {
    if (authUserId === eventTypeOwnerId) return true;
    if (await this.membershipsService.haveMembershipsInCommon(authUserId, eventTypeOwnerId)) return true;
    return false;
  }

  /**
   * Checks custom reservation duration permission for a team-hosted event type.
   *
   * Permission is granted through a two-level check:
   * 1. **Team membership** — The user has an accepted membership in the team that owns the event type.
   * 2. **Organization fallback** — If the team has a parent organization (`team.parentId`), the user
   *    has an accepted membership in that parent organization.
   *
   * Returns `false` if neither condition is satisfied or if the team has no parent org and
   * team membership is absent.
   *
   * @param authUserId - The authenticated user's ID
   * @param teamId - The team ID that owns the event type
   * @returns `true` if the user has an accepted team or parent-org membership
   */
  async canSpecifyCustomReservationDurationTeamEvent(authUserId: number, teamId: number) {
    const teamMembership = await this.membershipsRepository.findMembershipByTeamId(teamId, authUserId);
    const hasAcceptedTeamMembership = !!teamMembership?.accepted;
    if (hasAcceptedTeamMembership) return true;

    const team = await this.teamsRepository.getById(teamId);
    if (!team?.parentId) {
      return false;
    }
    const orgMembership = await this.membershipsRepository.findMembershipByTeamId(team.parentId, authUserId);
    const hasAcceptedOrgMembership = !!orgMembership?.accepted;
    return hasAcceptedOrgMembership;
  }

  /**
   * Retrieves a reserved slot by its unique identifier.
   *
   * Looks up the `SelectedSlots` row via {@link SlotsRepository_2024_09_04.getByUid}.
   * If found, formats it into the versioned reservation response via
   * {@link SlotsOutputService_2024_09_04.getReservationSlot}. Returns `null` if no
   * slot exists with the given UID.
   *
   * @param uid - The unique identifier of the reserved slot
   * @returns The formatted reservation slot, or `null` if not found
   */
  async getReservedSlot(uid: string) {
    const slot = await this.slotsRepository.getByUid(uid);
    if (!slot) {
      return null;
    }
    return this.slotsOutputService.getReservationSlot(slot);
  }

  /**
   * Updates an existing reserved slot with new time/duration parameters.
   *
   * Executes a validation pipeline similar to {@link reserveSlot}:
   * 1. **Slot lookup** — Verifies the slot exists by UID; throws `NotFoundException` if missing.
   * 2. **Event type fetch** — Retrieves the event type with hosts; throws `NotFoundException` if missing.
   * 3. **Start date parsing** — Parses `slotStart` via Luxon in UTC; throws `BadRequestException` if invalid.
   * 4. **Slot duration validation** — If `slotDuration` is provided, validates against `multipleDuration`.
   * 5. **End date computation** — Calculates `startDate + (slotDuration ?? eventType.length)`.
   * 6. **Overlap booking check** — Queries for active overlapping bookings in the new time window.
   * 7. **Seated event check** — Verifies remaining seat capacity for seated events.
   * 8. **Non-seated already-booked check** — Rejects updates to already-booked non-seated events.
   * 9. **Slot overlap check** — Verifies no other reservation overlaps the new time window.
   * 10. **Slot update** — Persists the updated slot via {@link SlotsRepository_2024_09_04.updateSlot}.
   *
   * @param input - The reservation input DTO with updated event type ID, slot start, and optional duration settings
   * @param uid - The unique identifier of the existing reserved slot to update
   * @returns The updated reservation slot in the versioned response shape
   * @throws {NotFoundException} When the slot or event type does not exist
   * @throws {BadRequestException} When start/end dates are invalid or slot duration is not allowed
   * @throws {UnprocessableEntityException} When the new time window is already booked or has no seats
   */
  async updateReservedSlot(input: ReserveSlotInput_2024_09_04, uid: string) {
    const dbSlot = await this.slotsRepository.getByUid(uid);
    if (!dbSlot) {
      throw new NotFoundException(`Slot with uid=${uid} not found`);
    }

    const eventType = await this.eventTypeRepository.getEventTypeWithHosts(input.eventTypeId);
    if (!eventType) {
      throw new NotFoundException(`Event Type with ID=${input.eventTypeId} not found`);
    }

    const startDate = DateTime.fromISO(input.slotStart, { zone: "utc" });
    if (!startDate.isValid) {
      throw new BadRequestException("Invalid start date");
    }

    if (input.slotDuration) {
      this.validateSlotDuration(eventType, input.slotDuration);
    }

    const endDate = startDate.plus({ minutes: input.slotDuration ?? eventType.length });
    if (!endDate.isValid) {
      throw new BadRequestException("Invalid end date");
    }

    const booking = await this.slotsRepository.findActiveOverlappingBooking(
      input.eventTypeId,
      startDate.toJSDate(),
      endDate.toJSDate()
    );

    if (eventType.seatsPerTimeSlot) {
      const attendeesCount = booking?.attendees?.length;
      if (attendeesCount) {
        const seatsLeft = eventType.seatsPerTimeSlot - attendeesCount;
        if (seatsLeft < 1) {
          throw new UnprocessableEntityException(
            `Booking with id=${input.eventTypeId} at ${input.slotStart} has no more seats left.`
          );
        }
      }
    }

    const nonSeatedEventAlreadyBooked = !eventType.seatsPerTimeSlot && booking;
    if (nonSeatedEventAlreadyBooked) {
      throw new UnprocessableEntityException(`Can't reserve a slot if the event is already booked.`);
    }

    const reservationDuration = input.reservationDuration ?? DEFAULT_RESERVATION_DURATION;

    await this.checkSlotOverlap(input.eventTypeId, startDate.toISO(), endDate.toISO());

    const slot = await this.slotsRepository.updateSlot(
      eventType.id,
      startDate.toISO(),
      endDate.toISO(),
      dbSlot.id,
      reservationDuration
    );

    return this.slotsOutputService.getReservationSlotCreated(slot, reservationDuration);
  }

  /**
   * Deletes a reserved slot by its unique identifier.
   *
   * Delegates directly to {@link SlotsRepository_2024_09_04.deleteSlot} to remove the
   * `SelectedSlots` row from the database. No additional validation is performed beyond
   * the repository-level UID lookup.
   *
   * @param uid - The unique identifier of the reserved slot to delete
   * @returns The result of the repository deletion operation
   */
  async deleteReservedSlot(uid: string) {
    return this.slotsRepository.deleteSlot(uid);
  }
}
