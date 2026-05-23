#!/usr/bin/env python3
"""validate_consistency.py — Rule 4 (Internal Consistency) Validator.

Enforces AAP §0.7.2 Rule 4 verbatim:

    "A metric value MUST NOT differ between the Executive Summary, Activity
    Deep-Dives, Traceability Matrix, and Acceleration Curve table."

This validator runs against the source-of-truth JSON dataset
(``data/metric_*.json``) BEFORE any rendering occurs. Every downstream
surface (Executive Summary, Metric Deep-Dives, Traceability Matrix,
Acceleration Curve, Executive Presentation, Dashboard) is rendered from
this single dataset, so consistency at the JSON level guarantees
consistency at the rendered level.

Checks performed (each emits a list[str] of human-readable errors):
  1. Schema completeness — every metric has the required top-level fields.
  2. Multiplier derivation — stored ``multiplier`` agrees with
     ``after / baseline`` within tolerance (or matches the special
     ``"distribution_shift"`` marker for M6).
  3. Per-actor sum consistency — for count metrics (M2, M10), the sum of
     per-actor counts equals the overall count within ACTOR_SUM_TOLERANCE.
     For median/mean metrics (M4, M5), the overall value falls within the
     min/max of per-actor values (range sanity check). For M6, per-actor
     distributions each sum to 1.0.
  4. Per-module weight consistency — module weights sum to ~1.0 when
     per-module breakdown is present.
  5. Window count consistency — window-based metrics (M1, M2, M9) report
     the same baseline/ramp_up/steady_state window counts as windows.json.
  6. Confidence tier validity — every metric carries a valid tier
     (High/Medium/Low/Insufficient signal).
  7. Sample size sanity — ``baseline_n`` / ``ramp_up_n`` / ``steady_state_n``
     are non-negative integers; M3-specific check that confidence ==
     "Insufficient signal" when any window count < 4; M11-specific check
     that ``sub_counts`` contains both ``regressions`` and ``newly_skipped``.

Insufficient-signal metrics are NOT errors — per AAP §0.7.3 Boundary 2,
"Insufficient signal — [reason]" is the correct response when data is
unavailable. They are reported informationally at WARNING level.

Writes ``data/consistency_report.json`` with structured pass/fail per check.

Exit codes:
    0 — all consistency checks passed (insufficient-signal metrics counted
        as informational, not as errors)
    1 — one or more consistency checks failed
    2 — required data file missing (typically a metric_<N>.json file)

Module conventions:
  - Python 3.10+ stdlib only; no third-party packages.
  - Read-only on the analyzed repository (AAP §0.7.3 Boundary 1).
  - Structured JSON logging via _shared.structured_logger with run_id.
  - Every file read/write is recorded in logs/<run_id>/commands.log via
    _shared.command_log_append (Rule 5 — Reproducibility).
  - No fabrication: missing values surface as errors or insufficient-signal
    notices; never invented (AAP §0.7.3 Boundary 2).

References:
  AAP §0.5.1 (Internal Consistency goal), §0.6.1 (file responsibilities),
  §0.7.2 Rule 4 (verification surface), decision-log.md (consistency policy).
"""

from __future__ import annotations

import argparse
import json
import logging
import math
import os
import sys
from pathlib import Path
from typing import Any

# Ensure the sibling _shared module is importable when this script is run
# directly. Path.resolve() handles relative invocations correctly.
SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from _shared import (  # noqa: E402 — sys.path mutation must precede import
    DATA_DIR,
    command_log_append,
    get_or_create_run_id,
    iso_now_utc,
    load_all_metrics,
    load_json,
    save_json,
    structured_logger,
)


# ---------------------------------------------------------------------------
# Section 1 — Constants (schema requirements, tolerances, metric taxonomy)
# ---------------------------------------------------------------------------

REQUIRED_METRIC_FIELDS: tuple[str, ...] = (
    "metric_id",
    "status",
    "confidence",
)
"""Top-level fields required on EVERY metric record (including insufficient).

A record missing any of these is a hard schema failure regardless of
whether it carries values. AAP §0.6.2 schema."""


REQUIRED_VALUE_FIELDS: tuple[str, ...] = (
    "baseline",
    "ramp_up",
    "steady_state",
    "multiplier",
    "source",
)
"""Fields required on metric records whose ``status != "insufficient_signal"``.

Skipped for insufficient-signal records (they legitimately lack values).
Two special cases are tolerated by ``validate_schema()``:
  - M6 (distribution) — baseline/ramp_up/steady_state are dicts of
    proportions, multiplier is the string ``"distribution_shift"``.
  - M8 (problem records per release) — no scalar baseline/ramp_up/
    steady_state at all; reports ``mean_per_release`` instead and
    ``multiplier = None``."""


VALID_CONFIDENCE_TIERS: frozenset[str] = frozenset({
    "High",
    "Medium",
    "Low",
    "Insufficient signal",
})
"""Canonical confidence tier whitelist per AAP §0.8.3 confidence policy."""


FLOAT_TOLERANCE_REL: float = 0.01
"""Relative tolerance (1%) for floating-point equality checks. Used by
math.isclose() across multiplier derivation and per-module weight sums."""


FLOAT_TOLERANCE_ABS: float = 0.001
"""Absolute tolerance fallback for near-zero values where relative
tolerance is undefined. Used by math.isclose()."""


ACTOR_SUM_TOLERANCE: float = 0.05
"""Per-actor sum tolerance (5%) — count metrics' per-actor breakdowns
should sum to the overall count within this fraction. Looser than
FLOAT_TOLERANCE_REL because per-actor attribution can omit unknown
authors that still contribute to the overall count."""


