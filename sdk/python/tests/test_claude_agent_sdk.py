# pylint: disable=duplicate-code, no-member, too-few-public-methods, missing-class-docstring, missing-function-docstring
"""
Tests for Claude Agent SDK instrumentation using the claude-agent-sdk Python library.

Tests cover:
- Instrumentor import and basic instantiation
- Utils: OPERATION_MAP, SPAN_KIND_MAP, ANTHROPIC_FINISH_REASON_MAP
- Span name generation
- SpanKind resolution
- Token usage extraction (including cached token summing)
- Finish reason mapping
- AssistantMessage meaningful content detection
- Tool result input building
- Chat span attribute enrichment
- Tool span attribute enrichment (incl. MCP type detection)
- Create agent span attributes
- Root invoke_agent span attributes
- ResultMessage processing (num_turns, duration, cost, error)
- Output message JSON schema compliance (OTel parts schema)
- Input message JSON schema compliance
- System instructions JSON schema compliance
- Inference event emission
- Metrics recording (duration + token usage)
- Cost calculation
- ToolSpanTracker lifecycle (start, end, error, end_all, dedup)
- SubagentSpanTracker lifecycle (start, end, tool_use_id mapping)

Note: These tests do NOT require claude-agent-sdk to be installed -- they mock
all SDK internals so the test suite can run in any environment.
"""

import json
from unittest.mock import MagicMock

import pytest
from opentelemetry.trace import SpanKind, StatusCode

from openlit.instrumentation.claude_agent_sdk.utils import (
    OPERATION_MAP,
    SPAN_KIND_MAP,
    ANTHROPIC_FINISH_REASON_MAP,
    SERVER_ADDRESS,
    SERVER_PORT,
    GEN_AI_SYSTEM_ATTR,
    GEN_AI_SYSTEM_VALUE,
    generate_span_name,
    resolve_agent_display_name,
    get_span_kind,
    extract_usage,
    update_root_from_assistant,
    has_llm_call_data,
    has_meaningful_content,
    build_input_from_tool_results,
    set_chat_span_attributes,
    set_tool_span_attributes,
    finalize_tool_span,
    set_create_agent_attributes,
    set_initial_span_attributes,
    process_result_message,
    finalize_span,
)
from openlit.semcov import SemanticConvention


# ---------------------------------------------------------------------------
# Helpers — mock Claude Agent SDK types
# ---------------------------------------------------------------------------
def _make_assistant_message(
    model="claude-sonnet-4-20250514",
    content=None,
    usage=None,
    stop_reason=None,
    message_id="msg_001",
    session_id="sess_001",
    parent_tool_use_id=None,
):
    msg = MagicMock()
    type(msg).__name__ = "AssistantMessage"
    msg.model = model
    msg.content = content or []
    msg.usage = usage
    msg.stop_reason = stop_reason
    msg.message_id = message_id
    msg.session_id = session_id
    msg.parent_tool_use_id = parent_tool_use_id
    return msg


def _make_text_block(text="Hello world"):
    block = MagicMock()
    type(block).__name__ = "TextBlock"
    block.text = text
    return block


def _make_thinking_block(thinking="Let me think about this..."):
    block = MagicMock()
    type(block).__name__ = "ThinkingBlock"
    block.thinking = thinking
    return block


def _make_tool_use_block(name="Bash", input_data=None, tool_id="toolu_001"):
    block = MagicMock()
    type(block).__name__ = "ToolUseBlock"
    block.name = name
    block.input = input_data or {"command": "ls"}
    block.id = tool_id
    return block


def _make_tool_result_block(
    tool_use_id="toolu_001", content="file1.txt\nfile2.txt", is_error=False
):
    block = MagicMock()
    type(block).__name__ = "ToolResultBlock"
    block.tool_use_id = tool_use_id
    block.content = content
    block.is_error = is_error
    return block


def _make_usage(input_tokens=100, output_tokens=50, cache_read=0, cache_creation=0):
    """Build a usage object with only the fields extract_usage looks for.

    Uses SimpleNamespace to avoid MagicMock auto-creating unexpected attributes
    (e.g. cache_write_input_tokens) that break int() coercion.
    """
    from types import SimpleNamespace

    return SimpleNamespace(
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        cache_read_input_tokens=cache_read,
        cache_creation_input_tokens=cache_creation,
    )


def _make_result_message(
    session_id="sess_001",
    usage=None,
    total_cost_usd=0.005,
    model_usage=None,
    num_turns=2,
    duration_ms=5000,
    duration_api_ms=4000,
    is_error=False,
    result="The answer is 42.",
):
    msg = MagicMock()
    type(msg).__name__ = "ResultMessage"
    msg.session_id = session_id
    msg.usage = usage
    msg.total_cost_usd = total_cost_usd
    msg.model_usage = model_usage or {"claude-sonnet-4-20250514": {}}
    msg.num_turns = num_turns
    msg.duration_ms = duration_ms
    msg.duration_api_ms = duration_api_ms
    msg.is_error = is_error
    msg.result = result
    return msg


def _make_user_message(content=None):
    msg = MagicMock()
    type(msg).__name__ = "UserMessage"
    msg.content = content or []
    return msg


def _get_span_attrs(span):
    """Extract a dict of all set_attribute calls on a mock span."""
    return {c[0][0]: c[0][1] for c in span.set_attribute.call_args_list}


# ===========================================================================
# Constants & Maps
# ===========================================================================
class TestOperationMap:
    def test_has_required_endpoints(self):
        for key in (
            "query",
            "receive_response",
            "execute_tool",
            "subagent",
            "chat",
            "create_agent",
        ):
            assert key in OPERATION_MAP, f"Missing endpoint: {key}"

    def test_query_maps_to_invoke_agent(self):
        assert OPERATION_MAP["query"] == SemanticConvention.GEN_AI_OPERATION_TYPE_AGENT

    def test_chat_maps_to_chat(self):
        assert OPERATION_MAP["chat"] == SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT

    def test_execute_tool_maps_to_tools(self):
        assert (
            OPERATION_MAP["execute_tool"]
            == SemanticConvention.GEN_AI_OPERATION_TYPE_TOOLS
        )

    def test_create_agent_maps_correctly(self):
        assert (
            OPERATION_MAP["create_agent"]
            == SemanticConvention.GEN_AI_OPERATION_TYPE_CREATE_AGENT
        )


class TestSpanKindMap:
    def test_agent_is_internal(self):
        assert (
            SPAN_KIND_MAP[SemanticConvention.GEN_AI_OPERATION_TYPE_AGENT]
            == SpanKind.INTERNAL
        )

    def test_chat_is_client(self):
        assert (
            SPAN_KIND_MAP[SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT]
            == SpanKind.CLIENT
        )

    def test_tools_is_internal(self):
        assert (
            SPAN_KIND_MAP[SemanticConvention.GEN_AI_OPERATION_TYPE_TOOLS]
            == SpanKind.INTERNAL
        )

    def test_create_agent_is_client(self):
        assert (
            SPAN_KIND_MAP[SemanticConvention.GEN_AI_OPERATION_TYPE_CREATE_AGENT]
            == SpanKind.CLIENT
        )


