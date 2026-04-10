import { DEFAULT_WEBHOOK_VERSION } from "../interface/IWebhookRepository";
import type { WebhookEventDTO } from "../dto/types";
import type { WebhookPayload } from "../factory/types";
import type { PayloadBuilderFactory } from "../factory/versioned/PayloadBuilderFactory";
import type { ILogger } from "../interface/infrastructure";
import type { IWebhookService } from "../interface/services";
import type { IWebhookNotificationHandler } from "../interface/webhook";
import type { WebhookVersion } from "../interface/IWebhookRepository";

/**
 * WebhookNotificationHandler — Orchestrates webhook notification delivery.
 *
 * This handler bridges Cal.com's 20+ webhook trigger events with subscriber
 * delivery via the versioned PayloadBuilderFactory. It queries subscribers,
 * constructs versioned payloads, and delegates processing to the WebhookService.
 *
 * ## Calendly Event Mapping Semantics (WH-001, WH-002, WH-003)
 *
 * Cal.com's webhook events map to Calendly's 3 core event types as follows:
 *
 * | Cal.com Trigger Event         | Calendly Equivalent                      |
 * | ----------------------------- | ---------------------------------------- |
 * | `BOOKING_CREATED`             | `invitee.created` (new booking)          |
 * | `BOOKING_RESCHEDULED`         | `invitee.created` (reschedule variant)   |
 * | `BOOKING_CANCELLED`           | `invitee.canceled`                       |
 * | `FORM_SUBMITTED`              | `routing_form_submission.created`        |
 * | All other Cal.com events      | No Calendly equivalent (Cal.com superset)|
 *
 * Cal.com's broader event surface (BOOKING_PAID, BOOKING_REJECTED,
 * MEETING_STARTED, MEETING_ENDED, RECORDING_READY, OOO_CREATED, etc.)
 * represents a superset of Calendly's webhook capabilities. Subscribers
 * consuming Cal.com webhooks receive richer lifecycle coverage than
 * the Calendly equivalent.
 *
 * All trigger events travel through the same versioned PayloadBuilderFactory
 * pipeline, ensuring consistent payload construction regardless of the
 * trigger type. The v2021-10-20 payload format is preserved exactly for
 * backward compatibility.
 */
export class WebhookNotificationHandler implements IWebhookNotificationHandler {
  private readonly log: ILogger;

  constructor(
    private readonly webhookService: IWebhookService,
    private readonly payloadBuilderFactory: PayloadBuilderFactory,
    logger: ILogger
  ) {
    this.log = logger.getSubLogger({ prefix: ["[WebhookNotificationHandler]"] });
  }

  /**
   * Handle incoming webhook notification by querying subscribers and dispatching payloads.
   *
   * For Calendly parity (WH-001, WH-002, WH-003), the following trigger events
   * produce payloads aligned with Calendly's semantic equivalents:
   * - `BOOKING_CREATED` → produces payload equivalent to Calendly `invitee.created`
   * - `BOOKING_CANCELLED` → produces payload equivalent to Calendly `invitee.canceled`
   * - `FORM_SUBMITTED` → produces payload equivalent to Calendly `routing_form_submission.created`
   *
   * Payload construction is delegated to the versioned PayloadBuilderFactory,
   * which selects the appropriate builder based on the subscriber's webhook version.
   *
   * @param dto - The webhook event data transfer object containing trigger event and payload data
   * @param isDryRun - When true, skips actual webhook delivery (used for testing/validation)
   */
  async handleNotification(dto: WebhookEventDTO, isDryRun = false): Promise<void> {
    const trigger = dto.triggerEvent;

    try {
      if (isDryRun) {
        this.log.debug(`Dry run mode - skipping webhook notification for: ${trigger}`);
        return;
      }

      const subscriptionParams = {
        userId: dto.userId,
        eventTypeId: dto.eventTypeId,
        triggerEvent: trigger,
        teamId: dto.teamId,
        orgId: dto.orgId,
        oAuthClientId: dto.platformClientId,
      };

      this.log.debug(`Querying for webhook subscribers with params:`, subscriptionParams);

      const subscribers = await this.webhookService.getSubscribers(subscriptionParams);

      if (subscribers.length === 0) {
        this.log.debug(`No subscribers found for event: ${trigger}`, {
          bookingId: dto.bookingId,
          eventTypeId: dto.eventTypeId,
        });
        return;
      }

      const webhookPayload = this.createPayload(dto);

      await this.webhookService.processWebhooks(trigger, webhookPayload, subscribers);

      this.log.debug(`Successfully processed webhook notification: ${trigger}`, {
        subscriberCount: subscribers.length,
        bookingId: dto.bookingId,
      });
    } catch (error) {
      this.log.error(`Error handling webhook notification: ${trigger}`, {
        error: error instanceof Error ? error.message : String(error),
        bookingId: dto.bookingId,
        eventTypeId: dto.eventTypeId,
      });
      throw error;
    }
  }

  /**
   * Create webhook payload using version-specific builder from factory.
   *
   * All event types now go through the factory for consistent versioning.
   * The factory resolves a trigger-specific builder for the given version,
   * ensuring that:
   * - `BOOKING_CREATED` events produce Calendly `invitee.created`-equivalent payloads
   * - `BOOKING_CANCELLED` events produce Calendly `invitee.canceled`-equivalent payloads
   * - `FORM_SUBMITTED` events produce Calendly `routing_form_submission.created`-equivalent payloads
   *
   * **Current behavior:** Uses `DEFAULT_WEBHOOK_VERSION` (v2021-10-20) for all subscribers.
   * The v2021-10-20 payload format is preserved exactly — no field removals, renames, or
   * type changes — per the webhook backward compatibility mandate.
   *
   * **Per-subscriber version support (prepared, not yet active):**
   * The `version` parameter already accepts any valid `WebhookVersion` value, enabling
   * future per-subscriber version resolution. When activated, the enhancement path is:
   * 1. Read each subscriber's stored `version` field from the webhook subscription
   * 2. Pass the subscriber-specific version to this method
   * 3. Group subscribers by version for efficient batch payload construction
   * 4. Available versions: v2021-10-20 (default), v2025-01-01 (Calendly-aligned with
   *    UTM tracking and reschedule URI references)
   *
   * @param dto - The webhook event DTO containing all event data
   * @param version - The webhook payload version to use (defaults to DEFAULT_WEBHOOK_VERSION)
   * @returns The constructed webhook payload for the given version and trigger event
   */
  private createPayload(
    dto: WebhookEventDTO,
    version: WebhookVersion = DEFAULT_WEBHOOK_VERSION
  ): WebhookPayload {
    // Get version-specific builder from factory - handles all event types
    const builder = this.payloadBuilderFactory.getBuilder(version, dto.triggerEvent);
    return builder.build(dto);
  }
}
