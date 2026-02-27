/**
 * @file Golden test fixtures for the `VERSION_2024_09_04` Slots API E2E test suite.
 * @module SlotsModule_2024_09_04 E2E Test Fixtures
 *
 * Provides 4 immutable golden fixture exports representing deterministic slot availability
 * output. These are the expected results of the slot generation algorithm
 * (`packages/features/schedules/lib/slots.ts`) for a standard Mon-Fri 9AM-5PM Europe/Rome schedule.
 *
 * **Fixture Definitions:**
 * - `expectedSlotsUTC` — Start-only format in UTC (Z suffix). 8 hourly slots per day at 07:00-14:00Z.
 * - `expectedSlotsRome` — Start-only format in Europe/Rome timezone (+02:00 CEST). 8 hourly slots per day at 09:00-16:00+02:00.
 * - `expectedSlotsUTCRange` — Start+end (range) format in UTC. Each slot spans 1 hour (07:00-08:00Z through 14:00-15:00Z).
 * - `expectedSlotsRomeRange` — Start+end (range) format in Europe/Rome (+02:00). Each slot spans 1 hour (09:00-10:00+02:00 through 16:00-17:00+02:00).
 *
 * **Date Range:** 2050-09-05 (Monday) through 2050-09-09 (Friday) — 5 weekdays
 *
 * **Schedule Configuration:** Mon-Fri 9AM-5PM Europe/Rome (UTC+2 in September due to CEST DST)
 *
 * **Slot Count:** 8 hourly slots per day × 5 days = 40 total slots per fixture
 *
 * **Event Duration:** 60 minutes (default), reflected in range format as `end = start + 1 hour`
 *
 * **Timezone Math:** Europe/Rome (CEST, September) = UTC+2.
 * So 07:00Z = 09:00+02:00 and 14:00Z = 16:00+02:00.
 *
 * **Consumers:** All 5 E2E spec files in this directory:
 * - `dynamic-event-type-slots.controller.e2e-spec.ts` — imports `expectedSlotsUTC`, `expectedSlotsRome`
 * - `org-team-event-type-slots.controller.e2e-spec.ts` — imports `expectedSlotsUTC`
 * - `reschedule-uid-slots.controller.e2e-spec.ts` — imports `expectedSlotsUTC`, `expectedSlotsUTCRange`
 * - `team-event-type-slots.controller.e2e-spec.ts` — imports `expectedSlotsUTC`
 * - `user-event-type-slots.controller.e2e-spec.ts` — imports all 4 fixtures
 *
 * @warning **IMMUTABILITY**: DO NOT modify any fixture data. These are deterministic golden test
 * outputs that all E2E assertions depend on. Changing any value will break multiple test suites.
 *
 * @see {@link packages/features/schedules/lib/slots.ts} — `buildSlotsWithDateRanges` / `getSlots` that produces these outputs
 * @see {@link packages/features/schedules/lib/date-ranges.ts} — Date range processing with DST normalization
 * @see {@link packages/lib/availability.ts} — `DEFAULT_SCHEDULE` (Mon-Fri 9AM-5PM) constants
 */

/**
 * Golden fixture for UTC slot availability in start-only format.
 *
 * 5 days × 8 hourly slots = 40 entries.
 * UTC times: 07:00Z through 14:00Z per day.
 * Corresponds to 9AM-5PM Europe/Rome (UTC+2 CEST in September).
 */
