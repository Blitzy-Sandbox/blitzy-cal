# Embed & Share Prompts

## Sync Implementation Status

Review what's been implemented for embed-share and update specs/embed-share/implementation.md

Specifically check progress on:

- **EM-001**: Inline embed behavioral parity — `packages/embeds/embed-core/src/embed.ts` `Cal.inline()` and `cal-inline` custom element alignment with Calendly `initInlineWidget()` behavior. Verify container element rendering, auto-resize via `__dimensionChanged` event, prefill support (name, email, notes, guests), theme configuration via `ui` command, and Calendly-equivalent customization options (backgroundColor, textColor, hideEventTypeDetails)
- **EM-002**: Modal/popup embed parity — `packages/embeds/embed-core/src/embed.ts` `Cal.modal()` and `cal-modal-box` custom element alignment with Calendly `initPopupWidget()` behavior. Verify overlay display on trigger, prerendering via `Cal("prerender", {...})`, iframe reuse decisions via `getNextActionForModal` (noAction, connect-no-slots-fetch, connect, fullReload), and Calendly-equivalent customization options (backgroundColor, textColor, buttonColor)
- **EM-003**: Floating button embed parity — `packages/embeds/embed-core/src/embed.ts` `Cal.floatingButton()` and `cal-floating-button` custom element alignment with Calendly `initBadgeWidget()` behavior. Verify button text, button color, button text color, button position (bottom-left, bottom-right), and modal trigger on click
- **EM-004**: Share flow and link generation parity — `packages/embeds/embed-react/src/Cal.tsx` React component config prop updates, `packages/embeds/embed-snippet/src/index.ts` loader parameter passthrough, `packages/features/embed/` backend embed feature support, `apps/web/modules/embed/` embed dialog configuration UI and code snippet generation for all three embed types (HTML inline, JavaScript modal/floating button, React component)

## Generate Tests

Write tests for embed behavioral parity across inline, modal, and floating button embed types. Follow existing test patterns in `packages/embeds/embed-core/src/__tests__/` and `packages/embeds/embed-core/src/embed.test.ts`.

Target test files to create or extend:

- `packages/embeds/embed-core/test/embed-parity.test.ts` — Inline, modal, and floating button behavioral parity tests (EM-001 through EM-003)
- `packages/embeds/embed-core/src/__tests__/embed-iframe.test.ts` — Extend with embed lifecycle handshake tests verifying postMessage protocol backward compatibility
- `packages/embeds/embed-core/src/__tests__/embed-iframe-methods.test.ts` — Extend with customization option passthrough tests
- `packages/embeds/embed-react/test/Cal.parity.test.tsx` — React component integration tests for `@calcom/embed-react` Cal component with Calendly-equivalent config props

Test coverage areas:

- Inline embed renders correctly within host page container element via `Cal("inline", { elementOrSelector, calLink, config })`
- Modal embed opens overlay on trigger via `Cal("modal", { calLink, config })`
- Floating button displays persistent button and opens modal on click via `Cal("floatingButton", { calLink, buttonText, buttonPosition })`
- Prefill support for name, email, notes, guests, and custom fields across all embed types
- Auto-resize via `__dimensionChanged` event adjusts iframe height without host page scrollbars
- Prerendered modal displays within 100ms of CTA click (no network wait) — AC-EMB-06
- Skeleton loader displays within 50ms of embed initialization for supported page types — AC-EMB-07
- Command queue ensures zero commands lost when API calls precede iframe readiness — AC-EMB-08
- postMessage handshake (`__iframeReady` → `parentKnowsIframeReady` → `linkReady`) completes reliably across Chrome, Firefox, Safari, Edge — AC-EMB-09
- Multiple embeds on the same page operate independently via namespace isolation (`Cal.ns.myNamespace(...)`) — AC-EMB-10
- Each namespace maintains separate command queues, event listeners, and iframe references — AC-EMB-11
- Event tracking: `bookerViewed` fires on first embed display (not during prerendering) — AC-EMB-12
- Event tracking: `bookerReady` fires only when slots are fully loaded and selectable — AC-EMB-13
- Event tracking: `linkFailed` fires with error code on page load failure — AC-EMB-14
- Tracking events suppressed during prerendering phase — AC-EMB-15
- Embed functions correctly when loaded via embed-snippet on static HTML pages — AC-EMB-16
- React component integrates correctly in Next.js, Remix, and Vite React applications — AC-EMB-17
- Embed functions with Content Security Policy (CSP) headers allowing the Cal.com origin — AC-EMB-18
- Calendly-equivalent customization options (backgroundColor, textColor, buttonColor, hideEventTypeDetails) are passed through to iframe via `ui` command
- Color scheme auto-detection via `getColorScheme()` respects explicit color overrides — custom colors take precedence over auto-detected scheme

