/**
 * Integration tests for BusyTimesService.getBusyTimesForLimitChecks.
 *
 * These tests use real Prisma database operations (not mocks) to validate:
 * - Cross-batch result aggregation for large user lists
 * - RescheduleUid exclusion from busy time results
 *
 * Test fixtures are created and cleaned up via helper functions that
 * track resource IDs in `createdResources` for reliable teardown.
 *
 * @see getBusyTimes.test.ts for unit tests with mocked Prisma
 */
import dayjs from "@calcom/dayjs";
import { getBusyTimesService } from "@calcom/features/di/containers/BusyTimes";
import { prisma } from "@calcom/prisma";
import { BookingStatus } from "@calcom/prisma/enums";
import { afterEach, describe, expect, it } from "vitest";

type CreatedResources = {
  users: number[];
  eventTypes: number[];
  bookings: number[];
};

const createdResources: CreatedResources = {
  users: [],
  eventTypes: [],
  bookings: [],
};

/**
 * Creates a test user with a unique email and username derived from the current timestamp
 * and random suffix. The user ID is tracked in `createdResources` for automatic cleanup.
 */
const createTestUser = async (overrides?: { email?: string; username?: string }) => {
  const timestamp = `${Date.now()}-${Math.random()}`;
  const user = await prisma.user.create({
    data: {
      email: overrides?.email ?? `busy-times-${timestamp}@example.com`,
      username: overrides?.username ?? `busy-times-${timestamp}`,
    },
  });
  createdResources.users.push(user.id);
  return user;
};

/**
 * Creates a test event type (30-minute duration) for the specified user with a unique slug.
 * The event type ID is tracked in `createdResources` for automatic cleanup.
 */
const createTestEventType = async (userId: number) => {
  const timestamp = `${Date.now()}-${Math.random()}`;
  const eventType = await prisma.eventType.create({
    data: {
      title: "Busy Times Test Event",
      slug: `busy-times-${timestamp}`,
      length: 30,
      userId,
      users: {
        connect: { id: userId },
      },
    },
  });
  createdResources.eventTypes.push(eventType.id);
  return eventType;
};

/**
 * Creates a test booking with ACCEPTED status for the given user and event type.
 * The booking ID is tracked in `createdResources` for automatic cleanup.
 */
const createTestBooking = async (params: {
  userId: number;
  eventTypeId: number;
  uid: string;
  startTime: Date;
  endTime: Date;
}) => {
  const booking = await prisma.booking.create({
    data: {
      userId: params.userId,
      eventTypeId: params.eventTypeId,
      uid: params.uid,
      status: BookingStatus.ACCEPTED,
      startTime: params.startTime,
      endTime: params.endTime,
      title: "Busy Times Test Booking",
    },
  });
  createdResources.bookings.push(booking.id);
  return booking;
};

afterEach(async () => {
  if (createdResources.bookings.length > 0) {
    await prisma.booking.deleteMany({
      where: { id: { in: createdResources.bookings } },
    });
    createdResources.bookings = [];
  }

  if (createdResources.eventTypes.length > 0) {
    await prisma.eventType.deleteMany({
      where: { id: { in: createdResources.eventTypes } },
    });
    createdResources.eventTypes = [];
  }

  if (createdResources.users.length > 0) {
    await prisma.user.deleteMany({
      where: { id: { in: createdResources.users } },
    });
    createdResources.users = [];
  }
});

describe("getBusyTimesForLimitChecks (integration)", () => {
  it("returns bookings across batches for large user lists", async () => {
    const user1 = await createTestUser();
    const user2 = await createTestUser();
    const eventType = await createTestEventType(user1.id);

    const dayStart = dayjs().add(1, "day").startOf("day");
    const dayEnd = dayStart.endOf("day");

    await createTestBooking({
      userId: user1.id,
      eventTypeId: eventType.id,
      uid: `busy-times-${Date.now()}-1`,
      startTime: dayStart.set("hour", 9).toDate(),
      endTime: dayStart.set("hour", 10).toDate(),
    });

    await createTestBooking({
      userId: user2.id,
      eventTypeId: eventType.id,
      uid: `busy-times-${Date.now()}-2`,
      startTime: dayStart.set("hour", 11).toDate(),
      endTime: dayStart.set("hour", 12).toDate(),
    });

    // Use high IDs (1,000,000+) as filler to exceed BATCH_SIZE_FOR_LIMIT_CHECKS (50)
    // without conflicting with real user IDs in the database.
    // Total: 2 real users + 58 fillers = 60 userIds, which forces 2 batches (50 + 10).
    const fillerIds = Array.from({ length: 58 }, (_, index) => 1_000_000 + index);
    const userIds = [user1.id, ...fillerIds, user2.id];

    const busyTimes = await getBusyTimesService().getBusyTimesForLimitChecks({
      userIds,
      eventTypeId: eventType.id,
      startDate: dayStart.toISOString(),
      endDate: dayEnd.toISOString(),
      bookingLimits: { PER_DAY: 5 },
    });

    expect(busyTimes).toHaveLength(2);
    expect(busyTimes.map((busyTime) => busyTime.userId).sort()).toEqual([user1.id, user2.id].sort());
  });

  it("excludes rescheduleUid from results", async () => {
    const user = await createTestUser();
    const eventType = await createTestEventType(user.id);

    const dayStart = dayjs().add(2, "day").startOf("day");
    const dayEnd = dayStart.endOf("day");
    const rescheduleUid = `busy-times-${Date.now()}-reschedule`;

    await createTestBooking({
      userId: user.id,
      eventTypeId: eventType.id,
      uid: rescheduleUid,
      startTime: dayStart.set("hour", 9).toDate(),
      endTime: dayStart.set("hour", 10).toDate(),
    });

    const busyTimes = await getBusyTimesService().getBusyTimesForLimitChecks({
      userIds: [user.id],
      eventTypeId: eventType.id,
      startDate: dayStart.toISOString(),
      endDate: dayEnd.toISOString(),
      rescheduleUid,
      bookingLimits: { PER_DAY: 5 },
    });

    expect(busyTimes).toHaveLength(0);
  });
});

