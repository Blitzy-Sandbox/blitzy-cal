#!/usr/bin/env bash
#
# verify.sh — D10 Self-Checking Verification Suite for the calcom-monorepo
#             five-layer, defense-in-depth security audit.
#
# Purpose
#   Prove that the audit artifact set is COMPLETE, WELL-FORMED, and
#   COVERAGE-COMPLETE. Runs EXACTLY 16 checks, prints a [PASS]/[FAIL] line per
#   check, prints a `RESULT: <n>/16 checks passed` summary and an informational
#   `GATE VERDICT: <verdict>` line, and exits non-zero if any check fails.
#
#   This script is READ-ONLY over the artifacts — it never mutates repository
#   files and it does NOT re-run any scanner. It only validates integrity and
#   shape of the artifacts produced by directives D0..D9.
#
# The 11 artifacts validated (all at repo root):
#   codebase-profile.txt
#   findings-layer-1-arch.json      findings-layer-2-semgrep.json
#   findings-layer-3b-taint.json    findings-layer-4-osv.json
#   findings-merged.json
#   sink-inventory.txt              sink-inventory-test.txt
#   mitigation-inventory.txt        mitigation-inventory-test.txt
#   verify.sh                       (self)
#
# Dependency policy (AAP §0.4.1, §0.8.1)
#   - `jq` is OPTIONAL. When present it is used for JSON queries; when absent the
#     script transparently falls back to `python3` (always present, 3.12.x/3.13.x).
#     The script produces identical results with or without jq.
#   - Set VERIFY_NO_JQ=1 to force the python3 fallback path (used for testing that
#     the fallback works even on hosts that do have jq).
#
# Exit contract
#   exit 0  iff all 16 checks pass; otherwise exit 1.
#
# Usage
#   bash verify.sh            # run from anywhere; self-locates its own directory
#   VERIFY_NO_JQ=1 bash verify.sh   # exercise the python3 fallback path
#
# NOTE: Intentionally uses `set -uo pipefail` but NOT `set -e`, so that ALL 16
#       checks always run and report, rather than aborting on the first failure.

set -uo pipefail

# --------------------------------------------------------------------------- #
# Prelude: self-location and JSON-engine detection
# --------------------------------------------------------------------------- #

# Resolve the directory this script lives in, so artifacts are referenced by an
# absolute path regardless of the caller's current working directory.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# JSON engine selection. VERIFY_NO_JQ=1 forces the python3 fallback for testing.
if [ "${VERIFY_NO_JQ:-0}" = "1" ]; then
  HAVE_JQ=0
elif command -v jq >/dev/null 2>&1; then
  HAVE_JQ=1
else
  HAVE_JQ=0
fi

have_jq() { [ "${HAVE_JQ:-0}" -eq 1 ]; }

# --------------------------------------------------------------------------- #
# Artifact name registries
# --------------------------------------------------------------------------- #

# All 11 artifacts (order is stable/deterministic).
ARTIFACTS=(
  "codebase-profile.txt"
  "findings-layer-1-arch.json"
  "findings-layer-2-semgrep.json"
  "sink-inventory.txt"
  "sink-inventory-test.txt"
  "mitigation-inventory.txt"
  "mitigation-inventory-test.txt"
  "findings-layer-3b-taint.json"
  "findings-layer-4-osv.json"
  "findings-merged.json"
  "verify.sh"
)

# The 5 JSON (single-line-JSON / JSONL) artifacts.
JSON_ARTIFACTS=(
  "findings-layer-1-arch.json"
  "findings-layer-2-semgrep.json"
  "findings-layer-3b-taint.json"
  "findings-layer-4-osv.json"
  "findings-merged.json"
)

# The 4 per-layer JSON artifacts that must carry a first-line meta.status.
LAYER_ARTIFACTS=(
  "findings-layer-1-arch.json"
  "findings-layer-2-semgrep.json"
  "findings-layer-3b-taint.json"
  "findings-layer-4-osv.json"
)

# The 19 CWE sink categories (must all appear in the sink inventories).
SINK_CATS=(
  open-redirect ssrf cross-site-scripting weak-prng sql-injection
  path-traversal redos prototype-pollution command-injection weak-hash
  insecure-cookie jwt template-ssti code-evaluation insecure-deserialization
  xxe ldap-injection nosql-injection csrf-sink
)

