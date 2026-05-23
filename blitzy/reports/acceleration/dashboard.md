# Acceleration Measurement Dashboard

This is the Observability dashboard for the 12-metric Development Acceleration Measurement for the `blitzy-cal` repository. Values are populated by `scripts/build_report.py` from `data/metric_*.json` at render time; the placeholder tokens (`<...>`) in the cells below are substituted with computed values during each render.

The dashboard exists as a Markdown template rather than a live Grafana or Datadog panel because the harness is a batch analysis tool, not a long-running service. The corresponding entry in `decision-log.md` (titled "Observability Non-Applicabilities") records this realization of the Observability rule. Live tracing, a metrics endpoint, and health checks are not applicable to a batch tool and are documented as such in the decision log; structured logging with correlation IDs and a dashboard template are the two Observability-rule artifacts that do apply and are delivered.

> **Run ID:** `<run_id>`
> **Inflection Date:** 2026-02-25T00:24:31Z
> **Analysis Window:** 2021-03-10 → 2026-05-18
> **Phases Reported:** Baseline / Ramp-Up / Steady State (or Baseline / Post-Introduction if <90 days)
> **Rendered At:** `<rendered_at>` (UTC)

The Run Metadata block above is rebuilt on every render. `<run_id>` is the UUIDv4 correlation ID that ties every log line in `logs/<run_id>/` to this rendered dashboard; `<rendered_at>` is the UTC timestamp at which `scripts/build_report.py` produced this file. The inflection date is fixed at 2026-02-25T00:24:31Z (the earliest commit authored by `agent@blitzy.com`, identified in `data/inflection.json`); the analysis window endpoints reflect the earliest and latest commit dates in the repository at the time of the run.

## KPI Summary

The table below lists each of the twelve metrics with its phase values, the After/Before multiplier, the confidence tag derived from the actual data source used, the reference threshold from DORA or the Flow Framework, and a pointer to the metric's trend diagram in the main report. Every cell is rendered from the single `metrics_results` dictionary maintained by the extraction harness, so values are consistent with every other section of the report (Rule 4). The `Multiplier` column is the After/Before ratio for each metric; phase-specific multipliers and weighted aggregations are documented in `acceleration-report.md`.

| # | Metric | Baseline | Ramp-Up | Steady State | Multiplier | Confidence | Threshold | Trend |
|---|--------|----------|---------|--------------|---------------------------|------------|-----------|-------|
| 1 | Flow Load | `<M1.baseline>` | `<M1.ramp_up>` | `<M1.steady_state>` | `<M1.multiplier>` | `<M1.confidence>` | DORA: Low ≤ 5 / Med 5-10 / High > 10 in-progress PRs | `<M1.trend_mermaid_ref>` |
| 2 | Flow Velocity | `<M2.baseline>` | `<M2.ramp_up>` | `<M2.steady_state>` | `<M2.multiplier>` | `<M2.confidence>` | DORA Elite: ≥ 1 deploy/day; High: weekly–daily; Medium: weekly–monthly; Low: < monthly | `<M2.trend_mermaid_ref>` |
| 3 | Flow Predictability | `<M3.baseline>` | `<M3.ramp_up>` | `<M3.steady_state>` | `<M3.multiplier>` | `<M3.confidence>` | Higher is more predictable; <1 indicates high variance | `<M3.trend_mermaid_ref>` |
| 4 | Flow Active | `<M4.baseline>` | `<M4.ramp_up>` | `<M4.steady_state>` | `<M4.multiplier>` | `<M4.confidence>` | Median hours of coding span per PR; lower is more focused work | `<M4.trend_mermaid_ref>` |
| 5 | Flow Efficiency | `<M5.baseline>` | `<M5.ramp_up>` | `<M5.steady_state>` | `<M5.multiplier>` | `<M5.confidence>` | Flow Framework: > 40% is healthy, 15-40% is typical, < 15% is wait-heavy | `<M5.trend_mermaid_ref>` |
| 6 | Flow Distribution | `<M6.baseline>` | `<M6.ramp_up>` | `<M6.steady_state>` | `<M6.multiplier>` | `<M6.confidence>` | Flow Framework: feature ≈ 60%, defect ≈ 20%, risk ≈ 10%, tech-debt ≈ 10% as a healthy mix | `<M6.trend_mermaid_ref>` |
| 7 | Flow Time | `<M7.baseline>` | `<M7.ramp_up>` | `<M7.steady_state>` | `<M7.multiplier>` | `<M7.confidence>` | DORA Elite: < 1 day; High: 1 day-1 week; Medium: 1 week-1 month; Low: > 1 month | `<M7.trend_mermaid_ref>` |
| 8 | Problem Records in Release | `<M8.baseline>` | `<M8.ramp_up>` | `<M8.steady_state>` | `<M8.multiplier>` | `<M8.confidence>` | DORA Change Failure Rate: Elite 0-5%, High 5-10%, Medium 10-15%, Low >15% | `<M8.trend_mermaid_ref>` |
| 9 | Releases | `<M9.baseline>` | `<M9.ramp_up>` | `<M9.steady_state>` | `<M9.multiplier>` | `<M9.confidence>` | DORA Deployment Frequency (see M2 thresholds; same scale) | `<M9.trend_mermaid_ref>` |
| 10 | Approved Exceptions | `<M10.baseline>` | `<M10.ramp_up>` | `<M10.steady_state>` | `<M10.multiplier>` | `<M10.confidence>` | Lower is better; >2 per 2-week window indicates policy erosion | `<M10.trend_mermaid_ref>` |
| 11 | Escaped Defects | `<M11.baseline>` | `<M11.ramp_up>` | `<M11.steady_state>` | `<M11.multiplier>` | `<M11.confidence>` | (regressions + newly_skipped) per window; trending up is regressive | `<M11.trend_mermaid_ref>` |
| 12 | Defects Out of SLA | `<M12.baseline>` | `<M12.ramp_up>` | `<M12.steady_state>` | `<M12.multiplier>` | `<M12.confidence>` | Lower percentage is better; >20% indicates SLA non-compliance | `<M12.trend_mermaid_ref>` |

