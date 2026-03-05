//import "server-only";
import type { LocationObject } from "@calcom/app-store/locations";
import { getLocationGroupedOptions } from "@calcom/app-store/server";
import { getEventTypeAppData } from "@calcom/app-store/utils";
import { eventTypeMetaDataSchemaWithTypedApps } from "@calcom/app-store/zod-utils";
import { getBookingFieldsWithSystemFields } from "@calcom/features/bookings/lib/getBookingFields";
import { getOrganizationRepository } from "@calcom/features/ee/organizations/di/OrganizationRepository.container";
import { getBookerBaseUrl } from "@calcom/features/ee/organizations/lib/getBookerUrlServer";
import { OrganizationRepository } from "@calcom/features/ee/organizations/repositories/OrganizationRepository";
import { EventTypeRepository } from "@calcom/features/eventtypes/repositories/eventTypeRepository";
import { UserRepository } from "@calcom/features/users/repositories/UserRepository";
import { WEBSITE_URL } from "@calcom/lib/constants";
import { getUserAvatarUrl } from "@calcom/lib/getAvatarUrl";
import { parseBookingLimit } from "@calcom/lib/intervalLimits/isBookingLimits";
import { parseDurationLimit } from "@calcom/lib/intervalLimits/isDurationLimits";
import { parseEventTypeColor } from "@calcom/lib/isEventTypeColor";
import { parseRecurringEvent } from "@calcom/lib/isRecurringEvent";
import { getTranslation } from "@calcom/lib/server/i18n";
import type { PrismaClient } from "@calcom/prisma";
import type { Prisma } from "@calcom/prisma/client";
import { MembershipRole, SchedulingType } from "@calcom/prisma/enums";
import { customInputSchema } from "@calcom/prisma/zod-utils";
import { TRPCError } from "@trpc/server";

interface getEventTypeByIdProps {
  eventTypeId: number;
  userId: number;
  prisma: PrismaClient;
  isTrpcCall?: boolean;
  isUserOrganizationAdmin: boolean;
  currentOrganizationId: number | null;
  userLocale?: string | null;
}

export type EventType = Awaited<ReturnType<typeof getEventTypeById>>;

/**
 * Central server-side helper that assembles enriched event type data for the tRPC layer.
 *
 * This function supports ALL 6 scheduling paradigms defined in Cal.com:
 *
 * 1. **One-on-One** (`schedulingType: null`): Default paradigm — single host paired with
 *    a single invitee. Host is resolved from `rawEventType.users[0]` with a fallback
 *    path (lines ~163-182) that fetches the requesting user if no explicit users are set.
 *
 * 2. **Group / Seated** (`seatsPerTimeSlot > 0`): Multiple attendees book the same time
 *    slot up to the seat limit. Fields `seatsPerTimeSlot`, `seatsShowAttendees`, and
 *    `seatsShowAvailabilityCount` are projected by `EventTypeRepository.findById` and
 *    preserved in the output via the `...restEventType` spread.
 *
 * 3. **Round-Robin** (`schedulingType: ROUND_ROBIN`): Equitable host distribution across
 *    team members. RR-specific fields — `isRRWeightsEnabled`, `rrSegmentQueryValue`,
 *    `assignRRMembersUsingSegment`, `rescheduleWithSameRoundRobinHost`,
 *    `includeNoShowInRRCalculation` — and per-host `priority`/`weight` data in the
 *    `hosts` relation are all projected and preserved via the spread.
 *
 * 4. **Collective** (`schedulingType: COLLECTIVE`): All fixed hosts must be simultaneously
 *    available. The `assignAllTeamMembers` flag and the team members list determine
 *    which hosts are required. Team member enrichment (lines ~80-87) decorates each
 *    member with their full profile for the UI.
 *
 * 5. **Managed** (`schedulingType: MANAGED`): Admin-defined templates propagated to child
 *    event types. Children are enriched (lines ~89-99) with profile data, and a special
 *    "members_default_location" option is injected into location options (lines ~205-216).
 *
 * 6. **Dynamic**: Multi-host link resolution is NOT handled here — it is resolved in
 *    `getPublicEvent.ts`. This function does not contain dynamic-event-specific logic.
 *
 * **Paradigm-Specific Fields Verified in Repository Projection:**
 * - ET-001 (1:1): `schedulingType`, `users`, `owner`, `schedule`
 * - ET-002 (Group): `seatsPerTimeSlot`, `seatsShowAttendees`, `seatsShowAvailabilityCount`
 * - ET-003 (RR): `isRRWeightsEnabled`, `rrSegmentQueryValue`, `assignRRMembersUsingSegment`,
 *   `rescheduleWithSameRoundRobinHost`, `includeNoShowInRRCalculation`, `hosts.priority`,
 *   `hosts.weight`, `hosts.groupId`
 * - ET-004 (Collective): `assignAllTeamMembers`, `team.members`
 * - ET-005 (Booking Windows): `periodType`, `periodDays`, `periodStartDate`, `periodEndDate`,
 *   `periodCountCalendarDays`, `minimumBookingNotice`, `beforeEventBuffer`, `afterEventBuffer`
 * - ET-006 (Custom Fields): `bookingFields`, `customInputs`
 *
 * @returns Enriched event type object with location options, team members, destination calendar,
 *          and current user membership. The return shape feeds into webhook payloads —
 *          do NOT alter without verifying backward compatibility.
 */
