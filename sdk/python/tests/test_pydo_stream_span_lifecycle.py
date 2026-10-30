"""Tests that early-exited pydo chat streams still end and export their span.

pydo streams come from the SDK's ``SSEStream`` wrapper. The traced wrapper finalized the span only from ``StopIteration`` /
``StopAsyncIteration``; ``close`` fell through ``__getattr__`` to the wrapped
stream, and a released wrapper or a mid-stream failure left the span unended.
"""

import asyncio
import gc
import threading
from concurrent.futures import ThreadPoolExecutor

import pytest
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import (
    InMemorySpanExporter,
)
from opentelemetry.trace import StatusCode

from openlit._config import OpenlitConfig
from openlit.instrumentation.pydo import async_pydo as async_mod
from openlit.instrumentation.pydo import pydo as sync_mod

FINISH = "gen_ai.response.finish_reasons"


def _tracer_and_exporter():
    OpenlitConfig.reset_to_defaults()
    exporter = InMemorySpanExporter()
    tracer_provider = TracerProvider()
    tracer_provider.add_span_processor(SimpleSpanProcessor(exporter))
    return tracer_provider.get_tracer("test-pydo-stream-lifecycle"), exporter


def _stream_kwargs():
    return {"stream": True, "model": "llama-3.3-70b-instruct"}


def _chunk(text):
    return {"choices": [{"delta": {"content": text}, "finish_reason": None}]}


def _done_chunk():
    return {"choices": [{"delta": {}, "finish_reason": "stop"}]}


class FakeSyncStream:
    """Stand-in for the SDK's ``Stream``: context manager, ``close``, iterator."""

    def __init__(self, chunks, raise_after=None, raise_on_close=False):
        self._chunks = list(chunks)
        self._index = 0
        self._raise_after = raise_after
        self._raise_on_close = raise_on_close
        self.closed = False

    def __iter__(self):
        return self

    def __next__(self):
        if self._raise_after is not None and self._index >= self._raise_after:
            raise RuntimeError("stream failed")
        if self._index >= len(self._chunks):
            raise StopIteration
        chunk = self._chunks[self._index]
        self._index += 1
        return chunk

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_value, traceback):
        self.close()
        return False

    def close(self):
        """Mark closed, matching the SDK stream."""
        self.closed = True
        if self._raise_on_close:
            raise RuntimeError("wrapped close failed")


class FakeAsyncStream:
    """Async twin, with ``async close`` and ``aclose``."""

    def __init__(self, chunks, raise_after=None):
        self._chunks = list(chunks)
        self._index = 0
        self._raise_after = raise_after
        self.closed = False

    def __aiter__(self):
        return self

    async def __anext__(self):
        if self._raise_after is not None and self._index >= self._raise_after:
            raise RuntimeError("stream failed")
        if self._index >= len(self._chunks):
            raise StopAsyncIteration
        chunk = self._chunks[self._index]
        self._index += 1
        return chunk

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc_value, traceback):
        await self.close()
        return False

    async def close(self):
        """Mark closed, matching the SDK's async stream."""
        self.closed = True


def _sync_wrapper(tracer):
    return sync_mod.chat_completions(
        version="test-version",
        environment="test-env",
        application_name="test-app",
        tracer=tracer,
        pricing_info={},
        capture_message_content=True,
        metrics=None,
        disable_metrics=True,
    )


def _async_wrapper(tracer):
    return async_mod.async_chat_completions(
        version="test-version",
        environment="test-env",
        application_name="test-app",
        tracer=tracer,
        pricing_info={},
        capture_message_content=True,
        metrics=None,
        disable_metrics=True,
    )


def test_sync_stream_close_exports_span():
    """``close()`` after a partial read finalizes with ``incomplete``."""

    tracer, exporter = _tracer_and_exporter()
    raw = FakeSyncStream([_chunk("hi"), _chunk(" there")])

    traced = _sync_wrapper(tracer)(lambda *a, **k: raw, object(), [], _stream_kwargs())
    assert next(traced) == _chunk("hi")
    traced.close()

    assert raw.closed
    (span,) = exporter.get_finished_spans()
    assert span.status.status_code == StatusCode.OK
    assert span.attributes[FINISH] == ("incomplete",)
    assert '"hi"' in span.attributes["gen_ai.output.messages"]


