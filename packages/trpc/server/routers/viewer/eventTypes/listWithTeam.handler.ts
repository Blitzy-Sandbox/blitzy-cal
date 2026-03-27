import db from "@calcom/prisma";
import { Prisma } from "@calcom/prisma/client";
import type { TrpcSessionUser } from "../../../types";

type ListWithTeamOptions = {
  ctx: {
    user: Pick<NonNullable<TrpcSessionUser>, "id">;
  };
};

/**
 * Normalizes raw SQL PostgreSQL enum values to Prisma ORM enum names.
 *
 * Raw SQL queries return the database-level `@map` values (e.g., `"roundRobin"`),
 * while Prisma ORM queries return TypeScript enum names (e.g., `"ROUND_ROBIN"`).
 * This mapping ensures `listWithTeam` output is consistent with the ORM-based
 * `list` handler, so consumers receive uniform `schedulingType` values regardless
 * of which endpoint they call.
 */
const SCHEDULING_TYPE_DB_TO_ENUM: Record<string, string> = {
  roundRobin: "ROUND_ROBIN",
  collective: "COLLECTIVE",
  managed: "MANAGED",
};

/**
 * Handler for the `viewer.eventTypes.listWithTeam` tRPC query.
 *
 * Lists event types owned by the current user AND event types from teams the
 * user is a member of via a raw SQL UNION query.
 *
 * The result includes `schedulingType` for paradigm-aware consumers, normalized
 * to Prisma enum names for consistency with the ORM-based `list` handler:
 *  - `null` — One-on-one (1:1) event type (default / implicit)
 *  - `"ROUND_ROBIN"` — Round-robin distributed across hosts
 *  - `"COLLECTIVE"` — Collective scheduling requiring all hosts available
 *  - `"MANAGED"` — Managed event type administered by a team admin
 *
 * Adding `schedulingType` is an ADDITIVE change that maintains full backward
 * compatibility with all existing API consumers.
 */
export const listWithTeamHandler = async ({ ctx }: ListWithTeamOptions) => {
  const userId = ctx.user.id;
  const query = Prisma.sql`SELECT "public"."EventType"."id", "public"."EventType"."teamId", "public"."EventType"."title", "public"."EventType"."slug", "public"."EventType"."length", "j1"."name" as "teamName", "u"."username" as "username", "public"."EventType"."schedulingType"
    FROM "public"."EventType"
    LEFT JOIN "public"."Team" AS "j1" ON ("j1"."id") = ("public"."EventType"."teamId")
    LEFT JOIN "public"."users" AS "u" ON ("u"."id") = ("public"."EventType"."userId")
    WHERE "public"."EventType"."userId" = ${userId}
    UNION
    SELECT "public"."EventType"."id", "public"."EventType"."teamId", "public"."EventType"."title", "public"."EventType"."slug", "public"."EventType"."length", "j1"."name" as "teamName", "u"."username" as "username", "public"."EventType"."schedulingType"
    FROM "public"."EventType"
    INNER JOIN "public"."Team" AS "j1" ON ("j1"."id") = ("public"."EventType"."teamId")
    INNER JOIN "public"."Membership" AS "t2" ON "t2"."teamId" = "j1"."id"
    LEFT JOIN "public"."users" AS "u" ON ("u"."id") = ("public"."EventType"."userId")
    WHERE "t2"."userId" = ${userId} AND "t2"."accepted" = true`;

  const result =
    await db.$queryRaw<
      {
        id: number;
        teamId: number | null;
        title: string;
        slug: string;
        length: number;
        teamName: string | null;
        username: string | null;
        schedulingType: string | null;
      }[]
    >(query);

  return result.map((row) => ({
    id: row.id,
    team: row.teamId ? { id: row.teamId, name: row.teamName || "" } : null,
    title: row.title,
    slug: row.slug,
    length: row.length,
    username: row.teamId ? null : row.username,
    schedulingType: row.schedulingType ? (SCHEDULING_TYPE_DB_TO_ENUM[row.schedulingType] ?? row.schedulingType) : null,
  }));
};
