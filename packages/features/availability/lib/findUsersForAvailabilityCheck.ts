import { enrichUserWithDelegationCredentialsIncludeServiceAccountKey } from "@calcom/app-store/delegationCredential";
import { withSelectedCalendars } from "@calcom/lib/server/withSelectedCalendars";
import { availabilityUserSelect } from "@calcom/prisma";
import { prisma } from "@calcom/prisma";
import type { Prisma } from "@calcom/prisma/client";
import { credentialForCalendarServiceSelect } from "@calcom/prisma/selects/credential";

/**
 * Fetches a single user with availability-specific projections and enriches them
 * for downstream availability evaluation.
 *
 * This helper is the single source of truth for initiating user availability checks.
 * It wraps {@link prisma.user.findFirst} with the {@link availabilityUserSelect} projection,
 * which includes schedules with nested availability records, plus `selectedCalendars`
 * and `credentials` (via {@link credentialForCalendarServiceSelect}) relations required
 * by the availability engine.
 *
 * **Enrichment pipeline:**
 * 1. Prisma query — fetches user with availability projections, calendars, and credentials.
 * 2. Null guard — returns `null` immediately if no matching user is found.
 * 3. Calendar normalization — {@link withSelectedCalendars} normalizes the user's
 *    `selectedCalendars` relation into a consistent shape for calendar service consumers.
 * 4. Delegation credential injection — {@link enrichUserWithDelegationCredentialsIncludeServiceAccountKey}
 *    augments the user record with delegation credentials and service account keys
 *    needed for calendar integrations that operate on behalf of the user.
 *
 * **Security note:** This function does not enforce ownership or permission checks itself.
 * Callers are responsible for constructing an appropriately scoped `where` clause
 * (e.g., filtering by `userId` or applying `hasReadPermissionsForUserId` guards)
 * before invoking this helper.
 *
 * @param params - Destructured parameters object.
 * @param params.where - A {@link Prisma.UserWhereInput} filter provided by the caller
 *   to locate the target user.
 * @returns The enriched user record ready for availability evaluation, or `null`
 *   if no user matches the provided `where` filter.
 */
export async function findUsersForAvailabilityCheck({ where }: { where: Prisma.UserWhereInput }) {
  const user = await prisma.user.findFirst({
    where,
    select: {
      ...availabilityUserSelect,
      selectedCalendars: true,
      credentials: {
        select: credentialForCalendarServiceSelect,
      },
    },
  });

  if (!user) {
    return null;
  }

  // Enrichment pipeline: first normalize selected calendars into a consistent shape,
  // then inject delegation credentials and service account keys for calendar integrations.
  return await enrichUserWithDelegationCredentialsIncludeServiceAccountKey({
    user: withSelectedCalendars(user),
  });
}
