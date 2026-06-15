#!/usr/bin/env bash
# =============================================================================
# verify.sh -- Directive 10: Deterministic Verification Suite
# =============================================================================
# Reviewer-facing, re-runnable proof that the six-layer security audit ran to
# completion and emitted a gate-ready artifact corpus. Encodes 17 deterministic
# checks over the audit artifacts. Each check prints exactly one line:
#     PASS: <description>   or   FAIL: <description>
# The script maintains a FAILURES counter and EXITS with the COUNT of failed
# checks (0 == every check passed). After running the checks it records
# verification_status ("PASS" when zero failures, otherwise "FAIL") into
# findings-merged.json using a deterministic, order-preserving python3 edit.
#
# Design constraints (from the Agent Action Plan / Directive 10):
#   * Self-contained & deterministic: canonical category lists are embedded
#     below; no network access and no external rule fetch. CI/CD can re-run this
#     as an additive gate alongside the existing security-audit.yml npm audit.
#   * Tools only: bash, grep, find, python3 (jq may be absent, so all JSON
#     parsing/validation is performed with python3).
#   * Language-aware: check 4 evaluates only the sink categories applicable to
#     the detected primary_language. For TypeScript/JavaScript the JS/TS pattern
#     column applies and CWE-134 (Format String Injection -- a printf/C-family
#     sink class with no JS/TS analogue) is expected-empty and must NOT fail.
#   * Documented-ERROR allowance: checks 3 and 10 pass when the normalized
#     artifact is absent/invalid IF the corresponding pre-agent layer recorded a
#     documented ERROR status.
#   * ANSI hygiene: artifact text is ANSI-stripped on read (defensive; a no-op
#     on the guaranteed-ANSI-free corpus) so value extraction is robust, and
#     check 12 independently DETECTS any ANSI in the raw artifacts. check 12
#     scans the COMPLETE declared-artifact universe (all 14 artifacts, incl. the
#     raw intermediates results-semgrep.sarif / results-osv.json, rules/.gitignore
#     and this verify.sh itself). This script itself emits NO ANSI escape
#     sequences (ESC / 0x1b): every escape pattern below is written as the
#     literal text "\x1b" (backslash-x-1-b), never a raw ESC byte.
#   * Secret-value hygiene: check 17 scans the same complete artifact universe for
#     committed credential VALUES (Google OAuth/refresh tokens, PEM private keys,
#     AWS/Slack/GitHub tokens) so no raw secret can ship in any deliverable -- raw
#     tool output (SARIF) included.
#   * Self-contained: every check reads ONLY the 14 declared artifacts. Pre-agent
#     layer statuses are sourced from findings-merged.json (_summary.layer_status)
#     and codebase-profile.txt; the Layer-1 per-category coverage oracle is sourced
#     from findings-merged.json (_summary.layer_1_categories). No undeclared
#     side-car status files or helper scripts are required.
#   * Read-only: only repo-root artifacts are read; application source and the
#     audit exclude_dirs (node_modules, .next, dist, build, .yarn, .git,
#     coverage, .turbo) are never touched. The sole write is verification_status
#     into findings-merged.json.
#
# NOTE: 'set -e' is intentionally NOT used. A failing check must not abort the
# suite -- every one of the 17 checks must run so the exit code reflects the
# true failure count. 'set -u'/'pipefail' are likewise avoided to keep the
# harness maximally robust against partial/edge-case inputs.
# =============================================================================

# ---- Resolve repo root (the directory containing this script) ---------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" >/dev/null 2>&1 && pwd)"
cd "$SCRIPT_DIR" 2>/dev/null || {
  printf 'FATAL: unable to change to script directory\n' >&2
  exit 255
}

PY="${PYTHON:-python3}"

# ---- Failure accounting + reporting helpers ---------------------------------
FAILURES=0

pass() { printf 'PASS: %s\n' "$1"; }
fail() { printf 'FAIL: %s\n' "$1"; FAILURES=$((FAILURES + 1)); }

# record <rc> <description> : rc==0 -> PASS, otherwise -> FAIL (+1 to FAILURES).
# Must be invoked from the main shell so the counter increment is preserved.
record() {
  if [ "${1:-1}" -eq 0 ]; then
    pass "$2"
  else
    fail "$2"
  fi
}

# ---- ANSI hygiene -----------------------------------------------------------
# Strip ANSI/ESC sequences from stdin. Used when reading artifact text for value
# extraction. On the guaranteed-ANSI-free corpus this is a byte-identical no-op;
# it makes parsing robust if a stray escape sequence ever slips in. The patterns
# use the literal text "\x1b" (backslash-x-1-b), never a raw ESC byte, so this
# script contains no ANSI. (GNU sed interprets \x1b as the ESC byte.)
ansi_strip() {
  sed -E 's/\x1b\[[0-9;?]*[ -\/]*[@-~]//g; s/\x1b[@-_]//g; s/\x1b//g'
}

