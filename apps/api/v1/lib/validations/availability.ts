/**
 * Zod validation schemas for API v1 availability endpoints.
 *
 * These schemas define the request and response contracts for the
 * `/api/v1/availabilities` resource. They are consumed by the endpoint
 * handlers in `apps/api/v1/pages/api/availabilities/`.
 *
 * The Availability model represents individual time-window records
 * (startTime, endTime, days, date) that belong to a parent Schedule.
 * Timezone handling lives on the Schedule model, not on Availability.
 *
 * @module apps/api/v1/lib/validations/availability
 * @see {@link apps/api/v1/pages/api/availabilities/[id]/_get.ts}
 * @see {@link apps/api/v1/pages/api/availabilities/[id]/_patch.ts}
 * @see {@link apps/api/v1/pages/api/availabilities/_post.ts}
 */
import { z } from "zod";

import { denullishShape } from "@calcom/prisma/zod-utils";
import { AvailabilitySchema } from "@calcom/prisma/zod/modelSchema/AvailabilitySchema";
import { ScheduleSchema } from "@calcom/prisma/zod/modelSchema/ScheduleSchema";

/**
 * Base body parameters required when creating an availability record.
 *
 * Uses `denullishShape` to strip nullable wrappers from the Prisma-generated
 * `AvailabilitySchema`, making `scheduleId` a required non-null field.
 * Every availability record must reference its parent schedule.
 */
export const schemaAvailabilityBaseBodyParams = /** We make all these properties required */ denullishShape(
  AvailabilitySchema.pick({
    /** We need to pass the schedule where this availability belongs to */
    scheduleId: true,
  })
);

/**
 * Public-facing read schema for availability responses.
 *
 * Picks the core temporal and scheduling fields from the Prisma
 * `AvailabilitySchema`, then merges an optional `success` boolean and a
 * partial `Schedule` object for nested schedule metadata.
 *
 * Deprecated fields (`eventTypeId`, `userId`) are intentionally excluded
 * from the pick — they remain commented out to document the deprecation
 * decision for future maintainers.
 *
 * Consumed by GET and POST response serialization in the availability
 * endpoint handlers.
 */
export const schemaAvailabilityReadPublic = AvailabilitySchema.pick({
  id: true,
  startTime: true,
  endTime: true,
  date: true,
  scheduleId: true,
  days: true,
  // eventTypeId: true /** @deprecated */,
  // userId: true /** @deprecated */,
}).merge(z.object({ success: z.boolean().optional(), Schedule: ScheduleSchema.partial() }).partial());

/**
 * Internal creation parameters for a new availability record.
 *
 * Accepts `startTime` and `endTime` as either `Date` objects or ISO 8601
 * strings to support both programmatic and JSON-serialized API clients.
 * The `days` array (matching Prisma `Int[]`) and `date` override are optional.
 *
 * Uses `.strict()` to reject any unknown properties, preventing clients
 * from accidentally passing fields that belong on the Schedule model
 * (e.g., timezone, name).
 *
 * @internal Not exported directly — composed into `schemaAvailabilityCreateBodyParams`.
 */
const schemaAvailabilityCreateParams = z
  .object({
    startTime: z.date().or(z.string()),
    endTime: z.date().or(z.string()),
    days: z.array(z.number()).optional(),
    date: z.date().or(z.string()).optional(),
  })
  .strict();

/**
 * Internal edit parameters for patching an existing availability record.
 *
 * Mirrors `schemaAvailabilityCreateParams` but makes every field optional
 * to support partial PATCH updates — clients may update any subset of
 * temporal fields without providing all of them.
 *
 * Uses `.strict()` to reject unknown properties, consistent with the
 * creation schema.
 *
 * @internal Not exported directly — aliased as `schemaAvailabilityEditBodyParams`.
 */
const schemaAvailabilityEditParams = z
  .object({
    startTime: z.date().or(z.string()).optional(),
    endTime: z.date().or(z.string()).optional(),
    days: z.array(z.number()).optional(),
    date: z.date().or(z.string()).optional(),
  })
  .strict();

/**
 * Exported edit body schema for the PATCH `/availabilities/:id` endpoint.
 *
 * Alias of the internal `schemaAvailabilityEditParams`. All fields are
 * optional, enabling partial updates to availability time windows.
 *
 * @see {@link apps/api/v1/pages/api/availabilities/[id]/_patch.ts}
 */
export const schemaAvailabilityEditBodyParams = schemaAvailabilityEditParams;

/**
 * Exported creation body schema for the POST `/availabilities` endpoint.
 *
 * Merges the base params (required `scheduleId`) with the temporal creation
 * params (startTime, endTime, optional days/date). This ensures every new
 * availability record is tied to a parent schedule.
 *
 * @see {@link apps/api/v1/pages/api/availabilities/_post.ts}
 */
export const schemaAvailabilityCreateBodyParams = schemaAvailabilityBaseBodyParams.merge(
  schemaAvailabilityCreateParams
);

/**
 * Query/body schema for reading availability records filtered by user.
 *
 * Accepts an optional `userId` that can be a single number or an array
 * of numbers, supporting both single-user and multi-user availability
 * lookups. All fields are partial, making the filter entirely optional.
 */
export const schemaAvailabilityReadBodyParams = z
  .object({
    userId: z.union([z.number(), z.array(z.number())]),
  })
  .partial();

/**
 * Query/body schema for reading a single user's availability.
 *
 * Unlike `schemaAvailabilityReadBodyParams`, this requires a single
 * numeric `userId` — used when the endpoint must resolve to exactly
 * one user's availability records.
 */
export const schemaSingleAvailabilityReadBodyParams = z.object({
  userId: z.number(),
});
