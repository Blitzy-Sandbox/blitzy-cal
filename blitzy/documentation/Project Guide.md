# Blitzy Project Guide — `blitzy-cal` Six-Layer Security Audit

> **Engagement type:** Read-only security audit (assessment). Application source is **scanned but never modified** (`~0 files modified`). The deliverable is a structured, machine-readable findings corpus — not application code changes.
> **Brand legend:** 🟦 **Completed / AI Work** = Dark Blue `#5B39F3` · ⬜ **Remaining / Not Completed** = White `#FFFFFF`

---

## 1. Executive Summary

### 1.1 Project Overview

This engagement executed a deterministic, reproducible **six-layer (Layer 0–4 + consolidation) security audit** of `blitzy-cal`, a Cal.com-derived scheduling/booking monorepo built in TypeScript (Next.js, NestJS, Prisma, tRPC). The objective was **not** to remediate a single vulnerability but to emit a machine-readable findings corpus — covering architectural logic flaws, SAST pattern matches, exhaustive sink/mitigation enumeration, dataflow taint with exploitability triage, and known dependency CVEs — that a CI/CD gate and human reviewers can act on. Target users are platform security engineers and the CI/CD gate owner. The audit is strictly read-only: it preserves the dependency freeze and encryption-key continuity, reporting (never fixing) findings across a 7,433-file source tree.

### 1.2 Completion Status

```mermaid
%%{init: {'theme':'base', 'themeVariables': {'pie1':'#5B39F3','pie2':'#FFFFFF','pieStrokeColor':'#B23AF2','pieStrokeWidth':'2px','pieOuterStrokeColor':'#B23AF2','pieOuterStrokeWidth':'2px','pieTitleTextSize':'16px','pieSectionTextColor':'#000000','pieLegendTextColor':'#000000'}}}%%
pie showData title Completion — 81.5% Complete (hours)
    "Completed Work (AI)" : 150
    "Remaining Work" : 34
```

| Metric | Hours |
|---|---|
| **Total Hours** | **184** |
| Completed Hours — AI (autonomous) | 150 |
| Completed Hours — Manual (human) | 0 |
| **Completed Hours (AI + Manual)** | **150** |
| **Remaining Hours** | **34** |
| **Percent Complete** | **81.5%** |

> Completion is computed on AAP-scoped work only (PA1): `150 ÷ (150 + 34) = 81.52% ≈ 81.5%`. All 12 AAP directives (0–10) are 100% delivered and defect-free; the remaining 34h is exclusively human path-to-production work (no AAP rework is required).

### 1.3 Key Accomplishments

- ✅ **All 12 AAP directives (0–10) executed** — the complete six-layer pipeline plus normalize, merge, gate, and verify stages.
- ✅ **14-artifact corpus delivered** and committed (codebase profile, 5 normalized findings JSON, 2 raw tool outputs, 4 inventories, `verify.sh`, pinned `rules/`).
- ✅ **`verify.sh` passes 16/16 deterministic checks**, `verification_status=PASS`, exit 0, idempotent.
- ✅ **Read-only constraint perfectly satisfied** — `git diff` base→HEAD = exactly 14 files, all added (status A), **zero application source / config / dependency files modified**.
- ✅ **Full coverage proven** — Layer 1 all 10 architectural categories; Layer 3b 18 CWEs + 1 documented zero-hit (CWE-134) = all 19; Layer 3a 100% recall over 19 sinks + 9 mitigations (32,218 lines).
- ✅ **419 unique findings** normalized & merged (471 raw), `_summary` reconciles exactly; deterministic gate verdict computed.
- ✅ **Independently re-validated** — schema validity, severity-vocabulary compliance, ANSI-free output, and layer reproducibility all confirmed outside of `verify.sh`.

### 1.4 Critical Unresolved Issues

> The **deliverable corpus has no unresolved defects** (verify.sh 16/16, zero schema errors). The items below are the audit's **findings about the scanned codebase** and the integration gap — they require human action before the gate is enforced, but are *expected outputs of a successful audit*, not deliverable defects.

