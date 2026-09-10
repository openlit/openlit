# pylint: disable=protected-access, missing-function-docstring
"""Regression tests: the Bedrock streaming wrapper must end its span on
every exit path.

`TracedSyncStream.__next__` ended the span only on `StopIteration`; leaving
the stream early (a `break` before exhaustion inside a `with` block, or a
bare `stream.close()`) left the span recording forever, so it was never
exported and its telemetry was lost. These tests drive the real
`converse_stream` wrapper factory with a fake client returning Bedrock
`converse_stream`-shaped chunk dicts, and assert the span ends exactly once
on each exit path.
"""

import time

from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import (
    InMemorySpanExporter,
)

from openlit._config import OpenlitConfig
from openlit.instrumentation.bedrock import bedrock as bedrock_mod

CHUNKS = [
    {"messageStart": {"role": "assistant"}},
    {"contentBlockDelta": {"delta": {"text": "partial answer"}}},
    {"contentBlockDelta": {"delta": {"text": " and more"}}},
    {"messageStop": {"stopReason": "end_turn"}},
    {"metadata": {"usage": {"inputTokens": 10, "outputTokens": 5}}},
]


def _tracer_with_exporter():
    OpenlitConfig.reset_to_defaults()
    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    return provider.get_tracer(__name__), exporter


def _factory(tracer):
    return bedrock_mod.converse_stream(
        version="test",
        environment="test",
        application_name="test",
        tracer=tracer,
        pricing_info={},
        capture_message_content=True,
        metrics=None,
        disable_metrics=True,
    )


class FakeStream:
    """Iterable of Bedrock chunk dicts shaped like a botocore event stream."""

    def __init__(self):
        self._it = iter(CHUNKS)
        self.closed = False

    def __iter__(self):
        return self

    def __next__(self):
        return next(self._it)

    def close(self):
        """Record that the caller closed the stream without draining it."""
        self.closed = True


class FakeClient:
    """Client shaped like a botocore bedrock-runtime client."""

    def __init__(self):
        self.stream = FakeStream()

    def converse_stream(self, **kwargs):
        return {"stream": self.stream}


def _make_stream(factory):
    fake_client_holder = {}

    def fake_create_client(*args, **kwargs):
        client = FakeClient()
        fake_client_holder["client"] = client
        return client

    client = factory(
        fake_create_client, None, (), {"service_name": "bedrock-runtime"}
    )
    stream = client.converse_stream(modelId="amazon.titan-text-express-v1")
    return stream, fake_client_holder["client"]


def test_sync_early_break_inside_with_ends_span():
    """Leaving the with-block after one chunk must still end the span."""
    tracer, exporter = _tracer_with_exporter()
    factory = _factory(tracer)

    stream, _ = _make_stream(factory)
    with stream:
        next(stream)  # consume one chunk, then leave the block early

    time.sleep(0.1)
    spans = exporter.get_finished_spans()
    assert len(spans) == 1, "early exit must still end and export the span"


def test_sync_full_consumption_exports_exactly_one_span():
    """Draining the stream must export exactly one finished span."""
    tracer, exporter = _tracer_with_exporter()
    factory = _factory(tracer)

    stream, _ = _make_stream(factory)
    with stream:
        for _ in stream:
            pass

    time.sleep(0.1)
    assert len(exporter.get_finished_spans()) == 1


def test_sync_close_finalizes_span():
    """Calling close() inside the with-block must finalize the span once."""
    tracer, exporter = _tracer_with_exporter()
    factory = _factory(tracer)

    stream, fake_client = _make_stream(factory)
    with stream:
        next(stream)
        stream.close()

    time.sleep(0.1)
    spans = exporter.get_finished_spans()
    assert len(spans) == 1, "close() must finalize the span exactly once"
    assert fake_client.stream.closed is True
