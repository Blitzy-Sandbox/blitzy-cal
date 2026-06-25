#!/usr/bin/env bash
# =============================================================================
# verify.sh - Directive D10: Self-Verification Suite
# -----------------------------------------------------------------------------
# Part of the "Full Security Stack - Architectural Audit + Semgrep + Sink
# Inventory + Taint Analysis + OSV-Scanner" audit of the blitzy-cal (Cal.com)
# monorepo.
#
# This script is the audit's "test suite": because the audit modifies ZERO
# application source files, there is no application test suite to run. Instead
# this script runs EXACTLY 16 integrity checks confirming that:
#   * every audit layer produced its output artifact and that JSON is parseable,
#   * every mandatory category is covered (no silent category loss),
#   * every output conforms to the unified schema + hygiene rules
#     (severity vocabulary, ANSI hygiene, gate-blocking contract, gate verdict).
#
# CONTRACT
#   * READ-ONLY: this script READS the audit artifacts; it MODIFIES NO files.
#   * Invoked as `bash verify.sh` from the repository ROOT. All 13 artifacts
#     live at the repo root and are referenced by bare filename.
#   * JSON validity is checked with `python -m json.tool` (the `jq` utility is
#     ABSENT in the sandbox - jq is intentionally NOT used anywhere here).
#   * Output is plain ASCII/UTF-8 and contains NO ANSI escape sequences, so a
#     captured run log stays clean.
#   * Deterministic: identical artifacts always yield the identical 16 results.
#   * Dependency-light: only bash, coreutils, grep, and python/python3.
#
# EXIT STATUS
#   0  -> all 16 checks passed.
#   1  -> one or more checks failed.
# =============================================================================

set -u            # Treat references to unset variables as an error.
# NOTE: `set -e` is intentionally NOT enabled. Every check must run and report
# its own result; we never abort the suite on the first failure.

# -----------------------------------------------------------------------------
# Interpreter selection.
# The spec mandates JSON validation via `python -m json.tool` (NOT jq). We
# prefer `python3` (guaranteed present, 3.12+) and fall back to `python`.
# Using "$PYTHON" -m json.tool is exactly the mandated mechanism.
# -----------------------------------------------------------------------------
PYTHON=""
for _candidate in python3 python; do
  if command -v "$_candidate" >/dev/null 2>&1; then
    PYTHON="$_candidate"
    break
  fi
done

# -----------------------------------------------------------------------------
# Pass/fail accounting.
# -----------------------------------------------------------------------------
TOTAL_CHECKS=16
PASSED=0
reason=""         # Scratch variable reused by the python-backed checks.

# pass_check <number> <description>
pass_check() {
  PASSED=$((PASSED + 1))
  printf '[PASS] %s: %s\n' "$1" "$2"
}

# fail_check <number> <description> <reason>
fail_check() {
  printf '[FAIL] %s: %s — %s\n' "$1" "$2" "$3"
}

# json_parseable <file> : returns 0 if <file> is valid JSON per python's
# json.tool module. Returns non-zero otherwise (including when no interpreter
# is available, so the dependent check fails loudly rather than silently).
json_parseable() {
  [ -n "$PYTHON" ] || return 2
  "$PYTHON" -m json.tool "$1" >/dev/null 2>&1
}

printf 'Security Audit Self-Verification (Directive D10) - 16 integrity checks\n'
printf '=====================================================================\n'

# =============================================================================
# Checks 1-5: each findings-layer JSON (and the merged report) exists AND is
# parseable JSON via `python -m json.tool`.
#   1 findings-layer-1-arch.json
#   2 findings-layer-2-semgrep.json
#   3 findings-layer-3b-taint.json
#   4 findings-layer-4-osv.json
#   5 findings-merged.json
# =============================================================================
n=1
for f in findings-layer-1-arch.json \
         findings-layer-2-semgrep.json \
         findings-layer-3b-taint.json \
         findings-layer-4-osv.json \
         findings-merged.json; do
  desc="$f exists and is parseable JSON"
  if [ ! -f "$f" ]; then
    fail_check "$n" "$desc" "file not found"
  elif json_parseable "$f"; then
    pass_check "$n" "$desc"
  else
    fail_check "$n" "$desc" "not valid JSON (python -m json.tool failed)"
  fi
  n=$((n + 1))
