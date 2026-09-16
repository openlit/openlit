# pylint: disable=protected-access
"""Invariant tests for Azure AI Inference reasoning token telemetry (#1537).

Azure AI Inference returns OpenAI-shaped usage, where reasoning tokens are a
*subset* of the completion tokens: ``prompt_tokens=10`` /
``completion_tokens=1000`` / ``completion_tokens_details.reasoning_tokens=700``
means 700 of the 1000 output tokens were spent on reasoning.

The span therefore must record:
  * ``gen_ai.usage.output_tokens`` = 1000 (already includes the subset)
  * ``gen_ai.usage.reasoning.output_tokens`` = 700 (the subset, a facet)
  * ``gen_ai.client.token.usage`` = 1010 (input + output; it used to be
    overwritten with input + output + reasoning = 1710)

and ``gen_ai.client.token.usage{gen_ai.token.type=output}`` stays 1000. These
tests lock in the same invariant the OpenAI path follows since #1476/#1543,
for both the non-streaming and the streaming paths.
"""

import time
from unittest.mock import MagicMock

import pytest
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import (
    InMemorySpanExporter,
)

from openlit._config import OpenlitConfig
from openlit.instrumentation.azure_ai_inference import (
    async_azure_ai_inference as async_mod,
)
from openlit.instrumentation.azure_ai_inference import azure_ai_inference as sync_mod
from openlit.instrumentation.azure_ai_inference.utils import process_chat_response
from openlit.semcov import SemanticConvention

REQUEST_KWARGS = {
    "model": "o3-mini",
    "messages": [{"role": "user", "content": "think step by step"}],
}

USAGE = {
    "prompt_tokens": 10,
    "completion_tokens": 1000,
    "total_tokens": 1010,
    "completion_tokens_details": {"reasoning_tokens": 700},
}

USAGE_WITHOUT_DETAILS = {"prompt_tokens": 10, "completion_tokens": 1000}


def _tracer_and_exporter():
    OpenlitConfig.reset_to_defaults()
    exporter = InMemorySpanExporter()
    tracer_provider = TracerProvider()
    tracer_provider.add_span_processor(SimpleSpanProcessor(exporter))
    return (
        tracer_provider.get_tracer("test-azure-ai-inference-reasoning-tokens"),
        exporter,
    )


def _metrics_dict():
    """MagicMock metric instruments mirroring openlit.otel.metrics.build_metrics()."""
    return {
        "genai_client_usage_tokens": MagicMock(),
        "genai_client_operation_duration": MagicMock(),
        "genai_client_time_to_first_chunk": MagicMock(),
        "genai_client_time_per_output_chunk": MagicMock(),
        "genai_server_tbt": MagicMock(),
        "genai_server_ttft": MagicMock(),
        "genai_server_request_duration": MagicMock(),
        "genai_cost": MagicMock(),
    }


def _output_token_usage_records(metrics):
    """Return [(value, attrs)] of gen_ai.client.token.usage{token_type=output}."""
    records = []
    for call in metrics["genai_client_usage_tokens"].record.call_args_list:
        value, attrs = call.args
        if (
            attrs.get(SemanticConvention.GEN_AI_TOKEN_TYPE)
            == SemanticConvention.GEN_AI_TOKEN_TYPE_OUTPUT
        ):
            records.append((value, attrs))
    return records


