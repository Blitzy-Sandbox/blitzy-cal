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

  /**
   * Returns the managed event type template (parent) for a given team (AG-003).
   * Used to identify admin-templated event types that should be pushed to team members.
   * A managed event type template is an event type with `schedulingType = MANAGED`
   * that has a teamId and serves as the parent for child event types.
   *
   * @param teamId - The team ID to query managed templates for
   * @param eventTypeId - The specific managed parent event type ID
   * @returns The managed template with its configuration, or null if not found
   */
  findManagedEventTypeTemplate(
    teamId: number,
    eventTypeId: number
  ): Promise<{
    id: number;
    title: string;
    slug: string;
    schedulingType: "MANAGED" | null;
    teamId: number | null;
    assignAllTeamMembers: boolean;
    metadata: unknown;
  } | null>;

  /**
   * Returns all child event types for a managed parent event type (AG-003).
   * Used to determine which team members already have the managed event type
   * and which still need it pushed to them.
   *
   * @param parentEventTypeId - The parent managed event type ID
   * @returns Array of child event types with their owner user IDs
   */
  findChildEventTypesByParentId(
    parentEventTypeId: number
  ): Promise<
    Array<{
      id: number;
      userId: number | null;
      slug: string;
      hidden: boolean;
    }>
  >;

  /**
   * Returns all managed event type templates for a team (AG-003).
   * Used to list all admin-templated event types that can be pushed to members
   * when the team admin configures managed event type distribution.
   *
   * @param teamId - The team ID
   * @returns Array of managed event type templates with push configuration
   */
  findManagedEventTypesForTeam(
    teamId: number
  ): Promise<
    Array<{
      id: number;
      title: string;
      slug: string;
      assignAllTeamMembers: boolean;
      childCount: number;
    }>
  >;

  /**
   * Returns team members who do not yet have a child event type for a given
   * managed parent event type (AG-003). Used to identify which members need
   * the managed event type pushed to them during distribution.
   *
   * @param parentEventTypeId - The managed parent event type ID
   * @param teamId - The team ID to check memberships against
   * @returns Array of user IDs that lack a child of the given parent
   */
  findTeamMembersWithoutManagedEventType(
    parentEventTypeId: number,
    teamId: number
  ): Promise<Array<{ userId: number }>>;
}
