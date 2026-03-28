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

  findAllByFormId(formId: string, options?: { limit?: number; offset?: number }) {
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
      orderBy: {
        createdAt: "desc",
      },
      ...(options?.limit !== undefined ? { take: options.limit } : {}),
      ...(options?.offset !== undefined ? { skip: options.offset } : {}),
    });
  }

  findByFormIdWithPagination(formId: string, pagination: { page: number; pageSize: number }) {
    const skip = (pagination.page - 1) * pagination.pageSize;
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
      orderBy: {
        createdAt: "desc",
      },
      skip,
      take: pagination.pageSize,
    });
  }

  countByFormId(formId: string) {
    return this.prismaClient.app_RoutingForms_FormResponse.count({
      where: {
        formId,
      },
    });
  }

  findResponsesForSlotCalculation(formId: string) {
    return this.prismaClient.app_RoutingForms_FormResponse.findMany({
      where: {
        formId,
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
    });
  }

  async deleteResponse(id: number) {
    const deleted = await this.prismaClient.app_RoutingForms_FormResponse.delete({
      where: {
        id,
      },
      select: {
        id: true,
      },
    });
    return { id: deleted.id };
  }
}
