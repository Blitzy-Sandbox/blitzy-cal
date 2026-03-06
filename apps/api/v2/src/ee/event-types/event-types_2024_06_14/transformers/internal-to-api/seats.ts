import type {
  SeatOptionsTransformedSchema,
  SeatOptionsDisabledSchema,
  Seats_2024_06_14,
  Disabled_2024_06_14,
} from "@calcom/platform-types";

/**
 * Transforms internal seat configuration to the v2024-06-14 API response format.
 *
 * ET-002 Behavioral Parity (Group Events):
 * Calendly's group event types allow multiple attendees to book the same time slot.
 * Cal.com implements equivalent functionality via `seatsPerTimeSlot` on the EventType model.
 * This transformer maps the persisted seat configuration back to the API contract so that
 * API consumers receive a consistent, typed representation of group event seat settings.
 *
 * Field mapping (internal → API):
 *   - `seatsPerTimeSlot`            → `seatsPerTimeSlot`       (direct copy)
 *   - `seatsShowAttendees`          → `showAttendeeInfo`       (renamed)
 *   - `seatsShowAvailabilityCount`  → `showAvailabilityCount`  (renamed)
 *   - `seatsPerTimeSlot == null`    → `{ disabled: true }`     (disabled sentinel)
 *
 * Edge-case note: `seatsPerTimeSlot === 0` passes through to the enabled branch.
 * The API input schema enforces `@Min(1)`, so 0 should never appear in persisted data.
 * Using loose equality (`== null`) is intentional — it catches both `null` and `undefined`
 * while preserving any (hypothetical) zero value for upstream debugging rather than silently
 * converting it to disabled.
 *
 * This function is pure, synchronous, and side-effect-free. The (N+1)th attendee rejection
 * for group events is enforced upstream in the booking engine — this transformer only
 * serialises the seat configuration for API responses.
 */
export function transformSeatsInternalToApi(
  transformedSeats: SeatOptionsTransformedSchema | SeatOptionsDisabledSchema
): Seats_2024_06_14 | Disabled_2024_06_14 {
  // When seats are not configured (null/undefined), return the disabled sentinel.
  if (transformedSeats.seatsPerTimeSlot == null) {
    return {
      disabled: true,
    } satisfies Disabled_2024_06_14;
  }

  // Map internal field names to the v2024-06-14 API contract field names.
  return {
    seatsPerTimeSlot: transformedSeats.seatsPerTimeSlot,
    showAttendeeInfo: transformedSeats.seatsShowAttendees,
    showAvailabilityCount: transformedSeats.seatsShowAvailabilityCount,
  } satisfies Seats_2024_06_14;
}
