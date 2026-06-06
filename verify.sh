#!/usr/bin/env bash
#
# verify.sh — Directive 10 self-validating verification harness for the
#             blitzy-cal five-layer read-only security audit.
#
# Purpose
# -------
# Deterministically validate the complete set of audit artifacts produced by
# Directives 0-9 against the binding pass/fail criteria of the Agent Action Plan
# (AAP §0.1.4 R10, §0.4.2, §0.4.3, §0.7). The script encodes 16 checks; each
# prints "PASS <N>: ..." or "FAIL <N>: ...". The process exit code equals the
# number of failed checks (0 == all green), per AAP §0.4.2.
#
# Read-only contract
# ------------------
# This harness ONLY reads artifacts and prints results. It never creates,
# modifies, or deletes any file in the repository, honoring the audit's
# "~0 files modified" / zero-modification mandate (AAP §0.5.2, §0.7).
#
# Determinism
# -----------
# LC_ALL=C and a fixed traversal/sort order make every run byte-identical on
# identical inputs (AAP §0.7 determinism rule). The script is non-interactive.
#
# Lockfile-aware dedupe (resolution of QA Checkpoint-2 Issue #1)
# -------------------------------------------------------------
# Two AAP rules are in tension for Layer-4 (OSV/SCA) findings:
#   * §0.7  — EVERY lockfile finding uses line:0.
#   * §0.3.3 — cross-layer dedupe collapses findings sharing (file,line,cwe).
# Because all OSV rows share yarn.lock:0, a naive global (file,line,cwe)
# uniqueness probe collides whenever two distinct CVEs map to the same CWE.
# Collapsing them would DESTROY distinct CVEs and violate SCA-completeness
# (Layer 4 "catalogs dependency CVEs"; OSV dedupe is by (package, CVE)).
# Therefore CHECK 15 applies the lockfile carve-out the AAP intends:
#   (a) NON-lockfile (source-code) findings must be globally unique by
#       (file,line,cwe)  — the cross-layer corroboration identity; and
#   (b) lockfile (yarn.lock / OSV) findings must be unique by their
#       (package, CVE) identity, captured by the distinct normalized
#       description (the L4 _coverage records "deduped by (package, CVE/
#       advisory ID)"); plus no whole-record duplicates anywhere.
# This makes the dedupe-uniqueness invariant well-defined and PASSING without
# altering the (correct) merged data.
#
# Usage
# -----
#   ./verify.sh            # from the repository root (where the artifacts live)
#   bash verify.sh         # equivalent; the script cd's to its own directory
#
set -u
export LC_ALL=C

# Resolve and enter the directory containing this script (== artifact dir),
# so all relative artifact paths resolve regardless of the caller's cwd.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
cd "$SCRIPT_DIR" || { echo "FATAL: cannot cd to script directory '$SCRIPT_DIR'"; exit 255; }

# Hard dependency: jq (used for every JSON assertion).
if ! command -v jq >/dev/null 2>&1; then
  echo "FATAL: 'jq' is required but not found on PATH"; exit 255
fi

pass_count=0
fail_count=0

# ok <n> <message>  / no <n> <message>  — record and print a check result.
ok() { pass_count=$((pass_count + 1)); printf 'PASS %s: %s\n' "$1" "$2"; }
no() { fail_count=$((fail_count + 1)); printf 'FAIL %s: %s\n' "$1" "$2"; }

# num <jq-filter> <file> — emit a jq scalar (number) or 0 on any error.
num() { local v; v="$(jq "$1" "$2" 2>/dev/null)"; [ -n "$v" ] && [ "$v" != "null" ] && printf '%s' "$v" || printf '0'; }

# countlines <pipeline-output> — strip whitespace from a wc -l style count.
strip() { tr -d '[:space:]'; }

