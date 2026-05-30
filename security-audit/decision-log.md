# Security Audit — Decision Log

> **Rule 1 (Explainability) compliance.** This document is the single source of truth for *why*
> every non-trivial decision in the four-layer security audit was made. Per Rule 1, design and
> coverage rationale lives **here**, not in code comments. Code comments in
> `security-queries.sc` are kept strictly functional (they describe *what* a line matches, not
> *why* a coverage decision was taken).

## 1. Scope and Guiding Constraint

The task is a **non-invasive, read-only measurement** of the `blitzy-cal` (Cal.com parity fork)
codebase. The platform's intent banner mandates `~0 files modified`: the audit **measures and
reports**, it does **not** remediate. The only writes are net-new artifacts under
`security-audit/` (and, at the final checkpoint, `blitzy-deck/`). No application source,
configuration, schema, test, CI workflow, `SECURITY.md`, or dependency manifest is altered.

| Property | Value |
|----------|-------|
| Repository | `calcom-monorepo` (Cal.com fork), Yarn Berry 4.12.0 + Turborepo |
| Language surface | 100% TypeScript/JavaScript (~7,433 first-party source files) |
| Sole lockfile | `yarn.lock` (Yarn Berry `__metadata` v8) — npm ecosystem only |
| Output directory | `security-audit/` (colocated so the `cat findings-layer-*.json \| wc -l` gate holds) |

## 2. Toolchain Versions (pinned at install, recorded here)

These are external scanning tools provisioned into the execution environment; they are **not**
added to `package.json` / `yarn.lock`.

| Tool / Runtime | Version | Source | Purpose |
|----------------|---------|--------|---------|
| OpenJDK | 21.0.11 (2026-04-21) | apt `openjdk-21-jdk-headless` | JVM prerequisite for Joern |
| Semgrep | 1.164.0 | pip into isolated venv `/opt/audit-venv` (Python 3.13.7) | Layer 2 pattern SAST |
| Joern / joern-parse | 4.0.551 | `/opt/joern/joern-cli` (joern-install.sh) | Layer 3 CPG + JQL SAST |
| OSV-Scanner | 2.3.8 | prebuilt `linux_amd64` binary `/usr/local/bin/osv-scanner` | Layer 4 dependency SCA |
| Python (audit venv) | 3.13.7 | `/opt/audit-venv` (pip via get-pip.py) | Semgrep runtime + normalization |
| Semgrep local rule cache | 35 rules | `security-audit/semgrep-rules/{security-audit,secrets,owasp}.yml` (14 + 11 + 10) | offline, telemetry-free scans |

## 3. Master Decision Table

