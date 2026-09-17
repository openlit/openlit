# pylint: disable=protected-access, missing-function-docstring
"""Regression tests: Mistral reasoning models answer with a list of content
chunks (a thinking chunk, then the text) instead of a string. The complete
and stream wrappers must record that answer rather than fail on it. These
tests drive the real wrapper factories with responses and chunks built from
the mistralai SDK's own models, so no API key is needed.
"""

from mistralai.client.models import (
    ChatCompletionResponse,
    CompletionChunk,
    CompletionEvent,
    CompletionResponseStreamChoice,
    DeltaMessage,
)
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import (
    InMemorySpanExporter,
)
from opentelemetry.trace import StatusCode

from openlit._config import OpenlitConfig
from openlit.instrumentation.mistral import mistral as sync_mod
from openlit.semcov import SemanticConvention

REASONING = "The user asks for the capital of France. It is Paris."
ANSWER = "Paris."
REQUEST_KWARGS = {
    "model": "magistral-medium-latest",
    "messages": [{"role": "user", "content": "What is the capital of France?"}],
}

MAGISTRAL_RESPONSE = ChatCompletionResponse.model_validate(
    {
        "id": "b3f1d1f0e8d94f8f9d4b8d7e5a1c2b3d",
        "object": "chat.completion",
        "created": 1758000000,
        "model": "magistral-medium-latest",
        "choices": [
            {
                "index": 0,
                "message": {
                    "role": "assistant",
                    "content": [
                        {"type": "thinking", "thinking": [{"type": "text", "text": REASONING}]},
                        {"type": "text", "text": ANSWER},
                    ],
                    "tool_calls": None,
                },
                "finish_reason": "stop",
            }
        ],
        "usage": {"prompt_tokens": 20, "total_tokens": 61, "completion_tokens": 41},
    }
)


def _event(content, finish_reason=None, usage=None):
    return CompletionEvent(
        data=CompletionChunk(
            id="b3f1d1f0e8d94f8f9d4b8d7e5a1c2b3d",
            model="magistral-medium-latest",
            choices=[
                CompletionResponseStreamChoice(
                    index=0,
                    delta=DeltaMessage(role="assistant", content=content),
                    finish_reason=finish_reason,
                )
            ],
            usage=usage,
        )
    )


def _magistral_stream():
    return iter(
        [
            _event([{"type": "thinking", "thinking": [{"type": "text", "text": REASONING}]}]),
            _event([{"type": "text", "text": ANSWER}]),
            _event(
                None,
                finish_reason="stop",
                usage={"prompt_tokens": 20, "completion_tokens": 41, "total_tokens": 61},
            ),
        ]
    )


def _tracer_with_exporter():
    OpenlitConfig.reset_to_defaults()
    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    return provider.get_tracer(__name__), exporter


def _factory(make, tracer):
    return make(
        version="test",
        environment="test",
        application_name="test",
        tracer=tracer,
        pricing_info={},
        capture_message_content=True,
        metrics=None,
        disable_metrics=True,
        event_provider=None,
    )


def _completion_text(span):
    return span.attributes.get(SemanticConvention.GEN_AI_OUTPUT_MESSAGES)


def test_complete_records_chunked_answer():
    tracer, exporter = _tracer_with_exporter()
    wrapper = _factory(sync_mod.complete, tracer)

    wrapper(lambda *a, **k: MAGISTRAL_RESPONSE, None, (), REQUEST_KWARGS)

    spans = exporter.get_finished_spans()
    assert len(spans) == 1
    span = spans[0]
    assert span.status.status_code != StatusCode.ERROR, "the span was marked as failed"
    completion = _completion_text(span)
    assert completion is not None, "the answer was not recorded"
    assert ANSWER in completion
    assert REASONING not in completion, "reasoning is recorded separately, not as the answer"
    assert span.attributes.get(SemanticConvention.GEN_AI_CONTENT_REASONING) == REASONING


def test_stream_records_chunked_answer_and_keeps_yielding():
    tracer, exporter = _tracer_with_exporter()
    wrapper = _factory(sync_mod.stream, tracer)

    stream = wrapper(lambda *a, **k: _magistral_stream(), None, (), REQUEST_KWARGS)
    events = list(stream)

    assert len(events) == 3, "every chunk must still reach the caller"
    spans = exporter.get_finished_spans()
    assert len(spans) == 1
    span = spans[0]
    assert span.status.status_code != StatusCode.ERROR
    completion = _completion_text(span)
    assert completion is not None, "the streamed answer was not recorded"
    assert ANSWER in completion
    assert REASONING not in completion
    assert span.attributes.get(SemanticConvention.GEN_AI_CONTENT_REASONING) == REASONING
