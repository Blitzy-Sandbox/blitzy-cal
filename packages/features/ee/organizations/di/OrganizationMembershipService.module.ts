import { bindModuleToClassOnToken, createModule, type ModuleLoader } from "@calcom/features/di/di";
import { OrganizationMembershipService } from "@calcom/features/ee/organizations/lib/service/OrganizationMembershipService";

import { moduleLoader as organizationRepositoryModuleLoader } from "./OrganizationRepository.module";
import { ORGANIZATION_DI_TOKENS } from "./tokens";

/**
 * Null-loader pattern for optional DI dependencies (AG-001).
 *
 * OrganizationPermissionService requires runtime user context (the actor's MembershipRole)
 * that is only available during HTTP request handling — it cannot be resolved at static DI
 * wiring time. To satisfy the DI container's requirement that every dependency token resolves
 * to a value, we bind a NullObject (undefined) to the permissionService token. The
 * OrganizationMembershipService handles this gracefully: when permissionService is absent,
 * role transition and role assignment operations throw HttpError(500) to signal that the
 * caller must provide a fully-wired instance with runtime dependencies.
 *
 * This pattern is consistent with Cal.com's DI conventions (see OrganizationRepository.container.ts
 * for similar optional dependency handling) and avoids introducing a NullObject class that would
 * need to implement the full OrganizationPermissionService interface with no-op methods.
 *
 * @see specs/admin-teams/decisions.md — ADR-004 for AG-001 scope file strategy
 * @see OrganizationMembershipService.transitionRole — guards with `if (!permissionService)`
 */
const nullPermissionServiceToken = Symbol("NullPermissionService");
const nullPermissionServiceModule = createModule();
nullPermissionServiceModule.bind(nullPermissionServiceToken).toValue(undefined);
const nullPermissionServiceLoader: ModuleLoader = {
  token: nullPermissionServiceToken,
  loadModule: (container) => {
    container.load(Symbol("NullPermissionServiceModule"), nullPermissionServiceModule);
  },
};

const thisModule = createModule();
const token = ORGANIZATION_DI_TOKENS.ORGANIZATION_MEMBERSHIP_SERVICE;
const moduleToken = ORGANIZATION_DI_TOKENS.ORGANIZATION_MEMBERSHIP_SERVICE_MODULE;

const loadModule = bindModuleToClassOnToken({
  module: thisModule,
  moduleToken,
  token,
  classs: OrganizationMembershipService,
  depsMap: {
    organizationRepository: organizationRepositoryModuleLoader,
    // AG-001: Provide the concrete OrganizationRepository for role transition operations
    fullOrganizationRepository: organizationRepositoryModuleLoader,
    // AG-001: Optional — resolved as undefined; injected at runtime when user context is available
    permissionService: nullPermissionServiceLoader,
  },
});

export const moduleLoader = {
  token,
  loadModule,
};

export type { OrganizationMembershipService };
