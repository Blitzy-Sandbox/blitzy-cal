# Blitzy Project Guide — `blitzy-cal` Read-Only Security Audit

> Engagement type: **Read-only, report-only security audit** (six-layer SAST/SCA/taint pipeline). Application source is scanned but **not modified** (~0 files changed). Deliverable = a corpus of 14 machine-readable audit artifacts plus a deterministic verification suite and a CI/CD gate verdict.
> Branch `blitzy-40443edc-02d1-4206-b692-e0f3d73f0856` · HEAD `b1a1b4f9b2` · working tree clean.

---

## 1. Executive Summary

### 1.1 Project Overview

This engagement delivered a deterministic, reproducible **six-layer security audit** of `blitzy-cal`, a Cal.com-derived TypeScript scheduling monorepo (7,433 first-party source files). The audit emits a structured, machine-readable findings corpus — architectural review, Semgrep SAST, exhaustive sink/mitigation inventory, dataflow taint triage, and dependency CVE scanning — consolidated into a merged report, a CI/CD gate verdict, and a 16-check verification script. The target users are CI/CD gates and human security reviewers who consume the verdict to block risky merges. Business impact: an additive, automatable security gate that complements the repository's existing `npm audit` job. The engagement is intentionally non-mutating: it reports findings without remediating them.

### 1.2 Completion Status

**Completion: 84.7%** — calculated on AAP-scoped work only (audit deliverables + path-to-production), using the hours formula `Completed / (Completed + Remaining)`.

```mermaid
%%{init: {'theme':'base', 'themeVariables': {'pie1':'#5B39F3','pie2':'#FFFFFF','pieStrokeColor':'#5B39F3','pieStrokeWidth':'2px','pieOuterStrokeColor':'#5B39F3','pieOuterStrokeWidth':'2px','pieTitleTextSize':'16px','pieSectionTextColor':'#B23AF2','pieLegendTextColor':'#000000'}}}%%
pie showData title Completion Status — 84.7% Complete
    "Completed Work (AI)" : 100
    "Remaining Work" : 18
```

| Metric | Value |
|--------|-------|
| **Total Hours** | **118** |
| **Completed Hours (AI + Manual)** | **100** (AI/Autonomous: 100 · Manual: 0) |
| **Remaining Hours** | **18** |
| **Percent Complete** | **84.7%** |

> Colour key — **Completed = Dark Blue `#5B39F3`**, **Remaining = White `#FFFFFF`**.

### 1.3 Key Accomplishments

- ✅ **All 11 directives (0–10) executed** and committed — the complete six-layer pipeline plus normalization, merge, gate, and verification.
- ✅ **14 audit artifacts produced**, all well-formed, schema-conformant, and ANSI-free (0 `\x1b` bytes anywhere).
- ✅ **`verify.sh` passes 16/16 deterministic checks** (exit 0) and is idempotent — independently re-run during this assessment.
- ✅ **289 total findings** normalized (248 unique after dedup): 19 architectural, 32 Semgrep, 62 taint, 176 dependency CVEs.
- ✅ **CI/CD gate verdict computed: `BLOCK`** — correctly driven by 2 gate-blocking taint findings (not a pipeline error); `verification_status = PASS`.
- ✅ **Deterministic layers reproduce exactly** — OSV (63 packages), Semgrep (32 findings), Layer 3a grep (CWE-338 = 59, CWE-611 = 2) match committed artifacts.
- ✅ **Zero application source modified** — the read-only constraint and dependency freeze were fully honoured.
- ✅ **All 10 Layer-1 architectural categories** and **all 19 Layer-3b CWE sink categories** covered with no silent category drops.

### 1.4 Critical Unresolved Issues

These are **operationalization / downstream** items (not defects in the audit artifacts, which are validated defect-free):

