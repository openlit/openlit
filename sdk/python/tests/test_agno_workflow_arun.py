# pylint: disable=missing-function-docstring, missing-class-docstring, too-few-public-methods
"""Regression tests: the agno Workflow.arun wrapper must keep the shape of
what arun returns.

`Workflow.arun` is a plain `def`. With stream=False it returns a coroutine and
callers write `await workflow.arun(...)`; with stream=True it returns an async
iterator and callers write `async for event in workflow.arun(...)`. The
wrapper used to be an async generator function, so it turned the coroutine
into an async generator and `await workflow.arun(...)` failed with
`TypeError: object async_generator can't be used in 'await' expression`.

The first three tests drive the real `async_workflow_wrap` factory against a
stand-in class whose `arun` returns the same two shapes. The last test runs a
real one-step agno Workflow (a plain function step, no model) and is skipped
when agno is not installed.
"""

import asyncio

import pytest
import wrapt
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import (
    InMemorySpanExporter,
)
from opentelemetry.trace import StatusCode

from openlit._config import OpenlitConfig
from openlit.instrumentation.agno.async_agno import async_workflow_wrap


def _tracer_with_exporter():
    OpenlitConfig.reset_to_defaults()
    OpenlitConfig.disable_events = True
    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    return provider.get_tracer(__name__), exporter


def _wrapper(tracer):
    return async_workflow_wrap(
        "workflow_arun",
        version="test",
        environment="test",
        application_name="test",
        tracer=tracer,
        pricing_info={},
        capture_message_content=True,
        metrics=None,
        disable_metrics=True,
    )


class FakeRunOutput:
    def __init__(self, content):
        self.content = content


def _make_workflow_class(tracer):
    class FakeWorkflow:
        """Mirrors agno's Workflow.arun: a plain def returning a coroutine
        when stream=False and an async iterator when stream=True."""

        name = "demo"

        def arun(self, input=None, stream=False):  # pylint: disable=redefined-builtin
            if stream:
                return self._aexecute_stream(input)
            return self._aexecute(input)

        async def _aexecute(self, value):
            await asyncio.sleep(0)
            if value == "boom":
                raise RuntimeError("boom")
            return FakeRunOutput(str(value).upper())

        async def _aexecute_stream(self, value):
            for part in ("started", "step", str(value).upper()):
                await asyncio.sleep(0)
                yield FakeRunOutput(part)

    FakeWorkflow.arun = wrapt.FunctionWrapper(FakeWorkflow.arun, _wrapper(tracer))
    return FakeWorkflow


def test_non_streaming_arun_is_awaitable_and_traced():
    tracer, exporter = _tracer_with_exporter()
    workflow = _make_workflow_class(tracer)()

    async def run():
        return await workflow.arun(input="hello")

    output = asyncio.run(run())

    assert output.content == "HELLO"
    spans = exporter.get_finished_spans()
    assert [span.name for span in spans] == ["invoke_workflow demo"]
    assert spans[0].status.status_code == StatusCode.OK


def test_non_streaming_arun_error_is_raised_and_recorded():
    tracer, exporter = _tracer_with_exporter()
    workflow = _make_workflow_class(tracer)()

    async def run():
        return await workflow.arun(input="boom")

    with pytest.raises(RuntimeError, match="boom"):
        asyncio.run(run())

    spans = exporter.get_finished_spans()
    assert [span.name for span in spans] == ["invoke_workflow demo"]
    assert spans[0].status.status_code == StatusCode.ERROR


def test_streaming_arun_is_async_iterable_and_traced():
    tracer, exporter = _tracer_with_exporter()
    workflow = _make_workflow_class(tracer)()

    async def run():
        return [event.content async for event in workflow.arun(input="hello", stream=True)]

    events = asyncio.run(run())

    assert events == ["started", "step", "HELLO"]
    spans = exporter.get_finished_spans()
    assert [span.name for span in spans] == ["invoke_workflow demo"]
    assert spans[0].status.status_code == StatusCode.OK


def test_real_agno_workflow_arun_await_and_stream():
    agno_workflow = pytest.importorskip("agno.workflow")
    from agno.workflow.types import StepInput, StepOutput

    tracer, exporter = _tracer_with_exporter()

    def shout(step_input: StepInput) -> StepOutput:
        return StepOutput(content=str(step_input.input).upper())

    class TracedWorkflow(agno_workflow.Workflow):
        arun = wrapt.FunctionWrapper(agno_workflow.Workflow.arun, _wrapper(tracer))

    workflow = TracedWorkflow(
        name="demo", steps=[agno_workflow.Step(name="shout", executor=shout)]
    )

    async def run_await():
        return await workflow.arun(input="hello")

    output = asyncio.run(run_await())
    assert output.content == "HELLO"

    async def run_stream():
        return [event async for event in workflow.arun(input="hello", stream=True)]

    events = asyncio.run(run_stream())
    assert events

    spans = exporter.get_finished_spans()
    assert [span.name for span in spans] == [
        "invoke_workflow demo",
        "invoke_workflow demo",
    ]
    assert all(span.status.status_code == StatusCode.OK for span in spans)
