#!/usr/bin/env python3
"""
derive_inflection.py — AI Tool Introduction Date Detector

Identifies the date on which Blitzy Agent (the AI engineering tool under
measurement) was introduced into the analyzed repository. The chosen date
bisects the temporal axis of the Development Acceleration Measurement report
into Baseline and After periods.

Computes TWO independent candidates per decision-log.md Row 1 and reconciles
them:

    Method 1 — Co-author trailer (DIRECT evidence): earliest commit authored
    by ``agent@blitzy.com`` OR any commit whose body contains a
    ``Co-authored-by`` trailer naming the Blitzy email. A single
    deterministic Git timestamp; no statistics involved.

    Method 2 — Velocity inflection (STATISTICAL evidence): earliest 14-day
    sliding window of commit counts whose value exceeds the trailing 180-day
    mean by ≥ ``STDDEV_THRESHOLD`` (2.0) sigma AND remains above
    ``mean + 1σ`` for the subsequent 14 consecutive windows. Sustainment
    guards against transient bursts.

Reconciliation (decision-log.md Row 1):
    1. Both candidates present AND within ``RECONCILIATION_TOLERANCE_DAYS``
       (30) of each other → co-author wins (deterministic Git timestamp).
    2. Both present but divergent → both reported; co-author used by default;
       divergence flagged. NO MIDPOINT IS COMPUTED (AAP §0.7.3 forbids
       fabrication).
    3. Only co-author present → used as-is.
    4. Only velocity present → used with confidence downgraded in rationale.
    5. Neither present → exit 1.

Output: data/inflection.json
    {
        "co_author_candidate":  ISO | null,
        "velocity_candidate":   ISO | null,
        "chosen_date":          ISO,
        "chosen_method":        "co_author" | "velocity",
        "divergence_days":      int | null,
        "rationale":            str,
        "computed_at":          ISO,
        "run_id":               str
    }

CLI:
    python3 derive_inflection.py
        [--author-email agent@blitzy.com]
        [--output blitzy/reports/acceleration/data/inflection.json]
        [--method auto|co_author|velocity]

Exit codes:
    0  Success — inflection detected and written.
    1  Neither method yielded a candidate.
    2  Output file could not be written.

Constraints (AAP §0.7.3):
    - READ-ONLY on the analyzed repository (only ``git log`` queries).
    - NO FABRICATION (gaps reported; no synthesized dates).
    - PYTHON 3.10+ STDLIB ONLY.
    - STRUCTURED LOGGING via ``_shared.structured_logger`` with run_id.
    - REPRODUCIBILITY via ``commands.log`` (Rule 5).
"""

from __future__ import annotations

import argparse
import json
import logging
import math
import os
import statistics
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

# Bootstrap sibling ``_shared`` module onto sys.path. The guard avoids
# duplicate entries on repeated imports (e.g., during pytest collection).
SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from _shared import (  # noqa: E402 — must follow sys.path mutation
    BLITZY_AUTHOR_EMAIL,
    DATA_DIR,
    command_log_append,
    get_or_create_run_id,
    git_run,
    iso_now_utc,
    save_json,
    structured_logger,
)


# ---------------------------------------------------------------------------
# Section 1 — Algorithmic Constants (AAP §0.1.4, decision-log.md Row 1)
# ---------------------------------------------------------------------------

SLIDING_WINDOW_DAYS: int = 14
"""Length in days of each sliding window of commit counts (AAP §0.1.3
2-week windows). Step is 1 day; adjacent windows share 13 days.
"""

TRAILING_BASELINE_DAYS: int = 180
"""Length in days of the trailing baseline that defines "normal" velocity
for the inflection comparison (AAP §0.1.4 6-month baseline). Yields 180
samples per candidate window — enough for stable mean/stdev.
"""

STDDEV_THRESHOLD: float = 2.0
"""Sigma multiplier above the baseline mean that a candidate window must
exceed to qualify as an inflection (AAP §0.1.4). 2σ ≈ 97.5th percentile.
"""

