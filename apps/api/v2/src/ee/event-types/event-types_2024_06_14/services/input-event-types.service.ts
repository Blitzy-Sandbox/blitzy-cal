import { ConnectedCalendarsData } from "@/ee/calendars/outputs/connected-calendars.output";
import { CalendarsService } from "@/ee/calendars/services/calendars.service";
import { EventTypesRepository_2024_06_14 } from "@/ee/event-types/event-types_2024_06_14/event-types.repository";
import { InputEventTransformed_2024_06_14 } from "@/ee/event-types/event-types_2024_06_14/transformed";
import {
  transformBookingFieldsApiToInternal,
  transformLocationsApiToInternal,
  transformIntervalLimitsApiToInternal,
  transformFutureBookingLimitsApiToInternal,
  transformRecurrenceApiToInternal,
  systemBeforeFieldName,
  systemBeforeFieldEmail,
  systemBeforeFieldLocation,
  systemAfterFieldTitle,
  systemAfterFieldNotes,
  systemAfterFieldGuests,
  systemAfterFieldRescheduleReason,
  transformBookerLayoutsApiToInternal,
  transformConfirmationPolicyApiToInternal,
  transformEventColorsApiToInternal,
  transformSeatsApiToInternal,
  SystemField,
  CustomField,
  InternalLocation,
  InternalLocationSchema,
} from "@/ee/event-types/event-types_2024_06_14/transformers";
import { UserWithProfile } from "@/modules/users/users.repository";
import { Injectable, BadRequestException } from "@nestjs/common";

import { slugifyLenient } from "@calcom/platform-libraries";
import { getApps, getUsersCredentialsIncludeServiceAccountKey } from "@calcom/platform-libraries/app-store";
import {
  validateCustomEventName,
  EventTypeMetaDataSchema,
  EventTypeMetadata,
} from "@calcom/platform-libraries/event-types";
import {
  CreateEventTypeInput_2024_06_14,
  DestinationCalendar_2024_06_14,
  InputBookingField_2024_06_14,
  OutputUnknownLocation_2024_06_14,
  UpdateEventTypeInput_2024_06_14,
  supportedIntegrations,
} from "@calcom/platform-types";
import { BookerLayouts } from "@calcom/prisma/zod-utils";

/**
 * Context object used by `validateEventTypeInputs` to apply cross-field
 * validation rules.  When performing UPDATE operations the service fetches
 * the current database values and merges them with the incoming payload so
 * that partial-update semantics are respected.
 *
 * Paradigm coverage (Sprint 2 – Event Types F-002):
 * - ET-002 (Group/Seats): `seatsPerTimeSlot` drives mutual-exclusion rules
 *   against `locations` and `requiresConfirmation`.
 * - ET-005 (Booking Windows): booking window fields are validated at the
 *   transformer layer; `eventName` custom-name validation applies to all
 *   paradigms uniformly.
 */
interface ValidationContext {
  eventTypeId?: number;
  seatsPerTimeSlot?: number | null;
  locations?: InputEventTransformed_2024_06_14["locations"];
  requiresConfirmation?: boolean;
  eventName?: string;
}

/**
 * NestJS service responsible for transforming and validating API-level
 * create / update payloads into the internal event-type representation
 * consumed by `EventTypesRepository_2024_06_14`.
 *
 * **Paradigm support (Sprint 2 – Event Types F-002):**
 *
 * | Paradigm       | Epic   | Handling strategy                                        |
 * |----------------|--------|----------------------------------------------------------|
 * | 1:1 (default)  | ET-001 | Base transformation — all explicit + `...rest` fields     |
 * | Group (seats)  | ET-002 | `transformInputSeatOptions` + seat validation rules       |
 * | Round-Robin    | ET-003 | RR-specific fields (`schedulingType`,                     |
 * |                |        | `rescheduleWithSameRoundRobinHost`, `rrHostSubsetEnabled`)|
 * |                |        | pass through `...rest`; hosts handled by org service      |
 * | Collective     | ET-004 | `assignAllTeamMembers` handled by org service;            |
 * |                |        | availability intersection computed downstream             |
 * | Booking Window | ET-005 | `transformInputBookingWindow` + `minimumBookingNotice`    |
 * |                |        | via `...rest`                                             |
 * | Custom Fields  | ET-006 | `transformInputBookingFields` covers all Calendly         |
 * |                |        | question types (text, radio, checkbox, phone, dropdown)   |
 *
 * **Architecture note:** For team event types, `InputOrganizationsEventTypesService`
 * destructures team-specific fields (`assignAllTeamMembers`, `locations`,
 * `emailSettings`) and delegates the base transformation to this service via
 * `transformInputCreateEventType(rest)` / `transformInputUpdateEventType(rest, id)`.
 * Team-specific fields like `hosts`, `schedulingType`,
 * `rescheduleWithSameRoundRobinHost`, and `rrHostSubsetEnabled` pass through
 * the `...rest` spread operator safely and are included in the final object,
 * with the org service overriding `hosts` and `assignAllTeamMembers` afterward.
 */
