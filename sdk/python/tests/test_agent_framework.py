# pylint: disable=duplicate-code, no-member, too-few-public-methods, missing-class-docstring, missing-function-docstring
"""
Tests for Microsoft Agent Framework instrumentation.

Tests cover:
- Instrumentor import and basic instantiation
- Utils: OPERATION_MAP, SPAN_KIND_MAP, generate_span_name
- Agent creation registry
- Model name extraction
- Server info resolution
- Response attribute extraction
- Content capture (input/output messages, system instructions, tool defs)
- Tool attribute setting
- Metrics recording
- Process response

Note: These tests do NOT require agent-framework to be installed -- they mock
all AF internals so the test suite can run in any environment.
"""

import json
from unittest.mock import MagicMock

import pytest

from openlit.instrumentation.agent_framework.utils import (
    OPERATION_MAP,
    SPAN_KIND_MAP,
    generate_span_name,
    get_operation_type,
    get_span_kind,
    _extract_model_name,
    _resolve_server_info,
    _set_agent_attributes,
    _set_workflow_attributes,
    _set_tool_attributes,
    _extract_response_attributes,
    _capture_input_messages,
    _capture_output_messages,
    _capture_system_instructions,
    _capture_tool_definitions,
    _record_metrics,
    process_agent_framework_response,
)

from openlit.instrumentation.agent_framework import (
    _AgentCreationRegistry,
    _wrap_agent_init,
    AgentFrameworkInstrumentor,
    WORKFLOW_OPERATIONS,
    DETAILED_OPERATIONS,
)
from openlit.instrumentation.agent_framework.async_agent_framework import (
    tool_execute_wrap,
    _serialize_content_list,
)

from opentelemetry.trace import SpanKind
from openlit.semcov import SemanticConvention


# ===================================================================
# OPERATION_MAP and SPAN_KIND_MAP
# ===================================================================
class TestOperationMap:
    """Tests for OPERATION_MAP and SPAN_KIND_MAP completeness."""

    def test_operation_map_has_required_endpoints(self):
        required = ["agent_init", "agent_run", "tool_execute", "workflow_run"]
        for key in required:
            assert key in OPERATION_MAP, f"Missing endpoint: {key}"

    def test_span_kind_map_has_required_operations(self):
        required = [
            SemanticConvention.GEN_AI_OPERATION_TYPE_CREATE_AGENT,
            SemanticConvention.GEN_AI_OPERATION_TYPE_AGENT,
            SemanticConvention.GEN_AI_OPERATION_TYPE_FRAMEWORK,
            SemanticConvention.GEN_AI_OPERATION_TYPE_TOOLS,
        ]
        for key in required:
            assert key in SPAN_KIND_MAP, f"Missing span kind: {key}"

    def test_get_operation_type_defaults(self):
        assert (
            get_operation_type("agent_init")
            == SemanticConvention.GEN_AI_OPERATION_TYPE_CREATE_AGENT
        )
        assert (
            get_operation_type("unknown_key")
            == SemanticConvention.GEN_AI_OPERATION_TYPE_AGENT
        )

    def test_agent_run_maps_to_invoke_agent(self):
        assert (
            OPERATION_MAP["agent_run"]
            == SemanticConvention.GEN_AI_OPERATION_TYPE_AGENT
        )

    def test_workflow_run_maps_to_invoke_workflow(self):
        assert (
            OPERATION_MAP["workflow_run"]
            == SemanticConvention.GEN_AI_OPERATION_TYPE_FRAMEWORK
        )

    def test_tool_execute_maps_to_execute_tool(self):
        assert (
            OPERATION_MAP["tool_execute"]
            == SemanticConvention.GEN_AI_OPERATION_TYPE_TOOLS
        )

    def test_create_agent_span_kind_is_client(self):
        assert (
            get_span_kind(SemanticConvention.GEN_AI_OPERATION_TYPE_CREATE_AGENT)
            == SpanKind.CLIENT
        )

    def test_invoke_agent_span_kind_is_internal(self):
        assert (
            get_span_kind(SemanticConvention.GEN_AI_OPERATION_TYPE_AGENT)
            == SpanKind.INTERNAL
        )


