import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";

import dayjs from "@calcom/dayjs";
import { APP_CREDENTIAL_SHARING_ENABLED } from "@calcom/lib/constants";
import prisma from "@calcom/prisma";
import type { CredentialForCalendarServiceWithEmail } from "@calcom/types/Credential";
import { test } from "@calcom/web/playwright/lib/fixtures";
import { selectSecondAvailableTimeSlotNextMonth } from "@calcom/web/playwright/lib/testUtils";

import metadata from "../_metadata";
import GoogleCalendarService from "../lib/CalendarService";
import { createBookingAndFetchGCalEvent, deleteBookingAndEvent, assertValueExists } from "./testUtils";

test.describe("Google Calendar", async () => {
  // Skip till the tests are flaky
  // eslint-disable-next-line playwright/no-skipped-test
  test.describe.skip("Test using the primary calendar", async () => {
    let qaUsername: string;
    let qaGCalCredential: CredentialForCalendarServiceWithEmail;
    test.beforeAll(async () => {
      let runIntegrationTest = false;
      const errorMessage = "Could not run test";

      test.skip(!!APP_CREDENTIAL_SHARING_ENABLED, "Credential sharing enabled");

      if (process.env.E2E_TEST_CALCOM_GCAL_KEYS) {
        const gCalKeys = JSON.parse(process.env.E2E_TEST_CALCOM_GCAL_KEYS);
        await prisma.app.update({
          where: {
            slug: "google-calendar",
          },
          data: {
            keys: gCalKeys,
          },
        });
      } else {
        test.skip(!process.env.E2E_TEST_CALCOM_GCAL_KEYS, "GCal keys not found");
      }

      test.skip(!process.env.E2E_TEST_CALCOM_QA_EMAIL, "QA email not found");
      test.skip(!process.env.E2E_TEST_CALCOM_QA_PASSWORD, "QA password not found");

      if (process.env.E2E_TEST_CALCOM_QA_EMAIL && process.env.E2E_TEST_CALCOM_QA_PASSWORD) {
        qaGCalCredential = {
          ...(await prisma.credential.findFirstOrThrow({
            where: {
              user: {
                email: process.env.E2E_TEST_CALCOM_QA_EMAIL,
              },
              type: metadata.type,
            },
            include: {
              user: {
                select: {
                  email: true,
                },
              },
            },
          })),
          delegatedTo: null,
        } as CredentialForCalendarServiceWithEmail;
        test.skip(!qaGCalCredential?.id, "Google QA credential not found");

        const qaUserQuery = await prisma.user.findFirstOrThrow({
          where: {
            email: process.env.E2E_TEST_CALCOM_QA_EMAIL,
          },
          select: {
            id: true,
            username: true,
          },
        });

        test.skip(!qaUserQuery, "QA user not found");

        assertValueExists(qaUserQuery.username, "qaUsername");
        qaUsername = qaUserQuery.username;

        test.skip(!qaUsername, "QA username not found");

        const googleCalendarService = GoogleCalendarService(qaGCalCredential);

        const calendars = await googleCalendarService.listCalendars();

        const primaryCalendarName = calendars.find((calendar: { primary?: boolean; name?: string }) => calendar.primary)?.name;
        assertValueExists(primaryCalendarName, "primaryCalendarName");

        await prisma.destinationCalendar.upsert({
          where: {
            userId: qaUserQuery.id,
            externalId: primaryCalendarName,
            eventTypeId: undefined,
          },
          update: {},
          create: {
            integration: "google_calendar",
            userId: qaUserQuery.id,
            externalId: primaryCalendarName,
            credentialId: qaGCalCredential.id,
          },
        });

        if (qaGCalCredential && qaUsername) runIntegrationTest = true;
      }

      test.skip(!runIntegrationTest, errorMessage);
    });

    test("On new booking, event should be created on GCal", async ({ page }) => {
      const { gCalEvent, gCalReference, booking, authedCalendar } = await createBookingAndFetchGCalEvent(
        page as Page,
        qaGCalCredential,
        qaUsername
      );

      assertValueExists(gCalEvent.start?.timeZone, "gCalEvent");
      assertValueExists(gCalEvent.end?.timeZone, "gCalEvent");

      // Ensure that the start and end times are matching
      const startTimeMatches = dayjs(booking.startTime).isSame(
        dayjs(gCalEvent.start.dateTime).tz(gCalEvent.start.timeZone)
      );
      const endTimeMatches = dayjs(booking.endTime).isSame(
        dayjs(gCalEvent.end?.dateTime).tz(gCalEvent.end.timeZone)
      );
      expect(startTimeMatches && endTimeMatches).toBe(true);

      // Ensure that the titles are matching
      expect(booking.title).toBe(gCalEvent.summary);

      // Ensure that the attendee is on the event
      const bookingAttendee = booking?.attendees[0].email;
      const attendeeInGCalEvent = gCalEvent.attendees?.find((attendee) => attendee.email === bookingAttendee);
      expect(attendeeInGCalEvent).toBeTruthy();

      // CI-005: Verify full outbound pipeline field coverage
      // Verify description is present (CalendarEventBuilder.fromBooking populates this)
      expect(gCalEvent.description).toBeDefined();

      // Verify organizer email is present in the event
      const organizerInEvent = gCalEvent.attendees?.find(
        (attendee) => attendee.organizer === true
      );
      expect(organizerInEvent).toBeTruthy();

      // Verify timezone consistency between start and end
      expect(gCalEvent.start?.timeZone).toBe(gCalEvent.end?.timeZone);

      // Verify the event has a valid iCalUID for cross-calendar correlation
      expect(gCalEvent.iCalUID).toBeDefined();
      expect(gCalEvent.iCalUID).toBeTruthy();

      // Verify the event status is 'confirmed' (not tentative or cancelled)
      expect(gCalEvent.status).toBe("confirmed");

      // Verify reminders are configured (either default or custom)
      expect(gCalEvent.reminders).toBeDefined();

      await deleteBookingAndEvent(authedCalendar, booking.uid, gCalReference.uid);
    });

    test("On reschedule, event should be updated on GCal", async ({ page }) => {
      // Reschedule the booking and check the gCalEvent's time is also changed
      // On reschedule gCal UID stays the same
      const { gCalReference, booking, authedCalendar } = await createBookingAndFetchGCalEvent(
        page,
        qaGCalCredential,
        qaUsername
      );

      await page.locator('[data-testid="reschedule-link"]').click();

      await selectSecondAvailableTimeSlotNextMonth(page);
      await page.locator('[data-testid="confirm-reschedule-button"]').click();

      await expect(page.locator("[data-testid=success-page]")).toBeVisible();

      const rescheduledBookingUrl = await page.url();
      const rescheduledBookingUid = rescheduledBookingUrl.match(/booking\/([^\/?]+)/);

      assertValueExists(rescheduledBookingUid, "rescheduledBookingUid");

      // Get the rescheduled booking start and end times
      const rescheduledBooking = await prisma.booking.findFirst({
        where: {
          uid: rescheduledBookingUid[1],
        },
        select: {
          startTime: true,
          endTime: true,
        },
      });
      assertValueExists(rescheduledBooking, "rescheduledBooking");

      // The GCal event UID persists after reschedule but should get the rescheduled data
      const gCalRescheduledEventResponse = await authedCalendar.events.get({
        calendarId: "primary",
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        //@ts-ignore
        eventId: gCalReference.uid,
      });

      expect(gCalRescheduledEventResponse.status).toBe(200);

      const rescheduledGCalEvent = gCalRescheduledEventResponse.data;

      assertValueExists(rescheduledGCalEvent.start?.timeZone, "rescheduledGCalEvent");
      assertValueExists(rescheduledGCalEvent.end?.timeZone, "rescheduledGCalEvent");

      // Ensure that the new start and end times are matching
      const rescheduledStartTimeMatches = dayjs(rescheduledBooking.startTime).isSame(
        dayjs(rescheduledGCalEvent.start?.dateTime).tz(rescheduledGCalEvent.start?.timeZone)
      );
      const rescheduledEndTimeMatches = dayjs(rescheduledBooking.endTime).isSame(
        dayjs(rescheduledGCalEvent.end?.dateTime).tz(rescheduledGCalEvent.end.timeZone)
      );
      expect(rescheduledStartTimeMatches && rescheduledEndTimeMatches).toBe(true);

      // CI-005: Verify field preservation after reschedule
      // Verify the rescheduled event retains its title/summary
      expect(rescheduledGCalEvent.summary).toBeDefined();
      expect(rescheduledGCalEvent.summary).toBeTruthy();

      // Verify description is preserved after update
      expect(rescheduledGCalEvent.description).toBeDefined();

      // Verify iCalUID is preserved after reschedule (event identity maintained)
      expect(rescheduledGCalEvent.iCalUID).toBeDefined();

      // Verify event status remains 'confirmed' after reschedule
      expect(rescheduledGCalEvent.status).toBe("confirmed");

      // Verify timezone metadata is preserved
      expect(rescheduledGCalEvent.start?.timeZone).toBe(rescheduledGCalEvent.end?.timeZone);

      // After test passes we can delete the bookings and GCal event
      await deleteBookingAndEvent(authedCalendar, booking.uid, gCalReference.uid);

      await prisma.booking.delete({
        where: {
          uid: rescheduledBookingUid[1],
        },
      });
    });

    test("When canceling the booking, the GCal event should also be deleted", async ({ page }) => {
      const { gCalReference, booking, authedCalendar } = await createBookingAndFetchGCalEvent(
        page,
        qaGCalCredential,
        qaUsername
      );

      // Cancel the booking
      await page.locator('[data-testid="cancel"]').click();
      await page.locator('[data-testid="confirm_cancel"]').click();
      // Query for the bookingUID and ensure that it doesn't exist on GCal

      await page.waitForSelector('[data-testid="cancelled-headline"]');

      const canceledGCalEventResponse = await authedCalendar.events.get({
        calendarId: "primary",
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        //@ts-ignore
        eventId: gCalReference.uid,
      });

      expect(canceledGCalEventResponse.data.status).toBe("cancelled");

      // CI-005: Verify cancellation metadata
      // Verify the cancelled event retains its identity (iCalUID preserved)
      expect(canceledGCalEventResponse.data.iCalUID).toBeDefined();

      // Verify the event's original summary is still present (Google retains it on cancellation)
      expect(canceledGCalEventResponse.data.summary).toBeDefined();

      // GCal API sees canceled events as already deleted
      await deleteBookingAndEvent(authedCalendar, booking.uid);
    });
  });

  // CI-005: Bi-directional sync verification — Inbound availability pipeline
  // eslint-disable-next-line playwright/no-skipped-test
  test.describe.skip("CI-005: Inbound availability verification", () => {
    let qaGCalCredential: CredentialForCalendarServiceWithEmail;

    test.beforeAll(async () => {
      test.skip(!!APP_CREDENTIAL_SHARING_ENABLED, "Credential sharing enabled");
      test.skip(!process.env.E2E_TEST_CALCOM_GCAL_KEYS, "GCal keys not found");
      test.skip(!process.env.E2E_TEST_CALCOM_QA_EMAIL, "QA email not found");
      test.skip(!process.env.E2E_TEST_CALCOM_QA_PASSWORD, "QA password not found");

      if (process.env.E2E_TEST_CALCOM_QA_EMAIL) {
        qaGCalCredential = {
          ...(await prisma.credential.findFirstOrThrow({
            where: {
              user: {
                email: process.env.E2E_TEST_CALCOM_QA_EMAIL,
              },
              type: metadata.type,
            },
            include: {
              user: {
                select: {
                  email: true,
                },
              },
            },
          })),
          delegatedTo: null,
        } as CredentialForCalendarServiceWithEmail;

        test.skip(!qaGCalCredential?.id, "Google QA credential not found");
      }
    });

    test("External calendar events should appear in getAvailability busy times", async () => {
      // This test verifies the inbound pipeline:
      // External calendar event → getAvailability() → busy time reported
      const googleCalendarService = GoogleCalendarService(qaGCalCredential);

      // Query availability for a future date range
      const now = dayjs();
      const dateFrom = now.add(1, "day").startOf("day").format("YYYY-MM-DDTHH:mm:ssZ");
      const dateTo = now.add(7, "day").endOf("day").format("YYYY-MM-DDTHH:mm:ssZ");

      // getAvailability queries Google FreeBusy API for connected calendars
      const busyTimes = await googleCalendarService.getAvailability({
        dateFrom,
        dateTo,
        selectedCalendars: [],
        mode: "slots",
      });

      // Verify the response is an array (may be empty if no events exist)
      expect(Array.isArray(busyTimes)).toBe(true);

      // Each busy time entry should have start and end properties
      for (const busyTime of busyTimes) {
        expect(busyTime).toHaveProperty("start");
        expect(busyTime).toHaveProperty("end");
        // Verify start is before end
        expect(dayjs(busyTime.start).isBefore(dayjs(busyTime.end))).toBe(true);
      }
    });

    test("getAvailability should query FreeBusy API with correct date range", async () => {
      const googleCalendarService = GoogleCalendarService(qaGCalCredential);

      // Query for exactly today — verify no errors for short ranges
      const today = dayjs().startOf("day");
      const tomorrow = today.add(1, "day");

      const busyTimes = await googleCalendarService.getAvailability({
        dateFrom: today.format("YYYY-MM-DDTHH:mm:ssZ"),
        dateTo: tomorrow.format("YYYY-MM-DDTHH:mm:ssZ"),
        selectedCalendars: [],
        mode: "slots",
      });

      expect(Array.isArray(busyTimes)).toBe(true);
    });

    test("listCalendars should return available calendars for the credential", async () => {
      // Verify that listCalendars works correctly — needed for multi-calendar sync
      const googleCalendarService = GoogleCalendarService(qaGCalCredential);
      const calendars = await googleCalendarService.listCalendars();

      // Should return at least one calendar (the primary)
      expect(calendars.length).toBeGreaterThan(0);

      // Each calendar should have required fields
      for (const calendar of calendars) {
        expect(calendar).toHaveProperty("externalId");
        expect(calendar).toHaveProperty("integration");
        expect(calendar.integration).toBe("google_calendar");
      }

      // Verify primary calendar exists in the list
      const primaryCalendar = calendars.find(
        (cal: { primary?: boolean }) => cal.primary === true
      );
      expect(primaryCalendar).toBeTruthy();
    });
  });

  // CI-005: Bi-directional sync verification — Full round-trip pipeline
  // eslint-disable-next-line playwright/no-skipped-test
  test.describe.skip("CI-005: Full round-trip sync verification", () => {
    let qaUsername: string;
    let qaGCalCredential: CredentialForCalendarServiceWithEmail;

    test.beforeAll(async () => {
      test.skip(!!APP_CREDENTIAL_SHARING_ENABLED, "Credential sharing enabled");
      test.skip(!process.env.E2E_TEST_CALCOM_GCAL_KEYS, "GCal keys not found");
      test.skip(!process.env.E2E_TEST_CALCOM_QA_EMAIL, "QA email not found");
      test.skip(!process.env.E2E_TEST_CALCOM_QA_PASSWORD, "QA password not found");

      if (process.env.E2E_TEST_CALCOM_QA_EMAIL && process.env.E2E_TEST_CALCOM_QA_PASSWORD) {
        qaGCalCredential = {
          ...(await prisma.credential.findFirstOrThrow({
            where: {
              user: {
                email: process.env.E2E_TEST_CALCOM_QA_EMAIL,
              },
              type: metadata.type,
            },
            include: {
              user: {
                select: {
                  email: true,
                },
              },
            },
          })),
          delegatedTo: null,
        } as CredentialForCalendarServiceWithEmail;

        test.skip(!qaGCalCredential?.id, "Google QA credential not found");

        const qaUserQuery = await prisma.user.findFirstOrThrow({
          where: {
            email: process.env.E2E_TEST_CALCOM_QA_EMAIL,
          },
          select: {
            id: true,
            username: true,
          },
        });

        assertValueExists(qaUserQuery.username, "qaUsername");
        qaUsername = qaUserQuery.username;
      }
    });

    test("Booking creation should produce a GCal event with all CalendarEventBuilder fields", async ({ page }) => {
      // CI-005: Verify the full outbound pipeline:
      // CalendarEventBuilder.fromBooking() → CalendarManager.processEvent() → GoogleCalendarService.createEvent()
      const { gCalEvent, gCalReference, booking, authedCalendar } = await createBookingAndFetchGCalEvent(
        page as Page,
        qaGCalCredential,
        qaUsername
      );

      // Verify all essential fields from CalendarEventBuilder are present in the GCal event
      // Summary (title)
      expect(gCalEvent.summary).toBe(booking.title);
      expect(gCalEvent.summary).toBeTruthy();

      // Description (populated by CalendarEventBuilder)
      expect(gCalEvent.description).toBeDefined();
      expect(typeof gCalEvent.description).toBe("string");

      // Start/End times with timezone
      assertValueExists(gCalEvent.start?.dateTime, "gCalEvent.start.dateTime");
      assertValueExists(gCalEvent.end?.dateTime, "gCalEvent.end.dateTime");
      assertValueExists(gCalEvent.start?.timeZone, "gCalEvent.start.timeZone");
      assertValueExists(gCalEvent.end?.timeZone, "gCalEvent.end.timeZone");

      // Timezone consistency
      expect(gCalEvent.start?.timeZone).toBe(gCalEvent.end?.timeZone);

      // Attendees
      expect(gCalEvent.attendees).toBeDefined();
      expect(gCalEvent.attendees!.length).toBeGreaterThan(0);

      // Organizer in attendees with organizer flag
      const organizerAttendee = gCalEvent.attendees?.find((a) => a.organizer === true);
      expect(organizerAttendee).toBeTruthy();
      expect(organizerAttendee?.email).toBe(booking.user?.email);

      // Booking attendee in event attendees
      const bookingAttendeeEmail = booking.attendees[0].email;
      const attendeeInEvent = gCalEvent.attendees?.find((a) => a.email === bookingAttendeeEmail);
      expect(attendeeInEvent).toBeTruthy();

      // iCalUID for cross-calendar correlation
      expect(gCalEvent.iCalUID).toBeDefined();
      expect(gCalEvent.iCalUID).toBeTruthy();

      // Event status
      expect(gCalEvent.status).toBe("confirmed");

      // Reminders
      expect(gCalEvent.reminders).toBeDefined();

      // Cleanup
      await deleteBookingAndEvent(authedCalendar, booking.uid, gCalReference.uid);
    });

    test("Created GCal event should be visible in availability query (round-trip)", async ({ page }) => {
      // CI-005: Verify round-trip:
      // 1. Create booking → GCal event created (outbound)
      // 2. Query availability → event appears as busy time (inbound)
      const { gCalEvent, gCalReference, booking, authedCalendar } = await createBookingAndFetchGCalEvent(
        page as Page,
        qaGCalCredential,
        qaUsername
      );

      assertValueExists(gCalEvent.start?.dateTime, "gCalEvent.start.dateTime");
      assertValueExists(gCalEvent.end?.dateTime, "gCalEvent.end.dateTime");

      // Query availability covering the booking time window
      const googleCalendarService = GoogleCalendarService(qaGCalCredential);
      const dateFrom = dayjs(gCalEvent.start.dateTime).subtract(1, "hour").format("YYYY-MM-DDTHH:mm:ssZ");
      const dateTo = dayjs(gCalEvent.end.dateTime).add(1, "hour").format("YYYY-MM-DDTHH:mm:ssZ");

      const busyTimes = await googleCalendarService.getAvailability({
        dateFrom,
        dateTo,
        selectedCalendars: [],
        mode: "slots",
      });

      // The created event should appear as a busy time
      expect(Array.isArray(busyTimes)).toBe(true);
      expect(busyTimes.length).toBeGreaterThan(0);

      // Verify at least one busy time overlaps with our booking window
      const bookingStart = dayjs(booking.startTime);
      const bookingEnd = dayjs(booking.endTime);
      const overlappingBusy = busyTimes.find((busy) => {
        const busyStart = dayjs(busy.start);
        const busyEnd = dayjs(busy.end);
        return busyStart.isBefore(bookingEnd) && busyEnd.isAfter(bookingStart);
      });
      expect(overlappingBusy).toBeTruthy();

      // Cleanup
      await deleteBookingAndEvent(authedCalendar, booking.uid, gCalReference.uid);
    });
  });
});
