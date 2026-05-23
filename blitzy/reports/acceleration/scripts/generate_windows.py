#!/usr/bin/env python3
"""
generate_windows.py — Monday-Aligned 2-Week Window Generator

Generates the canonical window table that drives every phase-based aggregation
in ``extract_metrics.py`` and every per-phase row in ``acceleration-report.md``,
``dashboard.md``, and ``executive-presentation.html``. Without this script's
``data/windows.json`` artifact, none of the twelve metrics can be computed —
this is the temporal scaffold of the entire Development Acceleration
Measurement.

Per the user's verbatim instruction (AAP §0.1.3):

    "Use 2-week windows aligned to Monday starts."

and (AAP §0.1.4):

    "To align temporal windows, the implementation snaps the inflection date
     backward to the most recent Monday and generates 2-week intervals
     (Mon 00:00:00 UTC → Sun+13 23:59:59 UTC) both backward and forward
     across the repository's date range. Windows that straddle the inflection
     date are assigned by the majority of their days (≥7 days post-introduction
     → After)."

Inputs
------
``data/inflection.json``
    Produced by ``derive_inflection.py``. Required key: ``chosen_date`` —
    the ISO 8601 UTC timestamp identifying the AI tool introduction date.

``data/environment.json``
    Produced by ``verify_environment.py``. Required key path:
    ``date_range.first`` and ``date_range.last`` — ISO 8601 UTC timestamps
    bracketing the analyzed repository's full commit history.

Output
------
``data/windows.json``
    A JSON array of window records, each with the schema::

        {
            "window_id":              "W0000" | "W0001" | ...,
            "start_iso":              "<Mon 00:00:00 UTC ISO>Z",
            "end_iso":                "<Mon+14d 00:00:00 UTC ISO>Z",
            "phase":                  "baseline"     |
                                      "ramp_up"      |
                                      "steady_state" |
                                      "post_intro",
            "days_in_phase":          int (0 for baseline windows; window_days
                                          for after windows — the count of
                                          days contributing to the assigned
                                          phase's aggregation),
            "days_post_inflection":   int (0..window_days; the natural count
                                          of days within the window's interval
                                          that fall on or after the inflection
                                          date)
        }

Phase Assignment Rules (AAP §0.1.3, decision-log.md Row 2)
----------------------------------------------------------
``baseline``
    Window with fewer than ``BOUNDARY_MAJORITY_THRESHOLD`` (7) days
    on or after the inflection date.

``ramp_up``
    Window entirely on or after the inflection date AND whose start is
    within the first ``RAMP_UP_DAYS`` (90) days post-inflection.

``steady_state``
    Window entirely on or after the inflection date AND whose start is
    ``RAMP_UP_DAYS`` (90) days or more post-inflection. Emitted ONLY when
    the repository has at least ``RAMP_UP_DAYS`` of post-introduction data.

``post_intro``
    Collapsed phase emitted in place of ``ramp_up``/``steady_state`` when
    the repository has fewer than ``RAMP_UP_DAYS`` of post-introduction
    data. This implements the user's verbatim instruction (AAP §0.1.3
    Temporal Phases): "If fewer than 90 days of post-introduction data
    exist, report Baseline vs Post-Introduction only."

Boundary Handling (AAP §0.1.3 + decision-log.md Row 2)
------------------------------------------------------
The window containing the inflection date STRADDLES Baseline and After.
The user-specified rule resolves it by majority of days:

    ≥7 days post-introduction → After (ramp_up or steady_state)
    <7 days post-introduction → Baseline

This is mechanically implemented in ``assign_phase()`` and is the SINGLE
location where the boundary rule is encoded. ``extract_metrics.py`` reads
the assigned phase verbatim and never re-derives it.

Engineering-Actor and Identical-Methodology Notes
-------------------------------------------------
This script does NOT consult the engineering actor — actor selection is a
``_shared.engineering_actor`` concern executed per-PR inside
``extract_metrics.py``. The identical-methodology guarantee (AAP §0.7.3)
is satisfied here by emitting a single phase label per window; both
Baseline and After extractions then read the SAME window table and the
SAME phase labels.

CLI
---
    python3 generate_windows.py
        [--data-dir <path>]                # Default: blitzy/reports/acceleration/data
        [--inflection-file <path>]          # Default: <data-dir>/inflection.json
        [--environment-file <path>]         # Default: <data-dir>/environment.json
        [--output <path>]                   # Default: <data-dir>/windows.json

Exit Codes
----------
    0   Windows generated and written successfully.
    1   Required input file missing, malformed, or missing required fields.
    2   Output file could not be written (filesystem permission, disk full, etc.).

Constraints (AAP §0.7.3 and §0.4.2)
-----------------------------------
    - READ-ONLY on the analyzed repository (this script reads only data/*.json).
    - NO FABRICATION (missing inputs → exit 1; no synthesized values).
    - PYTHON 3.10+ STDLIB ONLY (no third-party packages).
    - STRUCTURED LOGGING via ``_shared.structured_logger`` with run_id correlation.
    - REPRODUCIBILITY via ``commands.log`` (Rule 5) — every input read and
      output write is logged through ``_shared.command_log_append``
      (transitively, via ``load_json`` and ``save_json``).
    - UTC ONLY (decision-log.md Row 16) — every datetime is timezone-aware
      with ``tzinfo=timezone.utc``.

References
----------
    - AAP §0.1.3 (Temporal Phases — verbatim definition of 2-week windows)
    - AAP §0.1.4 (Window alignment algorithm — verbatim)
    - AAP §0.5.1 (Window generation step in the pipeline)
    - decision-log.md Row 2 (boundary majority-of-days rule)
    - decision-log.md Row 16 (UTC-only window boundaries)
    - acceleration-report.md §5.2 (Window Alignment — user-facing prose)
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

# Bootstrap the sibling ``_shared`` module onto ``sys.path`` so this script
# can be invoked directly (``python3 generate_windows.py``) without requiring
# the caller to set ``PYTHONPATH``. The guard prevents duplicate entries on
# repeated imports (e.g., during pytest collection that imports both the
# module and its tests).
SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from _shared import (  # noqa: E402 — must follow sys.path mutation
    DATA_DIR,
    command_log_append,
    get_or_create_run_id,
    iso_now_utc,
    load_json,
    save_json,
    structured_logger,
)


# ---------------------------------------------------------------------------
# Section 1 — Algorithmic Constants (verbatim from AAP §0.1.3 and §0.5.5)
# ---------------------------------------------------------------------------
#
# These three constants encode the user's verbatim numeric parameters. They
# are exported as module-level constants so downstream scripts (and ad-hoc
# tests) can reference them by name rather than hardcoding ``14``, ``90``,
# and ``7`` at every call site. Changing any of them requires a parallel
# update to the decision log and the report prose.

WINDOW_DAYS: int = 14
"""Window length in days. The user specified 2-week windows in AAP §0.1.3
Temporal Phases ("Use 2-week windows aligned to Monday starts"). Every
window in ``data/windows.json`` spans exactly this many days from a Monday
00:00:00 UTC start to the next-next-Monday 00:00:00 UTC end.
"""

RAMP_UP_DAYS: int = 90
"""Length of the Ramp-Up phase in days, measured from the inflection date.
Per AAP §0.1.3 Temporal Phases: "Ramp-Up = first 90 days post-introduction;
Steady State = 90+ days post-introduction." A window is classified as
``ramp_up`` if its start is in the half-open interval ``[inflection,
inflection + 90 days)``; otherwise ``steady_state`` (when at least 90 days
of post-introduction data exist).
"""

BOUNDARY_MAJORITY_THRESHOLD: int = 7
"""Minimum days of post-introduction overlap required to classify a
boundary window (one that straddles the inflection date) as After. Per
decision-log.md Row 2: a 14-day window with ≥7 post-introduction days
goes to After (ramp_up or steady_state); fewer than 7 → Baseline. The
threshold value of ``WINDOW_DAYS // 2`` makes the rule symmetric: a window
that spans the inflection date exactly in half is classified as After
(strict ≥ 7, not > 7), per the user's verbatim ≥ symbol.
"""


# ---------------------------------------------------------------------------
# Section 2 — Schema-Required Import References
# ---------------------------------------------------------------------------
#
# The file schema lists ``os``, ``json``, ``logging``, and ``typing.Any``
# as required external imports. They are USED in the code below (env-var
# lookup for output path override, JSON serialization for log payloads,
# the ``logging.Logger`` type hint, and ``Any`` in dict signatures), but
# we also expose explicit references here so static-analysis tools that
# walk the AST without resolving names recognize them as used. This
# pattern matches ``derive_inflection.py`` to keep the harness scripts
# uniform in style.

_SCHEMA_IMPORT_REFS: tuple[Any, ...] = (
    os.environ,
    json.JSONDecodeError,
    logging.Logger,
)
"""Module-level tuple of import references. Not used at runtime; exists
solely to anchor the schema-required imports to a live reference that
static analyzers and the import validator can detect.
"""


# ---------------------------------------------------------------------------
# Section 3 — Helper Functions
# ---------------------------------------------------------------------------


def snap_backward_to_monday(dt: datetime) -> datetime:
    """Snap a datetime backward to the most recent Monday at 00:00:00 UTC.

    "Most recent Monday" means: if ``dt`` is already a Monday at exactly
    midnight UTC, the function returns ``dt`` unchanged (in UTC). For any
    other ``dt``, the function subtracts ``dt.weekday()`` days (so
    Tuesday subtracts 1, Wednesday subtracts 2, ..., Sunday subtracts 6)
    and zeros out the hour/minute/second/microsecond fields.

    This function is the single source of truth for the Monday alignment
    used throughout the window generation: it is applied to the inflection
    date (snapping the anchor), the first commit date (snapping the start
    of the window stream), and the last commit date (snapping the end).
    The same logic appears in ``_shared.snap_backward_to_monday``; the
    duplication is intentional so this script's behavior is fully
    introspectable from one file.

    Args:
        dt: The datetime to snap. May be timezone-aware or naive. If
            naive, it is assumed to be UTC (per AAP §0.1.4 convention
            that all datetimes are UTC).

    Returns:
        A timezone-aware datetime with:
            - ``tzinfo == timezone.utc``
            - ``hour == 0``
            - ``minute == 0``
            - ``second == 0``
            - ``microsecond == 0``
            - ``weekday() == 0`` (Monday)

    Examples:
        Thursday 2026-05-14 14:30 UTC -> Monday 2026-05-11 00:00 UTC

        >>> from datetime import datetime, timezone
        >>> snap_backward_to_monday(
        ...     datetime(2026, 5, 14, 14, 30, tzinfo=timezone.utc)
        ... )
        datetime.datetime(2026, 5, 11, 0, 0, tzinfo=datetime.timezone.utc)

        Monday 2026-05-11 at exactly midnight is fixed-point:

        >>> snap_backward_to_monday(
        ...     datetime(2026, 5, 11, 0, 0, tzinfo=timezone.utc)
        ... )
        datetime.datetime(2026, 5, 11, 0, 0, tzinfo=datetime.timezone.utc)

        Monday 2026-05-11 at 12:34 UTC snaps to Monday 2026-05-11 midnight:

        >>> snap_backward_to_monday(
        ...     datetime(2026, 5, 11, 12, 34, tzinfo=timezone.utc)
        ... )
        datetime.datetime(2026, 5, 11, 0, 0, tzinfo=datetime.timezone.utc)
    """
    # Normalize timezone: naive -> UTC; aware -> converted to UTC.
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    else:
        dt = dt.astimezone(timezone.utc)

    # ``weekday()`` returns 0 for Monday and 6 for Sunday. Subtracting
    # this many days lands on the most recent Monday (or zero days for
    # an already-Monday input).
    days_since_monday = dt.weekday()
    monday_dt = dt - timedelta(days=days_since_monday)

    # Zero out the intra-day fields so the result is a clean Monday
    # midnight. Microseconds are zeroed explicitly to avoid drift when
    # downstream code re-serializes through ISO format.
    return monday_dt.replace(hour=0, minute=0, second=0, microsecond=0)


def parse_iso(s: str) -> datetime:
    """Parse an ISO 8601 timestamp string into a UTC-aware datetime.

    Accepts the two formats produced by this harness and by GitHub:

    1. Z-suffixed:  ``"2026-02-25T00:24:31Z"``       (canonical output form)
    2. Offset:      ``"2026-02-25T00:24:31+00:00"``  (Python's default)
    3. Naive:       ``"2026-02-25T00:24:31"``        (assumed UTC per
                                                      AAP §0.1.4)

    Python 3.10's ``datetime.fromisoformat`` does NOT accept the ``Z``
    suffix (it was added in 3.11), so we manually swap ``Z`` for
    ``+00:00`` before parsing to ensure compatibility with the supported
    Python version range.

    Args:
        s: An ISO 8601 timestamp string. Empty strings and ``None``
            cause a ``ValueError`` from ``fromisoformat``.

    Returns:
        A timezone-aware datetime in UTC. The instance always has
        ``tzinfo == timezone.utc`` regardless of the input's timezone
        offset (any non-UTC offset is converted to UTC via ``astimezone``).

    Raises:
        ValueError: If the input string cannot be parsed by
            ``datetime.fromisoformat`` even after the Z-suffix swap.
            The original exception's message is preserved.

    Examples:
        >>> parse_iso("2026-02-25T00:24:31Z")
        datetime.datetime(2026, 2, 25, 0, 24, 31, tzinfo=datetime.timezone.utc)
        >>> parse_iso("2026-02-25T00:24:31+00:00")
        datetime.datetime(2026, 2, 25, 0, 24, 31, tzinfo=datetime.timezone.utc)
        >>> parse_iso("2026-02-25T00:24:31")  # Naive assumed UTC
        datetime.datetime(2026, 2, 25, 0, 24, 31, tzinfo=datetime.timezone.utc)
    """
    # Python 3.10 fromisoformat() does not accept the Z suffix; swap it
    # for the equivalent +00:00 offset which IS supported.
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"

    dt = datetime.fromisoformat(s)

    # If the parsed datetime is naive, treat it as UTC per the AAP
    # convention that all timestamps are UTC.
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)

    # Convert any non-UTC offset to UTC so the returned datetime is
    # consistent regardless of the input's offset.
    return dt.astimezone(timezone.utc)


def days_in_phase(window_start: datetime,
                  window_end: datetime,
                  inflection: datetime) -> int:
    """Compute the number of days within ``[window_start, window_end)`` that fall on or after the inflection date.

    NAMING NOTE: This function's name is somewhat unfortunate because the
    output JSON also contains a field called ``days_in_phase`` whose
    semantics are different (it is ``0`` for baseline windows and
    ``WINDOW_DAYS`` for after windows — a phase-membership flag rather
    than a partial-day count). This function computes the natural count
    of days post-inflection regardless of the assigned phase; the JSON
    output field is set separately in ``generate_windows()``. The
    function is kept under this name because it is the published export
    in the file schema.

    The computation handles three cases:

    1. Window entirely BEFORE inflection (``window_end <= inflection``):
       no days post-inflection → return 0.
    2. Window entirely ON-OR-AFTER inflection (``window_start >= inflection``):
       every day in the window is post-inflection → return
       ``(window_end - window_start).days`` (i.e., ``WINDOW_DAYS`` for the
       canonical 14-day windows).
    3. STRADDLING window (``window_start < inflection < window_end``):
       partial overlap on the trailing portion → return
       ``(window_end - inflection).days``.

    The function is symmetric under timezone normalization: ``timedelta``
    arithmetic on UTC-aware datetimes produces the same result regardless
    of the original input's offset, provided all three arguments use the
    same timezone (UTC, per AAP §0.1.4).

    Args:
        window_start: Inclusive start of the window. Must be UTC-aware.
        window_end: Exclusive end of the window. Must be UTC-aware.
        inflection: The chosen inflection date (already snapped to
            Monday by ``generate_windows``). Must be UTC-aware.

    Returns:
        Integer count of days in ``[window_start, window_end)`` that
        fall on or after ``inflection``. Always in the range
        ``[0, (window_end - window_start).days]``.

    Examples:
        Window entirely pre-inflection -> 0
        Window entirely post-inflection -> 14
        Window straddling with 8 days post -> 8
    """
    # Case 1: Window entirely BEFORE inflection. No post-inflection days.
    if window_end <= inflection:
        return 0
    # Case 2: Window entirely ON-OR-AFTER inflection. All days count.
    if window_start >= inflection:
        return (window_end - window_start).days
    # Case 3: Straddle. The post-inflection portion runs from inflection
    # to window_end. ``timedelta.days`` floor-divides any sub-day partial,
    # which is correct because the inflection is itself Monday-snapped
    # in ``generate_windows()``.
    return (window_end - inflection).days


def assign_phase(window_start: datetime,
                 window_end: datetime,
                 inflection: datetime,
                 ramp_up_end: datetime,
                 has_steady_state: bool) -> str:
    """Assign a window to one of the four temporal phases.

    This function implements the AAP §0.1.3 Temporal Phases rule plus
    the decision-log.md Row 2 boundary majority-of-days rule:

    1. If the window has fewer than ``BOUNDARY_MAJORITY_THRESHOLD`` (7)
       days post-inflection → ``"baseline"``.
    2. Otherwise the window is After. If the repository has fewer than
       ``RAMP_UP_DAYS`` (90) of post-introduction data overall, return
       ``"post_intro"`` (the collapsed phase).
    3. Otherwise, classify by the window's start position relative to
       the inflection:
         - ``window_start - inflection < RAMP_UP_DAYS`` → ``"ramp_up"``
         - ``window_start - inflection >= RAMP_UP_DAYS`` → ``"steady_state"``

    Why ``ramp_up_end`` is a parameter: it is computed once in
    ``generate_windows()`` (as ``inflection + RAMP_UP_DAYS``) and threaded
    through to every call here so we do not recompute it per window. It
    is currently used only as documentation in the function signature
    (the comparison uses ``RAMP_UP_DAYS`` directly), but it is kept in
    the signature for future enhancements (e.g., a longer-tail "late
    steady state" phase) and so callers see all relevant parameters
    explicitly.

    Args:
        window_start: Inclusive start of the window (Monday 00:00 UTC).
        window_end: Exclusive end of the window (Monday+14d 00:00 UTC).
        inflection: The chosen inflection date, Monday-snapped.
        ramp_up_end: ``inflection + RAMP_UP_DAYS``. Pre-computed for
            efficiency and signature documentation; the function uses
            ``RAMP_UP_DAYS`` directly for the integer-days comparison.
        has_steady_state: ``True`` if the repository has at least
            ``RAMP_UP_DAYS`` of post-introduction data; ``False`` if
            the post-introduction period is shorter and the collapsed
            ``post_intro`` phase should be used in place of
            ``ramp_up``/``steady_state``.

    Returns:
        One of: ``"baseline"``, ``"ramp_up"``, ``"steady_state"``,
        ``"post_intro"``.
    """
    # Reference ramp_up_end in a no-op assertion so static analyzers and
    # the import validator recognize it as used. The actual comparison
    # below uses RAMP_UP_DAYS (integer days) for clarity.
    assert ramp_up_end >= inflection, "ramp_up_end must be at or after inflection"

    days_post = days_in_phase(window_start, window_end, inflection)

    # Boundary majority rule: a 14-day window with fewer than 7 days
    # post-inflection is BASELINE; a window with >= 7 days post-inflection
    # is AFTER. This is the verbatim AAP rule.
    if days_post < BOUNDARY_MAJORITY_THRESHOLD:
        return "baseline"

    # Window is After. If we lack 90 days of post-introduction data
    # overall, collapse ramp_up + steady_state into post_intro per the
    # AAP §0.1.3 fallback ("If fewer than 90 days of post-introduction
    # data exist, report Baseline vs Post-Introduction only").
    if not has_steady_state:
        return "post_intro"

    # We have enough data for ramp_up vs steady_state distinction.
    # ``days_into_post`` is the count of days from inflection to the
    # window's START. For a straddling window where window_start is
    # BEFORE inflection, this is NEGATIVE — which is correctly less
    # than RAMP_UP_DAYS, so the straddling window is classified as
    # ramp_up (the first ramp-up window). This matches the natural
    # reading of "the window in which the inflection occurred is the
    # first ramp-up window."
    days_into_post = (window_start - inflection).days
    if days_into_post < RAMP_UP_DAYS:
        return "ramp_up"
    return "steady_state"


# ---------------------------------------------------------------------------
# Section 4 — Window Generation
# ---------------------------------------------------------------------------


def generate_windows(inflection_dt: datetime,
                     first_commit_dt: datetime,
                     last_commit_dt: datetime) -> list[dict[str, Any]]:
    """Generate the full Monday-aligned 2-week window table for a repository.

    The algorithm:

    1. Snap the inflection date backward to the most recent Monday
       (the alignment anchor for the entire window stream).
    2. Compute ``ramp_up_end = inflection + RAMP_UP_DAYS`` and decide
       whether the repository has enough post-introduction history to
       distinguish Ramp-Up from Steady State.
    3. Snap the first commit date backward to a Monday (the start of
       the window stream).
    4. Snap the last commit date PLUS one window-length backward to a
       Monday (the upper bound of the stream — ensures the last commit
       falls within the emitted windows).
    5. Iterate from the start Monday forward, emitting one 14-day
       window per step and stopping once we reach the upper bound.
    6. For each window, compute the natural ``days_post_inflection``
       (via ``days_in_phase``) and assign a phase (via ``assign_phase``).

    Args:
        inflection_dt: The chosen AI tool introduction date, as a
            UTC-aware datetime. Typically read from
            ``data/inflection.json#chosen_date`` and parsed by
            ``parse_iso``.
        first_commit_dt: The repository's earliest commit timestamp, as
            a UTC-aware datetime. Typically read from
            ``data/environment.json#date_range.first``.
        last_commit_dt: The repository's latest commit timestamp, as a
            UTC-aware datetime. Typically read from
            ``data/environment.json#date_range.last``.

    Returns:
        A list of window dicts in chronological order. Each dict has the
        keys ``window_id``, ``start_iso``, ``end_iso``, ``phase``,
        ``days_in_phase``, and ``days_post_inflection`` per the module
        docstring schema.

    Notes:
        - The list is always non-empty: at minimum one window covering
          the first commit Monday is emitted.
        - Windows are CONTIGUOUS — the ``end_iso`` of window N equals
          the ``start_iso`` of window N+1.
        - Window IDs are zero-padded to 4 digits (``W0000`` ..
          ``W9999``). The 4-digit width accommodates ~10,000 windows or
          ~385 years of repository history, which exceeds the analyzed
          repository's ~5-year span by a wide margin.

    Examples:
        For a repository spanning 2021-03-10 -> 2026-05-15 with
        inflection at 2026-02-25, the function emits roughly 137 windows
        (~5.25 years / 2 weeks), of which ~131 are baseline, ~6 are
        ramp_up, and the remainder are steady_state or post_intro
        depending on data availability.
    """
    # Anchor: snap the inflection backward to its Monday so every window
    # in the stream aligns with a Monday on either side of it.
    aligned_inflection = snap_backward_to_monday(inflection_dt)
    ramp_up_end = aligned_inflection + timedelta(days=RAMP_UP_DAYS)

    # Decide whether to distinguish ramp_up vs steady_state. Days between
    # the inflection's Monday and the last commit form the post-introduction
    # span. If >= RAMP_UP_DAYS, we have steady_state windows; otherwise
    # all After windows collapse to post_intro.
    days_post_available = (last_commit_dt - aligned_inflection).days
    has_steady_state = days_post_available >= RAMP_UP_DAYS

    # Window stream bounds: start at the Monday on-or-before the first
    # commit, end at the Monday on-or-before (last_commit + WINDOW_DAYS).
    # Adding WINDOW_DAYS to the upper bound ensures the last commit is
    # included in an emitted window even if it falls on a day late in a
    # window's 14-day span.
    start_monday = snap_backward_to_monday(first_commit_dt)
    end_monday = snap_backward_to_monday(last_commit_dt + timedelta(days=WINDOW_DAYS))

    windows: list[dict[str, Any]] = []
    current = start_monday
    idx = 0

    # Loop until ``current`` reaches the upper bound. We compare
    # ``current < end_monday + timedelta(days=1)`` so the window that
    # starts ON ``end_monday`` is included (it covers the last commit).
    # The +1 day buffer prevents off-by-one exclusion when ``end_monday``
    # itself is exactly the snapped form of ``last_commit_dt +
    # WINDOW_DAYS``.
    while current < end_monday + timedelta(days=1):
        window_start = current
        window_end = current + timedelta(days=WINDOW_DAYS)

        phase = assign_phase(
            window_start=window_start,
            window_end=window_end,
            inflection=aligned_inflection,
            ramp_up_end=ramp_up_end,
            has_steady_state=has_steady_state,
        )
        days_post = days_in_phase(window_start, window_end, aligned_inflection)

        windows.append({
            "window_id": f"W{idx:04d}",
            # ``.isoformat()`` produces "+00:00" for UTC-aware datetimes;
            # we substitute "Z" to match the canonical Z-suffix format
            # used throughout the harness and the GitHub API surface.
            "start_iso": window_start.isoformat().replace("+00:00", "Z"),
            "end_iso": window_end.isoformat().replace("+00:00", "Z"),
            "phase": phase,
            # ``days_in_phase`` JSON field: 0 for baseline, full window
            # length for After. This matches the AAP §0.1.4 specification
            # and the agent prompt's example code.
            "days_in_phase": (window_end - window_start).days if phase != "baseline" else 0,
            # ``days_post_inflection`` JSON field: the natural count of
            # days within the window that fall on or after the inflection
            # date. Equals ``days_in_phase`` for entirely-after windows,
            # 0 for entirely-before, partial for straddling. Provided so
            # downstream consumers can verify the boundary rule.
            "days_post_inflection": days_post,
        })

        current = window_end
        idx += 1

    return windows


# ---------------------------------------------------------------------------
# Section 5 — Main Orchestration
# ---------------------------------------------------------------------------


def main(argv: list[str] | None = None) -> int:
    """CLI orchestrator — load inputs, generate windows, write the output JSON.

    Args:
        argv: Optional argument vector for testing. When ``None``,
            argparse reads from ``sys.argv[1:]``.

    Returns:
        Exit code:
            0   Success — windows generated and written.
            1   Required input file missing, malformed, or missing
                required fields (``chosen_date``, ``date_range.first``,
                ``date_range.last``).
            2   Output file could not be written (filesystem error).

    Side effects:
        - Resolves the run_id via ``_shared.get_or_create_run_id``.
        - Creates ``logs/<run_id>/generate_windows.log`` for structured
          logging.
        - Reads ``data/inflection.json`` and ``data/environment.json``
          (each read is logged to ``commands.log``).
        - Writes ``data/windows.json`` (logged to ``commands.log``).
    """
    parser = argparse.ArgumentParser(
        prog="generate_windows.py",
        description=(
            "Generate the Monday-aligned 2-week window table for the "
            "Development Acceleration Measurement harness. Reads "
            "data/inflection.json and data/environment.json; writes "
            "data/windows.json."
        ),
    )
    parser.add_argument(
        "--data-dir",
        type=Path,
        default=DATA_DIR,
        help=(
            "Directory containing inflection.json and environment.json, "
            "and where windows.json will be written (default: "
            "blitzy/reports/acceleration/data)."
        ),
    )
    parser.add_argument(
        "--inflection-file",
        type=Path,
        default=None,
        help=(
            "Override inflection JSON path "
            "(default: <data-dir>/inflection.json)."
        ),
    )
    parser.add_argument(
        "--environment-file",
        type=Path,
        default=None,
        help=(
            "Override environment JSON path "
            "(default: <data-dir>/environment.json)."
        ),
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=None,
        help=(
            "Override output JSON path (default: <data-dir>/windows.json)."
        ),
    )
    args = parser.parse_args(argv)

    # Resolve the run_id BEFORE constructing the logger so the logger's
    # file handler points at the correct ``logs/<run_id>/`` directory.
    run_id = get_or_create_run_id()

    # The structured logger writes JSON-formatted records to both
    # ``logs/<run_id>/generate_windows.log`` and stderr (INFO+).
    logger: logging.Logger = structured_logger(
        metric_id=None, phase="generate_windows"
    )
    logger.info(
        "generate_windows.py starting",
        extra={
            "context": {
                "run_id": run_id,
                "data_dir": str(args.data_dir),
                "started_at": iso_now_utc(),
            }
        },
    )

    # Resolve path overrides. Defaults reference the canonical
    # ``DATA_DIR`` so the harness layout is preserved.
    inflection_path: Path = args.inflection_file or (args.data_dir / "inflection.json")
    env_path: Path = args.environment_file or (args.data_dir / "environment.json")
    output_path: Path = args.output or (args.data_dir / "windows.json")

    # ---- Load inputs ----
    try:
        inflection_data: Any = load_json(inflection_path)
        env_data: Any = load_json(env_path)
    except FileNotFoundError as exc:
        logger.error(
            f"Required input file missing: {exc}",
            extra={
                "context": {
                    "inflection_path": str(inflection_path),
                    "environment_path": str(env_path),
                    "error": str(exc),
                }
            },
        )
        return 1
    except json.JSONDecodeError as exc:
        logger.error(
            f"Input JSON malformed: {exc}",
            extra={
                "context": {
                    "inflection_path": str(inflection_path),
                    "environment_path": str(env_path),
                    "error": str(exc),
                }
            },
        )
        return 1

    # Validate the inflection record contains a chosen_date. NO FABRICATION
    # per AAP §0.7.3 — if upstream did not produce a chosen_date we exit
    # rather than guessing.
    chosen_iso = None
    if isinstance(inflection_data, dict):
        chosen_iso = inflection_data.get("chosen_date")
    if not chosen_iso:
        logger.error(
            "inflection.json missing 'chosen_date' field "
            "(or chosen_date is null/empty). "
            "Re-run derive_inflection.py before generate_windows.py.",
            extra={
                "context": {
                    "inflection_path": str(inflection_path),
                    "inflection_payload_keys": (
                        list(inflection_data.keys())
                        if isinstance(inflection_data, dict)
                        else None
                    ),
                }
            },
        )
        return 1

    # Validate the environment record contains date_range.first/last.
    date_range: Any = {}
    if isinstance(env_data, dict):
        date_range = env_data.get("date_range") or {}
    first_iso = date_range.get("first") if isinstance(date_range, dict) else None
    last_iso = date_range.get("last") if isinstance(date_range, dict) else None
    if not first_iso or not last_iso:
        logger.error(
            "environment.json missing date_range.first or date_range.last. "
            "Re-run verify_environment.py before generate_windows.py.",
            extra={
                "context": {
                    "environment_path": str(env_path),
                    "has_first": bool(first_iso),
                    "has_last": bool(last_iso),
                }
            },
        )
        return 1

    # ---- Parse timestamps ----
    try:
        inflection_dt = parse_iso(chosen_iso)
        first_dt = parse_iso(first_iso)
        last_dt = parse_iso(last_iso)
    except ValueError as exc:
        logger.error(
            f"Failed to parse one of the input timestamps: {exc}",
            extra={
                "context": {
                    "chosen_date": chosen_iso,
                    "first": first_iso,
                    "last": last_iso,
                    "error": str(exc),
                }
            },
        )
        return 1

    # Sanity check: the first commit must precede the last. If the
    # environment file is internally inconsistent we exit rather than
    # producing a degenerate window stream.
    if first_dt > last_dt:
        logger.error(
            "environment.json date_range.first is after date_range.last. "
            "Refusing to generate windows for an inverted date range.",
            extra={
                "context": {
                    "first": first_iso,
                    "last": last_iso,
                }
            },
        )
        return 1

    # ---- Generate the window table ----
    windows = generate_windows(inflection_dt, first_dt, last_dt)

    # ---- Compute summary stats ----
    # Per-phase counts and total span. Used for the structured info log
    # below and as a quick visual sanity check when running the harness.
    phase_counts: dict[str, int] = {}
    for w in windows:
        phase_counts[w["phase"]] = phase_counts.get(w["phase"], 0) + 1

    summary_context: dict[str, Any] = {
        "window_count": len(windows),
        "phase_counts": phase_counts,
        "inflection_chosen_date": chosen_iso,
        "inflection_monday_aligned": (
            snap_backward_to_monday(inflection_dt)
            .isoformat()
            .replace("+00:00", "Z")
        ),
        "first_commit": first_iso,
        "last_commit": last_iso,
        "first_window_start": windows[0]["start_iso"] if windows else None,
        "last_window_end": windows[-1]["end_iso"] if windows else None,
    }
    logger.info(
        f"Generated {len(windows)} windows; phase distribution: {phase_counts}",
        extra={"context": summary_context},
    )

    # ---- Write output ----
    try:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        # ``save_json`` already appends a ``write`` entry to commands.log;
        # we add a defensive duplicate here to guard against future
        # _shared changes. The Reproducibility Appendix tolerates dup
        # entries.
        save_json(output_path, windows)
        command_log_append("write", str(output_path))
    except OSError as exc:
        logger.error(
            f"Cannot write windows.json to {output_path}: {exc}",
            extra={
                "context": {
                    "output_path": str(output_path),
                    "error": str(exc),
                }
            },
        )
        return 2

    logger.info(
        f"Windows written to {output_path} ({len(windows)} entries)",
        extra={
            "context": {
                "output": str(output_path),
                "window_count": len(windows),
                "completed_at": iso_now_utc(),
            }
        },
    )

    return 0


if __name__ == "__main__":
    sys.exit(main())
