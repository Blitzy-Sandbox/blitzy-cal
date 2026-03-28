import type { ConnectedApps } from "@calcom/app-store/_utils/getConnectedApps";
import type { EventLocationType } from "@calcom/app-store/locations";
import type { eventTypeMetaDataSchemaWithTypedApps } from "@calcom/app-store/zod-utils";
import type { TemplateType } from "@calcom/features/calAIPhone/zod-utils";
import type { ChildrenEventType } from "@calcom/features/eventtypes/lib/childrenEventType";
import type { IntervalLimit } from "@calcom/lib/intervalLimits/intervalLimitSchema";
import type { AttributesQueryValue } from "@calcom/lib/raqb/types";
import type { EventTypeTranslation } from "@calcom/prisma/client";
import type { MembershipRole, PeriodType, SchedulingType } from "@calcom/prisma/enums";
import type {
  BookerLayoutSettings,
  CustomInputSchema,
  customInputSchema,
  EventTypeLocation,
  EventTypeMetadata,
  eventTypeBookingFields,
  eventTypeColor,
} from "@calcom/prisma/zod-utils";
import type { RecurringEvent } from "@calcom/types/Calendar";
import type { UserProfile } from "@calcom/types/UserProfile";
import type { z } from "zod";
import type { EventType } from "./getEventTypeById";
export type CustomInputParsed = typeof customInputSchema._output;

export type AvailabilityOption = {
  label: string;
  value: number;
  isDefault: boolean;
  isManaged?: boolean;
};
export type EventTypeSetupProps = EventType;
export type EventTypeSetup = EventType["eventType"];
export type EventTypeApps = ConnectedApps;
export type HostLocation = {
  id?: string;
  userId: number;
  eventTypeId: number;
  type: EventLocationType["type"];
  credentialId?: number | null;
  link?: string | null;
  address?: string | null;
  phoneNumber?: string | null;
};

/**
 * Represents a host assigned to a team event type.
 *
 * Used across multiple scheduling paradigms:
 *
 * - **Round-Robin (ET-003):** `isFixed` is `false`. The `priority` field controls
 *   host ordering in the distribution queue; `weight` controls the proportional share
 *   of bookings each host receives when `isRRWeightsEnabled` is `true`. `groupId`
 *   enables segment-based round-robin assignment via `rrSegmentQueryValue`.
 *
 * - **Collective (ET-004):** `isFixed` is `true`. All fixed hosts must be
 *   simultaneously available for a slot to be bookable. `priority` and `weight`
 *   are not used for collective scheduling but are retained for type consistency.
 *
 * - **Managed:** Hosts are propagated from parent to child event types.
 *   `scheduleId` allows per-host schedule overrides for availability.
 *
 * - **1:1 (ET-001):** Not applicable — one-on-one events use `schedulingType: null`
 *   and do not have a `hosts` array.
 */
export type Host = {
  isFixed: boolean;
  userId: number;
  priority: number;
  weight: number;
  scheduleId?: number | null;
  groupId: string | null;
  location?: HostLocation | null;
};
export type TeamMember = {
  value: string;
  label: string;
  avatar: string;
  email: string;
  defaultScheduleId: number | null;
};

type EventLocation = {
  type: EventLocationType["type"];
  address?: string;
  attendeeAddress?: string;
  somewhereElse?: string;
  link?: string;
  hostPhoneNumber?: string;
  displayLocationPublicly?: boolean;
  phone?: string;
  hostDefault?: string;
  credentialId?: number;
  teamName?: string;
  customLabel?: string;
};

type PhoneCallConfig = {
  generalPrompt: string;
  enabled: boolean;
  beginMessage: string;
  yourPhoneNumber: string;
  numberToCall: string;
  guestName?: string;
  guestEmail?: string;
  guestCompany?: string;
  templateType: string;
  schedulerName?: string;
};

export type PrivateLinkWithOptions = {
  link: string;
  expiresAt?: Date | null;
  maxUsageCount?: number | null;
  usageCount?: number;
};

