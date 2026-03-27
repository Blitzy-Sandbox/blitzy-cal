import { DEFAULT_EVENT_TYPES } from "@/ee/event-types/event-types_2024_06_14/constants/constants";
import { EventTypesRepository_2024_06_14 } from "@/ee/event-types/event-types_2024_06_14/event-types.repository";
import { DatabaseEventType } from "@/ee/event-types/event-types_2024_06_14/services/output-event-types.service";
import { InputEventTransformed_2024_06_14 } from "@/ee/event-types/event-types_2024_06_14/transformed";
import { SystemField, CustomField } from "@/ee/event-types/event-types_2024_06_14/transformers";
import { SchedulesRepository_2024_06_11 } from "@/ee/schedules/schedules_2024_06_11/schedules.repository";
import { AuthOptionalUser } from "@/modules/auth/decorators/get-optional-user/get-optional-user.decorator";
import { ApiAuthGuardUser } from "@/modules/auth/strategies/api-auth/api-auth.strategy";
import { EventTypeAccessService } from "@/modules/event-types/services/event-type-access.service";
import { MembershipsRepository } from "@/modules/memberships/memberships.repository";
import { DatabaseTeamEventType } from "@/modules/organizations/event-types/services/output.service";
import { PrismaWriteService } from "@/modules/prisma/prisma-write.service";
import { SelectedCalendarsRepository } from "@/modules/selected-calendars/selected-calendars.repository";
import { UsersService } from "@/modules/users/services/users.service";
import { UserWithProfile, UsersRepository } from "@/modules/users/users.repository";
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";

import { dynamicEvent } from "@calcom/platform-libraries";
import {
  createEventType,
  updateEventType,
  getEventTypesPublic,
  EventTypesPublic,
} from "@calcom/platform-libraries/event-types";
import type { GetEventTypesQuery_2024_06_14, SortOrderType } from "@calcom/platform-types";
import type { EventType } from "@calcom/prisma/client";

/**
 * EventTypesService_2024_06_14 — Primary domain service for personal (user-scoped) event type
 * orchestration across the API v2 2024-06-14 contract.
 *
 * Paradigm coverage handled directly by this service:
 *  - **1:1 (one-on-one)** — schedulingType is null; default flow for personal event types (ET-001).
 *  - **Group (seated)** — seatsPerTimeSlot > 0 passes through the body into the platform-library
 *    create/update helpers. Seat-related fields (seatsPerTimeSlot, seatsShowAttendees,
 *    seatsShowAvailabilityCount) are part of InputEventTransformed_2024_06_14 (ET-002).
 *  - **Dynamic (multi-user link)** — handled via getDynamicEventType using the dynamicEvent template
 *    from @calcom/platform-libraries.
 *
 * Paradigms delegated to TeamsEventTypesService / OrganizationEventTypesService:
 *  - **Round-Robin (SchedulingType.ROUND_ROBIN)** — ET-003: host weights, priorities, segment-based
 *    filtering, and equitable distribution are managed through team service flows.
 *  - **Collective (SchedulingType.COLLECTIVE)** — ET-004: mutual availability intersection logic is
 *    handled via team service flows and the aggregated availability engine.
 *  - **Managed (SchedulingType.MANAGED)** — parent/child event type propagation for organization
 *    admins is handled through the organization event types service.
 *
 * This service wires repositories (event types, memberships, users, selected calendars, schedules)
 * with @calcom/platform-libraries helpers and the EventTypeAccessService. All Zod validation occurs
 * upstream in InputEventTypesService_2024_06_14 — this service focuses on authorization, ownership,
 * and orchestration of the platform-library create/update helpers.
 */
@Injectable()
export class EventTypesService_2024_06_14 {
  constructor(
    private readonly eventTypesRepository: EventTypesRepository_2024_06_14,
    private readonly membershipsRepository: MembershipsRepository,
    private readonly usersRepository: UsersRepository,
    private readonly usersService: UsersService,
    private readonly selectedCalendarsRepository: SelectedCalendarsRepository,
    private readonly dbWrite: PrismaWriteService,
    private readonly schedulesRepository: SchedulesRepository_2024_06_11,
    private readonly eventTypeAccessService: EventTypeAccessService
  ) {}