# ---- Artifact file names (read-only; all at repo root) ----------------------
# The 14 declared audit artifacts (AAP 0.6.1). Pre-agent layer statuses and the
# Layer-1 per-category coverage oracle live INSIDE these declared artifacts
# (findings-merged.json / codebase-profile.txt), so the suite is self-contained:
# it depends on NO undeclared side-car status files or helper scripts.
PROFILE="codebase-profile.txt"
L1_JSON="findings-layer-1-arch.json"
L2_JSON="findings-layer-2-semgrep.json"
L3B_JSON="findings-layer-3b-taint.json"
L4_JSON="findings-layer-4-osv.json"
MERGED="findings-merged.json"
SINK="sink-inventory.txt"
SINK_TEST="sink-inventory-test.txt"
MIT="mitigation-inventory.txt"
MIT_TEST="mitigation-inventory-test.txt"
# Raw tool intermediates + pinned-rules marker (declared artifacts; subject to
# the ANSI (12) and secret-value (17) hygiene checks).
SARIF="results-semgrep.sarif"
OSV_RAW="results-osv.json"
RULES_GI="rules/.gitignore"
# This verification script itself -- a declared artifact, hence subject to the
# ANSI (12) and secret-value (17) checks (it must never embed an ESC byte or a
# raw credential value).
SELF="$(basename "${BASH_SOURCE[0]:-$0}")"

# Normalized findings JSON files subject to the severity (9) and description
# (13) checks. Raw intermediates (results-semgrep.sarif, results-osv.json) use
# tool-native severity vocabularies and are intentionally excluded.
FINDING_JSON_FILES=("$L1_JSON" "$L2_JSON" "$L3B_JSON" "$L4_JSON" "$MERGED")

# All 14 declared deliverable artifacts, subject to the ANSI-free check (12) and
# the credential-value check (17). The list is authoritative for the complete
# artifact universe -- raw intermediates and this script are intentionally
# included so neither check can pass while a declared artifact is unscanned.
ALL_ARTIFACTS=(
  "$PROFILE" "$L1_JSON" "$L2_JSON" "$L3B_JSON" "$L4_JSON" "$MERGED"
  "$SINK" "$SINK_TEST" "$MIT" "$MIT_TEST"
  "$SARIF" "$OSV_RAW" "$RULES_GI" "$SELF"
)

# ---- Canonical category definitions (single source of truth) ----------------
# The 19 sink categories, CWE-keyed, in the Directive 5 taxonomy order. The
# Cookie Attributes category is satisfied by ANY of its alternative CWEs.
SINK_CATEGORIES=(
  "CWE-601"                      # 1  Open Redirect
  "CWE-918"                      # 2  Server-Side Request Forgery
  "CWE-117"                      # 3  Log Injection
  "CWE-807"                      # 4  Auth Decision on User-Controlled Input
  "CWE-338"                      # 5  Weak PRNG
  "CWE-843"                      # 6  Type Confusion
  "CWE-862"                      # 7  Missing Authorization
  "CWE-79"                       # 8  XSS / DOM Manipulation
  "CWE-134"                      # 9  Format String Injection
  "CWE-250"                      # 10 Property Injection
  "CWE-912"                      # 11 File System Write
  "CWE-1004|CWE-614|CWE-1275"    # 12 Cookie Attributes
  "CWE-639"                      # 13 IDOR / Tenant Isolation
  "CWE-200"                      # 14 Information Disclosure via Query
  "CWE-367"                      # 15 TOCTOU Race Conditions
  "CWE-285"                      # 16 OAuth Scope Validation
  "CWE-94"                       # 17 Code Injection
  "CWE-502"                      # 18 Insecure Deserialization
  "CWE-611"                      # 19 XML External Entity Injection
)

# Sink categories that are structurally inapplicable to the JS/TS pattern
# column and therefore expected-empty (must NOT fail the language-aware check
# 4 when primary_language is TypeScript/JavaScript). CWE-134 (Format String
# Injection) is a printf/C-family sink class with no JS/TS analogue.
SINK_EXEMPT_JS_TS=("CWE-134")

# The 9 mitigation categories (slug-keyed; slugs match the Layer 3a inventory).
MITIGATION_CATEGORIES=(
  "schema-validation" "safe-query" "auth-middleware" "rate-limiting"
  "crypto-protection" "input-sanitization" "csrf-protection"
  "webhook-signature" "timing-safe"
)

# The 10 Layer-1 architectural categories. Slugs match the keys of the L1
# per-category coverage oracle in findings-merged.json _summary.layer_1_categories
# (read by check 2).
L1_CATEGORIES=(
  "cat_1_cryptographic_key_management"
  "cat_2_authentication_session"
  "cat_3_transport_origin"
  "cat_4_request_handling"
  "cat_5_container_cicd"
  "cat_6_incoming_webhook_integration_verification"
  "cat_7_business_domain_input_validation"
  "cat_8_embed_cross_origin_security"
  "cat_9_api_version_security_parity"
  "cat_10_framework_specific_misconfigurations"
)

