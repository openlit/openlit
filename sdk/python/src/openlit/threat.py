"""
Threat telemetry helpers for AI applications.
"""

from opentelemetry import trace

from openlit.semcov import SemanticConvention

_VALID_SEVERITIES = {"low", "medium", "high", "critical"}
_CORE_ATTRIBUTE_KEYS = {
    SemanticConvention.GEN_AI_AGENT_THREAT_RULE_ID,
    SemanticConvention.GEN_AI_AGENT_THREAT_SEVERITY,
    SemanticConvention.GEN_AI_AGENT_THREAT_CLASS,
}


def record_threat_detected(
    rule_id: str,
    severity: str,
    threat_class: str,
    *,
    span=None,
    **attributes,
) -> bool:
    """
    Add a `gen_ai.agent.threat_detected` event to the current span.

    Returns `True` when an event is emitted and `False` when no recording span is
    available. This keeps guardrail and scanner integrations safe to call from
    request paths where tracing may be disabled.
    """
    if not rule_id:
        raise ValueError("rule_id is required")
    if severity not in _VALID_SEVERITIES:
        raise ValueError("severity must be one of: critical, high, medium, low")
    if not threat_class:
        raise ValueError("threat_class is required")

    target_span = span or trace.get_current_span()
    if not target_span or not target_span.is_recording():
        return False

    event_attributes = {
        key: value
        for key, value in attributes.items()
        if isinstance(key, str)
        and value is not None
        and key not in _CORE_ATTRIBUTE_KEYS
    }
    event_attributes[SemanticConvention.GEN_AI_AGENT_THREAT_RULE_ID] = rule_id
    event_attributes[SemanticConvention.GEN_AI_AGENT_THREAT_SEVERITY] = severity
    event_attributes[SemanticConvention.GEN_AI_AGENT_THREAT_CLASS] = threat_class

    target_span.add_event(
        SemanticConvention.GEN_AI_AGENT_THREAT_DETECTED,
        attributes=event_attributes,
    )
    return True
