# pylint: disable=protected-access, duplicate-code, missing-function-docstring
"""Regression tests: the sync Letta streaming wrapper must end its span.

``TracedLettaStream`` never ended the span that ``create_letta_wrapper``
started when it detected a stream: the ``StopIteration`` branch started a
*second* span for finalization (the anti-pattern #1464 removed from other
providers), ``_finalize_span`` only set attributes without ending, and
``close()``/``__exit__`` left the span recording forever. The original span —
the one holding TTFT and the chunk count — was therefore never exported, and
an early ``close()`` exported nothing at all.

These tests drive the real ``send_message`` wrapper factory with a mock sync
stream shaped like letta's and assert the original span ends exactly once on
every exit path: full consumption, early ``close()``, early exit from a
``with`` block, and a failure raised by the stream.
"""

from types import SimpleNamespace

import pytest
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import (
    InMemorySpanExporter,
)
from opentelemetry.trace import StatusCode

from openlit._config import OpenlitConfig
from openlit.instrumentation.letta import letta as sync_mod
from openlit.semcov import SemanticConvention

# Kwargs shaped like MessagesClient.create(agent_id=..., stream=True)
REQUEST_KWARGS = {
    "agent_id": "agent-0",
    "messages": [{"role": "user", "content": "Monitor LLM Applications"}],
    "stream": True,
}


class FakeLettaMessage(SimpleNamespace):
    """A chunk shaped like letta's LettaMessage."""


def _chunks():
    return [
        FakeLettaMessage(
            id="msg-1", message_type="assistant_message", content="partial"
        ),
        FakeLettaMessage(
            id="msg-2", message_type="assistant_message", content=" answer"
        ),
        FakeLettaMessage(
            id="msg-3",
            message_type="usage_statistics",
            prompt_tokens=10,
            completion_tokens=5,
            total_tokens=15,
        ),
    ]


class FakeLettaStream:
    """Sync stream shaped like the generator returned by create(stream=True)."""

    def __init__(self):
        self._it = iter(_chunks())
        self.closed = False

    def __iter__(self):
        return self

    def __next__(self):
        return next(self._it)

    def close(self):
        self.closed = True


class FakeLettaErrorStream(FakeLettaStream):
    """Stream that fails on the second chunk."""

    def __init__(self):
        super().__init__()
        self._it = iter(_chunks()[:1])

    def __next__(self):
        super().__next__()
        raise RuntimeError("stream failed")


class _StartedSpanCollector(SimpleSpanProcessor):
    """SimpleSpanProcessor that also records every span it starts."""

    def __init__(self, exporter):
        super().__init__(exporter)
        self.started = []

    def on_start(self, span, parent_context=None):
        self.started.append(span)
        super().on_start(span, parent_context)


def _tracer_with_exporter():
    OpenlitConfig.reset_to_defaults()
    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    processor = _StartedSpanCollector(exporter)
    provider.add_span_processor(processor)
    return provider.get_tracer(__name__), exporter, processor


def _make_wrapped(stream_factory):
    """Sync stand-in for MessagesClient.create that counts calls."""

    def create(*_args, **_kwargs):
        create.calls += 1
        return stream_factory()

    create.calls = 0
    return create


def _factory(tracer):
    return sync_mod.send_message(
        gen_ai_endpoint="letta.create_stream",
        version="test",
        environment="test",
        application_name="test",
        tracer=tracer,
        pricing_info={},
        capture_message_content=True,
        metrics=None,
        disable_metrics=True,
    )


def _assert_streaming_span(exporter, chunk_count, usage=True):
    spans = exporter.get_finished_spans()
    assert len(spans) == 1, "expected exactly one exported span"
    span = spans[0]
    assert span.name == "chat gpt-4o"
    attrs = span.attributes
    # Finalization must run on the span started when the stream was detected;
    # the base code left that span recording forever and exported only a
    # throwaway second span for the finalization attributes.
    assert attrs[SemanticConvention.GEN_AI_STREAMING_CHUNK_COUNT] == chunk_count
    assert SemanticConvention.GEN_AI_SERVER_TTFT in attrs
    if usage:
        # The usage_statistics chunk is only consumed on a full iteration.
        assert attrs[SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS] == 10
        assert attrs[SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS] == 5
    return span


def test_sync_stream_ends_span_on_exhaustion():
    tracer, exporter, collector = _tracer_with_exporter()
    recorder = _make_wrapped(FakeLettaStream)
    wrapper = _factory(tracer)

    stream = wrapper(recorder, None, (), REQUEST_KWARGS)
    collected = list(stream)

    assert recorder.calls == 1
    assert len(collected) == 3
    _assert_streaming_span(exporter, chunk_count=3)
    assert len(collector.started) == 1, (
        f"{len(collector.started)} spans started for one streaming call"
    )
    assert not collector.started[0].is_recording(), "streaming span never ended"


def test_sync_stream_early_close_ends_span():
    """close() before exhaustion must finalize and end the span on its own."""
    tracer, exporter, collector = _tracer_with_exporter()
    recorder = _make_wrapped(FakeLettaStream)
    wrapper = _factory(tracer)

    stream = wrapper(recorder, None, (), REQUEST_KWARGS)
    next(stream)
    stream.close()

    assert recorder.calls == 1
    assert stream.closed
    _assert_streaming_span(exporter, chunk_count=1, usage=False)


def test_sync_stream_early_break_inside_with_ends_span():
    tracer, exporter, collector = _tracer_with_exporter()
    recorder = _make_wrapped(FakeLettaStream)
    wrapper = _factory(tracer)

    stream = wrapper(recorder, None, (), REQUEST_KWARGS)
    with stream as s:
        next(s)  # consume one chunk, then leave the block early

    assert recorder.calls == 1
    _assert_streaming_span(exporter, chunk_count=1, usage=False)


def test_sync_stream_error_ends_error_span():
    tracer, exporter, collector = _tracer_with_exporter()
    recorder = _make_wrapped(FakeLettaErrorStream)
    wrapper = _factory(tracer)

    stream = wrapper(recorder, None, (), REQUEST_KWARGS)
    with pytest.raises(RuntimeError, match="stream failed"):
        list(stream)
    # Idempotent: closing after a failure must not add a second span.
    stream.close()

    assert recorder.calls == 1
    spans = exporter.get_finished_spans()
    assert len(spans) == 1, "expected exactly one exported span"
    assert spans[0].status.status_code == StatusCode.ERROR
    assert spans[0].attributes[SemanticConvention.ERROR_TYPE] == "RuntimeError"


def test_sync_chat_non_stream_response_returns_result():
    """A chat response that is not an iterator is returned as-is."""
    tracer, exporter, collector = _tracer_with_exporter()
    response = SimpleNamespace(
        id="msg-response", messages=[{"role": "assistant", "content": "done"}]
    )
    recorder = _make_wrapped(lambda: response)
    wrapper = _factory(tracer)

    result = wrapper(recorder, None, (), REQUEST_KWARGS)

    assert recorder.calls == 1
    assert result is response
    spans = exporter.get_finished_spans()
    assert len(spans) == 1, "expected exactly one exported span"
