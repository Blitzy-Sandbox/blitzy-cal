import { PrismaReadService } from "@/modules/prisma/prisma-read.service";
import { PrismaWriteService } from "@/modules/prisma/prisma-write.service";
import { Injectable } from "@nestjs/common";

import type { Prisma } from "@calcom/prisma/client";

/**
 * Repository layer for routing form data access operations.
 * Uses PrismaReadService for read queries and PrismaWriteService for mutations.
 *
 * @see RF-004 — API v2 Routing Forms CRUD parity with Calendly
 */
@Injectable()
export class RoutingFormsRepository {
  constructor(
    private readonly dbRead: PrismaReadService,
    private readonly dbWrite: PrismaWriteService
  ) {}

  /** Retrieves a team-scoped routing form by team ID and form ID. */
  async getTeamRoutingForm(teamId: number, routingFormId: string) {
    return this.dbRead.prisma.app_RoutingForms_Form.findFirst({
      where: {
        id: routingFormId,
        teamId,
      },
    });
  }

  /**
   * Retrieves a single routing form by its ID, including all stored fields and routes.
   * When userId is provided, adds ownership scoping to the query for authorization.
   * @param routingFormId - The unique identifier of the routing form
   * @param userId - Optional user ID for ownership verification. When provided, only returns
   *                 the form if it belongs to the specified user.
   */
  async getRoutingFormById(routingFormId: string, userId?: number) {
    const where: Prisma.App_RoutingForms_FormWhereInput = { id: routingFormId };
    if (userId !== undefined) {
      where.userId = userId;
    }
    return this.dbRead.prisma.app_RoutingForms_Form.findFirst({
      where,
    });
  }

  /**
   * Lists routing forms with optional filtering by userId and/or teamId.
   * Returns all forms matching the provided criteria.
   */
  async listRoutingForms(where: { userId?: number; teamId?: number }) {
    const prismaWhere: Prisma.App_RoutingForms_FormWhereInput = {};
    if (where.userId !== undefined) {
      prismaWhere.userId = where.userId;
    }
    if (where.teamId !== undefined) {
      prismaWhere.teamId = where.teamId;
    }
    return this.dbRead.prisma.app_RoutingForms_Form.findMany({
      where: prismaWhere,
      orderBy: { createdAt: "desc" },
    });
  }

  /**
   * Creates a new routing form with the provided data.
   * Fields and routes are stored as JSONB columns.
   */
  async createRoutingForm(data: {
    name: string;
    description?: string;
    fields: Prisma.InputJsonValue;
    routes?: Prisma.InputJsonValue;
    userId: number;
    teamId?: number;
    disabled?: boolean;
  }) {
    return this.dbWrite.prisma.app_RoutingForms_Form.create({
      data: {
        name: data.name,
        description: data.description ?? "",
        fields: data.fields,
        routes: data.routes ?? [],
        userId: data.userId,
        teamId: data.teamId ?? null,
        disabled: data.disabled ?? false,
      },
    });
  }

  /**
   * Partially updates an existing routing form. Only the provided fields are modified.
   * Uses Prisma's update to atomically apply changes.
   */
  async updateRoutingForm(
    routingFormId: string,
    data: Partial<{
      name: string;
      description: string;
      fields: Prisma.InputJsonValue;
      routes: Prisma.InputJsonValue;
      settings: Prisma.InputJsonValue;
      disabled: boolean;
    }>
  ) {
    return this.dbWrite.prisma.app_RoutingForms_Form.update({
      where: { id: routingFormId },
      data,
    });
  }

  /** Permanently deletes a routing form and returns the deleted record. */
  async deleteRoutingForm(routingFormId: string) {
    return this.dbWrite.prisma.app_RoutingForms_Form.delete({
      where: { id: routingFormId },
    });
  }

  /** Retrieves all form responses for a given routing form, ordered by creation date. */
  async getRoutingFormResponses(routingFormId: string) {
    return this.dbRead.prisma.app_RoutingForms_FormResponse.findMany({
      where: { formId: routingFormId },
      orderBy: { createdAt: "desc" },
    });
  }

  /**
   * Creates a new form response record. Stores the response data as JSONB.
   * Used by the submit endpoint to persist form submissions.
   */
  async createRoutingFormResponse(data: { formId: string; response: Prisma.InputJsonValue }) {
    return this.dbWrite.prisma.app_RoutingForms_FormResponse.create({
      data: {
        formId: data.formId,
        response: data.response,
      },
    });
  }
}
