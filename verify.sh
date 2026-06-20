#!/usr/bin/env bash
# =============================================================================
# verify.sh  --  Directive 10: Deterministic Verification Suite
# -----------------------------------------------------------------------------
# Reviewer-facing proof that the six-layer security audit ran to completion and
# emitted gate-ready artifacts. Encodes 16 deterministic checks over the audit
# corpus produced by Directives 0-9. Each check prints exactly one line:
#
#     PASS: <description>      or      FAIL: <description>
#
# The script EXITS with the COUNT of failed checks (0 == every check passed),
# and records "verification_status":"PASS"|"FAIL" into findings-merged.json.
#
# Design contract (see Agent Action Plan 0.2 / 0.7):
#   * Deterministic & self-contained -- no network, no external rule fetch, no
#     reliance on tools beyond bash, grep, find and python3 (jq may be absent,
#     so all JSON parsing uses python3). Safe to re-run as a CI/CD gate.
#   * Emits NO ANSI escape sequences itself (no colour codes anywhere).
#   * Read-only against application source. Only artifacts at the repository
#     root are read; the sole write is the verification_status field in
#     findings-merged.json. The audited source tree and every exclude_dir
#     (node_modules, .next, dist, build, .yarn, .git, coverage, .turbo) are
#     never read or written by this script.
#   * Language-aware: the JS/TS-applicable sink columns are required. For this
#     TypeScript codebase ALL 19 sink categories are JS/TS-applicable, so none
#     are exempt. A category with zero first-party matches (e.g. CWE-134 Format
#     String Injection) is NOT dropped or exempted -- it is explicitly covered
#     by a documented zero-hit sentinel in sink-inventory.txt and a matching
#     zero-hit finding in findings-layer-3b-taint.json (check 4 & 7).
#   * Documented-ERROR allowance: a deterministic layer that recorded an ERROR
#     status is an acceptable, documented outcome (check 3 & 10).
#
# Usage:   bash verify.sh        ;        echo "exit code = $?"
# =============================================================================

# Intentionally DO NOT use `set -e`: every one of the 16 checks must run even
# when an earlier check fails, so the failure count is complete and accurate.
# `pipefail` is harmless and makes piped failures observable.
set -o pipefail

# -----------------------------------------------------------------------------
# Resolve and move to the repository root (the directory holding this script).
# This makes the suite invariant to the caller's working directory.
# -----------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
cd "$SCRIPT_DIR" || { printf 'FATAL: cannot cd to repository root\n'; exit 99; }

# -----------------------------------------------------------------------------
# Optional non-mutating (read-only) mode.
# By default the suite records the overall verification_status into
# findings-merged.json (per the Agent Action Plan execution flow). Passing
# --check / --no-write / --read-only / --dry-run (or exporting VERIFY_NO_WRITE=1)
# runs all 16 checks WITHOUT modifying any file, so a read-only reviewer or a
# CI validator can execute the suite safely. The exit code (the count of failed
# checks) and every PASS/FAIL line are identical in both modes; only the final
# verification_status writeback is suppressed in read-only mode.
# -----------------------------------------------------------------------------
NO_WRITE="${VERIFY_NO_WRITE:-0}"
for _arg in "$@"; do
  case "$_arg" in
    --check|--no-write|--read-only|--dry-run) NO_WRITE=1 ;;
    -h|--help)
      printf 'Usage: %s [--check|--no-write|--read-only|--dry-run]\n' "${0##*/}"
      printf '  (default)  run the 16 checks AND record verification_status into findings-merged.json\n'
      printf '  --check    run the 16 checks WITHOUT writing any file (read-only / CI-safe)\n'
      exit 0 ;;
    *)
      printf 'FATAL: unknown argument %s (try --help)\n' "$_arg"; exit 98 ;;
  esac
done

# -----------------------------------------------------------------------------
# Failure accounting + plain (ANSI-free) reporters.
# -----------------------------------------------------------------------------
FAILURES=0
pass() { printf 'PASS: %s\n' "$1"; }
fail() { printf 'FAIL: %s\n' "$1"; FAILURES=$((FAILURES + 1)); }

# -----------------------------------------------------------------------------
# Audit artifact paths (relative to the repository root).
# -----------------------------------------------------------------------------
PROFILE="codebase-profile.txt"
L1="findings-layer-1-arch.json"
L2="findings-layer-2-semgrep.json"
L3B="findings-layer-3b-taint.json"
L4="findings-layer-4-osv.json"
MERGED="findings-merged.json"
SINK="sink-inventory.txt"
SINK_TEST="sink-inventory-test.txt"
MIT="mitigation-inventory.txt"
MIT_TEST="mitigation-inventory-test.txt"
# Raw / intermediate artifacts (in scope for end-to-end verification).
SARIF="results-semgrep.sarif"
OSV_RAW="results-osv.json"
RULES_GITIGNORE="rules/.gitignore"
VERIFY_SELF="verify.sh"

# =============================================================================
# Canonical taxonomy -- single source of truth so the checks are self-contained
# and deterministic (independent of how the artifacts were generated).
# =============================================================================

# The 19 Layer-3b sink categories, parallel-indexed with their CWE id(s).
# A category may map to several CWEs (e.g. Cookie Attributes); presence of ANY
# of its CWE tags in the inventory counts the category as covered.
SINK_NAMES=(
  "Open Redirect"
  "SSRF"
  "Log Injection"
  "Auth Decision on User Input"
  "Weak PRNG"
  "Type Confusion"
  "Missing Authorization"
  "XSS / DOM Manipulation"
  "Format String Injection"
  "Property Injection"
  "File System Write"
  "Cookie Attributes"
  "IDOR / Tenant Isolation"
  "Information Disclosure via Query"
  "TOCTOU Race Conditions"
  "OAuth Scope Validation"
  "Code Injection"
  "Insecure Deserialization"
  "XML External Entity Injection"
)
SINK_CWES=(
  "CWE-601"
  "CWE-918"
  "CWE-117"
  "CWE-807"
  "CWE-338"
  "CWE-843"
  "CWE-862"
  "CWE-79"
  "CWE-134"
  "CWE-250"
  "CWE-912"
  "CWE-1004 CWE-614 CWE-1275"
  "CWE-639"
  "CWE-200"
  "CWE-367"
  "CWE-285"
  "CWE-94"
  "CWE-502"
  "CWE-611"
)

