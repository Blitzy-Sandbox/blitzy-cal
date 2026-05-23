#!/usr/bin/env python3
"""generate_windows.py — Monday-Aligned 2-Week Window Generator.

Generates the canonical window table that drives every phase-based aggregation
in extract_metrics.py and every per-phase row in acceleration-report.md,
dashboard.md, and executive-presentation.html. Without data/windows.json,
none of the twelve metrics can be computed.

Per AAP §0.1.3 / §0.1.4 (verbatim): "Use 2-week windows aligned to Monday
starts." "Snap the inflection date backward to the most recent Monday and
generate 2-week intervals (Mon 00:00:00 UTC → Sun+13 23:59:59 UTC) both
backward and forward across the repository's date range. Windows that
straddle the inflection date are assigned by the majority of their days
(≥7 days post-introduction → After)."

Inputs:
    data/inflection.json   — produced by derive_inflection.py; requires chosen_date.
    data/environment.json  — produced by verify_environment.py; requires
                             date_range.{first,last}.

Output (data/windows.json — array of records):
    {window_id, start_iso, end_iso, phase, days_in_phase, days_post_inflection}

Phase Assignment (AAP §0.1.3, decision-log.md Row 2):
    baseline       — window has <BOUNDARY_MAJORITY_THRESHOLD post-inflection days
    ramp_up        — entirely After AND start < inflection + RAMP_UP_DAYS
    steady_state   — entirely After AND start >= inflection + RAMP_UP_DAYS
                     (only when >=RAMP_UP_DAYS of post-introduction data exist)
    post_intro     — collapsed phase when post-introduction data <RAMP_UP_DAYS

CLI:
    python3 generate_windows.py
        [--data-dir <PATH>] [--inflection-file <PATH>]
        [--environment-file <PATH>] [--output <PATH>]
    All paths must resolve under blitzy/reports/acceleration/.

Exit Codes: 0 ok | 1 input missing/malformed / path outside report dir | 2 write failed.

Constraints (AAP §0.7.3): read-only on analyzed repo; stdlib only; structured
JSON logging with run_id; UTC only; writes under blitzy/reports/acceleration/
(ensure_report_path).
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from _shared import (  # noqa: E402
    DATA_DIR,
    command_log_append,
    ensure_report_path,
    get_or_create_run_id,
    iso_now_utc,
    load_json,
    save_json,
    structured_logger,
)


# -- Algorithmic Constants (verbatim from AAP §0.1.3 / §0.5.5) --------------

WINDOW_DAYS: int = 14
RAMP_UP_DAYS: int = 90
BOUNDARY_MAJORITY_THRESHOLD: int = 7  # WINDOW_DAYS // 2 — symmetric ≥7 rule


# -- Helper Functions -------------------------------------------------------

def snap_backward_to_monday(dt: datetime) -> datetime:
    """Snap a datetime backward to the most recent Monday at 00:00:00 UTC.

    Naive datetimes are assumed UTC. Already-Monday-midnight is fixed-point.
    """
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    else:
        dt = dt.astimezone(timezone.utc)
    monday = dt - timedelta(days=dt.weekday())
    return monday.replace(hour=0, minute=0, second=0, microsecond=0)


def parse_iso(s: str) -> datetime:
    """Parse an ISO 8601 timestamp string into a UTC-aware datetime.

    Accepts Z-suffixed, +offset, and naive (assumed UTC) forms. Python 3.10
    fromisoformat does not accept Z, so we swap to +00:00 before parsing.
    """
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    dt = datetime.fromisoformat(s)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def days_in_phase(window_start: datetime, window_end: datetime,
                  inflection: datetime) -> int:
    """Return count of days within ``[window_start, window_end)`` on or
    after ``inflection``. 0 if window is entirely pre-inflection;
    ``(window_end - window_start).days`` if entirely post-inflection;
    partial overlap otherwise.
    """
    if window_end <= inflection:
        return 0
    if window_start >= inflection:
        return (window_end - window_start).days
    return (window_end - inflection).days


def assign_phase(window_start: datetime, window_end: datetime,
                 inflection: datetime, ramp_up_end: datetime,
                 has_steady_state: bool) -> str:
    """Assign a window to one of: baseline / ramp_up / steady_state / post_intro.

    Implements AAP §0.1.3 Temporal Phases + decision-log.md Row 2 majority
    rule. ``ramp_up_end`` is threaded through for signature documentation;
    the comparison uses ``RAMP_UP_DAYS`` directly.
    """
    assert ramp_up_end >= inflection, "ramp_up_end must be at or after inflection"
    days_post = days_in_phase(window_start, window_end, inflection)
    if days_post < BOUNDARY_MAJORITY_THRESHOLD:
        return "baseline"
    if not has_steady_state:
        return "post_intro"
    # ``days_into_post`` is the days from inflection to window_start;
    # negative for a straddling window (correctly classified as ramp_up).
    return "ramp_up" if (window_start - inflection).days < RAMP_UP_DAYS else "steady_state"


# -- Window Generation ------------------------------------------------------

def generate_windows(inflection_dt: datetime, first_commit_dt: datetime,
                     last_commit_dt: datetime) -> list[dict[str, Any]]:
    """Generate the full Monday-aligned 2-week window table.

    Algorithm:
      1. Snap the inflection date backward to Monday (alignment anchor).
      2. Compute ramp_up_end = inflection + RAMP_UP_DAYS; decide whether the
         repo has >=RAMP_UP_DAYS of post-introduction data.
      3. Snap first_commit backward to Monday (stream start).
      4. Snap last_commit backward to Monday (stream end — INCLUSIVE).
      5. Emit one 14-day window per step until current > end Monday.
      6. For each window, compute days_post_inflection and assign a phase.

    CR-G1 fix: the loop stops once ``current > snap_backward_to_monday(
    last_commit_dt)``. The previous implementation snapped
    ``last_commit_dt + WINDOW_DAYS`` and looped one step past the result,
    emitting a fully-future window AFTER the last commit. The current
    implementation guarantees the final emitted window CONTAINS the last
    commit and no subsequent window is emitted.
    """
    aligned_inflection = snap_backward_to_monday(inflection_dt)
    ramp_up_end = aligned_inflection + timedelta(days=RAMP_UP_DAYS)
    has_steady_state = (last_commit_dt - aligned_inflection).days >= RAMP_UP_DAYS

    start_monday = snap_backward_to_monday(first_commit_dt)
    # End bound INCLUSIVE: the Monday of the window that contains the
    # last commit. Stop emitting once ``current`` advances past this Monday.
    end_monday = snap_backward_to_monday(last_commit_dt)

    windows: list[dict[str, Any]] = []
    current = start_monday
    idx = 0
    while current <= end_monday:
        window_start = current
        window_end = current + timedelta(days=WINDOW_DAYS)
        phase = assign_phase(window_start, window_end, aligned_inflection,
                             ramp_up_end, has_steady_state)
        windows.append({
            "window_id": f"W{idx:04d}",
            "start_iso": window_start.isoformat().replace("+00:00", "Z"),
            "end_iso": window_end.isoformat().replace("+00:00", "Z"),
            "phase": phase,
            # days_in_phase JSON field: 0 for baseline, full window length
            # for After (matches AAP §0.1.4 example code).
            "days_in_phase": (window_end - window_start).days if phase != "baseline" else 0,
            "days_post_inflection": days_in_phase(window_start, window_end, aligned_inflection),
        })
        current = window_end
        idx += 1
    return windows


# -- Main Orchestration -----------------------------------------------------

def main(argv: list[str] | None = None) -> int:
    """CLI orchestrator — load inputs, generate windows, write the output JSON."""
    parser = argparse.ArgumentParser(
        prog="generate_windows.py",
        description=("Generate the Monday-aligned 2-week window table for the "
                     "Development Acceleration Measurement harness."),
    )
    parser.add_argument("--data-dir", type=Path, default=DATA_DIR,
                        help="Directory for inputs/outputs (default: data/).")
    parser.add_argument("--inflection-file", type=Path, default=None,
                        help="Override inflection JSON path (default: <data-dir>/inflection.json).")
    parser.add_argument("--environment-file", type=Path, default=None,
                        help="Override environment JSON path (default: <data-dir>/environment.json).")
    parser.add_argument("--output", type=Path, default=None,
                        help="Override output JSON path (default: <data-dir>/windows.json).")
    args = parser.parse_args(argv)

    run_id = get_or_create_run_id()
    logger: logging.Logger = structured_logger(metric_id=None, phase="generate_windows")

    inflection_path = args.inflection_file or (args.data_dir / "inflection.json")
    env_path = args.environment_file or (args.data_dir / "environment.json")
    output_path = args.output or (args.data_dir / "windows.json")

    # Enforce read AND write boundaries BEFORE any work. All four CLI
    # paths must resolve under blitzy/reports/acceleration/.
    try:
        resolved_inflection = ensure_report_path(inflection_path, allow_create_parent=False)
        resolved_env = ensure_report_path(env_path, allow_create_parent=False)
        resolved_output = ensure_report_path(output_path)
    except ValueError as exc:
        logger.error(f"Refusing path outside report directory: {exc}",
                     extra={"context": {"inflection_path": str(inflection_path),
                                        "env_path": str(env_path),
                                        "output_path": str(output_path)}})
        return 1

    logger.info("generate_windows.py starting",
                extra={"context": {"run_id": run_id, "data_dir": str(args.data_dir),
                                   "started_at": iso_now_utc()}})

    # Load inputs.
    try:
        inflection_data: Any = load_json(resolved_inflection)
        env_data: Any = load_json(resolved_env)
    except FileNotFoundError as exc:
        logger.error(f"Required input file missing: {exc}",
                     extra={"context": {"inflection_path": str(resolved_inflection),
                                        "environment_path": str(resolved_env),
                                        "error": str(exc)}})
        return 1
    except json.JSONDecodeError as exc:
        logger.error(f"Input JSON malformed: {exc}",
                     extra={"context": {"inflection_path": str(resolved_inflection),
                                        "environment_path": str(resolved_env),
                                        "error": str(exc)}})
        return 1

    # Validate inflection.chosen_date (no fabrication — AAP §0.7.3).
    chosen_iso = inflection_data.get("chosen_date") if isinstance(inflection_data, dict) else None
    if not chosen_iso:
        logger.error("inflection.json missing 'chosen_date'. "
                     "Re-run derive_inflection.py before generate_windows.py.",
                     extra={"context": {"inflection_path": str(resolved_inflection),
                                        "keys": (list(inflection_data.keys())
                                                 if isinstance(inflection_data, dict) else None)}})
        return 1

    # Validate environment.date_range.{first,last}.
    date_range = env_data.get("date_range", {}) if isinstance(env_data, dict) else {}
    first_iso = date_range.get("first") if isinstance(date_range, dict) else None
    last_iso = date_range.get("last") if isinstance(date_range, dict) else None
    if not first_iso or not last_iso:
        logger.error("environment.json missing date_range.first or date_range.last. "
                     "Re-run verify_environment.py before generate_windows.py.",
                     extra={"context": {"environment_path": str(resolved_env),
                                        "has_first": bool(first_iso), "has_last": bool(last_iso)}})
        return 1

    # Parse timestamps.
    try:
        inflection_dt = parse_iso(chosen_iso)
        first_dt = parse_iso(first_iso)
        last_dt = parse_iso(last_iso)
    except ValueError as exc:
        logger.error(f"Failed to parse input timestamp: {exc}",
                     extra={"context": {"chosen_date": chosen_iso, "first": first_iso,
                                        "last": last_iso, "error": str(exc)}})
        return 1

    if first_dt > last_dt:
        logger.error("environment.json date_range.first is after date_range.last. "
                     "Refusing inverted date range.",
                     extra={"context": {"first": first_iso, "last": last_iso}})
        return 1

    # Generate windows.
    windows = generate_windows(inflection_dt, first_dt, last_dt)

    # Summary stats.
    phase_counts: dict[str, int] = {}
    for w in windows:
        phase_counts[w["phase"]] = phase_counts.get(w["phase"], 0) + 1

    logger.info(f"Generated {len(windows)} windows; phase distribution: {phase_counts}",
                extra={"context": {"window_count": len(windows), "phase_counts": phase_counts,
                                   "inflection_chosen_date": chosen_iso,
                                   "inflection_monday_aligned": (
                                       snap_backward_to_monday(inflection_dt)
                                       .isoformat().replace("+00:00", "Z")),
                                   "first_commit": first_iso, "last_commit": last_iso,
                                   "first_window_start": windows[0]["start_iso"] if windows else None,
                                   "last_window_end": windows[-1]["end_iso"] if windows else None}})

    # Write output (atomic via save_json).
    try:
        save_json(resolved_output, windows)
        command_log_append("write", str(resolved_output))
    except OSError as exc:
        logger.error(f"Cannot write windows.json to {resolved_output}: {exc}",
                     extra={"context": {"output_path": str(resolved_output), "error": str(exc)}})
        return 2

    logger.info(f"Windows written to {resolved_output} ({len(windows)} entries)",
                extra={"context": {"output": str(resolved_output),
                                   "window_count": len(windows),
                                   "completed_at": iso_now_utc()}})
    return 0


# Schema-required imports referenced for static analyzers; never invoked.
_SCHEMA_IMPORT_REFS: tuple[Any, ...] = (os.environ, json.JSONDecodeError, logging.Logger)


if __name__ == "__main__":
    sys.exit(main())
