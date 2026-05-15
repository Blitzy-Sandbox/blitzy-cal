# Config F (OSV-Scanner) — Decision Log

This document satisfies the Explainability rule (AAP §0.7.1) for Config F of the multi-config security-tool comparison. It is the **single source of truth** for every non-trivial implementation decision made while installing OSV-Scanner, scanning the Cal.com (`blitzy-cal`) monorepo lockfile, and normalizing findings into the fixed five-field schema. It accompanies three sibling deliverables at the repository root: `findings-config-f.json` (primary, minified single-line JSON), `results-osv.json` (raw OSV-Scanner output retained for traceability), and `executive-summary-config-f.html` (reveal.js executive presentation). No rationale for any of these decisions is embedded in code comments — this file is the authoritative record.

## Scan Metadata

All values below were captured from live command output during a reproducibility validation run executed on **2026-05-15T04:09:16Z** (ISO 8601, UTC). The validation run produced a `results-osv.json` byte-for-byte identical (`md5: 88b65708e70385caf0fe0881230d75f3`) to the canonical artifact already at the repository root, confirming the scan is fully reproducible within the same 24-hour OSV.dev publication window.

| Key | Value |
|-----|-------|
| Scanner version | `osv-scanner version: 2.3.8` (osv-scalibr `0.4.5`, commit `408fcd6f8707999a29e7ba45e15809764cf24f67`, built `2026-05-08T04:54:35Z`) |
| Install method | Prebuilt `linux_amd64` static binary from `github.com/google/osv-scanner/releases` placed at `/usr/local/bin/osv-scanner` (58,335,394 bytes; binary mtime `2026-05-15 02:37:57 UTC`) |
| Install commands attempted (in order) | (1) `apt-get install -y osv-scanner` → **not available** in Ubuntu 25.10 repos (`apt-cache policy osv-scanner` returned empty); (2) downloaded prebuilt binary tarball, extracted, `install -m 0755 osv-scanner /usr/local/bin/osv-scanner` → **PASS** |
| Install verification (literal stdout) | `osv-scanner version: 2.3.8` / `osv-scalibr version: 0.4.5` / `commit: 408fcd6f8707999a29e7ba45e15809764cf24f67` / `built at: 2026-05-08T04:54:35Z` |
| Scan command (literal) | `osv-scanner --format json --output results-osv.json /tmp/blitzy/blitzy-cal/blitzy-31e4abed-8c1c-4546-8e0c-844e61324654_dcc690` |
| Scan start time (UTC, ISO 8601) | `2026-05-15T04:09:16Z` |
| Scan end time (UTC, ISO 8601) | `2026-05-15T04:09:21Z` |
| Wall-clock duration | `5` seconds (validation re-run; OSV-Scanner self-reports `23.656 ms` of internal filesystem-walk + extract time — the remainder is OSV.dev API latency) |
| Exit code | `1` — interpreted as **success-with-findings** per the documented OSV-Scanner exit-code semantics (see the **Exit-code interpretation** decision row); the surrounding shell pipeline does NOT propagate this as a build failure |
| OSV database mode | **Online** — queried `api.osv.dev` (and `osv-vulnerabilities.storage.googleapis.com`) directly; `--experimental-local-db` was NOT applied (see the **Offline mode toggle** decision row) |
| Lockfile(s) parsed | `yarn.lock` (Yarn Berry v8 metadata format, 1,433,240 bytes, 40,303 lines, 3,725 packages discovered) — the only OSV-supported lockfile in the repository, confirmed by the AAP §0.2.1 negative inventory (`package-lock.json`, `pnpm-lock.yaml`, `requirements.txt`, `poetry.lock`, `Pipfile.lock`, `Gemfile.lock`, `go.mod`, `go.sum`, `Cargo.lock`, `composer.lock`, `pom.xml` all absent) |
| Repository under scan | `/tmp/blitzy/blitzy-cal/blitzy-31e4abed-8c1c-4546-8e0c-844e61324654_dcc690` (commit `226018ee5e6a0c5988385fe33cdb9eea49e7e06d`, branch `blitzy-31e4abed-8c1c-4546-8e0c-844e61324654`) |
| Raw vulnerability records returned | `228` (across `88` distinct packages) |
| OSV-Scanner `groups[]` entries | `228` (each group contains exactly 1 ID for this corpus — see the **Deduplication via `groups[]`** decision row and Deviations section) |
| Final findings count (post-normalization) | `228` |
| Findings by severity | `critical: 5` / `high: 104` / `medium: 89` / `low: 30` |
| Maximum `description` length | `178` characters (well within the 200-character cap) |
| `results-osv.json` size | `1,691,979` bytes |
| `findings-config-f.json` size | `36,372` bytes (single line, UTF-8, terminated by `\n`) |
| Normalizer implementation | `jq` 1.8.1 for projection / minification; Python 3.13.7 `json` stdlib used as a parallel cross-check; numeric CVSS score taken directly from OSV `groups[].max_severity` (a string convertible via `tonumber`) so no manual CVSS V3 base-score recomputation was needed |
| Host environment | Ubuntu 25.10 sandbox; Node `v20.20.2`; Yarn `4.12.0`; Python `3.13.7`; `jq` `1.8.1`; Go toolchain **absent** (no `which go` result, ruling out the user-listed `go install …` route) |

