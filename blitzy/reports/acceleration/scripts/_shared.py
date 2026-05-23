#!/usr/bin/env python3
"""
_shared.py — Foundational helpers for the Development Acceleration Measurement harness

This module is imported by every other script in scripts/. It contains:
  - The single ``engineering_actor(pr, phase)`` selector function — the architectural
    enforcement of the user's verbatim "identical methodology for before and after
    periods" requirement (AAP §0.1.3, decision-log.md Row 12). This is the ONLY
    place in the entire harness where actor identity branches on phase.
  - GitHub REST API client (urllib.request-based, SHA256-keyed cache under
    ``data/cache/``).
  - Linear GraphQL API client (optional, gated on ``LINEAR_API_KEY``).
  - Git subprocess wrappers (``git_run``, ``git_log``) with ``commands.log``
    appending for the Reproducibility Appendix (Rule 5).
  - Structured JSON logger with ``run_id`` correlation, writing to
    ``logs/<run_id>/<phase>.log`` and mirroring INFO+ to stderr (Observability rule).
  - Monday-aligned 2-week window arithmetic (``snap_backward_to_monday``,
    ``monday_aligned_windows``).
  - Path constants (``SCRIPT_DIR``, ``REPORT_ROOT``, ``DATA_DIR``, ``LOGS_DIR``,
    ``CACHE_DIR``) and deliverable target paths.
  - Repository identity constants (``REPO_OWNER``, ``REPO_NAME``) and Blitzy
    Agent identifiers (``BLITZY_AUTHOR_EMAIL``, ``BLITZY_ACTOR_LABEL``).
  - Bot identification (``BOT_LOGINS``) — Blitzy Agent is deliberately NOT a bot.
  - Subjective-token blocklist (``SUBJECTIVE_TOKENS``) consumed by
    ``build_report.py``'s factual-neutral-tone grep pass (Rule 2).
  - JSON I/O helpers (``load_json``, ``save_json``, ``load_all_metrics``).
  - Utility helpers (``is_blitzy_actor``, ``is_blitzy_authored_pr``,
    ``iso_now_utc``, ``safe_get``).

All operations are READ-ONLY on the analyzed repository (User Boundary 1).
Python 3.10+ stdlib only — NO third-party packages (User Constraint).
No fabrication: helpers return ``None`` or raise on missing data; never invent
values (User Boundary 2).
No secrets logged: ``GITHUB_TOKEN``, ``LINEAR_API_KEY``, and ``BLITZY_TOKEN``
are read from the environment only and are defensively redacted from
``commands.log`` even when they were never passed in.

References:
  - decision-log.md Row 12 — engineering_actor selector
  - decision-log.md Row 13 — observability non-applicabilities
  - decision-log.md Row 17 — cache-by-default
  - acceleration-report.md §Methodology
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterable


# ---------------------------------------------------------------------------
# Section 1 — Path Constants
# ---------------------------------------------------------------------------
#
# The harness lives under ``blitzy/reports/acceleration/`` in the destination
# repository. All output (data captures, logs, deliverables) is written
# beneath this root so the analyzed repository is never touched outside of
# read-only Git invocations.
#
# Resolution is computed from ``__file__`` so the harness is location-
# independent — moving the report directory or running the scripts from a
# different working directory does not break path resolution.

SCRIPT_DIR: Path = Path(__file__).resolve().parent
"""Absolute path to ``blitzy/reports/acceleration/scripts/``."""

REPORT_ROOT: Path = SCRIPT_DIR.parent
"""Absolute path to ``blitzy/reports/acceleration/`` (deliverable root)."""

DATA_DIR: Path = REPORT_ROOT / "data"
"""Absolute path to ``blitzy/reports/acceleration/data/`` (raw extraction outputs)."""

LOGS_DIR: Path = REPORT_ROOT / "logs"
"""Absolute path to ``blitzy/reports/acceleration/logs/`` (per-run structured logs)."""

CACHE_DIR: Path = DATA_DIR / "cache"
"""Absolute path to ``blitzy/reports/acceleration/data/cache/`` (GitHub API cache).

Each cache entry is a single JSON file named ``<sha256>.json`` where the digest
is computed from the request URL and the non-authentication request headers.
The authentication header is deliberately excluded so different tokens (e.g.,
personal vs CI) hit the same cache entries when the request is otherwise
identical.
"""

# ---------------------------------------------------------------------------
# Section 2 — Deliverable Target Paths
# ---------------------------------------------------------------------------
#
# These are the five user-facing deliverables produced by the harness. They
# are exported as constants so ``build_report.py``, ``build_presentation.py``,
# and ``validate_consistency.py`` can reference them without hardcoded paths.

ACCELERATION_REPORT_PATH: Path = REPORT_ROOT / "acceleration-report.md"
"""Primary analytical report (Markdown) containing all 12 metric deep-dives,
the traceability matrix, the acceleration curve, per-engineer breakdowns,
risk assessment, limitations, and the Reproducibility Appendix.
"""

EXECUTIVE_PRESENTATION_PATH: Path = REPORT_ROOT / "executive-presentation.html"
"""Self-contained reveal.js 5.1.0 deck (HTML) for non-technical leadership.

