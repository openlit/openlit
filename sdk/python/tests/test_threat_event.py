# pylint: disable=missing-function-docstring
"""
Tests for the OpenTelemetry-native agent threat detection event helper.
"""

from unittest.mock import Mock, patch

import pytest

from openlit.threat import record_threat_detected
from openlit.semcov import SemanticConvention


def test_record_threat_detected_adds_standard_event_to_explicit_span():
    span = Mock()
    span.is_recording.return_value = True

    emitted = record_threat_detected(
        "openlit.guard.prompt_injection.impersonation",
        "high",
        "prompt_injection",
        span=span,
        detector="openlit.guard",
        confidence=0.94,
        ignored=None,
    )

    assert emitted is True
    span.add_event.assert_called_once_with(
        SemanticConvention.GEN_AI_AGENT_THREAT_DETECTED,
        attributes={
            SemanticConvention.GEN_AI_AGENT_THREAT_RULE_ID: (
                "openlit.guard.prompt_injection.impersonation"
            ),
            SemanticConvention.GEN_AI_AGENT_THREAT_SEVERITY: "high",
            SemanticConvention.GEN_AI_AGENT_THREAT_CLASS: "prompt_injection",
            "detector": "openlit.guard",
            "confidence": 0.94,
        },
    )


def test_record_threat_detected_uses_current_span_when_span_not_provided():
    span = Mock()
    span.is_recording.return_value = True

    with patch("opentelemetry.trace.get_current_span", return_value=span):
        emitted = record_threat_detected(
            "atr-2026-00001",
            "critical",
            "exfiltration",
        )

    assert emitted is True
    assert (
        span.add_event.call_args[0][0]
        == SemanticConvention.GEN_AI_AGENT_THREAT_DETECTED
    )


def test_record_threat_detected_preserves_validated_core_attributes():
    span = Mock()
    span.is_recording.return_value = True

    emitted = record_threat_detected(
        "rule-1",
        "high",
        "jailbreak",
        span=span,
        detector="openlit.guard",
        **{
            SemanticConvention.GEN_AI_AGENT_THREAT_RULE_ID: "rule-2",
            SemanticConvention.GEN_AI_AGENT_THREAT_SEVERITY: "low",
            SemanticConvention.GEN_AI_AGENT_THREAT_CLASS: "prompt_injection",
        },
    )

    assert emitted is True
    span.add_event.assert_called_once_with(
        SemanticConvention.GEN_AI_AGENT_THREAT_DETECTED,
        attributes={
            SemanticConvention.GEN_AI_AGENT_THREAT_RULE_ID: "rule-1",
            SemanticConvention.GEN_AI_AGENT_THREAT_SEVERITY: "high",
            SemanticConvention.GEN_AI_AGENT_THREAT_CLASS: "jailbreak",
            "detector": "openlit.guard",
        },
    )


def test_record_threat_detected_returns_false_without_recording_span():
    span = Mock()
    span.is_recording.return_value = False

    emitted = record_threat_detected(
        "rule-1",
        "medium",
        "jailbreak",
        span=span,
    )

    assert emitted is False
    span.add_event.assert_not_called()


@pytest.mark.parametrize("severity", ["", "warn", "severe", "HIGH"])
def test_record_threat_detected_rejects_invalid_severity(severity):
    with pytest.raises(ValueError, match="severity must be one of"):
        record_threat_detected("rule-1", severity, "prompt_injection")


@pytest.mark.parametrize(
    ("rule_id", "threat_class", "message"),
    [
        ("", "prompt_injection", "rule_id is required"),
        ("rule-1", "", "threat_class is required"),
    ],
)
def test_record_threat_detected_requires_core_attributes(rule_id, threat_class, message):
    with pytest.raises(ValueError, match=message):
        record_threat_detected(rule_id, "low", threat_class)
