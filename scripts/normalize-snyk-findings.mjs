#!/usr/bin/env node
// Normalize Snyk scan outputs (Snyk Code SARIF + Snyk Open Source JSON) into a
// single-line minified JSON array conforming to the Config H 5-field schema.
// Algorithm specification: AAP §0.5.4; field schema: AAP §0.1.1.
// "Why" rationale lives in decision-log.md per the Explainability rule (AAP §0.7.1.1).

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";

const PREFIX_CODE = "[snyk-code] ";
const PREFIX_DEPS = "[snyk-deps] ";
const MAX_DESC = 200;
const SEVERITY_MAP = { error: "critical", warning: "high", note: "medium" };
const ALLOWED_SEVERITIES = new Set(["critical", "high", "medium", "low"]);

function truncate(s, max) {
  const str = typeof s === "string" ? s : "";
  return str.length > max ? str.slice(0, max) : str;
}

function mapSarifSeverity(level) {
  return SEVERITY_MAP[level] ?? "low";
}

function normalizeScaSeverity(sev) {
  const lower = typeof sev === "string" ? sev.toLowerCase() : "";
  return ALLOWED_SEVERITIES.has(lower) ? lower : "low";
}

// Parse a Snyk Code SARIF v2.1.0 document and emit normalized findings.
// Defensive against missing optional fields per AAP §0.5.4.
function parseSarif(text) {
  const findings = [];
  let sarif;
  try {
    sarif = JSON.parse(text);
  } catch {
    return findings;
  }
  const runs = Array.isArray(sarif?.runs) ? sarif.runs : [];
  for (const run of runs) {
    const rulesArr = Array.isArray(run?.tool?.driver?.rules) ? run.tool.driver.rules : [];
    const ruleIndex = Object.fromEntries(
      rulesArr.filter((r) => r && typeof r.id === "string").map((r) => [r.id, r])
    );
    const results = Array.isArray(run?.results) ? run.results : [];
    for (const result of results) {
      const loc = result?.locations?.[0]?.physicalLocation;
      const file = loc?.artifactLocation?.uri ?? "";
      const line = Number.isInteger(loc?.region?.startLine) ? loc.region.startLine : 0;
      const level = result?.level ?? "warning";
      const severity = mapSarifSeverity(level);
      const rule = ruleIndex[result?.ruleId];
      const cweArr = rule?.properties?.cwe;
      const ruleCwe = Array.isArray(cweArr) && cweArr.length > 0 ? cweArr[0] : "";
      const msgText = result?.message?.text ?? "";
      const description = truncate(PREFIX_CODE + msgText, MAX_DESC);
      findings.push({ file, line, severity, cwe: ruleCwe, description });
    }
  }
  return findings;
}

// Parse a Snyk Open Source / SCA JSON document and emit normalized findings.
// Accepts both the single-project shape {vulnerabilities:[...]} and the
// --all-projects shape (array of such project objects).
// Defensive against the auth-failure shape {ok:false,error:"...",path:"..."}.
function parseSnykJson(text) {
  const findings = [];
  let snyk;
  try {
    snyk = JSON.parse(text);
  } catch {
    return findings;
  }
  const projects = Array.isArray(snyk) ? snyk : [snyk];
  for (const project of projects) {
    if (!project || typeof project !== "object") continue;
    const manifest = project.displayTargetFile ?? project.targetFile ?? project.path ?? "";
    const vulns = Array.isArray(project.vulnerabilities) ? project.vulnerabilities : [];
    for (const v of vulns) {
      if (!v || typeof v !== "object") continue;
      const file = typeof manifest === "string" ? manifest : "";
      const line = 0;
      const severity = normalizeScaSeverity(v.severity);
      const cweArr = v.identifiers?.CWE;
      const cveArr = v.identifiers?.CVE;
      const cwe =
        (Array.isArray(cweArr) && cweArr.length > 0 ? cweArr[0] : null) ??
        (Array.isArray(cveArr) && cveArr.length > 0 ? cveArr[0] : null) ??
        "";
      const title = v.title ?? "";
      const description = truncate(PREFIX_DEPS + title, MAX_DESC);
      findings.push({ file, line, severity, cwe, description });
    }
  }
  return findings;
}

function readFileSafe(path) {
  if (!existsSync(path)) return null;
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

function main() {
  const argv = process.argv.slice(2);
  const sarifPath = resolve(argv[0] ?? "results-snyk-code.sarif");
  const snykPath = resolve(argv[1] ?? "results-snyk-deps.json");
  const outPath = resolve(argv[2] ?? "findings-config-h.json");

  const sarifText = readFileSafe(sarifPath);
  const snykText = readFileSafe(snykPath);

  const sastFindings = sarifText ? parseSarif(sarifText) : [];
  const scaFindings = snykText ? parseSnykJson(snykText) : [];

  // Merge: SAST findings first, then SCA findings. No sorting (AAP §0.5.4).
  const merged = [...sastFindings, ...scaFindings];

  // Serialization: minified JSON, no spacing, plus single trailing LF so that
  // `wc -l` returns 1 per AAP §0.8.2.
  const payload = merged.length === 0 ? "[]" : JSON.stringify(merged);
  writeFileSync(outPath, `${payload}\n`, { encoding: "utf8" });

  // Emit counts to stderr for operator visibility; stdout stays clean.
  const counts = `sast=${sastFindings.length} sca=${scaFindings.length} total=${merged.length}`;
  process.stderr.write(`[normalize] ${counts} out=${outPath}\n`);
}

main();
