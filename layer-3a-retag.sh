#!/usr/bin/env bash
#
# layer-3a-retag.sh — Layer 3a (Directive 4) deterministic test-routing & coverage recorder.
#
# PURPOSE
#   The security-audit pipeline's Layer 3a enumerates sink and mitigation call sites into four
#   inventory files using the line format  file:::line:::[TAG] matched-pattern .
#   This script GUARANTEES that every test/spec/e2e/fixture/mock source line lives in the
#   ".*-test.txt" variant of its pair (NOT in the non-test inventory), that the SAME routing
#   predicate governs BOTH the sink and the mitigation pair, and that an explicit, machine-readable
#   Layer 3a status/coverage record is emitted. It exists to make the routing step reproducible and
#   auditable (committed generator), and to enforce the binding user directive:
#   "No layer may silently fail or drop categories."
#
# WHAT IT DOES (idempotent, deterministic — identical inputs produce byte-identical outputs)
#   1. Routes the SINK pair        : moves every test-path line out of sink-inventory.txt into
#                                    sink-inventory-test.txt (and keeps every non-test line in
#                                    sink-inventory.txt), preserving each line BYTE-FOR-BYTE.
#   2. Routes the MITIGATION pair   : same operation for mitigation-inventory.txt /
#                                    mitigation-inventory-test.txt.
#   3. (Directive 4 status) Emits layer-3a-status.txt — see emit_status() — with layer_3a_status,
#      per-category hit counts for all 19 sink + 9 mitigation categories (across non-test and test
#      variants), explicit zero-hit categories (e.g. CWE-134), and a coverage flag.
#
# TEST-ROUTING PREDICATE (P)
#   A path is a TEST path iff it matches predicate P (an ERE over the file path). P generalises the
#   six-pattern AAP rule (*.test.*, *.spec.*, *.e2e.*, __tests__/, __mocks__/, fixtures/) to the
#   hyphenated conventions actually used in this repo: *.e2e-spec.*, *-test.{ts,tsx,js,jsx,mts,cts},
#   /test/ , /tests/ , /e2e/ , /mocks/ , /__fixtures__/ and test-setup.* . P is applied IDENTICALLY
#   to the sink pair and the mitigation pair so the two enumerations cannot drift apart.
#
# VERBATIM PRESERVATION (no re-tagging)
#   Lines are moved verbatim ($0 is never split or reconstructed), so every existing [CWE-NNN] /
#   [mitigation-category] tag is preserved exactly. This script does NOT re-classify tokens: the
#   inventories were tagged by the Layer 3a enumerator and that tagging is authoritative here.
#
# NO SILENT DROP / DETERMINISM
#   Routing is line-conserving: the script verifies (moved-out + kept) == original total for each
#   pair and aborts WITHOUT writing if conservation fails, so no line is ever silently dropped.
#   It also re-asserts that zero test-path lines remain in either non-test inventory. Pure text
#   transformation, no network/time/randomness, ANSI-free, idempotent (re-running is a no-op).
#
# USAGE
#   bash layer-3a-retag.sh            # route both pairs AND (re)write status
#   bash layer-3a-retag.sh --check    # verify routing is correct & inventories tagged; no writes
#
set -euo pipefail
export LC_ALL=C

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

SINK="sink-inventory.txt"
SINK_TEST="sink-inventory-test.txt"
MIT="mitigation-inventory.txt"
MIT_TEST="mitigation-inventory-test.txt"
STATUS_FILE="layer-3a-status.txt"

# The 19 sink CWE categories and 9 mitigation categories (canonical order; used for status coverage).
SINK_CATS="CWE-601 CWE-918 CWE-117 CWE-807 CWE-338 CWE-843 CWE-862 CWE-79 CWE-134 CWE-250 CWE-912 CWE-1004 CWE-639 CWE-200 CWE-367 CWE-285 CWE-94 CWE-502 CWE-611"
MIT_CATS="timing-safe auth-middleware rate-limiting csrf-protection webhook-signature schema-validation input-sanitization safe-query crypto-protection"

# Test-routing predicate P (ERE over the file path = substring before the first ':::').
# Generalises the six-pattern AAP rule to this repo's hyphenated test conventions. Applied
# IDENTICALLY to the sink and mitigation pairs.
P_ERE='(/(__tests__|__mocks__|__fixtures__|fixtures|test|tests|e2e|mocks)/|\.(test|spec|e2e)\.|\.e2e-spec\.|-test\.(ts|tsx|js|jsx|mts|cts)$|(^|/)test-setup\.)'