## Decision Table

The table below has exactly the four columns required by the Explainability rule — `Decision`, `Alternatives`, `Rationale`, `Risks`. The first sentence of each `Decision` cell is bolded and serves as the canonical reference name when cited elsewhere in this document.

| Decision | Alternatives | Rationale | Risks |
|----------|--------------|-----------|-------|
| **Install method.** Prebuilt `linux_amd64` static binary from the OSV-Scanner GitHub releases page, installed to `/usr/local/bin/osv-scanner`. | (a) `apt-get install -y osv-scanner` — first attempted; (b) `go install github.com/google/osv-scanner/cmd/osv-scanner@latest` — user's primary example. | The user explicitly accepts apt as an alternative install path; the environment probe established Go is absent (no `which go` result) and `apt-cache policy osv-scanner` returns no candidate in the Ubuntu 25.10 repositories, eliminating both apt and Go routes. The prebuilt static binary is the official upstream-blessed third option and matches the host architecture. | Prebuilt binary lives outside any package-manager database, so future updates require manual replacement; the apt-packaged version, if it ever appears, may lag the GitHub releases page in any case. |
| **Scan invocation form.** Recursive directory scan via `osv-scanner --format json --output results-osv.json /tmp/blitzy/blitzy-cal/blitzy-31e4abed-8c1c-4546-8e0c-844e61324654_dcc690`. | (a) Explicit lockfile flag `--lockfile=…/yarn.lock`; (b) per-ecosystem invocations. | The repository contains exactly one OSV-supported lockfile (`yarn.lock`); the recursive directory form is byte-equivalent to the explicit-lockfile form for this corpus AND matches the verbatim user-supplied Directive 2 command structure. | None for a single-lockfile repository. Recursive walks of multi-language trees can be slower, but that case does not apply here (filesystem walk completed in 23.656 ms per scanner self-report). |
| **Offline mode toggle** (`--experimental-local-db`). **NOT applied** — the scan ran online against `api.osv.dev`. | (a) Pre-download offline DB then pass `--experimental-local-db`; (b) `--offline --download-offline-databases` (newer flag form). | The setup phase confirmed network egress to `osv-vulnerabilities.storage.googleapis.com` (200 OK) and `api.osv.dev`; the online path is simpler, avoids a separate database-download step, and yields the freshest vulnerability data. | Online runs transmit package names, versions, ecosystems, and file hashes to OSV.dev — **no source code is transmitted** — which is acceptable for this comparison artifact. In a network-restricted environment, this decision would invert. |
| **CVSS-score derivation.** Numeric base score read directly from each `packages[].groups[i].max_severity` string and parsed with `tonumber`; when multiple `severity[]` entries exist, the highest is implicitly chosen by OSV-Scanner before exposure as `max_severity`. | (a) Parse the CVSS V3 vector string in `vulnerabilities[].severity[].score` and compute the base score manually with the CVSS V3 formula; (b) use qualitative `database_specific.severity` (e.g., `"MODERATE"`). | OSV-Scanner ≥ v1.4 emits `groups[].max_severity` as a precomputed numeric string aggregated across all CVSS vectors in the group, which is functionally identical to "parse the vector and take the max" while avoiding the implementation cost of a CVSS calculator. The numeric thresholds (≥9, ≥7, ≥4) supplied by the user require a numeric score. | If `max_severity` is empty (no CVSS data published yet), the finding falls into `low` — see the **Severity-bucket boundaries** row below. Qualitative `database_specific.severity` would not round-trip onto the user's exact thresholds (e.g., "MODERATE" spans 4.0–6.9). |
| **Severity-bucket boundaries.** `score >= 9.0 → critical`, `score >= 7.0 → high`, `score >= 4.0 → medium`, `score < 4.0 → low`. Edge values fall into the higher bucket; an empty/non-numeric `max_severity` is treated as `0.0` and therefore maps to `low`. | (a) Strict `>` rather than `>=`; (b) round to one decimal place before comparison; (c) treat missing scores as `medium`. | Matches the user-supplied table notation `>=9 → critical, >=7 → high, >=4 → medium, <4 → low` literally; aligns with NVD CVSS V3 qualitative-rating conventions; the inclusive-low boundary is the standard NVD interpretation. | A score of exactly 6.9 vs 7.0 shifts one bucket; documented here so downstream comparison agents can interpret edge cases consistently. Treating missing scores as `low` is conservative for risk-prioritization but could under-represent a genuinely-high-severity record that lacks CVSS metadata. |
| **CWE-extraction precedence.** (1) `affected[i].database_specific.cwe_ids[0]` for an `affected[]` entry whose `package.name` matches the finding's package; (2) top-level `database_specific.cwe_ids[0]`; (3) the first `aliases[]` entry matching `^CVE-\d{4}-\d+$`; (4) the OSV record `id` itself as last-resort fallback, prepended with `OSV-` if it does not already start with a recognized publisher prefix (`CVE-`, `GHSA-`, or `OSV-`) — so the raw OSV id `MAL-2025-22760` becomes `OSV-MAL-2025-22760` after prefixing, while a raw `GHSA-…` id would be emitted unchanged. | (a) Only check top-level `database_specific.cwe_ids`; (b) only emit CVE, never CWE; (c) join all CWE IDs into a `;`-separated string. | The user directive states "CVE ID. If a CWE mapping exists in the OSV entry, use it; otherwise use the CVE ID" — the precedence places CWE first, then CVE; GHSA (the largest OSV publisher) places CWE under `database_specific.cwe_ids[]` per the well-known GitHub convention. The OSV-id fallback exists for the rare record that has neither a CWE nor a CVE alias. The `OSV-` prefix normalization in rule (4) ensures bare OSV-domain identifiers (e.g., `MAL-…` malicious-package records) carry an unambiguous publisher prefix in the emitted `cwe` field for downstream comparison. | A record with multiple CWEs surfaces only the first — the others are recoverable from the raw `results-osv.json`. Cross-publisher CWE placement is not standardized in OSV-Schema, so non-GHSA records may carry CWE in a location this precedence does not check; for the current dataset, all CWE-bearing records are GHSA. |
| **Description selection & truncation.** Prefer `summary`; fall back to `details` when `summary` is empty/absent; truncate to the first 200 characters via character-count slice (`[0:200]`), **no ellipsis appended**; strip trailing whitespace inside the 200-character window. | (a) Always prefer `details`; (b) truncate at word boundaries; (c) append `...` on truncation; (d) truncate by byte count rather than character count. | `summary` is typically a one-liner appropriate for a 200-character cap; the user directive says "truncated to 200 characters" with no semantic-summary requirement, so a hard character cut is the most literal interpretation. The maximum description length actually observed is `178` — no truncation was triggered for this corpus. | A truncated description may end mid-sentence — acceptable per the literal directive. Character-count rather than byte-count is correct because the directive says "characters"; UTF-8 multi-byte characters could otherwise inflate byte length, but all observed descriptions are ASCII. |
| **Deduplication via `groups[]`.** Emit ONE finding per `packages[].groups[]` entry (using the first `ids[0]` as the canonical OSV id) when `groups` is present and non-empty; otherwise emit one finding per `vulnerabilities[]` record. | (a) Emit every `vulnerabilities[]` record with no dedup (the literal user directive); (b) dedup by CVE alias only; (c) dedup by OSV `id` only. | A single CVE can appear in OSV-Scanner output as both a `GHSA-…` and an `OSV-…` record; the `groups[]` array aggregates these aliases. Emitting one finding per group produces a more useful comparison signal across configs. **For this corpus the policy is a no-op** — every group contains exactly 1 ID — but it remains a deliberate policy choice. | **This is a deviation from the literal user directive** (which says "extract every vulnerability finding"). The deviation is documented in the Deviations section below. In datasets where multiple records alias each other, the raw count would be 2–3× higher; this policy keeps Config F's count semantically comparable to other configs that have native dedup. |
| **Empty-findings encoding.** Literal two-byte string `[]` followed by exactly one `\n` line terminator (the file contains `[]\n`). | (a) `[]` with no trailing newline (`wc -l` returns 0); (b) `[]\r\n` (CRLF); (c) empty file (no JSON at all). | `wc -l` counts newline characters, so `[]\n` is the only encoding that satisfies the user's `cat findings-config-f.json \| wc -l` returning `1` while also remaining valid JSON. UTF-8 with LF line endings is the standard convention for repository artifacts. | Some downstream consumers (sloppy `sed`/`awk` pipelines) strip trailing whitespace, after which `wc -l` would return `0`; this risk is documented here so the byte-level contract (`[]\n`) is explicit. Not applicable to this run — the array has 228 findings, not zero. |
| **Exit-code interpretation.** `0` = success-no-findings, `1` = **success-with-findings**, anything else = scan failure. Exit `1` is NOT propagated as a build failure. | (a) Treat any non-zero as failure (would mis-classify findings-present as a scan error); (b) ignore the exit code entirely. | OSV-Scanner documents that `1` is returned when vulnerabilities are found even though the scan itself succeeded; treating `1` as failure would break the pipeline whenever any CVE is reported. The observed exit code for this run is `1`. | A future scanner regression that introduces a new non-zero code may be misinterpreted; this row records the exact code observed (`1`) for forward reference. |
| **Path-relativization form.** The `file` field is the bare relative path `yarn.lock` — no `./` prefix, no absolute path. | (a) `./yarn.lock`; (b) absolute path `/tmp/blitzy/blitzy-cal/blitzy-31e4abed-8c1c-4546-8e0c-844e61324654_dcc690/yarn.lock`; (c) basename only when nested. | OSV-Scanner records absolute paths in `results[].source.path`; the user directive says "relative" so the absolute path is wrong, and `./` is informationally redundant for a root-level file. Bare filename is the cleanest relative form. | Consumers that treat `./` as significant (rare for JSON) would need adjustment; not a practical concern here. |
| **Normalizer implementation.** `jq` 1.8.1 for JSON projection, minification (`jq -c`), and emission to a single-line file. Python 3.13.7 with the `json` stdlib was used in parallel as a cross-check and would be the documented fallback if `jq` lacked a needed feature. | (a) Node `JSON.parse` via a staged `.mjs` file or `node -e`; (b) a compiled tool. | `jq` is universally available on Debian/Ubuntu hosts, produces deterministic minified output via `-c`, and operates as a streaming pipeline with no temporary files. `groups[].max_severity` is already numeric in OSV-Scanner output whenever it is populated, so the previously-anticipated need for a Python CVSS calculator did not materialize. | `jq` lacks a built-in CVSS calculator — not required this run because every populated `groups[].max_severity` was a numeric string parseable via `tonumber`. In 3 cases (`cookie@0.4.1` / `GHSA-pxg6-pf52-xh8x`, `cookie@0.4.2` / `GHSA-pxg6-pf52-xh8x`, `http@0.0.1-security` / `MAL-2025-22760`) the `max_severity` field was empty and the documented **Severity-bucket boundaries** fallback ("missing score → `low`") was correctly applied. If a future OSV-Scanner regression omits `max_severity` for vulnerabilities that would otherwise rate higher than `low`, the normalizer must fall back to either a Python helper or vector-string parsing rather than relying on the empty-string-to-`low` default. |

