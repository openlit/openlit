# pylint: disable=protected-access, duplicate-code, missing-function-docstring
"""Regression tests: the premai streaming wrapper must be iterable, and must
end its span on every exit path.

`TracedSyncStream` defined `__iter__` with a `__next__` body: it pulled one
chunk, ran `process_chunk`, and returned that chunk in place of an iterator.
`for chunk in stream:` therefore raised `TypeError: iter() returned non-iterator`
and installing openlit turned a working premai stream into a crash. The
`finally` around it was the second half — it finalized the span after the first
chunk, so the one span that did get exported carried the first delta only and
left `gen_ai.response.id` empty, because the id is read in the finish-reason
branch an aborted iteration never reaches.

premai was the only instrumentation under `src/openlit/instrumentation/` with a
`__iter__` and no `__next__`. These tests drive the real wrapper factory with a
synthetic premai-shaped stream and assert the stream iterates, the span ends
exactly once on each exit path, and the usage attributes survive.
"""

import time

from opentelemetry import trace as trace_api
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import (
    InMemorySpanExporter,
)

from openlit._config import OpenlitConfig
from openlit.instrumentation.premai import premai as premai_mod
from openlit.semcov import SemanticConvention

REQUEST_KWARGS = {
    "model": "gpt-4o-mini",
    "stream": True,
    "messages": [{"role": "user", "content": "Monitor LLM Applications"}],
}

# Two premai-shaped chunks: a content delta, then a final chunk with usage.
CHUNKS = [
    {
        "id": "chatcmpl-1",
        "model": "gpt-4o-mini",
        "choices": [{"delta": {"content": "partial"}, "finish_reason": None}],
    },
    {
        "id": "chatcmpl-1",
        "model": "gpt-4o-mini",
        "choices": [{"delta": {"content": " answer"}, "finish_reason": "stop"}],
        "usage": {"prompt_tokens": 10, "completion_tokens": 5},
    },
]


def _tracer_with_exporter():
    OpenlitConfig.reset_to_defaults()
    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    return provider.get_tracer(__name__), exporter


def _factory(tracer):
    return premai_mod.chat(
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


class FakeSyncStream:
    """Sync context-manager stream shaped like premai's stream."""

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


def _one_finished_span(exporter):
    spans = exporter.get_finished_spans()
    assert len(spans) == 1, f"expected exactly one span, got {len(spans)}"
    return spans[0]


def test_the_stream_is_iterable():
    """`for chunk in stream:` must work. It raised TypeError before the fix."""
    tracer, exporter = _tracer_with_exporter()
    wrapper = _factory(tracer)

    stream = wrapper(lambda *a, **k: FakeSyncStream(), None, (), REQUEST_KWARGS)
    received = list(stream)

    assert received == CHUNKS, "every chunk must reach the caller unchanged"
    time.sleep(0.05)
    _one_finished_span(exporter)


def test_full_consumption_exports_exactly_one_span_with_usage():
    tracer, exporter = _tracer_with_exporter()
    wrapper = _factory(tracer)

    stream = wrapper(lambda *a, **k: FakeSyncStream(), None, (), REQUEST_KWARGS)
    for _ in stream:
        pass

    time.sleep(0.05)
    span = _one_finished_span(exporter)
    attrs = span.attributes
    # The id, model and finish reason are read in the finish-reason branch,
    # which only a completed iteration reaches. Ending after the first chunk
    # left all three unset however many chunks the stream really had.
    assert attrs.get(SemanticConvention.GEN_AI_RESPONSE_ID) == "chatcmpl-1"
    assert list(attrs.get(SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON)) == ["stop"]
    # Both deltas must be in the recorded answer, not just the first.
    assert "partial answer" in str(attrs)
    # premai estimates stream token counts from the text rather than reading
    # `usage`, so assert they are populated rather than pinning the estimate.
    assert attrs.get(SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS) > 0
    assert attrs.get(SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS) > 0


def test_break_before_exhaustion_still_exports_the_span():
    """A caller that leaves the block early must not leak the span."""
    tracer, exporter = _tracer_with_exporter()
    wrapper = _factory(tracer)

    stream = wrapper(lambda *a, **k: FakeSyncStream(), None, (), REQUEST_KWARGS)
    with stream as s:
        for _ in s:
            break

    time.sleep(0.05)
    _one_finished_span(exporter)


def test_close_finalizes_the_span_once():
    """close() must finalize, and exhaustion afterwards must not double-end."""
    tracer, exporter = _tracer_with_exporter()
    wrapper = _factory(tracer)

    stream = wrapper(lambda *a, **k: FakeSyncStream(), None, (), REQUEST_KWARGS)
    next(iter(stream))
    stream.close()
    stream.close()  # the guard makes the second call a no-op

    time.sleep(0.05)
    _one_finished_span(exporter)


def test_context_manager_exit_finalizes_without_iterating_to_the_end():
    tracer, exporter = _tracer_with_exporter()
    wrapper = _factory(tracer)

    stream = wrapper(lambda *a, **k: FakeSyncStream(), None, (), REQUEST_KWARGS)
    with stream as s:
        next(iter(s))

    time.sleep(0.05)
    _one_finished_span(exporter)


def test_the_span_is_detached_from_context():
    """The wrapper attaches a context token; nothing may leak into the caller."""
    tracer, exporter = _tracer_with_exporter()
    wrapper = _factory(tracer)

    stream = wrapper(lambda *a, **k: FakeSyncStream(), None, (), REQUEST_KWARGS)
    for _ in stream:
        pass

    time.sleep(0.05)
    _one_finished_span(exporter)
    assert trace_api.get_current_span().get_span_context().span_id == 0