def _assert_no_double_counting(
    attrs, metrics, input_tokens=10, output_tokens=1000, reasoning_tokens=700
):
    """Shared invariant: reasoning is a subset of output, never added on top."""
    # Span attributes
    assert attrs[SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS] == input_tokens
    assert attrs[SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS] == output_tokens
    # gen_ai.client.token.usage on the span must stay 1010, not 1710
    assert (
        attrs[SemanticConvention.GEN_AI_CLIENT_TOKEN_USAGE]
        == input_tokens + output_tokens
    )
    assert (
        attrs[SemanticConvention.GEN_AI_USAGE_REASONING_OUTPUT_TOKENS]
        == reasoning_tokens
    )
    # OpenLIT legacy alias (pre-OTel naming) must stay populated for backward
    # compatibility.
    assert attrs[SemanticConvention.GEN_AI_USAGE_REASONING_TOKENS] == reasoning_tokens
    assert (
        attrs[SemanticConvention.GEN_AI_USAGE_REASONING_OUTPUT_TOKENS_REPORTED] is True
    )
    assert (
        attrs[SemanticConvention.GEN_AI_USAGE_DERIVED_COMPLETED_OUTPUT_TOKENS]
        == output_tokens - reasoning_tokens
    )

    # gen_ai.client.token.usage{token_type=output} must stay 1000, not 1700
    output_records = _output_token_usage_records(metrics)
    assert output_records, "expected at least one output token usage record"
    for value, _attrs in output_records:
        assert value == output_tokens

    # No recorded value may reach an aggregate that adds reasoning on top.
    forbidden = (
        output_tokens + reasoning_tokens,
        input_tokens + output_tokens + reasoning_tokens,
    )
    assert all(value not in forbidden for value in attrs.values())
    for call in metrics["genai_client_usage_tokens"].record.call_args_list:
        assert call.args[0] not in forbidden


def _assert_reasoning_unknown(attrs, metrics):
    """Usage without a reasoning count: unknown (marker false), not a guessed 0."""
    assert attrs[SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS] == 1000
    assert attrs[SemanticConvention.GEN_AI_CLIENT_TOKEN_USAGE] == 1010
    assert (
        attrs[SemanticConvention.GEN_AI_USAGE_REASONING_OUTPUT_TOKENS_REPORTED] is False
    )
    assert SemanticConvention.GEN_AI_USAGE_REASONING_OUTPUT_TOKENS not in attrs
    assert SemanticConvention.GEN_AI_USAGE_REASONING_TOKENS not in attrs
    assert SemanticConvention.GEN_AI_USAGE_DERIVED_COMPLETED_OUTPUT_TOKENS not in attrs
    output_records = _output_token_usage_records(metrics)
    assert output_records, "expected at least one output token usage record"
    for value, _attrs in output_records:
        assert value == 1000


def _assert_no_reasoning_usage_attrs(attrs):
    assert SemanticConvention.GEN_AI_USAGE_REASONING_OUTPUT_TOKENS not in attrs
    assert SemanticConvention.GEN_AI_USAGE_REASONING_OUTPUT_TOKENS_REPORTED not in attrs
    assert SemanticConvention.GEN_AI_USAGE_DERIVED_COMPLETED_OUTPUT_TOKENS not in attrs
    assert SemanticConvention.GEN_AI_USAGE_REASONING_TOKENS not in attrs


def _chat_response(usage):
    return {
        "id": "chatcmpl_o3",
        "model": "o3-mini",
        "choices": [
            {
                "index": 0,
                "message": {"role": "assistant", "content": "The answer is 42."},
                "finish_reason": "stop",
            }
        ],
        "usage": usage,
    }


def _run_chat_response(response, metrics):
    tracer, exporter = _tracer_and_exporter()
    with tracer.start_as_current_span("chat o3-mini") as span:
        process_chat_response(
            response,
            request_model="o3-mini",
            pricing_info={},
            server_port=443,
            server_address="models.github.ai",
            environment="test-env",
            application_name="test-app",
            metrics=metrics,
            start_time=time.time(),
            span=span,
            capture_message_content=False,
            disable_metrics=False,
            version="test-version",
            **REQUEST_KWARGS,
        )
    return exporter.get_finished_spans()[0].attributes


