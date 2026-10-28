"""Span-lifecycle tests for the ElevenLabs text_to_speech.convert instrumentation.

``TextToSpeechClient.convert`` is a generator function and
``AsyncTextToSpeechClient.convert`` is an async generator function, so the
HTTP request only runs while the caller iterates the result. These drive the
real wrapper factories with that shape and check that the result can still be
iterated (``async for`` included), that the span stays open while the request
runs, and that a failure raised during iteration reaches the span.

Closing the stream early (GeneratorExit) records the request as OK. Anything
else that interrupts it, CancelledError and KeyboardInterrupt included, marks
the span ERROR.
"""

import asyncio
import time

import pytest
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import (
    InMemorySpanExporter,
)
from opentelemetry.trace import StatusCode

from openlit._config import OpenlitConfig
from openlit.instrumentation.elevenlabs.async_elevenlabs import async_generate
from openlit.instrumentation.elevenlabs.elevenlabs import generate
from openlit.semcov import SemanticConvention

CHUNKS = [b"AUDIO", b"BYTES"]
KWARGS = {
    "voice_id": "21m00Tcm4TlvDq8ikWAM",
    "text": "hello",
    "model_id": "eleven_multilingual_v2",
}
REQUEST_SECONDS = 0.05


class ApiError(Exception):
    """Stands in for elevenlabs.core.api_error.ApiError."""


@pytest.fixture(autouse=True)
def _reset_config():
    """The instrumentation reads OpenlitConfig attributes created at init."""
    OpenlitConfig.reset_to_defaults()
    yield
    OpenlitConfig.reset_to_defaults()


def _tracer_and_exporter():
    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    return provider.get_tracer(__name__), exporter


def _factory_args(tracer):
    return (
        "elevenlabs.text_to_speech",
        "test",
        "test",
        "test",
        tracer,
        {},
        False,
        None,
        True,
        None,
    )


def _sync_convert(exporter, box, error=None):
    """Same shape as TextToSpeechClient.convert: the request runs on iteration."""

    def convert(**_kwargs):
        try:
            time.sleep(REQUEST_SECONDS)
            box["finished_during_request"] = len(exporter.get_finished_spans())
            if error is not None:
                raise error
            yield from CHUNKS
        finally:
            box["closed"] = True

    return convert


def _async_convert(exporter, box, error=None, started=None):
    """Same shape as AsyncTextToSpeechClient.convert."""

    async def convert(**_kwargs):
        try:
            if started is not None:
                # Park in the request until the test cancels the consumer.
                started.set()
                await asyncio.sleep(60)
            await asyncio.sleep(REQUEST_SECONDS)
            box["finished_during_request"] = len(exporter.get_finished_spans())
            if error is not None:
                raise error
            for chunk in CHUNKS:
                yield chunk
        finally:
            box["closed"] = True

    return convert


def _duration(span):
    return (span.end_time - span.start_time) / 1e9


def _api_error():
    return ApiError("status_code: 401, body: invalid api key")


def _assert_error_span(exporter, error_type):
    (span,) = exporter.get_finished_spans()
    assert span.status.status_code == StatusCode.ERROR
    assert span.attributes["error.type"] == error_type
    assert [event.name for event in span.events] == ["exception"]
    # A failed request is not priced.
    assert SemanticConvention.GEN_AI_USAGE_COST not in span.attributes


def _assert_ok_span(exporter):
    (span,) = exporter.get_finished_spans()
    assert span.status.status_code == StatusCode.OK
    assert SemanticConvention.GEN_AI_USAGE_COST in span.attributes
    return span


def test_sync_span_covers_the_request():
    """The span stays open while the request runs and ends after the last chunk."""
    tracer, exporter = _tracer_and_exporter()
    box = {}
    wrapper = generate(*_factory_args(tracer))

    audio = wrapper(_sync_convert(exporter, box), None, (), dict(KWARGS))
    assert not exporter.get_finished_spans()

    assert list(audio) == CHUNKS
    assert box["finished_during_request"] == 0
    span = _assert_ok_span(exporter)
    assert _duration(span) >= REQUEST_SECONDS
    assert span.attributes["gen_ai.request.model"] == "eleven_multilingual_v2"


def test_sync_api_error_reaches_the_span():
    """An API error raised during iteration marks the span ERROR."""
    tracer, exporter = _tracer_and_exporter()
    box = {}
    wrapper = generate(*_factory_args(tracer))

    audio = wrapper(
        _sync_convert(exporter, box, error=_api_error()), None, (), dict(KWARGS)
    )
    with pytest.raises(ApiError):
        b"".join(audio)

    _assert_error_span(exporter, "ApiError")


