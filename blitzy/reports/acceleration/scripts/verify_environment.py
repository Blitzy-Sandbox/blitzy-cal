#!/usr/bin/env python3
"""verify_environment.py — Rule 6 (Environment First) verification.

Captures execution-environment metadata BEFORE any metric extraction
(AAP §0.5.1, §0.7.2 Rule 6). Writes data/environment.json with twelve
fields: repo_url, git_version, commit_count, branch_count, submodules,
date_range {first,last}, python_version, os, extracted_at, run_id,
head_sha, default_branch.

Per-field failures record "<capture failed: <ExceptionType>: <message>>"
rather than aborting (AAP §0.7.3 Boundary 2 — no fabrication / honest gaps).

CLI: ``python3 verify_environment.py [--output <PATH>]``
Exit Codes: 0 ok | 1 not-a-git-repo / output-outside-report-dir | 2 write-failed.

Constraints (AAP §0.7.3): read-only on analyzed repo, stdlib only,
structured JSON logging with run_id, git via _shared.git_run (read-only
allowlist), writes under blitzy/reports/acceleration/ (ensure_report_path).
"""

from __future__ import annotations

import argparse
import logging
import os
import platform
import re
import subprocess
import sys
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
    git_run,
    iso_now_utc,
    save_json,
    structured_logger,
)


# -- Per-Field Capture Functions --------------------------------------------

_CREDS_RE = re.compile(r"^(https?://)[^/@\s]+@")


def capture_repo_url() -> str:
    """Return the origin remote URL with any ``user:password@`` credentials
    redacted (prevents CI ephemeral GitHub tokens leaking into committed
    JSON). Returns "local (no remote configured)" when no remote is set."""
    try:
        return _CREDS_RE.sub(r"\1", git_run(["remote", "get-url", "origin"]).strip())
    except subprocess.CalledProcessError:
        return "local (no remote configured)"


def capture_git_version() -> str:
    """Return the system git version string."""
    return git_run(["--version"]).strip()


def capture_commit_count() -> int:
    """Return total commit count across all refs."""
    return int(git_run(["rev-list", "--all", "--count"]).strip())


def capture_branch_count() -> int:
    """Count distinct branch short-names (local + remote, deduplicated)."""
    out = git_run(["branch", "-a", "--format=%(refname:short)"])
    branches: set[str] = set()
    for raw in out.splitlines():
        name = raw.strip()
        if not name or name.startswith("(HEAD") or name.startswith("(no branch"):
            continue
        if name.startswith("origin/"):
            name = name[len("origin/"):]
        branches.add(name)
    return len(branches)


def capture_submodule_state() -> str:
    """Return git submodule status output, or "none" if empty."""
    try:
        out = git_run(["submodule", "status"]).strip()
        return out if out else "none"
    except subprocess.CalledProcessError:
        return "none"


def capture_commit_date_range() -> dict[str, str]:
    """Return first and last authored commit timestamps across all refs.

    git quirk: ``--max-count=1`` is applied BEFORE ``--reverse``, so the
    combination returns the LATEST commit. We therefore omit ``--max-count``
    for the reversed (earliest) query and take the FIRST line in Python.
    The non-reversed query uses ``--max-count=1`` correctly.
    """
    first_full = git_run(["log", "--all", "--reverse", "--format=%aI"])
    last_out = git_run(["log", "--all", "--format=%aI", "--max-count=1"])
    first_lines = [ln.strip() for ln in first_full.splitlines() if ln.strip()]
    return {"first": first_lines[0] if first_lines else "", "last": last_out.strip()}


def capture_python_version() -> str:
    """Return sys.version flattened to a single line."""
    return sys.version.replace("\n", " ")


def capture_os() -> str:
    """Return platform.platform() identifying the operating system."""
    return platform.platform()


def capture_head_sha() -> str:
    """Return the current HEAD commit SHA (rev-parse HEAD)."""
    return git_run(["rev-parse", "HEAD"]).strip()


