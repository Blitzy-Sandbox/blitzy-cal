import { CreateEventTypeOutput_2024_06_14 } from "@/ee/event-types/event-types_2024_06_14/outputs/create-event-type.output";
import { DeleteEventTypeOutput_2024_06_14 } from "@/ee/event-types/event-types_2024_06_14/outputs/delete-event-type.output";
import { GetEventTypeOutput_2024_06_14 } from "@/ee/event-types/event-types_2024_06_14/outputs/get-event-type.output";
import { GetEventTypesOutput_2024_06_14 } from "@/ee/event-types/event-types_2024_06_14/outputs/get-event-types.output";
import { UpdateEventTypeOutput_2024_06_14 } from "@/ee/event-types/event-types_2024_06_14/outputs/update-event-type.output";
import { EventTypeResponseTransformPipe } from "@/ee/event-types/event-types_2024_06_14/pipes/event-type-response.transformer";
import { EventTypesService_2024_06_14 } from "@/ee/event-types/event-types_2024_06_14/services/event-types.service";
import { InputEventTypesService_2024_06_14 } from "@/ee/event-types/event-types_2024_06_14/services/input-event-types.service";
import { OutputEventTypesService_2024_06_14 } from "@/ee/event-types/event-types_2024_06_14/services/output-event-types.service";
import type { DatabaseEventType } from "@/ee/event-types/event-types_2024_06_14/services/output-event-types.service";
import { VERSION_2024_06_14_VALUE } from "@/lib/api-versions";
import {
  API_KEY_OR_ACCESS_TOKEN_HEADER,
  OPTIONAL_API_KEY_OR_ACCESS_TOKEN_HEADER,
  OPTIONAL_X_CAL_CLIENT_ID_HEADER,
  OPTIONAL_X_CAL_SECRET_KEY_HEADER,
} from "@/lib/docs/headers";
import {
  AuthOptionalUser,
  GetOptionalUser,
} from "@/modules/auth/decorators/get-optional-user/get-optional-user.decorator";
import { GetUser } from "@/modules/auth/decorators/get-user/get-user.decorator";
import { Permissions } from "@/modules/auth/decorators/permissions/permissions.decorator";
import { ApiAuthGuard } from "@/modules/auth/guards/api-auth/api-auth.guard";
import { OptionalApiAuthGuard } from "@/modules/auth/guards/optional-api-auth/optional-api-auth.guard";
import { PermissionsGuard } from "@/modules/auth/guards/permissions/permissions.guard";
import { ApiAuthGuardUser } from "@/modules/auth/strategies/api-auth/api-auth.strategy";
import { OutputTeamEventTypesResponsePipe } from "@/modules/organizations/event-types/pipes/team-event-types-response.transformer";
import type { DatabaseTeamEventType } from "@/modules/organizations/event-types/services/output.service";
import { UserWithProfile } from "@/modules/users/users.repository";
import {
  Controller,
  UseGuards,
  Get,
  Param,
  Post,
  Body,
  NotFoundException,
  Patch,
  HttpCode,
  HttpStatus,
  Delete,
  Query,
  ParseIntPipe,
} from "@nestjs/common";
import { ApiHeader, ApiOperation, ApiTags as DocsTags } from "@nestjs/swagger";

import {
  EVENT_TYPE_READ,
  EVENT_TYPE_WRITE,
  SUCCESS_STATUS,
  VERSION_2024_06_14,
} from "@calcom/platform-constants";
import {
  UpdateEventTypeInput_2024_06_14,
  GetEventTypesQuery_2024_06_14,
  CreateEventTypeInput_2024_06_14,
} from "@calcom/platform-types";

