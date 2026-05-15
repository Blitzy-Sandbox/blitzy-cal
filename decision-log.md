# Decision Log — Config B (Semgrep Security Scan)

This document is the **single source of truth for "why" decisions** made during the Config B Semgrep security scan pipeline of the `blitzy-cal` codebase. It is the bound deliverable for the **Explainability Rule** (Agent Action Plan §0.8.1), which requires that every non-trivial implementation decision be documented with rationale, alternatives, and risks in a Markdown table format.

This work is a **security scan, not a migration or refactor**. Therefore, the Explainability Rule's clause on bidirectional traceability matrices ("For migrations or refactors, include a bidirectional traceability matrix mapping source constructs to target implementations — 100% coverage, no gaps.") does **not** apply here. The intentional omission is recorded explicitly in §Traceability Matrix Applicability below so that reviewers can confirm the omission is deliberate rather than accidental.

The pipeline is composed of five logical stages — **Preflight → Install → Cache → Scan → Normalize** — bracketed by two rule-mandated documentation artifacts (this file and the executive summary deck). Every non-trivial choice that a competent engineer could "reasonably have chosen differently" is captured in the §Decision Table. Rationale is not duplicated in code comments anywhere in the pipeline scripts; per the rule body, this decision log is the SOLE source of truth for "why" decisions.

## Scope Reconciliation

The user-supplied AAP annotation `[3 directives | ~0 files modified | 1 new file]` claims that this work produces exactly one new file (`findings-config-b.json`). The two user-specified implementation rules expand that count:

- **User-claimed new files (directive-derived):** 1
  - `findings-config-b.json` — the primary normalized findings artifact
- **Rule-mandated new files (rule-derived):** 3
  - `decision-log.md` — this file (Explainability Rule)
  - `blitzy-deck/executive-summary-config-b.html` — the executive deck (Executive Presentation Rule)
  - `blitzy-deck/references/blitzy-reveal-theme.css` — the canonical Blitzy theme stylesheet (Executive Presentation Rule, called out by name in the rule body)
- **Transient files (produced and consumed within the pipeline; not committed):**
  - `results-semgrep.sarif` — raw SARIF 2.1.0 output of the Directive 2 scan command
  - `/tmp/semgrep-rules/security-audit.yml`, `/tmp/semgrep-rules/secrets.yml`, `/tmp/semgrep-rules/owasp.yml` — locally cached Semgrep Registry rule packs
- **Net committed deliverables: 4 files** (1 user-directive + 3 rule-mandated).

Per the **AAP RULE-DRIVEN SCOPE principle** ("Files required by user-specified rules MUST be included in the files-in-scope section, even if not explicitly mentioned in the user's feature/bug description"), the rule-mandated files take precedence over the user's tally. The annotation `1 new file` is treated as a directive-count annotation rather than an absolute file-count cap. The Explainability Rule itself requires this conflict and its resolution to be recorded here — the rule is, in this sense, self-justifying.

## Pipeline Observability Record

This section records the three values mandated by Directive 2 (verbatim: "Record exit code, scan duration (wall-clock), and total files scanned") plus the severity breakdown of the normalized findings, the rule-pack snapshot timestamp (so the corpus state is reproducible), the verified Semgrep version, and the absolute repository path under scan.

| Metric                                     | Value                                                             |
| ------------------------------------------ | ----------------------------------------------------------------- |
| Semgrep exit code                          | `0`                                                               |
| Wall-clock scan duration (milliseconds)    | `93085` (≈ 93.1 seconds)                                          |
| Total files scanned                        | `10009`                                                           |
| Rules run                                  | `185` (subset of `820` cached rules applicable to detected languages) |
| Total findings                             | `32`                                                              |
| Critical findings (SARIF `error`)          | `12`                                                              |
| High findings (SARIF `warning`)            | `20`                                                              |
| Medium findings (SARIF `note`)             | `0`                                                               |
| Low findings (SARIF `info` / default)      | `0`                                                               |
| Rule-pack snapshot timestamp (UTC ISO8601) | `2026-05-15T02:43:55Z`                                            |
| Semgrep version verified                   | `1.163.0`                                                         |
| Repository scanned (absolute path)         | `/tmp/blitzy/blitzy-cal/blitzy-50d10468-0a6d-4f8f-8328-31a7552d746d_2caaf7` |
| Files skipped (size > 1 MB)                | `36`                                                              |
| Files skipped (`.semgrepignore` patterns)  | `402`                                                             |
| Telemetry self-report                      | `Not sending pseudonymous metrics since metrics are configured to OFF, registry usage is False, and login status is False` |
| Rule-pack file sizes                       | `owasp.yml` 1,412,462 bytes / `secrets.yml` 87,683 bytes / `security-audit.yml` 473,426 bytes |
| Rule-pack rule counts                      | `owasp` 544 rules / `secrets` 51 rules / `security-audit` 225 rules / total `820` |

