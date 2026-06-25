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

# -----------------------------------------------------------------------------
# Single source of truth.
# These two lists are defined ONCE and exported so the python-backed checks can
# read them via os.environ. This guarantees:
#   * Check 12 (ANSI/missing) and Check 16 (missing-output -> ERROR) enforce the
#     SAME 13-deliverable contract, and
#   * Check 13 (header presence) and Check 16 (missing-category -> ERROR) enforce
#     the SAME 19 mandatory sink categories.
# No per-check list can silently drift out of sync with the audit contract.
# -----------------------------------------------------------------------------

# The 13 mandated audit deliverables (Directive D11 - the 11 normalized outputs
# plus the 2 raw intermediates results-semgrep.sarif / results-osv.json, plus
# verify.sh itself). All live at the repo ROOT and are referenced by bare
# filename, one per line. Consumed by Check 12 (missing + ANSI) and Check 16
# (a missing OR empty deliverable escalates the gate verdict to ERROR).
AUDIT_DELIVERABLES="codebase-profile.txt
findings-layer-1-arch.json
findings-layer-2-semgrep.json
findings-layer-3b-taint.json
findings-layer-4-osv.json
findings-merged.json
sink-inventory.txt
sink-inventory-test.txt
mitigation-inventory.txt
mitigation-inventory-test.txt
results-semgrep.sarif
results-osv.json
verify.sh"
export AUDIT_DELIVERABLES

# The 19 mandatory Layer-3a sink categories, keyed by their CWE label. Consumed
# by Check 13 (anchored header presence in sink-inventory.txt) and by Check 16
# (a missing mandatory category escalates the gate verdict to ERROR).
SINK_CWES="CWE-918 CWE-601 CWE-79 CWE-639 CWE-89 CWE-78 CWE-94 CWE-22 CWE-502 CWE-611 CWE-1336 CWE-1321 CWE-327 CWE-338 CWE-798 CWE-352 CWE-117 CWE-1333 CWE-367"
export SINK_CWES

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
# Check 12: deliverable completeness + ANSI hygiene. EVERY one of the 13
# mandated deliverables (the authoritative $AUDIT_DELIVERABLES list - the 12
# audit outputs + verify.sh itself) MUST exist, and NO ANSI escape sequence
# (ESC byte, 0x1b) may appear in ANY of them. A MISSING deliverable is a HARD
# FAILURE here (not silently skipped) so a dropped raw output - e.g.
# results-semgrep.sarif or results-osv.json - cannot pass the self-check.
# Implemented as a byte-level python scan (a sanctioned alternative to
# `grep -lP '\x1b'`) for portability and determinism.
# =============================================================================
desc="All 13 deliverables present and ANSI-free (no ESC 0x1b)"
if [ -z "$PYTHON" ]; then
  fail_check 12 "$desc" "no python interpreter available"
elif reason="$("$PYTHON" - 2>&1 <<'PY'
import os, sys
# Authoritative deliverable list (single source of truth, exported by the shell).
artifacts = [a for a in os.environ.get("AUDIT_DELIVERABLES", "").splitlines()
             if a.strip()]
if not artifacts:
    print("AUDIT_DELIVERABLES not provided to Check 12")
    sys.exit(1)
esc = b"\x1b"
missing = []
hits = []
# Fail on missing deliverables FIRST (presence is a prerequisite for hygiene).
for fn in artifacts:
    if not os.path.exists(fn):
        missing.append(fn)
        continue
    try:
        with open(fn, "rb") as fh:
            if esc in fh.read():
                hits.append(fn)
    except Exception as exc:
        hits.append("%s (read error: %s)" % (fn, exc))
problems = []
if missing:
    problems.append("missing deliverable(s): " + ", ".join(missing))
if hits:
    problems.append("ESC (0x1b) byte present in: " + ", ".join(hits))
if problems:
    print("; ".join(problems))
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
# must contain a HEADER LINE for ALL 19 sink categories. Validation is ANCHORED
# to the exact header format `^--- <category> (CWE-XXX) ---$` (NOT a loose
# search anywhere in the file), so a CWE label that appears only in a body /
# evidence line cannot satisfy the check. A MISSING header is a failure; a
# category whose COUNT is 0 (header present, no hits) is allowed. The literal
# `(` ... `)` around the CWE plus the trailing ` ---$` also guarantee that
# "(CWE-79)" cannot be matched by the "(CWE-798)" header. The 19 categories come
# from the shared $SINK_CWES single source of truth (also used by Check 16).
# =============================================================================
desc="All 19 Layer-3a sink category headers present in sink-inventory.txt"
sink_file="sink-inventory.txt"
if [ ! -s "$sink_file" ]; then
  fail_check 13 "$desc" "$sink_file missing or empty"
