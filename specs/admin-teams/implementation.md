# Admin and Teams Implementation

## Status: not-started

## Completed

## In Progress

## Blocked

## Next Steps

1. Spec artifacts creation — `specs/admin-teams/` folder with `design.md`, `implementation.md`, `decisions.md`, `CLAUDE.md`, `prompts.md`, `future-work.md`, and `docs/README.md`
2. AG-001 — Admin role model parity — extend `OrganizationPermissionService` in `packages/features/ee/organizations/lib/` for Calendly admin/owner/user role alignment, extend `OrganizationRepository.ts` in `packages/features/ee/organizations/repositories/` for role model parity, document PBAC-to-Calendly role mapping (custom PBAC role templates for "Group Admin" and "Team Manager" are deferred to AT-FW-001/AT-FW-002 per ADR-001)
3. AG-002 — Team event routing parity — enhance `teamService.ts` in `packages/features/ee/teams/services/` for round-robin and collective scheduling behavioral parity, extend `TeamRepository.ts` in `packages/features/ee/teams/repositories/` for team member routing queries
4. AG-003 — Managed event type push — enhance `TeamEventTypeForm.tsx` in `packages/features/ee/teams/components/` for managed event type push configuration UI, ensure `SchedulingType.MANAGED` push behavior aligns with Calendly's admin-controlled locked event templates
5. AG-004 — Member invitation workflow — extend `inviteMemberUtils.ts` in `packages/features/ee/teams/lib/` and `membershipService.ts` in `packages/features/membership/services/` for Calendly-equivalent invitation lifecycle parity, enhance `MembershipRepository.ts` in `packages/features/membership/repositories/` for invitation acceptance and lifecycle queries
6. Tests — unit tests for PBAC role alignment (`packages/features/ee/organizations/`), team event routing (`packages/features/ee/teams/services/`), managed event push (`packages/features/ee/teams/components/`), and invitation workflows (`packages/features/membership/`)
7. Documentation updates and Gate 3 validation evidence — update `docs/gap-report/admin-teams.mdx` with gap closure status, mark AG-001 through AG-004 as completed in `docs/sprint-roadmap/epic-catalog.mdx`, record validation evidence in `docs/sprint-roadmap/validation-criteria.mdx` across all five gate dimensions (behavioral, regression, data preservation, webhook compatibility, cross-domain integration)

## Session Notes
