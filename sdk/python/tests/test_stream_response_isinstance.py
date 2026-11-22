"""Tests that instrumented streams keep the SDK types the application saw
before instrumentation (openlit#1704)."""

import json

import httpx
import anthropic
import openai
import pytest
from anthropic.lib.streaming import (
    AsyncMessageStream,
    AsyncMessageStreamManager,
    MessageStream,
    MessageStreamManager,
)
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

from openlit._config import OpenlitConfig
from openlit.instrumentation.anthropic.anthropic import messages, messages_stream
from openlit.instrumentation.anthropic.async_anthropic import (
    async_messages,
    async_messages_stream,
)
from openlit.instrumentation.openai.async_openai import (
    async_chat_completions,
    async_responses,
)
from openlit.instrumentation.openai.openai import chat_completions, responses
from openlit.semcov import SemanticConvention

OPENAI_CHAT_SSE = (
    'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","created":1,'
    '"model":"gpt-4o","choices":[{"index":0,"delta":{"content":"Hello"},'
    '"finish_reason":null}]}\n\n'
    'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","created":1,'
    '"model":"gpt-4o","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n'
    "data: [DONE]\n\n"
)

OPENAI_RESPONSES_SSE = (
    'data: {"type":"response.created","sequence_number":0,"response":{"id":"resp_1",'
    '"object":"response","status":"in_progress","model":"gpt-4o","output":[]}}\n\n'
    'data: {"type":"response.completed","sequence_number":1,"response":{"id":"resp_1",'
    '"object":"response","status":"completed","model":"gpt-4o","output":[],'
    '"usage":{"input_tokens":4,"output_tokens":3,"total_tokens":7}}}\n\n'
)

ANTHROPIC_SSE = (
    "event: message_start\n"
    'data: {"type":"message_start","message":{"id":"msg_1","type":"message",'
    '"role":"assistant","content":[],"model":"claude-sonnet-4-5",'
    '"usage":{"input_tokens":5,"output_tokens":1}}}\n\n'
    "event: content_block_start\n"
    'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n'
    "event: content_block_delta\n"
    'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}\n\n'
    "event: content_block_stop\n"
    'data: {"type":"content_block_stop","index":0}\n\n'
    "event: message_delta\n"
    'data: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},'
    '"usage":{"output_tokens":3}}\n\n'
    "event: message_stop\n"
    'data: {"type":"message_stop"}\n\n'
)

OPENAI_CHAT_KWARGS = {
    "model": "gpt-4o",
    "messages": [{"role": "user", "content": "ping"}],
    "stream": True,
}

OPENAI_RESPONSES_KWARGS = {
    "model": "gpt-4o",
    "input": "ping",
    "stream": True,
}

ANTHROPIC_KWARGS = {
    "model": "claude-sonnet-4-5",
    "messages": [{"role": "user", "content": "ping"}],
    "max_tokens": 16,
    "stream": True,
}


def _tracer_and_exporter():
    OpenlitConfig.reset_to_defaults()
    exporter = InMemorySpanExporter()
    tracer_provider = TracerProvider()
    tracer_provider.add_span_processor(SimpleSpanProcessor(exporter))
    return tracer_provider.get_tracer("test-stream-isinstance"), exporter


def _wrapper_kwargs(tracer):
    return {
        "version": "test-version",
        "environment": "test-env",
        "application_name": "test-app",
        "tracer": tracer,
        "pricing_info": {},
        "capture_message_content": True,
        "metrics": None,
        "disable_metrics": True,
    }


def _sse_handler(payload):
    def handler(request):
        return httpx.Response(
            200,
            content=payload.encode(),
            headers={"content-type": "text/event-stream"},
            request=request,
        )

    return handler


def _sync_client(client_class, payload):
    transport = httpx.MockTransport(_sse_handler(payload))
    return client_class(
        api_key="test-key",
        http_client=httpx.Client(transport=transport, base_url="http://testserver"),
    )


def _async_client(client_class, payload):
    transport = httpx.MockTransport(_sse_handler(payload))
    return client_class(
        api_key="test-key",
        http_client=httpx.AsyncClient(transport=transport, base_url="http://testserver"),
    )


def test_openai_chat_stream_is_instance_of_sdk_stream():
    """A wrapped chat completion stream must still be an openai.Stream and must
    keep recording telemetry without touching the SDK stream object."""

    tracer, exporter = _tracer_and_exporter()
    client = _sync_client(openai.OpenAI, OPENAI_CHAT_SSE)
    wrapper = chat_completions(**_wrapper_kwargs(tracer))

    traced = wrapper(
        client.chat.completions.create, client.chat.completions, (), dict(OPENAI_CHAT_KWARGS)
    )

    assert isinstance(traced, openai.Stream)
    chunks = list(traced)
    assert [chunk.choices[0].delta.content for chunk in chunks] == ["Hello", None]
    assert "_span" not in vars(traced.__wrapped__)

    spans = exporter.get_finished_spans()
    assert len(spans) == 1
    assert spans[0].name == "chat gpt-4o"
    output = json.loads(spans[0].attributes[SemanticConvention.GEN_AI_OUTPUT_MESSAGES])
    assert output[0]["parts"] == [{"type": "text", "content": "Hello"}]


