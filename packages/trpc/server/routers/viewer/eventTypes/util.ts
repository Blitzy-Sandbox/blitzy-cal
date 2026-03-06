import { z } from "zod";

import type { EventTypeRepository } from "@calcom/features/eventtypes/repositories/eventTypeRepository";
import type { PermissionString } from "@calcom/features/pbac/domain/types/permission-registry";
import { PermissionCheckService } from "@calcom/features/pbac/services/permission-check.service";
import { UserRepository } from "@calcom/features/users/repositories/UserRepository";
import { markdownToSafeHTML } from "@calcom/lib/markdownToSafeHTML";
import prisma from "@calcom/prisma";
import type { MembershipRole } from "@calcom/prisma/enums";
import { PeriodType } from "@calcom/prisma/enums";
import type { CustomInputSchema } from "@calcom/prisma/zod-utils";
import { EventTypeMetaDataSchema } from "@calcom/prisma/zod-utils";

import { TRPCError } from "@trpc/server";

import authedProcedure from "../../../procedures/authedProcedure";
import type { TUpdateInputSchema } from "./types";

type EventType = Awaited<ReturnType<EventTypeRepository["findAllByUpId"]>>[number];

export const eventOwnerProcedure = authedProcedure
  .input(
    z
      .object({
        id: z.number().optional(),
        eventTypeId: z.number().optional(),
        users: z.array(z.number()).optional().default([]),
      })
      .refine((data) => data.id !== undefined || data.eventTypeId !== undefined, {
        message: "At least one of 'id' or 'eventTypeId' must be present",
        path: ["id", "eventTypeId"],
      })
  )
  .use(async ({ ctx, input, next }) => {
    const id = input.eventTypeId ?? input.id;
    // Prevent non-owners to update/delete a team event
    const event = await ctx.prisma.eventType.findUnique({
      where: { id },
      include: {
        users: {
          select: {
            id: true,
          },
        },
        team: {
          select: {
            members: {
              select: {
                userId: true,
                role: true,
              },
            },
          },
        },
      },
    });

    if (!event) {
      throw new TRPCError({ code: "NOT_FOUND" });
    }

    const isAuthorized = (function () {
      if (event.team) {
        const teamMember = event.team.members.find((member) => member.userId === ctx.user.id);
        const isOwnerOrAdmin = teamMember?.role === "ADMIN" || teamMember?.role === "OWNER";

        return isOwnerOrAdmin;
      }
      return event.userId === ctx.user.id || event.users.find((user) => user.id === ctx.user.id);
    })();

    if (!isAuthorized) {
      throw new TRPCError({ code: "FORBIDDEN" });
    }

    const isAllowed = (function () {
      if (event.team) {
        const allTeamMembers = event.team.members.map((member) => member.userId);
        return input.users.every((userId: number) => allTeamMembers.includes(userId));
      }
      return input.users.every((userId: number) => userId === ctx.user.id);
    })();

    if (!isAllowed) {
      console.warn(
        `User ${ctx.user.id} attempted to an create an event for users ${input.users.join(", ")}.`
      );
      throw new TRPCError({ code: "FORBIDDEN" });
    }

    return next();
  });

/**
 * Creates an event admin procedure with configurable permissions
 * @param permission - The specific permission required (e.g., "eventType.manage", "eventType.update")
 * @param fallbackRoles - Roles to check when PBAC is disabled (defaults to ["ADMIN", "OWNER"])
 * @returns A procedure that checks the specified permission
 */
export const createEventPbacProcedure = (
  permission: PermissionString,
  fallbackRoles: MembershipRole[] = ["ADMIN", "OWNER"]
) => {
  return authedProcedure
    .input(
      z
        .object({
          id: z.number().optional(),
          eventTypeId: z.number().optional(),
          users: z.array(z.number()).optional(),
        })
        .refine((data) => data.id !== undefined || data.eventTypeId !== undefined, {
          message: "At least one of 'id' or 'eventTypeId' must be present",
          path: ["id", "eventTypeId"],
        })
    )
    .use(async ({ ctx, input, next }) => {
      const id = input.eventTypeId ?? input.id;

      const event = await ctx.prisma.eventType.findUnique({
        where: { id },
        select: {
          id: true,
          userId: true,
          teamId: true,
          users: {
            select: {
              id: true,
            },
          },
          team: {
            select: {
              members: {
                select: {
                  userId: true,
                },
              },
            },
          },
        },
      });

      if (!event) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      // Check if user has permission to access/modify this event
      if (!event.teamId) {
        // Personal event - must be owner or assigned user
        if (event.userId !== ctx.user.id && !event.users.find((user) => user.id === ctx.user.id)) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: `Permission required: ${permission}`,
          });
        }
      } else {
        // Team event - check PBAC/fallback permissions
        const permissionCheckService = new PermissionCheckService();
        const hasPermission = await permissionCheckService.checkPermission({
          userId: ctx.user.id,
          teamId: event.teamId,
          permission,
          fallbackRoles,
        });

        if (!hasPermission) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: `Permission required: ${permission}`,
          });
        }
      }

      // Validate that assigned users are allowed
      if (input.users && input.users.length > 0) {
        const isAllowed = (function () {
          if (event.team) {
            const allTeamMembers = event.team.members.map((member) => member.userId);
            return input.users?.every((userId: number) => allTeamMembers.includes(userId)) ?? true;
          }
          return input.users?.every((userId: number) => userId === ctx.user.id) ?? true;
        })();

        if (!isAllowed) {
          console.warn(
            `User ${ctx.user.id} attempted to assign event ${event.id} to users ${input.users.join(", ")}.`
          );
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Cannot assign event to users outside of team membership",
          });
        }
      }

      return next();
    });
};

