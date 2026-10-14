# pylint: disable=protected-access, too-few-public-methods, not-context-manager
"""Bedrock converse_stream spans must export on the path boto3 callers use.

``converse_stream`` returns a dict. Production code iterates
``response["stream"]`` and may call ``close()`` on that object. botocore's
``EventStream.__iter__`` is a generator function: ``iter(stream)`` is not the
object ``close()`` releases the HTTP body on, and a bare ``for`` plus ``break``
never calls ``close()``.

The fake stream below has that shape. A self-iterating iterator would hide
both the missed span and the leaked connection.
"""

import gc

import pytest
from opentelemetry import context as context_api
from opentelemetry import trace as trace_api
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import (
    InMemorySpanExporter,
)
from opentelemetry.trace import StatusCode

from openlit._config import OpenlitConfig
from openlit.instrumentation.bedrock.bedrock import converse_stream
from openlit.semcov import SemanticConvention

REQUEST_KWARGS = {"modelId": "amazon.titan-text-express-v1"}


def _delta(text):
    return {
        "contentBlockDelta": {
            "delta": {"text": text},
            "contentBlockIndex": 0,
        }
    }


def _terminal_events():
    return [
        {"messageStop": {"stopReason": "end_turn"}},
        {
            "metadata": {
                "usage": {"inputTokens": 10, "outputTokens": 5, "totalTokens": 15},
                "metrics": {"latencyMs": 42},
            }
        },
    ]


class FakeEventStream:
    """botocore EventStream: ``__iter__`` yields, ``close()`` closes the body."""

    def __init__(self, events, raise_after=None):
        self._events = list(events)
        self._raise_after = raise_after
        self.closed = False
        self.iter_calls = 0

    def __iter__(self):
        self.iter_calls += 1
        for index, event in enumerate(self._events):
            if self.closed:
                return
            if self._raise_after is not None and index >= self._raise_after:
                raise RuntimeError("stream failed")
            yield event

    def close(self):
        """Record the HTTP-body close. Generator.close() must not be enough."""
        self.closed = True


class FakeClient:
    """Minimal stand-in for a bedrock-runtime client."""

    def __init__(self, stream):
        self.stream = stream
        self.calls = []

    def converse_stream(self, **kwargs):
        """Return a boto3-shaped streaming response."""
        self.calls.append(kwargs)
        return {"stream": self.stream, "ResponseMetadata": {"RequestId": "req-1"}}


def _tracer_and_exporter():
    OpenlitConfig.reset_to_defaults()
    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    return provider.get_tracer(__name__), exporter


def _client(tracer, events, raise_after=None, capture_message_content=True):
    wrapper = converse_stream(
        version="test",
        environment="test",
        application_name="test",
        tracer=tracer,
        pricing_info={},
        capture_message_content=capture_message_content,
        metrics=None,
        disable_metrics=True,
    )
    fake = FakeEventStream(events, raise_after=raise_after)
    raw = FakeClient(fake)
    client = wrapper(
        lambda *args, **kwargs: raw,
        None,
        (),
        {"service_name": "bedrock-runtime"},
    )
    return client, fake


def _finish_reasons(span):
    return tuple(span.attributes[SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON])


def _output(span):
    return span.attributes[SemanticConvention.GEN_AI_OUTPUT_MESSAGES]


def _assert_tokens(span):
    assert span.attributes[SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS] == 10
    assert span.attributes[SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS] == 5


def test_constructing_the_wrapper_does_not_read_or_close_the_stream():
    """``iter()`` in ``__init__`` would open a second generator over the body."""

    tracer, _exporter = _tracer_and_exporter()
    client, fake = _client(tracer, [_delta("partial"), _delta("answer")])

    response = client.converse_stream(**REQUEST_KWARGS)
    stream = response.get("stream")

    assert stream is response
    assert response["ResponseMetadata"]["RequestId"] == "req-1"
    assert fake.iter_calls == 0
    assert fake.closed is False


def test_break_on_response_stream_ends_span_and_closes_body():
    """The AWS sample loop must export one partial span and close the body."""

    tracer, exporter = _tracer_and_exporter()
    client, fake = _client(tracer, [_delta("partial"), _delta("answer")])

    response = client.converse_stream(**REQUEST_KWARGS)
    for event in response["stream"]:
        assert "partial" in event["contentBlockDelta"]["delta"]["text"]
        break

    del response
    gc.collect()

    assert fake.closed
    assert fake.iter_calls == 1
    spans = exporter.get_finished_spans()
    assert len(spans) == 1
    assert spans[0].status.status_code == StatusCode.OK
    assert _finish_reasons(spans[0]) == ("incomplete",)
    assert "partial" in _output(spans[0])
    assert "answer" not in _output(spans[0])


