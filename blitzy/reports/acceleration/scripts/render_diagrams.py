#!/usr/bin/env python3
"""render_diagrams.py — Mermaid Syntax Validator (Optional Pre-flight Check).

Validates Mermaid diagram syntax embedded in:
  * ``../acceleration-report.md`` — fenced ``` ```mermaid ``` `` blocks
  * ``../executive-presentation.html`` — ``<pre class="mermaid">...</pre>`` blocks

OPTIONAL pre-flight check used to fail-fast if a hand-edited template
introduces a syntactically broken Mermaid block before the deck is shipped.
The harness pipeline (``extract_metrics.py`` → ``validate_consistency.py`` →
``build_report.py`` → ``build_presentation.py``) can complete without
running this script.

Two validation strategies, in preference order:

1. **Mermaid CLI** (preferred): ``npx -y @mermaid-js/mermaid-cli`` is invoked
   with a temporary ``.mmd`` file. The CLI's exit code is the authoritative
   verdict. Requires Node.js + npm on PATH.
2. **Regex fallback**: pure-Python checks for missing/unrecognized diagram
   directive, unbalanced brackets, mixed arrow types per line, odd unescaped
   quote count, and unbalanced ``subgraph``/``end`` blocks.

Exit codes:
  * 0 — all diagrams valid (or CLI unavailable and regex check passed)
  * 1 — one or more diagrams have syntax errors
  * 2 — at least one requested source file is missing OR a requested
        source file is present but contains zero Mermaid blocks
        (the Visual Architecture Documentation rule requires that
        every requested surface carry at least one diagram). Review
        Finding 1 (MAJOR — Visual Architecture Rule): previously
        exit 2 was only returned when BOTH files were missing; now
        the absence of either requested surface (and per-surface
        zero-block) blocks the pipeline. Use ``--allow-missing-source``
        or ``--allow-zero-blocks`` to opt out for dry runs only.

Constraints (AAP §0.7.3):
  * Read-only on analyzed repository and on the report/deck files
  * Python 3.10+ stdlib only — no ``pip install``
  * Structured JSON logging via ``_shared.structured_logger``
  * Every subprocess invocation appended to ``commands.log`` via
    ``_shared.command_log_append``
  * Insufficient signal (CLI absent + regex clean) does NOT fail the run

CLI: ``python3 render_diagrams.py [--report PATH] [--deck PATH] [--no-cli]``

References: AAP §0.5.1 (extraction pipeline), AAP §0.6.2 (per-script docs),
decision-log.md (validator strategy rationale).
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Iterable

# Make _shared importable when this script is run directly. Mirrors the
# pattern used by every other script under blitzy/reports/acceleration/scripts/.
SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from _shared import (  # noqa: E402  — sys.path mutation must precede import
    ACCELERATION_REPORT_PATH,
    EXECUTIVE_PRESENTATION_PATH,
    command_log_append,
    get_or_create_run_id,
    structured_logger,
)


# === Public module-level constants =========================================

MARKDOWN_MERMAID_RE: re.Pattern[str] = re.compile(
    r"```mermaid\s*\n(.*?)\n```",
    re.DOTALL | re.MULTILINE,
)
"""Matches fenced ```mermaid ... ``` blocks; group 1 captures the source."""

HTML_MERMAID_RE: re.Pattern[str] = re.compile(
    # The regex matches any <pre> element whose attribute list contains a
    # ``class`` attribute that, in turn, includes ``mermaid`` as a
    # whitespace-delimited token. This robustly accepts every legitimate
    # variant a templating system might emit:
    #
    #   <pre class="mermaid">                  (canonical)
    #   <pre class='mermaid'>                  (single quotes)
    #   <pre class="mermaid diagram-block">    (additional classes)
    #   <pre class="diagram-block mermaid">    (mermaid not first)
    #   <pre id="d1" class="mermaid">          (attribute before class)
    #   <pre  class="mermaid"  >               (extra whitespace)
    #
    # The previous regex required exactly ``class="mermaid"`` and missed
    # all four variants. Review Finding 3 (MINOR — Robustness).
    #
    # Construction notes:
    #   - ``<pre\b`` matches the opening tag (\b prevents matching
    #     ``<presentation``).
    #   - ``[^>]*?`` consumes any preceding attributes lazily.
    #   - ``class=(["'])([^"']*)\1`` captures the class attribute value
    #     into group(2) using a back-reference so the opening and
    #     closing quotes match.
    #   - ``[^>]*>`` consumes any attributes after class up to the
    #     closing ``>`` of the opening tag.
    #   - ``(?P<body>.*?)`` is the named group containing the Mermaid
    #     source between the tags.
    #
    # An additional Python-level membership test in
    # ``extract_mermaid_blocks_from_html`` checks that the class value
    # contains ``mermaid`` as a whitespace-delimited token (matching
    # the HTML5 class-token semantics that browsers use). This avoids
    # false positives on classes like ``mermaid-disabled``.
    r'<pre\b[^>]*?\bclass=(["\'])([^"\']*)\1[^>]*>(?P<body>.*?)</pre>',
    re.DOTALL | re.IGNORECASE,
)
"""Matches ``<pre ... class="mermaid" ...>...</pre>`` blocks.

