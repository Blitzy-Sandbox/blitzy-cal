#!/usr/bin/env bash
# =============================================================================
# verify.sh -- Directive 10: Deterministic Verification Suite
# =============================================================================
# Reviewer-facing, re-runnable proof that the six-layer security audit ran to
# completion and emitted a gate-ready artifact corpus. Encodes 16 deterministic
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
#   * Output hygiene: this script emits NO ANSI escape sequences (ESC / 0x1b).
#   * Read-only: only repo-root artifacts are read; application source and the
#     audit exclude_dirs (node_modules, .next, dist, build, .yarn, .git,
#     coverage, .turbo) are never touched.
#
# NOTE: 'set -e' is intentionally NOT used. A failing check must not abort the
# suite -- every one of the 16 checks must run so the exit code reflects the
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

# ---- Artifact file names (read-only; all at repo root) ----------------------
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

# Auxiliary per-layer coverage/status records emitted by the pipeline. These are
# the agent layers' mandated "no silent failure / no dropped category" records
# (AAP 0.2.1) and serve as deterministic coverage oracles for checks 2 and 15.
L1_STATUS="layer-1-status.txt"
L2_STATUS="layer-2-status.txt"
L3A_STATUS="layer-3a-status.txt"
L4_STATUS="layer-4-status.txt"

# Normalized findings JSON files subject to the severity (9) and description
# (13) checks. Raw intermediates (results-semgrep.sarif, results-osv.json) use
# tool-native severity vocabularies and are intentionally excluded.
FINDING_JSON_FILES=("$L1_JSON" "$L2_JSON" "$L3B_JSON" "$L4_JSON" "$MERGED")

# All deliverable artifacts subject to the ANSI-free check (12).
ALL_ARTIFACTS=(
  "$PROFILE" "$L1_JSON" "$L2_JSON" "$L3B_JSON" "$L4_JSON" "$MERGED"
  "$SINK" "$SINK_TEST" "$MIT" "$MIT_TEST"
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

# The 10 Layer-1 architectural categories. Slugs match the cat_<n>_<slug> lines
# emitted in layer-1-status.txt (the L1 per-category coverage oracle).
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
PRIMARY_LANG="$(
  grep -E '^[[:space:]]*primary_language[[:space:]]*:' "$PROFILE" 2>/dev/null \
    | head -n1 \
    | sed -E 's/^[^:]*:[[:space:]]*//; s/[[:space:]]*$//' \
    | tr '[:upper:]' '[:lower:]'
)"

# ---- Reusable python3 helpers -----------------------------------------------
# Returns 0 if $1 exists and parses as a JSON array (list); non-zero otherwise.
is_json_array() {
  "$PY" - "$1" 2>/dev/null <<'PYEOF'
import sys, json
try:
    with open(sys.argv[1], encoding="utf-8") as fh:
        data = json.load(fh)
except Exception:
    sys.exit(1)
sys.exit(0 if isinstance(data, list) else 1)
PYEOF
}

# Prints the status string for a layer key (layer_0|layer_2|layer_3a|layer_4).
# Resolution order: findings-merged.json _summary.layer_status[key], then the
# canonical pre-agent text record (codebase-profile.txt / layer-N-status.txt).
# Prints the empty string when no status is recorded anywhere.
get_layer_status() {
  "$PY" - "$1" "$MERGED" "$PROFILE" "$L2_STATUS" "$L3A_STATUS" "$L4_STATUS" 2>/dev/null <<'PYEOF'
import sys, json, re
key = sys.argv[1]
merged, profile, l2s, l3as, l4s = sys.argv[2:7]

def from_merged():
    try:
        with open(merged, encoding="utf-8") as fh:
            d = json.load(fh)
        ls = d[0].get("_summary", {}).get("layer_status", {})
        v = ls.get(key)
        return v.strip() if isinstance(v, str) and v.strip() else ""
    except Exception:
        return ""

def from_text(path, field):
    try:
        with open(path, encoding="utf-8", errors="replace") as fh:
            for line in fh:
                m = re.match(r'\s*%s\s*:\s*(\S+)' % re.escape(field), line)
                if m:
                    return m.group(1).strip()
    except Exception:
        pass
    return ""

status = from_merged()
if not status:
    field = key + "_status"
    src = {"layer_0": profile, "layer_2": l2s, "layer_3a": l3as, "layer_4": l4s}.get(key, "")
    if src:
        status = from_text(src, field)
sys.stdout.write(status)
PYEOF
}