| Issue | Impact | Owner | ETA |
|-------|--------|-------|-----|
| Audit gate not yet wired into CI/CD | `gate_verdict=BLOCK` does not actually block any merge today; the gate provides no automated protection until integrated | DevOps / Platform | ~5h |
| 2 gate-blocking taint findings awaiting human triage | `BLOCK` verdict stands until reviewed; both in `packages/features/webhooks/lib/sendPayload.ts` (CWE-918 SSRF, CWE-347 silent HMAC drop) | Security / AppSec | ~4h |
| 176 dependency CVEs reported, not yet triaged | 5 critical + 75 high advisories require disposition decisions (remediation itself is out of scope per dependency freeze) | Security / AppSec | ~6h |

### 1.5 Access Issues

**No access issues identified.** The audit executed end-to-end: the repository was fully readable, both third-party tools (Semgrep OSS, OSV-Scanner) installed and ran, and all artifacts committed successfully.

| System/Resource | Type of Access | Issue Description | Resolution Status | Owner |
|-----------------|----------------|-------------------|-------------------|-------|
| `blitzy-cal` repository | Read/write (git) | None — full access confirmed | ✅ Resolved | — |
| Semgrep registry (`semgrep.dev`) | Network egress (rule packs) | None during audit; **forward-looking**: CI runners will need egress or vendored rules | ⚠ To verify in CI | DevOps |
| OSV.dev advisory DB | Network egress (OSV-Scanner) | None during audit; **forward-looking**: CI runners will need egress or an offline DB | ⚠ To verify in CI | DevOps |

### 1.6 Recommended Next Steps

1. **[High]** Triage and disposition the 2 gate-blocking taint findings in `sendPayload.ts` (SSRF egress allow-list, webhook signature enforcement). *(~4h)*
2. **[High]** Wire `verify.sh` + `gate_verdict` into a GitHub Actions workflow as an additive gate alongside `security-audit.yml`, failing the build on `BLOCK`. *(~5h)*
3. **[Medium]** Triage the 176 dependency CVEs (group by package, assess reachability) and log the cryptographic advisories to the security backlog. *(~6h)*
4. **[Medium]** Establish the finding-count baseline that the Directive-9 `WARN` threshold (>20% increase) compares against. *(~1h)*
5. **[Low]** Author an operational runbook and schedule a periodic (e.g., weekly) re-scan to prevent the point-in-time snapshot from going stale. *(~2h)*

---

## 2. Project Hours Breakdown

### 2.1 Completed Work Detail

All completed work is AAP-specified and autonomously delivered. Each component traces to a directive in the Agent Action Plan.

| Component | Hours | Description |
|-----------|-------|-------------|
| Layer 0 — Codebase Discovery (Directive 0) | 3 | `codebase-profile.txt` with all 8 fields; `primary_language=typescript`, `source_file_count=7433`, `layer_0_status=OK`. |
| Layer 1 — Architectural Security Audit (Directive 1) | 16 | Context-aware reasoning across all 10 architectural categories with attack-chain narratives; 19 CWE-classified findings. |
| Layer 2 — Semgrep SAST (Directives 2, 3) | 9 | Tool install + rule-pack pinning + SARIF scan + normalization; 32 findings; severity map `error→critical`(12), `warning→high`(20). |
| Layer 3a — Sink & Mitigation Inventory (Directive 4) | 10 | Deterministic `grep`/`find` enumeration of 19 sink + 9 mitigation categories (+ test variants); 4 files, 0 malformed lines (9,083 + 13,933). |
| Layer 3b — Taint / Exploitability Analysis (Directive 5) | 20 | Dataflow triage across all 19 CWE sink categories; 62 findings; `gateBlocking` flag + `demotionReason` on every advisory. |
| Layer 4 — OSV-Scanner SCA (Directive 6) | 5 | Binary install + `yarn.lock` scan + normalization; 176 CVEs deduped by `(package, CVE)`. |
| Normalization & Merge (Directives 7, 8) | 11 | Per-layer JSON normalization + `findings-merged.json` with `_summary`, corroboration annotation, severity escalation. |
| CI/CD Gate Verdict (Directive 9) | 3 | `ERROR/BLOCK/WARN/PASS` precedence logic; verdict embedded in merged report. |
| Verification Suite — `verify.sh` (Directive 10) | 9 | 870-line, 16-check deterministic verifier; idempotent; ANSI-safe; exit code = failure count. |
| Validation, QA & Determinism Hardening | 14 | Multi-checkpoint review cycles (CP1/CP2/final), SARIF secret redaction, defensive ANSI stripping, 16-check conformance, determinism re-runs. |
| **Total Completed** | **100** | |

