# Admin and Teams Design

## Overview

Sprint 7: Admin and Teams (F-009) achieves behavioral parity between Cal.com's hierarchical organization model with Permission-Based Access Control (PBAC) and Calendly's admin/owner/user role structure across organization governance, team event routing, managed event types, and member invitation workflows. This sprint verifies and enhances the existing admin governance infrastructure across four epics (AG-001 through AG-004), aligning Cal.com's PBAC model with Calendly's behavioral expectations while preserving Cal.com's significant architectural advantages including hierarchical organizations, custom roles, and programmatic API management.

## Problem Statement

Cal.com's admin governance model **significantly exceeds** Calendly's capabilities across every dimension. Cal.com implements a hierarchical organization structure with PBAC, sub-teams, custom roles, and programmatic organization management — none of which Calendly supports. Calendly uses a simpler flat organization with five fixed roles and no sub-organization capability. This is documented in `docs/gap-report/admin-teams.mdx`.

However, a behavioral alignment tension exists: Calendly has **5 fixed roles** (Owner, Admin, Group Admin, Team Manager, User) with implicit permission inheritance, while Cal.com has **3 base roles** (OWNER, ADMIN, MEMBER) augmented by the PBAC custom role system in `packages/features/pbac/`. While Cal.com's model is architecturally superior — offering resource.action granularity, wildcard support, custom role creation, and permission diffing — behavioral alignment is needed to ensure that users migrating from Calendly find familiar admin experiences for common governance tasks such as cascading org-admin access, team event routing, managed event push, and member invitation workflows.

All gaps identified in the admin governance domain are **Low severity** — Cal.com already meets or exceeds Calendly's capabilities in every category. The work in this sprint focuses on behavioral verification and targeted enhancements rather than net-new feature construction.

This sprint encompasses four epics:

| Epic ID | Name | Priority | Complexity |
|---------|------|----------|------------|
| AG-001 | Admin role model parity | Medium | M |
| AG-002 | Team event routing behavioral parity | Medium | M |
| AG-003 | Managed event type push behavior parity | Medium | L |
| AG-004 | Member invitation workflow parity | Medium | M |

**Primary source references:**

- `docs/gap-report/admin-teams.mdx` — Comprehensive gap analysis with feature comparison matrix
- `packages/features/ee/organizations/` — Organization management: repositories, services, DI, context, types
- `packages/features/ee/teams/` — Team management: services, repositories, components, invite utilities
- `packages/features/membership/` — Membership checking: services, repositories
- `packages/features/pbac/` — PBAC permission system: services, domain models, infrastructure

## User Stories

- As an **organization admin**, I want my admin permissions to provide the same level of organizational control as a Calendly admin so that I can manage all teams, members, and settings across my organization without needing to be separately added to each team.

- As a **team member**, I want round-robin event distribution to fairly distribute bookings across my team based on configured weights or equal distribution, matching Calendly's round-robin behavior, so that my team's booking load is balanced.

- As a **team member**, I want collective event types to require all designated team members to be available before a slot is offered to invitees, matching Calendly's collective event behavior, so that multi-host meetings are only scheduled when everyone can attend.

- As an **organization admin**, I want to create managed event type templates that are automatically pushed to team members with locked settings, matching Calendly's managed events behavior, so that I can ensure a consistent scheduling experience across my organization.

- As an **organization admin**, I want to invite new members via email with role assignment and have the invitation lifecycle (send, accept, reject, expire) match Calendly's invitation workflow so that onboarding new team members is familiar and predictable.

## Technical Design

### Database Changes

All schema changes follow zero-downtime-safe patterns defined in `docs/migration/zero-downtime-strategy.mdx`. No column renames, type changes, NOT NULL without defaults, or any other anti-patterns are used.

#### 1. MembershipRole Enum — Preserved Unchanged

The existing `MembershipRole` enum with values `MEMBER`, `ADMIN`, and `OWNER` is **NOT** being modified. These three base roles remain unchanged. See ADR-002 in `specs/admin-teams/decisions.md` for the rationale: Cal.com's PBAC system already provides unlimited fine-grained custom roles beyond these three base roles, making enum extension unnecessary and potentially breaking.

