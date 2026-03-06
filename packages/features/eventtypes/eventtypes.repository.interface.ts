/**
 * EventTypes Repository Interface
 *
 * Central interface for EventType repository methods.
 */

export interface IEventTypesRepository {
  /**
   * @param eventTypeId - The event type to check
   * @returns Parent ID if this is a managed child event type, null otherwise
   */
  findParentEventTypeId(eventTypeId: number): Promise<number | null>;

  /**
   * Returns the seat configuration for a group event type (ET-002).
   * Used to verify that seatsPerTimeSlot is correctly configured and queryable
   * for group events where multiple attendees can book the same time slot.
   *
   * @param eventTypeId - The event type to query seat configuration for
   * @returns Seat configuration object if the event type exists, null otherwise
   */
  findSeatCountByEventTypeId(
    eventTypeId: number
  ): Promise<{ seatsPerTimeSlot: number | null } | null>;

  /**
   * Returns host assignment data with weight and priority for round-robin
   * distribution verification (ET-003). Exposes the host weights and priorities
   * needed to verify equitable round-robin distribution across hosts.
   *
   * @param eventTypeId - The event type to query host assignments for
   * @returns Array of host records with weight, priority, and schedule bindings
   */
  findHostsWithWeights(
    eventTypeId: number
  ): Promise<
    Array<{
      userId: number;
      isFixed: boolean;
      weight: number;
      priority: number;
      scheduleId: number | null;
    }>
  >;

  /**
   * Returns all fixed hosts for a collective event type (ET-004).
   * Used to verify mutual availability intersection — collective scheduling
   * requires all fixed hosts to be simultaneously available.
   *
   * @param eventTypeId - The event type to query fixed hosts for
   * @returns Array of host records indicating fixed-host status
   */
  findFixedHosts(
    eventTypeId: number
  ): Promise<Array<{ userId: number; isFixed: boolean }>>;

  /**
   * Returns the scheduling paradigm and seat configuration for an event type.
   * Supports paradigm-specific branching logic in services and guards by
   * identifying whether the event type is one-on-one (null), round-robin,
   * collective, or managed, and whether it uses seated (group) booking.
   *
   * @param eventTypeId - The event type to resolve scheduling type for
   * @returns Scheduling type and seat configuration if the event type exists, null otherwise
   */
  findSchedulingType(
    eventTypeId: number
  ): Promise<{
    schedulingType: "ROUND_ROBIN" | "COLLECTIVE" | "MANAGED" | null;
    seatsPerTimeSlot: number | null;
  } | null>;
}
