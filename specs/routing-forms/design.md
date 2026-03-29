# Routing Forms Design

## Overview

Sprint 5: Routing Forms (F-015) achieves behavioral parity between Cal.com's routing form system and Calendly's routing form workflows. This sprint enhances the form builder, aligns conditional routing logic, ensures field type parity with Calendly's question types, and extends the API v2 surface with endpoint parity. Cal.com's routing forms already exceed Calendly's capabilities (RAQB rule engine, attribute-based routing, nested routers, CRM integration), so this sprint focuses on closing the remaining medium-severity gaps while preserving these advantages.

## Problem Statement

Cal.com's routing forms **significantly exceed** Calendly's capabilities in conditional routing sophistication. Cal.com employs React Awesome Query Builder (RAQB) v5.1.2 with `jsonLogic` for arbitrarily complex rule evaluation, supports attribute-based team member matching via `findTeamMembersMatchingAttributeLogic`, integrates CRM lookups (Salesforce, HubSpot) for contact owner routing via `routerGetCrmContactOwnerEmail`, provides native nested router support via `zodRouterRoute`, and exposes a programmatic API v2 endpoint for slot calculation via `POST /v2/routing-forms/:routingFormId/calculate-slots`. Calendly's routing forms are simpler — primarily using form-answer-based conditional logic with CRM lookup available at higher tiers.

However, four medium-severity gaps exist compared to Calendly's routing form model, as identified in the gap report at `docs/gap-report/routing-forms.mdx`:

1. **RF-GAP-001 — No dedicated `routing_form_submission.created` webhook event**: Cal.com does not fire a dedicated webhook event when a routing form is submitted. Calendly fires `routing_form_submission.created` on every form submission, including those that do not result in a booking. This gap is addressed in Sprint 4 (WH-003) as a cross-sprint dependency — Sprint 5 does not implement the webhook itself.

2. **RF-GAP-002 — No built-in routing form response analytics dashboard**: Calendly provides a built-in analytics view with response listing, filtering by result type and date range, and CSV export. Cal.com stores responses via `RoutingFormResponseRepository` but does not expose a polished analytics UI. This gap is deferred to future work.

3. **RF-GAP-003 — No third-party marketing form import (HubSpot, Marketo, Pardot)**: Calendly supports importing external form field definitions from marketing automation platforms. Cal.com does not provide native third-party form import adapters. This gap is deferred to future work.

4. **RF-GAP-004 — No data enrichment integration (Clearbit/ZoomInfo)**: Calendly leverages data enrichment providers in HubSpot/Marketo/Pardot forms for routing decisions. Cal.com does not integrate data enrichment. This gap is deferred to future work.

The Sprint 5 epics focus on the in-scope work that closes behavioral parity gaps and extends the platform surface:

| Epic ID | Name | Priority | Complexity |
|---------|------|----------|------------|
| RF-001 | Routing form builder parity | Medium | M |
| RF-002 | Conditional routing logic alignment | High | L |
| RF-003 | Form field type parity | Medium | M |
| RF-004 | Routing form API v2 endpoint parity | Medium | M |

## User Stories

- As a Cal.com team admin, I want to build routing forms with Calendly-equivalent question types (multiple choice with radio buttons, dropdowns, checkboxes, text fields) so that I can qualify and route visitors using familiar form patterns that match industry expectations.

- As a Cal.com team admin, I want conditional routing logic that correctly handles all Calendly-equivalent condition patterns (equals, not equals, contains, is one of, AND/OR compound conditions) so that visitors are directed to the correct destination based on their form responses without any behavioral differences from Calendly.

- As a Cal.com form builder, I want all Calendly-supported field types available in the routing form builder — including explicit radio button rendering for single-select questions — so that I can create forms with full visual and functional parity.

- As a developer integrating with Cal.com's API, I want API v2 endpoints for listing routing forms (`GET /v2/routing-forms`), retrieving a single form (`GET /v2/routing-forms/:routingFormId`), and listing submissions (`GET /v2/routing-forms/:routingFormId/submissions`) so that I can programmatically manage routing forms with parity to Calendly's read-only API surface.

## Technical Design

### Database Changes

