# Embed & Share Decisions

Architecture Decision Records (ADRs) for Sprint 6: Embed & Share (F-008) of the Calendly gap closure initiative.

Each ADR documents the context, options evaluated, final decision, and consequences for a key architectural trade-off encountered during Sprint 6 implementation.

---

## ADR-001: Three-Package Suite Architecture Preservation vs Consolidation

### Context

The existing Cal.com embed system uses a three-package architecture (`embed-core`, `embed-react`, `embed-snippet`) while Calendly uses a single `widget.js` file. Sprint 6 must achieve behavioral parity with Calendly's embed types while determining whether to preserve the existing modular architecture or consolidate into a single package for simplicity.

The three packages serve distinct roles:
- `embed-core`: Vanilla JS core with iframe bootstrap, custom elements (`cal-inline`, `cal-modal-box`, `cal-floating-button`), and the full embed API including `CalApi` class
- `embed-react`: React wrapper providing a `Cal` component and `useEmbed` hook that delegates to `embed-core`
- `embed-snippet`: Lightweight JS loader with command queue that auto-fetches `embed-core` from CDN

### Options Considered

1. **Preserve three-package architecture** — Keep the existing modular separation and enhance each package independently for parity
   - Pros:
     - Maintains existing architecture that Cal.com developers are familiar with
     - Enables granular dependency management — React applications import only `embed-react`, vanilla JS sites use `embed-snippet`
     - Preserves the lightweight loader advantage — `embed-snippet` is minimal and loads `embed-core` asynchronously
     - First-party React component (`embed-react`) is a documented Cal.com advantage over Calendly's community-maintained `react-calendly`
     - Avoids breaking changes for existing integrators who depend on specific package imports
     - Namespace-based multi-embed isolation is cleanly separated across packages
   - Cons:
     - Three packages to maintain, test, and version
     - Feature changes often require coordinated updates across packages
     - More complex build pipeline via Vite configuration at `packages/embeds/vite.config.js`

2. **Consolidate into single package** — Merge all three packages into a single `@calcom/embed` package similar to Calendly's `widget.js`
   - Pros:
     - Simpler dependency management — one package to install
     - Simplified build pipeline — one Vite configuration
     - Matches Calendly's simpler distribution model
   - Cons:
     - Forces React dependency on vanilla JS consumers (increased bundle size)
     - Breaks existing import paths for all current integrators — a destructive change
     - Loses the lightweight loader advantage — the full bundle must be loaded even for simple embeds
     - Removes the first-party React component advantage

### Decision

**Preserve the three-package architecture.** The modular approach provides documented competitive advantages (first-party React component, lightweight loader, granular dependency management). Consolidation would be a breaking change for existing integrators and would remove Cal.com advantages without providing parity benefits — Calendly's single-file approach is a limitation, not a feature.

### Consequences

- All parity changes in Sprint 6 are distributed across the three packages as appropriate
- `embed-core` receives the bulk of behavioral changes (EM-001, EM-002, EM-003)
- `embed-react` receives React-specific configuration updates (EM-004)
- `embed-snippet` receives share flow improvements for loader initialization (EM-004)
- No existing import paths or APIs are broken
- Each package continues to be independently versioned and published

---

## ADR-002: postMessage Handshake Protocol Alignment with Calendly Embed Lifecycle

### Context

Calendly uses a basic iframe injection without a structured handshake protocol — `widget.js` scans the DOM for `.calendly-inline-widget` elements and creates iframes immediately. Cal.com uses a sophisticated bidirectional postMessage handshake protocol documented in `packages/embeds/LIFECYCLE.md` where the iframe fires `__iframeReady`, the parent acknowledges with `parentKnowsIframeReady`, and the iframe reveals content via `linkReady` or `linkPrerendered`.

Sprint 6 must determine whether to simplify Cal.com's protocol to match Calendly's simpler approach or preserve and enhance the existing protocol for behavioral parity.

### Options Considered

1. **Preserve existing handshake protocol** — Keep the full `__iframeReady` → `parentKnowsIframeReady` → `linkReady` handshake and build parity on top of it
   - Pros:
     - The handshake protocol ensures reliable parent-iframe communication — commands are never lost due to race conditions
     - The command queue system (`iframeDoQueue`) is powered by this handshake — removing it would break queued command execution
     - Prerendering depends on the handshake for the `connect` flow and iframe reuse decisions
     - Existing integrators rely on lifecycle events (`bookerViewed`, `bookerReady`, `linkFailed`) that are part of this protocol
     - 14+ lifecycle events provide superior observability compared to Calendly's limited callback support
   - Cons:
     - More complex than Calendly's approach — new integrators may find the protocol unfamiliar
     - Handshake adds latency compared to Calendly's immediate iframe display (though Cal.com mitigates this with skeleton loaders)

