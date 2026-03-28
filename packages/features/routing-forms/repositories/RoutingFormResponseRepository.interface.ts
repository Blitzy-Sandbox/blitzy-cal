import type { App_RoutingForms_Form, App_RoutingForms_FormResponse } from "@calcom/prisma/client";

export interface RoutingFormResponseRepositoryInterface {
  findByIdIncludeForm(
    id: number
  ): Promise<{
    response: App_RoutingForms_FormResponse["response"];
    form: Pick<App_RoutingForms_Form, "fields" | "name" | "description" | "userId" | "teamId">;
  } | null>;

  findByBookingUidIncludeForm(
    bookingUid: string
  ): Promise<(App_RoutingForms_FormResponse & { form: { fields: App_RoutingForms_Form["fields"] } }) | null>;

  findAllByFormId(
    formId: string,
    options?: { limit?: number; offset?: number }
  ): Promise<
    {
      id: number;
      response: App_RoutingForms_FormResponse["response"];
      createdAt: Date;
      chosenRouteId: string | null;
      routedToBookingUid: string | null;
    }[]
  >;

  findByFormIdWithPagination(
    formId: string,
    pagination: { page: number; pageSize: number }
  ): Promise<
    {
      id: number;
      response: App_RoutingForms_FormResponse["response"];
      createdAt: Date;
      chosenRouteId: string | null;
      routedToBookingUid: string | null;
    }[]
  >;

  countByFormId(formId: string): Promise<number>;

  findResponsesForSlotCalculation(formId: string): Promise<
    {
      id: number;
      response: App_RoutingForms_FormResponse["response"];
      chosenRouteId: string | null;
      createdAt: Date;
      routedToBookingUid: string | null;
      form: {
        fields: App_RoutingForms_Form["fields"];
        routes: App_RoutingForms_Form["routes"];
      };
    }[]
  >;

  deleteResponse(id: number): Promise<{ id: number }>;
}
