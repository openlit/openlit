"""Manual traces must cover the execution of decorated coroutines."""

import asyncio
import inspect
from functools import wraps

import pytest
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter
from opentelemetry.trace import StatusCode

import openlit
from openlit.semcov import SemanticConvention


@pytest.fixture(name="telemetry")
def telemetry_provider(monkeypatch):
    """Use an isolated real SDK provider and exporter for each operation."""
    provider = TracerProvider()
    exporter = InMemorySpanExporter()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    monkeypatch.setattr(openlit.t, "get_tracer_provider", lambda: provider)
    monkeypatch.setattr(openlit.OpenlitConfig, "application_name", "booking", raising=False)
    monkeypatch.setattr(openlit.OpenlitConfig, "environment", "test", raising=False)
    monkeypatch.setattr(openlit.OpenlitConfig, "capture_message_content", True, raising=False)
    monkeypatch.setattr(openlit.OpenlitConfig, "max_content_length", None, raising=False)
    yield provider.get_tracer("test"), exporter
    provider.shutdown()


@pytest.mark.asyncio
async def test_coroutine_trace_covers_execution_and_parents_children(telemetry):
    """Await the result inside the parent span, retaining wrapper metadata."""
    tracer, exporter = telemetry

    @openlit.trace
    async def reserve(duration):
        """Reserve a room."""
        await asyncio.sleep(0)
        with tracer.start_as_current_span("calendar"):
            return f"booked:{duration}"

    operation = reserve(45)
    ended_before_await = exporter.get_finished_spans()
    assert await operation == "booked:45"
    assert ended_before_await == ()
    assert inspect.iscoroutinefunction(reserve)
    assert reserve.__name__ == "reserve"
    assert reserve.__doc__ == "Reserve a room."
    child, parent = exporter.get_finished_spans()
    assert parent.name == "reserve"
    assert child.parent == parent.context
    assert child.end_time <= parent.end_time
    assert parent.status.status_code == StatusCode.OK
    assert parent.attributes[SemanticConvention.GEN_AI_OUTPUT_MESSAGES] == "booked:45"
    assert parent.attributes["service.name"] == "booking"
    assert parent.attributes["deployment.environment"] == "test"
    assert parent.attributes["function.args"] == "(45,)"


@pytest.mark.asyncio
async def test_coroutine_trace_records_the_original_exception(telemetry):
    """An error after suspension must update the exported operation span."""
    _, exporter = telemetry
    error = ValueError("calendar unavailable")

    @openlit.trace
    async def reserve():
        await asyncio.sleep(0)
        raise error

    with pytest.raises(ValueError) as caught:
        await reserve()
    assert caught.value is error
    (span,) = exporter.get_finished_spans()
    assert span.status.status_code == StatusCode.ERROR
    assert any(event.name == "exception" for event in span.events)
    assert span.attributes["service.name"] == "booking"
    assert span.attributes["function.args"] == "()"


@pytest.mark.asyncio
async def test_overlapping_coroutines_have_separate_parent_spans(telemetry):
    """Concurrent agent operations must retain separate trace contexts."""
    tracer, exporter = telemetry
    both_started = asyncio.Event()
    started = 0

    @openlit.trace
    async def reserve(label):
        nonlocal started
        started += 1
        if started == 2:
            both_started.set()
        await both_started.wait()
        with tracer.start_as_current_span(f"calendar:{label}"):
            return label

    assert await asyncio.gather(reserve("a"), reserve("b")) == ["a", "b"]
    spans = exporter.get_finished_spans()
    parents = {span.context.span_id: span for span in spans if span.name == "reserve"}
    children = [span for span in spans if span.name.startswith("calendar:")]
    assert len(parents) == len(children) == 2
    assert all(child.parent and child.parent.span_id in parents for child in children)
    assert children[0].parent != children[1].parent
    assert not trace.get_current_span().get_span_context().is_valid


@pytest.mark.asyncio
async def test_cancellation_ends_the_running_span(telemetry):
    """Cancellation must close a span that was still active during execution."""
    _, exporter = telemetry
    started = asyncio.Event()

    @openlit.trace
    async def reserve():
        started.set()
        await asyncio.Future()

    operation = asyncio.create_task(reserve())
    await started.wait()
    ended_while_running = exporter.get_finished_spans()
    operation.cancel()
    with pytest.raises(asyncio.CancelledError):
        await operation
    assert ended_while_running == ()
    assert len(exporter.get_finished_spans()) == 1
    (span,) = exporter.get_finished_spans()
    assert span.status.status_code == StatusCode.ERROR
    assert any(event.name == "exception" for event in span.events)
    assert span.attributes["service.name"] == "booking"
    assert span.attributes["function.args"] == "()"
    assert not trace.get_current_span().get_span_context().is_valid