  /**
   * Creates a personal (user-scoped) event type for the given user.
   *
   * Paradigm support (ET-001, ET-002):
   *  - **1:1 events**: schedulingType defaults to null — the standard personal event flow.
   *  - **Group (seated) events**: seatsPerTimeSlot, seatsShowAttendees, and
   *    seatsShowAvailabilityCount are included in InputEventTransformed_2024_06_14 and pass through
   *    the `...rest` spread into createEventType, then the full `...body` spread into updateEventType.
   *  - **Team paradigms (RR, collective, managed)**: NOT created through this method — those flows
   *    are handled by TeamsEventTypesService which enforces teamId, hosts, and scheduling type.
   *
   * Booking window fields (ET-005) — periodType, periodDays, periodStartDate, periodEndDate,
   * periodCountCalendarDays, minimumBookingNotice — all pass through `...rest` / `...body`.
   *
   * Custom booking fields (ET-006) — validated via checkHasUserAccessibleEmailBookingField to ensure
   * the email system field remains required and visible. Custom field types (text, radio, checkbox,
   * phone, dropdown) are not blocked by this validation.
   *
   * Implementation note: destinationCalendar is extracted from the body and excluded from the initial
   * createEventType call (which doesn't support it), but IS included in the subsequent updateEventType
   * call via the full `...body` spread.
   */
  async createUserEventType(user: UserWithProfile, body: InputEventTransformed_2024_06_14) {
    if (body.bookingFields) {
      this.checkHasUserAccessibleEmailBookingField(body.bookingFields);
    }
    await this.checkCanCreateEventType(user.id, body);
    const eventTypeUser = await this.getUserToCreateEvent(user);

    // destinationCalendar is excluded from the initial create call — the platform-library
    // createEventType helper does not accept it. It is applied in the subsequent updateEventType call.
    const { destinationCalendar: _destinationCalendar, ...rest } = body;

    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    const { eventType: eventTypeCreated } = await createEventType({
      // rest includes all paradigm-specific fields: seatsPerTimeSlot, booking windows, custom fields,
      // recurrence, booking limits, and other InputEventTransformed_2024_06_14 properties.
      input: rest,
      ctx: {
        user: eventTypeUser,
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        prisma: this.dbWrite.prisma,
      },
    });

    await updateEventType({
      input: {
        id: eventTypeCreated.id,
        // Full body spread: includes destinationCalendar and all paradigm-specific fields.
        ...body,
      },
      ctx: {
        user: eventTypeUser,
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        prisma: this.dbWrite.prisma,
      },
    });

    const eventType = await this.eventTypesRepository.getEventTypeById(eventTypeCreated.id);

    if (!eventType) {
      throw new NotFoundException(`Event type with id ${eventTypeCreated.id} not found`);
    }

    return {
      ownerId: user.id,
      ...eventType,
    };
  }

  /**
   * Retrieves an event type by ID with authorization check.
   *
   * Works for ALL paradigm types — authorization is delegated to EventTypeAccessService which
   * handles personal (userId-based), team (teamId-based, including RR/collective), managed
   * (parentId-based), and organization-level access checks. The cast to `EventType` on the
   * access check is safe because EventTypeAccessService only reads `id`, `userId`, and `teamId`
   * for authorization — paradigm-specific fields on the full database record are preserved in the
   * returned object via the spread operator.
   */
  async getEventTypeByIdIfAuthorized(
    authUser: ApiAuthGuardUser,
    eventTypeId: number
  ): Promise<DatabaseTeamEventType | ({ ownerId: number } & DatabaseEventType) | null> {
    const eventType = await this.eventTypesRepository.getEventTypeByIdWithHosts(eventTypeId);

    if (!eventType) {
      return null;
    }

    // Cast is safe: EventTypeAccessService.userIsEventTypeAdminOrOwner reads only id, userId,
    // and teamId from the EventType — paradigm-specific fields are not accessed during auth.
    const hasAccess = await this.eventTypeAccessService.userIsEventTypeAdminOrOwner(
      authUser,
      eventType as unknown as EventType
    );

    if (!hasAccess) {
      return null;
    }

    return {
      ownerId: eventType.userId ?? 0,
      ...eventType,
    };
  }

  /**
   * Pre-creation validation: slug uniqueness (user-scoped) and schedule ownership.
   *
   * Slug uniqueness is scoped to the individual user (userId) — team-scoped slug uniqueness
   * is enforced separately in TeamsEventTypesService. This is correct because personal event
   * types and team event types exist in different URL namespaces (ET-001).
   */
  async checkCanCreateEventType(userId: number, body: InputEventTransformed_2024_06_14) {
    const existsWithSlug = await this.eventTypesRepository.getUserEventTypeBySlug(userId, body.slug);
    if (existsWithSlug) {
      throw new BadRequestException("User already has an event type with this slug.");
    }
    await this.checkUserOwnsSchedule(userId, body.scheduleId);
  }