/**
 * Comprehensive form state type for event type configuration.
 *
 * Covers all six scheduling paradigms supported by Cal.com:
 *
 * - **1:1 (ET-001):** `schedulingType` is `null` — single host paired with a
 *   single invitee. Host assignment and confirmation workflow are implicit.
 * - **Group (ET-002):** Configured via `seatsPerTimeSlot` — multiple attendees
 *   book the same time slot up to the seat limit.
 * - **Round-Robin (ET-003):** `schedulingType` is `ROUND_ROBIN` — equitable host
 *   distribution controlled by `isRRWeightsEnabled`, `hosts[].weight`,
 *   `hosts[].priority`, `rrSegmentQueryValue`, and `assignRRMembersUsingSegment`.
 * - **Collective (ET-004):** `schedulingType` is `COLLECTIVE` — all fixed hosts
 *   must be simultaneously available. Controlled by `assignAllTeamMembers` and
 *   `hosts[].isFixed`.
 * - **Managed:** `schedulingType` is `MANAGED` — admin-created templates
 *   propagated to `children` event types.
 * - **Dynamic:** Ad-hoc links combining multiple users without pre-configuration.
 *
 * Booking window fields (ET-005) are documented inline below. Custom booking
 * fields (ET-006) are captured by `bookingFields` via the `eventTypeBookingFields`
 * Zod schema which supports text, radio, checkbox, phone, select (dropdown),
 * textarea, number, email, and other field types — covering all Calendly
 * question types.
 */
export type FormValues = {
  // ── Core identity fields ──────────────────────────────────────────────
  id: number;
  title: string;
  eventTitle: string;
  eventName: string;
  slug: string;
  interfaceLanguage: string | null;
  isInstantEvent: boolean;
  instantMeetingParameters: string[];
  instantMeetingExpiryTimeOffsetInSeconds: number;
  length: number;
  offsetStart: number;
  description: string;
  disableGuests: boolean;
  lockTimeZoneToggleOnBookingPage: boolean;
  lockedTimeZone: string | null;
  requiresConfirmation: boolean;
  requiresConfirmationWillBlockSlot: boolean;
  requiresConfirmationForFreeEmail: boolean;
  requiresBookerEmailVerification: boolean;
  recurringEvent: RecurringEvent | null;

  // ── Scheduling paradigm (ET-001) ──────────────────────────────────────
  /** `null` = 1:1 (one-on-one), otherwise ROUND_ROBIN | COLLECTIVE | MANAGED */
  schedulingType: SchedulingType | null;

  hidden: boolean;
  hideCalendarNotes: boolean;
  multiplePrivateLinks: (string | PrivateLinkWithOptions)[] | undefined;
  eventTypeColor: z.infer<typeof eventTypeColor>;
  customReplyToEmail: string | null;
  locations: EventLocation[];
  aiPhoneCallConfig: PhoneCallConfig;
  customInputs: CustomInputParsed[];
  schedule: number | null;
  useEventLevelSelectedCalendars: boolean;
  disabledCancelling: boolean;
  disabledRescheduling: boolean;
  minimumRescheduleNotice: number | null;

  // ── Booking window fields (ET-005) ────────────────────────────────────
  // Maps to Calendly's booking window options via PeriodType enum:
  //   ROLLING        → "days into the future" (calendar days)
  //   ROLLING_WINDOW → "days into the future" (business days only — AVL-GAP-001 parity)
  //   RANGE          → "date range" (explicit start/end)
  //   UNLIMITED      → "indefinitely into the future"
  periodType: PeriodType;
  /**
   * Number of days (applicable only for ROLLING period type).
   * Combined with `periodCountCalendarDays` to distinguish calendar days
   * from business days — aligns with Calendly's booking window behavior.
   */
  periodDays: number;
  /**
   * When `true`, counts calendar days; when `false`, counts business days.
   * Applicable only for ROLLING period type. Addresses AVL-GAP-001 parity
   * with Calendly's calendar/business day distinction.
   */
  periodCountCalendarDays: boolean;
  /**
   * Explicit date range for RANGE period type — maps to Calendly's
   * "date range" booking window option.
   */
  periodDates: { startDate: Date; endDate: Date };
  /** Excludes unavailable days from the rolling window count. */
  rollingExcludeUnavailableDays: boolean;

  // ── Group event fields (ET-002) ───────────────────────────────────────
  // Enables seated booking: multiple attendees per time slot up to the limit.
  // The (N+1)th attendee is rejected when `seatsPerTimeSlot` is reached.
  seatsPerTimeSlot: number | null;
  seatsShowAttendees: boolean | null;
  seatsShowAvailabilityCount: boolean | null;
  seatsPerTimeSlotEnabled: boolean;

  autoTranslateDescriptionEnabled: boolean;
  autoTranslateInstantMeetingTitleEnabled: boolean;
  fieldTranslations: EventTypeTranslation[];
  scheduleName: string;

  // ── Minimum notice & buffer fields (ET-005) ───────────────────────────
  minimumBookingNotice: number;
  minimumBookingNoticeInDurationType: number;
  maxActiveBookingsPerBooker: number | null;
  beforeEventBuffer: number;
  afterEventBuffer: number;
  slotInterval: number | null;

  metadata: z.infer<typeof eventTypeMetaDataSchemaWithTypedApps>;
  destinationCalendar: {
    integration: string;
    externalId: string;
  };
  successRedirectUrl: string;
  redirectUrlOnNoRoutingFormResponse: string;
  durationLimits?: IntervalLimit;
  bookingLimits?: IntervalLimit;
  onlyShowFirstAvailableSlot: boolean;
  showOptimizedSlots: boolean;

  // ── Managed event type fields ─────────────────────────────────────────
  /** Child event types propagated from this managed parent template. */
  children: ChildrenEventType[];

  // ── Team host fields (ET-003 Round-Robin, ET-004 Collective) ──────────
  /** Array of hosts with paradigm-specific fields. See `Host` type JSDoc. */
  hosts: Host[];
  /** Named host groups for segment-based round-robin assignment. */
  hostGroups: {
    id: string;
    name: string;
  }[];

  // ── Custom booking fields (ET-006) ────────────────────────────────────
  // Supports all Calendly question types via the Zod schema:
  //   text, radio, checkbox, phone, select (dropdown), textarea, number, email
  // Calendly mapping: text→text, radio→radio, checkbox→checkbox,
  //   phone→phone, dropdown→select
  bookingFields: z.infer<typeof eventTypeBookingFields>;

  availability?: AvailabilityOption;
  bookerLayouts: BookerLayoutSettings;
  multipleDurationEnabled: boolean;
  users: EventTypeSetup["users"];

  // ── Collective scheduling fields (ET-004) ─────────────────────────────
  /** When `true`, all team members are assigned as hosts (collective mode). */
  assignAllTeamMembers: boolean;

  // ── Round-robin distribution fields (ET-003) ──────────────────────────
  /** Enables segment-based member assignment for round-robin. */
  assignRRMembersUsingSegment: boolean;
  /** RAQB query value for segment-based RR filtering. */
  rrSegmentQueryValue: AttributesQueryValue | null;
  /** When `true`, rescheduled bookings keep the same RR host. */
  rescheduleWithSameRoundRobinHost: boolean;

  useEventTypeDestinationCalendarEmail: boolean;
  forwardParamsSuccessRedirect: boolean | null;
  secondaryEmailId?: number;

  /** Enables weighted distribution for round-robin hosts. */
  isRRWeightsEnabled: boolean;
  /** Maximum lead threshold for round-robin host assignment. */
  maxLeadThreshold?: number;

  restrictionScheduleId: number | null;
  useBookerTimezone: boolean;
  restrictionScheduleName: string | null;
  calVideoSettings?: CalVideoSettings;
  syncBuffersToCalendar: boolean;
  maxActiveBookingPerBookerOfferReschedule: boolean;
  enablePerHostLocations: boolean;
};

