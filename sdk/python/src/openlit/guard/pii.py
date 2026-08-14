"""
PII & secret detection guard.

Uses ~25 high-confidence regex patterns for API keys, PII, and secrets.
Runs locally in <1 ms.  Supports ``redact``, ``deny``, and ``warn`` actions.
Phases: preflight + postflight.
"""

from __future__ import annotations

import re
from typing import Dict, List, Optional, Tuple

from openlit.guard._base import Guard, GuardAction, GuardPhase, GuardResult

# Each pattern is (label, compiled_regex).  Labels are used in
# ``[REDACTED:<label>]`` placeholders and in ``GuardResult.classification``.
_PATTERNS: List[Tuple[str, re.Pattern]] = []


def _p(label: str, pattern: str, flags: int = 0) -> None:
    _PATTERNS.append((label, re.compile(pattern, flags)))


# ---- API keys / tokens ----
_p("openai-api-key", r"sk-(?:proj-)?[A-Za-z0-9_-]{20,}")
_p("anthropic-api-key", r"sk-ant-[A-Za-z0-9_-]{20,}")
_p("aws-access-key", r"(?<![A-Za-z0-9/+=])AKIA[0-9A-Z]{16}(?![A-Za-z0-9/+=])")
_p("gcp-api-key", r"AIza[0-9A-Za-z_-]{35}")
_p("github-token", r"(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{36,}")
_p("github-fine-grained", r"github_pat_[A-Za-z0-9_]{22,}")
_p("stripe-key", r"(?:sk|pk)_(?:live|test)_[A-Za-z0-9]{24,}")
_p("slack-token", r"xox[bpoas]-[A-Za-z0-9-]{10,}")
_p(
    "slack-webhook",
    r"https://hooks\.slack\.com/services/T[A-Za-z0-9]+/B[A-Za-z0-9]+/[A-Za-z0-9]+",
)
_p("twilio-api-key", r"SK[0-9a-fA-F]{32}")
_p("sendgrid-api-key", r"SG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}")
_p("mailgun-api-key", r"key-[0-9a-zA-Z]{32}")
_p("azure-key", r"[0-9a-f]{32}")  # very generic; kept short to reduce FPs
_p("heroku-api-key", r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")

# ---- PII ----
_p("email", r"[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z]{2,}")
_p("phone-us", r"(?<!\d)(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}(?!\d)")
_p("ssn", r"(?<!\d)\d{3}-\d{2}-\d{4}(?!\d)")
_p(
    "credit-card",
    r"(?<!\d)(?:4\d{3}|5[1-5]\d{2}|3[47]\d{2}|6(?:011|5\d{2}))[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}(?!\d)",
)
_p(
    "ipv4",
    r"(?<!\d)(?:25[0-5]|2[0-4]\d|[01]?\d\d?)(?:\.(?:25[0-5]|2[0-4]\d|[01]?\d\d?)){3}(?!\d)",
)

# ---- Secrets / credentials ----
_p("bearer-token", r"Bearer\s+[A-Za-z0-9_\-.~+/]+=*", re.IGNORECASE)
_p("basic-auth", r"Basic\s+[A-Za-z0-9+/]+=*", re.IGNORECASE)
_p("private-key", r"-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----")
_p("connection-string", r"(?:mongodb(?:\+srv)?|postgres(?:ql)?|mysql|redis|amqp)://\S+")
_p("env-secret", r"(?i)(?:password|secret|token|api_key|apikey)\s*[=:]\s*\S+")


class PII(Guard):
    """
    Detects PII and secrets using high-confidence regex patterns.

    Parameters
    ----------
    action : str
        ``"redact"`` (replace matches with ``[REDACTED:label]``),
        ``"deny"`` (block entirely), or ``"warn"`` (emit event only).
    custom_patterns : dict, optional
        Extra ``{label: regex_string}`` patterns to add.
    """

    name = "pii"
    phases = (GuardPhase.PREFLIGHT, GuardPhase.POSTFLIGHT)

    def __init__(
        self,
        action: str = "redact",
        custom_patterns: Optional[Dict[str, str]] = None,
        **kwargs,
    ):
        super().__init__(action=action, **kwargs)
        self._extra: List[Tuple[str, re.Pattern]] = []
        if custom_patterns:
            for label, pat in custom_patterns.items():
                self._extra.append((label, re.compile(pat)))

    def evaluate(self, text: str) -> GuardResult:
        all_patterns = _PATTERNS + self._extra
        matches: List[Tuple[str, re.Match]] = []

        for label, pattern in all_patterns:
            for m in pattern.finditer(text):
                matches.append((label, m))

        if not matches:
            return GuardResult(guard_name=self.name)

        labels = sorted({label for label, _ in matches})
        classification = ", ".join(labels)
        best_score = min(1.0, len(matches) * 0.2 + 0.5)

        transformed: Optional[str] = None
        if self._action == GuardAction.REDACT:
            sorted_matches = sorted(matches, key=lambda x: x[1].start(), reverse=True)
            result_text = text
            for label, m in sorted_matches:
                result_text = (
                    result_text[: m.start()]
                    + f"[REDACTED:{label}]"
                    + result_text[m.end() :]
                )
            transformed = result_text

        return GuardResult(
            action=self._action,
            score=round(best_score, 2),
            guard_name=self.name,
            classification=classification,
            explanation=f"Detected {len(matches)} PII/secret match(es): {classification}",
            transformed_text=transformed,
        )