All schema changes follow zero-downtime-safe patterns defined in `docs/migration/zero-downtime-strategy.mdx`. No column renames, type changes, NOT NULL without defaults, or any other anti-patterns are used.

**No database schema changes are required for Sprint 5.** The existing `App_RoutingForms_Form` and `App_RoutingForms_FormResponse` models, along with the `zodNonRouterField` schema, already support the required field types for Calendly parity. The current field type system — `text`, `textarea`, `number`, `email`, `phone`, `select`, `multiselect` — maps to all of Calendly's question types:

| Calendly Question Type | Cal.com Field Type | Already Supported |
|-----------------------|-------------------|-------------------|
| Text field | `text` | Yes |
| Multiple choice (radio buttons) | `select` (with display variant) | Functionally yes; display variant enhancement is a UI-layer concern |
| Dropdown | `select` | Yes |
| Checkboxes | `multiselect` | Yes |
| Long text | `textarea` | Yes |

The `select` field type already stores options as an array of `{ label, id }` objects via the `zodNonRouterField` schema. Adding a radio button display variant does not require a schema change — the rendering mode is determined at the UI layer based on field configuration metadata. If a `displayAs` property is needed to distinguish dropdown vs. radio rendering, it can be added as an optional property to the `zodNonRouterField` Zod schema without any Prisma model changes, since form fields are stored as JSON in the `App_RoutingForms_Form.fields` column.

#### Data Preservation Guarantee

All existing routing form records remain intact and unmodified:

- **`App_RoutingForms_Form`** — All existing forms with their field configurations, routes, route conditions (`queryValue`), and attribute routing configurations are preserved unchanged
- **`App_RoutingForms_FormResponse`** — All existing form response records with submission data and routing decisions are preserved unchanged
- **Route `queryValue` JSON trees** — All stored RAQB rule configurations remain valid and backward-compatible with any schema extensions
- **Verification**: Row count comparison before and after any changes; spot-check that existing forms render and evaluate correctly with the updated codebase

### API Changes

#### RF-001 — Form Builder Parity

**File**: `packages/app-store/routing-forms/zod.ts`

Review and optionally extend `zodNonRouterField` with a `displayAs` property to support explicit display variant selection for `select` fields:

```typescript
// Optional extension to zodNonRouterField (additive only)
displayAs: z.enum(["dropdown", "radio"]).optional(),
```

- When `displayAs` is `"radio"`, the `select` field renders as a radio button group instead of a dropdown — matching Calendly's "Multiple choice" question type
- When `displayAs` is omitted or `"dropdown"`, the existing dropdown rendering is preserved (backward compatible)
- This is an optional field addition to the Zod schema only — no Prisma migration needed since fields are stored as JSON

**File**: `packages/features/routing-forms/lib/zod.ts`

The canonical `zodNonRouterField` definition lives here. The `displayAs` property is added to this base schema:

```typescript
export const zodNonRouterField = z.object({
  // ... existing fields ...
  displayAs: z.enum(["dropdown", "radio"]).optional(),
});
```

**File**: `packages/app-store/routing-forms/components/FormInputFields.tsx`

Update the form builder UI to support the new display variant:

- Add a rendering branch for `select` fields where `displayAs === "radio"` renders a radio button group instead of the default dropdown
- The radio button group uses the same `options` array structure already defined in `zodNonRouterField`
- Form builder field type selector must expose the display variant option when the `select` type is chosen

**Form customization verification**: Verify that headline, description, and custom submission button text configuration matches Calendly's form builder. The existing form builder already supports title and description fields on the `App_RoutingForms_Form` model.

#### RF-002 — Conditional Routing Logic Alignment

**File**: `packages/app-store/routing-forms/lib/processRoute.tsx`

Verify and enhance `findMatchingRoute` to ensure all Calendly-equivalent conditional routing patterns are handled correctly:

- The existing `evaluateRaqbLogic` function evaluates RAQB `queryValue` against form field response data via `jsonLogic`
- Calendly supports the following condition operators: equals, not equals, contains, is one of, AND/OR compound conditions
- Cal.com's RAQB engine already supports all these operators and more (numeric comparisons, multiselect_equals, regex patterns)
- Verification is the primary task: confirm that all Calendly operator equivalents produce correct results in the RAQB configuration