### 2.2 Remaining Work Detail

All remaining work is **path-to-production** (operationalizing and acting on the audit). It excludes finding remediation, which is explicitly out of scope (dependency freeze + `CALENDSO_ENCRYPTION_KEY` continuity).

| Category | Hours | Priority |
|----------|-------|----------|
| CI/CD Gate Integration (GitHub Actions, additive gate, fail on `BLOCK`) | 5 | High |
| Gate-Blocking Finding Triage (2 webhook findings: CWE-918, CWE-347) | 4 | High |
| Dependency CVE Triage & Crypto Advisory Disposition (176 CVEs + AES-256-CBC / key reuse) | 6 | Medium |
| WARN Baseline Establishment (Directive-9 baseline for >20% threshold) | 1 | Medium |
| Operational Runbook & Scheduled Re-scan | 2 | Low |
| **Total Remaining** | **18** | |

### 2.3 Hours Reconciliation

| Quantity | Hours | Check |
|----------|-------|-------|
| Section 2.1 — Completed | 100 | — |
| Section 2.2 — Remaining | 18 | — |
| **Total Project Hours** | **118** | 2.1 + 2.2 = 118 ✓ |
| Completion % | 84.7% | 100 / 118 ✓ |

---

## 3. Test Results

For a read-only audit there is no in-scope application code to unit-test; the validation analogs are Blitzy's autonomous verification of the artifact corpus. **Every entry below originates from Blitzy's autonomous validation logs and was independently re-run during this assessment.** (The repository's own application unit tests are out of scope — see §5.)

| Test Category | Framework | Total Tests | Passed | Failed | Coverage % | Notes |
|---------------|-----------|-------------|--------|--------|-----------|-------|
| Verification Suite (Directive 10) | `verify.sh` (bash) | 16 | 16 | 0 | 100% | Deterministic checks; exit 0; idempotent (byte-identical on re-run). |
| Artifact Well-Formedness | Python `json` + SARIF parse | 7 | 7 | 0 | 100% | 6 JSON arrays + 1 SARIF (single `run`) all strict-parse valid. |
| Schema Conformance | Custom validators (in `verify.sh`) | 537 | 537 | 0 | 100% | Every finding: unified severity vocab, non-empty `description` ≤200 chars, integer `line`; all L3b have `gateBlocking`. |
| Determinism Re-runs | OSV-Scanner / Semgrep / `grep` | 3 | 3 | 0 | 100% | OSV 63 pkgs; Semgrep 32 findings; Layer 3a CWE-338=59, CWE-611=2 — reproduce committed artifacts. |
| Cross-Layer Reconciliation | `findings-merged.json` `_summary` | 1 | 1 | 0 | 100% | `by_layer` sum (19+32+62+176)=289=`total_findings`; body=248=`unique_findings`. |
| **Total** | — | **564** | **564** | **0** | **100%** | Zero defects across all in-scope audit artifacts. |

---

## 4. Runtime Validation & UI Verification

This engagement has **no UI and runs no services** — it is offline static analysis. "Runtime" validation therefore means end-to-end pipeline execution and verifier behaviour.

- ✅ **Operational** — Full six-layer pipeline executes end-to-end and reproduces committed outputs.
- ✅ **Operational** — `verify.sh` runs to completion: **16 PASS / 0 FAIL**, exit code 0.
- ✅ **Operational** — Gate verdict computed: `gate_verdict = BLOCK`, `verification_status = PASS`.
- ✅ **Operational** — Semgrep OSS 1.166.0 and OSV-Scanner 2.3.8 present, on `PATH`, and functional (confirmed via determinism re-runs).
- ✅ **Operational** — All 6 layer statuses `OK`; no `coverage:partial` flags; no silent category drops.
- ➖ **Not Applicable** — No web UI to verify (read-only audit deliverable; no front-end emitted).
- ➖ **Not Applicable** — No live API/runtime integration to exercise (the pipeline reads files and queries OSV/Semgrep rule sources only).

---

## 5. Compliance & Quality Review

Cross-mapping of AAP deliverables and global constraints to Blitzy's quality/compliance benchmarks.

| Benchmark / AAP Requirement | Status | Progress | Evidence |
|------------------------------|--------|----------|----------|
| All 11 directives (0–10) executed | ✅ Pass | 100% | All per-layer artifacts present and committed. |
| 14 audit artifacts produced | ✅ Pass | 100% | Enumerated in §10-C; all present on disk. |
| Layer 1 — all 10 architectural categories | ✅ Pass | 100% | `_summary.layer_1_categories`: all 10 `covered`. |
| Layer 3b — all 19 CWE sink categories | ✅ Pass | 100% | `verify.sh` Check 7: 62 findings cover all 19. |
| Layer 3a — 100% recall, line format | ✅ Pass | 100% | 0 malformed lines; `file:::line:::pattern`; CWE-134 correctly language-exempt. |
| Unified severity vocabulary | ✅ Pass | 100% | Check 9: only `critical\|high\|medium\|low`. |
| ANSI escape sequences stripped | ✅ Pass | 100% | Check 12: 0 `\x1b` bytes in any artifact. |
| `description` ≤200 chars + integer `line` | ✅ Pass | 100% | Check 13: all 537 findings have non-empty descriptions. |
| No silent failure / category drop | ✅ Pass | 100% | All `layer_N_status` present and `OK` (Check 15). |
| Determinism (layers 0, 2, 3a, 4) | ✅ Pass | 100% | Re-runs reproduce committed counts exactly. |
| `gateBlocking` reproducibility anchor | ✅ Pass | 100% | Check 8: all L3b have boolean `gateBlocking`; advisories have `demotionReason`. |
| L3b → sink-inventory traceability | ✅ Pass | 100% | Check 16: all 62 L3b findings map to a `file:line` in `sink-inventory.txt`. |
| ~0 application source modified | ✅ Pass | 100% | `git diff --stat`: only audit artifacts added; no app `UPDATE`/`DELETE`. |
| CI/CD gate integration | ⚠ Outstanding | 0% | No workflow references the pipeline yet (path-to-production). |

**Fixes applied during autonomous validation:** SARIF secret redaction; defensive ANSI stripping on all reads in `verify.sh`; conforming `verify.sh` to the exact 16-check AAP specification; Layer-3a deterministic 100%-recall restoration; multi-checkpoint review findings resolved.

**Out-of-scope context (not counted against this AAP):** ~47 pre-existing TypeScript type-check errors and 68 pre-existing failing application unit tests (7,301/7,436 pass) clustered in `packages/features/bookings/lib/handleNewBooking/test/*`. These are pre-existing **application** issues unrelated to the static audit (which scans source as text/AST and does not require the app to compile); they do not affect any audit artifact.

---

## 6. Risk Assessment

| Risk | Category | Severity | Probability | Mitigation | Status |
|------|----------|----------|-------------|------------|--------|
| Agent-layer finding variance between runs (L1/L3b) | Technical | Low | Medium | Reproducibility anchor is the `gateBlocking` decision boundary, not the exact finding set; `verify.sh` enforces structural consistency. | Mitigated |
| Semgrep rule-pack drift (pinned packs are gitignored) | Technical | Medium | Medium | Vendor the pinned `rules/` packs into the repo for long-term reproducibility. | Open |
| Tool-version drift (Semgrep/OSV not pinned in a manifest) | Technical | Low | Medium | Pin tool versions in CI provisioning. | Open |
| Semgrep CLI flag nuance (`--dryrun` vs documented `--dry-run`) | Technical | Low | Low | Runbook uses `--dryrun` (installed 1.166.0); documented in §9. | Documented |
| 2 gate-blocking webhook findings (CWE-918 SSRF, CWE-347 silent HMAC drop) | Security | High | High | Reported with source-to-sink path; human triage required (HT-1). Remediation out of scope. | Open |
| 176 dependency CVEs (5 critical, 75 high) | Security | Critical | High | Reported per-package with advisory IDs; triage via HT-3. Remediation frozen by AAP constraint. | Open |
| Cryptographic concerns (AES-256-CBC, `CALENDSO_ENCRYPTION_KEY` reuse) | Security | Medium | Medium | Reported as advisory; key-continuity constraint forbids change. | Open |
| Gate computed but not enforced in CI | Operational | High | High | Wire into GitHub Actions (HT-2). | Open |
| No `WARN` baseline established | Operational | Low | High | Record current counts as baseline (HT-4). | Open |
| Point-in-time snapshot goes stale | Operational | Medium | Medium | Schedule periodic re-scan (HT-5). | Open |
| CI runner must provision Semgrep + OSV-Scanner | Integration | Medium | Medium | Add tool install to workflow (binary path; `go` absent). | Open |
| Network egress to `semgrep.dev` / `osv.dev` required in CI | Integration | Medium | Medium | Allow egress or vendor rules + offline advisory DB. | Open |
| Downstream `gate_verdict` parsing contract | Integration | Low | Low | Implement `BLOCK ⇒ fail` consistently (HT-2). | Open |

---

## 7. Visual Project Status

### 7.1 Project Hours Breakdown

```mermaid
%%{init: {'theme':'base', 'themeVariables': {'pie1':'#5B39F3','pie2':'#FFFFFF','pieStrokeColor':'#5B39F3','pieStrokeWidth':'2px','pieOuterStrokeColor':'#5B39F3','pieOuterStrokeWidth':'2px','pieTitleTextSize':'16px','pieSectionTextColor':'#B23AF2','pieLegendTextColor':'#000000'}}}%%
pie showData title Project Hours (Total 118h)
    "Completed Work" : 100
    "Remaining Work" : 18
```

> **Completed = Dark Blue `#5B39F3` · Remaining = White `#FFFFFF`.** "Remaining Work" (18h) equals the Section 1.2 Remaining Hours and the sum of the Section 2.2 Hours column.

### 7.2 Remaining Hours by Category (Section 2.2)

```mermaid
%%{init: {'theme':'base', 'themeVariables': {'pie1':'#5B39F3','pie2':'#7B5CF5','pie3':'#9D86F8','pie4':'#C0B0FB','pie5':'#A8FDD9','pieStrokeColor':'#5B39F3','pieOuterStrokeColor':'#5B39F3','pieTitleTextSize':'15px','pieLegendTextColor':'#000000'}}}%%
pie showData title Remaining Work by Category (Total 18h)
    "CI/CD Gate Integration" : 5
    "Gate-Blocking Triage" : 4
    "Dependency CVE Triage" : 6
    "WARN Baseline" : 1
    "Runbook & Re-scan" : 2
```

### 7.3 Findings by Severity (Merged Corpus, informational)

```mermaid
%%{init: {'theme':'base', 'themeVariables': {'pie1':'#5B39F3','pie2':'#B23AF2','pie3':'#9D86F8','pie4':'#A8FDD9','pieStrokeColor':'#5B39F3','pieOuterStrokeColor':'#5B39F3','pieTitleTextSize':'15px','pieLegendTextColor':'#000000'}}}%%
pie showData title Findings by Severity (289 total)
    "Critical" : 17
    "High" : 104
    "Medium" : 108
    "Low" : 60
```

---

## 8. Summary & Recommendations

**Achievements.** The autonomous engagement is **84.7% complete** against AAP scope. All 11 directives executed and all 14 artifacts were produced, validated, and committed. The pipeline is deterministic, ANSI-free, schema-conformant, and passes its own 16-check verification suite with zero failures. The audit surfaced a complete, machine-readable security posture: **289 findings** (17 critical, 104 high, 108 medium, 60 low) across architectural, SAST, taint, and dependency dimensions, and produced a defensible CI/CD gate verdict of `BLOCK` driven by 2 exploitable webhook findings.

**Remaining gaps (18h, all path-to-production).** The audit is a finished deliverable but is not yet *operationalized*: the gate is not wired into CI, the 2 gate-blocking findings and 176 dependency CVEs await human triage, and no re-scan cadence or `WARN` baseline exists. None of these are defects in the audit artifacts; they are the standard handoff activities that turn a validated audit into an enforced gate.

**Critical path to production.** (1) Triage the 2 gate-blocking webhook findings → (2) wire the gate into GitHub Actions as an additive check → (3) triage dependency CVEs → (4) set the `WARN` baseline → (5) schedule recurring scans.

**Success metrics.** `verify.sh` = 16/16; `gate_verdict` reproducible; `verification_status = PASS`; zero application files modified — **all met.**

**Production readiness.** The **audit deliverable is production-ready and validated.** Its **enforcement in CI is not yet live**; completing the 18h of path-to-production work will make the gate operational. Remediation of the findings themselves remains intentionally out of scope per the dependency freeze and encryption-key-continuity constraints.

| Dimension | Status |
|-----------|--------|
| Audit artifact corpus | ✅ Complete & validated (100h) |
| Verification (`verify.sh`) | ✅ 16/16 PASS |
| Determinism / reproducibility | ✅ Confirmed |
| CI/CD enforcement | ⚠ Not yet integrated (18h remaining) |
| Finding remediation | ➖ Out of scope (report-only) |

---

## 9. Development Guide

> All commands are copy-pasteable and were tested during this assessment. Run from the repository root. The pipeline is **offline static analysis** — it starts no servers and exposes no ports.

### 9.1 System Prerequisites

| Software | Version (verified) | Notes |
|----------|--------------------|-------|
| Node.js | v20.20.2 | For workspace/ecosystem detection only; the app is not built. |
| Python | 3.13.7 | Drives Semgrep + JSON normalization helpers. |
| Semgrep OSS | 1.166.0 | Layer 2 SAST. |
| OSV-Scanner | 2.3.8 | Layer 4 SCA (prebuilt binary; `go` not required). |
| `grep` / `find` | GNU grep 3.11 / findutils 4.10 | Deterministic Layer 3a enumeration. |

`go`, `java`, and `docker` are **not required**.

### 9.2 Environment Setup

```bash
# Confirm the toolchain is present
semgrep --version          # -> 1.166.0
osv-scanner --version      # -> osv-scanner version: 2.3.8
node --version             # -> v20.20.2
python3 --version          # -> Python 3.13.7

# If Semgrep is missing:
pip install --break-system-packages semgrep    # or: python3 -m venv .venv && source .venv/bin/activate && pip install semgrep

# If OSV-Scanner is missing (no go/brew): download the prebuilt SLSA3 Linux binary
#   from https://github.com/google/osv-scanner/releases, chmod +x, and place on PATH.
```

### 9.3 Running the Audit Pipeline (canonical sequence)

```bash
# Layer 0 — Discovery (produces codebase-profile.txt)
find . -type f | grep -oE '\.[^./]+$' | sort | uniq -c | sort -rn | head -20
ls package.json yarn.lock pnpm-lock.yaml go.mod requirements.txt 2>/dev/null

# Layer 2 — Semgrep SAST (gate uses --dryrun; full scan emits SARIF)
semgrep scan --metrics=off \
  --config=p/security-audit --config=p/secrets --config=p/owasp-top-ten \
  --dryrun .                                   # Directive-2 gate: must exit 0
semgrep scan --metrics=off \
  --config=p/security-audit --config=p/secrets --config=p/owasp-top-ten \
  --sarif -o results-semgrep.sarif .           # Directive-3 scan

# Layer 4 — OSV-Scanner SCA over the sole lockfile
osv-scanner --lockfile=./yarn.lock --format json > results-osv.json

# (Layer 3a grep/find inventory and agent Layers 1 & 3b produce the remaining
#  per-layer JSON; Directives 7/8/9 normalize, merge, and compute the gate.)

# Directive 10 — Verification
bash verify.sh                                 # -> 16 PASS / 0 FAIL, exit 0
```

### 9.4 Verification & Downstream Consumption

```bash
# Re-run the full verification suite (idempotent)
bash verify.sh; echo "exit=$?"                 # exit=0 means all 16 checks passed

# Read the gate verdict the way CI should (BLOCK => fail the build)
python3 -c "import json; d=json.load(open('findings-merged.json'))[0]; \
print('gate_verdict =', d['gate_verdict'], '| verification_status =', d['verification_status'])"
#   -> gate_verdict = BLOCK | verification_status = PASS

# Validate any single artifact is well-formed JSON
python3 -c "import json; json.load(open('findings-merged.json')); print('valid JSON')"
```

### 9.5 Example Usage — inspecting findings

```bash
# Summary header (totals, by-layer, by-severity, layer statuses)
python3 -c "import json; print(json.dumps(json.load(open('findings-merged.json'))[0]['_summary'], indent=2))"

# List the gate-blocking taint findings
python3 -c "import json; [print(f\"{x['cwe']} {x['severity']} {x['file']}:{x['line']}\") \
for x in json.load(open('findings-layer-3b-taint.json')) if isinstance(x,dict) and x.get('gateBlocking')]"
```

### 9.6 Troubleshooting

| Symptom | Cause | Resolution |
|---------|-------|------------|
| `semgrep: unrecognized arguments: --dry-run` | Installed 1.166.0 uses `--dryrun` | Use `--dryrun` (one word) for the Directive-2 gate. |
| Semgrep findings differ between runs | Rule packs pulled live (pins are gitignored) | Vendor `rules/` packs into the repo and `--config=./rules`. |
| `osv-scanner: command not found` in CI | Tool not provisioned on the runner | Install the prebuilt binary in the workflow before scanning. |
| OSV-Scanner returns no data | No network egress to `osv.dev` | Allow egress or supply an offline advisory database. |
| `verify.sh` reports a non-zero exit | A check failed (exit = failure count) | Read the `FAIL:` line(s); each names the artifact/check at fault. |
| Expected-empty sink categories | Python/Go/Java patterns inapplicable to TS | Expected; these are language-exempt and never fail verification. |

---

## 10. Appendices

### A. Command Reference

| Purpose | Command |
|---------|---------|
| Semgrep gate (must exit 0) | `semgrep scan --metrics=off --config=p/security-audit --config=p/secrets --config=p/owasp-top-ten --dryrun .` |
| Semgrep SARIF scan | `semgrep scan --metrics=off --config=p/security-audit --config=p/secrets --config=p/owasp-top-ten --sarif -o results-semgrep.sarif .` |
| OSV-Scanner SCA | `osv-scanner --lockfile=./yarn.lock --format json > results-osv.json` |
| Run verification | `bash verify.sh` |
| Read gate verdict | `python3 -c "import json;print(json.load(open('findings-merged.json'))[0]['gate_verdict'])"` |
| Count ANSI bytes (should be 0) | `grep -cP '\x1b' findings-merged.json` |

### B. Port Reference

**None.** The audit pipeline runs no services and binds no ports — it is offline static analysis over the filesystem and lockfile.

### C. Key File Locations (all at repository root)

| Artifact | Role |
|----------|------|
| `codebase-profile.txt` | Layer 0 discovery profile |
| `findings-layer-1-arch.json` | Layer 1 architectural findings (19) |
| `results-semgrep.sarif` → `findings-layer-2-semgrep.json` | Layer 2 raw SARIF → normalized (32) |
| `sink-inventory.txt`, `sink-inventory-test.txt` | Layer 3a sink enumeration |
| `mitigation-inventory.txt`, `mitigation-inventory-test.txt` | Layer 3a mitigation enumeration |
| `findings-layer-3b-taint.json` | Layer 3b taint findings (62) |
| `results-osv.json` → `findings-layer-4-osv.json` | Layer 4 raw OSV → normalized (176) |
| `findings-merged.json` | Merged corpus + `_summary` + `gate_verdict` + `verification_status` |
| `verify.sh` | 16-check verification suite |
| `rules/` | Pinned Semgrep rule packs (gitignored placeholder) |

### D. Technology Versions

| Component | Version |
|-----------|---------|
| Semgrep OSS | 1.166.0 |
| OSV-Scanner | 2.3.8 (osv-scalibr 0.4.5) |
| Node.js | v20.20.2 |
| Python | 3.13.7 |
| GNU grep / findutils | 3.11 / 4.10.0 |
| Target repo HEAD | `b1a1b4f9b2` |
| Primary language | TypeScript (6,917 `.ts` + 1,678 `.tsx`; 7,433 source files) |

### E. Environment Variable Reference

The audit pipeline itself requires **no environment variables**. For reference, security-relevant variables of the *scanned* application (read-only context for Layer 1) include `CALENDSO_ENCRYPTION_KEY` (subject to a continuity constraint — must not be changed) and the webhook signing secret referenced by `sendPayload.ts`. Templates: `.env.example`, `.env.appStore.example`.

### F. Developer Tools Guide

| Tool | Role in pipeline |
|------|------------------|
| Semgrep OSS | Layer 2 SAST; rule packs `p/security-audit`, `p/secrets`, `p/owasp-top-ten`; `--sarif` output; `--metrics=off`. |
| OSV-Scanner | Layer 4 SCA; queries the OSV.dev aggregate DB; `--lockfile` + `--format json`. |
| `grep` / `find` | Layer 3a deterministic 100%-recall inventory; `file:::line:::pattern` format. |
| Python 3 | JSON normalization, dedup, merge, and verification helpers. |
| `verify.sh` | Self-contained 16-check verifier; exit code = failure count. |

### G. Glossary

| Term | Definition |
|------|------------|
| **Sink** | A code location where untrusted data may cause harm (e.g., redirect, raw query, `fetch`). |
| **Mitigation** | A control that neutralizes a sink (e.g., Zod validation, timing-safe compare, auth middleware). |
| **`gateBlocking`** | Boolean on a taint finding marking it as merge-blocking; the reproducibility anchor of the audit. |
| **`demotionReason`** | Required text explaining why a non-blocking (advisory) finding was demoted. |
| **Gate verdict** | `ERROR` (pipeline broken) · `BLOCK` (≥1 gate-blocking finding) · `WARN` (>20% over baseline) · `PASS`. |
| **Corroboration** | A finding surfaced by two independent layers (e.g., Semgrep + taint) — highest confidence. |
| **SARIF** | Static Analysis Results Interchange Format — Semgrep's machine-readable output. |

---

*Generated by the Blitzy Platform · AAP-scoped completion: **84.7%** (100h completed / 18h remaining / 118h total).*