"""Tests for OpenAI span attributes on provider call failures."""

from types import SimpleNamespace

import httpx
import pytest
from openai import APITimeoutError
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

from openlit.instrumentation.openai.async_openai import async_chat_completions
from openlit.instrumentation.openai.openai import chat_completions
from openlit.semcov import SemanticConvention


def _tracer_and_exporter():
    exporter = InMemorySpanExporter()
    tracer_provider = TracerProvider()
    tracer_provider.add_span_processor(SimpleSpanProcessor(exporter))
    return tracer_provider.get_tracer("test-openai-errors"), exporter


def _openai_instance(base_url="http://localhost:11434/v1"):
    return SimpleNamespace(_client=SimpleNamespace(base_url=base_url))


def _chat_kwargs(stream=False):
    return {
        "model": "ministral-3:3b",
        "messages": [{"role": "user", "content": "ping"}],
        "stream": stream,
    }


def _openai_timeout_error():
    request = httpx.Request("POST", "http://localhost:11434/v1/chat/completions")
    return APITimeoutError(request=request)


def _assert_failed_chat_span(span, *, is_stream=False):
    attrs = span.attributes

    assert attrs[SemanticConvention.SERVER_ADDRESS] == "localhost"
    assert attrs[SemanticConvention.SERVER_PORT] == 11434
    assert attrs[SemanticConvention.GEN_AI_OPERATION] == (
        SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT
    )
    assert attrs[SemanticConvention.GEN_AI_PROVIDER_NAME] == (
        SemanticConvention.GEN_AI_SYSTEM_OPENAI
    )
    assert attrs[SemanticConvention.GEN_AI_REQUEST_MODEL] == "ministral-3:3b"
    assert attrs[SemanticConvention.GEN_AI_REQUEST_IS_STREAM] is is_stream
    assert attrs[SemanticConvention.ERROR_TYPE] == "APITimeoutError"


def test_sync_chat_completion_error_keeps_request_span_attributes():
    """Verify sync chat errors keep request-known OpenAI span attributes."""

    tracer, exporter = _tracer_and_exporter()
    wrapper = chat_completions(
        version="test-version",
        environment="test-env",
        application_name="test-app",
        tracer=tracer,
        pricing_info={},
        capture_message_content=False,
        metrics=None,
        disable_metrics=True,
    )

    def raise_timeout(*_args, **_kwargs):
        raise _openai_timeout_error()

    with pytest.raises(APITimeoutError):
        wrapper(raise_timeout, _openai_instance(), [], _chat_kwargs())

    spans = exporter.get_finished_spans()
    assert len(spans) == 1
    _assert_failed_chat_span(spans[0])


def test_sync_streaming_chat_completion_error_keeps_request_span_attributes():
    """Verify sync streaming setup errors keep request-known span attributes."""

    tracer, exporter = _tracer_and_exporter()
    wrapper = chat_completions(
        version="test-version",
        environment="test-env",
        application_name="test-app",
        tracer=tracer,
        pricing_info={},
        capture_message_content=False,
        metrics=None,
        disable_metrics=True,
    )

    def raise_timeout(*_args, **_kwargs):
        raise _openai_timeout_error()

    with pytest.raises(APITimeoutError):
        wrapper(raise_timeout, _openai_instance(), [], _chat_kwargs(stream=True))

    spans = exporter.get_finished_spans()
    assert len(spans) == 1
    _assert_failed_chat_span(spans[0], is_stream=True)


@pytest.mark.asyncio
async def test_async_chat_completion_error_keeps_request_span_attributes():
    """Verify async chat errors keep request-known OpenAI span attributes."""

    tracer, exporter = _tracer_and_exporter()
    wrapper = async_chat_completions(
        version="test-version",
        environment="test-env",
        application_name="test-app",
        tracer=tracer,
        pricing_info={},
        capture_message_content=False,
        metrics=None,
        disable_metrics=True,
    )

    async def raise_timeout(*_args, **_kwargs):
        raise _openai_timeout_error()

    with pytest.raises(APITimeoutError):
        await wrapper(raise_timeout, _openai_instance(), [], _chat_kwargs())

    spans = exporter.get_finished_spans()
    assert len(spans) == 1
    _assert_failed_chat_span(spans[0])


@pytest.mark.asyncio
async def test_async_streaming_chat_completion_error_keeps_request_span_attributes():
    """Verify async streaming setup errors keep request-known span attributes."""

    tracer, exporter = _tracer_and_exporter()
    wrapper = async_chat_completions(
        version="test-version",
        environment="test-env",
        application_name="test-app",
        tracer=tracer,
        pricing_info={},
        capture_message_content=False,
        metrics=None,
        disable_metrics=True,
    )

    async def raise_timeout(*_args, **_kwargs):
        raise _openai_timeout_error()

    with pytest.raises(APITimeoutError):
        await wrapper(raise_timeout, _openai_instance(), [], _chat_kwargs(stream=True))

    spans = exporter.get_finished_spans()
    assert len(spans) == 1
    _assert_failed_chat_span(spans[0], is_stream=True)
