import dayjs from "@calcom/dayjs";
import { CreditService } from "@calcom/features/ee/billing/credit-service";
import { getSenderId } from "@calcom/features/ee/workflows/lib/alphanumericSenderIdSupport";
import { sendSmsOrFallbackEmail } from "@calcom/features/ee/workflows/lib/reminders/messageDispatcher";
import { SENDER_ID, WEBAPP_URL } from "@calcom/lib/constants";
import isSmsCalEmail from "@calcom/lib/isSmsCalEmail";
import { piiHasher } from "@calcom/lib/server/PiiHasher";
import { checkSMSRateLimit } from "@calcom/lib/smsLockState";
import { TimeFormat } from "@calcom/lib/timeFormat";
import prisma from "@calcom/prisma";
import type { CalendarEvent, Person } from "@calcom/types/Calendar";

/**
 * Centralized SMS/WhatsApp dispatcher with rate limiting, credit checks, and Twilio delivery.
 * Supports both SMS (default) and WhatsApp channels via the optional `channel` parameter.
 * WhatsApp messages are routed through Twilio's WhatsApp Business API by prefixing
 * the phone number with "whatsapp:" per Twilio conventions.
 *
 * @see NF-002 — WhatsApp channel support for Calendly parity
 */
const handleSendingSMS = async ({
  reminderPhone,
  smsMessage,
  senderID,
  teamId,
  bookingUid,
  organizerUserId,
  channel = "sms",
  notificationType,
}: {
  reminderPhone: string;
  smsMessage: string;
  senderID: string;
  teamId?: number;
  bookingUid?: string | null;
  organizerUserId?: number;
  /** Delivery channel — 'sms' (default) or 'whatsapp' for WhatsApp Business API via Twilio. */
  channel?: "sms" | "whatsapp";
  /** Optional notification type for analytics/logging categorization (NF-002). */
  notificationType?: SMSNotificationType;
}) => {
  try {
    // If teamId is provided, we check the rate limit for the team.
    // If organizerUserId is provided, we check the rate limit for the organizer.
    // If neither is provided(Just in case), we check the rate limit for the reminderPhone.
    await checkSMSRateLimit({
      identifier: teamId
        ? `handleSendingSMS:team-${teamId}`
        : organizerUserId
          ? `handleSendingSMS:org-user-${organizerUserId}`
          : `handleSendingSMS:user-${piiHasher.hash(reminderPhone)}`,
      rateLimitingType: "sms",
    });

    const creditService = new CreditService();

    // For WhatsApp, prefix the phone number with "whatsapp:" per Twilio conventions (NF-002)
    const deliveryPhoneNumber =
      channel === "whatsapp" ? `whatsapp:${reminderPhone}` : reminderPhone;

    const smsOrFallbackEmail = await sendSmsOrFallbackEmail({
      twilioData: {
        phoneNumber: deliveryPhoneNumber,
        body: smsMessage,
        sender: senderID,
        ...(teamId ? { teamId } : { userId: organizerUserId }),
        bookingUid,
      },
      creditCheckFn: creditService.hasAvailableCredits.bind(creditService),
    });

    return smsOrFallbackEmail;
  } catch (e) {
    // Include notification type in error log for analytics categorization (NF-002)
    const typeLabel = notificationType ? ` [${notificationType}]` : "";
    console.error(`sendSmsOrFallbackEmail failed${typeLabel}`, e);
    throw e; // propagate the error
  }
};

const getTeamWithOrganizationSettings = async (teamId: number) => {
  return await prisma.team.findUnique({
    where: { id: teamId },
    select: {
      parent: {
        select: {
          isOrganization: true,
          organizationSettings: true,
        },
      },
    },
  });
};

/**
 * Categorizes SMS notification types for Calendly parity.
 * Used to classify SMS messages by purpose for analytics, logging, and delivery routing.
 *
 * @see NF-002 — SMS/WhatsApp reminder parity with Calendly
 */
export enum SMSNotificationType {
  /** Sent immediately after a booking is confirmed. */
  CONFIRMATION = "CONFIRMATION",
  /** Sent at configurable intervals before the event as a reminder. */
  REMINDER = "REMINDER",
  /** Sent when a booking is cancelled. */
  CANCELLATION = "CANCELLATION",
  /** Sent when a booking is rescheduled. */
  RESCHEDULE = "RESCHEDULE",
}