  /**
   * Validates that the email system booking field is required and visible.
   *
   * ET-006 parity note: This validation ONLY checks the email system field — it does not block
   * or restrict any custom field types. Custom booking fields of all Calendly-equivalent types
   * (text, radio/radioInput, checkbox, phone, dropdown/select) pass through unaffected.
   *
   * Phone-only booking flows (where email is not the primary identifier) are handled separately
   * by InputEventTypesService_2024_06_14.hasEmailOrPhoneOnlySetup, which validates that either
   * email OR phone is configured as a required, visible booking field.
   */
  checkHasUserAccessibleEmailBookingField(bookingFields: (SystemField | CustomField)[]) {
    const emailField = bookingFields.find((field) => field.type === "email" && field.name === "email");
    const isEmailFieldRequiredAndVisible = emailField?.required && !emailField?.hidden;
    if (!isEmailFieldRequiredAndVisible) {
      throw new BadRequestException(
        "checkIsEmailUserAccessible - Email booking field must be required and visible"
      );
    }
  }

  async getEventTypeByUsernameAndSlug(params: {
    username: string;
    eventTypeSlug: string;
    orgSlug?: string;
    orgId?: number;
    authUser?: AuthOptionalUser;
  }) {
    const user = await this.usersRepository.findByUsername(params.username, params.orgSlug, params.orgId);
    if (!user) {
      return null;
    }

    const eventType = await this.eventTypesRepository.getUserEventTypeBySlug(user.id, params.eventTypeSlug);

    if (!eventType) {
      return null;
    }

    if (eventType.hidden && params.authUser?.id !== user.id) {
      return null;
    }

    return {
      ownerId: user.id,
      ...eventType,
    };
  }

  async getEventTypesByUsername(params: {
    username: string;
    orgSlug?: string;
    orgId?: number;
    authUser?: AuthOptionalUser;
    sortCreatedAt?: SortOrderType;
  }) {
    const user = await this.usersRepository.findByUsername(params.username, params.orgSlug, params.orgId);
    if (!user) {
      return [];
    }
    if (params.authUser?.id !== user.id) {
      return await this.getUserEventTypesPublic(user.id, params.sortCreatedAt);
    }
    return await this.getUserEventTypes(user.id, params.sortCreatedAt);
  }

  /**
   * Builds the user context object required by @calcom/platform-libraries createEventType.
   *
   * The returned shape satisfies the platform library's user context contract, including:
   * organization membership (isOrgAdmin), profile identity, selected calendars for conflict
   * detection, and event-type-level calendar overrides. This context is paradigm-agnostic —
   * the platform library uses the same user context shape for all event type paradigms.
   */
  async getUserToCreateEvent(user: UserWithProfile) {
    const organizationId = this.usersService.getUserMainOrgId(user);
    const isOrgAdmin = organizationId
      ? await this.membershipsRepository.isUserOrganizationAdmin(user.id, organizationId)
      : false;
    const profileId = this.usersService.getUserMainProfile(user)?.id || null;
    const selectedCalendars = await this.selectedCalendarsRepository.getUserSelectedCalendars(user.id);
    const eventTypeSelectedCalendars =
      await this.selectedCalendarsRepository.getUserEventTypeSelectedCalendar(user.id);
    return {
      id: user.id,
      locale: user.locale ?? "en",
      role: user.role,
      username: user.username,
      organizationId: user.organizationId,
      organization: { isOrgAdmin },
      profile: { id: profileId },
      metadata: user.metadata,
      selectedCalendars,
      email: user.email,
      userLevelSelectedCalendars: selectedCalendars,
      allSelectedCalendars: [...eventTypeSelectedCalendars, ...selectedCalendars],
    };
  }

  async getUserEventType(userId: number, eventTypeId: number) {
    const eventType = await this.eventTypesRepository.getUserEventType(userId, eventTypeId);

    if (!eventType) {
      return null;
    }

    this.checkUserOwnsEventType(userId, eventType);

    return {
      ownerId: userId,
      ...eventType,
    };
  }

  async getUserEventTypes(userId: number, sortCreatedAt?: SortOrderType) {
    const eventTypes = await this.eventTypesRepository.getUserEventTypes(userId, sortCreatedAt);

    return eventTypes.map((eventType) => {
      return { ownerId: userId, ...eventType };
    });
  }