class TestFinishReasonMap:
    def test_end_turn_maps_to_stop(self):
        assert ANTHROPIC_FINISH_REASON_MAP["end_turn"] == "stop"

    def test_max_tokens_maps_to_length(self):
        assert ANTHROPIC_FINISH_REASON_MAP["max_tokens"] == "length"

    def test_tool_use_maps_to_tool_call(self):
        assert ANTHROPIC_FINISH_REASON_MAP["tool_use"] == "tool_call"

    def test_stop_sequence_maps_to_stop(self):
        assert ANTHROPIC_FINISH_REASON_MAP["stop_sequence"] == "stop"


class TestConstants:
    def test_server_address(self):
        assert SERVER_ADDRESS == "api.anthropic.com"

    def test_server_port(self):
        assert SERVER_PORT == 443

    def test_gen_ai_system_value(self):
        assert GEN_AI_SYSTEM_VALUE == "anthropic"

    def test_gen_ai_system_attr(self):
        assert GEN_AI_SYSTEM_ATTR == "gen_ai.system"

    def test_semconv_constant_exists(self):
        assert hasattr(SemanticConvention, "GEN_AI_SYSTEM_CLAUDE_AGENT_SDK")
        assert SemanticConvention.GEN_AI_SYSTEM_CLAUDE_AGENT_SDK == "claude_agent_sdk"


# ===========================================================================
# Span Name Generation
# ===========================================================================
class TestSpanNameGeneration:
    def test_query_span_name(self):
        assert generate_span_name("query") == "invoke_agent claude_agent_sdk"

    def test_receive_response_span_name(self):
        assert generate_span_name("receive_response") == "invoke_agent claude_agent_sdk"

    def test_query_span_name_with_model_entity(self):
        assert generate_span_name("query", "claude-opus-4-20250514") == (
            "invoke_agent claude-opus-4-20250514"
        )

    def test_receive_response_span_name_with_model_entity(self):
        assert generate_span_name("receive_response", "claude-sonnet-4") == (
            "invoke_agent claude-sonnet-4"
        )

    def test_chat_span_name_with_model(self):
        assert (
            generate_span_name("chat", "claude-sonnet-4-20250514")
            == "chat claude-sonnet-4-20250514"
        )

    def test_execute_tool_span_name(self):
        assert generate_span_name("execute_tool", "Bash") == "execute_tool Bash"

    def test_create_agent_span_name(self):
        assert (
            generate_span_name("create_agent", "claude_agent_sdk")
            == "create_agent claude_agent_sdk"
        )

    def test_subagent_span_name(self):
        assert (
            generate_span_name("subagent", "search_agent")
            == "invoke_agent search_agent"
        )

    def test_unknown_operation_falls_back(self):
        name = generate_span_name("unknown_op")
        assert "invoke_agent" in name

    def test_resolve_agent_display_name(self):
        assert resolve_agent_display_name(None) is None
        o = MagicMock()
        o.model = None
        assert resolve_agent_display_name(o) is None
        o.model = "  "
        assert resolve_agent_display_name(o) is None
        o.model = "claude-3-haiku"
        assert resolve_agent_display_name(o) == "claude-3-haiku"


class TestGetSpanKind:
    def test_known_operation_types(self):
        assert (
            get_span_kind(SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT)
            == SpanKind.CLIENT
        )
        assert (
            get_span_kind(SemanticConvention.GEN_AI_OPERATION_TYPE_AGENT)
            == SpanKind.INTERNAL
        )

    def test_unknown_defaults_to_internal(self):
        assert get_span_kind("completely_unknown") == SpanKind.INTERNAL


# ===========================================================================
# Token Usage Extraction
# ===========================================================================
class TestExtractUsage:
    def test_full_usage_object(self):
        usage = _make_usage(
            input_tokens=10, output_tokens=50, cache_read=90, cache_creation=5
        )
        attrs = extract_usage(usage)

        assert attrs[SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS] == 10 + 90 + 5
        assert attrs[SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS] == 50
        assert attrs[SemanticConvention.GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS] == 90
        assert attrs[SemanticConvention.GEN_AI_USAGE_CACHE_CREATION_INPUT_TOKENS] == 5

    def test_input_tokens_sums_all_types(self):
        """OTel spec: gen_ai.usage.input_tokens SHOULD include cached tokens."""
        usage = _make_usage(input_tokens=3, cache_read=9284, cache_creation=122)
        attrs = extract_usage(usage)
        assert attrs[SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS] == 3 + 9284 + 122

    def test_no_cache_tokens(self):
        from types import SimpleNamespace

        usage = SimpleNamespace(
            input_tokens=100,
            output_tokens=50,
            cache_read_input_tokens=None,
            cache_creation_input_tokens=None,
        )
        attrs = extract_usage(usage)
        assert attrs[SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS] == 100

    def test_none_usage_returns_empty(self):
        assert not extract_usage(None)

    def test_dict_usage(self):
        usage = {
            "input_tokens": 200,
            "output_tokens": 100,
            "cache_read_input_tokens": 50,
        }
        attrs = extract_usage(usage)
        assert attrs[SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS] == 250
        assert attrs[SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS] == 100

    def test_none_output_tokens_omitted(self):
        usage = _make_usage(input_tokens=10, output_tokens=0)
        usage.output_tokens = None
        attrs = extract_usage(usage)
        assert SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS not in attrs

    def test_non_numeric_handled_gracefully(self):
        from types import SimpleNamespace

        usage = SimpleNamespace(
            input_tokens="not_a_number",
            output_tokens="bad",
            cache_read_input_tokens=None,
            cache_creation_input_tokens=None,
        )
        attrs = extract_usage(usage)
        assert attrs[SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS] == 0


# ===========================================================================
# Finish Reason Mapping
# ===========================================================================
class TestMapFinishReason:
    def test_all_anthropic_reasons(self):
        from openlit.instrumentation.claude_agent_sdk.utils import _map_finish_reason

        assert _map_finish_reason("end_turn") == "stop"
        assert _map_finish_reason("max_tokens") == "length"
        assert _map_finish_reason("tool_use") == "tool_call"
        assert _map_finish_reason("stop_sequence") == "stop"

    def test_none_defaults_to_stop(self):
        from openlit.instrumentation.claude_agent_sdk.utils import _map_finish_reason

        assert _map_finish_reason(None) == "stop"

    def test_unknown_passed_through(self):
        from openlit.instrumentation.claude_agent_sdk.utils import _map_finish_reason

        assert _map_finish_reason("custom_reason") == "custom_reason"


# ===========================================================================
# Content Detection
# ===========================================================================
class TestHasLLMCallData:
    def test_true_with_model_and_usage(self):
        msg = _make_assistant_message(usage=_make_usage())
        assert has_llm_call_data(msg) is True

    def test_false_without_model(self):
        msg = _make_assistant_message(model=None, usage=_make_usage())
        assert has_llm_call_data(msg) is False

    def test_false_without_usage(self):
        msg = _make_assistant_message(usage=None)
        assert has_llm_call_data(msg) is False


