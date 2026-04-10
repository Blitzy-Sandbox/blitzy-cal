/**
 * Embed Parity Tests — Sprint 6 (EM-001, EM-002, EM-003)
 *
 * Validates Calendly behavioral parity for all three Cal.com embed types:
 *   - Inline embed ↔ Calendly initInlineWidget() (EM-001)
 *   - Modal embed ↔ Calendly initPopupWidget() (EM-002)
 *   - Floating button ↔ Calendly initBadgeWidget() (EM-003)
 *
 * Reference: docs/gap-report/embed-share.mdx
 */

// MUST be the first import — mocks window.matchMedia for jsdom (same pattern as embed.test.ts line 1)
import "./__mocks__/windowMatchMedia";

import { describe, it, expect, beforeEach, beforeAll, afterEach, vi } from "vitest";

// Mock tailwindCss module to prevent CSS loading side-effects (same as embed.test.ts lines 11-13)
vi.mock("../src/tailwindCss", () => ({
  default: "mockedTailwindCss",
}));

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

/**
 * Creates an inline container div and appends it to document.body.
 * Used to provide an anchor element for Cal.inline() calls.
 */
function createInlineContainer(id: string = "cal-inline-test"): HTMLElement {
  const container = document.createElement("div");
  container.id = id;
  document.body.appendChild(container);
  return container;
}

/**
 * Asserts that a `cal-inline` custom element exists within the provided container.
 * Returns the found element for further assertions.
 */
function expectInlineEmbedInContainer(container: HTMLElement): HTMLElement {
  const calInline = container.querySelector("cal-inline") as HTMLElement | null;
  expect(calInline).toBeTruthy();
  if (!calInline) throw new Error("cal-inline element not found in container");
  return calInline;
}

/**
 * Asserts that a `cal-modal-box` custom element exists in the document.
 * Returns the found element for further assertions.
 */
function expectModalBoxInDocument(): HTMLElement {
  const calModalBox = document.querySelector("cal-modal-box") as HTMLElement | null;
  expect(calModalBox).toBeTruthy();
  if (!calModalBox) throw new Error("cal-modal-box element not found in document");
  return calModalBox;
}

/**
 * Asserts that a `cal-floating-button` custom element exists in the document.
 * Returns both the element and its dataset for attribute verification.
 */
function expectFloatingButtonInDocument(): {
  element: HTMLElement;
  dataset: DOMStringMap;
} {
  const calFloatingButton = document.querySelector("cal-floating-button") as HTMLElement | null;
  expect(calFloatingButton).toBeTruthy();
  if (!calFloatingButton) throw new Error("cal-floating-button element not found in document");
  return { element: calFloatingButton, dataset: calFloatingButton.dataset };
}

/**
 * Finds the first iframe child within the provided element.
 * Asserts it exists and returns it for src/style assertions.
 */
function expectIframeInElement(element: HTMLElement): HTMLIFrameElement {
  const iframe = element.querySelector("iframe") as HTMLIFrameElement | null;
  expect(iframe).toBeTruthy();
  if (!iframe) throw new Error("iframe element not found in parent element");
  return iframe;
}

// ---------------------------------------------------------------------------
// Main test suite
// ---------------------------------------------------------------------------

