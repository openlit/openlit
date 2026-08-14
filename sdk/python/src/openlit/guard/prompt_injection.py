"""
Prompt injection & jailbreak detection guard.

Fast regex patterns catch known injection signatures.  An optional
user-provided ``Callable[[str], float]`` handles ambiguous cases.
Phases: preflight only.
"""

from __future__ import annotations

import re
from typing import Callable, List, Optional, Tuple

from openlit.guard._base import Guard, GuardPhase, GuardResult

# (label, pattern, weight)  -- weight contributes to the aggregated score.
_INJECTION_PATTERNS: List[Tuple[str, re.Pattern, float]] = []


def _p(label: str, pattern: str, weight: float = 0.5) -> None:
    _INJECTION_PATTERNS.append((label, re.compile(pattern, re.IGNORECASE), weight))


# ---- Instruction override ----
_p(
    "instruction-override",
    r"ignore\s+(?:all\s+)?(?:previous|above|prior)\s+(?:instructions|prompts|rules)",
    0.9,
)
_p(
    "instruction-override-2",
    r"disregard\s+(?:all\s+)?(?:previous|above|prior)\s+(?:instructions|context)",
    0.9,
)
_p("new-instructions", r"(?:new|updated|revised)\s+instructions\s*:", 0.7)
_p("do-anything-now", r"(?:DAN|do\s+anything\s+now)\s+mode", 0.95)
_p("jailbreak-keyword", r"jailbreak(?:ed|ing)?", 0.8)

# ---- System prompt extraction ----
_p(
    "system-prompt-leak",
    (
        r"(?:show|reveal|display|print|output|repeat|tell\s+me)"
        r"\s+(?:your|the|me\s+your)"
        r"\s*(?:system|initial|original|hidden)"
        r"\s+(?:prompt|instructions|message)"
    ),
    0.85,
)
_p(
    "system-prompt-leak-2",
    r"what\s+(?:are|were)\s+your\s+(?:system|initial|original)\s+(?:instructions|prompt)",
    0.8,
)
_p(
    "system-prompt-leak-3",
    r"(?:show|reveal|display|print|output|repeat)\s+(?:me\s+)?your\s+(?:system\s+)?prompt",
    0.8,
)

# ---- Role impersonation ----
_p(
    "role-play",
    (
        r"(?:you\s+are\s+now|act\s+as|pretend\s+(?:to\s+be|you\s+are)|roleplay\s+as)"
        r"\s+(?:a\s+)?(?:hacker|evil|malicious|unrestricted|unfiltered)"
    ),
    0.85,
)
_p("developer-mode", r"(?:developer|debug|admin|god|sudo|root)\s+mode", 0.7)

# ---- Encoding bypass ----
_p("base64-injection", r"(?:decode|base64|eval)\s*\(", 0.6)
_p("markdown-injection", r"\[.*?\]\((?:javascript|data):", 0.8)

# ---- Delimiter abuse ----
_p(
    "delimiter-abuse",
    r"={5,}|<\|(?:im_start|system|endoftext)\|>|###\s*(?:system|instruction)",
    0.7,
)


class PromptInjection(Guard):
    """
    Detects prompt injection and jailbreak attempts.

    Parameters
    ----------
    action : str
        ``"deny"`` (block the call) or ``"warn"`` (emit event only).
    threshold : float
        Minimum aggregated score to trigger the configured action (0.0--1.0).
    classifier : callable, optional
        ``Callable[[str], float]`` returning an injection probability (0--1).
        Used as a fallback when regex patterns don't match.
    """

    name = "prompt_injection"
    phases = (GuardPhase.PREFLIGHT,)

    def __init__(
        self,
        action: str = "deny",
        threshold: float = 0.5,
        classifier: Optional[Callable[[str], float]] = None,
        **kwargs,
    ):
        super().__init__(action=action, **kwargs)
        self._threshold = threshold
        self._classifier = classifier

    def evaluate(self, text: str) -> GuardResult:
        matched_labels: List[str] = []
        max_weight = 0.0

        for label, pattern, weight in _INJECTION_PATTERNS:
            if pattern.search(text):
                matched_labels.append(label)
                max_weight = max(max_weight, weight)

        score = max_weight

        if not matched_labels and self._classifier is not None:
            score = self._classifier(text)

        if score >= self._threshold:
            classification = (
                ", ".join(matched_labels) if matched_labels else "classifier"
            )
            return GuardResult(
                action=self._action,
                score=round(score, 3),
                guard_name=self.name,
                classification=classification,
                explanation=f"Prompt injection detected (score={score:.2f}): {classification}",
            )

        return GuardResult(guard_name=self.name, score=round(score, 3))