METRICS_WITH_PER_ACTOR: frozenset[str] = frozenset({
    "M2", "M4", "M5", "M6", "M10",
})
"""Metrics that carry a ``per_actor`` field for per-engineer breakdowns
(AAP §0.1.3 "Per-Engineer Views" rule). Validated in
``validate_per_actor_sums()``."""


METRICS_DERIVED_AFTER: frozenset[str] = frozenset({
    "M1", "M2", "M3", "M4", "M5", "M7", "M9", "M10", "M11", "M12",
})
"""Metrics whose ``after`` value is derived from (ramp_up + steady_state)
and whose multiplier is computed as ``after / baseline``. M6 (distribution)
and M8 (per-release rate) are explicitly excluded — they use
``multiplier = "distribution_shift"`` and ``multiplier = None``
respectively."""


HIGHER_IS_BETTER: frozenset[str] = frozenset({
    "M2", "M3", "M5", "M9",
})
"""Metrics where higher values indicate acceleration (Flow Velocity, Flow
Predictability, Flow Efficiency, Releases). Affects the interpretation
of the multiplier but NOT its formula — ``compute_multiplier()`` in
_shared.py always returns ``after / baseline``."""


LOWER_IS_BETTER: frozenset[str] = frozenset({
    "M1", "M4", "M7", "M8", "M10", "M11", "M12",
})
"""Metrics where lower values indicate acceleration (Flow Load, Flow
Active, Flow Time, Problem Records, Approved Exceptions, Escaped Defects,
Defects Out of SLA). Same multiplier-formula note as HIGHER_IS_BETTER."""


DISTRIBUTION_METRICS: frozenset[str] = frozenset({"M6"})
"""Metrics whose phase values are categorical distributions (dicts of
``{category: proportion}``) rather than scalars. Multiplier is the
string marker ``"distribution_shift"`` and per-actor breakdowns are
nested dicts."""


METRICS_WITHOUT_SCALAR_PHASES: frozenset[str] = frozenset({"M6", "M8"})
"""Metrics that legitimately lack scalar baseline/ramp_up/steady_state
phase values. ``validate_schema()`` relaxes REQUIRED_VALUE_FIELDS for
these so their distinct envelopes pass validation."""


WINDOW_BASED_SAMPLE_N_METRICS: frozenset[str] = frozenset({"M1", "M2", "M9"})
"""Metrics whose ``baseline_n`` / ``ramp_up_n`` / ``steady_state_n`` fields
represent the WINDOW count in that phase (computed via
``count_windows_in_phase()`` in extract_metrics.py). These are the only
metrics where the sample size should match windows.json exactly. Other
metrics (M4, M7) use the same ``_n`` field names for PR/data-point counts,
which are NOT cross-checked against windows.json."""


COUNT_BASED_PER_ACTOR_METRICS: frozenset[str] = frozenset({"M2", "M10"})
"""Per-actor metrics whose per-window values are COUNTS — sums of
per-actor counts should equal the overall total within ACTOR_SUM_TOLERANCE.
M4 and M5 (medians) cannot be reassembled by summing actor medians;
only a min/max range check applies."""


PHASES_AFTER_INFLECTION: tuple[str, ...] = ("ramp_up", "steady_state", "post_intro")
"""All phases that fall on or after the AI-tool inflection date. Used to
compute the consolidated ``after`` value when the metric envelope reports
phase values separately."""


# ---------------------------------------------------------------------------
# Section 2 — Numeric Comparison Helpers
# ---------------------------------------------------------------------------


def _is_numeric(value: Any) -> bool:
    """Return True if ``value`` is a non-bool int or float.

    Booleans are excluded because Python's ``bool`` is a subclass of
    ``int`` and would otherwise pass arithmetic checks unintentionally.
    """
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _close(a: float, b: float,
           rel: float = FLOAT_TOLERANCE_REL,
           abs_tol: float = FLOAT_TOLERANCE_ABS) -> bool:
    """Return True if ``a`` and ``b`` are equal within the given tolerances."""
    return math.isclose(a, b, rel_tol=rel, abs_tol=abs_tol)


def _to_float(value: Any) -> float | None:
    """Best-effort numeric coercion. Returns None for non-numeric values."""
    if value is None:
        return None
    if isinstance(value, bool):  # exclude bool subclass of int
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value)
        except (TypeError, ValueError):
            return None
    return None


def _safe_get(d: Any, *keys: str, default: Any = None) -> Any:
    """Traverse a nested dict and return default on any missing key."""
    cur: Any = d
    for k in keys:
        if not isinstance(cur, dict) or k not in cur:
            return default
        cur = cur[k]
    return cur if cur is not None else default


# ---------------------------------------------------------------------------
# Section 3 — Schema Validation (Check 1)
# ---------------------------------------------------------------------------


