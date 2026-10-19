# pylint: disable=missing-function-docstring, protected-access
"""Tests for OpenAI Agents instruction capture privacy."""

import builtins

import pytest
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

from openlit.__helpers import format_system_instructions
from openlit.instrumentation import openai_agents
from openlit.instrumentation.openai_agents import (
    _AgentCreationRegistry,
    _trace_include_sensitive_data_enabled,
    _wrap_agent_init,
)
from openlit.semcov import SemanticConvention

agents_sdk = pytest.importorskip("agents")

INSTRUCTIONS = "Internal rule: refunds above 500 need approval code R-77."


@pytest.fixture(autouse=True)
def _skip_custom_span_attributes(monkeypatch):
    monkeypatch.setattr(
        openai_agents, "_apply_custom_span_attributes", lambda span: None
    )


def _create_agent_span(capture_message_content=True):
    provider = TracerProvider()
    exporter = InMemorySpanExporter()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    tracer = provider.get_tracer("openlit.instrumentation.openai_agents")
    registry = _AgentCreationRegistry()
    wrapper = _wrap_agent_init(tracer, "test", "app", capture_message_content, registry)

    agent = agents_sdk.Agent.__new__(agents_sdk.Agent)
    wrapper(
        agent.__init__,
        agent,
        (),
        {"name": "support", "instructions": INSTRUCTIONS, "model": "m"},
    )

    spans = exporter.get_finished_spans()
    provider.shutdown()
    assert len(spans) == 1
    return spans[0]


@pytest.mark.parametrize(
    ("setting", "expected"),
    [
        ("false", False),
        ("FALSE", False),
        ("0", False),
        ("no", False),
        ("off", False),
        ("true", True),
        ("TRUE", True),
        ("1", True),
        ("yes", True),
        ("on", True),
        ("unexpected", False),
    ],
)
def test_agent_instructions_follow_agents_sdk_sensitive_data_setting(
    monkeypatch, setting, expected
):
    monkeypatch.setenv("OPENAI_AGENTS_TRACE_INCLUDE_SENSITIVE_DATA", setting)
    assert agents_sdk.RunConfig().trace_include_sensitive_data is expected

    span = _create_agent_span()
    attribute = SemanticConvention.GEN_AI_SYSTEM_INSTRUCTIONS
    if expected:
        assert span.attributes[attribute] == format_system_instructions(INSTRUCTIONS)
    else:
        assert attribute not in span.attributes


def test_agent_instructions_follow_agents_sdk_enabled_default(monkeypatch):
    monkeypatch.delenv("OPENAI_AGENTS_TRACE_INCLUDE_SENSITIVE_DATA", raising=False)
    assert agents_sdk.RunConfig().trace_include_sensitive_data is True

    span = _create_agent_span()
    assert span.attributes[SemanticConvention.GEN_AI_SYSTEM_INSTRUCTIONS] == (
        format_system_instructions(INSTRUCTIONS)
    )


def test_openlit_content_setting_still_suppresses_agent_instructions(monkeypatch):
    monkeypatch.setenv("OPENAI_AGENTS_TRACE_INCLUDE_SENSITIVE_DATA", "true")

    span = _create_agent_span(capture_message_content=False)

    assert SemanticConvention.GEN_AI_SYSTEM_INSTRUCTIONS not in span.attributes


def test_missing_agents_sensitive_data_helper_preserves_legacy_capture(monkeypatch):
    original_import = builtins.__import__

    def import_without_run_config(
        name, globalns=None, localns=None, fromlist=(), level=0
    ):
        if name == "agents.run_config":
            raise ImportError("run_config unavailable")
        return original_import(name, globalns, localns, fromlist, level)

    monkeypatch.setattr(builtins, "__import__", import_without_run_config)
    assert _trace_include_sensitive_data_enabled() is True
