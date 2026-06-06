#!/usr/bin/env bash
#
# verify.sh - Directive 10 self-validation harness for the blitzy-cal
#             five-layer read-only security audit.
#
# PURPOSE
#   Deterministically validate the complete set of audit artifacts produced by
#   Directives 0-9 against 16 binding pass/fail criteria. Each check prints
#   exactly one line, "PASS <N> <desc>" or "FAIL <N> <desc>" (N = 1..16). The
#   process exit code equals the number of FAILED checks (0 == all green).
#
# READ-ONLY CONTRACT
#   This harness ONLY reads the sibling audit artifacts and prints results. It
#   never creates (other than ephemeral temp files under /tmp), modifies, or
#   deletes any repository file, honoring the audit "~0 files modified" mandate.
#   It performs purely local file inspection and never contacts any network or
#   live infrastructure.
#
# USAGE
#   ./verify.sh        # run from the repository root (where the artifacts live)
#   bash verify.sh     # equivalent; the script cd's to its own directory so all
#                      # relative artifact paths resolve regardless of caller cwd
#
# DETERMINISM
#   LC_ALL=C plus a fixed artifact list and stable sort orders make every run on
#   identical inputs byte-identical. The script is non-interactive and does not
#   use "set -e": a failing check is converted to a FAIL line, never an abort.
#
# DEPENDENCIES
#   Prefers jq for JSON inspection; transparently falls back to python3 when jq
#   is unavailable. If neither is present the script exits 255 with a clear
#   message (it never crashes silently).
#
set -u
export LC_ALL=C

# Resolve and enter the directory that contains this script (== artifact dir).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
cd "$SCRIPT_DIR" || { echo "verify.sh: FATAL: cannot cd to script directory '$SCRIPT_DIR'" >&2; exit 255; }

# --------------------------------------------------------------------------
# JSON engine detection (jq preferred, python3 fallback) and grep -P support.
# --------------------------------------------------------------------------
ENGINE=""
HAVE_PY=0
command -v jq >/dev/null 2>&1 && ENGINE="jq"
command -v python3 >/dev/null 2>&1 && HAVE_PY=1
if [ -z "$ENGINE" ]; then
  if [ "$HAVE_PY" -eq 1 ]; then
    ENGINE="py"
  else
    echo "verify.sh: FATAL: neither 'jq' nor 'python3' is available; cannot validate JSON artifacts" >&2
    exit 255
  fi
fi
GREP_P=0
printf 'x' | grep -qP 'x' 2>/dev/null && GREP_P=1

# Embedded python fallback program. Single-quoted: it must contain NO single
# quotes. Dispatches on argv[1]=mode, argv[2]=file, argv[3]=optional key.
PYQ='
import sys, json
mode = sys.argv[1]
path = sys.argv[2]
extra = sys.argv[3] if len(sys.argv) > 3 else None
try:
    with open(path, encoding="utf-8") as fh:
        data = json.load(fh)
    ok = True
except Exception:
    data = None
    ok = False

def is_finding(x):
    return isinstance(x, dict) and ("file" in x)

def is_int(x):
    return isinstance(x, int) and not isinstance(x, bool)

if mode == "valid":
    print("1" if ok else "0")
elif mode == "is_array":
    print("1" if ok and isinstance(data, list) else "0")
elif mode == "sarif_runs":
    print("1" if ok and isinstance(data, dict) and isinstance(data.get("runs"), list) else "0")
elif mode == "count_findings":
    print(sum(1 for x in data if is_finding(x)) if ok and isinstance(data, list) else 0)
elif mode == "gate_nonbool":
    print(sum(1 for x in data if is_finding(x) and not isinstance(x.get("gateBlocking"), bool)) if ok and isinstance(data, list) else 0)
elif mode == "osv_violations":
    c = 0
    if ok and isinstance(data, list):
        for x in data:
            if is_finding(x):
                ln = x.get("line")
                if (not (is_int(ln) and ln == 0)) or x.get("tool") != "osv-scanner":
                    c += 1
    print(c)
elif mode == "sev_violations":
    allow = set(["critical", "high", "medium", "low"])
    print(sum(1 for x in data if is_finding(x) and x.get("severity") not in allow) if ok and isinstance(data, list) else 0)
