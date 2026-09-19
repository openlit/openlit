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

import ast
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


def _scaled_durations(tree, source):
    """Every assignment in `tree` whose value multiplies an elapsed time.

    Raised in review: matching the literal text `* 1000` catches only one
    spelling. `1000.0`, `1_000`, extra spaces and `1000 * (end - start)` are
    the same bug written differently, so walk the AST instead of the text and
    judge the shape: a multiplication where one side is a number of at least a
    thousand and the other mentions a start time.
    """

    def _is_thousandish(node):
        return isinstance(node, ast.Constant) and isinstance(
            node.value, (int, float)
        ) and node.value >= 1000

    def _mentions_start_time(node):
        return any(
            isinstance(inner, ast.Name)
            and "start_time" in inner.id
            or isinstance(inner, ast.Attribute)
            and "start_time" in inner.attr
            for inner in ast.walk(node)
        )

    offenders = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.BinOp) or not isinstance(node.op, ast.Mult):
            continue
        sides = (node.left, node.right)
        if any(_is_thousandish(side) for side in sides) and any(
            _mentions_start_time(side) for side in sides
        ):
            offenders.append(
                f"line {node.lineno}: {ast.get_source_segment(source, node)}"
            )
    return offenders


def test_no_source_scales_an_elapsed_time():
    """Pin all nine sites, so a future edit cannot quietly reintroduce one."""
    root = Path(browser_use_mod.__file__).parent.parent
    offenders = []
    for name in (
        "browser_use/browser_use.py",
        "browser_use/async_browser_use.py",
        "crawl4ai/crawl4ai.py",
        "crawl4ai/async_crawl4ai.py",
    ):
        source = (root / name).read_text(encoding="utf-8")
        offenders += [
            f"{name}:{where}"
            for where in _scaled_durations(ast.parse(source), source)
        ]
        # The name must not go on claiming milliseconds either.
        offenders += [
            f"{name}:{number}: {line.strip()}"
            for number, line in enumerate(source.splitlines(), start=1)
            if "duration_ms" in line
        ]
    assert not offenders, "duration is seconds; these scale it:\n" + "\n".join(
        offenders
    )


def test_the_guard_itself_catches_the_other_spellings():
    """The guard is only worth having if it sees more than one spelling."""
    for expression in (
        "d = (end_time - start_time) * 1000",
        "d = (end_time - start_time)*1000.0",
        "d = (end_time - start_time) * 1_000",
        "d = 1000 * (end_time - start_time)",
        "d = (end_time - self.start_time) * 1000",
    ):
        assert _scaled_durations(ast.parse(expression), expression), expression

    for innocent in (
        "d = end_time - start_time",
        "d = tokens * 1000",
        "d = (end_time - start_time) * 1",
    ):
        assert not _scaled_durations(ast.parse(innocent), innocent), innocent