export type LocationFormValues = Pick<FormValues, "id" | "locations" | "bookingFields" | "seatsPerTimeSlot">;

export type EventTypeAssignedUsers = {
  owner: {
    avatar: string;
    email: string;
    name: string;
    username: string;
    membership: MembershipRole;
    id: number;
    avatarUrl: string | null;
    nonProfileUsername: string | null;
    profile: UserProfile;
  };
  created: boolean;
  hidden: boolean;
  slug: string;
}[];

/**
 * Database-projected host records for event type queries.
 *
 * Used by the availability engine and booking flow to resolve host-specific
 * scheduling data:
 *
 * - **Round-Robin (ET-003):** `isFixed` is `false`; `priority` controls queue
 *   ordering; `weight` controls proportional booking share when weighted RR is
 *   enabled; `groupId` supports segment-based assignment. Hosts are grouped by
 *   `groupId` in `getAggregatedAvailability` with at-least-one-available logic.
 *
 * - **Collective (ET-004):** `isFixed` is `true`; all fixed hosts must have
 *   overlapping availability for a slot to be presented. `priority` and `weight`
 *   are nullable and unused for collective intersection logic.
 *
 * The `scheduleId` allows per-host schedule overrides — when `null`, the host's
 * default schedule is used for availability computation.
 */
