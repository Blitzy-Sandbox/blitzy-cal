# Embeds

This folder contains all the various flavours of embeds.

`core` contains the core library written in vanilla JS that manages the embed.
`snippet` contains the Vanilla JS Code Snippet that can be installed on any website and would automatically fetch the `core` library.

Please see the respective folder READMEs for details on them.

## Publishing to NPM. It will soon be automated using changesets github action

To publish the packages. Following steps should be followed. All commands are to be run at the root.

1. `yarn changeset` -> Creates changelog files and adds summary to changelog. Select embed packages only here.
2. `yarn changeset version` -> Bumps the versions as required
3. Get the PR reviewed and merged
4. `yarn publish-embed` -> Releases all packages. We can't use `yarn changeset publish` because it doesn't support workspace: prefix removal yet. See https://github.com/changesets/changesets/issues/432#issuecomment-1016365428

## Skeleton Loader

Skeleton loader is shown for supported page types. For all other page types, default non-skeleton loader is shown.
Status:
- Layout
  - [x] Responsive
  - [x] Mobile Layout
  - [x] month_view Layout
  - [ ] week_view Layout
  - [ ] column_view Layout
- Theming
  - [x] Dark and Light theme
      NOTE: _If user has preference for theme configured within app, that has to be communicated clearly in the embed too for skeleton to work_
  - [x] Change in system theme should reflect without page refresh
- Page Types supported
  - [x] user.event.booking.slots
  - [x] team.event.booking.slots
  - [x] [Partially supported] user.event.booking.form - Shows skeleton but of the slots page
  - [x] [Partially supported] team.event.booking.form - Shows skeleton but of the slots page
  - [ ] user.profile
  - [ ] team.profile


 
## How Routing Prerendering works
- Use API to prerender a booking link for "modal"
- When CTA is clicked by user, we check if there is a "prerendered"/"being prerendered" modal for this namespace.
- If yes, we open up the modal showing the skeleton loader and send the POST request to /api/router endpoint
- When we get the response from the endpoint, we pass on all the query params to the already rendered/being rendered iframe and embed-iframe updates the URL of the iframe to have the new query params through history.replaceState(i.e. without reloading the page)


## Prerendering vs Preloading
- Preloading loads the calLink in iframe with the sole purpose of preloading the static assets, so that when the embed actually opens, it uses the static assets from browser cache.
- Prerendering means continuing over the preloaded iframe, so that the user books on the prerendered iframe only. So, it is much more complex than preloading and gives much more benefits in terms of performance.
Note: API wise `prerender` delegates its task to `preload` API which then identifies whether to preload or prerender.


## Modalbox re-opening performance optimization
- ModalBox supports reusing the same cal-modal-box element and thus same iframe and thus providing a lightning fast experience when the same modal is opened multiple times [This feature is currently disabled in code because of stale booking page UI issues]

## Embed Core Architecture and Features

### Architecture Overview

The embed suite is designed to achieve **Calendly behavioral parity and beyond**, matching the core embedding capabilities of Calendly's `initInlineWidget()`, `initPopupWidget()`, and `initBadgeWidget()` methods while providing significant architectural advantages such as prerendering, skeleton loaders, namespace isolation, and structured postMessage communication.

#### Three-Package Architecture

The embed system is delivered through three complementary packages that form the complete embed and share flow pipeline:

- **`embed-core`** — Vanilla JS core providing the embed API, custom elements (`cal-inline`, `cal-modal-box`, `cal-floating-button`), iframe lifecycle management, and the parent-iframe communication protocol. This is the engine that powers all embedding methods.
- **`embed-react`** — First-party React wrapper providing a declarative `Cal` component and `useEmbed` hook. Delegates to `embed-core` under the hood while integrating with React lifecycle management.
- **`embed-snippet`** — Lightweight JS loader snippet for external websites. Auto-fetches `embed-core` from CDN, creates the global `Cal` queue, and ensures commands execute in order even before the core library loads.

#### Initialization and Bootstrap Process
The embed system initializes through a multi-step process:
1. The embed script is loaded on the parent page
2. It creates a global `Cal` object that acts as the entry point
3. The system initializes necessary custom elements (`cal-modal-box`, `cal-floating-button`, `cal-inline`)
4. A namespace-based action manager is created for event handling

#### Custom Element Capabilities

Each embedding method is backed by a custom HTML element with specific configuration properties:

