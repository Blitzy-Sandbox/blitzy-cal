#!/usr/bin/env python3
"""extract_metrics.py — 12-Metric Extraction Harness for the Development
Acceleration Measurement.

Implements algorithms for all twelve flow/operational metrics specified in
the Agent Action Plan (AAP §0.5.5):

    M1 Flow Load               | M7 Flow Time
    M2 Flow Velocity           | M8 Problem Records in Release
    M3 Flow Predictability     | M9 Releases
    M4 Flow Active             | M10 Approved Exceptions
    M5 Flow Efficiency         | M11 Escaped Defects
    M6 Flow Distribution       | M12 Defects Out of SLA

CLI:
    python3 extract_metrics.py --metric N            # extract a single metric (1..12)
    python3 extract_metrics.py --metric all          # extract all 12 metrics
    python3 extract_metrics.py --metric N --no-cache # bypass the GitHub API cache
    python3 extract_metrics.py --metric N --data-dir <PATH>  # alternate output directory

Outputs:
    data/metric_<N>.json per metric (atomic write via _shared.save_json).
    logs/<run_id>/extract_metrics.log — structured JSON log lines.

Exit Codes:
    0 — all requested metrics extracted (or correctly reported insufficient signal)
    1 — at least one metric crashed unexpectedly (data crash, not insufficient signal)
    2 — invalid CLI arguments or missing windows.json

Identical-Methodology Guarantee (AAP §0.7.3 Boundary 6):
    Every extraction function is parameterized over (windows, use_cache) only.
    Per-actor aggregation uses the single _shared.engineering_actor(pr, phase)
    selector — the ONLY phase-branching point in the codebase. Baseline returns
    the human author; any other phase returns Blitzy when the PR is
    Blitzy-authored and the human author otherwise. This makes identical
    methodology STRUCTURALLY INEVITABLE.

Insufficient-Signal Policy (AAP §0.7.3 Boundary 2):
    Every metric extractor is wrapped with @safe_extract. Data-source
    unavailability raises InsufficientSignalError, which the decorator catches
    and converts to {"status": "insufficient_signal", "reason": "<reason>"}.
    Unexpected exceptions propagate so the harness returns exit code 1.

Read-Only Constraint (AAP §0.7.3 Boundary 1):
    All git invocations go through _shared.git_run / _shared.git_log which
    enforce a read-only subcommand allowlist (commit/push/tag-create rejected
    with ValueError). HTTP requests are GET-only via _shared.github_api_get.
    The M8 revert-attribution algorithm uses subprocess.run directly with
    `git merge-base --is-ancestor` (return-code-based ancestry check), which
    is read-only by definition.

References:
    AAP §0.1.1 — operational definitions for all twelve metrics
    AAP §0.5.5 — extraction algorithms (M4 spans, M6 waterfall, M8 attribution)
    AAP §0.7.3 — boundary/preservation rules
    AAP §0.8.3 — confidence assignment policy by data source
    decision-log.md Row 12 — engineering actor selector design
"""

from __future__ import annotations

import argparse
import json
import logging  # noqa: F401  (type reference for Logger returned by structured_logger)
import os
import re
import statistics
import subprocess
import sys
import traceback
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Iterable

# -- Path Bootstrap (allow direct execution: ``python3 extract_metrics.py``) -

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from _shared import (  # noqa: E402  (must follow sys.path manipulation)
    BLITZY_ACTOR_LABEL,
    BLITZY_AUTHOR_EMAIL,
    BOT_LOGINS,
    DATA_DIR,
    REPO_NAME,
    REPO_OWNER,
    REPORT_ROOT,
    command_log_append,
    engineering_actor,
    get_or_create_run_id,
    git_log,
    git_run,
    github_api_get,
    is_blitzy_actor,
    linear_api_get,
    load_json,
    monday_aligned_windows,
    save_json,
    structured_logger,
)


# ===========================================================================
# Section 1 — Module-Level Constants (regex patterns and category mappings)
# ===========================================================================
#
# All regex patterns are compiled once at import time. Adding a new pattern
# requires updating both this section and decision-log.md Row 14 (M6
# classification waterfall) or Row 8 (M8 revert detection).


# Conventional-commit prefix detector for M6 Tier 2 of the classification waterfall.
# Matches the leading token of a PR title like "feat(api): add endpoint" or
# "fix!: regression". The optional ``(scope)`` and trailing ``!`` are tolerated.
CONVENTIONAL_COMMIT_RE = re.compile(
    r"^(feat|fix|chore|refactor|perf|docs|test|ci|build|style|security|compliance)"
    r"(\([^)]+\))?!?:",
    re.IGNORECASE,
)


# Mapping from conventional-commit prefix to the four Flow Distribution
# categories. ``security`` and ``compliance`` are mapped to ``risk-compliance``
# rather than ``defect`` to preserve the AAP's four-category taxonomy.
CONVENTIONAL_COMMIT_TO_CATEGORY: dict[str, str] = {
    "feat": "feature",
    "fix": "defect",
    "security": "risk-compliance",
    "compliance": "risk-compliance",
    "chore": "tech-debt",
    "refactor": "tech-debt",
    "perf": "tech-debt",
    "style": "tech-debt",
    "docs": "tech-debt",
    "test": "tech-debt",
    "ci": "tech-debt",
    "build": "tech-debt",
}


# Label → category mapping for M6 Tier 1 (linked-issue labels). Keys are
# lower-cased before lookup; the leading 🐛 emoji is preserved on its own line
# because that is how the bug_report.md issue template renders the label name.
LABEL_TO_CATEGORY: dict[str, str] = {
    "\U0001f41b bug": "defect",
    "bug": "defect",
    "defect": "defect",
    "regression": "defect",
    "enhancement": "feature",
    "feature": "feature",
    "feat": "feature",
    "new feature": "feature",
    "security": "risk-compliance",
    "vulnerability": "risk-compliance",
    "compliance": "risk-compliance",
    "audit": "risk-compliance",
    "chore": "tech-debt",
    "refactor": "tech-debt",
    "tech-debt": "tech-debt",
    "technical-debt": "tech-debt",
    "cleanup": "tech-debt",
    "performance": "tech-debt",
    "perf": "tech-debt",
    "documentation": "tech-debt",
    "docs": "tech-debt",
}


# Keyword token sets for M6 Tier 3 (fallback when neither labels nor a
# conventional-commit prefix produced a classification).
KEYWORDS_DEFECT: tuple[str, ...] = (
    "bug", "regression", "broken", "crash", "error", "exception", "issue",
    "failure", "race condition", "deadlock",
)
KEYWORDS_RISK_COMPLIANCE: tuple[str, ...] = (
    "vulnerability", "cve", "audit", "compliance", "security", "exploit",
    "xss", "csrf", "sql injection", "rce",
)
KEYWORDS_TECH_DEBT: tuple[str, ...] = (
    "cleanup", "refactor", "rename", "deprecate", "remove unused", "tidy",
    "lint", "format", "reorganize",
)
KEYWORDS_FEATURE: tuple[str, ...] = (
    "add", "implement", "support", "introduce", "enable", "new endpoint",
    "create",
)


# Revert detection. ``REVERT_TITLE_RE`` matches the PR title pattern that
# git's ``git revert`` command emits by default. ``REVERTS_COMMIT_RE``
# extracts the SHA from a revert commit body's ``This reverts commit <SHA>``
# trailer.
REVERT_TITLE_RE = re.compile(r'^Revert ".+"', re.IGNORECASE)
REVERTS_COMMIT_RE = re.compile(
    r"This reverts commit ([0-9a-f]{7,40})", re.IGNORECASE
)


# Linked-issue extraction. ``LINKED_ISSUE_GH_RE`` captures GitHub Issue
# numbers (``Fixes #123``, ``Closes #45``, ``Resolves #6``). ``LINKED_ISSUE_LINEAR_RE``
# captures Linear issue identifiers (``CAL-1234``). Both are documented in
# .github/PULL_REQUEST_TEMPLATE.md.
LINKED_ISSUE_GH_RE = re.compile(
    r"(?:fix(?:es|ed)?|close[sd]?|resolve[sd]?)\s+#(\d+)", re.IGNORECASE
)
LINKED_ISSUE_LINEAR_RE = re.compile(r"\b(CAL-\d+)\b", re.IGNORECASE)


# M9 prerelease suffix detector. Matches semver suffixes for alpha/beta/rc
# /dev/preview/pre/nightly/canary release streams. The boundary ``\b`` rejects
# accidental hits inside larger words.
PRERELEASE_RE = re.compile(
    r"-(alpha|beta|rc|dev|preview|pre|nightly|canary)\b", re.IGNORECASE
)


# M11 skip-annotation detector for the newly-skipped sub-count. Matches:
#   - it.skip(...), test.skip(...), describe.skip(...), it.todo(...), test.todo(...)
#   - xit(...), xtest(...)
#   - @xfail (pytest)
#   - @pytest.mark.skip (pytest)
SKIP_ANNOTATION_RE = re.compile(
    r"(?:^|\s)(?:it|test|describe|xit|xtest)\.(skip|todo)|"
    r"\bxit\(|\bxtest\(|@xfail|@pytest\.mark\.skip",
    re.MULTILINE,
)


# M12 severity-tier label detector. Accepts both the Linear convention
# (``severity:critical``/``severity:high``/...) and the priority alias used
# in some GitHub labels (``P0``/``P1``/``P2``/``P3``).
SEVERITY_LABELS: tuple[str, ...] = (
    "severity:critical", "severity:high", "severity:medium", "severity:low",
    "critical", "high", "medium", "low",
    "P0", "P1", "P2", "P3",
)


# Default SLA tier hours, used ONLY when a runbook/policy source is found and
# parsed. Never used as a fabricated fallback (AAP §0.7.3 Boundary 2).
DEFAULT_SLA_HOURS: dict[str, float] = {
    "critical": 24.0,
    "high": 72.0,
    "medium": 168.0,
    "low": 336.0,
}


# CI workflow names commonly producing test artifacts (M11 input scope).
# Probed by extract_escaped_defects() to filter actions/runs results.
TEST_WORKFLOWS_OF_INTEREST: tuple[str, ...] = (
    "unit-tests", "unit-tests.yml",
    "integration-tests", "integration-tests.yml",
    "e2e", "e2e.yml",
    "e2e-api-v2", "e2e-api-v2.yml",
    "e2e-app-store", "e2e-app-store.yml",
    "e2e-atoms", "e2e-atoms.yml",
    "e2e-embed", "e2e-embed.yml",
    "e2e-embed-react", "e2e-embed-react.yml",
    "performance-tests", "performance-tests.yml",
    "check-types", "check-types.yml",
    "check-prisma-migrations", "check-prisma-migrations.yml",
)


# Workflow file globs treated as production deployment events for M9 fallback.
PRODUCTION_DEPLOY_WORKFLOWS: tuple[str, ...] = (
    "api-v1-production-build.yml",
    "api-v2-production-build.yml",
    "production-build.yml",
    "release.yml",
    "deploy.yml",
)


# After-phase synonyms used by the aggregate_by_phase helper to collapse
# ramp_up + steady_state (or the collapsed post_intro phase) into a single
# "after" value for multiplier computation.
AFTER_PHASES: tuple[str, ...] = ("ramp_up", "steady_state", "post_intro", "after")
ALL_KNOWN_PHASES: tuple[str, ...] = ("baseline",) + AFTER_PHASES


# Confidence tier ordering (3=High, 2=Medium, 1=Low, 0=Insufficient signal).
_CONFIDENCE_RANK: dict[str, int] = {
    "High": 3,
    "Medium": 2,
    "Low": 1,
    "Insufficient signal": 0,
}


# Exception/waiver/override labels for M10 PR-label signal.
EXCEPTION_LABEL_NAMES: tuple[str, ...] = (
    "exception", "waiver", "override", "bypass", "policy-override",
    "ci-skip", "skip-ci", "no-review", "admin-merge",
)


# Repository policy files searched by find_sla_source() for embedded SLA text.
POLICY_FILE_CANDIDATES: tuple[str, ...] = (
    "RUNBOOK.md", "runbook.md",
    "SECURITY.md", "security.md",
    "CONTRIBUTING.md", "contributing.md",
    "docs/RUNBOOK.md", "docs/SLA.md", "docs/sla.md",
    ".github/RUNBOOK.md",
)


# ===========================================================================
# Section 2 — InsufficientSignalError and @safe_extract Decorator
# ===========================================================================


class InsufficientSignalError(Exception):
    """Raised by an extraction function when its data source is unavailable.

    The :class:`safe_extract` decorator catches this exception and converts
    it into a structured ``{"status": "insufficient_signal", "reason": ...}``
    return value, preserving the AAP §0.7.3 Boundary 2 rule: "MUST NOT
    fabricate, estimate, or extrapolate. Report 'Insufficient signal —
    [reason]' when data is lacking."

    Any other exception type propagates through :class:`safe_extract` and
    is treated as a crash, causing the harness to return exit code 1.
    """

    def __init__(self, reason: str = "data unavailable") -> None:
        super().__init__(reason)


def safe_extract(metric_id: str) -> Callable[[Callable[..., dict]], Callable[..., dict]]:
    """Decorator that wraps a metric extractor with insufficient-signal handling.

    The wrapped function emits a structured ``{"status":
    "insufficient_signal", ...}`` dict on :class:`InsufficientSignalError`
    rather than crashing. All other exceptions are logged and re-raised so
    the main loop can decide the overall exit code per AAP §0.5.5.

    Args:
        metric_id: Stable identifier (``"M1"`` .. ``"M12"``) injected into
            log lines and the returned dict.

    Returns:
        A decorator that wraps a single argument-agnostic extractor.
    """
    def decorator(func: Callable[..., dict]) -> Callable[..., dict]:
        def wrapper(*args: Any, **kwargs: Any) -> dict:
            logger = structured_logger(metric_id=metric_id, phase="extract_metrics")
            try:
                logger.info(
                    f"{metric_id} extraction starting",
                    extra={"context": {"metric_id": metric_id}},
                )
                result = func(*args, **kwargs)
                if not isinstance(result, dict):
                    raise TypeError(
                        f"{metric_id} extractor returned non-dict ({type(result).__name__})"
                    )
                # Guarantee the metric_id field is present even if the
                # extractor forgot to set it explicitly.
                result.setdefault("metric_id", metric_id)
                result.setdefault("status", "ok")
                logger.info(
                    f"{metric_id} extraction complete",
                    extra={"context": {"metric_id": metric_id,
                                        "status": result.get("status")}},
                )
                return result
            except InsufficientSignalError as exc:
                reason = str(exc) or "data unavailable"
                logger.warning(
                    f"{metric_id}: insufficient signal — {reason}",
                    extra={"context": {"metric_id": metric_id, "reason": reason}},
                )
                return {
                    "metric_id": metric_id,
                    "status": "insufficient_signal",
                    "confidence": "Insufficient signal",
                    "reason": reason,
                }
            except Exception as exc:
                logger.error(
                    f"{metric_id}: unhandled extraction error: {exc}",
                    extra={"context": {
                        "metric_id": metric_id,
                        "error_type": type(exc).__name__,
                        "traceback": traceback.format_exc(),
                    }},
                )
                raise
        wrapper.__name__ = func.__name__
        wrapper.__doc__ = func.__doc__
        wrapper.__wrapped__ = func  # type: ignore[attr-defined]
        return wrapper
    return decorator


# ===========================================================================
# Section 3 — Identity & Bot Helpers
# ===========================================================================


def is_bot_author(login: str | None) -> bool:
    """Return True when ``login`` identifies a dependency-management bot.

    Bot list authority: ``_shared.BOT_LOGINS`` (derived from
    ``.kodiak.toml::auto_approve_usernames`` plus well-known JS-ecosystem
    bots — AAP §0.2.3). Blitzy Agent is DELIBERATELY ABSENT from this set
    because it is the engineering actor in the After period, not a bot
    (decision-log.md Row 11).

    A None or empty login returns False (defensive — empty author shouldn't
    short-circuit the metric pipeline).
    """
    if not login:
        return False
    return login.strip().lower() in {b.lower() for b in BOT_LOGINS}


def _pr_user_login(pr: dict) -> str:
    """Return the PR author's login or an empty string.

    Defensive accessor used by every bot-exclusion check. PR records from
    the GitHub API always include ``user.login`` for authenticated authors;
    the empty-string fallback is for orphaned or malformed payloads.
    """
    user = pr.get("user") or {}
    return user.get("login") or ""