@Injectable()
export class InputEventTypesService_2024_06_14 {
  constructor(
    private readonly eventTypesRepository: EventTypesRepository_2024_06_14,
    private readonly calendarsService: CalendarsService
  ) {}

  /**
   * Transforms and validates a CREATE event type payload.
   *
   * Applies to personal (1:1) event types directly and to the base portion
   * of team event types when called via `InputOrganizationsEventTypesService`.
   * Validation order: locations → body transformation → cross-field rules →
   * destination calendar → use-destination-calendar-email.
   *
   * ET-002: Seat mutual-exclusion rules (seats ↔ locations, seats ↔ confirmation)
   * are enforced in `validateEventTypeInputs`.
   */
  async transformAndValidateCreateEventTypeInput(
    user: UserWithProfile,
    inputEventType: CreateEventTypeInput_2024_06_14
  ) {
    await this.validateInputLocations(user, inputEventType.locations);
    const transformedBody = this.transformInputCreateEventType(inputEventType);

    await this.validateEventTypeInputs({
      seatsPerTimeSlot: transformedBody?.seatsPerTimeSlot || null,
      locations: transformedBody.locations,
      requiresConfirmation: transformedBody.requiresConfirmation,
      eventName: transformedBody.eventName,
    });

    if (transformedBody.destinationCalendar) {
      await this.validateInputDestinationCalendar(user.id, transformedBody.destinationCalendar);
    }

    if (transformedBody.useEventTypeDestinationCalendarEmail) {
      await this.validateInputUseDestinationCalendarEmail(user.id);
    }

    return transformedBody;
  }

  /**
   * Transforms and validates an UPDATE event type payload.
   *
   * On update the current DB record is fetched so that partial-update
   * semantics can be enforced: only the fields present in the payload
   * overwrite existing values; absent fields default to their DB values
   * when evaluating cross-field validation rules (ET-002 seat constraints).
   *
   * ET-003 / ET-004: When this method is called from the org service for
   * team event types, RR/collective-specific fields (`schedulingType`,
   * `rescheduleWithSameRoundRobinHost`, etc.) are already in the `rest`
   * payload and pass through to the returned object safely.
   */
  async transformAndValidateUpdateEventTypeInput(
    inputEventType: UpdateEventTypeInput_2024_06_14,
    user: UserWithProfile,
    eventTypeId: number
  ) {
    await this.validateInputLocations(user, inputEventType.locations);

    const transformedBody = await this.transformInputUpdateEventType(inputEventType, eventTypeId);

    await this.validateEventTypeInputs({
      eventTypeId: eventTypeId,
      seatsPerTimeSlot: transformedBody.seatsPerTimeSlot,
      locations: transformedBody.locations,
      requiresConfirmation: transformedBody.requiresConfirmation,
      eventName: transformedBody.eventName,
    });

    if (transformedBody.destinationCalendar) {
      await this.validateInputDestinationCalendar(user.id, transformedBody.destinationCalendar);
    }

    if (transformedBody.useEventTypeDestinationCalendarEmail) {
      await this.validateInputUseDestinationCalendarEmail(user.id);
    }

    return transformedBody;
  }

