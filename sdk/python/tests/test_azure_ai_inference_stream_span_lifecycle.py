# pylint: disable=protected-access, duplicate-code, missing-function-docstring
"""Regression tests: the Azure AI Inference streaming wrappers must end their
span exactly once on exhaustion, context-manager exit and explicit close.

`TracedSyncStream`/`TracedAsyncStream` never ended the span they were handed.
`__next__`/`__anext__` had no `StopIteration`/`StopAsyncIteration` handler,
`__exit__`/`__aexit__` populated the span attributes but never ended it, and
there was no `close()`/`aclose()`. So no span was exported for any streamed
completion: not for a fully consumed stream (with or without a `with` block),
not for an early `break`, and not for an explicit `close()`/`aclose()` — the
whole call (span, cost, tokens) was lost. This is the Azure AI Inference
instance of the streaming-span lifecycle fixed for Groq in #1516 and Mistral
in #1517.

These tests drive the real `complete`/`async_complete` wrapper factories with
a synthetic stream shaped like azure-ai-inference's `StreamingChatCompletions`
and `AsyncStreamingChatCompletions`, and assert exactly one span is exported
on exhaustion, context-manager exit (clean or with an exception), explicit
`close()`/`aclose()`, and a failure raised by the iterator itself. Cancels
export finish reason ``incomplete``. Failures keep the partial text, set
finish reason ``error``, and record metrics with ``error.type``. Chunk
``id`` and ``model`` are copied onto the span.
"""

import pytest
from opentelemetry.trace import StatusCode
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import (
    InMemorySpanExporter,
)

from openlit._config import OpenlitConfig
from openlit.instrumentation.azure_ai_inference import azure_ai_inference as sync_mod
from openlit.instrumentation.azure_ai_inference import (
    async_azure_ai_inference as async_mod,
)
from openlit.instrumentation.azure_ai_inference import utils as azure_utils
from openlit.semcov import SemanticConvention

REQUEST_KWARGS = {
    "model": "gpt-4o",
    "stream": True,
    "messages": [{"role": "user", "content": "Monitor LLM Applications"}],
}

# Two Azure-shaped updates: a content delta, then a final update with usage.
CHUNKS = [
    {
        "id": "chatcmpl-1",
        "model": "gpt-4o",
        "choices": [{"index": 0, "delta": {"content": "partial"}, "finish_reason": None}],
    },
    {
        "id": "chatcmpl-1",
        "model": "gpt-4o",
        "choices": [{"index": 0, "delta": {"content": " answer"}, "finish_reason": "stop"}],
        "usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15},
    },
]


def _tracer_with_exporter():
    OpenlitConfig.reset_to_defaults()
    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    return provider.get_tracer(__name__), exporter


def _factory(tracer, *, is_async, disable_metrics=True):
    mod = async_mod if is_async else sync_mod
    make = mod.async_complete if is_async else mod.complete
    return make(
        version="test",
        environment="test",
        application_name="test",
        tracer=tracer,
        pricing_info={},
        capture_message_content=True,
        metrics=None,
        disable_metrics=disable_metrics,
        event_provider=None,
    )


class FakeSyncStream:
    """Sync stream shaped like azure-ai-inference's StreamingChatCompletions."""

    def __init__(self, raise_on_close=False, raise_after=None):
        self._it = iter(CHUNKS)
        self._raise_on_close = raise_on_close
        self._raise_after = raise_after
        self._seen = 0
        self.closed = False

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()

    def __iter__(self):
        return self

    def __next__(self):
        if self._raise_after is not None and self._seen >= self._raise_after:
            raise RuntimeError("stream failed")
        self._seen += 1
        return next(self._it)

    def close(self):
        self.closed = True
        if self._raise_on_close:
            raise RuntimeError("wrapped close failed")