# Sink categories whose detection pattern is STRUCTURALLY INAPPLICABLE to the
# detected primary language (e.g. Python/Go/Java-only sink columns under a
# TypeScript codebase). For this JS/TS codebase EVERY one of the 19 sink
# categories is JS/TS-applicable, so this set is EMPTY -- nothing is exempted.
#
# This array is retained as the AAP language-aware hook for genuinely-inapplicable
# non-JS/TS pattern columns; it is empty here by design.
JSTS_INAPPLICABLE_CWES=()

# Documented ZERO-HIT sink categories: JS/TS-APPLICABLE categories that have ZERO
# first-party sink matches in THIS codebase. They are NOT silently dropped and are
# NOT represented by any placeholder/sentinel file path. Instead they are recorded
# as explicit zero-hit coverage METADATA *outside* the findings arrays, in
# findings-merged.json _summary.coverage.sink_categories_zero_hit. So every entry
# in sink-inventory.txt is a real file:::line:::pattern and every finding in
# findings-layer-3b-taint.json references a real source file:line (check 16).
#
# Checks 4 and 7 treat a documented zero-hit CWE as COVERED (so the category is
# never reported missing), and check 7 CROSS-VALIDATES this list against the merged
# coverage metadata: the two MUST agree, making the zero-hit claim corroborated and
# reproducible rather than an arbitrary local waiver. A category is only honored as
# zero-hit when it additionally has no real inventory line / no real finding (which
# is exactly the condition under which the zero-hit branch is consulted).
#
# CWE-134 (Format String Injection) is JS/TS-applicable -- util.format / sprintf-js
# / printf-style and %s/%d/%j console-logger formatting are real JS/TS sinks -- but
# has zero first-party occurrences in this codebase, so it is the sole zero-hit CWE.
ZERO_HIT_CWES=(
  "CWE-134"
)

# -----------------------------------------------------------------------------
# Documented Semgrep SARIF -> normalized suppression allow-list (AAP Directive 3).
# Check 3 asserts that EVERY raw results-semgrep.sarif result (file + startLine)
# is present in the normalized findings-layer-2-semgrep.json, UNLESS its
# "file:::startLine" key is explicitly listed here with an AAP-allowed basis.
# AAP Directive 3 permits exactly two suppression categories: (1) auth guards
# that return `true` inside *.test.*/*.spec.* test stubs, and (2) shell execution
# with hardcoded args in build directories (build-time only). This list is empty
# because all raw SARIF results are normalized into Layer 2 (none qualifies for a
# suppression). Format per entry: "path/to/file:::<startLine>".
SEMGREP_SUPPRESSIONS=(
)

# The 9 mitigation categories (inventory tag tokens).
MITIGATION_CATS=(
  "schema-validation"
  "parameterized-query"
  "auth-middleware"
  "rate-limiting"
  "crypto-protection"
  "csrf-protection"
  "input-sanitization"
  "webhook-signature"
  "timing-safe-comparison"
)

# The 10 Layer-1 architectural categories (referenced inside L1 descriptions).
L1_CATS=(
  "Cryptographic & Key Management"
  "Authentication & Session"
  "Transport & Origin"
  "Request Handling"
  "Container & CI/CD"
  "Incoming Webhook & Integration Verification"
  "Business-Domain Input Validation"
  "Embed & Cross-Origin Security"
  "API Version Security Parity"
  "Framework-Specific Misconfigurations"
)

# Unified severity vocabulary (the only permitted values, AAP 0.2.1).
ALLOWED_SEVERITIES="critical high medium low"

# -----------------------------------------------------------------------------
# Detect the primary language and decide whether the JS/TS sink column applies.
# -----------------------------------------------------------------------------
PRIMARY_LANGUAGE="$(grep -E '^primary_language:' "$PROFILE" 2>/dev/null \
  | head -1 | sed 's/^primary_language:[[:space:]]*//' | tr -d '\r' \
  | sed 's/[[:space:]]*$//')"
case "$PRIMARY_LANGUAGE" in
  *typescript*|*javascript*) IS_JSTS=1 ;;
  *) IS_JSTS=0 ;;
esac

# Returns success (0) if the given CWE id is in the JS/TS-inapplicable set.
is_jsts_exempt_cwe() {
  local target="$1" cwe
  for cwe in "${JSTS_INAPPLICABLE_CWES[@]}"; do
    [ "$cwe" = "$target" ] && return 0
  done
  return 1
}

# Returns success (0) if the given CWE id is a DOCUMENTED zero-hit category
# (scanned, covered, zero first-party matches; recorded in merged coverage metadata).
is_zero_hit_cwe() {
  local target="$1" cwe
  for cwe in "${ZERO_HIT_CWES[@]}"; do
    [ "$cwe" = "$target" ] && return 0
  done
  return 1
}

# -----------------------------------------------------------------------------
# Export the canonical data for the embedded python3 snippets (read via os.environ).
# SINK_MAP encodes "Name=CWE,CWE|Name=CWE|..." built from the arrays above so
# the bash arrays remain the single source of truth.
# -----------------------------------------------------------------------------
SINK_MAP=""
for _i in "${!SINK_NAMES[@]}"; do
  _cwes_csv="$(printf '%s' "${SINK_CWES[$_i]}" | tr ' ' ',')"
  _entry="${SINK_NAMES[$_i]}=${_cwes_csv}"
  if [ -z "$SINK_MAP" ]; then SINK_MAP="$_entry"; else SINK_MAP="${SINK_MAP}|${_entry}"; fi
done
JSTS_EXEMPT_CWES="$(IFS=,; printf '%s' "${JSTS_INAPPLICABLE_CWES[*]}")"
ZERO_HIT_CWES_ENV="$(IFS=,; printf '%s' "${ZERO_HIT_CWES[*]}")"
SEMGREP_SUPPRESSIONS_ENV="$(IFS='|'; printf '%s' "${SEMGREP_SUPPRESSIONS[*]}")"
L1_CATS_ENV="$(IFS='|'; printf '%s' "${L1_CATS[*]}")"
ALLOWED_SEVERITIES_ENV="$ALLOWED_SEVERITIES"

export PROFILE L1 L2 L3B L4 MERGED SINK
export SARIF OSV_RAW RULES_GITIGNORE
export SINK_MAP JSTS_EXEMPT_CWES ZERO_HIT_CWES_ENV IS_JSTS L1_CATS_ENV ALLOWED_SEVERITIES_ENV SEMGREP_SUPPRESSIONS_ENV

if [ "$NO_WRITE" -eq 1 ]; then _MODE="read-only (no writeback)"; else _MODE="default (records verification_status)"; fi
printf '=== Directive 10 Verification Suite (16 checks) ===\n'
printf 'repo_root=%s  primary_language=%s  js_ts_column=%s  mode=%s\n\n' \
  "$SCRIPT_DIR" "${PRIMARY_LANGUAGE:-<unset>}" "$IS_JSTS" "$_MODE"

