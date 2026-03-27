import type {
  CreateEventTypeInput_2024_06_14,
  SeatOptionsTransformedSchema,
  SeatOptionsDisabledSchema,
} from "@calcom/platform-types";

/**
 * Transforms seat configuration from the public API schema into the internal
 * Cal.com event-type schema used by the group-event booking engine.
 *
 * ET-002 (Group Event Parity): This transformer is the API v2 entry point for
 * configuring seated (group) events. It passes through the seat limit and
 * visibility flags without enforcing capacity — the booking engine handles
 * (N+1)th attendee rejection at booking time.
 *
 * Property mapping:
 *  - API `seatsPerTimeSlot`      → Internal `seatsPerTimeSlot`      (numeric seat cap per slot)
 *  - API `showAttendeeInfo`      → Internal `seatsShowAttendees`    (attendee visibility toggle)
 *  - API `showAvailabilityCount` → Internal `seatsShowAvailabilityCount` (remaining seats visibility)
 *  - API `disabled` / absent     → Internal `{ seatsPerTimeSlot: null }` (one-on-one / no group booking)
 */
export function transformSeatsApiToInternal(
  inputSeats: CreateEventTypeInput_2024_06_14["seats"]
): SeatOptionsTransformedSchema | SeatOptionsDisabledSchema {
  // Disabled path: null/undefined input or explicitly disabled seats
  // returns the internal representation for "no group booking" (one-on-one events).
  if (!inputSeats || inputSeats.disabled)
    return {
      seatsPerTimeSlot: null,
    } satisfies SeatOptionsDisabledSchema;

  // Enabled path: pass through seat limit and visibility flags.
  // Note: seatsPerTimeSlot accepts any positive integer here — input validation
  // (@Min(1), @Max(MAX_SEATS_PER_TIME_SLOT)) is enforced by the DTO layer.
  return {
    seatsPerTimeSlot: inputSeats.seatsPerTimeSlot,
    seatsShowAttendees: inputSeats.showAttendeeInfo,
    seatsShowAvailabilityCount: inputSeats.showAvailabilityCount,
  } satisfies SeatOptionsTransformedSchema;
}
