# Admin and Teams Future Work

Ideas and enhancements deferred from the Sprint 7: Admin and Teams initial implementation.

## Enhancements

- SSO/SCIM provisioning enhancements — out of AG-001 through AG-004 scope. Cal.com has domain-based auto-accept for automatic user onboarding, but Calendly offers more documented SCIM 2.0 group provisioning with IdP attribute mapping and a 40-minute sync cycle. Enhancing Cal.com's SCIM endpoints with group-aware provisioning and richer IdP attribute mapping would close gap AT-004.
- Default "Group Admin" PBAC role template — AT-001 from the gap report. Cal.com's PBAC system can replicate Calendly's Group Admin role via custom role creation, but there is no pre-configured template available out of the box. Creating a default "Group Admin" role template with group-scoped permissions (member management, routing form creation, group reporting) would ease adoption for teams migrating from Calendly.
- Default "Team Manager" PBAC role template — AT-002 from the gap report. Similar to Group Admin, Calendly offers a dedicated Team Manager role for team oversight with limited admin access. Creating a pre-configured "Team Manager" PBAC role template with team-scoped scheduling oversight permissions would provide a familiar starting point for migrating organizations.
- Admin CSV/JSON export of organization member lists — AT-003 from the gap report. Calendly's Admin Center offers CSV export of active and pending member lists. Implementing an equivalent export endpoint in `apps/api/v2/src/modules/organizations/` with support for CSV and JSON formats, filtering by role and membership status, would match this convenience feature.
- PBAC migration guide for Calendly users — mapping Calendly's five fixed roles (Owner, Admin, Group Admin, Team Manager, User) to recommended Cal.com PBAC configurations. This documentation-focused enhancement would help enterprise customers transitioning from Calendly understand how to replicate and extend their existing governance model using Cal.com's more flexible permission system.
- Per-event-type role-based access control — extending PBAC to support event-type-level permission granularity beyond team-level scoping. This would allow organizations to define which roles can view, edit, or manage specific event types within a team, providing finer-grained governance for large teams with diverse scheduling needs.

## Technical Debt

- Consolidate team/organization membership queries — reduce duplication between `MembershipRepository` methods (`hasMembership`, `findTeamAdminsByTeamId`, `listAcceptedTeamMemberIds`) and `TeamRepository.findTeamMembersWithPermission` which perform overlapping membership lookups with slightly different projections and filters.
- Standardize DI token patterns across organizations/teams/membership — ensure consistent `bindModuleToClassOnToken` wiring across `packages/features/ee/organizations/di/`, `packages/features/ee/teams/`, and `packages/features/membership/` to follow a uniform symbol-based token registration convention and reduce onboarding friction for contributors.
- Unify invitation email templates — standardize email dispatch logic between the `inviteMemberUtils.ts` patterns (`sendSignupToOrganizationEmail`, `sendExistingUserTeamInviteEmails`, `sendTeamInviteEmail`) which currently have parallel but subtly different flows for organization-level versus team-level invitations, leading to maintenance overhead and inconsistent invite experiences.

## Nice to Have

- Real-time admin dashboard showing team member activity, booking distribution across round-robin hosts, and scheduling fairness metrics to help organization admins identify workload imbalances
- Bulk role assignment UI for organization admins managing large teams, enabling selection of multiple members and batch role or PBAC permission changes in a single operation
- Team hierarchy visualization in the admin settings showing the full organization → team → sub-team → member tree with role indicators, permission summaries, and managed event type assignments
- Role audit log tracking all permission changes, role assignments, membership lifecycle events (invitations sent, accepted, declined, revoked), and admin actions with timestamps and actor attribution for compliance reporting