# =============================================================================
# CHECK 1 -- codebase-profile.txt exists AND primary_language is populated.
# =============================================================================
if [ -f "$PROFILE" ] && [ -n "$PRIMARY_LANGUAGE" ]; then
  pass "Check 1: codebase-profile.txt exists and primary_language is populated (${PRIMARY_LANGUAGE})"
else
  fail "Check 1: codebase-profile.txt missing or primary_language field not populated"
fi

# =============================================================================
# CHECK 2 -- findings-layer-1-arch.json is a valid JSON array referencing all
#            10 Layer-1 architectural categories.
# =============================================================================
if C2_OUT="$(python3 - <<'PY' 2>&1
import json, os, sys
fn = os.environ['L1']
cats = os.environ['L1_CATS_ENV'].split('|')
try:
    data = json.load(open(fn, encoding='utf-8'))
except Exception as exc:
    print('not valid JSON: %s' % exc); sys.exit(1)
if not isinstance(data, list):
    print('not a JSON array'); sys.exit(1)
blob = '\n'.join(str(f.get('description', '')) for f in data if isinstance(f, dict))
missing = [c for c in cats if c not in blob]
if missing:
    print('missing L1 categories: %s' % '; '.join(missing)); sys.exit(1)
print('valid array, all 10 L1 categories referenced'); sys.exit(0)
PY
)"; then
  pass "Check 2: findings-layer-1-arch.json valid JSON array covering all 10 L1 categories"
else
  fail "Check 2: findings-layer-1-arch.json -- ${C2_OUT}"
fi

# =============================================================================
# CHECK 3 -- Layer 2 (Semgrep) artifacts. findings-layer-2-semgrep.json is a
#            valid JSON array, AND the raw results-semgrep.sarif parses as SARIF
#            with at least one run, AND the pinned-rules dir marker rules/.gitignore
#            exists -- OR layer_2 recorded a documented ERROR status (an
#            acceptable deterministic-layer outcome that waives the array/SARIF
#            requirements). rules/.gitignore is required unconditionally.
# =============================================================================
if C3_OUT="$(python3 - <<'PY' 2>&1
import json, os, sys
fn = os.environ['L2']; merged = os.environ['MERGED']
sarif = os.environ['SARIF']; rules_gi = os.environ['RULES_GITIGNORE']
def layer_status(name):
    try:
        d = json.load(open(merged, encoding='utf-8'))
    except Exception:
        return None
    for el in (d if isinstance(d, list) else []):
        if isinstance(el, dict) and '_summary' in el:
            return (el['_summary'].get('layer_status') or {}).get(name)
    return None
l2_err = ''
try:
    d = json.load(open(fn, encoding='utf-8'))
    l2_ok = isinstance(d, list)
except Exception as exc:
    l2_ok = False; l2_err = str(exc)
documented_error = (layer_status('layer_2') == 'ERROR')
problems = []
# (a) normalized L2 array (waived only if layer_2 is a documented ERROR)
if not l2_ok and not documented_error:
    problems.append('findings-layer-2-semgrep.json invalid/missing array and layer_2 not documented ERROR%s'
                    % ((': ' + l2_err) if l2_err else ''))
# (b) raw SARIF parses with >=1 run (waived only if layer_2 is a documented ERROR)
if not documented_error:
    try:
        s = json.load(open(sarif, encoding='utf-8'))
        runs = s.get('runs') if isinstance(s, dict) else None
        if not (isinstance(runs, list) and len(runs) >= 1):
            problems.append('results-semgrep.sarif has no SARIF run array')
    except Exception as exc:
        problems.append('results-semgrep.sarif not valid SARIF JSON: %s' % exc)
# (c) rules/.gitignore must exist (pinned-rules dir marker) -- unconditional
if not (os.path.isfile(rules_gi) and os.path.getsize(rules_gi) > 0):
    problems.append('rules/.gitignore missing or empty')
# (d) SARIF completeness: every raw SARIF result (file,startLine) must be present
#     in the normalized Layer 2 array, unless its "file:::startLine" is in the
#     documented SEMGREP_SUPPRESSIONS allow-list (AAP Directive 3). This is the
#     guard that catches a normalized artifact silently dropping a reproducible
#     raw SARIF finding. Waived only when layer_2 is a documented ERROR or the L2
#     array failed to parse (already reported by (a)).
sar_pairs = set()
if not documented_error and l2_ok:
    try:
        s2 = json.load(open(sarif, encoding='utf-8'))
        for run in (s2.get('runs') or []):
            for r in (run.get('results') or []):
                for loc in (r.get('locations') or []):
                    pl = loc.get('physicalLocation') or {}
                    uri = (pl.get('artifactLocation') or {}).get('uri') or ''
                    if uri.startswith('file://'):
                        uri = uri[7:]
                    ln = (pl.get('region') or {}).get('startLine')
                    if uri and ln is not None:
                        sar_pairs.add((uri, int(ln)))
        l2_pairs = set()
        for f in d:
            if isinstance(f, dict) and f.get('file') is not None and f.get('line') is not None:
                try:
                    l2_pairs.add((f['file'], int(f['line'])))
                except (TypeError, ValueError):
                    pass
        supp = set(x for x in (os.environ.get('SEMGREP_SUPPRESSIONS_ENV', '') or '').split('|') if x)
        uncovered = []
        for (uri, ln) in sorted(sar_pairs):
            if (uri, ln) in l2_pairs:
                continue
            if ('%s:::%d' % (uri, ln)) in supp:
                continue
            uncovered.append('%s:%d' % (uri, ln))
        if uncovered:
            extra = (' (+%d more)' % (len(uncovered) - 5)) if len(uncovered) > 5 else ''
            problems.append('raw SARIF results not normalized into Layer 2 and not allow-listed: '
                            + ', '.join(uncovered[:5]) + extra)
    except Exception as exc:
        problems.append('SARIF-completeness check error: %s' % exc)
if problems:
    print('; '.join(problems)); sys.exit(1)
if documented_error:
    print('layer_2 documented ERROR (array/SARIF waived); rules/.gitignore present')
else:
    print('L2 array + raw SARIF (>=1 run; all %d SARIF results normalized or allow-listed) + rules/.gitignore all valid'
          % len(sar_pairs))