export type EventTypeHosts = {
  user: {
    timeZone: string;
  };
  userId: number;
  scheduleId: number | null;
  isFixed: boolean;
  priority: number | null;
  weight: number | null;
  groupId: string | null;
}[];

// ============================================================================
// EVENT TYPE UPDATE INPUT TYPES
// ============================================================================
// These types define the shape of event type update operations and should be
// consumed by both the features package and tRPC routers.
// ============================================================================

export type HashedLinkInput = {
  link: string;
  expiresAt?: Date | null;
  maxUsageCount?: number | null;
  usageCount?: number | null;
};

export type AiPhoneCallConfig = {
  generalPrompt: string;
  enabled: boolean;
  beginMessage: string | null;
  yourPhoneNumber: string;
  numberToCall: string;
  guestName?: string | null;
  guestEmail?: string | null;
  guestCompany?: string | null;
  templateType: TemplateType;
};

export type HostLocationInput = {
  id?: string;
  userId: number;
  eventTypeId: number;
  type: string;
  credentialId?: number | null;
  link?: string | null;
  address?: string | null;
  phoneNumber?: string | null;
};

/**
 * Input type for creating or updating host assignments on a team event type.
 *
 * All fields except `userId` are optional to support partial updates (`.partial()`
 * pattern). Used by `EventTypeUpdateInput.hosts` for all team scheduling paradigms:
 *
 * - **Round-Robin (ET-003):** Set `isFixed: false`, configure `priority` for
 *   queue ordering, `weight` for weighted distribution, and `groupId` for
 *   segment-based assignment via `rrSegmentQueryValue`.
 * - **Collective (ET-004):** Set `isFixed: true` — all fixed hosts must be
 *   simultaneously available.
 * - **Managed:** Hosts propagated from parent template to child event types.
 *
 * @see Host — the form-state counterpart with required fields
 * @see EventTypeHosts — the database-projected counterpart
 */
export type HostInput = {
  userId: number;
  profileId?: number | null;
  isFixed?: boolean;
  priority?: number | null;
  weight?: number | null;
  scheduleId?: number | null;
  groupId?: string | null;
  location?: HostLocationInput | null;
};

/**
 * Input type for named host groups used in segment-based round-robin
 * assignment (ET-003). Groups partition hosts for `rrSegmentQueryValue`
 * filtering via the `groupId` field on `HostInput`.
 */
export type HostGroupInput = {
  id: string;
  name: string;
};

export type ChildInput = {
  owner: {
    id: number;
    name: string;
    email: string;
    eventTypeSlugs: string[];
  };
  hidden: boolean;
};

export type DestinationCalendarInput = {
  integration: string;
  externalId: string;
} | null;

export type RecurringEventInput = {
  dtstart?: Date;
  interval: number;
  count: number;
  freq: number;
  until?: Date;
  tzid?: string;
} | null;

export type EventTypeColorInput = {
  lightEventTypeColor: string;
  darkEventTypeColor: string;
} | null;

/**
 * Minimal booking field input type for event type update operations (ET-006).
 *
 * Only includes properties that are actually read in server code. Does NOT use
 * an index signature to maintain compatibility with API v2 DTO classes.
 *
 * The `type` field accepts any string value, supporting all Cal.com booking field
 * types which provide full parity with Calendly's question types:
 *
 * | Cal.com `type` | Calendly equivalent | Description                  |
 * |----------------|---------------------|------------------------------|
 * | `"text"`       | Text                | Single-line text input       |
 * | `"textarea"`   | Text (multi-line)   | Multi-line text input        |
 * | `"radio"`      | Radio buttons       | Single-choice radio group    |
 * | `"checkbox"`   | Checkboxes          | Multi-choice checkbox group  |
 * | `"phone"`      | Phone number        | Phone number with validation |
 * | `"select"`     | Dropdown            | Single-choice dropdown menu  |
 * | `"email"`      | —                   | Email input (Cal.com extra)  |
 * | `"number"`     | —                   | Numeric input (Cal.com extra)|
 *
 * The `type` is optional to support partial updates — creation flows should
 * always specify a type via the full `eventTypeBookingFields` Zod schema.
 */
export type BookingFieldInput = {
  name: string;
  hidden?: boolean;
  required?: boolean;
  type?: string;
};