| Issue | Impact | Owner | ETA |
|---|---|---|---|
| **Gate-blocking SSRF (CWE-918)** — `packages/features/webhooks/lib/sendPayload.ts:373`: outbound webhook POST to user-registered URL with no SSRF allow-list (drives `gate_verdict=BLOCK`) | Blocks any merge that enforces this gate until reviewed | Security reviewer | ~4h after assignment |
| **Audit not yet wired into CI/CD** — `gate_verdict=BLOCK` is advisory until consumed by a pipeline | Findings not enforced on future PRs | DevOps / gate owner | ~6h |
| **207 dependency CVEs (5 critical / 81 high)** reported by Layer 4 awaiting disposition (remediation frozen by AAP) | Risk posture undocumented until triaged | Security + Eng lead | ~8h |

### 1.5 Access Issues

| System / Resource | Type of Access | Issue Description | Resolution Status | Owner |
|---|---|---|---|---|
| Target repository | Read/scan | Full read access available; audit executed end-to-end | ✅ No issue | — |
| Audit tooling (Semgrep, OSV-Scanner) | Install/run | Installed and version-verified (1.167.0 / 2.3.5) | ✅ No issue | — |
| CI/CD workflow secrets & permissions | Write (future) | Not required for the audit itself; will be needed to wire the gate into `.github/workflows/pr.yml` (HT-2) | ⚠ Pending — needed only for path-to-production | DevOps |
| Dependency-freeze authority | Org decision | Lifting the freeze to remediate CVEs is an organizational decision, intentionally out of audit scope | ⚠ Pending org decision | Eng leadership |

> No access issues blocked the audit. The two pending items are organizational/path-to-production prerequisites, not audit blockers.

### 1.6 Recommended Next Steps

1. **[High]** Triage the gate-blocking SSRF at `sendPayload.ts:373` — decide allow-list / remediation / documented risk-waiver (HT-1).
2. **[High]** Wire `gate_verdict` + `verify.sh` into `.github/workflows/pr.yml` as an additive gate alongside the existing `security-audit.yml`; create the findings baseline file for the WARN threshold (HT-2).
3. **[Medium]** Triage and disposition the 263 application-security advisories (25 L1 + 32 L2 + 206 L3b), batched by CWE/category (HT-3).
4. **[Medium]** Document risk-acceptance decisions for the 207 dependency CVEs; queue remediation for when the dependency freeze lifts (HT-4).
5. **[Low]** Author the audit operational runbook with re-run cadence, tool-version pinning, and baseline-refresh procedure (HT-5).

---

## 2. Project Hours Breakdown

### 2.1 Completed Work Detail

| Component | Hours | Description |
|---|---|---|
| Layer 0 — Codebase Discovery | 3 | `codebase-profile.txt`: deterministic language/framework/lockfile detection; primary_language=typescript, source_file_count=7433, `layer_0_status=OK`. |
| Layer 1 — Architectural Security Audit | 28 | Context-aware reasoning over **all 10** categories; 25 CWE-classified findings with attack-chain narratives (crypto, auth, transport, webhooks, embed, API parity, etc.). |
| Layer 2 — Semgrep SAST | 12 | Tool install, rule-pack pinning (`rules/`), scan to SARIF 2.1.0, severity mapping (12 error→critical, 20 warning→high), suppression rules; 32 normalized findings. |
| Layer 3a — Sink & Mitigation Inventory | 14 | 100%-recall `grep`/`find` enumeration of 19 sink + 9 mitigation categories; 32,218 lines in `file:::line:::pattern` format with test-file routing. |
| Layer 3b — Taint Analysis | 32 | Dataflow exploitability triage across 19 CWE categories; 207 findings, `gateBlocking` truth-table applied (1 gate-blocking, 206 advisory each with `demotionReason`). |
| Layer 4 — OSV-Scanner SCA | 8 | Prebuilt-binary install, scan of `./yarn.lock`, dedup by (package, CVE), normalization; 207 dependency CVEs. |
| Directive 7 — Normalization | 8 | Per-layer minified JSON conforming to schemas; description ≤200 chars + integer line; intra-layer dedup with `corroborated_by`. |
| Directive 8 — Merged Report | 8 | `findings-merged.json` with reconciling `_summary`; cross-layer corroboration & composite-chain severity escalation. |
| Directive 9 — CI/CD Gate Verdict | 5 | Verdict precedence + gate-blocking truth table → `gate_verdict=BLOCK` embedded in merged report. |
| Directive 10 — Verification Suite (`verify.sh`) | 14 | 1,118-line language-aware deterministic script encoding 16 checks; writes `verification_status`. |
| Validation & QA remediation cycles | 18 | 13-commit iterative refinement: checkpoint reviews, Layer-3a recall-gap fix (compound-suffix test files), Layer-3b line-precision fixes, `_summary` reconciliation, `verify.sh` Check-11 strengthening, ASCII hygiene. |
| **Total Completed** | **150** | |

