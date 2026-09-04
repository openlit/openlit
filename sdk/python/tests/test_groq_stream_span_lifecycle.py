# pylint: disable=protected-access, duplicate-code, missing-function-docstring
"""Regression tests: the Groq streaming wrappers must end their span on every
exit path.

`TracedSyncStream.__exit__`/`TracedAsyncStream.__aexit__` merely forwarded to
the wrapped stream and there was no `close()`/`aclose()`, so the span was
ended only inside the `except StopIteration`/`StopAsyncIteration` handler.
A caller that `break`s out of `with … as stream:` before the stream is
exhausted, or calls `stream.close()` early, never hit that handler, so the
span stayed recording forever and was never exported — the whole call
(span, cost, tokens) was lost. This is the Groq instance of the early-close
streaming-span leak fixed for Anthropic in #1461 and filed for OpenAI in
#1454/#1455.

These tests drive the real `chat`/`async_chat` wrapper factories with a
synthetic Groq-shaped stream and assert the span ends exactly once, carrying
token-usage attributes, on each exit path.
"""

import time

import pytest
from opentelemetry import trace as trace_api, context as context_api
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import (
    InMemorySpanExporter,
)

from openlit._config import OpenlitConfig
from openlit.instrumentation.groq import groq as sync_mod
from openlit.instrumentation.groq import async_groq as async_mod
from openlit.semcov import SemanticConvention

REQUEST_KWARGS = {
    "model": "llama-3.1-8b-instant",
    "stream": True,
    "messages": [{"role": "user", "content": "Monitor LLM Applications"}],
}

# Two Groq-shaped chunks: a content delta, then a final chunk carrying usage.
CHUNKS = [
    {"choices": [{"delta": {"content": "partial"}, "finish_reason": None}]},
    {
        "choices": [{"delta": {"content": " answer"}, "finish_reason": "stop"}],
        "x_groq": {
            "id": "chatcmpl-1",
            "model": "llama-3.1-8b-instant",
            "system_fingerprint": "fp_test",
            "usage": {"prompt_tokens": 10, "completion_tokens": 5},
        },
    },
]


def _tracer_with_exporter():
    OpenlitConfig.reset_to_defaults()
    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    return provider.get_tracer(__name__), exporter


def _factory(tracer, *, is_async):
    mod = async_mod if is_async else sync_mod
    make = mod.async_chat if is_async else mod.chat
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


class FakeSyncStream:
    """Sync context-manager stream shaped like groq's Stream."""

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


class FakeAsyncStream:
    """Async context-manager stream shaped like groq's AsyncStream."""

    def __init__(self):
        self._it = iter(CHUNKS)
        self.closed = False

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    def __aiter__(self):
        return self

    async def __anext__(self):
        try:
            return next(self._it)
        except StopIteration:
            raise StopAsyncIteration from None

    async def aclose(self):
        self.closed = True


async def _acreate(*_a, **_k):
    """Async stand-in for groq's AsyncCompletions.create (awaitable)."""
    return FakeAsyncStream()


def _assert_one_span_with_tokens(exporter):
    spans = exporter.get_finished_spans()
    assert len(spans) == 1, "expected exactly one exported span"
    attrs = spans[0].attributes
    assert SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS in attrs
    assert SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS in attrs


def test_sync_early_break_inside_with_ends_span():
    tracer, exporter = _tracer_with_exporter()
    wrapper = _factory(tracer, is_async=False)

    stream = wrapper(lambda *a, **k: FakeSyncStream(), None, (), REQUEST_KWARGS)
    with stream as s:
        next(s)  # consume one chunk, then leave the block early

    time.sleep(0.05)
    _assert_one_span_with_tokens(exporter)


def test_sync_close_finalizes_span():
    tracer, exporter = _tracer_with_exporter()
    wrapper = _factory(tracer, is_async=False)

    stream = wrapper(lambda *a, **k: FakeSyncStream(), None, (), REQUEST_KWARGS)
    with stream as s:
        next(s)
        s.close()

    time.sleep(0.05)
    _assert_one_span_with_tokens(exporter)


def test_sync_full_consumption_exports_exactly_one_span():
    tracer, exporter = _tracer_with_exporter()
    wrapper = _factory(tracer, is_async=False)

    stream = wrapper(lambda *a, **k: FakeSyncStream(), None, (), REQUEST_KWARGS)
    with stream as s:
        for _ in s:
            pass

    time.sleep(0.05)
    _assert_one_span_with_tokens(exporter)


def test_sync_context_detached_after_early_break():
    """The stream must not leave its span attached to the OTel context."""
    tracer, _ = _tracer_with_exporter()
    wrapper = _factory(tracer, is_async=False)

    stream = wrapper(lambda *a, **k: FakeSyncStream(), None, (), REQUEST_KWARGS)
    with stream as s:
        next(s)

    assert trace_api.get_current_span(context_api.get_current()) is trace_api.INVALID_SPAN


@pytest.mark.asyncio
async def test_async_early_break_inside_with_ends_span():
    tracer, exporter = _tracer_with_exporter()
    wrapper = _factory(tracer, is_async=True)

    stream = await wrapper(_acreate, None, (), REQUEST_KWARGS)
    async with stream as s:
        await anext(s)

    time.sleep(0.05)
    _assert_one_span_with_tokens(exporter)


@pytest.mark.asyncio
async def test_async_aclose_finalizes_span():
    tracer, exporter = _tracer_with_exporter()
    wrapper = _factory(tracer, is_async=True)

    stream = await wrapper(_acreate, None, (), REQUEST_KWARGS)
    async with stream as s:
        await anext(s)
        await s.aclose()

    time.sleep(0.05)
    _assert_one_span_with_tokens(exporter)


@pytest.mark.asyncio
async def test_async_full_consumption_exports_exactly_one_span():
    tracer, exporter = _tracer_with_exporter()
    wrapper = _factory(tracer, is_async=True)

    stream = await wrapper(_acreate, None, (), REQUEST_KWARGS)
    async with stream as s:
        async for _ in s:
            pass

    time.sleep(0.05)
    _assert_one_span_with_tokens(exporter)