def validate_schema(metrics: dict[str, dict[str, Any]]) -> list[str]:
    """Validate that every metric record has the required schema fields.

    Checks (per record):
      - All ``REQUIRED_METRIC_FIELDS`` (metric_id, status, confidence) are
        present.
      - ``confidence`` is one of ``VALID_CONFIDENCE_TIERS``.
      - If ``status == "insufficient_signal"``:
          * ``reason`` is present and a non-empty string.
          * Value-field checks are skipped (per AAP boundary rule).
      - Else, for the standard envelope:
          * All ``REQUIRED_VALUE_FIELDS`` are present (relaxed for M6/M8 —
            see ``METRICS_WITHOUT_SCALAR_PHASES``).
          * ``baseline``/``ramp_up``/``steady_state`` are numeric or None
            (or dicts for DISTRIBUTION_METRICS).
          * ``multiplier`` is numeric, None, or the string
            ``"distribution_shift"`` (M6).

    Returns an empty list when all records pass.
    """
    errors: list[str] = []

    if not metrics:
        errors.append("schema: metrics dict is empty — no metric records to validate")
        return errors

    for metric_id, record in metrics.items():
        if not isinstance(record, dict):
            errors.append(
                f"{metric_id}: record is not a dict (got {type(record).__name__})"
            )
            continue

        for field in REQUIRED_METRIC_FIELDS:
            if field not in record:
                errors.append(f"{metric_id}: missing required field '{field}'")

        record_metric_id = record.get("metric_id")
        if record_metric_id and record_metric_id != metric_id:
            errors.append(
                f"{metric_id}: metric_id field value '{record_metric_id}' "
                f"does not match dataset key '{metric_id}'"
            )

        confidence = record.get("confidence")
        if confidence is not None and confidence not in VALID_CONFIDENCE_TIERS:
            errors.append(
                f"{metric_id}: confidence '{confidence}' is not in "
                f"VALID_CONFIDENCE_TIERS {sorted(VALID_CONFIDENCE_TIERS)}"
            )

        status = record.get("status")

        if status == "insufficient_signal":
            reason = record.get("reason")
            if not isinstance(reason, str) or not reason.strip():
                errors.append(
                    f"{metric_id}: status=insufficient_signal but 'reason' "
                    "field is missing, empty, or non-string"
                )
            # Insufficient-signal records skip value-field checks intentionally.
            continue

        if status not in ("ok", "OK", "success", "complete", None):
            # Unknown status string — flag but continue to value-field checks.
            errors.append(
                f"{metric_id}: status '{status}' is not a recognized value "
                "('ok' or 'insufficient_signal')"
            )

        # Source field is REQUIRED for non-insufficient-signal records so the
        # Traceability Matrix (Rule 1) can cite the data origin.
        if "source" not in record:
            errors.append(
                f"{metric_id}: missing required field 'source' "
                "(needed for traceability matrix)"
            )

        if metric_id in METRICS_WITHOUT_SCALAR_PHASES:
            # M6 (distribution) and M8 (per-release rate) legitimately lack
            # scalar phase values; their envelopes are validated separately.
            errors.extend(_validate_special_envelope(metric_id, record))
            continue

        # Standard envelope: numeric baseline / ramp_up / steady_state / multiplier.
        for field in REQUIRED_VALUE_FIELDS:
            if field not in record:
                errors.append(
                    f"{metric_id}: missing required value field '{field}'"
                )

        for phase in ("baseline", "ramp_up", "steady_state"):
            value = record.get(phase)
            if value is None:
                continue  # Absent or null phase values are allowed.
            if not _is_numeric(value):
                errors.append(
                    f"{metric_id}: {phase} value must be numeric or null "
                    f"(got {type(value).__name__}: {value!r})"
                )

        multiplier = record.get("multiplier")
        if multiplier is not None and not _is_numeric(multiplier):
            # Only DISTRIBUTION_METRICS may carry a string multiplier marker,
            # and they are routed to _validate_special_envelope above.
            if not (isinstance(multiplier, str) and multiplier in ("N/A", "n/a")):
                errors.append(
                    f"{metric_id}: multiplier must be numeric, null, or "
                    f"'N/A' (got {type(multiplier).__name__}: {multiplier!r})"
                )

    return errors


def _validate_special_envelope(metric_id: str, record: dict[str, Any]) -> list[str]:
    """Schema check for metrics outside the standard scalar envelope.

    Handles M6 (distribution) and M8 (per-release rate). Each has a distinct
    envelope and is therefore checked here rather than against the generic
    REQUIRED_VALUE_FIELDS list.
    """
    errors: list[str] = []

    if "source" not in record:
        errors.append(
            f"{metric_id}: missing required field 'source' "
            "(needed for traceability matrix)"
        )

    if metric_id in DISTRIBUTION_METRICS:
        # M6: baseline/ramp_up/steady_state are dicts of proportions OR None.
        for phase in ("baseline", "ramp_up", "steady_state"):
            value = record.get(phase)
            if value is None:
                continue
            if not isinstance(value, dict):
                errors.append(
                    f"{metric_id}: {phase} must be a distribution dict or "
                    f"null (got {type(value).__name__})"
                )
                continue
            for cat, prop in value.items():
                if not _is_numeric(prop):
                    errors.append(
                        f"{metric_id}: {phase}['{cat}'] proportion must be "
                        f"numeric (got {type(prop).__name__})"
                    )
        multiplier = record.get("multiplier")
        if multiplier not in (None, "distribution_shift") and not _is_numeric(multiplier):
            errors.append(
                f"{metric_id}: multiplier must be null, numeric, or "
                f"'distribution_shift' (got {multiplier!r})"
            )
    elif metric_id == "M8":
        # M8: requires mean_per_release; multiplier is None.
        if "mean_per_release" not in record:
            errors.append(
                "M8: missing required field 'mean_per_release' "
                "(per-release rate, not a per-window scalar)"
            )
        else:
            mpr = record.get("mean_per_release")
            if mpr is not None and not _is_numeric(mpr):
                errors.append(
                    f"M8: mean_per_release must be numeric or null "
                    f"(got {type(mpr).__name__}: {mpr!r})"
                )
        multiplier = record.get("multiplier")
        if multiplier is not None and not _is_numeric(multiplier):
            errors.append(
                f"M8: multiplier must be null or numeric (got "
                f"{type(multiplier).__name__}: {multiplier!r})"
            )

    return errors


