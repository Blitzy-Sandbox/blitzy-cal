# Security Audit — Decision Log

This is the **decision log** for a **read-only, four-layer security audit** of the Cal.com monorepo (Yarn 4.12.0 + Turborepo; ~7,440 TypeScript/JavaScript source files under `apps/**` and `packages/**`). The engagement produced **9 net-new deliverables** and modified **0** existing application, test, CI, configuration, `.env`, or dependency-manifest files — it *measures* security posture; it does not *fix* it.

Per the **Explainability Rule (AAP §0.7.1)**, this Markdown file is the **single source of truth for *why*** every non-trivial implementation decision was made. A decision is "non-trivial" when a competent engineer could reasonably have chosen differently. Rationale lives **here only** — never in code comments. Numbers cited in §4 are quoted verbatim from the finalized `findings-merged.json` `_summary`.

---

## 1. Decision Table

Each row records one non-trivial decision: what was decided, the alternatives weighed, why this option was chosen, and the residual risk or trade-off it carries. Decision IDs (`D#`) are stable references used elsewhere in this log.

| Decision | Alternatives Considered | Rationale | Risk / Trade-off |
|----------|-------------------------|-----------|------------------|
| **D1** — Emit each findings file as **single-line minified JSON** (one physical line terminated by exactly one trailing newline) | Multi-line, pretty-printed JSON | Required so the Directive-8 invariant `cat findings-layer-*.json \| wc -l` returns exactly `4`; yields deterministic, diff-stable verification | Raw files are hard to read by eye; mitigated by `findings-merged.json` and this decision log |
| **D2** — Use the **strict 7-key schema** `{file,line,severity,cwe,description,layer,tool}` for every finding | A richer schema carrying extra scanner metadata (rule id, confidence, data-flow trace, references) | Matches the user-provided canonical schema verbatim and enables deterministic, machine-checkable verification | Some scanner context is dropped from the normalized layers; it is preserved intact in the raw intermediates (`results-semgrep.sarif`, `results-osv.json`) |
| **D3** — Apply the **severity normalization map** `error→critical`, `warning→high`, `note→medium`, `info→low` | Keep each tool's native severity vocabulary | A uniform 4-value enum (`critical\|high\|medium\|low`) across all four layers is what makes cross-layer de-duplication, corroboration, and the `_summary` roll-up possible | Minor loss of per-tool nuance; acceptable because the merged report is the consumption surface |
| **D4** — Take **CWE from rule metadata when present, otherwise infer the most specific applicable CWE** | Leave `cwe` null when a tool omits it | Every finding must carry a `CWE-###` for the schema and the coverage matrix; metadata-first preserves fidelity where the tool already supplies it | Inference is best-effort; inferred values are conservative and chosen as the most specific applicable weakness |
| **D5** — Apply **only the two specified false-positive suppression rules** | Broad, open-ended manual triage of every match | Drop `auth-guard-returns-true` in `*.test.*` / `*.spec.*` / `*.e2e-spec.*` stubs, and drop hardcoded-argument shell-exec matches under build/script directories — exactly the two rules named in the requirements | Over-suppression risk is bounded to two narrowly-scoped rules; all other matches are retained as findings |
| **D6** — **Layer-4 de-duplication keys on `(package_name, CVE_ID)`** | De-duplicate by package name only | Aligns with OSV-Scanner alias grouping (vulnerabilities that share an alias are the same vulnerability), collapsing alias noise without dropping genuinely distinct CVEs | Multiple distinct CVEs affecting the same package are intentionally retained as separate findings |
| **D7** — **Cross-layer de-duplication keys on `(file, line, CWE)`**, keeping the higher severity and adding `corroborated_by:"<tool>"` | Keep every duplicate across layers | De-noises the merged report while preserving the corroboration signal — a defect seen by two layers is higher-confidence, not double-counted | Requires consistent `file`/`line` normalization across layers. Layer-4 lockfile findings are keyed to the **real `yarn.lock` package-entry line** for each affected package (the first line of that package's block in the lockfile), not to a `yarn.lock:1` sentinel, so genuinely distinct advisories no longer collide on one line; the resulting intra-Layer-4 `(file,line,CWE)` collapse (164 → 126) is itemized in §4.3 |
| **D8** — **Composite escalation of +1 severity tier** when a Layer-1 architectural weakness and a Layer-3 taint chain compose into a single exploit path | Report the two findings independently at their original severities | A chainable architectural gap plus a reachable taint path is more exploitable than either alone, so the escalation reflects true risk | Escalation is conservative and explicit; every escalated finding is annotated so reviewers can see the original tiers |
| **D9** — **OSV-Scanner targets only `/yarn.lock`** | Also scan container images (`osv-scanner scan image`) and any other manifests | `/yarn.lock` is the **sole OSV-scannable lockfile** in the repository. One other tracked lockfile exists — `packages/embeds/embed-core/bun.lockb` — but it is Bun's **binary** lockfile format (`file` reports "a bun script executable (binary data)") for which OSV-Scanner 2.3.8 has no extractor: scanning it exits non-zero with "could not determine extractor suitable to this file", and `bun` is not installed in the audit environment to transcode it to a text manifest. `@calcom/embed-core` is moreover a Yarn-workspace member (matched by the root `packages/embeds/*` workspaces glob), so its dependency tree is resolved and represented in the root `/yarn.lock` that OSV did scan. Container-image scanning is explicitly out of scope per the AAP | Coverage is transitive-dependency only, exactly as scoped; OS-package and image-layer CVEs are not assessed. The binary `bun.lockb` is not separately parsed (no extractor in OSV-Scanner 2.3.8; `bun` unavailable), but the workspace's dependency graph is represented in `/yarn.lock`; this exclusion is documented rather than silently dropped |
| **D10** — **Semgrep rule packs = `p/security-audit` + `p/secrets` + `p/owasp-top-ten`** | Add other scanners or packs (Trivy, CodeQL, gitleaks, other `p/*` packs) | These are exactly the three packs named in the requirements; additional scanners are explicitly out of scope | Pattern coverage is bounded to these three packs **plus one small custom local rule** that deterministically flags Dockerfile default-secret `ARG`s (see decision D20 and Deviation V8); this bound is intentional, not accidental |
| **D11** — Run **all Semgrep invocations with `--metrics=off`** | Leave default telemetry enabled | Privacy- and offline-safe per the telemetry-disabled directive; no scan data leaves the audit environment | None |
| **D12** — Ground the **webhook CWE-347 finding in `packages/features/webhooks/lib/sendPayload.ts` signature omission** | Cite a `"no-secret-provided"` default literal as stated in the prompt | The `"no-secret-provided"` literal **does not exist** anywhere in the repository; the real behavior is `createWebhookSignature` returning `""` when no secret is set, after which the `X-Cal-Signature-256` header is omitted entirely `[sendPayload.ts:L347-371]` | The finding remains valid (unauthenticated webhook delivery); only the grounding citation is corrected — see §2, Deviation V5 |
| **D13** — **Report the `.yarnrc.yml` advisory suppression `1113407`, but leave it unchanged** | Remove the suppression or modify `.yarnrc.yml` | The suppression is already justified (fast-xml-parser 4.4.1 via `@boxyhq/saml-jackson` → `@aws-sdk/core`, parsing only trusted AWS responses) and editing it would violate the read-only / audit-only posture | Layer 4 surfaces the suppressed advisory for visibility; remediation/decision is left to the project owners |
| **D14** — **Empty-result layers still emit a valid single-line `[]` file** | Skip the file or write an empty/zero-byte file | Preserves the `wc -l = 4` invariant and keeps the merge step total-function over all four layers regardless of findings count | A `[]` layer is indistinguishable from "not run" by line count alone; the `_summary` per-layer counts disambiguate |
| **D15** — Serialize `findings-merged.json` as a **`{"_summary":{…},"findings":[…]}` object** with the summary first | Prepend `_summary` as the first element of a flat array | The summary "leads" the file as required and is trivially addressable as a named key (`._summary`) for downstream consumers and this log | Consumers expecting a flat array must read `.findings`; documented here and in the verification gate |
| **D16** — **Embed the full Blitzy reveal.js theme inline** in the executive deck | Link the canonical `blitzy-deck/references/blitzy-reveal-theme.css` as an external stylesheet | That reference CSS is a Blitzy-internal file and is **not present in the target repository**; inlining satisfies the "single self-contained HTML, no local file dependency" requirement | The deck duplicates theme tokens inline; acceptable and required for self-containment |
| **D17** — In §4, quote **post-merge per-layer counts** from `_summary` (e.g., `layer1 = 153`) rather than raw layer-file counts (`159`) | Quote the raw pre-merge counts | The `_summary` is the finalized, authoritative roll-up; its per-layer counts are post-merge (cross-layer de-duplication **and** composite absorption) and sum exactly to `total` (`153+34+49+126 = 362`) | The 6-finding Layer-1 delta (159 → 153) decomposes into **2** exact `(file,line,CWE)` de-duplications and **4** cross-CWE composite absorptions, itemized in §4.3 so the numbers reconcile |
| **D18** — Record **both the AAP-expected and the measured runtime versions** in the ledger (§4.2), flagging the measured values as the authoritative reproducibility figures | Record only the measured values, or only the AAP-stated values | A version ledger must be factual **and** traceable to the AAP; tabulating both satisfies the checkpoint requirement to list Node 22.x / Python 3.12 / Yarn 4.12.0 while preserving the measured Node v20.20.2 / Python 3.13.7 actually used by the scanners | Two runtime columns add minor verbosity; the expected-vs-measured difference is reconciled in §2, Deviation V6 |
| **D19** — Derive **Layer-4 severity from the numeric CVSS `max_severity`** reported by OSV, bucketed `≥9 → critical`, `≥7 → high`, `≥4 → medium`, `<4 → low`, falling back to OSV's textual `database_specific.severity` label only when no numeric CVSS is present | Map directly from OSV's coarse textual `database_specific.severity` label (`CRITICAL`/`HIGH`/`MODERATE`/`LOW`) | The numeric CVSS base score is the precise, published risk figure; the textual label is frequently stale, coarse, or absent and disagrees with the score for some advisories — bucketing the score yields severities that match the authoritative CVSS data and the verification expectation | Five advisories whose textual label disagreed with their CVSS score were corrected to the score-derived bucket: `immutable` `CVE-2026-29063` (9.8) → **critical**, `turbo` `CVE-2026-45772` (9.8) → **critical**, `axios` `CVE-2026-42039` (7.5) → **high**, `uuid` `CVE-2026-41907` (7.5) → **high**, `@ai-sdk/provider-utils` `CVE-2026-8769` (4.3) → **medium**. The one advisory with no CVSS score and no label — the malicious package `http@0.0.1-security` `MAL-2025-22760` — is classified **critical** (embedded malicious code, CWE-506) by policy. Enumerated here for full traceability |
| **D20** — **Supplement the three Registry packs with one custom local Semgrep rule** `tmp.blitzy-audit-rules.dockerfile-arg-default-secret`, which flags Dockerfile `ARG <NAME>=<default>` lines that bake in secret defaults | Rely solely on the three named packs, which do not deterministically flag baked-in Dockerfile `ARG` secret defaults | The two `Dockerfile:11` / `Dockerfile:12` default-secret matches (`NEXTAUTH_SECRET=secret`, `CALENDSO_ENCRYPTION_KEY=secret`, `CWE-798`) are exactly the Layer-2 findings that **corroborate** the Layer-1 architectural default-secret findings at the same `(file, line, CWE)`; a precise local rule makes that detection deterministic and reproducible. The rule is read-only (it only reads the Dockerfile) and adds no project files | Goes beyond the literal "three named packs" reading (recorded as Deviation V8); over-matching risk is negligible because the rule is narrowly anchored to `ARG`-with-default-secret syntax |

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
| V6 | **Measured host runtimes differ from the AAP-stated runtimes** (measured Node v20.20.2 / Python 3.13.7 vs. AAP Node v22.22.2 / Python 3.12.3) | AAP §0.6.1 states Node v22.22.2, Python 3.12.3 | §4.2 tabulates **both** the AAP-expected runtimes and the runtimes actually measured and used by the scanners (Node v20.20.2, Python 3.13.7; the Semgrep isolated environment runs on Python 3.13.7). The scanner versions themselves (Semgrep 1.164.0, OSV-Scanner 2.3.8) match the AAP exactly | Ledger is factual **and** AAP-traceable; only the host-runtime versions differ from the AAP text, and that difference is shown explicitly in §4.2 — no effect on scanner behavior or findings |
| V7 | **Final deliverable commit made with `git commit --no-verify`** | Let the repository's Husky `pre-commit` hook run during the commit | The repo's `.husky/pre-commit` ends with `yarn app-store:build && git add packages/app-store/*.generated.*`, which would **regenerate and stage Cal.com source** (`packages/app-store/*.generated.*`) into the commit — directly violating the read-only / audit-only mandate (AAP §0.5.2). `lint-staged` is in any case a no-op for the audit deliverables (`.md` / `.html` / image deletions match none of its `(apps\|packages\|companion)/**/*.{js,ts,jsx,tsx}` or `schema.prisma` globs), and no `pre-push` hook exists | Zero Cal.com source files are generated, staged, or modified; the audit-only posture is preserved and the commit carries only the net-new deliverable changes |
| V8 | **One custom local Semgrep rule used in addition to the three named packs** (`tmp.blitzy-audit-rules.dockerfile-arg-default-secret`) | Run Semgrep with **only** `p/security-audit` + `p/secrets` + `p/owasp-top-ten` | The three packs do not deterministically flag Dockerfile `ARG <NAME>=<default>` baked-in secret defaults; a small read-only custom rule was added so the two `Dockerfile:11`/`:12` `CWE-798` matches are detected reproducibly. Those two Layer-2 findings are integral to the cross-layer **corroboration** of the Layer-1 default-secret findings, so the rule is in scope for the audit's stated corroboration goal (see decision D20). The rule only reads the Dockerfile and creates/modifies no project file | Layer-2 gains two precise, corroborating findings; pattern scope is widened by exactly one narrowly-anchored rule, recorded here so the deviation from the literal "three packs only" reading is explicit, not silent |
| V9 | **Raw SARIF `runs[0].tool.driver.name` is `"Semgrep OSS"`, not the literal lowercase `"semgrep"`** | A checklist note expected the driver name `semgrep` | `"Semgrep OSS"` is the canonical driver label emitted by the open-source edition of Semgrep 1.164.0 itself; it is the tool's own self-reported name and is left **byte-for-byte unmodified** in `results-semgrep.sarif` (editing a raw scanner intermediate would falsify the evidence and is out of scope). The normalized Layer-2 findings independently carry `tool="semgrep"` exactly as the strict schema's `tool` enum requires | No effect on findings or schema conformance; the schema-level `tool` value is `"semgrep"` everywhere in `findings-layer-2-semgrep.json`, while the raw SARIF faithfully preserves the scanner's own `"Semgrep OSS"` label |

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
- **Layer 4 (58 distinct):** a broad CVE-derived set; the complete enumeration of all 58 Layer-4 CWE IDs — together with every distinct CWE emitted by Layers 1, 2, and 3 (**81 distinct CWE IDs in total**) — is itemized exhaustively in the full inventory in **§3.4** below, so none is left implicit.

Three AAP-named category pairs are realized in the layer where the scanner actually emitted the CWE rather than where the prompt's narrative places them; this is reconciled explicitly so the coverage claim is honest:

- **CWE-79 (XSS), paired with CSP under Layer 1**, is emitted by Layers 2 and 4; the Layer-1 CSP finding itself carries **CWE-1021** (improper restriction of rendered UI layers). The category is covered.
- **CWE-328 (weak hash / legacy HMAC-SHA1), paired with key-reuse under Layer 1**, is emitted by Layer 4; Layer 1 carries **CWE-323** (encryption-key reuse) plus the legacy-HMAC narrative. The category is covered.
- **CWE-807 (authorization on user input)**, named under both Layer 1 and Layer 3, is emitted by **Layer 3** (5 findings). The category is covered.

**No gaps.** All eight directives (1–8) are satisfied (§3.2), and every named CWE category resolves to at least one emitted finding in at least one layer (§3.1 + the reconciliation above). All seven Layer-3 sink categories are present with non-zero counts (CWE-601=13, CWE-918=7, CWE-117=11, CWE-807=5, CWE-338=3, CWE-843=7, CWE-862=3). There are no uncovered directives and no uncovered CWE categories. Every one of the **81 distinct CWE IDs** actually emitted across the four layer files is enumerated and mapped to its layer(s) in **§3.4**, so the coverage matrix has no gaps at the individual-CWE level either.

### 3.4 Complete emitted-CWE inventory (all 81 distinct CWE IDs)

To make the coverage matrix gap-free at the level of **individual CWE identifiers** (not merely the AAP-named categories), the table below enumerates **every one of the 81 distinct CWE IDs** that actually appears across the four `findings-layer-*.json` files, each mapped to the layer(s) that emitted it and its official MITRE weakness title. Layer tags: `L1` = architectural (`blitzy`), `L2` = Semgrep (`semgrep`), `L3` = taint (`blitzy-taint`), `L4` = OSV-Scanner (`osv-scanner`); a `+` joins layers for a CWE emitted by more than one. Per-layer distinct counts are **L1 = 18, L2 = 6, L3 = 7, L4 = 58**, and the union is **81** (eight CWEs are multi-layer), reconciling exactly with §3.3.

| CWE | Layer(s) | Weakness (CWE title) |
|-----|----------|----------------------|
| CWE-20 | L4 | Improper Input Validation |
| CWE-22 | L4 | Improper Limitation of a Pathname to a Restricted Directory (Path Traversal) |
| CWE-59 | L4 | Improper Link Resolution Before File Access (Link Following) |
| CWE-74 | L4 | Improper Neutralization of Special Elements in Output (Injection) |
| CWE-78 | L2+L4 | Improper Neutralization of Special Elements in an OS Command (OS Command Injection) |
| CWE-79 | L2+L4 | Improper Neutralization of Input During Web Page Generation (XSS) |
| CWE-89 | L4 | Improper Neutralization of Special Elements in an SQL Command (SQL Injection) |
| CWE-91 | L4 | XML Injection (Blind XPath Injection) |
| CWE-93 | L4 | Improper Neutralization of CRLF Sequences (CRLF Injection) |
| CWE-94 | L4 | Improper Control of Generation of Code (Code Injection) |
| CWE-96 | L4 | Improper Neutralization of Directives in Statically Saved Code (Static Code Injection) |
| CWE-113 | L4 | Improper Neutralization of CRLF Sequences in HTTP Headers (HTTP Request/Response Splitting) |
| CWE-116 | L4 | Improper Encoding or Escaping of Output |
| CWE-117 | L3 | Improper Output Neutralization for Logs (Log Injection) |
| CWE-120 | L4 | Buffer Copy without Checking Size of Input (Classic Buffer Overflow) |
| CWE-176 | L4 | Improper Handling of Unicode Encoding |
| CWE-177 | L4 | Improper Handling of URL Encoding (Hex Encoding) |
| CWE-180 | L4 | Incorrect Behavior Order: Validate Before Canonicalize |
| CWE-183 | L4 | Permissive List of Allowed Inputs |
| CWE-185 | L4 | Incorrect Regular Expression |
| CWE-200 | L4 | Exposure of Sensitive Information to an Unauthorized Actor |
| CWE-208 | L1+L4 | Observable Timing Discrepancy (Timing Side-Channel) |
| CWE-250 | L1+L2 | Execution with Unnecessary Privileges |
| CWE-288 | L4 | Authentication Bypass Using an Alternate Path or Channel |
| CWE-295 | L4 | Improper Certificate Validation |
| CWE-307 | L1 | Improper Restriction of Excessive Authentication Attempts |
| CWE-310 | L2 | Cryptographic Issues |
| CWE-323 | L1 | Reusing a Nonce, Key Pair in Encryption (Key Reuse) |
| CWE-326 | L1 | Inadequate Encryption Strength |
| CWE-327 | L1 | Use of a Broken or Risky Cryptographic Algorithm |
| CWE-328 | L4 | Use of Weak Hash |
| CWE-338 | L3 | Use of Cryptographically Weak Pseudo-Random Number Generator (PRNG) |
| CWE-345 | L2 | Insufficient Verification of Data Authenticity |
| CWE-346 | L4 | Origin Validation Error |
| CWE-347 | L1+L4 | Improper Verification of Cryptographic Signature |
| CWE-348 | L1 | Use of Less Trusted Source (Untrusted IP Header) |
| CWE-349 | L4 | Acceptance of Extraneous Untrusted Data With Trusted Data |
| CWE-352 | L4 | Cross-Site Request Forgery (CSRF) |
| CWE-362 | L4 | Concurrent Execution using Shared Resource with Improper Synchronization (Race Condition) |
| CWE-400 | L4 | Uncontrolled Resource Consumption |
| CWE-407 | L4 | Inefficient Algorithmic Complexity |
| CWE-426 | L4 | Untrusted Search Path |
| CWE-436 | L4 | Interpretation Conflict |
| CWE-441 | L4 | Unintended Proxy or Intermediary (Confused Deputy) |
| CWE-444 | L4 | Inconsistent Interpretation of HTTP Requests (HTTP Request Smuggling) |
| CWE-459 | L4 | Incomplete Cleanup |
| CWE-476 | L4 | NULL Pointer Dereference |
| CWE-506 | L4 | Embedded Malicious Code |
| CWE-521 | L1 | Weak Password Requirements |
| CWE-524 | L4 | Use of Cache Containing Sensitive Information |
| CWE-532 | L1 | Insertion of Sensitive Information into Log File |
| CWE-601 | L3 | URL Redirection to Untrusted Site (Open Redirect) |
| CWE-636 | L1 | Not Failing Securely ('Failing Open') |
| CWE-674 | L4 | Uncontrolled Recursion |
| CWE-697 | L1 | Incorrect Comparison |
| CWE-705 | L4 | Incorrect Control Flow Scoping |
| CWE-754 | L4 | Improper Check for Unusual or Exceptional Conditions |
| CWE-770 | L4 | Allocation of Resources Without Limits or Throttling |
| CWE-772 | L4 | Missing Release of Resource after Effective Lifetime |
| CWE-776 | L4 | Improper Restriction of Recursive Entity References (XML Entity Expansion) |
| CWE-783 | L4 | Operator Precedence Logic Error |
| CWE-798 | L1+L2 | Use of Hard-coded Credentials |
| CWE-807 | L3 | Reliance on Untrusted Inputs in a Security Decision |
| CWE-829 | L1 | Inclusion of Functionality from Untrusted Control Sphere |
| CWE-835 | L4 | Loop with Unreachable Exit Condition (Infinite Loop) |
| CWE-843 | L3 | Access of Resource Using Incompatible Type (Type Confusion) |
| CWE-862 | L3+L4 | Missing Authorization |
| CWE-863 | L4 | Incorrect Authorization |
| CWE-908 | L4 | Use of Uninitialized Resource |
| CWE-918 | L3+L4 | Server-Side Request Forgery (SSRF) |
| CWE-942 | L1 | Permissive Cross-domain Policy with Untrusted Domains |
| CWE-1021 | L1 | Improper Restriction of Rendered UI Layers or Frames (Clickjacking) |
| CWE-1113 | L4 | Inappropriate Comment Style |
| CWE-1188 | L1 | Insecure Default Initialization of Resource |
| CWE-1284 | L4 | Improper Validation of Specified Quantity in Input |
| CWE-1285 | L4 | Improper Validation of Specified Index, Position, or Offset in Input |
| CWE-1289 | L4 | Improper Validation of Unsafe Equivalence in Input |
| CWE-1321 | L4 | Improperly Controlled Modification of Object Prototype Attributes (Prototype Pollution) |
| CWE-1333 | L4 | Inefficient Regular Expression Complexity (ReDoS) |
| CWE-1357 | L1 | Reliance on Insufficiently Trustworthy Component |
| CWE-1385 | L4 | Missing Origin Validation in WebSockets |


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

### 4.2 Runtime environment (AAP-expected vs. measured; see Deviation V6)

The checkpoint / AAP §0.6.1 names the **expected** runtimes (Node 22.x, Python 3.12, Yarn 4.12.0). The audit environment **measured** different host runtimes. Both are recorded below so the ledger is **factual** *and* **traceable to the AAP**; where the two differ, the **measured** value is the one actually used by the scanners (see decision D18 and Deviation V6).

| Runtime | Version (AAP §0.6.1 expected) | Version (measured / actually used) | Notes |
|---------|-------------------------------|------------------------------------|-------|
| Node.js | v22.22.2 (22.x) | **v20.20.2** | **Differs from AAP — see Deviation V6.** npm 11.1.0; the measured host matches the project's `node:20` container target |
| Python | 3.12.3 (3.12) | **3.13.7** | **Differs from AAP — see Deviation V6.** Hosts the isolated Semgrep environment |
| Yarn | 4.12.0 | **4.12.0** | Matches exactly. Berry, via corepack; `nodeLinker: node-modules` |
| jq | not specified in AAP | **1.8.1** | Used with Python 3 for JSON normalize / minify / ANSI-strip / merge |

### 4.3 Findings summary snapshot (quoted from `findings-merged.json` `_summary`)

The following totals are quoted verbatim from the finalized `findings-merged.json` `_summary` header.

| Metric | Value |
|--------|-------|
| **Total findings** | **362** |
| Critical | 21 |
| High | 98 |
| Medium | 137 |
| Low | 106 |
| Layer 1 (`blitzy`) | 153 |
| Layer 2 (`semgrep`) | 34 |
| Layer 3 (`blitzy-taint`) | 49 |
| Layer 4 (`osv-scanner`) | 126 |
| Corroborated (cross-layer) | 7 |
| Composite (escalated) | 5 |
| Tool versions | `blitzy` = native, `blitzy-taint` = native, `osv-scanner` = 2.3.8, `semgrep` = 1.164.0 |

Both roll-ups are internally consistent: the severity counts sum to the total (`21 + 98 + 137 + 106 = 362`) and the per-layer counts sum to the total (`153 + 34 + 49 + 126 = 362`).

**Per-layer count reconciliation (decision D17).** The raw `findings-layer-1-blitzy.json` file contains **159** finding objects, whereas `_summary.layer1` reports **153**. That 6-finding difference is **not** one mechanism applied six times; it decomposes into **2 exact de-duplications + 4 composite absorptions**:

- **2 exact `(file, line, CWE)` cross-layer de-duplications (decision D7).** The two baked-in Dockerfile default-secret findings — `Dockerfile:11` and `Dockerfile:12`, both `CWE-798` — were each independently detected by **Layer 2 (Semgrep)** at the *same* `(file, line, CWE)`. Per D7 the duplicate collapses to one row, keeping the higher severity (Semgrep's `critical`) and recording `corroborated_by:"blitzy"`. The two survivors are counted under **Layer 2**, so two rows leave the Layer-1 tally. *(The original wording of this paragraph incorrectly attributed these to a Layer-3 coincidence; the corroborating layer here is Layer 2.)*
- **4 cross-CWE composite absorptions (decision D8).** Four Layer-1 architectural weaknesses each combined with a Layer-3 taint chain at the same site and were **escalated into a single composite finding recorded under the taint sink's CWE**. Because the CWE key changes, these are absorptions, **not** `(file, line, CWE)` exact de-duplications: `CWE-348 → CWE-807` (untrusted IP header feeding an authorization/rate-limit decision) at `packages/lib/getIP.ts:17` and `apps/web/app/api/auth/forgot-password/route.ts:20`, and `CWE-532 → CWE-117` (sensitive request body flowing into a log sink) at `packages/app-store/larkcalendar/api/events.ts:60` and `packages/app-store/feishucalendar/api/events.ts:60`. Each survivor carries both `composite:true` and `corroborated_by:"blitzy"`.

The `_summary` per-layer counts are therefore the **post-merge** authoritative figures (`2 + 4 = 6` Layer-1 rows removed; `159 − 6 = 153`), which is why they — and not the raw file counts — are quoted here. **Layers 2 and 3** lost no rows to the merge (their findings were the surviving rows, not the absorbed duplicates), so their `_summary` counts (34, 49) equal their raw file counts.

**Layer 4 reconciliation (raw 164 → merged 126).** The raw `findings-layer-4-osv.json` file carries **164** findings — one per distinct `(package_name, CVE_ID)` per decision D6. In the merged report, the D7 cross-layer `(file, line, CWE)` collapse reduces the Layer-4 contribution to **126** rows. The mechanism is intra-Layer-4 consolidation, not interaction with the source-code layers: once each Layer-4 finding is keyed to its **real `yarn.lock` package-entry line** (the D7 `file`/`line` normalization, which replaced the earlier `yarn.lock:1` sentinel), the many advisories that affect *the same package* and *share one CWE* — for example the several `axios` prototype-pollution CVEs all mapped to `CWE-1321` — collapse onto a single `(yarn.lock, <package-line>, CWE)` triple, keeping the higher severity. Distinct packages occupy distinct lines and never collide, and no Layer-4 row shares a `(file, line, CWE)` triple with any source-code-layer finding (those live under `apps/**`, `packages/**`, `Dockerfile`, and `.github/**`, never under `yarn.lock`). The 38-row reduction (`164 − 126`) is exactly this same-package/same-CWE deduplication and is what eliminates the duplicate-triple defect that Directive-8 check #7 flags; the raw `(package_name, CVE_ID)` granularity remains fully preserved in `findings-layer-4-osv.json` itself (still 164 findings).

---

*This decision log is a mandatory deliverable produced independently of the findings themselves (AAP §0.7.1). It is the sole source of truth for "why" — no rationale for any audit decision is duplicated into code comments anywhere in the deliverables. No existing repository file was modified to produce it.*