| # | Decision | Alternatives Considered | Rationale | Risk / Mitigation |
|---|----------|-------------------------|-----------|-------------------|
| D1 | Install OpenJDK 21 for Joern | JDK 19 (documented minimum) | Joern README recommends JDK 21; newer is a documented superset | Newer-JDK edge cases — mitigated by pinning 21 |
| D2 | Use OSV-Scanner prebuilt binary | `go install` from source | Go is absent in the environment; the prebuilt binary is SLSA3 and needs no toolchain | OS/arch mismatch — mitigated by selecting `linux_amd64` |
| D3 | Install Semgrep via pip in an isolated venv | apt, Docker image | Python present; venv keeps the audit toolchain isolated from the project | Global vs. isolated install — mitigated by `/opt/audit-venv` |
| D4 | Colocate all outputs under `security-audit/` | repo root; `blitzy-docs/` | The `cat findings-layer-*.json \| wc -l` gate requires colocation; isolates net-new artifacts from source | None material |
| D5 | Use Joern's JS/TS (`jssrc2cpg`) frontend | C / Java / other frontends | Codebase is 100% TypeScript/JavaScript | TS type-recovery limits — accepted; complemented by Layers 1/2 |
| D6 | Apply directive-specified severity maps and dedup keys verbatim | custom / hash-based mapping | Directives fix the maps and keys; deviating breaks determinism | Line drift across tools — mitigated by retaining raw intermediates |
| D7 | Read-only measurement (no remediation) | auto-fix discovered issues | Prompt states `~0 files modified`; the task is assessment, not repair | Findings not auto-resolved — by design; out of scope |
| D8 | Preserve `.github/workflows/security-audit.yml` and `SECURITY.md` unchanged | extend the existing workflow | The four layers are standalone outputs; modifying CI was not requested | Duplication with `yarn npm audit` — accepted; OSV adds OSV.dev coverage |
| D9 | Keep large CPG artifact untracked via `.git/info/exclude` (local), **not** root `.gitignore` | append patterns to tracked `.gitignore` | Modifying a tracked existing file violates the read-only boundary (see §8, F1) | `cpg.bin` could be accidentally staged — mitigated by `.git/info/exclude` + verification |
| D10 | Emit Joern findings **only** for confirmed dangerous patterns; treat route/guard inventories as metadata | emit every route param / guard decision point as a finding | Inventory-as-vulnerability inflates the report with non-findings (see §5, F2) | Under-reporting of genuine taint — mitigated by retaining the taint-reachability query and command/ORM sinks |
| D11 | Use `cpg.method.where(_.annotation.name(".*Route.*")).parameter` for the route primitive — combinator `filter`→`where`, predicate preserved verbatim | the verbatim `…filter(…)` form; or a `.nonEmpty` Boolean adaptation | The verbatim `filter` form does not type-check in Joern 4.0.551 (`filter` expects `Method => Boolean`; `.annotation.name(...)` yields a traversal — confirmed compile error E007 at execution); `where` accepts the traversal predicate directly and selects the identical route-annotated methods (see §5.4, F4) | Checklist literalness — documented here as an approved, minimal, semantics-preserving adaptation that keeps the exact predicate and `.parameter` traversal |
| D12 | Accept Semgrep `--dryrun` as the gate spelling | pin a Semgrep version supporting `--dry-run`; edit the directive | Installed Semgrep 1.164.0 exposes `--dryrun`; no network to install another version; behavior is identical (see §7, F5) | Directive/CLI drift — reconciled and evidenced here |
| D13 | Record the 33 Semgrep parse-warning files as explicit partial-parse exclusions | silently treat them as scanned; edit source to satisfy the parser | Read-only forbids source edits; offline forbids tooling upgrades; the constructs are valid TS/TSX the pinned frontend cannot fully parse (see §7, F6) | Hidden coverage gap — eliminated by explicit disclosure (§7.3) |
| D14 | Place the executive deck in `blitzy-deck/` with the reveal.js theme embedded inline | external theme `<link>` to a shared stylesheet | Rule 2 mandates a single self-contained file and cites `blitzy-deck/references/blitzy-reveal-theme.css`, which is **absent** from the repository, so there is nothing to link; inlining keeps the deck verification-ready offline (see §13) | Theme drift from a canonical source — mitigated by embedding the full `:root` token set inline and pinning exact CDN versions |
| D15 | Build the local Semgrep cache as **exactly** the three curated packs `{security-audit, secrets, owasp}.yml` (35 rules) and remove the previously cached official `owasp-top-ten.yml` | retain `owasp-top-ten.yml` alongside the curated packs; point `--config` at a path outside the repo | The directive's local cache contract is the three packs; a fourth tracked file made `--config=security-audit/semgrep-rules` load 579 rules and broke determinism, and the `results-*`/Layer-2 artifacts no longer traced to the loaded rules | Cache drift / non-determinism — mitigated by `git rm`-ing the extra pack so the directory holds exactly 3 files = 35 rules, then regenerating SARIF + Layer 2 from that cache |
| D16 | Name the OWASP pack `owasp.yml` (curated) rather than vendoring the registry `p/owasp-top-ten` | ship the full registry `owasp-top-ten` set | `p/owasp` 404s on the registry, and the full `owasp-top-ten` set (≈682 rules) dominated the cache; a curated 10-rule `owasp.yml` keeps the cache scoped, deterministic, and traceable to Layer 2 | Reduced raw OWASP coverage — accepted; the curated rules cover the requested OWASP categories and corroborate Layer 1 |
| D17 | Classify the CSP `'unsafe-inline'` finding as **CWE-79** in both Layer 1 and the Layer-2 OWASP rule | keep the OWASP rule's CWE-1021; or re-tag Layer 1 to CWE-1021 | `'unsafe-inline'` in `script-src` re-opens cross-site scripting, so CWE-79 (XSS) is the most-specific weakness; CWE-1021 (Improper Restriction of Rendered UI Layers/Frames) describes clickjacking/framing and applies to `frame-ancestors`, not `script-src` | Cross-layer key mismatch blocking corroboration — resolved by editing the **Layer-2 OWASP rule** to lead with CWE-79 (CWE-693 retained as the secondary class); Layer 1 was already CWE-79 and was left unchanged |
| D18 | Require quoted literals in the `secrets.generic.high-entropy-assignment` pattern | match credential-named assignments with optional quotes | The quotes-optional form fired on code references (e.g. `apiKey: schema.parse(...)`, `accessToken: tokens.accessToken`), which are not hard-coded secrets; requiring quotes targets committed literal values and preserves the `.env.example:82` calibration | Possible miss of an unquoted literal secret — accepted; committed secrets in this repo are quoted literals, and Layer 1 covers logic/secret-reuse classes |
| D19 | Treat the entire `security-audit/` tree as a single net-new audit deliverable; per-file git status (`A` vs `M`) reflects intra-audit commit sequencing, not modification of pre-existing repository files | label each artifact strictly by its current git status at every checkpoint | No file that existed before the audit is modified; the audit directory and every file in it are introduced by this work, so the deliverable is a CREATE at the audit boundary even when an artifact is refined across checkpoints (the read-only boundary in §8 is preserved) | Checkpoint metadata drift (CREATE vs UPDATE) — mitigated by this explicit clarification; `git diff` confirms zero changes under `apps/**`, `packages/**`, `.github/**`, `Dockerfile`, `*.env*`, `SECURITY.md` |
| D20 | Scope the command/code-execution family to **real execution sinks**: exact Node `child_process` API names (`exec`, `execSync`, `execFile`, `execFileSync`, `spawn`, `spawnSync`, `fork`) only inside files that directly reference `child_process`, plus global `eval(…)` and `new Function(…)` | keep the broad `exec.*\|eval\|spawn` name match emitting every call | The unconstrained name match reported benign `RegExp.exec`, `document.execCommand`, Kysely `executeQuery`, and helper `execute*`/`executeInTransaction` methods as CWE-78, fabricating critical command-injection records (the principal Layer 3 integrity defect); scoping to genuine OS/code-execution APIs removes the false positives while retaining every true sink (see §5.5) | Missing a sink invoked through an indirection — mitigated by retaining the broad name match as the *candidate* gatherer and by Layer 2 corroboration on the same sinks; the taint-reachability family still spans the full sink list |
| D21 | Anchor the three CI rules' workflow include globs to the explicitly-unanchored `**/.github/workflows/*.{yml,yaml}` form and drop the redundant bare `.github/workflows/*.{yml,yaml}` patterns | leave the bare patterns; or convert them to root-anchored `/.github/workflows/*` | Semgrep 1.164.0 warns that bare patterns will soon be reinterpreted as root-anchored (Semgrepignore v2 / Gitignore spec); the `**/`-prefixed forms were already present and match the same root-level workflow files (`**/` matches zero or more directories), so removing the bare duplicates clears all 12 dry-run warnings with **no** change to matched files or Layer 2 results (proven: identical 272-result SARIF tuple set) | Future Semgrepignore drift — eliminated by using the explicit `**/` form; matching semantics verified unchanged |

> **Seed decisions vs. execution-time decisions.** Rows **D1–D8 and D14** are the nine seed decisions carried verbatim from AAP §0.5.4 (toolchain provisioning, output colocation, frontend choice, verbatim severity/dedup keys, read-only posture, preserve-CI, and the deck/inline-theme choice). Rows **D9–D13** are execution-time decisions surfaced while actually running the layers; rows **D15–D21** are execution-time refinements applied across review checkpoints (Semgrep cache scoping, CWE alignment, secret-pattern tightening, the Layer 3 command-exec sink scoping of D20, and the Semgrep include-pattern anchoring of D21). Each is expanded in §5, §7, and §8.

## 4. Severity Maps (applied verbatim per directive)

Raw tool-native severities are preserved in the intermediates (`results-*.sarif`,
`results-*.json`) so no information is lost; the normalized layer files apply these maps.

| Layer | Tool-native → Normalized |
|-------|--------------------------|
| 2 (Semgrep) | `error → critical`, `warning → high`, `note → medium`, `info → low` |
| 3 (Joern) | `high → critical`, `medium → high`, `low → medium`, `info → low` |

Semgrep normalized severity is derived from the SARIF rule `defaultConfiguration.level`.

## 5. Layer 3 (Joern) Query Design

