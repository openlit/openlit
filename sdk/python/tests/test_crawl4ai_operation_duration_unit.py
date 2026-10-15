# pylint: disable=protected-access, missing-function-docstring, duplicate-code, too-few-public-methods
"""Runtime coverage for the synchronous Crawl4AI wrapper and the streaming path.

``test_async_operation_duration_unit.py`` drives ``async_crawl4ai.async_general_wrap``
for an awaited coroutine (async sites at ``async_crawl4ai.py`` lines 151/194), and
``test_browser_operation_duration_unit.py`` drives the four browser_use sites. Two
of the nine corrected sites are still not pinned by either file:

* ``crawl4ai/crawl4ai.py`` lines 120 (success) and 184 (error): the synchronous
  wrapper is never called, so re-applying ``* 1000`` there leaves the suite green.
* ``crawl4ai/async_crawl4ai.py`` line 318 (``_finalize_metrics``): reached only after
  the tracked async generator is fully consumed. The span is already ended at that
  point, so the seconds attribute there is dropped (tracked separately as #1618);
  the value that remains observable is openlit's internal streaming collection,
  which is intentionally kept in **milliseconds**.

The first two tests call the real synchronous wrapper with a frozen clock and assert
the recorded attribute is elapsed seconds on the normal and the error path. The last
test consumes a real async generator and pins the streaming collection at
``crawl4ai.crawl.stream.duration == 2500.0`` milliseconds, without asserting the
(absent) span attribute.
"""

import asyncio
from unittest.mock import patch

import pytest
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import (
    InMemorySpanExporter,
)

import openlit
from openlit._config import OpenlitConfig
from openlit.instrumentation.crawl4ai import async_crawl4ai as async_mod
from openlit.instrumentation.crawl4ai import crawl4ai as sync_mod
from openlit.semcov import SemanticConvention

openlit.init(
    environment="openlit-python-testing",
    application_name="openlit-python-crawl4ai-duration-test",
)

DURATION = SemanticConvention.GEN_AI_CLIENT_OPERATION_DURATION
ELAPSED_SECONDS = 2.5
STREAM_DURATION_KEY = "crawl4ai.crawl.stream.duration"


@pytest.fixture(autouse=True)
def _reset_config():
    OpenlitConfig.reset_to_defaults()
    yield
    OpenlitConfig.reset_to_defaults()


def _tracer_and_exporter():
    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    return provider.get_tracer(__name__), exporter


def _recorded_durations(exporter):
    return [
        span.attributes[DURATION]
        for span in exporter.get_finished_spans()
        if span.attributes and DURATION in span.attributes
    ]


class _Clock:
    """Advances by exactly ELAPSED_SECONDS between the first and second read."""

    def __init__(self):
        self.calls = 0

    def __call__(self):
        self.calls += 1
        return 1000.0 if self.calls == 1 else 1000.0 + ELAPSED_SECONDS


def _sync_wrap(tracer, metrics=None, disable_metrics=True):
    return sync_mod.general_wrap(
        "crawl",
        "0.0.0-test",
        "test-env",
        "test-app",
        tracer,
        pricing_info={},
        capture_message_content=False,
        metrics={} if metrics is None else metrics,
        disable_metrics=disable_metrics,
    )


def test_sync_crawl_records_seconds():
    tracer, exporter = _tracer_and_exporter()

    def _call(*_args, **_kwargs):
        return {"success": True}

    wrapped = _sync_wrap(tracer)
    with patch.object(sync_mod.time, "time", _Clock()):
        wrapped(_call, None, (), {})

    recorded = _recorded_durations(exporter)
    assert recorded, "the synchronous wrapper recorded no operation duration"
    for value in recorded:
        assert value == pytest.approx(ELAPSED_SECONDS), (
            f"duration is declared in seconds, got {value!r}"
        )


def test_sync_crawl_error_path_records_seconds():
    tracer, exporter = _tracer_and_exporter()

    def _raises(*_args, **_kwargs):
        raise RuntimeError("boom")

    wrapped = _sync_wrap(tracer)
    with patch.object(sync_mod.time, "time", _Clock()):
        with pytest.raises(RuntimeError):
            wrapped(_raises, None, (), {})

    recorded = _recorded_durations(exporter)
    assert recorded, "the synchronous error path recorded no operation duration"
    for value in recorded:
        assert value == pytest.approx(ELAPSED_SECONDS), (
            f"the error path must use the same unit, got {value!r}"
        )


async def _consume(aiterable):
    results = []
    async for item in aiterable:
        results.append(item)
    return results


def test_streaming_finalize_records_millisecond_collection_not_span_attribute():
    """Site 9: only the internal collection is observable after the span ends.

    ``_finalize_metrics`` runs from inside ``TrackedAsyncGenerator.__anext__`` when
    the consumer exhausts the generator, by which time the enclosing span context has
    already exited. We therefore assert:

    * the seconds attribute is absent from the exported (ended) span, and
    * the streaming aggregate ``crawl4ai.crawl.stream.duration`` is recorded in
      milliseconds (2.5 s elapsed -> 2500.0).
    """
    tracer, _exporter = _tracer_and_exporter()
    # The wrapper gates internal collection on a truthy ``metrics`` mapping
    # (``if not disable_metrics and metrics:``). In production openlit passes its
    # shared, already-populated metrics registry; seed an unrelated key so the gate
    # is open and the streaming aggregate is actually recorded.
    metrics: dict = {"crawl4ai.crawl.success": 0}

    async def _chunks():
        yield {"chunk": 1}
        yield {"chunk": 2}

    async def _call(*_args, **_kwargs):
        # An async coroutine that resolves to an async-iterator is the shape the
        # wrapper's streaming branch awaits (it does `response = await wrapped(...)`
        # then checks ``hasattr(response, "__aiter__")``), matching crawl4ai methods
        # that hand back a stream object rather than native async-generator functions.
        return _chunks()

    wrapped = async_mod.async_general_wrap(
        "crawl",
        "0.0.0-test",
        "test-env",
        "test-app",
        tracer,
        pricing_info={},
        capture_message_content=False,
        metrics=metrics,
        disable_metrics=False,
    )

    with patch.object(async_mod.time, "time", _Clock()):
        tracked = wrapped(_call, None, (), {})
        # wrapper returns a coroutine; awaiting it yields the tracked generator
        generator = asyncio.run(tracked)
        chunks = asyncio.run(_consume(generator))

    assert chunks == [{"chunk": 1}, {"chunk": 2}]

    assert STREAM_DURATION_KEY in metrics, (
        "exhausting the tracked generator did not finalize streaming metrics"
    )
    samples = metrics[STREAM_DURATION_KEY]
    assert samples, "the streaming duration collection is empty"
    for sample in samples:
        assert sample == pytest.approx(ELAPSED_SECONDS * 1000), (
            f"internal {STREAM_DURATION_KEY} is milliseconds by design, got {sample!r}"
        )

    # The span is closed before _finalize_metrics runs, so its set_attribute there is
    # dropped. This documents the #1618 lifecycle defect rather than asserting the
    # (unreachable) attribute.
    finished = [s for s in _exporter.get_finished_spans() if s.name.startswith("crawl")]
    assert finished, "no crawl span was exported"
    assert not any(
        s.attributes and DURATION in s.attributes for s in finished
    ), "streaming duration unexpectedly reached the ended span (#1618 unchanged)"
