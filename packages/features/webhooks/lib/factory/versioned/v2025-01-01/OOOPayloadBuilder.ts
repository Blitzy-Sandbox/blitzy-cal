import type { OOOCreatedDTO } from "../../../dto/types";
import type { WebhookPayload } from "../../types";
import { BaseOOOPayloadBuilder } from "../../base/BaseOOOPayloadBuilder";

/**
 * OOO (Out of Office) payload builder for webhook version v2025-01-01.
 *
 * Delegates to the same implementation as v2021-10-20 initially.
 * No Calendly-specific OOO webhook events exist.
 * Includes the OOO entry data in the payload.
 */
export class OOOPayloadBuilder extends BaseOOOPayloadBuilder {
  /**
   * Build the OOO webhook payload for v2025-01-01.
   */
  build(dto: OOOCreatedDTO): WebhookPayload {
    return {
      triggerEvent: dto.triggerEvent,
      createdAt: dto.createdAt,
      payload: { oooEntry: dto.oooEntry },
    };
  }
}
