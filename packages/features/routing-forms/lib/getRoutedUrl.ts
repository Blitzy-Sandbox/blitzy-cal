// !IMPORTANT! changes to this file requires publishing new version of platform libraries in order for the changes to be applied to APIV2
import { createHash } from "node:crypto";
import { stringify } from "node:querystring";
import { enrichFormWithMigrationData } from "@calcom/app-store/routing-forms/enrichFormWithMigrationData";
import { getAbsoluteEventTypeRedirectUrlWithEmbedSupport } from "@calcom/app-store/routing-forms/getEventTypeRedirectUrl";
import { getResponseToStore } from "@calcom/app-store/routing-forms/lib/getResponseToStore";
import { getSerializableForm } from "@calcom/app-store/routing-forms/lib/getSerializableForm";
import { getServerTimingHeader } from "@calcom/app-store/routing-forms/lib/getServerTimingHeader";
import { findMatchingRoute } from "@calcom/app-store/routing-forms/lib/processRoute";
import { substituteVariables } from "@calcom/app-store/routing-forms/lib/substituteVariables";
import type { FormResponse } from "@calcom/app-store/routing-forms/types/types";
import { orgDomainConfig } from "@calcom/features/ee/organizations/lib/orgDomains";
import { isAuthorizedToViewFormOnOrgDomain } from "@calcom/features/routing-forms/lib/isAuthorizedToViewForm";
import { PrismaRoutingFormRepository } from "@calcom/features/routing-forms/repositories/PrismaRoutingFormRepository";
import { getRoutingTraceService } from "@calcom/features/routing-trace/di/RoutingTraceService.container";
import { RoutingFormTraceService } from "@calcom/features/routing-trace/domains/RoutingFormTraceService";
import { UserRepository } from "@calcom/features/users/repositories/UserRepository";
import { checkRateLimitAndThrowError } from "@calcom/lib/checkRateLimitAndThrowError";
import { HttpError } from "@calcom/lib/http-error";
import logger from "@calcom/lib/logger";
import { safeStringify } from "@calcom/lib/safeStringify";
import { withReporting } from "@calcom/lib/sentryWrapper";
import prisma from "@calcom/prisma";
import { TRPCError } from "@trpc/server";
import type { GetServerSidePropsContext } from "next";
import { v4 as uuidv4 } from "uuid";
import z from "zod";
import { getUrlSearchParamsToForward } from "./getUrlSearchParamsToForward";
import { handleResponse } from "./handleResponse";

const log = logger.getSubLogger({ prefix: ["[routing-forms]", "[router]"] });
const querySchema = z
  .object({
    form: z.string(),
  })
  .catchall(z.string().or(z.array(z.string())));

const getDeterministicHashForResponse = (fieldsResponses: Record<string, unknown>) => {
  const sortedFields = Object.keys(fieldsResponses)
    .sort()
    .reduce((obj: Record<string, unknown>, key) => {
      obj[key] = fieldsResponses[key];
      return obj;
    }, {});
  const paramsString = JSON.stringify(sortedFields);
  const hash = createHash("sha256").update(paramsString).digest("hex");
  return hash;
};

export function hasEmbedPath(pathWithQuery: string) {
  const onlyPath = pathWithQuery.split("?")[0];
  return onlyPath.endsWith("/embed") || onlyPath.endsWith("/embed/");
}

/**
 * Normalizes raw query parameter values based on their corresponding form field types.
 * Ensures Calendly-equivalent field types are correctly interpreted from URL query parameters
 * before they enter the routing pipeline via getResponseToStore and getFieldResponseForJsonLogic.
 *
 * Normalization rules by field type:
 * - multiselect: comma-separated strings are split into arrays for consistent array handling
 * - checkbox: "true"/"false" strings are case-normalized; comma-separated multi-checkbox values
 *   are split into arrays (matching Calendly's multi-checkbox question behavior)
 * - number: values are validated as numeric strings with a warning logged for invalid inputs
 *   (actual string-to-number conversion is deferred to getFieldResponseForJsonLogic)
 *
 * @param fieldsResponses - Raw field responses extracted from URL query parameters
 * @param fields - Form field definitions containing type information for normalization
 * @returns A shallow copy of fieldsResponses with values normalized per field type
 */