class TestHasMeaningfulContent:
    def test_text_block_is_meaningful(self):
        assert has_meaningful_content([_make_text_block("Hello")]) is True

    def test_empty_text_block_not_meaningful(self):
        assert has_meaningful_content([_make_text_block("")]) is False

    def test_tool_use_block_is_meaningful(self):
        assert has_meaningful_content([_make_tool_use_block()]) is True

    def test_thinking_block_not_meaningful(self):
        assert has_meaningful_content([_make_thinking_block()]) is False

    def test_empty_list_not_meaningful(self):
        assert has_meaningful_content([]) is False

    def test_none_not_meaningful(self):
        assert has_meaningful_content(None) is False

    def test_thinking_plus_tool_use_is_meaningful(self):
        content = [_make_thinking_block(), _make_tool_use_block()]
        assert has_meaningful_content(content) is True

    def test_thinking_only_not_meaningful(self):
        content = [_make_thinking_block(), _make_text_block("")]
        assert has_meaningful_content(content) is False


# ===========================================================================
# Tool Result Input Building
# ===========================================================================
class TestBuildInputFromToolResults:
    def test_builds_tool_call_response_parts(self):
        msg = _make_user_message(
            content=[
                _make_tool_result_block("toolu_001", "result_data"),
            ]
        )
        result = build_input_from_tool_results(msg)

        assert result is not None
        assert len(result) == 1
        assert result[0]["role"] == "user"
        assert result[0]["parts"][0]["type"] == "tool_call_response"
        assert result[0]["parts"][0]["id"] == "toolu_001"
        assert "result_data" in result[0]["parts"][0]["response"]

    def test_multiple_tool_results(self):
        msg = _make_user_message(
            content=[
                _make_tool_result_block("toolu_001", "res1"),
                _make_tool_result_block("toolu_002", "res2"),
            ]
        )
        result = build_input_from_tool_results(msg)
        assert len(result[0]["parts"]) == 2

    def test_no_tool_result_blocks_returns_none(self):
        msg = _make_user_message(content=[_make_text_block("hello")])
        assert build_input_from_tool_results(msg) is None

    def test_empty_content_returns_none(self):
        msg = _make_user_message(content=[])
        assert build_input_from_tool_results(msg) is None

    def test_none_content_returns_none(self):
        msg = MagicMock()
        msg.content = None
        assert build_input_from_tool_results(msg) is None


# ===========================================================================
# Chat Span Attributes
# ===========================================================================
class TestSetChatSpanAttributes:
    def _call(self, message=None, capture=True, pricing_info=None, input_messages=None):
        span = MagicMock()
        if message is None:
            message = _make_assistant_message(
                usage=_make_usage(input_tokens=10, output_tokens=50),
                stop_reason="end_turn",
                content=[_make_text_block("Hello!")],
            )
        set_chat_span_attributes(
            span,
            message,
            capture,
            environment="test",
            application_name="test_app",
            version="0.1.0",
            pricing_info=pricing_info,
            event_provider=None,
            input_messages=input_messages,
        )
        return span, _get_span_attrs(span)

    def test_required_attributes_present(self):
        _, attrs = self._call()
        assert (
            attrs[SemanticConvention.GEN_AI_OPERATION]
            == SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT
        )
        assert (
            attrs[SemanticConvention.GEN_AI_PROVIDER_NAME]
            == SemanticConvention.GEN_AI_SYSTEM_ANTHROPIC
        )

    def test_gen_ai_system_set(self):
        _, attrs = self._call()
        assert attrs[GEN_AI_SYSTEM_ATTR] == "anthropic"

    def test_server_address_and_port(self):
        _, attrs = self._call()
        assert attrs[SemanticConvention.SERVER_ADDRESS] == "api.anthropic.com"
        assert attrs[SemanticConvention.SERVER_PORT] == 443

    def test_model_attributes(self):
        _, attrs = self._call()
        assert (
            attrs[SemanticConvention.GEN_AI_REQUEST_MODEL] == "claude-sonnet-4-20250514"
        )
        assert (
            attrs[SemanticConvention.GEN_AI_RESPONSE_MODEL]
            == "claude-sonnet-4-20250514"
        )

    def test_usage_tokens(self):
        _, attrs = self._call()
        assert attrs[SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS] == 10
        assert attrs[SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS] == 50

    def test_finish_reason_mapped(self):
        _, attrs = self._call()
        assert attrs[SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON] == ["stop"]

    def test_finish_reason_inferred_for_tool_use(self):
        """When stop_reason is None but content has ToolUseBlock, infer tool_use."""
        msg = _make_assistant_message(
            usage=_make_usage(),
            stop_reason=None,
            content=[_make_tool_use_block()],
        )
        _, attrs = self._call(message=msg)
        assert attrs[SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON] == ["tool_call"]

    def test_response_id_set(self):
        _, attrs = self._call()
        assert attrs[SemanticConvention.GEN_AI_RESPONSE_ID] == "msg_001"

    def test_conversation_id_set(self):
        _, attrs = self._call()
        assert attrs[SemanticConvention.GEN_AI_CONVERSATION_ID] == "sess_001"

    def test_cost_always_present(self):
        _, attrs = self._call()
        assert SemanticConvention.GEN_AI_USAGE_COST in attrs

    def test_cost_defaults_to_zero(self):
        _, attrs = self._call(pricing_info=None)
        assert attrs[SemanticConvention.GEN_AI_USAGE_COST] == 0

    def test_output_messages_when_capture_enabled(self):
        _, attrs = self._call(capture=True)
        raw = attrs.get(SemanticConvention.GEN_AI_OUTPUT_MESSAGES)
        assert raw is not None
        messages = json.loads(raw)
        assert messages[0]["role"] == "assistant"
        assert "parts" in messages[0]
        assert messages[0]["parts"][0]["type"] == "text"
        assert "finish_reason" in messages[0]

    def test_no_output_messages_when_capture_disabled(self):
        _, attrs = self._call(capture=False)
        assert SemanticConvention.GEN_AI_OUTPUT_MESSAGES not in attrs

    def test_input_messages_set_when_provided(self):
        input_msgs = [{"role": "user", "parts": [{"type": "text", "content": "Hi"}]}]
        _, attrs = self._call(input_messages=input_msgs)
        raw = attrs.get(SemanticConvention.GEN_AI_INPUT_MESSAGES)
        assert raw is not None
        parsed = json.loads(raw)
        assert parsed[0]["role"] == "user"
        assert parsed[0]["parts"][0]["type"] == "text"

    def test_span_status_ok(self):
        span, _ = self._call()
        span.set_status.assert_called_once()
        status = span.set_status.call_args[0][0]
        assert status.status_code == StatusCode.OK