### 2.2 Remaining Work Detail

| Category | Hours | Priority |
|---|---|---|
| Gate-blocking SSRF review & remediation decision (`sendPayload.ts:373`) | 4 | High |
| CI/CD gate integration (wire `gate_verdict` + `verify.sh` into `pr.yml`; create baseline file) | 6 | High |
| Application-security advisory triage & disposition (263 L1/L2/L3b advisories) | 12 | Medium |
| Dependency CVE triage & risk-acceptance documentation (207 OSV CVEs; freeze in effect) | 8 | Medium |
| Audit operational runbook & re-run/baseline procedure | 4 | Low |
| **Total Remaining** | **34** | |

### 2.3 Hours Reconciliation

| Roll-up | Hours |
|---|---|
| Section 2.1 Completed | 150 |
| Section 2.2 Remaining | 34 |
| **Total Project (2.1 + 2.2)** | **184** |
| Completion (150 ÷ 184) | **81.5%** |

> **Out-of-AAP-scope (excluded from all hours):** pre-existing `@calcom/trpc` build (9 TypeScript errors, 4 files); pre-existing 69/7,436 application unit-test failures (timeouts/jsdom); dependency-version remediation. These are forbidden by the read-only audit scope, the dependency freeze, and `CALENDSO_ENCRYPTION_KEY` continuity — they are not audit deliverables and are surfaced for the application team in Appendix only.

---

## 3. Test Results

> **Integrity:** every row below originates from Blitzy's autonomous validation logs for this project. The canonical suite is the Directive 10 `verify.sh` (16 deterministic checks); the remaining rows are independent corroboration run by Blitzy's validation agents.

| Test Category | Framework | Total Tests | Passed | Failed | Coverage % | Notes |
|---|---|---|---|---|---|---|
| Artifact Verification Suite | `verify.sh` / bash (Directive 10) | 16 | 16 | 0 | 100% | `verification_status=PASS`, exit 0, idempotent |
| JSON Schema Validation | Python `json` (Blitzy QA) | 5 | 5 | 0 | 100% | 5 findings JSON all valid arrays, schema-conformant |
| Deterministic-Layer Reproducibility | shell (L0 / L2 / L3a / L4) | 4 | 4 | 0 | 100% | Identical outputs on re-run |
| Output Hygiene (ANSI-free) | `grep` `\x1b` scan | 14 | 14 | 0 | 100% | 0 ANSI sequences across all 14 artifacts |
| **Total** | | **39** | **39** | **0** | **100%** | |

**`verify.sh` 16-check coverage (all PASS):** (1) profile + primary_language; (2) L1 array + 10 categories; (3) L2 array + SARIF + rules; (4) sink-inventory well-formed + language-applicable categories; (5) mitigation-inventory + 9 categories; (6) `-test` variants exist; (7) L3b array + applicable categories; (8) every L3b `gateBlocking` set + advisory `demotionReason`; (9) severity vocabulary strict; (10) L4 array + raw OSV correspond; (11) `_summary` fully consistent; (12) no ANSI; (13) no empty `description`; (14) valid `gate_verdict`; (15) no silent pre-agent failure; (16) every L3b `file:line` present in `sink-inventory.txt`.

> **Note on application tests:** the repository's own Vitest/Playwright suites were **not executed or modified** by this read-only audit. Their 69 pre-existing failures are out of scope and do not affect the audit corpus or `verify.sh` (which is static and does not compile or import application code).

---

## 4. Runtime Validation & UI Verification

This is a CLI / artifact-producing engagement. "Runtime" = the audit pipeline and `verify.sh` executing successfully; there is **no user-facing UI** in scope.

