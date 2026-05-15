# Blitzy Project Guide — Config I: SonarQube SAST Scan of `blitzy-cal`

---

## 1. Executive Summary

### 1.1 Project Overview

This project delivers **Config I** of a multi-configuration security tool comparison: a one-shot **SonarQube Community Build** Static Application Security Testing (SAST) scan of the `blitzy-cal` (Cal.com) monorepo, executed against an ephemeral Docker-orchestrated server. The work normalizes 263 scanner findings into a flat, minified, single-line JSON artifact (`findings-config-i.json`) conforming to a precise 5-field schema, alongside two rule-mandated companion artifacts: an Explainability decision log and a self-contained reveal.js executive presentation. Target audience: downstream multi-configuration comparison evaluators, security stakeholders, and non-technical leadership. The 5-field JSON is the inter-configuration diff contract.

### 1.2 Completion Status

```mermaid
pie title Config I — Completion Status
    "Completed Work (AI)" : 40
    "Remaining Work" : 4
```

| Metric | Value |
|---|---|
| **Total Project Hours** | **44** |
| Completed Hours (AI + Manual) | 40 |
| Remaining Hours | 4 |
| **Completion** | **91%** |

**Calculation:** 40 completed ÷ (40 completed + 4 remaining) × 100 = **90.9% ≈ 91%**

### 1.3 Key Accomplishments

- ✅ **Directive 1 — Toolchain installed**: `sonar-scanner` CLI 6.2.1.4610 + `sonarqube:community` Docker image (resolved digest `sha256:35bedac3...`)
- ✅ **Directive 2 — Ephemeral server reached `status=UP`** in **35.288 seconds** (well under the 120-second budget)
- ✅ **Directive 3 — `sonar-scanner` scan completed** in **752.126 seconds** with quality gate `PASSED` (9,524 files indexed; 6,560 JS/TS source files analyzed)
- ✅ **Directive 4 — Findings exported** via `/api/issues/search` returning 263 issues in a single page (no pagination required)
- ✅ **Directive 5 — Normalized JSON written**: `findings-config-i.json` (54,966 bytes, 1 line, valid JSON, 5-field schema 263/263, max description length 174 chars)
- ✅ **Container teardown verified**: `sonarqube-test` stopped and removed; 8 leaked anonymous Docker volumes cleaned up (D40 QA fix)
- ✅ **Explainability rule satisfied**: `findings-config-i.decisions.md` with **41 decision entries** documenting every non-trivial choice
- ✅ **Executive Presentation rule satisfied**: `findings-config-i.executive-summary.html` with **16 reveal.js sections**, CDN versions pinned exactly (reveal.js 5.1.0, Mermaid 11.4.0, Lucide 0.460.0), Blitzy brand palette embedded inline, browser-validated at 1920×1080 with **0 console errors**
- ✅ **Cross-artifact consistency**: total findings = 263, severity counts (58/158/47/0), cold-start, and scan duration align across all three deliverables
- ✅ **Zero existing files were modified** — satisfying the AAP "0 files modified" constraint

### 1.4 Critical Unresolved Issues

| Issue | Impact | Owner | ETA |
|---|---|---|---|
| Production-code CRITICAL finding in `packages/lib/crypto.ts:18` (CWE-327, "Use a secure mode and padding scheme") requires security team triage | Potential weak cryptographic mode/padding in shared crypto utility used across the monorepo; not a Config I deliverable defect but a finding the scan surfaced | Security team / Cal.com platform owner | 2 hours of triage |
| 22 of 23 `CWE-798` (hard-coded credentials) findings are in test scaffolding (`seed*.ts`, `*.e2e-spec.ts`, `*.integration-test.ts`, `packages/testing/**`); the remaining 1 is in production code (`apps/api/v2/.../CreateOAuthClientResponse.dto.ts:16`) | Testing hygiene concern (22) + 1 production DTO instance requiring review | Security team / API v2 owner | 1 hour of triage |
| 219 of 263 findings (83.3%) resolve to `CWE-Unknown` (per D10) because they originate from non-security BUG rules (sort comparators, identical sub-expressions, etc.) | Comparison signal is concentrated in the 44 mapped findings (5 distinct CWEs); downstream tooling should expect the `CWE-Unknown` fallback for BUG-class issues | Comparison evaluator | 0 hours (expected behavior per AAP §0.5.5 and D10) |

### 1.5 Access Issues

No access issues identified. All required tools and resources were available at execution time:

| System/Resource | Type of Access | Issue Description | Resolution Status | Owner |
|---|---|---|---|---|
| Docker Hub (`sonarqube:community`) | Container image pull | None — image pulled successfully | Resolved | N/A |
| `binaries.sonarsource.com` | SonarScanner CLI tarball | None — pre-installed in the execution environment per D1 | Resolved | N/A |
| Local port 9000 | TCP bind for container port mapping | None — port was free at execution time | Resolved | N/A |
| SonarQube default admin credentials | First-boot bootstrap auth | None — credentials accepted by `/api/user_tokens/generate` per D6 | Resolved | N/A |
| Repository working tree | Filesystem read for `sonar.sources` | None — full repo read access available | Resolved | N/A |

### 1.6 Recommended Next Steps

1. **[High]** Triage the single production-code CRITICAL finding (`packages/lib/crypto.ts:18`, CWE-327) — determine whether the flagged cipher mode/padding is intentional (e.g., legacy ECB-on-trusted-key) or a true weakness; remediate or document an explicit suppression. **ETA: 2 hours.**
2. **[High]** Validate the `findings-config-i.json` 5-field schema with downstream multi-configuration consumers before Config II / III / IV scans proceed. Confirm field ordering, severity vocabulary, and CWE fallback semantics are acceptable. **ETA: 1 hour.**
3. **[Medium]** Review and sign off on `findings-config-i.decisions.md`. Confirm the three forced deviations (D1 apt→binary, D6 sonar.token, D7 16 GiB heap) are acceptable for the multi-configuration baseline. **ETA: 0.5 hours.**
4. **[Low]** Adopt the forward-looking Config N improvements documented in D40 (`docker rm -fv` flag) and D41 (`docker run --init` for proper zombie reaping). **ETA: 0.5 hours.**

---

## 2. Project Hours Breakdown

### 2.1 Completed Work Detail

