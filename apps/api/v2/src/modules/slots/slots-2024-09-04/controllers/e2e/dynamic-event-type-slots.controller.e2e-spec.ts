/**
 * @file E2E test suite for dynamic event-type slot availability via the `VERSION_2024_09_04` Slots API.
 * @module SlotsModule_2024_09_04 E2E Tests — Dynamic Event Types
 *
 * @description
 * Validates that `GET /v2/slots` with `usernames` (comma-separated) and `organizationSlug` query
 * parameters correctly returns intersected availability for two organization teammates as a
 * dynamic event type. The test exercises the full slot generation pipeline — from schedule
 * creation through availability computation to API response serialization.
 *
 * ## Coverage Areas
 *
 * - **UTC slot retrieval (default timezone)** — Asserted against the `expectedSlotsUTC` golden
 *   fixture, which defines 8 hourly slots (07:00–14:00 UTC) per day for the 5-day range.
 * - **Europe/Rome timezone override** — Asserted against the `expectedSlotsRome` golden fixture,
 *   which defines 8 hourly slots (09:00–16:00 +02:00) per day for the same 5-day range.
 * - **5-day date range**: 2050-09-05 through 2050-09-09 with 60-minute duration slots.
 * - **`CAL_API_VERSION_HEADER`** set to `VERSION_2024_09_04` on all HTTP requests.
 * - **`GetSlotsOutput_2024_09_04`** response typing with `SUCCESS_STATUS` validation on each
 *   response body.
 *
 * ## Test Infrastructure
 *
 * Uses `Test.createTestingModule` with the following NestJS modules:
 * - `AppModule` — Root application module
 * - `PrismaModule` — Database access layer
 * - `UsersModule` — User management
 * - `TokensModule` — Authentication token handling
 * - `SchedulesModule_2024_06_11` — Schedule CRUD operations (used to seed test schedules)
 * - `SlotsModule_2024_09_04` — Slot availability endpoint under test
 *
 * The `PermissionsGuard` is overridden to always return `true`, bypassing authorization checks
 * for test determinism. The `withApiAuth` wrapper provides API key authentication context.
 *
 * ## Fixture Setup
 *
 * - **Organization**: Created with a random slug via `OrganizationRepositoryFixture`.
 * - **Users**: Two users (`userOne`, `userTwo`) with random email addresses via
 *   `UserRepositoryFixture`.
 * - **Org Profiles**: Two organization profiles with usernames `"teammate-one"` and
 *   `"teammate-two"` linked to the organization via `ProfileRepositoryFixture`.
 * - **Schedules**: Default Mon–Fri 9 AM–5 PM Europe/Rome schedules for both users, created
 *   via `SchedulesService_2024_06_11.createUserSchedule`.
 *
 * ## Cleanup
 *
 * - User deletion by email address
 * - Organization deletion by ID
 * - NestJS application closure
 *
 * ## Golden Fixtures
 *
 * - `expectedSlotsUTC` — 07:00–14:00 UTC slots per day (Mon–Fri), 8 hourly slots each day.
 * - `expectedSlotsRome` — 09:00–16:00 Europe/Rome (+02:00) slots per day, 8 hourly slots each day.
 *
 * Both fixtures are imported from `./expected-slots`.
 *
 * @see {@link ./expected-slots.ts} — Golden test fixture definitions
 * @see {@link packages/features/schedules/lib/slots.ts} — Slot generation algorithm producing these outputs
 */