# ===================================================================
# Span Name Generation
# ===================================================================
class TestSpanNameGeneration:
    """Tests for generate_span_name."""

    def test_agent_init_span_name(self):
        instance = MagicMock()
        instance.name = "my_agent"
        assert generate_span_name("agent_init", instance) == "create_agent my_agent"

    def test_agent_init_fallback_to_id(self):
        instance = MagicMock(spec=["id"])
        instance.id = "agent-123"
        assert generate_span_name("agent_init", instance) == "create_agent agent-123"

    def test_agent_init_fallback_default(self):
        instance = MagicMock(spec=[])
        assert generate_span_name("agent_init", instance) == "create_agent agent"

    def test_agent_run_span_name(self):
        instance = MagicMock()
        instance.name = "weather_agent"
        assert (
            generate_span_name("agent_run", instance) == "invoke_agent weather_agent"
        )

    def test_agent_run_fallback_to_id(self):
        instance = MagicMock(spec=["id"])
        instance.id = "run-456"
        assert generate_span_name("agent_run", instance) == "invoke_agent run-456"

    def test_tool_execute_span_name(self):
        instance = MagicMock()
        instance.name = "get_weather"
        assert (
            generate_span_name("tool_execute", instance) == "execute_tool get_weather"
        )

    def test_tool_execute_fallback_to_class_name(self):
        instance = MagicMock(spec=[])
        name = generate_span_name("tool_execute", instance)
        assert "execute_tool" in name

    def test_workflow_run_span_name(self):
        instance = MagicMock()
        instance.name = "my_workflow"
        assert (
            generate_span_name("workflow_run", instance)
            == "invoke_workflow my_workflow"
        )

    def test_unknown_endpoint_uses_operation_type(self):
        instance = MagicMock(spec=[])
        name = generate_span_name("something_new", instance)
        assert SemanticConvention.GEN_AI_OPERATION_TYPE_AGENT in name


# ===================================================================
# Agent Creation Registry
# ===================================================================
class TestAgentCreationRegistry:
    """Tests for _AgentCreationRegistry."""

    def test_register_and_get(self):
        registry = _AgentCreationRegistry()
        ctx = MagicMock()
        registry.register("agent1", ctx)
        assert registry.get("agent1") is ctx

    def test_get_nonexistent_returns_none(self):
        registry = _AgentCreationRegistry()
        assert registry.get("missing") is None

    def test_get_all(self):
        registry = _AgentCreationRegistry()
        ctx1 = MagicMock()
        ctx2 = MagicMock()
        registry.register("a", ctx1)
        registry.register("b", ctx2)
        all_ctxs = registry.get_all()
        assert len(all_ctxs) == 2
        assert ctx1 in all_ctxs
        assert ctx2 in all_ctxs

    def test_overwrite_existing(self):
        registry = _AgentCreationRegistry()
        ctx1 = MagicMock()
        ctx2 = MagicMock()
        registry.register("agent1", ctx1)
        registry.register("agent1", ctx2)
        assert registry.get("agent1") is ctx2


# ===================================================================
# Model Name Extraction
# ===================================================================
class TestModelExtraction:
    """Tests for _extract_model_name."""

    def test_direct_model_id(self):
        instance = MagicMock()
        instance.model_id = "gpt-4o"
        assert _extract_model_name(instance) == "gpt-4o"

    def test_chat_client_model_id(self):
        instance = MagicMock(spec=["chat_client"])
        instance.chat_client = MagicMock()
        instance.chat_client.model_id = "gpt-4"
        assert _extract_model_name(instance) == "gpt-4"

    def test_default_options_model_id(self):
        instance = MagicMock(spec=["default_options"])
        instance.default_options = {"model_id": "claude-sonnet-4-20250514"}
        assert _extract_model_name(instance) == "claude-sonnet-4-20250514"

    def test_unknown_fallback(self):
        instance = MagicMock(spec=[])
        assert _extract_model_name(instance) == "unknown"

    def test_none_instance(self):
        assert _extract_model_name(None) == "unknown"


# ===================================================================
# Server Info Resolution
# ===================================================================
class TestServerInfoResolution:
    """Tests for _resolve_server_info."""

    def test_with_service_url(self):
        instance = MagicMock()
        instance.chat_client = MagicMock()
        instance.chat_client.service_url = MagicMock(
            return_value="https://api.openai.com:443/v1"
        )
        addr, port = _resolve_server_info(instance)
        assert addr == "api.openai.com"
        assert port == 443

    def test_no_chat_client(self):
        instance = MagicMock(spec=[])
        addr, port = _resolve_server_info(instance)
        assert addr == ""
        assert port == 0

    def test_unknown_service_url(self):
        instance = MagicMock()
        instance.chat_client = MagicMock()
        instance.chat_client.service_url = MagicMock(return_value="unknown")
        addr, port = _resolve_server_info(instance)
        assert addr == ""
        assert port == 0


