# pylint: disable=missing-function-docstring
"""Span lifecycle for LiteLLM streaming.

Released ``CustomStreamWrapper`` (through 1.105.1) is a class iterator.
``async def aclose(self)`` arrived on the 1.84 line. Sync ``close(self) -> None``,
``__enter__``/``__exit__(self, *exc_info)`` and ``__aenter__``/``__aexit__`` exist
only on unreleased 1.107, where ``__exit__`` is ``self.close()`` and ``__aexit__``
is ``await self.aclose()``. A bare ``for`` / ``async for`` calls none of those.
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
from openlit.instrumentation.litellm.async_litellm import acompletion
from openlit.instrumentation.litellm.litellm import completion
from openlit.semcov import SemanticConvention

REQUEST_KWARGS = {
    "model": "gpt-4o-mini",
    "stream": True,
    "messages": [{"role": "user", "content": "hi"}],
}


def _chunk(text, finish_reason=None, usage=None):
    chunk = {
        "id": "chatcmpl-1",
        "model": "gpt-4o-mini",
        "choices": [{"delta": {"content": text}, "finish_reason": finish_reason}],
    }
    if usage is not None:
        chunk["usage"] = usage
    return chunk


CONTENT = _chunk("Hello")
STOP = _chunk(
    " world",
    finish_reason="stop",
    usage={"prompt_tokens": 5, "completion_tokens": 3, "total_tokens": 8},
)


@pytest.fixture(autouse=True)
def _reset_config():
    OpenlitConfig.reset_to_defaults()
    yield
    OpenlitConfig.reset_to_defaults()


def _tracer_with_exporter():
    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    return provider.get_tracer(__name__), exporter


class _Iter:
    """CustomStreamWrapper through 1.105.1: ``__iter__`` / ``__next__`` only."""

    def __init__(self, chunks, raise_after=None):
        self._chunks = list(chunks)
        self._raise_after = raise_after
        self._index = 0
        self.sync_closed = False

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


class _ClosingIter(_Iter):
    """1.107 sync half. ``__exit__(self, *exc_info)`` calls ``close() -> None``."""

    def __enter__(self):
        return self

    def __exit__(self, *exc_info):
        self.close()

    def close(self):
        self.sync_closed = True


class _SuppressingExit(_ClosingIter):
    def __exit__(self, *exc_info):
        self.close()
        return True


class _RaisingExit(_ClosingIter):
    def __exit__(self, *exc_info):
        raise RuntimeError("wrapped exit blew up")


class _AsyncIter:
    """1.84 through 1.105.1: ``__anext__`` and ``async def aclose(self)``."""

    def __init__(self, chunks, raise_after=None):
        self._chunks = list(chunks)
        self._raise_after = raise_after
        self._index = 0
        self.sync_closed = False
        self.async_closed = False

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

    async def aclose(self):
        self.async_closed = True


class _DevAsyncIter(_AsyncIter):
    """1.107 async half. ``__aexit__`` awaits ``aclose``; ``close`` stays sync."""

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc_info):
        await self.aclose()

    def close(self):
        self.sync_closed = True


class _SuppressingAexit(_DevAsyncIter):
    async def __aexit__(self, *exc_info):
        await self.aclose()
        return True


class _RaisingAexit(_DevAsyncIter):
    async def __aexit__(self, *exc_info):
        raise RuntimeError("wrapped aexit blew up")


class _CancellingAsync(_AsyncIter):
    async def __anext__(self):
        if self._index == 0:
            self._index += 1
            return self._chunks[0]
        raise asyncio.CancelledError()


def _asource(raw):
    """acompletion's wrapper awaits the wrapped callable."""

    async def _create(*_args, **_kwargs):
        return raw

    return _create


def _factory(tracer, *, is_async):
    maker = acompletion if is_async else completion
    return maker(
        version="test",
        environment="test",
        application_name="test",
        tracer=tracer,
        pricing_info={},
        capture_message_content=True,
        metrics=None,
        disable_metrics=True,
        event_provider=None,
    )


def _finish_reasons(span):
    return tuple(span.attributes[SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON])


def _assert_partial(span):
    assert span.status.status_code == StatusCode.OK
    assert _finish_reasons(span) == ("incomplete",)
    assert "Hello" in span.attributes[SemanticConvention.GEN_AI_OUTPUT_MESSAGES]
    assert "world" not in span.attributes[SemanticConvention.GEN_AI_OUTPUT_MESSAGES]
    assert span.attributes[SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS] == 0
    assert SemanticConvention.ERROR_TYPE not in span.attributes