12–18 slides (target 16); four slide types (Title, Divider, Content, Closing);
pinned CDN versions (reveal.js 5.1.0, Mermaid 11.4.0, Lucide 0.460.0); inline
Blitzy brand variables; 1920×1080 viewport; zero emoji.
"""

DASHBOARD_PATH: Path = REPORT_ROOT / "dashboard.md"
"""Observability dashboard template summarizing all 12 metrics with thresholds,
confidence tags, per-phase values, and correlation-ID format documentation.
Satisfies the Observability rule for a batch analysis harness (no service
endpoint exists; the dashboard is a Markdown surface read by the user).
"""

DECISION_LOG_PATH: Path = REPORT_ROOT / "decision-log.md"
"""Explainability deliverable — Markdown table of every non-trivial decision
with alternatives considered, rationale, risks, and reversibility notes.
Satisfies the Explainability rule. Row 12 documents this module's
``engineering_actor`` selector.
"""

README_PATH: Path = REPORT_ROOT / "README.md"
"""Onboarding deliverable for any future maintainer of the harness. Covers
Purpose, Quickstart, Domain Context, Common Pitfalls, Architecture, and
Suggested Next Tasks. Satisfies the Onboarding rule by co-location (the
analyzed repository's root README is read-only per User Boundary 1).
"""

# ---------------------------------------------------------------------------
# Section 3 — Repository Identity Constants
# ---------------------------------------------------------------------------
#
# Default values are the canonical analyzed repository identifiers; override
# via environment variables when re-running the harness against a fork or a
# different repository.

REPO_OWNER: str = os.environ.get("BLITZY_REPO_OWNER", "Blitzy-Sandbox").strip() or "Blitzy-Sandbox"
"""GitHub organization or user owning the analyzed repository. Default
``Blitzy-Sandbox``; overridable via ``BLITZY_REPO_OWNER`` env var.
"""

REPO_NAME: str = os.environ.get("BLITZY_REPO_NAME", "blitzy-cal").strip() or "blitzy-cal"
"""GitHub repository name. Default ``blitzy-cal``; overridable via
``BLITZY_REPO_NAME`` env var.
"""

# ---------------------------------------------------------------------------
# Section 4 — Blitzy Agent Identifiers
# ---------------------------------------------------------------------------
#
# These constants identify the AI engineering tool (Blitzy Agent) whose
# introduction defines the temporal boundary for the analysis (AAP §0.1.4).
# Blitzy Agent is the *engineering actor* for the after period — NOT a bot
# (see ``BOT_LOGINS`` below for the bot-exclusion list).

BLITZY_AUTHOR_EMAIL: str = "agent@blitzy.com"
"""Canonical email address of Blitzy Agent commits. Used by
``is_blitzy_actor`` and ``is_blitzy_authored_pr`` to detect Blitzy authorship
in Git commit metadata and PR bodies.
"""

BLITZY_ACTOR_LABEL: str = "blitzy-agent"
"""Canonical label used to represent Blitzy in per-actor aggregations. Every
metric that breaks down by actor (Metrics 2, 4, 5, 6, 10 per AAP §0.1.3) uses
this label as the actor identifier for Blitzy's contributions in the after
period.
"""

BLITZY_AUTHOR_NAMES: tuple[str, ...] = (
    "Blitzy Agent",
    "Blitzy",
    "blitzy-agent",
    "blitzy-bot",
    "Blitzy-Agent",
    "blitzy",
)
"""Tuple of name variants used by Blitzy Agent across Git commits and PR
metadata. ``is_blitzy_actor`` matches against this tuple case-insensitively.
"""

# ---------------------------------------------------------------------------
# Section 5 — Bot Identification (M1 / M2 exclusion list)
# ---------------------------------------------------------------------------
#
# These accounts perform automated dependency upgrades and infrastructure
# maintenance. Per AAP §0.1.1 (Metric 1 definition) and §0.2.3 (initial
# reconnaissance findings), they are excluded from Flow Load (M1) and Flow
# Velocity (M2) counts because their activity does not reflect product
# engineering work.
#
# The list is derived from:
#   - ``.kodiak.toml::auto_approve_usernames`` (dependabot, github-actions)
#   - Well-known dependency-management bots in the JavaScript ecosystem
#     (renovate, snyk-bot, imgbot, allcontributors)
#   - Repository merge-queue automation (kodiak, kodiakhq)
#
# GitHub renders bot logins both with and without a ``[bot]`` suffix
# depending on context (API responses use the suffix; UI sometimes does not),
# so both variants are included.
#
# Blitzy Agent is deliberately ABSENT from this set. Although automated,
# Blitzy is the engineering ACTOR for the after period — including it in
# bot exclusions would render Metrics 2, 4, 5, 6, and 10 meaningless because
# the user's framing makes Blitzy the entity producing code on PRs (see
# decision-log.md Row 11).

BOT_LOGINS: frozenset[str] = frozenset({
    # Dependabot — GitHub's native dependency upgrader
    "dependabot",
    "dependabot[bot]",
    "dependabot-preview",
    "dependabot-preview[bot]",
    # GitHub Actions native automation account
    "github-actions",
    "github-actions[bot]",
    # Renovate — third-party dependency upgrader
    "renovate",
    "renovate[bot]",
    "renovate-bot",
    # Kodiak — merge queue automation (referenced in .kodiak.toml)
    "kodiak",
    "kodiakhq",
    "kodiakhq[bot]",
    # Snyk — vulnerability remediation bot
    "snyk-bot",
    "snyk-bot[bot]",
    # Imgbot — image optimization bot
    "imgbot",
    "imgbot[bot]",
    # All Contributors — README badge generator
    "allcontributors",
    "allcontributors[bot]",
    # Codecov — coverage upload bot (PR comment posts)
    "codecov",
    "codecov[bot]",
    # GitGuardian — secret scanner
    "gitguardian-bot",
    "gitguardian-bot[bot]",
})
"""Set of GitHub login strings identifying dependency-management and
infrastructure bots that must be excluded from Flow Load (M1) and Flow
Velocity (M2). Bracket variants (``[bot]`` suffix) are included because
GitHub renders the same logical account both ways. Blitzy Agent is
deliberately absent from this set — see decision-log.md Row 11.
"""

# ---------------------------------------------------------------------------
# Section 6 — Subjective Token Blocklist (Rule 2 — Factual-Neutral Tone)
# ---------------------------------------------------------------------------
#
# The user's verbatim rule (AAP §0.7.2 Rule 2): "Zero subjective qualifiers
# in the report body — no 'impressive,' 'significant,' 'excellent,'
# 'remarkable,' 'unfortunately.' Verification: grep for subjective terms
# returns zero matches."
#
# This blocklist is the canonical authority for the grep pass performed by
# ``build_report.py`` at the end of the report build. Any token appearing
# in the report body that case-insensitively matches an entry here causes
# the build to fail. The blocklist is intentionally broad: the rule's
# intent is factual-neutral tone, not minimal compliance.

SUBJECTIVE_TOKENS: frozenset[str] = frozenset({
    # User-cited tokens (verbatim from AAP §0.7.2 Rule 2)
    "impressive",
    "significant",
    "excellent",
    "remarkable",
    "unfortunately",
    # Related qualifiers in the same semantic field
    "notable",
    "striking",
    "dramatic",
    "surprising",
    "astonishing",
    "tremendous",
    "outstanding",
    "extraordinary",
    "marvelous",
    "marvellous",
    "staggering",
    "incredible",
    "phenomenal",
    "spectacular",
    "fascinating",
    "compelling",
    "noteworthy",
    "powerful",
    "robust",
    "elegant",
    "seamless",
    "transformative",
    "groundbreaking",
    "revolutionary",
    "innovative",
    "world-class",
    "best-in-class",
    "cutting-edge",
    "game-changing",
    "amazing",
    "awesome",
    "fantastic",
    "superb",
    "excellently",
    "remarkably",
    "significantly",
    "impressively",
    "notably",
    "strikingly",
    "dramatically",
    "surprisingly",
    "fortunately",
    "regrettably",
    "sadly",
    "happily",
})
"""Frozen set of case-insensitive substrings forbidden in the report body
per Rule 2 (Factual-Neutral Tone). Consumed by ``build_report.py``'s final
grep pass. Tokens are matched as whole words via the build script to avoid
false positives.
"""


# ---------------------------------------------------------------------------
# Section 7 — HTTP API Constants
# ---------------------------------------------------------------------------
#
# These constants configure the GitHub REST API client (``github_api_get``)
# and the Linear GraphQL client (``linear_api_get``). They are exported so
# downstream scripts can reference them in log messages and error context.

GITHUB_API_BASE: str = "https://api.github.com"
"""Base URL for the GitHub REST API. Endpoints are appended either as
absolute paths (``/repos/{owner}/{repo}/pulls``) or as repo-relative paths
(``pulls``) that ``github_api_get`` prefixes with
``/repos/{REPO_OWNER}/{REPO_NAME}/``.
"""

GITHUB_API_VERSION: str = "2022-11-28"
"""Pinned ``X-GitHub-Api-Version`` header value. GitHub recommends pinning
the API version to ensure stable schema across the run."""

HTTP_TIMEOUT: int = 60
"""Per-request timeout in seconds for both GitHub REST and Linear GraphQL
requests. 60 seconds is chosen because some endpoints (paginated PR lists,
repository commits) can take 10–30 seconds for large monorepos."""

RATE_LIMIT_BACKOFF_SECONDS: int = 60
"""Backoff duration in seconds when GitHub returns HTTP 429 (rate limit
exceeded). The harness sleeps for this duration and retries the same URL.
GitHub's primary rate limit is 5,000 requests per hour for personal access
tokens; the cache (``CACHE_DIR``) keeps the working set well below the
limit, but background reruns or concurrent invocations can still trip it.
"""

LINEAR_API_BASE: str = "https://api.linear.app/graphql"
"""GraphQL endpoint for the Linear API. Used only if ``LINEAR_API_KEY`` is
set in the environment; otherwise Linear queries return ``None`` and the
metrics that depend on Linear (M6 classification, M12 SLA lookup) fall back
to GitHub Issues and conventional-commit signals per AAP §0.8.3.
"""

# ---------------------------------------------------------------------------
# Section 8 — Window Arithmetic Constants
# ---------------------------------------------------------------------------

WINDOW_DAYS_DEFAULT: int = 14
"""Default window length in days for Monday-aligned aggregation windows.
The user specified 2-week windows in AAP §0.1.3; this constant is the
authoritative source for that interval and is consumed by
``monday_aligned_windows`` and by ``generate_windows.py``.
"""

# ---------------------------------------------------------------------------
# Section 9 — Run ID Resolution
# ---------------------------------------------------------------------------
#
# Every invocation of the harness has a single ``run_id`` that correlates
# every log line, every cache entry, and every output file produced by
# that invocation. The run_id is a UUIDv4 by default but can be overridden
# via the ``BLITZY_RUN_ID`` environment variable so multiple scripts
# launched from a shell wrapper share a run_id.
#
# The first call to ``get_or_create_run_id`` in a Python process resolves
# the run_id and caches it in the module-level ``_RUN_ID_CACHE``; every
# subsequent call returns the cached value, ensuring all log files for a
# single process invocation land in the same directory.

_RUN_ID_CACHE: str | None = None
"""Process-local cache of the resolved run_id. Set by the first call to
``get_or_create_run_id`` and never reset thereafter. The leading underscore
marks it as module-private; downstream scripts call the function, not the
cache.
"""


def get_or_create_run_id() -> str:
    """Resolve the run_id for this harness invocation.

    Resolution order (first match wins):
        1. Process-local cache (``_RUN_ID_CACHE``)
        2. ``BLITZY_RUN_ID`` environment variable (after ``strip()``)
        3. Newly-generated UUIDv4

    Side effects:
        - Caches the resolved value in ``_RUN_ID_CACHE`` so all subsequent
          calls in this process return the same value.
        - Creates the directory ``logs/<run_id>/`` (if it does not exist)
          so log handlers can write immediately without race conditions.

    Returns:
        The run_id string. Format: a UUIDv4 (default) or the verbatim value
        from ``BLITZY_RUN_ID`` if that env var was set to a non-empty string.

    Notes:
        - Run IDs are NOT validated against the UUIDv4 format when read from
          ``BLITZY_RUN_ID``; users can pass any non-empty string (e.g., a
          human-readable label like ``"2026-05-15-rerun"``) and it will be
          used verbatim as the log subdirectory name.
        - The first call's process-local cache means tests that need a
          fresh run_id must clear ``_RUN_ID_CACHE`` directly or set
          ``BLITZY_RUN_ID`` in the environment before importing this module.
    """
    global _RUN_ID_CACHE
    if _RUN_ID_CACHE is not None:
        return _RUN_ID_CACHE

    env_run_id = os.environ.get("BLITZY_RUN_ID", "").strip()
    if env_run_id:
        _RUN_ID_CACHE = env_run_id
    else:
        _RUN_ID_CACHE = str(uuid.uuid4())

    # Eagerly create the per-run log directory so file handlers can attach
    # without a race when multiple scripts launch in parallel.
    (LOGS_DIR / _RUN_ID_CACHE).mkdir(parents=True, exist_ok=True)
    return _RUN_ID_CACHE


# ---------------------------------------------------------------------------
# Section 10 — Structured JSON Logger (Observability rule)
# ---------------------------------------------------------------------------
#
# The Observability rule (AAP §0.7.1) requires structured logging with
# correlation IDs. The harness emits one JSON object per log record, with
# a fixed schema:
#
#     {
#         "ts":        <ISO 8601 UTC timestamp>,
#         "level":     <DEBUG | INFO | WARNING | ERROR | CRITICAL>,
#         "run_id":    <the resolved run_id for this invocation>,
#         "metric":    <"M1".."M12" | null>,
#         "phase":     <"harness" | "verify_environment" | ...>,
#         "message":   <the log message>,
#         "context":   <optional dict of structured context fields>,
#         "exception": <optional formatted traceback>,
#     }
#
# Log records are written to TWO destinations:
#
#   - File: logs/<run_id>/<phase>.log (DEBUG and above; persistent)
#   - stderr: INFO and above (visibility during interactive runs)
#
# Both destinations use the same formatter, so the JSON schema is
# identical across them.
#
# Loggers are CACHED by (phase, run_id) so repeated calls return the same
# underlying logger instance and we avoid attaching multiple file handlers
# to the same log file (which would duplicate every record on disk).


class _StructuredJSONFormatter(logging.Formatter):
    """Format ``LogRecord`` instances as single-line JSON for observability.

    The JSON schema is documented in the module docstring and in
    ``dashboard.md``. Every record carries the run_id, the phase, an
    optional metric ID (M1..M12), the message, and an optional structured
    ``context`` dict and ``exception`` traceback.
    """

    def __init__(self, run_id: str) -> None:
        """Initialize with the run_id that will be embedded in every record.

        Args:
            run_id: The process-wide run_id resolved by
                ``get_or_create_run_id``. Stored as an instance attribute
                so the formatter does not need to re-resolve it for every
                record.
        """
        super().__init__()
        self.run_id = run_id

    def format(self, record: logging.LogRecord) -> str:
        """Format a single ``LogRecord`` as a one-line JSON string.

        Args:
            record: The ``LogRecord`` produced by the logging framework.
                Custom attributes ``_metric_id``, ``_phase``, and
                ``context`` are read via ``getattr`` so records that lack
                them still format cleanly.

        Returns:
            A single-line JSON object (no trailing newline; the file
            handler adds one). Non-JSON-serializable values in
            ``context`` are converted to strings via ``default=str``.
        """
        payload: dict[str, Any] = {
            "ts": datetime.now(timezone.utc).isoformat(),
            "level": record.levelname,
            "run_id": self.run_id,
            "metric": getattr(record, "_metric_id", None),
            "phase": getattr(record, "_phase", record.name),
            "message": record.getMessage(),
        }
        ctx = getattr(record, "context", None)
        if ctx is not None:
            payload["context"] = ctx
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload, default=str, ensure_ascii=False)


_LOGGERS: dict[str, logging.Logger] = {}
"""Process-local cache of (cache_key -> Logger) so repeated
``structured_logger()`` calls for the same phase return the same logger
and we never duplicate file handlers.
"""


class _MetricContextAdapter(logging.LoggerAdapter):
    """``LoggerAdapter`` that injects ``_metric_id`` and ``_phase`` into the
    ``extra`` dict of every log call.

    The adapter is the bridge between caller-friendly invocations like
    ``logger.info("hello", extra={"context": {...}})`` and the
    ``_StructuredJSONFormatter`` which reads ``_metric_id`` and ``_phase``
    via ``getattr`` on the record.
    """

    def __init__(self, logger: logging.Logger, metric_id: str | None, phase: str) -> None:
        """Initialize the adapter with the metric ID and phase to inject.

        Args:
            logger: The underlying ``Logger`` instance.
            metric_id: The metric identifier (e.g., ``"M7"``) or ``None``
                for non-metric phases (e.g., ``"harness"``).
            phase: The phase label that becomes the log file name
                (``logs/<run_id>/<phase>.log``) and a structured field.
        """
        super().__init__(logger, {})
        self._metric_id = metric_id
        self._phase = phase

    def process(self, msg: Any, kwargs: dict[str, Any]) -> tuple[Any, dict[str, Any]]:
        """Inject ``_metric_id`` and ``_phase`` into the record's ``extra`` dict.

        The ``extra`` dict (a logging-framework convention) is merged into
        the ``LogRecord`` as attributes, where the formatter can read them
        via ``getattr``. We use leading underscores in the attribute names
        so they do not collide with any standard ``LogRecord`` attribute.
        """
        extra = kwargs.setdefault("extra", {})
        extra["_metric_id"] = self._metric_id
        extra["_phase"] = self._phase
        return msg, kwargs


def structured_logger(metric_id: str | None = None, phase: str = "harness") -> logging.Logger:
    """Return a logger configured for JSON output to ``logs/<run_id>/<phase>.log``.

    The returned object is a ``logging.LoggerAdapter`` wrapping a cached
    underlying ``logging.Logger``. The adapter's ``process()`` method
    injects ``metric_id`` and ``phase`` into every record's ``extra`` dict
    so the ``_StructuredJSONFormatter`` can include them in the JSON output.

    Args:
        metric_id: Optional metric identifier (``"M1"`` through ``"M12"``)
            attached to every record produced by this logger. Use ``None``
            for non-metric phases such as ``"harness"`` or
            ``"verify_environment"``.
        phase: The phase label that becomes both the log file name
            (``logs/<run_id>/<phase>.log``) and the structured ``phase``
            field in every record. Defaults to ``"harness"``.

    Returns:
        A ``logging.LoggerAdapter`` instance. The adapter exposes the
        standard logger interface (``debug``, ``info``, ``warning``,
        ``error``, ``critical``, ``exception``); use the ``extra`` kwarg
        with a ``context`` key to attach structured context (e.g.,
        ``logger.info("retrying", extra={"context": {"attempt": 2}})``).

    Side effects:
        - Resolves the run_id via ``get_or_create_run_id`` (creates the
          per-run log directory if it does not exist).
        - On first call for a given ``(phase, run_id)`` tuple, creates a
          new file handler writing to ``logs/<run_id>/<phase>.log`` and
          a stderr handler at INFO level. Subsequent calls reuse the
          cached logger and return a fresh adapter.

    Notes:
        - The logger's ``propagate`` flag is set to ``False`` to prevent
          duplicate records from being emitted via the root logger's
          handlers, which can happen when third-party code configures
          ``logging.basicConfig`` before this module is imported.
        - File handlers use ``encoding="utf-8"`` so non-ASCII content
          (e.g., issue titles in non-English languages) is preserved.
    """
    run_id = get_or_create_run_id()
    cache_key = f"{phase}::{run_id}"

    if cache_key in _LOGGERS:
        base_logger = _LOGGERS[cache_key]
    else:
        log_path = LOGS_DIR / run_id / f"{phase}.log"
        log_path.parent.mkdir(parents=True, exist_ok=True)

        base_logger = logging.getLogger(f"blitzy.acceleration.{cache_key}")
        base_logger.setLevel(logging.DEBUG)
        base_logger.propagate = False

        # File handler captures everything; persistent record of the run.
        file_handler = logging.FileHandler(log_path, encoding="utf-8")
        file_handler.setFormatter(_StructuredJSONFormatter(run_id))
        file_handler.setLevel(logging.DEBUG)
        base_logger.addHandler(file_handler)

        # stderr handler emits INFO+ for visibility during interactive runs;
        # DEBUG records are file-only to avoid spamming the terminal.
        stderr_handler = logging.StreamHandler(sys.stderr)
        stderr_handler.setFormatter(_StructuredJSONFormatter(run_id))
        stderr_handler.setLevel(logging.INFO)
        base_logger.addHandler(stderr_handler)

        _LOGGERS[cache_key] = base_logger

    return _MetricContextAdapter(base_logger, metric_id, phase)


# ---------------------------------------------------------------------------
# Section 11 — commands.log Append (Reproducibility rule)
# ---------------------------------------------------------------------------
#
# The Reproducibility Appendix in ``acceleration-report.md`` must contain
# the complete, ordered set of commands and API calls used to derive every
# metric (AAP §0.7.2 Rule 5). The harness builds this catalog by appending
# every git invocation, every HTTP request, every JSON read, and every JSON
# write to ``logs/<run_id>/commands.log`` in execution order.
#
# Each line has the format:
#
#     <ISO 8601 UTC timestamp> <command_type> <command_string>
#
# Command types currently in use:
#   - "git"   — A git CLI invocation. The command string is the full
#               argv joined by spaces (e.g., "git log --all --format=...").
#   - "http"  — An HTTP request (GitHub REST or Linear GraphQL). The
#               command string is "<METHOD> <URL>".
#   - "read"  — A file read via ``load_json``.
#   - "write" — A file write via ``save_json`` or by the cache populator.
#
# IMPORTANT: This function defensively redacts any environment-variable
# token value it finds in the command string. Callers should ALSO redact
# tokens before calling (defense in depth) — the function does not
# *guarantee* redaction of secrets that are not stored in the standard
# env vars.


def command_log_append(command_type: str, command_string: str) -> None:
    """Append one line to ``logs/<run_id>/commands.log``.

    The Reproducibility Appendix in ``acceleration-report.md`` is generated
    verbatim from this log, so the format and ordering matter. Every git
    invocation, every HTTP request, every JSON read, and every JSON write
    flows through this function.

    Args:
        command_type: A short label classifying the command. Standard
            values are ``"git"``, ``"http"``, ``"read"``, ``"write"``,
            ``"subprocess"``. New values can be introduced freely; the
            report build groups them in the appendix by type.
        command_string: The textual representation of the command. For
            git, this is the full argv joined by spaces. For HTTP, it is
            ``"<METHOD> <URL>"``. For file operations, it is the file path.

    Side effects:
        - Resolves the run_id and ensures ``logs/<run_id>/`` exists.
        - Opens ``logs/<run_id>/commands.log`` in append mode and writes
          one line.
        - Defensively redacts ``GITHUB_TOKEN``, ``LINEAR_API_KEY``, and
          ``BLITZY_TOKEN`` env-var values from the command string before
          writing.

    Notes:
        - The function is best-effort safe — it catches all exceptions
          internally and does not propagate them, because failing to log
          a command should never abort the metric extraction. Callers
          MUST NOT rely on this function for correctness; they should
          treat it as a fire-and-forget audit trail.
        - The timestamp uses microsecond precision so command ordering is
          unambiguous even when commands fire in rapid succession.
    """
    run_id = get_or_create_run_id()
    path = LOGS_DIR / run_id / "commands.log"
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
    except OSError:
        # If we can't create the directory, we can't log — but we also
        # can't recover meaningfully. Silently drop the line.
        return

    ts = datetime.now(timezone.utc).isoformat()

    # Defensive redaction: replace any matching env-var token VALUE with
    # a placeholder. Callers SHOULD redact before calling, but we do it
    # again here to catch accidents.
    redacted = command_string
    for env_key in ("GITHUB_TOKEN", "LINEAR_API_KEY", "BLITZY_TOKEN", "BLITZY_GITHUB_TOKEN"):
        val = os.environ.get(env_key, "")
        # Only redact if the value is non-empty AND long enough to be a
        # real token (>= 8 chars) — otherwise we risk substring-matching
        # innocuous tokens like a single character.
        if val and len(val) >= 8 and val in redacted:
            redacted = redacted.replace(val, f"<{env_key}_REDACTED>")

    line = f"{ts} {command_type} {redacted}\n"
    try:
        with path.open("a", encoding="utf-8") as fh:
            fh.write(line)
    except OSError:
        # Fire-and-forget; logging failure must not break extraction.
        return


# ---------------------------------------------------------------------------
# Section 12 — Engineering Actor Selector (CRITICAL — Decision Log Row 12)
# ---------------------------------------------------------------------------
#
# This section is the architectural enforcement of the user's verbatim
# requirement (AAP §0.7.3):
#
#     "MUST use identical methodology for before and after periods —
#      same window alignment, same extraction logic, different date range."
#
# The user's framing (AAP §0.1.3) states that in the after period, Blitzy
# is treated as the engineering actor — the entity producing code on the
# PR. Blitzy works alone on its PRs; humans review but do not co-author.
# Metrics that measure working time (Metric 4 Flow Active, Metric 5 Flow
# Efficiency) are computed from the engineering actor's perspective.
# Metrics that aggregate by actor (Metrics 2, 4, 5, 6, 10) include Blitzy
# as one row in the after period alongside human contributors.
#
# This module defines the SINGLE function that decides which actor's
# timestamps and commits feed a given metric for a given phase. Every
# per-actor aggregation site in ``extract_metrics.py`` calls this one
# function. There is no other branch on phase in the codebase that
# selects an actor identity.
#
# The result: the identical-methodology guarantee is structurally
# inevitable. Any future bug fix, feature addition, or refactor that
# changed the actor-selection logic would have to modify THIS function,
# and the modification would apply to both periods symmetrically. The
# only way to break the guarantee is to add a new branch on phase
# elsewhere in the codebase, which is detectable by code review.
#
# Reversing this design decision (e.g., implementing two parallel
# extraction paths) would require touching every call site of
# ``engineering_actor`` plus rewriting the consistency-check assertions
# in ``validate_consistency.py``. See decision-log.md Row 12 for the full
# rationale.


def engineering_actor(pr: dict, phase: str) -> str:
    """Return the actor identifier for a PR under a given phase.

    This is the SINGLE branching point for actor identity across baseline
    and after periods. All per-actor aggregations in the harness call this
    one function; the identical-methodology guarantee for Baseline and
    After periods is enforced architecturally by routing every per-actor
    decision through here.

    Selection rule:
        - If ``phase == "baseline"``: return the PR's human author login
          (``pr["user"]["login"]``).
        - Otherwise (after, ramp_up, steady_state, post_intro): return
          the canonical ``BLITZY_ACTOR_LABEL`` if the PR was authored by
          Blitzy Agent (per ``is_blitzy_authored_pr``); else return the
          human author login.

    Args:
        pr: A PR dict in the schema returned by the GitHub REST API's
            ``GET /repos/{owner}/{repo}/pulls/{n}`` endpoint, optionally
            enriched with a ``commits_data`` key (populated by
            ``extract_metrics.py`` when commit-level analysis is needed).
            Required keys: ``user`` (with nested ``login``). Optional
            keys consulted by ``is_blitzy_authored_pr``: ``title``,
            ``body``, ``head.ref``, ``commits_data``.
        phase: One of ``"baseline"``, ``"ramp_up"``, ``"steady_state"``,
            ``"post_intro"``, or ``"after"``. Only ``"baseline"`` is
            special-cased; all other values trigger the after-period
            Blitzy substitution.

    Returns:
        The actor login string. Either the PR's human author login or
        ``BLITZY_ACTOR_LABEL`` (``"blitzy-agent"``) if Blitzy authored
        the PR in a non-baseline phase. Returns ``"unknown"`` if the
        PR has no ``user.login`` field (defensive fallback for
        deleted-user PRs in GitHub's response schema).

    Examples:
        >>> pr = {"user": {"login": "alice"}, "head": {"ref": "feature/x"}}
        >>> engineering_actor(pr, "baseline")
        'alice'
        >>> engineering_actor(pr, "after")
        'alice'
        >>> pr_blitzy = {"user": {"login": "alice"},
        ...              "head": {"ref": "blitzy-2026-03-01"}}
        >>> engineering_actor(pr_blitzy, "baseline")
        'alice'
        >>> engineering_actor(pr_blitzy, "after")
        'blitzy-agent'
    """
    # Resolve the human author login defensively. Some PRs returned by
    # the GitHub API have ``user: null`` (deleted users), so the chained
    # ``or {}`` and ``or "unknown"`` guard against ``TypeError`` and
    # ``AttributeError`` from ``None``.
    user = pr.get("user") or {}
    human_login = user.get("login") or "unknown"

    if phase == "baseline":
        return human_login

    # After-period substitution: if either the human author login itself
    # matches Blitzy or the PR's metadata indicates a Blitzy authorship,
    # return the canonical Blitzy label so per-actor aggregations group
    # all Blitzy work under a single row.
    if is_blitzy_actor(human_login) or is_blitzy_authored_pr(pr):
        return BLITZY_ACTOR_LABEL
    return human_login


def is_blitzy_actor(login_or_email: str) -> bool:
    """Return ``True`` if the given login or email identifies Blitzy Agent.

    This function is consulted by ``engineering_actor`` (for the PR's
    human author login) and by ``is_blitzy_authored_pr`` (for commit
    author emails). It checks against:

      1. The canonical Blitzy email (``BLITZY_AUTHOR_EMAIL``).
      2. The canonical actor label (``BLITZY_ACTOR_LABEL``).
      3. Every entry in ``BLITZY_AUTHOR_NAMES`` (exact match, case-
         insensitive).
      4. Substring patterns: any string containing both ``"blitzy"`` AND
         ``"bot"``, or any string containing ``"blitzy-agent"``.

    Args:
        login_or_email: A GitHub login (e.g., ``"alice"``) or an email
            address (e.g., ``"agent@blitzy.com"``). Empty strings and
            ``None`` return ``False``.

    Returns:
        ``True`` if the input identifies Blitzy Agent; ``False`` otherwise.

    Examples:
        >>> is_blitzy_actor("agent@blitzy.com")
        True
        >>> is_blitzy_actor("Blitzy Agent")
        True
        >>> is_blitzy_actor("blitzy-agent")
        True
        >>> is_blitzy_actor("alice")
        False
        >>> is_blitzy_actor("")
        False
    """
    if not login_or_email:
        return False
    s = login_or_email.lower().strip()
    if not s:
        return False
    if s == BLITZY_AUTHOR_EMAIL.lower():
        return True
    if s == BLITZY_ACTOR_LABEL.lower():
        return True
    for name in BLITZY_AUTHOR_NAMES:
        if s == name.lower():
            return True
    # Substring fallbacks for known patterns that vary across systems
    # (e.g., commit committer fields, PR review submitter emails).
    if "blitzy" in s and "bot" in s:
        return True
    if "blitzy-agent" in s:
        return True
    return False


def is_blitzy_authored_pr(pr: dict) -> bool:
    """Return ``True`` if a PR was authored by Blitzy Agent.

    Authorship is detected through multiple signals because the GitHub
    PR schema does not include a single authoritative "author" field —
    the ``user`` field is the *opener*, which may be a human reviewer
    who opened the PR on Blitzy's behalf. The signals (any one is
    sufficient) are:

      1. PR title contains ``"[Blitzy]"`` (the convention Blitzy uses
         for its automated PRs).
      2. PR body contains the Blitzy author email
         (``agent@blitzy.com``) — typical of Blitzy-generated commits
         with the ``Co-authored-by`` trailer.
      3. PR body contains both ``"Co-authored-by:"`` AND ``"blitzy"``.
      4. PR head branch name starts with ``"blitzy-"`` or ``"blitzy/"``.
      5. Any commit in the PR (if commit data is attached as
         ``commits_data``) has Blitzy as its author email or name.

    Args:
        pr: A PR dict from the GitHub REST API. Consulted keys:
            ``title``, ``body``, ``head.ref``, ``commits_data`` or
            ``_commits_data`` (an optional list of commit dicts attached
            by ``extract_metrics.py`` when commit-level analysis is
            needed).

    Returns:
        ``True`` if any Blitzy authorship signal is present; ``False``
        otherwise.
    """
    title = (pr.get("title") or "").lower()
    body = (pr.get("body") or "").lower()
    head = pr.get("head") or {}
    branch = (head.get("ref") or "").lower()

    # Signal 1 — PR title marker
    if "[blitzy]" in title or "[blitzy" in title:
        return True
    # Signal 2 — author email in body
    if BLITZY_AUTHOR_EMAIL.lower() in body:
        return True
    # Signal 3 — co-author trailer naming Blitzy
    if "co-authored-by:" in body and "blitzy" in body:
        return True
    # Signal 4 — branch naming convention
    if branch.startswith("blitzy-") or branch.startswith("blitzy/"):
        return True

    # Signal 5 — commit-level author email or name (if commit data is
    # attached). ``commits_data`` is the convention used by
    # ``extract_metrics.py``; ``_commits_data`` is an alternative name
    # used by some test fixtures.
    commits = pr.get("commits_data") or pr.get("_commits_data") or []
    if commits:
        for c in commits:
            commit_obj = c.get("commit") or {}
            author = commit_obj.get("author") or {}
            email = (author.get("email") or "").lower()
            if email == BLITZY_AUTHOR_EMAIL.lower():
                return True
            if is_blitzy_actor(email):
                return True
            name = (author.get("name") or "").lower()
            if "blitzy" in name and ("agent" in name or "bot" in name):
                return True
            # Also check the top-level commit's committer field for
            # cases where Blitzy is the committer but not the author
            # (e.g., GitHub UI merges).
            committer = commit_obj.get("committer") or {}
            committer_email = (committer.get("email") or "").lower()
            if committer_email == BLITZY_AUTHOR_EMAIL.lower():
                return True
    return False



# ---------------------------------------------------------------------------
# Section 13 — Git Subprocess Wrappers
# ---------------------------------------------------------------------------
#
# Git history is the primary signal for Metrics 1, 2, 4, 5, 7, 8, 9, and 11
# (per AAP §0.2.1). The wrappers ``git_run`` and ``git_log`` invoke the
# ``git`` CLI via ``subprocess.run`` with three important behaviors:
#
#   1. Every invocation is logged to ``commands.log`` BEFORE execution so
#      the Reproducibility Appendix captures it even if the subprocess
#      crashes.
#   2. ``allow_failure=True`` lets metric extractors handle expected
#      failure modes (e.g., merge-base check returning non-zero when
#      ancestor relationship doesn't hold) without try/except boilerplate.
#   3. UTF-8 decoding with ``errors="replace"`` ensures non-ASCII commit
#      messages (the Cal.com codebase has commits in multiple languages)
#      do not crash the parser.
#
# Git invocations are intentionally restricted to read-only operations:
#   - ``git log``, ``git show``, ``git rev-list``, ``git tag --list``,
#     ``git merge-base``, ``git blame``, ``git diff``.
# No write operations (``git commit``, ``git push``, ``git tag <new>``)
# are exposed by these wrappers; the analyzed repository is treated as
# read-only per User Boundary 1.


def git_run(args: list[str] | tuple[str, ...] | Iterable[str],
            repo_root: str | Path = ".",
            allow_failure: bool = False,
            timeout: int = 120) -> str:
    """Run a git command and return its stdout as a decoded string.

    Args:
        args: Arguments to pass to ``git`` (e.g., ``["log", "--all"]``).
            The ``git`` binary itself is prepended automatically. Any
            iterable of strings is accepted and converted to a list.
        repo_root: Working directory for the subprocess (default: ``"."``,
            the current working directory at invocation time). Must be a
            string or ``Path`` pointing to a valid git repository.
        allow_failure: If ``True``, returns an empty string when git
            exits non-zero. If ``False`` (default), raises
            ``subprocess.CalledProcessError`` on non-zero exit. Use
            ``allow_failure=True`` for queries like ``merge-base
            --is-ancestor`` where a non-zero return is expected and
            semantically meaningful.
        timeout: Seconds before ``subprocess.run`` aborts the command
            (default 120). Raised as ``subprocess.TimeoutExpired``.

    Returns:
        The subprocess stdout decoded as UTF-8 with ``errors="replace"``.
        On ``allow_failure=True`` and non-zero exit, returns ``""``.

    Raises:
        subprocess.CalledProcessError: If git exits non-zero and
            ``allow_failure=False``.
        subprocess.TimeoutExpired: If the subprocess runs longer than
            ``timeout`` seconds.
        FileNotFoundError: If ``git`` is not installed or not on PATH.

    Side effects:
        - Appends one line to ``logs/<run_id>/commands.log`` with
          ``command_type="git"`` and the full argv joined by spaces.
    """
    args_list = list(args)
    cmd = ["git"] + args_list
    # Log to commands.log BEFORE execution so the trail captures the
    # attempt even if the subprocess crashes.
    command_log_append("git", " ".join(cmd))
    try:
        result = subprocess.run(
            cmd,
            cwd=str(repo_root),
            check=not allow_failure,
            capture_output=True,
            timeout=timeout,
        )
    except subprocess.CalledProcessError:
        if allow_failure:
            return ""
        raise
    # Some git commands (e.g., merge-base --is-ancestor) succeed with
    # empty stdout; that is a valid result and we return "" without
    # raising.
    return result.stdout.decode("utf-8", errors="replace")


def git_log(args: list[str] | tuple[str, ...] | Iterable[str],
            repo_root: str | Path = ".",
            allow_failure: bool = False) -> str:
    """Convenience wrapper for ``git log <args>``.

    Equivalent to ``git_run(["log"] + list(args), repo_root, allow_failure)``.
    Most metric extractors query ``git log`` with various ``--format=`` and
    filter flags; this helper saves them from prepending ``"log"`` to
    every argv.

    Args:
        args: Arguments to pass to ``git log`` (e.g.,
            ``["--all", "--format=%H %aI"]``). The leading ``"log"`` is
            inserted automatically.
        repo_root: Working directory (see ``git_run``).
        allow_failure: Whether to suppress non-zero exits (see ``git_run``).

    Returns:
        Decoded stdout from the ``git log`` invocation.

    Raises:
        Same exceptions as ``git_run``.
    """
    return git_run(["log"] + list(args), repo_root=repo_root, allow_failure=allow_failure)


# ---------------------------------------------------------------------------
# Section 14 — GitHub REST API Client
# ---------------------------------------------------------------------------
#
# The GitHub REST API is the primary signal for Metrics 1, 2, 4, 5, 7, 8,
# 9, 10, and 12 (per AAP §0.2.1). The client (``github_api_get``) is built
# on ``urllib.request`` to avoid third-party dependencies.
#
# Key behaviors:
#
#   1. Cache-by-default. Every response is persisted under
#      ``CACHE_DIR/<sha256>.json`` where the digest is computed from the
#      request URL plus all non-Authorization headers. Cache hits are
#      logged at DEBUG level; cache misses fetch the resource and write
#      the response back to the cache.
#
#   2. Authorization-aware caching. The Authorization header is EXCLUDED
#      from the cache key so different tokens hit the same cache entries
#      when the request is otherwise identical (e.g., a personal token
#      and a CI token both querying the same public repository).
#
#   3. Pagination. ``paginate=True`` follows the GitHub Link header's
#      ``rel="next"`` URL until exhausted and returns the concatenated
#      list. The combined list is written to a single cache entry keyed
#      by the FIRST page's URL (so subsequent runs with the same starting
#      URL get the full paginated result instantly).
#
#   4. Rate limit handling. HTTP 429 triggers a sleep of
#      ``RATE_LIMIT_BACKOFF_SECONDS`` and a retry. The retry loop is
#      unbounded — under sustained rate limiting, the harness will block
#      until GitHub stops 429-ing.
#
#   5. Status code handling.
#        - 200/201/302 → parsed JSON
#        - 404 → empty list (for plural endpoints) or ``None``
#        - 401/403 → ``None`` (auth failure)
#        - 429 → backoff and retry
#        - 5xx → ``None`` after one log entry
#
#   6. Endpoint resolution. An endpoint string is resolved as follows:
#        - Starts with ``"http"``: used as-is (for follow-up paginated URLs)
#        - Starts with ``"/"``: appended directly to ``GITHUB_API_BASE``
#        - Otherwise: prefixed with ``/repos/{REPO_OWNER}/{REPO_NAME}/``


def _cache_key(url: str, headers: dict[str, str]) -> str:
    """Compute the SHA256 cache key for a GET request.

    The key is the SHA256 of:
        <url>\\n<JSON of sorted (header_name, value) pairs, excluding Authorization>

    Excluding Authorization means two different tokens fetching the same
    URL with the same other headers will hit the same cache entry, which
    is the desired behavior for reproducibility (the response body is
    independent of the auth token used to fetch it).

    Args:
        url: The fully-resolved request URL (including any query string).
        headers: The complete header dict that WILL be sent with the
            request. ``Authorization`` is filtered out before hashing.

    Returns:
        The hex-encoded SHA256 digest (64 lowercase characters).
    """
    filtered = {k: v for k, v in sorted(headers.items()) if k.lower() != "authorization"}
    payload = url + "\n" + json.dumps(filtered, sort_keys=True)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _build_github_headers() -> dict[str, str]:
    """Build the standard request header dict for a GitHub REST API call.

    Includes the API version pin, the ``application/vnd.github+json``
    Accept type, and the harness's User-Agent string. If
    ``GITHUB_TOKEN`` is present in the environment, an ``Authorization``
    header is added with ``Bearer`` scheme; otherwise the request is
    unauthenticated (and subject to GitHub's 60-requests-per-hour
    unauthenticated rate limit).

    Returns:
        A dict suitable for passing to ``urllib.request.Request``.
    """
    headers: dict[str, str] = {
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": GITHUB_API_VERSION,
        "User-Agent": "blitzy-acceleration-harness/1.0",
    }
    token = os.environ.get("GITHUB_TOKEN", "").strip()
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return headers


def _parse_next_link(link_header: str) -> str | None:
    """Parse a GitHub ``Link`` header and return the ``rel="next"`` URL.

    The GitHub API returns a Link header on paginated responses with the
    format::

        <https://api.github.com/...&page=2>; rel="next",
        <https://api.github.com/...&page=5>; rel="last"

    Args:
        link_header: The raw Link header string from the response. Empty
            or absent header returns ``None``.

    Returns:
        The URL of the next page, or ``None`` if there is no next page.
    """
    if not link_header:
        return None
    for part in link_header.split(","):
        if 'rel="next"' in part:
            start = part.find("<")
            end = part.find(">")
            if start >= 0 and end > start:
                return part[start + 1:end].strip()
    return None


def github_api_get(endpoint: str,
                   params: dict | None = None,
                   use_cache: bool = True,
                   paginate: bool = False) -> Any:
    """Perform a GET request against the GitHub REST API.

    This is the primary HTTP entry point for every metric that consults
    GitHub. It handles endpoint resolution, cache lookup, request
    construction, pagination, rate-limit backoff, and error handling.

    Args:
        endpoint: One of:
            - A path under ``/repos/{owner}/{repo}/`` (e.g.,
              ``"pulls"``, ``"pulls/123/reviews"``). The repo prefix
              is added automatically.
            - An absolute API path starting with ``/`` (e.g.,
              ``"/orgs/Blitzy-Sandbox/audit-log"``). Used as-is under
              ``GITHUB_API_BASE``.
            - A full URL starting with ``"http"`` (used by the
              pagination follower for subsequent page URLs).
        params: Optional query parameters. Encoded with
            ``urllib.parse.urlencode`` and appended to the URL.
        use_cache: If ``True`` (default), check ``CACHE_DIR`` for an
            existing cache entry before hitting the network. On cache
            miss, fetch from GitHub and write the response back to the
            cache.
        paginate: If ``True``, follow the Link header's ``rel="next"``
            URL until exhausted and return the concatenated list. The
            combined list is written to a single cache entry. If the
            initial response is not a list, a warning is logged and the
            response is returned as-is.

    Returns:
        The parsed JSON response. For ``paginate=True``, a list of all
        results across all pages. For non-paginated requests, the
        response is whatever GitHub returned (typically a list or a
        dict). Returns:
          - ``[]`` (empty list) on HTTP 404 for plural endpoints
            (heuristic: endpoint string ends in ``"s"``).
          - ``None`` on HTTP 404 for singular endpoints.
          - ``None`` on HTTP 401/403 (auth failure).
          - ``None`` on network errors after one log entry.
          - The empty results list on ``paginate=True`` with no
            successful pages.

    Side effects:
        - Logs every fetch (cache miss) to ``commands.log`` with
          ``command_type="http"``.
        - Writes successful responses to ``CACHE_DIR/<sha256>.json``.
        - Logs each cache write to ``commands.log`` with
          ``command_type="write"``.
        - On HTTP 429, blocks for ``RATE_LIMIT_BACKOFF_SECONDS`` and
          retries.

    Notes:
        - The ``use_cache`` flag controls READ behavior; writes always
          happen on successful fetch so re-running with cache enabled
          gets fresh data on the first call and cached data thereafter.
        - To force a fresh fetch without populating the cache, pass
          ``use_cache=False`` — though this is rarely needed.
        - The pagination follower writes the combined list under the
          FIRST page's cache key, not under per-page keys. This means
          re-running a paginated query gets the full set in one read.
    """
    logger = structured_logger(phase="github_api")

    # Endpoint resolution -- three modes
    if endpoint.startswith("http://") or endpoint.startswith("https://"):
        url = endpoint
    elif endpoint.startswith("/"):
        url = GITHUB_API_BASE + endpoint
    else:
        url = f"{GITHUB_API_BASE}/repos/{REPO_OWNER}/{REPO_NAME}/{endpoint}"

    # Query string
    if params:
        qs = urllib.parse.urlencode(params, doseq=True)
        separator = "&" if "?" in url else "?"
        url = f"{url}{separator}{qs}"

    headers = _build_github_headers()
    cache_path = CACHE_DIR / f"{_cache_key(url, headers)}.json"

    # Cache read
    if use_cache and cache_path.is_file():
        logger.debug(
            f"Cache HIT: {url}",
            extra={"context": {"url": url, "cache_path": str(cache_path)}},
        )
        try:
            return json.loads(cache_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError) as exc:
            # Corrupt cache entry -- log and refetch.
            logger.warning(
                f"Cache read failed for {cache_path}; refetching",
                extra={"context": {"error": str(exc), "cache_path": str(cache_path)}},
            )

    # Network fetch (with optional pagination)
    all_results: list = []
    next_url: str | None = url
    pages_fetched = 0

    while next_url:
        command_log_append("http", f"GET {next_url}")
        try:
            req = urllib.request.Request(next_url, headers=headers, method="GET")
            with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT) as response:
                raw = response.read()
                body = raw.decode("utf-8", errors="replace")
                data = json.loads(body)
                link_header = response.getheader("Link", "")
        except urllib.error.HTTPError as exc:
            if exc.code == 404:
                logger.info(
                    f"404 from {next_url}; returning empty result",
                    extra={"context": {"url": next_url}},
                )
                if paginate:
                    break
                # Heuristic: plural endpoints return [] on 404; singular
                # return None. The heuristic looks at the endpoint, not
                # the URL (the URL may have been an arbitrary follow URL).
                return [] if endpoint.rstrip("/").endswith("s") else None
            if exc.code in (401, 403):
                logger.error(
                    f"Auth failure ({exc.code}) for {next_url}",
                    extra={"context": {"url": next_url, "code": exc.code}},
                )
                if paginate:
                    break
                return None
            if exc.code == 429:
                logger.warning(
                    f"Rate limit hit at {next_url}; backing off {RATE_LIMIT_BACKOFF_SECONDS}s",
                    extra={"context": {"url": next_url, "backoff_seconds": RATE_LIMIT_BACKOFF_SECONDS}},
                )
                time.sleep(RATE_LIMIT_BACKOFF_SECONDS)
                continue  # retry the same next_url
            logger.error(
                f"HTTP error {exc.code} for {next_url}: {exc}",
                extra={"context": {"code": exc.code, "url": next_url, "error": str(exc)}},
            )
            if paginate:
                break
            return None
        except (urllib.error.URLError, TimeoutError, ConnectionError) as exc:
            logger.error(
                f"Network error fetching {next_url}: {exc}",
                extra={"context": {"url": next_url, "error": str(exc)}},
            )
            if paginate:
                break
            return None
        except json.JSONDecodeError as exc:
            logger.error(
                f"JSON decode failure for {next_url}: {exc}",
                extra={"context": {"url": next_url, "error": str(exc)}},
            )
            if paginate:
                break
            return None

        pages_fetched += 1

        if paginate and isinstance(data, list):
            all_results.extend(data)
            next_url = _parse_next_link(link_header)
        else:
            # Single page (or non-list response with paginate=True). Write
            # to cache and return immediately.
            if paginate and not isinstance(data, list):
                logger.warning(
                    f"paginate=True requested but response is not a list at {url}",
                    extra={"context": {"url": url, "response_type": type(data).__name__}},
                )
            try:
                CACHE_DIR.mkdir(parents=True, exist_ok=True)
                cache_path.write_text(
                    json.dumps(data, indent=2, ensure_ascii=False),
                    encoding="utf-8",
                )
                command_log_append("write", str(cache_path))
            except OSError as exc:
                logger.warning(
                    f"Cache write failed for {cache_path}: {exc}",
                    extra={"context": {"cache_path": str(cache_path), "error": str(exc)}},
                )
            return data

    # End of pagination loop -- write combined list to cache and return.
    if paginate:
        try:
            CACHE_DIR.mkdir(parents=True, exist_ok=True)
            cache_path.write_text(
                json.dumps(all_results, indent=2, ensure_ascii=False),
                encoding="utf-8",
            )
            command_log_append("write", str(cache_path))
        except OSError as exc:
            logger.warning(
                f"Cache write failed for paginated result at {cache_path}: {exc}",
                extra={"context": {"cache_path": str(cache_path), "error": str(exc), "pages": pages_fetched}},
            )
        return all_results

    # Should not reach here; defensive fallback.
    return None



# ---------------------------------------------------------------------------
# Section 15 — Linear API Client (optional, GraphQL POST)
# ---------------------------------------------------------------------------
#
# Linear is the canonical issue tracker for the analyzed repository
# (confirmed via .github/PULL_REQUEST_TEMPLATE.md, AAP §0.2.1). If
# LINEAR_API_KEY is set in the environment, the client makes a single
# GraphQL POST and returns the parsed JSON. If LINEAR_API_KEY is absent,
# the client returns None immediately, and the metrics that consult
# Linear (M6 classification, M12 SLA lookup) fall back to GitHub Issues
# and conventional-commit signals (AAP §0.8.3).
#
# Linear's GraphQL API uses the Authorization header WITHOUT the "Bearer"
# prefix (different from GitHub). The token is passed as a raw string.


def linear_api_get(query: str, variables: dict | None = None) -> Any:
    """Execute a GraphQL query against the Linear API.

    Args:
        query: A GraphQL query string. Typical queries include
            ``"query Issues { issues(filter: { ... }) { ... } }"``.
        variables: Optional GraphQL query variables passed in the
            request body as ``{"query": ..., "variables": ...}``.

    Returns:
        The parsed JSON response from Linear (a dict with ``data`` and
        optional ``errors`` keys), or ``None`` in any of these cases:
            - ``LINEAR_API_KEY`` is not set in the environment.
            - HTTP error (4xx, 5xx).
            - Network error or timeout.
            - JSON decode failure.

    Side effects:
        - Logs the POST attempt to ``commands.log`` (the body is NOT
          logged; only the endpoint URL, to avoid leaking query
          contents that may include secrets or PII).
        - Logs a SKIPPED entry on missing ``LINEAR_API_KEY`` so the
          appendix shows where Linear was consulted vs not consulted.
    """
    logger = structured_logger(phase="linear_api")
    token = os.environ.get("LINEAR_API_KEY", "").strip()
    if not token:
        logger.info(
            "LINEAR_API_KEY not set; skipping Linear API query",
            extra={"context": {"query_length": len(query)}},
        )
        command_log_append("http", "POST https://api.linear.app/graphql (SKIPPED — no API key)")
        return None

    headers = {
        # Linear's GraphQL API expects the raw token, NOT "Bearer <token>"
        "Authorization": token,
        "Content-Type": "application/json",
        "User-Agent": "blitzy-acceleration-harness/1.0",
    }
    payload_dict = {"query": query, "variables": variables or {}}
    payload = json.dumps(payload_dict).encode("utf-8")

    # Log the URL only -- the query body may contain sensitive filters.
    command_log_append("http", f"POST {LINEAR_API_BASE} (GraphQL)")

    try:
        req = urllib.request.Request(
            LINEAR_API_BASE,
            data=payload,
            headers=headers,
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT) as response:
            raw = response.read()
            return json.loads(raw.decode("utf-8", errors="replace"))
    except urllib.error.HTTPError as exc:
        logger.error(
            f"Linear API HTTP error {exc.code}: {exc}",
            extra={"context": {"code": exc.code, "error": str(exc)}},
        )
        return None
    except (urllib.error.URLError, TimeoutError, ConnectionError) as exc:
        logger.error(
            f"Linear API network error: {exc}",
            extra={"context": {"error": str(exc)}},
        )
        return None
    except json.JSONDecodeError as exc:
        logger.error(
            f"Linear API JSON decode failure: {exc}",
            extra={"context": {"error": str(exc)}},
        )
        return None


# ---------------------------------------------------------------------------
# Section 16 — JSON I/O Helpers
# ---------------------------------------------------------------------------
#
# All metric extraction outputs are persisted as JSON files under
# ``DATA_DIR``. The helpers ``load_json`` and ``save_json`` standardize
# the read/write pattern (UTF-8, pretty-printed with 2-space indent) and
# log every operation to ``commands.log`` for the Reproducibility Appendix.
#
# ``load_all_metrics`` is a convenience helper that loads every
# ``data/metric_<N>.json`` file (N=1..12) into a single dict keyed by
# ``"M<N>"``. It is used by ``validate_consistency.py`` to perform
# cross-section value comparisons (Rule 4) and by ``build_report.py``
# to populate the single ``metrics_results`` dict from which the
# Executive Summary, Deep-Dives, Traceability Matrix, and Acceleration
# Curve are all rendered.


def load_json(path: Path | str) -> Any:
    """Load and parse a JSON file.

    Args:
        path: Filesystem path to a JSON file. May be a ``str`` or a
            ``Path``; converted internally.

    Returns:
        The parsed JSON value (typically a dict or list).

    Raises:
        FileNotFoundError: If the path does not exist or is not a regular
            file. The error message includes the full path for debugging.
        json.JSONDecodeError: If the file exists but contains invalid
            JSON. The original line/column information is preserved.

    Side effects:
        - Logs a ``"read"`` entry to ``commands.log``.
    """
    path = Path(path)
    command_log_append("read", str(path))
    if not path.is_file():
        raise FileNotFoundError(f"JSON file not found: {path}")
    return json.loads(path.read_text(encoding="utf-8"))


def save_json(path: Path | str, data: Any, indent: int = 2) -> None:
    """Serialize ``data`` to a JSON file at ``path``.

    Args:
        path: Filesystem path to write to. Parent directories are created
            if missing. May be a ``str`` or a ``Path``.
        data: The Python value to serialize. Must be JSON-serializable
            after the ``default=str`` fallback (which coerces datetimes,
            Path objects, and other non-native types to strings).
        indent: Indentation level for pretty-printing (default 2).
            Pass ``None`` for compact (single-line) output.

    Side effects:
        - Creates ``path.parent`` if it does not exist.
        - Writes UTF-8 with ``ensure_ascii=False`` so non-ASCII content
          (e.g., issue titles, commit messages) is preserved verbatim
          rather than escaped to ``\\uXXXX`` sequences.
        - Logs a ``"write"`` entry to ``commands.log``.
    """
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(data, indent=indent, default=str, ensure_ascii=False),
        encoding="utf-8",
    )
    command_log_append("write", str(path))


def load_all_metrics(data_dir: Path | str = DATA_DIR) -> dict[str, dict]:
    """Load every ``metric_<N>.json`` file (N=1..12) from a data directory.

    Args:
        data_dir: Directory containing the metric files. Defaults to
            ``DATA_DIR`` (``blitzy/reports/acceleration/data/``).

    Returns:
        A dict keyed by ``"M1"`` through ``"M12"``, with each value the
        parsed contents of the corresponding ``metric_<N>.json`` file.
        Guaranteed to contain all 12 keys on successful return.

    Raises:
        FileNotFoundError: If any of the 12 metric files is missing. The
            error message lists ALL missing files (not just the first)
            so the caller can fix everything at once.

    Side effects:
        - Calls ``load_json`` for each file, which logs a ``"read"``
          entry to ``commands.log`` per file.
    """
    data_dir = Path(data_dir)
    metrics: dict[str, dict] = {}
    missing: list[str] = []
    for n in range(1, 13):
        path = data_dir / f"metric_{n}.json"
        if not path.is_file():
            missing.append(str(path))
            continue
        # Use load_json so the read is logged.
        metrics[f"M{n}"] = load_json(path)
    if missing:
        raise FileNotFoundError(
            "Missing metric files (expected 12, missing "
            + str(len(missing))
            + "): "
            + ", ".join(missing)
        )
    return metrics


# ---------------------------------------------------------------------------
# Section 17 — Window Arithmetic Helpers
# ---------------------------------------------------------------------------
#
# The user's specification (AAP §0.1.3) requires Monday-aligned 2-week
# windows for every metric. The canonical generator is in
# generate_windows.py, which writes data/windows.json; the helpers below
# are provided for ad-hoc use cases (e.g., tests, ad-hoc analyses) and
# encode the same logic.
#
# Window boundary rule: a window ``[Mon 00:00:00 UTC, Mon+14d 00:00:00 UTC)``
# is assigned to the After phase if at least 7 of its 14 days fall on or
# after the inflection date; otherwise it is assigned to Baseline. This is
# the "majority of days" rule documented in decision-log.md Row 2.


def snap_backward_to_monday(dt: datetime) -> datetime:
    """Snap a datetime backward to the most recent Monday at 00:00:00 UTC.

    "Most recent Monday" means: if ``dt`` is already a Monday at exactly
    midnight UTC, the function returns ``dt`` unchanged (in UTC). For any
    other ``dt``, the function subtracts ``dt.weekday()`` days (so
    Tuesday subtracts 1, Sunday subtracts 6) and zeros out the
    hour/minute/second/microsecond fields.

    Args:
        dt: The datetime to snap. May be timezone-aware or naive. If
            naive, it is assumed to be UTC (per AAP §0.1.4 convention).

    Returns:
        A timezone-aware datetime with ``tzinfo=timezone.utc``,
        ``hour=0``, ``minute=0``, ``second=0``, ``microsecond=0``, and
        ``weekday()==0`` (Monday).

    Examples:
        >>> from datetime import datetime, timezone
        >>> snap_backward_to_monday(datetime(2026, 5, 15, 14, 30, tzinfo=timezone.utc))
        datetime.datetime(2026, 5, 11, 0, 0, tzinfo=datetime.timezone.utc)
        >>> # Monday 2026-05-11 at midnight stays unchanged
        >>> snap_backward_to_monday(datetime(2026, 5, 11, 0, 0, tzinfo=timezone.utc))
        datetime.datetime(2026, 5, 11, 0, 0, tzinfo=datetime.timezone.utc)
    """
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    else:
        dt = dt.astimezone(timezone.utc)
    days_since_monday = dt.weekday()  # 0=Mon, 6=Sun
    monday_dt = dt - timedelta(days=days_since_monday)
    return monday_dt.replace(hour=0, minute=0, second=0, microsecond=0)


def monday_aligned_windows(start: datetime,
                           end: datetime,
                           inflection: datetime,
                           window_days: int = WINDOW_DAYS_DEFAULT) -> list[dict]:
    """Generate Monday-aligned windows spanning ``[start, end]``.

    Each window is a dict with the following keys:
        - ``window_id``: ``"W0000"``, ``"W0001"``, ... (zero-padded).
        - ``start_iso``: ISO 8601 timestamp of the window's start
          (Monday 00:00:00 UTC, written as ``"...Z"``).
        - ``end_iso``: ISO 8601 timestamp of the window's end
          (Monday+14d, exclusive).
        - ``phase``: ``"baseline"`` or ``"after"`` per the majority-of-
          days rule (≥7 days post-inflection → after).
        - ``days_post_inflection``: integer count of days in the window
          on or after the inflection date (0..``window_days``).

    Args:
        start: The earliest commit datetime in the analyzed repository
            (typically the result of ``git log --reverse | head -1``).
        end: The latest commit datetime (typically "now" or the analysis
            cutoff date).
        inflection: The chosen AI tool introduction date (per
            ``data/inflection.json#chosen_date``).
        window_days: Window length in days. Defaults to
            ``WINDOW_DAYS_DEFAULT`` (14). The user specified 2-week
            windows; other values are supported for testing.

    Returns:
        A list of window dicts spanning from the Monday on-or-before
        ``start`` to the Monday on-or-after ``end + window_days``.
        Always non-empty (at least one window is emitted).

    Notes:
        - This is the AD-HOC helper. The CANONICAL window table lives at
          ``data/windows.json`` and is produced by ``generate_windows.py``.
          Metric extractors read the canonical version; this helper is
          for tests, exploratory scripts, and consistency-check inputs.
        - The end boundary is inclusive in spirit but the loop emits
          windows while ``current < aligned_end``, so the last window
          may extend past ``end`` by up to ``window_days - 1`` days.
    """
    aligned_start = snap_backward_to_monday(start)
    # Push aligned_end one window past the natural end so the last
    # interval covering ``end`` is included.
    aligned_end = snap_backward_to_monday(end + timedelta(days=window_days))
    aligned_inflection = snap_backward_to_monday(inflection)

    windows: list[dict] = []
    current = aligned_start
    idx = 0
    while current < aligned_end:
        window_end = current + timedelta(days=window_days)

        # Days post-inflection: how many days in [current, window_end)
        # fall on or after aligned_inflection.
        if window_end <= aligned_inflection:
            days_post = 0
        elif current >= aligned_inflection:
            days_post = window_days
        else:
            # Straddle: partial overlap on the trailing end of the window.
            days_post = (window_end - aligned_inflection).days

        days_post = max(0, min(days_post, window_days))

        # Majority of days rule: >= 7 days post-inflection -> after.
        phase = "after" if days_post >= (window_days // 2) else "baseline"

        windows.append({
            "window_id": f"W{idx:04d}",
            "start_iso": current.isoformat().replace("+00:00", "Z"),
            "end_iso": window_end.isoformat().replace("+00:00", "Z"),
            "phase": phase,
            "days_post_inflection": days_post,
        })
        current = window_end
        idx += 1

    return windows


# ---------------------------------------------------------------------------
# Section 18 — Utility Helpers
# ---------------------------------------------------------------------------


def iso_now_utc() -> str:
    """Return the current UTC time as an ISO 8601 string with microseconds.

    The format is ``"YYYY-MM-DDTHH:MM:SS.microsecond+00:00"`` — the
    Python ``isoformat()`` default for a timezone-aware datetime. This
    matches the format used in ``data/environment.json#extracted_at``
    and in the ``ts`` field of structured log records.

    Returns:
        Example: ``"2026-05-15T18:42:31.123456+00:00"``.
    """
    return datetime.now(timezone.utc).isoformat()


def safe_get(d: Any, *keys: Any, default: Any = None) -> Any:
    """Safely traverse a nested dict / list / object structure.

    Returns the value at the nested path defined by ``keys``, or
    ``default`` if any step of the traversal fails. Useful for parsing
    GitHub API responses where deeply-nested fields may be missing
    (e.g., ``pr["user"]["login"]`` when ``user`` is ``None`` for
    deleted-user PRs).

    Args:
        d: The root dict (or list) to traverse.
        *keys: A sequence of keys (or indices, for lists). Each key is
            applied in order; if a key is missing or the current value
            is not a dict/list, ``default`` is returned.
        default: The value to return on traversal failure (default
            ``None``).

    Returns:
        ``d[keys[0]][keys[1]]...[keys[-1]]`` if every step succeeds,
        otherwise ``default``.

    Examples:
        >>> safe_get({"a": {"b": {"c": 42}}}, "a", "b", "c")
        42
        >>> safe_get({"a": None}, "a", "b", "c")
        >>> safe_get({"a": None}, "a", "b", "c", default="missing")
        'missing'
        >>> safe_get({"a": [1, 2, 3]}, "a", 1)
        2
    """
    cur: Any = d
    for k in keys:
        if cur is None:
            return default
        if isinstance(cur, dict):
            if k not in cur:
                return default
            cur = cur[k]
        elif isinstance(cur, list):
            if not isinstance(k, int):
                return default
            if k < -len(cur) or k >= len(cur):
                return default
            cur = cur[k]
        else:
            return default
    if cur is None:
        return default
    return cur


# ---------------------------------------------------------------------------
# Section 19 — Module Self-Test (executed when run directly)
# ---------------------------------------------------------------------------
#
# When ``_shared.py`` is invoked directly (``python3 _shared.py``), it
# performs a minimal self-test of the critical helpers and prints a
# JSON status object to stdout. This is NOT a unit test (those live
# under blitzy_adhoc_test_*.py or in a future tests/ subdirectory);
# it is a smoke test that any script can run to verify the module loads
# and its helpers are functional in the current environment.
#
# The self-test:
#   1. Resolves the run_id.
#   2. Emits one log record to logs/<run_id>/harness.log.
#   3. Snaps a known date to Monday and verifies the result.
#   4. Generates a small window table and verifies its shape.
#   5. Exercises engineering_actor on a synthetic baseline PR and a
#      synthetic after-period Blitzy PR.
#   6. Prints a JSON status object indicating which checks passed.


def _self_test() -> dict:
    """Run a minimal smoke test of the module's critical helpers.

    Returns:
        A dict summarizing which checks passed/failed. Used by the
        ``if __name__ == "__main__"`` block at the end of the module.

    This is intentionally NOT a unit test — it does not assert; it
    records pass/fail for each check and returns the summary. The
    invocation prints the summary as JSON to stdout for inspection.
    """
    results: dict[str, Any] = {
        "run_id": None,
        "checks": {},
        "errors": [],
    }

    try:
        results["run_id"] = get_or_create_run_id()
        results["checks"]["run_id_resolved"] = True
    except Exception as exc:
        results["errors"].append(f"run_id_resolution: {exc}")
        results["checks"]["run_id_resolved"] = False

    try:
        logger = structured_logger(phase="harness")
        logger.info("Self-test log line", extra={"context": {"self_test": True}})
        results["checks"]["logger_emits"] = True
    except Exception as exc:
        results["errors"].append(f"logger: {exc}")
        results["checks"]["logger_emits"] = False

    try:
        # Snap a Thursday backward; expect the preceding Monday.
        # 2026-05-14 is a Thursday; expect 2026-05-11 Monday.
        snapped = snap_backward_to_monday(datetime(2026, 5, 14, 12, 0, tzinfo=timezone.utc))
        results["checks"]["snap_to_monday"] = (
            snapped.year == 2026 and snapped.month == 5 and snapped.day == 11
            and snapped.weekday() == 0 and snapped.hour == 0
        )
    except Exception as exc:
        results["errors"].append(f"snap_to_monday: {exc}")
        results["checks"]["snap_to_monday"] = False

    try:
        windows = monday_aligned_windows(
            start=datetime(2026, 2, 1, tzinfo=timezone.utc),
            end=datetime(2026, 5, 15, tzinfo=timezone.utc),
            inflection=datetime(2026, 2, 25, tzinfo=timezone.utc),
        )
        results["checks"]["windows_generated"] = len(windows) > 0
        results["checks"]["windows_have_phases"] = all(
            w["phase"] in ("baseline", "after") for w in windows
        )
    except Exception as exc:
        results["errors"].append(f"windows: {exc}")
        results["checks"]["windows_generated"] = False
        results["checks"]["windows_have_phases"] = False

    try:
        baseline_pr = {"user": {"login": "alice"}, "head": {"ref": "feature/x"}}
        blitzy_pr = {"user": {"login": "alice"}, "head": {"ref": "blitzy-2026-03-01"}, "title": "[Blitzy] task"}
        results["checks"]["engineering_actor_baseline"] = (
            engineering_actor(baseline_pr, "baseline") == "alice"
        )
        results["checks"]["engineering_actor_after_human"] = (
            engineering_actor(baseline_pr, "after") == "alice"
        )
        results["checks"]["engineering_actor_after_blitzy"] = (
            engineering_actor(blitzy_pr, "after") == BLITZY_ACTOR_LABEL
        )
    except Exception as exc:
        results["errors"].append(f"engineering_actor: {exc}")
        results["checks"]["engineering_actor_baseline"] = False

    results["all_passed"] = all(results["checks"].values()) and not results["errors"]
    return results


if __name__ == "__main__":
    # Execute the self-test and print the summary to stdout. No print()
    # statements are used in normal module operation; this final block
    # is the only stdout writer in the module and only fires when the
    # module is run directly.
    summary = _self_test()
    sys.stdout.write(json.dumps(summary, indent=2, default=str) + "\n")
    sys.exit(0 if summary.get("all_passed") else 1)

