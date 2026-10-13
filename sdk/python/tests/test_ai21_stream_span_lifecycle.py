"""Tests that an early-exited AI21 chat stream still ends and exports its span.

AI21 returns ``ai21.stream.stream.Stream`` / ``AsyncStream``. Both are context
managers whose exit calls ``close()``. Neither is a generator, and the async
class defines ``async close`` rather than ``aclose``. A bare ``for`` / ``async
for`` therefore never closes the wrapper, and ``__getattr__`` would forward
``close`` past the span.
"""

import gc

import pytest
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import (
    InMemorySpanExporter,
)
from opentelemetry.trace import StatusCode

from openlit._config import OpenlitConfig
from openlit.instrumentation.ai21 import ai21 as sync_mod
from openlit.instrumentation.ai21 import async_ai21 as async_mod


def _tracer_and_exporter():
    OpenlitConfig.reset_to_defaults()
    exporter = InMemorySpanExporter()
    tracer_provider = TracerProvider()
    tracer_provider.add_span_processor(SimpleSpanProcessor(exporter))
    return tracer_provider.get_tracer("test-ai21-stream-lifecycle"), exporter


def _chat_kwargs():
    return {
        "model": "jamba-1.5-mini",
        "messages": [{"role": "user", "content": "ping"}],
        "stream": True,
    }


def _content_chunk(text):
    return {
        "id": "chatcmpl-ai21",
        "choices": [{"delta": {"content": text}, "finish_reason": None}],
    }


def _usage_chunk():
    """Last chunk shape that ``process_chunk`` will record as finish reason stop."""
    return {
        "id": "chatcmpl-ai21",
        "choices": [{"delta": {}, "finish_reason": "stop"}],
        "usage": {"prompt_tokens": 3, "completion_tokens": 2},
    }


class FakeRawSyncStream:
    """Stand-in for ``ai21.stream.stream.Stream``.

    ``__exit__`` calls ``close()``. A bare ``for`` does not. ``raise_on_close``
    reproduces a connection error from ``close()``, which must not drop the span.
    """

    def __init__(self, chunks, raise_on_close=False, raise_after=None, on_close=None):
        self._chunks = list(chunks)
        self._index = 0
        self.closed = False
        self._raise_on_close = raise_on_close
        self._raise_after = raise_after
        self._on_close = on_close

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
        """Mark closed, matching ``Stream.close``."""
        self.closed = True
        if self._on_close is not None:
            self._on_close()
        if self._raise_on_close:
            raise RuntimeError("wrapped close failed")


class FakeRawAsyncStream:
    """Async twin of ``FakeRawSyncStream``.

    Matches ``AsyncStream``: ``async close``, no ``aclose``, and ``__aexit__``
    awaits ``close``.
    """

    def __init__(self, chunks, raise_on_close=False, raise_after=None, on_close=None):
        self._chunks = list(chunks)
        self._index = 0
        self.closed = False
        self._raise_on_close = raise_on_close
        self._raise_after = raise_after
        self._on_close = on_close

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
        """Mark closed, matching ``AsyncStream.close``."""
        self.closed = True
        if self._on_close is not None:
            self._on_close()
        if self._raise_on_close:
            raise RuntimeError("wrapped close failed")


