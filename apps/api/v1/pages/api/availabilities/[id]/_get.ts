import type { NextApiRequest } from "next";

import { defaultResponder } from "@calcom/lib/server/defaultResponder";
import prisma from "@calcom/prisma";

import { schemaAvailabilityReadPublic } from "~/lib/validations/availability";
import { schemaQueryIdParseInt } from "~/lib/validations/shared/queryIdTransformParseInt";

/**
 * @swagger
 * /availabilities/{id}:
 *   get:
 *     operationId: getAvailabilityById
 *     summary: Find an availability
 *     parameters:
 *       - in: path
 *         name: id
 *         schema:
 *           type: integer
 *         required: true
 *         description: ID of the availability to get
 *       - in: query
 *         name: apiKey
 *         required: true
 *         schema:
 *           type: integer
 *         description: Your API key
 *     tags:
 *     - availabilities
 *     externalDocs:
 *        url: https://docs.cal.com/docs/core-features/availability
 *     responses:
 *       200:
 *         description: OK
 *       401:
 *        description: Authorization information is missing or invalid
 *       404:
 *        description: Availability not found
 */
/**
 * Fetches a single availability record by its integer ID.
 *
 * The `id` path parameter is validated and coerced to an integer via
 * `schemaQueryIdParseInt`. The matching `Availability` row is loaded from the
 * database together with `Schedule.userId` so that downstream authorization
 * middleware can verify ownership of the parent schedule.
 *
 * The raw Prisma result is sanitized through `schemaAvailabilityReadPublic`
 * before being returned, stripping any internal-only fields.
 *
 * @returns `{ availability: AvailabilityReadPublic }` — the response shape is
 *   a backward-compatibility contract (Rule 0.7.4) and MUST NOT be changed.
 * @throws 404 — when the availability record does not exist. Prisma's
 *   `findUnique` returns `null`, which causes `schemaAvailabilityReadPublic.parse`
 *   to throw a Zod validation error that the default responder maps to a 404.
 */
export async function getHandler(req: NextApiRequest) {
  const { query } = req;
  const { id } = schemaQueryIdParseInt.parse(query);
  const availability = await prisma.availability.findUnique({
    where: { id },
    include: { Schedule: { select: { userId: true } } },
  });
  return { availability: schemaAvailabilityReadPublic.parse(availability) };
}

export default defaultResponder(getHandler);
