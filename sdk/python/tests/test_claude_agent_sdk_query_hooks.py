# pylint: disable=too-few-public-methods
"""Offline query hook isolation tests; no Claude SDK installation is needed."""

import asyncio
import sys
from dataclasses import dataclass
from types import SimpleNamespace

import pytest
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter
from opentelemetry.sdk.trace.sampling import ALWAYS_ON

from openlit._config import OpenlitConfig
from openlit.instrumentation.claude_agent_sdk.claude_agent_sdk import wrap_query


@dataclass
class _Options:
    hooks: object = None
    model: str = "test-model"
    system_prompt: object = None
    env: object = None


@dataclass
class _HookMatcher:
    hooks: list
    matcher: object = None
    timeout: object = None


@pytest.fixture(name="query_harness")
def fixture_query_harness(monkeypatch):
    """Use real OpenLIT spans with the SDK's small options/hook interface mocked."""
    sdk_types = SimpleNamespace(ClaudeAgentOptions=_Options, HookMatcher=_HookMatcher)
    monkeypatch.setitem(sys.modules, "claude_agent_sdk.types", sdk_types)
    OpenlitConfig()
    exporter = InMemorySpanExporter()
    provider = TracerProvider(sampler=ALWAYS_ON)
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    wrapper = wrap_query(
        "test", "test", "test", provider.get_tracer("test"), {}, False, {}, True
    )
    yield wrapper, exporter
    provider.shutdown()


async def _tool_call(options, tool_id):
    """Dispatch all matching SDK-style callbacks for one successful tool call."""
    for event in ("PreToolUse", "PostToolUse"):
        for matcher in options.hooks[event]:
            for callback in matcher.hooks:
                await callback(
                    {"tool_name": "Read", "tool_input": {}, "tool_response": "ok"},
                    tool_id,
                    {},
                )
        await asyncio.sleep(0)


def _assert_tool_parents(exporter):
    spans = exporter.get_finished_spans()
    roots = [span for span in spans if span.name.startswith("invoke_agent")]
    tools = [span for span in spans if span.name == "execute_tool Read"]
    assert len(roots) == len(tools) == 2
    assert len({root.context.trace_id for root in roots}) == 2
    for tool in tools:
        matching_roots = [root for root in roots if root.context.trace_id == tool.context.trace_id]
        assert len(matching_roots) == 1
        assert tool.parent.span_id == matching_roots[0].context.span_id
    assert len({tool.context.trace_id for tool in tools}) == 2
    assert {tool.attributes["gen_ai.tool.call.id"] for tool in tools} == {"one", "two"}


@pytest.mark.parametrize("concurrent", [False, True])
@pytest.mark.parametrize("with_user_hooks", [False, True])
def test_query_options_are_isolated(query_harness, concurrent, with_user_hooks):
    """Repeated/concurrent queries preserve caller hooks and get fresh parents."""
    wrapper, exporter = query_harness
    user_calls = []

    async def user_hook(_input, tool_id, _context):
        user_calls.append(tool_id)
        return {}

    matcher = _HookMatcher(hooks=[user_hook], matcher="Read", timeout=45)
    user_matchers = [matcher]
    hooks = {"PreToolUse": user_matchers} if with_user_hooks else None
    environment = {"QUERY_SETTING": "preserved"}
    options = _Options(hooks=hooks, env=environment)
    received_options = []

    async def wrapped(*, options, prompt):
        received_options.append(options)
        await asyncio.sleep(0)
        await _tool_call(options, prompt)
        yield SimpleNamespace()

    async def run_one(tool_id):
        kwargs = {"options": options, "prompt": tool_id}
        async for _message in wrapper(wrapped, None, (), kwargs):
            pass
        assert kwargs["options"] is options

    async def run():
        if concurrent:
            await asyncio.gather(run_one("one"), run_one("two"))
        else:
            await run_one("one")
            await run_one("two")

    asyncio.run(run())
    _assert_tool_parents(exporter)
    assert options.hooks is hooks
    assert all(local is not options for local in received_options)
    assert received_options[0] is not received_options[1]
    assert all(local.env is environment for local in received_options)
    assert all(local.model == options.model for local in received_options)
    if with_user_hooks:
        assert hooks == {"PreToolUse": [matcher]}
        assert hooks["PreToolUse"] is user_matchers
        assert sorted(user_calls) == ["one", "two"]
        assert all(local.hooks["PreToolUse"][0] is matcher for local in received_options)


@pytest.mark.parametrize("exit_mode", ["error", "close"])
def test_query_exit_does_not_leave_hooks(query_harness, exit_mode):
    """A failed or explicitly closed query cannot leave callbacks for the next."""
    wrapper, exporter = query_harness
    options = _Options()

    async def wrapped(*, options, prompt):
        await _tool_call(options, prompt)
        if prompt == "one" and exit_mode == "error":
            raise RuntimeError("query failed")
        yield SimpleNamespace()
        yield SimpleNamespace()

    async def run():
        first = wrapper(wrapped, None, (), {"options": options, "prompt": "one"})
        if exit_mode == "error":
            with pytest.raises(RuntimeError, match="query failed"):
                await anext(first)
        else:
            await anext(first)
            await first.aclose()
        assert options.hooks is None
        async for _message in wrapper(
            wrapped, None, (), {"options": options, "prompt": "two"}
        ):
            pass

    asyncio.run(run())
    _assert_tool_parents(exporter)
    assert options.hooks is None


def test_query_without_options_gets_default_options(query_harness):
    """Omitting options still supplies an instrumented default to the SDK."""
    wrapper, exporter = query_harness

    async def wrapped(*, options, prompt):
        assert isinstance(options, _Options)
        await _tool_call(options, prompt)
        yield SimpleNamespace()

    async def run():
        for tool_id in ("one", "two"):
            kwargs = {"prompt": tool_id}
            async for _message in wrapper(wrapped, None, (), kwargs):
                pass
            assert "options" not in kwargs

    asyncio.run(run())
    _assert_tool_parents(exporter)
