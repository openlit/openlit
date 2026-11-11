"""Regression tests: OpenAIAgentsInstrumentor.uninstrument() undoes only its own setup.

It used to call ``set_trace_processors([])``, which also dropped processors the
application registered, left OpenLIT's in-flight spans open, and kept the
``Agent.__init__`` wrapper, so instrumenting again emitted two ``create_agent``
spans per agent.
"""

import pytest

agents = pytest.importorskip("agents")

from agents import Agent, add_trace_processor
from agents.tracing import get_trace_provider
from agents.tracing.processor_interface import TracingProcessor
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import (
    InMemorySpanExporter,
)

from openlit._config import OpenlitConfig
from openlit.instrumentation.openai_agents import OpenAIAgentsInstrumentor

_EXPORTER = InMemorySpanExporter()
_PROVIDER = TracerProvider()
_PROVIDER.add_span_processor(SimpleSpanProcessor(_EXPORTER))
trace.set_tracer_provider(_PROVIDER)


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


def _create_agent_spans():
    _EXPORTER.clear()
    Agent(name="assistant")
    return [s.name for s in _EXPORTER.get_finished_spans()]


def test_uninstrument_keeps_app_processor_and_removes_agent_wrapper():
    OpenlitConfig.reset_to_defaults()
    instrumentor = OpenAIAgentsInstrumentor()
    instrumentor.instrument(disable_metrics=True)
    app = _AppProcessor()
    add_trace_processor(app)
    try:
        instrumentor.uninstrument()

        assert _processors() == [app]
        assert _create_agent_spans() == []

        instrumentor.instrument(disable_metrics=True)
        assert _create_agent_spans() == ["create_agent assistant"]
    finally:
        instrumentor.uninstrument()
