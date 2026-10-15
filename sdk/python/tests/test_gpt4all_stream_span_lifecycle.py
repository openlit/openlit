# pylint: disable=protected-access, missing-function-docstring, no-member
# pylint: disable=too-few-public-methods
"""Span-lifecycle tests for the GPT4All streaming instrumentation.

``TracedSyncStream.__exit__`` merely forwarded to the wrapped stream, and the span
was ended only inside the ``except StopIteration`` handler. A caller that
``break``s out of ``with … as stream:`` before the stream is exhausted, or closes
it early, never reached that handler, so the span and everything on it was lost.

These drive the real wrapper factory with a synthetic GPT4All-shaped stream and
assert the span ends exactly once.
"""

import time

import pytest
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import (
    InMemorySpanExporter,
)

from openlit._config import OpenlitConfig
from openlit.instrumentation.gpt4all.gpt4all import generate
from openlit.semcov import SemanticConvention

# GPT4All streams plain strings, not chunk objects: ``process_chunk`` does
# ``scope._llmresponse += chunk``.
CHUNKS = ["Hello", " world"]


@pytest.fixture(autouse=True)
def _reset_config():
    """The instrumentation reads OpenlitConfig attributes that only exist
    once the config has been initialised."""
    OpenlitConfig.reset_to_defaults()
    yield
    OpenlitConfig.reset_to_defaults()


def _tracer_with_exporter():
    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    return provider.get_tracer(__name__), exporter


class FakeModel:
    """Stands in for ``gpt4all.GPT4All``; only ``model.model_path`` is read."""

    class _Inner:
        model_path = "/models/orca-mini-3b-gguf2-q4_0.gguf"

    model = _Inner()


class FakeStream:
    """Context-manager stream of plain strings, as GPT4All yields."""

    def __init__(self):
        self._it = iter(CHUNKS)
        self.closed = False

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def __iter__(self):
        return self

    def __next__(self):
        return next(self._it)

    def close(self):
        self.closed = True


class FailingExitStream(FakeStream):
    """Its own ``__exit__`` raises even when the ``with`` body was clean."""

    def __exit__(self, *exc):
        raise RuntimeError("wrapped exit blew up")


def _factory(tracer):
    return generate(
        version="test",
        environment="test",
        application_name="test",
        tracer=tracer,
        pricing_info={},
        capture_message_content=True,
        metrics=None,
        disable_metrics=True,
        event_provider=None,
    )


def _assert_one_span(exporter):
    spans = exporter.get_finished_spans()
    assert len(spans) == 1, "expected exactly one exported span"
    return spans[0]


def test_early_break_inside_with_ends_span():
    tracer, exporter = _tracer_with_exporter()
    wrapper = _factory(tracer)

    stream = wrapper(
        lambda *a, **k: FakeStream(),
        FakeModel(),
        (),
        {"streaming": True, "prompt": "hi"},
    )
    with stream as s:
        for _ in s:
            break

    time.sleep(0.05)
    span = _assert_one_span(exporter)
    assert SemanticConvention.GEN_AI_OPERATION in span.attributes


def test_close_finalizes_span():
    """``close()`` must end the span with no context manager around it."""
    tracer, exporter = _tracer_with_exporter()
    wrapper = _factory(tracer)

    stream = wrapper(
        lambda *a, **k: FakeStream(),
        FakeModel(),
        (),
        {"streaming": True, "prompt": "hi"},
    )
    next(stream)
    stream.close()

    time.sleep(0.05)
    _assert_one_span(exporter)


def test_full_consumption_exports_exactly_one_span():
    tracer, exporter = _tracer_with_exporter()
    wrapper = _factory(tracer)

    stream = wrapper(
        lambda *a, **k: FakeStream(),
        FakeModel(),
        (),
        {"streaming": True, "prompt": "hi"},
    )
    with stream as s:
        for _ in s:
            pass
        s.close()

    time.sleep(0.05)
    _assert_one_span(exporter)


def test_exception_from_wrapped_exit_is_recorded_on_span():
    """A clean body plus a raising wrapped ``__exit__`` must still be recorded.

    ``exc_type`` describes only the ``with`` body, so finalizing on it alone
    would export a span with no trace of the ``RuntimeError`` reaching the
    caller.
    """
    tracer, exporter = _tracer_with_exporter()
    wrapper = _factory(tracer)

    stream = wrapper(
        lambda *a, **k: FailingExitStream(),
        FakeModel(),
        (),
        {"streaming": True, "prompt": "hi"},
    )
    with pytest.raises(RuntimeError, match="wrapped exit blew up"):
        with stream as s:
            for _ in s:
                break

    time.sleep(0.05)
    span = _assert_one_span(exporter)
    assert any(event.name == "exception" for event in span.events)
    assert span.attributes.get("error.type") == "RuntimeError"
