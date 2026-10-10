# pylint: disable=missing-function-docstring
"""Regression tests: an OpenAI/Anthropic stream that raises while it is read
(dropped connection, Ctrl-C) must still end its span, once, with ERROR.

The streaming wrappers only finalized on StopIteration/StopAsyncIteration (or
close()/with-exit), so a plain `for chunk in stream:` loop whose read raised
left the span recording forever and nothing was exported (#1702).
"""

import pytest
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import (
    InMemorySpanExporter,
)
from opentelemetry.trace import StatusCode

from openlit._config import OpenlitConfig
from openlit.instrumentation.anthropic.anthropic import messages
from openlit.instrumentation.anthropic.async_anthropic import async_messages
from openlit.instrumentation.openai.async_openai import (
    async_chat_completions,
    async_responses,
)
from openlit.instrumentation.openai.openai import chat_completions, responses


class ReadFailed(Exception):
    """Stands in for httpx.ReadError / openai.APIConnectionError."""


_CHAT_CHUNK = {
    "id": "chatcmpl-test",
    "model": "gpt-4o",
    "choices": [{"index": 0, "delta": {"content": "hi"}, "finish_reason": None}],
}
_RESPONSE_EVENT = {"type": "response.output_text.delta", "delta": "hi"}
_ANTHROPIC_EVENT = {
    "type": "message_start",
    "message": {
        "id": "msg_01",
        "model": "claude-3-5-sonnet-latest",
        "role": "assistant",
        "usage": {"input_tokens": 3},
    },
}

_CASES = {
    "openai-chat": (
        chat_completions,
        async_chat_completions,
        _CHAT_CHUNK,
        {"model": "gpt-4o", "messages": [{"role": "user", "content": "hi"}]},
    ),
    "openai-responses": (
        responses,
        async_responses,
        _RESPONSE_EVENT,
        {"model": "gpt-4o", "input": "hi"},
    ),
    "anthropic-messages": (
        messages,
        async_messages,
        _ANTHROPIC_EVENT,
        {
            "model": "claude-3-5-sonnet-latest",
            "max_tokens": 10,
            "messages": [{"role": "user", "content": "hi"}],
        },
    ),
}


class FailingStream:
    """Yields one event, then raises `exc` on the next read (sync and async)."""

    def __init__(self, event, exc):
        self._event = event
        self._exc = exc
        self._sent = False

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    def __iter__(self):
        return self

    def __aiter__(self):
        return self

    def _read(self):
        if self._sent:
            raise self._exc
        self._sent = True
        return self._event

    def __next__(self):
        return self._read()

    async def __anext__(self):
        return self._read()

    def close(self):
        pass

    async def aclose(self):
        pass


def _tracer_and_exporter():
    OpenlitConfig.reset_to_defaults()
    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    return provider.get_tracer(__name__), exporter


def _wrapper(factory, tracer):
    return factory(
        version="test",
        environment="test",
        application_name="test",
        tracer=tracer,
        pricing_info={},
        capture_message_content=False,
        metrics=None,
        disable_metrics=True,
    )


def _assert_one_error_span(exporter, exc_type):
    spans = exporter.get_finished_spans()
    assert len(spans) == 1, "a stream that fails mid-read must still end its span"
    assert spans[0].status.status_code == StatusCode.ERROR
    assert spans[0].attributes.get("error.type") == exc_type.__name__


@pytest.mark.parametrize("exc_type", [ReadFailed, KeyboardInterrupt])
@pytest.mark.parametrize("case", list(_CASES))
def test_sync_stream_read_error_ends_span(case, exc_type):
    sync_factory, _, event, kwargs = _CASES[case]
    tracer, exporter = _tracer_and_exporter()
    raw = FailingStream(event, exc_type("boom"))

    stream = _wrapper(sync_factory, tracer)(
        lambda *a, **k: raw, object(), (), {**kwargs, "stream": True}
    )
    with pytest.raises(exc_type):
        for _ in stream:
            pass
    # Closing afterwards (e.g. a with-block exit) must not end it twice.
    stream.close()

    _assert_one_error_span(exporter, exc_type)


@pytest.mark.asyncio
@pytest.mark.parametrize("exc_type", [ReadFailed, KeyboardInterrupt])
@pytest.mark.parametrize("case", list(_CASES))
async def test_async_stream_read_error_ends_span(case, exc_type):
    _, async_factory, event, kwargs = _CASES[case]
    tracer, exporter = _tracer_and_exporter()
    raw = FailingStream(event, exc_type("boom"))

    async def fake_create(*_args, **_kwargs):
        return raw

    stream = await _wrapper(async_factory, tracer)(
        fake_create, object(), (), {**kwargs, "stream": True}
    )
    with pytest.raises(exc_type):
        async for _ in stream:
            pass

    _assert_one_error_span(exporter, exc_type)
