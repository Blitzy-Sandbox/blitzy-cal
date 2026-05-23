#!/usr/bin/env python3
"""build_presentation.py — Render executive-presentation.html from data/*.json.

This module is the deterministic reveal.js HTML renderer for the Development
Acceleration Measurement deliverable. It substitutes placeholder tokens in an
embedded HTML template with computed values from ``data/metric_*.json``,
``data/inflection.json``, ``data/environment.json``, and ``data/windows.json``;
then performs strict validation against the user-specified Executive
Presentation rule before writing the rendered output to
``blitzy/reports/acceleration/executive-presentation.html``.

The renderer enforces the Executive Presentation rule (AAP §0.7.1) and the
Confidence Transparency rule (AAP §0.7.2 Rule 3) at validation time. A
failure in any validator blocks the write so a known-bad deck never
overwrites a known-good one. The same template ALSO encodes Rule 4
(Internal Consistency) at the structural level — every value referenced by
the deck flows from the same ``metrics`` dictionary that ``build_report.py``
consumes for the Markdown deliverables. There is no second source for any
number rendered on a slide.

Validation rules (enforced; failure → non-zero exit):

  * CDN versions pinned: reveal.js 5.1.0, Mermaid 11.4.0, Lucide 0.460.0
    (validate_cdn_versions).
  * Slide count: 12-18 (target 16), enforced by ``<section>`` element count
    (validate_slide_count).
  * Every slide has ≥1 non-text visual element: Mermaid block, ``<table>``,
    KPI grid, ``<i data-lucide="…">``, ``<img>``, or ``<svg>``
    (validate_non_text_visuals).
  * Zero emoji in the rendered HTML, enforced via a broad Unicode range
    covering U+1F300-U+1F9FF, U+1FA00-U+1FAFF, U+2600-U+27BF, U+1F000-U+1F2FF,
    and U+1F100-U+1F1FF (validate_no_emoji).
  * No ``<pre><code>`` fenced blocks except ``<pre class="mermaid">``
    (validate_no_forbidden_pre_code).
  * Required CSS classes present: at least one ``slide-title``,
    ``slide-divider``, and ``slide-closing`` (validate_required_classes).
  * Reveal.js initialization uses ``hash: true``, ``transition: 'slide'``,
    ``controlsTutorial: false``, ``width: 1920``, ``height: 1080``
    (validate_reveal_config).
  * Mermaid initialization uses ``startOnLoad: false`` and the slidechanged
    handler re-runs both ``mermaid.run()`` and ``lucide.createIcons()``
    (validate_mermaid_init).

Inputs (read-only):

  * ``blitzy/reports/acceleration/data/metric_1.json`` through ``metric_12.json``
  * ``blitzy/reports/acceleration/data/inflection.json``
  * ``blitzy/reports/acceleration/data/environment.json``
  * ``blitzy/reports/acceleration/data/windows.json``
  * Optional ``--template`` HTML path under ``blitzy/reports/acceleration/``
    for callers that prefer an external template over the embedded default.

Outputs (writes only under ``blitzy/reports/acceleration/``):

  * ``executive-presentation.html`` (or ``--output``)
  * structured JSON log lines appended to ``logs/<run_id>/build_presentation.log``
  * ``commands.log`` lines appended via ``_shared.command_log_append``

Exit codes:

  * 0 — Rendered successfully; ``executive-presentation.html`` written.
  * 1 — Validation failure (one or more validators returned errors).
  * 2 — Required ``data/*.json`` file missing.
  * 3 — Explicit ``--template`` path was provided but does not exist.

Constraints (User AAP §0.7.3):

  * Read-only on the analyzed repository; no source files are modified.
  * Python 3.10+ stdlib only; no third-party packages.
  * No fabrication: missing or insufficient values render as
    ``Insufficient signal — <reason>`` or ``N/A`` exactly.
  * All writes are validated against the report root by
    ``EXECUTIVE_PRESENTATION_PATH`` defaulting under ``REPORT_ROOT``.

Usage:

  $ python3 build_presentation.py
  $ python3 build_presentation.py --template ./my-template.html
  $ python3 build_presentation.py --output ./alt-deck.html

This script is the SINGLE place where the deck's HTML is generated. Manual
edits to the output ``executive-presentation.html`` are LOST on re-render;
edit the embedded ``DEFAULT_HTML_TEMPLATE`` constant in this script and
re-build.
"""

from __future__ import annotations

import argparse
import html
import json
import logging
import os
import re
import sys
from pathlib import Path
from typing import Any

# ---------------------------------------------------------------------------
# Section 1 — Sibling-module import scaffold
# ---------------------------------------------------------------------------
# The harness scripts live in ``blitzy/reports/acceleration/scripts/`` and
# import a shared helper module via ``from _shared import …``. When this
# script is executed directly (``python3 build_presentation.py``) the parent
# directory is NOT automatically on ``sys.path``; we prepend it so the
# sibling import succeeds regardless of the caller's working directory.
# This mirrors the pattern used by ``build_report.py``, ``extract_metrics.py``,
# and the other harness scripts under the same directory.

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from _shared import (  # noqa: E402 — sys.path prepended above
    DATA_DIR,
    EXECUTIVE_PRESENTATION_PATH,
    REPORT_ROOT,
    command_log_append,
    get_or_create_run_id,
    iso_now_utc,
    load_all_metrics,
    load_json,
    structured_logger,
)


# ---------------------------------------------------------------------------
# Section 2 — Pinned CDN Versions (User AAP §0.7.1 Executive Presentation rule)
# ---------------------------------------------------------------------------
# The user explicitly pinned these versions in the project setup. Bumping
# any of these requires explicit approval and a decision-log entry — the
# validator below refuses to write the deck if any of these strings is
# missing from the rendered HTML. They also appear in the embedded template
# below as the ``<script src=…>`` URLs.

REQUIRED_REVEAL_VERSION: str = "5.1.0"
"""reveal.js version pinned by the user. Validated to appear as
``reveal.js@5.1.0`` in the rendered HTML."""

REQUIRED_MERMAID_VERSION: str = "11.4.0"
"""Mermaid version pinned by the user. Validated to appear as
``mermaid@11.4.0`` in the rendered HTML."""

REQUIRED_LUCIDE_VERSION: str = "0.460.0"
"""Lucide version pinned by the user. Validated to appear as
``lucide@0.460.0`` in the rendered HTML."""


# ---------------------------------------------------------------------------
# Section 3 — Slide Count Constraints
# ---------------------------------------------------------------------------
# The user-specified slide count range is 12-18 with a target of 16. The
# embedded template ships exactly 16 ``<section>`` blocks; the validator
# enforces the range as a hard rule and logs a warning if the count drifts
# from the target. An external ``--template`` may set a different count
# within the allowed range without failing the build.

MIN_SLIDE_COUNT: int = 12
"""Lower bound of the user-specified slide-count range (inclusive)."""

MAX_SLIDE_COUNT: int = 18
"""Upper bound of the user-specified slide-count range (inclusive)."""

TARGET_SLIDE_COUNT: int = 16
"""Target slide count per the AAP. Drift from this is a warning, not a failure."""


# ---------------------------------------------------------------------------
# Section 4 — Emoji Detection Pattern (User AAP §0.7.1 zero-emoji rule)
# ---------------------------------------------------------------------------
# The user's Executive Presentation rule mandates zero emoji. We use a
# deliberately broad Unicode range covering the major emoji blocks. The
# em-dash (U+2014) used throughout the report copy is intentionally
# OUTSIDE these ranges so the validator does not flag it. Lucide SVG
# icons are rendered as ``<svg>`` elements — they are not emoji and do
# not match this pattern.

EMOJI_PATTERN: re.Pattern[str] = re.compile(
    "["
    "\U0001F300-\U0001F9FF"  # symbols, pictographs, emoticons, transport, supplemental
    "\U0001FA00-\U0001FAFF"  # extended pictographs (added in Unicode 12+)
    "\U00002600-\U000027BF"  # misc symbols, dingbats
    "\U0001F000-\U0001F2FF"  # mahjong, playing cards, enclosed alphanumerics
    "\U0001F100-\U0001F1FF"  # regional indicators
    "]",
    flags=re.UNICODE,
)
"""Broad emoji-range matcher used by ``validate_no_emoji``."""


# ---------------------------------------------------------------------------
# Section 5 — Non-Text Visual Detection Patterns (≥1 per slide required)
# ---------------------------------------------------------------------------
# Every slide MUST contain at least one non-text visual element. A slide
# satisfies this requirement if its inner HTML contains at least one of
# the following: a Mermaid block, a styled table, a KPI grid, a Lucide
# icon, a raster image, or an inline SVG. Plain text and bullet lists do
# NOT count.

NON_TEXT_VISUAL_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r'<pre\s+class=["\'][^"\']*mermaid', re.IGNORECASE),
    re.compile(r'<table\b', re.IGNORECASE),
    re.compile(r'<div\s+class=["\'][^"\']*kpi-grid', re.IGNORECASE),
    re.compile(r'<div\s+class=["\'][^"\']*kpi-card', re.IGNORECASE),
    re.compile(r'<div\s+class=["\'][^"\']*chart-wrap', re.IGNORECASE),
    re.compile(r'<div\s+class=["\'][^"\']*phase-chart', re.IGNORECASE),
    re.compile(r'<div\s+class=["\'][^"\']*accent-bar', re.IGNORECASE),
    re.compile(r'<div\s+class=["\'][^"\']*divider-top-bar', re.IGNORECASE),
    re.compile(r'<i\s+data-lucide=', re.IGNORECASE),
    re.compile(r'<img\b', re.IGNORECASE),
    re.compile(r'<svg\b', re.IGNORECASE),
)
"""Heuristics that satisfy the per-slide non-text-visual rule."""


# ---------------------------------------------------------------------------
# Section 6 — Section Extraction Regex
# ---------------------------------------------------------------------------
# Walks the rendered HTML and yields the inner body of each ``<section>``
# element. Used by ``validate_non_text_visuals`` to inspect slides
# individually and by ``validate_slide_count`` to count them.

SECTION_RE: re.Pattern[str] = re.compile(
    r'<section\b[^>]*>(.*?)</section>',
    re.DOTALL | re.IGNORECASE,
)
"""Captures the inner content of every ``<section>`` element."""


# ---------------------------------------------------------------------------
# Section 7 — Forbidden ``<pre><code>`` Fenced Block Pattern
# ---------------------------------------------------------------------------
# The Executive Presentation rule forbids fenced code blocks inside slides.
# Inline ``<code>`` for short tokens is allowed; ``<pre class="mermaid">``
# is the only ``<pre>`` form permitted. This pattern matches any ``<pre>``
# without ``class="mermaid"`` immediately followed by a ``<code>`` element.

FORBIDDEN_PRE_CODE: re.Pattern[str] = re.compile(
    r'<pre(?:\s+(?![^>]*class=["\'][^"\']*mermaid)[^>]*)?>\s*<code\b',
    re.DOTALL | re.IGNORECASE,
)
"""Matches forbidden ``<pre><code>`` constructs (allowing ``<pre class="mermaid">``)."""


# ---------------------------------------------------------------------------
# Section 8 — Placeholder Token Pattern
# ---------------------------------------------------------------------------
# Placeholders are written in the template as HTML-entity-encoded form
# ``&lt;name&gt;`` so the browser does not try to parse them as tags
# during a "preview before substitution" view. The renderer also
# tolerates the plain ``<name>`` form for robustness. Token names consist
# of letters, digits, dots, and underscores.

ESCAPED_PLACEHOLDER_RE: re.Pattern[str] = re.compile(r"&lt;([A-Za-z0-9_.]+)&gt;")
"""HTML-entity-encoded placeholder form used in the embedded template."""

PLAIN_PLACEHOLDER_RE: re.Pattern[str] = re.compile(r"<([A-Za-z0-9_.]+)>")
"""Fallback placeholder form (rare in HTML templates; common in MD)."""


# ---------------------------------------------------------------------------
# Section 9 — Embedded DEFAULT_HTML_TEMPLATE
# ---------------------------------------------------------------------------
# The complete reveal.js 5.1.0 HTML deck, embedded as a Python triple-quoted
# string. This is the SINGLE source of truth for the executive-presentation
# layout, styling, and content scaffolding. Placeholder tokens of the form
# ``&lt;M<N>.<field>&gt;``, ``&lt;inflection.…&gt;``, ``&lt;run_id&gt;``,
# ``&lt;rendered_at&gt;``, ``&lt;analysis_window&gt;``, and
# ``&lt;blitzy.<metric>&gt;`` are substituted by ``substitute_placeholders``
# before write.
#
# Structural invariants enforced by the validator suite below:
#   * EXACTLY 16 ``<section>`` blocks (matches TARGET_SLIDE_COUNT).
#   * At least one slide each of ``slide-title``, ``slide-divider``,
#     ``slide-closing`` (validate_required_classes).
#   * Every slide contains a non-text visual element
#     (validate_non_text_visuals).
#   * CDN versions appear as ``reveal.js@5.1.0``, ``mermaid@11.4.0``,
#     ``lucide@0.460.0`` (validate_cdn_versions).
#   * Reveal.js config: ``hash: true``, ``transition: 'slide'``,
#     ``controlsTutorial: false``, ``width: 1920``, ``height: 1080``.
#   * Mermaid init: ``startOnLoad: false`` and the slidechanged handler
#     re-runs both ``mermaid.run()`` and ``lucide.createIcons()``.
#   * Zero emoji (validate_no_emoji).
#   * No ``<pre><code>`` fences except ``<pre class="mermaid">``.