/**
 * Round-robin segment query value for attribute-based host filtering (ET-003).
 *
 * Uses an index signature to accommodate the complex React Awesome Query Builder
 * (RAQB) structure that defines segment conditions. When `assignRRMembersUsingSegment`
 * is `true`, this query filters which hosts in a round-robin pool are eligible
 * for assignment based on attribute matching.
 *
 * The values need to be indexable (string keys) for downstream usage.
 */
export type RRSegmentQueryValueInput = {
  [key: string]: unknown;
} | null;

/**
 * Explicit type definition for event type update input.
 *
 * This type is defined explicitly rather than using `z.infer<>` on a complex
 * schema chain to significantly reduce TypeScript type-checking time.
 * The schema still validates all fields at runtime.
 *
 * All fields are optional (from `.partial()`) except `id` which is required.
 *
 * Supports all six Cal.com scheduling paradigms:
 * - **1:1 (ET-001):** `schedulingType: null` — default one-on-one flow
 * - **Group (ET-002):** `seatsPerTimeSlot`, `seatsShowAttendees`, `seatsShowAvailabilityCount`
 * - **Round-Robin (ET-003):** `isRRWeightsEnabled`, `rrSegmentQueryValue`,
 *   `assignRRMembersUsingSegment`, `rescheduleWithSameRoundRobinHost`,
 *   `includeNoShowInRRCalculation`, `maxLeadThreshold`, `rrHostSubsetEnabled`
 * - **Collective (ET-004):** `assignAllTeamMembers` with `hosts[].isFixed: true`
 * - **Booking Windows (ET-005):** `periodType`, `periodDays`, `periodStartDate`,
 *   `periodEndDate`, `periodCountCalendarDays`, `minimumBookingNotice`
 * - **Custom Fields (ET-006):** `bookingFields` (see `BookingFieldInput`)
 */