@Controller({
  path: "/v2/event-types",
  version: VERSION_2024_06_14_VALUE,
})
@UseGuards(PermissionsGuard)
@DocsTags("Event Types")
@ApiHeader({
  name: "cal-api-version",
  description: `Must be set to ${VERSION_2024_06_14}. If not set to this value, the endpoint will default to an older version.`,
  example: VERSION_2024_06_14,
  required: true,
  schema: {
    default: VERSION_2024_06_14,
  },
})
export class EventTypesController_2024_06_14 {
  constructor(
    private readonly eventTypesService: EventTypesService_2024_06_14,
    private readonly inputEventTypesService: InputEventTypesService_2024_06_14,
    private readonly eventTypeResponseTransformPipe: EventTypeResponseTransformPipe,
    private readonly outputEventTypesService: OutputEventTypesService_2024_06_14,
    private readonly outputTeamEventTypesResponsePipe: OutputTeamEventTypesResponsePipe
  ) {}

  @Post("/")
  @Permissions([EVENT_TYPE_WRITE])
  @UseGuards(ApiAuthGuard)
  @ApiHeader(API_KEY_OR_ACCESS_TOKEN_HEADER)
  @ApiOperation({
    summary: "Create an event type",
    description: `Create a personal event type supporting the following scheduling paradigms:

      **One-on-one (default):** When no seats configuration is provided, the event type is created as a standard 1:1 event with a single host paired with a single invitee.

      **Group/seated events:** Provide the \`seats\` object with \`seatsPerTimeSlot\`, \`seatsShowAttendees\`, and \`seatsShowAvailabilityCount\` to allow multiple attendees to book the same time slot up to the configured seat limit.

      **Supported configuration fields:**
      - \`bookingFields\` — Custom booking questions supporting text, radio, checkbox, phone, and dropdown field types.
      - \`bookingWindow\` — Booking window restrictions: business days into the future, calendar days into the future, a specific date range, or disabled (indefinite).
      - \`minimumBookingNotice\` — Minimum notice period in minutes before a booking can be made.
      - \`bookingLimitsCount\` / \`bookingLimitsDuration\` — Per-day/week/month/year booking count and duration limits.
      - \`confirmationPolicy\` — Require host confirmation before booking is finalized. Note: seats and confirmation are mutually exclusive.
      - \`recurrence\` — Recurring event configuration.

      **Validation rules enforced:**
      - Seated events require exactly one location configured.
      - Seated events and confirmation policy are mutually exclusive.

      For team event types (round-robin, collective, managed), use the team event types endpoint.

      <Note>Please make sure to pass in the cal-api-version header value as mentioned in the Headers section. Not passing the correct value will default to an older version of this endpoint.</Note>`,
  })
  async createEventType(
    @Body() body: CreateEventTypeInput_2024_06_14,
    @GetUser() user: UserWithProfile
  ): Promise<CreateEventTypeOutput_2024_06_14> {
    const transformedBody = await this.inputEventTypesService.transformAndValidateCreateEventTypeInput(
      user,
      body
    );

    const eventType = await this.eventTypesService.createUserEventType(user, transformedBody);

    return {
      status: SUCCESS_STATUS,
      data: this.eventTypeResponseTransformPipe.transform(eventType),
    };
  }

