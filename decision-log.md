# Security Audit — Decision Log

This is the **decision log** for a **read-only, four-layer security audit** of the Cal.com monorepo (Yarn 4.12.0 + Turborepo; ~7,440 TypeScript/JavaScript source files under `apps/**` and `packages/**`). The engagement produced **9 net-new deliverables** and modified **0** existing application, test, CI, configuration, `.env`, or dependency-manifest files — it *measures* security posture; it does not *fix* it.

Per the **Explainability Rule (AAP §0.7.1)**, this Markdown file is the **single source of truth for *why*** every non-trivial implementation decision was made. A decision is "non-trivial" when a competent engineer could reasonably have chosen differently. Rationale lives **here only** — never in code comments. Numbers cited in §4 are quoted verbatim from the finalized `findings-merged.json` `_summary`.

---

## 1. Decision Table

Each row records one non-trivial decision: what was decided, the alternatives weighed, why this option was chosen, and the residual risk or trade-off it carries. Decision IDs (`D#`) are stable references used elsewhere in this log.

| # | Decision | Alternatives Considered | Rationale | Risk / Trade-off |
|---|----------|-------------------------|-----------|------------------|
| D1 | Emit each findings file as **single-line minified JSON** (one physical line terminated by exactly one trailing newline) | Multi-line, pretty-printed JSON | Required so the Directive-8 invariant `cat findings-layer-*.json \| wc -l` returns exactly `4`; yields deterministic, diff-stable verification | Raw files are hard to read by eye; mitigated by `findings-merged.json` and this decision log |
| D2 | Use the **strict 7-key schema** `{file,line,severity,cwe,description,layer,tool}` for every finding | A richer schema carrying extra scanner metadata (rule id, confidence, data-flow trace, references) | Matches the user-provided canonical schema verbatim and enables deterministic, machine-checkable verification | Some scanner context is dropped from the normalized layers; it is preserved intact in the raw intermediates (`results-semgrep.sarif`, `results-osv.json`) |
| D3 | Apply the **severity normalization map** `error→critical`, `warning→high`, `note→medium`, `info→low` | Keep each tool's native severity vocabulary | A uniform 4-value enum (`critical\|high\|medium\|low`) across all four layers is what makes cross-layer de-duplication, corroboration, and the `_summary` roll-up possible | Minor loss of per-tool nuance; acceptable because the merged report is the consumption surface |
| D4 | Take **CWE from rule metadata when present, otherwise infer the most specific applicable CWE** | Leave `cwe` null when a tool omits it | Every finding must carry a `CWE-###` for the schema and the coverage matrix; metadata-first preserves fidelity where the tool already supplies it | Inference is best-effort; inferred values are conservative and chosen as the most specific applicable weakness |
| D5 | Apply **only the two specified false-positive suppression rules** | Broad, open-ended manual triage of every match | Drop `auth-guard-returns-true` in `*.test.*` / `*.spec.*` / `*.e2e-spec.*` stubs, and drop hardcoded-argument shell-exec matches under build/script directories — exactly the two rules named in the requirements | Over-suppression risk is bounded to two narrowly-scoped rules; all other matches are retained as findings |
| D6 | **Layer-4 de-duplication keys on `(package_name, CVE_ID)`** | De-duplicate by package name only | Aligns with OSV-Scanner alias grouping (vulnerabilities that share an alias are the same vulnerability), collapsing alias noise without dropping genuinely distinct CVEs | Multiple distinct CVEs affecting the same package are intentionally retained as separate findings |
| D7 | **Cross-layer de-duplication keys on `(file, line, CWE)`**, keeping the higher severity and adding `corroborated_by:"<tool>"` | Keep every duplicate across layers | De-noises the merged report while preserving the corroboration signal — a defect seen by two layers is higher-confidence, not double-counted | Requires consistent `file`/`line` normalization across layers; lockfile findings normalize to `yarn.lock:1` |
| D8 | **Composite escalation of +1 severity tier** when a Layer-1 architectural weakness and a Layer-3 taint chain compose into a single exploit path | Report the two findings independently at their original severities | A chainable architectural gap plus a reachable taint path is more exploitable than either alone, so the escalation reflects true risk | Escalation is conservative and explicit; every escalated finding is annotated so reviewers can see the original tiers |
| D9 | **OSV-Scanner targets only `/yarn.lock`** | Also scan container images (`osv-scanner scan image`) and any other manifests | `/yarn.lock` is the sole lockfile in the repository; container-image scanning is explicitly out of scope per the AAP | Coverage is transitive-dependency only, exactly as scoped; OS-package and image-layer CVEs are not assessed |
| D10 | **Semgrep rule packs = `p/security-audit` + `p/secrets` + `p/owasp-top-ten`** | Add other scanners or packs (Trivy, CodeQL, gitleaks, other `p/*` packs) | These are exactly the three packs named in the requirements; additional scanners are explicitly out of scope | Pattern coverage is bounded to these three packs; this bound is intentional, not accidental |
| D11 | Run **all Semgrep invocations with `--metrics=off`** | Leave default telemetry enabled | Privacy- and offline-safe per the telemetry-disabled directive; no scan data leaves the audit environment | None |
| D12 | Ground the **webhook CWE-347 finding in `packages/features/webhooks/lib/sendPayload.ts` signature omission** | Cite a `"no-secret-provided"` default literal as stated in the prompt | The `"no-secret-provided"` literal **does not exist** anywhere in the repository; the real behavior is `createWebhookSignature` returning `""` when no secret is set, after which the `X-Cal-Signature-256` header is omitted entirely `[sendPayload.ts:L347-371]` | The finding remains valid (unauthenticated webhook delivery); only the grounding citation is corrected — see §2, Deviation V5 |
| D13 | **Report the `.yarnrc.yml` advisory suppression `1113407`, but leave it unchanged** | Remove the suppression or modify `.yarnrc.yml` | The suppression is already justified (fast-xml-parser 4.4.1 via `@boxyhq/saml-jackson` → `@aws-sdk/core`, parsing only trusted AWS responses) and editing it would violate the read-only / audit-only posture | Layer 4 surfaces the suppressed advisory for visibility; remediation/decision is left to the project owners |
| D14 | **Empty-result layers still emit a valid single-line `[]` file** | Skip the file or write an empty/zero-byte file | Preserves the `wc -l = 4` invariant and keeps the merge step total-function over all four layers regardless of findings count | A `[]` layer is indistinguishable from "not run" by line count alone; the `_summary` per-layer counts disambiguate |
| D15 | Serialize `findings-merged.json` as a **`{"_summary":{…},"findings":[…]}` object** with the summary first | Prepend `_summary` as the first element of a flat array | The summary "leads" the file as required and is trivially addressable as a named key (`._summary`) for downstream consumers and this log | Consumers expecting a flat array must read `.findings`; documented here and in the verification gate |
| D16 | **Embed the full Blitzy reveal.js theme inline** in the executive deck | Link the canonical `blitzy-deck/references/blitzy-reveal-theme.css` as an external stylesheet | That reference CSS is a Blitzy-internal file and is **not present in the target repository**; inlining satisfies the "single self-contained HTML, no local file dependency" requirement | The deck duplicates theme tokens inline; acceptable and required for self-containment |
| D17 | In §4, quote **post-de-duplication per-layer counts** from `_summary` (e.g., `layer1 = 153`) rather than raw layer-file counts (`159`) | Quote the raw pre-merge counts | The `_summary` is the finalized, authoritative roll-up; its per-layer counts are post cross-layer de-duplication and sum exactly to `total` (`153+34+49+164 = 400`) | The 6-finding delta between the raw Layer-1 file (159) and `_summary.layer1` (153) is explained in §4.3 so the numbers reconcile |
| D18 | Record the **measured runtime versions actually used** (Node v20.20.2, Python 3.13.7) in the ledger | Copy the runtime versions stated in AAP §0.6.1 (Node v22.x, Python 3.12) | A version ledger must be factual; the values recorded are what was measured in the audit environment and used by the scanners | The measured runtimes differ from the AAP-stated ones; the discrepancy is called out explicitly in §2, Deviation V6 |

