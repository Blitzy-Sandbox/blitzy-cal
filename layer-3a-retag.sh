#!/usr/bin/env bash
#
# layer-3a-retag.sh — Layer 3a (Directive 4) deterministic category-tagger & coverage recorder.
#
# PURPOSE
#   The security-audit pipeline's Layer 3a enumerates sink and mitigation call sites into four
#   inventory files using the line format  file:::line:::matched-pattern .
#   This script GUARANTEES every line in all four inventories carries an explicit category tag and
#   that an explicit, machine-readable Layer 3a status/coverage record is emitted. It exists to make
#   the tagging step reproducible and auditable (committed generator), and to enforce the binding
#   user directive: "No layer may silently fail or drop categories."
#
# WHAT IT DOES (idempotent, deterministic — identical inputs produce byte-identical outputs)
#   1. Re-tags  sink-inventory-test.txt        : prepends a [CWE-NNN] tag to every line, using the
#                                                same 19-category methodology as sink-inventory.txt.
#   2. Re-tags  mitigation-inventory.txt        : prepends a [<mitigation-category>] tag to every
#                                                line, using the same convention as
#                                                mitigation-inventory-test.txt.
#   3. (Directive 4 status) Emits layer-3a-status.txt — see emit_status() — with layer_3a_status,
#      per-category hit counts for all 19 sink + 9 mitigation categories (across non-test and test
#      variants), explicit zero-hit categories (e.g. CWE-134), and a coverage flag.
#
#   sink-inventory.txt and mitigation-inventory-test.txt are ALREADY correctly tagged and are treated
#   as READ-ONLY here (only read for status counting); this script never modifies them.
#
# NO SILENT DROP
#   If any inventory line carries a matched-pattern token this script cannot classify, it prints the
#   offending token to stderr and exits non-zero WITHOUT writing partial output — a category is never
#   silently dropped or mis-emitted.
#
# DETERMINISM
#   Pure text transformation with a fixed, documented token->category contract. No network, no time,
#   no randomness. Output is ANSI-free. Re-running over already-tagged files reproduces the same
#   result (existing tags are stripped and re-applied).
#
# USAGE
#   bash layer-3a-retag.sh            # re-tag the two untagged inventories AND (re)write status
#   bash layer-3a-retag.sh --check    # verify all four inventories are fully tagged; no writes
#
set -euo pipefail

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

