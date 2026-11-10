"""Tests that an early-exited Cohere chat_stream still ends and exports its span."""

import asyncio
import gc

import pytest
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import (
    InMemorySpanExporter,
)
from opentelemetry.trace import StatusCode

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


def _sync_wrapper(tracer, capture_message_content=False):
    return chat_stream(
        version="test-version",
        environment="test-env",
        application_name="test-app",
        tracer=tracer,
        pricing_info={},
        capture_message_content=capture_message_content,
        metrics=None,
        disable_metrics=True,
    )


def _async_wrapper(tracer, capture_message_content=False):
    return async_chat_stream(
        version="test-version",
        environment="test-env",
        application_name="test-app",
        tracer=tracer,
        pricing_info={},
        capture_message_content=capture_message_content,
        metrics=None,
        disable_metrics=True,
    )


def _chunk(text):
    return {
        "type": "content-delta",
        "delta": {"message": {"content": {"text": text}}},
    }


def _finish_reasons(span):
    return tuple(span.attributes["gen_ai.response.finish_reasons"])


async def _wait_for_async_close(box):
    """Async generator aclose() is scheduled from GC and can take two turns."""
    for _ in range(5):
        if box["closed"]:
            return
        gc.collect()
        await asyncio.sleep(0)


class _ClosingSyncSource:
    """HTTP stand-in whose ``with`` exits when the generator is closed."""

    def __init__(self, chunks, box, raise_after=None):
        self._chunks = list(chunks)
        self._box = box
        self._raise_after = raise_after
        self._index = 0

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_value, traceback):
        self._box["closed"] = True

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


def _sync_chat_generator(chunks, box, raise_after=None):
    """Same shape as ClientV2.chat_stream: ``with raw: yield from raw``."""

    def _generate():
        with _ClosingSyncSource(chunks, box, raise_after) as raw:
            yield from raw

    return _generate()


class _ClosingAsyncSource:
    """Async twin of _ClosingSyncSource."""

    def __init__(self, chunks, box, raise_after=None):
        self._chunks = list(chunks)
        self._box = box
        self._raise_after = raise_after
        self._index = 0

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc_value, traceback):
        self._box["closed"] = True

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


def _async_chat_generator(chunks, box, raise_after=None):
    """Same shape as AsyncClientV2.chat_stream: ``async with`` plus yield."""

    async def _generate():
        async with _ClosingAsyncSource(chunks, box, raise_after) as raw:
            async for chunk in raw:
                yield chunk

    return _generate()


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
    # StopIteration is a clean end. An empty finish reason stays empty
    # instead of being rewritten to "incomplete".
    assert _finish_reasons(spans[0]) == ("",)


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
    assert _finish_reasons(spans[0]) == ("",)


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


def test_sync_bare_for_break_exports_span_when_wrapper_is_released():
    """A bare ``for`` plus ``break`` never calls close(). The span ends when
    the wrapper is released, which is when a native generator would close."""

    tracer, exporter = _tracer_and_exporter()
    wrapper = _sync_wrapper(tracer, capture_message_content=True)
    box = {"closed": False}

    def fake_create(*_args, **_kwargs):
        return _sync_chat_generator([_chunk("hi"), _chunk("there")], box)

    def run():
        traced_stream = wrapper(fake_create, object(), [], _chat_kwargs())
        for _item in traced_stream:
            break

    run()
    gc.collect()

    assert box["closed"]
    spans = exporter.get_finished_spans()
    assert len(spans) == 1
    assert spans[0].status.status_code == StatusCode.OK
    assert _finish_reasons(spans[0]) == ("incomplete",)
    assert "hi" in spans[0].attributes["gen_ai.output.messages"]


def test_sync_held_stream_stays_open_until_released():
    """Keeping the stream object must leave it resumable. The span ends when
    that name is dropped, not at the ``break``."""

    tracer, exporter = _tracer_and_exporter()
    wrapper = _sync_wrapper(tracer, capture_message_content=True)
    box = {"closed": False}
    chunks = [_chunk("one"), _chunk("two"), _chunk("three")]

    def fake_create(*_args, **_kwargs):
        return _sync_chat_generator(chunks, box)

    response = wrapper(fake_create, object(), [], _chat_kwargs())
    for item in response:
        assert item == chunks[0]
        break

    assert len(exporter.get_finished_spans()) == 0
    assert box["closed"] is False
    assert next(response) == chunks[1]
    assert len(exporter.get_finished_spans()) == 0

    del response
    gc.collect()

    assert box["closed"]
    spans = exporter.get_finished_spans()
    assert len(spans) == 1
    assert spans[0].status.status_code == StatusCode.OK
    assert _finish_reasons(spans[0]) == ("incomplete",)
    output = spans[0].attributes["gen_ai.output.messages"]
    assert "onetwo" in output
    assert "three" not in output


def test_sync_stream_error_inside_with_marks_span_error():
    """A failure from the generator is a failed span, with text already seen."""

    tracer, exporter = _tracer_and_exporter()
    wrapper = _sync_wrapper(tracer, capture_message_content=True)
    box = {"closed": False}

    def fake_create(*_args, **_kwargs):
        return _sync_chat_generator([_chunk("hi"), _chunk("nope")], box, raise_after=1)

    traced_stream = wrapper(fake_create, object(), [], _chat_kwargs())

    with pytest.raises(RuntimeError, match="stream failed"):
        with traced_stream as stream:
            for _item in stream:
                pass

    assert box["closed"]
    spans = exporter.get_finished_spans()
    assert len(spans) == 1
    assert spans[0].status.status_code == StatusCode.ERROR
    assert spans[0].attributes["error.type"] == "RuntimeError"
    assert _finish_reasons(spans[0]) == ("error",)
    assert "hi" in spans[0].attributes["gen_ai.output.messages"]


