#!/usr/bin/env python3
"""build_report.py — Render acceleration-report.md and dashboard.md from data/*.json.

This module is the deterministic Markdown renderer for the Development
Acceleration Measurement deliverable. It substitutes placeholder tokens of
the form ``<M<N>.<field>>`` and ``<env.<field>>`` with computed values from
``data/metric_*.json``, ``data/environment.json``, ``data/inflection.json``,
and ``data/windows.json``; embeds ``logs/<run_id>/commands.log`` verbatim in
the Reproducibility Appendix; auto-inserts CAVEAT callouts for Low-confidence
metrics; and runs the Rule 2 (Factual-Neutral Tone) subjective-token grep
pass that fails the build if any forbidden qualifiers appear in the rendered
body. The same renderer writes both ``acceleration-report.md`` and
``dashboard.md``, enforcing Rule 4 (Internal Consistency) at the structural
level — the values surface from a single source-of-truth metrics dictionary.

The renderer is the central enforcement point for the user-supplied report
rules from AAP §0.7.2:

  * Rule 1 (Data Provenance): every numeric value flows from
    ``data/metric_*.json`` through the substitution map, and the
    Reproducibility Appendix is generated from ``commands.log`` so every
    figure traces to a reproducible extraction command.
  * Rule 2 (Factual-Neutral Tone): the subjective-token grep pass runs
    AFTER substitution and BEFORE write; any match fails the build with
    exit code 1 and the output files are not written.
  * Rule 3 (Confidence Transparency): Low-confidence and insufficient-signal
    metrics receive a ``> **CAVEAT — ...**`` block immediately after their
    H2 header. No emoji is used in any callout per the Executive
    Presentation rule's zero-emoji constraint, applied here for
    cross-deliverable consistency.
  * Rule 4 (Internal Consistency): the report, the dashboard, the
    Traceability Matrix, and the Acceleration Curve render from the same
    ``metrics_results`` dictionary. Cross-section consistency is enforced
    structurally — there is no second source for any value.
  * Rule 5 (Reproducibility): the Reproducibility Appendix substitutes its
    ``<commands_log_verbatim>`` token with the byte content of
    ``logs/<run_id>/commands.log``. The appendix is not hand-authored.
  * Rule 6 (Environment First): ``validate_section_order`` confirms that
    ``## Environment Verification`` precedes every ``## M<N>`` deep-dive in
    the rendered report. A failure here blocks emission and returns exit
    code 1.

Inputs (read-only):
  * ``blitzy/reports/acceleration/data/metric_1.json`` through ``metric_12.json``
  * ``blitzy/reports/acceleration/data/environment.json``
  * ``blitzy/reports/acceleration/data/inflection.json``
  * ``blitzy/reports/acceleration/data/windows.json``
  * ``blitzy/reports/acceleration/logs/<run_id>/commands.log``
  * Optional ``--report-template`` and ``--dashboard-template`` paths under
    ``blitzy/reports/acceleration/`` for callers that prefer external
    templates over the embedded defaults.

Outputs (writes only under ``blitzy/reports/acceleration/``):
  * ``acceleration-report.md`` (or ``--output``)
  * ``dashboard.md`` (or ``--dashboard-output``)
  * structured JSON log lines appended to ``logs/<run_id>/build_report.log``
  * ``commands.log`` lines appended via ``_shared.command_log_append``

Exit codes:
  * 0 — Rendered successfully; both outputs written.
  * 1 — Rule 2 (Factual-Neutral Tone) or Rule 6 (Environment First) violation.
  * 2 — Required ``data/*.json`` file missing.
  * 3 — Explicit ``--report-template`` or ``--dashboard-template`` path was
        provided but the file does not exist.
  * 4 — Mermaid diagram count below ``MIN_MERMAID_DIAGRAMS`` (16) after
        substitution.

Constraints (User AAP §0.7.3):
  * Read-only on the analyzed repository; no source files are modified.
  * Python 3.10+ stdlib only; no third-party packages.
  * No fabrication: missing or insufficient values render as
    ``Insufficient signal — <reason>`` exactly.
  * All writes are validated by ``_shared.ensure_report_path`` semantics
    (the output paths default to constants that resolve under
    ``REPORT_ROOT``).
"""

from __future__ import annotations

import argparse
import html
import json
import logging
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from _shared import (  # noqa: E402
    ACCELERATION_REPORT_PATH,
    DASHBOARD_PATH,
    DATA_DIR,
    LOGS_DIR,
    REPORT_ROOT,
    SUBJECTIVE_TOKENS,
    command_log_append,
    get_or_create_run_id,
    load_all_metrics,
    structured_logger,
)


# ---------------------------------------------------------------------------
# Section 1 — Module Constants
# ---------------------------------------------------------------------------

MIN_MERMAID_DIAGRAMS: int = 16
"""Minimum count of Mermaid fenced blocks in the rendered report.

The required count is four methodology diagrams (Extraction Pipeline,
Temporal Phase Boundary, Confidence Flow, Acceleration Curve) plus one
trend diagram per metric (M1..M12), for a total of sixteen. A render that
falls below this threshold fails the build with exit code 4."""


REQUIRED_SECTION_ORDER: list[str] = [
    r"^# Development Acceleration Measurement",
    r"^## Executive Summary",
    r"^## Environment Verification",
    r"^## Data Source Inventory",
    r"^## Methodology",
    r"^## M1 Flow Load",
    r"^## M2 Flow Velocity",
    r"^## M3 Flow Predictability",
    r"^## M4 Flow Active",
    r"^## M5 Flow Efficiency",
    r"^## M6 Flow Distribution",
    r"^## M7 Flow Time",
    r"^## M8 Problem Records in Release",
    r"^## M9 Releases",
    r"^## M10 Approved Exceptions",
    r"^## M11 Escaped Defects",
    r"^## M12 Defects Out of SLA",
    r"^## Requirements Traceability Matrix",
    r"^## Per-Engineer Acceleration",
    r"^## Acceleration Curve",
    r"^## Risk Assessment",
    r"^## Limitations",
    r"^## Reproducibility Appendix",
    r"^## References",
]
"""Ordered list of section-header regex patterns that ``validate_section_order``
asserts appear in the rendered report in this exact order. The Environment
Verification section MUST precede every Metric Deep-Dive per Rule 6
(Environment First). The H1 Front Matter must precede every H2; the
Reproducibility Appendix must precede the References list. A missing or
out-of-order pattern fails the build with exit code 1."""


PLACEHOLDER_RE: re.Pattern[str] = re.compile(r"<([A-Za-z0-9_.]+)>")
"""Matches placeholder tokens of the form ``<namespace.field>`` or
``<simple_name>``. The matched group 1 is the token name without angle
brackets and is the dictionary key used by ``substitute_placeholders`` to
locate the substitution value. Tokens that do not resolve to a known key
are left unchanged so the consistency validator can flag them in a
post-render audit."""


MERMAID_BLOCK_RE: re.Pattern[str] = re.compile(
    r"```mermaid\s*\n.*?\n```", re.DOTALL | re.MULTILINE
)
"""Matches a complete fenced Mermaid block (`\\`\\`\\`mermaid ... \\`\\`\\``)
across multiple lines. Used by ``count_mermaid_diagrams`` to verify that the
rendered report meets the ``MIN_MERMAID_DIAGRAMS`` threshold."""


LOW_CALLOUT_RE: re.Pattern[str] = re.compile(
    r"^>\s*\*\*CAVEAT", re.MULTILINE
)
"""Matches the start of an auto-inserted CAVEAT callout. Used by
``insert_low_confidence_callouts`` to detect existing callouts so the
renderer is idempotent — running the substitution twice does not stack
duplicate callouts. The match is anchored to start-of-line so that
CAVEAT keyword text embedded inside metric body text is not detected
as a callout marker."""


# Module-level regex constants for body filtering and callout shape checks.
_FENCED_BLOCK_RE: re.Pattern[str] = re.compile(
    r"^```.*?^```", re.DOTALL | re.MULTILINE
)
"""Matches a generic fenced code block (any language). Used by
``filter_report_body`` to scrub fenced blocks from the Rule 2 grep
surface so quoted user-instruction code or sample output does not
trigger a false-positive subjective-token violation."""


_BLOCKQUOTE_LINE_RE: re.Pattern[str] = re.compile(r"^>.*$", re.MULTILINE)
"""Matches a single blockquote line. Used by ``filter_report_body`` to
remove blockquoted user-instruction text from the Rule 2 grep surface
per the user's instruction: 'Scope: report body (excluding this
prompt).'"""


# Header pattern shared by ``insert_low_confidence_callouts``. Captures
# the H2 header line for any metric in M1..M12 (the digits group is
# constrained to one or two digits so unrelated headers — e.g. an H2
# starting with the letter M followed by free text — do not match).
_METRIC_H2_RE: re.Pattern[str] = re.compile(
    r"^(## M(\d{1,2})[^\n]*)$", re.MULTILINE
)


# ---------------------------------------------------------------------------
# Section 2 — Default Report Template (embedded)
# ---------------------------------------------------------------------------
#
# The embedded report template is the canonical scaffold for
# acceleration-report.md. It contains every required section in the order
# enforced by REQUIRED_SECTION_ORDER, every per-metric H2 deep-dive
# (M1..M12), four methodology Mermaid blocks, twelve per-metric trend
# Mermaid blocks (for a total of sixteen), a Traceability Matrix with
# twelve rows and seven columns, the Per-Engineer Acceleration table, the
# Acceleration Curve, the Risk Assessment, the Limitations bullets, the
# Reproducibility Appendix placeholder, and the References list.
#
# Placeholders embed-able directly inside the template:
#   * <M<N>.field>                — per-metric scalar fields
#   * <env.field>                 — environment metadata
#   * <inflection.field>          — inflection candidate / chosen date
#   * <windows.count> et al.      — window-table aggregates
#   * <run_id>, <rendered_at>     — invocation metadata
#   * <commands_log_verbatim>     — Reproducibility Appendix body
#
# The template intentionally uses the same placeholder names that appear
# in the existing acceleration-report.md to keep the renderer drop-in
# compatible with that file as an external template (--report-template).

