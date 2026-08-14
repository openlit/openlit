# pylint: disable=missing-function-docstring
"""
Tests for the OpenTelemetry-native evaluation score helper.
"""

from unittest.mock import MagicMock, Mock, patch

import pytest

from openlit.score import record_evaluation_score
from openlit.semcov import SemanticConvention


def test_record_evaluation_score_adds_numeric_score_to_explicit_span():
    span = Mock()
    span.is_recording.return_value = True

    emitted = record_evaluation_score("quality", 0.85, span=span)

    assert emitted is True
    span.add_event.assert_called_once_with(
        SemanticConvention.GEN_AI_EVALUATION_RESULT,
        attributes={
            SemanticConvention.GEN_AI_EVALUATION_NAME: "quality",
            SemanticConvention.GEN_AI_EVALUATION_SCORE_VALUE: 0.85,
        },
    )


def test_record_evaluation_score_maps_true_boolean_score():
    span = Mock()
    span.is_recording.return_value = True

    emitted = record_evaluation_score("user_feedback", True, span=span)

    assert emitted is True
    span.add_event.assert_called_once_with(
        SemanticConvention.GEN_AI_EVALUATION_RESULT,
        attributes={
            SemanticConvention.GEN_AI_EVALUATION_NAME: "user_feedback",
            SemanticConvention.GEN_AI_EVALUATION_SCORE_VALUE: 1.0,
            SemanticConvention.GEN_AI_EVALUATION_SCORE_LABEL: "true",
        },
    )


def test_record_evaluation_score_maps_false_boolean_score():
    span = Mock()
    span.is_recording.return_value = True

    emitted = record_evaluation_score("user_feedback", False, span=span)

    assert emitted is True
    span.add_event.assert_called_once_with(
        SemanticConvention.GEN_AI_EVALUATION_RESULT,
        attributes={
            SemanticConvention.GEN_AI_EVALUATION_NAME: "user_feedback",
            SemanticConvention.GEN_AI_EVALUATION_SCORE_VALUE: 0.0,
            SemanticConvention.GEN_AI_EVALUATION_SCORE_LABEL: "false",
        },
    )


def test_record_evaluation_score_maps_categorical_score():
    span = Mock()
    span.is_recording.return_value = True

    emitted = record_evaluation_score("category", "accurate", span=span)

    assert emitted is True
    span.add_event.assert_called_once_with(
        SemanticConvention.GEN_AI_EVALUATION_RESULT,
        attributes={
            SemanticConvention.GEN_AI_EVALUATION_NAME: "category",
            SemanticConvention.GEN_AI_EVALUATION_SCORE_LABEL: "accurate",
        },
    )


def test_record_evaluation_score_uses_current_span_when_span_not_provided():
    span = Mock()
    span.is_recording.return_value = True

    with patch("opentelemetry.trace.get_current_span", return_value=span):
        emitted = record_evaluation_score("quality", 0.5)

    assert emitted is True
    span.add_event.assert_called_once()


def test_record_evaluation_score_targets_span_from_trace_and_span_ids():
    mock_logger = MagicMock()
    mock_provider = MagicMock()
    mock_provider.get_logger.return_value = mock_logger

    with patch("openlit.score._events_disabled", return_value=False), patch(
        "opentelemetry._logs.get_logger_provider", return_value=mock_provider
    ), patch("opentelemetry.trace.get_current_span", return_value=Mock(is_recording=Mock(return_value=False))):
        emitted = record_evaluation_score(
            "user_feedback",
            False,
            trace_id="0123456789abcdef0123456789abcdef",
            span_id="0123456789abcdef",
        )

    assert emitted is True
    mock_logger.emit.assert_called_once()


def test_record_evaluation_score_returns_false_for_invalid_trace_and_span_ids():
    with patch("openlit.score._events_disabled", return_value=True), patch(
        "opentelemetry.trace.get_current_span", return_value=Mock(is_recording=Mock(return_value=False))
    ):
        emitted = record_evaluation_score(
            "quality",
            0.5,
            trace_id="not-a-valid-trace-id",
            span_id="bad",
        )

    assert emitted is False


def test_record_evaluation_score_returns_false_without_target_span():
    inactive_span = Mock()
    inactive_span.is_recording.return_value = False

    with patch("openlit.score._events_disabled", return_value=True), patch(
        "opentelemetry.trace.get_current_span", return_value=inactive_span
    ):
        emitted = record_evaluation_score("quality", 0.5)

    assert emitted is False
    inactive_span.add_event.assert_not_called()


def test_record_evaluation_score_requires_name():
    with pytest.raises(ValueError, match="name is required"):
        record_evaluation_score("", 0.5)


def test_record_evaluation_score_includes_comment_metadata_and_idempotency_key():
    span = Mock()
    span.is_recording.return_value = True

    record_evaluation_score(
        "quality",
        0.9,
        span=span,
        comment="Looks good",
        idempotency_key="score-123",
        metadata={"reviewer": "human", "ignored": None},
    )

    span.add_event.assert_called_once_with(
        SemanticConvention.GEN_AI_EVALUATION_RESULT,
        attributes={
            SemanticConvention.GEN_AI_EVALUATION_NAME: "quality",
            SemanticConvention.GEN_AI_EVALUATION_SCORE_VALUE: 0.9,
            SemanticConvention.GEN_AI_EVALUATION_EXPLANATION: "Looks good",
            SemanticConvention.OPENLIT_SCORE_IDEMPOTENCY_KEY: "score-123",
            "reviewer": "human",
        },
    )


def test_record_evaluation_score_includes_custom_span_attributes():
    span = Mock()
    span.is_recording.return_value = True

    with patch(
        "openlit.score.OpenlitConfig.custom_span_attributes",
        {"session.id": "sess-1"},
        create=True,
    ), patch("openlit.score.get_custom_attributes", return_value={"user.id": "user-1"}), patch(
        "openlit.score._events_disabled", return_value=True
    ):
        record_evaluation_score("quality", 0.5, span=span)

    attributes = span.add_event.call_args.kwargs["attributes"]
    assert attributes["session.id"] == "sess-1"
    assert attributes["user.id"] == "user-1"


def test_log_score_returns_emitted_result():
    span = Mock()
    span.is_recording.return_value = True

    import openlit

    with patch("openlit.score.record_evaluation_score", return_value=True) as mock_record:
        emitted = openlit.log_score("quality", 0.5, span=span)

    assert emitted is True
    mock_record.assert_called_once()


def test_log_score_reraises_value_error():
    import openlit

    with pytest.raises(ValueError, match="name is required"):
        openlit.log_score("", 0.5)
