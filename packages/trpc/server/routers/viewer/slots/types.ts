import type { IncomingMessage } from "node:http";
import { z } from "zod";

import { timeZoneSchema } from "@calcom/lib/dayjs/timeZone.schema";

/**
 * Validates that a string is a parseable ISO date string.
 *
 * Uses native {@link Date.parse} which returns `NaN` for invalid inputs.
 * Used as a Zod refinement callback for the `startTime` and `endTime` fields
 * in {@link getScheduleSchemaObject}.
 */
const isValidDateString = (val: string) => !isNaN(Date.parse(val));

/**
 * Base Zod schema object for the `getSchedule` tRPC procedure input.
 *
 * Defines 21 fields grouped by purpose:
 *
 * **Time window**
 * - `startTime` / `endTime` — ISO date strings validated via {@link isValidDateString}.
 *
 * **Event identification**
 * - `eventTypeId` — Coerced integer, identifies the event type by database ID.
 * - `eventTypeSlug` — String slug, used with `usernameList` for dynamic event lookup.
 *
 * **Timezone**
 * - `timeZone` — IANA-validated via `timeZoneSchema` (Rule 0.7.6: input sanitization).
 *
 * **Dynamic events**
 * - `usernameList` — Array of usernames for dynamic group events (min 1 when present).
 *
 * **Configuration**
 * - `debug` — Enables debug output in the availability pipeline.
 * - `duration` — String-to-number transform for multi-duration event types.
 * - `rescheduleUid` — UID of the booking being rescheduled (excluded from busy times).
 * - `isTeamEvent` — Flag to route through team availability logic (defaults to `false`).
 *
 * **Organization / team**
 * - `orgSlug` — Organization slug for multi-tenant resolution.
 * - `teamMemberEmail` — Direct team member email for routing.
 * - `routedTeamMemberIds` — Pre-routed member IDs from routing forms.
 * - `skipContactOwner` — Bypasses contact-owner assignment logic.
 * - `rrHostSubsetIds` — Restricts round-robin host pool to a subset.
 *
 * **Internal flags** (prefixed with `_`)
 * - `_enableTroubleshooter` — Activates troubleshooter diagnostics.
 * - `_bypassCalendarBusyTimes` — Skips external calendar busy-time fetching.
 * - `_silentCalendarFailures` — Suppresses calendar fetch errors instead of propagating.
 *
 * **Routing**
 * - `routingFormResponseId` — Links the slot request to a routing form submission.
 * - `queuedFormResponseId` — Links to a queued routing form response.
 *
 * **Contact**
 * - `email` — Invitee email for contact-based availability filtering.
 *
 * @remarks This is the raw object schema. {@link getScheduleSchema} adds transforms and
 * refinements on top of this object (usernameList normalization, orgSlug default,
 * event identification requirement, and time ordering enforcement).
 */
export const getScheduleSchemaObject = z.object({
  startTime: z.string().refine(isValidDateString, {
    message: "startTime must be a valid date string",
  }),
  endTime: z.string().refine(isValidDateString, {
    message: "endTime must be a valid date string",
  }),
  // Event type ID
  eventTypeId: z.coerce.number().int().optional(),
  // Event type slug
  eventTypeSlug: z.string().optional(),
  // invitee timezone
  timeZone: timeZoneSchema.optional(),
  // or list of users (for dynamic events)
  usernameList: z.array(z.string()).min(1).optional(),
  debug: z.boolean().optional(),
  // to handle event types with multiple duration options
  duration: z
    .string()
    .optional()
    .transform((val) => val && parseInt(val)),
  rescheduleUid: z.string().nullish(),
  // whether to do team event or user event
  isTeamEvent: z.boolean().optional().default(false),
  orgSlug: z.string().nullish(),
  teamMemberEmail: z.string().nullish(),
  routedTeamMemberIds: z.array(z.number()).nullish(),
  skipContactOwner: z.boolean().nullish(),
  rrHostSubsetIds: z.array(z.number()).nullish(),
  _enableTroubleshooter: z.boolean().optional(),
  _bypassCalendarBusyTimes: z.boolean().optional(),
  _silentCalendarFailures: z.boolean().optional(),
  routingFormResponseId: z.number().optional(),
  queuedFormResponseId: z.string().nullish(),
  email: z.string().nullish(),
});

