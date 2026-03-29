# Admin & Teams Prompts

## Sync Implementation Status

Review what's been implemented for admin-teams and update specs/admin-teams/implementation.md

Specifically check progress on:

- **AG-001**: Admin role model parity — `packages/features/ee/organizations/lib/` PBAC role alignment with Calendly's admin/owner/user structure, `OrganizationPermissionService` permission guards, `packages/features/pbac/services/` role management services, default "Group Admin" and "Team Manager" role templates in `packages/features/pbac/lib/constants.ts`
- **AG-002**: Team event routing behavioral parity — `packages/features/ee/teams/services/teamService.ts` round-robin and collective scheduling alignment, `packages/features/ee/teams/repositories/TeamRepository.ts` team member queries for routing, `packages/features/ee/teams/lib/queries.ts` membership predicates and managed event helpers
- **AG-003**: Managed event type push behavior parity — `packages/features/ee/teams/components/TeamEventTypeForm.tsx` managed event type form with `SchedulingType.MANAGED` enforcement, `packages/features/eventtypes/` event type repository for admin-templated event push, permission-gated managed event option via `canCreateEventType`
- **AG-004**: Member invitation workflow parity — `packages/features/membership/services/membershipService.ts` membership validation with `checkMembership`, `packages/features/ee/teams/lib/inviteMemberUtils.ts` invite token generation, onboarding URL creation, `sendTeamInviteEmail` dispatch, batch email operations, `createMemberships` with seat accounting, `packages/features/membership/repositories/MembershipRepository.ts` invitation lifecycle queries and acceptance checks

## Generate Tests

Write tests for OrganizationPermissionService, TeamService, TeamRepository, MembershipService, MembershipRepository, inviteMemberUtils, PermissionCheckService, and TeamEventTypeForm. Follow existing test patterns in `packages/features/ee/teams/repositories/TeamRepository.test.ts`, `packages/features/ee/teams/lib/__mocks__/payments.ts`, and `packages/features/pbac/infrastructure/repositories/__tests__/`.

Target test files to create or extend:

- `packages/features/ee/organizations/lib/__tests__/OrganizationPermissionService.test.ts` — Organization permission guard tests for admin role model parity (AG-001)
- `packages/features/ee/teams/services/teamService.test.ts` — Team event routing tests for round-robin and collective scheduling parity (AG-002)
- `packages/features/ee/teams/repositories/TeamRepository.test.ts` — Extended team repository tests for routing-related member queries and managed event cascading
- `packages/features/ee/teams/lib/__tests__/inviteMemberUtils.test.ts` — Invitation workflow tests for token generation, batch email operations, and seat accounting (AG-004)
- `packages/features/membership/services/__tests__/membershipService.test.ts` — Membership validation tests for `checkMembership` role derivation and acceptance checks (AG-004)
- `packages/features/membership/repositories/__tests__/MembershipRepository.test.ts` — Invitation lifecycle query tests for acceptance status, admin detection, and pending invite resolution
- `packages/features/pbac/services/__tests__/role.service.test.ts` — Extended PBAC role service tests for default "Group Admin" and "Team Manager" role template creation (AG-001)
- `packages/features/pbac/lib/__tests__/constants.test.ts` — Validation tests for default PBAC role IDs, descriptions, and permission mappings

Test coverage areas:

- PBAC role mapping: Calendly's 5 fixed roles (Owner, Admin, Group Admin, Team Manager, User) to Cal.com's PBAC `resource.action` permissions with wildcard support
- Round-robin scheduling: Even distribution, priority-based weighting, host weight configuration via `TeamRepository.findTeamMembersWithPermission`
- Collective scheduling: Multi-host meeting coordination, all-hosts-required event creation
- Managed event push: `SchedulingType.MANAGED` event template creation, locking, cascading to team members, admin-only editing enforcement
- Invitation lifecycle: Token generation and expiration, onboarding URL construction, `sendTeamInviteEmail` dispatch for new and existing users, batch operations, seat accounting with `checkAdminOrOwner`
- Role validation: `checkMembership` returning correct `isMember`, `isAdmin`, `isOwner` flags, pending membership rejection, last-owner demotion prevention
- Membership checks: `hasMembership`, `hasAcceptedMembershipByEmail`, `hasPendingInviteByUserId`, `getAdminOrOwnerMembership` correctness
- Permission inheritance: Organization hierarchy fallback roles, PBAC feature flag gating with `RoleManagementFactory` toggling between `PBACRoleManager` and `LegacyRoleManager`
- Credential encryption integrity: Verify `CALENDSO_ENCRYPTION_KEY` AES-256 encrypted credentials remain intact after any schema-adjacent changes

## Code Review

Review changes for:

- **Type safety**: Strict TypeScript types for all membership roles, permission strings, team metadata, organization schemas, and event type configurations — no `any` type escapes
- **Error handling**: Graceful degradation on missing memberships, expired invitation tokens, invalid role assignments, and failed Stripe billing operations
- **Security**: Invitation token generation using cryptographically secure random bytes, token expiration enforcement, PBAC permission checks on all admin operations, no privilege escalation from pending memberships
- **Edge cases**: Last-owner demotion prevention, concurrent invitation acceptance, team deletion with managed event cascading, multi-organization membership conflicts, empty team round-robin fallback

Admin-teams-specific review items:

- **PBAC permission model integrity**: Verify no breaking changes to existing role hierarchy — `MembershipRole.OWNER`, `MembershipRole.ADMIN`, and `MembershipRole.MEMBER` must retain their existing semantics and permission mappings
- **`MembershipRole` enum backward compatibility**: Any changes to the Prisma `MembershipRole` enum must be additive only — no removal, renaming, or reordering of existing enum values
- **Zero-downtime migration compliance**: Verify all schema changes use exclusively safe patterns (nullable columns, additive defaults, feature flag rows) per `docs/migration/zero-downtime-strategy.mdx`
- **Invitation workflow token security**: Confirm invite tokens are generated with sufficient entropy, have bounded expiration, and are single-use to prevent replay attacks
- **Team routing fairness in round-robin distribution**: Verify even distribution honors host weights, respects availability windows, and does not degrade under concurrent booking pressure
- **Managed event type push consistency**: Confirm `SchedulingType.MANAGED` events propagate locked settings to all team members atomically — partial push failures must not leave inconsistent state
- **Data preservation**: Verify no existing `Membership`, `Team`, `EventType`, or `Organization` records are modified or deleted by schema changes — per `docs/migration/data-preservation.mdx`
- **Webhook payload backward compatibility**: Confirm existing `v2021-10-20` webhook payloads for team-related events (`BOOKING_CREATED`, `BOOKING_CANCELLED`) remain unchanged — per `docs/migration/webhook-compatibility.mdx`
- **Feature flag gating**: Confirm PBAC role template additions are gated behind the `pbac` feature flag and fall back to `LegacyRoleManager` behavior when disabled

## Continue Feature

Continue working on admin-teams. Read specs/admin-teams/implementation.md for current status.

Key directories to reference:

- `packages/features/ee/organizations/` — Organization management: repositories, permission services, payment services, onboarding, DI wiring, branding context
- `packages/features/ee/organizations/lib/` — Organization utility layer: `OrganizationPermissionService`, `OrganizationPaymentService`, `OrganizationMembershipService`, URL builders, domain resolvers
- `packages/features/ee/organizations/repositories/` — `OrganizationRepository` with creation, lookup, domain management, branding, and billing methods
- `packages/features/ee/organizations/di/` — DI tokens for repositories, membership services, and billing taskers
- `packages/features/ee/teams/` — Team management: components, lib utilities, repositories, services
- `packages/features/ee/teams/services/teamService.ts` — Team lifecycle service with billing, workflow, seat tracking, and domain management
- `packages/features/ee/teams/repositories/TeamRepository.ts` — Team CRUD, membership checks, metadata parsing, slug management
- `packages/features/ee/teams/components/TeamEventTypeForm.tsx` — EE team event type creation form with `SchedulingType` integration
- `packages/features/ee/teams/lib/inviteMemberUtils.ts` — Invitation flows: token generation, onboarding URLs, batch emails, seat accounting
- `packages/features/ee/teams/lib/queries.ts` — Team/member fetchers, membership predicates, managed event helpers
- `packages/features/membership/` — Membership domain: repositories and services
- `packages/features/membership/services/membershipService.ts` — `checkMembership` with `MembershipCheckResult` (isMember, isAdmin, isOwner, role)
- `packages/features/membership/repositories/MembershipRepository.ts` — Acceptance checks, listing helpers, admin detection, pending invite resolution
- `packages/features/eventtypes/` — Event type repository interface, components, lib, and repositories for managed event push (AG-003)
- `packages/features/pbac/` — PBAC system: domain models, permission registry, services, infrastructure, client-side enforcement, utilities
- `packages/features/pbac/services/` — `PermissionCheckService`, `RoleService`, `PermissionDiffService`, `RoleManagementFactory`, `PBACRoleManager`, `LegacyRoleManager`
- `packages/features/pbac/lib/constants.ts` — Default PBAC role IDs, descriptions, and TypeScript-safe unions
- `packages/prisma/schema.prisma` — Database schema: `MembershipRole` enum, `Membership` model, `Team` model, `Organization` model
- `specs/admin-teams/design.md` — Design specification (source of truth)
- `specs/admin-teams/decisions.md` — Architecture Decision Records

## Generate Docs with Screenshots

Generate documentation for admin-teams with screenshots:

1. Open the organization settings page (`/settings/organizations`) in the browser
2. Take screenshots of key UI states:
   - Organization overview with branding configuration (logo, colors, banner)
   - Member management list showing role assignments (Owner, Admin, Member)
   - Role management interface with PBAC custom role creation (when `pbac` feature flag is enabled)
   - Domain-based auto-accept configuration for organization onboarding
3. Open the team management page and capture:
   - Team creation form with sub-team hierarchy
   - Team event type form showing scheduling type selector (Round Robin, Collective, Managed)
   - Managed event type configuration with locked settings indicator
4. Open the member invitation workflow and capture:
   - Invite member dialog with role selector and email input
   - Pending invitation list with resend and revoke actions
   - Invitation acceptance page for new and existing users
5. Save screenshots to `specs/admin-teams/docs/screenshots/`
6. Create/update `specs/admin-teams/docs/README.md` with:
   - Feature overview: Sprint 7 Admin & Teams covering organization hierarchy, PBAC role model, team event routing, managed event types, and member invitation workflows with Calendly behavioral parity
   - How to use: Creating organizations, managing roles and permissions, configuring team event routing, pushing managed event types, inviting and onboarding members
   - Configuration options: `MembershipRole` assignments, PBAC custom roles, `SchedulingType.MANAGED` event locking, `orgAutoAcceptEmail` domain auto-join, invitation token expiration
   - Common use cases: Enterprise organization setup with sub-teams, round-robin team scheduling, admin-controlled managed event templates, bulk member invitation with seat accounting

## Promote Docs to Public

Promote internal docs to public Mintlify docs:

1. Review `specs/admin-teams/docs/README.md` for completeness and accuracy
2. Copy/adapt content to `docs/admin-teams.mdx` — rewrite for external audience
3. Move screenshots to `docs/images/admin-teams/`
4. Update `docs/docs.json` navigation to include the new admin and teams page
5. Ensure customer-appropriate language:
   - Remove internal implementation details (DI tokens, service class names, Prisma schema references, repository methods)
   - Focus on user-facing functionality (creating organizations, managing teams, configuring roles and permissions, inviting members, setting up managed events)
   - Use consistent terminology matching Cal.com's public documentation style
   - Omit references to Calendly parity or gap closure — present features as Cal.com capabilities
