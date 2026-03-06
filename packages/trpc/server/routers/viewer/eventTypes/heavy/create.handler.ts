/**
 * Create Event Type Handler (Heavy Router)
 *
 * Handles viewer-scoped event type creation for ALL scheduling paradigms:
 * - **1:1 (ET-001):** Default when `schedulingType` is not provided — connects owner directly.
 * - **Group (ET-002):** Created with `schedulingType` null initially; `seatsPerTimeSlot` configured
 *   via the update handler after creation. Group event semantics (multiple attendees per slot)
 *   are applied post-creation through the update flow.
 * - **Round-Robin (ET-003):** Created with `schedulingType: ROUND_ROBIN` and `teamId`. Host weights,
 *   priorities, segment-based filtering, and `isRRWeightsEnabled` are all configured via the
 *   update handler after creation.
 * - **Collective (ET-004):** Created with `schedulingType: COLLECTIVE` and `teamId`. All-hosts-available
 *   intersection logic and `assignAllTeamMembers` are configured via the update handler.
 * - **Managed:** Created with `schedulingType: MANAGED` and `teamId` — admin template that propagates
 *   to children event types.
 * - **Dynamic:** Not created via this handler — resolved at booking time via multi-host links.
 *
 * DESIGN NOTE: The create schema intentionally has minimal fields. Paradigm-specific configuration
 * (seats, RR weights/priorities, collective settings, booking windows, custom fields) all happen
 * via the update handler after the event type is created. This two-step pattern (create → update)
 * keeps the creation flow simple and the update handler as the single source of truth for all
 * paradigm-specific field handling.
 *
 * Validation: `schedulingType` is validated via the upstream `createEventTypeInput` Zod schema's
 * `.refine()` rule, which requires `schedulingType` when `teamId` is present. This ensures
 * team event types always have an explicit paradigm.
 *
 * Permission checks: `PermissionCheckService` with PBAC covers all paradigm types:
 * - Organization-level: `eventType.create` permission with ADMIN/OWNER fallback
 * - Team-level: `eventType.create` permission with ADMIN/OWNER fallback (for team events)
 * - System admin: bypasses all permission checks
 * - Organization lock: `lockEventTypeCreationForUsers` prevents non-admin personal event creation
 *
 * @see {@link packages/features/eventtypes/lib/schemas.ts} for `createEventTypeInput` schema
 * @see {@link packages/trpc/server/routers/viewer/eventTypes/heavy/update.handler.ts} for paradigm-specific configuration
 * @module
 */
import type { z } from "zod";

import { getDefaultLocations } from "@calcom/app-store/_utils/getDefaultLocations";
import { DailyLocationType } from "@calcom/app-store/constants";
import { EventTypeRepository } from "@calcom/features/eventtypes/repositories/eventTypeRepository";
import { PermissionCheckService } from "@calcom/features/pbac/services/permission-check.service";
import type { PrismaClient } from "@calcom/prisma";
import { Prisma } from "@calcom/prisma/client";
import { MembershipRole, SchedulingType } from "@calcom/prisma/enums";
import type { eventTypeLocations } from "@calcom/prisma/zod-utils";

import { TRPCError } from "@trpc/server";

import type { TrpcSessionUser } from "../../../../types";
import type { TCreateInputSchema } from "./create.schema";

type EventTypeLocation = z.infer<typeof eventTypeLocations>[number];

type SessionUser = NonNullable<TrpcSessionUser>;
type User = {
  id: SessionUser["id"];
  role: SessionUser["role"];
  organizationId: SessionUser["organizationId"];
  organization: {
    isOrgAdmin: SessionUser["organization"]["isOrgAdmin"];
  };
  profile: {
    id: SessionUser["id"] | null;
  };
  metadata: SessionUser["metadata"];
  email: SessionUser["email"];
};

type CreateOptions = {
  ctx: {
    user: User;
    prisma: PrismaClient;
  };
  input: TCreateInputSchema;
};