class FakeAsyncStream:
    """Async stream shaped like azure-ai-inference's AsyncStreamingChatCompletions."""

    def __init__(self, raise_on_close=False, raise_after=None):
        self._it = iter(CHUNKS)
        self._raise_on_close = raise_on_close
        self._raise_after = raise_after
        self._seen = 0
        self.closed = False

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        await self.aclose()

    def __aiter__(self):
        return self

    async def __anext__(self):
        if self._raise_after is not None and self._seen >= self._raise_after:
            raise RuntimeError("stream failed")
        self._seen += 1
        try:
            return next(self._it)
        except StopIteration:
            raise StopAsyncIteration from None

    async def aclose(self):
        self.closed = True
        if self._raise_on_close:
            raise RuntimeError("wrapped close failed")


def _acreate(raw):
    async def create(*_a, **_k):
        """Async stand-in for azure.ai.inference.aio ChatCompletionsClient.complete."""
        return raw

    return create


def _count_calls(monkeypatch, mod, name):
    calls = []
    original = getattr(mod, name)

    def counting(*args, **kwargs):
        calls.append(1)
        return original(*args, **kwargs)

    monkeypatch.setattr(mod, name, counting)
    return calls


def _assert_one_span_with_tokens(exporter, *, input_tokens, output_tokens, finish_reason):
    spans = exporter.get_finished_spans()
    assert len(spans) == 1, "expected exactly one exported span"
    span = spans[0]
    assert span.status.status_code == StatusCode.OK
    attrs = span.attributes
    assert attrs[SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS] == input_tokens
    assert attrs[SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS] == output_tokens
    assert tuple(attrs[SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON]) == (finish_reason,)
    assert attrs[SemanticConvention.GEN_AI_RESPONSE_ID] == "chatcmpl-1"
    assert attrs[SemanticConvention.GEN_AI_RESPONSE_MODEL] == "gpt-4o"
    assert "partial" in attrs[SemanticConvention.GEN_AI_OUTPUT_MESSAGES]


def _assert_one_error_span(exporter):
    spans = exporter.get_finished_spans()
    assert len(spans) == 1, "expected exactly one exported span"
    span = spans[0]
    assert span.status.status_code == StatusCode.ERROR
    attrs = span.attributes
    assert attrs[SemanticConvention.ERROR_TYPE] == "RuntimeError"
    assert tuple(attrs[SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON]) == ("error",)
    assert attrs[SemanticConvention.GEN_AI_RESPONSE_ID] == "chatcmpl-1"
    assert attrs[SemanticConvention.GEN_AI_RESPONSE_MODEL] == "gpt-4o"
    assert "partial" in attrs[SemanticConvention.GEN_AI_OUTPUT_MESSAGES]
    assert attrs[SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS] == 0


def _spy_metrics(monkeypatch):
    recorded = []

    def spy(*_args, **kwargs):
        recorded.append(kwargs)

    monkeypatch.setattr(azure_utils, "record_completion_metrics", spy)
    return recorded


def test_sync_full_consumption_without_with_exports_exactly_one_span():
    tracer, exporter = _tracer_with_exporter()
    wrapper = _factory(tracer, is_async=False)

    stream = wrapper(lambda *a, **k: FakeSyncStream(), None, (), REQUEST_KWARGS)
    for _ in stream:
        pass

    _assert_one_span_with_tokens(exporter, input_tokens=10, output_tokens=5, finish_reason="stop")


def test_sync_full_consumption_inside_with_exports_exactly_one_span():
    tracer, exporter = _tracer_with_exporter()
    wrapper = _factory(tracer, is_async=False)

    stream = wrapper(lambda *a, **k: FakeSyncStream(), None, (), REQUEST_KWARGS)
    with stream as s:
        for _ in s:
            pass

    _assert_one_span_with_tokens(exporter, input_tokens=10, output_tokens=5, finish_reason="stop")


def test_sync_early_break_inside_with_ends_span():
    tracer, exporter = _tracer_with_exporter()
    wrapper = _factory(tracer, is_async=False)

    stream = wrapper(lambda *a, **k: FakeSyncStream(), None, (), REQUEST_KWARGS)
    with stream as s:
        for _ in s:
            break  # consume one update, then leave the block early

    # The final usage-bearing update was not consumed, so an early exit must
    # export the span without inventing token counts.
    _assert_one_span_with_tokens(
        exporter, input_tokens=0, output_tokens=0, finish_reason="incomplete"
    )


