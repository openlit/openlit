"""Regression tests: Groq chat completions whose ``usage`` is null keep their span.

``usage`` is optional on the Groq SDK's ``ChatCompletion`` model and defaults
to ``None``, so ``response.model_dump()`` carries ``"usage": None`` both when
the API sends ``usage: null`` and when it leaves ``usage`` out.
``response_dict.get("usage", {})`` then returned ``None`` instead of the
default and the next ``.get`` raised ``AttributeError``. The span was exported
with an error status and none of the response attributes.

These tests drive the real sync and async wrapper factories with an SDK
response object built the way the SDK builds it, with no network and no API
key.
"""

from types import SimpleNamespace

import pytest
from groq.types.chat import ChatCompletion
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter
from opentelemetry.trace import StatusCode

from openlit._config import OpenlitConfig
from openlit.instrumentation.groq.async_groq import async_chat
from openlit.instrumentation.groq.groq import chat
from openlit.semcov import SemanticConvention

_CHAT_KWARGS = {
    "model": "llama-3.1-8b-instant",
    "messages": [{"role": "user", "content": "ping"}],
}


def _tracer_and_exporter():
    OpenlitConfig.reset_to_defaults()
    exporter = InMemorySpanExporter()
    tracer_provider = TracerProvider()
    tracer_provider.add_span_processor(SimpleSpanProcessor(exporter))
    return tracer_provider.get_tracer("test-groq-null-usage"), exporter


def _groq_instance():
    return SimpleNamespace(
        _client=SimpleNamespace(base_url="https://api.groq.com/openai/v1")
    )


def _wrapper(factory, tracer):
    return factory(
        version="test-version",
        environment="test-env",
        application_name="test-app",
        tracer=tracer,
        pricing_info={},
        capture_message_content=True,
        metrics=None,
        disable_metrics=True,
    )


def _returning(response):
    def fake_create(*_args, **_kwargs):
        return response

    return fake_create


def _async_returning(response):
    async def fake_create(*_args, **_kwargs):
        return response

    return fake_create


def _chat_completion(usage=None):
    response = ChatCompletion.construct(
        id="chatcmpl-1",
        object="chat.completion",
        created=1,
        model="llama-3.1-8b-instant",
        choices=[
            {
                "index": 0,
                "finish_reason": "stop",
                "message": {"role": "assistant", "content": "pong"},
            }
        ],
        usage=usage,
    )
    assert (response.model_dump()["usage"] is None) == (usage is None)
    return response


def _assert_chat_span(exporter, input_tokens, output_tokens):
    spans = exporter.get_finished_spans()
    assert len(spans) == 1
    span = spans[0]
    assert span.status.status_code == StatusCode.OK
    assert not [event for event in span.events if event.name == "exception"]

    attrs = span.attributes
    assert attrs[SemanticConvention.GEN_AI_RESPONSE_ID] == "chatcmpl-1"
    assert attrs[SemanticConvention.GEN_AI_RESPONSE_MODEL] == "llama-3.1-8b-instant"
    assert attrs[SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON] == ("stop",)
    assert attrs[SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS] == input_tokens
    assert attrs[SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS] == output_tokens


def test_sync_chat_completion_with_null_usage_keeps_response_attributes():
    """A chat completion without usage still yields a complete, OK span."""

    tracer, exporter = _tracer_and_exporter()
    wrapper = _wrapper(chat, tracer)
    response = _chat_completion()

    result = wrapper(_returning(response), _groq_instance(), [], _CHAT_KWARGS)

    assert result is response
    # Without reported usage the Groq instrumentation records both counts as 0.
    _assert_chat_span(exporter, input_tokens=0, output_tokens=0)


@pytest.mark.asyncio
async def test_async_chat_completion_with_null_usage_keeps_response_attributes():
    """Async twin of the sync chat completion test."""

    tracer, exporter = _tracer_and_exporter()
    wrapper = _wrapper(async_chat, tracer)
    response = _chat_completion()

    result = await wrapper(
        _async_returning(response), _groq_instance(), [], _CHAT_KWARGS
    )

    assert result is response
    # Without reported usage the Groq instrumentation records both counts as 0.
    _assert_chat_span(exporter, input_tokens=0, output_tokens=0)


def test_sync_chat_completion_with_usage_records_reported_tokens():
    """A chat completion that reports usage keeps the reported token counts."""

    tracer, exporter = _tracer_and_exporter()
    wrapper = _wrapper(chat, tracer)
    response = _chat_completion(
        usage={"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15}
    )

    result = wrapper(_returning(response), _groq_instance(), [], _CHAT_KWARGS)

    assert result is response
    _assert_chat_span(exporter, input_tokens=10, output_tokens=5)