  @Get("/:eventTypeId")
  @Permissions([EVENT_TYPE_READ])
  @UseGuards(ApiAuthGuard)
  @ApiHeader(API_KEY_OR_ACCESS_TOKEN_HEADER)
  @ApiOperation({
    summary: "Get an event type",
    description: `Retrieve an event type by ID. The response is a **union type** determined by whether the event type belongs to a team:

      **Personal event types** (1:1, group/seated) return \`EventTypeOutput_2024_06_14\` containing:
      - \`ownerId\` and \`users\` — the host identity
      - \`seats\` — group event seat configuration (\`seatsPerTimeSlot\`, visibility flags)
      - \`bookingFields\` — custom booking questions (text, radio, checkbox, phone, dropdown)
      - \`bookingWindow\` and \`minimumBookingNotice\` — booking window restrictions
      - \`bookingUrl\` — the public booking link

      **Team event types** (round-robin, collective, managed) return \`TeamEventTypeOutput_2024_06_14\` containing:
      - \`schedulingType\` — ROUND_ROBIN, COLLECTIVE, or MANAGED
      - \`hosts\` — array of team members with \`userId\`, \`mandatory\`, \`priority\`, \`name\`, \`username\`, \`avatarUrl\`
      - \`assignAllTeamMembers\` and \`rescheduleWithSameRoundRobinHost\` — team assignment configuration
      - \`team\` — team metadata (slug, name, logoUrl)
      - \`bookingFields\`, \`bookingWindow\`, \`minimumBookingNotice\` — shared configuration fields

      The paradigm is determined by the \`teamId\` property: null indicates a personal event type, non-null indicates a team event type.

      **Access control:** This endpoint returns the event type only if the authenticated user is authorized. Authorization is granted to:
      - System admins
      - The event type owner
      - Hosts of the event type or users assigned to the event type
      - Team admins/owners of the team that owns the team event type
      - Organization admins/owners of the event type owner's organization
      - Organization admins/owners of the team's parent organization

      Note: Update and delete endpoints remain restricted to the event type owner only.

      <Note>Please make sure to pass in the cal-api-version header value as mentioned in the Headers section. Not passing the correct value will default to an older version of this endpoint.</Note>`,
  })
  async getEventTypeById(
    @Param("eventTypeId") eventTypeId: string,
    @GetUser() user: ApiAuthGuardUser
  ): Promise<GetEventTypeOutput_2024_06_14> {
    const eventType = await this.eventTypesService.getEventTypeByIdIfAuthorized(user, Number(eventTypeId));

    if (!eventType) {
      throw new NotFoundException(`Event type with id ${eventTypeId} not found`);
    }

    const responseEventType = this.isTeamEventType(eventType)
      ? await this.outputTeamEventTypesResponsePipe.transform(eventType)
      : this.eventTypeResponseTransformPipe.transform(eventType);

    return {
      status: SUCCESS_STATUS,
      data: responseEventType,
    };
  }

  private isTeamEventType(
    eventType: DatabaseTeamEventType | ({ ownerId: number } & DatabaseEventType)
  ): eventType is DatabaseTeamEventType {
    return !!eventType.teamId;
  }

  @Get("/")
  @ApiOperation({
    summary: "Get all event types",
    description: `List personal event types with complete paradigm-specific configuration. Returned event types include:

      - **One-on-one events** — standard single-host events with booking fields and window settings.
      - **Group/seated events** — events with \`seats\` configuration (\`seatsPerTimeSlot\`, \`seatsShowAttendees\`, \`seatsShowAvailabilityCount\`).
      - **Custom booking fields** — all configured booking questions (text, radio, checkbox, phone, dropdown field types) are included in the response.
      - **Booking window settings** — \`bookingWindow\` and \`minimumBookingNotice\` configurations are included.

      Hidden event types are returned only if authentication is provided and the authenticated user is the event type owner. Booking field entries marked as \`hidden: true\` are filtered from the response, but paradigm-specific fields (seats, booking windows, custom field definitions) are always preserved.

      Use the optional \`sortCreatedAt\` query parameter to order results by creation date (by ID). Accepts "asc" (oldest first) or "desc" (newest first). When not provided, no explicit ordering is applied.

      For team event types (round-robin, collective, managed), use the team event types listing endpoint.

      <Note>Please make sure to pass in the cal-api-version header value as mentioned in the Headers section. Not passing the correct value will default to an older version of this endpoint.</Note>
      `,
  })
  @UseGuards(OptionalApiAuthGuard)
  @ApiHeader(OPTIONAL_X_CAL_CLIENT_ID_HEADER)
  @ApiHeader(OPTIONAL_X_CAL_SECRET_KEY_HEADER)
  @ApiHeader(OPTIONAL_API_KEY_OR_ACCESS_TOKEN_HEADER)
  async getEventTypes(
    @Query() queryParams: GetEventTypesQuery_2024_06_14,
    @GetOptionalUser() authUser: AuthOptionalUser
  ): Promise<GetEventTypesOutput_2024_06_14> {
    const eventTypes = await this.eventTypesService.getEventTypes(queryParams, authUser);
    const eventTypesFormatted = this.eventTypeResponseTransformPipe.transform(eventTypes);
    const eventTypesWithoutHiddenFields =
      this.outputEventTypesService.getResponseEventTypesWithoutHiddenFields(eventTypesFormatted);

    return {
      status: SUCCESS_STATUS,
      data: eventTypesWithoutHiddenFields,
    };
  }