export function isPeriodType(keyInput: string): keyInput is PeriodType {
  return Object.keys(PeriodType).includes(keyInput);
}

/**
 * Maps a string period type to the {@link PeriodType} enum for booking window configuration.
 *
 * **ET-005 — Booking Window Configuration Alignment:**
 * This function translates user-provided period type strings into the Prisma `PeriodType` enum,
 * enabling event types to enforce date-range restrictions on bookable slots.
 *
 * **Calendly Booking Window Mapping:**
 * - `UNLIMITED` → Calendly "indefinitely" — no booking window restriction; invitees can book
 *   any available slot with no advance time limit.
 * - `ROLLING` → Calendly "days into future" (calendar days) — a rolling window of N calendar
 *   days from today. Slots beyond this window are not bookable.
 * - `ROLLING_WINDOW` → Calendly "days into future" (business days) — a rolling window of N
 *   business days, skipping weekends and holidays. Addresses AVL-GAP-001 parity for
 *   business-day-based booking windows.
 * - `RANGE` → Calendly "date range" — an explicit start/end date restriction. Only slots
 *   within the configured date range are bookable.
 *
 * **Implementation Detail:** Performs case-insensitive matching via `toUpperCase()` and validates
 * against the `PeriodType` enum keys. Returns `undefined` for invalid or missing input, allowing
 * callers to fall back to the event type's existing period configuration.
 *
 * @param periodType - The string representation of the period type (case-insensitive)
 * @returns The corresponding {@link PeriodType} enum value, or `undefined` if invalid/missing
 *
 * @see {@link isPeriodType} for the underlying type guard
 * @see EventLimitsTab for the UI component that presents these booking window options
 */
export function handlePeriodType(periodType: string | undefined): PeriodType | undefined {
  if (typeof periodType !== "string") return undefined;
  const passedPeriodType = periodType.toUpperCase();
  if (!isPeriodType(passedPeriodType)) return undefined;
  return PeriodType[passedPeriodType];
}

/**
 * Handles CRUD operations for legacy custom inputs on an event type.
 *
 * **ET-006 — Custom Fields/Questions Parity:**
 * This function manages the lifecycle of custom inputs (the legacy custom input system,
 * predecessor to the newer `bookingFields` system). It processes an array of custom input
 * definitions and generates the Prisma nested write operations for batch create, update,
 * and delete in a single transaction.
 *
 * **Calendly Question Type Support:**
 * Custom inputs support all Calendly question types through the `EventTypeCustomInputType` enum:
 * - `TEXT` → Calendly single-line text question
 * - `TEXTLONG` → Calendly multi-line text (textarea equivalent)
 * - `NUMBER` → Numeric input field
 * - `BOOL` → Calendly checkbox question (boolean toggle)
 * - `RADIO` → Calendly radio button question (single-select from options)
 * - `PHONE` → Calendly phone number question
 *
 * **Operation Logic:**
 * - Inputs with `hasToBeCreated: true` → batched via `createMany` (new custom inputs)
 * - Inputs with `hasToBeCreated: false` → individual `update` operations (existing inputs)
 * - Inputs not present in the provided array → removed via `deleteMany` (stale inputs purged)
 *
 * **Data Shape:** Each custom input contains `type`, `label`, `required`, `placeholder`, and
 * `options` (for RADIO type providing the selectable choices).
 *
 * @param customInputs - Array of custom input schemas with CRUD flags
 * @param eventTypeId - The event type ID for scoping delete operations
 * @returns Prisma nested write object with `deleteMany`, `createMany`, and `update` operations
 */
export function handleCustomInputs(customInputs: CustomInputSchema[], eventTypeId: number) {
  const cInputsIdsToDeleteOrUpdated = customInputs.filter((input) => !input.hasToBeCreated);
  const cInputsIdsToDelete = cInputsIdsToDeleteOrUpdated.map((e) => e.id);
  const cInputsToCreate = customInputs
    .filter((input) => input.hasToBeCreated)
    .map((input) => ({
      type: input.type,
      label: input.label,
      required: input.required,
      placeholder: input.placeholder,
      options: input.options || undefined,
    }));
  const cInputsToUpdate = cInputsIdsToDeleteOrUpdated.map((input) => ({
    data: {
      type: input.type,
      label: input.label,
      required: input.required,
      placeholder: input.placeholder,
      options: input.options || undefined,
    },
    where: {
      id: input.id,
    },
  }));

  return {
    deleteMany: {
      eventTypeId,
      NOT: {
        id: { in: cInputsIdsToDelete },
      },
    },
    createMany: {
      data: cInputsToCreate,
    },
    update: cInputsToUpdate,
  };
}