# ---- Detected primary language (drives the language-aware check 4) ----------
# ANSI-stripped on read so a stray escape sequence cannot corrupt the value.
PRIMARY_LANG="$(
  ansi_strip < "$PROFILE" 2>/dev/null \
    | grep -E '^[[:space:]]*primary_language[[:space:]]*:' \
    | head -n1 \
    | sed -E 's/^[^:]*:[[:space:]]*//; s/[[:space:]]*$//' \
    | tr '[:upper:]' '[:lower:]'
)"

# ---- Reusable python3 helpers -----------------------------------------------
# Returns 0 if $1 exists and parses as a JSON array (list); non-zero otherwise.
# Content is ANSI-stripped before parsing.
is_json_array() {
  "$PY" - "$1" 2>/dev/null <<'PYEOF'
import sys, json, re
_ANSI = re.compile(r'\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b[@-_]|\x1b')
try:
    with open(sys.argv[1], encoding="utf-8", errors="replace") as fh:
        data = json.loads(_ANSI.sub('', fh.read()))
except Exception:
    sys.exit(1)
sys.exit(0 if isinstance(data, list) else 1)
PYEOF
}

# Prints the status string for a layer key (layer_0|layer_2|layer_3a|layer_4).
# Self-contained resolution order, reading ONLY declared artifacts:
#   1. findings-merged.json  _summary.layer_status[key]   (authoritative)
#   2. codebase-profile.txt  layer_0_status               (layer_0 fallback only)
# All inputs are ANSI-stripped on read. Prints "" when no status is recorded.
get_layer_status() {
  "$PY" - "$1" "$MERGED" "$PROFILE" 2>/dev/null <<'PYEOF'
import sys, json, re
_ANSI = re.compile(r'\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b[@-_]|\x1b')

def _read(p):
    with open(p, encoding="utf-8", errors="replace") as fh:
        return _ANSI.sub('', fh.read())

key = sys.argv[1]
merged, profile = sys.argv[2:4]

def from_merged():
    try:
        d = json.loads(_read(merged))
        ls = d[0].get("_summary", {}).get("layer_status", {})
        v = ls.get(key)
        return v.strip() if isinstance(v, str) and v.strip() else ""
    except Exception:
        return ""

def from_text(path, field):
    try:
        for line in _read(path).splitlines():
            m = re.match(r'\s*%s\s*:\s*(\S+)' % re.escape(field), line)
            if m:
                return m.group(1).strip()
    except Exception:
        pass
    return ""

status = from_merged()
# Layer 0 is additionally guaranteed directly in the codebase-profile.txt
# declared artifact; use it as the sole text fallback when the merged summary
# has not recorded the status.
if not status and key == "layer_0":
    status = from_text(profile, "layer_0_status")
sys.stdout.write(status)
PYEOF
}

# =============================================================================
# The 17 deterministic checks
# =============================================================================

# Check 1 -- codebase-profile.txt exists AND primary_language is populated.
check_1() {
  if [ ! -f "$PROFILE" ]; then
    record 1 "Check 1: $PROFILE exists with a populated primary_language (file missing)"
    return
  fi
  if [ -n "$PRIMARY_LANG" ]; then
    record 0 "Check 1: $PROFILE exists and primary_language is populated ($PRIMARY_LANG)"
  else
    record 1 "Check 1: $PROFILE primary_language is missing or empty"
  fi
}

# Check 2 -- findings-layer-1-arch.json is a valid, non-empty JSON array AND all
# 10 Layer-1 architectural categories are covered. L1 findings carry no category
# field, so coverage is read from the declared merged report's coverage oracle:
# findings-merged.json _summary.layer_1_categories[<cat>] == "covered". This
# keeps the check self-contained within the 14-artifact contract (no undeclared
# side-car status file is required).
check_2() {
  if ! is_json_array "$L1_JSON"; then
    record 1 "Check 2: $L1_JSON valid JSON array + all 10 L1 categories ($L1_JSON is not a valid JSON array)"
    return
  fi
  local l1_len
  l1_len="$("$PY" - "$L1_JSON" 2>/dev/null <<'PYEOF'
import sys, json, re
_ANSI = re.compile(r'\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b[@-_]|\x1b')
try:
    with open(sys.argv[1], encoding="utf-8", errors="replace") as fh:
        print(len(json.loads(_ANSI.sub('', fh.read()))))
except Exception:
    print(0)
PYEOF
)"
  if [ "${l1_len:-0}" -eq 0 ] 2>/dev/null; then
    record 1 "Check 2: $L1_JSON is an empty JSON array (no L1 findings)"
    return
  fi
  # Read the L1 per-category coverage oracle from the merged report and report
  # any of the 10 mandatory categories not marked "covered". Inputs ANSI-stripped.
  local missing
  missing="$("$PY" - "$MERGED" "${L1_CATEGORIES[@]}" 2>/dev/null <<'PYEOF'