# =============================================================================
# The 16 deterministic checks
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
# 10 Layer-1 architectural categories are covered (per the layer-1-status.txt
# per-category coverage oracle; L1 findings carry no category field).
check_2() {
  if ! is_json_array "$L1_JSON"; then
    record 1 "Check 2: $L1_JSON valid JSON array + all 10 L1 categories ($L1_JSON is not a valid JSON array)"
    return
  fi
  local l1_len
  l1_len="$("$PY" - "$L1_JSON" 2>/dev/null <<'PYEOF'
import sys, json
try:
    print(len(json.load(open(sys.argv[1], encoding="utf-8"))))
except Exception:
    print(0)
PYEOF
)"
  if [ "${l1_len:-0}" -eq 0 ] 2>/dev/null; then
    record 1 "Check 2: $L1_JSON is an empty JSON array (no L1 findings)"
    return
  fi
  if [ ! -f "$L1_STATUS" ]; then
    record 1 "Check 2: L1 category coverage oracle $L1_STATUS is missing"
    return
  fi
  local missing=()
  local cat
  for cat in "${L1_CATEGORIES[@]}"; do
    if ! grep -Eq "^[[:space:]]*${cat}[[:space:]]*:[[:space:]]*covered" "$L1_STATUS"; then
      missing+=("$cat")
    fi
  done
  if [ "${#missing[@]}" -eq 0 ]; then
    record 0 "Check 2: $L1_JSON valid non-empty array; all 10 L1 architectural categories covered"
  else
    record 1 "Check 2: L1 categories not covered: ${missing[*]}"
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
check_4() {
  local detail
  if detail="$("$PY" - "$SINK" "$PRIMARY_LANG" "${SINK_CATEGORIES[@]}" "--exempt" "${SINK_EXEMPT_JS_TS[@]}" 2>/dev/null <<'PYEOF'
import sys, os, re
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
        line = raw.rstrip("\n")
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
# mitigation categories.
check_5() {
  if [ ! -s "$MIT" ]; then
    record 1 "Check 5: $MIT is missing or empty"
    return
  fi
  local missing=()
  local slug
  for slug in "${MITIGATION_CATEGORIES[@]}"; do
    if ! grep -Fq ":::[$slug]" "$MIT"; then
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
import sys, os, json
args = sys.argv[1:]
path, cats = args[0], args[1:]
if not os.path.isfile(path):
    print("file missing"); sys.exit(1)
try:
    with open(path, encoding="utf-8") as fh:
        data = json.load(fh)
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
import sys, os, json
path = sys.argv[1]
try:
    with open(path, encoding="utf-8") as fh:
        data = json.load(fh)
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

# Check 9 -- every severity field across the normalized findings JSON files uses
# only the unified vocabulary: critical | high | medium | low.
check_9() {
  local detail
  if detail="$("$PY" - "${FINDING_JSON_FILES[@]}" 2>/dev/null <<'PYEOF'
import sys, os, json
allowed = {"critical", "high", "medium", "low"}

def severities(o):
    out = []
    if isinstance(o, dict):
        for k, v in o.items():
            if k == "severity" and isinstance(v, str):
                out.append(v)
            else:
                out += severities(v)
    elif isinstance(o, list):
        for it in o:
            out += severities(it)
    return out

bad = {}
for p in sys.argv[1:]:
    if not os.path.isfile(p):
        continue
    try:
        with open(p, encoding="utf-8") as fh:
            data = json.load(fh)
    except Exception:
        print("%s: invalid JSON" % p); sys.exit(1)
    invalid = sorted(set(severities(data)) - allowed)
    if invalid:
        bad[p] = invalid
if bad:
    print("; ".join("%s -> %s" % (p, v) for p, v in bad.items())); sys.exit(1)
print("all severity values within {critical,high,medium,low}")
sys.exit(0)
PYEOF
)"; then
    record 0 "Check 9: all severity fields use only critical|high|medium|low [$detail]"
  else
    record 1 "Check 9: disallowed severity value(s) -- $detail"
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

# Check 11 -- findings-merged.json is valid JSON and its _summary counts
# reconcile with the per-layer files: by_layer == per-file lengths,
# total_findings == sum(by_layer), unique_findings == merged finding count.
check_11() {
  local detail
  if detail="$("$PY" - "$MERGED" "$L1_JSON" "$L2_JSON" "$L3B_JSON" "$L4_JSON" 2>/dev/null <<'PYEOF'
import sys, json
merged, l1, l2, l3b, l4 = sys.argv[1:6]

def arr(p):
    with open(p, encoding="utf-8") as fh:
        d = json.load(fh)
    if not isinstance(d, list):
        raise ValueError("%s is not a JSON array" % p)
    return d

try:
    M = arr(merged)
    summ = M[0].get("_summary")
    if not isinstance(summ, dict):
        raise ValueError("findings-merged.json has no _summary header")
    by = summ.get("by_layer", {}) or {}
    counts = {
        "arch-audit": len(arr(l1)),
        "semgrep": len(arr(l2)),
        "taint-analysis": len(arr(l3b)),
        "osv-scanner": len(arr(l4)),
    }
except Exception as e:
    print("error: %s" % e); sys.exit(1)

errs = []
for k, v in counts.items():
    if by.get(k) != v:
        errs.append("by_layer[%s]=%s != file count %d" % (k, by.get(k), v))
total = summ.get("total_findings")
if total != sum(counts.values()):
    errs.append("total_findings=%s != sum(by_layer)=%d" % (total, sum(counts.values())))
uniq = summ.get("unique_findings")
if uniq is not None and uniq != len(M) - 1:
    errs.append("unique_findings=%s != merged finding count %d" % (uniq, len(M) - 1))
if errs:
    print("; ".join(errs)); sys.exit(1)
print("by_layer matches per-file counts; total=%d unique=%s" % (total, uniq))
sys.exit(0)
PYEOF
)"; then
    record 0 "Check 11: $MERGED _summary counts match the per-layer files [$detail]"
  else
    record 1 "Check 11: count mismatch -- $detail"
  fi
}

# Check 12 -- no ANSI escape sequence (ESC / 0x1b) appears in any output
# artifact.
check_12() {
  local bad=()
  local f
  for f in "${ALL_ARTIFACTS[@]}"; do
    [ -f "$f" ] || continue
    if LC_ALL=C grep -qP '\x1b' "$f" 2>/dev/null; then
      bad+=("$f")
    fi
  done
  if [ "${#bad[@]}" -eq 0 ]; then
    record 0 "Check 12: no ANSI escape sequences (ESC/0x1b) in any output artifact"
  else
    record 1 "Check 12: ANSI escape sequences found in: ${bad[*]}"
  fi
}

# Check 13 -- no finding in any normalized JSON file has an empty or missing
# description field (the merged _summary header is not a finding and is skipped).
check_13() {
  local detail
  if detail="$("$PY" - "${FINDING_JSON_FILES[@]}" 2>/dev/null <<'PYEOF'
import sys, os, json
FINDING_KEYS = ("cwe", "file", "tool", "layer", "severity", "description")

def is_finding(d):
    return isinstance(d, dict) and "_summary" not in d and any(k in d for k in FINDING_KEYS)

bad = {}
for p in sys.argv[1:]:
    if not os.path.isfile(p):
        continue
    try:
        with open(p, encoding="utf-8") as fh:
            data = json.load(fh)
    except Exception:
        print("%s: invalid JSON" % p); sys.exit(1)
    items = data if isinstance(data, list) else [data]
    cnt = sum(1 for d in items if is_finding(d) and not str(d.get("description", "")).strip())
    if cnt:
        bad[p] = cnt
if bad:
    print("; ".join("%s: %d finding(s) with empty/missing description" % (p, c) for p, c in bad.items()))
    sys.exit(1)
print("all findings carry a non-empty description")
sys.exit(0)
PYEOF
)"; then
    record 0 "Check 13: no finding has an empty or missing description [$detail]"
  else
    record 1 "Check 13: $detail"
  fi
}

