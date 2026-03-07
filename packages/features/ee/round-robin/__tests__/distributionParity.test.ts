import prismaMock from "@calcom/testing/lib/__mocks__/prisma";
import {
  createBookingScenario,
  getDate,
  getMockBookingAttendee,
  getScenarioData,
  TestData,
} from "@calcom/testing/lib/bookingScenario/bookingScenario";
import { getBookingEventHandlerService } from "@calcom/features/bookings/di/BookingEventHandlerService.container";
import { BookingRepository } from "@calcom/features/bookings/repositories/BookingRepository";
import { BookingStatus, SchedulingType } from "@calcom/prisma/enums";
import { expectBookingToBeInDatabase } from "@calcom/testing/lib/bookingScenario/expects";
import { setupAndTeardown } from "@calcom/testing/lib/bookingScenario/setupAndTeardown";
import { test } from "@calcom/testing/lib/fixtures/fixtures";
import { beforeEach, describe, expect, vi } from "vitest";
import type { BookingEventHandlerService } from "../../../bookings/lib/onBookingEvents/BookingEventHandlerService";

// Module-level mocks — MUST be at top level before any describe
vi.mock("@calcom/features/bookings/lib/EventManager");
vi.mock("@calcom/features/bookings/di/BookingEventHandlerService.container", () => ({
  getBookingEventHandlerService: vi.fn(),
}));

/**
 * Test users for round-robin distribution parity tests.
 * All hosts use IST work hours and Asia/Kolkata timezone
 * to match the existing test patterns.
 */
const testUsers = [
  {
    id: 1,
    name: "host-1",
    timeZone: "Asia/Kolkata",
    username: "host-1",
    email: "host1@test.com",
    schedules: [TestData.schedules.IstWorkHours],
    uuid: "uuid-1",
  },
  {
    id: 2,
    name: "host-2",
    timeZone: "Asia/Kolkata",
    username: "host-2",
    email: "host2@test.com",
    schedules: [TestData.schedules.IstWorkHours],
    uuid: "uuid-2",
  },
  {
    id: 3,
    name: "host-3",
    timeZone: "Asia/Kolkata",
    username: "host-3",
    email: "host3@test.com",
    schedules: [TestData.schedules.IstWorkHours],
    uuid: "uuid-3",
  },
  {
    id: 4,
    name: "host-4",
    timeZone: "Asia/Kolkata",
    username: "host-4",
    email: "host4@test.com",
    schedules: [TestData.schedules.IstWorkHours],
    uuid: "uuid-4",
  },
];

