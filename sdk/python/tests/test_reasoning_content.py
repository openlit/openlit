# pylint: disable=protected-access
"""
Unit tests for reasoning-content capture (``gen_ai.content.reasoning``) in the
Groq and Ollama instrumentations.

These tests drive the instrumentation helpers directly with mocked provider
responses, so they need neither a live API key nor a running model.
"""

import time
from types import SimpleNamespace

import pytest
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import (
    InMemorySpanExporter,
)

from openlit._config import OpenlitConfig
from openlit.__helpers import (
    append_scope_reasoning,
    extract_reasoning_content,
    set_span_reasoning_content,
)
from openlit.instrumentation.groq import utils as groq_utils
from openlit.instrumentation.ollama import utils as ollama_utils
from openlit.semcov import SemanticConvention

REASONING_ATTR = SemanticConvention.GEN_AI_CONTENT_REASONING


@pytest.fixture(autouse=True)
def _reset_openlit_config():
    """The span helpers read global OpenlitConfig; initialize it to defaults."""
    OpenlitConfig.reset_to_defaults()


def _tracer_with_exporter():
    """Return (tracer, exporter) backed by an in-memory span exporter."""
    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    tracer = provider.get_tracer(__name__)
    return tracer, exporter


def test_extract_reasoning_content_defaults_and_custom_keys():
    """Shared helper prefers OpenAI keys by default and accepts custom keys."""
    assert extract_reasoning_content({"reasoning": "a"}) == "a"
    assert extract_reasoning_content({"reasoning_content": "b", "reasoning": "a"}) == "b"
    assert extract_reasoning_content({"thinking": "c"}, "thinking") == "c"
    assert extract_reasoning_content({"thinking": 123}, "thinking") == ""
    assert extract_reasoning_content("not-a-dict") == ""


def test_groq_non_streaming_captures_reasoning():
    """Groq non-streaming: reasoning maps to gen_ai.content.reasoning on the span."""
    tracer, exporter = _tracer_with_exporter()

    response = {
        "id": "resp-1",
        "model": "qwen/qwen3-32b",
        "choices": [
            {
                "finish_reason": "stop",
                "message": {
                    "role": "assistant",
                    "content": "The answer is 4.",
                    "reasoning": "2 + 2 = 4, so the answer is 4.",
                },
            }
        ],
        "usage": {"prompt_tokens": 10, "completion_tokens": 5},
    }

    with tracer.start_as_current_span("groq.chat") as span:
        groq_utils.process_chat_response(
            response=response,
            request_model="qwen/qwen3-32b",
            pricing_info={},
            server_port=443,
            server_address="api.groq.com",
            environment="test",
            application_name="test",
            metrics={},
            start_time=time.time(),
            span=span,
            capture_message_content=True,
            disable_metrics=True,
            version="1.0.0",
            event_provider=None,
            messages=[{"role": "user", "content": "what is 2 + 2?"}],
            model="qwen/qwen3-32b",
        )

    finished = exporter.get_finished_spans()
    assert len(finished) == 1
    assert finished[0].attributes.get(REASONING_ATTR) == "2 + 2 = 4, so the answer is 4."


def test_groq_non_streaming_without_reasoning_omits_attribute():
    """Groq non-streaming: no reasoning field means the attribute is not set."""
    tracer, exporter = _tracer_with_exporter()

    response = {
        "id": "resp-2",
        "model": "llama-3.3-70b-versatile",
        "choices": [
            {"finish_reason": "stop", "message": {"role": "assistant", "content": "Hi!"}}
        ],
        "usage": {"prompt_tokens": 3, "completion_tokens": 1},
    }

    with tracer.start_as_current_span("groq.chat") as span:
        groq_utils.process_chat_response(
            response=response,
            request_model="llama-3.3-70b-versatile",
            pricing_info={},
            server_port=443,
            server_address="api.groq.com",
            environment="test",
            application_name="test",
            metrics={},
            start_time=time.time(),
            span=span,
            capture_message_content=True,
            disable_metrics=True,
            version="1.0.0",
            event_provider=None,
            messages=[{"role": "user", "content": "hi"}],
            model="llama-3.3-70b-versatile",
        )

    finished = exporter.get_finished_spans()
    assert len(finished) == 1
    assert REASONING_ATTR not in (finished[0].attributes or {})


