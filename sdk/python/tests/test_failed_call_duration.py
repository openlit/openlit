"""Tests: failed Bedrock/Google calls record gen_ai.client.operation.duration.

Covers 4 paths:
  1. bedrock converse (non-streaming)
  2. bedrock converse_stream (streaming)
  3. google generate (non-streaming)
  4. google generate_stream (streaming)

Plus a regression for preserving the provider error if metric recording fails.
"""
from unittest.mock import MagicMock

import pytest
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter
from opentelemetry.sdk.trace.sampling import ALWAYS_ON


class _Recorder:  # pylint: disable=too-few-public-methods
    def __init__(self):
        self.points = []
    def record(self, value, attributes=None):
        """Capture a metric point for assertion."""
        self.points.append((value, attributes))


class _Metrics(dict):
    def __init__(self):
        super().__init__()
        self["genai_client_operation_duration"] = _Recorder()
        self["genai_client_usage_tokens"] = _Recorder()
        self["genai_cost"] = _Recorder()


def _setup():
    exporter = InMemorySpanExporter()
    tp = TracerProvider(sampler=ALWAYS_ON)
    tp.add_span_processor(SimpleSpanProcessor(exporter))
    tracer = tp.get_tracer("test")
    metrics = _Metrics()
    return tracer, exporter, metrics


def _assert_single_error(exporter, metrics):
    span, = exporter.get_finished_spans()
    assert [event.name for event in span.events].count("exception") == 1
    (_, attributes), = metrics["genai_client_operation_duration"].points
    assert attributes["error.type"] == "RuntimeError"


# --- 1. bedrock converse failure ---
def test_bedrock_converse_failure_records_duration():
    """A failed Bedrock converse call still records duration."""
    tracer, exporter, metrics = _setup()
    from openlit.instrumentation.bedrock.bedrock import converse
    w = converse("t", "env", "app", tracer, {}, False, metrics, False)
    inst = MagicMock()
    inst.meta.endpoint_url = "https://bedrock-runtime.us-east-1.amazonaws.com"
    client = MagicMock()
    wrapped = MagicMock(return_value=client)
    def boom(*a, **k):
        raise RuntimeError("ThrottlingException")
    client.converse = boom
    result = w(wrapped, inst, [], {"service_name": "bedrock-runtime"})
    with pytest.raises(RuntimeError, match="ThrottlingException"):
        result.converse(modelId="claude-3", messages=[])
    _assert_single_error(exporter, metrics)


# --- 2. bedrock converse_stream failure ---
def test_bedrock_converse_stream_failure_records_duration():
    """A failed Bedrock stream call still records duration."""
    tracer, _, metrics = _setup()
    from openlit.instrumentation.bedrock.bedrock import converse_stream
    w = converse_stream("t", "env", "app", tracer, {}, False, metrics, False)
    inst = MagicMock()
    inst.meta.endpoint_url = "https://bedrock-runtime.us-east-1.amazonaws.com"
    client = MagicMock()
    wrapped = MagicMock(return_value=client)
    def boom(*a, **k):
        raise RuntimeError("ThrottlingException")
    client.converse_stream = boom
    result = w(wrapped, inst, [], {"service_name": "bedrock-runtime"})
    with pytest.raises(RuntimeError, match="ThrottlingException"):
        result.converse_stream(modelId="claude-3", messages=[])
    assert len(metrics["genai_client_operation_duration"].points) >= 1


# --- 3. google generate failure ---
def test_google_generate_failure_records_duration():
    """A failed Google generate call still records duration."""
    tracer, exporter, metrics = _setup()
    from openlit.instrumentation.google_ai_studio.google_ai_studio import generate
    w = generate("t", "env", "app", tracer, {}, False, metrics, False)
    inst = MagicMock()
    inst._api_client = MagicMock()
    def boom(*a, **k):
        raise RuntimeError("ClientError: 400")
    with pytest.raises(RuntimeError, match="ClientError"):
        w(boom, inst, [], {"model": "gemini-2.0-flash"})
    _assert_single_error(exporter, metrics)


# --- 4. google generate_stream failure ---
def test_google_generate_stream_failure_records_duration():
    """A failed Google stream call still records duration."""
    tracer, _, metrics = _setup()
    from openlit.instrumentation.google_ai_studio.google_ai_studio import generate_stream
    w = generate_stream("t", "env", "app", tracer, {}, False, metrics, False)
    inst = MagicMock()
    inst._api_client = MagicMock()
    def boom(*a, **k):
        raise RuntimeError("ClientError: 500")
    with pytest.raises(RuntimeError, match="ClientError"):
        w(boom, inst, [], {"model": "gemini-2.0-flash"})
    assert len(metrics["genai_client_operation_duration"].points) >= 1


# --- 5. regression: metric error does not mask original exception ---
def test_metric_error_does_not_mask_original():
    """A metric failure does not replace the provider error."""
    tracer, _, metrics = _setup()
    from openlit.instrumentation.bedrock.bedrock import converse
    metrics["genai_client_operation_duration"] = MagicMock(
        spec=_Recorder, record=MagicMock(side_effect=RuntimeError("metric storage broken"))
    )
    w = converse("t", "env", "app", tracer, {}, False, metrics, False)
    inst = MagicMock()
    inst.meta.endpoint_url = "https://bedrock-runtime.us-east-1.amazonaws.com"
    client = MagicMock()
    wrapped = MagicMock(return_value=client)
    def boom(*a, **k):
        raise RuntimeError("ThrottlingException")
    client.converse = boom
    result = w(wrapped, inst, [], {"service_name": "bedrock-runtime"})
    # The ORIGINAL exception must propagate, not the metric error
    with pytest.raises(RuntimeError, match="ThrottlingException"):
        result.converse(modelId="claude-3", messages=[])