# ===========================================================================
# Output Message JSON Schema Compliance
# ===========================================================================
class TestOutputMessageSchema:
    def test_text_output_follows_parts_schema(self):
        from openlit.instrumentation.claude_agent_sdk.utils import (
            _build_output_messages,
        )

        msg = _make_assistant_message(content=[_make_text_block("Hello!")])
        result = _build_output_messages(msg, "stop")

        assert isinstance(result, list)
        assert result[0]["role"] == "assistant"
        assert result[0]["finish_reason"] == "stop"
        assert result[0]["parts"][0]["type"] == "text"
        assert result[0]["parts"][0]["content"] == "Hello!"

    def test_tool_call_output_follows_parts_schema(self):
        from openlit.instrumentation.claude_agent_sdk.utils import (
            _build_output_messages,
        )

        msg = _make_assistant_message(
            content=[
                _make_tool_use_block("Bash", {"command": "ls"}, "toolu_001"),
            ]
        )
        result = _build_output_messages(msg, "tool_call")

        tc_part = result[0]["parts"][0]
        assert tc_part["type"] == "tool_call"
        assert tc_part["name"] == "Bash"
        assert tc_part["id"] == "toolu_001"
        assert tc_part["arguments"] == {"command": "ls"}
        assert result[0]["finish_reason"] == "tool_call"

    def test_reasoning_output_uses_correct_type(self):
        """OTel ReasoningPart requires type='reasoning', not 'thinking'."""
        from openlit.instrumentation.claude_agent_sdk.utils import (
            _build_output_messages,
        )

        msg = _make_assistant_message(
            content=[
                _make_thinking_block("Let me analyze..."),
                _make_text_block("The answer is 42."),
            ]
        )
        result = _build_output_messages(msg, "stop")

        parts = result[0]["parts"]
        reasoning_part = parts[0]
        assert reasoning_part["type"] == "reasoning"
        assert reasoning_part["content"] == "Let me analyze..."
        text_part = parts[1]
        assert text_part["type"] == "text"

    def test_mixed_content_output(self):
        from openlit.instrumentation.claude_agent_sdk.utils import (
            _build_output_messages,
        )

        msg = _make_assistant_message(
            content=[
                _make_thinking_block("Thinking..."),
                _make_text_block("Here's the plan:"),
                _make_tool_use_block("Bash", {"command": "ls"}, "toolu_x"),
            ]
        )
        result = _build_output_messages(msg, "tool_call")
        parts = result[0]["parts"]

        assert len(parts) == 3
        assert parts[0]["type"] == "reasoning"
        assert parts[1]["type"] == "text"
        assert parts[2]["type"] == "tool_call"

    def test_empty_content_returns_none(self):
        from openlit.instrumentation.claude_agent_sdk.utils import (
            _build_output_messages,
        )

        msg = _make_assistant_message(content=[])
        assert _build_output_messages(msg, "stop") is None


# ===========================================================================
# Tool Span Attributes
# ===========================================================================
class TestSetToolSpanAttributes:
    def _call(
        self, tool_name="Bash", tool_input=None, tool_use_id="toolu_001", capture=True
    ):
        span = MagicMock()
        set_tool_span_attributes(
            span,
            tool_name,
            tool_input or {"command": "ls"},
            tool_use_id,
            capture,
            "test",
            "test_app",
            "0.1.0",
        )
        return span, _get_span_attrs(span)

    def test_operation_name_is_execute_tool(self):
        _, attrs = self._call()
        assert (
            attrs[SemanticConvention.GEN_AI_OPERATION]
            == SemanticConvention.GEN_AI_OPERATION_TYPE_TOOLS
        )

    def test_gen_ai_system_set(self):
        _, attrs = self._call()
        assert attrs[GEN_AI_SYSTEM_ATTR] == "anthropic"

    def test_tool_name_set(self):
        _, attrs = self._call(tool_name="Bash")
        assert attrs[SemanticConvention.GEN_AI_TOOL_NAME] == "Bash"

    def test_tool_type_function_for_regular_tools(self):
        _, attrs = self._call(tool_name="Bash")
        assert attrs[SemanticConvention.GEN_AI_TOOL_TYPE] == "function"

    def test_tool_type_extension_for_mcp_tools(self):
        _, attrs = self._call(tool_name="mcp__filesystem__read_file")
        assert attrs[SemanticConvention.GEN_AI_TOOL_TYPE] == "extension"

    def test_tool_call_id_set(self):
        _, attrs = self._call(tool_use_id="toolu_abc")
        assert attrs[SemanticConvention.GEN_AI_TOOL_CALL_ID] == "toolu_abc"

    def test_arguments_captured_when_enabled(self):
        _, attrs = self._call(tool_input={"cmd": "ls -la"}, capture=True)
        assert SemanticConvention.GEN_AI_TOOL_CALL_ARGUMENTS in attrs
        parsed = json.loads(attrs[SemanticConvention.GEN_AI_TOOL_CALL_ARGUMENTS])
        assert parsed["cmd"] == "ls -la"

    def test_arguments_not_captured_when_disabled(self):
        _, attrs = self._call(capture=False)
        assert SemanticConvention.GEN_AI_TOOL_CALL_ARGUMENTS not in attrs

    def test_server_address_and_port(self):
        _, attrs = self._call()
        assert attrs[SemanticConvention.SERVER_ADDRESS] == "api.anthropic.com"
        assert attrs[SemanticConvention.SERVER_PORT] == 443


class TestFinalizeToolSpan:
    def test_success_with_result(self):
        span = MagicMock()
        finalize_tool_span(span, "file1.txt\nfile2.txt", capture_message_content=True)

        attrs = _get_span_attrs(span)
        assert SemanticConvention.GEN_AI_TOOL_CALL_RESULT in attrs
        span.set_status.assert_called_once()
        status = span.set_status.call_args[0][0]
        assert status.status_code == StatusCode.OK

    def test_success_without_capture(self):
        span = MagicMock()
        finalize_tool_span(span, "result", capture_message_content=False)

        attrs = _get_span_attrs(span)
        assert SemanticConvention.GEN_AI_TOOL_CALL_RESULT not in attrs

    def test_error_sets_error_type_and_status(self):
        span = MagicMock()
        finalize_tool_span(
            span,
            None,
            capture_message_content=True,
            is_error=True,
            error_message="Permission denied",
        )

        attrs = _get_span_attrs(span)
        assert attrs[SemanticConvention.ERROR_TYPE] == "Permission denied"
        status = span.set_status.call_args[0][0]
        assert status.status_code == StatusCode.ERROR


# ===========================================================================
# Create Agent Span
# ===========================================================================
class TestSetCreateAgentAttributes:
    def test_attributes(self):
        span = MagicMock()
        set_create_agent_attributes(span, "0.1.0", "test", "test_app")

        attrs = _get_span_attrs(span)
        assert (
            attrs[SemanticConvention.GEN_AI_OPERATION]
            == SemanticConvention.GEN_AI_OPERATION_TYPE_CREATE_AGENT
        )
        assert attrs[GEN_AI_SYSTEM_ATTR] == "anthropic"
        assert attrs[SemanticConvention.GEN_AI_AGENT_NAME] == "claude_agent_sdk"
        assert attrs[SemanticConvention.SERVER_ADDRESS] == "api.anthropic.com"
        assert attrs[SemanticConvention.SERVER_PORT] == 443

    def test_custom_agent_name(self):
        span = MagicMock()
        set_create_agent_attributes(
            span, "0.1.0", "test", "test_app", agent_name="claude-sonnet-4-20250514"
        )
        attrs = _get_span_attrs(span)
        assert attrs[SemanticConvention.GEN_AI_AGENT_NAME] == "claude-sonnet-4-20250514"