import sys, json, re
_ANSI = re.compile(r'\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b[@-_]|\x1b')
merged, cats = sys.argv[1], sys.argv[2:]
try:
    with open(merged, encoding="utf-8", errors="replace") as fh:
        d = json.loads(_ANSI.sub('', fh.read()))
    cov = d[0].get("_summary", {}).get("layer_1_categories", {})
    if not isinstance(cov, dict):
        cov = {}
except Exception:
    cov = None
if cov is None:
    print("ORACLE_MISSING"); sys.exit(0)
miss = [c for c in cats if str(cov.get(c, "")).strip().lower() != "covered"]
print(" ".join(miss))
PYEOF
)"
  if [ "$missing" = "ORACLE_MISSING" ]; then
    record 1 "Check 2: L1 category coverage oracle (_summary.layer_1_categories) is missing from $MERGED"
  elif [ -z "$missing" ]; then
    record 0 "Check 2: $L1_JSON valid non-empty array; all 10 L1 architectural categories covered"
  else
    record 1 "Check 2: L1 categories not covered: $missing"
  fi
}

# Check 3 -- findings-layer-2-semgrep.json is a valid JSON array, OR layer_2 is
# a documented ERROR.
check_3() {
  if is_json_array "$L2_JSON"; then
    record 0 "Check 3: $L2_JSON is a valid JSON array"
    return
  fi
  local st
  st="$(get_layer_status layer_2)"
  if [ "$st" = "ERROR" ]; then
    record 0 "Check 3: $L2_JSON absent/invalid but layer_2_status=ERROR (documented)"
  else
    record 1 "Check 3: $L2_JSON is not a valid JSON array and layer_2_status is not a documented ERROR (got '${st:-<missing>}')"
  fi
}

# Check 4 -- sink-inventory.txt exists, is non-empty, every line matches
# file:::line:::pattern, and all sink categories APPLICABLE to the detected
# primary_language are present (language-aware; CWE-134 is exempt for JS/TS).
# Each inventory line is ANSI-stripped before parsing.
check_4() {
  local detail
  if detail="$("$PY" - "$SINK" "$PRIMARY_LANG" "${SINK_CATEGORIES[@]}" "--exempt" "${SINK_EXEMPT_JS_TS[@]}" 2>/dev/null <<'PYEOF'
import sys, os, re
_ANSI = re.compile(r'\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b[@-_]|\x1b')
args = sys.argv[1:]
path, lang = args[0], args[1].lower()
rest = args[2:]
if "--exempt" in rest:
    i = rest.index("--exempt")
    cats, exempt = rest[:i], rest[i + 1:]
else:
    cats, exempt = rest, []
if not os.path.isfile(path):
    print("file missing"); sys.exit(1)
lines = bad = 0
present = set()
with open(path, encoding="utf-8", errors="replace") as fh:
    for raw in fh:
        line = _ANSI.sub('', raw.rstrip("\n"))
        if line == "":
            continue
        lines += 1
        parts = line.split(":::")
        if len(parts) < 3 or not parts[0].strip() or not parts[1].strip().isdigit():
            bad += 1
            continue
        m = re.match(r'\s*\[([^\]]+)\]', parts[2])
        if m:
            present.add(m.group(1).strip())
if lines == 0:
    print("inventory is empty"); sys.exit(1)
if bad > 0:
    print("%d line(s) do not match file:::line:::pattern" % bad); sys.exit(1)
js_ts = lang in ("typescript", "javascript", "ts", "js", "tsx", "jsx", "node")
missing = []
for cat in cats:
    alts = cat.split("|")
    if js_ts and all(a in exempt for a in alts):
        continue  # expected-empty / structurally inapplicable for JS/TS
    if not any(a in present for a in alts):
        missing.append(cat)
if missing:
    print("applicable sink categories missing: " + ",".join(missing)); sys.exit(1)
print("%d lines well-formed; %d applicable sink categories present" % (lines, len(present)))
sys.exit(0)
PYEOF
)"; then
    record 0 "Check 4: $SINK non-empty, every line file:::line:::pattern, applicable sink categories present [$detail]"
  else
    record 1 "Check 4: $SINK invalid ($detail)"
  fi
}

# Check 5 -- mitigation-inventory.txt exists, is non-empty, and covers all 9
# mitigation categories. Content is ANSI-stripped before matching.
check_5() {
  if [ ! -s "$MIT" ]; then
    record 1 "Check 5: $MIT is missing or empty"
    return
  fi
  local mit_clean
  mit_clean="$(ansi_strip < "$MIT" 2>/dev/null)"
  local missing=()
  local slug
  for slug in "${MITIGATION_CATEGORIES[@]}"; do
    if ! printf '%s\n' "$mit_clean" | grep -Fq ":::[$slug]"; then
      missing+=("$slug")
    fi
  done
  if [ "${#missing[@]}" -eq 0 ]; then
    record 0 "Check 5: $MIT non-empty; all 9 mitigation categories present"
  else
    record 1 "Check 5: mitigation categories missing: ${missing[*]}"
  fi
}