## Deviations from Literal User Directives

The user's three CRITICAL directives are followed verbatim **except for the following deliberate departure**, flagged here per the Explainability rule.

| Deviation | Literal user directive | Actual implementation | Reason |
|-----------|-----------------------|------------------------|--------|
| `groups[]` deduplication | Directive 3, paraphrased: "extract every vulnerability finding". A literal reading emits one finding per `vulnerabilities[]` entry, with no alias collapsing. | The normalizer emits one finding per `packages[].groups[]` entry — collapsing OSV records that alias each other (typically a `GHSA-…` record and its paired `OSV-…` record for the same underlying CVE). | This is a comparison-utility decision intended to keep finding counts semantically equivalent across configs (other security scanners commonly deduplicate by CVE natively). **For the current Cal.com `yarn.lock` corpus this deviation is functionally a no-op** because every `groups[]` entry contains exactly 1 ID (228 raw vulnerabilities ↔ 228 groups ↔ 228 emitted findings). The policy is still documented as a deviation so a future reviewer comparing this artifact against the literal directive on a multi-aliased corpus understands why the count differs from a naive vulnerability-record count. |

No other deviations from any user directive occurred. All field names, value shapes, lowercase severity strings, character-count truncation, single-line JSON output, UTF-8 encoding, and exit-code criteria match the literal directives.

