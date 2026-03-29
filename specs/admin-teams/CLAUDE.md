# CLAUDE.md — Admin & Teams

## Project Context

Sprint 7: Admin and Teams (F-009) of the Calendly gap closure initiative. This sprint ensures behavioral parity between Cal.com's hierarchical organization model with PBAC and Calendly's admin/owner/user role model, team event routing, managed event type push, and member invitation workflows. It encompasses 4 epics (AG-001 through AG-004):

- **AG-001** — Admin role model parity: align Cal.com's PBAC model with Calendly's admin/owner/user structure through behavioral verification and mapping documentation (custom PBAC role templates for "Group Admin" and "Team Manager" are deferred to future work items AT-FW-001 and AT-FW-002 per `specs/admin-teams/decisions.md` ADR-001)
- **AG-002** — Team event routing behavioral parity: round-robin and collective scheduling alignment with Calendly's team event distribution patterns
- **AG-003** — Managed event type push behavior parity: admin-templated event types via `SchedulingType.MANAGED` pushed to team members
- **AG-004** — Member invitation workflow parity: token-based invitation lifecycle aligned with Calendly's email-based invitation, acceptance, and rejection patterns

This sprint executes as part of **Wave 3** in parallel with Sprint 4 (Webhooks and Events) and Sprint 5 (Routing Forms). All three Wave 3 sprints must pass their validation gates before Wave 4 sprints (Sprint 6: Embed and Share, Sprint 8: Notifications and Workflows) can begin.

## Before Starting Work

1. Read `specs/admin-teams/design.md`
2. Check `specs/admin-teams/implementation.md` for current progress
3. Look at existing patterns in these relevant directories:
   - `packages/features/ee/organizations/lib/` — Organization payment, permission, domain, onboarding services (OrganizationPaymentService, OrganizationPermissionService, AdminOrganizationUpdateService, OrganizationMembershipService)
   - `packages/features/ee/organizations/repositories/OrganizationRepository.ts` — Organization CRUD, domain management, branding, billing integration
   - `packages/features/ee/organizations/di/` — DI tokens for repositories, membership services, and billing taskers with `bindModuleToClassOnToken` wiring
   - `packages/features/ee/organizations/types/schemas.ts` — `createOrganizationSchema` Zod validation
   - `packages/features/ee/organizations/context/` — `OrganizationBranding` context/provider for React
   - `packages/features/ee/teams/services/teamService.ts` — Team lifecycle service: createInvite, delete, removeMembers, inviteMemberByToken, acceptTeamMembership, leaveTeamMembership, publish
   - `packages/features/ee/teams/repositories/TeamRepository.ts` — Team CRUD, membership checks, slug management, organization-aware queries
   - `packages/features/ee/teams/components/TeamEventTypeForm.tsx` — Team event type form with `SchedulingType` integration (MANAGED, ROUND_ROBIN, COLLECTIVE), permission-gated managed event option
   - `packages/features/ee/teams/lib/inviteMemberUtils.ts` — Team invite token generation, email dispatch (sendSignupToOrganizationEmail, sendExistingUserTeamInviteEmails), batch operations, createMemberships with seat accounting
   - `packages/features/ee/teams/lib/queries.ts` — Team member fetchers, membership predicates
   - `packages/features/membership/services/membershipService.ts` — `checkMembership` returning `MembershipCheckResult` (isMember, isAdmin, isOwner, role?)
   - `packages/features/membership/repositories/MembershipRepository.ts` — Membership data access: acceptance checks, listing, admin detection, org utilities
   - `packages/features/eventtypes/` — Event type repository for managed event push (AG-003)
   - `packages/features/pbac/` — PBAC domain models, permission registry, services (PermissionCheckService, RoleService, RoleManagementFactory)
   - `packages/prisma/schema.prisma` — `MembershipRole` enum (MEMBER, ADMIN, OWNER), `Membership` model, `Team` model
   - `docs/gap-report/admin-teams.mdx` — Admin and teams gap analysis (source of truth for parity targets)
   - `docs/sprint-roadmap/` — Sprint roadmap, epic catalog, validation criteria
   - `docs/migration/zero-downtime-strategy.mdx` — Migration safety patterns