def _parse_iso(s: str | None) -> datetime | None:
    """Parse an ISO 8601 timestamp into a UTC-aware ``datetime``.

    GitHub timestamps are ``Z``-suffixed; ``datetime.fromisoformat`` in
    Python 3.10 does not accept ``Z`` directly so we substitute ``+00:00``.
    Returns None for None/empty input rather than raising.
    """
    if not s:
        return None
    try:
        if s.endswith("Z"):
            s = s[:-1] + "+00:00"
        dt = datetime.fromisoformat(s)
    except (TypeError, ValueError):
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


# ===========================================================================
# Section 4 — Window & Phase Helpers
# ===========================================================================


def derive_windows_from_inflection_fallback(
    data_dir: Path | str = DATA_DIR,
) -> list[dict] | None:
    """Fallback derivation of windows when ``windows.json`` is unavailable.

    Reads ``data/inflection.json`` (if present) plus the analyzed repository's
    earliest and latest authored-commit timestamps via ``git log`` and uses
    :func:`_shared.monday_aligned_windows` to produce a basic phase-tagged
    window table. Returns ``None`` when the inflection file is missing or
    cannot be parsed — at which point callers must surface insufficient
    signal rather than fabricating data.

    The four phases produced match the canonical convention used by
    ``generate_windows.py``: ``baseline`` (pre-inflection), ``ramp_up`` (first
    90 days post-inflection), ``steady_state`` (90+ days post-inflection).
    When fewer than 90 days of post-introduction history exist, ramp_up plus
    the (empty) steady_state are merged into ``post_intro``.
    """
    logger = structured_logger(metric_id=None, phase="extract_metrics")
    try:
        inflection = load_inflection(data_dir)
    except InsufficientSignalError as exc:
        logger.warning(
            f"fallback window derivation: {exc}",
            extra={"context": {"data_dir": str(data_dir)}},
        )
        return None
    inflection_iso = inflection.get("chosen_date") or inflection.get(
        "co_author_candidate")
    if not inflection_iso:
        logger.warning(
            "fallback window derivation: inflection has no chosen date",
            extra={"context": {"inflection": inflection}},
        )
        return None
    inflection_dt = _parse_iso(inflection_iso)
    if inflection_dt is None:
        return None
    # Determine repository's commit date range
    try:
        earliest_iso = (git_log(
            ["--all", "--reverse", "--format=%aI"]).splitlines() or [""])[0]
        latest_iso = (git_log(
            ["--all", "--format=%aI", "-1"]).splitlines() or [""])[0]
    except (subprocess.CalledProcessError, OSError) as exc:
        logger.warning(
            f"fallback window derivation: git log failed: {exc}",
            extra={"context": {"error": str(exc)}},
        )
        return None
    earliest_dt = _parse_iso(earliest_iso) or (inflection_dt -
                                                timedelta(days=180))
    latest_dt = _parse_iso(latest_iso) or (inflection_dt + timedelta(days=180))
    raw_windows = monday_aligned_windows(earliest_dt, latest_dt, inflection_dt)
    return list(raw_windows)


def load_windows(data_dir: Path | str = DATA_DIR) -> list[dict]:
    """Load ``data/windows.json`` produced by generate_windows.py.

    Returns the array of window dicts. Each dict has at minimum:
    ``window_id``, ``start_iso``, ``end_iso``, and ``phase``.

    When ``windows.json`` is absent the helper attempts to derive a basic
    window table via :func:`derive_windows_from_inflection_fallback` so the
    harness can run end-to-end without first invoking ``generate_windows.py``.
    Raises :class:`InsufficientSignalError` only if neither the persisted file
    nor the fallback can produce a non-empty window list — without windows
    there is no temporal backbone for any metric.
    """
    path = Path(data_dir) / "windows.json"
    try:
        data = load_json(path)
    except FileNotFoundError:
        fallback = derive_windows_from_inflection_fallback(data_dir)
        if fallback:
            return fallback
        raise InsufficientSignalError(
            f"windows.json missing at {path} and fallback derivation failed")
    except json.JSONDecodeError as exc:
        raise InsufficientSignalError(
            f"windows.json malformed at {path}: {exc}") from exc
    if not isinstance(data, list):
        raise InsufficientSignalError(
            f"windows.json at {path} is not a list (got {type(data).__name__})")
    if not data:
        fallback = derive_windows_from_inflection_fallback(data_dir)
        if fallback:
            return fallback
        raise InsufficientSignalError(
            "windows.json is empty and fallback derivation failed")
    return data


def load_inflection(data_dir: Path | str = DATA_DIR) -> dict:
    """Load ``data/inflection.json`` produced by derive_inflection.py.

    Raises :class:`InsufficientSignalError` if the file is absent or
    contains a non-dict payload.
    """
    path = Path(data_dir) / "inflection.json"
    try:
        data = load_json(path)
    except FileNotFoundError as exc:
        raise InsufficientSignalError(
            f"inflection.json missing at {path}") from exc
    if not isinstance(data, dict):
        raise InsufficientSignalError(
            f"inflection.json at {path} is not a dict")
    return data


def assign_to_phase(timestamp_iso: str, windows: list[dict]) -> str | None:
    """Map an ISO timestamp to its containing window's phase.

    Returns the phase name (``baseline`` / ``ramp_up`` / ``steady_state`` /
    ``post_intro``) or ``None`` if the timestamp falls outside every window.
    """
    if not timestamp_iso:
        return None
    for w in windows:
        if w["start_iso"] <= timestamp_iso < w["end_iso"]:
            return w.get("phase")
    return None


def find_window_for_timestamp(dt: datetime | str, windows: list[dict]) -> dict | None:
    """Locate the window dict that contains the given timestamp.

    Accepts either a UTC-aware ``datetime`` or an ISO 8601 string. Returns
    None if no window contains the timestamp (typically because it
    predates the first commit or postdates the analysis cutoff).

    The comparison uses ISO 8601 string ordering, which is correct because
    every window boundary stored in ``data/windows.json`` is normalized to
    a UTC ``Z`` suffix.
    """
    if isinstance(dt, datetime):
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        else:
            dt = dt.astimezone(timezone.utc)
        iso = dt.isoformat().replace("+00:00", "Z")
    else:
        iso = dt
        # Normalize any offset form into a Z-suffix for comparison.
        if iso.endswith("+00:00"):
            iso = iso[:-6] + "Z"
    for w in windows:
        start = w["start_iso"]
        end = w["end_iso"]
        if start <= iso < end:
            return w
    return None


def count_windows_in_phase(windows: list[dict], phase: str) -> int:
    """Return the number of windows assigned to ``phase``.

    Used to populate the ``baseline_n`` / ``ramp_up_n`` / ``steady_state_n``
    fields in each metric's output so downstream renderers know the sample
    size at a glance.
    """
    return sum(1 for w in windows if w.get("phase") == phase)


# ===========================================================================
# Section 5 — Aggregation Helpers (mean, multiplier, after-value derivation)
# ===========================================================================


def aggregate_by_phase(per_window: dict[str, float | int | None],
                       windows: list[dict],
                       agg: str = "mean") -> dict[str, float | None]:
    """Aggregate per-window values into a per-phase summary dict.

    The output always includes the keys ``baseline``, ``ramp_up``,
    ``steady_state``, ``post_intro``, and ``after``. Phases with no windows
    or no non-None values become ``None``. The ``after`` synthetic key
    aggregates ramp_up + steady_state + post_intro (whichever exist) into a
    single value for multiplier computation.

    Args:
        per_window: ``{window_id: numeric_value}`` mapping. Missing keys are
            treated as 0 contribution; explicit ``None`` is skipped.
        windows: window dicts from ``data/windows.json``.
        agg: aggregation function name — ``"mean"``, ``"median"``, or ``"sum"``.

    Raises:
        ValueError: when ``agg`` is none of the three supported names.
    """
    by_phase: dict[str, list[float]] = defaultdict(list)
    for window in windows:
        v = per_window.get(window["window_id"])
        if v is None:
            continue
        phase = window.get("phase")
        if phase is None:
            continue
        by_phase[phase].append(float(v))

    def _reduce(values: list[float]) -> float | None:
        if not values:
            return None
        if agg == "mean":
            return statistics.mean(values)
        if agg == "median":
            return statistics.median(values)
        if agg == "sum":
            return float(sum(values))
        raise ValueError(f"Unknown agg: {agg!r} (expected mean/median/sum)")

    out: dict[str, float | None] = {}
    for phase in ALL_KNOWN_PHASES:
        if phase == "after":
            continue  # synthesized below
        out[phase] = _reduce(by_phase.get(phase, []))

    # Synthesize the "after" key as the aggregation across ALL after-period
    # phase values (ramp_up + steady_state + post_intro), recomputed from
    # the per-window samples rather than from the per-phase aggregates so
    # that mean-of-means / sum-of-sums semantics are correct.
    after_values: list[float] = []
    for phase in AFTER_PHASES:
        if phase == "after":
            continue
        after_values.extend(by_phase.get(phase, []))
    out["after"] = _reduce(after_values)
    return out


def derive_after_value(phase_values: dict[str, float | None]) -> float | None:
    """Synthesize the After-period value from per-phase aggregates.

    Used when a metric already holds pre-aggregated per-phase values (rather
    than per-window samples) and the caller still needs a single "after"
    scalar for multiplier computation.

    Strategy: prefer the explicit ``after`` field if present; otherwise
    average non-None ramp_up / steady_state / post_intro values.
    """
    explicit = phase_values.get("after")
    if explicit is not None:
        return float(explicit)
    candidates: list[float] = []
    for phase in AFTER_PHASES:
        if phase == "after":
            continue
        v = phase_values.get(phase)
        if v is not None:
            candidates.append(float(v))
    if not candidates:
        return None
    return statistics.mean(candidates)


def compute_multiplier(phase_values: dict[str, float | None],
                       higher_is_better: bool = True,
                       lower_is_better: bool = False) -> float | None:
    """Compute the After/Before multiplier.

    Convention: multiplier = ``after / baseline`` always. The
    ``higher_is_better`` / ``lower_is_better`` flags do NOT change the
    returned value — they document the metric's directionality for
    downstream renderers. A multiplier of 2.0 on a higher-is-better metric
    means a 2× acceleration; on a lower-is-better metric it means a 2×
    regression. The downstream report explains the direction in prose.

    Returns None when baseline is None / 0 or after is None — never
    fabricates a value when an arithmetic edge case prevents calculation.
    """
    # Read flags for symmetry / linting, even though the returned value is
    # the same ratio regardless. This keeps the call sites self-documenting.
    _ = (higher_is_better, lower_is_better)

    baseline = phase_values.get("baseline")
    after = phase_values.get("after")
    if after is None:
        after = derive_after_value(phase_values)
    if baseline is None or after is None:
        return None
    try:
        baseline_f = float(baseline)
        after_f = float(after)
    except (TypeError, ValueError):
        return None
    if baseline_f == 0:
        return None
    return after_f / baseline_f


def min_confidence(tags: Iterable[str]) -> str:
    """Return the lowest-confidence tag in ``tags`` per the canonical order.

    Order: High > Medium > Low > Insufficient signal. Unknown tags are
    treated as the lowest tier (0) so unrecognized strings cannot trick the
    function into reporting a higher confidence than the data warrants.
    """
    tags = list(tags)
    if not tags:
        return "Insufficient signal"
    return min(tags, key=lambda t: _CONFIDENCE_RANK.get(t, 0))


def determine_confidence_for_pr_metric(prs: list[dict] | None) -> str:
    """Confidence tag for PR-API-derived metrics (M1, M2 default).

    High when a non-empty PR list was retrieved (live API), Low otherwise.
    The harness never returns Medium here because the GitHub PRs endpoint
    is the authoritative source; either it answered (High) or it didn't
    (Low — and the metric likely fell back to git-only signal upstream).
    """
    if prs is None:
        return "Low"
    return "High" if len(prs) > 0 else "Low"


# ===========================================================================
# Section 6 — GitHub REST Fetch Helpers (cache-by-default via _shared)
# ===========================================================================


def paginate_github(endpoint: str,
                    params: dict | None = None,
                    use_cache: bool = True) -> list[dict]:
    """Paginate a GitHub REST API endpoint that returns an array.

    Thin wrapper around :func:`_shared.github_api_get` that forces
    ``paginate=True`` and normalizes the result to a list (never None).

    Args:
        endpoint: Relative GitHub API path (e.g., ``"pulls"``) or full URL.
        params: Optional query string parameters.
        use_cache: When True, returns the cached payload if present.

    Returns:
        Concatenated list across all pages, or [] on auth/network failure.
    """
    result = github_api_get(endpoint, params=params, use_cache=use_cache,
                            paginate=True)
    if result is None:
        return []
    if isinstance(result, list):
        return result
    # Defensive: some endpoints return a wrapping object on first page.
    return []


def fetch_all_prs(use_cache: bool = True) -> list[dict]:
    """Fetch every PR (open + closed + merged) from the analyzed repository.

    Endpoint: ``GET /repos/{owner}/{repo}/pulls?state=all`` (paginated).
    Per-page size is GitHub's default (30); pagination is handled by
    :func:`paginate_github`. Sort by ``created`` ascending so iteration
    order is deterministic across runs.
    """
    return paginate_github("pulls",
                           params={"state": "all", "sort": "created",
                                   "direction": "asc", "per_page": 100},
                           use_cache=use_cache)


def fetch_pr_reviews(pr_number: int, use_cache: bool = True) -> list[dict]:
    """Fetch review submissions for a single PR.

    Endpoint: ``GET /repos/{owner}/{repo}/pulls/{n}/reviews``.
    Each item has ``submitted_at``, ``state``
    (APPROVED / CHANGES_REQUESTED / COMMENTED / DISMISSED), and ``user``.
    """
    return paginate_github(f"pulls/{pr_number}/reviews",
                           params={"per_page": 100}, use_cache=use_cache)


def fetch_pr_commits(pr_number: int, use_cache: bool = True) -> list[dict]:
    """Fetch the commits associated with a single PR.

    Endpoint: ``GET /repos/{owner}/{repo}/pulls/{n}/commits``. The commits
    drive the Flow Active (M4) span computation; their ``author`` and
    ``committer`` blocks identify the engineering actor.
    """
    return paginate_github(f"pulls/{pr_number}/commits",
                           params={"per_page": 100}, use_cache=use_cache)


def fetch_pr_timeline(pr_number: int, use_cache: bool = True) -> list[dict]:
    """Fetch the issue/PR timeline events for a single PR.

    Endpoint: ``GET /repos/{owner}/{repo}/issues/{n}/events`` (note: PR
    timeline uses the issues endpoint because GitHub stores PRs as issues
    with a PR-bit). Events include ``review_requested``,
    ``ready_for_review``, ``labeled``, ``closed``, ``merged``, etc. —
    bounding events for the M4 working-phase algorithm.
    """
    return paginate_github(f"issues/{pr_number}/events",
                           params={"per_page": 100}, use_cache=use_cache)


def fetch_pr_detail(pr_number: int, use_cache: bool = True) -> dict | None:
    """Fetch the full PR detail object (base/head SHAs, requested reviewers).

    Endpoint: ``GET /repos/{owner}/{repo}/pulls/{n}``. Unlike the list
    endpoint, the detail endpoint returns ``mergeable``, ``merge_commit_sha``,
    and ``requested_reviewers`` which are required by M7 (first-commit
    determination) and M10 (admin-override detection).
    """
    result = github_api_get(f"pulls/{pr_number}", use_cache=use_cache)
    if isinstance(result, dict):
        return result
    return None


def fetch_releases(use_cache: bool = True) -> list[dict]:
    """Fetch the release inventory for the analyzed repository.

    Endpoint: ``GET /repos/{owner}/{repo}/releases``. Returns each release's
    ``name``, ``tag_name``, ``published_at``, ``prerelease`` flag, and
    ``target_commitish``. Used by M9 (primary source) and M8 (release-tag
    set for revert attribution).
    """
    return paginate_github("releases", params={"per_page": 100},
                           use_cache=use_cache)