# Canonical artifact set (AAP §0.4).
REQUIRED_ARTIFACTS=(
  codebase-profile.txt
  findings-layer-1-arch.json
  findings-layer-2-semgrep.json
  findings-layer-3b-taint.json
  findings-layer-4-osv.json
  findings-merged.json
  results-semgrep.sarif
  results-osv.json
  sink-inventory.txt
  sink-inventory-test.txt
  mitigation-inventory.txt
  mitigation-inventory-test.txt
  rules/security-audit.yaml
  rules/secrets.yaml
  rules/owasp-top-ten.yaml
)

# Normalized text artifacts subject to the ANSI-cleanliness rule (AAP §0.7).
TEXT_ARTIFACTS=(
  codebase-profile.txt
  findings-layer-1-arch.json
  findings-layer-2-semgrep.json
  findings-layer-3b-taint.json
  findings-layer-4-osv.json
  findings-merged.json
  sink-inventory.txt
  mitigation-inventory.txt
  sink-inventory-test.txt
  mitigation-inventory-test.txt
)

MERGED=findings-merged.json
L1=findings-layer-1-arch.json
L2=findings-layer-2-semgrep.json
L3B=findings-layer-3b-taint.json
L4=findings-layer-4-osv.json

# ---------------------------------------------------------------------------
# CHECK 1 — Artifact existence (Directive 0-10 outputs + pinned rule packs).
# ---------------------------------------------------------------------------
miss=""
for a in "${REQUIRED_ARTIFACTS[@]}"; do [ -e "$a" ] || miss="$miss $a"; done
if [ -z "$miss" ]; then
  ok 1 "all ${#REQUIRED_ARTIFACTS[@]} required audit artifacts present (4 layer JSONs, merged, 2 raw intermediates, 4 inventories, profile, 3 rule packs)"
else
  no 1 "missing required artifacts:$miss"
fi

# ---------------------------------------------------------------------------
# CHECK 2 — codebase-profile.txt required keys + layer_0_status not ERROR.
# ---------------------------------------------------------------------------
prof=codebase-profile.txt
pmiss=""
if [ -f "$prof" ]; then
  for k in primary_language secondary_languages frameworks package_ecosystems \
           lockfiles source_file_count exclude_dirs layer_0_status; do
    grep -qE "^${k}=" "$prof" || pmiss="$pmiss $k"
  done
  l0="$(grep -E '^layer_0_status=' "$prof" | head -1 | cut -d= -f2-)"
  pl="$(grep -E '^primary_language=' "$prof" | head -1 | cut -d= -f2-)"
else
  pmiss=" (file absent)"; l0=""; pl=""
fi
if [ -z "$pmiss" ] && [ -n "$pl" ] && [ "$l0" != "ERROR" ]; then
  ok 2 "codebase-profile.txt has all 8 required keys; primary_language='$pl'; layer_0_status='$l0' (!= ERROR)"
else
  no 2 "profile issues — missing_keys:[$pmiss] primary_language='$pl' layer_0_status='$l0'"
fi

# ---------------------------------------------------------------------------
# CHECK 3 — Layer 1 (arch): valid JSON + 10/10 category coverage + schema.
# ---------------------------------------------------------------------------
if jq -e . "$L1" >/dev/null 2>&1; then
  cats="$(num '[.[]|select(has("_coverage"))][0]._coverage|length' "$L1")"
  n="$(num '[.[]|select(.file)]|length' "$L1")"
  bad="$(num '[.[]|select(.file)|select((.layer==1 and .tool=="arch-audit" and (.cwe|type=="string"))|not)]|length' "$L1")"
  if [ "$cats" = "10" ] && [ "$n" -ge 1 ] && [ "$bad" = "0" ]; then
    ok 3 "Layer1 valid JSON; 10/10 category summaries; $n findings; schema(layer=1,tool=arch-audit) OK"
  else
    no 3 "Layer1 issues — categories=$cats(exp 10) findings=$n schema_violations=$bad"
  fi
else
  no 3 "Layer1 ($L1) is not valid JSON"
