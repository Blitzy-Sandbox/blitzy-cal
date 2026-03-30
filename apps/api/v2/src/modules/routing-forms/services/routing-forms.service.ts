import { CreateRoutingFormInput } from "@/modules/routing-forms/inputs/create-routing-form.input";
import { SubmitRoutingFormInput } from "@/modules/routing-forms/inputs/submit-routing-form.input";
import { UpdateRoutingFormInput } from "@/modules/routing-forms/inputs/update-routing-form.input";
import { RoutingFormsRepository } from "@/modules/routing-forms/routing-forms.repository";
import { SlotsService_2024_09_04 } from "@/modules/slots/slots-2024-09-04/services/slots.service";
import { TeamsEventTypesRepository } from "@/modules/teams/event-types/teams-event-types.repository";
import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Request } from "express";

import { getRoutedUrl } from "@calcom/platform-libraries";
import type { Prisma } from "@calcom/prisma/client";
import { ById_2024_09_04_type, GetAvailableSlotsInput_2024_09_04 } from "@calcom/platform-types";

/**
 * Service layer for routing form operations.
 * Provides CRUD operations and form submission handling for RF-004 API v2 parity.
 * All data access is delegated to RoutingFormsRepository following the repository pattern.
 */
@Injectable()
export class RoutingFormsService {
  constructor(
    private readonly teamsEventTypesRepository: TeamsEventTypesRepository,
    private readonly slotsService: SlotsService_2024_09_04,
    private readonly routingFormsRepository: RoutingFormsRepository
  ) {}

  async calculateSlotsBasedOnRoutingFormResponse(
    request: Request,
    formId: string,
    slotsQuery: GetAvailableSlotsInput_2024_09_04
  ) {
    const eventTypeId = await this.getRoutedEventTypeId(request, formId);

    if (!eventTypeId) {
      throw new NotFoundException("Event type not found.");
    }
    const slots = await this.slotsService.getAvailableSlots({
      type: ById_2024_09_04_type,
      eventTypeId,
      ...slotsQuery,
    });

    return {
      eventTypeId,
      slots,
    };
  }

  /**
   * Creates a new routing form with field definitions and optional route configurations.
   * @see RF-004 — POST /v2/routing-forms
   */
  async createRoutingForm(userId: number, data: CreateRoutingFormInput) {
    return this.routingFormsRepository.createRoutingForm({
      name: data.name,
      description: data.description,
      fields: data.fields as unknown as Prisma.InputJsonValue,
      routes: (data.routes as unknown as Prisma.InputJsonValue) ?? undefined,
      userId,
      teamId: data.teamId,
      disabled: data.disabled ?? false,
    });
  }

  /**
   * Retrieves a single routing form by its ID, scoped to the authenticated user.
   * Throws NotFoundException if the form does not exist or is not owned by the user.
   * @param routingFormId - The unique identifier of the routing form
   * @param userId - The authenticated user's ID for ownership verification
   * @see RF-004 — GET /v2/routing-forms/:routingFormId
   */
  async getRoutingForm(routingFormId: string, userId: number) {
    const form = await this.routingFormsRepository.getRoutingFormById(routingFormId, userId);
    if (!form) {
      throw new NotFoundException(`Routing form with id ${routingFormId} not found.`);
    }
    return form;
  }

  /**
   * Lists routing forms for the authenticated user with cursor-based pagination.
   * The userId is always derived from the authenticated user context to prevent
   * cross-user form enumeration.
   *
   * @param userId - The authenticated user's ID (required, derived from auth context)
   * @param teamId - Optional team ID filter
   * @param pagination - Optional pagination parameters (limit and cursor)
   * @see RF-004 — GET /v2/routing-forms
   */
  async listRoutingForms(
    userId: number,
    teamId?: number,
    pagination?: { limit?: number; cursor?: string }
  ) {
    return this.routingFormsRepository.listRoutingForms({ userId, teamId }, pagination);
  }

  /**
   * Partially updates an existing routing form. Only provided fields are modified.
   * Verifies ownership via userId before applying updates.
   * Throws NotFoundException if the form does not exist or is not owned by the user.
   * @param routingFormId - The unique identifier of the routing form
   * @param data - Partial update payload
   * @param userId - The authenticated user's ID for ownership verification
   * @see RF-004 — PATCH /v2/routing-forms/:routingFormId
   */
  async updateRoutingForm(routingFormId: string, data: UpdateRoutingFormInput, userId: number) {
    const existingForm = await this.routingFormsRepository.getRoutingFormById(routingFormId, userId);
    if (!existingForm) {
      throw new NotFoundException(`Routing form with id ${routingFormId} not found.`);
    }
    const updatePayload: Partial<{
      name: string;
      description: string;
      fields: Prisma.InputJsonValue;
      routes: Prisma.InputJsonValue;
      settings: Prisma.InputJsonValue;
      disabled: boolean;
    }> = {};
    if (data.name !== undefined) updatePayload.name = data.name;
    if (data.description !== undefined) updatePayload.description = data.description;
    if (data.fields !== undefined) updatePayload.fields = data.fields as unknown as Prisma.InputJsonValue;
    if (data.routes !== undefined) updatePayload.routes = data.routes as unknown as Prisma.InputJsonValue;
    if (data.settings !== undefined) updatePayload.settings = data.settings as unknown as Prisma.InputJsonValue;
    if (data.disabled !== undefined) updatePayload.disabled = data.disabled;
    return this.routingFormsRepository.updateRoutingForm(routingFormId, updatePayload);
  }