def test_sync_stream_full_consumption_keeps_stop():
    """A complete read keeps the default ``stop`` finish reason."""
    tracer, exporter = _tracer_and_exporter()
    raw = FakeSyncStream([_chunk("hi"), _done_chunk()])

    traced = _sync_wrapper(tracer)(lambda *a, **k: raw, object(), [], _stream_kwargs())
    assert list(traced) == [_chunk("hi"), _done_chunk()]
    traced.close()

    (span,) = exporter.get_finished_spans()
    assert span.attributes[FINISH] == ("stop",)


def test_sync_bare_for_break_exports_span_when_released():
    """A bare ``for`` plus ``break`` must still export the span when released."""
    tracer, exporter = _tracer_and_exporter()

    def run():
        raw = FakeSyncStream([_chunk("hi"), _chunk(" there")])
        traced = _sync_wrapper(tracer)(
            lambda *a, **k: raw, object(), [], _stream_kwargs()
        )
        for _item in traced:
            break

    run()
    gc.collect()

    (span,) = exporter.get_finished_spans()
    assert span.attributes[FINISH] == ("incomplete",)


def test_sync_stream_error_exports_error_status():
    """A failure mid-stream is recorded as ERROR with the partial output kept."""
    tracer, exporter = _tracer_and_exporter()
    raw = FakeSyncStream([_chunk("hi")], raise_after=1)

    traced = _sync_wrapper(tracer)(lambda *a, **k: raw, object(), [], _stream_kwargs())
    assert next(traced) == _chunk("hi")
    with pytest.raises(RuntimeError, match="stream failed"):
        next(traced)

    (span,) = exporter.get_finished_spans()
    assert span.status.status_code == StatusCode.ERROR
    assert span.attributes["error.type"] == "RuntimeError"
    assert span.attributes[FINISH] == ("error",)
    assert '"hi"' in span.attributes["gen_ai.output.messages"]


@pytest.mark.asyncio
async def test_async_stream_close_exports_span():
    """``await close()`` after a partial read finalizes with ``incomplete``."""
    tracer, exporter = _tracer_and_exporter()
    raw = FakeAsyncStream([_chunk("hi"), _chunk(" there")])

    async def fake_create(*_args, **_kwargs):
        return raw

    traced = await _async_wrapper(tracer)(fake_create, object(), [], _stream_kwargs())
    first = await anext(traced)
    assert first == _chunk("hi")
    await traced.close()

    assert raw.closed
    (span,) = exporter.get_finished_spans()
    assert span.attributes[FINISH] == ("incomplete",)


@pytest.mark.asyncio
async def test_async_stream_full_consumption_keeps_stop():
    """A complete async read keeps the default ``stop`` finish reason."""
    tracer, exporter = _tracer_and_exporter()
    raw = FakeAsyncStream([_chunk("hi"), _done_chunk()])

    async def fake_create(*_args, **_kwargs):
        return raw

    traced = await _async_wrapper(tracer)(fake_create, object(), [], _stream_kwargs())
    chunks = [chunk async for chunk in traced]
    assert chunks == [_chunk("hi"), _done_chunk()]

    (span,) = exporter.get_finished_spans()
    assert span.attributes[FINISH] == ("stop",)


@pytest.mark.parametrize("method", ["close", "context_exit"])
def test_sync_cleanup_error_exports_before_wrapper_is_released(method):
    """A sync cleanup error is exported while the wrapper is still retained."""
    tracer, exporter = _tracer_and_exporter()
    raw = FakeSyncStream([_chunk("hi")], raise_on_close=True)
    traced = _sync_wrapper(tracer)(lambda *a, **k: raw, object(), [], _stream_kwargs())
    assert next(traced) == _chunk("hi")

    with pytest.raises(RuntimeError, match="wrapped close failed"):
        if method == "close":
            traced.close()
        else:
            with traced:
                pass

    (span,) = exporter.get_finished_spans()
    assert span.status.status_code == StatusCode.ERROR
    assert span.attributes[FINISH] == ("error",)
    assert span.attributes["error.type"] == "RuntimeError"
    assert '"hi"' in span.attributes["gen_ai.output.messages"]


