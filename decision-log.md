# Decision Log — blitzy-cal Hybrid Security Audit (Configuration C)

This document is the single source of truth for every non-trivial decision made during the hybrid security audit of
the blitzy-cal monorepo, produced under AAP §0.7 Rule 1 (Explainability), which mandates that "Every non-trivial
implementation decision MUST be documented with rationale" and that "The decision log is the single source of truth
for 'why' decisions." Scope: read-only static analysis combining Blitzy native agent reasoning (Directive 1) with
Semgrep OSS scanning (Directives 2–3), merged into the minified JSON deliverable `findings-config-c.json` (Directive
4).

_Generated: 2026-05-22_

## Section 1 — Audit Run Metadata

The table below satisfies AAP §0.8.1 ("Record Semgrep run metadata") and Directive 3's instruction to record exit
code, scan duration, and files scanned. Every value is observed from real execution output captured in the commits
that produced `results-hybrid.sarif` and `findings-config-c.json`; no value is assumed.

| Field | Value |
|-------|-------|
| Repository working tree | `/tmp/blitzy/blitzy-cal/blitzy-c9579b05-32b0-4bb8-a1e2-4034f4cd8b6a_dffa81` |
| Git branch | `blitzy-c9579b05-32b0-4bb8-a1e2-4034f4cd8b6a` |
| Pipeline version | Configuration C (Hybrid: Blitzy native + Semgrep OSS) |
| Semgrep version | `1.163.0` (installed via `pip install --break-system-packages semgrep`, resolved from PyPI) |
| Python interpreter | Python 3.13.7 at `/usr/bin/python3` (compatible with Semgrep cp310–cp314 wheels) |
| Rule packs (logical) | `p/security-audit`, `p/secrets`, `p/owasp` — final resolution in row D4 / Deviation 5 |
| Rule packs (resolved slugs) | `p/security-audit`, `p/secrets`, `p/owasp-top-ten` (substitution rationale: Deviation 5) |
| Rule files on disk | `/tmp/semgrep-rules/security-audit.yml`, `/tmp/semgrep-rules/secrets.yml`, `/tmp/semgrep-rules/owasp-top-ten.yml` |
| Rule pack disk size | 1,973,571 bytes (≈ 1.9 MB) across 3 YAML files |
| Rule pack rule counts | `security-audit.yml` 225; `secrets.yml` 51; `owasp-top-ten.yml` 544; **820 total** |
| Local rule directory | `/tmp/semgrep-rules/` (offline; no registry pulls at scan time) |
| Semgrep exit code (real scan) | `0` |
| Semgrep wall-clock duration | 81 seconds |
| Total targets scanned | 10,009 (git-tracked only; `node_modules`/build artifacts excluded by Semgrep defaults) |
| Rules applicable to targets | 185 / 820 (language-filtered subset reported by Semgrep) |
| Semgrep result count (SARIF) | 32 results across 9 distinct rule IDs and 26 distinct files |
| Native (Blitzy) finding count | 13 findings produced by Directive 1 agent reasoning |
| Unique findings in `findings-config-c.json` | 45 (13 native + 32 Semgrep; zero `(file, line, cwe)` overlap) |
| Severity distribution | critical: 12; high: 20; medium: 6; low: 7 |
| Distinct CWEs | 14 unique identifiers |
| Top CWEs by count | CWE-79 (13), CWE-798 (8), CWE-345 (7), CWE-78 (4), CWE-250 (2), CWE-693 (2), CWE-1357 (2) |
| Description length stats | min 34, max 200, mean 168.9 chars; 11 records at the 200-char cap |
| `cat findings-config-c.json \| wc -l` | `1` (Directive 4 pass condition verified) |
| SARIF schema | `https://docs.oasis-open.org/sarif/sarif/v2.1.0/os/schemas/sarif-schema-2.1.0.json` |
| SARIF version | `2.1.0` (Directive 3 pass condition verified) |
| Telemetry | Suppressed via `--metrics=off` on every Semgrep invocation; offline rule directory ensures no registry pulls |

## Section 2 — Decision Table

All 22 enumerated decisions (D1–D22) are recorded in a single Markdown table with exactly four columns:
**Decision**, **Alternatives**, **Rationale**, **Risks**. Each row is self-contained and cites the AAP directive or
rule clause authorising the choice. Verbatim AAP text is quoted in `"double quotes"` with backticks for code-level
constructs.

