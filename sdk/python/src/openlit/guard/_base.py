"""
Core types, base class, and errors for the OpenLIT guard system.
"""

from __future__ import annotations

import time
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from enum import Enum
from typing import List, Optional


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------


class GuardPhase(str, Enum):
    """Phase in which a guard runs relative to the LLM call."""

    PREFLIGHT = "preflight"
    POSTFLIGHT = "postflight"


class GuardAction(str, Enum):
    """Action a guard takes when a violation is detected."""

    ALLOW = "allow"
    DENY = "deny"
    REDACT = "redact"
    WARN = "warn"


# Action severity used to pick the "most restrictive" result in a pipeline.
_ACTION_SEVERITY = {
    GuardAction.ALLOW: 0,
    GuardAction.WARN: 1,
    GuardAction.REDACT: 2,
    GuardAction.DENY: 3,
}


# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class GuardResult:
    """Result of a single guard evaluation."""

    action: GuardAction = GuardAction.ALLOW
    score: float = 0.0
    guard_name: str = ""
    classification: str = ""
    explanation: str = ""
    transformed_text: Optional[str] = None
    latency_ms: float = 0.0

    def to_dict(self) -> dict:
        """Return the result as a flat dict of OTel-friendly attribute keys."""
        return {
            "guard.name": self.guard_name,
            "guard.action": self.action.value,
            "guard.score": self.score,
            "guard.classification": self.classification,
            "guard.explanation": self.explanation,
            "guard.latency_ms": self.latency_ms,
        }


@dataclass
class PipelineResult:
    """Aggregated result from a full pipeline evaluation."""

    action: GuardAction = GuardAction.ALLOW
    results: List[GuardResult] = field(default_factory=list)
    transformed_text: Optional[str] = None

    @property
    def explanation(self) -> str:
        """Concatenated explanations from every non-empty per-guard result."""
        parts = [r.explanation for r in self.results if r.explanation]
        return "; ".join(parts)


# ---------------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------------


class GuardError(Exception):
    """Base error for all guard-related failures."""


class GuardDeniedError(GuardError):
    """Raised when a guard pipeline denies execution."""

    def __init__(self, result: PipelineResult):
        self.result = result
        super().__init__(result.explanation)


class GuardTimeoutError(GuardError):
    """Raised when a guard evaluation exceeds its timeout.

    Reserved for future use -- a per-guard ``timeout_ms`` option may be
    added to ``Pipeline`` in a later release.
    """


class GuardConfigError(GuardError):
    """Raised for invalid guard configuration."""


# ---------------------------------------------------------------------------
# Abstract base
# ---------------------------------------------------------------------------


class Guard(ABC):
    """
    Abstract base class for all guards.

    Subclasses must implement ``evaluate`` and set ``name`` and ``phases``.
    """

    name: str = "guard"
    phases: tuple[GuardPhase, ...] = (GuardPhase.PREFLIGHT, GuardPhase.POSTFLIGHT)

    def __init__(
        self,
        action: str = "deny",
        max_scan_length: int = 102_400,
    ):
        try:
            self._action = GuardAction(action)
        except ValueError:
            raise GuardConfigError(
                f"Invalid action '{action}'. Must be one of: "
                f"{', '.join(a.value for a in GuardAction)}"
            ) from None
        self._max_scan_length = max_scan_length

    @property
    def action(self) -> GuardAction:
        """The configured action this guard applies on a violation."""
        return self._action

    def supports_phase(self, phase: GuardPhase) -> bool:
        """Return True if this guard runs in the given pipeline phase."""
        return phase in self.phases

    def run(self, text: str, phase: GuardPhase) -> GuardResult:
        """Execute the guard with timing, text-length capping, and phase filtering."""
        if not self.supports_phase(phase):
            return GuardResult(guard_name=self.name)

        capped = text[: self._max_scan_length] if self._max_scan_length else text

        start = time.perf_counter()
        result = self.evaluate(capped)
        elapsed_ms = (time.perf_counter() - start) * 1000

        return GuardResult(
            action=result.action,
            score=result.score,
            guard_name=self.name,
            classification=result.classification,
            explanation=result.explanation,
            transformed_text=result.transformed_text,
            latency_ms=round(elapsed_ms, 3),
        )

    @abstractmethod
    def evaluate(self, text: str) -> GuardResult:
        """
        Evaluate the text and return a GuardResult.

        Implementations should return ``GuardResult(action=self._action, ...)``
        when a violation is detected, or ``GuardResult()`` for a clean pass.
        """
