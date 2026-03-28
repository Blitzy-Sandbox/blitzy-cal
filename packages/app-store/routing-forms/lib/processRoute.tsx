"use client";

import type { RoutingFormTraceService } from "@calcom/features/routing-trace/domains/RoutingFormTraceService";
import { evaluateRaqbLogic, RaqbLogicResult } from "@calcom/lib/raqb/evaluateRaqbLogic";
import type { App_RoutingForms_Form } from "@calcom/prisma/client";
import type { JsonTree } from "react-awesome-query-builder";
import type { z } from "zod";
import type { FormResponse, Route, SerializableForm } from "../types/types";
import type { zodNonRouterRoute } from "../zod";
import { getQueryBuilderConfigForFormFields } from "./getQueryBuilderConfig";
import { isFallbackRoute } from "./isFallbackRoute";
import isRouter from "./isRouter";

/**
 * Extended route type with optional priority metadata for Calendly-parity
 * priority-based routing evaluation. Routes with higher priority values
 * are evaluated before routes with lower priority values.
 *
 * When no priority is set, routes maintain their original order (priority defaults to 0).
 * This type extends the base zodNonRouterRoute schema without requiring schema changes,
 * since runtime route objects may carry additional metadata fields.
 */
type RouteWithPriority = z.infer<typeof zodNonRouterRoute> & {
  priority?: number;
};

/**
 * Normalizes a form response value for RAQB jsonLogic evaluation.
 *
 * Ensures proper handling across all Calendly-parity field types:
 * - **Checkbox/MULTI_SELECT fields**: Array values are preserved with all elements
 *   coerced to strings for consistent RAQB multiselect_contains/multiselect_not_contains operators
 * - **URL/website fields**: String values pass through unchanged, preserving
 *   special URL characters (query params, fragments, encoded characters)
 * - **Date fields**: Date string values pass through as strings for RAQB
 *   date/text comparison operators
 * - **TEXT, NUMBER, TEXTAREA, SINGLE_SELECT, PHONE, EMAIL**: Standard pass-through
 *   with no transformations to maintain backward compatibility
 *
 * @param value - The raw response value (string, number, or string[])
 * @returns The normalized value suitable for RAQB jsonLogic evaluation
 */
function normalizeResponseValue(value: FormResponse[string]["value"]): FormResponse[string]["value"] {
  // Array values (checkbox/MULTI_SELECT) — coerce all elements to strings
  // for consistent RAQB multiselect_contains/multiselect_not_contains evaluation
  if (Array.isArray(value)) {
    return value.map((item) => {
      if (typeof item === "string") {
        return item;
      }
      return String(item);
    });
  }

  // Numeric and string values pass through unchanged to preserve existing behavior
  // for TEXT, NUMBER, TEXTAREA, SINGLE_SELECT, PHONE, EMAIL, URL, and date fields
  return value;
}

/**
 * Extracts and normalizes response values from a form submission for RAQB evaluation.
 * Maps the structured response `{ [fieldId]: { value } }` to a flat
 * `{ [fieldId]: normalizedValue }` record compatible with the RAQB jsonLogic data input.
 *
 * This extraction is performed once per route evaluation cycle (outside the per-route loop)
 * since the response data is constant across all route evaluations within a single call.
 *
 * @param response - The raw form response keyed by field UUID
 * @returns A flat record mapping field UUIDs to normalized values
 */
function extractResponseValues(
  response: Record<string, Pick<FormResponse[string], "value">>
): Record<string, FormResponse[string]["value"]> {
  return Object.fromEntries(
    Object.entries(response).map(([uuid, { value }]) => [uuid, normalizeResponseValue(value)])
  );
}

/**
 * Sorts routes by optional priority metadata for Calendly-parity priority-based
 * route evaluation ordering. The fallback route is always kept last regardless
 * of any priority value.
 *
 * Evaluation order after sorting:
 * 1. Non-fallback routes sorted by priority descending (higher priority first)
 * 2. Routes without explicit priority default to 0
 * 3. Routes with equal priority maintain their original relative order (stable sort)
 * 4. Fallback route is always evaluated last
 *
 * If no routes have priority metadata, the original order is preserved unchanged
 * to maintain backward compatibility with existing routing behavior.
 *
 * @param routes - Array of non-router routes with fallback appended at the end
 * @returns Routes sorted by priority (descending) with fallback always last
 */
