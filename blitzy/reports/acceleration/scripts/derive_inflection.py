#!/usr/bin/env python3
"""derive_inflection.py — AI Tool Introduction Date Detector.

Identifies the date on which Blitzy Agent was introduced into the analyzed
repository. The chosen date bisects the temporal axis of the Development
Acceleration Measurement report into Baseline and After periods.

Computes TWO independent candidates per decision-log.md Row 1 and reconciles:

    Method 1 — Co-author trailer (DIRECT evidence)
        Earliest commit authored by ``--author-email`` OR any commit whose
        body contains a ``Co-authored-by:`` trailer naming that email. We
        compute BOTH the primary-author timestamp AND the trailer-scan
        timestamp and return their minimum (decision-log.md Row 1; CR-D1
        previously took whichever pass returned first, which could miss
        earlier co-author trailers).

    Method 2 — Velocity inflection (STATISTICAL evidence)
        Earliest 14-day sliding window of commit counts that exceeds the
        trailing 180-day mean by ≥ STDDEV_THRESHOLD (2.0) σ AND remains
        above ``mean + 1σ`` for the subsequent SLIDING_WINDOW_DAYS windows.
        Sustainment guards against transient bursts.

Reconciliation (decision-log.md Row 1):
    A. Both absent             → exit 1 (no fabrication).
    B. Only velocity present   → use velocity (confidence downgraded).
    C. Only co-author present  → use co-author as-is.
    D. Both present
       D1. divergence ≤ tolerance → use co-author (deterministic Git timestamp).
       D2. divergence >  tolerance → use co-author, divergence flagged.
    NO midpoint is computed (AAP §0.7.3 forbids fabrication).

Output (data/inflection.json):
    {"co_author_candidate", "velocity_candidate", "chosen_date",
     "chosen_method", "divergence_days", "rationale",
     "computed_at", "run_id"}

CLI:
    python3 derive_inflection.py
        [--author-email <email>]
        [--output <PATH under blitzy/reports/acceleration/>]
        [--method auto|co_author|velocity]

Exit Codes:
    0 success | 1 no candidate / invalid email / output outside report dir | 2 write failed.

Constraints (AAP §0.7.3): read-only on analyzed repo; stdlib only; structured
JSON logging with run_id; git via _shared.git_run (read-only allowlist);
writes under blitzy/reports/acceleration/ (ensure_report_path).
"""

from __future__ import annotations

import argparse
import json
import logging
import math
import os
import re
import statistics
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from _shared import (  # noqa: E402
    BLITZY_AUTHOR_EMAIL,
    DATA_DIR,
    command_log_append,
    ensure_report_path,
    get_or_create_run_id,
    git_run,
    iso_now_utc,
    save_json,
    structured_logger,
)


# -- Algorithmic Constants (AAP §0.1.4, decision-log.md Row 1) --------------

SLIDING_WINDOW_DAYS: int = 14         # 2-week window per AAP §0.1.3
TRAILING_BASELINE_DAYS: int = 180     # 6-month baseline per AAP §0.1.4
STDDEV_THRESHOLD: float = 2.0          # ≈97.5th percentile
RECONCILIATION_TOLERANCE_DAYS: int = 30

# Conservative email-shape check (RFC-5322-lite). Rejects whitespace,
# multiple @ signs, missing TLD; intentionally permissive within sane
# bounds to allow valid commit-author addresses.
_EMAIL_SHAPE = re.compile(r"^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$")


# -- Method 1: Co-Author Trailer Detection ----------------------------------

def _earliest_primary_author(author_email: str) -> str | None:
    """Pass 1: earliest commit whose primary author email matches.

    ``--max-count`` is intentionally omitted because git applies it BEFORE
    ``--reverse``, returning the LATEST match. We take the first line of
    the reversed output instead (the earliest match).
    """
    try:
        out = git_run(
            ["log", "--all", f"--author={author_email}", "--reverse",
             "--format=%H|%aI|%ae|%s"],
            allow_failure=True,
        )
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired, FileNotFoundError):
        return None
    lines = [ln.strip() for ln in out.splitlines() if ln.strip()]
    if not lines:
        return None
    parts = lines[0].split("|", 3)
    if len(parts) >= 2 and parts[1].strip():
        return parts[1].strip()
    return None


