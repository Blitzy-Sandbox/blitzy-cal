import { prisma } from "@calcom/prisma";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

/**
 * AG-004 — Public Team Invitation Decline Endpoint
 *
 * Accepts GET requests with a `?token=` query param — no authentication required.
 * Looks up the VerificationToken by token value, validates it is not expired,
 * reads identifier (email) and teamId, finds the user by email, and if a pending
 * Membership (accepted: false) exists for that user+team, sets declinedAt on it.
 * Then deletes all VerificationToken rows for that identifier + teamId.
 *
 * Returns an inline HTML response (not a redirect) — a simple branded confirmation
 * page with no login required. On error, returns an inline HTML error page.
 */

/** Generate a simple branded HTML page */
function htmlPage(title: string, heading: string, message: string, isError: boolean = false): string {
  const color = isError ? "#dc2626" : "#16a34a";
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} | Cal.com</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      margin: 0;
      background-color: #f9fafb;
      color: #111827;
    }
    .card {
      background: white;
      border-radius: 12px;
      padding: 48px;
      max-width: 420px;
      text-align: center;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    }
    .icon {
      width: 48px;
      height: 48px;
      border-radius: 50%;
      background: ${color}20;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 16px;
      font-size: 24px;
    }
    h1 { font-size: 20px; margin: 0 0 8px; color: ${color}; }
    p { font-size: 14px; color: #6b7280; margin: 0; line-height: 1.5; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">${isError ? "✕" : "✓"}</div>
    <h1>${heading}</h1>
    <p>${message}</p>
  </div>
</body>
</html>`;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get("token");

  if (!token) {
    return new NextResponse(
      htmlPage(
        "Invalid Request",
        "Invalid Request",
        "No invitation token was provided. Please use the link from your invitation email.",
        true
      ),
      { status: 400, headers: { "Content-Type": "text/html; charset=utf-8" } }
    );
  }

  try {
    // Look up the verification token
    const verificationToken = await prisma.verificationToken.findFirst({
      where: { token },
    });

    if (!verificationToken) {
      return new NextResponse(
        htmlPage(
          "Invalid Token",
          "Invalid or Expired Invitation",
          "This invitation link is no longer valid. It may have already been used or has expired. Please contact the team admin to receive a new invitation.",
          true
        ),
        { status: 400, headers: { "Content-Type": "text/html; charset=utf-8" } }
      );
    }

    // Check if token is expired
    if (verificationToken.expires && new Date() > new Date(verificationToken.expires)) {
      return new NextResponse(
        htmlPage(
          "Expired Invitation",
          "Invitation Expired",
          "This invitation link has expired. Please contact the team admin to receive a new invitation.",
          true
        ),
        { status: 400, headers: { "Content-Type": "text/html; charset=utf-8" } }
      );
    }

    const email = verificationToken.identifier;
    const teamId = verificationToken.teamId;

    if (!teamId) {
      return new NextResponse(
        htmlPage(
          "Invalid Token",
          "Invalid Invitation",
          "This invitation link is not associated with a team. Please contact the team admin.",
          true
        ),
        { status: 400, headers: { "Content-Type": "text/html; charset=utf-8" } }
      );
    }

    // Find the user by email
    const user = await prisma.user.findFirst({
      where: { email },
      select: { id: true },
    });

    // Find the team name for the confirmation message
    const team = await prisma.team.findUnique({
      where: { id: teamId },
      select: { name: true },
    });
    const teamName = team?.name ?? "the team";

    if (user) {
      // If a pending Membership (accepted: false) exists for that user+team, set declinedAt
      await prisma.membership.updateMany({
        where: {
          userId: user.id,
          teamId,
          accepted: false,
          declinedAt: null,
        },
        data: {
          declinedAt: new Date(),
        },
      });
    }

    // Delete all VerificationToken rows for that identifier + teamId
    await prisma.verificationToken.deleteMany({
      where: {
        identifier: email,
        teamId,
      },
    });

    return new NextResponse(
      htmlPage(
        "Invitation Declined",
        "Invitation Declined",
        `You have declined the invitation to join ${teamName}. You can close this tab.`
      ),
      { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } }
    );
  } catch (error) {
    console.error("[teams/decline] Error processing decline:", error);
    return new NextResponse(
      htmlPage(
        "Error",
        "Something Went Wrong",
        "An error occurred while processing your request. Please try again or contact the team admin.",
        true
      ),
      { status: 500, headers: { "Content-Type": "text/html; charset=utf-8" } }
    );
  }
}