def test_groq_non_streaming_aggregates_reasoning_across_choices():
    """Groq non-streaming with n > 1: reasoning is aggregated across all choices."""
    tracer, exporter = _tracer_with_exporter()

    response = {
        "id": "resp-3",
        "model": "qwen/qwen3-32b",
        "choices": [
            {
                "finish_reason": "stop",
                "message": {"role": "assistant", "content": "A", "reasoning": "first."},
            },
            {
                "finish_reason": "stop",
                "message": {"role": "assistant", "content": "B", "reasoning": "second."},
            },
        ],
        "usage": {"prompt_tokens": 5, "completion_tokens": 2},
    }

    with tracer.start_as_current_span("groq.chat") as span:
        groq_utils.process_chat_response(
            response=response,
            request_model="qwen/qwen3-32b",
            pricing_info={},
            server_port=443,
            server_address="api.groq.com",
            environment="test",
            application_name="test",
            metrics={},
            start_time=time.time(),
            span=span,
            capture_message_content=True,
            disable_metrics=True,
            version="1.0.0",
            event_provider=None,
            messages=[{"role": "user", "content": "hi"}],
            model="qwen/qwen3-32b",
        )

    finished = exporter.get_finished_spans()
    assert len(finished) == 1
    assert finished[0].attributes.get(REASONING_ATTR) == "first. second."


def test_groq_omits_reasoning_when_content_capture_disabled():
    """capture_message_content=False must not emit gen_ai.content.reasoning."""
    tracer, exporter = _tracer_with_exporter()

    response = {
        "id": "resp-4",
        "model": "qwen/qwen3-32b",
        "choices": [
            {
                "finish_reason": "stop",
                "message": {
                    "role": "assistant",
                    "content": "4",
                    "reasoning": "secret thinking",
                },
            }
        ],
        "usage": {"prompt_tokens": 2, "completion_tokens": 1},
    }

    with tracer.start_as_current_span("groq.chat") as span:
        groq_utils.process_chat_response(
            response=response,
            request_model="qwen/qwen3-32b",
            pricing_info={},
            server_port=443,
            server_address="api.groq.com",
            environment="test",
            application_name="test",
            metrics={},
            start_time=time.time(),
            span=span,
            capture_message_content=False,
            disable_metrics=True,
            version="1.0.0",
            event_provider=None,
            messages=[{"role": "user", "content": "2+2"}],
            model="qwen/qwen3-32b",
        )

    finished = exporter.get_finished_spans()
    assert len(finished) == 1
    assert REASONING_ATTR not in (finished[0].attributes or {})


def test_groq_streaming_accumulates_reasoning():
    """Groq streaming: delta.reasoning chunks accumulate into the reasoning text."""
    scope = SimpleNamespace(
        _timestamps=[],
        _start_time=time.time(),
        _ttft=0,
        _llmresponse="",
        _tools=None,
    )

    for delta_reasoning in ("Let me ", "think it ", "through."):
        groq_utils.process_chunk(
            scope,
            {
                "choices": [
                    {
                        "delta": {"content": "", "reasoning": delta_reasoning},
                        "finish_reason": None,
                    }
                ]
            },
        )

    assert scope._reasoning_content == "Let me think it through."


