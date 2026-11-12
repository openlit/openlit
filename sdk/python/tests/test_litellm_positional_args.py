"""LiteLLM spans must describe calls that pass model/messages/input positionally."""

import asyncio

from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

from openlit._config import OpenlitConfig
from openlit.instrumentation.litellm.async_litellm import acompletion, aembedding
from openlit.instrumentation.litellm.litellm import completion, embedding
from openlit.semcov import SemanticConvention

MODEL = "mistral/mistral-small-latest"
EMBED_MODEL = "cohere/embed-english-v3.0"
MESSAGES = [{"role": "user", "content": "Say hello"}]


def _make(factory):
    OpenlitConfig.reset_to_defaults()
    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    wrapper = factory(
        version="1.0.0",
        environment="test",
        application_name="test",
        tracer=provider.get_tracer("test"),
        pricing_info={},
        capture_message_content=True,
        metrics=None,
        disable_metrics=True,
    )
    return wrapper, exporter


def _chat_response():
    return {
        "id": "resp-1",
        "model": MODEL,
        "choices": [
            {
                "index": 0,
                "finish_reason": "stop",
                "message": {"role": "assistant", "content": "Hello!"},
            }
        ],
        "usage": {"prompt_tokens": 3, "completion_tokens": 2, "total_tokens": 5},
    }


def _embedding_response():
    return {
        "model": EMBED_MODEL,
        "data": [{"embedding": [0.1, 0.2]}],
        "usage": {"prompt_tokens": 2, "total_tokens": 2},
    }


def _only_span(exporter):
    spans = exporter.get_finished_spans()
    assert len(spans) == 1
    return spans[0]


def _assert_chat_span(span, calls):
    assert calls == [((MODEL, MESSAGES), {"temperature": 0.2})]
    assert span.name == f"chat {MODEL}"
    assert span.attributes[SemanticConvention.GEN_AI_REQUEST_MODEL] == MODEL
    assert span.attributes[SemanticConvention.SERVER_ADDRESS] == "api.mistral.ai"
    assert span.attributes[SemanticConvention.GEN_AI_REQUEST_TEMPERATURE] == 0.2
    assert "Say hello" in span.attributes[SemanticConvention.GEN_AI_INPUT_MESSAGES]


def _assert_embedding_span(span, calls):
    assert calls == [((EMBED_MODEL, ["some text"]), {})]
    assert span.name == f"embeddings {EMBED_MODEL}"
    assert span.attributes[SemanticConvention.GEN_AI_REQUEST_MODEL] == EMBED_MODEL
    assert span.attributes[SemanticConvention.SERVER_ADDRESS] == "api.cohere.com"
    assert "some text" in str(span.attributes[SemanticConvention.GEN_AI_INPUT_MESSAGES])


def test_completion_records_positional_model_and_messages():
    """completion(model, messages) is traced with the caller's model and messages."""
    wrapper, exporter = _make(completion)
    calls = []

    def original(*args, **kwargs):
        calls.append((args, kwargs))
        return _chat_response()

    wrapper(original, None, (MODEL, MESSAGES), {"temperature": 0.2})

    _assert_chat_span(_only_span(exporter), calls)


def test_acompletion_records_positional_model_and_messages():
    """acompletion(model, messages) is traced with the caller's model and messages."""
    wrapper, exporter = _make(acompletion)
    calls = []

    async def original(*args, **kwargs):
        calls.append((args, kwargs))
        return _chat_response()

    asyncio.run(wrapper(original, None, (MODEL, MESSAGES), {"temperature": 0.2}))

    _assert_chat_span(_only_span(exporter), calls)


def test_streaming_completion_records_positional_model_and_messages():
    """A streamed completion(model, messages, stream=True) is traced the same way."""
    wrapper, exporter = _make(completion)
    calls = []
    chunks = [
        {
            "id": "resp-1",
            "model": MODEL,
            "choices": [{"delta": {"content": "Hello!"}, "finish_reason": "stop"}],
            "usage": {"prompt_tokens": 3, "completion_tokens": 2, "total_tokens": 5},
        }
    ]

    def original(*args, **kwargs):
        calls.append((args, kwargs))
        return iter(chunks)

    stream = wrapper(original, None, (MODEL, MESSAGES), {"stream": True})
    assert list(stream) == chunks

    span = _only_span(exporter)
    assert calls == [((MODEL, MESSAGES), {"stream": True})]
    assert span.name == f"chat {MODEL}"
    assert span.attributes[SemanticConvention.GEN_AI_REQUEST_MODEL] == MODEL
    assert span.attributes[SemanticConvention.SERVER_ADDRESS] == "api.mistral.ai"
    assert "Say hello" in span.attributes[SemanticConvention.GEN_AI_INPUT_MESSAGES]


def test_embedding_records_positional_model_and_input():
    """embedding(model, input) is traced with the caller's model and input."""
    wrapper, exporter = _make(embedding)
    calls = []

    def original(*args, **kwargs):
        calls.append((args, kwargs))
        return _embedding_response()

    wrapper(original, None, (EMBED_MODEL, ["some text"]), {})

    _assert_embedding_span(_only_span(exporter), calls)


def test_aembedding_records_positional_model_and_input():
    """aembedding(model, input) is traced with the caller's model and input."""
    wrapper, exporter = _make(aembedding)
    calls = []

    async def original(*args, **kwargs):
        calls.append((args, kwargs))
        return _embedding_response()

    asyncio.run(wrapper(original, None, (EMBED_MODEL, ["some text"]), {}))

    _assert_embedding_span(_only_span(exporter), calls)


def test_keyword_arguments_take_precedence_and_are_unchanged():
    """Keyword-only calls behave as before and reach litellm unchanged."""
    wrapper, exporter = _make(completion)
    calls = []

    def original(*args, **kwargs):
        calls.append((args, kwargs))
        return _chat_response()

    wrapper(original, None, (), {"model": MODEL, "messages": MESSAGES, "temperature": 0.2})

    span = _only_span(exporter)
    assert calls == [((), {"model": MODEL, "messages": MESSAGES, "temperature": 0.2})]
    assert span.attributes[SemanticConvention.GEN_AI_REQUEST_MODEL] == MODEL