function sortRoutesByPriority(
  routes: z.infer<typeof zodNonRouterRoute>[]
): z.infer<typeof zodNonRouterRoute>[] {
  if (routes.length <= 1) return routes;

  // The fallback is always the last element in the array (appended by the caller)
  const lastRoute = routes[routes.length - 1];
  const lastIsFallback = lastRoute && "isFallback" in lastRoute && lastRoute.isFallback;

  if (!lastIsFallback) {
    // No fallback detected at end — return as-is to preserve existing behavior
    return routes;
  }

  const nonFallbackRoutes = routes.slice(0, -1);

  // Skip sorting entirely if no route carries priority metadata — avoids unnecessary allocation
  const hasPriorities = nonFallbackRoutes.some(
    (route) => route && typeof (route as RouteWithPriority).priority === "number"
  );

  if (!hasPriorities) {
    return routes;
  }

  // Stable sort by priority descending — higher priority routes are evaluated first.
  // Routes without a priority field default to 0 to maintain their relative order.
  const sorted = [...nonFallbackRoutes].sort((a, b) => {
    const priorityA = (a as RouteWithPriority).priority ?? 0;
    const priorityB = (b as RouteWithPriority).priority ?? 0;
    return priorityB - priorityA;
  });

  // Always append fallback at the end
  return [...sorted, lastRoute];
}

/**
 * Finds the first matching route for a form submission by evaluating RAQB jsonLogic
 * rules against the normalized response values.
 *
 * **Evaluation strategy (Calendly-parity answer-based matching):**
 * 1. Routes are flattened from router references and filtered to non-fallback routes
 * 2. Routes are optionally sorted by priority metadata (higher priority first)
 * 3. Each route's RAQB queryValue is evaluated against the form response data
 * 4. The first route producing a MATCH or LOGIC_NOT_FOUND_SO_MATCHED result is selected
 * 5. If no route matches, the mandatory fallback route is evaluated last
 * 6. If even the fallback doesn't match, null is returned
 *
 * **Calendly parity notes (RF-002):**
 * - Calendly's answer-based matching maps directly to RAQB's field-value comparison rules
 * - Checkbox/MULTI_SELECT array values are normalized for consistent evaluation
 * - URL and date field values pass through without transformation
 * - Priority-based evaluation supports Calendly's route weighting patterns
 *
 * @param form - The routing form containing routes and field definitions
 * @param response - The user's form submission response keyed by field UUID
 * @param routingFormTraceService - Optional trace service for recording routing decisions
 * @returns The matched route, or null if no route (including fallback) matched
 */
export function findMatchingRoute({
  form,
  response,
  routingFormTraceService,
}: {
  form: Pick<SerializableForm<App_RoutingForms_Form>, "routes" | "fields">;
  response: Record<string, Pick<FormResponse[string], "value">>;
  routingFormTraceService?: RoutingFormTraceService;
}) {
  const queryBuilderConfig = getQueryBuilderConfigForFormFields(form);

  const routes = form.routes || [];

  let chosenRoute: Route | null = null;

  const fallbackRoute = routes.find(isFallbackRoute);

  if (!fallbackRoute) {
    throw new Error("Fallback route is missing");
  }

  // Flatten router references and separate non-fallback routes from fallback
  const flattenedRoutes = routes
    .flatMap((r) => {
      // For a router, use it's routes instead.
      if (isRouter(r)) return r.routes;
      return r;
    })
    // Use only non fallback routes
    .filter((route) => route && !isFallbackRoute(route))
    // After above flat map, all routes are non router routes.
    .concat([fallbackRoute]) as z.infer<typeof zodNonRouterRoute>[];

  // Apply priority-based sorting for Calendly-parity route evaluation ordering.
  // Routes with explicit priority metadata are evaluated in descending priority order.
  // Fallback route is always evaluated last regardless of priority.
  const routesWithFallbackInEnd = sortRoutesByPriority(flattenedRoutes);

  // Pre-extract and normalize response values once for all route evaluations.
  // This handles Calendly-parity field types: checkbox arrays, URL strings, date strings.
  const responseValues = extractResponseValues(response);

  for (const route of routesWithFallbackInEnd) {
    if (!route) {
      continue;
    }

    const result = evaluateRaqbLogic({
      queryValue: route.queryValue as JsonTree,
      queryBuilderConfig,
      data: responseValues,
    });

    if (result === RaqbLogicResult.MATCH || result === RaqbLogicResult.LOGIC_NOT_FOUND_SO_MATCHED) {
      chosenRoute = route;
      break;
    }
  }

  if (!chosenRoute) {
    return null;
  }

  if (routingFormTraceService) {
    let routeName: string;
    if ("name" in chosenRoute && chosenRoute.name) {
      routeName = chosenRoute.name;
    } else if (isFallbackRoute(chosenRoute)) {
      routeName = "default_route";
    } else {
      routeName = chosenRoute.id;
    }
    if (isFallbackRoute(chosenRoute)) {
      routingFormTraceService.fallbackRouteUsed({ routeId: chosenRoute.id, routeName });
    } else {
      routingFormTraceService.routeMatched({ routeId: chosenRoute.id, routeName });
    }
  }

  return chosenRoute;
}