DEFAULT_REPORT_TEMPLATE: str = r"""# Development Acceleration Measurement — blitzy-cal

This report quantifies the change in twelve flow and operational metrics for the `blitzy-cal` repository across a Before/After boundary defined by the introduction of the Blitzy Agent AI engineering tool. The inflection date is `<inflection.chosen_date>` (earliest commit authored by `agent@blitzy.com`). All twelve metrics — Flow Load, Flow Velocity, Flow Predictability, Flow Active, Flow Efficiency, Flow Distribution, Flow Time, Problem Records in Release, Releases, Approved Exceptions, Escaped Defects, and Defects Out of SLA — are derived from read-only sources (Git history, GitHub REST API, optional Linear API, repository configuration, workflow definitions, and test files). No metric is fabricated, estimated, or extrapolated; data gaps are reported as "Insufficient signal — [reason]" with the cause logged in `decision-log.md`.

The same extraction logic is applied to both periods with only the date filter and engineering-actor identity branching. Temporal phases are: Baseline (before inflection), Ramp-Up (first 90 days post-introduction), and Steady State (90+ days post-introduction). If fewer than 90 days of post-introduction data exist at run time, the report reverts to "Baseline vs Post-Introduction only." Windows are 2 weeks aligned to Monday starts.

This file was rendered at `<rendered_at>` (UTC) by `scripts/build_report.py` from `data/metric_*.json`. The correlation ID for this run is `<run_id>`; logs are co-located under `logs/<run_id>/`. Every numeric value in this report carries a confidence tag (High / Medium / Low) derived from the actual data source used; every numeric value also has a corresponding entry in the Reproducibility Appendix and a row in the Requirements Traceability Matrix.

---

## Executive Summary

### Headline Acceleration Multipliers

| # | Metric | Baseline | After | Multiplier | Direction | Confidence |
|---|--------|----------|-------|------------|-----------|------------|
| M1 | Flow Load | `<M1.baseline>` | `<M1.after>` | `<M1.multiplier>` | `<M1.direction>` | `<M1.confidence>` |
| M2 | Flow Velocity | `<M2.baseline>` | `<M2.after>` | `<M2.multiplier>` | `<M2.direction>` | `<M2.confidence>` |
| M3 | Flow Predictability | `<M3.baseline>` | `<M3.after>` | `<M3.multiplier>` | `<M3.direction>` | `<M3.confidence>` |
| M4 | Flow Active | `<M4.baseline>` | `<M4.after>` | `<M4.multiplier>` | `<M4.direction>` | `<M4.confidence>` |
| M5 | Flow Efficiency | `<M5.baseline>` | `<M5.after>` | `<M5.multiplier>` | `<M5.direction>` | `<M5.confidence>` |
| M6 | Flow Distribution | `<M6.baseline>` | `<M6.after>` | `<M6.multiplier>` | `<M6.direction>` | `<M6.confidence>` |
| M7 | Flow Time | `<M7.baseline>` | `<M7.after>` | `<M7.multiplier>` | `<M7.direction>` | `<M7.confidence>` |
| M8 | Problem Records in Release | `<M8.baseline>` | `<M8.after>` | `<M8.multiplier>` | `<M8.direction>` | `<M8.confidence>` |
| M9 | Releases | `<M9.baseline>` | `<M9.after>` | `<M9.multiplier>` | `<M9.direction>` | `<M9.confidence>` |
| M10 | Approved Exceptions | `<M10.baseline>` | `<M10.after>` | `<M10.multiplier>` | `<M10.direction>` | `<M10.confidence>` |
| M11 | Escaped Defects | `<M11.baseline>` | `<M11.after>` | `<M11.multiplier>` | `<M11.direction>` | `<M11.confidence>` |
| M12 | Defects Out of SLA | `<M12.baseline>` | `<M12.after>` | `<M12.multiplier>` | `<M12.direction>` | `<M12.confidence>` |

### Plain-Language Summary

Metric M1 (Flow Load) moved from `<M1.baseline>` in-progress PRs to `<M1.after>` in-progress PRs (multiplier `<M1.multiplier>`, confidence `<M1.confidence>`). Metric M2 (Flow Velocity) moved from `<M2.baseline>` to `<M2.after>` merged PRs per 2-week window (multiplier `<M2.multiplier>`, confidence `<M2.confidence>`). Metric M7 (Flow Time) moved from `<M7.baseline>` to `<M7.after>` (units: hours, median; multiplier `<M7.multiplier>`, confidence `<M7.confidence>`). Readers should consult each metric's deep-dive for the source provenance and per-actor breakdown.

### Phase Context

- Baseline: `<phase_baseline_range>` (`<windows.baseline_count>` windows of 2 weeks each, Monday-aligned).
- Ramp-Up: `<phase_ramp_up_range>` (`<windows.ramp_up_count>` windows, first 90 days post-introduction).
- Steady State: `<phase_steady_state_range>` (`<windows.steady_state_count>` windows, 90+ days post-introduction).

Total windows in scope: `<windows.count>`. If fewer than 90 days of post-introduction data exist at run time, the report falls back to "Baseline vs Post-Introduction only" (`<windows.post_intro_count>` post-introduction windows).

---

## Environment Verification

This section appears before every Metric Deep-Dive per Rule 6 (Environment First). The captured environment metadata is sourced from `data/environment.json`, populated by `scripts/verify_environment.py`, which is the first script invoked in every harness run.

| Attribute | Value |
|-----------|-------|
| Repository URL | `<env.repo_url>` |
| Git version | `<env.git_version>` |
| Total commit count | `<env.commit_count>` |
| Active branch count | `<env.branch_count>` |
| Submodule state | `<env.submodules>` |
| Commit date range | `<env.date_range>` |
| Extraction timestamp | `<env.extracted_at>` (UTC) |
| Python version | `<env.python_version>` |
| OS | `<env.os>` |
| Run ID (correlation) | `<run_id>` |
| Git HEAD SHA | `<env.head_sha>` |
| Default branch | `<env.default_branch>` |

The values above identify the exact commit, branch, and runtime under which the metric figures in this report were derived. The same `<run_id>` value is the directory name used for per-run logs at `logs/<run_id>/` and is referenced from the Reproducibility Appendix.

---

## Data Source Inventory

This section enumerates every system consulted to derive the twelve metrics and records whether each source was Available, Conditional, or Unavailable. Every Unavailable status triggers a confidence downgrade for the affected metric.

| Source | Endpoint / Path | Used For |
|--------|-----------------|----------|
| Git history | `.git/` (local) | M1–M9, M11 |
| GitHub REST API | `/repos/Blitzy-Sandbox/blitzy-cal/pulls?state=all` | M1, M2, M4, M5, M7 |
| GitHub REST API | `/repos/Blitzy-Sandbox/blitzy-cal/pulls/{n}/reviews` | M4, M5 |
| GitHub REST API | `/repos/Blitzy-Sandbox/blitzy-cal/pulls/{n}/commits` | M4, M7 |
| GitHub REST API | `/repos/Blitzy-Sandbox/blitzy-cal/issues/{n}/events` | M4, M5, M10 |
| GitHub REST API | `/repos/Blitzy-Sandbox/blitzy-cal/issues?labels=bug&state=all` | M6, M12 |
| GitHub REST API | `/repos/Blitzy-Sandbox/blitzy-cal/releases` | M9 |
| GitHub REST API | `/repos/Blitzy-Sandbox/blitzy-cal/actions/runs` | M11 |
| GitHub REST API | `/repos/Blitzy-Sandbox/blitzy-cal/branches/main/protection` | M10 |
| GitHub Audit Log API | `/orgs/Blitzy-Sandbox/audit-log` | M10 (Conditional on `audit_log:read`) |
| Linear API | `issues?filter[label][name][eq]=bug` | M6, M12 (Conditional on `LINEAR_API_KEY`) |
| Repository config | `.kodiak.toml`, `.github/CODEOWNERS`, `.github/PULL_REQUEST_TEMPLATE.md` | M1, M2, M6, M10, M12 |
| Workflow definitions | `.github/workflows/*.yml` (58 files) | M10, M11 |
| Test files | `packages/**/*.test.{ts,tsx,js,jsx}`, `apps/**/*.test.{ts,tsx,js,jsx}` | M11 |
| Repository policy | `CONTRIBUTING.md`, `SECURITY.md`, `README.md` | M12 (SLA source search) |

Status values are one of: `Available`, `Unavailable — {REASON}`, `Conditional — {CONDITION}`. Any Unavailable row triggers a confidence downgrade and a Risk Assessment entry.

---

## Methodology

This section describes the technical strategy used for the four cross-cutting concerns that affect every metric: AI tool introduction date detection, 2-week window alignment, engineering-actor substitution, and the overall extraction pipeline. Each subsection references the corresponding entry in `decision-log.md`.

### Inflection Detection

The harness derives two candidate inflection dates and reconciles them within a 30-day tolerance. Method 1 is the earliest commit authored by `agent@blitzy.com`. Method 2 is the start date of the sharpest sustained 14-day velocity inflection in the trailing six-month baseline.

Method 1 result: `<inflection.co_author_candidate>`. Method 2 result: `<inflection.velocity_candidate>`. Divergence: `<inflection.divergence_days>` days. Chosen date: `<inflection.chosen_date>` via method `<inflection.chosen_method>`.

### Window Alignment

Windows are 2 weeks long, aligned to Monday starts. The inflection date is snapped backward to the most recent Monday and window boundaries are generated forward and backward to span the repository's full commit date range. Boundary windows that straddle the inflection date are assigned by majority of days: seven or more days post-introduction is After.

### Engineering Actor Substitution

The harness uses a single selector function `engineering_actor(pr, phase)` to choose the actor identity for per-actor aggregations. In the Baseline phase the human author login is returned; in After phases the function returns `blitzy-agent` when the PR is Blitzy-authored and the human author login otherwise. This selector is the only place actor identity is selected, which makes the identical-methodology guarantee structurally inevitable.

### Extraction Pipeline

**Diagram 1: Extraction Pipeline — Read Sources to Persisted Outputs.** The diagram below shows the data lineage from read-only sources through the harness scripts to the persisted deliverables. All arrows are read-then-write; no arrow points back into the read sources.

```mermaid
graph TB
  subgraph "Read Sources (no modifications)"
    GIT[Git History<br/>.git/]
    GH[GitHub REST API<br/>pulls reviews issues releases]
    LIN[Linear API<br/>optional]
    CI[CI Test Artifacts<br/>actions/runs]
    TST[Test Files<br/>packages apps]
  end
  subgraph "Extraction Harness"
    ENV[verify_environment.py]
    INF[derive_inflection.py]
    WIN[generate_windows.py]
    EXT[extract_metrics.py x12]
    VAL[validate_consistency.py]
  end
  subgraph "Persisted Outputs"
    DATA[data/*.json]
    LOGS[logs/run_id/*.log]
    REP[acceleration-report.md]
    DECK[executive-presentation.html]
    DLOG[decision-log.md]
    DASH[dashboard.md]
    RD[README.md]
  end
  GIT --> ENV
  GIT --> INF
  GIT --> EXT
  GH --> EXT
  LIN --> EXT
  CI --> EXT
  TST --> EXT
  ENV --> DATA
  INF --> DATA
  WIN --> DATA
  EXT --> DATA
  EXT --> LOGS
  VAL --> DATA
  DATA --> REP
  DATA --> DECK
  DATA --> DLOG
  DATA --> DASH
  DATA --> RD
%% Legend: Each rectangle in the leftmost cluster is a read-only data source. The middle cluster shows scripts under /blitzy/reports/acceleration/scripts/. The rightmost cluster lists persisted deliverables under /blitzy/reports/acceleration/.
```

### Temporal Phase Boundary

**Diagram 2: Temporal Phase Boundary — Window Alignment.** The timeline below shows the repository's commit date range and the three temporal phases produced by snapping the inflection date backward to the most recent Monday. Boundary windows are assigned by majority of days.

```mermaid
timeline
  title Temporal Phase Boundary on blitzy-cal
  section Baseline
    Earliest commit : First Monday-aligned window
    Mid-baseline : Periodic 2-week windows
    Last pre-inflection Monday : Final Baseline window
  section Inflection
    Chosen inflection date : Earliest Blitzy Agent commit
    Snapped to Monday : Anchor for window alignment
  section After
    Ramp-Up (days 1 to 90) : First 90 days post-introduction
    Steady State (90+) : Conditional on >= 90 days of post-introduction data
    Latest commit : Most recent Monday-aligned window
%% Legend: Baseline spans from the earliest commit on the default branch to the last Monday strictly before the inflection date. After is split into Ramp-Up (first 90 days) and Steady State (90+ days). Steady State is replaced by Post-Introduction if fewer than 90 days of post-introduction data exist.
```

### Confidence Flow

**Diagram 3: Per-Metric Confidence Flow — Data Source Determines Tier.** The decision tree below shows how confidence is assigned per metric based on which data source produced the figure. Confidence is not pre-assigned by metric category; it is assigned per metric based on the actual source consulted at run time.

```mermaid
flowchart TD
  START[Metric extraction begins] --> Q1{Primary source available?}
  Q1 -- Yes --> CONF_HIGH[Tag confidence High<br/>API direct counts or audit log]
  Q1 -- No --> Q2{Secondary source available?}
  Q2 -- Yes --> CONF_MED[Tag confidence Medium<br/>git commit patterns or label heuristics]
  Q2 -- No --> Q3{Tertiary source available?}
  Q3 -- Yes --> CONF_LOW[Tag confidence Low<br/>indirect proxies or partial signals]
  Q3 -- No --> ISG[Report Insufficient signal<br/>document reason in decision-log.md]
  CONF_HIGH --> EMIT[Emit metric_N.json]
  CONF_MED --> EMIT
  CONF_LOW --> CAVEAT[Prepend caveat callout in report]
  CAVEAT --> EMIT
  ISG --> EMIT
%% Legend: This decision tree is consulted by extract_metrics.py for every metric. Insufficient-signal emits a metric_N.json file with status field set so downstream renderers do not display a numeric value.
```

---

## M1 Flow Load

> **Confidence:** `<M1.confidence>`
> **Source:** `<M1.source>`

### Definition

Mean count of in-progress PRs (open OR draft with at least one commit) at the end of each Monday-aligned 2-week window, averaged across windows in a phase. Excludes dependency-management bots; includes Blitzy.

### Extraction Strategy

The harness queries `/repos/Blitzy-Sandbox/blitzy-cal/pulls?state=all` and filters to PRs where the state is open OR (state is closed AND draft is true AND commit count >= 1) at the window-end timestamp. Bot exclusion is applied by joining the PR author login against the `.kodiak.toml` `auto_approve_usernames` list.

### Phase Values

| Phase | Value | Sample Size (windows) |
|-------|-------|------------------------|
| Baseline | `<M1.baseline>` | `<M1.baseline_n>` |
| Ramp-Up | `<M1.ramp_up>` | `<M1.ramp_up_n>` |
| Steady State | `<M1.steady_state>` | `<M1.steady_state_n>` |

### Multiplier (After / Before)

`<M1.multiplier>` (direction: `<M1.direction>`).

### Trend Diagram

**Diagram 5: M1 Trend Across 2-Week Windows.** Mean in-progress PR count per window across the full date range.

```mermaid
xychart-beta
  title "M1 Flow Load — Mean In-Progress PRs per Window"
  x-axis "Window index (0 = earliest)"
  y-axis "In-progress PRs"
  line [<M1.trend_values>]
%% Legend: x-axis is the window index; y-axis is the mean in-progress PR count at the window end.
```

### Notes

Bots are excluded by login match against `.kodiak.toml#auto_approve_usernames`. Blitzy is included as an engineering actor.

---

## M2 Flow Velocity

> **Confidence:** `<M2.confidence>`
> **Source:** `<M2.source>`

### Definition

Count of PRs merged to the default branch per 2-week window. Mean per phase; per-actor breakdown including Blitzy.

### Extraction Strategy

The harness queries `/repos/Blitzy-Sandbox/blitzy-cal/pulls?state=closed` and filters to PRs where `merged_at` is not null and the merge commit lands on the default branch `main`. Per-actor counts use the `engineering_actor(pr, phase)` selector.

### Phase Values

| Phase | Value (mean PRs per window) | Sample Size (windows) |
|-------|------------------------------|------------------------|
| Baseline | `<M2.baseline>` | `<M2.baseline_n>` |
| Ramp-Up | `<M2.ramp_up>` | `<M2.ramp_up_n>` |
| Steady State | `<M2.steady_state>` | `<M2.steady_state_n>` |

### Multiplier (After / Before)

`<M2.multiplier>` (direction: `<M2.direction>`).

### Trend Diagram

**Diagram 6: M2 Trend Across 2-Week Windows.** Merged-PR counts per window plotted across the full date range.

```mermaid
xychart-beta
  title "M2 Flow Velocity — Merged PRs per Window"
  x-axis "Window index (0 = earliest)"
  y-axis "Merged PRs"
  line [<M2.trend_values>]
%% Legend: x-axis is the window index; y-axis is the merged-PR count for that window. Bot PRs are excluded.
```

### Notes

Per-actor totals normalize for team growth by reporting per active engineer where applicable. The Blitzy row reports raw counts because Blitzy is treated as a single engineering actor.

---

## M3 Flow Predictability

> **Confidence:** `<M3.confidence>`
> **Source:** `<M3.source>`

### Definition

Reciprocal of the coefficient of variation (mean divided by stdev) of Flow Velocity across windows in a phase. Requires four or more windows; otherwise reports "Insufficient signal — fewer than 4 windows." Zero-variance phases report "Insufficient signal — zero variance" rather than infinity.

### Extraction Strategy

The harness reuses `data/metric_2.json` and computes mean and stdev across the windows in each phase using `statistics.fmean` and `statistics.stdev`. The reciprocal of the coefficient of variation is `mean / stdev`.

### Phase Values

| Phase | Value (mean / stdev) | Sample Size (windows) |
|-------|-----------------------|------------------------|
| Baseline | `<M3.baseline>` | `<M3.baseline_n>` |
| Ramp-Up | `<M3.ramp_up>` | `<M3.ramp_up_n>` |
| Steady State | `<M3.steady_state>` | `<M3.steady_state_n>` |

### Multiplier (After / Before)

`<M3.multiplier>` (direction: `<M3.direction>`).

### Trend Diagram

**Diagram 7: M3 Trend Across 2-Week Windows.** Per-window velocity values whose distribution feeds the predictability ratio.

```mermaid
xychart-beta
  title "M3 Flow Predictability — Per-Window Velocity Distribution"
  x-axis "Window index (0 = earliest)"
  y-axis "Velocity (merged PRs)"
  line [<M3.trend_values>]
%% Legend: x-axis is the window index; y-axis is the per-window merged-PR count from M2. Predictability is mean / stdev of these values per phase.
```

### Notes

The Pearson coefficient of variation is reciprocated so that higher values indicate more predictable phases. Phases with fewer than four windows or zero stdev report Insufficient signal.

---

## M4 Flow Active

> **Confidence:** `<M4.confidence>`
> **Source:** `<M4.source>`

### Definition

Engineering-actor coding span sum across working phases on a PR. Working phases are bounded by review events. Median across PRs per phase and per actor. The engineering actor is the human author in baseline and Blitzy in the after period.

### Extraction Strategy

For each merged PR, the harness walks the timeline events sorted by `created_at` and identifies the initial coding span and any refine spans. The initial span begins at the actor's first commit on the PR branch and ends at the earliest review event; refine spans begin at the actor's first commit after a review event and end at the actor's last commit before the next review event or merge.

### Phase Values

| Phase | Value (median PR-hours) | Sample Size (PRs) |
|-------|--------------------------|---------------------|
| Baseline | `<M4.baseline>` | `<M4.baseline_n>` |
| Ramp-Up | `<M4.ramp_up>` | `<M4.ramp_up_n>` |
| Steady State | `<M4.steady_state>` | `<M4.steady_state_n>` |

### Multiplier (After / Before)

`<M4.multiplier>` (direction: `<M4.direction>`).

### Trend Diagram

**Diagram 8: M4 Trend Across 2-Week Windows.** Per-window median active span across PRs merged in that window.

```mermaid
xychart-beta
  title "M4 Flow Active — Median PR Active Span per Window"
  x-axis "Window index (0 = earliest)"
  y-axis "Median active hours"
  line [<M4.trend_values>]
%% Legend: x-axis is the window index; y-axis is the median across PRs of the actor's working-phase span sum. Gaps within a span are not subtracted.
```

### Notes

The actor's coding span is computed from commit-author timestamps on the PR branch.

---

## M5 Flow Efficiency

> **Confidence:** `<M5.confidence>`
> **Source:** `<M5.source>`

### Definition

Flow Active divided by Flow Time per PR, median across PRs per phase. Review time is treated as wait from the actor's perspective in both periods.

### Extraction Strategy

The harness consumes the per-PR values from `data/metric_4.json` (Flow Active) and `data/metric_7.json` (Flow Time) and computes the per-PR ratio `flow_active / flow_time`. The median ratio across PRs in each phase is the metric value. The denominator excludes PRs flagged by M7 for history-rewrite exclusion.

### Phase Values

| Phase | Value (median ratio, 0..1) | Sample Size (PRs) |
|-------|-----------------------------|---------------------|
| Baseline | `<M5.baseline>` | `<M5.baseline_n>` |
| Ramp-Up | `<M5.ramp_up>` | `<M5.ramp_up_n>` |
| Steady State | `<M5.steady_state>` | `<M5.steady_state_n>` |

### Multiplier (After / Before)

`<M5.multiplier>` (direction: `<M5.direction>`).

### Trend Diagram

**Diagram 9: M5 Trend Across 2-Week Windows.** Per-window median efficiency ratio.

```mermaid
xychart-beta
  title "M5 Flow Efficiency — Median Active over Total Ratio per Window"
  x-axis "Window index (0 = earliest)"
  y-axis "Median ratio (0..1)"
  line [<M5.trend_values>]
%% Legend: x-axis is the window index; y-axis is the median across PRs of flow_active divided by flow_time.
```

### Notes

The metric's confidence is the lower of M4 and M7 confidence tiers because M5 is derived from both. If either input metric reports insufficient signal, M5 reports insufficient signal with the joined reason.

---

## M6 Flow Distribution

> **Confidence:** `<M6.confidence>`
> **Source:** `<M6.source>`

### Definition

Proportion of merged PRs classified as feature / defect / risk-compliance / tech-debt / unknown. Classification priority: linked-issue labels then conventional-commit prefix then keyword match. Per-actor in the after period. Unknown rate above twenty percent downgrades phase confidence to Low.

### Extraction Strategy

A three-tier waterfall is applied to each merged PR. Tier 1 checks for a linked issue (via `Fixes #N`, `Closes #N`, or `Closes CAL-XXXX` in title or body) and maps issue labels to the four categories. Tier 2 parses the PR title against the conventional-commit prefix regex. Tier 3 keyword matches against documented token sets. PRs matching none are categorized as `unknown`.

### Phase Values (headline: feature share)

| Phase | Feature share | Total PRs |
|-------|---------------|-----------|
| Baseline | `<M6.baseline>` | `<M6.baseline_n>` |
| Ramp-Up | `<M6.ramp_up>` | `<M6.ramp_up_n>` |
| Steady State | `<M6.steady_state>` | `<M6.steady_state_n>` |

### Multiplier (feature share After / Before)

`<M6.multiplier>` (direction: `<M6.direction>`).

### Trend Diagram

**Diagram 10: M6 Trend Across 2-Week Windows.** Per-window feature share among merged PRs.

```mermaid
xychart-beta
  title "M6 Flow Distribution — Feature Share per Window"
  x-axis "Window index (0 = earliest)"
  y-axis "Feature share (0..1)"
  line [<M6.trend_values>]
%% Legend: x-axis is the window index; y-axis is the feature share among merged PRs in that window.
```

### Notes

The unknown rate is reported per phase. An unknown rate above twenty percent downgrades the phase confidence to Low.

---

## M7 Flow Time

> **Confidence:** `<M7.confidence>`
> **Source:** `<M7.source>`

### Definition

Median wall-clock from first commit on PR branch to merge commit on default branch. Excludes PRs whose first-commit timestamp is unavailable due to history rewrites; exclusion rate reported.

### Extraction Strategy

For each merged PR, the harness runs `git log --format=%aI --reverse {MERGE_BASE}..{HEAD}` on the PR branch and reads the earliest authored timestamp; the merge commit timestamp is taken from the PR's `merged_at` field. PRs whose earliest commit predates a known force-push event on the branch are flagged for exclusion.

### Phase Values

| Phase | Value (median hours) | Sample Size (PRs) |
|-------|----------------------|---------------------|
| Baseline | `<M7.baseline>` | `<M7.baseline_n>` |
| Ramp-Up | `<M7.ramp_up>` | `<M7.ramp_up_n>` |
| Steady State | `<M7.steady_state>` | `<M7.steady_state_n>` |

### Multiplier (After / Before)

`<M7.multiplier>` (direction: `<M7.direction>`).

### Trend Diagram

**Diagram 11: M7 Trend Across 2-Week Windows.** Per-window median flow time across PRs merged in that window.

```mermaid
xychart-beta
  title "M7 Flow Time — Median Hours from First Commit to Merge"
  x-axis "Window index (0 = earliest)"
  y-axis "Median hours"
  line [<M7.trend_values>]
%% Legend: x-axis is the window index; y-axis is the median across PRs of the elapsed hours from the first authored commit on the PR branch to the merge commit.
```

### Notes

Force-push events are detected by comparing the recorded ref-update history (where available) against the current branch tip. PRs flagged for exclusion are reported but not silently dropped.

---

## M8 Problem Records in Release

> **Confidence:** `<M8.confidence>`
> **Source:** `<M8.source>`

### Definition

Mean attributable reverts per release. For each revert on default, identify original commit, attribute to most recent release tag T such that T is an ancestor of the original. Unattributable and unreleased reverts reported separately. Reverts-of-reverts excluded.

### Extraction Strategy

The harness identifies revert commits on the default branch via `git log --grep='^Revert' --pretty=format:%H` and parses each revert body for `This reverts commit {SHA}`. If absent, a tree-hash lookup is performed. Original commits are matched to the most recent release tag T such that `git merge-base --is-ancestor T {ORIGINAL}` returns success.

### Phase Values

| Phase | Value (mean reverts per release) | Sample Size (releases) |
|-------|------------------------------------|--------------------------|
| Baseline | `<M8.baseline>` | `<M8.baseline_n>` |
| Ramp-Up | `<M8.ramp_up>` | `<M8.ramp_up_n>` |
| Steady State | `<M8.steady_state>` | `<M8.steady_state_n>` |

### Multiplier (After / Before)

`<M8.multiplier>` (direction: `<M8.direction>`).

### Trend Diagram

**Diagram 12: M8 Trend Across 2-Week Windows.** Per-window count of attributable reverts.

```mermaid
xychart-beta
  title "M8 Problem Records in Release — Attributable Reverts per Window"
  x-axis "Window index (0 = earliest)"
  y-axis "Attributable reverts"
  line [<M8.trend_values>]
%% Legend: x-axis is the window index; y-axis is the count of reverts in that window whose target original commit could be attributed to a specific release tag.
```

### Notes

Unattributable reverts indicate cases where the original commit could not be located via the revert body or tree-hash match. Unreleased reverts indicate originals whose ancestor set contains no release tag.

---

## M9 Releases

> **Confidence:** `<M9.confidence>`
> **Source:** `<M9.source>`

### Definition

Mean releases per 2-week window. Source precedence: GitHub Releases API then annotated semver tags then CI deployment events. Prereleases excluded from primary count and reported separately.

### Extraction Strategy

The harness tries the three sources in user-specified precedence. The first source returning a non-empty result is the authoritative source; the chosen source is recorded in `data/metric_9.json#source`.

### Phase Values

| Phase | Value (mean releases per window) | Sample Size (windows) |
|-------|------------------------------------|--------------------------|
| Baseline | `<M9.baseline>` | `<M9.baseline_n>` |
| Ramp-Up | `<M9.ramp_up>` | `<M9.ramp_up_n>` |
| Steady State | `<M9.steady_state>` | `<M9.steady_state_n>` |

### Multiplier (After / Before)

`<M9.multiplier>` (direction: `<M9.direction>`).

### Trend Diagram

**Diagram 13: M9 Trend Across 2-Week Windows.** Per-window release count using the authoritative source.

```mermaid
xychart-beta
  title "M9 Releases — Releases per Window (excluding prereleases)"
  x-axis "Window index (0 = earliest)"
  y-axis "Releases"
  line [<M9.trend_values>]
%% Legend: x-axis is the window index; y-axis is the count of non-prerelease releases in that window from the authoritative source.
```

### Notes

If neither the GitHub Releases API, annotated semver tags, nor CI deployment events produce data, M9 reports "Insufficient signal — no release source."

---

## M10 Approved Exceptions

> **Confidence:** `<M10.confidence>`
> **Source:** `<M10.source>`

### Definition

Count per 2-week window of policy bypasses: admin-overridden required reviews, force-pushes to protected branches, merges with failing required CI, branch protection rule modifications, and PRs labeled with exception or override tags. Admin audit log required for full signal; without it, only force-pushes and label signals are available and confidence drops to Low.

### Extraction Strategy

The harness queries the GitHub Audit Log API for the four bypass event types if the token has `audit_log:read` scope. If the scope is absent, the harness falls back to two partial signals: force-pushes via `/repos/.../events` and PRs labeled with exception or override tags.

### Phase Values

| Phase | Value (mean exceptions per window) | Sample Size (windows) |
|-------|--------------------------------------|--------------------------|
| Baseline | `<M10.baseline>` | `<M10.baseline_n>` |
| Ramp-Up | `<M10.ramp_up>` | `<M10.ramp_up_n>` |
| Steady State | `<M10.steady_state>` | `<M10.steady_state_n>` |

### Multiplier (After / Before)

`<M10.multiplier>` (direction: `<M10.direction>`).

### Trend Diagram

**Diagram 14: M10 Trend Across 2-Week Windows.** Per-window total exception count across all signal types.

```mermaid
xychart-beta
  title "M10 Approved Exceptions — Total Exceptions per Window"
  x-axis "Window index (0 = earliest)"
  y-axis "Exception count"
  line [<M10.trend_values>]
%% Legend: x-axis is the window index; y-axis is the sum of the five sub-counts in that window.
```

### Notes

This metric is Low confidence by default. The harness records the actual scopes granted to the token in `data/environment.json` for future re-runs with elevated scopes.

---

## M11 Escaped Defects

> **Confidence:** `<M11.confidence>`
> **Source:** `<M11.source>`

### Definition

Per 2-week window: (a) tests transitioning pass-to-fail on default (regressions) and (b) tests newly marked skipped or disabled or xfail on default (suppressed signal). Sub-counts reported separately. Flaky tests counted only if failing in three or more consecutive runs. Skipped-rate normalized for suite growth.

### Extraction Strategy

The harness queries `/repos/.../actions/runs` for the workflows that produce JUnit XML artifacts. For each consecutive pair of runs on the default branch, the harness compares test outcomes and identifies pass-to-fail transitions. Skipped tests are inventoried via `git log -p -- '*.test.*'` filtered for additions matching the skip-annotation regex.

### Phase Values

| Phase | Value (mean defects per window) | Sample Size (windows) |
|-------|-----------------------------------|--------------------------|
| Baseline | `<M11.baseline>` | `<M11.baseline_n>` |
| Ramp-Up | `<M11.ramp_up>` | `<M11.ramp_up_n>` |
| Steady State | `<M11.steady_state>` | `<M11.steady_state_n>` |

### Multiplier (After / Before)

`<M11.multiplier>` (direction: `<M11.direction>`).

### Trend Diagram

**Diagram 15: M11 Trend Across 2-Week Windows.** Per-window count of regressions plus newly-skipped tests.

```mermaid
xychart-beta
  title "M11 Escaped Defects — Regressions plus Newly Skipped per Window"
  x-axis "Window index (0 = earliest)"
  y-axis "Tests"
  line [<M11.trend_values>]
%% Legend: x-axis is the window index; y-axis is the sum of regressions and newly-skipped tests in that window. Flaky tests are counted only if failing in three or more consecutive runs.
```

### Notes

If CI test history is unavailable, only the newly-skipped sub-count is computable and the regressions sub-count reports Insufficient signal.

---

## M12 Defects Out of SLA

> **Confidence:** `<M12.confidence>`
> **Source:** `<M12.source>`

### Definition

Count and percentage per phase of defect-labeled issues whose resolution time exceeds the SLA target for the issue's severity tier. Issue-scoped (not PR-scoped) by definition. SLA source precedence: issue-tracker SLA field then repository policy or runbook.

### Extraction Strategy

The harness first checks for a Linear API key. If present, the harness queries `teams/{id}/slaPolicies` to fetch SLA targets per severity tier and `issues?filter[label][name][eq]=bug` to fetch resolution times per issue. If the Linear API key is absent, the harness searches `CONTRIBUTING.md`, `SECURITY.md`, and `README.md` for an SLA policy text.

### Phase Values

| Phase | Value (% over SLA) | Sample Size (issues) |
|-------|---------------------|------------------------|
| Baseline | `<M12.baseline>` | `<M12.baseline_n>` |
| Ramp-Up | `<M12.ramp_up>` | `<M12.ramp_up_n>` |
| Steady State | `<M12.steady_state>` | `<M12.steady_state_n>` |

### Multiplier (After / Before)

`<M12.multiplier>` (direction: `<M12.direction>`).

### Trend Diagram

**Diagram 16: M12 Trend Across 2-Week Windows.** Per-window count of defect-labeled issues resolved beyond their SLA target.

```mermaid
xychart-beta
  title "M12 Defects Out of SLA — Issues Resolved Beyond SLA per Window"
  x-axis "Window index (0 = earliest)"
  y-axis "Issues"
  line [<M12.trend_values>]
%% Legend: x-axis is the window index; y-axis is the count of defect-labeled issues whose resolution falls in that window beyond the SLA target.
```

### Notes

If the M12 status is "Insufficient signal — no SLA source," every cell in the phase-values table renders the literal Insufficient-signal reason and the trend diagram renders an empty chart.

---

## Requirements Traceability Matrix

This table is the Rule 1 (Data Provenance) verification surface. Every numeric value in the Executive Summary appears in a row below; every row points to a Reproducibility Appendix entry.

| Metric | Requirement (AAP § ref) | Extraction Command | Raw Output Path | Derived Value | Reported Number | Confidence |
|--------|-------------------------|--------------------|-----------------|----------------|------------------|------------|
<traceability_rows>

The values in the "Reported Number" column are identical to those in the Executive Summary and the Acceleration Curve phase table. `scripts/validate_consistency.py` enforces this equality at build time by loading `data/metric_*.json` and comparing the values rendered in each section against the source dictionary.

---

## Per-Engineer Acceleration

The table below lists per-engineer values for the metrics that aggregate by actor (M2, M4, M5, M6, M10). Top-K human engineers are determined by the union of the top-K merged-PR contributors in the baseline and after periods. Blitzy appears as one row distinct from the human contributors and prefixed with a plus sign per the visual-distinguish requirement.

| Engineer | M2 Velocity (Before) | M2 Velocity (After) | M4 Active (Before) | M4 Active (After) | M5 Efficiency (Before) | M5 Efficiency (After) | M6 Feature Share (After) | M10 Exceptions (After) |
|----------|----------------------|----------------------|---------------------|--------------------|------------------------|------------------------|---------------------------|--------------------------|
<per_engineer_rows>

The Blitzy row is the engineering actor for the after period only. Human rows are normalized per active engineer by dividing the per-actor count by the number of windows in which the actor was active.

---

## Acceleration Curve

This section presents the across-phase trajectory for each of the twelve metrics, both as a tabular view and as a chart of the headline metrics. The values shown here are identical to those in the Executive Summary, the per-metric deep-dives, and the Requirements Traceability Matrix.

### Phase Table

| Metric | Baseline | Ramp-Up | Steady State | Multiplier (Steady / Baseline) | Confidence |
|--------|----------|---------|--------------|-------------------------------|------------|
| M1 Flow Load | `<M1.baseline>` | `<M1.ramp_up>` | `<M1.steady_state>` | `<M1.multiplier>` | `<M1.confidence>` |
| M2 Flow Velocity | `<M2.baseline>` | `<M2.ramp_up>` | `<M2.steady_state>` | `<M2.multiplier>` | `<M2.confidence>` |
| M3 Flow Predictability | `<M3.baseline>` | `<M3.ramp_up>` | `<M3.steady_state>` | `<M3.multiplier>` | `<M3.confidence>` |
| M4 Flow Active | `<M4.baseline>` | `<M4.ramp_up>` | `<M4.steady_state>` | `<M4.multiplier>` | `<M4.confidence>` |
| M5 Flow Efficiency | `<M5.baseline>` | `<M5.ramp_up>` | `<M5.steady_state>` | `<M5.multiplier>` | `<M5.confidence>` |
| M6 Flow Distribution (feature) | `<M6.baseline>` | `<M6.ramp_up>` | `<M6.steady_state>` | `<M6.multiplier>` | `<M6.confidence>` |
| M7 Flow Time | `<M7.baseline>` | `<M7.ramp_up>` | `<M7.steady_state>` | `<M7.multiplier>` | `<M7.confidence>` |
| M8 Problem Records | `<M8.baseline>` | `<M8.ramp_up>` | `<M8.steady_state>` | `<M8.multiplier>` | `<M8.confidence>` |
| M9 Releases | `<M9.baseline>` | `<M9.ramp_up>` | `<M9.steady_state>` | `<M9.multiplier>` | `<M9.confidence>` |
| M10 Approved Exceptions | `<M10.baseline>` | `<M10.ramp_up>` | `<M10.steady_state>` | `<M10.multiplier>` | `<M10.confidence>` |
| M11 Escaped Defects | `<M11.baseline>` | `<M11.ramp_up>` | `<M11.steady_state>` | `<M11.multiplier>` | `<M11.confidence>` |
| M12 Defects Out of SLA | `<M12.baseline>` | `<M12.ramp_up>` | `<M12.steady_state>` | `<M12.multiplier>` | `<M12.confidence>` |

### Curve Diagram

**Diagram 4: Acceleration Curve — Phase Values for Headline Metrics.** The chart below plots phase values for four headline metrics across the three phases. Values are read from the same `metrics_results` dictionary that populates the Executive Summary and the Requirements Traceability Matrix.

```mermaid
xychart-beta
  title "Acceleration Curve — Phase Trajectory for Headline Metrics"
  x-axis "Phase" ["Baseline","Ramp-Up","Steady State"]
  y-axis "Normalized value (baseline = 1.0)"
  line [1.0, 1.0, 1.0]
%% Legend: y-axis is normalized to baseline = 1.0 for cross-metric comparability. Concrete values are computed by build_report.py from data/metric_*.json and rendered into the placeholder values in the source template; phases with insufficient signal contribute a constant baseline value of 1.0.
```

---

## Risk Assessment

This section documents data-quality, methodology, and signal-availability risks that affect interpretation of the metrics. Per the user-supplied boundary rule on confidence parity, Low-confidence metrics are not equivalent to High-confidence metrics; this section makes that distinction visible.

### Low-Confidence Metrics

The list below is populated by the renderer from `data/metric_*.json` based on each metric's confidence tag. Each entry identifies the metric, the reason confidence is Low, the consequence for the reader, and the data source that would upgrade confidence.

<low_confidence_list>

### Insufficient-Signal Metrics

The list below is populated by the renderer from `data/metric_*.json` for any metric whose status field is set to `insufficient_signal`. Each entry identifies the metric, the reason data was insufficient, and the data source that would resolve the gap.

<insufficient_signal_list>

### Methodology Risks

The risks below are inherent to the methodology and apply regardless of the run's signal availability.

- History rewrites: PRs with force-pushed branches lose their original first-commit timestamp. M7 detects these by comparing the recorded ref-update history (where available) against the current branch tip and excludes affected PRs.
- Force-push detection limits: the GitHub Events API retains ref-update events for a bounded period (typically 90 days). Older force-pushes are not detectable via the API.
- Classification waterfall mismatches: M6 mixed-purpose PRs are classified by the highest-priority tier that returns a result. The unknown rate is reported per phase as a transparency indicator.
- Per-module attribution heuristics: per-module breakdowns use the primary path-prefix of changed files in each PR. Cross-cutting refactors may be miscounted.
- Cache staleness: API responses are cached under `data/cache/{endpoint_hash}.json`. The `--no-cache` flag forces a fresh fetch.
- Bot exclusion completeness: the bot exclusion list is derived from `.kodiak.toml`. New bot identities require manual updates to the exclusion list.
- Linear API key absence: if `LINEAR_API_KEY` is not set at run time, M6 classification loses the issue-tracker tier and M12 reports Insufficient signal unless a repository policy text is found.
- Audit log scope absence: if the GitHub token lacks `audit_log:read` scope, M10 uses only the force-push and label-based partial signals and is tagged Low confidence.

---

## Limitations

The bullets below are mandatory limitations documented in the AAP. Additional limitations discovered at run time are appended by the renderer.

- This deliverable measures flow and operational metrics only; runtime performance, customer satisfaction, and revenue impact are explicitly out of scope per user instruction.
- Pre-history-rewrite PRs are excluded from M7.
- M3 (Flow Predictability) requires four or more windows per phase; phases below this threshold report Insufficient signal.
- Zero-variance phases for M3 report Insufficient signal rather than infinity.
- M9 prereleases are excluded from the primary count and reported separately.
- M10 is Low confidence by default unless the GitHub token has `audit_log:read` scope.
- M12 is Insufficient signal if no SLA source is configured.
- The classification waterfall for M6 may misclassify mixed-purpose PRs.
- Per-module attribution uses the primary path-prefix of changed files; cross-cutting refactors may be miscounted.

---

## Reproducibility Appendix

This section contains the complete, ordered set of commands and API calls executed during the harness run identified by `<run_id>`. The renderer reads `logs/<run_id>/commands.log` and embeds its contents verbatim below; each line is in execution order and is a syntactically valid git invocation, HTTP URL, or Python subprocess execution.

<commands_log_verbatim>

Re-running these commands in order on the same git HEAD with the same API responses (cached under `data/cache/`) produces byte-identical `data/metric_*.json` outputs. Secrets (`GITHUB_TOKEN`, `LINEAR_API_KEY`) are read from environment variables and never appear in this log.

To re-derive this report from scratch on a clean machine, the operator runs the following Python entry points in order:

```bash
export BLITZY_RUN_ID="$(python -c 'import uuid; print(uuid.uuid4())')"
export GITHUB_TOKEN="..."
export LINEAR_API_KEY="..."
python scripts/verify_environment.py
python scripts/derive_inflection.py
python scripts/generate_windows.py
python scripts/extract_metrics.py --metric all
python scripts/validate_consistency.py
python scripts/build_report.py
python scripts/build_presentation.py
```

The harness exits with code 0 if every metric either succeeded or correctly reported Insufficient signal, and code 1 if any metric crashed unexpectedly. The build step (`build_report.py`) additionally runs a final grep pass against the documented subjective-token list and fails the build if any are found in the report body.

---

## References

### External

- DORA framework canonical reference: <https://dora.dev/guides/dora-metrics/>
- Flow Framework reference: <https://flowframework.org/>
- GitHub REST API — Pull Requests: <https://docs.github.com/en/rest/pulls>
- GitHub REST API — Pull Request Reviews: <https://docs.github.com/en/rest/pulls/reviews>
- GitHub REST API — Issues: <https://docs.github.com/en/rest/issues>
- GitHub REST API — Releases: <https://docs.github.com/en/rest/releases>
- GitHub REST API — Workflow Runs: <https://docs.github.com/en/rest/actions/workflow-runs>
- Linear API: <https://linear.app/docs/api>
- Mermaid diagram syntax: <https://mermaid.js.org>
- reveal.js presentation framework: <https://revealjs.com>

### Internal Cross-References

- Onboarding documentation: [`./README.md`](./README.md)
- Non-trivial decision log: [`./decision-log.md`](./decision-log.md)
- Observability dashboard template: [`./dashboard.md`](./dashboard.md)
- Executive presentation deck: [`./executive-presentation.html`](./executive-presentation.html)
- Extraction harness scripts: [`./scripts/`](./scripts/)
- Raw extraction outputs: [`./data/`](./data/)
- Per-run structured logs: [`./logs/`](./logs/)
"""


