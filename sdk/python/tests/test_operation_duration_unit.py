# pylint: disable=protected-access, missing-function-docstring
"""Regression tests: `gen_ai.client.operation.duration` is recorded in seconds.

The browser_use and crawl4ai instrumentations computed
`(end_time - start_time) * 1000` and set the result as
`gen_ai.client.operation.duration` at nine sites. Every other instrumentation
sets the same attribute from an unscaled duration, the histogram in
`openlit/otel/metrics.py` is created with `unit="s"` and advisory buckets that
end at 81.92, and the project's own normative table in
`agent-guides/js-sdk-genai-instrumentation.md` lists the unit as `s`.

A two-and-a-half second crawl therefore arrived as 2500, which falls past the
last bucket, so every one of these operations landed in the overflow bucket and
the latency histogram carried no usable shape for these two integrations.

These tests drive the real wrappers with a patched clock, so they measure what
the instrumentation records rather than re-deriving the arithmetic.
"""

from pathlib import Path
from unittest.mock import patch

from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import (
    InMemorySpanExporter,
)

from openlit._config import OpenlitConfig
from openlit.instrumentation.browser_use import browser_use as browser_use_mod
from openlit.instrumentation.crawl4ai import crawl4ai as crawl4ai_mod

DURATION_ATTRIBUTE = "gen_ai.client.operation.duration"
ELAPSED_SECONDS = 2.5


def _tracer_with_exporter():
    OpenlitConfig.reset_to_defaults()
    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    return provider.get_tracer(__name__), exporter


def _durations(exporter):
    return [
        span.attributes[DURATION_ATTRIBUTE]
        for span in exporter.get_finished_spans()
        if DURATION_ATTRIBUTE in span.attributes
    ]


def _run_with_clock(module, call):
    """Drive a wrapper with a clock that advances exactly ELAPSED_SECONDS."""
    ticks = iter([1000.0, 1000.0 + ELAPSED_SECONDS] + [1000.0 + ELAPSED_SECONDS] * 20)
    with patch.object(module.time, "time", lambda: next(ticks)):
        return call()


def test_crawl4ai_records_seconds():
    tracer, exporter = _tracer_with_exporter()
    wrapper = crawl4ai_mod.general_wrap(
        gen_ai_endpoint="crawl",
        version="test",
        environment="test",
        application_name="test",
        tracer=tracer,
        pricing_info={},
        capture_message_content=False,
        metrics=None,
        disable_metrics=True,
    )

    _run_with_clock(
        crawl4ai_mod, lambda: wrapper(lambda *a, **k: "crawled", object(), (), {})
    )

    recorded = _durations(exporter)
    assert recorded, "the wrapper recorded no duration at all"
    for value in recorded:
        # 2500.0 before the fix: milliseconds past the last advisory bucket.
        assert value == ELAPSED_SECONDS, (
            f"{DURATION_ATTRIBUTE} must be seconds, got {value}"
        )


def test_browser_use_records_seconds():
    tracer, exporter = _tracer_with_exporter()
    wrapper = browser_use_mod.general_wrap(
        gen_ai_endpoint="browser_use.pause",
        version="test",
        environment="test",
        application_name="test",
        tracer=tracer,
        pricing_info={},
        capture_message_content=False,
        metrics=None,
        disable_metrics=True,
    )

    _run_with_clock(
        browser_use_mod, lambda: wrapper(lambda *a, **k: "paused", object(), (), {})
    )

    recorded = _durations(exporter)
    assert recorded, "the wrapper recorded no duration at all"
    for value in recorded:
        assert value == ELAPSED_SECONDS, (
            f"{DURATION_ATTRIBUTE} must be seconds, got {value}"
        )


def test_no_source_still_multiplies_by_a_thousand():
    """Pin all nine sites, so a future edit cannot quietly reintroduce one."""
    root = Path(browser_use_mod.__file__).parent.parent
    offenders = []
    for name in (
        "browser_use/browser_use.py",
        "browser_use/async_browser_use.py",
        "crawl4ai/crawl4ai.py",
        "crawl4ai/async_crawl4ai.py",
    ):
        text = (root / name).read_text(encoding="utf-8")
        for number, line in enumerate(text.splitlines(), start=1):
            if "start_time) * 1000" in line or "duration_ms" in line:
                offenders.append(f"{name}:{number}: {line.strip()}")
    assert not offenders, "duration is seconds; these scale it:\n" + "\n".join(
        offenders
    )
