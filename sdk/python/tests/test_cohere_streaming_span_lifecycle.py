"""Tests that an early-exited Cohere chat_stream still ends and exports its span."""

import pytest
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import (
    InMemorySpanExporter,
)

from openlit.instrumentation.cohere.async_cohere import async_chat_stream
from openlit.instrumentation.cohere.cohere import chat_stream
from openlit._config import OpenlitConfig


def _tracer_and_exporter():
    OpenlitConfig.reset_to_defaults()
    exporter = InMemorySpanExporter()
    tracer_provider = TracerProvider()
    tracer_provider.add_span_processor(SimpleSpanProcessor(exporter))
    return tracer_provider.get_tracer("test-cohere-stream-lifecycle"), exporter


def _chat_kwargs():
    return {"model": "command-r-plus-08-2024", "messages": [{"role": "user", "content": "ping"}]}


_CHUNK = {
    "type": "content-delta",
    "delta": {"message": {"content": {"text": "hi"}}},
}


class FakeRawSyncStream:
    """Stand-in for cohere.ClientV2.chat_stream()'s real return value: a plain
    generator (`with self._raw_client.chat_stream(...) as r: yield from r.data`),
    which supports the iterator protocol and close(), never __enter__/__exit__.
    raise_on_close reproduces a connection error surfacing through the wrapped
    generator's own close(), which must not prevent span finalization."""

    def __init__(self, chunks, raise_on_close=False):
        self._chunks = list(chunks)
        self.closed = False
        self._raise_on_close = raise_on_close

    def __iter__(self):
        return self

    def __next__(self):
        if not self._chunks:
            raise StopIteration
        return self._chunks.pop(0)

    def close(self):
        """Mark closed, matching a generator's own close()."""
        self.closed = True
        if self._raise_on_close:
            raise RuntimeError("wrapped close failed")


class FakeRawAsyncStream:
    """Async twin of FakeRawSyncStream, matching an async generator: no
    __aenter__/__aexit__, and aclose() rather than close()."""

    def __init__(self, chunks, raise_on_close=False):
        self._chunks = list(chunks)
        self.closed = False
        self._raise_on_close = raise_on_close

    def __aiter__(self):
        return self

    async def __anext__(self):
        if not self._chunks:
            raise StopAsyncIteration
        return self._chunks.pop(0)

    async def aclose(self):
        """Mark closed, matching an async generator's own aclose()."""
        self.closed = True
        if self._raise_on_close:
            raise RuntimeError("wrapped close failed")


def _sync_wrapper(tracer):
    return chat_stream(
        version="test-version",
        environment="test-env",
        application_name="test-app",
        tracer=tracer,
        pricing_info={},
        capture_message_content=False,
        metrics=None,
        disable_metrics=True,
    )


def _async_wrapper(tracer):
    return async_chat_stream(
        version="test-version",
        environment="test-env",
        application_name="test-app",
        tracer=tracer,
        pricing_info={},
        capture_message_content=False,
        metrics=None,
        disable_metrics=True,
    )


def test_sync_stream_closed_via_context_manager_break_still_exports_span():
    """An early `break` inside a `with ... as stream:` block must still end and
    export the span. Before this fix, __enter__ delegated to the wrapped
    generator's own __enter__, which does not exist, so this raised
    AttributeError instead of ever reaching the span leak."""

    tracer, exporter = _tracer_and_exporter()
    wrapper = _sync_wrapper(tracer)

    raw_stream = FakeRawSyncStream([_CHUNK, _CHUNK])

    def fake_create(*_args, **_kwargs):
        return raw_stream

    traced_stream = wrapper(fake_create, object(), [], _chat_kwargs())

    with traced_stream as stream:
        for _chunk in stream:
            break

    assert raw_stream.closed
    spans = exporter.get_finished_spans()
    assert len(spans) == 1


def test_sync_stream_explicit_close_still_exports_span():
    """Calling .close() directly (no context manager) must also finalize."""

    tracer, exporter = _tracer_and_exporter()
    wrapper = _sync_wrapper(tracer)

    raw_stream = FakeRawSyncStream([_CHUNK])

    def fake_create(*_args, **_kwargs):
        return raw_stream

    traced_stream = wrapper(fake_create, object(), [], _chat_kwargs())
    next(traced_stream)
    traced_stream.close()

    assert raw_stream.closed
    spans = exporter.get_finished_spans()
    assert len(spans) == 1


