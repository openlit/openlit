# pylint: disable=protected-access, duplicate-code, missing-function-docstring, too-few-public-methods
"""Regression tests: the Google AI Studio streaming wrappers must end their
span on every exit path.

`TracedSyncStream.__exit__`/`TracedAsyncStream.__aexit__` merely forwarded to
the wrapped stream and there was no `close()`/`aclose()`, so the span was
ended only inside the `except StopIteration`/`StopAsyncIteration` handler.
A caller that `break`s out of `with … as stream:` before the stream is
exhausted, or calls `stream.close()`/`await stream.aclose()` early, never hit
that handler, so the span stayed recording forever and was never exported --
the whole call (span, cost, tokens) was lost. This is the Google AI Studio
instance of the early-close streaming-span leak fixed for Anthropic in #1461
and for Groq in #1516.

These tests drive the real `generate_stream`/`async_generate_stream` wrapper
factories with a synthetic Google-AI-Studio-shaped stream and assert the span
ends exactly once, carrying token-usage attributes, on each exit path.
"""

import time

import pytest
from opentelemetry import trace as trace_api, context as context_api
from opentelemetry.trace import StatusCode
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import (
    InMemorySpanExporter,
)

from openlit._config import OpenlitConfig
from openlit.instrumentation.google_ai_studio import google_ai_studio as sync_mod
from openlit.instrumentation.google_ai_studio import (
    async_google_ai_studio as async_mod,
)
from openlit.semcov import SemanticConvention

# The wrapper reads the model from kwargs; contents left empty so the telemetry
# is driven purely by the synthetic chunks below.
REQUEST_KWARGS = {"model": "gemini-2.0-flash"}


def _usage():
    """Shaped like google-genai's usage_metadata dict."""
    return {
        "prompt_token_count": 10,
        "candidates_token_count": 5,
        "thoughts_token_count": 0,
        "cached_content_token_count": 0,
        "cache_creation_input_tokens": 0,
    }


class FakeChunk:
    """Shaped like a google-genai streaming chunk.

    `process_chunk` runs it through `response_as_dict`, which calls
    `model_dump()`, and also reads `.text` directly off the object.
    """

    def __init__(self, text, usage=None):
        self.text = text
        self._usage = usage

    def model_dump(self, *_a, **_k):
        return {
            "response_id": "resp-123",
            "model_version": "gemini-2.0-flash",
            "usage_metadata": self._usage,
            "candidates": [{"finish_reason": "STOP", "content": {"parts": []}}],
        }


def _chunks():
    return iter(
        [
            FakeChunk("partial"),
            FakeChunk(" answer", _usage()),
        ]
    )


def _tracer_with_exporter():
    OpenlitConfig.reset_to_defaults()
    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    return provider.get_tracer(__name__), exporter


def _factory(tracer, *, is_async):
    mod = async_mod if is_async else sync_mod
    make = mod.async_generate_stream if is_async else mod.generate_stream
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
    """Sync context-manager stream shaped like google-genai's streaming response."""

    def __init__(self):
        self._it = _chunks()
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
    """Async context-manager stream shaped like google-genai's async streaming response."""

    def __init__(self):
        self._it = _chunks()
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
    """Async stand-in for the awaited google-genai async call."""
    return FakeAsyncStream()


def _assert_one_span_with_tokens(exporter):
    spans = exporter.get_finished_spans()
    assert len(spans) == 1, "expected exactly one exported span"
    attrs = spans[0].attributes
    assert SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS in attrs
    assert SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS in attrs


def _assert_one_error_span(exporter):
    spans = exporter.get_finished_spans()
    assert len(spans) == 1, "expected exactly one exported span"
    assert spans[0].status.status_code == StatusCode.ERROR
    assert spans[0].attributes[SemanticConvention.ERROR_TYPE] == "RuntimeError"


def test_sync_early_break_inside_with_ends_span():
    tracer, exporter = _tracer_with_exporter()
    wrapper = _factory(tracer, is_async=False)

    stream = wrapper(lambda *a, **k: FakeSyncStream(), object(), (), REQUEST_KWARGS)
    with stream as s:
        next(s)  # consume one chunk, then leave the block early

    time.sleep(0.05)
    _assert_one_span_with_tokens(exporter)


def test_sync_close_finalizes_span():
    tracer, exporter = _tracer_with_exporter()
    wrapper = _factory(tracer, is_async=False)

    stream = wrapper(lambda *a, **k: FakeSyncStream(), object(), (), REQUEST_KWARGS)
    with stream as s:
        next(s)
        s.close()

    time.sleep(0.05)
    _assert_one_span_with_tokens(exporter)


def test_sync_full_consumption_exports_exactly_one_span():
    tracer, exporter = _tracer_with_exporter()
    wrapper = _factory(tracer, is_async=False)

    stream = wrapper(lambda *a, **k: FakeSyncStream(), object(), (), REQUEST_KWARGS)
    with stream as s:
        for _ in s:
            pass

    time.sleep(0.05)
    _assert_one_span_with_tokens(exporter)


def test_sync_context_detached_after_early_break():
    """The stream must not leave its span attached to the OTel context."""
    tracer, _ = _tracer_with_exporter()
    wrapper = _factory(tracer, is_async=False)

    stream = wrapper(lambda *a, **k: FakeSyncStream(), object(), (), REQUEST_KWARGS)
    with stream as s:
        next(s)

    assert (
        trace_api.get_current_span(context_api.get_current())
        is trace_api.INVALID_SPAN
    )


def test_sync_exception_inside_with_ends_error_span():
    tracer, exporter = _tracer_with_exporter()
    wrapper = _factory(tracer, is_async=False)

    stream = wrapper(lambda *a, **k: FakeSyncStream(), object(), (), REQUEST_KWARGS)
    with pytest.raises(RuntimeError, match="stream failed"):
        with stream as s:
            next(s)
            raise RuntimeError("stream failed")

    _assert_one_error_span(exporter)


@pytest.mark.asyncio
async def test_async_early_break_inside_with_ends_span():
    tracer, exporter = _tracer_with_exporter()
    wrapper = _factory(tracer, is_async=True)

    stream = await wrapper(_acreate, object(), (), REQUEST_KWARGS)
    async with stream as s:
        await anext(s)

    time.sleep(0.05)
    _assert_one_span_with_tokens(exporter)


@pytest.mark.asyncio
async def test_async_aclose_finalizes_span():
    tracer, exporter = _tracer_with_exporter()
    wrapper = _factory(tracer, is_async=True)

    stream = await wrapper(_acreate, object(), (), REQUEST_KWARGS)
    async with stream as s:
        await anext(s)
        await s.aclose()

    time.sleep(0.05)
    _assert_one_span_with_tokens(exporter)


@pytest.mark.asyncio
async def test_async_full_consumption_exports_exactly_one_span():
    tracer, exporter = _tracer_with_exporter()
    wrapper = _factory(tracer, is_async=True)

    stream = await wrapper(_acreate, object(), (), REQUEST_KWARGS)
    async with stream as s:
        async for _ in s:
            pass

    time.sleep(0.05)
    _assert_one_span_with_tokens(exporter)


@pytest.mark.asyncio
async def test_async_exception_inside_with_ends_error_span():
    tracer, exporter = _tracer_with_exporter()
    wrapper = _factory(tracer, is_async=True)

    stream = await wrapper(_acreate, object(), (), REQUEST_KWARGS)
    with pytest.raises(RuntimeError, match="stream failed"):
        async with stream as s:
            await anext(s)
            raise RuntimeError("stream failed")

    _assert_one_error_span(exporter)