elif mode == "descline_violations":
    c = 0
    if ok and isinstance(data, list):
        for x in data:
            if is_finding(x):
                d = x.get("description")
                ln = x.get("line")
                if (not isinstance(d, str)) or len(d) < 1 or len(d) > 200 or (not is_int(ln)):
                    c += 1
    print(c)
elif mode == "summary_keys":
    req = ["total_findings", "unique_findings", "corroborated", "gate_blocking", "by_layer", "by_severity", "layer_status", "gate_verdict"]
    good = ok and isinstance(data, list) and len(data) >= 1 and isinstance(data[0], dict) and isinstance(data[0].get("_summary"), dict) and all(k in data[0]["_summary"] for k in req)
    print("1" if good else "0")
elif mode == "summary_get":
    try:
        v = data[0]["_summary"][extra]
        if isinstance(v, bool):
            print(str(v).lower())
        else:
            print(v)
    except Exception:
        print("")
elif mode == "filelines":
    if ok and isinstance(data, list):
        for x in data:
            if is_finding(x):
                print("%s:%s" % (x.get("file"), x.get("line")))
else:
    print("")
'

# --------------------------------------------------------------------------
# Result recording. record <n> <okflag 0|1> <description>
# --------------------------------------------------------------------------
failures=0
record() {
  if [ "$2" -eq 1 ]; then
    printf 'PASS %s %s\n' "$1" "$3"
  else
    printf 'FAIL %s %s\n' "$1" "$3"
    failures=$((failures + 1))
  fi
}

# as_int <value> - echo the value if it is a non-negative integer, else 0.
as_int() {
  case "${1:-}" in
    ''|*[!0-9]*) printf '0' ;;
    *)           printf '%s' "$1" ;;
  esac
}

# --------------------------------------------------------------------------
# JSON helper wrappers: jq primary, python3 fallback. Each echoes its result.
# --------------------------------------------------------------------------
q_valid() {
  if [ "$ENGINE" = "jq" ]; then
    if jq -e . "$1" >/dev/null 2>&1; then printf '1'; else printf '0'; fi
  else
    python3 -c "$PYQ" valid "$1" 2>/dev/null
  fi
}

q_is_array() {
  if [ "$ENGINE" = "jq" ]; then
    if jq -e 'type=="array"' "$1" >/dev/null 2>&1; then printf '1'; else printf '0'; fi
  else
    python3 -c "$PYQ" is_array "$1" 2>/dev/null
  fi
}

q_sarif_runs() {
  if [ "$ENGINE" = "jq" ]; then
    if jq -e '(.runs|type)=="array"' "$1" >/dev/null 2>&1; then printf '1'; else printf '0'; fi
  else
    python3 -c "$PYQ" sarif_runs "$1" 2>/dev/null
  fi
}

q_count_findings() {
  if [ "$ENGINE" = "jq" ]; then
    jq '[.[]|objects|select(has("file"))]|length' "$1" 2>/dev/null
  else
    python3 -c "$PYQ" count_findings "$1" 2>/dev/null
  fi
}

q_gate_nonbool() {
  if [ "$ENGINE" = "jq" ]; then
    jq '[.[]|objects|select(has("file"))|select((.gateBlocking|type)!="boolean")]|length' "$1" 2>/dev/null
  else
    python3 -c "$PYQ" gate_nonbool "$1" 2>/dev/null
  fi
}

q_osv_violations() {
  if [ "$ENGINE" = "jq" ]; then
    jq '[.[]|objects|select(has("file"))|select(.line!=0 or .tool!="osv-scanner")]|length' "$1" 2>/dev/null
  else
    python3 -c "$PYQ" osv_violations "$1" 2>/dev/null
  fi
}

q_sev_violations() {
  if [ "$ENGINE" = "jq" ]; then
    jq '[.[]|objects|select(has("file"))|select((.severity|IN("critical","high","medium","low"))|not)]|length' "$1" 2>/dev/null
  else
    python3 -c "$PYQ" sev_violations "$1" 2>/dev/null
  fi
}

q_descline_violations() {
  if [ "$ENGINE" = "jq" ]; then
    jq '[.[]|objects|select(has("file"))|select((.description|type!="string") or (.description|length<1) or (.description|length>200) or (.line|type!="number") or (.line!=(.line|floor)))]|length' "$1" 2>/dev/null
  else
    python3 -c "$PYQ" descline_violations "$1" 2>/dev/null
  fi
}

