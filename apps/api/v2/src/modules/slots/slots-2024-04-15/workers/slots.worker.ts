import { AvailableSlotsService } from "@/lib/services/available-slots.service";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { IncomingMessage } from "node:http";
import { parentPort, isMainThread } from "node:worker_threads";

import { SlotsWorkerModule } from "./slots.worker.module";

/**
 * Represents the optional request context forwarded from the parent thread to the worker
 * as part of the worker communication protocol.
 *
 * Extends `Record<string, unknown>` to allow additional arbitrary context properties
 * to be passed through the worker message serialization boundary.
 *
 * @property req - Optional incoming HTTP request object augmented with parsed cookies,
 *   used for request context forwarding (e.g., session cookies) to enable authenticated
 *   slot queries within the worker thread.
 */
interface ContextForGetSchedule extends Record<string, unknown> {
  req?: (IncomingMessage & { cookies: Partial<{ [key: string]: string }> }) | undefined;
}

/**
 * Defines the message structure sent FROM the parent thread TO this worker thread
 * for slot availability computation requests.
 *
 * @property input - The scheduling query payload containing slot availability request
 *   parameters. Typed as `any` due to the worker serialization boundary between threads.
 * @property ctx - Optional {@link ContextForGetSchedule} containing request context
 *   (cookies, headers) for authenticated slot queries.
 */
interface WorkerMessage {
  input: any; // Use a more specific type if available, e.g., TGetScheduleInputSchema
  ctx?: ContextForGetSchedule;
}

/**
 * Defines the structured result envelope posted FROM this worker BACK to the parent
 * thread via `parentPort.postMessage`.
 *
 * The parent thread uses the `success` flag to discriminate between success and
 * failure results.
 *
 * @property success - Indicates whether the slot computation completed without error.
 * @property data - Contains the computed time slots on success. Typed as `any` due to
 *   the serialization boundary between worker and parent threads.
 * @property error - Provides structured error information on failure.
 * @property error.message - Required human-readable error description.
 * @property error.code - Optional error classification code.
 * @property error.stack - Optional stack trace for debugging purposes.
 */
interface WorkerResult {
  success: boolean;
  data?: any; // Use TimeSlots
  error?: {
    message: string;
    code?: string;
    stack?: string;
  };
}

/**
 * Worker thread entrypoint for slot availability computation.
 *
 * Creates a NestJS application context via
 * `NestFactory.createApplicationContext(SlotsWorkerModule)` to bootstrap the full
 * dependency injection graph. The {@link SlotsWorkerModule} provides:
 * - Sentry telemetry integration
 * - Global `ConfigModule` (`ignoreEnvFile: true` — workers receive config from
 *   deployment, not `.env`)
 * - `PrismaWorkerModule` for worker-tuned database connections
 * - `AvailableSlotsModule` with the full 20-provider availability stack
 *
 * **Message Protocol:**
 * - Receives {@link WorkerMessage} from the parent thread via `parentPort.on("message")`
 * - Posts {@link WorkerResult} back to the parent thread via `parentPort.postMessage`
 *
 * **Lifecycle:**
 * - Main-thread guard: checks `isMainThread` and exits with error if accidentally
 *   run directly (not in a worker thread)
 * - Graceful shutdown on `close`/`disconnect` events — calls `app.close()` to release
 *   NestJS resources (database connections, service instances)
 *
 * @see SlotsWorkerModule Co-located in `./slots.worker.module.ts`, spawned by the
 *   slots controller.
 * @throws Exits process with code 1 if executed on the main thread.
 */
async function bootstrapWorkerApp() {
  if (isMainThread) {
    console.error("slots-worker-main.ts should only be run in a worker thread.");
    process.exit(1);
  }

  const app = await NestFactory.createApplicationContext(SlotsWorkerModule);
  const logger = app.get(Logger); // Get the NestJS Logger instance
  logger.log("NestJS worker application bootstrapped successfully.");

  const availableSlotsService = app.get(AvailableSlotsService);

  parentPort?.on("message", async (data: WorkerMessage) => {
    try {
      const { input, ctx } = data;

      const result = await availableSlotsService.getAvailableSlots({ input, ctx });
      parentPort?.postMessage({ success: true, data: result } as WorkerResult);
    } catch (error: any) {
      parentPort?.postMessage({
        success: false,
        error: error instanceof Error ? error : new Error("Unknown error"),
      });
    }
  });

  parentPort?.on("close", async () => {
    logger.log("Worker port closed. Shutting down NestJS worker application.");
    await app.close();
  });

  parentPort?.on("disconnect", async () => {
    logger.log("Worker port disconnected. Shutting down NestJS worker application.");
    await app.close();
  });
}

bootstrapWorkerApp();
