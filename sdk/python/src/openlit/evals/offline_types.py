"""
Pydantic models for offline evaluation results returned by the OpenLIT server.
"""

import sys
from typing import List, Optional, Dict, Any

from pydantic import BaseModel, Field


def _is_tty() -> bool:
    try:
        return sys.stderr.isatty()
    except Exception:
        return False


def _c(code: str, text: str) -> str:
    if _is_tty():
        return f"\033[{code}m{text}\033[0m"
    return text


class OfflineEvaluation(BaseModel):
    """A single evaluation result for one eval type."""

    type: str = ""
    score: float = 0.0
    verdict: str = ""
    classification: str = ""
    explanation: str = ""


class ContextInfo(BaseModel):
    """Context matching information from the rule engine."""

    rule_matched: bool = False
    matching_rule_ids: List[str] = Field(default_factory=list)
    context_entity_ids: List[str] = Field(default_factory=list)
    user_contexts_count: int = 0


class OfflineEvalResult(BaseModel):
    """Result of a single offline evaluation containing all eval scores."""

    success: bool = False
    evaluations: List[OfflineEvaluation] = Field(default_factory=list)
    context_applied: Optional[ContextInfo] = None
    metadata: Optional[Dict[str, Any]] = None
    error: Optional[str] = None

    @property
    def passed(self) -> bool:
        """True if the evaluation succeeded and no eval type returned 'yes'."""
        if not self.success:
            return False
        return all(e.verdict.lower() != "yes" for e in self.evaluations)

    @property
    def failed_evals(self) -> List[OfflineEvaluation]:
        """Evaluations that returned a 'yes' verdict (i.e. detected an issue)."""
        return [e for e in self.evaluations if e.verdict.lower() == "yes"]

    def summary(self) -> str:
        """Formatted terminal summary of the evaluation result."""
        lines: List[str] = []
        if not self.success:
            lines.append(
                _c("31", f"Evaluation failed: {self.error or 'unknown error'}")
            )
            return "\n".join(lines)

        status = _c("32", "PASSED") if self.passed else _c("31", "FAILED")
        lines.append(f"\n{_c('1', 'OpenLIT Offline Evaluation')} — {status}")
        lines.append(_c("2", "─" * 50))

        for e in self.evaluations:
            flag = _c("32", "✓") if e.verdict.lower() != "yes" else _c("31", "✗")
            lines.append(
                f"  {flag} {_c('1', e.type)}: score={e.score:.2f}  "
                f"verdict={e.verdict}  class={e.classification}"
            )
            if e.explanation:
                lines.append(f"    {_c('2', e.explanation[:200])}")

        if self.context_applied and self.context_applied.rule_matched:
            lines.append(
                f"\n  {_c('36', 'Context')}: {len(self.context_applied.context_entity_ids)} "
                f"entities from {len(self.context_applied.matching_rule_ids)} rules"
            )
        if self.context_applied and self.context_applied.user_contexts_count > 0:
            lines.append(
                f"  {_c('36', 'User contexts')}: {self.context_applied.user_contexts_count}"
            )

        if self.metadata:
            model = self.metadata.get("model", "")
            if model:
                lines.append(f"  {_c('2', f'Model: {model}')}")
            run_id = self.metadata.get("runId")
            if run_id:
                lines.append(f"  {_c('2', f'Run: {run_id}')}")

        lines.append("")
        return "\n".join(lines)


class EvalType(BaseModel):
    """An evaluation type configured in the OpenLIT dashboard."""

    id: str
    label: str = ""
    description: str = ""
    enabled: bool = False
    is_custom: bool = False


class BatchEvalResult(BaseModel):
    """Aggregated result of evaluating a batch of prompt/response pairs."""

    results: List[OfflineEvalResult] = Field(default_factory=list)
    run_id: Optional[str] = None

    @property
    def all_passed(self) -> bool:
        """True if the batch is non-empty and every item passed."""
        return bool(self.results) and all(r.passed for r in self.results)

    @property
    def pass_rate(self) -> float:
        """Fraction of items that passed (0.0 for empty batches)."""
        if not self.results:
            return 0.0
        return sum(1 for r in self.results if r.passed) / len(self.results)

    def aggregate_summary(self) -> str:
        """Formatted terminal summary of the batch evaluation."""
        lines: List[str] = []
        total = len(self.results)
        passed = sum(1 for r in self.results if r.passed)
        failed = total - passed

        status = (
            _c("32", "ALL PASSED") if self.all_passed else _c("31", f"{failed} FAILED")
        )
        lines.append(f"\n{_c('1', 'OpenLIT Batch Evaluation')} — {status}")
        lines.append(_c("2", "═" * 50))
        lines.append(
            f"  Total: {total}  Passed: {_c('32', str(passed))}  "
            f"Failed: {_c('31', str(failed))}  "
            f"Rate: {self.pass_rate:.0%}"
        )
        if self.run_id:
            lines.append(f"  Run ID: {self.run_id}")
        lines.append(_c("2", "─" * 50))

        for i, r in enumerate(self.results):
            flag = _c("32", "✓") if r.passed else _c("31", "✗")
            if r.success:
                types_str = ", ".join(e.type for e in r.evaluations)
                lines.append(f"  {flag} [{i + 1}/{total}] {types_str}")
            else:
                lines.append(f"  {flag} [{i + 1}/{total}] Error: {r.error}")

        lines.append("")
        return "\n".join(lines)