q_summary_keys() {
  if [ "$ENGINE" = "jq" ]; then
    jq -r '(.[0]._summary) as $s | (if ($s|type)=="object" then (["total_findings","unique_findings","corroborated","gate_blocking","by_layer","by_severity","layer_status","gate_verdict"]|map(. as $k|($s|has($k)))|all) else false end) | if . then "1" else "0" end' "$1" 2>/dev/null
  else
    python3 -c "$PYQ" summary_keys "$1" 2>/dev/null
  fi
}

q_summary_get() {
  if [ "$ENGINE" = "jq" ]; then
    jq -r --arg k "$2" '.[0]._summary[$k] // empty' "$1" 2>/dev/null
  else
    python3 -c "$PYQ" summary_get "$1" "$2" 2>/dev/null
  fi
}

q_filelines() {
  if [ "$ENGINE" = "jq" ]; then
    jq -r '.[]|objects|select(has("file"))|"\(.file):\(.line)"' "$1" 2>/dev/null
  else
    python3 -c "$PYQ" filelines "$1" 2>/dev/null
  fi
}

# has_ansi <file> - return 0 (true) if the file contains an ESC (0x1b) byte.
has_ansi() {
  if [ "$GREP_P" -eq 1 ]; then
    LC_ALL=C grep -qP '\x1b' "$1" 2>/dev/null
  elif [ "$HAVE_PY" -eq 1 ]; then
    python3 -c 'import sys; sys.exit(0 if b"\x1b" in open(sys.argv[1],"rb").read() else 1)' "$1" 2>/dev/null
  else
    LC_ALL=C grep -q "$(printf '\033')" "$1" 2>/dev/null
  fi
}

# --------------------------------------------------------------------------
# Canonical artifact filenames (AAP Section 0.4).
# --------------------------------------------------------------------------
PROFILE="codebase-profile.txt"
L1="findings-layer-1-arch.json"
SARIF="results-semgrep.sarif"
L2="findings-layer-2-semgrep.json"
SINK="sink-inventory.txt"
SINK_TEST="sink-inventory-test.txt"
MIT="mitigation-inventory.txt"
MIT_TEST="mitigation-inventory-test.txt"
L3B="findings-layer-3b-taint.json"
OSV_RAW="results-osv.json"
L4="findings-layer-4-osv.json"
MERGED="findings-merged.json"

# Artifacts subject to the ANSI-cleanliness rule (check 14).
ANSI_ARTIFACTS=(
  "$PROFILE" "$L1" "$SARIF" "$L2" "$SINK" "$SINK_TEST"
  "$MIT" "$MIT_TEST" "$L3B" "$OSV_RAW" "$L4" "$MERGED"
)

# Temp files (check 16); initialized for safe trap cleanup under set -u. The
# trap body is single-quoted so expansion is deferred to exit time, and the
# variables are always defined here so cleanup is safe even on early exit.
SINK_SET=""
L3B_SET=""
trap 'rm -f "$SINK_SET" "$L3B_SET" 2>/dev/null' EXIT

# ==========================================================================
# CHECK 1 - Layer 0 profile present and resolved.
# ==========================================================================
ok=0
if [ -s "$PROFILE" ]; then
  pl="$(grep -E '^primary_language=' "$PROFILE" 2>/dev/null | head -n1 | cut -d= -f2-)"
  if [ -n "$pl" ] && ! grep -Eq 'layer_0_status[[:space:]]*[:=][[:space:]]*"?ERROR"?' "$PROFILE" 2>/dev/null; then
    ok=1
  fi
fi
record 1 "$ok" "Layer0 profile present, primary_language set, layer_0_status not ERROR"

# ==========================================================================
# CHECK 2 - Layer 1 valid JSON array + 10/10 category coverage markers.
# ==========================================================================
ok=0
if [ -f "$L1" ] && [ "$(q_is_array "$L1")" = "1" ]; then
  m=$(grep -oE 'Category [0-9]+/10' "$L1" 2>/dev/null | sort -u | wc -l | tr -d '[:space:]')
  [ "$(as_int "$m")" -eq 10 ] && ok=1
fi
record 2 "$ok" "Layer1 valid JSON array with 10/10 category coverage markers"

