# Admin and Teams Decisions

Architecture Decision Records (ADRs) for Sprint 7: Admin and Teams (F-009) of the Calendly gap closure initiative. Each ADR documents the context, options evaluated, final decision, and consequences for a key architectural trade-off encountered during Sprint 7 implementation.

---

## ADR-001: PBAC Advantage Preservation While Achieving Calendly Role Behavioral Parity

### Context

Sprint 7 epic AG-001 requires aligning Cal.com's admin role model with Calendly's admin/owner/user role structure to achieve behavioral parity for organizations migrating from Calendly. The core tension is that Calendly defines five fixed, non-customizable roles — Owner, Admin, Group Admin, Team Manager, and User — while Cal.com implements three base `MembershipRole` enum values (OWNER, ADMIN, MEMBER) augmented by a comprehensive Permission-Based Access Control (PBAC) system in `packages/features/pbac/`.

Cal.com's PBAC system is identified as a significant architectural advantage (AT-ADV-002 in the admin-teams gap report). The PBAC layer provides `resource.action` granular permissions (e.g., `team.listMembers`, `booking.read`, `eventType.create`), wildcard support (`*.*`), custom role creation and lifecycle management via `RoleService`, and a `PermissionCheckService` that evaluates permissions against team and organization scopes. The `RoleManagementFactory` singleton pattern already enables gradual PBAC adoption by querying a `pbac` feature flag and returning either `PBACRoleManager` (full PBAC implementation) or `LegacyRoleManager` (owner/admin invariant fallback), ensuring zero-risk migration for existing organizations.

The admin-teams gap report concludes that "Cal.com's admin governance model significantly exceeds Calendly's capabilities" — Cal.com implements hierarchical organizations with sub-teams, custom roles, and programmatic organization management, none of which Calendly supports. The gaps identified (AT-001 for Group Admin named role, AT-002 for Team Manager named role) are both rated Low severity because PBAC already supports creating custom roles with equivalent permissions; only the pre-configured named role templates are missing from the UI.

The decision must balance three competing goals: (1) achieving behavioral parity with Calendly's admin experience for migrating users, (2) preserving Cal.com's PBAC architectural advantage as a competitive differentiator, and (3) respecting the AAP's additive-only constraint that prohibits destructive schema changes or breaking changes to existing code.

`Source: packages/features/pbac/services/, packages/features/pbac/domain/types/permission-registry.ts, docs/gap-report/admin-teams.mdx`

### Options Considered

1. **Add Calendly's 5 named roles as new `MembershipRole` enum values** — Extend the Prisma `MembershipRole` enum with GROUP_ADMIN and TEAM_MANAGER values alongside the existing OWNER, ADMIN, and MEMBER values.

   - Pros:
     - Provides a direct one-to-one role name mapping for Calendly migrators, making the transition conceptually simple
     - Role checks in code can use straightforward enum comparisons (e.g., `role === MembershipRole.GROUP_ADMIN`) without requiring PBAC to be enabled
     - Mirrors Calendly's terminology exactly, reducing cognitive overhead for migrating administrators
   - Cons:
     - Breaks the additive-only constraint if existing code paths assume only OWNER/ADMIN/MEMBER values exist — any exhaustive `switch` or `if/else` chain on `MembershipRole` would need updating across the codebase
     - Pollutes the base Prisma enum with Calendly-specific terminology that does not align with Cal.com's own governance model
     - Does not leverage Cal.com's PBAC advantage — hardcoding roles in the enum undermines the flexibility of custom role creation
     - Requires a Prisma schema migration that affects the `Membership` model used by `membershipService.ts`, `inviteMemberUtils.ts`, `TeamRepository.ts`, and `OrganizationRepository.ts`
     - Creates confusion about whether GROUP_ADMIN and TEAM_MANAGER are PBAC roles or base enum roles, blurring the two systems

