import { EventTypesRepository_2024_06_14 } from "@/ee/event-types/event-types_2024_06_14/event-types.repository";
import { OrganizationsRepository } from "@/modules/organizations/index/organizations.repository";
import { OrganizationsTeamsRepository } from "@/modules/organizations/teams/index/organizations-teams.repository";
import { OrganizationsUsersRepository } from "@/modules/organizations/users/index/organizations-users.repository";
import { TeamsEventTypesRepository } from "@/modules/teams/event-types/teams-event-types.repository";
import { TeamsRepository } from "@/modules/teams/teams/teams.repository";
import { UsersRepository } from "@/modules/users/users.repository";
import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { DateTime } from "luxon";

import { dynamicEvent } from "@calcom/platform-libraries";
import {
  ByUsernameAndEventTypeSlug_2024_09_04,
  ByTeamSlugAndEventTypeSlug_2024_09_04,
  GetSlotsInput_2024_09_04,
  GetSlotsInputWithRouting_2024_09_04,
  ById_2024_09_04_type,
  ByUsernameAndEventTypeSlug_2024_09_04_type,
  ByTeamSlugAndEventTypeSlug_2024_09_04_type,
} from "@calcom/platform-types";

/**
 * Internal query contract produced after normalizing a {@link GetSlotsInput_2024_09_04} DTO.
 * Consumed by `SlotsService_2024_09_04.fetchAndFormatSlots` to drive slot availability lookups.
 *
 * Fields are resolved from the discriminated-union DTO: event type metadata is looked up
 * from repositories, time boundaries are Luxon-adjusted to UTC ISO strings, and optional
 * properties (`duration`, `rrHostSubsetIds`) are passed through when present.
 */
export type InternalGetSlotsQuery = {
  isTeamEvent: boolean;
  startTime: string;
  endTime: string;
  duration?: number;
  eventTypeId: number;
  eventTypeSlug: string;
  usernameList: string[];
  timeZone: string | undefined;
  orgSlug: string | null | undefined;
  rescheduleUid: string | null;
  rrHostSubsetIds?: number[];
};

/**
 * Routing-extended variant of {@link InternalGetSlotsQuery} that carries four additional
 * fields for contact-routing-aware slot queries. Produced by
 * {@link SlotsInputService_2024_09_04.transformRoutingGetSlotsQuery}.
 *
 * - `routedTeamMemberIds` — pre-resolved member IDs from the routing engine (null if unset).
 * - `skipContactOwner` — when true, excludes the contact owner from candidate hosts.
 * - `teamMemberEmail` — email filter for a specific team member (null if unset).
 * - `routingFormResponseId` — optional reference to the routing form submission.
 */
export type InternalGetSlotsQueryWithRouting = InternalGetSlotsQuery & {
  routedTeamMemberIds: number[] | null;
  skipContactOwner: boolean;
  teamMemberEmail: string | null;
  routingFormResponseId: number | undefined;
};

/**
 * Input transformation service for the **2024-09-04 Slots API** version.
 *
 * Normalizes incoming {@link GetSlotsInput_2024_09_04} DTOs into the module-internal
 * {@link InternalGetSlotsQuery} and {@link InternalGetSlotsQueryWithRouting} payloads
 * that downstream services (`SlotsService_2024_09_04`) consume.
 *
 * **Event type resolution** follows a discriminated-union pattern:
 * 1. `ById_2024_09_04_type` — direct repository lookup by numeric ID.
 * 2. `ByUsernameAndEventTypeSlug_2024_09_04_type` — resolve user (optionally org-scoped),
 *    then fetch event type by slug.
 * 3. `ByTeamSlugAndEventTypeSlug_2024_09_04_type` — resolve team (optionally org-scoped),
 *    then fetch event type by slug.
 * 4. Default — returns the `dynamicEvent` placeholder with optional duration override.
 *
 * **Organization-scoped lookups**: when an `organizationSlug` is present, the service
 * first resolves the organization and then performs org-scoped user/team lookups via
 * {@link OrganizationsUsersRepository} / {@link OrganizationsTeamsRepository}.
 *
 * **Time boundary snapping** (Luxon-based, UTC):
 * - Start time at midnight (00:00:00) → stays at 00:00:00 (start of day).
 * - End time at midnight (00:00:00) → snaps to 23:59:59 (end of day, ensures full-day coverage).
 * - Invalid ISO strings produce a `BadRequestException`.
 *
 * **Routing field normalization** (`transformRoutingGetSlotsQuery`):
 * - `routedTeamMemberIds` / `teamMemberEmail` → `null` when falsy.
 * - `skipContactOwner` → `false` when falsy.
 * - `routingFormResponseId` → `undefined` when nullish.
 *
 * @see SlotsService_2024_09_04 — primary consumer of the transformed queries
 */
@Injectable()
export class SlotsInputService_2024_09_04 {
  constructor(
    private readonly eventTypeRepository: EventTypesRepository_2024_06_14,
    private readonly usersRepository: UsersRepository,
    private readonly organizationsUsersRepository: OrganizationsUsersRepository,
    private readonly organizationsTeamsRepository: OrganizationsTeamsRepository,
    private readonly organizationsRepository: OrganizationsRepository,
    private readonly teamsRepository: TeamsRepository,
    private readonly teamsEventTypesRepository: TeamsEventTypesRepository
  ) {}