  async getUserEventTypesPublic(userId: number, sortCreatedAt?: SortOrderType) {
    const eventTypes = await this.eventTypesRepository.getUserEventTypesPublic(userId, sortCreatedAt);

    return eventTypes.map((eventType) => {
      return { ownerId: userId, ...eventType };
    });
  }

  async getEventTypesPublicByUsername(username: string): Promise<EventTypesPublic> {
    const user = await this.usersRepository.findByUsername(username);
    if (!user) {
      throw new NotFoundException(`User with username "${username}" not found`);
    }

    return await getEventTypesPublic(user.id);
  }

  /**
   * Routes event type queries based on the provided query parameters.
   *
   * Supports all paradigm types in responses — the repository layer returns event types
   * regardless of their schedulingType. The routing logic is:
   *  1. username + eventSlug → single event type by slug (any paradigm)
   *  2. username only → all event types for that user (1:1, group, any personal paradigm)
   *  3. usernames (array) → dynamic event type template for multi-user links (dynamic paradigm)
   *  4. authenticated user → all personal event types for the auth user
   *
   * Team event types (RR, collective, managed) are listed through team-scoped endpoints,
   * not through this personal event type listing method.
   */
  async getEventTypes(queryParams: GetEventTypesQuery_2024_06_14, authUser?: AuthOptionalUser) {
    const { username, eventSlug, usernames, orgSlug, orgId, sortCreatedAt } = queryParams;
    if (username && eventSlug) {
      const eventType = await this.getEventTypeByUsernameAndSlug({
        username,
        eventTypeSlug: eventSlug,
        orgSlug,
        orgId,
        authUser,
      });
      return eventType ? [eventType] : [];
    }

    if (username) {
      return await this.getEventTypesByUsername({
        username,
        orgSlug,
        orgId,
        authUser,
        sortCreatedAt,
      });
    }

    if (usernames) {
      // Dynamic event type paradigm: creates a virtual event type from the dynamicEvent
      // template for multi-user booking links (e.g., /team/user1+user2/30min).
      const dynamicEventType = await this.getDynamicEventType(usernames, orgSlug, orgId);
      return [dynamicEventType];
    }

    if (authUser?.id) {
      return await this.getUserEventTypes(authUser.id, sortCreatedAt);
    }

    return [];
  }

  /**
   * Constructs a dynamic event type from the @calcom/platform-libraries dynamicEvent template.
   *
   * This is the 6th scheduling paradigm — dynamic multi-user links. The dynamicEvent template
   * provides default scheduling configuration, and the resolved users are attached as participants.
   * ownerId is 0 because dynamic events are not owned by a single user.
   */
  async getDynamicEventType(usernames: string[], orgSlug?: string, orgId?: number) {
    const users = await this.usersService.getByUsernames(usernames, orgSlug, orgId);
    const usersFiltered: UserWithProfile[] = [];
    for (const user of users) {
      if (user) {
        usersFiltered.push(user);
      }
    }
    return {
      ownerId: 0,
      ...dynamicEvent,
      users: usersFiltered,
      isInstantEvent: false,
    };
  }

  /**
   * Seeds the 4 default personal event types for a new user (ET-001 1:1 paradigm).
   *
   * All defaults are 1:1 event types (schedulingType null): 30min, 60min, 30min video, 60min video.
   * These use the DEFAULT_EVENT_TYPES constants which define only length, slug, title, and optional
   * locations (video types include integrations:daily). No seat configuration, no team scheduling,
   * no booking window overrides — the simplest possible 1:1 event types.
   */
  async createUserDefaultEventTypes(userId: number) {
    const { sixtyMinutes, sixtyMinutesVideo, thirtyMinutes, thirtyMinutesVideo } = DEFAULT_EVENT_TYPES;

    const defaultEventTypes = await Promise.all([
      this.eventTypesRepository.createUserEventType(userId, thirtyMinutes),
      this.eventTypesRepository.createUserEventType(userId, sixtyMinutes),
      this.eventTypesRepository.createUserEventType(userId, thirtyMinutesVideo),
      this.eventTypesRepository.createUserEventType(userId, sixtyMinutesVideo),
    ]);

    return defaultEventTypes;
  }