def _stream_chunks(usage):
    chunks = [
        {
            "id": "chatcmpl_o3",
            "model": "o3-mini",
            "choices": [
                {
                    "index": 0,
                    "delta": {"role": "assistant", "content": "The answer is 42."},
                    "finish_reason": None,
                }
            ],
        },
        {"choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}]},
    ]
    if usage is not None:
        # The final chunk carries usage.
        chunks.append({"choices": [], "usage": usage})
    return chunks


class FakeSyncStream:
    """Sync context-manager stream yielding Azure AI Inference-shaped chunks."""

    def __init__(self, chunks):
        self._it = iter(chunks)

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def __iter__(self):
        return self

    def __next__(self):
        return next(self._it)


class FakeAsyncStream:
    """Async context-manager stream yielding Azure AI Inference-shaped chunks."""

    def __init__(self, chunks):
        self._it = iter(chunks)

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    def __aiter__(self):
        return self

    async def __anext__(self):
        try:
            return next(self._it)
        except StopIteration as exc:
            raise StopAsyncIteration from exc


def _factory(tracer, metrics, *, is_async):
    make = async_mod.async_complete if is_async else sync_mod.complete
    return make(
        version="test-version",
        environment="test-env",
        application_name="test-app",
        tracer=tracer,
        pricing_info={},
        capture_message_content=False,
        metrics=metrics,
        disable_metrics=False,
        event_provider=None,
    )


def _finished_stream_span_attributes(stream, exporter):
    # Stream span lifecycle is out of scope here: end the span if the wrapper
    # left it open so the exporter sees the attributes.
    if stream._span.end_time is None:
        stream._span.end()
    return exporter.get_finished_spans()[0].attributes


def _run_sync_stream(usage, metrics):
    tracer, exporter = _tracer_and_exporter()
    wrapper = _factory(tracer, metrics, is_async=False)
    stream = wrapper(
        lambda *a, **k: FakeSyncStream(_stream_chunks(usage)),
        None,
        (),
        {**REQUEST_KWARGS, "stream": True},
    )
    with stream as s:
        for _ in s:
            pass
    return _finished_stream_span_attributes(stream, exporter)


async def _run_async_stream(usage, metrics):
    tracer, exporter = _tracer_and_exporter()
    wrapper = _factory(tracer, metrics, is_async=True)

    async def _create(*_args, **_kwargs):
        return FakeAsyncStream(_stream_chunks(usage))

    stream = await wrapper(_create, None, (), {**REQUEST_KWARGS, "stream": True})
    async with stream as s:
        async for _ in s:
            pass
    return _finished_stream_span_attributes(stream, exporter)


def test_chat_reasoning_tokens_are_subset_of_output():
    """prompt 10 / completion 1000 / reasoning 700: token usage is 1010, not 1710."""
    metrics = _metrics_dict()
    attrs = _run_chat_response(_chat_response(USAGE), metrics)

    _assert_no_double_counting(attrs, metrics)


def test_chat_sdk_response_object_keeps_subset():
    """Real azure-ai-inference ChatCompletions: usage is a Mapping, not a dict."""
    models = pytest.importorskip("azure.ai.inference.models")
    metrics = _metrics_dict()
    response = models.ChatCompletions({"created": 1, **_chat_response(USAGE)})
    attrs = _run_chat_response(response, metrics)

    _assert_no_double_counting(attrs, metrics)


def test_streaming_chat_reasoning_tokens_are_subset_of_output():
    """Streaming chat with usage on the final chunk: reasoning is a subset."""
    metrics = _metrics_dict()
    attrs = _run_sync_stream(USAGE, metrics)

    _assert_no_double_counting(attrs, metrics)


@pytest.mark.asyncio
async def test_async_streaming_chat_reasoning_tokens_are_subset_of_output():
    """Async streaming chat with usage on the final chunk: reasoning is a subset."""
    metrics = _metrics_dict()
    attrs = await _run_async_stream(USAGE, metrics)

    _assert_no_double_counting(attrs, metrics)


def test_no_completion_tokens_details_marks_reasoning_unknown():
    """No completion_tokens_details: facet value absent, reported marker false."""
    metrics = _metrics_dict()
    attrs = _run_chat_response(_chat_response(USAGE_WITHOUT_DETAILS), metrics)

    _assert_reasoning_unknown(attrs, metrics)


def test_null_completion_tokens_details_does_not_crash():
    """completion_tokens_details: null is unknown, not a crash or a guessed 0."""
    metrics = _metrics_dict()
    attrs = _run_chat_response(
        _chat_response({**USAGE_WITHOUT_DETAILS, "completion_tokens_details": None}),
        metrics,
    )

    _assert_reasoning_unknown(attrs, metrics)


def test_streaming_no_completion_tokens_details_marks_reasoning_unknown():
    """Stream usage chunk without completion_tokens_details: reasoning unknown."""
    metrics = _metrics_dict()
    attrs = _run_sync_stream(USAGE_WITHOUT_DETAILS, metrics)

    _assert_reasoning_unknown(attrs, metrics)


def test_streaming_null_completion_tokens_details_does_not_crash():
    """Stream usage chunk with completion_tokens_details: null.

    process_chunk runs inside the caller's iteration with no exception guard,
    so a failure here would break the application's stream loop.
    """
    metrics = _metrics_dict()
    attrs = _run_sync_stream(
        {**USAGE_WITHOUT_DETAILS, "completion_tokens_details": None}, metrics
    )

    _assert_reasoning_unknown(attrs, metrics)


@pytest.mark.asyncio
async def test_async_streaming_null_completion_tokens_details_does_not_crash():
    """Async stream usage chunk with completion_tokens_details: null."""
    metrics = _metrics_dict()
    attrs = await _run_async_stream(
        {**USAGE_WITHOUT_DETAILS, "completion_tokens_details": None}, metrics
    )

    _assert_reasoning_unknown(attrs, metrics)


def test_top_level_reasoning_tokens_fallback_is_subset_of_output():
    """usage.reasoning_tokens fallback: still a subset, never added on top."""
    metrics = _metrics_dict()
    attrs = _run_chat_response(
        _chat_response({**USAGE_WITHOUT_DETAILS, "reasoning_tokens": 700}), metrics
    )

    _assert_no_double_counting(attrs, metrics)


def test_streaming_top_level_reasoning_tokens_fallback_is_subset_of_output():
    """Stream usage chunk with usage.reasoning_tokens: still a subset."""
    metrics = _metrics_dict()
    attrs = _run_sync_stream(
        {**USAGE_WITHOUT_DETAILS, "reasoning_tokens": 700}, metrics
    )

    _assert_no_double_counting(attrs, metrics)


def test_streaming_non_numeric_reasoning_tokens_does_not_crash():
    """Non-numeric usage.reasoning_tokens is unknown, not a crash on stream exit."""
    metrics = _metrics_dict()
    attrs = _run_sync_stream(
        {**USAGE_WITHOUT_DETAILS, "reasoning_tokens": "700"}, metrics
    )

    _assert_reasoning_unknown(attrs, metrics)


def test_zero_reasoning_tokens_is_a_measurement():
    """reasoning_tokens explicitly 0: a measurement (facet 0), not unknown."""
    metrics = _metrics_dict()
    attrs = _run_chat_response(
        _chat_response(
            {
                "prompt_tokens": 10,
                "completion_tokens": 1000,
                "completion_tokens_details": {"reasoning_tokens": 0},
            }
        ),
        metrics,
    )

    assert attrs[SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS] == 1000
    assert attrs[SemanticConvention.GEN_AI_CLIENT_TOKEN_USAGE] == 1010
    assert attrs[SemanticConvention.GEN_AI_USAGE_REASONING_OUTPUT_TOKENS] == 0
    assert (
        attrs[SemanticConvention.GEN_AI_USAGE_REASONING_OUTPUT_TOKENS_REPORTED] is True
    )
    assert (
        attrs[SemanticConvention.GEN_AI_USAGE_DERIVED_COMPLETED_OUTPUT_TOKENS] == 1000
    )
    # The legacy alias stays nonzero-only, as on the OpenAI path.
    assert SemanticConvention.GEN_AI_USAGE_REASONING_TOKENS not in attrs


def test_streaming_chat_without_usage_emits_no_reasoning_attrs():
    """Stream that never sends usage: no reasoning attributes at all."""
    attrs = _run_sync_stream(None, _metrics_dict())

    _assert_no_reasoning_usage_attrs(attrs)


@pytest.mark.asyncio
async def test_async_streaming_chat_without_usage_emits_no_reasoning_attrs():
    """Async stream that never sends usage: no reasoning attributes at all."""
    attrs = await _run_async_stream(None, _metrics_dict())

    _assert_no_reasoning_usage_attrs(attrs)