# ===========================================================================
# Root Span (invoke_agent) Attributes
# ===========================================================================
class TestSetInitialSpanAttributes:
    def _call(
        self,
        model="claude-sonnet-4-20250514",
        prompt="Hello",
        capture=True,
        system_prompt=None,
    ):
        span = MagicMock()
        options = MagicMock()
        options.model = model
        options.system_prompt = system_prompt

        set_initial_span_attributes(
            span,
            1000.0,
            "0.1.0",
            "test",
            "test_app",
            options=options,
            prompt=prompt,
            capture_message_content=capture,
        )
        return span, _get_span_attrs(span)

    def test_operation_name(self):
        _, attrs = self._call()
        assert (
            attrs[SemanticConvention.GEN_AI_OPERATION]
            == SemanticConvention.GEN_AI_OPERATION_TYPE_AGENT
        )

    def test_provider_name(self):
        _, attrs = self._call()
        assert (
            attrs[SemanticConvention.GEN_AI_PROVIDER_NAME]
            == SemanticConvention.GEN_AI_SYSTEM_CLAUDE_AGENT_SDK
        )

    def test_gen_ai_system(self):
        _, attrs = self._call()
        assert attrs[GEN_AI_SYSTEM_ATTR] == "anthropic"

    def test_agent_name_matches_configured_model(self):
        _, attrs = self._call()
        assert attrs[SemanticConvention.GEN_AI_AGENT_NAME] == "claude-sonnet-4-20250514"

    def test_agent_name_falls_back_without_model(self):
        span = MagicMock()
        options = MagicMock()
        options.model = None
        set_initial_span_attributes(
            span,
            1000.0,
            "0.1.0",
            "test",
            "test_app",
            options=options,
            prompt="Hi",
            capture_message_content=False,
        )
        attrs = _get_span_attrs(span)
        assert attrs[SemanticConvention.GEN_AI_AGENT_NAME] == (
            SemanticConvention.GEN_AI_SYSTEM_CLAUDE_AGENT_SDK
        )

    def test_request_model(self):
        _, attrs = self._call(model="claude-sonnet-4-20250514")
        assert (
            attrs[SemanticConvention.GEN_AI_REQUEST_MODEL] == "claude-sonnet-4-20250514"
        )

    def test_input_messages_parts_schema(self):
        """gen_ai.input.messages must use [{role, parts}] schema."""
        _, attrs = self._call(prompt="What is 2+2?", capture=True)
        raw = attrs.get(SemanticConvention.GEN_AI_INPUT_MESSAGES)
        assert raw is not None
        parsed = json.loads(raw)
        assert parsed[0]["role"] == "user"
        assert "parts" in parsed[0]
        assert parsed[0]["parts"][0]["type"] == "text"
        assert parsed[0]["parts"][0]["content"] == "What is 2+2?"

    def test_no_input_messages_when_capture_disabled(self):
        _, attrs = self._call(capture=False)
        assert SemanticConvention.GEN_AI_INPUT_MESSAGES not in attrs

    def test_system_instructions_json_schema(self):
        """gen_ai.system_instructions must follow [{'type': 'text', 'content': '...'}]."""
        _, attrs = self._call(
            system_prompt="You are a helpful assistant.", capture=True
        )
        raw = attrs.get(SemanticConvention.GEN_AI_SYSTEM_INSTRUCTIONS)
        assert raw is not None
        parsed = json.loads(raw)
        assert isinstance(parsed, list)
        assert parsed[0]["type"] == "text"
        assert parsed[0]["content"] == "You are a helpful assistant."


class TestUpdateRootFromAssistant:
    def test_sets_model_and_session(self):
        span = MagicMock()
        msg = _make_assistant_message(
            model="claude-sonnet-4-20250514", session_id="sess_x"
        )
        update_root_from_assistant(span, msg)

        attrs = _get_span_attrs(span)
        assert (
            attrs[SemanticConvention.GEN_AI_REQUEST_MODEL] == "claude-sonnet-4-20250514"
        )
        assert (
            attrs[SemanticConvention.GEN_AI_RESPONSE_MODEL]
            == "claude-sonnet-4-20250514"
        )
        assert attrs[SemanticConvention.GEN_AI_CONVERSATION_ID] == "sess_x"

    def test_handles_none_model_gracefully(self):
        span = MagicMock()
        msg = _make_assistant_message(model=None, session_id=None)
        update_root_from_assistant(span, msg)
        span.set_attribute.assert_not_called()


# ===========================================================================
# ResultMessage Processing
# ===========================================================================
class TestProcessResultMessage:
    def _call(self, **kwargs):
        span = MagicMock()
        msg = _make_result_message(**kwargs)
        result_usage = process_result_message(span, msg, capture_message_content=True)
        return span, _get_span_attrs(span), result_usage

    def test_session_id_set(self):
        _, attrs, _ = self._call(session_id="sess_abc")
        assert attrs[SemanticConvention.GEN_AI_CONVERSATION_ID] == "sess_abc"

    def test_usage_extracted(self):
        usage = _make_usage(
            input_tokens=100, output_tokens=50, cache_read=200, cache_creation=50
        )
        _, attrs, result_usage = self._call(usage=usage)
        assert (
            attrs[SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS] == 350
        )  # 100 + 200 + 50
        assert attrs[SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS] == 50
        assert result_usage["input_tokens"] == 350
        assert result_usage["output_tokens"] == 50

    def test_cost_from_total_cost_usd(self):
        _, attrs, _ = self._call(total_cost_usd=0.0123)
        assert attrs[SemanticConvention.GEN_AI_USAGE_COST] == 0.0123

    def test_response_model_from_model_usage(self):
        _, attrs, _ = self._call(model_usage={"claude-sonnet-4-20250514": {}})
        assert (
            attrs[SemanticConvention.GEN_AI_RESPONSE_MODEL]
            == "claude-sonnet-4-20250514"
        )

    def test_num_turns_set(self):
        _, attrs, _ = self._call(num_turns=3)
        assert attrs["gen_ai.agent.num_turns"] == 3

    def test_duration_ms_set(self):
        _, attrs, _ = self._call(duration_ms=5000)
        assert attrs["gen_ai.agent.duration_ms"] == 5000

    def test_duration_api_ms_set(self):
        _, attrs, _ = self._call(duration_api_ms=4000)
        assert attrs["gen_ai.agent.duration_api_ms"] == 4000

    def test_error_sets_error_type(self):
        span, attrs, _ = self._call(is_error=True, result="Something went wrong")
        assert attrs[SemanticConvention.ERROR_TYPE] == "Something went wrong"
        status = span.set_status.call_args[0][0]
        assert status.status_code == StatusCode.ERROR

    def test_success_sets_ok_status(self):
        span, _, _ = self._call(is_error=False)
        status = span.set_status.call_args[0][0]
        assert status.status_code == StatusCode.OK

    def test_output_messages_in_parts_schema(self):
        _, attrs, _ = self._call(result="The answer is 42.")
        raw = attrs.get(SemanticConvention.GEN_AI_OUTPUT_MESSAGES)
        assert raw is not None
        parsed = json.loads(raw)
        assert parsed[0]["role"] == "assistant"
        assert "parts" in parsed[0]
        assert parsed[0]["parts"][0]["type"] == "text"

    def test_returns_usage_dict(self):
        usage = _make_usage(input_tokens=500, output_tokens=200)
        _, _, result_usage = self._call(usage=usage)
        assert result_usage["input_tokens"] == 500
        assert result_usage["output_tokens"] == 200

    def test_returns_zero_usage_when_no_usage(self):
        _, _, result_usage = self._call(usage=None)
        assert result_usage["input_tokens"] == 0
        assert result_usage["output_tokens"] == 0


