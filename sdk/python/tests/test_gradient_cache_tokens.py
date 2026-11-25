# pylint: disable=protected-access, missing-function-docstring, too-few-public-methods, redefined-outer-name
"""Regression tests: Gradient chat spans must carry the prompt-cache counts.

The DigitalOcean inference endpoint reports `cache_read_input_tokens` and
`cache_created_input_tokens` next to `prompt_tokens` in `usage`, and may also
report `prompt_tokens_details.cached_tokens`. The Gradient instrumentation read
only `prompt_tokens` and `completion_tokens`, so the cache counts were missing
from the span and the cost, while the `pydo` instrumentation of the same
endpoint recorded both.

These tests drive the real Gradient processors and wrappers with
Gradient-shaped payloads and read the result off an in-memory span exporter.
"""

import asyncio

import pytest
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import (
    InMemorySpanExporter,
)

from openlit._config import OpenlitConfig
from openlit.instrumentation.gradient import utils as gradient_utils
from openlit.instrumentation.gradient.async_gradient import (
    async_agent_chat_completions,
    async_chat_completions,
)
from openlit.instrumentation.gradient.gradient import (
    _make_traced_stream,
    agent_chat_completions,
    chat_completions,
)
from openlit.instrumentation.gradient.utils import (
    process_chat_response,
    process_chunk,
    process_streaming_chat_response,
)
from openlit.semcov import SemanticConvention

CACHE_READ_ATTR = SemanticConvention.GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS
CACHE_CREATION_ATTR = SemanticConvention.GEN_AI_USAGE_CACHE_CREATION_INPUT_TOKENS

MODEL = "llama3.3-70b-instruct"
BODY = {"model": MODEL, "messages": [{"role": "user", "content": "hi"}]}

PRICING = {
    "chat": {
        MODEL: {
            "promptPrice": 3.0,
            "completionPrice": 15.0,
            "cacheReadPrice": 0.3,
            "cacheCreationPrice": 3.75,
        }
    }
}

COST_WITH_CACHE = 0.15 + 1.5 + 0.27 + 0.1875
COST_WITHOUT_CACHE = 3.0 + 1.5

USAGE_FLAT = {
    "prompt_tokens": 1000,
    "completion_tokens": 100,
    "total_tokens": 1100,
    "cache_read_input_tokens": 900,
    "cache_created_input_tokens": 50,
}

USAGE_NO_CACHE = {
    "prompt_tokens": 1000,
    "completion_tokens": 100,
    "total_tokens": 1100,
    "cache_read_input_tokens": 0,
    "cache_created_input_tokens": 0,
}


class _Scope:
    """Stand-in for the streaming wrapper's scope for `process_chunk` only."""

    def __init__(self):
        self._timestamps = []
        self._start_time = 0.0
        self._ttft = 0
        self._response_id = ""
        self._response_model = ""
        self._input_tokens = 0
        self._output_tokens = 0
        self._cache_read_input_tokens = 0
        self._cache_creation_input_tokens = 0
        self._finish_reason = ""
        self._llmresponse = ""
        self._tools = None


class _EventSink:
    def __init__(self):
        self.events = []

    def emit(self, event):
        self.events.append(event)


@pytest.fixture(autouse=True)
def _reset_config():
    OpenlitConfig.reset_to_defaults()
    yield
    OpenlitConfig.reset_to_defaults()


@pytest.fixture
def exporter():
    return InMemorySpanExporter()


@pytest.fixture
def tracer(exporter):
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    return provider.get_tracer("test-gradient-cache-tokens")


@pytest.fixture
def cost_calls(monkeypatch):
    calls = []
    original = gradient_utils.get_chat_model_cost

    def spy(*args, **kwargs):
        calls.append((args, kwargs))
        return original(*args, **kwargs)

    monkeypatch.setattr(gradient_utils, "get_chat_model_cost", spy)
    return calls