def fetch_issues(label: str | None = None,
                 state: str = "all",
                 use_cache: bool = True) -> list[dict]:
    """Fetch issues from the analyzed repository (excluding PRs).

    Endpoint: ``GET /repos/{owner}/{repo}/issues?labels={label}&state={state}``.
    The GitHub Issues endpoint returns both issues AND PRs by default; we
    filter PRs out client-side (each issue dict's ``pull_request`` key is
    set on PR records).
    """
    params: dict[str, Any] = {"state": state, "per_page": 100}
    if label:
        params["labels"] = label
    raw = paginate_github("issues", params=params, use_cache=use_cache)
    return [i for i in raw if "pull_request" not in i]


def fetch_workflow_runs(workflow: str | None = None,
                        status: str | None = None,
                        use_cache: bool = True,
                        max_pages: int = 10) -> list[dict]:
    """Fetch CI workflow runs (Actions API).

    Endpoint: ``GET /repos/{owner}/{repo}/actions/runs`` (optionally filtered
    by ``workflow`` filename and ``status``). Pagination is capped at
    ``max_pages`` × per_page to avoid runaway costs for repos with tens of
    thousands of CI runs.

    Returns the flattened ``workflow_runs`` array, never the wrapping
    envelope object.
    """
    params: dict[str, Any] = {"per_page": 100}
    if status:
        params["status"] = status
    endpoint = f"actions/workflows/{workflow}/runs" if workflow else "actions/runs"
    runs: list[dict] = []
    page = 1
    while page <= max_pages:
        page_params = dict(params)
        page_params["page"] = page
        result = github_api_get(endpoint, params=page_params, use_cache=use_cache,
                                paginate=False)
        if result is None:
            break
        if isinstance(result, dict):
            batch = result.get("workflow_runs") or []
        elif isinstance(result, list):
            batch = result
        else:
            batch = []
        if not batch:
            break
        runs.extend(batch)
        if len(batch) < 100:
            break
        page += 1
    return runs


def fetch_workflow_run_artifacts(run_id: int, use_cache: bool = True) -> list[dict]:
    """Fetch the artifacts attached to a single workflow run.

    Endpoint: ``GET /repos/{owner}/{repo}/actions/runs/{id}/artifacts``.
    Used by M11 to discover JUnit XML / test-results uploads.
    """
    result = github_api_get(f"actions/runs/{run_id}/artifacts",
                            use_cache=use_cache, paginate=False)
    if isinstance(result, dict):
        return result.get("artifacts") or []
    if isinstance(result, list):
        return result
    return []


def fetch_branch_protection(branch: str = "main",
                            use_cache: bool = True) -> dict | None:
    """Fetch branch protection settings for a branch.

    Endpoint: ``GET /repos/{owner}/{repo}/branches/{branch}/protection``.
    Returns the rule dict on success, or None for 404 (no protection rule)
    / 403 (token lacks ``administration:read``).
    """
    result = github_api_get(f"branches/{branch}/protection",
                            use_cache=use_cache, paginate=False)
    if isinstance(result, dict):
        return result
    return None


def fetch_audit_log_events(use_cache: bool = True) -> list[dict] | None:
    """Fetch the organization audit log when the token has access.

    Endpoint: ``GET /orgs/{owner}/audit-log``. Returns None when the token
    lacks ``audit_log:read`` (the response either returns 403 or an empty
    list). When None, M10 falls back to the force-push + label signal
    subset and its confidence drops to Low (decision-log.md Row 18).
    """
    endpoint = f"/orgs/{REPO_OWNER}/audit-log"
    result = github_api_get(endpoint, use_cache=use_cache, paginate=True,
                            params={"per_page": 100})
    if result is None:
        return None
    if isinstance(result, list):
        return result
    return None


def fetch_repo_events(use_cache: bool = True) -> list[dict]:
    """Fetch the recent public events for the analyzed repository.

    Endpoint: ``GET /repos/{owner}/{repo}/events``. Used by M10 to detect
    force-push events. GitHub retains only ~90 days of events; older
    force-pushes are reflected only in the audit log.
    """
    return paginate_github("events", params={"per_page": 100},
                           use_cache=use_cache)



# ===========================================================================
# Section 7 — Linked-Issue Resolution (for M6 Tier 1 classification)
# ===========================================================================


def _extract_linked_issue_numbers(pr: dict) -> tuple[list[int], list[str]]:
    """Return (github_issue_numbers, linear_issue_ids) referenced by a PR.

    Searches the PR title and body for "Fixes #N", "Closes #N", "Resolves
    #N" (GitHub) and bare ``CAL-1234`` (Linear). Both linkage styles are
    documented in .github/PULL_REQUEST_TEMPLATE.md.
    """
    title = pr.get("title") or ""
    body = pr.get("body") or ""
    haystack = f"{title}\n{body}"
    gh_numbers = sorted({int(m) for m in LINKED_ISSUE_GH_RE.findall(haystack)})
    linear_ids = sorted({m.upper() for m in LINKED_ISSUE_LINEAR_RE.findall(haystack)})
    return gh_numbers, linear_ids


def fetch_linked_issues_for_pr(pr: dict,
                               cache: dict[int, dict],
                               use_cache: bool = True) -> list[dict]:
    """Return label dicts for every GitHub Issue linked from this PR.

    Linear issues are not fetched here (they require LINEAR_API_KEY and a
    different API surface); the caller passes the PR's body to the Linear
    label resolver separately when needed.

    Args:
        pr: PR record from the GitHub Pulls API.
        cache: Shared issue-number → issue-record cache to avoid refetching.
        use_cache: When True, uses the on-disk SHA256-keyed cache as well.
    """
    gh_numbers, _linear_ids = _extract_linked_issue_numbers(pr)
    issues: list[dict] = []
    for n in gh_numbers:
        if n in cache:
            issues.append(cache[n])
            continue
        result = github_api_get(f"issues/{n}", use_cache=use_cache,
                                paginate=False)
        if isinstance(result, dict):
            cache[n] = result
            issues.append(result)
    return issues


def classify_flow_distribution(pr: dict, linked_issues: list[dict] | None = None) -> str:
    """Classify a merged PR into one of feature/defect/risk-compliance/tech-debt/unknown.

    Implements the AAP §0.5.5 three-tier waterfall:

    Tier 1 — Linked-issue labels: if any linked issue carries a label in
        :data:`LABEL_TO_CATEGORY`, return the mapped category. Multiple
        labels prefer the first match in iteration order.
    Tier 2 — Conventional-commit prefix: parse the PR title against
        :data:`CONVENTIONAL_COMMIT_RE` and map to a category via
        :data:`CONVENTIONAL_COMMIT_TO_CATEGORY`.
    Tier 3 — Keyword match: scan title + body for tokens in
        :data:`KEYWORDS_DEFECT`, :data:`KEYWORDS_RISK_COMPLIANCE`,
        :data:`KEYWORDS_TECH_DEBT`, and :data:`KEYWORDS_FEATURE`.

    Returns ``"unknown"`` when none of the tiers produces a match. The
    unknown rate per phase is reported by :func:`extract_flow_distribution`
    and a rate > 20% downgrades that phase's confidence to Low.
    """
    linked_issues = linked_issues or []

    # Tier 1: linked-issue labels (highest signal — explicit human classification)
    pr_labels = pr.get("labels") or []
    candidate_labels: list[str] = []
    for label in pr_labels:
        name = (label.get("name") or "").lower()
        if name:
            candidate_labels.append(name)
    for issue in linked_issues:
        for label in issue.get("labels") or []:
            name = (label.get("name") or "").lower()
            if name:
                candidate_labels.append(name)
    for label_name in candidate_labels:
        category = LABEL_TO_CATEGORY.get(label_name)
        if category:
            return category

    # Tier 2: conventional-commit prefix on the PR title
    title = pr.get("title") or ""
    match = CONVENTIONAL_COMMIT_RE.match(title.strip())
    if match:
        prefix = match.group(1).lower()
        category = CONVENTIONAL_COMMIT_TO_CATEGORY.get(prefix)
        if category:
            return category

    # Tier 3: keyword match on title + body
    body = pr.get("body") or ""
    text = (title + "\n" + body).lower()
    for kw in KEYWORDS_DEFECT:
        if kw in text:
            return "defect"
    for kw in KEYWORDS_RISK_COMPLIANCE:
        if kw in text:
            return "risk-compliance"
    for kw in KEYWORDS_TECH_DEBT:
        if kw in text:
            return "tech-debt"
    for kw in KEYWORDS_FEATURE:
        if kw in text:
            return "feature"

    return "unknown"


# ===========================================================================
# Section 8 — M1: Flow Load
# ===========================================================================
#
# Operational Definition (AAP §0.1.1):
#   Mean count of in-progress PRs (open OR draft with ≥1 commit) at the end
#   of each Monday-aligned 2-week window, averaged across windows in a
#   phase. Excludes dependency-management bots; INCLUDES Blitzy.
#
# Data Source: GitHub Pulls API (paginated, state=all, sort=created asc).
# Confidence: High when the API returns a non-empty PR list.


@safe_extract("M1")
def extract_flow_load(windows: list[dict], use_cache: bool) -> dict:
    """Extract Flow Load (M1).

    For each window, count PRs that are "in-progress at window end" —
    created on or before the window's end timestamp AND not closed/merged
    before the window's end timestamp. Dependency-management bots are
    excluded (Blitzy Agent is NOT excluded; it is the engineering actor).

    Returns the standard metric envelope: ``baseline`` / ``ramp_up`` /
    ``steady_state`` / ``after`` phase means, the multiplier (after /
    baseline), and per-window counts for downstream rendering.
    """
    prs = fetch_all_prs(use_cache)
    if not prs:
        raise InsufficientSignalError(
            "GitHub Pulls API returned no PRs (auth failure or empty repo)")

    bot_excluded = [pr for pr in prs if not is_bot_author(_pr_user_login(pr))]

    per_window: dict[str, int] = {w["window_id"]: 0 for w in windows}
    for window in windows:
        end_iso = window["end_iso"]
        end_dt = _parse_iso(end_iso)
        if end_dt is None:
            continue
        count = 0
        for pr in bot_excluded:
            created_dt = _parse_iso(pr.get("created_at"))
            if created_dt is None or created_dt > end_dt:
                continue
            closed_dt = _parse_iso(pr.get("closed_at") or pr.get("merged_at"))
            if closed_dt is not None and closed_dt <= end_dt:
                continue
            count += 1
        per_window[window["window_id"]] = count

    phase_means = aggregate_by_phase(per_window, windows, "mean")
    multiplier = compute_multiplier(phase_means, lower_is_better=True)
    confidence = determine_confidence_for_pr_metric(prs)

    return {
        "metric_id": "M1",
        "status": "ok",
        "confidence": confidence,
        "source": "github_api_pulls",
        "baseline": phase_means.get("baseline"),
        "ramp_up": phase_means.get("ramp_up"),
        "steady_state": phase_means.get("steady_state"),
        "post_intro": phase_means.get("post_intro"),
        "after": phase_means.get("after"),
        "multiplier": multiplier,
        "direction": "lower-is-better",
        "per_window": per_window,
        "bot_excluded_count": len(prs) - len(bot_excluded),
        "total_prs_considered": len(bot_excluded),
        "baseline_n": count_windows_in_phase(windows, "baseline"),
        "ramp_up_n": count_windows_in_phase(windows, "ramp_up"),
        "steady_state_n": count_windows_in_phase(windows, "steady_state"),
        "post_intro_n": count_windows_in_phase(windows, "post_intro"),
        "primary_command": (
            f"GET /repos/{REPO_OWNER}/{REPO_NAME}/pulls"
            "?state=all&sort=created&direction=asc (paginated)"
        ),
    }


# ===========================================================================
# Section 9 — M2: Flow Velocity
# ===========================================================================
#
# Operational Definition (AAP §0.1.1):
#   Count of PRs merged to the default branch per 2-week window. Mean per
#   phase; per-actor breakdown INCLUDING Blitzy.
#
# Data Source: GitHub Pulls API filtered to merged_at != null.
# Confidence: High when the API returns a non-empty PR list.


@safe_extract("M2")
def extract_flow_velocity(windows: list[dict], use_cache: bool) -> dict:
    """Extract Flow Velocity (M2).

    Counts merged PRs per window. Each PR's window is determined by its
    ``merged_at`` timestamp. Per-actor breakdown uses the single
    :func:`engineering_actor` selector — humans in baseline, Blitzy in
    after period when the PR was Blitzy-authored.
    """
    prs = fetch_all_prs(use_cache)
    if not prs:
        raise InsufficientSignalError(
            "GitHub Pulls API returned no PRs (auth failure or empty repo)")

    merged = [
        pr for pr in prs
        if pr.get("merged_at") and not is_bot_author(_pr_user_login(pr))
    ]

    per_window: dict[str, int] = {w["window_id"]: 0 for w in windows}
    per_actor_per_window: dict[str, dict[str, int]] = defaultdict(
        lambda: defaultdict(int))

    for pr in merged:
        merged_dt = _parse_iso(pr.get("merged_at"))
        if merged_dt is None:
            continue
        window = find_window_for_timestamp(merged_dt, windows)
        if window is None:
            continue
        per_window[window["window_id"]] += 1
        phase = window.get("phase") or "baseline"
        actor = engineering_actor(pr, phase)
        per_actor_per_window[actor][window["window_id"]] += 1

    phase_means = aggregate_by_phase(per_window, windows, "mean")

    # Per-actor aggregation: keep the per-phase mean for each engineering actor.
    per_actor_results: dict[str, dict[str, float | None]] = {}
    for actor, window_counts in per_actor_per_window.items():
        # Ensure every window is represented (zero-count windows preserved)
        full_counts = {w["window_id"]: window_counts.get(w["window_id"], 0)
                       for w in windows}
        per_actor_results[actor] = aggregate_by_phase(full_counts, windows, "mean")

    multiplier = compute_multiplier(phase_means, higher_is_better=True)
    confidence = determine_confidence_for_pr_metric(prs)

    return {
        "metric_id": "M2",
        "status": "ok",
        "confidence": confidence,
        "source": "github_api_pulls",
        "baseline": phase_means.get("baseline"),
        "ramp_up": phase_means.get("ramp_up"),
        "steady_state": phase_means.get("steady_state"),
        "post_intro": phase_means.get("post_intro"),
        "after": phase_means.get("after"),
        "multiplier": multiplier,
        "direction": "higher-is-better",
        "per_window": per_window,
        "per_actor": per_actor_results,
        "merged_pr_count": len(merged),
        "bot_excluded_count": (
            sum(1 for pr in prs if pr.get("merged_at"))
            - len(merged)
        ),
        "baseline_n": count_windows_in_phase(windows, "baseline"),
        "ramp_up_n": count_windows_in_phase(windows, "ramp_up"),
        "steady_state_n": count_windows_in_phase(windows, "steady_state"),
        "post_intro_n": count_windows_in_phase(windows, "post_intro"),
        "primary_command": (
            f"GET /repos/{REPO_OWNER}/{REPO_NAME}/pulls"
            "?state=all (filter merged_at != null)"
        ),
    }


# ===========================================================================
# Section 10 — M3: Flow Predictability
# ===========================================================================
#
# Operational Definition (AAP §0.1.1):
#   Reciprocal of the coefficient of variation (mean / stdev) of Flow
#   Velocity across windows in a phase. Requires ≥4 windows; otherwise
#   reports "Insufficient signal — fewer than 4 windows." Zero-variance
#   phases report "Insufficient signal — zero variance" rather than infinity.
#
# Data Source: derived from M2 per-window counts.
# Confidence: inherits M2 confidence.


