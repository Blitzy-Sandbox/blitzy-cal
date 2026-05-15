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
- **Pipeline-evidence / reviewability files (retained at repository root rather than in `/tmp/` to satisfy Code-Review-Agent traceability requirements):**
  - `results-semgrep.sarif` — raw SARIF 2.1.0 output of the Directive 2 scan command; retained at repository root as the canonical evidence artifact backing every entry in `findings-config-b.json`
  - `normalize-sarif.py` — the Python normalization script that converts `results-semgrep.sarif` → `findings-config-b.json`; committed at repository root so reviewers can audit SARIF parsing, severity mapping, CWE extraction/inference, UTF-8-safe truncation, first-location-only behaviour, emission-order preservation, fail-fast error handling, multiple-run iteration, and stdlib-only imports without relying on transient command transcripts
- **Transient files (produced and consumed within the pipeline; not committed):**
  - `/tmp/semgrep-rules/security-audit.yml`, `/tmp/semgrep-rules/secrets.yml`, `/tmp/semgrep-rules/owasp.yml` — locally cached Semgrep Registry rule packs

Per the **AAP RULE-DRIVEN SCOPE principle** ("Files required by user-specified rules MUST be included in the files-in-scope section, even if not explicitly mentioned in the user's feature/bug description"), the rule-mandated files take precedence over the user's tally. The annotation `1 new file` is treated as a directive-count annotation rather than an absolute file-count cap. The Explainability Rule itself requires this conflict and its resolution to be recorded here — the rule is, in this sense, self-justifying. The two pipeline-evidence files (`results-semgrep.sarif`, `normalize-sarif.py`) are retained under the same RULE-DRIVEN SCOPE principle: a separate AAP-aligned auditability obligation makes the SARIF source-of-truth and the normalizer implementation reviewable, which was identified as a CRITICAL/MAJOR gap by the Code Review Agent and resolved here.

## Pipeline Observability Record

This section records the three values mandated by Directive 2 (verbatim: "Record exit code, scan duration (wall-clock), and total files scanned") plus the severity breakdown of the normalized findings, the rule-pack snapshot timestamp (so the corpus state is reproducible), the verified Semgrep version, and the absolute repository path under scan.

| Metric                                     | Value                                                             |
| ------------------------------------------ | ----------------------------------------------------------------- |
| Semgrep exit code                          | `0`                                                               |
| Wall-clock scan duration (milliseconds)    | `84941` (≈ 84.9 seconds)                                          |
| Total files scanned (targets)              | `10015`                                                           |
| Rules run                                  | `379` (subset of `820` cached rules applicable to detected languages) |
| Rules emitted in SARIF `tool.driver.rules` | `709`                                                             |
| Total findings                             | `32`                                                              |
| Critical findings (severity `critical`)    | `12`                                                              |
| High findings (severity `high`)            | `20`                                                              |
| Medium findings (severity `medium`)        | `0`                                                               |
| Low findings (severity `low`)              | `0`                                                               |
| Rule-pack snapshot timestamp (UTC ISO8601) | `2026-05-15T02:43:55Z`                                            |
| Semgrep version verified                   | `1.163.0`                                                         |
| Repository scanned (absolute path)         | `/tmp/blitzy/blitzy-cal/blitzy-50d10468-0a6d-4f8f-8328-31a7552d746d_2caaf7` |
| Files skipped (size > 1 MB)                | `36`                                                              |
| Files skipped (`.semgrepignore` patterns)  | `402`                                                             |
| Telemetry self-report                      | `Not sending pseudonymous metrics since metrics are configured to OFF, registry usage is False, and login status is False` |
| Rule-pack file sizes                       | `owasp.yml` 1,412,462 bytes / `secrets.yml` 87,683 bytes / `security-audit.yml` 473,426 bytes |
| Rule-pack rule counts                      | `owasp` 544 rules / `secrets` 51 rules / `security-audit` 225 rules / total `820` |

All three user pass/fail gates were evaluated against the artifacts retained at repository root (`results-semgrep.sarif` and `findings-config-b.json`), and all three passed:

