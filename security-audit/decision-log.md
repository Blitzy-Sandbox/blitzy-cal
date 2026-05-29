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
| Semgrep local rule cache | 709 rules | `security-audit/semgrep-rules/{security-audit,secrets,owasp-top-ten}.yml` | offline, telemetry-free scans |

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
| D11 | Use `.nonEmpty` adaptation of the route directive primitive | the verbatim `cpg.method.filter(_.annotation.name(".*Route.*")).parameter` | The verbatim form does not type-check in Joern: `filter` expects `Method => Boolean`, and `.annotation.name(...)` yields a traversal, not a Boolean (see §5, F4) | Checklist literalness — documented here as an approved, minimal, semantics-preserving adaptation |
| D12 | Accept Semgrep `--dryrun` as the gate spelling | pin a Semgrep version supporting `--dry-run`; edit the directive | Installed Semgrep 1.164.0 exposes `--dryrun`; no network to install another version; behavior is identical (see §7, F5) | Directive/CLI drift — reconciled and evidenced here |
| D13 | Record the 34 Semgrep parse-warning files as explicit partial-parse exclusions | silently treat them as scanned; edit source to satisfy the parser | Read-only forbids source edits; offline forbids tooling upgrades; the constructs are valid TS/TSX/HTML the pinned frontend cannot fully parse (see §7, F6) | Hidden coverage gap — eliminated by explicit disclosure (§7.3) |

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
| Command/code execution sinks | `cpg.call.name("exec.*|eval|spawn")` | CWE-78 | Yes — every matched sink call |
| ORM raw-SQL sinks | Prisma `$queryRaw` / `$executeRaw` / `queryRawUnsafe` / `executeRawUnsafe` | CWE-89 | Yes — every matched raw-SQL sink |
| Taint reachability | `sink.reachableByFlows(source)` | CWE-78 / CWE-89 (by sink) | Yes — only when a flow exists |
| Unguarded routes | NestJS route handlers lacking `@UseGuards` | CWE-862 | Yes — missing-authorization pattern |
| Fail-open guards | `canActivate` returning literal `true` in a `catch`/error branch | CWE-863 | Yes — incorrect-authorization pattern |
| Route/request parameters | `cpg.method.filter(_.annotation.name(".*Route.*").nonEmpty).parameter` + NestJS/Next.js decorators | — | **No** — collected as taint **sources** (metadata only) |

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

**Result:** Layer 3 went from **976 → 138** confirmed findings (command-exec 57 → CWE-78,
orm-raw-sql 60 → CWE-89, unguarded routes 21 → CWE-862). The 809 route-taint (CWE-20) and 29
decision-point (CWE-863) inventory records were removed. Every retained record is byte-identical
to the corresponding record in the prior output — only inventory padding was dropped, confirming
the kept queries are unchanged and deterministic.

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
type-check in Joern: `Traversal.filter` expects a `Method => Boolean` predicate, but
`_.annotation.name(".*Route.*")` returns an annotation **traversal**, not a Boolean. The minimal,
semantics-preserving adaptation is `_.annotation.name(".*Route.*").nonEmpty`, which converts the
traversal to the required Boolean (true when the method carries a `Route`-style annotation). This
preserves the directive's intent (select route-annotated methods, take their parameters) while
compiling and running on Joern 4.0.551. This adaptation is the approved deviation per D11.

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
| `total_findings` | 336 (L1 8 + L2 32 + L3 138 + L4 158) |
| `unique_findings` | 335 |
| `corroborated` | 1 |
| `by_layer` | `{1: 8, 2: 32, 3: 138, 4: 158}` |
| `by_severity` | `{critical: 72, high: 129, medium: 115, low: 19}` (sums to 335) |

The single corroboration is `packages/app-store-cli/src/utils/execSync.ts:10` at CWE-78 — Layer 2
(Semgrep, `critical`) corroborated by Layer 3 (Joern command-exec, `critical`). The kept record is
the Layer 2 one (tie at `critical` → lower layer). This Layer 1 ∩ Layer 2/3 class of overlap is
the highest-confidence signal in the report; this pair is a Layer 2 ∩ Layer 3 command-injection
corroboration and survives the Layer 3 reduction because command-exec is a retained family.

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