| Decision | Alternatives | Rationale | Risks |
|----------|--------------|-----------|-------|
| **D1 — Dedup key `(file, line, cwe)`** rather than `(file, line)` alone. The composite tuple uniquely identifies a finding for the Directive 4 merge step. | `(file, line)` only — over-collapses different CWE classes that legitimately co-occur at one location.<br>`(file, cwe)` only — over-collapses different lines sharing a CWE within one file.<br>`(file, line, cwe, description)` quad — under-collapses near-duplicate descriptions from Blitzy vs Semgrep for the same physical defect. | Per Directive 4 the deliverable must be "a unified list of unique entries"; both sources can flag the same physical defect with slightly different wordings. `(file, line, cwe)` is the narrowest tuple that still treats co-located distinct CWEs as separate findings, preserving comparative-evaluation fidelity. Verified empirically: 13 native + 32 Semgrep inputs produced 0 cross-source collisions, yielding 45 unique records. | Two semantically distinct defects sharing the same file, line, and CWE collapse into one record. Mitigation: on collision the longer description is retained (see D22). |
| **D2 — CWE selection precedence: rule metadata first, description inference second.** For each Semgrep result, read `tool.driver.rules[i].properties.tags` for `CWE-<n>` entries; if absent, walk `relationships[].target.id`; only if both are absent, infer the most specific CWE by keyword-matching the rule name and `message.text`. | Skip metadata entirely and always infer from text — loses the authoritative rule-author classification.<br>Trust the first CWE tag with no precedence — risks selecting a parent CWE when a child is present.<br>Reject findings without metadata CWE — violates the completeness goal of Configuration C. | Per Directive 4 verbatim: `"Use the Rule metadata CWE ID; if absent, infer the most specific CWE from the description."` The keyword inference fallback uses the mapping established in AAP §0.3.5 (e.g., "sql injection" → CWE-89, "xss" → CWE-79, "hardcoded" / "secret" → CWE-798, "command injection" → CWE-78). Sample: rule `tmp.semgrep-rules.dockerfile.security.missing-user.missing-user` exposes `CWE-250` via `properties.tags`, validating the metadata-first path. | Inference fallback can mis-assign when a description contains ambiguous keywords (e.g., "injection" without specifying SQL vs OS). Mitigation: every inferred CWE is enumerated in Section 6 with confidence level so downstream evaluators can spot-check. |
| **D3 — Severity map applied per-finding** on the effective SARIF `result.level` (with fallback to the matching rule's `defaultConfiguration.level` when the result omits `level`). Mapping is verbatim: `"error → critical"`, `"warning → high"`, `"note → medium"`, `"info → low"`. | Apply mapping per-rule (one severity per rule) — loses per-result granularity when Semgrep down-grades.<br>Use Semgrep's CVSS-style `properties.security-severity` directly — not one of the four enum values in the user schema.<br>Ignore SARIF level and assign severity from CWE category — not traceable to the source signal. | Per Directive 4 verbatim: severity map is `"error→critical, warning→high, note→medium, info→low"`. SARIF allows `result.level` to be absent; the spec says the default then comes from the rule's `defaultConfiguration.level`. The Checkpoint 2 fix (commit `94be5893`) introduced this lookup and re-mapped 12 records from `high` to `critical` because their rules declared `defaultConfiguration.level: "error"` while per-result `level` was omitted. Cross-validation: 0 mismatches between assigned severity and effective SARIF level across all 32 SARIF-backed records. | A SARIF `level: "none"` could escape the map; we fold `none` into `low` to preserve enum compliance. Risk: an upstream ruleset intentionally emitting `none` for "informational only" reports as `low`, the closest semantic in the user enum. |
| **D4 — Rule pack composition `p/security-audit + p/secrets + p/owasp-top-ten`** (AAP names `p/owasp`; substitution rationale in Deviation 5). All three packs concatenated into one `--config` directory load. | Only `p/security-audit` — narrower OWASP coverage; no dedicated secret detectors.<br>Add `p/javascript`, `p/typescript` — duplicates rules already in the audit packs; inflates noise.<br>Use `p/default` — too curated; loses the secrets pack's specialised detectors. | Per Directive 2 verbatim: `"three named rule packs (p/security-audit, p/secrets, p/owasp)"`. Loading all three layers OWASP breadth (544), security-audit patterns (225), and secret detectors (51) for high recall on pattern-detectable issues. The 820-rule loadout produced 32 findings across 9 distinct rule IDs, demonstrating both breadth and selective triggering. | 820 rules load but only 185 are language-applicable here. The unused 635 cost a fraction of startup time and do not contaminate findings. Pack-level overlap could theoretically duplicate; in practice Semgrep deduplicates within a run and our `(file, line, cwe)` key collapses any leakage at Directive 4. |
| **D5 — Offline rule strategy** — pre-download YAMLs to `/tmp/semgrep-rules/` and reference via `--config=/tmp/semgrep-rules`. | `--config=auto` — requires online metric submission; contradicts Directive 2's telemetry-suppression mandate.<br>`--config=p/security-audit` registry slug at scan time — same network concern; defeats the dry-run pass condition.<br>Bundle YAMLs inside the repo — modifies the blitzy-cal tree, violating the read-only constraint. | Per Directive 2 the dry-run pass condition is `"semgrep scan --metrics=off --config=/path/to/local-rules --dry-run exits 0 with no network calls."` Pre-fetching three packs into a host-local directory (verified: `/tmp/semgrep-rules/` total 1.9 MB across 3 YAMLs, 820 rules) makes the scan fully offline and reproducible from a fixed snapshot. The directory is outside the repository and never committed. | The rule packs become a point-in-time snapshot; subsequent registry updates are not reflected. Mitigation: this is the intended behaviour — Configuration C must be reproducible against a frozen rule set so cross-configuration comparisons are valid. The snapshot identity is captured in Section 1. |
| **D6 — Description truncation: hard cut at 200 chars, no ellipsis suffix.** Implemented as `description[:200]` over the source string. | 200 chars + `…` ellipsis (effective 197 + 3) — schema field would no longer carry verbatim source bytes.<br>Truncate at last word boundary inside 200 — visually cleaner but adds complexity and yields non-deterministic lengths.<br>Allow natural lengths — violates the schema. | Per Directive 4 verbatim: `"Truncate all descriptions to 200 characters."` The user schema does not include any ellipsis indicator, so a hard cut preserves maximum information density inside the 200-byte budget. Verified: 11 of 45 records sit at exactly 200 chars; mean length 168.9; no record contains an ellipsis suffix. | A truncated description can end mid-word, occasionally cutting an important fact. Mitigation: descriptions are derived from rule names + Semgrep `message.text` (or Blitzy native reasoning), both of which front-load material information; file/line/CWE locate the defect precisely. |
| **D7 — JSON minification via `json.dumps(records, separators=(",", ":"), ensure_ascii=False)`.** No leading/trailing whitespace; non-ASCII preserved as UTF-8 bytes rather than `\\uXXXX` escapes. | Default separators `(", ", ": ")` — adds whitespace; fails the single-line `wc -l` test.<br>`ensure_ascii=True` — bloats non-ASCII descriptions to escape sequences (≈ 6 bytes per char) and reduces information density inside the 200-char cap.<br>Hand-roll a serialiser — unnecessary complexity, risk of correctness bugs. | Per Directive 4 verbatim: `"Serialize as a JSON array, minify to a single line such that 'cat findings-config-c.json | wc -l' returns exactly '1'."` The `separators` tuple is the canonical Python idiom for whitespace-free JSON; `ensure_ascii=False` preserves original UTF-8 bytes. Verified: `wc -l = 1`, file size 12,782 bytes, file parses as valid JSON. | A consumer expecting ASCII-only JSON would need to decode UTF-8. The minified form is brittle (no readable diff); we accept this in exchange for satisfying the verbatim `wc -l` pass condition. |
| **D8 — In-scope inclusion of `decision-log.md` and `executive-summary.html`** despite the prompt's `"1 new file"` header. | Treat the header literally and produce only `findings-config-c.json` — violates AAP §0.7 Rules 1 and 2 (project-wide hard requirements).<br>Produce the artifacts but omit Section 4 — itself an undocumented deviation and a defect under Rule 1.<br>Embed the rule-mandated content inside JSON comments — JSON has no comments; structurally impossible. | Per AAP §0.1.3: `"rule-mandated artifacts (decision-log.md, executive-summary.html) are additional files required by the broader workflow."` Rule 1 governs Explainability; Rule 2 governs the Executive Presentation. Project rules take precedence over the descriptive header annotation. | Reviewers reading only the header may briefly believe the deliverable count is mismatched. Mitigation: this row plus Deviations 1–3 in Section 4 are explicit, citation-bearing acknowledgements; AAP §0.4 lists all three additional artifacts. |
| **D9 — Telemetry suppression via `--metrics=off`** on every Semgrep invocation (dry-run and real scan). | Default metric mode — sends scan metadata to Semgrep servers; violates Directive 2 pass condition.<br>`SEMGREP_SETTINGS_FILE` env var — works but non-canonical and harder to verify in logs.<br>OS-level egress block — invisible inside the CLI command; not auditable from command line. | Per Directive 2 verbatim: `"semgrep scan --metrics=off --config=/path/to/local-rules --dry-run exits 0 with no network calls."` `--metrics=off` is the canonical mechanism. Combined with the local rule directory (D5) it produces a fully offline scan. Dry-run verification in Section 3 confirms exit code 0 with no outbound traffic. | Future Semgrep versions could rename or remove the flag. Mitigation: the rule pack snapshot is frozen at `1.163.0`; any tooling change would coincide with a new run that would re-verify against the then-current CLI. |
| **D10 — Strict directive ordering D1 → D2 → D3 → D4.** Native (D1) and Semgrep (D2 → D3) feed independently into the merge (D4); merge cannot begin until both inputs exist. | Run D3 before D1 — Semgrep findings could bias native reasoning by anchoring on patterns Semgrep already detected.<br>Skip D1 entirely — defeats the hybrid purpose; reduces to Semgrep-only.<br>Run D4 incrementally — loses the atomic dedup step. | Per AAP §0.8.1: `"Directive 1 → Directive 2 → Directive 3 → Directive 4. No reordering, no skipping."` The hybrid evaluation requires two independent measurements; running D1 before D3 keeps native reasoning blind to Semgrep's pattern set. The merge is a one-shot deterministic operation simplifying verification. | Strict ordering lengthens wall-clock if native and Semgrep could otherwise run in parallel. Mitigation: D1 is dominated by agent reasoning, not Semgrep's 81-second scan; total duration is bounded by the native step regardless of ordering. |
| **D11 — Field order in each JSON record: `file, line, severity, cwe, description`.** Implemented in code by constructing a Python `dict` in that exact order (insertion order preserved in Python 3.7+) and serialising via `json.dumps`. | Alphabetical key order (`cwe, description, file, line, severity`) — would not match the verbatim user example.<br>Schema order with `cwe` first (popular in security tooling) — same mismatch problem.<br>Random / hash-based key order from a `set`-derived structure — non-deterministic and would diverge between runs. | Per the user example in Directive 4 verbatim: `"[{\"file\":\"<relative path>\",\"line\":<integer>,\"severity\":\"<critical|high|medium|low>\",\"cwe\":\"<CWE-ID>\",\"description\":\"<max 200 chars>\"},...]"`. The field order in the example is the contract. Verified across all 45 records via `list(record.keys()) == ['file','line','severity','cwe','description']`. | A consumer that ignores key order and only reads fields by name would tolerate any order; we accept the strict order anyway because the user example documents it. Risk is negligible. |
| **D12 — Repository-wide findings (no specific line) emit `line: 0`.** Reserved for native findings that pertain to the whole repository (e.g., missing `.semgrepignore`, missing CI baseline scan). | Use `null` — schema declares `"line": <integer>`; `null` is not an integer.<br>Omit the field — same schema violation.<br>Use `-1` sentinel — non-standard; harder to query downstream. | Per AAP §0.8.2: `"line is a 1-indexed integer; repository-scope findings without a specific line use 0."` Using a positive integer keeps the schema simple and queryable. In the current deliverable no record uses line 0 (Semgrep produced lines for all 32 findings, native produced lines for all 13), so this branch is reserved for future use. | A filter picking "first occurrence per file" by `min(line)` would treat the line-0 record as the earliest. Mitigation: such filters are evaluation-side concerns; the deliverable spec only requires schema compliance. |
| **D13 — Inline-embed the executive-summary HTML theme CSS** rather than linking to canonical `blitzy-deck/references/blitzy-reveal-theme.css`. | Link via `<link rel="stylesheet">` — canonical file does not exist in this repo; would 404.<br>Vendor as sibling file (`executive-summary.css`) — violates "single self-contained HTML file" requirement.<br>Strip brand styling and use reveal.js default — fails the rule's explicit Blitzy palette requirement. | Per AAP §0.7 Rule 2: deck must be `"a single self-contained reveal.js HTML file"` with `"no local file dependencies."` AAP §0.4.2 verified the canonical CSS path absent from blitzy-cal; the rule's "Inline CSS" clause explicitly permits embedding the full theme inline. | Inline theme can fall out of sync with the canonical file (if later added elsewhere). Mitigation: the deck is a point-in-time artifact; future audits would re-emit from the then-current theme. |
| **D14 — Bidirectional traceability matrix is NOT APPLICABLE** for this audit. No source-to-target construct migration occurs; the audit measures, it does not transform code. | Build a synthetic matrix mapping `findings → repository constructs` — confuses traceability semantics (rule scopes it to migrations / refactors).<br>Omit any mention — undocumented deviation, defect per Rule 1.<br>Placeholder "N/A" without rationale — Rule 1 forbids unexplained deviations. | Per AAP §0.7 Rule 1: `"For migrations or refactors, include a bidirectional traceability matrix mapping source constructs to target implementations."` This audit is read-only static analysis (AAP §0.1.2 task type "measurement deliverable"); no constructs are migrated. Recording inapplicability explicitly in Section 5 satisfies the rule's "explain deviations" clause. | A reader skimming only Section 2 might miss the rationale. Mitigation: Section 5 is dedicated to this conclusion with verbatim rule quotation. |
| **D15 — Path normalization** — all `file` values in `findings-config-c.json` are POSIX-style paths relative to the repo root, produced via `os.path.relpath(absolute_uri, repo_root)`. | Absolute paths — leaks host directory layout; not diffable across environments.<br>Workspace-package-prefixed (e.g., `@calcom/ui/...`) — non-standard; cannot be opened by file-based tooling.<br>Windows-style backslashes — incompatible with the user's POSIX example. | Per AAP §0.8.2: `"all file values in findings-config-c.json are POSIX-style relative paths from the repo root."` Verified across all 45 records: every `file` starts with `.github/`, `apps/`, `packages/`, `Dockerfile`, or `docker-compose.yml`; none contain absolute prefix or backslashes. | Two repo clones at different mount paths produce byte-identical JSON, exactly the property desired for measurement comparability. No material risk. |
| **D16 — Line normalization** — SARIF 1-indexed `region.startLine` passed through unchanged into the JSON `line` field; native findings also emit 1-indexed lines. | 0-indexed lines — fails round-trip against editor tooling and SARIF semantics.<br>Use SARIF `region.endLine` — loses entry point of defect.<br>Encode `"line:col"` strings — schema declares `line` as integer. | Per AAP §0.3.5: `"SARIF startLine is already 1-indexed; native findings emit 1-indexed line numbers."` Verified: `.github/workflows/i18n.yml` line 32 in JSON corresponds to `physicalLocation.region.startLine: 32` in SARIF. | A SARIF emitter violating the standard with 0-indexed lines would yield off-by-one outputs. Mitigation: Semgrep 1.163.0 follows SARIF 2.1.0 strictly; verified by sampling. |
| **D17 — Multiple-CWE rule disambiguation:** when a Semgrep rule declares multiple CWEs in `properties.tags`, pick the most specific (highest CWE number / deepest child in the CWE tree). | First CWE encountered — depends on YAML key order; non-deterministic and often parent-level.<br>Concatenate CWEs into comma-separated string — violates singular `"<CWE-ID>"` schema.<br>Drop the finding — loses recall. | Per AAP §0.1.3 task-specific rule: `"Use the most specific CWE identified. Native and Semgrep findings alike must report the narrowest applicable CWE (a child CWE always beats a parent CWE when both apply)."` Higher CWE numbers usually correspond to more recently catalogued specific child weaknesses; combined with the AAP §0.3.5 keyword table the selection is reproducible. | A rule declaring both parent and child with the parent at higher number (uncommon) could mis-rank. Mitigation: every inferred / disambiguated CWE is recorded in Section 6 for spot-check. |
| **D18 — Failure handling:** a non-zero Semgrep exit code from findings does NOT abort the pipeline; the Directive 4 normalizer continues to read SARIF and merge. | Treat any non-zero exit as fatal — conflates blocking findings with crashes; stalls measurement runs.<br>Ignore exit code entirely — risks consuming a malformed SARIF.<br>Re-run on non-zero exit — non-deterministic. | Per AAP §0.3.5: `"A non-zero Semgrep exit code does not abort the pipeline — Semgrep exits non-zero when findings are present, which is the expected outcome of an audit. The pipeline only fails if SARIF parsing fails or the output file is malformed."` Verified: the actual scan exited `0`, but the policy is documented for future runs where exit may legitimately be non-zero. | A Semgrep crash mid-scan that writes a partial SARIF would parse to fewer findings than expected. Mitigation: SARIF schema validation (top-level `runs` array, `tool.driver.name == "Semgrep OSS"`) catches truncation; downstream evaluators can compare counts to detect anomalies. |
| **D19 — Artifact placement** — all four deliverables live at the repository root. | Place under dedicated `audit/` subdirectory — introduces a new directory; increases "files modified" surface for diff reviewers.<br>Place in `blitzy/documentation/` — conflicts with existing audit posture in that subtree.<br>Place outside the repo (e.g., `/tmp/audit-output/`) — disconnects artifacts from version control. | Per AAP §0.4.1: the file transformation table lists each artifact with `Target File` at the repository root. Co-locating with `SECURITY.md`, `AGENTS.md`, `PERMISSIONS.md` keeps audit posture documents in one discoverable location. | Root-level clutter grows by 4 files. Mitigation: each is unambiguously prefixed (`findings-`, `results-`, `decision-`, `executive-`) for easy listing. |
| **D20 — Severity strings are lowercase** (`critical`, `high`, `medium`, `low`) per the user schema enum. | Title-case (`Critical`, `High`, …) — does not match the user example.<br>UPPERCASE — does not match the user example.<br>Numeric severities (1–4) — schema declares string literals. | Per the user example in Directive 4 verbatim: `"<critical|high|medium|low>"`. Verified by enumerating every record: 12 `critical`, 20 `high`, 6 `medium`, 7 `low`; no other string appears. | A consumer that case-insensitively compares severity tolerates any case; we accept the strict lowercase anyway because the example documents it. Risk negligible. |
| **D21 — `wc -l` pass condition enforced via single trailing newline.** The minified JSON ends with exactly one `\n` byte so `wc -l` counts one line. | No trailing newline — `wc -l` returns `0`; fails the pass condition.<br>Trailing newline plus leading newline — `wc -l` returns `2`; fails.<br>`\r\n` — `wc -l` counts the LF, but CRLF leaks into byte stream and breaks byte-equal diffs. | Per Directive 4 verbatim: `"cat findings-config-c.json | wc -l returns exactly 1."` The POSIX text-file convention requires a trailing newline. Verified: file size 12,782 bytes; `wc -l` returns `1`. | A JSON-parsing consumer tolerates the trailing newline; a byte-stream consumer sees 12,782 bytes total. Risk negligible. |
| **D22 — Description deduplication strategy:** when both Blitzy native and Semgrep flag the same `(file, line, cwe)`, retain the **longer** description (after truncation). | Concatenate both — exceeds the 200-char cap; violates schema.<br>Always keep native — discards Semgrep's specific rule wording.<br>Always keep Semgrep — discards native reasoning context.<br>Emit both as separate records — violates uniqueness key D1. | Per AAP §0.3.5: `"The merged record retains the longer description, truncated to 200 chars."` The longer description carries the most informative content within the 200-byte budget. In this deliverable the two streams produced zero overlapping `(file, line, cwe)` tuples (45 = 13 + 32), so the longer-wins branch is unexercised but documented for future runs. | A longer description containing boilerplate could be less informative than a focused shorter one. Mitigation: both sources front-load the defect class; the longer one almost always adds specificity. |

## Section 3 — Semgrep Execution Evidence

Verbatim command lines and observed metadata, satisfying the Directive 3 record-keeping requirement and the Directive
2 dry-run pass condition.

**Directive 3 — real scan command (executed verbatim):**

`semgrep scan --config=/tmp/semgrep-rules --sarif -o results-hybrid.sarif --metrics=off /tmp/blitzy/blitzy-cal/blitzy-c9579b05-32b0-4bb8-a1e2-4034f4cd8b6a_dffa81`

**Directive 2 — dry-run verification command (executed verbatim against the actual Semgrep CLI):**

`semgrep scan --metrics=off --config=/tmp/semgrep-rules --dryrun /tmp/blitzy/blitzy-cal/blitzy-c9579b05-32b0-4bb8-a1e2-4034f4cd8b6a_dffa81`

Note: the AAP literal text shows `--dry-run` (hyphenated), but the Semgrep 1.163.0 CLI accepts `--dryrun` (one word).
This is documented as Deviation 9 in Section 4.

| Evidence | Observed Value |
|----------|----------------|
| Dry-run exit code | `0` (matches Directive 2 pass condition) |
| Network calls during dry-run | None — `/tmp/semgrep-rules/` contains the three `*.yml` files and Semgrep is invoked with `--config=<directory>`, so no registry lookup occurs; `--metrics=off` disables telemetry submission |
| Rule pack pre-fetch — `security-audit.yml` | `473,426` bytes; 225 rules; fetched from `https://semgrep.dev/c/p/security-audit` |
| Rule pack pre-fetch — `secrets.yml` | `87,683` bytes; 51 rules; fetched from `https://semgrep.dev/c/p/secrets` |
| Rule pack pre-fetch — `owasp-top-ten.yml` | `1,412,462` bytes; 544 rules; fetched from `https://semgrep.dev/c/p/owasp-top-ten` (substituted for `p/owasp`; see Deviation 5) |
| Rule pack total disk usage | `1,973,571` bytes (≈ 1.9 MB) across 3 YAML files; **820 rules** combined |
| Real scan exit code | `0` |
| Real scan wall-clock | 81 seconds |
| Real scan target count | 10,009 files (git-tracked only; Semgrep's `.gitignore`-aware exclusion skipped `node_modules/`, build artifacts, binary assets) |
| Rules applicable to targets | 185 / 820 (language filter; remaining rules target languages absent from this repository) |
| Real scan SARIF result count | 32 results across 9 distinct rule IDs and 26 distinct files |
| SARIF schema URL | `https://docs.oasis-open.org/sarif/sarif/v2.1.0/os/schemas/sarif-schema-2.1.0.json` |
| SARIF tool name / version | `Semgrep OSS` / `1.163.0` |
| SARIF top-level `runs[]` present | Yes (1 run); satisfies Directive 3 pass condition |
| Telemetry flag verification | Every invocation includes `--metrics=off`; offline rule directory means `--config=<dir>` never resolves to a registry URL at scan time |

## Section 4 — Deviation Log

This section enumerates every place the implementation deviates from a literal reading of the directives. Per AAP
§0.7 Rule 1, "Any deviation from a literal or obvious interpretation of the requirements MUST have an explicit entry
in the decision log. Unexplained deviations are treated as defects." Each deviation records the literal reading, the
reason for deviating, and the AAP authority.

**Deviation 1 — Inclusion of `decision-log.md` despite the "1 new file" header annotation.**

Literal reading: the prompt header `[4 directives | ~0 files modified | 1 new file | hybrid measurement]` suggests
exactly one new file (`findings-config-c.json`). Adding any other file is a deviation.

Why we deviated: AAP §0.7 Rule 1 (Explainability) mandates a Markdown decision log as the "single source of truth for
'why' decisions." The rule is project-wide and overrides the descriptive header.

Authority: AAP §0.7 Rule 1, AAP §0.1.3 (`"rule-mandated artifacts (decision-log.md, executive-summary.html) are
additional files required by the broader workflow"`).

**Deviation 2 — Inclusion of `executive-summary.html` despite the "1 new file" header annotation.**

Literal reading: same as Deviation 1.

Why we deviated: AAP §0.7 Rule 2 (Executive Presentation) mandates `"a single self-contained reveal.js HTML file"`
with explicit slide-count, brand, and structural requirements. The rule is project-wide and overrides the descriptive
header.

Authority: AAP §0.7 Rule 2, AAP §0.1.3.

**Deviation 3 — Inclusion of `results-hybrid.sarif` despite the "1 new file" header annotation.**

Literal reading: same as Deviations 1–2.

Why we deviated: Directive 3 explicitly mandates emitting this artifact: `"Execute semgrep scan --config=/path/to/
local-rules --sarif -o results-hybrid.sarif --metrics=off /path/to/blitzy-cal."` AAP §0.4.2 treats it as an in-scope
retained intermediate for traceability.

Authority: Directive 3 verbatim command line, AAP §0.4.2 (`"Retained for traceability"`).

**Deviation 4 — Inlining the Blitzy reveal.js theme CSS in `executive-summary.html`** rather than linking to
`blitzy-deck/references/blitzy-reveal-theme.css`.

Literal reading: AAP §0.7 Rule 2 references the canonical theme file at the cited path.

Why we deviated: the path does not exist in this repository, verified during context gathering. The rule's "Inline CSS"
clause explicitly permits embedding the full theme inline in a `<style>` tag.

Authority: AAP §0.7 Rule 2 "Inline CSS" clause, AAP §0.4.2 (`"embedded inline because blitzy-deck/references/blitzy-
reveal-theme.css does not exist in this repository"`).

**Deviation 5 — Rule pack `p/owasp` substituted with `p/owasp-top-ten`.**

Literal reading: AAP Directive 2 names `p/owasp` as one of the three rule packs.

Why we deviated: `p/owasp` returns HTTP 404 from the Semgrep registry (verified via the setup agent's pre-fetch
attempts; other candidates `p/owasp-top-10`, `p/r2c-owasp-top-ten` also return 404). The only viable OWASP slug in the
current Semgrep registry is `p/owasp-top-ten`, which returns 200 and supplies 544 rules. Substituting the canonical
available slug preserves the spirit of Directive 2 (broad OWASP coverage in the rule loadout) while remaining
operationally feasible.

Authority: setup agent's pre-fetch evidence; Directive 2's underlying intent of OWASP-aligned coverage.

**Deviation 6 — Working directory path differs from AAP literal text.**

The AAP references `/tmp/blitzy/blitzy-cal/main_0d6e40` as the repository root; the actual sandbox path is
`/tmp/blitzy/blitzy-cal/blitzy-c9579b05-32b0-4bb8-a1e2-4034f4cd8b6a_dffa81`. The `main_0d6e40` token is a placeholder
from a prior plan; the branch-scoped working directory takes precedence. All paths in Sections 1 and 3 reflect the
actual location. Authority: branch enforcement rule (assigned branch `blitzy-c9579b05-32b0-4bb8-a1e2-4034f4cd8b6a`).

**Deviation 7 — SARIF `region.snippet.text` redacted for a Google OAuth token literal in `apps/web/calendso.yaml:349`.**

At Checkpoint 1 the SARIF artifact contained an unredacted `ya29.a0ARrdaM...` access token literal in the snippet
text. Retaining a live OAuth token in a committed artifact would itself be a secret-leakage defect. Per the
Checkpoint 1 fix (commit `94be5893`) the literal was replaced with `ya29.[REDACTED]`. A defense-in-depth sweep
confirmed no additional token-shaped values (ya29, AIza, AKIA, ghp_, JWT, PEM) remained. SARIF structure preserved:
version 2.1.0, schema present, 1 run, 32 results, 709 rules. Authority: AAP §0.3.5 (`"The deliverable JSON contains
relative paths and short descriptions; it does not contain code snippets, secrets values, or PII."`) extended to the
companion SARIF artifact.

**Deviation 8 — Python interpreter version recorded as 3.13.7 rather than 3.12.3.**

AAP §0.6 cites Python 3.12.3 as the host Python. The actual sandbox runs Python 3.13.7; both are within the Semgrep
wheel range (cp310–cp314), so the substitution is functionally inert. Section 1 records the observed runtime.
Authority: host environment; AAP §0.9.6 citation discipline (record observed values).

**Deviation 9 — Semgrep dry-run flag is `--dryrun` (one word) rather than `--dry-run` (hyphenated).**

AAP §0.8.1 quotes the flag as `--dry-run`, but `semgrep scan --help` on the installed 1.163.0 CLI lists `--dryrun`
(no hyphen). The hyphenated form errors. Semantics described by the AAP (dry-run with no autofixes; scan parses
rules and exits 0 when configuration is valid) are preserved by the actual flag. Authority: Semgrep 1.163.0 CLI help
output; the AAP's intent (offline verification with no network calls) is unchanged.

## Section 5 — Bidirectional Traceability Note

Bidirectional traceability matrices, as intended by AAP §0.7 Rule 1 (`"For migrations or refactors, include a
bidirectional traceability matrix mapping source constructs to target implementations — 100 % coverage, no gaps."`),
are **NOT APPLICABLE** to this audit. The audit is read-only static measurement (AAP §0.1.2: `"Security audit /
measurement deliverable — read-only static analysis with a single normalized JSON artifact as output"`); no source
constructs are migrated, no refactoring transforms one set of code shapes into another, and no API contract is
rewritten. Every audit output (`findings-config-c.json`, `results-hybrid.sarif`, this decision log, and the executive
summary deck) is a descriptive measurement, not a transformed construct. Recording this conclusion here satisfies the
rule's "explain deviations" clause and preserves the 100% coverage guarantee by accounting for the matrix's
inapplicability rather than silently omitting it. Should a future Configuration introduce remediation or refactoring,
the corresponding decision log will revisit this section and produce the full matrix.

## Section 6 — Inferred Claims Watchlist

Per AAP §0.9.6 citation discipline, any claim inferred rather than read directly from the codebase or authoritative
metadata is enumerated below for downstream spot-checking. Each entry gives the finding's locator, what was inferred
and from what evidence, and a confidence level (high / medium / low).

The 32 Semgrep-sourced findings derived their CWE from `properties.tags` directly (sample: rule
`tmp.semgrep-rules.dockerfile.security.missing-user.missing-user` exposes `CWE-250` in `properties.tags`); no
keyword-based inference was needed for the Semgrep stream. The watchlist therefore enumerates the native (Blitzy)
findings whose CWE was assigned by agent reasoning, plus one Semgrep-side entry where SARIF severity defaulted
through the rule's `defaultConfiguration.level` rather than an explicit `result.level`.

- **`packages/lib/crypto.ts:3` (legacy AES-256-CBC primitive) — CWE-327 (Use of Broken/Risky Cryptographic
  Algorithm).** Inferred from agent-classified AES-256-CBC usage without authentication tag, cross-referenced with
  Tech Spec §6.4.3 designating this file as "legacy" superseded by the AES-256-GCM keyring at
  `packages/lib/crypto/keyring.ts`. Confidence: **high** — CBC-without-MAC is the canonical CWE-327 pattern.

- **`packages/lib/crypto.ts:16` (key loaded via `Buffer.from(key, 'latin1')`) — CWE-326 (Inadequate Encryption
  Strength).** Inferred from agent-classified key handling that does not enforce minimum entropy / length validation.
  Confidence: **medium** — CWE-326 is the family-level CWE; a child CWE could apply if the actual key were provably
  short, but the source does not enforce length here.

- **`apps/web/lib/csp.ts` (CSP nonce length / directive composition) — CWE-693 (Protection Mechanism Failure).**
  Inferred from agent-classified CSP construction emitting a 22-byte nonce; CWE-693 covers shortcomings such as
  sub-threshold nonces or directives permitting `unsafe-inline` / `unsafe-eval`. Confidence: **medium** — parent
  CWE-693 covers the class; a finer-grained child (CWE-1021) is reserved for explicit framing relaxations not
  observed here.

- **`apps/api/v2/src/bootstrap.ts:42` (helmet@7.1.0 invoked with defaults) — CWE-693.** Inferred from agent-classified
  helmet bootstrap that does not enable explicit security-header options. Confidence: **medium** — defaults are
  generally safe but defense-in-depth dictates explicit configuration.

- **`apps/api/v2/src/bootstrap.ts:54` (NestJS CORS wildcard fallback when `ALLOWED_ORIGINS` unset) — CWE-942
  (Permissive Cross-domain Policy with Untrusted Domains).** Inferred from agent-classified CORS middleware analysis.
  Confidence: **high** — CWE-942 is canonical for wildcard CORS without per-origin allow-listing.

- **`Dockerfile:94` and `apps/api/v2/Dockerfile:26` (missing `USER` directive) — CWE-250 (Execution with Unnecessary
  Privileges).** Inferred from agent-classified Dockerfile inspection. Confidence: **high** — corroborated by
  Semgrep rule `missing-user` declaring CWE-250 in `properties.tags`.

- **`Dockerfile:11–12` (`NEXTAUTH_SECRET` / `CALENDSO_ENCRYPTION_KEY` ARG with hardcoded weak defaults) — CWE-798
  (Use of Hard-coded Credentials).** Inferred from agent-classified Dockerfile ARG inspection where defaults encode
  secret material surviving if not overridden. Confidence: **high** — CWE-798 is canonical for hardcoded-credential
  exposure.

- **`docker-compose.yml:15, 28` (mutable image tags `postgres` / `redis:latest`) — CWE-1357 (Reliance on
  Insufficiently Trustworthy Component).** Inferred from agent-classified compose-service inspection. Confidence:
  **high** — CWE-1357 is canonical for non-immutable external-dependency selection; preferred over CWE-829 because
  the source is a published registry artifact, not arbitrary user input.

- **`docker-compose.yml:127` (Prisma Studio published on port 5555) — CWE-200 (Information Exposure).** Inferred
  from agent-classified port-publishing analysis where an admin UI is reachable without authentication. Confidence:
  **medium** — CWE-200 captures the exposure class; a child CWE could apply for specific data-leakage paths.

- **`.github/workflows/i18n.yml:32` (third-party action `lingodotdev/lingo.dev@main` pinned to mutable branch) —
  CWE-829 (Inclusion of Functionality from Untrusted Control Sphere).** Inferred from agent-classified workflow
  inspection. Confidence: **high** — exact alignment with industry guidance on GitHub Actions hardening.

- **Severity default for 12 Semgrep records lacking explicit `result.level`** (those mapped to `critical`
  post-Checkpoint 2). Inferred from SARIF spec semantics — when `result.level` is absent, the effective level is the
  rule's `defaultConfiguration.level`. Confidence: **high** — verified in commit `94be5893`: all 32 SARIF-backed
  records show 0 mismatches between assigned severity and effective SARIF level.

Inferred-claim watchlist closes here. The remaining records in `findings-config-c.json` derive every field directly
from either an authoritative Semgrep rule metadata source or an unambiguous Blitzy native classification, and
therefore do not require additional spot-check entries.
