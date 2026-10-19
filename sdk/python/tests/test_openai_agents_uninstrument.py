"""
Regression tests: OpenAIAgentsInstrumentor.uninstrument() must remove only
OpenLIT's trace processor (not the application's), end the spans it still
holds, and unwrap Agent.__init__.
"""

import pytest

agents = pytest.importorskip("agents")

from agents import Agent, add_trace_processor, set_trace_processors
from agents.tracing import TracingProcessor, get_trace_provider
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import (
    InMemorySpanExporter,
)

from openlit._config import OpenlitConfig
from openlit.instrumentation.openai_agents import OpenAIAgentsInstrumentor


class _AppProcessor(TracingProcessor):
    def on_trace_start(self, trace):
        pass

    def on_trace_end(self, trace):
        pass

    def on_span_start(self, span):
        pass

    def on_span_end(self, span):
        pass

    def shutdown(self):
        pass

    def force_flush(self):
        pass


def _processors():
    return list(get_trace_provider()._multi_processor._processors)


@pytest.fixture
def instrumentor():
    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    OpenlitConfig.metrics_dict = {}
    OpenlitConfig.custom_span_attributes = {}
    original = trace.get_tracer
    trace.get_tracer = lambda *a, **k: provider.get_tracer(*a, **k)
    inst = OpenAIAgentsInstrumentor()
    inst.exporter = exporter
    try:
        yield inst
    finally:
        inst.uninstrument()
        trace.get_tracer = original
        set_trace_processors([])


def test_uninstrument_keeps_application_processor(instrumentor):
    app = _AppProcessor()
    instrumentor.instrument(disable_metrics=True)
    add_trace_processor(app)

    instrumentor.uninstrument()

    assert _processors() == [app]


def test_uninstrument_ends_open_spans(instrumentor):
    instrumentor.instrument(disable_metrics=True)
    processor = instrumentor._processor
    span = trace.get_tracer("t").start_span("invoke_agent")
    processor._otel_spans["x"] = (span, None, None, None)

    instrumentor.uninstrument()

    assert not span.is_recording()
    assert not processor._otel_spans


def test_uninstrument_unwraps_agent_init(instrumentor):
    instrumentor.instrument(disable_metrics=True)
    Agent(name="a")
    assert len(instrumentor.exporter.get_finished_spans()) == 1

    instrumentor.uninstrument()
    instrumentor.exporter.clear()
    Agent(name="b")

    assert not instrumentor.exporter.get_finished_spans()