def _sync_wrapper(tracer, capture_message_content=False):
    return sync_mod.chat(
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
    return async_mod.async_chat(
        version="test-version",
        environment="test-env",
        application_name="test-app",
        tracer=tracer,
        pricing_info={},
        capture_message_content=capture_message_content,
        metrics=None,
        disable_metrics=True,
    )


def _finish_reasons(span):
    return tuple(span.attributes["gen_ai.response.finish_reasons"])


def test_sync_stream_closed_via_context_manager_break_still_exports_span():
    """An early break inside ``with stream`` must end the span and close the socket."""

    tracer, exporter = _tracer_and_exporter()
    wrapper = _sync_wrapper(tracer, capture_message_content=True)
    raw_stream = FakeRawSyncStream([_content_chunk("hi"), _content_chunk("there")])

    def fake_create(*_args, **_kwargs):
        return raw_stream

    traced_stream = wrapper(fake_create, object(), [], _chat_kwargs())

    with traced_stream as stream:
        for _chunk in stream:
            break

    assert raw_stream.closed
    spans = exporter.get_finished_spans()
    assert len(spans) == 1
    assert spans[0].status.status_code == StatusCode.OK
    assert _finish_reasons(spans[0]) == ("incomplete",)
    output = spans[0].attributes["gen_ai.output.messages"]
    assert "hi" in output
    assert '"finish_reason": "incomplete"' in output
    assert '"finish_reason": "stop"' not in output


def test_sync_stream_explicit_close_still_exports_span():
    """Calling ``.close()`` directly, with no context manager, must finalize."""

    tracer, exporter = _tracer_and_exporter()
    wrapper = _sync_wrapper(tracer, capture_message_content=True)
    raw_stream = FakeRawSyncStream([_content_chunk("hi")])

    def fake_create(*_args, **_kwargs):
        return raw_stream

    traced_stream = wrapper(fake_create, object(), [], _chat_kwargs())
    next(traced_stream)
    traced_stream.close()

    assert raw_stream.closed
    spans = exporter.get_finished_spans()
    assert len(spans) == 1
    assert spans[0].status.status_code == StatusCode.OK
    assert _finish_reasons(spans[0]) == ("incomplete",)


def test_sync_stream_full_consumption_exports_exactly_one_span():
    """StopIteration inside ``with`` must not double-finalize or rewrite stop."""

    tracer, exporter = _tracer_and_exporter()
    wrapper = _sync_wrapper(tracer, capture_message_content=True)
    raw_stream = FakeRawSyncStream([_content_chunk("hi"), _usage_chunk()])

    def fake_create(*_args, **_kwargs):
        return raw_stream

    traced_stream = wrapper(fake_create, object(), [], _chat_kwargs())

    with traced_stream as stream:
        for _chunk in stream:
            pass

    assert raw_stream.closed
    spans = exporter.get_finished_spans()
    assert len(spans) == 1
    assert _finish_reasons(spans[0]) == ("stop",)
    assert '"finish_reason": "stop"' in spans[0].attributes["gen_ai.output.messages"]


def test_sync_stream_close_still_exports_span_when_wrapped_close_raises():
    """A failure from the wrapped ``close()`` must still export the span."""

    tracer, exporter = _tracer_and_exporter()
    wrapper = _sync_wrapper(tracer)
    raw_stream = FakeRawSyncStream([_content_chunk("hi")], raise_on_close=True)

    def fake_create(*_args, **_kwargs):
        return raw_stream

    traced_stream = wrapper(fake_create, object(), [], _chat_kwargs())
    next(traced_stream)

    with pytest.raises(RuntimeError, match="wrapped close failed"):
        traced_stream.close()

    assert raw_stream.closed
    spans = exporter.get_finished_spans()
    assert len(spans) == 1


def test_sync_bare_for_break_exports_span_when_wrapper_is_released():
    """A bare ``for`` plus ``break`` never calls ``close()``.

    The span ends when the wrapper is released. ``__del__`` must not close
    the socket: AI21 only closes it from ``Stream.close``.
    """

    tracer, exporter = _tracer_and_exporter()
    wrapper = _sync_wrapper(tracer, capture_message_content=True)
    box = {"closed": False}

    def fake_create(*_args, **_kwargs):
        return FakeRawSyncStream(
            [_content_chunk("hi"), _content_chunk("there")],
            on_close=lambda: box.__setitem__("closed", True),
        )

    def run():
        traced_stream = wrapper(fake_create, object(), [], _chat_kwargs())
        for _item in traced_stream:
            break

    run()
    gc.collect()

    assert box["closed"] is False
    spans = exporter.get_finished_spans()
    assert len(spans) == 1
    assert spans[0].status.status_code == StatusCode.OK
    assert _finish_reasons(spans[0]) == ("incomplete",)
    assert "hi" in spans[0].attributes["gen_ai.output.messages"]


def test_sync_held_stream_stays_open_until_released():
    """Keeping the stream object must leave it resumable.

    The span ends when that name is dropped, not at the ``break``. Dropping
    it still does not close the socket.
    """

    tracer, exporter = _tracer_and_exporter()
    wrapper = _sync_wrapper(tracer, capture_message_content=True)
    chunks = [_content_chunk("one"), _content_chunk("two"), _content_chunk("three")]
    raw_stream = FakeRawSyncStream(chunks)

    def fake_create(*_args, **_kwargs):
        return raw_stream

    response = wrapper(fake_create, object(), [], _chat_kwargs())
    for item in response:
        assert item == chunks[0]
        break

    assert len(exporter.get_finished_spans()) == 0
    assert raw_stream.closed is False
    assert next(response) == chunks[1]
    assert len(exporter.get_finished_spans()) == 0

    del response
    gc.collect()

    assert raw_stream.closed is False
    spans = exporter.get_finished_spans()
    assert len(spans) == 1
    assert spans[0].status.status_code == StatusCode.OK
    assert _finish_reasons(spans[0]) == ("incomplete",)
    output = spans[0].attributes["gen_ai.output.messages"]
    assert "onetwo" in output
    assert "three" not in output


def test_sync_stream_error_inside_with_marks_span_error():
    """A failure from the stream is a failed span, with text already seen."""

    tracer, exporter = _tracer_and_exporter()
    wrapper = _sync_wrapper(tracer, capture_message_content=True)
    raw_stream = FakeRawSyncStream(
        [_content_chunk("hi"), _content_chunk("nope")],
        raise_after=1,
    )

    def fake_create(*_args, **_kwargs):
        return raw_stream

    traced_stream = wrapper(fake_create, object(), [], _chat_kwargs())

    with pytest.raises(RuntimeError, match="stream failed"):
        with traced_stream as stream:
            for _item in stream:
                pass

    assert raw_stream.closed
    spans = exporter.get_finished_spans()
    assert len(spans) == 1
    assert spans[0].status.status_code == StatusCode.ERROR
    assert spans[0].attributes["error.type"] == "RuntimeError"
    assert _finish_reasons(spans[0]) == ("error",)
    assert "hi" in spans[0].attributes["gen_ai.output.messages"]


def test_sync_caller_exception_inside_with_stays_ok():
    """A raise from user code is not an AI21 failure. The cancel is incomplete."""

    tracer, exporter = _tracer_and_exporter()
    wrapper = _sync_wrapper(tracer, capture_message_content=True)
    raw_stream = FakeRawSyncStream([_content_chunk("hi"), _content_chunk("more")])

    def fake_create(*_args, **_kwargs):
        return raw_stream

    traced_stream = wrapper(fake_create, object(), [], _chat_kwargs())

    with pytest.raises(ValueError, match="caller"):
        with traced_stream as stream:
            for _item in stream:
                raise ValueError("caller")

    assert raw_stream.closed
    spans = exporter.get_finished_spans()
    assert len(spans) == 1
    assert spans[0].status.status_code == StatusCode.OK
    assert _finish_reasons(spans[0]) == ("incomplete",)
    assert "hi" in spans[0].attributes["gen_ai.output.messages"]


@pytest.mark.asyncio
async def test_async_stream_closed_via_context_manager_break_still_exports_span():
    """Async twin of the sync early-break test."""

    tracer, exporter = _tracer_and_exporter()
    wrapper = _async_wrapper(tracer, capture_message_content=True)
    raw_stream = FakeRawAsyncStream([_content_chunk("hi"), _content_chunk("there")])

    async def fake_create(*_args, **_kwargs):
        return raw_stream

    traced_stream = await wrapper(fake_create, object(), [], _chat_kwargs())

    async with traced_stream as stream:
        async for _chunk in stream:
            break

    assert raw_stream.closed
    spans = exporter.get_finished_spans()
    assert len(spans) == 1
    assert spans[0].status.status_code == StatusCode.OK
    assert _finish_reasons(spans[0]) == ("incomplete",)
    output = spans[0].attributes["gen_ai.output.messages"]
    assert "hi" in output
    assert '"finish_reason": "stop"' not in output


@pytest.mark.asyncio
async def test_async_stream_explicit_close_still_exports_span():
    """``await close()`` is AI21's async cleanup. It must finalize the span.

    ``aclose`` is not part of ``AsyncStream`` and must not appear on the wrapper.
    """

    tracer, exporter = _tracer_and_exporter()
    wrapper = _async_wrapper(tracer, capture_message_content=True)
    raw_stream = FakeRawAsyncStream([_content_chunk("hi")])

    async def fake_create(*_args, **_kwargs):
        return raw_stream

    traced_stream = await wrapper(fake_create, object(), [], _chat_kwargs())
    assert not hasattr(traced_stream, "aclose")
    await anext(traced_stream)
    await traced_stream.close()

    assert raw_stream.closed
    spans = exporter.get_finished_spans()
    assert len(spans) == 1
    assert _finish_reasons(spans[0]) == ("incomplete",)


@pytest.mark.asyncio
async def test_async_stream_full_consumption_exports_exactly_one_span():
    """Async twin of the full-consumption control test."""

    tracer, exporter = _tracer_and_exporter()
    wrapper = _async_wrapper(tracer)
    raw_stream = FakeRawAsyncStream([_content_chunk("hi"), _usage_chunk()])

    async def fake_create(*_args, **_kwargs):
        return raw_stream

    traced_stream = await wrapper(fake_create, object(), [], _chat_kwargs())

    async with traced_stream as stream:
        async for _chunk in stream:
            pass

    assert raw_stream.closed
    spans = exporter.get_finished_spans()
    assert len(spans) == 1
    assert _finish_reasons(spans[0]) == ("stop",)


@pytest.mark.asyncio
async def test_async_stream_close_still_exports_span_when_wrapped_close_raises():
    """Async twin of the wrapped-close failure test."""

    tracer, exporter = _tracer_and_exporter()
    wrapper = _async_wrapper(tracer)
    raw_stream = FakeRawAsyncStream([_content_chunk("hi")], raise_on_close=True)

    async def fake_create(*_args, **_kwargs):
        return raw_stream

    traced_stream = await wrapper(fake_create, object(), [], _chat_kwargs())
    await anext(traced_stream)

    with pytest.raises(RuntimeError, match="wrapped close failed"):
        await traced_stream.close()

    assert raw_stream.closed
    spans = exporter.get_finished_spans()
    assert len(spans) == 1


@pytest.mark.asyncio
async def test_async_bare_for_break_exports_span_when_wrapper_is_released():
    """Async twin of the bare-loop release test.

    The span ends in ``__del__`` without closing the socket and without
    waiting on an ``aclose`` the SDK does not define.
    """

    tracer, exporter = _tracer_and_exporter()
    wrapper = _async_wrapper(tracer, capture_message_content=True)
    box = {"closed": False}

    async def fake_create(*_args, **_kwargs):
        return FakeRawAsyncStream(
            [_content_chunk("hi"), _content_chunk("there")],
            on_close=lambda: box.__setitem__("closed", True),
        )

    async def run():
        traced_stream = await wrapper(fake_create, object(), [], _chat_kwargs())
        async for _item in traced_stream:
            break

    await run()
    gc.collect()

    assert box["closed"] is False
    spans = exporter.get_finished_spans()
    assert len(spans) == 1
    assert spans[0].status.status_code == StatusCode.OK
    assert _finish_reasons(spans[0]) == ("incomplete",)
    assert "hi" in spans[0].attributes["gen_ai.output.messages"]


@pytest.mark.asyncio
async def test_async_held_stream_stays_open_until_released():
    """Async twin of the held-reference resume test."""

    tracer, exporter = _tracer_and_exporter()
    wrapper = _async_wrapper(tracer, capture_message_content=True)
    chunks = [_content_chunk("one"), _content_chunk("two"), _content_chunk("three")]
    raw_stream = FakeRawAsyncStream(chunks)

    async def fake_create(*_args, **_kwargs):
        return raw_stream

    response = await wrapper(fake_create, object(), [], _chat_kwargs())
    async for item in response:
        assert item == chunks[0]
        break

    assert len(exporter.get_finished_spans()) == 0
    assert raw_stream.closed is False
    assert await anext(response) == chunks[1]
    assert len(exporter.get_finished_spans()) == 0

    del response
    gc.collect()

    assert raw_stream.closed is False
    spans = exporter.get_finished_spans()
    assert len(spans) == 1
    assert spans[0].status.status_code == StatusCode.OK
    assert _finish_reasons(spans[0]) == ("incomplete",)
    output = spans[0].attributes["gen_ai.output.messages"]
    assert "onetwo" in output
    assert "three" not in output


@pytest.mark.asyncio
async def test_async_stream_error_inside_with_marks_span_error():
    """Async twin of the stream-failure status test."""

    tracer, exporter = _tracer_and_exporter()
    wrapper = _async_wrapper(tracer, capture_message_content=True)
    raw_stream = FakeRawAsyncStream(
        [_content_chunk("hi"), _content_chunk("nope")],
        raise_after=1,
    )

    async def fake_create(*_args, **_kwargs):
        return raw_stream

    traced_stream = await wrapper(fake_create, object(), [], _chat_kwargs())

    with pytest.raises(RuntimeError, match="stream failed"):
        async with traced_stream as stream:
            async for _item in stream:
                pass

    assert raw_stream.closed
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
    raw_stream = FakeRawAsyncStream([_content_chunk("hi"), _content_chunk("more")])

    async def fake_create(*_args, **_kwargs):
        return raw_stream

    traced_stream = await wrapper(fake_create, object(), [], _chat_kwargs())

    with pytest.raises(ValueError, match="caller"):
        async with traced_stream as stream:
            async for _item in stream:
                raise ValueError("caller")

    assert raw_stream.closed
    spans = exporter.get_finished_spans()
    assert len(spans) == 1
    assert spans[0].status.status_code == StatusCode.OK
    assert _finish_reasons(spans[0]) == ("incomplete",)
    assert "hi" in spans[0].attributes["gen_ai.output.messages"]
