import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import type { TFunction } from "i18next";

import { TeamInviteEmail } from "./TeamInviteEmail";

/** Minimal translation function stub that returns the key (or interpolated key) for testing */
const t: TFunction = ((key: string, vars?: Record<string, unknown>) => {
  if (vars && typeof vars === "object") {
    let result = key;
    for (const [k, v] of Object.entries(vars)) {
      result = result.replace(`{{${k}}}`, String(v ?? ""));
    }
    return result;
  }
  return key;
}) as unknown as TFunction;

const baseProps = {
  language: t,
  from: "Admin User",
  to: "invitee@example.com",
  teamName: "Engineering",
  joinLink: "https://app.cal.com/teams?token=abc123&autoAccept=true",
  isCalcomMember: true,
  isAutoJoin: false,
  isOrg: false,
  parentTeamName: undefined,
  isExistingUserMovedToOrg: false,
  prevLink: null,
  newLink: null,
};

describe("TeamInviteEmail", () => {
  it("renders the Accept button with the joinLink", () => {
    const html = renderToStaticMarkup(<TeamInviteEmail {...baseProps} />);

    // The accept button label uses the "accept_invite" translation key for existing members
    expect(html).toContain("accept_invite");
    // HTML encodes & as &amp; in href attributes
    expect(html).toContain("token=abc123");
  });

  it("renders a Decline button when declineLink is provided and isAutoJoin is false", () => {
    const declineLink = "https://app.cal.com/teams?token=abc123&action=decline";
    const html = renderToStaticMarkup(<TeamInviteEmail {...baseProps} declineLink={declineLink} />);

    // Should contain the decline button label (translation key "decline")
    expect(html).toContain(">decline<");
    // HTML renders & as &amp; in attribute values
    expect(html).toContain("action=decline");
  });

  it("does NOT render a Decline button when declineLink is not provided", () => {
    const html = renderToStaticMarkup(<TeamInviteEmail {...baseProps} />);

    // "action=decline" should not appear in the rendered output when no declineLink
    expect(html).not.toContain("action=decline");
  });

  it("renders Decline button for org invite when isAutoJoin is false", () => {
    const declineLink = "https://app.cal.com/teams?token=abc123&action=decline";
    const html = renderToStaticMarkup(
      <TeamInviteEmail {...baseProps} declineLink={declineLink} isAutoJoin={false} isOrg={true} />
    );

    // For non-auto-join org invites, decline button should appear
    expect(html).toContain("action=decline");
    expect(html).toContain(">decline<");
  });

  it("does NOT render Decline button for auto-join org invite", () => {
    const declineLink = "https://app.cal.com/teams?token=abc123&action=decline";
    const html = renderToStaticMarkup(
      <TeamInviteEmail
        {...baseProps}
        declineLink={declineLink}
        isAutoJoin={true}
        isOrg={true}
        parentTeamName="Acme Corp"
      />
    );

    // isAutoJoin=true suppresses the decline button
    expect(html).not.toContain("action=decline");
  });
});
