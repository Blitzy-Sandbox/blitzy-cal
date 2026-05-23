#!/usr/bin/env python3
"""_shared.py — Foundational helpers for the Development Acceleration Measurement harness.

Imported by every other script under scripts/. Provides:
  - engineering_actor() — single phase-branching selector for actor identity
    (AAP §0.1.3, decision-log.md Row 12). The ONLY place actor identity branches.
  - GitHub REST API client (urllib.request-based, SHA256-keyed cache, honors
    HTTP 429 Retry-After header).
  - Linear GraphQL API client (optional, gated on LINEAR_API_KEY).
  - Read-only-allowlisted Git wrappers (git_run, git_log) with commands.log
    appending for the Reproducibility Appendix (Rule 5).
  - Structured JSON logger with run_id correlation (Observability rule).
  - Monday-aligned 2-week window arithmetic helpers.
  - Atomic JSON I/O via temp-file + Path.replace() (save_json).
  - Centralized write-boundary enforcement (ensure_report_path).
  - Constants: bot logins, subjective tokens, deliverable paths.

All operations are READ-ONLY on the analyzed repository (User Boundary 1).
Python 3.10+ stdlib only — no third-party packages.
No fabrication: helpers return None or raise; never invent values (Boundary 2).
No secrets logged: GITHUB_TOKEN, LINEAR_API_KEY, BLITZY_TOKEN are
defensively redacted from commands.log.

References: decision-log.md Rows 12, 13, 17; acceleration-report.md §Methodology.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterable


# ---------------------------------------------------------------------------
# Section 1 — Path Constants (deliverable root and subdirectories)
# ---------------------------------------------------------------------------

SCRIPT_DIR: Path = Path(__file__).resolve().parent
"""Absolute path to blitzy/reports/acceleration/scripts/."""

REPORT_ROOT: Path = SCRIPT_DIR.parent
"""Absolute path to blitzy/reports/acceleration/ (deliverable root).
Every write performed by the harness must resolve under this directory
per AAP §0.3.1; enforced by ensure_report_path()."""

DATA_DIR: Path = REPORT_ROOT / "data"
LOGS_DIR: Path = REPORT_ROOT / "logs"
CACHE_DIR: Path = DATA_DIR / "cache"

ACCELERATION_REPORT_PATH: Path = REPORT_ROOT / "acceleration-report.md"
EXECUTIVE_PRESENTATION_PATH: Path = REPORT_ROOT / "executive-presentation.html"
DASHBOARD_PATH: Path = REPORT_ROOT / "dashboard.md"
DECISION_LOG_PATH: Path = REPORT_ROOT / "decision-log.md"
README_PATH: Path = REPORT_ROOT / "README.md"


# ---------------------------------------------------------------------------
# Section 2 — Repository Identity and Blitzy Agent Identifiers
# ---------------------------------------------------------------------------

REPO_OWNER: str = os.environ.get("BLITZY_REPO_OWNER", "Blitzy-Sandbox").strip() or "Blitzy-Sandbox"
REPO_NAME: str = os.environ.get("BLITZY_REPO_NAME", "blitzy-cal").strip() or "blitzy-cal"

BLITZY_AUTHOR_EMAIL: str = "agent@blitzy.com"
"""Canonical email of Blitzy Agent commits. Detection signal for is_blitzy_actor()."""

BLITZY_ACTOR_LABEL: str = "blitzy-agent"
"""Canonical actor label for Blitzy in per-actor aggregations (Metrics 2/4/5/6/10)."""

BLITZY_AUTHOR_NAMES: tuple[str, ...] = (
    "Blitzy Agent", "Blitzy", "blitzy-agent", "blitzy-bot", "Blitzy-Agent", "blitzy",
)


# ---------------------------------------------------------------------------
# Section 3 — Bot Exclusion List (M1, M2)
# ---------------------------------------------------------------------------
#
# Dependency-management / infrastructure bots excluded from Flow Load and Flow
# Velocity counts per AAP §0.1.1. Derived from .kodiak.toml::auto_approve_usernames
# plus well-known JS-ecosystem bots. Bracket variants ([bot] suffix) included
# because GitHub renders the same logical account both ways.
#
# Blitzy Agent is DELIBERATELY ABSENT — it is the engineering actor for the
# after period, not a bot (decision-log.md Row 11).

BOT_LOGINS: frozenset[str] = frozenset({
    "dependabot", "dependabot[bot]", "dependabot-preview", "dependabot-preview[bot]",
    "github-actions", "github-actions[bot]",
    "renovate", "renovate[bot]", "renovate-bot",
    "kodiak", "kodiakhq", "kodiakhq[bot]",
    "snyk-bot", "snyk-bot[bot]",
    "imgbot", "imgbot[bot]",
    "allcontributors", "allcontributors[bot]",
    "codecov", "codecov[bot]",
    "gitguardian-bot", "gitguardian-bot[bot]",
})


# ---------------------------------------------------------------------------
# Section 4 — Subjective Token Blocklist (Rule 2 — Factual-Neutral Tone)
# ---------------------------------------------------------------------------
#
# Canonical authority for the grep pass in build_report.py. Any token here
# appearing in the report body (case-insensitively, as a whole word) fails the
# build. Intentionally broad: the rule's intent is factual-neutral tone, not
# minimal compliance. The five user-cited tokens (verbatim from AAP §0.7.2
# Rule 2) are the first five entries.

SUBJECTIVE_TOKENS: frozenset[str] = frozenset({
    "impressive", "significant", "excellent", "remarkable", "unfortunately",
    "notable", "striking", "dramatic", "surprising", "astonishing",
    "tremendous", "outstanding", "extraordinary", "marvelous", "marvellous",
    "staggering", "incredible", "phenomenal", "spectacular", "fascinating",
    "compelling", "noteworthy", "powerful", "robust", "elegant", "seamless",
    "transformative", "groundbreaking", "revolutionary", "innovative",
    "world-class", "best-in-class", "cutting-edge", "game-changing",
    "amazing", "awesome", "fantastic", "superb",
    "excellently", "remarkably", "significantly", "impressively", "notably",
    "strikingly", "dramatically", "surprisingly",
    "fortunately", "regrettably", "sadly", "happily",
})


# ---------------------------------------------------------------------------
# Section 5 — HTTP Constants
# ---------------------------------------------------------------------------

GITHUB_API_BASE: str = "https://api.github.com"
GITHUB_API_VERSION: str = "2022-11-28"
HTTP_TIMEOUT: int = 60
RATE_LIMIT_BACKOFF_SECONDS: int = 60
"""Default backoff in seconds when GitHub returns HTTP 429 and no valid
Retry-After header is present. github_api_get() consults the response's
Retry-After header first and falls back to this constant only when the
header is missing or unparseable."""
LINEAR_API_BASE: str = "https://api.linear.app/graphql"

WINDOW_DAYS_DEFAULT: int = 14
"""Authoritative default window length in days (AAP §0.1.3 2-week windows)."""


# ---------------------------------------------------------------------------
# Section 6 — Git Read-Only Allowlist (security enforcement)
# ---------------------------------------------------------------------------
#
# git_run() enforces this allowlist on its first positional argument to
# guarantee that the analyzed repository is never mutated via the harness
# (AAP §0.7.3 Boundary 1, security checklist read-only enforcement).
# Any subcommand not in this set raises ValueError before subprocess
# execution. Adding a new read-only subcommand requires updating this set
# and documenting the addition in decision-log.md.

GIT_READONLY_SUBCOMMANDS: frozenset[str] = frozenset({
    "log", "show", "rev-list", "rev-parse", "tag", "merge-base", "blame",
    "diff", "branch", "remote", "submodule", "config", "--version",
    "describe", "cat-file", "ls-tree", "ls-files", "for-each-ref",
    "name-rev", "shortlog", "status", "show-ref", "var", "help",
})


# ---------------------------------------------------------------------------
# Section 7 — Write-Boundary Enforcement (ensure_report_path)
# ---------------------------------------------------------------------------


def ensure_report_path(path: Path | str,
                       must_be_under: Path | None = None,
                       allow_create_parent: bool = True) -> Path:
    """Resolve a path and confirm it falls under REPORT_ROOT (or must_be_under).

    Centralizes the write-boundary check used by every CLI in scripts/ to
    enforce AAP §0.3.1: "All writes target /blitzy/reports/acceleration/
    only." Rejects external absolute paths and `..` traversal escapes.

    Args:
        path: Filesystem path supplied by the caller (typically from --output,
            --data-dir, or another CLI argument). May be str or Path.
        must_be_under: Optional explicit root that the path must descend from.
            Defaults to REPORT_ROOT when None.
        allow_create_parent: When True, the parent directory of the resolved
            path is created (mkdir parents=True, exist_ok=True). When False,
            no directory creation is performed.

    Returns:
        The resolved absolute path. The caller can safely use this for
        subsequent read/write operations.

    Raises:
        ValueError: If the resolved path escapes the allowed root via `..`
            traversal or absolute paths pointing elsewhere.
        OSError: If parent directory creation fails (only when
            allow_create_parent=True).
    """
    root = (must_be_under or REPORT_ROOT).resolve()
    resolved = Path(path).expanduser().resolve()
    # Path.is_relative_to is 3.9+; we support 3.10+.
    try:
        resolved.relative_to(root)
    except ValueError as exc:
        raise ValueError(
            f"Refusing write outside report directory: {resolved} not under {root}"
        ) from exc
    if allow_create_parent:
        resolved.parent.mkdir(parents=True, exist_ok=True)
    return resolved


# ---------------------------------------------------------------------------
# Section 8 — Run ID Resolution
# ---------------------------------------------------------------------------

_RUN_ID_CACHE: str | None = None


def get_or_create_run_id() -> str:
    """Resolve and cache the run_id for this harness invocation.

    Resolution order: process cache → BLITZY_RUN_ID env var → fresh UUIDv4.
    The per-run log directory logs/<run_id>/ is eagerly created so handlers
    can attach without race conditions.
    """
    global _RUN_ID_CACHE
    if _RUN_ID_CACHE is not None:
        return _RUN_ID_CACHE
    env_run_id = os.environ.get("BLITZY_RUN_ID", "").strip()
    _RUN_ID_CACHE = env_run_id if env_run_id else str(uuid.uuid4())
    (LOGS_DIR / _RUN_ID_CACHE).mkdir(parents=True, exist_ok=True)
    return _RUN_ID_CACHE


# ---------------------------------------------------------------------------
# Section 9 — Structured JSON Logger (Observability rule)
# ---------------------------------------------------------------------------
#
# Schema per log record:
#   {ts, level, run_id, metric, phase, message, context?, exception?}
# Destinations: file logs/<run_id>/<phase>.log (DEBUG+) and stderr (INFO+).


class _StructuredJSONFormatter(logging.Formatter):
    """Format LogRecord as single-line JSON for observability."""

    def __init__(self, run_id: str) -> None:
        super().__init__()
        self.run_id = run_id

    def format(self, record: logging.LogRecord) -> str:
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


# Matches the "M<digits>" metric identifier convention used across the
# extraction harness (M1..M12 in this codebase). Used by
# ``_structured_logger_file_basename`` to route metric-scoped logger lines
# to per-metric log files per AAP §0.6.2.
_METRIC_ID_RE = re.compile(r"^M(\d+)$")


def _structured_logger_file_basename(metric_id: str | None, phase: str) -> str:
    """Resolve the on-disk log filename stem for ``structured_logger``.

    AAP §0.6.2 mandates per-metric log files
    (``logs/<run_id>/metric_<N>.log`` for N=1..12). This helper enforces
    that contract:

      * When ``metric_id`` matches the canonical ``M<digits>`` convention
        (e.g., ``"M1"``..``"M12"``), the basename is ``metric_<N>``.
      * Otherwise — including when ``metric_id`` is ``None`` — the
        basename falls back to ``phase`` unchanged so lines emitted by
        non-metric pipeline stages (``verify_environment``,
        ``derive_inflection``, ``generate_windows``,
        ``validate_consistency``, ``harness``, ``github_api``,
        ``linear_api``) continue to land in their pipeline-stage log
        files.

    Args:
        metric_id: The metric identifier in canonical ``"M<N>"`` form when
            the logger is metric-scoped, otherwise ``None``.
        phase: The pipeline-stage identifier used as the fallback
            basename when ``metric_id`` is absent or does not match the
            canonical convention.

    Returns:
        The filename stem (without the ``.log`` extension) for the
        per-run log file the returned logger writes to.
    """
    if metric_id:
        match = _METRIC_ID_RE.match(metric_id)
        if match:
            return f"metric_{match.group(1)}"
    return phase


class _MetricContextAdapter(logging.LoggerAdapter):
    """LoggerAdapter that injects _metric_id and _phase into every record."""

    def __init__(self, logger: logging.Logger, metric_id: str | None, phase: str) -> None:
        super().__init__(logger, {})
        self._metric_id = metric_id
        self._phase = phase

    def process(self, msg: Any, kwargs: dict[str, Any]) -> tuple[Any, dict[str, Any]]:
        extra = kwargs.setdefault("extra", {})
        extra["_metric_id"] = self._metric_id
        extra["_phase"] = self._phase
        return msg, kwargs


def structured_logger(metric_id: str | None = None, phase: str = "harness") -> logging.Logger:
    """Return a cached logger emitting JSON records to a per-run log file.

    Log file naming follows AAP §0.6.2:

      * When ``metric_id`` matches the ``M<digits>`` convention
        (e.g., ``"M1"``..``"M12"``), the destination is
        ``logs/<run_id>/metric_<N>.log`` — exactly one file per metric.
      * Otherwise the destination is ``logs/<run_id>/<phase>.log`` so
        lines emitted by non-metric pipeline stages remain co-located
        in their pipeline-stage logs (verify_environment.log,
        derive_inflection.log, generate_windows.log, extract_metrics.log
        for harness-level orchestration lines, validate_consistency.log,
        github_api.log, linear_api.log, harness.log).

    INFO and above are mirrored to stderr for interactive visibility.

    Loggers are cached by ``(file_basename, run_id)`` rather than by
    ``(phase, run_id)`` so different metrics that share the same phase
    label (``"extract_metrics"``) route their lines to distinct files
    without duplicating handlers across calls. This is required for the
    per-metric file structure mandated by the AAP — caching by phase
    alone would funnel all 12 metrics into a single
    ``extract_metrics.log`` (the defect this implementation closes).

    Args:
        metric_id: Identifier of the metric being extracted when the
            caller is metric-scoped (e.g., ``"M5"``); ``None`` for
            harness-level / pipeline-stage callers.
        phase: Pipeline-stage identifier, used as the filename fallback
            when ``metric_id`` is absent or unrecognized.

    Returns:
        A ``LoggerAdapter`` that emits JSON records carrying ``metric_id``
        and ``phase`` as structured fields.
    """
    run_id = get_or_create_run_id()
    file_basename = _structured_logger_file_basename(metric_id, phase)
    cache_key = f"{file_basename}::{run_id}"
    if cache_key in _LOGGERS:
        base_logger = _LOGGERS[cache_key]
    else:
        log_path = LOGS_DIR / run_id / f"{file_basename}.log"
        log_path.parent.mkdir(parents=True, exist_ok=True)
        base_logger = logging.getLogger(f"blitzy.acceleration.{cache_key}")
        base_logger.setLevel(logging.DEBUG)
        base_logger.propagate = False
        file_handler = logging.FileHandler(log_path, encoding="utf-8")
        file_handler.setFormatter(_StructuredJSONFormatter(run_id))
        file_handler.setLevel(logging.DEBUG)
        base_logger.addHandler(file_handler)
        stderr_handler = logging.StreamHandler(sys.stderr)
        stderr_handler.setFormatter(_StructuredJSONFormatter(run_id))
        stderr_handler.setLevel(logging.INFO)
        base_logger.addHandler(stderr_handler)
        _LOGGERS[cache_key] = base_logger
    return _MetricContextAdapter(base_logger, metric_id, phase)


# ---------------------------------------------------------------------------
# Section 10 — commands.log Append (Reproducibility rule)
# ---------------------------------------------------------------------------


def command_log_append(command_type: str, command_string: str) -> None:
    """Append one line to logs/<run_id>/commands.log for the Reproducibility Appendix.

    Defensively redacts token env-var values from the command string before
    writing. Fire-and-forget: failures here do not abort metric extraction.

    Format: "<ISO ts> <command_type> <command_string>\\n"
    """
    run_id = get_or_create_run_id()
    path = LOGS_DIR / run_id / "commands.log"
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
    except OSError:
        return
    ts = datetime.now(timezone.utc).isoformat()
    redacted = command_string
    for env_key in ("GITHUB_TOKEN", "LINEAR_API_KEY", "BLITZY_TOKEN", "BLITZY_GITHUB_TOKEN"):
        val = os.environ.get(env_key, "")
        if val and len(val) >= 8 and val in redacted:
            redacted = redacted.replace(val, f"<{env_key}_REDACTED>")
    try:
        with path.open("a", encoding="utf-8") as fh:
            fh.write(f"{ts} {command_type} {redacted}\n")
    except OSError:
        return


# ---------------------------------------------------------------------------
# Section 11 — Engineering Actor Selector (decision-log.md Row 12)
# ---------------------------------------------------------------------------
#
# This module's ONLY phase-branching selector for actor identity. Every
# per-actor aggregation in extract_metrics.py routes through this function
# so the identical-methodology guarantee (AAP §0.7.3) is structurally
# inevitable. There is no other branch-on-phase anywhere in the codebase.


def engineering_actor(pr: dict, phase: str) -> str:
    """Return the actor identifier for a PR under a given phase.

    Baseline phase always returns the human author login. Any other phase
    (after, ramp_up, steady_state, post_intro) returns BLITZY_ACTOR_LABEL
    when the PR was authored by Blitzy Agent and the human author login
    otherwise. The PR's author is detected via is_blitzy_authored_pr()
    which consults title, body, branch name, and commit metadata.
    """
    user = pr.get("user") or {}
    human_login = user.get("login") or "unknown"
    if phase == "baseline":
        return human_login
    if is_blitzy_actor(human_login) or is_blitzy_authored_pr(pr):
        return BLITZY_ACTOR_LABEL
    return human_login


def is_blitzy_actor(login_or_email: str) -> bool:
    """Return True if the login/email identifies Blitzy Agent.

    Matches against BLITZY_AUTHOR_EMAIL, BLITZY_ACTOR_LABEL,
    BLITZY_AUTHOR_NAMES (case-insensitive exact match), and the substring
    patterns "blitzy" + "bot" or "blitzy-agent".
    """
    if not login_or_email:
        return False
    s = login_or_email.lower().strip()
    if not s:
        return False
    if s == BLITZY_AUTHOR_EMAIL.lower() or s == BLITZY_ACTOR_LABEL.lower():
        return True
    if any(s == name.lower() for name in BLITZY_AUTHOR_NAMES):
        return True
    if ("blitzy" in s and "bot" in s) or "blitzy-agent" in s:
        return True
    return False


def is_blitzy_authored_pr(pr: dict) -> bool:
    """Return True if any Blitzy authorship signal is present on the PR.

    Signals (any one suffices): [Blitzy] title marker, BLITZY_AUTHOR_EMAIL
    in body, "Co-authored-by:" + "blitzy" in body, head branch starts with
    "blitzy-"/"blitzy/", or any commit in commits_data has Blitzy as
    author/committer email or name.
    """
    title = (pr.get("title") or "").lower()
    body = (pr.get("body") or "").lower()
    branch = ((pr.get("head") or {}).get("ref") or "").lower()
    if "[blitzy]" in title or "[blitzy" in title:
        return True
    if BLITZY_AUTHOR_EMAIL.lower() in body:
        return True
    if "co-authored-by:" in body and "blitzy" in body:
        return True
    if branch.startswith("blitzy-") or branch.startswith("blitzy/"):
        return True
    commits = pr.get("commits_data") or pr.get("_commits_data") or []
    for c in commits:
        commit_obj = c.get("commit") or {}
        author = commit_obj.get("author") or {}
        email = (author.get("email") or "").lower()
        if email == BLITZY_AUTHOR_EMAIL.lower() or is_blitzy_actor(email):
            return True
        name = (author.get("name") or "").lower()
        if "blitzy" in name and ("agent" in name or "bot" in name):
            return True
        committer = commit_obj.get("committer") or {}
        if (committer.get("email") or "").lower() == BLITZY_AUTHOR_EMAIL.lower():
            return True
    return False


# ---------------------------------------------------------------------------
# Section 12 — Git Subprocess Wrappers (read-only allowlist enforced)
# ---------------------------------------------------------------------------


def git_run(args: list[str] | tuple[str, ...] | Iterable[str],
            repo_root: str | Path = ".",
            allow_failure: bool = False,
            timeout: int = 120) -> str:
    """Run a git command and return its stdout as a UTF-8 string.

    The first positional argument MUST be in GIT_READONLY_SUBCOMMANDS;
    mutating subcommands (commit, push, tag <new>, rebase, etc.) raise
    ValueError before subprocess execution, enforcing the AAP §0.7.3
    read-only constraint.

    Args:
        args: argv tail for git. The git binary is prepended automatically.
        repo_root: working directory for the subprocess.
        allow_failure: when True, returns "" on non-zero exit instead of raising.
        timeout: subprocess timeout in seconds.

    Returns:
        Decoded stdout (utf-8, errors=replace).

    Raises:
        ValueError: subcommand not in GIT_READONLY_SUBCOMMANDS.
        subprocess.CalledProcessError: non-zero exit and allow_failure=False.
        subprocess.TimeoutExpired: subprocess exceeded timeout.
        FileNotFoundError: git not installed / not on PATH.
    """
    args_list = list(args)
    if not args_list:
        raise ValueError("git_run requires at least one argument")
    head = args_list[0]
    if head not in GIT_READONLY_SUBCOMMANDS:
        raise ValueError(
            f"git_run blocked: {head!r} is not in the read-only allowlist "
            f"({sorted(GIT_READONLY_SUBCOMMANDS)}). The analyzed repository "
            "is read-only per AAP §0.7.3."
        )
    cmd = ["git"] + args_list
    command_log_append("git", " ".join(cmd))
    try:
        result = subprocess.run(
            cmd, cwd=str(repo_root), check=not allow_failure,
            capture_output=True, timeout=timeout,
        )
    except subprocess.CalledProcessError:
        if allow_failure:
            return ""
        raise
    return result.stdout.decode("utf-8", errors="replace")


def git_log(args: list[str] | tuple[str, ...] | Iterable[str],
            repo_root: str | Path = ".",
            allow_failure: bool = False) -> str:
    """Convenience wrapper: equivalent to git_run(["log"] + args, ...)."""
    return git_run(["log"] + list(args), repo_root=repo_root, allow_failure=allow_failure)


def git_is_ancestor(ancestor_sha: str, descendant_sha: str,
                    repo_root: str | Path = ".",
                    timeout: int = 30) -> bool:
    """Return True if ``ancestor_sha`` is an ancestor of ``descendant_sha``.

    Wraps ``git merge-base --is-ancestor <ancestor> <descendant>`` while
    enforcing the same read-only allowlist, command logging, and timeout
    conventions as :func:`git_run`. The git command exits 0 when the
    ancestor relationship holds, 1 when it does not, and a different
    non-zero code on actual error; this helper distinguishes the three
    cases and returns False (not raise) for both "not an ancestor" and
    "argument not found in repo" so callers can treat absence symmetrically.

    This is the supported entry point for M8 (Problem Records) revert
    attribution and any other read-only ancestry check; M8 must NOT call
    ``subprocess.run`` directly with ``git merge-base --is-ancestor`` since
    that bypasses the read-only allowlist contract and the command log.

    Args:
        ancestor_sha: The candidate ancestor commit SHA (or tag/ref).
        descendant_sha: The descendant commit SHA (or tag/ref).
        repo_root: Working directory for the subprocess.
        timeout: Subprocess timeout in seconds.

    Returns:
        True when the ancestry relationship holds; False on exit code 1
        ("not an ancestor"), on timeout, or on missing/invalid refs.

    Raises:
        ValueError: ``merge-base`` is unexpectedly removed from the
            allowlist (defensive invariant for future maintainers).
        FileNotFoundError: git not installed / not on PATH.
    """
    # Defensive: merge-base MUST be in the allowlist for this helper to
    # function. Failing loudly on accidental removal preserves the
    # security guarantee that all git invocations are read-only-checked.
    if "merge-base" not in GIT_READONLY_SUBCOMMANDS:
        raise ValueError(
            "git_is_ancestor requires 'merge-base' in the read-only allowlist"
        )
    cmd = ["git", "merge-base", "--is-ancestor", ancestor_sha, descendant_sha]
    command_log_append("git", " ".join(cmd))
    try:
        result = subprocess.run(
            cmd, cwd=str(repo_root), check=False,
            capture_output=True, timeout=timeout,
        )
    except subprocess.TimeoutExpired:
        # Timeouts on ancestry checks indicate a problem with the
        # repository state; treat them symmetrically with "not an
        # ancestor" so M8 can tally the revert as unreleased and the
        # run continues without crashing.
        return False
    except FileNotFoundError:
        # git binary missing — propagate so the harness fails loudly
        # rather than silently mis-reporting every ancestry check.
        raise
    return result.returncode == 0


# ---------------------------------------------------------------------------
# Section 13 — GitHub REST API Client (cache-by-default, Retry-After aware)
# ---------------------------------------------------------------------------


def _cache_key(url: str, headers: dict[str, str]) -> str:
    """SHA256 of URL + sorted non-Authorization headers. Authorization is
    excluded so different tokens hit the same cache entries for identical
    requests."""
    filtered = {k: v for k, v in sorted(headers.items()) if k.lower() != "authorization"}
    payload = url + "\n" + json.dumps(filtered, sort_keys=True)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _build_github_headers() -> dict[str, str]:
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
    """Parse a GitHub Link header and return the rel="next" URL or None."""
    if not link_header:
        return None
    for part in link_header.split(","):
        if 'rel="next"' in part:
            start = part.find("<")
            end = part.find(">")
            if start >= 0 and end > start:
                return part[start + 1:end].strip()
    return None


def _resolve_retry_after(exc: urllib.error.HTTPError, fallback: int) -> int:
    """Return the integer seconds to sleep on HTTP 429.

    Honors the Retry-After response header when present and valid; falls
    back to ``fallback`` otherwise. Negative values, NaN, and non-numeric
    strings are treated as missing.
    """
    try:
        raw = exc.headers.get("Retry-After") if exc.headers else None
    except AttributeError:
        raw = None
    if not raw:
        return fallback
    try:
        secs = int(str(raw).strip())
    except (TypeError, ValueError):
        return fallback
    if secs < 0:
        return fallback
    return secs


def github_api_get(endpoint: str,
                   params: dict | None = None,
                   use_cache: bool = True,
                   paginate: bool = False) -> Any:
    """GET against the GitHub REST API with cache, pagination, and 429 backoff.

    Endpoint resolution:
      - Starts with "http"  → used as-is (typically the next-page URL).
      - Starts with "/"     → appended to GITHUB_API_BASE.
      - Otherwise           → prefixed with /repos/{REPO_OWNER}/{REPO_NAME}/.

    HTTP 429 sleeps for Retry-After seconds (when valid) or
    RATE_LIMIT_BACKOFF_SECONDS otherwise, then retries the same URL.
    HTTP 404 returns [] for plural endpoints (heuristic: trailing "s") or None.
    HTTP 401/403 and other errors return None with a logged error.
    """
    logger = structured_logger(phase="github_api")

    # HTTPS-only enforcement: reject http:// absolute URLs to prevent
    # accidental downgrade of GitHub API traffic to cleartext. This is
    # a defense-in-depth measure — the GITHUB_API_BASE is https:// so
    # relative endpoints are always safe, but absolute URLs (typically
    # next-page Link headers) MUST also be https://.
    if endpoint.startswith("http://"):
        logger.error(
            f"Rejected insecure HTTP endpoint: {endpoint!r}",
            extra={"context": {"endpoint": endpoint}},
        )
        raise ValueError(
            f"github_api_get rejects insecure HTTP endpoints: {endpoint!r}. "
            "All GitHub API calls must use HTTPS."
        )
    if endpoint.startswith("https://"):
        url = endpoint
    elif endpoint.startswith("/"):
        url = GITHUB_API_BASE + endpoint
    else:
        url = f"{GITHUB_API_BASE}/repos/{REPO_OWNER}/{REPO_NAME}/{endpoint}"

    if params:
        qs = urllib.parse.urlencode(params, doseq=True)
        url = f"{url}{'&' if '?' in url else '?'}{qs}"

    headers = _build_github_headers()
    cache_path = CACHE_DIR / f"{_cache_key(url, headers)}.json"

    if use_cache and cache_path.is_file():
        logger.debug(f"Cache HIT: {url}",
                     extra={"context": {"url": url, "cache_path": str(cache_path)}})
        try:
            return json.loads(cache_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError) as exc:
            logger.warning(f"Cache read failed for {cache_path}; refetching",
                           extra={"context": {"error": str(exc)}})

    all_results: list = []
    next_url: str | None = url

    while next_url:
        command_log_append("http", f"GET {next_url}")
        try:
            req = urllib.request.Request(next_url, headers=headers, method="GET")
            with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT) as response:
                body = response.read().decode("utf-8", errors="replace")
                data = json.loads(body)
                link_header = response.getheader("Link", "")
        except urllib.error.HTTPError as exc:
            if exc.code == 404:
                logger.info(f"404 from {next_url}; returning empty result",
                            extra={"context": {"url": next_url}})
                if paginate:
                    break
                return [] if endpoint.rstrip("/").endswith("s") else None
            if exc.code in (401, 403):
                logger.error(f"Auth failure ({exc.code}) for {next_url}",
                             extra={"context": {"url": next_url, "code": exc.code}})
                if paginate:
                    break
                return None
            if exc.code == 429:
                wait = _resolve_retry_after(exc, RATE_LIMIT_BACKOFF_SECONDS)
                logger.warning(
                    f"Rate limit hit at {next_url}; sleeping {wait}s "
                    f"({'Retry-After header' if wait != RATE_LIMIT_BACKOFF_SECONDS or exc.headers.get('Retry-After') else 'default backoff'})",
                    extra={"context": {"url": next_url, "wait_seconds": wait,
                                       "retry_after_header": exc.headers.get("Retry-After") if exc.headers else None}},
                )
                time.sleep(wait)
                continue
            logger.error(f"HTTP error {exc.code} for {next_url}: {exc}",
                         extra={"context": {"code": exc.code, "url": next_url}})
            if paginate:
                break
            return None
        except (urllib.error.URLError, TimeoutError, ConnectionError) as exc:
            logger.error(f"Network error fetching {next_url}: {exc}",
                         extra={"context": {"url": next_url, "error": str(exc)}})
            if paginate:
                break
            return None
        except json.JSONDecodeError as exc:
            logger.error(f"JSON decode failure for {next_url}: {exc}",
                         extra={"context": {"url": next_url, "error": str(exc)}})
            if paginate:
                break
            return None

        if paginate and isinstance(data, list):
            all_results.extend(data)
            next_url = _parse_next_link(link_header)
        else:
            if paginate and not isinstance(data, list):
                logger.warning(f"paginate=True but response is not a list at {url}",
                               extra={"context": {"url": url, "type": type(data).__name__}})
            _write_cache_atomic(cache_path, data, logger)
            return data

    if paginate:
        _write_cache_atomic(cache_path, all_results, logger)
        return all_results
    return None


def _write_cache_atomic(cache_path: Path, data: Any, logger: logging.Logger) -> None:
    """Best-effort atomic cache write. Failures are logged and ignored."""
    try:
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        save_json(cache_path, data)
    except OSError as exc:
        logger.warning(f"Cache write failed for {cache_path}: {exc}",
                       extra={"context": {"cache_path": str(cache_path), "error": str(exc)}})


# ---------------------------------------------------------------------------
# Section 14 — Linear API Client (optional, GraphQL POST)
# ---------------------------------------------------------------------------


def linear_api_get(query: str, variables: dict | None = None) -> Any:
    """Execute a GraphQL query against the Linear API.

    Returns the parsed JSON response when LINEAR_API_KEY is set and the
    request succeeds; returns None when the key is absent, on HTTP error,
    on network error, or on JSON decode failure. The URL only (not the
    query body) is recorded in commands.log to avoid leaking filter contents.
    """
    logger = structured_logger(phase="linear_api")
    token = os.environ.get("LINEAR_API_KEY", "").strip()
    if not token:
        logger.info("LINEAR_API_KEY not set; skipping Linear API query",
                    extra={"context": {"query_length": len(query)}})
        command_log_append("http", "POST https://api.linear.app/graphql (SKIPPED — no API key)")
        return None
    headers = {
        "Authorization": token,
        "Content-Type": "application/json",
        "User-Agent": "blitzy-acceleration-harness/1.0",
    }
    payload = json.dumps({"query": query, "variables": variables or {}}).encode("utf-8")
    command_log_append("http", f"POST {LINEAR_API_BASE} (GraphQL)")
    try:
        req = urllib.request.Request(LINEAR_API_BASE, data=payload, headers=headers, method="POST")
        with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT) as response:
            return json.loads(response.read().decode("utf-8", errors="replace"))
    except urllib.error.HTTPError as exc:
        logger.error(f"Linear API HTTP error {exc.code}: {exc}",
                     extra={"context": {"code": exc.code}})
        return None
    except (urllib.error.URLError, TimeoutError, ConnectionError) as exc:
        logger.error(f"Linear API network error: {exc}",
                     extra={"context": {"error": str(exc)}})
        return None
    except json.JSONDecodeError as exc:
        logger.error(f"Linear API JSON decode failure: {exc}",
                     extra={"context": {"error": str(exc)}})
        return None


# ---------------------------------------------------------------------------
# Section 15 — JSON I/O Helpers (atomic save via temp-file + Path.replace)
# ---------------------------------------------------------------------------


def load_json(path: Path | str) -> Any:
    """Load and parse a JSON file. Raises FileNotFoundError if missing."""
    path = Path(path)
    command_log_append("read", str(path))
    if not path.is_file():
        raise FileNotFoundError(f"JSON file not found: {path}")
    return json.loads(path.read_text(encoding="utf-8"))


def save_json(path: Path | str, data: Any, indent: int = 2) -> None:
    """Serialize data to a JSON file atomically.

    Writes to a temp file in the destination's parent directory, fsyncs,
    then replaces the destination via Path.replace() (atomic on POSIX and
    Windows). Interrupted writes leave the previous file intact rather than
    a partial file that downstream load_json() would fail to parse.

    Side effects: creates path.parent if missing; appends "write" to
    commands.log AFTER the atomic replace succeeds.
    """
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(data, indent=indent, default=str, ensure_ascii=False)
    # NamedTemporaryFile with delete=False so we can rename it after closing.
    # dir=path.parent ensures the temp file is on the same filesystem as the
    # destination (a precondition for atomic rename on POSIX).
    fd, tmp_name = tempfile.mkstemp(
        prefix=f".{path.name}.", suffix=".tmp", dir=str(path.parent)
    )
    tmp_path = Path(tmp_name)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(payload)
            fh.flush()
            try:
                os.fsync(fh.fileno())
            except OSError as fsync_exc:
                # fsync may fail on some FS (e.g., tmpfs); the atomic replace
                # still provides crash-consistency for most cases. Log the
                # failure at debug level so an operator who is chasing a
                # crash-consistency issue can see that fsync was skipped on
                # this filesystem, but do not crash the run.
                logging.getLogger(__name__).debug(
                    "save_json: fsync skipped (filesystem unsupported): %s",
                    fsync_exc,
                )
        tmp_path.replace(path)
    except Exception:
        # Best-effort cleanup; never propagate cleanup failures because
        # the originating exception is the actionable one for the caller.
        try:
            if tmp_path.exists():
                tmp_path.unlink()
        except OSError as cleanup_exc:
            # Surface cleanup failures in the debug stream — the temp file
            # will remain on disk until the next harness run, but the
            # caller still gets the originating exception so they can
            # diagnose the actual save failure.
            logging.getLogger(__name__).debug(
                "save_json: temp-file cleanup failed for %s: %s",
                tmp_path, cleanup_exc,
            )
        raise
    command_log_append("write", str(path))


def load_all_metrics(data_dir: Path | str = DATA_DIR) -> dict[str, dict]:
    """Load every metric_<N>.json (N=1..12) from data_dir into {"M<N>": data}.

    Raises FileNotFoundError listing ALL missing files if any are absent.
    """
    data_dir = Path(data_dir)
    metrics: dict[str, dict] = {}
    missing: list[str] = []
    for n in range(1, 13):
        p = data_dir / f"metric_{n}.json"
        if not p.is_file():
            missing.append(str(p))
            continue
        metrics[f"M{n}"] = load_json(p)
    if missing:
        raise FileNotFoundError(
            f"Missing metric files (expected 12, missing {len(missing)}): "
            + ", ".join(missing)
        )
    return metrics


# ---------------------------------------------------------------------------
# Section 16 — Window Arithmetic Helpers
# ---------------------------------------------------------------------------


def snap_backward_to_monday(dt: datetime) -> datetime:
    """Snap a datetime backward to the most recent Monday at 00:00:00 UTC.

    Naive datetimes are treated as UTC. Already-Monday-at-midnight inputs
    are fixed points.
    """
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    else:
        dt = dt.astimezone(timezone.utc)
    return (dt - timedelta(days=dt.weekday())).replace(
        hour=0, minute=0, second=0, microsecond=0
    )


def monday_aligned_windows(start: datetime, end: datetime, inflection: datetime,
                           window_days: int = WINDOW_DAYS_DEFAULT) -> list[dict]:
    """Generate Monday-aligned windows spanning [start, end].

    Each window dict has window_id, start_iso, end_iso, phase (baseline/after
    by majority of days), and days_post_inflection. This is the AD-HOC helper;
    generate_windows.py produces the CANONICAL windows.json.
    """
    aligned_start = snap_backward_to_monday(start)
    aligned_end = snap_backward_to_monday(end + timedelta(days=window_days))
    aligned_inflection = snap_backward_to_monday(inflection)

    windows: list[dict] = []
    current = aligned_start
    idx = 0
    while current < aligned_end:
        window_end = current + timedelta(days=window_days)
        if window_end <= aligned_inflection:
            days_post = 0
        elif current >= aligned_inflection:
            days_post = window_days
        else:
            days_post = (window_end - aligned_inflection).days
        days_post = max(0, min(days_post, window_days))
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
# Section 17 — Utility Helpers
# ---------------------------------------------------------------------------


def iso_now_utc() -> str:
    """Current UTC time as an ISO 8601 string with microseconds."""
    return datetime.now(timezone.utc).isoformat()


def safe_get(d: Any, *keys: Any, default: Any = None) -> Any:
    """Safely traverse a nested dict/list and return default on any failure."""
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
    return cur if cur is not None else default


# ---------------------------------------------------------------------------
# Section 17b — Cross-Surface Formatting Policy (Rule 4 — Internal Consistency)
# ---------------------------------------------------------------------------
# The shared formatters below are the SINGLE canonical implementation used by
# both ``build_report.py`` (Markdown surfaces: acceleration-report.md and
# dashboard.md) and ``build_presentation.py`` (HTML surface:
# executive-presentation.html). Any metric value that needs cross-surface
# rendering MUST flow through one of these helpers so the same input value
# produces byte-identical output in every surface.
#
# Review Finding 2 (MAJOR — Rule 4 / Cross-Surface Consistency) called out
# that ``format_duration_seconds`` was previously implemented only in the
# deck renderer, so a metric with ``unit == "seconds"`` rendered as
# human-readable in the deck (``4.5d``) but as a raw second count in the
# Markdown report (``386675``). The fix is to colocate the formatter here
# and require both renderers to call it. Renderer-local formatters that
# wrap this helper are permitted (e.g., to add HTML escaping in the deck)
# but they MUST delegate the numeric → string conversion to
# ``format_duration_seconds`` so the human-readable scaling is identical
# across surfaces.
#
# Adding new shared formatters: when a new metric introduces a new unit
# (e.g., bytes, kilobytes), add the canonical formatter here, document
# the cross-surface contract in this section's header comment, and
# import it from both renderers. NEVER duplicate a value-formatting
# routine across the two renderers — that path created Finding 2.


def format_duration_seconds(value: Any) -> str:
    """Convert a raw second count to a human-readable duration string.

    Canonical cross-surface formatter for durations measured in seconds
    (M4 Flow Active, M7 Flow Time). The output is identical for the
    Markdown report and the HTML deck, satisfying AAP §0.7.2 Rule 4
    (Internal Consistency).

    Insufficient signal handling is left to the caller because the
    metric's ``status`` field is checked at the substitution layer; this
    helper assumes ``value`` is either ``None`` or a numeric duration
    in seconds. Renderer-local helpers SHOULD wrap this function rather
    than re-implement the scaling logic.

    Args:
        value: A duration in seconds. May be ``None`` (returns "N/A"),
            ``int``, ``float``, ``bool`` (returns "N/A"), a string, or
            ``NaN`` (returns "N/A"). Negative values are surfaced
            explicitly as a raw second count so they are visible as
            anomalies.

    Returns:
        A short human-readable string. Examples:

            None     → "N/A"
            45       → "45s"
            540      → "9.0m"
            9072     → "2.5h"
            54790    → "15.2h"
            172800   → "2.0d"
            386675   → "4.5d"

    Note:
        This helper does NOT HTML-escape its output. The deck renderer
        is responsible for HTML escaping; the Markdown renderer does
        not require it because the output contains no Markdown control
        characters that need escaping.
    """
    if value is None:
        return "N/A"
    if isinstance(value, bool):
        # bool subclasses int — guard against accidental True/False
        # arithmetic.
        return "N/A"
    if not isinstance(value, (int, float)):
        # Strings or other types are surfaced verbatim; the deck
        # renderer adds HTML escaping in its wrapper.
        return str(value)
    if value != value:  # NaN
        return "N/A"
    seconds = float(value)
    if seconds < 0:
        # Negative durations are conceptually invalid; surface
        # explicitly as a raw second count so the anomaly is visible.
        return f"{seconds:.0f}s"
    if seconds < 60:
        return f"{seconds:.0f}s"
    minutes = seconds / 60.0
    if minutes < 60:
        return f"{minutes:.1f}m"
    hours = minutes / 60.0
    # Threshold at 24 hours so multi-day PR cycles render as days. The
    # 24h boundary aligns with the deck's pre-share rendering policy
    # ("15.2h" for ~half-day spans; "4.5d" for multi-day spans).
    if hours < 24:
        return f"{hours:.1f}h"
    days = hours / 24.0
    return f"{days:.1f}d"


def is_duration_seconds_metric(metric_data: Any) -> bool:
    """Return True when the metric's ``unit`` field indicates seconds.

    Renderers use this to decide whether to route a numeric value
    through ``format_duration_seconds`` instead of the generic numeric
    formatter. The check is intentionally narrow (exact-match on the
    literal ``"seconds"``) so a future migration to ``"ms"``,
    ``"hours"``, or a structured unit object does not silently change
    behavior.

    Args:
        metric_data: A loaded metric JSON dict (one of the values from
            ``load_all_metrics``). Non-dict inputs return False.

    Returns:
        True iff ``metric_data["unit"] == "seconds"``.
    """
    if not isinstance(metric_data, dict):
        return False
    return metric_data.get("unit") == "seconds"


# ---------------------------------------------------------------------------
# Section 18 — Module Self-Test (run directly: python3 _shared.py)
# ---------------------------------------------------------------------------


def _self_test() -> dict:
    """Smoke-test critical helpers. Returns a pass/fail summary; never asserts."""
    results: dict[str, Any] = {"run_id": None, "checks": {}, "errors": []}
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
        blitzy_pr = {"user": {"login": "alice"}, "head": {"ref": "blitzy-2026-03-01"},
                     "title": "[Blitzy] task"}
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
    try:
        # git_run allowlist enforcement self-test
        try:
            git_run(["commit", "-m", "should-not-run"], allow_failure=True)
            results["checks"]["git_run_allowlist_blocks"] = False
        except ValueError:
            results["checks"]["git_run_allowlist_blocks"] = True
    except Exception as exc:
        results["errors"].append(f"git_run_allowlist: {exc}")
        results["checks"]["git_run_allowlist_blocks"] = False
    results["all_passed"] = all(results["checks"].values()) and not results["errors"]
    return results


if __name__ == "__main__":
    summary = _self_test()
    sys.stdout.write(json.dumps(summary, indent=2, default=str) + "\n")
    sys.exit(0 if summary.get("all_passed") else 1)