> "Multiplier" is computed as After/Before where After = mean of (Ramp-Up + Steady State) values weighted by window count. For metrics where higher is better (M2, M3, M5, M9), >1 indicates acceleration. For metrics where lower is better (M1, M4, M7, M8, M10, M11, M12), <1 indicates acceleration. Metric 6 is reported as a distribution shift rather than a multiplier.

When a metric reports "Insufficient signal," the Baseline, Ramp-Up, Steady State, and Multiplier cells render the string `Insufficient signal — <reason>`; the Confidence cell renders the same string; and the Threshold cell is preserved as-is. The trend cell links to the metric's deep-dive, which carries the full reason and the list of data sources that were attempted. The Methodology section of the main report enumerates the source-precedence fallback chain for every metric, so the reason cited here is reproducible from the harness logs.

Threshold cells are reference guidance, not pass/fail criteria. A metric with a Low threshold band but a multiplier <1 (for lower-is-better metrics) or >1 (for higher-is-better metrics) is reported as accelerating regardless of which DORA tier the absolute value falls into. The user's instruction frames acceleration as the After/Before ratio, not as alignment with any external performance band.

## Confidence Distribution

The Mermaid pie chart below shows the count of metrics by confidence tier. The chart's descriptive title is **"Confidence Distribution — Metric Count by Tier"**. Confidence is assigned per metric based on the actual data source consulted at run time, not on the metric's definitional tier (see §0.8.3 of the Technical Specifications for the source-to-tier mapping).

```mermaid
pie title Confidence Distribution — Metric Count by Tier
    "High" : <high_count>
    "Medium" : <medium_count>
    "Low" : <low_count>
    "Insufficient signal" : <insufficient_count>
```

Tier membership at the time of render:

- **High:** `<high_confidence_metrics>` (e.g., M2, M7)
- **Medium:** `<medium_confidence_metrics>` (e.g., M1, M4, M5)
- **Low:** `<low_confidence_metrics>` (e.g., M10)
- **Insufficient signal:** `<insufficient_signal_metrics>` (e.g., M12 if no SLA source)

Per Rule 3 (Confidence Transparency), Low-confidence and Insufficient-signal entries in the main report carry an explicit caveat callout. The dashboard surfaces tier counts so the at-a-glance reader can quickly identify how much of the overall picture rests on indirect or proxy data.

