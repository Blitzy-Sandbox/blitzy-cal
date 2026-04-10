import { EMBED_LIB_URL, WEBAPP_URL } from "@calcom/lib/constants";

export const embedLibUrl = EMBED_LIB_URL;
export const EMBED_PREVIEW_HTML_URL = `${WEBAPP_URL}/embed/preview.html`;

/** Base query parameter name used to indicate embed mode in share links (e.g., `?embed=inline`) */
export const SHARE_FLOW_EMBED_PARAM = "embed" as const;

/** Default query parameter values for share flow link generation */
export const SHARE_FLOW_DEFAULTS = {
  /** Default redirect behavior after booking — empty string means no redirect */
  redirectUrl: "",
  /** Default forward query params setting */
  forwardQueryParams: false,
} as const;

export const enum EmbedTheme {
  auto = "auto",
  light = "light",
  dark = "dark",
}

/** Enumerates share link modes that align with Calendly's share flow options */
export const enum ShareFlowType {
  /** Direct booking link without embed wrapper */
  directLink = "link",
  /** Inline embed share link (corresponds to cal-inline custom element) */
  inline = "inline",
  /** Popup/modal embed share link (corresponds to cal-modal-box custom element) */
  popup = "popup",
  /** Floating button embed share link (corresponds to cal-floating-button custom element) */
  floating = "floating",
}