export const getEventTypeById = async ({
  currentOrganizationId,
  eventTypeId,
  userId,
  prisma,
  isTrpcCall = false,
  isUserOrganizationAdmin,
  userLocale,
}: getEventTypeByIdProps) => {
  const userSelect = {
    name: true,
    avatarUrl: true,
    username: true,
    id: true,
    email: true,
    locale: true,
    defaultScheduleId: true,
    isPlatformManaged: true,
    timeZone: true,
  } satisfies Prisma.UserSelect;

  const rawEventType = await getRawEventType({
    userId,
    eventTypeId,
    isUserOrganizationAdmin,
    currentOrganizationId,
    prisma,
  });

  if (!rawEventType) {
    if (isTrpcCall) {
      throw new TRPCError({ code: "NOT_FOUND" });
    } else {
      throw new Error("Event type not found");
    }
  }

  // Destructure locations (re-typed below as LocationObject[]) and metadata (re-parsed
  // via Zod) from the raw event type. All remaining fields — including all paradigm-specific
  // fields — are captured in `restEventType` and preserved via the spread in eventType assembly.
  const { locations, metadata, ...restEventType } = rawEventType;

  // Cross-paradigm: The metadata schema (eventTypeMetaDataSchemaWithTypedApps) is
  // paradigm-agnostic — it handles typed app metadata (e.g., Stripe, Giphy) regardless
  // of whether this is a 1:1, group, RR, collective, or managed event type. The .parse()
  // call validates and strips unknown keys, ensuring type safety downstream.
  const newMetadata = eventTypeMetaDataSchemaWithTypedApps.parse(metadata || {}) || {};
  const apps = newMetadata?.apps || {};
  const eventTypeWithParsedMetadata = { ...rawEventType, metadata: newMetadata };
  const userRepo = new UserRepository(prisma);

  // ET-003 (Round-Robin) & ET-004 (Collective): Enrich team members with full user profiles.
  // For RR events, the host weight/priority data lives on the `hosts` relation (not on members),
  // but team members are enriched here so the UI can display correct avatars, names, and roles.
  // For Collective events, all members listed here represent the fixed hosts whose mutual
  // availability must intersect to produce bookable slots.
  const eventTeamMembershipsWithUserProfile = [];
  for (const eventTeamMembership of rawEventType.team?.members || []) {
    eventTeamMembershipsWithUserProfile.push({
      ...eventTeamMembership,
      user: await userRepo.enrichUserWithItsProfile({
        user: eventTeamMembership.user,
      }),
    });
  }

  // Managed event type (SchedulingType.MANAGED): Enrich child event types with their
  // owner's profile data. Each child represents a propagated copy of the admin-defined
  // template event type assigned to a specific team member.
  const childrenWithUserProfile = [];
  for (const child of rawEventType.children || []) {
    childrenWithUserProfile.push({
      ...child,
      owner: child.owner
        ? await userRepo.enrichUserWithItsProfile({
            user: child.owner,
          })
        : null,
    });
  }

  // ET-001 (One-on-One): For 1:1 events (schedulingType === null), users[0] is the
  // single host. This enrichment ensures all event type users — regardless of paradigm —
  // have their full profile data (including organization profile) for avatar rendering
  // and booker URL resolution.
  const eventTypeUsersWithUserProfile = [];
  for (const eventTypeUser of rawEventType.users) {
    eventTypeUsersWithUserProfile.push(
      await userRepo.enrichUserWithItsProfile({
        user: eventTypeUser,
      })
    );
  }

  newMetadata.apps = {
    ...apps,
    giphy: getEventTypeAppData(eventTypeWithParsedMetadata, "giphy", true),
  };

  const parsedMetaData = newMetadata;

  const parsedCustomInputs = (rawEventType.customInputs || []).map((input) => customInputSchema.parse(input));

  // Assemble the enriched event type object. The `...restEventType` spread preserves ALL
  // paradigm-specific fields from the repository projection that are not explicitly
  // destructured above (i.e., everything except `locations` and `metadata`):
  //
  // - ET-002 (Group): seatsPerTimeSlot, seatsShowAttendees, seatsShowAvailabilityCount
  // - ET-003 (RR): isRRWeightsEnabled, rrSegmentQueryValue, assignRRMembersUsingSegment,
  //   rescheduleWithSameRoundRobinHost, includeNoShowInRRCalculation, hosts (with
  //   priority, weight, groupId, scheduleId, isFixed)
  // - ET-004 (Collective): assignAllTeamMembers
  // - ET-005 (Booking Windows): periodType, periodDays, periodStartDate, periodEndDate,
  //   periodCountCalendarDays, minimumBookingNotice, beforeEventBuffer, afterEventBuffer
  // - ET-006 (Custom Fields): bookingFields (reassembled below via getBookingFieldsWithSystemFields)
  //
  // Note: `locations` is re-typed as LocationObject[], `metadata` is re-parsed via Zod.
  const eventType = {
    ...restEventType,
    schedule:
      rawEventType.schedule?.id ||
      (!rawEventType.team ? rawEventType.users[0]?.defaultScheduleId : null) ||
      null,
    restrictionScheduleId: rawEventType.restrictionScheduleId || null,
    restrictionScheduleName: rawEventType.restrictionSchedule?.name || null,
    useBookerTimezone: rawEventType.useBookerTimezone || false,
    instantMeetingSchedule: rawEventType.instantMeetingSchedule?.id || null,
    scheduleName: rawEventType.schedule?.name || null,
    recurringEvent: parseRecurringEvent(restEventType.recurringEvent),
    bookingLimits: parseBookingLimit(restEventType.bookingLimits),
    durationLimits: parseDurationLimit(restEventType.durationLimits),
    eventTypeColor: parseEventTypeColor(restEventType.eventTypeColor),
    locations: locations as unknown as LocationObject[],
    metadata: parsedMetaData,
    customInputs: parsedCustomInputs,
    users: rawEventType.users,
    // Booker URL resolution — paradigm-aware:
    // - Team events (RR, Collective, Managed): Use the team's parent org URL
    // - 1:1 events with an owner: Use the current organization's URL
    // - Fallback: Use the global WEBSITE_URL (legacy 1:1 events without organization)
    bookerUrl: restEventType.team
      ? await getBookerBaseUrl(restEventType.team.parentId)
      : restEventType.owner
        ? await getBookerBaseUrl(currentOrganizationId)
        : WEBSITE_URL,
    // Managed event type: Map child event types to include owner avatar, membership
    // role, and the `created: true` flag. Children without owners are filtered out
    // via flatMap returning an empty array for null owners.
    children: childrenWithUserProfile.flatMap((ch) =>
      ch.owner !== null
        ? {
            ...ch,
            owner: {
              ...ch.owner,
              avatar: getUserAvatarUrl(ch.owner),
              email: ch.owner.email,
              name: ch.owner.name ?? "",
              username: ch.owner.username ?? "",
              membership:
                restEventType.team?.members.find((tm) => tm.user.id === ch.owner?.id)?.role ||
                MembershipRole.MEMBER,
            },
            created: true,
          }
        : []
    ),
  };

  // ET-001 (One-on-One) Fallback Path — Backward Compatibility:
  // When an event type has no explicitly associated users AND no team (i.e., a legacy 1:1
  // event type), we fall back to the requesting user as the host. This ensures older event
  // types created before the users[] relation was enforced still produce a valid host
  // assignment for the booking flow. The fallback user is pushed into eventType.users so
  // downstream code (avatar rendering, schedule resolution, booking creation) can always
  // rely on users[0] being the host for 1:1 events.
  if (eventType.users.length === 0 && !eventType.team) {
    const fallbackUser = await prisma.user.findUnique({
      where: {
        id: userId,
      },
      select: userSelect,
    });
    if (!fallbackUser) {
      if (isTrpcCall) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "The event type doesn't have user and no fallback user was found",
        });
      } else {
        throw Error("The event type doesn't have user and no fallback user was found");
      }
    }
    eventType.users.push(fallbackUser);
  }

  const eventTypeUsers: ((typeof eventType.users)[number] & { avatar: string })[] =
    eventTypeUsersWithUserProfile.map((user) => ({
      ...user,
      avatar: getUserAvatarUrl(user),
    }));

  const currentUser = eventType.users.find((u) => u.id === userId);

  const t = await getTranslation(userLocale ?? currentUser?.locale ?? "en", "common");

  if (!currentUser?.id && !eventType.teamId) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Could not find user or team",
    });
  }

  const locationOptions = await getLocationGroupedOptions(
    eventType.teamId ? { teamId: eventType.teamId } : { userId },
    t
  );
  // Managed event type (SchedulingType.MANAGED): Inject a special "Members Default Location"
  // option at the top of the location dropdown. This allows the admin-defined template to
  // specify that each child event type should use the individual team member's default
  // location, rather than a fixed location set on the parent template.
  if (eventType.schedulingType === SchedulingType.MANAGED) {
    locationOptions.splice(0, 0, {
      label: t("default"),
      options: [
        {
          label: t("members_default_location"),
          value: "",
          icon: "/user-check.svg",
        },
      ],
    });
  }

  // Cross-paradigm: Determine if this is an organization team event for booking field
  // system field injection. The `isOrgTeamEvent` flag affects which system fields
  // (e.g., reschedule reason) are included in the booking form.
  // ET-006 (Custom Fields): `getBookingFieldsWithSystemFields` normalizes the raw
  // `bookingFields` JSON from the database, merges system fields (name, email, guests,
  // notes, reschedule reason), and preserves all custom field types (text, radio,
  // checkbox, phone, dropdown) regardless of scheduling paradigm.
  // ET-005 (Booking Windows): `periodStartDate` and `periodEndDate` are serialized to
  // strings for JSON transport to the client — the original Date objects from Prisma
  // are not JSON-serializable.
  const isOrgTeamEvent = !!eventType?.teamId && !!eventType.team?.parentId;
  const eventTypeObject = Object.assign({}, eventType, {
    users: eventTypeUsers,
    periodStartDate: eventType.periodStartDate?.toString() ?? null,
    periodEndDate: eventType.periodEndDate?.toString() ?? null,
    bookingFields: getBookingFieldsWithSystemFields({ ...eventType, isOrgTeamEvent }),
  });

  // ET-003 (Round-Robin) & ET-004 (Collective): Build the team members list for the UI.
  // For organization events, all members (including not-yet-accepted) are included;
  // for standalone team events, only accepted members appear. This list represents the
  // full set of potential hosts for RR distribution or collective mutual-availability checks.
  const isOrgEventType = !!eventTypeObject.team?.parentId;
  const teamMembers = eventTypeObject.team
    ? eventTeamMembershipsWithUserProfile
        .filter((member) => member.accepted || isOrgEventType)
        .map((member) => {
          const user: typeof member.user & { avatar: string } = {
            ...member.user,
            avatar: getUserAvatarUrl(member.user),
          };
          return {
            ...user,
            profileId: user.profile.id,
            eventTypes: user.eventTypes.map((evTy) => evTy.slug),
            membership: member.role,
          };
        })
    : [];

  // Find the current users membership so we can check role to enable/disable deletion.
  // Sets to null if no membership is found - this must mean we are in a none team event type
  const currentUserMembership = eventTypeObject.team?.members.find((el) => el.user.id === userId) ?? null;

  let destinationCalendar = eventTypeObject.destinationCalendar;
  if (!destinationCalendar) {
    destinationCalendar = await prisma.destinationCalendar.findFirst({
      where: {
        userId: userId,
        eventTypeId: null,
      },
    });
  }

  const finalObj = {
    eventType: eventTypeObject,
    locationOptions,
    destinationCalendar,
    team: eventTypeObject.team || null,
    teamMembers,
    currentUserMembership,
    isUserOrganizationAdmin,
  };
  return finalObj;
};

