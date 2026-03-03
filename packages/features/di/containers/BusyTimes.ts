import type { BusyTimesService } from "@calcom/features/busyTimes/services/getBusyTimes";
import { DI_TOKENS } from "@calcom/features/di/tokens";
import { prismaModule } from "@calcom/features/di/modules/Prisma";

import { createContainer } from "../di";
import { bookingRepositoryModule } from "../modules/Booking";
import { busyTimesModule } from "../modules/BusyTimes";

/**
 * Standalone DI container for the BusyTimesService.
 *
 * This is the minimal container needed to resolve a BusyTimesService instance
 * for direct busy-time queries outside the full availability pipeline. The full
 * AvailableSlots container (see ./AvailableSlots.ts) also loads BusyTimes as a
 * transitive dependency alongside 15+ other modules.
 *
 * Load order: Infrastructure (Prisma) → Repository (Booking) → Service (BusyTimes)
 */
const container = createContainer();
container.load(DI_TOKENS.PRISMA_MODULE, prismaModule);
container.load(DI_TOKENS.BOOKING_REPOSITORY_MODULE, bookingRepositoryModule);
container.load(DI_TOKENS.BUSY_TIMES_SERVICE_MODULE, busyTimesModule);

export function getBusyTimesService() {
  return container.get<BusyTimesService>(DI_TOKENS.BUSY_TIMES_SERVICE);
}