# ===================================================================
# Agent Attributes
# ===================================================================
class TestAgentAttributes:
    """Tests for _set_agent_attributes."""

    def test_sets_all_attributes(self):
        span = MagicMock()
        instance = MagicMock()
        instance.id = "agent-abc"
        instance.name = "WeatherBot"
        instance.description = "A bot that gets weather"

        _set_agent_attributes(span, instance)

        span.set_attribute.assert_any_call(
            SemanticConvention.GEN_AI_AGENT_ID, "agent-abc"
        )
        span.set_attribute.assert_any_call(
            SemanticConvention.GEN_AI_AGENT_NAME, "WeatherBot"
        )
        span.set_attribute.assert_any_call(
            SemanticConvention.GEN_AI_AGENT_DESCRIPTION, "A bot that gets weather"
        )

    def test_name_falls_back_to_id(self):
        span = MagicMock()
        instance = MagicMock()
        instance.id = "agent-xyz"
        instance.name = None
        instance.description = None

        _set_agent_attributes(span, instance)

        span.set_attribute.assert_any_call(
            SemanticConvention.GEN_AI_AGENT_NAME, "agent-xyz"
        )


# ===================================================================
# Workflow Attributes
# ===================================================================
class TestWorkflowAttributes:
    """Tests for _set_workflow_attributes."""

    def test_sets_workflow_name(self):
        span = MagicMock()
        instance = MagicMock()
        instance.name = "my_pipeline"

        _set_workflow_attributes(span, instance)

        span.set_attribute.assert_any_call(
            SemanticConvention.GEN_AI_WORKFLOW_NAME, "my_pipeline"
        )

    def test_fallback_to_id(self):
        span = MagicMock()
        instance = MagicMock(spec=["id"])
        instance.id = "wf-123"

        _set_workflow_attributes(span, instance)

        span.set_attribute.assert_any_call(
            SemanticConvention.GEN_AI_WORKFLOW_NAME, "wf-123"
        )


# ===================================================================
# Tool Attributes
# ===================================================================
class TestToolAttributes:
    """Tests for _set_tool_attributes."""

    def test_basic_tool_attributes(self):
        span = MagicMock()
        tool = MagicMock()
        tool.name = "calculator"
        tool.description = "Does math"

        _set_tool_attributes(span, tool, capture_message_content=False)

        span.set_attribute.assert_any_call(
            SemanticConvention.GEN_AI_TOOL_NAME, "calculator"
        )
        span.set_attribute.assert_any_call(
            SemanticConvention.GEN_AI_TOOL_TYPE, "function"
        )
        span.set_attribute.assert_any_call(
            SemanticConvention.GEN_AI_TOOL_DESCRIPTION, "Does math"
        )

    def test_tool_call_args_and_result(self):
        span = MagicMock()
        tool = MagicMock()
        tool.name = "search"
        tool.description = None

        _set_tool_attributes(
            span, tool,
            capture_message_content=True,
            tool_call_id="call-123",
            arguments={"query": "weather"},
            result={"temp": 72},
        )

        span.set_attribute.assert_any_call(
            SemanticConvention.GEN_AI_TOOL_CALL_ID, "call-123"
        )
        # Check arguments and result are JSON
        call_args = {
            c[0][0]: c[0][1]
            for c in span.set_attribute.call_args_list
        }
        assert SemanticConvention.GEN_AI_TOOL_CALL_ARGUMENTS in call_args
        assert SemanticConvention.GEN_AI_TOOL_CALL_RESULT in call_args

    def test_no_content_capture_skips_args_result(self):
        span = MagicMock()
        tool = MagicMock()
        tool.name = "search"
        tool.description = None

        _set_tool_attributes(
            span, tool,
            capture_message_content=False,
            arguments={"query": "test"},
            result="some result",
        )

        call_attrs = {c[0][0] for c in span.set_attribute.call_args_list}
        assert SemanticConvention.GEN_AI_TOOL_CALL_ARGUMENTS not in call_attrs
        assert SemanticConvention.GEN_AI_TOOL_CALL_RESULT not in call_attrs


# ===================================================================
# Response Attribute Extraction
# ===================================================================
class TestResponseAttributes:
    """Tests for _extract_response_attributes."""

    def test_full_response(self):
        span = MagicMock()
        response = MagicMock()
        response.response_id = "resp-001"
        response.model_id = "gpt-4o"
        response.usage_details = {
            "input_token_count": 100,
            "output_token_count": 50,
        }
        response.finish_reason = "stop"

        _extract_response_attributes(span, response)

        span.set_attribute.assert_any_call(
            SemanticConvention.GEN_AI_RESPONSE_ID, "resp-001"
        )
        span.set_attribute.assert_any_call(
            SemanticConvention.GEN_AI_RESPONSE_MODEL, "gpt-4o"
        )
        span.set_attribute.assert_any_call(
            SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS, 100
        )
        span.set_attribute.assert_any_call(
            SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS, 50
        )

    def test_none_response(self):
        span = MagicMock()
        _extract_response_attributes(span, None)
        span.set_attribute.assert_not_called()

    def test_no_usage(self):
        span = MagicMock()
        response = MagicMock()
        response.response_id = "r1"
        response.model_id = None
        response.usage_details = None
        response.finish_reason = None

        _extract_response_attributes(span, response)

        call_attrs = {c[0][0] for c in span.set_attribute.call_args_list}
        assert SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS not in call_attrs


