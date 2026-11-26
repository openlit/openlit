"""Regression tests: AI21 chat and RAG responses whose ``usage`` is null.

AI21 returns ``usage: null`` on responses that carry no token accounting.
``response_dict.get("usage", {})`` returns ``None`` for an explicit JSON null
(the default only applies to a missing key), so the next ``.get`` raised
``AttributeError``. The wrapper recorded that as a failed span and dropped the
response attributes, even though the completion itself was fine.

These tests drive the real sync and async wrapper factories with plain dict
responses, exactly as the SDK response is converted by ``response_as_dict``.
No network, no API key, no AI21 SDK installation is needed.
"""

import pytest
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter
from opentelemetry.trace import StatusCode

from openlit._config import OpenlitConfig
from openlit.instrumentation.ai21 import ai21 as sync_mod
from openlit.instrumentation.ai21 import async_ai21 as async_mod
from openlit.semcov import SemanticConvention

_RESPONSE_TEXT = "pong"


def _tracer_and_exporter():
    OpenlitConfig.reset_to_defaults()
    exporter = InMemorySpanExporter()
    tracer_provider = TracerProvider()
    tracer_provider.add_span_processor(SimpleSpanProcessor(exporter))
    return tracer_provider.get_tracer("test-ai21-null-usage"), exporter


def _request_kwargs():
    return {
        "model": "jamba-1.5-mini",
        "messages": [{"role": "user", "content": "ping"}],
    }


def _chat_response(usage=None):
    return {
        "id": "chatcmpl-ai21",
        "model": "jamba-1.5-mini",
        "choices": [
            {
                "index": 0,
                "finish_reason": "stop",
                "message": {"role": "assistant", "content": _RESPONSE_TEXT},
            }
        ],
        "usage": usage,
    }


def _rag_response(usage=None):
    return {
        "id": "rag-ai21",
        "choices": [{"content": _RESPONSE_TEXT}],
        "usage": usage,
    }


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
    def fake_create(*_args, **_kwargs):
        return response

    return fake_create


def _async_returning(response):
    async def fake_create(*_args, **_kwargs):
        return response

    return fake_create


def _assert_ok_span(exporter):
    spans = exporter.get_finished_spans()
    assert len(spans) == 1
    span = spans[0]
    assert span.status.status_code == StatusCode.OK
    assert not [event for event in span.events if event.name == "exception"]

    attrs = span.attributes
    assert _RESPONSE_TEXT in attrs[SemanticConvention.GEN_AI_OUTPUT_MESSAGES]
    return attrs


def test_sync_chat_response_with_null_usage_keeps_span():
    """A chat completion with ``usage: null`` still yields an OK, complete span."""
    tracer, exporter = _tracer_and_exporter()
    wrapper = _wrapper(sync_mod.chat, tracer)
    response = _chat_response()

    result = wrapper(_returning(response), object(), [], _request_kwargs())

    assert result is response
    attrs = _assert_ok_span(exporter)
    assert attrs[SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS] == 0
    assert attrs[SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS] == 0


@pytest.mark.asyncio
async def test_async_chat_response_with_null_usage_keeps_span():
    """Async twin of the chat null-usage test."""
    tracer, exporter = _tracer_and_exporter()
    wrapper = _wrapper(async_mod.async_chat, tracer)
    response = _chat_response()

    result = await wrapper(
        _async_returning(response), object(), [], _request_kwargs()
    )

    assert result is response
    attrs = _assert_ok_span(exporter)
    assert attrs[SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS] == 0
    assert attrs[SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS] == 0


def test_sync_rag_response_with_null_usage_keeps_span():
    """A RAG completion with ``usage: null`` still yields an OK, complete span."""
    tracer, exporter = _tracer_and_exporter()
    wrapper = _wrapper(sync_mod.chat_rag, tracer)
    response = _rag_response()

    result = wrapper(_returning(response), object(), [], _request_kwargs())

    assert result is response
    _assert_ok_span(exporter)


@pytest.mark.asyncio
async def test_async_rag_response_with_null_usage_keeps_span():
    """Async twin of the RAG null-usage test."""
    tracer, exporter = _tracer_and_exporter()
    wrapper = _wrapper(async_mod.async_chat_rag, tracer)
    response = _rag_response()

    result = await wrapper(
        _async_returning(response), object(), [], _request_kwargs()
    )

    assert result is response
    _assert_ok_span(exporter)


def test_sync_chat_response_with_valid_usage_still_records_tokens():
    """Valid usage keeps its reported token counts (no behavior change)."""
    tracer, exporter = _tracer_and_exporter()
    wrapper = _wrapper(sync_mod.chat, tracer)
    response = _chat_response(
        usage={"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15}
    )

    result = wrapper(_returning(response), object(), [], _request_kwargs())

    assert result is response
    attrs = _assert_ok_span(exporter)
    assert attrs[SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS] == 10
    assert attrs[SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS] == 5