function normalizeFieldsResponsesForFieldTypes(
  fieldsResponses: Record<string, string | string[]>,
  fields: readonly { id: string; label: string; identifier?: string; type: string; fieldType?: string }[]
): Record<string, string | string[]> {
  const normalized = { ...fieldsResponses };

  for (const field of fields) {
    // Resolve the field identifier using the same logic as getFieldIdentifier: identifier ?? label
    const identifier = field.identifier || field.label;
    const rawValue = normalized[identifier];
    if (rawValue === undefined) continue;

    // Prefer the strict Calendly-aligned fieldType discriminator over the legacy type string
    const effectiveType = field.fieldType || field.type;

    if (effectiveType === "multiselect") {
      // Multiselect fields: split comma-separated strings into arrays.
      // Array values from repeated query params (e.g., ?field=a&field=b) are already arrays
      // via the querySchema's z.string().or(z.array(z.string())) catchall.
      if (typeof rawValue === "string" && rawValue.includes(",")) {
        normalized[identifier] = rawValue.split(",").map((v) => v.trim());
      }
    } else if (effectiveType === "checkbox") {
      if (typeof rawValue === "string") {
        const lowerValue = rawValue.toLowerCase();
        if (lowerValue === "true" || lowerValue === "false") {
          // Single boolean checkbox: normalize casing for consistent downstream processing.
          // The value remains a string here; handleResponse's validator accepts both boolean and string.
          normalized[identifier] = lowerValue;
        } else if (rawValue.includes(",")) {
          // Multi-checkbox field: comma-separated values represent multiple selected options,
          // matching Calendly's checkbox question type which supports multiple selections.
          normalized[identifier] = rawValue.split(",").map((v) => v.trim());
        }
      }
      // Array values (from repeated query params) are already correctly shaped
    } else if (effectiveType === "number") {
      // Number fields: validate the string is a valid numeric representation.
      // Actual conversion from string to number is handled downstream by getFieldResponseForJsonLogic.
      if (typeof rawValue === "string" && rawValue !== "" && Number.isNaN(Number(rawValue))) {
        log.warn("Non-numeric value received for number field", {
          fieldId: field.id,
          identifier,
          value: rawValue,
        });
      }
    }
  }

  return normalized;
}

