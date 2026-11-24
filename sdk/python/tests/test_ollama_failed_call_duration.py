"""Failed non-streaming Ollama calls retain their errors and duration observations."""

import asyncio
from types import SimpleNamespace

import pytest
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.metrics.export import InMemoryMetricReader
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter
from opentelemetry.trace import StatusCode

from openlit._config import OpenlitConfig
from openlit.instrumentation.ollama import async_ollama as async_mod
from openlit.instrumentation.ollama import ollama as sync_mod
from openlit.otel.metrics import setup_meter


@pytest.fixture(name="call_path", params=["sync-chat", "sync-generate", "async-chat", "async-generate"])
def _call_path(request):
    """The four wrappers have separate provider-call error boundaries."""
    mode, operation = request.param.split("-")
    module = async_mod if mode == "async" else sync_mod
    factory = getattr(module, f"async_{operation}" if mode == "async" else operation)
    return SimpleNamespace(module=module, factory=factory, operation=operation, is_async=mode == "async")


@pytest.fixture(name="telemetry")
def _telemetry(monkeypatch):
    """Use local providers without changing the process-wide OTel providers."""
    OpenlitConfig()
    monkeypatch.setattr(OpenlitConfig, "custom_metrics_attributes", {})
    monkeypatch.setattr(OpenlitConfig, "custom_span_attributes", {})
    reader = InMemoryMetricReader()
    meter_provider = MeterProvider(metric_readers=[reader])
    instruments, error = setup_meter("test-app", "test-env", meter_provider.get_meter(__name__), None, None)
    assert error is None
    exporter = InMemorySpanExporter()
    tracer_provider = TracerProvider()
    tracer_provider.add_span_processor(SimpleSpanProcessor(exporter))
    yield SimpleNamespace(
        reader=reader,
        metrics=instruments,
        tracer=tracer_provider.get_tracer(__name__),
        exporter=exporter,
    )
    tracer_provider.shutdown()
    meter_provider.shutdown()


def _invoke(path, telemetry, *, error=None, disable_metrics=False):
    response = {
        "model": "llama3.2",
        "done": True,
        "done_reason": "stop",
        "prompt_eval_count": 3,
        "eval_count": 1,
    }
    kwargs = {"json": {"model": "llama3.2"}, "stream": False}
    if path.operation == "chat":
        response["message"] = {"role": "assistant", "content": "Hello"}
        kwargs["json"]["messages"] = [{"role": "user", "content": "hi"}]
    else:
        response["response"] = "Hello"
        kwargs["json"]["prompt"] = "hi"

    def provider_call(*_args, **_kwargs):
        if error is not None:
            raise error
        return response

    async def async_provider_call(*args, **kwargs):
        return provider_call(*args, **kwargs)

    wrapper = path.factory(
        version="test-version",
        environment="test-env",
        application_name="test-app",
        tracer=telemetry.tracer,
        pricing_info={},
        capture_message_content=False,
        metrics=telemetry.metrics,
        disable_metrics=disable_metrics,
    )
    instance = SimpleNamespace(_client=SimpleNamespace(base_url="http://ollama.test:12345"))
    result = wrapper(async_provider_call if path.is_async else provider_call, instance, (), kwargs)
    return asyncio.run(result) if path.is_async else result


def _points(reader, name):
    data = reader.get_metrics_data()
    return [
        point
        for resource in (data.resource_metrics if data else [])
        for scope in resource.scope_metrics
        for metric in scope.metrics
        if metric.name == name
        for point in metric.data.data_points
    ]


def _assert_error_span(telemetry, error):
    spans = telemetry.exporter.get_finished_spans()
    assert len(spans) == 1
    assert spans[0].status.status_code == StatusCode.ERROR
    exceptions = [event for event in spans[0].events if event.name == "exception"]
    assert len(exceptions) == 1
    assert exceptions[0].attributes["exception.message"] == str(error)


