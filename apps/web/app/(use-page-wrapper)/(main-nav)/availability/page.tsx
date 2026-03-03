/**
 * Server component for the `/availability` route.
 *
 * Responsibilities:
 * 1. Enforces authentication — redirects unauthenticated users to `/auth/login`
 *    before any availability data is fetched.
 * 2. Fetches cached availability schedules via the TRPC `viewer.availability.list`
 *    procedure, wrapped in Next.js `unstable_cache` with a 1-hour TTL and cache
 *    key `"viewer.availability.list"`.
 * 3. Checks organization privacy status via `getOrganizationRepository().checkIfPrivate`
 *    (DI-resolved) to determine public vs. private org access.
 * 4. Evaluates team-level permissions via `PermissionCheckService.getTeamIdsWithPermission`
 *    with PBAC granular permission `"availability.read"` and membership role fallback.
 * 5. Renders either the team availability slider (`AvailabilitySliderTable`) when
 *    `?type=team` is present and the user has permission, or the personal
 *    availability list (`AvailabilityList`) by default.
 *
 * Cache invalidation is handled by `revalidateAvailabilityList()` in the co-located
 * `actions.ts` (calls `revalidatePath("/availability")`) and TRPC React Query
 * invalidation via `utils.viewer.availability.list.invalidate()` in client components.
 */
import { createRouterCaller, getTRPCContext } from "app/_trpc/context";
import type { PageProps, ReadonlyHeaders, ReadonlyRequestCookies } from "app/_types";
import { _generateMetadata, getTranslate } from "app/_utils";
import { unstable_cache } from "next/cache";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import { getServerSession } from "@calcom/features/auth/lib/getServerSession";
import { getOrganizationRepository } from "@calcom/features/ee/organizations/di/OrganizationRepository.container";
import { PermissionCheckService } from "@calcom/features/pbac/services/permission-check.service";
import { getScheduleListItemData } from "@calcom/lib/schedules/transformers/getScheduleListItemData";
import { MembershipRole } from "@calcom/prisma/enums";
import { availabilityRouter } from "@calcom/trpc/server/routers/viewer/availability/_router";
import { AvailabilitySliderTable } from "@calcom/web/modules/timezone-buddy/components/AvailabilitySliderTable";

import { buildLegacyRequest } from "@lib/buildLegacyCtx";

import { AvailabilityList, AvailabilityCTA } from "~/availability/availability-view";

import { ShellMainAppDir } from "../ShellMainAppDir";

export const generateMetadata = async () => {
  return await _generateMetadata(
    (t) => t("availability"),
    (t) => t("configure_availability"),
    undefined,
    undefined,
    "/availability"
  );
};

/**
 * Wraps the TRPC `viewer.availability.list` procedure with Next.js `unstable_cache`.
 *
 * - Cache key: `"viewer.availability.list"` — aligns with `revalidateAvailabilityList()`
 *   in `actions.ts` which calls `revalidatePath("/availability")` for server-side invalidation.
 * - TTL: 3600 seconds (1 hour). Date objects in the response become ISO strings through
 *   JSON cache serialization; downstream `getScheduleListItemData` reconstructs them.
 */
const getCachedAvailabilities = unstable_cache(
  async (headers: ReadonlyHeaders, cookies: ReadonlyRequestCookies) => {
    const availabilityCaller = await createRouterCaller(
      availabilityRouter,
      await getTRPCContext(headers, cookies)
    );
    return await availabilityCaller.list();
  },
  ["viewer.availability.list"],
  { revalidate: 3600 } // Cache for 1 hour
);

const Page = async ({ searchParams: _searchParams }: PageProps) => {
  const searchParams = await _searchParams;
  const t = await getTranslate();
  const _headers = await headers();
  const _cookies = await cookies();
  const session = await getServerSession({ req: buildLegacyRequest(_headers, _cookies) });
  if (!session?.user?.id) {
    return redirect("/auth/login");
  }

  const cachedAvailabilities = await getCachedAvailabilities(_headers, _cookies);

  // `unstable_cache` serializes the TRPC response to JSON, converting Date objects
  // (startTime, endTime, date) into ISO strings. `getScheduleListItemData` reconstructs
  // proper Date instances from these serialized strings so that downstream
  // `ScheduleListItem` components can rely on Date methods for locale-aware formatting.
  const availabilities = {
    ...cachedAvailabilities,
    schedules: cachedAvailabilities.schedules.map((schedule) => getScheduleListItemData(schedule)),
  };

  const organizationId = session?.user?.profile?.organizationId ?? session?.user.org?.id;
  const organizationRepository = getOrganizationRepository();
  const isOrgPrivate = organizationId
    ? await organizationRepository.checkIfPrivate({
        orgId: organizationId,
      })
    : false;

  // Two-tier permission check for team availability access:
  // 1. PBAC granular permission: checks `availability.read` for the user's teams.
  // 2. Membership role fallback: OWNER and ADMIN roles grant implicit access.
  // `canViewTeamAvailability` is true if the user has at least one permissioned team
  // OR the organization is not private (open-access orgs grant team visibility).
  const permissionService = new PermissionCheckService();
  const teamIdsWithPermission = await permissionService.getTeamIdsWithPermission({
    userId: session.user.id,
    permission: "availability.read",
    fallbackRoles: [MembershipRole.OWNER, MembershipRole.ADMIN],
  });
  const canViewTeamAvailability = teamIdsWithPermission.length > 0 || !isOrgPrivate;

  return (
    <ShellMainAppDir
      heading={t("availability")}
      subtitle={t("configure_availability")}
      CTA={<AvailabilityCTA canViewTeamAvailability={canViewTeamAvailability} />}>
      {searchParams?.type === "team" && canViewTeamAvailability ? (
        <AvailabilitySliderTable isOrg={!!organizationId} />
      ) : (
        <AvailabilityList availabilities={availabilities ?? { schedules: [] }} />
      )}
    </ShellMainAppDir>
  );
};

export default Page;