---

## 2. Known Deviations

Every deviation from a literal or obvious reading of the requirements is recorded below. Per AAP §0.7.1, an unexplained deviation is treated as a defect. Each entry states what differs, why, and the net effect on the audit.

| ID | Deviation | Literal/Obvious Reading | What Was Done & Why | Net Effect |
|----|-----------|-------------------------|---------------------|------------|
| V1 | **`--dryrun` instead of `--dry-run`** for the Semgrep config check | Prompt text implies `--dry-run` | Modern Semgrep exposes the flag as `--dryrun`; it validates the rule-pack configuration offline and exits cleanly without network access | Config is validated as intended; flag spelling corrected to the supported form |
| V2 | **`p/owasp` resolved to `p/owasp-top-ten`** | Use the pack id `p/owasp` exactly | `p/owasp` is not a Semgrep Registry slug; `p/owasp-top-ten` is the canonical OWASP Top-10 pack the `p/` prefix resolves from the Registry | OWASP coverage is delivered by the correct, resolvable pack id |
| V3 | **Scanner exit code `1` treated as SUCCESS** | Treat any non-zero exit as failure | Semgrep exit `1` means "findings present" and OSV-Scanner exit `1` means "vulnerabilities present" — both are the expected outcome of an audit; only exit code `≥2` is a hard failure | Audit proceeds and captures artifacts on exit `1`; genuine tool errors (`≥2`) still fail loudly |
| V4 | **Semgrep installed with `--break-system-packages`** | Plain `pip install semgrep` | The audit environment is an externally-managed Python (PEP 668); a plain install errors out, so Semgrep 1.164.0 was installed into an isolated environment using `--break-system-packages` | Semgrep installs reproducibly; no system Python packages are disturbed for the project itself |
| V5 | **Webhook CWE-347 grounding corrected** to the real signature-omission code | Cite a `"no-secret-provided"` default literal | That literal does not exist in the repository; the actual weakness is `createWebhookSignature` returning `""` when no secret is configured, causing the `X-Cal-Signature-256` header to be omitted entirely `[packages/features/webhooks/lib/sendPayload.ts:L347-371]` | The finding stands (unauthenticated webhook delivery); only the citation is corrected for accuracy — see decision D12 |
| V6 | **Runtime versions recorded as measured** (Node v20.20.2, Python 3.13.7) | AAP §0.6.1 states Node v22.22.2, Python 3.12.3 | The version ledger must reflect reality; the audit environment measured Node v20.20.2 and Python 3.13.7 (the Semgrep isolated environment runs on Python 3.13.7). The scanner versions themselves (Semgrep 1.164.0, OSV-Scanner 2.3.8) match the AAP exactly | Ledger is factual; only the host-runtime minor versions differ from the AAP text — no effect on scanner behavior or findings |

