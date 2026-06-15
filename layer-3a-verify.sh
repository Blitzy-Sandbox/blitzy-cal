#!/usr/bin/env bash
#
# layer-3a-verify.sh — Layer 3a (Directive 4 / Directive 10) deterministic reproducibility &
#                      consistency verifier for the sink/mitigation inventories.
#
# WHY THIS EXISTS
#   The Layer 3a inventories are enumerated by deterministic grep over a fixed universe, but until now
#   there was NO committed single source of truth that pinned the universe, the routing predicate, and
#   the representative recall contract in one place. That gap allowed the sink and mitigation
#   enumerations to drift apart (the sink inventory once dropped non-6-pattern test-semantic files that
#   the mitigation inventory kept), so a fresh enumeration did not reproduce the sink inventory.
#
#   This script encodes that contract as deterministic, re-runnable checks. It does NOT modify any
#   artifact — it only reads and verifies. It is the regression guard for that class of defect.
#
# CONTRACT VERIFIED
#   * Line format file:::<int>:::[TAG] ... across all four inventories (exactly two ':::').
#   * All 19 sink CWE categories accounted for (18 with hits; CWE-134 documented zero-hit) + 9 mitigation.
#   * Test routing: the SAME predicate P (the six AAP patterns *.test.*, *.spec.*, *.e2e.*, __tests__/,
#     __mocks__/, fixtures/ generalised to this repo's hyphenated conventions: *.e2e-spec.*,
#     *-test.{ts,tsx,js,jsx,mts,cts}, /test/, /tests/, /e2e/, /mocks/, /__fixtures__/, test-setup.*)
#     governs BOTH the sink and mitigation pairs; no predicate-P path leaks into a non-test inventory;
#     no path appears in both halves of a pair.
#   * Consistency: BOTH non-test inventories EXCLUDE every predicate-P (test-semantic) path -- the sink
#     and mitigation pairs apply identical test-routing logic, so test sources (including hyphenated
#     *-test / *.e2e-spec / /test/ files) live only in the '-test.txt' variants, never in a non-test
#     inventory.
#   * Recall (the Issue-1 anchor): for every representative pattern, EVERY fresh hit over the canonical
#     git-tracked first-party universe is present in the corresponding sink inventory union (0 missed).
#     Includes the word-boundary \bfetch\( pattern that must exclude refetch(/prefetch(.
#   * Real-file references, in-range line numbers, no duplicate lines, ANSI-free output.
#   * layer-3a-status.txt per-category counts are self-consistent with the inventory files.
#
# DETERMINISM: pure read-only text/grep analysis; LC_ALL=C; no network, time, or randomness.
# USAGE: bash layer-3a-verify.sh   (prints PASS/FAIL per check; exits with the count of FAILs)

set -uo pipefail
export LC_ALL=C

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

SINK="sink-inventory.txt"
SINK_TEST="sink-inventory-test.txt"
MIT="mitigation-inventory.txt"
MIT_TEST="mitigation-inventory-test.txt"
STATUS_FILE="layer-3a-status.txt"
PROFILE="codebase-profile.txt"

EXCL='(^|/)(node_modules|\.next|dist|build|\.yarn|\.git|coverage|\.turbo)/'
# Test-routing predicate P (AAP Directive 4, generalised), an ERE over the file path. Generalises the
# six AAP patterns (*.test.*, *.spec.*, *.e2e.*, __tests__/, __mocks__/, fixtures/) to this repo's
# hyphenated test conventions. Applied IDENTICALLY to the sink and mitigation pairs (see layer-3a-retag.sh).
P='(/(__tests__|__mocks__|__fixtures__|fixtures|test|tests|e2e|mocks)/|\.(test|spec|e2e)\.|\.e2e-spec\.|-test\.(ts|tsx|js|jsx|mts|cts)$|(^|/)test-setup\.)'