# Check 14 -- findings-merged.json contains a gate_verdict in the allowed set.
check_14() {
  local detail
  if detail="$("$PY" - "$MERGED" 2>/dev/null <<'PYEOF'
import sys, json
try:
    with open(sys.argv[1], encoding="utf-8") as fh:
        d = json.load(fh)
    gv = d[0].get("gate_verdict")
except Exception as e:
    print("cannot read gate_verdict: %s" % e); sys.exit(1)
if gv in ("ERROR", "BLOCK", "WARN", "PASS"):
    print(gv); sys.exit(0)
print("gate_verdict=%r not in {ERROR,BLOCK,WARN,PASS}" % (gv,)); sys.exit(1)
PYEOF
)"; then
    record 0 "Check 14: $MERGED gate_verdict is valid ($detail)"
  else
    record 1 "Check 14: $detail"
  fi
}

# Check 15 -- no pre-agent step has a silent failure: layer_0, layer_2, layer_3a
# and layer_4 statuses must each be present (a missing status is a failure). The
# layer_0 status is additionally required in its canonical record
# (codebase-profile.txt).
check_15() {
  local missing=()
  local k
  for k in layer_0 layer_2 layer_3a layer_4; do
    if [ -z "$(get_layer_status "$k")" ]; then
      missing+=("${k}_status")
    fi
  done
  if ! grep -Eq '^[[:space:]]*layer_0_status[[:space:]]*:' "$PROFILE" 2>/dev/null; then
    missing+=("layer_0_status@${PROFILE}")
  fi
  if [ "${#missing[@]}" -eq 0 ]; then
    record 0 "Check 15: all pre-agent statuses present (layer_0, layer_2, layer_3a, layer_4)"
  else
    record 1 "Check 15: missing pre-agent status: ${missing[*]}"
  fi
}