export type EventTypeUpdateInput = {
  // ── Required field ────────────────────────────────────────────────────
  id: number;

  // ── Booking window fields (ET-005) ────────────────────────────────────
  // ROLLING → days into the future, RANGE → date range, UNLIMITED → indefinite
  periodType?: PeriodType;

  // ── Scheduling paradigm (ET-001) ──────────────────────────────────────
  /** `null` = 1:1 (one-on-one), otherwise ROUND_ROBIN | COLLECTIVE | MANAGED */
  schedulingType?: SchedulingType | null;

  // ── Core identity fields ──────────────────────────────────────────────
  title?: string;
  slug?: string;
  description?: string | null;
  interfaceLanguage?: string | null;
  position?: number;
  locations?: EventTypeLocation[] | null;
  length?: number;
  offsetStart?: number;
  hidden?: boolean;
  userId?: number | null;
  profileId?: number | null;
  teamId?: number | null;
  useEventLevelSelectedCalendars?: boolean;
  eventName?: string | null;
  parentId?: number | null;

  // ── Custom booking fields (ET-006) ────────────────────────────────────
  // Supports all Calendly question types: text, radio, checkbox, phone, select
  bookingFields?: BookingFieldInput[] | null;

  timeZone?: string | null;

  // ── Booking window fields (ET-005) continued ──────────────────────────
  periodStartDate?: Date | null;
  periodEndDate?: Date | null;
  periodDays?: number | null;
  /** Calendar vs. business day counting for ROLLING window (AVL-GAP-001). */
  periodCountCalendarDays?: boolean | null;

  lockTimeZoneToggleOnBookingPage?: boolean;
  lockedTimeZone?: string | null;
  requiresConfirmation?: boolean;
  requiresConfirmationWillBlockSlot?: boolean;
  requiresConfirmationForFreeEmail?: boolean;
  requiresBookerEmailVerification?: boolean;
  canSendCalVideoTranscriptionEmails?: boolean;
  autoTranslateDescriptionEnabled?: boolean;
  autoTranslateInstantMeetingTitleEnabled?: boolean;
  recurringEvent?: RecurringEventInput;
  disableGuests?: boolean;
  hideCalendarNotes?: boolean;
  hideCalendarEventDetails?: boolean;
  /** Minimum advance notice required for bookings (ET-005). */
  minimumBookingNotice?: number;
  beforeEventBuffer?: number;
  afterEventBuffer?: number;
  syncBuffersToCalendar?: boolean | null;

  // ── Group event fields (ET-002) ───────────────────────────────────────
  /** Number of seats per time slot for group/seated events. */
  seatsPerTimeSlot?: number | null;
  onlyShowFirstAvailableSlot?: boolean;
  showOptimizedSlots?: boolean | null;
  disableCancelling?: boolean | null;
  disableRescheduling?: boolean | null;
  minimumRescheduleNotice?: number | null;
  /** Whether attendee names are visible to other attendees in group events. */
  seatsShowAttendees?: boolean | null;
  /** Whether remaining seat count is displayed on the booking page. */
  seatsShowAvailabilityCount?: boolean | null;

  scheduleId?: number | null;
  allowReschedulingCancelledBookings?: boolean | null;
  price?: number;
  currency?: string;
  slotInterval?: number | null;
  metadata?: EventTypeMetadata;
  successRedirectUrl?: string | null;
  forwardParamsSuccessRedirect?: boolean | null;
  redirectUrlOnNoRoutingFormResponse?: string | null;
  bookingLimits?: IntervalLimit | null;
  durationLimits?: IntervalLimit | null;
  isInstantEvent?: boolean;
  instantMeetingExpiryTimeOffsetInSeconds?: number;
  instantMeetingScheduleId?: number | null;
  instantMeetingParameters?: string[];

  // ── Collective scheduling fields (ET-004) ─────────────────────────────
  /** When `true`, all team members are assigned as fixed hosts. */
  assignAllTeamMembers?: boolean;

  // ── Round-robin distribution fields (ET-003) ──────────────────────────
  /** Enables segment-based member assignment for round-robin. */
  assignRRMembersUsingSegment?: boolean;
  /** RAQB query value for segment-based RR host filtering. */
  rrSegmentQueryValue?: RRSegmentQueryValueInput;
  useEventTypeDestinationCalendarEmail?: boolean;
  /** Enables weighted (non-equal) distribution across round-robin hosts. */
  isRRWeightsEnabled?: boolean;
  /** Maximum lead threshold for round-robin host assignment queue. */
  maxLeadThreshold?: number | null;
  /** Whether no-shows count toward RR distribution calculations. */
  includeNoShowInRRCalculation?: boolean;

  allowReschedulingPastBookings?: boolean;
  hideOrganizerEmail?: boolean;
  maxActiveBookingsPerBooker?: number | null;
  maxActiveBookingPerBookerOfferReschedule?: boolean;
  customReplyToEmail?: string | null;
  eventTypeColor?: EventTypeColorInput;

  /** When `true`, rescheduled bookings keep the same round-robin host. */
  rescheduleWithSameRoundRobinHost?: boolean;
  secondaryEmailId?: number | null;
  useBookerTimezone?: boolean;
  restrictionScheduleId?: number | null;
  bookingRequiresAuthentication?: boolean;
  /** Enables round-robin host subset selection. */
  rrHostSubsetEnabled?: boolean;
  createdAt?: Date | null;
  updatedAt?: Date | null;

  // ── Extended fields ───────────────────────────────────────────────────
  aiPhoneCallConfig?: AiPhoneCallConfig;
  calVideoSettings?: CalVideoSettings;
  calAiPhoneScript?: string;
  customInputs?: CustomInputSchema[];
  destinationCalendar?: DestinationCalendarInput;
  users?: number[];
  /** Child event types for managed paradigm propagation. */
  children?: ChildInput[];
  /** Host assignments for team paradigms (RR, collective, managed). See `HostInput`. */
  hosts?: HostInput[];
  schedule?: number | null;
  instantMeetingSchedule?: number | null;
  multiplePrivateLinks?: (string | HashedLinkInput)[];
  /** Named host groups for segment-based round-robin assignment. */
  hostGroups?: HostGroupInput[];
  enablePerHostLocations?: boolean;
};

export type TabMap = {
  advanced: React.ReactNode;
  ai?: React.ReactNode;
  apps?: React.ReactNode;
  availability: React.ReactNode;
  instant?: React.ReactNode;
  limits: React.ReactNode;
  recurring: React.ReactNode;
  setup: React.ReactNode;
  team?: React.ReactNode;
  webhooks?: React.ReactNode;
  workflows?: React.ReactNode;
  payments?: React.ReactNode;
};

export type SettingsToggleClassNames = {
  container?: string;
  label?: string;
  description?: string;
  children?: string;
};