## Pass/Fail Verification Log

All gates passed. Commands and outputs reproduced verbatim from the live shell session.

### Directive 1 — `osv-scanner --version` returns a version string

```
$ osv-scanner --version
osv-scanner version: 2.3.8
osv-scalibr version: 0.4.5
commit: 408fcd6f8707999a29e7ba45e15809764cf24f67
built at: 2026-05-08T04:54:35Z
```

**Result: PASS** — exit code `0`, version string present.

### Directive 2 — `results-osv.json` is produced and contains valid JSON

```
$ ls -la results-osv.json
-rw-r--r-- 1 root root 1691979 May 15 02:51 results-osv.json

$ jq empty < results-osv.json && echo OK
OK
```

**Result: PASS** — file present, non-empty (1,691,979 bytes), `jq empty` exit `0`.

### Directive 3 — `findings-config-f.json` is single-line, valid JSON, complete, and length-bounded

**Sub-criterion 1: `cat findings-config-f.json | wc -l` returns `1`.**

```
$ cat findings-config-f.json | wc -l
1
```

Result: **PASS**.

**Sub-criterion 2: `jq empty < findings-config-f.json` returns exit `0` (valid JSON).**

```
$ jq empty < findings-config-f.json && echo OK
OK
```

Result: **PASS**.