| Component | Hours | Description |
|---|---|---|
| Directive 1 — Install toolchain | 1.5 | Install `sonar-scanner` CLI (forced binary path per D1; Ubuntu 25.10 apt does not publish the package), pull `sonarqube:community` Docker image, verify version strings, document the forced apt→binary deviation |
| Directive 2 — Start ephemeral server | 1.5 | `docker run -d --name sonarqube-test -p 9000:9000`, implement 5-second initial sleep + 2-second poll cadence on `/api/system/status`, observe `status=UP` at 35.288 seconds, document pre-clean (D3), port probe (D4), polling cadence (D5) |
| Directive 3 — `sonar-scanner` execution | 7.0 | Initial scan attempt; two OOM diagnostic cycles (D7); discover and remediate forced `sonar.token` property substitution (D6); tune `sonar.exclusions` to remove `~750` test files (D8); set `-Dsonar.javascript.node.maxspace=16384`; complete 752.126 s scan with quality gate PASSED; capture all run metrics |
| Directive 4 — Export findings | 1.0 | Single `GET /api/issues/search?componentKeys=blitzy-cal&types=VULNERABILITY,BUG&ps=500` (paging.total 263 ≤ 500, no pagination expansion); validate the pagination loop implementation per D18 |
| Directive 5 — Normalize + teardown | 4.0 | Implement severity union mapping (D9), 3-tier CWE resolution (D10/D11/D12), file-path prefix strip (D14), line-field handling (D15), description truncation (D16), JSON minification with `ensure_ascii=False` (D17); write 263-entry JSON; clean up `.scannerwork/` cache (D25); execute `docker stop && docker rm` teardown (D19) |
| Rule 1 — Explainability decision log | 8.0 | Write `findings-config-i.decisions.md` with 41 decision entries (D1–D41 + D25b) covering all 11 AAP-mandated topics + QA-driven refinements; populate run metrics table; document failure-mode posture and comparison-contract reminder |
| Rule 2 — Executive Presentation HTML | 13.0 | Author `findings-config-i.executive-summary.html` with 16 reveal.js sections (1 title + 5 dividers + 9 content + 1 closing); embed full Blitzy brand inline CSS (semantic + canonical alias variable names per D28); load Mermaid 11.4.0 with `securityLevel: 'loose'` and tuned `flowchart` config (D34–D38); load Lucide 0.460.0 with `lucide.createIcons()` on `ready` and `slidechanged`; integrate Pipeline + Multi-Config Mermaid diagrams; apply Inter/Space Grotesk/Fira Code typography; address all QA findings (D27 divider centering, D29 table header color, D30 closing word count, D39 dark-slide emphasis color) |
| Validation, QA & cross-artifact consistency | 4.0 | Run all 21 directive + rule pass/fail gates; verify cross-artifact consistency (263 findings + severity + cold-start + scan duration align across JSON/MD/HTML); browser-validate the reveal.js deck at 1920×1080; capture validation screenshots for all 16 slides; clean up 8 anonymous Docker volumes from D6/D7/D8 diagnostics (D40); document zombie process posture (D41) |
| **Total Completed** | **40.0** |  |

### 2.2 Remaining Work Detail

| Category | Hours | Priority |
|---|---|---|
| Security team triage of `packages/lib/crypto.ts:18` CRITICAL finding (CWE-327, weak crypto mode/padding) | 2.0 | High |
| Validate `findings-config-i.json` 5-field schema with downstream Config II/III/IV consumers before next scan proceeds | 1.0 | High |
| Stakeholder review and sign-off on `findings-config-i.decisions.md` (forced deviations D1, D6, D7; QA fixes D27–D41) | 0.5 | Medium |
| Forward-looking Config N preparation: adopt `docker rm -fv` (D40) and `docker run --init` (D41) in next scan's teardown | 0.5 | Low |
| **Total Remaining** | **4.0** |  |

### 2.3 Cross-Section Verification

- **Section 2.1 sum**: 1.5 + 1.5 + 7.0 + 1.0 + 4.0 + 8.0 + 13.0 + 4.0 = **40.0 hours** ✓ (matches Section 1.2 Completed Hours)
- **Section 2.2 sum**: 2.0 + 1.0 + 0.5 + 0.5 = **4.0 hours** ✓ (matches Section 1.2 Remaining Hours)
- **Total**: 40.0 + 4.0 = **44.0 hours** ✓ (matches Section 1.2 Total Project Hours)
- **Section 7 pie chart values**: Completed = 40, Remaining = 4 ✓ (matches Section 1.2)

---

## 3. Test Results

All tests below originate from Blitzy's autonomous validation logs for this Config I execution. There are no application unit/integration tests within the Config I scope — the project's "tests" are the **Directive pass/fail gates** and **Rule compliance gates** that act as acceptance criteria.

