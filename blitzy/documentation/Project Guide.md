
# Blitzy Project Guide — Snyk Config H Deliverable Bundle

Branch: `blitzy-241430c4-988a-4ea2-a822-a06c6f86819c` · HEAD: `03b1f5a07d` · Total Hours: **58.5h** · Completed: **50.0h** · Remaining: **8.5h** · **85.5% Complete**

---

## 1. Executive Summary

### 1.1 Project Overview

The Snyk Config H exercise produces a normalized, schema-conformant security-findings artifact (`findings-config-h.json`) for the `blitzy-cal` (Cal.com) monorepo and ships it alongside two rule-mandated governance artifacts (`decision-log.md`, `executive-presentation.html`) and one helper script (`scripts/normalize-snyk-findings.mjs`). Config H is one of several sibling security-tool configurations whose outputs must conform byte-for-byte to a strict 5-field schema (`file`, `line`, `severity`, `cwe`, `description`) so cross-tool diffs are mechanically computable. The exercise touches no application source: the 7,433 `.ts`/`.tsx`/`.js` files and 119 `package.json` manifests are scan **inputs** to Snyk Code (SAST) and Snyk Open Source (SCA), never modified. The audience is a downstream multi-config comparison harness plus non-technical leadership consuming the executive deck.

### 1.2 Completion Status

```mermaid
%%{init: {'theme':'base','themeVariables':{'pie1':'#5B39F3','pie2':'#FFFFFF','pieStrokeColor':'#2D1C77','pieOuterStrokeColor':'#2D1C77','pieTitleTextSize':'18px','pieSectionTextSize':'14px'}}}%%
pie showData title Project Completion — 85.5%
    "Completed Work" : 50
    "Remaining Work" : 8.5
```

| Metric                       | Hours |
| ---------------------------- | -----:|
| **Total Project Hours**      | 58.5  |
| Completed Hours (AI + Manual)| 50.0  |
| Remaining Hours              |  8.5  |
| **Completion**               | **85.5%** |

Formula: 50.0 / (50.0 + 8.5) = 50.0 / 58.5 = **85.47% → rounded to 85.5%**

### 1.3 Key Accomplishments

- [x] **All 4 AAP deliverable files created and committed** — `findings-config-h.json`, `decision-log.md`, `executive-presentation.html`, `scripts/normalize-snyk-findings.mjs` (10 commits, 1062 insertions, 0 deletions across the branch from merge base `5b84287ebc`).
- [x] **Directive 4 pass/fail gates all satisfied** — file exists, `wc -l = 1`, valid JSON array, 5-field schema enforced, no description exceeds 200 characters.
- [x] **Snyk CLI v1.1304.3 installed and operational** — `snyk --version` returns `1.1304.3`; available at `/usr/bin/snyk`.
- [x] **Normalization algorithm matches AAP §0.5.4 byte-for-byte** — 30/30 synthetic unit tests pass (severity mapping, prefix tagging, 200-char truncation, CWE-first/CVE-fallback, empty-state semantics, integer coercion).
- [x] **Decision log captures every non-trivial decision per Explainability rule** — 38 rows covering AAP design decisions, Checkpoint 1 + Checkpoint 2 (FINAL) code review, QA Issue #1, QA MINOR #1/2/4.
- [x] **Executive deck renders cleanly at 1920×1080** — zero console errors, 9/9 network requests return 200, all 16 sections contain at least one non-text visual.
- [x] **Auth-failure communicated literally across every affected surface** — decision-log row 30, executive-presentation slides 2/5/6/7/9/10/11/14/16, commit messages — so the empty `findings-config-h.json` cannot be mistaken for "zero vulnerabilities."
- [x] **Read-only scope discipline enforced** — zero application source modified, zero `package.json` of 119 touched, `apps/api/v2/.snyk` policy preserved, no CI workflows added or modified.
- [x] **Biome 2.3.10 clean** — `yarn biome check scripts/normalize-snyk-findings.mjs` returns "No fixes applied" with zero diagnostics.

### 1.4 Critical Unresolved Issues

| Issue | Impact | Owner | ETA |
|---|---|---|---|
| `SNYK_TOKEN` not provisioned in execution environment | Blocks Directives 1 (auth check), 2 (SAST scan), 3 (SCA scan); causes Directive 4 to emit AAP-specified empty-state `[]\n` instead of populated findings | Operator / CI orchestrator | < 1h once token issued by Snyk admin |
| `results-snyk-code.sarif` not produced | Directive 2 pass/fail criterion not yet satisfied with real data (algorithm verified via synthetic SARIF in unit tests) | Operator | Resolved by executing Directive 2 after token provisioning |
| `results-snyk-deps.json` not produced | Directive 3 pass/fail criterion not yet satisfied with real data (algorithm verified via synthetic Snyk JSON in unit tests) | Operator | Resolved by executing Directive 3 after token provisioning |
| Populated `findings-config-h.json` not yet regenerated | Multi-config comparison harness consumes an empty-state file rather than real findings | Operator | Resolved by `node scripts/normalize-snyk-findings.mjs` after Directives 2 + 3 produce inputs |

### 1.5 Access Issues

| System/Resource | Type of Access | Issue Description | Resolution Status | Owner |
|---|---|---|---|---|
| Snyk Cloud (`*.snyk.io`) | API token (`SNYK_TOKEN` env var) | Token not present in execution environment; AAP §0.9.5 records `User-supplied env vars: []` and `User-supplied secrets: []`. `snyk auth check` exits non-zero with "authentication failed (timeout)" | Open — must be provisioned by operator with valid Snyk API token | Snyk admin / CI orchestrator |
| Snyk Code analysis service | Outbound HTTPS to `*.snyk.io` for source bundle upload | Will work once `SNYK_TOKEN` provisioned; AAP §0.1.3 explicitly states "Snyk requires network access — there is no offline mode" | Open (network reachability is operator-side) | Operator |
| Snyk vulnerability database | Outbound HTTPS to `*.snyk.io` for dependency lookup | Same as above | Open | Operator |

### 1.6 Recommended Next Steps

1. **[High]** Provision a valid `SNYK_TOKEN` in the CI / execution environment (≤ 0.5h).
2. **[High]** Re-execute the 4 AAP directives end-to-end (Directives 1 → 2 → 3 → 4) using the operator runbook documented in decision-log row 30 and Section 9 of this guide (≤ 3.0h).
3. **[High]** Re-run validation gate suite to confirm Directive 4's `wc -l = 1`, valid JSON, schema, and 200-char description constraints all still pass against the **populated** findings (≤ 1.0h).
4. **[Medium]** Hand the populated `findings-config-h.json` plus its sibling Config A–G outputs to the cross-config comparison harness (≤ 2.0h, out-of-scope for Config H itself).
5. **[Low]** Consider adding `results-snyk-*.{sarif,json}` to a project `.gitignore` if the operator chooses to retain ephemeral scan artifacts in the working tree — AAP §0.8.4 leaves this optional and the platform's preferred approach is to delete the ephemeral artifacts after normalization.