@pytest.mark.asyncio
async def test_openai_async_chat_stream_is_instance_of_sdk_stream():
    """Async twin: the wrapped stream must still be an openai.AsyncStream."""

    tracer, exporter = _tracer_and_exporter()
    client = _async_client(openai.AsyncOpenAI, OPENAI_CHAT_SSE)
    wrapper = async_chat_completions(**_wrapper_kwargs(tracer))

    traced = await wrapper(
        client.chat.completions.create, client.chat.completions, (), dict(OPENAI_CHAT_KWARGS)
    )

    assert isinstance(traced, openai.AsyncStream)
    chunks = [chunk async for chunk in traced]
    assert len(chunks) == 2
    assert "_span" not in vars(traced.__wrapped__)
    assert len(exporter.get_finished_spans()) == 1


def test_openai_responses_stream_is_instance_of_sdk_stream():
    """The Responses API stream keeps its openai.Stream type."""

    tracer, _ = _tracer_and_exporter()
    client = _sync_client(openai.OpenAI, OPENAI_RESPONSES_SSE)
    wrapper = responses(**_wrapper_kwargs(tracer))

    traced = wrapper(client.responses.create, client.responses, (), dict(OPENAI_RESPONSES_KWARGS))

    assert isinstance(traced, openai.Stream)
    assert "_span" not in vars(traced.__wrapped__)


@pytest.mark.asyncio
async def test_openai_async_responses_stream_is_instance_of_sdk_stream():
    """Async twin of the Responses API stream check."""

    tracer, _ = _tracer_and_exporter()
    client = _async_client(openai.AsyncOpenAI, OPENAI_RESPONSES_SSE)
    wrapper = async_responses(**_wrapper_kwargs(tracer))

    traced = await wrapper(
        client.responses.create, client.responses, (), dict(OPENAI_RESPONSES_KWARGS)
    )

    assert isinstance(traced, openai.AsyncStream)
    assert "_span" not in vars(traced.__wrapped__)


def test_anthropic_message_stream_is_instance_of_sdk_class():
    """client.messages.stream() keeps reporting the SDK manager and stream types."""

    tracer, exporter = _tracer_and_exporter()
    client = _sync_client(anthropic.Anthropic, ANTHROPIC_SSE)
    wrapper = messages_stream(**_wrapper_kwargs(tracer))
    kwargs = {key: value for key, value in ANTHROPIC_KWARGS.items() if key != "stream"}

    manager = wrapper(client.messages.stream, client.messages, (), kwargs)

    assert isinstance(manager, MessageStreamManager)
    with manager as stream:
        assert isinstance(stream, MessageStream)
        assert len(list(stream)) > 0
        assert "_span" not in vars(stream.__wrapped__)

    assert len(exporter.get_finished_spans()) == 1


@pytest.mark.asyncio
async def test_anthropic_async_message_stream_is_instance_of_sdk_class():
    """Async twin of the client.messages.stream() type check."""

    tracer, exporter = _tracer_and_exporter()
    client = _async_client(anthropic.AsyncAnthropic, ANTHROPIC_SSE)
    wrapper = async_messages_stream(**_wrapper_kwargs(tracer))
    kwargs = {key: value for key, value in ANTHROPIC_KWARGS.items() if key != "stream"}

    manager = wrapper(client.messages.stream, client.messages, (), kwargs)

    assert isinstance(manager, AsyncMessageStreamManager)
    async with manager as stream:
        assert isinstance(stream, AsyncMessageStream)
        chunks = [chunk async for chunk in stream]
        assert len(chunks) > 0
        assert "_span" not in vars(stream.__wrapped__)

    assert len(exporter.get_finished_spans()) == 1


def test_anthropic_create_stream_reports_wrapped_class():
    """messages.create(stream=True) reports anthropic.Stream through __class__.

    isinstance() is deliberately not asserted here: anthropic.Stream uses the
    _SyncStreamMeta metaclass, whose __instancecheck__ only ever returns True
    for MessageStream, so even a real subclass of anthropic.Stream fails that
    check. Reporting the wrapped class is the most any proxy can do.
    """

    tracer, _ = _tracer_and_exporter()
    client = _sync_client(anthropic.Anthropic, ANTHROPIC_SSE)
    wrapper = messages(**_wrapper_kwargs(tracer))

    traced = wrapper(client.messages.create, client.messages, (), dict(ANTHROPIC_KWARGS))

    assert traced.__class__ is anthropic.Stream
    assert "_span" not in vars(traced.__wrapped__)


@pytest.mark.asyncio
async def test_anthropic_async_create_stream_reports_wrapped_class():
    """Async twin: the wrapped stream reports anthropic.AsyncStream."""

    tracer, _ = _tracer_and_exporter()
    client = _async_client(anthropic.AsyncAnthropic, ANTHROPIC_SSE)
    wrapper = async_messages(**_wrapper_kwargs(tracer))

    traced = await wrapper(
        client.messages.create, client.messages, (), dict(ANTHROPIC_KWARGS)
    )

    assert traced.__class__ is anthropic.AsyncStream
    assert "_span" not in vars(traced.__wrapped__)
