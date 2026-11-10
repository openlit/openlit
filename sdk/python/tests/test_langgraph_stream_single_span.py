# pylint: disable=missing-class-docstring, missing-function-docstring, too-few-public-methods
"""One workflow span per LangGraph call, for stream() as for invoke() (#1766).

langgraph.pregel.Pregel and langgraph.pregel.main.Pregel are the same class in
current LangGraph, so EXECUTION_OPERATIONS and EXECUTION_OPERATIONS_ALT each
wrapped every Pregel method. For invoke() the outer wrapper's suppression hid
the duplicate; for stream()/astream() the graph runs while the consumer
iterates the returned generator, outside that window, so one call recorded
three nested workflow spans. These tests pin one wrapper layer per method and
one invoke_workflow span per call for invoke, stream and astream alike.
"""

from typing import Annotated, TypedDict

import pytest
from opentelemetry import trace
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import (
    InMemorySpanExporter,
)

try:
    import langgraph.pregel
    import langgraph.pregel.main

    LANGGRAPH_AVAILABLE = True
except ImportError:
    LANGGRAPH_AVAILABLE = False

import openlit

openlit.init(
    environment="openlit-python-testing",
    application_name="openlit-python-langgraph-single-span-test",
)

pytestmark = pytest.mark.skipif(
    not LANGGRAPH_AVAILABLE, reason="langgraph not installed"
)


def _wrapper_layers(func):
    layers = 0
    while hasattr(func, "__wrapped__"):
        layers, func = layers + 1, func.__wrapped__
    return layers


def _workflow_spans(exporter):
    return [
        span
        for span in exporter.get_finished_spans()
        if span.name.startswith("invoke_workflow")
    ]


def _graph():
    from langgraph.graph import END, START, StateGraph
    from langgraph.graph.message import add_messages

    class _State(TypedDict):
        messages: Annotated[list, add_messages]

    def _node(state):
        return {"messages": [{"role": "assistant", "content": "Paris."}]}

    graph = StateGraph(_State)
    graph.add_node("agent", _node)
    graph.add_edge(START, "agent")
    graph.add_edge("agent", END)
    return graph.compile()


@pytest.fixture(name="exporter")
def _exporter_fixture():
    exporter = InMemorySpanExporter()
    provider = trace.get_tracer_provider()
    processor = SimpleSpanProcessor(exporter)
    provider.add_span_processor(processor)
    # Each test attaches its own processor/exporter and reads only its own,
    # so there is nothing to unwind afterwards.
    yield exporter


class TestWrappedOnce:
    @pytest.mark.parametrize(
        "method", ["invoke", "stream", "ainvoke", "astream", "get_state", "aget_state"]
    )
    def test_pregel_method_has_one_wrapper_layer(self, method):
        assert langgraph.pregel.Pregel is langgraph.pregel.main.Pregel
        assert _wrapper_layers(getattr(langgraph.pregel.Pregel, method)) == 1


class TestOneWorkflowSpanPerCall:
    def test_invoke_records_one_workflow_span(self, exporter):
        _graph().invoke({"messages": [("user", "Capital of France?")]})
        assert len(_workflow_spans(exporter)) == 1

    def test_stream_records_one_workflow_span(self, exporter):
        list(
            _graph().stream(
                {"messages": [("user", "Capital of France?")]}, stream_mode="updates"
            )
        )
        assert len(_workflow_spans(exporter)) == 1

    @pytest.mark.asyncio
    async def test_astream_records_one_workflow_span(self, exporter):
        async def run():
            return [
                chunk
                async for chunk in _graph().astream(
                    {"messages": [("user", "Capital of France?")]},
                    stream_mode="updates",
                )
            ]

        await run()
        assert len(_workflow_spans(exporter)) == 1