def _assert_complete(span):
    assert span.status.status_code == StatusCode.OK
    assert _finish_reasons(span) == ("stop",)
    output = span.attributes[SemanticConvention.GEN_AI_OUTPUT_MESSAGES]
    assert "Hello" in output and "world" in output
    assert span.attributes[SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS] == 5
    assert span.attributes[SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS] == 3


def _assert_provider_error(span):
    assert span.status.status_code == StatusCode.ERROR
    assert span.attributes[SemanticConvention.ERROR_TYPE] == "RuntimeError"
    assert _finish_reasons(span) == ("error",)
    assert "Hello" in span.attributes[SemanticConvention.GEN_AI_OUTPUT_MESSAGES]
    assert any(event.name == "exception" for event in span.events)


def test_sync_bare_for_break_exports_when_released():
    tracer, exporter = _tracer_with_exporter()
    wrapper = _factory(tracer, is_async=False)
    raw = _Iter([CONTENT, STOP])

    def run():
        stream = wrapper(lambda *a, **k: raw, None, (), REQUEST_KWARGS)
        for _ in stream:
            break

    run()
    gc.collect()

    spans = exporter.get_finished_spans()
    assert len(spans) == 1
    _assert_partial(spans[0])
    assert raw.sync_closed is False


def test_sync_held_stream_stays_open_until_released():
    tracer, exporter = _tracer_with_exporter()
    wrapper = _factory(tracer, is_async=False)
    chunks = [CONTENT, _chunk(" there"), STOP]
    stream = wrapper(lambda *a, **k: _Iter(chunks), None, (), REQUEST_KWARGS)

    iterator = iter(stream)
    assert next(iterator)["choices"][0]["delta"]["content"] == "Hello"
    assert not exporter.get_finished_spans()
    assert next(iterator)["choices"][0]["delta"]["content"] == " there"

    del stream, iterator
    gc.collect()

    spans = exporter.get_finished_spans()
    assert len(spans) == 1
    output = spans[0].attributes[SemanticConvention.GEN_AI_OUTPUT_MESSAGES]
    assert "Hello" in output and "there" in output
    assert "world" not in output
    assert _finish_reasons(spans[0]) == ("incomplete",)


def test_sync_with_break_on_released_iterator():
    tracer, exporter = _tracer_with_exporter()
    wrapper = _factory(tracer, is_async=False)

    stream = wrapper(lambda *a, **k: _Iter([CONTENT, STOP]), None, (), REQUEST_KWARGS)
    with stream as traced:
        for _ in traced:
            break

    spans = exporter.get_finished_spans()
    assert len(spans) == 1
    _assert_partial(spans[0])


def test_sync_with_break_calls_litellm_close():
    tracer, exporter = _tracer_with_exporter()
    wrapper = _factory(tracer, is_async=False)
    raw = _ClosingIter([CONTENT, STOP])

    stream = wrapper(lambda *a, **k: raw, None, (), REQUEST_KWARGS)
    with stream as traced:
        for _ in traced:
            break

    assert raw.sync_closed is True
    spans = exporter.get_finished_spans()
    assert len(spans) == 1
    _assert_partial(spans[0])


def test_sync_close_returns_none_and_finalizes():
    tracer, exporter = _tracer_with_exporter()
    wrapper = _factory(tracer, is_async=False)
    raw = _ClosingIter([CONTENT, STOP])

    stream = wrapper(lambda *a, **k: raw, None, (), REQUEST_KWARGS)
    next(stream)
    assert stream.close() is None
    assert raw.sync_closed is True

    spans = exporter.get_finished_spans()
    assert len(spans) == 1
    _assert_partial(spans[0])


def test_sync_close_without_wrapped_close_still_finalizes():
    tracer, exporter = _tracer_with_exporter()
    wrapper = _factory(tracer, is_async=False)

    stream = wrapper(lambda *a, **k: _Iter([CONTENT, STOP]), None, (), REQUEST_KWARGS)
    next(stream)
    assert stream.close() is None

    spans = exporter.get_finished_spans()
    assert len(spans) == 1
    _assert_partial(spans[0])


def test_sync_full_consumption_exports_stop_once():
    tracer, exporter = _tracer_with_exporter()
    wrapper = _factory(tracer, is_async=False)
    raw = _ClosingIter([CONTENT, STOP])

    stream = wrapper(lambda *a, **k: raw, None, (), REQUEST_KWARGS)
    with stream as traced:
        for _ in traced:
            pass
        traced.close()

    assert raw.sync_closed is True
    spans = exporter.get_finished_spans()
    assert len(spans) == 1
    _assert_complete(spans[0])