# Check 6 -- the two test-file inventory variants both exist.
check_6() {
  local miss=()
  [ -f "$SINK_TEST" ] || miss+=("$SINK_TEST")
  [ -f "$MIT_TEST" ] || miss+=("$MIT_TEST")
  if [ "${#miss[@]}" -eq 0 ]; then
    record 0 "Check 6: $SINK_TEST and $MIT_TEST both exist"
  else
    record 1 "Check 6: missing test inventory file(s): ${miss[*]}"
  fi
}

# Check 7 -- findings-layer-3b-taint.json is a valid JSON array containing
# findings for all 19 sink categories (matched on the cwe field; Cookie
# Attributes satisfied by any of its alternative CWEs).
check_7() {
  local detail
  if detail="$("$PY" - "$L3B_JSON" "${SINK_CATEGORIES[@]}" 2>/dev/null <<'PYEOF'
import sys, os, json, re
_ANSI = re.compile(r'\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b[@-_]|\x1b')
args = sys.argv[1:]
path, cats = args[0], args[1:]
if not os.path.isfile(path):
    print("file missing"); sys.exit(1)
try:
    with open(path, encoding="utf-8", errors="replace") as fh:
        data = json.loads(_ANSI.sub('', fh.read()))
except Exception as e:
    print("invalid JSON: %s" % e); sys.exit(1)
if not isinstance(data, list):
    print("not a JSON array"); sys.exit(1)
cwes = {d.get("cwe", "").strip() for d in data if isinstance(d, dict) and isinstance(d.get("cwe"), str)}
missing = [c for c in cats if not any(a in cwes for a in c.split("|"))]
if missing:
    print("missing findings for sink categories: " + ",".join(missing)); sys.exit(1)
print("%d findings covering all 19 sink categories" % len(data))
sys.exit(0)
PYEOF
)"; then
    record 0 "Check 7: $L3B_JSON valid array with findings for all 19 sink categories [$detail]"
  else
    record 1 "Check 7: $L3B_JSON ($detail)"
  fi
}

# Check 8 -- every L3b finding carries a gateBlocking field, and every finding
# with gateBlocking==false carries a non-empty demotionReason.
check_8() {
  local detail
  if detail="$("$PY" - "$L3B_JSON" 2>/dev/null <<'PYEOF'
import sys, json, re
_ANSI = re.compile(r'\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b[@-_]|\x1b')
try:
    with open(sys.argv[1], encoding="utf-8", errors="replace") as fh:
        data = json.loads(_ANSI.sub('', fh.read()))
    assert isinstance(data, list)
except Exception as e:
    print("invalid L3b JSON: %s" % e); sys.exit(1)
no_gb = no_dr = 0
for d in data:
    if not isinstance(d, dict):
        continue
    if "gateBlocking" not in d:
        no_gb += 1
        continue
    if d.get("gateBlocking") is False and not str(d.get("demotionReason", "")).strip():
        no_dr += 1
if no_gb or no_dr:
    print("%d finding(s) missing gateBlocking; %d advisory finding(s) missing demotionReason" % (no_gb, no_dr))
    sys.exit(1)
print("all %d findings have gateBlocking; all advisories have a demotionReason" % len(data))
sys.exit(0)
PYEOF
)"; then
    record 0 "Check 8: every L3b finding has gateBlocking; advisories have demotionReason [$detail]"
  else
    record 1 "Check 8: $detail"
  fi
}

# Check 9 -- every severity field across all normalized findings JSON files
# uses ONLY the unified vocabulary: critical|high|medium|low. Content is
# ANSI-stripped before parsing.
check_9() {
  local detail
  if detail="$("$PY" - "${FINDING_JSON_FILES[@]}" 2>/dev/null <<'PYEOF'
import sys, os, json, re
_ANSI = re.compile(r'\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b[@-_]|\x1b')
allowed = {"critical", "high", "medium", "low"}
bad = []

def severities(obj):
    if isinstance(obj, dict):
        for k, v in obj.items():
            if k == "severity" and isinstance(v, str):
                yield v
            else:
                yield from severities(v)
    elif isinstance(obj, list):
        for it in obj:
            yield from severities(it)

for path in sys.argv[1:]:
    if not os.path.isfile(path):
        continue
    try:
        with open(path, encoding="utf-8", errors="replace") as fh:
            data = json.loads(_ANSI.sub('', fh.read()))
    except Exception:
        continue
    for sev in severities(data):
        if sev.strip().lower() not in allowed:
            bad.append("%s:%r" % (os.path.basename(path), sev))
if bad:
    print("invalid severity value(s): " + ", ".join(bad[:10])); sys.exit(1)
print("all severity fields use critical|high|medium|low"); sys.exit(0)
PYEOF
)"; then
    record 0 "Check 9: severity vocabulary is exactly critical|high|medium|low across all findings JSON [$detail]"
  else
    record 1 "Check 9: $detail"
  fi
}

