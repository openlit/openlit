"""Span-lifecycle tests for the GPT4All streaming instrumentation.

``GPT4All.generate(streaming=True)`` returns a generator of strings. The
documented call is a bare ``for`` loop, which does not call ``close()`` on
this wrapper. These drive the real ``generate`` factory with that generator
shape and assert the span ends exactly once with the outcome of the exit.
"""

import gc
from types import SimpleNamespace

import pytest
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import (
    InMemorySpanExporter,
)
from opentelemetry.trace import StatusCode

from openlit._config import OpenlitConfig
from openlit.instrumentation.gpt4all.gpt4all import generate

CHUNKS = ["Hello", " world"]


@pytest.fixture(autouse=True)
def _reset_config():
    """The instrumentation reads OpenlitConfig attributes created at init."""
    OpenlitConfig.reset_to_defaults()
    yield
    OpenlitConfig.reset_to_defaults()


def _tracer_and_exporter():
    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    return provider.get_tracer(__name__), exporter


def _model():
    return SimpleNamespace(
        model=SimpleNamespace(model_path="/models/orca-mini-3b-gguf2-q4_0.gguf")
    )


def _generator(chunks, box, raise_after=None, raise_on_close=False):
    """Same shape as GPT4All's nested ``stream()`` generator."""

    def stream():
        try:
            for index, chunk in enumerate(chunks):
                if raise_after is not None and index >= raise_after:
                    raise RuntimeError("model failed")
                yield chunk
            box["exhausted"] = True
        finally:
            box["closed"] = True
            if raise_on_close:
                raise RuntimeError("close failed")

    return stream()


def _wrapper(tracer, capture_message_content=True):
    return generate(
        version="test",
        environment="test",
        application_name="test",
        tracer=tracer,
        pricing_info={},
        capture_message_content=capture_message_content,
        metrics=None,
        disable_metrics=True,
        event_provider=None,
    )


def _open_stream(tracer, chunks=None, raise_after=None, raise_on_close=False):
    box = {"closed": False, "exhausted": False}
    wrapper = _wrapper(tracer)

    def fake_generate(*_args, **_kwargs):
        return _generator(
            CHUNKS if chunks is None else chunks,
            box,
            raise_after=raise_after,
            raise_on_close=raise_on_close,
        )

    stream = wrapper(
        fake_generate,
        _model(),
        (),
        {"streaming": True, "prompt": "hi"},
    )
    return stream, box


def _finish_reasons(span):
    return tuple(span.attributes["gen_ai.response.finish_reasons"])


def _output(span):
    return span.attributes["gen_ai.output.messages"]


def test_with_break_on_generator_exports_incomplete_span():
    """An early break inside ``with`` must end the span and close the generator."""

    tracer, exporter = _tracer_and_exporter()
    stream, box = _open_stream(tracer)

    with stream as traced:
        for _token in traced:
            break

    assert box["closed"] is True
    assert box["exhausted"] is False
    spans = exporter.get_finished_spans()
    assert len(spans) == 1
    assert spans[0].status.status_code == StatusCode.OK
    assert _finish_reasons(spans[0]) == ("incomplete",)
    output = _output(spans[0])
    assert "Hello" in output
    assert "world" not in output
    assert '"finish_reason": "incomplete"' in output


def test_explicit_close_exports_incomplete_span():
    """``close()`` stops the generator and exports the text seen so far."""

    tracer, exporter = _tracer_and_exporter()
    stream, box = _open_stream(tracer)
    assert next(stream) == "Hello"
    stream.close()

    assert box["closed"] is True
    spans = exporter.get_finished_spans()
    assert len(spans) == 1
    assert spans[0].status.status_code == StatusCode.OK
    assert _finish_reasons(spans[0]) == ("incomplete",)
    assert "Hello" in _output(spans[0])
    assert '"finish_reason": "incomplete"' in _output(spans[0])


def test_second_close_exports_exactly_one_span():
    """A repeat ``close()`` must not export a second span."""

    tracer, exporter = _tracer_and_exporter()
    stream, _box = _open_stream(tracer)
    next(stream)
    stream.close()
    stream.close()

    spans = exporter.get_finished_spans()
    assert len(spans) == 1
    assert _finish_reasons(spans[0]) == ("incomplete",)


def test_close_before_iteration_exports_incomplete_span():
    """Closing a stream that has not yielded still ends the span.

    ``generator.close()`` does not run the body of a generator that was never
    started, so the model is never invoked. The span is still exported.
    """

    tracer, exporter = _tracer_and_exporter()
    stream, box = _open_stream(tracer)
    stream.close()

    assert box["exhausted"] is False
    with pytest.raises(StopIteration):
        next(stream)
    spans = exporter.get_finished_spans()
    assert len(spans) == 1
    assert spans[0].status.status_code == StatusCode.OK
    assert _finish_reasons(spans[0]) == ("incomplete",)


def test_full_drain_inside_with_keeps_stop_reason():
    """StopIteration inside ``with`` must not be rewritten by the later close."""

    tracer, exporter = _tracer_and_exporter()
    stream, box = _open_stream(tracer)

    with stream as traced:
        assert list(traced) == CHUNKS

    assert box["closed"] is True
    assert box["exhausted"] is True
    spans = exporter.get_finished_spans()
    assert len(spans) == 1
    assert spans[0].status.status_code == StatusCode.OK
    assert _finish_reasons(spans[0]) == ("stop",)
    output = _output(spans[0])
    assert "Hello world" in output
    assert '"finish_reason": "stop"' in output


