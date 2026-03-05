import { APPS_TYPE_ID_MAPPING } from "@calcom/platform-constants";
import {
  type EventBusyDate,
  getBusyCalendarTimes,
  getConnectedDestinationCalendarsAndEnsureDefaultsInDb,
} from "@calcom/platform-libraries";
import type { Calendar } from "@calcom/platform-types";
import type { PrismaClient } from "@calcom/prisma";
import type { Prisma, User } from "@calcom/prisma/client";
import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { DateTime } from "luxon";
import { z } from "zod";
import { CalendarsRepository } from "@/ee/calendars/calendars.repository";
import { CalendarsCacheService } from "@/ee/calendars/services/calendars-cache.service";
import { AppsRepository } from "@/modules/apps/apps.repository";
import {
  CredentialsRepository,
  CredentialsWithUserEmail,
} from "@/modules/credentials/credentials.repository";
import { PrismaWriteService } from "@/modules/prisma/prisma-write.service";
import { SelectedCalendarsRepository } from "@/modules/selected-calendars/selected-calendars.repository";
import { UsersRepository } from "@/modules/users/users.repository";

/**
 * CalendarsService — API v2 Enterprise Edition calendar orchestration provider.
 *
 * Sprint 3 Backward Compatibility Verification:
 * This service coordinates credential management, caching, and busy time aggregation for the
 * API v2 calendar endpoints. It depends on upstream modules that have been modified in Sprint 3:
 *
 * Upstream changes and backward compatibility assessment:
 *
 * 1. `getBusyCalendarTimes` (from @calcom/platform-libraries → CalendarManager.ts):
 *    - UPDATED in Sprint 3 with new optional 7th parameter: `statusFilter?: string[]`
 *    - This service calls it at lines 95-100 with only 4 arguments (credentials, dateFrom, dateTo, selectedCalendars)
 *    - Backward compatible: The new parameters (mode, includeTimeZone, statusFilter) are all optional
 *      and default to their previous behavior when not provided
 *    - Future iteration: To expose statusFilter through API v2, extend CalendarBusyTimesInput DTO
 *      to accept statusFilter and pass it as the 7th argument
 *
 * 2. Credential model (packages/prisma/schema.prisma):
 *    - UPDATED with new nullable `externalCancellationSyncEnabled` Boolean field
 *    - Backward compatible: The new field is nullable (defaults to NULL), so existing
 *      credential queries, spreads, and comparisons continue to work unchanged
 *    - `buildNonDelegationCredentials` (lines 43-52) uses spread operator (`...credential`)
 *      which correctly includes any new fields without code changes
 *
 * 3. CalendarManager.ts (packages/features/calendars/lib/CalendarManager.ts):
 *    - UPDATED with `statusFilter` threading and JSDoc for cancellation-sync/buffer-sync
 *    - Not directly consumed by this service — this service imports `getBusyCalendarTimes`
 *      which is a re-exported function from CalendarManager
 *
 * 4. Calendar.d.ts types (packages/types/Calendar.d.ts):
 *    - UPDATED with `statusFilter` on `GetAvailabilityParams` and optional subscription methods on Calendar interface
 *    - This service only imports `Calendar` type (line 7) for parameter typing in calendar loading methods
 *    - The Calendar interface additions are optional methods — no impact on this service
 *
 * Conclusion: No code changes required. All upstream modifications are backward-compatible.
 */