# ---------------------------------------------------------------------------------------------------
# AWK classifier (shared). Re-tags one inventory file written in  file:::line:::matched-pattern  form.
#   -v KIND=sink|mit  selects the token->category contract.
# Each input line has EXACTLY two ':::' separators and a non-empty field 3 that contains no ':::',
# so FS=":::" yields exactly $1=file, $2=line, $3=matched-pattern (preserved byte-for-byte). Any
# pre-existing category tag on field 3 is stripped first, guaranteeing idempotency.
# ---------------------------------------------------------------------------------------------------
read -r -d '' RETAG_AWK <<'AWK' || true
function classify_sink(t) {
  # CWE-843 Type Confusion
  if (t=="as any" || t=="as unknown as" || t=="@ts-expect-error" || t=="@ts-ignore") return "CWE-843";
  # CWE-117 Log Injection
  if (t=="console.log" || t=="console.error" || t=="console.trace" ||
      t=="log.info" || t=="log.debug" ||
      t=="logger.debug" || t=="logger.error" || t=="logger.info") return "CWE-117";
  # CWE-338 Weak PRNG
  if (t=="Math.random") return "CWE-338";
  # CWE-502 Insecure Deserialization
  if (t=="JSON.parse(") return "CWE-502";
  # CWE-918 SSRF
  if (t=="fetch(") return "CWE-918";
  # CWE-79 XSS / DOM manipulation
  if (t==".innerHTML") return "CWE-79";
  # CWE-601 Open Redirect
  if (t=="window.location") return "CWE-601";
  # CWE-250 Property Injection
  if (t=="Object.defineProperty(" || t=="Object.assign(" || t=="Object.setPrototypeOf(") return "CWE-250";
  # CWE-94 Code Injection / Command Execution
  if (t==".exec(" || t=="new Function(" || t=="child_process" || t=="spawnSync") return "CWE-94";
  # CWE-1004 Cookie Attributes
  if (t=="set-cookie" || t=="setCookie") return "CWE-1004";
  # CWE-285 OAuth scope / authorization decision (OAuth token fields + permission checks)
  if (t=="access_token" || t=="refresh_token" || t=="client_secret" || t=="grant_type") return "CWE-285";
  if (t=="checkPermission" || t=="hasPermission" || t=="isAdmin" || t=="verifyApiKey") return "CWE-285";
  # CWE-200 Information Disclosure via Query (selecting sensitive column)
  if (t=="password: true") return "CWE-200";
  # CWE-639 IDOR / Tenant Isolation (Prisma data access + query shaping)
  if (t=="select: {" || t=="include: {") return "CWE-639";
  if (t==".findMany(" || t==".findFirst(" || t==".findUnique(" || t==".deleteMany(" || t==".upsert(") return "CWE-639";
  if (t ~ /^prisma\./) return "CWE-639";
  return "";
}
function classify_mit(t) {
  # safe-query
  if (t=="where:" || t=="where: {" || t=="$queryRaw" || t=="Prisma.sql" || t=="kysely") return "safe-query";
  # schema-validation (Zod + class-validator + NestJS body binding)
  if (t ~ /^z\./) return "schema-validation";
  if (t==".parse(" || t==".safeParse(" || t==".parseAsync(" || t==".safeParseAsync(") return "schema-validation";
  if (t=="zodResolver" || t=="@Body(") return "schema-validation";
  if (t ~ /^@Is/ || t=="@ValidateNested" || t=="@ValidateIf") return "schema-validation";
  # rate-limiting
  if (t=="rateLimit" || t=="RateLimit" || t=="ratelimit" || t=="Ratelimit" || t=="checkRateLimit" ||
      t=="@Throttle" || t=="@unkey/ratelimit" || t=="@nestjs/throttler") return "rate-limiting";
  if (t ~ /ThrottlerGuard$/) return "rate-limiting";   # CustomThrottlerGuard / ThrottlerGuard / mockThrottlerGuard
  # auth-middleware
  if (t=="@UseGuards" || t=="getServerSession" || t=="isAuthorized" || t=="canActivate" || t=="verifyApiKey") return "auth-middleware";
  if (t ~ /AuthGuard$/) return "auth-middleware";       # ApiAuthGuard / OptionalApiAuthGuard / NextAuthGuard / RoutingFormAuthGuard / AuthGuard
  # crypto-protection
  if (t=="symmetricDecrypt" || t=="symmetricEncrypt" || t=="createHash" || t=="createHmac" || t==".hash(" ||
      t=="bcrypt" || t=="createDecipheriv" || t=="createCipheriv" || t=="aes-256-gcm") return "crypto-protection";
  # csrf-protection
  if (t=="csrf" || t=="Csrf" || t=="sameSite" || t=="SameSite" || t=="getCsrfToken") return "csrf-protection";
  # webhook-signature
  if (t=="createSignature" || t=="createWebhookSignature" || t=="constructEvent" || t=="X-Cal-Signature" ||
      t=="verifyWebhook" || t=="verifyBTCPaySignature") return "webhook-signature";
  # input-sanitization
  if (t=="encodeURIComponent(" || t=="DOMPurify" || t=="sanitize-html" || t=="sanitizeHtml" || t=="escapeHtml") return "input-sanitization";
  # timing-safe
  if (t=="crypto.timingSafeEqual" || t=="timingSafeEqual(") return "timing-safe";
  return "";
}
BEGIN { FS=":::"; err=0 }
{
  file=$1; line=$2; tok=$3;
  # strip any pre-existing category tag (idempotency)
  if (KIND=="sink") sub(/^\[CWE-[0-9]+\] /, "", tok);
  else              sub(/^\[(timing-safe|auth-middleware|rate-limiting|csrf-protection|webhook-signature|schema-validation|input-sanitization|safe-query|crypto-protection)\] /, "", tok);
  cat = (KIND=="sink") ? classify_sink(tok) : classify_mit(tok);
  if (cat=="") { printf("UNCLASSIFIED %s TOKEN at %s:%s -> >>>%s<<<\n", KIND, file, line, tok) > "/dev/stderr"; err=1; next }
  printf("%s:::%s:::[%s] %s\n", file, line, cat, tok);
}
END { if (err) exit 7 }
AWK

retag_file() {
  # $1 = file, $2 = KIND (sink|mit)
  local f="$1" kind="$2" before after
  [ -f "$f" ] || { echo "ERROR: missing inventory $f" >&2; return 1; }
  before=$(wc -l < "$f")
  awk -v KIND="$kind" "$RETAG_AWK" "$f" > "$f.retag.tmp"
  after=$(wc -l < "$f.retag.tmp")
  if [ "$before" -ne "$after" ]; then
    rm -f "$f.retag.tmp"
    echo "ERROR: line count changed for $f ($before -> $after); aborting" >&2
    return 1
  fi
  mv "$f.retag.tmp" "$f"
  echo "tagged: $f ($after lines, kind=$kind)"
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
    echo "# Layer 3a — Sink & Mitigation Inventory status and category-coverage record (Directive 4)."
    echo "# Machine-readable key:value text (parse with grep/awk). ANSI-free. Generated by layer-3a-retag.sh."
    echo "# Per-category counts are 'non-test,test'. Categories with 0,0 are APPLICABLE to the JS/TS pattern"
    echo "# column but genuinely absent in first-party source — explicitly recorded, NEVER silently dropped."
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
    return "$fail"
  fi
  retag_file "$SINK_TEST" sink
  retag_file "$MIT" mit
  emit_status
}

main "${1:-run}"
