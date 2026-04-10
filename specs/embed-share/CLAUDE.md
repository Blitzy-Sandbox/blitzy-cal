# CLAUDE.md — Embed & Share

## Project Context

Sprint 6: Embed & Share (F-008) of the Calendly gap closure initiative. This sprint closes embed behavioral parity gaps across inline, modal, and floating button embed types, plus share flow and link generation alignment with Calendly. It encompasses 4 epics (EM-001 through EM-004) and is Wave 4 — it depends on Sprint 5 (Routing Forms) completing the Wave 3 gate before any Sprint 6 work can begin. Sprint 5 is a direct dependency because routing forms can be embedded via the embed suite, and routing prerendering in `embed-core` uses `POST /api/router` to determine target booking links.

## Before Starting Work

1. Read `specs/embed-share/design.md`
2. Check `specs/embed-share/implementation.md` for current progress
3. Look at existing patterns in these relevant directories:
   - `packages/embeds/embed-core/src/` — Core embed runtime: `embed.ts` (Cal class, CalApi class, custom elements `cal-inline`, `cal-modal-box`, `cal-floating-button`), action manager, message constants
   - `packages/embeds/embed-react/src/` — React wrapper: `Cal.tsx` (Cal component with `useEmbed` hook, namespace support, PrefillAndIframeAttrsConfig types)
   - `packages/embeds/embed-snippet/src/` — Lightweight JS loader: `index.ts` (EmbedSnippet function, command queue, namespace coordinator, GlobalCal object)
   - `packages/embeds/LIFECYCLE.md` — postMessage handshake protocol documentation (handshake sequence, event details, prerendering flow, command queue system)
   - `packages/embeds/README.md` — Architecture and usage documentation (three-package suite, embedding methods, prerendering vs preloading, skeleton loaders, routing prerendering)
   - `packages/embeds/vite.config.js` — Vite build configuration for embed packages
   - `packages/features/embed/` — Backend embed feature support
   - `apps/web/modules/embed/` — Frontend embed dialog and button components (configuration UI for generating embed code)
   - `docs/gap-report/embed-share.mdx` — Embed suite gap analysis (feature comparison matrix, gap inventory EMB-001 through EMB-006, acceptance criteria AC-EMB-01 through AC-EMB-18)
   - `docs/sprint-roadmap/` — Sprint roadmap, epic catalog, validation criteria
   - `docs/migration/zero-downtime-strategy.mdx` — Migration safety patterns (if any schema changes needed)

## Code Patterns

Key patterns to follow and reference implementations:

- **Three-package embed suite architecture**: `embed-core` provides the vanilla JS runtime, `embed-react` wraps it for React consumers, `embed-snippet` provides the lightweight loader. Changes flow from `embed-core` outward.
- **Custom element pattern**: Embed types are registered as custom HTML elements: `cal-inline`, `cal-modal-box`, `cal-floating-button` via `customElements.define()` in `embed-core/src/embed.ts`. Each element manages its own iframe lifecycle.
- **postMessage handshake protocol**: All parent-iframe communication uses structured postMessage with `originator: "CAL"` identifier. Handshake sequence: iframe fires `__iframeReady` → parent sends `parentKnowsIframeReady` → iframe fires `linkReady` or `linkPrerendered`. Commands queue in `iframeDoQueue` until handshake completes.
- **Command queue pattern**: `embed-snippet` creates a global `Cal` queue so commands issued before `embed-core` loads are not lost. The queue drains when `embed-core` initializes via `processQueue`.
- **Vite bundling**: Embed packages are built with Vite using the configuration at `packages/embeds/vite.config.js`. Environment variables `EMBED_PUBLIC_WEBAPP_URL` and `EMBED_PUBLIC_EMBED_LIB_URL` control embed script URLs.
- **Namespace-based isolation**: Multiple embeds per page use `Cal.ns.myNamespace(...)` for isolated command queues, event listeners, and iframe references.
- **Prerendering pattern**: `Cal("prerender", {...})` creates a hidden iframe that loads the booking page in background. On CTA click, `getNextActionForModal` evaluates `noAction`, `connect-no-slots-fetch`, `connect`, or `fullReload` based on config/staleness.
- **Embed lifecycle events**: 14+ events (`bookerViewed`, `bookerReady`, `linkFailed`, etc.) fire through `SdkActionManager`. Events are suppressed during prerendering. Tracking via `CalApi.on()`/`CalApi.off()`.
- **Color scheme detection**: `getColorScheme()` inspects parent page's `color-scheme` CSS property; `withColorScheme()` auto-injects it into embed `ui` configuration to prevent opaque iframe backgrounds.
- **Test patterns**: Vitest for unit/integration tests, Playwright 1.57.0 for E2E tests following existing patterns.
- **PR discipline**: Maximum 5-7 files changed (excluding tests), maximum 500 lines per PR, one focused change per PR.

## Don't

- Don't add features not in design.md
- Don't skip tests
- Don't break the existing postMessage handshake protocol — the `__iframeReady` → `parentKnowsIframeReady` → `linkReady` sequence must remain unchanged
- Don't modify existing embed initialization APIs destructively — `Cal("inline", {...})`, `Cal("modal", {...})`, `Cal("floatingButton", {...})` must remain backward-compatible
- Don't break embed-snippet backward compatibility — the command queue, `EmbedSnippet()` function, and `GlobalCal` object must continue to work for existing integrators
- Don't remove or rename any existing postMessage event types — all 14+ lifecycle events must continue to fire with existing semantics
- Don't modify the `originator: "CAL"` message identifier used in postMessage communication
- Don't break the prerendering flow — `prepareForPrerender`, `getNextActionForModal`, and `connect` flow must remain functional
- Don't exceed 5-7 files changed (excluding tests) or 500 lines per PR
- Don't combine changes across epics (EM-001 through EM-004) in a single PR — each PR should focus on one epic or one cohesive aspect
