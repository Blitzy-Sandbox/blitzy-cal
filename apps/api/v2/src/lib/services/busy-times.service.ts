import { PrismaBookingRepository } from "@/lib/repositories/prisma-booking.repository";
import { Injectable } from "@nestjs/common";

import { BusyTimesService as BaseBusyTimesService } from "@calcom/platform-libraries/slots";

/**
 * NestJS dependency injection adapter for the Cal.com features {@link BaseBusyTimesService}.
 *
 * This is a pure delegation class with no method overrides. It bridges the NestJS
 * DI container to the Cal.com features DI system by mapping the NestJS-managed
 * {@link PrismaBookingRepository} to the `bookingRepo` property expected by the
 * {@link BaseBusyTimesService} (re-exported from `@calcom/platform-libraries/slots`).
 *
 * Constructor dependency mapping:
 *  - `bookingRepository: PrismaBookingRepository` → `IBusyTimesService.bookingRepo`
 *
 * @see {@link file://packages/features/busyTimes/services/getBusyTimes.ts} for the
 *      `IBusyTimesService` interface and `BusyTimesService` base class implementation.
 */
@Injectable()
export class BusyTimesService extends BaseBusyTimesService {
  constructor(bookingRepository: PrismaBookingRepository) {
    super({
      bookingRepo: bookingRepository,
    });
  }
}