elif [ -z "${SINK_CWES:-}" ]; then
  fail_check 13 "$desc" "SINK_CWES list not provided"
else
  missing=""
  for cwe in $SINK_CWES; do
    # Anchored header match: line must start with "--- ", end with " ---", and
    # carry the parenthesized CWE label immediately before the trailing " ---".
    if ! grep -qE "^--- .*\(${cwe}\) ---\$" "$sink_file"; then
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
# Check 14: agent-layer coverage completeness. The agent layers (L1
# architectural and L3b taint) must each carry a `coverage` OBJECT that covers
# EVERY mandated category, and every coverage value must be one of {full,
# partial}. This enforces the AAP "no silent omission" contract for agent
# layers: a missing category, a non-object coverage, or a coverage value
# outside {full, partial} is a FAILURE.
#   * L1 must cover all 10 architectural categories.
#   * L3b must cover all 19 taint/sink categories.
# (Extra categories beyond the mandated set are tolerated; only an ABSENT
#  mandated category or an INVALID value fails.)
# =============================================================================
desc="Agent layers L1/L3b cover all mandated categories with values in {full,partial}"
if [ -z "$PYTHON" ]; then
  fail_check 14 "$desc" "no python interpreter available"
elif reason="$("$PYTHON" - 2>&1 <<'PY'
import json, sys

L1_REQUIRED = [
    "Secrets & key management",
    "Container hardening",
    "CI/CD supply-chain integrity",
    "CSP & security-headers posture",
    "Webhook / signature verification",
    "API version security parity",
    "Authentication architecture",
    "Authorization / access-control architecture",
    "CORS posture",
    "Exceptional-conditions / fail-open & rate-limit logic",
]
L3B_REQUIRED = [
    "SSRF",
    "Open redirect",
    "XSS (DOM sink)",
    "IDOR / missing object-level authz",
    "SQL injection",
    "Command injection",
    "Code injection",
    "Path traversal",
    "Deserialization",
    "XXE (XML external entity)",
    "Template injection",
    "Prototype pollution",
    "Weak cryptography",
    "Insecure randomness",
    "Hardcoded secrets",
    "CSRF surface",
    "Log injection",
    "ReDoS (dynamic RegExp)",
    "TOCTOU / race",
]
ALLOWED = {"full", "partial"}

problems = []
for fn, required in (("findings-layer-1-arch.json", L1_REQUIRED),
                     ("findings-layer-3b-taint.json", L3B_REQUIRED)):
    try:
        with open(fn) as fh:
            data = json.load(fh)
    except Exception as exc:
        problems.append("%s unreadable: %s" % (fn, exc))
        continue
    cov = data.get("coverage") if isinstance(data, dict) else None
    if not isinstance(cov, dict):
        problems.append("%s: coverage is not an object (got %s)"
                        % (fn, type(cov).__name__))
        continue
    absent = [c for c in required if c not in cov]
    if absent:
        problems.append("%s: missing categor(y/ies): %s"
                        % (fn, ", ".join(absent[:6])
                           + (" ..." if len(absent) > 6 else "")))
    bad = ["%s=%r" % (c, cov[c]) for c in required
           if c in cov and str(cov[c]).strip().lower() not in ALLOWED]
    if bad:
        problems.append("%s: value(s) not in {full,partial}: %s"
                        % (fn, "; ".join(bad[:6])
                           + (" ..." if len(bad) > 6 else "")))
if problems:
    print(" | ".join(problems))
    sys.exit(1)
sys.exit(0)
PY
)"; then
  pass_check 14 "$desc"
else
  fail_check 14 "$desc" "$reason"
fi

# =============================================================================
# Check 15: gate-blocking truth-table contract. Every finding in
# findings-layer-3b-taint.json must carry a BOOLEAN `gateBlocking`, and the
# `demotionReason` requirement of the AAP truth table is enforced in FULL:
#
#   * Advisory (gateBlocking:false): a sound-but-incomplete/scope-limited
#     mitigation at medium/low severity REQUIRES a `demotionReason`.
#   * Blocking (gateBlocking:true) at critical/high severity where a mitigation
#     EXISTS but is broken/bypassable/known-weak ALSO REQUIRES a `demotionReason`
#     (the second positive-blocking case the AAP truth table mandates).
#
# A finding is treated as that broken-mitigation case when its EVIDENCE fields
# (description + source + sink + category - deliberately NOT demotionReason, so
# a missing reason cannot hide the requirement) reference a mitigation/defense
# context. The heuristic errs STRICT: any critical/high blocking finding whose
# evidence names a defense must justify - via demotionReason - why it still
# blocks. Pure "no mitigation at all" blocking findings (the first true case)
# need no demotionReason and are not forced to carry one.
# =============================================================================
desc="Layer-3b findings honor the full gateBlocking + demotionReason truth table"
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

