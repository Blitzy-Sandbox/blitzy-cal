import { defaultHandler } from "@calcom/lib/server/defaultHandler";

import { withMiddleware } from "~/lib/helpers/withMiddleware";

/**
 * Entry point for `POST /api/availabilities`.
 *
 * Middleware composition:
 *  - `withMiddleware()` wraps the handler with the API v1 middleware pipeline,
 *    which implicitly applies API key verification (`verifyApiKey`) before the
 *    request reaches any method handler.
 *  - `defaultHandler` routes the validated request by HTTP method; only POST is
 *    registered here, delegating to the lazy-imported `./_post` handler.
 *
 * Permission enforcement (ownership / resource-level checks) is performed
 * inside the `_post` handler itself, after the API key has been validated by
 * the middleware layer.
 */
export default withMiddleware()(
  defaultHandler({
    POST: import("./_post"),
  })
);
