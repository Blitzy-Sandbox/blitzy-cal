import { WebhookTriggerEvents } from "@calcom/prisma/enums";

import type { RecordingReadyDTO, TranscriptionGeneratedDTO } from "../../../dto/types";
import type { WebhookPayload } from "../../types";
import { BaseRecordingPayloadBuilder } from "../../base/BaseRecordingPayloadBuilder";

/**
 * Recording payload builder for webhook version v2025-01-01.
 *
 * Delegates to the same implementation as v2021-10-20 initially.
 * No Calendly-specific recording webhook events exist.
 * Handles RECORDING_READY and RECORDING_TRANSCRIPTION_GENERATED.
 */
export class RecordingPayloadBuilder extends BaseRecordingPayloadBuilder {
  /**
   * Build the recording webhook payload for v2025-01-01.
   *
   * Discriminates between RECORDING_READY (single download link) and
   * RECORDING_TRANSCRIPTION_GENERATED (multiple download links) events,
   * delegating to the appropriate private builder method.
   */
  build(dto: RecordingReadyDTO | TranscriptionGeneratedDTO): WebhookPayload {
    if (dto.triggerEvent === WebhookTriggerEvents.RECORDING_READY) {
      return this.buildRecordingReadyPayload(dto as RecordingReadyDTO);
    }

    return this.buildTranscriptionPayload(dto as TranscriptionGeneratedDTO);
  }

  /**
   * Build recording ready payload for v2025-01-01.
   * Returns the single download link for the recorded meeting.
   */
  private buildRecordingReadyPayload(dto: RecordingReadyDTO): WebhookPayload {
    return {
      triggerEvent: dto.triggerEvent,
      createdAt: dto.createdAt,
      payload: { downloadLink: dto.downloadLink },
    };
  }

  /**
   * Build transcription generated payload for v2025-01-01.
   * Returns the multiple download links for transcription formats and recording.
   */
  private buildTranscriptionPayload(dto: TranscriptionGeneratedDTO): WebhookPayload {
    return {
      triggerEvent: dto.triggerEvent,
      createdAt: dto.createdAt,
      payload: { downloadLinks: dto.downloadLinks },
    };
  }
}
