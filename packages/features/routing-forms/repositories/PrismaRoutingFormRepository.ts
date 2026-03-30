import { prisma } from "@calcom/prisma";

import type {
  RoutingForm,
  RoutingFormSelect,
  SelectedFields,
  FindByIdOptions,
  RoutingFormWithUserTeamAndOrg,
  RoutingFormCreateData,
  RoutingFormUpdateData,
  RoutingFormWithRoutes,
  RoutingFormWithResponseCount,
} from "./PrismaRoutingFormRepositoryInterface";

const defaultSelect = {
  id: true,
  description: true,
  position: true,
  routes: true,
  createdAt: true,
  updatedAt: true,
  name: true,
  fields: true,
  updatedById: true,
  userId: true,
  teamId: true,
  disabled: true,
  settings: true,
} as const;

export class PrismaRoutingFormRepository {
  static async findById<T extends RoutingFormSelect | undefined = undefined>(
    id: string,
    options?: FindByIdOptions<T>
  ): Promise<SelectedFields<T> | null> {
    const select = options?.select ?? defaultSelect;
    return (await prisma.app_RoutingForms_Form.findUnique({
      where: { id },
      select,
    })) as SelectedFields<T> | null;
  }

  /**
   * Find active (non-disabled) routing forms for a user or team.
   * Bounded with an optional limit to prevent unbounded result sets.
   *
   * @param userId - Optional user ID filter
   * @param teamId - Optional team ID filter
   * @param limit - Maximum number of forms to return (default 200)
   */
  static async findActiveFormsForUserOrTeam({
    userId,
    teamId,
    limit = 200,
  }: {
    userId?: number;
    teamId?: number;
    limit?: number;
  }): Promise<{ id: string; name: string }[]> {
    if (!userId && !teamId) return [];

    const routingFormQuery = {
      select: {
        id: true,
        name: true,
      },
      orderBy: [
        {
          name: "asc" as const,
        },
      ],
      take: limit,
    };

    if (teamId) {
      return await prisma.app_RoutingForms_Form.findMany({
        where: {
          teamId: teamId,
          disabled: false,
          team: {
            members: {
              some: {
                userId: userId,
                accepted: true,
              },
            },
          },
        },
        ...routingFormQuery,
      });
    }

    return await prisma.app_RoutingForms_Form.findMany({
      where: {
        userId: userId,
        teamId: null, // Only personal forms, not team forms
        disabled: false,
      },
      ...routingFormQuery,
    });
  }

  /**
   * Retrieve routing forms belonging to a specific team.
   * Bounded with an optional limit to prevent unbounded result sets.
   * Returns forms (including disabled) ordered alphabetically by name.
   * Used by team-scoped API v2 listing endpoint (RF-004).
   *
   * @param teamId - The team ID to query forms for
   * @param limit - Maximum number of forms to return (default 200)
   */
  static async findAllByTeamId(teamId: number, { limit = 200 }: { limit?: number } = {}): Promise<RoutingForm[]> {
    return await prisma.app_RoutingForms_Form.findMany({
      where: {
        teamId,
      },
      select: defaultSelect,
      orderBy: [{ name: "asc" as const }],
      take: limit,
    });
  }

  /**
   * Retrieve a routing form by ID with full route definitions.
   * Routes and fields are JSON columns already included in defaultSelect.
   * Used by API v2 route detail endpoint (RF-004).
   */
  static async findByIdWithRoutes(id: string): Promise<RoutingFormWithRoutes | null> {
    return (await prisma.app_RoutingForms_Form.findUnique({
      where: { id },
      select: {
        ...defaultSelect,
        responses: {
          select: {
            id: true,
          },
          take: 0, // Don't actually fetch responses, just allow the relation
        },
      },
    })) as RoutingFormWithRoutes | null;
  }

  /**
   * Update an existing routing form with partial data.
   * Only fields explicitly provided (not undefined) are updated.
   * Used by API v2 PATCH endpoint (RF-004).
   */
  static async updateForm(id: string, data: RoutingFormUpdateData): Promise<RoutingForm> {
    return await prisma.app_RoutingForms_Form.update({
      where: { id },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.description !== undefined && { description: data.description }),
        ...(data.fields !== undefined && { fields: data.fields }),
        ...(data.routes !== undefined && { routes: data.routes }),
        ...(data.settings !== undefined && { settings: data.settings }),
        ...(data.disabled !== undefined && { disabled: data.disabled }),
        ...(data.position !== undefined && { position: data.position }),
      },
      select: defaultSelect,
    });
  }

  /**
   * Create a new routing form with sensible defaults.
   * Requires name and userId; other fields default to null/false/0.
   * Used by API v2 POST endpoint (RF-004).
   */
  static async createForm(data: RoutingFormCreateData): Promise<RoutingForm> {
    return await prisma.app_RoutingForms_Form.create({
      data: {
        name: data.name,
        description: data.description ?? null,
        fields: data.fields ?? undefined,
        routes: data.routes ?? undefined,
        settings: data.settings ?? undefined,
        userId: data.userId,
        teamId: data.teamId ?? null,
        disabled: data.disabled ?? false,
        position: data.position ?? 0,
      },
      select: defaultSelect,
    });
  }

  /**
   * Soft-delete a routing form by setting disabled to true.
   * Preserves data per Cal.com data preservation mandate — no hard deletes.
   * Returns minimal confirmation payload with id and disabled state.
   * Used by API v2 DELETE endpoint (RF-004).
   */
  static async deleteForm(id: string): Promise<{ id: string; disabled: boolean }> {
    return await prisma.app_RoutingForms_Form.update({
      where: { id },
      data: {
        disabled: true,
      },
      select: {
        id: true,
        disabled: true,
      },
    });
  }

  /**
   * Retrieve a routing form with its response count aggregation.
   * Combines defaultSelect fields with Prisma _count for responses.
   * Used by API v2 form detail endpoint with analytics (RF-004).
   */
  static async findFormWithResponseCount(id: string): Promise<RoutingFormWithResponseCount | null> {
    const form = await prisma.app_RoutingForms_Form.findUnique({
      where: { id },
      select: {
        ...defaultSelect,
        _count: {
          select: {
            responses: true,
          },
        },
      },
    });
    if (!form) return null;
    return {
      ...form,
      _count: form._count,
    } as RoutingFormWithResponseCount;
  }

  static async findFormByIdIncludeUserTeamAndOrg(
    formId: string
  ): Promise<RoutingFormWithUserTeamAndOrg | null> {
    return (await prisma.app_RoutingForms_Form.findUnique({
      where: {
        id: formId,
      },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            email: true,
            movedToProfileId: true,
            metadata: true,
            timeFormat: true,
            locale: true,
            organization: {
              select: {
                slug: true,
              },
            },
          },
        },
        team: {
          select: {
            parentId: true,
            parent: {
              select: {
                slug: true,
              },
            },
            slug: true,
            metadata: true,
          },
        },
      },
    })) as RoutingFormWithUserTeamAndOrg | null;
  }
}
