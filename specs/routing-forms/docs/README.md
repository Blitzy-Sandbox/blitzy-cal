# Routing Forms

## Overview

Sprint 5: Routing Forms (F-015) ensures behavioral parity between Cal.com's routing form system and Calendly's routing form workflows. This sprint encompasses four core epics — Routing form builder parity (RF-001), Conditional routing logic alignment (RF-002), Form field type parity (RF-003), and API v2 endpoint parity (RF-004). Cal.com's routing forms already exceed Calendly's capabilities through the RAQB rule engine, attribute-based team member routing, native nested routers, and CRM contact owner integration, so this sprint focuses on closing remaining gaps while preserving these advantages. The two primary parity gap closures in scope are extending the API v2 surface to match Calendly's read-only routing form endpoints and ensuring all Calendly question types are supported with equivalent field types and RAQB operators. For full behavioral details, see the gap report at `docs/gap-report/routing-forms.mdx`.

## How to Use

### Step 1: Build a Routing Form with Field Types

Navigate to **Apps → Routing Forms** to access the routing form builder. Create a new routing form by providing a headline and description, then add fields (questions) to the form using supported field types: `text`, `textarea`, `number`, `email`, `phone`, `select` (dropdown/multiple choice), and `multiselect` (checkboxes). Each field can be configured with a label, identifier, placeholder text, required flag, and options (for select/multiselect types). The field type `select` renders as a dropdown by default; for Calendly-equivalent "multiple choice" radio button rendering, the form builder provides display variant configuration. All field properties are defined by the `zodNonRouterField` schema in `packages/app-store/routing-forms/zod.ts`.

*Screenshot: Navigate to Apps → Routing Forms and open the form builder to view field configuration, the field type selector, and options configuration for select/multiselect fields. Capture this screenshot when the routing form builder UI is available and save as `./screenshots/step-1.png`.*

### Step 2: Configure Conditional Routing Rules and Test

Configure routing rules for each route using the RAQB (React Awesome Query Builder) rule editor. Each route defines conditions based on form field responses: select a field, choose an operator (equals, not equals, contains, is one of), and specify the matching value. Compound conditions with AND/OR operators are supported for complex routing logic. Set the route destination using one of three action types: **Event Type Redirect** (`eventTypeRedirectUrl`) redirects to a Cal.com event type booking page, optionally with routed team member IDs from attribute-based matching; **Custom Page Message** (`customPageMessage`) displays a custom text message for disqualification or informational responses; **External Redirect** (`externalRedirectUrl`) redirects to an external URL with query parameters forwarded. Configure a fallback route (marked with `isFallback: true`) that activates when no conditions match — the fallback supports the same three destination types. To preview and test the form, use form preview mode to verify routing logic without recording responses; the `cal.isBookingDryRun=true` parameter enables test submissions. For attribute-based routing targeting team events, configure `attributesQueryValue` to match team members by organizational attributes such as department, skill, or region via `findTeamMembersMatchingAttributeLogic` in `packages/features/routing-forms/lib/`.

*Screenshot: Navigate to the conditional routing rule editor to view RAQB conditions, route destinations with action type configuration, and fallback route settings. Capture this screenshot when the routing rule editor UI is available and save as `./screenshots/step-2.png`.*

## Configuration Options