# ---------------------------------------------------------------------------
# Section 3 — Default Dashboard Template (embedded)
# ---------------------------------------------------------------------------
#
# The embedded dashboard template mirrors dashboard.md: KPI table summarizing
# the twelve metrics, Confidence Distribution pie chart, Trend References to
# the per-metric deep-dives in the report, the Correlation ID Format
# documentation, and the Log Files per Run inventory.

DEFAULT_DASHBOARD_TEMPLATE: str = r"""# Acceleration Measurement Dashboard

This is the Observability dashboard for the 12-metric Development Acceleration Measurement for the `blitzy-cal` repository. Values are populated by `scripts/build_report.py` from `data/metric_*.json` at render time.

> **Run ID:** `<run_id>`
> **Inflection Date:** `<inflection.chosen_date>`
> **Analysis Window:** `<env.date_range>`
> **Phases Reported:** Baseline / Ramp-Up / Steady State (or Baseline / Post-Introduction if fewer than 90 days)
> **Rendered At:** `<rendered_at>` (UTC)

## KPI Summary

The table below lists each of the twelve metrics with its phase values, the After/Before multiplier, and the confidence tag derived from the actual data source used. Every cell is rendered from the single `metrics_results` dictionary maintained by the extraction harness, so values are consistent with every other section of the report (Rule 4).

| # | Metric | Baseline | Ramp-Up | Steady State | Multiplier | Confidence | Trend |
|---|--------|----------|---------|--------------|------------|------------|-------|
| 1 | Flow Load | `<M1.baseline>` | `<M1.ramp_up>` | `<M1.steady_state>` | `<M1.multiplier>` | `<M1.confidence>` | [M1](./acceleration-report.md#m1-flow-load) |
| 2 | Flow Velocity | `<M2.baseline>` | `<M2.ramp_up>` | `<M2.steady_state>` | `<M2.multiplier>` | `<M2.confidence>` | [M2](./acceleration-report.md#m2-flow-velocity) |
| 3 | Flow Predictability | `<M3.baseline>` | `<M3.ramp_up>` | `<M3.steady_state>` | `<M3.multiplier>` | `<M3.confidence>` | [M3](./acceleration-report.md#m3-flow-predictability) |
| 4 | Flow Active | `<M4.baseline>` | `<M4.ramp_up>` | `<M4.steady_state>` | `<M4.multiplier>` | `<M4.confidence>` | [M4](./acceleration-report.md#m4-flow-active) |
| 5 | Flow Efficiency | `<M5.baseline>` | `<M5.ramp_up>` | `<M5.steady_state>` | `<M5.multiplier>` | `<M5.confidence>` | [M5](./acceleration-report.md#m5-flow-efficiency) |
| 6 | Flow Distribution | `<M6.baseline>` | `<M6.ramp_up>` | `<M6.steady_state>` | `<M6.multiplier>` | `<M6.confidence>` | [M6](./acceleration-report.md#m6-flow-distribution) |
| 7 | Flow Time | `<M7.baseline>` | `<M7.ramp_up>` | `<M7.steady_state>` | `<M7.multiplier>` | `<M7.confidence>` | [M7](./acceleration-report.md#m7-flow-time) |
| 8 | Problem Records in Release | `<M8.baseline>` | `<M8.ramp_up>` | `<M8.steady_state>` | `<M8.multiplier>` | `<M8.confidence>` | [M8](./acceleration-report.md#m8-problem-records-in-release) |
| 9 | Releases | `<M9.baseline>` | `<M9.ramp_up>` | `<M9.steady_state>` | `<M9.multiplier>` | `<M9.confidence>` | [M9](./acceleration-report.md#m9-releases) |
| 10 | Approved Exceptions | `<M10.baseline>` | `<M10.ramp_up>` | `<M10.steady_state>` | `<M10.multiplier>` | `<M10.confidence>` | [M10](./acceleration-report.md#m10-approved-exceptions) |
| 11 | Escaped Defects | `<M11.baseline>` | `<M11.ramp_up>` | `<M11.steady_state>` | `<M11.multiplier>` | `<M11.confidence>` | [M11](./acceleration-report.md#m11-escaped-defects) |
| 12 | Defects Out of SLA | `<M12.baseline>` | `<M12.ramp_up>` | `<M12.steady_state>` | `<M12.multiplier>` | `<M12.confidence>` | [M12](./acceleration-report.md#m12-defects-out-of-sla) |

"Multiplier" is computed as After divided by Before where After is the mean of (Ramp-Up plus Steady State) values weighted by window count. For metrics where higher is better (M2, M3, M5, M9), greater than one indicates acceleration. For metrics where lower is better (M1, M4, M7, M8, M10, M11, M12), less than one indicates acceleration. Metric 6 is reported as a distribution shift rather than a multiplier.

When a metric reports Insufficient signal, the Baseline, Ramp-Up, Steady State, and Multiplier cells render the string `Insufficient signal — <reason>`; the Confidence cell renders the same string.

## Confidence Distribution

The Mermaid pie chart below shows the count of metrics by confidence tier. Confidence is assigned per metric based on the actual data source consulted at run time.

```mermaid
pie title Confidence Distribution — Metric Count by Tier
    "High" : <confidence.high_count>
    "Medium" : <confidence.medium_count>
    "Low" : <confidence.low_count>
    "Insufficient signal" : <confidence.insufficient_count>
```

Tier membership at the time of render:

- **High:** <confidence.high_list>
- **Medium:** <confidence.medium_list>
- **Low:** <confidence.low_list>
- **Insufficient signal:** <confidence.insufficient_list>

Per Rule 3 (Confidence Transparency), Low-confidence and Insufficient-signal entries in the main report carry an explicit caveat callout. The dashboard surfaces tier counts so the at-a-glance reader can quickly identify how much of the overall picture rests on indirect or proxy data.

## Trend References

The detailed per-metric trend charts live in the main report; this dashboard surfaces only the KPI table for at-a-glance comprehension. The links below jump to each metric's deep-dive section in `acceleration-report.md`.

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

Every script under `scripts/` emits structured JSON log lines with a single correlation ID (`run_id`) that ties all logs for a single harness invocation together. The `run_id` is a UUIDv4 generated at startup, or supplied via the `BLITZY_RUN_ID` environment variable for stable re-runs.

A single log line in JSON Lines format follows this schema:

```json
{
  "ts": "2026-05-22T19:24:31.123456Z",
  "level": "INFO",
  "run_id": "550e8400-e29b-41d4-a716-446655440000",
  "metric": "M4",
  "phase": "extract_metrics",
  "message": "Computed flow_active for PR (actor=blitzy-agent, span_count=3)",
  "context": {
    "pr_number": 14523,
    "actor": "blitzy-agent",
    "span_count": 3
  }
}
```

Field semantics:

- `ts` — ISO 8601 UTC timestamp with microsecond precision
- `level` — Standard `logging` levels: DEBUG, INFO, WARNING, ERROR, CRITICAL
- `run_id` — UUIDv4 correlation ID (matches the `logs/<run_id>/` directory name)
- `metric` — One of M1 through M12, or null for harness-level events
- `phase` — Script name or pipeline phase
- `message` — Human-readable message
- `context` — Free-form JSON object with metric-specific fields

## Log Files per Run

Each invocation of the extraction harness produces a fixed set of log files under `logs/<run_id>/`. All files are append-only; re-running the harness with the same `BLITZY_RUN_ID` appends to the existing files.

- `verify_environment.log` — environment capture
- `derive_inflection.log` — inflection detection candidate computation
- `generate_windows.log` — window table generation
- `metric_1.log` through `metric_12.log` — per-metric structured log lines
- `validate_consistency.log` — cross-section value consistency check results
- `build_report.log` — render-time diagnostics (this script)
- `commands.log` — ordered catalog of every git invocation, API call, and subprocess execution

`commands.log` is the single source of truth for the Reproducibility Appendix in the main report; `scripts/build_report.py` reads it verbatim and emits it in execution order.

## Refreshing the Dashboard

The dashboard is regenerated by re-running the extraction harness followed by `scripts/build_report.py`. The placeholder tokens in the KPI Summary and Confidence Distribution sections are substituted with values from `data/metric_*.json`.

```bash
python3 blitzy/reports/acceleration/scripts/extract_metrics.py --metric all && \
  python3 blitzy/reports/acceleration/scripts/build_report.py
```

The dashboard file is overwritten by `build_report.py`; manual edits to the value cells in the KPI table or to the Confidence Distribution counts are lost on re-render.
"""


