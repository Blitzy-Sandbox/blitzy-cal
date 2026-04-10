# Cal.com Embed Lifecycle Events

This document details the lifecycle events and states of Cal.com embeds, showing the interaction flow between the parent page and the iframe.

## Embed Handshake (Core Communication)

The handshake is the foundational communication protocol that establishes a bi-directional channel between the parent page and the iframe. All other embed functionality depends on this handshake being completed successfully.

See [embed-handshake.mermaid](./embed-handshake.mermaid) for the detailed handshake sequence.
See [embed-message-protocol.mermaid](./embed-message-protocol.mermaid) for the message passing architecture.

### Handshake Summary

1. **Parent creates iframe** (hidden) with embed parameters
2. **Iframe fires `__iframeReady`** via postMessage when ready to receive commands
3. **Parent acknowledges** by sending `parentKnowsIframeReady` back to iframe
4. **Iframe makes body visible** and fires `linkReady` (or `linkPrerendered`)
5. **Parent flushes queued commands** that were called before handshake completed

### Message Format

All messages use the `originator: "CAL"` identifier to distinguish Cal.com embed messages:

```javascript
// Parent → Iframe (Commands)
{ originator: "CAL", method: "ui", arg: { theme: "dark" } }

// Iframe → Parent (Events)
{ originator: "CAL", type: "__iframeReady", data: { isPrerendering: false } }
```

## Inline Embed Lifecycle

Inline embeds are created immediately when `Cal.inline()` is called. They have a simpler lifecycle without prerendering support.

See [inline-embed-lifecycle.mermaid](./inline-embed-lifecycle.mermaid) for the complete sequence diagram.

### Calendly Parity: `initInlineWidget()` Alignment (EM-001)

Cal.com's `Cal("inline", { ... })` method provides behavioral parity with Calendly's `Calendly.initInlineWidget()`. Both embed the scheduling page directly within the host page flow using an iframe, but Cal.com additionally supports preloading, command queuing, namespace isolation, and a structured `postMessage` handshake.

**Configuration via the `ui` Command**

Inline embeds accept customization through the `ui` command, which is sent to the iframe via `postMessage`. The following configuration keys are supported for styling parity with Calendly's inline widget customization options:

| Config Key | Type | Description |
|------------|------|-------------|
| `styles.body.background` | `string` | Background color of the embed body. Corresponds to Calendly's background color customization. |
| `styles.eventTypeListItem.color` | `string` | Text color for event type list items. Corresponds to Calendly's text color option. |
| `styles.eventTypeListItem.backgroundColor` | `string` | Background color for event type list items. |
| `styles.enabledDateButton.color` | `string` | Text color for enabled (selectable) date buttons. |
| `styles.enabledDateButton.backgroundColor` | `string` | Background color for enabled date buttons. |
| `styles.availabilityDatePicker.backgroundColor` | `string` | Background color for the date picker area. |
| `hideEventTypeDetails` | `boolean` | When `true`, hides the event type avatar, name, location, and description — equivalent to Calendly's "hide event type details" option. |
| `theme` | `"dark" \| "light" \| "auto"` | Color theme. `"auto"` follows the parent page's `color-scheme` CSS property. |
| `cssVarsPerTheme` | `Record<Theme, Record<string, string>>` | Per-theme CSS custom property overrides for granular branding control. |

Example with Calendly-equivalent customization:

```javascript
Cal("inline", {
  elementOrSelector: "#my-cal-inline",
  calLink: "organization/event-type",
  config: { theme: "light" }
});
Cal("ui", {
  hideEventTypeDetails: true,
  styles: {
    body: { background: "#ffffff" },
    eventTypeListItem: { color: "#333333", backgroundColor: "#f5f5f5" },
    enabledDateButton: { color: "#ffffff", backgroundColor: "#0069ff" }
  }
});
```

**Iframe Sizing Behavior**