export const expectedSlotsUTC = {
  "2050-09-05": [
    { start: "2050-09-05T07:00:00.000Z" },
    { start: "2050-09-05T08:00:00.000Z" },
    { start: "2050-09-05T09:00:00.000Z" },
    { start: "2050-09-05T10:00:00.000Z" },
    { start: "2050-09-05T11:00:00.000Z" },
    { start: "2050-09-05T12:00:00.000Z" },
    { start: "2050-09-05T13:00:00.000Z" },
    { start: "2050-09-05T14:00:00.000Z" },
  ],
  "2050-09-06": [
    { start: "2050-09-06T07:00:00.000Z" },
    { start: "2050-09-06T08:00:00.000Z" },
    { start: "2050-09-06T09:00:00.000Z" },
    { start: "2050-09-06T10:00:00.000Z" },
    { start: "2050-09-06T11:00:00.000Z" },
    { start: "2050-09-06T12:00:00.000Z" },
    { start: "2050-09-06T13:00:00.000Z" },
    { start: "2050-09-06T14:00:00.000Z" },
  ],
  "2050-09-07": [
    { start: "2050-09-07T07:00:00.000Z" },
    { start: "2050-09-07T08:00:00.000Z" },
    { start: "2050-09-07T09:00:00.000Z" },
    { start: "2050-09-07T10:00:00.000Z" },
    { start: "2050-09-07T11:00:00.000Z" },
    { start: "2050-09-07T12:00:00.000Z" },
    { start: "2050-09-07T13:00:00.000Z" },
    { start: "2050-09-07T14:00:00.000Z" },
  ],
  "2050-09-08": [
    { start: "2050-09-08T07:00:00.000Z" },
    { start: "2050-09-08T08:00:00.000Z" },
    { start: "2050-09-08T09:00:00.000Z" },
    { start: "2050-09-08T10:00:00.000Z" },
    { start: "2050-09-08T11:00:00.000Z" },
    { start: "2050-09-08T12:00:00.000Z" },
    { start: "2050-09-08T13:00:00.000Z" },
    { start: "2050-09-08T14:00:00.000Z" },
  ],
  "2050-09-09": [
    { start: "2050-09-09T07:00:00.000Z" },
    { start: "2050-09-09T08:00:00.000Z" },
    { start: "2050-09-09T09:00:00.000Z" },
    { start: "2050-09-09T10:00:00.000Z" },
    { start: "2050-09-09T11:00:00.000Z" },
    { start: "2050-09-09T12:00:00.000Z" },
    { start: "2050-09-09T13:00:00.000Z" },
    { start: "2050-09-09T14:00:00.000Z" },
  ],
};

/**
 * Golden fixture for Europe/Rome slot availability in start-only format.
 *
 * 5 days × 8 hourly slots = 40 entries.
 * Rome times: 09:00+02:00 through 16:00+02:00 per day.
 * Same underlying schedule as {@link expectedSlotsUTC} but in the invitee's Rome timezone.
 */
export const expectedSlotsRome = {
  "2050-09-05": [
    { start: "2050-09-05T09:00:00.000+02:00" },
    { start: "2050-09-05T10:00:00.000+02:00" },
    { start: "2050-09-05T11:00:00.000+02:00" },
    { start: "2050-09-05T12:00:00.000+02:00" },
    { start: "2050-09-05T13:00:00.000+02:00" },
    { start: "2050-09-05T14:00:00.000+02:00" },
    { start: "2050-09-05T15:00:00.000+02:00" },
    { start: "2050-09-05T16:00:00.000+02:00" },
  ],
  "2050-09-06": [
    { start: "2050-09-06T09:00:00.000+02:00" },
    { start: "2050-09-06T10:00:00.000+02:00" },
    { start: "2050-09-06T11:00:00.000+02:00" },
    { start: "2050-09-06T12:00:00.000+02:00" },
    { start: "2050-09-06T13:00:00.000+02:00" },
    { start: "2050-09-06T14:00:00.000+02:00" },
    { start: "2050-09-06T15:00:00.000+02:00" },
    { start: "2050-09-06T16:00:00.000+02:00" },
  ],
  "2050-09-07": [
    { start: "2050-09-07T09:00:00.000+02:00" },
    { start: "2050-09-07T10:00:00.000+02:00" },
    { start: "2050-09-07T11:00:00.000+02:00" },
    { start: "2050-09-07T12:00:00.000+02:00" },
    { start: "2050-09-07T13:00:00.000+02:00" },
    { start: "2050-09-07T14:00:00.000+02:00" },
    { start: "2050-09-07T15:00:00.000+02:00" },
    { start: "2050-09-07T16:00:00.000+02:00" },
  ],
  "2050-09-08": [
    { start: "2050-09-08T09:00:00.000+02:00" },
    { start: "2050-09-08T10:00:00.000+02:00" },
    { start: "2050-09-08T11:00:00.000+02:00" },
    { start: "2050-09-08T12:00:00.000+02:00" },
    { start: "2050-09-08T13:00:00.000+02:00" },
    { start: "2050-09-08T14:00:00.000+02:00" },
    { start: "2050-09-08T15:00:00.000+02:00" },
    { start: "2050-09-08T16:00:00.000+02:00" },
  ],
  "2050-09-09": [
    { start: "2050-09-09T09:00:00.000+02:00" },
    { start: "2050-09-09T10:00:00.000+02:00" },
    { start: "2050-09-09T11:00:00.000+02:00" },
    { start: "2050-09-09T12:00:00.000+02:00" },
    { start: "2050-09-09T13:00:00.000+02:00" },
    { start: "2050-09-09T14:00:00.000+02:00" },
    { start: "2050-09-09T15:00:00.000+02:00" },
    { start: "2050-09-09T16:00:00.000+02:00" },
  ],
};