2. **Create default PBAC role templates that replicate Calendly's roles** — Use PBAC's custom role creation infrastructure (`RoleService.createCustomRole`) to define pre-configured "Group Admin" and "Team Manager" role templates with permission sets matching Calendly's documented capabilities for those roles.

   - Pros:
     - Fully preserves PBAC as the authoritative permission system — no enum changes, no schema migration
     - Additive-only approach: creates new role template records in the PBAC role table without modifying any existing data structures
     - Calendly migrators get familiar named roles ("Group Admin", "Team Manager") as selectable templates during onboarding or role assignment
     - Templates are customizable per organization — administrators can adjust the permission sets after creation to fit their specific needs
     - Aligns with the `RoleManagementFactory` pattern where PBAC-enabled organizations use `PBACRoleManager` for full custom role support
   - Cons:
     - Requires the PBAC feature flag to be enabled for organizations to use these templates, which may not be the case for all deployments
     - Slightly more complex onboarding workflow: administrators must first understand that "Group Admin" is a PBAC role template, then assign it to members, rather than selecting from a simple dropdown of fixed roles
     - Introduces a dependency on PBAC infrastructure being stable and fully tested before Sprint 7 can deliver this capability

3. **Map Calendly roles to existing OWNER/ADMIN/MEMBER with behavioral alignment** — Enhance the existing role behaviors in the service layer (`membershipService.ts`, `OrganizationPermissionService`, `TeamService`) to ensure OWNER, ADMIN, and MEMBER semantics match Calendly's Owner, Admin, and User role capabilities respectively, without adding new role types.

   - Pros:
     - Minimal changes to the codebase — no new enum values, no new PBAC templates, no schema migrations
     - Fully backward compatible: all existing code using `MembershipRole.OWNER`, `MembershipRole.ADMIN`, and `MembershipRole.MEMBER` continues to work without modification
     - The `checkMembership` method in `packages/features/membership/services/membershipService.ts` already derives `isAdmin` and `isOwner` flags from these three roles, requiring no structural changes
     - Cal.com's existing OWNER/ADMIN/MEMBER hierarchy maps cleanly to Calendly's core Owner/Admin/User roles for the vast majority of organizations
     - PBAC custom roles remain available for organizations that need Group Admin or Team Manager granularity, without Sprint 7 depending on PBAC being enabled
   - Cons:
     - Loses direct granularity between Calendly's "Admin" and "Group Admin" behaviors at the base role level — both map to ADMIN unless PBAC is enabled
     - Does not provide named "Group Admin" or "Team Manager" role templates out of the box, requiring organizations that need these to manually create PBAC custom roles
     - Migration documentation must explicitly explain the role mapping and that Group Admin / Team Manager equivalents require PBAC, which adds complexity to the migration guide

### Decision

Choose **Option 3** (map Calendly roles to existing OWNER/ADMIN/MEMBER with behavioral alignment) as the primary approach for Sprint 7, with **Option 2** (default PBAC role templates) documented as a future enhancement in `specs/admin-teams/future-work.md`.

**Rationale:** Sprint 7's scope under AG-001 focuses on achieving *behavioral parity* with Calendly's admin capabilities, not *role name parity*. Cal.com's existing three-role hierarchy already maps cleanly to Calendly's three core functional roles:

- **Calendly Owner → Cal.com OWNER:** Full account ownership, billing management, all administrative capabilities
- **Calendly Admin → Cal.com ADMIN:** Organization-wide management, user administration, managed event types, settings control
- **Calendly User → Cal.com MEMBER:** Individual scheduling, personal event types, personal settings

Calendly's Group Admin and Team Manager roles represent *scoped subsets* of admin capabilities — functionality that Cal.com's PBAC system already supports through custom roles with resource-scoped permissions. Forcing these into the base `MembershipRole` enum would undermine PBAC's architectural advantage and create a dual-system confusion.

Default PBAC role templates for "Group Admin" and "Team Manager" (Option 2) are deferred to `specs/admin-teams/future-work.md` as items AT-FW-001 and AT-FW-002, contingent on PBAC feature flag adoption reaching sufficient deployment coverage.

### Consequences

