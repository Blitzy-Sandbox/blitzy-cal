#!/usr/bin/env python3
# Normalize Semgrep SARIF 2.1.0 output into findings-config-b.json (Config B).
# Rationale, alternatives, and risks for every non-trivial decision live in
# decision-log.md (the Explainability Rule's single source of truth).
# Imports are restricted to the Python 3 standard library.

import argparse
import json
import os
import re
import sys

SEVERITY_MAP = {
    "error": "critical",
    "warning": "high",
    "note": "medium",
    "info": "low",
}
SEVERITY_DEFAULT = "low"
DESCRIPTION_MAX_CHARS = 200
CWE_TOKEN_RE = re.compile(r"CWE-(\d+)", re.IGNORECASE)
CWE_FALLBACK = "CWE-693"

CWE_INFERENCE_TABLE = [
    (re.compile(r"sql[-_.]?injection|sequelize[-_.]?injection|sql.*injection", re.IGNORECASE), "CWE-89"),
    (re.compile(r"\bxss\b|cross[-_.]?site[-_.]?scripting|dom[-_.]?based[-_.]?xss", re.IGNORECASE), "CWE-79"),
    (re.compile(r"command[-_.]?injection|os[-_.]?command|spawn[-_.]?process", re.IGNORECASE), "CWE-78"),
    (re.compile(r"path[-_.]?traversal|directory[-_.]?traversal|zip[-_.]?slip", re.IGNORECASE), "CWE-22"),
    (re.compile(r"\bssrf\b", re.IGNORECASE), "CWE-918"),
    (re.compile(r"\bxxe\b|xml[-_.]?external[-_.]?entities", re.IGNORECASE), "CWE-611"),
    (re.compile(r"open[-_.]?redirect", re.IGNORECASE), "CWE-601"),
    (re.compile(r"weak[-_.]?crypto|weak[-_.]?cipher|insecure[-_.]?cipher|\bmd5\b|\bsha1\b", re.IGNORECASE), "CWE-327"),
    (re.compile(r"weak[-_.]?rsa|weak[-_.]?key", re.IGNORECASE), "CWE-326"),
    (re.compile(r"hardcoded[-_.]?secret|hardcoded[-_.]?jwt|hardcoded[-_.]?token|hardcoded[-_.]?key", re.IGNORECASE), "CWE-798"),
    (re.compile(r"hardcoded[-_.]?password", re.IGNORECASE), "CWE-259"),
    (re.compile(r"insecure[-_.]?randomness|weak[-_.]?random", re.IGNORECASE), "CWE-338"),
    (re.compile(r"prototype[-_.]?pollution", re.IGNORECASE), "CWE-1321"),
    (re.compile(r"regex[-_.]?injection|\bredos\b", re.IGNORECASE), "CWE-1333"),
    (re.compile(r"unsafe[-_.]?deserialization|deserialization", re.IGNORECASE), "CWE-502"),
    (re.compile(r"\beval\b|dynamic[-_.]?code|code[-_.]?injection", re.IGNORECASE), "CWE-94"),
    (re.compile(r"log[-_.]?injection", re.IGNORECASE), "CWE-117"),
    (re.compile(r"missing[-_.]?auth|improper[-_.]?auth", re.IGNORECASE), "CWE-287"),
    (re.compile(r"missing[-_.]?authz|broken[-_.]?access[-_.]?control", re.IGNORECASE), "CWE-285"),
    (re.compile(r"\bcsrf\b", re.IGNORECASE), "CWE-352"),
]


def fail(message: str) -> None:
    print(f"normalize-sarif: error: {message}", file=sys.stderr)
    sys.exit(2)


def load_sarif(path: str) -> dict:
    if not os.path.exists(path):
        fail(f"SARIF input not found: {path}")
    try:
        with open(path, "r", encoding="utf-8") as fh:
            data = json.load(fh)
    except json.JSONDecodeError as exc:
        fail(f"SARIF input is not valid JSON: {exc}")
    runs = data.get("runs")
    if not isinstance(runs, list):
        fail("SARIF input has no 'runs' array")
    return data


def extract_cwe_from_properties(rule: dict) -> str | None:
    if not isinstance(rule, dict):
        return None
    properties = rule.get("properties") or {}

    cwe_field = properties.get("cwe")
    if isinstance(cwe_field, str):
        match = CWE_TOKEN_RE.search(cwe_field)
        if match:
            return f"CWE-{match.group(1)}"
    elif isinstance(cwe_field, list):
        for item in cwe_field:
            if isinstance(item, str):
                match = CWE_TOKEN_RE.search(item)
                if match:
                    return f"CWE-{match.group(1)}"

    tags = properties.get("tags")
    if isinstance(tags, list):
        for tag in tags:
            if isinstance(tag, str):
                match = CWE_TOKEN_RE.search(tag)
                if match:
                    return f"CWE-{match.group(1)}"
    return None


def infer_cwe(rule_id: str, rule_text: str) -> str:
    haystack = f"{rule_id}\n{rule_text}"
    for pattern, cwe in CWE_INFERENCE_TABLE:
        if pattern.search(haystack):
            return cwe
    return CWE_FALLBACK


