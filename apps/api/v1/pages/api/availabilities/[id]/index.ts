import type { NextApiRequest, NextApiResponse } from "next";

import { defaultHandler } from "@calcom/lib/server/defaultHandler";
import { defaultResponder } from "@calcom/lib/server/defaultResponder";

import { withMiddleware } from "~/lib/helpers/withMiddleware";

import authMiddleware from "./_auth-middleware";

/**
 * Entry point for the `/api/availabilities/[id]` Next.js API route.
 *
 * Handles individual availability record operations (read, update, delete)
 * for the Cal.com REST API v1 surface. Creation of new availability records
 * is handled at the collection endpoint (`/api/availabilities/`), so POST is
 * intentionally unsupported here.
 *
 * **Supported HTTP Methods**: `GET`, `PATCH`, `DELETE`
 *
 * **Execution Sequence**:
 * 1. `withMiddleware()` — validates the inbound API key, rejecting
 *    unauthenticated requests before any business logic executes.
 * 2. `defaultResponder` — wraps the inner handler to standardize JSON
 *    response formatting and error serialization for all verbs.
 * 3. `authMiddleware(req)` — enforces ownership and admin-level permission
 *    checks against the availability record identified by `[id]`.
 * 4. `defaultHandler` — dispatches to the appropriate verb-specific handler
 *    (`_get`, `_patch`, or `_delete`) based on `req.method`.
 *
 * Verb handlers are lazily loaded via dynamic `import()` expressions,
 * enabling code splitting so that only the handler matching the inbound
 * HTTP method is bundled and executed at runtime.
 *
 * Zod input validation is delegated to each individual verb handler and
 * the auth middleware — this orchestrator is deliberately validation-free.
 */
export default withMiddleware()(
  defaultResponder(async (req: NextApiRequest, res: NextApiResponse) => {
    await authMiddleware(req);
    return defaultHandler({
      GET: import("./_get"),
      PATCH: import("./_patch"),
      DELETE: import("./_delete"),
    })(req, res);
  })
);
