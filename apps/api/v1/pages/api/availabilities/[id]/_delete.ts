import type { NextApiRequest } from "next";

import { defaultResponder } from "@calcom/lib/server/defaultResponder";
import prisma from "@calcom/prisma";

import { schemaQueryIdParseInt } from "~/lib/validations/shared/queryIdTransformParseInt";

/**
 * @swagger
 * /availabilities/{id}:
 *   delete:
 *     operationId: removeAvailabilityById
 *     summary: Remove an existing availability
 *     parameters:
 *      - in: path
 *        name: id
 *        schema:
 *          type: integer
 *        required: true
 *        description: ID of the availability to delete
 *      - in: query
 *        name: apiKey
 *        required: true
 *        schema:
 *          type: integer
 *        description: Your API key
 *     tags:
 *     - availabilities
 *     externalDocs:
 *        url: https://docs.cal.com/docs/core-features/availability
 *     responses:
 *       201:
 *         description: OK, availability removed successfully
 *       400:
 *        description: Bad request. Availability id is invalid.
 *       401:
 *        description: Authorization information is missing or invalid.
 */
/**
 * Deletes an availability record by its integer ID.
 *
 * The `id` path parameter is validated and coerced to an integer via the
 * `schemaQueryIdParseInt` Zod schema before any database operation is attempted.
 *
 * @precondition Authorization is enforced by the `_auth-middleware.ts` layer that
 *   executes before this handler is invoked. The requesting user must own the
 *   availability record or hold sufficient permissions.
 *
 * @param req - The incoming Next.js API request whose `query.id` is parsed as an integer.
 *
 * @returns A `{ message: string }` object confirming deletion. The exact message
 *   template is `"Availability with id: ${id} deleted successfully"` — this response
 *   shape and message format are part of the public API contract and **MUST NOT**
 *   change (Rule 0.7.4 — Backward Compatibility).
 *
 * @throws {ZodError} If `query.id` cannot be parsed as a valid integer by
 *   `schemaQueryIdParseInt`.
 * @throws {PrismaClientKnownRequestError} Prisma throws error code `P2025`
 *   ("Record to delete does not exist") when no `Availability` row matches the
 *   provided `id`.
 */
export async function deleteHandler(req: NextApiRequest) {
  const { query } = req;
  const { id } = schemaQueryIdParseInt.parse(query);
  await prisma.availability.delete({ where: { id } });
  return { message: `Availability with id: ${id} deleted successfully` };
}

export default defaultResponder(deleteHandler);