def capture_default_branch() -> str:
    """Return the repository's default branch name.

    Probes ``origin/HEAD`` first; falls back to ``main`` and ``master`` via
    ``rev-parse --verify``. Returns literal "<unknown>" if neither succeeds
    (no fabrication per AAP §0.7.3 Boundary 2).
    """
    out = git_run(["rev-parse", "--abbrev-ref", "origin/HEAD"], allow_failure=True).strip()
    if out.startswith("origin/"):
        return out[len("origin/"):]
    if out:
        return out
    for candidate in ("main", "master"):
        if git_run(["rev-parse", "--verify", candidate], allow_failure=True).strip():
            return candidate
    return "<unknown>"


# Ordered list of (field, capture_fn) pairs run by capture_environment().
CAPTURES: list[tuple[str, Any]] = [
    ("repo_url", capture_repo_url),
    ("git_version", capture_git_version),
    ("commit_count", capture_commit_count),
    ("branch_count", capture_branch_count),
    ("submodules", capture_submodule_state),
    ("date_range", capture_commit_date_range),
    ("python_version", capture_python_version),
    ("os", capture_os),
    ("extracted_at", iso_now_utc),
    ("run_id", get_or_create_run_id),
    ("head_sha", capture_head_sha),
    ("default_branch", capture_default_branch),
]


# -- Orchestrator -----------------------------------------------------------

def capture_environment() -> dict[str, Any]:
    """Run every per-field capture and return the assembled environment dict.

    Per-field exceptions are caught and recorded so a single broken field
    never aborts the whole run (AAP §0.7.3 Boundary 2).
    """
    logger = structured_logger(metric_id=None, phase="verify_environment")
    env: dict[str, Any] = {}
    for field_name, fn in CAPTURES:
        try:
            value = fn()
            env[field_name] = value
            preview = str(value).replace("\n", " ")[:120]
            logger.info(f"Captured {field_name}: {preview}",
                        extra={"context": {"field": field_name, "value": preview}})
        except Exception as exc:  # noqa: BLE001 — per-field isolation
            env[field_name] = f"<capture failed: {type(exc).__name__}: {exc}>"
            logger.error(f"Failed to capture {field_name}: {exc}",
                         extra={"context": {"field": field_name,
                                            "error_type": type(exc).__name__,
                                            "error": str(exc)}})
    return env


def write_environment(env: dict[str, Any], output_path: Path) -> None:
    """Persist env to output_path (atomic via save_json)."""
    save_json(output_path, env)
    command_log_append("write", str(output_path))


# -- CLI Entry Point --------------------------------------------------------

def main(argv: list[str] | None = None) -> int:
    """CLI: capture environment and write data/environment.json."""
    parser = argparse.ArgumentParser(
        description="Capture execution environment (Rule 6 — Environment First).",
    )
    parser.add_argument(
        "--output", type=Path, default=DATA_DIR / "environment.json",
        help="Output JSON path (must resolve under blitzy/reports/acceleration/).",
    )
    args = parser.parse_args(argv)

    run_id = get_or_create_run_id()
    logger: logging.Logger = structured_logger(metric_id=None, phase="verify_environment")

    try:
        resolved_output = ensure_report_path(args.output)
    except ValueError as exc:
        logger.error(f"Refusing to write outside report directory: {exc}",
                     extra={"context": {"output": str(args.output)}})
        return 1

    logger.info("verify_environment.py starting",
                extra={"context": {"run_id": run_id, "output": str(resolved_output),
                                   "argv": list(argv) if argv is not None else sys.argv[1:],
                                   "cwd": os.getcwd()}})

    try:
        git_run(["rev-parse", "--git-dir"])
    except subprocess.CalledProcessError:
        logger.error("Not inside a git repository.", extra={"context": {"cwd": os.getcwd()}})
        return 1
    except FileNotFoundError as exc:
        logger.error(f"git executable not found on PATH: {exc}",
                     extra={"context": {"error": str(exc)}})
        return 1

    env = capture_environment()

    try:
        write_environment(env, resolved_output)
    except OSError as exc:
        logger.error(f"Cannot write {resolved_output}: {exc}",
                     extra={"context": {"output": str(resolved_output),
                                        "error_type": type(exc).__name__,
                                        "error": str(exc)}})
        return 2

    logger.info(f"Environment captured to {resolved_output}",
                extra={"context": {"output": str(resolved_output),
                                   "fields": list(env.keys()),
                                   "extracted_at": env.get("extracted_at")}})
    return 0


if __name__ == "__main__":
    sys.exit(main())