sys.exit(0)
PY
)"; then
  pass "Check 3: findings-layer-2-semgrep.json + results-semgrep.sarif + rules/.gitignore valid (or layer_2 documented ERROR) [${C3_OUT}]"
else
  fail "Check 3: Layer 2 artifacts -- ${C3_OUT}"
fi

# =============================================================================
# CHECK 4 -- sink-inventory.txt exists, is non-empty, EVERY line matches
#            file:::line:::pattern, and covers all 19 sink categories that are
#            APPLICABLE to the detected primary_language. For this JS/TS codebase
#            all 19 are applicable (the inapplicable set is empty), so all 19 must
#            be present -- including CWE-134 Format String Injection, which is
#            present via its explicit zero-hit coverage sentinel line. The
#            language-aware exemption hook only ever skips genuinely-inapplicable
#            non-JS/TS pattern columns (none here).
# =============================================================================
C4_OK=1; C4_MSG=""
if [ ! -s "$SINK" ]; then
  C4_OK=0; C4_MSG="sink-inventory.txt is missing or empty"
else
  # Every non-blank line must be  file:::<integer>:::<non-empty pattern>
  BADLINES="$(grep -v '^[[:space:]]*$' "$SINK" | grep -cvE '^.+:::[0-9]+:::.+$')"
  if [ "${BADLINES:-0}" -ne 0 ]; then
    C4_OK=0; C4_MSG="${BADLINES} line(s) do not match file:::line:::pattern"
  else
    C4_MISSING=()
    for _i in "${!SINK_NAMES[@]}"; do
      _name="${SINK_NAMES[$_i]}"; _cwes="${SINK_CWES[$_i]}"
      _found=0
      for _cwe in $_cwes; do
        if grep -qF "[$_cwe]" "$SINK"; then _found=1; break; fi
      done
      if [ "$_found" -eq 0 ]; then
        # Category absent from sink-inventory.txt. This is a FAILURE unless the
        # category is either (a) JS/TS-exempt under a JS/TS codebase (a genuinely
        # inapplicable non-JS/TS pattern column), or (b) a DOCUMENTED zero-hit CWE
        # (scanned, zero first-party matches, recorded as merged coverage metadata
        # -- no placeholder/sentinel line in the inventory). Either condition keeps
        # the category covered without fabricating a sink line.
        _exempt=0
        for _cwe in $_cwes; do
          if [ "$IS_JSTS" -eq 1 ] && is_jsts_exempt_cwe "$_cwe"; then _exempt=1; break; fi
          if is_zero_hit_cwe "$_cwe"; then _exempt=1; break; fi
        done
        [ "$_exempt" -eq 0 ] && C4_MISSING+=("${_name} (${_cwes// /,})")
      fi
    done
    if [ "${#C4_MISSING[@]}" -ne 0 ]; then
      C4_OK=0
      C4_MSG="missing applicable sink categories: $(IFS='; '; printf '%s' "${C4_MISSING[*]}")"
    fi
  fi
fi
if [ "$C4_OK" -eq 1 ]; then
  pass "Check 4: sink-inventory.txt non-empty, well-formed, covers all language-applicable sink categories"
else
  fail "Check 4: ${C4_MSG}"
fi

# =============================================================================
# CHECK 5 -- mitigation-inventory.txt exists, is non-empty, and covers all 9
#            mitigation categories.
# =============================================================================
C5_OK=1; C5_MSG=""
if [ ! -s "$MIT" ]; then
  C5_OK=0; C5_MSG="mitigation-inventory.txt is missing or empty"
else
  C5_MISSING=()
  for _cat in "${MITIGATION_CATS[@]}"; do
    grep -qF "[$_cat]" "$MIT" || C5_MISSING+=("$_cat")
  done
  if [ "${#C5_MISSING[@]}" -ne 0 ]; then
    C5_OK=0; C5_MSG="missing mitigation categories: ${C5_MISSING[*]}"
  fi
fi
if [ "$C5_OK" -eq 1 ]; then
  pass "Check 5: mitigation-inventory.txt non-empty and covers all 9 mitigation categories"
else
  fail "Check 5: ${C5_MSG}"
fi

# =============================================================================
# CHECK 6 -- sink-inventory-test.txt AND mitigation-inventory-test.txt exist.
# =============================================================================
if [ -f "$SINK_TEST" ] && [ -f "$MIT_TEST" ]; then
  pass "Check 6: sink-inventory-test.txt and mitigation-inventory-test.txt both exist"
else
  fail "Check 6: one or both test-inventory files are missing"
fi

# =============================================================================
# CHECK 7 -- findings-layer-3b-taint.json is a valid JSON array covering all 19
#            sink categories. For this JS/TS codebase all 19 are applicable. A
#            category is covered when it has at least one real L3b finding bearing
#            its CWE, OR it is a DOCUMENTED zero-hit CWE (e.g. CWE-134 Format String
#            Injection). The zero-hit set is CROSS-VALIDATED against the merged
#            coverage metadata (findings-merged.json _summary.coverage.
#            sink_categories_zero_hit): the two MUST agree, and a zero-hit CWE must
#            have NO real finding -- so zero-hit coverage is documented honestly
#            outside the findings array, never via a fabricated sentinel finding.
# =============================================================================
if C7_OUT="$(python3 - <<'PY' 2>&1
import json, os, sys
fn = os.environ['L3B']; merged = os.environ['MERGED']
sink_map = os.environ['SINK_MAP']
exempt = set(filter(None, os.environ.get('JSTS_EXEMPT_CWES', '').split(',')))
zero_hit = set(filter(None, os.environ.get('ZERO_HIT_CWES_ENV', '').split(',')))
is_jsts = os.environ.get('IS_JSTS', '0') == '1'
try:
    data = json.load(open(fn, encoding='utf-8'))
except Exception as exc:
    print('not valid JSON: %s' % exc); sys.exit(1)
if not isinstance(data, list):
    print('not a JSON array'); sys.exit(1)
# CWEs covered by a REAL finding (array elements that bear a cwe).
present = {f['cwe'] for f in data if isinstance(f, dict) and f.get('cwe')}
# Cross-validate the documented zero-hit set against the merged coverage metadata
# (reproducibility anchor: the two MUST agree, so zero-hit is corroborated, not an
# arbitrary local waiver).
merged_zero = None
try:
    md = json.load(open(merged, encoding='utf-8'))
    for el in (md if isinstance(md, list) else []):
        if isinstance(el, dict) and '_summary' in el:
            mz = (el['_summary'].get('coverage') or {}).get('sink_categories_zero_hit')
            if isinstance(mz, list):
                merged_zero = set(mz)
            break