# Check 10 -- findings-layer-4-osv.json is a valid JSON array, OR layer_4 is a
# documented ERROR.
check_10() {
  if is_json_array "$L4_JSON"; then
    record 0 "Check 10: $L4_JSON is a valid JSON array"
    return
  fi
  local st
  st="$(get_layer_status layer_4)"
  if [ "$st" = "ERROR" ]; then
    record 0 "Check 10: $L4_JSON absent/invalid but layer_4_status=ERROR (documented)"
  else
    record 1 "Check 10: $L4_JSON is not a valid JSON array and layer_4_status is not a documented ERROR (got '${st:-<missing>}')"
  fi
}

# Check 11 -- findings-merged.json is valid JSON and its _summary by_layer
# counts reconcile with the per-layer findings files (with the documented-ERROR
# allowance for absent L2/L4), and total/unique counts are internally
# consistent. All inputs are ANSI-stripped before parsing.
check_11() {
  local detail
  if detail="$("$PY" - "$MERGED" "$L1_JSON" "$L2_JSON" "$L3B_JSON" "$L4_JSON" 2>/dev/null <<'PYEOF'
import sys, os, json, re
_ANSI = re.compile(r'\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b[@-_]|\x1b')
merged, l1, l2, l3b, l4 = sys.argv[1:6]

def load(p):
    try:
        with open(p, encoding="utf-8", errors="replace") as fh:
            return json.loads(_ANSI.sub('', fh.read()))
    except Exception:
        return None

m = load(merged)
if not isinstance(m, list) or not m or not isinstance(m[0], dict) or "_summary" not in m[0]:
    print("findings-merged.json missing or has no _summary header"); sys.exit(1)
summ = m[0]["_summary"]
by_layer = summ.get("by_layer", {})

def n(p):
    d = load(p)
    return len(d) if isinstance(d, list) else None

counts = {
    "arch-audit": n(l1),
    "semgrep": n(l2),
    "taint-analysis": n(l3b),
    "osv-scanner": n(l4),
}
problems = []
expected_total = 0
for key, actual in counts.items():
    reported = by_layer.get(key)
    if actual is None:
        # Layer file absent/invalid: tolerated only when reported count is 0.
        if reported not in (0, None):
            problems.append("%s file absent but summary reports %s" % (key, reported))
        continue
    expected_total += actual
    if reported != actual:
        problems.append("%s: summary=%s actual=%s" % (key, reported, actual))

# Cross-check the headline totals against the findings body (m[1:]).
body = len(m) - 1
tf = summ.get("total_findings")
uf = summ.get("unique_findings")
if isinstance(tf, int) and tf != expected_total:
    problems.append("total_findings=%s != sum(by_layer present)=%s" % (tf, expected_total))
if isinstance(uf, int) and uf != body:
    problems.append("unique_findings=%s != merged body length=%s" % (uf, body))

if problems:
    print("; ".join(problems)); sys.exit(1)
print("by_layer reconciles (sum=%d); body=%d findings" % (expected_total, body)); sys.exit(0)
PYEOF
)"; then
    record 0 "Check 11: $MERGED valid; _summary counts reconcile with per-layer files [$detail]"
  else
    record 1 "Check 11: $detail"
  fi
}

# Check 12 -- NO ANSI escape sequences (ESC / 0x1b) appear in ANY output file.
# grep -P matches the raw ESC byte; this check operates on the RAW bytes (no
# stripping) precisely so it DETECTS any ANSI present in the artifacts.
check_12() {
  local dirty=()
  local f
  for f in "${ALL_ARTIFACTS[@]}"; do
    [ -f "$f" ] || continue
    if grep -qP '\x1b' "$f" 2>/dev/null; then
      dirty+=("$f")
    fi
  done
  if [ "${#dirty[@]}" -eq 0 ]; then
    record 0 "Check 12: no ANSI escape sequences in any output artifact"
  else
    record 1 "Check 12: ANSI escape sequences found in: ${dirty[*]}"
  fi
}

# Check 13 -- no finding in any normalized findings JSON file has an empty or
# missing description. Content is ANSI-stripped before parsing.
check_13() {
  local detail
  if detail="$("$PY" - "${FINDING_JSON_FILES[@]}" 2>/dev/null <<'PYEOF'
import sys, os, json, re
_ANSI = re.compile(r'\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b[@-_]|\x1b')
bad = 0
seen = 0
for path in sys.argv[1:]:
    if not os.path.isfile(path):
        continue
    try:
        with open(path, encoding="utf-8", errors="replace") as fh:
            data = json.loads(_ANSI.sub('', fh.read()))
    except Exception:
        continue
    if not isinstance(data, list):
        continue
    for d in data:
        if not isinstance(d, dict) or "_summary" in d:
            continue  # skip the merged-report summary header element
        seen += 1
        if not str(d.get("description", "")).strip():
            bad += 1
if bad:
    print("%d finding(s) have an empty/missing description" % bad); sys.exit(1)
print("all %d findings have a non-empty description" % seen); sys.exit(0)
PYEOF
)"; then
    record 0 "Check 13: every finding has a non-empty description [$detail]"
  else
    record 1 "Check 13: $detail"
  fi
}