@pytest.mark.asyncio
@pytest.mark.parametrize("method", ["close", "context_exit"])
async def test_async_cleanup_error_exports_before_wrapper_is_released(method):
    """An async cleanup error is exported while the wrapper is still retained."""

    class FailingCleanupStream(
        FakeAsyncStream
    ):  # pylint: disable=too-few-public-methods
        """A stream whose transport cleanup fails."""

        async def close(self):
            self.closed = True
            raise RuntimeError("wrapped close failed")

    tracer, exporter = _tracer_and_exporter()
    raw = FailingCleanupStream([_chunk("hi")])

    async def create(*_args, **_kwargs):
        return raw

    traced = await _async_wrapper(tracer)(create, object(), [], _stream_kwargs())
    assert await anext(traced) == _chunk("hi")
    with pytest.raises(RuntimeError, match="wrapped close failed"):
        if method == "close":
            await traced.close()
        else:
            async with traced:
                pass

    (span,) = exporter.get_finished_spans()
    assert span.status.status_code == StatusCode.ERROR
    assert span.attributes[FINISH] == ("error",)
    assert span.attributes["error.type"] == "RuntimeError"
    assert '"hi"' in span.attributes["gen_ai.output.messages"]


@pytest.mark.asyncio
async def test_async_stream_error_exports_before_close():
    """A read failure must export immediately without an explicit close."""
    tracer, exporter = _tracer_and_exporter()
    raw = FakeAsyncStream([_chunk("hi")], raise_after=1)

    async def create(*_args, **_kwargs):
        return raw

    traced = await _async_wrapper(tracer)(create, object(), [], _stream_kwargs())
    assert await anext(traced) == _chunk("hi")
    with pytest.raises(RuntimeError, match="stream failed"):
        await anext(traced)

    (span,) = exporter.get_finished_spans()
    assert span.status.status_code == StatusCode.ERROR
    assert span.attributes[FINISH] == ("error",)
    await traced.close()
    assert len(exporter.get_finished_spans()) == 1


def test_concurrent_close_waits_for_sync_read_error():
    """A racing close must include the error from an in-flight sync read."""
    entered = threading.Event()
    release = threading.Event()

    class BlockingStream(FakeSyncStream):
        """Hold the second read until cleanup has run."""

        def __next__(self):
            if self._index == 1:
                entered.set()
                assert release.wait(timeout=3)
                raise RuntimeError("in-flight read failed")
            return super().__next__()

    tracer, exporter = _tracer_and_exporter()
    raw = BlockingStream([_chunk("hi")])
    traced = _sync_wrapper(tracer)(lambda *a, **k: raw, object(), [], _stream_kwargs())
    assert next(traced) == _chunk("hi")
    with ThreadPoolExecutor(max_workers=1) as executor:
        read = executor.submit(next, traced)
        try:
            assert entered.wait(timeout=3)
            traced.close()
            assert not exporter.get_finished_spans()
        finally:
            release.set()
        with pytest.raises(RuntimeError, match="in-flight read failed"):
            read.result(timeout=3)

    (span,) = exporter.get_finished_spans()
    assert span.status.status_code == StatusCode.ERROR
    assert span.attributes[FINISH] == ("error",)
    traced.close()
    assert len(exporter.get_finished_spans()) == 1


@pytest.mark.asyncio
async def test_concurrent_close_waits_for_async_read_error():
    """A racing close must include the error from an in-flight async read."""
    entered = asyncio.Event()
    release = asyncio.Event()

    class BlockingStream(FakeAsyncStream):
        """Hold the second read until cleanup has run."""

        async def __anext__(self):
            if self._index == 1:
                entered.set()
                await release.wait()
                raise RuntimeError("in-flight read failed")
            return await super().__anext__()

    tracer, exporter = _tracer_and_exporter()
    raw = BlockingStream([_chunk("hi")])

    async def create(*_args, **_kwargs):
        return raw

    traced = await _async_wrapper(tracer)(create, object(), [], _stream_kwargs())
    assert await anext(traced) == _chunk("hi")
    read = asyncio.create_task(anext(traced))
    try:
        await asyncio.wait_for(entered.wait(), timeout=3)
        await traced.close()
        assert not exporter.get_finished_spans()
    finally:
        release.set()
        result = await asyncio.gather(read, return_exceptions=True)
    assert isinstance(result[0], RuntimeError)
    assert str(result[0]) == "in-flight read failed"
    (span,) = exporter.get_finished_spans()
    assert span.status.status_code == StatusCode.ERROR
    assert span.attributes[FINISH] == ("error",)
    await traced.close()
    assert len(exporter.get_finished_spans()) == 1
