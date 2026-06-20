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
#   * Language-aware: sink categories whose patterns are structurally
#     inapplicable to the detected primary_language are expected-empty and do
#     NOT trigger a failure (check 4 & 7).
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

# Sink categories whose JS/TS detection pattern is structurally inapplicable
# (expected-empty) when the primary language is TypeScript/JavaScript.
# Format String Injection (CWE-134) is a C/printf-family class with no idiomatic
# JS/TS sink; it is exempt from coverage failures under a JS/TS codebase.
JSTS_INAPPLICABLE_CWES=("CWE-134")

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
L1_CATS_ENV="$(IFS='|'; printf '%s' "${L1_CATS[*]}")"
ALLOWED_SEVERITIES_ENV="$ALLOWED_SEVERITIES"

export PROFILE L1 L2 L3B L4 MERGED SINK
export SINK_MAP JSTS_EXEMPT_CWES IS_JSTS L1_CATS_ENV ALLOWED_SEVERITIES_ENV

printf '=== Directive 10 Verification Suite (16 checks) ===\n'
printf 'repo_root=%s  primary_language=%s  js_ts_column=%s\n\n' \
  "$SCRIPT_DIR" "${PRIMARY_LANGUAGE:-<unset>}" "$IS_JSTS"

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
# CHECK 3 -- findings-layer-2-semgrep.json is a valid JSON array, OR layer_2
#            recorded a documented ERROR status (acceptable deterministic-layer
#            outcome).
# =============================================================================
if C3_OUT="$(python3 - <<'PY' 2>&1
import json, os, sys
fn = os.environ['L2']; merged = os.environ['MERGED']
def layer_status(name):
    try:
        d = json.load(open(merged, encoding='utf-8'))
    except Exception:
        return None
    for el in (d if isinstance(d, list) else []):
        if isinstance(el, dict) and '_summary' in el:
            return (el['_summary'].get('layer_status') or {}).get(name)
    return None
err = ''
try:
    d = json.load(open(fn, encoding='utf-8'))
    is_array = isinstance(d, list)
except Exception as exc:
    is_array = False; err = str(exc)
if is_array:
    print('valid JSON array'); sys.exit(0)
if layer_status('layer_2') == 'ERROR':
    print('layer_2 documented ERROR (allowed)'); sys.exit(0)
print('invalid/missing JSON array and layer_2 not documented ERROR%s' % ((': ' + err) if err else ''))
sys.exit(1)
PY
)"; then
  pass "Check 3: findings-layer-2-semgrep.json valid array (or layer_2 documented ERROR) [${C3_OUT}]"
else
  fail "Check 3: findings-layer-2-semgrep.json -- ${C3_OUT}"
fi

# =============================================================================
# CHECK 4 -- sink-inventory.txt exists, is non-empty, EVERY line matches
#            file:::line:::pattern, and covers all 19 sink categories that are
#            APPLICABLE to the detected primary_language (language-aware: a
#            category that is structurally inapplicable to the language is
#            expected-empty and does NOT trigger a failure).
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
        # Category absent -- a failure unless it is JS/TS-exempt under a JS/TS codebase.
        _exempt=0
        if [ "$IS_JSTS" -eq 1 ]; then
          for _cwe in $_cwes; do
            if is_jsts_exempt_cwe "$_cwe"; then _exempt=1; break; fi
          done
        fi
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
# CHECK 7 -- findings-layer-3b-taint.json is a valid JSON array containing
#            findings for all 19 sink categories (language-aware: categories
#            inapplicable to the primary language are expected-empty/exempt).
# =============================================================================
if C7_OUT="$(python3 - <<'PY' 2>&1
import json, os, sys
fn = os.environ['L3B']
sink_map = os.environ['SINK_MAP']
exempt = set(filter(None, os.environ.get('JSTS_EXEMPT_CWES', '').split(',')))
is_jsts = os.environ.get('IS_JSTS', '0') == '1'
try:
    data = json.load(open(fn, encoding='utf-8'))
except Exception as exc:
    print('not valid JSON: %s' % exc); sys.exit(1)
if not isinstance(data, list):
    print('not a JSON array'); sys.exit(1)
present = {f['cwe'] for f in data if isinstance(f, dict) and f.get('cwe')}
missing = []
for entry in sink_map.split('|'):
    name, cwes = entry.split('=', 1)
    cwes = cwes.split(',')
    if any(c in present for c in cwes):
        continue
    if is_jsts and any(c in exempt for c in cwes):
        continue
    missing.append('%s (%s)' % (name, ','.join(cwes)))