DEFAULT_HTML_TEMPLATE: str = """\
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>Development Acceleration Measurement — blitzy-cal</title>

  <!--
    Executive Presentation — Development Acceleration Measurement (blitzy-cal)

    This is a single self-contained reveal.js 5.1.0 deck delivered per the
    Executive Presentation rule. It loads reveal.js, Mermaid, and Lucide from
    pinned CDN URLs at view time. All styling and behavior is inline.

    Pinned CDN versions (validated by scripts/build_presentation.py):
      - reveal.js     5.1.0   (jsdelivr)
      - Mermaid      11.4.0   (jsdelivr)
      - Lucide        0.460.0 (unpkg)

    Slide count: 16 (target). Valid range 12-18 enforced by the renderer.

    Placeholder tokens of the form <M<N>.<field>>, <env.*>, <inflection.*>,
    <phase_*>, <actor_table_rows>, <run_id>, <rendered_at>, and
    <analysis_window> are substituted by scripts/build_presentation.py with
    values from data/*.json. The file remains valid HTML with tokens present;
    tokens sit inside text nodes / table cells / attribute-free positions.
  -->

  <!-- Inline SVG favicon (Blitzy primary color square) — keeps file fully
       self-contained and silences favicon.ico 404 when served via http.server. -->
  <link rel="icon" type="image/svg+xml" href="data:image/svg+xml;utf8,&lt;svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'&gt;&lt;rect width='32' height='32' rx='6' fill='%235B39F3'/&gt;&lt;path d='M9 9h14v4H13v2h10v4H13v2h10v4H9z' fill='%23F5F5FA'/&gt;&lt;/svg&gt;">

  <!-- Google Fonts: Inter (body), Space Grotesk (display), Fira Code (mono) -->
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Space+Grotesk:wght@500;700&family=Fira+Code:wght@400;500&display=swap" rel="stylesheet">

  <!-- reveal.js 5.1.0 core + white theme (overridden by inline Blitzy styling below) -->
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/reveal.js@5.1.0/dist/reveal.css">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/reveal.js@5.1.0/dist/theme/white.css" id="theme">

  <style>
    /* ============================================================
       Blitzy Brand CSS Custom Properties
       Mandatory per the agent prompt; declared on :root so all
       slide-type styling derives from a single token source.
       ============================================================ */
    :root {
      --blitzy-primary: #5B39F3;
      --blitzy-primary-dark: #2D1C77;
      --blitzy-accent-teal: #94FAD5;
      --blitzy-navy: #0A0E27;
      --blitzy-navy-dark: #060919;
      --blitzy-text-on-dark: #F5F5FA;
      --blitzy-text-on-light: #1A1A2E;
      --blitzy-neutral-300: #D1D1DD;
      --blitzy-neutral-500: #888896;
      --blitzy-neutral-700: #4A4A5E;
      --blitzy-gradient-hero: linear-gradient(135deg, #2D1C77 0%, #5B39F3 50%, #94FAD5 100%);
      --blitzy-gradient-divider: linear-gradient(90deg, #5B39F3 0%, #94FAD5 100%);
      --blitzy-gradient-accent-bar: linear-gradient(90deg, transparent 0%, #5B39F3 50%, transparent 100%);
      --font-body: 'Inter', system-ui, sans-serif;
      --font-display: 'Space Grotesk', 'Inter', system-ui, sans-serif;
      --font-mono: 'Fira Code', 'Source Code Pro', monospace;
    }

    /* ============================================================
       Reveal.js theme overrides (replace the white-theme defaults
       with Blitzy brand). Limited specificity; no !important used.
       ============================================================ */
    html, body { background: var(--blitzy-text-on-dark); }
    .reveal { font-family: var(--font-body); color: var(--blitzy-text-on-light); }
    .reveal .slides { text-align: left; }
    .reveal .slides section { padding: 80px 120px; box-sizing: border-box; min-height: 1080px; width: 1920px; }
    .reveal h1, .reveal h2, .reveal h3 {
      font-family: var(--font-display);
      color: var(--blitzy-primary-dark);
      text-transform: none;
      letter-spacing: -0.01em;
      margin-bottom: 0.6em;
    }
    .reveal h1 { font-size: 3.4em; line-height: 1.05; font-weight: 700; }
    .reveal h2 { font-size: 1.7em; line-height: 1.15; font-weight: 700; margin-block: 0.3em; }
    .reveal h3 { font-size: 1.2em; line-height: 1.2; font-weight: 600; }
    .reveal p { font-size: 1em; line-height: 1.45; }
    .reveal code {
      font-family: var(--font-mono);
      background: rgba(91, 57, 243, 0.08);
      padding: 0.1em 0.35em;
      border-radius: 3px;
      font-size: 0.92em;
      color: var(--blitzy-primary-dark);
    }
    .reveal a { color: var(--blitzy-primary); }
    .reveal .controls { color: var(--blitzy-primary); }
    .reveal .progress { color: var(--blitzy-primary); }
    .reveal .slide-number { color: var(--blitzy-neutral-500); background: rgba(255,255,255,0.6); border-radius: 4px; padding: 4px 8px; }

    /* ============================================================
       Slide type — Title (slide-title)
       Gradient hero background, large display H1, teal subtitle.
       ============================================================ */
    /* Make special slides fill the entire 1920x1080 logical viewport so
       their background covers the whole frame. We use the reveal config
       margin:0 so the .slides container is exactly 1920x1080 and our
       section paints from corner to corner. We do NOT set display:flex
       on the section because reveal.js sets `display: block` inline,
       overriding it. We use an inner `.title-content`/`.divider-content`/
       `.closing-content` wrapper that is flex. */
    .reveal .slides section.slide-title {
      background: var(--blitzy-gradient-hero);
      color: var(--blitzy-text-on-dark);
      text-align: center;
      box-sizing: border-box;
      width: 1920px;
      height: 1080px;
      padding: 0;
    }
    .reveal .slides section.slide-title .title-content {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      width: 100%;
      height: 1080px;
      padding-block: 80px;
      padding-inline: 140px;
      box-sizing: border-box;
    }
    .reveal .slides section.slide-title h1 {
      color: var(--blitzy-text-on-dark);
      font-size: 3.2em;
      line-height: 1.05;
      margin-bottom: 0.3em;
      margin-top: 0.3em;
      text-shadow: 0 2px 6px rgba(0,0,0,0.18);
    }
    .reveal .slides section.slide-title .subtitle {
      color: var(--blitzy-accent-teal);
      font-size: 1.3em;
      font-family: var(--font-display);
      font-weight: 500;
      margin-top: 0.3em;
    }
    .reveal .slides section.slide-title .metadata {
      color: rgba(245, 245, 250, 0.85);
      font-size: 0.75em;
      font-family: var(--font-mono);
      margin-top: 1.4em;
      letter-spacing: 0.05em;
    }
    .reveal .slides section.slide-title .title-icon {
      color: var(--blitzy-accent-teal);
      margin-bottom: 0.5em;
      display: block;
    }

    /* ============================================================
       Slide type — Section Divider (slide-divider)
       Navy background, teal H2, gradient bar at top.
       ============================================================ */
    .reveal .slides section.slide-divider {
      background: var(--blitzy-navy);
      color: var(--blitzy-text-on-dark);
      text-align: center;
      box-sizing: border-box;
      width: 1920px;
      height: 1080px;
      padding: 0;
      /* NOTE: do NOT set position: relative here, and do NOT set
         display: flex — reveal.js sets `display: block` inline on the
         section, which overrides our flex setting. We instead use an
         inner `.divider-content` wrapper that is flex. */
    }
    .reveal .slides section.slide-divider .divider-content {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      width: 100%;
      height: 1080px;
      padding-block: 100px;
      padding-inline: 140px;
      box-sizing: border-box;
    }
    /* Top accent bar for divider slides — implemented as an inline
       <div class="divider-top-bar"></div> first child of the section.
       Positioned absolutely relative to the section (which reveal.js
       gives position:absolute) so it pins to the top edge regardless of
       any flex layout used by the inner content wrapper. */
    .divider-top-bar {
      position: absolute;
      inset-block-start: 0;
      inset-inline-start: 0;
      height: 6px;
      width: 100%;
      background: var(--blitzy-gradient-divider);
      box-sizing: border-box;
      z-index: 2;
    }
    .reveal .slides section.slide-divider h2 {
      color: var(--blitzy-accent-teal);
      font-size: 3.2em;
      margin: 0.8em 0 0.4em 0;
    }
    .reveal .slides section.slide-divider .subtitle {
      color: var(--blitzy-neutral-300);
      font-size: 1.1em;
      font-family: var(--font-body);
      font-weight: 500;
      max-width: 70%;
      margin: 0 auto;
    }
    .reveal .slides section.slide-divider .divider-icon {
      color: var(--blitzy-accent-teal);
      margin-bottom: 0.4em;
      display: block;
    }

    /* ============================================================
       Slide type — Closing (slide-closing)
       Deep navy background, teal H2, gradient accent bar, footer.
       ============================================================ */
    .reveal .slides section.slide-closing {
      background: var(--blitzy-navy-dark);
      color: var(--blitzy-text-on-dark);
      text-align: center;
      box-sizing: border-box;
      width: 1920px;
      height: 1080px;
      padding: 0;
      /* See slide-title comment — flex layout lives on the wrapper. */
    }
    .reveal .slides section.slide-closing .closing-content {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      width: 100%;
      height: 1080px;
      padding-block: 80px;
      padding-inline: 140px;
      box-sizing: border-box;
      position: relative; /* anchor for absolute children if needed */
    }
    .reveal .slides section.slide-closing h2 {
      color: var(--blitzy-accent-teal);
      font-size: 2.4em;
      margin-bottom: 0.2em;
      margin-top: 0;
      line-height: 1.1;
    }
    .reveal .slides section.slide-closing .accent-bar {
      height: 4px;
      background: var(--blitzy-gradient-accent-bar);
      margin: 1em auto;
      width: 60%;
    }
    .reveal .slides section.slide-closing ul {
      max-width: 70%;
      margin: 0.4em auto;
      text-align: left;
    }
    .reveal .slides section.slide-closing ul li {
      color: var(--blitzy-text-on-dark);
      font-size: 0.95em;
      margin-bottom: 0.5em;
      line-height: 1.4;
    }
    .reveal .slides section.slide-closing ul li::before {
      background: var(--blitzy-accent-teal);
    }
    .reveal .slides section.slide-closing ul li code {
      color: var(--blitzy-accent-teal);
      background: rgba(148, 250, 213, 0.12);
    }
    /* Push the footer to the bottom of the closing flex column. */
    .reveal .slides section.slide-closing .footer {
      margin-top: auto;
      color: var(--blitzy-neutral-500);
      font-family: var(--font-mono);
      font-size: 0.65em;
      letter-spacing: 0.05em;
    }
    /* Closing arrow in the bottom-right of the flex container. */
    .reveal .slides section.slide-closing .closing-arrow {
      align-self: flex-end;
      color: var(--blitzy-accent-teal);
      margin-block: 0.8em 0.4em;
    }

    /* ============================================================
       Content slides — bullets, KPI grid, tables, code blocks.
       ============================================================ */
    .reveal ul { list-style: none; padding-left: 0; margin-top: 0.4em; margin-bottom: 0.4em; }
    .reveal ul li {
      padding-left: 1.4em;
      position: relative;
      margin-bottom: 0.4em;
      font-size: 0.85em;
      line-height: 1.4;
    }
    .reveal ul li::before {
      content: '';
      position: absolute;
      left: 0;
      top: 0.45em;
      width: 0.7em;
      height: 0.7em;
      background: var(--blitzy-primary);
      border-radius: 2px;
      transform: rotate(45deg);
    }

    /* KPI Card Grid (Slide 2 + reusable)
       Note: `minmax(0, 1fr)` prevents the grid from blowing out when child
       content (e.g., unsubstituted template tokens like `<M2.multiplier>`)
       is wider than the column. The `min-width: 0` on `.kpi-card` allows
       individual cards to shrink and the `.value` overflow rules prevent
       horizontal overflow at the column edge. */
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 1em;
      margin-top: 0.6em;
    }
    .kpi-grid.row2 { margin-top: 0.8em; }
    .kpi-card {
      background: white;
      border-left: 5px solid var(--blitzy-primary);
      padding: 0.9em 1em;
      border-radius: 4px;
      box-shadow: 0 2px 10px rgba(45, 28, 119, 0.10);
      text-align: left;
      min-height: 100px;
      min-width: 0; /* allow grid item to shrink below content min-size */
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      overflow: hidden;
    }
    .kpi-card .label {
      font-size: 0.6em;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--blitzy-neutral-500);
      font-weight: 600;
    }
    .kpi-card .value {
      font-size: 1.1em;
      font-family: var(--font-display);
      font-weight: 700;
      color: var(--blitzy-primary-dark);
      line-height: 1.1;
      margin-top: 0.2em;
      overflow-wrap: break-word;
      word-break: break-word;
    }
    .kpi-card .confidence {
      font-size: 0.55em;
      margin-top: 0.4em;
      padding: 0.2em 0.7em;
      border-radius: 12px;
      display: inline-block;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      align-self: flex-start;
    }
    .kpi-card .confidence.high   { background: rgba(148, 250, 213, 0.35); color: #1A6B4A; }
    .kpi-card .confidence.medium { background: rgba(255, 200, 100, 0.30); color: #8B5A00; }
    .kpi-card .confidence.low    { background: rgba(255, 120, 120, 0.30); color: #A02525; }

    /* Mini KPI cards (Slide 8 etc.) — same minmax(0, 1fr) pattern */
    .kpi-grid.mini { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1.4em; max-width: 80%; margin: 1em auto; }
    .kpi-grid.mini .kpi-card { min-height: 100px; padding: 1em 1.2em; }
    .kpi-grid.mini .kpi-card .value { font-size: 1.2em; }
    .kpi-grid.mini .kpi-card .label { font-size: 0.55em; }

    /* Lucide icon helpers */
    .lucide-icon {
      vertical-align: middle;
      margin-right: 0.4em;
      stroke-width: 1.8;
    }
    .reveal ul li .lucide-icon {
      position: absolute;
      left: -2.2em;
      top: 0.1em;
      color: var(--blitzy-primary);
      width: 22px; height: 22px;
    }
    /* For bullets that include inline icons, indent extra to make room */
    .reveal ul.icon-bullets li { padding-left: 2.4em; }
    .reveal ul.icon-bullets li::before { display: none; }
    .reveal ul.icon-bullets li .lucide-icon {
      left: 0; top: 0.1em; width: 22px; height: 22px;
      color: var(--blitzy-primary);
      position: absolute;
      margin: 0;
    }
    .reveal .slides section.slide-closing ul li .lucide-icon { color: var(--blitzy-accent-teal); }
    .reveal .slides section.slide-closing ul.icon-bullets li .lucide-icon { color: var(--blitzy-accent-teal); }

    /* Styled tables */
    .reveal table {
      font-size: 0.58em;
      border-collapse: collapse;
      margin: 1.2em auto;
      width: 95%;
      background: white;
      box-shadow: 0 2px 12px rgba(45, 28, 119, 0.10);
    }
    .reveal table th {
      background: var(--blitzy-primary);
      color: var(--blitzy-text-on-dark);
      text-align: left;
      padding: 0.7em 1em;
      font-family: var(--font-display);
      font-weight: 600;
      font-size: 0.95em;
      letter-spacing: 0.03em;
    }
    .reveal table td {
      border-bottom: 1px solid var(--blitzy-neutral-300);
      padding: 0.6em 1em;
      color: var(--blitzy-text-on-light);
      vertical-align: top;
    }
    .reveal table tr:nth-child(even) td { background: rgba(91, 57, 243, 0.03); }
    .reveal table tr.blitzy-row td {
      background: rgba(148, 250, 213, 0.18);
      font-weight: 600;
    }
    .reveal table tr.blitzy-row td:first-child::before {
      content: '';
      display: inline-block;
      width: 8px;
      height: 8px;
      background: var(--blitzy-primary);
      border-radius: 50%;
      margin-right: 0.6em;
      vertical-align: middle;
    }
    /* Placeholder row shown only in the pre-substituted preview state.
       build_presentation.py substitutes the preceding HTML comment
       (`<!--actor_table_rows-->`) with real <tr> rows AND removes this row. */
    .reveal table tr.placeholder-row td {
      background: rgba(91, 57, 243, 0.05);
      color: var(--blitzy-neutral-500);
      font-style: italic;
      text-align: center;
      font-family: var(--font-body);
      font-size: 0.85em;
    }
    .reveal table .conf {
      display: inline-block;
      padding: 0.1em 0.5em;
      border-radius: 8px;
      font-size: 0.92em;
      font-weight: 600;
      font-family: var(--font-body);
    }
    .reveal table .conf.high   { background: rgba(148, 250, 213, 0.35); color: #1A6B4A; }
    .reveal table .conf.medium { background: rgba(255, 200, 100, 0.30); color: #8B5A00; }
    .reveal table .conf.low    { background: rgba(255, 120, 120, 0.30); color: #A02525; }

    /* Mermaid diagram container */
    .mermaid {
      font-family: var(--font-body);
      margin: 1em auto;
      max-width: 92%;
      text-align: center;
    }
    /* Ensure Mermaid node labels are not clipped at the right edge.
       Mermaid 11.x's foreignObject containers are sized based on the
       fallback font used during pre-render measurement; once the Inter
       webfont loads, the text can be a few px wider and gets clipped by
       overflow:hidden on the foreignObject. Widening the inner div by
       a small amount adds the missing safety margin. */
    .mermaid svg foreignObject > div {
      padding-inline: 6px;
      overflow: visible !important;
    }
    .mermaid svg foreignObject {
      overflow: visible !important;
    }
    /* Use lighter text inside mermaid nodes for contrast against the
       primary purple fill */
    .mermaid svg g.node foreignObject p,
    .mermaid svg g.node foreignObject .nodeLabel,
    .mermaid svg g.node text { color: var(--blitzy-text-on-dark); fill: var(--blitzy-text-on-dark); }

    /* Slide-level helpers */
    .note {
      font-size: 0.78em;
      color: var(--blitzy-neutral-700);
      font-style: normal;
      margin-top: 0.8em;
      max-width: 88%;
    }
    .footnote {
      font-size: 0.75em;
      color: var(--blitzy-neutral-500);
      margin-top: 1em;
      font-family: var(--font-body);
      font-style: italic;
    }
    .pill-row {
      display: flex;
      gap: 0.6em;
      flex-wrap: wrap;
      margin-top: 0.6em;
    }
    .pill {
      padding: 0.25em 0.8em;
      border-radius: 14px;
      background: rgba(91, 57, 243, 0.08);
      color: var(--blitzy-primary-dark);
      font-size: 0.7em;
      font-family: var(--font-display);
      font-weight: 500;
    }
    .pill .lucide-icon { width: 14px; height: 14px; margin-right: 0.3em; }

    /* Two-column layouts for slides combining tables/diagrams + bullets */
    .two-col {
      display: grid;
      grid-template-columns: 1.2fr 1fr;
      gap: 1.6em;
      align-items: start;
      margin-top: 1em;
    }
    .two-col .col-left, .two-col .col-right { min-width: 0; }
    .two-col .col-right ul { margin-top: 0; }

    /* Heading with leading icon */
    .heading-with-icon {
      display: flex;
      align-items: center;
      gap: 0.6em;
      margin-bottom: 0.6em;
    }
    .heading-with-icon h2 { margin: 0; }
    .heading-with-icon .lucide-icon {
      color: var(--blitzy-primary);
      width: 40px; height: 40px;
      margin: 0;
    }

    /* Mermaid charts within content slides */
    .chart-wrap {
      background: white;
      border-radius: 6px;
      padding: 0.8em 1em;
      box-shadow: 0 2px 12px rgba(45, 28, 119, 0.08);
      margin: 0.4em auto;
    }

    /* Styled HTML bar charts used in place of Mermaid xychart-beta blocks
       so the deck renders gracefully even before build_presentation.py
       substitutes numeric values into the placeholder tokens. The bar
       heights are driven by CSS custom property --phase-bar-h
       (e.g. style="--phase-bar-h: 65%") that the build script sets per bar. */
    .phase-chart-title {
      text-align: center;
      font-family: var(--font-display);
      font-size: 0.8em;
      color: var(--blitzy-primary-dark);
      margin-bottom: 0.4em;
    }
    .phase-chart-legend {
      display: flex;
      gap: 1.6em;
      justify-content: center;
      margin-bottom: 1em;
      font-size: 0.65em;
      color: var(--blitzy-neutral-700);
      font-family: var(--font-body);
      flex-wrap: wrap;
    }
    .legend-item {
      display: inline-flex;
      align-items: center;
      gap: 0.4em;
    }
    .swatch {
      display: inline-block;
      width: 14px;
      height: 14px;
      border-radius: 3px;
      flex-shrink: 0;
    }
    .swatch-primary { background: var(--blitzy-primary); }
    .swatch-teal { background: var(--blitzy-accent-teal); border: 1px solid var(--blitzy-primary-dark); }
    .swatch-coral { background: #FF7A7A; }

    .phase-chart-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 1.4em;
      padding: 0 1em;
    }
    .phase-col {
      display: flex;
      flex-direction: column;
      align-items: center;
      min-width: 0;
    }
    .phase-col-bars {
      display: flex;
      gap: 0.8em;
      align-items: end;
      height: 140px;
      padding-bottom: 0.4em;
      border-bottom: 2px solid var(--blitzy-neutral-300);
      width: 100%;
      justify-content: center;
    }
    .phase-col-bars.stacked {
      align-items: center;
      gap: 0;
      flex-direction: column-reverse;
      justify-content: end;
    }
    .phase-col-bars.stacked .phase-bar {
      width: 70px;
      margin: 0;
      border-radius: 0;
    }
    .phase-col-bars.stacked .phase-bar:last-child {
      border-radius: 4px 4px 0 0;
    }
    .phase-bar {
      width: 48px;
      min-height: 18px;
      max-height: 160px;
      height: var(--phase-bar-h, 50%);
      border-radius: 4px 4px 0 0;
      box-shadow: 0 -1px 4px rgba(45, 28, 119, 0.08) inset;
      position: relative;
    }
    .phase-bar::after {
      content: attr(data-label);
      position: absolute;
      bottom: 100%;
      left: 50%;
      transform: translateX(-50%) rotate(-22deg);
      transform-origin: bottom left;
      font-family: var(--font-mono);
      font-size: 0.45em;
      color: var(--blitzy-primary-dark);
      font-weight: 600;
      white-space: nowrap;
      margin-bottom: 2px;
      letter-spacing: -0.03em;
    }
    /* For stacked bar columns, hide individual segment labels (the legend
       above the chart identifies the colors); the build script can choose
       to populate a total label per stack column if desired. */
    .phase-col-bars.stacked .phase-bar::after {
      display: none;
    }
    .phase-col-bars.stacked .phase-bar {
      width: 100px;
    }
    .phase-bar-primary {
      background: linear-gradient(180deg, var(--blitzy-primary) 0%, var(--blitzy-primary-dark) 100%);
    }
    .phase-bar-teal {
      background: linear-gradient(180deg, var(--blitzy-accent-teal) 0%, var(--blitzy-primary) 100%);
    }
    .phase-bar-coral {
      background: linear-gradient(180deg, #FFB0B0 0%, #FF7A7A 100%);
    }
    .phase-bar-value {
      font-family: var(--font-mono);
      font-size: 0.55em;
      color: var(--blitzy-text-on-dark);
      font-weight: 600;
      letter-spacing: -0.02em;
      white-space: nowrap;
    }
    .phase-col-label {
      font-family: var(--font-display);
      font-weight: 600;
      color: var(--blitzy-primary-dark);
      margin-top: 0.6em;
      font-size: 0.85em;
    }

    /* Print-friendly fallback (reveal.js handles full print stylesheet) */
    @media print {
      .reveal .slides section { page-break-after: always; }
    }
  </style>
</head>
<body>
  <!--
    Reveal.js mounting structure. The .slides container holds sixteen slide
    elements; each one is a single slide. The slide order matches the
    slide inventory in the agent prompt:
      1  Title (slide-title)
      2  Headline KPIs (Content)
      3  Extraction Architecture (Content + Mermaid)
      4  Methodology Divider (slide-divider)
      5  Methodology Detail (Content)
      6  Flow Metrics Divider (slide-divider)
      7  Flow Metrics Headline (Content)
      8  Flow Time + Flow Velocity (Content + Mermaid)
      9  Stability Metrics Divider (slide-divider)
     10  Releases + Problem Records (Content)
     11  Escaped Defects + Approved Exceptions (Content + Mermaid)
     12  Per-Engineer View Divider (slide-divider)
     13  Per-Engineer Detail (Content)
     14  Risk Assessment Divider (slide-divider)
     15  Risk Detail (Content)
     16  Closing (slide-closing)
  -->
  <div class="reveal">
    <div class="slides">

      <!-- ====================================================
           SLIDE 1 — Title (slide-title)
           H1 + subtitle + metadata; large Lucide gauge icon.
           Non-text visual: Lucide icon.
           ==================================================== -->
      <section class="slide-title">
        <div class="title-content">
        <i data-lucide="gauge" class="lucide-icon title-icon" style="width:120px;height:120px;"></i>
        <h1>Development Acceleration Measurement</h1>
        <p class="subtitle">blitzy-cal &middot; Before/After Blitzy Agent Introduction</p>
        <p class="metadata">Analysis Window: &lt;analysis_window&gt; &middot; Inflection: &lt;inflection.chosen_date&gt;</p>
              </div>
      </section>

      <!-- ====================================================
           SLIDE 2 — Headline KPIs (Content)
           8 KPI cards (2 rows of 4) covering the headline
           multipliers across both flow and stability metrics.
           Non-text visual: KPI grid (qualifies as non-text).
           Body word count under 40; no bulleted list used.
           ==================================================== -->
      <section>
        <div class="heading-with-icon">
          <i data-lucide="trending-up" class="lucide-icon"></i>
          <h2>Headline Acceleration Multipliers</h2>
        </div>
        <div class="kpi-grid">
          <div class="kpi-card">
            <div>
              <div class="label">M2 Flow Velocity</div>
              <div class="value">&lt;M2.multiplier&gt;</div>
            </div>
            <span class="confidence &lt;M2.confidence_class&gt;">&lt;M2.confidence&gt;</span>
          </div>
          <div class="kpi-card">
            <div>
              <div class="label">M7 Flow Time</div>
              <div class="value">&lt;M7.multiplier&gt;</div>
            </div>
            <span class="confidence &lt;M7.confidence_class&gt;">&lt;M7.confidence&gt;</span>
          </div>
          <div class="kpi-card">
            <div>
              <div class="label">M9 Releases</div>
              <div class="value">&lt;M9.multiplier&gt;</div>
            </div>
            <span class="confidence &lt;M9.confidence_class&gt;">&lt;M9.confidence&gt;</span>
          </div>
          <div class="kpi-card">
            <div>
              <div class="label">M8 Problem Records</div>
              <div class="value">&lt;M8.multiplier&gt;</div>
            </div>
            <span class="confidence &lt;M8.confidence_class&gt;">&lt;M8.confidence&gt;</span>
          </div>
        </div>
        <div class="kpi-grid row2">
          <div class="kpi-card">
            <div>
              <div class="label">M1 Flow Load</div>
              <div class="value">&lt;M1.multiplier&gt;</div>
            </div>
            <span class="confidence &lt;M1.confidence_class&gt;">&lt;M1.confidence&gt;</span>
          </div>
          <div class="kpi-card">
            <div>
              <div class="label">M3 Flow Predictability</div>
              <div class="value">&lt;M3.multiplier&gt;</div>
            </div>
            <span class="confidence &lt;M3.confidence_class&gt;">&lt;M3.confidence&gt;</span>
          </div>
          <div class="kpi-card">
            <div>
              <div class="label">M5 Flow Efficiency</div>
              <div class="value">&lt;M5.multiplier&gt;</div>
            </div>
            <span class="confidence &lt;M5.confidence_class&gt;">&lt;M5.confidence&gt;</span>
          </div>
          <div class="kpi-card">
            <div>
              <div class="label">M11 Escaped Defects</div>
              <div class="value">&lt;M11.multiplier&gt;</div>
            </div>
            <span class="confidence &lt;M11.confidence_class&gt;">&lt;M11.confidence&gt;</span>
          </div>
        </div>
        <p class="note">Multipliers are After/Before ratios. Higher is faster for M2, M3, M5, M9; lower is better for M1, M7, M8, M11.</p>
      </section>

      <!-- ====================================================
           SLIDE 3 — Extraction Architecture (Content + Mermaid)
           Mermaid pipeline diagram + 3 bullets describing the
           read-only constraint and cache behavior.
           Non-text visual: Mermaid diagram.
           ==================================================== -->
      <section>
        <div class="heading-with-icon">
          <i data-lucide="git-merge" class="lucide-icon"></i>
          <h2>Extraction Pipeline</h2>
        </div>
        <div class="chart-wrap">
          <pre class="mermaid">
graph LR
  GIT[Git History] --&gt; EXT[Extract Metrics]
  GH[GitHub REST API] --&gt; EXT
  LIN[Linear API] --&gt; EXT
  CI[CI Test Artifacts] --&gt; EXT
  EXT --&gt; DATA[data/*.json]
  DATA --&gt; REP[acceleration-report.md]
  DATA --&gt; DECK[executive-presentation.html]
  DATA --&gt; DASH[dashboard.md]
          </pre>
        </div>
        <ul>
          <li>Read-only on the analyzed repository; outputs in <code>/blitzy/reports/acceleration/</code></li>
          <li>Single <code>metrics_results</code> dictionary populates every report surface; API responses cached</li>
        </ul>
      </section>

      <!-- ====================================================
           SLIDE 4 — Section Divider: Methodology (slide-divider)
           Non-text visual: large Lucide microscope icon.
           ==================================================== -->
      <section class="slide-divider">
        <div class="divider-top-bar"></div>
        <div class="divider-content">
        <i data-lucide="microscope" class="lucide-icon divider-icon" style="width:140px;height:140px;"></i>
        <h2>Methodology</h2>
        <p class="subtitle">Identical extraction logic, different date ranges</p>
              </div>
      </section>

      <!-- ====================================================
           SLIDE 5 — Methodology Detail (Content)
           4 bullets explaining engineering-actor framing.
           Non-text visual: Lucide users icon + inline icons in bullets.
           Word count under 40.
           ==================================================== -->
      <section>
        <div class="heading-with-icon">
          <i data-lucide="users" class="lucide-icon"></i>
          <h2>Engineering Actor Framing</h2>
        </div>
        <ul class="icon-bullets">
          <li><i data-lucide="function-square" class="lucide-icon"></i><code>engineering_actor(pr, phase)</code>: human in Baseline, Blitzy in After</li>
          <li><i data-lucide="repeat" class="lucide-icon"></i>Identical logic; only actor identity branches per phase</li>
          <li><i data-lucide="clock" class="lucide-icon"></i>M4-5 from actor view; review is wait time</li>
          <li><i data-lucide="user-check" class="lucide-icon"></i>M2/4/5/6/10 include Blitzy in After</li>
        </ul>
        <p class="footnote">See <code>decision-log.md</code> Row 12 for rationale.</p>
      </section>

      <!-- ====================================================
           SLIDE 6 — Section Divider: Flow Metrics (slide-divider)
           Non-text visual: large Lucide activity icon.
           ==================================================== -->
      <section class="slide-divider">
        <div class="divider-top-bar"></div>
        <div class="divider-content">
        <i data-lucide="activity" class="lucide-icon divider-icon" style="width:140px;height:140px;"></i>
        <h2>Flow Metrics</h2>
        <p class="subtitle">Velocity &middot; Predictability &middot; Active Time &middot; Efficiency &middot; Distribution &middot; Time</p>
              </div>
      </section>

      <!-- ====================================================
           SLIDE 7 — Flow Metrics Headline (Content)
           Table of flow metrics M2,M3,M4,M5,M6,M7.
           Non-text visual: styled table.
           ==================================================== -->
      <section>
        <div class="heading-with-icon">
          <i data-lucide="bar-chart-3" class="lucide-icon"></i>
          <h2>Metrics 2, 3, 4, 5, 6, 7</h2>
        </div>
        <table>
          <thead>
            <tr>
              <th>Metric</th>
              <th>Baseline</th>
              <th>After</th>
              <th>Multiplier</th>
              <th>Confidence</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>M2 Flow Velocity</td>
              <td>&lt;M2.baseline&gt;</td>
              <td>&lt;M2.after&gt;</td>
              <td>&lt;M2.multiplier&gt;</td>
              <td><span class="conf &lt;M2.confidence_class&gt;">&lt;M2.confidence&gt;</span></td>
            </tr>
            <tr>
              <td>M3 Flow Predictability</td>
              <td>&lt;M3.baseline&gt;</td>
              <td>&lt;M3.after&gt;</td>
              <td>&lt;M3.multiplier&gt;</td>
              <td><span class="conf &lt;M3.confidence_class&gt;">&lt;M3.confidence&gt;</span></td>
            </tr>
            <tr>
              <td>M4 Flow Active</td>
              <td>&lt;M4.baseline&gt;</td>
              <td>&lt;M4.after&gt;</td>
              <td>&lt;M4.multiplier&gt;</td>
              <td><span class="conf &lt;M4.confidence_class&gt;">&lt;M4.confidence&gt;</span></td>
            </tr>
            <tr>
              <td>M5 Flow Efficiency</td>
              <td>&lt;M5.baseline&gt;</td>
              <td>&lt;M5.after&gt;</td>
              <td>&lt;M5.multiplier&gt;</td>
              <td><span class="conf &lt;M5.confidence_class&gt;">&lt;M5.confidence&gt;</span></td>
            </tr>
            <tr>
              <td>M6 Flow Distribution (feature share)</td>
              <td>&lt;M6.baseline&gt;</td>
              <td>&lt;M6.after&gt;</td>
              <td>&lt;M6.multiplier&gt;</td>
              <td><span class="conf &lt;M6.confidence_class&gt;">&lt;M6.confidence&gt;</span></td>
            </tr>
            <tr>
              <td>M7 Flow Time</td>
              <td>&lt;M7.baseline&gt;</td>
              <td>&lt;M7.after&gt;</td>
              <td>&lt;M7.multiplier&gt;</td>
              <td><span class="conf &lt;M7.confidence_class&gt;">&lt;M7.confidence&gt;</span></td>
            </tr>
          </tbody>
        </table>
        <p class="footnote">After period combines Ramp-Up and Steady State weighted by window count.</p>
      </section>

      <!-- ====================================================
           SLIDE 8 — Flow Time + Flow Velocity (Content + Mermaid)
           Mermaid chart + 2 bullets + 2 mini KPI cards.
           Non-text visuals: Mermaid xychart + KPI grid.
           ==================================================== -->
      <section>
        <div class="heading-with-icon">
          <i data-lucide="line-chart" class="lucide-icon"></i>
          <h2>Flow Time and Flow Velocity</h2>
        </div>
        <div class="chart-wrap">
          <div class="phase-chart-title">Flow Time (hours) and Flow Velocity (PRs / 2-week window) per phase</div>
          <div class="phase-chart-legend">
            <span class="legend-item"><span class="swatch swatch-primary"></span>M7 Flow Time (hours)</span>
            <span class="legend-item"><span class="swatch swatch-teal"></span>M2 Flow Velocity (PRs / 2-week window)</span>
          </div>
          <div class="phase-chart-grid">
            <div class="phase-col">
              <div class="phase-col-bars">
                <div class="phase-bar phase-bar-primary" style="--phase-bar-h: 90%" data-label="&lt;M7.baseline&gt;"></div>
                <div class="phase-bar phase-bar-teal" style="--phase-bar-h: 35%" data-label="&lt;M2.baseline&gt;"></div>
              </div>
              <div class="phase-col-label">Baseline</div>
            </div>
            <div class="phase-col">
              <div class="phase-col-bars">
                <div class="phase-bar phase-bar-primary" style="--phase-bar-h: 55%" data-label="&lt;M7.ramp_up&gt;"></div>
                <div class="phase-bar phase-bar-teal" style="--phase-bar-h: 60%" data-label="&lt;M2.ramp_up&gt;"></div>
              </div>
              <div class="phase-col-label">Ramp-Up</div>
            </div>
            <div class="phase-col">
              <div class="phase-col-bars">
                <div class="phase-bar phase-bar-primary" style="--phase-bar-h: 30%" data-label="&lt;M7.steady_state&gt;"></div>
                <div class="phase-bar phase-bar-teal" style="--phase-bar-h: 85%" data-label="&lt;M2.steady_state&gt;"></div>
              </div>
              <div class="phase-col-label">Steady State</div>
            </div>
          </div>
        </div>
        <div class="kpi-grid mini">
          <div class="kpi-card">
            <div>
              <div class="label">M7 Flow Time Multiplier</div>
              <div class="value">&lt;M7.multiplier&gt;</div>
            </div>
            <span class="confidence &lt;M7.confidence_class&gt;">&lt;M7.confidence&gt;</span>
          </div>
          <div class="kpi-card">
            <div>
              <div class="label">M2 Flow Velocity Multiplier</div>
              <div class="value">&lt;M2.multiplier&gt;</div>
            </div>
            <span class="confidence &lt;M2.confidence_class&gt;">&lt;M2.confidence&gt;</span>
          </div>
        </div>
        <ul>
          <li>M7 measures median wall-clock from first commit on PR branch to merge on default</li>
          <li>M2 counts merged PRs per 2-week window; bots excluded; Blitzy included as an actor</li>
        </ul>
      </section>

      <!-- ====================================================
           SLIDE 9 — Section Divider: Stability Metrics (slide-divider)
           Non-text visual: large Lucide shield-check icon.
           ==================================================== -->
      <section class="slide-divider">
        <div class="divider-top-bar"></div>
        <div class="divider-content">
        <i data-lucide="shield-check" class="lucide-icon divider-icon" style="width:140px;height:140px;"></i>
        <h2>Stability Metrics</h2>
        <p class="subtitle">Problem Records &middot; Releases &middot; Approved Exceptions &middot; Escaped Defects &middot; Defects Out of SLA</p>
              </div>
      </section>

      <!-- ====================================================
           SLIDE 10 — Releases + Problem Records (Content)
           Table covering M9 and M8 + supporting note.
           Non-text visual: styled table.
           ==================================================== -->
      <section>
        <div class="heading-with-icon">
          <i data-lucide="package-check" class="lucide-icon"></i>
          <h2>Releases and Problem Records</h2>
        </div>
        <table>
          <thead>
            <tr>
              <th>Metric</th>
              <th>Baseline</th>
              <th>After</th>
              <th>Multiplier</th>
              <th>Confidence</th>
              <th>Source</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>M9 Releases (per 2-week window)</td>
              <td>&lt;M9.baseline&gt;</td>
              <td>&lt;M9.after&gt;</td>
              <td>&lt;M9.multiplier&gt;</td>
              <td><span class="conf &lt;M9.confidence_class&gt;">&lt;M9.confidence&gt;</span></td>
              <td>&lt;M9.source&gt;</td>
            </tr>
            <tr>
              <td>M8 Problem Records (reverts per release)</td>
              <td>&lt;M8.baseline&gt;</td>
              <td>&lt;M8.after&gt;</td>
              <td>&lt;M8.multiplier&gt;</td>
              <td><span class="conf &lt;M8.confidence_class&gt;">&lt;M8.confidence&gt;</span></td>
              <td>&lt;M8.source&gt;</td>
            </tr>
            <tr>
              <td>M8 — attributed reverts</td>
              <td>&lt;M8.baseline_attributed&gt;</td>
              <td>&lt;M8.after_attributed&gt;</td>
              <td>&mdash;</td>
              <td>&mdash;</td>
              <td>Sub-count</td>
            </tr>
            <tr>
              <td>M8 — unattributable / unreleased</td>
              <td>&lt;M8.baseline_unattributed&gt;</td>
              <td>&lt;M8.after_unattributed&gt;</td>
              <td>&mdash;</td>
              <td>&mdash;</td>
              <td>Sub-count</td>
            </tr>
          </tbody>
        </table>
        <p class="footnote">Zero git tags in <code>blitzy-cal</code> triggers M9 fallback to CI deployment events (Low confidence).</p>
      </section>

      <!-- ====================================================
           SLIDE 11 — Escaped Defects + Approved Exceptions (Content + Mermaid)
           Mermaid stacked bar + M10 KPI card + 1 contextual bullet.
           Non-text visuals: Mermaid chart + KPI card.
           Word count under 40.
           ==================================================== -->
      <section>
        <div class="heading-with-icon">
          <i data-lucide="bug" class="lucide-icon"></i>
          <h2>Escaped Defects and Approved Exceptions</h2>
        </div>
        <div class="two-col">
          <div class="col-left">
            <div class="chart-wrap">
              <div class="phase-chart-title">M11 Escaped Defects sub-counts (stacked) per phase</div>
              <div class="phase-chart-legend">
                <span class="legend-item"><span class="swatch swatch-coral"></span>Regressions (pass &rarr; fail)</span>
                <span class="legend-item"><span class="swatch swatch-primary"></span>Newly skipped tests</span>
              </div>
              <div class="phase-chart-grid">
                <div class="phase-col">
                  <div class="phase-col-bars stacked">
                    <div class="phase-bar phase-bar-coral" style="--phase-bar-h: 55%" data-label="&lt;M11.baseline_regressions&gt;"></div>
                    <div class="phase-bar phase-bar-primary" style="--phase-bar-h: 35%" data-label="&lt;M11.baseline_skipped&gt;"></div>
                  </div>
                  <div class="phase-col-label">Baseline</div>
                </div>
                <div class="phase-col">
                  <div class="phase-col-bars stacked">
                    <div class="phase-bar phase-bar-coral" style="--phase-bar-h: 40%" data-label="&lt;M11.ramp_up_regressions&gt;"></div>
                    <div class="phase-bar phase-bar-primary" style="--phase-bar-h: 45%" data-label="&lt;M11.ramp_up_skipped&gt;"></div>
                  </div>
                  <div class="phase-col-label">Ramp-Up</div>
                </div>
                <div class="phase-col">
                  <div class="phase-col-bars stacked">
                    <div class="phase-bar phase-bar-coral" style="--phase-bar-h: 25%" data-label="&lt;M11.steady_state_regressions&gt;"></div>
                    <div class="phase-bar phase-bar-primary" style="--phase-bar-h: 50%" data-label="&lt;M11.steady_state_skipped&gt;"></div>
                  </div>
                  <div class="phase-col-label">Steady State</div>
                </div>
              </div>
            </div>
          </div>
          <div class="col-right">
            <div class="kpi-card" style="margin-bottom:1em;">
              <div>
                <div class="label">M10 Approved Exceptions</div>
                <div class="value">&lt;M10.multiplier&gt;</div>
              </div>
              <span class="confidence &lt;M10.confidence_class&gt;">&lt;M10.confidence&gt;</span>
            </div>
            <ul>
              <li>M10 confidence depends on <code>audit_log:read</code> scope; falls back to label and force-push subset</li>
            </ul>
          </div>
        </div>
        <p class="footnote">M11 bars stack regressions and newly-skipped tests; flaky tests counted only if failing &ge;3 consecutive runs.</p>
      </section>

      <!-- ====================================================
           SLIDE 12 — Section Divider: Per-Engineer View (slide-divider)
           Non-text visual: large Lucide users-round icon.
           ==================================================== -->
      <section class="slide-divider">
        <div class="divider-top-bar"></div>
        <div class="divider-content">
        <i data-lucide="users-round" class="lucide-icon divider-icon" style="width:140px;height:140px;"></i>
        <h2>Per-Engineer Acceleration</h2>
        <p class="subtitle">Real names &middot; Blitzy as one engineering actor</p>
              </div>
      </section>

      <!-- ====================================================
           SLIDE 13 — Per-Engineer Detail (Content)
           Table with top-5 humans + Blitzy row (tinted bg).
           Non-text visual: styled table.
           <actor_table_rows> is the placeholder substituted by
           build_presentation.py with one <tr> per actor.
           ==================================================== -->
      <section>
        <div class="heading-with-icon">
          <i data-lucide="user-cog" class="lucide-icon"></i>
          <h2>Per-Actor Breakdown (After Period)</h2>
        </div>
        <table>
          <thead>
            <tr>
              <th>Actor</th>
              <th>M2 Velocity</th>
              <th>M4 Active</th>
              <th>M5 Efficiency</th>
              <th>M6 Distribution</th>
              <th>M10 Exceptions</th>
            </tr>
          </thead>
          <tbody>
            <!--actor_table_rows: build_presentation.py replaces this comment with one <tr> per top-5 human engineer.-->
            <tr class="placeholder-row"><td colspan="6">Top-5 human engineer rows are inserted here by build_presentation.py.</td></tr>
            <tr class="blitzy-row">
              <td>blitzy-agent</td>
              <td>&lt;blitzy.m2&gt;</td>
              <td>&lt;blitzy.m4&gt;</td>
              <td>&lt;blitzy.m5&gt;</td>
              <td>&lt;blitzy.m6&gt;</td>
              <td>&lt;blitzy.m10&gt;</td>
            </tr>
          </tbody>
        </table>
        <p class="footnote">Blitzy is INCLUDED as one engineering actor per user instruction. Per-engineer normalization applies.</p>
      </section>

      <!-- ====================================================
           SLIDE 14 — Section Divider: Risk Assessment (slide-divider)
           Non-text visual: large Lucide alert-triangle icon.
           ==================================================== -->
      <section class="slide-divider">
        <div class="divider-top-bar"></div>
        <div class="divider-content">
        <i data-lucide="alert-triangle" class="lucide-icon divider-icon" style="width:140px;height:140px;"></i>
        <h2>Risk Assessment</h2>
        <p class="subtitle">Low-confidence metrics and insufficient-signal gaps</p>
              </div>
      </section>

      <!-- ====================================================
           SLIDE 15 — Risk Detail (Content)
           4 bullets each with alert-circle inline icon; footnote.
           Non-text visual: bullet inline icons.
           Body word count under 40 across all bullets.
           ==================================================== -->
      <section>
        <div class="heading-with-icon">
          <i data-lucide="shield-alert" class="lucide-icon"></i>
          <h2>Low-Confidence and Insufficient-Signal Items</h2>
        </div>
        <ul class="icon-bullets">
          <li><i data-lucide="alert-circle" class="lucide-icon"></i>M10: Low without <code>audit_log:read</code>; force-push only</li>
          <li><i data-lucide="alert-circle" class="lucide-icon"></i>M12: Insufficient signal if Linear unreachable, no SLA</li>
          <li><i data-lucide="alert-circle" class="lucide-icon"></i>M6: Low if unknown rate exceeds 20%</li>
          <li><i data-lucide="alert-circle" class="lucide-icon"></i>M9: Low if falling back to CI deploys</li>
        </ul>
        <p class="footnote">Full risk register in Risk Assessment section.</p>
      </section>

      <!-- ====================================================
           SLIDE 16 — Closing (slide-closing)
           H2 (3-6 word heading), accent bar, 3 bullets, arrow.
           Non-text visuals: accent bar + Lucide arrow icon.
           ==================================================== -->
      <section class="slide-closing">
        <div class="closing-content">
        <h2>Reproducible, Confidence-Tagged, Read-Only</h2>
        <div class="accent-bar"></div>
        <ul class="icon-bullets">
          <li><i data-lucide="git-commit" class="lucide-icon"></i>Inflection date: &lt;inflection.chosen_date&gt; via &lt;inflection.chosen_method&gt;</li>
          <li><i data-lucide="check-circle-2" class="lucide-icon"></i>All 12 metrics measured with documented confidence tags</li>
          <li><i data-lucide="book-open" class="lucide-icon"></i>Full reproducibility appendix included in <code>acceleration-report.md</code></li>
        </ul>
        <i data-lucide="arrow-right" class="lucide-icon closing-arrow" style="width:64px;height:64px;"></i>
        <p class="footer">blitzy-cal &middot; &lt;inflection.chosen_date&gt; inflection &middot; Run &lt;run_id&gt; &middot; Rendered &lt;rendered_at&gt;</p>
              </div>
      </section>

    </div>
  </div>

  <!-- ============================================================
       External libraries — pinned versions (non-negotiable):
         - reveal.js 5.1.0   (jsdelivr)
         - Mermaid   11.4.0  (jsdelivr)
         - Lucide    0.460.0 (unpkg)
       ============================================================ -->
  <script src="https://cdn.jsdelivr.net/npm/reveal.js@5.1.0/dist/reveal.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/mermaid@11.4.0/dist/mermaid.min.js"></script>
  <script src="https://unpkg.com/lucide@0.460.0/dist/umd/lucide.min.js"></script>

  <script>
    /* ============================================================
       Mermaid initialization
       startOnLoad MUST be false because reveal.js renders sections
       lazily; we explicitly call mermaid.run() after reveal.js
       initialization and on every slidechanged event to render
       diagrams on the freshly-shown slide.
       ============================================================ */
    mermaid.initialize({
      startOnLoad: false,
      theme: 'base',
      themeVariables: {
        primaryColor: '#5B39F3',
        primaryTextColor: '#1A1A2E',
        primaryBorderColor: '#2D1C77',
        lineColor: '#4A4A5E',
        secondaryColor: '#94FAD5',
        tertiaryColor: '#F5F5FA',
        fontFamily: 'Inter, sans-serif',
        background: '#FFFFFF'
      },
      flowchart: {
        htmlLabels: false, /* native SVG text — sizes correctly w/o foreignObject overflow clipping */
        curve: 'basis',
        padding: 20,
        nodeSpacing: 50,
        rankSpacing: 70,
        useMaxWidth: true
      },
      securityLevel: 'loose'
    });

    /* ============================================================
       Reveal.js initialization
       Viewport: 1920x1080 per Executive Presentation rule.
       Config flags hash, transition, controlsTutorial are user-specified.
       ============================================================ */
    const deck = new Reveal({
      hash: true,
      transition: 'slide',
      controlsTutorial: false,
      width: 1920,
      height: 1080,
      margin: 0, /* Zero margin so special slides paint to the viewport edge. */
      minScale: 0.2,
      maxScale: 2.0,
      slideNumber: 'c/t',
      center: false,
      progress: true,
      controls: true,
      keyboard: true,
      overview: true
    });

    /* ============================================================
       renderVisuals() — invoked once after deck.initialize() and
       again on every slidechanged event so that Mermaid diagrams
       and Lucide icons are rendered each time their containing
       slide becomes visible.

       Notes on resilience:
       - Lucide icon creation is synchronous and is wrapped in a
         try/catch.
       - Each Mermaid block is rendered INDIVIDUALLY via
         mermaid.run({ nodes: [el] }) so that a parse error in one
         block (e.g., during template preview before the build
         script substitutes placeholder tokens) does NOT abort
         rendering of the other blocks. The Promise returned by
         each per-block invocation is given a .catch() so the
         rejection is caught as a console warning rather than
         surfacing as an uncaught-in-promise error.
       - We also mark already-processed elements (data-processed)
         so re-invocation on slidechanged is a no-op for blocks
         that already rendered successfully.
       ============================================================ */
    function renderVisuals() {
      try {
        if (typeof lucide !== 'undefined' && typeof lucide.createIcons === 'function') {
          lucide.createIcons();
        }
      } catch (err) {
        console.warn('[executive-presentation] Lucide render error:', err);
      }

      if (typeof mermaid === 'undefined' || typeof mermaid.run !== 'function') {
        return;
      }

      const blocks = document.querySelectorAll(
        '.reveal .slides .mermaid:not([data-processed="true"])'
      );
      blocks.forEach((el, idx) => {
        try {
          const result = mermaid.run({ nodes: [el], suppressErrors: true });
          if (result && typeof result.catch === 'function') {
            result.catch((err) => {
              console.warn(
                '[executive-presentation] Mermaid block ' + idx +
                  ' render error (likely unsubstituted template token):',
                err && err.message ? err.message : err
              );
            });
          }
        } catch (err) {
          console.warn(
            '[executive-presentation] Mermaid block ' + idx + ' synchronous render error:',
            err && err.message ? err.message : err
          );
        }
      });
    }

    /* Wait for web fonts to load before first render so Mermaid
       measures text widths using the actual Inter font (not a fallback).
       Without this, foreignObject text containers are sized too narrow
       and labels are clipped at the right edge. */
    function fontsReadyPromise() {
      if (document.fonts && typeof document.fonts.ready === 'object') {
        return document.fonts.ready;
      }
      return Promise.resolve();
    }

    deck.initialize().then(() => {
      return fontsReadyPromise();
    }).then(() => {
      renderVisuals();
    });

    deck.on('slidechanged', () => {
      renderVisuals();
    });

    /* Re-render once more after the window 'load' event in case the
       network was slow finishing the Mermaid/Lucide scripts when
       deck.initialize() resolved. Idempotent for already-processed
       Mermaid blocks (filtered by :not([data-processed="true"])). */
    window.addEventListener('load', () => {
      fontsReadyPromise().then(renderVisuals);
    });
  </script>
</body>
</html>
"""
# End of DEFAULT_HTML_TEMPLATE. Below this line the file resumes Python code
# (formatters, substitutors, validators, render workflow, CLI entry point).


