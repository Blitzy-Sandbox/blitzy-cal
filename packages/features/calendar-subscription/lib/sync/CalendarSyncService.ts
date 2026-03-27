import { BookingRepository } from "@calcom/features/bookings/repositories/BookingRepository";
import type { CalendarSubscriptionEventItem } from "@calcom/features/calendar-subscription/lib/CalendarSubscriptionPort.interface";
import logger from "@calcom/lib/logger";
import type { SelectedCalendar } from "@calcom/prisma/client";
import { BookingStatus } from "@calcom/prisma/enums";

const log = logger.getSubLogger({ prefix: ["CalendarSyncService"] });

/**
 * Service to handle synchronization of calendar events.
 */
export class CalendarSyncService {
  constructor(
    private deps: {
      bookingRepository: BookingRepository;
    }
  ) {}

  /**
   * Handles synchronization of calendar events
   *
   * @param selectedCalendar calendar to process
   * @param calendarSubscriptionEvents events to process
   * @returns
   */
  async handleEvents(
    selectedCalendar: SelectedCalendar,
    calendarSubscriptionEvents: CalendarSubscriptionEventItem[]
  ) {
    log.debug("handleEvents", {
      externalId: selectedCalendar.externalId,
      countEvents: calendarSubscriptionEvents.length,
    });

    // only process cal.com calendar events
    const calEvents = calendarSubscriptionEvents.filter((e) =>
      e.iCalUID?.toLowerCase()?.endsWith("@cal.com")
    );
    if (calEvents.length === 0) {
      log.debug("handleEvents: no calendar events to process");
      return;
    }

    log.debug("handleEvents: processing calendar events", { count: calEvents.length });

    await Promise.all(
      calEvents.map((e) => {
        if (e.status === "cancelled") {
          return this.cancelBooking(e);
        } else {
          return this.rescheduleBooking(e);
        }
      })
    );
  }

  /**
   * Cancels a booking
   * @param event
   * @returns
   */
  async cancelBooking(event: CalendarSubscriptionEventItem) {
    log.debug("cancelBooking", { event });
    const [bookingUid] = event.iCalUID?.split("@") ?? [undefined];
    if (!bookingUid) {
      log.debug("Unable to sync, booking not found");
      return;
    }

    const booking = await this.deps.bookingRepository.findBookingByUidWithEventType({ bookingUid });
    if (!booking) {
      log.debug("Unable to sync, booking not found");
      return;
    }

    // Check if booking is already cancelled or rejected — skip if so
    if (booking.status === BookingStatus.CANCELLED || booking.status === BookingStatus.REJECTED) {
      log.debug("Booking already cancelled or rejected, skipping", {
        bookingUid,
        status: booking.status,
      });
      return;
    }

    log.info("Processing calendar-driven cancellation", {
      bookingUid,
      bookingId: booking.id,
      eventStatus: event.status,
    });

    try {
      // Lazy import to avoid circular dependencies — matching pattern used in CalendarCancellationSyncService
      const { default: handleCancelBooking } = await import(
        "@calcom/features/bookings/lib/handleCancelBooking"
      );

      await handleCancelBooking({
        // Pass userId if available from the booking for proper audit actor resolution
        userId: booking.userId ?? undefined,
        bookingData: {
          id: booking.id,
          uid: booking.uid,
          cancellationReason: "Cancelled from external calendar sync",
        },
        actionSource: "SYSTEM",
        // CI-001 gap: Mark this cancellation as originating from an external calendar
        // event deletion/decline so handleCancelBooking can produce proper audit logs.
        source: "external_calendar" as const,
      });

      log.info("Successfully cancelled booking via calendar sync", {
        bookingUid,
        bookingId: booking.id,
      });
    } catch (error) {
      log.error("Failed to cancel booking via calendar sync", {
        bookingUid,
        bookingId: booking.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Reschedule a booking
   * @param event
   */
  async rescheduleBooking(event: CalendarSubscriptionEventItem) {
    log.debug("rescheduleBooking", { event });
    const [bookingUid] = event.iCalUID?.split("@") ?? [undefined];
    if (!bookingUid) {
      log.debug("Unable to sync, booking not found");
      return;
    }

    const booking = await this.deps.bookingRepository.findBookingByUidWithEventType({ bookingUid });
    if (!booking) {
      log.debug("Unable to sync, booking not found");
      return;
    }

    // Rescheduling from external calendar sync is not yet implemented
    // This requires complex time comparison and attendee notification logic
    // Tracked in specs/calendar-integrations/future-work.md
    log.info("Reschedule detected from external calendar but not yet implemented", {
      bookingUid,
      bookingId: booking.id,
      eventStart: event.start,
      eventEnd: event.end,
    });
  }
}