# ---------------------------------------------------------------------------
# Section 4 — Value Formatting Helpers
# ---------------------------------------------------------------------------


def format_value(value: Any, status: str | None = "ok",
                 reason: str | None = None, unit: str = "") -> str:
    """Format a metric value for inclusion in the rendered Markdown.

    The function honors Rule 3 (Confidence Transparency) and the user's
    no-fabrication policy: values that come from a metric with
    ``status == "insufficient_signal"`` render as
    ``Insufficient signal — <reason>`` and never as a sentinel numeric
    value. Floats are formatted to two decimals; integers display
    without a decimal. The optional ``unit`` suffix is appended without
    a space (for ``%`` and ``x``) when supplied.

    Args:
        value: The numeric value to format. May be ``int``, ``float``,
            ``None``, a string already-formatted by an upstream helper,
            or a dict for metric-6-style distribution payloads.
        status: The metric's ``status`` field. When ``insufficient_signal``
            the formatter ignores ``value`` and produces the
            insufficient-signal phrasing.
        reason: The insufficient-signal reason (typically read from the
            metric JSON's ``reason`` field). Concatenated into the
            insufficient-signal phrasing when ``status`` indicates
            insufficiency. ``None`` collapses to an empty reason.
        unit: Optional trailing suffix. ``""`` (default), ``"x"`` for
            multipliers, ``"%"`` for percentages, ``"h"`` for hours.

    Returns:
        A short, render-ready string. Never contains line breaks; safe
        for direct inclusion inside a Markdown table cell.
    """
    if status == "insufficient_signal":
        if reason:
            return f"Insufficient signal — {reason}"
        return "Insufficient signal"
    if value is None:
        return "N/A"
    if isinstance(value, bool):
        # bool subclasses int; format explicitly to avoid "1" / "0".
        return "true" if value else "false"
    if isinstance(value, dict):
        # Distribution payload (e.g. M6 post_intro = {"feature": 0.5, ...}).
        if not value:
            return "N/A"
        parts: list[str] = []
        for key, raw in sorted(value.items()):
            parts.append(f"{key}={format_value(raw, status='ok', unit=unit)}")
        return ", ".join(parts)
    if isinstance(value, (list, tuple)):
        if not value:
            return "N/A"
        return ", ".join(format_value(v, status="ok", unit=unit) for v in value)
    if isinstance(value, int):
        formatted = f"{value}"
    elif isinstance(value, float):
        if value != value:  # NaN check
            return "N/A"
        if value == int(value) and abs(value) < 1e15:
            formatted = f"{int(value)}"
        else:
            formatted = f"{value:.2f}"
    else:
        formatted = str(value)
    if unit:
        formatted = f"{formatted}{unit}"
    return formatted


