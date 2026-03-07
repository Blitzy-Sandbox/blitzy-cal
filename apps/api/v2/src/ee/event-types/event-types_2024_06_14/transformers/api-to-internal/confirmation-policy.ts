import { ConfirmationPolicyEnum } from "@calcom/platform-enums";
import type {
  ConfirmationPolicyTransformedSchema,
  NoticeThresholdTransformedSchema,
  CreateEventTypeInput_2024_06_14,
} from "@calcom/platform-types";

/**
 * Transforms an API confirmation policy payload into the internal
 * `ConfirmationPolicyTransformedSchema` consumed by the booking engine.
 *
 * Supports three modes:
 * - **disabled** – no confirmation required (`requiresConfirmation: false`).
 * - **ALWAYS** – every booking requires manual confirmation by the host.
 * - **TIME** – bookings within the notice-threshold window require confirmation;
 *   those further out are auto-confirmed.
 *
 * This transformer is intentionally paradigm-agnostic: confirmation policy is a
 * cross-cutting concern that applies identically to one-on-one, group (seated),
 * round-robin, collective, managed, and dynamic event types. No paradigm-specific
 * branching is required because the booking engine evaluates the policy uniformly
 * regardless of how hosts or seats are assigned.
 */
export function transformConfirmationPolicyApiToInternal(
  inputConfirmationPolicy: CreateEventTypeInput_2024_06_14["confirmationPolicy"]
): ConfirmationPolicyTransformedSchema | undefined {
  if (!inputConfirmationPolicy) return undefined;
  if (inputConfirmationPolicy.disabled) {
    return {
      requiresConfirmation: false,
      requiresConfirmationWillBlockSlot: false,
      requiresConfirmationThreshold: undefined,
    };
  }
  switch (inputConfirmationPolicy.type) {
    case ConfirmationPolicyEnum.ALWAYS:
      return {
        requiresConfirmation: true,
        requiresConfirmationThreshold: undefined,
        requiresConfirmationWillBlockSlot: inputConfirmationPolicy.blockUnconfirmedBookingsInBooker,
      };
    case ConfirmationPolicyEnum.TIME:
      return {
        requiresConfirmation: true,
        requiresConfirmationThreshold: {
          unit: inputConfirmationPolicy.noticeThreshold?.unit,
          time: inputConfirmationPolicy.noticeThreshold?.count,
        } as NoticeThresholdTransformedSchema,
        requiresConfirmationWillBlockSlot: inputConfirmationPolicy.blockUnconfirmedBookingsInBooker,
      };
  }
}
