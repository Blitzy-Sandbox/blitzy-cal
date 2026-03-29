# Embed & Share Design

## Overview

Sprint 6: Embed & Share (F-008) achieves behavioral parity between Cal.com's three-package embed suite and Calendly's embed widget options across inline embeds, modal/popup embeds, floating button embeds, and share flow link generation. This sprint verifies and enhances the three embed packages (`embed-core`, `embed-react`, `embed-snippet`), aligns embed initialization and customization options with Calendly's `initInlineWidget()`, `initPopupWidget()`, and `initBadgeWidget()` methods, and updates share flow link generation across the embed suite and the web application's embed dialog.

Cal.com's embed architecture significantly exceeds Calendly's capabilities. The gap report (`docs/gap-report/embed-share.mdx`) confirms that Cal.com has **no functional gaps** in core embed behavior — all three embed types (inline, modal, floating button) already exist and function correctly. The primary parity work involves aligning customization options, documenting behavioral expectations, enhancing the embed configuration dialog, and ensuring share flow link generation produces Calendly-equivalent embed code snippets.

**Source of truth:** `docs/gap-report/embed-share.mdx`, `packages/embeds/LIFECYCLE.md`, `packages/embeds/README.md`

## Problem Statement

Cal.com's embed system already provides superior architecture compared to Calendly — prerendering, skeleton loaders, 14+ lifecycle events, namespace isolation, first-party React component, and a sophisticated postMessage handshake protocol. However, specific Calendly customization and share flow patterns need alignment:

1. **Embed customization option alignment (EM-001 through EM-003)**: Calendly's embed widgets support configurable background color, text color, button color (paid plans), hide event details option, and button label text. Cal.com's embed configuration must expose equivalent customization options through the `ui` postMessage command and the embed configuration dialog. Each embed type (inline via `cal-inline`, modal via `cal-modal-box`, floating button via `cal-floating-button`) needs customization option parity with its Calendly equivalent (`initInlineWidget()`, `initPopupWidget()`, `initBadgeWidget()`).

2. **Share flow and link generation parity (EM-004)**: The embed dialog in `apps/web/modules/embed/` and link generation across the three-package embed suite must produce embed code snippets and share links that match Calendly's copy-paste workflow for adding embeds to external websites. This includes generating HTML snippets for inline embeds, JavaScript initialization code for modal and floating button embeds, and React component code for React applications.

This sprint encompasses four epics:

| Epic ID | Name | Priority | Complexity |
|---------|------|----------|------------|
| EM-001 | Inline embed behavioral parity | High | S |
| EM-002 | Modal/popup embed parity | High | S |
| EM-003 | Floating button embed parity | High | S |
| EM-004 | Share flow and link generation parity | Medium | M |

**Wave 4 dependency:** Sprint 6 starts only after Sprint 5 (Routing Forms) passes the Wave 3 gate, because routing forms can be embedded via the embed suite and routing prerendering in `embed-core` uses `POST /api/router` to determine target booking links.

## User Stories

- As a website owner, I want to embed an inline Cal.com booking widget on my page using `Cal("inline", {...})` with customization options (background color, text color, hide event details) matching Calendly's inline embed behavior, so that visitors can book appointments without leaving my site.

- As a marketing page creator, I want to add a modal popup booking overlay triggered by a button click using `Cal("modal", {...})` with configuration options matching Calendly's `initPopupWidget()`, so that I can present booking availability without consuming page real estate.

- As a support site operator, I want a floating action button via `Cal("floatingButton", {...})` with configurable button text, color, and position matching Calendly's `initBadgeWidget()`, so visitors can book support sessions from any page.

- As a React developer, I want to use the `@calcom/embed-react` `Cal` component with props matching Calendly's embed customization options, so I can integrate Cal.com booking into my React application with a declarative API.

