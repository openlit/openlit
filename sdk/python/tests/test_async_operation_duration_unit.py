# pylint: disable=protected-access, missing-function-docstring, duplicate-code
"""Async runtime coverage for the `gen_ai.client.operation.duration` unit.

`test_operation_duration_unit.py` asserts the unit on the synchronous wrappers and
adds a static guard over the sources. Five of the nine original sites are in the
async modules, whose runtime behaviour nothing exercises: the async paths record
the attribute from three different places, and a static guard cannot tell which
`* 1000` is the semconv attribute and which is openlit's internal millisecond
bookkeeping.

These tests await the real async wrapper with a frozen clock and assert the
recorded attribute is elapsed **seconds** on both shapes:

- a normal awaited call,
- a call whose wrapped function raises.
"""

import asyncio
import time
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
from openlit.semcov import SemanticConvention

# Initialise OpenLIT the way the rest of this suite does, so class-level
# configuration such as custom_span_attributes is populated.
openlit.init(
    environment="openlit-python-testing",
    application_name="openlit-python-async-duration-test",
)

DURATION = SemanticConvention.GEN_AI_CLIENT_OPERATION_DURATION
ELAPSED_SECONDS = 2.5


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


def _recorded_durations(exporter):
    """Every value the finished spans carry for the duration attribute."""
    return [
        span.attributes[DURATION]
        for span in exporter.get_finished_spans()
        if span.attributes and DURATION in span.attributes
    ]


class _Clock:
    """A clock that advances by exactly ELAPSED_SECONDS on its second read."""

    def __init__(self):
        self.calls = 0

    def __call__(self):
        self.calls += 1
        return 1000.0 if self.calls == 1 else 1000.0 + ELAPSED_SECONDS


def _wrapped(tracer, wrapped):
    return async_mod.async_general_wrap(
        "crawl",
        "0.0.0-test",
        "test-env",
        "test-app",
        tracer,
        pricing_info={},
        capture_message_content=False,
        metrics={},
        disable_metrics=True,
    )(wrapped, None, (), {})


def test_normal_await_records_seconds():
    tracer, exporter = _tracer_with_exporter()

    async def _call(*_args, **_kwargs):
        return {"success": True}

    with patch.object(async_mod.time, "time", _Clock()):
        asyncio.run(_wrapped(tracer, _call))

    recorded = _recorded_durations(exporter)
    assert recorded, "the async wrapper recorded no duration at all"
    for value in recorded:
        # 2500.0 before the fix: milliseconds, 1000x past the seconds ladder
        # openlit declares for this histogram.
        assert value == pytest.approx(ELAPSED_SECONDS), (
            f"duration is declared in seconds, got {value!r}"
        )


def test_error_path_records_seconds():
    tracer, exporter = _tracer_with_exporter()

    async def _raises(*_args, **_kwargs):
        raise RuntimeError("boom")

    with patch.object(async_mod.time, "time", _Clock()):
        with pytest.raises(RuntimeError):
            asyncio.run(_wrapped(tracer, _raises))

    recorded = _recorded_durations(exporter)
    assert recorded, "the error path recorded no duration at all"
    for value in recorded:
        assert value == pytest.approx(ELAPSED_SECONDS), (
            f"the error path must use the same unit, got {value!r}"
        )

def test_internal_millisecond_bookkeeping_is_not_the_attribute():
    """openlit keeps an internal millisecond aggregate; that is not the attribute.

    A purely static guard cannot separate the two, because both derive from the
    same elapsed value in the same function. This pins the distinction: the
    semconv attribute is seconds while the internal list stays in milliseconds.
    """
    tracer, exporter = _tracer_with_exporter()
    metrics: dict = {}

    async def _call(*_args, **_kwargs):
        return {"success": True}

    with patch.object(async_mod.time, "time", _Clock()):
        asyncio.run(
            async_mod.async_general_wrap(
                "crawl",
                "0.0.0-test",
                "test-env",
                "test-app",
                tracer,
                pricing_info={},
                capture_message_content=False,
                metrics=metrics,
                disable_metrics=False,
            )(_call, None, (), {})
        )

    for value in _recorded_durations(exporter):
        assert value == pytest.approx(ELAPSED_SECONDS)

    for key, samples in metrics.items():
        if key.endswith("duration"):
            for sample in samples:
                assert sample == pytest.approx(ELAPSED_SECONDS * 1000), (
                    f"internal {key} is milliseconds by design, got {sample!r}"
                )