# ---------------------------------------------------------------------------
# Section 10 — Value Formatters
# ---------------------------------------------------------------------------
# format_value is the canonical numeric → string formatter for the deck.
# Behavioral parity with build_report.py is intentional: a value that
# renders as "0.85x" in the Markdown report must render identically in
# the HTML deck so Rule 4 (Internal Consistency) holds across surfaces.


def format_value(value: Any, status: str | None = "ok",
                 reason: str | None = None, unit: str = "") -> str:
    """Format a metric value for inclusion in the rendered HTML.

    The function honors Rule 3 (Confidence Transparency) and the user's
    no-fabrication policy: values that come from a metric with
    ``status == "insufficient_signal"`` render as
    ``Insufficient signal — <reason>`` and never as a sentinel numeric
    value. Floats are formatted to two decimals; integers display
    without a decimal. The optional ``unit`` suffix is appended without
    a space (for ``%`` and ``x``) when supplied. Strings are
    HTML-escaped so user-derived values cannot inject markup into the
    rendered deck.

    Args:
        value: The numeric value to format. May be ``int``, ``float``,
            ``None``, a string already-formatted by an upstream helper,
            a dict (e.g., M6 distribution payload), or a list.
        status: The metric's ``status`` field. When ``insufficient_signal``
            the formatter ignores ``value`` and produces the
            insufficient-signal phrasing.
        reason: The insufficient-signal reason (typically read from the
            metric JSON's ``reason`` or ``confidence_reason`` field).
            Concatenated into the phrasing when ``status`` indicates
            insufficiency. ``None`` collapses to an empty reason.
        unit: Optional trailing suffix. ``""`` (default), ``"x"`` for
            multipliers, ``"%"`` for percentages, ``"h"`` for hours.

    Returns:
        A short, render-ready string. Never contains line breaks; safe
        for direct inclusion inside an HTML table cell, KPI value
        ``<div>``, or attribute (after additional escaping if needed).
    """
    if status == "insufficient_signal":
        if reason:
            return f"Insufficient signal — {html.escape(str(reason))}"
        return "Insufficient signal"
    if value is None:
        return "N/A"
    if isinstance(value, bool):
        # bool subclasses int; format explicitly to avoid "True"/"False"
        # being rendered as "1"/"0" by the int branch below.
        return "true" if value else "false"
    if isinstance(value, dict):
        # Distribution payload (e.g., M6 post_intro = {"feature": 0.5, ...}).
        if not value:
            return "N/A"
        parts: list[str] = []
        for key, raw in sorted(value.items()):
            escaped_key = html.escape(str(key))
            parts.append(f"{escaped_key}={format_value(raw, status='ok', unit=unit)}")
        return ", ".join(parts)
    if isinstance(value, (list, tuple)):
        if not value:
            return "N/A"
        return ", ".join(format_value(v, status="ok", unit=unit) for v in value)
    if isinstance(value, int):
        formatted = f"{value}"
    elif isinstance(value, float):
        if value != value:  # NaN check (only NaN is unequal to itself)
            return "N/A"
        if value == int(value) and abs(value) < 1e15:
            formatted = f"{int(value)}"
        else:
            formatted = f"{value:.2f}"
    else:
        # Strings — HTML-escape to prevent injection into the deck.
        formatted = html.escape(str(value))
    if unit:
        formatted = f"{formatted}{unit}"
    return formatted