All three user pass/fail gates were evaluated and passed:

1. **Directive 1 pass/fail** — `semgrep scan --metrics=off --config=/tmp/semgrep-rules --dryrun .` exited `0` with the telemetry self-report confirming no network calls.
2. **Directive 2 pass/fail** — `results-semgrep.sarif` was produced; `python3 -m json.tool < results-semgrep.sarif` succeeded; `data["runs"]` is a list of length `1` containing `32` results.
3. **Directive 3 pass/fail** — `findings-config-b.json` is produced by the sibling normalization step; `wc -l` returns `1`; valid JSON; every finding has all 5 fields populated; no description exceeds 200 characters.

## Decision Table

The table below enumerates every non-trivial implementation decision made in this pipeline. Each row uses the four columns mandated by the Explainability Rule body: `Decision`, `Alternatives`, `Rationale`, `Risks`. Decisions are unique; rationale is not duplicated in code comments.

| Decision | Alternatives | Rationale | Risks |
| --- | --- | --- | --- |
| Use Semgrep CE `1.163.0` from PyPI | Homebrew (`brew install semgrep`); Docker image (`semgrep/semgrep`); manual binary download | PyPI install is the documented cross-platform path per Semgrep docs; pinning to `1.163.0` (released May 13, 2026) freezes Config B output for cross-config comparison; Python 3.13 in the execution environment is compatible per the upstream wheel matrix | A future CVE in `1.163.0` would require a pin bump and a full re-run of the pipeline |
| Cache rule packs locally in `/tmp/semgrep-rules/` | Live fetch from registry every run; persistent CI cache; vendored YAMLs in the repo | Local cache eliminates the registry-fetch round-trip that would otherwise enable telemetry (per AAP §0.2.3 and the Semgrep metrics policy: "Semgrep does enable metrics if rules are loaded from the Semgrep Registry"); also freezes the rule corpus snapshot for reproducibility | Cache lives only for the duration of the run; snapshot timestamp `2026-05-15T02:43:55Z` is recorded in §Pipeline Observability Record to enable reproducible re-runs |
| Use the three user-named packs: `p/security-audit`, `p/secrets`, `p/owasp` | Add `p/owasp-top-ten` separately; substitute `p/r2c-security-audit`; minimize to one pack to reduce duplicate findings | User directive names these three packs exactly; verbatim adherence per AAP §0.1.4 ("Preserved User Examples"). The canonical Semgrep Registry alias for `p/owasp` resolves to the OWASP Top Ten ruleset (544 rules) | Pack contents are rolling on the Semgrep Registry; snapshot timestamp documents the corpus state |
| Pass `--metrics=off` on every Semgrep invocation | Rely solely on local-rules to suppress telemetry; rely solely on `--metrics=off`; set `SEMGREP_SEND_METRICS=off` only | Defense-in-depth: AAP §0.1.3 explicitly requires BOTH `--metrics=off` AND local rule loading because the Semgrep docs state the metric channel is the union of registry usage and explicit metrics-on. The flag's CLI definition is "If 'off', metrics are disabled altogether and not sent." | None material |
| Severity default for SARIF `none` / unknown level → `low` | Drop the finding silently; raise an error and fail the pipeline; default to `medium` | Preserves evidence rather than discarding the finding; the user's mapping is exhaustive over the four levels Semgrep emits but the SARIF 2.1.0 spec adds `none`; defaulting to `low` is the least-surprising behaviour and degrades safely | A future Semgrep severity addition could be miscategorized; the default is documented so a downstream re-mapping is straightforward |
| CWE inference table (deterministic rule-id-keyword → CWE) | Emit empty string when metadata absent; emit `null`; raise an error and fail | User directive (AAP §0.1.1, verbatim): "If absent, use the most specific CWE inferable from the rule description." A deterministic keyword table makes the inference auditable, the inverse of the alternatives which would either lose evidence or break the pipeline | New rule names without keyword-table coverage fall back to `CWE-693` (Protection Mechanism Failure); the full table is reproduced in §CWE Inference Table for auditability |
| Append exactly one trailing newline `\n` to `findings-config-b.json` | No trailing newline (write JSON only); write CRLF; write two newlines | User Directive 3 pass/fail (verbatim): `cat findings-config-b.json | wc -l` returns `1`. POSIX `wc(1)` counts newline characters — exactly one `\n` is required for the check to evaluate to `1`. Zero newlines would yield `wc -l == 0` and fail | A consumer expecting byte-equality with no terminator would need to strip the trailing newline |
| Use Python `json` standard library instead of `jq` | `apt-get install jq`; `pip install pyjq`; vendor a Go JSON binary | Avoids adding a system package (jq is absent in the base image per AAP §0.3.6); Python is already required for Semgrep; `ensure_ascii=False` preserves UTF-8 cleanly without surrogate escaping | None material |
| Reduce multi-location SARIF results to `locations[0]` (first-location-only) | Emit one normalized row per location (multi-row expansion); deduplicate across locations | User schema has a single `file`/`line` per finding; multi-location duplication would violate the schema contract (AAP §0.6.7); first-location-only is the industry-standard SARIF-consumer convention (e.g., SonarQube documents this exact behavior) | A finding with relevant secondary locations loses that context in this artifact; intentional trade-off |
| Strip absolute repository-root prefix from `artifactLocation.uri` to produce relative `file` paths | Keep absolute paths from Semgrep; emit URIs verbatim | Portability: the JSON should be portable across machines (different absolute roots); relative paths align with normal SARIF tooling conventions and the user's verbatim five-field schema where `file` is "SARIF location (relative path)" | None material |
| Truncate `description` via Python string slicing (code-point semantics, `msg[:200]`) | Byte-based truncation (`msg.encode("utf-8")[:200].decode("utf-8", "ignore")`); word-boundary truncation; ellipsis suffix | Code-point slicing preserves valid UTF-8 boundaries; byte truncation can split multi-byte UTF-8 sequences producing invalid output. The user spec says "200 characters", not "200 bytes" — characters in Python `str` are code points | A non-ASCII message with ≤ 200 code points but > 200 UTF-8 bytes is still emitted at ≤ 200 characters — this is by design |
| Preserve Semgrep's emission order in `findings-config-b.json` (no re-sorting) | Sort by file then line; sort by severity; sort alphabetically by rule-id | Deterministic ordering against a frozen rule snapshot produces bit-for-bit reproducible output across re-runs (AAP §0.6.7 and §0.9.5 "Idempotence"); re-sorting would add an arbitrary normalization step | A future consumer that expects sorted output would need to sort on their side |
| Pin CDN tooling versions in the executive deck: reveal.js `5.1.0`, Mermaid `11.4.0`, Lucide `0.460.0` | Use `@latest` from CDN; download and vendor locally; use jsDelivr aliases without version | Reproducibility; the Executive Presentation Rule mandates these specific pinned versions; aligns with the broader "everything pinned" principle of the work | Pins age over time; a future deck refresh may need updated pins |
| Place `decision-log.md` at repository root (NOT under `docs/`, `blitzy/`, or `blitzy-docs/`) | Under `docs/`; under `blitzy/documentation/`; under `blitzy-docs/`; alongside the deck in `blitzy-deck/` | Documents a single atomic scan execution, not a long-lived sprint narrative or product doc; root placement matches the deliverable's discoverability and downstream-harness expectations (per AAP §0.3.4) | None material |
| Append two rule-mandated files beyond the user's "1 new file" tally | Refuse the rules; ignore the tally without comment; emit a warning but proceed without producing the rule-mandated artifacts | AAP RULE-DRIVEN SCOPE principle: rule-mandated files MUST be in scope; the tally is reconciled in §Scope Reconciliation above as a directive-count annotation rather than an absolute file-count cap | Reviewers may need to be pointed to §Scope Reconciliation above |
| Omit `--oss-only` from Semgrep invocations | Pass `--oss-only` defensively on every command | The flag is only needed when Semgrep Pro is enabled (AAP §0.9.3); in a clean pip-install environment with no `semgrep login`, the OSS engine is already the default. Adding the flag would be a no-op | If a future environment has Pro enabled (after a `semgrep login`), the flag MUST be added |
| Use the Semgrep `--dryrun` flag (no hyphen) for the Directive 1 preflight, despite the user directive verbatim form being `--dry-run` | Update the Semgrep version; refuse to run the preflight and document it as not-applicable; patch Semgrep | Semgrep `1.163.0` CLI accepts `--dryrun` (per `semgrep scan --help`) and does NOT accept `--dry-run`. The semantic intent of the user directive is preserved exactly; only the spelling differs. Documented here to avoid a defect-by-misreading | A future Semgrep version may add `--dry-run` as an alias; the documented spelling will then be ambiguous |
| Read severity from `runs[0].tool.driver.rules[i].defaultConfiguration.level` (rule-level lookup), not from the per-result `level` field | Use `result.level` directly; default everything to a fixed value; query the rule registry online | Empirical inspection of Semgrep `1.163.0` SARIF output shows individual results do NOT carry a `level` field; the canonical level is on the rule's `defaultConfiguration.level`. Reading from the per-result `level` would yield zero categorization (all findings would fall through to the default) | If a future Semgrep release moves `level` onto results, the lookup logic still works (result-level takes precedence if present; rule-level is the documented fallback) |
| Use the rule's `properties.tags` array as a secondary CWE source when `properties.cwe` is absent | Use only `properties.cwe`; only use the inference table when `properties.cwe` is absent | Empirical inspection shows Semgrep encodes CWE values as elements of `properties.tags` (e.g., `"CWE-95: Improper Neutralization..."`) rather than as a dedicated `properties.cwe` array. The extractor parses the first `CWE-NNN` token from the tags before falling back to the inference table; this is more precise than inference for most findings | Tag format may change in future Semgrep versions; the extractor falls back to inference if the regex does not match |
| Scan the entire repository root (.) rather than a subset of `apps/` and `packages/` | Scan only `apps/`; scan only `packages/`; scan with custom `--include` globs | User Directive 2 specifies the target as `/path/to/blitzy-cal`, which AAP §0.1.3 resolves to the repository root because "The literal path placeholders... resolve to concrete locations." Scanning the root respects `.semgrepignore` automatically (Semgrep skipped 402 files matching those patterns) | None material; the natural ignore-semantics of git-tracked-only scanning protect against noise |
| Persist the rule-pack snapshot timestamp to `/tmp/semgrep-rules/.snapshot-timestamp` and reflect it here | Embed the timestamp only in this file; embed it in `findings-config-b.json`; derive it on-demand from `stat` | Side-channel persistence makes the snapshot date discoverable from the cache directory itself, enabling diagnostic reads without parsing this markdown. Embedding in `findings-config-b.json` would violate the closed five-field schema (AAP §0.9.2) | The file lives in `/tmp/` and is lost across container restarts; the canonical record remains this section |