# ===================================================================
# Input Message Capture
# ===================================================================
class TestInputMessageCapture:
    """Tests for _capture_input_messages."""

    def test_string_input(self):
        span = MagicMock()
        _capture_input_messages(span, "Hello, world!")

        call_attrs = {c[0][0]: c[0][1] for c in span.set_attribute.call_args_list}
        assert SemanticConvention.GEN_AI_INPUT_MESSAGES in call_attrs
        parsed = json.loads(call_attrs[SemanticConvention.GEN_AI_INPUT_MESSAGES])
        assert parsed[0]["role"] == "user"
        assert "Hello" in parsed[0]["content"]

    def test_list_of_strings(self):
        span = MagicMock()
        _capture_input_messages(span, ["msg1", "msg2"])

        call_attrs = {c[0][0]: c[0][1] for c in span.set_attribute.call_args_list}
        parsed = json.loads(call_attrs[SemanticConvention.GEN_AI_INPUT_MESSAGES])
        assert len(parsed) == 2

    def test_none_input(self):
        span = MagicMock()
        _capture_input_messages(span, None)
        span.set_attribute.assert_not_called()

    def test_af_message_objects(self):
        span = MagicMock()

        content = MagicMock()
        content.type = "text"
        content.text = "What is 2+2?"

        msg = MagicMock()
        msg.role = "user"
        msg.contents = [content]

        _capture_input_messages(span, [msg])

        call_attrs = {c[0][0]: c[0][1] for c in span.set_attribute.call_args_list}
        parsed = json.loads(call_attrs[SemanticConvention.GEN_AI_INPUT_MESSAGES])
        assert parsed[0]["role"] == "user"
        assert parsed[0]["parts"][0]["type"] == "text"


# ===================================================================
# Output Message Capture
# ===================================================================
class TestOutputMessageCapture:
    """Tests for _capture_output_messages."""

    def test_basic_output(self):
        span = MagicMock()

        content = MagicMock()
        content.type = "text"
        content.text = "The answer is 4."

        msg = MagicMock()
        msg.role = "assistant"
        msg.contents = [content]

        response = MagicMock()
        response.messages = [msg]

        _capture_output_messages(span, response)

        call_attrs = {c[0][0]: c[0][1] for c in span.set_attribute.call_args_list}
        parsed = json.loads(call_attrs[SemanticConvention.GEN_AI_OUTPUT_MESSAGES])
        assert parsed[0]["role"] == "assistant"
        assert "4" in parsed[0]["parts"][0]["content"]

    def test_none_response(self):
        span = MagicMock()
        _capture_output_messages(span, None)
        span.set_attribute.assert_not_called()

    def test_function_call_content(self):
        span = MagicMock()

        content = MagicMock()
        content.type = "function_call"
        content.call_id = "call-99"
        content.name = "get_weather"
        content.arguments = '{"city": "NYC"}'

        msg = MagicMock()
        msg.role = "assistant"
        msg.contents = [content]

        response = MagicMock()
        response.messages = [msg]

        _capture_output_messages(span, response)

        call_attrs = {c[0][0]: c[0][1] for c in span.set_attribute.call_args_list}
        parsed = json.loads(call_attrs[SemanticConvention.GEN_AI_OUTPUT_MESSAGES])
        assert parsed[0]["parts"][0]["type"] == "tool_call"
        assert parsed[0]["parts"][0]["name"] == "get_weather"


# ===================================================================
# System Instructions and Tool Definitions
# ===================================================================
class TestSystemInstructions:
    """Tests for _capture_system_instructions."""

    def test_captures_instructions(self):
        span = MagicMock()
        instance = MagicMock()
        instance.instructions = "You are a helpful assistant."

        _capture_system_instructions(span, instance)

        call_attrs = {c[0][0]: c[0][1] for c in span.set_attribute.call_args_list}
        assert SemanticConvention.GEN_AI_SYSTEM_INSTRUCTIONS in call_attrs
        parsed = json.loads(call_attrs[SemanticConvention.GEN_AI_SYSTEM_INSTRUCTIONS])
        assert parsed[0]["type"] == "text"
        assert "helpful" in parsed[0]["content"]

    def test_no_instructions(self):
        span = MagicMock()
        instance = MagicMock()
        instance.instructions = None

        _capture_system_instructions(span, instance)
        span.set_attribute.assert_not_called()


