# Embed & Share Implementation

## Status: not-started

## Completed

## In Progress

## Blocked

- Waiting for Sprint 5 (Routing Forms) Wave 3 gate to pass — Sprint 6 is Wave 4 and cannot start until Wave 3 completes
- Waiting for Sprint 4 (Webhooks) and Sprint 7 (Admin & Teams) Wave 3 gate to pass — all Wave 3 sprints must pass validation before Wave 4 begins

## Next Steps

1. Read and internalize `specs/embed-share/design.md` and `docs/gap-report/embed-share.mdx`
2. Review existing embed architecture in `packages/embeds/embed-core/src/embed.ts`, `packages/embeds/embed-react/src/Cal.tsx`, `packages/embeds/embed-snippet/src/index.ts`
3. Review postMessage handshake protocol in `packages/embeds/LIFECYCLE.md`
4. Implement EM-001: Inline embed behavioral parity via `cal-inline` custom element — ensure `Cal.inline()` aligns with Calendly `initInlineWidget()` behavior for container element rendering, auto-resize, and prefill support
5. Implement EM-002: Modal/popup embed parity via `cal-modal-box` custom element — ensure `Cal.modal()` aligns with Calendly `initPopupWidget()` behavior for overlay display, prerendering, and customization
6. Implement EM-003: Floating button embed parity via `cal-floating-button` custom element — ensure `Cal.floatingButton()` aligns with Calendly `initBadgeWidget()` behavior for button text, color, position, and modal trigger
7. Implement EM-004: Share flow and link generation parity — update embed dialog components in `apps/web/modules/embed/` for configuration options matching Calendly embed customization (background color, text color, button color, hide event details)
8. Write behavioral parity tests in `packages/embeds/embed-core/test/embed-parity.test.ts`
9. Update documentation and record Gate 6 validation evidence

## Session Notes
