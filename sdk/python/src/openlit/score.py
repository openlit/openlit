"""
Evaluation score telemetry helpers for attaching external scores and user feedback
to GenAI spans.
"""

from __future__ import annotations

import logging
import re
from typing import Any, Dict, Optional, Union

from opentelemetry import _logs, trace
from opentelemetry.trace import NonRecordingSpan, SpanContext, TraceFlags

from openlit._config import OpenlitConfig
from openlit.__helpers import get_custom_attributes
from openlit.semcov import SemanticConvention

logger = logging.getLogger(__name__)

ScoreValue = Union[float, int, bool, str]

_OTEL_SAFE_METADATA_TYPES = (str, int, float, bool)

_HEX_RE = re.compile(r"^[0-9a-fA-F]+$")


def _normalize_score_value(value: ScoreValue) -> Dict[str, Any]:
    if isinstance(value, bool):
        return {
            SemanticConvention.GEN_AI_EVALUATION_SCORE_VALUE: 1.0 if value else 0.0,
            SemanticConvention.GEN_AI_EVALUATION_SCORE_LABEL: "true" if value else "false",
        }
    if isinstance(value, (int, float)):
        return {SemanticConvention.GEN_AI_EVALUATION_SCORE_VALUE: float(value)}
    if isinstance(value, str):
        return {SemanticConvention.GEN_AI_EVALUATION_SCORE_LABEL: value}
    raise TypeError("value must be numeric, boolean, or string")


def _merge_metadata(
    event_attributes: Dict[str, Any],
    metadata: Optional[Dict[str, Any]],
) -> None:
    if not metadata:
        return
    for key, value in metadata.items():
        if not isinstance(key, str) or value is None:
            continue
        if isinstance(value, _OTEL_SAFE_METADATA_TYPES):
            event_attributes[key] = value
        elif isinstance(value, (list, tuple)) and all(
            isinstance(item, _OTEL_SAFE_METADATA_TYPES) for item in value
        ):
            event_attributes[key] = list(value)


def _merge_custom_event_attributes(event_attributes: Dict[str, Any]) -> None:
    global_attrs = getattr(OpenlitConfig, "custom_span_attributes", None)
    if global_attrs:
        for key, value in global_attrs.items():
            event_attributes.setdefault(key, value)

    context_attrs = get_custom_attributes()
    if context_attrs:
        event_attributes.update(context_attrs)


def _valid_hex_id(value: str, expected_len: int) -> bool:
    return len(value) == expected_len and _HEX_RE.match(value) is not None


def _span_from_ids(trace_id: str, span_id: str) -> Optional[NonRecordingSpan]:
    if not _valid_hex_id(trace_id, 32) or not _valid_hex_id(span_id, 16):
        logger.debug("Invalid trace_id/span_id: trace_id=%s span_id=%s", trace_id, span_id)
        return None
    return NonRecordingSpan(
        SpanContext(
            trace_id=int(trace_id, 16),
            span_id=int(span_id, 16),
            is_remote=True,
            trace_flags=TraceFlags(TraceFlags.SAMPLED),
        )
    )


def _resolve_target_span(span=None, trace_id: Optional[str] = None, span_id: Optional[str] = None):
    if span is not None:
        return span
    current_span = trace.get_current_span()
    if current_span and current_span.is_recording():
        return current_span
    if trace_id and span_id:
        return _span_from_ids(trace_id, span_id)
    if current_span:
        return current_span
    return None


def _events_disabled() -> bool:
    return bool(getattr(OpenlitConfig, "disable_events", False))


def _emit_score_log_event(event_attributes: Dict[str, Any], target_span) -> bool:
    if _events_disabled():
        return False
    try:
        from opentelemetry._logs import LogRecord

        event_logger = _logs.get_logger_provider().get_logger(__name__)
        span_context = target_span.get_span_context()
        event = LogRecord(  # pylint: disable=unexpected-keyword-arg
            attributes=event_attributes,
            body="",
            event_name=SemanticConvention.GEN_AI_EVALUATION_RESULT,
            trace_id=span_context.trace_id,
            span_id=span_context.span_id,
            trace_flags=span_context.trace_flags,
        )
        event_logger.emit(event)
        return True
    except Exception as exc:
        logger.debug("Failed to emit evaluation score log event: %s", exc)
        return False


def record_evaluation_score(
    name: str,
    value: ScoreValue,
    *,
    span=None,
    trace_id: Optional[str] = None,
    span_id: Optional[str] = None,
    comment: Optional[str] = None,
    idempotency_key: Optional[str] = None,
    metadata: Optional[Dict[str, Any]] = None,
) -> bool:
    """
    Attach a ``gen_ai.evaluation.result`` event to a GenAI span.

    Returns ``True`` when an event is emitted and ``False`` when no target span
    is available or telemetry could not be exported.
    """
    if not name:
        raise ValueError("name is required")

    target_span = _resolve_target_span(span=span, trace_id=trace_id, span_id=span_id)
    if not target_span:
        return False

    event_attributes = {
        SemanticConvention.GEN_AI_EVALUATION_NAME: name,
        **_normalize_score_value(value),
    }
    if comment:
        event_attributes[SemanticConvention.GEN_AI_EVALUATION_EXPLANATION] = comment
    if idempotency_key:
        event_attributes[SemanticConvention.OPENLIT_SCORE_IDEMPOTENCY_KEY] = idempotency_key
    _merge_metadata(event_attributes, metadata)
    _merge_custom_event_attributes(event_attributes)

    emitted = False
    if target_span.is_recording():
        target_span.add_event(
            SemanticConvention.GEN_AI_EVALUATION_RESULT,
            attributes=event_attributes,
        )
        emitted = True

    if _emit_score_log_event(event_attributes, target_span):
        emitted = True

    return emitted
