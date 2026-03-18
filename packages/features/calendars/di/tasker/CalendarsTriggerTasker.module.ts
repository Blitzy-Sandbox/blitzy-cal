import { bindModuleToClassOnToken, createModule, type ModuleLoader } from "@calcom/features/di/di";
import { moduleLoader as loggerServiceModule } from "@calcom/features/di/shared/services/logger.service";
import { CalendarsTriggerTasker } from "@calcom/features/calendars/lib/tasker/CalendarsTriggerTasker";
import { BufferTimeEventService } from "@calcom/features/calendars/lib/buffer-sync/BufferTimeEventService";
import { GoogleCancellationHandler } from "@calcom/features/calendars/lib/cancellation-sync/handlers/GoogleCancellationHandler";
import { OutlookCancellationHandler } from "@calcom/features/calendars/lib/cancellation-sync/handlers/OutlookCancellationHandler";

import { cancellationSyncModuleLoader } from "./CalendarsTaskService.module";
import { moduleLoader as cachedFeatureRepositoryModuleLoader } from "@calcom/features/flags/di/CachedFeatureRepository.module";
import { CALENDARS_TASKER_DI_TOKENS } from "./tokens";

const thisModule = createModule();
const token = CALENDARS_TASKER_DI_TOKENS.CALENDARS_TRIGGER_TASKER;
const moduleToken = CALENDARS_TASKER_DI_TOKENS.CALENDARS_TRIGGER_TASKER_MODULE;
const bufferTimeEventServiceToken = CALENDARS_TASKER_DI_TOKENS.BUFFER_TIME_EVENT_SERVICE;

const loadModule = bindModuleToClassOnToken({
  module: thisModule,
  moduleToken,
  token,
  classs: CalendarsTriggerTasker,
  depsMap: {
    logger: loggerServiceModule,
    cancellationSyncService: cancellationSyncModuleLoader,
  },
});

// ---------------------------------------------------------------------------
// Cancellation Handler DI Bindings (CI-001 gap closure)
// ---------------------------------------------------------------------------

/**
 * Local DI tokens for the Google and Outlook cancellation handlers.
 *
 * These are internal to this module and not exposed via the shared tokens.ts,
 * since the handlers are trigger-level components consumed within the calendar
 * tasker infrastructure rather than standalone top-level services.
 */
const googleHandlerToken = Symbol("GoogleCancellationHandler");
const outlookHandlerToken = Symbol("OutlookCancellationHandler");

/**
 * DI binding for GoogleCancellationHandler.
 *
 * Registers the Google Calendar push notification handler into the trigger
 * tasker's DI module. The handler processes X-Goog-Resource-State headers
 * from Google Calendar push notifications to detect event deletions/declines,
 * then delegates to CalendarCancellationSyncService for cancellation propagation.
 *
 * Dependency: cancellationSyncModuleLoader — provides the CalendarCancellationSyncService
 * instance injected as the handler's sole constructor argument.
 */
const loadGoogleCancellationHandler = bindModuleToClassOnToken({
  module: thisModule,
  moduleToken,
  token: googleHandlerToken,
  classs: GoogleCancellationHandler,
  dep: cancellationSyncModuleLoader,
});

/**
 * DI binding for OutlookCancellationHandler.
 *
 * Registers the Microsoft Graph change notification handler into the trigger
 * tasker's DI module. The handler processes change notification payloads
 * from Microsoft Graph to detect event deletions/declines in Outlook/O365
 * calendars, then delegates to CalendarCancellationSyncService for
 * cancellation propagation.
 *
 * Dependency: cancellationSyncModuleLoader — provides the CalendarCancellationSyncService
 * instance injected as the handler's sole constructor argument.
 */
const loadOutlookCancellationHandler = bindModuleToClassOnToken({
  module: thisModule,
  moduleToken,
  token: outlookHandlerToken,
  classs: OutlookCancellationHandler,
  dep: cancellationSyncModuleLoader,
});

// ---------------------------------------------------------------------------
// Buffer Time Event Service DI Binding (CI-002 gap closure)
// ---------------------------------------------------------------------------

/**
 * DI binding for BufferTimeEventService.
 *
 * Registers the buffer time visualization service into the trigger tasker's
 * DI module. The service creates, updates, and deletes buffer time events
 * in external calendars alongside booking events, gated behind the
 * 'calendar-buffer-sync' feature flag.
 *
 * BufferTimeEventService manages its own FeaturesRepository internally for
 * feature flag checks, so no additional dependencies need to be injected.
 */
const loadBufferTimeEventService = bindModuleToClassOnToken({
  module: thisModule,
  moduleToken,
  token: bufferTimeEventServiceToken,
  classs: BufferTimeEventService,
  depsMap: {
    featureRepository: cachedFeatureRepositoryModuleLoader,
  },
});

export const moduleLoader = {
  token,
  loadModule,
} satisfies ModuleLoader;

/**
 * Module loader for the BufferTimeEventService DI binding.
 *
 * Consumers can use this loader to register and resolve the buffer time
 * event service from the IoC container for creating and deleting buffer
 * calendar events alongside booking events.
 *
 * @example
 * ```ts
 * bufferTimeEventServiceModuleLoader.loadModule(container);
 * const service = container.get<BufferTimeEventService>(bufferTimeEventServiceModuleLoader.token);
 * ```
 */
export const bufferTimeEventServiceModuleLoader = {
  token: bufferTimeEventServiceToken,
  loadModule: loadBufferTimeEventService,
} satisfies ModuleLoader;

/**
 * Module loader for the GoogleCancellationHandler DI binding.
 *
 * Consumers can use this loader to register and resolve the Google Calendar
 * cancellation handler from the IoC container for processing push notifications
 * indicating event deletions or attendee declines.
 *
 * @example
 * ```ts
 * googleCancellationHandlerModuleLoader.loadModule(container);
 * const handler = container.get<GoogleCancellationHandler>(googleCancellationHandlerModuleLoader.token);
 * ```
 */
export const googleCancellationHandlerModuleLoader = {
  token: googleHandlerToken,
  loadModule: loadGoogleCancellationHandler,
} satisfies ModuleLoader;

/**
 * Module loader for the OutlookCancellationHandler DI binding.
 *
 * Consumers can use this loader to register and resolve the Outlook/O365
 * cancellation handler from the IoC container for processing Microsoft Graph
 * change notifications indicating event deletions or attendee declines.
 *
 * @example
 * ```ts
 * outlookCancellationHandlerModuleLoader.loadModule(container);
 * const handler = container.get<OutlookCancellationHandler>(outlookCancellationHandlerModuleLoader.token);
 * ```
 */
export const outlookCancellationHandlerModuleLoader = {
  token: outlookHandlerToken,
  loadModule: loadOutlookCancellationHandler,
} satisfies ModuleLoader;
