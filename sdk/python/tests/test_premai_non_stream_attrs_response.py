# pylint: disable=protected-access, duplicate-code, missing-function-docstring, too-few-public-methods
"""Regression tests: premai non-streaming chat and embedding spans must read
attrs responses.

premai 0.3 returns attrs objects (`ChatCompletionResponse`,
`EmbeddingsResponse`) with `to_dict`, not dicts or pydantic models.
`response_as_dict` returns those unchanged, so `process_chat_response` and
`process_embedding_response` called `.get` on the attrs object, raised
AttributeError, and every successful call exported an ERROR span with no
token usage. The streaming reader already mapped chunks through `to_dict`.
"""

import pytest
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import (
    InMemorySpanExporter,
)
from opentelemetry.trace import StatusCode

from openlit._config import OpenlitConfig
from openlit.instrumentation.premai import premai as premai_mod
from openlit.semcov import SemanticConvention

CHAT_KWARGS = {
    "model": "gpt-4o-mini",
    "messages": [{"role": "user", "content": "Monitor LLM Applications"}],
}

EMBED_KWARGS = {"model": "text-embedding-3-large", "input": "Monitor LLM Applications"}

# The wire shape premai's to_dict returns: additional_properties such as `id`
# are merged into the top level.
CHAT_RESPONSE = {
    "id": "chatcmpl-1",
    "choices": [
        {
            "index": 0,
            "message": {"role": "assistant", "content": "an answer"},
            "finish_reason": "stop",
        }
    ],
    "created": 1730419200,
    "model": "gpt-4o-mini",
    "provider_name": "OpenAI",
    "provider_id": "openai",
    "usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15},
    "trace_id": "trace-1",
}

EMBED_RESPONSE = {
    "data": [{"index": 0, "embedding": [0.1, 0.2, 0.3]}],
    "model": "text-embedding-3-large",
    "usage": {"prompt_tokens": 7, "total_tokens": 7},
    "provider_name": "OpenAI",
    "provider_id": "openai",
}


class AttrsResponse:
    """Stand-in for a premai attrs response. `to_dict` returns the wire dict."""

    def __init__(self, payload):
        self._payload = payload

    def to_dict(self):
        """Return the response the non-streaming readers expect."""
        return self._payload


def _tracer_with_exporter():
    OpenlitConfig.reset_to_defaults()
    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    return provider.get_tracer(__name__), exporter


def _common(tracer):
    return {
        "version": "test",
        "environment": "test",
        "application_name": "test",
        "tracer": tracer,
        "pricing_info": {},
        "capture_message_content": True,
        "metrics": None,
        "disable_metrics": True,
    }


def _chat(tracer):
    return premai_mod.chat(event_provider=None, **_common(tracer))


def _embedding(tracer):
    return premai_mod.embedding(**_common(tracer))


def _one_finished_span(exporter):
    spans = exporter.get_finished_spans()
    assert len(spans) == 1, f"expected exactly one span, got {len(spans)}"
    return spans[0]


def _assert_chat_span(span):
    attrs = span.attributes
    assert span.status.status_code == StatusCode.OK, span.status.description
    assert attrs.get(SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS) == 10
    assert attrs.get(SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS) == 5
    assert attrs.get(SemanticConvention.GEN_AI_RESPONSE_ID) == "chatcmpl-1"
    assert list(attrs.get(SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON)) == [
        "stop"
    ]
    assert attrs.get(SemanticConvention.GEN_AI_RESPONSE_MODEL) == "gpt-4o-mini"


def test_attrs_chat_response_exports_an_ok_span_with_usage():
    tracer, exporter = _tracer_with_exporter()
    response = AttrsResponse(CHAT_RESPONSE)

    returned = _chat(tracer)(lambda *a, **k: response, None, (), CHAT_KWARGS)

    assert returned is response, "the caller must get the response unchanged"
    _assert_chat_span(_one_finished_span(exporter))


def test_dict_chat_response_still_works():
    tracer, exporter = _tracer_with_exporter()

    _chat(tracer)(lambda *a, **k: dict(CHAT_RESPONSE), None, (), CHAT_KWARGS)

    _assert_chat_span(_one_finished_span(exporter))


def test_chat_response_id_falls_back_to_additional_properties():
    """Dicts that keep the id under additional_properties still get it."""
    tracer, exporter = _tracer_with_exporter()
    payload = {k: v for k, v in CHAT_RESPONSE.items() if k != "id"}
    payload["additional_properties"] = {"id": "chatcmpl-1"}

    _chat(tracer)(lambda *a, **k: payload, None, (), CHAT_KWARGS)

    _assert_chat_span(_one_finished_span(exporter))


def test_attrs_embedding_response_exports_an_ok_span_with_usage():
    tracer, exporter = _tracer_with_exporter()
    response = AttrsResponse(EMBED_RESPONSE)

    returned = _embedding(tracer)(lambda *a, **k: response, None, (), EMBED_KWARGS)

    assert returned is response
    span = _one_finished_span(exporter)
    assert span.status.status_code == StatusCode.OK, span.status.description
    assert span.attributes.get(SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS) == 7
    assert (
        span.attributes.get(SemanticConvention.GEN_AI_RESPONSE_MODEL)
        == "text-embedding-3-large"
    )


def test_embedding_response_without_usage_is_not_an_error():
    tracer, exporter = _tracer_with_exporter()
    payload = {k: v for k, v in EMBED_RESPONSE.items() if k != "usage"}

    _embedding(tracer)(lambda *a, **k: AttrsResponse(payload), None, (), EMBED_KWARGS)

    span = _one_finished_span(exporter)
    assert span.status.status_code == StatusCode.OK, span.status.description
    assert span.attributes.get(SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS) == 0


def test_real_0_3_attrs_responses_export_ok_spans():
    """Build the real premai 0.3 models, when that SDK is installed."""
    pytest.importorskip("premai")
    try:
        from premai.models import ChatCompletionResponse, EmbeddingsResponse
    except ImportError:
        pytest.skip("premai.models is the 0.3 client; this install is newer")

    tracer, exporter = _tracer_with_exporter()
    chat_response = ChatCompletionResponse.from_dict(CHAT_RESPONSE)
    _chat(tracer)(lambda *a, **k: chat_response, None, (), CHAT_KWARGS)
    _assert_chat_span(_one_finished_span(exporter))

    tracer, exporter = _tracer_with_exporter()
    embed_response = EmbeddingsResponse.from_dict(EMBED_RESPONSE)
    _embedding(tracer)(lambda *a, **k: embed_response, None, (), EMBED_KWARGS)
    span = _one_finished_span(exporter)
    assert span.status.status_code == StatusCode.OK, span.status.description
    assert span.attributes.get(SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS) == 7