# ---------------------------------------------------------------------------------------------------
# route_pair NONTEST TEST
#   Repartition a (non-test, test) inventory pair by predicate P, preserving every line verbatim.
#   Inputs are read TEST-first then NONTEST, so the existing test inventory stays a prefix of the
#   result and newly-moved lines are appended in their original relative order (stable, idempotent).
#   The file field is the substring before the first ':::'; $0 is printed unchanged so tags are kept.
# ---------------------------------------------------------------------------------------------------
route_pair() {
  local nontest="$1" test="$2"
  [ -f "$nontest" ] || { echo "ERROR: missing inventory $nontest" >&2; return 1; }
  [ -f "$test" ]    || { echo "ERROR: missing inventory $test" >&2; return 1; }
  local before_nt before_t total
  before_nt=$(wc -l < "$nontest"); before_t=$(wc -l < "$test"); total=$((before_nt + before_t))

  awk -v P="$P_ERE" -v NT="$nontest.route.tmp" -v TT="$test.route.tmp" '
    BEGIN { printf "" > NT; printf "" > TT }   # guarantee both partitions exist even if empty
    {
      pos = index($0, ":::");
      f   = (pos > 0) ? substr($0, 1, pos - 1) : $0;
      if (f ~ P) print $0 > TT; else print $0 > NT;
    }
  ' "$test" "$nontest"

  local after_nt after_t
  after_nt=$(wc -l < "$nontest.route.tmp"); after_t=$(wc -l < "$test.route.tmp")
  if [ $((after_nt + after_t)) -ne "$total" ]; then
    rm -f "$nontest.route.tmp" "$test.route.tmp"
    echo "ERROR: line conservation failed for ($nontest,$test): $total -> $((after_nt + after_t)); aborting" >&2
    return 1
  fi
  # Re-assert: zero test-path (predicate-P) lines may remain in the non-test partition.
  local leak
  leak=$(awk -v P="$P_ERE" '{pos=index($0,":::"); f=(pos>0)?substr($0,1,pos-1):$0; if (f ~ P) n++} END{print n+0}' "$nontest.route.tmp")
  if [ "$leak" -ne 0 ]; then
    rm -f "$nontest.route.tmp" "$test.route.tmp"
    echo "ERROR: $leak test-path line(s) leaked into non-test inventory $nontest; aborting" >&2
    return 1
  fi
  mv "$nontest.route.tmp" "$nontest"
  mv "$test.route.tmp" "$test"
  echo "routed: $nontest ($before_nt -> $after_nt), $test ($before_t -> $after_t); moved_to_test=$((before_nt - after_nt))"
}

# count tagged lines whose field-3 begins with the exact category tag "[<cat>]" (0 if file/cat absent).
# The closing ']' in the needle makes the match exact, so "[CWE-94]" never matches "[CWE-941]".
count_cat() { awk -F':::' -v c="[$1]" 'index($3, c)==1 {n++} END{print n+0}' "$2" 2>/dev/null || echo 0; }