# Signal terms (lowercase substrings) that indicate a mitigation/defense is
# PRESENT but broken/bypassable/known-weak/insufficient on the dataflow path.
MITIGATION_SIGNALS = (
    "broken", "bypass", "known-weak", "known weak", "weak", "mitigat",
    "validat", "insufficient", "legacy", "fallback", "rebinding", "scoping",
    "scoped", "replacement", "keyring", "guard", "sanitiz", "auth", "csrf",
    "throttle", "rate limit", "rate-limit", "no mac", "without integrity",
    "authentication tag", "padding-oracle", "malleable", "gap", "escape hatch",
)


def has_reason(item):
    dr = item.get("demotionReason")
    return isinstance(dr, str) and dr.strip() != ""


def evidence_blob(item):
    # Only NON-demotionReason fields, so omitting the reason can never make the
    # finding evade the requirement.
    parts = [item.get(k) for k in ("description", "source", "sink", "category")]
    return " ".join(p for p in parts if isinstance(p, str)).lower()


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
        # Advisory finding: demotionReason is always required.
        if not has_reason(item):
            problems.append("[%d] advisory (gateBlocking:false) lacks demotionReason"
                            % idx)
        continue
    # gb is True: enforce the broken-mitigation positive-blocking case.
    sev = str(item.get("severity", "")).strip().lower()
    if sev in ("critical", "high"):
        blob = evidence_blob(item)
        if any(sig in blob for sig in MITIGATION_SIGNALS) and not has_reason(item):
            problems.append(
                "[%d] critical/high gateBlocking:true broken/known-weak-mitigation "
                "finding lacks demotionReason" % idx)
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
# `gate.verdict` in {ERROR, BLOCK, WARN, PASS}, AND that verdict must equal the
# verdict RECOMPUTED from the underlying artifact state using the EXACT D9
# precedence (the reproducibility anchor):
#
#   ERROR  if any layer status is ERROR, OR any of the 13 required deliverables
#          is missing/empty, OR any mandatory Layer-3a sink category is missing,
#          OR any AGENT layer (1 or 3b) reports coverage == "partial".
#          (A DETERMINISTIC layer being partial - e.g. Layer 2 Semgrep - does
#           NOT escalate to ERROR, per the AAP.)
#   else BLOCK  if any Layer-3b finding has gateBlocking:true.
#   else WARN   if total findings exceed the baseline by more than 20%.
#   else PASS.
#
# The check FAILS unless gate.verdict == recomputed verdict, so an invalid PASS,
# WARN, or BLOCK can no longer pass self-verification. The recorded
# gate.thresholdExceeded flag is additionally cross-checked for WARN-threshold
# consistency. The deliverable and sink-category lists are the SAME single
# sources of truth used by Check 12 and Check 13 ($AUDIT_DELIVERABLES /
# $SINK_CWES).
# =============================================================================
desc="Gate verdict equals the verdict recomputed by D9 precedence"
if [ -z "$PYTHON" ]; then
  fail_check 16 "$desc" "no python interpreter available"
elif reason="$("$PYTHON" - 2>&1 <<'PY'
import json, os, re, sys

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

# The single-source-of-truth lists MUST reach this check; a missing export is a
# loud failure (never a silent under-enforcement).
deliverables = [a for a in os.environ.get("AUDIT_DELIVERABLES", "").splitlines()
                if a.strip()]
cwes = os.environ.get("SINK_CWES", "").split()
if not deliverables:
    print("AUDIT_DELIVERABLES not provided to Check 16")
    sys.exit(1)
if not cwes:
    print("SINK_CWES not provided to Check 16")
    sys.exit(1)


def load_json(fn):
    try:
        with open(fn) as fh:
            return json.load(fh)
    except Exception:
        return None


def count_blocking(obj):
    total = 0
    findings = obj.get("findings") if isinstance(obj, dict) else None
    if isinstance(findings, list):
        for f in findings:
            if isinstance(f, dict) and f.get("gateBlocking") is True:
                total += 1
    return total


def coverage_has_partial(cov):
    # Agent-layer coverage is a per-category dict; deterministic layers record a
    # plain string. Either form is "partial" if a partial marker appears.
    if isinstance(cov, dict):
        return any(str(v).strip().lower() == "partial" for v in cov.values())
    if isinstance(cov, str):
        return cov.strip().lower() == "partial"
    return False