def test_failed_call_records_one_duration_and_preserves_error(call_path, telemetry, monkeypatch):
    """A quarter-second provider failure has one error-tagged observation, not token usage."""
    ticks = iter((10.0, 10.25))
    monkeypatch.setattr(call_path.module, "time", SimpleNamespace(monotonic=lambda: next(ticks)))
    error = RuntimeError("provider rejected request")

    with pytest.raises(RuntimeError) as caught:
        _invoke(call_path, telemetry, error=error)

    assert caught.value is error
    points = _points(telemetry.reader, "gen_ai.client.operation.duration")
    assert len(points) == 1
    assert points[0].count == 1
    assert points[0].sum == pytest.approx(0.25)
    expected = {
        "gen_ai.operation.name": "chat" if call_path.operation == "chat" else "text_completion",
        "gen_ai.provider.name": "ollama",
        "gen_ai.request.model": "llama3.2",
        "gen_ai.response.model": "unknown",
        "server.address": "ollama.test",
        "server.port": 12345,
        "error.type": "RuntimeError",
        "service.name": "test-app",
        "deployment.environment": "test-env",
    }
    assert expected.items() <= points[0].attributes.items()
    assert _points(telemetry.reader, "gen_ai.client.token.usage") == []
    _assert_error_span(telemetry, error)


def test_success_keeps_response_usage_and_single_duration(call_path, telemetry):
    """Failure accounting must not add a second observation to successful calls."""
    response = _invoke(call_path, telemetry)

    text = response["message"]["content"] if call_path.operation == "chat" else response["response"]
    assert text == "Hello"
    assert (response["prompt_eval_count"], response["eval_count"]) == (3, 1)
    points = _points(telemetry.reader, "gen_ai.client.operation.duration")
    assert len(points) == 1
    assert points[0].count == 1
    assert "error.type" not in points[0].attributes
    tokens = _points(telemetry.reader, "gen_ai.client.token.usage")
    assert {point.attributes["gen_ai.token.type"]: (point.count, point.sum) for point in tokens} == {
        "input": (1, 3),
        "output": (1, 1),
    }
    spans = telemetry.exporter.get_finished_spans()
    assert len(spans) == 1
    assert spans[0].status.status_code == StatusCode.OK


def test_disabled_metrics_preserve_success_and_error(call_path, telemetry):
    """Disabling metrics applies to both provider outcomes."""
    response = _invoke(call_path, telemetry, disable_metrics=True)
    text = response["message"]["content"] if call_path.operation == "chat" else response["response"]
    assert text == "Hello"
    error = RuntimeError("provider rejected request")
    with pytest.raises(RuntimeError) as caught:
        _invoke(call_path, telemetry, error=error, disable_metrics=True)

    assert caught.value is error
    assert _points(telemetry.reader, "gen_ai.client.operation.duration") == []
    assert _points(telemetry.reader, "gen_ai.client.token.usage") == []
    spans = telemetry.exporter.get_finished_spans()
    assert [span.status.status_code for span in spans] == [StatusCode.OK, StatusCode.ERROR]


def test_late_metric_failure_cannot_replace_or_retry_provider_error(call_path, telemetry, monkeypatch):
    """A failure after recording duration must neither hide the provider error nor double-count."""
    def fail_cost_record(*_args, **_kwargs):
        raise ValueError("cost instrument failed")

    monkeypatch.setattr(telemetry.metrics["genai_cost"], "record", fail_cost_record)
    error = RuntimeError("provider rejected request")
    with pytest.raises(RuntimeError) as caught:
        _invoke(call_path, telemetry, error=error)

    assert caught.value is error
    points = _points(telemetry.reader, "gen_ai.client.operation.duration")
    assert len(points) == 1
    assert points[0].count == 1
    assert points[0].attributes["error.type"] == "RuntimeError"
    _assert_error_span(telemetry, error)