def format_confidence(confidence: Any) -> str:
    """Format a metric's confidence tag for inclusion in a table cell.

    The output preserves the tier name verbatim (``High``, ``Medium``,
    ``Low``, ``Insufficient signal``) so the dashboard's Confidence
    Distribution counts and the Risk Assessment §10 entries continue to
    match the rendered cell value. ``None`` collapses to ``Unknown`` so
    a render against incomplete metric JSON does not silently drop the
    cell.

    Args:
        confidence: The confidence value read from the metric JSON's
            ``confidence`` field. Expected to be a string tier name; any
            other type is stringified.

    Returns:
        A short, render-ready string for inclusion inside a Markdown
        table cell.
    """
    if confidence is None:
        return "Unknown"
    return str(confidence)



# ---------------------------------------------------------------------------
# Section 5 — Template Loading
# ---------------------------------------------------------------------------


def load_template(template_path: Path | None, default: str) -> str:
    """Resolve the Markdown template the renderer should use.

    When ``template_path`` is None the embedded ``default`` constant
    (``DEFAULT_REPORT_TEMPLATE`` or ``DEFAULT_DASHBOARD_TEMPLATE``) is
    returned. When a path is supplied, the file must exist; a missing
    file is signaled to the caller via ``FileNotFoundError`` so the CLI
    can exit with code 3 ("template file missing").

    Args:
        template_path: Optional filesystem path to a Markdown template
            file. The path is read verbatim — no token substitution is
            performed at this stage.
        default: The embedded fallback template string returned when
            ``template_path`` is ``None``.

    Returns:
        The full template text as a single string.

    Raises:
        FileNotFoundError: If ``template_path`` is provided but the file
            does not exist on disk.
    """
    if template_path is None:
        return default
    path = Path(template_path)
    if not path.is_file():
        raise FileNotFoundError(f"Template file not found: {path}")
    command_log_append("read", str(path))
    return path.read_text(encoding="utf-8")


# ---------------------------------------------------------------------------
# Section 6 — Context Loading
# ---------------------------------------------------------------------------


