"""Deterministic CodeQL SARIF -> findings-layer-3-codeql.json normalizer.

Implements AAP Rule 7 dedup invariants for Layer 3:
  - Schema: 7-field {file,line,severity,cwe,description,layer,tool}
  - Dedup by (file, line, CWE) WITHIN the layer file
  - Higher severity wins on dedup; tie-break by earlier SARIF index
  - Severity map: error->critical, warning->high, note->medium, info->low
  - CWE selection: first `external/cwe/cwe-NNN` tag on the rule (canonicalized to CWE-NNN)
  - Description truncated to <=200 chars, ellipsis on truncation, whitespace normalized
  - Relative path preserved (no `file://` or absolute path prefixes)
  - Single-line minified JSON output with trailing newline
"""
import json
import sys
from pathlib import Path

SARIF_PATH = Path("results-codeql.sarif")
OUT_PATH = Path("findings-layer-3-codeql.json")

LEVEL_MAP = {"error": "critical", "warning": "high", "note": "medium", "info": "low"}
SEVERITY_ORDER = {"critical": 4, "high": 3, "medium": 2, "low": 1}

def primary_cwe(rule):
    tags = (rule.get("properties") or {}).get("tags") or []
    for t in tags:
        if isinstance(t, str) and t.startswith("external/cwe/cwe-"):
            num_str = t.split("cwe-", 1)[1]
            try:
                return f"CWE-{int(num_str)}"
            except ValueError:
                continue
    return None

def normalize_description(text):
    if not isinstance(text, str):
        return ""
    text = " ".join(text.split())
    if len(text) > 200:
        text = text[:199] + "\u2026"
    return text

def normalize_path(uri):
    if not uri:
        return ""
    if uri.startswith("file://"):
        uri = uri[7:]
    if uri.startswith("/"):
        return uri.lstrip("/")
    return uri

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

    seen = {}
    skipped = 0
    skipped_reasons = {}

    for idx, r in enumerate(results):
        rid = r.get("ruleId")
        rule = rule_by_id.get(rid, {})
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
            "layer": 3,
            "tool": "codeql",
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
        assert isinstance(f["layer"], int) and f["layer"] == 3, f"Bad layer: {f}"
        assert f["tool"] == "codeql", f"Bad tool: {f}"
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