SINK_CATS="CWE-601 CWE-918 CWE-117 CWE-807 CWE-338 CWE-843 CWE-862 CWE-79 CWE-134 CWE-250 CWE-912 CWE-1004 CWE-639 CWE-200 CWE-367 CWE-285 CWE-94 CWE-502 CWE-611"
MIT_CATS="timing-safe auth-middleware rate-limiting csrf-protection webhook-signature schema-validation input-sanitization safe-query crypto-protection"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
FAILS=0
pass() { printf 'PASS: %s\n' "$1"; }
fail() { printf 'FAIL: %s\n' "$1"; FAILS=$((FAILS+1)); }

# Canonical universe: git-tracked first-party JS/TS, minus exclude_dirs.
git grep -I --cached -l '' -- '*.ts' '*.tsx' '*.js' '*.jsx' 2>/dev/null | grep -vE "$EXCL" | sort -u > "$TMP/universe.txt" || true
git ls-files > "$TMP/tracked.txt"

# ---------------------------------------------------------------------------------------------------
echo "### Layer 3a verification"

# C1 — existence / non-empty
for f in "$PROFILE" "$SINK" "$SINK_TEST" "$MIT" "$MIT_TEST" "$STATUS_FILE"; do
  if [ -s "$f" ]; then pass "exists & non-empty: $f"; else fail "missing or empty: $f"; fi
done

# C2 — line format file:::<int>:::[TAG] ...
for f in "$SINK" "$SINK_TEST" "$MIT" "$MIT_TEST"; do
  bad=$(awk -F':::' 'NF!=3 || $2 !~ /^[0-9]+$/ || $3 !~ /^\[[A-Za-z0-9-]+\] / {n++} END{print n+0}' "$f")
  if [ "$bad" -eq 0 ]; then pass "line format (file:::int:::[TAG] ...) clean: $f"; else fail "$bad malformed line(s): $f"; fi
done

# C3 — sink category coverage (18 present in union; CWE-134 documented zero-hit)
{ grep -hoE '\[CWE-[0-9]+\]' "$SINK" "$SINK_TEST"; } | sort -u | tr -d '[]' > "$TMP/sink_present.txt"
present=$(wc -l < "$TMP/sink_present.txt")
if [ "$present" -eq 18 ]; then pass "sink categories present in union = 18 (of 19)"; else fail "sink categories present = $present (expected 18)"; fi
if grep -q '^sink_categories_zero_hit: CWE-134$' "$STATUS_FILE"; then pass "CWE-134 documented zero-hit in status (19th category accounted)"; else fail "CWE-134 not documented as the zero-hit category in status"; fi

# C4 — mitigation category coverage (all 9)
miss=0
for c in $MIT_CATS; do grep -q "\[$c\]" "$MIT" "$MIT_TEST" || { miss=$((miss+1)); echo "  missing mitigation cat: $c"; }; done
if [ "$miss" -eq 0 ]; then pass "all 9 mitigation categories present"; else fail "$miss mitigation category(ies) absent"; fi

# C5 — test routing: every test-variant path matches predicate P; no P path in non-test; no overlap
check_routing() {
  local nontest="$1" test="$2" label="$3"
  awk -F':::' '{print $1}' "$test"    | sort -u > "$TMP/t.txt"
  awk -F':::' '{print $1}' "$nontest" | sort -u > "$TMP/n.txt"
  local test_nonp overlap leak
  test_nonp=$(grep -vE "$P" "$TMP/t.txt" | wc -l)
  leak=$(grep -E "$P" "$TMP/n.txt" | wc -l)
  overlap=$(comm -12 "$TMP/t.txt" "$TMP/n.txt" | wc -l)
  if [ "$test_nonp" -eq 0 ] && [ "$leak" -eq 0 ] && [ "$overlap" -eq 0 ]; then
    pass "test routing exclusive & predicate-P-correct: $label (test-only-nonP=$test_nonp nontest-leak=$leak overlap=$overlap)"
  else
    fail "test routing broken: $label (test-only-nonP=$test_nonp nontest-leak=$leak overlap=$overlap)"
  fi
}
check_routing "$SINK" "$SINK_TEST" "sink pair"
check_routing "$MIT"  "$MIT_TEST"  "mitigation pair"