Robust against single/double quotes, additional classes on the
``class`` attribute, and attributes appearing before or after the
``class`` attribute. The class attribute value is captured in group 2;
the Mermaid source is captured in the named ``body`` group. Callers
MUST verify that the class value contains ``mermaid`` as a
whitespace-delimited token (see ``extract_mermaid_blocks_from_html``)
because the regex itself is intentionally permissive on the class
value to accept multi-class declarations like ``class="mermaid foo"``.
"""

VALID_MERMAID_DIRECTIVES: tuple[str, ...] = (
    "graph",
    "flowchart",
    "sequenceDiagram",
    "classDiagram",
    "stateDiagram",
    "stateDiagram-v2",
    "erDiagram",
    "journey",
    "gantt",
    "pie",
    "gitGraph",
    "C4Context",
    "mindmap",
    "timeline",
    "xychart",
    "xychart-beta",
    "block-beta",
)
"""Recognized Mermaid diagram-type opening keywords. A valid block must begin
(after stripping any leading ``%%{init: ... }%%`` config directive and
blank/comment lines) with one of these tokens."""


# === Per-surface minimum Mermaid block counts ===============================
# Review Finding 2 (MAJOR — Visual Architecture Rule): a requested source
# file that exists but contains zero Mermaid blocks must NOT pass
# validation. The minimums below codify the AAP-mandated diagram coverage
# per surface so that a future content edit that strips diagrams is caught
# at validation time. Set to 1 by default; the Markdown report and the
# HTML deck are validated against this floor independently. The Markdown
# report's actual diagram count is also enforced separately by
# ``build_report.py``'s ``MIN_MERMAID_DIAGRAMS`` constant (currently 16);
# this script's floor is a coarser per-surface presence check.

MIN_MERMAID_BLOCKS_MARKDOWN: int = 1
"""Minimum count of Mermaid blocks expected in the Markdown report surface.

A render with fewer blocks fails the per-surface presence check and
returns exit code 2 (Visual Architecture Documentation rule). The
floor is intentionally lenient (1) so this script remains an
independent pre-flight check; the Markdown report's full diagram
inventory (16+ blocks) is enforced by ``build_report.py`` directly."""

MIN_MERMAID_BLOCKS_HTML: int = 1
"""Minimum count of Mermaid blocks expected in the HTML deck surface.

A deck with zero blocks fails the per-surface presence check; reveal.js
without at least one Mermaid diagram does not satisfy the executive
presentation rule's "every slide has ≥1 non-text visual element"
constraint."""


# === Private regex helpers =================================================

# Strips ``%%{init: ... }%%`` config directive lines.
_INIT_DIRECTIVE_RE: re.Pattern[str] = re.compile(
    r"^\s*%%\{[^}]*\}%%\s*$", re.MULTILINE,
)

# ``%%`` is Mermaid's line-comment marker.
_COMMENT_LINE_RE: re.Pattern[str] = re.compile(r"^\s*%%")

# ``subgraph`` keyword as the first non-whitespace token on a line.
_SUBGRAPH_OPEN_RE: re.Pattern[str] = re.compile(r"^\s*subgraph\b")

# ``end`` keyword as the only token on a line (so ``endpoint`` doesn't match).
_SUBGRAPH_END_RE: re.Pattern[str] = re.compile(r"^\s*end\s*$")

# Arrow tokens checked for mixed-type-per-line. Order: more specific patterns
# first so ``==>`` is not accidentally matched as ``-->``.
_ARROW_TOKENS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("==>", re.compile(r"==+>")),
    ("-.->", re.compile(r"-\.+->")),
    ("-->", re.compile(r"--+>")),
    ("~~>", re.compile(r"~~+>")),
    ("-.-", re.compile(r"-\.+-(?!>)")),
    ("---", re.compile(r"--+-(?!>)")),
)


def _strip_init_directives(source: str) -> str:
    """Remove leading ``%%{init: ... }%%`` config lines from a Mermaid block."""
    return _INIT_DIRECTIVE_RE.sub("", source)


def _first_meaningful_line(source: str) -> str:
    """Return the first non-blank, non-comment line (stripped); ``""`` if none."""
    for raw in source.splitlines():
        line = raw.strip()
        if not line or _COMMENT_LINE_RE.match(raw):
            continue
        return line
    return ""


def _count_unescaped_double_quotes(line: str) -> int:
    """Count ``"`` characters in ``line`` not preceded by ``\\``."""
    count = 0
    prev = ""
    for ch in line:
        if ch == '"' and prev != "\\":
            count += 1
        prev = ch
    return count


