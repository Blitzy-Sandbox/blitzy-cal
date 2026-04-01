import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Tests for Gap 3 (AG-004): Decline team invitation via acceptOrLeave handler.
 *
 * Verifies:
 * - Pending invitations use rejectTeamInvitation (sets declinedAt) instead of delete
 * - Already-accepted memberships still use leaveTeamMembership (deletes record)
 * - Accept flow remains unchanged
 */

// --- Mocks ---
const mockAcceptTeamMembership = vi.fn();
const mockLeaveTeamMembership = vi.fn();
const mockRejectTeamInvitation = vi.fn();
const mockFindUnique = vi.fn();

vi.mock("@calcom/features/ee/teams/services/teamService", () => ({
  TeamService: {
    acceptTeamMembership: (...args: unknown[]) => mockAcceptTeamMembership(...args),
    leaveTeamMembership: (...args: unknown[]) => mockLeaveTeamMembership(...args),
  },
}));

vi.mock("@calcom/features/ee/teams/lib/inviteMemberUtils", () => ({
  rejectTeamInvitation: (...args: unknown[]) => mockRejectTeamInvitation(...args),
}));

vi.mock("@calcom/prisma", () => ({
  prisma: {
    membership: {
      findUnique: (...args: unknown[]) => mockFindUnique(...args),
    },
  },
}));

// Import after mocks are set up
import { acceptOrLeaveHandler } from "./acceptOrLeave.handler";

const mockCtx = {
  user: {
    id: 42,
    email: "test@example.com",
    username: "testuser",
  },
} as Parameters<typeof acceptOrLeaveHandler>[0]["ctx"];

describe("acceptOrLeaveHandler (AG-004 decline invitation)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should call acceptTeamMembership when accept is true", async () => {
    await acceptOrLeaveHandler({
      ctx: mockCtx,
      input: { teamId: 10, accept: true },
    });

    expect(mockAcceptTeamMembership).toHaveBeenCalledWith({
      userId: 42,
      teamId: 10,
      userEmail: "test@example.com",
      username: "testuser",
    });
    expect(mockRejectTeamInvitation).not.toHaveBeenCalled();
    expect(mockLeaveTeamMembership).not.toHaveBeenCalled();
  });

  it("should call rejectTeamInvitation for pending (not yet accepted) memberships", async () => {
    mockFindUnique.mockResolvedValue({ accepted: false });

    await acceptOrLeaveHandler({
      ctx: mockCtx,
      input: { teamId: 10, accept: false },
    });

    expect(mockFindUnique).toHaveBeenCalledWith({
      where: { userId_teamId: { userId: 42, teamId: 10 } },
      select: { accepted: true },
    });
    expect(mockRejectTeamInvitation).toHaveBeenCalledWith({
      userId: 42,
      teamId: 10,
    });
    expect(mockLeaveTeamMembership).not.toHaveBeenCalled();
  });

  it("should call leaveTeamMembership for already-accepted memberships", async () => {
    mockFindUnique.mockResolvedValue({ accepted: true });

    await acceptOrLeaveHandler({
      ctx: mockCtx,
      input: { teamId: 10, accept: false },
    });

    expect(mockLeaveTeamMembership).toHaveBeenCalledWith({
      userId: 42,
      teamId: 10,
    });
    expect(mockRejectTeamInvitation).not.toHaveBeenCalled();
  });

  it("should call leaveTeamMembership when membership is not found (null)", async () => {
    mockFindUnique.mockResolvedValue(null);

    await acceptOrLeaveHandler({
      ctx: mockCtx,
      input: { teamId: 10, accept: false },
    });

    // membership is null, so the `if (membership && !membership.accepted)` is false
    // falls through to leaveTeamMembership
    expect(mockLeaveTeamMembership).toHaveBeenCalledWith({
      userId: 42,
      teamId: 10,
    });
    expect(mockRejectTeamInvitation).not.toHaveBeenCalled();
  });
});