RECONCILIATION_TOLERANCE_DAYS: int = 30
"""Maximum day-count divergence between the two candidates while still
treated as "agreeing" (AAP §0.1.4). The tolerance accommodates the
natural LAG of velocity behind the first Blitzy commit during exploratory
adoption.
"""


# ---------------------------------------------------------------------------
# Section 2 — Method 1: Co-Author Trailer Detection
# ---------------------------------------------------------------------------


def earliest_co_authored_commit(author_email: str) -> str | None:
    """Return the ISO timestamp of the earliest commit authored or
    co-authored by ``author_email`` across all branches, or ``None``.

    Two-pass strategy; first non-empty result wins:

      Pass 1 — ``git log --author=<email> --reverse`` catches commits where
               the email is the PRIMARY author. We take the FIRST line of
               output (the earliest commit under ``--reverse``). The
               ``--max-count`` flag is intentionally NOT used because git
               applies ``--max-count`` BEFORE ``--reverse`` (a documented
               quirk: ``--max-count`` selects the latest N commits, then
               ``--reverse`` flips that subset — yielding the LATEST
               commit when N=1, not the earliest).

      Pass 2 — Full-history body scan parses every commit's body for a
               ``Co-authored-by:`` trailer naming the target email.
               Catches commits where Blitzy is a co-author but not the
               primary author. Case-insensitive.

    Args:
        author_email: Email address to search for (typically
            ``BLITZY_AUTHOR_EMAIL``).

    Returns:
        ISO 8601 timestamp (e.g. ``"2026-02-25T00:24:31Z"``) of the
        earliest match, or ``None``.

    Side effects:
        Up to two ``git log`` invocations are appended to
        ``logs/<run_id>/commands.log`` via ``_shared.git_run``.
    """
    # Pass 1 — ``--author=<email>`` substring filter on author identity.
    # NOTE: ``--max-count`` is deliberately omitted; combining it with
    # ``--reverse`` returns the LATEST matching commit, not the earliest
    # (see docstring "Two-pass strategy" for the git quirk explanation).
    # We take the FIRST line of the reversed output instead, which is
    # the earliest match.
    try:
        out = git_run(
            [
                "log",
                "--all",
                f"--author={author_email}",
                "--reverse",
                "--format=%H|%aI|%ae|%s",
            ],
            allow_failure=True,
        )
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired, FileNotFoundError):
        out = ""

    line = out.strip().splitlines()[0] if out.strip() else ""
    if line:
        parts = line.split("|", 3)
        # Format: SHA|ISO|EMAIL|SUBJECT — field 1 is the authored ISO.
        if len(parts) >= 2 and parts[1].strip():
            return parts[1].strip()

    # Pass 2 — Body scan for ``Co-authored-by:`` trailers. The ``---END---``
    # sentinel separates commits whose bodies may contain arbitrary
    # newlines and pipe characters.
    try:
        out = git_run(
            ["log", "--all", "--reverse", "--format=%H|%aI%n%B%n---END---"],
            allow_failure=True,
        )
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired, FileNotFoundError):
        return None

    if not out.strip():
        return None

    needle_email = author_email.lower().strip()
    co_authored_marker = "co-authored-by:"

    for raw in out.split("---END---"):
        raw = raw.strip()
        if not raw:
            continue
        if "\n" in raw:
            header, body = raw.split("\n", 1)
        else:
            header, body = raw, ""
        parts = header.split("|", 1)
        if len(parts) < 2:
            continue
        iso_timestamp = parts[1].strip()
        if not iso_timestamp:
            continue

        # Require BOTH the trailer marker AND the target email to avoid
        # false positives (e.g., a quoted error message mentioning the email).
        body_lower = body.lower()
        if co_authored_marker in body_lower and needle_email in body_lower:
            return iso_timestamp

    return None


# ---------------------------------------------------------------------------
# Section 3 — Method 2: Velocity Inflection Detection
# ---------------------------------------------------------------------------