### 7.3 F6 — Semgrep coverage: 34 explicit partial-parse exclusions

The Semgrep scan completed with `executionSuccessful: true` and produced 32 SARIF results across
709 rules, but emitted **34** `toolExecutionNotifications` syntax warnings on first-party files.
These are inherent limitations of the pinned Semgrep 1.164.0 TS/TSX/HTML frontend on otherwise
valid source; under the read-only constraint the source cannot be edited, and under offline
operation the tooling cannot be upgraded. They are recorded here explicitly and are **not**
treated as fully scanned.

**By construct:** 20 × TypeScript generic-call `<T>()` (predominantly in test files); 6 × URL
query strings containing `&` embedded in JSX/string literals; 2 × dynamic `import("…")` type
imports; 1 × type-only token (`next.d.ts`); 5 × JSX/HTML email-template and embed constructs.

**By file type:** `tsx` 10, `test.tsx` 9, `test.ts` 8, `ts` 5, `d.ts` 1, `html` 1 — i.e., 17 of
34 are test files; the remainder are type declarations, email HTML templates, platform examples,
and one embed HTML page. Out of ~7,433 first-party files, 34 partial-parse files ≈ 0.5%.

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
| 22 | `packages/embeds/embed-core/index.html` | 423 | HTML `>` token |
| 23 | `packages/embeds/embed-core/src/__tests__/embed-iframe-methods.test.ts` | 16 | generic `>()` |
| 24 | `packages/features/auth/lib/next-auth-options.test.ts` | 64 | generic `>()` |
| 25 | `packages/features/delegation-credentials/repositories/DelegationCredentialRepository.test.ts` | 25 | generic `>()` |
| 26 | `packages/features/ee/organizations/lib/service/onboarding/__tests__/OrganizationOnboardingFactory.test.ts` | 36 | generic `>()` |
| 27 | `packages/features/feature-opt-in/services/FeatureOptInService.integration-test.ts` | 13 | generic `>()` |
| 28 | `packages/features/tasker/tasks/scanWorkflowBody.test.ts` | 11 | generic `>()` |
| 29 | `packages/platform/examples/base/src/pages/_app.tsx` | 200 | URL `&` fragment |
| 30 | `packages/platform/examples/base/src/pages/booking.tsx` | 98 | URL `&` fragment |
| 31 | `packages/platform/examples/base/src/pages/index.tsx` | 58 | URL `&` fragment |
| 32 | `packages/testing/src/lib/__mocks__/prisma.ts` | 74 | generic `>()` |
| 33 | `packages/testing/src/lib/bookingScenario/bookingScenario.ts` | 83 | generic `>()` |
| 34 | `packages/trpc/server/routers/viewer/organizations/create.handler.test.ts` | 8 | generic `>()` |

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
| 2 | semgrep | 32 | critical 12, high 20 | CWE-79 (×13), CWE-345 (×7), CWE-798 (×5), CWE-78 (×4), CWE-250 |
| 3 | joern | 138 | critical 58, high 41, medium 39 | CWE-78 (×57), CWE-89 (×60), CWE-862 (×21) |
| 4 | osv-scanner | 158 | medium 71, high 65, low 19, critical 3 | per-CVE; 155 unique OSV IDs across 59 packages → 158 (package, CVE) pairs |
| — | **merged (unique)** | **335** | critical 72, high 129, medium 115, low 19 | 1 corroborated (CWE-78, L2 ∩ L3) |

## 10. Reproducibility Notes

- **Joern version:** the AAP/checkpoint text references the Joern 2.x line; the provisioned
  runtime is Joern **4.0.551**. The 4.x `jssrc` frontend builds an equivalent JS/TS CPG and runs
  the same JQL query families; the produced raw results confirm the runtime worked. The
  `.nonEmpty` route-query adaptation (§5.4) is required on the 4.x API.
- **Joern invocation:** `joern --script security-audit/security-queries.sc --param
  cpgFile=security-audit/cpg.bin --param out=security-audit/results-joern.json` (note the
  singular `--param`). Each run creates a transient `./workspace/` directory, which is removed
  after the run and excluded from git via `.git/info/exclude`.
- **Determinism:** the command-exec, ORM raw-SQL, and unguarded-route families are deterministic;
  re-running the corrected script reproduces the 138-record Layer 3 output.