done

# =============================================================================
# Checks 6-10: inventory/profile text files exist AND are non-empty.
#   6 sink-inventory.txt
#   7 sink-inventory-test.txt
#   8 mitigation-inventory.txt
#   9 mitigation-inventory-test.txt
#  10 codebase-profile.txt
# =============================================================================
for f in sink-inventory.txt \
         sink-inventory-test.txt \
         mitigation-inventory.txt \
         mitigation-inventory-test.txt \
         codebase-profile.txt; do
  desc="$f exists and is non-empty"
  if [ ! -e "$f" ]; then
    fail_check "$n" "$desc" "file not found"
  elif [ -s "$f" ]; then
    pass_check "$n" "$desc"
  else
    fail_check "$n" "$desc" "file is empty"
  fi
  n=$((n + 1))
done

# =============================================================================
# Check 11: severity vocabulary. Every findings[].severity across ALL findings
# JSON must be one of {critical, high, medium, low}.
# =============================================================================
desc="Severity vocabulary across all findings JSON is {critical,high,medium,low}"
if [ -z "$PYTHON" ]; then
  fail_check 11 "$desc" "no python interpreter available"
elif reason="$("$PYTHON" - 2>&1 <<'PY'
import json, sys
allowed = {"critical", "high", "medium", "low"}
files = [
    "findings-layer-1-arch.json",
    "findings-layer-2-semgrep.json",
    "findings-layer-3b-taint.json",
    "findings-layer-4-osv.json",
    "findings-merged.json",
]
bad = []
for fn in files:
    try:
        with open(fn) as fh:
            data = json.load(fh)
    except Exception:
        # Existence / parse failures are reported by checks 1-5; skip here.
        continue
    findings = data.get("findings") if isinstance(data, dict) else None
    if not isinstance(findings, list):
        continue
    for idx, item in enumerate(findings):
        if not isinstance(item, dict):
            continue
        sev = item.get("severity")
        if sev not in allowed:
            bad.append("%s[%d]=%r" % (fn, idx, sev))
if bad:
    print("invalid severity value(s): " + "; ".join(bad[:5]) +
          (" ..." if len(bad) > 5 else ""))
    sys.exit(1)
sys.exit(0)
PY
)"; then
  pass_check 11 "$desc"
else
  fail_check 11 "$desc" "$reason"
fi

# =============================================================================
# Check 12: ANSI hygiene. NO ANSI escape sequence (ESC byte, 0x1b) may appear
# in ANY of the 13 output artifacts (the 12 audit outputs + verify.sh itself).
# Implemented as a byte-level python scan (a sanctioned alternative to
# `grep -lP '\x1b'`) for portability and determinism.
# =============================================================================
desc="No ANSI escape sequences in any of the 13 output artifacts"
if [ -z "$PYTHON" ]; then
  fail_check 12 "$desc" "no python interpreter available"
elif reason="$("$PYTHON" - 2>&1 <<'PY'
import os, sys
artifacts = [
    "codebase-profile.txt", "findings-layer-1-arch.json",
    "findings-layer-2-semgrep.json", "findings-layer-3b-taint.json",
    "findings-layer-4-osv.json", "findings-merged.json",
    "sink-inventory.txt", "sink-inventory-test.txt",
    "mitigation-inventory.txt", "mitigation-inventory-test.txt",
    "results-semgrep.sarif", "results-osv.json", "verify.sh",
]
esc = b"\x1b"
hits = []
for fn in artifacts:
    if not os.path.exists(fn):
        continue
    try:
        with open(fn, "rb") as fh:
            if esc in fh.read():
                hits.append(fn)
    except Exception as exc:
        hits.append("%s (read error: %s)" % (fn, exc))
if hits:
    print("ESC (0x1b) byte present in: " + ", ".join(hits))
    sys.exit(1)
