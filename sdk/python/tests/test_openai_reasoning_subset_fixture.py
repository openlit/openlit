"""Fixture tests for the reasoning-subset invariant (Issue #1537).

Locks the invariant into a regression fixture for the OpenAI chat-completions
path, in the exact shape proposed in #1537:

    usage = {output_tokens: 1000, reasoning_tokens: 700}
      -> recorded output = 1000 (provider total, unchanged)
      -> reasoning emitted as a facet (700), never added on top
      -> no downstream aggregate can reach 1700
      -> a derived "completed tokens" figure equals output - reasoning and is
         namespaced gen_ai.usage.derived.* so it reads as derived
      -> a provider that stops sending *_tokens_details surfaces as unknown
         (reported marker false, no facet value), never as a guessed 0
      -> an explicit reasoning_tokens: 0 is a measurement: facet 0, marker true
"""

import time
from types import SimpleNamespace
from unittest.mock import MagicMock

from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import (
    InMemorySpanExporter,
)

from openlit._config import OpenlitConfig
from openlit.instrumentation.openai.utils import (
    process_chat_chunk,
    process_chat_response,
    process_streaming_chat_response,
)
from openlit.semcov import SemanticConvention


def _tracer_and_exporter():
    OpenlitConfig.reset_to_defaults()
    exporter = InMemorySpanExporter()
    tracer_provider = TracerProvider()
    tracer_provider.add_span_processor(SimpleSpanProcessor(exporter))
    return tracer_provider.get_tracer("test-openai-reasoning-fixture"), exporter


def _metrics_dict():
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


def _stream_scope(span):
    return SimpleNamespace(
        _span=span,
        _llmresponse="",
        _response_id="",
        _response_model="",
        _finish_reason="",
        _system_fingerprint="",
        _service_tier="auto",
        _tools=None,
        _kwargs={
            "model": "o3-mini",
            "messages": [{"role": "user", "content": "think step by step"}],
        },
        _start_time=time.time(),
        _end_time=None,
        _timestamps=[],
        _ttft=0,
        _tbt=0,
        _server_address="api.openai.com",
        _server_port=443,
    )


def _run_chat_response(exporter, tracer, metrics, usage):
    response = {
        "id": "chatcmpl_fixture",
        "model": "o3-mini",
        "choices": [
            {
                "message": {"role": "assistant", "content": "The answer is 42."},
                "finish_reason": "stop",
            }
        ],
        "usage": usage,
    }
    with tracer.start_as_current_span("chat fixture") as span:
        process_chat_response(
            response,
            request_model="o3-mini",
            pricing_info={},
            server_port=443,
            server_address="api.openai.com",
            environment="test-env",
            application_name="test-app",
            metrics=metrics,
            start_time=time.time(),
            span=span,
            capture_message_content=False,
            disable_metrics=False,
            version="test-version",
            model="o3-mini",
            messages=[{"role": "user", "content": "hi"}],
        )
    return exporter.get_finished_spans()[0].attributes


def test_fixture_recorded_values_never_reach_the_sum():
    """output 1000 / reasoning 700: facet 700, derived 300, no 1700 anywhere."""
    tracer, exporter = _tracer_and_exporter()
    metrics = _metrics_dict()
    attrs = _run_chat_response(
        tracer=tracer,
        exporter=exporter,
        metrics=metrics,
        usage={
            "prompt_tokens": 500,
            "completion_tokens": 1000,
            "completion_tokens_details": {
                "reasoning_tokens": 700,
                "text_tokens": 300,
            },
        },
    )
    assert attrs[SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS] == 1000
    assert attrs[SemanticConvention.GEN_AI_USAGE_REASONING_OUTPUT_TOKENS] == 700
    assert (
        attrs[SemanticConvention.GEN_AI_USAGE_REASONING_OUTPUT_TOKENS_REPORTED]
        is True
    )
    assert (
        attrs[SemanticConvention.GEN_AI_USAGE_DERIVED_COMPLETED_OUTPUT_TOKENS]
        == 300
    )
    # No single recorded value may equal the forbidden aggregate.
    forbidden = 1700
    assert all(value != forbidden for value in attrs.values())
    for call in metrics["genai_client_usage_tokens"].record.call_args_list:
        assert call.args[0] != forbidden


def test_fixture_missing_details_is_unknown_not_zero():
    """No completion_tokens_details: reported false, no facet value."""
    tracer, exporter = _tracer_and_exporter()
    metrics = _metrics_dict()
    attrs = _run_chat_response(
        tracer=tracer,
        exporter=exporter,
        metrics=metrics,
        usage={"prompt_tokens": 500, "completion_tokens": 1000},
    )
    assert attrs[SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS] == 1000
    assert SemanticConvention.GEN_AI_USAGE_REASONING_OUTPUT_TOKENS not in attrs
    assert (
        attrs[SemanticConvention.GEN_AI_USAGE_REASONING_OUTPUT_TOKENS_REPORTED]
        is False
    )
    assert SemanticConvention.GEN_AI_USAGE_DERIVED_COMPLETED_OUTPUT_TOKENS not in attrs


def test_fixture_explicit_zero_is_a_measurement():
    """reasoning_tokens: 0 is measured zero, distinct from unknown."""
    tracer, exporter = _tracer_and_exporter()
    metrics = _metrics_dict()
    attrs = _run_chat_response(
        tracer=tracer,
        exporter=exporter,
        metrics=metrics,
        usage={
            "prompt_tokens": 500,
            "completion_tokens": 1000,
            "completion_tokens_details": {"reasoning_tokens": 0},
        },
    )
    assert attrs[SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS] == 1000
    assert attrs[SemanticConvention.GEN_AI_USAGE_REASONING_OUTPUT_TOKENS] == 0
    assert (
        attrs[SemanticConvention.GEN_AI_USAGE_REASONING_OUTPUT_TOKENS_REPORTED]
        is True
    )
    assert (
        attrs[SemanticConvention.GEN_AI_USAGE_DERIVED_COMPLETED_OUTPUT_TOKENS]
        == 1000
    )


def test_fixture_streaming_chat_path():
    """The same fixture through the streaming chat path (include_usage)."""
    tracer, exporter = _tracer_and_exporter()
    metrics = _metrics_dict()
    span = tracer.start_span("chat fixture stream")
    scope = _stream_scope(span)

    process_chat_chunk(
        scope,
        {
            "id": "chatcmpl_fixture_stream",
            "model": "o3-mini",
            "choices": [{"delta": {"content": "The answer is 42."}}],
        },
    )
    process_chat_chunk(
        scope,
        {
            "choices": [],
            "usage": {
                "prompt_tokens": 500,
                "completion_tokens": 1000,
                "completion_tokens_details": {
                    "reasoning_tokens": 700,
                    "text_tokens": 300,
                },
            },
        },
    )
    with span:
        process_streaming_chat_response(
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
    assert attrs[SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS] == 1000
    assert attrs[SemanticConvention.GEN_AI_USAGE_REASONING_OUTPUT_TOKENS] == 700
    assert (
        attrs[SemanticConvention.GEN_AI_USAGE_DERIVED_COMPLETED_OUTPUT_TOKENS]
        == 300
    )
    assert all(value != 1700 for value in attrs.values())
