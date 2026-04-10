# Admin and Teams

## Overview

Sprint 7: Admin and Teams (F-009) ensures behavioral parity between Cal.com's hierarchical organization model with Permission-Based Access Control (PBAC) and Calendly's admin/owner/user role model. The sprint encompasses four core epics: AG-001 (admin role model parity ensuring OWNER/ADMIN/MEMBER roles match Calendly's admin behavioral expectations), AG-002 (team event routing behavioral parity for round-robin and collective scheduling), AG-003 (managed event type push behavior parity for admin-templated events via `SchedulingType.MANAGED`), and AG-004 (member invitation workflow parity for email-based invitations with token generation, batch operations, and seat accounting). The gap report finds that Cal.com's admin governance model significantly exceeds Calendly's capabilities, with hierarchical organizations, PBAC custom roles, and programmatic API management. This sprint focuses on behavioral alignment rather than feature addition, ensuring that Calendly users migrating to Cal.com encounter a familiar admin experience while retaining access to Cal.com's more advanced governance features.

## How to Use

### Step 1: Configure Admin Roles and Organization Permissions

Navigate to **Settings → Organizations** to manage organization-level roles and permissions. Organization OWNER and ADMIN memberships provide cascading management access to all child teams, matching Calendly's admin scope where admins have full organizational control. The PBAC permission system (`packages/features/pbac/`) allows creating custom roles with granular permissions (e.g., `team.listMembers`, `booking.read`, `eventType.create`) to replicate Calendly's Group Admin and Team Manager roles. The `RoleManagementFactory` pattern supports gradual PBAC adoption with a `LegacyRoleManager` fallback for organizations not yet ready for custom roles. Cal.com's existing three roles map directly to Calendly's core roles: Owner → OWNER, Admin → ADMIN, User → MEMBER.

*Screenshot placeholder: Navigate to Settings → Organizations to view role assignments and PBAC permission configuration. Capture this screenshot when the admin settings UI is available and save as `./screenshots/step-1.png`.*

### Step 2: Set Up Team Event Types and Member Invitations

Create team event types with round-robin (`SchedulingType.ROUND_ROBIN`) for even or priority-based booking distribution, or collective (`SchedulingType.COLLECTIVE`) for multi-host meetings requiring all members' availability. Use managed event types (`SchedulingType.MANAGED`) as an admin to push standardized event type templates to team members with locked settings that only admins can adjust. Invite new members through team settings with email-based invitations supporting batch operations (up to 100 at a time), 7-day token expiration, and automatic seat accounting. The invitation acceptance and rejection lifecycle aligns with Calendly's invitation workflow, including automatic resend behavior.

*Screenshot placeholder: Navigate to team settings to view team event type configuration, managed event push options, and member invitation workflow. Capture this screenshot when the feature is available and save as `./screenshots/step-2.png`.*

## Configuration Options

| Option | Description | Default |
|--------|-------------|---------|
| `MembershipRole` (on `Membership` model) | Role assignment for organization/team members. Three values: `OWNER` (full account ownership, billing, all admin capabilities), `ADMIN` (organizational control, user management, settings), `MEMBER` (individual scheduling, personal event types). Maps to Calendly's Owner/Admin/User. | `MEMBER` |
| `SchedulingType.ROUND_ROBIN` (on `EventType` model) | Team event routing that distributes bookings across team members based on configured weights or equal distribution. Matches Calendly's round-robin event behavior. | N/A (set per event type) |
| `SchedulingType.COLLECTIVE` (on `EventType` model) | Team event type requiring all designated team members to be available before a slot is offered. Matches Calendly's collective event behavior. | N/A (set per event type) |
| `SchedulingType.MANAGED` (on `EventType` model) | Admin-controlled event type templates pushed to team members with lockable settings. Gated behind `canCreateEventType` permission. Matches Calendly's managed events behavior. | N/A (set per event type) |
| `pbac` feature flag (in `Feature` model) | Enables Permission-Based Access Control for custom roles with fine-grained resource.action permissions. When disabled, falls back to `LegacyRoleManager` with standard OWNER/ADMIN/MEMBER role checks. | `false` (disabled by default; uses legacy role checks) |
| Invitation token expiration | Email-based team/organization invitations use `randomBytes(32)` tokens with 7-day expiration. Auto-resend behavior matches Calendly's invitation lifecycle. | 7 days |

## Common Use Cases

### Organization-Wide Admin Governance

An organization admin with OWNER or ADMIN role manages all teams, members, and settings across the organization without needing separate team-level memberships. Organization-level ADMIN and OWNER memberships cascade to child teams for management purposes, matching Calendly's admin scope where admins have visibility into all organizational resources. The PBAC system enables creating custom role templates (e.g., "Group Admin" or "Team Manager" equivalents) for organizations needing more granular control beyond the three base roles. This preserves Cal.com's multi-level hierarchy advantage while providing Calendly users a familiar admin experience.

### Team Scheduling with Round-Robin and Managed Events

Team admins set up round-robin event types to fairly distribute bookings across team members and collective event types for multi-host meetings requiring all participants' availability. Organization admins use managed event types (`SchedulingType.MANAGED`) to create standardized scheduling templates pushed to all team members with admin-locked settings that ensure a consistent customer experience. Members receive the managed event template automatically, and when the admin updates a managed template, changes cascade to all team members' copies. This matches Calendly's managed events workflow while leveraging Cal.com's more flexible team hierarchy.

## FAQ

### How does Cal.com's role model map to Calendly's roles?

Cal.com's three base roles map directly: Calendly Owner → Cal.com OWNER, Calendly Admin → Cal.com ADMIN, Calendly User → Cal.com MEMBER. Calendly's Group Admin and Team Manager roles do not have direct named equivalents but can be replicated using PBAC custom roles with appropriate permission sets (e.g., `team.listMembers`, `eventType.create`). The PBAC system, enabled via the `pbac` feature flag, provides unlimited custom role creation — exceeding Calendly's five fixed roles with fine-grained resource.action permissions and wildcard support.

### Are database migrations safe for production?

All schema changes follow zero-downtime migration patterns from `docs/migration/zero-downtime-strategy.mdx`, ensuring no downtime during deployment. The `MembershipRole` enum (MEMBER, ADMIN, OWNER) is not being modified — existing values remain unchanged per ADR-002 in `specs/admin-teams/decisions.md`. Behavioral alignment happens in the service layer (e.g., `membershipService.ts`, `OrganizationPermissionService`), not in the data layer. All existing records in Membership, Team, Organization, and User tables remain intact and unmodified.