def fetch_daily_commit_counts() -> dict[str, int]:
    """Bucket all repository commits by authored date.

    Returns:
        Dict mapping ``"YYYY-MM-DD"`` to commit count for that day. Days
        with zero commits are NOT present; consumers use ``.get(day, 0)``.
        Returns ``{}`` if the repository has no commits or git fails.

    Side effects:
        One ``git log --all --format=%aI`` invocation is appended to
        ``logs/<run_id>/commands.log`` via ``_shared.git_run``.

    Notes:
        Uses the first 10 chars of each ``%aI`` ISO timestamp as the date
        in the AUTHOR's local timezone. Development cadence is naturally
        tied to local time-of-day; UTC normalization is not applied here.
    """
    try:
        out = git_run(["log", "--all", "--format=%aI"], allow_failure=True)
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired, FileNotFoundError):
        return {}

    counts: dict[str, int] = {}
    for line in out.splitlines():
        line = line.strip()
        if not line:
            continue
        day = line[:10]
        # Validate YYYY-MM-DD shape before bucketing.
        if len(day) == 10 and day[4] == "-" and day[7] == "-":
            counts[day] = counts.get(day, 0) + 1
    return counts


def sliding_window_velocity(
    daily_counts: dict[str, int],
    start: datetime,
    end: datetime,
    window_days: int = SLIDING_WINDOW_DAYS,
) -> list[tuple[str, float]]:
    """Compute a 1-day-stepped sliding window of total commit counts.

    For each calendar day ``d`` in ``[start, end]`` the window value is
    the sum of commits on days ``[d, d + window_days)``. Implementation
    uses a running sum (O(N + W) total work) for efficiency on multi-year
    histories.

    Args:
        daily_counts: Output of ``fetch_daily_commit_counts``.
        start: First window-start datetime; naive datetimes are treated
            as UTC.
        end: Last window-start datetime; the final window covers
            ``[end, end + window_days)``.
        window_days: Window length in days (default
            ``SLIDING_WINDOW_DAYS``).

    Returns:
        List of ``(window_start_iso, total_commits)`` tuples in
        chronological order. Empty list if input is empty or invalid.

    Notes:
        Days outside ``daily_counts`` contribute 0 (no interpolation per
        AAP). Returns ``float`` values so downstream ``statistics`` calls
        receive a uniform numeric type.
    """
    if not daily_counts:
        return []

    if start.tzinfo is None:
        start = start.replace(tzinfo=timezone.utc)
    else:
        start = start.astimezone(timezone.utc)
    if end.tzinfo is None:
        end = end.replace(tzinfo=timezone.utc)
    else:
        end = end.astimezone(timezone.utc)

    if end < start:
        return []

    results: list[tuple[str, float]] = []

    # Initialize running sum for the first window [start, start + W).
    running: float = 0.0
    for offset in range(window_days):
        day = start + timedelta(days=offset)
        running += float(daily_counts.get(day.strftime("%Y-%m-%d"), 0))

    current = start
    while current <= end:
        results.append((current.strftime("%Y-%m-%dT00:00:00Z"), running))
        # Slide forward 1 day: subtract leaving day, add entering day.
        leaving = current.strftime("%Y-%m-%d")
        entering = (current + timedelta(days=window_days)).strftime("%Y-%m-%d")
        running -= float(daily_counts.get(leaving, 0))
        running += float(daily_counts.get(entering, 0))
        current = current + timedelta(days=1)

    return results