export const createHandler = async ({ ctx, input }: CreateOptions) => {
  const {
    schedulingType,
    teamId,
    metadata,
    locations: inputLocations,
    scheduleId,
    calVideoSettings,
    ...rest
  } = input;

  const userId = ctx.user.id;
  // Paradigm detection: only MANAGED has special handling at creation time.
  // Other paradigms (1:1, group, RR, collective) use the same creation path —
  // their paradigm-specific fields are configured via the update handler.
  const isManagedEventType = schedulingType === SchedulingType.MANAGED;
  const isOrgAdmin = !!ctx.user?.organization?.isOrgAdmin;

  const permissionService = new PermissionCheckService();
  // Check if user has organization-level eventType.create permission (equivalent to org admin for event types)
  let hasOrgEventTypeCreatePermission = isOrgAdmin; // Default fallback

  if (ctx.user.organizationId) {
    hasOrgEventTypeCreatePermission = await permissionService.checkPermission({
      userId,
      teamId: ctx.user.organizationId,
      permission: "eventType.create",
      fallbackRoles: [MembershipRole.ADMIN, MembershipRole.OWNER],
    });
  }

  const locations: EventTypeLocation[] =
    inputLocations && inputLocations.length !== 0 ? inputLocations : await getDefaultLocations(ctx.user);

  const isCalVideoLocationActive = locations.some((location) => location.type === DailyLocationType);

  // Build creation payload — paradigm-agnostic base fields only.
  // Paradigm-specific fields (seatsPerTimeSlot, isRRWeightsEnabled, assignAllTeamMembers,
  // bookingFields, periodType, hosts with weights/priorities) are set via update handler.
  const data: Prisma.EventTypeCreateInput = {
    ...rest,
    owner: teamId ? undefined : { connect: { id: userId } },
    metadata: (metadata as Prisma.InputJsonObject) ?? undefined,
    // Only connecting the current user for non-managed event types and non team event types
    users: isManagedEventType || schedulingType ? undefined : { connect: { id: userId } },
    locations,
    schedule: scheduleId ? { connect: { id: scheduleId } } : undefined,
  };

  if (isCalVideoLocationActive && calVideoSettings) {
    data.calVideoSettings = {
      create: {
        disableRecordingForGuests: calVideoSettings.disableRecordingForGuests ?? false,
        disableRecordingForOrganizer: calVideoSettings.disableRecordingForOrganizer ?? false,
        enableAutomaticTranscription: calVideoSettings.enableAutomaticTranscription ?? false,
        enableAutomaticRecordingForOrganizer: calVideoSettings.enableAutomaticRecordingForOrganizer ?? false,
        disableTranscriptionForGuests: calVideoSettings.disableTranscriptionForGuests ?? false,
        disableTranscriptionForOrganizer: calVideoSettings.disableTranscriptionForOrganizer ?? false,
        redirectUrlOnExit: calVideoSettings.redirectUrlOnExit ?? null,
        requireEmailForGuests: calVideoSettings.requireEmailForGuests ?? false,
      },
    };
  }

  // Team event type paradigm assignment:
  // - ROUND_ROBIN (ET-003): creates team event with RR distribution
  // - COLLECTIVE (ET-004): creates team event requiring all hosts available
  // - MANAGED: creates admin template for propagation to children
  // Permission checks via PermissionCheckService cover all team paradigms equally.
  if (teamId && schedulingType) {
    const isSystemAdmin = ctx.user.role === "ADMIN";

    // Only check for team-level permissions - this will also check for membership
    const hasCreatePermission = await permissionService.checkPermission({
      userId,
      teamId,
      permission: "eventType.create",
      fallbackRoles: [MembershipRole.ADMIN, MembershipRole.OWNER],
    });

    if (!isSystemAdmin && !hasOrgEventTypeCreatePermission && !hasCreatePermission) {
      // If none of the above conditions are met, the user is unauthorized.
      // which means the user is not admin of the team nor the org.
      console.warn(`User ${userId} does not have eventType.create permission for team ${teamId}`);
      throw new TRPCError({ code: "UNAUTHORIZED" });
    }

    data.team = {
      connect: {
        id: teamId,
      },
    };
    data.schedulingType = schedulingType;
  }

  // If we are in an organization & they don't have org-level eventType.create permission & they are not creating an event on a teamID
  // Check if evenTypes are locked.
  if (ctx.user.organizationId && !hasOrgEventTypeCreatePermission && !teamId) {
    const orgSettings = await ctx.prisma.organizationSettings.findUnique({
      where: {
        organizationId: ctx.user.organizationId,
      },
      select: {
        lockEventTypeCreationForUsers: true,
      },
    });

    const orgHasLockedEventTypes = !!orgSettings?.lockEventTypeCreationForUsers;
    if (orgHasLockedEventTypes) {
      console.warn(
        `User ${userId} does not have permission to create this new event type - Locked status: ${orgHasLockedEventTypes}`
      );
      throw new TRPCError({ code: "UNAUTHORIZED" });
    }
  }

  const profile = ctx.user.profile;
  try {
    const eventTypeRepo = new EventTypeRepository(ctx.prisma);
    const eventType = await eventTypeRepo.create({
      ...data,
      profileId: profile.id,
    });
    return { eventType };
  } catch (e) {
    console.warn(e);
    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      if (e.code === "P2002" && Array.isArray(e.meta?.target) && e.meta?.target.includes("slug")) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "URL Slug already exists for given user." });
      }
    }
    throw new TRPCError({ code: "BAD_REQUEST" });
  }
};