def test_ollama_non_streaming_captures_reasoning():
    """Ollama non-streaming chat: message.thinking maps to gen_ai.content.reasoning."""
    tracer, exporter = _tracer_with_exporter()

    response = {
        "model": "qwen3",
        "done_reason": "stop",
        "message": {
            "role": "assistant",
            "content": "The answer is 4.",
            "thinking": "I need to add 2 and 2, which gives 4.",
        },
        "prompt_eval_count": 10,
        "eval_count": 5,
    }

    with tracer.start_as_current_span("ollama.chat") as span:
        ollama_utils.process_chat_response(
            response=response,
            pricing_info={},
            server_port=11434,
            server_address="127.0.0.1",
            environment="test",
            application_name="test",
            metrics={},
            start_time=time.monotonic(),
            span=span,
            capture_message_content=True,
            disable_metrics=True,
            version="1.0.0",
            event_provider=None,
            messages=[{"role": "user", "content": "what is 2 + 2?"}],
            model="qwen3",
        )

    finished = exporter.get_finished_spans()
    assert len(finished) == 1
    assert (
        finished[0].attributes.get(REASONING_ATTR)
        == "I need to add 2 and 2, which gives 4."
    )


def test_ollama_streaming_chat_accumulates_reasoning():
    """Ollama chat streaming: message.thinking chunks accumulate."""
    scope = SimpleNamespace(
        _timestamps=[],
        _start_time=time.monotonic(),
        _ttft=0,
        _llmresponse="",
        _tools=None,
    )

    for thinking in ("Adding ", "two and two ", "makes four."):
        ollama_utils.process_chunk(
            scope,
            {"message": {"content": "", "thinking": thinking}},
        )

    assert scope._reasoning_content == "Adding two and two makes four."


def test_ollama_streaming_generate_accumulates_thinking_and_response():
    """Ollama generate streaming uses top-level thinking + response fields."""
    scope = SimpleNamespace(
        _timestamps=[],
        _start_time=time.monotonic(),
        _ttft=0,
        _llmresponse="",
        _tools=None,
    )

    ollama_utils.process_chunk(
        scope, {"response": "Hi", "thinking": "Warming up. "}
    )
    ollama_utils.process_chunk(
        scope, {"response": " there", "thinking": "Done."}
    )

    assert scope._llmresponse == "Hi there"
    assert scope._reasoning_content == "Warming up. Done."


def test_ollama_generate_non_streaming_captures_thinking():
    """Ollama generate non-streaming: top-level thinking on the span."""
    tracer, exporter = _tracer_with_exporter()

    response = {
        "model": "qwen3",
        "done_reason": "stop",
        "response": "The answer is 4.",
        "thinking": "Add 2 and 2.",
        "prompt_eval_count": 8,
        "eval_count": 4,
    }

    with tracer.start_as_current_span("ollama.generate") as span:
        ollama_utils.process_generate_response(
            response=response,
            pricing_info={},
            server_port=11434,
            server_address="127.0.0.1",
            environment="test",
            application_name="test",
            metrics={},
            start_time=time.monotonic(),
            span=span,
            capture_message_content=True,
            disable_metrics=True,
            version="1.0.0",
            event_provider=None,
            model="qwen3",
            prompt="what is 2 + 2?",
            json={"model": "qwen3", "prompt": "what is 2 + 2?"},
        )

    finished = exporter.get_finished_spans()
    assert len(finished) == 1
    assert finished[0].attributes.get(REASONING_ATTR) == "Add 2 and 2."


def test_set_span_reasoning_respects_capture_flag():
    """Shared setter is a no-op when content capture is disabled."""
    tracer, exporter = _tracer_with_exporter()
    scope = SimpleNamespace(_reasoning_content="hidden")

    with tracer.start_as_current_span("test") as span:
        set_span_reasoning_content(span, scope, capture_message_content=False)
        append_scope_reasoning(scope, " more")
        set_span_reasoning_content(span, scope, capture_message_content=True)

    finished = exporter.get_finished_spans()
    assert len(finished) == 1
    assert finished[0].attributes.get(REASONING_ATTR) == "hidden more"