| Custom Element | Embedding Method | Key Configuration Props |
|----------------|-----------------|------------------------|
| `cal-inline` | `Cal("inline", {...})` | `calLink`, `config` (theme, layout, hideEventTypeDetails, prefill fields) |
| `cal-modal-box` | `Cal("modal", {...})` | `calLink`, `config` (theme, layout, hideEventTypeDetails), prerender/connect support |
| `cal-floating-button` | `Cal("floatingButton", {...})` | `calLink`, `buttonText`, `buttonColor`, `buttonTextColor`, `buttonPosition`, `hideButtonIcon` |

#### Action Manager and Event System

The `SdkActionManager` tracks embed lifecycle events and dispatches them to registered listeners. Parity-relevant actions include:

- **`__dimensionChanged`** — Fired when embed content size changes; the parent page auto-adjusts the iframe height (equivalent to Calendly's auto-resize behavior for JS-based embeds)
- **`bookerViewed`** / **`bookerReady`** — Lifecycle tracking events for analytics integration
- **`linkReady`** / **`linkFailed`** — Embed load success/failure indicators for error handling
- **`__scrollByDistance`** — Scroll coordination between iframe content and parent page

#### Share Flow Architecture

The embed suite integrates with Cal.com's share flow system to generate embeddable code and shareable booking links:

- **Backend support** (`packages/features/embed/`) provides server-side embed feature logic, including embed code generation and link construction
- **Frontend embed dialog** (`apps/web/modules/embed/`) provides the UI for configuring and generating embed code snippets, direct booking links, and shareable URLs
- All three packages participate in the share flow: `embed-snippet` provides the loader code, `embed-core` provides the runtime API calls, and `embed-react` provides the React component code

#### Parent-Iframe Communication System
Communication between the parent page and the embedded iframe uses a message-based system:

```typescript
// Parent to Iframe communication example
interface InterfaceWithParent {
  ui: (config: UiConfig) => void;
  connect: (config: PrefillAndIframeAttrsConfig) => void;
}

// Event data structure
type EventData<T> = {
  type: string;
  namespace: string;
  fullType: string;
  data: EventDataMap[T];
};
```

The system uses namespaced events to ensure multiple embeds on the same page don't interfere with each other.

#### Instruction Queue System
Commands are queued before the iframe is ready:

```typescript
type Instruction = SingleInstruction | SingleInstruction[];
type InstructionQueue = Instruction[];

// Commands are queued if iframe isn't ready
if (!this.iframeReady) {
  this.iframeDoQueue.push(doInIframeArg);
  return;
}
```

### Embedding Methods

#### Inline Embedding
Embeds the calendar directly within the page flow using the `cal-inline` custom element. This is the Cal.com equivalent of Calendly's `Calendly.initInlineWidget()` method.

**Basic usage:**
```typescript
Cal("inline", {
  elementOrSelector: "#my-cal-inline",
  calLink: "organization/event-type"
});
```

**Calendly-parity configuration options:**

The inline embed supports all styling and behavioral options that align with Calendly's inline widget capabilities:

```typescript
Cal("inline", {
  elementOrSelector: "#my-cal-inline",
  calLink: "organization/event-type",
  config: {
    theme: "dark",                           // "dark" | "light" | "auto"
    layout: "month_view",                    // "month_view" | "week_view" | "column_view"
    hideEventTypeDetails: "true",            // Hides avatar, event name, location, description (mirrors Calendly's "hide event type details" setting)
    useSlotsViewOnSmallScreen: "true",       // Optimized mobile experience
    name: "John Doe",                        // Prefill attendee name
    email: "john@example.com",               // Prefill attendee email
  }
});
```

**Container requirements:**

- **Minimum width:** The container element should have a minimum width of 320px for a usable booking experience, matching Calendly's inline widget constraint. The iframe is set to `width: 100%` and `height: 100%` of the container.
- **Dynamic height:** The embed automatically adjusts its height via the `__dimensionChanged` postMessage event. As the user navigates through booking steps, the iframe communicates its content height to the parent page, which adjusts the container accordingly.
- **Scroll handling:** The container element has its scrollbar hidden via CSS (`::-webkit-scrollbar { display: none }` and `scrollbar-width: none`). Scroll coordination between the iframe content and the parent page is managed through the `__scrollByDistance` event, which requests the parent page to scroll by a specified distance when the iframe content needs to bring elements into view.

#### Modal Embedding
Creates a modal dialog overlay with the calendar using the `cal-modal-box` custom element. This is the Cal.com equivalent of Calendly's `Calendly.initPopupWidget()` method.

**Basic usage:**
```typescript
Cal("modal", {
  calLink: "organization/event-type",
  config: {
    // Optional configuration
    useSlotsViewOnSmallScreen: "true"
  }
});
```

**Calendly-parity configuration options:**

The modal embed supports styling and behavioral customization that aligns with Calendly's popup widget:

```typescript
Cal("modal", {
  calLink: "organization/event-type",
  config: {
    theme: "dark",                           // "dark" | "light" | "auto"
    layout: "month_view",                    // "month_view" | "week_view" | "column_view"
    hideEventTypeDetails: "true",            // Hides avatar, event name, location, description
    useSlotsViewOnSmallScreen: "true",       // Optimized mobile experience
    name: "Jane Smith",                      // Prefill attendee name
    email: "jane@example.com",               // Prefill attendee email
  }
});
```

**Modal styling customization:**

Visual appearance of the modal can be controlled through the `ui` command, which supports custom styles for the embed body background, date picker colors, and event type list items. Additionally, the `branding.brandColor` option allows setting a custom brand color. The modal overlay itself uses the `cal-modal-box` custom element which can be themed via the `theme` config prop.

**Modal close behavior:**

The modal can be closed by the user clicking outside the modal content area or by pressing the Escape key. When the modal is closed, the `cal-modal-box` element remains in the DOM for potential reuse (see "Modalbox re-opening performance optimization" above). The `bookerReopened` event fires when a previously closed modal is reopened.

**Declarative trigger (alternative to programmatic API):**

Instead of calling `Cal("modal", {...})` directly, you can attach a modal trigger to any HTML element using `data-cal-link`:

```html
<button data-cal-link="organization/event-type" data-cal-config='{"theme":"dark"}'>
  Book a Call
</button>
```

#### FloatingButton Embedding
Adds a floating action button that opens the calendar in a modal. It uses modal embedding under the hood via the `cal-floating-button` custom element. This is the Cal.com equivalent of Calendly's `Calendly.initBadgeWidget()` method.

**Basic usage:**
```typescript
Cal("floatingButton", {
  calLink: "organization/event-type",
  buttonText: "Book meeting",
  buttonPosition: "bottom-right"
});
```

**Calendly-parity configuration options:**

The floating button supports all configurable properties that match Calendly's badge widget capabilities:

```typescript
Cal("floatingButton", {
  calLink: "organization/event-type",
  buttonText: "Book my Cal",                 // Button label text (default: "Book my Cal")
  buttonColor: "rgb(0, 0, 0)",              // Button background color (default: black)
  buttonTextColor: "rgb(255, 255, 255)",     // Button text color (default: white)
  buttonPosition: "bottom-right",            // "bottom-right" | "bottom-left" (default: "bottom-right")
  hideButtonIcon: false,                     // Hide the calendar icon on the button (default: false)
  attributes: { id: "my-floating-btn" },     // Optional DOM attributes for the button element
  calOrigin: "https://app.cal.com",          // Optional custom Cal.com origin
  config: {
    theme: "dark",                           // Theme for the modal that opens on click
    hideEventTypeDetails: "true",            // Hides event details in the opened modal
    layout: "month_view",                    // Layout for the opened modal
  }
});
```

**Relationship to modal embedding:**

The floating button is a persistent UI trigger that creates and opens a `cal-modal-box` when clicked. The `config` prop passed to `floatingButton()` is forwarded to the underlying modal. Prerendering can be used alongside the floating button — when the user clicks the button, the prerendered modal displays instantly without network wait. The floating button element persists across modal open/close cycles and is appended to `document.body`.

### Configuration and Customization

#### Embed Configuration Reference

All embed methods (`inline`, `modal`, `floatingButton`) accept a `config` object with the following configuration keys. These options provide parity with Calendly's customization capabilities (background color, text color, button color, hide event details) and extend well beyond them.

| Config Key | Type | Default | Applies To | Description |
|------------|------|---------|------------|-------------|
| `theme` | `"dark" \| "light" \| "auto"` | Auto-detected | All embeds | Color theme for the embedded booking page. `"auto"` follows the parent page's `color-scheme` CSS property. |
| `hideEventTypeDetails` | `"true" \| "false"` | `"false"` | All embeds | Hides the event type avatar, name, location, and description. Mirrors Calendly's "hide event type details" paid-plan option. |
| `layout` | `"month_view" \| "week_view" \| "column_view"` | `"month_view"` | All embeds | Booker layout for the date/time selection view. |
| `useSlotsViewOnSmallScreen` | `"true" \| "false"` | `"false"` | All embeds | Shows an optimized slots-only view on mobile/small screens. |
| `name` | `string` | — | All embeds | Prefill the attendee's full name. |
| `email` | `string` | — | All embeds | Prefill the attendee's email address. |
| `notes` | `string` | — | All embeds | Prefill the booking notes field. |
| `guests` | `string[]` | — | All embeds | Prefill guest email addresses. |
| `iframeAttrs.id` | `string` | — | All embeds | Set a custom DOM `id` on the embed iframe for identification. |
| `flag.coep` | `"true" \| "false"` | — | All embeds | Cross-Origin Embedder Policy flag. |
| `ui.color-scheme` | `string` | Auto-detected | All embeds | Explicitly set the color-scheme for the iframe to prevent opaque background mismatches. |
| `ui.autoscroll` | `"true" \| "false"` | — | All embeds | Control auto-scroll behavior when navigating within the embed. |

**Styling via the `ui` instruction:**

In addition to config-level customization, the embed supports runtime styling through the `ui` instruction. This enables Calendly-equivalent color customization and branding:

```typescript
Cal("ui", {
  theme: "dark",
  hideEventTypeDetails: true,
  styles: {
    body: { background: "#1a1a2e" },
    eventTypeListItem: { background: "#16213e", color: "#e94560", backgroundColor: "#16213e" },
    enabledDateButton: { background: "#0f3460", color: "#ffffff", backgroundColor: "#0f3460" },
    disabledDateButton: { background: "#1a1a2e", color: "#666666" },
    availabilityDatePicker: { background: "#16213e", color: "#ffffff" },
    branding: { brandColor: "#e94560" },
  },
  cssVarsPerTheme: {
    dark: { "--cal-brand-color": "#e94560" },
    light: { "--cal-brand-color": "#0f3460" },
  }
});
```

The `ui` command persists across iframe resets, ensuring that theme and styling configuration is automatically reapplied when the iframe reloads.

#### Prefill System
Allows pre-filling form fields (equivalent to Calendly's `prefill` option with `name`, `email`, and `customAnswers`):
```typescript
Cal("inline", {
  elementOrSelector: "#my-cal-inline",
  calLink: "organization/event-type",
  config: {
    name: "John Doe",
    email: "john@example.com",
    notes: "Initial discussion",
    guests: ["guest1@example.com", "guest2@example.com"],
    useSlotsViewOnSmallScreen: "true"
  }
});
```

Cal.com's prefill system supports `name`, `email`, `notes`, and `guests` natively. This exceeds Calendly's prefill which is limited to `name`, `email`, and 10 custom answer fields (`a1`–`a10`). Cal.com also supports forwarding all query parameters (including UTM parameters) from the parent page to the iframe — see "Query Parameter Handling" below.

#### Query Parameter Handling
The system allows automatically forwarding query params to the iframe, by setting. This code must be present right after the embed snippet is added to the page.
```js
Cal.config = Cal.config || {};
Cal.config.forwardQueryParams=true
```

When enabled, all query parameters from the parent page URL (including UTM parameters like `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`) are automatically forwarded to the embedded iframe. This provides parity with Calendly's dedicated `utm` object in its JS initialization, but with a more flexible approach that forwards _all_ query parameters rather than only a predefined set.

#### Enabling Logging
You can enable logging for the embed by adding the `cal.embed.logging=1` query parameter to the URL of the page where the embed is placed. This is useful for debugging issues with the embed. It will log all important things in parent as well as in the iframe(i.e. child)

For example, if your page is `https.example.com/contact`, you can enable logging by visiting `https.example.com/contact?cal.embed.logging=1`.

### Advanced Features

#### Routing Prerendering System
The prerendering system optimizes the initial load:
```typescript
Cal("prerender", {
  calLink,
  type: "modal"
});
```

Key aspects:

- Creates a hidden iframe
- Loads the booking page but doesn't send the slots availability request
- Tries to reuse whenever it makes sense and do a fresh load otherwise

Modal's Iframe Reuse and Reload Conditions. There could be four situations:

1. Show modal as is. No connect and no requests happen - Corresponding action is "noAction"
2. Connect but don't fetch the slots- Corresponding action is "connect-no-slots-fetch"
3. Connect and fetch the slots - Corresponding action is "connect"
4. Do a fresh load in iframe. Corresponding action is "fullReload"

- **Show modal as is**:
  - Modal is not in a failed state
  - config, params are same as the last time
  - No time threshold violations

- **Connect but don't fetch the slots**:
  - Only embed `config` changes (handled via "connect" flow)
  - Query query params changes (handled via "connect" flow)
  - Crossed slots stale time threshold (EMBED_MODAL_IFRAME_SLOT_STALE_TIME)

- **Connect and fetch the slots**:
  - Slots are stale
  - Crossed slots stale time threshold (EMBED_MODAL_IFRAME_SLOT_STALE_TIME)

- **Do a fresh load in iframe**:
  - Different path being loaded(i.e. /pro vs /free)
  - Modal is in a failed state
  - Time since last render exceeds EMBED_MODAL_IFRAME_FORCE_RELOAD_THRESHOLD_MS


### Share Flow and Link Generation

The embed suite integrates with Cal.com's share flow system to provide multiple ways of distributing booking pages. The share flow spans all three packages and connects to the backend embed feature service and frontend embed dialog components.

#### Direct Booking Links

The simplest share method is a direct booking link in the format `https://app.cal.com/{user}/{event-type}`. These links can be shared via email, messaging, or social media. When opened in a browser, they render the full booking page. When used as a `calLink` parameter in the embed API, they render within the embed iframe.

#### Embed Code Generation

The embed dialog (located at `apps/web/modules/embed/`) provides a UI for generating ready-to-use embed code snippets for all three embedding methods:

- **Inline embed code** — Generates an HTML container `<div>` with the `embed-snippet` loader script and a `Cal("inline", {...})` call configured with the user's selected options (theme, layout, hideEventTypeDetails, prefill data).
- **Modal embed code** — Generates a trigger button with `data-cal-link` attribute and the `embed-snippet` loader, enabling one-click modal opening.
- **Floating button embed code** — Generates the `embed-snippet` loader with a `Cal("floatingButton", {...})` call using the user's configured button text, colors, and position.

The embed dialog supports previewing the embed before copying the code, allowing users to customize appearance and behavior before deployment.

#### Shareable URLs

Shareable URLs include query parameters for pre-configuration, allowing link creators to share pre-filled booking links:

```
https://app.cal.com/organization/event-type?name=John&email=john@example.com&theme=dark
```

When `Cal.config.forwardQueryParams = true` is set in the embed snippet, these parameters are automatically forwarded into the embedded iframe.

#### Routing Form Embed Integration

Routing forms can be embedded using the same embed methods. When a routing form is embedded, the system uses the routing prerendering flow to determine the target booking page:

1. The embed loads with a routing form `calLink` (e.g., `router?formId=123&field1=value1`)
2. A `POST /api/router` request evaluates the routing rules and determines the target event type
3. The iframe navigates to the resolved booking page via `history.replaceState` without a full reload

This enables organizations to embed a single routing form that dynamically directs visitors to the appropriate booking page based on their answers.

#### Package Responsibilities in Share Flow

| Package | Share Flow Role |
|---------|----------------|
| `embed-snippet` (`packages/embeds/embed-snippet/`) | Provides the lightweight loader code included in generated embed snippets. Ensures the global `Cal` queue is available before `embed-core` loads. |
| `embed-core` (`packages/embeds/embed-core/`) | Provides the runtime API (`Cal("inline", ...)`, `Cal("modal", ...)`, `Cal("floatingButton", ...)`) that the generated embed code calls. Manages iframe creation, communication, and lifecycle. |
| `embed-react` (`packages/embeds/embed-react/`) | Provides the `<Cal />` React component for applications using React. The embed dialog generates React component code as an alternative to vanilla JS snippets. |
| Backend (`packages/features/embed/`) | Server-side embed feature support including link construction and embed configuration validation. |
| Frontend (`apps/web/modules/embed/`) | Embed dialog UI for configuring and generating embed code, preview functionality, and share link generation. |

#### Prerendering headless router

**Without namespace:**
Prerender when there are high chances of user clicking the CTA.
```js
Cal('prerender', {
  calLink: "router?formId=123&ONLY_THOSE_FIELDS_THAT_ARE_REQUIRED_BY_ROUTING_RULES_SHOULD_BE_PRESENT_HERE",
  // Prerender right now works only with "modal", so 'element click' embed is able to reuse this prerendered iframe
  type: "modal",
  // Shows skeleton loader for a Team Event's booking slots page
  pageType: "team.event.booking.slots"
});
```
Using the prerendered iframe with a CTA:
```js
<button data-cal-link="router?formId=123&ALL_FIELDS_HERE">Demo</button>
```

**With namespace:**
Prerender when there are high changes of user clicking the CTA.
```js
Cal.ns.myNamespace('prerender', {
  calLink: "router?formId=123&ONLY_THOSE_FIELDS_THAT_ARE_REQUIRED_BY_ROUTING_RULES_SHOULD_BE_PRESENT_HERE",
  // Prerender right now works only with "modal", so 'element click' embed is able to reuse this prerendered iframe
  type: "modal"
  // Shows skeleton loader for a Team Event's booking slots page
  pageType: "team.event.booking.slots"
});
```
Using the prerendered iframe with a CTA:
```js
<button data-cal-namespace="myNamespace" data-cal-link="router?formId=123&ALL_FIELDS_HERE">Demo</button>
```
