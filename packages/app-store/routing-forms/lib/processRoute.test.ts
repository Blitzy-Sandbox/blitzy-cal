import { beforeEach, describe, expect, it, vi } from "vitest";

import type { RoutingFormTraceService } from "@calcom/features/routing-trace/domains/RoutingFormTraceService";
import { RaqbLogicResult } from "@calcom/lib/raqb/evaluateRaqbLogic";

import type { FormResponse, SerializableForm } from "../types/types";
import { RoutingFormFieldType } from "./FieldTypes";
import { findMatchingRoute } from "./processRoute";

vi.mock("@calcom/lib/raqb/evaluateRaqbLogic", () => ({
  evaluateRaqbLogic: vi.fn(),
  RaqbLogicResult: {
    MATCH: "MATCH",
    NO_MATCH: "NO_MATCH",
    LOGIC_NOT_FOUND_SO_MATCHED: "LOGIC_NOT_FOUND_SO_MATCHED",
  },
}));

vi.mock("./getQueryBuilderConfig", () => ({
  getQueryBuilderConfigForFormFields: vi.fn().mockReturnValue({}),
}));

const { evaluateRaqbLogic } = await import("@calcom/lib/raqb/evaluateRaqbLogic");

describe("findMatchingRoute", () => {
  let mockRoutingFormTrace: RoutingFormTraceService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRoutingFormTrace = {
      routeMatched: vi.fn(),
      fallbackRouteUsed: vi.fn(),
      attributeLogicEvaluated: vi.fn(),
      attributeFallbackUsed: vi.fn(),
    } as unknown as RoutingFormTraceService;
  });

  /**
   * Creates a mock routing form for testing.
   *
   * @param routes - Array of route definitions with optional priority metadata for
   *   Calendly-parity priority-based evaluation ordering tests.
   * @param fields - Optional array of field definitions simulating Calendly question types.
   *   When omitted, defaults to an empty array (preserving original behavior).
   *   Accepts all RoutingFormFieldType values for backward-compatibility and parity tests.
   */
  const createMockForm = (
    routes: Array<{
      id: string;
      name?: string;
      isFallback?: boolean;
      queryValue?: unknown;
      priority?: number;
    }>,
    fields?: Array<{
      id: string;
      type: RoutingFormFieldType;
      label: string;
      required?: boolean;
      options?: Array<{ label: string; value: string; id: string }>;
    }>
  ): Pick<SerializableForm<never>, "routes" | "fields"> => {
    const mappedRoutes = routes.map((route) => {
      const base = {
        id: route.id,
        name: route.name,
        isFallback: route.isFallback ?? false,
        queryValue: route.queryValue ?? { type: "group" },
        action: { type: "customPageMessage", value: "test" },
      };
      if (route.priority !== undefined) {
        return { ...base, priority: route.priority };
      }
      return base;
    });

    if (!fields) {
      return { routes: mappedRoutes as never, fields: [] };
    }

    const mappedFields = fields.map((field) => {
      const base = {
        id: field.id,
        type: field.type,
        label: field.label,
        required: field.required ?? false,
      };
      if (field.options) {
        return { ...base, selectOptions: field.options };
      }
      return base;
    });

    return { routes: mappedRoutes as never, fields: mappedFields as never };
  };

  /**
   * Creates a mock form response for testing.
   *
   * @param fieldValues - Optional mapping of field UUIDs to response values.
   *   Supports all FormResponse value types: string, number, and string[] (for
   *   MULTI_SELECT/CHECKBOX fields). When omitted, returns an empty response
   *   record (preserving original behavior for existing tests).
   */
  const createMockResponse = (
    fieldValues?: Record<string, FormResponse[string]["value"]>
  ): Record<string, Pick<FormResponse[string], "value">> => {
    if (!fieldValues) return {};
    return Object.fromEntries(
      Object.entries(fieldValues).map(([uuid, value]) => [uuid, { value }])
    );
  };

  it("should throw error if fallback route is missing", () => {
    const form = createMockForm([{ id: "route-1", name: "Route 1" }]);

    expect(() =>
      findMatchingRoute({
        form,
        response: createMockResponse(),
      })
    ).toThrow("Fallback route is missing");
  });

  it("should return null if no route matches", () => {
    vi.mocked(evaluateRaqbLogic).mockReturnValue(RaqbLogicResult.NO_MATCH);

    const form = createMockForm([
      { id: "route-1", name: "Route 1" },
      { id: "fallback", name: "Fallback", isFallback: true },
    ]);

    const result = findMatchingRoute({
      form,
      response: createMockResponse(),
    });

    expect(result).toBeNull();
  });

  describe("tracing", () => {
    it("should call routeMatched when a non-fallback route matches", () => {
      vi.mocked(evaluateRaqbLogic).mockReturnValue(RaqbLogicResult.MATCH);

      const form = createMockForm([
        { id: "route-1", name: "Sales Route" },
        { id: "fallback", name: "Default", isFallback: true },
      ]);

      const result = findMatchingRoute({
        form,
        response: createMockResponse(),
        routingFormTraceService: mockRoutingFormTrace,
      });

      expect(result).not.toBeNull();
      expect(mockRoutingFormTrace.routeMatched).toHaveBeenCalledWith({
        routeId: "route-1",
        routeName: "Sales Route",
      });
      expect(mockRoutingFormTrace.fallbackRouteUsed).not.toHaveBeenCalled();
    });

    it("should call fallbackRouteUsed when fallback route is used", () => {
      vi.mocked(evaluateRaqbLogic)
        .mockReturnValueOnce(RaqbLogicResult.NO_MATCH)
        .mockReturnValueOnce(RaqbLogicResult.MATCH);

      const form = createMockForm([
        { id: "route-1", name: "Sales Route" },
        { id: "fallback", name: "Default Route", isFallback: true },
      ]);

      const result = findMatchingRoute({
        form,
        response: createMockResponse(),
        routingFormTraceService: mockRoutingFormTrace,
      });

      expect(result).not.toBeNull();
      expect(mockRoutingFormTrace.fallbackRouteUsed).toHaveBeenCalledWith({
        routeId: "fallback",
        routeName: "Default Route",
      });
      expect(mockRoutingFormTrace.routeMatched).not.toHaveBeenCalled();
    });

    it("should use 'default_route' as name when fallback route has no name", () => {
      vi.mocked(evaluateRaqbLogic)
        .mockReturnValueOnce(RaqbLogicResult.NO_MATCH)
        .mockReturnValueOnce(RaqbLogicResult.MATCH);

      const form = createMockForm([
        { id: "route-1", name: "Sales Route" },
        { id: "fallback", isFallback: true },
      ]);

      const result = findMatchingRoute({
        form,
        response: createMockResponse(),
        routingFormTraceService: mockRoutingFormTrace,
      });

      expect(result).not.toBeNull();
      expect(mockRoutingFormTrace.fallbackRouteUsed).toHaveBeenCalledWith({
        routeId: "fallback",
        routeName: "default_route",
      });
    });

    it("should use route id as name when route has no name", () => {
      vi.mocked(evaluateRaqbLogic).mockReturnValue(RaqbLogicResult.MATCH);

      const form = createMockForm([
        { id: "route-123" },
        { id: "fallback", isFallback: true },
      ]);

      const result = findMatchingRoute({
        form,
        response: createMockResponse(),
        routingFormTraceService: mockRoutingFormTrace,
      });

      expect(result).not.toBeNull();
      expect(mockRoutingFormTrace.routeMatched).toHaveBeenCalledWith({
        routeId: "route-123",
        routeName: "route-123",
      });
    });

    it("should not call trace methods when routingFormTrace is not provided", () => {
      vi.mocked(evaluateRaqbLogic).mockReturnValue(RaqbLogicResult.MATCH);

      const form = createMockForm([
        { id: "route-1", name: "Sales Route" },
        { id: "fallback", isFallback: true },
      ]);

      const result = findMatchingRoute({
        form,
        response: createMockResponse(),
      });

      expect(result).not.toBeNull();
      expect(mockRoutingFormTrace.routeMatched).not.toHaveBeenCalled();
      expect(mockRoutingFormTrace.fallbackRouteUsed).not.toHaveBeenCalled();
    });

    it("should handle LOGIC_NOT_FOUND_SO_MATCHED as a match", () => {
      vi.mocked(evaluateRaqbLogic).mockReturnValue(RaqbLogicResult.LOGIC_NOT_FOUND_SO_MATCHED);

      const form = createMockForm([
        { id: "route-1", name: "Auto Match Route" },
        { id: "fallback", isFallback: true },
      ]);

      const result = findMatchingRoute({
        form,
        response: createMockResponse(),
        routingFormTraceService: mockRoutingFormTrace,
      });

      expect(result).not.toBeNull();
      expect(mockRoutingFormTrace.routeMatched).toHaveBeenCalledWith({
        routeId: "route-1",
        routeName: "Auto Match Route",
      });
    });
  });

  // ---------------------------------------------------------------------------
  // RF-002: Calendly-parity answer-based routing tests
  // ---------------------------------------------------------------------------

  describe("Calendly-parity answer-based routing (RF-002)", () => {
    it("should select route matching a specific single-select answer value", () => {
      // Simulate Calendly answer-based routing: first route matches "Sales" answer
      vi.mocked(evaluateRaqbLogic).mockReturnValueOnce(RaqbLogicResult.MATCH);

      const form = createMockForm(
        [
          { id: "sales-route", name: "Sales Route" },
          { id: "support-route", name: "Support Route" },
          { id: "fallback", name: "Default", isFallback: true },
        ],
        [
          {
            id: "field-department",
            type: RoutingFormFieldType.SINGLE_SELECT,
            label: "Department",
            options: [
              { label: "Sales", value: "sales", id: "opt-sales" },
              { label: "Support", value: "support", id: "opt-support" },
            ],
          },
        ]
      );

      const response = createMockResponse({ "field-department": "sales" });
      const result = findMatchingRoute({ form, response });

      expect(result).not.toBeNull();
      expect(result?.id).toBe("sales-route");
      // Verify response values were extracted and passed to evaluateRaqbLogic
      expect(evaluateRaqbLogic).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { "field-department": "sales" },
        })
      );
    });

    it("should select route matching a specific text field answer", () => {
      // First route does not match, second route matches
      vi.mocked(evaluateRaqbLogic)
        .mockReturnValueOnce(RaqbLogicResult.NO_MATCH)
        .mockReturnValueOnce(RaqbLogicResult.MATCH);

      const form = createMockForm(
        [
          { id: "route-vip", name: "VIP Route" },
          { id: "route-regular", name: "Regular Route" },
          { id: "fallback", name: "Fallback", isFallback: true },
        ],
        [{ id: "field-name", type: RoutingFormFieldType.TEXT, label: "Company Name" }]
      );

      const response = createMockResponse({ "field-name": "Acme Corp" });
      const result = findMatchingRoute({ form, response });

      expect(result).not.toBeNull();
      expect(result?.id).toBe("route-regular");
      // Both non-fallback routes should have been evaluated
      expect(evaluateRaqbLogic).toHaveBeenCalledTimes(2);
    });

    it("should route Sales answer to sales page and Support to support page", () => {
      // Simulate Calendly-style department routing: first call matches Sales intent
      vi.mocked(evaluateRaqbLogic).mockReturnValueOnce(RaqbLogicResult.MATCH);

      const form = createMockForm(
        [
          { id: "sales-page", name: "Book Sales Call" },
          { id: "support-page", name: "Book Support Session" },
          { id: "fallback", name: "General Booking", isFallback: true },
        ],
        [
          {
            id: "field-intent",
            type: RoutingFormFieldType.SINGLE_SELECT,
            label: "What do you need?",
            options: [
              { label: "Sales", value: "Sales", id: "opt-1" },
              { label: "Support", value: "Support", id: "opt-2" },
            ],
          },
        ]
      );

      const salesResponse = createMockResponse({ "field-intent": "Sales" });
      const result = findMatchingRoute({ form, response: salesResponse });

      expect(result).not.toBeNull();
      expect(result?.id).toBe("sales-page");
      expect(evaluateRaqbLogic).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { "field-intent": "Sales" },
        })
      );
    });

    it("should pass normalized response values to evaluateRaqbLogic data parameter", () => {
      vi.mocked(evaluateRaqbLogic).mockReturnValue(RaqbLogicResult.MATCH);

      const form = createMockForm(
        [
          { id: "route-1", name: "Route 1" },
          { id: "fallback", isFallback: true },
        ],
        [
          { id: "f1", type: RoutingFormFieldType.TEXT, label: "Name" },
          { id: "f2", type: RoutingFormFieldType.NUMBER, label: "Age" },
          { id: "f3", type: RoutingFormFieldType.EMAIL, label: "Email" },
        ]
      );

      const response = createMockResponse({
        f1: "John",
        f2: 30,
        f3: "john@example.com",
      });

      findMatchingRoute({ form, response });

      expect(evaluateRaqbLogic).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { f1: "John", f2: 30, f3: "john@example.com" },
        })
      );
    });
  });

  // ---------------------------------------------------------------------------
  // RF-002: Multiple condition matching (AND/OR logic, priority evaluation)
  // ---------------------------------------------------------------------------

  describe("multiple condition matching", () => {
    it("should select the first matching route when multiple routes could match", () => {
      // All routes match, but first non-fallback route should be returned
      vi.mocked(evaluateRaqbLogic).mockReturnValue(RaqbLogicResult.MATCH);

      const form = createMockForm([
        { id: "route-a", name: "Route A" },
        { id: "route-b", name: "Route B" },
        { id: "fallback", isFallback: true },
      ]);

      const result = findMatchingRoute({ form, response: createMockResponse() });

      expect(result).not.toBeNull();
      expect(result?.id).toBe("route-a");
      // evaluateRaqbLogic called only once since first route matched immediately
      expect(evaluateRaqbLogic).toHaveBeenCalledTimes(1);
    });

    it("should evaluate non-fallback routes before fallback", () => {
      vi.mocked(evaluateRaqbLogic)
        .mockReturnValueOnce(RaqbLogicResult.NO_MATCH) // route-1 no match
        .mockReturnValueOnce(RaqbLogicResult.NO_MATCH) // route-2 no match
        .mockReturnValueOnce(RaqbLogicResult.MATCH); // fallback matches

      const form = createMockForm([
        { id: "route-1", name: "Route 1" },
        { id: "route-2", name: "Route 2" },
        { id: "fallback", name: "Fallback", isFallback: true },
      ]);

      const result = findMatchingRoute({ form, response: createMockResponse() });

      expect(result).not.toBeNull();
      expect(result?.id).toBe("fallback");
      // All three routes evaluated: 2 non-fallback + 1 fallback
      expect(evaluateRaqbLogic).toHaveBeenCalledTimes(3);
    });

    it("should respect priority-based evaluation ordering", () => {
      // Route with higher priority should be evaluated and matched first
      vi.mocked(evaluateRaqbLogic).mockReturnValueOnce(RaqbLogicResult.MATCH);

      const form = createMockForm([
        { id: "low-priority", name: "Low Priority", priority: 1 },
        { id: "high-priority", name: "High Priority", priority: 10 },
        { id: "fallback", isFallback: true },
      ]);

      const result = findMatchingRoute({ form, response: createMockResponse() });

      expect(result).not.toBeNull();
      // High-priority route is sorted first and matched on first evaluateRaqbLogic call
      expect(result?.id).toBe("high-priority");
    });

    it("should select higher priority route over lower priority when both match", () => {
      vi.mocked(evaluateRaqbLogic).mockReturnValue(RaqbLogicResult.MATCH);

      const form = createMockForm([
        { id: "route-low", name: "Low Priority", priority: 1 },
        { id: "route-high", name: "High Priority", priority: 5 },
        { id: "route-medium", name: "Medium Priority", priority: 3 },
        { id: "fallback", isFallback: true },
      ]);

      const result = findMatchingRoute({ form, response: createMockResponse() });

      expect(result).not.toBeNull();
      expect(result?.id).toBe("route-high");
    });

    it("should maintain original order for routes without priority metadata", () => {
      // Without priority, routes are evaluated in their original array order
      vi.mocked(evaluateRaqbLogic)
        .mockReturnValueOnce(RaqbLogicResult.NO_MATCH)
        .mockReturnValueOnce(RaqbLogicResult.MATCH);

      const form = createMockForm([
        { id: "first-route", name: "First" },
        { id: "second-route", name: "Second" },
        { id: "fallback", isFallback: true },
      ]);

      const result = findMatchingRoute({ form, response: createMockResponse() });

      expect(result).not.toBeNull();
      expect(result?.id).toBe("second-route");
    });

    it("should maintain original order for routes with equal priority", () => {
      // Routes with the same priority preserve their original relative order (stable sort)
      vi.mocked(evaluateRaqbLogic)
        .mockReturnValueOnce(RaqbLogicResult.NO_MATCH)
        .mockReturnValueOnce(RaqbLogicResult.MATCH);

      const form = createMockForm([
        { id: "route-a", name: "Route A", priority: 5 },
        { id: "route-b", name: "Route B", priority: 5 },
        { id: "fallback", isFallback: true },
      ]);

      const result = findMatchingRoute({ form, response: createMockResponse() });

      expect(result).not.toBeNull();
      expect(result?.id).toBe("route-b");
    });
  });

  // ---------------------------------------------------------------------------
  // RF-002: New Calendly-parity field type routing (CHECKBOX, URL, DATE)
  // ---------------------------------------------------------------------------

  describe("new Calendly-parity field type routing (RF-002)", () => {
    it("should normalize checkbox array values as string arrays in response data", () => {
      vi.mocked(evaluateRaqbLogic).mockReturnValue(RaqbLogicResult.MATCH);

      const form = createMockForm(
        [
          { id: "route-1", name: "Route 1" },
          { id: "fallback", isFallback: true },
        ],
        [
          {
            id: "field-checkbox",
            type: RoutingFormFieldType.CHECKBOX,
            label: "Interests",
            options: [
              { label: "Product A", value: "product-a", id: "opt-1" },
              { label: "Product B", value: "product-b", id: "opt-2" },
            ],
          },
        ]
      );

      const response = createMockResponse({
        "field-checkbox": ["product-a", "product-b"],
      });

      findMatchingRoute({ form, response });

      expect(evaluateRaqbLogic).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { "field-checkbox": ["product-a", "product-b"] },
        })
      );
    });

    it("should pass URL field values through unchanged", () => {
      vi.mocked(evaluateRaqbLogic).mockReturnValue(RaqbLogicResult.MATCH);

      const form = createMockForm(
        [
          { id: "route-1", name: "Route 1" },
          { id: "fallback", isFallback: true },
        ],
        [{ id: "field-website", type: RoutingFormFieldType.URL, label: "Website" }]
      );

      const response = createMockResponse({
        "field-website": "https://example.com/path?query=value#fragment",
      });

      findMatchingRoute({ form, response });

      // URL with special characters (query params, fragment) must pass through unchanged
      expect(evaluateRaqbLogic).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { "field-website": "https://example.com/path?query=value#fragment" },
        })
      );
    });

    it("should pass date field values through as strings", () => {
      vi.mocked(evaluateRaqbLogic).mockReturnValue(RaqbLogicResult.MATCH);

      const form = createMockForm(
        [
          { id: "route-1", name: "Route 1" },
          { id: "fallback", isFallback: true },
        ],
        [{ id: "field-date", type: RoutingFormFieldType.DATE, label: "Preferred Date" }]
      );

      const response = createMockResponse({
        "field-date": "2025-03-29",
      });

      findMatchingRoute({ form, response });

      expect(evaluateRaqbLogic).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { "field-date": "2025-03-29" },
        })
      );
    });

    it("should handle mixed old and new field types in the same response", () => {
      vi.mocked(evaluateRaqbLogic).mockReturnValue(RaqbLogicResult.MATCH);

      const form = createMockForm(
        [
          { id: "route-1", name: "Route 1" },
          { id: "fallback", isFallback: true },
        ],
        [
          { id: "f-text", type: RoutingFormFieldType.TEXT, label: "Name" },
          { id: "f-email", type: RoutingFormFieldType.EMAIL, label: "Email" },
          { id: "f-checkbox", type: RoutingFormFieldType.CHECKBOX, label: "Options" },
          { id: "f-url", type: RoutingFormFieldType.URL, label: "Website" },
          { id: "f-date", type: RoutingFormFieldType.DATE, label: "Date" },
        ]
      );

      const response = createMockResponse({
        "f-text": "Jane",
        "f-email": "jane@example.com",
        "f-checkbox": ["opt-a", "opt-b"],
        "f-url": "https://example.com",
        "f-date": "2025-06-15",
      });

      findMatchingRoute({ form, response });

      expect(evaluateRaqbLogic).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            "f-text": "Jane",
            "f-email": "jane@example.com",
            "f-checkbox": ["opt-a", "opt-b"],
            "f-url": "https://example.com",
            "f-date": "2025-06-15",
          },
        })
      );
    });
  });

  // ---------------------------------------------------------------------------
  // RF-002: Backward compatibility regression tests
  // ---------------------------------------------------------------------------

  describe("backward compatibility regression", () => {
    it("should correctly route with TEXT field responses", () => {
      vi.mocked(evaluateRaqbLogic).mockReturnValue(RaqbLogicResult.MATCH);

      const form = createMockForm(
        [
          { id: "route-1", name: "Text Route" },
          { id: "fallback", isFallback: true },
        ],
        [{ id: "f-text", type: RoutingFormFieldType.TEXT, label: "Name" }]
      );

      const response = createMockResponse({ "f-text": "Hello World" });
      const result = findMatchingRoute({ form, response });

      expect(result).not.toBeNull();
      expect(result?.id).toBe("route-1");
      expect(evaluateRaqbLogic).toHaveBeenCalledWith(
        expect.objectContaining({ data: { "f-text": "Hello World" } })
      );
    });

    it("should correctly route with NUMBER field responses", () => {
      vi.mocked(evaluateRaqbLogic).mockReturnValue(RaqbLogicResult.MATCH);

      const form = createMockForm(
        [
          { id: "route-1", name: "Number Route" },
          { id: "fallback", isFallback: true },
        ],
        [{ id: "f-num", type: RoutingFormFieldType.NUMBER, label: "Budget" }]
      );

      const response = createMockResponse({ "f-num": 5000 });
      const result = findMatchingRoute({ form, response });

      expect(result).not.toBeNull();
      expect(result?.id).toBe("route-1");
      expect(evaluateRaqbLogic).toHaveBeenCalledWith(
        expect.objectContaining({ data: { "f-num": 5000 } })
      );
    });

    it("should correctly route with TEXTAREA field responses", () => {
      vi.mocked(evaluateRaqbLogic).mockReturnValue(RaqbLogicResult.MATCH);

      const form = createMockForm(
        [
          { id: "route-1", name: "Textarea Route" },
          { id: "fallback", isFallback: true },
        ],
        [{ id: "f-area", type: RoutingFormFieldType.TEXTAREA, label: "Description" }]
      );

      const response = createMockResponse({ "f-area": "A long description\nwith multiple lines" });
      const result = findMatchingRoute({ form, response });

      expect(result).not.toBeNull();
      expect(result?.id).toBe("route-1");
      expect(evaluateRaqbLogic).toHaveBeenCalledWith(
        expect.objectContaining({ data: { "f-area": "A long description\nwith multiple lines" } })
      );
    });

    it("should correctly route with SINGLE_SELECT field responses", () => {
      vi.mocked(evaluateRaqbLogic).mockReturnValue(RaqbLogicResult.MATCH);

      const form = createMockForm(
        [
          { id: "route-1", name: "Select Route" },
          { id: "fallback", isFallback: true },
        ],
        [
          {
            id: "f-select",
            type: RoutingFormFieldType.SINGLE_SELECT,
            label: "Priority",
            options: [
              { label: "High", value: "high", id: "opt-h" },
              { label: "Low", value: "low", id: "opt-l" },
            ],
          },
        ]
      );

      const response = createMockResponse({ "f-select": "high" });
      const result = findMatchingRoute({ form, response });

      expect(result).not.toBeNull();
      expect(result?.id).toBe("route-1");
      expect(evaluateRaqbLogic).toHaveBeenCalledWith(
        expect.objectContaining({ data: { "f-select": "high" } })
      );
    });

    it("should correctly route with MULTI_SELECT field responses", () => {
      vi.mocked(evaluateRaqbLogic).mockReturnValue(RaqbLogicResult.MATCH);

      const form = createMockForm(
        [
          { id: "route-1", name: "Multi Route" },
          { id: "fallback", isFallback: true },
        ],
        [
          {
            id: "f-multi",
            type: RoutingFormFieldType.MULTI_SELECT,
            label: "Topics",
            options: [
              { label: "Engineering", value: "eng", id: "opt-e" },
              { label: "Design", value: "design", id: "opt-d" },
            ],
          },
        ]
      );

      const response = createMockResponse({ "f-multi": ["eng", "design"] });
      const result = findMatchingRoute({ form, response });

      expect(result).not.toBeNull();
      expect(result?.id).toBe("route-1");
      expect(evaluateRaqbLogic).toHaveBeenCalledWith(
        expect.objectContaining({ data: { "f-multi": ["eng", "design"] } })
      );
    });

    it("should correctly route with PHONE field responses", () => {
      vi.mocked(evaluateRaqbLogic).mockReturnValue(RaqbLogicResult.MATCH);

      const form = createMockForm(
        [
          { id: "route-1", name: "Phone Route" },
          { id: "fallback", isFallback: true },
        ],
        [{ id: "f-phone", type: RoutingFormFieldType.PHONE, label: "Phone Number" }]
      );

      const response = createMockResponse({ "f-phone": "+1-555-123-4567" });
      const result = findMatchingRoute({ form, response });

      expect(result).not.toBeNull();
      expect(result?.id).toBe("route-1");
      expect(evaluateRaqbLogic).toHaveBeenCalledWith(
        expect.objectContaining({ data: { "f-phone": "+1-555-123-4567" } })
      );
    });

    it("should correctly route with EMAIL field responses", () => {
      vi.mocked(evaluateRaqbLogic).mockReturnValue(RaqbLogicResult.MATCH);

      const form = createMockForm(
        [
          { id: "route-1", name: "Email Route" },
          { id: "fallback", isFallback: true },
        ],
        [{ id: "f-email", type: RoutingFormFieldType.EMAIL, label: "Email Address" }]
      );

      const response = createMockResponse({ "f-email": "user@company.com" });
      const result = findMatchingRoute({ form, response });

      expect(result).not.toBeNull();
      expect(result?.id).toBe("route-1");
      expect(evaluateRaqbLogic).toHaveBeenCalledWith(
        expect.objectContaining({ data: { "f-email": "user@company.com" } })
      );
    });

    it("should work with existing route configurations without new features", () => {
      // Verify that the original test pattern (no fields, no response values, no priority)
      // continues to work exactly as before the Calendly-parity enhancements
      vi.mocked(evaluateRaqbLogic).mockReturnValue(RaqbLogicResult.MATCH);

      const form = createMockForm([
        { id: "route-1", name: "Route 1" },
        { id: "fallback", isFallback: true },
      ]);

      const result = findMatchingRoute({
        form,
        response: createMockResponse(),
      });

      expect(result).not.toBeNull();
      expect(result?.id).toBe("route-1");
      expect(evaluateRaqbLogic).toHaveBeenCalledWith(
        expect.objectContaining({ data: {} })
      );
    });
  });

  // ---------------------------------------------------------------------------
  // RF-002: Edge case tests
  // ---------------------------------------------------------------------------

  describe("edge cases", () => {
    it("should handle empty response values (no answers provided)", () => {
      vi.mocked(evaluateRaqbLogic).mockReturnValue(RaqbLogicResult.MATCH);

      const form = createMockForm(
        [
          { id: "route-1", name: "Route 1" },
          { id: "fallback", isFallback: true },
        ],
        [
          { id: "f1", type: RoutingFormFieldType.TEXT, label: "Name" },
          { id: "f2", type: RoutingFormFieldType.EMAIL, label: "Email" },
        ]
      );

      // No answers provided — empty response
      const result = findMatchingRoute({ form, response: createMockResponse() });

      expect(result).not.toBeNull();
      expect(evaluateRaqbLogic).toHaveBeenCalledWith(
        expect.objectContaining({ data: {} })
      );
    });

    it("should handle partial responses (some fields answered, some not)", () => {
      vi.mocked(evaluateRaqbLogic).mockReturnValue(RaqbLogicResult.MATCH);

      const form = createMockForm(
        [
          { id: "route-1", name: "Route 1" },
          { id: "fallback", isFallback: true },
        ],
        [
          { id: "f1", type: RoutingFormFieldType.TEXT, label: "Name" },
          { id: "f2", type: RoutingFormFieldType.EMAIL, label: "Email" },
          { id: "f3", type: RoutingFormFieldType.PHONE, label: "Phone" },
        ]
      );

      // Only f1 is answered; f2 and f3 are unanswered
      const response = createMockResponse({ f1: "Jane" });
      findMatchingRoute({ form, response });

      // Only the answered field should appear in data
      expect(evaluateRaqbLogic).toHaveBeenCalledWith(
        expect.objectContaining({ data: { f1: "Jane" } })
      );
    });

    it("should handle responses with new field types alongside old field types", () => {
      vi.mocked(evaluateRaqbLogic).mockReturnValue(RaqbLogicResult.MATCH);

      const form = createMockForm(
        [
          { id: "route-1", name: "Route 1" },
          { id: "fallback", isFallback: true },
        ],
        [
          { id: "f-text", type: RoutingFormFieldType.TEXT, label: "Name" },
          { id: "f-select", type: RoutingFormFieldType.SINGLE_SELECT, label: "Type" },
          { id: "f-checkbox", type: RoutingFormFieldType.CHECKBOX, label: "Prefs" },
          { id: "f-url", type: RoutingFormFieldType.URL, label: "Site" },
          { id: "f-date", type: RoutingFormFieldType.DATE, label: "When" },
          { id: "f-number", type: RoutingFormFieldType.NUMBER, label: "Count" },
        ]
      );

      const response = createMockResponse({
        "f-text": "Alice",
        "f-select": "premium",
        "f-checkbox": ["pref-a"],
        "f-url": "https://alice.dev",
        "f-date": "2025-12-01",
        "f-number": 42,
      });

      findMatchingRoute({ form, response });

      expect(evaluateRaqbLogic).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            "f-text": "Alice",
            "f-select": "premium",
            "f-checkbox": ["pref-a"],
            "f-url": "https://alice.dev",
            "f-date": "2025-12-01",
            "f-number": 42,
          },
        })
      );
    });

    it("should handle router routes (nested/flattened) with new field types", () => {
      vi.mocked(evaluateRaqbLogic).mockReturnValue(RaqbLogicResult.MATCH);

      // Manually construct form with a router route containing nested routes
      const form: Pick<SerializableForm<never>, "routes" | "fields"> = {
        routes: [
          {
            id: "router-1",
            isRouter: true,
            name: "Router",
            description: null,
            routes: [
              {
                id: "nested-route",
                name: "Nested Route",
                isFallback: false,
                queryValue: { type: "group" },
                action: { type: "customPageMessage", value: "nested" },
              },
            ],
          } as never,
          {
            id: "fallback",
            isFallback: true,
            queryValue: { type: "group" },
            action: { type: "customPageMessage", value: "fallback" },
          },
        ] as never,
        fields: [
          { id: "f-url", type: RoutingFormFieldType.URL, label: "Website" },
          { id: "f-date", type: RoutingFormFieldType.DATE, label: "Date" },
        ] as never,
      };

      const response = createMockResponse({
        "f-url": "https://example.com",
        "f-date": "2025-06-15",
      });

      const result = findMatchingRoute({ form, response });

      expect(result).not.toBeNull();
      expect(result?.id).toBe("nested-route");
      expect(evaluateRaqbLogic).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            "f-url": "https://example.com",
            "f-date": "2025-06-15",
          },
        })
      );
    });
  });

  // ---------------------------------------------------------------------------
  // RF-002: Trace service integration tests for new routing patterns
  // ---------------------------------------------------------------------------

  describe("trace service integration for new routing patterns", () => {
    it("should trace routeMatched for Calendly-pattern answer-based match", () => {
      vi.mocked(evaluateRaqbLogic).mockReturnValueOnce(RaqbLogicResult.MATCH);

      const form = createMockForm(
        [
          { id: "answer-route", name: "Answer-Based Route" },
          { id: "fallback", name: "Default", isFallback: true },
        ],
        [
          {
            id: "field-topic",
            type: RoutingFormFieldType.SINGLE_SELECT,
            label: "Topic",
            options: [{ label: "Demo", value: "demo", id: "opt-demo" }],
          },
        ]
      );

      const response = createMockResponse({ "field-topic": "demo" });

      const result = findMatchingRoute({
        form,
        response,
        routingFormTraceService: mockRoutingFormTrace,
      });

      expect(result).not.toBeNull();
      expect(result?.id).toBe("answer-route");
      expect(mockRoutingFormTrace.routeMatched).toHaveBeenCalledWith({
        routeId: "answer-route",
        routeName: "Answer-Based Route",
      });
      expect(mockRoutingFormTrace.fallbackRouteUsed).not.toHaveBeenCalled();
    });

    it("should trace fallbackRouteUsed when no answer-based match is found", () => {
      vi.mocked(evaluateRaqbLogic)
        .mockReturnValueOnce(RaqbLogicResult.NO_MATCH) // answer route misses
        .mockReturnValueOnce(RaqbLogicResult.MATCH); // fallback matches

      const form = createMockForm(
        [
          { id: "answer-route", name: "Answer-Based Route" },
          { id: "fallback", name: "Catch-All", isFallback: true },
        ],
        [{ id: "field-q", type: RoutingFormFieldType.TEXT, label: "Question" }]
      );

      const response = createMockResponse({ "field-q": "unknown topic" });

      const result = findMatchingRoute({
        form,
        response,
        routingFormTraceService: mockRoutingFormTrace,
      });

      expect(result).not.toBeNull();
      expect(result?.id).toBe("fallback");
      expect(mockRoutingFormTrace.fallbackRouteUsed).toHaveBeenCalledWith({
        routeId: "fallback",
        routeName: "Catch-All",
      });
      expect(mockRoutingFormTrace.routeMatched).not.toHaveBeenCalled();
    });

    it("should trace correctly with priority-based route selection", () => {
      // Higher priority route should be evaluated first and traced
      vi.mocked(evaluateRaqbLogic).mockReturnValueOnce(RaqbLogicResult.MATCH);

      const form = createMockForm([
        { id: "low-route", name: "Low Priority", priority: 1 },
        { id: "high-route", name: "High Priority", priority: 10 },
        { id: "fallback", name: "Default", isFallback: true },
      ]);

      const result = findMatchingRoute({
        form,
        response: createMockResponse(),
        routingFormTraceService: mockRoutingFormTrace,
      });

      expect(result).not.toBeNull();
      expect(result?.id).toBe("high-route");
      expect(mockRoutingFormTrace.routeMatched).toHaveBeenCalledWith({
        routeId: "high-route",
        routeName: "High Priority",
      });
      expect(mockRoutingFormTrace.fallbackRouteUsed).not.toHaveBeenCalled();
    });
  });
});