# ---------------------------------------------------------------------------
# Section 4 — Multiplier Derivation Check (Check 2)
# ---------------------------------------------------------------------------


def validate_multiplier_derivation(metrics: dict[str, dict[str, Any]]) -> list[str]:
    """Verify that each metric's stored multiplier agrees with its derivation.

    The canonical formula in ``_shared.compute_multiplier`` is::

        multiplier = after / baseline

    The ``direction`` field (higher-is-better / lower-is-better) does NOT
    alter the formula — it is a marker for downstream interpretation only.

    Skipped:
      - Insufficient-signal metrics (no values to check).
      - M6 (distribution metric — multiplier is the string marker
        ``"distribution_shift"``).
      - M8 (per-release rate — multiplier is None by design).
      - Metrics whose stored ``multiplier`` is None / non-numeric (e.g., M3
        in zero-variance phases legitimately has None).
      - Metrics whose ``baseline`` is None or 0 (division would be invalid).
      - Metrics whose derived ``after`` value is None (insufficient
        ramp_up + steady_state data).

    Records with a ``multiplier_formula`` override are checked against the
    declared formula. Recognized formulas:
      - ``"after_over_before"`` (default) — multiplier = after / baseline
      - ``"before_over_after"`` — multiplier = baseline / after
      - ``"distribution_shift"`` — skipped (M6)
    """
    errors: list[str] = []

    for metric_id, record in metrics.items():
        if record.get("status") == "insufficient_signal":
            continue
        if metric_id in DISTRIBUTION_METRICS or metric_id == "M8":
            continue

        stored = record.get("multiplier")
        if stored is None or not _is_numeric(stored):
            continue  # Legitimately missing scalar; not a derivation issue.

        baseline = _to_float(record.get("baseline"))
        after = _to_float(record.get("after"))

        if after is None:
            # Re-derive after from the post-inflection phases when extractor
            # omitted it (defensive).
            after = _derive_after_value(record)

        if baseline is None or baseline == 0.0:
            # No baseline → multiplier cannot be derived; not a discrepancy
            # so long as the stored multiplier is consistent with this state.
            continue
        if after is None:
            continue

        formula = record.get("multiplier_formula", "after_over_before")
        if formula == "distribution_shift":
            continue

        if formula == "before_over_after":
            expected = baseline / after if after != 0 else None
        else:
            expected = after / baseline

        if expected is None:
            continue
        if not _close(float(stored), float(expected)):
            errors.append(
                f"{metric_id}: stored multiplier {stored} does not match "
                f"derived {expected:.6f} (formula={formula}, "
                f"after={after}, baseline={baseline})"
            )

    return errors


def _derive_after_value(record: dict[str, Any]) -> float | None:
    """Compute ``after`` from ramp_up + steady_state + post_intro.

    Mirrors ``_shared.derive_after_value`` semantics: averages the available
    numeric phase values. Returns None when no post-inflection phase
    carries a numeric value.
    """
    vals: list[float] = []
    for phase in PHASES_AFTER_INFLECTION:
        v = _to_float(record.get(phase))
        if v is not None:
            vals.append(v)
    if not vals:
        return None
    return sum(vals) / len(vals)


# ---------------------------------------------------------------------------
# Section 5 — Per-Actor Sum Consistency (Check 3)
# ---------------------------------------------------------------------------


def validate_per_actor_sums(metrics: dict[str, dict[str, Any]]) -> list[str]:
    """Verify per-actor breakdowns are internally consistent.

    Behavior by metric type:
      - COUNT_BASED_PER_ACTOR_METRICS (M2 velocity, M10 exceptions): the sum
        of per-actor values for a phase should equal the overall value for
        that phase, within ACTOR_SUM_TOLERANCE. Per-actor mean-of-counts
        may not sum exactly because zero-count windows can be distributed
        differently across actors, hence the tolerance.
      - M4, M5 (medians): the sum of per-actor medians is NOT meaningful;
        instead, verify the overall median falls within the [min, max]
        range of per-actor medians.
      - M6 (distribution): each per-actor phase distribution should sum
        to ~1.0.

    Skipped when:
      - The metric is not in METRICS_WITH_PER_ACTOR.
      - Status is insufficient_signal.
      - per_actor field is absent or not a dict.
    """
    errors: list[str] = []

    for metric_id in METRICS_WITH_PER_ACTOR:
        record = metrics.get(metric_id)
        if not record:
            continue
        if record.get("status") == "insufficient_signal":
            continue
        per_actor = record.get("per_actor")
        if not isinstance(per_actor, dict) or not per_actor:
            # Missing per_actor is non-fatal — only the cross-section consistency
            # check warrants an error here, not the absence itself.
            continue

        if metric_id in DISTRIBUTION_METRICS:
            errors.extend(_check_distribution_actor_sums(metric_id, per_actor))
        elif metric_id in COUNT_BASED_PER_ACTOR_METRICS:
            errors.extend(_check_count_actor_sums(metric_id, record, per_actor))
        else:
            errors.extend(_check_median_actor_range(metric_id, record, per_actor))

    return errors