- As a Cal.com user, I want the embed dialog in Cal.com's web application to generate ready-to-copy embed code snippets for all three embed types, with customization previews, so I can easily add booking embeds to my external website.

## Technical Design

### Database Changes

**No database schema changes are required for Sprint 6.** All embed customization is handled at the client-side embed configuration level through the `ui` postMessage command and embed initialization parameters. The existing embed system operates entirely through client-side JavaScript with iframe-based communication — no server-side state is stored for embed configuration.

**Data Preservation Guarantee:** All existing records in the `Booking`, `EventType`, `User`, and `Team` tables remain intact and unmodified. No migrations are introduced in this sprint.

### API Changes

#### Embed Core API Extensions (EM-001, EM-002, EM-003)

**File:** `packages/embeds/embed-core/src/embed.ts`

Extend the embed initialization API to accept Calendly-equivalent customization options. These options are passed through to the iframe via the existing `ui` postMessage command:

```typescript
// Inline embed with Calendly-equivalent customization
Cal("inline", {
  elementOrSelector: "#my-cal-inline",
  calLink: "organization/event-type",
  config: {
    theme: "dark",
    hideEventTypeDetails: "true",   // NEW: Matches Calendly "hide event details"
    backgroundColor: "#ffffff",      // NEW: Matches Calendly background color
    textColor: "#000000",            // NEW: Matches Calendly text color
    buttonColor: "#0069ff"           // NEW: Matches Calendly button color (CTA)
  }
});

// Modal embed with Calendly-equivalent customization
Cal("modal", {
  calLink: "organization/event-type",
  config: {
    layout: "month_view",
    hideEventTypeDetails: "true",
    backgroundColor: "#ffffff",
    textColor: "#000000",
    buttonColor: "#0069ff"
  }
});

// Floating button with Calendly-equivalent customization
Cal("floatingButton", {
  calLink: "organization/event-type",
  buttonText: "Book meeting",           // EXISTING: Matches Calendly badge text
  buttonPosition: "bottom-right",       // EXISTING: Position configuration
  buttonColor: "#0069ff",               // NEW: Matches Calendly badge color
  buttonTextColor: "#ffffff"            // NEW: Matches Calendly badge text color
});
```

The new customization properties (`hideEventTypeDetails`, `backgroundColor`, `textColor`, `buttonColor`, `buttonTextColor`) are converted to `ui` command properties and sent to the iframe via `doInIframe`. They persist across iframe resets via the existing `ui` command persistence mechanism (the `commandsPersistAcrossIframeResets` array in the `Cal` class includes `"ui"`).

**Existing architecture leveraged:**

- The `CalApi.inline()` method (line ~897 of `embed.ts`) already accepts a `config` parameter of type `PrefillAndIframeAttrsConfig`. New customization properties are passed through this config object as query parameters to the iframe URL via `buildFilteredQueryParams()`.
- The `CalApi.floatingButton()` method (line ~978 of `embed.ts`) already accepts `buttonColor` and `buttonTextColor` parameters. These are stored on the `cal-floating-button` custom element's `dataset` and rendered by the `FloatingButton` component. No changes needed for floating button color configuration — it already has parity.
- The `CalApi.modal()` method (line ~1040 of `embed.ts`) accepts a `config` parameter. New customization properties flow through `withColorScheme()` and into the iframe via `createIframe()`.
- The `withColorScheme()` function auto-detects the parent page's `color-scheme` CSS property. When explicit `backgroundColor` is provided, this auto-detection should not override the explicit value (see Edge Case #2).

**Verification per epic:**

