import type { DelegationCredentialErrorDTO, DelegationCredentialErrorPayloadType } from "../../../dto/types";
import type { WebhookPayload } from "../../types";
import { BaseDelegationPayloadBuilder } from "../../base/BaseDelegationPayloadBuilder";

/**
 * Delegation payload builder for webhook version v2025-01-01.
 *
 * Delegates to the same implementation as v2021-10-20 initially.
 * No Calendly-specific delegation webhook events exist.
 * Handles DELEGATION_CREDENTIAL_ERROR events with error, credential, and user data.
 */
export class DelegationPayloadBuilder extends BaseDelegationPayloadBuilder {
  /**
   * Build the delegation credential error webhook payload for v2025-01-01.
   *
   * Constructs a typed payload containing the delegation credential error details
   * (error information, credential metadata, and affected user) and wraps it in
   * the standard WebhookPayload envelope with triggerEvent and createdAt metadata.
   *
   * @param dto - The delegation credential error data transfer object containing
   *   triggerEvent, createdAt, error details, credential info, and user info.
   * @returns A WebhookPayload with the delegation credential error payload.
   */
  build(dto: DelegationCredentialErrorDTO): WebhookPayload {
    const payload: DelegationCredentialErrorPayloadType = {
      error: dto.error,
      credential: dto.credential,
      user: dto.user,
    };

    return {
      triggerEvent: dto.triggerEvent,
      createdAt: dto.createdAt,
      payload,
    };
  }
}
