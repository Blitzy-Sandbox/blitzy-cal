import { API_VERSIONS_VALUES } from "@/lib/api-versions";
import { API_KEY_HEADER } from "@/lib/docs/headers";
import { CreateRoutingFormInput } from "@/modules/routing-forms/inputs/create-routing-form.input";
import { SubmitRoutingFormInput } from "@/modules/routing-forms/inputs/submit-routing-form.input";
import { UpdateRoutingFormInput } from "@/modules/routing-forms/inputs/update-routing-form.input";
import {
  ResponseSlotsOutput,
  RoutingFormListOutput,
  RoutingFormOutput,
  RoutingFormOutputData,
  RoutingFormSubmissionOutput,
  RoutingFormSubmissionOutputData,
} from "@/modules/routing-forms/outputs/response-slots.output";
import { RoutingFormsService } from "@/modules/routing-forms/services/routing-forms.service";
import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, Req } from "@nestjs/common";
import { ApiHeader, ApiOperation, ApiParam, ApiTags } from "@nestjs/swagger";
import { Request } from "express";

import { SUCCESS_STATUS } from "@calcom/platform-constants";
import { GetAvailableSlotsInput_2024_09_04 } from "@calcom/platform-types";

/**
 * Maps a Prisma App_RoutingForms_Form record to the API output DTO shape.
 * Handles null→undefined conversions for optional fields and JsonValue→typed casts.
 */
function toFormOutputData(
  form: {
    id: string;
    name: string;
    description: string | null;
    fields: unknown;
    routes: unknown;
    settings: unknown;
    teamId: number | null;
    userId: number;
    disabled: boolean;
    createdAt: Date;
    updatedAt: Date;
    [key: string]: unknown;
  }
): RoutingFormOutputData {
  return {
    id: form.id,
    name: form.name,
    description: form.description ?? undefined,
    fields: (form.fields ?? []) as RoutingFormOutputData["fields"],
    routes: (form.routes ?? []) as RoutingFormOutputData["routes"],
    settings: (form.settings ?? {}) as RoutingFormOutputData["settings"],
    teamId: form.teamId ?? undefined,
    userId: form.userId,
    disabled: form.disabled,
    createdAt: form.createdAt,
    updatedAt: form.updatedAt,
  };
}

/**
 * Controller for Routing Forms API v2 endpoints.
 * Provides full CRUD operations, form submission, and slot calculation
 * for Calendly API v2 routing forms management parity.
 *
 * @see RF-004 — API v2 Routing Forms endpoint parity
 */
@Controller({
  path: "/v2/routing-forms",
  version: API_VERSIONS_VALUES,
})
@ApiTags("Routing forms")
@ApiHeader(API_KEY_HEADER)
export class RoutingFormsController {
  constructor(private readonly routingFormsService: RoutingFormsService) {}

  /**
   * Existing endpoint — Calculate available slots based on a routing form response.
   * Route path updated from "/calculate-slots" to "/:routingFormId/calculate-slots"
   * to accommodate the base path change from "/v2/routing-forms/:routingFormId" to "/v2/routing-forms".
   * The full URL remains: POST /v2/routing-forms/:routingFormId/calculate-slots
   */
  @Post("/:routingFormId/calculate-slots")
  @ApiOperation({
    summary: "Calculate slots based on routing form response",
    description:
      "It will not actually save the response just return the routed event type and slots when it can be booked.",
  })
  @ApiParam({ name: "routingFormId", description: "The ID of the routing form", type: String })
  @HttpCode(HttpStatus.OK)
  async calculateSlotsBasedOnRoutingFormResponse(
    @Req() request: Request,
    @Query() query: GetAvailableSlotsInput_2024_09_04,
    @Param("routingFormId") routingFormId: string
  ): Promise<ResponseSlotsOutput> {
    const responseSlots = await this.routingFormsService.calculateSlotsBasedOnRoutingFormResponse(
      request,
      routingFormId,
      query
    );

    return {
      status: SUCCESS_STATUS,
      data: responseSlots,
    };
  }

  /**
   * List routing forms for the authenticated user, optionally filtered by team.
   * @see RF-004 — GET /v2/routing-forms
   */
  @Get("/")
  @ApiOperation({
    summary: "List routing forms",
    description:
      "Retrieve a list of routing forms for the authenticated user, optionally filtered by team.",
  })
  @HttpCode(HttpStatus.OK)
  async listRoutingForms(
    @Query("userId") userId?: number,
    @Query("teamId") teamId?: number
  ): Promise<RoutingFormListOutput> {
    const forms = await this.routingFormsService.listRoutingForms(userId, teamId);
    return {
      status: SUCCESS_STATUS,
      data: forms.map(toFormOutputData),
    };
  }

