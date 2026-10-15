# pylint: disable=redefined-outer-name, missing-function-docstring
"""Regression test: the Pydantic AI agent span must capture the system prompt
text, not the Python repr of the tuple that holds it.

``pydantic_ai.Agent`` stores its static system prompts in the
``_system_prompts`` tuple. The instrumentation stringifies that tuple with
``str(...)``, so for ``system_prompt="Be terse."`` the agent span records the
system message content (inside ``gen_ai.input.messages``) and
``gen_ai.agent.description`` as ``"('Be terse.',)"`` instead of
``"Be terse."``.

The test drives a real ``pydantic_ai.Agent`` with the offline ``TestModel``,
so no network access or API key is needed.
"""

import json
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

SYSTEM_PROMPT = "Be terse."


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


def _run_agent_async(system_prompt=SYSTEM_PROMPT):
    import asyncio  # pylint: disable=import-outside-toplevel

    from pydantic_ai import Agent  # pylint: disable=import-outside-toplevel
    from pydantic_ai.models.test import (  # pylint: disable=import-outside-toplevel
        TestModel,
    )

    agent = Agent(
        TestModel(custom_output_text="Paris"),
        name="helper",
        system_prompt=system_prompt,
    )
    asyncio.run(agent.run("Capital of France?"))


def _agent_run_span(exporter):
    spans = [
        span
        for span in exporter.get_finished_spans()
        if span.attributes.get("gen_ai.input.messages") is not None
    ]
    assert spans, "no agent run span captured gen_ai.input.messages"
    return spans[0]


def test_system_prompt_is_captured_as_text_in_input_messages(exporter):
    _run_agent_async()

    span = _agent_run_span(exporter)
    messages = json.loads(span.attributes["gen_ai.input.messages"])
    system_texts = [
        msg.get("content")
        for msg in messages
        if isinstance(msg, dict) and msg.get("role") == "system"
    ]
    assert SYSTEM_PROMPT in system_texts, messages


def test_agent_description_is_the_system_prompt_text(exporter):
    _run_agent_async()

    span = _agent_run_span(exporter)
    assert span.attributes.get("gen_ai.agent.description") == SYSTEM_PROMPT


def test_multiple_system_prompts_are_joined_as_text(exporter):
    _run_agent_async(system_prompt=[SYSTEM_PROMPT, "Answer in English."])

    span = _agent_run_span(exporter)
    assert (
        span.attributes.get("gen_ai.agent.description")
        == "Be terse.\nAnswer in English."
    )


def test_no_system_prompt_leaves_description_unset(exporter):
    _run_agent_async(system_prompt=())

    span = _agent_run_span(exporter)
    assert "gen_ai.agent.description" not in span.attributes
    messages = json.loads(span.attributes["gen_ai.input.messages"])
    assert all(msg.get("role") != "system" for msg in messages), messages
