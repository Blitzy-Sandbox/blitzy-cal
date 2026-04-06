import { createNextApiHandler } from "@calcom/trpc/server/createNextApiHandler";
import { inAppNotificationsRouter } from "@calcom/trpc/server/routers/viewer/notifications/_router";

export default createNextApiHandler(inAppNotificationsRouter);