/**
 * Validates that no duplicate booking field names exist in the bookingFields array.
 *
 * **ET-006 — Custom Fields Validation:**
 * This function enforces uniqueness of booking field names to prevent data collisions
 * when capturing invitee responses during the booking flow.
 *
 * **Type-Agnostic Validation:** This check works for ALL booking field types including:
 * text, radio, checkbox, phone, select (dropdown), textarea, number, email, address,
 * multiemail, multiselect, radioInput, boolean, url, and name. The validation operates
 * solely on the `name` property, making it inherently compatible with any current or
 * future field type additions.
 *
 * **Calendly Parity:** All Calendly question types (text, radio, checkbox, phone, dropdown)
 * are correctly validated since this function is type-agnostic — it only inspects field names,
 * not field types.
 *
 * @param fields - The booking fields array from the event type update input
 * @throws {TRPCError} BAD_REQUEST with message identifying the duplicate field name
 *
 * @example
 * // Throws TRPCError with "Duplicate booking field name: company"
 * ensureUniqueBookingFields([
 *   { name: "company", type: "text", ... },
 *   { name: "company", type: "textarea", ... },
 * ]);
 */
export function ensureUniqueBookingFields(fields: TUpdateInputSchema["bookingFields"]) {
  if (!fields) {
    return;
  }

  fields.reduce(
    (discoveredFields, field) => {
      if (discoveredFields[field.name]) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Duplicate booking field name: ${field.name}`,
        });
      }

      discoveredFields[field.name] = true;

      return discoveredFields;
    },
    {} as Record<string, true>
  );
}

/**
 * Validates that at least one contact method (email or phone) is available and required
 * for booking.
 *
 * **ET-006 — Phone Field Support / Custom Fields Parity:**
 * This function enforces Calendly's requirement that invitees must provide contact information
 * when booking. It validates the visibility and required status of both the email and phone
 * (`attendeePhoneNumber`) booking fields.
 *
 * **Validation Rules:**
 * 1. Both email and phone cannot be hidden simultaneously — at least one must be visible
 * 2. At least one of email or phone must be marked as required
 * 3. If email is hidden, phone must be required (phone becomes the sole contact method)
 * 4. If phone is hidden, email must be required (email becomes the sole contact method)
 *
 * **Calendly Parity:** Matches Calendly's behavior where invitees must always provide at
 * least one form of contact information. The phone field type support is part of ET-006
 * custom fields parity, ensuring Cal.com supports the same contact method flexibility.
 *
 * **Error Messages (i18n keys):**
 * - `booking_fields_email_and_phone_both_hidden` — both contact methods hidden
 * - `booking_fields_email_or_phone_required` — neither contact method is required
 * - `booking_fields_phone_required_when_email_hidden` — email hidden but phone not required
 * - `booking_fields_email_required_when_phone_hidden` — phone hidden but email not required
 *
 * @param fields - The booking fields array from the event type update input
 * @throws {TRPCError} BAD_REQUEST with an i18n error key describing the validation failure
 */
export function ensureEmailOrPhoneNumberIsPresent(fields: TUpdateInputSchema["bookingFields"]) {
  if (!fields || fields.length === 0) {
    return;
  }

  const attendeePhoneNumberField = fields.find((field) => field.name === "attendeePhoneNumber");

  const emailField = fields.find((field) => field.name === "email");

  if (emailField?.hidden && attendeePhoneNumberField?.hidden) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "booking_fields_email_and_phone_both_hidden",
    });
  }
  if (!emailField?.required && !attendeePhoneNumberField?.required) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "booking_fields_email_or_phone_required",
    });
  }
  if (emailField?.hidden && !attendeePhoneNumberField?.required) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "booking_fields_phone_required_when_email_hidden",
    });
  }
  if (attendeePhoneNumberField?.hidden && !emailField?.required) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "booking_fields_email_required_when_phone_hidden",
    });
  }
}

export const mapEventType = async (eventType: EventType) => ({
  ...eventType,
  safeDescription: eventType?.description ? markdownToSafeHTML(eventType.description) : undefined,
  users: await Promise.all(
    (eventType?.hosts?.length ? eventType.hosts.map((host) => host.user) : eventType.users).map(async (u) =>
      new UserRepository(prisma).enrichUserWithItsProfile({
        user: u,
      })
    )
  ),
  metadata: eventType.metadata ? EventTypeMetaDataSchema.parse(eventType.metadata) : null,
  children: await Promise.all(
    (eventType.children || []).map(async (c) => ({
      ...c,
      users: await Promise.all(
        c.users.map(
          async (u) =>
            await new UserRepository(prisma).enrichUserWithItsProfile({
              user: u,
            })
        )
      ),
    }))
  ),
});
