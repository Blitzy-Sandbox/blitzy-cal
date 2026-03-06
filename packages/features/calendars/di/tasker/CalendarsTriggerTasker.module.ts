import { bindModuleToClassOnToken, createModule, type ModuleLoader } from "@calcom/features/di/di";
import { moduleLoader as loggerServiceModule } from "@calcom/features/di/shared/services/logger.service";
import { CalendarsTriggerTasker } from "@calcom/features/calendars/lib/tasker/CalendarsTriggerTasker";
import { GoogleCancellationHandler } from "@calcom/features/calendars/lib/cancellation-sync/handlers/GoogleCancellationHandler";
import { OutlookCancellationHandler } from "@calcom/features/calendars/lib/cancellation-sync/handlers/OutlookCancellationHandler";

import { cancellationSyncModuleLoader } from "./CalendarsTaskService.module";
import { CALENDARS_TASKER_DI_TOKENS } from "./tokens";

const thisModule = createModule();
const token = CALENDARS_TASKER_DI_TOKENS.CALENDARS_TRIGGER_TASKER;
const moduleToken = CALENDARS_TASKER_DI_TOKENS.CALENDARS_TRIGGER_TASKER_MODULE;

const loadModule = bindModuleToClassOnToken({
  module: thisModule,
  moduleToken,
  token,
  classs: CalendarsTriggerTasker,
  depsMap: {
    logger: loggerServiceModule,
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

export const moduleLoader = {
  token,
  loadModule,
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