# ---- Recompute the ERROR signals (highest precedence). ----------------------
signals = []

layer_statuses = gate.get("layerStatuses")
# (a) any layer status ERROR - from the gate's recorded per-layer statuses ...
if isinstance(layer_statuses, dict):
    for key, val in layer_statuses.items():
        if isinstance(val, dict) and str(val.get("status")).upper() == "ERROR":
            signals.append("layer %s status ERROR" % key)
# ... and cross-checked against each normalized layer artifact's own status.
layer_files = {
    "1": "findings-layer-1-arch.json",
    "2": "findings-layer-2-semgrep.json",
    "3b": "findings-layer-3b-taint.json",
    "4": "findings-layer-4-osv.json",
}
layer_docs = {}
for lk, lf in layer_files.items():
    doc = load_json(lf)
    layer_docs[lk] = doc
    if isinstance(doc, dict) and str(doc.get("status")).upper() == "ERROR":
        signals.append("layer %s artifact status ERROR" % lk)

# (b) any required deliverable missing OR empty (same 13-list as Check 12).
for fn in deliverables:
    if (not os.path.exists(fn)) or os.path.getsize(fn) == 0:
        signals.append("missing/empty %s" % fn)

# (c) any mandatory Layer-3a sink category missing (anchored header check -
#     the same contract Check 13 enforces).
sink_file = "sink-inventory.txt"
try:
    with open(sink_file, encoding="utf-8", errors="replace") as fh:
        sink_lines = fh.read().splitlines()
except Exception:
    sink_lines = []
    signals.append("%s unreadable" % sink_file)
for cwe in cwes:
    pat = re.compile(r"^--- .*\(" + re.escape(cwe) + r"\) ---$")
    if not any(pat.match(ln) for ln in sink_lines):
        signals.append("missing sink category header %s" % cwe)

# (d) any AGENT layer (1 or 3b ONLY) reporting partial coverage.
for lk in ("1", "3b"):
    partial = False
    if isinstance(layer_statuses, dict) and \
            isinstance(layer_statuses.get(lk), dict):
        if coverage_has_partial(layer_statuses[lk].get("coverage")):
            partial = True
    doc = layer_docs.get(lk)
    if isinstance(doc, dict) and coverage_has_partial(doc.get("coverage")):
        partial = True
    if partial:
        signals.append("agent layer %s partial coverage" % lk)

# ---- Recompute the BLOCK input. ---------------------------------------------
# The Layer-3b artifact is the authoritative source of gateBlocking; the merged
# report (which copies gateBlocking onto L3b-origin findings) is the fallback.
l3b = layer_docs.get("3b")
blocking = count_blocking(l3b) if isinstance(l3b, dict) else count_blocking(data)

# ---- Recompute the WARN input. ----------------------------------------------
total_findings = len(data.get("findings") or []) if isinstance(data, dict) else 0
baseline = gate.get("baselineFindingCount")
if not isinstance(baseline, (int, float)) or isinstance(baseline, bool):
    meta = data.get("metadata") if isinstance(data, dict) else None
    if isinstance(meta, dict):
        baseline = meta.get("baselineFindingCount")
has_baseline = isinstance(baseline, (int, float)) and not isinstance(baseline, bool) \
    and baseline > 0
threshold_exceeded = bool(has_baseline and total_findings > baseline * 1.2)

# ---- Apply the EXACT D9 precedence: ERROR > BLOCK > WARN > PASS. -------------
if signals:
    expected = "ERROR"
elif blocking >= 1:
    expected = "BLOCK"
elif threshold_exceeded:
    expected = "WARN"
else:
    expected = "PASS"

if verdict != expected:
    if signals:
        detail = "ERROR signals: " + "; ".join(signals[:4])
        if len(signals) > 4:
            detail += " ..."
    else:
        detail = ("blocking=%d total=%d baseline=%s thresholdExceeded=%s"
                  % (blocking, total_findings, baseline, threshold_exceeded))
    print("gate.verdict %r != recomputed %r (%s)"
          % (verdict, expected, detail))
    sys.exit(1)

# ---- WARN-threshold consistency cross-check. --------------------------------
te = gate.get("thresholdExceeded")
if isinstance(te, bool) and te != threshold_exceeded:
    print("gate.thresholdExceeded=%r but recomputed=%r (total=%d baseline=%s)"
          % (te, threshold_exceeded, total_findings, baseline))
    sys.exit(1)

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