/**
 * Fetches the raw (un-enriched) event type from the database via `EventTypeRepository`.
 *
 * The repository's `CompleteEventTypeSelect` projection includes ALL paradigm-specific
 * fields needed by the enrichment pipeline above. This function handles two access paths:
 *
 * 1. **Platform Organization Admin**: Can access any event type within their organization
 *    (including sub-team events) without being a team member — delegates to
 *    `findByIdForOrgAdmin`.
 * 2. **Regular User**: Can access event types they own, are a member of (via users[]),
 *    or belong to a team they are a member of — delegates to `findById`.
 *
 * Dynamic event types (multi-host links) are NOT resolved here; they use
 * `getPublicEvent.ts` which has its own resolution logic.
 */
export async function getRawEventType({
  userId,
  eventTypeId,
  isUserOrganizationAdmin,
  currentOrganizationId,
  prisma,
}: Omit<getEventTypeByIdProps, "isTrpcCall">) {
  const eventTypeRepo = new EventTypeRepository(prisma);
  const organizationRepo = getOrganizationRepository();
  const isUserInPlatformOrganization = currentOrganizationId
    ? !!(await organizationRepo.findById({ id: currentOrganizationId }))?.isPlatform
    : false;

  if (isUserOrganizationAdmin && currentOrganizationId && isUserInPlatformOrganization) {
    // Platform Organization Admin can access any event of the organization even without being a member of the sub-teams
    return await eventTypeRepo.findByIdForOrgAdmin({
      id: eventTypeId,
      organizationId: currentOrganizationId,
    });
  }

  // Regular(Non Platform) Organization member(admin/non-admin) can access any event-type they are are a member of including sub-team events and Regular Team(non-subteam) events.
  // Remember an organization member can stay a part of Regular Team still if  that team hasn't been moved to the organization yet.
  return await eventTypeRepo.findById({
    id: eventTypeId,
    userId,
  });
}

export default getEventTypeById;