def _check_distribution_actor_sums(metric_id: str,
                                   per_actor: dict[str, Any]) -> list[str]:
    """For M6: each per-actor per-phase distribution must sum to ~1.0."""
    errors: list[str] = []
    for actor, phases in per_actor.items():
        if not isinstance(phases, dict):
            errors.append(
                f"{metric_id} per-actor for '{actor}' is not a dict "
                f"(got {type(phases).__name__})"
            )
            continue
        for phase, dist in phases.items():
            if dist is None:
                continue
            if not isinstance(dist, dict):
                errors.append(
                    f"{metric_id} per_actor['{actor}']['{phase}'] expected "
                    f"distribution dict; got {type(dist).__name__}"
                )
                continue
            total = sum(_to_float(v) or 0.0 for v in dist.values())
            if total > 0 and not _close(total, 1.0,
                                        rel=FLOAT_TOLERANCE_REL,
                                        abs_tol=FLOAT_TOLERANCE_ABS * 5):
                errors.append(
                    f"{metric_id} per_actor['{actor}']['{phase}'] proportions "
                    f"sum to {total:.6f}, expected ~1.0"
                )
    return errors


def _check_count_actor_sums(metric_id: str,
                            record: dict[str, Any],
                            per_actor: dict[str, Any]) -> list[str]:
    """For count metrics (M2, M10): per-actor counts sum to overall count.

    Compares per-actor sum vs overall value for each phase with
    ACTOR_SUM_TOLERANCE relative tolerance.
    """
    errors: list[str] = []
    for phase in ("baseline", "ramp_up", "steady_state"):
        overall = _to_float(record.get(phase))
        if overall is None:
            continue
        actor_sum = 0.0
        any_actor_data = False
        for actor, phase_values in per_actor.items():
            if not isinstance(phase_values, dict):
                continue
            v = _to_float(phase_values.get(phase))
            if v is None:
                continue
            actor_sum += v
            any_actor_data = True
        if not any_actor_data:
            continue
        if overall == 0.0 and actor_sum == 0.0:
            continue
        # Use ACTOR_SUM_TOLERANCE for the relative comparison and a small
        # absolute floor for near-zero values.
        if not math.isclose(actor_sum, overall,
                            rel_tol=ACTOR_SUM_TOLERANCE,
                            abs_tol=max(FLOAT_TOLERANCE_ABS, abs(overall) * 0.001)):
            errors.append(
                f"{metric_id} per-actor sum mismatch for phase '{phase}': "
                f"actors sum to {actor_sum:.4f}, overall is {overall:.4f}"
            )
    return errors


def _check_median_actor_range(metric_id: str,
                              record: dict[str, Any],
                              per_actor: dict[str, Any]) -> list[str]:
    """For median metrics (M4, M5): overall must lie within [min, max] of
    per-actor values, within ACTOR_SUM_TOLERANCE * range tolerance.

    This is a sanity check rather than an equality — the median of
    medians does not equal the median of the underlying data.
    """
    errors: list[str] = []
    for phase in ("baseline", "ramp_up", "steady_state"):
        overall = _to_float(record.get(phase))
        if overall is None:
            continue
        actor_values: list[float] = []
        for phase_values in per_actor.values():
            if not isinstance(phase_values, dict):
                continue
            v = _to_float(phase_values.get(phase))
            if v is not None:
                actor_values.append(v)
        if not actor_values:
            continue
        lo, hi = min(actor_values), max(actor_values)
        spread = max(hi - lo, FLOAT_TOLERANCE_ABS)
        slack = spread * ACTOR_SUM_TOLERANCE + FLOAT_TOLERANCE_ABS
        if overall < lo - slack or overall > hi + slack:
            errors.append(
                f"{metric_id} per-actor range mismatch for phase '{phase}': "
                f"overall {overall:.4f} outside per-actor range "
                f"[{lo:.4f}, {hi:.4f}] (slack={slack:.4f})"
            )
    return errors


# ---------------------------------------------------------------------------
# Section 6 — Per-Module Weight Consistency (Check 4)
# ---------------------------------------------------------------------------


def validate_per_module_weights(metrics: dict[str, dict[str, Any]]) -> list[str]:
    """Verify per-module breakdowns sum to ~1.0 by weight.

    The AAP §0.1.3 "Multi-Module Repositories" rule mandates that per-module
    metrics are aggregated weighted by commit volume (non-merge commits per
    module / total). When a metric reports ``per_module``, each entry should
    carry a ``weight`` field and the weights should sum to ~1.0 within
    FLOAT_TOLERANCE_REL.

    Skipped when:
      - The metric has no ``per_module`` field (single-module aggregation).
      - The metric is insufficient_signal.
    """
    errors: list[str] = []

    for metric_id, record in metrics.items():
        if record.get("status") == "insufficient_signal":
            continue
        per_module = record.get("per_module")
        if per_module is None:
            continue
        if not isinstance(per_module, dict) or not per_module:
            errors.append(
                f"{metric_id}: per_module is present but not a non-empty dict "
                f"(got {type(per_module).__name__})"
            )
            continue
        total_weight = 0.0
        for module_name, module_data in per_module.items():
            if not isinstance(module_data, dict):
                errors.append(
                    f"{metric_id} per_module['{module_name}'] is not a dict "
                    f"(got {type(module_data).__name__})"
                )
                continue
            weight = module_data.get("weight")
            if weight is None:
                errors.append(
                    f"{metric_id} per_module['{module_name}'] missing 'weight' field"
                )
                continue
            w = _to_float(weight)
            if w is None:
                errors.append(
                    f"{metric_id} per_module['{module_name}']['weight'] is not "
                    f"numeric (got {type(weight).__name__}: {weight!r})"
                )
                continue
            if w < 0.0 or w > 1.0 + FLOAT_TOLERANCE_REL:
                errors.append(
                    f"{metric_id} per_module['{module_name}']['weight'] = {w} "
                    "is outside [0, 1]"
                )
                continue
            total_weight += w
        if total_weight > 0 and not _close(total_weight, 1.0):
            errors.append(
                f"{metric_id} per-module weights sum to {total_weight:.6f} "
                "(expected ~1.0)"
            )

    return errors