def test_sync_provider_error_marks_span_error():
    tracer, exporter = _tracer_with_exporter()
    wrapper = _factory(tracer, is_async=False)

    stream = wrapper(
        lambda *a, **k: _Iter([CONTENT, STOP], raise_after=1),
        None,
        (),
        REQUEST_KWARGS,
    )
    with pytest.raises(RuntimeError, match="stream failed"):
        with stream as traced:
            for _ in traced:
                pass

    spans = exporter.get_finished_spans()
    assert len(spans) == 1
    _assert_provider_error(spans[0])


def test_sync_caller_exception_stays_ok():
    tracer, exporter = _tracer_with_exporter()
    wrapper = _factory(tracer, is_async=False)

    stream = wrapper(lambda *a, **k: _Iter([CONTENT, STOP]), None, (), REQUEST_KWARGS)
    with pytest.raises(ValueError, match="caller"):
        with stream as traced:
            for _ in traced:
                raise ValueError("caller")

    spans = exporter.get_finished_spans()
    assert len(spans) == 1
    _assert_partial(spans[0])


def test_sync_suppressing_exit_hides_caller_exception():
    tracer, exporter = _tracer_with_exporter()
    wrapper = _factory(tracer, is_async=False)

    stream = wrapper(
        lambda *a, **k: _SuppressingExit([CONTENT, STOP]), None, (), REQUEST_KWARGS
    )
    with stream as traced:
        for _ in traced:
            raise ValueError("caller")

    spans = exporter.get_finished_spans()
    assert len(spans) == 1
    _assert_partial(spans[0])


def test_sync_exception_from_wrapped_exit_is_error():
    tracer, exporter = _tracer_with_exporter()
    wrapper = _factory(tracer, is_async=False)

    stream = wrapper(
        lambda *a, **k: _RaisingExit([CONTENT, STOP]), None, (), REQUEST_KWARGS
    )
    with pytest.raises(RuntimeError, match="wrapped exit blew up"):
        with stream as traced:
            for _ in traced:
                break

    spans = exporter.get_finished_spans()
    assert len(spans) == 1
    _assert_provider_error(spans[0])


@pytest.mark.asyncio
async def test_async_bare_for_break_exports_when_released():
    tracer, exporter = _tracer_with_exporter()
    wrapper = _factory(tracer, is_async=True)
    raw = _AsyncIter([CONTENT, STOP])

    async def run():
        stream = await wrapper(_asource(raw), None, (), REQUEST_KWARGS)
        async for _ in stream:
            break

    await run()
    gc.collect()

    spans = exporter.get_finished_spans()
    assert len(spans) == 1
    _assert_partial(spans[0])
    assert raw.async_closed is False


@pytest.mark.asyncio
async def test_async_held_stream_stays_open_until_released():
    tracer, exporter = _tracer_with_exporter()
    wrapper = _factory(tracer, is_async=True)
    chunks = [CONTENT, _chunk(" there"), STOP]
    stream = await wrapper(_asource(_AsyncIter(chunks)), None, (), REQUEST_KWARGS)

    assert (await anext(stream))["choices"][0]["delta"]["content"] == "Hello"
    assert not exporter.get_finished_spans()
    assert (await anext(stream))["choices"][0]["delta"]["content"] == " there"

    del stream
    gc.collect()

    spans = exporter.get_finished_spans()
    assert len(spans) == 1
    output = spans[0].attributes[SemanticConvention.GEN_AI_OUTPUT_MESSAGES]
    assert "Hello" in output and "there" in output
    assert "world" not in output


@pytest.mark.asyncio
async def test_async_with_on_aclose_only_stream_calls_aclose():
    tracer, exporter = _tracer_with_exporter()
    wrapper = _factory(tracer, is_async=True)
    raw = _AsyncIter([CONTENT, STOP])

    stream = await wrapper(_asource(raw), None, (), REQUEST_KWARGS)
    async with stream as traced:
        async for _ in traced:
            break

    assert raw.async_closed is True
    assert raw.sync_closed is False
    spans = exporter.get_finished_spans()
    assert len(spans) == 1
    _assert_partial(spans[0])


@pytest.mark.asyncio
async def test_async_with_on_107_calls_aclose_not_sync_close():
    tracer, exporter = _tracer_with_exporter()
    wrapper = _factory(tracer, is_async=True)
    raw = _DevAsyncIter([CONTENT, STOP])

    stream = await wrapper(_asource(raw), None, (), REQUEST_KWARGS)
    async with stream as traced:
        async for _ in traced:
            break

    assert raw.async_closed is True
    assert raw.sync_closed is False
    spans = exporter.get_finished_spans()
    assert len(spans) == 1
    _assert_partial(spans[0])