- No `MembershipRole` enum changes are required — the Prisma schema remains unchanged, ensuring full backward compatibility with all existing services that depend on OWNER/ADMIN/MEMBER values
- Behavioral alignment work in Sprint 7 focuses on ensuring the ADMIN role's permissions in `membershipService.ts`, `OrganizationPermissionService`, and `TeamService` match the full scope of Calendly's admin capabilities (user management, managed events, organization settings)
- Organizations that require Group Admin or Team Manager granularity use PBAC custom roles via the existing `RoleService` and `PBACRoleManager` infrastructure in `packages/features/pbac/services/`
- Calendly migration documentation will provide an explicit role mapping table: Owner → OWNER, Admin → ADMIN, User → MEMBER, Group Admin → PBAC custom role (with recommended permission template), Team Manager → PBAC custom role (with recommended permission template)
- The `RoleManagementFactory` pattern ensures organizations not using PBAC fall back to `LegacyRoleManager` with standard OWNER/ADMIN/MEMBER semantics, maintaining a simple experience for non-enterprise deployments

---

## ADR-002: MembershipRole Enum Stability

### Context

The `MembershipRole` enum in `packages/prisma/schema.prisma` currently defines three values: MEMBER, ADMIN, and OWNER. This enum is a foundational data type referenced throughout the Cal.com codebase across multiple critical services:

- **`membershipService.ts`** (`packages/features/membership/services/membershipService.ts`): The `checkMembership` method queries the `MembershipRepository` for a user's membership record, validates acceptance status, and derives boolean flags (`isOwner`, `isAdmin`, `isMember`) directly from `MembershipRole.OWNER` and `MembershipRole.ADMIN` comparisons.
- **`inviteMemberUtils.ts`** (`packages/features/ee/teams/lib/inviteMemberUtils.ts`): The `createMemberships` function assigns `MembershipRole` values during team and organization invitation workflows, with seat accounting logic tied to role-based membership creation.
- **`TeamRepository.ts`** (`packages/features/ee/teams/repositories/TeamRepository.ts`): Team ownership checks (`isTeamOwner`, `isTeamMember`) and member listing with permission-aware projections rely on `MembershipRole` enum values.
- **`OrganizationRepository.ts`** (`packages/features/ee/organizations/repositories/OrganizationRepository.ts`): Organization creation sets the founding member's role to `MembershipRole.OWNER`, and organization-level permission checks reference the enum.
- **`MembershipRepository.ts`** (`packages/features/membership/repositories/MembershipRepository.ts`): Admin detection methods (`getAdminOrOwnerMembership`, `findTeamAdminsByTeamId`) filter on ADMIN and OWNER roles.

The AAP mandates additive-only database changes per `docs/migration/zero-downtime-strategy.mdx`. Any modification to the `MembershipRole` enum requires a Prisma schema migration, and because the enum is used in comparison expressions across dozens of files, adding new values could introduce subtle behavioral changes if existing code uses exhaustive pattern matching or exclusive `else` branches that implicitly treat all non-OWNER/non-ADMIN values as MEMBER.

Sprint 7 (AG-001 through AG-004) must determine whether enum modification is necessary to achieve Calendly behavioral parity, or whether the existing three values are sufficient when combined with service-layer enhancements.

`Source: packages/prisma/schema.prisma, packages/features/membership/services/membershipService.ts, packages/features/ee/teams/lib/inviteMemberUtils.ts, packages/features/ee/teams/repositories/TeamRepository.ts, packages/features/ee/organizations/repositories/OrganizationRepository.ts`

### Options Considered

