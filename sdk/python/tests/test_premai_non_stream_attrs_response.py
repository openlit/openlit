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

from unittest.mock import Mock

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


@pytest.mark.parametrize("usage", ["missing", None, {}, {"total_tokens": 7}, {"prompt_tokens": None}])
@pytest.mark.parametrize("as_dict", [False, True])
def test_embedding_response_without_usage_is_not_an_error(usage, as_dict):
    tracer, exporter = _tracer_with_exporter()
    payload = {k: v for k, v in EMBED_RESPONSE.items() if k != "usage"}
    if usage != "missing":
        payload["usage"] = usage
    response = payload if as_dict else AttrsResponse(payload)
    metrics = {
        name: Mock() for name in (
            "genai_client_usage_tokens", "genai_client_operation_duration", "genai_cost"
        )
    }
    options = {
        **_common(tracer),
        "metrics": metrics,
        "disable_metrics": False,
        "pricing_info": {"embeddings": {EMBED_KWARGS["model"]: 0.1}},
    }

    returned = premai_mod.embedding(**options)(lambda *a, **k: response, None, (), EMBED_KWARGS)

    assert returned is response
    span = _one_finished_span(exporter)
    assert span.status.status_code == StatusCode.OK, span.status.description
    for attribute in (
        SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS,
        SemanticConvention.GEN_AI_CLIENT_TOKEN_USAGE,
        SemanticConvention.GEN_AI_USAGE_COST,
    ):
        assert attribute not in span.attributes
    metrics["genai_client_usage_tokens"].record.assert_not_called()
    metrics["genai_cost"].record.assert_not_called()
    metrics["genai_client_operation_duration"].record.assert_called_once()


@pytest.mark.parametrize("tokens", [0, 7])
def test_embedding_reported_usage_records_cost_and_duration(tokens):
    tracer, exporter = _tracer_with_exporter()
    response = AttrsResponse({**EMBED_RESPONSE, "usage": {"prompt_tokens": tokens}})
    metrics = {
        name: Mock() for name in (
            "genai_client_usage_tokens", "genai_client_operation_duration", "genai_cost"
        )
    }
    options = {
        **_common(tracer),
        "metrics": metrics,
        "disable_metrics": False,
        "pricing_info": {"embeddings": {EMBED_KWARGS["model"]: 0.1}},
    }

    returned = premai_mod.embedding(**options)(lambda *a, **k: response, None, (), EMBED_KWARGS)

    assert returned is response
    span = _one_finished_span(exporter)
    assert span.status.status_code == StatusCode.OK
    assert span.attributes[SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS] == tokens
    assert span.attributes[SemanticConvention.GEN_AI_CLIENT_TOKEN_USAGE] == tokens
    assert span.attributes[SemanticConvention.GEN_AI_USAGE_COST] == pytest.approx(tokens / 1000 * 0.1)
    assert metrics["genai_cost"].record.call_args.args[0] == pytest.approx(tokens / 1000 * 0.1)
    metrics["genai_client_operation_duration"].record.assert_called_once()
    if tokens:
        assert metrics["genai_client_usage_tokens"].record.call_args.args[0] == tokens


@pytest.mark.parametrize("factory, kwargs", [(_chat, CHAT_KWARGS), (_embedding, EMBED_KWARGS)])
@pytest.mark.parametrize("invalid_mapping", [False, True])
def test_conversion_failure_marks_span_error_and_preserves_response(factory, kwargs, invalid_mapping):
    tracer, exporter = _tracer_with_exporter()
    response = Mock(spec=["to_dict"])
    if invalid_mapping:
        response.to_dict.return_value = []
        error_type = "TypeError"
    else:
        response.to_dict.side_effect = ValueError("cannot convert response")
        error_type = "ValueError"

    returned = factory(tracer)(lambda *a, **k: response, None, (), kwargs)

    assert returned is response
    span = _one_finished_span(exporter)
    assert span.status.status_code == StatusCode.ERROR
    assert span.attributes[SemanticConvention.ERROR_TYPE] == error_type
    assert any(event.name == "exception" for event in span.events)
    assert SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS not in span.attributes


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
