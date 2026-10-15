# pylint: disable=protected-access, duplicate-code, missing-function-docstring, too-few-public-methods
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

premai 0.3 `ChatCompletionResponseStreamContainer` defines `__iter__` only and
returns a generator. It has no `__next__`, `close`, `__enter__`, or `__exit__`.
Chunks are attrs objects with `to_dict`, not dicts. `FakeSyncStream` below is
the iterator from the original repro. `IterOnlyContainer` is the 0.3 container.
"""

import gc
import time

import pytest
from opentelemetry import trace as trace_api
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import (
    InMemorySpanExporter,
)
from opentelemetry.trace import StatusCode

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
    """Iterator plus context manager, the shape the original repro used.

    premai 0.3 does not return this. `IterOnlyContainer` is that object.
    """

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


class IterOnlyContainer:
    """premai 0.3 `ChatCompletionResponseStreamContainer`.

    `__iter__` returns a generator. There is no `__next__`, `close`,
    `__enter__`, or `__exit__`. The generator's `finally` stands in for the
    container's `with self._stream` block.
    """

    def __init__(self, chunks, box, raise_after=None):
        self._chunks = list(chunks)
        self._box = box
        self._raise_after = raise_after

    def __iter__(self):
        chunks = self._chunks
        box = self._box
        raise_after = self._raise_after

        def generator():
            try:
                for index, chunk in enumerate(chunks):
                    if raise_after is not None and index >= raise_after:
                        raise RuntimeError("stream failed")
                    yield chunk
            finally:
                box["closed"] = True

        return generator()


class AttrsChunk:
    """Stand-in for a premai attrs chunk. `to_dict` returns the wire dict."""

    def __init__(self, payload):
        self._payload = payload

    def to_dict(self):
        """Return the chunk the streaming reader expects."""
        return self._payload


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


def test_exception_suppression_by_the_wrapped_stream_is_honoured():
    """A wrapped stream that suppresses an exception must still suppress it.

    `__exit__` forwards to the wrapped stream; returning None instead of what
    it returned would turn a suppressed exception back into a raised one.
    """

    class SuppressingStream(FakeSyncStream):
        """A stream whose __exit__ claims it handled the exception."""

        def __exit__(self, *exc):
            return True  # "I handled it"

    tracer, exporter = _tracer_with_exporter()
    wrapper = _factory(tracer)

    stream = wrapper(lambda *a, **k: SuppressingStream(), None, (), REQUEST_KWARGS)
    with stream:
        raise ValueError("the wrapped stream says it handles this")

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


def _finish_reasons(span):
    return list(span.attributes.get(SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON))


def test_iter_only_container_yields_every_chunk_and_one_span():
    """The 0.3 container has no __next__. list() must still return both chunks."""
    tracer, exporter = _tracer_with_exporter()
    wrapper = _factory(tracer)
    box = {"closed": False}

    stream = wrapper(
        lambda *a, **k: IterOnlyContainer(CHUNKS, box),
        None,
        (),
        REQUEST_KWARGS,
    )
    received = list(stream)

    assert received == CHUNKS
    assert box["closed"]
    time.sleep(0.05)
    span = _one_finished_span(exporter)
    assert span.attributes.get(SemanticConvention.GEN_AI_RESPONSE_ID) == "chatcmpl-1"
    assert _finish_reasons(span) == ["stop"]
    assert "partial answer" in str(span.attributes)


def test_iter_only_container_used_as_context_manager_does_not_require_enter():
    """``with stream`` is the wrapper's protocol. The container has no __enter__."""
    tracer, exporter = _tracer_with_exporter()
    wrapper = _factory(tracer)
    box = {"closed": False}

    stream = wrapper(
        lambda *a, **k: IterOnlyContainer(CHUNKS, box),
        None,
        (),
        REQUEST_KWARGS,
    )
    with stream as traced:
        assert next(traced) == CHUNKS[0]
    assert box["closed"]
    time.sleep(0.05)
    span = _one_finished_span(exporter)
    assert _finish_reasons(span) == ["incomplete"]