# ==========================================================================
# CHECK 3 - Layer 2 SARIF (runs[] array) + normalized JSON array present/valid.
# ==========================================================================
ok=0
if [ -f "$SARIF" ] && [ "$(q_sarif_runs "$SARIF")" = "1" ] \
   && [ -f "$L2" ] && [ "$(q_is_array "$L2")" = "1" ]; then
  ok=1
fi
record 3 "$ok" "Layer2 SARIF has top-level runs[] array and normalized findings are a JSON array"

# ==========================================================================
# CHECK 4 - Layer 3a inventories non-empty + <file>:<line>:<category>: format.
# ==========================================================================
ok=1
for inv in "$SINK" "$MIT"; do
  if [ ! -s "$inv" ]; then ok=0; continue; fi
  bad=$(grep -cvE '^[^:]+:[0-9]+:[^:]+:' "$inv" 2>/dev/null | tr -d '[:space:]')
  good=$(grep -cE '^[^:]+:[0-9]+:[^:]+:' "$inv" 2>/dev/null | tr -d '[:space:]')
  if [ "$(as_int "$bad")" -ne 0 ] || [ "$(as_int "$good")" -lt 1 ]; then ok=0; fi
done
record 4 "$ok" "Layer3a sink+mitigation inventories non-empty and <file>:<line>:<category>: formatted"

# ==========================================================================
# CHECK 5 - Layer 3a test-variant inventories present (test/prod separation).
# ==========================================================================
ok=0
if [ -e "$SINK_TEST" ] && [ -e "$MIT_TEST" ]; then ok=1; fi
record 5 "$ok" "Layer3a test-variant inventories present (test/prod separation performed)"

# ==========================================================================
# CHECK 6 - Layer 3b valid JSON array + 19/19 categories + boolean gateBlocking.
# ==========================================================================
ok=0
if [ -f "$L3B" ] && [ "$(q_is_array "$L3B")" = "1" ]; then
  m=$(grep -oE 'Category [0-9]+/19' "$L3B" 2>/dev/null | sort -u | wc -l | tr -d '[:space:]')
  nb=$(as_int "$(q_gate_nonbool "$L3B")")
  if [ "$(as_int "$m")" -eq 19 ] && [ "$nb" -eq 0 ]; then ok=1; fi
fi
record 6 "$ok" "Layer3b valid JSON array, 19/19 categories, boolean gateBlocking on every finding"

# ==========================================================================
# CHECK 7 - Layer 4 OSV raw valid + normalized array + line:0 + osv-scanner.
# ==========================================================================
ok=0
if [ -f "$OSV_RAW" ] && [ "$(q_valid "$OSV_RAW")" = "1" ] \
   && [ -f "$L4" ] && [ "$(q_is_array "$L4")" = "1" ]; then
  v=$(as_int "$(q_osv_violations "$L4")")
  [ "$v" -eq 0 ] && ok=1
fi
record 7 "$ok" "Layer4 OSV raw valid JSON; normalized findings carry line:0 and tool:osv-scanner"

# ==========================================================================
# CHECK 8 - Merged report is valid JSON.
# ==========================================================================
ok=0
if [ -f "$MERGED" ] && [ "$(q_valid "$MERGED")" = "1" ]; then ok=1; fi
record 8 "$ok" "Merged report findings-merged.json is valid JSON"

# ==========================================================================
# CHECK 9 - _summary header exposes all 8 required keys.
# ==========================================================================
ok=0
[ "$(q_summary_keys "$MERGED")" = "1" ] && ok=1
record 9 "$ok" "_summary header exposes total_findings,unique_findings,corroborated,gate_blocking,by_layer,by_severity,layer_status,gate_verdict"

# ==========================================================================
# CHECK 10 - gate_verdict is one of ERROR|BLOCK|WARN|PASS.
# ==========================================================================
ok=0
gv="$(q_summary_get "$MERGED" gate_verdict)"
case "$gv" in
  ERROR|BLOCK|WARN|PASS) ok=1 ;;
esac
record 10 "$ok" "gate_verdict in {ERROR,BLOCK,WARN,PASS} (found: ${gv:-none})"