def _chunk(usage=None, content=None, finish_reason=None):
    chunk = {
        "id": "chatcmpl-1",
        "model": MODEL,
        "choices": [
            {
                "index": 0,
                "delta": {"content": content} if content else {},
                "finish_reason": finish_reason,
            }
        ],
    }
    if usage is not None:
        chunk["usage"] = usage
    return chunk


def _response(usage):
    return {
        "id": "chatcmpl-2",
        "model": MODEL,
        "choices": [
            {
                "index": 0,
                "message": {"role": "assistant", "content": "hello"},
                "finish_reason": "stop",
            }
        ],
        "usage": usage,
    }


def _finalize_kwargs(event_provider=None):
    return {
        "pricing_info": PRICING,
        "environment": "test",
        "application_name": "test",
        "metrics": None,
        "capture_message_content": False,
        "disable_metrics": True,
        "version": "0.0.0",
        "event_provider": event_provider,
        "operation_name": SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
        "api_type": "chat",
    }


def _only_span(exporter):
    spans = exporter.get_finished_spans()
    assert len(spans) == 1
    return spans[0]


def _stream(tracer, chunks, event_provider=None):
    stream_cls = _make_traced_stream(process_chunk, process_streaming_chat_response)
    span = tracer.start_span("chat test")
    stream = stream_cls(
        iter(chunks),
        span,
        BODY,
        "inference.do-ai.run",
        443,
        _finalize_kwargs(event_provider),
    )
    return list(stream)


def test_a_final_usage_chunk_with_flat_cache_counts_fills_the_scope():
    scope = _Scope()
    process_chunk(scope, _chunk(content="hel"))
    process_chunk(scope, _chunk(usage=USAGE_FLAT, finish_reason="stop"))

    assert getattr(scope, "_cache_read_input_tokens", None) == 900
    assert getattr(scope, "_cache_creation_input_tokens", None) == 50
    assert scope._input_tokens == 1000
    assert scope._output_tokens == 100


def test_prompt_tokens_details_cached_tokens_is_read_when_flat_count_is_absent():
    scope = _Scope()
    process_chunk(
        scope,
        _chunk(
            usage={
                "prompt_tokens": 1000,
                "completion_tokens": 100,
                "prompt_tokens_details": {"cached_tokens": 900},
            }
        ),
    )

    assert getattr(scope, "_cache_read_input_tokens", None) == 900
    assert getattr(scope, "_cache_creation_input_tokens", None) == 0


def test_a_chunk_without_usage_keeps_the_cache_counts_already_read():
    scope = _Scope()
    process_chunk(scope, _chunk(usage=USAGE_FLAT))
    process_chunk(scope, _chunk(content="tail"))

    assert getattr(scope, "_cache_read_input_tokens", None) == 900
    assert getattr(scope, "_cache_creation_input_tokens", None) == 50


def test_a_later_usage_without_cache_keys_keeps_the_cache_counts_already_read():
    scope = _Scope()
    process_chunk(scope, _chunk(usage=USAGE_FLAT))
    process_chunk(
        scope, _chunk(usage={"prompt_tokens": 1000, "completion_tokens": 100})
    )

    assert getattr(scope, "_cache_read_input_tokens", None) == 900
    assert getattr(scope, "_cache_creation_input_tokens", None) == 50


def test_a_later_usage_with_explicit_zero_cache_counts_overrides_the_earlier_ones():
    scope = _Scope()
    process_chunk(scope, _chunk(usage=USAGE_FLAT))
    process_chunk(scope, _chunk(usage=USAGE_NO_CACHE))

    assert getattr(scope, "_cache_read_input_tokens", None) == 0
    assert getattr(scope, "_cache_creation_input_tokens", None) == 0


def test_a_later_explicit_zero_cached_tokens_detail_overrides_the_earlier_count():
    scope = _Scope()
    process_chunk(scope, _chunk(usage=USAGE_FLAT))
    process_chunk(
        scope,
        _chunk(
            usage={
                "prompt_tokens": 1000,
                "completion_tokens": 100,
                "prompt_tokens_details": {"cached_tokens": 0},
            }
        ),
    )

    assert getattr(scope, "_cache_read_input_tokens", None) == 0
    assert getattr(scope, "_cache_creation_input_tokens", None) == 50


