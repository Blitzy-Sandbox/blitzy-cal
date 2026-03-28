import type { TFunction } from "i18next";
import { RRule } from "rrule";

import dayjs from "@calcom/dayjs";
// TODO: Use browser locale, implement Intl in Dayjs maybe?
import "@calcom/dayjs/locales";
import { getEveryFreqFor } from "@calcom/lib/recurringStrings";
import type { TimeFormat } from "@calcom/lib/timeFormat";
import type { CalendarEvent, Person } from "@calcom/types/Calendar";
import type { RecurringEvent } from "@calcom/types/Calendar";

import { Info } from "./Info";

/**
 * Maps common IANA timezone identifiers to human-readable timezone names
 * matching Calendly's notification display format (NF-001 parity).
 * Covers the most frequently used timezones worldwide; unmapped zones
 * fall back to "IANA_ID, abbreviation" in {@link getHumanReadableTimezoneDisplay}.
 */
const IANA_TO_FRIENDLY_NAME: Record<string, string> = {
  /* North America */
  "America/New_York": "Eastern Time",
  "America/Chicago": "Central Time",
  "America/Denver": "Mountain Time",
  "America/Los_Angeles": "Pacific Time",
  "America/Anchorage": "Alaska Time",
  "Pacific/Honolulu": "Hawaii Time",
  "America/Phoenix": "Arizona Time",
  "America/Toronto": "Eastern Time",
  "America/Vancouver": "Pacific Time",
  "America/Winnipeg": "Central Time",
  "America/Edmonton": "Mountain Time",
  "America/Halifax": "Atlantic Time",
  "America/St_Johns": "Newfoundland Time",
  "America/Mexico_City": "Central Time",

  /* South America */
  "America/Bogota": "Colombia Time",
  "America/Lima": "Peru Time",
  "America/Santiago": "Chile Time",
  "America/Sao_Paulo": "Brasilia Time",
  "America/Argentina/Buenos_Aires": "Argentina Time",

  /* Europe */
  "Europe/London": "Greenwich Mean Time",
  "Europe/Dublin": "Greenwich Mean Time",
  "Europe/Lisbon": "Western European Time",
  "Europe/Paris": "Central European Time",
  "Europe/Berlin": "Central European Time",
  "Europe/Amsterdam": "Central European Time",
  "Europe/Brussels": "Central European Time",
  "Europe/Rome": "Central European Time",
  "Europe/Madrid": "Central European Time",
  "Europe/Zurich": "Central European Time",
  "Europe/Stockholm": "Central European Time",
  "Europe/Vienna": "Central European Time",
  "Europe/Warsaw": "Central European Time",
  "Europe/Prague": "Central European Time",
  "Europe/Copenhagen": "Central European Time",
  "Europe/Oslo": "Central European Time",
  "Europe/Helsinki": "Eastern European Time",
  "Europe/Athens": "Eastern European Time",
  "Europe/Bucharest": "Eastern European Time",
  "Europe/Istanbul": "Turkey Time",
  "Europe/Moscow": "Moscow Time",

  /* Middle East & Central Asia */
  "Asia/Dubai": "Gulf Standard Time",
  "Asia/Kolkata": "India Standard Time",
  "Asia/Colombo": "India Standard Time",
  "Asia/Dhaka": "Bangladesh Time",

  /* Southeast Asia */
  "Asia/Bangkok": "Indochina Time",
  "Asia/Ho_Chi_Minh": "Indochina Time",
  "Asia/Jakarta": "Western Indonesia Time",
  "Asia/Singapore": "Singapore Time",
  "Asia/Kuala_Lumpur": "Malaysia Time",

  /* East Asia */
  "Asia/Hong_Kong": "Hong Kong Time",
  "Asia/Shanghai": "China Standard Time",
  "Asia/Taipei": "Taipei Standard Time",
  "Asia/Tokyo": "Japan Standard Time",
  "Asia/Seoul": "Korea Standard Time",

  /* Oceania */
  "Australia/Sydney": "Australian Eastern Time",
  "Australia/Melbourne": "Australian Eastern Time",
  "Australia/Brisbane": "Australian Eastern Time",
  "Australia/Adelaide": "Australian Central Time",
  "Australia/Perth": "Australian Western Time",
  "Pacific/Auckland": "New Zealand Time",
  "Pacific/Fiji": "Fiji Time",

  /* Africa */
  "Africa/Cairo": "Eastern European Time",
  "Africa/Lagos": "West Africa Time",
  "Africa/Johannesburg": "South Africa Standard Time",
  "Africa/Nairobi": "East Africa Time",
};

/**
 * Computes a DST-aware timezone abbreviation for the given event time.
 * Uses the native {@link Intl.DateTimeFormat} API to derive the correct
 * abbreviation (e.g., "EST" vs "EDT") based on the specific date, ensuring
 * daylight-saving transitions are accurately reflected without requiring
 * additional dayjs plugins.
 *
 * @param eventStartTime - ISO 8601 event start time string
 * @param timeZone - IANA timezone identifier (e.g., "America/New_York")
 * @returns Timezone abbreviation string (e.g., "EST", "PST", or "GMT+5:30" for offset-based zones)
 */