**Runtime health**
- ✅ **Operational** — `verify.sh` executes end-to-end: `checks_total=16 checks_failed=0 verification_status=PASS`, exit 0.
- ✅ **Operational** — Semgrep 1.167.0 runs and emits valid SARIF 2.1.0.
- ✅ **Operational** — OSV-Scanner 2.3.5 (prebuilt binary) scans `./yarn.lock` and emits valid JSON.
- ✅ **Operational** — deterministic layers (0, 2, 3a, 4) reproduce identical outputs on re-run.
- ✅ **Operational** — gate verdict independently recomputes to **BLOCK** per the AAP §0.7.2 precedence.

**Artifact integration outcomes**
- ✅ **Operational** — `findings-merged.json` `_summary` reconciles: `total=471` (raw), `unique=419`, `gate_blocking=1`, by_severity {critical 29, high 196, medium 197, low 49}, all `layer_status=OK`.
- ✅ **Operational** — every Layer 3b finding references a real `file:line` present in `sink-inventory.txt` (Check 16).

**UI verification**
- ➖ **N/A** — read-only audit produces report artifacts; no UI surface is created or modified.

---

## 5. Compliance & Quality Review

### 5.1 AAP Deliverable → Quality Benchmark Matrix

| AAP Requirement | Benchmark | Status |
|---|---|---|
| All 12 directives (0–10) executed | Pipeline completeness | ✅ Pass (100%) |
| 14-artifact corpus produced | Deliverable completeness | ✅ Pass |
| Layer 1 — 10 architectural categories | Coverage | ✅ Pass (10/10) |
| Layer 3a — 19 sinks + 9 mitigations, 100% recall | Coverage | ✅ Pass (32,218 lines) |
| Layer 3b — 19 CWE categories | Coverage | ✅ Pass (18 + CWE-134 documented zero-hit) |
| Unified severity vocabulary | Schema compliance | ✅ Pass (Check 9) |
| Non-empty `description` ≤200 chars + integer `line` | Schema integrity | ✅ Pass (Check 13) |
| ANSI-free output | Output hygiene | ✅ Pass (Check 12) |
| `gateBlocking` + `demotionReason` contract | Reproducibility anchor | ✅ Pass (Check 8) |
| Read-only (`~0` files modified) | Scope compliance | ✅ Pass (14 added, 0 modified) |
| Deterministic layers reproducible | Reproducibility | ✅ Pass |
| Merged `_summary` reconciliation | Data integrity | ✅ Pass (Check 11) |
| `gate_verdict` present & valid | Gate readiness | ✅ Pass = BLOCK (Check 14) |
| `verify.sh` 16 checks | Verification | ✅ Pass (16/16) |

### 5.2 Fixes Applied During Autonomous Validation

- Resolved 5 QA findings in the audit corpus (read-only artifacts).
- Corrected 5 Layer-3b line-precision defects (QA Final-B).
- Reconciled `findings-merged.json` `by_severity` and strengthened `verify.sh` Check 11.
- Resolved 8 final-checkpoint review findings (verify.sh, gate, scope).
- Fixed Layer 3a F1 recall gap by enumerating compound-suffix test files; fixed inventory defects + `rules/.gitignore` ASCII hygiene.

### 5.3 Outstanding Quality Items

- **None for the deliverable.** All quality benchmarks pass; zero in-scope defects remain. Outstanding items are human path-to-production tasks (Section 2.2), not corpus defects.

---

## 6. Risk Assessment

