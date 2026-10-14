# pylint: disable=protected-access, too-few-public-methods
"""Google AI Studio streaming spans must export on every generator exit.

``Models.generate_content_stream`` yields. ``AsyncModels.generate_content_stream``
returns an async generator. Neither object has ``__enter__`` / ``__aenter__``.
A bare ``for`` does not call ``close()`` on this wrapper, so a ``break``
exports only when the wrapper is released.
"""

import asyncio
import gc

import pytest
from opentelemetry import context as context_api
from opentelemetry import trace as trace_api
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import (
    InMemorySpanExporter,
)
from opentelemetry.trace import StatusCode

from openlit._config import OpenlitConfig
from openlit.instrumentation.google_ai_studio import (
    async_google_ai_studio as async_mod,
)
from openlit.instrumentation.google_ai_studio import google_ai_studio as sync_mod
from openlit.semcov import SemanticConvention

REQUEST_KWARGS = {"model": "gemini-2.0-flash"}


def _usage():
    """Shaped like google-genai usage_metadata."""
    return {
        "prompt_token_count": 10,
        "candidates_token_count": 5,
        "thoughts_token_count": 0,
        "cached_content_token_count": 0,
        "cache_creation_input_tokens": 0,
    }


class FakeChunk:
    """Shaped like a google-genai streaming chunk.

    ``process_chunk`` reads ``.text`` and ``model_dump()``.
    """

    def __init__(self, text, usage=False, finish_reason=None):
        self.text = text
        self._usage = _usage() if usage else None
        self._finish_reason = finish_reason

    def model_dump(self, *_args, **_kwargs):
        """Return the dict shape ``response_as_dict`` reads from google-genai."""
        candidates = []
        if self._finish_reason:
            candidates = [
                {
                    "finish_reason": self._finish_reason,
                    "content": {"parts": []},
                }
            ]
        return {
            "response_id": "resp-123",
            "model_version": "gemini-2.0-flash",
            "usage_metadata": self._usage,
            "candidates": candidates,
        }


def _chunk(text, usage=False, finish_reason=None):
    return FakeChunk(text, usage=usage, finish_reason=finish_reason)


def _tracer_and_exporter():
    OpenlitConfig.reset_to_defaults()
    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    return provider.get_tracer(__name__), exporter


def _factory(tracer, *, is_async, capture_message_content=False):
    mod = async_mod if is_async else sync_mod
    make = mod.async_generate_stream if is_async else mod.generate_stream
    return make(
        version="test",
        environment="test",
        application_name="test",
        tracer=tracer,
        pricing_info={},
        capture_message_content=capture_message_content,
        metrics=None,
        disable_metrics=True,
    )


def _sync_generator(chunks, box, raise_after=None):
    """Same shape as ``Models.generate_content_stream``."""

    def _generate():
        try:
            for index, chunk in enumerate(chunks):
                if raise_after is not None and index >= raise_after:
                    raise RuntimeError("stream failed")
                yield chunk
        finally:
            box["closed"] = True

    return _generate()


def _async_generator(chunks, box, raise_after=None):
    """Same shape as the async generator returned after await."""

    async def _generate():
        try:
            for index, chunk in enumerate(chunks):
                if raise_after is not None and index >= raise_after:
                    raise RuntimeError("stream failed")
                yield chunk
        finally:
            box["closed"] = True

    return _generate()


def _finish_reasons(span):
    return tuple(span.attributes[SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON])


def _assert_tokens(span):
    assert span.attributes[SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS] == 10
    assert span.attributes[SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS] == 5


async def _wait_for_async_close(box):
    """Async generator aclose() is scheduled from GC and can take two turns."""
    for _ in range(5):
        if box["closed"]:
            return
        gc.collect()
        await asyncio.sleep(0)


def test_sync_with_break_exports_partial_span():
    """An early break inside ``with`` must end the span and close the generator."""

    tracer, exporter = _tracer_and_exporter()
    wrapper = _factory(tracer, is_async=False, capture_message_content=True)
    box = {"closed": False}

    def fake_create(*_args, **_kwargs):
        return _sync_generator([_chunk("hi", usage=True), _chunk("there")], box)

    traced_stream = wrapper(fake_create, object(), (), REQUEST_KWARGS)

    with traced_stream as stream:
        for _item in stream:
            break

    assert box["closed"]
    spans = exporter.get_finished_spans()
    assert len(spans) == 1
    assert spans[0].status.status_code == StatusCode.OK
    assert _finish_reasons(spans[0]) == ("incomplete",)
    assert "hi" in spans[0].attributes[SemanticConvention.GEN_AI_OUTPUT_MESSAGES]
    assert "there" not in spans[0].attributes[SemanticConvention.GEN_AI_OUTPUT_MESSAGES]
    _assert_tokens(spans[0])