  /**
   * Transforms a CREATE payload from API format to the internal representation.
   *
   * **`...rest` paradigm-safety audit (Sprint 2):**
   * Fields that are explicitly destructured receive dedicated transformation.
   * All remaining fields pass through `...rest` into the event type object.
   * For personal event types (`CreateEventTypeInput_2024_06_14`), `rest` includes:
   *   `title`, `description`, `slotInterval`, `minimumBookingNotice` (ET-005),
   *   `beforeEventBuffer`, `afterEventBuffer`, `scheduleId`,
   *   `requiresBookerEmailVerification`, `hideCalendarNotes`,
   *   `lockTimeZoneToggleOnBookingPage`, `hidden`, `bookingRequiresAuthentication`,
   *   `onlyShowFirstAvailableSlot`, `offsetStart`, `destinationCalendar`,
   *   `hideCalendarEventDetails`, `successRedirectUrl`, `hideOrganizerEmail`,
   *   `interfaceLanguage`, `allowReschedulingPastBookings`,
   *   `allowReschedulingCancelledBookings`, `showOptimizedSlots`.
   *
   * When called from `InputOrganizationsEventTypesService` for team events,
   * `rest` additionally contains: `schedulingType` (ET-003/ET-004),
   * `hosts`, `rescheduleWithSameRoundRobinHost` (ET-003),
   * `rrHostSubsetEnabled` (ET-003). These all pass through safely.
   */
  transformInputCreateEventType(inputEventType: CreateEventTypeInput_2024_06_14) {
    const {
      lengthInMinutes,
      lengthInMinutesOptions,
      locations,
      bookingFields,
      bookingLimitsCount,
      bookingLimitsDuration,
      bookingWindow,
      bookerLayouts,
      confirmationPolicy,
      color,
      recurrence,
      seats,
      customName,
      useDestinationCalendarEmail,
      disableGuests,
      bookerActiveBookingsLimit,
      slug,
      disableRescheduling,
      disableCancelling,
      calVideoSettings,
      ...rest
    } = inputEventType;
    const confirmationPolicyTransformed = this.transformInputConfirmationPolicy(confirmationPolicy);

    const locationsTransformed = locations?.length ? this.transformInputLocations(locations) : undefined;

    const effectiveBookingFields =
      disableGuests !== undefined
        ? this.getBookingFieldsWithGuestsToggled(bookingFields, disableGuests)
        : bookingFields;

    const maxActiveBookingsPerBooker = bookerActiveBookingsLimit
      ? this.transformInputBookerActiveBookingsLimit(bookerActiveBookingsLimit)
      : {};

    const slugifiedSlug = slugifyLenient(slug);

    const metadata: EventTypeMetadata = {
      bookerLayouts: this.transformInputBookerLayouts(bookerLayouts),
      requiresConfirmationThreshold:
        confirmationPolicyTransformed?.requiresConfirmationThreshold ?? undefined,
      multipleDuration: lengthInMinutesOptions,
    };

    const disableReschedulingTransformed = this.transformInputDisableRescheduling(disableRescheduling);
    const disableCancellingTransformed = this.transformInputDisableCancelling(disableCancelling);
    const calVideoSettingsTransformed = this.transformInputCalVideoSettings(calVideoSettings);

    const eventType = {
      ...rest,
      slug: slugifiedSlug,
      length: lengthInMinutes,
      locations: locationsTransformed,
      bookingFields: this.transformInputBookingFields(effectiveBookingFields),
      bookingLimits: bookingLimitsCount ? this.transformInputIntervalLimits(bookingLimitsCount) : undefined,
      durationLimits: bookingLimitsDuration
        ? this.transformInputIntervalLimits(bookingLimitsDuration)
        : undefined,
      ...this.transformInputBookingWindow(bookingWindow),
      metadata,
      requiresConfirmation: confirmationPolicyTransformed?.requiresConfirmation ?? undefined,
      requiresConfirmationWillBlockSlot:
        confirmationPolicyTransformed?.requiresConfirmationWillBlockSlot ?? undefined,
      eventTypeColor: this.transformInputEventTypeColor(color),
      recurringEvent: recurrence ? this.transformInputRecurrignEvent(recurrence) : undefined,
      ...this.transformInputSeatOptions(seats),
      eventName: customName,
      useEventTypeDestinationCalendarEmail: useDestinationCalendarEmail,
      ...maxActiveBookingsPerBooker,
      ...disableReschedulingTransformed,
      ...disableCancellingTransformed,
      ...calVideoSettingsTransformed,
    };

    return eventType;
  }

  transformInputBookerActiveBookingsLimit(
    bookerActiveBookingsLimit: CreateEventTypeInput_2024_06_14["bookerActiveBookingsLimit"]
  ) {
    if (!bookerActiveBookingsLimit || bookerActiveBookingsLimit.disabled) {
      return {
        maxActiveBookingsPerBooker: null,
        maxActiveBookingPerBookerOfferReschedule: false,
      };
    }
    return {
      maxActiveBookingsPerBooker: bookerActiveBookingsLimit?.maximumActiveBookings,
      maxActiveBookingPerBookerOfferReschedule: bookerActiveBookingsLimit?.offerReschedule,
    };
  }