# === Public exception ======================================================


class CLIUnavailable(Exception):
    """Raised by :func:`cli_syntax_check` when the Mermaid CLI cannot be invoked.

    Distinct from a CLI syntax-failure verdict (which returns ``(False, stderr)``).
    ``CLIUnavailable`` signals the *invocation itself* could not complete —
    typically because ``npx`` is not on PATH, the package fetch timed out, or
    the CLI binary refused to start. Callers typically catch this, log a
    warning, switch ``use_cli`` to False for the remainder of the run, and
    fall back to the regex check.
    """


# === Extraction functions ==================================================


def extract_mermaid_blocks_from_markdown(text: str) -> list[tuple[int, str]]:
    """Extract every fenced ``` ```mermaid ``` `` block from Markdown text.

    Args:
        text: Full Markdown document source.

    Returns:
        A list of ``(line_number, mermaid_source)`` tuples in document order.
        ``line_number`` is the 1-indexed line at which the opening fence
        begins; ``mermaid_source`` is the inner content with leading and
        trailing whitespace stripped.
    """
    blocks: list[tuple[int, str]] = []
    for match in MARKDOWN_MERMAID_RE.finditer(text):
        line_number = text[: match.start()].count("\n") + 1
        body = match.group(1).strip("\n").rstrip()
        blocks.append((line_number, body))
    return blocks


def extract_mermaid_blocks_from_html(text: str) -> list[tuple[int, str]]:
    """Extract every ``<pre ... class="mermaid" ...>...</pre>`` block.

    Robust against HTML class-attribute variants. Review Finding 3
    (MINOR — Robustness) called out that the previous regex required
    exactly ``<pre class="mermaid">`` and missed every legitimate
    variant. ``HTML_MERMAID_RE`` now accepts any ``<pre>`` element with
    a ``class`` attribute that contains ``mermaid`` as a whitespace-
    delimited token; this Python-level check enforces HTML5 class-token
    semantics so multi-class declarations like ``class="mermaid foo"``
    are detected while ``class="mermaid-disabled"`` is correctly
    excluded.

    Args:
        text: Full HTML document source.

    Returns:
        A list of ``(line_number, mermaid_source)`` tuples in document
        order. ``line_number`` is the 1-indexed line at which the
        opening ``<pre>`` tag begins; ``mermaid_source`` is the inner
        content stripped.
    """
    blocks: list[tuple[int, str]] = []
    for match in HTML_MERMAID_RE.finditer(text):
        # The regex captures the class attribute value in group(2) and
        # the Mermaid source in the named "body" group. We enforce a
        # whitespace-delimited membership check on the class value to
        # avoid matching class names that merely contain the substring
        # ``mermaid`` (e.g., ``mermaid-disabled`` or ``not-mermaid``).
        class_value = match.group(2) or ""
        class_tokens = class_value.split()
        if "mermaid" not in class_tokens:
            continue
        line_number = text[: match.start()].count("\n") + 1
        body = match.group("body").strip()
        blocks.append((line_number, body))
    return blocks


# === Regex syntax check (fallback validator) ===============================


