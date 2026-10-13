"""CrewAI native OpenAI calls own the LLM span and suppress the provider span."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter
from opentelemetry.trace import StatusCode

from openlit._config import OpenlitConfig
from openlit.__helpers import (
    is_framework_llm_active,
    reset_framework_llm_active,
    set_framework_llm_active,
)
from openlit.instrumentation.crewai.openai_llm import (
    async_openai_completion_call,
    openai_completion_call,
)
from openlit.instrumentation.openai.async_openai import async_responses
from openlit.instrumentation.openai.openai import chat_completions, responses
from openlit.semcov import SemanticConvention


def _tracer():
    """Return a tracer and the exporter that receives its ended spans."""
    OpenlitConfig.reset_to_defaults()
    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    return provider.get_tracer("test-crewai-openai-llm"), exporter


def _config(tracer, capture=False):
    """Return the wrapper arguments the CrewAI instrumentor would pass."""
    return {
        "version": "test-version",
        "environment": "test-env",
        "application_name": "test-app",
        "tracer": tracer,
        "pricing_info": {},
        "capture_message_content": capture,
        "metrics": None,
        "disable_metrics": True,
    }


def _llm():
    """Return a stand-in for OpenAICompletion with cumulative token counters."""
    return SimpleNamespace(
        model="openai/gpt-4o",
        stream=False,
        api="responses",
        _token_usage={
            "prompt_tokens": 4,
            "completion_tokens": 1,
            "reasoning_tokens": 0,
            "cached_prompt_tokens": 0,
            "cache_creation_tokens": 0,
        },
    )


def _provider_wrapper(factory, tracer):
    """Build an OpenAI provider wrapper with the same tracer."""
    return factory(**_config(tracer))


def test_call_parents_llm_span_and_skips_responses_span():
    """The Responses wrapper must not open a span while the crew call owns it."""
    tracer, exporter = _tracer()
    crew = openai_completion_call(**_config(tracer, capture=True))
    provider = _provider_wrapper(responses, tracer)
    instance = _llm()

    def wrapped(*_args, **_kwargs):
        assert is_framework_llm_active()
        instance._token_usage["prompt_tokens"] += 11
        instance._token_usage["completion_tokens"] += 7
        instance._token_usage["reasoning_tokens"] += 2
        sentinel = object()
        result = provider(
            Mock(return_value=sentinel),
            object(),
            (),
            {"model": "gpt-4o", "stream": True},
        )
        assert result is sentinel
        return "from the model"

    with tracer.start_as_current_span("invoke_agent researcher") as task:
        result = crew(wrapped, instance, ("hello crew",), {})
        spans = exporter.get_finished_spans()
        assert len(spans) == 1
        llm = spans[0]
        assert llm.parent.span_id == task.get_span_context().span_id

    assert result == "from the model"
    assert is_framework_llm_active() is False
    assert llm.name == "chat openai/gpt-4o"
    assert llm.attributes[SemanticConvention.GEN_AI_REQUEST_MODEL] == "openai/gpt-4o"
    assert llm.attributes[SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS] == 11
    assert llm.attributes[SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS] == 7
    assert llm.attributes[SemanticConvention.GEN_AI_USAGE_REASONING_OUTPUT_TOKENS] == 2
    assert llm.attributes[SemanticConvention.OPENAI_API_TYPE] == "responses"
    assert llm.attributes[SemanticConvention.SERVER_ADDRESS] == "api.openai.com"
    assert "hello crew" in llm.attributes[SemanticConvention.GEN_AI_INPUT_MESSAGES]
    assert "from the model" in llm.attributes[SemanticConvention.GEN_AI_OUTPUT_MESSAGES]


def test_call_skips_chat_completions_span_too():
    """Chat completions on the same native client follow the same flag."""
    tracer, exporter = _tracer()
    crew = openai_completion_call(**_config(tracer))
    provider = _provider_wrapper(chat_completions, tracer)
    instance = _llm()
    instance.api = "completions"

    def wrapped(*_args, **_kwargs):
        sentinel = object()
        result = provider(
            Mock(return_value=sentinel),
            object(),
            (),
            {"model": "gpt-4o", "stream": False},
        )
        assert result is sentinel
        return "chat text"

    crew(wrapped, instance, ("hi",), {})

    spans = exporter.get_finished_spans()
    assert len(spans) == 1
    assert spans[0].name == "chat openai/gpt-4o"
    assert spans[0].attributes[SemanticConvention.OPENAI_API_TYPE] == "chat_completions"
    assert SemanticConvention.GEN_AI_INPUT_MESSAGES not in spans[0].attributes


def test_usage_delta_ignores_earlier_calls_on_the_same_instance():
    """Lifetime counters on the LLM must not be copied onto the next span."""
    tracer, exporter = _tracer()
    crew = openai_completion_call(**_config(tracer))
    instance = _llm()

    def wrapped(*_args, **_kwargs):
        instance._token_usage["prompt_tokens"] += 2
        instance._token_usage["completion_tokens"] += 3
        return "ok"

    crew(wrapped, instance, ("first",), {})
    crew(wrapped, instance, ("second",), {})

    spans = exporter.get_finished_spans()
    assert len(spans) == 2
    for span in spans:
        assert span.attributes[SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS] == 2
        assert span.attributes[SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS] == 3


def test_call_resets_flag_when_the_provider_raises():
    """A failed call must not leave the next request suppressed."""
    tracer, exporter = _tracer()
    crew = openai_completion_call(**_config(tracer))

    def wrapped(*_args, **_kwargs):
        raise RuntimeError("provider down")

    with pytest.raises(RuntimeError, match="provider down"):
        crew(wrapped, _llm(), ("hi",), {})

    assert is_framework_llm_active() is False
    spans = exporter.get_finished_spans()
    assert len(spans) == 1
    assert spans[0].status.status_code == StatusCode.ERROR


def test_call_passes_through_when_a_framework_span_is_already_active():
    """A nested entry must not open a second LLM span or reset the outer flag."""
    tracer, exporter = _tracer()
    crew = openai_completion_call(**_config(tracer))
    token = set_framework_llm_active()
    try:
        result = crew(lambda *_args, **_kwargs: "outer", _llm(), ("hi",), {})
        assert is_framework_llm_active() is True
    finally:
        reset_framework_llm_active(token)

    assert result == "outer"
    assert is_framework_llm_active() is False
    assert not exporter.get_finished_spans()


def test_tool_call_list_is_recorded_as_output():
    """Function-call returns stay on the crew span as tool-call parts."""
    tracer, exporter = _tracer()
    crew = openai_completion_call(**_config(tracer, capture=True))
    tool_calls = [{"id": "call_1", "name": "multiply", "arguments": {"a": 2}}]

    crew(lambda *_args, **_kwargs: tool_calls, _llm(), ("compute",), {})

    output = exporter.get_finished_spans()[0].attributes[
        SemanticConvention.GEN_AI_OUTPUT_MESSAGES
    ]
    assert "multiply" in output
    assert "tool_call" in output


@pytest.mark.asyncio
async def test_acall_parents_llm_span_and_skips_async_responses_span():
    """Async crew calls hold the flag across the awaited provider call."""
    tracer, exporter = _tracer()
    crew = async_openai_completion_call(**_config(tracer, capture=True))
    provider = _provider_wrapper(async_responses, tracer)
    instance = _llm()

    async def wrapped(*_args, **_kwargs):
        assert is_framework_llm_active()
        instance._token_usage["prompt_tokens"] += 5
        instance._token_usage["completion_tokens"] += 6
        sentinel = object()
        result = await provider(
            AsyncMock(return_value=sentinel),
            object(),
            (),
            {"model": "gpt-4o", "stream": False},
        )
        assert result is sentinel
        return "async answer"

    with tracer.start_as_current_span("invoke_agent researcher") as task:
        result = await crew(wrapped, instance, ("hello async",), {})
        llm = exporter.get_finished_spans()[-1]
        assert llm.parent.span_id == task.get_span_context().span_id

    assert result == "async answer"
    assert is_framework_llm_active() is False
    chat_spans = [
        span
        for span in exporter.get_finished_spans()
        if span.name.startswith("chat ")
    ]
    assert len(chat_spans) == 1
    assert "hello async" in llm.attributes[SemanticConvention.GEN_AI_INPUT_MESSAGES]
    assert llm.attributes[SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS] == 5


@pytest.mark.asyncio
async def test_acall_resets_flag_when_the_provider_raises():
    """A failed async call must not leave the flag set."""
    tracer, _exporter = _tracer()
    crew = async_openai_completion_call(**_config(tracer))

    async def wrapped(*_args, **_kwargs):
        raise RuntimeError("async down")

    with pytest.raises(RuntimeError, match="async down"):
        await crew(wrapped, _llm(), ("hi",), {})

    assert is_framework_llm_active() is False