  /**
   * Transforms an UPDATE payload from API format to the internal representation.
   *
   * Fetches the existing event type metadata from the DB so that partial-update
   * payloads can be merged with existing values (e.g., bookerLayouts,
   * confirmationThreshold, multipleDuration).
   *
   * **`...rest` paradigm-safety audit (Sprint 2):**
   * Same as `transformInputCreateEventType` — all non-destructured fields pass
   * through safely. For update payloads all fields are optional, so `rest` only
   * contains the fields the caller chose to include.
   *
   * **ET-002 seat update semantics:** When `seats` is not provided (undefined),
   * the spread `{ seatsPerTimeSlot: undefined }` is used. In Prisma `undefined`
   * means "do not update this field", preserving the existing seat configuration.
   * When `seats` is provided, all three fields (`seatsPerTimeSlot`,
   * `seatsShowAttendees`, `seatsShowAvailabilityCount`) are transformed and applied.
   */
  async transformInputUpdateEventType(inputEventType: UpdateEventTypeInput_2024_06_14, eventTypeId: number) {
    const {
      lengthInMinutes,
      lengthInMinutesOptions,
      locations,
      bookingFields,
      bookingLimitsCount,
      bookingLimitsDuration,
      bookingWindow,
      bookerLayouts,
      confirmationPolicy,
      color,
      recurrence,
      seats,
      customName,
      useDestinationCalendarEmail,
      disableGuests,
      bookerActiveBookingsLimit,
      slug,
      disableRescheduling,
      disableCancelling,
      calVideoSettings,
      ...rest
    } = inputEventType;
    const eventTypeDb = await this.eventTypesRepository.getEventTypeWithMetaData(eventTypeId);
    const metadataTransformed = eventTypeDb?.metadata
      ? EventTypeMetaDataSchema.parse(eventTypeDb.metadata)
      : {};

    const confirmationPolicyTransformed = this.transformInputConfirmationPolicy(confirmationPolicy);

    const effectiveBookingFields =
      disableGuests !== undefined
        ? this.getBookingFieldsWithGuestsToggled(bookingFields, disableGuests)
        : bookingFields;

    const maxActiveBookingsPerBooker = bookerActiveBookingsLimit
      ? this.transformInputBookerActiveBookingsLimit(bookerActiveBookingsLimit)
      : {};

    const metadata: EventTypeMetadata = {
      ...metadataTransformed,
      ...(bookerLayouts !== undefined
        ? { bookerLayouts: this.transformInputBookerLayouts(bookerLayouts) }
        : {}),
      ...(confirmationPolicy !== undefined
        ? {
            requiresConfirmationThreshold:
              confirmationPolicyTransformed?.requiresConfirmationThreshold ?? undefined,
          }
        : {}),
      ...(lengthInMinutesOptions !== undefined ? { multipleDuration: lengthInMinutesOptions } : {}),
    };

    const disableReschedulingTransformed = disableRescheduling
      ? this.transformInputDisableRescheduling(disableRescheduling)
      : {};
    const disableCancellingTransformed = disableCancelling
      ? this.transformInputDisableCancelling(disableCancelling)
      : {};
    const calVideoSettingsTransformed = calVideoSettings
      ? this.transformInputCalVideoSettings(calVideoSettings)
      : {};

    const eventType = {
      ...rest,
      ...(slug ? { slug: slugifyLenient(slug) } : {}),
      length: lengthInMinutes,
      locations: locations ? this.transformInputLocations(locations) : undefined,
      bookingFields: effectiveBookingFields
        ? this.transformInputBookingFields(effectiveBookingFields)
        : undefined,
      bookingLimits: bookingLimitsCount ? this.transformInputIntervalLimits(bookingLimitsCount) : undefined,
      durationLimits: bookingLimitsDuration
        ? this.transformInputIntervalLimits(bookingLimitsDuration)
        : undefined,
      ...this.transformInputBookingWindow(bookingWindow),
      metadata,
      recurringEvent: recurrence ? this.transformInputRecurrignEvent(recurrence) : undefined,
      requiresConfirmation: confirmationPolicyTransformed?.requiresConfirmation ?? undefined,
      requiresConfirmationWillBlockSlot:
        confirmationPolicyTransformed?.requiresConfirmationWillBlockSlot ?? undefined,
      eventTypeColor: this.transformInputEventTypeColor(color),
      ...(seats ? this.transformInputSeatOptions(seats) : { seatsPerTimeSlot: undefined }),
      eventName: customName,
      useEventTypeDestinationCalendarEmail: useDestinationCalendarEmail,
      ...maxActiveBookingsPerBooker,
      ...disableReschedulingTransformed,
      ...disableCancellingTransformed,
      ...calVideoSettingsTransformed,
    };

    return eventType;
  }

  /**
   * Toggles the `hidden` state on the "guests" booking field.
   *
   * When `disableGuests` is set on the event type, this method injects or
   * updates a guests field with `hidden: true`. This operates before the
   * booking-field transformation pipeline and does not affect custom field ordering.
   */
  getBookingFieldsWithGuestsToggled(
    bookingFields: InputBookingField_2024_06_14[] | undefined,
    hideGuests: boolean
  ) {
    const toggledGuestsBookingField: InputBookingField_2024_06_14 = { slug: "guests", hidden: hideGuests };
    if (!bookingFields) {
      return [toggledGuestsBookingField];
    }

    const bookingFieldsCopy = [...bookingFields];

    const guestsBookingField = bookingFieldsCopy.find((field) => "slug" in field && field.slug === "guests");
    if (guestsBookingField) {
      Object.assign(guestsBookingField, { hidden: hideGuests });
      return bookingFieldsCopy;
    }

    bookingFieldsCopy.push(toggledGuestsBookingField);
    return bookingFieldsCopy;
  }

  transformInputLocations(inputLocations: CreateEventTypeInput_2024_06_14["locations"]) {
    return transformLocationsApiToInternal(inputLocations);
  }

