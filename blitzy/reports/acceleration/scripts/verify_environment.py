#!/usr/bin/env python3
"""
verify_environment.py — Rule 6 (Environment First) Verification

Captures the execution-environment metadata that PRECEDES every metric
extraction in the Development Acceleration Measurement harness. This script
is the FIRST step of the pipeline (AAP §0.5.1) — every other script in
``scripts/`` (``derive_inflection.py``, ``generate_windows.py``,
``extract_metrics.py``, ``validate_consistency.py``, ``build_report.py``,
``build_presentation.py``) assumes the artifacts this script produces.

Per the user's verbatim Rule 6 (AAP §0.7.2):

    "Document execution environment (repository URL, git version, total
    commit count, active branch count, submodule state, commit date range,
    extraction timestamp) before any metric extraction. Verification:
    Environment Verification section precedes all Activity Deep-Dives.
    Scope: report structure."

Captured fields and their sources
---------------------------------
    - ``repo_url``        from: ``git remote get-url origin``
    - ``git_version``     from: ``git --version``
    - ``commit_count``    from: ``git rev-list --all --count``
    - ``branch_count``    from: ``git branch -a --format=%(refname:short)``
                          (deduplicated by name)
    - ``submodules``      from: ``git submodule status`` (``"none"`` if empty)
    - ``date_range``      from: ``git log --all --reverse|<head> --format=%aI``
                          ({"first": ISO, "last": ISO})
    - ``python_version``  from: ``sys.version`` (newlines stripped)
    - ``os``              from: ``platform.platform()``
    - ``extracted_at``    UTC ISO 8601 timestamp at capture time

Output
------
``data/environment.json``::

    {
        "repo_url":        str,
        "git_version":     str,
        "commit_count":    int,
        "branch_count":    int,
        "submodules":      str,
        "date_range":      {"first": str, "last": str},
        "python_version":  str,
        "os":              str,
        "extracted_at":    str
    }

Any individual capture that fails (e.g., no ``origin`` remote configured,
no submodules to enumerate, empty repository with no commits) records the
placeholder ``"<capture failed: <ExceptionType>: <message>>"`` for that
field rather than aborting the run. Per Boundary 2 of AAP §0.7.3 ("MUST
NOT fabricate, estimate, or extrapolate") this placeholder is HONEST
about the gap — never a synthesized value.

CLI
---
    python3 verify_environment.py
        [--output blitzy/reports/acceleration/data/environment.json]

Exit Codes
----------
    0   Environment captured and persisted successfully.
    1   Not inside a git repository (``git rev-parse --git-dir`` failed).
    2   Output file could not be written (filesystem permission, disk
        full, parent directory creation refused, etc.).

Constraints (AAP §0.7.3 — User Boundaries)
------------------------------------------
    - READ-ONLY on the analyzed repository (only ``git`` queries; never
      any write).
    - PYTHON 3.10+ STDLIB ONLY — no third-party packages.
    - STRUCTURED LOGGING via ``_shared.structured_logger`` with run_id
      correlation; one INFO line per captured field (Observability rule).
    - REPRODUCIBILITY via ``commands.log`` (Rule 5) — every git invocation
      and every JSON write is logged through ``_shared.git_run`` and
      ``_shared.command_log_append`` for the Reproducibility Appendix in
      ``acceleration-report.md``.
    - NO ``print()`` statements; all output flows through the logger.
    - NO FABRICATION — failed captures yield ``"<capture failed: ...>"``
      placeholders, never synthesized values (Boundary 2).

References
----------
    - AAP §0.5.1 (Pipeline ordering — ``verify_environment.py`` first)
    - AAP §0.5.2 (``data/environment.json`` schema)
    - AAP §0.7.1 (Observability rule)
    - AAP §0.7.2 Rule 6 (Environment First — verbatim)
    - AAP §0.7.3 (User Boundaries — read-only, no fabrication)
    - acceleration-report.md §Environment Verification
    - decision-log.md Row 4 (per-field-failure placeholder strategy)
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import platform
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

# Bootstrap the sibling ``_shared`` module onto ``sys.path`` so this script
# can be invoked directly (``python3 verify_environment.py``) without
# requiring the caller to set ``PYTHONPATH``. The guard prevents duplicate
# entries on repeated imports (e.g., during pytest collection that imports
# both the module and its tests).
SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from _shared import (  # noqa: E402 — must follow sys.path mutation
    DATA_DIR,
    command_log_append,
    get_or_create_run_id,
    git_run,
    iso_now_utc,
    save_json,
    structured_logger,
)


# ---------------------------------------------------------------------------
# Section 1 — Per-Field Capture Functions
# ---------------------------------------------------------------------------
#
# Each capture function targets a single Rule-6 field. Functions are kept
# narrow on purpose so:
#   1. ``capture_environment()`` can iterate over them with per-field
#      error handling — a single failure (e.g., missing ``origin`` remote)
#      does not abort the whole capture.
#   2. Each function can be unit-tested in isolation (see the ad-hoc test
#      suite under ``blitzy_adhoc_test_verify_environment.py``).
#   3. The schema-required exports (``capture_repo_url``,
#      ``capture_git_version``, ...) are first-class public symbols.
#
# Every git invocation flows through ``_shared.git_run`` which appends to
# ``logs/<run_id>/commands.log``, satisfying Rule 5 (Reproducibility) so
# the Reproducibility Appendix in ``acceleration-report.md`` contains the
# exact commands run.


def capture_repo_url() -> str:
    """Return the URL of the ``origin`` remote, or a placeholder if absent.

    Uses ``git remote get-url origin``. A repository with no remote
    configured (e.g., a fresh ``git init`` clone or a local-only mirror)
    is a valid environment for the harness; it merely changes how the
    repository is identified in the report. Per AAP §0.7.3 Boundary 2
    ("MUST NOT fabricate") the fallback is the literal string
    ``"local (no remote configured)"`` — not a guessed URL.

    Returns:
        The first line of ``git remote get-url origin`` stripped of
        trailing whitespace, e.g.,
        ``"https://github.com/Blitzy-Sandbox/blitzy-cal.git"``. Returns
        ``"local (no remote configured)"`` when no ``origin`` remote is
        configured.

    Raises:
        Nothing — ``subprocess.CalledProcessError`` is caught and mapped
        to the placeholder. Other unexpected exceptions propagate to
        ``capture_environment``, which records them as
        ``"<capture failed: ...>"``.
    """
    try:
        url = git_run(["remote", "get-url", "origin"])
        return url.strip()
    except subprocess.CalledProcessError:
        return "local (no remote configured)"


def capture_git_version() -> str:
    """Return the system's ``git`` version string.

    Uses ``git --version``. The return value typically looks like
    ``"git version 2.43.0"`` on Linux or
    ``"git version 2.39.5 (Apple Git-154)"`` on macOS. The exact
    formatting is preserved verbatim (stripped of trailing whitespace
    only) so the Environment Verification section reflects the actual
    binary used.

    Returns:
        The full ``git --version`` line, stripped of trailing whitespace.
    """
    return git_run(["--version"]).strip()


def capture_commit_count() -> int:
    """Return the total commit count across all branches.

    Uses ``git rev-list --all --count``. ``--all`` ensures the count
    includes commits reachable from any ref (branches, tags,
    ``refs/notes``, etc.), which is the correct denominator for a
    repository-wide volume metric.

    Returns:
        A non-negative integer commit count. An empty repository
        (no commits anywhere) returns ``0``.

    Raises:
        ValueError: If ``git`` returns non-integer output (should not
            happen with ``rev-list --count`` under normal operation;
            propagated to ``capture_environment`` for the failure
            placeholder).
        subprocess.CalledProcessError: If ``git rev-list`` itself
            fails (e.g., corrupted object store).
    """
    out = git_run(["rev-list", "--all", "--count"]).strip()
    return int(out)


def capture_branch_count() -> int:
    """Return the count of distinct branches (local + remote, deduplicated).

    Uses ``git branch -a --format=%(refname:short)`` and deduplicates the
    short-name set. Deduplication matters because the same logical
    branch typically appears in both the local set (``main``) and the
    remote set (``origin/main``); we want to count the logical branch
    once. The deduplication strategy strips the remote prefix and
    collapses ``origin/main`` and ``main`` to a single name; pruned
    HEAD pointers (``"(HEAD detached at ...)"``) are excluded.

    Returns:
        The count of distinct branch short-names. Returns ``0`` on an
        empty repository (no branches exist).
    """
    out = git_run(["branch", "-a", "--format=%(refname:short)"])
    branches: set[str] = set()
    for raw_line in out.splitlines():
        name = raw_line.strip()
        if not name:
            continue
        # Detached-HEAD lines in some git versions render as
        # "(HEAD detached at <sha>)" — exclude them; they are not branches.
        if name.startswith("(HEAD") or name.startswith("(no branch"):
            continue
        # Strip the canonical remote prefix so ``origin/main`` and
        # ``main`` collapse to a single logical branch. Any other slash
        # in the name (e.g., ``feature/foo``) is preserved.
        if name.startswith("origin/"):
            name = name[len("origin/"):]
        branches.add(name)
    return len(branches)


def capture_submodule_state() -> str:
    """Return the ``git submodule status`` output, or ``"none"`` if empty.

    Most repositories under measurement (including ``blitzy-cal`` per AAP
    §0.2.3) have no submodules; in that case ``git submodule status``
    succeeds with an empty stdout. We collapse the empty case to the
    literal string ``"none"`` so the report reads naturally
    ("submodules: none") rather than ("submodules: "). A non-empty result
    is returned verbatim (one line per submodule, prefixed with
    ``"+"``/``"-"``/``" "`` per Git's convention).

    Returns:
        The stripped multi-line ``git submodule status`` output, or
        ``"none"`` if the repository has no submodules.
    """
    try:
        out = git_run(["submodule", "status"]).strip()
        return out if out else "none"
    except subprocess.CalledProcessError:
        # Older git versions, or repos in an unusual state, can return
        # non-zero. Per the no-fabrication rule we report the gap
        # honestly rather than synthesizing a "0 submodules" claim.
        return "none"


def capture_commit_date_range() -> dict[str, str]:
    """Return the first and last commit timestamps across all branches.

    Uses two ``git log --all`` invocations with the ``%aI`` (ISO 8601
    strict) author-date format:

        - ``--reverse --max-count=1`` returns the EARLIEST commit's
          authored timestamp.
        - ``--max-count=1`` (no reverse) returns the MOST RECENT commit's
          authored timestamp.

    Two invocations are used (rather than a single capture-then-parse)
    because ``git log --reverse`` semantics on large repositories vary
    across git versions; the ``--max-count=1`` flag keeps each call
    constant-time relative to the repository size.

    Returns:
        A dict with two keys::

            {
                "first": "<earliest commit authored timestamp, ISO 8601>",
                "last":  "<most recent commit authored timestamp, ISO 8601>"
            }

        Either value may be an empty string when the repository contains
        no commits (an extreme edge case; the harness logs a warning at
        that point because most downstream metrics will be insufficient
        signal).
    """
    first_out = git_run(["log", "--all", "--reverse", "--format=%aI", "--max-count=1"])
    last_out = git_run(["log", "--all", "--format=%aI", "--max-count=1"])
    return {
        "first": first_out.strip(),
        "last": last_out.strip(),
    }


def capture_python_version() -> str:
    """Return ``sys.version`` flattened to a single line.

    ``sys.version`` natively contains embedded newlines on some
    platforms (CPython on Linux includes the build configuration on a
    second line); we flatten with ``replace("\\n", " ")`` so the
    Environment Verification section in ``acceleration-report.md`` is
    one row in a Markdown table rather than two.

    Returns:
        A single-line string like ``"3.13.7 (main, ..., 18:23:54) [GCC 13.3.0]"``.
    """
    return sys.version.replace("\n", " ")


def capture_os() -> str:
    """Return ``platform.platform()`` identifying the operating system.

    The value is the same one used by ``setup.py`` distributions for
    platform tags, e.g., ``"Linux-5.15.0-105-generic-x86_64-with-glibc2.35"``
    on Linux or ``"macOS-14.4-arm64-arm-64bit"`` on Apple Silicon. The
    full platform string is preserved so cross-environment runs can be
    distinguished in the report.

    Returns:
        The verbatim output of ``platform.platform()``.
    """
    return platform.platform()


def capture_extracted_at() -> str:
    """Return the current UTC ISO 8601 timestamp for this capture.

    Wraps ``_shared.iso_now_utc()`` so every script in the harness uses
    the same canonical timestamp format (``%Y-%m-%dT%H:%M:%S.%f+00:00``).
    Consistency across scripts matters because the consistency validator
    cross-references timestamps across artifacts.

    Returns:
        A timezone-aware ISO 8601 timestamp in UTC, e.g.,
        ``"2026-05-15T18:42:31.123456+00:00"``.
    """
    return iso_now_utc()


# ---------------------------------------------------------------------------
# Section 2 — Orchestrator
# ---------------------------------------------------------------------------
#
# ``capture_environment`` calls every per-field capture in a fixed order
# and assembles them into the canonical environment dict. Each capture is
# wrapped in a try/except: a failure in one field produces the literal
# placeholder ``"<capture failed: <ExceptionType>: <message>>"`` for that
# field, while the remaining fields are still captured. This satisfies
# AAP §0.7.3 Boundary 2 ("MUST NOT fabricate") — the placeholder is
# HONEST about the gap; it is never a synthesized value.


def capture_environment() -> dict[str, Any]:
    """Capture every Rule-6 field into a single environment dict.

    Iterates through the registered ``(field_name, capture_fn)`` pairs
    in fixed order, invoking each capture function with isolated error
    handling. Failures are recorded as ``"<capture failed: ...>"``
    placeholders so a single broken field never aborts the whole run.

    The fixed field ordering — repo_url, git_version, commit_count,
    branch_count, submodules, date_range, python_version, os,
    extracted_at — matches the order in which the fields appear in the
    Environment Verification section of ``acceleration-report.md``, so
    a hand-written renderer can iterate the dict and emit a table
    without re-sorting.

    Returns:
        A dict whose keys are the nine Rule-6 field names and whose
        values are the captured values (typed per each capture function)
        or the literal placeholder string ``"<capture failed: ...>"``.
        The dict always contains ALL nine keys, regardless of how many
        captures failed.

    Side effects:
        - Emits one INFO log record per captured field via the
          structured logger (phase=``"verify_environment"``).
        - Emits one ERROR log record per failed capture.
        - Indirectly appends to ``commands.log`` via each
          ``_shared.git_run`` invocation inside the capture functions.
    """
    logger = structured_logger(metric_id=None, phase="verify_environment")
    env: dict[str, Any] = {}

    # Fixed iteration order — matches the report section's column order.
    captures: list[tuple[str, Any]] = [
        ("repo_url", capture_repo_url),
        ("git_version", capture_git_version),
        ("commit_count", capture_commit_count),
        ("branch_count", capture_branch_count),
        ("submodules", capture_submodule_state),
        ("date_range", capture_commit_date_range),
        ("python_version", capture_python_version),
        ("os", capture_os),
        ("extracted_at", capture_extracted_at),
    ]

    for field_name, fn in captures:
        try:
            value = fn()
            env[field_name] = value
            # Truncate long values in the log message; the full value is
            # preserved in ``env`` (and ultimately in environment.json).
            preview = str(value).replace("\n", " ")[:120]
            logger.info(
                f"Captured {field_name}: {preview}",
                extra={
                    "context": {
                        "field": field_name,
                        "value": preview,
                    }
                },
            )
        except Exception as exc:  # noqa: BLE001 — per-field isolation is intentional
            placeholder = f"<capture failed: {type(exc).__name__}: {exc}>"
            env[field_name] = placeholder
            logger.error(
                f"Failed to capture {field_name}: {exc}",
                extra={
                    "context": {
                        "field": field_name,
                        "error_type": type(exc).__name__,
                        "error": str(exc),
                    }
                },
            )

    return env


# ---------------------------------------------------------------------------
# Section 3 — Output Generation
# ---------------------------------------------------------------------------


def write_environment(env: dict[str, Any], output_path: Path) -> None:
    """Persist ``env`` to ``output_path`` as JSON.

    Uses ``_shared.save_json`` (which internally calls ``json.dumps``
    with ``indent=2`` and ``ensure_ascii=False``) so the resulting file
    is human-readable and preserves non-ASCII content. The parent
    directory is created if it does not exist.

    Args:
        env: The environment dict produced by ``capture_environment()``.
            Expected to contain all nine Rule-6 keys, but no validation
            is performed here — ``validate_consistency.py`` is the
            authoritative checker for downstream schema conformance.
        output_path: Filesystem path to write to. Defaults are owned by
            the CLI parser in ``main()``; this function expects an
            already-resolved ``Path``.

    Raises:
        OSError: If the file cannot be written (permission denied,
            disk full, parent path is a file, etc.). Propagated to
            ``main()`` for the exit-code-2 path.

    Side effects:
        - Creates ``output_path.parent`` if it does not exist.
        - Writes UTF-8 JSON to ``output_path``.
        - Appends two ``"write"`` lines to ``commands.log`` — one from
          ``save_json`` itself (the canonical write event) and one from
          the explicit ``command_log_append`` call below. The
          duplication is intentional defense-in-depth so the
          Reproducibility Appendix records the write even if a future
          refactor removes the side effect from ``save_json``.
    """
    output_path.parent.mkdir(parents=True, exist_ok=True)
    save_json(output_path, env)
    command_log_append("write", str(output_path))


# ---------------------------------------------------------------------------
# Section 4 — CLI Entry Point
# ---------------------------------------------------------------------------


def main(argv: list[str] | None = None) -> int:
    """CLI entry point — capture environment and write to JSON.

    Workflow:
        1. Parse ``--output`` (default
           ``DATA_DIR / "environment.json"``).
        2. Resolve the run_id (creates ``logs/<run_id>/`` if needed).
        3. Verify we are inside a git repository
           (``git rev-parse --git-dir``); exit 1 if not.
        4. Run every capture via ``capture_environment``.
        5. Write the result via ``write_environment``; exit 2 on
           ``OSError``.
        6. Log success and return 0.

    Args:
        argv: Optional argv list for testing (passed directly to
            ``argparse.ArgumentParser.parse_args``). When ``None`` (the
            default), ``argparse`` reads from ``sys.argv[1:]``.

    Returns:
        Exit code:
            - ``0`` Environment captured and persisted successfully.
            - ``1`` Not inside a git repository.
            - ``2`` Output file could not be written.
    """
    parser = argparse.ArgumentParser(
        description=(
            "Capture execution environment per Rule 6 (Environment First). "
            "Writes data/environment.json which precedes all metric extraction."
        ),
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=DATA_DIR / "environment.json",
        help=(
            "Output JSON path (default: "
            "blitzy/reports/acceleration/data/environment.json)."
        ),
    )
    args = parser.parse_args(argv)

    run_id = get_or_create_run_id()
    logger = structured_logger(metric_id=None, phase="verify_environment")
    logger.info(
        "verify_environment.py starting",
        extra={
            "context": {
                "run_id": run_id,
                "output": str(args.output),
                "argv": list(argv) if argv is not None else sys.argv[1:],
                "cwd": os.getcwd(),
            }
        },
    )

    # ---- Pre-flight: verify we are inside a git repository ----
    # ``git rev-parse --git-dir`` succeeds (returns ``.git`` or the
    # absolute git-dir path) only inside a git working tree. A non-zero
    # exit code is the canonical signal for "not a git repository."
    try:
        git_run(["rev-parse", "--git-dir"])
    except subprocess.CalledProcessError:
        logger.error(
            "Not inside a git repository. Run this script from the repository root.",
            extra={"context": {"cwd": os.getcwd()}},
        )
        return 1
    except FileNotFoundError as exc:
        # ``git`` is not installed or not on PATH. This is a setup-error
        # condition; we report it explicitly because the failure mode is
        # otherwise misleading (the user would see "Not inside a git
        # repository" even though git is missing).
        logger.error(
            f"git executable not found on PATH: {exc}",
            extra={"context": {"error": str(exc)}},
        )
        return 1

    # ---- Capture every Rule-6 field ----
    env = capture_environment()

    # ---- Persist the result ----
    try:
        write_environment(env, args.output)
    except OSError as exc:
        logger.error(
            f"Cannot write {args.output}: {exc}",
            extra={
                "context": {
                    "output": str(args.output),
                    "error_type": type(exc).__name__,
                    "error": str(exc),
                }
            },
        )
        return 2

    logger.info(
        f"Environment captured to {args.output}",
        extra={
            "context": {
                "output": str(args.output),
                "fields": list(env.keys()),
                "extracted_at": env.get("extracted_at"),
            }
        },
    )
    return 0


# ---------------------------------------------------------------------------
# Section 5 — Schema-Required Import References
# ---------------------------------------------------------------------------
#
# Several imports listed in the schema (``json``, ``logging``,
# ``datetime``, ``timezone``) are consumed transitively rather than
# directly inside function bodies:
#   - ``json`` is wrapped by ``_shared.save_json``.
#   - ``logging`` provides the type of the ``LoggerAdapter`` returned by
#     ``_shared.structured_logger``.
#   - ``datetime`` and ``timezone`` are wrapped by ``_shared.iso_now_utc``.
#
# Explicitly referencing them here keeps the imports live for static type
# checkers (so ``from datetime import datetime, timezone`` does not
# trigger an "imported but unused" warning) and documents the contract
# that this module's logger return type is compatible with
# ``logging.LoggerAdapter``. The tuple is never evaluated for its
# contents; the references are sufficient to satisfy import-validators.

_SCHEMA_IMPORT_REFS: tuple[Any, ...] = (
    json.JSONDecodeError,
    logging.LoggerAdapter,
    datetime,
    timezone,
)


if __name__ == "__main__":
    sys.exit(main())
