import type { FORM_SUBMITTED_WEBHOOK_RESPONSES } from "@calcom/app-store/routing-forms/lib/formSubmissionUtils";

import type { FormSubmittedDTO, FormSubmittedNoEventDTO } from "../../../dto/types";
import type { WebhookPayload } from "../../types";
import { BaseFormPayloadBuilder } from "../../base/BaseFormPayloadBuilder";

/**
 * Form payload builder for webhook version v2025-01-01.
 *
 * Calendly-aligned form webhook payload format (WH-003, WH-005).
 * Includes Calendly-parity fields as prominent payload properties:
 * - submissionTimestamp: ISO 8601 timestamp when the form was submitted
 * - routingResult: The routing outcome (eventTypeId, teamMemberId, url)
 *
 * Also preserves backwards compatibility: response values at root level.
 */
export class FormPayloadBuilder extends BaseFormPayloadBuilder {
  /**
   * Build the form webhook payload for v2025-01-01.
   *
   * Constructs a payload containing:
   * - Core form fields: formId, formName, teamId, responses (same as v2021-10-20)
   * - Calendly-parity fields: submissionTimestamp, routingResult (when present on DTO)
   * - Backwards compatibility: individual response values spread at root level
   *
   * @param dto - The form submitted event DTO (FORM_SUBMITTED or FORM_SUBMITTED_NO_EVENT)
   * @returns The complete webhook payload ready for dispatch
   */
  build(dto: FormSubmittedDTO | FormSubmittedNoEventDTO): WebhookPayload {
    const responses = dto.response.data;

    const payload: {
      formId: string;
      formName: string;
      teamId: number | null;
      responses: FORM_SUBMITTED_WEBHOOK_RESPONSES;
      submissionTimestamp?: string;
      routingResult?: {
        eventTypeId?: number;
        teamMemberId?: number;
        url?: string;
      };
      [key: string]: unknown;
    } = {
      formId: dto.form.id,
      formName: dto.form.name,
      teamId: dto.teamId ?? null,
      responses,
    };

    // Calendly-parity fields (WH-003: routing_form_submission.created alignment)
    // These fields are only present on FormSubmittedDTO, not FormSubmittedNoEventDTO.
    // The "in" operator narrows the union type safely without requiring type assertions.
    if ("submissionTimestamp" in dto && dto.submissionTimestamp !== undefined) {
      payload.submissionTimestamp = dto.submissionTimestamp;
    }
    if ("routingResult" in dto && dto.routingResult !== undefined) {
      payload.routingResult = dto.routingResult;
    }

    // Add unwrapped response fields at root level for backwards compatibility
    this.addBackwardsCompatibilityFields(payload, responses);

    return {
      triggerEvent: dto.triggerEvent,
      createdAt: dto.createdAt,
      payload,
    };
  }

  /**
   * Add backwards compatibility fields to payload.
   *
   * Spreads individual response values at the root level of the payload object,
   * maintaining backwards compatibility with consumers that expect flattened
   * response fields alongside the structured `responses` object.
   *
   * For each response entry, the `value` property takes precedence over `response`.
   * Only non-undefined values are spread to the root level.
   *
   * @param payload - The payload object to augment with flattened response fields
   * @param responses - The structured form submission responses
   */
  private addBackwardsCompatibilityFields(
    payload: Record<string, unknown>,
    responses: FORM_SUBMITTED_WEBHOOK_RESPONSES
  ): void {
    Object.entries(responses).forEach(([fieldKey, fieldValue]) => {
      if (fieldValue && typeof fieldValue === "object") {
        const responseField = fieldValue as {
          value?: unknown;
          response?: unknown;
        };

        if (responseField.value !== undefined) {
          payload[fieldKey] = responseField.value;
        } else if (responseField.response !== undefined) {
          payload[fieldKey] = responseField.response;
        }
      }
    });
  }
}