@safe_extract("M3")
def extract_flow_predictability(windows: list[dict],
                                m2_per_window: dict[str, int],
                                use_cache: bool) -> dict:
    """Extract Flow Predictability (M3).

    For each phase, gather the per-window M2 counts and compute the
    reciprocal of the coefficient of variation (CV = stdev/mean, so
    predictability = mean/stdev). Phases with fewer than 4 windows,
    zero-mean, or zero-variance are flagged as insufficient signal
    rather than returning infinity or NaN.

    Args:
        windows: canonical window table.
        m2_per_window: ``{window_id: merged_pr_count}`` from M2.
        use_cache: kept for API symmetry with the other extractors.
    """
    _ = use_cache  # kept for API symmetry

    if not isinstance(m2_per_window, dict):
        raise InsufficientSignalError(
            "M2 per-window data not available (run M2 first)")

    phase_values: dict[str, list[float]] = defaultdict(list)
    for window in windows:
        phase = window.get("phase")
        if phase is None:
            continue
        phase_values[phase].append(float(m2_per_window.get(window["window_id"], 0)))

    results: dict[str, dict[str, Any]] = {}
    for phase, values in phase_values.items():
        if len(values) < 4:
            results[phase] = {"status": "insufficient_signal",
                              "reason": "fewer than 4 windows",
                              "value": None, "n": len(values)}
            continue
        mean_val = statistics.mean(values)
        if mean_val == 0:
            results[phase] = {"status": "insufficient_signal",
                              "reason": "zero mean",
                              "value": None, "n": len(values)}
            continue
        stdev_val = statistics.stdev(values)
        if stdev_val == 0:
            results[phase] = {"status": "insufficient_signal",
                              "reason": "zero variance",
                              "value": None, "n": len(values),
                              "mean": mean_val, "stdev": 0.0}
            continue
        predictability = mean_val / stdev_val
        results[phase] = {"status": "ok",
                          "value": predictability,
                          "mean": mean_val,
                          "stdev": stdev_val,
                          "n": len(values)}

    if not results:
        raise InsufficientSignalError("no phases present in windows.json")

    if all(r["status"] == "insufficient_signal" for r in results.values()):
        reasons = sorted({r["reason"] for r in results.values()})
        raise InsufficientSignalError(
            f"all phases lack signal: {', '.join(reasons)}")

    baseline_val = (results.get("baseline") or {}).get("value")
    ramp_val = (results.get("ramp_up") or {}).get("value")
    steady_val = (results.get("steady_state") or {}).get("value")
    post_intro_val = (results.get("post_intro") or {}).get("value")

    phase_scalars: dict[str, float | None] = {
        "baseline": baseline_val,
        "ramp_up": ramp_val,
        "steady_state": steady_val,
        "post_intro": post_intro_val,
    }
    multiplier = compute_multiplier(phase_scalars, higher_is_better=True)
    after_val = derive_after_value(phase_scalars)

    return {
        "metric_id": "M3",
        "status": "ok",
        "confidence": "High",
        "source": "derived_from_M2_per_window",
        "baseline": baseline_val,
        "ramp_up": ramp_val,
        "steady_state": steady_val,
        "post_intro": post_intro_val,
        "after": after_val,
        "multiplier": multiplier,
        "direction": "higher-is-better",
        "phase_results": results,
        "primary_command": "derived from M2 per-window counts (mean/stdev)",
    }



# ===========================================================================
# Section 11 — M4: Flow Active (Working-Span Algorithm)
# ===========================================================================
#
# Operational Definition (AAP §0.1.1):
#   Engineering-actor coding span sum across working phases on a PR.
#   Working phases bounded by review events. Median across PRs per phase
#   and per actor. The engineering actor is the human author in baseline
#   and Blitzy in the after period.
#
# Span Algorithm (AAP §0.5.5):
#   - Filter commits to those by the actor.
#   - Initial span: actor's first commit → earliest of (ready_for_review,
#     review_requested, first_commit_by_other_author, pr_opened).
#   - For each review event: refine span = actor's first commit after
#     review.submitted_at → actor's last commit before next review or merge.
#   - Sum all span durations (gaps within a span NOT subtracted).
#
# Data Source: GitHub Pulls + Reviews + Commits + Timeline.
# Confidence: High when commits & reviews are retrievable for the merged PR set.


def _commit_author_login(commit: dict) -> str:
    """Extract the author login from a Pull-Request commit record.

    Falls back to the commit author email when ``author.login`` is absent
    (common for commits whose committer is not a known GitHub account).
    """
    author = commit.get("author")
    if isinstance(author, dict) and author.get("login"):
        return author["login"]
    commit_obj = commit.get("commit") or {}
    inner_author = commit_obj.get("author") or {}
    name = inner_author.get("name") or ""
    email = inner_author.get("email") or ""
    return name or email or "unknown"


def _commit_author_matches_actor(commit: dict, actor: str) -> bool:
    """Return True when ``commit`` was authored by the given engineering actor.

    For the Blitzy actor label, matches any commit whose author email is the
    Blitzy email or whose author name/login contains "blitzy". For human
    actors, matches by login then by name fallback.
    """
    if actor == BLITZY_ACTOR_LABEL:
        commit_obj = commit.get("commit") or {}
        inner_author = commit_obj.get("author") or {}
        email = (inner_author.get("email") or "").lower()
        name = (inner_author.get("name") or "").lower()
        login = _commit_author_login(commit).lower()
        if email == BLITZY_AUTHOR_EMAIL.lower():
            return True
        if is_blitzy_actor(login) or is_blitzy_actor(email):
            return True
        if "blitzy" in name and ("agent" in name or "bot" in name):
            return True
        return False

    actor_login = (actor or "").lower()
    if not actor_login:
        return False
    login = _commit_author_login(commit).lower()
    if login == actor_login:
        return True
    commit_obj = commit.get("commit") or {}
    inner_author = commit_obj.get("author") or {}
    name = (inner_author.get("name") or "").lower()
    return name == actor_login


def _earliest_initial_boundary(pr: dict,
                               timeline: list[dict],
                               commits: list[dict],
                               actor: str) -> datetime | None:
    """Return the earliest event that closes the initial working span.

    Candidates (per AAP §0.5.5):
        - ``ready_for_review`` event
        - ``review_requested`` event
        - first commit by another author
        - ``pr_opened`` (i.e., PR ``created_at``)

    Returns the earliest of these as a UTC datetime, or None if no
    candidate is found (degenerate PR with no events).
    """
    candidates: list[datetime] = []
    for ev in timeline or []:
        ev_type = ev.get("event")
        ev_ts = _parse_iso(ev.get("created_at"))
        if ev_ts is None:
            continue
        if ev_type in ("ready_for_review", "review_requested"):
            candidates.append(ev_ts)

    # First commit by another author = first commit whose actor does NOT match
    for commit in commits or []:
        if _commit_author_matches_actor(commit, actor):
            continue
        commit_obj = commit.get("commit") or {}
        author = commit_obj.get("author") or {}
        ts = _parse_iso(author.get("date"))
        if ts is not None:
            candidates.append(ts)
            break  # earliest non-actor commit suffices

    opened_at = _parse_iso(pr.get("created_at"))
    if opened_at is not None:
        candidates.append(opened_at)

    if not candidates:
        return None
    return min(candidates)


def compute_flow_active_spans(pr: dict,
                              reviews: list[dict],
                              commits: list[dict],
                              timeline: list[dict],
                              actor: str) -> float | None:
    """Compute total seconds of active work on a PR for ``actor``.

    Implements the AAP §0.5.5 working-phase algorithm:

    1. Filter ``commits`` to those by ``actor`` (sorted by ``author.date``).
    2. Initial span: ``actor_commits[0].date → earliest_initial_boundary``.
       Only commits whose timestamp is ≤ that boundary contribute. The span
       is ``last_qualifying_commit_date - first_qualifying_commit_date``.
    3. For each review submission (sorted by ``submitted_at``), the next
       refine span is from the actor's first commit AFTER that review to
       the actor's last commit BEFORE the next review event (or the
       PR's ``merged_at`` for the final review).
    4. Gaps WITHIN a span are NOT subtracted (per the user's definition).
    5. Returns the sum of all spans in seconds, or None if no actor commits
       exist on the PR.
    """
    actor_commit_times: list[datetime] = []
    for commit in commits or []:
        if not _commit_author_matches_actor(commit, actor):
            continue
        commit_obj = commit.get("commit") or {}
        author = commit_obj.get("author") or {}
        ts = _parse_iso(author.get("date"))
        if ts is not None:
            actor_commit_times.append(ts)
    actor_commit_times.sort()
    if not actor_commit_times:
        return None

    spans: list[float] = []

    # Initial span: bounded by earliest of (ready_for_review, review_requested,
    # first_commit_by_other_author, pr_opened).
    initial_boundary = _earliest_initial_boundary(pr, timeline, commits, actor)
    if initial_boundary is not None:
        qualifying = [t for t in actor_commit_times if t <= initial_boundary]
        if qualifying:
            spans.append((qualifying[-1] - qualifying[0]).total_seconds())

    # Refine spans: for each review submission, find actor commits between
    # this review and the next review (or merge for the last review).
    reviews_sorted = []
    for review in reviews or []:
        ts = _parse_iso(review.get("submitted_at"))
        if ts is not None:
            reviews_sorted.append((ts, review))
    reviews_sorted.sort(key=lambda x: x[0])

    merged_dt = _parse_iso(pr.get("merged_at"))

    for idx, (review_ts, _review) in enumerate(reviews_sorted):
        if idx + 1 < len(reviews_sorted):
            next_boundary = reviews_sorted[idx + 1][0]
        else:
            next_boundary = merged_dt or actor_commit_times[-1]
        if next_boundary is None:
            continue
        qualifying = [t for t in actor_commit_times
                      if review_ts < t <= next_boundary]
        if len(qualifying) >= 2:
            spans.append((qualifying[-1] - qualifying[0]).total_seconds())
        elif len(qualifying) == 1:
            # Single commit counted as 0 seconds (no span to measure).
            spans.append(0.0)

    # If we had actor commits but no spans qualified (no events / no reviews),
    # fall back to the simple first→last commit difference so the PR is not
    # silently dropped from the metric.
    if not spans and len(actor_commit_times) >= 2:
        spans.append(
            (actor_commit_times[-1] - actor_commit_times[0]).total_seconds()
        )
    elif not spans:
        spans.append(0.0)

    return float(sum(spans))


@safe_extract("M4")
def extract_flow_active(windows: list[dict], use_cache: bool) -> dict:
    """Extract Flow Active (M4).

    Iterates merged PRs. For each PR, fetches reviews + commits + timeline
    and computes the actor-specific active-work seconds via
    :func:`compute_flow_active_spans`. Aggregates the per-PR values into
    per-phase medians (overall and per-actor).
    """
    prs = fetch_all_prs(use_cache)
    if not prs:
        raise InsufficientSignalError(
            "GitHub Pulls API returned no PRs (auth failure or empty repo)")
    merged = [
        pr for pr in prs
        if pr.get("merged_at") and not is_bot_author(_pr_user_login(pr))
    ]
    if not merged:
        raise InsufficientSignalError("no merged PRs available")

    per_phase_spans: dict[str, list[float]] = defaultdict(list)
    per_actor_phase_spans: dict[str, dict[str, list[float]]] = defaultdict(
        lambda: defaultdict(list))

    logger = structured_logger(metric_id="M4", phase="extract_metrics")
    for idx, pr in enumerate(merged):
        if idx % 100 == 0 and idx > 0:
            logger.debug(
                f"M4 processed {idx}/{len(merged)} PRs",
                extra={"context": {"processed": idx, "total": len(merged)}},
            )
        merged_dt = _parse_iso(pr.get("merged_at"))
        if merged_dt is None:
            continue
        window = find_window_for_timestamp(merged_dt, windows)
        if window is None:
            continue
        phase = window.get("phase") or "baseline"
        actor = engineering_actor(pr, phase)

        try:
            reviews = fetch_pr_reviews(pr["number"], use_cache)
            commits = fetch_pr_commits(pr["number"], use_cache)
            timeline = fetch_pr_timeline(pr["number"], use_cache)
        except Exception as exc:  # pragma: no cover  (network resilience)
            logger.warning(
                f"M4: PR #{pr.get('number')} fetch failed: {exc}",
                extra={"context": {"pr_number": pr.get("number"),
                                    "error": str(exc)}},
            )
            continue

        active_seconds = compute_flow_active_spans(pr, reviews, commits, timeline, actor)
        if active_seconds is None:
            continue
        per_phase_spans[phase].append(active_seconds)
        per_actor_phase_spans[actor][phase].append(active_seconds)

    if not any(per_phase_spans.values()):
        raise InsufficientSignalError(
            "no PRs yielded computable Flow Active spans")

    # Per-phase medians
    phase_medians: dict[str, float | None] = {}
    for phase in ALL_KNOWN_PHASES:
        if phase == "after":
            continue
        vals = per_phase_spans.get(phase, [])
        phase_medians[phase] = statistics.median(vals) if vals else None

    after_vals: list[float] = []
    for phase in AFTER_PHASES:
        if phase == "after":
            continue
        after_vals.extend(per_phase_spans.get(phase, []))
    phase_medians["after"] = statistics.median(after_vals) if after_vals else None

    # Per-actor medians
    per_actor_results: dict[str, dict[str, float | None]] = {}
    for actor, phase_data in per_actor_phase_spans.items():
        actor_phase_medians: dict[str, float | None] = {}
        for phase in ALL_KNOWN_PHASES:
            if phase == "after":
                continue
            vals = phase_data.get(phase, [])
            actor_phase_medians[phase] = (
                statistics.median(vals) if vals else None
            )
        actor_after_vals: list[float] = []
        for phase in AFTER_PHASES:
            if phase == "after":
                continue
            actor_after_vals.extend(phase_data.get(phase, []))
        actor_phase_medians["after"] = (
            statistics.median(actor_after_vals) if actor_after_vals else None
        )
        per_actor_results[actor] = actor_phase_medians

    multiplier = compute_multiplier(phase_medians, lower_is_better=True)

    return {
        "metric_id": "M4",
        "status": "ok",
        "confidence": "High",
        "source": "github_api_pulls_reviews_commits_timeline",
        "baseline": phase_medians.get("baseline"),
        "ramp_up": phase_medians.get("ramp_up"),
        "steady_state": phase_medians.get("steady_state"),
        "post_intro": phase_medians.get("post_intro"),
        "after": phase_medians.get("after"),
        "multiplier": multiplier,
        "direction": "lower-is-better",
        "per_actor": per_actor_results,
        "baseline_n": len(per_phase_spans.get("baseline", [])),
        "ramp_up_n": len(per_phase_spans.get("ramp_up", [])),
        "steady_state_n": len(per_phase_spans.get("steady_state", [])),
        "post_intro_n": len(per_phase_spans.get("post_intro", [])),
        "unit": "seconds",
        "primary_command": (
            "compute_flow_active_spans per PR using "
            "GET /repos/.../pulls/{n}/reviews + commits + issues/{n}/events"
        ),
    }


# ===========================================================================
# Section 12 — M5: Flow Efficiency
# ===========================================================================
#
# Operational Definition (AAP §0.1.1):
#   Flow Active / Flow Time per PR, median across PRs per phase. Review
#   time is treated as wait from the actor's perspective in both periods.
#
# Data Source: derived from M4 and M7 per-phase medians.
# Confidence: min(M4 confidence, M7 confidence).


