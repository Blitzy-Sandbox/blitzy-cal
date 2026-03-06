import logger from "@calcom/lib/logger";
import prisma from "@calcom/prisma";
import { BookingStatus } from "@calcom/prisma/enums";

// biome-ignore lint/nursery/useExplicitType: logger type is inferred
const log = logger.getSubLogger({ prefix: ["CalendarCancellationSyncService"] });

/**
 * Supported external calendar providers for cancellation sync.
 */
type CancellationSyncProvider = "google_calendar" | "office365_calendar";

/**
 * Parameters for processing an external calendar cancellation event.
 */
interface HandleExternalCancellationParams {
  /** The UID of the event in the external calendar system (stored as BookingReference.uid). */
  externalEventUid: string;
  /** Optional external calendar ID where the event was hosted. */
  externalCalendarId?: string;
  /** The calendar provider that originated the cancellation notification. */
  provider: CancellationSyncProvider;
  /** Optional human-readable reason for the cancellation. */
  reason?: string;
}

/**
 * Result of processing an external cancellation.
 */
interface HandleExternalCancellationResult {
  /** Whether the cancellation was processed successfully. */
  success: boolean;
  /** A descriptive message about the outcome. */
  message: string;
  /** The Cal.com booking ID that was cancelled, if applicable. */
  bookingId?: number;
}

/**
 * Parameters for validating a notification payload from an external calendar provider.
 */
interface ValidateNotificationPayloadParams {
  /** The UID of the event in the external calendar system. */
  externalEventUid: string;
  /** The calendar provider identifier string. */
  provider: string;
}

/**
 * CalendarCancellationSyncService — Core service for the CI-001 gap closure.
 *
 * Handles the propagation of event deletions/declines from external calendars
 * (Google Calendar, Outlook/Office 365) back to Cal.com as booking cancellations.
 *
 * Architecture:
 * ```
 * External Calendar Event Deletion/Decline
 *   → Google Push Notification or Microsoft Graph Change Notification
 *     → GoogleCancellationHandler or OutlookCancellationHandler (in ./handlers/)
 *       → CalendarCancellationSyncService.handleExternalCancellation()
 *         → Lookup BookingReference by external event UID
 *           → Invoke handleCancelBooking with actionSource: "SYSTEM"
 *             → Dispatch attendee notifications and webhook events
 * ```
 *
 * Feature flag: `calendar-cancellation-sync` — disabled by default.
 * The feature must be explicitly enabled via the Feature table before any
 * cancellation propagation occurs.
 *
 * Data safety:
 * - ONLY reads from BookingReference and Booking tables.
 * - Does NOT modify Credential, SelectedCalendar, or DestinationCalendar tables.
 * - Cancellations delegate to the existing handleCancelBooking handler, preserving
 *   the standard BOOKING_CANCELLED webhook event with unchanged v2021-10-20 payload.
 */
export class CalendarCancellationSyncService {
  /**
   * Feature flag slug controlling whether calendar-driven cancellation sync is active.
   * Inserted into the Feature table via the calendar integration gap closure migration.
   * Disabled by default — must be explicitly enabled after validation passes.
   */
  static CALENDAR_CANCELLATION_SYNC_FEATURE = "calendar-cancellation-sync" as const;

  /**
   * Constructs the CalendarCancellationSyncService with its required dependencies.
   *
   * Uses structural typing for the featureRepository dependency to keep the
   * dependency lightweight — avoids importing IFeatureRepository directly.
   *
   * @param deps - Service dependencies injected at construction time.
   * @param deps.featureRepository - Repository providing feature flag status checks.
   */
  constructor(
    private deps: {
      featureRepository: {
        checkIfFeatureIsEnabledGlobally(slug: string): Promise<boolean>;
      };
    }
  ) {}