| Test Category | Framework | Total Tests | Passed | Failed | Coverage % | Notes |
|---|---|---|---|---|---|---|
| Directive 1 pass/fail | Shell + Docker CLI | 2 | 2 | 0 | 100 | `sonar-scanner --version` returns `SonarScanner CLI 6.2.1.4610`; `docker pull sonarqube:community` succeeds with digest `sha256:35bedac3...` |
| Directive 2 pass/fail | curl + JSON parse | 1 | 1 | 0 | 100 | `/api/system/status` returns `status=UP` at 35.288 s (within 120 s budget) |
| Directive 3 pass/fail | sonar-scanner + Quality Gate API | 2 | 2 | 0 | 100 | Scan EXECUTION SUCCESS at 752.126 s; Quality Gate `PASSED` |
| Directive 4 pass/fail | curl + JSON parse | 1 | 1 | 0 | 100 | `/api/issues/search` returns JSON with `issues` array (paging.total=263, pageSize=500, 1 page) |
| Directive 5 pass/fail — JSON validity | `python3 -m json.tool` | 1 | 1 | 0 | 100 | `python3 -c "import json; json.load(open('findings-config-i.json'))"` succeeds |
| Directive 5 pass/fail — single-line invariant | `wc -l` | 1 | 1 | 0 | 100 | `cat findings-config-i.json \| wc -l` returns **1** |
| Directive 5 pass/fail — 5-field schema | Python schema check | 263 | 263 | 0 | 100 | All 263 entries have exactly the keys `{file, line, severity, cwe, description}` |
| Directive 5 pass/fail — description truncation | Python max-length check | 1 | 1 | 0 | 100 | Max description length = 174 chars (≤ 200 cap) |
| Directive 5 pass/fail — container teardown | `docker ps -a` | 1 | 1 | 0 | 100 | `sonarqube-test` not present in `docker ps -a` after teardown |
| Rule 1 — Decision log header match | grep | 1 | 1 | 0 | 100 | Header row matches `\| Decision \| Alternatives Considered \| Rationale \| Risks \|` |
| Rule 1 — Required topics coverage | Topic enumeration | 11 | 11 | 0 | 100 | All 11 AAP-mandated topics in §0.5.5 are represented as decision rows |
| Rule 2 — Section count in range | DOM count | 1 | 1 | 0 | 100 | 16 `<section>` elements (within 12–18 target) |
| Rule 2 — CDN versions pinned exactly | grep | 3 | 3 | 0 | 100 | `reveal.js@5.1.0`, `mermaid@11.4.0`, `lucide@0.460.0` references present and pinned |
| Rule 2 — All slide types present | grep | 4 | 4 | 0 | 100 | `slide-title` (1), `slide-divider` (5), default content (9), `slide-closing` (1) |
| Rule 2 — Reveal.js config compliance | JS source inspection | 5 | 5 | 0 | 100 | `hash: true`, `transition: 'slide'`, `controlsTutorial: false`, `width: 1920`, `height: 1080` all present in `Reveal.initialize()` |
| Rule 2 — Mermaid + Lucide refresh handlers | JS source inspection | 2 | 2 | 0 | 100 | `mermaid.run()` and `lucide.createIcons()` invoked on `ready` and every `slidechanged` |
| Rule 2 — Hero gradient on title slide | CSS inspection | 1 | 1 | 0 | 100 | `linear-gradient(68deg, #7A6DEC 15.56%, #5B39F3 62.74%, #4101DB 84.44%)` present |
| Rule 2 — All sections have non-text visual | DOM walker | 16 | 16 | 0 | 100 | Every section contains at least one of: SVG, Lucide icon, Mermaid diagram, KPI card, styled table, or accent line |
| Rule 2 — Zero emoji | Unicode regex | 1 | 1 | 0 | 100 | No emoji unicode codepoints found |
| Rule 2 — Zero fenced code blocks | grep | 1 | 1 | 0 | 100 | No triple-backtick fenced code blocks in the deck |
| Rule 2 — Browser opens without errors | Chromium 1920×1080 | 1 | 1 | 0 | 100 | 0 console errors on load (only standard `favicon.ico` 404 from browser default; not a deck defect) |
| Cross-artifact consistency — total findings | Python count | 3 | 3 | 0 | 100 | 263 findings in JSON · 11 mentions of "263" in MD · 7 mentions of "263" in HTML |
| Cross-artifact consistency — severity counts | grep | 3 | 3 | 0 | 100 | "58 critical · 158 high · 47 medium · 0 low" appears in MD and HTML; matches JSON computation |
| Cross-artifact consistency — run metrics | grep | 2 | 2 | 0 | 100 | Cold-start 35.288 s and scan duration 752.126 s appear in both MD and HTML |
| **TOTAL** | — | **291** | **291** | **0** | **100%** | Zero failures across all autonomous validation gates |

---

## 4. Runtime Validation & UI Verification

### Runtime Health

- ✅ **SonarQube Server (Docker)**: Reached `status=UP` at 35.288 s; reported version `26.5.0.122743`; quality gate API returned `PASSED` after scan
- ✅ **sonar-scanner CLI**: `SonarScanner CLI 6.2.1.4610 / Java 17.0.12 Eclipse Adoptium / Linux 6.8.0 amd64`; scan completed with EXECUTION SUCCESS exit
- ✅ **JS/TS analyzer Node bridge**: Completed analysis of 6,560 source files at 16 GiB heap (D7); peak RSS ~15.5 GiB
- ✅ **Issues export**: `GET /api/issues/search` returned HTTP 200 with `paging.total=263, pageSize=500, pageIndex=1`
- ✅ **Container teardown**: `docker stop sonarqube-test && docker rm sonarqube-test` succeeded cleanly; container not in `docker ps -a` post-teardown
- ✅ **Docker volume cleanup**: 8 anonymous volumes from D6/D7/D8 diagnostics removed (D40); `docker system df` reports 0 B Local Volumes

### UI Verification — `findings-config-i.executive-summary.html`

The reveal.js executive presentation was browser-validated in Chromium at 1920×1080. All 16 slides were navigated and visually verified:

- ✅ **Slide 1 (Title)** — Gradient `linear-gradient(68deg, #7A6DEC, #5B39F3, #4101DB)` background, eyebrow "CONFIG I · SONARQUBE COMMUNITY BUILD" with shield Lucide icon, Space Grotesk hero heading "blitzy-cal Security Scan", four metadata badges (SonarQube 26.5, Ephemeral Docker, scan timings, 263 findings), teal accent line
- ✅ **Slide 2 (KPIs)** — White content slide with eyebrow "HEADLINE RESULTS", 4 KPI cards (Total Findings 263, Critical+High 216, Cold-start 35.288 s, Scan Duration 752.126 s), Quality Gate PASSED notice band
- ✅ **Slide 3 (Architecture / Pipeline Mermaid)** — `graph LR` flowchart renders all 5 directives plus the timeout branch; teal decision diamond; no label clipping (D34/D37/D38 mitigations confirmed)
- ✅ **Slides 4, 6, 9, 12, 14 (Section Dividers)** — Dark purple → navy gradient backgrounds with centered Lucide icon + heading + sub-headline + teal accent line stack (D27 centering applied)
- ✅ **Slide 5 (Scan Parameters)** — Styled table with `#2D1C77` header (D29) listing all directive parameters
- ✅ **Slide 7 (Severity Distribution)** — KPI cards / bar visual for 58 critical, 158 high, 47 medium, 0 low
- ✅ **Slide 8 (CWE Distribution)** — Styled table listing the 5 mapped CWEs + the CWE-Unknown fallback rate
- ✅ **Slide 10 (Top Concerns / Risk Highlights)** — Highlighted production CRITICAL in `packages/lib/crypto.ts`
- ✅ **Slide 11 (Operational Metrics)** — Cold-start, scan duration, total issues KPI cards
- ✅ **Slide 13 (Next Steps)** — Bulleted action list for downstream consumers
- ✅ **Slide 15 (Multi-Config Map)** — Mermaid `graph TB` diagram showing the comparison fabric
- ✅ **Slide 16 (Closing)** — Solid navy `#1A105F` background, 5-word headline "One scan. Three deliverables." (D30 word-count fix), 3 bullets, brand lockup "Blitzy · blitzy-cal · Security Tool Comparison · Config I", gradient accent bar

### API Integration Results

- ✅ `POST /api/user_tokens/generate?name=scanner-config-i&type=USER_TOKEN` — issued the run-scoped scanner token (D6); token destroyed with container at teardown (D26)
- ✅ `GET /api/system/status` — polled every 2 s after 5 s initial sleep; first `UP` response at 35.288 s (D5)
- ✅ `GET /api/qualitygates/project_status` (implicit via `sonar.qualitygate.wait=true`) — returned `PASSED`
- ✅ `GET /api/issues/search?componentKeys=blitzy-cal&types=VULNERABILITY,BUG&ps=500` — returned 263 issues
- ✅ `GET /api/rules/show?key=<rule>` — invoked for Tier 2 CWE resolution; successfully extracted CWE references from 44 rules using `descriptionSections[*].content` (D11)