## Code Patterns

Key patterns to follow and reference implementations:

- **PBAC (Permission-Based Access Control) model**: Resource.action permissions (e.g., `team.listMembers`, `booking.read`, `eventType.create`) with wildcard support (`*.*`). `PermissionCheckService` in `packages/features/pbac/services/` handles evaluation with `getUserPermissions`, `getResourcePermissions`, `checkPermission(s)`, and team ID discovery by permission. `RoleManagementFactory` returns either `PBACRoleManager` or `LegacyRoleManager` based on the `pbac` feature flag, ensuring seamless fallback for existing users.
- **MembershipRole enum**: Three base values — `MEMBER`, `ADMIN`, `OWNER`. `membershipService.ts` derives `isAdmin` as true when role is ADMIN or OWNER (owners inherit admin rights). Never add new values without following additive-only migration patterns from `docs/migration/zero-downtime-strategy.mdx`.
- **SchedulingType.MANAGED**: Admin-templated event types pushed to team members. Gated behind `canCreateEventType` permission in `TeamEventTypeForm.tsx`. Team deletion in `TeamService.delete()` cascades to managed events via `TeamRepository.deleteById`.
- **SchedulingType.ROUND_ROBIN and SchedulingType.COLLECTIVE**: Team event routing types. Round-robin distributes bookings across team members; collective requires all team members to be available. Both are configured through `TeamEventTypeForm.tsx` with `SchedulingType` enum integration.
- **DI with symbol-based tokens**: `packages/features/ee/organizations/di/` uses `@evyweb/ioctopus` IoC container. `ORGANIZATION_DI_TOKENS` in `tokens.ts` provides readonly Symbol-based identifiers. Services registered via `createModule()` and `bindModuleToClassOnToken`. New services must follow the same DI pattern with module loaders exporting token + loadModule pairs.
- **Repository pattern**: All data access goes through repository classes (e.g., `OrganizationRepository`, `TeamRepository`, `MembershipRepository`). Never use direct Prisma client calls in service logic. Repositories accept injected Prisma clients for transactional contexts and testability.
- **Invitation workflow via inviteMemberUtils.ts**: Token generation with `randomBytes(32).toString("hex")`, 7-day expiration (`Date.now() + 7 * 24 * 60 * 60 * 1000`), onboarding URL construction via `OnboardingPathService.getGettingStartedPathWhenInvited()`, batch email dispatch via `Promise.allSettled` through `sendEmails()`, seat accounting via `SeatChangeTrackingService.logSeatAddition/logSeatRemoval`.
- **Zero-downtime migration patterns**: Only additive changes per `docs/migration/zero-downtime-strategy.mdx`. Nullable columns, additive enum values, feature flag rows. No destructive operations — no column removals, no column renames, no enum value removals, no table drops. New columns must have defaults or be nullable.
- **Test patterns**: Vitest for unit/integration tests (`teamService.test.ts`, `teamService.integration-test.ts`), Playwright for E2E tests. Follow existing test patterns in `packages/features/ee/organizations/__mocks__/` and team service tests. Integration tests seed realistic Prisma data, track entity IDs for cleanup, and mock billing factories.

## Don't

- Don't add features not in design.md
- Don't skip tests
- Don't break existing PBAC permission model — the `PermissionCheckService`, `RoleService`, and `RoleManagementFactory` must continue functioning for existing users
- Don't remove existing role values from `MembershipRole` enum (MEMBER, ADMIN, OWNER) — backward compatibility is mandatory
- Don't modify SSO/SCIM provisioning (out of scope per AAP Section 0.6.2) — `packages/features/ee/sso/` is not in Sprint 7 scope
- Don't exceed 5-7 files changed (excluding tests) or 500 lines per PR
- Don't use column renames, type changes, NOT NULL without defaults, or any other anti-patterns in migrations
- Don't modify existing webhook payload structures (`v2021-10-20` format) — backward compatibility is mandatory
- Don't modify the `SchedulingType` enum without following additive-only patterns
- Don't combine changes across multiple epics (AG-001 through AG-004) in a single PR — each PR should focus on one epic or one cohesive aspect of an epic