@pytest.mark.asyncio
async def test_async_aclose_finalizes_without_context_manager():
    tracer, exporter = _tracer_with_exporter()
    wrapper = _factory(tracer, is_async=True)
    raw = _AsyncIter([CONTENT, STOP])

    stream = await wrapper(_asource(raw), None, (), REQUEST_KWARGS)
    await anext(stream)
    await stream.aclose()

    assert raw.async_closed is True
    spans = exporter.get_finished_spans()
    assert len(spans) == 1
    _assert_partial(spans[0])


@pytest.mark.asyncio
async def test_async_sync_close_is_not_a_coroutine():
    tracer, exporter = _tracer_with_exporter()
    wrapper = _factory(tracer, is_async=True)
    raw = _DevAsyncIter([CONTENT, STOP])

    stream = await wrapper(_asource(raw), None, (), REQUEST_KWARGS)
    await anext(stream)
    result = stream.close()

    assert result is None
    assert not asyncio.iscoroutine(result)
    assert raw.sync_closed is True
    assert raw.async_closed is False
    spans = exporter.get_finished_spans()
    assert len(spans) == 1
    _assert_partial(spans[0])


@pytest.mark.asyncio
async def test_async_full_consumption_exports_stop_once():
    tracer, exporter = _tracer_with_exporter()
    wrapper = _factory(tracer, is_async=True)
    raw = _DevAsyncIter([CONTENT, STOP])

    stream = await wrapper(_asource(raw), None, (), REQUEST_KWARGS)
    async with stream as traced:
        async for _ in traced:
            pass
        await traced.aclose()

    assert raw.async_closed is True
    spans = exporter.get_finished_spans()
    assert len(spans) == 1
    _assert_complete(spans[0])


@pytest.mark.asyncio
async def test_async_provider_error_marks_span_error():
    tracer, exporter = _tracer_with_exporter()
    wrapper = _factory(tracer, is_async=True)

    stream = await wrapper(
        _asource(_AsyncIter([CONTENT, STOP], raise_after=1)),
        None,
        (),
        REQUEST_KWARGS,
    )
    with pytest.raises(RuntimeError, match="stream failed"):
        async with stream as traced:
            async for _ in traced:
                pass

    spans = exporter.get_finished_spans()
    assert len(spans) == 1
    _assert_provider_error(spans[0])


@pytest.mark.asyncio
async def test_async_caller_exception_stays_ok():
    tracer, exporter = _tracer_with_exporter()
    wrapper = _factory(tracer, is_async=True)

    stream = await wrapper(
        _asource(_AsyncIter([CONTENT, STOP])), None, (), REQUEST_KWARGS
    )
    with pytest.raises(ValueError, match="caller"):
        async with stream as traced:
            async for _ in traced:
                raise ValueError("caller")

    spans = exporter.get_finished_spans()
    assert len(spans) == 1
    _assert_partial(spans[0])


@pytest.mark.asyncio
async def test_async_suppressing_aexit_hides_caller_exception():
    tracer, exporter = _tracer_with_exporter()
    wrapper = _factory(tracer, is_async=True)

    stream = await wrapper(
        _asource(_SuppressingAexit([CONTENT, STOP])), None, (), REQUEST_KWARGS
    )
    async with stream as traced:
        async for _ in traced:
            raise ValueError("caller")

    spans = exporter.get_finished_spans()
    assert len(spans) == 1
    _assert_partial(spans[0])


@pytest.mark.asyncio
async def test_async_exception_from_wrapped_aexit_is_error():
    tracer, exporter = _tracer_with_exporter()
    wrapper = _factory(tracer, is_async=True)

    stream = await wrapper(
        _asource(_RaisingAexit([CONTENT, STOP])), None, (), REQUEST_KWARGS
    )
    with pytest.raises(RuntimeError, match="wrapped aexit blew up"):
        async with stream as traced:
            async for _ in traced:
                break

    spans = exporter.get_finished_spans()
    assert len(spans) == 1
    _assert_provider_error(spans[0])


@pytest.mark.asyncio
async def test_async_cancellation_finalizes_incomplete():
    tracer, exporter = _tracer_with_exporter()
    wrapper = _factory(tracer, is_async=True)

    stream = await wrapper(
        _asource(_CancellingAsync([CONTENT, STOP])), None, (), REQUEST_KWARGS
    )
    await anext(stream)
    with pytest.raises(asyncio.CancelledError):
        await anext(stream)

    spans = exporter.get_finished_spans()
    assert len(spans) == 1
    _assert_partial(spans[0])
