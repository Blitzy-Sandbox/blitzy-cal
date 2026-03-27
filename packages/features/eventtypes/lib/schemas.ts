import { z } from "zod";

import { eventTypeLocations, eventTypeSlug } from "@calcom/lib/zod/eventType";
import { SchedulingType } from "@calcom/prisma/enums";
import { EventTypeMetaDataSchema } from "@calcom/prisma/zod-utils";

type CalVideoSettings =
  | {
      disableRecordingForGuests?: boolean | null;
      disableRecordingForOrganizer?: boolean | null;
      enableAutomaticTranscription?: boolean | null;
      enableAutomaticRecordingForOrganizer?: boolean | null;
      disableTranscriptionForGuests?: boolean | null;
      disableTranscriptionForOrganizer?: boolean | null;
      redirectUrlOnExit?: string | null;
      requireEmailForGuests?: boolean | null;
    }
  | null
  | undefined;

/**
 * Zod schema for Cal Video (Daily.co) integration settings.
 *
 * This schema is paradigm-agnostic — CalVideo settings apply identically to all
 * six scheduling paradigms (one-on-one, group/seated, round-robin, collective,
 * managed, and dynamic event types).
 *
 * Used by both the create schema (this file) and the update schema
 * (`packages/trpc/server/routers/viewer/eventTypes/types.ts`).
 */
const calVideoSettingsSchema: z.ZodType<CalVideoSettings> = z
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

type EventTypeLocation = {
  type: string;
  address?: string;
  link?: string;
  displayLocationPublicly?: boolean;
  hostPhoneNumber?: string;
  credentialId?: number;
  teamName?: string;
  customLabel?: string;
};

type EventTypeMetadata = z.infer<typeof EventTypeMetaDataSchema>;

export type TEventTypeDuplicateInput = {
  id: number;
  slug: string;
  title: string;
  description: string;
  length: number;
  teamId?: number | null;
};

/**
 * Zod schema for event type duplication input.
 *
 * This schema validates only the overridable identity fields that the client
 * provides when duplicating an event type. Paradigm-specific configuration —
 * including `schedulingType`, `seatsPerTimeSlot`, booking window settings
 * (`periodType`, `periodDays`, `periodStartDate`, `periodEndDate`), round-robin
 * host weights/priority, collective host assignments, custom booking fields, and
 * all other advanced settings — is preserved by the server-side duplication
 * handler (`packages/trpc/server/routers/viewer/eventTypes/heavy/duplicate.handler.ts`),
 * which deep-copies these values from the source event type. The client input
 * intentionally excludes them.
 *
 * Uses `.strict()` to prevent extraneous fields in duplication requests.
 *
 * Re-exported via `types.ts` and consumed by the tRPC duplicate schema
 * (`packages/trpc/server/routers/viewer/eventTypes/heavy/duplicate.schema.ts`).
 */
export const EventTypeDuplicateInput: z.ZodType<TEventTypeDuplicateInput> = z
  .object({
    id: z.number(),
    slug: z.string(),
    title: z.string().min(1),
    description: z.string(),
    length: z.number(),
    teamId: z.number().nullish(),
  })
  .strict();

export type TCreateEventTypeInput = {
  title: string;
  slug: string;
  description?: string | null;
  length: number;
  hidden?: boolean;
  teamId?: number | null;
  schedulingType?: SchedulingType | null;
  locations?: EventTypeLocation[];
  metadata?: EventTypeMetadata;
  disableGuests?: boolean;
  slotInterval?: number | null;
  minimumBookingNotice?: number;
  beforeEventBuffer?: number;
  afterEventBuffer?: number;
  syncBuffersToCalendar?: boolean;
  scheduleId?: number;
  calVideoSettings?: CalVideoSettings;
};

