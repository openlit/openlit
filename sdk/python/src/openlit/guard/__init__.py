"""
openlit.guard -- Production-grade guardrails for LLM applications.

All guard classes are also re-exported at the ``openlit`` top level:

    import openlit
    openlit.init(guards=[openlit.PII(action="redact")])

Or with direct imports:

    from openlit import PII, PromptInjection, Moderation
"""

from openlit.guard._base import (
    Guard,
    GuardAction,
    GuardConfigError,
    GuardDeniedError,
    GuardError,
    GuardPhase,
    GuardResult,
    GuardTimeoutError,
    PipelineResult,
)
from openlit.guard._pipeline import Pipeline
from openlit.guard.pii import PII
from openlit.guard.prompt_injection import PromptInjection
from openlit.guard.sensitive_topic import SensitiveTopic
from openlit.guard.topic_restriction import TopicRestriction
from openlit.guard.moderation import Moderation
from openlit.guard.schema import Schema
from openlit.guard.custom import Custom

__all__ = [
    # Guard classes
    "PII",
    "PromptInjection",
    "SensitiveTopic",
    "TopicRestriction",
    "Moderation",
    "Schema",
    "Custom",
    # Pipeline
    "Pipeline",
    # Base / types
    "Guard",
    "GuardAction",
    "GuardPhase",
    "GuardResult",
    "PipelineResult",
    # Errors
    "GuardError",
    "GuardDeniedError",
    "GuardTimeoutError",
    "GuardConfigError",
]
