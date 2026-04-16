import type { NextApiRequest } from "next";

import { getServerSession } from "@calcom/features/auth/lib/getServerSession";
import { getRegularBookingService } from "@calcom/features/bookings/di/RegularBookingService.container";
import { BotDetectionService } from "@calcom/features/bot-detection";
import { EventTypeRepository } from "@calcom/features/eventtypes/repositories/eventTypeRepository";
import { FeaturesRepository } from "@calcom/features/flags/features.repository";
import { PrismaSelectedSlotRepository } from "@calcom/features/selectedSlots/repositories/PrismaSelectedSlotRepository";
import { checkRateLimitAndThrowError } from "@calcom/lib/checkRateLimitAndThrowError";
import getIP from "@calcom/lib/getIP";
import { piiHasher } from "@calcom/lib/server/PiiHasher";
import { checkCfTurnstileToken } from "@calcom/lib/server/checkCfTurnstileToken";
import { defaultResponder } from "@calcom/lib/server/defaultResponder";
import type { TraceContext } from "@calcom/lib/tracing";
import { prisma } from "@calcom/prisma";
import { CreationSource } from "@calcom/prisma/enums";

async function handler(req: NextApiRequest & { userId?: number; traceContext: TraceContext }) {
  const userIp = getIP(req);

  if (process.env.NEXT_PUBLIC_CLOUDFLARE_USE_TURNSTILE_IN_BOOKER === "1") {
    await checkCfTurnstileToken({
      token: req.body["cfToken"] as string,
      remoteIp: userIp,
    });
  }

  // Check for bot detection using feature flag
  const featuresRepository = new FeaturesRepository(prisma);
  const eventTypeRepository = new EventTypeRepository(prisma);
  const botDetectionService = new BotDetectionService(featuresRepository, eventTypeRepository);

  await botDetectionService.checkBotDetection({
    eventTypeId: req.body.eventTypeId,
    headers: req.headers,
  });

  await checkRateLimitAndThrowError({
    rateLimitingType: "core",
    identifier: `createBooking:${piiHasher.hash(userIp)}`,
  });

  const session = await getServerSession({ req });
  /* To mimic API behavior and comply with types */
  req.body = {
    ...req.body,
    creationSource: CreationSource.WEBAPP,
  };

  const regularBookingService = getRegularBookingService();
  try {
    const booking = await regularBookingService.createBooking({
      bookingData: req.body,
      bookingMeta: {
        userId: session?.user?.id || -1,
        hostname: req.headers.host || "",
        forcedSlug: req.headers["x-cal-force-slug"] as string | undefined,
        traceContext: req.traceContext,
        impersonatedByUserUuid: session?.user?.impersonatedBy?.uuid,
      },
    });

    return booking;
  } catch (error) {
    // Clean up temporary seat reservations when a booking attempt fails.
    // Without this cleanup, stale SelectedSlots records tied to the browser-session uid
    // persist until their releaseAt timestamp expires, causing the availability engine
    // to count them as consumed seats and hiding remaining availability from other users.
    const uid = req.cookies?.uid;
    if (uid) {
      const selectedSlotRepository = new PrismaSelectedSlotRepository(prisma);
      try {
        await selectedSlotRepository.deleteByUid(uid);
      } catch {
        // Slot cleanup is best-effort; the booking error is the primary concern.
        // If cleanup fails, the slot will still expire naturally via releaseAt.
      }
    }
    throw error;
  }
}

export default defaultResponder(handler, "/api/book/event");