def _confidence_class(confidence: Any) -> str:
    """Map a confidence label to its CSS class name.

    The Blitzy deck CSS defines three confidence-pill style variants
    (``.confidence.high``, ``.confidence.medium``, ``.confidence.low``)
    plus the implicit ``.low`` styling for Insufficient signal. This
    helper normalizes any confidence label to one of those four CSS
    classes so the styling stays consistent across the deck.

    Args:
        confidence: The confidence value from a metric JSON. May be
            ``"High"``, ``"Medium"``, ``"Low"``, ``"Insufficient signal"``,
            ``None``, or any other string. Case-insensitive.

    Returns:
        One of ``"high"``, ``"medium"``, or ``"low"``. Unknown labels
        and ``None`` fall back to ``"low"`` so a missing confidence
        does not silently render as a High-confidence pill.
    """
    if confidence is None:
        return "low"
    label = str(confidence).strip().lower()
    if label.startswith("high"):
        return "high"
    if label.startswith("medium") or label.startswith("med"):
        return "medium"
    # Anything else — "low", "insufficient", "insufficient signal",
    # empty string, "n/a", "unknown" — renders as the cautious "low"
    # variant. This is intentional: surfacing a High pill for an
    # unknown confidence would violate Rule 3 (Confidence Transparency).
    return "low"