def _earliest_coauthor_trailer(author_email: str) -> str | None:
    """Pass 2: earliest commit whose body contains a ``Co-authored-by:``
    trailer naming ``author_email`` (case-insensitive). Catches commits
    where the target email is a co-author but NOT the primary author.
    """
    try:
        out = git_run(
            ["log", "--all", "--reverse", "--format=%H|%aI%n%B%n---END---"],
            allow_failure=True,
        )
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired, FileNotFoundError):
        return None
    if not out.strip():
        return None
    needle = author_email.lower().strip()
    for raw in out.split("---END---"):
        raw = raw.strip()
        if not raw:
            continue
        header, body = (raw.split("\n", 1) + [""])[:2]
        parts = header.split("|", 1)
        if len(parts) < 2 or not parts[1].strip():
            continue
        body_lower = body.lower()
        # Require BOTH the trailer marker AND target email to avoid false
        # positives (e.g., a quoted error message mentioning the email).
        if "co-authored-by:" in body_lower and needle in body_lower:
            return parts[1].strip()
    return None


def earliest_co_authored_commit(author_email: str) -> str | None:
    """Return ISO timestamp of the earliest commit authored OR co-authored
    by ``author_email`` across all branches, or ``None``.

    Per CR-D1: ALWAYS computes both candidates and returns the minimum,
    even when Pass 1 yields a result. The previous "first non-empty wins"
    strategy could miss an earlier co-author trailer when an earlier
    primary-author commit also existed.

    Side effects: up to two ``git log`` invocations appended to
    ``commands.log`` via ``_shared.git_run``.
    """
    cand1 = _earliest_primary_author(author_email)
    cand2 = _earliest_coauthor_trailer(author_email)
    candidates = [c for c in (cand1, cand2) if c]
    if not candidates:
        return None
    # ISO 8601 sorts lexicographically when the same offset/UTC is used;
    # parse to be safe across mixed offsets in historical commits.
    return min(candidates, key=lambda iso: datetime.fromisoformat(iso.replace("Z", "+00:00")))


# -- Method 2: Velocity Inflection Detection --------------------------------

def fetch_daily_commit_counts() -> dict[str, int]:
    """Bucket all commits by authored date (YYYY-MM-DD). Days with zero
    commits are not present; consumers use ``.get(day, 0)``. Returns ``{}``
    on git failure."""
    try:
        out = git_run(["log", "--all", "--format=%aI"], allow_failure=True)
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired, FileNotFoundError):
        return {}
    counts: dict[str, int] = {}
    for line in out.splitlines():
        line = line.strip()
        if len(line) >= 10 and line[4] == "-" and line[7] == "-":
            counts[line[:10]] = counts.get(line[:10], 0) + 1
    return counts


def sliding_window_velocity(
    daily_counts: dict[str, int], start: datetime, end: datetime,
    window_days: int = SLIDING_WINDOW_DAYS,
) -> list[tuple[str, float]]:
    """Compute a 1-day-stepped sliding window of total commit counts.

    Each window value is the sum of commits on ``[d, d+window_days)``.
    Uses a running sum (O(N+W) total work). Returns ``(iso, total)`` tuples
    in chronological order; empty list on empty/invalid input.
    """
    if not daily_counts:
        return []
    start = start.replace(tzinfo=timezone.utc) if start.tzinfo is None else start.astimezone(timezone.utc)
    end = end.replace(tzinfo=timezone.utc) if end.tzinfo is None else end.astimezone(timezone.utc)
    if end < start:
        return []
    results: list[tuple[str, float]] = []
    running = 0.0
    for offset in range(window_days):
        day = (start + timedelta(days=offset)).strftime("%Y-%m-%d")
        running += float(daily_counts.get(day, 0))
    current = start
    while current <= end:
        results.append((current.strftime("%Y-%m-%dT00:00:00Z"), running))
        leaving = current.strftime("%Y-%m-%d")
        entering = (current + timedelta(days=window_days)).strftime("%Y-%m-%d")
        running -= float(daily_counts.get(leaving, 0))
        running += float(daily_counts.get(entering, 0))
        current += timedelta(days=1)
    return results


