# pylint: disable=protected-access, missing-function-docstring
"""Regression tests: the Ollama generate wrappers must end their span on
every exit path.

`TracedSyncStream.__exit__` / `TracedAsyncStream.__aexit__` only forwarded to
the wrapped stream, and the span ended solely in the `StopIteration` /
`StopAsyncIteration` handler. Leaving iteration early (a `break` before
exhaustion, or a bare `stream.close()`) left the span recording forever, so
it was never exported and its telemetry was lost — the Ollama generate instance of the
early-close streaming bug filed in #1561 and fixed for
Anthropic in #1461, AI21 in #1553, Together AI
in #1555 and Sarvam AI in #1559. These tests drive the real `chat` / `async_chat` wrapper factories
with synthetic OpenAI-shaped dict chunks, and assert the span ends exactly
once on each exit path.
"""

import time

from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import (
    InMemorySpanExporter,
)

from openlit._config import OpenlitConfig
from openlit.instrumentation.ollama import ollama as sync_mod
from openlit.instrumentation.ollama import async_ollama as async_mod

REQUEST_KWARGS = {
    "model": "llama3.1",
    "messages": [{"role": "user", "content": "hi"}],
    "stream": True,
}

CHUNKS = [
    {"response": "pa"},
    {"response": "rtial answer"},
    {"response": "", "done": True},
]


def _tracer_with_exporter():
    OpenlitConfig.reset_to_defaults()
    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    return provider.get_tracer(__name__), exporter


def _factory(tracer, *, is_async):
    mod = async_mod if is_async else sync_mod
    make = mod.async_generate if is_async else mod.generate
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
    """Sync/async event stream shaped like an OpenAI-style chunk iterator."""

    def __init__(self):
        self._it = iter(CHUNKS)
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

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    def close(self):
        """Record that the caller closed the stream without draining it."""
        self.closed = True


async def _fake_create_async(*a, **k):
    return FakeRawStream()


def test_sync_early_break_ends_span():
    """Leaving iteration after one chunk must still end the span."""
    tracer, exporter = _tracer_with_exporter()
    wrap = _factory(tracer, is_async=False)

    stream = wrap(lambda *a, **k: FakeRawStream(), None, (), REQUEST_KWARGS)
    with stream:
        next(stream)  # consume one chunk, then leave the block early

    time.sleep(0.1)
    spans = exporter.get_finished_spans()
    assert len(spans) == 1, "early exit must still end and export the span"


def test_sync_full_consumption_exports_exactly_one_span():
    """Draining the sync stream must export exactly one finished span."""
    tracer, exporter = _tracer_with_exporter()
    wrap = _factory(tracer, is_async=False)

    stream = wrap(lambda *a, **k: FakeRawStream(), None, (), REQUEST_KWARGS)
    with stream:
        for _ in stream:
            pass

    time.sleep(0.1)
    assert len(exporter.get_finished_spans()) == 1


def test_sync_close_finalizes_span():
    """Calling close() mid-iteration must finalize the span once."""
    tracer, exporter = _tracer_with_exporter()
    wrap = _factory(tracer, is_async=False)

    stream = wrap(lambda *a, **k: FakeRawStream(), None, (), REQUEST_KWARGS)
    with stream:
        next(stream)
        stream.close()

    time.sleep(0.1)
    spans = exporter.get_finished_spans()
    assert len(spans) == 1, "close() must finalize the span exactly once"


async def test_async_early_break_ends_span():
    """Leaving async iteration after one chunk must still end the span."""
    tracer, exporter = _tracer_with_exporter()
    wrap = _factory(tracer, is_async=True)

    stream = await wrap(_fake_create_async, None, (), REQUEST_KWARGS)
    async with stream:
        await anext(stream)

    time.sleep(0.1)
    spans = exporter.get_finished_spans()
    assert len(spans) == 1, "early async exit must still end and export the span"


async def test_async_full_consumption_exports_exactly_one_span():
    """Draining the async stream must export exactly one finished span."""
    tracer, exporter = _tracer_with_exporter()
    wrap = _factory(tracer, is_async=True)

    stream = await wrap(_fake_create_async, None, (), REQUEST_KWARGS)
    async with stream:
        async for _ in stream:
            pass

    time.sleep(0.1)
    assert len(exporter.get_finished_spans()) == 1
