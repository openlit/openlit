"""Invariant tests for reasoning output token telemetry (Issue #1474).

OpenAI reports reasoning tokens as a *subset* of the completion/output tokens:
a response with ``completion_tokens=1000`` /
``completion_tokens_details.reasoning_tokens=700`` (chat completions) or
``output_tokens=1000`` / ``output_tokens_details.reasoning_tokens=700``
(responses API) uses 700 tokens for reasoning, and those 700 are already
included in the 1000 output tokens.

Per OTel GenAI semantic conventions:
  * ``gen_ai.usage.reasoning.output_tokens`` = 700 (the subset)
  * ``gen_ai.usage.output_tokens`` = 1000 (already includes the subset)
  * ``gen_ai.client.token.usage{gen_ai.token.type=output}`` = 1000 (must NOT
    become 1700 -- reasoning is never added on top of the output total).

These tests lock in that invariant for the Python OpenAI instrumentation.
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
    process_response_response,
    process_streaming_chat_response,
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


def test_chat_completions_reasoning_tokens_are_subset_of_output():
    """o1/o3-style chat completion: reasoning stays a subset of output tokens."""
    tracer, exporter = _tracer_and_exporter()
    metrics = _metrics_dict()
    response = {
        "id": "chatcmpl_o1",
        "model": "o3-mini",
        "choices": [
            {
                "message": {"role": "assistant", "content": "The answer is 42."},
                "finish_reason": "stop",
            }
        ],
        "usage": {
            "prompt_tokens": 500,
            "completion_tokens": 1000,
            "completion_tokens_details": {"reasoning_tokens": 700, "text_tokens": 300},
        },
    }

    with tracer.start_as_current_span("chat o3-mini") as span:
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
            messages=[{"role": "user", "content": "think step by step"}],
        )

    _assert_no_double_counting(exporter.get_finished_spans()[0].attributes, metrics)


def test_streaming_chat_completions_reasoning_tokens_are_subset_of_output():
    """Streaming chat completion with include_usage: reasoning is a subset."""
    tracer, exporter = _tracer_and_exporter()
    metrics = _metrics_dict()
    span = tracer.start_span("chat o3-mini")
    scope = _stream_scope(span)

    process_chat_chunk(
        scope,
        {
            "id": "chatcmpl_o1",
            "model": "o3-mini",
            "choices": [{"delta": {"content": "The answer is 42."}}],
        },
    )
    # Final chunk carries usage (stream_options={"include_usage": True}).
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

    _assert_no_double_counting(exporter.get_finished_spans()[0].attributes, metrics)


def test_responses_api_reasoning_tokens_are_subset_of_output():
    """Responses API: output_tokens_details.reasoning_tokens is a subset."""
    tracer, exporter = _tracer_and_exporter()
    metrics = _metrics_dict()
    response = {
        "id": "resp_o1",
        "model": "o3-mini",
        "status": "completed",
        "output": [
            {
                "type": "message",
                "role": "assistant",
                "content": [{"type": "output_text", "text": "The answer is 42."}],
            }
        ],
        "usage": {
            "input_tokens": 500,
            "output_tokens": 1000,
            "output_tokens_details": {"reasoning_tokens": 700},
        },
    }

    with tracer.start_as_current_span("responses o3-mini") as span:
        process_response_response(
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
            input="think step by step",
        )

    _assert_no_double_counting(exporter.get_finished_spans()[0].attributes, metrics)


def test_no_reasoning_tokens_omits_reasoning_attribute():
    """No completion_tokens_details: reasoning attribute absent, output intact."""
    tracer, exporter = _tracer_and_exporter()
    metrics = _metrics_dict()
    response = {
        "id": "chatcmpl_plain",
        "model": "gpt-4o",
        "choices": [
            {
                "message": {"role": "assistant", "content": "The answer is 42."},
                "finish_reason": "stop",
            }
        ],
        "usage": {"prompt_tokens": 500, "completion_tokens": 1000},
    }

    with tracer.start_as_current_span("chat gpt-4o") as span:
        process_chat_response(
            response,
            request_model="gpt-4o",
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
            model="gpt-4o",
            messages=[{"role": "user", "content": "hi"}],
        )

    attrs = exporter.get_finished_spans()[0].attributes
    assert attrs[SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS] == 1000
    assert SemanticConvention.GEN_AI_USAGE_REASONING_OUTPUT_TOKENS not in attrs

    output_records = _output_token_usage_records(metrics)
    assert output_records
    for value, _attrs in output_records:
        assert value == 1000