| Risk | Category | Severity | Probability | Mitigation | Status |
|---|---|---|---|---|---|
| **S1 — Gate-blocking SSRF** (CWE-918) at `sendPayload.ts:373`; outbound webhook to user URL with no allow-list | Security | High | Medium | Human review + allow-list / remediation decision (HT-1) | 🔴 Open (drives BLOCK) |
| S2 — 207 dependency CVEs (5 critical / 81 high) reported by OSV | Security | High | Variable | Risk-acceptance under freeze; re-evaluate when freeze lifts (HT-4) | 🟠 Open (advisory) |
| S3 — Architectural advisories: legacy AES-256-CBC (unauthenticated), CSP `'unsafe-inline'`, webhook `"no-secret-provided"` fallback | Security | Medium/High | Low–Medium | Human review; crypto bounded by `CALENDSO_ENCRYPTION_KEY` continuity | 🟠 Open (advisory) |
| S4 — 29 critical + 196 high findings require disposition | Security | High | N/A | Advisory triage (HT-3) | 🟠 Open |
| O1 — Audit not yet wired into CI/CD; `BLOCK` is advisory until consumed | Operational | Medium | High (until HT-2) | Integrate into `pr.yml` additive gate | 🟠 Open |
| O2 — No stored baseline for WARN >20% threshold | Operational | Low | Medium | Establish baseline in runbook (HT-5) | 🟡 Open |
| O3 — Point-in-time audit (HEAD `0256193999`) drifts as code evolves | Operational | Medium | Medium | Scheduled re-runs per runbook (HT-5) | 🟡 Open |
| T1 — Agent-layer non-determinism (L1/L3b advisory findings may vary) | Technical | Low | Medium | `gateBlocking` criteria are the reproducibility anchor (verified stable) | 🟢 Mitigated |
| T2 — False positives from broad `p/security-audit` pack | Technical | Low | Medium | AAP test-stub + build-time suppression rules applied | 🟢 Mitigated |
| T3 — Out-of-scope pre-existing app defects (trpc TS errors; 69 unit-test failures) | Technical | Medium | N/A (pre-existing) | Out of audit scope; flagged to app team; no corpus impact | 🟡 Open (informational) |
| I1 — CI tooling availability / version drift (Semgrep, OSV) | Integration | Low/Medium | Medium | Pin Semgrep 1.167.0 + OSV 2.3.5 + `rules/` directory | 🟢 Partially mitigated |
| I2 — Downstream gate-consumption contract (must honor `gate_verdict`/`gateBlocking`) | Integration | Medium | Low | `verify.sh` + `gateBlocking` anchor define the contract | 🟢 Mitigated |
| I3 — `yarn.lock` evolution shifts Layer 4 coverage | Integration | Low | Low | Re-run audit on lockfile changes | 🟡 Open (low) |

---

## 7. Visual Project Status

### 7.1 Project Hours Breakdown

```mermaid
%%{init: {'theme':'base', 'themeVariables': {'pie1':'#5B39F3','pie2':'#FFFFFF','pieStrokeColor':'#B23AF2','pieStrokeWidth':'2px','pieOuterStrokeColor':'#B23AF2','pieOuterStrokeWidth':'2px','pieSectionTextColor':'#000000','pieLegendTextColor':'#000000'}}}%%
pie showData title Project Hours — Completed vs Remaining
    "Completed Work" : 150
    "Remaining Work" : 34
```

> 🟦 Completed Work = `#5B39F3` (150h) · ⬜ Remaining Work = `#FFFFFF` (34h). "Remaining Work" (34) equals Section 1.2 Remaining Hours and the sum of Section 2.2 — integrity preserved.

### 7.2 Remaining Hours by Category (Section 2.2)

```mermaid
%%{init: {'theme':'base', 'themeVariables': {'primaryColor':'#5B39F3','primaryTextColor':'#000000'}}}%%
flowchart LR
    A["Advisory triage<br/>12h · Medium"]:::r
    B["CVE risk-acceptance<br/>8h · Medium"]:::r
    C["CI/CD gate wiring<br/>6h · High"]:::r
    D["SSRF review<br/>4h · High"]:::r
    E["Operational runbook<br/>4h · Low"]:::r
    classDef r fill:#FFFFFF,stroke:#B23AF2,stroke-width:2px,color:#000000;
```

| Category | Hours | Priority |
|---|---|---|
| Application-security advisory triage | 12 | Medium |
| Dependency CVE risk-acceptance | 8 | Medium |
| CI/CD gate integration | 6 | High |
| Gate-blocking SSRF review | 4 | High |
| Operational runbook | 4 | Low |
| **Total Remaining** | **34** | |

### 7.3 Findings Distribution (audit output, for context)

```mermaid
%%{init: {'theme':'base', 'themeVariables': {'pie1':'#B23AF2','pie2':'#5B39F3','pie3':'#A8FDD9','pie4':'#FFFFFF','pieStrokeColor':'#333333','pieStrokeWidth':'1px','pieSectionTextColor':'#000000','pieLegendTextColor':'#000000'}}}%%
pie showData title Unique Findings by Severity (419 total)
    "Critical" : 29
    "High" : 196
    "Medium" : 197
    "Low" : 49
```

