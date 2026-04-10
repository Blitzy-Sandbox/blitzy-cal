import { render } from "@testing-library/react";
import React from "react";
import { vi, describe, it, expect, beforeEach } from "vitest";

/**
 * Tests for NF-004 Gap 3: Sidebar header layout after notification bell addition.
 *
 * Verifies that the `<header>` element in SideBar uses `lg:flex-col` for vertical
 * stacking so the notification row and UserDropdown don't overlap or clip.
 */

// --- Mocks for SideBar dependencies ---

vi.mock("next-auth/react", () => ({
  useSession: () => ({
    status: "authenticated",
    data: {
      user: {
        id: 1,
        name: "Test User",
        email: "test@example.com",
        username: "testuser",
        role: "USER",
        orgAwareUsername: "testuser",
        org: undefined,
      },
    },
  }),
}));

vi.mock("next/dynamic", () => ({
  default: () => {
    const DynamicComponent = () => <div data-testid="dynamic-mock" />;
    DynamicComponent.displayName = "DynamicMock";
    return DynamicComponent;
  },
}));

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: { children: React.ReactNode; href: string; className?: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/event-types",
}));

vi.mock("@calcom/features/ee/organizations/lib/getBookerBaseUrlSync", () => ({
  getBookerBaseUrlSync: () => "https://cal.com",
}));

vi.mock("@calcom/features/flags/context/provider", () => ({
  useFlagMap: () => ({}),
}));

vi.mock("@calcom/lib/constants", () => ({
  IS_VISUAL_REGRESSION_TESTING: false,
  ENABLE_PROFILE_SWITCHER: false,
}));

vi.mock("@calcom/lib/defaultAvatarImage", () => ({
  getPlaceholderAvatar: () => "/avatar.png",
}));

vi.mock("@calcom/lib/hooks/useIsStandalone", () => ({
  useIsStandalone: () => false,
}));

vi.mock("@calcom/lib/hooks/useLocale", () => ({
  useLocale: () => ({ t: (key: string) => key, isLocaleReady: true }),
}));

vi.mock("@calcom/prisma/enums", () => ({
  UserPermissionRole: { ADMIN: "ADMIN", USER: "USER" },
}));

vi.mock("@calcom/ui/classNames", () => ({
  default: (...args: (string | boolean | undefined | null)[]) => args.filter(Boolean).join(" "),
}));

vi.mock("@calcom/ui/components/avatar", () => ({
  Avatar: () => <div data-testid="avatar" />,
}));

vi.mock("@calcom/ui/components/credits", () => ({
  Credits: () => <div data-testid="credits" />,
}));

vi.mock("@calcom/ui/components/dropdown", () => ({
  ButtonOrLink: ({ children, ...props }: { children: React.ReactNode; [key: string]: unknown }) => (
    <button {...(props as any)}>{children}</button>
  ),
}));

vi.mock("@calcom/ui/components/icon", () => ({
  Icon: () => <span data-testid="icon" />,
}));

vi.mock("@coss/ui/icons", () => ({
  ArrowLeftIcon: () => <span data-testid="arrow-left" />,
  ArrowRightIcon: () => <span data-testid="arrow-right" />,
}));

vi.mock("@calcom/ui/components/logo", () => ({
  Logo: () => <div data-testid="logo" />,
}));

vi.mock("@calcom/ui/components/skeleton", () => ({
  SkeletonText: () => <div data-testid="skeleton" />,
}));

vi.mock("@calcom/ui/components/tooltip", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("./Kbar", () => ({
  KBarTrigger: () => <div data-testid="kbar-trigger" />,
}));

vi.mock("./NotificationBell", () => ({
  NotificationBell: () => <div data-testid="notification-bell" />,
}));

vi.mock("./navigation/Navigation", () => ({
  Navigation: () => <nav data-testid="navigation" />,
}));

vi.mock("./useBottomNavItems", () => ({
  useBottomNavItems: () => [],
}));

vi.mock("./user-dropdown/ProfileDropdown", () => ({
  ProfileDropdown: () => <div data-testid="profile-dropdown" />,
}));

vi.mock("./user-dropdown/UserDropdown", () => ({
  UserDropdown: ({ small }: { small?: boolean }) => (
    <div data-testid={small ? "user-dropdown-small" : "user-dropdown"} />
  ),
}));

// Import after all mocks
const { SideBar } = await import("./SideBar");

describe("NF-004 Gap 3: SideBar header layout", () => {
  it("should render header with lg:flex-col for proper vertical stacking", () => {
    const { container } = render(<SideBar bannersHeight={0} user={{ id: 1, name: "Test", email: "test@example.com", username: "test", orgAwareUsername: "test", role: "USER" } as any} />);

    const header = container.querySelector("header");
    expect(header).toBeTruthy();

    const headerClasses = header!.className;

    // Must have lg:flex-col for vertical stacking of notification row + UserDropdown
    expect(headerClasses).toContain("lg:flex-col");

    // Must have lg:flex for display
    expect(headerClasses).toContain("lg:flex");

    // Must NOT have items-center and justify-between on the header itself
    // (these classes are on the inner notification row div, not the header)
    expect(headerClasses).not.toContain("items-center");
    expect(headerClasses).not.toContain("justify-between");
  });

  it("should render notification bell within the header", () => {
    const { container } = render(<SideBar bannersHeight={0} user={{ id: 1, name: "Test", email: "test@example.com", username: "test", orgAwareUsername: "test", role: "USER" } as any} />);

    const header = container.querySelector("header");
    expect(header).toBeTruthy();

    // NotificationBell should be inside the header
    const bell = header!.querySelector('[data-testid="notification-bell"]');
    expect(bell).toBeTruthy();
  });

  it("should render UserDropdown below the notification row within the header", () => {
    const { container } = render(<SideBar bannersHeight={0} user={{ id: 1, name: "Test", email: "test@example.com", username: "test", orgAwareUsername: "test", role: "USER" } as any} />);

    const header = container.querySelector("header");
    expect(header).toBeTruthy();

    // UserDropdown should be inside the header (for non-org users)
    const userDropdown = header!.querySelector('[data-testid="user-dropdown"]');
    expect(userDropdown).toBeTruthy();

    // KBarTrigger should also be in the header
    const kbar = header!.querySelector('[data-testid="kbar-trigger"]');
    expect(kbar).toBeTruthy();
  });
});