Inline embeds follow responsive sizing rules aligned with Calendly's minimum width requirement:

- **Minimum width:** The container element should enforce a minimum width of **320px** to ensure the scheduling interface remains usable, matching Calendly's inline widget minimum (`min-width:320px`). Cal.com sets the iframe to `width:100%` and `height:100%` of the container, so the container element controls the minimum dimensions.
- **Dynamic height adjustment:** The iframe height is automatically adjusted via `__dimensionChanged` events fired from the embedded page whenever content size changes. The parent listens for these events and sets the iframe's `height` style accordingly, preventing unnecessary scrollbars within the iframe.
- **Initial dimensions:** The iframe starts at `width:100%; height:100%` of the containing element. Once the embedded page renders and reports its content dimensions, the height is adjusted to fit the content.

**Scroll Handling**

Inline embeds implement scroll coordination between the iframe and the parent page:

- **`__scrollByDistance` event:** When the embedded page needs to scroll content into view (e.g., after navigating to a time slot or a booking form section), it fires a `__scrollByDistance` event. The parent locates the nearest scrollable ancestor of the inline embed element and scrolls it by the requested pixel distance using `scrollTo({ behavior: "smooth" })`. This event is only handled for inline embeds — modal embeds scroll within their own iframe.
- **`__routeChanged` auto-scroll:** When the embedded page navigates internally (e.g., from date selection to the booking form), the parent checks whether more than 25% of the inline embed is hidden above the viewport. If so, it calls `scrollIntoView({ behavior: "smooth" })` on the inline element to bring it back into view.

## Modal Embed Lifecycle

Modal embeds are created when a CTA is clicked or `Cal.modal()` is called. They support reuse, state management, and prerendering.

See [modal-embed-lifecycle.mermaid](./modal-embed-lifecycle.mermaid) for the complete sequence diagram.

### Calendly Parity: `initPopupWidget()` Alignment (EM-002)

Cal.com's `Cal("modal", { ... })` method provides behavioral parity with Calendly's `Calendly.initPopupWidget()`. Both open the scheduling page in a popup overlay on top of the host page. Cal.com's modal uses the `cal-modal-box` Web Component, which provides a richer lifecycle including prerendering, iframe reuse, and multiple dismissal mechanisms that exceed Calendly's popup capabilities.

**Popup-to-Modal Behavioral Mapping**

| Calendly Popup | Cal.com Modal | Notes |
|---------------|---------------|-------|
| `Calendly.initPopupWidget({ url })` | `Cal("modal", { calLink })` | Both open an overlay with the scheduling page |
| `Calendly.closePopupWidget()` | Modal closes via Escape key, backdrop click, or close button | Cal.com provides three dismissal methods vs. Calendly's single API call |
| No reuse — fresh iframe each open | Prerendered iframe reuse with `connect` flow | Cal.com advantage: near-instant reopening via prerendered iframe |
| Static popup overlay | State-managed modal (`loading`, `loaded`, `closed`, `reopened`, `prerendering`, `failed`, `has-message`) | Cal.com tracks modal state transitions for reliability |

**Modal Overlay Styling Options**

The modal overlay can be customized through the `ui` command, providing equivalent functionality to Calendly's popup customization options:

| Config Key | Type | Description |
|------------|------|-------------|
| `styles.body.background` | `string` | Background color of the modal content area. Corresponds to Calendly's background color option. |
| `styles.eventTypeListItem.color` | `string` | Text color for event type list items. Corresponds to Calendly's text color option. |
| `styles.enabledDateButton.backgroundColor` | `string` | Button color for selectable dates. Corresponds to Calendly's button color (paid plan) option. |
| `hideEventTypeDetails` | `boolean` | Hides event avatar, name, location, and description. Same behavior as the inline embed option. |
| `theme` | `"dark" \| "light" \| "auto"` | Color theme applied to the modal content. |
| `layout` | `"month_view" \| "week_view" \| "column_view"` | Initial booker layout within the modal. |