**File**: `packages/app-store/routing-forms/lib/getQueryBuilderConfig.ts` (referenced via `getQueryBuilderConfigForFormFields`)

Ensure the RAQB configuration for each field type includes all required operators:

| Field Type | Required Operators (Calendly Parity) | RAQB Equivalent |
|-----------|--------------------------------------|----------------|
| `select` | equals, not equals, is one of | `select_equals`, `select_not_equals`, `select_any_in` |
| `multiselect` | contains, is one of | `multiselect_equals`, `multiselect_not_equals` |
| `text` | equals, not equals, contains | `equal`, `not_equal`, `like` |
| `number` | equals, not equals, greater than, less than | `equal`, `not_equal`, `greater`, `less` |
| `email` | equals, contains (domain match) | `equal`, `like` |

**Compound conditions**: Verify that RAQB correctly handles Calendly's AND/OR compound condition patterns. The RAQB `queryValue` JSON tree structure supports nested `group` nodes with `conjunction` properties (`AND`/`OR`), which maps directly to Calendly's compound condition model.

#### RF-003 — Form Field Type Parity

The field type mapping between Calendly and Cal.com is as follows:

| Calendly Question Type | Cal.com Field Type | Display Variant | Routing Operators |
|-----------------------|-------------------|-----------------|-------------------|
| Multiple choice (radio) | `select` | `displayAs: "radio"` | equals, not equals, is one of |
| Dropdown | `select` | `displayAs: "dropdown"` (default) | equals, not equals, is one of |
| Checkboxes | `multiselect` | default (checkboxes) | contains, is one of |
| Text field | `text` | default | equals, not equals, contains |
| Long text | `textarea` | default | equals, not equals, contains |

**File**: `packages/features/routing-forms/lib/zod.ts`

The existing `zodNonRouterField` schema already supports all required field types. The `type` property is typed as `z.string()` which accepts any field type identifier. The `options` array is already defined for `select` and `multiselect` types. The only extension needed is the optional `displayAs` property documented above in RF-001.

**File**: `packages/features/routing-forms/lib/parseRoutingFormResponse.ts`

Verify that response parsing correctly handles all field types. The existing parsing logic uses `z.union([z.string(), z.number(), z.array(z.string())])` for response values, which already covers:
- `text`/`textarea`/`email`/`phone` → `string` value
- `number` → `number` value
- `select` → `string` value (selected option ID)
- `multiselect` → `string[]` value (selected option IDs)

No changes are expected unless testing reveals edge cases in specific field type handling.

**File**: `packages/features/routing-forms/lib/types.ts`

The existing `FormResponse` type supports all value types needed for field parity:

```typescript
export type FormResponse = Record<
  string,  // Field ID
  {
    value: number | string | string[];
    label: string;
    identifier?: string;
  }
>;
```

No type definition changes are required for RF-003.

#### RF-004 — API v2 Endpoint Parity

Calendly's routing form API provides three read-only endpoints:

- `GET /routing_forms` — List routing forms for an organization or user
- `GET /routing_forms/:uuid` — Get a single routing form by UUID
- `GET /routing_form_submissions` — List submissions for a specific routing form

Cal.com's current API v2 surface only provides `POST /v2/routing-forms/:routingFormId/calculate-slots`. To achieve parity, three new read-only endpoints must be added.

**File**: `apps/api/v2/src/modules/routing-forms/controllers/routing-forms.controller.ts`

Extend `RoutingFormsController` with new endpoints:

```typescript
@Get("/")
@ApiOperation({ summary: "List routing forms" })
@HttpCode(HttpStatus.OK)
async listRoutingForms(
  @Query() query: PaginationInput,
  @GetUser() user: UserWithProfile
): Promise<RoutingFormsListOutput> { ... }

@Get("/:routingFormId")
@ApiOperation({ summary: "Get a routing form by ID" })
@HttpCode(HttpStatus.OK)
async getRoutingForm(
  @Param("routingFormId") routingFormId: string,
  @GetUser() user: UserWithProfile
): Promise<RoutingFormOutput> { ... }

@Get("/:routingFormId/submissions")
@ApiOperation({ summary: "List routing form submissions" })
@HttpCode(HttpStatus.OK)
async listRoutingFormSubmissions(
  @Param("routingFormId") routingFormId: string,
  @Query() query: PaginationInput,
  @GetUser() user: UserWithProfile
): Promise<RoutingFormSubmissionsOutput> { ... }
```