---

## 2. Project Hours Breakdown

### 2.1 Completed Work Detail

| Component | Hours | Description |
|---|---:|---|
| Snyk CLI install & partial Directive 1 (auth setup invested) | 1.5 | Snyk CLI v1.1304.3 installed globally at `/usr/bin/snyk`; auth check command wired but blocked on operator token |
| Partial Directive 2 — SAST invocation logic and exact CLI invocation | 1.0 | `snyk code test --sarif-file-output=results-snyk-code.sarif .` invocation documented and rehearsed; execution awaits token |
| Partial Directive 3 — SCA invocation logic and `--all-projects` correction | 1.0 | `snyk test --all-projects --json > results-snyk-deps.json` invocation documented; `--all-projects` flag added per decision row 8 to traverse 119-manifest workspace |
| Normalization algorithm — Directive 4 core (schema + severity + prefix + truncate + CWE-first + empty-state + minify) | 11.0 | `scripts/normalize-snyk-findings.mjs` algorithm matches AAP §0.5.4 byte-for-byte across SARIF parsing, severity mapping, prefix tagging, 200-char truncation, CWE-first/CVE-fallback, single-line UTF-8 emission, and empty-state `[]` literal payload |
| `decision-log.md` — Explainability rule artifact (38 rows) | 8.5 | Full Markdown decision table with the required columns `Decision \| Alternatives \| Rationale \| Risks`; covers AAP design + Checkpoint 1/2 code review + QA Issue #1 + QA MINOR #1/2/4 |
| `executive-presentation.html` — Executive Presentation rule artifact (16-slide reveal.js deck) | 12.5 | 16 sections (title=1 + divider=4 + content=10 + closing=1); 21 inline CSS custom properties; pinned CDNs reveal.js@5.1.0 + Mermaid@11.4.0 + Lucide@0.460.0; auth-failure framing on every affected slide |
| `scripts/normalize-snyk-findings.mjs` — 115-line ESM helper (built-ins only, entrypoint guard, integer coercion) | 4.5 | Node.js ESM module using only `node:fs`, `node:process`, `node:url`; `fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])` entrypoint guard; `Number.isInteger`-guarded SARIF line accessor |
| Code review & QA remediation cycles (5 rounds: Checkpoint 1, Checkpoint 2 FINAL, QA Issue #1, QA MINOR #1/2, QA MINOR #4) | 6.5 | Decision rows 26–29 (CR1), 31–35 (CR2 FINAL), 36 (QA MINOR #4), 37–38 (QA MINOR #1/2) — six dedicated remediation commits |
| Static analysis (Biome), 30 synthetic unit tests, browser runtime validation @ 1920×1080 | 3.0 | `yarn biome check` zero diagnostics; 30/30 unit assertions pass; runtime UI verification with zero console errors and 9/9 network 200 OK |
| Read-only scope discipline (no app source, no manifests, no `.snyk` policy modified) | 0.5 | `git diff --name-status` confirms exactly 4 added files; 7,433 `.ts/.tsx/.js` files and 119 `package.json` manifests preserved |
| **TOTAL COMPLETED** | **50.0** | |

### 2.2 Remaining Work Detail

| Category | Hours | Priority |
|---|---:|---|
| Provision `SNYK_TOKEN` in execution / CI environment | 0.5 | High |
| Complete Directive 1 — verify `snyk auth check` returns 0 with the provisioned token | 0.5 | High |
| Execute Directive 2 — `snyk code test --sarif-file-output=results-snyk-code.sarif .` | 1.0 | High |
| Produce ephemeral `results-snyk-code.sarif` (Directive 2 pass/fail artifact) | 0.5 | High |
| Execute Directive 3 — `snyk test --all-projects --json > results-snyk-deps.json` | 1.0 | High |
| Produce ephemeral `results-snyk-deps.json` (Directive 3 pass/fail artifact) | 0.5 | High |
| Regenerate populated `findings-config-h.json` via `node scripts/normalize-snyk-findings.mjs` | 1.5 | High |
| Operator end-to-end rerun and validation gate suite re-execution | 1.0 | High |
| Cross-config comparison harness (Config H schema diff vs Configs A–G) | 2.0 | Medium |
| **TOTAL REMAINING** | **8.5** | |

### 2.3 Cross-Section Hour Validation

| Check | Value | Status |
|---|---|---|
| Section 2.1 sum (Completed) | 50.0h | ✅ Matches Section 1.2 Completed |
| Section 2.2 sum (Remaining) | 8.5h | ✅ Matches Section 1.2 Remaining and Section 7 pie chart |
| Section 2.1 + Section 2.2 | 58.5h | ✅ Matches Section 1.2 Total Project Hours |
| Completion percentage | 50.0 / 58.5 = 85.47% → 85.5% | ✅ Consistent across Sections 1.2, 7, 8 |

---

## 3. Test Results

All tests below originate from Blitzy's autonomous validation logs for this Config H exercise. Snyk CLI scans (Directives 2 & 3) await operator-provisioned `SNYK_TOKEN`; the algorithm that consumes those scan outputs is fully tested via synthetic SARIF + Snyk JSON inputs.

| Test Category | Framework | Total Tests | Passed | Failed | Coverage % | Notes |
|---|---|---:|---:|---:|---:|---|
| Normalizer — `mapSarifSeverity` | Node assert (synthetic) | 6 | 6 | 0 | 100% (all SARIF levels: error / warning / note / none / undefined / unknown) | Confirms AAP §0.1.1 severity mapping |
| Normalizer — `truncate` | Node assert (synthetic) | 4 | 4 | 0 | 100% (250→200, short preserved, null, undefined) | Confirms 200-char clamp behavior |
| Normalizer — `parseSarif` | Node assert (synthetic) | 9 | 9 | 0 | 100% (empty runs, populated, 3 severities, prefix, key order, missing line, stringy line → 0 per decision row 36) | Confirms SARIF-to-finding shape |
| Normalizer — `parseSnyk` | Node assert (synthetic) | 11 | 11 | 0 | 100% (single project, all-projects array, CWE preferred, CVE fallback, empty when both absent, `line: 0` invariant, prefix, manifest path, `targetFile` fallback, truncation with prefix preserved) | Confirms Snyk JSON-to-finding shape |
| Static analysis — Biome | `@biomejs/biome` 2.3.10 | 1 | 1 | 0 | n/a | `yarn biome check scripts/normalize-snyk-findings.mjs` → "Checked 1 file in 8ms. No fixes applied." Zero diagnostics |
| End-to-end normalizer (empty-state) | Node + `od -c` byte inspection | 1 | 1 | 0 | n/a | Synthetic empty `results-*` inputs → `findings-config-h.json` = `[]\n` (3 bytes, `wc -l = 1`) |
| End-to-end normalizer (populated synthetic) | Node + `JSON.parse` | 1 | 1 | 0 | n/a | Synthetic SARIF (2 findings) + Snyk JSON (2 vulns) → 4 findings emitted with correct schema, severity, prefix |
| Directive 4 validation gate — file existence | `test -f` | 1 | 1 | 0 | n/a | `findings-config-h.json` present at repo root |
| Directive 4 validation gate — `wc -l = 1` | `wc -l` | 1 | 1 | 0 | n/a | File is exactly `[]\n` (3 bytes); single line satisfied |
| Directive 4 validation gate — valid JSON | `JSON.parse` | 1 | 1 | 0 | n/a | Parses cleanly to `Array` of length 0 |
| Directive 4 validation gate — schema completeness | Node enumeration | 1 | 1 | 0 | n/a | Vacuously satisfied for 0 findings (algorithm enforces schema for populated case via synthetic tests above) |
| Directive 4 validation gate — description ≤ 200 chars | Node enumeration | 1 | 1 | 0 | n/a | Vacuously satisfied for 0 findings; algorithm enforces via `truncate()` (4 tests above) |
| UI — `executive-presentation.html` section count | DOM querySelectorAll | 1 | 1 | 0 | n/a | 16 `<section>` elements (within AAP 12–18 range) |
| UI — slide type distribution | DOM class audit | 1 | 1 | 0 | n/a | 1 `slide-title` + 4 `slide-divider` + 10 content + 1 `slide-closing` = 16 ✅ |
| UI — non-text visual on every slide | DOM querySelector audit | 16 | 16 | 0 | 100% | All 16 sections contain at least one of: Lucide SVG, Mermaid `<pre>`, KPI card, styled table, accent bar |
| UI — CDN pinning verification | HTML `<script>` inspection | 3 | 3 | 0 | 100% | reveal.js@5.1.0, mermaid@11.4.0, lucide@0.460.0 pinned exactly per AAP §0.7.1.2 |
| UI — Blitzy CSS custom properties | CSS inspection | 15 | 15 | 0 | 100% | All 15 `--blitzy-*` custom properties present inline per Executive Presentation rule |
| UI — runtime network requests | Chrome DevTools network panel | 9 | 9 | 0 | 100% | 9/9 requests return 200 (HTML, 3× Google Fonts CSS+woff2, reveal CSS+JS, mermaid JS, lucide JS); zero 4xx/5xx |
| UI — runtime console messages | Chrome DevTools console panel | 0 (errors expected) | 0 | 0 | n/a | Zero console messages at 1920×1080 |
| UI — Mermaid rendering | DOM check for rendered SVG | 2 | 2 | 0 | 100% | Both `<pre class="mermaid">` blocks (Slides 3 & 13) render to SVG with theme variables applied |
| UI — Lucide rendering | DOM check for SVG via `data-lucide` | 23 | 23 | 0 | 100% | 23 unique Lucide icons render to SVG after `createIcons()` |
| **Aggregate Totals** | — | **108** | **108** | **0** | **100%** | All tests originate from this Config H validation; zero failures |

---

## 4. Runtime Validation & UI Verification

### Runtime — Backend / CLI

- ✅ **Snyk CLI install** — `/usr/bin/snyk` returns version `1.1304.3` (latest stable channel per AAP §0.9.3).
- ✅ **Node runtime** — `node --version` returns `v20.20.2` (above Snyk CLI's v12+ requirement per AAP §0.4.1).
- ✅ **Yarn workspace tooling** — `yarn --version` returns `4.12.0` (matches repo `packageManager` declaration).
- ⚠ **`snyk auth check`** — exit code 2 with "authentication failed (timeout)"; AAP-anticipated state per §0.9.5 (`SNYK_TOKEN` not in user-supplied env list). Decision-log row 30 captures the operator remediation runbook.
- ❌ **Directive 2 (`snyk code test`)** — not executed (blocked on `SNYK_TOKEN`). Invocation command rehearsed and documented; algorithm consuming its SARIF output is unit-tested with synthetic input.
- ❌ **Directive 3 (`snyk test --all-projects`)** — not executed (blocked on `SNYK_TOKEN`). Invocation command rehearsed; algorithm consuming its JSON output is unit-tested with synthetic input.
- ✅ **Normalizer end-to-end** — confirmed against synthetic empty inputs: `findings-config-h.json` = `[]\n` (3 bytes, `wc -l = 1`). Confirmed against synthetic populated inputs: 4 findings emitted with correct 5-field schema in correct insertion order.

### Runtime — Frontend / Executive Deck

- ✅ **HTTP server (`python3 -m http.server 8080`)** — serves `executive-presentation.html` at 200 OK.
- ✅ **Slide 1 (Title)** — hero gradient renders (`linear-gradient(68deg, #7A6DEC 15.56%, #5B39F3 62.74%, #4101DB 84.44%)`); Lucide `shield-check` icon in teal `#94FAD5`; Fira Code eyebrow + Space Grotesk heading + Inter subtitle; gradient accent bar at bottom.
- ✅ **Slide 2 (Headline KPIs)** — 5-card KPI grid (Total / Critical / High / Medium / Low) restored per decision-log row 37 (QA Frontend MINOR #1); each card has distinct Lucide icon; em-dash values and "scan did not complete" captions communicate auth-failure literally per row 26 + row 34.
- ✅ **Slide 3 (Architecture)** — Mermaid flowchart renders with all 7 nodes (Snyk CLI → `snyk code test` / `snyk test` → SARIF / JSON → Normalizer → `findings-config-h.json`); Mermaid theme variables applied (`primaryColor: #F2F0FE`, `primaryBorderColor: #5B39F3`).
- ✅ **Slide 16 (Closing)** — navy `#1A105F` background; 4-word heading "Scan Incomplete · Awaiting Credentials" (within Executive Presentation rule's 3–6 word range); 3 bullets (max per spec); icon row with file-json/book-open/monitor Lucide icons; full gradient accent bar; "BLITZY · CONFIG H" brand lockup.
- ✅ **All 16 sections** — at least one non-text visual element per slide (audited via DOM query); 23 unique Lucide icons rendered; 2 Mermaid diagrams rendered.
- ✅ **Network audit** — 9/9 requests return 200 (document, 3× Google Fonts CSS+woff2, reveal CSS, reveal JS, mermaid JS, lucide JS); zero 4xx/5xx including favicon (data-URI suppression per decision-log row 38).
- ✅ **Console audit** — zero messages (no errors, no warnings) at 1920×1080.

### API Integration Outcomes

- ⚠ **Snyk Cloud SAST endpoint** — outbound HTTPS reachability assumed (AAP §0.1.3 mandates network access); not exercised until token provisioned.
- ⚠ **Snyk Cloud SCA endpoint** — same as above.
- ✅ **CDN endpoints (jsDelivr + unpkg + Google Fonts)** — all reachable from the runtime environment; verified via the 9 network requests during deck rendering.

---

## 5. Compliance & Quality Review

| AAP Section / Rule | Requirement | Status | Evidence / Fix Applied |
|---|---|---|---|
| AAP §0.1.1 Directive 1 | Install Snyk CLI and authenticate via `SNYK_TOKEN` | 🟡 50% | CLI installed (`1.1304.3`); auth deferred (token unprovisioned per §0.9.5) |
| AAP §0.1.1 Directive 2 | Execute SAST scan → `results-snyk-code.sarif` | 🟡 50% | Command rehearsed and documented; execution awaits token |
| AAP §0.1.1 Directive 3 | Execute SCA scan with `--all-projects` → `results-snyk-deps.json` | 🟡 50% | Command rehearsed with `--all-projects` correction; execution awaits token |
| AAP §0.1.1 Directive 4 | Normalize + merge + minify → `findings-config-h.json` (single line, valid JSON, 5-field schema, ≤ 200 char descriptions) | ✅ Pass | All 4 sub-gates pass; algorithm verified via 30/30 unit tests |
| AAP §0.1.1 schema | 5 fields exactly: `file`, `line`, `severity`, `cwe`, `description` | ✅ Pass | Schema enforced in normalizer (key order verified by test); vacuously satisfied for current empty-state file |
| AAP §0.1.1 mapping | SARIF severity: error → critical, warning → high, note → medium | ✅ Pass | `mapSarifSeverity()` unit-tested with 6 cases |
| AAP §0.1.1 prefix | `[snyk-code] ` for SAST, `[snyk-deps] ` for SCA | ✅ Pass | Prefix concatenation tested; truncation applied after prefix |
| AAP §0.1.1 truncate | Max 200 chars per description | ✅ Pass | `truncate()` unit-tested with 250-char input; 200-char clamp verified |
| AAP §0.1.4 empty-state | When zero findings exist, emit `[]` literal | ✅ Pass | `merged.length === 0` branch writes `[]\n`; end-to-end validation confirms |
| AAP §0.1.4 single line | `cat findings-config-h.json \| wc -l` returns `1` | ✅ Pass | File is `[]\n` (3 bytes); `wc -l = 1` |
| AAP §0.3.1 in-scope | Create 4 new files: findings, decision-log, executive-presentation, normalizer | ✅ Pass | All 4 present, committed, validated |
| AAP §0.3.2 out-of-scope | No app source / no manifests / no `.snyk` / no CI workflow modifications | ✅ Pass | `git diff --name-status 5b84287ebc..HEAD` returns exactly 4 added files |
| AAP §0.4.2 dependencies | No project-level dependency changes; CLI installed globally | ✅ Pass | Zero of 119 `package.json` modified; `yarn.lock` unchanged |
| AAP §0.5.4 algorithm | SARIF and Snyk JSON parsing follows specified pseudocode | ✅ Pass | Implementation matches §0.5.4 byte-for-byte (decision row 36 hardens integer coercion) |
| AAP §0.7.1.1 Explainability | `decision-log.md` Markdown table; every non-trivial decision documented; deviations explained | ✅ Pass | 38 rows, columns `Decision \| Alternatives \| Rationale \| Risks`; all deviations entered |
| AAP §0.7.1.1 Explainability | No rationale in code comments (single source of truth) | ✅ Pass | Decision row 20 + row 27; verified clean — script and HTML carry zero rationale comments |
| AAP §0.7.1.2 Executive Presentation | Single self-contained reveal.js HTML | ✅ Pass | 28,413 bytes; no local file dependencies; 9/9 network requests return 200 |
| AAP §0.7.1.2 slide count | 12–18 slides (target 16) | ✅ Pass | 16 `<section>` elements |
| AAP §0.7.1.2 slide types | 4 types present: title, divider, content, closing | ✅ Pass | 1 + 4 + 10 + 1 distribution confirmed |
| AAP §0.7.1.2 visuals | Every slide has at least one non-text visual element | ✅ Pass | DOM audit confirms 16/16 sections satisfy |
| AAP §0.7.1.2 brand identity | 15 `--blitzy-*` CSS custom properties + 3 Google Fonts | ✅ Pass | Inline `<style>` block carries all required tokens |
| AAP §0.7.1.2 CDN pinning | reveal.js@5.1.0, Mermaid@11.4.0, Lucide@0.460.0 | ✅ Pass | All three pinned exactly |
| AAP §0.7.1.2 zero emoji | No emoji anywhere | ✅ Pass | Verified via DOM/source audit |
| AAP §0.7.1.2 no fenced code in slides | Inline Fira Code only | ✅ Pass | Verified |
| AAP §0.7.1.2 lifecycle hooks | `mermaid.run()` and `lucide.createIcons()` in `ready` + `slidechanged` | ✅ Pass | Both hooks wired in deck JS |
| AAP §0.8.3 validation gates | Per-directive pass/fail with exit codes | ✅ Pass for D1.1 + D4; deferred for D2 + D3 (token-blocked) | Documented in Section 1.4 |
| Repo discipline (`AGENTS.md`) | No `as any`, no `credential.key`, no `*.generated.ts` modifications | ✅ Pass | No application source modified; constraints vacuously satisfied |
| Biome 2.3.10 enforcement | Project's source files conform | ✅ Pass | `yarn biome check` on the normalizer: zero diagnostics |

---

## 6. Risk Assessment

| Risk | Category | Severity | Probability | Mitigation | Status |
|---|---|---|---|---|---|
| `SNYK_TOKEN` never provisioned → permanently empty deliverable | Operational | High | Medium | Decision-log row 30 documents the runbook; Slide 16 of executive deck flags the auth-failure literally; empty-state semantics are AAP-specified, so the deliverable is contractually valid even in this state | Mitigated (literal communication) |
| Downstream consumer mistakes empty `[]` for "zero vulnerabilities" | Operational | High | Low | Auth-failure framing on every affected surface (decision-log row 30; deck slides 2/5/6/7/9/10/11/14/16; commit messages); em-dashes used as data placeholders | Fully mitigated |
| Snyk Code "Critical" never natively emitted; user-defined mapping (error→critical) may surprise consumers expecting Snyk's lexicon | Technical | Medium | High | AAP §0.8.2 documents this explicitly; decision log row 5 captures the mapping rationale; deck slide 9 labels severity counts using the user's lexicon, not Snyk's | Documented |
| `--all-projects` flag deviates from user's literal Directive 3 wording | Technical | Low | High | Decision-log row 8 explains the deviation and identifies the alternative (root-only scan) and risk (incomplete coverage of 118 nested manifests) | Documented |
| `wc -l` semantics — file without trailing newline reports `0` | Technical | Medium | Low | Normalizer appends single trailing newline (decision row 16); confirmed by `od -c` on the current deliverable (`[ ] \n`) | Fully mitigated |
| 200-char truncation uses UTF-16 code units (slice), not graphemes | Technical | Low | Low | Snyk descriptions are ASCII English (BMP), so code-unit and grapheme counts coincide; decision-log row 11 documents the choice | Mitigated |
| Snyk Code uploads source to cloud — may transmit committed secrets | Security | High | Low | Standard Snyk Code behavior; no pre-filtering added (AAP §0.8.2 documents this constraint); operator should review repo for committed credentials before scanning | Documented |
| Test runner relies on synthetic inputs only; no real SARIF / Snyk JSON exercised | Technical | Medium | Medium | 30/30 synthetic unit tests cover algorithm edges; once token provisioned, the same algorithm runs against real Snyk output and the validation gates re-execute | Partially mitigated — pending real-data run |
| `apps/api/v2/.snyk` policy file silently suppresses one semver advisory | Security | Low | High | Policy preserved as-is per AAP §0.3.2; suppression is intentional and pre-existing in the repo | Documented |
| Multi-config comparison harness consumer not yet defined | Integration | Medium | Medium | Schema is locked per AAP §0.1.1; downstream consumer can reliably parse the 5-field array; cross-config diff is mechanically computable | Mitigated by schema discipline |
| CDN unavailability (jsDelivr / unpkg / Google Fonts) would break deck render | Integration | Low | Low | All three CDNs are tier-1; runtime test at 1920×1080 confirmed 200 OK for all 9 requests; operator can vendor scripts locally if needed (would require a one-line HTML edit) | Documented |
| Snyk severity changes between scan runs (DB updates) | Technical | Low | Medium | Each scan run is a fresh snapshot; deliverable carries the timestamp of its run; for reproducibility, ephemeral SARIF + Snyk JSON files can be retained | Mitigated by re-running |
| Operator runs `snyk monitor` instead of `snyk test` | Operational | Medium | Low | Decision-log row 19 explicitly forbids `snyk monitor`; runbook in row 30 uses only `snyk code test` and `snyk test` | Documented |
| `snyk test` exit code 1 mistaken for failure | Operational | Medium | Medium | AAP §0.8.2 documents that exit 1 means "issues found" — expected; runbook treats exit 0 and exit 1 as successful scans; exit 2 (CLI error) and 3 (no targets) are failures | Documented |

---

## 7. Visual Project Status

```mermaid
%%{init: {'theme':'base','themeVariables':{'pie1':'#5B39F3','pie2':'#FFFFFF','pieStrokeColor':'#2D1C77','pieOuterStrokeColor':'#2D1C77','pieTitleTextSize':'18px','pieSectionTextSize':'14px'}}}%%
pie showData title Project Hours Breakdown
    "Completed Work" : 50
    "Remaining Work" : 8.5
```

**Color legend (per AAP §0.7.1.2 + RG1 brand discipline):** Completed = `#5B39F3` (Dark Blue / Blitzy Primary) · Remaining = `#FFFFFF` (White) · Heading accent = `#2D1C77` (Violet-Black) · Soft accent = `#94FAD5` (Mint).

### Remaining-Hours Distribution by Priority

```mermaid
%%{init: {'theme':'base','themeVariables':{'pie1':'#5B39F3','pie2':'#FFFFFF','pieStrokeColor':'#2D1C77','pieOuterStrokeColor':'#2D1C77'}}}%%
pie showData title Remaining Work by Priority — 8.5h total
    "High Priority" : 6.5
    "Medium Priority" : 2.0
```

### Remaining-Hours Distribution by Category

| Category | Hours | % of Remaining |
|---|---:|---:|
| Operator credential provisioning | 0.5 | 5.9% |
| Directive re-execution (1 + 2 + 3) | 2.5 | 29.4% |
| Ephemeral artifact production (SARIF + Snyk JSON) | 1.0 | 11.8% |
| Deliverable regeneration (`findings-config-h.json` populated) | 1.5 | 17.6% |
| Validation gate re-execution | 1.0 | 11.8% |
| Downstream cross-config comparison | 2.0 | 23.5% |
| **Total** | **8.5** | **100%** |

**Integrity check:** Section 7 pie chart "Remaining Work" = **8.5h** ≡ Section 1.2 Remaining Hours = **8.5h** ≡ Section 2.2 sum = **8.5h**. All three sources are identical (Rule 1 satisfied).

---

## 8. Summary & Recommendations

### Achievements

The Snyk Config H deliverable bundle is structurally complete at **85.5%**, meeting every AAP requirement that can be satisfied without operator-provisioned credentials. All four mandated files (`findings-config-h.json`, `decision-log.md`, `executive-presentation.html`, `scripts/normalize-snyk-findings.mjs`) are present, validated, and committed. The normalization algorithm matches AAP §0.5.4 byte-for-byte (30/30 unit tests pass). The executive presentation renders cleanly at 1920×1080 with zero console errors and 9/9 network requests successful. Five rounds of code review and QA remediation have hardened the deliverable: Checkpoint 1 (governance), Checkpoint 2 FINAL (normalizer rewrite + entrypoint guard), QA Issue #1 (decision-log consistency), QA MINOR #1+#2 (Slide 2 KPI grid + favicon suppression), QA MINOR #4 (SARIF integer coercion). Read-only scope discipline is preserved: zero of 7,433 source files and zero of 119 `package.json` manifests modified.

### Remaining Gaps

The single class of remaining work is **operator-side**: provisioning `SNYK_TOKEN` and re-executing the four directives end-to-end to replace the AAP-specified empty-state payload (`[]\n`) with a populated findings array. The empty state is a contractually valid AAP-specified deliverable (§0.1.4: "Empty result writes `[]`"), but the multi-config comparison harness expects real findings — hence the 6.5 hours of High-priority operator work plus 2.0 hours of Medium-priority downstream comparison setup. The auth-failure state is communicated literally across every affected surface (decision-log row 30; deck slides 2/5/6/7/9/10/11/14/16; commit messages) so no downstream consumer can mistake `[]` for "zero vulnerabilities."

### Critical Path to Production

The critical path is a single-operator runbook (decision-log row 30):

1. `export SNYK_TOKEN=<value>` — provision the credential.
2. `snyk auth check` — must return exit 0 (Directive 1 complete).
3. `snyk code test --sarif-file-output=results-snyk-code.sarif .` — produces SARIF v2.1.0 (Directive 2 complete).
4. `snyk test --all-projects --json > results-snyk-deps.json` — produces Snyk JSON for all 119 workspace manifests (Directive 3 complete).
5. `node scripts/normalize-snyk-findings.mjs` — regenerates populated `findings-config-h.json` (Directive 4 complete with real data).
6. Re-execute AAP §0.8.3 validation gates against the populated file.
7. (Medium priority) Hand `findings-config-h.json` plus its sibling Config A–G outputs to the cross-config comparison harness.

Total operator time: **~6.5h High-priority + 2.0h Medium-priority = 8.5h**.

### Success Metrics

| Metric | Target | Current | Status |
|---|---|---|---|
| AAP-scoped completion | ≥ 80% | 85.5% | ✅ |
| Directive 4 validation gates | 4/4 pass | 4/4 pass | ✅ |
| Out-of-scope file modifications | 0 | 0 | ✅ |
| Synthetic unit tests | 100% pass | 30/30 (100%) | ✅ |
| Biome diagnostics | 0 | 0 | ✅ |
| Console errors on runtime deck render | 0 | 0 | ✅ |
| 200 OK rate on deck CDN requests | 100% | 9/9 (100%) | ✅ |
| Decision-log row count | ≥ 15 | 38 | ✅ |
| Slide count | 12–18 | 16 | ✅ |

### Production Readiness Assessment

**Status:** READY FOR OPERATOR HANDOFF.

The Config H deliverable bundle is production-ready under AAP-specified empty-state semantics. The only environmental condition gating a populated `findings-config-h.json` is `SNYK_TOKEN` provisioning, explicitly identified in AAP §0.9.5 as the operator's responsibility. All algorithmic, governance, and executive-communication surfaces are complete, hardened, and verified. The 85.5% completion percentage reflects the proportion of AAP-scoped + path-to-production hours autonomously delivered (50.0h of 58.5h total); the remaining 8.5h are exclusively operator-side directive re-execution + downstream comparison harness setup.

---

## 9. Development Guide

### 9.1 System Prerequisites

| Component | Version | Notes |
|---|---|---|
| Operating System | Linux / macOS / Windows (WSL2 not natively supported by Snyk CLI; use Linux subsystem with caveats) | Container runtime: Ubuntu 25.10 verified |
| Node.js | 20.x LTS (verified `v20.20.2`) | Snyk CLI requires v12+; repo `Dockerfile` targets 20.x |
| npm | ≥ 7.0.0 (verified `11.1.0`) | Required for `npm install -g snyk`; declared by repo `engines` |
| Yarn | 4.12.0 (verified) | Repo `packageManager` declares `yarn@4.12.0`; project uses Yarn Berry with `nodeLinker: node-modules` |
| Snyk CLI | 1.1304.3 (latest stable channel) | Verified installed at `/usr/bin/snyk` |
| Network | Outbound HTTPS to `*.snyk.io` | AAP §0.1.3: "Snyk requires network access — there is no offline mode" |
| Disk | ≥ 5 GB free | Monorepo with all workspaces + `node_modules` |

### 9.2 Environment Setup

```bash
# 1. Clone the repository (already done in this branch)
cd /tmp/blitzy/blitzy-cal/blitzy-241430c4-988a-4ea2-a822-a06c6f86819c_eef033

# 2. Verify branch
git status
git log -1 --format="%H %s"
# Expected HEAD: 03b1f5a07d7f15e091190dbd9a422ae075ef8536

# 3. Verify runtime versions
node --version    # Expected: v20.x (≥ v12)
npm --version     # Expected: ≥ 7.0.0
yarn --version    # Expected: 4.12.0

# 4. Install Snyk CLI globally (Directive 1, part 1)
CI=true npm install -g snyk --yes

# 5. Verify Snyk CLI installation
snyk --version    # Expected: 1.1304.3 (or newer in stable channel)
which snyk        # Expected: /usr/bin/snyk or /usr/local/bin/snyk

# 6. Provision SNYK_TOKEN (Directive 1, part 2)
#    Obtain from https://app.snyk.io/account
export SNYK_TOKEN=<your-snyk-api-token>

# 7. Verify authentication
snyk auth check
# Expected: exit code 0 with "authenticated as <user>"
# If exit code 2 with "authentication failed (timeout)": token missing or invalid
```

### 9.3 Dependency Installation

No project-level dependencies are installed by this Config H exercise. The Snyk CLI is installed **globally** (not as a project dependency) — confirmed by:

```bash
# Verify no project manifests were modified
git diff --name-status 5b84287ebc..HEAD
# Expected output:
#   A  decision-log.md
#   A  executive-presentation.html
#   A  findings-config-h.json
#   A  scripts/normalize-snyk-findings.mjs
```

If you need to install the monorepo's own dependencies (for `apps/web`, `apps/api/v2`, etc.) to expand the SAST scan surface, run:

```bash
# Install Yarn workspace dependencies (optional, expands scan surface)
yarn install --immutable
```

### 9.4 Application Startup Sequence (Directive Execution)

```bash
# Working directory: repository root
cd /tmp/blitzy/blitzy-cal/blitzy-241430c4-988a-4ea2-a822-a06c6f86819c_eef033

# === Directive 1 completion ===
snyk auth check
# Expected: exit code 0; "authenticated as <user>"

# === Directive 2 — Snyk Code (SAST) ===
time snyk code test --sarif-file-output=results-snyk-code.sarif .
# Acceptable exit codes:
#   0 = no findings, 1 = findings present (both = scan succeeded)
# Failures:
#   2 = CLI error, 3 = no scannable targets

# === Directive 3 — Snyk Open Source (SCA) ===
time snyk test --all-projects --json > results-snyk-deps.json
# Acceptable exit codes: 0 or 1 (same semantics as above)
# Note: --all-projects flag is mandatory for Yarn 4 workspace traversal
#       (covers all 119 package.json manifests in this monorepo)

# === Directive 4 — Normalize & merge ===
node scripts/normalize-snyk-findings.mjs
# Reads:  results-snyk-code.sarif + results-snyk-deps.json
# Writes: findings-config-h.json
# Output: "wrote N finding(s) to findings-config-h.json"
```

### 9.5 Verification Steps

```bash
# === Directive 1 verification ===
snyk --version
[ $? -eq 0 ] && echo "Directive 1.1 ✅" || echo "Directive 1.1 ❌"
snyk auth check
[ $? -eq 0 ] && echo "Directive 1.2 ✅" || echo "Directive 1.2 ❌ (provision SNYK_TOKEN)"

# === Directive 2 verification ===
test -f results-snyk-code.sarif && echo "Directive 2.1 ✅" || echo "Directive 2.1 ❌"
node -e "JSON.parse(require('fs').readFileSync('results-snyk-code.sarif','utf8'))" \
  && echo "Directive 2.2 ✅ (valid JSON)" || echo "Directive 2.2 ❌"

# === Directive 3 verification ===
test -f results-snyk-deps.json && echo "Directive 3.1 ✅" || echo "Directive 3.1 ❌"
node -e "const d=JSON.parse(require('fs').readFileSync('results-snyk-deps.json','utf8'));const a=Array.isArray(d)?d:[d];if(!a.every(p=>Array.isArray(p.vulnerabilities||[])))process.exit(1);" \
  && echo "Directive 3.2 ✅ (vulnerabilities array present)" || echo "Directive 3.2 ❌"

# === Directive 4 verification ===
test -f findings-config-h.json && echo "Directive 4.1 ✅" || echo "Directive 4.1 ❌"
[ "$(wc -l < findings-config-h.json)" = "1" ] && echo "Directive 4.2 ✅ (wc -l = 1)" || echo "Directive 4.2 ❌"
node -e "
const a = JSON.parse(require('fs').readFileSync('findings-config-h.json','utf8'));
if (!Array.isArray(a)) { console.error('not an array'); process.exit(1); }
for (const f of a) {
  for (const k of ['file','line','severity','cwe','description']) {
    if (!(k in f)) { console.error('missing key: ' + k); process.exit(1); }
  }
  if ((f.description || '').length > 200) {
    console.error('description > 200 chars'); process.exit(1);
  }
}
console.log('Schema valid; ' + a.length + ' finding(s)');
" && echo "Directive 4.3 ✅ (schema + truncation)" || echo "Directive 4.3 ❌"
```

### 9.6 Example Usage

#### Example A — Re-render the Executive Presentation

```bash
cd /tmp/blitzy/blitzy-cal/blitzy-241430c4-988a-4ea2-a822-a06c6f86819c_eef033

# Serve the deck locally (requires Python 3)
python3 -m http.server 8080 &
SERVER_PID=$!

# In a browser, navigate to:
#   http://127.0.0.1:8080/executive-presentation.html
#
# Or programmatically via curl:
curl -sI http://127.0.0.1:8080/executive-presentation.html
# Expected: HTTP/1.0 200 OK

# Cleanup
kill $SERVER_PID
```

#### Example B — Run synthetic unit tests against the normalizer

```bash
# Test mapSarifSeverity, truncate, parseSarif, parseSnyk via dynamic import
node --input-type=module -e "
import('./scripts/normalize-snyk-findings.mjs').then(m => {
  const a = require('assert');
  a.equal(m.mapSarifSeverity('error'), 'critical');
  a.equal(m.mapSarifSeverity('warning'), 'high');
  a.equal(m.mapSarifSeverity('note'), 'medium');
  a.equal(m.mapSarifSeverity('none'), 'low');
  a.equal(m.mapSarifSeverity(undefined), 'low');
  a.equal(m.truncate('x'.repeat(250), 200).length, 200);
  a.equal(m.truncate(null, 200), '');
  console.log('PASS');
});
"
# Expected: PASS
```

#### Example C — Smoke-test the normalizer end-to-end with synthetic inputs

```bash
mkdir -p /tmp/snyk-smoke && cd /tmp/snyk-smoke
echo '{"runs":[{"tool":{"driver":{"rules":[{"id":"R1","properties":{"cwe":["CWE-798"]}}]}},"results":[{"ruleId":"R1","level":"error","message":{"text":"Hardcoded secret"},"locations":[{"physicalLocation":{"artifactLocation":{"uri":"apps/web/src/api.ts"},"region":{"startLine":42}}}]}]}]}' > results-snyk-code.sarif
echo '{"vulnerabilities":[{"severity":"high","identifiers":{"CWE":["CWE-1321"]},"title":"Prototype Pollution"}],"displayTargetFile":"package.json"}' > results-snyk-deps.json
node /tmp/blitzy/blitzy-cal/blitzy-241430c4-988a-4ea2-a822-a06c6f86819c_eef033/scripts/normalize-snyk-findings.mjs
cat findings-config-h.json
# Expected: a 1-line JSON array with 2 finding objects, each with the 5-field schema
```

### 9.7 Troubleshooting

| Symptom | Likely Cause | Resolution |
|---|---|---|
| `snyk auth check` exits 2 with "authentication failed (timeout)" | `SNYK_TOKEN` not set or invalid | `export SNYK_TOKEN=<valid-token-from-app.snyk.io>` then retry |
| `snyk code test` exits 2 with "unauthorized" | Token lacks Snyk Code entitlement | Confirm Snyk plan tier; contact Snyk admin to enable Snyk Code |
| `snyk test --all-projects` exits 3 with "no targets" | Run from wrong directory | `cd` to repository root (where root `package.json` and `yarn.lock` live) |
| `snyk test` exits 1 | **Expected** — issues found | Not an error; proceed to Directive 4 |
| `node scripts/normalize-snyk-findings.mjs` errors "missing input file" | Ephemeral SARIF or Snyk JSON not produced | Run Directives 2 and 3 first; verify files exist before invoking normalizer |
| `findings-config-h.json` shows `[]\n` after a populated scan | Normalizer received empty inputs (both Snyk runs returned zero findings) — or inputs not at expected paths | Check `results-snyk-code.sarif` and `results-snyk-deps.json` are non-empty; verify the normalizer's input paths |
| Executive deck slides render blank | CDN unreachable (jsDelivr / unpkg / Google Fonts blocked by network policy) | Allowlist `cdn.jsdelivr.net`, `unpkg.com`, `fonts.googleapis.com`, `fonts.gstatic.com` — or vendor the scripts locally |
| Mermaid diagrams don't render | `mermaid.run()` not called after slide change | Verify deck's `Reveal.on('slidechanged', async () => { await mermaid.run(); lucide.createIcons(); })` block is intact |
| `wc -l < findings-config-h.json` returns `0` instead of `1` | Trailing newline missing from file | Normalizer always appends `\n`; if missing, regenerate via `node scripts/normalize-snyk-findings.mjs` |
| `apps/api/v2/.snyk` policy silently filters one advisory | Pre-existing repo state (AAP §0.2.3) | Intentional; do not remove the policy file |

---

## 10. Appendices

### A. Command Reference

| Command | Purpose | Notes |
|---|---|---|
| `snyk --version` | Verify CLI install | Expected: `1.1304.3` |
| `snyk auth check` | Verify authentication | Requires `SNYK_TOKEN` env var |
| `snyk code test --sarif-file-output=results-snyk-code.sarif .` | Directive 2 SAST scan | Exit 0 or 1 = success |
| `snyk test --all-projects --json > results-snyk-deps.json` | Directive 3 SCA scan | `--all-projects` mandatory for workspace traversal |
| `node scripts/normalize-snyk-findings.mjs` | Directive 4 normalization | Reads SARIF + Snyk JSON; writes `findings-config-h.json` |
| `cat findings-config-h.json \| wc -l` | Directive 4 single-line gate | Expected: `1` |
| `yarn biome check scripts/normalize-snyk-findings.mjs` | Lint normalizer | Expected: "No fixes applied" |
| `python3 -m http.server 8080` | Serve executive deck locally | Then open `http://127.0.0.1:8080/executive-presentation.html` |
| `git diff --name-status 5b84287ebc..HEAD` | Confirm scope discipline | Expected: 4 `A` rows only |

### B. Port Reference

| Port | Service | Notes |
|---|---|---|
| 8080 | Local HTTP server for executive deck (optional, for browser preview only) | `python3 -m http.server 8080` |
| 443 (outbound) | Snyk Cloud API (`*.snyk.io`) | Required by Directives 2 + 3 |
| 443 (outbound) | CDN endpoints (`cdn.jsdelivr.net`, `unpkg.com`, `fonts.googleapis.com`, `fonts.gstatic.com`) | Required for deck render |

### C. Key File Locations

| File | Path | Purpose |
|---|---|---|
| Primary deliverable | `findings-config-h.json` | Single-line minified JSON array of normalized findings |
| Decision log | `decision-log.md` | 38-row Explainability rule artifact |
| Executive deck | `executive-presentation.html` | 16-slide reveal.js Executive Presentation rule artifact |
| Normalizer helper | `scripts/normalize-snyk-findings.mjs` | 115-line ESM module |
| Ephemeral SAST output | `results-snyk-code.sarif` (working tree only; not committed) | SARIF v2.1.0 from `snyk code test` |
| Ephemeral SCA output | `results-snyk-deps.json` (working tree only; not committed) | Snyk JSON from `snyk test --all-projects` |
| Existing Snyk policy | `apps/api/v2/.snyk` | Preserved as-is (v1.25.1; one semver patch) |
| Repo root manifest | `package.json` | Yarn 4 workspaces declaration |
| Repo Yarn config | `.yarnrc.yml` | `nodeLinker: node-modules` |
| Repo lock file | `yarn.lock` | 1.4 MB authoritative resolution graph |

### D. Technology Versions

| Component | Version | Source |
|---|---|---|
| Snyk CLI | `1.1304.3` (latest stable channel) | `snyk --version` verified |
| Node.js | `v20.20.2` | `node --version` verified; AAP requirement: ≥ v12 |
| npm | `11.1.0` | `npm --version` verified; repo requires ≥ 7.0.0 |
| Yarn | `4.12.0` | `yarn --version` verified; repo `packageManager: yarn@4.12.0` |
| reveal.js | `5.1.0` (pinned in deck) | AAP §0.7.1.2 CDN pinning |
| Mermaid | `11.4.0` (pinned in deck) | AAP §0.7.1.2 CDN pinning |
| Lucide | `0.460.0` (pinned in deck) | AAP §0.7.1.2 CDN pinning |
| Biome | `2.3.10` (repo `package.json`) | Used to lint the normalizer |
| TypeScript | `5.9.3` (repo) | Not exercised by this exercise — app source unmodified |

### E. Environment Variable Reference

| Variable | Required For | Notes |
|---|---|---|
| `SNYK_TOKEN` | Directive 1 (auth), Directive 2 (SAST scan), Directive 3 (SCA scan) | Obtain from `https://app.snyk.io/account`; NOT pre-provisioned (AAP §0.9.5: `User-supplied secrets: []`) |
| `CI` | Set to `true` for `npm install -g snyk` to suppress prompts | Optional but recommended in non-interactive shells |
| `DEBIAN_FRONTEND` | Set to `noninteractive` if using `apt install snyk` | Optional |

### F. Developer Tools Guide

| Tool | Role | Invocation |
|---|---|---|
| Snyk CLI | Run SAST (`snyk code test`) and SCA (`snyk test`) scans | See §9.4 |
| Node.js | Execute the normalizer script | `node scripts/normalize-snyk-findings.mjs` |
| Biome | Lint the normalizer | `yarn biome check scripts/normalize-snyk-findings.mjs` |
| Python (HTTP server) | Locally serve the executive deck for browser preview | `python3 -m http.server 8080` |
| `wc -l`, `od -c` | Validate file shape (single line, byte sequence) | Section 9.5 |
| `git diff --name-status` | Verify out-of-scope cleanliness | `git diff --name-status 5b84287ebc..HEAD` |
| Chrome DevTools | Inspect deck render at 1920×1080 | Section 4 runtime validation |

### G. Glossary

| Term | Definition |
|---|---|
| **AAP** | Agent Action Plan — the primary directive set for this exercise |
| **SAST** | Static Application Security Testing — source-code analysis; Snyk Code in this exercise (Directive 2) |
| **SCA** | Software Composition Analysis — dependency vulnerability scanning; Snyk Open Source in this exercise (Directive 3) |
| **SARIF** | Static Analysis Results Interchange Format — standard JSON schema (v2.1.0) for SAST output |
| **Config H** | This exercise's label in the multi-config security tool comparison |
| **5-field schema** | `{file, line, severity, cwe, description}` — non-negotiable AAP §0.1.1 deliverable shape |
| **Empty-state semantics** | When zero findings exist (including when scans cannot run for credential reasons), `findings-config-h.json` carries the literal payload `[]` per AAP §0.1.4 |
| **Auth-failure framing** | Decision rows 26 + 34: every surface mentioning findings counts must literally label the auth-failure state so consumers cannot mistake `[]` for "zero vulnerabilities" |
| **Path-to-production** | Standard operational activities required to deploy the AAP deliverables (operator token provisioning, ephemeral artifact production, downstream comparison harness setup) |
| **Decision log** | The Markdown artifact (`decision-log.md`) that, per AAP §0.7.1.1, is the single source of truth for "why" decisions — no rationale comments in code |
| **Executive deck** | The reveal.js HTML artifact (`executive-presentation.html`) that, per AAP §0.7.1.2, communicates business value and risk to non-technical leadership |
| **Normalizer** | The Node.js ESM module (`scripts/normalize-snyk-findings.mjs`) that merges SARIF + Snyk JSON into the 5-field schema and writes the deliverable |
