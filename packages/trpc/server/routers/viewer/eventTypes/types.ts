import { templateTypeEnum } from "@calcom/features/calAIPhone/zod-utils";
import type {
  AiPhoneCallConfig,
  CalVideoSettings,
  ChildInput,
  DestinationCalendarInput,
  EventTypeUpdateInput,
  HashedLinkInput,
  HostGroupInput,
  HostInput,
} from "@calcom/features/eventtypes/lib/types";
import { MAX_SEATS_PER_TIME_SLOT } from "@calcom/lib/constants";
import {
  customInputSchema,
  EventTypeMetaDataSchema,
  eventTypeBookingFields,
  eventTypeColor,
  eventTypeLocations,
  intervalLimitsType,
  recurringEventType,
  rrSegmentQueryValueSchema,
} from "@calcom/prisma/zod-utils";
import { z } from "zod";
/**
 * Type alias for the event type update input, imported from the features layer.
 * Covers all scheduling paradigm fields: 1:1, group (seats), round-robin, collective, booking windows, and custom fields.
 * @see packages/features/eventtypes/lib/types.ts for the canonical EventTypeUpdateInput definition
 */
export type TUpdateInputSchema = EventTypeUpdateInput;

// ============================================================================
// ZOD SCHEMAS
// ============================================================================

const hashedLinkInputSchema: z.ZodType<HashedLinkInput> = z
  .object({
    link: z.string(),
    expiresAt: z.date().nullish(),
    maxUsageCount: z.number().nullish(),
    usageCount: z.number().nullish(),
  })
  .strict();

const aiPhoneCallConfigSchema: z.ZodType<AiPhoneCallConfig | undefined> = z
  .object({
    generalPrompt: z.string(),
    enabled: z.boolean(),
    beginMessage: z.string().nullable(),
    yourPhoneNumber: z.string(),
    numberToCall: z.string(),
    guestName: z.string().nullable().optional(),
    guestEmail: z.string().nullable().optional(),
    guestCompany: z.string().nullable().optional(),
    templateType: templateTypeEnum,
  })
  .optional();

const calVideoSettingsSchema: z.ZodType<CalVideoSettings | undefined> = z
  .object({
    disableRecordingForGuests: z.boolean().nullish(),
    disableRecordingForOrganizer: z.boolean().nullish(),
    enableAutomaticTranscription: z.boolean().nullish(),
    enableAutomaticRecordingForOrganizer: z.boolean().nullish(),
    disableTranscriptionForGuests: z.boolean().nullish(),
    disableTranscriptionForOrganizer: z.boolean().nullish(),
    redirectUrlOnExit: z.string().url().nullish(),
    requireEmailForGuests: z.boolean().nullish(),
  })
  .optional()
  .nullable();

const hostLocationSchema = z.object({
  id: z.string().optional(),
  userId: z.number(),
  eventTypeId: z.number(),
  type: z.string(),
  credentialId: z.number().optional().nullable(),
  link: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  phoneNumber: z.string().optional().nullable(),
});

/**
 * Host input schema for team event type host assignment.
 *
 * Used by both Round-Robin (ET-003) and Collective (ET-004) paradigms:
 * - userId: the team member's user ID
 * - profileId: optional profile ID for multi-profile users
 * - isFixed: true for collective/fixed hosts, false for round-robin pool
 * - priority: 0-4 priority level for RR ordering (0 = lowest, 4 = highest)
 * - weight: relative weight for weighted RR distribution (0+ scale, default 100)
 * - scheduleId: custom availability schedule override for this host
 * - groupId: group identifier for group-based RR assignment
 * - location: per-host location configuration
 */
const hostSchema: z.ZodType<HostInput> = z.object({
  userId: z.number(),
  profileId: z.number().or(z.null()).optional(),
  isFixed: z.boolean().optional(),
  priority: z.number().min(0).max(4).optional().nullable(),
  weight: z.number().min(0).optional().nullable(),
  scheduleId: z.number().optional().nullable(),
  groupId: z.string().optional().nullable(),
  location: hostLocationSchema.optional().nullable(),
});

const hostGroupSchema: z.ZodType<HostGroupInput> = z.object({
  id: z.string().uuid(),
  name: z.string(),
});

const childSchema: z.ZodType<ChildInput> = z.object({
  owner: z.object({
    id: z.number(),
    name: z.string(),
    email: z.string(),
    eventTypeSlugs: z.array(z.string()),
  }),
  hidden: z.boolean(),
});

const destinationCalendarInputSchema: z.ZodType<DestinationCalendarInput> = z
  .object({
    integration: z.string(),
    externalId: z.string(),
  })
  .nullable();

