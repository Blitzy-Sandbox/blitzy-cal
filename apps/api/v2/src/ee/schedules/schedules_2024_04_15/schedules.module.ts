import { SchedulesController_2024_04_15 } from "@/ee/schedules/schedules_2024_04_15/controllers/schedules.controller";
import { SchedulesRepository_2024_04_15 } from "@/ee/schedules/schedules_2024_04_15/schedules.repository";
import { SchedulesService_2024_04_15 } from "@/ee/schedules/schedules_2024_04_15/services/schedules.service";
import { PrismaScheduleRepository } from "@/lib/repositories/prisma-schedule.repository";
import { PrismaModule } from "@/modules/prisma/prisma.module";
import { TokensModule } from "@/modules/tokens/tokens.module";
import { UsersModule } from "@/modules/users/users.module";
import { Module } from "@nestjs/common";

/**
 * NestJS module for the April 15, 2024 versioned enterprise schedule API (VERSION_2024_04_15).
 *
 * Registers the versioned controller ({@link SchedulesController_2024_04_15}),
 * service ({@link SchedulesService_2024_04_15}), and repository
 * ({@link SchedulesRepository_2024_04_15}) providers for schedule CRUD operations.
 *
 * Additionally registers {@link PrismaScheduleRepository} — the shared feature-level
 * repository originating from `@calcom/features/schedules/repositories/ScheduleRepository`
 * — to enable detailed schedule lookups with Atom-compatible transformations.
 *
 * **Imported modules:**
 * - {@link PrismaModule} — provides `PrismaReadService` and `PrismaWriteService` for
 *   database access in the repository and service layers.
 * - {@link UsersModule} — provides `UsersRepository` for user lookup operations
 *   required by the schedules service.
 * - {@link TokensModule} — provides authentication token utilities consumed by
 *   route guards protecting schedule endpoints.
 *
 * **Exports:**
 * - {@link SchedulesService_2024_04_15} and {@link SchedulesRepository_2024_04_15}
 *   are exported for downstream module consumption (e.g., e2e test modules and
 *   other enterprise modules that depend on schedule data).
 */
@Module({
  imports: [PrismaModule, UsersModule, TokensModule],
  providers: [SchedulesRepository_2024_04_15, SchedulesService_2024_04_15, PrismaScheduleRepository],
  controllers: [SchedulesController_2024_04_15],
  exports: [SchedulesService_2024_04_15, SchedulesRepository_2024_04_15],
})
export class SchedulesModule_2024_04_15 {}