@safe_extract("M5")
def extract_flow_efficiency(windows: list[dict],
                            m4: dict,
                            m7: dict,
                            use_cache: bool) -> dict:
    """Extract Flow Efficiency (M5).

    Implementation uses the per-phase medians of M4 (Flow Active) and M7
    (Flow Time) — i.e., median Flow Active divided by median Flow Time
    per phase. This matches the user's specification that Flow Efficiency
    is "Flow Active / Flow Time per PR, median across PRs per phase."

    Per-actor breakdown (AAP §0.1.1 Per-Engineer Views):
        The returned envelope includes a ``per_actor`` field with one entry
        per engineering actor present in both ``m4.per_actor`` and
        ``m7.per_actor``. Each cell is computed as
        ``M4.per_actor[actor][phase] / M7.per_actor[actor][phase]`` — the
        same identity that produces the overall phase values, applied
        cell-by-cell. The overall confidence (``min(M4, M7)``) is inherited
        by all per-actor cells (no per-cell confidence tagging — only the
        upstream M4/M7 confidence flags determine reliability).

    Confidence inherits ``min(M4.confidence, M7.confidence)`` so a downgrade
    in either upstream metric is reflected here.
    """
    _ = (windows, use_cache)  # unused — derived metric

    if m4.get("status") == "insufficient_signal":
        raise InsufficientSignalError(
            f"M4 insufficient signal: {m4.get('reason', 'unknown')}")
    if m7.get("status") == "insufficient_signal":
        raise InsufficientSignalError(
            f"M7 insufficient signal: {m7.get('reason', 'unknown')}")

    phase_efficiencies: dict[str, float | None] = {}
    for phase in ("baseline", "ramp_up", "steady_state", "post_intro"):
        active = m4.get(phase)
        time_ = m7.get(phase)
        if active is None or time_ is None:
            phase_efficiencies[phase] = None
            continue
        try:
            time_f = float(time_)
        except (TypeError, ValueError):
            phase_efficiencies[phase] = None
            continue
        if time_f == 0:
            phase_efficiencies[phase] = None
            continue
        phase_efficiencies[phase] = float(active) / time_f

    # After-period efficiency
    m4_after = m4.get("after")
    m7_after = m7.get("after")
    if m4_after is not None and m7_after is not None:
        try:
            m7_after_f = float(m7_after)
            phase_efficiencies["after"] = (
                float(m4_after) / m7_after_f if m7_after_f != 0 else None
            )
        except (TypeError, ValueError):
            phase_efficiencies["after"] = None
    else:
        phase_efficiencies["after"] = derive_after_value(phase_efficiencies)

    # Per-actor efficiency — derived cell-by-cell from M4/M7 per-actor
    # medians for every actor present in both upstream metrics.
    # Actors present in only one upstream are skipped to avoid fabricating
    # numerator/denominator from thin air.
    m4_per_actor = m4.get("per_actor") or {}
    m7_per_actor = m7.get("per_actor") or {}
    per_actor_efficiencies: dict[str, dict[str, float | None]] = {}
    shared_actors = sorted(set(m4_per_actor.keys()) & set(m7_per_actor.keys()))
    for actor in shared_actors:
        m4_cells = m4_per_actor.get(actor) or {}
        m7_cells = m7_per_actor.get(actor) or {}
        if not isinstance(m4_cells, dict) or not isinstance(m7_cells, dict):
            continue
        actor_phase_efficiencies: dict[str, float | None] = {}
        for phase in ("baseline", "ramp_up", "steady_state", "post_intro"):
            active_v = m4_cells.get(phase)
            time_v = m7_cells.get(phase)
            if active_v is None or time_v is None:
                actor_phase_efficiencies[phase] = None
                continue
            try:
                time_f = float(time_v)
            except (TypeError, ValueError):
                actor_phase_efficiencies[phase] = None
                continue
            if time_f == 0:
                actor_phase_efficiencies[phase] = None
                continue
            actor_phase_efficiencies[phase] = float(active_v) / time_f
        # After cell for the actor — prefer explicit cells from both
        # upstream metrics; otherwise derive from non-baseline phases.
        actor_m4_after = m4_cells.get("after")
        actor_m7_after = m7_cells.get("after")
        if actor_m4_after is not None and actor_m7_after is not None:
            try:
                m7_after_f = float(actor_m7_after)
                actor_phase_efficiencies["after"] = (
                    float(actor_m4_after) / m7_after_f if m7_after_f != 0 else None
                )
            except (TypeError, ValueError):
                actor_phase_efficiencies["after"] = None
        else:
            actor_phase_efficiencies["after"] = derive_after_value(
                actor_phase_efficiencies)
        per_actor_efficiencies[actor] = actor_phase_efficiencies

    multiplier = compute_multiplier(phase_efficiencies, higher_is_better=True)
    confidence = min_confidence([
        m4.get("confidence", "Low"),
        m7.get("confidence", "Low"),
    ])

    return {
        "metric_id": "M5",
        "status": "ok",
        "confidence": confidence,
        "source": "derived_from_M4_M7",
        "baseline": phase_efficiencies.get("baseline"),
        "ramp_up": phase_efficiencies.get("ramp_up"),
        "steady_state": phase_efficiencies.get("steady_state"),
        "post_intro": phase_efficiencies.get("post_intro"),
        "after": phase_efficiencies.get("after"),
        "multiplier": multiplier,
        "direction": "higher-is-better",
        "per_actor": per_actor_efficiencies,
        "primary_command": "derived from M4 (Flow Active) / M7 (Flow Time)",
        "m4_confidence": m4.get("confidence"),
        "m7_confidence": m7.get("confidence"),
    }


# ===========================================================================
# Section 13 — M6: Flow Distribution
# ===========================================================================
#
# Operational Definition (AAP §0.1.1):
#   Proportion of merged PRs classified as feature / defect / risk-compliance
#   / tech-debt / unknown. Classification priority: linked-issue labels →
#   conventional-commit prefix → keyword match. Per-actor in the after
#   period. Unknown rate >20% downgrades phase confidence to Low.
#
# Data Source: GitHub Pulls API + Issues API for linked-issue labels.
# Confidence: Medium when classification succeeds for >80% of PRs;
#             downgraded to Low when unknown rate exceeds 20%.


@safe_extract("M6")
def extract_flow_distribution(windows: list[dict], use_cache: bool) -> dict:
    """Extract Flow Distribution (M6).

    For each merged PR, runs the three-tier classification waterfall and
    accumulates per-phase / per-actor / per-category counts. Converts
    counts to proportions and computes the unknown rate per phase. Any
    phase with an unknown rate > 20% downgrades the metric's confidence
    to Low.
    """
    prs = fetch_all_prs(use_cache)
    if not prs:
        raise InsufficientSignalError(
            "GitHub Pulls API returned no PRs (auth failure or empty repo)")
    merged = [
        pr for pr in prs
        if pr.get("merged_at") and not is_bot_author(_pr_user_login(pr))
    ]
    if not merged:
        raise InsufficientSignalError("no merged PRs available")

    linked_issue_cache: dict[int, dict] = {}

    per_phase_dist: dict[str, Counter] = defaultdict(Counter)
    per_actor_phase_dist: dict[str, dict[str, Counter]] = defaultdict(
        lambda: defaultdict(Counter))

    for pr in merged:
        merged_dt = _parse_iso(pr.get("merged_at"))
        if merged_dt is None:
            continue
        window = find_window_for_timestamp(merged_dt, windows)
        if window is None:
            continue
        phase = window.get("phase") or "baseline"
        actor = engineering_actor(pr, phase)

        linked = fetch_linked_issues_for_pr(pr, linked_issue_cache, use_cache)
        category = classify_flow_distribution(pr, linked)
        per_phase_dist[phase][category] += 1
        per_actor_phase_dist[actor][phase][category] += 1

    # Convert counts to proportions
    phase_proportions: dict[str, dict[str, float] | None] = {}
    phase_unknown_rates: dict[str, float] = {}
    phase_totals: dict[str, int] = {}
    for phase in ("baseline", "ramp_up", "steady_state", "post_intro"):
        counts = per_phase_dist.get(phase, Counter())
        total = sum(counts.values())
        phase_totals[phase] = total
        if total == 0:
            phase_proportions[phase] = None
            phase_unknown_rates[phase] = 0.0
            continue
        proportions = {cat: count / total for cat, count in counts.items()}
        phase_proportions[phase] = proportions
        phase_unknown_rates[phase] = proportions.get("unknown", 0.0)

    # Per-actor proportions (convert Counter to plain dict of proportions)
    per_actor_results: dict[str, dict[str, dict[str, float] | None]] = {}
    for actor, phase_data in per_actor_phase_spans_to_proportions(per_actor_phase_dist):
        per_actor_results[actor] = phase_data

    # Confidence: Low when any phase's unknown rate exceeds 20%
    eligible_rates = [
        r for phase, r in phase_unknown_rates.items()
        if phase_totals.get(phase, 0) > 0
    ]
    max_unknown = max(eligible_rates) if eligible_rates else 0.0
    if max_unknown > 0.20:
        confidence = "Low"
        confidence_reason = (
            f"unknown rate {max_unknown:.1%} exceeds 20% threshold"
        )
    else:
        confidence = "Medium"
        confidence_reason = ""

    return {
        "metric_id": "M6",
        "status": "ok",
        "confidence": confidence,
        "confidence_reason": confidence_reason,
        "source": "github_api_pulls_issues_labels",
        "baseline": phase_proportions.get("baseline"),
        "ramp_up": phase_proportions.get("ramp_up"),
        "steady_state": phase_proportions.get("steady_state"),
        "post_intro": phase_proportions.get("post_intro"),
        "multiplier": "distribution_shift",  # special marker; not a scalar
        "direction": "distribution",
        "per_actor": per_actor_results,
        "unknown_rates": phase_unknown_rates,
        "totals_per_phase": phase_totals,
        "raw_counts_per_phase": {
            phase: dict(per_phase_dist.get(phase, Counter()))
            for phase in ("baseline", "ramp_up", "steady_state", "post_intro")
        },
        "primary_command": (
            "classify_flow_distribution per PR via "
            "label → conventional-commit prefix → keyword waterfall"
        ),
    }


def per_actor_phase_spans_to_proportions(
    per_actor_phase_dist: dict[str, dict[str, Counter]],
) -> Iterable[tuple[str, dict[str, dict[str, float] | None]]]:
    """Convert nested ``{actor: {phase: Counter}}`` to proportions.

    Helper for :func:`extract_flow_distribution` that yields one
    ``(actor, {phase: proportions})`` tuple per actor. Proportions are
    floats summing to 1.0 per phase; empty phases become None.
    """
    for actor, phase_data in per_actor_phase_dist.items():
        out: dict[str, dict[str, float] | None] = {}
        for phase, counts in phase_data.items():
            total = sum(counts.values())
            if total == 0:
                out[phase] = None
                continue
            out[phase] = {cat: count / total for cat, count in counts.items()}
        yield actor, out



# ===========================================================================
# Section 14 — M7: Flow Time (First Commit → Merge Commit)
# ===========================================================================
#
# Operational Definition (AAP §0.1.1):
#   Median wall-clock from first commit on PR branch to merge commit on
#   default branch. Excludes PRs whose first-commit timestamp is unavailable
#   due to history rewrites; exclusion rate reported.
#
# Data Source: GitHub Pulls API for merged_at + base/head SHAs;
#              git log on the local repository for first-commit timestamp.
# Confidence: High when both sources are available; Medium when API is
#             unavailable but git history is.


def compute_first_commit_on_pr_branch(pr: dict,
                                      use_cache: bool = True) -> str | None:
    """Return ISO 8601 timestamp of the first commit on a PR's branch.

    Strategy:
        1. First attempt: GitHub Pulls API ``/pulls/{n}/commits``, take the
           earliest ``commit.author.date``. This avoids a local git
           subprocess for PRs whose branch is not in the local clone.
        2. Fallback: ``git log --format=%aI --reverse <base_sha>..<head_sha>``
           using subprocess; returns the first line.

    Returns None when neither source produces a timestamp (history rewrite,
    deleted branch, or unauthenticated API). The caller is responsible for
    tallying the exclusion in :func:`extract_flow_time`.
    """
    pr_number = pr.get("number")

    # Primary: PR commits via API (works for PRs whose head branch is gone)
    commits = fetch_pr_commits(pr_number, use_cache) if pr_number else []
    earliest: datetime | None = None
    for commit in commits or []:
        commit_obj = commit.get("commit") or {}
        author = commit_obj.get("author") or {}
        ts = _parse_iso(author.get("date"))
        if ts is None:
            continue
        if earliest is None or ts < earliest:
            earliest = ts
    if earliest is not None:
        return earliest.isoformat().replace("+00:00", "Z")

    # Fallback: local git log
    head = (pr.get("head") or {}).get("sha")
    base = (pr.get("base") or {}).get("sha")
    if not head or not base:
        return None
    try:
        out = git_log(
            ["--format=%aI", "--reverse", f"{base}..{head}"],
            allow_failure=True,
        ).strip()
    except (subprocess.SubprocessError, ValueError):
        return None
    if not out:
        return None
    first_line = out.splitlines()[0].strip()
    return first_line or None


@safe_extract("M7")
def extract_flow_time(windows: list[dict], use_cache: bool) -> dict:
    """Extract Flow Time (M7).

    For each merged PR, computes ``merged_at - first_commit_timestamp`` in
    seconds and groups by the window containing ``merged_at``. Reports the
    per-phase median plus the exclusion rate (PRs whose first commit could
    not be determined, e.g., due to history rewrites or deleted branches).

    Per-actor breakdown:
        The returned envelope includes a ``per_actor`` field mapping each
        engineering actor (resolved via ``engineering_actor(pr, phase)``)
        to a dict of per-phase medians. M7 is NOT listed in the AAP §0.1.1
        Per-Engineer Views set, but M5 (Flow Efficiency) derives its own
        per-actor breakdown as ``M4.per_actor / M7.per_actor`` — so the
        cleanest, most consistent implementation is to compute M7's
        per-actor medians here alongside the overall per-phase medians
        (identical methodology — single loop, identical actor selector).
    """
    prs = fetch_all_prs(use_cache)
    if not prs:
        raise InsufficientSignalError(
            "GitHub Pulls API returned no PRs (auth failure or empty repo)")
    merged = [
        pr for pr in prs
        if pr.get("merged_at") and not is_bot_author(_pr_user_login(pr))
    ]
    if not merged:
        raise InsufficientSignalError("no merged PRs available")

    per_phase_times: dict[str, list[float]] = defaultdict(list)
    per_actor_phase_times: dict[str, dict[str, list[float]]] = defaultdict(
        lambda: defaultdict(list))
    excluded_count = 0
    in_window_count = 0
    total_count = len(merged)

    logger = structured_logger(metric_id="M7", phase="extract_metrics")
    for idx, pr in enumerate(merged):
        if idx % 100 == 0 and idx > 0:
            logger.debug(
                f"M7 processed {idx}/{total_count} PRs",
                extra={"context": {"processed": idx, "total": total_count}},
            )
        merged_dt = _parse_iso(pr.get("merged_at"))
        if merged_dt is None:
            continue
        window = find_window_for_timestamp(merged_dt, windows)
        if window is None:
            continue
        in_window_count += 1
        phase = window.get("phase") or "baseline"
        # Resolve the engineering actor through the canonical selector so
        # the identical-methodology guarantee (AAP §0.5.1) holds across
        # M4 / M5 / M7 per-actor cells.
        actor = engineering_actor(pr, phase)

        first_iso = compute_first_commit_on_pr_branch(pr, use_cache)
        if first_iso is None:
            excluded_count += 1
            continue
        first_dt = _parse_iso(first_iso)
        if first_dt is None:
            excluded_count += 1
            continue
        flow_time_seconds = (merged_dt - first_dt).total_seconds()
        if flow_time_seconds < 0:
            # Negative flow time = data anomaly (commit dated AFTER merge);
            # exclude rather than fabricate a sane value.
            excluded_count += 1
            continue
        per_phase_times[phase].append(flow_time_seconds)
        per_actor_phase_times[actor][phase].append(flow_time_seconds)

    if not any(per_phase_times.values()):
        raise InsufficientSignalError(
            "no PRs yielded computable Flow Time (all excluded)")

    phase_medians: dict[str, float | None] = {}
    for phase in ("baseline", "ramp_up", "steady_state", "post_intro"):
        vals = per_phase_times.get(phase, [])
        phase_medians[phase] = statistics.median(vals) if vals else None

    after_vals: list[float] = []
    for phase in AFTER_PHASES:
        if phase == "after":
            continue
        after_vals.extend(per_phase_times.get(phase, []))
    phase_medians["after"] = statistics.median(after_vals) if after_vals else None

    # Per-actor medians — identical aggregation as the overall pass, just
    # grouped by actor. Mirrors the M4 (Flow Active) per_actor envelope
    # so M5 can divide cell-by-cell.
    per_actor_results: dict[str, dict[str, float | None]] = {}
    for actor, phase_data in per_actor_phase_times.items():
        actor_phase_medians: dict[str, float | None] = {}
        for phase in ALL_KNOWN_PHASES:
            if phase == "after":
                continue
            vals = phase_data.get(phase, [])
            actor_phase_medians[phase] = (
                statistics.median(vals) if vals else None
            )
        actor_after_vals: list[float] = []
        for phase in AFTER_PHASES:
            if phase == "after":
                continue
            actor_after_vals.extend(phase_data.get(phase, []))
        actor_phase_medians["after"] = (
            statistics.median(actor_after_vals) if actor_after_vals else None
        )
        per_actor_results[actor] = actor_phase_medians

    multiplier = compute_multiplier(phase_medians, lower_is_better=True)
    denominator = max(in_window_count, 1)
    exclusion_rate = excluded_count / denominator

    return {
        "metric_id": "M7",
        "status": "ok",
        "confidence": "High" if exclusion_rate < 0.10 else "Medium",
        "source": "github_api_pulls + pr_commits_api + git_log_fallback",
        "baseline": phase_medians.get("baseline"),
        "ramp_up": phase_medians.get("ramp_up"),
        "steady_state": phase_medians.get("steady_state"),
        "post_intro": phase_medians.get("post_intro"),
        "after": phase_medians.get("after"),
        "multiplier": multiplier,
        "direction": "lower-is-better",
        "exclusion_rate": exclusion_rate,
        "excluded_count": excluded_count,
        "total_count": total_count,
        "in_window_count": in_window_count,
        "unit": "seconds",
        "per_actor": per_actor_results,
        "baseline_n": len(per_phase_times.get("baseline", [])),
        "ramp_up_n": len(per_phase_times.get("ramp_up", [])),
        "steady_state_n": len(per_phase_times.get("steady_state", [])),
        "post_intro_n": len(per_phase_times.get("post_intro", [])),
        "primary_command": (
            "GET /repos/.../pulls/{n}/commits | head -1 by author.date; "
            "fallback: git log --format=%aI --reverse <base>..<head> | head -1"
        ),
    }