except Exception as exc:
    print('cannot read merged coverage metadata: %s' % exc); sys.exit(1)
if merged_zero is None:
    print('merged _summary.coverage.sink_categories_zero_hit missing'); sys.exit(1)
if zero_hit != merged_zero:
    print('zero-hit set mismatch: verify.sh ZERO_HIT_CWES=%s != merged sink_categories_zero_hit=%s'
          % (sorted(zero_hit), sorted(merged_zero))); sys.exit(1)
# A documented zero-hit CWE must have NO real L3b finding (else the label is wrong).
contradiction = sorted(zero_hit & present)
if contradiction:
    print('CWE(s) declared zero-hit but present as a real L3b finding: %s' % ', '.join(contradiction)); sys.exit(1)
missing = []
for entry in sink_map.split('|'):
    name, cwes = entry.split('=', 1)
    cwes = cwes.split(',')
    if any(c in present for c in cwes):
        continue
    if is_jsts and any(c in exempt for c in cwes):
        continue
    if any(c in zero_hit for c in cwes):
        continue
    missing.append('%s (%s)' % (name, ','.join(cwes)))
if missing:
    print('missing L3b sink categories: %s' % '; '.join(missing)); sys.exit(1)
print('valid array; all applicable sink categories covered (documented zero-hit {%s} validated against merged coverage)'
      % (','.join(sorted(zero_hit)) or 'none')); sys.exit(0)
PY
)"; then
  pass "Check 7: findings-layer-3b-taint.json valid array covering all applicable sink categories"
else
  fail "Check 7: findings-layer-3b-taint.json -- ${C7_OUT}"
fi

# =============================================================================
# CHECK 8 -- every L3b finding has a boolean gateBlocking field; every finding
#            with gateBlocking==false carries a non-empty demotionReason.
# =============================================================================
if C8_OUT="$(python3 - <<'PY' 2>&1
import json, os, sys
fn = os.environ['L3B']
try:
    data = json.load(open(fn, encoding='utf-8'))
except Exception as exc:
    print('not valid JSON: %s' % exc); sys.exit(1)
if not isinstance(data, list):
    print('not a JSON array'); sys.exit(1)
no_gb = 0; bad_demo = 0
for f in data:
    if not isinstance(f, dict):
        continue
    if not isinstance(f.get('gateBlocking'), bool):
        no_gb += 1
        continue
    if f['gateBlocking'] is False:
        dr = f.get('demotionReason', '')
        if not (isinstance(dr, str) and dr.strip()):
            bad_demo += 1
if no_gb or bad_demo:
    print('findings missing/invalid gateBlocking: %d; advisories missing demotionReason: %d' % (no_gb, bad_demo))
    sys.exit(1)
print('all findings have boolean gateBlocking; all advisories have demotionReason'); sys.exit(0)
PY
)"; then
  pass "Check 8: every L3b finding has gateBlocking; every advisory (false) has a non-empty demotionReason"
else
  fail "Check 8: findings-layer-3b-taint.json -- ${C8_OUT}"
fi


# =============================================================================
# CHECK 9 -- every `severity` value across ALL findings JSON files is one of
#            critical|high|medium|low (recursive walk; by_severity COUNT keys
#            are not severity values and are ignored).
# =============================================================================
if C9_OUT="$(python3 - <<'PY' 2>&1
import json, os, sys
allowed = set(os.environ['ALLOWED_SEVERITIES_ENV'].split())
files = [os.environ[k] for k in ('L1', 'L2', 'L3B', 'L4', 'MERGED')]
def walk(obj, bad):
    if isinstance(obj, dict):
        for k, v in obj.items():
            if k == 'severity' and isinstance(v, str):
                if v not in allowed:
                    bad.add(v)
            else:
                walk(v, bad)
    elif isinstance(obj, list):
        for x in obj:
            walk(x, bad)
bad = set(); errs = []
for fn in files:
    try:
        walk(json.load(open(fn, encoding='utf-8')), bad)
    except Exception as exc:
        errs.append('%s: %s' % (fn, exc))
if errs:
    print('unreadable: %s' % '; '.join(errs)); sys.exit(1)
if bad:
    print('invalid severity value(s): %s' % ', '.join(sorted(bad))); sys.exit(1)
print('all severity values within critical|high|medium|low'); sys.exit(0)
PY
)"; then
  pass "Check 9: all severity fields across all JSON files use only critical|high|medium|low"
else
  fail "Check 9: ${C9_OUT}"
fi

# =============================================================================
# CHECK 10 -- Layer 4 (OSV-Scanner) artifacts. findings-layer-4-osv.json is a
#             valid JSON array AND the raw results-osv.json parses and corresponds
#             to the normalized output (its count of distinct (package, advisory)
#             pairs is >= the normalized finding count, since normalization
#             deduplicates) -- OR layer_4 recorded a documented ERROR status (an
#             acceptable deterministic-layer outcome that waives both).
# =============================================================================
if C10_OUT="$(python3 - <<'PY' 2>&1
import json, os, sys
fn = os.environ['L4']; merged = os.environ['MERGED']; osv_raw = os.environ['OSV_RAW']
def layer_status(name):
    try:
        d = json.load(open(merged, encoding='utf-8'))
    except Exception:
        return None
    for el in (d if isinstance(d, list) else []):
        if isinstance(el, dict) and '_summary' in el:
            return (el['_summary'].get('layer_status') or {}).get(name)
    return None
l4_err = ''
try:
    d = json.load(open(fn, encoding='utf-8'))
    l4_ok = isinstance(d, list); l4_n = len(d) if l4_ok else -1
except Exception as exc:
    l4_ok = False; l4_n = -1; l4_err = str(exc)
documented_error = (layer_status('layer_4') == 'ERROR')
problems = []
if not l4_ok and not documented_error:
    problems.append('findings-layer-4-osv.json invalid/missing array and layer_4 not documented ERROR%s'
                    % ((': ' + l4_err) if l4_err else ''))
if not documented_error:
    try:
        raw = json.load(open(osv_raw, encoding='utf-8'))
        pairs = set()
        for res in (raw.get('results', []) if isinstance(raw, dict) else []):
            for pkg in res.get('packages', []):
                name = (pkg.get('package') or {}).get('name')
                for v in pkg.get('vulnerabilities', []):
                    pairs.add((name, v.get('id')))
        if not pairs:
            problems.append('results-osv.json has no vulnerability entries')
        elif l4_ok and l4_n > len(pairs):
            problems.append('normalized L4 (%d) exceeds raw distinct (pkg,advisory) pairs (%d)'
                            % (l4_n, len(pairs)))
    except Exception as exc:
        problems.append('results-osv.json not valid OSV JSON: %s' % exc)