def test_sync_explicit_close_exports_span():
    """Calling ``.close()`` directly must finalize."""

    tracer, exporter = _tracer_and_exporter()
    wrapper = _factory(tracer, is_async=False, capture_message_content=True)
    box = {"closed": False}

    def fake_create(*_args, **_kwargs):
        return _sync_generator([_chunk("hi", usage=True)], box)

    traced_stream = wrapper(fake_create, object(), (), REQUEST_KWARGS)
    next(traced_stream)
    traced_stream.close()

    assert box["closed"]
    spans = exporter.get_finished_spans()
    assert len(spans) == 1
    assert spans[0].status.status_code == StatusCode.OK
    assert _finish_reasons(spans[0]) == ("incomplete",)
    _assert_tokens(spans[0])


def test_sync_full_consumption_exports_exactly_one_span():
    """StopIteration and the later close() must not export a second span.

    The terminal chunk's finish reason stays on the span. A clean drain is
    not rewritten to incomplete.
    """

    tracer, exporter = _tracer_and_exporter()
    wrapper = _factory(tracer, is_async=False, capture_message_content=True)
    box = {"closed": False}

    def fake_create(*_args, **_kwargs):
        return _sync_generator(
            [
                _chunk("partial"),
                _chunk(" answer", usage=True, finish_reason="STOP"),
            ],
            box,
        )

    traced_stream = wrapper(fake_create, object(), (), REQUEST_KWARGS)

    with traced_stream as stream:
        for _item in stream:
            pass

    assert box["closed"]
    spans = exporter.get_finished_spans()
    assert len(spans) == 1
    assert spans[0].status.status_code == StatusCode.OK
    assert _finish_reasons(spans[0]) == ("STOP",)
    output = spans[0].attributes[SemanticConvention.GEN_AI_OUTPUT_MESSAGES]
    assert "partial answer" in output
    _assert_tokens(spans[0])


def test_sync_bare_for_break_exports_span_when_wrapper_is_released():
    """A bare ``for`` plus ``break`` ends the span when the wrapper is released."""

    tracer, exporter = _tracer_and_exporter()
    wrapper = _factory(tracer, is_async=False, capture_message_content=True)
    box = {"closed": False}

    def fake_create(*_args, **_kwargs):
        return _sync_generator([_chunk("hi", usage=True), _chunk("there")], box)

    def run():
        traced_stream = wrapper(fake_create, object(), (), REQUEST_KWARGS)
        for _item in traced_stream:
            break

    run()
    gc.collect()

    assert box["closed"]
    spans = exporter.get_finished_spans()
    assert len(spans) == 1
    assert spans[0].status.status_code == StatusCode.OK
    assert _finish_reasons(spans[0]) == ("incomplete",)
    assert "hi" in spans[0].attributes[SemanticConvention.GEN_AI_OUTPUT_MESSAGES]
    assert "there" not in spans[0].attributes[SemanticConvention.GEN_AI_OUTPUT_MESSAGES]


def test_sync_held_stream_stays_open_until_released():
    """Keeping the stream object must leave it resumable until that name is dropped."""

    tracer, exporter = _tracer_and_exporter()
    wrapper = _factory(tracer, is_async=False, capture_message_content=True)
    box = {"closed": False}
    chunks = [_chunk("one", usage=True), _chunk("two"), _chunk("three")]

    def fake_create(*_args, **_kwargs):
        return _sync_generator(chunks, box)

    response = wrapper(fake_create, object(), (), REQUEST_KWARGS)
    for item in response:
        assert item.text == "one"
        break

    assert len(exporter.get_finished_spans()) == 0
    assert box["closed"] is False
    assert next(response).text == "two"

    del response
    gc.collect()

    assert box["closed"]
    spans = exporter.get_finished_spans()
    assert len(spans) == 1
    assert _finish_reasons(spans[0]) == ("incomplete",)
    output = spans[0].attributes[SemanticConvention.GEN_AI_OUTPUT_MESSAGES]
    assert "onetwo" in output
    assert "three" not in output