const _getRoutedUrl = async (context: Pick<GetServerSidePropsContext, "query" | "req">, fetchCrm = true) => {
  // Initialize trace service for tracking routing decisions
  const routingTraceService = getRoutingTraceService();

  const queryParsed = querySchema.safeParse(context.query);
  const isEmbed = hasEmbedPath(context.req.url || "");
  const pageProps = {
    isEmbed,
  };

  if (!queryParsed.success) {
    log.warn("Error parsing query", { issues: queryParsed.error.issues });
    return {
      notFound: true,
    };
  }

  // TODO: Known params reserved by Cal.com are form, embed, layout and other cal. prefixed params. We should exclude all of them from fieldsResponses.
  // But they must be present in `paramsToBeForwardedAsIs` as they could be needed by Booking Page as well.
  const {
    form: formId,
    "cal.isBookingDryRun": isBookingDryRunParam,
    "cal.queueFormResponse": queueFormResponseParam,
    ...fieldsResponses
  } = queryParsed.data;

  const responseHash = getDeterministicHashForResponse(fieldsResponses);

  await checkRateLimitAndThrowError({
    identifier: `form:${formId}:hash:${responseHash}`,
  });

  const isBookingDryRun = isBookingDryRunParam === "true";
  const shouldQueueFormResponse = queueFormResponseParam === "true";
  const paramsToBeForwardedAsIs = {
    ...fieldsResponses,
    // Must be forwarded if present to Booking Page. Setting it explicitly here as it is critical to be present in the URL.
    ...(isBookingDryRunParam ? { "cal.isBookingDryRun": isBookingDryRunParam } : null),
  };

  const { currentOrgDomain } = orgDomainConfig(context.req);

  let timeTaken: Record<string, number | null> = {};

  const formQueryStart = performance.now();
  const form = await PrismaRoutingFormRepository.findFormByIdIncludeUserTeamAndOrg(formId);
  timeTaken.formQuery = performance.now() - formQueryStart;

  if (!form) {
    return {
      notFound: true,
    };
  }

  const profileEnrichmentStart = performance.now();
  const userRepo = new UserRepository(prisma);
  const formWithUserProfile = {
    ...form,
    user: await userRepo.enrichUserWithItsProfile({ user: form.user }),
  };
  timeTaken.profileEnrichment = performance.now() - profileEnrichmentStart;

  if (
    !isAuthorizedToViewFormOnOrgDomain({
      user: formWithUserProfile.user,
      currentOrgDomain,
      team: form.team,
    })
  ) {
    return {
      notFound: true,
    };
  }

  const getSerializableFormStart = performance.now();
  const serializableForm = await getSerializableForm({
    form: enrichFormWithMigrationData(formWithUserProfile),
  });
  timeTaken.getSerializableForm = performance.now() - getSerializableFormStart;

  if (!serializableForm.fields) {
    throw new Error("Form has no fields");
  }

  // Normalize field responses based on form field types before building the response object.
  // This ensures Calendly-equivalent field types (multiselect arrays from comma-separated strings,
  // checkbox boolean value normalization, and number field validation) are correctly interpreted
  // before entering the routing pipeline via getResponseToStore and getFieldResponseForJsonLogic.
  const normalizedFieldsResponses = normalizeFieldsResponsesForFieldTypes(
    fieldsResponses,
    serializableForm.fields
  );

  const response: FormResponse = getResponseToStore({
    formFields: serializableForm.fields,
    fieldsResponses: normalizedFieldsResponses,
  });

  let routingFormTraceService: RoutingFormTraceService | undefined;
  if (!isBookingDryRun) {
    routingFormTraceService = new RoutingFormTraceService(routingTraceService);
  }
  const matchingRoute = findMatchingRoute({ form: serializableForm, response, routingFormTraceService });
  if (!matchingRoute) {
    throw new Error("No matching route could be found");
  }

  const decidedAction = matchingRoute.action;

  let teamMembersMatchingAttributeLogic = null;
  let formResponseId = null;
  let attributeRoutingConfig = null;
  let queuedFormResponseId;
  let crmContactOwnerEmail: string | null = null;
  let crmContactOwnerRecordType: string | null = null;
  let crmAppSlug: string | null = null;
  let fallbackAction: typeof decidedAction | null = null;
  try {
    const result = await handleResponse({
      form: serializableForm,
      formFillerId: uuidv4(),
      response: response,
      identifierKeyedResponse: normalizedFieldsResponses,
      chosenRouteId: matchingRoute.id,
      isPreview: isBookingDryRun,
      queueFormResponse: shouldQueueFormResponse,
      fetchCrm,
      traceService: isBookingDryRun ? undefined : routingTraceService,
      routingFormTraceService,
    });
    teamMembersMatchingAttributeLogic = result.teamMembersMatchingAttributeLogic;
    formResponseId = result.formResponse?.id;
    queuedFormResponseId = result.queuedFormResponse?.id;
    attributeRoutingConfig = result.attributeRoutingConfig;
    crmContactOwnerEmail = result.crmContactOwnerEmail;
    crmContactOwnerRecordType = result.crmContactOwnerRecordType;
    crmAppSlug = result.crmAppSlug;
    fallbackAction = result.fallbackAction ?? null;
    timeTaken = {
      ...timeTaken,
      ...result.timeTaken,
    };

    // Save the pending trace (trace steps are added inside handleResponse)
    if (!isBookingDryRun) {
      if (formResponseId) {
        await routingTraceService.savePendingRoutingTrace({ formResponseId });
      } else if (queuedFormResponseId) {
        await routingTraceService.savePendingRoutingTrace({
          queuedFormResponseId,
        });
      }
    }
  } catch (e) {
    if (e instanceof HttpError || e instanceof TRPCError) {
      return {
        props: {
          ...pageProps,
          form: serializableForm,
          message: null,
          errorMessage: e.message,
        },
      };
    }

    log.error("Error handling the response", safeStringify(e));
    throw new Error("Error handling the response");
  }

  // TODO: To be done using sentry tracing
  console.log("Server-Timing", getServerTimingHeader(timeTaken));

  // Use fallbackAction if set (when no team members found), otherwise use the main decidedAction
  const actionToUse = fallbackAction ?? decidedAction;

  // Action type dispatch for Calendly-equivalent routing behaviors.
  // Currently handles all three RouteActionType values: customPageMessage, eventTypeRedirectUrl,
  // and externalRedirectUrl. If the RouteActionType enum is extended in the future for additional
  // Calendly-parity action types, new handlers should be added here before the fallthrough.
  //TODO: Maybe take action after successful mutation
  if (actionToUse.type === "customPageMessage") {
    return {
      props: {
        ...pageProps,
        form: serializableForm,
        message: actionToUse.value,
        errorMessage: null,
      },
    };
  } else if (actionToUse.type === "eventTypeRedirectUrl") {
    const eventTypeUrlWithResolvedVariables = substituteVariables(
      actionToUse.value,
      response,
      serializableForm.fields
    );
    return {
      redirect: {
        destination: getAbsoluteEventTypeRedirectUrlWithEmbedSupport({
          eventTypeRedirectUrl: eventTypeUrlWithResolvedVariables,
          form: serializableForm,
          // URL parameter forwarding correctly handles all Calendly-equivalent field types:
          // - Multi-select/checkbox arrays: serialized as repeated query params (field=a&field=b)
          //   via getUrlSearchParamsToForward's append() loop over array values
          // - Numeric values: converted to string via String(fieldResponse.value) in the forwarder
          // - Boolean checkbox values: forwarded as string representation ("true"/"false")
          // The response-derived params (paramsFromResponse) override raw params (paramsFromCurrentUrl)
          // ensuring normalized/processed values take precedence over raw query param values.
          allURLSearchParams: getUrlSearchParamsToForward({
            formResponse: response,
            fields: serializableForm.fields,
            searchParams: new URLSearchParams(
              stringify({
                ...paramsToBeForwardedAsIs,
                "cal.action": "eventTypeRedirectUrl",
              })
            ),
            teamMembersMatchingAttributeLogic,
            formResponseId: formResponseId ?? null,
            queuedFormResponseId: queuedFormResponseId ?? null,
            attributeRoutingConfig: attributeRoutingConfig ?? null,
            crmContactOwnerEmail,
            crmContactOwnerRecordType,
            crmAppSlug,
            crmLookupDone: fetchCrm,
            teamId: form?.teamId,
            orgId: form.team?.parentId,
          }),
          isEmbed: pageProps.isEmbed,
        }),
        permanent: false,
      },
    };
  } else if (actionToUse.type === "externalRedirectUrl") {
    return {
      redirect: {
        destination: `${actionToUse.value}?${stringify(context.query)}&cal.action=externalRedirectUrl`,
        permanent: false,
      },
    };
  }

  // TODO: Consider throwing error here as there is no value of decidedAction.type that would cause the flow to be here
  return {
    props: {
      ...pageProps,
      form: serializableForm,
      message: null,
      errorMessage: "Unhandled type of action",
    },
  };
};

export const getRoutedUrl = withReporting(_getRoutedUrl, "getRoutedUrl");
