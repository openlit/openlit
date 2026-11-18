"""Tests for how Together stream chunks are recorded on the span.

The chunks are the Together SDK's own ``ChatCompletionChunk`` objects: its tool
call ``index`` is typed as a float, and its finish reason lives on the choice.
"""

import asyncio

from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import (
    InMemorySpanExporter,
)
from together.types.chat.chat_completion_chunk import ChatCompletionChunk

from openlit._config import OpenlitConfig
from openlit.instrumentation.together.async_together import async_completion
from openlit.instrumentation.together.together import completion
from openlit.semcov import SemanticConvention

MODEL = "meta-llama/Llama-3.3-70B-Instruct-Turbo"


def _tracer_and_exporter():
    OpenlitConfig.reset_to_defaults()
    exporter = InMemorySpanExporter()
    tracer_provider = TracerProvider()
    tracer_provider.add_span_processor(SimpleSpanProcessor(exporter))
    return tracer_provider.get_tracer("test-together-stream-chunks"), exporter


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


def _chunk(delta, finish_reason=None, usage=None):
    return ChatCompletionChunk.model_validate(
        {
            "id": "chatcmpl-together",
            "object": "chat.completion.chunk",
            "created": 0,
            "model": MODEL,
            "choices": [
                {
                    "index": 0,
                    "delta": {"role": "assistant", **delta},
                    "finish_reason": finish_reason,
                }
            ],
            "usage": usage,
        }
    )


USAGE = {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15}

TOOL_CALL_STREAM = [
    _chunk(
        {
            "tool_calls": [
                {
                    "index": 0,
                    "id": "call_1",
                    "type": "function",
                    "function": {
                        "name": "get_weather",
                        "arguments": '{"city": "Paris"}',
                    },
                }
            ]
        }
    ),
    _chunk({}, finish_reason="tool_calls", usage=USAGE),
]

TEXT_STREAM = [
    _chunk({"content": "Hi"}),
    _chunk({"content": "."}, finish_reason="length", usage=USAGE),
]


def _chat_kwargs():
    return {
        "model": MODEL,
        "messages": [{"role": "user", "content": "Weather in Paris?"}],
        "stream": True,
    }


def _run_sync(chunks):
    tracer, exporter = _tracer_and_exporter()
    wrapper = completion(**_wrapper_kwargs(tracer))
    stream = wrapper(lambda *_a, **_k: iter(chunks), object(), [], _chat_kwargs())
    received = list(stream)
    (span,) = exporter.get_finished_spans()
    return received, span


def _run_async(chunks):
    tracer, exporter = _tracer_and_exporter()
    wrapper = async_completion(**_wrapper_kwargs(tracer))

    async def fake_create(*_args, **_kwargs):
        async def _generate():
            for chunk in chunks:
                yield chunk

        return _generate()

    async def consume():
        stream = await wrapper(fake_create, object(), [], _chat_kwargs())
        return [chunk async for chunk in stream]

    received = asyncio.run(consume())
    (span,) = exporter.get_finished_spans()
    return received, span


def _assert_tool_call_recorded(received, span):
    assert len(received) == len(TOOL_CALL_STREAM)
    assert span.attributes[SemanticConvention.GEN_AI_TOOL_NAME] == "get_weather"
    assert span.attributes[SemanticConvention.GEN_AI_TOOL_CALL_ID] == "call_1"
    assert (
        span.attributes[SemanticConvention.GEN_AI_TOOL_ARGS] == '{"city": "Paris"}'
    )
    assert tuple(span.attributes["gen_ai.response.finish_reasons"]) == (
        "tool_calls",
    )


def test_sync_stream_with_tool_call_reaches_the_caller_and_the_span():
    """A float tool-call index must not break the caller's loop."""
    received, span = _run_sync(TOOL_CALL_STREAM)

    _assert_tool_call_recorded(received, span)


def test_async_stream_with_tool_call_reaches_the_caller_and_the_span():
    """Async twin of the sync tool-call test."""
    received, span = _run_async(TOOL_CALL_STREAM)

    _assert_tool_call_recorded(received, span)


def test_stream_finish_reason_is_read_from_the_choice():
    """Together sends the finish reason on the choice, not the chunk."""
    _received, span = _run_sync(TEXT_STREAM)

    assert tuple(span.attributes["gen_ai.response.finish_reasons"]) == ("length",)
