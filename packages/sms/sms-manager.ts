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
}: {
  reminderPhone: string;
  smsMessage: string;
  senderID: string;
  teamId?: number;
  bookingUid?: string | null;
  organizerUserId?: number;
  /** Delivery channel — 'sms' (default) or 'whatsapp' for WhatsApp Business API via Twilio. */
  channel?: "sms" | "whatsapp";
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
    console.error("sendSmsOrFallbackEmail failed", e);
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

  getFormattedDate(timezone: string, locale: string) {
    return `${this.getFormattedTime(timezone, locale, this.calEvent.startTime)} - ${this.getFormattedTime(
      timezone,
      locale,
      this.calEvent.endTime
    )} (${timezone})`;
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

  async sendSMSToAttendee(attendee: Person, bookingUid?: string | null) {
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
    });
  }

  async sendSMSToAttendees() {
    const smsToSend: Promise<unknown>[] = [];

    if (!(await this.isSMSNotificationEnabled())) return;

    for (const attendee of this.calEvent.attendees) {
      smsToSend.push(this.sendSMSToAttendee(attendee, this.calEvent.uid));
    }

    await Promise.all(smsToSend);
  }
}