def test_sync_close_finalizes_span():
    tracer, exporter = _tracer_with_exporter()
    wrapper = _factory(tracer, is_async=False)

    raw = FakeSyncStream()
    stream = wrapper(lambda *a, **k: raw, None, (), REQUEST_KWARGS)
    next(stream)
    stream.close()

    assert raw.closed
    _assert_one_span_with_tokens(
        exporter, input_tokens=0, output_tokens=0, finish_reason="incomplete"
    )


def test_sync_close_finalizes_span_when_wrapped_close_raises():
    tracer, exporter = _tracer_with_exporter()
    wrapper = _factory(tracer, is_async=False)

    raw = FakeSyncStream(raise_on_close=True)
    stream = wrapper(lambda *a, **k: raw, None, (), REQUEST_KWARGS)
    next(stream)
    with pytest.raises(RuntimeError, match="wrapped close failed"):
        stream.close()

    _assert_one_span_with_tokens(
        exporter, input_tokens=0, output_tokens=0, finish_reason="incomplete"
    )


def test_sync_exception_inside_with_ends_error_span():
    tracer, exporter = _tracer_with_exporter()
    wrapper = _factory(tracer, is_async=False)

    stream = wrapper(lambda *a, **k: FakeSyncStream(), None, (), REQUEST_KWARGS)
    with pytest.raises(RuntimeError, match="stream failed"):
        with stream as s:
            next(s)
            raise RuntimeError("stream failed")

    _assert_one_error_span(exporter)


def test_sync_exception_after_exhaustion_keeps_finalized_span(monkeypatch):
    error_calls = _count_calls(monkeypatch, sync_mod, "handle_exception")
    tracer, exporter = _tracer_with_exporter()
    wrapper = _factory(tracer, is_async=False)

    stream = wrapper(lambda *a, **k: FakeSyncStream(), None, (), REQUEST_KWARGS)
    with pytest.raises(RuntimeError, match="caller failed"):
        with stream as s:
            for _ in s:
                pass
            raise RuntimeError("caller failed")

    # The span already ended on exhaustion; the caller's later error must not
    # be written onto it. OTel silently drops writes to an ended span, so the
    # exported span cannot show this: count the calls instead.
    assert not error_calls, "the finalized span must not take the later error"
    _assert_one_span_with_tokens(exporter, input_tokens=10, output_tokens=5, finish_reason="stop")
    assert exporter.get_finished_spans()[0].status.status_code == StatusCode.OK


def test_sync_finalizes_once_across_exhaustion_exit_and_close(monkeypatch):
    calls = _count_calls(monkeypatch, sync_mod, "process_streaming_chat_response")
    tracer, exporter = _tracer_with_exporter()
    wrapper = _factory(tracer, is_async=False)

    stream = wrapper(lambda *a, **k: FakeSyncStream(), None, (), REQUEST_KWARGS)
    with stream as s:
        for _ in s:
            pass
    stream.close()

    assert len(calls) == 1, "span telemetry must be processed exactly once"
    _assert_one_span_with_tokens(exporter, input_tokens=10, output_tokens=5, finish_reason="stop")


def test_sync_iterator_error_without_with_exports_error_span(monkeypatch):
    recorded = _spy_metrics(monkeypatch)
    tracer, exporter = _tracer_with_exporter()
    wrapper = _factory(tracer, is_async=False, disable_metrics=False)

    raw = FakeSyncStream(raise_after=1)
    stream = wrapper(lambda *a, **k: raw, None, (), REQUEST_KWARGS)
    with pytest.raises(RuntimeError, match="stream failed"):
        for _ in stream:
            pass

    assert raw.closed
    _assert_one_error_span(exporter)
    assert len(recorded) == 1
    assert recorded[0]["error_type"] == "RuntimeError"