#### 2. Potential Additive-Only Changes

If any new fields are needed during implementation, they follow Pattern 2 (nullable column addition):

- **Membership model** — Any new fields MUST be nullable (`Boolean?`, `String?`, `DateTime?`) with null treated as the default/false behavior. No existing columns are modified, removed, or renamed.
- **Team model** — Any new fields MUST be nullable following the same pattern. No existing columns are modified, removed, or renamed.

Example migration SQL (if needed):

```sql
-- Pattern 2: Nullable column addition — safe for zero-downtime deployment
ALTER TABLE "Membership" ADD COLUMN "newField" TEXT;
```

#### 3. Data Preservation Guarantee

All existing records in the following tables remain intact and unmodified:

- **`Membership`** — All existing membership records (accepted, pending, all roles) are preserved. No membership rows are deleted, modified, or re-created by Sprint 7 changes.
- **`Team`** — All team records including organization teams (`isOrganization: true`) and regular teams are preserved. Team metadata, billing, and branding configurations remain intact.
- **`User`** — All user records are preserved. No user data is modified.
- **`OrganizationSettings`** — All organization configuration records remain intact.
- **Verification**: Row count comparison before and after any migration; membership acceptance status spot-check across a sample of records.

### API Changes

#### AG-001: Admin Role Model Parity

**File**: `packages/features/ee/organizations/lib/` — Enhance permission service alignment

The `OrganizationPermissionService` provides methods including `hasPermissionToCreateForEmail`, `hasPermissionToMigrateTeams`, and `validatePermissions`. These must be verified and enhanced to ensure:

- Org-level `ADMIN` and `OWNER` memberships provide **cascading management access** to all child teams within the organization. When an org admin performs a team-level operation (member management, event type configuration, settings changes), the permission check must recognize the org-admin status without requiring a separate team-level membership.
- The `PermissionCheckService` in `packages/features/pbac/services/` correctly evaluates org-admin permissions for team-level operations using the PBAC resource.action model (e.g., `team.listMembers`, `eventType.create`).
- Permission validation gracefully handles the hierarchy: Organization OWNER → Organization ADMIN → Team ADMIN → Team MEMBER, with each level inheriting appropriate access.

**File**: `packages/features/ee/organizations/repositories/OrganizationRepository.ts` — Verify role model support

The `OrganizationRepository` (constructor-injected `PrismaClient`) provides organization CRUD with methods like `createWithExistingUserAsOwner`, `createWithNonExistentOwner`, `findById`, `findBySlug`, and domain management utilities. Verify that all organization management operations correctly enforce the aligned admin role model — specifically that `MembershipRole.OWNER` creation during `createWithExistingUserAsOwner` and `createWithNonExistentOwner` produces correct cascading permissions.

**File**: `packages/features/membership/services/membershipService.ts` — Enhance cascading admin check

The `MembershipService.checkMembership` method returns a `MembershipCheckResult` with `isMember`, `isAdmin`, `isOwner`, and `role` fields. Currently it queries a single team's membership via `MembershipRepository.findUniqueByUserIdAndTeamId`. For AG-001 parity, enhance this to support **org-level admin cascading**: when checking team membership, if the user has an `ADMIN` or `OWNER` role at the parent organization level, the result should correctly reflect that admin/owner status for team-level operations. This aligns with Calendly's behavior where admins have organization-wide management scope.

#### AG-002: Team Event Routing Behavioral Parity

**File**: `packages/features/ee/teams/services/teamService.ts` — Verify team event routing

The `TeamService` class manages team lifecycle including creation, deletion (with billing cancellation, workflow reminder cleanup, and managed event cascading via `TeamRepository.deleteById`), member management (`removeMembers`, `removeMember`, `leaveTeamMembership`), invitation (`createInvite`, `inviteMemberByToken`, `acceptTeamMembership`, `acceptInvitationByToken`), and publishing.