def test_a_later_usage_with_null_cache_counts_keeps_the_earlier_ones():
    scope = _Scope()
    process_chunk(scope, _chunk(usage=USAGE_FLAT))
    process_chunk(
        scope,
        _chunk(
            usage={
                "prompt_tokens": 1000,
                "completion_tokens": 100,
                "cache_read_input_tokens": None,
                "cache_created_input_tokens": None,
                "prompt_tokens_details": {"cached_tokens": None},
            }
        ),
    )

    assert getattr(scope, "_cache_read_input_tokens", None) == 900
    assert getattr(scope, "_cache_creation_input_tokens", None) == 50


def test_a_nonzero_cached_tokens_detail_wins_over_a_zero_flat_count():
    scope = _Scope()
    process_chunk(
        scope,
        _chunk(
            usage={
                "prompt_tokens": 1000,
                "completion_tokens": 100,
                "cache_read_input_tokens": 0,
                "prompt_tokens_details": {"cached_tokens": 5},
            }
        ),
    )

    assert getattr(scope, "_cache_read_input_tokens", None) == 5


def test_the_flat_count_wins_over_a_different_cached_tokens_detail():
    scope = _Scope()
    process_chunk(
        scope,
        _chunk(
            usage={
                "prompt_tokens": 1000,
                "completion_tokens": 100,
                "cache_read_input_tokens": 900,
                "prompt_tokens_details": {"cached_tokens": 5},
            }
        ),
    )

    assert getattr(scope, "_cache_read_input_tokens", None) == 900


def test_streamed_span_and_cost_reflect_a_later_explicit_zero(
    tracer, exporter, cost_calls
):
    sink = _EventSink()
    _stream(
        tracer,
        [
            _chunk(usage=USAGE_FLAT),
            _chunk(usage=USAGE_NO_CACHE, finish_reason="stop"),
        ],
        sink,
    )
    attrs = _only_span(exporter).attributes

    assert attrs.get(CACHE_READ_ATTR) == 0
    assert attrs.get(CACHE_CREATION_ATTR) == 0
    assert attrs[SemanticConvention.GEN_AI_USAGE_COST] == pytest.approx(
        COST_WITHOUT_CACHE
    )
    assert cost_calls[0][1]["cache_read_tokens"] == 0
    assert cost_calls[0][1]["cache_creation_tokens"] == 0
    assert CACHE_READ_ATTR not in sink.events[0].attributes
    assert CACHE_CREATION_ATTR not in sink.events[0].attributes


def test_streamed_span_keeps_the_cache_counts_when_a_later_usage_omits_them(
    tracer, exporter
):
    _stream(
        tracer,
        [
            _chunk(usage=USAGE_FLAT),
            _chunk(
                usage={"prompt_tokens": 1000, "completion_tokens": 100},
                finish_reason="stop",
            ),
        ],
    )
    attrs = _only_span(exporter).attributes

    assert attrs.get(CACHE_READ_ATTR) == 900
    assert attrs.get(CACHE_CREATION_ATTR) == 50
    assert attrs[SemanticConvention.GEN_AI_USAGE_COST] == pytest.approx(COST_WITH_CACHE)


def test_streamed_span_records_cache_attributes_and_cache_aware_cost(
    tracer, exporter, cost_calls
):
    _stream(
        tracer,
        [_chunk(content="hello"), _chunk(usage=USAGE_FLAT, finish_reason="stop")],
    )
    attrs = _only_span(exporter).attributes

    assert attrs.get(CACHE_READ_ATTR) == 900
    assert attrs.get(CACHE_CREATION_ATTR) == 50
    assert attrs[SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS] == 1000
    assert attrs[SemanticConvention.GEN_AI_USAGE_COST] == pytest.approx(COST_WITH_CACHE)
    assert len(cost_calls) == 1
    args, kwargs = cost_calls[0]
    assert args[2:] == (1000, 100)
    assert kwargs == {
        "cache_read_tokens": 900,
        "cache_creation_tokens": 50,
        "prompt_tokens_include_cache": True,
    }