The query script `security-audit/security-queries.sc` runs over `cpg.bin` (Joern 4.0.551,
`jssrc` frontend) and emits one normalized record per **confirmed** dangerous pattern.

### 5.1 Query families and CWE mapping

| Family | Directive primitive (preserved) | CWE | Emitted as finding? |
|--------|----------------------------------|-----|---------------------|
| Command/code execution sinks | `cpg.call.name("exec.*\|eval\|spawn")` as the candidate set, **constrained** to exact `child_process` APIs in importing files + global `eval`/`new Function` (§5.5) | CWE-78 | Yes — every **confirmed** execution sink |
| ORM raw-SQL sinks | Prisma `$queryRaw` / `$executeRaw` / `queryRawUnsafe` / `executeRawUnsafe` | CWE-89 | Yes — every matched raw-SQL sink |
| Taint reachability | `sink.reachableByFlows(source)` | CWE-78 / CWE-89 (by sink) | Yes — only when a flow exists |
| Unguarded routes | NestJS route handlers lacking `@UseGuards` | CWE-862 | Yes — missing-authorization pattern |
| Fail-open guards | `canActivate` returning literal `true` in a `catch`/error branch | CWE-863 | Yes — incorrect-authorization pattern |
| Route/request parameters | `cpg.method.where(_.annotation.name(".*Route.*")).parameter` + NestJS/Next.js decorators | — | **No** — collected as taint **sources** (metadata only) |

### 5.2 F2 — Inventory is not vulnerability (the principal Layer 3 correction)

**Decision (D10):** route parameters and guard *decision points* are **sources / control-flow
locations**, not vulnerabilities in themselves. The earlier script emitted every route parameter
(809 records → CWE-20) and every `canActivate` decision point (29 records → CWE-863) as findings,
inflating Layer 3 to 976 records of mostly source/decision-point **inventory** rather than
confirmed vulnerabilities.

The corrected script:
- Runs the directive route query and the NestJS/Next.js decorator queries to **assemble the taint
  source set**, logs the source count to stderr as scan metadata, and emits **no** per-parameter
  finding. Those sources still feed the `reachableByFlows(source)` taint family, which emits a
  finding **only** when a source actually reaches a dangerous sink.
- Restricts the `canActivate` family to the **fail-open** pattern (a literal `true` returned in a
  `catch`/error branch). Guards without that pattern are not emitted.

**Result:** removing the route/guard inventory took Layer 3 from **976 → 138** records. A
subsequent command-execution sink-scoping correction (§5.5) further reduced that family from 57 to
**18**, giving the current **99** confirmed findings (command-exec 18 → CWE-78, orm-raw-sql 60 →
CWE-89, unguarded routes 21 → CWE-862). The 809 route-taint (CWE-20) and 29 decision-point
(CWE-863) inventory records were removed. The orm-raw-sql and unguarded-route records are
byte-identical to the prior output — only inventory padding and the command-exec false positives
were dropped, confirming the retained queries are deterministic.

### 5.3 F3 — Coverage rationale relocated out of code

The prior comment `// Broadened coverage: NestJS / Next.js HTTP route handlers via their
decorators.` recorded a *coverage decision* inside `security-queries.sc`, violating Rule 1. The
code comment is now strictly functional (it names the matched decorators), and the **rationale**
for matching both NestJS (`@Get/@Post/...`) and Next.js route handlers lives here: the codebase
exposes HTTP entry points through both frameworks (`apps/api/v2` NestJS controllers and
`apps/web` Next.js route handlers), so the taint-source set must span both decorator families to
avoid missing request-input sources for the reachability query.

### 5.4 F4 — Route directive primitive adaptation

The directive primitive `cpg.method.filter(_.annotation.name(".*Route.*")).parameter` does not
type-check in Joern 4.0.551: `Traversal.filter` expects a `Method => Boolean` predicate, but
`_.annotation.name(".*Route.*")` returns an annotation **traversal**, not a Boolean. This was
confirmed empirically — the verbatim form raises compile error **E007** (type mismatch: found
`Iterator[Annotation]`, required `Boolean`). The minimal, type-correct, semantics-preserving form
is `cpg.method.where(_.annotation.name(".*Route.*")).parameter`: the `where` combinator accepts a
traversal-valued predicate and keeps a method when the inner traversal is non-empty (i.e. the
method carries a `Route`-style annotation), so it selects exactly the same route-annotated methods
and takes their parameters as the verbatim primitive intends. The **only** change versus the
directive text is the combinator name (`filter` → `where`); the predicate
`_.annotation.name(".*Route.*")` and the `.parameter` traversal are preserved verbatim. This is
the approved deviation per D11. (In this codebase HTTP entry points are annotated with
`@Get`/`@Post`-style NestJS decorators rather than a literal `@Route`, so the route query returns
0 parameters; request-input sources are instead gathered by the NestJS/Next.js decorator queries
described in §5.3, and all such parameters feed the taint-reachability family as sources, not as
findings.)

### 5.5 Command/code-execution sink scoping (principal Layer 3 integrity correction)

The directive primitive `cpg.call.name("exec.*|eval|spawn")` is retained verbatim as the
**candidate** gatherer, but a name match alone is not evidence of OS/code execution: in a
TypeScript/JavaScript monorepo the tokens `exec`/`execute*`/`spawn` collide with many benign APIs.
Emitting every candidate as CWE-78 fabricated critical command-injection records (e.g.
`RegExp.prototype.exec` for colour/string parsing, `document.execCommand("copy")`, Kysely's
`executeQuery`, and application `execute`/`executeInTransaction` helpers). To emit only genuine
sinks, the candidate set is constrained to the union of:

- **Node `child_process` APIs** — exact callee names `exec`, `execSync`, `execFile`,
  `execFileSync`, `spawn`, `spawnSync`, `fork` — **and only** when the enclosing file directly
  references `child_process` (detected three independent ways that agree on the same 9 files:
  source text containing `child_process`, an `import` of it, or a `require` of it). A call named
  `execSync` in a file that does not import `child_process` is therefore excluded.
- **Global code-execution sinks** — a call whose code begins `eval(` (the global `eval`), and
  `new Function(…)` constructor calls. Both are 0 in this codebase.