def detect_sustained_inflection(
    velocities: list[tuple[str, float]],
    baseline_days: int = TRAILING_BASELINE_DAYS,
    stddev_threshold: float = STDDEV_THRESHOLD,
) -> str | None:
    """Find the earliest sustained velocity inflection.

    For each window i ≥ ``baseline_days``, computes the trailing baseline
    mean and stdev over windows ``[i - baseline_days, i)``. If
    ``velocities[i] ≥ mean + stddev_threshold * stdev`` AND the next
    ``SLIDING_WINDOW_DAYS`` consecutive windows all remain ≥
    ``mean + 1*stdev``, returns that window's ISO timestamp.

    Args:
        velocities: Output of ``sliding_window_velocity``.
        baseline_days: Number of trailing windows forming the baseline
            (default ``TRAILING_BASELINE_DAYS``).
        stddev_threshold: σ multiplier above baseline mean (default
            ``STDDEV_THRESHOLD``).

    Returns:
        ISO timestamp of the earliest sustained inflection, or ``None``.

    Notes:
        Zero-stdev baselines are SKIPPED rather than treated as infinite
        sigma — AAP §0.1.1 Metric 3 forbids fabricated infinity.
        ``statistics.StatisticsError`` is caught and treated as a skipped
        window. Candidates too close to the end of the series
        (insufficient sustainment windows available) are skipped.
    """
    if not velocities:
        return None

    n = len(velocities)
    min_required = baseline_days + 1 + SLIDING_WINDOW_DAYS
    if n < min_required:
        return None

    for i in range(baseline_days, n):
        iso, value = velocities[i]

        baseline_values = [v for _, v in velocities[i - baseline_days:i]]
        if len(baseline_values) < 2:
            continue

        try:
            baseline_mean = statistics.mean(baseline_values)
            baseline_stdev = statistics.stdev(baseline_values)
        except statistics.StatisticsError:
            continue

        if baseline_stdev == 0 or math.isnan(baseline_stdev):
            continue

        threshold_high = baseline_mean + stddev_threshold * baseline_stdev
        threshold_sustain = baseline_mean + 1.0 * baseline_stdev

        if value < threshold_high:
            continue

        # Candidate crosses the strict threshold. Verify sustainment.
        end_idx = min(i + 1 + SLIDING_WINDOW_DAYS, n)

        # Insufficient remaining windows to verify sustainment → skip.
        if end_idx - (i + 1) < SLIDING_WINDOW_DAYS:
            continue

        sustained = True
        for j in range(i + 1, end_idx):
            _, future_v = velocities[j]
            if future_v < threshold_sustain:
                sustained = False
                break

        if sustained:
            return iso

    return None


# ---------------------------------------------------------------------------
# Section 4 — Reconciliation (decision-log.md Row 1, four-case decision tree)
# ---------------------------------------------------------------------------


def reconcile_candidates(
    co_author_iso: str | None,
    velocity_iso: str | None,
    tolerance_days: int = RECONCILIATION_TOLERANCE_DAYS,
) -> dict[str, Any]:
    """Reconcile co-author and velocity candidates per the four-case decision tree.

    Cases:
        A. Both absent             → chosen_date=None
        B. Only velocity present   → use velocity, downgrade confidence
        C. Only co-author present  → use co-author as-is
        D. Both present
           D1. divergence ≤ tolerance → use co-author (more precise)
           D2. divergence >  tolerance → use co-author, flag divergence

    Args:
        co_author_iso: ISO timestamp from Method 1 or ``None``.
        velocity_iso: ISO timestamp from Method 2 or ``None``.
        tolerance_days: Maximum acceptable divergence (default
            ``RECONCILIATION_TOLERANCE_DAYS``).

    Returns:
        Dict with keys ``chosen_date``, ``chosen_method``,
        ``divergence_days``, ``rationale``.

    Notes:
        Pure function — no side effects; directly unit-testable. ISO
        timestamps are parsed via ``datetime.fromisoformat`` after
        normalizing trailing ``"Z"`` to ``"+00:00"`` for pre-3.11
        compatibility. ``divergence_days`` is the non-negative absolute
        difference (directional sign is uninformative).
    """
    # Case A — both absent.
    if co_author_iso is None and velocity_iso is None:
        return {
            "chosen_date": None,
            "chosen_method": None,
            "divergence_days": None,
            "rationale": (
                "Neither method yielded a candidate. Both insufficient — "
                "manual override required. Re-run with --method or provide "
                "an explicit inflection date in data/inflection.json."
            ),
        }

    # Case B — only velocity present.
    if co_author_iso is None:
        return {
            "chosen_date": velocity_iso,
            "chosen_method": "velocity",
            "divergence_days": None,
            "rationale": (
                "Co-author-trailer method returned no result. Fallback to "
                "velocity-inflection candidate. Confidence downgraded — "
                "velocity inflection is statistical, not deterministic."
            ),
        }

    # Case C — only co-author present.
    if velocity_iso is None:
        return {
            "chosen_date": co_author_iso,
            "chosen_method": "co_author",
            "divergence_days": None,
            "rationale": (
                "Velocity-inflection method returned no result (insufficient "
                "data, zero-variance baseline, or no sustained step-up). "
                "Using co-author candidate alone — deterministic Git "
                "evidence requires no statistical cross-check."
            ),
        }

    # Case D — both present; compute divergence and select.
    co_dt = datetime.fromisoformat(co_author_iso.replace("Z", "+00:00"))
    v_dt = datetime.fromisoformat(velocity_iso.replace("Z", "+00:00"))
    divergence = abs((co_dt - v_dt).days)

    if divergence <= tolerance_days:
        return {
            "chosen_date": co_author_iso,
            "chosen_method": "co_author",
            "divergence_days": divergence,
            "rationale": (
                f"Both candidates agree within the {tolerance_days}-day "
                f"reconciliation tolerance ({divergence} days apart). "
                "Co-author-trailer date is authoritative per "
                "decision-log.md Row 1 — single deterministic Git timestamp."
            ),
        }

    return {
        "chosen_date": co_author_iso,
        "chosen_method": "co_author",
        "divergence_days": divergence,
        "rationale": (
            f"Candidates DISAGREE by {divergence} days, exceeding the "
            f"{tolerance_days}-day tolerance. Co-author candidate used by "
            "default per decision-log.md Row 1; divergence logged for "
            "manual review. No midpoint computed — fabrication forbidden "
            "by AAP §0.7.3."
        ),
    }