  /**
   * Transforms booking fields from the API input format to internal format.
   *
   * **ET-006 — Custom Fields/Questions Parity:**
   * All Calendly question types are correctly handled through the
   * `transformBookingFieldsApiToInternal` transformer:
   *
   * | Calendly Type | Cal.com field.type | Transformer handling                |
   * |---------------|-------------------|--------------------------------------|
   * | text          | `text`            | Generic handler + no options          |
   * | radio         | `radio`           | `fieldIsSelect` + options via mapper  |
   * | checkbox      | `checkbox`        | `fieldIsSelect` + options via mapper  |
   * | phone         | `phone`           | Attendee-phone guard or generic       |
   * | dropdown      | `select`          | Generic handler + top-level options   |
   *
   * Additionally supported Cal.com types (beyond Calendly):
   * `address`, `number`, `textarea`, `multiselect`, `multiEmail`, `boolean`, `url`.
   *
   * **Field ordering:** System fields are extracted and placed in a fixed order:
   * [name, email, location] → user custom fields → [title, notes, guests, rescheduleReason].
   * Custom fields of any type (including all Calendly question types) are preserved
   * in the order they appear in the API input.
   */
  transformInputBookingFields(inputBookingFields: CreateEventTypeInput_2024_06_14["bookingFields"]) {
    const internalFields: (SystemField | CustomField)[] = inputBookingFields
      ? transformBookingFieldsApiToInternal(inputBookingFields)
      : [];
    const systemCustomFields = internalFields.filter((field) => !this.isUserCustomField(field));
    const userCustomFields = internalFields.filter((field) => this.isUserCustomField(field));

    const systemCustomNameField = systemCustomFields?.find((field) => field.type === "name");
    const systemCustomEmailField = systemCustomFields?.find((field) => field.type === "email");
    const systemCustomTitleField = systemCustomFields?.find((field) => field.name === "title");
    const systemCustomLocationField = systemCustomFields?.find((field) => field.name === "location");
    const systemCustomNotesField = systemCustomFields?.find((field) => field.name === "notes");
    const systemCustomGuestsField = systemCustomFields?.find((field) => field.name === "guests");
    const systemCustomRescheduleReasonField = systemCustomFields?.find(
      (field) => field.name === "rescheduleReason"
    );

    const defaultFieldsBefore: (SystemField | CustomField)[] = [
      systemCustomNameField || systemBeforeFieldName,
      systemCustomEmailField || systemBeforeFieldEmail,
      systemCustomLocationField || systemBeforeFieldLocation,
    ];

    const defaultFieldsAfter = [
      systemCustomTitleField || systemAfterFieldTitle,
      systemCustomNotesField || systemAfterFieldNotes,
      systemCustomGuestsField || systemAfterFieldGuests,
      systemCustomRescheduleReasonField || systemAfterFieldRescheduleReason,
    ];

    const bookingFields = [...defaultFieldsBefore, ...userCustomFields, ...defaultFieldsAfter];

    if (!this.hasEmailOrPhoneOnlySetup(bookingFields)) {
      throw new BadRequestException(
        "Booking fields validation failed: visible and required email or visible and required attendee phone field is needed."
      );
    }

    return bookingFields;
  }

  /**
   * Validates that at least one primary contact method (email or phone) is
   * configured as required and visible.
   *
   * ET-006: This check is critical for phone-only booking flows where the
   * email field can be hidden/optional but the `attendeePhoneNumber` phone
   * field must then be required and visible. This matches Calendly's
   * requirement that at least one contact channel is captured.
   */
  hasEmailOrPhoneOnlySetup(bookingFields: (SystemField | CustomField)[]) {
    const emailField = bookingFields.find((field) => field.type === "email" && field.name === "email");
    const attendeePhoneNumberField = bookingFields.find(
      (field) => field.type === "phone" && field.name === "attendeePhoneNumber"
    );

    const isEmailFieldRequiredAndVisible = emailField?.required && !emailField?.hidden;
    const isAttendeePhoneNumberFieldRequiredAndVisible =
      attendeePhoneNumberField?.required && !attendeePhoneNumberField?.hidden;

    return isEmailFieldRequiredAndVisible || isAttendeePhoneNumberFieldRequiredAndVisible;
  }

  /**
   * Determines whether a booking field is a user-defined custom field.
   *
   * ET-006: System fields are identified by `type` (name, email) or `name`
   * (title, notes, guests, rescheduleReason, location). Everything else —
   * including all Calendly question types (text, radio, checkbox, phone,
   * select/dropdown, address, textarea, number, multiselect, boolean, url) —
   * is classified as a custom field and placed between the system-before and
   * system-after groups in the booking form.
   */
  isUserCustomField(field: SystemField | CustomField): field is CustomField {
    return (
      field.type !== "name" &&
      field.type !== "email" &&
      field.name !== "title" &&
      field.name !== "notes" &&
      field.name !== "guests" &&
      field.name !== "rescheduleReason" &&
      field.name !== "location"
    );
  }

  transformInputIntervalLimits(inputBookingFields: CreateEventTypeInput_2024_06_14["bookingLimitsCount"]) {
    return transformIntervalLimitsApiToInternal(inputBookingFields);
  }

