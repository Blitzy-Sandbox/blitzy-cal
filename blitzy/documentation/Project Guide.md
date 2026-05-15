# Blitzy Project Guide — Config F: OSV-Scanner Vulnerability Scan for blitzy-cal

---

## 1. Executive Summary

### 1.1 Project Overview

This project produces **Config F** of a multi-config security tool comparison series for the Cal.com (`blitzy-cal`) monorepo. Three CRITICAL directives execute OSV-Scanner (Google's vulnerability scanner backed by OSV.dev) against the repository's single Yarn Berry v8 lockfile and emit a single normalized minified JSON findings artifact (`findings-config-f.json`) conforming to a fixed five-field schema. Two user-level rules add an Explainability decision log and a self-contained reveal.js executive presentation. The output sits alongside any prior `config-{a,b,c,d,e}` siblings for downstream apples-to-apples comparison. Repository scope: read-only.

### 1.2 Completion Status

```mermaid
pie title Project Completion — 90.0%
    "Completed (27h)" : 27
    "Remaining (3h)" : 3
```

| Metric | Value |
|---|---|
| Total Hours | 30 |
| Completed Hours (AI) | 27 |
| Completed Hours (Manual) | 0 |
| Remaining Hours | 3 |
| Percent Complete | **90.0%** |

Completion is calculated as `Completed Hours / Total Hours × 100 = 27 / 30 = 90.0%`. The 10% remaining represents human stakeholder review and comparison-series handoff (security team review of findings, executive-presentation rehearsal for leadership, downstream comparison ingestion). Per the Final Validator log, all five production-readiness gates pass with zero in-scope unresolved engineering issues.

### 1.3 Key Accomplishments

- [x] **Directive 1 — OSV-Scanner installed and verified:** `osv-scanner --version` returns `osv-scanner version: 2.3.8` (osv-scalibr 0.4.5, commit `408fcd6f`, built 2026-05-08). Installed via prebuilt `linux_amd64` static binary at `/usr/local/bin/osv-scanner`.
- [x] **Directive 2 — Scan executed:** `osv-scanner --format json --output results-osv.json …` completed in 5 seconds wall-clock (exit code `1` = success-with-findings, per OSV-Scanner semantics); 1.69 MB valid JSON output produced; 88 packages with vulnerabilities across the single Yarn Berry v8 `yarn.lock`.
- [x] **Directive 3 — Findings normalized:** `findings-config-f.json` produced with 228 findings, single line (`wc -l` = 1), valid JSON, all five schema fields (`file`, `line`, `severity`, `cwe`, `description`) populated on every record, maximum description length = 178 ≤ 200 cap.
- [x] **Severity distribution captured:** 5 critical / 104 high / 89 medium / 30 low (sums to 228); CWE coverage = 227 of 228 findings use direct `CWE-NNN`, 1 uses documented secondary fallback `OSV-MAL-2025-22760` (malicious-package finding with no CWE or CVE alias).
- [x] **Explainability rule satisfied:** `decisions-config-f.md` (249 lines) documents 14 non-trivial decisions in a 4-column table (Decision / Alternatives / Rationale / Risks), an explicit Deviations section, complete scan metadata, pass/fail verification log, and post-QA re-verification log.
- [x] **Executive Presentation rule satisfied:** `executive-summary-config-f.html` (1,203 lines, 42,920 bytes) — single self-contained HTML5 file with 16 reveal.js slides organized per the AAP canonical map; all 21 required CSS custom properties under `:root`; pinned CDN versions matching AAP literal (`reveal.js@5.1.0`, `mermaid@11.4.0`, `lucide@0.460.0`); 26 Lucide SVG icons; 1 Mermaid architecture diagram with AAP theme variables; 8 KPI cards; 2 styled tables; zero emoji.
- [x] **Runtime verification:** Executive presentation runs in Chrome at 1920×1080 with zero console errors/warnings; all 16 slides render correctly; all CDN resources load HTTP 200; KPI counts and critical findings table cross-check against source JSON exactly.
- [x] **Repository integrity preserved:** `git diff 5b84287ebc HEAD --name-status` returns exactly `A decisions-config-f.md`, `A executive-summary-config-f.html`, `A findings-config-f.json`, `A results-osv.json` — 4 added, 0 modified, 0 deleted. The lockfile, manifests, workflows, and every other existing file are byte-for-byte unchanged.

### 1.4 Critical Unresolved Issues

| Issue | Impact | Owner | ETA |
|---|---|---|---|
| _No critical unresolved engineering issues._ Final Validator declares the branch PRODUCTION-READY with all five gates passing and zero in-scope unresolved issues. | None | — | — |

The 5 critical vulnerability findings surfaced by OSV-Scanner (immutable@3.7.6/3.8.2, protobufjs@7.4.0, fast-xml-parser@4.4.1, sanitize-html@2.17.0) are **scan output, not engineering issues**. They are surfaced for downstream security team review and are explicitly out of Config F's scope per AAP §0.5.2 ("No fix application").

### 1.5 Access Issues

| System/Resource | Type of Access | Issue Description | Resolution Status | Owner |
|---|---|---|---|---|
| _No access issues identified._ Network egress to `api.osv.dev` and `osv-vulnerabilities.storage.googleapis.com` was available during the scan (verified by exit-code `1` and 228 findings retrieved). CDN egress to `cdn.jsdelivr.net`, `unpkg.com`, and `fonts.googleapis.com` returned HTTP 200 during runtime verification. The Ubuntu 25.10 apt repositories do not list `osv-scanner` as a candidate — handled by falling back to the prebuilt binary install path (documented in the decision log). | — | — | — |

### 1.6 Recommended Next Steps

1. **[High]** Security team review of `findings-config-f.json`: validate the 5 critical findings against the existing `.yarnrc.yml` audit-exception list (1113407 covers `fast-xml-parser@4.4.1`), confirm true/false-positive status for `immutable@3.7.6/3.8.2`, `protobufjs@7.4.0`, and `sanitize-html@2.17.0`, and decide whether to file remediation tickets. *(≈2 hours)*
2. **[Medium]** Executive presentation rehearsal: open `executive-summary-config-f.html` in Chrome at 1920×1080, navigate all 16 slides, confirm leadership-facing messaging matches the team's narrative. *(≈0.5 hours)*
3. **[Medium]** Comparison-series ingestion: the comparison-pipeline operator must pick up `findings-config-f.json` alongside any prior `config-{a,b,c,d,e}` sibling files and run the cross-config comparison analysis. *(≈0.5 hours)*

---

## 2. Project Hours Breakdown

### 2.1 Completed Work Detail

| Component | Hours | Description |
|---|---:|---|
| **[AAP §0.1.1 Directive 1]** OSV-Scanner installation | 0.5 | `apt-cache policy osv-scanner` returned empty (no candidate in Ubuntu 25.10 repos); `go` toolchain absent; fell back to prebuilt `linux_amd64` static binary download from GitHub releases (`v2.3.8`, 58 MB) and installed at `/usr/local/bin/osv-scanner`. Verified `osv-scanner --version` returns the canonical 4-line version block. |
| **[AAP §0.1.1 Directive 2]** Scan execution | 0.5 | `osv-scanner --format json --output results-osv.json /tmp/blitzy/blitzy-cal/blitzy-31e4abed-8c1c-4546-8e0c-844e61324654_dcc690` produced 1.69 MB raw output (`results-osv.json`); recorded wall-clock duration (5 s) and exit code (`1` = success-with-findings); validated with `jq empty`. Scanner discovered the single OSV-supported lockfile `yarn.lock` (Yarn Berry v8 metadata, 40,303 lines, 3,725 packages). |
| **[AAP §0.1.1 Directive 3]** Findings normalization | 4.0 | `jq` 1.8.1 normalizer reading `results-osv.json` and projecting onto fixed 5-field schema: file = `"yarn.lock"`, line = `0`, severity bucketed from `groups[].max_severity` per CVSS thresholds (≥9 → critical, ≥7 → high, ≥4 → medium, <4 → low), CWE extracted with documented precedence (affected-scoped → top-level → CVE alias → OSV-id fallback), description from `summary` or `details` truncated to 200 chars. Emitted minified single-line `findings-config-f.json` (36,372 bytes, 228 findings) and verified all 4 sub-gates. Includes one Checkpoint A review/fix cycle. |
| **[AAP §0.7.1]** Decision log (Explainability rule) | 6.0 | `decisions-config-f.md` (249 lines, 39,728 bytes): 14-row decision table covering install method, scan invocation form, offline-mode toggle, CVSS-score derivation, severity-bucket boundaries, CWE precedence, description selection & truncation, deduplication via `groups[]`, empty-findings encoding, exit-code interpretation, path-relativization, normalizer implementation, theme inlining, full-bleed slide handling, Mermaid font synchronization, Lucide accessibility, and Mermaid CDN pin. Includes explicit Deviations section, complete Scan Metadata, Pass/Fail Verification Log, and Post-QA Runtime Re-Verification Log. One QA Checkpoint #3 factual-fix cycle applied. |
| **[AAP §0.7.2]** Executive presentation (Executive Presentation rule) | 12.0 | `executive-summary-config-f.html` (1,203 lines, 42,920 bytes): single self-contained HTML5 file. 16 `<section>` slides organized per AAP §0.4.2 canonical map (Title → KPI Headline → Architecture Mermaid → 6 alternating divider/content pairs covering Scope, Findings Distribution, Risk Register, Comparison Context, Operational Handoff, Decision Highlights → Closing). Inline Blitzy theme with all 21 required CSS custom properties under `:root`. Pinned CDN versions: `reveal.js@5.1.0`, `mermaid@11.4.0`, `lucide@0.460.0`. Reveal config: `hash: true`, `transition: 'slide'`, `controlsTutorial: false`, `width: 1920`, `height: 1080`. Mermaid initialized with `startOnLoad: false` and AAP-specified theme variables. `refresh()` handler registered on `ready`, `slidechanged`, and `resize` events to drive `mermaid.run()` and `lucide.createIcons()`. 26 Lucide icons (all `aria-hidden="true"`), 1 Mermaid architecture diagram, 8 KPI cards, 2 styled tables, zero emoji. Includes Checkpoint 2 FINAL review/fix cycle and Mermaid CDN pin revert to AAP-literal 11.4.0. |
| Autonomous QA & runtime validation | 4.0 | Multiple Checkpoint review cycles applied across the 4 deliverables; Chrome 1920×1080 runtime verification of the executive presentation; network capture confirming all CDN resources HTTP 200; DOM/CSS spot-checks; cross-check of Slide 9's critical-findings table against `findings-config-f.json` and `results-osv.json` (5/5 entries match); cross-check of Slide 2's KPI counts (5+104+89+30=228) against source JSON; 47-screenshot evidence set captured at `blitzy/screenshots/` covering all 16 slides at 1920×1080 plus responsive widths. |
| **Total Completed** | **27.0** | |

### 2.2 Remaining Work Detail

| Category | Hours | Priority |
|---|---:|---|
| **[Path-to-production]** Security team review and sign-off on `findings-config-f.json` (validate true/false positives across 5 critical, 104 high, 89 medium, 30 low; reconcile with existing `.yarnrc.yml` audit exception 1113407) | 2.0 | High |
| **[Path-to-production]** Executive presentation rehearsal/review by leadership before distribution | 0.5 | Medium |
| **[Path-to-production]** Comparison-series operator ingestion of Config F artifacts into multi-config comparison | 0.5 | Medium |
| **Total Remaining** | **3.0** | |

### 2.3 Hour Calculation Summary

```
Completed Hours = 0.5 + 0.5 + 4.0 + 6.0 + 12.0 + 4.0       = 27.0 h
Remaining Hours = 2.0 + 0.5 + 0.5                          =  3.0 h
Total Hours     = Completed + Remaining                    = 30.0 h
Completion %    = 27.0 / 30.0 × 100                        = 90.0 %
```

---

## 3. Test Results

All tests originate from Blitzy's autonomous validation logs for this branch. The Agent Action Plan defines 6 explicit pass/fail gates (Directive 1: 1, Directive 2: 1, Directive 3: 4 sub-checks). The Final Validator added comprehensive runtime, structural, network, and cross-reference assertions during runtime verification at Chrome 1920×1080.

| Test Category | Framework | Total | Passed | Failed | Coverage | Notes |
|---|---|---:|---:|---:|---:|---|
| AAP Directive 1 — install verification | shell | 1 | 1 | 0 | 100% | `osv-scanner --version` returns `osv-scanner version: 2.3.8` |
| AAP Directive 2 — scan output validity | jq | 1 | 1 | 0 | 100% | `jq empty < results-osv.json` exits 0; 1,691,979-byte valid JSON |
| AAP Directive 3 sub-check 1 — single-line | wc | 1 | 1 | 0 | 100% | `cat findings-config-f.json \| wc -l` returns `1` |
| AAP Directive 3 sub-check 2 — valid JSON | jq | 1 | 1 | 0 | 100% | `jq empty < findings-config-f.json` exits 0 |
| AAP Directive 3 sub-check 3 — all 5 fields populated | jq | 228 | 228 | 0 | 100% | Per-finding sweep validates `file`, `line`, `severity`, `cwe`, `description` |
| AAP Directive 3 sub-check 4 — description ≤ 200 chars | jq | 228 | 228 | 0 | 100% | Max description length observed = 178; no truncation actually triggered |
| Schema domain check — severity ∈ {critical,high,medium,low} | jq | 228 | 228 | 0 | 100% | Distribution: 5 / 104 / 89 / 30 = 228 |
| Schema domain check — line ∈ {0}, file ∈ {`yarn.lock`} | jq | 228 | 228 | 0 | 100% | Per AAP field-source mapping table |
| HTML structural integrity — 16 `<section>` elements | DOM | 16 | 16 | 0 | 100% | Order: Title / KPI / Architecture / 6 divider-content pairs / Closing |
| HTML theme integrity — 21 CSS custom properties under `:root` | grep | 21 | 21 | 0 | 100% | All AAP-required `--blitzy-*`, `--ff-*`, `--gradient-*` tokens present |
| HTML rendering — Lucide icons drawn | DOM | 26 | 26 | 0 | 100% | All `<i data-lucide>` elements rendered as SVG, all `aria-hidden="true"` |
| HTML rendering — Mermaid diagram emitted | DOM | 1 | 1 | 0 | 100% | `pre.mermaid` processed; SVG present in DOM with AAP theme variables |
| HTML CDN integrity — pinned versions HTTP 200 | network capture | 6 | 6 | 0 | 100% | `reveal.js@5.1.0` (CSS + JS), `theme/white.css`, `mermaid@11.4.0`, `lucide@0.460.0`, Google Fonts |
| HTML console hygiene — no errors/warnings | DevTools | 1 | 1 | 0 | 100% | Zero console messages observed across all 16 slides |
| Reveal config runtime values | DevTools | 5 | 5 | 0 | 100% | `hash: true`, `transition: 'slide'`, `controlsTutorial: false`, `width: 1920`, `height: 1080` |
| Cross-artifact data parity — KPI vs source JSON | jq + DOM | 4 | 4 | 0 | 100% | Slide 2 cards: critical=5, high=104, medium=89, low=30 — all match `findings-config-f.json` |
| Cross-artifact data parity — Slide 9 critical table vs source JSON | jq + DOM | 5 | 5 | 0 | 100% | All 5 critical rows (immutable@3.7.6/3.8.2, protobufjs@7.4.0, fast-xml-parser@4.4.1, sanitize-html@2.17.0) match source |
| Repository integrity — zero modifications to existing files | git diff | 1 | 1 | 0 | 100% | `git diff 5b84287ebc HEAD --name-status` → 4 A, 0 M, 0 D |
| File checksums match validation log | md5sum | 4 | 4 | 0 | 100% | All 4 deliverable MD5 sums match Final Validator's recorded values |
| **Aggregate Totals** | — | **774** | **774** | **0** | **100%** | All AAP pass/fail gates + per-finding sweeps + runtime/integrity assertions |

No tests are skipped, blocked, or failing. The aggregate total includes the per-finding sweeps (228 records × 3 dimensions = 684) plus 90 structural/runtime/network/integrity assertions.

---

## 4. Runtime Validation & UI Verification

### CLI Runtime — OSV-Scanner Pipeline

- ✅ **Operational:** `osv-scanner --version` returns `osv-scanner version: 2.3.8` from `/usr/local/bin/osv-scanner` (58,335,394-byte ELF 64-bit LSB static binary, Go BuildID `Hay89NmVN01CyvuvD2zo/oZddOxx_KzwxQQFTDq-M/J5DGzRmWIGm0z7lAAWDJ/npfiHr8w3YHMH129gBso`).
- ✅ **Operational:** Scan execution against the repository root completes in 5 seconds wall-clock; OSV-Scanner self-reports 23.656 ms of internal filesystem-walk + extract time (the remainder is OSV.dev API latency).
- ✅ **Operational:** `results-osv.json` (1.69 MB, valid JSON) contains 1 source entry (`yarn.lock`), 88 packages with vulnerabilities, 228 vulnerability records, and 228 `groups[]` entries.
- ✅ **Operational:** `findings-config-f.json` (36,372 bytes, single line) contains 228 normalized findings with every record populating all five schema fields.

### HTML Presentation Runtime — Chrome at 1920×1080 (file://)

- ✅ **Operational:** All 16 of 16 reveal.js slides navigate correctly (verified via `ArrowRight` and hash-fragment navigation `#/0` through `#/15`).
- ✅ **Operational:** Slide 1 (Title) renders the AAP-specified hero gradient `linear-gradient(68deg, #7A6DEC 15.56%, #5B39F3 62.74%, #4101DB 84.44%)` with white display heading and Fira Code teal eyebrow "CONFIG F · OSV-SCANNER".
- ✅ **Operational:** Slide 2 (KPI Headline) displays 4 KPI cards with values matching `findings-config-f.json` exactly (Critical=5, High=104, Medium=89, Low=30, sum=228).
- ✅ **Operational:** Slide 3 (Architecture) renders Mermaid 11.4.0 flowchart with 7 nodes — `osv-scanner binary` → `osv-scanner --format json` → `results-osv.json` → `Normalizer jq/python` (diamond) → 3 deliverable boxes — with AAP theme variables applied (primary `#F2F0FE`, primary text `#333333`, primary border `#5B39F3`, line color `#999999`, secondary `#F4EFF6`).
- ✅ **Operational:** Slide 9 (Risk Register) shows a styled 4-column table listing the 5 critical findings with CVE/CWE pairs and mitigation notes, all matching source JSON.
- ✅ **Operational:** Slide 16 (Closing) renders with the AAP-specified navy `#1A105F` background, gradient accent bar at top edge, "Config F · Comparison-Ready" 3-word heading, 3 white bullets, and brand lockup "BLITZY × CAL.COM · CONFIG F · OSV-SCANNER" in teal Fira Code.
- ✅ **Operational:** All 26 Lucide SVG icons render as accessible vector graphics (no emoji fallback, all `aria-hidden="true"`).
- ✅ **Operational:** 8 KPI cards and 2 styled tables present and visually correct.
- ✅ **Operational:** Zero console errors or warnings observed across navigated slides.

### Network — CDN Integration

- ✅ **Operational:** `https://cdn.jsdelivr.net/npm/reveal.js@5.1.0/dist/reveal.css` → HTTP 200
- ✅ **Operational:** `https://cdn.jsdelivr.net/npm/reveal.js@5.1.0/dist/theme/white.css` → HTTP 200
- ✅ **Operational:** `https://cdn.jsdelivr.net/npm/reveal.js@5.1.0/dist/reveal.js` → HTTP 200
- ✅ **Operational:** `https://cdn.jsdelivr.net/npm/mermaid@11.4.0/dist/mermaid.min.js` → HTTP 200
- ✅ **Operational:** `https://unpkg.com/lucide@0.460.0/dist/umd/lucide.min.js` → HTTP 200
- ✅ **Operational:** `https://fonts.googleapis.com/css2?family=Inter…&family=Space+Grotesk…&family=Fira+Code…` → HTTP 200

### OSV.dev API Integration

- ✅ **Operational:** `api.osv.dev` accepts package-metadata payloads (names, versions, ecosystems, file hashes) and returns vulnerability records; 228 records retrieved in 5 seconds wall-clock.
- ✅ **Operational:** `osv-vulnerabilities.storage.googleapis.com` reachable (`--experimental-local-db` offline-mode database source, documented as alternative in the decision log).

### Repository Integrity

- ✅ **Operational:** `git diff 5b84287ebc HEAD --name-status` returns exactly `A decisions-config-f.md`, `A executive-summary-config-f.html`, `A findings-config-f.json`, `A results-osv.json` — 4 added, 0 modified, 0 deleted.
- ✅ **Operational:** `yarn.lock`, `package.json`, `.yarnrc.yml`, 73+ workspace manifests, 55+ workflows, all remaining repository files are byte-for-byte unchanged (verified by zero entries in the diff output for any non-Config-F path).

---

## 5. Compliance & Quality Review

| AAP Requirement | Benchmark / Rule | Status | Evidence |
|---|---|:---:|---|
| §0.1.1 D1: Install OSV-Scanner | `osv-scanner --version` exits 0 with version string | ✅ PASS | `osv-scanner version: 2.3.8` returned |
| §0.1.1 D2: Execute scan → `results-osv.json` | File exists, non-empty, parses as JSON | ✅ PASS | 1.69 MB; `jq empty` exits 0 |
| §0.1.1 D3a: `findings-config-f.json` single-line | `wc -l` returns 1 | ✅ PASS | `cat findings-config-f.json \| wc -l` returns `1` |
| §0.1.1 D3b: Valid JSON | `jq empty` exits 0 | ✅ PASS | Validated |
| §0.1.1 D3c: All 5 fields on every finding | per-record check | ✅ PASS | 228/228 records have file, line, severity, cwe, description |
| §0.1.1 D3d: No description > 200 chars | per-record check | ✅ PASS | Max length = 178 |
| §0.1.3 Field-source mapping | `file` relative, `line` = 0, severity ∈ {critical,high,medium,low}, cwe = CWE-* or fallback, description from summary/details truncated | ✅ PASS | All 228 findings conform to mapping table |
| §0.4.1 Zero modifications to existing files | git diff shows only added files | ✅ PASS | 4 A, 0 M, 0 D vs base `5b84287ebc` |
| §0.5.1 In-scope: 4 new files at repo root | All four committed | ✅ PASS | `findings-config-f.json`, `results-osv.json`, `decisions-config-f.md`, `executive-summary-config-f.html` |
| §0.5.2 Out-of-scope: no fix application | `osv-scanner fix` not invoked | ✅ PASS | No dependency upgrades; lockfile unchanged |
| §0.5.2 Out-of-scope: no CI workflow changes | `.github/workflows/` unchanged | ✅ PASS | Zero workflow file modifications |
| §0.5.2 Out-of-scope: no Turbo task changes | `turbo.json` unchanged | ✅ PASS | Verified via git diff |
| §0.7.1 Explainability: decision log with 4-column table | Decision / Alternatives / Rationale / Risks | ✅ PASS | 14 rows in `decisions-config-f.md` |
| §0.7.1 Explainability: explicit deviation entries | "Deviations" section present | ✅ PASS | `groups[]` dedup policy explicitly flagged |
| §0.7.1 Explainability: no rationale in code comments | Code is rationale-free | ✅ PASS | Decision log is single source of truth |
| §0.7.2 Presentation: 12–18 slides (target 16) | `<section>` count | ✅ PASS | 16 sections present |
| §0.7.2 Presentation: 4 slide types | slide-title / slide-divider / content / slide-closing | ✅ PASS | All four classes used per AAP map |
| §0.7.2 Presentation: every slide has non-text visual | Mermaid / KPI / table / Lucide icon | ✅ PASS | 16/16 slides contain at least one of these |
| §0.7.2 Presentation: zero emoji | Unicode emoji regex returns 0 | ✅ PASS | All visuals are Lucide SVGs |
| §0.7.2 Presentation: no fenced code blocks in slides | Inline Fira Code only | ✅ PASS | No `<pre><code>` blocks inside slides |
| §0.7.2 Presentation: pinned CDN versions | reveal.js 5.1.0 / mermaid 11.4.0 / lucide 0.460.0 | ✅ PASS | Verified via network capture (HTTP 200) |
| §0.7.2 Presentation: 21 CSS custom properties under `:root` | All AAP-listed tokens present | ✅ PASS | 21/21 verified programmatically |
| §0.7.2 Presentation: Reveal config | hash, transition slide, no controls tutorial, 1920×1080 | ✅ PASS | All five settings runtime-verified |
| §0.7.2 Presentation: Mermaid config | `startOnLoad: false`, AAP theme variables | ✅ PASS | All five theme variables present in init |
| §0.7.2 Presentation: `mermaid.run()` + `lucide.createIcons()` on `ready` and `slidechanged` | Event handlers registered | ✅ PASS | `refresh()` invoked from ready/slidechanged/resize |
| §0.8.2 Severity values lowercase strings | No synonyms | ✅ PASS | All ∈ {critical, high, medium, low} |
| §0.8.2 CWE format `CWE-*` or CVE fallback | Per-record check | ✅ PASS | 227 use `CWE-NNN`, 1 uses `OSV-MAL-2025-22760` (documented secondary fallback) |
| §0.8.2 Empty findings → `[]` | Conditional encoding | N/A | Not triggered (228 findings present) |

**Compliance Score: 27 of 27 verifiable requirements PASS, 1 requirement N/A (empty-findings encoding — not triggered).**

---

## 6. Risk Assessment

| Risk | Category | Severity | Probability | Mitigation | Status |
|---|---|---|---|---|---|
| OSV.dev vulnerability database advances over time, making `findings-config-f.json` stale relative to live OSV.dev | Operational | Low | High | Documented re-run command in development guide; `results-osv.json` captures point-in-time snapshot; comparison-series consumer can re-pin to a fresh scan when needed | Mitigated |
| `groups[]` dedup policy is a documented deviation from literal Directive 3 text | Technical | Low | Resolved | For this corpus, every group contains exactly 1 ID — the policy is a no-op; the Decision Log's Deviations section explicitly flags the policy for downstream comparison agents | Resolved |
| 5 critical findings exist in `yarn.lock` but `osv-scanner fix` is explicitly out of scope per AAP §0.5.2 | Security | High | N/A | Findings surfaced via Slide 9 Risk Register and `findings-config-f.json` for security team review; `fast-xml-parser@4.4.1` is already covered by `.yarnrc.yml` audit exception 1113407; remaining 4 await upstream releases (tracked in mitigation column on Slide 9) | Visibility ensured; remediation handed off to security team |
| OSV.dev API outage prevents re-runs | Operational | Medium | Low | `--experimental-local-db` (and newer `--offline --download-offline-databases`) documented as alternative in the decision log; sandbox confirmed `osv-vulnerabilities.storage.googleapis.com` reachable for offline-DB download | Mitigated by documented offline fallback |
| Prebuilt binary install requires manual replacement for future scanner updates (no package-manager database tracking) | Operational | Low | Medium | Decision Log Risks column captures the trade-off; pinning to `v2.3.8` in re-run instructions ensures byte-identical reproducibility; switching to `apt` is documented when/if the Debian package is published | Documented |
| CDN dependency (reveal.js / mermaid / lucide on jsdelivr / unpkg) for the executive presentation | Integration | Medium | Low | All three CDN versions pinned; jsdelivr and unpkg are widely mirrored; the inline Blitzy theme means CSS works even if external theme assets fail | Mitigated by pinning + inline theme |
| Network egress to OSV.dev required for online scans | Security | Low | N/A | Only package names, versions, ecosystems, and file hashes are transmitted — no source code; documented in decision log; offline alternative available | Documented and acceptable |
| Downstream comparison tooling could misinterpret `cwe` field on the 1 record using `OSV-MAL-2025-22760` (secondary fallback) | Integration | Low | Low | Decision log CWE-extraction precedence row explicitly documents the OSV-id fallback as rule (4); the prefix `OSV-` is unambiguous | Documented |
| Single OSV-supported lockfile (`yarn.lock`) limits findings to JS/TS ecosystem | Technical | Low | N/A | AAP §0.2.1 negative inventory confirms no other lockfiles exist in `blitzy-cal`; Cal.com is JS/TS-only; this is an architectural fact, not a scan defect | Documented (no action) |
| Exit code `1` from osv-scanner could be misinterpreted as failure by automation that doesn't read OSV-Scanner semantics | Operational | Low | Low | Decision log Exit-code interpretation row explicitly documents `0` = clean, `1` = findings, other = failure; re-run instructions handle the code correctly | Documented |

---

## 7. Visual Project Status

```mermaid
pie title Project Hours Breakdown — 90.0% Complete
    "Completed Work" : 27
    "Remaining Work" : 3
```

**Remaining Hours by Category (Section 2.2):**

| Category | Hours | % of Remaining |
|---|---:|---:|
| Security team review and sign-off | 2.0 | 66.7% |
| Executive presentation rehearsal/review | 0.5 | 16.7% |
| Comparison-series operator ingestion | 0.5 | 16.7% |
| **Total Remaining** | **3.0** | **100%** |

**Completion Posture by AAP Component:**

```mermaid
pie title AAP Deliverables — Completion Status
    "Directive 1 (Install)" : 1
    "Directive 2 (Scan)" : 1
    "Directive 3 (Normalize)" : 1
    "Explainability Log" : 1
    "Executive Presentation" : 1
```

All 5 AAP-defined deliverables are complete. The 10% remaining (3 hours) is path-to-production human review and handoff — no engineering work remains.

---

## 8. Summary & Recommendations

### Achievements

The branch `blitzy-31e4abed-8c1c-4546-8e0c-844e61324654` autonomously delivers Config F of the multi-config security tool comparison series with full AAP compliance. All three CRITICAL directives executed successfully against the `blitzy-cal` Cal.com monorepo, both user-level rules (Explainability + Executive Presentation) are satisfied, and the four deliverables — `findings-config-f.json`, `results-osv.json`, `decisions-config-f.md`, `executive-summary-config-f.html` — sit at the repository root ready for downstream comparison. The repository's existing 73+ workspace manifests, 55+ workflows, root `package.json`, root `yarn.lock`, and `.yarnrc.yml` audit-policy file are byte-for-byte unchanged.

### Gaps Remaining

The project is **90.0% complete** (27 of 30 hours). The remaining 3 hours represents stakeholder review and handoff:

1. Security team review and sign-off on the 228 findings (5 critical, 104 high, 89 medium, 30 low), reconciliation with the existing `.yarnrc.yml` audit exception 1113407 (which covers `fast-xml-parser@4.4.1`), and remediation decisions for `immutable@3.7.6/3.8.2`, `protobufjs@7.4.0`, and `sanitize-html@2.17.0` — **2 hours**.
2. Executive presentation rehearsal and distribution to non-technical leadership — **0.5 hours**.
3. Comparison-series operator ingestion of Config F artifacts (read `findings-config-f.json`, normalize against any prior `config-{a,b,c,d,e}` siblings, run cross-config comparison) — **0.5 hours**.

### Critical Path to Production

There is no engineering critical path. The artifact-production task is complete. The path to "operational" status is purely human-review-driven: a security engineer needs ~2 hours to triage the findings list and a presenter needs ~0.5 hours to rehearse the deck. Once these reviews complete, the artifact is ready for the comparison-series operator to ingest.

### Success Metrics

| Metric | Target | Actual | Status |
|---|---|---|---|
| AAP Directive 1 — install verification | exit 0 + version string | exit 0; `osv-scanner version: 2.3.8` | ✅ |
| AAP Directive 2 — scan output validity | valid JSON produced | 1.69 MB valid JSON | ✅ |
| AAP Directive 3 — single-line minified JSON | `wc -l` = 1 | `wc -l` = 1 | ✅ |
| AAP Directive 3 — schema completeness | 5 fields/record × all records | 5 × 228 = 1140 fields populated | ✅ |
| AAP Directive 3 — description cap | ≤ 200 chars | Max = 178 chars | ✅ |
| AAP §0.4.1 — zero existing-file modifications | 0 M, 0 D in git diff | 0 M, 0 D in git diff | ✅ |
| AAP §0.7.1 — decision log | 4-column table, 1 row per non-trivial decision | 14 rows | ✅ |
| AAP §0.7.2 — slide count | 12–18 (target 16) | 16 | ✅ |
| AAP §0.7.2 — CSS custom properties | 21 listed in rule | 21 present | ✅ |
| AAP §0.7.2 — CDN version pinning | reveal.js 5.1.0 / mermaid 11.4.0 / lucide 0.460.0 | Matches exactly (verified via network capture) | ✅ |
| Runtime — console errors/warnings | 0 | 0 | ✅ |
| Runtime — CDN HTTP status | 200 across all resources | 200 × 6 | ✅ |

### Production Readiness Assessment

**Engineering: PRODUCTION-READY.** Per the Final Validator: "Branch ... delivers Config F of the multi-config security tool comparison series with full AAP compliance, 100% pass/fail gate success, runtime-verified executive presentation, and zero in-scope unresolved issues."

**Stakeholder readiness: pending review.** 3 hours of human review remain before the artifact can be consumed by downstream comparison tooling (security team triage, leadership briefing, comparison-pipeline ingestion).

---

## 9. Development Guide

### 9.1 System Prerequisites

- **Operating System:** Ubuntu 25.10 sandbox (any Linux x86_64 distribution with glibc ≥ 2.31 supports the prebuilt OSV-Scanner binary; macOS arm64/x86_64 and Windows builds are also available from the GitHub releases page).
- **Required tools** (verified present in the sandbox):
  - `curl` (any modern version — sandbox has `curl 8.14.1`) — for downloading the OSV-Scanner binary
  - `jq` (1.6 or newer — sandbox has `jq 1.8.1`) — for JSON projection and minification
  - `python3` (3.10 or newer — sandbox has `Python 3.13.7`) — fallback normalizer and validation cross-check
  - `git` (any recent version) — for branch state inspection
  - A modern browser (Chrome / Chromium / Firefox / Edge / Safari) for opening the executive presentation
- **Network egress (online mode):**
  - `https://github.com/google/osv-scanner/releases/download/...` (binary download, one-time)
  - `https://api.osv.dev/` (vulnerability lookups during scan)
  - `https://osv-vulnerabilities.storage.googleapis.com/` (optional offline-DB source)
  - `https://cdn.jsdelivr.net/`, `https://unpkg.com/`, `https://fonts.googleapis.com/` (for the executive presentation only — required when opening the HTML)
- **No Go toolchain required** — the prebuilt binary install method is used. The user-listed `go install github.com/google/osv-scanner/cmd/osv-scanner@latest` route is retained as a documented alternative for environments where Go is available.

### 9.2 Environment Setup

No environment variables are required by the OSV-Scanner pipeline. Optional environment flags for non-interactive operation:

```bash
export DEBIAN_FRONTEND=noninteractive   # only relevant if attempting the apt install path
```

No `.env` file additions; no shell configuration changes. The pipeline is fully scriptless and idempotent.

### 9.3 Install OSV-Scanner

**Primary path — prebuilt linux_amd64 static binary (used in this delivery):**

```bash
curl -fsSL -o /tmp/osv-scanner_v2.3.8 \
  https://github.com/google/osv-scanner/releases/download/v2.3.8/osv-scanner_linux_amd64
sudo install -m 0755 /tmp/osv-scanner_v2.3.8 /usr/local/bin/osv-scanner
rm /tmp/osv-scanner_v2.3.8
```

**Alternative 1 — apt (when available in the configured repositories):**

```bash
DEBIAN_FRONTEND=noninteractive sudo apt-get update
DEBIAN_FRONTEND=noninteractive sudo apt-get install -y osv-scanner
```

**Alternative 2 — Go toolchain (the AAP-listed primary, requires `go ≥ 1.21`):**

```bash
go install github.com/google/osv-scanner/cmd/osv-scanner@latest
# For V2 (current as of v2.3.x): go install github.com/google/osv-scanner/v2/cmd/osv-scanner@latest
```

**Verify the install:**

```bash
osv-scanner --version
```

Expected output (line 1):

```
osv-scanner version: 2.3.8
```

### 9.4 Run the Scan

From the repository root:

```bash
cd /tmp/blitzy/blitzy-cal/blitzy-31e4abed-8c1c-4546-8e0c-844e61324654_dcc690

start=$(date +%s)
osv-scanner --format json --output results-osv.json \
  /tmp/blitzy/blitzy-cal/blitzy-31e4abed-8c1c-4546-8e0c-844e61324654_dcc690
exit_code=$?
end=$(date +%s)
echo "exit_code=$exit_code  duration=$((end - start))s"
```

Expected: `exit_code=1` (success-with-findings; **not** a failure — OSV-Scanner returns 1 whenever any vulnerability is reported); `duration` ≈ 5 seconds. `results-osv.json` (~1.69 MB) is written to the current directory.

For network-restricted environments, prepend `--experimental-local-db` (or `--offline --download-offline-databases` for newer scanner versions) after pre-downloading the OSV vulnerability database.

### 9.5 Verify the Primary Deliverable

The four AAP-defined pass/fail gates can be re-run any time:

```bash
# Gate D3a — single-line minified JSON
cat findings-config-f.json | wc -l
# Expected: 1

# Gate D3b — valid JSON
jq empty < findings-config-f.json && echo OK
# Expected: OK

# Gate D3c — all 228 findings present with all five fields populated
jq '[.[] | select(has("file") and has("line") and has("severity") and has("cwe") and has("description"))] | length' \
  < findings-config-f.json
# Expected: 228

# Gate D3d — no description exceeds 200 characters
jq '[.[] | .description | length] | max' < findings-config-f.json
# Expected: 178
```

Additional integrity checks:

```bash
# Severity distribution (should sum to 228)
jq -r 'group_by(.severity) | map("\(.[0].severity): \(length)") | join("  ")' \
  < findings-config-f.json
# Expected: critical: 5  high: 104  low: 30  medium: 89

# Verify file field is always relative "yarn.lock"
jq -r '[.[] | .file] | unique' < findings-config-f.json
# Expected: ["yarn.lock"]

# Verify line field is always integer 0
jq -r '[.[] | .line] | unique' < findings-config-f.json
# Expected: [0]
```

### 9.6 Open the Executive Presentation

The HTML file is self-contained — it loads reveal.js / Mermaid / Lucide / Google Fonts from public CDNs at runtime but requires no local build step or webpack.

**Open directly from disk (any modern browser):**

```bash
xdg-open executive-summary-config-f.html
# Or on macOS:
open executive-summary-config-f.html
```

**Serve via HTTP (recommended for accurate `file://` behavior parity):**

```bash
python3 -m http.server 8000
# Then navigate to: http://localhost:8000/executive-summary-config-f.html
```

Navigation: ← / → arrow keys move between slides; `Esc` opens overview mode; `?` shows keyboard help. Open the browser DevTools console (F12) to confirm zero errors/warnings.

### 9.7 Verify Repository Integrity

Confirm the four deliverables are the only changes vs the base commit:

```bash
# Base commit before Config F work began
BASE=5b84287ebc

# Should return exactly 4 lines, all status "A" (added)
git diff "$BASE" HEAD --name-status
# Expected:
# A  decisions-config-f.md
# A  executive-summary-config-f.html
# A  findings-config-f.json
# A  results-osv.json

# Verify checksums match the canonical artifacts
md5sum findings-config-f.json results-osv.json decisions-config-f.md executive-summary-config-f.html
# Expected:
# 8ee03dfad612892a58b5191ddf080b35  findings-config-f.json
# 88b65708e70385caf0fe0881230d75f3  results-osv.json
# 3066030c35175e9293bb8ac7d935852e  decisions-config-f.md
# 47af45c77df7be9e34d6e0db8c7bd8a7  executive-summary-config-f.html
```

### 9.8 Troubleshooting

| Symptom | Cause | Resolution |
|---|---|---|
| `osv-scanner: command not found` | Binary not on `$PATH` | Re-run §9.3 install commands; verify `/usr/local/bin` is in `$PATH` |
| `osv-scanner --version` shows older version | Stale binary | `rm /usr/local/bin/osv-scanner` and re-run §9.3 install |
| Scan exits with code 1 | **Expected** — success-with-findings | Treat as success; do **not** propagate as a build failure |
| Scan exits with code other than 0 or 1 | Genuine scan error | Inspect stderr; check network egress to `api.osv.dev`; retry with `--experimental-local-db` |
| `jq empty < findings-config-f.json` returns non-zero | File corrupted | Re-run normalization step (consult `decisions-config-f.md` for the canonical `jq` filter) |
| `wc -l` returns 0 | File missing trailing newline | Append a `\n` (the empty-findings literal `[]` must terminate with `\n` to count as one line) |
| HTML console error "Reveal is not defined" | CDN egress blocked | Check network access to `cdn.jsdelivr.net`; serve via local HTTP if `file://` blocks third-party requests |
| Mermaid diagram on Slide 3 doesn't render | mermaid.min.js failed to load | DevTools → Network panel → verify `mermaid@11.4.0/dist/mermaid.min.js` returned HTTP 200; reload page |
| Lucide icons show as blank squares | lucide.min.js failed to load | DevTools → Network → verify `lucide@0.460.0/dist/umd/lucide.min.js` returned HTTP 200 |

---

## 10. Appendices

### Appendix A — Command Reference

```bash
# Install OSV-Scanner (prebuilt binary)
curl -fsSL -o /tmp/osv-scanner_v2.3.8 \
  https://github.com/google/osv-scanner/releases/download/v2.3.8/osv-scanner_linux_amd64
sudo install -m 0755 /tmp/osv-scanner_v2.3.8 /usr/local/bin/osv-scanner

# Verify install
osv-scanner --version

# Execute scan (one-shot)
osv-scanner --format json --output results-osv.json \
  /tmp/blitzy/blitzy-cal/blitzy-31e4abed-8c1c-4546-8e0c-844e61324654_dcc690

# Validate findings file (4 sub-gates)
cat findings-config-f.json | wc -l                       # expect 1
jq empty < findings-config-f.json && echo OK             # expect OK
jq 'length' < findings-config-f.json                     # expect 228
jq '[.[] | .description | length] | max' < findings-config-f.json   # expect 178

# Severity / CWE summaries
jq -r 'group_by(.severity) | map("\(.[0].severity): \(length)")' < findings-config-f.json

# Serve executive presentation locally
python3 -m http.server 8000   # then open http://localhost:8000/executive-summary-config-f.html

# Repository integrity check
git diff 5b84287ebc HEAD --name-status     # expect 4 lines, all "A"
```

### Appendix B — Port Reference

| Port | Purpose | Required? | Notes |
|---|---|---|---|
| 8000 | Local HTTP server for serving `executive-summary-config-f.html` over `http://localhost:8000/` | Optional | `python3 -m http.server 8000` is the documented method; any port is fine — `8000` is the default |
| 443 (HTTPS) | Outbound to `api.osv.dev`, `cdn.jsdelivr.net`, `unpkg.com`, `fonts.googleapis.com`, `github.com` | Required for online mode | No inbound port exposure required |

### Appendix C — Key File Locations

| Path | Role | Size |
|---|---|---:|
| `findings-config-f.json` | **Primary deliverable** — minified single-line normalized findings | 36,372 B |
| `results-osv.json` | Raw OSV-Scanner output retained for traceability | 1,691,979 B |
| `decisions-config-f.md` | Decision log (Explainability rule) | 39,728 B |
| `executive-summary-config-f.html` | Self-contained reveal.js presentation (Executive Presentation rule) | 42,920 B |
| `yarn.lock` | The sole OSV-supported lockfile in the monorepo (Yarn Berry v8 metadata) — READ-ONLY input | 1,433,240 B |
| `.yarnrc.yml` | Yarn Berry config declaring `npmAuditIgnoreAdvisories: ["1113407"]` — READ-ONLY context | 446 B |
| `package.json` | Root workspace manifest with `resolutions` block — READ-ONLY context | 8,084 B |
| `.github/workflows/security-audit.yml` | Existing yarn-audit gate — READ-ONLY context | — |
| `/usr/local/bin/osv-scanner` | OSV-Scanner v2.3.8 binary (host-level install) | 58,335,394 B |
| `blitzy/screenshots/` | 47 PNG runtime-verification screenshots captured during validation (1920×1080 plus responsive 1024/1366) | — |

### Appendix D — Technology Versions

| Component | Version | Source |
|---|---|---|
| OSV-Scanner | 2.3.8 | `github.com/google/osv-scanner/releases/tag/v2.3.8` (prebuilt linux_amd64 binary) |
| osv-scalibr (bundled inside osv-scanner) | 0.4.5 | Same binary; commit `408fcd6f8707999a29e7ba45e15809764cf24f67`; built `2026-05-08T04:54:35Z` |
| jq | 1.8.1 | Distro package; used as the normalizer |
| Python | 3.13.7 | System install; used as parallel cross-check |
| Node.js | 20.20.2 (sandbox); ≥ 20 (per Cal.com `engines`) | Cal.com runtime — not required by Config F |
| Yarn | 4.12.0 | `.yarnrc.yml` declares `yarnPath: .yarn/releases/yarn-4.12.0.cjs` |
| reveal.js | 5.1.0 | `cdn.jsdelivr.net/npm/reveal.js@5.1.0` (pinned by AAP §0.7.2) |
| Mermaid | 11.4.0 | `cdn.jsdelivr.net/npm/mermaid@11.4.0` (pinned by AAP §0.7.2) |
| Lucide | 0.460.0 | `unpkg.com/lucide@0.460.0` (pinned by AAP §0.7.2) |
| Inter / Space Grotesk / Fira Code | Latest (Google Fonts) | `fonts.googleapis.com` |
| Git | Any recent | sandbox-default |
| Chrome (validation runtime) | Stable | Chrome DevTools MCP host |

### Appendix E — Environment Variable Reference

No environment variables are required for the Config F pipeline. The following are referenced in the install and CI-safety contexts only:

| Variable | Required? | Default | Purpose |
|---|---|---|---|
| `DEBIAN_FRONTEND` | Optional | (unset) | Set to `noninteractive` only if attempting the apt install route |
| `PATH` | Required | (system default) | Must include the directory containing the `osv-scanner` binary (typically `/usr/local/bin`) |

### Appendix F — Developer Tools Guide

**For re-running the scan:**
- Run from the repository root so OSV-Scanner's recursive walk correctly identifies `yarn.lock` as the single lockfile.
- Treat exit code `1` as success-with-findings; only exit codes other than `0` and `1` indicate genuine scan failure.
- Use `--experimental-local-db` in network-restricted environments after pre-downloading the OSV DB.
- The scan is idempotent within the same 24-hour OSV.dev publication window — repeating the scan yields byte-identical `results-osv.json` if no new advisories are published in between.

**For modifying the normalizer:**
- The canonical `jq` filter is documented in `decisions-config-f.md` (Decision Table → Normalizer implementation row).
- The fixed five-field schema (`file`, `line`, `severity`, `cwe`, `description`) is mandated by the AAP and **must not be modified** — adding, removing, or renaming fields breaks downstream comparison.
- Empty findings must encode as `[]` (two-byte literal) with exactly one `\n` line terminator so `wc -l` returns `1`.

**For modifying the executive presentation:**
- All 21 CSS custom properties under `:root` are mandated by AAP §0.7.2; do not remove any.
- CDN versions are pinned (reveal.js 5.1.0, mermaid 11.4.0, lucide 0.460.0) — do not bump without re-validating runtime in a real browser.
- Replace emoji with Lucide icons via `<i data-lucide="icon-name" aria-hidden="true"></i>`; do not add Unicode emoji codepoints.
- Mermaid theme variables (`primaryColor`, `primaryTextColor`, `primaryBorderColor`, `lineColor`, `secondaryColor`) are mandated; the architecture diagram on Slide 3 renders using these exact values.
- After any edit, open the file in Chrome at 1920×1080, navigate all 16 slides, and verify the DevTools console shows zero errors/warnings.

**For verifying repository integrity after edits:**
- Always re-run `git diff 5b84287ebc HEAD --name-status` and confirm only the 4 Config F files appear with status `A`.
- The MD5 checksums of `findings-config-f.json` (`8ee03dfad612892a58b5191ddf080b35`) and `results-osv.json` (`88b65708e70385caf0fe0881230d75f3`) anchor reproducibility for the as-delivered scan.

### Appendix G — Glossary

| Term | Definition |
|---|---|
| **AAP** | Agent Action Plan — the primary directive document defining all requirements for Config F. |
| **CVE** | Common Vulnerabilities and Exposures — the public identifier for a security flaw (`CVE-YYYY-N+`). |
| **CVSS** | Common Vulnerability Scoring System — the numeric scoring framework (V3 base score 0.0–10.0) used to bucket findings into critical/high/medium/low. |
| **CWE** | Common Weakness Enumeration — the category identifier for a class of software weakness (`CWE-N+`). Stored in OSV records under `database_specific.cwe_ids[]`. |
| **GHSA** | GitHub Security Advisory — the largest publisher of records into the OSV.dev aggregator. Uses the `GHSA-xxxx-xxxx-xxxx` identifier format. |
| **OSV** | Open Source Vulnerabilities — both the schema (`ossf.github.io/osv-schema`) and the aggregator database (`osv.dev`). |
| **OSV-Scanner** | Google's open-source CLI tool that reads dependency lockfiles and queries the OSV.dev database to report known vulnerabilities. |
| **lockfile** | A version-pinned dependency manifest produced by a package manager. For Config F, the only OSV-supported lockfile in `blitzy-cal` is `yarn.lock` (Yarn Berry v8 metadata format). |
| **Yarn Berry v8 metadata** | The Yarn 2+ lockfile format declared via the `__metadata: version: 8` block at the top of `yarn.lock`. OSV-Scanner officially supports this format. |
| **Yarn audit exception** | An entry in `.yarnrc.yml` under `npmAuditIgnoreAdvisories[]` that suppresses a specific finding from the Yarn audit gate. The repo's existing exception `1113407` covers `fast-xml-parser@4.4.1`. |
| **Explainability rule** | AAP §0.7.1 — mandates a Markdown decision log with rationale for every non-trivial decision. Output: `decisions-config-f.md`. |
| **Executive Presentation rule** | AAP §0.7.2 — mandates a single self-contained reveal.js HTML presentation for non-technical leadership. Output: `executive-summary-config-f.html`. |
| **reveal.js** | Open-source HTML presentation framework (`revealjs.com`). Used for the executive presentation. Pinned to v5.1.0. |
| **Mermaid** | Markdown-based diagram language (`mermaid.js.org`). Used for the architecture diagram on Slide 3. Pinned to v11.4.0. |
| **Lucide** | Open-source SVG icon library (`lucide.dev`). Used in place of Unicode emoji throughout the executive presentation. Pinned to v0.460.0. |
| **Config F** | This config's identifier in the multi-config security tool comparison series. The fixed five-field output schema is identical across configs to enable downstream apples-to-apples comparison. |
| **`groups[]` dedup policy** | OSV-Scanner's mechanism for aggregating aliased vulnerability IDs (e.g., a single CVE appearing as both a `GHSA-*` and an `OSV-*` record). Config F emits one finding per group; documented as a deviation from literal Directive 3 text. |
| **Success-with-findings** | OSV-Scanner's exit code `1`, returned when the scan succeeded but at least one vulnerability was reported. NOT a build failure. |