def resolve_cwe(rule: dict) -> str:
    extracted = extract_cwe_from_properties(rule)
    if extracted:
        return extracted
    rule_id = rule.get("id", "") if isinstance(rule, dict) else ""
    short = ""
    full = ""
    if isinstance(rule, dict):
        short_obj = rule.get("shortDescription") or {}
        full_obj = rule.get("fullDescription") or {}
        if isinstance(short_obj, dict):
            short = short_obj.get("text", "") or ""
        if isinstance(full_obj, dict):
            full = full_obj.get("text", "") or ""
    return infer_cwe(rule_id, f"{short}\n{full}")


def resolve_level(result: dict, rule: dict) -> str:
    raw_level = result.get("level") if isinstance(result, dict) else None
    if isinstance(raw_level, str) and raw_level:
        return SEVERITY_MAP.get(raw_level, SEVERITY_DEFAULT)
    if isinstance(rule, dict):
        default_cfg = rule.get("defaultConfiguration") or {}
        if isinstance(default_cfg, dict):
            rule_level = default_cfg.get("level")
            if isinstance(rule_level, str) and rule_level:
                return SEVERITY_MAP.get(rule_level, SEVERITY_DEFAULT)
    return SEVERITY_DEFAULT


def relative_uri(uri: str, repo_root: str) -> str:
    if not isinstance(uri, str):
        fail(f"location URI must be a string, got: {type(uri).__name__}")
    candidate = uri
    if candidate.startswith("file://"):
        candidate = candidate[len("file://"):]
    if repo_root:
        normalized_root = repo_root.rstrip("/") + "/"
        if candidate.startswith(normalized_root):
            candidate = candidate[len(normalized_root):]
        elif candidate == repo_root.rstrip("/"):
            candidate = ""
    if candidate.startswith("./"):
        candidate = candidate[2:]
    return candidate


def truncate_description(text: str) -> str:
    if not isinstance(text, str):
        return ""
    return text[:DESCRIPTION_MAX_CHARS]


def get_first_physical_location(result: dict) -> tuple[str, int]:
    locations = result.get("locations") if isinstance(result, dict) else None
    if not isinstance(locations, list) or not locations:
        fail(f"result has no 'locations' array: ruleId={result.get('ruleId')!r}")
    first = locations[0]
    if not isinstance(first, dict):
        fail(f"locations[0] is not an object: ruleId={result.get('ruleId')!r}")
    physical = first.get("physicalLocation")
    if not isinstance(physical, dict):
        fail(f"locations[0].physicalLocation missing: ruleId={result.get('ruleId')!r}")
    artifact = physical.get("artifactLocation") or {}
    region = physical.get("region") or {}
    uri = artifact.get("uri")
    start_line = region.get("startLine")
    if uri is None:
        fail(f"physicalLocation.artifactLocation.uri missing: ruleId={result.get('ruleId')!r}")
    if start_line is None:
        fail(f"physicalLocation.region.startLine missing: ruleId={result.get('ruleId')!r}")
    try:
        line_int = int(start_line)
    except (TypeError, ValueError):
        fail(f"startLine is not an integer: {start_line!r}")
    return uri, line_int


def normalize(sarif: dict, repo_root: str) -> list[dict]:
    findings: list[dict] = []
    runs = sarif.get("runs", [])
    for run in runs:
        if not isinstance(run, dict):
            continue
        driver = (run.get("tool") or {}).get("driver") or {}
        rules_list = driver.get("rules") or []
        rules_by_id: dict[str, dict] = {}
        if isinstance(rules_list, list):
            for r in rules_list:
                if isinstance(r, dict) and isinstance(r.get("id"), str):
                    rules_by_id[r["id"]] = r
        results = run.get("results") or []
        if not isinstance(results, list):
            continue
        for result in results:
            if not isinstance(result, dict):
                continue
            rule_id = result.get("ruleId", "") or ""
            rule = rules_by_id.get(rule_id, {})
            uri, line = get_first_physical_location(result)
            file_path = relative_uri(uri, repo_root)
            severity = resolve_level(result, rule)
            cwe = resolve_cwe(rule)
            message_obj = result.get("message") or {}
            message_text = message_obj.get("text", "") if isinstance(message_obj, dict) else ""
            description = truncate_description(message_text)
            findings.append({
                "file": file_path,
                "line": line,
                "severity": severity,
                "cwe": cwe,
                "description": description,
            })
    return findings


def write_minified(findings: list[dict], output_path: str) -> None:
    serialized = json.dumps(findings, separators=(",", ":"), ensure_ascii=False)
    with open(output_path, "w", encoding="utf-8", newline="") as fh:
        fh.write(serialized)
        fh.write("\n")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Normalize Semgrep SARIF output to findings-config-b.json (Config B)."
    )
    parser.add_argument("--sarif", default="results-semgrep.sarif",
                        help="Path to the SARIF input file (default: results-semgrep.sarif).")
    parser.add_argument("--output", default="findings-config-b.json",
                        help="Path to the normalized JSON output (default: findings-config-b.json).")
    parser.add_argument("--repo-root", default=os.getcwd(),
                        help="Absolute repository root to strip from artifactLocation.uri values (default: cwd).")
    args = parser.parse_args(argv)

    sarif = load_sarif(args.sarif)
    findings = normalize(sarif, args.repo_root)
    write_minified(findings, args.output)
    print(f"normalize-sarif: wrote {len(findings)} finding(s) to {args.output}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
