"""Spans from streams a caller abandons are exported (#1828).

``TracedSyncStream`` / ``TracedAsyncStream`` ended their span on ``StopIteration``,
``close()`` and ``__exit__`` only, so a bare ``for chunk in stream:`` that breaks
left the span unexported.
"""

import gc

import pytest
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

from openlit._config import OpenlitConfig
from openlit.instrumentation.openai.async_openai import async_chat_completions
from openlit.instrumentation.openai.openai import chat_completions

CHUNK = {
    "id": "c",
    "model": "gpt-4o",
    "choices": [{"index": 0, "delta": {"content": "hi"}, "finish_reason": None}],
}
KWARGS = {
    "model": "gpt-4o",
    "stream": True,
    "messages": [{"role": "user", "content": "hi"}],
}


def _tracer_and_exporter():
    OpenlitConfig.reset_to_defaults()
    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    return provider.get_tracer("test-openai-abandoned"), exporter


def _sync_wrapper(tracer):
    return chat_completions(
        version="t",
        environment="t",
        application_name="t",
        tracer=tracer,
        pricing_info={},
        capture_message_content=False,
        metrics=None,
        disable_metrics=True,
    )


def _async_wrapper(tracer):
    return async_chat_completions(
        version="t",
        environment="t",
        application_name="t",
        tracer=tracer,
        pricing_info={},
        capture_message_content=False,
        metrics=None,
        disable_metrics=True,
    )


class _RawStream:
    def __init__(self):
        self.left = 2

    def close(self):
        pass

    def __iter__(self):
        return self

    def __next__(self):
        if not self.left:
            raise StopIteration
        self.left -= 1
        return CHUNK


async def _raw_async(*args, **kwargs):
    return _RawAsyncStream()


class _RawAsyncStream:
    def __init__(self):
        self.left = 2

    def __aiter__(self):
        return self

    async def __anext__(self):
        if not self.left:
            raise StopAsyncIteration
        self.left -= 1
        return CHUNK


def test_an_abandoned_stream_exports_its_span():
    tracer, exporter = _tracer_and_exporter()
    stream = _sync_wrapper(tracer)(lambda *a, **k: _RawStream(), object(), [], KWARGS)

    for _chunk in stream:
        break
    del stream
    gc.collect()

    assert len(exporter.get_finished_spans()) == 1


def test_closing_the_stream_still_exports_one_span():
    tracer, exporter = _tracer_and_exporter()
    stream = _sync_wrapper(tracer)(lambda *a, **k: _RawStream(), object(), [], KWARGS)

    stream.close()
    del stream
    gc.collect()

    assert len(exporter.get_finished_spans()) == 1


@pytest.mark.asyncio
async def test_an_abandoned_async_stream_exports_its_span():
    tracer, exporter = _tracer_and_exporter()
    stream = await _async_wrapper(tracer)(_raw_async, object(), [], KWARGS)

    async for _chunk in stream:
        break
    del stream
    gc.collect()

    assert len(exporter.get_finished_spans()) == 1