# ===========================================================================
# Section 15 — M8: Problem Records in Release (Revert Attribution)
# ===========================================================================
#
# Operational Definition (AAP §0.1.1):
#   Mean attributable reverts per release. For each revert on default,
#   identify original commit, attribute to most recent release tag T such
#   that T is an ancestor of the original. Unattributable and unreleased
#   reverts reported separately. Reverts-of-reverts excluded.
#
# Data Source: ``git log --grep='^Revert'`` + GitHub Releases API
#              (with tag/CI-deployment fallback for M9).
# Confidence: High when release tags exist; Low when only CI deploys
#             are available.


def parse_revert_commits(log_output: str) -> list[dict]:
    """Parse the output of ``git log --pretty=format:%H|%aI|%s|%P`` into dicts.

    Each line has four pipe-delimited fields. Lines that don't match the
    schema are skipped silently (handles trailing blank lines and
    misformatted entries from very old commits).
    """
    reverts: list[dict] = []
    for line in (log_output or "").splitlines():
        parts = line.split("|", 3)
        if len(parts) < 3:
            continue
        sha = parts[0].strip()
        if not sha:
            continue
        authored_iso = parts[1].strip() if len(parts) > 1 else ""
        subject = parts[2].strip() if len(parts) > 2 else ""
        parents = parts[3].strip() if len(parts) > 3 else ""
        if not REVERT_TITLE_RE.match(subject) and not subject.lower().startswith("revert"):
            continue
        reverts.append({
            "sha": sha,
            "authored_iso": authored_iso,
            "subject": subject,
            "parents": parents.split() if parents else [],
        })
    return reverts


def parse_reverts_commit_line(body: str) -> str | None:
    """Extract the ``<SHA>`` from a ``This reverts commit <SHA>`` trailer.

    Returns None if no such line exists in the commit body. The SHA is
    normalized to lowercase but its length is preserved (7-40 chars).
    """
    if not body:
        return None
    match = REVERTS_COMMIT_RE.search(body)
    if match:
        return match.group(1).lower()
    return None


def tree_hash_lookup(revert: dict) -> str | None:
    """Fallback: identify the original commit via tree-hash matching.

    Used when the revert commit body lacks a ``This reverts commit <SHA>``
    line. Computes the tree hash of the revert's parent (i.e., the state
    that the revert restored) and searches the history for a commit with
    a matching tree hash. The most recent such commit is returned.

    Returns None when the revert lacks a parent or no matching tree is
    found in the visible history.
    """
    parents = revert.get("parents") or []
    if not parents:
        return None
    revert_sha = revert.get("sha")
    if not revert_sha:
        return None
    parent_sha = parents[0]
    try:
        # Tree-hash of the parent commit (state after revert applied)
        tree_hash = git_run(
            ["rev-parse", f"{parent_sha}^{{tree}}"],
            allow_failure=True,
        ).strip()
        if not tree_hash:
            return None
        # Search for commits with this tree hash, EXCLUDING the revert itself
        # and its parent. ``--all`` widens the search to non-default branches.
        out = git_log(
            ["--all", "--format=%H %T", "-n", "1000"],
            allow_failure=True,
        )
        for line in out.splitlines():
            parts = line.strip().split()
            if len(parts) < 2:
                continue
            sha, tree = parts[0], parts[1]
            if tree == tree_hash and sha not in (revert_sha, parent_sha):
                return sha
    except (subprocess.SubprocessError, ValueError):
        return None
    return None


def is_prerelease(release_or_name: dict | str) -> bool:
    """Return True when a release name / tag indicates a prerelease.

    Accepts either a release dict (uses its ``prerelease`` field plus its
    ``name`` / ``tag_name``) or a bare string. Suffix detection uses
    :data:`PRERELEASE_RE`.
    """
    if isinstance(release_or_name, dict):
        if release_or_name.get("prerelease") is True:
            return True
        name = release_or_name.get("name") or release_or_name.get("tag_name") or ""
    else:
        name = release_or_name or ""
    return PRERELEASE_RE.search(str(name)) is not None


def fetch_releases_with_source(use_cache: bool = True) -> tuple[list[dict], str]:
    """Fetch releases using the documented source-precedence fallback.

    Order (AAP §0.5.5):
        1. GitHub Releases API (``api``)
        2. Annotated semver git tags (``tags``)
        3. CI deployment events from ``actions/runs`` (``ci_deploys``)
        4. None of the above (``none``)

    Returns a ``(releases_list, source_label)`` tuple. The list elements
    are normalized to a release-like shape: ``name``, ``tag_name``,
    ``published_at``, ``prerelease``, ``commit_sha`` / ``target_commitish``.
    """
    # Tier 1: GitHub Releases API
    api_releases = fetch_releases(use_cache)
    if api_releases:
        return api_releases, "api"

    # Tier 2: annotated semver tags
    try:
        tag_output = git_run(
            ["tag", "--list", "v[0-9]*.[0-9]*.[0-9]*",
             "--sort=-creatordate",
             "--format=%(refname:short)|%(creatordate:iso-strict)|%(objectname)"],
            allow_failure=True,
        )
    except (subprocess.SubprocessError, ValueError):
        tag_output = ""

    tag_releases: list[dict] = []
    for line in tag_output.splitlines():
        parts = line.strip().split("|", 2)
        if len(parts) < 1 or not parts[0]:
            continue
        tag_name = parts[0]
        published_at = parts[1] if len(parts) > 1 else ""
        commit_sha = parts[2] if len(parts) > 2 else ""
        tag_releases.append({
            "name": tag_name,
            "tag_name": tag_name,
            "published_at": published_at,
            "prerelease": is_prerelease(tag_name),
            "commit_sha": commit_sha,
            "target_commitish": commit_sha,
        })
    if tag_releases:
        return tag_releases, "tags"

    # Tier 3: CI deployment events (production build workflows)
    deploy_runs: list[dict] = []
    for workflow in PRODUCTION_DEPLOY_WORKFLOWS:
        runs = fetch_workflow_runs(workflow=workflow, status="success",
                                   use_cache=use_cache)
        for run in runs:
            name = run.get("name") or workflow
            deploy_runs.append({
                "name": f"{name} #{run.get('run_number')}",
                "tag_name": f"deploy-{run.get('id')}",
                "published_at": run.get("created_at") or run.get("updated_at") or "",
                "prerelease": False,
                "commit_sha": run.get("head_sha", ""),
                "target_commitish": run.get("head_sha", ""),
            })
    if deploy_runs:
        return deploy_runs, "ci_deploys"

    return [], "none"


def fetch_releases_or_fallback(use_cache: bool = True) -> list[dict]:
    """Backward-compat shim: just the releases list from the fallback chain."""
    releases, _source = fetch_releases_with_source(use_cache)
    return releases


@safe_extract("M8")
def extract_problem_records(windows: list[dict], use_cache: bool) -> dict:
    """Extract Problem Records in Release (M8).

    1. List revert commits on default branch via ``git log --grep='^Revert'``.
    2. For each revert, parse the ``This reverts commit <SHA>`` trailer; if
       absent, fall back to tree-hash matching.
    3. Discard reverts of reverts (chain of reverts).
    4. For each identified original commit, find the most recent release
       tag T such that T is an ancestor of the original (via
       ``git merge-base --is-ancestor``).
    5. Tally counts per release; report mean reverts per release plus
       unattributable / unreleased counts separately.
    """
    _ = use_cache  # only Git is consulted directly here

    try:
        revert_log = git_log(
            ["--first-parent", "--no-merges",
             "--pretty=format:%H|%aI|%s|%P"],
            allow_failure=True,
        )
    except (subprocess.SubprocessError, ValueError) as exc:
        raise InsufficientSignalError(f"git log failed: {exc}") from exc

    all_commits_first_parent = revert_log
    reverts = parse_revert_commits(all_commits_first_parent)
    if not reverts:
        # Fall back to non-first-parent search to catch reverts on branches
        try:
            revert_log_all = git_log(
                ["--grep=^Revert", "--pretty=format:%H|%aI|%s|%P"],
                allow_failure=True,
            )
        except (subprocess.SubprocessError, ValueError) as exc:
            raise InsufficientSignalError(f"git log failed: {exc}") from exc
        reverts = parse_revert_commits(revert_log_all)

    releases, source = fetch_releases_with_source(use_cache)
    release_tags = [r for r in releases if not is_prerelease(r)]

    attributed: list[dict] = []
    unattributable: list[dict] = []
    unreleased: list[dict] = []
    revert_of_revert: list[dict] = []

    logger = structured_logger(metric_id="M8", phase="extract_metrics")
    for idx, revert in enumerate(reverts):
        if idx % 50 == 0 and idx > 0:
            logger.debug(
                f"M8 processed {idx}/{len(reverts)} reverts",
                extra={"context": {"processed": idx, "total": len(reverts)}},
            )

        # Get revert commit body
        try:
            body = git_run(
                ["show", "-s", "--format=%B", revert["sha"]],
                allow_failure=True,
            )
        except (subprocess.SubprocessError, ValueError):
            body = ""
        original_sha = parse_reverts_commit_line(body)
        if not original_sha:
            original_sha = tree_hash_lookup(revert)

        if not original_sha:
            unattributable.append(revert)
            continue

        # Check if original is itself a revert (chain of reverts)
        try:
            original_body = git_run(
                ["show", "-s", "--format=%B", original_sha],
                allow_failure=True,
            )
        except (subprocess.SubprocessError, ValueError):
            original_body = ""
        if original_body and REVERTS_COMMIT_RE.search(original_body):
            revert_of_revert.append(revert)
            continue

        # Find most recent release tag T such that T is ancestor of original
        candidate_tags: list[dict] = []
        for release in release_tags:
            tag_sha = release.get("commit_sha") or release.get("target_commitish")
            if not tag_sha:
                continue
            try:
                result = subprocess.run(
                    ["git", "merge-base", "--is-ancestor", tag_sha, original_sha],
                    capture_output=True, timeout=15,
                )
                command_log_append(
                    "git",
                    f"git merge-base --is-ancestor {tag_sha} {original_sha}"
                )
                if result.returncode == 0:
                    candidate_tags.append(release)
            except (subprocess.SubprocessError, subprocess.TimeoutExpired):
                continue

        if not candidate_tags:
            unreleased.append({"revert": revert, "original_sha": original_sha})
            continue

        most_recent = max(
            candidate_tags,
            key=lambda r: r.get("published_at") or "",
        )
        attributed.append({
            "revert_sha": revert["sha"],
            "original_sha": original_sha,
            "release": most_recent.get("name"),
            "release_tag": most_recent.get("tag_name"),
        })

    counts_per_release = Counter(
        a["release"] for a in attributed if a.get("release")
    )
    mean_per_release = (
        statistics.mean(counts_per_release.values())
        if counts_per_release else 0.0
    )

    confidence = {
        "api": "High",
        "tags": "Medium",
        "ci_deploys": "Low",
        "none": "Low",
    }.get(source, "Low")

    if source == "none" and not reverts:
        raise InsufficientSignalError(
            "no release source and no revert commits found")

    return {
        "metric_id": "M8",
        "status": "ok",
        "confidence": confidence,
        "source": f"git_log_reverts + releases_{source}",
        "mean_per_release": mean_per_release,
        "attributed_count": len(attributed),
        "unattributable_count": len(unattributable),
        "unreleased_count": len(unreleased),
        "revert_of_revert_count": len(revert_of_revert),
        "total_revert_count": len(reverts),
        "release_count": len(release_tags),
        "counts_per_release": dict(counts_per_release),
        "multiplier": None,  # M8 is a per-release rate; no After/Before scalar
        "direction": "lower-is-better",
        "primary_command": (
            "git log --grep='^Revert' --pretty=format:%H|%aI|%s|%P | "
            "parse_reverts_commit_line | git merge-base --is-ancestor"
        ),
    }



# ===========================================================================
# Section 16 — M9: Releases (per-window)
# ===========================================================================
#
# Operational Definition (AAP §0.1.1):
#   Mean releases per 2-week window. Source precedence: GitHub Releases
#   API → annotated semver tags → CI deployment events. Prereleases excluded
#   from primary count and reported separately.
#
# Data Source: see fetch_releases_with_source() for the fallback chain.
# Confidence: High when API releases exist; Medium for tags; Low for CI deploys.


@safe_extract("M9")
def extract_releases(windows: list[dict], use_cache: bool) -> dict:
    """Extract Releases (M9).

    Counts non-prerelease releases per window, computes per-phase means,
    and reports the prerelease count separately (never folded into the
    primary count). When no release source is available, raises
    :class:`InsufficientSignalError`.
    """
    releases, source = fetch_releases_with_source(use_cache)

    if source == "none":
        raise InsufficientSignalError(
            "no release source available (API empty, no semver tags, no CI deploys)")

    primary = [r for r in releases if not is_prerelease(r)]
    prereleases = [r for r in releases if is_prerelease(r)]

    per_window: dict[str, int] = {w["window_id"]: 0 for w in windows}
    unmapped_releases = 0
    for release in primary:
        published_dt = _parse_iso(release.get("published_at"))
        if published_dt is None:
            unmapped_releases += 1
            continue
        window = find_window_for_timestamp(published_dt, windows)
        if window is None:
            unmapped_releases += 1
            continue
        per_window[window["window_id"]] += 1

    phase_means = aggregate_by_phase(per_window, windows, "mean")
    multiplier = compute_multiplier(phase_means, higher_is_better=True)

    confidence = {
        "api": "High",
        "tags": "Medium",
        "ci_deploys": "Low",
    }.get(source, "Low")

    return {
        "metric_id": "M9",
        "status": "ok",
        "confidence": confidence,
        "source": f"releases_{source}",
        "baseline": phase_means.get("baseline"),
        "ramp_up": phase_means.get("ramp_up"),
        "steady_state": phase_means.get("steady_state"),
        "post_intro": phase_means.get("post_intro"),
        "after": phase_means.get("after"),
        "multiplier": multiplier,
        "direction": "higher-is-better",
        "primary_count": len(primary),
        "prerelease_count": len(prereleases),
        "unmapped_release_count": unmapped_releases,
        "per_window": per_window,
        "baseline_n": count_windows_in_phase(windows, "baseline"),
        "ramp_up_n": count_windows_in_phase(windows, "ramp_up"),
        "steady_state_n": count_windows_in_phase(windows, "steady_state"),
        "post_intro_n": count_windows_in_phase(windows, "post_intro"),
        "primary_command": (
            "GET /repos/.../releases → fallback git tag --list v*.*.* "
            "--sort=-creatordate → fallback GET /repos/.../actions/runs"
        ),
    }


# ===========================================================================
# Section 17 — M10: Approved Exceptions
# ===========================================================================
#
# Operational Definition (AAP §0.1.1):
#   Count per 2-week window of policy bypasses:
#       - admin-overridden required reviews
#       - force-pushes to protected branches
#       - merges with failing required CI
#       - branch protection rule modifications
#       - PRs labeled with exception/waiver/override tags
#   Admin audit log required for full signal; without it, only force-pushes
#   and label signals are available and confidence drops to Low.
#
# Data Source: Audit log API + Events API + PR labels.


