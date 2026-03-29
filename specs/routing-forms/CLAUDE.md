# CLAUDE.md — Routing Forms

## Project Context

Sprint 5: Routing Forms (F-015) of the Calendly gap closure initiative. This sprint ensures behavioral parity for Cal.com's routing forms system against Calendly's routing form workflows. It encompasses 4 epics (RF-001 through RF-004) covering form builder parity, conditional routing logic alignment, field type parity, and API v2 endpoint parity. Cal.com's routing forms use RAQB (`react-awesome-query-builder` v5.1.2) with `jsonLogic` for rule evaluation, and the system spans three code locations: the App Store entry (`packages/app-store/routing-forms/`), the features package (`packages/features/routing-forms/`), and the API v2 module (`apps/api/v2/src/modules/routing-forms/`).

## Before Starting Work

1. Read `specs/routing-forms/design.md`
2. Check `specs/routing-forms/implementation.md` for current progress
3. Look at existing patterns in these relevant directories:
   - `packages/app-store/routing-forms/` — App Store entry: components/ (FormInputFields.tsx, DynamicAppComponent.tsx), lib/ (processRoute.tsx, crmRouting/), zod.ts, config.json, react-awesome-query-builder/
   - `packages/features/routing-forms/` — Core routing logic: lib/ (getRoutedUrl.ts, findTeamMembersMatchingAttributeLogic.ts, handleResponse.ts, parseRoutingFormResponse.ts, types.ts), repositories/ (PrismaRoutingFormRepository.ts, PrismaRoutingFormResponseRepository.ts), di/ (tokens.ts)
   - `packages/features/routing-forms/lib/zod.ts` — Zod contracts for fields, options, responses (zodNonRouterField)
   - `apps/api/v2/src/modules/routing-forms/` — NestJS API v2 module: controllers/routing-forms.controller.ts, services/routing-forms.service.ts, routing-forms.repository.ts, outputs/response-slots.output.ts
   - `packages/prisma/schema.prisma` — Database schema (App_RoutingForms_Form, App_RoutingForms_FormResponse models)
   - `docs/gap-report/routing-forms.mdx` — Routing form gap report (source of truth for parity targets)
   - `docs/sprint-roadmap/` — Sprint roadmap, epic catalog, validation criteria
   - `docs/migration/zero-downtime-strategy.mdx` — Migration safety patterns

## Code Patterns

Key patterns to follow and reference implementations:

- **RAQB pattern**: RAQB v5.1.2 with `jsonLogic` for rule evaluation. Each route's `queryValue` is a serialized JSON tree evaluated via `evaluateRaqbLogic`. Configuration built via `getQueryBuilderConfigForFormFields`. Custom widgets in `packages/app-store/routing-forms/components/react-awesome-query-builder/`.
- **Field schema pattern**: `zodNonRouterField` defines field properties: `id`, `label`, `identifier`, `placeholder`, `type`, `required`, `deleted`, `options`. Extended via `zodRouterField` for router-aware fields. All field type changes must be additive and backward-compatible with existing form data.
- **Route schema pattern**: `zodNonRouterRoute` defines route properties including `queryValue` (RAQB rule tree), `attributesQueryValue`, `fallbackAttributesQueryValue`, `isFallback`, `action` (with `RouteActionType`), and `fallbackAction`. Routes are evaluated sequentially by `findMatchingRoute`.
- **Route evaluation pattern**: `findMatchingRoute` in `processRoute.tsx` — expand router routes inline, filter non-fallback, append fallback last, evaluate RAQB logic sequentially, return first match or null.
- **Routing pipeline pattern**: `getRoutedUrl` in `packages/features/routing-forms/lib/getRoutedUrl.ts` — rate limit → form lookup → authorization → serialization → response storage → route matching → response handling (attributes + CRM) → action execution.
- **DI pattern**: `ROUTING_FORM_DI_TOKENS` with `Symbol` identifiers in `packages/features/routing-forms/di/tokens.ts`. Use `createModule` and `bindModuleToClassOnToken` for new service registration.
- **NestJS API v2 pattern**: Controllers in `apps/api/v2/src/modules/routing-forms/` use `@Controller`, `@ApiTags`, `@ApiHeader`, `@Post`, `@HttpCode` NestJS decorators. Service layer handles business logic. Repository layer handles Prisma data access.
- **Zero-downtime migration pattern**: Only additive database changes per `docs/migration/zero-downtime-strategy.mdx` — nullable columns, new enum values, feature flag rows.
- **Test patterns**: Vitest for unit tests in packages, Playwright 1.57.0 for E2E tests in `packages/app-store/routing-forms/playwright/tests/`, Jest for NestJS API v2 module E2E specs.

## Don't

- Don't add features not in design.md
- Don't skip tests
- Don't break existing RAQB rule evaluation — existing `queryValue` schemas and stored routes must continue to parse and evaluate correctly after any changes
- Don't modify existing field type schemas destructively — all field type changes must be additive to `zodNonRouterField`
- Don't break `processRoute.tsx` backward compatibility — `findMatchingRoute` must produce identical results for existing routing form configurations
- Don't modify existing route schemas destructively — `zodNonRouterRoute`, `zodRouterRoute`, `RouteActionType` changes must be additive only
- Don't break the API v2 `calculate-slots` endpoint behavior — existing clients must continue to receive valid responses
- Don't exceed 5-7 files changed (excluding tests) or 500 lines per PR
- Don't combine multiple epics in a single PR — each PR should address one epic or one cohesive aspect
- Don't modify webhook payload structures — `v2021-10-20` format backward compatibility is mandatory
- Don't use column renames, type changes, NOT NULL without defaults, or any other anti-patterns in database migrations