@Injectable()
export class CalendarsService {
  private oAuthCalendarResponseSchema = z.object({ client_id: z.string(), client_secret: z.string() });

  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly credentialsRepository: CredentialsRepository,
    private readonly appsRepository: AppsRepository,
    private readonly calendarsRepository: CalendarsRepository,
    private readonly dbWrite: PrismaWriteService,
    private readonly selectedCalendarsRepository: SelectedCalendarsRepository,
    private readonly calendarsCacheService: CalendarsCacheService
  ) {}

  /**
   * Creates non-delegation copies of credentials by nullifying delegation fields.
   *
   * Sprint 3 Verification (Credential model changes):
   * This method uses spread operator (`...credential`) which correctly propagates all
   * credential fields including the new nullable `externalCancellationSyncEnabled` field.
   * The only fields explicitly set are `delegatedTo`, `delegatedToId`, and
   * `delegationCredentialId` (all set to null). No changes needed — the spread pattern
   * is inherently forward-compatible with additive model changes.
   */
  private buildNonDelegationCredentials<TCredential>(credentials: TCredential[]) {
    return credentials
      .map((credential) => ({
        ...credential,
        delegatedTo: null,
        delegatedToId: null,
        delegationCredentialId: null,
      }))
      .filter((credential) => !!credential);
  }

  /**
   * Retrieves connected and destination calendars for a user, with Redis caching.
   *
   * Sprint 3 Verification (Cache behavior):
   * This method calls `getConnectedDestinationCalendarsAndEnsureDefaultsInDb` which
   * operates on the user's calendar credentials and selected calendars. The upstream
   * CalendarManager modifications (statusFilter threading) do NOT affect this method
   * because `getConnectedDestinationCalendarsAndEnsureDefaultsInDb` is a separate
   * function that handles calendar listing and default selection, not availability queries.
   * Cache key generation (via CalendarsCacheService) and TTL remain unchanged.
   */
  async getCalendars(userId: number, ensureDefaultSelectedCalendars = false) {
    const cachedResult = await this.calendarsCacheService.getConnectedAndDestinationCalendarsCache(userId);

    if (cachedResult && !ensureDefaultSelectedCalendars) {
      return cachedResult;
    }

    const userWithCalendars = await this.usersRepository.findByIdWithCalendars(userId);
    if (!userWithCalendars) {
      throw new NotFoundException("User not found");
    }
    const result = await getConnectedDestinationCalendarsAndEnsureDefaultsInDb({
      user: {
        ...userWithCalendars,
        allSelectedCalendars: userWithCalendars.selectedCalendars,
        userLevelSelectedCalendars: userWithCalendars.selectedCalendars.filter(
          (calendar) => !calendar.eventTypeId
        ),
      },
      onboarding: ensureDefaultSelectedCalendars,
      eventTypeId: null,
      prisma: this.dbWrite.prisma as unknown as PrismaClient,
    });
    await this.calendarsCacheService.setConnectedAndDestinationCalendarsCache(userId, result);

    return result;
  }

  /**
   * Aggregates busy times from connected calendars for a given date range.
   *
   * Sprint 3 CI-004 Backward Compatibility:
   * This method calls `getBusyCalendarTimes` (lines 95-100) with 4 arguments:
   *   getBusyCalendarTimes(nonDelegationCredentials, dateFrom, dateTo, selectedCalendars)
   *
   * The upstream `getBusyCalendarTimes` function has been updated in Sprint 3 with additional
   * optional parameters:
   *   getBusyCalendarTimes(withCredentials, dateFrom, dateTo, selectedCalendars, mode?, includeTimeZone?, statusFilter?)
   *
   * The current 4-argument call continues to work correctly because:
   * - `mode` defaults to "slots" when undefined
   * - `includeTimeZone` defaults to false when undefined
   * - `statusFilter` defaults to undefined (uses adapter's default conflict detection behavior)
   *
   * To expose configurable conflict detection (CI-004 statusFilter) through API v2 in a
   * future iteration:
   * 1. Extend CalendarBusyTimesInput DTO to include optional `statusFilter: string[]`
   * 2. Pass statusFilter as the 7th argument to getBusyCalendarTimes
   * 3. This would allow API v2 consumers to configure which event statuses block availability
   *    (matching Calendly's "What's considered unavailable?" behavior)
   */
  async getBusyTimes(
    calendarsToLoad: Calendar[],
    userId: User["id"],
    dateFrom: string,
    dateTo: string,
    timezone: string
  ) {
    const credentials = await this.getUniqCalendarCredentials(calendarsToLoad, userId);
    const composedSelectedCalendars = await this.getCalendarsWithCredentials(
      credentials,
      calendarsToLoad,
      userId
    );
    const calendarBusyTimesQuery = await getBusyCalendarTimes(
      this.buildNonDelegationCredentials(credentials),
      dateFrom,
      dateTo,
      composedSelectedCalendars
    );
    if (!calendarBusyTimesQuery.success) {
      throw new InternalServerErrorException(
        "Unable to fetch connected calendars events. Please try again later."
      );
    }
    const calendarBusyTimesConverted = calendarBusyTimesQuery.data.map(
      (busyTime: EventBusyDate & { timeZone?: string }) => {
        const busyTimeStart = DateTime.fromJSDate(new Date(busyTime.start)).setZone(timezone);
        const busyTimeEnd = DateTime.fromJSDate(new Date(busyTime.end)).setZone(timezone);
        const busyTimeStartDate = busyTimeStart.toJSDate();
        const busyTimeEndDate = busyTimeEnd.toJSDate();
        return {
          ...busyTime,
          start: busyTimeStartDate,
          end: busyTimeEndDate,
        };
      }
    );
    return calendarBusyTimesConverted;
  }

  /**
   * Retrieves unique calendar credentials by ownership for the given calendars.
   *
   * Sprint 3 Verification (Credential model changes):
   * This method queries credentials by ID and userId via CredentialsRepository.
   * The new nullable `externalCancellationSyncEnabled` field on the Credential model
   * is included in query results but is not accessed by this method — it only uses
   * credential IDs for deduplication and ownership verification. No changes needed.
   */
  async getUniqCalendarCredentials(calendarsToLoad: Calendar[], userId: User["id"]) {
    const uniqueCredentialIds = Array.from(new Set(calendarsToLoad.map((item) => item.credentialId)));
    const credentials = await this.credentialsRepository.getUserCredentialsByIds(userId, uniqueCredentialIds);

    if (credentials.length !== uniqueCredentialIds.length) {
      throw new UnauthorizedException("These credentials do not belong to you");
    }

    return credentials;
  }

  /**
   * Enriches calendar objects with credential metadata (userId, integration type).
   *
   * Sprint 3 Verification (Credential model changes):
   * This method maps calendars to their corresponding credentials and extracts `credential.type`
   * for integration identification. The new nullable fields on the Credential model do not
   * affect this method — it only accesses `credential.id` and `credential.type`.
   */
  async getCalendarsWithCredentials(
    credentials: CredentialsWithUserEmail,
    calendarsToLoad: Calendar[],
    userId: User["id"]
  ) {
    const composedSelectedCalendars = calendarsToLoad.map((calendar) => {
      const credential = credentials.find((item) => item.id === calendar.credentialId);
      if (!credential) {
        throw new UnauthorizedException("These credentials do not belong to you");
      }
      return {
        ...calendar,
        userId,
        integration: credential.type,
      };
    });
    return composedSelectedCalendars;
  }

  async getAppKeys(appName: string) {
    const app = await this.appsRepository.getAppBySlug(appName);

    if (!app) {
      throw new NotFoundException();
    }

    const { client_id, client_secret } = this.oAuthCalendarResponseSchema.parse(app.keys);

    if (!client_id) {
      throw new NotFoundException();
    }

    if (!client_secret) {
      throw new NotFoundException();
    }

    return { client_id, client_secret };
  }

  /**
   * Validates that calendar credentials exist for the given credentialId and userId.
   *
   * Sprint 3 Verification:
   * This method delegates to CalendarsRepository.getCalendarCredentials which performs
   * a minimal Prisma select (credential + nested user.email + app slug/category/dirName).
   * The Credential model's new nullable fields are NOT included in this select projection
   * and do not affect validation behavior.
   */
  async checkCalendarCredentials(credentialId: number, userId: number) {
    const credential = await this.calendarsRepository.getCalendarCredentials(credentialId, userId);
    if (!credential) {
      throw new NotFoundException("Calendar credentials not found");
    }
  }

  /**
   * Creates or updates a calendar credential and links it to a selected calendar entry.
   *
   * Sprint 3 Verification:
   * This method upserts credentials via CredentialsRepository.upsertUserAppCredential and
   * creates selected calendar associations. The upsert operation is compatible with the
   * Credential model's new nullable `externalCancellationSyncEnabled` field because:
   * - The upsert only sets `type`, `key`, `userId`, and optionally `credentialId`
   * - The new nullable field defaults to NULL in the database
   * - Cache invalidation via CalendarsCacheService continues to work correctly
   */
  async createAndLinkCalendarEntry(
    userId: number,
    externalId: string,
    key: Prisma.InputJsonValue,
    calendarType: keyof typeof APPS_TYPE_ID_MAPPING,
    credentialId?: number | null
  ) {
    const credential = await this.credentialsRepository.upsertUserAppCredential(
      calendarType,
      key,
      userId,
      credentialId
    );

    await this.selectedCalendarsRepository.upsertSelectedCalendar(
      externalId,
      credential.id,
      userId,
      calendarType
    );

    await this.calendarsCacheService.deleteConnectedAndDestinationCalendarsCache(userId);
  }

  /**
   * Checks if a calendar credential is valid (not marked as invalid).
   *
   * Sprint 3 Verification:
   * This method queries credentials by userId, credentialId, and type, then checks
   * the `invalid` flag. The new nullable `externalCancellationSyncEnabled` field
   * does not affect validity checking — it is a separate concern managed by
   * the cancellation-sync feature (CI-001 gap).
   */
  async checkCalendarCredentialValidity(userId: number, credentialId: number, type: string) {
    const credential = await this.credentialsRepository.getUserCredentialById(userId, credentialId, type);

    return !credential?.invalid;
  }
}