# The 9 mitigation categories (must all appear in the mitigation inventories).
MIT_CATS=(
  input-validation authorization-guards webhook-signature-hmac csrf-tokens
  output-sanitization password-hashing constant-time-compare security-headers
  rate-limiting
)

# The 3 Semgrep rule packs expected as L2 coverage records.
RULE_PACKS=( "p/security-audit" "p/secrets" "p/owasp-top-ten" )

# Documented advisory suppression reference (.yarnrc.yml npmAuditIgnoreAdvisories).
SUPP_REF="1113407"

# --------------------------------------------------------------------------- #
# Result accounting + reporting helpers
# --------------------------------------------------------------------------- #

PASS_COUNT=0
TOTAL_CHECKS=16

pass() { # <num> <label>
  printf '[PASS] %02d %s\n' "$1" "$2"
  PASS_COUNT=$((PASS_COUNT + 1))
}

fail() { # <num> <label> <reason>
  printf '[FAIL] %02d %s - %s\n' "$1" "$2" "$3"
}

# --------------------------------------------------------------------------- #
# _py — python3 JSON dispatcher (the always-available fallback engine).
#
# Implements every JSON query the checks need as a small subcommand. It reads
# JSONL (one JSON object per line) defensively: blank lines are skipped and
# non-object / unpar?able lines are ignored by the analytical subcommands
# (the dedicated `validate` subcommand is the one that flags parse errors).
#
# Subcommands:
#   validate      <file>          -> exit 1 and print "<file>:<line>" on first bad line
#   count_type    <file> <type>   -> print count of records whose .type == <type>
#   meta_field    <file> <key>    -> print scalar value of <key> on first non-empty line
#   bad_sev       <file...>       -> print (one per line) any scalar .severity not in the taxonomy
#   rulepacks     <file>          -> print (sorted, unique) .rule_pack of coverage records
#   span          <file>          -> print max over findings of max(len(.layers), len(.provenance))
#   supp          <file> <ref>    -> print "<total> <bad>" for findings referencing <ref>
#   gate_verdict  <file>          -> print .verdict of the first gate record
#   last_type     <file>          -> print .type of the last non-empty line
# --------------------------------------------------------------------------- #
_py() {
  python3 - "$@" <<'PY'
import sys, json

argv = sys.argv[1:]
op = argv[0] if argv else ""


def iter_lines(path):
    with open(path, encoding="utf-8", errors="replace") as fh:
        for idx, raw in enumerate(fh, 1):
            yield idx, raw


def iter_objs(path):
    for _, raw in iter_lines(path):
        s = raw.strip()
        if not s:
            continue
        try:
            obj = json.loads(s)
        except Exception:
            continue
        if isinstance(obj, dict):
            yield obj


if op == "validate":
    path = argv[1]
    for idx, raw in iter_lines(path):
        s = raw.strip()
        if not s:
            continue
        try:
            json.loads(s)
        except Exception:
            print("%s:%d" % (path, idx))
            sys.exit(1)
    sys.exit(0)

elif op == "count_type":
    path, wanted = argv[1], argv[2]
    print(sum(1 for o in iter_objs(path) if o.get("type") == wanted))

elif op == "meta_field":
    path, key = argv[1], argv[2]
    printed = False
    for _, raw in iter_lines(path):
        s = raw.strip()
        if not s:
            continue
        try:
            obj = json.loads(s)
        except Exception:
            print("")
            printed = True
            break
        val = obj.get(key) if isinstance(obj, dict) else None
        if val is None:
            print("")
        elif isinstance(val, str):
            print(val)
        else:
            print(json.dumps(val))
        printed = True
        break
    if not printed:
        print("")

elif op == "bad_sev":
    allowed = {"critical", "high", "medium", "low"}
    bad = set()
    for path in argv[1:]:
        for obj in iter_objs(path):
            val = obj.get("severity")
            if isinstance(val, str) and val not in allowed:
                bad.add(val)
    for val in sorted(bad):
        print(val)

elif op == "rulepacks":
    path = argv[1]
    packs = set()
    for obj in iter_objs(path):
        if obj.get("type") == "coverage" and isinstance(obj.get("rule_pack"), str):
            packs.add(obj["rule_pack"])
    for pack in sorted(packs):
        print(pack)

elif op == "span":
    path = argv[1]
    best = 0
    for obj in iter_objs(path):
        if obj.get("type") != "finding":
            continue
        layers = obj.get("layers")
        prov = obj.get("provenance")
        la = len(layers) if isinstance(layers, list) else 0
        lb = len(prov) if isinstance(prov, list) else 0
        best = max(best, la, lb)
    print(best)

elif op == "supp":
    path, ref = argv[1], argv[2]
    total = bad = 0
    for obj in iter_objs(path):
        if obj.get("type") != "finding":
            continue
        blob = " ".join(
            str(obj.get(k, "")) for k in ("suppression_ref", "advisory", "advisory_id")
        )
        blob += " " + json.dumps(obj.get("aliases", []))
        if ref in blob:
            total += 1
            if not (obj.get("suppressed") is True and obj.get("gate_blocking") is False):
                bad += 1
    print("%d %d" % (total, bad))

elif op == "gate_verdict":
    path = argv[1]
    for obj in iter_objs(path):
        if obj.get("type") == "gate":
            print(obj.get("verdict", ""))
            break

elif op == "last_type":
    path = argv[1]
    last = None
    for _, raw in iter_lines(path):
        if raw.strip():
            last = raw.strip()
    if last:
        try:
            print(json.loads(last).get("type", ""))
        except Exception:
            print("")

else:
    sys.exit(2)
PY
}

