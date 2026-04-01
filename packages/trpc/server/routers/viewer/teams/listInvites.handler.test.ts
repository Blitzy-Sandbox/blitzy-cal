import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Tests for Gap 3 (AG-004): listInvites handler excludes declined invitations.
 *
 * Verifies:
 * - Query includes `accepted: false` and `declinedAt: null` filters
 * - Declined invitations (with declinedAt set) are excluded from results
 */

const mockFindMany = vi.fn();

vi.mock("@calcom/prisma", () => ({
  prisma: {
    membership: {
      findMany: (...args: unknown[]) => mockFindMany(...args),
    },
  },
}));

import { listInvitesHandler } from "./listInvites.handler";

const mockCtx = {
  user: {
    id: 42,
  },
} as Parameters<typeof listInvitesHandler>[0]["ctx"];

describe("listInvitesHandler (AG-004 exclude declined)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should query with accepted: false AND declinedAt: null", async () => {
    mockFindMany.mockResolvedValue([]);

    await listInvitesHandler({ ctx: mockCtx });

    expect(mockFindMany).toHaveBeenCalledWith({
      where: {
        user: { id: 42 },
        accepted: false,
        declinedAt: null,
      },
    });
  });

  it("should return only pending (non-declined) invitations", async () => {
    const pendingInvitations = [
      { id: 1, teamId: 10, userId: 42, accepted: false, declinedAt: null },
      { id: 2, teamId: 20, userId: 42, accepted: false, declinedAt: null },
    ];
    mockFindMany.mockResolvedValue(pendingInvitations);

    const result = await listInvitesHandler({ ctx: mockCtx });

    expect(result).toEqual(pendingInvitations);
    expect(result).toHaveLength(2);
  });

  it("should return empty array when all invitations are declined", async () => {
    mockFindMany.mockResolvedValue([]);

    const result = await listInvitesHandler({ ctx: mockCtx });

    expect(result).toEqual([]);
    expect(result).toHaveLength(0);
  });
});
