"""
Sensitive topic detection guard.

Uses keyword/regex dictionaries for fast-path detection of sensitive
content categories.  An optional user-provided classifier handles
ambiguous cases.  Phases: preflight + postflight.
"""

from __future__ import annotations

import re
from typing import Callable, Dict, List, Optional, Set

from openlit.guard._base import Guard, GuardPhase, GuardResult

# Built-in category dictionaries.  Each value is a list of regex patterns
# that indicate the topic is present.
_DEFAULT_CATEGORIES: Dict[str, List[re.Pattern]] = {
    "violence": [
        re.compile(
            r"\b(?:kill|murder|assault|attack|weapon|bomb|shoot|stab|torture|terrorism|massacre|genocide)\b",
            re.IGNORECASE,
        ),
    ],
    "politics": [
        re.compile(
            r"\b(?:democrat|republican|election\s+fraud|political\s+party|vote\s+rigging|coup|insurrection)\b",
            re.IGNORECASE,
        ),
    ],
    "substance_use": [
        re.compile(
            r"\b(?:cocaine|heroin|methamphetamine|fentanyl|drug\s+(?:deal|traffick)|overdose|illegal\s+drugs)\b",
            re.IGNORECASE,
        ),
    ],
    "mental_health": [
        re.compile(
            r"\b(?:suicid(?:e|al)|self[- ]harm|eating\s+disorder|anorexia|bulimia)\b",
            re.IGNORECASE,
        ),
    ],
    "discrimination": [
        re.compile(
            r"\b(?:racial\s+slur|white\s+supremac|ethnic\s+cleansing|hate\s+(?:speech|crime))\b",
            re.IGNORECASE,
        ),
    ],
    "adult_content": [
        re.compile(
            r"\b(?:pornograph|explicit\s+sexual|nude\s+images|sex\s+trafficking)\b",
            re.IGNORECASE,
        ),
    ],
}


class SensitiveTopic(Guard):
    """
    Detects sensitive content categories.

    Parameters
    ----------
    action : str
        ``"warn"`` (default), ``"deny"``, or ``"redact"``.
    categories : set[str], optional
        Subset of built-in categories to enable.  ``None`` means all.
    custom_categories : dict, optional
        ``{category_name: [regex_string, ...]}`` to add.
    classifier : callable, optional
        ``Callable[[str], str | None]`` returning a category name or None.
    """

    name = "sensitive_topic"
    phases = (GuardPhase.PREFLIGHT, GuardPhase.POSTFLIGHT)

    def __init__(
        self,
        action: str = "warn",
        categories: Optional[Set[str]] = None,
        custom_categories: Optional[Dict[str, List[str]]] = None,
        classifier: Optional[Callable[[str], Optional[str]]] = None,
        **kwargs,
    ):
        super().__init__(action=action, **kwargs)
        self._categories = categories
        self._classifier = classifier

        self._patterns: Dict[str, List[re.Pattern]] = {}
        for cat, pats in _DEFAULT_CATEGORIES.items():
            if categories is None or cat in categories:
                self._patterns[cat] = pats

        if custom_categories:
            for cat, raw_pats in custom_categories.items():
                compiled = [re.compile(p, re.IGNORECASE) for p in raw_pats]
                self._patterns.setdefault(cat, []).extend(compiled)

    def evaluate(self, text: str) -> GuardResult:
        detected: List[str] = []

        for cat, patterns in self._patterns.items():
            for pat in patterns:
                if pat.search(text):
                    detected.append(cat)
                    break

        if not detected and self._classifier is not None:
            result = self._classifier(text)
            if result:
                detected.append(result)

        if detected:
            classification = ", ".join(sorted(detected))
            return GuardResult(
                action=self._action,
                score=round(min(1.0, len(detected) * 0.3 + 0.4), 2),
                guard_name=self.name,
                classification=classification,
                explanation=f"Sensitive topic(s) detected: {classification}",
            )

        return GuardResult(guard_name=self.name)