1. **Add new enum values for behavioral alignment** — Introduce additional `MembershipRole` values such as SUPER_ADMIN (for organization-level admin distinction from team-level admin) or GROUP_ADMIN and TEAM_MANAGER (for direct Calendly role mapping).

   - Pros:
     - Explicit role differentiation at the data layer — role semantics are immediately clear from the stored enum value without requiring service-layer interpretation
     - Cleaner role checks: code can distinguish organization-level admins from team-level admins directly via the enum (e.g., `role === MembershipRole.SUPER_ADMIN`)
     - Enables database-level queries to filter by the new roles without invoking service logic
   - Cons:
     - Requires a Prisma schema migration to add new enum values — while additive enum additions are technically compatible with the zero-downtime strategy, they carry inherent deployment risk in a production system with 584+ existing migrations
     - All existing code that performs comparisons against `MembershipRole.ADMIN` would need auditing to determine whether the new role should be treated equivalently — the `checkMembership` method's `isAdmin = isOwner || role === MembershipRole.ADMIN` expression would miss SUPER_ADMIN/GROUP_ADMIN unless explicitly updated
     - The `inviteMemberUtils.ts` `createMemberships` function, which defaults new members to `MembershipRole.MEMBER`, would need to be updated to support assigning new roles during invitation
     - Violates the minimal-change principle for Sprint 7: the primary goal is behavioral parity, not data model restructuring
     - Creates potential confusion between enum-based roles and PBAC custom roles, as discussed in ADR-001

2. **Keep existing enum values unchanged, align behavior through service logic** — Preserve the current MEMBER/ADMIN/OWNER enum values and implement all Calendly behavioral parity requirements through enhancements to the service layer (`membershipService.ts`, `OrganizationPermissionService`, `TeamService`).

   - Pros:
     - Zero schema changes — no Prisma migration required, no deployment risk, no impact on the 584+ existing migration history
     - Zero migration risk for existing data — all `Membership` records remain valid without any data transformation
     - Fully backward compatible — every line of existing code that references `MembershipRole.OWNER`, `MembershipRole.ADMIN`, or `MembershipRole.MEMBER` continues to work correctly without modification
     - The `checkMembership` method continues to function identically, returning accurate `isAdmin` and `isOwner` flags
     - Service-layer behavioral enhancements (e.g., ensuring org-level ADMIN can manage all child teams) are isolated, testable, and reversible
     - Aligns with ADR-001's decision to use PBAC for any granularity beyond the three base roles
   - Cons:
     - No new named roles at the database level — the semantic distinction between an organization-level admin and a team-level admin is encoded in service logic and membership scope rather than in the stored enum value
     - Querying for specific sub-roles requires joining with organization/team hierarchy data rather than simple enum filtering

### Decision

Choose **Option 2**: Keep the existing `MembershipRole` enum values (MEMBER, ADMIN, OWNER) unchanged throughout Sprint 7.

All Calendly behavioral parity requirements for AG-001 through AG-004 will be implemented through service-layer enhancements:

- **`membershipService.ts`**: Enhanced permission evaluation to account for organization-level versus team-level admin scope, while keeping the `checkMembership` return contract (`MembershipCheckResult`) unchanged
- **`OrganizationPermissionService`** (in `packages/features/ee/organizations/lib/`): Extended permission validation methods to ensure org-level ADMIN memberships grant appropriate management capabilities across child teams
- **`TeamService`** (in `packages/features/ee/teams/services/teamService.ts`): Enhanced team operations to respect cascading organization admin permissions as defined in ADR-003

This decision directly supports the zero-downtime migration strategy by eliminating schema migration risk and preserving complete backward compatibility for all existing `Membership` records and dependent services.

### Consequences

- No Prisma schema migration is required for the `MembershipRole` enum — the `packages/prisma/schema.prisma` file remains unchanged for this enum, and no new migration file is generated
- The `checkMembership` method in `membershipService.ts` continues to operate with its existing contract: querying by `teamId` and `userId`, checking acceptance, and deriving `isOwner` and `isAdmin` from `MembershipRole.OWNER` and `MembershipRole.ADMIN` respectively
- Role behavioral alignment is achieved entirely in the service layer — this means the "org admin can manage all teams" behavior is enforced by `OrganizationPermissionService` and `TeamService` rather than by a distinct enum value
- Future PBAC custom roles (deferred per ADR-001) provide extensibility for organizations needing named sub-roles without requiring enum changes — the `RoleService` in `packages/features/pbac/services/` manages custom roles in a separate PBAC table, keeping the base `MembershipRole` enum stable
- All Sprint 7 changes are additive behavioral enhancements to existing service methods, fully aligned with the AAP's zero-downtime and additive-only constraints