# Check 16 -- every L3b finding references a file:line pair present in
# sink-inventory.txt.
check_16() {
  local detail
  if detail="$("$PY" - "$L3B_JSON" "$SINK" 2>/dev/null <<'PYEOF'
import sys, os, json
l3b, sink = sys.argv[1:3]
try:
    with open(l3b, encoding="utf-8") as fh:
        data = json.load(fh)
    assert isinstance(data, list)
except Exception as e:
    print("invalid L3b JSON: %s" % e); sys.exit(1)
if not os.path.isfile(sink):
    print("%s missing" % sink); sys.exit(1)
pairs = set()
with open(sink, encoding="utf-8", errors="replace") as fh:
    for line in fh:
        parts = line.split(":::")
        if len(parts) >= 2 and parts[1].strip().isdigit():
            pairs.add((parts[0].strip(), parts[1].strip()))
missing = []
for d in data:
    if not isinstance(d, dict):
        continue
    key = (str(d.get("file", "")).strip(), str(d.get("line", "")).strip())
    if key not in pairs:
        missing.append("%s:%s" % key)
if missing:
    print("%d L3b finding(s) not in sink-inventory (e.g. %s)" % (len(missing), ",".join(missing[:5])))
    sys.exit(1)
print("all %d L3b findings anchor to a sink-inventory file:line" % len(data))
sys.exit(0)
PYEOF
)"; then
    record 0 "Check 16: every L3b finding's file:line is present in $SINK [$detail]"
  else
    record 1 "Check 16: $detail"
  fi
}

# =============================================================================
# Run all 16 checks (in order), then record verification_status and exit with
# the failure count.
# =============================================================================
printf '=== Directive 10 verification suite: 16 deterministic checks ===\n'

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

printf '\n'
if [ "$FAILURES" -eq 0 ]; then
  printf 'RESULT: all 16 checks passed (0 failures).\n'
else
  printf 'RESULT: %d check(s) failed.\n' "$FAILURES"
fi

# ---- Record verification_status into findings-merged.json -------------------
# PASS when zero checks failed, otherwise FAIL. The edit is deterministic and
# order-preserving (minified JSON + trailing newline), so re-runs are
# byte-stable when the outcome is unchanged. This write-back is a side effect of
# the suite, not a 17th check: the script still exits with the failure count.
VERIFICATION_STATUS="PASS"
[ "$FAILURES" -eq 0 ] || VERIFICATION_STATUS="FAIL"

if [ -f "$MERGED" ]; then
  if "$PY" - "$MERGED" "$VERIFICATION_STATUS" <<'PYEOF'
import sys, json
path, status = sys.argv[1], sys.argv[2]
try:
    with open(path, encoding="utf-8") as fh:
        data = json.load(fh)
except Exception as e:
    sys.stderr.write("could not parse %s: %s\n" % (path, e)); sys.exit(1)
if isinstance(data, list) and data and isinstance(data[0], dict):
    data[0]["verification_status"] = status
else:
    sys.stderr.write("unexpected %s structure; verification_status not written\n" % path); sys.exit(1)
with open(path, "w", encoding="utf-8") as fh:
    fh.write(json.dumps(data, separators=(",", ":"), ensure_ascii=False) + "\n")
PYEOF
  then
    printf 'Recorded verification_status=%s into %s\n' "$VERIFICATION_STATUS" "$MERGED"
  else
    printf 'WARNING: failed to record verification_status into %s\n' "$MERGED" >&2
  fi
else
  printf 'WARNING: %s not found; cannot record verification_status\n' "$MERGED" >&2
fi

exit "$FAILURES"