  /**
   * Retrieve a single routing form by its ID, including field definitions and routes.
   * @see RF-004 — GET /v2/routing-forms/:routingFormId
   */
  @Get("/:routingFormId")
  @ApiOperation({
    summary: "Get a routing form",
    description:
      "Retrieve a single routing form by its ID, including field definitions and route configurations.",
  })
  @ApiParam({ name: "routingFormId", description: "The ID of the routing form", type: String })
  @HttpCode(HttpStatus.OK)
  async getRoutingForm(
    @Param("routingFormId") routingFormId: string
  ): Promise<RoutingFormOutput> {
    const form = await this.routingFormsService.getRoutingForm(routingFormId);
    return {
      status: SUCCESS_STATUS,
      data: toFormOutputData(form),
    };
  }

  /**
   * Create a new routing form with field definitions and optional route configurations.
   * @see RF-004 — POST /v2/routing-forms
   */
  @Post("/")
  @ApiOperation({
    summary: "Create a routing form",
    description:
      "Create a new routing form with field definitions and optional route configurations.",
  })
  @HttpCode(HttpStatus.CREATED)
  async createRoutingForm(
    @Body() body: CreateRoutingFormInput,
    @Req() request: Request
  ): Promise<RoutingFormOutput> {
    // Extract userId from the authenticated request context.
    // The API key authentication middleware populates request headers or user context.
    const userId = (request as Request & { userId?: number }).userId ?? 0;
    const form = await this.routingFormsService.createRoutingForm(userId, body);
    return {
      status: SUCCESS_STATUS,
      data: toFormOutputData(form),
    };
  }

  /**
   * Partially update an existing routing form. Only provided fields will be modified.
   * @see RF-004 — PATCH /v2/routing-forms/:routingFormId
   */
  @Patch("/:routingFormId")
  @ApiOperation({
    summary: "Update a routing form",
    description:
      "Partially update an existing routing form. Only provided fields will be modified.",
  })
  @ApiParam({
    name: "routingFormId",
    description: "The ID of the routing form to update",
    type: String,
  })
  @HttpCode(HttpStatus.OK)
  async updateRoutingForm(
    @Param("routingFormId") routingFormId: string,
    @Body() body: UpdateRoutingFormInput
  ): Promise<RoutingFormOutput> {
    const form = await this.routingFormsService.updateRoutingForm(routingFormId, body);
    return {
      status: SUCCESS_STATUS,
      data: toFormOutputData(form),
    };
  }

  /**
   * Permanently delete a routing form and its associated routes.
   * @see RF-004 — DELETE /v2/routing-forms/:routingFormId
   */
  @Delete("/:routingFormId")
  @ApiOperation({
    summary: "Delete a routing form",
    description: "Permanently delete a routing form and its associated routes.",
  })
  @ApiParam({
    name: "routingFormId",
    description: "The ID of the routing form to delete",
    type: String,
  })
  @HttpCode(HttpStatus.OK)
  async deleteRoutingForm(
    @Param("routingFormId") routingFormId: string
  ): Promise<RoutingFormOutput> {
    const form = await this.routingFormsService.deleteRoutingForm(routingFormId);
    return {
      status: SUCCESS_STATUS,
      data: toFormOutputData(form),
    };
  }

  /**
   * Submit a response to a routing form. The response will be stored and the form's
   * routing rules will determine the next step.
   * @see RF-004 — POST /v2/routing-forms/:routingFormId/submit
   */
  @Post("/:routingFormId/submit")
  @ApiOperation({
    summary: "Submit a routing form response",
    description:
      "Submit a response to a routing form. The response will be stored and the form's routing rules will determine the next step.",
  })
  @ApiParam({
    name: "routingFormId",
    description: "The ID of the routing form to submit to",
    type: String,
  })
  @HttpCode(HttpStatus.OK)
  async submitRoutingFormResponse(
    @Param("routingFormId") routingFormId: string,
    @Body() body: SubmitRoutingFormInput
  ): Promise<RoutingFormSubmissionOutput> {
    const submission = await this.routingFormsService.submitRoutingFormResponse(
      routingFormId,
      body
    );
    const submissionData: RoutingFormSubmissionOutputData = {
      formId: submission.formId,
      responseId: submission.responseId,
      routedTo: { status: "submitted", responseId: submission.responseId },
    };
    return {
      status: SUCCESS_STATUS,
      data: submissionData,
    };
  }
}
