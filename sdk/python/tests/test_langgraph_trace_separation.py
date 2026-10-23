# pylint: disable=missing-class-docstring, missing-function-docstring, too-few-public-methods
"""Interleaved LangGraph sessions keep separate traces (#1761).

The stream wrappers used to hold the workflow span as the current span for as
long as the app held the stream, so a second session run in between was
recorded as a child of the suspended session's span, and finalizing an
abandoned async stream in another task failed the context detach. The span is
now current only around each pull from the graph's iterator. These tests pin
one trace per session for interleaved sync streams and for an abandoned async
stream followed by a new session.
"""

import asyncio
import gc
import json
import logging
from typing import Annotated, TypedDict

import pytest
from opentelemetry import trace
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import (
    InMemorySpanExporter,
)

try:
    import langgraph.graph  # noqa: F401  # pylint: disable=unused-import

    LANGGRAPH_AVAILABLE = True
except ImportError:
    LANGGRAPH_AVAILABLE = False

import openlit

openlit.init(
    environment="openlit-python-testing",
    application_name="openlit-python-langgraph-trace-separation-test",
)

pytestmark = pytest.mark.skipif(
    not LANGGRAPH_AVAILABLE, reason="langgraph not installed"
)


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


def _sessions_per_trace(exporter):
    """Map each trace to the sessions mentioned in its spans' attributes."""
    out = {}
    for span in exporter.get_finished_spans():
        text = json.dumps({k: str(v) for k, v in (span.attributes or {}).items()})
        for session in ("alpha", "bravo"):
            if session in text:
                out.setdefault(span.context.trace_id, set()).add(session)
    return [sorted(sessions) for sessions in out.values()]


def _session_spans(exporter, session):
    return [
        span
        for span in exporter.get_finished_spans()
        if session in json.dumps({k: str(v) for k, v in (span.attributes or {}).items()})
    ]


class TestTraceSeparation:
    def test_interleaved_streams_keep_separate_traces(self, exporter):
        alpha = _graph().stream(
            {"messages": [("user", "alpha question")]}, stream_mode="updates"
        )
        next(alpha)
        list(
            _graph().stream(
                {"messages": [("user", "bravo question")]}, stream_mode="updates"
            )
        )
        alpha.close()

        assert _sessions_per_trace(exporter) == [["alpha"], ["bravo"]]

    @pytest.mark.asyncio
    async def test_abandoned_astream_does_not_capture_next_session(
        self, exporter, caplog
    ):
        async def run():
            stream = _graph().astream(
                {"messages": [("user", "alpha question")]}, stream_mode="updates"
            )
            await anext(stream)
            del stream
            gc.collect()
            await asyncio.sleep(0.1)
            await _graph().ainvoke({"messages": [("user", "bravo question")]})
            gc.collect()
            await asyncio.sleep(0.1)

        with caplog.at_level(logging.ERROR):
            await run()

        detach_errors = [
            record
            for record in caplog.records
            if record.levelno >= logging.ERROR
            and "Failed to detach context" in record.getMessage()
        ]
        assert detach_errors == []
        assert _sessions_per_trace(exporter) == [["alpha"], ["bravo"]]

    @pytest.mark.asyncio
    async def test_new_session_is_not_parented_under_suspended_stream(
        self, exporter
    ):
        stream = _graph().astream(
            {"messages": [("user", "alpha question")]}, stream_mode="updates"
        )
        await anext(stream)
        await _graph().ainvoke({"messages": [("user", "bravo question")]})
        await stream.aclose()

        alpha_spans = _session_spans(exporter, "alpha")
        alpha_span_ids = {span.context.span_id for span in alpha_spans}
        alpha_trace_ids = {span.context.trace_id for span in alpha_spans}
        bravo_spans = _session_spans(exporter, "bravo")
        assert alpha_spans and bravo_spans
        for span in bravo_spans:
            assert span.context.trace_id not in alpha_trace_ids
            assert span.parent is None or span.parent.span_id not in alpha_span_ids