  /**
   * Transforms a raw {@link GetSlotsInput_2024_09_04} DTO into the normalized
   * {@link InternalGetSlotsQuery} consumed by the slots service.
   *
   * Pipeline:
   * 1. Resolves the event type via the discriminated-union {@link getEventType} helper.
   * 2. Throws `NotFoundException` if no matching event type is found.
   * 3. Determines `isTeamEvent` from the event type's `teamId`.
   * 4. Adjusts start/end times via Luxon UTC parsing with midnight boundary snapping.
   * 5. Extracts `usernameList`, `orgSlug`, `rescheduleUid`, and `rrHostSubsetIds` from the DTO.
   *
   * @param query - The incoming slots request DTO (discriminated union).
   * @returns The fully resolved internal query payload.
   * @throws {NotFoundException} When the resolved event type is null.
   */
  async transformGetSlotsQuery(query: GetSlotsInput_2024_09_04): Promise<InternalGetSlotsQuery> {
    const eventType = await this.getEventType(query);
    if (!eventType) {
      throw new NotFoundException(`Event Type not found`);
    }
    const isTeamEvent = !!eventType?.teamId;

    const startTime = this.adjustStartTime(query.start);
    const endTime = this.adjustEndTime(query.end);
    const duration = query.duration;
    const eventTypeId = eventType.id;
    const eventTypeSlug = eventType.slug;
    const usernameList = "usernames" in query ? query.usernames : [];
    const timeZone = query.timeZone;
    const orgSlug = "organizationSlug" in query ? query.organizationSlug : null;
    const rescheduleUid = query.bookingUidToReschedule || null;

    return {
      isTeamEvent,
      startTime,
      endTime,
      duration,
      eventTypeId,
      eventTypeSlug,
      usernameList,
      timeZone,
      orgSlug,
      rescheduleUid,
      rrHostSubsetIds: query.rrHostSubsetIds,
    };
  }

  /**
   * Transforms a routing-aware slots DTO into {@link InternalGetSlotsQueryWithRouting}.
   *
   * Destructures the four routing-specific fields (`routedTeamMemberIds`,
   * `skipContactOwner`, `teamMemberEmail`, `routingFormResponseId`) from the input,
   * delegates the remaining base fields to {@link transformGetSlotsQuery}, then
   * normalizes routing values:
   * - `routedTeamMemberIds` → `null` when falsy.
   * - `skipContactOwner` → `false` when falsy.
   * - `teamMemberEmail` → `null` when falsy.
   * - `routingFormResponseId` → `undefined` when nullish (`??`).
   *
   * @param query - The routing-extended slots request DTO.
   * @returns The fully resolved internal query with routing metadata.
   */
  async transformRoutingGetSlotsQuery(
    query: GetSlotsInputWithRouting_2024_09_04
  ): Promise<InternalGetSlotsQueryWithRouting> {
    const { routedTeamMemberIds, skipContactOwner, teamMemberEmail, routingFormResponseId, ...baseQuery } =
      query;

    const baseTransformation = await this.transformGetSlotsQuery(baseQuery);

    return {
      ...baseTransformation,
      routedTeamMemberIds: routedTeamMemberIds || null,
      skipContactOwner: skipContactOwner || false,
      teamMemberEmail: teamMemberEmail || null,
      routingFormResponseId: routingFormResponseId ?? undefined,
    };
  }

  /**
   * Resolves the event type from the discriminated-union input DTO.
   *
   * Resolution paths:
   * - `ById_2024_09_04_type`: Direct lookup via `eventTypeRepository.getEventTypeById`.
   * - `ByUsernameAndEventTypeSlug_2024_09_04_type`: Resolve user (optionally org-scoped)
   *   via {@link getEventTypeUser}, then fetch by slug via `getUserEventTypeBySlug`.
   * - `ByTeamSlugAndEventTypeSlug_2024_09_04_type`: Resolve team (optionally org-scoped)
   *   via {@link getEventTypeTeam}, then fetch by slug via `getEventTypeByTeamIdAndSlug`.
   * - Default: Returns the `dynamicEvent` placeholder with optional `length` override
   *   from `input.duration`.
   *
   * @param input - The discriminated-union slots input DTO.
   * @returns The resolved event type entity, or `dynamicEvent` for dynamic bookings.
   * @throws {NotFoundException} When a referenced user or team cannot be found.
   */
  private async getEventType(input: GetSlotsInput_2024_09_04) {
    if (input.type === ById_2024_09_04_type) {
      return this.eventTypeRepository.getEventTypeById(input.eventTypeId);
    }

    if (input.type === ByUsernameAndEventTypeSlug_2024_09_04_type) {
      const user = await this.getEventTypeUser(input);
      if (!user) {
        throw new NotFoundException(`User with username ${input.username} not found`);
      }
      return this.eventTypeRepository.getUserEventTypeBySlug(user.id, input.eventTypeSlug);
    }

    if (input.type === ByTeamSlugAndEventTypeSlug_2024_09_04_type) {
      const team = await this.getEventTypeTeam(input);
      if (!team) {
        throw new NotFoundException(`Team with slug ${input.teamSlug} not found`);
      }
      return this.teamsEventTypesRepository.getEventTypeByTeamIdAndSlug(team.id, input.eventTypeSlug);
    }

    return input.duration ? { ...dynamicEvent, length: input.duration } : dynamicEvent;
  }