# --------------------------------------------------------------------------- #
# JSON query wrappers — each branches to jq (fast, when available) or _py.
# Both paths are behaviorally identical for well-formed artifacts.
# --------------------------------------------------------------------------- #

# q_validate <file> : prints "<file>:<line>" and returns 1 on the first line that
# is not independently valid JSON (enforces the single-line-JSON rule); else 0.
q_validate() {
  local f="$1"
  if have_jq; then
    local n=0 line
    while IFS= read -r line || [ -n "$line" ]; do
      n=$((n + 1))
      # Skip blank / whitespace-only lines.
      [ -z "${line//[[:space:]]/}" ] && continue
      if ! printf '%s' "$line" | jq -e . >/dev/null 2>&1; then
        printf '%s:%d\n' "$f" "$n"
        return 1
      fi
    done < "$f"
    return 0
  else
    _py validate "$f"
  fi
}

# q_count_type <file> <type> : count of records whose top-level .type == <type>.
q_count_type() {
  if have_jq; then
    jq -c --arg t "$2" 'select(type=="object" and .type==$t)' "$1" 2>/dev/null \
      | wc -l | tr -d ' '
  else
    _py count_type "$1" "$2"
  fi
}

# q_meta_field <file> <key> : scalar value of <key> on the first non-empty line.
q_meta_field() {
  if have_jq; then
    awk 'NF{print; exit}' "$1" | jq -r --arg k "$2" '.[$k] // empty' 2>/dev/null
  else
    _py meta_field "$1" "$2"
  fi
}

# q_bad_sev <file...> : offending scalar .severity values across the files (unique).
q_bad_sev() {
  if have_jq; then
    local f
    for f in "$@"; do
      jq -r 'select(type=="object" and (.severity|type=="string")) | .severity' \
        "$f" 2>/dev/null
    done | grep -vxE 'critical|high|medium|low' | sort -u
  else
    _py bad_sev "$@"
  fi
}

# q_rulepacks <file> : sorted-unique .rule_pack of coverage records.
q_rulepacks() {
  if have_jq; then
    jq -r 'select(type=="object" and .type=="coverage") | .rule_pack // empty' \
      "$1" 2>/dev/null | sort -u
  else
    _py rulepacks "$1"
  fi
}

