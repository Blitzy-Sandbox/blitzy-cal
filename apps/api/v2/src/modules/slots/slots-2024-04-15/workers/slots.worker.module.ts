// apps/api/v2/src/modules/slots/slots-2024-04-15/workers/slots-worker.module.ts
// Needed if ConfigService is used anywhere
import appConfig from "@/config/app";
import { AvailableSlotsModule } from "@/lib/modules/available-slots.module";
import { PrismaWorkerModule } from "@/modules/prisma/prisma-worker.module";
import { Module, Logger } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { SentryModule } from "@sentry/nestjs/setup";

/**
 * NestJS module defining the dependency-injection context for worker threads that
 * execute slot availability computations.
 *
 * Consumed by `slots.worker.ts` via
 * `NestFactory.createApplicationContext(SlotsWorkerModule)` to bootstrap the
 * worker DI graph independently of the HTTP server.
 *
 * **Imported modules:**
 * - `SentryModule.forRoot()` — Sentry telemetry and error instrumentation scoped
 *   to the worker process.
 * - `ConfigModule.forRoot({ ignoreEnvFile: true, ... })` — Global application
 *   configuration loaded from deployment environment variables rather than `.env`
 *   files, because workers receive their configuration from the deployment
 *   environment (e.g. Kubernetes secrets / container env) and must not depend on
 *   filesystem `.env` presence.
 * - `PrismaWorkerModule` — Worker-tuned Prisma database client with separate
 *   connection-pool sizing from the HTTP server's `PrismaModule`, ensuring that
 *   worker DB connections do not contend with request-serving connections.
 * - `AvailableSlotsModule` — Reuses the same 20-provider availability stack as the
 *   HTTP controller path (11 repositories + 9 services), with
 *   `AvailableSlotsService` as the exported orchestrator responsible for slot
 *   generation, busy-time aggregation, and user-availability resolution.
 *
 * **Providers:**
 * - `Logger` — Registered so that all services resolved through this module log
 *   through the NestJS `Logger` abstraction, preserving consistent log formatting
 *   and transport in the worker context.
 *
 * **No controllers** are defined because workers do not serve HTTP traffic.
 *
 * **No exports** are defined because the module is self-contained for the worker
 * context — services are resolved directly via `app.get()` within the worker
 * bootstrap logic rather than being imported by other modules.
 */
@Module({
  imports: [
    SentryModule.forRoot(),
    ConfigModule.forRoot({
      ignoreEnvFile: true,
      isGlobal: true,
      load: [appConfig],
    }),
    PrismaWorkerModule,
    AvailableSlotsModule,
  ],
  providers: [Logger],
})
export class SlotsWorkerModule {}
