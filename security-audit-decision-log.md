# Security Audit — Decision Log — `blitzy-cal`

A read-only, five-layer **Full Security Stack** audit of the Cal.com monorepo (`calcom-monorepo`, a Yarn Berry / Node.js 20 workspace). The engagement is **detection-and-reporting only**: it reads the application source tree exhaustively but modifies **~0 application files**. Its only outputs are the net-new audit artifacts (the four normalized per-layer finding files, the four Layer 3a inventories, the two raw scanner outputs, and the cross-layer merged report) plus the two rule-mandated deliverables — this decision log and the sibling reveal.js executive presentation (`security-audit-executive-presentation.html`), both now produced at the repository root. All findings are normalized to a single **unified severity vocabulary** (`critical` / `high` / `medium` / `low`), and the pipeline follows a strict **deterministic-before-agent** methodology so that machine-generated ground truth anchors and bounds every agent-reasoning step.

This document is the **single source of truth for every "why"** in the engagement, as mandated by the Explainability rule (AAP §0.8.1). It records each non-trivial decision with its alternatives, rationale, and residual risks; provides a bidirectional traceability matrix from the ten directives to their produced artifacts; lists the fifteen verification-suite checks and their results; and supplies a read-only reproducibility appendix. **No rationale is embedded in code comments** — this file carries it in full. Every quantitative figure herein is drawn from, and equals, `findings-merged.json` (the canonical numbers; see §10).

---

## §1 Engagement Summary

The audit merged **four** measurement layers under one severity schema and produced a single cross-correlated report whose CI/CD gate verdict is **`BLOCK`**. The headline figures below are the canonical numbers emitted by `findings-merged.json._summary` (generated `2026-06-05T00:38:14Z`); they are reproduced unchanged in the traceability matrix (§5) and the verification suite (§6), and are reused unchanged by the executive presentation (`security-audit-executive-presentation.html`), which has now been produced; any figure appearing in this log equals its counterpart in the merged report (§10).

| Metric | Value | Source field (`findings-merged.json._summary`) |
|--------|-------|------------------------------------------------|
| Layers merged | 4 (Layer 1, Layer 2, Layer 3b, Layer 4) | `layersMerged` |
| Total findings | **298** | `totalFindings` |
| Critical | 18 | `bySeverity.critical` |
| High | 96 | `bySeverity.high` |
| Medium | 110 | `bySeverity.medium` |
| Low | 74 | `bySeverity.low` |
| Gate-blocking findings | **80** (critical 12, high 68) | `gateBlockingTotal`, `gateBlockingBySeverity` |
| Advisory (non-blocking) findings | **218** | `advisoryTotal` |
| Cross-layer corroborated findings | **16** (2 high-confidence — same `file:line` with a shared CWE; 14 medium-confidence — same `file:line`) | `corroborated_count`, `corroboratedByConfidence` |
| Corroborated locations / same-location CWE overlaps | 8 `file:line` clusters / 1 same-location CWE | `corroboratedFiles`, `corroboratedCwes` |
| **Gate verdict** | **`BLOCK`** | `gate_verdict` |