- **EM-001 (Inline):** `Cal("inline", {...})` renders within the target container element via the `cal-inline` custom element, auto-resizes via `__dimensionChanged` event handler, supports all prefill options (`name`, `email`, `notes`, `guests`), and accepts the new customization properties through the config object
- **EM-002 (Modal):** `Cal("modal", {...})` opens an overlay via the `cal-modal-box` custom element, supports prerendering via `Cal("prerender", {...})`, reuses iframes correctly via `getNextActionForModal()` (which returns one of `noAction`, `connect-no-slots-fetch`, `connect`, or `fullReload`), and accepts customization properties
- **EM-003 (Floating button):** `Cal("floatingButton", {...})` displays a persistent floating button via the `cal-floating-button` custom element, opens modal on click, accepts button text/color/position configuration — `buttonColor` and `buttonTextColor` are already implemented and stored on `el.dataset`

#### Embed React Component Extensions (EM-004)

**File:** `packages/embeds/embed-react/src/Cal.tsx`

Update the React `Cal` component's `CalProps` type to include Calendly-equivalent customization options in the `config` prop. The component currently accepts `config?: PrefillAndIframeAttrsConfig` and delegates to `embed-core` via `Cal("inline", { elementOrSelector: element, calLink, config })`. The `PrefillAndIframeAttrsConfig` type (from `@calcom/embed-core`) should be extended to document the new customization properties.

```tsx
import Cal from "@calcom/embed-react";

<Cal
  calLink="organization/event-type"
  namespace="my-booking"
  config={{
    name: "John Doe",
    email: "john@example.com",
    theme: "dark",
    hideEventTypeDetails: "true",
    backgroundColor: "#ffffff",
    textColor: "#000000",
    buttonColor: "#0069ff"
  }}
/>
```

No structural changes are needed to the React component itself — it passes the `config` prop through to `embed-core`'s `Cal("inline", {...})` call. The type definition in `embed-core` must include the new property names.

#### Embed Snippet Passthrough (EM-004)

**File:** `packages/embeds/embed-snippet/src/index.ts`

The `EmbedSnippet` function creates a global `Cal` queue and auto-fetches `embed-core` from CDN. All customization parameters pass through the queue system transparently — the snippet does not filter or transform parameters. No modifications are needed to the snippet itself; it already supports arbitrary config parameters via the command queue.

The snippet's queue mechanism (`cal.q.push(ar)`) ensures that `Cal("inline", { config: { hideEventTypeDetails: "true", ... } })` calls are buffered and replayed once `embed-core` loads, preserving all customization properties.

#### Share Flow Link Generation (EM-004)

**Files:**
- `packages/features/embed/` — Backend embed feature support for share flow
- `apps/web/modules/embed/` — Update embed dialog to generate code snippets with customization options

The embed dialog component in `apps/web/modules/embed/` must be updated to:

1. **Expose customization inputs** for background color, text color, button color, and hide event details
2. **Generate HTML inline embed snippets** with `<div>` container and `<script>` tag following the pattern:
   ```html
   <div id="my-cal-inline" style="width:100%;height:100%;overflow:scroll"></div>
   <script type="text/javascript">
     (function (C, A, L) { /* embed-snippet */ })(window, "https://app.cal.com/embed/embed.js", "init");
     Cal("init", { origin: "https://app.cal.com" });
     Cal("inline", {
       elementOrSelector: "#my-cal-inline",
       calLink: "user/event",
       config: { hideEventTypeDetails: "true", backgroundColor: "#ffffff" }
     });
   </script>
   ```
3. **Generate JavaScript initialization snippets** for modal and floating button
4. **Generate React component code** using `@calcom/embed-react`
5. **Provide a "Copy to clipboard" action** for each snippet type
6. **Preview the embed** with applied customization in the dialog

### UI Changes

#### Embed Configuration Dialog (EM-004)

**Path:** `apps/web/modules/embed/`

The embed dialog components must be updated to expose Calendly-equivalent customization options:

1. **Color pickers**: Background color, text color, button/CTA color inputs for all embed types. These map to the `backgroundColor`, `textColor`, and `buttonColor` config properties passed to `embed-core`.

2. **Toggle: Hide event type details**: Checkbox/toggle to hide avatar, event name, location, and description — matching Calendly's "Hide event type details" option. This maps to the `hideEventTypeDetails: "true"` config property.