  /**
   * Transforms booking window configuration from API to internal format.
   *
   * **ET-005 — Booking Window Configuration Alignment:**
   * Delegates to `transformFutureBookingLimitsApiToInternal` which handles
   * all Calendly-equivalent booking window options:
   *
   * | Calendly option        | API type        | Internal periodType   | Extra fields              |
   * |------------------------|-----------------|-----------------------|---------------------------|
   * | Days into future       | `businessDays`  | ROLLING/ROLLING_WINDOW| periodDays, !calendarDays |
   * | Days into future       | `calendarDays`  | ROLLING/ROLLING_WINDOW| periodDays, calendarDays  |
   * | Date range             | `range`         | RANGE                 | periodStartDate/EndDate   |
   * | Indefinitely           | `disabled:true` | UNLIMITED             | (none)                    |
   *
   * The business-day vs calendar-day distinction (AVL-GAP-001) is correctly
   * encoded via `periodCountCalendarDays` (false = business days, true = calendar days).
   *
   * Note: `minimumBookingNotice` is NOT handled here — it passes through
   * the `...rest` spread operator in both create and update flows.
   */
  transformInputBookingWindow(inputBookingWindow: CreateEventTypeInput_2024_06_14["bookingWindow"]) {
    const res = transformFutureBookingLimitsApiToInternal(inputBookingWindow);
    return res ? res : {};
  }

  transformInputBookerLayouts(inputBookerLayouts: CreateEventTypeInput_2024_06_14["bookerLayouts"]) {
    const layouts = transformBookerLayoutsApiToInternal(inputBookerLayouts);
    if (!layouts) return undefined;
    return {
      defaultLayout: layouts.defaultLayout as unknown as BookerLayouts,
      enabledLayouts: layouts.enabledLayouts as unknown as BookerLayouts[],
    };
  }

  /**
   * Transforms confirmation policy from API format to internal representation.
   *
   * Paradigm note: Confirmation policy applies to all paradigms but has a
   * mutual-exclusion relationship with seats (ET-002): when seats are enabled,
   * `requiresConfirmation` must be false. This constraint is enforced by
   * `validateSeatsRequiresConfirmationFalseRule`.
   */
  transformInputConfirmationPolicy(
    requiresConfirmation: CreateEventTypeInput_2024_06_14["confirmationPolicy"]
  ) {
    return transformConfirmationPolicyApiToInternal(requiresConfirmation);
  }

  /**
   * Transforms recurrence configuration from API format to internal representation.
   * Returns `undefined` when recurrence is disabled or absent.
   *
   * Paradigm note: Recurrence is paradigm-agnostic — it applies identically
   * across all 6 scheduling paradigms.
   */
  transformInputRecurrignEvent(recurrence: CreateEventTypeInput_2024_06_14["recurrence"]) {
    if (!recurrence || recurrence.disabled) {
      return undefined;
    }

    return transformRecurrenceApiToInternal(recurrence);
  }

  transformInputEventTypeColor(color: CreateEventTypeInput_2024_06_14["color"]) {
    return transformEventColorsApiToInternal(color);
  }

  /**
   * Transforms seat configuration from API to internal format.
   *
   * **ET-002 — Group Event Type Parity via `seatsPerTimeSlot`:**
   * Delegates to `transformSeatsApiToInternal` which maps:
   * - `seats.seatsPerTimeSlot`    → `seatsPerTimeSlot` (max attendees per slot)
   * - `seats.showAttendeeInfo`    → `seatsShowAttendees` (visibility flag)
   * - `seats.showAvailabilityCount` → `seatsShowAvailabilityCount` (remaining count)
   *
   * When `seats` is disabled or undefined, returns `{ seatsPerTimeSlot: null }`.
   */
  transformInputSeatOptions(seats: CreateEventTypeInput_2024_06_14["seats"]) {
    return transformSeatsApiToInternal(seats);
  }

