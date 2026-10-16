"""Regression tests: OpenAI responses whose ``usage`` is null keep their span.

``usage`` is optional on the OpenAI SDK models. The Responses API returns
``usage: null`` for a ``background=True`` call that is still ``queued``, and
OpenAI-compatible servers may omit it from chat completions and embeddings.
``response.model_dump()`` then carries ``"usage": None``, so
``response_dict.get("usage", {})`` returned ``None`` instead of the default and
the next ``.get`` raised ``AttributeError``. The span was exported with an
error status and none of the response attributes. On a streamed Responses call
the same read on the ``response.completed`` event raised inside the caller's
iteration instead.

These tests drive the real sync and async wrapper factories with SDK response
objects built the way the SDK builds them, with no network and no API key.
"""

from types import SimpleNamespace

import pytest
from openai.types import CreateEmbeddingResponse
from openai.types.chat import ChatCompletion
from openai.types.responses import Response
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter
from opentelemetry.trace import StatusCode

from openlit._config import OpenlitConfig
from openlit.instrumentation.openai.async_openai import (
    async_chat_completions,
    async_embedding,
    async_responses,
)
from openlit.instrumentation.openai.openai import (
    chat_completions,
    embedding,
    responses,
)
from openlit.semcov import SemanticConvention

_CHAT_KWARGS = {
    "model": "ministral-3:3b",
    "messages": [{"role": "user", "content": "ping"}],
}
_BACKGROUND_KWARGS = {"model": "gpt-4o-mini", "input": "ping", "background": True}
_STREAM_KWARGS = {"model": "gpt-4o-mini", "input": "ping", "stream": True}
_EMBEDDING_KWARGS = {"model": "nomic-embed-text", "input": "ping"}

_STREAM_EVENTS = [
    {"type": "response.output_text.delta", "delta": "pong"},
    {
        "type": "response.completed",
        "response": {
            "id": "resp_stream_1",
            "model": "gpt-4o-mini",
            "status": "completed",
            "usage": None,
        },
    },
]


class FakeRawSyncStream:
    """Minimal stand-in for openai._streaming.Stream: supports the context
    manager + iterator protocol and an explicit close()."""

    def __init__(self, chunks):
        self._chunks = list(chunks)
        self.closed = False

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_value, traceback):
        self.close()

    def __iter__(self):
        return self

    def __next__(self):
        if not self._chunks:
            raise StopIteration
        return self._chunks.pop(0)

    def close(self):
        """Mark closed, matching openai._streaming.Stream.close()."""
        self.closed = True


class FakeRawAsyncStream:
    """Async twin of FakeRawSyncStream."""

    def __init__(self, chunks):
        self._chunks = list(chunks)
        self.closed = False

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc_value, traceback):
        await self.close()

    def __aiter__(self):
        return self

    async def __anext__(self):
        if not self._chunks:
            raise StopAsyncIteration
        return self._chunks.pop(0)

    async def close(self):
        """Mark closed, matching openai._streaming.AsyncStream.close()."""
        self.closed = True


def _tracer_and_exporter():
    OpenlitConfig.reset_to_defaults()
    exporter = InMemorySpanExporter()
    tracer_provider = TracerProvider()
    tracer_provider.add_span_processor(SimpleSpanProcessor(exporter))
    return tracer_provider.get_tracer("test-openai-null-usage"), exporter


def _openai_instance(base_url="http://localhost:11434/v1"):
    return SimpleNamespace(_client=SimpleNamespace(base_url=base_url))


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


def _chat_completion():
    response = ChatCompletion.construct(
        id="chatcmpl-1",
        object="chat.completion",
        created=1,
        model="ministral-3:3b",
        choices=[
            {
                "index": 0,
                "finish_reason": "stop",
                "message": {"role": "assistant", "content": "pong"},
            }
        ],
        usage=None,
    )
    assert response.model_dump()["usage"] is None
    return response


def _queued_background_response():
    response = Response.construct(
        id="resp_1",
        object="response",
        created_at=1,
        model="gpt-4o-mini",
        status="queued",
        background=True,
        output=[],
        parallel_tool_calls=True,
        tool_choice="auto",
        tools=[],
        usage=None,
    )
    assert response.model_dump()["usage"] is None
    return response


def _embedding_response():
    response = CreateEmbeddingResponse.construct(
        object="list",
        model="nomic-embed-text",
        data=[{"object": "embedding", "index": 0, "embedding": [0.1, 0.2]}],
        usage=None,
    )
    assert response.model_dump()["usage"] is None
    return response


def _ok_span_attributes(exporter):
    spans = exporter.get_finished_spans()
    assert len(spans) == 1
    span = spans[0]
    assert span.status.status_code == StatusCode.OK
    assert not [event for event in span.events if event.name == "exception"]
    return span.attributes


def _assert_tokens(attrs, input_tokens, output_tokens):
    # Without reported usage the instrumentation estimates both counts from the
    # message text: ceil(len(text) / 2).
    assert attrs[SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS] == input_tokens
    assert attrs[SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS] == output_tokens


def _assert_chat_span(exporter):
    attrs = _ok_span_attributes(exporter)
    assert attrs[SemanticConvention.GEN_AI_RESPONSE_ID] == "chatcmpl-1"
    assert attrs[SemanticConvention.GEN_AI_RESPONSE_MODEL] == "ministral-3:3b"
    assert attrs[SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON] == ("stop",)
    _assert_tokens(attrs, input_tokens=5, output_tokens=2)