# q_span <file> : max over findings of max(len(.layers), len(.provenance)); 0 if none.
q_span() {
  if have_jq; then
    local m
    m=$(jq -r '
          select(type=="object" and .type=="finding")
          | [ (if (.layers|type)=="array" then (.layers|length) else 0 end),
              (if (.provenance|type)=="array" then (.provenance|length) else 0 end) ]
          | max' "$1" 2>/dev/null | sort -n | tail -1)
    [ -z "$m" ] && m=0
    printf '%s\n' "$m"
  else
    _py span "$1"
  fi
}

# q_supp <file> <ref> : "<total> <bad>" for findings referencing <ref> in
# suppression_ref/advisory/advisory_id/aliases (bad = not suppressed or gate-blocking).
q_supp() {
  if have_jq; then
    local out total bad
    out=$(jq -r --arg ref "$2" '
            select(type=="object" and .type=="finding")
            | select(
                ((.suppression_ref // "") | tostring | contains($ref))
                or ((.advisory // "") | tostring | contains($ref))
                or ((.advisory_id // "") | tostring | contains($ref))
                or (((.aliases // []) | tostring) | contains($ref))
              )
            | (if (.suppressed==true and .gate_blocking==false) then "OK" else "BAD" end)
          ' "$1" 2>/dev/null)
    if [ -z "$out" ]; then
      printf '0 0\n'
    else
      total=$(printf '%s\n' "$out" | grep -cE '^(OK|BAD)$')
      bad=$(printf '%s\n' "$out" | grep -cE '^BAD$')
      printf '%s %s\n' "$total" "$bad"
    fi
  else
    _py supp "$1" "$2"
  fi
}

# q_gate_verdict <file> : .verdict of the first gate record (empty if none).
q_gate_verdict() {
  if have_jq; then
    jq -r 'select(type=="object" and .type=="gate") | .verdict' "$1" 2>/dev/null | head -1
  else
    _py gate_verdict "$1"
  fi
}

# q_last_type <file> : .type of the last non-empty line (empty if not an object).
q_last_type() {
  if have_jq; then
    awk 'NF{last=$0} END{if (length(last)) print last}' "$1" \
      | jq -r 'if type=="object" then (.type // "") else "" end' 2>/dev/null
  else
    _py last_type "$1"
  fi
}

# cat_present <file> <category> : 0 if <category> appears as a DATA line
# (`^name` followed by optional spaces then `(` or `:`). Anchoring at line start
# excludes the `#`-prefixed header/pattern comment lines.
cat_present() {
  grep -qE "^${2}[[:space:]]*[(:]" "$1"
}

# --------------------------------------------------------------------------- #
# The 16 checks. Each computes a condition against the real artifact fields and
# calls pass/fail. Reasons are concise and machine-greppable.
# --------------------------------------------------------------------------- #

echo "== calcom-monorepo security-audit - D10 artifact verification (16 checks) =="
if have_jq; then
  echo "   json engine: jq ($(jq --version 2>/dev/null))"
else
  echo "   json engine: python3 fallback ($(python3 --version 2>/dev/null))"
fi
echo "   root: $ROOT"
echo

# --- Check 01: Artifact existence (all 11 exist and are non-empty) ----------- #
_missing=""
for _f in "${ARTIFACTS[@]}"; do
  [ -s "$ROOT/$_f" ] || _missing="$_missing $_f"
done
if [ -z "$_missing" ]; then
  pass 1 "Artifact existence"
else
  fail 1 "Artifact existence" "missing or empty:$_missing"
fi

# --- Check 02: JSONL validity (every non-empty line parses independently) ---- #
_bad=""
for _f in "${JSON_ARTIFACTS[@]}"; do
  if ! _off=$(q_validate "$ROOT/$_f"); then
    _bad="$_off"
    break
  fi
done
if [ -z "$_bad" ]; then
  pass 2 "JSONL validity"
else
  fail 2 "JSONL validity" "first invalid JSON line at $_bad"
fi

# --- Check 03: L0 profile keys ---------------------------------------------- #
_prof="$ROOT/codebase-profile.txt"
_r=""
grep -qE '^primary_language:' "$_prof" || _r="$_r primary_language:"
grep -qE '^source_file_count_total:' "$_prof" || _r="$_r source_file_count_total:"
grep -qE '^exclude_dirs:[[:space:]]*node_modules,\.next,dist,build,\.turbo,\.git,coverage[[:space:]]*$' \
  "$_prof" || _r="$_r exclude_dirs(7-canonical)"
_last=$(awk 'NF{l=$0} END{print l}' "$_prof" | tr -d '[:space:]')
[ "$_last" = "status:OK" ] || _r="$_r ends-with-status:OK(got:$_last)"
if [ -z "$_r" ]; then
  pass 3 "L0 profile keys"
else
  fail 3 "L0 profile keys" "missing:$_r"
fi

# --- Check 04: Sink inventory (app) coverage — 19 categories ----------------- #
_sink="$ROOT/sink-inventory.txt"
_r=""
for _c in "${SINK_CATS[@]}"; do
  cat_present "$_sink" "$_c" || _r="$_r $_c"
done
grep -qE '^total_categories:[[:space:]]*19([^0-9]|$)' "$_sink" || _r="$_r total_categories:19"
cat_present "$_sink" "insecure-deserialization" || _r="$_r insecure-deserialization(zero-count)"
if [ -z "$_r" ]; then
  pass 4 "Sink inventory (app) coverage"
else
  fail 4 "Sink inventory (app) coverage" "missing:$_r"
fi

# --- Check 05: Sink inventory (test) coverage — 19 categories ---------------- #
_sinkt="$ROOT/sink-inventory-test.txt"
_r=""
for _c in "${SINK_CATS[@]}"; do
  cat_present "$_sinkt" "$_c" || _r="$_r $_c"
done
grep -qE '^total_categories:[[:space:]]*19([^0-9]|$)' "$_sinkt" || _r="$_r total_categories:19"
if [ -z "$_r" ]; then
  pass 5 "Sink inventory (test) coverage"
else
  fail 5 "Sink inventory (test) coverage" "missing:$_r"
fi

# --- Check 06: Mitigation inventory (app) coverage — 9 categories ------------ #
_mit="$ROOT/mitigation-inventory.txt"
_r=""
for _c in "${MIT_CATS[@]}"; do
  cat_present "$_mit" "$_c" || _r="$_r $_c"
done
grep -qE '^total_categories:[[:space:]]*9([^0-9]|$)' "$_mit" || _r="$_r total_categories:9"
if [ -z "$_r" ]; then
  pass 6 "Mitigation inventory (app) coverage"
else
  fail 6 "Mitigation inventory (app) coverage" "missing:$_r"
fi

# --- Check 07: Mitigation inventory (test) coverage — 9 categories ----------- #
_mitt="$ROOT/mitigation-inventory-test.txt"
_r=""
for _c in "${MIT_CATS[@]}"; do
  cat_present "$_mitt" "$_c" || _r="$_r $_c"
done
grep -qE '^total_categories:[[:space:]]*9([^0-9]|$)' "$_mitt" || _r="$_r total_categories:9"
if [ -z "$_r" ]; then
  pass 7 "Mitigation inventory (test) coverage"
else
  fail 7 "Mitigation inventory (test) coverage" "missing:$_r"
fi

# --- Check 08: L1 category coverage — exactly 10 coverage records ------------ #
_n=$(q_count_type "$ROOT/findings-layer-1-arch.json" coverage)
if [ "${_n:-0}" = "10" ]; then
  pass 8 "L1 category coverage"
else
  fail 8 "L1 category coverage" "expected 10 coverage records, found ${_n:-0}"
fi

# --- Check 09: L2 rule-pack coverage + engine pin --------------------------- #
_l2="$ROOT/findings-layer-2-semgrep.json"
_n=$(q_count_type "$_l2" coverage)
_tv=$(q_meta_field "$_l2" tool_version)
_st=$(q_meta_field "$_l2" status)
_packs=$(q_rulepacks "$_l2")
_r=""
[ "${_n:-0}" = "3" ] || _r="$_r coverage!=3(${_n:-0})"
for _p in "${RULE_PACKS[@]}"; do
  printf '%s\n' "$_packs" | grep -qxF "$_p" || _r="$_r missing-pack:$_p"
done
[ "$_tv" = "1.168.0" ] || _r="$_r tool_version!=1.168.0(${_tv:-none})"
case "$_st" in
  OK|ERROR) : ;;
  *) _r="$_r status-missing(${_st:-none})" ;;
esac
if [ -z "$_r" ]; then
  pass 9 "L2 rule-pack coverage + engine pin"
else
  fail 9 "L2 rule-pack coverage + engine pin" "$_r"
fi

# --- Check 10: L3b CWE coverage — exactly 19 coverage records ---------------- #
_n=$(q_count_type "$ROOT/findings-layer-3b-taint.json" coverage)
if [ "${_n:-0}" = "19" ]; then
  pass 10 "L3b CWE coverage"
else
  fail 10 "L3b CWE coverage" "expected 19 coverage records, found ${_n:-0}"
fi

# --- Check 11: L4 SCA shape + suppression ----------------------------------- #
_l4="$ROOT/findings-layer-4-osv.json"
_st=$(q_meta_field "$_l4" status)
_tv=$(q_meta_field "$_l4" tool_version)
_lf=$(q_meta_field "$_l4" lockfile)
_cov=$(q_count_type "$_l4" coverage)
_supp_total=0
_supp_bad=0
read -r _supp_total _supp_bad <<EOF_SUPP
$(q_supp "$_l4" "$SUPP_REF")
EOF_SUPP
_r=""
case "$_st" in
  OK|ERROR) : ;;
  *) _r="$_r status-missing(${_st:-none})" ;;
esac
[ "$_tv" = "v2.3.5" ] || _r="$_r tool_version!=v2.3.5(${_tv:-none})"
[ "$_lf" = "yarn.lock" ] || _r="$_r lockfile!=yarn.lock(${_lf:-none})"
if ! [ "${_cov:-0}" -ge 1 ] 2>/dev/null; then _r="$_r no-coverage-record"; fi
if ! [ "${_supp_total:-0}" -ge 1 ] 2>/dev/null; then _r="$_r no-advisory-$SUPP_REF-finding"; fi
[ "${_supp_bad:-0}" = "0" ] || _r="$_r advisory-$SUPP_REF-nonconforming(${_supp_bad})"
if [ -z "$_r" ]; then
  pass 11 "L4 SCA shape + suppression"
else
  fail 11 "L4 SCA shape + suppression" "$_r"
fi

# --- Check 12: Severity-taxonomy conformance (all 5 JSON) -------------------- #
_json_paths=()
for _f in "${JSON_ARTIFACTS[@]}"; do _json_paths+=("$ROOT/$_f"); done
_badsev=$(q_bad_sev "${_json_paths[@]}")
if [ -z "$_badsev" ]; then
  pass 12 "Severity-taxonomy conformance"
else
  fail 12 "Severity-taxonomy conformance" \
    "non-taxonomy severities: $(printf '%s' "$_badsev" | tr '\n' ',' | sed 's/,$//')"
fi

# --- Check 13: No-silent-failure / status present (4 layer metas) ------------ #
_r=""
for _f in "${LAYER_ARTIFACTS[@]}"; do
  _ty=$(q_meta_field "$ROOT/$_f" type)
  _st=$(q_meta_field "$ROOT/$_f" status)
  [ "$_ty" = "meta" ] || _r="$_r $_f:first-not-meta(${_ty:-none})"
  case "$_st" in
    OK|ERROR) : ;;
    *) _r="$_r $_f:no-status(${_st:-none})" ;;
  esac
done
if [ -z "$_r" ]; then
  pass 13 "No-silent-failure / status present"
else
  fail 13 "No-silent-failure / status present" "$_r"
fi

# --- Check 14: ANSI cleanliness (no artifact contains a CSI escape) ---------- #
# Build the ESC byte at runtime so this script's own source stays ESC-free.
_esc=$(printf '\033')
_hits=""
for _f in "${ARTIFACTS[@]}"; do
  if LC_ALL=C grep -lF -- "${_esc}[" "$ROOT/$_f" >/dev/null 2>&1; then
    _hits="$_hits $_f"
  fi
done
if [ -z "$_hits" ]; then
  pass 14 "ANSI cleanliness"
else
  fail 14 "ANSI cleanliness" "ANSI escape bytes found in:$_hits"
fi

# --- Check 15: D9 gate present & valid (exactly one, last content line) ------ #
_merged="$ROOT/findings-merged.json"
_gc=$(q_count_type "$_merged" gate)
_verdict=$(q_gate_verdict "$_merged")
_lasttype=$(q_last_type "$_merged")
_r=""
[ "${_gc:-0}" = "1" ] || _r="$_r gate-count!=1(${_gc:-0})"
case "$_verdict" in
  ERROR|BLOCK|WARN|PASS) : ;;
  *) _r="$_r invalid-verdict(${_verdict:-none})" ;;
esac
[ "$_lasttype" = "gate" ] || _r="$_r last-line-not-gate(${_lasttype:-none})"
if [ -z "$_r" ]; then
  pass 15 "D9 gate present & valid"
else
  fail 15 "D9 gate present & valid" "$_r"
fi

# --- Check 16: Merge provenance / cross-layer correlation -------------------- #
_maxspan=$(q_span "$_merged")
if [ "${_maxspan:-0}" -ge 2 ] 2>/dev/null; then
  pass 16 "Merge provenance / cross-layer correlation"
else
  fail 16 "Merge provenance / cross-layer correlation" \
    "no merged finding spans >=2 layers (max span ${_maxspan:-0})"
fi

# --------------------------------------------------------------------------- #
# Summary + informational gate verdict + exit contract
# --------------------------------------------------------------------------- #
echo
echo "RESULT: ${PASS_COUNT}/${TOTAL_CHECKS} checks passed"

_gate=$(q_gate_verdict "$_merged")
[ -z "$_gate" ] && _gate="(none)"
echo "GATE VERDICT: $_gate"

if [ "$PASS_COUNT" -eq "$TOTAL_CHECKS" ]; then
  exit 0
else
  exit 1
fi
