"""Tests for suppressing OpenAI Responses spans inside framework instrumentation."""

from unittest.mock import AsyncMock, Mock

import pytest
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

from openlit._config import OpenlitConfig
from openlit.__helpers import (
    reset_framework_llm_active,
    set_framework_llm_active,
)
from openlit.instrumentation.openai.async_openai import async_responses
from openlit.instrumentation.openai.openai import responses


def _wrapper_kwargs(tracer):
    """Return common wrapper configuration."""
    return {
        "version": "test-version",
        "environment": "test-env",
        "application_name": "test-app",
        "tracer": tracer,
        "pricing_info": {},
        "capture_message_content": False,
        "metrics": None,
        "disable_metrics": True,
    }


def _real_tracer():
    """Return a tracer whose finished spans can be inspected."""
    OpenlitConfig.reset_to_defaults()
    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    return provider.get_tracer("test-openai-framework-guard"), exporter


@pytest.mark.parametrize("streaming", [False, True])
def test_responses_skips_span_when_framework_llm_is_active(streaming):
    """Sync Responses calls should pass through without creating a span."""
    tracer = Mock()
    wrapper = responses(**_wrapper_kwargs(tracer))
    sentinel = object()
    wrapped = Mock(return_value=sentinel)
    kwargs = {"model": "gpt-4o", "stream": streaming}

    token = set_framework_llm_active()
    try:
        result = wrapper(wrapped, object(), (), kwargs)
    finally:
        reset_framework_llm_active(token)

    assert result is sentinel
    wrapped.assert_called_once_with(model="gpt-4o", stream=streaming)
    tracer.start_span.assert_not_called()
    tracer.start_as_current_span.assert_not_called()


@pytest.mark.asyncio
@pytest.mark.parametrize("streaming", [False, True])
async def test_async_responses_skips_span_when_framework_llm_is_active(streaming):
    """Async Responses calls should pass through without creating a span."""
    tracer = Mock()
    wrapper = async_responses(**_wrapper_kwargs(tracer))
    sentinel = object()
    wrapped = AsyncMock(return_value=sentinel)
    kwargs = {"model": "gpt-4o", "stream": streaming}

    token = set_framework_llm_active()
    try:
        result = await wrapper(wrapped, object(), (), kwargs)
    finally:
        reset_framework_llm_active(token)

    assert result is sentinel
    wrapped.assert_awaited_once_with(model="gpt-4o", stream=streaming)
    tracer.start_span.assert_not_called()
    tracer.start_as_current_span.assert_not_called()


def test_responses_starts_span_when_framework_llm_is_inactive():
    """A direct Responses call still gets its own span."""
    tracer, exporter = _real_tracer()
    wrapper = responses(**_wrapper_kwargs(tracer))
    wrapped = Mock(return_value={"output": [], "model": "gpt-4o"})

    result = wrapper(wrapped, object(), (), {"model": "gpt-4o", "stream": False})

    assert result["model"] == "gpt-4o"
    spans = exporter.get_finished_spans()
    assert len(spans) == 1
    assert spans[0].name == "chat gpt-4o"
    assert spans[0].attributes.get("gen_ai.request.model") == "gpt-4o"


def test_responses_streaming_starts_span_when_framework_llm_is_inactive():
    """A direct streaming Responses call opens a span before any iteration."""
    tracer, exporter = _real_tracer()
    wrapper = responses(**_wrapper_kwargs(tracer))
    wrapped = Mock()
    wrapped.return_value.close = Mock()

    result = wrapper(wrapped, object(), (), {"model": "gpt-4o", "stream": True})

    assert result is not wrapped.return_value
    assert not exporter.get_finished_spans()
    result.close()
    spans = exporter.get_finished_spans()
    assert len(spans) == 1
    assert spans[0].name == "chat gpt-4o"


@pytest.mark.asyncio
async def test_async_responses_starts_span_when_framework_llm_is_inactive():
    """A direct async Responses call still gets its own span."""
    tracer, exporter = _real_tracer()
    wrapper = async_responses(**_wrapper_kwargs(tracer))
    wrapped = AsyncMock(return_value={"output": [], "model": "gpt-4o"})

    result = await wrapper(
        wrapped, object(), (), {"model": "gpt-4o", "stream": False}
    )

    assert result["model"] == "gpt-4o"
    spans = exporter.get_finished_spans()
    assert len(spans) == 1
    assert spans[0].name == "chat gpt-4o"