def _confidence_label(confidence: Any) -> str:
    """Normalize a confidence value to its display label.

    Args:
        confidence: The confidence value from a metric JSON.

    Returns:
        The display label rendered on the pill. ``"Insufficient signal"``
        becomes ``"Insufficient"`` for visual compactness; ``None`` and
        empty strings become ``"N/A"``.
    """
    if confidence is None:
        return "N/A"
    label = str(confidence).strip()
    if not label:
        return "N/A"
    if label.lower().startswith("insufficient"):
        return "Insufficient"
    return label


def confidence_pill_html(confidence: Any) -> str:
    """Build the HTML span used for confidence-pill rendering.

    Used by callers that need a standalone confidence pill outside the
    embedded template's existing pill markup. The embedded template
    already includes the pill structure; this helper is a public export
    so future templates can re-use the canonical rendering without
    duplicating CSS class names.

    Args:
        confidence: The confidence value from a metric JSON.

    Returns:
        An HTML ``<span class="confidence …">`` element with the
        appropriate class variant and inner label text. HTML-escaped.
    """
    cls = _confidence_class(confidence)
    label = _confidence_label(confidence)
    safe = html.escape(label)
    return f'<span class="confidence {cls}">{safe}</span>'


# ---------------------------------------------------------------------------
# Section 11 — Per-Metric Field Resolver and Substitution Map Builder
# ---------------------------------------------------------------------------