def test_get_stream_break_inside_with_ends_span():
    """``with`` plus ``response.get('stream')`` is the same iterator and span."""

    tracer, exporter = _tracer_and_exporter()
    client, fake = _client(tracer, [_delta("partial"), _delta("answer")])

    with client.converse_stream(**REQUEST_KWARGS) as response:
        stream = response.get("stream")
        assert stream is response
        for _event in stream:
            break

    assert fake.closed
    spans = exporter.get_finished_spans()
    assert len(spans) == 1
    assert spans[0].status.status_code == StatusCode.OK
    assert _finish_reasons(spans[0]) == ("incomplete",)
    assert "partial" in _output(spans[0])
    assert "answer" not in _output(spans[0])


def test_held_stream_stays_open_until_released():
    """Keeping the response must leave the next event readable."""

    tracer, exporter = _tracer_and_exporter()
    client, fake = _client(
        tracer, [_delta("one"), _delta("two"), _delta("three")]
    )

    response = client.converse_stream(**REQUEST_KWARGS)
    stream = response["stream"]
    for event in stream:
        assert event["contentBlockDelta"]["delta"]["text"] == "one"
        break

    assert not exporter.get_finished_spans()
    assert fake.closed is False
    assert next(stream)["contentBlockDelta"]["delta"]["text"] == "two"

    del response
    del stream
    gc.collect()

    assert fake.closed
    spans = exporter.get_finished_spans()
    assert len(spans) == 1
    assert _finish_reasons(spans[0]) == ("incomplete",)
    output = _output(spans[0])
    assert "one" in output
    assert "two" in output
    assert "three" not in output


def test_full_consumption_of_response_stream_exports_exactly_one_span():
    """StopIteration then close() must not emit a second span or rewrite the reason."""

    tracer, exporter = _tracer_and_exporter()
    events = [_delta("partial"), _delta(" answer"), *_terminal_events()]
    client, fake = _client(tracer, events)

    response = client.converse_stream(**REQUEST_KWARGS)
    for _event in response["stream"]:
        pass
    for _event in response["stream"]:
        pass
    response["stream"].close()

    assert fake.closed
    assert fake.iter_calls == 1
    spans = exporter.get_finished_spans()
    assert len(spans) == 1
    assert spans[0].status.status_code == StatusCode.OK
    assert _finish_reasons(spans[0]) == ("end_turn",)
    assert "partial answer" in _output(spans[0])
    _assert_tokens(spans[0])


def test_close_on_response_stream_finalizes_once():
    """``response['stream'].close()`` ends the span and the HTTP body."""

    tracer, exporter = _tracer_and_exporter()
    client, fake = _client(tracer, [_delta("partial"), _delta("answer")])

    response = client.converse_stream(**REQUEST_KWARGS)
    next(response["stream"])
    response["stream"].close()
    response.close()

    assert fake.closed
    spans = exporter.get_finished_spans()
    assert len(spans) == 1
    assert spans[0].status.status_code == StatusCode.OK
    assert _finish_reasons(spans[0]) == ("incomplete",)
    assert "partial" in _output(spans[0])
    assert "answer" not in _output(spans[0])


def test_caller_exception_inside_with_stays_ok():
    """A raise from user code is a cancel, not a Bedrock failure."""

    tracer, exporter = _tracer_and_exporter()
    client, fake = _client(tracer, [_delta("partial"), _delta("answer")])

    with pytest.raises(ValueError, match="caller"):
        with client.converse_stream(**REQUEST_KWARGS) as response:
            for _event in response["stream"]:
                raise ValueError("caller")

    assert fake.closed
    spans = exporter.get_finished_spans()
    assert len(spans) == 1
    assert spans[0].status.status_code == StatusCode.OK
    assert _finish_reasons(spans[0]) == ("incomplete",)
    assert SemanticConvention.ERROR_TYPE not in spans[0].attributes
    assert all(event.name != "exception" for event in spans[0].events)
    assert "partial" in _output(spans[0])
    assert "answer" not in _output(spans[0])


def test_stream_error_inside_with_marks_span_error():
    """A failure from the event stream is a failed span, with text already seen."""

    tracer, exporter = _tracer_and_exporter()
    client, fake = _client(
        tracer, [_delta("partial"), _delta("answer")], raise_after=1
    )

    with pytest.raises(RuntimeError, match="stream failed"):
        with client.converse_stream(**REQUEST_KWARGS) as response:
            for _event in response["stream"]:
                pass

    assert fake.closed
    spans = exporter.get_finished_spans()
    assert len(spans) == 1
    assert spans[0].status.status_code == StatusCode.ERROR
    assert spans[0].attributes[SemanticConvention.ERROR_TYPE] == "RuntimeError"
    assert _finish_reasons(spans[0]) == ("error",)
    assert "partial" in _output(spans[0])
    assert "answer" not in _output(spans[0])


def test_context_detached_after_early_break():
    """Finalizing the span must not leave it attached to the OTel context."""

    tracer, _exporter = _tracer_and_exporter()
    client, _fake = _client(tracer, [_delta("partial")])

    with client.converse_stream(**REQUEST_KWARGS) as response:
        next(response["stream"])

    assert (
        trace_api.get_current_span(context_api.get_current()) is trace_api.INVALID_SPAN
    )