# Check 14 -- findings-merged.json contains a gate_verdict in the allowed set.
# Content is ANSI-stripped before parsing.
check_14() {
  local detail
  if detail="$("$PY" - "$MERGED" 2>/dev/null <<'PYEOF'
import sys, json, re
_ANSI = re.compile(r'\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b[@-_]|\x1b')
allowed = {"ERROR", "BLOCK", "WARN", "PASS"}
try:
    with open(sys.argv[1], encoding="utf-8", errors="replace") as fh:
        data = json.loads(_ANSI.sub('', fh.read()))
except Exception as e:
    print("invalid JSON: %s" % e); sys.exit(1)

def find_verdict(obj):
    if isinstance(obj, dict):
        if isinstance(obj.get("gate_verdict"), str):
            return obj["gate_verdict"]
        for v in obj.values():
            r = find_verdict(v)
            if r is not None:
                return r
    elif isinstance(obj, list):
        for it in obj:
            r = find_verdict(it)
            if r is not None:
                return r
    return None

v = find_verdict(data)
if v is None:
    print("gate_verdict field is absent"); sys.exit(1)
if v not in allowed:
    print("gate_verdict=%r not in {ERROR,BLOCK,WARN,PASS}" % v); sys.exit(1)
print("gate_verdict=%s" % v); sys.exit(0)
PYEOF
)"; then
    record 0 "Check 14: $MERGED has a valid gate_verdict [$detail]"
  else
    record 1 "Check 14: $detail"
  fi
}

# Check 15 -- no pre-agent step has a silent failure: layer_0_status,
# layer_2_status, layer_3a_status, layer_4_status MUST each be present (a
# MISSING status is a FAIL; any present value -- including ERROR -- is recorded,
# not silent). layer_0 is additionally required directly in codebase-profile.txt
# (ANSI-stripped on read).
check_15() {
  local missing=()
  local key
  for key in layer_0 layer_2 layer_3a layer_4; do
    local st
    st="$(get_layer_status "$key")"
    if [ -z "$st" ]; then
      missing+=("${key}_status")
    fi
  done
  # layer_0_status must be directly present in codebase-profile.txt.
  if ! ansi_strip < "$PROFILE" 2>/dev/null | grep -Eq '^[[:space:]]*layer_0_status[[:space:]]*:[[:space:]]*\S'; then
    case " ${missing[*]} " in
      *" layer_0_status "*) : ;;
      *) missing+=("layer_0_status(profile)") ;;
    esac
  fi
  if [ "${#missing[@]}" -eq 0 ]; then
    record 0 "Check 15: all pre-agent statuses present (layer_0, layer_2, layer_3a, layer_4)"
  else
    record 1 "Check 15: pre-agent status(es) missing (silent failure): ${missing[*]}"
  fi
}

# Check 16 -- every L3b finding references a file:line pair present in
# sink-inventory.txt. The sink inventory text and the L3b JSON are both
# ANSI-stripped on read.
check_16() {
  local detail
  if detail="$("$PY" - "$L3B_JSON" "$SINK" 2>/dev/null <<'PYEOF'
import sys, os, json, re
_ANSI = re.compile(r'\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b[@-_]|\x1b')
l3b, sink = sys.argv[1], sys.argv[2]
if not os.path.isfile(sink):
    print("%s missing" % os.path.basename(sink)); sys.exit(1)

def norm(p):
    p = (p or "").strip()
    return p[2:] if p.startswith("./") else p

pairs = set()
with open(sink, encoding="utf-8", errors="replace") as fh:
    for line in fh:
        line = _ANSI.sub('', line)
        parts = line.split(":::")
        if len(parts) >= 2 and parts[1].strip().isdigit():
            pairs.add((norm(parts[0]), parts[1].strip()))

try:
    with open(l3b, encoding="utf-8", errors="replace") as fh:
        data = json.loads(_ANSI.sub('', fh.read()))
    assert isinstance(data, list)
except Exception as e:
    print("invalid L3b JSON: %s" % e); sys.exit(1)

missing = []
for d in data:
    if not isinstance(d, dict):
        continue
    f = norm(d.get("file", ""))
    ln = d.get("line")
    ln = str(ln).strip() if ln is not None else ""
    if (f, ln) not in pairs:
        missing.append("%s:%s" % (d.get("file", "?"), d.get("line", "?")))
if missing:
    print("%d L3b finding(s) not in sink-inventory: %s" % (len(missing), ", ".join(missing[:8])))
    sys.exit(1)
print("all %d L3b findings reference a sink-inventory file:line pair" % len(data)); sys.exit(0)
PYEOF
)"; then
    record 0 "Check 16: every L3b finding maps to a sink-inventory file:line pair [$detail]"
  else
    record 1 "Check 16: $detail"
  fi
}

