# pylint: disable=protected-access
"""Regression tests: the Anthropic streaming wrappers must end their span on
every exit path.

`TracedMessageStreamManager.__exit__` ended the span only when the `with`
block raised; leaving the block early (a `break` before `StopIteration`, or a
bare `stream.close()`) left the span recording forever, so it was never
exported and its telemetry was lost — the Anthropic instance of the early-
close streaming bug filed for OpenAI in #1454. These tests drive the real
`messages_stream`/`async_messages_stream` wrapper factories with synthetic
managers and event streams shaped like the anthropic SDK's, and assert the
span ends exactly once on each exit path.
"""

import time

from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import (
    InMemorySpanExporter,
)

from openlit._config import OpenlitConfig
from openlit.instrumentation.anthropic import anthropic as sync_mod
from openlit.instrumentation.anthropic import async_anthropic as async_mod

REQUEST_KWARGS = {"model": "claude-3-5-sonnet-latest"}

EVENTS = [
    {
        "type": "message_start",
        "message": {
            "id": "msg_01",
            "model": "claude-3-5-sonnet-latest",
            "role": "assistant",
            "usage": {"input_tokens": 10},
        },
    },
    {
        "type": "content_block_start",
        "index": 0,
        "content_block": {"type": "text", "text": ""},
    },
    {
        "type": "content_block_delta",
        "index": 0,
        "delta": {"type": "text_delta", "text": "partial answer"},
    },
    {"type": "content_block_stop", "index": 0},
    {
        "type": "message_delta",
        "delta": {"stop_reason": "end_turn"},
        "usage": {"output_tokens": 5},
    },
    {"type": "message_stop"},
]


def _tracer_with_exporter():
    OpenlitConfig.reset_to_defaults()
    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    return provider.get_tracer(__name__), exporter


def _factory(tracer, *, is_async):
    mod = async_mod if is_async else sync_mod
    make = mod.async_messages_stream if is_async else mod.messages_stream
    return make(
        version="test",
        environment="test",
        application_name="test",
        tracer=tracer,
        pricing_info={},
        capture_message_content=True,
        metrics=None,
        disable_metrics=True,
    )


class FakeRawStream:
    """Sync/async event stream shaped like anthropic's MessageStream."""

    def __init__(self):
        self._it = iter(EVENTS)
        self.closed = False

    def __iter__(self):
        return self

    def __next__(self):
        return next(self._it)

    def __aiter__(self):
        return self

    async def __anext__(self):
        try:
            return next(self._it)
        except StopIteration:
            raise StopAsyncIteration from None

    def close(self):
        """Mark the stream closed (matches anthropic's MessageStream.close)."""
        self.closed = True


class FakeManager:
    """Context manager shaped like anthropic's MessageStreamManager."""

    def __init__(self, stream):
        self._stream = stream

    def __enter__(self):
        return self._stream

    def __exit__(self, *exc):
        return False

    async def __aenter__(self):
        return self._stream

    async def __aexit__(self, *exc):
        return False


def test_sync_early_break_inside_with_ends_span():
    """Leaving the `with` block early (break) must still end and export the span."""
    tracer, exporter = _tracer_with_exporter()
    factory = _factory(tracer, is_async=False)

    manager = factory(lambda *a, **k: FakeManager(FakeRawStream()), None, (), REQUEST_KWARGS)
    with manager as stream:
        next(stream)  # consume one event, then leave the block early

    time.sleep(0.1)
    spans = exporter.get_finished_spans()
    assert len(spans) == 1, "early exit must still end and export the span"


def test_sync_full_consumption_exports_exactly_one_span():
    """Fully consuming the stream must export exactly one span."""
    tracer, exporter = _tracer_with_exporter()
    factory = _factory(tracer, is_async=False)

    manager = factory(lambda *a, **k: FakeManager(FakeRawStream()), None, (), REQUEST_KWARGS)
    with manager as stream:
        for _ in stream:
            pass

    time.sleep(0.1)
    assert len(exporter.get_finished_spans()) == 1


def test_sync_close_finalizes_span():
    """Calling close() early must finalize the span exactly once."""
    tracer, exporter = _tracer_with_exporter()
    factory = _factory(tracer, is_async=False)

    manager = factory(lambda *a, **k: FakeManager(FakeRawStream()), None, (), REQUEST_KWARGS)
    with manager as stream:
        next(stream)
        stream.close()

    time.sleep(0.1)
    spans = exporter.get_finished_spans()
    assert len(spans) == 1, "close() must finalize the span exactly once"


async def test_async_early_break_inside_with_ends_span():
    """Leaving the `async with` block early must still end and export the span."""
    tracer, exporter = _tracer_with_exporter()
    factory = _factory(tracer, is_async=True)

    manager = factory(lambda *a, **k: FakeManager(FakeRawStream()), None, (), REQUEST_KWARGS)
    async with manager as stream:
        await anext(stream)

    time.sleep(0.1)
    spans = exporter.get_finished_spans()
    assert len(spans) == 1, "early async exit must still end and export the span"


async def test_async_full_consumption_exports_exactly_one_span():
    """Fully consuming the async stream must export exactly one span."""
    tracer, exporter = _tracer_with_exporter()
    factory = _factory(tracer, is_async=True)

    manager = factory(lambda *a, **k: FakeManager(FakeRawStream()), None, (), REQUEST_KWARGS)
    async with manager as stream:
        async for _ in stream:
            pass

    time.sleep(0.1)
    assert len(exporter.get_finished_spans()) == 1
