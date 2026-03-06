import { CalendarEventBuilder } from "@calcom/features/CalendarEventBuilder";
import type { BookingForCalEventBuilder } from "@calcom/features/CalendarEventBuilder";
import { createEvent, deleteEvent } from "@calcom/features/calendars/lib/CalendarManager";
import { FeaturesRepository } from "@calcom/features/flags/features.repository";
import logger from "@calcom/lib/logger";
import prisma from "@calcom/prisma";
import type { CalendarEvent, NewCalendarEventType } from "@calcom/types/Calendar";
import type { CredentialForCalendarService } from "@calcom/types/Credential";
import type { EventResult } from "@calcom/types/EventManager";

const log = logger.getSubLogger({ prefix: ["BufferTimeEventService"] });

/** Type prefix used for buffer time BookingReference entries for identification and cleanup */
const BUFFER_REFERENCE_TYPE_PREFIX = "buffer_time" as const;

/**
 * Service for creating, updating, and deleting buffer time events in external calendars
 * alongside booking events.
 *
 * Buffer time visualization writes pre-event and post-event buffer periods as separate calendar
 * events in external calendars (Google Calendar, Outlook/Office 365) so organizers have visual
 * clarity about when they are unavailable due to buffer time.
 *
 * This service is gated behind two controls:
 * 1. A global `calendar-buffer-sync` feature flag (disabled by default)
 * 2. A per-EventType `syncBuffersToCalendar` toggle on the EventType model
 *
 * Both gates must be enabled for buffer events to be created.
 *
 * Buffer events are tracked via BookingReference entries with type prefix "buffer_time"
 * (e.g., "buffer_time_before", "buffer_time_after") to enable cleanup on booking cancellation.
 */
export class BufferTimeEventService {
  /**
   * Checks whether the global `calendar-buffer-sync` feature flag is enabled.
   *
   * Uses a fail-safe approach: if the feature flag check fails for any reason
   * (database error, missing flag row, etc.), the method returns `false` to prevent
   * unintended buffer event creation.
   *
   * @returns `true` if the `calendar-buffer-sync` feature flag is globally enabled, `false` otherwise
   */
  async isBufferSyncEnabled(): Promise<boolean> {
    try {
      const featuresRepository = new FeaturesRepository(prisma);
      // calendar-buffer-sync is a new feature flag added via migration.
      // It may not yet be in the AppFlags type definition, so we use `as any` assertion.
      const isEnabled = await featuresRepository.checkIfFeatureIsEnabledGlobally(
        "calendar-buffer-sync" as any
      );
      return isEnabled;
    } catch (error) {
      log.warn("Failed to check calendar-buffer-sync feature flag, defaulting to disabled", {
        error: error instanceof Error ? error.message : "Unknown error",
      });
      return false;
    }
  }

  /**
   * Determines whether buffer events should be created for a given event type.
   *
   * This method checks both gating conditions:
   * 1. The per-EventType `syncBuffersToCalendar` toggle must be explicitly `true`
   * 2. The global `calendar-buffer-sync` feature flag must be enabled
   *
   * The per-EventType check is performed first as a fast-path optimization to
   * avoid a database query for the feature flag when the toggle is not enabled.
   *
   * @param eventType - Object containing the syncBuffersToCalendar toggle value
   * @returns `true` if both the EventType toggle and global feature flag are enabled
   */
  async shouldCreateBufferEvents(eventType: {
    syncBuffersToCalendar?: boolean | null;
  }): Promise<boolean> {
    // Fast-path: if per-EventType toggle is not explicitly true, skip the feature flag check
    if (!eventType.syncBuffersToCalendar) {
      return false;
    }
    return this.isBufferSyncEnabled();
  }