# Check 17 -- NO committed credential VALUE appears in ANY declared artifact.
# Scans the complete artifact universe (ALL_ARTIFACTS, all 14 declared
# artifacts) on RAW bytes for industry-standard credential-value formats. Raw
# tool output (results-semgrep.sarif, results-osv.json) is included so a secret
# matched by a scanner can never ship unredacted -- this is the deterministic
# guard for the binding "no secret VALUES leaked in any artifact" requirement.
# The patterns are prefix-anchored and high-signal: they match actual secret
# material, NOT key names, CWE ids, file paths, fingerprints, or prose, so the
# check is deterministic with no false positives on the clean corpus. The FAIL
# message names only the artifact + credential TYPE, never the matched value, so
# the verifier itself can never leak a secret.
check_17() {
  local detail
  if detail="$("$PY" - "${ALL_ARTIFACTS[@]}" 2>/dev/null <<'PYEOF'
import sys, os, re
PATTERNS = [
    ("google-oauth-access-token",  re.compile(r"ya29\.[0-9A-Za-z._\-]{20,}")),
    ("google-oauth-refresh-token", re.compile(r"1//[0-9A-Za-z_\-]{30,}")),
    ("pem-private-key",            re.compile(r"-----BEGIN[ A-Za-z]*PRIVATE KEY-----")),
    ("aws-access-key-id",          re.compile(r"AKIA[0-9A-Z]{16}")),
    ("slack-token",                re.compile(r"xox[baprs]-[0-9A-Za-z\-]{10,}")),
    ("github-token",               re.compile(r"gh[pousr]_[0-9A-Za-z]{36,}")),
]
hits = []
scanned = 0
for path in sys.argv[1:]:
    if not os.path.isfile(path):
        continue
    scanned += 1
    try:
        with open(path, encoding="utf-8", errors="replace") as fh:
            text = fh.read()
    except Exception:
        continue
    for label, rx in PATTERNS:
        if rx.search(text):
            # Record artifact + credential TYPE only -- never the matched value.
            hits.append("%s:%s" % (os.path.basename(path), label))
if hits:
    print("; ".join(sorted(set(hits)))); sys.exit(1)
print("no credential values across %d artifacts" % scanned); sys.exit(0)
PYEOF
)"; then
    record 0 "Check 17: no committed credential values in any output artifact [$detail]"
  else
    record 1 "Check 17: credential value(s) detected in: $detail"
  fi
}

# =============================================================================
# Run all checks in order, then record verification_status and exit.
# =============================================================================
printf '=== Directive 10 verification suite ===\n'

check_1
check_2
check_3
check_4
check_5
check_6
check_7
check_8
check_9
check_10
check_11
check_12
check_13
check_14
check_15
check_16
check_17

printf -- '----------------------------------------\n'
if [ "$FAILURES" -eq 0 ]; then
  VERIFICATION_STATUS="PASS"
else
  VERIFICATION_STATUS="FAIL"
fi
printf 'RESULT: %s (%d check(s) failed)\n' "$VERIFICATION_STATUS" "$FAILURES"

# ---- Record verification_status into findings-merged.json -------------------
# Deterministic, order-preserving edit: set _summary-sibling field
# "verification_status" on the report header element. The file is rewritten as
# minified JSON with a trailing newline (matching the corpus's existing on-disk
# format) so an unchanged status produces a byte-identical file (idempotent).
# The merged report is guaranteed ANSI-free by check 12, so the write-back
# parses it directly.
if [ -f "$MERGED" ]; then
  "$PY" - "$MERGED" "$VERIFICATION_STATUS" <<'PYEOF'
import sys, json
path, status = sys.argv[1], sys.argv[2]
try:
    with open(path, encoding="utf-8") as fh:
        data = json.load(fh)
except Exception as e:
    sys.stderr.write("WARN: could not parse %s to record verification_status: %s\n" % (path, e))
    sys.exit(0)
if isinstance(data, list) and data and isinstance(data[0], dict):
    data[0]["verification_status"] = status
elif isinstance(data, dict):
    data["verification_status"] = status
else:
    sys.stderr.write("WARN: unexpected %s structure; verification_status not recorded\n" % path)
    sys.exit(0)
with open(path, "w", encoding="utf-8") as fh:
    fh.write(json.dumps(data, separators=(",", ":"), ensure_ascii=False) + "\n")
sys.stderr.write("recorded verification_status=%s into %s\n" % (status, path))
PYEOF
else
  printf 'WARN: %s not found; verification_status not recorded\n' "$MERGED" >&2
fi

exit "$FAILURES"