> Severity counts are the audit's findings about the scanned codebase (419 unique / 471 raw); they are independent of the project-completion hours above.

---

## 8. Summary & Recommendations

**Achievements.** The engagement is **81.5% complete** on an AAP-scoped basis. Every one of the 12 AAP directives (0–10) was delivered, producing a 14-artifact security-findings corpus that is schema-valid, ANSI-free, reproducible, and passes its own `verify.sh` suite **16/16**. The read-only mandate was honored precisely: 14 files added, **zero** application source/config/dependency files touched, preserving the dependency freeze and `CALENDSO_ENCRYPTION_KEY` continuity. Independent re-validation corroborated every layer's counts, severity vocabulary, and integrity.

**Remaining gaps (34h, human-only).** What remains is not audit construction but **path-to-production**: reviewing the single gate-blocking SSRF, wiring the gate into CI/CD, dispositioning 263 application-security advisories and 207 dependency CVEs, and writing an operational runbook. None of this is AAP rework — the autonomous deliverable is defect-free.

**Critical path to production.**
1. Security review of the gate-blocking SSRF (`sendPayload.ts:373`) → decision/waiver.
2. Integrate `gate_verdict`/`verify.sh` into `pr.yml` as an additive gate; establish the findings baseline.
3. Advisory and CVE triage with documented risk-acceptance under the freeze.
4. Publish the re-run/baseline runbook.

**Success metrics.** `verify.sh` 16/16 PASS; 419 unique findings normalized; deterministic gate verdict (`BLOCK`) reproducible; 0 ANSI / 0 schema errors; 0 application files modified.

**Production-readiness assessment.** The **audit deliverable is production-ready** and ready to be operationalized. The **scanned application is NOT clear to merge through this gate** until the gate-blocking SSRF is reviewed — which is precisely the audit working as designed. `gate_verdict=BLOCK` is a correct security signal, not a deliverable defect.

| Dimension | Status |
|---|---|
| Audit corpus completeness | ✅ Complete (14/14 artifacts) |
| Verification (`verify.sh`) | ✅ 16/16 PASS |
| Read-only scope compliance | ✅ 0 application files modified |
| Reproducibility | ✅ Deterministic layers + gate anchor stable |
| Gate operationalization | ⬜ Pending CI/CD wiring (HT-2) |
| Finding disposition | ⬜ Pending human triage (HT-1/3/4) |

---

## 9. Development Guide

> This engagement produces audit artifacts, not a runnable application. The guide below covers **reproducing/operating the audit** and **consuming its outputs**. Every command was tested in the validation environment.

### 9.1 System Prerequisites

| Component | Version (verified) | Required for |
|---|---|---|
| OS | Linux x86-64 (Ubuntu 25.10 tested) / macOS | All layers |
| Python | 3.13.7 (≥3.12 acceptable) | Semgrep, JSON normalization, queries |
| Semgrep OSS | 1.167.0 | Layer 2 SAST |
| OSV-Scanner | 2.3.5 (prebuilt SLSA3 binary) | Layer 4 SCA |
| GNU grep | 3.11 | Layer 3a inventory |
| GNU findutils | 4.10.0 | Layer 0 / 3a |
| git | any recent | scope verification |

> Node.js is **not** required to run the static audit (the scanned app targets Node ≥20; the audit never executes app code).

### 9.2 Environment Setup

No environment variables, `.env`, database, or running services are required — the audit is fully static and read-only.

```bash
# Clone and check out the audit branch
git clone <repo-url> blitzy-cal && cd blitzy-cal
git checkout blitzy-40443edc-02d1-4206-b692-e0f3d73f0856

# Confirm the read-only scope (expect: 14 files, all status 'A')
git diff --name-status e988138b24..HEAD
```

### 9.3 Tooling Installation