Example with Calendly-equivalent customization:

```javascript
Cal("modal", {
  calLink: "organization/event-type",
  config: { theme: "dark", layout: "month_view" }
});
Cal("ui", {
  hideEventTypeDetails: false,
  styles: {
    body: { background: "#1a1a2e" },
    enabledDateButton: { backgroundColor: "#0069ff", color: "#ffffff" }
  }
});
```

**Close Button and Dismissal Lifecycle**

The `cal-modal-box` custom element supports three methods to dismiss the modal, providing more flexibility than Calendly's `closePopupWidget()` API:

1. **Close button (×):** Clicking the close button in the modal overlay calls `explicitClose()`, which hides the modal and fires a `close` DOM event. This always works regardless of the current modal state.
2. **Escape key:** Pressing the `Escape` key calls `close()`, which hides the modal only if it is not currently in the `loading` or message-display (`has-message`, `failed`) state. This prevents accidental dismissal during loading.
3. **Backdrop click:** Clicking outside the iframe (on the overlay backdrop) also calls `close()` with the same guard logic as the Escape key — the modal won't dismiss while loading or showing a message.

After closing, a prerendered modal remains in the DOM with its iframe intact. On the next CTA click, the modal can be reopened immediately (state transitions to `reopened`) or reconnected with updated configuration, depending on the iframe reuse decision logic.

**`hideEventTypeDetails` Configuration**

The `hideEventTypeDetails` option works identically in modal embeds as in inline embeds. When set to `true` via the `ui` command, it removes the event type avatar, name, location, and description from the booking page rendered inside the modal. This is equivalent to Calendly's "hide event type details" toggle available on paid plans.

## Modal Prerendering Flow

Prerendering allows loading the booking page in the background before the user opens the modal, enabling instant display when the CTA is clicked.

See [modal-prerendering-flow.mermaid](./modal-prerendering-flow.mermaid) for the complete sequence diagram.

## Visibility Flow

The embed system carefully manages visibility to prevent visual glitches:

1. **Initial Creation**: Both iframe and body start hidden while the page loads
2. **After Communication Established**: iframe becomes visible once it's ready to communicate
3. **After Content Ready**: Loader is removed and iframe is fully visible
4. **After Parent Acknowledges**: Body content becomes visible, background stays transparent

### Inline Embed Visibility (EM-001)

Inline embeds follow the core visibility flow above with the following specifics:

- The `cal-inline` custom element renders a loader (skeleton or spinner) inside its Shadow DOM immediately on creation.
- The iframe is created with `visibility: hidden` and appended to the `cal-inline` element.
- When `__iframeReady` fires, the iframe's `visibility` is reset to its default (effectively visible), but the loader may still be displayed until `linkReady` fires.
- On `linkReady`, the loader is hidden and the slot content inside the Shadow DOM becomes fully visible.
- If the page load fails (non-200 status), the `loading` attribute transitions to `"failed"`, the loader is hidden, the slot is hidden, and an error message is displayed.
- The auto-detected `color-scheme` of the parent page is applied to the iframe's config to prevent opaque background flashes between light and dark mode containers.

### Modal Embed Visibility (EM-002)

Modal embeds have a more complex visibility flow due to their overlay nature and prerendering support:

- **Loading state:** The `cal-modal-box` custom element is made visible (via `open()`) and shows a loader. The iframe is present in the layout but invisible (`visibility: hidden`) until content is ready.
- **Loaded state:** The loader is hidden, the message element is hidden, and the iframe is made fully visible. The modal is then opened for user interaction.
- **Closed state:** The modal host element is hidden (`visibility: hidden`), but the iframe remains in the DOM for potential reuse. The page's original `overflow` style is restored so the host page is scrollable again.
- **Prerendering state:** The entire `cal-modal-box` host element is hidden via `explicitClose()`. Neither the loader nor the iframe is visible to the user. The embed loads silently in the background.
- **Reopened state:** The modal is simply shown again (`open()`), displaying whatever content was previously loaded in the iframe. No loader is displayed for reopens.
- **Failed/has-message state:** The loader is hidden, the iframe is collapsed (removed from layout), and a message element is displayed with error details.

