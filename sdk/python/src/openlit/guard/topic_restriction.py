"""
Topic restriction guard.

Enforces allow/deny topic lists using a user-provided topic classifier.
Phases: preflight only.
"""

from __future__ import annotations

from typing import Callable, List, Optional, Set

from openlit.guard._base import (
    Guard,
    GuardConfigError,
    GuardPhase,
    GuardResult,
)


class TopicRestriction(Guard):
    """
    Blocks prompts that don't match allowed topics or that match denied topics.

    Parameters
    ----------
    classifier : callable
        ``Callable[[str], str]`` that returns a topic label for the given text.
    allowed : list[str], optional
        Only these topics are permitted.  Mutually exclusive with ``denied``.
    denied : list[str], optional
        These topics are blocked; everything else is allowed.
    action : str
        ``"deny"`` (default) or ``"warn"``.
    """

    name = "topic_restriction"
    phases = (GuardPhase.PREFLIGHT,)

    def __init__(
        self,
        classifier: Callable[[str], str],
        allowed: Optional[List[str]] = None,
        denied: Optional[List[str]] = None,
        action: str = "deny",
        **kwargs,
    ):
        super().__init__(action=action, **kwargs)
        if not callable(classifier):
            raise GuardConfigError("TopicRestriction requires a callable 'classifier'")
        if allowed and denied:
            raise GuardConfigError("Provide either 'allowed' or 'denied', not both")
        if not allowed and not denied:
            raise GuardConfigError("Provide either 'allowed' or 'denied' topic list")

        self._classifier = classifier
        self._allowed: Optional[Set[str]] = (
            {t.lower() for t in allowed} if allowed else None
        )
        self._denied: Optional[Set[str]] = (
            {t.lower() for t in denied} if denied else None
        )

    def evaluate(self, text: str) -> GuardResult:
        topic = self._classifier(text).lower().strip()

        if self._allowed is not None and topic not in self._allowed:
            return GuardResult(
                action=self._action,
                score=1.0,
                guard_name=self.name,
                classification=topic,
                explanation=f"Topic '{topic}' is not in the allowed list",
            )

        if self._denied is not None and topic in self._denied:
            return GuardResult(
                action=self._action,
                score=1.0,
                guard_name=self.name,
                classification=topic,
                explanation=f"Topic '{topic}' is in the denied list",
            )

        return GuardResult(guard_name=self.name, classification=topic)