These endpoints follow existing API v2 patterns:
- NestJS decorators: `@Get()`, `@ApiOperation`, `@ApiTags`, `@HttpCode(HttpStatus.OK)`
- API key authentication via the existing `@ApiHeader(API_KEY_HEADER)` decorator
- Pagination via query parameters following the existing `PaginationInput` pattern
- Response shapes following the `{ status: SUCCESS_STATUS, data: ... }` convention

**File**: `apps/api/v2/src/modules/routing-forms/services/routing-forms.service.ts`

Extend `RoutingFormsService` with listing and retrieval operations:

- `listRoutingForms(userId, organizationId, pagination)` — Query forms owned by the user or their organization/team, with pagination support
- `getRoutingFormById(routingFormId, userId)` — Retrieve a single form with authorization checks
- `listFormSubmissions(routingFormId, userId, pagination)` — Retrieve paginated form submissions with authorization checks

Authorization must verify the requesting user has access to the form via team or organization membership, consistent with Cal.com's PBAC model.

**File**: `apps/api/v2/src/modules/routing-forms/routing-forms.repository.ts`

Extend `RoutingFormsRepository` with data access methods:

- `findRoutingFormsByUserId(userId, pagination)` — Query `App_RoutingForms_Form` for user-owned forms
- `findRoutingFormsByTeamId(teamId, pagination)` — Query forms for a specific team
- `findRoutingFormById(routingFormId)` — Retrieve a single form with fields and routes
- `findFormSubmissions(routingFormId, pagination)` — Query `App_RoutingForms_FormResponse` with pagination

All queries use the existing `PrismaReadService` for read operations, consistent with the repository pattern used throughout the API v2 module.

**New output DTOs**:

- `RoutingFormsListOutput` — Paginated list of routing forms with form ID, name, description, field count, route count, and creation timestamp
- `RoutingFormOutput` — Single routing form with full field definitions, route configurations, and team/user associations
- `RoutingFormSubmissionsOutput` — Paginated list of form submissions with response data, chosen route, and submission timestamp
- `RoutingFormSubmissionOutput` — Single submission detail

**File**: `apps/api/v2/src/modules/routing-forms/outputs/response-slots.output.ts`

The existing `ResponseSlotsOutput` DTO is preserved unchanged. New output DTOs are created as separate files alongside it.

### UI Changes

Sprint 5 has limited UI surface. The primary UI change is adding radio button rendering support for the `select` field type in the form builder.

#### 1. Form Input Field Rendering (RF-001, RF-003)

**File**: `packages/app-store/routing-forms/components/FormInputFields.tsx`

- Add a rendering branch for `select` fields with `displayAs === "radio"` that renders a radio button group using Cal.com's `@calcom/ui` radio components
- Radio button groups display each option from the field's `options` array as a labeled radio input
- Selection updates the field value identically to the dropdown — the response stores the selected `option.id` (or `option.label` for legacy options with null IDs)
- The form builder field type configuration panel must expose a "Display as" toggle (Dropdown / Radio buttons) when the `select` type is chosen

#### 2. Form Builder Field Type Selector

- Ensure the field type selector dropdown includes all Calendly-equivalent labels for clarity:
  - "Short text" → maps to `text` type
  - "Long text" → maps to `textarea` type
  - "Number" → maps to `number` type
  - "Email" → maps to `email` type
  - "Phone" → maps to `phone` type
  - "Single select (dropdown)" → maps to `select` type with `displayAs: "dropdown"`
  - "Single select (radio)" → maps to `select` type with `displayAs: "radio"`
  - "Multi select (checkboxes)" → maps to `multiselect` type
- Existing field type behavior remains unchanged for backward compatibility

#### 3. Form Preview and Test Mode

- Verify that the form preview functionality (triggered via `cal.isBookingDryRun` parameter) correctly renders all field types including the new radio button variant
- Radio button fields must behave identically in preview and live modes

#### 4. No Changes Required

The following UI components require no modifications:

- **Route destination configuration** — Already supports event type, custom message, and external URL redirect via `RouteActionType`
- **Nested router support** — Already functional via `zodRouterRoute` with inline route expansion in `findMatchingRoute`
- **RAQB rule editor** — Already supports complex conditional logic with AND/OR compound conditions, which exceeds Calendly's capabilities
- **Fallback route configuration** — Already functional via `isFallback` route property with configurable fallback actions
- **Attribute-based routing configuration** — Already exceeds Calendly via `attributesQueryValue` and `fallbackAttributesQueryValue`
- **CRM routing configuration** — Already functional for Salesforce and HubSpot via `routerGetCrmContactOwnerEmail`

## Edge Cases

### 1. Existing Form Backward Compatibility

When extending `zodNonRouterField` with the optional `displayAs` property, all existing forms with current field types must continue to parse and evaluate correctly. The Zod schema extension uses an optional property (`displayAs: z.enum(["dropdown", "radio"]).optional()`) that defaults to `undefined` when not present, which is treated as `"dropdown"` behavior. No migration of existing form data is required — existing `select` fields without `displayAs` render as dropdowns, maintaining identical behavior to the current implementation.

### 2. RAQB Configuration Backward Compatibility

Adding new operators or field types to the RAQB configuration via `getQueryBuilderConfigForFormFields` must not break existing `queryValue` evaluation. The RAQB `queryValue` JSON tree structure stores operator names and field references that must remain resolvable. Any new operator additions must be additive — existing operators must continue to resolve to the same evaluation logic. The `evaluateRaqbLogic` function in `packages/lib/raqb/evaluateRaqbLogic.ts` must handle unrecognized operators gracefully, which is covered by the existing `RaqbLogicResult.LOGIC_NOT_FOUND_SO_MATCHED` fallback behavior.

### 3. Empty RAQB Rules on New Field Types

If a route's `queryValue` references a field type or operator that wasn't available when the rule was created, `evaluateRaqbLogic` should gracefully handle the mismatch without throwing an error. The existing `RaqbLogicResult.LOGIC_NOT_FOUND_SO_MATCHED` result code indicates that the logic was not parseable but the route should still be considered matched — this provides a safe fallback for configurations that reference unavailable constructs.

### 4. API v2 Pagination for Large Form Lists

The new `GET /v2/routing-forms` and `GET /v2/routing-forms/:routingFormId/submissions` endpoints must support pagination to handle organizations with hundreds of routing forms or thousands of submissions. Follow existing API v2 pagination patterns: `take` and `skip` query parameters with a default page size (e.g., 20) and maximum page size (e.g., 100). Total count should be returned in the response metadata for client-side pagination controls.

### 5. Rate Limiting for API v2 Endpoints

New read-only API endpoints should have appropriate rate limits to prevent abuse. The existing `checkRateLimitAndThrowError` pattern in `packages/features/routing-forms/lib/getRoutedUrl.ts` provides a reference for request-level rate limiting using a deterministic hash-based identifier. The new read-only endpoints should use a per-user rate limit (e.g., 100 requests per minute) rather than a per-response-hash limit.

### 6. Concurrent Form Modifications

If a form is being edited while submissions are being processed, the `findMatchingRoute` evaluation should use a consistent snapshot of the form configuration. The existing Prisma query in `PrismaRoutingFormRepository.findFormByIdIncludeUserTeamAndOrg` retrieves the form state at query time, which provides read-after-write consistency within a single request. Concurrent modifications during route evaluation are handled by Prisma's default transaction isolation level (Read Committed in PostgreSQL).

### 7. Field Type Migration for Display Variants

If the new `displayAs: "radio"` variant is added for the `select` field type, all existing `select` fields must default to the current dropdown rendering without requiring manual migration. The Zod schema's `.optional()` modifier on `displayAs` ensures that existing field JSON objects without the property parse successfully and render as dropdowns. Form administrators can opt into radio button rendering on a per-field basis through the form builder UI.

### 8. API v2 Authorization for Cross-Team Forms