For AG-002, verify and enhance team event routing to ensure:

- **Round-robin** (`SchedulingType.ROUND_ROBIN`) distributes bookings matching Calendly's even-distribution and priority-based patterns. The existing round-robin implementation handles member rotation; verify it produces fair distribution when members have equal or weighted priority.
- **Collective** (`SchedulingType.COLLECTIVE`) scheduling requires **all designated members** to be available before a slot is offered to invitees. Verify this matches Calendly's collective event behavior where multi-host meetings are only offered when every required host has availability.

**File**: `packages/features/ee/teams/repositories/TeamRepository.ts` — Extend routing queries

The `TeamRepository` (constructor-injected `PrismaClient`) provides team CRUD, member queries (`findTeamWithMembers`, `findTeamsByUserId`, `findOwnedTeamsByUserId`), organization awareness (`findAllByParentId`, `findOrganizationSettingsBySlug`, `findTeamMembersWithPermission`), and deletion with managed event cascading. For routing parity:

- Verify `findTeamMembersWithPermission` is optimized for routing lookups — it must efficiently retrieve team members with their scheduling preferences.
- Verify team member availability aggregation supports collective scheduling where **all** designated members must have open slots.

**File**: `packages/features/ee/teams/lib/queries.ts` — Verify weight-based distribution

Verify team member fetchers (`updateNewTeamMemberEventTypes` and related queries) support round-robin weight distribution configuration. Ensure member ordering and priority values are correctly applied during booking distribution.

#### AG-003: Managed Event Type Push Behavior Parity

**File**: `packages/features/ee/teams/components/TeamEventTypeForm.tsx` — Verify managed event UI

The `TeamEventTypeForm` component provides a React form with `SchedulingType` radio selection (Collective, Round Robin, Managed). The `MANAGED` option is permission-gated behind `canCreateEventType`. For AG-003:

- Verify that `SchedulingType.MANAGED` admin-templated events are correctly created through this form and pushed to team members.
- Ensure admin lock settings on managed events match Calendly's managed event lock behavior — when an admin creates a managed event, the locked settings should be enforced on all team member copies.
- Verify the permission gating: only users with `canCreateEventType` permission can see and select the Managed scheduling type option.

**File**: `packages/features/eventtypes/` — Verify managed event push patterns

Verify the event type repository supports managed event push patterns:

- When an admin creates or modifies a managed event template, the changes cascade to all team member copies.
- When a managed event template is updated, all team members receive the updated configuration on their next load.
- Members who have been removed from the team do not receive pushed updates.
- The cascade correctly handles the `TeamRepository.deleteById` transaction which deletes all managed event types (`schedulingType: "MANAGED"`) before removing memberships and the team itself.

#### AG-004: Member Invitation Workflow Parity

**File**: `packages/features/ee/teams/lib/inviteMemberUtils.ts` — Extend invitation workflow

The `inviteMemberUtils` module provides the complete invitation pipeline:

- **Token generation**: `createVerificationToken` uses `randomBytes(32).toString("hex")` with a 7-day expiration (`Date.now() + 7 * 24 * 60 * 60 * 1000`), matching Calendly's invitation lifecycle.
- **Email dispatch**: `sendSignupToOrganizationEmail` (for new users) and `sendExistingUserTeamInviteEmails` (for existing users) produce invitations using `sendTeamInviteEmail` from `@calcom/emails/organization-email-service`.
- **Batch operations**: `sendEmails` uses `Promise.allSettled` for resilient batch email delivery. Verify this supports up to 100 invitations matching Calendly's batch limit.
- **Membership creation**: `createMemberships` handles team and org membership creation with seat accounting via `SeatChangeTrackingService`, applying `checkAdminOrOwner` to correctly propagate org-level roles to team memberships.

For AG-004, verify and enhance:

- The full invitation lifecycle (send → accept/reject → expire) matches Calendly's workflow expectations.
- `sendExistingUserTeamInviteEmails` correctly handles the three user states: (1) existing Cal.com member, (2) existing user who hasn't completed onboarding, and (3) auto-join users.
- The verification token identifier uses the invitee's email, enabling correct token-to-user matching during acceptance.

