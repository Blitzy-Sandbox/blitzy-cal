"""Deterministic Semgrep SARIF -> findings-layer-2-semgrep.json normalizer.

Implements AAP Rule 3 and Rule 7:
  - Severity map: error -> critical, warning -> high, note -> medium, info -> low
  - CWE: first `CWE-NNN` token from rule.properties.tags
  - Description: collapse whitespace, truncate to <=200 chars with `\u2026` ellipsis on truncation
  - file: strip absolute source-root prefix to produce path relative to /tmp/.../main_0d6e40/
  - Dedup within layer by (file, line, CWE) keeping higher severity; tie-break by SARIF index
  - Single-line minified JSON output with trailing newline
"""
import json
import re
import sys
from pathlib import Path

SARIF_PATH = Path("results-semgrep.sarif")
OUT_PATH = Path("findings-layer-2-semgrep.json")
SOURCE_ROOT_PREFIX = "/tmp/blitzy/blitzy-cal/main_0d6e40/"

LEVEL_MAP = {"error": "critical", "warning": "high", "note": "medium", "info": "low"}
SEVERITY_ORDER = {"critical": 4, "high": 3, "medium": 2, "low": 1}
CWE_RE = re.compile(r"^CWE-(\d+)(?::|$|\s)")

def primary_cwe(rule):
    """First CWE-NNN token in rule.properties.tags, canonicalized to CWE-NNN."""
    tags = (rule.get("properties") or {}).get("tags") or []
    for t in tags:
        if not isinstance(t, str):
            continue
        m = CWE_RE.match(t.strip())
        if m:
            return f"CWE-{int(m.group(1))}"
    return None

def normalize_description(text):
    if not isinstance(text, str):
        return ""
    text = " ".join(text.split())  # collapse whitespace
    if len(text) > 200:
        text = text[:199] + "\u2026"
    return text

def normalize_path(uri):
    if not uri:
        return ""
    if uri.startswith("file://"):
        uri = uri[7:]
    if uri.startswith(SOURCE_ROOT_PREFIX):
        uri = uri[len(SOURCE_ROOT_PREFIX):]
    return uri.lstrip("/")

def main():
    sarif = json.loads(SARIF_PATH.read_text())
    runs = sarif.get("runs") or []
    if not runs:
        print("No runs in SARIF", file=sys.stderr)
        return 1
    run = runs[0]
    results = run.get("results") or []
    rules = (run.get("tool") or {}).get("driver", {}).get("rules") or []
    rule_by_id = {r.get("id"): r for r in rules}
    # SARIF results often use ruleIndex; build that lookup too.
    rule_by_idx = {i: r for i, r in enumerate(rules)}

    seen = {}
    skipped = 0
    skipped_reasons = {}

    for idx, r in enumerate(results):
        rid = r.get("ruleId")
        rule_idx = r.get("ruleIndex")
        rule = rule_by_id.get(rid) or rule_by_idx.get(rule_idx) or {}
        level = (rule.get("defaultConfiguration") or {}).get("level")
        severity = LEVEL_MAP.get(level, "medium")

        locs = r.get("locations") or []
        if not locs:
            skipped += 1
            skipped_reasons[f"{rid}: no locations"] = skipped_reasons.get(f"{rid}: no locations", 0) + 1
            continue
        physloc = locs[0].get("physicalLocation") or {}
        artloc = physloc.get("artifactLocation") or {}
        region = physloc.get("region") or {}
        file = normalize_path(artloc.get("uri"))
        line = region.get("startLine", 0)

        cwe = primary_cwe(rule)
        if cwe is None:
            skipped += 1
            skipped_reasons[f"{rid}: no CWE"] = skipped_reasons.get(f"{rid}: no CWE", 0) + 1
            continue

        msg = ((r.get("message") or {}).get("text")) or ""
        description = normalize_description(msg)

        finding = {
            "file": file,
            "line": int(line),
            "severity": severity,
            "cwe": cwe,
            "description": description,
            "layer": 2,
            "tool": "semgrep",
        }

        key = (file, int(line), cwe)
        if key in seen:
            existing_idx, existing = seen[key]
            new_sev = SEVERITY_ORDER[severity]
            old_sev = SEVERITY_ORDER[existing["severity"]]
            if new_sev > old_sev:
                seen[key] = (idx, finding)
        else:
            seen[key] = (idx, finding)

    # Sort by (file, line, cwe) for deterministic output
    findings = sorted(
        (v[1] for _, v in seen.items()),
        key=lambda f: (f["file"], f["line"], f["cwe"]),
    )

    print(f"SARIF results: {len(results)}")
    print(f"Skipped: {skipped} ({skipped_reasons})")
    print(f"Findings after dedup: {len(findings)}")

    # Verify no duplicates
    keys = [(f["file"], f["line"], f["cwe"]) for f in findings]
    assert len(keys) == len(set(keys)), "Duplicates remain!"

    # Verify schema
    required = {"file","line","severity","cwe","description","layer","tool"}
    for f in findings:
        assert set(f.keys()) == required, f"Schema mismatch: {set(f.keys()) ^ required}"
        assert f["severity"] in {"critical","high","medium","low"}, f"Bad severity: {f}"
        assert f["cwe"].startswith("CWE-"), f"Bad CWE: {f}"
        assert isinstance(f["line"], int), f"Line not int: {f}"
        assert isinstance(f["layer"], int) and f["layer"] == 2, f"Bad layer: {f}"
        assert f["tool"] == "semgrep", f"Bad tool: {f}"
        assert len(f["description"]) <= 200, f"Description too long: {len(f['description'])}"
        assert not f["file"].startswith("/"), f"Absolute path: {f['file']}"
        assert not f["file"].startswith("file://"), f"file:// scheme: {f['file']}"

    OUT_PATH.write_text(
        json.dumps(findings, separators=(",", ":"), ensure_ascii=False) + "\n"
    )
    print(f"Wrote {OUT_PATH}")
    return 0

if __name__ == "__main__":
    sys.exit(main())
