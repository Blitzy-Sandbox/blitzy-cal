/**
 * Update Event Type Handler (Heavy Router)
 *
 * This is the MOST COMPLEX handler in the viewer event types tRPC surface — the single source
 * of truth for ALL paradigm-specific field updates. The create handler sets minimal fields,
 * and all paradigm customization happens here via the create → update two-step pattern.
 *
 * ## Sprint 2 Paradigm Coverage (ET-001 through ET-006)
 *
 * ### ET-001 — 1:1 Event Types
 * Default paradigm when `schedulingType` is null. No special handling needed — the base
 * update flow covers all 1:1 configuration (title, description, locations, duration).
 *
 * ### ET-002 — Group Events (Seats)
 * - `seatsPerTimeSlot` (in input destructuring, event type select, and `data` assembly):
 *   Controls max attendees per time slot. When non-null, enables group event behavior.
 * - Mutual exclusion: seats and recurring events cannot coexist (in the seats+recurring validation block).
 * - Seat visibility: `seatsShowAttendees` and `seatsShowAvailabilityCount` via `...rest`.
 *
 * ### ET-003 — Round-Robin Distribution
 * - `isRRWeightsEnabled` (in input destructuring, event type select, and `data` assembly):
 *   Toggles weighted vs. equal distribution among RR hosts.
 * - `rrSegmentQueryValue` (in `data` assembly): RAQB filter for segment-based RR assignment.
 * - Host weight/priority handling (in the host assignment section): Each host gets `priority` (0-4, app default 2)
 *   and `weight` (min 0, app default 100) for equitable distribution.
 * - `hostGroups` CRUD (in the host groups transaction block): Group-based RR assignment.
 * - `isFixed` check (in host create/update mappings): Forces `isFixed=true` for COLLECTIVE scheduling type.
 * - `maxLeadThreshold` (in `data` assembly): Disabled when load balancing is off.
 * - Load balancing disabled check (in the `isLoadBalancingDisabled` computation): Based on `rrTimestampBasis` and multiple host groups.
 *
 * ### ET-004 — Collective Scheduling
 * - `assignAllTeamMembers` (in input destructuring, and the assign-all-members section):
 *   Auto-assigns all team members as fixed hosts for collective events.
 * - `isFixed` forced true (in host create/update mappings): All hosts in COLLECTIVE type are fixed (must all be available).
 *
 * ### ET-005 — Booking Windows
 * - `periodType` (in input destructuring, and `data` assembly via `handlePeriodType()`):
 *   Mapped via `handlePeriodType()` from ../util.ts to PeriodType enum values:
 *   UNLIMITED → indefinitely, ROLLING → calendar days, ROLLING_WINDOW → business days, RANGE → date range.
 * - `periodStartDate`, `periodEndDate`, `periodDays`, `periodCountCalendarDays` via `...rest`.
 * - `minimumBookingNotice` via `...rest`.
 * - `bookingLimits` and `durationLimits` validation (in the interval limits validation block).
 *
 * ### ET-006 — Custom Fields/Questions
 * - `bookingFields` (in input destructuring, validated via `ensureUniqueBookingFields()` and
 *   `ensureEmailOrPhoneNumberIsPresent()`, and included in `data` assembly):
 *   JSON array of booking form fields. Supports all Calendly types:
 *   text, radio, checkbox, phone, select/dropdown.
 * - `customInputs` (in input destructuring, handled via `handleCustomInputs()` from ../util.ts):
 *   Legacy custom input system — CRUD operations batched in the Prisma update.
 *
 * @see {@link packages/trpc/server/routers/viewer/eventTypes/util.ts} for handlePeriodType, ensureUniqueBookingFields, ensureEmailOrPhoneNumberIsPresent, handleCustomInputs
 * @see {@link packages/features/eventtypes/lib/types.ts} for EventTypeUpdateInput type definition
 * @module
 */
import type { NextApiResponse, GetServerSidePropsContext } from "next";