# Emit the machine-readable Layer 3a status & per-category coverage record (Directive 4 status).
# This is a SEPARATE artifact (key:value text, same style as codebase-profile.txt) so it never breaks
# the file:::line:::matched-pattern parsing of the inventories. It makes a true zero-hit category
# (e.g. CWE-134) explicitly distinguishable from a silently dropped category.
emit_status() {
  local cat nt tt sink_hits=0 sink_zero="" mit_hits=0 mit_zero=""
  local sink_nt_total sink_tt_total mit_nt_total mit_tt_total
  sink_nt_total=$( [ -f "$SINK" ] && wc -l < "$SINK" || echo 0 )
  sink_tt_total=$( [ -f "$SINK_TEST" ] && wc -l < "$SINK_TEST" || echo 0 )
  mit_nt_total=$( [ -f "$MIT" ] && wc -l < "$MIT" || echo 0 )
  mit_tt_total=$( [ -f "$MIT_TEST" ] && wc -l < "$MIT_TEST" || echo 0 )

  # Pre-compute per-category counts and coverage tallies.
  for cat in $SINK_CATS; do
    nt=$(count_cat "$cat" "$SINK"); tt=$(count_cat "$cat" "$SINK_TEST")
    if [ $((nt + tt)) -gt 0 ]; then sink_hits=$((sink_hits + 1)); else sink_zero="${sink_zero:+$sink_zero,}$cat"; fi
  done
  for cat in $MIT_CATS; do
    nt=$(count_cat "$cat" "$MIT"); tt=$(count_cat "$cat" "$MIT_TEST")
    if [ $((nt + tt)) -gt 0 ]; then mit_hits=$((mit_hits + 1)); else mit_zero="${mit_zero:+$mit_zero,}$cat"; fi
  done

  {
    echo "# Layer 3a -- Sink & Mitigation Inventory status and category-coverage record (Directive 4)."
    echo "# Machine-readable key:value text (parse with grep/awk). ANSI-free. Generated by layer-3a-retag.sh."
    echo "# Per-category counts are 'non-test,test'. Categories with 0,0 are APPLICABLE to the JS/TS pattern"
    echo "# column but genuinely absent in first-party source -- explicitly recorded, NEVER silently dropped."
    echo "# Test-path lines (predicate P: *.test.*, *.spec.*, *.e2e.*, *.e2e-spec.*, *-test.{ts,tsx,js,jsx,mts,cts},"
    echo "# __tests__/, __mocks__/, __fixtures__/, fixtures/, test/, tests/, e2e/, mocks/, test-setup.*) are routed"
    echo "# into the '-test.txt' variant of each pair; the SAME predicate governs the sink and mitigation pairs."
    echo "layer_3a_status: OK"
    echo "coverage: complete"
    echo "primary_language: typescript"
    echo "sink_pattern_column: js/ts"
    echo "mitigation_pattern_column: js/ts"
    echo "sink_inventory_nontest_lines: ${sink_nt_total}"
    echo "sink_inventory_test_lines: ${sink_tt_total}"
    echo "mitigation_inventory_nontest_lines: ${mit_nt_total}"
    echo "mitigation_inventory_test_lines: ${mit_tt_total}"
    echo "sink_categories_total: 19"
    echo "sink_categories_with_hits: ${sink_hits}"
    echo "sink_categories_zero_hit: ${sink_zero:-none}"
    echo "mitigation_categories_total: 9"
    echo "mitigation_categories_with_hits: ${mit_hits}"
    echo "mitigation_categories_zero_hit: ${mit_zero:-none}"
    echo "# --- Cross-category analog mappings (sink-tag <-> Layer 3b taint CWE); see layer-3b-status.txt ---"
    echo "# sendPayload.ts:349 is tagged [CWE-639] (Prisma/data-access sink token) but the Layer 3b taint"
    echo "#   finding for that line is CWE-347 (Improper Verification of Cryptographic Signature). CWE-347 is"
    echo "#   not one of the 19 sink categories, so the sink line is retained under its data-access tag and the"
    echo "#   CWE-347 classification is recorded only at the taint layer."
    echo "# bookings.service.ts:1067 is tagged [CWE-117] (log-interpolation sink) and represents the CWE-134"
    echo "#   (format-string) taint analog: CWE-134 is structurally inapplicable to TypeScript (no printf-family"
    echo "#   format string), so it is a documented zero-hit sink category represented via the CWE-117 sink."
    echo "analog_cwe347_sink_line: ./packages/features/webhooks/lib/sendPayload.ts:349 (sink tag CWE-639)"
    echo "analog_cwe134_sink_line: ./apps/api/v2/src/ee/bookings/2024-08-13/services/bookings.service.ts:1067 (sink tag CWE-117)"
    echo "# --- Per-sink-category hit counts (CWE: non-test,test) ---"
    for cat in $SINK_CATS; do
      nt=$(count_cat "$cat" "$SINK"); tt=$(count_cat "$cat" "$SINK_TEST")
      echo "sink_count_${cat}: ${nt},${tt}"
    done
    echo "# --- Per-mitigation-category hit counts (category: non-test,test) ---"
    for cat in $MIT_CATS; do
      nt=$(count_cat "$cat" "$MIT"); tt=$(count_cat "$cat" "$MIT_TEST")
      echo "mitigation_count_${cat}: ${nt},${tt}"
    done
  } > "$STATUS_FILE"
  echo "wrote: $STATUS_FILE (sink_categories_with_hits=${sink_hits}/19 zero_hit=${sink_zero:-none}; mitigation_categories_with_hits=${mit_hits}/9 zero_hit=${mit_zero:-none})"
}

main() {
  local mode="${1:-run}"
  if [ "$mode" = "--check" ]; then
    local fail=0 f
    for f in "$SINK" "$SINK_TEST" "$MIT" "$MIT_TEST"; do
      [ -f "$f" ] || { echo "FAIL: missing $f"; fail=1; continue; }
      local untagged
      untagged=$(awk -F':::' '$3 !~ /^\[[A-Za-z0-9-]+\] /{n++} END{print n+0}' "$f")
      if [ "$untagged" -ne 0 ]; then echo "FAIL: $f has $untagged untagged line(s)"; fail=1; else echo "OK: $f fully tagged"; fi
    done
    # routing correctness: zero predicate-P lines may remain in either non-test inventory.
    local sl ml
    sl=$(awk -v P="$P_ERE" '{pos=index($0,":::"); f=(pos>0)?substr($0,1,pos-1):$0; if (f ~ P) n++} END{print n+0}' "$SINK")
    ml=$(awk -v P="$P_ERE" '{pos=index($0,":::"); f=(pos>0)?substr($0,1,pos-1):$0; if (f ~ P) n++} END{print n+0}' "$MIT")
    if [ "$sl" -eq 0 ]; then echo "OK: no test-path lines in $SINK"; else echo "FAIL: $sl test-path line(s) in $SINK"; fail=1; fi
    if [ "$ml" -eq 0 ]; then echo "OK: no test-path lines in $MIT"; else echo "FAIL: $ml test-path line(s) in $MIT"; fail=1; fi
    return "$fail"
  fi
  route_pair "$SINK" "$SINK_TEST"
  route_pair "$MIT"  "$MIT_TEST"
  emit_status
}

main "${1:-run}"