```bash
# Semgrep (PEP 668 system Python requires --break-system-packages, OR use a venv)
pip install --break-system-packages semgrep==1.167.0
# Preferred (isolated):
python3 -m venv .venv && . .venv/bin/activate && pip install semgrep==1.167.0

# OSV-Scanner — prebuilt binary (go/Homebrew absent in CI)
#   download the linux_amd64 asset for v2.3.5 from:
#   https://github.com/google/osv-scanner/releases
chmod +x osv-scanner_linux_amd64 && sudo mv osv-scanner_linux_amd64 /usr/local/bin/osv-scanner

# Verify
semgrep --version          # -> 1.167.0
osv-scanner --version      # -> osv-scanner version: 2.3.5
python3 --version          # -> Python 3.13.7
```

### 9.4 Primary Verification (run this first)

```bash
cd <repo root>
bash verify.sh
# Expected tail:
#   ... 16x "PASS: Check N: ..."
#   checks_total=16  checks_failed=0  verification_status=PASS
# Exit code 0. The run is idempotent and records verification_status into findings-merged.json.
```

### 9.5 Re-running the Audit Layers (for future re-audits)

```bash
# Layer 0 — discovery (representative)
find . -type f | grep -oE '\.[^./]+$' | sort | uniq -c | sort -rn | head -20

# Layer 2 — Semgrep SAST → SARIF (metrics off, pinned packs)
semgrep scan --metrics=off \
  --config=p/security-audit --config=p/secrets --config=p/owasp-top-ten \
  --sarif -o results-semgrep.sarif .

# Layer 4 — OSV-Scanner SCA over the sole lockfile
osv-scanner --lockfile=./yarn.lock --format json > results-osv.json
```

### 9.6 Example Usage — Querying the Findings Corpus

```bash
# Gate verdict + verification status
python3 -c "import json;s=json.load(open('findings-merged.json'))[0]['_summary'];print(s['gate_verdict'], s['verification_status'], 'gate_blocking='+str(s['gate_blocking']))"
# -> BLOCK PASS gate_blocking=1

# List the gate-blocking finding(s)
python3 -c "import json;d=json.load(open('findings-layer-3b-taint.json'));[print(f\"{f['file']}:{f['line']}  {f['cwe']}  {f['severity']}\") for f in d if f.get('gateBlocking')]"
# -> packages/features/webhooks/lib/sendPayload.ts:373  CWE-918  high

# Severity distribution
python3 -c "import json;print(json.load(open('findings-merged.json'))[0]['_summary']['by_severity'])"
# -> {'critical': 29, 'high': 196, 'medium': 197, 'low': 49}

# Inventory query — count SSRF (CWE-918) sink sites
grep -c '\[CWE-918\]' sink-inventory.txt        # -> 272
```

### 9.7 Troubleshooting

| Symptom | Cause | Resolution |
|---|---|---|
| `error: externally-managed-environment` on `pip install` | PEP 668 system Python | Use `--break-system-packages` or a `venv` (§9.3) |
| `osv-scanner: command not found` | Binary not on `PATH` | Place the binary in `/usr/local/bin` and `chmod +x` |
| `verify.sh` reports a non-JS/TS sink category empty | Expected — TS-only codebase | Not a failure; non-JS/TS columns are expected-empty by design |
| `gate_verdict=BLOCK` surprises a pipeline | Misread as tooling error | BLOCK is the audit's **correct** finding (1 gate-blocking SSRF); review the finding, don't "fix" the script |
| Semgrep findings differ slightly across versions | Registry rule drift | Pin to 1.167.0 and the local `rules/` directory for reproducibility |

---

## 10. Appendices

### Appendix A — Command Reference

| Purpose | Command |
|---|---|
| Run full verification | `bash verify.sh` |
| Confirm read-only scope | `git diff --name-status e988138b24..HEAD` |
| Show gate verdict | `python3 -c "import json;print(json.load(open('findings-merged.json'))[0]['_summary']['gate_verdict'])"` |
| Per-layer finding counts | `for f in findings-layer-1-arch findings-layer-2-semgrep findings-layer-3b-taint findings-layer-4-osv; do echo -n "$f: "; python3 -c "import json;print(len(json.load(open('$f.json'))))"; done` |
| Semgrep scan | `semgrep scan --metrics=off --config=p/security-audit --config=p/secrets --config=p/owasp-top-ten --sarif -o results-semgrep.sarif .` |
| OSV scan | `osv-scanner --lockfile=./yarn.lock --format json > results-osv.json` |

