"""Tests for OpenAI/OpenRouter reasoning content telemetry."""

import time
from types import SimpleNamespace

from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import (
    InMemorySpanExporter,
)

from openlit.instrumentation.openai.utils import (
    process_chat_chunk,
    process_chat_response,
    process_streaming_chat_response,
)
from openlit._config import OpenlitConfig
from openlit.semcov import SemanticConvention


def _tracer_and_exporter():
    OpenlitConfig.reset_to_defaults()
    exporter = InMemorySpanExporter()
    tracer_provider = TracerProvider()
    tracer_provider.add_span_processor(SimpleSpanProcessor(exporter))
    return tracer_provider.get_tracer("test-openai-reasoning"), exporter


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
            "model": "anthropic/claude-sonnet-4.6",
            "messages": [{"role": "user", "content": "think then answer"}],
        },
        _start_time=time.time(),
        _end_time=None,
        _timestamps=[],
        _ttft=0,
        _tbt=0,
        _server_address="openrouter.ai",
        _server_port=443,
    )


def test_streaming_chat_sets_reasoning_content_attribute():
    tracer, exporter = _tracer_and_exporter()
    span = tracer.start_span("chat anthropic/claude-sonnet-4.6")
    scope = _stream_scope(span)

    process_chat_chunk(
        scope,
        {
            "id": "chatcmpl_1",
            "model": "anthropic/claude-sonnet-4.6",
            "choices": [{"delta": {"reasoning_content": "Let me "}}],
        },
    )
    process_chat_chunk(
        scope,
        {
            "choices": [
                {
                    "delta": {"reasoning": "check the arithmetic."},
                    "finish_reason": "stop",
                }
            ]
        },
    )

    with span:
        process_streaming_chat_response(
            scope,
            pricing_info={},
            environment="test-env",
            application_name="test-app",
            metrics=None,
            capture_message_content=True,
            disable_metrics=True,
            version="test-version",
        )

    finished = exporter.get_finished_spans()
    assert len(finished) == 1
    attrs = finished[0].attributes
    assert (
        attrs[SemanticConvention.GEN_AI_CONTENT_REASONING]
        == "Let me check the arithmetic."
    )


def test_streaming_chat_does_not_set_reasoning_when_content_capture_disabled():
    tracer, exporter = _tracer_and_exporter()
    span = tracer.start_span("chat anthropic/claude-sonnet-4.6")
    scope = _stream_scope(span)

    process_chat_chunk(
        scope,
        {
            "choices": [
                {"delta": {"reasoning_content": "hidden by capture policy"}}
            ]
        },
    )

    with span:
        process_streaming_chat_response(
            scope,
            pricing_info={},
            environment="test-env",
            application_name="test-app",
            metrics=None,
            capture_message_content=False,
            disable_metrics=True,
            version="test-version",
        )

    attrs = exporter.get_finished_spans()[0].attributes
    assert SemanticConvention.GEN_AI_CONTENT_REASONING not in attrs


def test_non_streaming_chat_sets_reasoning_content_attribute():
    tracer, exporter = _tracer_and_exporter()
    span = tracer.start_span("chat anthropic/claude-sonnet-4.6")
    response = {
        "id": "chatcmpl_2",
        "model": "anthropic/claude-sonnet-4.6",
        "choices": [
            {
                "message": {
                    "content": "The answer is 42.",
                    "reasoning_content": "I checked the intermediate steps.",
                },
                "finish_reason": "stop",
            }
        ],
        "usage": {"prompt_tokens": 3, "completion_tokens": 9},
    }

    with span:
        process_chat_response(
            response,
            request_model="anthropic/claude-sonnet-4.6",
            pricing_info={},
            server_port=443,
            server_address="openrouter.ai",
            environment="test-env",
            application_name="test-app",
            metrics=None,
            start_time=time.time(),
            span=span,
            capture_message_content=True,
            disable_metrics=True,
            version="test-version",
            model="anthropic/claude-sonnet-4.6",
            messages=[{"role": "user", "content": "think then answer"}],
        )

    attrs = exporter.get_finished_spans()[0].attributes
    assert (
        attrs[SemanticConvention.GEN_AI_CONTENT_REASONING]
        == "I checked the intermediate steps."
    )