  /**
   * Permanently deletes a routing form and its associated configuration.
   * Verifies ownership via userId before deletion.
   * Throws NotFoundException if the form does not exist or is not owned by the user.
   * @param routingFormId - The unique identifier of the routing form
   * @param userId - The authenticated user's ID for ownership verification
   * @see RF-004 — DELETE /v2/routing-forms/:routingFormId
   */
  async deleteRoutingForm(routingFormId: string, userId: number) {
    const existingForm = await this.routingFormsRepository.getRoutingFormById(routingFormId, userId);
    if (!existingForm) {
      throw new NotFoundException(`Routing form with id ${routingFormId} not found.`);
    }
    return this.routingFormsRepository.deleteRoutingForm(routingFormId);
  }

  /**
   * Submits a response to a routing form. Validates required fields are present,
   * stores the response, and returns the submission result.
   * @see RF-004 — POST /v2/routing-forms/:routingFormId/submit
   */
  async submitRoutingFormResponse(routingFormId: string, data: SubmitRoutingFormInput) {
    const form = await this.routingFormsRepository.getRoutingFormById(routingFormId);
    if (!form) {
      throw new NotFoundException(`Routing form with id ${routingFormId} not found.`);
    }

    // Validate submitted field values against the form's field definitions
    const formFields =
      (form.fields as Array<{ id: string; type: string; required?: boolean }>) || [];
    for (const field of formFields) {
      if (field.required) {
        const response = data.responses[field.id];
        if (
          !response ||
          response.value === undefined ||
          response.value === null ||
          response.value === ""
        ) {
          throw new BadRequestException(
            `Required field "${field.id}" is missing or empty in the submission.`
          );
        }
      }
    }

    // Store the form response via the repository
    const formResponse = await this.routingFormsRepository.createRoutingFormResponse({
      formId: routingFormId,
      response: data.responses as unknown as Prisma.InputJsonValue,
    });

    return {
      formId: routingFormId,
      responseId: String(formResponse.id),
      createdAt: formResponse.createdAt,
    };
  }

  private async getRoutedEventTypeId(request: Request, formId: string) {
    const routingUrl = await this.getRoutingUrl(request, formId);
    if (!this.isEventTypeRedirectUrl(routingUrl)) {
      throw new NotFoundException("Routed to a non cal.com event type URL.");
    }

    const { teamId, eventTypeSlug } = this.extractTeamIdAndEventTypeSlugFromRedirectUrl(routingUrl);

    const eventType = await this.teamsEventTypesRepository.getEventTypeByTeamIdAndSlug(teamId, eventTypeSlug);
    return eventType?.id;
  }

  private async getRoutingUrl(request: Request, formId: string) {
    const params = Object.fromEntries(new URLSearchParams(request.body));
    const routedUrlData = await getRoutedUrl({
      req: request,
      query: { ...params, "cal.isBookingDryRun": "true", form: formId },
    });

    const destination = routedUrlData?.redirect?.destination;

    if (!destination) {
      throw new NotFoundException("Route to which the form response should be redirected not found.");
    }

    return new URL(destination);
  }

  private extractTeamIdAndEventTypeSlugFromRedirectUrl(routingUrl: URL) {
    const eventTypeSlug = this.extractEventTypeFromRoutedUrl(routingUrl);
    const teamId = this.extractTeamIdFromRoutedUrl(routingUrl);

    if (!teamId) {
      throw new NotFoundException("Team ID not found in the routed URL.");
    }

    if (!eventTypeSlug) {
      throw new NotFoundException("Event type slug not found in the routed URL.");
    }

    return { teamId, eventTypeSlug };
  }

  private isEventTypeRedirectUrl(routingUrl: URL) {
    const routingSearchParams = routingUrl.searchParams;
    return routingSearchParams.get("cal.action") === "eventTypeRedirectUrl";
  }

  private extractTeamIdFromRoutedUrl(routingUrl: URL) {
    const routingSearchParams = routingUrl.searchParams;
    return Number(routingSearchParams.get("cal.teamId"));
  }

  private extractEventTypeFromRoutedUrl(routingUrl: URL) {
    const pathNameParams = routingUrl.pathname.split("/");
    return pathNameParams[pathNameParams.length - 1];
  }
}
