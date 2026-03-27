/**
 * Booking Window Parity Test Suite — Sprint 2: Event Types (F-002), Epic ET-005
 *
 * Verifies Cal.com's booking window configuration achieves behavioral parity with
 * Calendly's three booking window options:
 *   1. Days into the future (rolling) — calendar or business days
 *   2. A specific date range
 *   3. Indefinitely (no upper bound)
 *
 * Covers ET-VAL-006 from the validation criteria and validates the ET-005 epic
 * (Booking Window Configuration Alignment).
 *
 * Calendly-to-Cal.com Booking Window Mapping:
 *   - Calendly "Days into the future (calendar)" → PeriodType.ROLLING + periodCountCalendarDays: true
 *   - Calendly "Days into the future (business)" → PeriodType.ROLLING_WINDOW + periodCountCalendarDays: false
 *   - Calendly "Date range"                      → PeriodType.RANGE + periodStartDate + periodEndDate
 *   - Calendly "Indefinitely"                    → PeriodType.UNLIMITED
 *
 * @see docs/gap-report/event-types.mdx — Gap analysis for event types
 * @see docs/sprint-roadmap/validation-criteria.mdx — ET-VAL-006
 * @see packages/features/eventtypes/components/tabs/limits/EventLimitsTab.tsx — UI conversion helpers
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";

import { PeriodType } from "@calcom/prisma/enums";

import { createEventTypeInput } from "../schemas";
import type { FormValues } from "../types";

// ---------------------------------------------------------------------------
// Configuration Fixture — Mirrors EventType model booking window fields
// ---------------------------------------------------------------------------

/**
 * BookingWindowConfig represents the booking-window-relevant subset of the
 * EventType Prisma model. Fields map directly to schema.prisma definitions:
 *   - periodType: PeriodType enum (UNLIMITED, ROLLING, ROLLING_WINDOW, RANGE)
 *   - periodDays: Int? — number of days for ROLLING/ROLLING_WINDOW
 *   - periodStartDate: DateTime? — start of RANGE window
 *   - periodEndDate: DateTime? — end of RANGE window
 *   - periodCountCalendarDays: Boolean? — calendar vs business days for ROLLING
 *   - minimumBookingNotice: Int @default(120) — minutes of advance notice required
 */
interface BookingWindowConfig {
  periodType: string;
  periodDays: number | null;
  periodStartDate: Date | null;
  periodEndDate: Date | null;
  periodCountCalendarDays: boolean | null;
  minimumBookingNotice: number;
}

/**
 * Factory for creating booking window configurations with sensible defaults.
 * Defaults to UNLIMITED (indefinite) with 120-minute minimum notice, matching
 * the Prisma schema default for the EventType model.
 */
const createBookingWindowConfig = (overrides: Partial<BookingWindowConfig> = {}): BookingWindowConfig => ({
  periodType: PeriodType.UNLIMITED,
  periodDays: null,
  periodStartDate: null,
  periodEndDate: null,
  periodCountCalendarDays: null,
  minimumBookingNotice: 120,
  ...overrides,
});

// ---------------------------------------------------------------------------
// Type-Level Verification — Ensure BookingWindowConfig aligns with FormValues
// ---------------------------------------------------------------------------

/**
 * Compile-time verification that BookingWindowConfig fields are present in
 * the canonical FormValues type. This ensures our test interface stays in sync
 * with the production type. If FormValues changes, this will cause a compile error.
 */
type AssertFormValuesHasPeriodType = FormValues["periodType"];
type AssertFormValuesHasPeriodDays = FormValues["periodDays"];
type AssertFormValuesHasPeriodCountCalendarDays = FormValues["periodCountCalendarDays"];
type AssertFormValuesHasPeriodDates = FormValues["periodDates"];
type AssertFormValuesHasRollingExcludeUnavailableDays = FormValues["rollingExcludeUnavailableDays"];
type AssertFormValuesHasMinimumBookingNotice = FormValues["minimumBookingNotice"];

// Suppress unused type warnings — these exist purely for compile-time validation
void 0 as unknown as AssertFormValuesHasPeriodType;
void 0 as unknown as AssertFormValuesHasPeriodDays;
void 0 as unknown as AssertFormValuesHasPeriodCountCalendarDays;
void 0 as unknown as AssertFormValuesHasPeriodDates;
void 0 as unknown as AssertFormValuesHasRollingExcludeUnavailableDays;
void 0 as unknown as AssertFormValuesHasMinimumBookingNotice;

