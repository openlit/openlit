# pylint: disable=protected-access, duplicate-code, missing-function-docstring, missing-class-docstring, too-few-public-methods
"""Hermetic tests for TypeSafe System One instrumentation."""

import os

import pytest
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import (
    InMemorySpanExporter,
)
from opentelemetry.trace import StatusCode

from openlit._config import OpenlitConfig
from openlit.instrumentation.typesafe.async_typesafe import async_system_one
from openlit.instrumentation.typesafe.typesafe import system_one
from openlit.semcov import SemanticConvention


def _tracer_with_exporter():
    OpenlitConfig.reset_to_defaults()
    OpenlitConfig.disable_events = True
    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    return provider.get_tracer(__name__), exporter


class FakeResponse:
    def __init__(self):
        self.model = "jev-1.13.0"
        self.request_id = "req_123"
        self.answers = {
            "hallucination": {"type": "noul", "noul": 0.1},
            "relevance": {
                "type": "score",
                "score": 1,
                "confidence": 0.8,
                "probabilities": {"none": 0.2, "minor": 0.8},
            },
        }
        self.usage = type("Usage", (), {"input_tokens": 12, "output_tokens": 3})()

    def model_dump(self, **_kwargs):
        return {
            "model": self.model,
            "request_id": self.request_id,
            "answers": self.answers,
            "usage": {
                "input_tokens": self.usage.input_tokens,
                "output_tokens": self.usage.output_tokens,
            },
        }


class FakeClient:
    default_model = "jev-latest"
    base_url = "https://api.typesafe.ai"

    def system_one(self, state, questions, model=None):
        return FakeResponse()


class FakeAsyncClient:
    default_model = "jev-latest"
    base_url = "https://api.typesafe.ai"

    async def system_one(self, state, questions, model=None):
        return FakeResponse()


QUESTIONS = {
    "hallucination": {"type": "noul", "instructions": "flag invented claims"},
    "relevance": {"type": "score", "instructions": "stay on topic"},
}


def _assert_decision_span(span):
    attrs = span.attributes
    assert span.name == "decision jev-latest"
    assert (
        attrs[SemanticConvention.GEN_AI_OPERATION]
        == SemanticConvention.GEN_AI_OPERATION_TYPE_DECISION
    )
    assert (
        attrs[SemanticConvention.GEN_AI_PROVIDER_NAME]
        == SemanticConvention.GEN_AI_SYSTEM_TYPESAFE
    )
    assert attrs[SemanticConvention.GEN_AI_REQUEST_MODEL] == "jev-latest"
    assert attrs[SemanticConvention.SERVER_ADDRESS] == "api.typesafe.ai"
    assert attrs[SemanticConvention.SERVER_PORT] == 443
    assert attrs[SemanticConvention.GEN_AI_REQUEST_IS_STREAM] is False
    assert attrs[SemanticConvention.GEN_AI_OUTPUT_TYPE] == "json"
    assert attrs[SemanticConvention.GEN_AI_RESPONSE_MODEL] == "jev-1.13.0"
    assert attrs[SemanticConvention.GEN_AI_RESPONSE_ID] == "req_123"
    assert attrs[SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS] == 12
    assert attrs[SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS] == 3
    assert attrs[SemanticConvention.GEN_AI_CLIENT_TOKEN_USAGE] == 15
    assert list(attrs[SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON]) == ["stop"]
    assert attrs[SemanticConvention.GEN_AI_SERVER_TBT] == 0
    assert attrs[SemanticConvention.GEN_AI_SERVER_TTFT] >= 0
    assert attrs[SemanticConvention.TYPESAFE_API_TYPE] == "system_one"
    assert attrs[SemanticConvention.TYPESAFE_QUESTION_COUNT] == 2
    assert "hallucination" in attrs[SemanticConvention.TYPESAFE_QUESTION_IDS]
    assert "noul" in attrs[SemanticConvention.TYPESAFE_QUESTION_TYPES]
    assert SemanticConvention.GEN_AI_REQUEST_TEMPERATURE not in attrs


def test_sync_system_one_span():
    tracer, exporter = _tracer_with_exporter()
    wrapper = system_one(
        version="0.6.0",
        environment="test",
        application_name="test",
        tracer=tracer,
        pricing_info={},
        capture_message_content=True,
        metrics=None,
        disable_metrics=True,
    )
    client = FakeClient()
    result = wrapper(client.system_one, client, ("hello", QUESTIONS), {})
    assert result.model == "jev-1.13.0"
    spans = exporter.get_finished_spans()
    assert len(spans) == 1
    _assert_decision_span(spans[0])
    input_messages = spans[0].attributes[SemanticConvention.GEN_AI_INPUT_MESSAGES]
    assert "hello" in input_messages
    assert "questions" in input_messages


