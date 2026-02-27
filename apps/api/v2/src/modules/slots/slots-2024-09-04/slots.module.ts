import { EventTypesModule_2024_06_14 } from "@/ee/event-types/event-types_2024_06_14/event-types.module";
import { AvailableSlotsModule } from "@/lib/modules/available-slots.module";
import { MembershipsModule } from "@/modules/memberships/memberships.module";
import { OrganizationsRepository } from "@/modules/organizations/index/organizations.repository";
import { OrganizationsTeamsRepository } from "@/modules/organizations/teams/index/organizations-teams.repository";
import { OrganizationsUsersRepository } from "@/modules/organizations/users/index/organizations-users.repository";
import { PrismaModule } from "@/modules/prisma/prisma.module";
import { SlotsController_2024_09_04 } from "@/modules/slots/slots-2024-09-04/controllers/slots.controller";
import { SlotsInputService_2024_09_04 } from "@/modules/slots/slots-2024-09-04/services/slots-input.service";
import { SlotsOutputService_2024_09_04 } from "@/modules/slots/slots-2024-09-04/services/slots-output.service";
import { SlotsService_2024_09_04 } from "@/modules/slots/slots-2024-09-04/services/slots.service";
import { SlotsRepository_2024_09_04 } from "@/modules/slots/slots-2024-09-04/slots.repository";
import { StripeModule } from "@/modules/stripe/stripe.module";
import { TeamsEventTypesModule } from "@/modules/teams/event-types/teams-event-types.module";
import { TeamsModule } from "@/modules/teams/teams/teams.module";
import { UsersRepository } from "@/modules/users/users.repository";
import { Module } from "@nestjs/common";

/**
 * NestJS module definition for the **2024-09-04 versioned Slots API**.
 *
 * This module wires the complete DI graph required for slot availability queries,
 * slot reservation CRUD, and event-type metadata resolution within the Cal.com
 * API v2 surface. It exposes `GET /v2/slots`, slot reservation endpoints
 * (POST / GET / PATCH / DELETE) via {@link SlotsController_2024_09_04}.
 *
 * ### Imported Modules (7)
 * | Module | Purpose |
 * |--------|---------|
 * | `PrismaModule` | Provides `PrismaReadService` / `PrismaWriteService` for persistence |
 * | `EventTypesModule_2024_06_14` | Event-type repository and metadata for input/output services |
 * | `StripeModule` | Payment context for slot operations requiring billing |
 * | `TeamsModule` | Team repositories for team-level slot operations |
 * | `MembershipsModule` | `MembershipsService` / `MembershipsRepository` for round-robin validation |
 * | `TeamsEventTypesModule` | `TeamsEventTypesRepository` for team event-type lookups |
 * | `AvailableSlotsModule` | Full availability computation stack (16+ providers including `UserAvailabilityService`, `BusyTimesService`, schedule repositories, and Redis caching) |
 *
 * ### Registered Providers (8)
 * - **1 versioned repository**: `SlotsRepository_2024_09_04` — SelectedSlots persistence
 * - **3 versioned services**: `SlotsService_2024_09_04` (business logic),
 *   `SlotsInputService_2024_09_04` (DTO → internal query), `SlotsOutputService_2024_09_04` (internal → DTO)
 * - **4 shared repositories**: `UsersRepository`, `OrganizationsUsersRepository`,
 *   `OrganizationsRepository`, `OrganizationsTeamsRepository`
 *
 * ### Exports
 * `SlotsService_2024_09_04` is the sole export, enabling reuse by other API v2 modules.
 *
 * ### Integration Path
 * `SlotsService_2024_09_04` → `AvailableSlotsService` → `BaseAvailableSlotsService`
 * (from `@calcom/platform-libraries/slots`), which delegates to the core scheduling
 * engine's slot generation, busy-time aggregation, and availability computation.
 */
@Module({
  imports: [
    PrismaModule,
    EventTypesModule_2024_06_14,
    StripeModule,
    TeamsModule,
    MembershipsModule,
    TeamsEventTypesModule,
    AvailableSlotsModule,
  ],
  providers: [
    SlotsRepository_2024_09_04,
    SlotsService_2024_09_04,
    UsersRepository,
    SlotsInputService_2024_09_04,
    SlotsOutputService_2024_09_04,
    OrganizationsUsersRepository,
    OrganizationsRepository,
    OrganizationsTeamsRepository,
  ],
  controllers: [SlotsController_2024_09_04],
  exports: [SlotsService_2024_09_04],
})
export class SlotsModule_2024_09_04 {}