# ---------------------------------------------------------------------------
# Section 5 — Main Orchestration
# ---------------------------------------------------------------------------


def main(argv: list[str] | None = None) -> int:
    """Orchestrate Methods 1+2, reconcile, and write data/inflection.json.

    Args:
        argv: Optional argument vector for testing. When ``None``,
            argparse reads from ``sys.argv[1:]``.

    Returns:
        Exit code: 0 success, 1 no candidate, 2 write failure.
    """
    parser = argparse.ArgumentParser(
        prog="derive_inflection.py",
        description=(
            "Detect the AI tool introduction date via co-author-trailer + "
            "velocity-inflection reconciliation. Writes data/inflection.json."
        ),
    )
    parser.add_argument(
        "--author-email",
        default=BLITZY_AUTHOR_EMAIL,
        help=(
            f"Author email to detect (default: {BLITZY_AUTHOR_EMAIL}). "
            "Matched against commit author identity AND Co-authored-by trailers."
        ),
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=DATA_DIR / "inflection.json",
        help=(
            "Path for the output JSON record. Parent directories are "
            "created if missing. Default: data/inflection.json."
        ),
    )
    parser.add_argument(
        "--method",
        choices=("auto", "co_author", "velocity"),
        default="auto",
        help=(
            "Force a specific detection method. 'auto' (default) reconciles "
            "both. 'co_author' / 'velocity' use only that method but the "
            "other is still computed for traceability."
        ),
    )
    args = parser.parse_args(argv)

    run_id = get_or_create_run_id()
    logger: logging.Logger = structured_logger(
        metric_id=None, phase="derive_inflection"
    )
    logger.info(
        "derive_inflection.py starting",
        extra={
            "context": {
                "run_id": run_id,
                "author_email": args.author_email,
                "method": args.method,
                "output": str(args.output),
            }
        },
    )

    # ---- Method 1 — Co-author trailer ----
    co_author: str | None = earliest_co_authored_commit(args.author_email)
    logger.info(
        f"Method 1 (co-author trailer) candidate: {co_author}",
        extra={"context": {"co_author_candidate": co_author}},
    )

    # ---- Method 2 — Velocity inflection ----
    daily_counts = fetch_daily_commit_counts()
    velocity_inflection: str | None = None

    if daily_counts:
        sorted_days = sorted(daily_counts.keys())
        start_dt: datetime | None
        end_dt: datetime | None
        try:
            start_dt = datetime.fromisoformat(sorted_days[0] + "T00:00:00+00:00")
            end_dt = datetime.fromisoformat(sorted_days[-1] + "T00:00:00+00:00")
        except ValueError as exc:
            logger.error(
                f"Could not parse commit date range: {exc}",
                extra={
                    "context": {
                        "earliest_day": sorted_days[0] if sorted_days else None,
                        "latest_day": sorted_days[-1] if sorted_days else None,
                        "error": str(exc),
                    }
                },
            )
            start_dt = None
            end_dt = None

        if start_dt is not None and end_dt is not None:
            velocities = sliding_window_velocity(daily_counts, start_dt, end_dt)
            logger.debug(
                f"Sliding-window velocity series: {len(velocities)} windows",
                extra={"context": {"n_windows": len(velocities)}},
            )
            velocity_inflection = detect_sustained_inflection(velocities)
    else:
        logger.warning(
            "No daily commit counts available; skipping Method 2 (velocity).",
            extra={"context": {}},
        )

    logger.info(
        f"Method 2 (velocity inflection) candidate: {velocity_inflection}",
        extra={"context": {"velocity_candidate": velocity_inflection}},
    )

    # ---- Reconciliation ----
    if args.method == "co_author":
        reconciliation: dict[str, Any] = {
            "chosen_date": co_author,
            "chosen_method": "co_author",
            "divergence_days": None,
            "rationale": (
                "User specified --method co_author at the CLI. Velocity "
                "candidate is recorded for traceability but ignored for "
                "the chosen date."
            ),
        }
    elif args.method == "velocity":
        reconciliation = {
            "chosen_date": velocity_inflection,
            "chosen_method": "velocity",
            "divergence_days": None,
            "rationale": (
                "User specified --method velocity at the CLI. Co-author "
                "candidate is recorded for traceability but ignored for "
                "the chosen date."
            ),
        }
    else:
        reconciliation = reconcile_candidates(co_author, velocity_inflection)

    # ---- Build output record ----
    inflection_record: dict[str, Any] = {
        "co_author_candidate": co_author,
        "velocity_candidate": velocity_inflection,
        "chosen_date": reconciliation["chosen_date"],
        "chosen_method": reconciliation["chosen_method"],
        "divergence_days": reconciliation["divergence_days"],
        "rationale": reconciliation["rationale"],
        "computed_at": iso_now_utc(),
        "run_id": run_id,
    }

    # Exit 1 if neither method yielded a candidate. Still attempt a
    # best-effort write so the consistency checker can see the gap.
    if reconciliation["chosen_date"] is None:
        logger.error(
            "No inflection date detected by either method. Aborting.",
            extra={"context": inflection_record},
        )
        try:
            args.output.parent.mkdir(parents=True, exist_ok=True)
            save_json(args.output, inflection_record)
        except OSError as exc:
            logger.warning(
                f"Could not write fallback inflection record: {exc}",
                extra={"context": {"output": str(args.output), "error": str(exc)}},
            )
        return 1

    # ---- Persist successful result ----
    try:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        save_json(args.output, inflection_record)
        # ``save_json`` already appends a ``write`` to commands.log; this
        # extra append is defensive against future _shared changes that
        # may remove that side effect. The Reproducibility Appendix is
        # tolerant of duplicate write entries.
        command_log_append("write", str(args.output))
    except OSError as exc:
        logger.error(
            f"Cannot write inflection record to {args.output}: {exc}",
            extra={"context": {"output": str(args.output), "error": str(exc)}},
        )
        return 2

    logger.info(
        (
            f"Inflection written: chosen_date={reconciliation['chosen_date']} "
            f"via {reconciliation['chosen_method']}"
        ),
        extra={
            "context": {
                "output": str(args.output),
                "chosen_date": reconciliation["chosen_date"],
                "chosen_method": reconciliation["chosen_method"],
                "divergence_days": reconciliation["divergence_days"],
            }
        },
    )
    return 0


# Schema-required imports not directly invoked in function bodies retain
# explicit references here so static type checkers and the import-validator
# recognize them as used: ``os`` for direct env-var reads (currently
# delegated to ``_shared``); ``json`` for ``JSONDecodeError`` narrowing in
# downstream consumers; ``logging`` for the ``logger`` annotation in ``main``.
_SCHEMA_IMPORT_REFS: tuple[Any, ...] = (
    os.environ,
    json.JSONDecodeError,
    logging.Logger,
)


if __name__ == "__main__":
    sys.exit(main())