class TestToolDefinitions:
    """Tests for _capture_tool_definitions."""

    def test_captures_tool_defs(self):
        span = MagicMock()

        tool1 = MagicMock()
        tool1.name = "search"
        tool1.description = "Search the web"

        tool2 = MagicMock()
        tool2.name = "calculator"
        tool2.description = None

        instance = MagicMock()
        instance.tools = [tool1, tool2]

        _capture_tool_definitions(span, instance)

        call_attrs = {c[0][0]: c[0][1] for c in span.set_attribute.call_args_list}
        assert SemanticConvention.GEN_AI_TOOL_DEFINITIONS in call_attrs
        parsed = json.loads(call_attrs[SemanticConvention.GEN_AI_TOOL_DEFINITIONS])
        assert len(parsed) == 2
        assert parsed[0]["name"] == "search"
        assert parsed[0]["type"] == "function"

    def test_no_tools(self):
        span = MagicMock()
        instance = MagicMock()
        instance.tools = None

        _capture_tool_definitions(span, instance)
        span.set_attribute.assert_not_called()


# ===================================================================
# Metrics Recording
# ===================================================================
class TestMetricsRecording:
    """Tests for _record_metrics."""

    def test_records_duration(self):
        metrics = {"genai_client_operation_duration": MagicMock()}
        _record_metrics(
            metrics,
            "invoke_agent",
            1.5,
            "production",
            "my_app",
            "gpt-4o",
            "api.openai.com",
            443,
        )
        metrics["genai_client_operation_duration"].record.assert_called_once()
        call_args = metrics["genai_client_operation_duration"].record.call_args
        assert call_args[0][0] == 1.5

    def test_skips_unknown_model(self):
        metrics = {"genai_client_operation_duration": MagicMock()}
        _record_metrics(
            metrics, "invoke_agent", 1.0, "dev", "app", "unknown", "", 0
        )
        call_attrs = metrics["genai_client_operation_duration"].record.call_args[1].get(
            "attributes"
        ) or metrics["genai_client_operation_duration"].record.call_args[0][1]
        assert SemanticConvention.GEN_AI_REQUEST_MODEL not in call_attrs

    def test_no_metrics_dict(self):
        _record_metrics({}, "invoke_agent", 1.0, "dev", "app", "gpt-4", "", 0)


# ===================================================================
# Process Response
# ===================================================================
class TestProcessResponse:
    """Tests for process_agent_framework_response."""

    def test_sets_status_ok(self):
        span = MagicMock()
        instance = MagicMock(spec=[])

        process_agent_framework_response(
            span=span,
            endpoint="agent_run",
            instance=instance,
            start_time=100.0,
            version="0.1.0",
            environment="test",
            application_name="app",
            capture_message_content=False,
            metrics=None,
            disable_metrics=True,
        )

        span.set_status.assert_called_once()


# ===================================================================
# Agent Init Wrapper
# ===================================================================
class TestWrapAgentInit:
    """Tests for _wrap_agent_init."""

    def test_emits_create_agent_span(self):
        tracer = MagicMock()
        mock_span = MagicMock()
        mock_span.get_span_context.return_value = MagicMock()
        tracer.start_as_current_span.return_value.__enter__ = MagicMock(
            return_value=mock_span
        )
        tracer.start_as_current_span.return_value.__exit__ = MagicMock(
            return_value=False
        )

        registry = _AgentCreationRegistry()
        wrapper_fn = _wrap_agent_init(
            tracer, "test", "app", True, registry
        )

        original_init = MagicMock(return_value=None)
        instance = MagicMock()
        instance.name = "TestAgent"
        instance.id = "agent-001"
        instance.description = "A test agent"
        instance.model_id = "gpt-4"
        instance.instructions = "Be helpful"
        instance.tools = None

        wrapper_fn(original_init, instance, [], {})

        original_init.assert_called_once()
        tracer.start_as_current_span.assert_called_once()
        assert "create_agent" in tracer.start_as_current_span.call_args[0][0]

    def test_registers_creation_context(self):
        tracer = MagicMock()
        mock_span = MagicMock()
        mock_ctx = MagicMock()
        mock_span.get_span_context.return_value = mock_ctx
        tracer.start_as_current_span.return_value.__enter__ = MagicMock(
            return_value=mock_span
        )
        tracer.start_as_current_span.return_value.__exit__ = MagicMock(
            return_value=False
        )

        registry = _AgentCreationRegistry()
        wrapper_fn = _wrap_agent_init(
            tracer, "test", "app", False, registry
        )

        original_init = MagicMock(return_value=None)
        instance = MagicMock()
        instance.name = "MyAgent"
        instance.id = None
        instance.description = None
        instance.model_id = None
        instance.instructions = None
        instance.tools = None

        wrapper_fn(original_init, instance, [], {})

        assert registry.get("MyAgent") is mock_ctx


