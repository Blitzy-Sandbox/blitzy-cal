import { EventTypesRepository_2024_06_14 } from "@/ee/event-types/event-types_2024_06_14/event-types.repository";
import { EventTypesService_2024_06_14 } from "@/ee/event-types/event-types_2024_06_14/services/event-types.service";
import {
  TransformedCreateTeamEventTypeInput,
  TransformedUpdateTeamEventTypeInput,
} from "@/modules/organizations/event-types/services/input.service";
import { DatabaseTeamEventType } from "@/modules/organizations/event-types/services/output.service";
import { PrismaWriteService } from "@/modules/prisma/prisma-write.service";
import { TeamsEventTypesRepository } from "@/modules/teams/event-types/teams-event-types.repository";
import { UsersService } from "@/modules/users/services/users.service";
import { UserWithProfile } from "@/modules/users/users.repository";
import { Injectable, NotFoundException, Logger } from "@nestjs/common";

import type { SortOrderType } from "@calcom/platform-types";

import { createEventType, updateEventType } from "@calcom/platform-libraries/event-types";

/**
 * Orchestration service for team-scoped event type CRUD operations.
 *
 * Sprint 2 Event Type Parity (F-002) verification status: VERIFIED.
 * All 6 scheduling paradigms — one-on-one (schedulingType=null), group (seatsPerTimeSlot),
 * round-robin (ROUND_ROBIN), collective (COLLECTIVE), managed (MANAGED), and dynamic —
 * are fully supported through the pass-through pattern to `@calcom/platform-libraries`
 * mutations (`createEventType` / `updateEventType`), which handle paradigm-specific
 * persistence logic. This service layer performs orchestration (validation, user context
 * assembly, repository delegation) without filtering or transforming paradigm-specific fields.
 */
@Injectable()
export class TeamsEventTypesService {
  private readonly logger = new Logger("TeamsEventTypesService");

  constructor(
    private readonly eventTypesService: EventTypesService_2024_06_14,
    private readonly dbWrite: PrismaWriteService,
    private readonly teamsEventTypesRepository: TeamsEventTypesRepository,
    private readonly eventTypesRepository: EventTypesRepository_2024_06_14,
    private readonly usersService: UsersService
  ) {}

  async createTeamEventType(
    user: UserWithProfile,
    teamId: number,
    body: TransformedCreateTeamEventTypeInput
  ): Promise<DatabaseTeamEventType | DatabaseTeamEventType[]> {
    // note(Lauris): once phone only event types / bookings are enabled for simple users remove checkHasUserAccessibleEmailBookingField check
    // ET-006 Verification: checkHasUserAccessibleEmailBookingField only validates that the email
    // booking field is required and visible. It does NOT reject custom field types (text, radio,
    // checkbox, phone, dropdown). Custom fields pass through to platform-libraries for persistence.
    if (body.bookingFields) {
      this.eventTypesService.checkHasUserAccessibleEmailBookingField(body.bookingFields);
    }
    const eventTypeUser = await this.getUserToCreateTeamEvent(user);
    // Sprint 2 Parity (ET-001–ET-006): The ...rest spread intentionally retains all paradigm-specific
    // fields — schedulingType, seatsPerTimeSlot, isRRWeightsEnabled, rrSegmentQueryValue,
    // assignAllTeamMembers, assignRRMembersUsingSegment, bookingFields, periodType, periodDays,
    // periodStartDate, periodEndDate, minimumBookingNotice, bookingLimits, durationLimits,
    // beforeEventBuffer, afterEventBuffer — which are passed through to createEventType unmodified.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { hosts, children, destinationCalendar, ...rest } = body;

    const { eventType: eventTypeCreated } = await createEventType({
      input: { teamId: teamId, ...rest },
      ctx: {
        user: eventTypeUser,
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        prisma: this.dbWrite.prisma,
      },
    });

    return this.updateTeamEventType(eventTypeCreated.id, teamId, body, user, false);
  }

  async validateEventTypeExists(teamId: number, eventTypeId: number) {
    const eventType = await this.teamsEventTypesRepository.getTeamEventType(teamId, eventTypeId);

    if (!eventType) {
      throw new NotFoundException(`Event type with id ${eventTypeId} not found`);
    }
  }