/**
 * Zod schema for event type creation input.
 *
 * Validates the minimal set of fields required to create an event type across all
 * six scheduling paradigms: one-on-one (default), group/seated, round-robin,
 * collective, managed, and dynamic.
 *
 * ## Fields validated at creation time
 * - `title`, `slug`, `description`, `length` — core identity
 * - `hidden`, `locations` — made optional via `.partial()`
 * - `teamId` — associates the event type with a team (nullable for personal events)
 * - `schedulingType` — `SchedulingType` enum (ROUND_ROBIN | COLLECTIVE | MANAGED);
 *   null/undefined implies a one-on-one (1:1) event type (ET-001)
 * - `metadata` — validated via `EventTypeMetaDataSchema`; carries paradigm-agnostic
 *   metadata (e.g., apps configuration, AI phone settings)
 * - `disableGuests`, `slotInterval`, `minimumBookingNotice`, `beforeEventBuffer`,
 *   `afterEventBuffer`, `scheduleId`, `calVideoSettings` — initial scheduling config
 *
 * ## Fields configured after creation (via the update schema)
 * The following paradigm-specific fields are intentionally excluded from the create
 * schema and are set after creation through the update endpoint
 * (`packages/trpc/server/routers/viewer/eventTypes/types.ts` → `ZUpdateInputSchema`):
 *
 * - **Group events (ET-002):** `seatsPerTimeSlot`, `seatsShowAttendees`,
 *   `seatsShowAvailabilityCount`
 * - **Round-robin (ET-003):** `isRRWeightsEnabled`, `rrSegmentQueryValue`,
 *   `assignRRMembersUsingSegment`, `rescheduleWithSameRoundRobinHost`, host
 *   weights/priority (via `hosts` array)
 * - **Collective (ET-004):** `assignAllTeamMembers`, host assignments (via `hosts` array)
 * - **Booking windows (ET-005):** `periodType` (UNLIMITED | ROLLING | ROLLING_WINDOW | RANGE),
 *   `periodDays`, `periodStartDate`, `periodEndDate`, `periodCountCalendarDays`
 * - **Custom fields (ET-006):** `bookingFields` — validated by `eventTypeBookingFields`
 *   schema in `@calcom/prisma/zod-utils` which supports all Calendly question types
 *   (text, radio, checkbox, phone, select/dropdown)
 * - **Other advanced settings:** `bookingLimits`, `durationLimits`, `recurringEvent`,
 *   `requiresConfirmation`, `eventTypeColor`, `customInputs`, `destinationCalendar`
 *
 * ## Business rules
 * - The `.refine()` at the end enforces that when `teamId` is provided, a
 *   `schedulingType` must also be specified. This prevents team event types from
 *   being created without an explicit scheduling paradigm selection.
 * - `.partial({ hidden: true, locations: true })` makes `hidden` and `locations`
 *   optional — the create handler applies defaults (hidden=false, user's default locations).
 *
 * Re-exported via `types.ts` and consumed by the tRPC create schema
 * (`packages/trpc/server/routers/viewer/eventTypes/heavy/create.schema.ts`).
 */
export const createEventTypeInput: z.ZodType<TCreateEventTypeInput> = z
  .object({
    title: z.string().trim().min(1),
    slug: eventTypeSlug,
    description: z.string().nullish(),
    length: z.number().int().min(1),
    hidden: z.boolean(),
    teamId: z.number().int().nullish(),
    schedulingType: z.nativeEnum(SchedulingType).nullish(),
    locations: eventTypeLocations,
    metadata: EventTypeMetaDataSchema.optional(),
    disableGuests: z.boolean().optional(),
    slotInterval: z.number().min(0).nullish(),
    minimumBookingNotice: z.number().int().min(0).optional(),
    beforeEventBuffer: z.number().int().min(0).optional(),
    afterEventBuffer: z.number().int().min(0).optional(),
    syncBuffersToCalendar: z.boolean().optional(),
    scheduleId: z.number().int().optional(),
    calVideoSettings: calVideoSettingsSchema,
  })
  .partial({ hidden: true, locations: true })
  .refine((data) => (data.teamId ? data.teamId && data.schedulingType : true), {
    path: ["schedulingType"],
    message: "You must select a scheduling type for team events",
  })
  .refine(
    (data) => {
      // Bidirectional validation: if schedulingType requires team context, teamId must be present.
      // ROUND_ROBIN, COLLECTIVE, and MANAGED scheduling types are only valid for team event types.
      const teamOnlyTypes: string[] = [
        SchedulingType.ROUND_ROBIN,
        SchedulingType.COLLECTIVE,
        SchedulingType.MANAGED,
      ];
      if (data.schedulingType && teamOnlyTypes.includes(data.schedulingType)) {
        return !!data.teamId;
      }
      return true;
    },
    {
      path: ["teamId"],
      message:
        "Team-based scheduling types (ROUND_ROBIN, COLLECTIVE, MANAGED) require a teamId to be provided",
    }
  );
