export const getDimension = (dimension: string) => {
  if (dimension.match(/^\d+$/)) {
    dimension = `${dimension}%`;
  }
  return dimension;
};

/**
 * Extended dimension utility for share flow embed sizing.
 *
 * Supports viewport-relative and fixed dimension formats used in
 * Calendly-equivalent embed configurations (e.g., "100vh" for
 * full-viewport inline embeds, "400px" for fixed-size popup embeds).
 *
 * When `dimension` is a bare number (digits only), the specified
 * `defaultUnit` is appended. If the string already contains a unit
 * suffix it is returned as-is.
 *
 * @param dimension  - Raw dimension value (e.g. "100", "100px", "50vh")
 * @param defaultUnit - Unit to append when dimension is digits-only (default: "%")
 * @returns Dimension string guaranteed to carry a CSS unit
 */
export const getShareFlowDimension = (dimension: string, defaultUnit: "%" | "px" | "vh" | "vw" = "%"): string => {
  if (dimension.match(/^\d+$/)) {
    return `${dimension}${defaultUnit}`;
  }
  return dimension;
};