---

## 3. Layer ↔ CWE ↔ Directive Coverage Matrix

Because this engagement performs **no migration or refactor**, the bidirectional traceability matrix mandated by AAP §0.7.1 is realized here as a **Layer ↔ CWE ↔ Directive ↔ deliverable** matrix. It demonstrates that every audit layer, every named CWE category, and every one of the eight directives is covered, with no gaps.

### 3.1 Layer → CWE categories → Directive → deliverable

| Layer | Detection Method | CWE Categories Covered (as named in the AAP) | Directive(s) | Deliverable(s) |
|-------|------------------|----------------------------------------------|--------------|----------------|
| **1 — Architectural** (`tool="blitzy"`) | Native Blitzy reasoning over the whole codebase, containers, CI, and `.env*.example` | CWE-327/326 (unauthenticated AES-CBC crypto), CWE-323/328 (encryption-key reuse / weak HMAC), CWE-1021/79 (CSP `unsafe-inline`/`unsafe-eval`), CWE-798/1188 (default/hardcoded secrets), CWE-250/552 (root-user containers), CWE-1357/829 (mutable CI action tags), CWE-347 (webhook signature omission), CWE-521 (weak password policy), CWE-636 (watchlist fail-open), CWE-697/287 (Turnstile bypass), CWE-942 (CORS dev wildcard), CWE-807 (authorization on user input), SAML/SSO insecure defaults | **1** | `findings-layer-1-blitzy.json` |
| **2 — Semgrep SAST** (`tool="semgrep"`) | Semgrep OSS pattern scan over `p/security-audit` + `p/secrets` + `p/owasp-top-ten` | CI/CD injection (CWE-78), committed secrets / PEM keys, container misconfiguration (CWE-250), XSS (CWE-79), hardcoded credentials (CWE-798), over-privileged `GITHUB_TOKEN`, disabled TLS verification (CWE-295/310), unchecked `postMessage` origin (CWE-345/346) | **2, 3, 6** | `findings-layer-2-semgrep.json` (+ raw `results-semgrep.sarif`) |
| **3 — Taint dataflow** (`tool="blitzy-taint"`) | AI-powered source→sink enumeration across all seven sink categories | CWE-601 (Open Redirect), CWE-918 (SSRF), CWE-117 (Log Injection), CWE-807 (authorization decision on user input), CWE-338 (weak PRNG), CWE-843 (type confusion), CWE-862 (missing authorization) | **4** | `findings-layer-3-blitzy-taint.json` |
| **4 — OSV-Scanner SCA** (`tool="osv-scanner"`) | Dependency scan of `/yarn.lock` against OSV.dev | Known CVEs across npm/PyPI/Go/Maven/Cargo ecosystems, malicious packages, and outdated transitive dependencies (58 distinct CWE classes emitted, incl. CWE-94/96 code injection, CWE-89 SQLi, CWE-918 SSRF, CWE-862/863 authorization, CWE-91 XML injection, CWE-835 DoS) | **5, 6** | `findings-layer-4-osv.json` (+ raw `results-osv.json`) |
| **Cross-layer** (merge) | ANSI strip, schema coercion, single-line minification, `(package,CVE)` and `(file,line,CWE)` de-duplication, corroboration, composite escalation, `_summary` | All of the above, consolidated | **6, 7** | `findings-merged.json` |
| **Verification** | Seven Directive-8 pass/fail checks | n/a (gate over all deliverables) | **8** | Verification report |

