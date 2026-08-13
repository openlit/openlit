"""Tests that an early-exited OpenAI stream still ends and exports its span."""

import pytest
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

from openlit.instrumentation.openai.async_openai import async_chat_completions
from openlit.instrumentation.openai.openai import chat_completions
from openlit._config import OpenlitConfig


def _tracer_and_exporter():
    OpenlitConfig.reset_to_defaults()
    exporter = InMemorySpanExporter()
    tracer_provider = TracerProvider()
    tracer_provider.add_span_processor(SimpleSpanProcessor(exporter))
    return tracer_provider.get_tracer("test-openai-stream-lifecycle"), exporter


def _chat_kwargs():
    return {
        "model": "gpt-4o",
        "messages": [{"role": "user", "content": "ping"}],
        "stream": True,
    }


_CHUNK = {
    "id": "chatcmpl-test",
    "model": "gpt-4o",
    "choices": [{"index": 0, "delta": {"content": "hi"}, "finish_reason": None}],
}


class FakeRawSyncStream:
    """Minimal stand-in for openai._streaming.Stream: supports the context
    manager + iterator protocol and an explicit close(), never driven to
    exhaustion by this test."""

    def __init__(self, chunks):
        self._chunks = list(chunks)
        self.closed = False

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_value, traceback):
        self.close()

    def __iter__(self):
        return self

    def __next__(self):
        if not self._chunks:
            raise StopIteration
        return self._chunks.pop(0)

    def close(self):
        """Mark closed, matching openai._streaming.Stream.close()."""
        self.closed = True


class FakeRawAsyncStream:
    """Async twin of FakeRawSyncStream."""

    def __init__(self, chunks):
        self._chunks = list(chunks)
        self.closed = False

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc_value, traceback):
        await self.close()

    def __aiter__(self):
        return self

    async def __anext__(self):
        if not self._chunks:
            raise StopAsyncIteration
        return self._chunks.pop(0)

    async def close(self):
        """Mark closed, matching openai._streaming.AsyncStream.close()."""
        self.closed = True


def test_sync_stream_closed_via_context_manager_break_still_exports_span():
    """An early `break` inside a `with ... as stream:` block must still end
    and export the span, with whatever content had already streamed in."""

    tracer, exporter = _tracer_and_exporter()
    wrapper = chat_completions(
        version="test-version",
        environment="test-env",
        application_name="test-app",
        tracer=tracer,
        pricing_info={},
        capture_message_content=False,
        metrics=None,
        disable_metrics=True,
    )

    raw_stream = FakeRawSyncStream([_CHUNK, _CHUNK])

    def fake_create(*_args, **_kwargs):
        return raw_stream

    traced_stream = wrapper(fake_create, object(), [], _chat_kwargs())

    with traced_stream as stream:
        for _chunk in stream:
            break

    assert raw_stream.closed
    spans = exporter.get_finished_spans()
    assert len(spans) == 1
    assert spans[0].name == "chat gpt-4o"


def test_sync_stream_explicit_close_still_exports_span():
    """Calling .close() directly (no context manager) must also finalize."""

    tracer, exporter = _tracer_and_exporter()
    wrapper = chat_completions(
        version="test-version",
        environment="test-env",
        application_name="test-app",
        tracer=tracer,
        pricing_info={},
        capture_message_content=False,
        metrics=None,
        disable_metrics=True,
    )

    raw_stream = FakeRawSyncStream([_CHUNK])

    def fake_create(*_args, **_kwargs):
        return raw_stream

    traced_stream = wrapper(fake_create, object(), [], _chat_kwargs())
    next(traced_stream)
    traced_stream.close()

    assert raw_stream.closed
    spans = exporter.get_finished_spans()
    assert len(spans) == 1


def test_sync_stream_full_consumption_exports_exactly_one_span():
    """Full StopIteration consumption inside a `with` block must not
    double-finalize (both __next__ and __exit__ fire)."""

    tracer, exporter = _tracer_and_exporter()
    wrapper = chat_completions(
        version="test-version",
        environment="test-env",
        application_name="test-app",
        tracer=tracer,
        pricing_info={},
        capture_message_content=False,
        metrics=None,
        disable_metrics=True,
    )

    raw_stream = FakeRawSyncStream([_CHUNK])

    def fake_create(*_args, **_kwargs):
        return raw_stream

    traced_stream = wrapper(fake_create, object(), [], _chat_kwargs())

    with traced_stream as stream:
        for _chunk in stream:
            pass

    spans = exporter.get_finished_spans()
    assert len(spans) == 1


@pytest.mark.asyncio
async def test_async_stream_closed_via_context_manager_break_still_exports_span():
    """Async twin of the sync early-break test."""

    tracer, exporter = _tracer_and_exporter()
    wrapper = async_chat_completions(
        version="test-version",
        environment="test-env",
        application_name="test-app",
        tracer=tracer,
        pricing_info={},
        capture_message_content=False,
        metrics=None,
        disable_metrics=True,
    )

    raw_stream = FakeRawAsyncStream([_CHUNK, _CHUNK])

    async def fake_create(*_args, **_kwargs):
        return raw_stream

    traced_stream = await wrapper(fake_create, object(), [], _chat_kwargs())

    async with traced_stream as stream:
        async for _chunk in stream:
            break

    assert raw_stream.closed
    spans = exporter.get_finished_spans()
    assert len(spans) == 1
