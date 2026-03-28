import dayjs from "@calcom/dayjs";
import { TimeFormat } from "@calcom/lib/timeFormat";
import type { CalendarEvent, Person } from "@calcom/types/Calendar";

/**
 * Converts an IANA timezone identifier to a human-friendly display name.
 *
 * Uses the `Intl.DateTimeFormat` API to resolve DST-aware timezone abbreviations
 * (e.g., "EST", "EDT", "PST", "GMT", "GMT+5:30").
 * Falls back to a formatted version of the IANA ID (replacing underscores with spaces)
 * if the Intl API cannot resolve the timezone name.
 *
 * @param timezone - IANA timezone identifier (e.g., "America/New_York")
 * @param referenceTime - ISO 8601 timestamp used to resolve DST-aware abbreviation
 * @returns Human-friendly timezone display name (e.g., "EST", "GMT+5:30")
 */
function getTimezoneDisplayName(timezone: string, referenceTime: string): string {
  try {
    // Intl.DateTimeFormat with timeZoneName: "short" produces DST-aware abbreviations:
    // "America/New_York" in Jan → "EST", in Jul → "EDT"
    // "America/Los_Angeles" in Jan → "PST", in Jul → "PDT"
    // "Europe/London" in Jan → "GMT", in Jul → "BST"
    // "Asia/Kolkata" → "GMT+5:30" (no standard abbreviation)
    const formatter = new Intl.DateTimeFormat("en", {
      timeZone: timezone,
      timeZoneName: "short",
    });
    const parts = formatter.formatToParts(new Date(referenceTime));
    const timeZonePart = parts.find((part) => part.type === "timeZoneName");

    if (timeZonePart?.value) {
      return timeZonePart.value;
    }
  } catch {
    // If the timezone is invalid or Intl API fails, fall through to IANA fallback
  }

  // Fallback: Convert IANA ID to display format by replacing underscores with spaces.
  // "America/New_York" → "America/New York"
  // "Asia/Ho_Chi_Minh" → "Asia/Ho Chi Minh"
  return timezone.replace(/_/g, " ");
}

export function getFormattedDate(calEvent: CalendarEvent, attendee: Person): string {
  const inviteeTimeFormat = calEvent.organizer.timeFormat || TimeFormat.TWELVE_HOUR;
  const timezone = attendee.timeZone;
  const locale = attendee.language.locale;
  const t = attendee.language.translate;

  const getFormattedRecipientTime = (time: string, format: string) => {
    return dayjs(time).tz(timezone).locale(locale).format(format);
  };

  const getInviteeStart = (format: string) => {
    return getFormattedRecipientTime(calEvent.startTime, format);
  };

  const getInviteeEnd = (format: string) => {
    return getFormattedRecipientTime(calEvent.endTime, format);
  };

  return `${getInviteeStart(inviteeTimeFormat)} - ${getInviteeEnd(inviteeTimeFormat)}, ${t(
    getInviteeStart("dddd").toLowerCase()
  )}, ${t(getInviteeStart("MMMM").toLowerCase())} ${getInviteeStart("D, YYYY")}`;
}

/**
 * Formats a calendar event's date/time range with timezone indicator for Calendly-parity
 * notification templates (Sprint 8 NF-001).
 *
 * Produces output like: "10:00 AM - 11:00 AM, Monday, January 15, 2025 (EST)"
 *
 * Key differences from {@link getFormattedDate}:
 * - Weekday and month names are capitalized (dayjs locale formatting) instead of lowercased + translated
 * - Timezone abbreviation or display name is appended in parentheses
 *
 * This is an additive alternative to `getFormattedDate` — existing consumers are unaffected.
 *
 * @param calEvent - The calendar event containing start/end times and organizer preferences
 * @param attendee - The attendee whose timezone, locale, and language determine formatting
 * @returns Formatted date/time string with timezone indicator
 */
export function getFormattedDateWithTimezone(calEvent: CalendarEvent, attendee: Person): string {
  const inviteeTimeFormat = calEvent.organizer.timeFormat || TimeFormat.TWELVE_HOUR;
  const timezone = attendee.timeZone;
  const locale = attendee.language.locale;

  const getFormattedRecipientTime = (time: string, format: string) => {
    return dayjs(time).tz(timezone).locale(locale).format(format);
  };

  const getInviteeStart = (format: string) => {
    return getFormattedRecipientTime(calEvent.startTime, format);
  };

  const getInviteeEnd = (format: string) => {
    return getFormattedRecipientTime(calEvent.endTime, format);
  };

  const timezoneName = getTimezoneDisplayName(timezone, calEvent.startTime);

  return `${getInviteeStart(inviteeTimeFormat)} - ${getInviteeEnd(inviteeTimeFormat)}, ${getInviteeStart("dddd")}, ${getInviteeStart("MMMM")} ${getInviteeStart("D, YYYY")} (${timezoneName})`;
}
