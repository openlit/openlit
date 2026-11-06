"""Cohere chat spans must retain text following a thinking content block."""

import asyncio
import json

import cohere
import httpx
import pytest
from cohere.v2.types.v2chat_response import V2ChatResponse
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import (
    InMemorySpanExporter,
)
from opentelemetry.trace import StatusCode
from wrapt import FunctionWrapper

from openlit._config import OpenlitConfig
from openlit.instrumentation.cohere.async_cohere import async_chat
from openlit.instrumentation.cohere.cohere import chat
from openlit.semcov import SemanticConvention

MODEL = "command-a-reasoning-08-2025"
MESSAGES = [{"role": "user", "content": "What is the capital of France?"}]
THINKING = {"type": "thinking", "thinking": "The capital of France is Paris."}
TEXT = {"type": "text", "text": "Paris."}


@pytest.fixture(name="telemetry")
def exported_telemetry():
    """Export real spans without changing the global tracer provider."""
    OpenlitConfig.reset_to_defaults()
    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    yield provider.get_tracer(__name__), exporter
    provider.shutdown()
    OpenlitConfig.reset_to_defaults()


@pytest.mark.parametrize("is_async", [False, True], ids=["sync", "async"])
@pytest.mark.parametrize(
    "content,expected_text,capture,finish_reason",
    [
        pytest.param([THINKING, TEXT], "Paris.", True, "COMPLETE", id="thinking-then-text"),
        pytest.param(
            [{"type": "text", "text": "Par"}, {"type": "text", "text": "is."}],
            "Paris.", True, "COMPLETE", id="two-text-blocks",
        ),
        pytest.param([TEXT], "Paris.", True, "COMPLETE", id="text-only"),
        pytest.param([THINKING], "", True, "MAX_TOKENS", id="thinking-only"),
        pytest.param([THINKING, TEXT], "Paris.", False, "COMPLETE", id="capture-disabled"),
    ],
)
def test_chat_output_messages(
    monkeypatch, telemetry, is_async, content, expected_text, capture, finish_reason
):
    """Run the instrumented SDK client against a local HTTP response."""
    tracer, exporter = telemetry
    client_class = cohere.AsyncClientV2 if is_async else cohere.ClientV2
    factory = async_chat if is_async else chat
    wrapper = factory(
        version="test",
        environment="test",
        application_name="test",
        tracer=tracer,
        pricing_info={},
        capture_message_content=capture,
        metrics=None,
        disable_metrics=True,
    )
    monkeypatch.setattr(client_class, "chat", FunctionWrapper(client_class.chat, wrapper))
    requests = []

    def respond(request):
        requests.append(request)
        return httpx.Response(
            200,
            json={
                "id": "chat-test",
                "finish_reason": finish_reason,
                "message": {"role": "assistant", "content": content},
                "usage": {"billed_units": {"input_tokens": 11, "output_tokens": 7}},
            },
        )

    transport = httpx.MockTransport(respond)
    if is_async:
        async def call():
            async with httpx.AsyncClient(transport=transport, trust_env=False) as http_client:
                client = client_class(api_key="test-api-key", httpx_client=http_client)
                return await client.chat(model=MODEL, messages=MESSAGES)

        response = asyncio.run(call())
    else:
        with httpx.Client(transport=transport, trust_env=False) as http_client:
            client = client_class(api_key="test-api-key", httpx_client=http_client)
            response = client.chat(model=MODEL, messages=MESSAGES)

    assert len(requests) == 1
    assert requests[0].url.path == "/v2/chat"
    request_body = json.loads(requests[0].content)
    assert request_body["model"] == MODEL
    assert request_body["messages"] == MESSAGES
    assert isinstance(response, V2ChatResponse)
    assert response.id == "chat-test"
    assert response.finish_reason == finish_reason
    assert [block.model_dump(exclude_none=True) for block in response.message.content] == content
    assert response.usage.billed_units.input_tokens == 11
    assert response.usage.billed_units.output_tokens == 7

    spans = exporter.get_finished_spans()
    assert len(spans) == 1
    span = spans[0]
    assert span.status.status_code == StatusCode.OK
    assert span.attributes[SemanticConvention.GEN_AI_REQUEST_MODEL] == MODEL
    assert span.attributes[SemanticConvention.GEN_AI_RESPONSE_MODEL] == MODEL
    assert span.attributes[SemanticConvention.GEN_AI_RESPONSE_ID] == response.id
    assert span.attributes[SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS] == 11
    assert span.attributes[SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS] == 7
    if capture:
        output_messages = json.loads(span.attributes[SemanticConvention.GEN_AI_OUTPUT_MESSAGES])
        expected_parts = [{"type": "text", "content": expected_text}] if expected_text else []
        assert len(output_messages) == 1
        assert output_messages[0]["role"] == "assistant"
        assert output_messages[0]["parts"] == expected_parts
    else:
        assert SemanticConvention.GEN_AI_INPUT_MESSAGES not in span.attributes
        assert SemanticConvention.GEN_AI_OUTPUT_MESSAGES not in span.attributes