  /**
   * Creates buffer calendar events (before and/or after) in external calendars for a given booking.
   *
   * For each buffer type ("before" and "after"):
   * 1. Constructs a CalendarEvent via `CalendarEventBuilder.buildBufferEvent()`
   * 2. Creates the event in the external calendar via `CalendarManager.createEvent()`
   * 3. Stores a BookingReference record for future cleanup on cancellation
   *
   * Each buffer type is handled independently — if one fails, the other is still attempted.
   * Errors are logged but never thrown to prevent disrupting the main booking flow.
   *
   * @param booking - The booking data to derive buffer time periods from
   * @param credential - The authenticated credential for external calendar API access
   * @param externalCalendarId - Optional external calendar ID to target a specific calendar
   * @returns Array of EventResult objects for each successfully or unsuccessfully created buffer event
   */
  async createBufferEvents({
    booking,
    credential,
    externalCalendarId,
  }: {
    booking: BookingForCalEventBuilder;
    credential: CredentialForCalendarService;
    externalCalendarId?: string;
  }): Promise<EventResult<NewCalendarEventType>[]> {
    log.debug("Creating buffer events for booking", { bookingUid: booking.uid });
    const results: EventResult<NewCalendarEventType>[] = [];
    const bufferTypes = ["before", "after"] as const;

    for (const bufferType of bufferTypes) {
      try {
        const bufferCalEvent = CalendarEventBuilder.buildBufferEvent(booking, bufferType);
        if (!bufferCalEvent) {
          log.debug(`No ${bufferType} buffer time configured, skipping`, {
            bookingUid: booking.uid,
          });
          continue;
        }

        const result = await createEvent(credential, bufferCalEvent, externalCalendarId);
        results.push(result);

        if (result.success && result.createdEvent) {
          await this.storeBufferReference({
            bookingId: booking.id,
            bufferType,
            uid: result.uid,
            type: `${BUFFER_REFERENCE_TYPE_PREFIX}_${bufferType}`,
            credentialId: credential.id,
            externalCalendarId: externalCalendarId ?? null,
          });
          log.info(`Created ${bufferType} buffer event`, {
            bookingUid: booking.uid,
            bufferUid: result.uid,
          });
        } else {
          log.warn(`Failed to create ${bufferType} buffer event`, {
            bookingUid: booking.uid,
            calError: result.calError,
          });
        }
      } catch (error) {
        log.error(`Error creating ${bufferType} buffer event`, {
          bookingUid: booking.uid,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    return results;
  }

  /**
   * Deletes all buffer calendar events associated with a booking from external calendars.
   *
   * Queries BookingReference entries matching the buffer type prefix ("buffer_time") that
   * have not already been soft-deleted. For each reference found:
   * 1. Calls `CalendarManager.deleteEvent()` to remove the event from the external calendar
   * 2. Soft-deletes the BookingReference record by setting `deleted: true`
   *
   * Deletion is best-effort: errors for individual buffer references are logged but
   * do not prevent processing of remaining references or throw to the caller.
   *
   * @param bookingId - The ID of the booking whose buffer events should be deleted
   * @param credential - The authenticated credential for external calendar API access
   * @param event - The CalendarEvent payload used by the adapter's deleteEvent method
   */
  async deleteBufferEvents({
    bookingId,
    credential,
    event,
  }: {
    bookingId: number;
    credential: CredentialForCalendarService;
    event: CalendarEvent;
  }): Promise<void> {
    log.debug("Deleting buffer events for booking", { bookingId });

    try {
      const bufferReferences = await prisma.bookingReference.findMany({
        where: {
          bookingId,
          type: { startsWith: BUFFER_REFERENCE_TYPE_PREFIX },
          deleted: null,
        },
      });

      if (bufferReferences.length === 0) {
        log.debug("No buffer references found for booking", { bookingId });
        return;
      }

      for (const ref of bufferReferences) {
        try {
          await deleteEvent({
            credential,
            bookingRefUid: ref.uid,
            event,
            externalCalendarId: ref.externalCalendarId,
          });

          await prisma.bookingReference.update({
            where: { id: ref.id },
            data: { deleted: true },
          });

          log.info("Deleted buffer event", {
            bookingId,
            bufferRefUid: ref.uid,
            bufferType: ref.type,
          });
        } catch (error) {
          log.error("Error deleting buffer event", {
            bookingId,
            bufferRefId: ref.id,
            error: error instanceof Error ? error.message : "Unknown error",
          });
        }
      }
    } catch (error) {
      log.error("Error querying buffer references for deletion", {
        bookingId,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  /**
   * Stores a BookingReference record for a buffer event so it can be identified and
   * cleaned up during booking cancellation.
   *
   * Buffer references use a distinctive type prefix ("buffer_time_before" or "buffer_time_after")
   * to differentiate them from regular booking references and enable targeted queries.
   *
   * @param bookingId - The associated booking ID
   * @param bufferType - Whether this is a "before" or "after" buffer reference
   * @param uid - The external calendar event UID returned by createEvent
   * @param type - The full reference type string (e.g., "buffer_time_before")
   * @param credentialId - The credential ID used to create the external event
   * @param externalCalendarId - The external calendar ID where the event was created
   */
  private async storeBufferReference({
    bookingId,
    bufferType,
    uid,
    type,
    credentialId,
    externalCalendarId,
  }: {
    bookingId: number;
    bufferType: "before" | "after";
    uid: string;
    type: string;
    credentialId: number;
    externalCalendarId: string | null;
  }): Promise<void> {
    await prisma.bookingReference.create({
      data: {
        bookingId,
        type,
        uid,
        credentialId,
        externalCalendarId,
      },
    });
    log.debug(`Stored ${bufferType} buffer reference`, { bookingId, uid, type });
  }
}