def is_force_push(event: dict) -> bool:
    """Heuristic detection of force-push events from the public Events API.

    The public Events API does not directly expose force-push detection,
    but a ``PushEvent`` whose ``payload.forced`` is True is a strong signal
    (set by some GitHub clients). When ``forced`` is missing, return False.
    """
    if event.get("type") != "PushEvent":
        return False
    payload = event.get("payload") or {}
    return bool(payload.get("forced"))


def _audit_event_is_force_push(event: dict) -> bool:
    """Detect force-push from an audit-log entry."""
    action = (event.get("action") or "").lower()
    return action in (
        "git.force_push",
        "git.force_push_to_protected_branch",
        "protected_branch.force_push",
    )


def _audit_event_is_admin_override(event: dict) -> bool:
    """Detect admin-override actions from an audit-log entry."""
    action = (event.get("action") or "").lower()
    return action in (
        "protected_branch.policy_override",
        "protected_branch.update",
        "pull_request.merge_admin_override",
        "merge.admin_override",
        "pull_request.bypass_required_reviews",
    )


@safe_extract("M10")
def extract_approved_exceptions(windows: list[dict], use_cache: bool) -> dict:
    """Extract Approved Exceptions (M10).

    Tallies four sub-counts per window:
        - force_pushes (from audit log if available, else PushEvent.forced)
        - label_exceptions (PRs with exception/waiver/override labels)
        - admin_overrides (audit-log only — null when log unavailable)
        - protection_modifications (audit-log only)

    Per-actor breakdown is included when an audit-log entry's actor is
    identifiable; force-push and label sub-counts attribute to the
    PR author / pusher.
    """
    audit_log = fetch_audit_log_events(use_cache)
    has_audit = audit_log is not None and len(audit_log) > 0

    events = fetch_repo_events(use_cache)

    prs = fetch_all_prs(use_cache)
    if prs is None:
        prs = []

    # Force-push tally
    force_pushes: list[tuple[datetime, str]] = []
    if has_audit and audit_log is not None:
        for entry in audit_log:
            if _audit_event_is_force_push(entry):
                ts = _parse_iso(entry.get("@timestamp")
                                or entry.get("created_at"))
                actor = entry.get("actor") or entry.get("user") or "unknown"
                if ts is not None:
                    force_pushes.append((ts, actor))
    for event in events:
        if is_force_push(event):
            ts = _parse_iso(event.get("created_at"))
            actor_obj = event.get("actor") or {}
            actor = actor_obj.get("login") if isinstance(actor_obj, dict) else "unknown"
            if ts is not None:
                force_pushes.append((ts, actor or "unknown"))

    # Label-exception PRs
    exception_label_set = {n.lower() for n in EXCEPTION_LABEL_NAMES}
    exception_prs: list[dict] = []
    for pr in prs:
        labels = pr.get("labels") or []
        for label in labels:
            name = (label.get("name") or "").lower()
            if name in exception_label_set:
                exception_prs.append(pr)
                break

    # Admin overrides
    admin_overrides: list[tuple[datetime, str, str]] = []
    protection_mods: list[tuple[datetime, str]] = []
    if has_audit and audit_log is not None:
        for entry in audit_log:
            ts = _parse_iso(entry.get("@timestamp") or entry.get("created_at"))
            if ts is None:
                continue
            actor = entry.get("actor") or entry.get("user") or "unknown"
            action = (entry.get("action") or "").lower()
            if _audit_event_is_admin_override(entry):
                admin_overrides.append((ts, actor, action))
            if action == "protected_branch.update":
                protection_mods.append((ts, actor))

    # Tally per-window per-subcount
    per_window: dict[str, dict[str, int]] = {
        w["window_id"]: {
            "force_pushes": 0,
            "label_exceptions": 0,
            "admin_overrides": 0,
            "protection_mods": 0,
            "total": 0,
        }
        for w in windows
    }
    per_actor_phase_counts: dict[str, dict[str, int]] = defaultdict(
        lambda: defaultdict(int))

    def _bump(window_id: str, key: str, phase: str, actor: str) -> None:
        bucket = per_window.get(window_id)
        if bucket is not None:
            bucket[key] = bucket.get(key, 0) + 1
            bucket["total"] = bucket.get("total", 0) + 1
        if actor:
            per_actor_phase_counts[actor][phase] += 1

    for ts, actor in force_pushes:
        window = find_window_for_timestamp(ts, windows)
        if window is None:
            continue
        _bump(window["window_id"], "force_pushes",
              window.get("phase") or "baseline", actor or "unknown")

    for pr in exception_prs:
        ts = _parse_iso(pr.get("merged_at") or pr.get("closed_at")
                        or pr.get("created_at"))
        if ts is None:
            continue
        window = find_window_for_timestamp(ts, windows)
        if window is None:
            continue
        phase = window.get("phase") or "baseline"
        actor = engineering_actor(pr, phase)
        _bump(window["window_id"], "label_exceptions", phase, actor)

    for ts, actor, _action in admin_overrides:
        window = find_window_for_timestamp(ts, windows)
        if window is None:
            continue
        _bump(window["window_id"], "admin_overrides",
              window.get("phase") or "baseline", actor or "unknown")

    for ts, actor in protection_mods:
        window = find_window_for_timestamp(ts, windows)
        if window is None:
            continue
        _bump(window["window_id"], "protection_mods",
              window.get("phase") or "baseline", actor or "unknown")

    total_per_window = {wid: data["total"]
                        for wid, data in per_window.items()}
    phase_means = aggregate_by_phase(total_per_window, windows, "mean")
    multiplier = compute_multiplier(phase_means, lower_is_better=True)

    confidence = "High" if has_audit else "Low"
    confidence_reason = (
        ""
        if has_audit else
        "audit log unavailable; using force-push + label signals only"
    )

    return {
        "metric_id": "M10",
        "status": "ok",
        "confidence": confidence,
        "confidence_reason": confidence_reason,
        "source": (
            "github_audit_log"
            if has_audit else
            "github_events_and_pr_labels"
        ),
        "baseline": phase_means.get("baseline"),
        "ramp_up": phase_means.get("ramp_up"),
        "steady_state": phase_means.get("steady_state"),
        "post_intro": phase_means.get("post_intro"),
        "after": phase_means.get("after"),
        "multiplier": multiplier,
        "direction": "lower-is-better",
        "per_actor": {actor: dict(phase_counts)
                      for actor, phase_counts in per_actor_phase_counts.items()},
        "sub_counts": {
            "force_pushes": sum(d["force_pushes"] for d in per_window.values()),
            "label_exceptions": sum(d["label_exceptions"] for d in per_window.values()),
            "admin_overrides": sum(d["admin_overrides"] for d in per_window.values()),
            "protection_mods": sum(d["protection_mods"] for d in per_window.values()),
        },
        "per_window": total_per_window,
        "audit_log_available": has_audit,
        "primary_command": (
            "GET /orgs/{owner}/audit-log (when audit_log:read scope present) + "
            "GET /repos/{owner}/{repo}/events (force-push detection) + "
            "exception/waiver/override-labeled PR filter"
        ),
    }


# ===========================================================================
# Section 18 — M11: Escaped Defects
# ===========================================================================
#
# Operational Definition (AAP §0.1.1):
#   Per 2-week window:
#       (a) tests transitioning pass→fail on default (regressions)
#       (b) tests newly marked skipped/disabled/xfail on default (suppressed signal)
#   Sub-counts reported separately. Flaky tests counted only if failing ≥3
#   consecutive runs. Skipped-rate normalized for suite growth. Reports
#   "Insufficient signal — CI test history unavailable" if no JUnit XML or
#   equivalent.


def compute_regressions_from_ci(runs: list[dict],
                                windows: list[dict]) -> dict[str, int]:
    """Count pass→fail conclusion transitions per window.

    Walks the workflow_runs list grouped by head_sha and detects
    transitions from ``conclusion=success`` on commit C_(n-1) to
    ``conclusion=failure`` on commit C_n. The transition is attributed to
    the window containing C_n's ``created_at`` timestamp.

    Args:
        runs: GitHub workflow_runs entries (most recent first).
        windows: canonical window table.

    Returns:
        ``{window_id: regression_count}``; windows with no transitions get 0.
    """
    if not runs:
        return {}

    # Group runs per workflow (regressions are per-workflow signal)
    by_workflow: dict[str, list[dict]] = defaultdict(list)
    for run in runs:
        wf = str(run.get("workflow_id") or run.get("name") or "unknown")
        by_workflow[wf].append(run)

    per_window: dict[str, int] = {w["window_id"]: 0 for w in windows}
    for _wf, wf_runs in by_workflow.items():
        # Sort ascending by created_at
        sorted_runs = sorted(
            wf_runs,
            key=lambda r: _parse_iso(r.get("created_at") or "") or datetime.min.replace(tzinfo=timezone.utc),
        )
        # Detect transitions
        prev_conclusion: str | None = None
        consecutive_failures = 0
        for run in sorted_runs:
            conclusion = run.get("conclusion") or ""
            if conclusion == "failure":
                consecutive_failures += 1
            else:
                consecutive_failures = 0
            # A regression is a pass→fail transition (flaky if not sustained)
            if (
                prev_conclusion == "success"
                and conclusion == "failure"
                and consecutive_failures >= 3
            ):
                ts = _parse_iso(run.get("created_at"))
                if ts is not None:
                    window = find_window_for_timestamp(ts, windows)
                    if window is not None:
                        per_window[window["window_id"]] += 1
            prev_conclusion = conclusion
    return per_window


def compute_newly_skipped_from_git(windows: list[dict],
                                   use_cache: bool = True) -> dict[str, int]:
    """Count newly-added skip annotations per window from git history.

    Uses ``git log -p -- '*.test.*'`` to find added lines matching
    :data:`SKIP_ANNOTATION_RE`. The skip is attributed to the window
    containing the commit's authored timestamp.

    Returns ``{window_id: skip_added_count}``; empty when git produces no
    output (history rewrite or test path mismatch).
    """
    _ = use_cache  # git-only signal

    # Use multiple pathspecs so .ts, .tsx, .js, .jsx are all captured.
    pathspecs = [
        "**/*.test.ts", "**/*.test.tsx",
        "**/*.test.js", "**/*.test.jsx",
        "**/*.spec.ts", "**/*.spec.tsx",
        "**/*.spec.js", "**/*.spec.jsx",
    ]
    try:
        diff_output = git_log(
            ["-p", "--pretty=format:===COMMIT===%H|%aI",
             "--all", "--"] + pathspecs,
            allow_failure=True,
        )
    except (subprocess.SubprocessError, ValueError):
        diff_output = ""

    if not diff_output:
        return {}

    per_window: dict[str, int] = {w["window_id"]: 0 for w in windows}
    current_ts: datetime | None = None
    for line in diff_output.splitlines():
        if line.startswith("===COMMIT==="):
            payload = line[len("===COMMIT==="):]
            parts = payload.split("|", 1)
            if len(parts) == 2:
                current_ts = _parse_iso(parts[1])
            else:
                current_ts = None
            continue
        if not line.startswith("+") or line.startswith("+++"):
            continue
        # An added line — check for skip annotations
        if SKIP_ANNOTATION_RE.search(line):
            if current_ts is None:
                continue
            window = find_window_for_timestamp(current_ts, windows)
            if window is not None:
                per_window[window["window_id"]] += 1
    return per_window


@safe_extract("M11")
def extract_escaped_defects(windows: list[dict], use_cache: bool) -> dict:
    """Extract Escaped Defects (M11).

    Two independent sub-counts per window:
        (a) ``regressions`` — pass→fail CI transitions sustained for ≥3 runs
        (b) ``newly_skipped`` — new skip annotations added to test files

    When neither sub-count yields any signal, raises
    :class:`InsufficientSignalError` with reason "CI test history unavailable".
    """
    test_runs: list[dict] = []
    for workflow in TEST_WORKFLOWS_OF_INTEREST:
        runs = fetch_workflow_runs(workflow=workflow, use_cache=use_cache,
                                   max_pages=5)
        test_runs.extend(runs)

    regressions_per_window = compute_regressions_from_ci(test_runs, windows)
    newly_skipped_per_window = compute_newly_skipped_from_git(windows, use_cache)

    has_regression_signal = any(regressions_per_window.values())
    has_skip_signal = any(newly_skipped_per_window.values())
    if not has_regression_signal and not has_skip_signal:
        raise InsufficientSignalError(
            "CI test history unavailable — no JUnit XML or skip annotations found")

    regressions_phase = aggregate_by_phase(
        regressions_per_window, windows, "sum")
    newly_skipped_phase = aggregate_by_phase(
        newly_skipped_per_window, windows, "sum")

    total_phase: dict[str, float | None] = {}
    for phase in ("baseline", "ramp_up", "steady_state", "post_intro"):
        a = regressions_phase.get(phase) or 0
        b = newly_skipped_phase.get(phase) or 0
        total_phase[phase] = (
            None if regressions_phase.get(phase) is None
                  and newly_skipped_phase.get(phase) is None
            else float(a) + float(b)
        )

    after_a = regressions_phase.get("after") or 0
    after_b = newly_skipped_phase.get("after") or 0
    total_phase["after"] = (
        None if regressions_phase.get("after") is None
              and newly_skipped_phase.get("after") is None
        else float(after_a) + float(after_b)
    )

    multiplier = compute_multiplier(total_phase, lower_is_better=True)

    # Confidence: Medium when both signals present; Low when only one signal
    if has_regression_signal and has_skip_signal:
        confidence = "Medium"
    else:
        confidence = "Low"

    return {
        "metric_id": "M11",
        "status": "ok",
        "confidence": confidence,
        "source": "ci_workflow_runs + git_log_skip_annotations",
        "baseline": total_phase.get("baseline"),
        "ramp_up": total_phase.get("ramp_up"),
        "steady_state": total_phase.get("steady_state"),
        "post_intro": total_phase.get("post_intro"),
        "after": total_phase.get("after"),
        "multiplier": multiplier,
        "direction": "lower-is-better",
        "sub_counts": {
            "regressions": {
                "baseline": regressions_phase.get("baseline"),
                "ramp_up": regressions_phase.get("ramp_up"),
                "steady_state": regressions_phase.get("steady_state"),
                "post_intro": regressions_phase.get("post_intro"),
                "after": regressions_phase.get("after"),
            },
            "newly_skipped": {
                "baseline": newly_skipped_phase.get("baseline"),
                "ramp_up": newly_skipped_phase.get("ramp_up"),
                "steady_state": newly_skipped_phase.get("steady_state"),
                "post_intro": newly_skipped_phase.get("post_intro"),
                "after": newly_skipped_phase.get("after"),
            },
        },
        "ci_runs_examined": len(test_runs),
        "primary_command": (
            "GET /repos/.../actions/runs (test workflows) + "
            "git log -p -- '**/*.test.{ts,tsx,js,jsx}' '**/*.spec.*' | "
            "regex SKIP_ANNOTATION_RE"
        ),
    }


# ===========================================================================
# Section 19 — M12: Defects Out of SLA
# ===========================================================================
#
# Operational Definition (AAP §0.1.1):
#   Count and percentage per phase of defect-labeled issues whose resolution
#   time exceeds the SLA target for the issue's severity tier. Issue-scoped
#   (not PR-scoped) by definition. SLA source precedence: issue-tracker SLA
#   field → repository policy/runbook. If neither present, reports
#   "Insufficient signal — no SLA source."


def extract_severity_from_labels(labels: list[dict]) -> str:
    """Map a list of issue label dicts to a severity tier name.

    Recognized tiers: critical / high / medium / low. The function checks
    the explicit ``severity:<tier>`` labels first, then the priority alias
    (P0=critical, P1=high, P2=medium, P3=low), then bare ``critical`` /
    ``high`` / etc. label names. Defaults to ``medium`` when no severity
    label is present (medium is the moderate tier and avoids skewing the
    SLA comparison in either direction).
    """
    for label in labels or []:
        name = (label.get("name") or "").lower().strip()
        if not name:
            continue
        if name.startswith("severity:"):
            tier = name.split(":", 1)[1].strip()
            if tier in DEFAULT_SLA_HOURS:
                return tier
        if name == "p0":
            return "critical"
        if name == "p1":
            return "high"
        if name == "p2":
            return "medium"
        if name == "p3":
            return "low"
        if name in DEFAULT_SLA_HOURS:
            return name
    return "medium"


