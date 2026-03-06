import { metadata as GoogleMeetMetadata } from "@calcom/app-store/googlevideo/_metadata";
import { MeetLocationType } from "@calcom/app-store/locations";
import getICalUID from "@calcom/emails/lib/getICalUID";
import { BookingReferenceRepository } from "@calcom/features/bookingReference/repositories/BookingReferenceRepository";
import EventManager from "@calcom/features/bookings/lib/EventManager";
import type { EventManagerInitParams } from "@calcom/features/bookings/lib/EventManager";
import { getAllCredentialsIncludeServiceAccountKey } from "@calcom/features/bookings/lib/getAllCredentialsForUsersOnEvent/getAllCredentials";
import type { EventType } from "@calcom/features/bookings/lib/getAllCredentialsForUsersOnEvent/getAllCredentials";
import { getVideoCallDetails } from "@calcom/features/bookings/lib/handleNewBooking/getVideoCallDetails";
import { getVideoCallUrlFromCalEvent } from "@calcom/lib/CalEventParser";
import logger from "@calcom/lib/logger";
import { getTranslation } from "@calcom/lib/server/i18n";
import { prisma } from "@calcom/prisma";
import type { DestinationCalendar } from "@calcom/prisma/client";
import type { Prisma } from "@calcom/prisma/client";
import type { CalendarEvent, AdditionalInformation } from "@calcom/types/Calendar";

/**
 * InitParams for RR reschedule handler.
 *
 * ET-003 Audit: The `user` field MUST represent the NEW round-robin host (not the
 * previous host). Callers (`roundRobinReassignment.ts`, `roundRobinManualReassignment.ts`)
 * are responsible for enriching the new host with delegation credentials via
 * `enrichUserWithDelegationCredentialsIncludeServiceAccountKey` before passing here.
 * The intersection with `EventManagerInitParams["user"]` ensures `credentials` and
 * other fields required by EventManager are present.
 */
type InitParams = {
  user: {
    id: number;
    name: string | null;
    email: string;
    username: string | null;
  } & EventManagerInitParams["user"];
  eventTypeAppMetadata?: EventManagerInitParams["eventTypeAppMetadata"];
  eventType: EventType;
};

