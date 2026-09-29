# pylint: disable=protected-access, missing-function-docstring, duplicate-code, too-few-public-methods
"""Runtime coverage for the synchronous and asynchronous Browser-Use wrappers.

`test_async_operation_duration_unit.py` only drives
`crawl4ai.async_crawl4ai.async_general_wrap`. A revert experiment shows the two
`browser_use` modules (four of the nine corrected sites) are not pinned:
re-applying the `* 1000` factor in `browser_use.py` or
`async_browser_use.py` leaves that suite green. These tests await/call the real
Browser-Use wrappers with a frozen clock and assert the recorded
`gen_ai.client.operation.duration` is elapsed **seconds** on the normal and the
error path of each wrapper.
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
from openlit.instrumentation.browser_use import (
    async_browser_use as async_mod,
)
from openlit.instrumentation.browser_use import browser_use as sync_mod
from openlit.semcov import SemanticConvention

openlit.init(
    environment="openlit-python-testing",
    application_name="openlit-python-browser-duration-test",
)

DURATION = SemanticConvention.GEN_AI_CLIENT_OPERATION_DURATION
ELAPSED_SECONDS = 2.5


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


def _assert_seconds(recorded):
    assert recorded, "the wrapper recorded no operation duration"
    for value in recorded:
        assert value == pytest.approx(ELAPSED_SECONDS), (
            f"duration is declared in seconds, got {value!r}"
        )


def test_sync_records_seconds():
    tracer, exporter = _tracer_and_exporter()

    def _call(*_args, **_kwargs):
        return {"success": True}

    wrapped = sync_mod.general_wrap(
        "navigate",
        "0.0.0-test",
        "test-env",
        "test-app",
        tracer,
        pricing_info={},
        capture_message_content=False,
        metrics={},
        disable_metrics=True,
    )

    with patch.object(sync_mod.time, "time", _Clock()):
        wrapped(_call, None, (), {})

    _assert_seconds(_recorded_durations(exporter))


def test_sync_error_path_records_seconds():
    tracer, exporter = _tracer_and_exporter()

    def _raises(*_args, **_kwargs):
        raise RuntimeError("boom")

    wrapped = sync_mod.general_wrap(
        "navigate",
        "0.0.0-test",
        "test-env",
        "test-app",
        tracer,
        pricing_info={},
        capture_message_content=False,
        metrics={},
        disable_metrics=True,
    )

    with patch.object(sync_mod.time, "time", _Clock()):
        with pytest.raises(RuntimeError):
            wrapped(_raises, None, (), {})

    _assert_seconds(_recorded_durations(exporter))


def test_async_browser_records_seconds():
    tracer, exporter = _tracer_and_exporter()

    async def _call(*_args, **_kwargs):
        return {"success": True}

    wrapped = async_mod.async_general_wrap(
        "navigate",
        "0.0.0-test",
        "test-env",
        "test-app",
        tracer,
        pricing_info={},
        capture_message_content=False,
        metrics={},
        disable_metrics=True,
    )

    with patch.object(async_mod.time, "time", _Clock()):
        asyncio.run(wrapped(_call, None, (), {}))

    _assert_seconds(_recorded_durations(exporter))


def test_async_browser_error_path_records_seconds():
    tracer, exporter = _tracer_and_exporter()

    async def _raises(*_args, **_kwargs):
        raise RuntimeError("boom")

    wrapped = async_mod.async_general_wrap(
        "navigate",
        "0.0.0-test",
        "test-env",
        "test-app",
        tracer,
        pricing_info={},
        capture_message_content=False,
        metrics={},
        disable_metrics=True,
    )

    with patch.object(async_mod.time, "time", _Clock()):
        with pytest.raises(RuntimeError):
            asyncio.run(wrapped(_raises, None, (), {}))

    _assert_seconds(_recorded_durations(exporter))
