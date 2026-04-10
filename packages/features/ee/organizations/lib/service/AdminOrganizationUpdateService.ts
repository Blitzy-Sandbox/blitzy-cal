import { z } from "zod";

import { getOrgFullOrigin } from "@calcom/ee/organizations/lib/orgDomains";
import type { OrganizationPermissionService } from "@calcom/features/ee/organizations/lib/OrganizationPermissionService";
import type { OrganizationRepository } from "@calcom/features/ee/organizations/repositories/OrganizationRepository";
import { TeamRepository } from "@calcom/features/ee/teams/repositories/TeamRepository";
import { renameDomain } from "@calcom/lib/domainManager/organization";
import { getMetadataHelpers } from "@calcom/lib/getMetadataHelpers";
import { HttpError } from "@calcom/lib/http-error";
import type { Prisma, PrismaClient } from "@calcom/prisma/client";
import type { MembershipRole } from "@calcom/prisma/enums";
import { orgSettingsSchema, teamMetadataStrictSchema } from "@calcom/prisma/zod-utils";

export const ZAdminUpdate = z.object({
  id: z.number(),
  name: z.string().optional(),
  slug: z.string().nullish(),
  organizationSettings: orgSettingsSchema.unwrap().optional(),
});

export type TAdminUpdate = z.infer<typeof ZAdminUpdate>;

type AdminOrganizationUpdateServiceDeps = {
  prismaClient: PrismaClient;
  organizationRepository: OrganizationRepository;
  permissionService?: OrganizationPermissionService;
};

export class AdminOrganizationUpdateService {
  constructor(private readonly deps: AdminOrganizationUpdateServiceDeps) {}

  /**
   * Update organization settings with optional role-based permission enforcement.
   *
   * AG-001: The `actorRole` parameter is intentionally optional during the migration period
   * to maintain backward compatibility with existing callers that do not yet pass role
   * information. This opt-in design ensures zero breaking changes for existing admin API
   * routes while allowing incremental adoption of role-based permission checks. Once all
   * callers are updated to provide actorRole, it should be made required to enforce
   * security guarantees unconditionally.
   *
   * @param input - The organization update payload (id, optional name, slug, settings)
   * @param actorRole - The MembershipRole of the actor performing the update. When provided,
   *                    permission is checked via OrganizationPermissionService. When omitted,
   *                    the permission check is skipped for backward compatibility.
   */
  async updateOrganization(input: TAdminUpdate, actorRole?: MembershipRole) {
    if (actorRole !== undefined) {
      const permissionService = this.deps.permissionService;
      if (permissionService && !permissionService.canManageOrganizationSettings(actorRole)) {
        throw new HttpError({
          message: "You do not have permission to manage organization settings",
          statusCode: 403,
        });
      }
    }

    const { id, organizationSettings, ...restInput } = input;
    const { organizationRepository } = this.deps;

    const existingOrg = await organizationRepository.findByIdIncludeOrganizationSettings({ id });

    if (!existingOrg) {
      throw new HttpError({
        message: "Organization not found",
        statusCode: 404,
      });
    }

    const { mergeMetadata } = getMetadataHelpers(
      teamMetadataStrictSchema.unwrap(),
      existingOrg.metadata || {}
    );

    const data: Prisma.TeamUpdateArgs["data"] = restInput;
    const oldSlug = existingOrg.slug;
    const newSlug = restInput.slug;

    if (newSlug) {
      await throwIfSlugConflicts({
        id,
        slug: newSlug,
        teamRepository: new TeamRepository(this.deps.prismaClient),
      });
      const isSlugChanged = newSlug !== oldSlug;
      if (isSlugChanged) {
        // If slug is changed, we need to rename the domain first
        // If renaming fails, we don't want to update the new slug in DB
        await renameDomain(oldSlug, newSlug);
      }
      data.slug = newSlug;
      data.metadata = mergeMetadata({
        // If we save slug, we don't need the requestedSlug anymore
        requestedSlug: undefined,
      });
    }

    const updatedOrganization = await this.deps.prismaClient.$transaction(async (tx) => {
      const updatedOrganization = await tx.team.update({
        where: { id },
        data,
      });

      // Update all TempOrgRedirect records that point to the old org URL to use the new org URL
      if (newSlug && oldSlug && newSlug !== oldSlug) {
        const oldOrgUrlPrefix = getOrgFullOrigin(oldSlug);
        const newOrgUrlPrefix = getOrgFullOrigin(newSlug);

        const redirectsToUpdate = await tx.tempOrgRedirect.findMany({
          where: {
            toUrl: {
              startsWith: oldOrgUrlPrefix,
            },
          },
          select: {
            id: true,
            toUrl: true,
          },
        });

        for (const redirect of redirectsToUpdate) {
          const newToUrl = redirect.toUrl.replace(oldOrgUrlPrefix, newOrgUrlPrefix);
          await tx.tempOrgRedirect.update({
            where: {
              id: redirect.id,
            },
            data: {
              toUrl: newToUrl,
            },
          });
        }
      }

      if (organizationSettings || existingOrg.organizationSettings) {
        await tx.organizationSettings.update({
          where: {
            organizationId: updatedOrganization.id,
          },
          data: {
            isOrganizationConfigured:
              organizationSettings?.isOrganizationConfigured ||
              existingOrg.organizationSettings?.isOrganizationConfigured,
            isOrganizationVerified:
              organizationSettings?.isOrganizationVerified ||
              existingOrg.organizationSettings?.isOrganizationVerified,
            isAdminReviewed: organizationSettings?.isAdminReviewed,
            orgAutoAcceptEmail:
              organizationSettings?.orgAutoAcceptEmail ||
              existingOrg.organizationSettings?.orgAutoAcceptEmail,
            isAdminAPIEnabled: !!(
              organizationSettings?.isAdminAPIEnabled ?? existingOrg.organizationSettings?.isAdminAPIEnabled
            ),
          },
        });
      }
      return updatedOrganization;
    });

    return updatedOrganization;
  }
}

async function throwIfSlugConflicts({
  id,
  slug,
  teamRepository,
}: {
  id: number;
  slug: string;
  teamRepository: TeamRepository;
}) {
  const isSlugAvailable = await teamRepository.isSlugAvailableForUpdate({
    slug,
    teamId: id,
    parentId: null,
  });

  if (!isSlugAvailable) {
    throw new HttpError({
      message: "Organization or a Team with same slug already exists",
      statusCode: 400,
    });
  }
}
