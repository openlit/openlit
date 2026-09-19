# pylint: disable=protected-access, missing-function-docstring, no-member
"""Span-lifecycle tests for the litellm streaming instrumentation.

``TracedSyncStream.__exit__``/``TracedAsyncStream.__aexit__`` merely forwarded to
the wrapped stream, and the span was ended only inside the
``except StopIteration``/``StopAsyncIteration`` handler. A caller that ``break``s
out of ``with … as stream:`` before the stream is exhausted, or closes it early,
never reached that handler, so the span and everything on it was lost.

These drive the real wrapper factories with a synthetic litellm-shaped stream and
assert the span ends exactly once, carrying token counts.
"""

import time

import pytest
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import (
    InMemorySpanExporter,
)

from openlit._config import OpenlitConfig
from openlit.instrumentation.litellm.async_litellm import acompletion
from openlit.instrumentation.litellm.litellm import completion
from openlit.semcov import SemanticConvention

REQUEST_KWARGS = {
    "model": "gpt-4o-mini",
    "stream": True,
    "messages": [{"role": "user", "content": "hi"}],
}

CHUNKS = [
    {
        "id": "chatcmpl-1",
        "model": "gpt-4o-mini",
        "choices": [{"delta": {"content": "Hello"}, "finish_reason": None}],
    },
    {
        "id": "chatcmpl-1",
        "model": "gpt-4o-mini",
        "choices": [{"delta": {"content": " world"}, "finish_reason": "stop"}],
        "usage": {"prompt_tokens": 5, "completion_tokens": 3, "total_tokens": 8},
    },
]


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


class FakeStream:
    """Context-manager stream shaped like litellm's CustomStreamWrapper."""

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
    """Async twin; litellm exposes ``aclose`` on the async wrapper."""

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


def _create(*_a, **_k):
    return FakeStream()


async def _acreate(*_a, **_k):
    return FakeAsyncStream()


def _factory(tracer, *, is_async):
    maker = acompletion if is_async else completion
    return maker(
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


def _assert_one_span_with_tokens(exporter):
    spans = exporter.get_finished_spans()
    assert len(spans) == 1, "expected exactly one exported span"
    attrs = spans[0].attributes
    assert SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS in attrs
    assert SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS in attrs


def test_sync_early_break_inside_with_ends_span():
    tracer, exporter = _tracer_with_exporter()
    wrapper = _factory(tracer, is_async=False)

    stream = wrapper(_create, None, (), REQUEST_KWARGS)
    with stream as s:
        for _ in s:
            break

    time.sleep(0.05)
    _assert_one_span_with_tokens(exporter)


def test_sync_close_finalizes_span():
    """``close()`` must end the span with no context manager around it."""
    tracer, exporter = _tracer_with_exporter()
    wrapper = _factory(tracer, is_async=False)

    stream = wrapper(_create, None, (), REQUEST_KWARGS)
    next(stream)
    stream.close()

    time.sleep(0.05)
    _assert_one_span_with_tokens(exporter)


def test_sync_full_consumption_exports_exactly_one_span():
    tracer, exporter = _tracer_with_exporter()
    wrapper = _factory(tracer, is_async=False)

    stream = wrapper(_create, None, (), REQUEST_KWARGS)
    with stream as s:
        for _ in s:
            pass
        s.close()

    time.sleep(0.05)
    _assert_one_span_with_tokens(exporter)


@pytest.mark.asyncio
async def test_async_early_break_inside_with_ends_span():
    tracer, exporter = _tracer_with_exporter()
    wrapper = _factory(tracer, is_async=True)

    stream = await wrapper(_acreate, None, (), REQUEST_KWARGS)
    async with stream as s:
        async for _ in s:
            break

    time.sleep(0.05)
    _assert_one_span_with_tokens(exporter)


@pytest.mark.asyncio
async def test_async_aclose_finalizes_span():
    """``await stream.aclose()`` must end the span on its own.

    Closing inside ``async with`` would not exercise this: ``__aexit__``
    finalizes the span whatever the close override does.
    """
    tracer, exporter = _tracer_with_exporter()
    wrapper = _factory(tracer, is_async=True)

    stream = await wrapper(_acreate, None, (), REQUEST_KWARGS)
    await anext(stream)
    await stream.aclose()

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
        await s.aclose()

    time.sleep(0.05)
    _assert_one_span_with_tokens(exporter)