import type { appDataSchemas } from "@calcom/app-store/apps.schemas.generated";
import { DailyLocationType } from "@calcom/app-store/constants";
import { eventTypeAppMetadataOptionalSchema } from "@calcom/app-store/zod-utils";
import { CalVideoSettingsRepository } from "@calcom/features/calVideoSettings/repositories/CalVideoSettingsRepository";
import updateChildrenEventTypes from "@calcom/features/ee/managed-event-types/lib/handleChildrenEventTypes";
import {
  allowDisablingAttendeeConfirmationEmails,
  allowDisablingHostConfirmationEmails,
} from "@calcom/features/ee/workflows/lib/allowDisablingStandardEmails";
import { isUrlScanningEnabled } from "@calcom/features/ee/workflows/lib/urlScanner";
import { HashedLinkRepository } from "@calcom/features/hashedLink/lib/repository/HashedLinkRepository";
import { HashedLinkService } from "@calcom/features/hashedLink/lib/service/HashedLinkService";
import { MembershipRepository } from "@calcom/features/membership/repositories/MembershipRepository";
import { ScheduleRepository } from "@calcom/features/schedules/repositories/ScheduleRepository";
import tasker from "@calcom/features/tasker";
import { submitUrlForUrlScanning } from "@calcom/features/tasker/tasks/scanWorkflowUrls";
import { validateIntervalLimitOrder } from "@calcom/lib/intervalLimits/validateIntervalLimitOrder";
import logger from "@calcom/lib/logger";
import { getTranslation } from "@calcom/lib/server/i18n";
import { validateBookerLayouts } from "@calcom/lib/validateBookerLayouts";
import type { PrismaClient } from "@calcom/prisma";
import { Prisma } from "@calcom/prisma/client";
import {
  WorkflowTriggerEvents,
  SchedulingType,
  EventTypeAutoTranslatedField,
  RRTimestampBasis,
} from "@calcom/prisma/enums";
import { eventTypeLocations } from "@calcom/prisma/zod-utils";

import { TRPCError } from "@trpc/server";

import type { TrpcSessionUser } from "../../../../types";
import { setDestinationCalendarHandler } from "../../../viewer/calendars/setDestinationCalendar.handler";
import {
  ensureUniqueBookingFields,
  ensureEmailOrPhoneNumberIsPresent,
  handleCustomInputs,
  handlePeriodType,
} from "../util";
import type { TUpdateInputSchema } from "./update.schema";

type SessionUser = NonNullable<TrpcSessionUser>;

type User = {
  id: SessionUser["id"];
  username: SessionUser["username"];
  profile: {
    id: SessionUser["profile"]["id"] | null;
  };
  userLevelSelectedCalendars: SessionUser["userLevelSelectedCalendars"];
  organizationId: number | null;
  email: SessionUser["email"];
  locale: string;
};

type UpdateOptions = {
  ctx: {
    user: User;
    res?: NextApiResponse | GetServerSidePropsContext["res"];
    prisma: PrismaClient;
  };
  input: TUpdateInputSchema;
};

export type UpdateEventTypeReturn = Awaited<ReturnType<typeof updateHandler>>;

