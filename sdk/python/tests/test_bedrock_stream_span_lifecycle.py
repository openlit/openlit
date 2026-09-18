# pylint: disable=protected-access, missing-function-docstring, not-context-manager, no-member, too-few-public-methods
"""Regression tests: the Bedrock streaming wrapper must end its span on every
exit path.

`TracedSyncStream` in the Bedrock instrumentation finalized the span only in the
`StopIteration` branch of `__next__`. `__exit__` merely forwarded to the wrapped
stream and never touched the span, and the class exposed no `close()` at all, so
`__getattr__` forwarded `close` to the boto3 response dict and raised
`AttributeError`. Any caller that stopped consuming a `converse_stream` response
before exhaustion — breaking out of the loop inside a `with ... as stream:`
block, leaving the block early, or closing the stream — left the span recording
forever, so it was never exported and its telemetry was lost.

This is the Bedrock instance of the early-close streaming bug already fixed for
Anthropic (#1461) and reported for OpenAI (#1454), Groq (#1514) and Mistral
(#1515). Reported for Bedrock in #1545.

These tests drive the real `converse_stream` wrapper factory with a synthetic
boto3-shaped client and event stream, and assert the span ends exactly once on
each exit path. The `not-context-manager`/`no-member` disables above are needed
because pylint types the fake client's return as the boto3 mapping, while at
runtime the instrumentation hands back a `TracedSyncStream`.
"""

import time

from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import (
    InMemorySpanExporter,
)

from openlit.instrumentation.bedrock.bedrock import converse_stream

REQUEST_KWARGS = {"modelId": "amazon.titan-text-express-v1"}

# converse_stream event shapes, per the Bedrock runtime API.
EVENTS = [
    {"messageStart": {"role": "assistant"}},
    {"contentBlockDelta": {"delta": {"text": "partial "}, "contentBlockIndex": 0}},
    {"contentBlockDelta": {"delta": {"text": "answer"}, "contentBlockIndex": 0}},
    {"contentBlockStop": {"contentBlockIndex": 0}},
    {"messageStop": {"stopReason": "end_turn"}},
    {
        "metadata": {
            "usage": {"inputTokens": 10, "outputTokens": 5, "totalTokens": 15},
            "metrics": {"latencyMs": 42},
        }
    },
]


def _tracer_with_exporter():
    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    return provider.get_tracer(__name__), exporter


class FakeEventStream:
    """The iterable boto3 puts under response["stream"]."""

    def __init__(self):
        self._it = iter(EVENTS)
        self.closed = False

    def __iter__(self):
        return self

    def __next__(self):
        return next(self._it)

    def close(self):
        """Record that the caller closed the stream without draining it."""
        self.closed = True


class FakeClient:
    """Minimal stand-in for a bedrock-runtime client."""

    def __init__(self):
        self.calls = []

    def converse_stream(self, **kwargs):
        """Return a boto3-shaped streaming response."""
        self.calls.append(kwargs)
        return {"stream": FakeEventStream(), "ResponseMetadata": {}}


def _instrumented_client(tracer):
    """Build a client whose converse_stream is wrapped by the real factory."""
    wrapper = converse_stream(
        version="test",
        environment="test",
        application_name="test",
        tracer=tracer,
        pricing_info={},
        capture_message_content=True,
        metrics=None,
        disable_metrics=True,
    )
    raw = FakeClient()
    return wrapper(lambda *a, **k: raw, None, (), {"service_name": "bedrock-runtime"})


def test_full_consumption_exports_exactly_one_span():
    """Draining the stream must export exactly one finished span."""
    tracer, exporter = _tracer_with_exporter()
    client = _instrumented_client(tracer)

    for _ in client.converse_stream(**REQUEST_KWARGS):
        pass

    time.sleep(0.1)
    assert len(exporter.get_finished_spans()) == 1


def test_break_inside_with_block_ends_span():
    """Breaking out of the loop inside a with-block must still end the span.

    This is the reproduction from #1545: the caller opens
    `with client.converse_stream(...) as stream:` and breaks out of
    `for chunk in stream:` before the stream is exhausted.
    """
    tracer, exporter = _tracer_with_exporter()
    client = _instrumented_client(tracer)

    with client.converse_stream(**REQUEST_KWARGS) as stream:
        for _ in stream:
            break

    time.sleep(0.1)
    spans = exporter.get_finished_spans()
    assert len(spans) == 1, "a break inside the with-block must still end the span"


def test_early_exit_from_with_block_ends_span():
    """Leaving a with-block after one event must still end the span."""
    tracer, exporter = _tracer_with_exporter()
    client = _instrumented_client(tracer)

    with client.converse_stream(**REQUEST_KWARGS) as stream:
        next(stream)

    time.sleep(0.1)
    spans = exporter.get_finished_spans()
    assert len(spans) == 1, "early with-block exit must still end the span"


def test_close_finalizes_span():
    """close() must finalize the span exactly once instead of raising."""
    tracer, exporter = _tracer_with_exporter()
    client = _instrumented_client(tracer)

    stream = client.converse_stream(**REQUEST_KWARGS)
    next(stream)
    stream.close()

    time.sleep(0.1)
    spans = exporter.get_finished_spans()
    assert len(spans) == 1, "close() must finalize the span exactly once"
