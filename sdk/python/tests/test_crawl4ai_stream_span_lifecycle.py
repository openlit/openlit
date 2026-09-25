# pylint: disable=protected-access, missing-function-docstring, duplicate-code
"""Span lifetime for crawl4ai's async streaming path.

A streaming crawl returns a tracked generator that the caller consumes after the
instrumented coroutine has returned. The span therefore has to stay open until the
stream is exhausted or closed; if it is scoped to the coroutine, everything the
generator records afterwards is written to an ended span and silently dropped by
the SDK.

These tests pin that contract: the streaming span must carry its telemetry, an
abandoned stream must still be exported, and the non-streaming and error paths
must keep ending their span exactly as before.
"""

import asyncio
import logging

import pytest
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import (
    InMemorySpanExporter,
)

import openlit
from openlit._config import OpenlitConfig
from openlit.instrumentation.crawl4ai import async_crawl4ai as async_mod

openlit.init(
    environment="openlit-python-testing",
    application_name="openlit-python-crawl4ai-stream-test",
)

DURATION = "gen_ai.client.operation.duration"


@pytest.fixture(autouse=True)
def _reset_config():
    OpenlitConfig.reset_to_defaults()
    yield
    OpenlitConfig.reset_to_defaults()


class _DroppedWrites(logging.Handler):
    """Collects the SDK's complaints about writing to an ended span."""

    def __init__(self):
        super().__init__()
        self.records = []

    def emit(self, record):
        message = record.getMessage()
        if "ended span" in message:
            self.records.append(message)


@pytest.fixture
def telemetry():
    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    handler = _DroppedWrites()
    sdk_logger = logging.getLogger("opentelemetry.sdk.trace")
    sdk_logger.addHandler(handler)
    previous = sdk_logger.level
    sdk_logger.setLevel(logging.WARNING)
    try:
        yield provider.get_tracer(__name__), exporter, handler
    finally:
        sdk_logger.removeHandler(handler)
        sdk_logger.setLevel(previous)


def _invoke(tracer, wrapped, metrics=None, disable_metrics=True):
    return async_mod.async_general_wrap(
        "crawl",
        "0.0.0-test",
        "test-env",
        "test-app",
        tracer,
        pricing_info={},
        capture_message_content=False,
        metrics={} if metrics is None else metrics,
        disable_metrics=disable_metrics,
    )(wrapped, None, (), {})


def _durations(exporter):
    return [
        span.attributes[DURATION]
        for span in exporter.get_finished_spans()
        if span.attributes and DURATION in span.attributes
    ]


def _streaming_call(items=3):
    async def call(*_args, **_kwargs):
        async def generator():
            for index in range(items):
                yield {"url": f"https://example.test/{index}"}

        return generator()

    return call


def test_exhausted_stream_records_its_telemetry(telemetry):
    """The span must still be open when the generator finalises."""
    tracer, exporter, dropped = telemetry

    async def drive():
        result = await _invoke(tracer, _streaming_call())
        assert hasattr(result, "__aiter__"), "expected the tracked generator"
        # The span must not have been exported yet: the stream is still running.
        assert not exporter.get_finished_spans(), (
            "the span ended before the stream was consumed, so everything the "
            "generator records afterwards is dropped"
        )
        consumed = 0
        async for _ in result:
            consumed += 1
        return consumed

    assert asyncio.run(drive()) == 3

    assert _durations(exporter), "the streaming path recorded no duration at all"
    assert not dropped.records, (
        f"the SDK dropped {len(dropped.records)} writes to an ended span: "
        f"{dropped.records[:3]}"
    )


def test_abandoned_stream_is_still_exported(telemetry):
    """Breaking out early never raises StopAsyncIteration; aclose must finalise."""
    tracer, exporter, _dropped = telemetry

    async def drive():
        result = await _invoke(tracer, _streaming_call())
        async for _ in result:
            break
        await result.aclose()

    asyncio.run(drive())

    assert exporter.get_finished_spans(), "the abandoned stream leaked its span"
    assert _durations(exporter), (
        "an abandoned stream exported a span with no duration recorded"
    )


def test_non_streaming_response_still_ends_its_span(telemetry):
    """The ordinary path must be unaffected."""
    tracer, exporter, dropped = telemetry

    async def call(*_args, **_kwargs):
        return {"success": True}

    asyncio.run(_invoke(tracer, call))

    assert len(exporter.get_finished_spans()) == 1
    assert _durations(exporter)
    assert not dropped.records


def test_failing_call_still_ends_its_span(telemetry):
    """An exception must end the span rather than leave it open."""
    tracer, exporter, dropped = telemetry

    async def call(*_args, **_kwargs):
        raise RuntimeError("boom")

    with pytest.raises(RuntimeError):
        asyncio.run(_invoke(tracer, call))

    assert len(exporter.get_finished_spans()) == 1, "the error path leaked its span"
    assert not dropped.records