def test_sync_stream_full_consumption_exports_exactly_one_span():
    """Full StopIteration consumption inside a `with` block must not
    double-finalize (both __next__ and __exit__ fire)."""

    tracer, exporter = _tracer_and_exporter()
    wrapper = _sync_wrapper(tracer)

    raw_stream = FakeRawSyncStream([_CHUNK])

    def fake_create(*_args, **_kwargs):
        return raw_stream

    traced_stream = wrapper(fake_create, object(), [], _chat_kwargs())

    with traced_stream as stream:
        for _chunk in stream:
            pass

    spans = exporter.get_finished_spans()
    assert len(spans) == 1


def test_sync_stream_close_still_exports_span_when_wrapped_close_raises():
    """If the wrapped generator's own close() raises, the span must still be
    finalized and exported rather than silently dropped."""

    tracer, exporter = _tracer_and_exporter()
    wrapper = _sync_wrapper(tracer)

    raw_stream = FakeRawSyncStream([_CHUNK], raise_on_close=True)

    def fake_create(*_args, **_kwargs):
        return raw_stream

    traced_stream = wrapper(fake_create, object(), [], _chat_kwargs())
    next(traced_stream)

    with pytest.raises(RuntimeError):
        traced_stream.close()

    assert raw_stream.closed
    spans = exporter.get_finished_spans()
    assert len(spans) == 1


@pytest.mark.asyncio
async def test_async_stream_closed_via_context_manager_break_still_exports_span():
    """Async twin of the sync early-break test."""

    tracer, exporter = _tracer_and_exporter()
    wrapper = _async_wrapper(tracer)

    raw_stream = FakeRawAsyncStream([_CHUNK, _CHUNK])

    async def fake_create(*_args, **_kwargs):
        return raw_stream

    traced_stream = await wrapper(fake_create, object(), [], _chat_kwargs())

    async with traced_stream as stream:
        async for _chunk in stream:
            break

    assert raw_stream.closed
    spans = exporter.get_finished_spans()
    assert len(spans) == 1


@pytest.mark.asyncio
async def test_async_stream_full_consumption_exports_exactly_one_span():
    """Async twin of the full-consumption control test."""

    tracer, exporter = _tracer_and_exporter()
    wrapper = _async_wrapper(tracer)

    raw_stream = FakeRawAsyncStream([_CHUNK])

    async def fake_create(*_args, **_kwargs):
        return raw_stream

    traced_stream = await wrapper(fake_create, object(), [], _chat_kwargs())

    async with traced_stream as stream:
        async for _chunk in stream:
            pass

    spans = exporter.get_finished_spans()
    assert len(spans) == 1


@pytest.mark.asyncio
async def test_async_stream_explicit_aclose_still_exports_span():
    """Calling .aclose() directly, the native async-generator cleanup method,
    must finalize the span too. Before this fix only close() was defined, so
    aclose() fell through __getattr__ straight to the wrapped stream and the
    span was never finalized."""

    tracer, exporter = _tracer_and_exporter()
    wrapper = _async_wrapper(tracer)

    raw_stream = FakeRawAsyncStream([_CHUNK])

    async def fake_create(*_args, **_kwargs):
        return raw_stream

    traced_stream = await wrapper(fake_create, object(), [], _chat_kwargs())
    await anext(traced_stream)
    await traced_stream.aclose()

    assert raw_stream.closed
    spans = exporter.get_finished_spans()
    assert len(spans) == 1


@pytest.mark.asyncio
async def test_async_stream_close_still_exports_span_when_wrapped_close_raises():
    """Async twin of test_sync_stream_close_still_exports_span_when_wrapped_close_raises."""

    tracer, exporter = _tracer_and_exporter()
    wrapper = _async_wrapper(tracer)

    raw_stream = FakeRawAsyncStream([_CHUNK], raise_on_close=True)

    async def fake_create(*_args, **_kwargs):
        return raw_stream

    traced_stream = await wrapper(fake_create, object(), [], _chat_kwargs())
    await anext(traced_stream)

    with pytest.raises(RuntimeError):
        await traced_stream.close()

    assert raw_stream.closed
    spans = exporter.get_finished_spans()
    assert len(spans) == 1