  /**
   * Updates a personal event type with partial input.
   *
   * Paradigm-specific field passthrough (all via Partial<InputEventTransformed_2024_06_14>):
   *  - ET-002 (Group): seatsPerTimeSlot, seatsShowAttendees, seatsShowAvailabilityCount
   *  - ET-003 (RR fields for personal context): isRRWeightsEnabled, rrSegmentQueryValue — these
   *    pass through but are only meaningful for team event types updated via TeamsEventTypesService.
   *  - ET-005 (Booking windows): periodType, periodDays, periodStartDate, periodEndDate,
   *    periodCountCalendarDays, minimumBookingNotice
   *  - ET-006 (Custom fields): bookingFields array with all Calendly-equivalent types
   *
   * The Partial<InputEventTransformed_2024_06_14> type ensures all paradigm-specific optional
   * fields are accepted without requiring them. The platform-library updateEventType helper
   * handles the actual Prisma persistence with correct field mapping.
   */
  async updateEventType(
    eventTypeId: number,
    body: Partial<InputEventTransformed_2024_06_14>,
    user: UserWithProfile
  ) {
    if (body.bookingFields) {
      this.checkHasUserAccessibleEmailBookingField(body.bookingFields);
    }
    await this.checkCanUpdateEventType(user.id, eventTypeId, body.scheduleId);
    const eventTypeUser = await this.getUserToUpdateEvent(user);

    await updateEventType({
      // All paradigm-specific fields spread into the platform-library input.
      input: { id: eventTypeId, ...body },
      ctx: {
        user: eventTypeUser,
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        prisma: this.dbWrite.prisma,
      },
    });

    const eventType = await this.eventTypesRepository.getEventTypeById(eventTypeId);

    if (!eventType) {
      throw new NotFoundException(`Event type with id ${eventTypeId} not found`);
    }

    return {
      ownerId: user.id,
      ...eventType,
    };
  }

  /**
   * Pre-update validation: existence, ownership, and schedule ownership checks.
   * Applies to all personal event type paradigms (1:1, group). Team event type
   * update authorization is handled in TeamsEventTypesService.
   */
  async checkCanUpdateEventType(userId: number, eventTypeId: number, scheduleId: number | undefined | null) {
    const existingEventType = await this.getUserEventType(userId, eventTypeId);
    if (!existingEventType) {
      throw new NotFoundException(`Event type with id ${eventTypeId} not found`);
    }
    this.checkUserOwnsEventType(userId, { id: eventTypeId, userId: existingEventType.ownerId });
    await this.checkUserOwnsSchedule(userId, scheduleId);
  }

  /**
   * Builds the user context object required by @calcom/platform-libraries updateEventType.
   *
   * Unlike getUserToCreateEvent, this spreads the full user object and overlays only the fields
   * that need transformation (locale default, profile id, calendar collections). The platform
   * library uses this context for calendar conflict detection and permission checks during updates.
   * This context shape is paradigm-agnostic.
   */
  async getUserToUpdateEvent(user: UserWithProfile) {
    const profileId = this.usersService.getUserMainProfile(user)?.id || null;
    const selectedCalendars = await this.selectedCalendarsRepository.getUserSelectedCalendars(user.id);
    const eventTypeSelectedCalendars =
      await this.selectedCalendarsRepository.getUserEventTypeSelectedCalendar(user.id);
    return {
      ...user,
      locale: user.locale ?? "en",
      profile: { id: profileId },
      userLevelSelectedCalendars: selectedCalendars,
      allSelectedCalendars: [...eventTypeSelectedCalendars, ...selectedCalendars],
    };
  }

  /**
   * Deletes a personal event type by ID after ownership verification.
   *
   * This method handles deletion for personal (user-scoped) event types only. Team event type
   * deletions (RR, collective, managed) are processed through TeamsEventTypesService which
   * enforces team-level authorization. For group (seated) events, cascading deletion of
   * BookingSeat records is handled by the Prisma schema's referential actions.
   */
  async deleteEventType(eventTypeId: number, userId: number) {
    const existingEventType = await this.eventTypesRepository.getEventTypeById(eventTypeId);
    if (!existingEventType) {
      throw new NotFoundException(`Event type with ID=${eventTypeId} does not exist.`);
    }

    this.checkUserOwnsEventType(userId, existingEventType);

    return this.eventTypesRepository.deleteEventType(eventTypeId);
  }

  checkUserOwnsEventType(userId: number, eventType: Pick<EventType, "id" | "userId">) {
    if (userId !== eventType.userId) {
      throw new ForbiddenException(`User with ID=${userId} does not own event type with ID=${eventType.id}`);
    }
  }

  async checkUserOwnsSchedule(userId: number, scheduleId: number | null | undefined) {
    if (!scheduleId) {
      return;
    }

    const schedule = await this.schedulesRepository.getScheduleByIdAndUserId(scheduleId, userId);

    if (!schedule) {
      throw new NotFoundException(`User with ID=${userId} does not own schedule with ID=${scheduleId}`);
    }
  }
}