/**
 * Final validated schema for the `getSchedule` tRPC procedure input.
 *
 * Built on top of {@link getScheduleSchemaObject} with two transforms and two refinements:
 *
 * **Transforms:**
 * 1. `usernameList` — Normalizes to an array (supports single-string query param from public API).
 * 2. `orgSlug` — Defaults to `null` when falsy, ensuring a consistent nullable type downstream.
 *
 * **Refinements:**
 * 1. Event identification — Requires either `eventTypeId` OR the combination of
 *    `usernameList` + `eventTypeSlug` to resolve the target event.
 * 2. Time ordering — Enforces `endTime > startTime` with an error path on `endTime`.
 *
 * Exported as {@link ZGetScheduleInputSchema} for direct use in the tRPC router definition.
 */
export const getScheduleSchema = getScheduleSchemaObject
  .transform((val) => {
    // Need this so we can pass a single username in the query string form public API
    if (val.usernameList) {
      val.usernameList = Array.isArray(val.usernameList) ? val.usernameList : [val.usernameList];
    }
    if (!val.orgSlug) {
      val.orgSlug = null;
    }
    return val;
  })
  .refine(
    (data) => !!data.eventTypeId || (!!data.usernameList && !!data.eventTypeSlug),
    "You need to either pass an eventTypeId OR an usernameList/eventTypeSlug combination"
  )
  .refine(({ startTime, endTime }) => new Date(endTime).getTime() > new Date(startTime).getTime(), {
    message: "endTime must be after startTime",
    path: ["endTime"],
  });

/**
 * Input schema for the `reserveSlot` tRPC mutation.
 *
 * **Fields:**
 * - `eventTypeId` — Required integer identifying the event type for the reservation.
 * - `slotUtcStartDate` — UTC ISO string for the slot start boundary.
 * - `slotUtcEndDate` — UTC ISO string for the slot end boundary.
 * - `_isDryRun` — Optional flag for testing without persisting the reservation.
 *
 * **Refinement:** At least one of `eventTypeId`, `slotUtcStartDate`, or `slotUtcEndDate`
 * must be present to form a valid reservation request.
 *
 * @see SelectedSlots — The Prisma model that stores reserved slot records.
 */
export const reserveSlotSchema = z
  .object({
    eventTypeId: z.number().int(),
    // startTime ISOString
    slotUtcStartDate: z.string(),
    // endTime ISOString
    slotUtcEndDate: z.string(),
    _isDryRun: z.boolean().optional(),
  })
  .refine(
    (data) => !!data.eventTypeId || !!data.slotUtcStartDate || !!data.slotUtcEndDate,
    "Either slotUtcStartDate, slotUtcEndDate or eventTypeId should be filled in."
  );

/**
 * Input schema for the `removeSelectedSlotMark` tRPC mutation.
 *
 * The `uid` field is nullable to support cookie-based fallback resolution
 * in the handler when the client does not provide an explicit UID.
 */
export const removeSelectedSlotSchema = z.object({
  uid: z.string().nullable(),
});

/**
 * Defines the tRPC context shape for schedule availability queries.
 *
 * Extends `Record<string, unknown>` to allow additional middleware-injected properties.
 * The optional `req` property provides access to the incoming HTTP request including
 * parsed cookies, which the handler uses for UID resolution when no explicit UID is
 * provided by the client.
 */
export interface ContextForGetSchedule extends Record<string, unknown> {
  req?: (IncomingMessage & { cookies: Partial<{ [key: string]: string }> }) | undefined;
}

/**
 * TypeScript type inferred from the raw {@link getScheduleSchemaObject} (pre-refinement).
 *
 * Used in handler function signatures and throughout the availability service pipeline
 * to type the validated input after Zod parsing. Since `z.infer` extracts the
 * **output** (post-transform) type, fields with `.transform()` reflect their
 * transformed shapes — e.g. the `duration` field is `number | "" | undefined`
 * (after the `.transform((val) => val && parseInt(val))` chain), not the raw
 * input type `string | undefined`.
 */
export type TGetScheduleInputSchema = z.infer<typeof getScheduleSchemaObject>;

/**
 * Runtime Zod validator exported for use in the tRPC router definition.
 *
 * This is the fully-composed {@link getScheduleSchema} with transforms (usernameList
 * array normalization, orgSlug null default) and refinements (event identification
 * requirement, time ordering enforcement). Consumed by the viewer slots `_router.tsx`
 * as the `.input()` schema for the `getSchedule` procedure.
 */
export const ZGetScheduleInputSchema = getScheduleSchema;

/**
 * Parameter type for the `getScheduleHandler` function.
 *
 * Combines the optional tRPC {@link ContextForGetSchedule} (providing access to
 * cookies and the HTTP request) with the Zod-validated input conforming to
 * {@link TGetScheduleInputSchema}.
 */
export type GetScheduleOptions = {
  ctx?: ContextForGetSchedule;
  input: TGetScheduleInputSchema;
};
