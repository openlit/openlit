"""Cohere's typed request messages retain their text in captured telemetry."""

import asyncio
import json

import cohere
import httpx
import pytest
import wrapt
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import (
    InMemorySpanExporter,
)

from openlit._config import OpenlitConfig
from openlit.instrumentation.cohere.async_cohere import async_chat
from openlit.instrumentation.cohere.cohere import chat
from openlit.instrumentation.cohere.utils import build_input_messages


def _message(typed):
    content = [
        {"type": "text", "text": "First block"},
        {
            "type": "image_url",
            "image_url": {"url": "https://example.com/image.png"},
        },
        {"type": "text", "text": "Second block"},
    ]
    if typed:
        return cohere.UserChatMessageV2(
            content=[
                cohere.TextContent(text="First block"),
                content[1],
                cohere.TextContent(text="Second block"),
            ]
        )
    return {"role": "user", "content": content}


def _expected_messages():
    return [
        {
            "role": "user",
            "parts": [
                {"type": "text", "content": "First block"},
                {"type": "text", "content": "Second block"},
            ],
        }
    ]


@pytest.mark.parametrize("typed", [False, True], ids=["dict", "cohere-model"])
def test_build_input_messages_preserves_text_blocks_and_omits_images(typed):
    """Typed and dictionary blocks have the same ordered text representation."""
    assert build_input_messages([_message(typed)]) == _expected_messages()


def test_build_input_messages_preserves_plain_string_content():
    """The existing string-content representation remains unchanged."""
    assert build_input_messages([{"role": "user", "content": "hello"}]) == [
        {"role": "user", "parts": [{"type": "text", "content": "hello"}]}
    ]


@pytest.mark.parametrize("typed", [False, True], ids=["dict", "cohere-model"])
@pytest.mark.parametrize("asynchronous", [False, True], ids=["sync", "async"])
def test_client_v2_captures_text_blocks_in_input_messages(
    monkeypatch, typed, asynchronous
):
    """Real Cohere clients serialize a request and export its captured text."""
    OpenlitConfig.reset_to_defaults()
    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    tracer = provider.get_tracer("test-cohere-input-messages")
    wrapper_factory = async_chat if asynchronous else chat
    wrapper = wrapper_factory(
        version=cohere.__version__,
        environment="test-env",
        application_name="test-app",
        tracer=tracer,
        pricing_info={},
        capture_message_content=True,
        metrics=None,
        disable_metrics=True,
    )
    client_type = cohere.AsyncClientV2 if asynchronous else cohere.ClientV2
    monkeypatch.setattr(
        client_type, "chat", wrapt.FunctionWrapper(client_type.chat, wrapper)
    )
    requests = []

    def respond(request):
        requests.append(json.loads(request.content))
        assert request.url.path == "/v2/chat"
        return httpx.Response(
            200,
            json={
                "id": "response-id",
                "finish_reason": "COMPLETE",
                "message": {
                    "role": "assistant",
                    "content": [{"type": "text", "text": "reply"}],
                },
                "usage": {
                    "tokens": {"input_tokens": 2, "output_tokens": 1},
                    "billed_units": {"input_tokens": 2, "output_tokens": 1},
                },
            },
        )

    transport = httpx.MockTransport(respond)
    kwargs = {"model": "command-r-plus-08-2024", "messages": [_message(typed)]}
    try:
        if asynchronous:

            async def call():
                async with httpx.AsyncClient(
                    transport=transport, trust_env=False
                ) as http_client:
                    client = cohere.AsyncClientV2(
                        api_key="test-api-key", httpx_client=http_client
                    )
                    return await client.chat(**kwargs)

            response = asyncio.run(call())
        else:
            with httpx.Client(transport=transport, trust_env=False) as http_client:
                client = cohere.ClientV2(
                    api_key="test-api-key", httpx_client=http_client
                )
                response = client.chat(**kwargs)

        assert response.message.content[0].text == "reply"
        assert len(requests) == 1
        assert requests[0]["messages"][0]["content"][0]["text"] == "First block"
        assert requests[0]["messages"][0]["content"][2]["text"] == "Second block"
        spans = exporter.get_finished_spans()
        assert len(spans) == 1
        assert json.loads(spans[0].attributes["gen_ai.input.messages"]) == (
            _expected_messages()
        )
    finally:
        provider.shutdown()
        OpenlitConfig.reset_to_defaults()
