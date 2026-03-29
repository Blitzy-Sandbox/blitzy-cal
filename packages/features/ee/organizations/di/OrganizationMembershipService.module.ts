import { bindModuleToClassOnToken, createModule, type ModuleLoader } from "@calcom/features/di/di";
import { OrganizationMembershipService } from "@calcom/features/ee/organizations/lib/service/OrganizationMembershipService";

import { moduleLoader as organizationRepositoryModuleLoader } from "./OrganizationRepository.module";
import { ORGANIZATION_DI_TOKENS } from "./tokens";

// AG-001: Create a null module loader for the optional permissionService dependency.
// OrganizationPermissionService requires runtime user context and cannot be statically
// DI'd. When resolved, this provides undefined — the OrganizationMembershipService
// gracefully handles the absence by guarding with `if (!permissionService)`.
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