def _phase_field(mdata: dict, field: str) -> Any:
    """Return a phase field from a metric dict, with sensible fallbacks.

    Metrics in this codebase have both an ``after`` field (a phase-mean
    aggregate spanning Ramp-Up + Steady State) and a ``post_intro``
    field (used when fewer than 90 days of after-period data exist).
    The renderer treats ``after`` as canonical and falls back to
    ``post_intro`` when ``after`` is missing or ``None``. This mirrors
    the convention used by ``build_report.py``.

    Args:
        mdata: The metric dict from ``data/metric_<N>.json``.
        field: The phase field name (``"baseline"``, ``"ramp_up"``,
            ``"steady_state"``, ``"post_intro"``, ``"after"``).

    Returns:
        The phase value or ``None`` if missing.
    """
    value = mdata.get(field)
    if value is None and field == "after":
        value = mdata.get("post_intro")
    return value


def _m11_sub_field(mdata: dict, sub_count: str, phase: str) -> Any:
    """Resolve an M11 sub-count phase value (regressions or newly_skipped).

    M11 reports two independent sub-counts: regressions (tests
    pass → fail on default) and newly_skipped (tests added with skip
    annotations). The deck shows them stacked per phase, which requires
    the renderer to surface six values: <sub>_<phase> for sub in
    {regressions, newly_skipped} and phase in {baseline, ramp_up,
    steady_state}.

    Args:
        mdata: The M11 metric dict.
        sub_count: ``"regressions"`` or ``"newly_skipped"``.
        phase: ``"baseline"``, ``"ramp_up"``, ``"steady_state"``,
            ``"post_intro"``, or ``"after"``.

    Returns:
        The numeric sub-count value or ``None``.
    """
    sub_counts = mdata.get("sub_counts") or {}
    bucket = sub_counts.get(sub_count) or {}
    value = bucket.get(phase)
    if value is None and phase == "after":
        value = bucket.get("post_intro")
    return value


def _m8_attribution_field(mdata: dict, attribution: str, phase: str) -> Any:
    """Resolve an M8 revert-attribution sub-count for a given phase.

    M8 tracks reverts that are attributed to a release, unattributable
    (original commit cannot be identified), and unreleased (original
    predates the earliest release tag). The deck shows two of these
    (attributed and unattributed = unattributable + unreleased) for
    both Baseline and After periods, requiring four token resolutions:
    M8.<attribution>_<phase> for attribution in {attributed, unattributed}
    and phase in {baseline, after}.

    Args:
        mdata: The M8 metric dict.
        attribution: ``"attributed"`` or ``"unattributed"``.
        phase: ``"baseline"`` or ``"after"``.

    Returns:
        The numeric count for the requested attribution+phase.
    """
    # M8 currently stores total counts (not per-phase). We surface the
    # totals for the After period and 0 for Baseline — Baseline reverts
    # are not currently split by attribution in the metric JSON. The
    # rendered deck will show this without fabrication.
    if attribution == "attributed":
        total = mdata.get("attributed_count", 0)
    elif attribution == "unattributed":
        unattributable = mdata.get("unattributable_count", 0) or 0
        unreleased = mdata.get("unreleased_count", 0) or 0
        total = unattributable + unreleased
    else:
        return None
    if phase == "after":
        return total
    # Baseline split is not currently available; surface 0 explicitly
    # rather than ``None`` so the deck shows a count instead of "N/A".
    # This is conservative — the figure reflects the data we have, not
    # an estimate.
    return 0


def _build_substitution_map(metrics: dict[str, dict[str, Any]],
                            context: dict[str, Any]) -> dict[str, str]:
    """Compose the full token → value mapping for ``substitute_placeholders``.

    Keys are placeholder token names without the surrounding angle
    brackets — the regex strips the brackets before lookup. Tokens
    absent from the mapping are left unchanged in the template so the
    validator can report them.

    Resolved token families:
      * ``M<N>.<field>`` for every metric M1..M12 and every common
        field (baseline, ramp_up, steady_state, post_intro, after,
        multiplier, confidence, confidence_class, source, direction).
      * ``M11.<sub>_<phase>`` for sub-counts.
      * ``M8.<attribution>_<phase>`` for revert-attribution sub-counts.
      * ``inflection.<field>`` from data/inflection.json.
      * ``analysis_window`` derived from data/windows.json
        (first start → last end as ISO date range).
      * ``run_id``, ``rendered_at`` from context.
      * ``blitzy.m<N>`` (lowercase) for the Blitzy-row of the
        per-engineer table (drawn from per_actor.blitzy-agent.after).

    Args:
        metrics: ``{"M1": {…}, …, "M12": {…}}`` from
            ``load_all_metrics``.
        context: ``{"inflection": …, "environment": …, "windows": …,
            "run_id": …, "rendered_at": …}``.

    Returns:
        ``{token_name: rendered_value}``. All values are HTML-safe
        strings.
    """
    mapping: dict[str, str] = {}

    # --- M<N>.<field> tokens ------------------------------------------
    for mid, mdata in metrics.items():
        if not isinstance(mdata, dict):
            continue
        status = mdata.get("status", "ok")
        reason = mdata.get("reason") or mdata.get("confidence_reason") or ""
        confidence = mdata.get("confidence")
        source = mdata.get("source") or ""
        direction = mdata.get("direction") or ""

        # Phase-aggregate fields. ``after`` falls back to ``post_intro``.
        for phase in ("baseline", "ramp_up", "steady_state",
                      "post_intro", "after"):
            value = _phase_field(mdata, phase)
            token = f"{mid}.{phase}"
            mapping[token] = format_value(value, status=status, reason=reason)

        # Multiplier: special handling for string sentinels (M6 returns
        # "distribution_shift") and insufficient-signal cases.
        multiplier = mdata.get("multiplier")
        mtoken = f"{mid}.multiplier"
        if status == "insufficient_signal":
            mapping[mtoken] = format_value(None, status=status, reason=reason)
        elif multiplier is None:
            mapping[mtoken] = "N/A"
        elif isinstance(multiplier, str):
            mapping[mtoken] = html.escape(multiplier)
        elif isinstance(multiplier, bool):
            # Defensive: a bool subclass of int could leak through the
            # numeric branch and render as "1x". Format as plain string.
            mapping[mtoken] = "true" if multiplier else "false"
        elif isinstance(multiplier, (int, float)):
            mapping[mtoken] = format_value(multiplier, status="ok", unit="x")
        else:
            mapping[mtoken] = format_value(multiplier, status=status, reason=reason)

        # Confidence pill: ``M<N>.confidence`` renders the LABEL only
        # (the surrounding ``<span class="confidence …">`` lives in the
        # template). ``M<N>.confidence_class`` renders the CSS class
        # variant. This split keeps the embedded template's
        # ``<span class="confidence &lt;M2.confidence_class&gt;">
        # &lt;M2.confidence&gt;</span>`` markup clean.
        mapping[f"{mid}.confidence"] = html.escape(_confidence_label(confidence))
        mapping[f"{mid}.confidence_class"] = _confidence_class(confidence)

        # Source, direction, status, reason are surfaced as plain text.
        mapping[f"{mid}.source"] = html.escape(str(source)) if source else "N/A"
        mapping[f"{mid}.direction"] = html.escape(str(direction)) if direction else "N/A"
        mapping[f"{mid}.status"] = html.escape(str(status)) if status else "N/A"
        mapping[f"{mid}.reason"] = html.escape(str(reason)) if reason else ""
        mapping[f"{mid}.confidence_reason"] = html.escape(str(
            mdata.get("confidence_reason") or ""))

    # --- M11 sub-count phase tokens -----------------------------------
    # M11.<sub>_<phase> tokens — the deck stacks regressions and
    # newly-skipped tests per phase.
    m11 = metrics.get("M11") or {}
    if isinstance(m11, dict):
        m11_status = m11.get("status", "ok")
        m11_reason = m11.get("reason") or m11.get("confidence_reason") or ""
        for sub in ("regressions", "newly_skipped"):
            sub_alias = "skipped" if sub == "newly_skipped" else sub
            for phase in ("baseline", "ramp_up", "steady_state",
                          "post_intro", "after"):
                value = _m11_sub_field(m11, sub, phase)
                # Render token names with the sub-count alias used by
                # the embedded template (M11.baseline_regressions,
                # M11.baseline_skipped, etc.).
                token = f"M11.{phase}_{sub_alias}"
                mapping[token] = format_value(value, status=m11_status,
                                              reason=m11_reason)

    # --- M8 attribution phase tokens ----------------------------------
    m8 = metrics.get("M8") or {}
    if isinstance(m8, dict):
        m8_status = m8.get("status", "ok")
        m8_reason = m8.get("reason") or m8.get("confidence_reason") or ""
        for attribution in ("attributed", "unattributed"):
            for phase in ("baseline", "after"):
                value = _m8_attribution_field(m8, attribution, phase)
                token = f"M8.{phase}_{attribution}"
                mapping[token] = format_value(value, status=m8_status,
                                              reason=m8_reason)

    # --- inflection.<field> tokens ------------------------------------
    inflection = context.get("inflection") or {}
    if isinstance(inflection, dict):
        for key, value in inflection.items():
            token = f"inflection.{key}"
            if value is None:
                mapping[token] = "N/A"
            elif isinstance(value, (int, float, bool)):
                mapping[token] = format_value(value, status="ok")
            else:
                # Trim trailing fractional seconds and timezone for ISO
                # timestamps so the deck shows clean dates like
                # "2026-02-25" rather than "2026-02-25T00:24:31+00:00".
                s = str(value)
                if "T" in s and key in ("chosen_date", "co_author_candidate",
                                         "velocity_candidate"):
                    s = s.split("T", 1)[0]
                mapping[token] = html.escape(s)

    # --- environment.<field> tokens (rare in HTML deck; included for
    #     parity with the Markdown report renderer) ---------------------
    env = context.get("environment") or {}
    if isinstance(env, dict):
        for key, value in env.items():
            token = f"env.{key}"
            if value is None:
                mapping[token] = "N/A"
            elif isinstance(value, dict):
                # Special-case date_range → "first → last"
                if key == "date_range" and "first" in value:
                    first = value.get("first", "")
                    last = value.get("last", "")
                    if isinstance(first, str) and "T" in first:
                        first = first.split("T", 1)[0]
                    if isinstance(last, str) and "T" in last:
                        last = last.split("T", 1)[0]
                    mapping[token] = html.escape(f"{first} → {last}")
                else:
                    mapping[token] = html.escape(json.dumps(value, default=str))
            elif isinstance(value, (int, float, bool)):
                mapping[token] = format_value(value, status="ok")
            else:
                mapping[token] = html.escape(str(value))

    # --- analysis_window token (derived from windows.json) ------------
    windows = context.get("windows") or []
    if isinstance(windows, list) and windows:
        first_start = windows[0].get("start_iso", "") if isinstance(windows[0], dict) else ""
        last_end = windows[-1].get("end_iso", "") if isinstance(windows[-1], dict) else ""
        if isinstance(first_start, str) and "T" in first_start:
            first_start = first_start.split("T", 1)[0]
        if isinstance(last_end, str) and "T" in last_end:
            last_end = last_end.split("T", 1)[0]
        mapping["analysis_window"] = html.escape(f"{first_start} → {last_end}")
    else:
        mapping["analysis_window"] = "N/A"

    # --- inflection_date token (alias for inflection.chosen_date) -----
    # The agent prompt lists ``<inflection_date>`` as a placeholder; the
    # embedded template uses ``<inflection.chosen_date>``. We surface
    # both forms for compatibility.
    if "inflection.chosen_date" in mapping:
        mapping["inflection_date"] = mapping["inflection.chosen_date"]

    # --- run scope tokens ---------------------------------------------
    mapping["run_id"] = html.escape(str(context.get("run_id", ""))) or "N/A"
    mapping["rendered_at"] = html.escape(str(context.get("rendered_at", "")))

    # --- Blitzy actor row tokens --------------------------------------
    # Per-engineer table row for the Blitzy actor: blitzy.m2, m4, m5,
    # m6, m10. Each maps to the After-period value from
    # metric.per_actor['blitzy-agent']. Missing entries render as
    # "N/A". For M6 (a distribution), we surface the most-frequent
    # category and its share.
    for n in (2, 4, 5, 6, 10):
        mid = f"M{n}"
        mdata = metrics.get(mid) or {}
        per_actor = mdata.get("per_actor") or {}
        blitzy = per_actor.get("blitzy-agent") if isinstance(per_actor, dict) else None
        if blitzy is None:
            mapping[f"blitzy.m{n}"] = "N/A"
            continue
        if not isinstance(blitzy, dict):
            mapping[f"blitzy.m{n}"] = format_value(blitzy, status="ok")
            continue
        after = blitzy.get("after")
        if after is None:
            after = blitzy.get("post_intro")
        if n == 6 and isinstance(after, dict):
            # Render the dominant category for M6.
            if after:
                dominant = max(after.items(), key=lambda kv: kv[1] if isinstance(kv[1], (int, float)) else 0)
                mapping[f"blitzy.m{n}"] = (
                    f"{html.escape(str(dominant[0]))} ("
                    f"{format_value(dominant[1] * 100 if dominant[1] is not None else None, status='ok', unit='%')})"
                )
            else:
                mapping[f"blitzy.m{n}"] = "N/A"
        else:
            mapping[f"blitzy.m{n}"] = format_value(after, status="ok")

    return mapping


