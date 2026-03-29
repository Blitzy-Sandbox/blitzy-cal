# Routing Forms Implementation

## Status: not-started

## Completed

## In Progress

## Blocked

## Next Steps

1. Create spec artifacts — `specs/routing-forms/` folder with `design.md`, `implementation.md`, `decisions.md`, `CLAUDE.md`, `prompts.md`, `future-work.md`, and `docs/README.md`
2. RF-001: Form builder parity — Extend `zodNonRouterField` field types in `packages/app-store/routing-forms/zod.ts`, update form builder UI components in `packages/app-store/routing-forms/components/FormInputFields.tsx`
3. RF-002: Conditional routing logic alignment — Enhance `findMatchingRoute` in `packages/app-store/routing-forms/lib/processRoute.tsx` for Calendly-equivalent answer-based matching patterns
4. RF-003: Form field type parity — Add Calendly-equivalent question types (multiple choice radio buttons, dropdown, checkbox), extend field type schema validation, update response parsing in `packages/features/routing-forms/lib/parseRoutingFormResponse.ts`
5. RF-004: API v2 endpoint parity — Extend `RoutingFormsController` in `apps/api/v2/src/modules/routing-forms/controllers/routing-forms.controller.ts` with form listing, form retrieval, and submission listing endpoints to match Calendly's read-only API surface
6. Write Playwright E2E tests for field type parity in `packages/app-store/routing-forms/playwright/tests/field-type-parity.e2e.ts`
7. Write unit tests for enhanced `findMatchingRoute` and `zodNonRouterField` extensions
8. Update `docs/gap-report/routing-forms.mdx` with gap closure evidence
9. Update `docs/sprint-roadmap/epic-catalog.mdx` with completed RF-001 through RF-004 epic status
10. Update `docs/sprint-roadmap/validation-criteria.mdx` with validation gate evidence for Sprint 5

## Session Notes