def _assert_background_span(exporter):
    attrs = _ok_span_attributes(exporter)
    assert attrs[SemanticConvention.GEN_AI_RESPONSE_ID] == "resp_1"
    assert attrs[SemanticConvention.GEN_AI_RESPONSE_MODEL] == "gpt-4o-mini"
    assert attrs[SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON] == ("queued",)
    _assert_tokens(attrs, input_tokens=2, output_tokens=0)


def _assert_stream_span(exporter):
    attrs = _ok_span_attributes(exporter)
    assert attrs[SemanticConvention.GEN_AI_RESPONSE_ID] == "resp_stream_1"
    assert attrs[SemanticConvention.GEN_AI_RESPONSE_MODEL] == "gpt-4o-mini"
    assert attrs[SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON] == ("completed",)
    _assert_tokens(attrs, input_tokens=2, output_tokens=2)


def _assert_embedding_span(exporter):
    attrs = _ok_span_attributes(exporter)
    assert attrs[SemanticConvention.GEN_AI_REQUEST_MODEL] == "nomic-embed-text"
    assert attrs[SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS] == 0


def test_sync_chat_completion_with_null_usage_keeps_response_attributes():
    """A chat completion without usage still yields a complete, OK span."""

    tracer, exporter = _tracer_and_exporter()
    wrapper = _wrapper(chat_completions, tracer)
    response = _chat_completion()

    result = wrapper(_returning(response), _openai_instance(), [], _CHAT_KWARGS)

    assert result is response
    _assert_chat_span(exporter)


@pytest.mark.asyncio
async def test_async_chat_completion_with_null_usage_keeps_response_attributes():
    """Async twin of the sync chat completion test."""

    tracer, exporter = _tracer_and_exporter()
    wrapper = _wrapper(async_chat_completions, tracer)
    response = _chat_completion()

    result = await wrapper(
        _async_returning(response), _openai_instance(), [], _CHAT_KWARGS
    )

    assert result is response
    _assert_chat_span(exporter)


def test_sync_background_response_with_null_usage_keeps_response_attributes():
    """A queued ``background=True`` response still yields a complete, OK span."""

    tracer, exporter = _tracer_and_exporter()
    wrapper = _wrapper(responses, tracer)
    response = _queued_background_response()

    result = wrapper(
        _returning(response),
        _openai_instance("https://api.openai.com/v1"),
        [],
        _BACKGROUND_KWARGS,
    )

    assert result is response
    _assert_background_span(exporter)


@pytest.mark.asyncio
async def test_async_background_response_with_null_usage_keeps_response_attributes():
    """Async twin of the sync background response test."""

    tracer, exporter = _tracer_and_exporter()
    wrapper = _wrapper(async_responses, tracer)
    response = _queued_background_response()

    result = await wrapper(
        _async_returning(response),
        _openai_instance("https://api.openai.com/v1"),
        [],
        _BACKGROUND_KWARGS,
    )

    assert result is response
    _assert_background_span(exporter)


def test_sync_streamed_response_completed_with_null_usage_does_not_break_iteration():
    """A ``response.completed`` event with null usage neither raises nor loses the span."""

    tracer, exporter = _tracer_and_exporter()
    wrapper = _wrapper(responses, tracer)
    raw_stream = FakeRawSyncStream(_STREAM_EVENTS)

    traced_stream = wrapper(
        _returning(raw_stream),
        _openai_instance("https://api.openai.com/v1"),
        [],
        _STREAM_KWARGS,
    )

    with traced_stream as stream:
        received = list(stream)

    assert received == _STREAM_EVENTS
    assert raw_stream.closed
    _assert_stream_span(exporter)


@pytest.mark.asyncio
async def test_async_streamed_response_completed_with_null_usage_does_not_break_iteration():
    """Async twin of the sync streamed response test."""

    tracer, exporter = _tracer_and_exporter()
    wrapper = _wrapper(async_responses, tracer)
    raw_stream = FakeRawAsyncStream(_STREAM_EVENTS)

    traced_stream = await wrapper(
        _async_returning(raw_stream),
        _openai_instance("https://api.openai.com/v1"),
        [],
        _STREAM_KWARGS,
    )

    async with traced_stream as stream:
        received = [event async for event in stream]

    assert received == _STREAM_EVENTS
    assert raw_stream.closed
    _assert_stream_span(exporter)


def test_sync_embedding_with_null_usage_keeps_response_attributes():
    """An embeddings response with null usage still yields a complete, OK span."""

    tracer, exporter = _tracer_and_exporter()
    wrapper = _wrapper(embedding, tracer)
    response = _embedding_response()

    result = wrapper(_returning(response), _openai_instance(), [], _EMBEDDING_KWARGS)

    assert result is response
    _assert_embedding_span(exporter)


@pytest.mark.asyncio
async def test_async_embedding_with_null_usage_keeps_response_attributes():
    """Async twin of the sync embedding test."""

    tracer, exporter = _tracer_and_exporter()
    wrapper = _wrapper(async_embedding, tracer)
    response = _embedding_response()

    result = await wrapper(
        _async_returning(response), _openai_instance(), [], _EMBEDDING_KWARGS
    )

    assert result is response
    _assert_embedding_span(exporter)