def regex_syntax_check(source: str) -> list[str]:
    """Run five lightweight regex checks against a Mermaid source block.

    Pragmatic fallback for environments without Node.js. Catches the most
    common error classes seen in hand-edited Mermaid:

      1. **Diagram directive** — first meaningful line (after stripping init
         directives, blank lines, and ``%%`` comments) must begin with one
         of :data:`VALID_MERMAID_DIRECTIVES`.
      2. **Balanced brackets** — ``[``/``]``, ``(``/``)``, and ``{``/``}``
         counts must match across the whole block.
      3. **No mixed arrow types per line** — a line containing both ``-->``
         and ``==>`` (or other mixed arrow tokens) almost always indicates
         a typo because the two arrow styles have different semantics.
      4. **Balanced quoted labels** — total count of unescaped ``"``
         characters must be even.
      5. **Balanced subgraphs** — count of ``subgraph`` opening lines must
         equal the count of standalone ``end`` lines.

    Intentionally lenient: never reports false positives on valid Mermaid
    that the CLI accepts, but can miss subtle errors that only the CLI
    catches. Used when the CLI is unavailable.

    Args:
        source: Raw Mermaid source for a single block (no fence lines).

    Returns:
        Human-readable error messages; empty list means the block passed.
    """
    errors: list[str] = []
    if not source.strip():
        errors.append("Empty Mermaid block (no source content)")
        return errors

    # Check 1: diagram directive
    stripped = _strip_init_directives(source)
    first = _first_meaningful_line(stripped)
    if not first:
        errors.append("No diagram directive found (block contains only blanks/comments)")
    else:
        first_token = first.split(None, 1)[0].rstrip(":")
        if first_token not in VALID_MERMAID_DIRECTIVES:
            errors.append(
                f"Unrecognized diagram directive: {first_token!r} "
                f"(expected one of {list(VALID_MERMAID_DIRECTIVES)})"
            )

    # Check 2: balanced brackets
    for open_ch, close_ch in (("[", "]"), ("(", ")"), ("{", "}")):
        oc, cc = source.count(open_ch), source.count(close_ch)
        if oc != cc:
            errors.append(
                f"Unbalanced brackets: {open_ch!r} count={oc}, {close_ch!r} count={cc}"
            )

    # Check 3: no mixed arrow types per line. Strip ``"..."`` label contents
    # first so labels containing arrow-like text don't trigger false positives.
    for line_no, raw_line in enumerate(source.splitlines(), start=1):
        if _COMMENT_LINE_RE.match(raw_line):
            continue
        without_labels = re.sub(r'"[^"]*"', "", raw_line)
        found_labels: list[str] = []
        for arrow_label, arrow_re in _ARROW_TOKENS:
            if arrow_re.search(without_labels):
                found_labels.append(arrow_label)
        unique_labels = list(dict.fromkeys(found_labels))
        if len(unique_labels) > 1:
            errors.append(
                f"Line {line_no}: mixed arrow types {unique_labels} "
                f"(use a single arrow style per line)"
            )

    # Check 4: balanced quoted labels
    total_quotes = sum(
        _count_unescaped_double_quotes(raw_line)
        for raw_line in source.splitlines()
        if not _COMMENT_LINE_RE.match(raw_line)
    )
    if total_quotes % 2 != 0:
        errors.append(
            f"Unbalanced quoted labels: odd number of unescaped \" characters "
            f"(count={total_quotes}); a label is likely missing its closing quote"
        )

    # Check 5: balanced subgraph / end
    subgraph_count = sum(
        1 for raw in source.splitlines() if _SUBGRAPH_OPEN_RE.match(raw)
    )
    end_count = sum(
        1 for raw in source.splitlines() if _SUBGRAPH_END_RE.match(raw)
    )
    if subgraph_count != end_count:
        errors.append(
            f"Unbalanced subgraphs: subgraph count={subgraph_count}, "
            f"end count={end_count}"
        )

    return errors


# === CLI detection =========================================================


def detect_cli_availability() -> bool:
    """Probe the environment to determine if the Mermaid CLI is usable.

    Runs two subprocess probes:

      1. ``which npx`` — confirms ``npx`` is on PATH.
      2. ``npx -y @mermaid-js/mermaid-cli --version`` — confirms the package
         can be resolved (possibly via on-demand fetch). 30 s timeout.

    Every invocation is appended to ``commands.log``. All subprocess
    exceptions are caught; this function never raises.

    Returns:
        ``True`` if both probes succeed; ``False`` otherwise.
    """
    which_cmd = ["which", "npx"]
    command_log_append("subprocess", " ".join(which_cmd))
    try:
        which_result = subprocess.run(
            which_cmd, capture_output=True, timeout=10, check=False,
        )
    except (FileNotFoundError, subprocess.TimeoutExpired, OSError):
        return False
    if which_result.returncode != 0 or not which_result.stdout.strip():
        return False

    version_cmd = ["npx", "-y", "@mermaid-js/mermaid-cli", "--version"]
    command_log_append("subprocess", " ".join(version_cmd))
    try:
        version_result = subprocess.run(
            version_cmd, capture_output=True, timeout=30, check=False,
        )
    except (FileNotFoundError, subprocess.TimeoutExpired, OSError):
        return False
    return version_result.returncode == 0