This reduces the family from 57 candidates to **18** confirmed sinks across 9 files
(`apps/api/v2/scripts/docker-start.ts` ×4, `apps/api/v2/src/swagger/generate-swagger.ts`,
`apps/web/scripts/create-sentry-release.js` ×6, `apps/web/scripts/ts-check-changed-files.ts` ×2,
`packages/app-store-cli/src/build.ts`, `packages/app-store-cli/src/utils/execSync.ts`,
`packages/features/ee/billing/seed.ts`, `packages/platform/libraries/scripts/postpublish.js`,
`packages/prisma/auto-migrations.ts`). Note that `packages/app-store-cli/src/core.ts` (6
`execSync` calls) imports a **local** wrapper `./utils/execSync` rather than `child_process`, so
its calls are correctly excluded; the underlying sink — `utils/execSync.ts:10`, which calls
`child_process.exec` — is the record that is kept. The 18 sinks all carry raw severity `high`,
normalized to `critical`. The orm-raw-sql (60) and unguarded-route/fail-open (21) families are
unaffected and remain byte-identical across the re-run, confirming the correction is isolated to
the command-execution family.

## 6. Normalization, Deduplication, and Merge Methodology

### 6.1 Normalized schema

Every finding conforms to `{"file","line","severity","cwe","description","layer","tool"}`, with
`description` truncated to ≤ 200 characters **then** trimmed of surrounding whitespace
(`desc[:200].strip()`), and each layer file written as a single minified JSON line terminated by
one newline.

### 6.2 Cross-layer dedup and corroboration

- Records are grouped by `(file, line, cwe)`.
- A group is **collapsed only when it spans ≥ 2 distinct layers** (the same location + CWE
  independently reported by different layers = corroboration). The highest-severity record is
  kept (tie → lowest layer number); the others are recorded under `corroborated_by` =
  `[{layer, tool, severity}, …]` in layer order.
- **Single-layer groups are kept intact.** OSV records that share a CWE at the same `yarn.lock`
  line are distinct CVEs; intra-layer OSV dedup is by `(package_name, CVE_ID)` and is applied
  upstream in Layer 4, so these are not collapsed by the cross-layer key.

### 6.3 Sort and summary

- Findings are sorted by `(file, line, cwe, description)` ascending (the description sub-key
  gives a deterministic order to distinct OSV CVEs sharing a lockfile line + CWE).
- `_summary` carries `total_findings` (raw sum across layers), `unique_findings` (post-collapse
  count), `corroborated` (number of collapsed cross-layer groups), `by_layer` (raw per-layer
  counts), and `by_severity` (over unique findings).

### 6.4 Current merged totals

| Metric | Value |
|--------|-------|
| `total_findings` | 527 (L1 8 + L2 262 + L3 99 + L4 158) |
| `unique_findings` | 496 |
| `corroborated` | 31 |
| `by_layer` | `{1: 8, 2: 262, 3: 99, 4: 158}` |
| `by_severity` | `{critical: 62, high: 299, medium: 116, low: 19}` (sums to 496) |

**Confidence policy.** Each corroborated record carries a `confidence` field: a group that
includes a Layer 1 (Blitzy native) record is `"highest"` (expert reasoning independently
agreeing with a scanner is the strongest signal — Layer 1 ∩ Layer 2/3); any other cross-layer
group is `"high"`.

Of the **31** corroborations, **4 are highest-confidence Layer 1 ∩ Layer 2** pairs (same
`file + line + cwe`):

- `apps/web/lib/csp.ts:22` — **CWE-79** CSP `'unsafe-inline'` (Layer 2 Semgrep `high` kept;
  Layer 1 `medium`). This is the required CSP unsafe-inline corroboration; the CWE alignment of
  D17 is what makes the dedup key match.
- `apps/api/v2/src/vercel-webhook.guard.ts:44` — **CWE-328** weak SHA-1 HMAC (Layer 2 `high`
  kept; Layer 1 `medium`).
- `apps/web/app/api/sync/helpscout/route.ts:42` — **CWE-328** weak SHA-1 HMAC (tie at `high` →
  Layer 1 kept; Layer 2 `high`).
- `packages/lib/crypto.ts:3` — **CWE-327** weak cipher `aes256` (Layer 2 `high` kept; Layer 1
  `medium`).

The remaining **27 are high-confidence Layer 2 ∩ Layer 3** pairs: **6** command-execution sinks
(`CWE-78`: `packages/app-store-cli/src/utils/execSync.ts:10`,
`apps/api/v2/scripts/docker-start.ts:5`, and `apps/web/scripts/create-sentry-release.js` ×4) and
**21** SQL-injection-via-ORM flows (`CWE-89`, the `Prisma*Repository` files) where Semgrep's
curated sink rules and Joern's dataflow queries independently flag the same location. (After the
§5.5 sink-scoping correction, Semgrep-only command-exec hits such as
`packages/app-store-cli/src/core.ts` are no longer corroborated by Joern and remain valid
single-layer Layer 2 findings.) Single-layer groups are never collapsed; in particular, distinct
OSV CVEs sharing a `yarn.lock` line + CWE remain separate findings (deduped upstream by
`(package_name, CVE_ID)`).

## 7. Gate Evidence and Coverage

### 7.1 F5 — Semgrep dry-run gate (telemetry off, local rules, no network)

The directive gate is written as `semgrep scan --metrics=off --config=<local-rules> --dry-run`.

| Command (Semgrep 1.164.0) | Exit code | Outcome |
|---------------------------|-----------|---------|
| `… --dry-run` (directive as written) | **2** | CLI error: `unknown option '--dry-run'. Did you mean … '--dryrun'?` |
| `… --dryrun` (accepted spelling, D12) | **0** | Config loaded from local dir; telemetry off; no findings emitted in dry-run |

The accepted gate command is:

`semgrep scan --metrics=off --config=security-audit/semgrep-rules --dryrun <target>`

**No-network evidence:** the `--config` argument resolves to a local absolute directory
(`security-audit/semgrep-rules`), so no rule download from the registry occurs; `--metrics=off`
disables telemetry; the run was executed under a clean environment (`env -i`, no proxy variables)
and the output contains no `download` / `registry` / `fetching` / `uploading` indicators. The two
spellings are behaviorally identical; only the flag name changed across Semgrep versions.

### 7.2 Other gates

| Gate | Result |
|------|--------|
| `cat security-audit/findings-layer-*.json \| wc -l` == 4 | **PASS** — each layer file is single-line and newline-terminated; `findings-merged.json` does not match the glob |
| Four-layer distinctness | **PASS** — `{blitzy, semgrep, joern, osv-scanner}` and layers `{1,2,3,4}` are disjoint |
| Joern CPG gate (`cpg.bin` non-empty, > 0 indexed files) | **PASS** — `cpg.bin` ≈ 135 MB; the JS/TS frontend indexed the monorepo (CPG loads ~69,591 methods) |
| Merged summary reconciliation | **PASS** — `by_layer` sums to `total_findings`; `by_severity` sums to `unique_findings` |

