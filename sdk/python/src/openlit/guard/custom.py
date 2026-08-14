"""
Custom guard -- user-defined regex or callable.
"""

from __future__ import annotations

import re
from typing import Callable, List, Optional

from openlit.guard._base import Guard, GuardConfigError, GuardPhase, GuardResult


class Custom(Guard):
    """
    A user-defined guard backed by a regex pattern and/or a callable.

    Parameters
    ----------
    action : str
        ``"deny"``, ``"warn"``, or ``"redact"``.
    pattern : str, optional
        A regex pattern.  If it matches, the guard triggers.
    callable : callable, optional
        ``Callable[[str], GuardResult]`` for arbitrary logic.
    phases : list[str], optional
        ``["preflight"]``, ``["postflight"]``, or both (default).
    """

    name = "custom"

    def __init__(
        self,
        action: str = "deny",
        pattern: Optional[str] = None,
        callable: Optional[Callable[[str], GuardResult]] = None,  # pylint: disable=redefined-builtin
        phases: Optional[List[str]] = None,
        **kwargs,
    ):
        super().__init__(action=action, **kwargs)

        if pattern is None and callable is None:
            raise GuardConfigError(
                "Custom guard needs at least 'pattern' or 'callable'"
            )

        self._pattern: Optional[re.Pattern] = re.compile(pattern) if pattern else None
        self._callable = callable

        if phases:
            self.phases = tuple(GuardPhase(p) for p in phases)
        else:
            self.phases = (GuardPhase.PREFLIGHT, GuardPhase.POSTFLIGHT)

    def evaluate(self, text: str) -> GuardResult:
        if self._pattern:
            match = self._pattern.search(text)
            if match:
                return GuardResult(
                    action=self._action,
                    score=1.0,
                    guard_name=self.name,
                    classification="pattern_match",
                    explanation=f"Custom pattern matched: {match.group()!r}",
                )

        if self._callable is not None:
            return self._callable(text)

        return GuardResult(guard_name=self.name)