# === CLI syntax check (preferred validator) ================================


def cli_syntax_check(
    source: str,
    run_id: str,
    block_label: str,
) -> tuple[bool, str]:
    """Validate a Mermaid block by invoking the headless Mermaid CLI.

    Writes ``source`` to a temporary ``.mmd`` file and runs
    ``npx -y @mermaid-js/mermaid-cli --input <tmp> --output <tmp>.svg``.
    The CLI's exit code is the authoritative verdict.

    Args:
        source: Raw Mermaid source for a single block.
        run_id: The run correlation ID (log context only).
        block_label: Human-readable identifier for the block (e.g.,
            ``"acceleration-report.md:L42"``) used in log diagnostics.

    Returns:
        ``(True, "")`` when the CLI accepted the block;
        ``(False, "<stderr text>")`` when the CLI rejected it.

    Raises:
        CLIUnavailable: when the CLI invocation cannot complete (npx missing,
            timeout, OS error). Caller falls back to regex check.
    """
    tmp_path: Path | None = None
    output_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            suffix=".mmd", delete=False, mode="w", encoding="utf-8",
        ) as tmp_fh:
            tmp_fh.write(source)
            tmp_path = Path(tmp_fh.name)
        output_path = tmp_path.with_suffix(".svg")

        cmd = [
            "npx", "-y", "@mermaid-js/mermaid-cli",
            "--input", str(tmp_path),
            "--output", str(output_path),
        ]
        # Log with paths elided so commands.log isn't polluted by ephemeral
        # tempfile names. The Reproducibility Appendix shows the shape, not
        # the specific filenames (which are run-local and meaningless across runs).
        command_log_append(
            "subprocess",
            f"npx -y @mermaid-js/mermaid-cli --input <mmd> --output <svg>"
            f" # block={block_label} run_id={run_id}",
        )
        try:
            result = subprocess.run(
                cmd, capture_output=True, timeout=60, check=False,
            )
        except FileNotFoundError as exc:
            raise CLIUnavailable(f"npx not found: {exc}") from exc
        except subprocess.TimeoutExpired as exc:
            raise CLIUnavailable(
                f"mermaid-cli timed out after 60s for block {block_label}"
            ) from exc
        except subprocess.CalledProcessError as exc:
            raise CLIUnavailable(f"mermaid-cli invocation failed: {exc}") from exc
        except OSError as exc:
            raise CLIUnavailable(f"mermaid-cli OS error: {exc}") from exc

        if result.returncode == 0:
            return (True, "")
        stderr_text = result.stderr.decode("utf-8", errors="replace").strip()
        if not stderr_text:
            stderr_text = result.stdout.decode("utf-8", errors="replace").strip()
        return (False, stderr_text or f"mermaid-cli exit code {result.returncode}")
    finally:
        # Always clean up temp files even if an exception propagates.
        for path in (tmp_path, output_path):
            if path is None:
                continue
            try:
                path.unlink()
            except FileNotFoundError:
                pass
            except OSError:
                # Best-effort cleanup; do not mask the original outcome.
                pass


# === File-level validator ==================================================


def _log_block_inventory(
    logger: logging.Logger,
    blocks: Iterable[tuple[int, str]],
    path: Path,
    kind: str,
) -> int:
    """Log a DEBUG-level inventory of every block; return the count."""
    count = 0
    for line_number, source in blocks:
        count += 1
        first_directive = _first_meaningful_line(_strip_init_directives(source))
        logger.debug(
            f"Block {count}: {path.name}:L{line_number} — "
            f"directive={first_directive!r}, length={len(source)} chars",
            extra={"context": {"path": str(path), "kind": kind,
                               "line_number": line_number,
                               "directive": first_directive,
                               "char_length": len(source)}},
        )
    return count