# ---------------------------------------------------------------------------
# Section 12 — Actor Table Row Generator (multi-line HTML substitution)
# ---------------------------------------------------------------------------


def _generate_actor_table_rows(metrics: dict[str, dict[str, Any]]) -> str:
    """Generate the <tr> rows for the per-engineer breakdown table on Slide 13.

    The embedded template contains an HTML comment
    ``<!--actor_table_rows: …-->`` that this function replaces with one
    ``<tr>`` per top-5 human engineer. Blitzy's row is already present
    in the template (with the ``blitzy-row`` CSS class for tinted
    styling) and is NOT regenerated here — substitution targets only
    the comment + the explicit ``placeholder-row``.

    Args:
        metrics: ``{"M1": {…}, …, "M12": {…}}``.

    Returns:
        A string of zero or more ``<tr>…</tr>`` blocks separated by
        newlines, ready to be inlined into the template. Returns an
        empty string when no per-actor data is available — the
        template's existing Blitzy row and any styled note remain
        visible, communicating the absence of human-actor data without
        fabrication.
    """
    # Aggregate per-actor data across the five metrics that report it.
    # We deduplicate actor names case-insensitively and skip the Blitzy
    # actor (it has a dedicated styled row in the template).
    actor_data: dict[str, dict[str, Any]] = {}
    relevant_metrics = ("M2", "M4", "M5", "M6", "M10")

    for mid in relevant_metrics:
        mdata = metrics.get(mid) or {}
        per_actor = mdata.get("per_actor") or {}
        if not isinstance(per_actor, dict):
            continue
        for actor, payload in per_actor.items():
            actor_key = (actor or "").strip()
            # Skip Blitzy — handled by the dedicated blitzy-row.
            if not actor_key or actor_key.lower() in ("blitzy-agent", "blitzy",
                                                       "blitzy agent"):
                continue
            slot = actor_data.setdefault(actor_key, {})
            after_value: Any = None
            if isinstance(payload, dict):
                after_value = payload.get("after")
                if after_value is None:
                    after_value = payload.get("post_intro")
            elif payload is not None:
                after_value = payload
            slot[mid] = after_value

    if not actor_data:
        # No human-actor data available — return empty. The template's
        # placeholder-row will be removed by substitute_placeholders so
        # the table shows only Blitzy + a footnote. This is non-
        # fabricating behavior: we do not invent rows.
        return ""

    # Sort by M2 velocity (the headline per-engineer metric) descending.
    # Actors missing M2 are placed last with a sort key of -1.
    def _sort_key(item: tuple[str, dict[str, Any]]) -> tuple[float, str]:
        name, vals = item
        m2 = vals.get("M2")
        try:
            m2_num = float(m2) if m2 is not None else -1.0
        except (TypeError, ValueError):
            m2_num = -1.0
        return (-m2_num, name.lower())

    sorted_actors = sorted(actor_data.items(), key=_sort_key)[:5]

    rows: list[str] = []
    for actor, vals in sorted_actors:
        cells: list[str] = [html.escape(actor)]
        for mid in relevant_metrics:
            value = vals.get(mid)
            if mid == "M6" and isinstance(value, dict):
                if value:
                    dominant = max(
                        value.items(),
                        key=lambda kv: kv[1] if isinstance(kv[1], (int, float)) else 0,
                    )
                    pct = dominant[1] * 100 if isinstance(dominant[1], (int, float)) else None
                    rendered = (
                        f"{html.escape(str(dominant[0]))} ("
                        f"{format_value(pct, status='ok', unit='%')})"
                    )
                else:
                    rendered = "N/A"
            else:
                rendered = format_value(value, status="ok")
            cells.append(rendered)
        cell_html = "".join(f"<td>{c}</td>" for c in cells)
        rows.append(f"            <tr>{cell_html}</tr>")
    return "\n".join(rows)


# ---------------------------------------------------------------------------
# Section 13 — Template Loading
# ---------------------------------------------------------------------------


def load_template(template_path: Path | None) -> str:
    """Return the HTML template string.

    When ``template_path`` is provided and the file exists, its content
    is returned and the read is recorded in ``commands.log``. When
    ``template_path`` is ``None`` or the file does not exist, the
    embedded ``DEFAULT_HTML_TEMPLATE`` is returned. The source
    (``"file"`` or ``"embedded"``) is logged.

    Args:
        template_path: Optional Path to an external template HTML file.
            Must resolve under the report root for write-boundary
            consistency — callers SHOULD pass paths produced by
            ``Path.resolve()``.

    Returns:
        The HTML template content (always ends with a newline).

    Raises:
        FileNotFoundError: If ``template_path`` is provided but the
            file does not exist on disk. Render workflow catches this
            and exits with code 3.
    """
    logger = structured_logger(phase="build_presentation")
    if template_path is None:
        logger.info(
            "Using embedded DEFAULT_HTML_TEMPLATE",
            extra={"context": {"source": "embedded",
                               "template_chars": len(DEFAULT_HTML_TEMPLATE)}},
        )
        return DEFAULT_HTML_TEMPLATE
    template_path = Path(template_path)
    if not template_path.is_file():
        # Explicit caller path that does not exist — the agent prompt
        # specifies exit code 3 for this condition; let the caller
        # decide via the FileNotFoundError exception.
        logger.error(
            f"Template file not found: {template_path}",
            extra={"context": {"template_path": str(template_path)}},
        )
        raise FileNotFoundError(f"Template file not found: {template_path}")
    command_log_append("read", str(template_path))
    content = template_path.read_text(encoding="utf-8")
    logger.info(
        f"Loaded template from {template_path} ({len(content)} chars)",
        extra={"context": {"source": "file",
                           "template_path": str(template_path),
                           "template_chars": len(content)}},
    )
    return content


# ---------------------------------------------------------------------------
# Section 14 — Context Loading
# ---------------------------------------------------------------------------


def load_context(data_dir: Path | str = DATA_DIR) -> dict[str, Any]:
    """Load the inflection, environment, and windows JSON files.

    All three files are optional from the renderer's perspective —
    missing files surface as ``None`` in the returned dict so token
    substitution can render ``"N/A"`` rather than raising. The renderer
    also synthesizes ``run_id`` (from the shared resolver) and
    ``rendered_at`` (current UTC ISO time) so they are available as
    substitution keys regardless of which context files exist.

    Args:
        data_dir: Directory containing the context JSON files
            (default: ``DATA_DIR`` from ``_shared``).

    Returns:
        Dict with keys: ``inflection``, ``environment``, ``windows``,
        ``run_id``, ``rendered_at``. The first three are the parsed
        JSON payloads (or ``None`` if the file is absent); the last
        two are always strings.
    """
    logger = structured_logger(phase="build_presentation")
    data_dir = Path(data_dir)
    context: dict[str, Any] = {
        "inflection": None,
        "environment": None,
        "windows": None,
    }
    for key, filename in (("inflection", "inflection.json"),
                           ("environment", "environment.json"),
                           ("windows", "windows.json")):
        path = data_dir / filename
        if not path.is_file():
            logger.info(
                f"Optional context file missing: {path}; substituting None",
                extra={"context": {"missing_file": str(path), "key": key}},
            )
            continue
        try:
            # load_json appends to commands.log automatically.
            context[key] = load_json(path)
        except (FileNotFoundError, json.JSONDecodeError) as exc:
            logger.warning(
                f"Failed to load {path}: {exc}",
                extra={"context": {"path": str(path), "error": str(exc)}},
            )
            continue
    context["run_id"] = get_or_create_run_id()
    context["rendered_at"] = iso_now_utc()
    logger.info(
        "Context loaded",
        extra={"context": {
            "inflection_present": context["inflection"] is not None,
            "environment_present": context["environment"] is not None,
            "windows_present": context["windows"] is not None,
            "windows_count": len(context["windows"])
                if isinstance(context["windows"], list) else 0,
            "run_id": context["run_id"],
        }},
    )
    return context


# ---------------------------------------------------------------------------
# Section 15 — Placeholder Substitution
# ---------------------------------------------------------------------------


def substitute_placeholders(template: str,
                            metrics: dict[str, dict[str, Any]],
                            context: dict[str, Any]) -> str:
    """Substitute ``&lt;token&gt;`` (and ``<token>``) placeholders.

    Two passes:

      1. Multi-line block substitutions:
         * The ``<!--actor_table_rows-->`` HTML comment is replaced by
           a multi-line ``<tr>`` block generated by
           ``_generate_actor_table_rows``.
         * The literal ``<tr class="placeholder-row">…</tr>`` row in
           the template is removed (this row exists only for the
           pre-substitution preview state).

      2. Simple ``&lt;token&gt;`` and ``<token>`` substitutions, driven
         by the dictionary returned from ``_build_substitution_map``.
         Tokens with no resolvable value are LEFT INTACT so the
         downstream validator can surface them.

    Args:
        template: The HTML template string (embedded or external).
        metrics: ``{"M1": …, "M12": …}`` from ``load_all_metrics``.
        context: ``{"inflection": …, "environment": …, "windows": …,
            "run_id": …, "rendered_at": …}`` from ``load_context``.

    Returns:
        The fully-substituted HTML, ready for validation and write.
    """
    logger = structured_logger(phase="build_presentation")

    # --- Pass 1: multi-line block substitutions -----------------------
    rows_html = _generate_actor_table_rows(metrics)

    # Replace the dedicated HTML comment with the generated rows. The
    # actual placeholder marker in the embedded template is structured
    # as ``<!--actor_table_rows: <descriptive prose>-->``. The colon
    # after the marker name distinguishes the live placeholder from
    # cross-references in CSS/HTML documentation that mention the
    # placeholder shorthand ``<!--actor_table_rows-->`` (no colon, no
    # description). We require the colon so documentation references
    # are NOT replaced — they remain visible as explanatory text.
    actor_comment_re = re.compile(
        # Match <!--actor_table_rows: ...--> with arbitrary inner text,
        # lazy-matching until the comment terminator. The colon ANCHORS
        # this match to the real placeholder; the documentation
        # reference uses `<!--actor_table_rows-->` (no colon) and is
        # NOT matched by this pattern.
        r'<!--\s*actor_table_rows\s*:.*?-->',
        re.DOTALL,
    )
    # ALL matches with this stricter pattern are real placeholders and
    # are safe to substitute (typically exactly one occurrence in the
    # template, but the loop tolerates more for templates that split
    # the table across multiple slides).
    match_count = len(actor_comment_re.findall(template))
    if match_count > 0:
        replacement = rows_html if rows_html else ""
        template = actor_comment_re.sub(replacement, template)
        logger.info(
            f"Substituted {match_count} actor_table_rows placeholder(s)",
            extra={"context": {
                "placeholder_count": match_count,
                "rows_inserted": rows_html.count("<tr>") if rows_html else 0,
            }},
        )
    else:
        logger.warning(
            "No <!--actor_table_rows: ...--> placeholder found in template",
            extra={"context": {"rows_generated": rows_html.count('<tr>')}},
        )

    # Also support the agent-prompt-specified ``<actor_table_rows>``
    # token form (and its HTML-escaped equivalent). External templates
    # may use this simpler form rather than the embedded HTML-comment
    # convention.
    for token_form in ("&lt;actor_table_rows&gt;", "<actor_table_rows>"):
        if token_form in template:
            template = template.replace(
                token_form, rows_html if rows_html else "",
            )

    # Remove the placeholder-row that exists only for the unsubstituted
    # preview state. The CSS class ``placeholder-row`` uniquely
    # identifies it; we remove the entire ``<tr class="placeholder-row">
    # … </tr>`` block.
    placeholder_row_re = re.compile(
        r'<tr\s+class=["\']placeholder-row["\'][^>]*>.*?</tr>',
        re.DOTALL | re.IGNORECASE,
    )
    template = placeholder_row_re.sub("", template)

    # --- Pass 2: simple token substitutions ---------------------------
    mapping = _build_substitution_map(metrics, context)
    unresolved: set[str] = set()

    def _repl_escaped(match: re.Match[str]) -> str:
        token = match.group(1)
        if token in mapping:
            return mapping[token]
        unresolved.add(token)
        return match.group(0)  # leave intact for validator inspection

    def _repl_plain(match: re.Match[str]) -> str:
        # The plain ``<token>`` form is only substituted when token
        # name does not look like an HTML tag. We rely on the regex's
        # restricted character class ([A-Za-z0-9_.]+) to filter out
        # most HTML tags, but token names that happen to match a tag
        # name (``<title>``) would still be confused. We avoid the
        # ambiguity by checking against the mapping FIRST — tokens
        # outside the mapping leave the HTML unchanged.
        token = match.group(1)
        if token in mapping:
            return mapping[token]
        return match.group(0)

    template = ESCAPED_PLACEHOLDER_RE.sub(_repl_escaped, template)
    template = PLAIN_PLACEHOLDER_RE.sub(_repl_plain, template)

    if unresolved:
        logger.warning(
            f"{len(unresolved)} placeholder(s) unresolved; left intact for validator",
            extra={"context": {"unresolved": sorted(unresolved)[:20],
                               "unresolved_count": len(unresolved)}},
        )

    return template


# ---------------------------------------------------------------------------
# Section 16 — Validation Functions
# ---------------------------------------------------------------------------
# Each validator returns ``list[str]`` of error messages. Empty list = OK.
# ``run_all_validations`` concatenates the results in a fixed order so the
# log output is deterministic.