def test_sync_stream_error_inside_with_marks_span_error():
    """A failure from the generator is a failed span, with text already seen."""

    tracer, exporter = _tracer_and_exporter()
    wrapper = _factory(tracer, is_async=False, capture_message_content=True)
    box = {"closed": False}

    def fake_create(*_args, **_kwargs):
        return _sync_generator(
            [_chunk("hi", usage=True), _chunk("nope")], box, raise_after=1
        )

    traced_stream = wrapper(fake_create, object(), (), REQUEST_KWARGS)

    with pytest.raises(RuntimeError, match="stream failed"):
        with traced_stream as stream:
            for _item in stream:
                pass

    assert box["closed"]
    spans = exporter.get_finished_spans()
    assert len(spans) == 1
    assert spans[0].status.status_code == StatusCode.ERROR
    assert spans[0].attributes[SemanticConvention.ERROR_TYPE] == "RuntimeError"
    assert _finish_reasons(spans[0]) == ("error",)
    assert "hi" in spans[0].attributes[SemanticConvention.GEN_AI_OUTPUT_MESSAGES]
    _assert_tokens(spans[0])


def test_sync_caller_exception_inside_with_stays_ok():
    """A raise from user code is not a Gemini failure. The cancel is incomplete."""

    tracer, exporter = _tracer_and_exporter()
    wrapper = _factory(tracer, is_async=False, capture_message_content=True)
    box = {"closed": False}

    def fake_create(*_args, **_kwargs):
        return _sync_generator([_chunk("hi", usage=True), _chunk("more")], box)

    traced_stream = wrapper(fake_create, object(), (), REQUEST_KWARGS)

    with pytest.raises(ValueError, match="caller"):
        with traced_stream as stream:
            for _item in stream:
                raise ValueError("caller")

    assert box["closed"]
    spans = exporter.get_finished_spans()
    assert len(spans) == 1
    assert spans[0].status.status_code == StatusCode.OK
    assert _finish_reasons(spans[0]) == ("incomplete",)
    assert "hi" in spans[0].attributes[SemanticConvention.GEN_AI_OUTPUT_MESSAGES]


def test_sync_context_detached_after_early_break():
    """Finalizing the span must not leave it attached to the OTel context."""

    tracer, _exporter = _tracer_and_exporter()
    wrapper = _factory(tracer, is_async=False)
    box = {"closed": False}

    def fake_create(*_args, **_kwargs):
        return _sync_generator([_chunk("hi")], box)

    traced_stream = wrapper(fake_create, object(), (), REQUEST_KWARGS)
    with traced_stream as stream:
        next(stream)

    assert (
        trace_api.get_current_span(context_api.get_current()) is trace_api.INVALID_SPAN
    )


@pytest.mark.asyncio
async def test_async_with_break_exports_partial_span():
    """Async twin of the context-manager break test."""

    tracer, exporter = _tracer_and_exporter()
    wrapper = _factory(tracer, is_async=True, capture_message_content=True)
    box = {"closed": False}

    async def fake_create(*_args, **_kwargs):
        return _async_generator([_chunk("hi", usage=True), _chunk("there")], box)

    traced_stream = await wrapper(fake_create, object(), (), REQUEST_KWARGS)

    async with traced_stream as stream:
        async for _item in stream:
            break

    assert box["closed"]
    spans = exporter.get_finished_spans()
    assert len(spans) == 1
    assert spans[0].status.status_code == StatusCode.OK
    assert _finish_reasons(spans[0]) == ("incomplete",)
    assert "hi" in spans[0].attributes[SemanticConvention.GEN_AI_OUTPUT_MESSAGES]
    assert "there" not in spans[0].attributes[SemanticConvention.GEN_AI_OUTPUT_MESSAGES]
    _assert_tokens(spans[0])


@pytest.mark.asyncio
async def test_async_aclose_exports_span():
    """``aclose`` is the async generator cleanup method and must finalize the span."""

    tracer, exporter = _tracer_and_exporter()
    wrapper = _factory(tracer, is_async=True, capture_message_content=True)
    box = {"closed": False}

    async def fake_create(*_args, **_kwargs):
        return _async_generator([_chunk("hi", usage=True)], box)

    traced_stream = await wrapper(fake_create, object(), (), REQUEST_KWARGS)
    await anext(traced_stream)
    await traced_stream.aclose()

    assert box["closed"]
    spans = exporter.get_finished_spans()
    assert len(spans) == 1
    assert _finish_reasons(spans[0]) == ("incomplete",)
    _assert_tokens(spans[0])


