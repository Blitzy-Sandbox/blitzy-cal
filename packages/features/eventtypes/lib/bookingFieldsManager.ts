import type { z } from "zod";

import { getBookingFieldsWithSystemFields } from "@calcom/features/bookings/lib/getBookingFields";
import { workflowSelect } from "@calcom/features/ee/workflows/lib/getAllWorkflows";
import { prisma } from "@calcom/prisma";
import type { EventType } from "@calcom/prisma/client";
import type { eventTypeBookingFields } from "@calcom/prisma/zod-utils";

/**
 * Represents a single booking field entry within the `bookingFields` JSON array on an EventType.
 *
 * The `type` property is constrained by `fieldTypeEnum` from `@calcom/prisma/zod-utils` and
 * supports the following values:
 *
 * | Cal.com type   | Calendly equivalent | Notes                                      |
 * |----------------|---------------------|--------------------------------------------|
 * | `text`         | text                | Single-line free text                      |
 * | `radio`        | radio               | Single-choice from predefined options      |
 * | `checkbox`     | checkbox            | Multiple-choice checkboxes                 |
 * | `phone`        | phone               | Phone number with international support    |
 * | `select`       | dropdown            | Single-select dropdown menu                |
 * | `textarea`     | —                   | Cal.com extra: multi-line text             |
 * | `number`       | —                   | Cal.com extra: numeric input               |
 * | `email`        | —                   | Cal.com extra: email address               |
 * | `address`      | —                   | Cal.com extra: physical address            |
 * | `multiemail`   | —                   | Cal.com extra: multiple email addresses    |
 * | `multiselect`  | —                   | Cal.com extra: multi-select dropdown       |
 * | `radioInput`   | —                   | Cal.com extra: radio with conditional input|
 * | `boolean`      | —                   | Cal.com extra: yes/no toggle               |
 * | `url`          | —                   | Cal.com extra: URL input                   |
 * | `name`         | —                   | Cal.com extra: structured name field       |
 *
 * All five Calendly question types (text, radio, checkbox, phone, dropdown) are fully
 * supported. Cal.com exceeds Calendly with 10 additional field types.
 *
 * @see fieldTypeEnum in `@calcom/prisma/zod-utils` for the authoritative type enum
 * @see {@link CALENDLY_FIELD_TYPE_MAP} for the programmatic Calendly-to-Cal.com mapping
 */
type Field = z.infer<typeof eventTypeBookingFields>[number];

/**
 * Maps Calendly custom question types to their Cal.com `fieldTypeEnum` equivalents.
 *
 * This mapping documents the ET-006 (Custom Fields Parity) verification:
 * all five Calendly question types are natively supported by Cal.com's
 * `fieldTypeEnum` without any schema or code changes.
 *
 * @example
 * ```ts
 * // Calendly "dropdown" maps to Cal.com "select"
 * const calcomType = CALENDLY_FIELD_TYPE_MAP["dropdown"]; // "select"
 * ```
 */
export const CALENDLY_FIELD_TYPE_MAP = {
  /** Calendly single-line text → Cal.com `text` */
  text: "text",
  /** Calendly radio buttons → Cal.com `radio` */
  radio: "radio",
  /** Calendly checkboxes → Cal.com `checkbox` */
  checkbox: "checkbox",
  /** Calendly phone number → Cal.com `phone` */
  phone: "phone",
  /** Calendly dropdown (single-select) → Cal.com `select` */
  dropdown: "select",
} as const;

/**
 * Cal.com field types that have no Calendly equivalent, representing areas where
 * Cal.com exceeds Calendly's custom question capabilities.
 */
export const CALCOM_EXTRA_FIELD_TYPES = [
  "textarea",
  "number",
  "email",
  "address",
  "multiemail",
  "multiselect",
  "radioInput",
  "boolean",
  "url",
  "name",
] as const;

/**
 * Fetches an event type by ID and enriches its `bookingFields` with system fields.
 *
 * This internal helper loads the event type record from the database including its
 * `customInputs`, organization profile, and associated workflows. It then passes
 * the raw data through {@link getBookingFieldsWithSystemFields} to produce the
 * complete booking fields array — merging user-defined custom fields, system fields
 * (name, email, guests, location, notes, title, reschedule reason), and any
 * workflow-injected fields (e.g., SMS reminder number).
 *
 * The enrichment works identically across all six scheduling paradigms (one-on-one,
 * group/seated, round-robin, collective, managed, dynamic).
 *
 * @param eventTypeId - The database ID of the event type to fetch
 * @returns The event type with an enriched `bookingFields` array
 * @throws {Error} If no event type exists with the given ID
 * @internal Not exported — used only by {@link upsertBookingField} and {@link removeBookingField}
 */
async function getEventType(eventTypeId: EventType["id"]) {
  const rawEventType = await prisma.eventType.findUnique({
    where: {
      id: eventTypeId,
    },
    include: {
      customInputs: true,
      profile: {
        select: {
          organizationId: true,
        },
      },
      workflows: {
        select: {
          workflow: {
            select: workflowSelect,
          },
        },
      },
    },
  });

  if (!rawEventType) {
    throw new Error(`EventType:${eventTypeId} not found`);
  }

  const { profile, ...restEventType } = rawEventType;

  const isOrgTeamEvent = !!rawEventType?.teamId && !!profile?.organizationId;

  const eventType = {
    ...restEventType,
    bookingFields: getBookingFieldsWithSystemFields({ ...restEventType, isOrgTeamEvent }),
  };
  return eventType;
}

