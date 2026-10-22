# pylint: disable=redefined-outer-name, missing-function-docstring
"""Regression test: one ``Agent.run_sync`` call must produce one agent span.

``Agent.run_sync`` is implemented on top of ``Agent.run``, and the Pydantic AI
instrumentor wraps both of them without any re-entrancy guard. A single
``run_sync`` call therefore emits two nested agent spans (``invoke_agent
<name>`` from the sync wrapper and ``execute_task <name>`` from the async
wrapper), each carrying the full ``gen_ai.usage.*`` token counts, so the run's
token usage is double-counted by anything that aggregates spans.

Both entry points must also produce the same span shape, an ``invoke_agent
<name>`` span with ``gen_ai.operation.name=invoke_agent`` as in the OTel GenAI
agent span conventions, and agents called while a ``run_sync`` is in progress
must still get their own span.

The test drives a real ``pydantic_ai.Agent`` with the offline ``TestModel``,
so no network access or API key is needed.
"""

import os

import pytest

pytest.importorskip("pydantic_ai")

os.environ.setdefault("PYDANTIC_AI_NO_BANNER", "1")

# pylint: disable=wrong-import-position
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import (
    InMemorySpanExporter,
)

from openlit._config import OpenlitConfig
import openlit.instrumentation.pydantic_ai as pydantic_ai_instrumentation
from openlit.instrumentation.pydantic_ai import PydanticAIInstrumentor

AGENT_OPERATIONS = ("invoke_agent", "execute_task")


@pytest.fixture
def exporter(monkeypatch):
    OpenlitConfig.reset_to_defaults()
    exp = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exp))
    # The instrumentor calls trace.get_tracer(__name__) on the global API, so
    # route it to the in-memory provider for the duration of the test.
    monkeypatch.setattr(
        pydantic_ai_instrumentation.trace,
        "get_tracer",
        lambda *args, **kwargs: provider.get_tracer("test"),
    )
    instrumentor = PydanticAIInstrumentor()
    instrumentor.instrument(capture_message_content=True)
    try:
        yield exp
    finally:
        instrumentor.uninstrument()


def _agent_spans(spans, agent_name):
    return [
        span
        for span in spans
        if span.name.split(" ", 1)[0] in AGENT_OPERATIONS
        and span.attributes.get("gen_ai.agent.name") == agent_name
    ]


def test_run_sync_emits_a_single_agent_span(exporter):
    from pydantic_ai import Agent  # pylint: disable=import-outside-toplevel
    from pydantic_ai.models.test import (  # pylint: disable=import-outside-toplevel
        TestModel,
    )

    agent = Agent(TestModel(custom_output_text="Paris"), name="helper")
    agent.run_sync("Capital of France?")

    spans = exporter.get_finished_spans()
    agent_spans = _agent_spans(spans, "helper")
    assert len(agent_spans) == 1, [span.name for span in agent_spans]
    assert agent_spans[0].name == "invoke_agent helper"
    assert agent_spans[0].attributes.get("gen_ai.operation.name") == "invoke_agent"

    spans_with_usage = [
        span.name
        for span in spans
        if span.attributes.get("gen_ai.usage.input_tokens") is not None
    ]
    assert len(spans_with_usage) == 1, spans_with_usage


def test_run_emits_a_single_invoke_agent_span(exporter):
    import asyncio  # pylint: disable=import-outside-toplevel
    from pydantic_ai import Agent  # pylint: disable=import-outside-toplevel
    from pydantic_ai.models.test import (  # pylint: disable=import-outside-toplevel
        TestModel,
    )

    agent = Agent(TestModel(custom_output_text="Paris"), name="helper")
    asyncio.run(agent.run("Capital of France?"))

    agent_spans = _agent_spans(exporter.get_finished_spans(), "helper")
    assert [span.name for span in agent_spans] == ["invoke_agent helper"]
    assert agent_spans[0].attributes.get("gen_ai.operation.name") == "invoke_agent"


def test_agent_called_from_run_sync_tool_keeps_its_span(exporter):
    from pydantic_ai import Agent  # pylint: disable=import-outside-toplevel
    from pydantic_ai.models.test import (  # pylint: disable=import-outside-toplevel
        TestModel,
    )

    delegate = Agent(TestModel(custom_output_text="Paris"), name="delegate")
    parent = Agent(TestModel(), name="parent")

    @parent.tool_plain
    async def ask_delegate(question: str) -> str:
        result = await delegate.run(question)
        return result.output

    parent.run_sync("Capital of France?")

    spans = exporter.get_finished_spans()
    parent_spans = _agent_spans(spans, "parent")
    delegate_spans = _agent_spans(spans, "delegate")
    assert len(parent_spans) == 1, [span.name for span in parent_spans]
    assert len(delegate_spans) == 1, [span.name for span in delegate_spans]