## Event Details

1. **Initial Load**
   - embed.js loads in parent page
   - For inline embeds: Creates elements immediately
   - For modal embeds: Waits for CTA click (unless prerendering)

2. **iframe Creation**
   - iframe is created hidden
   - Loader is shown to the user
   - Embed system initializes

3. **__iframeReady Event**
   - Fired by: Iframe
   - Indicates: Embed is ready to receive messages from parent
   - Actions: Makes iframe visible (unless prerendering) and processes any queued commands

4. **__dimensionChanged Event**
   - Fired by: Iframe
   - Purpose: Keeps iframe size matched to content
   - Triggers: When content size changes or page finishes loading
   - Note: Parent adjusts iframe dimensions to prevent scrollbars

5. **__windowLoadComplete Event**
   - Fired by: Iframe
   - Indicates: Page has fully loaded
   - Purpose: Signals that dimension calculations are reliable

6. **linkReady Event**
   - Fired by: Iframe
   - Indicates: iframe content is fully ready for user interaction
   - Requirements: Content height is known, and for booker pages, slots are loaded (if skeleton loader is used)
   - Actions: Parent removes loader and makes iframe visible

7. **parentKnowsIframeReady Event**
   - Fired by: Parent
   - Indicates: Parent acknowledges that iframe is ready
   - Actions: Makes body content visible
   - Note: During prerendering, this triggers linkPrerendered event instead

8. **__connectInitiated Event**
   - Fired by: Iframe
   - Indicates: Prerendered embed is being connected with new configuration
   - Triggers: When connect() is called to activate a prerendered embed

9. **__connectCompleted Event**
   - Fired by: Iframe
   - Indicates: Connect flow has finished updating the embed
   - Triggers: After URL params are updated and slots are ready (if needed)

10. **linkPrerendered Event**
    - Fired by: Iframe
    - Indicates: Prerendered embed is ready in the background
    - Note: Embed stays hidden until user opens it via connect()

11. **bookerViewed Event**
    - Fired by: Iframe
    - Indicates: Booker has been viewed for the first time in current page view
    - Triggers: On first linkReady event (viewId === 1)
    - Note: Not fired during prerendering. Includes event information and slots loading status.

12. **bookerReopened Event**
    - Fired by: Iframe
    - Indicates: Booker has been reopened after modal was closed
    - Triggers: On subsequent linkReady events (viewId > 1) when modal is reopened without reload
    - Note: Distinguishes between first view (bookerViewed) and reopen (bookerReopened). Uses viewId to determine if it's a reopen.
    - Applicability: Only applicable for prerendered modals that are now visible.

13. **bookerReloaded Event**
    - Fired by: Iframe
    - Indicates: Booker has been reloaded (full page reload within modal)
    - Triggers: On linkReady after fullReload action is taken (when reloadInitiated flag is set)
    - Note: Distinguishes between first view (bookerViewed), reopen (bookerReopened), and reload (bookerReloaded). Fires only once per reload.
    - Applicability: Only applicable for prerendered modals that are now visible.

14. **bookerReady Event**
    - Fired by: Iframe
    - Indicates: Booker view is loaded and slots are fully ready for user interaction
    - Triggers: When booker view is loaded and slots are successfully loaded
    - Note: Only fires for booker pages (not booking success view or other non-booker pages). This is different from linkReady which fires for any embed page. The bookerReady event signals that users can now select a slot.