export const handleRescheduleEventManager = async ({
  evt,
  rescheduleUid,
  newBookingId,
  changedOrganizer,
  previousHostDestinationCalendar,
  initParams,
  bookingLocation,
  bookingId,
  bookingICalUID,
  bookingMetadata,
}: {
  evt: CalendarEvent;
  rescheduleUid: string;
  newBookingId?: number;
  changedOrganizer?: boolean;
  previousHostDestinationCalendar?: DestinationCalendar[] | null;
  initParams: InitParams;
  bookingLocation: string | null;
  bookingId: number;
  bookingICalUID?: string | null;
  bookingMetadata?: Prisma.JsonValue;
}) => {
  const handleRescheduleEventManager = logger.getSubLogger({
    prefix: ["handleRescheduleEventManager", `${bookingId}`],
  });

  // ET-003 Audit: When organizer changed (RR host reassignment), skip deletion of the
  // previous host's calendar events from the new host's EventManager. The old host's
  // events are deleted separately by the caller before invoking this handler.
  const skipDeleteEventsAndMeetings = changedOrganizer;

  // ET-003 Audit: Credential resolution for the NEW round-robin host. This fetches
  // the user's personal credentials (already enriched by caller), plus team credentials
  // and parent event type credentials via getAllCredentialsIncludeServiceAccountKey.
  const allCredentials = await getAllCredentialsIncludeServiceAccountKey(
    initParams.user,
    initParams?.eventType
  );

  handleRescheduleEventManager.debug("Resolved credentials for RR host", {
    userId: initParams.user.id,
    credentialCount: allCredentials.length,
    changedOrganizer: !!changedOrganizer,
  });

  const eventManager = new EventManager(
    { ...initParams.user, credentials: allCredentials },
    initParams?.eventTypeAppMetadata
  );

  // ET-003 Audit: EventManager.reschedule parameter mapping:
  //   param 6 (isBookingRequestedReschedule) = undefined — RR reassignment is system-initiated,
  //     not a booking-requested reschedule. This ensures location updates only trigger on actual
  //     location changes or daily video room expiry, not unconditionally.
  //   param 7 (skipDeleteEventsAndMeetings) = changedOrganizer — prevents the new host's
  //     EventManager from deleting old host's events (caller handles deletion separately).
  const updateManager = await eventManager.reschedule(
    evt,
    rescheduleUid,
    newBookingId,
    changedOrganizer,
    previousHostDestinationCalendar,
    undefined,
    skipDeleteEventsAndMeetings
  );

  const results = updateManager.results ?? [];

  const calVideoResult = results.find((result) => result.type === "daily_video");
  // Check if Cal Video Creation Failed - That is the fallback for Cal.com and is expected to always work
  if (calVideoResult && !calVideoResult.success) {
    handleRescheduleEventManager.error("Cal Video creation failed", {
      error: calVideoResult.error,
      bookingLocation,
    });
    // This happens only when Cal Video is down
    throw new Error("Failed to set video conferencing link, but the meeting has been rescheduled");
  }

  const { metadata: videoMetadata, videoCallUrl: _videoCallUrl } = getVideoCallDetails({
    results: results,
  });

  let videoCallUrl = _videoCallUrl;
  let metadata: AdditionalInformation = {};
  metadata = videoMetadata;
  if (results.length) {
    // ET-003 Audit: Google Meet fallback logic. When the booking location is Google Meet,
    // we find the google_calendar entry in referencesToCreate and use its index to locate
    // the corresponding result in the results array. If Google Calendar is not installed
    // (googleCalIndex === -1), googleCalResult is undefined, and we push a warning result.
    // All subsequent hangout link extraction uses optional chaining so a missing
    // googleCalResult is handled safely without runtime errors.
    if (bookingLocation === MeetLocationType) {
      const googleMeetResult = {
        appName: GoogleMeetMetadata.name,
        type: "conferencing",
        uid: results[0].uid,
        originalEvent: results[0].originalEvent,
      };

      // Find index of google_calendar inside createManager.referencesToCreate
      const googleCalIndex = updateManager.referencesToCreate.findIndex(
        (ref) => ref.type === "google_calendar"
      );
      const googleCalResult = results[googleCalIndex];

      const t = await getTranslation("en", "common");

      if (!googleCalResult) {
        handleRescheduleEventManager.warn("Google Calendar not installed but using Google Meet as location");
        results.push({
          ...googleMeetResult,
          success: false,
          calWarnings: [t("google_meet_warning")],
        });
      }

      const googleHangoutLink = Array.isArray(googleCalResult?.updatedEvent)
        ? googleCalResult.updatedEvent[0]?.hangoutLink
        : (googleCalResult?.updatedEvent?.hangoutLink ?? googleCalResult?.createdEvent?.hangoutLink);

      if (googleHangoutLink) {
        results.push({
          ...googleMeetResult,
          success: true,
        });

        // Add google_meet to referencesToCreate in the same index as google_calendar
        updateManager.referencesToCreate[googleCalIndex] = {
          ...updateManager.referencesToCreate[googleCalIndex],
          meetingUrl: googleHangoutLink,
        };

        // Also create a new referenceToCreate with type video for google_meet
        updateManager.referencesToCreate.push({
          type: "google_meet_video",
          meetingUrl: googleHangoutLink,
          uid: googleCalResult.uid,
          credentialId: updateManager.referencesToCreate[googleCalIndex].credentialId,
        });
      } else if (googleCalResult && !googleHangoutLink) {
        results.push({
          ...googleMeetResult,
          success: false,
        });
      }
    }
    const createdOrUpdatedEvent = Array.isArray(results[0]?.updatedEvent)
      ? results[0]?.updatedEvent[0]
      : (results[0]?.updatedEvent ?? results[0]?.createdEvent);
    metadata.hangoutLink = createdOrUpdatedEvent?.hangoutLink;
    metadata.conferenceData = createdOrUpdatedEvent?.conferenceData;
    metadata.entryPoints = createdOrUpdatedEvent?.entryPoints;

    videoCallUrl =
      metadata.hangoutLink || createdOrUpdatedEvent?.url || getVideoCallUrlFromCalEvent(evt) || videoCallUrl;

    const calendarResult = results.find((result) => result.type.includes("_calendar"));

    // ET-003 Audit: iCalUID handling for RR host reassignment.
    // When organizer changed: use the CREATED event's iCalUID from the new host's calendar
    //   provider (since a new calendar event was created), with a generated fallback via getICalUID.
    // When organizer unchanged: use the UPDATED event's iCalUID (same calendar event updated),
    //   falling back to the existing bookingICalUID to preserve continuity.
    if (changedOrganizer) {
      const providerICalUID = (evt.iCalUID = Array.isArray(calendarResult?.createdEvent)
        ? calendarResult?.createdEvent[0]?.iCalUID
        : calendarResult?.createdEvent?.iCalUID);
      evt.iCalUID = providerICalUID || getICalUID({});
    } else {
      evt.iCalUID = Array.isArray(calendarResult?.updatedEvent)
        ? calendarResult?.updatedEvent[0]?.iCalUID || bookingICalUID
        : calendarResult?.updatedEvent?.iCalUID || bookingICalUID || undefined;
    }
  }

  // ET-003 Audit: Deep-clone all booking references before persistence to prevent
  // mutations from affecting the source array. This includes any google_meet_video
  // references added during Google Meet handling above.
  const newReferencesToCreate = structuredClone(updateManager.referencesToCreate);

  await BookingReferenceRepository.replaceBookingReferences({
    bookingId,
    newReferencesToCreate,
  });

  // ET-003 Audit: Booking update is wrapped in try/catch to prevent booking metadata
  // persistence failures from breaking the reschedule flow. The calendar event has
  // already been rescheduled at this point, so a booking row update failure is logged
  // but intentionally does NOT propagate — the reschedule result is still valid.
  // Metadata merging uses `typeof bookingMetadata === "object" && bookingMetadata` which
  // is null-safe (typeof null === "object" but `&& null` short-circuits to null, and
  // `...null` is a no-op), preserving existing metadata while adding videoCallUrl.
  try {
    if (bookingLocation?.startsWith("http")) {
      videoCallUrl = bookingLocation;
    }

    const newBookingMetaData = videoCallUrl
      ? {
          videoCallUrl: getVideoCallUrlFromCalEvent(evt) || videoCallUrl,
        }
      : undefined;

    await prisma.booking.update({
      where: {
        id: bookingId,
      },
      data: {
        location: bookingLocation,
        iCalUID: evt.iCalUID !== bookingICalUID ? evt.iCalUID : bookingICalUID,
        metadata: { ...(typeof bookingMetadata === "object" && bookingMetadata), ...newBookingMetaData },
      },
    });
  } catch (error) {
    handleRescheduleEventManager.error("Error while updating booking metadata", JSON.stringify({ error }));
  }

  // ET-003 Audit: Return the complete CalendarEvent with additionalInformation attached.
  // This object is consumed by downstream notification handlers (email/SMS) and webhook
  // trigger flows. The spread of `evt` preserves all CalendarEvent fields including the
  // updated iCalUID, while `additionalInformation` carries hangoutLink, conferenceData,
  // entryPoints, and video metadata for webhook payloads and email templates.
  const evtWithAdditionalInfo = {
    ...evt,
    additionalInformation: metadata,
  };

  return { evtWithAdditionalInfo };
};