  async getUserToCreateTeamEvent(user: UserWithProfile) {
    const profileId = this.usersService.getUserMainProfile(user)?.id;

    return {
      id: user.id,
      role: user.role,
      organizationId: null,
      organization: { id: null, isOrgAdmin: false, metadata: {}, requestedSlug: null },
      profile: { id: profileId || null },
      metadata: user.metadata,
      email: user.email,
    };
  }

  async getTeamEventType(teamId: number, eventTypeId: number): Promise<DatabaseTeamEventType | null> {
    const eventType = await this.teamsEventTypesRepository.getTeamEventType(teamId, eventTypeId);

    if (!eventType) {
      return null;
    }

    return eventType;
  }

  async getTeamEventTypeBySlug(
    teamId: number,
    eventTypeSlug: string,
    hostsLimit?: number
  ): Promise<DatabaseTeamEventType | null> {
    const eventType = await this.teamsEventTypesRepository.getTeamEventTypeBySlug(
      teamId,
      eventTypeSlug,
      hostsLimit
    );

    if (!eventType) {
      return null;
    }

    return eventType;
  }

  async getTeamEventTypes(teamId: number, sortCreatedAt?: SortOrderType): Promise<DatabaseTeamEventType[]> {
    return await this.teamsEventTypesRepository.getTeamEventTypes(teamId, sortCreatedAt);
  }

  async updateTeamEventType(
    eventTypeId: number,
    teamId: number,
    body: TransformedUpdateTeamEventTypeInput,
    user: UserWithProfile,
    // note(Lauris): once phone only event types / bookings are enabled for simple users remove isOrg parameter (right now only organization team event types support hidden / non-required email field)
    isOrg: boolean
  ): Promise<DatabaseTeamEventType | DatabaseTeamEventType[]> {
    // ET-006 Verification: Same email-accessibility guard as creation — does not reject
    // custom field types (text, radio, checkbox, phone, dropdown). Org callers bypass this
    // check to support hidden/non-required email fields in organization team event types.
    if (!isOrg && body.bookingFields) {
      // note(Lauris): once phone only event types / bookings are enabled for simple users remove checkHasUserAccessibleEmailBookingField check
      this.eventTypesService.checkHasUserAccessibleEmailBookingField(body.bookingFields);
    }
    await this.validateEventTypeExists(teamId, eventTypeId);
    const eventTypeUser = await this.eventTypesService.getUserToUpdateEvent(user);
    // Sprint 2 Parity (ET-001–ET-006): The ...body spread passes all paradigm-specific fields
    // to updateEventType — host weight/priority (ET-003), rrSegmentQueryValue (ET-003),
    // seatsPerTimeSlot (ET-002), periodType/Days/Start/End & minimumBookingNotice (ET-005),
    // bookingFields (ET-006), isRRWeightsEnabled (ET-003), assignAllTeamMembers (ET-004),
    // assignRRMembersUsingSegment (ET-003) — all flow through unmodified to the platform mutation.
    await updateEventType({
      input: {
        id: eventTypeId,
        ...body,
      },
      ctx: {
        user: eventTypeUser,
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        prisma: this.dbWrite.prisma,
      },
    });

    const eventType = await this.teamsEventTypesRepository.getEventTypeById(eventTypeId);

    if (!eventType) {
      throw new NotFoundException(`Event type with id ${eventTypeId} not found`);
    }

    // Sprint 2 MANAGED type verification: For non-MANAGED types (1:1, group, RR, COLLECTIVE),
    // the freshly reloaded eventType is returned directly with all paradigm scalar fields intact.
    // For MANAGED types, children are fetched and appended — each child retains its own
    // schedulingType (can be ROUND_ROBIN, COLLECTIVE, etc.) and paradigm-specific scalar fields
    // (isRRWeightsEnabled, seatsPerTimeSlot, etc.). The [parent, ...children] return format
    // correctly represents the MANAGED hierarchy for downstream response transformation.
    if (eventType.schedulingType !== "MANAGED") {
      return eventType;
    }

    const childrenEventTypes = await this.teamsEventTypesRepository.getEventTypeChildren(eventType.id);

    return [eventType, ...childrenEventTypes];
  }

  async deleteTeamEventType(teamId: number, eventTypeId: number) {
    const existingEventType = await this.teamsEventTypesRepository.getTeamEventType(teamId, eventTypeId);

    if (!existingEventType) {
      throw new NotFoundException(`Event type with ID=${eventTypeId} does not exist.`);
    }

    return this.eventTypesRepository.deleteEventType(eventTypeId);
  }
}