# C6 — CONSISTENCY: identical test-routing logic for both pairs. BOTH non-test inventories must EXCLUDE
# every predicate-P (test-semantic) path, including the hyphenated conventions (*.e2e-spec.*, *-test.*,
# *.integration-test.*, /test/, /e2e/, /__fixtures__/) that the narrow six-pattern rule alone would miss.
# This is the corrected contract: test sources belong in the '-test.txt' variants, never in a non-test
# inventory, applied identically to the sink and mitigation pairs.
TESTSEM='(\.e2e-spec\.|-test\.|\.integration-test\.|/test/|/e2e/|/__fixtures__/)'
sink_nt_p=$(awk -F':::' '{print $1}' "$SINK" | sort -u | grep -E "$P" | wc -l)
mit_nt_p=$( awk -F':::' '{print $1}' "$MIT"  | sort -u | grep -E "$P" | wc -l)
sink_nt_testsem=$(awk -F':::' '{print $1}' "$SINK" | sort -u | grep -E "$TESTSEM" | wc -l)
mit_nt_testsem=$( awk -F':::' '{print $1}' "$MIT"  | sort -u | grep -E "$TESTSEM" | wc -l)
if [ "$sink_nt_p" -eq 0 ] && [ "$mit_nt_p" -eq 0 ] && [ "$sink_nt_testsem" -eq 0 ] && [ "$mit_nt_testsem" -eq 0 ]; then
  pass "consistency: both non-test inventories exclude all predicate-P/test-semantic files (sink_P=$sink_nt_p mit_P=$mit_nt_p sink_testsem=$sink_nt_testsem mit_testsem=$mit_nt_testsem) -- identical routing"
else
  fail "consistency: a non-test inventory still contains test-semantic file(s) (sink_P=$sink_nt_p mit_P=$mit_nt_p sink_testsem=$sink_nt_testsem mit_testsem=$mit_nt_testsem); route them into the -test.txt variants"
fi

# C7 — real-file references (tracked, existing, not excluded)
awk -F':::' '{print $1}' "$SINK" "$SINK_TEST" "$MIT" "$MIT_TEST" | sed 's|^\./||' | sort -u > "$TMP/refs.txt"
badref=0
in_excl=$(grep -E "$EXCL" "$TMP/refs.txt" | wc -l)
not_tracked=$(comm -23 "$TMP/refs.txt" <(sort -u "$TMP/tracked.txt") | wc -l)
while IFS= read -r p; do [ -f "$p" ] || badref=$((badref+1)); done < "$TMP/refs.txt"
if [ "$badref" -eq 0 ] && [ "$in_excl" -eq 0 ] && [ "$not_tracked" -eq 0 ]; then
  pass "real-file references (exist=$( wc -l < "$TMP/refs.txt") tracked, 0 missing, 0 in exclude_dirs)"
else
  fail "real-file refs: missing=$badref in_exclude=$in_excl untracked=$not_tracked"
fi

# C8 — ANSI-free
anyansi=0
for f in "$PROFILE" "$SINK" "$SINK_TEST" "$MIT" "$MIT_TEST" "$STATUS_FILE"; do
  c=$(grep -cP '\x1b' "$f" 2>/dev/null || true); c=${c:-0}; [ "$c" -eq 0 ] || { anyansi=$((anyansi+c)); echo "  ESC bytes in $f: $c"; }
done
if [ "$anyansi" -eq 0 ]; then pass "no ANSI escape sequences in any artifact"; else fail "$anyansi ANSI escape sequence(s) found"; fi

# C9 — line-number validity (cited line <= file length), efficient single awk + python check
python3 - "$SINK" "$SINK_TEST" "$MIT" "$MIT_TEST" <<'PY' > "$TMP/oob.txt"
import sys
maxline={}
for inv in sys.argv[1:]:
    for ln in open(inv,encoding="utf-8",errors="replace"):
        p=ln.split(":::")
        if len(p)!=3: continue
        f=p[0]; 
        try: n=int(p[1])
        except: continue
        if n>maxline.get(f,0): maxline[f]=n
oob=0
for f,n in maxline.items():
    real=f[2:] if f.startswith("./") else f
    try:
        with open(real,encoding="utf-8",errors="replace") as fh:
            cnt=sum(1 for _ in fh)
    except Exception:
        oob+=1; continue
    if n>cnt: oob+=1