15. **__scrollByDistance Event**
    - Fired by: Iframe
    - Purpose: Requests the parent page to scroll by a specified pixel distance
    - Data: `{ distance: number }` — the number of pixels to scroll (positive = down, negative = up)
    - Actions: Parent locates the nearest scrollable ancestor of the inline embed and calls `scrollTo()` with `behavior: "smooth"`
    - Applicability: Only processed for inline embeds. Modal embeds scroll within their own iframe, so this event is ignored with a console warning if received for a non-inline embed.

16. **__routeChanged Event**
    - Fired by: Iframe
    - Indicates: Internal navigation occurred within the embedded page (e.g., from date selection to booking form)
    - Actions: For inline embeds, the parent checks if more than 25% of the embed element is hidden above the viewport. If so, it scrolls the element into view with `scrollIntoView({ behavior: "smooth" })`.
    - Note: This event is primarily relevant for inline embeds where the embed is part of the page flow and can scroll off-screen during internal navigation.

17. **linkFailed Event**
    - Fired by: Iframe
    - Indicates: The embedded page failed to load (non-200 HTTP status)
    - Data: Includes error code and URL information
    - Actions: For inline embeds, the `cal-inline` element transitions to `loading="failed"` state and displays an error message. For modal embeds, the `cal-modal-box` transitions to `state="failed"` and shows the error in a message container while collapsing the iframe.

## Prerendering Flow

Prerendering loads the booking page in the background before the user needs it:

1. **Prerender Phase**:
   - Embed is loaded with `prerender=true` parameter
   - Only essential events are allowed (communication and sizing)
   - Embed stays hidden from the user
   - No tracking events are fired

2. **Connect Phase** (when user opens the modal):
   - Parent calls `connect()` with user's configuration
   - URL parameters are updated to match user's input
   - Slots may be refreshed if needed
   - Embed becomes visible and ready for interaction
   - Full event tracking is enabled

## Command Queue System

The embed system queues commands sent before the iframe is ready. Once the iframe is ready, all queued commands are processed in order, and new commands execute immediately.

### How Command Queuing Works

```
┌──────────────────────────────────────────────────────────────┐
│                     doInIframe(cmd)                          │
└─────────────────────────┬────────────────────────────────────┘
                          │
                          ▼
                ┌─────────────────────┐
                │   iframeReady?      │
                └─────────┬───────────┘
                          │
           ┌──────────────┼──────────────┐
           │ No           │              │ Yes
           ▼              │              ▼
   ┌───────────────┐      │      ┌───────────────┐
   │ Push to queue │      │      │ postMessage   │
   │ (iframeDoQueue)│     │      │ to iframe     │
   └───────────────┘      │      └───────────────┘
                          │
                          │ On __iframeReady event:
                          ▼
                ┌─────────────────────┐
                │ Flush queue:        │
                │ forEach → postMessage│
                │ Clear queue         │
                └─────────────────────┘
```

### Available Commands (Parent → Iframe)

| Method | Purpose | Example |
|--------|---------|---------|
| `ui` | Apply styles, theme, branding, and layout configuration | `{ method: "ui", arg: { theme: "dark", hideEventTypeDetails: true } }` |
| `parentKnowsIframeReady` | Acknowledge handshake | `{ method: "parentKnowsIframeReady" }` |
| `connect` | Activate prerendered embed | `{ method: "connect", arg: { config, params } }` |

#### `ui` Command Configuration Reference (EM-001, EM-002)

The `ui` command accepts a `UiConfig` object with the following properties. These provide Calendly-equivalent customization capabilities for both inline and modal embeds:

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `theme` | `"dark" \| "light" \| "auto" \| null` | `null` | Color theme. `"auto"` follows system preference. Corresponds to Calendly's overall theme selection. |
| `hideEventTypeDetails` | `boolean` | `false` | Hides event avatar, name, location, and description. Equivalent to Calendly's "Hide Event Type Details" option. |
| `styles` | `EmbedStyles & EmbedNonStylesConfig` | `undefined` | Granular style overrides for embed elements (see below). |
| `cssVarsPerTheme` | `Record<"dark" \| "light", Record<string, string>>` | `undefined` | Per-theme CSS custom property overrides for advanced branding control. |
| `layout` | `"month_view" \| "week_view" \| "column_view"` | `undefined` | Initial booker layout. |
| `colorScheme` | `string \| null` | `null` | Explicit color scheme override. Normally auto-detected from the parent page. |
| `disableAutoScroll` | `boolean` | `false` | Disables automatic scroll-into-view behavior for route changes within the embed. |
| `useSlotsViewOnSmallScreen` | `boolean` | `false` | Forces the slots view on small screen sizes instead of the default mobile layout. |