**Sub-criterion 3: every finding has all 5 fields populated.**

```
$ jq 'all(.[]; has("file") and has("line") and has("severity") and has("cwe") and has("description"))' < findings-config-f.json
true
```

Result: **PASS** — the predicate returned `true` for all 228 elements.

**Sub-criterion 4: no `description` exceeds 200 characters.**

```
$ jq '[.[] | .description | length] | max' < findings-config-f.json
178
```

Result: **PASS** — `178 <= 200`.

### Supplementary integrity checks

```
$ jq 'length' < findings-config-f.json
228

$ jq -r '[.[].severity] | group_by(.) | map({severity: .[0], count: length})' < findings-config-f.json
[
  {"severity": "critical", "count": 5},
  {"severity": "high",     "count": 104},
  {"severity": "low",      "count": 30},
  {"severity": "medium",   "count": 89}
]

$ jq -r '[.[].file] | unique' < findings-config-f.json
["yarn.lock"]

$ jq -r '[.[].line] | unique' < findings-config-f.json
[0]

$ jq -r '[.[].cwe] | map(test("^CWE-\\d+$|^CVE-\\d{4}-\\d+$|^GHSA-|^OSV-")) | all' < findings-config-f.json
true
```

All supplementary checks pass: total 228, severity distribution matches the Scan Metadata section, every `file` is `yarn.lock`, every `line` is `0`, every `cwe` matches one of the documented identifier shapes (`CWE-*` for direct CWE mappings, `CVE-*` for the CVE-alias fallback, or `GHSA-*`/`OSV-*` for the OSV-id last-resort fallback). The regex alternation includes `^OSV-` because the **CWE-extraction precedence** rule (4) prepends `OSV-` to raw OSV-domain ids that lack a recognized publisher prefix; in this corpus the alternation accepts the 227 `CWE-…` direct mappings and the 1 `OSV-MAL-2025-22760` last-resort fallback.