def test_sync_iterator_error_exports_span_when_wrapped_close_raises():
    tracer, exporter = _tracer_with_exporter()
    wrapper = _factory(tracer, is_async=False)

    raw = FakeSyncStream(raise_on_close=True, raise_after=1)
    stream = wrapper(lambda *a, **k: raw, None, (), REQUEST_KWARGS)
    with pytest.raises(RuntimeError, match="stream failed"):
        for _ in stream:
            pass

    assert raw.closed
    _assert_one_error_span(exporter)


def test_sync_process_chunk_error_exports_span_without_closing(monkeypatch):
    def boom(*_args, **_kwargs):
        raise RuntimeError("chunk failed")

    monkeypatch.setattr(sync_mod, "process_chunk", boom)
    tracer, exporter = _tracer_with_exporter()
    wrapper = _factory(tracer, is_async=False)

    raw = FakeSyncStream()
    stream = wrapper(lambda *a, **k: raw, None, (), REQUEST_KWARGS)
    with pytest.raises(RuntimeError, match="chunk failed"):
        next(stream)

    assert not raw.closed
    spans = exporter.get_finished_spans()
    assert len(spans) == 1
    assert spans[0].status.status_code == StatusCode.ERROR
    assert spans[0].attributes[SemanticConvention.ERROR_TYPE] == "RuntimeError"
    finish = spans[0].attributes[SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON]
    assert tuple(finish) == ("error",)


@pytest.mark.asyncio
async def test_async_full_consumption_without_with_exports_exactly_one_span():
    tracer, exporter = _tracer_with_exporter()
    wrapper = _factory(tracer, is_async=True)

    stream = await wrapper(_acreate(FakeAsyncStream()), None, (), REQUEST_KWARGS)
    async for _ in stream:
        pass

    _assert_one_span_with_tokens(exporter, input_tokens=10, output_tokens=5, finish_reason="stop")


@pytest.mark.asyncio
async def test_async_full_consumption_inside_with_exports_exactly_one_span():
    tracer, exporter = _tracer_with_exporter()
    wrapper = _factory(tracer, is_async=True)

    stream = await wrapper(_acreate(FakeAsyncStream()), None, (), REQUEST_KWARGS)
    async with stream as s:
        async for _ in s:
            pass

    _assert_one_span_with_tokens(exporter, input_tokens=10, output_tokens=5, finish_reason="stop")


@pytest.mark.asyncio
async def test_async_early_break_inside_with_ends_span():
    tracer, exporter = _tracer_with_exporter()
    wrapper = _factory(tracer, is_async=True)

    stream = await wrapper(_acreate(FakeAsyncStream()), None, (), REQUEST_KWARGS)
    async with stream as s:
        async for _ in s:
            break

    _assert_one_span_with_tokens(
        exporter, input_tokens=0, output_tokens=0, finish_reason="incomplete"
    )


@pytest.mark.asyncio
async def test_async_aclose_finalizes_span():
    tracer, exporter = _tracer_with_exporter()
    wrapper = _factory(tracer, is_async=True)

    raw = FakeAsyncStream()
    stream = await wrapper(_acreate(raw), None, (), REQUEST_KWARGS)
    await anext(stream)
    await stream.aclose()

    assert raw.closed
    _assert_one_span_with_tokens(
        exporter, input_tokens=0, output_tokens=0, finish_reason="incomplete"
    )


@pytest.mark.asyncio
async def test_async_aclose_finalizes_span_when_wrapped_aclose_raises():
    tracer, exporter = _tracer_with_exporter()
    wrapper = _factory(tracer, is_async=True)

    raw = FakeAsyncStream(raise_on_close=True)
    stream = await wrapper(_acreate(raw), None, (), REQUEST_KWARGS)
    await anext(stream)
    with pytest.raises(RuntimeError, match="wrapped close failed"):
        await stream.aclose()

    _assert_one_span_with_tokens(
        exporter, input_tokens=0, output_tokens=0, finish_reason="incomplete"
    )