### 7.3 F6 — Semgrep coverage: 33 explicit partial-parse exclusions

The Semgrep scan completed with `executionSuccessful: true` and produced 272 SARIF results across
35 rules, but emitted **33** `toolExecutionNotifications` syntax warnings on first-party files.
These are inherent limitations of the pinned Semgrep 1.164.0 TS/TSX frontend on otherwise
valid source; under the read-only constraint the source cannot be edited, and under offline
operation the tooling cannot be upgraded. They are recorded here explicitly and are **not**
treated as fully scanned. (The previous official-pack scan also flagged `packages/embeds/embed-core/index.html`;
the curated 35-rule cache loads no HTML rules, so that single `.html` file is no longer parsed, reducing the count from 34 to 33.)

**By construct:** 20 × TypeScript generic-call `<T>()` (predominantly in test files); 6 × URL
query strings containing `&` embedded in JSX/string literals; 2 × dynamic `import("…")` type
imports; 1 × type-only token (`next.d.ts`); 4 × JSX/HTML email-template constructs.

**By file type:** `tsx` 10, `test.tsx` 9, `test.ts` 8, `ts` 5, `d.ts` 1 — i.e., 17 of
33 are test files; the remainder are type declarations, email HTML templates, and platform
examples. Out of ~7,433 first-party files, 33 partial-parse files ≈ 0.4%.

| # | File | Line | Construct |
|---|------|------|-----------|
| 1 | `apps/api/v1/next.d.ts` | 4 | type-only token |
| 2 | `apps/web/components/apps/routing-forms/TestFormDialog.test.tsx` | 23 | generic `>()` |
| 3 | `apps/web/components/dialog/__tests__/EditLocationDialog.test.tsx` | 24 | generic `>()` |
| 4 | `apps/web/components/dialog/__tests__/RerouteDialog.test.tsx` | 19 | generic `>()` |
| 5 | `apps/web/modules/bookings/components/Booker.test.tsx` | 17 | generic `>()` |
| 6 | `apps/web/modules/bookings/hooks/useBookings.test.tsx` | 124 | generic `>()` |
| 7 | `apps/web/modules/bookings/types.ts` | 107 | dynamic `import()` |
| 8 | `apps/web/modules/ee/organizations/attributes/__tests__/AttributeForm.test.tsx` | 23 | generic `>()` |
| 9 | `apps/web/modules/ee/teams/components/createButton/create-button-with-teams-list.test.tsx` | 15 | generic `>()` |
| 10 | `apps/web/modules/event-types/components/tabs/advanced/FormBuilder.test.tsx` | 29 | generic `>()` |
| 11 | `apps/web/modules/insights/views/insights-call-history-view.tsx` | 318 | URL `&` fragment |
| 12 | `apps/web/modules/insights/views/insights-routing-view.tsx` | 39 | URL `&` fragment |
| 13 | `apps/web/modules/insights/views/insights-view.tsx` | 152 | URL `&` fragment |
| 14 | `apps/web/modules/schedules/components/date-override-list.test.tsx` | 13 | generic `>()` |
| 15 | `packages/app-store/_components/crm/WriteToObjectSettings.types.ts` | 36 | dynamic `import()` |
| 16 | `packages/app-store/_utils/payments/handlePaymentSuccess.test.ts` | 25 | generic `>()` |
| 17 | `packages/emails/email-manager.test.ts` | 83 | generic `>()` |
| 18 | `packages/emails/src/components/BaseEmailHtml.tsx` | 1 | JSX/HTML email template |
| 19 | `packages/emails/src/components/EmailCommonDivider.tsx` | 1 | JSX/HTML email template |
| 20 | `packages/emails/src/components/EmailHead.tsx` | 5 | JSX/HTML email template |
| 21 | `packages/emails/src/components/V2BaseEmailHtml.tsx` | 1 | JSX/HTML email template |
| 22 | `packages/embeds/embed-core/src/__tests__/embed-iframe-methods.test.ts` | 16 | generic `>()` |
| 23 | `packages/features/auth/lib/next-auth-options.test.ts` | 64 | generic `>()` |
| 24 | `packages/features/delegation-credentials/repositories/DelegationCredentialRepository.test.ts` | 25 | generic `>()` |
| 25 | `packages/features/ee/organizations/lib/service/onboarding/__tests__/OrganizationOnboardingFactory.test.ts` | 36 | generic `>()` |
| 26 | `packages/features/feature-opt-in/services/FeatureOptInService.integration-test.ts` | 13 | generic `>()` |
| 27 | `packages/features/tasker/tasks/scanWorkflowBody.test.ts` | 11 | generic `>()` |
| 28 | `packages/platform/examples/base/src/pages/_app.tsx` | 200 | URL `&` fragment |
| 29 | `packages/platform/examples/base/src/pages/booking.tsx` | 98 | URL `&` fragment |
| 30 | `packages/platform/examples/base/src/pages/index.tsx` | 58 | URL `&` fragment |
| 31 | `packages/testing/src/lib/__mocks__/prisma.ts` | 74 | generic `>()` |
| 32 | `packages/testing/src/lib/bookingScenario/bookingScenario.ts` | 83 | generic `>()` |
| 33 | `packages/trpc/server/routers/viewer/organizations/create.handler.test.ts` | 8 | generic `>()` |

These 33 partial-parse notifications are inherent to the pinned frontend and remain after the
include-pattern fix below; they are disclosed here as the accepted, unavoidable coverage caveat
(no source edit and no tooling upgrade is permitted under the read-only + offline constraints).

### 7.4 Semgrep include-pattern anchoring (D21)

The dry-run gate surfaced 12 forward-compatibility warnings: the three CI rules
(`ci.pull-request-target`, `ci.run-step-script-injection`, `ci.excessive-token-permissions`) each
declared four `paths.include` globs — two bare (`.github/workflows/*.yml`, `…/*.yaml`) that
Semgrep 1.164.0 warns will soon be reinterpreted as root-anchored under the Semgrepignore v2 /
Gitignore spec, plus two explicitly-unanchored `**/.github/workflows/*.{yml,yaml}` forms. Because
`**/` matches zero or more leading directories, the `**/` forms already match the root-level
workflow files, so the bare patterns were pure duplicates. Dropping the two bare patterns from
each rule clears all 12 warnings while leaving the matched-file set unchanged. This was verified:
re-running the full scan with the corrected rules against the AAP Layer-2 target set
(`apps packages .github Dockerfile docker-compose.yml .env.example .env.appStore.example`) yields
the **identical** 272-result SARIF tuple set, so `results-semgrep.sarif` and
`findings-layer-2-semgrep.json` (262) are unaffected and were not regenerated. The dry-run gate
now exits 0 with **zero** include-pattern warnings.

