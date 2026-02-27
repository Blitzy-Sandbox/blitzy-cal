import { getAvailableSlotsService } from "@calcom/features/di/containers/AvailableSlots";

import type { GetScheduleOptions } from "./types";

/**
 * Thin delegation handler for the `getSchedule` tRPC procedure.
 *
 * Bootstraps the full dependency injection graph (15+ modules including Redis, Prisma,
 * all repositories, and service layers) via the `@evyweb/ioctopus` container resolved by
 * {@link getAvailableSlotsService} from `@calcom/features/di/containers/AvailableSlots`,
 * then delegates the slot availability computation to `AvailableSlotsService.getAvailableSlots()`.
 *
 * @param options - {@link GetScheduleOptions} containing:
 *   - `ctx`   – Optional context carrying the incoming request and cookies for authentication
 *   - `input` – Zod-validated schedule query parameters (event type, time range, timezone, etc.)
 * @returns Date-keyed slot availability maps produced by `AvailableSlotsService.getAvailableSlots()`.
 *
 * @remarks
 * This handler is lazy-imported by the viewer slots router (`_router.tsx`) to keep the
 * initial bundle lightweight. The full DI service graph — including the AvailableSlots
 * container with its transitive repository, service, and caching dependencies — is only
 * instantiated at call time.
 */
export const getScheduleHandler = async ({ ctx, input }: GetScheduleOptions) => {
  const availableSlotsService = getAvailableSlotsService();
  return await availableSlotsService.getAvailableSlots({ ctx, input });
};
