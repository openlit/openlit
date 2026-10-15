"""Tests that an early-exited Ollama chat stream still ends and exports its span.

``Client._request(stream=True)`` returns ``inner()``, a generator around
``with httpx.stream``. The async client returns an async generator. Neither
has ``__enter__`` / ``__aenter__``. A bare ``for`` does not call ``close()``
on this wrapper.
"""

import asyncio
import gc

import pytest
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import (
    InMemorySpanExporter,
)
from opentelemetry.trace import StatusCode

from openlit._config import OpenlitConfig
from openlit.instrumentation.ollama.async_ollama import async_chat
from openlit.instrumentation.ollama.ollama import chat


def _tracer_and_exporter():
    OpenlitConfig.reset_to_defaults()
    exporter = InMemorySpanExporter()
    tracer_provider = TracerProvider()
    tracer_provider.add_span_processor(SimpleSpanProcessor(exporter))
    return tracer_provider.get_tracer("test-ollama-chat-stream-lifecycle"), exporter


def _chat_kwargs():
    return {
        "stream": True,
        "json": {
            "model": "llama3.2",
            "messages": [{"role": "user", "content": "ping"}],
        },
    }


def _chunk(text):
    return {"message": {"role": "assistant", "content": text}, "done": False}


def _stop_chunk():
    return {
        "message": {"role": "assistant", "content": ""},
        "done": True,
        "done_reason": "stop",
        "eval_count": 2,
        "prompt_eval_count": 1,
        "model": "llama3.2",
    }