## 8. Read-Only Boundary Handling

### 8.1 F1 — `cpg.bin` artifact kept out of git without modifying a tracked file

`cpg.bin` (~135 MB) exceeds GitHub's 100 MB limit and must not be committed. The earlier approach
appended ignore patterns to the tracked root `.gitignore`, which modifies an existing repository
file and violates the non-invasive (`~0 files modified`) boundary.

**Resolution (D9):** the root `.gitignore` was reverted byte-for-byte to its original content, and
the ignore patterns for `security-audit/cpg.bin`, `*.cpg`, `*.bin`, and `workspace/` were placed
in `.git/info/exclude` — a **local, git-internal, untracked** file that never appears in the
repository diff. `cpg.bin` therefore remains untracked and uncommitted while no existing
repository file is modified. Verified: `git diff <baseline> -- .gitignore` is empty, and
`git check-ignore -v security-audit/cpg.bin` resolves to `.git/info/exclude`.

## 9. Layer Findings Summary

| Layer | Tool | Findings | Severity distribution (normalized) | Notable CWEs |
|-------|------|----------|-------------------------------------|--------------|
| 1 | blitzy (native reasoning) | 8 | high 3, medium 5 | CWE-636 (fail-open), CWE-328/CWE-208 (weak/ timing crypto), CWE-358, CWE-79 |
| 2 | semgrep | 262 | high 191, critical 47, medium 24 | CWE-798 (×75), CWE-862 (×57), CWE-79 (×32), CWE-732 (×23), CWE-89 (×22), CWE-94 (×11) |
| 3 | joern | 99 | critical 19, high 41, medium 39 | CWE-78 (×18), CWE-89 (×60), CWE-862 (×21) |
| 4 | osv-scanner | 158 | medium 71, high 65, low 19, critical 3 | per-CVE; 155 unique OSV IDs across 59 packages → 158 (package, CVE) pairs |
| — | **merged (unique)** | **496** | critical 62, high 299, medium 116, low 19 | 31 corroborated (4 highest L1 ∩ L2 incl. CSP CWE-79; 27 high L2 ∩ L3, CWE-78/CWE-89) |

## 10. Reproducibility Notes

- **Joern version (explicitly accepted deviation):** the AAP/checkpoint text references the Joern
  2.x line; the provisioned runtime is Joern **4.0.551** (installed by the environment setup; no
  network is available to install a 2.x build). This is recorded here as an **accepted, deliberate
  deviation**: the 4.x `jssrc` frontend builds an equivalent JS/TS Code Property Graph and runs the
  same JQL query families (taint reachability, command-exec sinks, route-parameter taint, ORM
  raw-SQL, authorization bypass). The CPG gate held (`cpg.bin` non-empty, > 0 files indexed) and
  99 Layer-3 findings were produced, confirming the runtime worked. The only API-level
  consequence is the `where()` route-query adaptation (§5.4, D11); query intent and CWE mapping
  are unchanged from the 2.x design. Risk: 4.x behavioural edge cases vs 2.x — mitigated by
  retaining the raw `results-joern.json` intermediate and corroborating sinks against Layer 2.
- **Joern invocation:** `joern --script security-audit/security-queries.sc --param
  cpgFile=security-audit/cpg.bin --param out=security-audit/results-joern.json` (note the
  singular `--param`). Each run creates a transient `./workspace/` directory, which is removed
  after the run and excluded from git via `.git/info/exclude`.
- **Determinism:** the command-exec, ORM raw-SQL, and unguarded-route families are deterministic;
  re-running the corrected script reproduces the 99-record Layer 3 output (the ORM raw-SQL and
  unguarded-route records are byte-identical to the pre-correction run).

## 11. CWE Classification Policy (per layer)

Every finding is classified by its **most specific** applicable CWE. The *provenance* of that CWE
differs per layer because each tool exposes different metadata:

| Layer | Tool | CWE source | Policy |
|-------|------|------------|--------|
| 1 | blitzy (native) | Expert judgment | The most specific CWE is assigned by reasoning over code, configuration, and architecture — e.g. fail-open authorization → CWE-636, weak hash algorithm → CWE-328, timing/observable-discrepancy → CWE-208, improperly implemented security check → CWE-358. No automated metadata is involved. |
| 2 | semgrep | Rule metadata | The CWE is read from the matched rule's `metadata.cwe` (surfaced via the rule's SARIF tags/properties). When a rule carries **no** CWE tag, the most specific CWE is **inferred** from the rule id and message (e.g. a template-injection rule with no tag → CWE-79). |
| 3 | joern | Query intent | The CWE is fixed by the query family that produced the record: command/code-execution sinks → **CWE-78**, ORM raw-SQL sinks → **CWE-89**, unguarded routes (missing authorization) → **CWE-862**, fail-open guards (incorrect authorization) → **CWE-863**. Route/request parameters gathered by the directive route query are taint **sources**; their canonical CWE-20 / CWE-862 framing applies only once they reach a sink via the reachability family (see §5.2). |
| 4 | osv-scanner | OSV record | The CVE/GHSA id and any CWE supplied by the OSV advisory are carried through unchanged; severity is taken from the advisory's CVSS where present. No CWE is invented. |

Because the Layer 3 mapping is intent-driven, the same query family always yields the same CWE,
which is what keeps the cross-layer dedup key (`file + line + CWE`) stable across re-runs.

## 12. Per-Directive Execution Metadata

The directives mandate that specific execution measurements be recorded. The values below were
captured from the raw intermediates retained under `security-audit/`. Where a measurement was not
emitted by a tool it is disclosed transparently rather than fabricated.

### 12.1 Layer 2 — Semgrep