## CWE Inference Table

The table below is the deterministic keyword → CWE mapping used by the SARIF normalization step when a rule's metadata does not carry an explicit CWE. The table is reproduced here verbatim from AAP §0.6.4 so that reviewers can audit the inference without cross-referencing the agent prompts.

| Rule-ID / description keyword | Inferred CWE |
| --- | --- |
| `sql-injection`, `sequelize-injection`, `sql.*injection` | `CWE-89` |
| `xss`, `cross-site-scripting`, `dom-based-xss` | `CWE-79` |
| `command-injection`, `os-command`, `spawn-process` | `CWE-78` |
| `path-traversal`, `directory-traversal`, `zip-slip` | `CWE-22` |
| `ssrf` | `CWE-918` |
| `xxe`, `xml-external-entities` | `CWE-611` |
| `open-redirect` | `CWE-601` |
| `weak-crypto`, `weak-cipher`, `insecure-cipher`, `md5`, `sha1` | `CWE-327` |
| `weak-rsa`, `weak-key` | `CWE-326` |
| `hardcoded-secret`, `hardcoded-jwt`, `hardcoded-token`, `hardcoded-key` | `CWE-798` |
| `hardcoded-password` | `CWE-259` |
| `insecure-randomness`, `weak-random` | `CWE-338` |
| `prototype-pollution` | `CWE-1321` |
| `regex-injection`, `redos` | `CWE-1333` |
| `unsafe-deserialization`, `deserialization` | `CWE-502` |
| `eval`, `dynamic-code`, `code-injection` | `CWE-94` |
| `log-injection` | `CWE-117` |
| `missing-auth`, `improper-auth` | `CWE-287` |
| `missing-authz`, `broken-access-control` | `CWE-285` |
| `csrf` | `CWE-352` |
| (no match) | `CWE-693` (fallback: Protection Mechanism Failure) |