def test_sync_system_one_skips_null_token_attributes():
    tracer, exporter = _tracer_with_exporter()
    wrapper = system_one(
        version="0.6.0",
        environment="test",
        application_name="test",
        tracer=tracer,
        pricing_info={},
        capture_message_content=False,
        metrics=None,
        disable_metrics=True,
    )

    class NoUsageResponse:
        model = "jev-latest"
        answers = {"ok": {"type": "noul", "noul": 0}}
        usage = type("Usage", (), {"input_tokens": None, "output_tokens": None})()

        def model_dump(self, **_kwargs):
            return {
                "model": self.model,
                "answers": self.answers,
                "usage": {"input_tokens": None, "output_tokens": None},
            }

    class Client:
        default_model = "jev-latest"
        base_url = "https://api.typesafe.ai"

        def system_one(self, *_a, **_k):
            return NoUsageResponse()

    wrapper(Client().system_one, Client(), ("x", QUESTIONS), {})
    attrs = exporter.get_finished_spans()[0].attributes
    assert SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS not in attrs
    assert SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS not in attrs
    assert SemanticConvention.GEN_AI_USAGE_COST not in attrs
    assert SemanticConvention.GEN_AI_CLIENT_TOKEN_USAGE not in attrs


def test_instrumentor_depends_on_typesafe_sdk():
    from openlit.instrumentation.typesafe import TypeSafeInstrumentor

    deps = TypeSafeInstrumentor().instrumentation_dependencies()
    assert "typesafe-sdk >= 0.6.0" in deps


def test_sync_system_one_omits_bodies_when_capture_off():
    tracer, exporter = _tracer_with_exporter()
    wrapper = system_one(
        version="0.6.0",
        environment="test",
        application_name="test",
        tracer=tracer,
        pricing_info={},
        capture_message_content=False,
        metrics=None,
        disable_metrics=True,
    )
    client = FakeClient()
    wrapper(client.system_one, client, (), {"state": "hello", "questions": QUESTIONS})
    attrs = exporter.get_finished_spans()[0].attributes
    assert SemanticConvention.GEN_AI_INPUT_MESSAGES not in attrs
    assert SemanticConvention.GEN_AI_OUTPUT_MESSAGES not in attrs
    assert attrs[SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS] == 12


def test_sync_system_one_records_error_type():
    tracer, exporter = _tracer_with_exporter()
    wrapper = system_one(
        version="0.6.0",
        environment="test",
        application_name="test",
        tracer=tracer,
        pricing_info={},
        capture_message_content=False,
        metrics=None,
        disable_metrics=True,
    )

    class BoomClient:
        default_model = "jev-latest"
        base_url = "https://api.typesafe.ai"

        def system_one(self, *_a, **_k):
            raise RuntimeError("nope")

    client = BoomClient()
    with pytest.raises(RuntimeError):
        wrapper(client.system_one, client, ("x", {}), {})
    span = exporter.get_finished_spans()[0]
    assert span.status.status_code == StatusCode.ERROR
    assert span.attributes[SemanticConvention.ERROR_TYPE] == "RuntimeError"


@pytest.mark.asyncio
async def test_async_system_one_span():
    tracer, exporter = _tracer_with_exporter()
    wrapper = async_system_one(
        version="0.6.0",
        environment="test",
        application_name="test",
        tracer=tracer,
        pricing_info={},
        capture_message_content=False,
        metrics=None,
        disable_metrics=True,
    )
    client = FakeAsyncClient()
    result = await wrapper(client.system_one, client, ("hello", QUESTIONS), {})
    assert result.request_id == "req_123"
    spans = exporter.get_finished_spans()
    assert len(spans) == 1
    _assert_decision_span(spans[0])


@pytest.mark.skipif(
    not os.getenv("TYPESAFE_API_KEY"), reason="TYPESAFE_API_KEY not set"
)
def test_live_typesafe_system_one():
    typesafe_sdk = pytest.importorskip("typesafe_sdk")
    import openlit

    openlit.init(environment="openlit-testing", application_name="openlit-python-test")
    client = typesafe_sdk.TypeSafeClient()
    response = client.system_one(
        state="OpenLIT monitors LLM applications.",
        questions={
            "ok": {
                "type": "noul",
                "instructions": "Return whether this is a coherent statement.",
            }
        },
        model="jev-latest",
    )
    assert getattr(response, "answers", None) or (
        isinstance(response, dict) and response.get("answers")
    )
