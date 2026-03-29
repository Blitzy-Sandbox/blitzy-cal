// We can't keep it too high because that might cause stale content to be shown
// Configurable via options.slotsStaleTimeMs. We could keep it at a lower end as the impact would be refetch of availability only.
export const EMBED_MODAL_IFRAME_SLOT_STALE_TIME = 60 * 1000; // 1 minute
// Keep it high by default to avoid impact on loading time as it would cause a full reload of the iframe user can configure it via options.iframeForceReloadThresholdMs
// Also full reload means that response would be resubmitted.
export const EMBED_MODAL_IFRAME_FORCE_RELOAD_THRESHOLD_MS = 15 * 60 * 1000; // 15 minutes
// Ensures that prerender instruction would never re-prerender within one minute as long as the link is the same.
export const EMBED_MODAL_PRERENDER_PREVENT_THRESHOLD_MS = 1 * 60 * 1000; // 1 minute

if (EMBED_MODAL_IFRAME_SLOT_STALE_TIME > EMBED_MODAL_IFRAME_FORCE_RELOAD_THRESHOLD_MS) {
  throw new Error(
    "EMBED_MODAL_IFRAME_SLOT_STALE_TIME must be less than EMBED_MODAL_IFRAME_FORCE_RELOAD_THRESHOLD_MS"
  );
}

// These classes are applied to Embed Elements and thus are in the same scope as the embedding webpage.
// So, these classes need to be unique to us, to avoid accidental override
export const EMBED_LIGHT_THEME_CLASS = "cal-element-embed-light";
export const EMBED_DARK_THEME_CLASS = "cal-element-embed-dark";

// ── Inline Embed Constants (EM-001: Calendly initInlineWidget() parity) ──

/** Minimum width in pixels for inline embeds, matching Calendly's `initInlineWidget()` minimum container width requirement. */
export const EMBED_INLINE_MIN_WIDTH = 320;

// ── Modal Styling Constants (EM-002: Calendly initPopupWidget() parity) ──

/** Default modal overlay background color. Extracted from ModalBoxHtml for configurability. */
export const EMBED_MODAL_DEFAULT_OVERLAY_COLOR = "rgb(5, 5, 5, 0.8)";

/** Default close button color for modal embed. Extracted from ModalBoxHtml for configurability. */
export const EMBED_MODAL_DEFAULT_CLOSE_BUTTON_COLOR = "white";
