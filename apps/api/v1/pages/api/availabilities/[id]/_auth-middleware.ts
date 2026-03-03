import type { NextApiRequest } from "next";

import prisma from "@calcom/prisma";

import { schemaQueryIdParseInt } from "~/lib/validations/shared/queryIdTransformParseInt";

/**
 * Authorization gate for the `/api/availabilities/[id]` route.
 *
 * Enforces ownership or admin bypass before any CRUD operation reaches
 * the verb-specific handler. Called by `index.ts` via
 * `await authMiddleware(req)` before `defaultHandler` dispatch.
 *
 * **Security model — two-tier authorization:**
 * 1. *Admin bypass* — System-wide admins (`isSystemWideAdmin`) skip
 *    ownership verification entirely and are granted unconditional access.
 * 2. *Ownership check* — Non-admin users must own the availability record.
 *    Ownership is verified by matching the requesting user's `userId` against
 *    the `Schedule.userId` relation on the `Availability` row. The query uses
 *    Prisma's `findFirstOrThrow`, which throws a `NotFoundError` (P2025) when
 *    the record does not exist **or** the user does not own it.
 *
 * **404-vs-403 caveat:**
 * When a non-admin user requests an availability they do not own, the
 * response is a 404 (not 403). This is intentional — it prevents
 * information leakage about the existence of records owned by other users.
 *
 * **Zod validation:**
 * The `id` path parameter is parsed and validated as an integer at the
 * boundary via `schemaQueryIdParseInt` (Zod 3.25.76), ensuring only valid
 * numeric identifiers reach the database layer.
 *
 * **Prisma dependency:**
 * Uses `@calcom/prisma` for ownership verification. No direct Prisma
 * calls are made from downstream handlers — this middleware centralizes
 * the authorization database access for the availability resource.
 *
 * @param req - The authenticated Next.js API request, expected to carry
 *              `userId`, `isSystemWideAdmin`, and `query` properties
 *              injected by the upstream authentication layer.
 * @throws {import("@prisma/client").Prisma.NotFoundOrKnownRequestError}
 *         When the availability record does not exist or is not owned by
 *         the requesting (non-admin) user.
 */
async function authMiddleware(req: NextApiRequest) {
  const { userId, isSystemWideAdmin, query } = req;
  const { id } = schemaQueryIdParseInt.parse(query);
  /** Admins can skip the ownership verification */
  if (isSystemWideAdmin) return;
  /**
   * There's a caveat here. If the availability exists but the user doesn't own it,
   * the user will see a 404 error which may or not be the desired behavior.
   */
  await prisma.availability.findFirstOrThrow({
    where: { id, Schedule: { userId } },
  });
}

export default authMiddleware;