if missing:
    print('missing L3b sink categories: %s' % '; '.join(missing)); sys.exit(1)
print('valid array, all applicable sink categories covered'); sys.exit(0)
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
# CHECK 10 -- findings-layer-4-osv.json is a valid JSON array, OR layer_4
#             recorded a documented ERROR status.
# =============================================================================
if C10_OUT="$(python3 - <<'PY' 2>&1
import json, os, sys
fn = os.environ['L4']; merged = os.environ['MERGED']
def layer_status(name):
    try:
        d = json.load(open(merged, encoding='utf-8'))
    except Exception:
        return None
    for el in (d if isinstance(d, list) else []):
        if isinstance(el, dict) and '_summary' in el:
            return (el['_summary'].get('layer_status') or {}).get(name)
    return None
err = ''
try:
    d = json.load(open(fn, encoding='utf-8'))
    is_array = isinstance(d, list)
except Exception as exc:
    is_array = False; err = str(exc)
if is_array:
    print('valid JSON array'); sys.exit(0)
if layer_status('layer_4') == 'ERROR':
    print('layer_4 documented ERROR (allowed)'); sys.exit(0)
print('invalid/missing JSON array and layer_4 not documented ERROR%s' % ((': ' + err) if err else ''))
sys.exit(1)
PY
)"; then
  pass "Check 10: findings-layer-4-osv.json valid array (or layer_4 documented ERROR) [${C10_OUT}]"
else
  fail "Check 10: findings-layer-4-osv.json -- ${C10_OUT}"
fi

# =============================================================================
# CHECK 11 -- findings-merged.json is valid JSON whose _summary counts match
#             the per-layer files: by_layer[k] == len(layer_file) for each
#             layer, and total_findings == sum(by_layer).
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
by_layer = summary.get('by_layer', {}) or {}
problems = []; counts = {}
for key, fn in files.items():
    try:
        d = json.load(open(fn, encoding='utf-8'))
        counts[key] = len(d) if isinstance(d, list) else -1
    except Exception:
        counts[key] = -1
    if counts[key] < 0:
        problems.append('%s unreadable' % key)
    elif by_layer.get(key) != counts[key]:
        problems.append('%s: summary=%r actual=%d' % (key, by_layer.get(key), counts[key]))
total = summary.get('total_findings')
calc = sum(v for v in counts.values() if v >= 0)
if total != calc:
    problems.append('total_findings=%r but sum(by_layer)=%d' % (total, calc))
if problems:
    print('; '.join(problems)); sys.exit(1)
print('summary counts consistent (total_findings=%d)' % calc); sys.exit(0)
PY
)"; then
  pass "Check 11: findings-merged.json _summary counts match the sum of the per-layer files [${C11_OUT}]"
else
  fail "Check 11: findings-merged.json -- ${C11_OUT}"
fi

# =============================================================================
# CHECK 12 -- NO ANSI escape sequence (ESC, 0x1b) appears in ANY output artifact.
# =============================================================================
ESC=$(printf '\033')
C12_BAD=()
for _f in "$PROFILE" "$L1" "$L2" "$L3B" "$L4" "$MERGED" "$SINK" "$SINK_TEST" "$MIT" "$MIT_TEST"; do
  if [ -f "$_f" ] && LC_ALL=C grep -q "$ESC" "$_f"; then
    C12_BAD+=("$_f")
  fi
done
if [ "${#C12_BAD[@]}" -eq 0 ]; then
  pass "Check 12: no ANSI escape sequences present in any output artifact"
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
#             inventoried sink).
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
missing = 0; samples = []
for f in data:
    if not isinstance(f, dict):
        continue
    key = (f.get('file'), str(f.get('line')))
    if key not in pairs:
        missing += 1
        if len(samples) < 5:
            samples.append('%s:%s' % key)
if missing:
    print('%d L3b finding(s) not in sink-inventory.txt (e.g. %s)' % (missing, ', '.join(samples))); sys.exit(1)
print('all L3b findings trace to an inventoried sink file:line'); sys.exit(0)
PY
)"; then
  pass "Check 16: every L3b finding references a file:line present in sink-inventory.txt"
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
# =============================================================================
if [ "$FAILURES" -eq 0 ]; then
  VERIFICATION_STATUS="PASS"
else
  VERIFICATION_STATUS="FAIL"
fi

if [ -f "$MERGED" ]; then
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