## Open Questions / Follow-Up

- **Missing-score severity fallback was exercised 3 times.** Three `groups[]` entries carried an empty `max_severity` value and were mapped to `low` via the **Severity-bucket boundaries** decision row's "missing score → `low`" branch: `cookie@0.4.1` / `GHSA-pxg6-pf52-xh8x`, `cookie@0.4.2` / `GHSA-pxg6-pf52-xh8x`, and `http@0.0.1-security` / `MAL-2025-22760`. Of the `30` total `low` findings, `27` are genuinely-low (CVSS V3 base score `< 4.0`) and `3` are defaulted-to-`low` via this fallback. A future OSV.dev publication that adds CVSS metadata to these three records could reclassify them; this is acceptable scanner-snapshot behavior and the documented fallback is functioning as designed.
- **CWE-extraction precedence reached the OSV-id last-resort fallback once.** Of the `228` emitted findings: `227` resolved via steps (1)/(2) to a `CWE-…` identifier (from `database_specific.cwe_ids[]`), `0` reached the step (3) `CVE-…` alias fallback, and `1` reached the step (4) OSV-id last-resort fallback — `http@0.0.1-security` / `MAL-2025-22760` was emitted with `cwe: "OSV-MAL-2025-22760"` (the raw OSV id `MAL-2025-22760` prepended with `OSV-` per the rule (4) normalization). The OSV-id last-resort fallback documented in the **CWE-extraction precedence** decision row is therefore an exercised code path on this corpus.
- **Apt-package availability for OSV-Scanner should be re-checked when Ubuntu 26.04 LTS ships.** The current Ubuntu 25.10 sandbox does not ship an `osv-scanner` package, forcing the prebuilt-binary route. If a future host environment provides `osv-scanner` via apt, the **Install method** decision row should be revisited to prefer the package-manager route for easier patch tracking.
- **Audit-exception cross-reference.** The repository's `.yarnrc.yml` records one accepted exception (`npmAuditIgnoreAdvisories: ["1113407"]` for `fast-xml-parser 4.4.1` via `@boxyhq/saml-jackson → @aws-sdk/core@3.816.0`); OSV-Scanner findings were NOT filtered against this list, by design — Config F captures the raw scanner output so downstream comparison can quantify the gap between OSV.dev and the Yarn audit database. Any subset of the 228 findings that overlap the exception list is a comparison-analysis concern, not a Config F production concern.
- **Project audit gate comparison.** The existing `.github/workflows/security-audit.yml` enforces zero critical advisories in the Yarn audit database via a two-phase gate (`yarn npm audit --all --recursive` informational then `--severity critical` blocking); OSV-Scanner draws from a broader OSV.dev aggregation (GHSA, RustSec, PyPA, Go vuln DB, etc.), so the 5 critical / 104 high findings reported here may not all surface in the existing Yarn audit gate. This is expected and is the analytical value the multi-config comparison is designed to surface.

---

_Generated for Config F of the Blitzy multi-config security tool comparison series. Authority: AAP §0.7.1 (Explainability rule). Companion artifacts: `findings-config-f.json`, `results-osv.json`, `executive-summary-config-f.html`._