fi

# ---------------------------------------------------------------------------
# CHECK 4 — Layer 2 (semgrep): valid JSON + schema (layer=2, tool=semgrep).
# ---------------------------------------------------------------------------
if jq -e . "$L2" >/dev/null 2>&1; then
  n="$(num '[.[]|select(.file)]|length' "$L2")"
  bad="$(num '[.[]|select(.file)|select((.layer==2 and .tool=="semgrep" and (.cwe|type=="string"))|not)]|length' "$L2")"
  if [ "$n" -ge 1 ] && [ "$bad" = "0" ]; then
    ok 4 "Layer2 valid JSON; $n findings; schema(layer=2,tool=semgrep) OK"
  else
    no 4 "Layer2 issues — findings=$n schema_violations=$bad"
  fi
else
  no 4 "Layer2 ($L2) is not valid JSON"
fi

# ---------------------------------------------------------------------------
# CHECK 5 — Layer 4 (osv): valid JSON + every finding line:0 + schema.
# ---------------------------------------------------------------------------
if jq -e . "$L4" >/dev/null 2>&1; then
  n="$(num '[.[]|select(.file)]|length' "$L4")"
  nz="$(num '[.[]|select(.file)|select(.line!=0)]|length' "$L4")"
  bad="$(num '[.[]|select(.file)|select((.layer==4 and .tool=="osv-scanner")|not)]|length' "$L4")"
  if [ "$n" -ge 1 ] && [ "$nz" = "0" ] && [ "$bad" = "0" ]; then
    ok 5 "Layer4 valid JSON; $n findings; all line:0 (lockfile convention); schema(layer=4,tool=osv-scanner) OK"
  else
    no 5 "Layer4 issues — findings=$n line!=0:$nz schema_violations=$bad"
  fi
else
  no 5 "Layer4 ($L4) is not valid JSON"
fi

# ---------------------------------------------------------------------------
# CHECK 6 — Layer 3a inventories: non-empty + line format + test variants.
#   Format per AAP: <file>:<line>:<category>:<text>  (line is an integer).
# ---------------------------------------------------------------------------
inv_ok=1; reason=""
for inv in sink-inventory.txt mitigation-inventory.txt; do
  if [ ! -s "$inv" ]; then inv_ok=0; reason="$reason $inv:empty-or-absent"; continue; fi
  badfmt="$(grep -cvE '^[^:]+:[0-9]+:[^:]+:' "$inv")"; badfmt="$(printf '%s' "$badfmt" | strip)"
  [ "$badfmt" = "0" ] || { inv_ok=0; reason="$reason $inv:${badfmt}-malformed-lines"; }
done
for inv in sink-inventory-test.txt mitigation-inventory-test.txt; do
  [ -e "$inv" ] || { inv_ok=0; reason="$reason $inv:absent"; }
done
if [ "$inv_ok" = "1" ]; then
  ok 6 "Layer3a inventories non-empty & well-formed (<file>:<line>:<category>:<text>); test variants present"
else
  no 6 "Layer3a inventory issues —$reason"
fi

# ---------------------------------------------------------------------------
# CHECK 7 — Layer 3b (taint): valid JSON + 19/19 categories + gateBlocking +
#           demotionReason present on every advisory (gateBlocking=false).
# ---------------------------------------------------------------------------
if jq -e . "$L3B" >/dev/null 2>&1; then
  cats="$(num '[.[]|select(has("_coverage"))][0]._coverage|length' "$L3B")"
  n="$(num '[.[]|select(.file)]|length' "$L3B")"
  bad="$(num '[.[]|select(.file)|select((.layer==3 and .tool=="taint-analysis" and (.gateBlocking|type=="boolean"))|not)]|length' "$L3B")"
  advnodemo="$(num '[.[]|select(.file)|select(.gateBlocking==false)|select(((.demotionReason|type=="string") and (.demotionReason|length>0))|not)]|length' "$L3B")"
  if [ "$cats" = "19" ] && [ "$n" -ge 1 ] && [ "$bad" = "0" ] && [ "$advnodemo" = "0" ]; then
    ok 7 "Layer3b valid JSON; 19/19 category summaries; $n findings; gateBlocking boolean present; advisories carry demotionReason"
  else
    no 7 "Layer3b issues — categories=$cats(exp 19) findings=$n schema_violations=$bad advisories_without_demotionReason=$advnodemo"
  fi