@pytest.mark.parametrize("fails", [False, True])
def test_synchronous_trace_still_records_results_and_errors(telemetry, fails):
    """Keep the existing synchronous behavior when selecting a wrapper."""
    _, exporter = telemetry

    @openlit.trace
    def reserve():
        if fails:
            raise ValueError("calendar unavailable")
        return "booked"

    if fails:
        with pytest.raises(ValueError, match="calendar unavailable"):
            reserve()
    else:
        assert reserve() == "booked"
    (span,) = exporter.get_finished_spans()
    assert span.status.status_code == (StatusCode.ERROR if fails else StatusCode.OK)
    assert span.attributes["service.name"] == "booking"
    assert span.attributes["function.args"] == "()"
    if not fails:
        assert span.attributes[SemanticConvention.GEN_AI_OUTPUT_MESSAGES] == "booked"


@pytest.mark.asyncio
@pytest.mark.parametrize("asynchronous", [False, True])
@pytest.mark.parametrize(
    "value, expected",
    [(False, "False"), (0, "0"), ({"booked": True}, "{'booked': True}"), ([], "[]"), (None, "")],
)
async def test_manual_trace_preserves_falsey_and_structured_results(
    telemetry, asynchronous, value, expected
):
    """Real exported output must represent the exact returned value."""
    _, exporter = telemetry

    def synchronous():
        return value

    async def coroutine():
        return value

    operation = openlit.trace(coroutine if asynchronous else synchronous)
    result = await operation() if asynchronous else operation()
    assert result is value
    (span,) = exporter.get_finished_spans()
    assert span.attributes[SemanticConvention.GEN_AI_OUTPUT_MESSAGES] == expected


@pytest.mark.asyncio
@pytest.mark.parametrize("asynchronous", [False, True])
async def test_manual_trace_honors_content_capture_opt_out(
    telemetry, monkeypatch, asynchronous
):
    """Opted-out arguments and results must not reach the real exporter."""
    _, exporter = telemetry
    monkeypatch.setattr(openlit.OpenlitConfig, "capture_message_content", False)

    def synchronous(value, *, label):
        return value + label

    async def coroutine(value, *, label):
        return value + label

    operation = openlit.trace(coroutine if asynchronous else synchronous)
    result = operation("private-input", label="private-label")
    if asynchronous:
        result = await result
    assert result == "private-inputprivate-label"
    (span,) = exporter.get_finished_spans()
    assert "function.args" not in span.attributes
    assert "function.kwargs" not in span.attributes
    assert SemanticConvention.GEN_AI_OUTPUT_MESSAGES not in span.attributes
    assert span.attributes["service.name"] == "booking"


@pytest.mark.asyncio
@pytest.mark.parametrize("asynchronous", [False, True])
async def test_manual_trace_honors_configured_content_limit(
    telemetry, monkeypatch, asynchronous
):
    """Use the SDK's configured limit for captured inputs and outputs."""
    _, exporter = telemetry
    monkeypatch.setattr(openlit.OpenlitConfig, "max_content_length", 5)

    def synchronous(value, *, label):
        return value + label

    async def coroutine(value, *, label):
        return value + label

    operation = openlit.trace(coroutine if asynchronous else synchronous)
    result = operation("private-input", label="private-label")
    if asynchronous:
        result = await result
    assert result == "private-inputprivate-label"
    (span,) = exporter.get_finished_spans()
    assert span.attributes[SemanticConvention.GEN_AI_OUTPUT_MESSAGES] == "priva..."
    assert span.attributes["function.args"] == "('pri..."
    assert span.attributes["function.kwargs"] == "{'lab..."


@pytest.mark.asyncio
async def test_manual_trace_unwraps_decorated_coroutines(telemetry):
    """A functools-wrapped coroutine must still execute inside its span."""
    tracer, exporter = telemetry

    def decorate(function):
        @wraps(function)
        def wrapper(*args, **kwargs):
            return function(*args, **kwargs)
        return wrapper

    @openlit.trace
    @decorate
    async def reserve():
        await asyncio.sleep(0)
        with tracer.start_as_current_span("calendar"):
            return "booked"

    operation = reserve()
    assert exporter.get_finished_spans() == ()
    assert await operation == "booked"
    child, parent = exporter.get_finished_spans()
    assert child.parent == parent.context
    assert parent.attributes[SemanticConvention.GEN_AI_OUTPUT_MESSAGES] == "booked"
