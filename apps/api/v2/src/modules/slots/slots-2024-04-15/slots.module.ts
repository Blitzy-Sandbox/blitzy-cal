import { EventTypesModule_2024_04_15 } from "@/ee/event-types/event-types_2024_04_15/event-types.module";
import { AvailableSlotsModule } from "@/lib/modules/available-slots.module";
import { PrismaModule } from "@/modules/prisma/prisma.module";
import { SlotsController_2024_04_15 } from "@/modules/slots/slots-2024-04-15/controllers/slots.controller";
import { SlotsOutputService_2024_04_15 } from "@/modules/slots/slots-2024-04-15/services/slots-output.service";
import { SlotsWorkerService_2024_04_15 } from "@/modules/slots/slots-2024-04-15/services/slots-worker.service";
import { SlotsService_2024_04_15 } from "@/modules/slots/slots-2024-04-15/services/slots.service";
import { SlotsRepository_2024_04_15 } from "@/modules/slots/slots-2024-04-15/slots.repository";
import { Module } from "@nestjs/common";

/**
 * NestJS DI container for the **2024-04-15 versioned slots API**.
 *
 * This module assembles the Prisma persistence layer, event-type metadata,
 * and the Cal.com availability computation stack into a single immutable
 * dependency-injection graph that is imported by the application root module
 * to register the versioned slots endpoints.
 *
 * ## Imports
 * | Module                          | Provides                                                                 |
 * |---------------------------------|--------------------------------------------------------------------------|
 * | `PrismaModule`                  | `PrismaReadService` and `PrismaWriteService` for database access         |
 * | `EventTypesModule_2024_04_15`   | `EventTypesRepository_2024_04_15` for event-type metadata lookups        |
 * | `AvailableSlotsModule`          | `AvailableSlotsService` — bridges to the 20-provider availability stack  |
 *
 * ## Providers (4 — module-scoped)
 * 1. **`SlotsRepository_2024_04_15`** — Persistence gateway for `SelectedSlots` and `Booking` models.
 * 2. **`SlotsService_2024_04_15`** — Core business logic: slot reservation, deletion, team-event checks.
 * 3. **`SlotsOutputService_2024_04_15`** — Response formatting with timezone normalization and time/range output.
 * 4. **`SlotsWorkerService_2024_04_15`** — Worker thread pool management for asynchronous slot computation.
 *
 * ## Controller
 * `SlotsController_2024_04_15` handles three HTTP endpoints:
 * - `POST   /reserve`        — reserve a selected time slot
 * - `DELETE /selected-slot`   — release a previously reserved slot
 * - `GET    /available`       — retrieve available slots for a given event type
 *
 * ## Exports
 * Only `SlotsService_2024_04_15` is exported so that higher-level modules
 * (e.g. booking orchestration) can inject the slots service while the
 * repository, output service, and worker service remain encapsulated.
 *
 * @see {@link AvailableSlotsModule} at `apps/api/v2/src/lib/modules/available-slots.module.ts`
 *      for the full 20-provider availability computation stack.
 *
 * @remarks
 * `AvailableSlotsModule` is concurrently being hardened with JSDoc by another
 * agent; its provider set and `AvailableSlotsService` export remain unchanged,
 * so this module's wiring is unaffected.
 */
@Module({
  imports: [PrismaModule, EventTypesModule_2024_04_15, AvailableSlotsModule],
  providers: [
    SlotsRepository_2024_04_15,
    SlotsService_2024_04_15,
    SlotsOutputService_2024_04_15,
    SlotsWorkerService_2024_04_15,
  ],
  controllers: [SlotsController_2024_04_15],
  exports: [SlotsService_2024_04_15],
})
export class SlotsModule_2024_04_15 {}