  /**
   * Processes an external calendar cancellation event.
   *
   * This is the main entry point called by provider-specific handlers
   * (GoogleCancellationHandler, OutlookCancellationHandler) when they detect
   * an event deletion or decline in an external calendar.
   *
   * Flow:
   * 1. Check feature flag — early return if disabled.
   * 2. Lookup BookingReference by external event UID (non-deleted references only).
   * 3. Validate booking state (skip if already cancelled or rejected).
   * 4. Invoke handleCancelBooking via lazy import to propagate the cancellation.
   *
   * @param params - External cancellation parameters.
   * @returns Result indicating success/failure and the affected booking ID.
   */
  async handleExternalCancellation(
    params: HandleExternalCancellationParams
  ): Promise<HandleExternalCancellationResult> {
    // Step 1: Check feature flag BEFORE any processing
    const isEnabled = await this.isFeatureEnabled();
    if (!isEnabled) {
      log.debug("Calendar cancellation sync feature is disabled");
      return { success: false, message: "Feature disabled" };
    }

    // Step 2: Lookup BookingReference by external event UID
    // BookingReference.uid stores the external calendar event UID.
    // Filter deleted: null to only match active (non-deleted) references.
    const bookingReference = await prisma.bookingReference.findFirst({
      where: {
        uid: params.externalEventUid,
        deleted: null,
      },
      include: {
        booking: {
          select: {
            id: true,
            uid: true,
            status: true,
            userId: true,
          },
        },
      },
    });

    // Step 3: Handle edge case — no matching booking reference
    if (!bookingReference || !bookingReference.booking) {
      log.warn("No matching booking found for external event UID", {
        externalEventUid: params.externalEventUid,
        provider: params.provider,
      });
      return { success: false, message: "No matching booking found" };
    }

    const booking = bookingReference.booking;

    // Step 4: Handle edge case — booking already cancelled
    if (booking.status === BookingStatus.CANCELLED) {
      log.debug("Booking already cancelled, skipping external cancellation sync", {
        bookingId: booking.id,
        bookingUid: booking.uid,
      });
      return { success: true, message: "Booking already cancelled" };
    }

    // Step 5: Handle edge case — booking in non-cancellable state (rejected)
    if (booking.status === BookingStatus.REJECTED) {
      log.debug("Booking is rejected, skipping external cancellation sync", {
        bookingId: booking.id,
      });
      return { success: false, message: "Booking is in rejected state" };
    }

    // Step 6: Invoke the existing cancellation handler via lazy import
    // Lazy import avoids circular dependency between calendars and bookings features.
    log.info("Processing external calendar cancellation", {
      bookingId: booking.id,
      bookingUid: booking.uid,
      provider: params.provider,
      externalEventUid: params.externalEventUid,
    });

    try {
      const handleCancelBooking = (
        await import("@calcom/features/bookings/lib/handleCancelBooking")
      ).default;

      const cancellationReason =
        params.reason || `Cancelled from external calendar (${params.provider})`;

      await handleCancelBooking({
        // Pass the booking owner's userId so the handler can resolve the user context
        userId: booking.userId ?? undefined,
        bookingData: {
          id: booking.id,
          uid: booking.uid,
          cancellationReason,
          // Skip cancellation reason validation — this is a system-initiated cancellation
          // and does not require the host-specific cancellation reason enforcement
          skipCancellationReasonValidation: true,
        },
        // ValidActionSource is a string enum; "SYSTEM" is used for background jobs
        // and automated sync processes like this calendar-driven cancellation
        actionSource: "SYSTEM",
      });

      log.info("Successfully processed external calendar cancellation", {
        bookingId: booking.id,
        bookingUid: booking.uid,
      });

      return { success: true, message: "Booking cancelled", bookingId: booking.id };
    } catch (error) {
      log.error("Failed to process external calendar cancellation", {
        bookingId: booking.id,
        bookingUid: booking.uid,
        provider: params.provider,
        error: error instanceof Error ? error.message : String(error),
      });
      return { success: false, message: "Failed to cancel booking" };
    }
  }

  /**
   * Validates a notification payload from an external calendar provider.
   *
   * Called by handler implementations before delegating to handleExternalCancellation
   * to ensure the minimum required fields are present.
   *
   * @param params - The notification payload fields to validate.
   * @returns true if the payload contains all required fields, false otherwise.
   */
  async validateNotificationPayload(params: ValidateNotificationPayloadParams): Promise<boolean> {
    if (!params.externalEventUid) {
      log.warn("Missing externalEventUid in notification payload");
      return false;
    }
    if (!params.provider) {
      log.warn("Missing provider in notification payload");
      return false;
    }
    return true;
  }

  /**
   * Checks whether the calendar cancellation sync feature is globally enabled.
   *
   * @returns true if the feature flag is enabled, false otherwise.
   */
  private async isFeatureEnabled(): Promise<boolean> {
    return this.deps.featureRepository.checkIfFeatureIsEnabledGlobally(
      CalendarCancellationSyncService.CALENDAR_CANCELLATION_SYNC_FEATURE
    );
  }
}
