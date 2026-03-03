import { PrismaBookingRepository } from "@/lib/repositories/prisma-booking.repository";
import { PrismaEventTypeRepository } from "@/lib/repositories/prisma-event-type.repository";
import { PrismaFeaturesRepository } from "@/lib/repositories/prisma-features.repository";
import { PrismaOOORepository } from "@/lib/repositories/prisma-ooo.repository";
import { PrismaRoutingFormResponseRepository } from "@/lib/repositories/prisma-routing-form-response.repository";
import { PrismaScheduleRepository } from "@/lib/repositories/prisma-schedule.repository";
import { PrismaSelectedSlotRepository } from "@/lib/repositories/prisma-selected-slot.repository";
import { PrismaTeamRepository } from "@/lib/repositories/prisma-team.repository";
import { PrismaUserRepository } from "@/lib/repositories/prisma-user.repository";
import { BusyTimesService } from "@/lib/services/busy-times.service";
import { CheckBookingLimitsService } from "@/lib/services/check-booking-limits.service";
import { NoSlotsNotificationService } from "@/lib/services/no-slots-notification.service";
import { OrgMembershipLookupService } from "@/lib/services/org-membership-lookup.service";
import { QualifiedHostsService } from "@/lib/services/qualified-hosts.service";
import { RedisService } from "@/modules/redis/redis.service";
import { Injectable } from "@nestjs/common";

import { AvailableSlotsService as BaseAvailableSlotsService } from "@calcom/platform-libraries/slots";

import { UserAvailabilityService } from "./user-availability.service";

/**
 * NestJS DI adapter for the Cal.com features-layer `AvailableSlotsService`.
 *
 * This class extends {@link BaseAvailableSlotsService} (re-exported from
 * `@calcom/platform-libraries/slots`, which itself re-exports the canonical
 * `AvailableSlotsService` from `@calcom/trpc/server/routers/viewer/slots/util`).
 *
 * It is a **pure delegation class** — it contains no method overrides and no
 * additional business logic. All availability computation (slot generation,
 * busy-time subtraction, aggregated multi-host intersection, etc.) is handled
 * entirely by the base class. The sole purpose of this adapter is to bridge
 * the NestJS dependency-injection system to the `IAvailableSlotsService`
 * interface contract expected by the base class constructor.
 *
 * ### Constructor Dependency Mappings
 *
 * All 16 NestJS-injected constructor parameters are forwarded to `super()`
 * as an `IAvailableSlotsService` object (see interface definition at
 * `packages/trpc/server/routers/viewer/slots/util.ts`):
 *
 * | # | NestJS Constructor Param              | `IAvailableSlotsService` Property   |
 * |---|---------------------------------------|-------------------------------------|
 * | 1 | `oooRepoDependency`                   | `oooRepo`                           |
 * | 2 | `scheduleRepoDependency`              | `scheduleRepo`                      |
 * | 3 | `teamRepository`                      | `teamRepo`                          |
 * | 4 | `routingFormResponseRepository`       | `routingFormResponseRepo`           |
 * | 5 | `bookingRepository`                   | `bookingRepo`                       |
 * | 6 | `selectedSlotRepository`              | `selectedSlotRepo`                  |
 * | 7 | `eventTypeRepository`                 | `eventTypeRepo`                     |
 * | 8 | `userRepository`                      | `userRepo`                          |
 * | 9 | `redisService`                        | `redisClient`                       |
 * |10 | `featuresRepository`                  | `featuresRepo`                      |
 * |11 | `qualifiedHostsService`               | `qualifiedHostsService` (shorthand) |
 * |12 | `checkBookingLimitsService`           | `checkBookingLimitsService` (shorthand) |
 * |13 | `userAvailabilityService`             | `userAvailabilityService` (shorthand) |
 * |14 | `busyTimesService`                    | `busyTimesService` (shorthand)      |
 * |15 | `noSlotsNotificationService`          | `noSlotsNotificationService` (shorthand) |
 * |16 | `orgMembershipLookupService`          | `orgMembershipLookup`               |
 *
 * All 16 providers are registered by the NestJS `AvailableSlotsModule`
 * (`apps/api/v2/src/lib/modules/available-slots.module.ts`).
 *
 * @see {@link BaseAvailableSlotsService} — base class from `@calcom/platform-libraries/slots`
 * @see `IAvailableSlotsService` — interface at `packages/trpc/server/routers/viewer/slots/util.ts`
 * @see `AvailableSlotsModule` — NestJS module at `apps/api/v2/src/lib/modules/available-slots.module.ts`
 */
@Injectable()
export class AvailableSlotsService extends BaseAvailableSlotsService {
  constructor(
    oooRepoDependency: PrismaOOORepository,
    scheduleRepoDependency: PrismaScheduleRepository,
    teamRepository: PrismaTeamRepository,
    routingFormResponseRepository: PrismaRoutingFormResponseRepository,
    bookingRepository: PrismaBookingRepository,
    selectedSlotRepository: PrismaSelectedSlotRepository,
    eventTypeRepository: PrismaEventTypeRepository,
    userRepository: PrismaUserRepository,
    redisService: RedisService,
    featuresRepository: PrismaFeaturesRepository,
    qualifiedHostsService: QualifiedHostsService,
    checkBookingLimitsService: CheckBookingLimitsService,
    userAvailabilityService: UserAvailabilityService,
    busyTimesService: BusyTimesService,
    noSlotsNotificationService: NoSlotsNotificationService,
    orgMembershipLookupService: OrgMembershipLookupService
  ) {
    super({
      oooRepo: oooRepoDependency,
      scheduleRepo: scheduleRepoDependency,
      teamRepo: teamRepository,
      routingFormResponseRepo: routingFormResponseRepository,
      bookingRepo: bookingRepository,
      selectedSlotRepo: selectedSlotRepository,
      eventTypeRepo: eventTypeRepository,
      userRepo: userRepository,
      redisClient: redisService,
      checkBookingLimitsService,
      userAvailabilityService,
      busyTimesService,
      qualifiedHostsService,
      featuresRepo: featuresRepository,
      noSlotsNotificationService,
      orgMembershipLookup: orgMembershipLookupService,
    });
  }
}