sys.exit(0)
PY
)"; then
  pass_check 12 "$desc"
else
  fail_check 12 "$desc" "$reason"
fi

# =============================================================================
# Check 13: no mandatory Layer-3a sink category empty/dropped. sink-inventory.txt
# must contain a header for ALL 19 sink categories. Each category header is
# anchored by its parenthesized CWE label `(CWE-XXX)`; a MISSING header is a
# failure. (A category with a COUNT of 0 is allowed - only a missing header
# fails.) Fixed-string grep is used so "(CWE-79)" cannot match "(CWE-798)".
# =============================================================================
desc="All 19 Layer-3a sink categories present in sink-inventory.txt"
sink_file="sink-inventory.txt"
if [ ! -s "$sink_file" ]; then
  fail_check 13 "$desc" "$sink_file missing or empty"
else
  missing=""
  for cwe in CWE-918 CWE-601 CWE-79 CWE-639 CWE-89 CWE-78 CWE-94 CWE-22 \
             CWE-502 CWE-611 CWE-1336 CWE-1321 CWE-327 CWE-338 CWE-798 \
             CWE-352 CWE-117 CWE-1333 CWE-367; do
    if ! grep -qF "($cwe)" "$sink_file"; then
      missing="$missing $cwe"
    fi
  done
  if [ -z "$missing" ]; then
    pass_check 13 "$desc"
  else
    fail_check 13 "$desc" "missing sink category header(s):$missing"
  fi
fi

# =============================================================================
# Check 14: agent-layer coverage. The agent layers (L1 architectural and L3b
# taint) must each carry a `coverage` summary (a non-empty object, or a
# "partial"/"full" string marker). Absence is a failure.
# =============================================================================
desc="Agent layers L1 and L3b carry a coverage summary"
if [ -z "$PYTHON" ]; then
  fail_check 14 "$desc" "no python interpreter available"
elif reason="$("$PYTHON" - 2>&1 <<'PY'
import json, sys
missing = []
for fn in ("findings-layer-1-arch.json", "findings-layer-3b-taint.json"):
    try:
        with open(fn) as fh:
            data = json.load(fh)
    except Exception as exc:
        missing.append("%s (unreadable: %s)" % (fn, exc))
        continue
    cov = data.get("coverage") if isinstance(data, dict) else None
    ok = (isinstance(cov, dict) and len(cov) > 0) or \
         (isinstance(cov, str) and cov.strip() != "")
    if not ok:
        missing.append("%s (no coverage summary)" % fn)
if missing:
    print("; ".join(missing))
    sys.exit(1)
sys.exit(0)
PY
)"; then
  pass_check 14 "$desc"
else
  fail_check 14 "$desc" "$reason"
fi

# =============================================================================
# Check 15: gate-blocking contract. Every finding in findings-layer-3b-taint.json
# must carry a boolean `gateBlocking` field; and every advisory finding
# (gateBlocking:false) must carry a non-empty `demotionReason`.
# =============================================================================
desc="Layer-3b findings carry gateBlocking (+ demotionReason where advisory)"
if [ -z "$PYTHON" ]; then
  fail_check 15 "$desc" "no python interpreter available"
elif reason="$("$PYTHON" - 2>&1 <<'PY'
import json, sys
fn = "findings-layer-3b-taint.json"
try:
    with open(fn) as fh:
        data = json.load(fh)
except Exception as exc:
    print("%s unreadable: %s" % (fn, exc))
    sys.exit(1)
findings = data.get("findings") if isinstance(data, dict) else None
if not isinstance(findings, list):
    print("findings array missing or not a list")
    sys.exit(1)
problems = []
for idx, item in enumerate(findings):
    if not isinstance(item, dict):
        problems.append("[%d] not an object" % idx)
        continue
    gb = item.get("gateBlocking", None)
    if not isinstance(gb, bool):
        problems.append("[%d] gateBlocking missing or non-boolean" % idx)
        continue
    if gb is False:
        dr = item.get("demotionReason")
        if not (isinstance(dr, str) and dr.strip()):
            problems.append("[%d] advisory finding lacks demotionReason" % idx)