/**
 * Multi-calendar busy time aggregation tests for CI-004 (Conflict Detection Alignment).
 *
 * These tests exercise the BusyTimesService through the DI container to verify:
 * 1. Booking-based busy time aggregation across multiple users (simulating multi-provider scenarios)
 * 2. The new `statusFilter` parameter acceptance through the DI container pipeline
 *
 * Since integration tests connect to real Prisma but NOT to external calendar APIs,
 * the calendar busy-time fetch path (getBusyCalendarTimes) is not exercised. These
 * tests validate the database-driven aggregation path and parameter acceptance.
 *
 * @see getBusyTimes.ts for the _getBusyTimes implementation that accepts statusFilter
 */
describe("multi-calendar busy time aggregation (CI-004)", () => {
  /**
   * Verifies that busy times from bookings belonging to different users are correctly
   * merged when queried through getBusyTimesForLimitChecks. This simulates a multi-provider
   * scenario where different users may have bookings from different calendar sources, and
   * the aggregation pipeline must return all of them without data loss.
   *
   * Uses day offset of +3 days to avoid collision with existing tests (+1 and +2 days).
   */
  it("should aggregate busy times from multiple calendar providers correctly", async () => {
    // Create 2 users to simulate multi-provider scenario
    const user1 = await createTestUser();
    const user2 = await createTestUser();
    const eventType = await createTestEventType(user1.id);

    const dayStart = dayjs().add(3, "day").startOf("day");
    const dayEnd = dayStart.endOf("day");

    // Create bookings for both users on the same event type at different hours
    await createTestBooking({
      userId: user1.id,
      eventTypeId: eventType.id,
      uid: `multi-cal-${Date.now()}-1`,
      startTime: dayStart.set("hour", 9).toDate(),
      endTime: dayStart.set("hour", 10).toDate(),
    });

    await createTestBooking({
      userId: user2.id,
      eventTypeId: eventType.id,
      uid: `multi-cal-${Date.now()}-2`,
      startTime: dayStart.set("hour", 14).toDate(),
      endTime: dayStart.set("hour", 15).toDate(),
    });

    const busyTimes = await getBusyTimesService().getBusyTimesForLimitChecks({
      userIds: [user1.id, user2.id],
      eventTypeId: eventType.id,
      startDate: dayStart.toISOString(),
      endDate: dayEnd.toISOString(),
      bookingLimits: { PER_DAY: 10 },
    });

    // Verify both users' bookings are correctly aggregated — 2 busy time entries expected
    expect(busyTimes).toHaveLength(2);
    const userIds = busyTimes.map((bt) => bt.userId).sort();
    expect(userIds).toEqual([user1.id, user2.id].sort());
  });

  /**
   * Verifies that the DI-container-resolved BusyTimesService's getBusyTimes method
   * accepts the new statusFilter parameter without runtime errors. This validates that
   * the parameter flows through the withReporting wrapper to _getBusyTimes correctly.
   *
   * Since integration tests don't provide real calendar credentials, the calendar
   * busy-time fetch path (getBusyCalendarTimes at lines 248-334 of getBusyTimes.ts)
   * won't execute. The test validates parameter acceptance and the booking-based
   * busy time aggregation path.
   *
   * Uses day offset of +4 days to avoid collision with other tests.
   */
  it("should support status filtering through the DI container pipeline", async () => {
    const user = await createTestUser();
    const eventType = await createTestEventType(user.id);

    const dayStart = dayjs().add(4, "day").startOf("day");
    const dayEnd = dayStart.endOf("day");

    await createTestBooking({
      userId: user.id,
      eventTypeId: eventType.id,
      uid: `status-filter-${Date.now()}-1`,
      startTime: dayStart.set("hour", 10).toDate(),
      endTime: dayStart.set("hour", 11).toDate(),
    });

    // Call getBusyTimes with statusFilter parameter — this verifies the parameter
    // is accepted through the DI container pipeline without runtime errors.
    // Note: In this integration test context, credentials are empty so the calendar
    // busy times fetch path won't be hit. The statusFilter validation is at the
    // parameter-acceptance level.
    const busyTimesService = getBusyTimesService();
    const busyTimes = await busyTimesService.getBusyTimes({
      credentials: [],
      userId: user.id,
      userEmail: user.email,
      username: user.username ?? `test-user-${user.id}`,
      eventTypeId: eventType.id,
      startTime: dayStart.toISOString(),
      endTime: dayEnd.toISOString(),
      selectedCalendars: [],
      bypassBusyCalendarTimes: false,
      currentBookings: null,
      statusFilter: ["Busy", "Tentative", "Away"],
    });

    // Verify the service returned results without errors
    expect(busyTimes).toBeDefined();
    expect(Array.isArray(busyTimes)).toBe(true);
    // The booking should appear as a busy time
    expect(busyTimes.length).toBeGreaterThanOrEqual(1);
  });
});