### 3.2 Directive → action → deliverable (1–8)

| Directive | Required Action | Primary Deliverable(s) | Status |
|-----------|-----------------|------------------------|--------|
| **1** | Layer-1 architectural audit across all five vulnerability categories | `findings-layer-1-blitzy.json` | Covered |
| **2** | Install & configure Semgrep with `--metrics=off` and local rule packs | Configured Semgrep CLI (1.164.0) | Covered |
| **3** | Run Semgrep, capture SARIF, normalize it | `results-semgrep.sarif` → `findings-layer-2-semgrep.json` | Covered |
| **4** | Layer-3 taint analysis covering all seven sink categories | `findings-layer-3-blitzy-taint.json` | Covered |
| **5** | Run OSV-Scanner over `/yarn.lock`, capture JSON, normalize it | `results-osv.json` → `findings-layer-4-osv.json` | Covered |
| **6** | Normalize every layer to single-line minified JSON on the strict schema, strip ANSI, de-duplicate with `corroborated_by` | Four normalized layer files | Covered |
| **7** | Produce the cross-layer merged report with `_summary`, corroboration, composite escalation | `findings-merged.json` | Covered |
| **8** | Execute the verification suite (seven pass/fail checks) | Verification report | Covered |

### 3.3 Grounding reconciliation and the "no gaps" statement

The matrix in §3.1 lists CWE categories as **named in the AAP**. For full traceability, the **actual distinct CWEs emitted** by each layer file are:

- **Layer 1 (18 distinct):** CWE-208, 250, 307, 323, 326, 327, 347, 348, 521, 532, 636, 697, 798, 829, 942, 1021, 1188, 1357.
- **Layer 2 (6 distinct):** CWE-78, 79, 250, 310, 345, 798.
- **Layer 3 (7 distinct — exactly the seven mandated sinks):** CWE-117, 338, 601, 807, 843, 862, 918.
- **Layer 4 (58 distinct):** broad CVE-derived set including CWE-22, 74, 78, 79, 89, 91, 93, 94, 96, 200, 295, 328, 346, 347, 352, 400, 835, 862, 863, 918, and others.

Three AAP-named category pairs are realized in the layer where the scanner actually emitted the CWE rather than where the prompt's narrative places them; this is reconciled explicitly so the coverage claim is honest:

- **CWE-79 (XSS), paired with CSP under Layer 1**, is emitted by Layers 2 and 4; the Layer-1 CSP finding itself carries **CWE-1021** (improper restriction of rendered UI layers). The category is covered.
- **CWE-328 (weak hash / legacy HMAC-SHA1), paired with key-reuse under Layer 1**, is emitted by Layer 4; Layer 1 carries **CWE-323** (encryption-key reuse) plus the legacy-HMAC narrative. The category is covered.
- **CWE-807 (authorization on user input)**, named under both Layer 1 and Layer 3, is emitted by **Layer 3** (5 findings). The category is covered.

