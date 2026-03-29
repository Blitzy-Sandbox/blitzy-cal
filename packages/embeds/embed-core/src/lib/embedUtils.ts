/**
 * Embed Utility Functions
 *
 * Provides shared utility functions for the Cal.com embed parity features (EM-001 through EM-004).
 * These utilities support inline, modal, and floating button embeds with Calendly behavioral parity.
 *
 * @module embedUtils
 */

import {
  EMBED_INLINE_MIN_WIDTH,
  EMBED_MODAL_DEFAULT_CLOSE_BUTTON_COLOR,
  EMBED_MODAL_DEFAULT_OVERLAY_COLOR,
} from "../constants";

/**
 * Validates and normalizes a CSS color value.
 * Accepts hex (#rrggbb, #rgb), rgb(), rgba(), hsl(), hsla(), and named CSS colors.
 * Returns the color string trimmed, or the provided fallback if input is empty/undefined.
 *
 * @param color - The color value to validate
 * @param fallback - The fallback color if the input is undefined or empty
 * @returns The normalized color string
 */
export function normalizeColor(color: string | undefined | null, fallback: string): string {
  if (!color || !color.trim()) {
    return fallback;
  }
  return color.trim();
}

/**
 * Returns the default modal overlay color used when no custom color is provided.
 * Maps to the Calendly `initPopupWidget()` default overlay appearance.
 *
 * @returns The default overlay color string (EM-002)
 */
export function getDefaultModalOverlayColor(): string {
  return EMBED_MODAL_DEFAULT_OVERLAY_COLOR;
}

/**
 * Returns the default modal close button color used when no custom color is provided.
 *
 * @returns The default close button color string (EM-002)
 */
export function getDefaultModalCloseButtonColor(): string {
  return EMBED_MODAL_DEFAULT_CLOSE_BUTTON_COLOR;
}

/**
 * Returns the minimum width in pixels for inline embeds.
 * Matches Calendly's `initInlineWidget()` minimum container width requirement.
 *
 * @returns The minimum inline embed width in pixels (EM-001)
 */
export function getInlineMinWidth(): number {
  return EMBED_INLINE_MIN_WIDTH;
}

/**
 * Validates and normalizes a CSS border-radius value for the floating button.
 * Accepts pixel values (e.g., "8px"), percentage values (e.g., "50%"),
 * or plain numbers (treated as pixels).
 *
 * @param borderRadius - The border radius value to validate
 * @returns The normalized border-radius CSS value, or undefined if invalid/empty
 */
export function normalizeBorderRadius(borderRadius: string | undefined | null): string | undefined {
  if (!borderRadius || !borderRadius.trim()) {
    return undefined;
  }
  const trimmed = borderRadius.trim();
  // If it's a plain number, append "px"
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    return `${trimmed}px`;
  }
  // Accept values that end in px, %, em, rem, or are valid CSS keywords
  if (/^\d+(\.\d+)?(px|%|em|rem|vw|vh)$/.test(trimmed)) {
    return trimmed;
  }
  // Return as-is for other valid CSS values (e.g., "inherit", "initial")
  return trimmed;
}

/**
 * Builds a style string from an object of CSS property-value pairs.
 * Filters out undefined/null values and joins with semicolons.
 *
 * @param styles - An object mapping CSS property names to their values
 * @returns A CSS style attribute string
 */
export function buildStyleString(styles: Record<string, string | number | undefined | null>): string {
  return Object.entries(styles)
    .filter((entry): entry is [string, string | number] => entry[1] != null && entry[1] !== "")
    .map(([key, value]) => `${key}:${value}`)
    .join(";");
}

/**
 * Generates the inline embed container style string with EM-001 min-width enforcement.
 *
 * @param overrides - Optional CSS property overrides
 * @returns The complete style string for the inline embed container
 */
export function getInlineContainerStyle(
  overrides: Record<string, string | number | undefined | null> = {}
): string {
  return buildStyleString({
    "max-height": "inherit",
    height: "inherit",
    "min-height": "inherit",
    display: "flex",
    position: "relative",
    "flex-wrap": "wrap",
    width: "100%",
    "min-width": `${EMBED_INLINE_MIN_WIDTH}px`,
    ...overrides,
  });
}