## Code Review

Review changes for:

- **Type safety**: Strict TypeScript types for all embed configuration options, prefill data, postMessage payloads, and custom element attributes. No `any` type escapes.
- **Error handling**: Graceful degradation on iframe load failures (`linkFailed` event with error code), CSP blocking, network timeouts, and invalid configuration values. Silent error handling for unknown properties in postMessage payloads.
- **Security**: CSP header compatibility for Cal.com origin (`frame-src`, `script-src`), postMessage origin validation using `originator: "CAL"` identifier, no credential or user data leakage through embed parameters.
- **Edge cases**: Multiple floating buttons on the same page with position conflicts, prerendered modal with changed customization options, color scheme mismatch with custom colors, embed-snippet backward compatibility with older embed-core versions, routing form embedded in floating button context.

Embed-specific review items:

- **postMessage protocol backward compatibility**: The existing handshake sequence (`__iframeReady` → `parentKnowsIframeReady` → `linkReady`/`linkPrerendered`) must remain unchanged. All 14+ lifecycle events must continue to fire with existing semantics. The `originator: "CAL"` message identifier must not be modified.
- **Custom element registration**: `cal-inline`, `cal-modal-box`, `cal-floating-button` custom elements must maintain backward-compatible initialization APIs. `Cal("inline", {...})`, `Cal("modal", {...})`, and `Cal("floatingButton", {...})` must accept existing parameters without destructive changes.
- **embed-snippet backward compatibility**: The command queue system (`iframeDoQueue`), `EmbedSnippet()` function, `GlobalCal` object, and namespace coordinator (`Cal.ns`) must continue to work for existing integrators. Commands issued before `embed-core` loads must be queued and executed in order.
- **Vite bundling**: Build configuration at `packages/embeds/vite.config.js` must not break. Environment variables `EMBED_PUBLIC_WEBAPP_URL` and `EMBED_PUBLIC_EMBED_LIB_URL` must be preserved.
- **CSP header compatibility**: Embed must function correctly when host page CSP allows the Cal.com origin. Clear error reporting via `linkFailed` when CSP blocks iframe load.
- **Cross-browser compatibility**: Verify postMessage handshake and embed rendering across Chrome, Firefox, Safari, and Edge. Custom element registration and Shadow DOM behavior must be consistent.
- **Prerendering flow integrity**: `prepareForPrerender`, `getNextActionForModal`, and the `connect` flow must remain functional. New customization options must be included in iframe reuse configuration comparison logic.
- **`ui` command persistence**: New customization properties (hideEventTypeDetails, backgroundColor, textColor, buttonColor) must persist across iframe resets via the existing `ui` command persistence mechanism.
- **Zero-downtime compliance**: No database schema changes in Sprint 6. All changes are client-side only.
- **Webhook payload backward compatibility**: Existing `v2021-10-20` webhook payloads for `BOOKING_CREATED`, `BOOKING_CANCELLED`, and `BOOKING_RESCHEDULED` events remain unchanged — bookings through embeds use the same payload pipeline.

## Continue Feature

Continue working on embed-share. Read specs/embed-share/implementation.md for current status.

Key directories to reference:

- `packages/embeds/embed-core/src/` — Core embed runtime: `embed.ts` (Cal class, CalApi class, custom elements `cal-inline`, `cal-modal-box`, `cal-floating-button`), action manager, message constants
- `packages/embeds/embed-react/src/` — React wrapper: `Cal.tsx` (Cal component with `useEmbed` hook, namespace support, PrefillAndIframeAttrsConfig types)
- `packages/embeds/embed-snippet/src/` — Lightweight JS loader: `index.ts` (EmbedSnippet function, command queue, namespace coordinator, GlobalCal object)
- `packages/embeds/LIFECYCLE.md` — postMessage handshake protocol documentation (handshake sequence, event details, prerendering flow, command queue system)
- `packages/embeds/README.md` — Architecture and usage documentation (three-package suite, embedding methods, prerendering vs preloading, skeleton loaders, routing prerendering)
- `packages/embeds/vite.config.js` — Vite build configuration for embed packages
- `packages/features/embed/` — Backend embed feature support
- `apps/web/modules/embed/` — Frontend embed dialog and button components (configuration UI for generating embed code)
- `specs/embed-share/design.md` — Design specification (source of truth for Sprint 6 scope and technical approach)
- `specs/embed-share/decisions.md` — Architecture Decision Records (ADR-001: three-package preservation, ADR-002: handshake protocol preservation, ADR-003: ui command customization)
- `docs/gap-report/embed-share.mdx` — Gap analysis with feature comparison matrix, gap inventory (EMB-001 through EMB-006), and acceptance criteria (AC-EMB-01 through AC-EMB-18)
- `docs/sprint-roadmap/validation-criteria.mdx` — Validation criteria for embed domain (EM-VAL)

## Generate Docs with Screenshots

Generate documentation for embed-share with screenshots:

1. Open the embed configuration dialog in the browser (navigate to an event type's embed settings via the Cal.com web application at `apps/web/modules/embed/`)
2. Take screenshots of key UI states:
   - Inline embed configuration options — container element selector, theme selection, customization (background color, text color, hide event details)
   - Modal/popup embed configuration options — trigger button, layout selection, customization options
   - Floating button embed configuration options — button text, button color, button text color, button position (bottom-left, bottom-right)
   - Share link generation dialog — generated HTML snippet for inline embed, JavaScript snippet for modal and floating button, React component code for `@calcom/embed-react`, copy-to-clipboard actions
3. Save screenshots to `specs/embed-share/docs/screenshots/`
4. Create/update `specs/embed-share/docs/README.md` with:
   - Feature overview: Sprint 6 Embed & Share covering inline, modal, and floating button embed behavioral parity plus share flow and link generation across the three-package embed suite (`embed-core`, `embed-react`, `embed-snippet`)
   - How to use: Configuring each embed type (inline via `Cal("inline", {...})`, modal via `Cal("modal", {...})`, floating button via `Cal("floatingButton", {...})`), customizing appearance, generating share links, React integration via `@calcom/embed-react`
   - Configuration options: background color, text color, button color, hide event details, theme (dark/light/auto), layout (month_view), button text, button position, prefill (name, email, notes, guests), namespace isolation
   - Common use cases: Embedding on marketing pages (inline), SPA React integrations (embed-react Cal component), floating action button for support sites (floating button), modal popup from CTA buttons (modal with prerendering)

## Promote Docs to Public

Promote internal docs to public Mintlify docs:

1. Review `specs/embed-share/docs/README.md` for completeness and accuracy
2. Copy/adapt content to `docs/embed-share.mdx` — rewrite for external audience
3. Move screenshots to `docs/images/embed-share/`
4. Update `docs/docs.json` navigation to include the new embed and share page
5. Ensure customer-appropriate language:
   - Remove internal implementation details (custom element class names, postMessage protocol internals, CalApi class references, Prisma schema references)
   - Focus on user-facing functionality (embedding booking widgets, customizing appearance, generating share links, React integration)
   - Use consistent terminology matching Cal.com's public documentation style
   - Omit references to Calendly parity or gap closure — present features as Cal.com capabilities
   - Omit references to internal sprint identifiers (EM-001, F-008) and gap report IDs (EMB-001 through EMB-006)