else
  no 7 "Layer3b ($L3B) is not valid JSON"
fi

# ---------------------------------------------------------------------------
# CHECK 8 — findings-merged.json: valid JSON AND single-line minified.
# ---------------------------------------------------------------------------
if jq -e . "$MERGED" >/dev/null 2>&1; then
  lines="$(wc -l < "$MERGED" | strip)"
  if [ "${lines:-99}" -le 1 ]; then
    ok 8 "findings-merged.json is valid JSON and single-line minified (wc -l=$lines)"
  else
    no 8 "findings-merged.json valid JSON but NOT single-line (wc -l=$lines)"
  fi
else
  no 8 "findings-merged.json is not valid JSON"
fi

# ---------------------------------------------------------------------------
# CHECK 9 — _summary first element: required keys + internal consistency.
# ---------------------------------------------------------------------------
skeys="$(jq -r '
  (.[0]._summary) as $s
  | (if ($s|type)=="object" then
      (["total_findings","unique_findings","corroborated","gate_blocking","by_layer","source_by_layer","by_severity","layer_status","gate_verdict"]
       | map(. as $k | ($s|has($k))) | all)
     else false end)' "$MERGED" 2>/dev/null)"
corro="$(num '.[0]._summary.corroborated' "$MERGED")"
corro_body="$(num '[.[1:][]|select(.corroborated_by)]|length' "$MERGED")"
gb="$(num '.[0]._summary.gate_blocking' "$MERGED")"
gb_body="$(num '[.[1:][]|select(.gateBlocking==true)]|length' "$MERGED")"
if [ "$skeys" = "true" ] && [ "$corro" = "$corro_body" ] && [ "$gb" = "$gb_body" ]; then
  ok 9 "_summary present with all 9 required keys; corroborated=$corro==body($corro_body); gate_blocking=$gb==body($gb_body)"
else
  no 9 "_summary issues — all_keys=$skeys corroborated($corro vs body $corro_body) gate_blocking($gb vs body $gb_body)"
fi

# ---------------------------------------------------------------------------
# CHECK 10 — gate_verdict ∈ {ERROR, BLOCK, WARN, PASS} (Directive 9).
# ---------------------------------------------------------------------------
gv="$(jq -r '.[0]._summary.gate_verdict // empty' "$MERGED" 2>/dev/null)"
case "$gv" in
  ERROR|BLOCK|WARN|PASS) ok 10 "gate_verdict='$gv' is a valid Directive-9 verdict {ERROR,BLOCK,WARN,PASS}" ;;
  *)                     no 10 "gate_verdict='$gv' is not in the allowed enum {ERROR,BLOCK,WARN,PASS}" ;;
esac