def validate_file(
    path: Path,
    kind: str,
    run_id: str,
    use_cli: bool,
) -> tuple[int, int]:
    """Validate every Mermaid block in ``path`` and log results.

    When ``use_cli`` is True, :func:`cli_syntax_check` is attempted first.
    If it raises :class:`CLIUnavailable` mid-run, this function falls back
    to :func:`regex_syntax_check` for the remainder of the file's blocks.
    When ``use_cli`` is False, the regex validator is used exclusively.

    Args:
        path: Filesystem path to the source file to validate.
        kind: Either ``"markdown"`` or ``"html"``. Any other value raises
            :class:`ValueError`.
        run_id: The harness run correlation ID, propagated into log context.
        use_cli: When True, prefer the CLI validator; when False, regex only.

    Returns:
        ``(error_count, block_count)`` — error_count is the number of blocks
        with at least one syntax error; block_count is the total discovered.

    Raises:
        ValueError: when ``kind`` is not ``"markdown"`` or ``"html"``.
    """
    if kind not in ("markdown", "html"):
        raise ValueError(
            f"validate_file: kind must be 'markdown' or 'html', got {kind!r}"
        )

    logger: logging.Logger = structured_logger(
        metric_id=None, phase="render_diagrams",
    )
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as exc:
        logger.error(
            f"Could not read {path}: {exc}",
            extra={"context": {"path": str(path), "kind": kind,
                               "error_type": type(exc).__name__,
                               "error": str(exc)}},
        )
        return (1, 0)

    if kind == "markdown":
        blocks = extract_mermaid_blocks_from_markdown(text)
    else:
        blocks = extract_mermaid_blocks_from_html(text)

    inventory_count = _log_block_inventory(logger, blocks, path, kind)
    assert inventory_count == len(blocks), (
        "internal: block inventory count diverged from extracted block list"
    )

    block_count = len(blocks)
    error_count = 0

    logger.info(
        f"Validating {block_count} Mermaid blocks in {path.name}",
        extra={"context": {"path": str(path), "kind": kind,
                           "block_count": block_count,
                           "validator": "cli" if use_cli else "regex"}},
    )

    cli_active = use_cli  # local flag — falls back on first CLIUnavailable
    for index, (line_number, source) in enumerate(blocks, start=1):
        block_label = f"{path.name}:L{line_number}"
        errors: list[str] = []

        if cli_active:
            try:
                ok, diagnostic = cli_syntax_check(source, run_id, block_label)
                if not ok:
                    errors.append(diagnostic or "mermaid-cli reported a syntax error")
            except CLIUnavailable as exc:
                logger.warning(
                    f"Mermaid CLI unavailable mid-run; falling back to regex "
                    f"check for remaining blocks in {path.name}: {exc}",
                    extra={"context": {"path": str(path),
                                       "block_label": block_label,
                                       "reason": str(exc)}},
                )
                cli_active = False
                errors = regex_syntax_check(source)
        else:
            errors = regex_syntax_check(source)

        if errors:
            error_count += 1
            for err in errors:
                logger.error(
                    f"Mermaid syntax error in {block_label}: {err}",
                    extra={"context": {"path": str(path), "kind": kind,
                                       "block_index": index,
                                       "block_label": block_label,
                                       "line_number": line_number,
                                       "error": err}},
                )
        else:
            logger.debug(
                f"OK: {block_label} (block {index}/{block_count})",
                extra={"context": {"path": str(path), "kind": kind,
                                   "block_index": index,
                                   "block_label": block_label,
                                   "line_number": line_number,
                                   "validator": "cli" if cli_active else "regex"}},
            )

    # Per-file summary as a JSON line. The json.dumps/loads roundtrip
    # asserts the record is JSON-encodable (catches accidental
    # non-serializable types in the context).
    summary = {
        "path": str(path),
        "kind": kind,
        "block_count": block_count,
        "error_count": error_count,
        "validator": "cli" if cli_active else "regex",
        "run_id": run_id,
    }
    logger.info(
        f"{path.name}: {block_count} blocks, {error_count} with errors",
        extra={"context": {"summary": json.loads(json.dumps(summary))}},
    )
    return (error_count, block_count)


# === CLI entry point =======================================================


