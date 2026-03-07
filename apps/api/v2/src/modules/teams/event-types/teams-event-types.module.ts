import { Module } from "@nestjs/common";
import { EventTypesModule_2024_06_14 } from "@/ee/event-types/event-types_2024_06_14/event-types.module";
import { ConferencingRepository } from "@/modules/conferencing/repositories/conferencing.repository";
import { MembershipsModule } from "@/modules/memberships/memberships.module";
import { OrganizationsConferencingModule } from "@/modules/organizations/conferencing/organizations-conferencing.module";
import { OutputTeamEventTypesResponsePipe } from "@/modules/organizations/event-types/pipes/team-event-types-response.transformer";
import { InputOrganizationsEventTypesService } from "@/modules/organizations/event-types/services/input.service";
import { OutputOrganizationsEventTypesService } from "@/modules/organizations/event-types/services/output.service";
import { OrganizationsTeamsRepository } from "@/modules/organizations/teams/index/organizations-teams.repository";
import { PrismaModule } from "@/modules/prisma/prisma.module";
import { RedisModule } from "@/modules/redis/redis.module";
import { TeamsEventTypesController } from "@/modules/teams/event-types/controllers/teams-event-types.controller";
import { TeamsEventTypesService } from "@/modules/teams/event-types/services/teams-event-types.service";
import { TeamsEventTypesRepository } from "@/modules/teams/event-types/teams-event-types.repository";
import { TeamsModule } from "@/modules/teams/teams/teams.module";
import { UsersModule } from "@/modules/users/users.module";

/**
 * NestJS module for team-scoped event type CRUD operations via the `/v2/teams/:teamId/event-types` API surface.
 *
 * Supports all 6 scheduling paradigms for Sprint 2 Event Type Parity (ET-001 through ET-006):
 *
 * - **ET-001 — 1:1 Events:** Handled by {@link EventTypesModule_2024_06_14} (provides `EventTypesService_2024_06_14`)
 *   combined with {@link TeamsEventTypesRepository} for team-scoped persistence.
 * - **ET-002 — Group Events (seats):** `seatsPerTimeSlot` handling flows through
 *   {@link InputOrganizationsEventTypesService} which delegates to `InputEventTypesService_2024_06_14`
 *   provided by {@link EventTypesModule_2024_06_14}.
 * - **ET-003 — Round-Robin:** {@link TeamsEventTypesRepository} returns host data with weights/priorities
 *   (`isFixed`, `weight`, `priority`, `weightAdjustment`). RR distribution logic resides in
 *   `@calcom/platform-libraries`; the versioned `EventTypesService_2024_06_14` orchestrates segment-based
 *   filtering via `rrSegmentQueryValue` and `isRRWeightsEnabled` EventType scalar fields.
 * - **ET-004 — Collective:** Same team providers handle collective scheduling; all-host intersection
 *   is computed in the availability engine (`getAggregatedAvailability`), not in this module.
 * - **ET-005 — Booking Windows:** `periodType`, `periodDays`, `periodStartDate`, `periodEndDate`, and
 *   `minimumBookingNotice` are EventType scalar fields persisted via `@calcom/platform-libraries`.
 *   {@link InputOrganizationsEventTypesService} handles input validation for these fields.
 * - **ET-006 — Custom Fields:** `bookingFields` validation goes through
 *   `EventTypesService_2024_06_14.checkHasUserAccessibleEmailBookingField`. Custom field types
 *   (text, radio, checkbox, phone, dropdown) are stored as JSON and pass through without
 *   additional module infrastructure.
 *
 * **Module architecture:**
 * - `imports` provide infrastructure: ORM ({@link PrismaModule}), caching ({@link RedisModule}),
 *   membership guards ({@link MembershipsModule}), versioned EE event type CRUD
 *   ({@link EventTypesModule_2024_06_14}), user resolution ({@link UsersModule}), team metadata
 *   ({@link TeamsModule}), and conferencing ({@link OrganizationsConferencingModule}).
 * - `providers` register team-scoped services: repository, orchestration service, input/output
 *   transformation, org-team resolution, and conferencing metadata.
 * - `exports` expose {@link TeamsEventTypesRepository} and {@link TeamsEventTypesService} for
 *   downstream module consumption (e.g., telemetry, health checks, aggregate APIs).
 *
 * @note {@link EventTypesModule_2024_06_14} also registers {@link TeamsEventTypesRepository} as a
 * provider internally. NestJS resolves duplicate providers by using the last registration within
 * each module's own injector scope, so this dual registration is safe and intentional — it allows
 * both modules to independently resolve the repository without cross-module coupling.
 */
@Module({
  imports: [
    PrismaModule,
    RedisModule,
    MembershipsModule,
    EventTypesModule_2024_06_14,
    UsersModule,
    TeamsModule,
    OrganizationsConferencingModule,
  ],
  providers: [
    TeamsEventTypesRepository,
    TeamsEventTypesService,
    InputOrganizationsEventTypesService,
    OrganizationsTeamsRepository,
    OutputTeamEventTypesResponsePipe,
    OutputOrganizationsEventTypesService,
    ConferencingRepository,
  ],
  exports: [TeamsEventTypesRepository, TeamsEventTypesService],
  controllers: [TeamsEventTypesController],
})
export class TeamsEventTypesModule {}