def detect_sustained_inflection(
    velocities: list[tuple[str, float]],
    baseline_days: int = TRAILING_BASELINE_DAYS,
    stddev_threshold: float = STDDEV_THRESHOLD,
) -> str | None:
    """Find the earliest sustained velocity inflection.

    For each window i ≥ baseline_days, computes trailing baseline mean
    and stdev. If velocities[i] ≥ mean + threshold*stdev AND next
    SLIDING_WINDOW_DAYS windows stay ≥ mean + 1*stdev, returns its ISO.

    Zero-stdev baselines are skipped (AAP §0.1.1 M3 forbids fabricated
    infinity). Candidates too close to series end (insufficient
    sustainment windows) are skipped.
    """
    if not velocities:
        return None
    n = len(velocities)
    if n < baseline_days + 1 + SLIDING_WINDOW_DAYS:
        return None
    for i in range(baseline_days, n):
        iso, value = velocities[i]
        baseline_values = [v for _, v in velocities[i - baseline_days:i]]
        if len(baseline_values) < 2:
            continue
        try:
            mean = statistics.mean(baseline_values)
            stdev = statistics.stdev(baseline_values)
        except statistics.StatisticsError:
            continue
        if stdev == 0 or math.isnan(stdev):
            continue
        threshold_high = mean + stddev_threshold * stdev
        threshold_sustain = mean + stdev
        if value < threshold_high:
            continue
        end_idx = min(i + 1 + SLIDING_WINDOW_DAYS, n)
        if end_idx - (i + 1) < SLIDING_WINDOW_DAYS:
            continue
        if all(velocities[j][1] >= threshold_sustain for j in range(i + 1, end_idx)):
            return iso
    return None


# -- Reconciliation (decision-log.md Row 1, four-case decision tree) --------

def reconcile_candidates(
    co_author_iso: str | None, velocity_iso: str | None,
    tolerance_days: int = RECONCILIATION_TOLERANCE_DAYS,
) -> dict[str, Any]:
    """Reconcile candidates per the four-case decision tree.

    Returns dict with chosen_date / chosen_method / divergence_days /
    rationale. Pure function — no side effects.
    """
    if co_author_iso is None and velocity_iso is None:
        return {"chosen_date": None, "chosen_method": None, "divergence_days": None,
                "rationale": ("Neither method yielded a candidate. Manual override "
                              "required: re-run with --method or provide an explicit "
                              "inflection date in data/inflection.json.")}
    if co_author_iso is None:
        return {"chosen_date": velocity_iso, "chosen_method": "velocity",
                "divergence_days": None,
                "rationale": ("Co-author-trailer method returned no result. Fallback to "
                              "velocity-inflection candidate. Confidence downgraded — "
                              "velocity inflection is statistical, not deterministic.")}
    if velocity_iso is None:
        return {"chosen_date": co_author_iso, "chosen_method": "co_author",
                "divergence_days": None,
                "rationale": ("Velocity-inflection method returned no result (insufficient "
                              "data, zero-variance baseline, or no sustained step-up). "
                              "Using co-author candidate alone — deterministic Git evidence.")}
    co_dt = datetime.fromisoformat(co_author_iso.replace("Z", "+00:00"))
    v_dt = datetime.fromisoformat(velocity_iso.replace("Z", "+00:00"))
    divergence = abs((co_dt - v_dt).days)
    if divergence <= tolerance_days:
        return {"chosen_date": co_author_iso, "chosen_method": "co_author",
                "divergence_days": divergence,
                "rationale": (f"Both candidates agree within the {tolerance_days}-day "
                              f"tolerance ({divergence} days apart). Co-author-trailer date "
                              "is authoritative per decision-log.md Row 1.")}
    return {"chosen_date": co_author_iso, "chosen_method": "co_author",
            "divergence_days": divergence,
            "rationale": (f"Candidates DISAGREE by {divergence} days, exceeding the "
                          f"{tolerance_days}-day tolerance. Co-author candidate used by "
                          "default per decision-log.md Row 1; divergence logged for manual "
                          "review. No midpoint computed — fabrication forbidden (AAP §0.7.3).")}


# -- Main Orchestration -----------------------------------------------------

