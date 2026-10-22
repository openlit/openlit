"""Responses API streams that end on response.incomplete or response.failed."""

import time
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import (
    InMemorySpanExporter,
)

from openlit._config import OpenlitConfig
from openlit.instrumentation.openai.utils import (
    process_response_chunk,
    process_streaming_response_response,
)
from openlit.semcov import SemanticConvention


def _tracer_and_exporter():
    OpenlitConfig.reset_to_defaults()
    exporter = InMemorySpanExporter()
    tracer_provider = TracerProvider()
    tracer_provider.add_span_processor(SimpleSpanProcessor(exporter))
    return tracer_provider.get_tracer("test-openai-reasoning-tokens"), exporter


def _metrics_dict():
    """MagicMock metric instruments mirroring openlit.otel.metrics.build_metrics()."""
    return {
        "genai_client_usage_tokens": MagicMock(),
        "genai_client_operation_duration": MagicMock(),
        "genai_client_time_to_first_chunk": MagicMock(),
        "genai_client_time_per_output_chunk": MagicMock(),
        "genai_server_tbt": MagicMock(),
        "genai_server_ttft": MagicMock(),
        "genai_server_request_duration": MagicMock(),
        "genai_cost": MagicMock(),
    }


def _output_token_usage_records(metrics):
    """Return [(value, attrs)] of gen_ai.client.token.usage{token_type=output}."""
    records = []
    for call in metrics["genai_client_usage_tokens"].record.call_args_list:
        value, attrs = call.args
        if (
            attrs.get(SemanticConvention.GEN_AI_TOKEN_TYPE)
            == SemanticConvention.GEN_AI_TOKEN_TYPE_OUTPUT
        ):
            records.append((value, attrs))
    return records


def _assert_no_double_counting(attrs, metrics, output_tokens=1000, reasoning_tokens=700):
    """Shared invariant: reasoning is a subset of output, never added on top."""
    # Span attributes
    assert attrs[SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS] == output_tokens
    assert (
        attrs[SemanticConvention.GEN_AI_USAGE_REASONING_OUTPUT_TOKENS]
        == reasoning_tokens
    )
    # OpenLIT legacy alias (pre-OTel naming) must stay populated for backward
    # compatibility.
    assert attrs[SemanticConvention.GEN_AI_USAGE_REASONING_TOKENS] == reasoning_tokens

    # gen_ai.client.token.usage{token_type=output} must stay 1000, not 1700
    output_records = _output_token_usage_records(metrics)
    assert output_records, "expected at least one output token usage record"
    for value, _attrs in output_records:
        assert value == output_tokens
        assert (
            _attrs.get(SemanticConvention.GEN_AI_TOKEN_TYPE)
            == SemanticConvention.GEN_AI_TOKEN_TYPE_OUTPUT
        )
    assert all(
        value != output_tokens + reasoning_tokens for value, _ in output_records
    ), "reasoning tokens must not be added on top of the output total"


def _responses_stream_scope(span):
    """Responses streaming scope. Matches production: no _reasoning_tokens until usage."""
    return SimpleNamespace(
        _span=span,
        _llmresponse="",
        _response_id="",
        _response_model="",
        _finish_reason="",
        _input_tokens=0,
        _output_tokens=0,
        _operation_type="responses",
        _service_tier="default",
        _tools=None,
        _response_tools=None,
        _kwargs={
            "model": "o3-mini",
            "input": "think step by step",
        },
        _start_time=time.time(),
        _end_time=None,
        _timestamps=[],
        _ttft=0,
        _tbt=0,
        _server_address="api.openai.com",
        _server_port=443,
    )


@pytest.mark.parametrize(
    "event_type, status",
    [("response.incomplete", "incomplete"), ("response.failed", "failed")],
)
def test_streaming_responses_terminal_event_records_usage_and_status(
    event_type, status
):
    """A stream can end on response.incomplete or response.failed instead of
    response.completed; its response still carries the id, model, status and usage."""
    tracer, exporter = _tracer_and_exporter()
    metrics = _metrics_dict()
    span = tracer.start_span("responses stream o3-mini")
    scope = _responses_stream_scope(span)

    process_response_chunk(
        scope,
        {"type": "response.output_text.delta", "delta": "The answer is"},
    )
    process_response_chunk(
        scope,
        {
            "type": event_type,
            "response": {
                "id": "resp_stream_1",
                "model": "o3-mini-2025-01-31",
                "status": status,
                "usage": {
                    "input_tokens": 500,
                    "output_tokens": 16,
                    "output_tokens_details": {"reasoning_tokens": 0},
                },
            },
        },
    )

    with span:
        process_streaming_response_response(
            scope,
            pricing_info={},
            environment="test-env",
            application_name="test-app",
            metrics=metrics,
            capture_message_content=False,
            disable_metrics=False,
            version="test-version",
        )

    attrs = exporter.get_finished_spans()[0].attributes
    assert attrs[SemanticConvention.GEN_AI_RESPONSE_ID] == "resp_stream_1"
    assert attrs[SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON] == (status,)
    assert attrs[SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS] == 500
    assert attrs[SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS] == 16


def test_streaming_responses_failed_event_without_usage():
    """A failed response may carry no usage; the status is still recorded."""
    tracer, exporter = _tracer_and_exporter()
    metrics = _metrics_dict()
    span = tracer.start_span("responses stream o3-mini")
    scope = _responses_stream_scope(span)

    process_response_chunk(
        scope,
        {
            "type": "response.failed",
            "response": {
                "id": "resp_stream_2",
                "model": "o3-mini",
                "status": "failed",
                "usage": None,
            },
        },
    )

    with span:
        process_streaming_response_response(
            scope,
            pricing_info={},
            environment="test-env",
            application_name="test-app",
            metrics=metrics,
            capture_message_content=False,
            disable_metrics=False,
            version="test-version",
        )

    attrs = exporter.get_finished_spans()[0].attributes
    assert attrs[SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON] == ("failed",)
