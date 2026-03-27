import { bindModuleToClassOnToken, createModule, type ModuleLoader } from "@calcom/features/di/di";
import { moduleLoader as loggerServiceModule } from "@calcom/features/di/shared/services/logger.service";
import { moduleLoader as prismaModuleLoader } from "@calcom/features/di/modules/Prisma";
import { CalendarsTaskService } from "@calcom/features/calendars/lib/tasker/CalendarsTaskService";
import { CalendarCancellationSyncService } from "@calcom/features/calendars/lib/cancellation-sync/CalendarCancellationSyncService";
import { moduleLoader as cachedFeatureRepositoryModuleLoader } from "@calcom/features/flags/di/CachedFeatureRepository.module";

import { CALENDARS_TASKER_DI_TOKENS } from "./tokens";

const thisModule = createModule();
const token = CALENDARS_TASKER_DI_TOKENS.CALENDARS_TASK_SERVICE;
const moduleToken = CALENDARS_TASKER_DI_TOKENS.CALENDARS_TASK_SERVICE_MODULE;
const cancellationSyncToken = CALENDARS_TASKER_DI_TOKENS.CALENDAR_CANCELLATION_SYNC_SERVICE;

const loadModule = bindModuleToClassOnToken({
  module: thisModule,
  moduleToken,
  token,
  classs: CalendarsTaskService,
  depsMap: {
    logger: loggerServiceModule,
    prisma: prismaModuleLoader,
  },
});

/**
 * DI binding for CalendarCancellationSyncService — CI-001 gap closure.
 *
 * Registers the calendar-driven cancellation sync service into the same
 * DI module container as CalendarsTaskService. The service requires a
 * featureRepository dependency (providing checkIfFeatureIsEnabledGlobally)
 * to evaluate the "calendar-cancellation-sync" feature flag at runtime.
 *
 * The feature flag is disabled by default — the service will no-op until
 * the flag is explicitly enabled via the Feature table.
 */
const loadCancellationSyncModule = bindModuleToClassOnToken({
  module: thisModule,
  moduleToken,
  token: cancellationSyncToken,
  classs: CalendarCancellationSyncService,
  depsMap: {
    featureRepository: cachedFeatureRepositoryModuleLoader,
  },
});

export const moduleLoader = {
  token,
  loadModule,
} satisfies ModuleLoader;

/**
 * Module loader for the CalendarCancellationSyncService DI binding.
 *
 * Consumers can use this loader to register and resolve the cancellation
 * sync service from the IoC container. The service handles propagation of
 * event deletions/declines from external calendars (Google, Outlook) back
 * to Cal.com bookings.
 *
 * @example
 * ```ts
 * cancellationSyncModuleLoader.loadModule(container);
 * const service = container.get<CalendarCancellationSyncService>(cancellationSyncModuleLoader.token);
 * ```
 */
export const cancellationSyncModuleLoader = {
  token: cancellationSyncToken,
  loadModule: loadCancellationSyncModule,
} satisfies ModuleLoader;