**`styles` Object Structure:**

| Style Target | Supported Properties | Calendly Equivalent |
|-------------|---------------------|---------------------|
| `body` | `background` | Background color |
| `eventTypeListItem` | `background`, `color`, `backgroundColor` | Text color |
| `enabledDateButton` | `background`, `color`, `backgroundColor` | Button color (selectable dates) |
| `disabledDateButton` | `background`, `color`, `backgroundColor` | — (not customizable in Calendly) |
| `availabilityDatePicker` | `background`, `color`, `backgroundColor` | — (not customizable in Calendly) |

**`styles` Non-Style Properties:**

| Property | Type | Description |
|----------|------|-------------|
| `align` | `"left"` | Aligns the booking widget to the left instead of the default center alignment. |
| `branding.brandColor` | `string` | Primary brand color applied across the embed UI. |

The `ui` command persists across iframe resets — if the iframe reloads due to staleness or a full reload, any previously applied `ui` configuration is automatically reapplied to the new iframe instance.

**Example — Full Customization:**

```javascript
Cal("ui", {
  theme: "light",
  hideEventTypeDetails: true,
  layout: "month_view",
  styles: {
    body: { background: "#ffffff" },
    eventTypeListItem: { color: "#1a1a2e", backgroundColor: "#f0f0f0" },
    enabledDateButton: { backgroundColor: "#0069ff", color: "#ffffff" },
    availabilityDatePicker: { backgroundColor: "#fafafa" }
  },
  cssVarsPerTheme: {
    light: { "--cal-brand-color": "#0069ff" },
    dark: { "--cal-brand-color": "#4d9fff" }
  }
});
```

## Popup Window Analogy

Think of the embed like `window.open("url", "cal-booker")` with a hypothetical enhancement - when you close the popup, it stays in the background ready to spring back:

- **`bookerViewed`** = Opening a new popup window (first time, or after previous was destroyed due to staleness)
- **`bookerReopened`** = Clicking CTA that targets the same window name, bringing back the hidden popup
- **`bookerReloaded`** = Popup window navigating to a new URL (full page reload within the same popup)
- **Staleness/full reload** = When the popup was actually destroyed (not just hidden), so CTA opens a fresh one

This mental model helps understand the lifecycle:
1. User clicks CTA → Embed modal opens → `bookerViewed` event (similar to opening a new popup)
2. User closes modal and clicks CTA again (short time) → Existing embed springs back → `bookerReopened` event (similar to focusing a hidden popup)
3. User clicks CTA after long time → Embed was destroyed due to staleness → Fresh load → `bookerViewed` event (similar to opening a new popup after the old one was closed)
4. Modal stays open but iframe content reloads (fullReload) → `bookerReloaded` event (similar to popup navigating to new URL)

## Event Tracking System

The embed system tracks user interactions and page views:

- **Page View Tracking**: Distinguishes between first view and refocus events when users navigate within the embed
- **Booker View Events**: Fires when the booker is viewed for the first time or focused
- **Availability Events**: Tracks when slots/availability data is loaded or refreshed
- **Event Deduplication**: Prevents duplicate events for the same page view
- **Prerendering**: Tracking events are suppressed during prerendering phase

## Error Handling

Page Load Errors:
   - System monitors CalComPageStatus
   - On non-200 status: fires linkFailed event
   - Includes error code and URL information