if problems:
    print('; '.join(problems)); sys.exit(1)
print('L4 array + raw OSV correspond (normalized<=raw distinct pairs)' if not documented_error
      else 'layer_4 documented ERROR (array/raw waived)')
sys.exit(0)
PY
)"; then
  pass "Check 10: findings-layer-4-osv.json + results-osv.json valid and correspond (or layer_4 documented ERROR) [${C10_OUT}]"
else
  fail "Check 10: Layer 4 artifacts -- ${C10_OUT}"
fi

# =============================================================================
# CHECK 11 -- findings-merged.json _summary is internally consistent and matches
#             the per-layer files. This recomputes and compares EVERY required
#             summary count and asserts required summary-key presence:
#               * by_layer[k] == len(layer_file k)  (all 4 layers)
#               * total_findings == sum(by_layer)
#               * unique_findings == merged finding-object count (excl. _summary)
#               * corroborated == # merged findings whose corroborated_by has >1 source
#               * gate_blocking == # merged findings with gateBlocking==true
#                                 (and equals the L3b gateBlocking count)
#               * by_severity has exactly {critical,high,medium,low}, integer
#                 values, summing to total_findings, AND its per-bucket
#                 distribution equals the raw aggregate recomputed from the 4
#                 per-layer files (the canonical by_severity population per
#                 check 11 "match the sum of the layer files") -- not merely the
#                 scalar sum, so a distribution that totals right but is
#                 mis-allocated across severity buckets is caught
#               * layer_status has all of layer_0,1,2,3a,3b,4, each OK|ERROR
# =============================================================================
if C11_OUT="$(python3 - <<'PY' 2>&1
import json, os, sys
merged = os.environ['MERGED']
files = {'arch-audit': os.environ['L1'], 'semgrep': os.environ['L2'],
         'taint-analysis': os.environ['L3B'], 'osv-scanner': os.environ['L4']}
try:
    md = json.load(open(merged, encoding='utf-8'))
except Exception as exc:
    print('merged not valid JSON: %s' % exc); sys.exit(1)
if not isinstance(md, list):
    print('merged is not a JSON array'); sys.exit(1)
summary = None
for el in md:
    if isinstance(el, dict) and '_summary' in el:
        summary = el['_summary']; break
if summary is None:
    print('merged has no _summary element'); sys.exit(1)

problems = []

# --- by_layer == per-layer file lengths; total_findings == sum(by_layer);
#     AND accumulate the raw per-severity distribution across the 4 per-layer
#     files. That raw aggregate is the canonical population for
#     _summary.by_severity (it equals total_findings and aligns with by_layer),
#     so check 11 below asserts the FULL distribution against it -- not merely
#     its scalar sum. ---
by_layer = summary.get('by_layer', {}) or {}
counts = {}
raw_sev = {'critical': 0, 'high': 0, 'medium': 0, 'low': 0}
raw_sev_ok = True
for key, fn in files.items():
    d = None
    try:
        d = json.load(open(fn, encoding='utf-8'))
        counts[key] = len(d) if isinstance(d, list) else -1
    except Exception:
        counts[key] = -1
    if counts[key] < 0:
        problems.append('%s unreadable' % key)
    elif by_layer.get(key) != counts[key]:
        problems.append('by_layer[%s]: summary=%r actual=%d' % (key, by_layer.get(key), counts[key]))
    # tally this layer file's severities into the canonical by_severity population
    if isinstance(d, list):
        for f in d:
            sev = f.get('severity') if isinstance(f, dict) else None
            if sev in raw_sev:
                raw_sev[sev] += 1
            else:
                raw_sev_ok = False
    else:
        raw_sev_ok = False
total = summary.get('total_findings')
calc_total = sum(v for v in counts.values() if v >= 0)
if total != calc_total:
    problems.append('total_findings=%r but sum(by_layer)=%d' % (total, calc_total))

# --- merged finding objects (everything except the _summary wrapper) ---
merged_findings = [el for el in md if isinstance(el, dict) and '_summary' not in el]
nobj = len(merged_findings)

# --- unique_findings == merged finding-object count ---
uniq = summary.get('unique_findings')
if uniq != nobj:
    problems.append('unique_findings=%r but merged finding-object count=%d' % (uniq, nobj))

# --- corroborated == # merged findings with >1 corroborating source ---
corr_calc = sum(1 for f in merged_findings
                if isinstance(f.get('corroborated_by'), list) and len(f['corroborated_by']) > 1)
corr = summary.get('corroborated')
if corr != corr_calc:
    problems.append('corroborated=%r but recomputed=%d' % (corr, corr_calc))

# --- gate_blocking == # merged findings gateBlocking==true (== L3b count) ---
gb_calc = sum(1 for f in merged_findings if f.get('gateBlocking') is True)
gb = summary.get('gate_blocking')
if gb != gb_calc:
    problems.append('gate_blocking=%r but recomputed(merged)=%d' % (gb, gb_calc))
try:
    l3b = json.load(open(files['taint-analysis'], encoding='utf-8'))
    gb_l3b = sum(1 for f in l3b if isinstance(f, dict) and f.get('gateBlocking') is True)
    if gb != gb_l3b:
        problems.append('gate_blocking=%r but L3b gateBlocking count=%d' % (gb, gb_l3b))
except Exception as exc:
    problems.append('cannot recount L3b gateBlocking: %s' % exc)

# --- by_severity: exactly 4 keys, non-negative integers, summing to
#     total_findings, AND -- crucially -- its per-bucket distribution must equal
#     the raw aggregate recomputed above from the 4 per-layer files. Asserting
#     the FULL distribution (not just the scalar sum) catches a by_severity that
#     totals correctly but is mis-allocated across severity buckets. ---
bysev = summary.get('by_severity')
if not isinstance(bysev, dict):
    problems.append('by_severity missing or not an object')
