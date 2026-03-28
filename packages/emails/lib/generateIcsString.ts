import type { TFunction } from "i18next";
import type { DateArray, ParticipationRole, EventStatus, ParticipationStatus } from "ics";
import { createEvent } from "ics";
import { RRule } from "rrule";

import { getRichDescription } from "@calcom/lib/CalEventParser";
import { getVideoCallUrlFromCalEvent } from "@calcom/lib/CalEventParser";
import { ORGANIZER_EMAIL_EXEMPT_DOMAINS } from "@calcom/lib/constants";
import { ErrorCode } from "@calcom/lib/errorCodes";
import { ErrorWithCode } from "@calcom/lib/errors";
import type { CalendarEvent, Person } from "@calcom/types/Calendar";

export enum BookingAction {
  Create = "create",
  Cancel = "cancel",
  Reschedule = "reschedule",
  RequestReschedule = "request_reschedule",
  LocationChange = "location_change",
}

export type ICSCalendarEvent = Pick<
  CalendarEvent,
  | "uid"
  | "iCalUID"
  | "iCalSequence"
  | "startTime"
  | "endTime"
  | "title"
  | "organizer"
  | "attendees"
  | "location"
  | "recurringEvent"
  | "team"
  | "type"
  | "hideCalendarEventDetails"
  | "hideOrganizerEmail"
>;

const toICalDateArray = (date: string): DateArray => {
  const d = new Date(date);
  return [
    d.getUTCFullYear(),
    d.getUTCMonth() + 1, // Convert 0-based month to 1-based
    d.getUTCDate(),
    d.getUTCHours(),
    d.getUTCMinutes(),
  ] satisfies DateArray;
};

/**
 * Builds an enhanced ICS event description for Calendly notification parity (NF-001).
 *
 * When a bookingAction is provided, the description includes:
 * - An action-context header (e.g., cancellation notice, rescheduling notice)
 * - Timezone information from the event organizer
 * - Explicit location details
 *
 * When no bookingAction is provided, returns the base description unchanged
 * to maintain backward compatibility with existing callers.
 */
const buildEnhancedIcsDescription = ({
  baseDescription,
  event,
  location,
  bookingAction,
}: {
  baseDescription: string;
  event: ICSCalendarEvent;
  location: string | null | undefined;
  bookingAction?: BookingAction;
}): string => {
  // When no bookingAction is provided, return base description unchanged
  // to maintain backward compatibility with existing callers
  if (!bookingAction) {
    return baseDescription;
  }

  const descriptionParts: string[] = [];

  // Prepend action-context line based on booking lifecycle action
  switch (bookingAction) {
    case BookingAction.Create:
      descriptionParts.push("New booking confirmed.");
      break;
    case BookingAction.Cancel:
      descriptionParts.push("This event has been cancelled.");
      break;
    case BookingAction.Reschedule:
      descriptionParts.push("This event has been rescheduled.");
      break;
    case BookingAction.RequestReschedule:
      descriptionParts.push("A reschedule has been requested for this event.");
      break;
    case BookingAction.LocationChange:
      descriptionParts.push("The location for this event has been updated.");
      break;
  }

  // Add empty line separator before base description
  descriptionParts.push("");

  // Add the base description from getRichDescription
  descriptionParts.push(baseDescription);

  // Append timezone information if available from the organizer
  const organizerTimezone = event.organizer?.timeZone;
  if (organizerTimezone) {
    descriptionParts.push("");
    descriptionParts.push(`Timezone: ${organizerTimezone}`);
  }

  // Append explicit location details for Calendly-parity visibility
  if (location) {
    descriptionParts.push("");
    descriptionParts.push(`Location: ${location}`);
  }

  return descriptionParts.join("\n");
};

const generateIcsString = ({
  event,
  status,
  partstat = "ACCEPTED",
  t,
  bookingAction,
}: {
  event: ICSCalendarEvent;
  status: EventStatus;
  partstat?: ParticipationStatus;
  t?: TFunction;
  bookingAction?: BookingAction;
}): string | undefined => {
  const location = getVideoCallUrlFromCalEvent(event) || event.location;

  // Build enhanced description with Calendly-parity content (NF-001)
  const baseDescription = getRichDescription(event, t);
  const enhancedDescription = buildEnhancedIcsDescription({
    baseDescription,
    event,
    location,
    bookingAction,
  });

  // Taking care of recurrence rule
  let recurrenceRule: string | undefined = undefined;
  const icsRole: ParticipationRole = "REQ-PARTICIPANT";
  if (event.recurringEvent?.count) {
    // ics appends "RRULE:" already, so removing it from RRule generated string
    recurrenceRule = new RRule(event.recurringEvent).toString().replace("RRULE:", "");
  }

  const isOrganizerExempt = ORGANIZER_EMAIL_EXEMPT_DOMAINS?.split(",")
    .filter((domain) => domain.trim() !== "")
    .some((domain) => event.organizer.email.toLowerCase().endsWith(domain.toLowerCase()));

  const icsEvent = createEvent({
    uid: event.iCalUID || event.uid!,
    sequence: event.iCalSequence || 0,
    start: toICalDateArray(event.startTime),
    end: toICalDateArray(event.endTime),
    startInputType: "utc",
    productId: "calcom/ics",
    title: event.title,
    description: enhancedDescription,
    organizer: {
      name: event.organizer.name,
      ...(event.hideOrganizerEmail && !isOrganizerExempt
        ? { email: "no-reply@cal.com" }
        : { email: event.organizer.email }),
    },
    ...{ recurrenceRule },
    attendees: [
      ...event.attendees.map((attendee: Person) => ({
        name: attendee.name,
        email: attendee.email,
        partstat,
        role: icsRole,
        rsvp: true,
      })),
      ...(event.team?.members
        ? event.team?.members.map((member: Person) => ({
            name: member.name,
            email: member.email,
            partstat,
            role: icsRole,
            rsvp: true,
          }))
        : []),
    ],
    location: location ?? undefined,
    method: "REQUEST",
    status,
    ...(event.hideCalendarEventDetails ? { classification: "PRIVATE" } : {}),
    busyStatus: "BUSY",
  });
  if (icsEvent.error) {
    // The ics library throws Yup ValidationError objects (not Error instances) for invalid data like invalid email formats.
    // Convert these to ErrorWithCode.BadRequest so they return 400 instead of falling through to a generic 500.
    if (icsEvent.error.name === "ValidationError") {
      throw new ErrorWithCode(ErrorCode.BadRequest, icsEvent.error.message);
    }
    throw icsEvent.error;
  }
  return icsEvent.value;
};

export default generateIcsString;