| Option | Description | Default |
|--------|-------------|---------|
| `zodNonRouterField.type` | The field type for a routing form question. Supported values: `text`, `textarea`, `number`, `email`, `phone`, `select`, `multiselect`. Each type determines the input rendering and the available RAQB operators for routing conditions. Defined in `packages/app-store/routing-forms/zod.ts`. | N/A (required) |
| `zodNonRouterField.required` | Whether the field must be filled before the form can be submitted. Required fields block form submission if left empty. | `false` |
| `zodNonRouterField.options` | Array of `{ label, id }` objects defining the selectable choices for `select` and `multiselect` field types. Not applicable for text-based field types. | `[]` (empty) |
| `RouteActionType` | The destination action when a route's conditions match. One of: `eventTypeRedirectUrl` (redirect to booking page), `customPageMessage` (display message), `externalRedirectUrl` (redirect to external URL). Defined in `packages/app-store/routing-forms/zod.ts`. | N/A (required per route) |
| `route.isFallback` | Marks a route as the fallback route, evaluated last when no other route conditions match. Each form should have exactly one fallback route. | `false` |
| `route.attributesQueryValue` | RAQB JSON tree for attribute-based team member matching. When a route targets a team event type, this configuration determines which team members are eligible based on organizational attributes. Evaluated by `findTeamMembersMatchingAttributeLogic` in `packages/features/routing-forms/lib/`. | `null` (no attribute routing) |
| `route.fallbackAttributesQueryValue` | Alternative RAQB JSON tree used when the primary `attributesQueryValue` matches no team members. Provides a secondary matching strategy before falling back to the route's `fallbackAction`. | `null` (no fallback attribute logic) |
| API v2: `POST /v2/routing-forms/:routingFormId/calculate-slots` | Programmatic slot calculation endpoint. Accepts routing form responses as query parameters, evaluates routing logic, and returns the routed event type along with available booking slots for headless scheduling workflows. Controller at `apps/api/v2/src/modules/routing-forms/`. | N/A (endpoint) |
| API v2: `GET /v2/routing-forms` | Lists routing forms for the authenticated user or organization. Supports pagination for organizations with many routing forms. New endpoint for Sprint 5 RF-004 parity, matching Calendly's `GET /routing_forms`. | N/A (endpoint) |
| API v2: `GET /v2/routing-forms/:routingFormId` | Retrieves a single routing form by ID with its fields, routes, and configuration. New endpoint for Sprint 5 RF-004 parity, matching Calendly's `GET /routing_forms/:uuid`. | N/A (endpoint) |
| API v2: `GET /v2/routing-forms/:routingFormId/submissions` | Lists form submissions for a specific routing form with submission data, routing destination, and timestamp. Supports pagination and filtering. New endpoint for Sprint 5 RF-004 parity, matching Calendly's `GET /routing_form_submissions`. | N/A (endpoint) |

## Common Use Cases

### Lead Qualification Routing

When a sales team receives inbound scheduling requests, a routing form qualifies prospects before booking. For example, a form asks "Company size?" (select: 1-50, 51-200, 201-1000, 1000+) and "Budget range?" (select: Under $10k, $10k-$50k, $50k-$100k, $100k+). Route conditions evaluate responses: if company size is "201-1000" or "1000+" AND budget is "$50k-$100k" or "$100k+", the visitor is redirected to the enterprise account executive event type via `eventTypeRedirectUrl`. Smaller companies are redirected to the SMB sales team event type. Disqualified leads (e.g., "Not sure" budget) receive a `customPageMessage` with resource links and self-service booking options. For CRM-integrated teams, the `routerGetCrmContactOwnerEmail` function in `packages/app-store/routing-forms/lib/crmRouting/` queries Salesforce or HubSpot to route the prospect to their assigned contact owner via round-robin lead skip.

### Support Triage with Multi-Step Routing

Customer support organizations use routing forms to triage incoming requests by urgency and category. A first-level form asks "Issue type?" (select: Billing, Technical, Account) and "Urgency?" (select: Critical, High, Normal, Low). Routes direct critical/high urgency issues to the on-call support team event type; normal/low urgency issues route to the standard support queue. For complex triage workflows, Cal.com's native nested router support enables multi-step routing: the first form determines the department, and each department's nested routing form refines the routing to the specific specialist. Unlike Calendly's workaround of daisy-chaining separate forms via external URL redirects, Cal.com expands nested router routes inline via the `zodRouterRoute` schema in `packages/app-store/routing-forms/zod.ts`, providing seamless multi-step routing in a single form submission flow. Attribute-based routing can further refine triage: configure `attributesQueryValue` to match team members by skill, language, or timezone attributes.

### CRM-Based Contact Owner Routing

When a prospect submits a routing form with their email address, the CRM integration automatically looks up the contact owner. The `routerGetCrmContactOwnerEmail` function queries Salesforce or HubSpot to find the assigned contact owner for that email address. If a contact owner is found, the prospect is routed to that specific person's event type via round-robin lead skip, bypassing the normal round-robin distribution. If no contact owner is found, the fallback action applies — either distributing via standard round-robin or displaying a custom message. This matches Calendly's Salesforce/HubSpot lookup routing capability available on Teams and Enterprise plans.