/**
 * Default reminder intervals (in minutes) matching Calendly's reminder schedule.
 * Calendly typically offers 15 min, 30 min, 1 hour, and 24 hours before the event.
 *
 * @see NF-002 — Configurable SMS reminder intervals for Calendly parity
 */
export const DEFAULT_REMINDER_INTERVALS: readonly number[] = [15, 30, 60, 1440] as const;

/**
 * Contextual information for reminder-specific SMS messages.
 * Provides notification type discrimination and reminder interval metadata
 * so downstream analytics/logging can categorize SMS by purpose.
 *
 * @see NF-002 — Configurable reminder intervals and notification type discrimination
 */
export interface ReminderContext {
  /** The type of SMS notification being sent. */
  notificationType: SMSNotificationType;
  /** Reminder interval in minutes before the event (e.g., 15, 30, 60, 1440). */
  reminderIntervalMinutes?: number;
}

/**
 * Options for SMS dispatch — used by `sendSMSToAttendee` and `sendSMSToAttendees`
 * to pass notification type context and delivery channel through the pipeline.
 *
 * @see NF-002 — Batch dispatch enhancements for Calendly parity
 */
export interface SMSDispatchOptions {
  /** The notification type for analytics/logging categorization. */
  notificationType?: SMSNotificationType;
  /** Delivery channel — 'sms' (default) or 'whatsapp' for Twilio WhatsApp Business API. */
  channel?: "sms" | "whatsapp";
}

export default abstract class SMSManager {
  calEvent: CalendarEvent;
  isTeamEvent = false;
  teamId: number | undefined = undefined;
  organizerUserId: number | undefined = undefined;
  private _isSMSNotificationEnabled: boolean | null = null;

  constructor(calEvent: CalendarEvent) {
    this.calEvent = calEvent;
    this.teamId = this.calEvent?.team?.id;
    this.isTeamEvent = !!this.calEvent?.team?.id;
    this.organizerUserId = this.calEvent?.organizer?.id;
  }

  private async isSMSNotificationEnabled(): Promise<boolean> {
    if (this._isSMSNotificationEnabled !== null) {
      return this._isSMSNotificationEnabled;
    }

    const teamId = this.teamId;

    if (teamId) {
      const team = await getTeamWithOrganizationSettings(teamId);

      this._isSMSNotificationEnabled = !team?.parent?.organizationSettings?.disablePhoneOnlySMSNotifications;
      return this._isSMSNotificationEnabled;
    }

    this._isSMSNotificationEnabled = true;
    return true;
  }

  getFormattedTime(
    timezone: string,
    locale: string,
    time: string,
    format = `dddd, LL | ${TimeFormat.TWELVE_HOUR}`
  ) {
    return dayjs(time).tz(timezone).locale(locale).format(format);
  }

  /**
   * Formats the event date range for inclusion in SMS messages.
   * When called without options, returns the original format for backward compatibility.
   * With options, includes Calendly-equivalent enhanced context: event title, attendee name,
   * and timezone display.
   *
   * @param timezone - IANA timezone string (e.g., "America/New_York")
   * @param locale - Locale string for localization (e.g., "en")
   * @param options - Optional enhanced formatting context for Calendly parity (NF-002)
   * @returns Formatted date string, optionally enhanced with event title and attendee name
   */
  getFormattedDate(
    timezone: string,
    locale: string,
    options?: {
      /** Include event title prominently in the formatted output (Calendly pattern). */
      includeTitle?: boolean;
      /** Include attendee name for personalized context. */
      attendeeName?: string;
    }
  ) {
    const timeRange = `${this.getFormattedTime(timezone, locale, this.calEvent.startTime)} - ${this.getFormattedTime(
      timezone,
      locale,
      this.calEvent.endTime
    )} (${timezone})`;

    // Without options, return the original format for backward compatibility
    if (!options) {
      return timeRange;
    }

    const parts: string[] = [];

    // Calendly includes the event title prominently in every SMS notification
    if (options.includeTitle && this.calEvent.title) {
      parts.push(this.calEvent.title);
    }

    // Calendly personalizes SMS with attendee name context
    if (options.attendeeName) {
      parts.push(options.attendeeName);
    }

    parts.push(timeRange);
    return parts.join(" | ");
  }