# ---------------------------------------------------------------------------
# Section 7 — Window Count Consistency (Check 5)
# ---------------------------------------------------------------------------


def validate_window_counts(metrics: dict[str, dict[str, Any]],
                           data_dir: Path | None = None) -> list[str]:
    """Verify window-based metrics agree with the canonical windows.json.

    For each metric in ``WINDOW_BASED_SAMPLE_N_METRICS``:
      - Compare ``baseline_n`` against the count of baseline-phase windows
        in windows.json.
      - Compare ``ramp_up_n`` against the count of ramp_up-phase windows.
      - Compare ``steady_state_n`` against the count of steady_state-phase
        windows.

    Metrics that count PRs (not windows) in their ``_n`` fields (M4, M7)
    are NOT cross-checked here — see WINDOW_BASED_SAMPLE_N_METRICS.

    When windows.json is missing, returns a single informational warning
    rather than failing — the user may run validate_consistency.py before
    generate_windows.py is invoked.
    """
    errors: list[str] = []

    data_dir = Path(data_dir) if data_dir else DATA_DIR
    windows_path = data_dir / "windows.json"

    if not windows_path.is_file():
        # Not a hard error — the windows file may be generated later.
        return [
            f"window_counts: windows.json not found at {windows_path} "
            "(non-fatal — window cross-check skipped)"
        ]

    try:
        windows = load_json(windows_path)
    except (OSError, json.JSONDecodeError) as exc:
        return [
            f"window_counts: failed to load windows.json: {exc}"
        ]

    if not isinstance(windows, list):
        return [
            f"window_counts: windows.json is not a list "
            f"(got {type(windows).__name__})"
        ]

    expected: dict[str, int] = {}
    for w in windows:
        if not isinstance(w, dict):
            continue
        phase = w.get("phase")
        if not isinstance(phase, str):
            continue
        expected[phase] = expected.get(phase, 0) + 1

    for metric_id in WINDOW_BASED_SAMPLE_N_METRICS:
        record = metrics.get(metric_id)
        if not record:
            continue
        if record.get("status") == "insufficient_signal":
            continue
        for phase, field in (
            ("baseline", "baseline_n"),
            ("ramp_up", "ramp_up_n"),
            ("steady_state", "steady_state_n"),
        ):
            if field not in record:
                continue
            reported = record.get(field)
            if not isinstance(reported, int) or isinstance(reported, bool):
                errors.append(
                    f"{metric_id}: {field} is not an integer "
                    f"(got {type(reported).__name__}: {reported!r})"
                )
                continue
            exp = expected.get(phase, 0)
            if reported != exp:
                errors.append(
                    f"{metric_id}: window count for {phase} ({reported}) "
                    f"does not match windows.json ({exp})"
                )

    return errors


# ---------------------------------------------------------------------------
# Section 8 — Confidence Tier Validity (Check 6)
# ---------------------------------------------------------------------------


def validate_confidence_tiers(metrics: dict[str, dict[str, Any]]) -> list[str]:
    """Verify every metric carries a valid confidence tier.

    Rules:
      - ``confidence`` must be in VALID_CONFIDENCE_TIERS.
      - When ``status == "insufficient_signal"``, ``confidence`` must
        equal exactly ``"Insufficient signal"``.
      - When ``status`` is not insufficient_signal, ``confidence`` must
        NOT equal ``"Insufficient signal"`` (otherwise the report would
        show values with an Insufficient-signal tag, confusing Rule 3).
    """
    errors: list[str] = []

    for metric_id, record in metrics.items():
        confidence = record.get("confidence")
        if confidence not in VALID_CONFIDENCE_TIERS:
            errors.append(
                f"{metric_id}: confidence '{confidence}' is not in "
                f"VALID_CONFIDENCE_TIERS"
            )
            continue
        status = record.get("status")
        if status == "insufficient_signal" and confidence != "Insufficient signal":
            errors.append(
                f"{metric_id}: status=insufficient_signal but confidence='{confidence}'; "
                "expected confidence='Insufficient signal'"
            )
        elif status != "insufficient_signal" and confidence == "Insufficient signal":
            errors.append(
                f"{metric_id}: confidence='Insufficient signal' but status='{status}'; "
                "expected status='insufficient_signal'"
            )

    return errors


# ---------------------------------------------------------------------------
# Section 9 — Sample Size Sanity (Check 7)
# ---------------------------------------------------------------------------