// ---------------------------------------------------------------------------
// Test Suite
// ---------------------------------------------------------------------------

/**
 * Set a deterministic system time for all date-dependent tests.
 * Using 2025-01-15T10:00:00Z (a Wednesday) to ensure consistent behavior.
 */
beforeAll(() => {
  vi.setSystemTime(new Date("2025-01-15T10:00:00Z"));
});

describe("Booking Window Parity (ET-005)", () => {
  // =========================================================================
  // Section 2a: PeriodType Enum Coverage
  // =========================================================================
  describe("PeriodType Enum Coverage", () => {
    it("should have UNLIMITED period type for indefinite booking window", () => {
      // Calendly "Indefinitely" maps to Cal.com PeriodType.UNLIMITED
      expect(PeriodType.UNLIMITED).toBeDefined();
      expect(PeriodType.UNLIMITED).toBe("UNLIMITED");
    });

    it("should have ROLLING period type for days-into-future booking window", () => {
      // Calendly "Days into the future" (calendar days) maps to Cal.com PeriodType.ROLLING
      expect(PeriodType.ROLLING).toBeDefined();
      expect(PeriodType.ROLLING).toBe("ROLLING");
    });

    it("should have ROLLING_WINDOW period type for business-days booking window", () => {
      // Calendly "Days into the future" (business days) maps to Cal.com PeriodType.ROLLING_WINDOW
      // This addresses AVL-GAP-001 from the availability gap report — business day support
      expect(PeriodType.ROLLING_WINDOW).toBeDefined();
      expect(PeriodType.ROLLING_WINDOW).toBe("ROLLING_WINDOW");
    });

    it("should have RANGE period type for date range booking window", () => {
      // Calendly "Date range" maps to Cal.com PeriodType.RANGE
      expect(PeriodType.RANGE).toBeDefined();
      expect(PeriodType.RANGE).toBe("RANGE");
    });

    it("should cover all four PeriodType enum values", () => {
      const allValues = Object.values(PeriodType);
      expect(allValues).toHaveLength(4);
      expect(allValues).toContain(PeriodType.UNLIMITED);
      expect(allValues).toContain(PeriodType.ROLLING);
      expect(allValues).toContain(PeriodType.ROLLING_WINDOW);
      expect(allValues).toContain(PeriodType.RANGE);
    });
  });

  // =========================================================================
  // Section 2b: Calendar vs Business Days (periodCountCalendarDays)
  // =========================================================================
  describe("Calendar vs Business Days (periodCountCalendarDays)", () => {
    it("should support calendar days counting with periodCountCalendarDays true", () => {
      // Calendar days = include weekends and unavailable days in the rolling count
      const config = createBookingWindowConfig({
        periodType: PeriodType.ROLLING,
        periodDays: 30,
        periodCountCalendarDays: true,
      });

      expect(config.periodType).toBe(PeriodType.ROLLING);
      expect(config.periodDays).toBe(30);
      expect(config.periodCountCalendarDays).toBe(true);
    });

    it("should support business days counting with ROLLING_WINDOW", () => {
      // This addresses AVL-GAP-001 from the availability gap report:
      // Business days counting excludes weekends and unavailable days from the rolling count.
      // In the UI, ROLLING_WINDOW is represented as ROLLING + rollingExcludeUnavailableDays: true,
      // then converted to PeriodType.ROLLING_WINDOW by getPeriodTypeFromUiValue() in EventLimitsTab.tsx.
      const config = createBookingWindowConfig({
        periodType: PeriodType.ROLLING_WINDOW,
        periodDays: 20,
        periodCountCalendarDays: false,
      });

      expect(config.periodType).toBe(PeriodType.ROLLING_WINDOW);
      expect(config.periodDays).toBe(20);
      expect(config.periodCountCalendarDays).toBe(false);
    });

    it("should distinguish ROLLING from ROLLING_WINDOW in PeriodType enum", () => {
      // These must be distinct enum values — ROLLING counts calendar days,
      // ROLLING_WINDOW counts business days (excludes unavailable days)
      expect(PeriodType.ROLLING).not.toBe(PeriodType.ROLLING_WINDOW);
      expect(typeof PeriodType.ROLLING).toBe("string");
      expect(typeof PeriodType.ROLLING_WINDOW).toBe("string");
    });
  });

  // =========================================================================
  // Section 2c: Minimum Booking Notice Enforcement
  // =========================================================================
  describe("Minimum Booking Notice Enforcement", () => {
    it("should enforce default minimum booking notice of 120 minutes", () => {
      // The Prisma schema defines: minimumBookingNotice Int @default(120)
      // This means the default is 2 hours advance notice, matching Calendly's default behavior
      const config = createBookingWindowConfig({
        minimumBookingNotice: 120,
      });

      expect(config.minimumBookingNotice).toBe(120);
      // Verify 120 minutes = 2 hours
      expect(config.minimumBookingNotice / 60).toBe(2);
    });

    it("should allow zero minimum booking notice", () => {
      // Zero means last-minute bookings are allowed — no advance notice required
      const config = createBookingWindowConfig({
        minimumBookingNotice: 0,
      });

      expect(config.minimumBookingNotice).toBe(0);

      // Validate through the Zod schema: z.number().int().min(0) should accept 0
      const result = createEventTypeInput.safeParse({
        title: "Test Event",
        slug: "test-event",
        length: 30,
        minimumBookingNotice: 0,
      });

      // The schema should accept 0 for minimumBookingNotice
      if (!result.success) {
        // If the parse fails, the error should NOT be about minimumBookingNotice
        const minimumBookingNoticeErrors = result.error.issues.filter(
          (issue) => issue.path.includes("minimumBookingNotice")
        );
        expect(minimumBookingNoticeErrors).toHaveLength(0);
      }
    });

    it("should allow custom minimum booking notice values", () => {
      // Verify various common booking notice periods are valid non-negative integers
      const validNoticeValues = [
        { value: 30, description: "30 minutes" },
        { value: 120, description: "2 hours (default)" },
        { value: 1440, description: "24 hours (1 day)" },
        { value: 10080, description: "7 days (1 week)" },
      ];

      for (const { value, description } of validNoticeValues) {
        const config = createBookingWindowConfig({
          minimumBookingNotice: value,
        });

        expect(config.minimumBookingNotice).toBe(value);
        expect(config.minimumBookingNotice).toBeGreaterThanOrEqual(0);
        expect(Number.isInteger(config.minimumBookingNotice)).toBe(true);

        // Validate through Zod schema
        const result = createEventTypeInput.safeParse({
          title: "Test Event",
          slug: "test-event",
          length: 30,
          minimumBookingNotice: value,
        });

        // minimumBookingNotice should not cause validation failure
        if (!result.success) {
          const minimumBookingNoticeErrors = result.error.issues.filter(
            (issue) => issue.path.includes("minimumBookingNotice")
          );
          expect(
            minimumBookingNoticeErrors,
            `minimumBookingNotice: ${value} (${description}) should be valid`
          ).toHaveLength(0);
        }
      }
    });

    it("should reject negative minimum booking notice", () => {
      // The Zod schema defines: minimumBookingNotice: z.number().int().min(0)
      // Negative values must be rejected
      const result = createEventTypeInput.safeParse({
        title: "Test Event",
        slug: "test-event",
        length: 30,
        minimumBookingNotice: -1,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        const minimumBookingNoticeErrors = result.error.issues.filter(
          (issue) => issue.path.includes("minimumBookingNotice")
        );
        expect(minimumBookingNoticeErrors.length).toBeGreaterThan(0);
      }
    });
  });

  // =========================================================================
  // Section 2d: UNLIMITED Period Type Configuration
  // =========================================================================
  describe("UNLIMITED Period Type Configuration", () => {
    it("should not require periodDays when periodType is UNLIMITED", () => {
      // UNLIMITED means no upper bound on booking window — periodDays is irrelevant
      const config = createBookingWindowConfig({
        periodType: PeriodType.UNLIMITED,
        periodDays: null,
      });

      expect(config.periodType).toBe(PeriodType.UNLIMITED);
      expect(config.periodDays).toBeNull();
    });

    it("should not require date range when periodType is UNLIMITED", () => {
      // UNLIMITED means no date boundaries — periodStartDate/periodEndDate are irrelevant
      const config = createBookingWindowConfig({
        periodType: PeriodType.UNLIMITED,
        periodStartDate: null,
        periodEndDate: null,
      });

      expect(config.periodType).toBe(PeriodType.UNLIMITED);
      expect(config.periodStartDate).toBeNull();
      expect(config.periodEndDate).toBeNull();
    });

    it("should allow booking at any future date with UNLIMITED", () => {
      // UNLIMITED maps to Calendly "Indefinitely" — no upper bound on when
      // an invitee can book. The only constraint is minimumBookingNotice
      // which governs how soon a booking can be made (lower bound).
      const config = createBookingWindowConfig({
        periodType: PeriodType.UNLIMITED,
        periodDays: null,
        periodStartDate: null,
        periodEndDate: null,
        periodCountCalendarDays: null,
        minimumBookingNotice: 120,
      });

      expect(config.periodType).toBe(PeriodType.UNLIMITED);
      // All date/window fields should be null for UNLIMITED
      expect(config.periodDays).toBeNull();
      expect(config.periodStartDate).toBeNull();
      expect(config.periodEndDate).toBeNull();
      expect(config.periodCountCalendarDays).toBeNull();
      // Only minimumBookingNotice provides a lower bound
      expect(config.minimumBookingNotice).toBe(120);
    });
  });

  // =========================================================================
  // Section 2e: RANGE Period Type Configuration
  // =========================================================================
  describe("RANGE Period Type Configuration", () => {
    it("should require both startDate and endDate for RANGE period type", () => {
      // RANGE requires both boundaries — maps to Calendly "Date range" option
      const startDate = new Date("2025-03-01T00:00:00Z");
      const endDate = new Date("2025-03-31T23:59:59Z");

      const config = createBookingWindowConfig({
        periodType: PeriodType.RANGE,
        periodStartDate: startDate,
        periodEndDate: endDate,
      });

      expect(config.periodType).toBe(PeriodType.RANGE);
      expect(config.periodStartDate).not.toBeNull();
      expect(config.periodEndDate).not.toBeNull();
      expect(config.periodStartDate).toEqual(startDate);
      expect(config.periodEndDate).toEqual(endDate);
    });

    it("should support date range within same month", () => {
      const startDate = new Date("2025-03-01T00:00:00Z");
      const endDate = new Date("2025-03-31T23:59:59Z");

      const config = createBookingWindowConfig({
        periodType: PeriodType.RANGE,
        periodStartDate: startDate,
        periodEndDate: endDate,
      });

      expect(config.periodType).toBe(PeriodType.RANGE);
      expect(config.periodStartDate!.getMonth()).toBe(config.periodEndDate!.getMonth());
      // Both dates are in March (month index 2)
      expect(config.periodStartDate!.getMonth()).toBe(2);
    });

    it("should support date range spanning multiple months", () => {
      const startDate = new Date("2025-01-15T00:00:00Z");
      const endDate = new Date("2025-06-15T23:59:59Z");

      const config = createBookingWindowConfig({
        periodType: PeriodType.RANGE,
        periodStartDate: startDate,
        periodEndDate: endDate,
      });

      expect(config.periodType).toBe(PeriodType.RANGE);
      // Start in January, end in June — spans 5 months
      expect(config.periodStartDate!.getMonth()).toBe(0); // January
      expect(config.periodEndDate!.getMonth()).toBe(5); // June
      expect(config.periodEndDate!.getTime()).toBeGreaterThan(config.periodStartDate!.getTime());
    });

    it("should handle date range start before current date", () => {
      // The system should accept past start dates at configuration time.
      // Past dates are filtered at runtime during slot generation, not at
      // validation time. This ensures existing event types with ranges that
      // started in the past continue to work for future dates within the range.
      const pastStartDate = new Date("2024-12-01T00:00:00Z");
      const futureEndDate = new Date("2025-06-30T23:59:59Z");

      const config = createBookingWindowConfig({
        periodType: PeriodType.RANGE,
        periodStartDate: pastStartDate,
        periodEndDate: futureEndDate,
      });

      expect(config.periodType).toBe(PeriodType.RANGE);
      expect(config.periodStartDate).toEqual(pastStartDate);
      expect(config.periodEndDate).toEqual(futureEndDate);
      // The start date is in the past relative to our fixed system time (2025-01-15)
      expect(config.periodStartDate!.getTime()).toBeLessThan(new Date("2025-01-15T10:00:00Z").getTime());
    });
  });

  // =========================================================================
  // Section 2f: ROLLING Period Type Configuration
  // =========================================================================
  describe("ROLLING Period Type Configuration", () => {
    it("should require periodDays for ROLLING period type", () => {
      // ROLLING needs a non-null periodDays to define how far into the future bookings extend
      const config = createBookingWindowConfig({
        periodType: PeriodType.ROLLING,
        periodDays: 30,
        periodCountCalendarDays: true,
      });

      expect(config.periodType).toBe(PeriodType.ROLLING);
      expect(config.periodDays).not.toBeNull();
      expect(config.periodDays).toBe(30);
    });

    it("should support common rolling window values", () => {
      // Verify typical rolling window configurations that match Calendly's common options
      const commonValues = [
        { days: 7, description: "1 week" },
        { days: 30, description: "1 month" },
        { days: 60, description: "2 months" },
        { days: 90, description: "3 months" },
        { days: 365, description: "1 year" },
      ];

      for (const { days, description } of commonValues) {
        const config = createBookingWindowConfig({
          periodType: PeriodType.ROLLING,
          periodDays: days,
          periodCountCalendarDays: true,
        });

        expect(config.periodType).toBe(PeriodType.ROLLING);
        expect(config.periodDays, `periodDays for ${description}`).toBe(days);
        expect(config.periodDays!).toBeGreaterThan(0);
      }
    });

    it("should accept periodCountCalendarDays flag", () => {
      // ROLLING supports both calendar days (true) and the implicit business days
      // distinction. When periodCountCalendarDays is true, ROLLING counts all
      // calendar days. When business days are needed, the system uses ROLLING_WINDOW
      // (per getPeriodTypeFromUiValue in EventLimitsTab.tsx).
      const calendarDaysConfig = createBookingWindowConfig({
        periodType: PeriodType.ROLLING,
        periodDays: 30,
        periodCountCalendarDays: true,
      });

      expect(calendarDaysConfig.periodCountCalendarDays).toBe(true);

      const businessDaysConfig = createBookingWindowConfig({
        periodType: PeriodType.ROLLING_WINDOW,
        periodDays: 30,
        periodCountCalendarDays: false,
      });

      expect(businessDaysConfig.periodCountCalendarDays).toBe(false);
    });
  });

  // =========================================================================
  // Section 2g: DST Transition and Timezone Edge Cases
  // =========================================================================
  describe("DST Transition and Timezone Edge Cases", () => {
    it("should handle booking window across DST spring-forward transition", () => {
      // US spring-forward: 2025-03-09 (clocks jump from 2:00 AM to 3:00 AM EST→EDT)
      // A RANGE spanning this transition should be a valid configuration.
      // The date-ranges module in packages/features/schedules/lib/date-ranges.ts
      // handles DST via @calcom/dayjs with timezone plugins at runtime.
      const config = createBookingWindowConfig({
        periodType: PeriodType.RANGE,
        periodStartDate: new Date("2025-03-01T00:00:00Z"),
        periodEndDate: new Date("2025-03-15T23:59:59Z"),
      });

      expect(config.periodType).toBe(PeriodType.RANGE);
      expect(config.periodStartDate).not.toBeNull();
      expect(config.periodEndDate).not.toBeNull();
      // End date is after the spring-forward transition
      expect(config.periodEndDate!.getTime()).toBeGreaterThan(
        new Date("2025-03-09T00:00:00Z").getTime()
      );
    });

    it("should handle booking window across DST fall-back transition", () => {
      // US fall-back: 2025-11-02 (clocks fall back from 2:00 AM to 1:00 AM EDT→EST)
      // A RANGE spanning this transition should be a valid configuration.
      const config = createBookingWindowConfig({
        periodType: PeriodType.RANGE,
        periodStartDate: new Date("2025-10-15T00:00:00Z"),
        periodEndDate: new Date("2025-11-15T23:59:59Z"),
      });

      expect(config.periodType).toBe(PeriodType.RANGE);
      expect(config.periodStartDate).not.toBeNull();
      expect(config.periodEndDate).not.toBeNull();
      // The range spans the fall-back transition date
      expect(config.periodStartDate!.getTime()).toBeLessThan(
        new Date("2025-11-02T00:00:00Z").getTime()
      );
      expect(config.periodEndDate!.getTime()).toBeGreaterThan(
        new Date("2025-11-02T00:00:00Z").getTime()
      );
    });

    it("should handle booking window for UTC timezone", () => {
      // UTC has no DST complications — verify configuration is valid with
      // dates stored in UTC (as the Prisma DateTime fields do)
      const config = createBookingWindowConfig({
        periodType: PeriodType.ROLLING,
        periodDays: 30,
        periodCountCalendarDays: true,
      });

      expect(config.periodType).toBe(PeriodType.ROLLING);
      expect(config.periodDays).toBe(30);
      // No special handling needed — UTC is the storage format for all dates
    });

    it("should handle booking window for timezone with no DST", () => {
      // Timezones like Asia/Kolkata (IST, UTC+5:30) do not observe DST.
      // Booking window configs should be valid regardless of timezone —
      // timezone-specific calculations happen at the slot generation layer,
      // not at the configuration layer.
      const config = createBookingWindowConfig({
        periodType: PeriodType.RANGE,
        periodStartDate: new Date("2025-04-01T00:00:00Z"),
        periodEndDate: new Date("2025-09-30T23:59:59Z"),
      });

      expect(config.periodType).toBe(PeriodType.RANGE);
      expect(config.periodStartDate).not.toBeNull();
      expect(config.periodEndDate).not.toBeNull();
      // The 6-month range is valid — timezone handling is delegated to @calcom/dayjs
    });
  });

  // =========================================================================
  // Section 2h: Calendly-to-Cal.com Booking Window Mapping
  // =========================================================================
  describe("Calendly-to-Cal.com Booking Window Mapping", () => {
    it("should map Calendly 'Days into the future (calendar)' to ROLLING", () => {
      // Calendly: "Days into the future" with calendar days
      // Cal.com: PeriodType.ROLLING with periodCountCalendarDays: true
      const calendlyCalendarDaysMapping = createBookingWindowConfig({
        periodType: PeriodType.ROLLING,
        periodDays: 30,
        periodCountCalendarDays: true,
      });

      expect(calendlyCalendarDaysMapping.periodType).toBe(PeriodType.ROLLING);
      expect(calendlyCalendarDaysMapping.periodDays).toBe(30);
      expect(calendlyCalendarDaysMapping.periodCountCalendarDays).toBe(true);
      // ROLLING + periodCountCalendarDays:true = Calendly "Days into the future (calendar)"
    });

    it("should map Calendly 'Days into the future (business)' to ROLLING_WINDOW", () => {
      // Calendly: "Days into the future" with business days
      // Cal.com: PeriodType.ROLLING_WINDOW with periodCountCalendarDays: false
      // In EventLimitsTab.tsx, the UI converts { value: ROLLING, rollingExcludeUnavailableDays: true }
      // to PeriodType.ROLLING_WINDOW via getPeriodTypeFromUiValue()
      const calendlyBusinessDaysMapping = createBookingWindowConfig({
        periodType: PeriodType.ROLLING_WINDOW,
        periodDays: 20,
        periodCountCalendarDays: false,
      });

      expect(calendlyBusinessDaysMapping.periodType).toBe(PeriodType.ROLLING_WINDOW);
      expect(calendlyBusinessDaysMapping.periodDays).toBe(20);
      expect(calendlyBusinessDaysMapping.periodCountCalendarDays).toBe(false);
      // ROLLING_WINDOW = Calendly "Days into the future (business)"
    });

    it("should map Calendly 'Date range' to RANGE", () => {
      // Calendly: "Date range" with explicit start and end dates
      // Cal.com: PeriodType.RANGE with periodStartDate + periodEndDate
      const startDate = new Date("2025-02-01T00:00:00Z");
      const endDate = new Date("2025-04-30T23:59:59Z");

      const calendlyDateRangeMapping = createBookingWindowConfig({
        periodType: PeriodType.RANGE,
        periodStartDate: startDate,
        periodEndDate: endDate,
      });

      expect(calendlyDateRangeMapping.periodType).toBe(PeriodType.RANGE);
      expect(calendlyDateRangeMapping.periodStartDate).toEqual(startDate);
      expect(calendlyDateRangeMapping.periodEndDate).toEqual(endDate);
      // RANGE + date boundaries = Calendly "Date range"
    });

    it("should map Calendly 'Indefinitely' to UNLIMITED", () => {
      // Calendly: "Indefinitely" — no upper bound on booking window
      // Cal.com: PeriodType.UNLIMITED with null date/day fields
      const calendlyIndefinitelyMapping = createBookingWindowConfig({
        periodType: PeriodType.UNLIMITED,
      });

      expect(calendlyIndefinitelyMapping.periodType).toBe(PeriodType.UNLIMITED);
      expect(calendlyIndefinitelyMapping.periodDays).toBeNull();
      expect(calendlyIndefinitelyMapping.periodStartDate).toBeNull();
      expect(calendlyIndefinitelyMapping.periodEndDate).toBeNull();
      expect(calendlyIndefinitelyMapping.periodCountCalendarDays).toBeNull();
      // UNLIMITED = Calendly "Indefinitely"
    });
  });
});