Per-layer contribution (each layer's status is `OK`; severities sum to the layer total and the four totals sum to 298):

| Layer | Directive | Name | Findings | Critical | High | Medium | Low | Gate-blocking |
|-------|-----------|------|----------|----------|------|--------|-----|---------------|
| Layer 1 | 1 | Blitzy Architectural Audit | 29 | 0 | 2 | 19 | 8 | 0 |
| Layer 2 | 3 | Semgrep Pattern-Based SAST | 32 | 12 | 20 | 0 | 0 | 27 |
| Layer 3b | 5 | Blitzy AI Taint Analysis | 65 | 0 | 1 | 16 | 48 | 1 |
| Layer 4 | 6 | OSV-Scanner Software Composition Analysis | 172 | 6 | 73 | 75 | 18 | 52 |
| **Total** | — | — | **298** | **18** | **96** | **110** | **74** | **80** |

The verdict is `BLOCK` because at least one gate-blocking finding of `critical` or `high` severity exists; no layer degraded to an error state, so the higher-precedence `ERROR` verdict does not apply (§2.3). The gate-blocking set is driven by Layer 2 (27: 8 critical, 19 high), Layer 4 (52: 4 critical, 48 high — including a known-malicious `MAL-*` package), and Layer 3b (1 high — the authenticated outbound-webhook SSRF with no egress allowlist).

---

## §2 Methodology and Layer Ordering

### §2.1 Deterministic-before-agent pipeline

The pipeline runs in five ordered stages so that reproducible, machine-generated evidence is established **before** any agent reasoning interprets it, and synthesis runs last:

1. **Stage A — Pre-agent deterministic.** Install Semgrep with three rule packs (Directive 2); build the Layer 3a sink/mitigation inventories with shell `grep`/`find` (Directive 4); scan `yarn.lock` with OSV-Scanner (Directive 6).
2. **Stage B — Deterministic scan.** Run Semgrep to SARIF (Directive 3).
3. **Stage C — Bounded agent reasoning.** Layer 1 architectural review across ten categories (Directive 1) and Layer 3b taint analysis across sixteen CWE categories (Directive 5), each anchored to Stage A/B outputs.
4. **Stage D — Synthesis and gate.** Normalize every layer to the unified schema (Directive 7); merge with corroboration (Directive 8); compute the gate verdict (Directive 9); run the fifteen-check verification suite (Directive 10).
5. **Stage E — Governance deliverables.** This decision log and the executive presentation (`security-audit-executive-presentation.html`) — both produced at the repository root.

### §2.2 Severity normalization

Every layer is normalized into the single four-level vocabulary `critical / high / medium / low`. The per-tool maps are:

| Source | Native value | Unified severity |
|--------|--------------|------------------|
| Semgrep (SARIF level) | `error` | critical |
| Semgrep (SARIF level) | `warning` | high |
| Semgrep (SARIF level) | `note` | medium |
| Semgrep (SARIF level) | `info` | low |
| OSV (CVSS base score) | ≥ 9.0 | critical |
| OSV (CVSS base score) | 7.0 – 8.9 | high |
| OSV (CVSS base score) | 4.0 – 6.9 | medium |
| OSV (CVSS base score) | < 4.0 | low |
| OSV (DB severity fallback) | `CRITICAL` / `HIGH` / `MODERATE` / `LOW` | critical / high / medium / low |
| OSV (malicious package) | `MAL-*` advisory | critical (never demoted) |

Layer 1 and Layer 3b findings are authored directly in the unified vocabulary, so no mapping is required for them.

### §2.3 Gate model

The verdict is a **precedence fold** over the merged findings, evaluated highest-precedence first; the first condition that holds wins:

| Precedence | Verdict | Condition | This run |
|------------|---------|-----------|----------|
| 1 (highest) | `ERROR` | any layer status ≠ `OK` (e.g. `layer_2_status:"ERROR"`) | not triggered (0 errored layers) |
| 2 | `BLOCK` | any finding with `gateBlocking:true` and severity in {critical, high} | **triggered** (80 such findings) |
| 3 | `WARN` | only advisory findings (`gateBlocking:false` / demoted / medium–low) | superseded by `BLOCK` |
| 4 (lowest) | `PASS` | no gate-blocking and no advisory findings | not applicable |

A failed layer therefore never silently passes; it forces `ERROR`, which outranks `BLOCK`. This run resolves to `BLOCK`.

---

## §3 Decision Log

This is the mandatory decision table required by the Explainability rule (AAP §0.8.1). A decision is **non-trivial** if a competent engineer could reasonably have chosen differently; every such choice — including every deviation from a literal or obvious reading of the directives — has its own row. The table has exactly the four required columns: what was decided, what alternatives existed, why this choice was made, and what risks it carries.

| Decision | Alternatives considered | Rationale | Risks |
|----------|------------------------|-----------|-------|
| **Zero application files modified.** Treat the entire monorepo as read-only; emit only net-new artifacts. | Remediate findings in place; or modify configuration (e.g. add a `USER` directive to the `Dockerfile`) alongside reporting. | The directive header fixes the budget at "~0 files modified"; the engagement is detection-and-reporting, not remediation (AAP §0.1.1, §0.3.2). Honoring this absolutely also respects the platform's encryption-key-continuity and webhook-payload-immutability hard constraints. | Known issues are reported but remain unfixed until a separate remediation engagement; consumers must act on the report rather than a patch. |
| **Deterministic-before-agent ordering.** Run pre-agent shell/scanner steps (Semgrep setup and scan, Layer 3a `grep`/`find` inventory, OSV scan) before agent reasoning (Layer 1, Layer 3b) and synthesis. | Agent-first reasoning, then confirm with tools; or agent-only reasoning with no deterministic anchor. | Machine-generated ground truth anchors and bounds the agent layers, suppressing hallucination and making the audit's thoroughness measurable and reproducible (AAP §0.6.1, §0.6.5). | A tool-setup failure could starve the agent layers of anchors; mitigated by recording a per-layer status (e.g. `layer_2_status`) so the pipeline degrades gracefully rather than silently skipping a layer. |
| **Output-file location and naming convention.** Write bare-named findings/inventory/scanner artifacts at the repository **root**; give the two governance deliverables the `security-audit-` prefix. | A dedicated `/security-audit/` subdirectory; or prefix every artifact uniformly. | Matches the established in-repo precedent — `acceleration-report.md` and `acceleration-report-executive-presentation.html` already live at the root — so the new deliverables mirror a proven convention and are discoverable alongside their siblings (AAP §0.9.2). | Root-directory clutter; mitigated by the consistent, self-describing filenames and by this log's artifact inventory (§5). |
| **Unified severity mapping.** Normalize Semgrep `error→critical, warning→high, note→medium, info→low`, and band OSV CVSS scores into the same four levels (§2.2). | Keep each tool's native severity vocabulary in the merged report. | A single vocabulary is the precondition for a computable cross-layer merge and a single gate verdict; without it the merge and gate are not well-defined (AAP §0.6.1, Directive 7). | Banding imprecision — a CVSS 8.9 and a 7.0 both map to `high`, losing intra-band ordering; mitigated by retaining the raw `cvssScore`/`cvssVector` and the native SARIF level in each normalized finding so precision is recoverable. |
| **Gate-verdict precedence rules.** Compute the verdict as a precedence fold `ERROR > BLOCK > WARN > PASS` over `gateBlocking` and severity (§2.3). | A simple max-severity rule (e.g. "any critical ⇒ fail"); or a numeric risk-score threshold. | Precedence lets a failed layer (`ERROR`) outrank everything so it never silently passes, separates true blockers (`BLOCK`) from advisories (`WARN`), and keeps the decision auditable as a deterministic fold (AAP §0.6.5, Directive 9). | False `BLOCK`/`PASS` if `gateBlocking` flags are mis-set; mitigated by the demotion rationale (§4), the corroboration signal, and verification checks C6/C7/C15. |
| **Test-fixture suppression.** Partition sinks/mitigations found in test code into `*-test.txt` inventories, suppress Semgrep test-fixture false positives, and exclude test matches from gate-affecting counts. | Count every match, production and test alike, toward the gate. | Non-production code should not skew a production CI/CD gate; partitioning keeps the gate honest while preserving the test-only evidence for review (AAP §0.3.1, §0.9.2). | A genuine test-only issue is de-emphasized; mitigated by retaining the full `*-test.txt` inventories so nothing is discarded, only re-weighted. |
| **Inline-theme embedding for the deck.** Embed the full Blitzy reveal.js theme inline in `security-audit-executive-presentation.html`. | Link the canonical `blitzy-deck/references/blitzy-reveal-theme.css`; or reference an external stylesheet. | The canonical standalone theme file does not exist in the repository (AAP §0.5.4); the proven, compliant pattern is the inline `:root` token block already used by `acceleration-report-executive-presentation.html`. Linking a non-existent file is impossible. | Theme duplication and drift between the two decks; mitigated by copying the established token catalog verbatim and pinning the same CDN library versions (reveal.js 5.1.0, Mermaid 11.4.0, Lucide 0.460.0). |
| **Executive-deck content budget and accessibility** *(interpretation of the ≤40-word slide rule)*. Apply the ≤40-word content-slide limit (AAP §0.8.2) to each slide's **prose** — eyebrow, heading, bullets, KPI/icon-card labels, and source-note — and treat the embedded severity/risk **data-tables** and **Mermaid diagrams** as the slide's mandated non-text visual, whose internal cell values and node labels are data, not prose. Make those visuals screen-reader-accessible: `role="img"` + `aria-label` on each Mermaid `<pre>`, a visually-hidden (`sr-only`) `<caption>` on each table, and `scope="col"` on every header cell; Lucide icons stay decorative (`aria-hidden="true"`, `focusable="false"`). | Count every visible glyph (table cells and diagram labels included) toward the 40-word budget; or drop the data-table and diagrams to satisfy a literal all-text count; or use visible captions that consume the word budget. | The AAP simultaneously mandates a severity **data-table** and **Mermaid** architecture/gate diagrams (§0.6.3, §0.8.2) *and* a ≤40-word content limit; the only internally consistent reading is that the limit governs prose while the table and diagrams are the non-text visuals (their data is not prose). Prose was reduced so every default content slide is ≤40 prose words (rechecked at 9–36 words per slide); the `sr-only` caption and `aria-label`s add accessibility without adding any visible words. | A reviewer applying a strict all-visible-text count could still read the data/diagram slides as over budget; mitigated by holding each slide's prose well under 40, trimming verbose cell text, and recording this interpretation here as the single source of truth. |
| **Inventory-as-source-of-truth for taint.** Require every Layer 3b finding to trace to a concrete `file:line` entry in the Layer 3a inventory via an `inventoryRef`; the agent invents no sinks. | Let the taint agent discover sinks freely from the source tree. | Grounding taint findings in a deterministic inventory makes each finding auditable and prevents fabricated sinks (AAP §0.1.1, §0.6.5); verified by check C12 (all 65 Layer 3b findings trace to `sink-inventory.txt`). | A real sink missed by the `grep`/`find` patterns is invisible to Layer 3b; mitigated by the breadth of the sixteen sink-category patterns and by Layer 1 and Layer 2 covering the same regions independently. |
| **Per-category effort budgets.** Cap Layer 1 at ≤50 files per category and Layer 3b at ≤200 sinks per category, each with a coverage summary. | Unbounded analysis until "done"; or a single global file cap. | Per-category budgets make the audit's effort bounded, auditable, and comparable across categories (AAP §0.6.1); both budgets were respected (checks C8, C10). | A category with more than its budget of relevant files/sinks is sampled rather than exhausted; mitigated by recording the budget and a coverage summary per category so the sampling is explicit, and by anchoring to the full inventory. |
| **OSV dedupe and offline determinism.** Deduplicate OSV findings by the `(package, CVE)` tuple (falling back to the OSV id when no CVE alias exists), run Semgrep with `--metrics=off`, and emit every normalized layer as single-line minified JSON. | Report every raw advisory record; allow Semgrep telemetry; pretty-print the JSON. | Dedupe collapsed 257 raw vulnerability records to 172 unique findings (union of affected ranges preserved); `--metrics=off` keeps Semgrep fully offline and deterministic; minified single-line JSON is compact and diffable (AAP §0.1.3, §0.6.5; checks C2, C13). | Over-merging if two advisories share a `(package, CVE)` but differ materially; mitigated by preserving the union of affected ranges and the distinct OSV ids on each finding. |
| **CI-gate wiring is assessment-only.** Compute and document the gate verdict, but do not edit `.github/workflows/security-audit.yml` or `.github/workflows/all-checks.yml` to enforce it. | Wire the verdict into the umbrella `.github/workflows/all-checks.yml` `always()` required-job gate as part of this engagement. | Integrating the verdict is an additive code change to existing workflow files, which the "~0 files modified" budget forbids; it is recorded as a recommended follow-up, not a mandated edit (AAP §0.3.2, §0.6.2). | The verdict is not yet enforced in CI, so a `BLOCK` does not automatically fail a build; mitigated by documenting the exact integration point and the precedence model so wiring is a small, well-specified follow-up. |
| **Rule-pack substitution `p/owasp → p/owasp-top-ten`** *(deviation from the literal directive)*. Run Semgrep with `p/security-audit`, `p/secrets`, and `p/owasp-top-ten`. | Use the literal `p/owasp` named in Directive 2; or drop the OWASP pack entirely. | The literal `p/owasp` registry id returns HTTP 404; `p/owasp-top-ten` is the valid current OWASP Top Ten pack and preserves the directive's intent (OWASP Top 10 coverage). Recording this here satisfies the rule that any deviation from a literal interpretation must be logged (AAP §0.8.1). | Slight rule-set difference from a hypothetical `p/owasp`; mitigated because `p/owasp-top-ten` is the canonical OWASP pack and the three packs together still cover secrets, security-audit, and OWASP Top 10 (check C9 confirms three packs and `--metrics=off`). |
| **Finding demotion to advisory.** Demote selected findings from gate-blocking to advisory when an in-repo compensating control neutralizes them, recording a `demotionReason` per finding. | Treat every critical/high finding as gate-blocking regardless of existing mitigations. | The codebase already implements strong defenses (§4); crediting them prevents a gate flooded with already-mitigated noise while keeping the evidence visible as advisory (AAP §0.2.3, §0.6.5). The result is 80 gate-blocking versus 218 advisory findings. | A compensating control could be incomplete, under-crediting residual risk; mitigated by requiring an explicit, reviewable `demotionReason` on every demoted finding (check C11) and by never demoting malicious `MAL-*` packages. |
| **Cross-layer corroboration method (location-anchored).** Annotate a finding as corroborated only when two or more *different* layers report at the **exact same `file:line`**; confidence is `high` when those layers also share a CWE at that location and `medium` for a same-`file:line` match without CWE overlap. Each corroborated finding also exposes `clusterSeverity`/`maxSeverity` (the maximum severity across its location cluster) so corroboration never masks a higher-severity match. | Match on shared source *file* regardless of line; or match on a shared CWE *theme* repository-wide; or correlate by free-text similarity. | Location-anchored matching keeps corroboration precise — it elevates issues that two layers pin to the very same line while refusing to over-group unrelated findings that merely sit in the same file or share a CWE elsewhere (AAP §0.6.2, Directive 8; verified by check C5). A same-file-only / repository-wide CWE-theme rule produced a misleading **84** "corroborated" count; the exact-location rule yields **16** (2 high-confidence, 14 medium-confidence) across 8 `file:line` clusters with 1 same-location CWE overlap. | A genuine cross-layer link expressed at slightly different lines (e.g. a multi-line construct) is not auto-corroborated; mitigated by keeping every finding independently visible and by exposing `maxSeverity` on each cluster so the highest-severity signal is never hidden. |
| **Fifteen-check verification suite as the quality gate (Directive 10).** Validate artifact integrity and completeness with fifteen pass/fail checks (§6) before publishing. | Trust the artifacts without an automated integrity pass; or hand-spot-check a subset. | Independent structural checks catch silent regressions (missing artifacts, non-minified JSON, severity-vocabulary drift, miscounted totals, broken taint grounding) and make completeness measurable (AAP §0.9.1, Directive 10). All fifteen checks pass. | The suite could miss a defect class it does not test; mitigated by spanning presence, minification, vocabulary, count integrity, budgets, grounding, dedupe, layer status, and gate correctness. |

---

## §4 Finding Demotion Rationale — Existing Defenses Credited

Several findings were demoted from gate-blocking to **advisory** because the codebase already implements a compensating control that neutralizes the issue in production. The Layer 3a mitigation inventory (`mitigation-inventory.txt`, nine categories) catalogs these controls deterministically, and Layer 3b records a `demotionReason` on each demoted finding. This is the primary reason the audit reports **218 advisory** findings against **80 gate-blocking** ones. The table maps each catalogued mitigation category to its concrete control and the finding class it justifies demoting.

| Mitigation category (`mitigation-inventory.txt`) | Concrete control in the codebase | Finding class it demotes |
|--------------------------------------------------|----------------------------------|--------------------------|
| `constant-time-compare` | `crypto.timingSafeEqual` webhook-signature verification | Timing-attack / signature-bypass findings on verified webhook paths |
| `password-hashing` | `bcryptjs` password comparison (`verifyPassword.ts`) | Weak-credential-storage findings on the auth path |
| `api-key-hashing` | SHA-256 hashing of API keys before storage/lookup | Plaintext-secret-at-rest findings for API keys |
| `modern-encryption` | AES-256-GCM keyring (`packages/lib/crypto/keyring.ts`) | Weak-cipher findings where the GCM keyring supersedes legacy AES-256-CBC |
| `headers-cors-validation` | `helmet()`, CORS, and the global `ValidationPipe` whitelist in API v2 bootstrap | Missing-security-header / mass-assignment findings on API v2 routes |
| `authorization` | PBAC plus fifteen authorization guard folders | Missing-authorization (CWE-862/CWE-285) findings behind enforced guards |
| `csp-nonce` | CSP nonce middleware (`apps/web/proxy.ts`) | XSS findings mitigated by a nonce-based Content-Security-Policy |
| `bot-protection` | Cloudflare Turnstile challenge | Automated-abuse findings on Turnstile-protected endpoints |
| `rate-limiting` | `@unkey/ratelimit` 2.1.3 | Brute-force / resource-exhaustion findings on rate-limited routes |

Two demotions are explicitly **never** applied: malicious packages (OSV `MAL-*` advisories) are always gate-blocking, and any finding lacking a recorded `demotionReason` remains gate-blocking by default (verified by check C11). Demotion credits a control only where the control is actually on the affected code path; a finding on a path the control does not cover stays blocking.

---

## §5 Bidirectional Requirements Traceability Matrix

The matrix establishes **100% coverage** of the ten directives and is **bidirectional**: §5.1 maps each directive forward to its produced artifact(s) and status, and §5.2 maps each produced artifact back to its originating directive, confirming there are no orphan artifacts.

### §5.1 Directive → Artifact (forward, 10/10 covered)

| Directive | Description | Produced artifact(s) | Status |
|-----------|-------------|----------------------|--------|
| D1 | Layer 1 Blitzy architectural audit across 10 categories (≤50 files/category, coverage summaries) | `findings-layer-1-blitzy.json` | Done — 29 findings, 10 categories, budget respected |
| D2 | Pre-agent Semgrep setup: install CLI + 3 rule packs, `--metrics=off`, ERROR-on-failure | Tooling provisioning (semgrep 1.163.0) + `layer_2_status` | Done — `layer_2_status:"OK"` (packs: `p/security-audit`, `p/secrets`, `p/owasp-top-ten`) |
| D3 | Layer 2 Semgrep scan to SARIF, then normalize | `results-semgrep.sarif` → `findings-layer-2-semgrep.json` | Done — 32 findings normalized |
| D4 | Pre-agent Layer 3a deterministic `grep`/`find` inventory (16 sink + 9 mitigation categories) | `sink-inventory.txt`, `sink-inventory-test.txt`, `mitigation-inventory.txt`, `mitigation-inventory-test.txt` | Done — 16 sink + 9 mitigation categories, production/test partitioned |
| D5 | Layer 3b Blitzy taint analysis across 16 CWE categories (≤200 sinks/category, `gateBlocking` + `demotionReason`) | `findings-layer-3b-blitzy-taint.json` | Done — 65 findings, grounded in Layer 3a inventories, budget respected |
| D6 | Pre-agent Layer 4 OSV-Scanner over lockfiles, then normalize, dedupe by `(package, CVE)` | `results-osv.json` → `findings-layer-4-osv.json` | Done — 257 raw → 172 unique findings |
| D7 | Normalize every layer to single-line minified JSON under the unified severity schema | All four `findings-layer-*.json` (and `findings-merged.json`) | Done — single-line minified, unified vocabulary (checks C2, C3) |
| D8 | Cross-layer merged report with `_summary` header and corroboration annotations | `findings-merged.json` | Done — 298 findings, 16 corroborated (location-anchored) |
| D9 | CI/CD gate verdict from {ERROR, BLOCK, WARN, PASS} | `gate_verdict` / `gateDecision` in `findings-merged.json` | Done — verdict `BLOCK` |
| D10 | Verification suite of 15 pass/fail integrity checks | The 15 checks documented in §6 (and reproducible via §9) | Done — 15/15 PASS |

### §5.2 Artifact → Directive (reverse, no orphans)

| Produced artifact | Traces back to | Orphan? |
|-------------------|----------------|---------|
| `findings-layer-1-blitzy.json` | D1 | No |
| `results-semgrep.sarif` | D3 (raw scan output of D2 setup) | No |
| `findings-layer-2-semgrep.json` | D3 + D7 (normalization) | No |
| `sink-inventory.txt` | D4 | No |
| `sink-inventory-test.txt` | D4 (test partition) | No |
| `mitigation-inventory.txt` | D4 | No |
| `mitigation-inventory-test.txt` | D4 (test partition) | No |
| `findings-layer-3b-blitzy-taint.json` | D5 | No |
| `results-osv.json` | D6 (raw scan output) | No |
| `findings-layer-4-osv.json` | D6 + D7 (normalization + dedupe) | No |
| `findings-merged.json` | D8 + D9 (merge + gate) + D7 | No |
| `security-audit-decision-log.md` (this file) | AAP §0.8.1 (Explainability rule) | No |
| `security-audit-executive-presentation.html` | AAP §0.8.2 (Executive Presentation rule, R2) | No |

Every directive maps to at least one artifact and every artifact maps back to a directive or rule, so coverage is complete in both directions. **There are no orphan artifacts.** All thirteen produced files trace to a directive or rule above: the eleven bare-named findings/inventory/scanner artifacts (the four `findings-layer-*.json`, the four Layer 3a inventories, the two raw scanner outputs, and `findings-merged.json`) plus the two `security-audit-`-prefixed governance deliverables — this decision log (R1, AAP §0.8.1) and `security-audit-executive-presentation.html` (R2, AAP §0.8.2). The executive presentation, the engagement's final deliverable, is now produced at the repository root and is traced in the row above. No other files were added to the deliverable set, so the artifact→directive mapping is exhaustive with zero orphans.

---

## §6 Verification Suite (Directive 10)

Directive 10 requires fifteen pass/fail checks that validate the integrity and completeness of the produced artifacts. The checks below were executed against the committed artifacts; the result column reports the observed outcome. **All fifteen checks PASS.** The suite is reproducible from §9.

| # | Check | Validates | Result |
|---|-------|-----------|--------|
| C1 | All eleven machine artifacts exist at the repository root | Completeness of the artifact set | **PASS** — 11/11 present |
| C2 | The four normalized layer files and the merged report are single-line minified (0 embedded newlines) | Output discipline (Directive 7) | **PASS** — all five contain 0 newlines |
| C3 | Every finding's severity is one of `critical / high / medium / low` across all four layers | Unified severity vocabulary (Directive 7) | **PASS** — all 298 findings conform |
| C4 | Merged `totalFindings` equals the sum of the four per-layer counts **and** the sum of `bySeverity` | Count integrity (merged totals) | **PASS** — 298 = 29 + 32 + 65 + 172 = 18 + 96 + 110 + 74 |
| C5 | Cross-layer corroboration is location-anchored — every corroborated cluster is ≥2 layers at the exact same `file:line` (no same-file-only or repository-wide CWE-theme matches), `corroborated_count` equals the recomputed location-anchored total, and every corroborated finding exposes `maxSeverity` equal to its cluster maximum | Corroboration integrity & severity non-masking (Directive 8) | **PASS** — 16 corroborated (2 high / 14 medium); all matches exact `file:line` cross-layer; `maxSeverity` = cluster max on all |
| C6 | `gateBlockingTotal` equals both the by-layer and by-severity sums | Gate-count integrity | **PASS** — 80 = (0+27+1+52) = (12+68+0+0) |
| C7 | `advisoryTotal` equals `totalFindings − gateBlockingTotal` | Advisory accounting | **PASS** — 218 = 298 − 80 |
| C8 | Layer 1 has exactly 10 categories, each with a coverage summary, and respects the ≤50-files budget | Layer 1 completeness (Directive 1) | **PASS** — 10 categories, budget respected |
| C9 | Layer 2 severity map is exact, `metrics` is `off`, and three rule packs are recorded | Layer 2 configuration (Directives 2, 3, 7) | **PASS** — map correct, `metrics:off`, 3 packs |
| C10 | Layer 3b covers 16 CWE categories, is grounded in both inventories, and respects the ≤200-sinks budget | Layer 3b coverage (Directive 5) | **PASS** — 16 CWE, grounded, budget respected |
| C11 | Every Layer 3b finding has a boolean `gateBlocking`; every advisory carries a non-empty `demotionReason` | Demotion accountability (Directive 5) | **PASS** — all 65 findings conform |
| C12 | Every Layer 3b finding's file appears in `sink-inventory.txt` | Inventory-as-source-of-truth (Directive 5) | **PASS** — all 65 trace to inventory |
| C13 | No duplicate `(package, CVE)` tuples among Layer 4 findings; dedupe metadata present | OSV dedupe (Directives 6, 7) | **PASS** — 0 dups, 257 raw → 172 unique |
| C14 | All four layer statuses are `OK` (no degradation to `ERROR`) | Graceful-degradation accounting (Directive 2) | **PASS** — all four `OK` |
| C15 | `gate_verdict` is a valid verdict and equals the precedence fold | Gate correctness (Directive 9) | **PASS** — `BLOCK` matches the fold |

---

## §7 Risk Assessment

This section consolidates the residual risks of the engagement's non-trivial decisions (the per-decision risks appear in §3) and formally records acceptance of the two most consequential ones.

| Risk | Affected decision | Description | Mitigation |
|------|-------------------|-------------|------------|
| Verdict not CI-enforced | CI-gate wiring assessment-only | The computed `BLOCK` verdict is documented but not yet wired into a required CI job, so it does not automatically fail a build | Integration point and precedence model documented (§2.3, §3); wiring is a small, well-specified follow-up |
| Rule-pack substitution | `p/owasp → p/owasp-top-ten` | The literal `p/owasp` pack is unavailable (HTTP 404); a different OWASP pack id was used | `p/owasp-top-ten` is the canonical OWASP Top Ten pack; the three packs still cover secrets, security-audit, and OWASP Top 10 (check C9) |
| Severity banding imprecision | Unified severity mapping | CVSS scores collapse to four bands, losing intra-band ordering | Raw `cvssScore`/`cvssVector` and native SARIF level retained on each finding |
| Test-only issue de-emphasized | Test-fixture suppression | A real issue confined to test code is excluded from gate-affecting counts | Full `*-test.txt` inventories retained; nothing is discarded, only re-weighted |
| Inline-theme drift | Inline-theme embedding for the deck | The embedded Blitzy theme can drift from the sibling deck's theme | Token catalog copied verbatim and CDN library versions pinned identically |
| Under-credited residual risk | Finding demotion to advisory | A compensating control credited for a demotion could be incomplete | Explicit reviewable `demotionReason` per finding (check C11); `MAL-*` packages never demoted |
| Missed sink | Inventory-as-source-of-truth | A sink not matched by the `grep`/`find` patterns is invisible to Layer 3b | Sixteen sink-category patterns plus independent Layer 1 and Layer 2 coverage of the same regions |

**Formal risk acceptance — CI gate not enforced in this engagement.** The exposure is recorded and accepted on the following terms:

- **Decision.** Compute and document the `BLOCK` verdict, but do not edit `.github/workflows/security-audit.yml` or `.github/workflows/all-checks.yml` to enforce it within this engagement.
- **Inherent risk.** Until the verdict is wired into a required CI job, a future build with gate-blocking findings will not be failed automatically by this audit's verdict.
- **Compensating controls.** The verdict, its precedence model (§2.3), the per-layer triggering counts (§1), and the exact umbrella integration point (`.github/workflows/all-checks.yml`'s `always()` required-job gate) are documented so enforcement is a small, well-scoped change.
- **Residual risk.** With the verdict and its integration fully specified, the residual risk is procedural (a follow-up must perform the wiring) rather than analytical.
- **Re-evaluation trigger.** Revisited when a remediation/CI engagement is authorized to modify workflow files, at which point the verdict is wired into the required-job gate.

**Formal risk acceptance — `p/owasp-top-ten` substitution.** The deviation from the literal `p/owasp` directive is recorded and accepted: the literal id 404s, `p/owasp-top-ten` is the valid OWASP Top Ten pack, the directive's intent (OWASP Top 10 coverage) is preserved, and the substitution is logged here per AAP §0.8.1. Re-evaluation trigger: a future Semgrep registry change that restores or supersedes the `p/owasp` id.

---

## §8 Limitations

- **Detection-only engagement.** The audit reports and gates; it does not remediate. Every finding — including the container default-`ARG`-secret and missing-`USER` observations and the Layer 4 vulnerable-dependency findings — is reported rather than fixed, per the "~0 files modified" budget (AAP §0.3.2).
- **Bounded agent effort.** Layer 1 and Layer 3b are bounded by per-category budgets (≤50 files, ≤200 sinks). A category with more relevant files or sinks than its budget is sampled with an explicit coverage summary rather than exhausted.
- **Inventory-bounded taint.** Layer 3b reasons only over sinks present in the Layer 3a inventory; a sink missed by the deterministic patterns is not analyzed by Layer 3b (though Layer 1 and Layer 2 cover the same regions independently).
- **Severity-banding precision.** OSV CVSS scores are banded into four levels for the unified vocabulary; intra-band ordering is not expressed in the `severity` field, only in the retained raw `cvssScore`.
- **Verdict not enforced.** The `BLOCK` verdict is computed and documented but not wired into CI within this engagement (§7).
- **Sibling deliverable produced as a separate file.** The executive presentation (`security-audit-executive-presentation.html`) is a distinct deliverable, now produced at the repository root; it reuses the canonical figures recorded here (§10) unchanged. This log records the *rationale*; it does not embed the deck's slide content, and the deck embeds no rationale (per the Explainability rule).
- **Rule-pack substitution.** Semgrep ran with `p/owasp-top-ten` in place of the literal, unavailable `p/owasp` (§3, §7).

---

## §9 Reproducibility Appendix

The commands below are the exact, ordered, **read-only** steps that produced the deterministic layers (Stages A and B of §2.1). They are offline and deterministic — Semgrep runs with `--metrics=off`, OSV transmits only package coordinates, and scans exclude `node_modules`, `.next`, and `dist`. Tool versions: semgrep 1.163.0, osv-scanner 2.3.5 (AAP §0.4.1). Fenced code blocks are used here because this is a Markdown document; they are forbidden only in the executive deck's slides (AAP §0.8.2).

### §9.1 Layer 2 — Semgrep (Directives 2, 3)

```bash
# Install the pinned Semgrep CLI (PEP 668 system Python: add --break-system-packages or use a venv)
pip install --break-system-packages semgrep==1.163.0

# Scan to SARIF with the three rule packs, metrics disabled.
# NOTE: p/owasp-top-ten is used in place of the literal p/owasp, which 404s (see §3, §7).
semgrep scan \
  --config p/security-audit \
  --config p/secrets \
  --config p/owasp-top-ten \
  --metrics=off \
  --sarif --output results-semgrep.sarif \
  apps packages
```

### §9.2 Layer 3a — Sink & Mitigation Inventory (Directive 4)

```bash
# Enumerate in-scope sources, excluding node_modules/.next/dist.
find apps packages -type f \
  \( -name '*.ts' -o -name '*.tsx' -o -name '*.js' -o -name '*.jsx' \) \
  -not -path '*/node_modules/*' -not -path '*/.next/*' -not -path '*/dist/*'

# Each of the 16 sink categories and 9 mitigation categories is grepped with a
# category-specific pattern and emitted as file:line:category:text. Production and
# test matches are written to separate inventories. Representative sink example
# (CWE-601, open redirect); the leading column is rewritten to insert the category:
grep -rnE 'res\.redirect\(|\.redirect\(' apps packages \
  --include='*.ts' --include='*.tsx' --include='*.js' --include='*.jsx' \
  --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=dist \
  | sed -E 's/^([^:]+:[0-9]+):/\1:CWE-601:/' >> sink-inventory.txt

# Representative mitigation example (constant-time-compare):
grep -rnE 'timingSafeEqual' apps packages \
  --include='*.ts' --include='*.tsx' --include='*.js' --include='*.jsx' \
  --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=dist \
  | sed -E 's/^([^:]+:[0-9]+):/\1:constant-time-compare:/' >> mitigation-inventory.txt
```

The 16 sink categories are CWE-601, CWE-918, CWE-117, CWE-807, CWE-338, CWE-843, CWE-862, CWE-79, CWE-134, CWE-250, CWE-912, CWE-1004-614-1275, CWE-639, CWE-200, CWE-367, and CWE-285. The 9 mitigation categories are `api-key-hashing`, `authorization`, `bot-protection`, `constant-time-compare`, `csp-nonce`, `headers-cors-validation`, `modern-encryption`, `password-hashing`, and `rate-limiting`.

### §9.3 Layer 4 — OSV-Scanner (Directive 6)

```bash
# Install OSV-Scanner v2.3.5 (prebuilt binary on PATH, or: go install github.com/google/osv-scanner/v2@v2)
osv-scanner --version   # -> osv-scanner version: 2.3.5

# Scan the root Yarn Berry lockfile to JSON; normalization then dedupes by (package, CVE).
osv-scanner scan source --lockfile=yarn.lock --format=json > results-osv.json
```

### §9.4 Verification suite recomputation (Directive 10)

The integrity checks in §6 are deterministic functions of the committed artifacts. The core integrity checks (C4–C7, C15) recompute directly from the merged report; the full suite is also embedded in `findings-merged.json._summary.verification`:

```bash
python3 - <<'PY'
import json
from collections import defaultdict
doc = json.load(open("findings-merged.json"))
s = doc["_summary"]
per = {k: v["findings"] for k, v in s["layerStatus"].items()}
assert s["totalFindings"] == sum(per.values()) == sum(s["bySeverity"].values()) == 298  # C4
# C5 — location-anchored corroboration recompute (exact same file:line, >=2 distinct layers)
loc = defaultdict(list)
for f in doc["findings"]:
    try:
        ln = int(str(f.get("line")).strip())
    except Exception:
        ln = None
    if f.get("file") and ln is not None:
        loc[(f["file"], ln)].append(f)
corr = {m["id"] for ms in loc.values() if len({m["layer"] for m in ms}) > 1 for m in ms}
assert len(corr) == s["corroborated_count"] == 16                      # C5
assert s["gateBlockingTotal"] == sum(s["gateBlockingByLayer"].values()) == 80   # C6
assert s["advisoryTotal"] == s["totalFindings"] - s["gateBlockingTotal"] == 218 # C7
assert s["gate_verdict"] == "BLOCK"                                    # C15
print("C4-C7, C15: PASS")
PY
```

---

## §10 Cross-Deliverable Consistency

Every quantitative figure in this decision log is drawn from `findings-merged.json._summary` and **equals** its counterpart in that file; the sibling executive presentation (`security-audit-executive-presentation.html`), now produced at the repository root, reuses these same figures unchanged. The merged report itself states that these are "the canonical numbers reused by `security-audit-decision-log.md` and `security-audit-executive-presentation.html`." The shared canonical figures are:

| Figure | Canonical value |
|--------|-----------------|
| Layers merged | 4 |
| Total findings | 298 |
| Severity split (critical / high / medium / low) | 18 / 96 / 110 / 74 |
| Per-layer findings (L1 / L2 / L3b / L4) | 29 / 32 / 65 / 172 |
| Gate-blocking findings (critical / high) | 80 (12 / 68) |
| Advisory findings | 218 |
| Corroborated findings (high / medium confidence) | 16 (2 / 14) |
| Gate verdict | `BLOCK` |
| Verification suite | 15 / 15 PASS |

If any of these figures is later changed in `findings-merged.json`, this log and the executive presentation must be updated in lockstep so all three deliverables remain identical. This document is, and must remain, the single source of truth for the *rationale* behind each figure and decision; the merged report is the single source of truth for the *figures* themselves.