def test_streamed_span_with_openai_style_cached_tokens(tracer, exporter):
    _stream(
        tracer,
        [
            _chunk(
                usage={
                    "prompt_tokens": 1000,
                    "completion_tokens": 100,
                    "prompt_tokens_details": {"cached_tokens": 900},
                }
            )
        ],
    )
    attrs = _only_span(exporter).attributes

    assert attrs.get(CACHE_READ_ATTR) == 900
    assert attrs.get(CACHE_CREATION_ATTR) == 0


def test_non_streaming_span_records_cache_attributes_and_cache_aware_cost(
    tracer, exporter, cost_calls
):
    span = tracer.start_span("chat test")
    process_chat_response(
        response=_response(USAGE_FLAT),
        body=BODY,
        pricing_info=PRICING,
        server_address="inference.do-ai.run",
        server_port=443,
        environment="test",
        application_name="test",
        metrics=None,
        start_time=0.0,
        span=span,
        capture_message_content=False,
        disable_metrics=True,
        version="0.0.0",
    )
    span.end()
    attrs = _only_span(exporter).attributes

    assert attrs.get(CACHE_READ_ATTR) == 900
    assert attrs.get(CACHE_CREATION_ATTR) == 50
    assert attrs[SemanticConvention.GEN_AI_USAGE_COST] == pytest.approx(COST_WITH_CACHE)
    args, kwargs = cost_calls[0]
    assert args[2:] == (1000, 100)
    assert kwargs == {
        "cache_read_tokens": 900,
        "cache_creation_tokens": 50,
        "prompt_tokens_include_cache": True,
    }


def test_non_streaming_prompt_tokens_details_cached_tokens(tracer, exporter):
    span = tracer.start_span("chat test")
    process_chat_response(
        response=_response(
            {
                "prompt_tokens": 1000,
                "completion_tokens": 100,
                "prompt_tokens_details": {"cached_tokens": 900},
            }
        ),
        body=BODY,
        pricing_info=PRICING,
        server_address="inference.do-ai.run",
        server_port=443,
        environment="test",
        application_name="test",
        metrics=None,
        start_time=0.0,
        span=span,
        capture_message_content=False,
        disable_metrics=True,
        version="0.0.0",
    )
    span.end()

    assert _only_span(exporter).attributes.get(CACHE_READ_ATTR) == 900


def test_no_cache_usage_records_zero_and_the_plain_cost(tracer, exporter):
    _stream(tracer, [_chunk(usage=USAGE_NO_CACHE, finish_reason="stop")])
    attrs = _only_span(exporter).attributes

    assert attrs.get(CACHE_READ_ATTR) == 0
    assert attrs.get(CACHE_CREATION_ATTR) == 0
    assert attrs[SemanticConvention.GEN_AI_USAGE_COST] == pytest.approx(
        COST_WITHOUT_CACHE
    )


def test_inference_event_carries_the_cache_counts(tracer):
    sink = _EventSink()
    _stream(tracer, [_chunk(usage=USAGE_FLAT, finish_reason="stop")], sink)

    assert len(sink.events) == 1
    attrs = sink.events[0].attributes
    assert attrs.get(CACHE_READ_ATTR) == 900
    assert attrs.get(CACHE_CREATION_ATTR) == 50
    assert attrs[SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS] == 1000


def test_inference_event_omits_cache_counts_when_there_are_none(tracer):
    sink = _EventSink()
    _stream(tracer, [_chunk(usage=USAGE_NO_CACHE, finish_reason="stop")], sink)

    attrs = sink.events[0].attributes
    assert CACHE_READ_ATTR not in attrs
    assert CACHE_CREATION_ATTR not in attrs