---

## ADR-003: Organization Hierarchy Mapping for Admin Role Model

### Context

Calendly implements a flat, single-level organization model where all members belong directly to the organization, and admin scope is inherently organization-wide — a Calendly admin can manage all users, groups, and settings across the entire organization from a single Admin Center interface. Calendly does not support sub-organizations or hierarchical team nesting.

Cal.com implements a hierarchical Organization → Team → Sub-team model where administrative scope can be defined at each level through the `Membership` model. An organization is represented as a `Team` record with `isOrganization: true`, and child teams are linked via `parentId`. The `OrganizationRepository` in `packages/features/ee/organizations/repositories/OrganizationRepository.ts` manages organization-level CRUD with methods like `createWithExistingUserAsOwner`, while `TeamRepository` in `packages/features/ee/teams/repositories/TeamRepository.ts` handles team-level operations including `findAllByParentId` for child team discovery and `findTeamMembersWithPermission` for permission-aware member listing.

This hierarchical model means that a user's admin scope in Cal.com depends on *where* their `Membership` record exists:
- A `Membership` with `MembershipRole.ADMIN` on the organization team grants organization-level admin access
- A `Membership` with `MembershipRole.ADMIN` on a child team grants team-level admin access only
- There is no automatic cascading — an org-level admin does not automatically appear as an admin of each child team's `Membership` table

Sprint 7 epic AG-001 requires aligning the admin experience so that Calendly users migrating to Cal.com encounter a familiar admin management model. Specifically, organization-level administrators must be able to manage all teams within the organization — matching Calendly's flat admin experience — without sacrificing Cal.com's hierarchical advantage for organizations that use team-scoped administration.

The `TeamService` in `packages/features/ee/teams/services/teamService.ts` already implements organization-aware logic: the `createInvite` method checks `team.parentId || team.isOrganization` to determine if a team operates within an organizational context, and invite link generation adjusts based on this context. The membership acceptance flow (`acceptTeamMembership`) similarly handles organization-team relationships when creating user profiles.

`Source: packages/features/ee/organizations/repositories/OrganizationRepository.ts, packages/features/ee/teams/repositories/TeamRepository.ts, packages/features/ee/teams/services/teamService.ts, packages/features/membership/services/membershipService.ts`

### Options Considered

1. **Flatten Cal.com's admin experience to match Calendly** — Make organization-level admins automatically full admins of all child teams by inserting `Membership` records with `MembershipRole.ADMIN` for every child team whenever an org-level admin membership is created.

   - Pros:
     - Matches Calendly's admin experience exactly — org admins have explicit membership in every team, making permission checks trivially simple via the existing `checkMembership` method
     - No service-layer permission cascade logic needed — the data model directly represents the flat admin relationship
     - Existing team-scoped queries and repository methods work without modification since the admin's membership record exists in each team
   - Cons:
     - Creates redundant `Membership` records that must be kept in sync — adding a new child team requires creating admin memberships for all org-level admins, and removing an org admin requires cleaning up memberships across all child teams
     - Loses Cal.com's hierarchical advantage entirely for the admin role — organizations that want team-scoped admins (an admin who manages only their team, not all teams) cannot have that granularity
     - Breaks PBAC scoping: if PBAC permissions are scoped to team membership, auto-creating team memberships for org admins grants them PBAC permissions at every team level, potentially violating the principle of least privilege
     - Significant data volume impact for large organizations — an organization with 50 teams and 10 org admins would require 500 additional `Membership` records, with cascading create/delete operations on every team and admin change
     - Could grant unintended access in organizations that deliberately use team-level admin isolation for compliance or data segregation reasons