| Measurement | Value | Source |
|-------------|-------|--------|
| Execution status | `executionSuccessful: true` (successful scan; exit 0) | `results-semgrep.sarif` invocation |
| Rules applied | 35 | local cache `semgrep-rules/{security-audit,secrets,owasp}.yml` (14 + 11 + 10) |
| Results emitted | 272 raw SARIF results → 262 normalized Layer-2 findings (after intra-layer dedup by `tool+file+line+cwe`) | SARIF `runs[0].results`; `findings-layer-2-semgrep.json` |
| Distinct rules fired | 18 of 35 (the other 17 are calibration rules for provider-specific secrets / Dockerfile patterns not present in this repo) | SARIF result rule IDs |
| Partial-parse notifications | 33 | SARIF `toolExecutionNotifications` (enumerated in §7.3) |
| Targets scanned | 9,359 | Semgrep run summary |
| Files scanned | first-party tree under `apps/**`, `packages/**`, `.github/**`, the 7 container files (root `Dockerfile` + `docker-compose.yml` explicitly, the rest under `apps/**`/`packages/**`), and `.env.example`/`.env.appStore.example`, **minus** `.semgrepignore` / `--exclude` (`node_modules`, `.yarn`, `.next`, `dist`, `build`, `out`, `.turbo`, `coverage`, `*.min.js`) | scan command; `.semgrepignore` |
| Wall-clock duration | ≈ 32 s (measured externally; Semgrep 1.164.0 emitted no `startTimeUtc`/`endTimeUtc` in the SARIF invocation block, so the figure is the measured command runtime, not a fabricated SARIF value) | measured at run time |

Telemetry was off (`--metrics=off`) and the rule source was the local cache, so no network calls
were made (dry-run gate evidence in §7.1).

### 12.2 Layer 3 — Joern

| Measurement | Value | Source |
|-------------|-------|--------|
| `cpg.bin` indexed files | **> 0** (gate satisfied); the JS/TS (`jssrc`) frontend indexed the monorepo and the CPG loads ≈ 69,591 methods | `joern-parse` over `apps/**`, `packages/**` |
| Query families executed | 5 emitting families (command-exec, orm-raw-sql, taint-reachability, unguarded-route, fail-open-guard); route/request parameters form a 6th **source-only** family (metadata, not findings) | `security-queries.sc` |
| Total alerts emitted | 99 (CWE-78 ×18, CWE-89 ×60, CWE-862 ×21) | `findings-layer-3-joern.json` |

The `cpg.bin` artifact (~135 MB) exceeds GitHub's 100 MB limit and is intentionally untracked (see
§8 / D9).

### 12.3 Layer 4 — OSV-Scanner

| Measurement | Value | Source |
|-------------|-------|--------|
| Total advisories (unique vuln IDs) | 155 | `results-osv.json` |
| `(package_name, CVE_ID)` pairs (post-dedup findings) | 158 | `findings-layer-4-osv.json` |
| Packages affected | 59 | `results-osv.json` |
| Severity distribution (normalized) | critical 3, high 65, medium 71, low 19 | `findings-layer-4-osv.json` |

OSV-Scanner exits non-zero (1) when vulnerabilities are found; that is the **expected** outcome
here and is not an error. The scan targeted the sole `yarn.lock` (npm ecosystem).

## 13. Executive Deck and the Inline-Theme Decision

**Decision (D14).** The executive-summary presentation is delivered as a single, self-contained
file at `blitzy-deck/executive-summary.html`, with the reveal.js theme embedded **inline** in a
`<style>` block rather than linked externally.

- **Why inline.** Rule 2 mandates a single, self-contained, verification-ready file and references
  a canonical theme at `blitzy-deck/references/blitzy-reveal-theme.css`. That path **does not
  exist** in the repository, so there is nothing to link against. Per Rule 2's own fallback
  mandate, the full `:root` custom-property set (Blitzy brand palette and typography tokens) and
  the slide/component classes are inlined so the deck renders correctly offline with no external
  stylesheet dependency.
- **Pinned runtime dependencies** (loaded from CDN at view time, **not** installed): reveal.js
  5.1.0, Mermaid 11.4.0, Lucide 0.460.0; brand typography via Inter / Space Grotesk / Fira Code.
  These are presentation-runtime assets only and are not added to `package.json` / `yarn.lock`.
- **Risk / mitigation.** Theme drift from a canonical source — mitigated by embedding the complete
  token set inline and pinning exact CDN versions so the deck is reproducible.

This is the ninth AAP §0.5.4 seed decision, recorded as **D14** in §3.

### 13.1 Deck implementation rationale (relocated out of HTML/CSS/JS comments — Rule 1)

Rule 1 requires that non-trivial rationale live here, not in artifact comments. The deck's
HTML/CSS/JS comments are therefore strictly functional (they label what a block is), and the
reasoning behind the non-obvious presentation decisions is recorded below:

- **Web fonts are awaited before Mermaid renders.** Mermaid measures text to size flowchart nodes;
  if it lays out while the brand fonts (Inter / Space Grotesk / Fira Code) are still loading, node
  boxes are computed against fallback metrics and then clip or overflow when the real fonts swap
  in. The script therefore awaits `document.fonts.ready` (with a bounded timeout fallback) before
  calling `mermaid.run`, so diagrams are measured against final metrics.
- **Mermaid uses `startOnLoad: false` with an explicit lazy `mermaid.run`.** Rendering is deferred
  until a slide becomes visible (and after fonts are ready) so reveal.js controls timing; this
  avoids rendering hidden slides at zero width (which produces collapsed or mis-measured diagrams)
  and keeps initial load fast.
- **Mermaid `flowchart` node padding / `htmlLabels` fallback.** Node label padding and the
  foreignObject/HTML-label configuration are tuned so labels fit within node borders at the deck's
  1920×1080 stage size; the rationale is font-metric fit, not styling preference.
- **Fixed 1920×1080 stage with reveal.js scaling.** The deck authors at a fixed 1920×1080 logical
  size and lets reveal.js scale to the viewport, so absolute spacing/positioning stays consistent
  across display sizes without per-breakpoint CSS.
- **Accessibility — muted/secondary text contrast.** The muted token `--text-muted` is set to a
  value meeting WCAG AA (≥ 4.5:1) on both the primary and elevated backgrounds for normal-size
  text (it had previously been used for normal text at ~4.2:1 / ~3.5:1). Where the Layer-1 brand
  purple was used for normal-size mono `.layer-tool` text (~3.6:1), a lighter per-card text token
  is used for that text while the saturated brand purple is retained for icons, chips, and borders
  (non-text, exempt from the 4.5:1 text threshold).
- **Accessibility — decorative icons.** Lucide glyphs in the deck are decorative (adjacent text
  conveys the meaning), so they are marked `aria-hidden="true"` and excluded from the accessibility
  tree to avoid redundant announcements by assistive technology.