def test_sync_caller_exception_inside_with_stays_ok():
    """A raise from user code is not a Cohere failure. The cancel is incomplete."""

    tracer, exporter = _tracer_and_exporter()
    wrapper = _sync_wrapper(tracer, capture_message_content=True)
    box = {"closed": False}

    def fake_create(*_args, **_kwargs):
        return _sync_chat_generator([_chunk("hi"), _chunk("more")], box)

    traced_stream = wrapper(fake_create, object(), [], _chat_kwargs())

    with pytest.raises(ValueError, match="caller"):
        with traced_stream as stream:
            for _item in stream:
                raise ValueError("caller")

    assert box["closed"]
    spans = exporter.get_finished_spans()
    assert len(spans) == 1
    assert spans[0].status.status_code == StatusCode.OK
    assert _finish_reasons(spans[0]) == ("incomplete",)
    assert "hi" in spans[0].attributes["gen_ai.output.messages"]


@pytest.mark.asyncio
async def test_async_bare_for_break_exports_span_when_wrapper_is_released():
    """Async twin of the bare-loop release test. The span ends in ``__del__``
    without waiting for the async generator's GC hook."""

    tracer, exporter = _tracer_and_exporter()
    wrapper = _async_wrapper(tracer, capture_message_content=True)
    box = {"closed": False}

    async def fake_create(*_args, **_kwargs):
        return _async_chat_generator([_chunk("hi"), _chunk("there")], box)

    async def run():
        traced_stream = await wrapper(fake_create, object(), [], _chat_kwargs())
        async for _item in traced_stream:
            break

    await run()
    spans = exporter.get_finished_spans()
    assert len(spans) == 1
    assert spans[0].status.status_code == StatusCode.OK
    assert _finish_reasons(spans[0]) == ("incomplete",)
    assert "hi" in spans[0].attributes["gen_ai.output.messages"]

    await _wait_for_async_close(box)
    assert box["closed"]


@pytest.mark.asyncio
async def test_async_held_stream_stays_open_until_released():
    """Async twin of the held-reference resume test."""

    tracer, exporter = _tracer_and_exporter()
    wrapper = _async_wrapper(tracer, capture_message_content=True)
    box = {"closed": False}
    chunks = [_chunk("one"), _chunk("two"), _chunk("three")]

    async def fake_create(*_args, **_kwargs):
        return _async_chat_generator(chunks, box)

    response = await wrapper(fake_create, object(), [], _chat_kwargs())
    async for item in response:
        assert item == chunks[0]
        break

    assert len(exporter.get_finished_spans()) == 0
    assert box["closed"] is False
    assert await anext(response) == chunks[1]
    assert len(exporter.get_finished_spans()) == 0

    del response
    await _wait_for_async_close(box)

    assert box["closed"]
    spans = exporter.get_finished_spans()
    assert len(spans) == 1
    assert spans[0].status.status_code == StatusCode.OK
    assert _finish_reasons(spans[0]) == ("incomplete",)
    output = spans[0].attributes["gen_ai.output.messages"]
    assert "onetwo" in output
    assert "three" not in output


@pytest.mark.asyncio
async def test_async_stream_error_inside_with_marks_span_error():
    """Async twin of the generator-failure status test."""

    tracer, exporter = _tracer_and_exporter()
    wrapper = _async_wrapper(tracer, capture_message_content=True)
    box = {"closed": False}

    async def fake_create(*_args, **_kwargs):
        return _async_chat_generator(
            [_chunk("hi"), _chunk("nope")], box, raise_after=1
        )

    traced_stream = await wrapper(fake_create, object(), [], _chat_kwargs())

    with pytest.raises(RuntimeError, match="stream failed"):
        async with traced_stream as stream:
            async for _item in stream:
                pass

    assert box["closed"]
    spans = exporter.get_finished_spans()
    assert len(spans) == 1
    assert spans[0].status.status_code == StatusCode.ERROR
    assert spans[0].attributes["error.type"] == "RuntimeError"
    assert _finish_reasons(spans[0]) == ("error",)
    assert "hi" in spans[0].attributes["gen_ai.output.messages"]


@pytest.mark.asyncio
async def test_async_caller_exception_inside_with_stays_ok():
    """Async twin of the caller-abort status test."""

    tracer, exporter = _tracer_and_exporter()
    wrapper = _async_wrapper(tracer, capture_message_content=True)
    box = {"closed": False}

    async def fake_create(*_args, **_kwargs):
        return _async_chat_generator([_chunk("hi"), _chunk("more")], box)

    traced_stream = await wrapper(fake_create, object(), [], _chat_kwargs())

    with pytest.raises(ValueError, match="caller"):
        async with traced_stream as stream:
            async for _item in stream:
                raise ValueError("caller")

    assert box["closed"]
    spans = exporter.get_finished_spans()
    assert len(spans) == 1
    assert spans[0].status.status_code == StatusCode.OK
    assert _finish_reasons(spans[0]) == ("incomplete",)
    assert "hi" in spans[0].attributes["gen_ai.output.messages"]
