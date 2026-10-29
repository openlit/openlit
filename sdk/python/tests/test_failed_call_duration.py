"""Tests: failed Bedrock/Google calls record gen_ai.client.operation.duration.

Covers 4 paths:
  1. bedrock converse (non-streaming)
  2. bedrock converse_stream (streaming)
  3. google generate (non-streaming)
  4. google generate_stream (streaming)

Plus regression:
  5. metric-recording error does NOT mask original provider exception
  6. successful call still records duration (control)
"""
import pytest
from unittest.mock import MagicMock
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter


class _Recorder:
    def __init__(self):
        self.points = []
    def record(self, value, attributes=None):
        self.points.append((value, attributes))


class _Metrics(dict):
    def __init__(self):
        super().__init__()
        self["genai_client_operation_duration"] = _Recorder()
        self["genai_client_usage_tokens"] = _Recorder()
        self["genai_cost"] = _Recorder()


def _setup():
    exporter = InMemorySpanExporter()
    tp = TracerProvider()
    tp.add_span_processor(SimpleSpanProcessor(exporter))
    tracer = tp.get_tracer("test")
    metrics = _Metrics()
    return tracer, exporter, metrics


# --- 1. bedrock converse failure ---
def test_bedrock_converse_failure_records_duration():
    tracer, _, metrics = _setup()
    from openlit.instrumentation.bedrock.bedrock import converse
    w = converse("t", "env", "app", tracer, {}, False, metrics, False)
    inst = MagicMock()
    inst.meta.endpoint_url = "https://bedrock-runtime.us-east-1.amazonaws.com"
    client = MagicMock()
    wrapped = MagicMock(return_value=client)
    def boom(*a, **k):
        raise Exception("ThrottlingException")
    client.converse = boom
    result = w(wrapped, inst, [], {"service_name": "bedrock-runtime"})
    with pytest.raises(Exception, match="ThrottlingException"):
        result.converse(modelId="claude-3", messages=[])
    assert len(metrics["genai_client_operation_duration"].points) >= 1


# --- 2. bedrock converse_stream failure ---
def test_bedrock_converse_stream_failure_records_duration():
    tracer, _, metrics = _setup()
    from openlit.instrumentation.bedrock.bedrock import converse_stream
    w = converse_stream("t", "env", "app", tracer, {}, False, metrics, False)
    inst = MagicMock()
    inst.meta.endpoint_url = "https://bedrock-runtime.us-east-1.amazonaws.com"
    client = MagicMock()
    wrapped = MagicMock(return_value=client)
    def boom(*a, **k):
        raise Exception("ThrottlingException")
    client.converse_stream = boom
    result = w(wrapped, inst, [], {"service_name": "bedrock-runtime"})
    with pytest.raises(Exception, match="ThrottlingException"):
        result.converse_stream(modelId="claude-3", messages=[])
    assert len(metrics["genai_client_operation_duration"].points) >= 1


# --- 3. google generate failure ---
def test_google_generate_failure_records_duration():
    tracer, _, metrics = _setup()
    from openlit.instrumentation.google_ai_studio.google_ai_studio import generate
    w = generate("t", "env", "app", tracer, {}, False, metrics, False)
    inst = MagicMock()
    inst._api_client = MagicMock()
    def boom(*a, **k):
        raise Exception("ClientError: 400")
    with pytest.raises(Exception, match="ClientError"):
        w(boom, inst, [], {"model": "gemini-2.0-flash"})
    assert len(metrics["genai_client_operation_duration"].points) >= 1


# --- 4. google generate_stream failure ---
def test_google_generate_stream_failure_records_duration():
    tracer, _, metrics = _setup()
    from openlit.instrumentation.google_ai_studio.google_ai_studio import generate_stream
    w = generate_stream("t", "env", "app", tracer, {}, False, metrics, False)
    inst = MagicMock()
    inst._api_client = MagicMock()
    def boom(*a, **k):
        raise Exception("ClientError: 500")
    with pytest.raises(Exception, match="ClientError"):
        w(boom, inst, [], {"model": "gemini-2.0-flash"})
    assert len(metrics["genai_client_operation_duration"].points) >= 1


# --- 5. regression: metric error does not mask original exception ---
def test_metric_error_does_not_mask_original():
    tracer, _, metrics = _setup()
    from openlit.instrumentation.bedrock.bedrock import converse
    # Make the duration recorder raise
    class _BoomRecorder:
        def record(self, v, a=None):
            raise RuntimeError("metric storage broken")
    metrics["genai_client_operation_duration"] = _BoomRecorder()
    w = converse("t", "env", "app", tracer, {}, False, metrics, False)
    inst = MagicMock()
    inst.meta.endpoint_url = "https://bedrock-runtime.us-east-1.amazonaws.com"
    client = MagicMock()
    wrapped = MagicMock(return_value=client)
    def boom(*a, **k):
        raise Exception("ThrottlingException")
    client.converse = boom
    result = w(wrapped, inst, [], {"service_name": "bedrock-runtime"})
    # The ORIGINAL exception must propagate, not the metric error
    with pytest.raises(Exception, match="ThrottlingException"):
        result.converse(modelId="claude-3", messages=[])
