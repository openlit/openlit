"""Mock-transport regressions for lazy async chat responses (issue #1707)."""

import asyncio
import json

import httpx
import openai
import pytest
from opentelemetry import trace
from opentelemetry.trace import StatusCode
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter
from wrapt import FunctionWrapper

from openlit._config import OpenlitConfig
from openlit.instrumentation.openai.async_openai import async_chat_completions
from openlit.instrumentation.openai.openai import chat_completions


PAYLOAD = {
    "id": "chatcmpl-1",
    "object": "chat.completion",
    "created": 0,
    "model": "gpt-4o-mini",
    "choices": [{
        "index": 0,
        "message": {"role": "assistant", "content": "Hello there"},
        "finish_reason": "stop",
    }],
    "usage": {"prompt_tokens": 11, "completion_tokens": 5, "total_tokens": 16},
}
REQUEST = {"model": "gpt-4o-mini", "messages": [{"role": "user", "content": "hi"}]}


@pytest.fixture(name="exporter")
def response_exporter(monkeypatch):
    """Instrument real SDK resource methods with a local tracer provider."""
    OpenlitConfig.reset_to_defaults()
    spans = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(spans))
    options = {
        "version": openai.__version__,
        "environment": "test",
        "application_name": "test",
        "tracer": provider.get_tracer("raw-response-test"),
        "pricing_info": {},
        "capture_message_content": True,
        "metrics": None,
        "disable_metrics": True,
    }
    for resource, factory in (
        (openai.resources.chat.completions.Completions, chat_completions),
        (openai.resources.chat.completions.AsyncCompletions, async_chat_completions),
    ):
        monkeypatch.setattr(resource, "create", FunctionWrapper(resource.create, factory(**options)))
    yield spans
    provider.shutdown()


def assert_completion(exporter):
    """Every response attribute must reflect the actual completion."""
    spans = exporter.get_finished_spans()
    assert len(spans) == 1
    attrs = spans[0].attributes
    assert json.loads(attrs["gen_ai.output.messages"]) == [{
        "role": "assistant",
        "parts": [{"type": "text", "content": "Hello there"}],
        "finish_reason": "stop",
    }]
    assert attrs["gen_ai.response.finish_reasons"] == ("stop",)
    assert attrs["gen_ai.response.id"] == "chatcmpl-1"
    assert attrs["gen_ai.usage.input_tokens"] == 11
    assert attrs["gen_ai.usage.output_tokens"] == 5
    return attrs


@pytest.mark.parametrize("mode", ["normal", "with_raw_response", "with_streaming_response"])
@pytest.mark.parametrize("custom_target", [False, True])
def test_async_completion_matches_sync(exporter, mode, custom_target):
    """The real async response stays usable and produces sync-equivalent spans."""
    transport = httpx.MockTransport(lambda _: httpx.Response(200, json=PAYLOAD))
    with openai.OpenAI(api_key="x", http_client=httpx.Client(transport=transport)) as client:
        with client.chat.completions.with_streaming_response.create(**REQUEST) as response:
            assert response.parse().choices[0].message.content == "Hello there"
    expected = assert_completion(exporter)
    exporter.clear()

    async def run():
        async with openai.AsyncOpenAI(
            api_key="x", http_client=httpx.AsyncClient(transport=transport)
        ) as client:
            resource = client.chat.completions
            if mode == "normal":
                result = await resource.create(**REQUEST)
                assert result.choices[0].message.content == "Hello there"
            else:
                async def consume(response):
                    assert not exporter.get_finished_spans()
                    assert not trace.get_current_span().is_recording()
                    result = (
                        await response.parse(to=dict[str, object])
                        if custom_target else await response.parse()
                    )
                    if custom_target:
                        assert result["choices"][0]["message"]["content"] == "Hello there"
                        assert await response.parse(to=dict[str, object]) is result
                    else:
                        assert result.choices[0].message.content == "Hello there"
                        assert await response.parse() is result
                    assert await response.json() == PAYLOAD
                    assert_completion(exporter)

                if mode == "with_streaming_response":
                    async with resource.with_streaming_response.create(**REQUEST) as response:
                        await consume(response)
                    assert response.is_closed
                else:
                    response = await resource.with_raw_response.create(**REQUEST)
                    result = (
                        response.parse(to=dict[str, object])
                        if custom_target else response.parse()
                    )
                    if custom_target:
                        assert result["choices"][0]["message"]["content"] == "Hello there"
                    else:
                        assert result.choices[0].message.content == "Hello there"
            assert_completion(exporter)

    asyncio.run(run())
    actual = assert_completion(exporter)
    for key in (
        "gen_ai.output.messages", "gen_ai.response.finish_reasons",
        "gen_ai.response.id", "gen_ai.usage.input_tokens", "gen_ai.usage.output_tokens",
    ):
        assert actual[key] == expected[key]


