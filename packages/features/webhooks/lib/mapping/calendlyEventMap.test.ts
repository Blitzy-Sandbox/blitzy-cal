import { describe, it, expect } from "vitest";
import { WebhookTriggerEvents } from "@calcom/prisma/enums";

import type { CalendlyEventType } from "./calendlyEventMap";
import {
  CALCOM_TO_CALENDLY_MAP,
  CALENDLY_FORM_SUBMITTED_TRIGGERS,
  CALENDLY_INVITEE_CANCELED_TRIGGERS,
  CALENDLY_INVITEE_CREATED_TRIGGERS,
  getCalcomTriggersForCalendlyEvent,
  getCalendlyEquivalent,
} from "./calendlyEventMap";

describe("Calendly Event Map", () => {
  describe("getCalendlyEquivalent", () => {
    it("should map BOOKING_CREATED to invitee.created", () => {
      const result: CalendlyEventType | null = getCalendlyEquivalent(WebhookTriggerEvents.BOOKING_CREATED);
      expect(result).toBe("invitee.created");
    });

    it("should map BOOKING_RESCHEDULED to invitee.created", () => {
      const result: CalendlyEventType | null = getCalendlyEquivalent(
        WebhookTriggerEvents.BOOKING_RESCHEDULED
      );
      expect(result).toBe("invitee.created");
    });

    it("should map BOOKING_RESCHEDULED_BY_ATTENDEE to invitee.created", () => {
      const result: CalendlyEventType | null = getCalendlyEquivalent(
        WebhookTriggerEvents.BOOKING_RESCHEDULED_BY_ATTENDEE
      );
      expect(result).toBe("invitee.created");
    });

    it("should map BOOKING_CANCELLED to invitee.canceled", () => {
      const result: CalendlyEventType | null = getCalendlyEquivalent(
        WebhookTriggerEvents.BOOKING_CANCELLED
      );
      expect(result).toBe("invitee.canceled");
    });

    it("should map FORM_SUBMITTED to routing_form_submission.created", () => {
      const result: CalendlyEventType | null = getCalendlyEquivalent(
        WebhookTriggerEvents.FORM_SUBMITTED
      );
      expect(result).toBe("routing_form_submission.created");
    });

    it("should return null for Cal.com-only events with no Calendly equivalent", () => {
      const calcomOnlyEvents: WebhookTriggerEvents[] = [
        WebhookTriggerEvents.BOOKING_PAYMENT_INITIATED,
        WebhookTriggerEvents.BOOKING_PAID,
        WebhookTriggerEvents.BOOKING_REQUESTED,
        WebhookTriggerEvents.BOOKING_REJECTED,
        WebhookTriggerEvents.BOOKING_NO_SHOW_UPDATED,
        WebhookTriggerEvents.MEETING_ENDED,
        WebhookTriggerEvents.MEETING_STARTED,
        WebhookTriggerEvents.RECORDING_READY,
        WebhookTriggerEvents.INSTANT_MEETING,
        WebhookTriggerEvents.RECORDING_TRANSCRIPTION_GENERATED,
        WebhookTriggerEvents.OOO_CREATED,
        WebhookTriggerEvents.AFTER_HOSTS_CAL_VIDEO_NO_SHOW,
        WebhookTriggerEvents.AFTER_GUESTS_CAL_VIDEO_NO_SHOW,
        WebhookTriggerEvents.FORM_SUBMITTED_NO_EVENT,
        WebhookTriggerEvents.DELEGATION_CREDENTIAL_ERROR,
        WebhookTriggerEvents.WRONG_ASSIGNMENT_REPORT,
      ];

      for (const trigger of calcomOnlyEvents) {
        expect(getCalendlyEquivalent(trigger)).toBeNull();
      }

      // Verify we tested exactly 16 null-mapped events
      expect(calcomOnlyEvents).toHaveLength(16);
    });
  });

  describe("getCalcomTriggersForCalendlyEvent", () => {
    it("should return BOOKING_CREATED, BOOKING_RESCHEDULED, and BOOKING_RESCHEDULED_BY_ATTENDEE for invitee.created", () => {
      const result = getCalcomTriggersForCalendlyEvent("invitee.created");

      expect(result).toHaveLength(3);
      expect(result).toEqual(
        expect.arrayContaining([
          WebhookTriggerEvents.BOOKING_CREATED,
          WebhookTriggerEvents.BOOKING_RESCHEDULED,
          WebhookTriggerEvents.BOOKING_RESCHEDULED_BY_ATTENDEE,
        ])
      );
    });

    it("should return BOOKING_CANCELLED for invitee.canceled", () => {
      const result = getCalcomTriggersForCalendlyEvent("invitee.canceled");

      expect(result).toHaveLength(1);
      expect(result).toEqual(
        expect.arrayContaining([WebhookTriggerEvents.BOOKING_CANCELLED])
      );
    });

    it("should return FORM_SUBMITTED for routing_form_submission.created", () => {
      const result = getCalcomTriggersForCalendlyEvent("routing_form_submission.created");

      expect(result).toHaveLength(1);
      expect(result).toEqual(
        expect.arrayContaining([WebhookTriggerEvents.FORM_SUBMITTED])
      );
    });
  });

  describe("CALCOM_TO_CALENDLY_MAP", () => {
    it("should have an entry for every WebhookTriggerEvents enum value", () => {
      const allTriggerEvents = Object.values(WebhookTriggerEvents);

      for (const trigger of allTriggerEvents) {
        expect(trigger in CALCOM_TO_CALENDLY_MAP).toBe(true);
      }
    });

    it("should have entries matching the WebhookTriggerEvents enum count", () => {
      const mapEntryCount = Object.keys(CALCOM_TO_CALENDLY_MAP).length;
      const enumValueCount = Object.values(WebhookTriggerEvents).length;

      expect(mapEntryCount).toBe(enumValueCount);
    });

    it("should map exactly 5 events to non-null Calendly types", () => {
      const nonNullEntries = Object.values(CALCOM_TO_CALENDLY_MAP).filter(
        (value) => value !== null
      );

      expect(nonNullEntries).toHaveLength(5);
    });

    it("should map exactly 16 events to null", () => {
      const nullEntries = Object.values(CALCOM_TO_CALENDLY_MAP).filter(
        (value) => value === null
      );

      expect(nullEntries).toHaveLength(16);
    });

    it("should only contain valid CalendlyEventType values for non-null entries", () => {
      const validCalendlyEvents: CalendlyEventType[] = [
        "invitee.created",
        "invitee.canceled",
        "routing_form_submission.created",
      ];

      const nonNullValues = Object.values(CALCOM_TO_CALENDLY_MAP).filter(
        (value): value is CalendlyEventType => value !== null
      );

      for (const value of nonNullValues) {
        expect(validCalendlyEvents).toContain(value);
      }
    });

    it("should not contain any keys outside the WebhookTriggerEvents enum", () => {
      const enumValues = new Set(Object.values(WebhookTriggerEvents));
      const mapKeys = Object.keys(CALCOM_TO_CALENDLY_MAP);

      for (const key of mapKeys) {
        expect(enumValues.has(key as WebhookTriggerEvents)).toBe(true);
      }
    });
  });

  describe("Calendly semantic groupings", () => {
    it("should define CALENDLY_INVITEE_CREATED_TRIGGERS with correct trigger events", () => {
      expect(CALENDLY_INVITEE_CREATED_TRIGGERS).toHaveLength(3);
      expect(CALENDLY_INVITEE_CREATED_TRIGGERS).toContain(WebhookTriggerEvents.BOOKING_CREATED);
      expect(CALENDLY_INVITEE_CREATED_TRIGGERS).toContain(WebhookTriggerEvents.BOOKING_RESCHEDULED);
      expect(CALENDLY_INVITEE_CREATED_TRIGGERS).toContain(
        WebhookTriggerEvents.BOOKING_RESCHEDULED_BY_ATTENDEE
      );
    });

    it("should define CALENDLY_INVITEE_CANCELED_TRIGGERS with correct trigger events", () => {
      expect(CALENDLY_INVITEE_CANCELED_TRIGGERS).toHaveLength(1);
      expect(CALENDLY_INVITEE_CANCELED_TRIGGERS).toContain(WebhookTriggerEvents.BOOKING_CANCELLED);
    });

    it("should define CALENDLY_FORM_SUBMITTED_TRIGGERS with correct trigger events", () => {
      expect(CALENDLY_FORM_SUBMITTED_TRIGGERS).toHaveLength(1);
      expect(CALENDLY_FORM_SUBMITTED_TRIGGERS).toContain(WebhookTriggerEvents.FORM_SUBMITTED);
    });

    it("should have grouping constants consistent with CALCOM_TO_CALENDLY_MAP forward mapping", () => {
      // Every trigger in CALENDLY_INVITEE_CREATED_TRIGGERS should map to "invitee.created"
      for (const trigger of CALENDLY_INVITEE_CREATED_TRIGGERS) {
        expect(getCalendlyEquivalent(trigger)).toBe("invitee.created");
      }

      // Every trigger in CALENDLY_INVITEE_CANCELED_TRIGGERS should map to "invitee.canceled"
      for (const trigger of CALENDLY_INVITEE_CANCELED_TRIGGERS) {
        expect(getCalendlyEquivalent(trigger)).toBe("invitee.canceled");
      }

      // Every trigger in CALENDLY_FORM_SUBMITTED_TRIGGERS should map to "routing_form_submission.created"
      for (const trigger of CALENDLY_FORM_SUBMITTED_TRIGGERS) {
        expect(getCalendlyEquivalent(trigger)).toBe("routing_form_submission.created");
      }
    });

    it("should have grouping constants consistent with reverse mapping", () => {
      const inviteeCreatedTriggers = getCalcomTriggersForCalendlyEvent("invitee.created");
      expect(inviteeCreatedTriggers).toEqual(
        expect.arrayContaining([...CALENDLY_INVITEE_CREATED_TRIGGERS])
      );
      expect(inviteeCreatedTriggers).toHaveLength(CALENDLY_INVITEE_CREATED_TRIGGERS.length);

      const inviteeCanceledTriggers = getCalcomTriggersForCalendlyEvent("invitee.canceled");
      expect(inviteeCanceledTriggers).toEqual(
        expect.arrayContaining([...CALENDLY_INVITEE_CANCELED_TRIGGERS])
      );
      expect(inviteeCanceledTriggers).toHaveLength(CALENDLY_INVITEE_CANCELED_TRIGGERS.length);

      const formSubmittedTriggers = getCalcomTriggersForCalendlyEvent("routing_form_submission.created");
      expect(formSubmittedTriggers).toEqual(
        expect.arrayContaining([...CALENDLY_FORM_SUBMITTED_TRIGGERS])
      );
      expect(formSubmittedTriggers).toHaveLength(CALENDLY_FORM_SUBMITTED_TRIGGERS.length);
    });
  });
});
