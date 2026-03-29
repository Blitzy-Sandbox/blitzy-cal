# Embed & Share Implementation

## Status: in-progress

## Completed

- Spec artifacts created: `specs/embed-share/` folder with design.md, implementation.md, decisions.md, CLAUDE.md, prompts.md, future-work.md, and docs/README.md
- EM-001/EM-002/EM-003: Embed core runtime has `Cal.inline()`, `Cal.modal()`, `Cal.floatingButton()` with custom elements (`cal-inline`, `cal-modal-box`, `cal-floating-button`) in `packages/embeds/embed-core/src/embed.ts`
- Customization options implemented: `hideEventTypeDetails`, `buttonColor`, `buttonTextColor`, `backgroundColor`, `textColor`, `theme`, `layout`
- Three-package architecture in place: `embed-core`, `embed-react`, `embed-snippet`

## In Progress

- EM-001: Inline embed behavioral parity alignment with Calendly's `initInlineWidget()`
- EM-002: Modal/popup parity alignment with Calendly's `initPopupWidget()`
- EM-003: Floating button parity alignment with Calendly's `initBadgeWidget()`
- EM-004: Share flow and link generation parity across the embed suite
- Validation criteria EM-VAL-001 through EM-VAL-009 — pending formal verification

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