  /**
   * Resolves the user entity for username-based event type lookups.
   *
   * - Without `organizationSlug`: performs a global username lookup via `usersRepository`.
   * - With `organizationSlug`: first resolves the organization by slug, then performs an
   *   org-scoped user lookup via `organizationsUsersRepository`. Throws `NotFoundException`
   *   if the organization does not exist.
   *
   * @param input - The username + event-type-slug DTO containing the target username and
   *   optional `organizationSlug`.
   * @returns The resolved user entity, or `null`/`undefined` if not found.
   * @throws {NotFoundException} When the specified organization slug cannot be resolved.
   */
  private async getEventTypeUser(input: ByUsernameAndEventTypeSlug_2024_09_04) {
    if (!input.organizationSlug) {
      return await this.usersRepository.findByUsername(input.username);
    }

    const organization = await this.organizationsRepository.findOrgBySlug(input.organizationSlug);
    if (!organization) {
      throw new NotFoundException(
        `slots-input.service.ts: Organization with slug ${input.organizationSlug} not found`
      );
    }

    return await this.organizationsUsersRepository.getOrganizationUserByUsername(
      organization.id,
      input.username
    );
  }

  /**
   * Resolves the team entity for team-slug-based event type lookups.
   *
   * - Without `organizationSlug`: performs a global team slug lookup via `teamsRepository`.
   * - With `organizationSlug`: first resolves the organization by slug, then performs an
   *   org-scoped team lookup via `organizationsTeamsRepository`. Throws `NotFoundException`
   *   if the organization does not exist.
   *
   * @param input - The team-slug + event-type-slug DTO containing the target `teamSlug` and
   *   optional `organizationSlug`.
   * @returns The resolved team entity, or `null`/`undefined` if not found.
   * @throws {NotFoundException} When the specified organization slug cannot be resolved.
   */
  private async getEventTypeTeam(input: ByTeamSlugAndEventTypeSlug_2024_09_04) {
    if (!input.organizationSlug) {
      return await this.teamsRepository.findTeamBySlug(input.teamSlug);
    }

    const organization = await this.organizationsRepository.findOrgBySlug(input.organizationSlug);
    if (!organization) {
      throw new NotFoundException(
        `slots-input.service.ts: Organization with slug ${input.organizationSlug} not found`
      );
    }

    return await this.organizationsTeamsRepository.findOrgTeamBySlug(organization.id, input.teamSlug);
  }

  /**
   * Parses and normalizes a start-time ISO string to UTC via Luxon.
   *
   * When the parsed time is exactly midnight (00:00:00), the value is explicitly set to
   * `{ hour: 0, minute: 0, second: 0, millisecond: 0 }` — preserving the start-of-day
   * boundary. This ensures the full day is included in slot generation.
   *
   * @param startTime - An ISO 8601 date-time string representing the query start.
   * @returns The UTC-normalized ISO string.
   * @throws {BadRequestException} When Luxon cannot produce a valid ISO representation.
   */
  private adjustStartTime(startTime: string) {
    let dateTime = DateTime.fromISO(startTime, { zone: "utc" });
    if (dateTime.hour === 0 && dateTime.minute === 0 && dateTime.second === 0) {
      dateTime = dateTime.set({ hour: 0, minute: 0, second: 0, millisecond: 0 });
    }

    const ISOStartTime = dateTime.toISO();
    if (ISOStartTime === null) {
      throw new BadRequestException("Invalid start date");
    }

    return ISOStartTime;
  }

  /**
   * Parses and normalizes an end-time ISO string to UTC via Luxon.
   *
   * When the parsed time is exactly midnight (00:00:00), the value is snapped to
   * `{ hour: 23, minute: 59, second: 59 }` — shifting to the end of the preceding day.
   * This ensures full-day coverage when callers pass a bare date (which Luxon defaults
   * to midnight).
   *
   * @param endTime - An ISO 8601 date-time string representing the query end.
   * @returns The UTC-normalized ISO string.
   * @throws {BadRequestException} When Luxon cannot produce a valid ISO representation.
   */
  private adjustEndTime(endTime: string) {
    let dateTime = DateTime.fromISO(endTime, { zone: "utc" });
    if (dateTime.hour === 0 && dateTime.minute === 0 && dateTime.second === 0) {
      dateTime = dateTime.set({ hour: 23, minute: 59, second: 59 });
    }

    const ISOEndTime = dateTime.toISO();
    if (ISOEndTime === null) {
      throw new BadRequestException("Invalid end date");
    }

    return ISOEndTime;
  }
}
