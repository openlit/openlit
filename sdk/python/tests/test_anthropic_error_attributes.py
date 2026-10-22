# pylint: disable=missing-function-docstring, not-callable
"""Tests for Anthropic span attributes and metrics on provider call failures."""

import anthropic
import httpx
import pytest
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

from openlit.instrumentation.anthropic.anthropic import messages
from openlit.instrumentation.anthropic.async_anthropic import async_messages
from openlit._config import OpenlitConfig
from openlit.semcov import SemanticConvention

ANTHROPIC_ERROR = {
    "type": "error",
    "error": {"type": "invalid_request_error", "message": "bad"},
}


class _Recorder:
    def __init__(self):
        self.points = []

    def record(self, value, attributes=None):
        self.points.append((value, attributes))

    def add(self, value, attributes=None):
        self.points.append((value, attributes))


class _Metrics(dict):
    def __init__(self):
        super().__init__(genai_client_operation_duration=_Recorder())

    def __missing__(self, key):
        self[key] = _Recorder()
        return self[key]


def _tracer_and_exporter():
    OpenlitConfig.reset_to_defaults()
    exporter = InMemorySpanExporter()
    tracer_provider = TracerProvider()
    tracer_provider.add_span_processor(SimpleSpanProcessor(exporter))
    return tracer_provider.get_tracer("test-anthropic-errors"), exporter


def _wrapper_kwargs(tracer, metrics):
    return {
        "version": "test-version",
        "environment": "test-env",
        "application_name": "test-app",
        "tracer": tracer,
        "pricing_info": {},
        "capture_message_content": False,
        "metrics": metrics,
        "disable_metrics": False,
    }


def _messages_kwargs():
    return {
        "model": "claude-3-5-sonnet-latest",
        "messages": [{"role": "user", "content": "ping"}],
        "temperature": 0.3,
        "top_p": 0.8,
        "top_k": 5,
        "max_tokens": 64,
        "stop_sequences": ["END"],
    }


def _transport():
    return httpx.MockTransport(
        lambda request: httpx.Response(400, json=ANTHROPIC_ERROR)
    )


def _assert_failed_messages_span(exporter, metrics):
    spans = exporter.get_finished_spans()
    assert len(spans) == 1
    span = spans[0]
    attrs = span.attributes

    assert attrs[SemanticConvention.GEN_AI_OPERATION] == (
        SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT
    )
    assert attrs[SemanticConvention.GEN_AI_PROVIDER_NAME] == (
        SemanticConvention.GEN_AI_SYSTEM_ANTHROPIC
    )
    assert attrs[SemanticConvention.GEN_AI_REQUEST_MODEL] == "claude-3-5-sonnet-latest"
    assert attrs[SemanticConvention.GEN_AI_REQUEST_IS_STREAM] is False
    assert attrs[SemanticConvention.ERROR_TYPE] == "BadRequestError"
    assert attrs[SemanticConvention.GEN_AI_REQUEST_TEMPERATURE] == 0.3
    assert attrs[SemanticConvention.GEN_AI_REQUEST_TOP_P] == 0.8
    assert attrs[SemanticConvention.GEN_AI_REQUEST_TOP_K] == 5
    assert attrs[SemanticConvention.GEN_AI_REQUEST_MAX_TOKENS] == 64
    assert tuple(attrs[SemanticConvention.GEN_AI_REQUEST_STOP_SEQUENCES]) == ("END",)
    assert sum(event.name == "exception" for event in span.events) == 1

    points = metrics["genai_client_operation_duration"].points
    assert len(points) == 1
    assert points[0][1][SemanticConvention.ERROR_TYPE] == "BadRequestError"


def test_sync_messages_error_keeps_request_span_attributes():
    """Verify sync messages errors keep request span attributes and duration."""

    tracer, exporter = _tracer_and_exporter()
    metrics = _Metrics()
    wrapper = messages(**_wrapper_kwargs(tracer, metrics))
    client = anthropic.Anthropic(
        api_key="test", max_retries=0, http_client=httpx.Client(transport=_transport())
    )

    with pytest.raises(anthropic.BadRequestError):
        wrapper(client.messages.create, client.messages, [], _messages_kwargs())

    _assert_failed_messages_span(exporter, metrics)


@pytest.mark.asyncio
async def test_async_messages_error_keeps_request_span_attributes():
    """Verify async messages errors keep request span attributes and duration."""

    tracer, exporter = _tracer_and_exporter()
    metrics = _Metrics()
    wrapper = async_messages(**_wrapper_kwargs(tracer, metrics))
    client = anthropic.AsyncAnthropic(
        api_key="test",
        max_retries=0,
        http_client=httpx.AsyncClient(transport=_transport()),
    )

    with pytest.raises(anthropic.BadRequestError):
        await wrapper(client.messages.create, client.messages, [], _messages_kwargs())

    _assert_failed_messages_span(exporter, metrics)
