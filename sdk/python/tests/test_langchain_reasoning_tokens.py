"""Invariant tests for LangChain reasoning token telemetry (#1537).

LangChain's normalized usage reports reasoning as a breakdown of
``output_tokens``, so reasoning tokens are a subset of the output total and
must never be added on top of ``gen_ai.client.token.usage``. The callback
handler does not populate ``scope._reasoning_tokens`` today; these tests pin
``common_chat_logic`` to the subset invariant for when it does, and pin the
current callback scope to emitting no reasoning attributes.
"""

import time
from types import SimpleNamespace
from unittest.mock import MagicMock

from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import (
    InMemorySpanExporter,
)

from openlit._config import OpenlitConfig
from openlit.instrumentation.langchain.utils import common_chat_logic
from openlit.semcov import SemanticConvention


def _tracer_and_exporter():
    OpenlitConfig.reset_to_defaults()
    exporter = InMemorySpanExporter()
    tracer_provider = TracerProvider()
    tracer_provider.add_span_processor(SimpleSpanProcessor(exporter))
    return tracer_provider.get_tracer("test-langchain-reasoning-tokens"), exporter


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


def _callback_scope(span, **extra):
    """Mirrors the scope OpenLITCallbackHandler builds before common_chat_logic."""
    now = time.time()
    return SimpleNamespace(
        _span=span,
        _kwargs={},
        _model_parameters={},
        _start_time=now,
        _end_time=now,
        _server_address="api.openai.com",
        _server_port=443,
        _response_model="o3-mini",
        _response_id="chatcmpl_o3",
        _llmresponse="The answer is 42.",
        _finish_reason="stop",
        _tools=None,
        _input_tokens=10,
        _output_tokens=1000,
        _cache_read_input_tokens=0,
        _cache_creation_input_tokens=0,
        _timestamps=[],
        _tbt=0,
        _ttft=0,
        _request_model="o3-mini",
        _input_messages_raw=None,
        _prompts=["think step by step"],
        _system_instructions=None,
        _tool_definitions=None,
        _provider="openai",
        **extra,
    )


def _run_common_chat_logic(metrics, **extra):
    tracer, exporter = _tracer_and_exporter()
    with tracer.start_as_current_span("chat o3-mini") as span:
        common_chat_logic(
            _callback_scope(span, **extra),
            pricing_info={},
            environment="test-env",
            application_name="test-app",
            metrics=metrics,
            capture_message_content=False,
            disable_metrics=False,
            version="test-version",
            is_stream=False,
        )
    return exporter.get_finished_spans()[0].attributes


def test_reasoning_tokens_are_subset_of_output():
    """prompt 10 / output 1000 / reasoning 700: token usage is 1010, not 1710."""
    metrics = _metrics_dict()
    attrs = _run_common_chat_logic(metrics, _reasoning_tokens=700)

    assert attrs[SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS] == 1000
    assert attrs[SemanticConvention.GEN_AI_CLIENT_TOKEN_USAGE] == 1010
    assert attrs[SemanticConvention.GEN_AI_USAGE_REASONING_OUTPUT_TOKENS] == 700
    assert attrs[SemanticConvention.GEN_AI_USAGE_REASONING_TOKENS] == 700
    assert (
        attrs[SemanticConvention.GEN_AI_USAGE_REASONING_OUTPUT_TOKENS_REPORTED] is True
    )
    assert attrs[SemanticConvention.GEN_AI_USAGE_DERIVED_COMPLETED_OUTPUT_TOKENS] == 300
    assert all(value not in (1700, 1710) for value in attrs.values())
    for call in metrics["genai_client_usage_tokens"].record.call_args_list:
        assert call.args[0] not in (1700, 1710)


def test_callback_scope_without_reasoning_tokens_emits_no_reasoning_attrs():
    """The callback handler sets no _reasoning_tokens: nothing is emitted."""
    attrs = _run_common_chat_logic(_metrics_dict())

    assert attrs[SemanticConvention.GEN_AI_CLIENT_TOKEN_USAGE] == 1010
    assert SemanticConvention.GEN_AI_USAGE_REASONING_OUTPUT_TOKENS not in attrs
    assert SemanticConvention.GEN_AI_USAGE_REASONING_OUTPUT_TOKENS_REPORTED not in attrs
    assert SemanticConvention.GEN_AI_USAGE_DERIVED_COMPLETED_OUTPUT_TOKENS not in attrs
    assert SemanticConvention.GEN_AI_USAGE_REASONING_TOKENS not in attrs
