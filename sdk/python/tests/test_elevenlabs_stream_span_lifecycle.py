"""Span-lifecycle tests for the ElevenLabs text_to_speech.convert instrumentation.

``TextToSpeechClient.convert`` is a generator function and
``AsyncTextToSpeechClient.convert`` is an async generator function, so the
HTTP request only runs while the caller iterates the result. These drive the
real wrapper factories with that shape and check that the result can still be
iterated (``async for`` included), that the span stays open while the request
runs, and that a failure raised during iteration reaches the span.
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


def _sync_convert(exporter, box, fail=False):
    """Same shape as TextToSpeechClient.convert: the request runs on iteration."""

    def convert(**_kwargs):
        try:
            time.sleep(REQUEST_SECONDS)
            box["finished_during_request"] = len(exporter.get_finished_spans())
            if fail:
                raise ApiError("status_code: 401, body: invalid api key")
            yield from CHUNKS
        finally:
            box["closed"] = True

    return convert


def _async_convert(exporter, box, fail=False):
    """Same shape as AsyncTextToSpeechClient.convert."""

    async def convert(**_kwargs):
        try:
            await asyncio.sleep(REQUEST_SECONDS)
            box["finished_during_request"] = len(exporter.get_finished_spans())
            if fail:
                raise ApiError("status_code: 401, body: invalid api key")
            for chunk in CHUNKS:
                yield chunk
        finally:
            box["closed"] = True

    return convert


def _duration(span):
    return (span.end_time - span.start_time) / 1e9


def test_sync_span_covers_the_request():
    """The span stays open while the request runs and ends after the last chunk."""
    tracer, exporter = _tracer_and_exporter()
    box = {}
    wrapper = generate(*_factory_args(tracer))

    audio = wrapper(_sync_convert(exporter, box), None, (), dict(KWARGS))
    assert not exporter.get_finished_spans()

    assert list(audio) == CHUNKS
    assert box["finished_during_request"] == 0
    (span,) = exporter.get_finished_spans()
    assert span.status.status_code == StatusCode.OK
    assert _duration(span) >= REQUEST_SECONDS
    assert span.attributes["gen_ai.request.model"] == "eleven_multilingual_v2"


def test_sync_api_error_reaches_the_span():
    """An API error raised during iteration marks the span ERROR."""
    tracer, exporter = _tracer_and_exporter()
    box = {}
    wrapper = generate(*_factory_args(tracer))

    audio = wrapper(_sync_convert(exporter, box, fail=True), None, (), dict(KWARGS))
    with pytest.raises(ApiError):
        b"".join(audio)

    (span,) = exporter.get_finished_spans()
    assert span.status.status_code == StatusCode.ERROR
    assert span.attributes["error.type"] == "ApiError"
    assert [event.name for event in span.events] == ["exception"]


def test_sync_early_close_ends_the_span():
    """close() reaches the wrapped stream and ends the span, without an error."""
    tracer, exporter = _tracer_and_exporter()
    box = {}
    wrapper = generate(*_factory_args(tracer))

    audio = wrapper(_sync_convert(exporter, box), None, (), dict(KWARGS))
    assert next(audio) == CHUNKS[0]
    audio.close()

    assert box["closed"]
    (span,) = exporter.get_finished_spans()
    assert span.status.status_code != StatusCode.ERROR


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
    (span,) = exporter.get_finished_spans()
    assert span.status.status_code == StatusCode.OK
    assert _duration(span) >= REQUEST_SECONDS


@pytest.mark.asyncio
async def test_async_api_error_reaches_the_span():
    """An API error raised during async iteration marks the span ERROR."""
    tracer, exporter = _tracer_and_exporter()
    box = {}
    wrapper = async_generate(*_factory_args(tracer))

    audio = wrapper(_async_convert(exporter, box, fail=True), None, (), dict(KWARGS))
    with pytest.raises(ApiError):
        async for _ in audio:
            pass

    (span,) = exporter.get_finished_spans()
    assert span.status.status_code == StatusCode.ERROR
    assert span.attributes["error.type"] == "ApiError"


@pytest.mark.asyncio
async def test_async_early_close_ends_the_span():
    """aclose() reaches the wrapped stream and ends the span, without an error."""
    tracer, exporter = _tracer_and_exporter()
    box = {}
    wrapper = async_generate(*_factory_args(tracer))

    audio = wrapper(_async_convert(exporter, box), None, (), dict(KWARGS))
    assert await anext(audio) == CHUNKS[0]
    await audio.aclose()

    assert box["closed"]
    (span,) = exporter.get_finished_spans()
    assert span.status.status_code != StatusCode.ERROR
