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


def _is_scaled(node):
    """A multiplication by a thousand or more, on either side."""
    if not isinstance(node, ast.BinOp) or not isinstance(node.op, ast.Mult):
        return False
    return any(
        isinstance(side, ast.Constant)
        and isinstance(side.value, (int, float))
        and side.value >= 1000
        for side in (node.left, node.right)
    )


def _is_duration_attribute(node):
    """The attribute is named two ways in this tree: through the semantic
    convention constant, and as a bare string in the crawl4ai wrappers. A guard
    that knows only the constant leaves the string sites unwatched."""
    if isinstance(node, ast.Attribute):
        return node.attr == "GEN_AI_CLIENT_OPERATION_DURATION"
    return isinstance(node, ast.Constant) and node.value == DURATION_ATTRIBUTE


def _scaled_duration_sites(tree, source):
    """Every place the duration attribute is handed a scaled value.

    Raised in review: an earlier guard read assignments only, so scaling at the
    call itself slipped past it, and a blanket `duration_ms` text match also
    failed a sibling change that keeps that name for an internal collection
    while still reporting the attribute in seconds. Follow the value that
    reaches the attribute instead of judging every multiplication in the file.
    """
    scaled_names = {}
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign) and _is_scaled(node.value):
            for target in node.targets:
                if isinstance(target, ast.Name):
                    scaled_names[target.id] = (
                        f"line {node.lineno}: {ast.get_source_segment(source, node)}"
                    )

    offenders = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        if not (
            isinstance(node.func, ast.Attribute) and node.func.attr == "set_attribute"
        ):
            continue
        if len(node.args) < 2 or not _is_duration_attribute(node.args[0]):
            continue
        value = node.args[1]
        if _is_scaled(value):
            offenders.append(
                f"line {node.lineno}: {ast.get_source_segment(source, node)}"
            )
        elif isinstance(value, ast.Name) and value.id in scaled_names:
            offenders.append(
                f"line {node.lineno}: attribute takes {value.id}, "
                f"assigned at {scaled_names[value.id]}"
            )
    return offenders


def test_no_site_hands_the_duration_attribute_a_scaled_value():
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
            for where in _scaled_duration_sites(ast.parse(source), source)
        ]
    assert not offenders, "duration is seconds; these scale it:\n" + "\n".join(
        offenders
    )


SET_DURATION = (
    "span.set_attribute("
    "SemanticConvention.GEN_AI_CLIENT_OPERATION_DURATION, {value})"
)


def test_the_guard_catches_scaling_at_the_call_and_at_the_assignment():
    """Both spellings reach the attribute, so the guard must see both."""
    at_the_call = [
        SET_DURATION.format(value="d * 1000"),
        SET_DURATION.format(value="d * 1000.0"),
        SET_DURATION.format(value="1_000 * d"),
    ]
    through_a_name = [
        "d = (end_time - start_time) * 1000\n" + SET_DURATION.format(value="d"),
        "d = 1000 * (end_time - self.start_time)\n" + SET_DURATION.format(value="d"),
    ]
    for snippet in at_the_call + through_a_name:
        assert _scaled_duration_sites(ast.parse(snippet), snippet), snippet


def test_the_guard_leaves_an_internal_millisecond_name_alone():
    """A sibling change keeps `duration_ms` for its own collection while still
    reporting the attribute in seconds. That is a naming choice, not this bug,
    so the guard must judge what reaches the attribute and nothing else."""
    snippet = (
        "d = end_time - start_time\n"
        "duration_ms = d * 1000\n"
        + SET_DURATION.format(value="d")
        + "\ncollect(duration_ms)"
    )
    assert not _scaled_duration_sites(ast.parse(snippet), snippet)

    for innocent in (
        "d = end_time - start_time\n" + SET_DURATION.format(value="d"),
        "d = tokens * 1000\n" + SET_DURATION.format(value="end_time - start_time"),
    ):
        assert not _scaled_duration_sites(ast.parse(innocent), innocent), innocent
