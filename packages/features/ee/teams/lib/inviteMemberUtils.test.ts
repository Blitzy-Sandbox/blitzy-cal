import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Tests for AG-004 Gap 1: Decline link in new-user team invitation email.
 *
 * Verifies that `sendSignupToOrganizationEmail` passes a `declineLink` parameter
 * to `sendTeamInviteEmail`, so new users (who don't yet have an account) see a
 * Decline button in their initial invitation email — matching the existing-user
 * and resend paths.
 */

// Track sendTeamInviteEmail calls
let sendTeamInviteEmailCalls: unknown[] = [];

vi.mock("@calcom/emails/organization-email-service", () => ({
  sendTeamInviteEmail: vi.fn(async (args: unknown) => {
    sendTeamInviteEmailCalls.push(args);
  }),
}));

// Mock the verification token creation (uses Prisma)
const MOCK_TOKEN = "abc123def456";
vi.mock("@calcom/prisma", () => ({
  prisma: {
    verificationToken: {
      create: vi.fn(async () => ({
        identifier: "new-user@test.com",
        token: MOCK_TOKEN,
        expires: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      })),
    },
  },
}));

vi.mock("@calcom/features/onboarding/lib/onboarding-path.service", () => ({
  OnboardingPathService: {
    getGettingStartedPathWhenInvited: vi.fn(async () => "/getting-started"),
  },
}));

vi.mock("@calcom/lib/constants", () => ({
  WEBAPP_URL: "https://app.cal.com",
}));

vi.mock("@calcom/lib/logger", () => ({
  default: {
    getSubLogger: () => ({
      debug: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
    }),
  },
}));

vi.mock("@calcom/lib/safeStringify", () => ({
  safeStringify: vi.fn((obj: unknown) => JSON.stringify(obj)),
}));

// Import after mocks
const { sendSignupToOrganizationEmail } = await import("./inviteMemberUtils");

describe("AG-004 Gap 1: sendSignupToOrganizationEmail decline link", () => {
  beforeEach(() => {
    sendTeamInviteEmailCalls = [];
  });

  it("should include declineLink when sending invitation to a new user", async () => {
    const mockTranslation = ((key: string) => key) as any;

    await sendSignupToOrganizationEmail({
      usernameOrEmail: "new-user@test.com",
      team: { name: "Test Team", parent: null },
      translation: mockTranslation,
      inviterName: "Admin User",
      teamId: 42,
      isOrg: false,
    });

    // sendTeamInviteEmail should have been called exactly once
    expect(sendTeamInviteEmailCalls.length).toBe(1);

    const callArgs = sendTeamInviteEmailCalls[0] as Record<string, unknown>;

    // Verify declineLink is present and correctly constructed
    expect(callArgs.declineLink).toBeDefined();
    expect(callArgs.declineLink).toBe(
      `https://app.cal.com/api/auth/teams/decline?token=${MOCK_TOKEN}`
    );

    // Verify joinLink is also present (existing behavior preserved)
    expect(callArgs.joinLink).toBeDefined();
    expect(callArgs.joinLink).toContain(`token=${MOCK_TOKEN}`);
    expect(callArgs.joinLink).toContain("/signup");

    // Verify other params are correct
    expect(callArgs.isCalcomMember).toBe(false);
    expect(callArgs.isOrg).toBe(false);
    expect(callArgs.teamName).toBe("Test Team");
  });

  it("should include declineLink when sending organization invitation to a new user", async () => {
    const mockTranslation = ((key: string) => key) as any;

    await sendSignupToOrganizationEmail({
      usernameOrEmail: "new-org-user@test.com",
      team: { name: "Test Org", parent: null },
      translation: mockTranslation,
      inviterName: "Org Admin",
      teamId: 99,
      isOrg: true,
      role: "MEMBER" as any,
    });

    expect(sendTeamInviteEmailCalls.length).toBe(1);

    const callArgs = sendTeamInviteEmailCalls[0] as Record<string, unknown>;

    // declineLink must be present for org invitations too
    expect(callArgs.declineLink).toBeDefined();
    expect(callArgs.declineLink).toBe(
      `https://app.cal.com/api/auth/teams/decline?token=${MOCK_TOKEN}`
    );
    expect(callArgs.isOrg).toBe(true);
  });

  it("should construct declineLink using the same token as joinLink", async () => {
    const mockTranslation = ((key: string) => key) as any;

    await sendSignupToOrganizationEmail({
      usernameOrEmail: "another@test.com",
      team: { name: "Team A", parent: { name: "Parent Org" } },
      translation: mockTranslation,
      inviterName: "Inviter",
      teamId: 10,
      isOrg: false,
    });

    expect(sendTeamInviteEmailCalls.length).toBe(1);

    const callArgs = sendTeamInviteEmailCalls[0] as Record<string, unknown>;

    // Both links should use the same verification token
    const joinLink = callArgs.joinLink as string;
    const declineLink = callArgs.declineLink as string;

    // Extract token from joinLink
    const joinTokenMatch = joinLink.match(/token=([^&]+)/);
    const declineTokenMatch = declineLink.match(/token=([^&]+)/);

    expect(joinTokenMatch).toBeTruthy();
    expect(declineTokenMatch).toBeTruthy();
    expect(joinTokenMatch![1]).toBe(declineTokenMatch![1]);

    // parentTeamName should be passed through
    expect(callArgs.parentTeamName).toBe("Parent Org");
  });
});