---

## 5. Compliance & Quality Review

| AAP Requirement | Status | Evidence |
|---|---|---|
| Directive 1: `sonar-scanner --version` returns version string | ✅ Pass | `SonarScanner CLI 6.2.1.4610` returned at execution time |
| Directive 1: `docker pull sonarqube:community` succeeds | ✅ Pass | Image present with digest `sha256:35bedac3f40cda75969890da59b17d577770844fe6ef659206c678a8e00921c7` |
| Directive 2: Server `status=UP` within 120 s | ✅ Pass | UP at 35.288 s (29% of budget) |
| Directive 3: Scan completes and quality gate result is returned | ✅ Pass | EXECUTION SUCCESS in 752.126 s; Quality Gate `PASSED` |
| Directive 4: API returns JSON with an issues array | ✅ Pass | `paging.total=263, pageSize=500` returned in single page |
| Directive 5: `cat findings-config-i.json \| wc -l` returns 1 | ✅ Pass | Verified post-write; current state still satisfies invariant |
| Directive 5: Valid JSON | ✅ Pass | `json.load()` succeeds |
| Directive 5: Every finding has all 5 fields populated | ✅ Pass | 263/263 entries match schema `{file, line, severity, cwe, description}` |
| Directive 5: No description exceeds 200 characters | ✅ Pass | Max length = 174 chars |
| Directive 5: Docker container stopped and removed | ✅ Pass | `docker ps -a --filter name=sonarqube-test` returns empty |
| Severity vocabulary restricted to 4 values | ✅ Pass | Output severities ⊂ `{critical, high, medium, low}` |
| CWE field never empty | ✅ Pass | All 263 entries have non-empty `cwe`; 219 use `CWE-Unknown` fallback per D10 |
| File paths repository-relative, prefix stripped | ✅ Pass | All paths begin with `apps/`, `packages/`, `scripts/`, `agents/`, `__checks__/`, or `example-apps/` (no `blitzy-cal:` prefix remains) |
| AAP "0 files modified" constraint | ✅ Pass | Git diff against merge base shows only 3 net-new files at repo root (no modifications to `apps/`, `packages/`, etc.) |
| Rule 1 (Explainability): Markdown table with 4 mandatory columns | ✅ Pass | Header row matches `\| Decision \| Alternatives Considered \| Rationale \| Risks \|` |
| Rule 1: Every non-trivial decision documented | ✅ Pass | 41 entries (D1–D41 + D25b); all 11 mandated topics covered |
| Rule 1: Deviations from literal directives documented | ✅ Pass | D1 (apt→binary), D6 (sonar.token property), D7 (heap size), D8 (exclusions), D14 (path strip), D18 (pagination), D19 (teardown recovery) all explicitly documented |
| Rule 1: No rationale embedded in code comments | ✅ Pass | No source code was modified; all rationale lives in `findings-config-i.decisions.md` |
| Rule 2 (Executive Presentation): Single self-contained HTML file | ✅ Pass | All theme CSS inlined; only external dependencies are CDN-hosted reveal.js / Mermaid / Lucide / Google Fonts |
| Rule 2: 12–18 sections | ✅ Pass | 16 sections (target hit) |
| Rule 2: Four slide types present | ✅ Pass | 1 `slide-title`, 5 `slide-divider`, 9 default content, 1 `slide-closing` |
| Rule 2: Every section contains non-text visual | ✅ Pass | 16/16 sections satisfy (SVG, Mermaid, KPI grid, styled table, accent line, or Lucide icon) |
| Rule 2: CDN versions pinned exactly | ✅ Pass | `reveal.js@5.1.0`, `mermaid@11.4.0`, `lucide@0.460.0` |
| Rule 2: Reveal config `hash, transition, controlsTutorial, width, height` | ✅ Pass | All five present with required values |
| Rule 2: Mermaid `startOnLoad: false` + `mermaid.run()` on `ready`/`slidechanged` | ✅ Pass | Confirmed in source |
| Rule 2: Lucide `createIcons()` on `ready`/`slidechanged` | ✅ Pass | Confirmed in source |
| Rule 2: Blitzy brand palette embedded | ✅ Pass | `#5B39F3, #2D1C77, #94FAD5, #1A105F, #7A6DEC, #4101DB` all present as CSS custom properties |
| Rule 2: Typography (Inter / Space Grotesk / Fira Code) via Google Fonts | ✅ Pass | `<link>` to `fonts.googleapis.com/css2?...` confirmed |
| Rule 2: Zero emoji, zero fenced code blocks | ✅ Pass | 0 emoji codepoints; 0 fenced blocks |
| Rule 2: Hero gradient on title slide | ✅ Pass | `linear-gradient(68deg, #7A6DEC 15.56%, #5B39F3 62.74%, #4101DB 84.44%)` present |
| Rule 2: Centered divider headings | ✅ Pass | D27 centering applied to all 5 dividers |
| Rule 2: Closing 3–6 word takeaway | ✅ Pass | "One scan. Three deliverables." (5 words, D30) |
| Cross-artifact consistency | ✅ Pass | 263 findings, severities, cold-start, scan duration align across JSON, MD, HTML |

**Fixes applied during autonomous validation:** D1 (pre-installed sonar-scanner binary), D6 (migrated to `sonar.token` property), D7 (raised heap to 16 GiB), D8 (production-code exclusions), D27 (centered divider headings), D28 (added canonical CSS variable aliases), D29 (switched table headers to `--bz-primary-dark`), D30 (shortened closing takeaway to 5 words), D34–D38 (Mermaid font/layout/overflow tweaks), D40 (cleaned up 8 leaked Docker volumes), D41 (documented zombie process posture).

**Outstanding items:** None within the Config I autonomous scope. All path-to-production items are documented in Section 2.2 as human-driven tasks.

---

## 6. Risk Assessment