def validate_sample_sizes(metrics: dict[str, dict[str, Any]]) -> list[str]:
    """Verify sample-size fields are non-negative integers and metric-specific
    invariants hold.

    Global rule:
      - ``baseline_n`` / ``ramp_up_n`` / ``steady_state_n`` / ``post_intro_n``
        (when present) must be non-negative integers.

    M3 (Flow Predictability):
      - Per AAP §0.1.1: requires ≥4 windows per phase; otherwise reports
        "Insufficient signal — fewer than 4 windows."
      - Per-phase result entries in ``phase_results`` (if present) should
        flag insufficient-signal when n < 4.

    M11 (Escaped Defects):
      - Per AAP §0.1.1: regressions and newly_skipped sub-counts must
        be reported separately. The validator requires ``sub_counts``
        with both keys when M11 is not insufficient_signal.
    """
    errors: list[str] = []

    for metric_id, record in metrics.items():
        for field in ("baseline_n", "ramp_up_n", "steady_state_n", "post_intro_n"):
            if field not in record:
                continue
            value = record.get(field)
            if value is None:
                continue
            if not isinstance(value, int) or isinstance(value, bool) or value < 0:
                errors.append(
                    f"{metric_id}: {field} must be a non-negative integer "
                    f"(got {type(value).__name__}: {value!r})"
                )

    # M3-specific: phase-results entries should report insufficient_signal
    # for phases with fewer than 4 windows.
    m3 = metrics.get("M3")
    if m3 and m3.get("status") != "insufficient_signal":
        phase_results = m3.get("phase_results")
        if isinstance(phase_results, dict):
            for phase, result in phase_results.items():
                if not isinstance(result, dict):
                    continue
                n = result.get("n")
                phase_status = result.get("status")
                if isinstance(n, int) and not isinstance(n, bool) and 0 < n < 4:
                    if phase_status != "insufficient_signal":
                        errors.append(
                            f"M3 phase_results['{phase}']: n={n} (<4 windows) "
                            "but status is not 'insufficient_signal'"
                        )

    # M11-specific: sub_counts must report regressions and newly_skipped.
    m11 = metrics.get("M11")
    if m11 and m11.get("status") != "insufficient_signal":
        sub_counts = m11.get("sub_counts")
        if not isinstance(sub_counts, dict):
            errors.append(
                "M11: missing 'sub_counts' (expected dict with "
                "'regressions' and 'newly_skipped' keys)"
            )
        else:
            for required_sub in ("regressions", "newly_skipped"):
                if required_sub not in sub_counts:
                    errors.append(
                        f"M11 sub_counts: missing required sub-count "
                        f"'{required_sub}'"
                    )

    return errors


# ---------------------------------------------------------------------------
# Section 10 — Insufficient-Signal Reporting (Informational)
# ---------------------------------------------------------------------------