  /**
   * Applies cross-field validation rules.
   *
   * **ET-002 seat mutual-exclusion rules (Calendly parity):**
   * 1. Seats enabled → only 1 location allowed (group events have a single venue)
   * 2. Seats enabled → requiresConfirmation must be false (auto-confirm for group)
   * 3. Multiple locations → seats must be disabled
   * 4. requiresConfirmation → seats must be disabled
   *
   * For UPDATE operations (`eventTypeId` present), current DB values are fetched
   * and merged with incoming values so that partial updates don't bypass rules.
   */
  async validateEventTypeInputs({
    eventTypeId,
    seatsPerTimeSlot,
    locations,
    requiresConfirmation,
    eventName,
  }: ValidationContext) {
    let seatsPerTimeSlotDb: number | null = null;
    let locationsDb: ReturnType<typeof this.transformLocations> = [];
    let requiresConfirmationDb = false;

    if (eventTypeId != null) {
      const eventTypeDb = await this.eventTypesRepository.getEventTypeWithSeats(eventTypeId);
      seatsPerTimeSlotDb = eventTypeDb?.seatsPerTimeSlot ?? null;
      locationsDb = this.transformLocations(eventTypeDb?.locations) ?? [];
      requiresConfirmationDb = eventTypeDb?.requiresConfirmation ?? false;
    }

    const seatsPerTimeSlotFinal = seatsPerTimeSlot ? seatsPerTimeSlot : seatsPerTimeSlotDb;
    const seatsEnabledFinal = !!seatsPerTimeSlotFinal && seatsPerTimeSlotFinal > 0;

    const locationsFinal = locations !== undefined ? locations : locationsDb;
    const requiresConfirmationFinal =
      requiresConfirmation !== undefined ? requiresConfirmation : requiresConfirmationDb;
    this.validateSeatsSingleLocationRule(seatsEnabledFinal, locationsFinal);
    this.validateSeatsRequiresConfirmationFalseRule(seatsEnabledFinal, requiresConfirmationFinal);
    this.validateMultipleLocationsSeatsDisabledRule(locationsFinal, seatsEnabledFinal);
    this.validateRequiresConfirmationSeatsDisabledRule(requiresConfirmationFinal, seatsEnabledFinal);

    if (eventName) {
      await this.validateCustomEventNameInput(eventName);
    }
  }
  validateSeatsSingleLocationRule(
    seatsEnabled: boolean,
    locations: ReturnType<typeof this.transformLocations>
  ) {
    if (seatsEnabled && locations.length > 1) {
      throw new BadRequestException(
        "Seats Validation failed: Seats are enabled but more than one location provided."
      );
    }
  }
  /**
   * Parses raw DB location JSON into typed `InternalLocation` objects.
   *
   * Used exclusively within `validateEventTypeInputs` to build the validation
   * context from existing DB values. Unknown location formats are silently
   * discarded because they are not relevant to the seat/location mutual-exclusion
   * rules — only the count of known locations matters.
   *
   * Paradigm note: Location validation is paradigm-agnostic; the rules apply
   * identically across 1:1, group, RR, collective, managed, and dynamic types.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transformLocations(locations: any) {
    if (!locations) return [];

    const knownLocations: InternalLocation[] = [];
    const unknownLocations: OutputUnknownLocation_2024_06_14[] = [];

    for (const location of locations) {
      const result = InternalLocationSchema.safeParse(location);
      if (result.success) {
        knownLocations.push(result.data);
      } else {
        unknownLocations.push({ type: "unknown", location: JSON.stringify(location) });
      }
    }
    return [...knownLocations];
  }

  validateSeatsRequiresConfirmationFalseRule(seatsEnabled: boolean, requiresConfirmation: boolean) {
    if (seatsEnabled && requiresConfirmation) {
      throw new BadRequestException(
        "Seats Validation failed: Seats are enabled but requiresConfirmation is true."
      );
    }
  }

  validateMultipleLocationsSeatsDisabledRule(
    locations: ReturnType<typeof this.transformLocations>,
    seatsEnabled: boolean
  ) {
    if (locations.length > 1 && seatsEnabled) {
      throw new BadRequestException("Locations Validation failed: Multiple locations but seats are enabled.");
    }
  }

  validateRequiresConfirmationSeatsDisabledRule(requiresConfirmation: boolean, seatsEnabled: boolean) {
    if (requiresConfirmation && seatsEnabled) {
      throw new BadRequestException(
        "RequiresConfirmation Validation failed: Seats are enabled but requiresConfirmation is true."
      );
    }
  }

  async validateCustomEventNameInput(value: string) {
    const validationResult = validateCustomEventName(value);
    if (validationResult !== true) {
      throw new BadRequestException(`Invalid event name variables: ${validationResult}`);
    }
    return;
  }

  /**
   * Validates that the specified destination calendar exists, belongs to the
   * user, and has write permissions.
   *
   * Paradigm note: Destination calendar validation applies to all paradigms.
   * For team event types, the user parameter is the event type owner.
   */
  async validateInputDestinationCalendar(
    userId: number,
    destinationCalendar: DestinationCalendar_2024_06_14
  ) {
    const calendars: ConnectedCalendarsData = await this.calendarsService.getCalendars(userId);

    const allCals = calendars.connectedCalendars.map((cal) => cal.calendars ?? []).flat();

    const matchedCalendar = allCals.find(
      (cal) =>
        cal.externalId === destinationCalendar.externalId &&
        cal.integration === destinationCalendar.integration
    );

    if (!matchedCalendar) {
      throw new BadRequestException("Invalid destinationCalendarId: Calendar does not exist");
    }

    if (matchedCalendar.readOnly) {
      throw new BadRequestException("Invalid destinationCalendarId: Calendar does not have write permission");
    }

    return;
  }

  /**
   * Validates that a primary connected calendar exists when the
   * `useDestinationCalendarEmail` flag is set.
   */
  async validateInputUseDestinationCalendarEmail(userId: number) {
    const calendars: ConnectedCalendarsData = await this.calendarsService.getCalendars(userId);

    const allCals = calendars.connectedCalendars.map((cal) => cal.calendars ?? []).flat();

    const primaryCalendar = allCals.find((cal) => cal.primary);

    if (!primaryCalendar) {
      throw new BadRequestException(
        "Validation failed: A primary connected calendar is required to set useDestinationCalendarEmail"
      );
    }

    return;
  }