/**
 * Golden fixture for UTC slot availability in start+end range format.
 *
 * 5 days × 8 hourly slots = 40 entries.
 * Each slot spans exactly 1 hour (60-minute event duration).
 * UTC times: 07:00-08:00Z through 14:00-15:00Z per day.
 */
export const expectedSlotsUTCRange = {
  "2050-09-05": [
    { start: "2050-09-05T07:00:00.000Z", end: "2050-09-05T08:00:00.000Z" },
    { start: "2050-09-05T08:00:00.000Z", end: "2050-09-05T09:00:00.000Z" },
    { start: "2050-09-05T09:00:00.000Z", end: "2050-09-05T10:00:00.000Z" },
    { start: "2050-09-05T10:00:00.000Z", end: "2050-09-05T11:00:00.000Z" },
    { start: "2050-09-05T11:00:00.000Z", end: "2050-09-05T12:00:00.000Z" },
    { start: "2050-09-05T12:00:00.000Z", end: "2050-09-05T13:00:00.000Z" },
    { start: "2050-09-05T13:00:00.000Z", end: "2050-09-05T14:00:00.000Z" },
    { start: "2050-09-05T14:00:00.000Z", end: "2050-09-05T15:00:00.000Z" },
  ],
  "2050-09-06": [
    { start: "2050-09-06T07:00:00.000Z", end: "2050-09-06T08:00:00.000Z" },
    { start: "2050-09-06T08:00:00.000Z", end: "2050-09-06T09:00:00.000Z" },
    { start: "2050-09-06T09:00:00.000Z", end: "2050-09-06T10:00:00.000Z" },
    { start: "2050-09-06T10:00:00.000Z", end: "2050-09-06T11:00:00.000Z" },
    { start: "2050-09-06T11:00:00.000Z", end: "2050-09-06T12:00:00.000Z" },
    { start: "2050-09-06T12:00:00.000Z", end: "2050-09-06T13:00:00.000Z" },
    { start: "2050-09-06T13:00:00.000Z", end: "2050-09-06T14:00:00.000Z" },
    { start: "2050-09-06T14:00:00.000Z", end: "2050-09-06T15:00:00.000Z" },
  ],
  "2050-09-07": [
    { start: "2050-09-07T07:00:00.000Z", end: "2050-09-07T08:00:00.000Z" },
    { start: "2050-09-07T08:00:00.000Z", end: "2050-09-07T09:00:00.000Z" },
    { start: "2050-09-07T09:00:00.000Z", end: "2050-09-07T10:00:00.000Z" },
    { start: "2050-09-07T10:00:00.000Z", end: "2050-09-07T11:00:00.000Z" },
    { start: "2050-09-07T11:00:00.000Z", end: "2050-09-07T12:00:00.000Z" },
    { start: "2050-09-07T12:00:00.000Z", end: "2050-09-07T13:00:00.000Z" },
    { start: "2050-09-07T13:00:00.000Z", end: "2050-09-07T14:00:00.000Z" },
    { start: "2050-09-07T14:00:00.000Z", end: "2050-09-07T15:00:00.000Z" },
  ],
  "2050-09-08": [
    { start: "2050-09-08T07:00:00.000Z", end: "2050-09-08T08:00:00.000Z" },
    { start: "2050-09-08T08:00:00.000Z", end: "2050-09-08T09:00:00.000Z" },
    { start: "2050-09-08T09:00:00.000Z", end: "2050-09-08T10:00:00.000Z" },
    { start: "2050-09-08T10:00:00.000Z", end: "2050-09-08T11:00:00.000Z" },
    { start: "2050-09-08T11:00:00.000Z", end: "2050-09-08T12:00:00.000Z" },
    { start: "2050-09-08T12:00:00.000Z", end: "2050-09-08T13:00:00.000Z" },
    { start: "2050-09-08T13:00:00.000Z", end: "2050-09-08T14:00:00.000Z" },
    { start: "2050-09-08T14:00:00.000Z", end: "2050-09-08T15:00:00.000Z" },
  ],
  "2050-09-09": [
    { start: "2050-09-09T07:00:00.000Z", end: "2050-09-09T08:00:00.000Z" },
    { start: "2050-09-09T08:00:00.000Z", end: "2050-09-09T09:00:00.000Z" },
    { start: "2050-09-09T09:00:00.000Z", end: "2050-09-09T10:00:00.000Z" },
    { start: "2050-09-09T10:00:00.000Z", end: "2050-09-09T11:00:00.000Z" },
    { start: "2050-09-09T11:00:00.000Z", end: "2050-09-09T12:00:00.000Z" },
    { start: "2050-09-09T12:00:00.000Z", end: "2050-09-09T13:00:00.000Z" },
    { start: "2050-09-09T13:00:00.000Z", end: "2050-09-09T14:00:00.000Z" },
    { start: "2050-09-09T14:00:00.000Z", end: "2050-09-09T15:00:00.000Z" },
  ],
};

