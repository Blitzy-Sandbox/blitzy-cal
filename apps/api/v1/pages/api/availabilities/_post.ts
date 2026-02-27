import type { NextApiRequest } from "next";

import { HttpError } from "@calcom/lib/http-error";
import { defaultResponder } from "@calcom/lib/server/defaultResponder";
import prisma from "@calcom/prisma";

import {
  schemaAvailabilityCreateBodyParams,
  schemaAvailabilityReadPublic,
} from "~/lib/validations/availability";

/**
 * @swagger
 * /availabilities:
 *   post:
 *     operationId: addAvailability
 *     summary: Creates a new availability
 *     parameters:
 *       - in: query
 *         name: apiKey
 *         required: true
 *         schema:
 *           type: string
 *         description: Your API key
 *     requestBody:
 *       description: Edit an existing availability related to one of your bookings
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *              - scheduleId
 *              - startTime
 *              - endTime
 *             properties:
 *               days:
 *                 type: array
 *                 description: Array of integers depicting weekdays
 *                 items:
 *                   type: integer
 *                   enum: [0, 1, 2, 3, 4, 5]
 *               scheduleId:
 *                 type: integer
 *                 description: ID of schedule this availability is associated with
 *               startTime:
 *                 type: string
 *                 description: Start time of the availability
 *               endTime:
 *                 type: string
 *                 description: End time of the availability
 *           examples:
 *              availability:
 *                summary: An example of availability
 *                value:
 *                  scheduleId: 123
 *                  days: [1,2,3,5]
 *                  startTime: 1970-01-01T17:00:00.000Z
 *                  endTime: 1970-01-01T17:00:00.000Z
 *
 *
 *     tags:
 *     - availabilities
 *     externalDocs:
 *        url: https://docs.cal.com/docs/core-features/availability
 *     responses:
 *       201:
 *         description: OK, availability created
 *       400:
 *        description: Bad request. Availability body is invalid.
 *       401:
 *        description: Authorization information is missing or invalid.
 */
/**
 * Handles POST /availabilities — creates a new availability entry for a user's schedule.
 *
 * Pipeline: validation → authorization → creation → serialization
 *  1. Validates the request body against `schemaAvailabilityCreateBodyParams` (Zod 3.25.76).
 *     Throws a ZodError if any required field (scheduleId, startTime, endTime) is missing or invalid.
 *  2. Calls `checkPermissions` to verify the requesting user owns the target schedule
 *     (or is a system-wide admin).
 *  3. Creates the `Availability` record in the database via Prisma, including the owning
 *     `Schedule.userId` for response serialization.
 *  4. Sets HTTP status 201 (Created) and returns the sanitized availability object
 *     through `schemaAvailabilityReadPublic`, which strips internal-only fields.
 *
 * Response shape contract (must not change — consumed by API v1 clients):
 *   `{ availability: AvailabilityReadPublic, message: string }`
 *
 * This handler is wrapped by `defaultResponder` (see default export) which provides
 * consistent error handling, ensuring ZodErrors and HttpErrors are translated into
 * appropriate HTTP responses.
 *
 * @param req - The Next.js API request, augmented with `userId` and `isSystemWideAdmin` by auth middleware.
 * @returns The created availability record and a success message.
 */
async function postHandler(req: NextApiRequest) {
  const data = schemaAvailabilityCreateBodyParams.parse(req.body);
  await checkPermissions(req);
  const availability = await prisma.availability.create({
    data,
    include: { Schedule: { select: { userId: true } } },
  });
  req.statusCode = 201;
  return {
    availability: schemaAvailabilityReadPublic.parse(availability),
    message: "Availability created successfully",
  };
}

/**
 * Verifies that the requesting user is authorized to add availability to the target schedule.
 *
 * Permission model:
 *  1. **System-wide admin bypass**: If `req.isSystemWideAdmin` is true, the function
 *     returns immediately — admins may create availability on any schedule.
 *  2. **Schedule ownership verification**: For non-admin users, queries the database to
 *     confirm a schedule exists with both the given `scheduleId` (from the request body)
 *     and the authenticated `userId`. If no matching schedule is found, an `HttpError(401)`
 *     is thrown with a descriptive message.
 *
 * Note: The `schemaAvailabilityCreateBodyParams.parse(req.body)` call within this function
 * re-validates the request body, even though it was already validated in `postHandler`.
 * This redundancy is intentional/historical and should NOT be removed — it ensures the
 * permission check is self-contained and does not rely on external state.
 *
 * @param req - The Next.js API request, augmented with `userId` and `isSystemWideAdmin` by auth middleware.
 * @throws {HttpError} 401 if the authenticated user does not own the target schedule.
 */
async function checkPermissions(req: NextApiRequest) {
  const { userId, isSystemWideAdmin } = req;
  if (isSystemWideAdmin) return;
  const data = schemaAvailabilityCreateBodyParams.parse(req.body);
  const schedule = await prisma.schedule.findFirst({
    where: { userId, id: data.scheduleId },
  });
  if (!schedule)
    throw new HttpError({ statusCode: 401, message: "You can't add availabilities to this schedule" });
}

export default defaultResponder(postHandler);