def test_sync_base_exception_from_the_stream_marks_the_span_error():
    """A BaseException such as KeyboardInterrupt is a failure, not a success."""
    tracer, exporter = _tracer_and_exporter()
    box = {}
    wrapper = generate(*_factory_args(tracer))

    audio = wrapper(
        _sync_convert(exporter, box, error=KeyboardInterrupt()), None, (), dict(KWARGS)
    )
    with pytest.raises(KeyboardInterrupt):
        list(audio)

    _assert_error_span(exporter, "KeyboardInterrupt")


def test_sync_base_exception_thrown_in_marks_the_span_error():
    """A BaseException thrown in mid-stream closes the wrapped stream and fails."""
    tracer, exporter = _tracer_and_exporter()
    box = {}
    wrapper = generate(*_factory_args(tracer))

    audio = wrapper(_sync_convert(exporter, box), None, (), dict(KWARGS))
    assert next(audio) == CHUNKS[0]
    with pytest.raises(KeyboardInterrupt):
        audio.throw(KeyboardInterrupt())

    assert box["closed"]
    _assert_error_span(exporter, "KeyboardInterrupt")


def test_sync_early_close_records_the_request():
    """close() reaches the wrapped stream and the request is recorded as OK."""
    tracer, exporter = _tracer_and_exporter()
    box = {}
    wrapper = generate(*_factory_args(tracer))

    audio = wrapper(_sync_convert(exporter, box), None, (), dict(KWARGS))
    assert next(audio) == CHUNKS[0]
    audio.close()

    assert box["closed"]
    _assert_ok_span(exporter)


@pytest.mark.asyncio
async def test_async_convert_supports_async_for():
    """The async result works with ``async for`` and the span covers the request."""
    tracer, exporter = _tracer_and_exporter()
    box = {}
    wrapper = async_generate(*_factory_args(tracer))

    audio = wrapper(_async_convert(exporter, box), None, (), dict(KWARGS))
    chunks = [chunk async for chunk in audio]

    assert chunks == CHUNKS
    assert box["finished_during_request"] == 0
    span = _assert_ok_span(exporter)
    assert _duration(span) >= REQUEST_SECONDS


@pytest.mark.asyncio
async def test_async_api_error_reaches_the_span():
    """An API error raised during async iteration marks the span ERROR."""
    tracer, exporter = _tracer_and_exporter()
    box = {}
    wrapper = async_generate(*_factory_args(tracer))

    audio = wrapper(
        _async_convert(exporter, box, error=_api_error()), None, (), dict(KWARGS)
    )
    with pytest.raises(ApiError):
        async for _ in audio:
            pass

    _assert_error_span(exporter, "ApiError")


@pytest.mark.asyncio
async def test_async_cancelled_consumer_marks_the_span_error():
    """Cancelling the task that iterates the stream fails the span."""
    tracer, exporter = _tracer_and_exporter()
    box = {}
    started = asyncio.Event()
    wrapper = async_generate(*_factory_args(tracer))

    audio = wrapper(
        _async_convert(exporter, box, started=started), None, (), dict(KWARGS)
    )

    async def consume():
        async for _ in audio:
            pass

    task = asyncio.create_task(consume())
    await started.wait()
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task

    assert box["closed"]
    _assert_error_span(exporter, "CancelledError")


@pytest.mark.asyncio
async def test_async_cancelled_error_thrown_in_marks_the_span_error():
    """CancelledError thrown in mid-stream closes the wrapped stream and fails."""
    tracer, exporter = _tracer_and_exporter()
    box = {}
    wrapper = async_generate(*_factory_args(tracer))

    audio = wrapper(_async_convert(exporter, box), None, (), dict(KWARGS))
    assert await anext(audio) == CHUNKS[0]
    with pytest.raises(asyncio.CancelledError):
        await audio.athrow(asyncio.CancelledError())

    assert box["closed"]
    _assert_error_span(exporter, "CancelledError")


@pytest.mark.asyncio
async def test_async_early_close_records_the_request():
    """aclose() reaches the wrapped stream and the request is recorded as OK."""
    tracer, exporter = _tracer_and_exporter()
    box = {}
    wrapper = async_generate(*_factory_args(tracer))

    audio = wrapper(_async_convert(exporter, box), None, (), dict(KWARGS))
    assert await anext(audio) == CHUNKS[0]
    await audio.aclose()

    assert box["closed"]
    _assert_ok_span(exporter)