print(oob)
PY
oob=$(cat "$TMP/oob.txt")
if [ "$oob" -eq 0 ]; then pass "all cited line numbers within file bounds"; else fail "$oob cited line number(s) out of range"; fi

# C10 — no duplicate lines within any inventory
for f in "$SINK" "$SINK_TEST" "$MIT" "$MIT_TEST"; do
  t=$(wc -l < "$f"); u=$(sort -u "$f" | wc -l)
  if [ "$t" -eq "$u" ]; then pass "no duplicate lines: $f ($t)"; else fail "$((t-u)) duplicate line(s): $f"; fi
done

# C11 — RECALL on representative patterns (0 missed). label|mode(F/E)|pattern|CWE
recall() {
  local label="$1" mode="$2" pat="$3" cwe="$4"
  if [ "$mode" = "E" ]; then
    git grep -nE "$pat" -- '*.ts' '*.tsx' '*.js' '*.jsx' 2>/dev/null
  else
    git grep -nF "$pat" -- '*.ts' '*.tsx' '*.js' '*.jsx' 2>/dev/null
  fi | grep -vE "$EXCL" | awk -F: '{print "./"$1":::"$2}' | sort -u > "$TMP/fresh.txt"
  { grep "\[$cwe\]" "$SINK"; grep "\[$cwe\]" "$SINK_TEST"; } | awk -F':::' '{print $1":::"$2}' | sort -u > "$TMP/inv.txt"
  local fresh missed
  fresh=$(wc -l < "$TMP/fresh.txt")
  missed=$(comm -23 "$TMP/fresh.txt" "$TMP/inv.txt" | wc -l)
  if [ "$missed" -eq 0 ]; then pass "recall $label -> $cwe: fresh=$fresh, 0 missed"; else fail "recall $label -> $cwe: $missed of $fresh fresh hits MISSING from inventory"; fi
}
recall "Math.random("            F 'Math.random('            CWE-338
recall "prisma."                 F 'prisma.'                 CWE-639
recall "dangerouslySetInnerHTML" F 'dangerouslySetInnerHTML' CWE-79
recall "console.log"             F 'console.log'             CWE-117
recall "redirect("               F 'redirect('               CWE-601
recall "\\bfetch\\b("            E '\bfetch\('               CWE-918

# C11b — fetch word-boundary precision: inventory CWE-918 must not contain refetch(/prefetch( hits
refetch=$({ grep "\[CWE-918\]" "$SINK"; grep "\[CWE-918\]" "$SINK_TEST"; } | grep -E '(refetch\(|prefetch\()' | wc -l)
if [ "$refetch" -eq 0 ]; then pass "CWE-918 excludes refetch(/prefetch( (word-boundary precision)"; else fail "$refetch refetch/prefetch hit(s) wrongly tagged CWE-918"; fi

# C12 — status self-consistency: per-category non-test count == grep -c in sink-inventory.txt; totals match
mism=0
for c in $SINK_CATS; do
  s=$(grep "^sink_count_${c}:" "$STATUS_FILE" | awk '{print $2}' | cut -d, -f1)
  g=$(grep -c "\[$c\]" "$SINK")
  [ "${s:-X}" = "$g" ] || { mism=$((mism+1)); echo "  status mismatch $c: status_nt=$s grep=$g"; }
done
sl=$(grep '^sink_inventory_nontest_lines:' "$STATUS_FILE" | awk '{print $2}')
sa=$(wc -l < "$SINK")
stl=$(grep '^sink_inventory_test_lines:' "$STATUS_FILE" | awk '{print $2}')
sta=$(wc -l < "$SINK_TEST")
[ "$sl" = "$sa" ] || { mism=$((mism+1)); echo "  status sink nontest lines $sl != $sa"; }
[ "$stl" = "$sta" ] || { mism=$((mism+1)); echo "  status sink test lines $stl != $sta"; }
if [ "$mism" -eq 0 ]; then pass "layer-3a-status.txt counts self-consistent with inventories"; else fail "$mism status/inventory count mismatch(es)"; fi

echo "### ${FAILS} failure(s)"
exit "$FAILS"