/**
 * Creates a sanitized embed code snippet string for the given embed type and configuration.
 * Used by the share flow (EM-004) to generate copy-paste-ready embed snippets.
 *
 * @param embedType - The type of embed: "inline", "modal", or "floating-button"
 * @param calLink - The booking link URL path
 * @param options - Configuration options for the embed snippet
 * @returns The HTML/JS embed code snippet string
 */
export function generateEmbedSnippet(
  embedType: "inline" | "modal" | "floating-button",
  calLink: string,
  options: {
    namespace?: string;
    theme?: string;
    backgroundColor?: string;
    textColor?: string;
    buttonColor?: string;
    buttonTextColor?: string;
    buttonBorderRadius?: string;
    buttonText?: string;
    hideEventTypeDetails?: boolean;
    modalOverlayColor?: string;
    modalCloseButtonColor?: string;
  } = {}
): string {
  const namespace = options.namespace ? `"${options.namespace}"` : "";
  const configParts: string[] = [];

  if (options.theme) {
    configParts.push(`theme: "${options.theme}"`);
  }
  if (options.hideEventTypeDetails) {
    configParts.push(`hideEventTypeDetails: true`);
  }

  const configStr = configParts.length > 0 ? `, { ${configParts.join(", ")} }` : "";

  switch (embedType) {
    case "inline":
      return [
        `<!-- Cal inline embed code begin -->`,
        `<div id="cal-inline-embed" style="width:100%;min-width:${EMBED_INLINE_MIN_WIDTH}px;height:100%;overflow:auto"></div>`,
        `<script>`,
        `  Cal(${namespace}"inline", {`,
        `    elementOrSelector: "#cal-inline-embed",`,
        `    calLink: "${calLink}"${configStr}`,
        `  });`,
        ...(options.backgroundColor || options.textColor
          ? [
              `  Cal(${namespace}"ui", {`,
              `    styles: { body: { background: "${options.backgroundColor || "auto"}" } }`,
              `  });`,
            ]
          : []),
        `</script>`,
        `<!-- Cal inline embed code end -->`,
      ].join("\n");

    case "modal":
      return [
        `<!-- Cal popup embed code begin -->`,
        `<button data-cal-link="${calLink}"${namespace ? ` data-cal-namespace=${namespace}` : ""}${configStr ? ` data-cal-config='${JSON.stringify(Object.fromEntries(configParts.map((p) => p.split(": ").map((s) => s.replace(/['"]/g, "")))))}'` : ""}>`,
        `  Book a meeting`,
        `</button>`,
        `<script>`,
        `  Cal(${namespace}"modal", {`,
        `    calLink: "${calLink}"${configStr}`,
        `  });`,
        ...(options.modalOverlayColor || options.modalCloseButtonColor
          ? [
              `  Cal(${namespace}"ui", {`,
              ...(options.modalOverlayColor
                ? [`    modalOverlayColor: "${options.modalOverlayColor}",`]
                : []),
              ...(options.modalCloseButtonColor
                ? [`    modalCloseButtonColor: "${options.modalCloseButtonColor}",`]
                : []),
              `  });`,
            ]
          : []),
        `</script>`,
        `<!-- Cal popup embed code end -->`,
      ].join("\n");

    case "floating-button": {
      const fbOptions: string[] = [`calLink: "${calLink}"`];
      if (options.buttonText) fbOptions.push(`buttonText: "${options.buttonText}"`);
      if (options.buttonColor) fbOptions.push(`buttonColor: "${options.buttonColor}"`);
      if (options.buttonTextColor) fbOptions.push(`buttonTextColor: "${options.buttonTextColor}"`);
      if (options.buttonBorderRadius) fbOptions.push(`buttonBorderRadius: "${options.buttonBorderRadius}"`);
      if (options.hideEventTypeDetails) fbOptions.push(`config: { hideEventTypeDetails: true }`);

      return [
        `<!-- Cal floating button embed code begin -->`,
        `<script>`,
        `  Cal(${namespace}"floatingButton", {`,
        ...fbOptions.map((opt, i) => `    ${opt}${i < fbOptions.length - 1 ? "," : ""}`),
        `  });`,
        `</script>`,
        `<!-- Cal floating button embed code end -->`,
      ].join("\n");
    }

    default:
      return "";
  }
}