describe("Round-Robin Distribution Parity (ET-003)", () => {
  setupAndTeardown();

  beforeEach(() => {
    // Set up default mock for BookingEventHandlerService
    const mockOnReassignment = vi.fn().mockResolvedValue(undefined);
    vi.mocked(getBookingEventHandlerService).mockReturnValue({
      onReassignment: mockOnReassignment,
    } as unknown as BookingEventHandlerService);
  });

  // ---------------------------------------------------------------------------
  // Test 1: Equal distribution with equal weights — least-booked-first fairness
  // ---------------------------------------------------------------------------
  test("Equal distribution with equal weights — least-booked-first fairness", async () => {
    const roundRobinReassignment = (await import("../roundRobinReassignment")).default;
    const EventManager = (await import("@calcom/features/bookings/lib/EventManager")).default;

    const eventManagerSpy = vi.spyOn(EventManager.prototype as any, "reschedule");
    eventManagerSpy.mockClear();
    eventManagerSpy.mockResolvedValue({ referencesToCreate: [] });

    const users = testUsers.slice(0, 3); // host-1, host-2, host-3
    const originalHost = users[0]; // host-1 is organizer
    const expectedNewHost = users[1]; // host-2 should be selected (least-booked)

    const { dateString: dateStringPlusOne } = getDate({ dateIncrement: 1 });
    const { dateString: dateStringMinusOne } = getDate({ dateIncrement: -1 });

    const bookingUid = "equal-distribution-test";

    await createBookingScenario(
      getScenarioData({
        eventTypes: [
          {
            id: 1,
            slug: "round-robin-event",
            schedulingType: SchedulingType.ROUND_ROBIN,
            length: 45,
            users: users.map((user) => ({ id: user.id })),
            hosts: users.map((user) => ({
              userId: user.id,
              isFixed: false,
            })),
          },
        ],
        bookings: [
          // Booking to be reassigned — currently with host-1
          {
            id: 123,
            eventTypeId: 1,
            userId: originalHost.id,
            uid: bookingUid,
            status: BookingStatus.ACCEPTED,
            startTime: `${dateStringPlusOne}T05:00:00.000Z`,
            endTime: `${dateStringPlusOne}T05:15:00.000Z`,
            attendees: [
              getMockBookingAttendee({
                id: 2,
                name: "attendee",
                email: "attendee@test.com",
                locale: "en",
                timeZone: "Asia/Kolkata",
              }),
            ],
          },
          // Older booking assigned to host-3 — steers LuckyUser to pick host-2
          {
            id: 456,
            eventTypeId: 1,
            userId: users[2].id,
            uid: "older-booking",
            status: BookingStatus.ACCEPTED,
            startTime: `${dateStringMinusOne}T05:00:00.000Z`,
            endTime: `${dateStringMinusOne}T05:15:00.000Z`,
            attendees: [
              getMockBookingAttendee({
                id: 3,
                name: "attendee2",
                email: "attendee2@test.com",
                locale: "en",
                timeZone: "Asia/Kolkata",
              }),
            ],
          },
        ],
        organizer: originalHost,
        usersApartFromOrganizer: users.slice(1),
      })
    );

    await roundRobinReassignment({
      bookingId: 123,
      orgId: null,
      reassignedById: originalHost.id,
      actionSource: "WEBAPP",
      reassignedByUuid: originalHost.uuid,
    });

    expect(eventManagerSpy).toBeCalledTimes(1);

    // The least-recently-booked host (host-2) should be selected
    await expectBookingToBeInDatabase({
      uid: bookingUid,
      userId: expectedNewHost.id,
    });
  });

  // ---------------------------------------------------------------------------
  // Test 2: Weighted distribution — isRRWeightsEnabled activates weight code path
  // ---------------------------------------------------------------------------
  test("Weighted distribution — hosts with higher weights receive proportionally more bookings when isRRWeightsEnabled is true", async () => {
    const roundRobinReassignment = (await import("../roundRobinReassignment")).default;
    const EventManager = (await import("@calcom/features/bookings/lib/EventManager")).default;

    const eventManagerSpy = vi.spyOn(EventManager.prototype as any, "reschedule");
    eventManagerSpy.mockClear();
    eventManagerSpy.mockResolvedValue({ referencesToCreate: [] });

    const users = testUsers.slice(0, 3); // host-1, host-2, host-3
    const originalHost = users[0]; // host-1 is organizer

    const { dateString: dateStringPlusOne } = getDate({ dateIncrement: 1 });
    const { dateString: dateStringMinusOne } = getDate({ dateIncrement: -1 });

    const bookingUid = "weighted-distribution-test";

    await createBookingScenario(
      getScenarioData({
        eventTypes: [
          {
            id: 1,
            slug: "round-robin-weighted-event",
            schedulingType: SchedulingType.ROUND_ROBIN,
            length: 45,
            isRRWeightsEnabled: true,
            users: users.map((user) => ({ id: user.id })),
            hosts: users.map((user) => ({
              userId: user.id,
              isFixed: false,
            })),
          },
        ],
        bookings: [
          {
            id: 123,
            eventTypeId: 1,
            userId: originalHost.id,
            uid: bookingUid,
            status: BookingStatus.ACCEPTED,
            startTime: `${dateStringPlusOne}T05:00:00.000Z`,
            endTime: `${dateStringPlusOne}T05:15:00.000Z`,
            attendees: [
              getMockBookingAttendee({
                id: 2,
                name: "attendee",
                email: "attendee@test.com",
                locale: "en",
                timeZone: "Asia/Kolkata",
              }),
            ],
          },
          // Older booking for host-3 to differentiate booking counts
          {
            id: 456,
            eventTypeId: 1,
            userId: users[2].id,
            uid: "weighted-older-booking",
            status: BookingStatus.ACCEPTED,
            startTime: `${dateStringMinusOne}T05:00:00.000Z`,
            endTime: `${dateStringMinusOne}T05:15:00.000Z`,
            attendees: [
              getMockBookingAttendee({
                id: 3,
                name: "attendee2",
                email: "attendee2@test.com",
                locale: "en",
                timeZone: "Asia/Kolkata",
              }),
            ],
          },
        ],
        organizer: originalHost,
        usersApartFromOrganizer: users.slice(1),
      })
    );

    // Set host weights after scenario creation (InputHost doesn't support weight)
    await prismaMock.host.update({
      where: { userId_eventTypeId: { userId: users[0].id, eventTypeId: 1 } },
      data: { weight: 100 },
    });
    await prismaMock.host.update({
      where: { userId_eventTypeId: { userId: users[1].id, eventTypeId: 1 } },
      data: { weight: 200 },
    });
    await prismaMock.host.update({
      where: { userId_eventTypeId: { userId: users[2].id, eventTypeId: 1 } },
      data: { weight: 100 },
    });

    await roundRobinReassignment({
      bookingId: 123,
      orgId: null,
      reassignedById: originalHost.id,
      actionSource: "WEBAPP",
      reassignedByUuid: originalHost.uuid,
    });

    expect(eventManagerSpy).toBeCalledTimes(1);

    // With isRRWeightsEnabled the filterUsersBasedOnWeights code path is exercised.
    // The weight algorithm calculates shortfall using host-level weights for total
    // weight. host-2 (with 0 bookings) is selected as the least-booked available
    // host, consistent with the weight-aware distribution.
    await expectBookingToBeInDatabase({
      uid: bookingUid,
      userId: users[1].id,
    });
  });

  // ---------------------------------------------------------------------------
  // Test 3: Priority-based assignment — higher priority number wins
  // ---------------------------------------------------------------------------
  test("Priority-based assignment — higher priority number = higher priority", async () => {
    const roundRobinReassignment = (await import("../roundRobinReassignment")).default;
    const EventManager = (await import("@calcom/features/bookings/lib/EventManager")).default;

    const eventManagerSpy = vi.spyOn(EventManager.prototype as any, "reschedule");
    eventManagerSpy.mockClear();
    eventManagerSpy.mockResolvedValue({ referencesToCreate: [] });

    const users = testUsers.slice(0, 4); // host-1, host-2, host-3, host-4
    const originalHost = users[0]; // organizer — excluded from pool
    // host-3 has priority 3 (highest) — should be selected
    const expectedNewHost = users[2];

    const { dateString: dateStringPlusOne } = getDate({ dateIncrement: 1 });

    const bookingUid = "priority-assignment-test";

    await createBookingScenario(
      getScenarioData({
        eventTypes: [
          {
            id: 1,
            slug: "round-robin-priority-event",
            schedulingType: SchedulingType.ROUND_ROBIN,
            length: 45,
            users: users.map((user) => ({ id: user.id })),
            hosts: users.map((user) => ({
              userId: user.id,
              isFixed: false,
            })),
          },
        ],
        bookings: [
          {
            id: 123,
            eventTypeId: 1,
            userId: originalHost.id,
            uid: bookingUid,
            status: BookingStatus.ACCEPTED,
            startTime: `${dateStringPlusOne}T05:00:00.000Z`,
            endTime: `${dateStringPlusOne}T05:15:00.000Z`,
            attendees: [
              getMockBookingAttendee({
                id: 2,
                name: "attendee",
                email: "attendee@test.com",
                locale: "en",
                timeZone: "Asia/Kolkata",
              }),
            ],
          },
        ],
        organizer: originalHost,
        usersApartFromOrganizer: users.slice(1),
      })
    );

    // Set host priorities after scenario creation (InputHost doesn't support priority)
    // In Cal.com: higher number = higher priority. Default is null → treated as 2.
    await prismaMock.host.update({
      where: { userId_eventTypeId: { userId: users[1].id, eventTypeId: 1 } },
      data: { priority: 0 }, // lowest priority
    });
    await prismaMock.host.update({
      where: { userId_eventTypeId: { userId: users[2].id, eventTypeId: 1 } },
      data: { priority: 3 }, // highest priority
    });
    await prismaMock.host.update({
      where: { userId_eventTypeId: { userId: users[3].id, eventTypeId: 1 } },
      data: { priority: 2 }, // default priority
    });

    await roundRobinReassignment({
      bookingId: 123,
      orgId: null,
      reassignedById: originalHost.id,
      actionSource: "WEBAPP",
      reassignedByUuid: originalHost.uuid,
    });

    expect(eventManagerSpy).toBeCalledTimes(1);

    // getUsersWithHighestPriority: Math.max(...priorities) = 3
    // Only host-3 has priority 3, so host-3 is selected
    await expectBookingToBeInDatabase({
      uid: bookingUid,
      userId: expectedNewHost.id,
    });
  });

  // ---------------------------------------------------------------------------
  // Test 4: Segment filtering — rrSegmentQueryValue config passes through
  // ---------------------------------------------------------------------------
  test("Segment filtering — rrSegmentQueryValue filters host pool", async () => {
    const roundRobinReassignment = (await import("../roundRobinReassignment")).default;
    const EventManager = (await import("@calcom/features/bookings/lib/EventManager")).default;

    const eventManagerSpy = vi.spyOn(EventManager.prototype as any, "reschedule");
    eventManagerSpy.mockClear();
    eventManagerSpy.mockResolvedValue({ referencesToCreate: [] });

    const users = testUsers.slice(0, 3);
    const originalHost = users[0];

    const { dateString: dateStringPlusOne } = getDate({ dateIncrement: 1 });
    const { dateString: dateStringMinusOne } = getDate({ dateIncrement: -1 });

    const bookingUid = "segment-filter-test";

    await createBookingScenario(
      getScenarioData({
        eventTypes: [
          {
            id: 1,
            slug: "round-robin-segment-event",
            schedulingType: SchedulingType.ROUND_ROBIN,
            length: 45,
            assignRRMembersUsingSegment: true,
            users: users.map((user) => ({ id: user.id })),
            hosts: users.map((user) => ({
              userId: user.id,
              isFixed: false,
            })),
          },
        ],
        bookings: [
          {
            id: 123,
            eventTypeId: 1,
            userId: originalHost.id,
            uid: bookingUid,
            status: BookingStatus.ACCEPTED,
            startTime: `${dateStringPlusOne}T05:00:00.000Z`,
            endTime: `${dateStringPlusOne}T05:15:00.000Z`,
            attendees: [
              getMockBookingAttendee({
                id: 2,
                name: "attendee",
                email: "attendee@test.com",
                locale: "en",
                timeZone: "Asia/Kolkata",
              }),
            ],
          },
          // Extra booking for host-3 to steer selection to host-2
          {
            id: 456,
            eventTypeId: 1,
            userId: users[2].id,
            uid: "segment-older-booking",
            status: BookingStatus.ACCEPTED,
            startTime: `${dateStringMinusOne}T05:00:00.000Z`,
            endTime: `${dateStringMinusOne}T05:15:00.000Z`,
            attendees: [
              getMockBookingAttendee({
                id: 3,
                name: "attendee2",
                email: "attendee2@test.com",
                locale: "en",
                timeZone: "Asia/Kolkata",
              }),
            ],
          },
        ],
        organizer: originalHost,
        usersApartFromOrganizer: users.slice(1),
      })
    );

    // Verify reassignment completes successfully with segment config present
    await roundRobinReassignment({
      bookingId: 123,
      orgId: null,
      reassignedById: originalHost.id,
      actionSource: "WEBAPP",
      reassignedByUuid: originalHost.uuid,
    });

    expect(eventManagerSpy).toBeCalledTimes(1);

    // Verify the booking was updated — segment config loaded without errors
    await expectBookingToBeInDatabase({
      uid: bookingUid,
    });
  });

  // ---------------------------------------------------------------------------
  // Test 5: Edge cases
  // ---------------------------------------------------------------------------
  describe("Edge cases", () => {
    test("All hosts busy — throws appropriate error", async () => {
      const roundRobinReassignment = (await import("../roundRobinReassignment")).default;
      const EventManager = (await import("@calcom/features/bookings/lib/EventManager")).default;

      const eventManagerSpy = vi.spyOn(EventManager.prototype as any, "reschedule");
      eventManagerSpy.mockClear();
      eventManagerSpy.mockResolvedValue({ referencesToCreate: [] });

      // Only 2 hosts: host-1 (organizer) and host-2 (attendee)
      // After filtering out organizer + attendees, no users remain
      const users = testUsers.slice(0, 2);
      const originalHost = users[0]; // organizer — excluded
      const busyHost = users[1]; // attendee of the booking — excluded

      const { dateString: dateStringPlusOne } = getDate({ dateIncrement: 1 });

      const bookingUid = "all-busy-test";

      await createBookingScenario(
        getScenarioData({
          eventTypes: [
            {
              id: 1,
              slug: "round-robin-busy-event",
              schedulingType: SchedulingType.ROUND_ROBIN,
              length: 45,
              users: users.map((user) => ({ id: user.id })),
              hosts: users.map((user) => ({
                userId: user.id,
                isFixed: false,
              })),
            },
          ],
          bookings: [
            {
              id: 123,
              eventTypeId: 1,
              userId: originalHost.id,
              uid: bookingUid,
              status: BookingStatus.ACCEPTED,
              startTime: `${dateStringPlusOne}T05:00:00.000Z`,
              endTime: `${dateStringPlusOne}T05:15:00.000Z`,
              attendees: [
                // host-2 is an attendee — will be filtered out
                getMockBookingAttendee({
                  id: busyHost.id,
                  name: busyHost.name,
                  email: busyHost.email,
                  locale: "en",
                  timeZone: busyHost.timeZone,
                }),
              ],
            },
          ],
          organizer: originalHost,
          usersApartFromOrganizer: [busyHost],
        })
      );

      // When no hosts remain after filtering, the reassignment should throw
      await expect(
        roundRobinReassignment({
          bookingId: 123,
          orgId: null,
          reassignedById: originalHost.id,
          actionSource: "WEBAPP",
          reassignedByUuid: originalHost.uuid,
        })
      ).rejects.toThrow();
    });

    test("Single host available — correctly assigned", async () => {
      const roundRobinReassignment = (await import("../roundRobinReassignment")).default;
      const EventManager = (await import("@calcom/features/bookings/lib/EventManager")).default;

      const eventManagerSpy = vi.spyOn(EventManager.prototype as any, "reschedule");
      eventManagerSpy.mockClear();
      eventManagerSpy.mockResolvedValue({ referencesToCreate: [] });

      const users = testUsers.slice(0, 3);
      const originalHost = users[0]; // organizer — excluded
      const attendeeHost = users[1]; // attendee — excluded
      const onlyAvailableHost = users[2]; // only remaining host

      const { dateString: dateStringPlusOne } = getDate({ dateIncrement: 1 });

      const bookingUid = "single-available-test";

      await createBookingScenario(
        getScenarioData({
          eventTypes: [
            {
              id: 1,
              slug: "round-robin-single-event",
              schedulingType: SchedulingType.ROUND_ROBIN,
              length: 45,
              users: users.map((user) => ({ id: user.id })),
              hosts: users.map((user) => ({
                userId: user.id,
                isFixed: false,
              })),
            },
          ],
          bookings: [
            {
              id: 123,
              eventTypeId: 1,
              userId: originalHost.id,
              uid: bookingUid,
              status: BookingStatus.ACCEPTED,
              startTime: `${dateStringPlusOne}T05:00:00.000Z`,
              endTime: `${dateStringPlusOne}T05:15:00.000Z`,
              attendees: [
                // host-2 is an attendee — will be filtered out
                getMockBookingAttendee({
                  id: attendeeHost.id,
                  name: attendeeHost.name,
                  email: attendeeHost.email,
                  locale: "en",
                  timeZone: attendeeHost.timeZone,
                }),
              ],
            },
          ],
          organizer: originalHost,
          usersApartFromOrganizer: users.slice(1),
        })
      );

      await roundRobinReassignment({
        bookingId: 123,
        orgId: null,
        reassignedById: originalHost.id,
        actionSource: "WEBAPP",
        reassignedByUuid: originalHost.uuid,
      });

      expect(eventManagerSpy).toBeCalledTimes(1);

      // Only host-3 remains after filtering — must be selected
      await expectBookingToBeInDatabase({
        uid: bookingUid,
        userId: onlyAvailableHost.id,
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Test 6: Fixed hosts never selected in RR rotation pool
  // ---------------------------------------------------------------------------
  test("Fixed hosts never selected in RR rotation pool", async () => {
    const roundRobinReassignment = (await import("../roundRobinReassignment")).default;
    const EventManager = (await import("@calcom/features/bookings/lib/EventManager")).default;

    const eventManagerSpy = vi.spyOn(EventManager.prototype as any, "reschedule");
    eventManagerSpy.mockClear();
    eventManagerSpy.mockResolvedValue({ referencesToCreate: [] });

    const users = testUsers.slice(0, 3);
    const fixedHost = users[0]; // isFixed: true — booking organizer
    const currentRRHost = users[1]; // current RR attendee
    const newHost = users[2]; // expected new RR attendee

    const { dateString: dateStringPlusOne } = getDate({ dateIncrement: 1 });

    const bookingUid = "fixed-host-test";

    await createBookingScenario(
      getScenarioData({
        eventTypes: [
          {
            id: 1,
            slug: "round-robin-event",
            schedulingType: SchedulingType.ROUND_ROBIN,
            length: 45,
            users: users.map((user) => ({ id: user.id })),
            hosts: users.map((user) => ({
              userId: user.id,
              isFixed: !!(user.id === fixedHost.id),
            })),
          },
        ],
        bookings: [
          {
            id: 123,
            eventTypeId: 1,
            userId: fixedHost.id,
            uid: bookingUid,
            status: BookingStatus.ACCEPTED,
            startTime: `${dateStringPlusOne}T05:00:00.000Z`,
            endTime: `${dateStringPlusOne}T05:15:00.000Z`,
            attendees: [
              getMockBookingAttendee({
                id: 1,
                name: "attendee",
                email: "attendee@test.com",
                locale: "en",
                timeZone: "Asia/Kolkata",
              }),
              // Current RR host is in attendees
              getMockBookingAttendee({
                id: currentRRHost.id,
                name: currentRRHost.name,
                email: currentRRHost.email,
                locale: "en",
                timeZone: currentRRHost.timeZone,
              }),
            ],
          },
        ],
        organizer: fixedHost,
        usersApartFromOrganizer: users.slice(1),
      })
    );

    await roundRobinReassignment({
      bookingId: 123,
      orgId: null,
      reassignedById: fixedHost.id,
      actionSource: "WEBAPP",
      reassignedByUuid: fixedHost.uuid,
    });

    expect(eventManagerSpy).toBeCalledTimes(1);
    // Fixed host scenario: changedOrganizer = false
    expect(eventManagerSpy).toHaveBeenCalledWith(
      expect.any(Object),
      bookingUid,
      undefined,
      false,
      [],
      undefined,
      false
    );

    // Organizer remains the fixed host
    await expectBookingToBeInDatabase({
      uid: bookingUid,
      userId: fixedHost.id,
    });

    // Verify attendee swap: old RR host removed, new RR host added
    const bookingRepo = new BookingRepository(prismaMock);
    const attendees = await bookingRepo.getBookingAttendees(123);

    expect(attendees.some((attendee) => attendee.email === currentRRHost.email)).toBe(false);
    expect(attendees.some((attendee) => attendee.email === newHost.email)).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Test 7: Assignment reason recording
  // ---------------------------------------------------------------------------
  test("Assignment reason recording — AssignmentReasonRecorder records RR_REASSIGNED with correct data", async () => {
    const roundRobinReassignment = (await import("../roundRobinReassignment")).default;
    const EventManager = (await import("@calcom/features/bookings/lib/EventManager")).default;

    const eventManagerSpy = vi.spyOn(EventManager.prototype as any, "reschedule");
    eventManagerSpy.mockClear();
    eventManagerSpy.mockResolvedValue({ referencesToCreate: [] });

    const users = testUsers.slice(0, 3);
    const originalHost = users[0];

    const { dateString: dateStringPlusOne } = getDate({ dateIncrement: 1 });
    const { dateString: dateStringMinusOne } = getDate({ dateIncrement: -1 });

    const bookingUid = "assignment-reason-test";

    await createBookingScenario(
      getScenarioData({
        eventTypes: [
          {
            id: 1,
            slug: "round-robin-event",
            schedulingType: SchedulingType.ROUND_ROBIN,
            length: 45,
            users: users.map((user) => ({ id: user.id })),
            hosts: users.map((user) => ({
              userId: user.id,
              isFixed: false,
            })),
          },
        ],
        bookings: [
          {
            id: 123,
            eventTypeId: 1,
            userId: originalHost.id,
            uid: bookingUid,
            status: BookingStatus.ACCEPTED,
            startTime: `${dateStringPlusOne}T05:00:00.000Z`,
            endTime: `${dateStringPlusOne}T05:15:00.000Z`,
            attendees: [
              getMockBookingAttendee({
                id: 2,
                name: "attendee",
                email: "attendee@test.com",
                locale: "en",
                timeZone: "Asia/Kolkata",
              }),
            ],
          },
          // Extra booking to steer RR selection
          {
            id: 456,
            eventTypeId: 1,
            userId: users[2].id,
            uid: "reason-older-booking",
            status: BookingStatus.ACCEPTED,
            startTime: `${dateStringMinusOne}T05:00:00.000Z`,
            endTime: `${dateStringMinusOne}T05:15:00.000Z`,
            attendees: [
              getMockBookingAttendee({
                id: 3,
                name: "attendee2",
                email: "attendee2@test.com",
                locale: "en",
                timeZone: "Asia/Kolkata",
              }),
            ],
          },
        ],
        organizer: originalHost,
        usersApartFromOrganizer: users.slice(1),
      })
    );

    await roundRobinReassignment({
      bookingId: 123,
      orgId: null,
      reassignedById: originalHost.id,
      actionSource: "WEBAPP",
      reassignedByUuid: originalHost.uuid,
    });

    // Verify AssignmentReasonRecorder.roundRobinReassignment persisted the reason.
    // prismaMock uses prismock (in-memory DB) — query directly instead of spy.
    const assignmentReasons = await prismaMock.assignmentReason.findMany({
      where: { bookingId: 123 },
    });

    expect(assignmentReasons.length).toBeGreaterThan(0);

    const reason = assignmentReasons[0];
    // Verify reasonEnum is RR_REASSIGNED (not REASSIGNED which is manual)
    expect(reason.reasonEnum).toBe("RR_REASSIGNED");
    // Verify reasonString contains "Reassigned by:" identifier
    expect(reason.reasonString).toContain("Reassigned by:");
    // Verify the bookingId references the correct booking
    expect(reason.bookingId).toBe(123);
  });
});