class _Instance:
    _client = None


def test_agent_chat_non_streaming_wrapper_records_cache_attributes(tracer, exporter):
    factory = agent_chat_completions(
        "0.0.0", "test", "test", tracer, PRICING, False, None, True, None
    )

    def wrapped(*_args, **_kwargs):
        return _response(USAGE_FLAT)

    factory(wrapped, _Instance(), (), dict(BODY))
    attrs = _only_span(exporter).attributes

    assert attrs.get(CACHE_READ_ATTR) == 900
    assert attrs.get(CACHE_CREATION_ATTR) == 50
    assert attrs[SemanticConvention.GEN_AI_USAGE_COST] == pytest.approx(COST_WITH_CACHE)


def test_chat_streaming_wrapper_records_cache_attributes(tracer, exporter):
    factory = chat_completions(
        "0.0.0", "test", "test", tracer, PRICING, False, None, True, None
    )

    def wrapped(*_args, **_kwargs):
        return iter([_chunk(usage=USAGE_FLAT, finish_reason="stop")])

    result = factory(wrapped, _Instance(), (), {**BODY, "stream": True})
    list(result)
    attrs = _only_span(exporter).attributes

    assert attrs.get(CACHE_READ_ATTR) == 900
    assert attrs.get(CACHE_CREATION_ATTR) == 50
    assert attrs[SemanticConvention.GEN_AI_USAGE_COST] == pytest.approx(COST_WITH_CACHE)


def test_async_agent_chat_non_streaming_wrapper_records_cache_attributes(
    tracer, exporter
):
    factory = async_agent_chat_completions(
        "0.0.0", "test", "test", tracer, PRICING, False, None, True, None
    )

    async def wrapped(*_args, **_kwargs):
        return _response(USAGE_FLAT)

    asyncio.run(factory(wrapped, _Instance(), (), dict(BODY)))
    attrs = _only_span(exporter).attributes

    assert attrs.get(CACHE_READ_ATTR) == 900
    assert attrs.get(CACHE_CREATION_ATTR) == 50
    assert attrs[SemanticConvention.GEN_AI_USAGE_COST] == pytest.approx(COST_WITH_CACHE)


def test_async_chat_streaming_wrapper_records_cache_attributes(tracer, exporter):
    factory = async_chat_completions(
        "0.0.0", "test", "test", tracer, PRICING, False, None, True, None
    )

    async def agen():
        yield _chunk(usage=USAGE_FLAT, finish_reason="stop")

    async def wrapped(*_args, **_kwargs):
        return agen()

    async def drive():
        stream = await factory(wrapped, _Instance(), (), {**BODY, "stream": True})
        return [chunk async for chunk in stream]

    asyncio.run(drive())
    attrs = _only_span(exporter).attributes

    assert attrs.get(CACHE_READ_ATTR) == 900
    assert attrs.get(CACHE_CREATION_ATTR) == 50
    assert attrs[SemanticConvention.GEN_AI_USAGE_COST] == pytest.approx(COST_WITH_CACHE)


def test_async_chat_streaming_wrapper_without_cache_usage_records_zero(
    tracer, exporter
):
    factory = async_chat_completions(
        "0.0.0", "test", "test", tracer, PRICING, False, None, True, None
    )

    async def agen():
        yield _chunk(usage=USAGE_NO_CACHE, finish_reason="stop")

    async def wrapped(*_args, **_kwargs):
        return agen()

    async def drive():
        stream = await factory(wrapped, _Instance(), (), {**BODY, "stream": True})
        return [chunk async for chunk in stream]

    asyncio.run(drive())
    attrs = _only_span(exporter).attributes

    assert attrs.get(CACHE_READ_ATTR) == 0
    assert attrs.get(CACHE_CREATION_ATTR) == 0
    assert attrs[SemanticConvention.GEN_AI_USAGE_COST] == pytest.approx(
        COST_WITHOUT_CACHE
    )