# ===========================================================================
# Finalize Span & Metrics
# ===========================================================================
class TestFinalizeSpan:
    def test_sets_duration_attribute(self):
        span = MagicMock()
        metrics = {"genai_client_operation_duration": MagicMock()}
        finalize_span(span, 1000.0, metrics, False, "test", "test_app")

        attrs = _get_span_attrs(span)
        assert SemanticConvention.GEN_AI_CLIENT_OPERATION_DURATION in attrs
        duration = attrs[SemanticConvention.GEN_AI_CLIENT_OPERATION_DURATION]
        assert duration > 0

    def test_records_duration_metric(self):
        metrics = {"genai_client_operation_duration": MagicMock()}
        span = MagicMock()
        finalize_span(span, 1000.0, metrics, False, "test", "test_app")
        metrics["genai_client_operation_duration"].record.assert_called_once()

    def test_records_token_metrics(self):
        metrics = {
            "genai_client_operation_duration": MagicMock(),
            "genai_client_usage_tokens": MagicMock(),
        }
        span = MagicMock()
        finalize_span(
            span,
            1000.0,
            metrics,
            False,
            "test",
            "test_app",
            input_tokens=500,
            output_tokens=200,
        )
        assert metrics["genai_client_usage_tokens"].record.call_count == 2

    def test_skips_metrics_when_disabled(self):
        metrics = {"genai_client_operation_duration": MagicMock()}
        span = MagicMock()
        finalize_span(span, 1000.0, metrics, True, "test", "test_app")
        metrics["genai_client_operation_duration"].record.assert_not_called()

    def test_skips_zero_token_metrics(self):
        metrics = {
            "genai_client_operation_duration": MagicMock(),
            "genai_client_usage_tokens": MagicMock(),
        }
        span = MagicMock()
        finalize_span(
            span,
            1000.0,
            metrics,
            False,
            "test",
            "test_app",
            input_tokens=0,
            output_tokens=0,
        )
        metrics["genai_client_usage_tokens"].record.assert_not_called()


# ===========================================================================
# Cost Calculation
# ===========================================================================
class TestCostCalculation:
    def test_no_pricing_returns_zero(self):
        from openlit.instrumentation.claude_agent_sdk.utils import _calculate_cost

        assert _calculate_cost("claude-sonnet-4-20250514", None, 100, 50) == 0

    def test_no_model_returns_zero(self):
        from openlit.instrumentation.claude_agent_sdk.utils import _calculate_cost

        assert _calculate_cost(None, {"some": "info"}, 100, 50) == 0


# ===========================================================================
# Event Emission
# ===========================================================================
class TestEmitChatInferenceEvent:
    def test_emits_event(self):
        from openlit.instrumentation.claude_agent_sdk.utils import (
            _emit_chat_inference_event,
        )

        event_provider = MagicMock()
        _emit_chat_inference_event(
            event_provider,
            "claude-sonnet-4-20250514",
            "msg_001",
            "sess_001",
            "stop",
            {SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS: 100},
            [{"role": "user", "parts": [{"type": "text", "content": "Hi"}]}],
            [{"role": "assistant", "parts": [{"type": "text", "content": "Hello!"}]}],
        )
        event_provider.emit.assert_called_once()

    def test_no_event_when_provider_is_none(self):
        from openlit.instrumentation.claude_agent_sdk.utils import (
            _emit_chat_inference_event,
        )

        _emit_chat_inference_event(None, "model", "id", "sess", "stop", {}, None, None)


# ===========================================================================
# ToolSpanTracker
# ===========================================================================
class TestToolSpanTracker:
    def _make_tracker(self):
        from openlit.instrumentation.claude_agent_sdk.claude_agent_sdk import (
            _ToolSpanTracker,
        )

        tracer = MagicMock()
        tracer.start_span.return_value = MagicMock()
        parent_span = MagicMock()
        return _ToolSpanTracker(
            tracer,
            parent_span,
            "0.1.0",
            "test",
            "test_app",
            capture_message_content=True,
        )

    def test_start_and_end_tool(self):
        tracker = self._make_tracker()
        tracker.start_tool("Bash", {"command": "ls"}, "toolu_001")
        assert "toolu_001" in tracker._in_flight

        tracker.end_tool("toolu_001", "file1.txt")
        assert "toolu_001" not in tracker._in_flight
        assert "toolu_001" in tracker._completed

    def test_end_tool_error(self):
        tracker = self._make_tracker()
        tracker.start_tool("Bash", {}, "toolu_err")
        tracker.end_tool_error("toolu_err", "command failed")

        assert "toolu_err" not in tracker._in_flight
        assert "toolu_err" in tracker._completed

    def test_end_all_cleans_up(self):
        tracker = self._make_tracker()
        tracker.start_tool("Bash", {}, "toolu_a")
        tracker.start_tool("Read", {}, "toolu_b")

        tracker.end_all()
        assert len(tracker._in_flight) == 0

    def test_end_nonexistent_is_safe(self):
        tracker = self._make_tracker()
        tracker.end_tool("nonexistent_id", "result")

    def test_completed_prevents_duplicate(self):
        tracker = self._make_tracker()
        tracker.start_tool("Bash", {}, "toolu_dedup")
        tracker.end_tool("toolu_dedup", "result")

        assert "toolu_dedup" in tracker._completed
        assert "toolu_dedup" not in tracker._in_flight


# ===========================================================================
# SubagentSpanTracker
# ===========================================================================
class TestSubagentSpanTracker:
    def _make_tracker(self):
        from openlit.instrumentation.claude_agent_sdk.claude_agent_sdk import (
            _SubagentSpanTracker,
            _ToolSpanTracker,
        )

        tracer = MagicMock()
        tracer.start_span.return_value = MagicMock()
        parent_span = MagicMock()
        tool_tracker = _ToolSpanTracker(
            tracer,
            parent_span,
            "0.1.0",
            "test",
            "test_app",
            True,
        )
        return _SubagentSpanTracker(
            tracer,
            tool_tracker,
            "0.1.0",
            "test",
            "test_app",
        )

    def test_start_and_end_subagent(self):
        tracker = self._make_tracker()
        tracker.start_subagent("task_001", "search_agent")
        assert "task_001" in tracker._in_flight

        tracker.end_subagent("task_001")
        assert "task_001" not in tracker._in_flight

    def test_start_with_tool_use_id_mapping(self):
        tracker = self._make_tracker()
        tracker.start_subagent("task_001", "agent", tool_use_id="toolu_sub")
        assert tracker._tool_use_to_task["toolu_sub"] == "task_001"

    def test_get_span_for_tool_use_id(self):
        tracker = self._make_tracker()
        tracker.start_subagent("task_001", "agent", tool_use_id="toolu_sub")

        span = tracker.get_span_for_tool_use_id("toolu_sub")
        assert span is not None

    def test_get_span_for_unknown_tool_use_id(self):
        tracker = self._make_tracker()
        assert tracker.get_span_for_tool_use_id("unknown") is None

    def test_end_subagent_with_usage(self):
        tracker = self._make_tracker()
        tracker.start_subagent("task_002", "agent")

        usage = {"total_tokens": 1000, "tool_uses": 3, "duration_ms": 5000}
        tracker.end_subagent("task_002", usage=usage)

        assert "task_002" not in tracker._in_flight

    def test_end_subagent_with_error(self):
        tracker = self._make_tracker()
        tracker.start_subagent("task_err", "agent")
        tracker.end_subagent("task_err", is_error=True, error_message="task failed")
        assert "task_err" not in tracker._in_flight

    def test_end_all_cleans_up(self):
        tracker = self._make_tracker()
        tracker.start_subagent("t1", "a1")
        tracker.start_subagent("t2", "a2")
        tracker.end_all()
        assert len(tracker._in_flight) == 0

    def test_subagent_span_has_gen_ai_system(self):
        tracker = self._make_tracker()
        tracker.start_subagent("task_sys", "agent")
        span = tracker._in_flight["task_sys"]
        span.set_attribute.assert_any_call(GEN_AI_SYSTEM_ATTR, "anthropic")