/**
 * Base schema for event type updates.
 *
 * Uses z.ZodType<TUpdateInputSchema> annotation to prevent TypeScript from
 * inferring the complex type through the schema chain. This is a key
 * optimization that reduces type-checking time significantly.
 */
const BaseEventTypeUpdateInput: z.ZodType<TUpdateInputSchema> = z
  .object({
    // === Required Fields ===
    id: z.number().int(),

    // === Booking Window Fields (ET-005) ===
    // Maps to Calendly's booking window options:
    // - UNLIMITED → "indefinitely"
    // - ROLLING → "days into future" (calendar days)
    // - ROLLING_WINDOW → "days into future" (business days, AVL-GAP-001)
    // - RANGE → "date range" with explicit start/end dates
    periodType: z.enum(["UNLIMITED", "ROLLING", "ROLLING_WINDOW", "RANGE"]).optional(),
    // === Scheduling Paradigm Selection ===
    // null = 1:1 (ET-001), ROUND_ROBIN (ET-003), COLLECTIVE (ET-004), MANAGED
    schedulingType: z.enum(["ROUND_ROBIN", "COLLECTIVE", "MANAGED"]).nullable().optional(),
    title: z.string().min(1).optional(),
    slug: z.string().optional(),
    description: z.string().nullable().optional(),
    interfaceLanguage: z.string().nullable().optional(),
    position: z.number().int().optional(),
    locations: eventTypeLocations.nullable().optional(),
    length: z.number().min(1).optional(),
    offsetStart: z.number().int().optional(),
    hidden: z.boolean().optional(),
    userId: z.number().int().nullable().optional(),
    profileId: z.number().int().nullable().optional(),
    teamId: z.number().int().nullable().optional(),
    useEventLevelSelectedCalendars: z.boolean().optional(),
    eventName: z.string().nullable().optional(),
    parentId: z.number().int().nullable().optional(),
    // === Custom Booking Fields (ET-006) ===
    // bookingFields: array of booking form fields supporting all Calendly types
    //   (text, radio, checkbox, phone, select/dropdown) plus Cal.com extras
    bookingFields: eventTypeBookingFields.nullable().optional(),
    timeZone: z.string().nullable().optional(),
    periodStartDate: z.coerce.date().nullable().optional(),
    periodEndDate: z.coerce.date().nullable().optional(),
    periodDays: z.number().int().nullable().optional(),
    periodCountCalendarDays: z.boolean().nullable().optional(),
    lockTimeZoneToggleOnBookingPage: z.boolean().optional(),
    lockedTimeZone: z.string().nullable().optional(),
    requiresConfirmation: z.boolean().optional(),
    requiresConfirmationWillBlockSlot: z.boolean().optional(),
    requiresConfirmationForFreeEmail: z.boolean().optional(),
    requiresBookerEmailVerification: z.boolean().optional(),
    canSendCalVideoTranscriptionEmails: z.boolean().optional(),
    autoTranslateDescriptionEnabled: z.boolean().optional(),
    autoTranslateInstantMeetingTitleEnabled: z.boolean().optional(),
    recurringEvent: recurringEventType.nullable().optional(),
    disableGuests: z.boolean().optional(),
    hideCalendarNotes: z.boolean().optional(),
    hideCalendarEventDetails: z.boolean().optional(),
    minimumBookingNotice: z.number().min(0).optional(),
    beforeEventBuffer: z.number().int().optional(),
    afterEventBuffer: z.number().int().optional(),
    // === Group Event Fields (ET-002) ===
    // seatsPerTimeSlot: max attendees per slot (null = non-seated)
    // seatsShowAttendees: show attendee names to other attendees
    // seatsShowAvailabilityCount: show remaining seats in booking UI
    seatsPerTimeSlot: z.number().min(1).max(MAX_SEATS_PER_TIME_SLOT).nullable().optional(),
    onlyShowFirstAvailableSlot: z.boolean().optional(),
    showOptimizedSlots: z.boolean().nullable().optional(),
    disableCancelling: z.boolean().nullable().optional(),
    disableRescheduling: z.boolean().nullable().optional(),
    minimumRescheduleNotice: z.number().min(0).nullable().optional(),
    seatsShowAttendees: z.boolean().nullable().optional(),
    seatsShowAvailabilityCount: z.boolean().nullable().optional(),
    scheduleId: z.number().int().nullable().optional(),
    allowReschedulingCancelledBookings: z.boolean().nullable().optional(),
    price: z.number().int().optional(),
    currency: z.string().optional(),
    slotInterval: z.number().int().nullable().optional(),
    metadata: EventTypeMetaDataSchema.optional(),
    successRedirectUrl: z.string().nullable().optional(),
    forwardParamsSuccessRedirect: z.boolean().nullable().optional(),
    redirectUrlOnNoRoutingFormResponse: z.string().nullable().optional(),
    bookingLimits: intervalLimitsType.nullable().optional(),
    durationLimits: intervalLimitsType.nullable().optional(),
    isInstantEvent: z.boolean().optional(),
    instantMeetingExpiryTimeOffsetInSeconds: z.number().int().optional(),
    instantMeetingScheduleId: z.number().int().nullable().optional(),
    instantMeetingParameters: z.string().array().optional(),
    // === Collective Scheduling Fields (ET-004) ===
    // assignAllTeamMembers: auto-assign all team members as fixed hosts
    assignAllTeamMembers: z.boolean().optional(),
    // === Round-Robin Distribution Fields (ET-003) ===
    // isRRWeightsEnabled: enable weight-based distribution
    // assignRRMembersUsingSegment: use segment-based host filtering
    // rrSegmentQueryValue: RAQB filter for segment-based RR assignment
    // includeNoShowInRRCalculation: count no-shows in fairness calculation
    // rescheduleWithSameRoundRobinHost: preserve host on reschedule
    // rrHostSubsetEnabled: enable host subset selection
    // maxLeadThreshold: max booking lead per host (null = disabled)
    assignRRMembersUsingSegment: z.boolean().optional(),
    rrSegmentQueryValue: rrSegmentQueryValueSchema.nullable().optional(),
    useEventTypeDestinationCalendarEmail: z.boolean().optional(),
    isRRWeightsEnabled: z.boolean().optional(),
    maxLeadThreshold: z.number().int().nullable().optional(),
    includeNoShowInRRCalculation: z.boolean().optional(),
    allowReschedulingPastBookings: z.boolean().optional(),
    hideOrganizerEmail: z.boolean().optional(),
    maxActiveBookingsPerBooker: z.number().int().nullable().optional(),
    maxActiveBookingPerBookerOfferReschedule: z.boolean().optional(),
    customReplyToEmail: z.string().nullable().optional(),
    eventTypeColor: eventTypeColor.nullable().optional(),
    rescheduleWithSameRoundRobinHost: z.boolean().optional(),
    secondaryEmailId: z.number().int().nullable().optional(),
    useBookerTimezone: z.boolean().optional(),
    restrictionScheduleId: z.number().int().nullable().optional(),
    bookingRequiresAuthentication: z.boolean().optional(),
    rrHostSubsetEnabled: z.boolean().optional(),
    createdAt: z.coerce.date().nullable().optional(),
    updatedAt: z.coerce.date().nullable().optional(),

    // Extended fields
    aiPhoneCallConfig: aiPhoneCallConfigSchema,
    calVideoSettings: calVideoSettingsSchema,
    calAiPhoneScript: z.string().optional(),
    // === Legacy Custom Inputs (ET-006) ===
    // customInputs: legacy custom input system (pre-bookingFields)
    //   Supports all Calendly question types for backward compatibility
    customInputs: z.array(customInputSchema).optional(),
    destinationCalendar: destinationCalendarInputSchema.optional(),
    users: z.array(z.number()).optional(),
    children: z.array(childSchema).optional(),
    hosts: z.array(hostSchema).optional(),
    schedule: z.number().nullable().optional(),
    instantMeetingSchedule: z.number().nullable().optional(),
    multiplePrivateLinks: z.array(z.union([z.string(), hashedLinkInputSchema])).optional(),
    hostGroups: z.array(hostGroupSchema).optional(),
    enablePerHostLocations: z.boolean().optional(),
  })
  .strict();

export const ZUpdateInputSchema = BaseEventTypeUpdateInput.superRefine((data, _ctx) => {
  // Apply transformations to aiPhoneCallConfig if present
  if (data.aiPhoneCallConfig) {
    data.aiPhoneCallConfig.yourPhoneNumber = data.aiPhoneCallConfig.yourPhoneNumber || "";
    data.aiPhoneCallConfig.numberToCall = data.aiPhoneCallConfig.numberToCall || "";
    data.aiPhoneCallConfig.guestName = data.aiPhoneCallConfig.guestName ?? undefined;
    data.aiPhoneCallConfig.guestEmail = data.aiPhoneCallConfig.guestEmail ?? null;
    data.aiPhoneCallConfig.guestCompany = data.aiPhoneCallConfig.guestCompany ?? null;
  }
});