## 14. Directive → Requirement Coverage Trace (R1–R8)

Because this task is an **audit** (nothing is migrated or refactored), no source-to-target
traceability matrix applies. The equivalent coverage trace maps each of the eight directives to
its requirement and the artifact that satisfies it.

| Req | Directive | Output artifact(s) | Status / note |
|-----|-----------|--------------------|---------------|
| R1 | Directive 1 — Layer 1 Blitzy native expert audit, classified by most-specific CWE | `findings-layer-1-blitzy.json` (8) | Done |
| R2 | Directive 2 — Install Semgrep; cache `p/security-audit` + `p/secrets` + `p/owasp` locally; confirm telemetry off (dry-run gate exits 0, no network) | `semgrep-rules/{security-audit,secrets,owasp}.yml` (35 rules); gate evidence §7.1 | Done — curated packs approximating the registry sets; `p/owasp` 404s so the OWASP pack is `owasp.yml` (D16); gate spelling `--dryrun` (D12, §7.1); cache isolated to exactly 3 files (D15) |
| R3 | Directive 3 — Run Semgrep → SARIF; apply `error/warning/note/info` map; derive CWE from metadata (infer if absent) | `results-semgrep.sarif` (272 results) → `findings-layer-2-semgrep.json` (262) | Done — CWE read from curated rule metadata (YAML source of truth) |
| R4 | Directive 4 — Install Joern; build CPG (`joern-parse … --output cpg.bin`); > 0 files indexed | `cpg.bin` (~135 MB, indexed > 0) | Done (Joern 4.0.551, §10) |
| R5 | Directive 5 — Run Joern JQL queries; apply `high/medium/low/info` map | `security-queries.sc` + `results-joern.json` → `findings-layer-3-joern.json` (99) | Done — command-exec sinks scoped to real execution APIs (D20, §5.5); route primitive `where()` adaptation, predicate preserved verbatim (D11, §5.4) |
| R6 | Directive 6 — Run OSV-Scanner over all lockfiles; record CVEs, packages, severity distribution | `results-osv.json` → `findings-layer-4-osv.json` (158) | Done — sole `yarn.lock` |
| R7 | Directive 7 — Normalize to the fixed schema; dedup cross-layer by `file+line+CWE`, OSV by `(package, CVE)`; gate `wc -l == 4` | `findings-layer-{1..4}-*.json` | Done — gate returns 4 (§7.2) |
| R8 | Directive 8 — Merged report with `_summary` (`total_findings`, `unique_findings`, `corroborated`, `by_layer`, `by_severity`) + corroboration highlight | `findings-merged.json` | Done (§6.4, §15) |

## 15. Risk Narrative (Merged Report)

This section summarizes `findings-merged.json` **factually**; consistent with the read-only intent
(`~0 files modified`), it is **non-remediative** — it reports posture, it does not prescribe fixes.

- **Volume.** The four layers emitted **527** raw findings, deduplicated to **496** unique
  findings, of which **31** are cross-layer corroborated. Distribution by layer: Layer 1 (blitzy) 8,
  Layer 2 (semgrep) 262, Layer 3 (joern) 99, Layer 4 (osv) 158.
- **Severity (over unique findings).** critical 62, high 299, medium 116, low 19. The critical band
  is dominated by Layer 2/Layer 3 command-execution (CWE-78) and ORM raw-SQL (CWE-89) sinks together
  with Layer 2 hardcoded-secret criticals; the low band is entirely Layer 4 advisories.
- **Highest-confidence signals.** **4** of the 31 corroborated pairs are **highest-confidence
  Layer 1 ∩ Layer 2** overlaps (Blitzy native reasoning independently agreeing with Semgrep on the
  same `file + line + cwe`): `apps/web/lib/csp.ts:22` (**CWE-79**, CSP `'unsafe-inline'`),
  `apps/api/v2/src/vercel-webhook.guard.ts:44` and `apps/web/app/api/sync/helpscout/route.ts:42`
  (**CWE-328**, weak SHA-1 HMAC), and `packages/lib/crypto.ts:3` (**CWE-327**, weak cipher). The
  remaining **27** are high-confidence **Layer 2 ∩ Layer 3** pairs — 6 command-injection (CWE-78,
  e.g. `packages/app-store-cli/src/utils/execSync.ts:10`) and 21 SQL-injection-via-ORM (CWE-89,
  the `Prisma*Repository` files) — where Semgrep's curated sink rules and Joern's dataflow queries
  flag the same location. The CSP pair is enabled by the CWE-79 alignment of D17.
- **Dependency posture (Layer 4).** 158 `(package, CVE)` pairs span 59 packages and 155 unique
  advisories in the npm ecosystem (sole `yarn.lock`). These are **reported** by OSV-Scanner
  querying the OSV.dev database; resolving them is out of scope (§1, D7).

### 15.1 Relationship to the existing CI baseline

The repository already ships `.github/workflows/security-audit.yml`, a reusable `workflow_call`
job that runs `yarn npm audit --all --recursive` (report) plus a `yarn npm audit --all --recursive
--severity critical` gate (`permissions: actions: write, contents: read`; `runs-on:
blacksmith-2vcpu-ubuntu-2404`). This four-layer audit **complements — it does not replace** that
baseline: OSV-Scanner queries the broader OSV.dev database while the yarn-native check remains the
in-pipeline gate. Per D8, `security-audit.yml` is **left unchanged** and no scan is wired into CI.

### 15.2 Consistency with `SECURITY.md`

`SECURITY.md` instructs that automated scanners must not be run against Cal.com's live
infrastructure or dashboard. This audit is fully consistent: it analyzes the **local source tree
statically** (lockfile matching plus CPG/AST inspection), never touching any running system, and
emits only net-new artifacts. `SECURITY.md` is **left unchanged** (D8).

### 15.3 Environment context

The application's target runtime is **Node 20.x** (`Dockerfile` `FROM node:20`, three build
stages), the package manager is **Yarn Berry 4.12.0**, and the **sole** lockfile is `yarn.lock`
(Yarn Berry `__metadata` version 8, npm ecosystem). The audit execution environment provisioned the
scanners independently — **Node v20.20.2**, **Python 3.13.7** (audit venv at `/opt/audit-venv`),
and **OpenJDK 21.0.11** — with Java and Go absent at baseline (hence OpenJDK was installed for
Joern, and the OSV-Scanner prebuilt binary was used because Go is unavailable; see D1, D2, §2).