3. **Floating button configuration**: Button text input, button position selector (bottom-left, bottom-right), button color, button text color. These map to the existing `buttonText`, `buttonPosition`, `buttonColor`, and `buttonTextColor` parameters of `CalApi.floatingButton()`.

4. **Code snippet tabs**: Tabs for HTML/JavaScript, React, and `embed-snippet` loader code — each tab generates a ready-to-copy code snippet with applied customization. Snippet generation must include the selected customization options in the generated code.

5. **Live preview**: Inline preview of the configured embed (may use a simplified preview rather than full iframe). The preview should reflect color and hide-event-details changes in real time.

No new pages or routes are created — all changes are within the existing embed dialog modal.

## Edge Cases

### 1. CSP (Content Security Policy) Restrictions

Host pages with strict Content Security Policy headers may block the Cal.com iframe or the `embed-core` script. The embed must work correctly when the host page's CSP allows the Cal.com origin (`frame-src`, `script-src`). If the Cal.com origin is not in the CSP allowlist, the embed fails silently or with a clear error message. The `linkFailed` event should fire with an appropriate error code when CSP blocks the iframe load. The existing error handling in `embed.ts` monitors `CalComPageStatus` and fires `linkFailed` on non-200 responses — CSP-blocked loads produce similar failures that should be surfaced through this same mechanism.

### 2. Color Scheme Mismatch with Custom Colors

When a user specifies custom background/text colors via the new customization options AND the embed auto-detects the parent page's `color-scheme` CSS property, the custom colors should take precedence. The `withColorScheme` function in `embed.ts` (line ~153) currently sets `config["ui.color-scheme"]` only when it is not already explicitly configured. This same pattern must be extended to respect explicit `backgroundColor` overrides — if `backgroundColor` is set in config, the auto-detected color scheme should not apply conflicting background styling. The iframe receives both the auto-detected `ui.color-scheme` and the explicit `backgroundColor`; the embedded booking page's CSS must treat explicit color properties as higher priority than theme defaults.

### 3. Multiple Floating Buttons on Same Page

If a developer initializes multiple floating buttons on the same page (potentially in different namespaces), each must operate independently with its own configuration. The `CalApi.floatingButton()` method creates `cal-floating-button` custom elements with `data-cal-namespace` attributes for isolation. Multiple instances with the same position (e.g., both at `bottom-right`) must be handled gracefully — the second button should offset vertically to avoid visual overlap. The `FloatingButton` custom element component should detect sibling floating buttons and apply automatic offset calculations.

### 4. Embed-Snippet Backward Compatibility

Existing integrators using `embed-snippet` with older `embed-core` versions must not break when the snippet sends new customization properties that the older core does not recognize. Unknown properties passed through the config are forwarded as URL query parameters via `buildFilteredQueryParams()`. The iframe's booking page ignores unrecognized query parameters, ensuring forward compatibility. The `iframeDoQueue` command queue and the `ui` postMessage handler in the iframe similarly ignore unknown properties — this is inherently safe.

### 5. Prerendered Modal with Changed Customization

If a modal is prerendered with one set of customization options (e.g., light theme) but the user changes the color scheme before opening, the `getNextActionForModal` function should detect the configuration change and return `connect` rather than `noAction`. The function already compares `previousEmbedConfig` with current `embedConfig` via `isSameEmbedConfig()` (line ~675 of `embed.ts`), which performs a key-by-key comparison of config properties. The new customization properties (`hideEventTypeDetails`, `backgroundColor`, etc.) are automatically included in this comparison because they are part of the `PrefillAndIframeAttrsConfig` object — no additional comparison logic is needed.

### 6. Routing Form Embedded in Floating Button