def _sync_wrapper(tracer, capture_message_content=False):
    return chat(
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
    return async_chat(
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


def _sync_generator(chunks, box, raise_after=None):
    """Same shape as Ollama's ``with self._client.stream: yield``."""

    def _generate():
        with _ClosingSyncSource(chunks, box, raise_after) as raw:
            yield from raw

    return _generate()


class _ClosingAsyncSource:
    """Async twin of ``_ClosingSyncSource``."""

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


def _async_generator(chunks, box, raise_after=None):
    """Same shape as Ollama's ``async with self._client.stream: yield``."""

    async def _generate():
        async with _ClosingAsyncSource(chunks, box, raise_after) as raw:
            async for chunk in raw:
                yield chunk

    return _generate()


async def _wait_for_async_close(box):
    """Async generator aclose() is scheduled from GC and can take two turns."""
    for _ in range(5):
        if box["closed"]:
            return
        gc.collect()
        await asyncio.sleep(0)


def test_sync_stream_closed_via_context_manager_break_still_exports_span():
    """An early break inside ``with`` must end the span and close the generator."""

    tracer, exporter = _tracer_and_exporter()
    wrapper = _sync_wrapper(tracer, capture_message_content=True)
    box = {"closed": False}

    def fake_create(*_args, **_kwargs):
        return _sync_generator([_chunk("hi"), _chunk("there")], box)

    traced_stream = wrapper(fake_create, object(), [], _chat_kwargs())

    with traced_stream as stream:
        for _item in stream:
            break

    assert box["closed"]
    spans = exporter.get_finished_spans()
    assert len(spans) == 1
    assert spans[0].status.status_code == StatusCode.OK
    assert _finish_reasons(spans[0]) == ("incomplete",)
    assert "hi" in spans[0].attributes["gen_ai.output.messages"]


def test_sync_stream_explicit_close_still_exports_span():
    """Calling ``.close()`` directly must finalize."""

    tracer, exporter = _tracer_and_exporter()
    wrapper = _sync_wrapper(tracer, capture_message_content=True)
    box = {"closed": False}

    def fake_create(*_args, **_kwargs):
        return _sync_generator([_chunk("hi")], box)

    traced_stream = wrapper(fake_create, object(), [], _chat_kwargs())
    next(traced_stream)
    traced_stream.close()

    assert box["closed"]
    spans = exporter.get_finished_spans()
    assert len(spans) == 1
    assert _finish_reasons(spans[0]) == ("incomplete",)


def test_sync_stream_full_consumption_exports_exactly_one_span():
    """StopIteration inside ``with`` must not double-finalize or rewrite stop."""

    tracer, exporter = _tracer_and_exporter()
    wrapper = _sync_wrapper(tracer, capture_message_content=True)
    box = {"closed": False}

    def fake_create(*_args, **_kwargs):
        return _sync_generator([_chunk("hi"), _stop_chunk()], box)

    traced_stream = wrapper(fake_create, object(), [], _chat_kwargs())

    with traced_stream as stream:
        for _item in stream:
            pass

    assert box["closed"]
    spans = exporter.get_finished_spans()
    assert len(spans) == 1
    assert _finish_reasons(spans[0]) == ("stop",)


def test_sync_bare_for_break_exports_span_when_wrapper_is_released():
    """A bare ``for`` plus ``break`` ends the span when the wrapper is released."""

    tracer, exporter = _tracer_and_exporter()
    wrapper = _sync_wrapper(tracer, capture_message_content=True)
    box = {"closed": False}

    def fake_create(*_args, **_kwargs):
        return _sync_generator([_chunk("hi"), _chunk("there")], box)

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
    """Keeping the stream object must leave it resumable until that name is dropped."""

    tracer, exporter = _tracer_and_exporter()
    wrapper = _sync_wrapper(tracer, capture_message_content=True)
    box = {"closed": False}
    chunks = [_chunk("one"), _chunk("two"), _chunk("three")]

    def fake_create(*_args, **_kwargs):
        return _sync_generator(chunks, box)

    response = wrapper(fake_create, object(), [], _chat_kwargs())
    for item in response:
        assert item == chunks[0]
        break

    assert len(exporter.get_finished_spans()) == 0
    assert box["closed"] is False
    assert next(response) == chunks[1]

    del response
    gc.collect()

    assert box["closed"]
    spans = exporter.get_finished_spans()
    assert len(spans) == 1
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
        return _sync_generator([_chunk("hi"), _chunk("nope")], box, raise_after=1)

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
    """A raise from user code is not an Ollama failure. The cancel is incomplete."""

    tracer, exporter = _tracer_and_exporter()
    wrapper = _sync_wrapper(tracer, capture_message_content=True)
    box = {"closed": False}

    def fake_create(*_args, **_kwargs):
        return _sync_generator([_chunk("hi"), _chunk("more")], box)

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


@pytest.mark.asyncio
async def test_async_stream_explicit_aclose_still_exports_span():
    """``aclose`` is the async generator cleanup method and must finalize the span."""

    tracer, exporter = _tracer_and_exporter()
    wrapper = _async_wrapper(tracer, capture_message_content=True)
    box = {"closed": False}

    async def fake_create(*_args, **_kwargs):
        return _async_generator([_chunk("hi")], box)

    traced_stream = await wrapper(fake_create, object(), [], _chat_kwargs())
    await anext(traced_stream)
    await traced_stream.aclose()

    assert box["closed"]
    spans = exporter.get_finished_spans()
    assert len(spans) == 1
    assert _finish_reasons(spans[0]) == ("incomplete",)


@pytest.mark.asyncio
async def test_async_stream_full_consumption_exports_exactly_one_span():
    """Async full drain must export one span and keep the real stop reason."""

    tracer, exporter = _tracer_and_exporter()
    wrapper = _async_wrapper(tracer)
    box = {"closed": False}

    async def fake_create(*_args, **_kwargs):
        return _async_generator([_chunk("hi"), _stop_chunk()], box)

    traced_stream = await wrapper(fake_create, object(), [], _chat_kwargs())

    async with traced_stream as stream:
        async for _item in stream:
            pass

    assert box["closed"]
    spans = exporter.get_finished_spans()
    assert len(spans) == 1
    assert _finish_reasons(spans[0]) == ("stop",)


@pytest.mark.asyncio
async def test_async_bare_for_break_exports_span_when_wrapper_is_released():
    """A bare ``async for`` ends the span in ``__del__`` without awaiting ``aclose``."""

    tracer, exporter = _tracer_and_exporter()
    wrapper = _async_wrapper(tracer, capture_message_content=True)
    box = {"closed": False}

    async def fake_create(*_args, **_kwargs):
        return _async_generator([_chunk("hi"), _chunk("there")], box)

    async def run():
        traced_stream = await wrapper(fake_create, object(), [], _chat_kwargs())
        async for _item in traced_stream:
            break

    await run()
    spans = exporter.get_finished_spans()
    assert len(spans) == 1
    assert _finish_reasons(spans[0]) == ("incomplete",)
    assert "hi" in spans[0].attributes["gen_ai.output.messages"]

    await _wait_for_async_close(box)
    assert box["closed"]


@pytest.mark.asyncio
async def test_async_stream_error_inside_with_marks_span_error():
    """Async twin of the generator-failure status test."""

    tracer, exporter = _tracer_and_exporter()
    wrapper = _async_wrapper(tracer, capture_message_content=True)
    box = {"closed": False}

    async def fake_create(*_args, **_kwargs):
        return _async_generator([_chunk("hi"), _chunk("nope")], box, raise_after=1)

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


@pytest.mark.asyncio
async def test_async_caller_exception_inside_with_stays_ok():
    """Async twin of the caller-abort status test."""

    tracer, exporter = _tracer_and_exporter()
    wrapper = _async_wrapper(tracer, capture_message_content=True)
    box = {"closed": False}

    async def fake_create(*_args, **_kwargs):
        return _async_generator([_chunk("hi"), _chunk("more")], box)

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