When a user requests `GET /v2/routing-forms`, the service must correctly resolve which forms the user has access to. For individual users, this includes forms they own directly. For team members, this includes forms owned by their team. For organization members, this may include forms owned by any team within their organization, depending on the user's role. The authorization logic must align with Cal.com's PBAC model and the existing `isAuthorizedToViewFormOnOrgDomain` pattern used in `getRoutedUrl.ts`.

### 9. Option ID Backward Compatibility

The `zodNonRouterField` schema allows `option.id` to be either a `string` or `null`. Null IDs exist for legacy options generated from the deprecated `selectText` property. When evaluating RAQB rules, the routing logic must continue to match using `option.label` for legacy options with null IDs, and `option.id` for modern options with string IDs. This dual-matching behavior is preserved in the `evaluateRaqbLogic` evaluation and must not be disrupted by any field type changes.

## Out of Scope

The following items are explicitly excluded from Sprint 5: Routing Forms:

1. **RF-GAP-002 — Response analytics dashboard**: Deferred to future work. Medium severity but not in RF-001 through RF-004 epic scope. Calendly's built-in analytics view with filtering, date range selection, and CSV export is a valuable feature but is not required for behavioral parity of the routing engine itself.

2. **RF-GAP-003 — Third-party marketing form import (HubSpot, Marketo, Pardot)**: Deferred to future work. Medium severity. Creating integration adapters that import form field definitions from external marketing automation platforms is a significant effort that is not part of the core routing parity work.

3. **RF-GAP-004 — Data enrichment integration (Clearbit/ZoomInfo)**: Deferred to future work. Medium severity. Integrating data enrichment providers to populate hidden routing fields with industry, company size, and other enriched data requires third-party API integration work beyond routing parity scope.

4. **Webhook payload changes**: The `routing_form_submission.created` webhook event (RF-GAP-001) is addressed in Sprint 4 (WH-003) as a cross-sprint dependency, not in Sprint 5. Sprint 5 does not modify any webhook infrastructure in `packages/features/webhooks/`.

5. **Attribute-based routing enhancements**: Cal.com's attribute-based team member routing via `findTeamMembersMatchingAttributeLogic` already exceeds Calendly (RF-ADV-002). No modifications are needed for parity — this is a Cal.com competitive advantage.

6. **Nested router enhancements**: Cal.com's native nested router support via `zodRouterRoute` and inline route expansion in `findMatchingRoute` already exceeds Calendly (RF-ADV-003). Calendly requires daisy-chaining separate forms as a workaround. No modifications are needed.

7. **Routing trace observability enhancements**: Cal.com's routing trace via `RoutingFormTraceService` and `RoutingTraceService` already exceeds Calendly (RF-ADV-005). No modifications are needed for parity.

8. **Performance optimization**: Large team attribute routing performance optimization (noted in `packages/app-store/routing-forms/TODO.md` for teams with ~1000 members and ~100 attributes) is deferred unless directly required for behavioral parity. URL parameter payload size limits for `routedTeamMemberIds` are also deferred.

9. **RAQB version upgrade**: RAQB remains pinned at `react-awesome-query-builder` v5.1.2. A version upgrade introduces risk to existing `queryValue` evaluation and stored rule compatibility that is not justified for parity work.

10. **Form builder drag-and-drop reordering**: Calendly supports drag-and-drop question reordering in the form builder. If Cal.com's form builder already supports field reordering, verify it works during RF-001 implementation; otherwise defer as a UI enhancement beyond parity scope.

11. **Embed system changes**: `packages/embeds/embed-core/`, `packages/embeds/embed-react/`, and `packages/embeds/embed-snippet/` are Sprint 6 (Embed and Share) scope. Routing form embeddability is not modified in Sprint 5.

12. **Email/SMS notification changes**: `packages/emails/` and `packages/sms/` are Sprint 8 (Notifications and Workflows) scope. Notification behavior for routing form submissions is not modified in Sprint 5.

13. **Programmatic form creation/modification API**: Calendly's API does not support creating or modifying routing forms programmatically. Cal.com's API v2 parity scope (RF-004) is limited to read-only endpoints matching Calendly's surface. Full CRUD endpoints may be added in future iterations.

14. **Seated event support for routing form targets**: Routing forms targeting seated events is noted as a known gap in `packages/app-store/routing-forms/TODO.md` but is not part of the Calendly parity scope.