When a routing form is embedded via a floating button, the user flow is: click button → open modal → fill routing form → route to booking page. The routing prerendering flow (`POST /api/router`) must work correctly within the floating button's modal context. The `CalApi.modal()` method handles routing prerendering via `isRouterPath()` detection and `prepareForPrerender()`. This depends on Sprint 5 (Routing Forms) completing first — hence the Wave 4 dependency. The routing form's response handling pipeline in `packages/features/routing-forms/lib/getRoutedUrl.ts` must produce valid booking URLs that the embedded iframe can navigate to via `history.replaceState`.

### 7. Theme Persistence Across Iframe Resets

The existing `ui` command persistence ensures theme settings survive iframe reloads. In the `Cal` class, `commandsPersistAcrossIframeResets` includes `"ui"`, and `resetQueue()` filters the `iframeDoQueue` to retain only `ui` commands. The new customization properties (`hideEventTypeDetails`, `backgroundColor`, etc.) must also persist across iframe resets. This is inherently handled because these properties are passed through the standard config-to-query-parameter pathway and the `ui` command — no additional persistence logic is needed as long as new properties follow the established command flow.

### 8. Inline Embed Auto-Resize with Custom Background Color

When an inline embed has a custom `backgroundColor` set and the content height changes (triggering `__dimensionChanged`), the iframe's height is adjusted via `iframe.style.height = data.iframeHeight + "px"`. The custom background color must fill the entire iframe viewport including any height adjustments. Since background colors are applied via CSS within the iframe document (not on the iframe element itself), the color fills the entire iframe content area regardless of dimension changes.

## Out of Scope

The following items are explicitly excluded from Sprint 6: Embed & Share:

1. **Platform-specific embed integration guides** (EMB-001) — WordPress, Shopify, Squarespace, Wix, Webflow, Weebly, Joomla guides are documentation-only items not in the EM epic scope. Deferred to `specs/embed-share/future-work.md`.

2. **Pure iframe fallback documentation** (EMB-002) — Documenting a basic `<iframe>` embed approach for restricted platforms is not in the EM epic scope. Deferred to `specs/embed-share/future-work.md`.

3. **Skeleton loader expansion** (EMB-003 through EMB-005) — Extending skeleton loaders to `week_view`/`column_view` layouts, `user.profile`/`team.profile` page types, and creating form-specific skeletons for `*.event.booking.form` page types are Cal.com advantage refinements, not Calendly parity gaps. Deferred to `specs/embed-share/future-work.md`.

4. **ModalBox iframe reuse re-enablement** (EMB-006) — Resolving stale UI issues for ModalBox iframe reuse optimization is a performance enhancement, not a parity requirement. The `CalApi.modal()` method currently does not set `this.modalUid` for non-prerender cases (line ~1231 of `embed.ts`: "Intentionally not setting it to avoid the behaviour of reusing the same modal"). Re-enabling this optimization is deferred to `specs/embed-share/future-work.md`.

5. **Changes to apps/web core application pages** — Beyond the embed dialog in `apps/web/modules/embed/`, no changes to booking flow, authentication, payment pages, or other web app pages are in scope.

6. **Server-side embed state storage** — Embed customization remains client-side only. No database models for storing embed configurations are introduced.

7. **Embed analytics or conversion tracking** — Embed impression tracking, conversion funnels, or analytics dashboards are not in scope. The existing 14+ lifecycle events (`bookerViewed`, `bookerReady`, `linkFailed`, etc.) provide observability but are not extended for analytics aggregation.

8. **Webhook payload modifications** — Existing `v2021-10-20` webhook payloads remain unchanged per the backward compatibility mandate defined in `docs/migration/webhook-compatibility.mdx`.

9. **Third-party embed framework integrations** — Integrations with Angular, Vue, Svelte, or other frontend frameworks are not in scope. Only the existing React wrapper (`@calcom/embed-react`) is enhanced.

10. **Branding removal feature** — Calendly offers branding removal on paid plans. This business model feature is not a behavioral parity gap and is not implemented.