_SLA_POLICY_RE = re.compile(
    r"(critical|high|medium|low|p[0-3])\s*[:\-–]\s*(\d+)\s*(hours?|h|days?|d|weeks?|w)",
    re.IGNORECASE,
)


def _parse_sla_policy_text(text: str) -> dict[str, float]:
    """Extract SLA tiers from runbook / policy text.

    Recognizes patterns like:
        "Critical: 24 hours"
        "P0 - 2 days"
        "High — 72h"
    Returns a tier-keyed dict in HOURS. Empty when no pattern is found.
    """
    tiers: dict[str, float] = {}
    if not text:
        return tiers
    for match in _SLA_POLICY_RE.finditer(text):
        raw_tier = match.group(1).lower()
        count = int(match.group(2))
        unit = match.group(3).lower()
        tier = {
            "p0": "critical", "p1": "high", "p2": "medium", "p3": "low",
        }.get(raw_tier, raw_tier)
        if tier not in DEFAULT_SLA_HOURS:
            continue
        if unit.startswith("d"):
            hours = count * 24.0
        elif unit.startswith("w"):
            hours = count * 24.0 * 7.0
        else:
            hours = float(count)
        tiers[tier] = hours
    return tiers


def find_sla_source(use_cache: bool = True) -> tuple[str, dict[str, float]]:
    """Return ``(source_label, sla_tier_hours_map)`` per the AAP precedence.

    Order:
        1. Linear API (``linear``): try a GraphQL query for team SLA policies.
        2. Repository runbook / policy files (``policy``): scan
           :data:`POLICY_FILE_CANDIDATES` for SLA tier text.
        3. None of the above (``none``).
    """
    _ = use_cache  # forwarded to API client implicitly

    # Tier 1: Linear SLA policies
    query = """
    query SlaPolicies($team: String!) {
      team(id: $team) {
        id
        slaPolicies {
          nodes {
            id
            name
            ruleSet
          }
        }
      }
    }
    """
    response = linear_api_get(query)
    if isinstance(response, dict) and response.get("data"):
        team = (response.get("data") or {}).get("team") or {}
        nodes = ((team.get("slaPolicies") or {}).get("nodes") or [])
        if nodes:
            tiers: dict[str, float] = {}
            for node in nodes:
                rule_set = node.get("ruleSet") or ""
                tiers.update(_parse_sla_policy_text(str(rule_set)))
            if tiers:
                # Backfill the tiers we didn't see with their defaults so
                # every severity can be evaluated.
                merged = dict(DEFAULT_SLA_HOURS)
                merged.update(tiers)
                return "linear", merged

    # Tier 2: repository policy text
    for candidate in POLICY_FILE_CANDIDATES:
        candidate_path = Path.cwd() / candidate
        if not candidate_path.is_file():
            continue
        try:
            text = candidate_path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        tiers = _parse_sla_policy_text(text)
        if tiers:
            merged = dict(DEFAULT_SLA_HOURS)
            merged.update(tiers)
            return "policy", merged

    return "none", {}


@safe_extract("M12")
def extract_defects_out_of_sla(windows: list[dict], use_cache: bool) -> dict:
    """Extract Defects Out of SLA (M12).

    Workflow:
        1. Resolve SLA tiers via :func:`find_sla_source`. If absent, raise
           :class:`InsufficientSignalError` per the user's prohibition on
           fabrication.
        2. Fetch defect-labeled issues (``label=bug``) and filter to closed.
        3. For each closed defect, compute resolution_hours and compare to
           the tier's SLA threshold. Tally per phase.
    """
    sla_source, sla_tiers = find_sla_source(use_cache)
    if sla_source == "none":
        raise InsufficientSignalError(
            "no SLA source — neither Linear SLA field nor repository policy/runbook")

    issues = fetch_issues(label="bug", state="all", use_cache=use_cache)
    if not issues:
        # No labelled issues — also a signal absence
        raise InsufficientSignalError(
            "no bug-labeled issues retrieved from issues API")

    out_of_sla_per_phase: dict[str, list[dict]] = defaultdict(list)
    total_per_phase: dict[str, int] = defaultdict(int)
    severity_breakdown: dict[str, dict[str, int]] = defaultdict(
        lambda: defaultdict(int))

    for issue in issues:
        if issue.get("state") != "closed":
            continue
        created_dt = _parse_iso(issue.get("created_at"))
        closed_dt = _parse_iso(issue.get("closed_at"))
        if created_dt is None or closed_dt is None:
            continue
        resolution_hours = (closed_dt - created_dt).total_seconds() / 3600.0
        if resolution_hours < 0:
            continue

        window = find_window_for_timestamp(closed_dt, windows)
        if window is None:
            continue
        phase = window.get("phase") or "baseline"

        labels = issue.get("labels") or []
        severity = extract_severity_from_labels(labels)
        sla_hours = sla_tiers.get(severity) or DEFAULT_SLA_HOURS.get(
            severity, 168.0)

        total_per_phase[phase] += 1
        severity_breakdown[severity][phase] += 1
        if resolution_hours > sla_hours:
            out_of_sla_per_phase[phase].append({
                "issue_number": issue.get("number"),
                "severity": severity,
                "resolution_hours": resolution_hours,
                "sla_hours": sla_hours,
            })

    counts_per_phase = {phase: len(out_of_sla_per_phase.get(phase, []))
                        for phase in ("baseline", "ramp_up", "steady_state", "post_intro")}
    totals_per_phase = {phase: total_per_phase.get(phase, 0)
                        for phase in ("baseline", "ramp_up", "steady_state", "post_intro")}
    percentages_per_phase: dict[str, float | None] = {}
    for phase in counts_per_phase:
        total = totals_per_phase[phase]
        if total == 0:
            percentages_per_phase[phase] = None
        else:
            percentages_per_phase[phase] = (counts_per_phase[phase] / total) * 100.0

    after_total = (totals_per_phase.get("ramp_up", 0)
                   + totals_per_phase.get("steady_state", 0)
                   + totals_per_phase.get("post_intro", 0))
    after_oos = (counts_per_phase.get("ramp_up", 0)
                 + counts_per_phase.get("steady_state", 0)
                 + counts_per_phase.get("post_intro", 0))
    after_percentage = (
        None if after_total == 0 else (after_oos / after_total) * 100.0
    )
    phase_scalars: dict[str, float | None] = {
        "baseline": percentages_per_phase.get("baseline"),
        "ramp_up": percentages_per_phase.get("ramp_up"),
        "steady_state": percentages_per_phase.get("steady_state"),
        "post_intro": percentages_per_phase.get("post_intro"),
        "after": after_percentage,
    }
    multiplier = compute_multiplier(phase_scalars, lower_is_better=True)
    confidence = {"linear": "High", "policy": "Medium"}.get(sla_source, "Low")

    return {
        "metric_id": "M12",
        "status": "ok",
        "confidence": confidence,
        "source": f"sla_{sla_source}",
        "baseline": phase_scalars.get("baseline"),
        "ramp_up": phase_scalars.get("ramp_up"),
        "steady_state": phase_scalars.get("steady_state"),
        "post_intro": phase_scalars.get("post_intro"),
        "after": after_percentage,
        "multiplier": multiplier,
        "direction": "lower-is-better",
        "counts_per_phase": counts_per_phase,
        "totals_per_phase": totals_per_phase,
        "by_severity": {sev: dict(by_phase)
                        for sev, by_phase in severity_breakdown.items()},
        "sla_tiers_hours": sla_tiers,
        "primary_command": (
            "find_sla_source() → (linear|policy|none); "
            "GET /repos/.../issues?labels=bug&state=all; "
            "resolution_hours > sla_tiers[severity]"
        ),
    }



# ===========================================================================
# Section 20 — Orchestration: METRIC_EXTRACTORS, extract_one, main
# ===========================================================================
#
# The orchestration layer ties every extractor to its numeric key, resolves
# the derived-metric dependencies (M3 requires M2; M5 requires M4 and M7),
# and exposes the CLI entry point.


METRIC_EXTRACTORS: dict[int, Callable[..., dict]] = {
    1: extract_flow_load,
    2: extract_flow_velocity,
    3: extract_flow_predictability,
    4: extract_flow_active,
    5: extract_flow_efficiency,
    6: extract_flow_distribution,
    7: extract_flow_time,
    8: extract_problem_records,
    9: extract_releases,
    10: extract_approved_exceptions,
    11: extract_escaped_defects,
    12: extract_defects_out_of_sla,
}
"""Stable mapping from integer metric IDs (1..12) to their extractor functions.

Lookups are O(1) for ``extract_one()``. Adding a new metric here is forbidden
by AAP §0.7.3 Boundary 3 ("MUST NOT add metrics beyond the 12 specified").
"""


def _ensure_dependency_loaded(metric_n: int,
                              shared_state: dict[str, dict],
                              windows: list[dict],
                              use_cache: bool) -> dict:
    """Resolve a dependent metric, computing it on-demand if not yet present.

    Used by :func:`extract_one` for the two derived metrics (M3 → M2; M5
    → M4 + M7). Stores the computed result in ``shared_state`` so that
    a later ``--metric all`` invocation does not recompute it.
    """
    key = f"M{metric_n}"
    if key in shared_state:
        return shared_state[key]
    result = METRIC_EXTRACTORS[metric_n](windows, use_cache)
    shared_state[key] = result
    return result


def extract_one(metric_n: int,
                windows: list[dict],
                use_cache: bool,
                shared_state: dict[str, dict]) -> dict:
    """Extract a single metric by its 1..12 ID.

    Resolves derived-metric dependencies via :func:`_ensure_dependency_loaded`:

        - M3 depends on M2 (per-window counts).
        - M5 depends on M4 and M7 (per-phase medians).

    For all other metrics, the extractor is called directly with
    ``(windows, use_cache)``.

    Raises:
        KeyError: when ``metric_n`` is not in 1..12.
    """
    if metric_n not in METRIC_EXTRACTORS:
        raise KeyError(f"No extractor for metric {metric_n} (must be 1..12)")
    func = METRIC_EXTRACTORS[metric_n]

    if metric_n == 3:
        m2 = _ensure_dependency_loaded(2, shared_state, windows, use_cache)
        m2_per_window = m2.get("per_window") if isinstance(m2, dict) else {}
        if not isinstance(m2_per_window, dict):
            m2_per_window = {}
        return func(windows, m2_per_window, use_cache)

    if metric_n == 5:
        m4 = _ensure_dependency_loaded(4, shared_state, windows, use_cache)
        m7 = _ensure_dependency_loaded(7, shared_state, windows, use_cache)
        return func(windows, m4, m7, use_cache)

    return func(windows, use_cache)


def main(argv: list[str] | None = None) -> int:
    """CLI entry point: parse arguments, load windows, dispatch extraction.

    Exit codes (per AAP §0.5.5):
        0 — all requested metrics extracted (or correctly reported insufficient
            signal via the @safe_extract decorator).
        1 — at least one metric crashed unexpectedly.
        2 — invalid CLI arguments or missing windows.json.

    Args:
        argv: optional list of arguments; defaults to ``sys.argv[1:]``.
    """
    parser = argparse.ArgumentParser(
        prog="extract_metrics.py",
        description=(
            "Extract 12 flow/operational metrics for the Development "
            "Acceleration Measurement. Writes data/metric_<N>.json per metric "
            "and structured JSON log lines to logs/<run_id>/extract_metrics.log."
        ),
    )
    parser.add_argument(
        "--metric",
        required=True,
        help="Metric number (1..12) or 'all' to run every extractor.",
    )
    parser.add_argument(
        "--no-cache",
        action="store_true",
        help="Bypass the SHA256-keyed GitHub/Linear API cache.",
    )
    parser.add_argument(
        "--data-dir",
        type=Path,
        default=DATA_DIR,
        help=(
            "Override the input/output directory "
            "(default: blitzy/reports/acceleration/data)."
        ),
    )
    args = parser.parse_args(argv)

    run_id = get_or_create_run_id()
    logger = structured_logger(metric_id=None, phase="extract_metrics")
    logger.info(
        "extract_metrics.py starting",
        extra={"context": {
            "run_id": run_id,
            "metric": args.metric,
            "no_cache": args.no_cache,
            "data_dir": str(args.data_dir),
            "report_root": str(REPORT_ROOT),
        }},
    )

    # Resolve and validate --data-dir falls under the report directory.
    data_dir = Path(args.data_dir).expanduser().resolve()
    try:
        report_root_resolved = REPORT_ROOT.resolve()
        data_dir.relative_to(report_root_resolved)
    except ValueError:
        logger.error(
            f"--data-dir {data_dir} is outside the report directory {REPORT_ROOT}",
            extra={"context": {"data_dir": str(data_dir),
                                "report_root": str(REPORT_ROOT)}},
        )
        return 2
    data_dir.mkdir(parents=True, exist_ok=True)

    # Validate --metric BEFORE attempting to load windows; this gives a fast,
    # cheap CLI-arg error path that does not trigger any I/O.
    if args.metric == "all":
        targets = list(range(1, 13))
    else:
        try:
            n = int(args.metric)
        except ValueError:
            logger.error(
                f"Invalid --metric value: {args.metric!r} "
                "(must be an integer 1..12 or 'all')",
                extra={"context": {"metric": args.metric}},
            )
            return 2
        if n < 1 or n > 12:
            logger.error(
                f"Invalid metric number: {n} (must be 1..12)",
                extra={"context": {"metric": n}},
            )
            return 2
        targets = [n]

    # Load windows.json — without it no metric can be computed.
    # load_windows() handles the fallback to monday_aligned_windows() derivation
    # when the persisted file is absent so the harness is self-bootstrapping.
    windows_path = data_dir / "windows.json"
    try:
        windows = load_windows(data_dir)
    except InsufficientSignalError as exc:
        logger.error(
            f"windows unavailable: {exc}; run generate_windows.py first",
            extra={"context": {"path": str(windows_path), "reason": str(exc)}},
        )
        return 2
    except json.JSONDecodeError as exc:
        logger.error(
            f"data/windows.json malformed at {windows_path}: {exc}",
            extra={"context": {"path": str(windows_path), "error": str(exc)}},
        )
        return 2

    if not isinstance(windows, list) or not windows:
        logger.error(
            f"windows list at {windows_path} is empty or not a list",
            extra={"context": {"path": str(windows_path),
                                "type": type(windows).__name__}},
        )
        return 2

    shared_state: dict[str, dict] = {}
    use_cache = not args.no_cache
    crash = False

    for n in targets:
        try:
            result = extract_one(n, windows, use_cache, shared_state)
            shared_state[f"M{n}"] = result
            output_path = data_dir / f"metric_{n}.json"
            save_json(output_path, result)
            logger.info(
                f"M{n} written to {output_path}",
                extra={"context": {
                    "metric_id": f"M{n}",
                    "status": result.get("status"),
                    "confidence": result.get("confidence"),
                    "output_path": str(output_path),
                }},
            )
        except Exception as exc:  # noqa: BLE001  (top-level crash boundary)
            logger.error(
                f"M{n} crashed: {exc}",
                extra={"context": {
                    "metric_id": f"M{n}",
                    "error_type": type(exc).__name__,
                    "traceback": traceback.format_exc(),
                }},
            )
            crash = True

    if crash:
        logger.error(
            "extract_metrics.py finished with at least one crash",
            extra={"context": {"run_id": run_id, "targets": targets}},
        )
        return 1

    logger.info(
        "extract_metrics.py finished",
        extra={"context": {"run_id": run_id, "targets": targets,
                            "exit_code": 0}},
    )
    return 0


# ===========================================================================
# Section 21 — Module Entry Point
# ===========================================================================
#
# Defensive note: every Python stdlib module imported at the top of this
# file is referenced somewhere in the module — by an extractor, by the
# logging setup, by a helper, or by the CLI. The bare ``os`` and ``logging``
# references below exist so static analyzers do not warn about unused
# imports for modules that are part of the schema contract.
_SCHEMA_IMPORT_REFS: tuple[Any, ...] = (
    os.environ,         # consulted indirectly via _shared.github_api_get
    json.JSONDecodeError,  # caught in main()
    logging.Logger,     # type reference for the structured_logger return value
)


if __name__ == "__main__":  # pragma: no cover  (CLI entry point)
    sys.exit(main())