else:
    want = {'critical', 'high', 'medium', 'low'}
    if set(bysev.keys()) != want:
        problems.append('by_severity keys=%r (want %r)' % (sorted(bysev.keys()), sorted(want)))
    elif not all(isinstance(v, int) and v >= 0 for v in bysev.values()):
        problems.append('by_severity has non-integer/negative value(s): %r' % bysev)
    elif isinstance(total, int) and sum(bysev.values()) != total:
        problems.append('sum(by_severity)=%d != total_findings=%r' % (sum(bysev.values()), total))
    elif not raw_sev_ok:
        problems.append('cannot recompute by_severity distribution from the '
                        'per-layer files (a layer is unreadable/not-a-list or '
                        'carries an out-of-vocabulary severity)')
    else:
        sev_mismatch = [k for k in ('critical', 'high', 'medium', 'low')
                        if bysev.get(k) != raw_sev[k]]
        if sev_mismatch:
            problems.append('by_severity distribution does not match the raw '
                            'layer-file aggregate: '
                            + ', '.join('%s summary=%r raw=%d'
                                        % (k, bysev.get(k), raw_sev[k])
                                        for k in sev_mismatch))

# --- layer_status: all 6 keys present, each OK|ERROR ---
ls = summary.get('layer_status')
need = ['layer_0', 'layer_1', 'layer_2', 'layer_3a', 'layer_3b', 'layer_4']
if not isinstance(ls, dict):
    problems.append('layer_status missing or not an object')
else:
    miss = [k for k in need if k not in ls]
    badv = [k for k in need if k in ls and ls[k] not in ('OK', 'ERROR')]
    if miss:
        problems.append('layer_status missing keys: %s' % ', '.join(miss))
    if badv:
        problems.append('layer_status invalid value(s): %s'
                        % ', '.join('%s=%r' % (k, ls[k]) for k in badv))

if problems:
    print('; '.join(problems)); sys.exit(1)
print('all _summary counts consistent (total=%d, unique=%d, corroborated=%d, '
      'gate_blocking=%d; by_severity distribution matches the raw layer-file '
      'aggregate critical=%d/high=%d/medium=%d/low=%d)'
      % (calc_total, nobj, corr_calc, gb_calc,
         raw_sev['critical'], raw_sev['high'], raw_sev['medium'], raw_sev['low'])); sys.exit(0)
PY
)"; then
  pass "Check 11: findings-merged.json _summary fully consistent (counts, severity distribution, gate-blocking, layer_status) [${C11_OUT}]"
else
  fail "Check 11: findings-merged.json -- ${C11_OUT}"
fi

# =============================================================================
# CHECK 12 -- NO ANSI escape sequence (ESC, 0x1b) appears in ANY of the 14
#             declared output artifacts. This now covers the raw scanner outputs
#             (results-semgrep.sarif, results-osv.json), the pinned-rules marker
#             (rules/.gitignore) and the verification script itself (verify.sh),
#             in addition to the profile, per-layer JSONs, merged report and the
#             four inventories.
# =============================================================================
ESC=$(printf '\033')
C12_BAD=()
for _f in "$PROFILE" "$L1" "$L2" "$L3B" "$L4" "$MERGED" "$SINK" "$SINK_TEST" "$MIT" "$MIT_TEST" \
          "$SARIF" "$OSV_RAW" "$RULES_GITIGNORE" "$VERIFY_SELF"; do
  if [ -f "$_f" ] && LC_ALL=C grep -q "$ESC" "$_f"; then
    C12_BAD+=("$_f")
  fi
done
if [ "${#C12_BAD[@]}" -eq 0 ]; then
  pass "Check 12: no ANSI escape sequences present in any of the 14 declared artifacts"
else
  fail "Check 12: ANSI escape sequence(s) found in: ${C12_BAD[*]}"
fi

# =============================================================================
# CHECK 13 -- no finding in any JSON file has an empty or missing description.
#             (A "finding" is any top-level array element bearing a `file` key;
#             the merged _summary wrapper is not a finding and is skipped, yet
#             still carries a description in practice.)
# =============================================================================
if C13_OUT="$(python3 - <<'PY' 2>&1
import json, os, sys
files = [os.environ[k] for k in ('L1', 'L2', 'L3B', 'L4', 'MERGED')]
bad = 0; errs = []
for fn in files:
    try:
        d = json.load(open(fn, encoding='utf-8'))
    except Exception as exc:
        errs.append('%s: %s' % (fn, exc)); continue
    if not isinstance(d, list):
        errs.append('%s: not a JSON array' % fn); continue
    for f in d:
        if isinstance(f, dict) and 'file' in f:
            dsc = f.get('description', '')
            if not (isinstance(dsc, str) and dsc.strip()):
                bad += 1
if errs:
    print('unreadable: %s' % '; '.join(errs)); sys.exit(1)
if bad:
    print('%d finding(s) with empty/missing description' % bad); sys.exit(1)
print('all findings carry a non-empty description'); sys.exit(0)
PY
)"; then
  pass "Check 13: no finding in any JSON file has an empty or missing description"
else
  fail "Check 13: ${C13_OUT}"
fi

# =============================================================================
# CHECK 14 -- findings-merged.json contains a gate_verdict in the permitted set
#             {ERROR, BLOCK, WARN, PASS}.
# =============================================================================
if C14_OUT="$(python3 - <<'PY' 2>&1
import json, os, sys
merged = os.environ['MERGED']
allowed = {'ERROR', 'BLOCK', 'WARN', 'PASS'}
try:
    md = json.load(open(merged, encoding='utf-8'))
except Exception as exc:
    print('merged not valid JSON: %s' % exc); sys.exit(1)
verdict = None
for el in (md if isinstance(md, list) else []):
    if isinstance(el, dict):
        if 'gate_verdict' in el:
            verdict = el['gate_verdict']; break
        s = el.get('_summary')
        if isinstance(s, dict) and 'gate_verdict' in s:
            verdict = s['gate_verdict']; break
if verdict in allowed:
    print('gate_verdict=%s' % verdict); sys.exit(0)
print('gate_verdict missing or invalid: %r' % verdict); sys.exit(1)
PY
)"; then
  pass "Check 14: findings-merged.json has a valid gate_verdict [${C14_OUT}]"
else
  fail "Check 14: findings-merged.json -- ${C14_OUT}"
fi

# =============================================================================
# CHECK 15 -- no pre-agent step has a silent failure: layer_0_status,
#             layer_2_status, layer_3a_status, layer_4_status must each be
#             PRESENT (OK or ERROR). Statuses are sourced from BOTH
#             codebase-profile.txt (layer_N_status: form) and the merged
#             _summary.layer_status map (layer_N form); a status missing from
#             both locations is a FAIL.
# =============================================================================
if C15_OUT="$(python3 - <<'PY' 2>&1
import json, os, re, sys
merged = os.environ['MERGED']; profile = os.environ['PROFILE']
need = ['layer_0', 'layer_2', 'layer_3a', 'layer_4']
status = {}
try:
    md = json.load(open(merged, encoding='utf-8'))
    for el in (md if isinstance(md, list) else []):
        if isinstance(el, dict) and '_summary' in el:
            for k, v in (el['_summary'].get('layer_status') or {}).items():
                status[k] = v
            break