# ===========================================================================
# Deferred Chat Span (buffer / flush)
# ===========================================================================
class TestBufferChatMessage:
    """Tests for _buffer_chat_message — deferred chat span buffering."""

    def _call(self, message, chat_state=None):
        from openlit.instrumentation.claude_agent_sdk.claude_agent_sdk import (
            _buffer_chat_message,
        )

        if chat_state is None:
            chat_state = {"last_boundary_ns": 1_000_000}
        _buffer_chat_message(message, chat_state)
        return chat_state

    def test_buffers_message_with_llm_call_data(self):
        msg = _make_assistant_message(
            usage=_make_usage(), content=[_make_text_block("Hi")]
        )
        state = self._call(msg)
        assert state["pending_chat_msg"] is msg
        assert state["pending_chat_msg_id"] == "msg_001"
        assert "pending_end_ns" in state

    def test_replaces_on_same_message_id(self):
        msg1 = _make_assistant_message(
            usage=_make_usage(),
            content=[_make_text_block("Sure!")],
            message_id="msg_X",
        )
        msg2 = _make_assistant_message(
            usage=_make_usage(),
            content=[_make_tool_use_block("Bash", {"command": "ls"}, "toolu_001")],
            message_id="msg_X",
        )
        state = {"last_boundary_ns": 1_000_000}
        self._call(msg1, state)
        assert state["pending_chat_msg"] is msg1

        self._call(msg2, state)
        assert state["pending_chat_msg"] is msg2

    def test_skips_message_without_llm_call_data(self):
        msg = _make_assistant_message(usage=None)
        state = {"last_boundary_ns": 1_000_000}
        self._call(msg, state)
        assert "pending_chat_msg" not in state


class TestFlushPendingChat:
    """Tests for _flush_pending_chat — creates a chat span from the buffer."""

    def _flush(self, chat_state, **overrides):
        from openlit.instrumentation.claude_agent_sdk.claude_agent_sdk import (
            _flush_pending_chat,
        )

        tracer = overrides.pop("tracer", MagicMock())
        span = MagicMock()
        tracer.start_span.return_value = span

        _flush_pending_chat(
            tracer=tracer,
            parent_span=overrides.pop("parent_span", MagicMock()),
            chat_state=chat_state,
            capture_message_content=overrides.pop("capture_message_content", True),
            version=overrides.pop("version", "0.1.0"),
            environment=overrides.pop("environment", "test"),
            application_name=overrides.pop("application_name", "test_app"),
            pricing_info=overrides.pop("pricing_info", None),
            event_provider=overrides.pop("event_provider", None),
            subagent_tracker=overrides.pop("subagent_tracker", None),
        )
        return tracer, span

    def test_creates_span_when_buffer_present(self):
        msg = _make_assistant_message(
            usage=_make_usage(),
            content=[_make_text_block("Hello")],
        )
        state = {
            "last_boundary_ns": 1_000_000,
            "pending_chat_msg": msg,
            "pending_chat_msg_id": "msg_001",
            "pending_end_ns": 2_000_000,
        }
        tracer, span = self._flush(state)

        tracer.start_span.assert_called_once()
        call_kwargs = tracer.start_span.call_args
        assert "chat" in call_kwargs[0][0]
        assert call_kwargs[1]["start_time"] == 1_000_000

        span.end.assert_called_once_with(end_time=2_000_000)

    def test_clears_buffer_after_flush(self):
        msg = _make_assistant_message(
            usage=_make_usage(), content=[_make_text_block("Hi")]
        )
        state = {
            "last_boundary_ns": 1_000_000,
            "pending_chat_msg": msg,
            "pending_chat_msg_id": "msg_001",
            "pending_end_ns": 2_000_000,
        }
        self._flush(state)

        assert "pending_chat_msg" not in state
        assert "pending_chat_msg_id" not in state
        assert "pending_end_ns" not in state

    def test_updates_last_boundary_ns(self):
        msg = _make_assistant_message(
            usage=_make_usage(), content=[_make_text_block("Hi")]
        )
        state = {
            "last_boundary_ns": 1_000_000,
            "pending_chat_msg": msg,
            "pending_chat_msg_id": "msg_001",
            "pending_end_ns": 5_000_000,
        }
        self._flush(state)
        assert state["last_boundary_ns"] == 5_000_000

    def test_noop_when_no_buffer(self):
        state = {"last_boundary_ns": 1_000_000}
        tracer, _ = self._flush(state)
        tracer.start_span.assert_not_called()

    def test_consumes_pending_input(self):
        msg = _make_assistant_message(
            usage=_make_usage(), content=[_make_text_block("Hi")]
        )
        pending_input = [
            {"role": "user", "parts": [{"type": "text", "content": "Hello"}]}
        ]
        state = {
            "last_boundary_ns": 1_000_000,
            "pending_chat_msg": msg,
            "pending_chat_msg_id": "msg_001",
            "pending_end_ns": 2_000_000,
            "pending_input": pending_input,
        }
        self._flush(state)
        assert "pending_input" not in state