# ---------------------------------------------------------------------------
# CHECK 11 — Count reconciliation (AAP §0.4.3 check #11), lockfile-aware:
#   uses select(.file) on ALL four layer files so the leading "_coverage"
#   metadata elements (present in L2 and L4) are never miscounted.
#     total_findings  == Σ per-layer real findings == Σ source_by_layer
#     unique_findings == merged body == Σ by_layer == Σ by_severity
#     corroborated    == total_findings - unique_findings
# ---------------------------------------------------------------------------
c1="$(num '[.[]|select(.file)]|length' "$L1")"
c2="$(num '[.[]|select(.file)]|length' "$L2")"
c3="$(num '[.[]|select(.file)]|length' "$L3B")"
c4="$(num '[.[]|select(.file)]|length' "$L4")"
src_sum=$(( c1 + c2 + c3 + c4 ))
total="$(num '.[0]._summary.total_findings' "$MERGED")"
uniq="$(num '.[0]._summary.unique_findings' "$MERGED")"
body="$(num '.[1:]|length' "$MERGED")"
bl_sum="$(num '[.[0]._summary.by_layer[]]|add' "$MERGED")"
bs_sum="$(num '[.[0]._summary.by_severity[]]|add' "$MERGED")"
sbl_sum="$(num '[.[0]._summary.source_by_layer[]]|add' "$MERGED")"
diff="$(num '.[0]._summary|(.total_findings - .unique_findings)' "$MERGED")"
corro2="$(num '.[0]._summary.corroborated' "$MERGED")"
if [ "$total" = "$src_sum" ] && [ "$total" = "$sbl_sum" ] && \
   [ "$uniq" = "$body" ] && [ "$uniq" = "$bl_sum" ] && [ "$uniq" = "$bs_sum" ] && \
   [ "$corro2" = "$diff" ]; then
  ok 11 "count reconciliation OK — total=$total=Σsource($src_sum)=Σsource_by_layer($sbl_sum); unique=$uniq=body($body)=Σby_layer($bl_sum)=Σby_severity($bs_sum); corroborated=$corro2=total-unique"
else
  no 11 "count reconciliation FAILED — total=$total src_sum=$src_sum source_by_layer=$sbl_sum | unique=$uniq body=$body by_layer=$bl_sum by_severity=$bs_sum | corroborated=$corro2 diff=$diff"
fi

# ---------------------------------------------------------------------------
# CHECK 12 — Unified severity vocabulary across merged body + all 4 layers.
# ---------------------------------------------------------------------------
sev_bad=0
sev_bad=$(( sev_bad + $(num '[.[1:][]|select(.severity|IN("critical","high","medium","low")|not)]|length' "$MERGED") ))
for f in "$L1" "$L2" "$L3B" "$L4"; do
  sev_bad=$(( sev_bad + $(num '[.[]|select(.file)|select(.severity|IN("critical","high","medium","low")|not)]|length' "$f") ))
done
if [ "$sev_bad" = "0" ]; then
  ok 12 "severity vocabulary unified to {critical,high,medium,low} across merged body and all 4 layer files"
else
  no 12 "$sev_bad finding(s) carry a severity outside {critical,high,medium,low}"
fi

# ---------------------------------------------------------------------------
# CHECK 13 — Every finding: non-empty description (<=200 chars) + integer line.
# ---------------------------------------------------------------------------
ds_bad=0
ds_bad=$(( ds_bad + $(num '[.[1:][]|select((.description|type!="string") or (.description|length==0) or (.description|length>200) or (.line|type!="number") or (.line!=(.line|floor)))]|length' "$MERGED") ))
for f in "$L1" "$L2" "$L3B" "$L4"; do
  ds_bad=$(( ds_bad + $(num '[.[]|select(.file)|select((.description|type!="string") or (.description|length==0) or (.description|length>200) or (.line|type!="number") or (.line!=(.line|floor)))]|length' "$f") ))
done
if [ "$ds_bad" = "0" ]; then
  ok 13 "every finding has a non-empty description (<=200 chars) and an integer line (merged body + all layers)"
else
  no 13 "$ds_bad finding(s) violate description-non-empty/<=200 or integer-line"
fi

# ---------------------------------------------------------------------------
# CHECK 14 — ANSI-free output: no ESC (0x1b) sequences in any text artifact.
# ---------------------------------------------------------------------------
ansi=0
for f in "${TEXT_ARTIFACTS[@]}"; do
  [ -f "$f" ] || continue
  n="$(grep -acP '\x1b' "$f" 2>/dev/null)"; n="$(printf '%s' "${n:-0}" | strip)"
  ansi=$(( ansi + ${n:-0} ))