| Risk | Category | Severity | Probability | Mitigation | Status |
|---|---|---|---|---|---|
| Production-code CRITICAL `packages/lib/crypto.ts:18` (CWE-327, weak crypto mode/padding) is shared across the Cal.com platform | Security | High | High (already detected) | Manual security review; remediate or document an explicit suppression with justification | Open — assigned to security team (Section 2.2 high-priority task) |
| Production DTO `apps/api/v2/.../CreateOAuthClientResponse.dto.ts:16` flagged for hard-coded `clientSecret` exposure (CWE-798) | Security | High | Medium | Review whether the literal is a sample value, a placeholder, or a real secret; remediate if real | Open — assigned to API v2 owner |
| 22 of 23 CWE-798 findings are in test scaffolding (seed scripts, integration tests, e2e specs, `packages/testing/`) | Security | Low | High (already detected) | Testing hygiene improvement; consider replacing literal test credentials with deterministic fixture factory output | Open — informational |
| 219 of 263 findings (83.3%) resolve to `CWE-Unknown` per D10 fallback | Operational | Low | High (expected) | This is expected behavior for non-security BUG rules (sort comparators, etc.) where CWE does not apply; comparison signal lives in the 44 mapped findings | Accepted — documented in D10 |
| Floating `sonarqube:community` tag may resolve to a different image at the next scan, producing finding-count drift | Operational | Medium | Medium | D22 records the exact `sha256:35bedac3...` digest in the decision log so consumers can pin if needed | Mitigated — digest recorded |
| SonarQube 26.x deprecated `sonar.login`/`sonar.password` (D6 forced deviation); a future release may also deprecate `sonar.token` | Operational | Medium | Low | D6 documents the failure signature; next agent run should read the server's error message and adopt the replacement property | Mitigated — failure mode documented |
| JS/TS analyzer requires 16 GiB heap on 6,560-file analysis (D7) | Operational | Medium | Medium | D7 records the chosen heap and explicit OOM symptoms; codebase growth ~30% would require raising further | Mitigated — heap value documented |
| Anonymous Docker volumes accumulate per `docker run` if `-v` is omitted (D40 found 8 leaked volumes from diagnostics) | Operational | Low | High (without `-v`) | D40 documents `docker rm -fv` for future Config N teardown; current session cleaned up the 8 volumes | Closed — D40 applied |
| Zombie Java processes accumulate when scanner JVM children outlive parent shell and PID 1 is not a child-reaping init (D41) | Operational | Low | High (without `--init`) | D41 documents `docker run --init` and `trap`/`wait` patterns for future Config N | Closed — D41 applied |
| Mermaid HTML labels rely on `securityLevel: 'loose'` (D36) — would be a vector if dynamic input were ever added | Security | Low | Low | All Mermaid sources in the deck are static repository-controlled literals; D36 notes that any dynamic-source change must re-evaluate security level | Accepted — documented in D36 |
| Multi-configuration JSON contract has no schema validation tool committed to the repo | Integration | Medium | Medium | Downstream Config II/III/IV consumers should pin a JSON Schema validator; the 5-field shape is documented in `findings-config-i.decisions.md` and Section 5 of this guide | Open — downstream consumer responsibility |
| Default first-boot admin credentials are used by the scanner (D6); persisted in the ephemeral H2 database only | Security | Low | Low | The container is destroyed at teardown (Directive 5); D25b/D26 codify the redaction policy — no credential literal ever enters git history | Mitigated — ephemeral by design |
| `.scannerwork/` cache directory written during scan is not in `.gitignore` | Operational | Low | Low (cleaned) | D25 removes `.scannerwork/` before commit; cannot modify `.gitignore` per "0 files modified" constraint | Mitigated — D25 cleanup applied |
| Floating CDN dependencies (Google Fonts, jsDelivr) on the executive HTML | Integration | Low | Low | Self-contained per the rule; if CDNs are blocked, the deck degrades gracefully (`document.fonts.ready` fallback per D37) but renders correctly with system fonts | Accepted — rule-mandated |

---

## 7. Visual Project Status

### Project Hours Breakdown

```mermaid
pie title Config I — Project Hours
    "Completed Work" : 40
    "Remaining Work" : 4
```

(Completed = Dark Blue `#5B39F3`; Remaining = White `#FFFFFF`)

### Findings by Severity (Output Data, Not Project Hours)

```mermaid
pie title 263 Findings by Severity
    "Critical" : 58
    "High" : 158
    "Medium" : 47
```

### Remaining Hours by Priority

```mermaid
pie title Remaining Work by Priority
    "High" : 3
    "Medium" : 0.5
    "Low" : 0.5
```

### Integrity Verification

| Section | Hours Field | Value |
|---|---|---|
| Section 1.2 Total Project Hours | — | 44 |
| Section 1.2 Completed Hours | — | 40 |
| Section 1.2 Remaining Hours | — | 4 |
| Section 2.1 row sum | — | 40 ✓ |
| Section 2.2 row sum | — | 4 ✓ |
| Section 7 pie chart "Completed Work" | — | 40 ✓ |
| Section 7 pie chart "Remaining Work" | — | 4 ✓ |

All values align across sections 1.2, 2.1, 2.2, and 7.

---

## 8. Summary & Recommendations

### Achievements

Config I has successfully delivered all three AAP-mandated artifacts and satisfied every Directive pass/fail criterion plus both Rule compliance gates with **zero failures across 291 validation checks**. The work executed:

- A complete SonarQube Community Build SAST scan of the 6,560-file `blitzy-cal` (Cal.com) JS/TS monorepo against an ephemeral Docker container that lived for the duration of the run and was destroyed at teardown
- Production of a 54,966-byte minified JSON artifact containing 263 normalized findings across 5 mapped CWEs (CWE-798, CWE-345, CWE-353, CWE-482, CWE-327) plus the CWE-Unknown fallback for non-security BUG rules
- A 59,102-byte Explainability decision log with 41 detailed entries documenting every non-trivial choice and every forced deviation from a literal reading of the user's directives
- A 42,262-byte self-contained reveal.js 5.1.0 executive presentation with 16 brand-consistent slides, browser-validated at 1920×1080 with zero console errors

### Remaining Gaps

The branch is **production-ready** for consumption by the downstream multi-configuration comparison fabric. The only remaining work is **human-driven path-to-production activity**:

- **Security review of one production-code CRITICAL** (`packages/lib/crypto.ts:18`, CWE-327) — 2 hours
- **Downstream consumer validation** of the 5-field JSON schema before Config II proceeds — 1 hour
- **Stakeholder sign-off** on the decision log's three forced deviations (D1/D6/D7) — 0.5 hours
- **Forward-looking improvements** for Config N (`docker rm -fv`, `docker run --init`) — 0.5 hours

### Critical Path to Production

The critical path from the current state (**91% complete**) to full production readiness is:

1. **Security team triage** of the `crypto.ts` CRITICAL → determine remediation strategy
2. **Schema validation** with multi-config comparison tooling owner → confirm JSON contract
3. **Stakeholder sign-off** on deviations and QA fixes → approve Config I for inclusion in baseline

Estimated total wall-clock time to 100%: **4 hours of human-driven activity** (Section 2.2).

### Success Metrics