class TestProcessMessageFlushTriggers:
    """Tests that _process_message triggers flush at the right boundaries."""

    def _make_deps(self):
        from openlit.instrumentation.claude_agent_sdk.claude_agent_sdk import (
            _ToolSpanTracker,
            _SubagentSpanTracker,
        )

        tracer = MagicMock()
        tracer.start_span.return_value = MagicMock()
        parent_span = MagicMock()
        tool_tracker = _ToolSpanTracker(
            tracer,
            parent_span,
            "0.1.0",
            "test",
            "test_app",
            True,
        )
        subagent_tracker = _SubagentSpanTracker(
            tracer,
            tool_tracker,
            "0.1.0",
            "test",
            "test_app",
        )
        return tracer, parent_span, tool_tracker, subagent_tracker

    def _process(self, message, chat_state=None):
        from openlit.instrumentation.claude_agent_sdk.claude_agent_sdk import (
            _process_message,
        )

        tracer, parent_span, tool_tracker, subagent_tracker = self._make_deps()
        if chat_state is None:
            chat_state = {"last_boundary_ns": 1_000_000}
        result = _process_message(
            message,
            parent_span,
            tool_tracker,
            subagent_tracker,
            capture_message_content=True,
            tracer=tracer,
            chat_state=chat_state,
            version="0.1.0",
            environment="test",
            application_name="test_app",
        )
        return tracer, chat_state, result

    def test_assistant_message_buffers_not_flushes(self):
        msg = _make_assistant_message(
            usage=_make_usage(),
            content=[_make_text_block("Hello")],
        )
        tracer, state, _ = self._process(msg)
        assert "pending_chat_msg" in state
        assert tracer.start_span.call_count == 0

    def test_user_message_flushes_pending_chat(self):
        buffered_msg = _make_assistant_message(
            usage=_make_usage(),
            content=[_make_text_block("Planning...")],
            message_id="msg_A",
        )
        state = {
            "last_boundary_ns": 1_000_000,
            "pending_chat_msg": buffered_msg,
            "pending_chat_msg_id": "msg_A",
            "pending_end_ns": 2_000_000,
        }
        user_msg = _make_user_message(
            content=[
                _make_tool_result_block("toolu_001", "result_data"),
            ]
        )
        tracer, state, _ = self._process(user_msg, chat_state=state)
        tracer.start_span.assert_called_once()
        assert "pending_chat_msg" not in state

    def test_result_message_flushes_pending_chat(self):
        buffered_msg = _make_assistant_message(
            usage=_make_usage(),
            content=[_make_text_block("Summary")],
            message_id="msg_B",
        )
        state = {
            "last_boundary_ns": 1_000_000,
            "pending_chat_msg": buffered_msg,
            "pending_chat_msg_id": "msg_B",
            "pending_end_ns": 3_000_000,
        }
        result_msg = _make_result_message()
        tracer, state, _ = self._process(result_msg, chat_state=state)
        tracer.start_span.assert_called_once()

    def test_different_message_id_flushes_previous(self):
        msg1 = _make_assistant_message(
            usage=_make_usage(),
            content=[_make_text_block("First")],
            message_id="msg_1",
        )
        state = {
            "last_boundary_ns": 1_000_000,
            "pending_chat_msg": msg1,
            "pending_chat_msg_id": "msg_1",
            "pending_end_ns": 2_000_000,
        }
        msg2 = _make_assistant_message(
            usage=_make_usage(),
            content=[_make_text_block("Second")],
            message_id="msg_2",
        )
        tracer, state, _ = self._process(msg2, chat_state=state)
        tracer.start_span.assert_called_once()
        assert state["pending_chat_msg"] is msg2
        assert state["pending_chat_msg_id"] == "msg_2"

    def test_same_message_id_replaces_buffer(self):
        msg1 = _make_assistant_message(
            usage=_make_usage(),
            content=[_make_text_block("Text only")],
            message_id="msg_same",
        )
        state = {
            "last_boundary_ns": 1_000_000,
            "pending_chat_msg": msg1,
            "pending_chat_msg_id": "msg_same",
            "pending_end_ns": 2_000_000,
        }
        msg2 = _make_assistant_message(
            usage=_make_usage(),
            content=[_make_tool_use_block("Bash", {"command": "ls"}, "toolu_X")],
            message_id="msg_same",
        )
        tracer, state, _ = self._process(msg2, chat_state=state)
        tracer.start_span.assert_not_called()
        assert state["pending_chat_msg"] is msg2


# ===========================================================================
# Instrumentor Imports
# ===========================================================================
class TestInstrumentorImport:
    def test_import_instrumentor(self):
        from openlit.instrumentation.claude_agent_sdk import ClaudeAgentSDKInstrumentor

        assert ClaudeAgentSDKInstrumentor is not None

    def test_import_utils(self):
        from openlit.instrumentation.claude_agent_sdk import utils

        assert hasattr(utils, "OPERATION_MAP")
        assert hasattr(utils, "extract_usage")
        assert hasattr(utils, "set_chat_span_attributes")
        assert hasattr(utils, "set_tool_span_attributes")

    def test_import_wrapper_functions(self):
        from openlit.instrumentation.claude_agent_sdk.claude_agent_sdk import (
            wrap_query,
            wrap_connect,
            wrap_client_query,
            wrap_receive_response,
        )

        assert wrap_query is not None
        assert wrap_connect is not None
        assert wrap_client_query is not None
        assert wrap_receive_response is not None


# ===========================================================================
# Input Message Schema (tool_call_response)
# ===========================================================================
class TestInputMessageSchema:
    def test_tool_result_follows_otel_schema(self):
        msg = _make_user_message(
            content=[
                _make_tool_result_block("toolu_001", "file1.txt\nfile2.txt"),
            ]
        )
        result = build_input_from_tool_results(msg)

        assert result[0]["role"] == "user"
        part = result[0]["parts"][0]
        assert part["type"] == "tool_call_response"
        assert part["id"] == "toolu_001"
        assert "file1.txt" in part["response"]

    def test_multiple_tool_results(self):
        msg = _make_user_message(
            content=[
                _make_tool_result_block("toolu_a", "res_a"),
                _make_tool_result_block("toolu_b", "res_b"),
            ]
        )
        result = build_input_from_tool_results(msg)
        parts = result[0]["parts"]

        assert len(parts) == 2
        assert parts[0]["id"] == "toolu_a"
        assert parts[1]["id"] == "toolu_b"


# ===========================================================================
# Metrics Recording Detail
# ===========================================================================
class TestRecordMetrics:
    def test_token_usage_has_type_dimension(self):
        from openlit.instrumentation.claude_agent_sdk.utils import _record_metrics

        metrics = {
            "genai_client_operation_duration": MagicMock(),
            "genai_client_usage_tokens": MagicMock(),
        }
        _record_metrics(
            metrics,
            SemanticConvention.GEN_AI_OPERATION_TYPE_AGENT,
            1.5,
            "test",
            "test_app",
            input_tokens=500,
            output_tokens=200,
        )

        token_calls = metrics["genai_client_usage_tokens"].record.call_args_list
        assert len(token_calls) == 2

        input_call_attrs = token_calls[0][0][1]
        assert (
            input_call_attrs[SemanticConvention.GEN_AI_TOKEN_TYPE]
            == SemanticConvention.GEN_AI_TOKEN_TYPE_INPUT
        )

        output_call_attrs = token_calls[1][0][1]
        assert (
            output_call_attrs[SemanticConvention.GEN_AI_TOKEN_TYPE]
            == SemanticConvention.GEN_AI_TOKEN_TYPE_OUTPUT
        )

    def test_metrics_include_gen_ai_system(self):
        from openlit.instrumentation.claude_agent_sdk.utils import _record_metrics

        metrics = {"genai_client_operation_duration": MagicMock()}
        _record_metrics(
            metrics,
            SemanticConvention.GEN_AI_OPERATION_TYPE_AGENT,
            1.0,
            "test",
            "test_app",
        )

        call_attrs = metrics["genai_client_operation_duration"].record.call_args[0][1]
        assert call_attrs[GEN_AI_SYSTEM_ATTR] == "anthropic"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