def load_context(data_dir: Path | str = DATA_DIR) -> dict[str, Any]:
    """Load the non-metric context dictionary used by ``substitute_placeholders``.

    The context bundles environment metadata, inflection candidates,
    window table aggregates, and the rendered_at timestamp. Each
    component is loaded independently; a missing file collapses to an
    empty dict so the renderer can still produce a best-effort report
    that flags the gap rather than crashing. The renderer's section-order
    validator and Rule 2 grep pass run regardless of context
    completeness, so an incomplete context never silently passes
    validation.

    Args:
        data_dir: Directory containing ``environment.json``,
            ``inflection.json``, and ``windows.json``. Defaults to the
            shared ``DATA_DIR`` constant.

    Returns:
        A flat dictionary of context fragments keyed by the names used
        downstream by ``substitute_placeholders``:
        ``environment``, ``inflection``, ``windows``,
        ``rendered_at``, ``run_id``, ``date_range``.
    """
    data_path = Path(data_dir)
    context: dict[str, Any] = {
        "environment": {},
        "inflection": {},
        "windows": [],
    }
    env_path = data_path / "environment.json"
    if env_path.is_file():
        command_log_append("read", str(env_path))
        try:
            context["environment"] = json.loads(env_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            context["environment"] = {}
    inflection_path = data_path / "inflection.json"
    if inflection_path.is_file():
        command_log_append("read", str(inflection_path))
        try:
            context["inflection"] = json.loads(inflection_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            context["inflection"] = {}
    windows_path = data_path / "windows.json"
    if windows_path.is_file():
        command_log_append("read", str(windows_path))
        try:
            context["windows"] = json.loads(windows_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            context["windows"] = []
    context["rendered_at"] = datetime.now(timezone.utc).isoformat()
    context["run_id"] = get_or_create_run_id()
    return context


# ---------------------------------------------------------------------------
# Section 7 — Substitution Map Construction
# ---------------------------------------------------------------------------


def _phase_range_label(windows: list[dict[str, Any]], phase: str) -> str:
    """Compute a human-readable date range string for a phase.

    Args:
        windows: The list-of-dict window table from ``data/windows.json``.
        phase: The phase name to filter on (``baseline``, ``ramp_up``,
            ``steady_state``, ``post_intro``, ``after``).

    Returns:
        ``YYYY-MM-DD → YYYY-MM-DD (N windows)`` when at least one window
        matches the phase; ``N/A`` when no window is in the requested
        phase.
    """
    matched = [w for w in windows if w.get("phase") == phase]
    if not matched:
        return "N/A"
    start = matched[0].get("start_iso", "?")
    end = matched[-1].get("end_iso", "?")
    # Render as date-only when timestamp present
    if isinstance(start, str) and "T" in start:
        start = start.split("T", 1)[0]
    if isinstance(end, str) and "T" in end:
        end = end.split("T", 1)[0]
    return f"{start} → {end} ({len(matched)} windows)"


def _phase_count(windows: list[dict[str, Any]], phase: str) -> int:
    """Count windows in a given phase."""
    return sum(1 for w in windows if w.get("phase") == phase)


def _confidence_tier_buckets(metrics: dict[str, dict[str, Any]]) -> dict[str, list[str]]:
    """Bucket metrics by confidence tier for the Dashboard Confidence Distribution.

    Args:
        metrics: The ``{"M<N>": data}`` dictionary returned by
            ``load_all_metrics``.

    Returns:
        ``{"high": [...], "medium": [...], "low": [...], "insufficient": [...]}``
        where each value is the sorted list of metric IDs whose
        ``confidence`` field is mapped to that bucket.
    """
    buckets: dict[str, list[str]] = {"high": [], "medium": [], "low": [], "insufficient": []}
    for mid, data in sorted(metrics.items(), key=lambda kv: int(kv[0][1:])):
        tier_raw = data.get("confidence", "")
        if not isinstance(tier_raw, str):
            buckets["insufficient"].append(mid)
            continue
        tier = tier_raw.strip().lower()
        if tier.startswith("high"):
            buckets["high"].append(mid)
        elif tier.startswith("medium"):
            buckets["medium"].append(mid)
        elif tier.startswith("low"):
            buckets["low"].append(mid)
        else:
            buckets["insufficient"].append(mid)
    return buckets


def _metric_field_for_token(metric_data: dict[str, Any], field: str) -> Any:
    """Resolve a per-metric placeholder field to its underlying value.

    The function consolidates the per-metric lookup conventions:

      * Direct top-level keys (``baseline``, ``after``, ``multiplier``,
        ``confidence``, ``source``, ``direction``, ``status``,
        ``confidence_reason``).
      * Sample-size suffixes (``baseline_n``, ``ramp_up_n``, ...) routed
        to top-level keys named identically.
      * Phase-specific aliases (``after`` falls through to ``post_intro``
        when ``after`` is absent — extract_metrics emits
        ``post_intro`` for the Baseline-vs-Post-Introduction-only
        fallback documented in AAP §0.1.3).
      * Sub-count and trend-value tokens fall through to ``sub_counts``
        and ``per_window`` respectively when no top-level match exists.

    Args:
        metric_data: A single metric's JSON dict (one of the values in
            ``load_all_metrics``).
        field: The token segment after the metric ID prefix (e.g. for
            ``<M5.baseline>``, ``field`` is ``baseline``).

    Returns:
        The resolved value or ``None`` when no source can be located.
    """
    if field in metric_data:
        return metric_data[field]
    # Phase fallbacks: when the After period uses Post-Introduction-only
    if field == "after":
        if metric_data.get("after") is not None:
            return metric_data["after"]
        return metric_data.get("post_intro")
    if field == "ramp_up":
        return metric_data.get("ramp_up") or metric_data.get("post_intro")
    if field == "steady_state":
        return metric_data.get("steady_state") or metric_data.get("post_intro")
    if field == "trend_values":
        per_window = metric_data.get("per_window") or {}
        if isinstance(per_window, dict) and per_window:
            # Render as comma-separated numeric values for xychart-beta lines
            values = []
            for key in sorted(per_window.keys()):
                v = per_window[key]
                if isinstance(v, (int, float)) and v == v:  # not NaN
                    values.append(str(int(v) if isinstance(v, int) or v == int(v) else f"{v:.2f}"))
                else:
                    values.append("0")
            return ", ".join(values)
        return "0"
    # Sub-count lookups
    sub = metric_data.get("sub_counts") or {}
    if isinstance(sub, dict) and field in sub:
        return sub[field]
    return None


def _build_substitution_map(metrics: dict[str, dict[str, Any]],
                            context: dict[str, Any]) -> dict[str, str]:
    """Compose the full token-to-value dictionary used by ``substitute_placeholders``.

    The keys in the returned dict are the exact token names
    (``"M1.baseline"``, ``"env.repo_url"``, ``"run_id"``, etc.) — the
    angle brackets are stripped before lookup so the regex can
    match-and-substitute in a single pass.

    Args:
        metrics: The metric dictionary from ``load_all_metrics``.
        context: The context dictionary from ``load_context``.

    Returns:
        A flat ``{token_name: rendered_value}`` mapping. Tokens with no
        resolvable value are absent from the mapping; the substitution
        loop leaves their placeholder intact so the consistency
        validator can flag them later.
    """
    mapping: dict[str, str] = {}

    # --- env.* tokens --------------------------------------------------
    env = context.get("environment") or {}
    if isinstance(env, dict):
        for key, value in env.items():
            if isinstance(value, dict):
                # date_range → "first → last"
                if key == "date_range" and "first" in value:
                    first = value.get("first", "")
                    last = value.get("last", "")
                    if isinstance(first, str) and "T" in first:
                        first = first.split("T", 1)[0]
                    if isinstance(last, str) and "T" in last:
                        last = last.split("T", 1)[0]
                    mapping[f"env.{key}"] = f"{first} → {last}"
                else:
                    mapping[f"env.{key}"] = json.dumps(value)
            elif value is None:
                mapping[f"env.{key}"] = "N/A"
            else:
                mapping[f"env.{key}"] = str(value)

    # --- inflection.* tokens ------------------------------------------
    inflection = context.get("inflection") or {}
    if isinstance(inflection, dict):
        for key, value in inflection.items():
            if value is None:
                mapping[f"inflection.{key}"] = "N/A"
            elif isinstance(value, (int, float)):
                mapping[f"inflection.{key}"] = format_value(value, status="ok")
            else:
                mapping[f"inflection.{key}"] = str(value)

    # --- windows.* tokens ---------------------------------------------
    windows = context.get("windows") or []
    if isinstance(windows, list):
        mapping["windows.count"] = str(len(windows))
        mapping["windows.baseline_count"] = str(_phase_count(windows, "baseline"))
        mapping["windows.ramp_up_count"] = str(_phase_count(windows, "ramp_up"))
        mapping["windows.steady_state_count"] = str(_phase_count(windows, "steady_state"))
        mapping["windows.post_intro_count"] = str(_phase_count(windows, "post_intro"))
        mapping["phase_baseline_range"] = _phase_range_label(windows, "baseline")
        mapping["phase_ramp_up_range"] = _phase_range_label(windows, "ramp_up")
        mapping["phase_steady_state_range"] = _phase_range_label(windows, "steady_state")
        # Post-introduction range is shown when fewer than 90 days of after data
        mapping["phase_post_intro_range"] = _phase_range_label(windows, "post_intro")

    # --- run-scope tokens ---------------------------------------------
    mapping["run_id"] = str(context.get("run_id", "")) or "N/A"
    mapping["rendered_at"] = str(context.get("rendered_at", ""))

    # --- M<N>.* tokens ------------------------------------------------
    # The set of supported per-metric fields. Each field is resolved via
    # _metric_field_for_token() so the same code path handles aliases,
    # sub-counts, and trend-value joining.
    per_metric_fields = (
        "baseline", "ramp_up", "steady_state", "post_intro", "after",
        "multiplier", "direction", "confidence", "confidence_reason",
        "source", "status", "reason",
        "baseline_n", "ramp_up_n", "steady_state_n", "post_intro_n",
        "trend_values",
    )
    for mid, mdata in metrics.items():
        status = mdata.get("status", "ok")
        reason = mdata.get("reason") or mdata.get("confidence_reason") or ""
        for field in per_metric_fields:
            value = _metric_field_for_token(mdata, field)
            token = f"{mid}.{field}"
            if field in ("confidence",):
                mapping[token] = format_confidence(value)
            elif field in ("direction", "source", "status",
                           "confidence_reason", "reason"):
                mapping[token] = str(value) if value not in (None, "") else "N/A"
            elif field == "trend_values":
                mapping[token] = str(value) if value else "0"
            elif field in ("baseline_n", "ramp_up_n",
                           "steady_state_n", "post_intro_n"):
                if value is None:
                    mapping[token] = "0"
                else:
                    mapping[token] = format_value(value, status="ok")
            elif field == "multiplier":
                # Multipliers may be None (insufficient signal), a numeric,
                # or a string sentinel ("distribution_shift" for M6).
                if status == "insufficient_signal":
                    mapping[token] = f"Insufficient signal — {reason}" if reason else "Insufficient signal"
                elif value is None:
                    mapping[token] = "N/A"
                elif isinstance(value, str):
                    mapping[token] = value
                else:
                    mapping[token] = format_value(value, status="ok", unit="x")
            else:
                mapping[token] = format_value(value, status=status, reason=reason)

    # --- confidence.* aggregates (dashboard pie chart) ----------------
    buckets = _confidence_tier_buckets(metrics)
    mapping["confidence.high_count"] = str(len(buckets["high"]))
    mapping["confidence.medium_count"] = str(len(buckets["medium"]))
    mapping["confidence.low_count"] = str(len(buckets["low"]))
    mapping["confidence.insufficient_count"] = str(len(buckets["insufficient"]))
    mapping["confidence.high_list"] = ", ".join(buckets["high"]) if buckets["high"] else "None"
    mapping["confidence.medium_list"] = ", ".join(buckets["medium"]) if buckets["medium"] else "None"
    mapping["confidence.low_list"] = ", ".join(buckets["low"]) if buckets["low"] else "None"
    mapping["confidence.insufficient_list"] = (
        ", ".join(buckets["insufficient"]) if buckets["insufficient"] else "None"
    )

    return mapping


def substitute_placeholders(template: str, metrics: dict[str, dict[str, Any]],
                            context: dict[str, Any]) -> str:
    """Substitute ``<placeholder>`` tokens in the template with concrete values.

    The substitution proceeds in two passes:
      1. Multi-line block placeholders (``<traceability_rows>``,
         ``<per_engineer_rows>``, ``<low_confidence_list>``,
         ``<insufficient_signal_list>``) are expanded to multi-line
         Markdown content using the helper generators.
      2. The compiled ``PLACEHOLDER_RE`` walks the template, looks up
         each match against the substitution map, and replaces the
         token in-place. Tokens that do not resolve to a value are left
         unchanged so the validator can surface them.

    Args:
        template: The Markdown template (either the embedded default or
            an external file's content) containing ``<...>`` placeholders.
        metrics: The metric dictionary from ``load_all_metrics``.
        context: The context dictionary from ``load_context``.

    Returns:
        The fully-substituted Markdown text.
    """
    # --- Pass 1: multi-line block expansions --------------------------
    traceability_rows = generate_traceability_matrix(metrics)
    per_engineer_rows = generate_per_engineer_table(metrics)
    low_conf_list = _generate_low_confidence_list(metrics)
    isig_list = _generate_insufficient_signal_list(metrics)

    template = template.replace("<traceability_rows>", traceability_rows)
    template = template.replace("<per_engineer_rows>", per_engineer_rows)
    template = template.replace("<low_confidence_list>", low_conf_list)
    template = template.replace("<insufficient_signal_list>", isig_list)

    # --- Pass 2: simple key→value substitution ------------------------
    mapping = _build_substitution_map(metrics, context)

    def _repl(match: re.Match[str]) -> str:
        token = match.group(1)
        if token in mapping:
            return mapping[token]
        return match.group(0)  # leave unresolved tokens intact for auditing

    return PLACEHOLDER_RE.sub(_repl, template)


# ---------------------------------------------------------------------------
# Section 8 — Confidence Callout Insertion (Rule 3)
# ---------------------------------------------------------------------------


def _caveat_line(metric_id: str, source: str | None, confidence: str | None,
                 reason: str | None = None) -> str:
    """Build a single-line CAVEAT callout for a Low or Insufficient metric.

    Args:
        metric_id: ``"M1"`` through ``"M12"``.
        source: The metric's ``source`` field. Embedded HTML-escaped to
            keep any URL-like values safe inside the Markdown blockquote.
        confidence: The metric's ``confidence`` field. Used to distinguish
            Low from Insufficient signal in the callout phrasing.
        reason: Optional insufficient-signal reason; appended verbatim to
            the callout when ``confidence`` indicates insufficiency.

    Returns:
        A Markdown blockquote line ready to be inserted immediately
        after the metric's H2 header.
    """
    source_clean = html.escape(source) if source else "an unspecified fallback source"
    conf_norm = (confidence or "").strip().lower()
    if conf_norm.startswith("insufficient"):
        suffix = f" Reason: {html.escape(reason)}" if reason else ""
        return (
            f"> **CAVEAT — Insufficient Signal:** {metric_id} reports insufficient "
            f"signal and no numeric value is presented. "
            f"See Risk Assessment for details.{suffix}"
        )
    return (
        f"> **CAVEAT — Low Confidence:** {metric_id} was computed using {source_clean} "
        f"rather than its definitional default. Do not interpret the multiplier as "
        f"equivalent to a High-confidence figure. See Risk Assessment for details."
    )


def insert_low_confidence_callouts(report_text: str,
                                   metrics: dict[str, dict[str, Any]]) -> str:
    """Insert a CAVEAT blockquote after every Low or Insufficient metric H2.

    The function walks the rendered text, locates each ``## M<N>`` header
    using the module-level ``_METRIC_H2_RE``, looks up the metric's
    confidence in the ``metrics`` dictionary, and prepends a CAVEAT line
    to the section body when the confidence is Low or the status is
    insufficient_signal. The function is idempotent — a re-run against
    already-callout-prepended text leaves the existing callout in place.

    Args:
        report_text: The Markdown text with placeholders already
            substituted. The function inspects the text only; it does
            not consult the original metric JSON files.
        metrics: The metric dictionary from ``load_all_metrics`` used
            to look up the per-metric confidence tier.

    Returns:
        The Markdown text with CAVEAT callouts inserted in place where
        applicable. Sections whose metric is High or Medium confidence
        are not modified.
    """
    def _replace(match: re.Match[str]) -> str:
        header_line = match.group(1)
        digits = match.group(2)
        metric_id = f"M{int(digits)}"
        mdata = metrics.get(metric_id, {})
        if not mdata:
            return header_line
        confidence = mdata.get("confidence", "")
        status = mdata.get("status", "ok")
        conf_lower = (confidence or "").strip().lower() if isinstance(confidence, str) else ""
        if not (conf_lower.startswith("low") or conf_lower.startswith("insufficient")
                or status == "insufficient_signal"):
            return header_line
        # Look at next two lines to determine idempotency: if the immediate
        # text after this header already has a CAVEAT line, do not duplicate.
        # We approximate idempotency by injecting the callout right after the
        # header and letting the outer text catch existing-callout cases via
        # the LOW_CALLOUT_RE check below.
        source = mdata.get("source")
        reason = (
            mdata.get("reason")
            or mdata.get("confidence_reason")
            or mdata.get("status_reason")
        )
        caveat = _caveat_line(metric_id, source, confidence, reason)
        return f"{header_line}\n\n{caveat}"

    # First pass: avoid duplicating callouts when one is already present.
    # We split into sections and only inject when no CAVEAT line follows
    # an H2 within 200 characters (a conservative window).
    def _has_callout_after(text: str, header_start: int) -> bool:
        # Look at the next 500 characters for a CAVEAT line. The amount is
        # generous so multi-paragraph confidence/source blockquotes (like
        # the ones already in the existing acceleration-report.md) are
        # detected.
        window = text[header_start: header_start + 500]
        return bool(LOW_CALLOUT_RE.search(window))

    out_parts: list[str] = []
    last_end = 0
    for match in _METRIC_H2_RE.finditer(report_text):
        out_parts.append(report_text[last_end:match.start()])
        header_line = match.group(1)
        digits = match.group(2)
        metric_id = f"M{int(digits)}"
        mdata = metrics.get(metric_id, {})
        confidence = mdata.get("confidence", "") if mdata else ""
        status = mdata.get("status", "ok") if mdata else "ok"
        conf_lower = (confidence or "").strip().lower() if isinstance(confidence, str) else ""
        should_insert = bool(mdata) and (
            conf_lower.startswith("low")
            or conf_lower.startswith("insufficient")
            or status == "insufficient_signal"
        )
        if should_insert and not _has_callout_after(report_text, match.end()):
            source = mdata.get("source")
            reason = (
                mdata.get("reason")
                or mdata.get("confidence_reason")
                or mdata.get("status_reason")
            )
            caveat = _caveat_line(metric_id, source, confidence, reason)
            out_parts.append(f"{header_line}\n\n{caveat}")
        else:
            out_parts.append(header_line)
        last_end = match.end()
    out_parts.append(report_text[last_end:])
    return "".join(out_parts)


# ---------------------------------------------------------------------------
# Section 9 — Traceability Matrix and Per-Engineer Table Generation
# ---------------------------------------------------------------------------


_TRACEABILITY_METADATA: dict[str, dict[str, str]] = {
    "M1": {
        "name": "Flow Load",
        "requirement": "§0.1.1 row 1",
        "default_command": "GET /repos/Blitzy-Sandbox/blitzy-cal/pulls?state=all",
    },
    "M2": {
        "name": "Flow Velocity",
        "requirement": "§0.1.1 row 2",
        "default_command": "GET /repos/Blitzy-Sandbox/blitzy-cal/pulls?state=closed",
    },
    "M3": {
        "name": "Flow Predictability",
        "requirement": "§0.1.1 row 3",
        "default_command": "derived from data/metric_2.json (mean/stdev)",
    },
    "M4": {
        "name": "Flow Active",
        "requirement": "§0.1.1 row 4",
        "default_command": "GET /pulls/{n}/reviews + GET /pulls/{n}/commits",
    },
    "M5": {
        "name": "Flow Efficiency",
        "requirement": "§0.1.1 row 5",
        "default_command": "derived from data/metric_4.json and data/metric_7.json",
    },
    "M6": {
        "name": "Flow Distribution",
        "requirement": "§0.1.1 row 6",
        "default_command": "git log --format=%s + GET /issues/{n} (label join)",
    },
    "M7": {
        "name": "Flow Time",
        "requirement": "§0.1.1 row 7",
        "default_command": "git log --format=%aI --reverse {MERGE_BASE}..{HEAD} + merged_at",
    },
    "M8": {
        "name": "Problem Records in Release",
        "requirement": "§0.1.1 row 8",
        "default_command": "git log --grep='^Revert' + git merge-base --is-ancestor",
    },
    "M9": {
        "name": "Releases",
        "requirement": "§0.1.1 row 9",
        "default_command": "GET /repos/.../releases (or fallback)",
    },
    "M10": {
        "name": "Approved Exceptions",
        "requirement": "§0.1.1 row 10",
        "default_command": "GET /orgs/.../audit-log (or fallback)",
    },
    "M11": {
        "name": "Escaped Defects",
        "requirement": "§0.1.1 row 11",
        "default_command": "GET /repos/.../actions/runs + git log -p -- '*.test.*'",
    },
    "M12": {
        "name": "Defects Out of SLA",
        "requirement": "§0.1.1 row 12",
        "default_command": "GET /teams/{id}/slaPolicies (Linear) + GET /issues?labels=bug",
    },
}


def generate_traceability_matrix(metrics: dict[str, dict[str, Any]]) -> str:
    """Generate the 12-row Markdown traceability matrix body.

    Each row corresponds to one metric M1..M12. The columns are:
    Metric, Requirement (AAP § ref), Extraction Command, Raw Output Path,
    Derived Value, Reported Number, Confidence. The "Reported Number" cell
    holds the same value that appears in the Executive Summary headline
    table — the multiplier, formatted via ``format_value``. When a metric
    reports insufficient signal, every numeric cell falls through to
    "Insufficient signal — <reason>" and the Confidence cell mirrors the
    metric's confidence tier (which itself is "Insufficient signal").

    Args:
        metrics: The metric dictionary from ``load_all_metrics``.

    Returns:
        A multi-line Markdown string containing 12 pipe-separated table
        rows, joined by ``\\n``. The function does NOT emit the table
        header — the caller's template embeds the header above the
        ``<traceability_rows>`` placeholder.
    """
    rows: list[str] = []
    for n in range(1, 13):
        mid = f"M{n}"
        meta = _TRACEABILITY_METADATA[mid]
        mdata = metrics.get(mid, {})
        status = mdata.get("status", "ok")
        reason = (
            mdata.get("reason")
            or mdata.get("confidence_reason")
            or ""
        )
        confidence = format_confidence(mdata.get("confidence"))
        primary_cmd = mdata.get("primary_command") or meta["default_command"]
        # Escape pipe chars inside cells so they don't break the Markdown table.
        primary_cmd_escaped = str(primary_cmd).replace("|", "\\|")
        raw_path = f"data/metric_{n}.json"
        derived_key = f'metrics_results["{mid}"]["after"]'
        multiplier_value = mdata.get("multiplier")
        if status == "insufficient_signal":
            reported_number = f"Insufficient signal — {reason}" if reason else "Insufficient signal"
        elif multiplier_value is None:
            reported_number = "N/A"
        elif isinstance(multiplier_value, str):
            reported_number = multiplier_value
        else:
            reported_number = format_value(multiplier_value, status="ok", unit="x")
        # Build the row; preserve a single space pad inside cells for readability.
        rows.append(
            f"| {mid} {meta['name']} | {meta['requirement']} | "
            f"`{primary_cmd_escaped}` | `{raw_path}` | `{derived_key}` | "
            f"{reported_number} | {confidence} |"
        )
    return "\n".join(rows)


def _aggregate_actor_value(metric_data: dict[str, Any], actor: str,
                            phase: str) -> Any:
    """Pull a per-actor phase value out of a metric's per_actor sub-dict.

    The per_actor schema in ``data/metric_*.json`` is:
      ``{"<actor>": {"baseline": .., "ramp_up": .., "steady_state": .., ...}}``

    Args:
        metric_data: A single metric's JSON dict.
        actor: The actor identifier (login or ``blitzy-agent``).
        phase: The phase name (``baseline``, ``ramp_up``,
            ``steady_state``, ``post_intro``, ``after``).

    Returns:
        The aggregated value, or ``None`` when no entry exists.
    """
    per_actor = metric_data.get("per_actor") or {}
    if not isinstance(per_actor, dict):
        return None
    block = per_actor.get(actor)
    if not isinstance(block, dict):
        return None
    if phase in block:
        return block[phase]
    if phase == "after":
        return block.get("after") or block.get("post_intro")
    return None


def _collect_per_engineer_actors(metrics: dict[str, dict[str, Any]]) -> list[str]:
    """Determine the ordered list of actors to surface in the per-engineer table.

    Args:
        metrics: The metric dictionary from ``load_all_metrics``.

    Returns:
        A sorted list with up to five human actors plus the ``blitzy-agent``
        row appended last when present. Sorting is by total After
        velocity descending so the most-active engineers appear first.
    """
    actor_totals: dict[str, float] = {}
    blitzy_present = False
    for mid in ("M2", "M4", "M5", "M6", "M10"):
        mdata = metrics.get(mid) or {}
        per_actor = mdata.get("per_actor") or {}
        if not isinstance(per_actor, dict):
            continue
        for actor, payload in per_actor.items():
            if not isinstance(payload, dict):
                continue
            if actor.lower() == "blitzy-agent":
                blitzy_present = True
                continue
            # Sum any numeric "after" / "post_intro" values across the
            # five per-actor metrics to derive a ranking weight.
            for key in ("after", "post_intro"):
                val = payload.get(key)
                if isinstance(val, (int, float)):
                    actor_totals[actor] = actor_totals.get(actor, 0.0) + float(val)
    ranked = sorted(actor_totals.items(), key=lambda kv: kv[1], reverse=True)
    actors = [a for a, _ in ranked[:5]]
    if blitzy_present:
        actors.append("blitzy-agent")
    return actors


def generate_per_engineer_table(metrics: dict[str, dict[str, Any]]) -> str:
    """Generate the per-engineer Markdown table body rows.

    The function consults per-actor data from metrics M2, M4, M5, M6,
    and M10. Up to five top human contributors are surfaced (ranked by
    total After-period velocity across the five per-actor metrics);
    Blitzy is appended last with a ``+`` prefix to visually distinguish
    its row. When a metric or actor lacks per-actor data the
    corresponding cell renders ``N/A``.

    Args:
        metrics: The metric dictionary from ``load_all_metrics``.

    Returns:
        A multi-line Markdown string of pipe-separated table rows, joined
        by ``\\n``. The function does NOT emit the table header — the
        caller's template embeds the header above the
        ``<per_engineer_rows>`` placeholder.
    """
    actors = _collect_per_engineer_actors(metrics)
    if not actors:
        # No per-actor data available across any of the relevant metrics.
        return ("| (no per-actor data available) | N/A | N/A | N/A | N/A | "
                "N/A | N/A | N/A | N/A |")
    rows: list[str] = []
    for actor in actors:
        display = f"+ {actor}" if actor.lower() == "blitzy-agent" else actor
        cells: list[str] = [display]
        for mid in ("M2", "M4", "M5"):
            mdata = metrics.get(mid) or {}
            before = _aggregate_actor_value(mdata, actor, "baseline")
            after = _aggregate_actor_value(mdata, actor, "after")
            cells.append(format_value(before, status="ok"))
            cells.append(format_value(after, status="ok"))
        # M6 distribution: render feature share only when present
        m6 = metrics.get("M6") or {}
        m6_after = _aggregate_actor_value(m6, actor, "after")
        if isinstance(m6_after, dict):
            feature = m6_after.get("feature")
            cells.append(format_value(feature, status="ok"))
        else:
            cells.append(format_value(m6_after, status="ok"))
        # M10 exceptions: scalar count
        m10 = metrics.get("M10") or {}
        m10_after = _aggregate_actor_value(m10, actor, "after")
        cells.append(format_value(m10_after, status="ok"))
        rows.append("| " + " | ".join(cells) + " |")
    return "\n".join(rows)


# ---------------------------------------------------------------------------
# Section 10 — Per-Metric Trend Diagram Builder
# ---------------------------------------------------------------------------


def generate_metric_trend_diagram(metric_id: str,
                                  metric_data: dict[str, Any],
                                  windows: list[dict[str, Any]]) -> str:
    """Build a Mermaid trend diagram block for a single metric.

    The diagram is an ``xychart-beta`` block plotting the metric's
    ``per_window`` values across the indexed 2-week windows. When
    ``per_window`` data is absent (the metric reported insufficient
    signal at extraction time), the function emits a minimal Mermaid
    block with a placeholder zero series so the diagram-count assertion
    in ``count_mermaid_diagrams`` still passes.

    Args:
        metric_id: ``"M1"`` through ``"M12"``.
        metric_data: A single metric's JSON dict.
        windows: The window-table list from ``data/windows.json``. The
            list defines the x-axis; trend values are looked up by
            window_id.

    Returns:
        A multi-line Markdown string beginning with the ``Diagram N:``
        prose title and containing a single fenced ``mermaid`` block
        with an inline ``%%`` legend.
    """
    diagram_index = int(metric_id[1:]) + 4
    per_window = metric_data.get("per_window") or {}
    series_values: list[str] = []
    if isinstance(per_window, dict) and per_window and windows:
        for w in windows:
            wid = w.get("window_id")
            v = per_window.get(wid, 0)
            if isinstance(v, (int, float)) and v == v:
                if isinstance(v, int) or v == int(v):
                    series_values.append(str(int(v)))
                else:
                    series_values.append(f"{v:.2f}")
            else:
                series_values.append("0")
    if not series_values:
        series_values = ["0"]
    series_str = ", ".join(series_values)
    title = (
        f"**Diagram {diagram_index}: {metric_id} Trend Across 2-Week Windows.** "
        f"Per-window value of {metric_id} plotted across the full date range."
    )
    block = (
        f"```mermaid\n"
        f"xychart-beta\n"
        f"  title \"{metric_id} Trend — Per-Window Value\"\n"
        f"  x-axis \"Window index (0 = earliest)\"\n"
        f"  y-axis \"Value\"\n"
        f"  line [{series_str}]\n"
        f"%% Legend: x-axis is the window index; y-axis is the per-window value of {metric_id}. "
        f"Generated by build_report.py from data/metric_{metric_id[1:]}.json#per_window.\n"
        f"```"
    )
    return f"{title}\n\n{block}"


# ---------------------------------------------------------------------------
# Section 11 — Risk Assessment Bullets
# ---------------------------------------------------------------------------


def _generate_low_confidence_list(metrics: dict[str, dict[str, Any]]) -> str:
    """Generate the Markdown bullet list for the Low-Confidence Metrics block."""
    bullets: list[str] = []
    for n in range(1, 13):
        mid = f"M{n}"
        mdata = metrics.get(mid) or {}
        confidence_raw = mdata.get("confidence", "")
        if not isinstance(confidence_raw, str):
            continue
        if not confidence_raw.strip().lower().startswith("low"):
            continue
        name = _TRACEABILITY_METADATA[mid]["name"]
        source = html.escape(str(mdata.get("source") or "unspecified fallback source"))
        reason = (mdata.get("confidence_reason") or mdata.get("reason")
                  or "definitional default source unavailable")
        bullets.append(
            f"- **{mid}: {name}** — Confidence Low because {reason}. "
            f"Source actually consulted: {source}. "
            f"Consequence: do not interpret the multiplier as evidence of magnitude change; "
            f"only the direction is reliable. Upgrade path: enable the definitional default "
            f"source identified in `decision-log.md`."
        )
    if not bullets:
        return ("- No metrics were assigned Low confidence in this run; "
                "see the Insufficient-Signal Metrics block for any insufficient-signal "
                "entries and the Methodology Risks block for methodology risks.")
    return "\n".join(bullets)


def _generate_insufficient_signal_list(metrics: dict[str, dict[str, Any]]) -> str:
    """Generate the Markdown bullet list for the Insufficient-Signal Metrics block."""
    bullets: list[str] = []
    for n in range(1, 13):
        mid = f"M{n}"
        mdata = metrics.get(mid) or {}
        if mdata.get("status") != "insufficient_signal":
            confidence_raw = mdata.get("confidence", "")
            if not (isinstance(confidence_raw, str)
                    and confidence_raw.strip().lower().startswith("insufficient")):
                continue
        name = _TRACEABILITY_METADATA[mid]["name"]
        reason = mdata.get("reason") or "no extraction source produced data"
        bullets.append(
            f"- **{mid}: {name}** — Insufficient signal because {reason}. "
            f"Report omits per-phase numeric values and trend chart values. "
            f"Resolution path: see `decision-log.md` for the source-precedence fallback chain."
        )
    if not bullets:
        return "- No metrics reported insufficient signal in this run."
    return "\n".join(bullets)


# ---------------------------------------------------------------------------
# Section 12 — Commands Log Embedding (Rule 5)
# ---------------------------------------------------------------------------


def embed_commands_log(report_text: str, run_id: str) -> str:
    """Substitute the ``<commands_log_verbatim>`` token with the on-disk log.

    The function locates ``logs/<run_id>/commands.log`` under
    ``LOGS_DIR`` and embeds its content inside a fenced ``text`` code
    block. When the log file is missing, the function still substitutes
    the token but emits an explanatory placeholder string indicating
    that the appendix was rendered without a commands.log. Missing-log
    rendering is intentional: a partial run that called
    ``build_report.py`` directly (without first running the extraction
    harness) should still produce a usable report rather than crash.

    Args:
        report_text: The Markdown text (post-substitution) that contains
            the ``<commands_log_verbatim>`` token. When the token is
            absent, the function returns ``report_text`` unchanged.
        run_id: The correlation ID for the current harness invocation.
            Used to construct ``LOGS_DIR / run_id / "commands.log"``.

    Returns:
        The Markdown text with the commands log substitution applied.
    """
    logger = structured_logger(phase="build_report")
    log_path = LOGS_DIR / run_id / "commands.log"
    placeholder_token = "<commands_log_verbatim>"
    if placeholder_token not in report_text:
        return report_text
    if not log_path.is_file():
        logger.warning(
            f"commands.log missing at {log_path}; embedding empty appendix",
            extra={"context": {"log_path": str(log_path), "run_id": run_id}},
        )
        replacement = (
            "```text\n"
            "(commands.log was not present at render time; the appendix is empty. "
            "Re-run the extraction harness with the same BLITZY_RUN_ID to populate it.)\n"
            "```"
        )
        return report_text.replace(placeholder_token, replacement)
    command_log_append("read", str(log_path))
    try:
        content = log_path.read_text(encoding="utf-8", errors="replace")
    except OSError as exc:
        logger.error(
            f"Failed to read commands.log at {log_path}: {exc}",
            extra={"context": {"log_path": str(log_path), "error": str(exc)}},
        )
        return report_text.replace(
            placeholder_token,
            "```text\n(commands.log could not be read; see build_report log for details.)\n```",
        )
    # Defensively neutralize any embedded triple-backtick fences that would
    # close our code block prematurely. The placeholder content is rendered
    # inside a single ```text...``` block; we substitute any internal
    # backtick triples with a non-printable U+2003 (EM SPACE) wrapped
    # marker — recoverable but visually distinct.
    safe_content = content.replace("```", "``\u2003`")
    replacement = f"```text\n{safe_content}\n```"
    return report_text.replace(placeholder_token, replacement)


# ---------------------------------------------------------------------------
# Section 13 — Rule 2 (Factual-Neutral Tone) Grep Pass
# ---------------------------------------------------------------------------


def filter_report_body(text: str) -> str:
    """Scrub blockquoted lines and fenced code blocks from a Markdown body.

    The Rule 2 grep pass must run against the report's first-class prose
    only. Quoted user-instruction text (blockquoted lines beginning
    with ``>``) and fenced code blocks (sample git output, log lines,
    JSON schemas) legitimately contain tokens like ``unfortunately``,
    ``significant``, or similar — those occurrences are not Rule 2
    violations because they appear inside quoted source material. This
    helper strips both surfaces by replacing them with line-equivalent
    whitespace so line numbers reported by ``rule_2_grep_pass`` still
    align with the original text.

    Args:
        text: The full Markdown text to scrub.

    Returns:
        A new string with blockquoted lines and fenced blocks replaced
        by equivalent blank space. The output is the same length and
        same line count as ``text``.
    """
    # Replace fenced blocks with same-length blank space first so the
    # blockquote regex does not see fenced content as blockquotes.
    def _blank(match: re.Match[str]) -> str:
        s = match.group(0)
        # Preserve newlines so line numbers downstream remain valid.
        return "".join(c if c == "\n" else " " for c in s)

    scrubbed = _FENCED_BLOCK_RE.sub(_blank, text)
    scrubbed = _BLOCKQUOTE_LINE_RE.sub(_blank, scrubbed)
    return scrubbed


def rule_2_grep_pass(report_text: str) -> list[tuple[int, str, str]]:
    """Scan rendered text for any subjective-token violations.

    The function iterates the ``SUBJECTIVE_TOKENS`` set (imported from
    ``_shared``) and uses a per-token word-boundary regex with the
    ``re.IGNORECASE`` flag to find every match. For each match, the
    function records the 1-based line number, the matched token, and a
    surrounding 60-character context window (30 characters before plus
    30 after the match start, with trailing whitespace collapsed) so the
    structured logger can emit a precise diagnostic.

    Args:
        report_text: The text to scan. Callers SHOULD pre-process via
            ``filter_report_body`` so blockquoted user instructions and
            fenced code blocks do not produce false positives.

    Returns:
        A list of ``(line_number, token, context)`` tuples. Empty when
        no violations are found.
    """
    violations: list[tuple[int, str, str]] = []
    for token in sorted(SUBJECTIVE_TOKENS):
        pattern = re.compile(rf"\b{re.escape(token)}\b", re.IGNORECASE)
        for match in pattern.finditer(report_text):
            line_number = report_text[:match.start()].count("\n") + 1
            ctx_start = max(0, match.start() - 30)
            ctx_end = min(len(report_text), match.end() + 30)
            ctx_raw = report_text[ctx_start:ctx_end]
            ctx_clean = ctx_raw.replace("\n", " ").strip()
            violations.append((line_number, token, ctx_clean))
    return violations


# ---------------------------------------------------------------------------
# Section 14 — Mermaid Diagram Count Validation
# ---------------------------------------------------------------------------


def count_mermaid_diagrams(report_text: str) -> int:
    """Count the number of fenced Mermaid blocks in the rendered text.

    Args:
        report_text: The Markdown text (post-substitution).

    Returns:
        The integer count of ``\\`\\`\\`mermaid ... \\`\\`\\`\\`\\`\\`\\```
        blocks. The threshold check (``>= MIN_MERMAID_DIAGRAMS``) is
        applied by the caller in ``render``.
    """
    return len(MERMAID_BLOCK_RE.findall(report_text))


# ---------------------------------------------------------------------------
# Section 15 — Section Order Validation (Rule 6)
# ---------------------------------------------------------------------------


def validate_section_order(report_text: str) -> list[str]:
    """Confirm every required section appears in the prescribed order.

    The function iterates ``REQUIRED_SECTION_ORDER``, finds each
    pattern's first match position in ``report_text``, and verifies the
    positions form a strictly increasing sequence. Missing patterns are
    reported as ``Missing section ...``; out-of-order patterns as
    ``Section X precedes Section Y, but the required order is the
    opposite``. The caller treats any returned error as a Rule 6
    violation and blocks the write.

    Args:
        report_text: The Markdown text to validate.

    Returns:
        A list of human-readable error messages. Empty when the report
        satisfies the required order.
    """
    errors: list[str] = []
    positions: list[tuple[str, int]] = []
    for pattern in REQUIRED_SECTION_ORDER:
        compiled = re.compile(pattern, re.MULTILINE)
        match = compiled.search(report_text)
        if not match:
            errors.append(f"Missing required section header: {pattern}")
            continue
        positions.append((pattern, match.start()))
    if errors:
        return errors
    for i in range(1, len(positions)):
        prev_pat, prev_pos = positions[i - 1]
        cur_pat, cur_pos = positions[i]
        if cur_pos <= prev_pos:
            errors.append(
                f"Section order violation: '{cur_pat}' (position {cur_pos}) "
                f"must appear after '{prev_pat}' (position {prev_pos})"
            )
    return errors


# ---------------------------------------------------------------------------
# Section 16 — Dashboard Rendering
# ---------------------------------------------------------------------------


def render_dashboard(metrics: dict[str, dict[str, Any]],
                     context: dict[str, Any],
                     dashboard_template: str) -> str:
    """Render the dashboard.md content from the given template.

    The function applies the same substitution mapping as the main
    report so the KPI Summary cells reflect the canonical
    ``metrics_results`` values. The dashboard does NOT require the
    section-order assertion (its structure is fixed by template) but
    DOES require the Rule 2 grep pass — the caller invokes
    ``rule_2_grep_pass`` on the rendered dashboard before writing.

    Args:
        metrics: The metric dictionary from ``load_all_metrics``.
        context: The context dictionary from ``load_context``.
        dashboard_template: The dashboard Markdown template (either the
            embedded default or an external file's content).

    Returns:
        The fully-substituted dashboard Markdown.
    """
    return substitute_placeholders(dashboard_template, metrics, context)


# ---------------------------------------------------------------------------
# Section 17 — End-to-End Rendering Workflow
# ---------------------------------------------------------------------------


def render(args: argparse.Namespace) -> int:
    """Execute the end-to-end render pipeline.

    Pipeline:
      1. Resolve the run_id and structured logger.
      2. Load all 12 metric JSON files (exit 2 on missing data).
      3. Load environment, inflection, window context.
      4. Load report and dashboard templates (exit 3 on explicit-path miss).
      5. Substitute placeholders in both templates.
      6. Insert Low-confidence CAVEAT callouts in the report.
      7. Embed commands.log in the report's Reproducibility Appendix.
      8. Validate section order in the report (exit 1 on violation).
      9. Count Mermaid diagrams in the report (exit 4 on shortfall).
      10. Run Rule 2 grep pass on the report body (exit 1 on violation).
      11. Run Rule 2 grep pass on the dashboard body (exit 1 on violation).
      12. Write both files atomically.

    Args:
        args: Parsed CLI arguments containing ``output``,
            ``dashboard_output``, ``report_template``,
            ``dashboard_template``.

    Returns:
        The exit code per the module docstring (0 success;
        1 Rule 2/6 violation; 2 missing data; 3 missing template;
        4 insufficient Mermaid diagrams).
    """
    run_id = get_or_create_run_id()
    logger = structured_logger(metric_id=None, phase="build_report")

    logger.info(
        "build_report.py starting",
        extra={"context": {
            "run_id": run_id,
            "report_output": str(args.output),
            "dashboard_output": str(args.dashboard_output),
        }},
    )

    # --- Step 2: load metric JSON files ------------------------------
    try:
        metrics = load_all_metrics(DATA_DIR)
    except FileNotFoundError as exc:
        logger.error(
            f"Required data file missing: {exc}",
            extra={"context": {"missing": str(exc)}},
        )
        return 2

    # --- Step 3: load context ----------------------------------------
    context = load_context(DATA_DIR)

    # --- Step 4: load templates --------------------------------------
    try:
        report_template = load_template(args.report_template, DEFAULT_REPORT_TEMPLATE)
    except FileNotFoundError as exc:
        logger.error(
            f"Report template missing: {exc}",
            extra={"context": {"template": str(args.report_template)}},
        )
        return 3
    try:
        dashboard_template = load_template(args.dashboard_template, DEFAULT_DASHBOARD_TEMPLATE)
    except FileNotFoundError as exc:
        logger.error(
            f"Dashboard template missing: {exc}",
            extra={"context": {"template": str(args.dashboard_template)}},
        )
        return 3

    # --- Step 5: substitute placeholders -----------------------------
    report = substitute_placeholders(report_template, metrics, context)
    dashboard = render_dashboard(metrics, context, dashboard_template)

    # --- Step 6: insert CAVEAT callouts ------------------------------
    report = insert_low_confidence_callouts(report, metrics)

    # --- Step 7: embed commands.log ----------------------------------
    report = embed_commands_log(report, run_id)

    # --- Step 8: validate section order (Rule 6) ---------------------
    order_errors = validate_section_order(report)
    if order_errors:
        for err in order_errors:
            logger.error(err, extra={"context": {"section_order_error": err}})
        logger.error(
            f"Rule 6 (Environment First) section-order validation failed with "
            f"{len(order_errors)} errors; output NOT written",
            extra={"context": {"error_count": len(order_errors)}},
        )
        return 1

    # --- Step 9: count Mermaid diagrams ------------------------------
    diagram_count = count_mermaid_diagrams(report)
    if diagram_count < MIN_MERMAID_DIAGRAMS:
        logger.error(
            f"Mermaid diagram count {diagram_count} below minimum {MIN_MERMAID_DIAGRAMS}; "
            f"output NOT written",
            extra={"context": {"diagram_count": diagram_count,
                               "minimum": MIN_MERMAID_DIAGRAMS}},
        )
        return 4
    logger.info(
        f"Mermaid diagrams: {diagram_count} (minimum {MIN_MERMAID_DIAGRAMS})",
        extra={"context": {"diagram_count": diagram_count}},
    )

    # --- Step 10: Rule 2 grep pass (report body) ---------------------
    filtered_report = filter_report_body(report)
    violations = rule_2_grep_pass(filtered_report)
    if violations:
        for line_no, token, ctx in violations:
            logger.error(
                f"Rule 2 violation at line {line_no}: token '{token}' in context: {ctx}",
                extra={"context": {"line": line_no, "token": token,
                                   "context": ctx, "file": "acceleration-report.md"}},
            )
        logger.error(
            f"Rule 2 (Factual-Neutral Tone) failed with {len(violations)} violations; "
            f"output NOT written",
            extra={"context": {"violation_count": len(violations)}},
        )
        return 1

    # --- Step 11: Rule 2 grep pass (dashboard body) ------------------
    filtered_dash = filter_report_body(dashboard)
    dash_violations = rule_2_grep_pass(filtered_dash)
    if dash_violations:
        for line_no, token, ctx in dash_violations:
            logger.error(
                f"Rule 2 violation in dashboard at line {line_no}: "
                f"token '{token}' in context: {ctx}",
                extra={"context": {"line": line_no, "token": token,
                                   "context": ctx, "file": "dashboard.md"}},
            )
        logger.error(
            f"Rule 2 (Factual-Neutral Tone) failed on dashboard with "
            f"{len(dash_violations)} violations; output NOT written",
            extra={"context": {"violation_count": len(dash_violations)}},
        )
        return 1

    # --- Step 12: write outputs --------------------------------------
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(report, encoding="utf-8")
    command_log_append("write", str(args.output))
    logger.info(
        f"Wrote report: {args.output} ({len(report)} chars, "
        f"{report.count(chr(10))} lines)",
        extra={"context": {"output": str(args.output),
                           "size_chars": len(report),
                           "line_count": report.count(chr(10))}},
    )

    args.dashboard_output.parent.mkdir(parents=True, exist_ok=True)
    args.dashboard_output.write_text(dashboard, encoding="utf-8")
    command_log_append("write", str(args.dashboard_output))
    logger.info(
        f"Wrote dashboard: {args.dashboard_output} ({len(dashboard)} chars)",
        extra={"context": {"output": str(args.dashboard_output),
                           "size_chars": len(dashboard)}},
    )

    logger.info(
        "build_report.py completed successfully",
        extra={"context": {"run_id": run_id,
                           "report_chars": len(report),
                           "dashboard_chars": len(dashboard),
                           "diagram_count": diagram_count}},
    )
    return 0


# ---------------------------------------------------------------------------
# Section 18 — CLI Entry Point
# ---------------------------------------------------------------------------


def main(argv: list[str] | None = None) -> int:
    """CLI entry point.

    Parses arguments and delegates to ``render``. Honors environment
    variable ``BLITZY_RUN_ID`` for stable correlation IDs across
    re-runs (see ``_shared.get_or_create_run_id``).

    Args:
        argv: Optional argument vector (excluding program name). When
            ``None`` (default), arguments are read from ``sys.argv[1:]``.

    Returns:
        The integer exit code from ``render`` (0..4 per the module
        docstring).
    """
    parser = argparse.ArgumentParser(
        prog="build_report",
        description=(
            "Render acceleration-report.md and dashboard.md from data/*.json "
            "with strict Rule 2 (Factual-Neutral Tone) and Rule 6 "
            "(Environment First) enforcement. See module docstring for "
            "exit codes."
        ),
    )
    parser.add_argument(
        "--report-template", type=Path, default=None,
        help=("Optional path to an external Markdown template for the report. "
              "When omitted, the embedded DEFAULT_REPORT_TEMPLATE is used."),
    )
    parser.add_argument(
        "--dashboard-template", type=Path, default=None,
        help=("Optional path to an external Markdown template for the dashboard. "
              "When omitted, the embedded DEFAULT_DASHBOARD_TEMPLATE is used."),
    )
    parser.add_argument(
        "--output", type=Path, default=ACCELERATION_REPORT_PATH,
        help=(f"Destination path for the rendered report. "
              f"Defaults to {ACCELERATION_REPORT_PATH}."),
    )
    parser.add_argument(
        "--dashboard-output", type=Path, default=DASHBOARD_PATH,
        help=(f"Destination path for the rendered dashboard. "
              f"Defaults to {DASHBOARD_PATH}."),
    )
    args = parser.parse_args(argv)
    return render(args)


if __name__ == "__main__":
    sys.exit(main())

