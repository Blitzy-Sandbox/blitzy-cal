import type { PrismaClient } from "@calcom/prisma";
import prisma from "@calcom/prisma";

import type { RoutingFormResponseRepositoryInterface } from "./RoutingFormResponseRepository.interface";

export class PrismaRoutingFormResponseRepository implements RoutingFormResponseRepositoryInterface {
  constructor(private readonly prismaClient: PrismaClient = prisma) {}

  findByIdIncludeForm(id: number) {
    return this.prismaClient.app_RoutingForms_FormResponse.findUnique({
      where: {
        id,
      },
      select: {
        response: true,
        form: {
          select: {
            fields: true,
            name: true,
            description: true,
            userId: true,
            teamId: true,
          },
        },
      },
    });
  }

  findByBookingUidIncludeForm(bookingUid: string) {
    return this.prismaClient.app_RoutingForms_FormResponse.findUnique({
      where: {
        routedToBookingUid: bookingUid,
      },
      include: {
        form: {
          select: {
            fields: true,
          },
        },
      },
    });
  }

  async findAllByFormId(formId: string, options?: { limit?: number; offset?: number }) {
    const limit = options?.limit ?? 50;
    const offset = options?.offset ?? 0;
    return this.prismaClient.app_RoutingForms_FormResponse.findMany({
      where: {
        formId,
      },
      select: {
        id: true,
        response: true,
        createdAt: true,
        chosenRouteId: true,
        routedToBookingUid: true,
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
    });
  }

  async findByFormIdWithPagination(formId: string, pagination: { page: number; pageSize: number }) {
    const { page, pageSize } = pagination;
    const skip = (page - 1) * pageSize;
    return this.prismaClient.app_RoutingForms_FormResponse.findMany({
      where: {
        formId,
      },
      select: {
        id: true,
        response: true,
        createdAt: true,
        chosenRouteId: true,
        routedToBookingUid: true,
      },
      orderBy: { createdAt: "desc" },
      take: pageSize,
      skip,
    });
  }

  async countByFormId(formId: string): Promise<number> {
    return this.prismaClient.app_RoutingForms_FormResponse.count({
      where: {
        formId,
      },
    });
  }

  /**
   * Fetches responses for slot calculation with a bounded result set.
   * Only recent responses are typically relevant for slot availability,
   * so a default limit and optional date-based filter are applied to prevent
   * loading thousands of responses into memory for popular routing forms.
   *
   * @param formId - The routing form ID to fetch responses for
   * @param limit - Maximum number of responses to return (default 500)
   * @param since - Optional date filter: only responses created after this date (default: last 90 days)
   */
  async findResponsesForSlotCalculation(
    formId: string,
    { limit = 500, since }: { limit?: number; since?: Date } = {}
  ) {
    const effectiveSince = since ?? new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

    return this.prismaClient.app_RoutingForms_FormResponse.findMany({
      where: {
        formId,
        createdAt: { gte: effectiveSince },
      },
      select: {
        id: true,
        response: true,
        chosenRouteId: true,
        createdAt: true,
        routedToBookingUid: true,
        form: {
          select: {
            fields: true,
            routes: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
  }

  async deleteResponse(id: number) {
    return this.prismaClient.app_RoutingForms_FormResponse.delete({
      where: {
        id,
      },
      select: {
        id: true,
      },
    });
  }
}