**Matching semantics:** Match order is top-to-bottom; first match wins. Matches are case-insensitive against the concatenation of `rule_id` and SARIF `shortDescription.text` (and `fullDescription.text` when present). When the rule's `properties.tags` array contains a `CWE-NNN` token (as is the case for most Semgrep Registry rules), that explicit CWE takes precedence over the inferred value and the inference table is not consulted.

## Severity Mapping

The table below reproduces the user-supplied verbatim severity mapping from Directive 3 (AAP §0.6.3).

| SARIF level | Normalized severity |
| --- | --- |
| `error` | `critical` |
| `warning` | `high` |
| `note` | `medium` |
| `info` | `low` |

**Default for `none` or unrecognized level:** `low`. Rationale: AAP §0.6.3 — preserves evidence rather than discarding the finding. Documented as a "Risk" row in the §Decision Table. The standard SARIF 2.1.0 specification defines `error`, `warning`, `note`, and `none`; Semgrep additionally emits `info` for its lowest-confidence rule tier. The mapping is exhaustive over all four Semgrep-emitted levels and degrades safely for the rare SARIF `none` case.

## Verification Commands

The commands below were used to evaluate the three user-supplied pass/fail criteria. Each command is reproduced as it was actually run (with concrete paths substituted for the user's placeholders).

**Directive 1 pass/fail (verbatim):** `semgrep scan --metrics=off --config=/path/to/local-rules --dry-run` exits 0 with no network calls.

Implementation (note `--dryrun` spelling per Decision Table row "Use the Semgrep `--dryrun` flag..."):

```
semgrep scan --metrics=off --config=/tmp/semgrep-rules --dryrun .
# Expected: exit code 0
# Expected: no network calls (telemetry self-report:
#   "Not sending pseudonymous metrics since metrics are configured to OFF,
#    registry usage is False, and login status is False")
```

**Directive 2 pass/fail (verbatim):** `results-semgrep.sarif` is produced and contains valid JSON with a `runs` array.

Implementation:

```
semgrep scan --config=/tmp/semgrep-rules --sarif -o results-semgrep.sarif --metrics=off .
# Expected: results-semgrep.sarif exists
python3 -m json.tool < results-semgrep.sarif > /dev/null
# Expected: exit code 0 (valid JSON)
python3 -c "import json,sys; d=json.load(open('results-semgrep.sarif')); assert isinstance(d.get('runs'), list)"
# Expected: exit code 0 (runs is a list)
```

**Directive 3 pass/fail (verbatim):** `cat findings-config-b.json | wc -l` returns `1`. Valid JSON. Every finding has all 5 fields populated. No description exceeds 200 characters.

Implementation:

```
cat findings-config-b.json | wc -l
# Expected: 1
python3 -m json.tool < findings-config-b.json > /dev/null
# Expected: exit code 0 (valid JSON)
python3 -c "import json; d=json.load(open('findings-config-b.json')); assert all(set(x.keys())=={'file','line','severity','cwe','description'} for x in d)"
# Expected: exit code 0 (every element has exactly the five required keys)
python3 -c "import json; d=json.load(open('findings-config-b.json')); assert all(len(x['description'])<=200 for x in d)"
# Expected: exit code 0 (no description exceeds 200 characters)
```

## Traceability Matrix Applicability

The Explainability Rule body states: "For migrations or refactors, include a bidirectional traceability matrix mapping source constructs to target implementations — 100% coverage, no gaps."

This sentence does **not** apply to the present work. Config B is a **security scan**, not a migration or refactor:

- There is no source-construct ↔ target-implementation mapping because no source constructs are being translated, replaced, or refactored.
- No application code in `apps/`, `packages/`, `scripts/`, or any other workspace is read for mutation. Semgrep walks the source tree as a read-only scan input.
- No project dependency manifest is altered. `package.json`, `yarn.lock`, `.yarnrc.yml`, `turbo.json`, and every workspace manifest remain untouched.
- The pipeline's transformations are entirely **additive**: it creates four new deliverables (`findings-config-b.json`, this `decision-log.md`, `blitzy-deck/executive-summary-config-b.html`, `blitzy-deck/references/blitzy-reveal-theme.css`) and three transient working artifacts (`results-semgrep.sarif` and the three cached rule packs under `/tmp/semgrep-rules/`).

The omission is therefore intentional and explicit per this section. Recording it here is the correct discharge of the rule body's clause, exactly as the rule itself anticipates ("Any deviation from a literal or obvious interpretation of the requirements MUST have an explicit entry in the decision log."). The relevant Decision Table row that documents this omission as a non-deviation is implicit in the overall framing of the file; reviewers reading top-to-bottom will encounter the explanation here rather than as a one-line table entry, because the explanation requires more context than a single table cell can carry.