describe("Embed Parity Tests (Sprint 6 — EM-001, EM-002, EM-003)", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let CalClass: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let calInstance: any;

  beforeAll(async () => {
    vi.stubEnv("EMBED_PUBLIC_WEBAPP_URL", "https://app.cal.com");

    // Mock window.Cal — required by embed.ts at module load time (same pattern as embed.test.ts lines 142-149)
    const mockWindowCal = {
      q: [] as unknown[],
      ns: {} as Record<string, unknown>,
    };
    Object.defineProperty(window, "Cal", {
      value: mockWindowCal,
      writable: true,
    });

    // Dynamically import so mocks/env are applied before the embed.ts side effects execute
    CalClass = (await import("../src/embed")).Cal;
  });

  beforeEach(() => {
    vi.stubEnv("WEBAPP_URL", "https://app.cal.com");

    calInstance = new CalClass("test-parity-namespace", []);
    // Reset the document body before each test to avoid cross-test pollution
    document.body.innerHTML = "";
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // =========================================================================
  // EM-001 — Inline Embed Parity (Calendly initInlineWidget equivalence)
  // =========================================================================

  describe("Inline Embed Parity (EM-001)", () => {
    it("should create inline embed with cal-inline custom element in specified container", () => {
      const container = createInlineContainer();

      calInstance.api.inline({
        calLink: "user/event",
        elementOrSelector: "#cal-inline-test",
        config: {},
      });

      // Verify cal-inline element is created inside the container
      const calInline = expectInlineEmbedInContainer(container);

      // Verify an iframe exists inside the cal-inline element
      const iframe = expectIframeInElement(calInline);

      // Verify iframe dimensions match Calendly inline embed expectations (embed.ts lines 954-955)
      expect(iframe.style.height).toBe("100%");
      expect(iframe.style.width).toBe("100%");
    });

    it("should support hideEventTypeDetails configuration option via ui command", () => {
      createInlineContainer();

      calInstance.api.inline({
        calLink: "user/event",
        elementOrSelector: "#cal-inline-test",
        config: {},
      });

      // Spy on doInIframe to capture ui command (same pattern as embed.test.ts line 341)
      vi.spyOn(calInstance, "doInIframe");

      // Cal.api.ui() is the mechanism that matches Calendly's hideEventTypeDetails option
      calInstance.api.ui({ hideEventTypeDetails: true });

      // Verify doInIframe was called with the correct ui config (embed.ts line 1503)
      expect(calInstance.doInIframe).toHaveBeenCalledWith({
        method: "ui",
        arg: { hideEventTypeDetails: true },
      });
    });

    it("should set iframe width to 100% matching Calendly inline embed min-width expectations", () => {
      const container = createInlineContainer();

      calInstance.api.inline({
        calLink: "user/event",
        elementOrSelector: "#cal-inline-test",
        config: {},
      });

      const calInline = expectInlineEmbedInContainer(container);
      const iframe = expectIframeInElement(calInline);

      // Calendly requires min-width: 320px for inline embeds; Cal.com sets width: 100% (embed.ts line 955)
      expect(iframe.style.width).toBe("100%");

      // Verify the cal-inline-container class is added (embed.ts line 957)
      expect(container.classList.contains("cal-inline-container")).toBe(true);
    });

    it("should handle dynamic height adjustment via __dimensionChanged event", () => {
      createInlineContainer();

      calInstance.api.inline({
        calLink: "user/event",
        elementOrSelector: "#cal-inline-test",
        config: {},
      });

      // The iframe should be set on the Cal instance after inline() call
      const iframe = calInstance.iframe as HTMLIFrameElement;
      expect(iframe).toBeTruthy();

      // Fire the __dimensionChanged event through the actionManager (embed.ts lines 444-460)
      calInstance.actionManager.fire("__dimensionChanged", {
        iframeHeight: 500,
        iframeWidth: 800,
        isFirstTime: false,
      });

      // Verify iframe height was updated to the reported dimension
      expect(iframe.style.height).toBe("500px");
    });

    it("should handle scroll behavior on __routeChanged event for inline embed", () => {
      createInlineContainer();

      calInstance.api.inline({
        calLink: "user/event",
        elementOrSelector: "#cal-inline-test",
        config: {},
      });

      const inlineEl = calInstance.inlineEl as HTMLElement;
      expect(inlineEl).toBeTruthy();

      // Mock getBoundingClientRect: simulate element partially hidden above the viewport
      // top = -200, height = 400 → abs(top/height) = 0.5 >= 0.25 threshold (embed.ts line 486)
      inlineEl.getBoundingClientRect = vi.fn().mockReturnValue({
        top: -200,
        height: 400,
        bottom: 200,
        left: 0,
        right: 800,
        width: 800,
        x: 0,
        y: -200,
        toJSON: vi.fn(),
      });

      // Mock scrollIntoView — jsdom does not implement it by default
      inlineEl.scrollIntoView = vi.fn();

      // Fire __routeChanged to trigger the scroll handler (embed.ts lines 479-489)
      calInstance.actionManager.fire("__routeChanged", {});

      // Verify scrollIntoView was called with smooth behavior
      expect(inlineEl.scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth" });
    });

    it("should prevent duplicate inline embeds per namespace", () => {
      const container = createInlineContainer();
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      // First call — creates the inline embed
      calInstance.api.inline({
        calLink: "user/event",
        elementOrSelector: "#cal-inline-test",
        config: {},
      });

      // Second call — should be ignored with a warning (embed.ts line 928)
      calInstance.api.inline({
        calLink: "user/event",
        elementOrSelector: "#cal-inline-test",
        config: {},
      });

      // Verify the warning was emitted
      expect(warnSpy).toHaveBeenCalledWith("Inline embed already exists. Ignoring this call");

      // Verify only one cal-inline element exists
      const inlineElements = container.querySelectorAll("cal-inline");
      expect(inlineElements.length).toBe(1);
    });

    it("should support theme configuration in inline embed", () => {
      const container = createInlineContainer();

      calInstance.api.inline({
        calLink: "user/event",
        elementOrSelector: "#cal-inline-test",
        config: { theme: "dark" },
      });

      const calInline = expectInlineEmbedInContainer(container);

      // Verify the cal-inline element has the correct theme data attribute (embed.ts lines 962-969)
      expect(calInline.getAttribute("data-theme")).toBe("dark");
    });

    it("should support layout configuration in inline embed", () => {
      const container = createInlineContainer();

      calInstance.api.inline({
        calLink: "user/event",
        elementOrSelector: "#cal-inline-test",
        config: { layout: "month_view" },
      });

      const calInline = expectInlineEmbedInContainer(container);

      // Verify the cal-inline element has the correct layout data attribute
      expect(calInline.getAttribute("data-layout")).toBe("month_view");
    });
  });

  // =========================================================================
  // EM-002 — Modal Embed Parity (Calendly initPopupWidget equivalence)
  // =========================================================================

  describe("Modal Embed Parity (EM-002)", () => {
    it("should create modal with cal-modal-box custom element", () => {
      calInstance.api.modal({
        calLink: "user/event",
        config: { theme: "light", layout: "month_view" },
      });

      const modalBox = expectModalBoxInDocument();

      // Verify required attributes (embed.ts lines 1253-1264)
      expect(modalBox.hasAttribute("uid")).toBe(true);
      expect(modalBox.getAttribute("data-theme")).toBe("light");
      expect(modalBox.getAttribute("data-layout")).toBe("month_view");

      // Modal should start in "loading" state initially, then move to "prerendering" for prerenders
      // For non-prerender calls, state goes directly to "loading" (embed.ts line 1264)
      expect(modalBox.getAttribute("state")).toBe("loading");
    });

    it("should support hideEventTypeDetails in modal context via ui command", () => {
      calInstance.api.modal({
        calLink: "user/event",
        config: {},
      });

      // Spy on doInIframe after modal is created
      vi.spyOn(calInstance, "doInIframe");

      calInstance.api.ui({ hideEventTypeDetails: true });

      // Verify the ui command is correctly forwarded to the iframe
      expect(calInstance.doInIframe).toHaveBeenCalledWith({
        method: "ui",
        arg: { hideEventTypeDetails: true },
      });
    });

    it("should support background color and text color customization via ui styles", () => {
      calInstance.api.modal({
        calLink: "user/event",
        config: {},
      });

      vi.spyOn(calInstance, "doInIframe");

      // Calendly supports background overlay color; Cal.com maps this to EmbedStyles (types.ts lines 10-16)
      calInstance.api.ui({
        styles: { body: { background: "rgba(0,0,0,0.5)" } },
      });

      expect(calInstance.doInIframe).toHaveBeenCalledWith({
        method: "ui",
        arg: {
          styles: { body: { background: "rgba(0,0,0,0.5)" } },
        },
      });
    });

    it("should set embedType to modal in iframe config", () => {
      calInstance.api.modal({
        calLink: "user/event",
        config: {},
      });

      const modalBox = expectModalBoxInDocument();
      const iframe = expectIframeInElement(modalBox);

      // Verify iframe src contains embedType=modal (embed.ts line 1074)
      expect(iframe.src).toContain("embedType=modal");
    });

    it("should support prerendering and iframe reuse capabilities", async () => {
      const modalArgs = {
        calLink: "user/event",
        config: { theme: "light", layout: "month_view" },
      };

      // First call — prerender
      const result = await calInstance.api.modal({
        ...modalArgs,
        __prerender: true,
      });
      expect(result?.status).toBe("created");
      expect(calInstance.isPrerendering).toBe(true);

      const modalBox = expectModalBoxInDocument();
      expect(modalBox.getAttribute("state")).toBe("prerendering");

      // Capture the uid for reuse verification
      const originalUid = modalBox.getAttribute("uid");
      expect(originalUid).toBeTruthy();

      // Verify embedRenderStartTime and embedConfig are set (used for modal reuse decisions)
      expect(calInstance.embedRenderStartTime).toBeGreaterThan(0);
      expect(calInstance.embedConfig).toBeDefined();

      // Second call — normal open (CTA click) should reuse the same modal
      await calInstance.api.modal(modalArgs);

      // Only one cal-modal-box should exist in the DOM
      const allModals = document.querySelectorAll("cal-modal-box");
      expect(allModals.length).toBe(1);

      // The same uid should be preserved (iframe reuse)
      expect(allModals[0].getAttribute("uid")).toBe(originalUid);
    });

    it("should handle close button behavior via modalBox state transitions", () => {
      calInstance.api.modal({
        calLink: "user/event",
        config: {},
      });

      const modalBox = expectModalBoxInDocument();
      // Initial state is "loading"
      expect(modalBox.getAttribute("state")).toBe("loading");

      // Dispatch __closeIframe event — this is how the embedded page requests the modal to close
      // The handler is registered in __modal → handleClose() (embed.ts lines 1276-1280)
      calInstance.actionManager.fire("__closeIframe", {});

      // Verify modal transitions to "closed" state
      expect(modalBox.getAttribute("state")).toBe("closed");
    });

    it("should support color scheme customization passed through to iframe", () => {
      calInstance.api.modal({
        calLink: "user/event",
        config: { "ui.color-scheme": "dark" },
      });

      const modalBox = expectModalBoxInDocument();
      const iframe = expectIframeInElement(modalBox);

      // Verify the color scheme is passed as a query parameter to the iframe URL
      expect(iframe.src).toContain("ui.color-scheme=dark");
    });
  });

  // =========================================================================
  // EM-003 — Floating Button Embed Parity (Calendly initBadgeWidget equivalence)
  // =========================================================================

  describe("Floating Button Embed Parity (EM-003)", () => {
    it("should create floating button with configurable buttonText", () => {
      calInstance.api.floatingButton({
        calLink: "user/event",
        buttonText: "Schedule Now",
      });

      const { dataset } = expectFloatingButtonInDocument();

      // Verify custom buttonText is set (embed.ts line 1033)
      expect(dataset.buttonText).toBe("Schedule Now");
    });

    it("should use default buttonText 'Book my Cal' when not specified", () => {
      calInstance.api.floatingButton({
        calLink: "user/event",
      });

      const { dataset } = expectFloatingButtonInDocument();

      // Default buttonText matches Cal.com branding (embed.ts line 980)
      expect(dataset.buttonText).toBe("Book my Cal");
    });

    it("should support configurable buttonColor", () => {
      calInstance.api.floatingButton({
        calLink: "user/event",
        buttonColor: "rgb(255, 0, 0)",
      });

      const { dataset } = expectFloatingButtonInDocument();

      // Verify custom buttonColor (embed.ts line 1036)
      expect(dataset.buttonColor).toBe("rgb(255, 0, 0)");
    });

    it("should use default buttonColor 'rgb(0, 0, 0)' when not specified", () => {
      calInstance.api.floatingButton({
        calLink: "user/event",
      });

      const { dataset } = expectFloatingButtonInDocument();

      // Default is black (embed.ts line 984)
      expect(dataset.buttonColor).toBe("rgb(0, 0, 0)");
    });

    it("should support configurable buttonTextColor", () => {
      calInstance.api.floatingButton({
        calLink: "user/event",
        buttonTextColor: "rgb(0, 255, 0)",
      });

      const { dataset } = expectFloatingButtonInDocument();

      // Verify custom buttonTextColor (embed.ts line 1037)
      expect(dataset.buttonTextColor).toBe("rgb(0, 255, 0)");
    });

    it("should use default buttonTextColor 'rgb(255, 255, 255)' when not specified", () => {
      calInstance.api.floatingButton({
        calLink: "user/event",
      });

      const { dataset } = expectFloatingButtonInDocument();

      // Default is white text on dark background (embed.ts line 985)
      expect(dataset.buttonTextColor).toBe("rgb(255, 255, 255)");
    });

    it("should support configurable buttonPosition with bottom-right default", () => {
      // Test default position
      calInstance.api.floatingButton({
        calLink: "user/event",
      });

      const { dataset: defaultDataset } = expectFloatingButtonInDocument();
      expect(defaultDataset.buttonPosition).toBe("bottom-right");

      // Reset DOM for second test
      document.body.innerHTML = "";

      // Test explicit bottom-left position
      calInstance.api.floatingButton({
        calLink: "user/event",
        buttonPosition: "bottom-left",
      });

      const secondButton = document.querySelector("cal-floating-button") as HTMLElement;
      expect(secondButton).toBeTruthy();
      expect(secondButton.dataset.buttonPosition).toBe("bottom-left");
    });

    it("should set calLink and calNamespace data attributes on floating button", () => {
      calInstance.api.floatingButton({
        calLink: "user/event",
      });

      const { dataset } = expectFloatingButtonInDocument();

      // Verify calLink is stored for modal trigger (embed.ts line 1017)
      expect(dataset.calLink).toBe("user/event");

      // Verify namespace is set (embed.ts line 1018)
      expect(dataset.calNamespace).toBe("test-parity-namespace");
    });

    it("should store config as JSON in data-cal-config when config provided", () => {
      const config = { theme: "dark" };

      calInstance.api.floatingButton({
        calLink: "user/event",
        config,
      });

      const { dataset } = expectFloatingButtonInDocument();

      // Verify config is serialized as JSON (embed.ts lines 1020-1022)
      expect(dataset.calConfig).toBe(JSON.stringify(config));
    });

    it("should support hideButtonIcon configuration", () => {
      calInstance.api.floatingButton({
        calLink: "user/event",
        hideButtonIcon: true,
      });

      const { dataset } = expectFloatingButtonInDocument();

      // Verify hideButtonIcon is stored as string "true" (embed.ts line 1034)
      expect(dataset.hideButtonIcon).toBe("true");
    });

    it("should reuse existing element if attributes.id matches an existing DOM element", () => {
      // Create a pre-existing element with a specific id (simulating server-rendered button)
      const existingEl = document.createElement("div");
      existingEl.id = "existing-fab";
      document.body.appendChild(existingEl);

      calInstance.api.floatingButton({
        calLink: "user/event",
        attributes: { id: "existing-fab" },
      });

      // No new cal-floating-button should have been created (embed.ts lines 1008-1012)
      const floatingButtons = document.querySelectorAll("cal-floating-button");
      expect(floatingButtons.length).toBe(0);

      // The existing element should have dataset attributes applied (embed.ts lines 1029-1037)
      expect(existingEl.dataset.buttonText).toBe("Book my Cal");
      expect(existingEl.dataset.buttonPosition).toBe("bottom-right");
      expect(existingEl.dataset.buttonColor).toBe("rgb(0, 0, 0)");
      expect(existingEl.dataset.buttonTextColor).toBe("rgb(255, 255, 255)");
    });
  });

  // =========================================================================
  // Cross-Cutting Embed Parity — shared behavior across all embed types
  // =========================================================================

  describe("Cross-Cutting Embed Parity", () => {
    it("hideEventTypeDetails should work across all embed types via ui command", () => {
      createInlineContainer();

      calInstance.api.inline({
        calLink: "user/event",
        elementOrSelector: "#cal-inline-test",
        config: {},
      });

      // Spy on doInIframe after the embed is created
      vi.spyOn(calInstance, "doInIframe");

      // The ui command works at the Cal instance level — it applies to whichever embed type
      // is active, matching Calendly's hideEventTypeDetails option (embed.ts lines 1488-1504)
      calInstance.api.ui({ hideEventTypeDetails: true });

      expect(calInstance.doInIframe).toHaveBeenCalledWith({
        method: "ui",
        arg: { hideEventTypeDetails: true },
      });
    });

    it("color customization styles should be passed through to iframe via ui command", () => {
      createInlineContainer();

      calInstance.api.inline({
        calLink: "user/event",
        elementOrSelector: "#cal-inline-test",
        config: {},
      });

      vi.spyOn(calInstance, "doInIframe");

      // Comprehensive style customization matching Calendly's color options (types.ts EmbedStyles)
      const styleConfig = {
        styles: {
          body: { background: "#f0f0f0" },
          enabledDateButton: { backgroundColor: "#007bff", color: "#fff" },
        },
      };

      calInstance.api.ui(styleConfig);

      expect(calInstance.doInIframe).toHaveBeenCalledWith({
        method: "ui",
        arg: styleConfig,
      });
    });

    it("existing configurations should work unchanged for backward compatibility", () => {
      // Verify inline embed backward compatibility
      const container = createInlineContainer();

      calInstance.api.inline({
        calLink: "user/event",
        elementOrSelector: "#cal-inline-test",
        config: { theme: "light", layout: "month_view" },
      });

      const calInline = expectInlineEmbedInContainer(container);
      expect(calInline.getAttribute("data-theme")).toBe("light");
      expect(calInline.getAttribute("data-layout")).toBe("month_view");

      // Reset DOM for floating button test
      document.body.innerHTML = "";
      // Need a fresh Cal instance since the previous one has inlineEl set
      calInstance = new CalClass("test-compat-namespace", []);

      // Verify floating button backward compatibility with all default params
      calInstance.api.floatingButton({ calLink: "user/event" });

      const floatingButton = document.querySelector("cal-floating-button") as HTMLElement;
      expect(floatingButton).toBeTruthy();
      expect(floatingButton.dataset.buttonText).toBe("Book my Cal");
      expect(floatingButton.dataset.buttonPosition).toBe("bottom-right");
      expect(floatingButton.dataset.buttonColor).toBe("rgb(0, 0, 0)");
      expect(floatingButton.dataset.buttonTextColor).toBe("rgb(255, 255, 255)");
    });

    it("ui commands should persist across iframe resets", () => {
      // Verify that the "ui" command is in the list of commands that persist across iframe resets
      // This ensures that styling configuration (including Calendly-equivalent color customization)
      // is automatically reapplied when the iframe reloads (embed.ts line 239)
      expect(calInstance.commandsPersistAcrossIframeResets).toContain("ui");
    });
  });
});