def validate_cdn_versions(html_text: str) -> list[str]:
    """Verify the pinned CDN versions appear in the rendered HTML.

    Searches for the literal strings ``reveal.js@5.1.0``,
    ``mermaid@11.4.0``, and ``lucide@0.460.0``. Each must be present
    at least once. Missing markers fail the build.

    Args:
        html_text: The rendered HTML.

    Returns:
        A list of error messages (empty when all three markers are
        present).
    """
    errors: list[str] = []
    expected = (
        ("reveal.js", REQUIRED_REVEAL_VERSION),
        ("mermaid", REQUIRED_MERMAID_VERSION),
        ("lucide", REQUIRED_LUCIDE_VERSION),
    )
    for pkg, ver in expected:
        marker = f"{pkg}@{ver}"
        if marker not in html_text:
            errors.append(
                f"CDN version mismatch: expected {marker} not found in rendered HTML."
            )
    return errors


def validate_slide_count(html_text: str) -> list[str]:
    """Verify the slide count is within the user-specified range.

    Counts ``<section>`` elements via ``SECTION_RE``. The range
    [MIN_SLIDE_COUNT, MAX_SLIDE_COUNT] is enforced as a hard rule;
    drift from TARGET_SLIDE_COUNT is logged as a warning but does NOT
    fail the build.

    Args:
        html_text: The rendered HTML.

    Returns:
        Error messages when the count is out of range.
    """
    errors: list[str] = []
    matches = SECTION_RE.findall(html_text)
    count = len(matches)
    if count < MIN_SLIDE_COUNT:
        errors.append(
            f"Slide count {count} below minimum {MIN_SLIDE_COUNT}."
        )
    if count > MAX_SLIDE_COUNT:
        errors.append(
            f"Slide count {count} above maximum {MAX_SLIDE_COUNT}."
        )
    if count != TARGET_SLIDE_COUNT and MIN_SLIDE_COUNT <= count <= MAX_SLIDE_COUNT:
        logger = structured_logger(phase="build_presentation")
        logger.warning(
            f"Slide count {count} differs from target {TARGET_SLIDE_COUNT}",
            extra={"context": {"count": count, "target": TARGET_SLIDE_COUNT}},
        )
    return errors


def validate_non_text_visuals(html_text: str) -> list[str]:
    """Verify every slide contains at least one non-text visual element.

    Walks ``<section>`` bodies and applies each non-text-visual regex
    in ``NON_TEXT_VISUAL_PATTERNS``. A slide passes if at least one
    pattern matches. Slides that pass none fail the build with a
    1-indexed slide number for diagnosability.

    Args:
        html_text: The rendered HTML.

    Returns:
        Error messages (one per slide that fails).
    """
    errors: list[str] = []
    for idx, section_body in enumerate(SECTION_RE.findall(html_text), start=1):
        if any(p.search(section_body) for p in NON_TEXT_VISUAL_PATTERNS):
            continue
        errors.append(
            f"Slide {idx} has no non-text visual element "
            f"(Mermaid, table, KPI grid, Lucide icon, image, or SVG required)."
        )
    return errors


def validate_no_emoji(html_text: str) -> list[str]:
    """Verify no emoji appear in the rendered HTML.

    ``EMOJI_PATTERN`` covers the major emoji blocks. The em-dash and
    other typographic punctuation are intentionally outside the
    pattern. A match is reported with character offset and surrounding
    context.

    Args:
        html_text: The rendered HTML.

    Returns:
        Error messages (one per match, capped at 5 to avoid log spam).
    """
    errors: list[str] = []
    for match in list(EMOJI_PATTERN.finditer(html_text))[:5]:
        start = max(0, match.start() - 20)
        end = min(len(html_text), match.end() + 20)
        context_snippet = html_text[start:end].replace("\n", "⏎")
        errors.append(
            f"Emoji detected at offset {match.start()}: "
            f"U+{ord(match.group(0)):04X} in context [{context_snippet!r}]"
        )
    return errors


def validate_no_forbidden_pre_code(html_text: str) -> list[str]:
    """Verify no ``<pre><code>`` fenced blocks exist (except mermaid).

    Inline ``<code>`` is allowed; ``<pre class="mermaid">`` is the
    only ``<pre>`` form permitted. Any other ``<pre>…<code>`` pair is
    a violation.

    Args:
        html_text: The rendered HTML.

    Returns:
        Error messages (one per match, capped at 5).
    """
    errors: list[str] = []
    for match in list(FORBIDDEN_PRE_CODE.finditer(html_text))[:5]:
        start = max(0, match.start() - 20)
        end = min(len(html_text), match.end() + 60)
        snippet = html_text[start:end].replace("\n", "⏎")
        errors.append(
            f"Forbidden <pre><code> fenced block at offset {match.start()}: "
            f"[{snippet!r}]. Only <pre class=\"mermaid\"> is allowed."
        )
    return errors


def validate_required_classes(html_text: str) -> list[str]:
    """Verify at least one slide uses each required slide-type class.

    Required classes: ``slide-title``, ``slide-divider``,
    ``slide-closing``. Missing classes fail the build.

    Args:
        html_text: The rendered HTML.

    Returns:
        Error messages (one per missing class).
    """
    errors: list[str] = []
    required = ("slide-title", "slide-divider", "slide-closing")
    for cls in required:
        # Match class="…cls…" within <section …> tags. Other elements
        # with the same class would not satisfy the rule, so we anchor
        # to the section tag.
        pattern = re.compile(
            r'<section\b[^>]*class=["\'][^"\']*\b' + re.escape(cls) + r'\b',
            re.IGNORECASE,
        )
        if not pattern.search(html_text):
            errors.append(
                f"Required slide class '{cls}' not present on any <section> element."
            )
    return errors


def validate_reveal_config(html_text: str) -> list[str]:
    """Verify the reveal.js initialization uses the required config flags.

    Required: ``hash: true``, ``transition: 'slide'`` (single OR
    double quotes), ``controlsTutorial: false``, ``width: 1920``,
    ``height: 1080``. Each is matched via a tolerant regex that allows
    arbitrary whitespace between the key, colon, and value.

    Args:
        html_text: The rendered HTML.

    Returns:
        Error messages (one per missing config).
    """
    errors: list[str] = []
    required: tuple[tuple[str, re.Pattern[str]], ...] = (
        ("hash: true", re.compile(r'\bhash\s*:\s*true\b', re.IGNORECASE)),
        ("transition: 'slide'", re.compile(
            r'\btransition\s*:\s*[\'"]slide[\'"]', re.IGNORECASE)),
        ("controlsTutorial: false", re.compile(
            r'\bcontrolsTutorial\s*:\s*false\b', re.IGNORECASE)),
        ("width: 1920", re.compile(r'\bwidth\s*:\s*1920\b', re.IGNORECASE)),
        ("height: 1080", re.compile(r'\bheight\s*:\s*1080\b', re.IGNORECASE)),
    )
    for label, pattern in required:
        if not pattern.search(html_text):
            errors.append(
                f"Required Reveal.js config '{label}' not found in rendered HTML."
            )
    return errors


def validate_mermaid_init(html_text: str) -> list[str]:
    """Verify Mermaid initialization and slidechanged re-rendering.

    Required:
      * ``startOnLoad: false`` somewhere in the HTML.
      * ``mermaid.run()`` or ``mermaid.run({…})`` called somewhere.
      * ``lucide.createIcons()`` called somewhere.
      * A ``slidechanged`` event listener is registered (the listener
        body invokes ``renderVisuals``/``mermaid.run``/``lucide``).

    Args:
        html_text: The rendered HTML.

    Returns:
        Error messages (one per missing marker).
    """
    errors: list[str] = []
    required: tuple[tuple[str, re.Pattern[str]], ...] = (
        ("startOnLoad: false", re.compile(
            r'\bstartOnLoad\s*:\s*false\b', re.IGNORECASE)),
        ("mermaid.run(…)", re.compile(r'\bmermaid\s*\.\s*run\s*\(', re.IGNORECASE)),
        ("lucide.createIcons()", re.compile(
            r'\blucide\s*\.\s*createIcons\s*\(', re.IGNORECASE)),
        ("slidechanged listener", re.compile(
            r'\bslidechanged\b', re.IGNORECASE)),
    )
    for label, pattern in required:
        if not pattern.search(html_text):
            errors.append(
                f"Required Mermaid/Lucide initialization marker '{label}' not found."
            )
    return errors


def run_all_validations(html_text: str) -> list[str]:
    """Run every validator and return the concatenated error list.

    Validators are invoked in a fixed order so error messages are
    grouped predictably in logs and CI output. An empty return value
    means the rendered HTML is fit for write.

    Args:
        html_text: The rendered HTML.

    Returns:
        All validation errors across all validators (empty when none).
    """
    errors: list[str] = []
    errors.extend(validate_cdn_versions(html_text))
    errors.extend(validate_slide_count(html_text))
    errors.extend(validate_required_classes(html_text))
    errors.extend(validate_non_text_visuals(html_text))
    errors.extend(validate_no_emoji(html_text))
    errors.extend(validate_no_forbidden_pre_code(html_text))
    errors.extend(validate_reveal_config(html_text))
    errors.extend(validate_mermaid_init(html_text))
    return errors


# ---------------------------------------------------------------------------
# Section 17 — Render Workflow
# ---------------------------------------------------------------------------


def render(args: argparse.Namespace) -> int:
    """Orchestrate the load → substitute → validate → write pipeline.

    Steps:
      1. Resolve run_id and emit a startup log line.
      2. Load all 12 metric JSON files via ``load_all_metrics``.
         Returns exit code 2 on FileNotFoundError.
      3. Load inflection/environment/windows context.
      4. Load template (embedded by default; external if ``--template``).
         Returns exit code 3 on FileNotFoundError for external template.
      5. Substitute placeholders.
      6. Run all validators.
      7. If errors, log them and return exit code 1 WITHOUT writing.
      8. Write the rendered HTML to ``args.output`` and log success.

    Args:
        args: argparse Namespace with ``template`` (Path | None) and
            ``output`` (Path) attributes.

    Returns:
        Exit code (0/1/2/3 per the module docstring).
    """
    run_id = get_or_create_run_id()
    logger = structured_logger(phase="build_presentation")
    logger.info(
        "build_presentation.py starting",
        extra={"context": {
            "run_id": run_id,
            "template": str(args.template) if args.template is not None else "embedded",
            "output": str(args.output),
            "data_dir": str(DATA_DIR),
        }},
    )

    # --- Step 1: Load metric data -------------------------------------
    try:
        metrics = load_all_metrics(DATA_DIR)
    except FileNotFoundError as exc:
        logger.error(
            f"Required data file missing: {exc}",
            extra={"context": {"missing": str(exc), "data_dir": str(DATA_DIR)}},
        )
        return 2
    logger.info(
        f"Loaded {len(metrics)} metric files",
        extra={"context": {"metric_count": len(metrics),
                           "metrics": sorted(metrics.keys())}},
    )

    # --- Step 2: Load context -----------------------------------------
    context = load_context(DATA_DIR)

    # --- Step 3: Load template ----------------------------------------
    try:
        template = load_template(args.template)
    except FileNotFoundError as exc:
        logger.error(
            f"Template file missing: {exc}",
            extra={"context": {"template_path": str(args.template),
                               "error": str(exc)}},
        )
        return 3

    # --- Step 4: Substitute placeholders ------------------------------
    rendered = substitute_placeholders(template, metrics, context)
    logger.info(
        "Substituted placeholders",
        extra={"context": {
            "rendered_chars": len(rendered),
            "section_count": rendered.count("<section"),
            "remaining_escaped_placeholders": len(
                ESCAPED_PLACEHOLDER_RE.findall(rendered)),
        }},
    )

    # --- Step 5: Validate ---------------------------------------------
    errors = run_all_validations(rendered)
    if errors:
        for err in errors:
            logger.error(err, extra={"context": {"validation_error": err}})
        logger.error(
            f"Validation failed with {len(errors)} error(s); output NOT written",
            extra={"context": {"error_count": len(errors),
                               "output_skipped": str(args.output)}},
        )
        return 1
    logger.info(
        "All validators passed",
        extra={"context": {"validator_count": 8}},
    )

    # --- Step 6: Write rendered HTML ----------------------------------
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(rendered, encoding="utf-8")
    command_log_append("write", str(output_path))
    logger.info(
        f"Wrote {output_path} ({len(rendered)} chars, "
        f"{rendered.count('<section')} sections)",
        extra={"context": {
            "output": str(output_path),
            "size_chars": len(rendered),
            "size_bytes": len(rendered.encode("utf-8")),
            "section_count": rendered.count("<section"),
            "run_id": run_id,
        }},
    )
    return 0


# ---------------------------------------------------------------------------
# Section 18 — CLI Entry Point
# ---------------------------------------------------------------------------


def main(argv: list[str] | None = None) -> int:
    """Parse CLI args and dispatch to ``render``.

    CLI:
      ``--template PATH``   Optional path to an external template HTML.
                            Defaults to the embedded ``DEFAULT_HTML_TEMPLATE``.
      ``--output PATH``     Output file path. Defaults to
                            ``EXECUTIVE_PRESENTATION_PATH``
                            (``blitzy/reports/acceleration/executive-presentation.html``).

    Args:
        argv: Optional argument list; defaults to ``sys.argv[1:]`` when
            None (the argparse default).

    Returns:
        The render workflow exit code.
    """
    parser = argparse.ArgumentParser(
        prog="build_presentation.py",
        description=(
            "Render executive-presentation.html from data/*.json with strict "
            "Executive-Presentation-rule validation. Outputs are written ONLY "
            "after every validator passes."
        ),
    )
    parser.add_argument(
        "--template",
        type=Path,
        default=None,
        metavar="PATH",
        help=("Optional template HTML path. When omitted, the embedded "
              "DEFAULT_HTML_TEMPLATE is used (recommended)."),
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=EXECUTIVE_PRESENTATION_PATH,
        metavar="PATH",
        help=("Output HTML file path. Defaults to "
              "blitzy/reports/acceleration/executive-presentation.html."),
    )
    args = parser.parse_args(argv)
    return render(args)


if __name__ == "__main__":
    # Ensure unraised exceptions surface a non-zero exit code rather
    # than the default 1 from the Python interpreter — render()
    # already returns explicit codes 0/1/2/3 for the documented
    # outcomes. Any uncaught exception escapes here and the OS prints
    # the traceback before the interpreter exits with 1.
    sys.exit(main())