export const updateHandler = async ({ ctx, input }: UpdateOptions) => {
  // === Input Destructuring ===
  // All paradigm-specific fields are destructured here. Key paradigm fields:
  // - ET-002 (Group): seatsPerTimeSlot
  // - ET-003 (Round-Robin): isRRWeightsEnabled, hosts, hostGroups
  // - ET-004 (Collective): assignAllTeamMembers
  // - ET-005 (Booking Windows): periodType
  // - ET-006 (Custom Fields): bookingFields, customInputs
  const {
    schedule,
    instantMeetingSchedule,
    periodType,
    locations,
    bookingLimits,
    durationLimits,
    maxActiveBookingsPerBooker,
    destinationCalendar,
    customInputs,
    recurringEvent,
    eventTypeColor,
    users,
    children,
    assignAllTeamMembers,
    hosts,
    id,
    multiplePrivateLinks,
    // Extract this from the input so it doesn't get saved in the db
    // eslint-disable-next-line
    userId,
    bookingFields,
    offsetStart,
    secondaryEmailId,
    aiPhoneCallConfig,
    isRRWeightsEnabled,
    autoTranslateDescriptionEnabled,
    autoTranslateInstantMeetingTitleEnabled,
    description: newDescription,
    title: newTitle,
    // ET-002 (Group Events): max attendees per time slot. null = non-seated event.
    seatsPerTimeSlot,
    restrictionScheduleId,
    calVideoSettings,
    hostGroups,
    enablePerHostLocations,
    ...rest
  } = input;

  // Fetch current event type state — select includes paradigm-relevant fields for validation:
  // - seatsPerTimeSlot (ET-002): needed for seats+recurring mutual exclusion check
  // - isRRWeightsEnabled (ET-003): current RR weight toggle state
  // - hosts with priority/weight/isFixed (ET-003/ET-004): current host configuration
  // - hostGroups (ET-003): current RR group structure
  // - team.rrTimestampBasis (ET-003): RR fairness timestamp basis
  const eventType = await ctx.prisma.eventType.findUniqueOrThrow({
    where: { id },
    select: {
      title: true,
      locations: true,
      description: true,
      seatsPerTimeSlot: true,
      recurringEvent: true,
      maxActiveBookingsPerBooker: true,
      fieldTranslations: {
        select: {
          field: true,
        },
      },
      isRRWeightsEnabled: true,
      hosts: {
        select: {
          userId: true,
          priority: true,
          weight: true,
          isFixed: true,
        },
      },
      aiPhoneCallConfig: {
        select: {
          generalPrompt: true,
          beginMessage: true,
          enabled: true,
          llmId: true,
        },
      },
      calVideoSettings: {
        select: {
          disableRecordingForOrganizer: true,
          disableRecordingForGuests: true,
          enableAutomaticTranscription: true,
          enableAutomaticRecordingForOrganizer: true,
          requireEmailForGuests: true,
          disableTranscriptionForGuests: true,
          disableTranscriptionForOrganizer: true,
          redirectUrlOnExit: true,
        },
      },
      children: {
        select: {
          userId: true,
        },
      },
      workflows: {
        select: {
          workflowId: true,
        },
      },
      hostGroups: {
        select: {
          id: true,
          name: true,
        },
      },
      team: {
        select: {
          id: true,
          name: true,
          slug: true,
          parentId: true,
          rrTimestampBasis: true,
          parent: {
            select: {
              slug: true,
            },
          },
          members: {
            select: {
              role: true,
              accepted: true,
              user: {
                select: {
                  name: true,
                  id: true,
                  email: true,
                  eventTypes: {
                    select: {
                      slug: true,
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  if (input.teamId && eventType.team?.id && input.teamId !== eventType.team.id) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }

  // ET-002 (Group Events) validation: seated events (seatsPerTimeSlot > 0) and recurring events
  // are mutually exclusive. This matches Calendly's behavior where group events cannot recur.
  const finalSeatsPerTimeSlot =
    seatsPerTimeSlot === undefined ? eventType.seatsPerTimeSlot : seatsPerTimeSlot;
  const finalRecurringEvent = recurringEvent === undefined ? eventType.recurringEvent : recurringEvent;

  if (finalSeatsPerTimeSlot && finalRecurringEvent) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Recurring Events and Offer Seats cannot be active at the same time.",
    });
  }

  const teamId = input.teamId || eventType.team?.id;
  const guestsField = bookingFields?.find((field) => field.name === "guests");

  // ET-006 (Custom Fields) validation:
  // - ensureUniqueBookingFields: prevents duplicate field names across ALL field types
  //   (text, radio, checkbox, phone, select/dropdown, and Cal.com extras)
  // - ensureEmailOrPhoneNumberIsPresent: ensures at least one contact method is required,
  //   matching Calendly's requirement for invitee contact information
  ensureUniqueBookingFields(bookingFields);
  ensureEmailOrPhoneNumberIsPresent(bookingFields);

  if (autoTranslateDescriptionEnabled && !ctx.user.organizationId) {
    logger.error(
      "Auto-translating description requires an organization. This should not happen - UI controls should prevent this state."
    );
  }

  // ET-003 (Round-Robin) load balancing: disabled when rrTimestampBasis is not CREATED_AT
  // or when multiple host groups exist. This affects maxLeadThreshold calculation.
  const isLoadBalancingDisabled = !!(
    (eventType.team?.rrTimestampBasis && eventType.team?.rrTimestampBasis !== RRTimestampBasis.CREATED_AT) ||
    (hostGroups && hostGroups.length > 1) ||
    (!hostGroups && eventType.hostGroups && eventType.hostGroups.length > 1)
  );

  // === Build Prisma Update Payload ===
  // Paradigm-specific fields in the update payload:
  // - bookingFields (ET-006): JSON array, null → Prisma.DbNull
  // - isRRWeightsEnabled (ET-003): boolean toggle for weighted distribution
  // - rrSegmentQueryValue (ET-003): RAQB filter for segment-based RR, null → Prisma.DbNull
  // - seatsPerTimeSlot (ET-002): integer or null for group events
  // - maxLeadThreshold (ET-003): null when load balancing disabled
  const data: Prisma.EventTypeUpdateInput = {
    ...rest,
    // Only update autoTranslateInstantMeetingTitleEnabled when explicitly provided to avoid overwriting saved opt-out
    ...(autoTranslateInstantMeetingTitleEnabled !== undefined && { autoTranslateInstantMeetingTitleEnabled }),
    // Only set if explicitly provided to avoid overwriting existing value with false
    ...(autoTranslateDescriptionEnabled !== undefined && {
      autoTranslateDescriptionEnabled: Boolean(ctx.user.organizationId && autoTranslateDescriptionEnabled),
    }),
    description: newDescription,
    title: newTitle,
    bookingFields:
      bookingFields === null ? Prisma.DbNull : (bookingFields as Prisma.InputJsonValue | undefined),
    maxActiveBookingsPerBooker,
    isRRWeightsEnabled,
    rrSegmentQueryValue:
      rest.rrSegmentQueryValue === null ? Prisma.DbNull : (rest.rrSegmentQueryValue as Prisma.InputJsonValue),
    metadata: rest.metadata === null ? Prisma.DbNull : (rest.metadata as Prisma.InputJsonObject),
    eventTypeColor: eventTypeColor === null ? Prisma.DbNull : (eventTypeColor as Prisma.InputJsonObject),
    // Only set disableGuests if bookingFields is explicitly provided to avoid overwriting existing value
    ...(bookingFields !== undefined && {
      disableGuests: guestsField?.hidden ?? false,
    }),
    seatsPerTimeSlot,
    maxLeadThreshold: isLoadBalancingDisabled ? null : rest.maxLeadThreshold,
    ...(enablePerHostLocations !== undefined && { enablePerHostLocations }),
  };
  data.locations = locations ?? undefined;

  // ET-005 (Booking Windows): Maps string periodType to PeriodType enum via handlePeriodType().
  // Calendly equivalents: UNLIMITED→indefinitely, ROLLING→calendar days,
  // ROLLING_WINDOW→business days (AVL-GAP-001), RANGE→date range
  if (periodType) {
    data.periodType = handlePeriodType(periodType);
  }

  if (recurringEvent) {
    data.recurringEvent = {
      dstart: recurringEvent.dtstart as unknown as Prisma.InputJsonObject,
      interval: recurringEvent.interval,
      count: recurringEvent.count,
      freq: recurringEvent.freq,
      until: recurringEvent.until as unknown as Prisma.InputJsonObject,
      tzid: recurringEvent.tzid,
    };
  } else if (recurringEvent === null) {
    data.recurringEvent = Prisma.DbNull;
  }

  if (destinationCalendar) {
    /** We connect or create a destination calendar to the event type instead of the user */
    await setDestinationCalendarHandler({
      ctx,
      input: {
        ...destinationCalendar,
        eventTypeId: id,
      },
    });
  }

  // ET-006 (Custom Fields — Legacy): handleCustomInputs() performs CRUD for the legacy
  // custom input system (predecessor to bookingFields). Supports all Calendly question types.
  if (customInputs) {
    data.customInputs = handleCustomInputs(customInputs, id);
  }

  if (bookingLimits) {
    const isValid = validateIntervalLimitOrder(bookingLimits);
    if (!isValid)
      throw new TRPCError({ code: "BAD_REQUEST", message: "Booking limits must be in ascending order." });
    data.bookingLimits = bookingLimits;
  }

  if (maxActiveBookingsPerBooker) {
    if (maxActiveBookingsPerBooker && maxActiveBookingsPerBooker < 1) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Booker booking limit must be greater than 0." });
    }

    if (maxActiveBookingsPerBooker && (recurringEvent || eventType.recurringEvent)) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Recurring Events and booker active bookings limit cannot be active at the same time.",
      });
    }

    if (eventType.maxActiveBookingsPerBooker && recurringEvent) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Recurring Events and booker active bookings limit cannot be active at the same time.",
      });
    }

    data.maxActiveBookingsPerBooker = maxActiveBookingsPerBooker;
  }

  if (durationLimits) {
    const isValid = validateIntervalLimitOrder(durationLimits);
    if (!isValid)
      throw new TRPCError({ code: "BAD_REQUEST", message: "Duration limits must be in ascending order." });
    data.durationLimits = durationLimits;
  }

  if (offsetStart !== undefined) {
    if (offsetStart < 0) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Offset start time must be zero or greater." });
    }
    data.offsetStart = offsetStart;
  }

  const bookerLayoutsError = validateBookerLayouts(input.metadata?.bookerLayouts || null);
  if (bookerLayoutsError) {
    const t = await getTranslation("en", "common");
    throw new TRPCError({ code: "BAD_REQUEST", message: t(bookerLayoutsError) });
  }

  if (schedule) {
    // Check that the schedule belongs to the user
    const userScheduleQuery = await ctx.prisma.schedule.findFirst({
      where: {
        userId: ctx.user.id,
        id: schedule,
      },
    });
    if (userScheduleQuery) {
      data.schedule = {
        connect: {
          id: schedule,
        },
      };
    }
  }
  // allows unsetting a schedule through { schedule: null, ... }
  else if (null === schedule || schedule === 0) {
    data.schedule = {
      disconnect: true,
    };
  }

  if (instantMeetingSchedule) {
    data.instantMeetingSchedule = {
      connect: {
        id: instantMeetingSchedule,
      },
    };
  } else if (schedule === null) {
    data.instantMeetingSchedule = {
      disconnect: true,
    };
  }

  const membershipRepo = new MembershipRepository(ctx.prisma);

  if (restrictionScheduleId) {
    // Verify that the user owns the restriction schedule or is a team member
    const scheduleRepo = new ScheduleRepository(ctx.prisma);
    const restrictionSchedule = await scheduleRepo.findScheduleByIdForOwnershipCheck({
      scheduleId: restrictionScheduleId,
    });
    // If the user doesn't own the schedule, check if they're a team member
    if (restrictionSchedule?.userId !== ctx.user.id) {
      if (!teamId || !restrictionSchedule) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "The restriction schedule is not owned by you or your team",
        });
      }
      const hasMembership = await membershipRepo.hasMembership({
        teamId,
        userId: restrictionSchedule.userId,
      });
      if (!hasMembership) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "The restriction schedule is not owned by you or your team",
        });
      }
    }

    data.restrictionSchedule = {
      connect: {
        id: restrictionScheduleId,
      },
    };
  } else if (restrictionScheduleId === null || restrictionScheduleId === 0) {
    data.restrictionSchedule = {
      disconnect: true,
    };
  }

  if (users?.length) {
    data.users = {
      set: [],
      connect: users.map((userId: number) => ({ id: userId })),
    };
  }

  // ET-003 (Round-Robin) host groups: Full CRUD for group-based RR assignment.
  // Groups allow segmenting hosts for different distribution pools.
  // Handle hostGroups updates
  if (hostGroups !== undefined) {
    const existingHostGroups = await ctx.prisma.hostGroup.findMany({
      where: {
        eventTypeId: id,
      },
      select: {
        id: true,
        name: true,
      },
    });

    const existingGroupsMap = new Map(existingHostGroups.map((group) => [group.id, group]));
    const newGroupsMap = new Map(hostGroups.map((group) => [group.id, group]));

    const groupsToCreate = hostGroups.filter((group) => !existingGroupsMap.has(group.id));
    const groupsToUpdate = hostGroups.filter((group) => existingGroupsMap.has(group.id));
    const groupsToDelete = existingHostGroups.filter((existingGroup) => !newGroupsMap.has(existingGroup.id));

    await ctx.prisma.$transaction(async (tx) => {
      // Create new groups
      if (groupsToCreate.length > 0) {
        await tx.hostGroup.createMany({
          data: groupsToCreate.map((group) => ({
            id: group.id,
            name: group.name,
            eventTypeId: id,
          })),
        });
      }

      // Update existing groups
      for (const group of groupsToUpdate) {
        await tx.hostGroup.update({
          where: { id: group.id },
          data: { name: group.name },
        });
      }

      // Delete groups that are no longer in the new list
      if (groupsToDelete.length > 0) {
        await tx.hostGroup.deleteMany({
          where: {
            id: {
              in: groupsToDelete.map((group) => group.id),
            },
          },
        });
      }
    });
  }

  let hostLocationDeletions: { userId: number; eventTypeId: number }[] = [];

  // === Host Assignment (ET-003 Round-Robin / ET-004 Collective) ===
  // Handles create/update/delete of hosts with paradigm-specific properties:
  // - isFixed: forced true for COLLECTIVE (all hosts must be available) — see host create/update mappings below
  // - priority: 0-4 scale for RR ordering (app default 2 = middle) — see host create/update mappings below
  // - weight: relative weight for weighted RR distribution (app default 100) — see host create/update mappings below
  // - groupId: RR group assignment for group-based distribution — see host create/update mappings below
  // - scheduleId: per-host schedule override — see host create/update mappings below
  if (teamId && hosts) {
    // check if all hosts can be assigned (memberships that have accepted invite)
    const teamMemberIds = await membershipRepo.listAcceptedTeamMemberIds({ teamId });
    // guard against missing IDs, this may mean a member has just been removed
    // or this request was forged.
    // we let this pass through on organization sub-teams
    if (!hosts.every((host) => teamMemberIds.includes(host.userId)) && !eventType.team?.parentId) {
      throw new TRPCError({
        code: "FORBIDDEN",
      });
    }

    const oldHostsSet = new Set(eventType.hosts.map((oldHost) => oldHost.userId));
    const newHostsSet = new Set(hosts.map((oldHost) => oldHost.userId));

    const existingHosts = hosts.filter((newHost) => oldHostsSet.has(newHost.userId));
    hostLocationDeletions = existingHosts
      .filter((host) => host.location === null)
      .map((host) => ({ userId: host.userId, eventTypeId: id }));
    const newHosts = hosts.filter((newHost) => !oldHostsSet.has(newHost.userId));
    const removedHosts = eventType.hosts.filter((oldHost) => !newHostsSet.has(oldHost.userId));

    data.hosts = {
      deleteMany: {
        OR: removedHosts.map((host) => ({
          userId: host.userId,
          eventTypeId: id,
        })),
      },
      create: newHosts.map((host) => {
        const hostData: {
          userId: number;
          isFixed: boolean;
          priority: number;
          weight: number;
          groupId: string | null | undefined;
          scheduleId?: number | null | undefined;
          location?: {
            create: {
              type: string;
              credentialId: number | null | undefined;
              link: string | null | undefined;
              address: string | null | undefined;
              phoneNumber: string | null | undefined;
            };
          };
        } = {
          userId: host.userId,
          isFixed: data.schedulingType === SchedulingType.COLLECTIVE || host.isFixed || false,
          priority: host.priority ?? 2,
          weight: host.weight ?? 100,
          groupId: host.groupId,
          scheduleId: host.scheduleId ?? null,
        };
        if (host.location) {
          hostData.location = {
            create: {
              type: host.location.type,
              credentialId: host.location.credentialId,
              link: host.location.link,
              address: host.location.address,
              phoneNumber: host.location.phoneNumber,
            },
          };
        }
        return hostData;
      }),
      update: existingHosts.map((host) => {
        const updateData: {
          isFixed: boolean | undefined;
          priority: number;
          weight: number;
          scheduleId: number | null | undefined;
          groupId: string | null | undefined;
          location?: {
            upsert: {
              create: {
                type: string;
                credentialId: number | null | undefined;
                link: string | null | undefined;
                address: string | null | undefined;
                phoneNumber: string | null | undefined;
              };
              update: {
                type: string;
                credentialId: number | null | undefined;
                link: string | null | undefined;
                address: string | null | undefined;
                phoneNumber: string | null | undefined;
              };
            };
          };
        } = {
          isFixed: data.schedulingType === SchedulingType.COLLECTIVE || host.isFixed,
          priority: host.priority ?? 2,
          weight: host.weight ?? 100,
          scheduleId: host.scheduleId === undefined ? undefined : host.scheduleId,
          groupId: host.groupId,
        };
        if (host.location) {
          updateData.location = {
            upsert: {
              create: {
                type: host.location.type,
                credentialId: host.location.credentialId,
                link: host.location.link,
                address: host.location.address,
                phoneNumber: host.location.phoneNumber,
              },
              update: {
                type: host.location.type,
                credentialId: host.location.credentialId,
                link: host.location.link,
                address: host.location.address,
                phoneNumber: host.location.phoneNumber,
              },
            },
          };
        }
        return {
          where: {
            userId_eventTypeId: {
              userId: host.userId,
              eventTypeId: id,
            },
          },
          data: updateData,
        };
      }),
    };
  }

  if (input.metadata?.disableStandardEmails?.all) {
    if (!eventType?.team?.parentId) {
      input.metadata.disableStandardEmails.all.host = false;
      input.metadata.disableStandardEmails.all.attendee = false;
    }
  }

  if (input.metadata?.disableStandardEmails?.confirmation) {
    //check if user is allowed to disabled standard emails
    const workflows = await ctx.prisma.workflow.findMany({
      where: {
        activeOn: {
          some: {
            eventTypeId: input.id,
          },
        },
        trigger: WorkflowTriggerEvents.NEW_EVENT,
      },
      include: {
        steps: {
          select: {
            action: true,
          },
        },
      },
    });

    if (input.metadata?.disableStandardEmails.confirmation?.host) {
      if (!allowDisablingHostConfirmationEmails(workflows)) {
        input.metadata.disableStandardEmails.confirmation.host = false;
      }
    }

    if (input.metadata?.disableStandardEmails.confirmation?.attendee) {
      if (!allowDisablingAttendeeConfirmationEmails(workflows)) {
        input.metadata.disableStandardEmails.confirmation.attendee = false;
      }
    }
  }

  const apps = eventTypeAppMetadataOptionalSchema.parse(input.metadata?.apps);
  for (const appKey in apps) {
    const app = apps[appKey as keyof typeof appDataSchemas];
    // There should only be one enabled payment app in the metadata
    if (app.enabled && app.price && app.currency) {
      data.price = app.price;
      data.currency = app.currency;
      break;
    }
  }
  console.log("multiplePrivateLinks", multiplePrivateLinks);
  // Handle multiple private links using the service
  const privateLinksRepo = HashedLinkRepository.create();
  const connectedLinks = await privateLinksRepo.findLinksByEventTypeId(input.id);
  console.log("connectedLinks", connectedLinks);
  const connectedMultiplePrivateLinks = connectedLinks.map((link) => link.link);

  const privateLinksService = new HashedLinkService();
  await privateLinksService.handleMultiplePrivateLinks({
    eventTypeId: input.id,
    multiplePrivateLinks,
    connectedMultiplePrivateLinks,
  });

  // ET-004 (Collective): assignAllTeamMembers auto-assigns all team members as fixed hosts.
  // When true, all accepted team members are automatically included in collective scheduling.
  if (assignAllTeamMembers !== undefined) {
    data.assignAllTeamMembers = assignAllTeamMembers;
  }

  // Validate the secondary email
  if (secondaryEmailId) {
    const secondaryEmail = await ctx.prisma.secondaryEmail.findUnique({
      where: {
        id: secondaryEmailId,
        userId: ctx.user.id,
      },
    });
    // Make sure the secondary email id belongs to the current user and its a verified one
    if (secondaryEmail?.emailVerified) {
      data.secondaryEmail = {
        connect: {
          id: secondaryEmailId,
        },
      };
      // Delete the data if the user selected his original email to send the events to, which means the value coming will be -1
    } else if (secondaryEmailId === -1) {
      data.secondaryEmail = {
        disconnect: true,
      };
    }
  }

  if (aiPhoneCallConfig) {
    if (aiPhoneCallConfig.enabled) {
      await ctx.prisma.aIPhoneCallConfiguration.upsert({
        where: {
          eventTypeId: id,
        },
        update: {
          ...aiPhoneCallConfig,
          guestEmail: aiPhoneCallConfig?.guestEmail ? aiPhoneCallConfig.guestEmail : null,
          guestCompany: aiPhoneCallConfig?.guestCompany ? aiPhoneCallConfig.guestCompany : null,
        },
        create: {
          ...aiPhoneCallConfig,
          guestEmail: aiPhoneCallConfig?.guestEmail ? aiPhoneCallConfig.guestEmail : null,
          guestCompany: aiPhoneCallConfig?.guestCompany ? aiPhoneCallConfig.guestCompany : null,
          eventTypeId: id,
        },
      });
    } else if (!aiPhoneCallConfig.enabled && eventType.aiPhoneCallConfig) {
      await ctx.prisma.aIPhoneCallConfiguration.delete({
        where: {
          eventTypeId: id,
        },
      });
    }
  }

  if (calVideoSettings) {
    await CalVideoSettingsRepository.createOrUpdateCalVideoSettings({
      eventTypeId: id,
      calVideoSettings,
    });
  }

  const parsedEventTypeLocations = eventTypeLocations.safeParse(eventType.locations ?? []);

  const isCalVideoLocationActive = locations
    ? locations.some((location) => location.type === DailyLocationType)
    : parsedEventTypeLocations.success &&
      parsedEventTypeLocations.data?.some((location) => location.type === DailyLocationType);

  if (eventType.calVideoSettings && !isCalVideoLocationActive) {
    await CalVideoSettingsRepository.deleteCalVideoSettings(id);
  }

  // Logic for updating `fieldTranslations`
  // user has no translations OR user is changing the field
  const hasNoDescriptionTranslations =
    eventType.fieldTranslations.filter((trans) => trans.field === EventTypeAutoTranslatedField.DESCRIPTION)
      .length === 0;
  const description = newDescription ?? (hasNoDescriptionTranslations ? eventType.description : undefined);
  const hasNoTitleTranslations =
    eventType.fieldTranslations.filter((trans) => trans.field === EventTypeAutoTranslatedField.TITLE)
      .length === 0;
  const title = newTitle ?? (hasNoTitleTranslations ? eventType.title : undefined);

  if (ctx.user.organizationId && autoTranslateDescriptionEnabled && (title || description)) {
    await tasker.create("translateEventTypeData", {
      eventTypeId: id,
      description,
      title,
      userLocale: ctx.user.locale,
      userId: ctx.user.id,
    });
  }

  const updatedEventTypeSelect = {
    slug: true,
    schedulingType: true,
  } satisfies Prisma.EventTypeSelect;

  // Explicit type to avoid Prisma.EventTypeGetPayload conditional types leaking into .d.ts files
  type UpdatedEventTypeResult = {
    slug: string;
    schedulingType: import("@calcom/prisma/enums").SchedulingType | null;
  };

  let updatedEventType: UpdatedEventTypeResult;
  try {
    updatedEventType = await ctx.prisma.eventType.update({
      where: { id },
      data,
      select: updatedEventTypeSelect,
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      if (e.code === "P2002") {
        // instead of throwing a 500 error, catch the conflict and throw a 400 error.
        throw new TRPCError({ message: "error_event_type_url_duplicate", code: "BAD_REQUEST" });
      }
    }
    throw e;
  }

  if (hostLocationDeletions.length > 0) {
    await ctx.prisma.hostLocation.deleteMany({
      where: {
        OR: hostLocationDeletions,
      },
    });
  }

  const updatedValues = Object.entries(data).reduce((acc, [key, value]) => {
    if (value !== undefined) {
      // @ts-expect-error Element implicitly has any type
      acc[key] = value;
    }
    return acc;
  }, {});

  // Determine calVideoSettings to pass to children:
  // - If calVideoSettings provided in input, sync to children
  // - If Cal Video location removed, delete from children (pass null)
  // - Otherwise, leave children's settings untouched (pass undefined)
  let calVideoSettingsForChildren: typeof calVideoSettings | null | undefined = undefined;
  if (calVideoSettings !== undefined) {
    calVideoSettingsForChildren = calVideoSettings;
  } else if (eventType.calVideoSettings && !isCalVideoLocationActive) {
    calVideoSettingsForChildren = null;
  }

  // Handling updates to children event types (managed events types)
  await updateChildrenEventTypes({
    eventTypeId: id,
    currentUserId: ctx.user.id,
    oldEventType: eventType,
    updatedEventType,
    children,
    profileId: ctx.user.profile.id,
    prisma: ctx.prisma,
    updatedValues,
    calVideoSettings: calVideoSettingsForChildren,
  });

  // Clean up empty host groups
  if (hostGroups !== undefined || hosts) {
    await ctx.prisma.hostGroup.deleteMany({
      where: {
        eventTypeId: id,
        hosts: {
          none: {},
        },
      },
    });
  }

  // Scan redirect URL for malicious content if URL scanning is enabled
  if (isUrlScanningEnabled() && rest.successRedirectUrl) {
    await submitUrlForUrlScanning(rest.successRedirectUrl, ctx.user.id, id);
  }

  const res = ctx.res as NextApiResponse;
  if (typeof res?.revalidate !== "undefined") {
    try {
      await res?.revalidate(`/${ctx.user.username}/${updatedEventType.slug}`);
    } catch (e) {
      // if reach this it is because the event type page has not been created, so it is not possible to revalidate it
      logger.debug((e as Error)?.message);
    }
  }
  return { eventType };
};
