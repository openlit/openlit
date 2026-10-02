# pylint: disable=duplicate-code, missing-class-docstring, missing-function-docstring
# pylint: disable=too-few-public-methods
"""
Tests for the CrewAI instrumentation's handling of a tool's own keyword
arguments.

Issue #1568. Both wrappers forwarded the wrapped call's `**kwargs` into
`process_crewai_response`, whose own parameters are ordinary names. A tool
declaring one of them — the report hit `version` via an Azure DevOps MCP tool's
`repo_file(version="refs/heads/main")` — raised

    TypeError: process_crewai_response() got multiple values for argument 'version'

*after* the tool had already run. CrewAI caught the re-raised TypeError and
reported the successful call to the model as a tool failure, discarding the
real result.

`version` was only the name that happened to be hit first: every parameter of
`process_crewai_response` was reachable the same way, so these tests cover the
whole set rather than the one name in the report.

Nothing here requires crewai to be installed -- the wrapped callable, the
tracer and the tool instance are all stand-ins.
"""

import asyncio
import inspect
from unittest.mock import MagicMock

import pytest

from openlit._config import OpenlitConfig
from openlit.instrumentation.crewai.crewai import general_wrap
from openlit.instrumentation.crewai.async_crewai import async_general_wrap
from openlit.instrumentation.crewai.utils import process_crewai_response


@pytest.fixture(autouse=True)
def _config_defaults():
    """The wrappers read OpenlitConfig, which `openlit.init()` normally fills."""
    OpenlitConfig.reset_to_defaults()


def _colliding_parameter_names():
    """Every name a tool argument could have shadowed."""
    return [
        name
        for name, param in inspect.signature(process_crewai_response).parameters.items()
        if param.kind
        in (inspect.Parameter.POSITIONAL_OR_KEYWORD, inspect.Parameter.KEYWORD_ONLY)
    ]


class _Tool:
    name = "repo_file"
    description = "Reads a file from a repository."


def _tracer():
    tracer = MagicMock()
    span = MagicMock()
    tracer.start_as_current_span.return_value.__enter__.return_value = span
    tracer.start_as_current_span.return_value.__exit__.return_value = False
    return tracer, span


def _wrapper_args(tracer):
    return {
        "gen_ai_endpoint": "tool_run",
        "version": "1.45.0",
        "environment": "test",
        "application_name": "app",
        "tracer": tracer,
        "pricing_info": {},
        "capture_message_content": True,
        "metrics": None,
        "disable_metrics": True,
    }


def test_the_reported_case_returns_the_tools_result():
    tracer, _span = _tracer()
    wrapper = general_wrap(**_wrapper_args(tracer))

    result = wrapper(
        lambda *a, **kw: "file contents",
        _Tool(),
        (),
        {"version": "refs/heads/main"},
    )

    assert result == "file contents"


@pytest.mark.parametrize("name", _colliding_parameter_names())
def test_no_parameter_name_can_be_shadowed_by_a_tool_argument(name):
    """The general property, not just the reported name."""
    tracer, _span = _tracer()
    wrapper = general_wrap(**_wrapper_args(tracer))

    result = wrapper(lambda *a, **kw: "ok", _Tool(), (), {name: "tool-supplied"})

    assert result == "ok"


@pytest.mark.parametrize("name", _colliding_parameter_names())
def test_the_async_wrapper_agrees(name):
    tracer, _span = _tracer()
    wrapper = async_general_wrap(**_wrapper_args(tracer))

    async def wrapped(*_args, **_kwargs):
        return "ok"

    result = asyncio.run(wrapper(wrapped, _Tool(), (), {name: "tool-supplied"}))

    assert result == "ok"


def test_the_tool_arguments_still_reach_the_span():
    """The control: not colliding must not mean not recorded.

    A fix that simply dropped the tool's kwargs would pass every cell above.
    """
    tracer, span = _tracer()
    wrapper = general_wrap(**_wrapper_args(tracer))

    wrapper(
        lambda *a, **kw: "file contents",
        _Tool(),
        (),
        {"version": "refs/heads/main", "path": "README.md"},
    )

    recorded = [
        str(call.args[1]) for call in span.set_attribute.call_args_list if call.args
    ]
    assert any("refs/heads/main" in value for value in recorded), recorded
    assert any("README.md" in value for value in recorded), recorded


def test_a_tool_with_no_arguments_records_no_arguments_attribute():
    """`call_kwargs=None` must behave like the empty mapping, not crash."""
    _tracer_unused, span = _tracer()

    process_crewai_response(
        "result",
        "execute_tool",
        "localhost",
        8000,
        "test",
        "app",
        None,
        0.0,
        span,
        True,
        True,
        "1.45.0",
        _Tool(),
        (),
        endpoint="tool_run",
    )

    recorded = [
        str(call.args[1]) for call in span.set_attribute.call_args_list if call.args
    ]
    assert not any("tool-supplied" in value for value in recorded)
