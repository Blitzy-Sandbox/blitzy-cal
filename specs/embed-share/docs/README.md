# Embed & Share

## Overview

Sprint 6: Embed & Share (F-008) achieves behavioral parity between Cal.com's three-package embed suite and Calendly's embed widget options — `initInlineWidget()`, `initPopupWidget()`, and `initBadgeWidget()`. This feature encompasses four epics: inline embed parity (EM-001), modal/popup embed parity (EM-002), floating button embed parity (EM-003), and share flow and link generation parity (EM-004). Cal.com's embed architecture is built on a modular three-package design: `embed-core` (vanilla JS runtime with iframe bootstrap and custom elements), `embed-react` (first-party React wrapper component with `Cal` and `useEmbed` hook), and `embed-snippet` (lightweight JS loader with command queue). While Cal.com's embed capabilities already exceed Calendly's — offering prerendering, skeleton loaders, namespace isolation, and a structured postMessage handshake protocol — specific customization options and share flow link generation require alignment for full parity.

## How to Use

### Step 1: Configure and Embed an Inline Booking Widget

Use `Cal("inline", { elementOrSelector: "#my-cal-inline", calLink: "user/event-type" })` to embed a fully functional booking widget directly within your page. The `elementOrSelector` parameter targets a container `<div>` on the host page, and the `calLink` parameter points to the user or team event-type URL. Customize the appearance through the `config` object: set `hideEventTypeDetails: true` to hide the avatar, event name, location, and description; apply `backgroundColor` and `textColor` for brand-consistent color customization; and choose a `theme` of `light`, `dark`, or `auto` (which auto-detects the host page's CSS `color-scheme` property). Inline embeds automatically resize to fit their content height via the `__dimensionChanged` postMessage event, eliminating the need for manual height management.

![Step 1 Screenshot](./screenshots/step-1.png)

*Screenshot: Navigate to the Embed dialog's Inline tab to see the inline embed configuration with customization options. Capture and save as `./screenshots/step-1.png`.*

### Step 2: Generate and Customize Embed Code

Open the embed dialog in Cal.com — accessible from event type settings or the share button — to generate ready-to-copy code snippets for any of three embed types: Inline (an HTML `<div>` container with a `<script>` tag), Modal/Popup (a JavaScript trigger that opens a booking overlay), or Floating Button (a persistent floating action button anchored to the page corner). The dialog provides a live preview reflecting your selected customization options including background color, text color, button color, and the hide event details toggle. All generated snippets use the `@calcom/embed-snippet` loader under the hood, which queues commands before the core library loads to prevent race conditions. For React applications, install the `@calcom/embed-react` package and use the `Cal` component with `calLink`, `namespace`, and `config` props for a declarative integration.

![Step 2 Screenshot](./screenshots/step-2.png)

*Screenshot: View the embed code generation dialog showing customization preview and copy-to-clipboard options for inline, modal, and floating button embed types. Capture and save as `./screenshots/step-2.png`.*

## Configuration Options

| Option | Description | Default |
|--------|-------------|---------|
| `hideEventTypeDetails` | When set to `true`, hides the avatar, event name, location, and description within the embedded booking page. Useful for minimal embed appearances where event context is provided by the host page. Passed via the `config` object on embed initialization. | `false` |
| `backgroundColor` | Sets a custom background color for the embedded iframe content, overriding the default theme background. Accepts CSS color values (hex, RGB, named colors). When set, takes precedence over auto-detected `color-scheme` from the parent page. | `inherit from theme` |
| `textColor` | Sets a custom text color for the embedded iframe content. Accepts CSS color values. Applied to primary text elements within the booking page iframe. | `inherit from theme` |
| `buttonColor` | Sets a custom color for CTA/primary buttons within the embedded booking page. Matches Calendly's button color customization available on paid plans. | `inherit from theme` |
| `buttonText` | Label text displayed on the floating button embed. Only applicable to `Cal("floatingButton", {...})` initialization. | `"Book a meeting"` |
| `buttonPosition` | Position of the floating button on the page. Only applicable to `Cal("floatingButton", {...})` initialization. Accepts `bottom-left` or `bottom-right`. | `bottom-right` |
| `theme` | Sets the embed theme for the booking page inside the iframe. Accepts `light`, `dark`, or `auto`. When set to `auto`, the embed auto-detects the host page's `color-scheme` CSS property via `getColorScheme()` and applies the matching theme. | `auto` |
| `layout` | Sets the booking page layout displayed inside the embed. Accepts `month_view`, `week_view`, or `column_view`. Determines how available time slots are presented to the booker. | responsive (determined by container size) |

## Common Use Cases

### Marketing Landing Page with Inline Embed

Embed a Cal.com booking widget directly in a marketing or landing page using the HTML snippet from the embed dialog. Place a `<div id="booking-widget">` container on your page and initialize with `Cal("inline", { elementOrSelector: "#booking-widget", calLink: "team/discovery-call" })`. The inline embed auto-resizes to fit the booking page content, providing a seamless native feel without manual height configuration. Set `backgroundColor` and `textColor` to match your marketing page's brand identity, and use `hideEventTypeDetails: true` when the surrounding page already provides the event context, yielding a clean minimal booking interface.

### SPA with Floating Button

Add a persistent floating booking button to a React or Next.js single-page application using `@calcom/embed-react`. Import the `Cal` component and pass the `calLink` prop targeting your event type. Configure `buttonText`, `buttonColor`, and `buttonPosition` to align with your brand guidelines. The floating button opens a modal overlay when clicked, keeping the user's place in the application without a full-page navigation. For non-React SPAs, use `Cal("floatingButton", { calLink: "user/consultation", buttonText: "Schedule a Call", buttonPosition: "bottom-right" })` from `@calcom/embed-snippet` for the same behavior.

## FAQ

### How do I embed Cal.com on my website?

Use the embed dialog in Cal.com (accessible from event type settings) to generate a ready-to-copy code snippet for inline, modal, or floating button embeds. Alternatively, install the `@calcom/embed-snippet` package for the lightweight JS loader approach: add the script tag to your page and call `Cal("inline", {...})`, `Cal("modal", {...})`, or `Cal("floatingButton", {...})` to initialize the desired embed type. For React applications, install `@calcom/embed-react` and use the `Cal` component with the `calLink` and `config` props. All three approaches use the same underlying `@calcom/embed-core` runtime, ensuring consistent behavior regardless of integration method.

### Can I customize the appearance of the embed?

Yes — configure `backgroundColor`, `textColor`, `buttonColor`, and `theme` through the embed configuration options to match your site's look and feel. Set `hideEventTypeDetails` to `true` to hide the avatar, event name, location, and description for a minimal appearance. For floating button embeds, configure `buttonText`, `buttonColor`, and `buttonPosition` for complete brand alignment. Customization options can be set in the embed dialog UI (which provides a live preview of changes) or programmatically via the `config` object in your embed initialization call. The `theme` option supports `light`, `dark`, or `auto` — when set to `auto`, the embed detects the host page's CSS `color-scheme` property and applies the matching theme automatically.
