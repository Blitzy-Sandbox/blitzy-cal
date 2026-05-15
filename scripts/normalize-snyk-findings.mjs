// Normalizer for Snyk Code (SARIF) and Snyk Open Source (JSON) findings.
// Produces a single-line minified JSON array (findings-config-h.json) per the
// 5-field schema: { file, line, severity, cwe, description }.

import fs from "node:fs";
import process from "node:process";
import { fileURLToPath } from "node:url";

function mapSarifSeverity(level) {
  const map = { error: "critical", warning: "high", note: "medium" };
  return map[level] ?? "low";
}

function truncate(s, max) {
  return String(s ?? "").slice(0, max);
}

function parseSarif(sarifText) {
  const sarif = JSON.parse(sarifText);
  const findings = [];
  for (const run of sarif.runs ?? []) {
    const rules = run?.tool?.driver?.rules ?? [];
    const ruleIndex = Object.fromEntries(rules.map((r) => [r.id, r]));
    for (const result of run.results ?? []) {
      const loc = result.locations?.[0]?.physicalLocation;
      const file = loc?.artifactLocation?.uri ?? "";
      const rawStartLine = loc?.region?.startLine;
      let line;
      if (Number.isInteger(rawStartLine)) {
        line = rawStartLine;
      } else {
        line = 0;
      }
      const level = result.level ?? "warning";
      const severity = mapSarifSeverity(level);
      const cwe = ruleIndex[result.ruleId]?.properties?.cwe?.[0] ?? "";
      const msg = `[snyk-code] ${result.message?.text ?? ""}`;
      const description = truncate(msg, 200);
      findings.push({ file, line, severity, cwe, description });
    }
  }
  return findings;
}

function parseSnyk(snykText) {
  const snyk = JSON.parse(snykText);
  let projects;
  if (Array.isArray(snyk)) {
    projects = snyk;
  } else {
    projects = [snyk];
  }
  const findings = [];
  for (const project of projects) {
    const manifest = project?.displayTargetFile ?? project?.targetFile ?? "";
    for (const v of project?.vulnerabilities ?? []) {
      const file = manifest;
      const line = 0;
      const severity = v.severity;
      const cwe = v.identifiers?.CWE?.[0] ?? v.identifiers?.CVE?.[0] ?? "";
      const msg = `[snyk-deps] ${v.title ?? ""}`;
      const description = truncate(msg, 200);
      findings.push({ file, line, severity, cwe, description });
    }
  }
  return findings;
}

function main() {
  const sarifPath = process.argv[2] ?? "results-snyk-code.sarif";
  const snykPath = process.argv[3] ?? "results-snyk-deps.json";
  const outPath = process.argv[4] ?? "findings-config-h.json";

  if (!fs.existsSync(sarifPath)) {
    process.stderr.write(`error: SARIF input not found: ${sarifPath}\n`);
    process.exit(1);
  }
  if (!fs.existsSync(snykPath)) {
    process.stderr.write(`error: Snyk JSON input not found: ${snykPath}\n`);
    process.exit(1);
  }

  const sarifText = fs.readFileSync(sarifPath, "utf8");
  const snykText = fs.readFileSync(snykPath, "utf8");

  const sastFindings = parseSarif(sarifText);
  const scaFindings = parseSnyk(snykText);

  const merged = [...sastFindings, ...scaFindings];
  let out;
  if (merged.length === 0) {
    out = "[]";
  } else {
    out = JSON.stringify(merged);
  }
  fs.writeFileSync(outPath, `${out}\n`, { encoding: "utf8" });

  process.stderr.write(`wrote ${merged.length} finding(s) to ${outPath}\n`);
}

// Entrypoint guard — main() only runs when this module is invoked directly as a
// CLI script (node scripts/normalize-snyk-findings.mjs ...). When the module is
// dynamically imported (for testing or programmatic reuse), no side-effecting
// I/O is performed and consumers can call the exported helpers in isolation.
const isMainModule =
  typeof process !== "undefined" &&
  Array.isArray(process.argv) &&
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1]);

if (isMainModule) {
  main();
}

export { mapSarifSeverity, truncate, parseSarif, parseSnyk, main };
