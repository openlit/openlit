# pylint: disable=protected-access, duplicate-code, missing-function-docstring
"""Regression tests: the async Letta wrapper must not re-execute a streaming
call and must end the span with the stream lifecycle.

``create_async_letta_wrapper`` executed the wrapped call once to detect an
async iterator, then — despite having already started a span for the stream —
reset ``streaming`` to False and fell through to the non-streaming branch,
which executed the wrapped call a *second* time. A ``create_async(stream=True)``
call was therefore issued twice (duplicate messages, duplicate billing) and
the span started for the detected stream was never ended, so it was never
exported — the whole call (span, tokens) was lost.

These tests drive the real ``async_send_message`` wrapper factory (registered
for ``MessagesClient.create_async``) with a mock async stream shaped like
letta's and assert the wrapped call runs exactly once and the span ends on
every exit path: full consumption, early ``aclose()``, early exit from
``async with``, and a failure raised by the stream.
"""

from types import SimpleNamespace

import pytest
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import (
    InMemorySpanExporter,
)
from opentelemetry.trace import StatusCode

from openlit._config import OpenlitConfig
from openlit.instrumentation.letta import async_letta as async_mod
from openlit.semcov import SemanticConvention

# Kwargs shaped like MessagesClient.create_async(agent_id=..., stream=True)
REQUEST_KWARGS = {
    "agent_id": "agent-0",
    "messages": [{"role": "user", "content": "Monitor LLM Applications"}],
    "stream": True,
}


class FakeLettaMessage(SimpleNamespace):
    """A chunk shaped like letta's LettaMessage."""


def _chunks():
    return [
        FakeLettaMessage(
            id="msg-1", message_type="assistant_message", content="partial"
        ),
        FakeLettaMessage(
            id="msg-2", message_type="assistant_message", content=" answer"
        ),
        FakeLettaMessage(
            id="msg-3",
            message_type="usage_statistics",
            prompt_tokens=10,
            completion_tokens=5,
            total_tokens=15,
        ),
    ]


class FakeLettaStream:
    """Async stream shaped like the generator returned by create_async."""

    def __init__(self):
        self._it = iter(_chunks())
        self.closed = False

    def __aiter__(self):
        return self

    async def __anext__(self):
        try:
            return next(self._it)
        except StopIteration:
            raise StopAsyncIteration from None

    async def aclose(self):
        self.closed = True


class FakeLettaErrorStream(FakeLettaStream):
    """Stream that fails on the second chunk."""

    def __init__(self):
        super().__init__()
        self._it = iter(_chunks()[:1])

    async def __anext__(self):
        await super().__anext__()
        raise RuntimeError("stream failed")


class _StartedSpanCollector(SimpleSpanProcessor):
    """SimpleSpanProcessor that also records every span it starts."""

    def __init__(self, exporter):
        super().__init__(exporter)
        self.started = []

    def on_start(self, span, parent_context=None):
        self.started.append(span)
        super().on_start(span, parent_context)


def _tracer_with_exporter():
    OpenlitConfig.reset_to_defaults()
    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    processor = _StartedSpanCollector(exporter)
    provider.add_span_processor(processor)
    return provider.get_tracer(__name__), exporter, processor


def _make_wrapped(stream_factory):
    """Async stand-in for MessagesClient.create_async that counts calls.

    A plain ``async def`` (like the bound async method wrapt passes in) so
    ``asyncio.iscoroutinefunction(wrapped)`` is True, as in real usage.
    """

    async def create(*_args, **_kwargs):
        create.calls += 1
        return stream_factory()

    create.calls = 0
    return create


def _factory(tracer):
    return async_mod.async_send_message(
        gen_ai_endpoint="letta.create_async",
        version="test",
        environment="test",
        application_name="test",
        tracer=tracer,
        pricing_info={},
        capture_message_content=True,
        metrics=None,
        disable_metrics=True,
    )


def _assert_streaming_span(exporter, chunk_count, usage=True):
    spans = exporter.get_finished_spans()
    assert len(spans) == 1, "expected exactly one exported span"
    span = spans[0]
    assert span.name == "chat gpt-4o"
    attrs = span.attributes
    # Streaming finalization must have run on the span that was started when
    # the stream was detected (the base code exported a non-streaming span
    # without any of these attributes, after calling the API twice).
    assert attrs[SemanticConvention.GEN_AI_STREAMING_CHUNK_COUNT] == chunk_count
    assert SemanticConvention.GEN_AI_SERVER_TTFT in attrs
    if usage:
        # The usage_statistics chunk is only consumed on a full iteration.
        assert attrs[SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS] == 10
        assert attrs[SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS] == 5
    return span


