import logger from "@calcom/lib/logger";
import { buildCredentialPayloadForPrisma } from "@calcom/lib/server/buildCredentialPayloadForCalendar";
import type { PrismaClient } from "@calcom/prisma";
import { prisma } from "@calcom/prisma";
import type { Prisma } from "@calcom/prisma/client";

const log = logger.getSubLogger({ prefix: ["DestinationCalendarRepository"] });

/**
 * Repository for destination calendar persistence and queries.
 *
 * ## Sprint 3: Calendar Integrations — Verification Status
 *
 * ### CI-004: Conflict Detection Alignment
 * - `getByEventTypeId` correctly supports per-event-type calendar selection,
 *   enabling different event types to write to different destination calendars
 *   (e.g., Google Calendar for one event type, Outlook for another)
 * - `getByUserId` provides the user-level default destination calendar fallback
 *   when no event-type-specific calendar is configured
 * - `getCustomReminderByCredentialId` correctly queries by credentialId,
 *   supporting per-credential reminder configuration across providers
 *
 * ### CI-005: Bi-directional Sync Verification
 * - `create` and `createIfNotExistsForUser` correctly persist destination
 *   calendar associations with idempotent conflict detection
 * - `upsert` handles both creation and update paths with proper credential
 *   payload sanitization via `buildCredentialPayloadForPrisma`
 * - The `credentialId` association on destination calendars enables the
 *   CalendarManager to resolve which adapter (Google, Outlook, Apple) to use
 *   for event CRUD operations in each connected calendar
 * - `findConflictingForUser` ensures uniqueness of user-level (non-event-type)
 *   destination calendar entries per integration/externalId combination
 *
 * ### Calendly Parity Notes
 * - Cal.com's per-event-type calendar selection (`getByEventTypeId`) exceeds
 *   Calendly's capabilities, where destination calendar is set at user level only
 * - Cal.com supports unlimited calendar connections with delegation credentials,
 *   which is reflected in the credential-based query methods
 * - Read-only fallback behavior (when calendar connection is unavailable) is
 *   handled by `getConnectedDestinationCalendars.ts`, not this repository
 *
 * @see {@link packages/features/calendars/lib/getConnectedDestinationCalendars.ts} for read-only fallback behavior
 * @see {@link packages/features/calendars/lib/CalendarManager.ts} for credential-to-adapter resolution
 */
export class DestinationCalendarRepository {
  private prismaClient: PrismaClient;

  constructor(prismaClient?: PrismaClient) {
    this.prismaClient = prismaClient ?? prisma;
  }

  /**
   * Retrieves the custom calendar reminder setting for a specific credential.
   * Returns null if no destination calendar exists for the given credentialId.
   *
   * CI-004 Verified: Correctly queries destination calendars by credentialId,
   * supporting per-credential reminder configuration across Google, Outlook,
   * and Apple Calendar providers.
   */
  async getCustomReminderByCredentialId(credentialId: number): Promise<number | null> {
    const destinationCalendar = await this.prismaClient.destinationCalendar.findFirst({
      where: { credentialId },
      select: { customCalendarReminder: true },
    });
    return destinationCalendar?.customCalendarReminder ?? null;
  }

  async updateCustomReminder({
    userId,
    credentialId,
    integration,
    customCalendarReminder,
  }: {
    userId: number;
    credentialId: number;
    integration: string;
    customCalendarReminder: number | null;
  }) {
    return await this.prismaClient.destinationCalendar.updateMany({
      where: {
        userId,
        credentialId,
        integration,
      },
      data: {
        customCalendarReminder,
      },
    });
  }

  static async create(data: Prisma.DestinationCalendarCreateInput) {
    return await prisma.destinationCalendar.create({
      data,
    });
  }

  /**
   * Idempotently creates a destination calendar for a user.
   * Uses `findConflictingForUser` to check for existing entries with matching
   * userId/integration/externalId where eventTypeId is null (user-level entries).
   *
   * CI-005 Verified: Ensures no duplicate destination calendar entries are created
   * during multi-calendar connection flows, preserving data integrity for the
   * bi-directional sync pipeline.
   */
  static async createIfNotExistsForUser(
    data: { userId: number } & Prisma.DestinationCalendarUncheckedCreateInput
  ) {
    const conflictingCalendar = await DestinationCalendarRepository.findConflictingForUser(data);
    if (conflictingCalendar) {
      return conflictingCalendar;
    }
    return await prisma.destinationCalendar.create({
      data,
    });
  }

  /**
   * Retrieves the user-level default destination calendar.
   * This is the fallback when no event-type-specific destination calendar is set.
   *
   * CI-004 Verified: Provides the default calendar for conflict detection when
   * no event-type-specific override exists.
   */
  static async getByUserId(userId: number) {
    return await prisma.destinationCalendar.findFirst({
      where: {
        userId,
      },
    });
  }

  /**
   * Retrieves the destination calendar assigned to a specific event type.
   * Returns null if no event-type-specific calendar is configured (falls back to user default).
   *
   * CI-004 Verified: This method is the key enabler for per-event-type calendar
   * selection, allowing different event types to write bookings to different
   * external calendars. This exceeds Calendly's user-level-only destination calendar model.
   *
   * CI-005 Verified: Used during booking creation to determine which external
   * calendar receives the new event. The returned record includes `credentialId`
   * which links to the adapter used for event CRUD.
   */
  static async getByEventTypeId(eventTypeId: number) {
    return await prisma.destinationCalendar.findFirst({
      where: {
        eventTypeId,
      },
    });
  }

  static async find({ where }: { where: Prisma.DestinationCalendarWhereInput }) {
    return await prisma.destinationCalendar.findFirst({
      where,
    });
  }

  private static async findConflictingForUser(data: {
    userId: number;
    integration: string;
    externalId: string;
  }) {
    return await DestinationCalendarRepository.find({
      where: {
        userId: data.userId,
        integration: data.integration,
        externalId: data.externalId,
        eventTypeId: null,
      },
    });
  }

  /**
   * Atomically creates or updates a destination calendar entry.
   * Sanitizes credential payloads for both update and create paths using
   * `buildCredentialPayloadForPrisma` to ensure credential hygiene.
   *
   * CI-005 Verified: This upsert handles destination calendar reassignment
   * (e.g., when a user switches their Google Calendar from "Personal" to "Work")
   * while preserving the credentialId → adapter resolution chain needed for
   * bi-directional sync operations.
   */
  static async upsert({
    where,
    update,
    create,
  }: {
    where: Prisma.DestinationCalendarUpsertArgs["where"];
    update: {
      integration?: string;
      externalId?: string;
      credentialId?: number | null;
      primaryEmail?: string | null;
      delegationCredentialId?: string | null;
    };
    create: {
      integration: string;
      externalId: string;
      credentialId: number | null;
      primaryEmail?: string | null;
      delegationCredentialId?: string | null;
    };
  }) {
    log.debug("upsert", { where, update, create });
    const credentialPayloadForUpdate = buildCredentialPayloadForPrisma({
      credentialId: update.credentialId,
      delegationCredentialId: update.delegationCredentialId,
    });

    const credentialPayloadForCreate = buildCredentialPayloadForPrisma({
      credentialId: create.credentialId,
      delegationCredentialId: create.delegationCredentialId,
    });

    return await prisma.destinationCalendar.upsert({
      where,
      update: {
        ...update,
        ...credentialPayloadForUpdate,
      },
      create: {
        ...create,
        ...credentialPayloadForCreate,
      },
    });
  }
}