  /**
   * Validates that all integration-type locations reference apps that are
   * installed and connected for the user.
   *
   * Paradigm note: Location validation is paradigm-agnostic. `cal-video` is
   * globally available and is skipped. All other conferencing apps require
   * verified credentials. For team event types, the org service calls this
   * via the user who owns the event type.
   */
  async validateInputLocations(
    user: UserWithProfile,
    inputLocations: CreateEventTypeInput_2024_06_14["locations"] | undefined
  ) {
    await Promise.all(
      inputLocations?.map(async (location) => {
        if (location.type === "integration") {
          // cal-video is global, so we can skip this check
          if (location.integration !== "cal-video") {
            await this.checkAppIsValidAndConnected(user, location.integration);
          }
        }
      }) ?? []
    );
  }

  async checkAppIsValidAndConnected(user: UserWithProfile, appSlug: string) {
    const conferencingApps = supportedIntegrations as readonly string[];
    if (!conferencingApps.includes(appSlug)) {
      throw new BadRequestException("Invalid app, available apps are: ", conferencingApps.join(", "));
    }

    // Map API integration names to actual app slugs
    const slugMap: Record<string, string> = {
      "office365-video": "msteams",
      "facetime-video": "facetime",
      "whereby-video": "whereby",
      "whatsapp-video": "whatsapp",
      "webex-video": "webex",
      "telegram-video": "telegram",
      "sylaps-video": "sylapsvideo",
      "skype-video": "skype",
      "sirius-video": "sirius_video",
      "signal-video": "signal",
      "shimmer-video": "shimmervideo",
      "salesroom-video": "salesroom",
      "roam-video": "roam",
      "riverside-video": "riverside",
      "ping-video": "ping",
      "mirotalk-video": "mirotalk",
      "jelly-video": "jelly",
      "jelly-conferencing": "jelly",
      "huddle": "huddle01",
      "element-call-video": "element-call",
      "eightxeight-video": "eightxeight",
      "discord-video": "discord",
      "demodesk-video": "demodesk",
      "campfire-video": "campfire",
    };

    appSlug = slugMap[appSlug] || appSlug;

    const credentials = await getUsersCredentialsIncludeServiceAccountKey(user);

    const foundApp = getApps(credentials, true).filter((app) => app.slug === appSlug)[0];

    const appLocation = foundApp?.appData?.location;

    if (!foundApp || !appLocation) {
      throw new BadRequestException(`${appSlug} not connected.`);
    }
    return foundApp.credential;
  }

  /**
   * Transforms rescheduling-disable settings from API format.
   *
   * Maps to internal fields:
   * - `disabled: true` → `disableRescheduling: true`, `minimumRescheduleNotice: null`
   * - `minutesBefore: N` → `disableRescheduling: false`, `minimumRescheduleNotice: N`
   * - Otherwise → `disableRescheduling: false`, `minimumRescheduleNotice: null`
   *
   * Paradigm note: Rescheduling controls apply identically to all paradigms.
   */
  transformInputDisableRescheduling(disableRescheduling: CreateEventTypeInput_2024_06_14["disableRescheduling"]) {
    if (!disableRescheduling) {
      return {};
    }

    // If disabled is true, rescheduling is always disabled
    if (disableRescheduling.disabled === true) {
      return {
        disableRescheduling: true,
        minimumRescheduleNotice: null,
      };
    }

    // If minutesBefore is set, use it for conditional disable
    if (disableRescheduling.minutesBefore && disableRescheduling.minutesBefore > 0) {
      return {
        disableRescheduling: false,
        minimumRescheduleNotice: disableRescheduling.minutesBefore,
      };
    }

    // Otherwise rescheduling is not disabled
    return {
      disableRescheduling: false,
      minimumRescheduleNotice: null,
    };
  }

  /**
   * Transforms cancelling-disable settings from API format.
   * Maps `disabled: true` → `disableCancelling: true`.
   *
   * Paradigm note: Cancelling controls apply identically to all paradigms.
   */
  transformInputDisableCancelling(disableCancelling: CreateEventTypeInput_2024_06_14["disableCancelling"]) {
    if (!disableCancelling) {
      return {};
    }

    return {
      disableCancelling: disableCancelling.disabled === true,
    };
  }

  /**
   * Transforms Cal Video settings from API format. Extracts
   * `sendTranscriptionEmails` and maps to `canSendCalVideoTranscriptionEmails`.
   * Remaining settings are passed through as `calVideoSettings`.
   *
   * Paradigm note: Cal Video settings apply identically to all paradigms.
   */
  transformInputCalVideoSettings(calVideoSettings: CreateEventTypeInput_2024_06_14["calVideoSettings"]) {
    if (!calVideoSettings) {
      return {};
    }

    // Extract sendTranscriptionEmails from calVideoSettings and map to canSendCalVideoTranscriptionEmails
    const { sendTranscriptionEmails, ...restCalVideoSettings } = calVideoSettings;

    const hasOtherSettings = Object.keys(restCalVideoSettings).length > 0;

    return {
      ...(hasOtherSettings ? { calVideoSettings: restCalVideoSettings } : {}),
      ...(sendTranscriptionEmails !== undefined
        ? { canSendCalVideoTranscriptionEmails: sendTranscriptionEmails }
        : {}),
    };
  }
}
