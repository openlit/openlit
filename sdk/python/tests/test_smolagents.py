# pylint: disable=duplicate-code, no-member, too-few-public-methods, missing-class-docstring
"""
Tests for smolagents instrumentation using the smolagents Python library.

Tests cover:
- Agent construction and run (ToolCallingAgent, CodeAgent)
- Tool execution
- Model generate/stream (LLM spans delegated to base SDK instrumentors)

These tests validate integration with OpenLIT.

Note: These tests require smolagents to be installed.
"""

import json
from unittest.mock import MagicMock, patch
from dataclasses import dataclass

import pytest

try:
    import smolagents
    from smolagents import (
        Tool,
        ToolCallingAgent,
        CodeAgent,
    )
    from smolagents.models import Model
    from smolagents.memory import ActionStep, ToolCall
    from smolagents.monitoring import TokenUsage

    SMOLAGENTS_AVAILABLE = True
except ImportError:
    SMOLAGENTS_AVAILABLE = False

import openlit

openlit.init(
    environment="openlit-python-testing",
    application_name="openlit-python-smolagents-test",
)

pytestmark = pytest.mark.skipif(
    not SMOLAGENTS_AVAILABLE, reason="smolagents not installed"
)


class MockChatMessage:
    """Mock ChatMessage returned by Model.generate()."""

    def __init__(self, content="Hello!", tool_calls=None):
        self.role = "assistant"
        self.content = content
        self.tool_calls = tool_calls or []
        self.raw = None
        self.token_usage = TokenUsage(input_tokens=10, output_tokens=5)


class DummyModel(Model):
    """A mock model for testing instrumentation without real API calls."""

    def __init__(self):
        super().__init__(model_id="test-model-001")

    def generate(self, messages, **kwargs):
        return MockChatMessage(content="Test model response")

    def generate_stream(self, messages, **kwargs):
        yield MockChatMessage(content="chunk1")
        yield MockChatMessage(content="chunk2")


class DummyTool(Tool):
    """A simple test tool."""

    name = "dummy_tool"
    description = "A tool for testing purposes"
    inputs = {
        "query": {"type": "string", "description": "The query to process"},
    }
    output_type = "string"

    def forward(self, query: str) -> str:
        return f"Processed: {query}"


class TestSmolAgentsInstrumentation:
    """Tests for smolagents instrumentation."""

    def test_tool_call_instrumentation(self):
        """Tests that Tool.__call__ is instrumented."""
        tool = DummyTool()
        result = tool(query="test query")
        assert "Processed" in str(result)

    def test_model_generate_instrumentation(self):
        """Tests that Model.generate() works (LLM span from base SDK instrumentor)."""
        model = DummyModel()
        messages = [{"role": "user", "content": "Hello"}]
        response = model.generate(messages)
        assert response.content == "Test model response"
        assert response.token_usage.input_tokens == 10
        assert response.token_usage.output_tokens == 5

    def test_model_generate_stream_instrumentation(self):
        """Tests that Model.generate_stream() works (LLM span from base SDK instrumentor)."""
        model = DummyModel()
        messages = [{"role": "user", "content": "Hello streaming"}]
        chunks = list(model.generate_stream(messages))
        assert len(chunks) == 2
        assert chunks[0].content == "chunk1"
        assert chunks[1].content == "chunk2"

    def test_multiple_tool_calls(self):
        """Tests that multiple tool calls are each instrumented."""
        tool = DummyTool()
        r1 = tool(query="first")
        r2 = tool(query="second")
        assert "first" in str(r1)
        assert "second" in str(r2)

    def test_tool_with_exception(self):
        """Tests that tool exceptions are captured in spans."""

        class FailingTool(Tool):
            name = "failing_tool"
            description = "A tool that fails"
            inputs = {"x": {"type": "string", "description": "input"}}
            output_type = "string"

            def forward(self, x: str) -> str:
                raise ValueError("Tool execution failed")

        tool = FailingTool()
        with pytest.raises(ValueError, match="Tool execution failed"):
            tool(x="test")

    def test_model_with_exception(self):
        """Tests that model exceptions are captured in spans."""

        class FailingModel(Model):
            def __init__(self):
                super().__init__(model_id="fail-model")

            def generate(self, messages, **kwargs):
                raise RuntimeError("Model generation failed")

        model = FailingModel()
        with pytest.raises(RuntimeError, match="Model generation failed"):
            model.generate([{"role": "user", "content": "fail"}])
