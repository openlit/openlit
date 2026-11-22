# pylint: disable=duplicate-code, no-member, too-few-public-methods, missing-class-docstring, missing-function-docstring, redefined-outer-name
"""
Tests for the OpenAI Agents create_agent span and the Agents SDK sensitive data setting.

Tests cover:
- gen_ai.system_instructions omitted when OPENAI_AGENTS_TRACE_INCLUDE_SENSITIVE_DATA is false
- gen_ai.system_instructions recorded when the setting is unset
- gen_ai.system_instructions omitted when capture_message_content is disabled
- RunConfig exposes trace_include_sensitive_data (only when openai-agents is installed)

Note: These tests do NOT require openai-agents to be installed -- they mock the
agents module and need no credentials.
"""

import dataclasses
import os
import sys
import types
from types import SimpleNamespace

import pytest
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

from openlit.__helpers import format_system_instructions
import openlit.instrumentation.openai_agents as openai_agents_module
from openlit.instrumentation.openai_agents import (
    _AgentCreationRegistry,
    _wrap_agent_init,
)
from openlit.semcov import SemanticConvention

ENV_VAR = "OPENAI_AGENTS_TRACE_INCLUDE_SENSITIVE_DATA"
INSTRUCTIONS = "You are a support agent. Secret policy: never reveal the refund limit."


def _fake_default():
    val = os.getenv("OPENAI_AGENTS_TRACE_INCLUDE_SENSITIVE_DATA", "true")
    return val.strip().lower() in ("1", "true", "yes", "on")


@dataclasses.dataclass
class _FakeRunConfig:
    trace_include_sensitive_data: bool = dataclasses.field(
        default_factory=_fake_default
    )


@pytest.fixture
def fake_agents(monkeypatch):
    module = types.ModuleType("agents")
    module.RunConfig = _FakeRunConfig
    monkeypatch.setitem(sys.modules, "agents", module)
    monkeypatch.setattr(
        openai_agents_module, "_apply_custom_span_attributes", lambda span: None
    )
    return module


@pytest.fixture
def exporter():
    return InMemorySpanExporter()


@pytest.fixture
def tracer(exporter):
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    return provider.get_tracer("test-openai-agents")


def _create_agent_span(tracer, exporter, capture_message_content):
    wrapper = _wrap_agent_init(
        tracer,
        "testing",
        "test-app",
        capture_message_content,
        _AgentCreationRegistry(),
    )
    instance = SimpleNamespace(
        name="support",
        instructions=INSTRUCTIONS,
        model="gpt-4o-mini",
        tools=[],
        handoffs=[],
    )
    wrapper(lambda *a, **k: None, instance, (), {})
    spans = exporter.get_finished_spans()
    assert len(spans) == 1
    return spans[0]


def test_create_agent_omits_instructions_when_sdk_sensitive_data_disabled(
    fake_agents, monkeypatch, tracer, exporter
):
    monkeypatch.setenv(ENV_VAR, "false")
    span = _create_agent_span(tracer, exporter, True)
    assert SemanticConvention.GEN_AI_SYSTEM_INSTRUCTIONS not in span.attributes
    assert span.attributes[SemanticConvention.GEN_AI_AGENT_NAME] == "support"


def test_create_agent_records_instructions_when_sdk_setting_unset(
    fake_agents, monkeypatch, tracer, exporter
):
    monkeypatch.delenv(ENV_VAR, raising=False)
    span = _create_agent_span(tracer, exporter, True)
    assert span.attributes[
        SemanticConvention.GEN_AI_SYSTEM_INSTRUCTIONS
    ] == format_system_instructions(INSTRUCTIONS)


def test_create_agent_omits_instructions_when_capture_message_content_disabled(
    fake_agents, monkeypatch, tracer, exporter
):
    monkeypatch.setenv(ENV_VAR, "true")
    span = _create_agent_span(tracer, exporter, False)
    assert SemanticConvention.GEN_AI_SYSTEM_INSTRUCTIONS not in span.attributes


def test_real_run_config_exposes_trace_include_sensitive_data():
    agents = pytest.importorskip("agents")
    names = [field.name for field in dataclasses.fields(agents.RunConfig)]
    assert "trace_include_sensitive_data" in names