### Programmatic Scheduling via API v2

Developers building custom scheduling UIs can use the API v2 endpoints for headless routing form workflows. The existing `POST /v2/routing-forms/:routingFormId/calculate-slots` endpoint accepts form responses and returns the routed event type along with available booking slots without recording a submission. New Sprint 5 read-only endpoints — `GET /v2/routing-forms`, `GET /v2/routing-forms/:id`, and `GET /v2/routing-forms/:id/submissions` — enable programmatic management and retrieval of routing forms matching Calendly's API surface. This enables integration scenarios where the routing form UI is embedded in a third-party application while Cal.com handles the routing logic and scheduling backend. The API v2 module is located at `apps/api/v2/src/modules/routing-forms/`.

## FAQ

### What field types are supported in routing forms?

Cal.com routing forms support seven field types, each with corresponding RAQB operators for conditional routing: **text** and **textarea** for short/long text input (route on exact match or contains match); **number** for numeric input (route on numeric comparisons — equals, not equals, greater than, less than); **email** for email input with validation (route on domain match, also used for CRM contact owner lookup via `routerGetCrmContactOwnerEmail`); **phone** for phone number input (route on value match); **select** for single-select dropdown or radio button variant matching Calendly's "multiple choice" question type (route on selected option); and **multiselect** for multi-select checkboxes (route on selected options using the `multiselect_equals` operator). All field types are defined by the `zodNonRouterField` schema in `packages/app-store/routing-forms/zod.ts`.

### How does the RAQB conditional routing engine work?

Cal.com uses React Awesome Query Builder (RAQB) v5.1.2 with `jsonLogic` for route evaluation. Each route stores a `queryValue` — a serialized JSON tree representing the rule configuration built through the RAQB UI. When a form is submitted, the `findMatchingRoute` function in `packages/app-store/routing-forms/lib/processRoute.tsx` iterates through routes, evaluating each route's `queryValue` against the form responses using `evaluateRaqbLogic`. Routes are evaluated sequentially: the first match wins. If no route matches, the fallback route (marked with `isFallback: true`) is used. RAQB supports compound conditions (AND/OR), nested rule groups, and all standard comparison operators. This significantly exceeds Calendly's simpler answer-based matching with basic condition operators.

### Are database migrations needed for Sprint 5?

Sprint 5 routing form changes follow zero-downtime migration patterns from `docs/migration/zero-downtime-strategy.mdx`. Most Sprint 5 work involves extending existing Zod schemas, RAQB configurations, and API v2 endpoints — not database schema changes. The existing `App_RoutingForms_Form` and `App_RoutingForms_FormResponse` Prisma models already support the required field types and response storage. Any additive schema changes (if needed) will use nullable columns with no default constraint to avoid affecting existing rows. All existing routing form records remain intact and unmodified — zero data loss guaranteed per `docs/migration/data-preservation.mdx`.

### What API v2 endpoints are available for routing forms?

The following API v2 endpoints are available or planned for routing forms: **Existing:** `POST /v2/routing-forms/:routingFormId/calculate-slots` — programmatic slot calculation that accepts form responses and returns the routed event type with available booking slots (Cal.com advantage, no Calendly equivalent). **New (Sprint 5 RF-004):** `GET /v2/routing-forms` — list routing forms for the authenticated user or organization, matching Calendly's `GET /routing_forms`. **New (Sprint 5 RF-004):** `GET /v2/routing-forms/:routingFormId` — retrieve a single routing form with its fields, routes, and configuration, matching Calendly's `GET /routing_forms/:uuid`. **New (Sprint 5 RF-004):** `GET /v2/routing-forms/:routingFormId/submissions` — list form submissions with submission data, routing destination, and timestamp, matching Calendly's `GET /routing_form_submissions`. Note that Calendly's routing form API is read-only (no form creation or modification via API). Cal.com's API v2 currently focuses on the same read-only surface plus the unique slot calculation capability.
