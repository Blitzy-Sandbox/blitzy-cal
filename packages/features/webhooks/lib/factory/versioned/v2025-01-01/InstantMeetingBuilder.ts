import type { InstantMeetingDTO } from "../../../dto/types";
import type { WebhookPayload } from "../../types";
import { BaseInstantMeetingBuilder } from "../../base/BaseInstantMeetingBuilder";

/**
 * Instant meeting payload builder for webhook version v2025-01-01.
 *
 * Delegates to the same implementation as v2021-10-20 initially.
 * No Calendly-specific instant meeting webhook events exist.
 * Includes notification-style data (title, body, icon, url, actions).
 */
export class InstantMeetingBuilder extends BaseInstantMeetingBuilder {
  /**
   * Build the instant meeting webhook payload for v2025-01-01.
   */
  build(dto: InstantMeetingDTO): WebhookPayload {
    return {
      triggerEvent: dto.triggerEvent,
      createdAt: dto.createdAt,
      payload: {
        title: dto.title,
        body: dto.body,
        icon: dto.icon,
        url: dto.url,
        actions: dto.actions,
        requireInteraction: dto.requireInteraction,
        type: dto.type,
      },
    };
  }
}