| Metric | Value |
|---|---|
| Directive pass/fail gates passed | 5/5 (100%) |
| Rule compliance gates passed | 2/2 (100%) |
| Findings exported | 263 |
| Quality Gate status | PASSED |
| Cold-start (vs. 120 s budget) | 35.288 s (29% of budget) |
| Scan wall-clock duration | 752.126 s (~12 min 32 s) |
| Cross-artifact consistency | 100% (JSON/MD/HTML agree on every metric) |
| In-scope files modified | 0 (AAP "0 files modified" satisfied) |
| New deliverable files | 3 (all at repository root) |
| Lines added to repository | 1,206 net-new lines |
| Decision log entries | 41 (vs. 11 mandated topics — 273% coverage) |
| Executive presentation slides | 16 (within 12–18 target) |
| Browser console errors | 0 (only standard `favicon.ico` 404 from browser default) |
| Project completion | **91%** |

### Production Readiness Assessment

The Config I deliverable triple is **ready for downstream consumption**. The remaining 4 hours of human-driven work are downstream review and triage activities that do not affect the AAP-scoped artifact contract. The JSON's 5-field schema is the inter-configuration diff contract for subsequent configurations (II, III, IV, …), and the decision log codifies every non-trivial choice that downstream evaluators may need to audit when comparing across configurations.

---

## 9. Development Guide

### 9.1 System Prerequisites

| Requirement | Version Confirmed in This Environment | Notes |
|---|---|---|
| Operating System | Ubuntu 25.10 (Questing Quokka) | Linux 6.8 amd64 |
| Docker Engine | 28.5.2 (build ecc6942) | Required for `docker pull` and `docker run` |
| `sonar-scanner` CLI | 6.2.1.4610 (Eclipse Adoptium Java 17.0.12) | **Pre-installed via official tarball at `/usr/local/bin/sonar-scanner`** (Ubuntu 25.10 apt does not publish a `sonar-scanner` package; see D1 in `findings-config-i.decisions.md`) |
| Python | 3.13.7 | Used for JSON normalization, validation, and CWE Tier 2 resolution |
| curl | 8.14.1 | Used for `/api/system/status` polling, `/api/issues/search` export, and `/api/user_tokens/generate` |
| Free disk space | 24 TB free (at execution time) | Docker image is ~700 MB; scan cache `.scannerwork/` is ~4 KB |
| Free RAM | 3.8 TiB free (at execution time) | SonarQube container + JS/TS analyzer requires ~16 GiB during scan (D7) |
| Free TCP port | 9000 | Container port mapping; must be free before `docker run` |

### 9.2 Environment Setup

Config I has no application-level environment variables to configure — the SonarQube server bootstraps with default first-boot admin credentials on a fresh ephemeral H2 database, and all scan parameters are passed as `-D` flags on the `sonar-scanner` invocation. The only environment variables touched during execution are process-local:

```bash
# Process-local — never persisted to .env or git history
export SONAR_HOST=http://localhost:9000
export SONAR_PROJECT_KEY=blitzy-cal
export SONAR_TOKEN=<generated at runtime via /api/user_tokens/generate>  # see D6 / D25b / D26
```

### 9.3 Dependency Installation

```bash
# Verify the sonar-scanner CLI is present (pre-installed per D1)
sonar-scanner --version
# Expected: "SonarScanner CLI 6.2.1.4610" + Java + OS lines

# Verify Docker is available
docker --version
# Expected: "Docker version 28.x.x, build ..."

# Pull the SonarQube Community Build image (Directive 1)
docker pull sonarqube:community
# Expected: "Status: Image is up to date for sonarqube:community"
#           plus the resolved RepoDigest line
```

### 9.4 Application Startup — Reproduce the Config I Scan

The Config I scan is a one-shot end-to-end pipeline. Each step is gated by a pass/fail criterion; do not proceed past a step until its criterion holds.

```bash
# Navigate to the repository root
cd /tmp/blitzy/blitzy-cal/blitzy-2cdd131a-6949-4223-bb2b-7dca1da2eda9_c83f1d

# Step 1 — Pre-clean any stale container with the canonical name (D3)
docker rm -f sonarqube-test 2>/dev/null || true

# Step 2 — Start the ephemeral server (Directive 2)
docker run -d --name sonarqube-test -p 9000:9000 sonarqube:community

# Step 3 — Poll until status=UP (D5: 5 s initial sleep, 2 s interval, 120 s budget)
sleep 5
SECONDS=0
while [ $SECONDS -lt 120 ]; do
    STATUS=$(curl -s http://localhost:9000/api/system/status \
        | python3 -c 'import json,sys; print(json.load(sys.stdin).get("status","STARTING"))')
    if [ "$STATUS" = "UP" ]; then
        echo "Server UP after $SECONDS seconds"
        break
    fi
    sleep 2
done

# Step 4 — Generate a run-scoped scanner token (D6 forced deviation)
TOKEN=$(curl -s -u admin:admin \
    -X POST "http://localhost:9000/api/user_tokens/generate?name=scanner-config-i&type=USER_TOKEN" \
    | python3 -c 'import json,sys; print(json.load(sys.stdin)["token"])')

# Step 5 — Run sonar-scanner (Directive 3, with D7/D8 augmentations)
sonar-scanner \
    -Dsonar.projectKey=blitzy-cal \
    -Dsonar.sources=/tmp/blitzy/blitzy-cal/blitzy-2cdd131a-6949-4223-bb2b-7dca1da2eda9_c83f1d \
    -Dsonar.host.url=http://localhost:9000 \
    -Dsonar.token=$TOKEN \
    -Dsonar.qualitygate.wait=true \
    -Dsonar.javascript.node.maxspace=16384 \
    -Dsonar.exclusions='**/*.test.ts,**/*.test.tsx,**/*.test.js,**/*.spec.ts,**/*.spec.tsx,**/*.spec.js,**/*.e2e.ts,**/*.e2e.tsx,**/__mocks__/**,**/__tests__/**,**/vitest-mocks/**,**/.scannerwork/**,**/playwright/**,**/cypress/**,**/coverage/**,**/.next/**,**/dist/**,**/build/**'

# Step 6 — Export findings (Directive 4)
curl "http://localhost:9000/api/issues/search?componentKeys=blitzy-cal&types=VULNERABILITY,BUG&ps=500" \
    > /tmp/raw-issues.json

# Step 7 — Normalize and write the JSON deliverable (Directive 5)
# (Full normalization pipeline: see D9–D17 in findings-config-i.decisions.md)

# Step 8 — Teardown (Directive 5; forward-looking D40 recommends `-fv` flag)
docker stop sonarqube-test && docker rm sonarqube-test
```

### 9.5 Verification Steps

Run each of these checks after the pipeline completes:

```bash
# Verify the JSON deliverable
cd /tmp/blitzy/blitzy-cal/blitzy-2cdd131a-6949-4223-bb2b-7dca1da2eda9_c83f1d

# Directive 5 pass/fail #1: single-line invariant
wc -l findings-config-i.json
# Expected: "1 findings-config-i.json"

# Directive 5 pass/fail #2: valid JSON
python3 -c "import json; json.load(open('findings-config-i.json')); print('VALID JSON')"
# Expected: "VALID JSON"

# Directive 5 pass/fail #3: 5-field schema for every entry
python3 -c "
import json
data = json.load(open('findings-config-i.json'))
required = {'file', 'line', 'severity', 'cwe', 'description'}
errors = [i for i, e in enumerate(data) if set(e.keys()) != required]
print(f'Entries: {len(data)}, schema-correct: {len(data) - len(errors)}')
"
# Expected: "Entries: 263, schema-correct: 263"

# Directive 5 pass/fail #4: max description length ≤ 200
python3 -c "
import json
data = json.load(open('findings-config-i.json'))
print(f'Max description length: {max(len(e[\"description\"]) for e in data)}')
"
# Expected: "Max description length: 174"

# Directive 5 pass/fail #5: container teardown
docker ps -a --filter "name=sonarqube-test"
# Expected: empty header row, no container listed

# Rule 1 (Explainability) verification: decisions.md header
grep -E "^\| Decision \| Alternatives Considered \| Rationale \| Risks \|$" findings-config-i.decisions.md
# Expected: one match

# Rule 2 (Executive Presentation) verification: section count and CDN versions
grep -c "<section" findings-config-i.executive-summary.html
# Expected: 16

grep -E "reveal\.js@5\.1\.0|mermaid@11\.4\.0|lucide@0\.460\.0" findings-config-i.executive-summary.html | wc -l
# Expected: 5+ (multiple references)
```

### 9.6 Example Usage — Inspect Findings

```bash
# Find all CWE-327 (broken crypto) findings
python3 -c "
import json
data = json.load(open('findings-config-i.json'))
for e in data:
    if e['cwe'] == 'CWE-327':
        print(f\"[{e['severity'].upper()}] {e['file']}:{e['line']} - {e['description']}\")
"
# Expected: 1 line — packages/lib/crypto.ts:18 critical CWE-327

# Show all critical findings grouped by file
python3 -c "
import json
from collections import Counter
data = json.load(open('findings-config-i.json'))
files = Counter(e['file'] for e in data if e['severity'] == 'critical')
for f, c in files.most_common(10):
    print(f'{c}: {f}')
"

# View the reveal.js executive summary locally
python3 -m http.server 8888 --bind 127.0.0.1 \
    -d /tmp/blitzy/blitzy-cal/blitzy-2cdd131a-6949-4223-bb2b-7dca1da2eda9_c83f1d &
# Then open http://127.0.0.1:8888/findings-config-i.executive-summary.html in any modern browser
```

### 9.7 Common Issues and Troubleshooting

| Symptom | Likely Cause | Resolution |
|---|---|---|
| `apt install sonar-scanner` fails with "Unable to locate package" | Ubuntu 25.10 apt does not publish the package (D1) | Install from `binaries.sonarsource.com` tarball; see D1 in `findings-config-i.decisions.md` |
| `docker run` fails with "bind: address already in use" on port 9000 | Port 9000 already bound by another process | Identify with `ss -ltn sport = :9000` (if installed) or `curl http://localhost:9000`; stop the conflicting service, then re-run |
| `docker run` fails with "container name already in use" | Stale `sonarqube-test` container from a prior failed run | `docker rm -f sonarqube-test` (D3 pre-clean) then re-run |
| `/api/system/status` never reaches UP within 120 s | First-boot H2 initialization stalled (unusual) | `docker logs sonarqube-test` to inspect startup output; usually a memory exhaustion or port-binding error |
| Scan fails with `Not authorized. Please check the user token in the property 'sonar.token' or 'sonar.login' (deprecated)` | SonarQube 26.x removed `sonar.login`/`sonar.password` (D6) | Generate a run-scoped token via `POST /api/user_tokens/generate` and pass via `-Dsonar.token=<token>` instead |
| Scan crashes with `WebSocket connection closed abnormally` or `Node.js process running out of memory (heap size limit 8384 MB)` | JS/TS analyzer Node bridge OOM on the 6,560-file analysis (D7) | Add `-Dsonar.javascript.node.maxspace=16384` (16 GiB) |
| Scan completes but `paging.total > 500` in `/api/issues/search` | Project produced more findings than a single page can carry | Paginate with `&p=2`, `&p=3`, … until `len(all_issues) >= total` (D18 implements this) |
| 8 anonymous Docker volumes accumulate after each scan | `docker rm` without `-v` does not remove anonymous volumes (D40) | Use `docker rm -fv sonarqube-test` for future runs; or clean up post-hoc with targeted `docker volume rm <id>` |
| Zombie `[java] <defunct>` processes after teardown | Scanner JVM child processes outlive parent shell; PID 1 is not a child-reaping init (D41) | Use `docker run --init` for future runs; or wrap the scanner invocation with `trap ... EXIT; wait` to reap explicitly |
| Executive HTML displays with Mermaid label clipping | Inter web font not loaded before Mermaid's off-screen text measurement (D34/D37) | `renderMermaid()` defers `mermaid.run()` until `document.fonts.ready` resolves; if the font fails to load entirely, the foreignObject overflow override (D38) covers the fallback |

---

## 10. Appendices

### A. Command Reference

| Purpose | Command |
|---|---|
| Verify sonar-scanner CLI | `sonar-scanner --version` |
| Verify Docker | `docker --version` |
| Pull SonarQube image | `docker pull sonarqube:community` |
| Pre-clean stale container | `docker rm -f sonarqube-test 2>/dev/null \|\| true` |
| Start ephemeral server | `docker run -d --name sonarqube-test -p 9000:9000 sonarqube:community` |
| Poll for UP status | `curl -s http://localhost:9000/api/system/status \| python3 -c 'import json,sys; print(json.load(sys.stdin)["status"])'` |
| Generate run-scoped token | `curl -s -u admin:admin -X POST "http://localhost:9000/api/user_tokens/generate?name=scanner-config-i&type=USER_TOKEN" \| python3 -c 'import json,sys; print(json.load(sys.stdin)["token"])'` |
| Run sonar-scanner | `sonar-scanner -Dsonar.projectKey=blitzy-cal -Dsonar.sources=$REPO -Dsonar.host.url=http://localhost:9000 -Dsonar.token=$TOKEN -Dsonar.qualitygate.wait=true -Dsonar.javascript.node.maxspace=16384 -Dsonar.exclusions='...'` |
| Export findings | `curl "http://localhost:9000/api/issues/search?componentKeys=blitzy-cal&types=VULNERABILITY,BUG&ps=500"` |
| Verify single-line JSON | `wc -l findings-config-i.json` |
| Validate JSON | `python3 -c "import json; json.load(open('findings-config-i.json'))"` |
| Teardown | `docker stop sonarqube-test && docker rm sonarqube-test` |
| Forward-looking teardown (D40) | `docker stop sonarqube-test && docker rm -fv sonarqube-test` |
| Serve executive HTML locally | `python3 -m http.server 8888 --bind 127.0.0.1` |