**No gaps.** All eight directives (1–8) are satisfied (§3.2), and every named CWE category resolves to at least one emitted finding in at least one layer (§3.1 + the reconciliation above). All seven Layer-3 sink categories are present with non-zero counts (CWE-601=13, CWE-918=7, CWE-117=11, CWE-807=5, CWE-338=3, CWE-843=7, CWE-862=3). There are no uncovered directives and no uncovered CWE categories.

---

## 4. Tool & Version Ledger

All versions below are **pinned and reproduce exactly what was used**. The scanner toolchain is environment-local to the audit and is intentionally **distinct from the target project's own dependencies**, which are not touched.

### 4.1 Audit toolchain

| Component | Version | Source / Registry | Role |
|-----------|---------|-------------------|------|
| Semgrep | **1.164.0** | PyPI (installed via `pip --break-system-packages`) | Layer-2 pattern SAST engine; SARIF output; run with `--metrics=off` |
| OSV-Scanner | **2.3.8** | GitHub Releases | Layer-4 dependency SCA over `/yarn.lock` |
| osv-scalibr | **0.4.5** | Bundled inside OSV-Scanner 2.3.8 | Lockfile extraction back-end for OSV-Scanner |
| `p/security-audit` | Registry pack (no semver) | Semgrep Registry | Broad security ruleset |
| `p/secrets` | Registry pack (no semver) | Semgrep Registry | Committed-secret / PEM-key detection |
| `p/owasp-top-ten` | Registry pack (no semver) | Semgrep Registry | OWASP Top-10 coverage (resolves the prompt's `p/owasp`; see Deviation V2) |
| reveal.js | **5.1.0** | CDN (jsDelivr/unpkg), pinned | Executive deck framework |
| Mermaid | **11.4.0** | CDN, pinned | Deck architecture / data-flow diagrams |
| Lucide | **0.460.0** | CDN, pinned | Deck SVG icons |

### 4.2 Runtime environment (as measured; see Deviation V6)

| Runtime | Version (measured) | Notes |
|---------|--------------------|-------|
| Node.js | **v20.20.2** | npm 11.1.0; matches the project's `node:20` container target |
| Python | **3.13.7** | Hosts the isolated Semgrep environment |
| Yarn | **4.12.0** | Berry, via corepack; `nodeLinker: node-modules` |
| jq | **1.8.1** | Used with Python 3 for JSON normalize / minify / ANSI-strip / merge |

### 4.3 Findings summary snapshot (quoted from `findings-merged.json` `_summary`)

The following totals are quoted verbatim from the finalized `findings-merged.json` `_summary` header.

| Metric | Value |
|--------|-------|
| **Total findings** | **400** |
| Critical | 19 |
| High | 113 |
| Medium | 157 |
| Low | 111 |
| Layer 1 (`blitzy`) | 153 |
| Layer 2 (`semgrep`) | 34 |
| Layer 3 (`blitzy-taint`) | 49 |
| Layer 4 (`osv-scanner`) | 164 |
| Corroborated (cross-layer) | 7 |
| Composite (escalated) | 5 |
| Tool versions | `blitzy` = native, `blitzy-taint` = native, `osv-scanner` = 2.3.8, `semgrep` = 1.164.0 |

Both roll-ups are internally consistent: the severity counts sum to the total (`19 + 113 + 157 + 111 = 400`) and the per-layer counts sum to the total (`153 + 34 + 49 + 164 = 400`).

**Per-layer count reconciliation (decision D17).** The raw `findings-layer-1-blitzy.json` file contains **159** finding objects, whereas `_summary.layer1` reports **153**. The 6-finding difference is the number of Layer-1 findings absorbed during cross-layer de-duplication on `(file, line, CWE)` (decision D7), where a Layer-1 finding coincided with a Layer-3 finding at the same site and was collapsed into a single corroborated finding. The `_summary` per-layer counts are therefore the **post-de-duplication** authoritative figures, which is why they — and not the raw file counts — are quoted here. Layers 2, 3, and 4 had no cross-layer collapses, so their `_summary` counts (34, 49, 164) equal their raw file counts.

---

*This decision log is a mandatory deliverable produced independently of the findings themselves (AAP §0.7.1). It is the sole source of truth for "why" — no rationale for any audit decision is duplicated into code comments anywhere in the deliverables. No existing repository file was modified to produce it.*