if problems:
    print("; ".join(problems[:5]) + (" ..." if len(problems) > 5 else ""))
    sys.exit(1)
sys.exit(0)
PY
)"; then
  pass_check 15 "$desc"
else
  fail_check 15 "$desc" "$reason"
fi

# =============================================================================
# Check 16: gate verdict integrity. findings-merged.json must expose
# `gate.verdict` in {ERROR, BLOCK, WARN, PASS} and be internally consistent:
#   verdict == BLOCK  => at least one finding with gateBlocking:true.
#   verdict == ERROR  => at least one ERROR signal: a layer status ERROR, an
#                        agent-layer (1/3b) partial coverage, or a missing/empty
#                        mandatory artifact.
# =============================================================================
desc="Gate verdict present and internally consistent"
if [ -z "$PYTHON" ]; then
  fail_check 16 "$desc" "no python interpreter available"
elif reason="$("$PYTHON" - 2>&1 <<'PY'
import json, os, sys
merged = "findings-merged.json"
try:
    with open(merged) as fh:
        data = json.load(fh)
except Exception as exc:
    print("%s unreadable: %s" % (merged, exc))
    sys.exit(1)
gate = data.get("gate") if isinstance(data, dict) else None
if not isinstance(gate, dict):
    print("gate object missing from findings-merged.json")
    sys.exit(1)
verdict = gate.get("verdict")
allowed = {"ERROR", "BLOCK", "WARN", "PASS"}
if verdict not in allowed:
    print("gate.verdict %r not in {ERROR,BLOCK,WARN,PASS}" % (verdict,))
    sys.exit(1)


def count_blocking(obj):
    total = 0
    findings = obj.get("findings") if isinstance(obj, dict) else None
    if isinstance(findings, list):
        for f in findings:
            if isinstance(f, dict) and f.get("gateBlocking") is True:
                total += 1
    return total


blocking = count_blocking(data)
if blocking == 0:
    # The merged report carries gateBlocking only on Layer-3b-origin findings;
    # fall back to the Layer-3b file as the authoritative source.
    try:
        with open("findings-layer-3b-taint.json") as fh:
            blocking = count_blocking(json.load(fh))
    except Exception:
        blocking = 0

if verdict == "BLOCK":
    if blocking < 1:
        print("verdict BLOCK but no gateBlocking:true finding present")
        sys.exit(1)
elif verdict == "ERROR":
    signals = []
    layer_statuses = gate.get("layerStatuses")
    if isinstance(layer_statuses, dict):
        for key, val in layer_statuses.items():
            if isinstance(val, dict):
                if str(val.get("status")).upper() == "ERROR":
                    signals.append("layer %s status ERROR" % key)
                if str(key) in ("1", "3b") and \
                        str(val.get("coverage")).lower() == "partial":
                    signals.append("agent layer %s partial coverage" % key)
    mandatory = [
        "codebase-profile.txt", "findings-layer-1-arch.json",
        "findings-layer-2-semgrep.json", "findings-layer-3b-taint.json",
        "findings-layer-4-osv.json", "findings-merged.json",
        "sink-inventory.txt", "sink-inventory-test.txt",
        "mitigation-inventory.txt", "mitigation-inventory-test.txt",
    ]
    for fn in mandatory:
        if (not os.path.exists(fn)) or os.path.getsize(fn) == 0:
            signals.append("missing/empty %s" % fn)
    if not signals:
        print("verdict ERROR but no ERROR signal "
              "(no layer ERROR, no agent-layer partial, no missing artifact)")
        sys.exit(1)
# WARN / PASS: verdict membership already validated above.
sys.exit(0)
PY
)"; then
  pass_check 16 "$desc"
else
  fail_check 16 "$desc" "$reason"
fi

# =============================================================================
# Summary verdict.
# =============================================================================
printf '\n'
printf 'PASSED %s/%s\n' "$PASSED" "$TOTAL_CHECKS"
if [ "$PASSED" -eq "$TOTAL_CHECKS" ]; then
  exit 0
fi
exit 1