2. **Simplify to Calendly-style immediate iframe display** — Remove the handshake and show the iframe immediately like Calendly
   - Pros:
     - Simpler implementation matching Calendly's approach
     - Potentially faster initial display (no handshake latency)
   - Cons:
     - Destroys command queue system — commands sent before iframe is ready would be lost
     - Removes prerendering capability — iframe reuse decisions require handshake signals
     - Breaks all existing lifecycle event listeners
     - Color scheme auto-detection requires handshake timing to prevent opaque iframe flashes
     - Eliminates Cal.com's significant architectural advantage

### Decision

**Preserve the existing handshake protocol.** The protocol is an architectural advantage, not a liability. Behavioral parity with Calendly is achieved through the embed initialization APIs (`Cal.inline()`, `Cal.modal()`, `Cal.floatingButton()`), not through the underlying communication protocol. The handshake enables features Calendly cannot offer (prerendering, command queuing, lifecycle events), and removing it would be a destructive breaking change.

### Consequences

- The `__iframeReady` → `parentKnowsIframeReady` → `linkReady` handshake sequence remains unchanged
- All 14+ lifecycle events continue to fire with existing semantics
- Command queue system (`iframeDoQueue`) continues to buffer commands until handshake completes
- Prerendering flow (`prepareForPrerender`, `getNextActionForModal`) continues to use handshake signals
- Parity changes focus on the public API surface (`Cal.inline()`, `Cal.modal()`, `Cal.floatingButton()`) and configuration options, not the underlying protocol
- New Calendly-equivalent configuration options (background color, text color, hide event details) are passed through the existing `ui` postMessage command

---

## ADR-003: Iframe Bootstrap Customization Options for Parity

### Context

Calendly's embed customization offers background color, text color, button color (paid plans), hide event details option, button label text (floating button), and branding removal (paid). Cal.com's embed provides full theme control via the `ui` postMessage command (dark/light/auto themes), config-based prefill, and namespace isolation. Sprint 6 must align Cal.com's customization options with Calendly's offering while maintaining Cal.com's existing advantages.

The question is how to expose Calendly-equivalent customization options within Cal.com's embed configuration model.

### Options Considered

1. **Extend existing `ui` command with Calendly-equivalent properties** — Add new properties to the `ui` postMessage command for background color, text color, button color, and hide event details
   - Pros:
     - Leverages the existing `ui` command infrastructure in `embed-core`
     - The `ui` command already persists across iframe resets — new properties inherit this behavior
     - Consistent with existing Cal.com patterns — all styling goes through one channel
     - No new postMessage command types needed
     - Properties are applied immediately via `doInIframe` or queued if iframe is not ready
   - Cons:
     - The `ui` command payload grows larger with each new property
     - Some Calendly customization concepts (hide event details) don't map cleanly to Cal.com's theme system

2. **Create a separate `customization` postMessage command** — Add a new command type specifically for Calendly-parity customization options
   - Pros:
     - Clean separation between Cal.com's native theming (`ui`) and Calendly-parity customization (`customization`)
     - Easier to deprecate or evolve independently
   - Cons:
     - Introduces a new message type that must be handled in the iframe's message listener
     - Splits styling control across two channels — confusing for integrators
     - New command type must be integrated into the command queue system
     - Breaks the principle that all embed styling flows through the `ui` command

### Decision

**Extend the existing `ui` command** with Calendly-equivalent properties. The `ui` command is the established channel for all embed styling and configuration. Adding properties like `hideEventTypeDetails`, `backgroundColor`, `textColor`, and `buttonColor` maintains consistency with the existing architecture. These properties are passed through the embed configuration and converted to `ui` command properties that the iframe processes alongside existing theme settings.

### Consequences

- The `ui` postMessage command payload is extended with optional Calendly-equivalent properties
- New properties: `hideEventTypeDetails` (boolean), `backgroundColor` (string), `textColor` (string), `buttonColor` (string)
- Existing `ui` properties (theme, cssVarsPerTheme, layout, colorScheme) remain unchanged
- Properties persist across iframe resets via the existing `ui` command persistence mechanism
- The embed dialog in `apps/web/modules/embed/` is updated to expose these new customization options in the configuration UI
- Share link generation includes customization parameters in the embed code snippet
- No changes to the postMessage protocol or command queue system