# ==========================================================================
# CHECK 11 - Count reconciliation: total_findings == sum of layer findings.
# ==========================================================================
ok=0
total=$(as_int "$(q_summary_get "$MERGED" total_findings)")
c1=$(as_int "$(q_count_findings "$L1")")
c2=$(as_int "$(q_count_findings "$L2")")
c3=$(as_int "$(q_count_findings "$L3B")")
c4=$(as_int "$(q_count_findings "$L4")")
sum=$((c1 + c2 + c3 + c4))
[ "$total" -eq "$sum" ] && ok=1
record 11 "$ok" "total_findings ($total) equals sum of layer findings L1+L2+L3b+L4 ($sum)"

# ==========================================================================
# CHECK 12 - Unified severity vocabulary {critical,high,medium,low} everywhere.
# ==========================================================================
sev=0
for f in "$L1" "$L2" "$L3B" "$L4" "$MERGED"; do
  v=$(as_int "$(q_sev_violations "$f")")
  sev=$((sev + v))
done
ok=0; [ "$sev" -eq 0 ] && ok=1
record 12 "$ok" "severity vocabulary limited to {critical,high,medium,low} across all findings ($sev violations)"

# ==========================================================================
# CHECK 13 - Non-empty description (<=200 chars) + integer line on every finding.
# ==========================================================================
dl=0
for f in "$L1" "$L2" "$L3B" "$L4" "$MERGED"; do
  v=$(as_int "$(q_descline_violations "$f")")
  dl=$((dl + v))
done
ok=0; [ "$dl" -eq 0 ] && ok=1
record 13 "$ok" "every finding has non-empty description (<=200 chars) and integer line ($dl violations)"

# ==========================================================================
# CHECK 14 - ANSI cleanliness: no ESC (0x1b) sequences in any artifact.
# ==========================================================================
ansi=0
for f in "${ANSI_ARTIFACTS[@]}"; do
  [ -f "$f" ] || continue
  if has_ansi "$f"; then ansi=$((ansi + 1)); fi
done
ok=0; [ "$ansi" -eq 0 ] && ok=1
record 14 "$ok" "no ANSI escape sequences present in any audit artifact ($ansi affected)"

# ==========================================================================
# CHECK 15 - Single-line JSON for the four layer files and the merged report.
# ==========================================================================
nonsingle=0
for f in "$L1" "$L2" "$L3B" "$L4" "$MERGED"; do
  if [ -f "$f" ]; then
    lc=$(wc -l < "$f" 2>/dev/null | tr -d '[:space:]')
    [ "$(as_int "$lc")" -le 1 ] || nonsingle=$((nonsingle + 1))
  else
    nonsingle=$((nonsingle + 1))
  fi
done
ok=0; [ "$nonsingle" -eq 0 ] && ok=1
record 15 "$ok" "findings layer files and merged report are single-line JSON ($nonsingle multi-line)"

# ==========================================================================
# CHECK 16 - Every Layer 3b finding file:line is traceable to sink-inventory.txt.
#   Fixed-string whole-line matching (grep -Fxf) because Cal.com paths contain
#   regex metacharacters such as [id], [...slug] and (route-group) segments.
# ==========================================================================
ok=0
if [ -f "$L3B" ] && [ -s "$SINK" ]; then
  SINK_SET="$(mktemp)"
  L3B_SET="$(mktemp)"
  awk -F: 'NF>=3 {print $1":"$2}' "$SINK" 2>/dev/null | sort -u > "$SINK_SET"
  q_filelines "$L3B" 2>/dev/null | sort -u > "$L3B_SET"
  checked=$(wc -l < "$L3B_SET" 2>/dev/null | tr -d '[:space:]')
  miss=$(grep -cFxvf "$SINK_SET" "$L3B_SET" 2>/dev/null | tr -d '[:space:]')
  if [ "$(as_int "$miss")" -eq 0 ] && [ "$(as_int "$checked")" -ge 1 ]; then ok=1; fi
  rm -f "$SINK_SET" "$L3B_SET" 2>/dev/null
  SINK_SET=""
  L3B_SET=""
fi
record 16 "$ok" "every Layer3b finding file:line is traceable to a sink-inventory.txt entry"

# ==========================================================================
# Summary and exit code (== number of failed checks).
# ==========================================================================
printf 'verify.sh: %d failed check(s) of 16\n' "$failures"
exit "$failures"