/**
 * Golden fixture for Europe/Rome slot availability in start+end range format.
 *
 * 5 days × 8 hourly slots = 40 entries.
 * Each slot spans exactly 1 hour (60-minute event duration).
 * Rome times: 09:00-10:00+02:00 through 16:00-17:00+02:00 per day.
 */
export const expectedSlotsRomeRange = {
  "2050-09-05": [
    { start: "2050-09-05T09:00:00.000+02:00", end: "2050-09-05T10:00:00.000+02:00" },
    { start: "2050-09-05T10:00:00.000+02:00", end: "2050-09-05T11:00:00.000+02:00" },
    { start: "2050-09-05T11:00:00.000+02:00", end: "2050-09-05T12:00:00.000+02:00" },
    { start: "2050-09-05T12:00:00.000+02:00", end: "2050-09-05T13:00:00.000+02:00" },
    { start: "2050-09-05T13:00:00.000+02:00", end: "2050-09-05T14:00:00.000+02:00" },
    { start: "2050-09-05T14:00:00.000+02:00", end: "2050-09-05T15:00:00.000+02:00" },
    { start: "2050-09-05T15:00:00.000+02:00", end: "2050-09-05T16:00:00.000+02:00" },
    { start: "2050-09-05T16:00:00.000+02:00", end: "2050-09-05T17:00:00.000+02:00" },
  ],
  "2050-09-06": [
    { start: "2050-09-06T09:00:00.000+02:00", end: "2050-09-06T10:00:00.000+02:00" },
    { start: "2050-09-06T10:00:00.000+02:00", end: "2050-09-06T11:00:00.000+02:00" },
    { start: "2050-09-06T11:00:00.000+02:00", end: "2050-09-06T12:00:00.000+02:00" },
    { start: "2050-09-06T12:00:00.000+02:00", end: "2050-09-06T13:00:00.000+02:00" },
    { start: "2050-09-06T13:00:00.000+02:00", end: "2050-09-06T14:00:00.000+02:00" },
    { start: "2050-09-06T14:00:00.000+02:00", end: "2050-09-06T15:00:00.000+02:00" },
    { start: "2050-09-06T15:00:00.000+02:00", end: "2050-09-06T16:00:00.000+02:00" },
    { start: "2050-09-06T16:00:00.000+02:00", end: "2050-09-06T17:00:00.000+02:00" },
  ],
  "2050-09-07": [
    { start: "2050-09-07T09:00:00.000+02:00", end: "2050-09-07T10:00:00.000+02:00" },
    { start: "2050-09-07T10:00:00.000+02:00", end: "2050-09-07T11:00:00.000+02:00" },
    { start: "2050-09-07T11:00:00.000+02:00", end: "2050-09-07T12:00:00.000+02:00" },
    { start: "2050-09-07T12:00:00.000+02:00", end: "2050-09-07T13:00:00.000+02:00" },
    { start: "2050-09-07T13:00:00.000+02:00", end: "2050-09-07T14:00:00.000+02:00" },
    { start: "2050-09-07T14:00:00.000+02:00", end: "2050-09-07T15:00:00.000+02:00" },
    { start: "2050-09-07T15:00:00.000+02:00", end: "2050-09-07T16:00:00.000+02:00" },
    { start: "2050-09-07T16:00:00.000+02:00", end: "2050-09-07T17:00:00.000+02:00" },
  ],
  "2050-09-08": [
    { start: "2050-09-08T09:00:00.000+02:00", end: "2050-09-08T10:00:00.000+02:00" },
    { start: "2050-09-08T10:00:00.000+02:00", end: "2050-09-08T11:00:00.000+02:00" },
    { start: "2050-09-08T11:00:00.000+02:00", end: "2050-09-08T12:00:00.000+02:00" },
    { start: "2050-09-08T12:00:00.000+02:00", end: "2050-09-08T13:00:00.000+02:00" },
    { start: "2050-09-08T13:00:00.000+02:00", end: "2050-09-08T14:00:00.000+02:00" },
    { start: "2050-09-08T14:00:00.000+02:00", end: "2050-09-08T15:00:00.000+02:00" },
    { start: "2050-09-08T15:00:00.000+02:00", end: "2050-09-08T16:00:00.000+02:00" },
    { start: "2050-09-08T16:00:00.000+02:00", end: "2050-09-08T17:00:00.000+02:00" },
  ],
  "2050-09-09": [
    { start: "2050-09-09T09:00:00.000+02:00", end: "2050-09-09T10:00:00.000+02:00" },
    { start: "2050-09-09T10:00:00.000+02:00", end: "2050-09-09T11:00:00.000+02:00" },
    { start: "2050-09-09T11:00:00.000+02:00", end: "2050-09-09T12:00:00.000+02:00" },
    { start: "2050-09-09T12:00:00.000+02:00", end: "2050-09-09T13:00:00.000+02:00" },
    { start: "2050-09-09T13:00:00.000+02:00", end: "2050-09-09T14:00:00.000+02:00" },
    { start: "2050-09-09T14:00:00.000+02:00", end: "2050-09-09T15:00:00.000+02:00" },
    { start: "2050-09-09T15:00:00.000+02:00", end: "2050-09-09T16:00:00.000+02:00" },
    { start: "2050-09-09T16:00:00.000+02:00", end: "2050-09-09T17:00:00.000+02:00" },
  ],
};