done
if [ "$ansi" = "0" ]; then
  ok 14 "no ANSI escape sequences present in any of the ${#TEXT_ARTIFACTS[@]} text artifacts"
else
  no 14 "$ansi line(s) across text artifacts contain ANSI escape sequences"
fi

# ---------------------------------------------------------------------------
# CHECK 15 — Lockfile-aware dedupe-uniqueness & corroboration integrity.
#            (Resolution of QA Checkpoint-2 Issue #1 — see header note.)
#   (a) NON-lockfile findings unique by (file,line,cwe)        -> uniq -d empty
#   (b) lockfile/OSV findings unique by (package,CVE)≈desc      -> uniq -d empty
#   (c) no whole-record exact duplicates anywhere in the body
#   (d) every corroborated_by lists >= 2 distinct tools
# ---------------------------------------------------------------------------
dup_src="$(jq -r '.[1:][]|select(.file and .file!="yarn.lock")|"\(.file)|\(.line)|\(.cwe)"' "$MERGED" 2>/dev/null | sort | uniq -d | wc -l | strip)"
dup_lock="$(jq -r '.[1:][]|select(.file=="yarn.lock")|.description' "$MERGED" 2>/dev/null | sort | uniq -d | wc -l | strip)"
dup_rec="$(jq -c '.[1:][]' "$MERGED" 2>/dev/null | sort | uniq -d | wc -l | strip)"
corro_bad="$(num '[.[1:][]|select(.corroborated_by)|select((.corroborated_by|unique|length)<2)]|length' "$MERGED")"
if [ "${dup_src:-1}" = "0" ] && [ "${dup_lock:-1}" = "0" ] && [ "${dup_rec:-1}" = "0" ] && [ "$corro_bad" = "0" ]; then
  ok 15 "lockfile-aware dedupe-uniqueness OK — source findings unique by (file,line,cwe); OSV findings unique by (package,CVE)/description; 0 whole-record dups; all corroborations have >=2 distinct tools"
else
  no 15 "dedupe/corroboration issues — nonlockfile_(file,line,cwe)_dups=$dup_src lockfile_identity_dups=$dup_lock whole_record_dups=$dup_rec corroborations_with_<2_tools=$corro_bad"
fi

# ---------------------------------------------------------------------------
# CHECK 16 — Every Layer-3 (taint) finding references a file:line present in
#            sink-inventory.txt (AAP §0.4.3 check #16). Uses fixed-string
#            matching (grep -F): Cal.com paths contain regex metacharacters
#            such as [id], [...pages], and (route-group) segments.
# ---------------------------------------------------------------------------
miss16=0; checked16=0
while IFS= read -r fl; do
  [ -n "$fl" ] || continue
  checked16=$(( checked16 + 1 ))
  grep -qF "${fl}:" sink-inventory.txt 2>/dev/null || miss16=$(( miss16 + 1 ))
done < <(jq -r '.[1:][]|select(.layer==3)|"\(.file):\(.line)"' "$MERGED" 2>/dev/null | sort -u)
if [ "$miss16" = "0" ] && [ "$checked16" -ge 1 ]; then
  ok 16 "all $checked16 unique Layer-3 finding file:line references are present in sink-inventory.txt (fixed-string match)"
else
  no 16 "$miss16 of $checked16 Layer-3 finding file:line references are absent from sink-inventory.txt"
fi

# ---------------------------------------------------------------------------
# Summary + exit code (== number of failed checks, AAP §0.4.2).
# ---------------------------------------------------------------------------
echo "--------------------------------------------------------------------"
printf 'verify.sh: %d/16 checks passed, %d failed.\n' "$pass_count" "$fail_count"
printf 'Issue #1 resolution: dedupe-uniqueness is lockfile-aware (CHECK 15) — OSV line:0 findings retained and verified unique by (package,CVE); source findings unique by (file,line,cwe).\n'
exit "$fail_count"