@pytest.mark.parametrize("parse", [False, True])
def test_response_body_is_lazy_and_read_once(exporter, parse):
    """Only app parsing reads the body; close always ends exactly one span."""
    class Body(httpx.AsyncByteStream):
        """Count actual transport reads and track resource cleanup."""

        reads = 0
        closed = False

        async def __aiter__(self):
            self.reads += 1
            yield json.dumps(PAYLOAD).encode()

        async def aclose(self):
            self.closed = True

    body = Body()
    transport = httpx.MockTransport(lambda _: httpx.Response(
        200, headers={"content-type": "application/json"}, stream=body
    ))

    async def run():
        async with openai.AsyncOpenAI(
            api_key="x", http_client=httpx.AsyncClient(transport=transport)
        ) as client:
            async with client.chat.completions.with_streaming_response.create(**REQUEST) as response:
                assert not exporter.get_finished_spans()
                assert body.reads == 0
                if parse:
                    result = await response.parse()
                    assert await response.parse() is result
                    assert await response.json() == PAYLOAD
                    assert_completion(exporter)
        assert body.closed
        assert body.reads == int(parse)
        spans = exporter.get_finished_spans()
        assert len(spans) == 1
        if not parse:
            assert "gen_ai.output.messages" not in spans[0].attributes

    asyncio.run(run())


@pytest.mark.parametrize("failure", ["invalid_json", "read_error", "cancelled", "close_error"])
def test_response_failure_ends_span_and_preserves_error(exporter, failure):
    """Parsing/closing failures, including cancellation, must not leak spans."""
    class Body(httpx.AsyncByteStream):
        """Inject failures at the HTTP response lifecycle boundaries."""

        async def __aiter__(self):
            if failure == "read_error":
                raise httpx.ReadError("read failed")
            if failure == "cancelled":
                raise asyncio.CancelledError()
            yield b"invalid json" if failure == "invalid_json" else json.dumps(PAYLOAD).encode()

        async def aclose(self):
            if failure == "close_error":
                raise httpx.ReadError("close failed")

    transport = httpx.MockTransport(lambda _: httpx.Response(
        200, headers={"content-type": "application/json"}, stream=Body()
    ))
    error = {
        "invalid_json": json.JSONDecodeError,
        "read_error": httpx.ReadError,
        "cancelled": asyncio.CancelledError,
        "close_error": httpx.ReadError,
    }[failure]

    async def run():
        async with openai.AsyncOpenAI(
            api_key="x", http_client=httpx.AsyncClient(transport=transport)
        ) as client:
            with pytest.raises(error):
                async with client.chat.completions.with_streaming_response.create(**REQUEST) as response:
                    if failure != "close_error":
                        await response.parse()
        spans = exporter.get_finished_spans()
        assert len(spans) == 1
        assert spans[0].status.status_code == StatusCode.ERROR
        assert spans[0].attributes["error.type"] == error.__name__

    asyncio.run(run())