2. **Preserve hierarchy but ensure org admins have cascading visibility** — Keep the existing hierarchical model where org-level admin memberships are stored only at the organization level, but enhance the service layer to recognize that an organization-level ADMIN or OWNER membership grants management access to all child teams. Team-level ADMIN memberships remain scoped to that specific team.

   - Pros:
     - Preserves Cal.com's hierarchical advantage — organizations can have team-scoped admins who manage only their assigned team while org-level admins manage everything
     - No redundant `Membership` records — an org admin's management capability over child teams is derived from their org-level membership rather than duplicated per team
     - Matches Calendly's admin experience at the organization level: org admins can see, manage, and configure all teams, just as Calendly admins manage all groups and team pages
     - Maintains PBAC scope integrity — PBAC permissions can still be scoped to specific teams for team-level admins while org-level admins receive cascading access through the permission evaluation chain
     - Aligns with the `OrganizationPermissionService` pattern already present in `packages/features/ee/organizations/lib/`, which validates organization-level permissions
   - Cons:
     - Slightly more complex than Calendly's flat model — permission evaluation must check both the team's `Membership` table and the parent organization's `Membership` table for admin access
     - Requires enhancing `checkMembership` or adding a parallel `checkOrganizationCascadingAccess` method that the service layer calls when team-level permission checks fail
     - Simple organizations that mirror Calendly's flat structure still experience the same cascading admin behavior, but the code path involves an additional lookup compared to the flat model

### Decision

Choose **Option 2**: Preserve the hierarchical model with cascading admin visibility from organization to child teams.

The implementation approach for Sprint 7 is:

- **Organization-level OWNER/ADMIN memberships cascade to all child teams for management purposes.** When a team-scoped operation (e.g., managing team members, configuring team event types, viewing team settings) checks for admin access, the service layer first checks the team's `Membership` table. If the user does not have an ADMIN or OWNER membership at the team level, the service checks the parent organization's `Membership` table. If the user is an ADMIN or OWNER at the organization level, they are granted admin access to the child team operation.

- **Team-level ADMIN memberships remain scoped to that team only.** A user with `MembershipRole.ADMIN` on a specific team can manage that team but gains no automatic access to sibling teams or the parent organization's settings.

- **This matches Calendly's admin experience** at the organization level (org admins manage everything) while preserving Cal.com's advantage of team-scoped administration for organizations that need it. Simple organizations migrating from Calendly see the same flat admin experience they are accustomed to. Complex organizations benefit from Cal.com's granular team-level admin scoping.

### Consequences

- The `OrganizationPermissionService` in `packages/features/ee/organizations/lib/` is enhanced to validate cascading permissions: when a team-level admin check fails, the service checks whether the user holds an ADMIN or OWNER membership on the team's parent organization (resolved via the `parentId` relationship on the `Team` model)
- Team-scoped operations in `TeamService` and `TeamRepository` incorporate a cascading permission check pattern: `checkTeamMembership(teamId, userId) || checkOrgMembership(team.parentId, userId)` — ensuring org admins can perform any team management action
- The `checkMembership` method in `membershipService.ts` retains its existing contract (single team + user lookup) and is not modified — the cascading logic is implemented at the orchestration layer in `OrganizationPermissionService` and `TeamService`, keeping the `MembershipService` focused on single-scope membership evaluation
- Cal.com's multi-level hierarchy remains intact as a competitive advantage (AT-ADV-001): organizations can nest teams and sub-teams with independent admin scoping, a capability Calendly does not offer
- Calendly users migrating to Cal.com encounter a familiar admin experience at the organization level — their org-level admin role grants full visibility and management over all teams, matching Calendly's Admin Center behavior
- No `Membership` data duplication: org admin access to child teams is derived at runtime through the service layer rather than materialized as redundant membership records, keeping the data model clean and avoiding cascading create/delete synchronization overhead
- The cascading permission pattern integrates naturally with PBAC: if an org-level admin has PBAC custom permissions scoped to the organization, those permissions can be evaluated against child team resources through the same cascading resolution path in `PermissionCheckService`
