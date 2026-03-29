# Routing Forms Prompts

## Sync Implementation Status

Review what's been implemented for routing-forms and update specs/routing-forms/implementation.md

Specifically check progress on:

- **RF-001**: Routing form builder parity — `packages/app-store/routing-forms/components/FormInputFields.tsx` field type rendering, `packages/app-store/routing-forms/zod.ts` field type extensions via `zodNonRouterField`, form customization options (headline, description, custom submission button text), form preview and test mode
- **RF-002**: Conditional routing logic alignment — `packages/app-store/routing-forms/lib/processRoute.tsx` `findMatchingRoute` enhancement for Calendly-equivalent answer-based matching patterns, `evaluateRaqbLogic` operator coverage verification, `getQueryBuilderConfigForFormFields` configuration for all supported field types, compound AND/OR condition handling
- **RF-003**: Form field type parity — `packages/features/routing-forms/lib/zod.ts` field type schema extensions, `zodNonRouterField` additions for Calendly-equivalent question types (multiple choice radio, dropdown, checkboxes, text), `packages/features/routing-forms/lib/parseRoutingFormResponse.ts` response parsing for any new field type variants
- **RF-004**: API v2 endpoint parity — `apps/api/v2/src/modules/routing-forms/controllers/routing-forms.controller.ts` new endpoints (list forms, get form, list submissions), `apps/api/v2/src/modules/routing-forms/services/routing-forms.service.ts` listing and retrieval operations, `apps/api/v2/src/modules/routing-forms/routing-forms.repository.ts` data access for form and submission queries

## Generate Tests

Write tests for routing form field types, RAQB `queryValue` evaluation, `findMatchingRoute` route matching, `handleResponse` response handling, `getRoutedUrl` routing pipeline, and the `RoutingFormsController` API v2 endpoints. Follow existing test patterns in `packages/app-store/routing-forms/playwright/tests/` and `packages/features/routing-forms/lib/`.

Target test files to create or extend:

- `packages/app-store/routing-forms/playwright/tests/field-type-parity.e2e.ts` — New E2E tests for field type parity covering all Calendly-equivalent question types (RF-003)
- `packages/app-store/routing-forms/playwright/tests/basic.e2e.ts` — Extend with Calendly parity routing test cases for conditional logic alignment (RF-002)
- `packages/app-store/routing-forms/playwright/tests/attribute-routing.e2e.ts` — Extend if attribute routing changes are needed for team member matching
- `packages/features/routing-forms/lib/__tests__/processRoute.test.ts` — Unit tests for enhanced `findMatchingRoute` with Calendly-equivalent answer-based matching patterns
- `packages/features/routing-forms/lib/__tests__/getRoutedUrl.test.ts` — Integration tests for the complete routing pipeline including rate limiting, authorization, and response handling
- `apps/api/v2/src/modules/routing-forms/controllers/routing-forms.e2e-spec.ts` — API v2 endpoint tests for new list forms, get form, and list submissions endpoints (RF-004)

Test coverage areas:

- All field types: text, textarea, number, email, phone, select, multiselect (existing) plus any new Calendly-parity display variants (radio-button rendering for single-select)
- RAQB `queryValue` evaluation with all supported operators (equals, not_equals, contains, multiselect_equals, numeric comparisons including less_than, greater_than, between)
- `findMatchingRoute` with router expansion via `isRouter()`, fallback routes via `isFallback`, complex conditional logic with nested RAQB groups, and `RaqbLogicResult.LOGIC_NOT_FOUND_SO_MATCHED` handling
- `handleResponse` response persistence via `RoutingFormResponseRepository`, attribute evaluation via `findTeamMembersMatchingAttributeLogic`, and CRM lookup via `routerGetCrmContactOwnerEmail`
- `getRoutedUrl` complete pipeline including rate limiting (deterministic SHA-256 hash), authorization (`isAuthorizedToViewForm`), form serialization, response storage, route matching, and action execution for all three `RouteActionType` values
- API v2 `calculate-slots` endpoint with valid/invalid routing form IDs and proper error responses
- API v2 form listing endpoint with pagination, team scoping, and organization filtering
- Form field type schema validation via `zodNonRouterField` — verify all field types parse correctly and reject invalid data
- `RouteActionType` actions: `eventTypeRedirectUrl` (with `routedTeamMemberIds`, `formResponseId`, `attributeRoutingConfig` URL parameters), `customPageMessage` (disqualification rendering), `externalRedirectUrl` (query parameter forwarding)
- Nested router route expansion — verify `zodRouterRoute` routes expand inline correctly during `findMatchingRoute` evaluation
- Credential encryption integrity — verify no routing form operations compromise `CALENDSO_ENCRYPTION_KEY`-encrypted data

## Code Review

Review changes for:

- **Type safety**: Strict TypeScript types for all field definitions, route schemas, RAQB configurations, API v2 DTOs, and response data structures
- **Error handling**: Graceful degradation on invalid `queryValue` structures, malformed form responses, missing routing forms, rate limit violations (HTTP 429), and unauthorized access (HTTP 404)
- **Security**: Authorization enforcement via `isAuthorizedToViewForm` for form access, team-based PBAC permissions for form creation and modification, rate limiting for duplicate submissions, no credential leakage in routing trace logs
- **Edge cases**: Empty form responses, forms with all routes deleted, fallback route as the only route, nested router chains with circular references, concurrent form modifications during submission processing, field type migration from existing display variants

Routing-form-specific review items:

- **RAQB backward compatibility**: Verify existing `queryValue` schemas stored in database records parse correctly after `zodNonRouterField` extensions — no existing form should break due to field type changes
- **`processRoute.tsx` backward compatibility**: Confirm `findMatchingRoute` produces identical route matching results for all existing routing form configurations — zero behavioral regression for forms created before Sprint 5 changes
- **Zero-downtime migration compliance**: Verify any database schema changes are additive-only per `docs/migration/zero-downtime-strategy.mdx` — nullable columns, new enum values, feature flag rows only
- **Field type validation**: Confirm all new field types have proper Zod schemas in `zodNonRouterField`, corresponding RAQB widget configurations in `getQueryBuilderConfigForFormFields`, and correct response parsing in `parseRoutingFormResponse`
- **API v2 endpoint consistency**: Verify NestJS controller patterns match existing API v2 conventions — `@Controller`, `@ApiTags`, `@ApiHeader`, `@HttpCode` decorators, service layer delegation, repository data access, proper output DTO definitions with Swagger annotations
- **Webhook payload backward compatibility**: Confirm existing `v2021-10-20` webhook payloads for `BOOKING_CREATED`, `BOOKING_CANCELLED`, and `BOOKING_RESCHEDULED` events remain unchanged after routing form modifications
- **Data preservation**: Verify no existing `App_RoutingForms_Form` or `App_RoutingForms_FormResponse` records are modified or deleted by any schema changes
- **PR discipline**: Maximum 5-7 files changed (excluding tests), maximum 500 lines per PR, one focused change per PR addressing a single epic or cohesive aspect

## Continue Feature

Continue working on routing-forms. Read specs/routing-forms/implementation.md for current status.

Key directories to reference:

- `packages/app-store/routing-forms/` — App Store entry with components/ (FormInputFields.tsx, DynamicAppComponent.tsx), lib/ (processRoute.tsx, crmRouting/), zod.ts, config.json, react-awesome-query-builder/ (BasicConfig, uiConfig, custom widgets)
- `packages/features/routing-forms/` — Core routing logic with lib/ (getRoutedUrl.ts, findTeamMembersMatchingAttributeLogic.ts, handleResponse.ts, parseRoutingFormResponse.ts, types.ts, zod.ts), repositories/ (PrismaRoutingFormRepository.ts, PrismaRoutingFormResponseRepository.ts), di/ (tokens.ts)
- `apps/api/v2/src/modules/routing-forms/` — NestJS API v2 module with controllers/routing-forms.controller.ts, services/routing-forms.service.ts, routing-forms.repository.ts, outputs/response-slots.output.ts
- `packages/features/routing-forms/di/tokens.ts` — DI token definitions (`ROUTING_FORM_DI_TOKENS` with Symbol identifiers)
- `packages/prisma/schema.prisma` — Database schema (`App_RoutingForms_Form`, `App_RoutingForms_FormResponse` models)
- `docs/gap-report/routing-forms.mdx` — Gap report source of truth for Calendly parity targets
- `specs/routing-forms/design.md` — Design specification (authoritative Sprint 5 spec)
- `specs/routing-forms/decisions.md` — Architecture Decision Records (RAQB extension, field type strategy, RouteActionType)

## Generate Docs with Screenshots

Generate documentation for routing-forms with screenshots:

1. Open the routing form builder page in the browser
2. Take screenshots of key UI states:
   - Routing form builder with field configuration showing all available field types (text, select, multiselect, email, phone, number, textarea)
   - Conditional routing rule editor (RAQB UI) showing a multi-condition rule with AND/OR operators
   - Route destination configuration showing all three action types (event type redirect, custom page message, external URL redirect)
   - Fallback route configuration with custom message
   - Form preview/test mode with sample responses
   - Nested router configuration showing a route pointing to another routing form
3. Open the API v2 routing forms endpoints and capture:
   - `POST /v2/routing-forms/:routingFormId/calculate-slots` request and response example
   - New listing and retrieval endpoint responses (if implemented)
4. Save screenshots to `specs/routing-forms/docs/screenshots/`
5. Create/update `specs/routing-forms/docs/README.md` with:
   - Feature overview: Sprint 5 Routing Forms covering form builder parity, conditional routing logic alignment, field type parity, and API v2 endpoint parity with Calendly's routing form workflows
   - How to use: Creating routing forms, configuring field types, building conditional routing rules with RAQB, setting route destinations, testing with form preview, embedding routing forms
   - Configuration options: Field types and their properties (id, label, identifier, placeholder, type, required, options), route conditions (queryValue), route actions (RouteActionType), fallback routes (isFallback), attribute-based routing (attributesQueryValue), CRM contact owner routing
   - Common use cases: Sales lead qualification and routing, support request triage, demo booking with team member matching, multi-step form workflows via nested routers

## Promote Docs to Public

Promote internal docs to public Mintlify docs:

1. Review `specs/routing-forms/docs/README.md` for completeness and accuracy
2. Copy/adapt content to `docs/routing-forms.mdx` — rewrite for external audience
3. Move screenshots to `docs/images/routing-forms/`
4. Update `docs/docs.json` navigation to include the new routing forms page
5. Ensure customer-appropriate language:
   - Remove internal implementation details (DI tokens, service class names, Prisma schema references, RAQB internals)
   - Focus on user-facing functionality (creating forms, configuring routing rules, testing routing logic, embedding forms, using the API)
   - Use consistent terminology matching Cal.com's public documentation style
   - Omit references to Calendly parity or gap closure — present features as Cal.com capabilities
   - Highlight Cal.com advantages naturally (complex rule builder, attribute-based routing, nested forms, programmatic slot calculation) without competitive framing