except Exception:
    pass
try:
    with open(profile, encoding='utf-8') as fh:
        for line in fh:
            m = re.match(r'\s*(layer_[0-9a-z]+)_status\s*:\s*(\S+)', line)
            if m:
                status[m.group(1)] = m.group(2)
except Exception:
    pass
valid = {'OK', 'ERROR'}
missing = [k for k in need if not status.get(k)]
invalid = [k for k in need if status.get(k) and status[k] not in valid]
if missing:
    print('missing pre-agent status: %s' % ', '.join('%s_status' % k for k in missing)); sys.exit(1)
if invalid:
    print('invalid status value(s): %s' % ', '.join('%s_status=%s' % (k, status[k]) for k in invalid)); sys.exit(1)
print(', '.join('%s_status=%s' % (k, status[k]) for k in need)); sys.exit(0)
PY
)"; then
  pass "Check 15: no pre-agent step has a silent failure [${C15_OUT}]"
else
  fail "Check 15: ${C15_OUT}"
fi

# =============================================================================
# CHECK 16 -- every L3b finding references a file:line pair present in
#             sink-inventory.txt (taint findings must trace back to an
#             inventoried sink) AND that file must be a REAL, existing source
#             file on disk. Non-finding elements (no 'file' key) are skipped.
#             The real-source existence assertion is what rejects fabricated
#             "sentinel" paths that would otherwise satisfy a pure
#             inventory-membership check (a sentinel can be planted in both the
#             findings array and the inventory). Zero-hit coverage must be
#             documented in merged _summary.coverage, never as a sink finding.
# =============================================================================
if C16_OUT="$(python3 - <<'PY' 2>&1
import json, os, sys
l3b = os.environ['L3B']; sink = os.environ['SINK']
try:
    data = json.load(open(l3b, encoding='utf-8'))
except Exception as exc:
    print('L3b not valid JSON: %s' % exc); sys.exit(1)
pairs = set()
try:
    with open(sink, encoding='utf-8') as fh:
        for ln in fh:
            parts = ln.split(':::')
            if len(parts) >= 2:
                pairs.add((parts[0], parts[1].strip()))
except Exception as exc:
    print('cannot read sink-inventory.txt: %s' % exc); sys.exit(1)
not_in_inv = 0; inv_samples = []
not_real = 0; real_samples = []
for f in data:
    if not isinstance(f, dict):
        continue
    # Skip non-finding array elements (e.g. metadata objects with no 'file').
    if 'file' not in f:
        continue
    fpath = f.get('file')
    key = (fpath, str(f.get('line')))
    if key not in pairs:
        not_in_inv += 1
        if len(inv_samples) < 5:
            inv_samples.append('%s:%s' % key)
    # Real-source existence: the referenced file must actually exist on disk.
    # This rejects fabricated sentinel paths used to fake category coverage.
    if not (isinstance(fpath, str) and os.path.isfile(fpath)):
        not_real += 1
        if len(real_samples) < 5:
            real_samples.append('%s:%s' % key)
if not_in_inv or not_real:
    msgs = []
    if not_in_inv:
        msgs.append('%d L3b finding(s) not in sink-inventory.txt (e.g. %s)' % (not_in_inv, ', '.join(inv_samples)))
    if not_real:
        msgs.append('%d L3b finding(s) reference a non-existent source file (e.g. %s)' % (not_real, ', '.join(real_samples)))
    print('; '.join(msgs)); sys.exit(1)
print('all L3b findings trace to an inventoried sink file:line and reference a real existing source file'); sys.exit(0)
PY
)"; then
  pass "Check 16: every L3b finding references a real file:line present in sink-inventory.txt"
else
  fail "Check 16: ${C16_OUT}"
fi


# =============================================================================
# Record the overall verification_status into findings-merged.json.
# PASS when zero checks failed, otherwise FAIL. The edit is deterministic and
# minimal: it loads the report, sets verification_status on the _summary
# wrapper element (both the top-level field and the nested _summary field, to
# keep them consistent) and re-serialises with the SAME minified, raw-UTF-8
# style as the original (ensure_ascii=False, compact separators), so re-runs
# are byte-stable and only the status field can ever change.
#
# In read-only mode (--check/--no-write/--read-only/--dry-run or VERIFY_NO_WRITE=1)
# the writeback is SUPPRESSED so the suite mutates nothing and can be executed
# safely by a read-only reviewer or CI validator. The exit code is unchanged.
# =============================================================================
if [ "$FAILURES" -eq 0 ]; then
  VERIFICATION_STATUS="PASS"
else
  VERIFICATION_STATUS="FAIL"
fi

if [ "$NO_WRITE" -eq 1 ]; then
  printf '\n(read-only mode: verification_status=%s computed but NOT written to %s)\n' \
    "$VERIFICATION_STATUS" "$MERGED"
elif [ -f "$MERGED" ]; then
  VERIFICATION_STATUS="$VERIFICATION_STATUS" MERGED="$MERGED" python3 - <<'PY'
import json, os, sys
merged = os.environ['MERGED']
status = os.environ['VERIFICATION_STATUS']
try:
    with open(merged, encoding='utf-8') as fh:
        data = json.load(fh)
except Exception as exc:
    sys.stderr.write('WARN: could not parse %s to record verification_status: %s\n' % (merged, exc))
    sys.exit(0)
recorded = False
if isinstance(data, list):
    for el in data:
        if isinstance(el, dict) and '_summary' in el:
            el['verification_status'] = status
            if isinstance(el['_summary'], dict):
                el['_summary']['verification_status'] = status
            recorded = True
            break
if not recorded:
    sys.stderr.write('WARN: no _summary element found; verification_status not recorded\n')
    sys.exit(0)
with open(merged, 'w', encoding='utf-8') as fh:
    json.dump(data, fh, ensure_ascii=False, separators=(',', ':'))
print('recorded verification_status=%s into %s' % (status, merged))
PY
else
  printf 'WARN: %s not found; verification_status not recorded\n' "$MERGED"
fi

# -----------------------------------------------------------------------------
# Summary line and exit with the count of failed checks (0 == all passed).
# -----------------------------------------------------------------------------
printf '\n=== Verification complete ===\n'
printf 'checks_total=16  checks_failed=%d  verification_status=%s\n' "$FAILURES" "$VERIFICATION_STATUS"
exit "$FAILURES"

