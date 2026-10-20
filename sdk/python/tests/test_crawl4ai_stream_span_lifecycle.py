# pylint: disable=protected-access, missing-function-docstring, duplicate-code
"""Span lifetime for crawl4ai's async streaming path.

A streaming crawl returns a tracked generator that the caller consumes after the
instrumented coroutine has returned. The span therefore has to stay open until the
stream is exhausted or closed; if it is scoped to the coroutine, everything the
generator records afterwards is written to an ended span and silently dropped by
the SDK.

These tests pin that contract: the streaming span must carry its telemetry, an
``async for`` that breaks must still export when the iterator is dropped (the
loop does not call ``aclose()``), a mid-stream failure must keep partial
telemetry and ERROR, cancellation must still end the span, and the
non-streaming path must keep ending its span exactly as before.
"""

import asyncio
import logging
from contextlib import contextmanager
from types import SimpleNamespace

import pytest
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import (
    InMemorySpanExporter,
)
from opentelemetry.trace import StatusCode

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


@contextmanager
def _telemetry():
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


def _page(index):
    """Minimal crawl result. Dicts have no ``url`` attribute for the wrapper to copy."""
    return SimpleNamespace(url=f"https://example.test/{index}", success=True)


def _streaming_call(items=3):
    async def call(*_args, **_kwargs):
        async def generator():
            for index in range(items):
                yield _page(index)

        return generator()

    return call


def _failing_stream(fail_at=1):
    async def call(*_args, **_kwargs):
        async def generator():
            for index in range(fail_at + 1):
                if index == fail_at:
                    raise RuntimeError("boom")
                yield _page(index)

        return generator()

    return call


def test_exhausted_stream_records_its_telemetry():
    """The span must still be open when the generator finalises."""
    with _telemetry() as (tracer, exporter, dropped):
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

        spans = exporter.get_finished_spans()
        assert _durations(exporter), "the streaming path recorded no duration at all"
        assert len(spans) == 1
        assert spans[0].status.status_code is StatusCode.OK
        assert not dropped.records, (
            f"the SDK dropped {len(dropped.records)} writes to an ended span: "
            f"{dropped.records[:3]}"
        )


def test_abandoned_stream_is_still_exported():
    """``async for`` + ``break`` does not call ``aclose()``. Dropping it must export."""
    with _telemetry() as (tracer, exporter, dropped):
        async def drive():
            result = await _invoke(tracer, _streaming_call())
            async for _ in result:
                break

        asyncio.run(drive())

        spans = exporter.get_finished_spans()
        assert spans, "the abandoned stream leaked its span"
        assert len(spans) == 1
        assert _durations(exporter), (
            "an abandoned stream exported a span with no duration recorded"
        )
        assert not dropped.records, (
            f"the SDK dropped {len(dropped.records)} writes to an ended span: "
            f"{dropped.records[:3]}"
        )


def test_explicit_aclose_exports_once():
    """A caller that closes early exports one span, and a second close is a no-op."""
    with _telemetry() as (tracer, exporter, dropped):
        async def drive():
            result = await _invoke(tracer, _streaming_call())
            page = await anext(result)
            assert page.url == "https://example.test/0"
            await result.aclose()
            await result.aclose()

        asyncio.run(drive())

        assert len(exporter.get_finished_spans()) == 1
        assert _durations(exporter)
        assert not dropped.records


def test_mid_stream_error_keeps_partial_telemetry():
    """A failure after the first page still exports that page, the duration, and ERROR."""
    with _telemetry() as (tracer, exporter, dropped):
        async def drive():
            result = await _invoke(tracer, _failing_stream())
            async for _ in result:
                pass

        with pytest.raises(RuntimeError, match="boom"):
            asyncio.run(drive())

        spans = exporter.get_finished_spans()
        assert len(spans) == 1, "the mid-stream error leaked its span or ended it twice"
        assert spans[0].status.status_code is StatusCode.ERROR
        attrs = dict(spans[0].attributes or {})
        assert DURATION in attrs, "the error path ended the span before recording duration"
        assert attrs["gen_ai.crawl.current_url"] == "https://example.test/0"
        assert attrs["gen_ai.crawl.url_count"] == 1
        assert not dropped.records


def test_cancelled_call_still_ends_its_span():
    """Cancellation is a BaseException. The span must still export, with status unset."""
    with _telemetry() as (tracer, exporter, dropped):
        async def call(*_args, **_kwargs):
            raise asyncio.CancelledError()

        with pytest.raises(asyncio.CancelledError):
            asyncio.run(_invoke(tracer, call))

        spans = exporter.get_finished_spans()
        assert len(spans) == 1, "cancelling the crawl leaked its span"
        assert spans[0].status.status_code is StatusCode.UNSET
        assert not dropped.records


def test_cancelled_iteration_exports_partial_telemetry():
    """Cancellation after a page is not a crawl failure, and the page is still exported."""
    with _telemetry() as (tracer, exporter, dropped):
        async def call(*_args, **_kwargs):
            async def generator():
                yield _page(0)
                raise asyncio.CancelledError()

            return generator()

        async def drive():
            result = await _invoke(tracer, call)
            async for _ in result:
                pass

        with pytest.raises(asyncio.CancelledError):
            asyncio.run(drive())

        spans = exporter.get_finished_spans()
        assert len(spans) == 1
        assert spans[0].status.status_code is not StatusCode.ERROR
        attrs = dict(spans[0].attributes or {})
        assert DURATION in attrs
        assert attrs["gen_ai.crawl.current_url"] == "https://example.test/0"
        assert not dropped.records


def test_non_streaming_response_still_ends_its_span():
    """The ordinary path must be unaffected."""
    with _telemetry() as (tracer, exporter, dropped):
        async def call(*_args, **_kwargs):
            return {"success": True}

        asyncio.run(_invoke(tracer, call))

        spans = exporter.get_finished_spans()
        assert len(spans) == 1
        assert spans[0].status.status_code is StatusCode.OK
        assert _durations(exporter)
        assert not dropped.records


def test_failing_call_still_ends_its_span():
    """An exception must end the span rather than leave it open."""
    with _telemetry() as (tracer, exporter, dropped):
        async def call(*_args, **_kwargs):
            raise RuntimeError("boom")

        with pytest.raises(RuntimeError):
            asyncio.run(_invoke(tracer, call))

        assert len(exporter.get_finished_spans()) == 1, "the error path leaked its span"
        assert not dropped.records