1. **Directive 1 pass/fail** — `semgrep scan --metrics=off --config=/tmp/semgrep-rules --dryrun /tmp/blitzy/blitzy-cal/blitzy-50d10468-0a6d-4f8f-8328-31a7552d746d_2caaf7` exited `0` with the telemetry self-report confirming no network calls. The self-report string is captured verbatim in the table above.
2. **Directive 2 pass/fail** — `results-semgrep.sarif` was produced by the Directive 2 scan command (run with the concrete absolute repository path substituted for `/path/to/blitzy-cal`); the artifact is retained at repository root for review; `python3 -m json.tool < results-semgrep.sarif` exits `0`; `python3 -c "import json; d=json.load(open('results-semgrep.sarif')); assert isinstance(d.get('runs'), list)"` exits `0`; `data["runs"]` is a list of length `1` containing `32` results.
3. **Directive 3 pass/fail** — `findings-config-b.json` is produced from `results-semgrep.sarif` by the committed `normalize-sarif.py` script; `cat findings-config-b.json | wc -l` returns `1`; `python3 -m json.tool < findings-config-b.json` exits `0`; every one of the `32` findings has exactly the five required keys (`file`, `line`, `severity`, `cwe`, `description`); no description exceeds `200` characters (the longest is at most 200 code points, enforced by the normalizer's `msg[:200]` slice).

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
| Append exactly one trailing newline `\n` to `findings-config-b.json` | No trailing newline (write JSON only); write CRLF; write two newlines | User Directive 3 pass/fail (verbatim): `cat findings-config-b.json \| wc -l` returns `1`. POSIX `wc(1)` counts newline characters — exactly one `\n` is required for the check to evaluate to `1`. Zero newlines would yield `wc -l == 0` and fail | A consumer expecting byte-equality with no terminator would need to strip the trailing newline |
| Use Python `json` standard library instead of `jq` | `apt-get install jq`; `pip install pyjq`; vendor a Go JSON binary | Avoids adding a system package (jq is absent in the base image per AAP §0.3.6); Python is already required for Semgrep; `ensure_ascii=False` preserves UTF-8 cleanly without surrogate escaping | None material |
| Reduce multi-location SARIF results to `locations[0]` (first-location-only) | Emit one normalized row per location (multi-row expansion); deduplicate across locations | User schema has a single `file`/`line` per finding; multi-location duplication would violate the schema contract (AAP §0.6.7); first-location-only is the industry-standard SARIF-consumer convention (e.g., SonarQube documents this exact behavior) | A finding with relevant secondary locations loses that context in this artifact; intentional trade-off |
| Strip absolute repository-root prefix from `artifactLocation.uri` to produce relative `file` paths | Keep absolute paths from Semgrep; emit URIs verbatim | Portability: the JSON should be portable across machines (different absolute roots); relative paths align with normal SARIF tooling conventions and the user's verbatim five-field schema where `file` is "SARIF location (relative path)" | None material |
| Truncate `description` via Python string slicing (code-point semantics, `msg[:200]`) | Byte-based truncation (`msg.encode("utf-8")[:200].decode("utf-8", "ignore")`); word-boundary truncation; ellipsis suffix | Code-point slicing preserves valid UTF-8 boundaries; byte truncation can split multi-byte UTF-8 sequences producing invalid output. The user spec says "200 characters", not "200 bytes" — characters in Python `str` are code points | A non-ASCII message with ≤ 200 code points but > 200 UTF-8 bytes is still emitted at ≤ 200 characters — this is by design |
| Preserve Semgrep's emission order in `findings-config-b.json` (no re-sorting) | Sort by file then line; sort by severity; sort alphabetically by rule-id | Deterministic ordering against a frozen rule snapshot produces bit-for-bit reproducible output across re-runs (AAP §0.6.7 and §0.9.5 "Idempotence"); re-sorting would add an arbitrary normalization step | A future consumer that expects sorted output would need to sort on their side |
| Pin CDN tooling versions in the executive deck: reveal.js `5.1.0`, Mermaid `11.4.0`, Lucide `0.460.0` | Use `@latest` from CDN; download and vendor locally; use jsDelivr aliases without version | Reproducibility; the Executive Presentation Rule mandates these specific pinned versions; aligns with the broader "everything pinned" principle of the work | Pins age over time; a future deck refresh may need updated pins |
| Place `decision-log.md` at repository root (NOT under `docs/`, `blitzy/`, or `blitzy-docs/`) | Under `docs/`; under `blitzy/documentation/`; under `blitzy-docs/`; alongside the deck in `blitzy-deck/` | Documents a single atomic scan execution, not a long-lived sprint narrative or product doc; root placement matches the deliverable's discoverability and downstream-harness expectations (per AAP §0.3.4) | None material |
| Append three rule-mandated files beyond the user's "1 new file" tally (`decision-log.md`, `blitzy-deck/executive-summary-config-b.html`, `blitzy-deck/references/blitzy-reveal-theme.css`) | Refuse the rules; ignore the tally without comment; emit a warning but proceed without producing the rule-mandated artifacts | AAP RULE-DRIVEN SCOPE principle: rule-mandated files MUST be in scope; the tally is reconciled in §Scope Reconciliation above as a directive-count annotation rather than an absolute file-count cap | Reviewers may need to be pointed to §Scope Reconciliation above |
| Omit `--oss-only` from Semgrep invocations | Pass `--oss-only` defensively on every command | The flag is only needed when Semgrep Pro is enabled (AAP §0.9.3); in a clean pip-install environment with no `semgrep login`, the OSS engine is already the default. Adding the flag would be a no-op | If a future environment has Pro enabled (after a `semgrep login`), the flag MUST be added |
| Use the Semgrep `--dryrun` flag (no hyphen) for the Directive 1 preflight, despite the user directive verbatim form being `--dry-run` | Update the Semgrep version; refuse to run the preflight and document it as not-applicable; patch Semgrep | Semgrep `1.163.0` CLI accepts `--dryrun` (per `semgrep scan --help`) and does NOT accept `--dry-run`. The semantic intent of the user directive is preserved exactly; only the spelling differs. Documented here to avoid a defect-by-misreading | A future Semgrep version may add `--dry-run` as an alias; the documented spelling will then be ambiguous |
| Read severity from `runs[0].tool.driver.rules[i].defaultConfiguration.level` (rule-level lookup), not from the per-result `level` field | Use `result.level` directly; default everything to a fixed value; query the rule registry online | Empirical inspection of Semgrep `1.163.0` SARIF output shows individual results do NOT carry a `level` field; the canonical level is on the rule's `defaultConfiguration.level`. Reading from the per-result `level` would yield zero categorization (all findings would fall through to the default) | If a future Semgrep release moves `level` onto results, the lookup logic still works (result-level takes precedence if present; rule-level is the documented fallback) |
| Use the rule's `properties.tags` array as a secondary CWE source when `properties.cwe` is absent | Use only `properties.cwe`; only use the inference table when `properties.cwe` is absent | Empirical inspection shows Semgrep encodes CWE values as elements of `properties.tags` (e.g., `"CWE-95: Improper Neutralization..."`) rather than as a dedicated `properties.cwe` array. The extractor parses the first `CWE-NNN` token from the tags before falling back to the inference table; this is more precise than inference for most findings | Tag format may change in future Semgrep versions; the extractor falls back to inference if the regex does not match |
| Scan the entire repository root (.) rather than a subset of `apps/` and `packages/` | Scan only `apps/`; scan only `packages/`; scan with custom `--include` globs | User Directive 2 specifies the target as `/path/to/blitzy-cal`, which AAP §0.1.3 resolves to the repository root because "The literal path placeholders... resolve to concrete locations." Scanning the root respects `.semgrepignore` automatically (Semgrep skipped 402 files matching those patterns) | None material; the natural ignore-semantics of git-tracked-only scanning protect against noise |
| Persist the rule-pack snapshot timestamp to `/tmp/semgrep-rules/.snapshot-timestamp` and reflect it here | Embed the timestamp only in this file; embed it in `findings-config-b.json`; derive it on-demand from `stat` | Side-channel persistence makes the snapshot date discoverable from the cache directory itself, enabling diagnostic reads without parsing this markdown. Embedding in `findings-config-b.json` would violate the closed five-field schema (AAP §0.9.2) | The file lives in `/tmp/` and is lost across container restarts; the canonical record remains this section |
| Commit `results-semgrep.sarif` to the repository root as retained pipeline evidence, as-produced by Semgrep with the absolute target path | Treat the SARIF strictly as a transient `/tmp/` artifact per AAP §0.4.2 "retained for evidence but not strictly required to be committed"; commit only a SHA-256 fingerprint of the SARIF; commit a redacted/path-stripped excerpt | The Code Review Agent identified the missing SARIF as a CRITICAL traceability gap blocking Directive 2 pass/fail revalidation and source-to-normalized-finding traceability. AAP §0.4.2 explicitly contemplates retention "for evidence"; the strongest form of retention is in-repo committal. The SARIF is committed exactly as produced by the verbatim Directive 2 command (with the absolute repository path as target). It is intentionally NOT scrubbed: editing the SARIF would break bit-for-bit reproducibility against the documented command, and the path-stripping responsibility belongs to the normalizer (Decision Table row "Strip absolute repository-root prefix from `artifactLocation.uri`..."). The SARIF contains no secrets, credentials, API keys, token values, or email-like PII — only repository file paths, line numbers, and Semgrep rule findings | The SARIF grows the repository by ~1.4 MB; result-location URIs are absolute (matching the verbatim Directive 2 command) and are stripped by the normalizer to produce relative paths in `findings-config-b.json`; rule-pack drift on future re-runs may produce a different SARIF, which would diff against the committed one (this is the intended reproducibility signal) |
| Commit `normalize-sarif.py` to the repository root for auditability | Keep the normalizer as an inline-pasted command transcript in this decision log; keep it as a one-off shell script in `/tmp/`; embed the normalizer in the SARIF tool driver | The Code Review Agent identified the absent normalizer implementation as a MAJOR reviewability gap. AAP §0.6.1 stage E and §0.6.2 explicitly contemplate "a Python normalization script" — committing it is the natural discharge of that contemplation. A committed script is auditable for SARIF parsing, severity mapping (rule `defaultConfiguration.level`), CWE extraction (`properties.cwe` → `properties.tags`) and inference, UTF-8-safe code-point truncation, first-location-only reduction, Semgrep emission-order preservation, fail-fast error handling, multi-run iteration, and stdlib-only imports. Comments in the script are limited to terse mechanical descriptions per AAP §0.9.5 (the Explainability Rule reserves "why" rationale to this document) | The script becomes part of the audit surface; future divergence between the script's actual behaviour and this document's documented behaviour would be a defect (both must change together) |
| Upgrade Mermaid CDN pin from `11.4.0` (AAP §0.8.2 literal) to `11.10.0` (smallest patched version) | Keep the literal `11.4.0` pin and obtain an explicit security waiver; downgrade further (e.g. pre-11.x); switch to a non-Mermaid diagram library | The literal AAP pin (`11.4.0`) is affected by CVE-2025-54881 (XSS via `calculateMathMLDimensions` / sequence-diagram labels passed to `innerHTML`) and CVE-2025-54880 (XSS via architecture-diagram `iconText` passed to d3 `html()`). The Snyk and NVD advisories both list the affected range as `>=10.9.0-rc.1, <11.10.0` (CVE-2025-54881) and `>=11.1.0, <11.10.0` (CVE-2025-54880). Both are fixed in `11.10.0`. AAP §0.9.4 (final acceptance) and the AAP Compliance Matrix item "Dependencies pinned and free of known vulnerabilities" require dependencies be free of known vulnerabilities. The two requirements directly conflict; per the Explainability Rule ("Any deviation from a literal or obvious interpretation of the requirements MUST have an explicit entry in the decision log"), this row records the deviation. `11.10.0` is the minimum patched version, keeping the pin as close to the AAP literal as possible while satisfying the security gate. The deck's Mermaid content is fully static (no user-supplied input flows into Mermaid), so practical exploitability in this deck is nil; the fix is required by the AAP's security gate, not by exploitation likelihood. Other CDN pins (reveal.js `5.1.0`, Lucide `0.460.0`) remain at the AAP literal — only Mermaid is uplifted | The diagram rendering may exhibit minor visual differences between `11.4.0` and `11.10.0` (the diff between the two versions is small per the upstream changelog, but not strictly zero). Future deck re-runs MUST also pin to `>= 11.10.0` until / unless the AAP literal is updated or a newer Mermaid CVE forces another bump |
| Remove the 16 visual-verification PNG screenshots under `blitzy/screenshots/deck_slide_*.png` and `blitzy/screenshots/blitzy_reveal_theme_smoke_default_and_slide_title.png` that were added during checkpoint verification | Retain the screenshots and update the AAP/scope to include them; move them under `blitzy-deck/` (still adds files in a checkpoint diff); commit a single composite contact-sheet image | The Code Review Agent flagged the 16 screenshots as a CRITICAL scope-creep finding: AAP §0.4.3 lists `blitzy/**` as explicitly out-of-scope, and the checkpoint scope listed only `blitzy-deck/executive-summary-config-b.html` and `blitzy-deck/references/blitzy-reveal-theme.css` as new committed files. The screenshots were produced as transient verification artifacts during the Phase 3 visual comparison check; they were never intended for committal. Removing them aligns the repository state with the AAP scope and with the "Slide 9 / Core AAP Deliverables" KPI on the executive deck | Future visual-regression checks must produce screenshots out-of-tree (e.g. ephemeral files in `/tmp/`) and must not commit them; the AAP can be updated if a screenshot retention policy is later required |
| Restate Slide 9 KPI from "New Files Committed" to "Core AAP Deliverables" and add `blitzy-deck/` to the section intro's location list | Keep the original wording and accept the inaccuracy; remove all out-of-scope files so that "New Files Committed" once again matches `4`; reword as "Repository Additions" with a true total count | The Code Review Agent flagged the original Slide 9 wording as factually misleading: the four counted items are the core AAP deliverables but not the only files added since the Checkpoint 1 baseline (two pipeline-evidence files — `results-semgrep.sarif` and `normalize-sarif.py` — are also retained at the repository root for auditability per the rows above). Two of the four deliverables are under `blitzy-deck/`, not the repository root. The chosen rewording uses "Core AAP Deliverables" so the KPI value `4` remains accurate against the AAP §0.1.4 / §0.7.1 deliverable list, while the footnote explicitly enumerates the four core deliverables and the two retained pipeline-evidence files | Leadership consuming the slide must read the footnote to see the auditability files; the KPI alone does not surface them. The trade-off favours a clean primary KPI plus a faithful footnote over a noisier headline |
| Make `blitzy-deck/references/blitzy-reveal-theme.css` the authoritative source of truth and inline a functionally equivalent copy into the deck's `<style>` block | Keep two slightly-different stylesheets (the current state at Checkpoint 2 review); reference the canonical file via `<link rel="stylesheet">` instead of inlining; remove the canonical file entirely | The Code Review Agent flagged a MAJOR equivalence finding: the inlined deck CSS and the canonical CSS differed in selector scoping (`.slide-title` vs `.reveal .slide-title`), values (`.kpi-grid` margin `1.5rem 0` vs `2rem 0`, `.accent-bar` width `220px` vs `width:100%; max-width:480px`), and completeness (the canonical CSS was missing `.comparison-note`, `.critical/.high/.medium/.low`, `.footnote`, `.section-intro`, `.severity-pill`, `.step-card/.step-grid/.step-icon/.step-label/.step-number`, `.table-emphasis`, and `.icon-row`). The AAP §0.8.2 requires a "single source of truth" canonical theme; an inline `<link>` would defeat the AAP "self-contained HTML" property. Choosing the canonical file as source of truth and inlining a verbatim copy preserves both properties simultaneously | Future edits MUST update both files together; the synchronization is enforced by the visual-equivalence checks in the validation phase and by the explicit comment block at the top of both copies |
| Add column-width and inline-icon utility classes (`.col-w-N`, `.inline-icon-sm`, `.brand-icon`, `.accent-bar.accent-bar--wide`) to replace 17 ad-hoc `style="..."` attributes on `<th>`, `<i>`, and `<div>` elements | Keep the inline attributes; replace each with a unique class per element; emit per-element CSS rules with attribute selectors | The Code Review Agent flagged inline `style=""` attributes as a MINOR maintainability finding (AAP §0.8.2 mandates a class-based theme system; inline overrides bypass it). Choosing reusable utility classes (one for each percentage width 8/14/18/25/30/35/38/40/42/50, one each for the two icon sizes, one `.accent-bar--wide` variant) keeps the canonical theme system as the single source of styling truth without exploding the CSS surface to one rule per element | Future contributors must learn the utility palette; the README-style intent is captured in the comments above the utility blocks in both stylesheets |

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

Implementation (note `--dryrun` spelling per Decision Table row "Use the Semgrep `--dryrun` flag..."; the user placeholders `/path/to/local-rules` and `/path/to/blitzy-cal` are resolved to the concrete absolute paths `/tmp/semgrep-rules` and `/tmp/blitzy/blitzy-cal/blitzy-50d10468-0a6d-4f8f-8328-31a7552d746d_2caaf7` per AAP §0.1.3 "literal path placeholders resolve to concrete locations"):

```
semgrep scan --metrics=off --config=/tmp/semgrep-rules --dryrun /tmp/blitzy/blitzy-cal/blitzy-50d10468-0a6d-4f8f-8328-31a7552d746d_2caaf7
# Expected: exit code 0
# Expected: no network calls (telemetry self-report:
#   "Not sending pseudonymous metrics since metrics are configured to OFF,
#    registry usage is False, and login status is False")
```

**Directive 2 pass/fail (verbatim):** `results-semgrep.sarif` is produced and contains valid JSON with a `runs` array.

Implementation (the user's literal `/path/to/blitzy-cal` is resolved to the concrete absolute repository root per AAP §0.1.3; the flag ordering reproduces AAP §0.1.1 Directive 2 verbatim — `--config`, `--sarif`, `-o`, `--metrics=off`, target):

```
semgrep scan --config=/tmp/semgrep-rules --sarif -o results-semgrep.sarif --metrics=off /tmp/blitzy/blitzy-cal/blitzy-50d10468-0a6d-4f8f-8328-31a7552d746d_2caaf7
# Expected: results-semgrep.sarif exists at repository root
python3 -m json.tool < results-semgrep.sarif > /dev/null
# Expected: exit code 0 (valid JSON)
python3 -c "import json,sys; d=json.load(open('results-semgrep.sarif')); assert isinstance(d.get('runs'), list)"
# Expected: exit code 0 (runs is a list)
```

**Directive 3 pass/fail (verbatim):** `cat findings-config-b.json | wc -l` returns `1`. Valid JSON. Every finding has all 5 fields populated. No description exceeds 200 characters.

Implementation (the normalization step is implemented by the committed `normalize-sarif.py` script — see Decision Table row "Commit `normalize-sarif.py` to the repository root for auditability"):

```
python3 normalize-sarif.py --sarif results-semgrep.sarif --output findings-config-b.json --repo-root /tmp/blitzy/blitzy-cal/blitzy-50d10468-0a6d-4f8f-8328-31a7552d746d_2caaf7
# Expected: writes 32 findings to findings-config-b.json
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
- The pipeline's transformations are entirely **additive**: it creates four new deliverables (`findings-config-b.json`, this `decision-log.md`, `blitzy-deck/executive-summary-config-b.html`, `blitzy-deck/references/blitzy-reveal-theme.css`), one auditable pipeline-implementation script (`normalize-sarif.py`, committed to the repository root per the Decision Table row "Commit `normalize-sarif.py` to the repository root for auditability"), one retained SARIF evidence artifact (`results-semgrep.sarif`, committed to the repository root per the Decision Table row "Commit `results-semgrep.sarif` to the repository root as retained pipeline evidence"), and three transient working artifacts under `/tmp/semgrep-rules/` (`security-audit.yml`, `secrets.yml`, `owasp.yml`).

The omission is therefore intentional and explicit per this section. Recording it here is the correct discharge of the rule body's clause, exactly as the rule itself anticipates ("Any deviation from a literal or obvious interpretation of the requirements MUST have an explicit entry in the decision log."). The relevant Decision Table row that documents this omission as a non-deviation is implicit in the overall framing of the file; reviewers reading top-to-bottom will encounter the explanation here rather than as a one-line table entry, because the explanation requires more context than a single table cell can carry.