def _build_arg_parser() -> argparse.ArgumentParser:
    """Construct the argparse parser used by :func:`main`."""
    parser = argparse.ArgumentParser(
        prog="render_diagrams.py",
        description=(
            "Validate Mermaid diagram syntax in acceleration-report.md "
            "and executive-presentation.html. Optional pre-flight check; "
            "uses Mermaid CLI if available, regex fallback otherwise."
        ),
    )
    parser.add_argument(
        "--report",
        type=Path,
        default=ACCELERATION_REPORT_PATH,
        help=(
            "Path to the analytical report Markdown file. "
            f"Default: {ACCELERATION_REPORT_PATH}"
        ),
    )
    parser.add_argument(
        "--deck",
        type=Path,
        default=EXECUTIVE_PRESENTATION_PATH,
        help=(
            "Path to the executive presentation HTML deck. "
            f"Default: {EXECUTIVE_PRESENTATION_PATH}"
        ),
    )
    parser.add_argument(
        "--no-cli",
        action="store_true",
        help="Skip Mermaid CLI detection; use regex fallback exclusively.",
    )
    parser.add_argument(
        "--skip-report",
        action="store_true",
        help=("Do not validate the Markdown report surface. Use only when "
              "intentionally validating the deck in isolation; the AAP "
              "Visual Architecture rule normally requires both surfaces."),
    )
    parser.add_argument(
        "--skip-deck",
        action="store_true",
        help=("Do not validate the HTML deck surface. Use only when "
              "intentionally validating the report in isolation; the AAP "
              "Visual Architecture rule normally requires both surfaces."),
    )
    parser.add_argument(
        "--allow-missing-source",
        action="store_true",
        help=("Downgrade a missing requested source file from an exit-2 "
              "blocker to a warning. For dry runs only; production builds "
              "MUST validate both surfaces."),
    )
    parser.add_argument(
        "--allow-zero-blocks",
        action="store_true",
        help=("Downgrade a requested surface with zero Mermaid blocks "
              "from an exit-2 blocker to a warning. For dry runs only; "
              "production builds MUST contain the diagrams the AAP "
              "Visual Architecture rule requires per surface."),
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    """CLI entry point for ``render_diagrams.py``.

    Validates Mermaid blocks in the report and deck, logs every result,
    and returns an exit code reflecting the overall verdict.

    Exit code semantics (Review Finding 1 / Finding 2):
      * 0 — every requested surface exists, has ≥ the per-surface
            Mermaid block floor (``MIN_MERMAID_BLOCKS_MARKDOWN`` /
            ``MIN_MERMAID_BLOCKS_HTML``), and every block passed syntax
            validation.
      * 1 — at least one block has a syntax error.
      * 2 — at least one requested source file is missing OR a present
            file contains fewer Mermaid blocks than the per-surface
            floor. Previously this code path only fired when BOTH files
            were missing; the AAP §0.7.1 Visual Architecture rule
            requires that every requested surface carry the diagrams
            it claims to carry.

    Args:
        argv: Optional argv tail (excluding program name). When ``None``,
            ``sys.argv[1:]`` is used.

    Returns:
        Exit code per the table above.
    """
    parser = _build_arg_parser()
    args = parser.parse_args(argv)

    # BLITZY_RUN_ID env var resolution. We read it here only to log its
    # presence; the canonical resolution happens inside get_or_create_run_id()
    # so this script uses the same run_id as every other script in the run.
    env_run_id = os.environ.get("BLITZY_RUN_ID", "").strip()
    run_id = get_or_create_run_id()
    logger: logging.Logger = structured_logger(
        metric_id=None, phase="render_diagrams",
    )
    logger.log(
        logging.INFO,
        "render_diagrams.py starting",
        extra={"context": {"run_id": run_id,
                           "env_run_id_present": bool(env_run_id),
                           "report": str(args.report),
                           "deck": str(args.deck),
                           "no_cli": bool(args.no_cli),
                           "skip_report": bool(args.skip_report),
                           "skip_deck": bool(args.skip_deck),
                           "allow_zero_blocks": bool(args.allow_zero_blocks)}},
    )

    use_cli = (not args.no_cli) and detect_cli_availability()
    if not use_cli:
        if args.no_cli:
            reason = "user requested --no-cli; using regex fallback"
        else:
            reason = (
                "Mermaid CLI unavailable on PATH (install with "
                "'npm install -g @mermaid-js/mermaid-cli' or ensure 'npx' "
                "is available); using regex fallback"
            )
        logger.warning(
            reason,
            extra={"context": {"cli_available": False,
                               "no_cli_flag": bool(args.no_cli)}},
        )
    else:
        logger.info(
            "Mermaid CLI detected; using CLI as primary validator",
            extra={"context": {"cli_available": True}},
        )

    # Per-surface validation accumulator. Each entry stores:
    #   - requested: was this surface part of the requested validation set?
    #   - present:   does the file exist on disk?
    #   - blocks:    count of Mermaid blocks discovered (0 if absent)
    #   - errors:    count of syntax errors detected (0 if absent)
    #   - min:       per-surface block floor
    #   - status:    one of "ok", "missing_file", "below_min_blocks", "errors"
    per_surface: dict[str, dict] = {
        "report": {
            "requested": not args.skip_report,
            "path": args.report,
            "kind": "markdown",
            "min": MIN_MERMAID_BLOCKS_MARKDOWN,
            "present": False,
            "blocks": 0,
            "errors": 0,
            "status": "skipped",
        },
        "deck": {
            "requested": not args.skip_deck,
            "path": args.deck,
            "kind": "html",
            "min": MIN_MERMAID_BLOCKS_HTML,
            "present": False,
            "blocks": 0,
            "errors": 0,
            "status": "skipped",
        },
    }

    for surface_name, surface in per_surface.items():
        if not surface["requested"]:
            logger.info(
                f"Skipping {surface_name} ({surface['path']}) per --skip flag",
                extra={"context": {"surface": surface_name,
                                   "path": str(surface["path"])}},
            )
            continue
        path: Path = surface["path"]
        kind: str = surface["kind"]
        if not path.is_file():
            surface["status"] = "missing_file"
            logger.error(
                f"{surface_name} file not found: {path}",
                extra={"context": {"surface": surface_name,
                                   "missing": str(path),
                                   "kind": kind}},
            )
            continue
        surface["present"] = True
        errors, blocks = validate_file(path, kind, run_id, use_cli)
        surface["blocks"] = blocks
        surface["errors"] = errors
        if blocks < surface["min"] and not args.allow_zero_blocks:
            surface["status"] = "below_min_blocks"
            logger.error(
                f"{surface_name} contains {blocks} Mermaid block(s); "
                f"per-surface minimum is {surface['min']}",
                extra={"context": {"surface": surface_name,
                                   "path": str(path),
                                   "blocks": blocks,
                                   "min": surface["min"]}},
            )
        elif errors > 0:
            surface["status"] = "errors"
        else:
            surface["status"] = "ok"

    total_blocks = sum(s["blocks"] for s in per_surface.values())
    total_errors = sum(s["errors"] for s in per_surface.values())
    requested_surfaces = [n for n, s in per_surface.items() if s["requested"]]
    missing_surfaces = [n for n, s in per_surface.items()
                        if s["requested"] and s["status"] == "missing_file"]
    below_min_surfaces = [n for n, s in per_surface.items()
                          if s["requested"] and s["status"] == "below_min_blocks"]

    logger.info(
        f"render_diagrams.py complete: {total_blocks} blocks checked, "
        f"{total_errors} errors across {len(requested_surfaces)} requested "
        f"surface(s) ({', '.join(requested_surfaces)})",
        extra={"context": {"total_blocks": total_blocks,
                           "total_errors": total_errors,
                           "requested_surfaces": requested_surfaces,
                           "missing_surfaces": missing_surfaces,
                           "below_min_surfaces": below_min_surfaces,
                           "per_surface": {
                               n: {"blocks": s["blocks"],
                                   "errors": s["errors"],
                                   "status": s["status"]}
                               for n, s in per_surface.items()
                           },
                           "validator": "cli" if use_cli else "regex"}},
    )

    # Exit code semantics (Review Finding 1 / Finding 2):
    #
    # * 2 — when ANY requested surface is missing on disk OR present
    #       but contains fewer than its per-surface Mermaid block floor.
    #       Previously this code only fired when BOTH files were
    #       missing; the AAP Visual Architecture rule requires per-
    #       surface diagram presence.
    # * 1 — when at least one Mermaid block has a syntax error.
    # * 0 — every requested surface validated cleanly.
    #
    # The ``--allow-missing-source`` and ``--allow-zero-blocks`` flags
    # are dry-run escape hatches; when set, the corresponding gate
    # downgrades from error to warning and the surface is not counted
    # toward the exit-2 condition.

    if missing_surfaces and not args.allow_missing_source:
        return 2
    if below_min_surfaces:  # already gated by allow_zero_blocks above
        return 2
    if total_errors > 0:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
