"""Regression tests: LiteLLM responses whose ``usage`` is null keep their span.

LiteLLM passes provider responses through, and several OpenAI-compatible
providers omit ``usage`` or send ``"usage": null`` on chat completions and
embeddings (the same shape the OpenAI and Groq instrumentors already guard
against). ``response_dict.get("usage", {})`` then returned ``None`` instead of
the default and the next ``.get`` raised ``AttributeError``. The wrapper caught
it, so the call still returned, but the span was exported with an error status
and none of the response attributes.

These tests drive the real sync and async wrapper factories with dict
responses (``response_as_dict`` passes dicts through unchanged), with no
network and no API key.
"""

from types import SimpleNamespace

import pytest
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter
from opentelemetry.trace import StatusCode

from openlit._config import OpenlitConfig
from openlit.instrumentation.litellm.async_litellm import acompletion, aembedding
from openlit.instrumentation.litellm.litellm import completion, embedding
from openlit.semcov import SemanticConvention

_CHAT_KWARGS = {
    "model": "openai/gpt-4o-mini",
    "messages": [{"role": "user", "content": "ping"}],
}

_EMBED_KWARGS = {
    "model": "openai/text-embedding-3-small",
    "input": "ping",
}


def _tracer_and_exporter():
    OpenlitConfig.reset_to_defaults()
    exporter = InMemorySpanExporter()
    tracer_provider = TracerProvider()
    tracer_provider.add_span_processor(SimpleSpanProcessor(exporter))
    return tracer_provider.get_tracer("test-litellm-null-usage"), exporter


def _wrapper(factory, tracer):
    return factory(
        version="test-version",
        environment="test-env",
        application_name="test-app",
        tracer=tracer,
        pricing_info={},
        capture_message_content=True,
        metrics=None,
        disable_metrics=True,
    )


def _returning(response):
    def fake_call(*_args, **_kwargs):
        return response

    return fake_call


def _async_returning(response):
    async def fake_call(*_args, **_kwargs):
        return response

    return fake_call


def _chat_response(usage=None):
    return {
        "id": "chatcmpl-1",
        "object": "chat.completion",
        "created": 1,
        "model": "gpt-4o-mini",
        "choices": [
            {
                "index": 0,
                "finish_reason": "stop",
                "message": {"role": "assistant", "content": "pong"},
            }
        ],
        "usage": usage,
    }


def _embedding_response(usage=None):
    return {
        "object": "list",
        "model": "text-embedding-3-small",
        "data": [{"object": "embedding", "index": 0, "embedding": [0.1, 0.2]}],
        "usage": usage,
    }


def _single_span(exporter):
    spans = exporter.get_finished_spans()
    assert len(spans) == 1
    return spans[0]


def test_sync_chat_with_null_usage_keeps_response_attributes():
    """A chat completion without usage still yields a complete, OK span."""

    tracer, exporter = _tracer_and_exporter()
    wrapper = _wrapper(completion, tracer)
    response = _chat_response()

    result = wrapper(_returning(response), SimpleNamespace(), [], _CHAT_KWARGS)

    assert result is response
    span = _single_span(exporter)
    assert span.status.status_code == StatusCode.OK
    assert not [event for event in span.events if event.name == "exception"]
    attrs = span.attributes
    assert attrs[SemanticConvention.GEN_AI_RESPONSE_ID] == "chatcmpl-1"
    assert attrs[SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS] == 0
    assert attrs[SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS] == 0


@pytest.mark.asyncio
async def test_async_chat_with_null_usage_keeps_response_attributes():
    """Async twin of the sync chat test."""

    tracer, exporter = _tracer_and_exporter()
    wrapper = _wrapper(acompletion, tracer)
    response = _chat_response()

    result = await wrapper(
        _async_returning(response), SimpleNamespace(), [], _CHAT_KWARGS
    )

    assert result is response
    span = _single_span(exporter)
    assert span.status.status_code == StatusCode.OK
    assert not [event for event in span.events if event.name == "exception"]
    attrs = span.attributes
    assert attrs[SemanticConvention.GEN_AI_RESPONSE_ID] == "chatcmpl-1"
    assert attrs[SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS] == 0
    assert attrs[SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS] == 0


def test_sync_chat_with_usage_records_reported_tokens():
    """A chat completion that reports usage keeps the reported token counts."""

    tracer, exporter = _tracer_and_exporter()
    wrapper = _wrapper(completion, tracer)
    response = _chat_response(
        usage={"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15}
    )

    result = wrapper(_returning(response), SimpleNamespace(), [], _CHAT_KWARGS)

    assert result is response
    span = _single_span(exporter)
    assert span.status.status_code == StatusCode.OK
    attrs = span.attributes
    assert attrs[SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS] == 10
    assert attrs[SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS] == 5


def test_sync_embedding_with_null_usage_keeps_ok_span():
    """An embedding response without usage still yields an OK span."""

    tracer, exporter = _tracer_and_exporter()
    wrapper = _wrapper(embedding, tracer)
    response = _embedding_response()

    result = wrapper(_returning(response), SimpleNamespace(), [], _EMBED_KWARGS)

    assert result is response
    span = _single_span(exporter)
    assert span.status.status_code == StatusCode.OK
    assert not [event for event in span.events if event.name == "exception"]
    assert span.attributes[SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS] == 0


@pytest.mark.asyncio
async def test_async_embedding_with_null_usage_keeps_ok_span():
    """Async twin of the sync embedding test."""

    tracer, exporter = _tracer_and_exporter()
    wrapper = _wrapper(aembedding, tracer)
    response = _embedding_response()

    result = await wrapper(
        _async_returning(response), SimpleNamespace(), [], _EMBED_KWARGS
    )

    assert result is response
    span = _single_span(exporter)
    assert span.status.status_code == StatusCode.OK
    assert not [event for event in span.events if event.name == "exception"]
    assert span.attributes[SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS] == 0
