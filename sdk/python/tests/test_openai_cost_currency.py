"""Tests for gen_ai.usage.cost.currency attribute (Issue #1666)."""

import time
from unittest.mock import MagicMock

from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import (
    InMemorySpanExporter,
)

from openlit._config import OpenlitConfig
from openlit.instrumentation.openai.utils import (
    process_chat_response,
)
from openlit.semcov import SemanticConvention


def _tracer_and_exporter():
    OpenlitConfig.reset_to_defaults()
    exporter = InMemorySpanExporter()
    tracer_provider = TracerProvider()
    tracer_provider.add_span_processor(SimpleSpanProcessor(exporter))
    return tracer_provider.get_tracer("test-openai-cost-currency"), exporter


def _metrics_dict():
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


def test_openai_chat_cost_currency_attribute():
    """Verify that OpenAI chat response emits gen_ai.usage.cost.currency as USD."""
    tracer, exporter = _tracer_and_exporter()
    metrics = _metrics_dict()
    response = {
        "id": "chatcmpl_test",
        "model": "gpt-4o",
        "choices": [
            {
                "message": {"role": "assistant", "content": "Hello!"},
                "finish_reason": "stop",
            }
        ],
        "usage": {
            "prompt_tokens": 10,
            "completion_tokens": 5,
            "total_tokens": 15,
        },
    }
    with tracer.start_as_current_span("chat test") as span:
        process_chat_response(
            response,
            request_model="gpt-4o",
            pricing_info={"chat": {"gpt-4o": {"prompt": 0.005, "completion": 0.015}}},
            server_port=443,
            server_address="api.openai.com",
            environment="test-env",
            application_name="test-app",
            metrics=metrics,
            start_time=time.time(),
            span=span,
            capture_message_content=False,
            disable_metrics=False,
            version="test-version",
            model="gpt-4o",
            messages=[{"role": "user", "content": "hi"}],
        )

    attrs = exporter.get_finished_spans()[0].attributes
    assert SemanticConvention.GEN_AI_USAGE_COST in attrs
    assert SemanticConvention.GEN_AI_USAGE_COST_CURRENCY in attrs
    assert attrs[SemanticConvention.GEN_AI_USAGE_COST_CURRENCY] == "USD"
    assert attrs["gen_ai.usage.cost.currency"] == "USD"