### B. Port Reference

| Port | Service | Direction | Notes |
|---|---|---|---|
| 9000 | SonarQube server (container) | Inbound (host → container) | Must be free on the host before `docker run -p 9000:9000` |
| 9092 | H2 embedded database (in-container) | Container-internal only | Not exposed to the host; destroyed with the container |
| 8888 | Optional local web server | Inbound (host) | For previewing `findings-config-i.executive-summary.html` |

### C. Key File Locations

| Path | Purpose |
|---|---|
| `/tmp/blitzy/blitzy-cal/blitzy-2cdd131a-6949-4223-bb2b-7dca1da2eda9_c83f1d/findings-config-i.json` | **Primary deliverable** — 263-finding minified JSON (54,966 bytes) |
| `/tmp/blitzy/blitzy-cal/blitzy-2cdd131a-6949-4223-bb2b-7dca1da2eda9_c83f1d/findings-config-i.decisions.md` | **Explainability artifact** — 41-entry decision log (59,102 bytes) |
| `/tmp/blitzy/blitzy-cal/blitzy-2cdd131a-6949-4223-bb2b-7dca1da2eda9_c83f1d/findings-config-i.executive-summary.html` | **Executive Presentation artifact** — 16-slide reveal.js deck (42,262 bytes) |
| `/usr/local/bin/sonar-scanner` | Pre-installed sonar-scanner CLI binary (D1 forced deviation) |
| `/opt/sonar-scanner-6.2.1.4610-linux-x64/` | sonar-scanner installation directory |
| `.scannerwork/` (under repo root, gitignored at runtime via D25) | Transient sonar-scanner cache, removed before commit |
| `blitzy/screenshots/slide_*.png` | Browser validation screenshots for each of the 16 executive-summary slides (untracked, validation evidence only) |

### D. Technology Versions

| Component | Version |
|---|---|
| Operating System | Ubuntu 25.10 (Questing Quokka), kernel 6.8 amd64 |
| Docker Engine | 28.5.2 (build ecc6942) |
| Docker Compose plugin | Available (`docker compose`) |
| sonar-scanner CLI | 6.2.1.4610 |
| Embedded JRE (in sonar-scanner) | Eclipse Adoptium Java 17.0.12 |
| Python | 3.13.7 |
| curl | 8.14.1 |
| SonarQube Server (resolved from `community` tag) | 26.5.0.122743 |
| SonarQube Docker image digest | `sha256:35bedac3f40cda75969890da59b17d577770844fe6ef659206c678a8e00921c7` |
| reveal.js (CDN-pinned) | 5.1.0 |
| Mermaid (CDN-pinned) | 11.4.0 |
| Lucide (CDN-pinned) | 0.460.0 |
| Google Fonts (loaded via `<link>`) | Inter 400/500/600/700, Space Grotesk 500/600/700, Fira Code 400/500 |

### E. Environment Variable Reference

| Variable | Set By | Used For | Scope |
|---|---|---|---|
| `SONAR_HOST` | Run script | Convenience; resolves to `http://localhost:9000` | Process-local; not persisted |
| `SONAR_PROJECT_KEY` | Run script | Convenience; resolves to `blitzy-cal` | Process-local; not persisted |
| `SONAR_TOKEN` | `curl POST /api/user_tokens/generate` | Scanner authentication (D6) | Process-local; **REDACTED** per D25b/D26; destroyed with the ephemeral H2 database at teardown |
| `DEBIAN_FRONTEND=noninteractive` | Optional for apt operations | Suppresses interactive prompts in headless environments | Shell-local |

No `.env` file is created, modified, or read by Config I.

### F. Developer Tools Guide

| Tool | When to Use | Example |
|---|---|---|
| `sonar-scanner` | Re-run the scan from scratch | `sonar-scanner -Dsonar.projectKey=blitzy-cal ...` |
| `docker` | Container lifecycle | `docker run/stop/rm/ps/image` |
| `curl` | Hit the SonarQube REST API directly | `curl http://localhost:9000/api/system/status` |
| `python3 -c "import json; ..."` | Inspect / validate / transform the JSON deliverable | One-liners shown throughout §9 |
| `jq` (if installed) | Pretty-print JSON for human reading | `jq . findings-config-i.json` |
| `wc -l` | Verify the single-line invariant | `wc -l findings-config-i.json` |
| `grep` | Search the decision log for a specific Decision number or topic | `grep -E "^\| \*\*D[0-9]+" findings-config-i.decisions.md` |
| `python3 -m http.server` | Serve the executive HTML locally for browser validation | `python3 -m http.server 8888 -d $REPO` |

### G. Glossary

| Term | Meaning |
|---|---|
| **AAP** | Agent Action Plan — the primary directive document driving Config I |
| **SAST** | Static Application Security Testing — analyzing source code for vulnerabilities without executing it |
| **CWE** | Common Weakness Enumeration — a community-developed catalog of software weakness types (e.g., CWE-327 = "Use of a Broken or Risky Cryptographic Algorithm") |
| **Config I** | The first configuration in a multi-configuration security tool comparison; this project |
| **Config N** | Any subsequent configuration in the comparison (II, III, IV, …) |
| **Quality Gate** | SonarQube concept — a project-level pass/fail determination based on the scan results |
| **Run-scoped token** | A SonarQube user token generated for a single scan run via `/api/user_tokens/generate`; destroyed with the ephemeral container at teardown |
| **D1, D2, …, D41** | Decision row identifiers in `findings-config-i.decisions.md` |
| **Tier 1 / Tier 2 / Tier 3 CWE resolution** | The 3-tier CWE resolution strategy (D10–D12): Tier 1 = `issue.tags` `cwe:NNN` match; Tier 2 = rule description regex; Tier 3 = `CWE-Unknown` fallback |
| **Ephemeral container** | A Docker container created at the start of a run and destroyed before the run completes, with no persistent volume |
| **Paging.total** | The total number of issues for a given query; used to determine whether pagination expansion is required (D18) |
| **5-field schema** | The Directive 5 output contract: every entry has exactly `{file, line, severity, cwe, description}` |
| **Floating tag** | A Docker image tag that resolves to a different digest over time (e.g., `sonarqube:community`); D2 documents the floating-tag posture and records the resolved digest |
| **PA1 methodology** | The Blitzy project assessment methodology that computes completion percentage as (Completed Hours / Total Hours) × 100 |

---

**End of Project Guide**