def report_insufficient_signal(metrics: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    """Return informational records for every insufficient-signal metric.

    These are NOT errors — per AAP §0.7.3 Boundary 2, "Insufficient
    signal — [reason]" is the correct response when data is unavailable.
    They are logged at WARNING level (not ERROR) so they appear in the
    operator's view without failing the build.

    Returns a list of ``{metric_id, status, reason}`` dicts ordered by
    metric_id for deterministic output.
    """
    out: list[dict[str, Any]] = []
    for metric_id in sorted(metrics.keys(), key=_metric_sort_key):
        record = metrics[metric_id]
        if record.get("status") == "insufficient_signal":
            out.append({
                "metric_id": metric_id,
                "status": "insufficient_signal",
                "reason": record.get("reason", "(no reason provided)"),
                "confidence": record.get("confidence", "Insufficient signal"),
            })
    return out


def _metric_sort_key(metric_id: str) -> tuple[int, str]:
    """Return a numeric sort key for M1..M12 so listing is naturally ordered."""
    if (
        isinstance(metric_id, str)
        and len(metric_id) >= 2
        and metric_id[0].upper() == "M"
        and metric_id[1:].isdigit()
    ):
        return (int(metric_id[1:]), metric_id)
    return (10_000, str(metric_id))


# ---------------------------------------------------------------------------
# Section 11 — Output Generation (consistency_report.json)
# ---------------------------------------------------------------------------


def write_consistency_report(
    checks: dict[str, list[str]],
    insufficient: list[dict[str, Any]],
    run_id: str,
    total_errors: int,
    data_dir: Path | None = None,
) -> Path:
    """Write the consistency_report.json payload and return the output path.

    Schema::

        {
          "run_id": str,
          "validated_at": str (ISO 8601 UTC),
          "passed": bool,
          "total_errors": int,
          "checks_run": int,
          "checks": {
            "schema":             {"pass": bool, "error_count": int, "errors": [str, ...]},
            "multiplier_derivation": {...},
            "per_actor_sums":     {...},
            "per_module_weights": {...},
            "window_counts":      {...},
            "confidence_tiers":   {...},
            "sample_sizes":       {...}
          },
          "insufficient_signal_metrics": [{metric_id, status, reason, confidence}, ...],
          "policy": {
            "float_tolerance_rel": float,
            "float_tolerance_abs": float,
            "actor_sum_tolerance": float,
            "valid_confidence_tiers": [str, ...]
          }
        }

    The save_json helper from _shared writes atomically (temp file +
    Path.replace()) and automatically appends a "write" entry to
    commands.log for the Reproducibility Appendix (Rule 5).
    """
    data_dir = Path(data_dir) if data_dir else DATA_DIR
    output_path = data_dir / "consistency_report.json"

    payload: dict[str, Any] = {
        "run_id": run_id,
        "validated_at": iso_now_utc(),
        "passed": total_errors == 0,
        "total_errors": total_errors,
        "checks_run": len(checks),
        "checks": {
            name: {
                "pass": len(errors) == 0,
                "error_count": len(errors),
                "errors": list(errors),
            }
            for name, errors in checks.items()
        },
        "insufficient_signal_metrics": insufficient,
        "policy": {
            "float_tolerance_rel": FLOAT_TOLERANCE_REL,
            "float_tolerance_abs": FLOAT_TOLERANCE_ABS,
            "actor_sum_tolerance": ACTOR_SUM_TOLERANCE,
            "valid_confidence_tiers": sorted(VALID_CONFIDENCE_TIERS),
        },
    }

    save_json(output_path, payload)
    # save_json already logs a "write" command_log_append; emit a redundant
    # marker so the consistency report's emission can be located by name
    # in the Reproducibility Appendix even when interleaved with cache writes.
    command_log_append(
        "validate_consistency",
        f"emitted consistency_report.json (passed={payload['passed']}, "
        f"total_errors={total_errors})",
    )
    return output_path


# ---------------------------------------------------------------------------
# Section 12 — Validation Orchestration
# ---------------------------------------------------------------------------


def validate(args: argparse.Namespace) -> int:
    """Orchestrate all consistency checks and emit the report.

    Args:
        args: argparse.Namespace from main(), with a ``data_dir`` Path.

    Returns:
        Exit code:
          0 — all checks passed
          1 — at least one check failed
          2 — required data file (metric_<N>.json) missing
    """
    run_id = get_or_create_run_id()
    logger: logging.Logger = structured_logger(
        metric_id=None, phase="validate_consistency"
    )

    data_dir = Path(getattr(args, "data_dir", DATA_DIR) or DATA_DIR)

    logger.info(
        "validate_consistency.py starting",
        extra={"context": {
            "run_id": run_id,
            "data_dir": str(data_dir),
            "checks_planned": [
                "schema", "multiplier_derivation", "per_actor_sums",
                "per_module_weights", "window_counts",
                "confidence_tiers", "sample_sizes",
            ],
        }},
    )
    command_log_append(
        "validate_consistency",
        f"start run_id={run_id} data_dir={data_dir}",
    )

    # Load all 12 metric JSONs — FileNotFoundError → exit code 2.
    try:
        metrics = load_all_metrics(data_dir)
    except FileNotFoundError as exc:
        logger.error(
            f"Required data file missing: {exc}",
            extra={"context": {"missing": str(exc), "data_dir": str(data_dir)}},
        )
        return 2
    except (OSError, json.JSONDecodeError) as exc:
        logger.error(
            f"Failed to load metric files: {exc}",
            extra={"context": {"error": str(exc), "data_dir": str(data_dir)}},
        )
        return 2

    logger.info(
        f"Loaded {len(metrics)} metric records",
        extra={"context": {"metric_ids": sorted(metrics.keys(), key=_metric_sort_key)}},
    )

    # Run every check; collect their error lists into a single dict.
    check_results: dict[str, list[str]] = {
        "schema": validate_schema(metrics),
        "multiplier_derivation": validate_multiplier_derivation(metrics),
        "per_actor_sums": validate_per_actor_sums(metrics),
        "per_module_weights": validate_per_module_weights(metrics),
        "window_counts": validate_window_counts(metrics, data_dir=data_dir),
        "confidence_tiers": validate_confidence_tiers(metrics),
        "sample_sizes": validate_sample_sizes(metrics),
    }

    # Insufficient-signal records (informational, not errors).
    insufficient = report_insufficient_signal(metrics)
    for entry in insufficient:
        logger.warning(
            f"{entry['metric_id']}: insufficient signal — {entry.get('reason', '')}",
            extra={"context": entry},
        )

    total_errors = sum(len(errs) for errs in check_results.values())

    # Log each error individually so they appear in
    # logs/<run_id>/validate_consistency.log alongside the aggregate summary.
    for check_name, errors in check_results.items():
        for err in errors:
            logger.error(
                f"Consistency check '{check_name}' failed: {err}",
                extra={"context": {"check": check_name, "error": err}},
            )

    # Always emit the structured report, even when consistency passes —
    # downstream renderers consume it for the audit trail.
    output_path = write_consistency_report(
        check_results, insufficient, run_id, total_errors, data_dir=data_dir,
    )
    logger.info(
        f"Consistency report written: {output_path}",
        extra={"context": {
            "output_path": str(output_path),
            "passed": total_errors == 0,
            "total_errors": total_errors,
            "insufficient_signal_count": len(insufficient),
        }},
    )

    if total_errors > 0:
        logger.error(
            f"Consistency validation FAILED with {total_errors} error(s)",
            extra={"context": {
                "total_errors": total_errors,
                "check_summary": {
                    name: len(errs) for name, errs in check_results.items()
                },
            }},
        )
        return 1

    logger.info(
        "Consistency validation PASSED — all checks succeeded",
        extra={"context": {
            "total_errors": 0,
            "checks_run": len(check_results),
            "insufficient_signal_count": len(insufficient),
        }},
    )
    return 0


# ---------------------------------------------------------------------------
# Section 13 — CLI Entry Point
# ---------------------------------------------------------------------------


def main(argv: list[str] | None = None) -> int:
    """CLI entry point. Returns the validate() exit code unchanged."""
    # Honor BLITZY_DATA_DIR for environments that prefer env-var configuration.
    env_data_dir = os.environ.get("BLITZY_DATA_DIR", "").strip()
    default_data_dir = Path(env_data_dir) if env_data_dir else DATA_DIR

    parser = argparse.ArgumentParser(
        prog="validate_consistency.py",
        description=(
            "Validate cross-section consistency of the data/metric_*.json "
            "dataset (Rule 4 — Internal Consistency). Exit code 0 means "
            "all checks passed; 1 means at least one check failed; 2 means "
            "a required data file is missing."
        ),
    )
    parser.add_argument(
        "--data-dir",
        type=Path,
        default=default_data_dir,
        help=(
            "Directory containing metric_*.json (and windows.json) "
            f"(default: {default_data_dir})."
        ),
    )

    args = parser.parse_args(argv)
    return validate(args)


if __name__ == "__main__":
    sys.exit(main())