export type InputClassNames = {
  container?: string;
  label?: string;
  input?: string;
  addOn?: string;
};
export type CheckboxClassNames = {
  checkbox?: string;
  description?: string;
  container?: string;
};
export type SelectClassNames = {
  innerClassNames?: {
    input?: string;
    option?: string;
    control?: string;
    singleValue?: string;
    valueContainer?: string;
    multiValue?: string;
    menu?: string;
    menuList?: string;
  };
  select?: string;
  label?: string;
  container?: string;
};

// Re-export schemas from server-safe location
export { EventTypeDuplicateInput, createEventTypeInput } from "./schemas";

export type FormValidationResult = {
  isValid: boolean;
  errors: Record<string, unknown>;
};

export interface EventTypePlatformWrapperRef {
  validateForm: () => Promise<FormValidationResult>;
  handleFormSubmit: (callbacks?: { onSuccess?: () => void; onError?: (error: Error) => void }) => void;
}

export type CalVideoSettings = {
  disableRecordingForGuests?: boolean | null;
  disableRecordingForOrganizer?: boolean | null;
  enableAutomaticTranscription?: boolean | null;
  enableAutomaticRecordingForOrganizer?: boolean | null;
  disableTranscriptionForGuests?: boolean | null;
  disableTranscriptionForOrganizer?: boolean | null;
  redirectUrlOnExit?: string | null;
  requireEmailForGuests?: boolean | null;
} | null;

// ============================================================================
// MANAGED EVENT TYPE PUSH TYPES (AG-003)
// ============================================================================
// These types describe the input configuration, per-member state, and
// distribution result for managed event type push operations. They are
// consumed by the managed event type push workflow in:
//   - checkForEmptyAssignment.ts (validation)
//   - managedEventTypePush.ts    (delta computation)
//   - eventTypeParity.test.ts    (test assertions)
// ============================================================================

/**
 * Configuration input for a managed event type push operation (AG-003).
 *
 * Describes the admin template configuration and target member list for
 * distributing a managed event type template (`SchedulingType.MANAGED`)
 * from a parent to child event types across team members.
 *
 * Used by `validateManagedEventTypePushPreconditions` in `checkForEmptyAssignment.ts`
 * and `computeManagedEventTypePushDelta` in `managedEventTypePush.ts`.
 *
 * @see packages/features/ee/managed-event-types/lib/handleChildrenEventTypes.ts
 */
export type ManagedEventTypePushConfig = {
  /** The parent managed event type ID */
  eventTypeId: number;
  /** Title of the managed event type template */
  title: string;
  /** Slug of the managed event type template */
  slug: string;
  /** Must be "MANAGED" for push operations */
  schedulingType: "MANAGED" | null;
  /** The team ID this managed event type belongs to */
  teamId: number | null;
  /** When true, all team members should receive the managed event type */
  assignAllTeamMembers: boolean;
  /** Explicit list of team member user IDs to push the event type to */
  targetMemberIds: number[];
  /** Optional metadata for the managed event type template */
  metadata?: unknown;
};

/**
 * Represents a team member's state relative to a managed event type push (AG-003).
 *
 * Used in `ManagedEventTypeDistributionResult` to describe the outcome
 * for each individual team member in a push operation.
 */
export type ManagedEventTypePushMember = {
  /** The team member's user ID */
  userId: number;
  /** The child event type ID if one exists */
  childEventTypeId?: number;
  /** Current status of the member's managed event type */
  status: "new" | "existing" | "removed";
};

/**
 * Result metadata from a managed event type push distribution operation (AG-003).
 *
 * Captures the distribution delta: which members received new child event types,
 * which existing members were updated, and which were removed. This type is
 * returned by `computeManagedEventTypePushDelta` in `managedEventTypePush.ts`.
 *
 * Aligns with the existing `handleChildrenEventTypes` return contract which
 * returns `newUserIds`, `oldUserIds`, `deletedUserIds` arrays.
 *
 * @see packages/features/ee/managed-event-types/lib/handleChildrenEventTypes.ts
 */
export type ManagedEventTypeDistributionResult = {
  /** The parent managed event type ID that was pushed */
  parentEventTypeId: number;
  /** User IDs of members who will receive a new child event type */
  newMemberIds: number[];
  /** User IDs of members who already have a child and need updates */
  existingMemberIds: number[];
  /** User IDs of members whose child event type should be removed */
  removedMemberIds: number[];
  /** Detailed per-member status */
  members: ManagedEventTypePushMember[];
  /** Total number of team members affected by this push */
  totalAffected: number;
};