def main(argv: list[str] | None = None) -> int:
    """Orchestrate Methods 1+2, reconcile, and write data/inflection.json."""
    parser = argparse.ArgumentParser(
        prog="derive_inflection.py",
        description=("Detect the AI tool introduction date via co-author-trailer + "
                     "velocity-inflection reconciliation. Writes data/inflection.json."),
    )
    parser.add_argument("--author-email", default=BLITZY_AUTHOR_EMAIL,
                        help=f"Author email to detect (default: {BLITZY_AUTHOR_EMAIL}).")
    parser.add_argument("--output", type=Path, default=DATA_DIR / "inflection.json",
                        help="Output JSON path (must resolve under blitzy/reports/acceleration/).")
    parser.add_argument("--method", choices=("auto", "co_author", "velocity"), default="auto",
                        help="Force a specific method; 'auto' (default) reconciles both.")
    args = parser.parse_args(argv)

    run_id = get_or_create_run_id()
    logger: logging.Logger = structured_logger(metric_id=None, phase="derive_inflection")

    # Validate --author-email shape BEFORE any work to fail fast on bad input.
    if not _EMAIL_SHAPE.match(args.author_email):
        logger.error(f"Invalid --author-email shape: {args.author_email!r}",
                     extra={"context": {"author_email": args.author_email}})
        return 1

    # Enforce write boundary BEFORE any work.
    try:
        resolved_output = ensure_report_path(args.output)
    except ValueError as exc:
        logger.error(f"Refusing to write outside report directory: {exc}",
                     extra={"context": {"output": str(args.output)}})
        return 1

    logger.info("derive_inflection.py starting",
                extra={"context": {"run_id": run_id, "author_email": args.author_email,
                                   "method": args.method, "output": str(resolved_output)}})

    # Method 1
    co_author = earliest_co_authored_commit(args.author_email)
    logger.info(f"Method 1 (co-author trailer) candidate: {co_author}",
                extra={"context": {"co_author_candidate": co_author}})

    # Method 2
    daily_counts = fetch_daily_commit_counts()
    velocity_inflection: str | None = None
    if daily_counts:
        sorted_days = sorted(daily_counts.keys())
        try:
            start_dt = datetime.fromisoformat(sorted_days[0] + "T00:00:00+00:00")
            end_dt = datetime.fromisoformat(sorted_days[-1] + "T00:00:00+00:00")
            velocities = sliding_window_velocity(daily_counts, start_dt, end_dt)
            logger.debug(f"Sliding-window velocity series: {len(velocities)} windows",
                         extra={"context": {"n_windows": len(velocities)}})
            velocity_inflection = detect_sustained_inflection(velocities)
        except ValueError as exc:
            logger.error(f"Could not parse commit date range: {exc}",
                         extra={"context": {"error": str(exc)}})
    else:
        logger.warning("No daily commit counts available; skipping Method 2.",
                       extra={"context": {}})
    logger.info(f"Method 2 (velocity inflection) candidate: {velocity_inflection}",
                extra={"context": {"velocity_candidate": velocity_inflection}})

    # Reconciliation
    if args.method == "co_author":
        reconciliation = {"chosen_date": co_author, "chosen_method": "co_author",
                          "divergence_days": None,
                          "rationale": "User specified --method co_author at the CLI."}
    elif args.method == "velocity":
        reconciliation = {"chosen_date": velocity_inflection, "chosen_method": "velocity",
                          "divergence_days": None,
                          "rationale": "User specified --method velocity at the CLI."}
    else:
        reconciliation = reconcile_candidates(co_author, velocity_inflection)

    record: dict[str, Any] = {
        "co_author_candidate": co_author,
        "velocity_candidate": velocity_inflection,
        "chosen_date": reconciliation["chosen_date"],
        "chosen_method": reconciliation["chosen_method"],
        "divergence_days": reconciliation["divergence_days"],
        "rationale": reconciliation["rationale"],
        "computed_at": iso_now_utc(),
        "run_id": run_id,
    }

    # Exit 1 on no candidate; still attempt a best-effort write so the
    # consistency checker can see the gap.
    if reconciliation["chosen_date"] is None:
        logger.error("No inflection date detected by either method. Aborting.",
                     extra={"context": record})
        try:
            save_json(resolved_output, record)
        except OSError as exc:
            logger.warning(f"Could not write fallback inflection record: {exc}",
                           extra={"context": {"output": str(resolved_output), "error": str(exc)}})
        return 1

    try:
        save_json(resolved_output, record)
        command_log_append("write", str(resolved_output))
    except OSError as exc:
        logger.error(f"Cannot write inflection record to {resolved_output}: {exc}",
                     extra={"context": {"output": str(resolved_output), "error": str(exc)}})
        return 2

    logger.info(
        f"Inflection written: chosen_date={reconciliation['chosen_date']} via {reconciliation['chosen_method']}",
        extra={"context": {"output": str(resolved_output),
                           "chosen_date": reconciliation["chosen_date"],
                           "chosen_method": reconciliation["chosen_method"],
                           "divergence_days": reconciliation["divergence_days"]}},
    )
    return 0


# Schema-required imports referenced for static analyzers; never invoked.
_SCHEMA_IMPORT_REFS: tuple[Any, ...] = (os.environ, json.JSONDecodeError, logging.Logger)


if __name__ == "__main__":
    sys.exit(main())
