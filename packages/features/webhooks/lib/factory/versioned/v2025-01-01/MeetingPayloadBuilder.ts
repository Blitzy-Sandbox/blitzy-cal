import { WebhookTriggerEvents } from "@calcom/prisma/enums";

import type {
  AfterGuestsNoShowDTO,
  AfterHostsNoShowDTO,
  MeetingEndedDTO,
  MeetingStartedDTO,
} from "../../../dto/types";
import type { WebhookPayload } from "../../types";
import { BaseMeetingPayloadBuilder } from "../../base/BaseMeetingPayloadBuilder";

/**
 * Meeting payload builder for webhook version v2025-01-01.
 *
 * Delegates to the same implementation as v2021-10-20 initially.
 * No Calendly-specific meeting webhook events exist.
 * Cal.com-specific extensions (MEETING_STARTED, MEETING_ENDED,
 * AFTER_HOSTS/GUESTS_NO_SHOW) use base implementation.
 */
export class MeetingPayloadBuilder extends BaseMeetingPayloadBuilder {
  /**
   * Build the meeting webhook payload for v2025-01-01.
   *
   * Handles two payload shapes:
   * - No-show events (AFTER_HOSTS_CAL_VIDEO_NO_SHOW, AFTER_GUESTS_CAL_VIDEO_NO_SHOW):
   *   Returns bookingId and webhook info in the payload.
   * - Meeting lifecycle events (MEETING_STARTED, MEETING_ENDED):
   *   Returns the full booking data spread into the payload.
   */
  build(
    dto: MeetingStartedDTO | MeetingEndedDTO | AfterHostsNoShowDTO | AfterGuestsNoShowDTO
  ): WebhookPayload {
    // Handle no-show events (different payload structure)
    if (
      dto.triggerEvent === WebhookTriggerEvents.AFTER_HOSTS_CAL_VIDEO_NO_SHOW ||
      dto.triggerEvent === WebhookTriggerEvents.AFTER_GUESTS_CAL_VIDEO_NO_SHOW
    ) {
      const noShowDto = dto as AfterHostsNoShowDTO | AfterGuestsNoShowDTO;
      return {
        triggerEvent: dto.triggerEvent,
        createdAt: dto.createdAt,
        payload: {
          bookingId: noShowDto.bookingId,
          webhook: noShowDto.webhook,
        },
      };
    }

    // Handle meeting started/ended events
    const meetingDto = dto as MeetingStartedDTO | MeetingEndedDTO;
    return {
      triggerEvent: dto.triggerEvent,
      createdAt: dto.createdAt,
      payload: { ...meetingDto.booking },
    };
  }
}