import { CAL_API_VERSION_HEADER, SUCCESS_STATUS, VERSION_2024_09_04 } from "@calcom/platform-constants";
import type { CreateScheduleInput_2024_06_11 } from "@calcom/platform-types";
import type { Profile, Team, User } from "@calcom/prisma/client";
import { INestApplication } from "@nestjs/common";
import { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { OrganizationRepositoryFixture } from "test/fixtures/repository/organization.repository.fixture";
import { ProfileRepositoryFixture } from "test/fixtures/repository/profiles.repository.fixture";
import { UserRepositoryFixture } from "test/fixtures/repository/users.repository.fixture";
import { randomString } from "test/utils/randomString";
import { withApiAuth } from "test/utils/withApiAuth";
import { AppModule } from "@/app.module";
import { bootstrap } from "@/bootstrap";
import { SchedulesModule_2024_06_11 } from "@/ee/schedules/schedules_2024_06_11/schedules.module";
import { SchedulesService_2024_06_11 } from "@/ee/schedules/schedules_2024_06_11/services/schedules.service";
import { PermissionsGuard } from "@/modules/auth/guards/permissions/permissions.guard";
import { PrismaModule } from "@/modules/prisma/prisma.module";
import {
  expectedSlotsRome,
  expectedSlotsUTC,
} from "@/modules/slots/slots-2024-09-04/controllers/e2e/expected-slots";
import { GetSlotsOutput_2024_09_04 } from "@/modules/slots/slots-2024-09-04/outputs/get-slots.output";
import { SlotsModule_2024_09_04 } from "@/modules/slots/slots-2024-09-04/slots.module";
import { TokensModule } from "@/modules/tokens/tokens.module";
import { UsersModule } from "@/modules/users/users.module";

describe("Slots 2024-09-04 Endpoints", () => {
  describe("Dynamic event type slots", () => {
    let app: INestApplication;

    let userRepositoryFixture: UserRepositoryFixture;
    let schedulesService: SchedulesService_2024_06_11;
    let organizationsRepositoryFixture: OrganizationRepositoryFixture;
    let profileRepositoryFixture: ProfileRepositoryFixture;

    const userEmailOne = `slots-2024-09-04-user-1-dynamic-slots-${randomString()}@api.com`;
    const userEmailTwo = `slots-2024-09-04-user-2-dynamic-slots-${randomString()}@api.com`;

    let organization: Team;
    let userOne: User;
    let userTwo: User;
    let orgProfileOne: Profile;
    let orgProfileTwo: Profile;

    beforeAll(async () => {
      const moduleRef = await withApiAuth(
        userEmailOne,
        Test.createTestingModule({
          imports: [
            AppModule,
            PrismaModule,
            UsersModule,
            TokensModule,
            SchedulesModule_2024_06_11,
            SlotsModule_2024_09_04,
          ],
        })
      )
        .overrideGuard(PermissionsGuard)
        .useValue({
          canActivate: () => true,
        })
        .compile();

      userRepositoryFixture = new UserRepositoryFixture(moduleRef);
      schedulesService = moduleRef.get<SchedulesService_2024_06_11>(SchedulesService_2024_06_11);
      organizationsRepositoryFixture = new OrganizationRepositoryFixture(moduleRef);
      profileRepositoryFixture = new ProfileRepositoryFixture(moduleRef);

      const orgSlug = `slots-2024-09-04-org-${randomString()}`;
      organization = await organizationsRepositoryFixture.create({
        name: orgSlug,
        isOrganization: true,
        slug: orgSlug,
      });

      userOne = await userRepositoryFixture.create({
        email: userEmailOne,
        name: userEmailOne,
        username: userEmailOne,
      });

      userTwo = await userRepositoryFixture.create({
        email: userEmailTwo,
        name: userEmailTwo,
        username: userEmailTwo,
      });

      orgProfileOne = await profileRepositoryFixture.create({
        uid: `usr-${userOne.id}`,
        username: "teammate-one",
        organization: {
          connect: {
            id: organization.id,
          },
        },
        user: {
          connect: {
            id: userOne.id,
          },
        },
      });

      orgProfileTwo = await profileRepositoryFixture.create({
        uid: `usr-${userTwo.id}`,
        username: "teammate-two",
        organization: {
          connect: {
            id: organization.id,
          },
        },
        user: {
          connect: {
            id: userTwo.id,
          },
        },
      });

      const userSchedule: CreateScheduleInput_2024_06_11 = {
        name: "working time",
        timeZone: "Europe/Rome",
        isDefault: true,
      };
      // note(Lauris): this creates default schedule monday to friday from 9AM to 5PM in Europe/Rome timezone
      await schedulesService.createUserSchedule(userOne.id, userSchedule);
      await schedulesService.createUserSchedule(userTwo.id, userSchedule);

      app = moduleRef.createNestApplication();
      bootstrap(app as NestExpressApplication);

      await app.init();
    });

    it("should get slots in UTC by usernames", async () => {
      return request(app.getHttpServer())
        .get(
          `/v2/slots?usernames=${orgProfileOne.username},${orgProfileTwo.username}&organizationSlug=${organization.slug}&start=2050-09-05&end=2050-09-09&duration=60`
        )
        .set(CAL_API_VERSION_HEADER, VERSION_2024_09_04)
        .expect(200)
        .then(async (response) => {
          const responseBody: GetSlotsOutput_2024_09_04 = response.body;
          expect(responseBody.status).toEqual(SUCCESS_STATUS);
          const slots = responseBody.data;

          expect(slots).toBeDefined();
          const days = Object.keys(slots);
          expect(days.length).toEqual(5);
          expect(slots).toEqual(expectedSlotsUTC);
        });
    });

    it("should get slots in specified timezone and in specified duration by usernames", async () => {
      return request(app.getHttpServer())
        .get(
          `/v2/slots?usernames=${orgProfileOne.username},${orgProfileTwo.username}&organizationSlug=${organization.slug}&start=2050-09-05&end=2050-09-09&duration=60&timeZone=Europe/Rome`
        )
        .set(CAL_API_VERSION_HEADER, VERSION_2024_09_04)
        .expect(200)
        .then(async (response) => {
          const responseBody: GetSlotsOutput_2024_09_04 = response.body;
          expect(responseBody.status).toEqual(SUCCESS_STATUS);
          const slots = responseBody.data;

          expect(slots).toBeDefined();
          const days = Object.keys(slots);
          expect(days.length).toEqual(5);
          expect(slots).toEqual(expectedSlotsRome);
        });
    });

    afterAll(async () => {
      await userRepositoryFixture.deleteByEmail(userOne.email);
      await userRepositoryFixture.deleteByEmail(userTwo.email);
      await organizationsRepositoryFixture.delete(organization.id);
      await app.close();
    });
  });
});