/**
 * Upserts a booking field into an event type's `bookingFields` JSON array.
 *
 * This function supports **all** Cal.com field types (including every Calendly-equivalent
 * question type: text, radio, checkbox, phone, and select/dropdown). The logic is
 * type-agnostic — it operates on the {@link Field} shape without branching on `type`,
 * so any field type valid under `fieldTypeEnum` is handled correctly.
 *
 * **Source tracking:** Each booking field can be contributed by multiple sources
 * (e.g., `"user"`, `"system"`, `"workflow"`). When upserting:
 * - If the field already exists (matched by `name`), the source is added or updated
 *   within the field's `sources` array.
 * - If the field does not exist, it is appended with the given source.
 *
 * **Required aggregation:** The field's `required` flag is recalculated as the logical
 * OR of all sources' `fieldRequired` values. If *any* source marks the field as required,
 * the field itself becomes required. This ensures that removing one non-requiring source
 * does not accidentally make a field optional when another source still needs it.
 *
 * @param fieldToAdd - The field definition to upsert (all properties except `required`,
 *   which is computed from sources). Must include `name` and `type` at minimum.
 *   Supports all Calendly question types: text, radio, checkbox, phone, select (dropdown).
 * @param source - The source contributing this field, containing an `id`, `type` label,
 *   human-readable `label`, and `fieldRequired` flag.
 * @param eventTypeId - The database ID of the target event type.
 *
 * @example
 * ```ts
 * // Add a phone field contributed by a workflow source
 * await upsertBookingField(
 *   { name: "smsReminderNumber", type: "phone", label: "SMS Number" },
 *   { id: "42", type: "workflow", label: "SMS Reminder", fieldRequired: true },
 *   eventTypeId
 * );
 * ```
 */
export async function upsertBookingField(
  fieldToAdd: Omit<Field, "required">,
  source: NonNullable<Field["sources"]>[number],
  eventTypeId: EventType["id"]
) {
  const eventType = await getEventType(eventTypeId);
  let fieldFound = false;

  const newFields = eventType.bookingFields.map((f) => {
    if (f.name === fieldToAdd.name) {
      fieldFound = true;

      const currentSources = f.sources ? f.sources : ([] as NonNullable<typeof f.sources>[]);
      let sourceFound = false;
      let newSources = currentSources.map((s) => {
        if (s.id !== source.id) {
          // If the source is not found, nothing to update
          return s;
        }
        sourceFound = true;

        return {
          ...s,
          ...source,
        };
      });

      if (!sourceFound) {
        newSources = [...newSources, source];
      }
      const newField = {
        ...f,
        // If any source requires the field, mark the field required
        required: newSources.some((s) => s.fieldRequired),
        sources: newSources,
      };
      return newField;
    }
    return f;
  });
  if (!fieldFound) {
    newFields.push({
      ...fieldToAdd,
      required: source.fieldRequired,
      sources: [source],
    });
  }
  await prisma.eventType.update({
    where: {
      id: eventTypeId,
    },
    data: {
      bookingFields: newFields,
    },
  });
}

/**
 * Removes a source's contribution from a booking field on an event type.
 *
 * This function supports **all** Cal.com field types (including every Calendly-equivalent
 * question type: text, radio, checkbox, phone, and select/dropdown). The logic is
 * type-agnostic — it filters on field `name` and source `id` without branching on `type`.
 *
 * **Source removal behavior:**
 * - The specified source is removed from the field's `sources` array.
 * - If other sources remain, the field is preserved and its `required` flag is
 *   recalculated as the logical OR of the remaining sources' `fieldRequired` values.
 * - If no sources remain after removal, the field is **deleted entirely** from the
 *   `bookingFields` array (filtered out via null return).
 * - If the source was not present on the field, the field is returned unchanged.
 *
 * **Cleanup guarantee:** Fields with zero sources are never persisted — they are
 * removed in the same database transaction that removes the last source.
 *
 * @param fieldToRemove - Object with the `name` of the field to target.
 * @param source - Object with `id` and `type` identifying the source to remove.
 * @param eventTypeId - The database ID of the target event type.
 *
 * @example
 * ```ts
 * // Remove a workflow's contribution to the SMS reminder field
 * await removeBookingField(
 *   { name: "smsReminderNumber" },
 *   { id: "42", type: "workflow" },
 *   eventTypeId
 * );
 * ```
 */
export async function removeBookingField(
  fieldToRemove: Pick<Field, "name">,
  source: Pick<NonNullable<Field["sources"]>[number], "id" | "type">,
  eventTypeId: EventType["id"]
) {
  const eventType = await getEventType(eventTypeId);

  const newFields = eventType.bookingFields
    .map((f) => {
      if (f.name === fieldToRemove.name) {
        const currentSources = f.sources ? f.sources : ([] as NonNullable<typeof f.sources>[]);
        if (!currentSources.find((s) => s.id === source.id)) {
          // No need to remove the source - It doesn't exist already
          return f;
        }
        const newSources = currentSources.filter((s) => s.id !== source.id);
        const newField = {
          ...f,
          required: newSources.some((s) => s.fieldRequired),
          sources: newSources,
        };
        if (newField.sources.length === 0) {
          return null;
        }
        return newField;
      }
      return f;
    })
    .filter((f): f is Field => !!f);

  await prisma.eventType.update({
    where: {
      id: eventTypeId,
    },
    data: {
      bookingFields: newFields,
    },
  });
}