function getTimezoneAbbreviation(eventStartTime: string, timeZone: string): string {
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      timeZoneName: "short",
    });
    const parts = formatter.formatToParts(new Date(eventStartTime));
    const tzPart = parts.find((part) => part.type === "timeZoneName");
    return tzPart?.value ?? "";
  } catch {
    // Gracefully handle invalid timezone identifiers
    return "";
  }
}

/**
 * Builds a human-readable timezone display string for Calendly-parity
 * notifications (NF-001). Maps IANA identifiers to friendly names and
 * appends the DST-aware abbreviation derived from the event start time.
 *
 * When a friendly name is available (e.g., "Eastern Time"):
 *   → returns "Eastern Time - EST"
 * Otherwise falls back to the IANA identifier with abbreviation:
 *   → returns "Asia/Kathmandu, +05:45"
 *
 * @param timeZone - IANA timezone identifier
 * @param eventStartTime - ISO 8601 event start time for DST-aware abbreviation
 * @returns Formatted timezone display string
 */
function getHumanReadableTimezoneDisplay(timeZone: string, eventStartTime: string): string {
  const abbreviation = getTimezoneAbbreviation(eventStartTime, timeZone);
  const friendlyName = IANA_TO_FRIENDLY_NAME[timeZone];

  if (friendlyName) {
    return `${friendlyName} - ${abbreviation}`;
  }

  // Fallback: show IANA identifier with abbreviation for unlisted timezones
  return `${timeZone}, ${abbreviation}`;
}

export function getRecurringWhen({
  recurringEvent,
  attendee,
}: {
  recurringEvent?: RecurringEvent | null;
  attendee: Pick<Person, "language">;
}) {
  if (recurringEvent) {
    const t = attendee.language.translate;
    const rruleOptions = new RRule(recurringEvent).options;
    const recurringEventConfig: RecurringEvent = {
      freq: rruleOptions.freq,
      count: rruleOptions.count || 1,
      interval: rruleOptions.interval,
    };
    return `${getEveryFreqFor({ t, recurringEvent: recurringEventConfig })}`;
  }
  return "";
}

export function WhenInfo(props: {
  calEvent: CalendarEvent;
  timeZone: string;
  t: TFunction;
  locale: string;
  timeFormat: TimeFormat;
  /**
   * When true, displays timezone as a human-readable name with DST-aware
   * abbreviation (e.g., "Eastern Time - EST") instead of the raw IANA
   * identifier. Matches Calendly's notification format (NF-001 parity).
   * @default false — preserves existing Cal.com behavior
   */
  humanReadableTimezone?: boolean;
  /**
   * When false, uses a space instead of the "|" pipe character between
   * the date and time portions (e.g., "Friday, January 3, 2025 10:00 AM"
   * vs "Friday, January 3, 2025 | 10:00 AM"). Set to false for Calendly
   * format parity.
   * @default true — preserves existing Cal.com behavior
   */
  usePipeSeparator?: boolean;
}) {
  const {
    timeZone,
    t,
    calEvent: { recurringEvent } = {},
    locale,
    timeFormat,
    humanReadableTimezone = false,
    usePipeSeparator = true,
  } = props;

  function getRecipientStart(format: string) {
    return dayjs(props.calEvent.startTime).tz(timeZone).locale(locale).format(format);
  }

  function getRecipientEnd(format: string) {
    return dayjs(props.calEvent.endTime).tz(timeZone).locale(locale).format(format);
  }

  const recurringInfo = getRecurringWhen({
    recurringEvent: props.calEvent.recurringEvent,
    attendee: props.calEvent.attendees[0],
  });

  // Compute the timezone display string based on the humanReadableTimezone prop.
  // When enabled, produces Calendly-style output (e.g., "Eastern Time - EST");
  // when disabled (default), preserves the existing IANA identifier display.
  const timezoneDisplay = humanReadableTimezone
    ? getHumanReadableTimezoneDisplay(timeZone, props.calEvent.startTime)
    : timeZone;

  // Build the date/time format string. The "|" pipe separator between date and
  // time is Cal.com-specific; Calendly uses a plain space. The usePipeSeparator
  // prop gates this behavior for backward compatibility.
  const dateTimeSeparator = usePipeSeparator ? " | " : " ";
  const startDateTimeFormat = `dddd, LL${dateTimeSeparator}${timeFormat}`;

  return (
    <div>
      <Info
        label={`${t("when")} ${recurringInfo !== "" ? ` - ${recurringInfo}` : ""}`}
        lineThrough={
          !!props.calEvent.cancellationReason && !props.calEvent.cancellationReason.includes("$RCH$")
        }
        description={
          <span data-testid="when">
            {recurringEvent?.count ? `${t("starting")} ` : ""}
            {getRecipientStart(startDateTimeFormat)} - {getRecipientEnd(timeFormat)}{" "}
            <span style={{ color: "#4B5563" }}>({timezoneDisplay})</span>
          </span>
        }
        withSpacer
      />
    </div>
  );
}