The mapping between data source and confidence tier is documented in §0.8.3 of the Technical Specifications. Summarized: a metric derived from direct counts in an issue tracker or from a first-class GitHub API endpoint is High confidence; a metric approximated from git commit patterns or a fallback API surface is Medium confidence; a metric inferred from indirect proxies (force-push events as a proxy for branch protection bypasses, for example) is Low confidence; a metric with no available data source is reported as Insufficient signal and is not assigned any tier. The tier shown in the KPI Summary for each metric is the tier of the source actually consulted at the time of the run, not the tier the metric would have if its primary source were available.

## Trend References

The detailed per-metric trend charts live in the main report; this dashboard surfaces only the KPI table for at-a-glance comprehension. The links below jump to each metric's deep-dive section, which contains the metric definition, the extraction strategy, the per-window time series, the per-actor breakdown where applicable, and the trend diagram.

- **M1 Flow Load:** see [Metric 1 Deep-Dive](./acceleration-report.md#m1-flow-load)
- **M2 Flow Velocity:** see [Metric 2 Deep-Dive](./acceleration-report.md#m2-flow-velocity)
- **M3 Flow Predictability:** see [Metric 3 Deep-Dive](./acceleration-report.md#m3-flow-predictability)
- **M4 Flow Active:** see [Metric 4 Deep-Dive](./acceleration-report.md#m4-flow-active)
- **M5 Flow Efficiency:** see [Metric 5 Deep-Dive](./acceleration-report.md#m5-flow-efficiency)
- **M6 Flow Distribution:** see [Metric 6 Deep-Dive](./acceleration-report.md#m6-flow-distribution)
- **M7 Flow Time:** see [Metric 7 Deep-Dive](./acceleration-report.md#m7-flow-time)
- **M8 Problem Records in Release:** see [Metric 8 Deep-Dive](./acceleration-report.md#m8-problem-records-in-release)
- **M9 Releases:** see [Metric 9 Deep-Dive](./acceleration-report.md#m9-releases)
- **M10 Approved Exceptions:** see [Metric 10 Deep-Dive](./acceleration-report.md#m10-approved-exceptions)
- **M11 Escaped Defects:** see [Metric 11 Deep-Dive](./acceleration-report.md#m11-escaped-defects)
- **M12 Defects Out of SLA:** see [Metric 12 Deep-Dive](./acceleration-report.md#m12-defects-out-of-sla)

## Correlation ID Format

Every script under `scripts/` emits structured JSON log lines with a single correlation ID (`run_id`) that ties all logs for a single harness invocation together. The `run_id` is a UUIDv4 generated at startup, or supplied via the `BLITZY_RUN_ID` environment variable for stable re-runs. The same `run_id` appears in every log line, in the `data/` directory's run-scoped sub-paths, and in the directory name `logs/<run_id>/` under which all per-run log files are co-located.

The harness writes one log file per script or per metric. Log lines are append-only and ordered by `ts`. The schema below is the canonical contract; any consumer (a tail process, a log shipper, a downstream analysis tool) can parse it without coordination with the producer.

A single log line in JSON Lines format:

```json
{
  "ts": "2026-05-22T19:24:31.123456Z",
  "level": "INFO",
  "run_id": "550e8400-e29b-41d4-a716-446655440000",
  "metric": "M4",
  "phase": "extract_metrics",
  "message": "Computed flow_active for PR #14523 (actor=blitzy-agent, span_count=3)",
  "context": {
    "pr_number": 14523,
    "actor": "blitzy-agent",
    "span_count": 3,
    "total_seconds": 4250
  }
}
```

Field semantics:

- `ts` — ISO 8601 UTC timestamp with microsecond precision
- `level` — Standard `logging` levels: DEBUG, INFO, WARNING, ERROR, CRITICAL
- `run_id` — UUIDv4 correlation ID (matches the `logs/<run_id>/` directory name)
- `metric` — One of `M1`–`M12`, or `null` for harness-level events
- `phase` — Script name or pipeline phase (`verify_environment`, `derive_inflection`, `generate_windows`, `extract_metrics`, `validate_consistency`, `build_report`, `build_presentation`)
- `message` — Human-readable message
- `context` — Free-form JSON object with metric-specific fields (PR number, actor, window ID, error class, etc.)

To trace a single PR across every metric that consulted it, grep the per-metric logs for the PR number: `grep '"pr_number": 14523' logs/<run_id>/metric_*.log`. To reconstruct the harness run's full timeline, concatenate every log file in the run's directory and sort by `ts`.

Common `context` fields by metric:

- **M1, M2, M3:** `window_id`, `pr_count`, `actor`, `bot_excluded_count`
- **M4, M5:** `pr_number`, `actor`, `span_count`, `total_seconds`, `flow_time_seconds`
- **M6:** `pr_number`, `category`, `classification_tier` (`label` / `prefix` / `keyword` / `unknown`)
- **M7:** `pr_number`, `first_commit_iso`, `merged_at_iso`, `flow_time_seconds`, `exclusion_reason` (when applicable)
- **M8:** `revert_sha`, `original_sha`, `attributed_tag`, `attribution_status` (`attributed` / `unattributable` / `unreleased`)
- **M9:** `release_tag`, `source` (`api` / `tags` / `ci_deploys`), `prerelease` (boolean)
- **M10:** `event_type` (`force_push` / `label` / `admin_override`), `actor`, `audit_source` (`audit_log` / `events_api` / `label`)
- **M11:** `run_id_github`, `workflow`, `test_path`, `transition` (`pass_to_fail` / `newly_skipped`)
- **M12:** `issue_id`, `severity`, `sla_target_hours`, `actual_resolution_hours`, `sla_source` (`linear` / `policy` / `none`)

The field set is not exhaustive; the harness emits whatever context fields are useful for the specific event being logged. The seven required top-level keys (`ts`, `level`, `run_id`, `metric`, `phase`, `message`, `context`) are always present.

## Log Files per Run

Each invocation of the extraction harness produces a fixed set of log files under `logs/<run_id>/`. The list below is the complete inventory for one run. All files are append-only; re-running the harness with the same `BLITZY_RUN_ID` appends to the existing files rather than overwriting them, which lets a partial re-run resume cleanly from the failed step.

- `verify_environment.log` — environment capture (repo URL, git version, commit count, branch count, submodule state, date range, extraction timestamp)
- `derive_inflection.log` — inflection detection candidate computation and reconciliation
- `generate_windows.log` — window table generation
- `metric_1.log` through `metric_12.log` — per-metric structured log lines (12 files)
- `validate_consistency.log` — cross-section value consistency check results
- `commands.log` — special file — ordered catalog of every git invocation, API call, and subprocess execution. Source for the Reproducibility Appendix in `acceleration-report.md`. Schema differs from the other logs:

```
<ISO8601_ts> <command_type> <command_string>
```

Example lines from `commands.log`:

```
2026-05-22T19:24:31.123456Z git git rev-list --all --count
2026-05-22T19:24:31.234567Z http GET https://api.github.com/repos/Blitzy-Sandbox/blitzy-cal/pulls?state=all&page=1
2026-05-22T19:24:31.345678Z subprocess python3 scripts/derive_inflection.py
```

`commands.log` is the single source of truth for the Reproducibility Appendix in the main report; `scripts/build_report.py` reads it verbatim and emits it in execution order. The other logs are diagnostic only — they document what the harness saw, while `commands.log` documents what the harness did.

## Threshold References

The Threshold column in the KPI Summary cites reference guidance from the DORA framework and the Flow Framework. These references are guidance bands, not pass/fail criteria. The user's instruction does not require the metrics to pass DORA Elite or any other tier; the After/Before multiplier is the primary signal, and the threshold column exists to give the reader context for interpreting the absolute values.

- **DORA Performance Levels (Elite/High/Medium/Low):** [DORA Guides — DORA Metrics](https://dora.dev/guides/dora-metrics/)
- **Flow Framework — Flow Distribution and Flow Efficiency:** [Project to Product (Flow Framework book reference)](https://flowframework.org/)
- **GitHub REST API thresholds (rate limits, etc.):** [GitHub REST API Documentation](https://docs.github.com/en/rest)

For metrics that map directly to a DORA metric (M7 Flow Time → Lead Time for Changes; M8 Problem Records → Change Failure Rate; M9 Releases → Deployment Frequency), the Threshold column reproduces the DORA performance band exactly. For metrics that map to a Flow Framework concept (M5 Flow Efficiency, M6 Flow Distribution), the Threshold column reproduces the Flow Framework reference range. For metrics that do not have an external canonical threshold (M1 Flow Load, M3 Flow Predictability, M4 Flow Active, M10 Approved Exceptions, M11 Escaped Defects, M12 Defects Out of SLA), the Threshold column documents an internal directional rule (e.g., "lower is better" or "higher is more predictable") so the reader can interpret the multiplier sign.

Metric-to-source mapping:

- **M1, M2, M3, M4, M5, M7:** Flow Framework / DORA hybrid — see Project to Product (Tasktop / Flow Framework) for Flow Load, Flow Velocity, Flow Predictability, Flow Active, and Flow Efficiency definitions; see DORA Guides for the Flow Time → Lead Time mapping
- **M6:** Flow Framework — Flow Distribution canonical reference (`feature`, `defect`, `risk`, `tech-debt` categories)
- **M8, M9:** DORA — Change Failure Rate (M8) and Deployment Frequency (M9)
- **M10:** Internal directional rule — no external canonical threshold; the per-2-week window cap of 2 is the documented internal policy point
- **M11:** Internal composite — `regressions + newly_skipped` per 2-week window; trending up over multiple windows indicates regressive signal
- **M12:** Issue-tracker SLA target (Linear severity SLA when available, otherwise repository policy)

When a citation source is unavailable (for example, if the GitHub REST API rate-limit threshold changes), the harness uses the value documented at the time of extraction and records the source URL in `commands.log`. Re-runs against the same git head and the same cached API responses produce byte-identical thresholds.

## Refreshing the Dashboard

The dashboard is regenerated by re-running the extraction harness followed by `scripts/build_report.py`. The placeholder tokens in the KPI Summary and Confidence Distribution sections are substituted with values from `data/metric_*.json`. To refresh:

```bash
python3 blitzy/reports/acceleration/scripts/extract_metrics.py --metric all && \
  python3 blitzy/reports/acceleration/scripts/build_report.py
```

The dashboard file is overwritten by `build_report.py`; manual edits to the value cells in the KPI table or to the Confidence Distribution counts are lost on re-render. If the dashboard structure itself needs to change (new columns, reordered sections, additional threshold references), edit the dashboard template embedded in `build_report.py` rather than this file directly.

To re-run a single metric without recomputing the others, pass `--metric N` (where N is 1 through 12) to `extract_metrics.py`; the harness will reuse cached API responses under `data/cache/` and regenerate only `data/metric_N.json`. To bypass the cache and re-fetch from the GitHub API, add `--no-cache`. To run with a stable correlation ID across multiple invocations (useful for resuming a partially-failed run), set `BLITZY_RUN_ID` to the UUID of the run being resumed before invoking `extract_metrics.py`.

The full pipeline ordering when refreshing from a clean state is:

```bash
export BLITZY_RUN_ID=$(uuidgen)
python3 blitzy/reports/acceleration/scripts/verify_environment.py
python3 blitzy/reports/acceleration/scripts/derive_inflection.py
python3 blitzy/reports/acceleration/scripts/generate_windows.py
python3 blitzy/reports/acceleration/scripts/extract_metrics.py --metric all
python3 blitzy/reports/acceleration/scripts/validate_consistency.py
python3 blitzy/reports/acceleration/scripts/build_report.py
python3 blitzy/reports/acceleration/scripts/build_presentation.py
```

Each script reads only from `data/` (and from `.git/`, the GitHub API, or the Linear API for those scripts that need external sources) and writes only to `data/` and `logs/<run_id>/`. The harness never writes to any file outside `/blitzy/reports/acceleration/`. Re-runs are idempotent given the same git head and the same API cache; deleting `data/cache/` forces a full re-fetch from the GitHub API on the next run.

Failure handling: each metric extraction is wrapped in a `try`/`except` block that catches data-source unavailability and writes `{"status": "insufficient_signal", "reason": "<reason>"}` to `data/metric_<N>.json` rather than aborting the run. The harness exit code reflects the overall run status (0 if every metric either succeeded or correctly reported insufficient signal; 1 if any metric crashed unexpectedly). The `validate_consistency.py` step exits non-zero on any cross-section discrepancy, which blocks `build_report.py` from emitting an inconsistent report.