@pytest.mark.asyncio
async def test_async_exception_inside_with_ends_error_span():
    tracer, exporter = _tracer_with_exporter()
    wrapper = _factory(tracer, is_async=True)

    stream = await wrapper(_acreate(FakeAsyncStream()), None, (), REQUEST_KWARGS)
    with pytest.raises(RuntimeError, match="stream failed"):
        async with stream as s:
            await anext(s)
            raise RuntimeError("stream failed")

    _assert_one_error_span(exporter)


@pytest.mark.asyncio
async def test_async_exception_after_exhaustion_keeps_finalized_span(monkeypatch):
    error_calls = _count_calls(monkeypatch, async_mod, "handle_exception")
    tracer, exporter = _tracer_with_exporter()
    wrapper = _factory(tracer, is_async=True)

    stream = await wrapper(_acreate(FakeAsyncStream()), None, (), REQUEST_KWARGS)
    with pytest.raises(RuntimeError, match="caller failed"):
        async with stream as s:
            async for _ in s:
                pass
            raise RuntimeError("caller failed")

    assert not error_calls, "the finalized span must not take the later error"
    _assert_one_span_with_tokens(exporter, input_tokens=10, output_tokens=5, finish_reason="stop")
    assert exporter.get_finished_spans()[0].status.status_code == StatusCode.OK


@pytest.mark.asyncio
async def test_async_finalizes_once_across_exhaustion_exit_and_aclose(monkeypatch):
    calls = _count_calls(monkeypatch, async_mod, "process_streaming_chat_response")
    tracer, exporter = _tracer_with_exporter()
    wrapper = _factory(tracer, is_async=True)

    stream = await wrapper(_acreate(FakeAsyncStream()), None, (), REQUEST_KWARGS)
    async with stream as s:
        async for _ in s:
            pass
    await stream.aclose()

    assert len(calls) == 1, "span telemetry must be processed exactly once"
    _assert_one_span_with_tokens(exporter, input_tokens=10, output_tokens=5, finish_reason="stop")


@pytest.mark.asyncio
async def test_async_iterator_error_without_with_exports_error_span(monkeypatch):
    recorded = _spy_metrics(monkeypatch)
    tracer, exporter = _tracer_with_exporter()
    wrapper = _factory(tracer, is_async=True, disable_metrics=False)

    raw = FakeAsyncStream(raise_after=1)
    stream = await wrapper(_acreate(raw), None, (), REQUEST_KWARGS)
    with pytest.raises(RuntimeError, match="stream failed"):
        async for _ in stream:
            pass

    assert raw.closed
    _assert_one_error_span(exporter)
    assert len(recorded) == 1
    assert recorded[0]["error_type"] == "RuntimeError"


@pytest.mark.asyncio
async def test_async_iterator_error_exports_span_when_wrapped_aclose_raises():
    tracer, exporter = _tracer_with_exporter()
    wrapper = _factory(tracer, is_async=True)

    raw = FakeAsyncStream(raise_on_close=True, raise_after=1)
    stream = await wrapper(_acreate(raw), None, (), REQUEST_KWARGS)
    with pytest.raises(RuntimeError, match="stream failed"):
        async for _ in stream:
            pass

    assert raw.closed
    _assert_one_error_span(exporter)


@pytest.mark.asyncio
async def test_async_process_chunk_error_exports_span_without_closing(monkeypatch):
    def boom(*_args, **_kwargs):
        raise RuntimeError("chunk failed")

    monkeypatch.setattr(async_mod, "process_chunk", boom)
    tracer, exporter = _tracer_with_exporter()
    wrapper = _factory(tracer, is_async=True)

    raw = FakeAsyncStream()
    stream = await wrapper(_acreate(raw), None, (), REQUEST_KWARGS)
    with pytest.raises(RuntimeError, match="chunk failed"):
        await anext(stream)

    assert not raw.closed
    spans = exporter.get_finished_spans()
    assert len(spans) == 1
    assert spans[0].status.status_code == StatusCode.ERROR
    assert spans[0].attributes[SemanticConvention.ERROR_TYPE] == "RuntimeError"
    finish = spans[0].attributes[SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON]
    assert tuple(finish) == ("error",)