def test_close_on_iter_only_container_closes_the_generator_once():
    """close() closes the generator the container returned, not the container."""
    tracer, exporter = _tracer_with_exporter()
    wrapper = _factory(tracer)
    box = {"closed": False}

    stream = wrapper(
        lambda *a, **k: IterOnlyContainer(CHUNKS, box),
        None,
        (),
        REQUEST_KWARGS,
    )
    next(stream)
    stream.close()
    stream.close()

    assert box["closed"]
    time.sleep(0.05)
    span = _one_finished_span(exporter)
    assert _finish_reasons(span) == ["incomplete"]
    assert "partial" in str(span.attributes)


def test_bare_break_exports_the_span_when_the_wrapper_is_released():
    """Prem's documented call is a bare for-loop. break must not leak the span."""
    tracer, exporter = _tracer_with_exporter()
    wrapper = _factory(tracer)
    box = {"closed": False}

    def run():
        traced = wrapper(
            lambda *a, **k: IterOnlyContainer(CHUNKS, box),
            None,
            (),
            REQUEST_KWARGS,
        )
        for _ in traced:
            break

    run()
    gc.collect()

    assert box["closed"]
    span = _one_finished_span(exporter)
    assert span.status.status_code == StatusCode.OK
    assert _finish_reasons(span) == ["incomplete"]
    assert "partial" in str(span.attributes)


def test_held_iter_only_stream_stays_open_until_released():
    """A kept reference must stay resumable. Finalizing on break would drop the tail."""
    tracer, exporter = _tracer_with_exporter()
    wrapper = _factory(tracer)
    box = {"closed": False}

    stream = wrapper(
        lambda *a, **k: IterOnlyContainer(CHUNKS, box),
        None,
        (),
        REQUEST_KWARGS,
    )
    first = next(stream)

    assert first == CHUNKS[0]
    assert box["closed"] is False
    assert len(exporter.get_finished_spans()) == 0
    assert next(stream) == CHUNKS[1]

    del stream
    gc.collect()

    assert box["closed"]
    _one_finished_span(exporter)


def test_stream_error_is_recorded_after_partial_text():
    """A failure from the generator stays on the span with the text already seen."""
    tracer, exporter = _tracer_with_exporter()
    wrapper = _factory(tracer)
    box = {"closed": False}

    def run():
        traced = wrapper(
            lambda *a, **k: IterOnlyContainer(CHUNKS, box, raise_after=1),
            None,
            (),
            REQUEST_KWARGS,
        )
        with pytest.raises(RuntimeError, match="stream failed"):
            list(traced)

    run()
    gc.collect()

    assert box["closed"]
    span = _one_finished_span(exporter)
    assert span.status.status_code == StatusCode.ERROR
    assert _finish_reasons(span) == ["error"]
    assert "partial" in str(span.attributes)


def test_attrs_chunks_contribute_content_and_response_id():
    """0.3 yields attrs objects. to_dict() is what puts the text on the span."""
    tracer, exporter = _tracer_with_exporter()
    wrapper = _factory(tracer)
    chunks = [AttrsChunk(chunk) for chunk in CHUNKS]
    box = {"closed": False}

    stream = wrapper(
        lambda *a, **k: IterOnlyContainer(chunks, box),
        None,
        (),
        REQUEST_KWARGS,
    )
    received = list(stream)

    assert received == chunks
    time.sleep(0.05)
    span = _one_finished_span(exporter)
    assert span.attributes.get(SemanticConvention.GEN_AI_RESPONSE_ID) == "chatcmpl-1"
    assert _finish_reasons(span) == ["stop"]
    assert "partial answer" in str(span.attributes)
    assert span.attributes.get(SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS) > 0


def test_real_0_3_container_exposes_iter_only():
    """Lock the surface these tests stand in for, when that SDK is installed."""
    pytest.importorskip("premai")
    try:
        from premai.api.chat_completions.v1_chat_completions_create import (
            ChatCompletionResponseStreamContainer as container,
        )
    except ImportError:
        pytest.skip("premai.api is the 0.3 client; this install is newer")

    present = [
        name
        for name in ("__iter__", "__next__", "close", "__enter__", "__exit__")
        if name in vars(container)
    ]
    assert present == ["__iter__"]