  /**
   * Generates a booking cancellation URL for inclusion in SMS messages.
   * Follows the same URL pattern used in attendee SMS templates (NF-002 Calendly parity).
   *
   * @param bookingUid - The unique identifier of the booking
   * @param seatReferenceUid - Optional seat reference UID for seated events
   * @returns The full cancellation URL
   *
   * @see NF-002 — getCancelUrl helper for SMS Calendly parity
   */
  getCancelUrl(bookingUid: string, seatReferenceUid?: string): string {
    const baseUrl = `${this.calEvent.bookerUrl ?? WEBAPP_URL}/booking/${bookingUid}`;
    if (seatReferenceUid) {
      return `${baseUrl}?seatReferenceUid=${seatReferenceUid}&cancel=true`;
    }
    return `${baseUrl}?cancel=true`;
  }

  /**
   * Generates a booking reschedule URL for inclusion in SMS messages.
   * Follows the same URL pattern used in attendee SMS templates (NF-002 Calendly parity).
   *
   * @param bookingUid - The unique identifier of the booking
   * @returns The full reschedule URL
   *
   * @see NF-002 — getRescheduleUrl helper for SMS Calendly parity
   */
  getRescheduleUrl(bookingUid: string): string {
    return `${this.calEvent.bookerUrl ?? WEBAPP_URL}/booking/${bookingUid}?reschedule=true`;
  }

  abstract getMessage(attendee: Person): string;

  /**
   * Generates a reminder-specific SMS message. Subclasses may override this method
   * to produce content tailored to the reminder interval or notification type
   * (e.g., "Your event starts in 15 minutes" vs a generic confirmation).
   *
   * Default implementation delegates to `getMessage(attendee)` for backward compatibility,
   * so existing subclasses continue to work without modification.
   *
   * @param attendee - The attendee receiving the reminder
   * @param context - Reminder context including notification type and interval
   * @returns The formatted SMS message body
   *
   * @see NF-002 — Configurable reminder intervals for Calendly parity
   */
  getReminderMessage(attendee: Person, _context: ReminderContext): string {
    // Default: delegate to the standard getMessage for backward compatibility.
    // Subclasses can override to produce interval-aware or type-aware messages.
    return this.getMessage(attendee);
  }

  /**
   * Sends an SMS to a single attendee with rate limiting, credit checks, and org opt-out enforcement.
   * Preserves the existing guard chain: phone number presence → @sms.cal.com email check →
   * organization notification enabled check.
   *
   * @param attendee - The attendee to send the SMS to
   * @param bookingUid - Optional booking UID for tracking
   * @param options - Optional dispatch options for notification type and channel (NF-002)
   */
  async sendSMSToAttendee(attendee: Person, bookingUid?: string | null, options?: SMSDispatchOptions) {
    const teamId = this.teamId;
    const attendeePhoneNumber = attendee.phoneNumber;
    const isPhoneOnlyBooking = attendeePhoneNumber && isSmsCalEmail(attendee.email);

    if (!attendeePhoneNumber || !isPhoneOnlyBooking || !(await this.isSMSNotificationEnabled())) return;

    const smsMessage = this.getMessage(attendee);
    const senderID = getSenderId(attendeePhoneNumber, SENDER_ID);
    return handleSendingSMS({
      reminderPhone: attendeePhoneNumber,
      smsMessage,
      senderID,
      teamId,
      bookingUid,
      organizerUserId: this.organizerUserId,
      channel: options?.channel,
      notificationType: options?.notificationType,
    });
  }

  /**
   * Sends SMS to all attendees in the calendar event.
   * Uses `Promise.allSettled` to ensure individual failures do not prevent other attendees
   * from receiving their SMS — matching Calendly's resilience pattern (NF-002).
   *
   * @param options - Optional dispatch options for notification type and channel (NF-002)
   */
  async sendSMSToAttendees(options?: SMSDispatchOptions) {
    const smsToSend: Promise<unknown>[] = [];

    if (!(await this.isSMSNotificationEnabled())) return;

    for (const attendee of this.calEvent.attendees) {
      smsToSend.push(this.sendSMSToAttendee(attendee, this.calEvent.uid, options));
    }

    // Use Promise.allSettled so individual failures don't prevent other attendees
    // from receiving their SMS — Calendly resilience pattern (NF-002)
    const results = await Promise.allSettled(smsToSend);

    // Log any individual failures for observability without re-throwing
    for (const result of results) {
      if (result.status === "rejected") {
        console.error("Individual SMS dispatch failed in batch:", result.reason);
      }
    }
  }
}