# ===================================================================
# Instrumentor Basic
# ===================================================================
class TestInstrumentorBasic:
    """Basic tests for AgentFrameworkInstrumentor."""

    def test_instrumentor_can_be_instantiated(self):
        instrumentor = AgentFrameworkInstrumentor()
        assert instrumentor is not None

    def test_instrumentation_dependencies(self):
        instrumentor = AgentFrameworkInstrumentor()
        deps = instrumentor.instrumentation_dependencies()
        assert any("agent-framework" in d for d in deps)


# ===================================================================
# Semconv Constants
# ===================================================================
class TestSemconvConstants:
    """Verify required semantic convention constants exist."""

    def test_agent_framework_system_constant(self):
        assert hasattr(SemanticConvention, "GEN_AI_SYSTEM_AGENT_FRAMEWORK")
        assert SemanticConvention.GEN_AI_SYSTEM_AGENT_FRAMEWORK == "agent_framework"

    def test_required_operation_type_constants(self):
        assert hasattr(SemanticConvention, "GEN_AI_OPERATION_TYPE_CREATE_AGENT")
        assert hasattr(SemanticConvention, "GEN_AI_OPERATION_TYPE_AGENT")
        assert hasattr(SemanticConvention, "GEN_AI_OPERATION_TYPE_FRAMEWORK")
        assert hasattr(SemanticConvention, "GEN_AI_OPERATION_TYPE_TOOLS")

    def test_required_attribute_constants(self):
        attrs = [
            "GEN_AI_AGENT_ID",
            "GEN_AI_AGENT_NAME",
            "GEN_AI_AGENT_DESCRIPTION",
            "GEN_AI_WORKFLOW_NAME",
            "GEN_AI_TOOL_NAME",
            "GEN_AI_TOOL_TYPE",
            "GEN_AI_TOOL_DESCRIPTION",
            "GEN_AI_TOOL_CALL_ID",
            "GEN_AI_TOOL_CALL_ARGUMENTS",
            "GEN_AI_TOOL_CALL_RESULT",
            "GEN_AI_TOOL_DEFINITIONS",
            "GEN_AI_SYSTEM_INSTRUCTIONS",
            "GEN_AI_INPUT_MESSAGES",
            "GEN_AI_OUTPUT_MESSAGES",
            "GEN_AI_USAGE_INPUT_TOKENS",
            "GEN_AI_USAGE_OUTPUT_TOKENS",
            "GEN_AI_RESPONSE_ID",
            "GEN_AI_RESPONSE_MODEL",
            "GEN_AI_REQUEST_MODEL",
            "GEN_AI_CONVERSATION_ID",
        ]
        for attr in attrs:
            assert hasattr(SemanticConvention, attr), f"Missing constant: {attr}"


# ===================================================================
# Operations Lists
# ===================================================================
class TestOperationsLists:
    """Verify that WORKFLOW_OPERATIONS and DETAILED_OPERATIONS are structured
    correctly -- tool_execute always active, create_agent detailed-only."""

    def test_workflow_operations_contains_agent_run(self):
        op_keys = [op[2] for op in WORKFLOW_OPERATIONS]
        assert "agent_run" in op_keys

    def test_workflow_operations_contains_tool_execute(self):
        op_keys = [op[2] for op in WORKFLOW_OPERATIONS]
        assert "tool_execute" in op_keys

    def test_workflow_operations_does_not_contain_agent_init(self):
        op_keys = [op[2] for op in WORKFLOW_OPERATIONS]
        assert "agent_init" not in op_keys

    def test_detailed_operations_contains_agent_init(self):
        op_keys = [op[2] for op in DETAILED_OPERATIONS]
        assert "agent_init" in op_keys

    def test_detailed_operations_contains_workflow_run(self):
        op_keys = [op[2] for op in DETAILED_OPERATIONS]
        assert "workflow_run" in op_keys

    def test_tool_execute_targets_function_tool(self):
        tool_entry = [op for op in WORKFLOW_OPERATIONS if op[2] == "tool_execute"]
        assert len(tool_entry) == 1
        module, method, _, _ = tool_entry[0]
        assert module == "agent_framework._tools"
        assert method == "FunctionTool.invoke"


