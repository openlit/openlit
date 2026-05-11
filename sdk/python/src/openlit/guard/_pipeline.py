"""
Guard Pipeline -- composes multiple guards into an ordered evaluation chain.
"""

from __future__ import annotations

import logging
from typing import List, Optional

from openlit.guard._base import (
    Guard,
    GuardAction,
    GuardPhase,
    GuardResult,
    PipelineResult,
    _ACTION_SEVERITY,
)

logger = logging.getLogger(__name__)


class Pipeline:
    """
    Evaluates an ordered list of guards and returns an aggregated result.

    * **fail_open** (default ``True``): if a guard raises, treat it as ``allow``.
    * **Deny short-circuits**: once a guard returns ``deny``, no further guards run.
    * **Redactions chain**: successive ``redact`` results operate on the already-redacted text.
    * **OTel metrics + events**: emitted for every individual guard evaluation.
    """

    def __init__(
        self,
        guards: Optional[List[Guard]] = None,
        fail_open: bool = True,
    ):
        self._guards: List[Guard] = list(guards or [])
        self._fail_open = fail_open

    @property
    def guards(self) -> List[Guard]:
        """Return a shallow copy of the configured guards in pipeline order."""
        return list(self._guards)

    def evaluate(self, text: str, phase: str = "preflight") -> PipelineResult:
        """Run every guard that supports ``phase`` and aggregate the results."""
        guard_phase = GuardPhase(phase)
        results: List[GuardResult] = []
        current_text = text
        worst_action = GuardAction.ALLOW

        for guard in self._guards:
            if not guard.supports_phase(guard_phase):
                continue

            try:
                result = guard.run(current_text, guard_phase)
            except Exception:
                if self._fail_open:
                    logger.warning(
                        "Guard '%s' raised during %s evaluation; fail-open -> allow",
                        guard.name,
                        phase,
                        exc_info=True,
                    )
                    result = GuardResult(guard_name=guard.name)
                else:
                    raise

            results.append(result)
            self._emit_otel(result, phase)

            if _ACTION_SEVERITY[result.action] > _ACTION_SEVERITY[worst_action]:
                worst_action = result.action

            if (
                result.action == GuardAction.REDACT
                and result.transformed_text is not None
            ):
                current_text = result.transformed_text

            if result.action == GuardAction.DENY:
                break

        transformed = current_text if current_text != text else None
        return PipelineResult(
            action=worst_action,
            results=results,
            transformed_text=transformed,
        )

    # ------------------------------------------------------------------
    # OTel emission
    # ------------------------------------------------------------------

    @staticmethod
    def _emit_otel(result: GuardResult, phase: str) -> None:
        """Best-effort OTel metric + event emission."""
        try:
            from openlit._config import OpenlitConfig

            metrics = getattr(OpenlitConfig, "metrics_dict", None)
            if metrics and not getattr(OpenlitConfig, "disable_metrics", False):
                counter = metrics.get("guard_requests")
                if counter is not None:
                    counter.add(
                        1,
                        {
                            "guard.name": result.guard_name,
                            "guard.action": result.action.value,
                            "guard.score": result.score,
                            "guard.classification": result.classification,
                            "guard.phase": phase,
                        },
                    )
        except Exception:
            pass

        try:
            from opentelemetry import trace

            span = trace.get_current_span()
            if span and span.is_recording():
                span.add_event(
                    "guard.evaluation",
                    attributes={
                        "guard.name": result.guard_name,
                        "guard.phase": phase,
                        "guard.action": result.action.value,
                        "guard.score": result.score,
                        "guard.classification": result.classification,
                        "guard.explanation": result.explanation,
                        "guard.latency_ms": result.latency_ms,
                    },
                )
        except Exception:
            pass
