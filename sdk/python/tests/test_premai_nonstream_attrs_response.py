# pylint: disable=protected-access, duplicate-code, missing-function-docstring, too-few-public-methods
"""Regression tests: premai >= 0.3.79 returns attrs objects from non-streaming
chat and embedding calls. `response_as_dict` returns those unchanged, so the
readers raised AttributeError on `.get` and the span was exported as ERROR
with no token usage.
"""

from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import (
    InMemorySpanExporter,
)
from opentelemetry.trace import StatusCode

from openlit._config import OpenlitConfig
from openlit.instrumentation.premai import premai as premai_mod
from openlit.semcov import SemanticConvention


class AttrsResponse:
    """Stand-in for a premai attrs response: no `.get`, only `to_dict`."""

    def __init__(self, payload):
        self._payload = payload

    def to_dict(self):
        return self._payload


def _tracer_with_exporter():
    OpenlitConfig.reset_to_defaults()
    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    return provider.get_tracer(__name__), exporter


def _only_span(exporter):
    spans = exporter.get_finished_spans()
    assert len(spans) == 1
    return spans[0]


def test_attrs_chat_response_exports_ok_span_with_usage():
    tracer, exporter = _tracer_with_exporter()
    wrapper = premai_mod.chat(
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
    response = AttrsResponse(
        {
            "id": "chatcmpl-1",
            "model": "gpt-4o-mini",
            "choices": [
                {"message": {"content": "hi"}, "finish_reason": "stop"},
            ],
            "usage": {"prompt_tokens": 10, "completion_tokens": 5},
        }
    )
    kwargs = {"model": "gpt-4o-mini", "messages": [{"role": "user", "content": "x"}]}

    result = wrapper(lambda *a, **k: response, None, (), kwargs)

    assert result is response
    span = _only_span(exporter)
    assert span.status.status_code != StatusCode.ERROR
    attrs = span.attributes
    assert attrs.get(SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS) == 10
    assert attrs.get(SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS) == 5
    assert attrs.get(SemanticConvention.GEN_AI_RESPONSE_ID) == "chatcmpl-1"
    assert list(attrs.get(SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON)) == ["stop"]


def test_attrs_embedding_response_exports_ok_span_with_usage():
    tracer, exporter = _tracer_with_exporter()
    wrapper = premai_mod.embedding(
        version="test",
        environment="test",
        application_name="test",
        tracer=tracer,
        pricing_info={},
        capture_message_content=True,
        metrics=None,
        disable_metrics=True,
    )
    response = AttrsResponse(
        {"model": "text-embedding-3-small", "usage": {"prompt_tokens": 7}}
    )

    result = wrapper(
        lambda *a, **k: response,
        None,
        (),
        {"model": "text-embedding-3-small", "input": "x"},
    )

    assert result is response
    span = _only_span(exporter)
    assert span.status.status_code != StatusCode.ERROR
    assert span.attributes.get(SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS) == 7


def test_embedding_without_usage_does_not_error():
    tracer, exporter = _tracer_with_exporter()
    wrapper = premai_mod.embedding(
        version="test",
        environment="test",
        application_name="test",
        tracer=tracer,
        pricing_info={},
        capture_message_content=True,
        metrics=None,
        disable_metrics=True,
    )
    response = AttrsResponse({"model": "m"})

    wrapper(lambda *a, **k: response, None, (), {"model": "m", "input": "x"})

    assert _only_span(exporter).status.status_code != StatusCode.ERROR