# ===================================================================
# Tool Execute Wrapper
# ===================================================================
class TestToolExecuteWrap:
    """Tests for tool_execute_wrap that emits execute_tool spans."""

    def _make_wrapper(self, capture_message_content=True, disable_metrics=True):
        tracer = MagicMock()
        mock_span = MagicMock()
        tracer.start_as_current_span.return_value.__enter__ = MagicMock(
            return_value=mock_span
        )
        tracer.start_as_current_span.return_value.__exit__ = MagicMock(
            return_value=False
        )
        registry = _AgentCreationRegistry()
        wrapper_fn = tool_execute_wrap(
            "tool_execute",
            "1.0.0rc5",
            "test",
            "test_app",
            tracer,
            {},
            capture_message_content,
            {"genai_client_operation_duration": MagicMock()},
            disable_metrics,
            registry,
        )
        return wrapper_fn, tracer, mock_span

    @pytest.mark.asyncio
    async def test_emits_execute_tool_span(self):
        wrapper_fn, tracer, _mock_span = self._make_wrapper()

        async def fake_invoke(*args, **kwargs):
            return "tool result"

        instance = MagicMock()
        instance.name = "get_weather"
        instance.description = "Get weather for a city"

        result_coro = wrapper_fn(
            fake_invoke, instance, [],
            {"tool_call_id": "call-1", "city": "NYC"},
        )
        result = await result_coro

        assert result == "tool result"
        tracer.start_as_current_span.assert_called_once()
        span_name = tracer.start_as_current_span.call_args[0][0]
        assert span_name == "execute_tool get_weather"
        assert tracer.start_as_current_span.call_args[1]["kind"] == SpanKind.INTERNAL

    @pytest.mark.asyncio
    async def test_sets_tool_attributes(self):
        wrapper_fn, _tracer, mock_span = self._make_wrapper()

        async def fake_invoke(*args, **kwargs):
            return '{"temp": 72}'

        instance = MagicMock()
        instance.name = "get_weather"
        instance.description = "Get weather"

        await wrapper_fn(
            fake_invoke, instance, [],
            {"tool_call_id": "call-42", "city": "SF"},
        )

        call_attrs = {
            c[0][0]: c[0][1] for c in mock_span.set_attribute.call_args_list
        }
        assert call_attrs[SemanticConvention.GEN_AI_TOOL_NAME] == "get_weather"
        assert call_attrs[SemanticConvention.GEN_AI_TOOL_CALL_ID] == "call-42"
        assert call_attrs[SemanticConvention.GEN_AI_OPERATION] == SemanticConvention.GEN_AI_OPERATION_TYPE_TOOLS

    @pytest.mark.asyncio
    async def test_captures_arguments_when_enabled(self):
        wrapper_fn, _, mock_span = self._make_wrapper(capture_message_content=True)

        async def fake_invoke(*args, **kwargs):
            return "result"

        instance = MagicMock()
        instance.name = "search"
        instance.description = None

        await wrapper_fn(
            fake_invoke, instance, [],
            {"tool_call_id": "call-1", "arguments": {"query": "hello"}},
        )

        call_attrs = {
            c[0][0]: c[0][1] for c in mock_span.set_attribute.call_args_list
        }
        assert SemanticConvention.GEN_AI_TOOL_CALL_ARGUMENTS in call_attrs
        parsed = json.loads(call_attrs[SemanticConvention.GEN_AI_TOOL_CALL_ARGUMENTS])
        assert parsed == {"query": "hello"}

    @pytest.mark.asyncio
    async def test_captures_result_when_enabled(self):
        wrapper_fn, _, mock_span = self._make_wrapper(capture_message_content=True)

        async def fake_invoke(*args, **kwargs):
            return '{"data": "value"}'

        instance = MagicMock()
        instance.name = "fetch"
        instance.description = None

        await wrapper_fn(
            fake_invoke, instance, [],
            {"tool_call_id": "call-1"},
        )

        call_attrs = {
            c[0][0]: c[0][1] for c in mock_span.set_attribute.call_args_list
        }
        assert SemanticConvention.GEN_AI_TOOL_CALL_RESULT in call_attrs

    @pytest.mark.asyncio
    async def test_skips_content_when_disabled(self):
        wrapper_fn, _, mock_span = self._make_wrapper(capture_message_content=False)

        async def fake_invoke(*args, **kwargs):
            return "secret"

        instance = MagicMock()
        instance.name = "tool"
        instance.description = None

        await wrapper_fn(
            fake_invoke, instance, [],
            {"tool_call_id": "call-1", "password": "abc"},
        )

        call_attrs = {
            c[0][0] for c in mock_span.set_attribute.call_args_list
        }
        assert SemanticConvention.GEN_AI_TOOL_CALL_ARGUMENTS not in call_attrs
        assert SemanticConvention.GEN_AI_TOOL_CALL_RESULT not in call_attrs

    @pytest.mark.asyncio
    async def test_handles_exception(self):
        wrapper_fn, _, _mock_span = self._make_wrapper()

        async def failing_invoke(*args, **kwargs):
            raise ValueError("tool error")

        instance = MagicMock()
        instance.name = "bad_tool"
        instance.description = None

        with pytest.raises(ValueError, match="tool error"):
            await wrapper_fn(
                failing_invoke, instance, [],
                {"tool_call_id": "call-1"},
            )

    @pytest.mark.asyncio
    async def test_records_metrics_when_enabled(self):
        metrics_mock = {"genai_client_operation_duration": MagicMock()}
        tracer = MagicMock()
        mock_span = MagicMock()
        tracer.start_as_current_span.return_value.__enter__ = MagicMock(
            return_value=mock_span
        )
        tracer.start_as_current_span.return_value.__exit__ = MagicMock(
            return_value=False
        )
        registry = _AgentCreationRegistry()
        wrapper_fn = tool_execute_wrap(
            "tool_execute", "1.0.0", "prod", "app",
            tracer, {}, False, metrics_mock, False, registry,
        )

        async def fake_invoke(*args, **kwargs):
            return "ok"

        instance = MagicMock()
        instance.name = "tool"
        instance.description = None

        await wrapper_fn(fake_invoke, instance, [], {"tool_call_id": "c1"})
        metrics_mock["genai_client_operation_duration"].record.assert_called_once()

    @pytest.mark.asyncio
    async def test_extracts_arguments_from_arguments_kwarg(self):
        """Verify that only kwargs['arguments'] is used, not the full kwargs dict."""
        wrapper_fn, _, mock_span = self._make_wrapper(capture_message_content=True)

        async def fake_invoke(*args, **kwargs):
            return "ok"

        instance = MagicMock()
        instance.name = "tool"
        instance.description = None

        await wrapper_fn(
            fake_invoke, instance, [],
            {"tool_call_id": "c1", "arguments": {"city": "SF"}, "context": None},
        )

        call_attrs = {
            c[0][0]: c[0][1] for c in mock_span.set_attribute.call_args_list
        }
        args_str = call_attrs.get(SemanticConvention.GEN_AI_TOOL_CALL_ARGUMENTS, "")
        assert "context" not in args_str
        assert "city" in args_str

    @pytest.mark.asyncio
    async def test_serializes_content_result(self):
        """Verify that list[Content] results are serialized via __str__."""
        wrapper_fn, _, mock_span = self._make_wrapper(capture_message_content=True)

        content_obj = MagicMock()
        content_obj.type = "text"
        content_obj.text = "62°F, foggy"
        content_obj.__str__ = MagicMock(return_value="62°F, foggy")

        async def fake_invoke(*args, **kwargs):
            return [content_obj]

        instance = MagicMock()
        instance.name = "get_weather"
        instance.description = None

        await wrapper_fn(
            fake_invoke, instance, [],
            {"tool_call_id": "c1"},
        )

        call_attrs = {
            c[0][0]: c[0][1] for c in mock_span.set_attribute.call_args_list
        }
        result_str = call_attrs.get(SemanticConvention.GEN_AI_TOOL_CALL_RESULT, "")
        assert "62°F, foggy" in result_str


# ===================================================================
# Content Serialization Helper
# ===================================================================
class TestSerializeContentList:
    """Tests for _serialize_content_list helper."""

    def test_none_returns_none(self):
        assert _serialize_content_list(None) is None

    def test_empty_list_returns_none(self):
        assert _serialize_content_list([]) is None

    def test_string_passthrough(self):
        assert _serialize_content_list("hello") == "hello"

    def test_single_content_object(self):
        obj = MagicMock()
        obj.__str__ = MagicMock(return_value="The weather is sunny")
        result = _serialize_content_list([obj])
        assert result == "The weather is sunny"

    def test_multiple_content_objects(self):
        obj1 = MagicMock()
        obj1.__str__ = MagicMock(return_value="Line 1")
        obj2 = MagicMock()
        obj2.__str__ = MagicMock(return_value="Line 2")
        result = _serialize_content_list([obj1, obj2])
        assert result == "Line 1\nLine 2"

    def test_filters_none_items(self):
        obj = MagicMock()
        obj.__str__ = MagicMock(return_value="valid")
        result = _serialize_content_list([None, obj, None])
        assert result == "valid"
