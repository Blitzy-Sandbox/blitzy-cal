import { EmbedElement } from "../EmbedElement";
import { getErrorString } from "../lib/utils";
import loaderCss from "../loader.css?inline";
import inlineHtml, { getSkeletonData } from "./inlineHtml";
export class Inline extends EmbedElement {
  /**
   * Whether to hide event type details in the embed.
   * Public for propagation to the iframe by the parent embed runtime.
   * Supports Calendly `hideEventTypeDetails` parity (EM-001).
   */
  public hideEventTypeDetails: string | null = null;

  static get observedAttributes() {
    return ["loading", "data-hide-event-type-details", "data-background-color", "data-text-color"];
  }

  attributeChangedCallback(name: string, oldValue: string, newValue: string) {
    this.assertHasShadowRoot();
    const errorEl = this.shadowRoot.querySelector<HTMLElement>("#error");
    const slotEl = this.shadowRoot.querySelector<HTMLElement>("slot");
    if (!slotEl || !errorEl) {
      throw new Error("One of loaderEl, slotEl or errorEl is missing");
    }
    if (name === "loading") {
      if (newValue == "done") {
        this.toggleLoader(false);
      } else if (newValue === "failed") {
        this.toggleLoader(false);
        slotEl.style.visibility = "hidden";
        errorEl.style.display = "block";
        const errorString = getErrorString({
          errorCode: this.dataset.errorCode,
          errorMessage: this.dataset.message,
        });
        errorEl.innerText = errorString;
      }
    }

    // EM-001: Handle Calendly-parity customization attributes
    if (name === "data-background-color") {
      this.applyBackgroundColor(newValue);
    } else if (name === "data-text-color") {
      this.applyTextColor(newValue);
    } else if (name === "data-hide-event-type-details") {
      this.hideEventTypeDetails = newValue;
    }
  }

  constructor() {
    super({ isModal: false, getSkeletonData });
    this.attachShadow({ mode: "open" });
    this.assertHasShadowRoot();
    this.shadowRoot.innerHTML = `<style>${window.Cal.__css}</style><style>${loaderCss}</style>${inlineHtml({
      layout: this.layout,
      pageType: this.getPageType() ?? null,
      externalThemeClass: this.themeClass
    })}`;

    // EM-001: Apply initial CSS custom properties from data attributes if present
    this.applyInitialCustomProperties();
  }

  /**
   * Applies the background color CSS custom property to the skeleton container.
   * Supports Calendly's `initInlineWidget()` background color customization (EM-001).
   */
  private applyBackgroundColor(color: string | null): void {
    this.assertHasShadowRoot();
    const skeletonContainer = this.shadowRoot.querySelector<HTMLElement>("#skeleton-container");
    if (skeletonContainer) {
      if (color) {
        skeletonContainer.style.setProperty("--cal-embed-bg", color);
      } else {
        skeletonContainer.style.removeProperty("--cal-embed-bg");
      }
    }
  }

  /**
   * Applies the text color CSS custom property to the skeleton container.
   * Supports Calendly's `initInlineWidget()` text color customization (EM-001).
   */
  private applyTextColor(color: string | null): void {
    this.assertHasShadowRoot();
    const skeletonContainer = this.shadowRoot.querySelector<HTMLElement>("#skeleton-container");
    if (skeletonContainer) {
      if (color) {
        skeletonContainer.style.setProperty("--cal-embed-text", color);
      } else {
        skeletonContainer.style.removeProperty("--cal-embed-text");
      }
    }
  }

  /**
   * Reads initial data attributes set on the element and applies the
   * corresponding CSS custom properties to the skeleton container.
   * Called once during construction after the shadow DOM is populated.
   */
  private applyInitialCustomProperties(): void {
    const { backgroundColor, textColor, hideEventTypeDetails } = this.dataset;
    if (backgroundColor) {
      this.applyBackgroundColor(backgroundColor);
    }
    if (textColor) {
      this.applyTextColor(textColor);
    }
    if (hideEventTypeDetails !== undefined) {
      this.hideEventTypeDetails = hideEventTypeDetails;
    }
  }
}