**File**: `packages/features/membership/services/membershipService.ts` — Invitation lifecycle states

Enhance `MembershipService.checkMembership` for invitation lifecycle handling:

- Pending invitations (`accepted: false`) are correctly identified — the current implementation returns `isMember: false` for unaccepted memberships, which is the correct behavior.
- Verify that invitation acceptance (setting `accepted: true` via `TeamService.acceptTeamMembership`) correctly transitions the `checkMembership` result from `isMember: false` to `isMember: true`.

**File**: `packages/features/membership/repositories/MembershipRepository.ts` — Extend invitation queries

The `MembershipRepository` provides comprehensive membership data access including `hasMembership` (accepted-only check), `listAcceptedTeamMemberIds`, `findUniqueByUserIdAndTeamId`, `findTeamAdminsByTeamId`, and various organization-aware queries. For AG-004:

- Verify pending invitation listing via existing query capabilities (filter by `accepted: false`).
- Verify invitation expiration checking is handled at the `VerificationToken` level (7-day expiry in `inviteMemberUtils.ts`) rather than on the `Membership` record itself.
- Verify batch invitation status updates are efficiently handled through `MembershipRepository.createMany`.

### UI Changes

Sprint 7 has minimal UI surface, similar to Sprint 3 Calendar Integrations. No visual redesign is in scope — only targeted verification and potential enhancements.

#### 1. Team Event Type Form

**Path**: `packages/features/ee/teams/components/TeamEventTypeForm.tsx`

The existing form supports Collective, Round Robin, and Managed (permission-gated) scheduling types. Potential enhancements:

- Verify managed event type push configuration accurately represents which settings are locked vs. customizable.
- Verify the `canCreateEventType` permission gate correctly reflects org-admin status via the AG-001 cascading permission model.

#### 2. Organization Settings

Organization admin role management UI should reflect the aligned permission model from AG-001. The existing organization settings pages at `apps/web/` expose role assignment and member management — verify these correctly enforce org-admin cascading permissions.

#### 3. No Changes Required

The following UI components require no modifications:

- **Member invitation emails** — The existing email templates in `packages/emails/` (`sendTeamInviteEmail`) produce correct invitation content.
- **Team creation flow** — The existing team creation workflow correctly handles organization context and sub-team creation.
- **Basic membership management** — The existing membership list, role assignment, and removal UI is functionally complete.
- **PBAC settings** — The PBAC permission UI (`packages/features/pbac/client/`) is not modified in this sprint.

## Edge Cases

### 1. Concurrent Role Changes

If an admin's role is downgraded while they are performing an admin operation, the permission check should fail gracefully without data corruption. The `PermissionCheckService.checkPermission` evaluates permissions at request time; concurrent role changes should cause subsequent permission-gated operations to fail with an appropriate authorization error. The implementation should check membership status at operation start and verify at commit — leveraging Prisma's transaction isolation to prevent partial state changes.

### 2. Last-Owner Protection

The `RoleManagementFactory` returns either `PBACRoleManager` or `LegacyRoleManager` based on the `pbac` feature flag (referenced in `packages/features/pbac/services/`). Both managers implement last-owner demotion prevention. Verify this protection extends to all AG-001 role alignment changes — specifically that org-level owner demotion is prevented when only one owner exists at the organization level, independent of team-level ownership.

### 3. Round-Robin Fairness With Member Availability Changes

When team members change their availability during active round-robin distribution (e.g., marking themselves unavailable for a period), the routing should not skip or double-book. The `SchedulingType.ROUND_ROBIN` scheduling implementation must handle dynamic availability gracefully: if a member becomes unavailable, the round-robin should advance to the next eligible member without creating gaps in the distribution cycle or booking a member during their unavailable period.

### 4. Managed Event Template Update Cascading

When an admin updates a managed event template, the push to team members must handle four scenarios:

- **Active members with default copies**: Override with the updated template settings immediately.
- **Active members who customized locked fields**: The locked field values from the admin template must override any member customizations.
- **Members who are offline**: Apply the update on their next session load.
- **Members removed from the team**: Do not push updates to removed members. The `TeamRepository.deleteById` transaction deletes managed event types in its cascade, ensuring cleanup for deleted teams.

### 5. Invitation Expiration Race Condition

If a user accepts an invitation at the same moment it expires (the 7-day `VerificationToken.expires` timestamp), the behavior depends on the timing of the database query in `TeamService.acceptInvitationByToken`, which checks `expires: { gte: new Date() }`. In a race condition, favor the user: if the token was valid when the request was initiated, the acceptance should succeed. If the token has definitively expired before the query executes, the user should receive a clear error message ("Invite not found") with guidance to request a new invitation.

### 6. Multi-Organization Membership Conflicts

A user belonging to multiple organizations (a Cal.com advantage over Calendly's single-org constraint) may have different roles in each organization. The `MembershipService.checkMembership` method receives a specific `teamId` parameter and must correctly scope role checks to that specific org/team. Permissions from one organization must never leak to another. This is enforced by the `MembershipRepository.findUniqueByUserIdAndTeamId` query which filters by both `userId` and `teamId`.

### 7. Team Deletion Cascade for Managed Events

`TeamRepository.deleteById` uses a Prisma `$transaction` that executes in order: (1) delete all managed event types (`schedulingType: "MANAGED"`), (2) delete all memberships, (3) delete the team. This cascade must correctly handle:

- Managed event copies held by team members — these are the team-level managed events, not user-level copies. User-level copies of managed events are separate event type records that should be orphaned (not deleted) when the managing team is removed.
- Seat accounting — `TeamService.delete` calls `teamBillingService.cancel()` before the database cascade, ensuring billing is updated before data is removed.
- Workflow reminder cleanup — `WorkflowService.deleteWorkflowRemindersOfRemovedTeam` is invoked before the cascade, with error logging but not abort on failure.

## Out of Scope

The following items are explicitly excluded from Sprint 7: Admin and Teams:

1. **SSO/SCIM provisioning enhancements** — `packages/features/ee/sso/` is not modified. SSO/SAML and SCIM provisioning are not in the AG-001 through AG-004 epic scope.

2. **Default "Group Admin" and "Team Manager" PBAC role templates** — Identified as AT-001 and AT-002 in the gap report. While Cal.com's PBAC supports creating custom roles with equivalent permissions, adding pre-configured named role templates is deferred to future work (see `specs/admin-teams/future-work.md`).

3. **Admin CSV/JSON export of organization member lists** — Identified as AT-003 in the gap report. A convenience feature available in Calendly's Admin Center but not a behavioral parity requirement. Deferred to future work.

4. **SCIM group provisioning documentation** — Identified as AT-004 in the gap report. Cal.com's domain-based auto-join partially compensates for Calendly's SCIM group provisioning. Enhanced documentation is deferred.

5. **PBAC migration guide for Calendly users** — A documentation asset mapping Calendly's five fixed roles to recommended Cal.com PBAC configurations. Deferred to future documentation work.

6. **Performance optimizations beyond parity requirements** — No refactoring of team routing algorithms, permission checking hot paths, or membership query optimization unless directly required for behavioral parity with Calendly.

7. **Changes to authentication, payment processing, or video conferencing modules** — These systems are out of scope for Sprint 7.

8. **Changes to `apps/web/` core application pages** — Only organization settings and team event type configuration pages are in scope. Booking flow, authentication, and payment pages are not modified.

9. **Webhook payload modifications** — Webhook event mapping and payload alignment are Sprint 4 (Webhooks and Events) scope. No modifications to `packages/features/webhooks/` or the `PayloadBuilderFactory`.

10. **Notification template changes** — Email and SMS notification parity is Sprint 8 (Notifications and Workflows) scope. No modifications to `packages/emails/` or `packages/sms/`.