### Appendix B — Port Reference

➖ **Not applicable.** The audit is a static, offline pipeline; it binds no network ports and starts no services.

### Appendix C — Key File Locations (the 14-artifact corpus)

| Artifact | Size | Role |
|---|---|---|
| `codebase-profile.txt` | 328 B | Layer 0 discovery profile |
| `findings-layer-1-arch.json` | 25 findings | Layer 1 architectural |
| `findings-layer-2-semgrep.json` | 32 findings | Layer 2 SAST (normalized) |
| `results-semgrep.sarif` | 1.48 MB | Layer 2 raw SARIF 2.1.0 |
| `sink-inventory.txt` / `-test.txt` | 9,952 / 7,273 lines | Layer 3a sink enumeration |
| `mitigation-inventory.txt` / `-test.txt` | 12,496 / 2,497 lines | Layer 3a mitigation enumeration |
| `findings-layer-3b-taint.json` | 207 findings | Layer 3b taint + gateBlocking |
| `results-osv.json` | 2.3 MB | Layer 4 raw OSV output |
| `findings-layer-4-osv.json` | 207 findings | Layer 4 dependency CVEs (normalized) |
| `findings-merged.json` | 419 findings + `_summary` | Directives 7–9 merged corpus + gate verdict |
| `verify.sh` | 1,118 lines | Directive 10 verification suite (16 checks) |
| `rules/.gitignore` | — | Semgrep rule-pin directory |

### Appendix D — Technology Versions

| Tool | Version |
|---|---|
| Semgrep OSS | 1.167.0 |
| OSV-Scanner | 2.3.5 (osv-scalibr 0.4.5) |
| Python | 3.13.7 |
| GNU grep | 3.11 |
| GNU findutils | 4.10.0 |
| Semgrep rule packs | `p/security-audit`, `p/secrets`, `p/owasp-top-ten` (pinned via `rules/`) |
| OSV.dev database | live (GHSA, PyPA, RustSec, NVD aggregate) |

### Appendix E — Environment Variable Reference

➖ **None required.** The audit reads no secrets and needs no environment configuration. (Note: `.env.example` and `.env.appStore.example` are *scanned* as read-only context for Layer 1 default/committed-secret analysis, never consumed at runtime.)

### Appendix F — Developer Tools Guide

- **Consuming the gate in CI (HT-2):** parse `findings-merged.json` → `_summary.gate_verdict`. Treat `ERROR`/`BLOCK` as a failing gate; `WARN` as a soft warning vs. the stored baseline; `PASS` as green. Run `verify.sh` as a precondition (it must exit 0) before trusting the verdict.
- **Reproducibility anchor:** the `gateBlocking` classification is the contract downstream CI relies on — two runs must agree on the gate-blocking set even if advisory findings differ.
- **Additive, not replacing:** wire this alongside the existing `.github/workflows/security-audit.yml` (`npm audit`) gate, not in place of it.

### Appendix G — Glossary

| Term | Meaning |
|---|---|
| **Sink** | A call site where tainted data can cause harm (e.g., redirect, HTTP client, raw query). |
| **Mitigation** | A control that neutralizes a sink (e.g., timing-safe compare, schema validation, auth middleware). |
| **`gateBlocking`** | Exploitability flag; `true` blocks the merge. Orthogonal to severity. |
| **`demotionReason`** | Required justification on every advisory (`gateBlocking:false`) finding. |
| **Corroborated** | A finding independently surfaced by ≥2 layers (highest confidence). |
| **Zero-hit category** | A CWE category with no first-party matches (e.g., CWE-134), documented — not silently dropped. |
| **BLOCK** | Gate verdict when ≥1 finding is `gateBlocking:true`. |
| **Read-only audit** | Engagement that scans but never modifies application source (`~0 files modified`). |

---

> **Cross-section integrity confirmed (RG4):** Remaining hours = **34** in Sections 1.2, 2.2, and 7 (pie). Section 2.1 (150) + Section 2.2 (34) = **184** = Total in Section 1.2. Completion = **81.5%** referenced identically in Sections 1.2, 7, and 8. All Section 3 tests originate from Blitzy's autonomous validation logs. Brand colors applied: Completed `#5B39F3`, Remaining `#FFFFFF`.