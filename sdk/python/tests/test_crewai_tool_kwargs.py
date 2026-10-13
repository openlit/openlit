"""Tests that CrewAI tool arguments never collide with the telemetry parameters (openlit#1568).

A tool called with a keyword argument named like one of
``process_crewai_response``'s own parameters (``version`` is the common one)
used to raise ``TypeError: got multiple values for argument`` inside the
instrumentation, after the tool itself had run. CrewAI turns that into a tool
failure, so the real result was discarded and the span recorded an error.
"""

import json
from types import SimpleNamespace

import pytest
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

from openlit._config import OpenlitConfig
from openlit.instrumentation.crewai.async_crewai import async_general_wrap
from openlit.instrumentation.crewai.crewai import general_wrap
from openlit.semcov import SemanticConvention

TOOL_RESULT = "content of README.md at refs/heads/main"

# Keyword arguments a tool call may legitimately carry that are also parameter
# names of process_crewai_response.
COLLIDING_KWARGS = [
    {"version": "refs/heads/main"},
    {"endpoint": "https://dev.azure.com/org"},
    {"metrics": None},
    {"span": "a span context"},
    {"args": ("positional",)},
    {"environment": "staging", "application_name": "my-app"},
    {"response": "a tool response"},
    {"instance": "the tool instance"},
]


def _tracer_and_exporter():
    OpenlitConfig.reset_to_defaults()
    exporter = InMemorySpanExporter()
    tracer_provider = TracerProvider()
    tracer_provider.add_span_processor(SimpleSpanProcessor(exporter))
    return tracer_provider.get_tracer("test-crewai"), exporter


def _tool():
    return SimpleNamespace(name="repo_file", description="Reads a file", llm=None, agent=None)


def _sync_wrapper(tracer):
    return general_wrap(
        "tool_run",
        "test-version",
        "test-env",
        "test-app",
        tracer,
        {},
        True,
        None,
        True,
    )


def _async_wrapper(tracer):
    return async_general_wrap(
        "tool_run",
        "test-version",
        "test-env",
        "test-app",
        tracer,
        {},
        True,
        None,
        True,
    )


@pytest.mark.parametrize("tool_kwargs", COLLIDING_KWARGS)
def test_sync_tool_run_survives_kwargs_named_like_wrapper_params(tool_kwargs):
    """Verify a sync tool run returns its result for any argument name."""

    tracer, exporter = _tracer_and_exporter()
    wrapped_calls = []

    def wrapped(*args, **kwargs):
        wrapped_calls.append((args, kwargs))
        return TOOL_RESULT

    result = _sync_wrapper(tracer)(wrapped, _tool(), (), dict(tool_kwargs))

    assert result == TOOL_RESULT
    assert wrapped_calls == [((), dict(tool_kwargs))]

    spans = exporter.get_finished_spans()
    assert len(spans) == 1
    assert spans[0].status.status_code.name == "OK"
    assert spans[0].attributes[SemanticConvention.GEN_AI_TOOL_NAME] == "repo_file"


@pytest.mark.parametrize("tool_kwargs", COLLIDING_KWARGS)
@pytest.mark.asyncio
async def test_async_tool_run_survives_kwargs_named_like_wrapper_params(tool_kwargs):
    """Verify an async tool run returns its result for any argument name."""

    tracer, exporter = _tracer_and_exporter()
    wrapped_calls = []

    async def wrapped(*args, **kwargs):
        wrapped_calls.append((args, kwargs))
        return TOOL_RESULT

    result = await _async_wrapper(tracer)(wrapped, _tool(), (), dict(tool_kwargs))

    assert result == TOOL_RESULT
    assert wrapped_calls == [((), dict(tool_kwargs))]

    spans = exporter.get_finished_spans()
    assert len(spans) == 1
    assert spans[0].status.status_code.name == "OK"
    assert spans[0].attributes[SemanticConvention.GEN_AI_TOOL_NAME] == "repo_file"


def test_sync_tool_run_records_keyword_arguments_as_call_arguments():
    """Verify the tool's keyword arguments still reach gen_ai.tool.call.arguments."""

    tracer, exporter = _tracer_and_exporter()
    tool_kwargs = {"path": "README.md", "version": "refs/heads/main"}

    _sync_wrapper(tracer)(lambda *args, **kwargs: TOOL_RESULT, _tool(), (), tool_kwargs)

    spans = exporter.get_finished_spans()
    assert len(spans) == 1
    attributes = spans[0].attributes
    assert json.loads(attributes[SemanticConvention.GEN_AI_TOOL_CALL_ARGUMENTS]) == tool_kwargs
    assert attributes[SemanticConvention.GEN_AI_TOOL_CALL_RESULT] == TOOL_RESULT


def test_sync_tool_run_still_prefers_positional_arguments():
    """Verify positional tool arguments keep being recorded instead of the keywords."""

    tracer, exporter = _tracer_and_exporter()
    arguments = {"path": "README.md"}

    _sync_wrapper(tracer)(
        lambda *args, **kwargs: TOOL_RESULT,
        _tool(),
        (arguments,),
        {"version": "refs/heads/main"},
    )

    attributes = exporter.get_finished_spans()[0].attributes
    assert json.loads(attributes[SemanticConvention.GEN_AI_TOOL_CALL_ARGUMENTS]) == arguments
    assert attributes[SemanticConvention.GEN_AI_TOOL_CALL_RESULT] == TOOL_RESULT