def _assert_calls(recorder, expected=1):
    assert recorder.calls == expected, (
        f"wrapped call executed {recorder.calls} times, expected {expected}"
    )


@pytest.mark.asyncio
async def test_async_stream_executes_wrapped_once_and_ends_span():
    tracer, exporter, _ = _tracer_with_exporter()
    recorder = _make_wrapped(FakeLettaStream)
    wrapper = _factory(tracer)

    stream = await wrapper(recorder, None, (), REQUEST_KWARGS)
    collected = [chunk async for chunk in stream]

    _assert_calls(recorder)
    assert len(collected) == 3
    _assert_streaming_span(exporter, chunk_count=3)


@pytest.mark.asyncio
async def test_async_stream_starts_one_span_and_ends_it():
    """A streaming call must start exactly one span, and that span must end.

    The base code started a span when it detected the stream, then started a
    second non-streaming span and left the first recording forever, so it was
    never exported.
    """
    tracer, exporter, collector = _tracer_with_exporter()
    recorder = _make_wrapped(FakeLettaStream)
    wrapper = _factory(tracer)

    stream = await wrapper(recorder, None, (), REQUEST_KWARGS)
    async for _ in stream:
        pass

    assert len(collector.started) == 1, (
        f"{len(collector.started)} spans started for one streaming call"
    )
    assert not collector.started[0].is_recording(), "streaming span never ended"
    assert len(exporter.get_finished_spans()) == 1


@pytest.mark.asyncio
async def test_async_stream_early_close_ends_span():
    """aclose() before exhaustion must finalize the span on its own."""
    tracer, exporter, _ = _tracer_with_exporter()
    recorder = _make_wrapped(FakeLettaStream)
    wrapper = _factory(tracer)

    stream = await wrapper(recorder, None, (), REQUEST_KWARGS)
    await anext(stream)
    await stream.aclose()

    _assert_calls(recorder)
    _assert_streaming_span(exporter, chunk_count=1, usage=False)


@pytest.mark.asyncio
async def test_async_stream_early_break_inside_async_with_ends_span():
    tracer, exporter, _ = _tracer_with_exporter()
    recorder = _make_wrapped(FakeLettaStream)
    wrapper = _factory(tracer)

    stream = await wrapper(recorder, None, (), REQUEST_KWARGS)
    async with stream as s:
        await anext(s)  # consume one chunk, then leave the block early

    _assert_calls(recorder)
    _assert_streaming_span(exporter, chunk_count=1, usage=False)


@pytest.mark.asyncio
async def test_async_stream_error_ends_error_span_and_calls_once():
    tracer, exporter, _ = _tracer_with_exporter()
    recorder = _make_wrapped(FakeLettaErrorStream)
    wrapper = _factory(tracer)

    stream = await wrapper(recorder, None, (), REQUEST_KWARGS)
    with pytest.raises(RuntimeError, match="stream failed"):
        async for _ in stream:
            pass
    # Idempotent: closing after a failure must not add a second span.
    await stream.aclose()

    _assert_calls(recorder)
    spans = exporter.get_finished_spans()
    assert len(spans) == 1, "expected exactly one exported span"
    assert spans[0].status.status_code == StatusCode.ERROR
    assert spans[0].attributes[SemanticConvention.ERROR_TYPE] == "RuntimeError"


@pytest.mark.asyncio
async def test_async_chat_non_stream_response_calls_once():
    """A chat response that is not an async iterator is also executed once."""
    tracer, exporter, _ = _tracer_with_exporter()
    response = SimpleNamespace(
        id="msg-response", messages=[{"role": "assistant", "content": "done"}]
    )
    recorder = _make_wrapped(lambda: response)
    wrapper = _factory(tracer)

    result = await wrapper(recorder, None, (), REQUEST_KWARGS)

    _assert_calls(recorder)
    assert result is response
    spans = exporter.get_finished_spans()
    assert len(spans) == 1, "expected exactly one exported span"
