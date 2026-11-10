"""Regression tests for Together provider failure telemetry (related to #1705)."""

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

from openlit.instrumentation.together.together import completion
from openlit.semcov import SemanticConvention


def _tracer_and_exporter():
    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    return provider.get_tracer("test-together-errors"), exporter


def _together_instance():
    return SimpleNamespace(_client=SimpleNamespace(base_url="https://api.together.xyz"))


def _raise_api_error(*_args, **_kwargs):
    raise RuntimeError("upstream unavailable")


def test_failed_together_chat_call_records_duration_metric():
    """A failed provider call must record gen_ai.client.operation.duration with error.type."""
    tracer, exporter = _tracer_and_exporter()
    metrics = {
        "genai_client_operation_duration": MagicMock(),
        "genai_client_token_usage": MagicMock(),
    }
    wrapper = completion(
        version="test-version",
        environment="test-env",
        application_name="test-app",
        tracer=tracer,
        pricing_info={},
        capture_message_content=False,
        metrics=metrics,
        disable_metrics=False,
    )

    with pytest.raises(RuntimeError):
        wrapper(
            _raise_api_error,
            _together_instance(),
            [],
            {"model": "meta-llama/Llama-3.3-70B-Instruct-Turbo", "messages": [{"role": "user", "content": "hi"}]},
        )

    metrics["genai_client_operation_duration"].record.assert_called_once()

    spans = exporter.get_finished_spans()
    assert len(spans) == 1
    assert spans[0].attributes[SemanticConvention.ERROR_TYPE] == "RuntimeError"


def test_failed_together_stream_start_records_duration_metric():
    """A provider call that fails before a stream is returned still records the duration metric."""
    tracer, exporter = _tracer_and_exporter()
    metrics = {
        "genai_client_operation_duration": MagicMock(),
        "genai_client_token_usage": MagicMock(),
    }
    wrapper = completion(
        version="test-version",
        environment="test-env",
        application_name="test-app",
        tracer=tracer,
        pricing_info={},
        capture_message_content=False,
        metrics=metrics,
        disable_metrics=False,
    )

    with pytest.raises(RuntimeError):
        wrapper(
            _raise_api_error,
            _together_instance(),
            [],
            {
                "model": "meta-llama/Llama-3.3-70B-Instruct-Turbo",
                "messages": [{"role": "user", "content": "hi"}],
                "stream": True,
            },
        )

    metrics["genai_client_operation_duration"].record.assert_called_once()
    spans = exporter.get_finished_spans()
    assert len(spans) == 1
    assert spans[0].attributes[SemanticConvention.ERROR_TYPE] == "RuntimeError"