@pytest.mark.asyncio
async def test_async_full_consumption_exports_exactly_one_span():
    """Async full drain must export one OK span and keep the model finish reason."""

    tracer, exporter = _tracer_and_exporter()
    wrapper = _factory(tracer, is_async=True, capture_message_content=True)
    box = {"closed": False}

    async def fake_create(*_args, **_kwargs):
        return _async_generator(
            [
                _chunk("partial"),
                _chunk(" answer", usage=True, finish_reason="STOP"),
            ],
            box,
        )

    traced_stream = await wrapper(fake_create, object(), (), REQUEST_KWARGS)

    async with traced_stream as stream:
        async for _item in stream:
            pass

    assert box["closed"]
    spans = exporter.get_finished_spans()
    assert len(spans) == 1
    assert spans[0].status.status_code == StatusCode.OK
    assert _finish_reasons(spans[0]) == ("STOP",)
    output = spans[0].attributes[SemanticConvention.GEN_AI_OUTPUT_MESSAGES]
    assert "partial answer" in output
    _assert_tokens(spans[0])


@pytest.mark.asyncio
async def test_async_bare_for_break_exports_span_when_wrapper_is_released():
    """A bare ``async for`` ends the span in ``__del__`` without awaiting ``aclose``."""

    tracer, exporter = _tracer_and_exporter()
    wrapper = _factory(tracer, is_async=True, capture_message_content=True)
    box = {"closed": False}

    async def fake_create(*_args, **_kwargs):
        return _async_generator([_chunk("hi", usage=True), _chunk("there")], box)

    async def run():
        traced_stream = await wrapper(fake_create, object(), (), REQUEST_KWARGS)
        async for _item in traced_stream:
            break

    await run()
    spans = exporter.get_finished_spans()
    assert len(spans) == 1
    assert _finish_reasons(spans[0]) == ("incomplete",)
    assert "hi" in spans[0].attributes[SemanticConvention.GEN_AI_OUTPUT_MESSAGES]

    await _wait_for_async_close(box)
    assert box["closed"]


@pytest.mark.asyncio
async def test_async_stream_error_inside_with_marks_span_error():
    """Async twin of the generator-failure status test."""

    tracer, exporter = _tracer_and_exporter()
    wrapper = _factory(tracer, is_async=True, capture_message_content=True)
    box = {"closed": False}

    async def fake_create(*_args, **_kwargs):
        return _async_generator(
            [_chunk("hi", usage=True), _chunk("nope")], box, raise_after=1
        )

    traced_stream = await wrapper(fake_create, object(), (), REQUEST_KWARGS)

    with pytest.raises(RuntimeError, match="stream failed"):
        async with traced_stream as stream:
            async for _item in stream:
                pass

    assert box["closed"]
    spans = exporter.get_finished_spans()
    assert len(spans) == 1
    assert spans[0].status.status_code == StatusCode.ERROR
    assert spans[0].attributes[SemanticConvention.ERROR_TYPE] == "RuntimeError"
    assert _finish_reasons(spans[0]) == ("error",)
    assert "hi" in spans[0].attributes[SemanticConvention.GEN_AI_OUTPUT_MESSAGES]


@pytest.mark.asyncio
async def test_async_caller_exception_inside_with_stays_ok():
    """Async twin of the caller-abort status test."""

    tracer, exporter = _tracer_and_exporter()
    wrapper = _factory(tracer, is_async=True, capture_message_content=True)
    box = {"closed": False}

    async def fake_create(*_args, **_kwargs):
        return _async_generator([_chunk("hi", usage=True), _chunk("more")], box)

    traced_stream = await wrapper(fake_create, object(), (), REQUEST_KWARGS)

    with pytest.raises(ValueError, match="caller"):
        async with traced_stream as stream:
            async for _item in stream:
                raise ValueError("caller")

    assert box["closed"]
    spans = exporter.get_finished_spans()
    assert len(spans) == 1
    assert spans[0].status.status_code == StatusCode.OK
    assert _finish_reasons(spans[0]) == ("incomplete",)


@pytest.mark.asyncio
async def test_async_context_detached_after_early_break():
    """Async finalization must not leave the span attached to the OTel context."""

    tracer, _exporter = _tracer_and_exporter()
    wrapper = _factory(tracer, is_async=True)
    box = {"closed": False}

    async def fake_create(*_args, **_kwargs):
        return _async_generator([_chunk("hi")], box)

    traced_stream = await wrapper(fake_create, object(), (), REQUEST_KWARGS)
    async with traced_stream as stream:
        await anext(stream)

    assert (
        trace_api.get_current_span(context_api.get_current()) is trace_api.INVALID_SPAN
    )