def test_documented_bare_for_drains_once_with_stop_reason():
    """The documented ``for token in model.generate(..., streaming=True)`` loop."""

    tracer, exporter = _tracer_and_exporter()
    stream, box = _open_stream(tracer)
    assert list(stream) == CHUNKS

    assert box["exhausted"] is True
    spans = exporter.get_finished_spans()
    assert len(spans) == 1
    assert spans[0].status.status_code == StatusCode.OK
    assert _finish_reasons(spans[0]) == ("stop",)
    assert "Hello world" in _output(spans[0])


def test_bare_for_break_exports_span_when_wrapper_is_released():
    """A bare ``for`` plus ``break`` ends the span when the wrapper is released."""

    tracer, exporter = _tracer_and_exporter()

    def run():
        stream, stream_box = _open_stream(tracer)
        for _token in stream:
            break
        return stream_box

    box = run()
    gc.collect()

    assert box["closed"] is True
    assert box["exhausted"] is False
    spans = exporter.get_finished_spans()
    assert len(spans) == 1
    assert spans[0].status.status_code == StatusCode.OK
    assert _finish_reasons(spans[0]) == ("incomplete",)
    output = _output(spans[0])
    assert "Hello" in output
    assert "world" not in output
    assert '"finish_reason": "incomplete"' in output


def test_held_stream_stays_open_until_released():
    """Keeping the stream object must leave it resumable until that name is dropped."""

    tracer, exporter = _tracer_and_exporter()
    chunks = ["one", "two", "three"]
    stream, box = _open_stream(tracer, chunks=chunks)

    iterator = iter(stream)
    assert next(iterator) == "one"
    gc.collect()

    assert len(exporter.get_finished_spans()) == 0
    assert box["closed"] is False
    assert next(iterator) == "two"

    del stream
    del iterator
    gc.collect()

    assert box["closed"] is True
    spans = exporter.get_finished_spans()
    assert len(spans) == 1
    assert spans[0].status.status_code == StatusCode.OK
    assert _finish_reasons(spans[0]) == ("incomplete",)
    output = _output(spans[0])
    assert "onetwo" in output
    assert "three" not in output


def test_model_error_inside_with_marks_span_error():
    """A failure from the generator is a failed span, with text already seen."""

    tracer, exporter = _tracer_and_exporter()
    stream, box = _open_stream(tracer, raise_after=1)

    with pytest.raises(RuntimeError, match="model failed"):
        with stream as traced:
            for _token in traced:
                pass

    assert box["closed"] is True
    spans = exporter.get_finished_spans()
    assert len(spans) == 1
    assert spans[0].status.status_code == StatusCode.ERROR
    assert spans[0].attributes["error.type"] == "RuntimeError"
    assert _finish_reasons(spans[0]) == ("error",)
    output = _output(spans[0])
    assert "Hello" in output
    assert '"finish_reason": "error"' in output
    assert any(event.name == "exception" for event in spans[0].events)


def test_bare_for_model_error_exports_error_span_when_released():
    """A model failure in a bare ``for`` is recorded when the wrapper is released."""

    tracer, exporter = _tracer_and_exporter()

    def run():
        stream, _box = _open_stream(tracer, raise_after=1)
        with pytest.raises(RuntimeError, match="model failed"):
            for _token in stream:
                pass

    run()
    gc.collect()

    spans = exporter.get_finished_spans()
    assert len(spans) == 1
    assert spans[0].status.status_code == StatusCode.ERROR
    assert spans[0].attributes["error.type"] == "RuntimeError"
    assert _finish_reasons(spans[0]) == ("error",)
    assert "Hello" in _output(spans[0])


def test_caller_exception_inside_with_stays_ok():
    """A raise from user code is not a GPT4All failure. The cancel is incomplete."""

    tracer, exporter = _tracer_and_exporter()
    stream, box = _open_stream(tracer)

    with pytest.raises(ValueError, match="caller"):
        with stream as traced:
            for _token in traced:
                raise ValueError("caller")

    assert box["closed"] is True
    spans = exporter.get_finished_spans()
    assert len(spans) == 1
    assert spans[0].status.status_code == StatusCode.OK
    assert spans[0].attributes.get("error.type") is None
    assert _finish_reasons(spans[0]) == ("incomplete",)
    assert not any(event.name == "exception" for event in spans[0].events)
    assert "Hello" in _output(spans[0])
    assert '"finish_reason": "incomplete"' in _output(spans[0])


def test_generator_close_error_is_recorded_on_span():
    """An error raised while closing the generator stays on the span."""

    tracer, exporter = _tracer_and_exporter()
    stream, box = _open_stream(tracer, raise_on_close=True)

    with pytest.raises(RuntimeError, match="close failed"):
        next(stream)
        stream.close()

    assert box["closed"] is True
    spans = exporter.get_finished_spans()
    assert len(spans) == 1
    assert spans[0].status.status_code == StatusCode.ERROR
    assert spans[0].attributes["error.type"] == "RuntimeError"
    assert _finish_reasons(spans[0]) == ("error",)
    assert "Hello" in _output(spans[0])
    assert any(event.name == "exception" for event in spans[0].events)


def test_non_streaming_generate_exports_one_ok_span():
    """The non-streaming branch is unchanged: one OK span and the raw string."""

    tracer, exporter = _tracer_and_exporter()
    wrapper = _wrapper(tracer)

    result = wrapper(
        lambda *_args, **_kwargs: "done",
        _model(),
        (),
        {"streaming": False, "prompt": "hi"},
    )

    assert result == "done"
    spans = exporter.get_finished_spans()
    assert len(spans) == 1
    assert spans[0].status.status_code == StatusCode.OK
    assert _finish_reasons(spans[0]) == ("stop",)
    assert "done" in _output(spans[0])