  @Patch("/:eventTypeId")
  @Permissions([EVENT_TYPE_WRITE])
  @UseGuards(ApiAuthGuard)
  @ApiHeader(API_KEY_OR_ACCESS_TOKEN_HEADER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Update an event type",
    description: `Update a personal event type with partial updates to any paradigm-specific configuration field. All fields are optional — only provided fields are updated while existing configuration is preserved.

      **Supported partial update fields include:**
      - \`seats\` — Update group event seat configuration (\`seatsPerTimeSlot\`, \`seatsShowAttendees\`, \`seatsShowAvailabilityCount\`).
      - \`bookingFields\` — Replace the entire booking fields array. Supports all question types: text, radio, checkbox, phone, and dropdown.
      - \`bookingWindow\` — Update booking window restrictions (business days, calendar days, date range, or disabled/indefinite).
      - \`minimumBookingNotice\` — Update the minimum notice period in minutes.
      - \`bookingLimitsCount\` / \`bookingLimitsDuration\` — Update per-period booking limits.
      - \`confirmationPolicy\` — Update or disable host confirmation requirement.
      - \`recurrence\` — Update recurring event settings.

      **Validation rules enforced:**
      - Seated events require exactly one location configured.
      - Seated events and confirmation policy are mutually exclusive.

      For team event type updates (round-robin hosts, collective scheduling, managed types), use the team event types update endpoint.

      <Note>Please make sure to pass in the cal-api-version header value as mentioned in the Headers section. Not passing the correct value will default to an older version of this endpoint.</Note>`,
  })
  async updateEventType(
    @Param("eventTypeId", ParseIntPipe) eventTypeId: number,
    @Body() body: UpdateEventTypeInput_2024_06_14,
    @GetUser() user: UserWithProfile
  ): Promise<UpdateEventTypeOutput_2024_06_14> {
    const transformedBody = await this.inputEventTypesService.transformAndValidateUpdateEventTypeInput(
      body,
      user,
      eventTypeId
    );

    const eventType = await this.eventTypesService.updateEventType(eventTypeId, transformedBody, user);

    return {
      status: SUCCESS_STATUS,
      data: this.eventTypeResponseTransformPipe.transform(eventType),
    };
  }

  @Delete("/:eventTypeId")
  @Permissions([EVENT_TYPE_WRITE])
  @UseGuards(ApiAuthGuard)
  @ApiHeader(API_KEY_OR_ACCESS_TOKEN_HEADER)
  @ApiOperation({
    summary: "Delete an event type",
    description: `Delete a personal event type (1:1 or group/seated) by ID. Related records including booking seats and associated bookings are cascade-deleted as defined by the database schema.

      For team event types (round-robin, collective, managed), use the team event types deletion endpoint.

      <Note>Please make sure to pass in the cal-api-version header value as mentioned in the Headers section. Not passing the correct value will default to an older version of this endpoint.</Note>`,
  })
  async deleteEventType(
    @Param("eventTypeId") eventTypeId: number,
    @GetUser("id") userId: number
  ): Promise<DeleteEventTypeOutput_2024_06_14> {
    const eventType = await this.eventTypesService.deleteEventType(eventTypeId, userId);

    return {
      status: SUCCESS_STATUS,
      data: {
        id: eventType.id,
        lengthInMinutes: eventType.length,
        slug: eventType.slug,
        title: eventType.title,
      },
    };
  }
}
