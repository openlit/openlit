# pylint: disable=duplicate-code, no-member, too-few-public-methods, missing-class-docstring, missing-function-docstring
"""
Tests for Google ADK instrumentation using the google-adk Python library.

Tests cover:
- Instrumentor import and basic instantiation
- Utils: OPERATION_MAP, SPAN_KIND_MAP, generate_span_name, _PassthroughTracer
- Agent creation registry
- Server address resolution
- Token extraction
- LLM span enrichment
- Tool span enrichment

Note: These tests do NOT require google-adk to be installed -- they mock
all ADK internals so the test suite can run in any environment.
"""

import json
from unittest.mock import MagicMock, patch

import pytest

from openlit.instrumentation.google_adk.utils import (
    OPERATION_MAP,
    SPAN_KIND_MAP,
    _ADK_WORKFLOW_ACTIVE,
    _detect_provider_from_model_str,
    _determine_output_type,
    generate_span_name,
    get_operation_type,
    resolve_server_info,
    extract_model_name,
    extract_token_usage,
    enrich_llm_span,
    enrich_tool_span,
    enrich_merged_tool_span,
    _PassthroughTracer,
    _resolve_model_string,
    _extract_from_event,
    _is_adk_event,
    record_google_adk_metrics,
)

from openlit.semcov import SemanticConvention


class TestOperationMap:
    """Tests for OPERATION_MAP and SPAN_KIND_MAP completeness."""

    def test_operation_map_has_required_endpoints(self):
        required = [
            "agent_init",
            "runner_run_async",
            "runner_run",
            "runner_run_live",
            "agent_run_async",
        ]
        for key in required:
            assert key in OPERATION_MAP, f"Missing endpoint: {key}"

    def test_span_kind_map_has_required_operations(self):
        required = [
            SemanticConvention.GEN_AI_OPERATION_TYPE_CREATE_AGENT,
            SemanticConvention.GEN_AI_OPERATION_TYPE_FRAMEWORK,
            SemanticConvention.GEN_AI_OPERATION_TYPE_AGENT,
            SemanticConvention.GEN_AI_OPERATION_TYPE_TOOLS,
            SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
        ]
        for key in required:
            assert key in SPAN_KIND_MAP, f"Missing span kind: {key}"

    def test_get_operation_type_defaults(self):
        assert get_operation_type("agent_init") == SemanticConvention.GEN_AI_OPERATION_TYPE_CREATE_AGENT
        assert get_operation_type("unknown_key") == SemanticConvention.GEN_AI_OPERATION_TYPE_AGENT

    def test_runner_endpoints_map_to_invoke_agent(self):
        for key in ("runner_run_async", "runner_run", "runner_run_live"):
            assert OPERATION_MAP[key] == SemanticConvention.GEN_AI_OPERATION_TYPE_AGENT


class TestSpanNameGeneration:
    """Tests for generate_span_name."""

    def test_agent_init_span_name(self):
        instance = MagicMock()
        instance.name = "my_agent"
        assert generate_span_name("agent_init", instance) == "create_agent my_agent"

    def test_runner_run_async_span_name(self):
        instance = MagicMock()
        instance.app_name = "my_app"
        assert generate_span_name("runner_run_async", instance) == "invoke_agent my_app"

    def test_runner_run_span_name(self):
        instance = MagicMock()
        instance.app_name = "sync_app"
        assert generate_span_name("runner_run", instance) == "invoke_agent sync_app"

    def test_agent_run_async_span_name(self):
        instance = MagicMock()
        instance.name = "sub_agent"
        assert generate_span_name("agent_run_async", instance) == "invoke_agent sub_agent"

    def test_fallback_app_name(self):
        instance = MagicMock(spec=[])
        name = generate_span_name("runner_run_async", instance)
        assert "invoke_agent" in name

    def test_fallback_agent_name(self):
        instance = MagicMock(spec=[])
        name = generate_span_name("agent_run_async", instance)
        assert "invoke_agent" in name


class TestPassthroughTracer:
    """Tests for _PassthroughTracer."""

    def test_passthrough_yields_current_span(self):
        mock_tracer = MagicMock()
        passthrough = _PassthroughTracer(mock_tracer)

        mock_span = MagicMock()
        with patch("opentelemetry.trace.get_current_span", return_value=mock_span):
            with passthrough.start_as_current_span("test") as span:
                assert span is mock_span

    def test_passthrough_does_not_call_original(self):
        mock_tracer = MagicMock()
        passthrough = _PassthroughTracer(mock_tracer)

        with patch("opentelemetry.trace.get_current_span"):
            with passthrough.start_as_current_span("test"):
                pass

        mock_tracer.start_as_current_span.assert_not_called()


class TestServerAddressResolution:
    """Tests for resolve_server_info."""

    def test_default_gemini(self):
        with patch.dict("os.environ", {}, clear=True):
            addr, port, provider = resolve_server_info()
            assert addr == "generativelanguage.googleapis.com"
            assert port == 443
            assert provider == "gcp.gemini"

    def test_vertex_ai(self):
        with patch.dict("os.environ", {"GOOGLE_GENAI_USE_VERTEXAI": "true"}):
            addr, port, provider = resolve_server_info()
            assert addr == "aiplatform.googleapis.com"
            assert port == 443
            assert provider == "gcp.vertex_ai"

    def test_vertex_ai_numeric(self):
        with patch.dict("os.environ", {"GOOGLE_GENAI_USE_VERTEXAI": "1"}):
            _, _, provider = resolve_server_info()
            assert provider == "gcp.vertex_ai"


class TestResolveModelString:
    """Tests for _resolve_model_string."""

    def test_string_passthrough(self):
        assert _resolve_model_string("gemini-2.0-flash") == "gemini-2.0-flash"

    def test_model_name_attribute(self):
        obj = MagicMock(spec=["model_name"])
        obj.model_name = "gemini-pro"
        assert _resolve_model_string(obj) == "gemini-pro"

    def test_pydantic_style_model_field(self):
        """LiteLlm inherits ``model: str`` from BaseLlm(BaseModel)."""
        obj = MagicMock(spec=["model"])
        obj.model = "anthropic/claude-sonnet-4-20250514"
        assert _resolve_model_string(obj) == "anthropic/claude-sonnet-4-20250514"

    def test_non_string_model_field_returns_none(self):
        obj = MagicMock(spec=["model"])
        obj.model = 12345
        assert _resolve_model_string(obj) is None

    def test_no_attributes_returns_none(self):
        obj = MagicMock(spec=[])
        assert _resolve_model_string(obj) is None


class TestModelExtraction:
    """Tests for extract_model_name."""

    def test_string_model(self):
        instance = MagicMock()
        instance.model = "gemini-2.0-flash"
        assert extract_model_name(instance) == "gemini-2.0-flash"

    def test_object_model_with_model_name(self):
        instance = MagicMock()
        instance.model = MagicMock()
        instance.model.model_name = "gemini-pro"
        assert extract_model_name(instance) == "gemini-pro"

    def test_pydantic_model_object(self):
        """Simulates LiteLlm where .model is a str field on a non-string object."""
        litellm_obj = MagicMock(spec=["model"])
        litellm_obj.model = "anthropic/claude-sonnet-4-20250514"

        instance = MagicMock()
        instance.model = litellm_obj
        del instance.model.model_name
        assert extract_model_name(instance) == "anthropic/claude-sonnet-4-20250514"

    def test_agent_attribute_fallback(self):
        instance = MagicMock(spec=[])
        instance.agent = MagicMock()
        instance.agent.model = "gemini-1.5-pro"
        assert extract_model_name(instance) == "gemini-1.5-pro"

    def test_unknown_fallback(self):
        instance = MagicMock(spec=[])
        assert extract_model_name(instance) == "unknown"


class TestTokenExtraction:
    """Tests for extract_token_usage."""

    def test_full_usage(self):
        response = MagicMock()
        response.usage_metadata.prompt_token_count = 100
        response.usage_metadata.candidates_token_count = 50
        response.usage_metadata.thoughts_token_count = 10
        response.usage_metadata.cached_content_token_count = 5
        response.usage_metadata.total_token_count = 165

        inp, out, reasoning, cached, total = extract_token_usage(response)
        assert inp == 100
        assert out == 50
        assert reasoning == 10
        assert cached == 5
        assert total == 165

    def test_no_usage(self):
        response = MagicMock()
        response.usage_metadata = None
        inp, out, reasoning, cached, total = extract_token_usage(response)
        assert inp is None
        assert out is None
        assert reasoning is None
        assert cached is None
        assert total is None

    def test_partial_usage(self):
        response = MagicMock()
        response.usage_metadata.prompt_token_count = 42
        response.usage_metadata.candidates_token_count = None
        response.usage_metadata.thoughts_token_count = None
        response.usage_metadata.cached_content_token_count = None
        response.usage_metadata.total_token_count = 42

        inp, out, reasoning, cached, total = extract_token_usage(response)
        assert inp == 42
        assert out is None
        assert reasoning is None
        assert cached is None
        assert total == 42

    def test_reasoning_separate_from_output(self):
        response = MagicMock()
        response.usage_metadata.prompt_token_count = 100
        response.usage_metadata.candidates_token_count = 50
        response.usage_metadata.thoughts_token_count = 25
        response.usage_metadata.cached_content_token_count = None
        response.usage_metadata.total_token_count = 175

        _, out, reasoning, _, _ = extract_token_usage(response)
        assert out == 50
        assert reasoning == 25


class TestLLMSpanEnrichment:
    """Tests for enrich_llm_span."""

    def test_basic_enrichment(self):
        span = MagicMock()
        llm_request = MagicMock()
        llm_request.model = "gemini-2.0-flash"
        llm_request.config = MagicMock()
        llm_request.config.temperature = 0.7
        llm_request.config.top_p = 0.9
        llm_request.config.max_output_tokens = 1024
        llm_request.config.system_instruction = None
        llm_request.contents = []

        llm_response = MagicMock()
        llm_response.usage_metadata.prompt_token_count = 100
        llm_response.usage_metadata.candidates_token_count = 50
        llm_response.usage_metadata.thoughts_token_count = None
        llm_response.usage_metadata.cached_content_token_count = None
        llm_response.usage_metadata.total_token_count = 150
        llm_response.model_version = "gemini-2.0-flash-001"
        llm_response.finish_reason = MagicMock()
        llm_response.finish_reason.value = "STOP"
        llm_response.error_code = None
        llm_response.content = MagicMock()
        llm_response.content.parts = []

        enrich_llm_span(span, llm_request, llm_response, capture_message_content=False)

        span.set_attribute.assert_any_call(
            SemanticConvention.GEN_AI_REQUEST_MODEL, "gemini-2.0-flash"
        )
        span.set_attribute.assert_any_call(
            SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS, 100
        )
        span.set_attribute.assert_any_call(
            SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS, 50
        )
        span.set_attribute.assert_any_call(
            SemanticConvention.GEN_AI_RESPONSE_MODEL, "gemini-2.0-flash-001"
        )
        span.set_attribute.assert_any_call(
            SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON, ["stop"]
        )
        span.set_attribute.assert_any_call(
            SemanticConvention.GEN_AI_USAGE_TOTAL_TOKENS, 150
        )

    def test_enrichment_with_none_request(self):
        span = MagicMock()
        enrich_llm_span(span, None, None, capture_message_content=False)
        span.set_attribute.assert_any_call(
            SemanticConvention.GEN_AI_OPERATION,
            SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
        )


def _make_adk_event(response_dict=None, tool_call_id=None):
    """Build a mock ADK Event with function_response content."""
    fn_resp = MagicMock()
    fn_resp.response = response_dict
    fn_resp.id = tool_call_id
    fn_resp.name = "test_tool"

    part = MagicMock()
    part.function_response = fn_resp

    content = MagicMock()
    content.parts = [part]

    event = MagicMock()
    event.content = content
    type(event).__qualname__ = "Event"
    return event


class TestADKEventExtraction:
    """Tests for _is_adk_event and _extract_from_event."""

    def test_is_adk_event_true(self):
        event = _make_adk_event({"result": "ok"}, "call_123")
        assert _is_adk_event(event) is True

    def test_is_adk_event_false_for_dict(self):
        assert _is_adk_event({"key": "val"}) is False

    def test_extract_response_and_id(self):
        event = _make_adk_event({"status": "success", "data": 42}, "call_xyz")
        resp, call_id = _extract_from_event(event)
        assert resp == {"status": "success", "data": 42}
        assert call_id == "call_xyz"

    def test_extract_from_none_event(self):
        resp, call_id = _extract_from_event(None)
        assert resp is None
        assert call_id is None

    def test_extract_from_event_without_content(self):
        event = MagicMock(spec=[])
        resp, call_id = _extract_from_event(event)
        assert resp is None
        assert call_id is None


class TestToolSpanEnrichment:
    """Tests for enrich_tool_span."""

    def test_basic_tool_enrichment_with_dict(self):
        span = MagicMock()
        tool = MagicMock()
        tool.name = "web_search"
        tool.description = "Search the web"

        enrich_tool_span(
            span,
            tool,
            function_args={"query": "test"},
            function_response_event={"results": []},
            capture_message_content=True,
        )

        span.set_attribute.assert_any_call(
            SemanticConvention.GEN_AI_TOOL_NAME, "web_search"
        )
        span.set_attribute.assert_any_call(
            SemanticConvention.GEN_AI_TOOL_DESCRIPTION, "Search the web"
        )

    def test_enrichment_with_adk_event(self):
        """The function_response_event is an ADK Event, not a plain dict."""
        span = MagicMock()
        tool = MagicMock()
        tool.name = "get_weather"
        tool.description = "Get weather"

        event = _make_adk_event({"status": "success", "temp": 25}, "call_abc")

        enrich_tool_span(
            span,
            tool,
            function_args={"city": "NYC"},
            function_response_event=event,
            capture_message_content=True,
        )

        span.set_attribute.assert_any_call(
            SemanticConvention.GEN_AI_TOOL_NAME, "get_weather"
        )
        set_calls = {call[0][0]: call[0][1] for call in span.set_attribute.call_args_list}
        assert SemanticConvention.GEN_AI_TOOL_CALL_ID in set_calls
        assert set_calls[SemanticConvention.GEN_AI_TOOL_CALL_ID] == "call_abc"
        assert SemanticConvention.GEN_AI_TOOL_CALL_RESULT in set_calls
        result_json = json.loads(set_calls[SemanticConvention.GEN_AI_TOOL_CALL_RESULT])
        assert result_json["status"] == "success"

    def test_tool_without_capture(self):
        span = MagicMock()
        tool = MagicMock()
        tool.name = "calculator"
        tool.description = None

        enrich_tool_span(
            span,
            tool,
            function_args={"x": 1},
            function_response_event={"result": 2},
            capture_message_content=False,
        )

        span.set_attribute.assert_any_call(
            SemanticConvention.GEN_AI_TOOL_NAME, "calculator"
        )
        call_args_list = [call[0] for call in span.set_attribute.call_args_list]
        for call_args in call_args_list:
            assert call_args[0] != SemanticConvention.GEN_AI_TOOL_CALL_ARGUMENTS
            assert call_args[0] != SemanticConvention.GEN_AI_TOOL_CALL_RESULT

    def test_enrichment_with_none_event(self):
        span = MagicMock()
        tool = MagicMock()
        tool.name = "noop"
        tool.description = None

        enrich_tool_span(
            span, tool,
            function_args=None,
            function_response_event=None,
            capture_message_content=True,
        )
        span.set_attribute.assert_any_call(
            SemanticConvention.GEN_AI_TOOL_NAME, "noop"
        )


class TestMergedToolSpanEnrichment:
    """Tests for enrich_merged_tool_span."""

    def test_basic_merged_enrichment(self):
        span = MagicMock()

        fn_resp1 = MagicMock()
        fn_resp1.response = {"result": "sunny"}
        fn_resp1.name = "get_weather"
        fn_resp2 = MagicMock()
        fn_resp2.response = {"result": "42"}
        fn_resp2.name = "calculate"

        part1 = MagicMock()
        part1.function_response = fn_resp1
        part2 = MagicMock()
        part2.function_response = fn_resp2

        event = MagicMock()
        event.content = MagicMock()
        event.content.parts = [part1, part2]

        enrich_merged_tool_span(span, "evt_123", event, capture_message_content=True)

        span.set_attribute.assert_any_call(
            SemanticConvention.GEN_AI_OPERATION,
            SemanticConvention.GEN_AI_OPERATION_TYPE_TOOLS,
        )
        span.set_attribute.assert_any_call(
            SemanticConvention.GEN_AI_TOOL_NAME, "(merged tools)"
        )
        span.set_attribute.assert_any_call(
            SemanticConvention.GEN_AI_TOOL_CALL_ID, "evt_123"
        )

        set_calls = {call[0][0]: call[0][1] for call in span.set_attribute.call_args_list}
        assert SemanticConvention.GEN_AI_TOOL_CALL_RESULT in set_calls
        result = json.loads(set_calls[SemanticConvention.GEN_AI_TOOL_CALL_RESULT])
        assert len(result) == 2
        assert result[0]["name"] == "get_weather"
        assert result[1]["name"] == "calculate"

    def test_merged_without_capture(self):
        span = MagicMock()
        enrich_merged_tool_span(span, "evt_1", MagicMock(), capture_message_content=False)
        set_calls = {call[0][0]: call[0][1] for call in span.set_attribute.call_args_list}
        assert SemanticConvention.GEN_AI_TOOL_CALL_RESULT not in set_calls


class TestAgentCreationRegistry:
    """Tests for _AgentCreationRegistry."""

    def test_register_and_get(self):
        from openlit.instrumentation.google_adk import _AgentCreationRegistry

        registry = _AgentCreationRegistry()
        mock_ctx = MagicMock()

        registry.register("test_agent", mock_ctx)
        assert registry.get("test_agent") is mock_ctx
        assert registry.get("unknown") is None

    def test_get_all(self):
        from openlit.instrumentation.google_adk import _AgentCreationRegistry

        registry = _AgentCreationRegistry()
        ctx1 = MagicMock()
        ctx2 = MagicMock()

        registry.register("agent1", ctx1)
        registry.register("agent2", ctx2)

        all_contexts = registry.get_all()
        assert len(all_contexts) == 2
        assert ctx1 in all_contexts
        assert ctx2 in all_contexts


class TestMetricsRecording:
    """Tests for record_google_adk_metrics."""

    def test_records_duration(self):
        metrics = {
            "genai_client_operation_duration": MagicMock()
        }
        record_google_adk_metrics(
            metrics,
            "invoke_workflow",
            1.5,
            "test",
            "my_app",
            "gemini-2.0-flash",
            "generativelanguage.googleapis.com",
            443,
        )
        metrics["genai_client_operation_duration"].record.assert_called_once()

    def test_skips_missing_metric(self):
        metrics = {}
        record_google_adk_metrics(
            metrics,
            "invoke_workflow",
            1.0,
            "test",
            "app",
            "unknown",
            "",
            0,
        )


class TestToolNameExtraction:
    """Tests for tool name extraction in _wrap_agent_init for raw callables."""

    def test_callable_name_via_dunder(self):
        """Raw Python functions have __name__, not .name."""
        def get_weather(city: str) -> dict:
            """Get weather for a city."""
            return {}

        t_name = getattr(get_weather, "name", None) or getattr(get_weather, "__name__", None) or type(get_weather).__name__
        assert t_name == "get_weather"

    def test_lambda_falls_back_to_lambda(self):
        def _anon(x):
            return x
        _anon.__name__ = "<lambda>"
        t_name = getattr(_anon, "name", None) or getattr(_anon, "__name__", None) or type(_anon).__name__
        assert t_name == "<lambda>"

    def test_basetool_style_name(self):
        """BaseTool subclasses have .name."""
        tool = MagicMock()
        tool.name = "my_tool"
        t_name = getattr(tool, "name", None) or getattr(tool, "__name__", None) or type(tool).__name__
        assert t_name == "my_tool"

    def test_docstring_as_description(self):
        """Raw callables use __doc__ as description fallback."""
        def calculate(expression: str) -> dict:
            """Evaluate a math expression."""
            return {}

        t_desc = getattr(calculate, "description", None) or getattr(calculate, "__doc__", None)
        assert "Evaluate a math expression" in t_desc


class TestInstrumentorImport:
    """Tests that the instrumentor module can be imported."""

    def test_import_instrumentor(self):
        from openlit.instrumentation.google_adk import GoogleADKInstrumentor
        assert GoogleADKInstrumentor is not None

    def test_import_utils(self):
        from openlit.instrumentation.google_adk import utils
        assert hasattr(utils, "OPERATION_MAP")
        assert hasattr(utils, "_PassthroughTracer")
        assert hasattr(utils, "enrich_llm_span")
        assert hasattr(utils, "enrich_tool_span")

    def test_import_async_wrappers(self):
        from openlit.instrumentation.google_adk.async_google_adk import (
            async_runner_wrap,
            async_agent_wrap,
        )
        assert async_runner_wrap is not None
        assert async_agent_wrap is not None

    def test_import_sync_wrappers(self):
        from openlit.instrumentation.google_adk.google_adk import sync_runner_wrap
        assert sync_runner_wrap is not None


class TestServerInfoNonGoogle:
    """Tests for resolve_server_info with non-Google backends."""

    def test_anthropic_model_detection(self):
        addr, _, provider = resolve_server_info(model_name="anthropic/claude-sonnet-4-20250514")
        assert addr == "api.anthropic.com"
        assert provider == "anthropic"

    def test_openai_model_detection(self):
        addr, _, provider = resolve_server_info(model_name="openai/gpt-4o")
        assert addr == "api.openai.com"
        assert provider == "openai"

    def test_gpt_prefix_detection(self):
        _, _, provider = resolve_server_info(model_name="gpt-4o-mini")
        assert provider == "openai"

    def test_mistral_detection(self):
        _, _, provider = resolve_server_info(model_name="mistral/mistral-large")
        assert provider == "mistral"

    def test_gemini_stays_default(self):
        with patch.dict("os.environ", {}, clear=True):
            addr, _, provider = resolve_server_info(model_name="gemini-2.0-flash")
            assert addr == "generativelanguage.googleapis.com"
            assert provider == "gcp.gemini"

    def test_instance_model_object_detection(self):
        instance = MagicMock()
        model_obj = MagicMock(spec=["model"])
        model_obj.model = "anthropic/claude-sonnet-4-20250514"
        instance.model = model_obj
        with patch.dict("os.environ", {}, clear=True):
            _, _, provider = resolve_server_info(instance=instance)
            assert provider == "anthropic"

    def test_detect_provider_from_model_str(self):
        assert _detect_provider_from_model_str("anthropic/claude-3") is not None
        assert _detect_provider_from_model_str("gemini-2.0-flash") is None
        assert _detect_provider_from_model_str(None) is None
        assert _detect_provider_from_model_str("") is None


class TestDetermineOutputType:
    """Tests for _determine_output_type."""

    def test_text_response(self):
        response = MagicMock()
        part = MagicMock()
        part.function_call = None
        response.content.parts = [part]
        assert _determine_output_type(response) == "text"

    def test_tool_call_response(self):
        response = MagicMock()
        part = MagicMock()
        part.function_call = MagicMock()
        response.content.parts = [part]
        assert _determine_output_type(response) == "tool_calls"

    def test_none_content(self):
        response = MagicMock()
        response.content = None
        assert _determine_output_type(response) == "text"


class TestWorkflowDedup:
    """Tests for _ADK_WORKFLOW_ACTIVE contextvar deduplication."""

    def test_default_is_false(self):
        assert _ADK_WORKFLOW_ACTIVE.get() is False

    def test_set_and_reset(self):
        tok = _ADK_WORKFLOW_ACTIVE.set(True)
        assert _ADK_WORKFLOW_ACTIVE.get() is True
        _ADK_WORKFLOW_ACTIVE.reset(tok)
        assert _ADK_WORKFLOW_ACTIVE.get() is False


class TestSemconvConstant:
    """Tests that the semantic convention constant exists."""

    def test_google_adk_system_constant(self):
        assert hasattr(SemanticConvention, "GEN_AI_SYSTEM_GOOGLE_ADK")
        assert SemanticConvention.GEN_AI_SYSTEM_GOOGLE_ADK == "google_adk"


class TestInputMessageSchema:
    """Tests that capture_input_messages produces the OTel parts-based schema."""

    def test_text_message(self):
        from openlit.instrumentation.google_adk.utils import capture_input_messages

        span = MagicMock()
        llm_request = MagicMock()
        content = MagicMock()
        content.role = "user"
        text_part = MagicMock()
        text_part.text = "Hello world"
        text_part.function_call = None
        text_part.function_response = None
        content.parts = [text_part]
        llm_request.contents = [content]

        capture_input_messages(span, llm_request, capture_message_content=True)

        call_args = span.set_attribute.call_args_list
        msg_call = [c for c in call_args if c[0][0] == SemanticConvention.GEN_AI_INPUT_MESSAGES]
        assert len(msg_call) == 1
        messages = json.loads(msg_call[0][0][1])
        assert messages[0]["role"] == "user"
        assert "parts" in messages[0]
        assert messages[0]["parts"][0]["type"] == "text"
        assert messages[0]["parts"][0]["content"] == "Hello world"
        assert "content" not in messages[0]

    def test_tool_call_message(self):
        from openlit.instrumentation.google_adk.utils import capture_input_messages

        span = MagicMock()
        llm_request = MagicMock()
        content = MagicMock()
        content.role = "assistant"
        fc = MagicMock()
        fc.name = "get_weather"
        fc.id = "call_1"
        fc.args = {"city": "NYC"}
        part = MagicMock()
        part.text = None
        part.function_call = fc
        part.function_response = None
        content.parts = [part]
        llm_request.contents = [content]

        capture_input_messages(span, llm_request, capture_message_content=True)

        call_args = span.set_attribute.call_args_list
        msg_call = [c for c in call_args if c[0][0] == SemanticConvention.GEN_AI_INPUT_MESSAGES]
        messages = json.loads(msg_call[0][0][1])
        tool_part = messages[0]["parts"][0]
        assert tool_part["type"] == "tool_call"
        assert tool_part["name"] == "get_weather"
        assert tool_part["id"] == "call_1"

    def test_tool_response_message(self):
        from openlit.instrumentation.google_adk.utils import capture_input_messages

        span = MagicMock()
        llm_request = MagicMock()
        content = MagicMock()
        content.role = "tool"
        fr = MagicMock()
        fr.name = "get_weather"
        fr.id = "call_1"
        fr.response = {"temp": 72}
        part = MagicMock()
        part.text = None
        part.function_call = None
        part.function_response = fr
        content.parts = [part]
        llm_request.contents = [content]

        capture_input_messages(span, llm_request, capture_message_content=True)

        call_args = span.set_attribute.call_args_list
        msg_call = [c for c in call_args if c[0][0] == SemanticConvention.GEN_AI_INPUT_MESSAGES]
        messages = json.loads(msg_call[0][0][1])
        resp_part = messages[0]["parts"][0]
        assert resp_part["type"] == "tool_call_response"
        assert resp_part["id"] == "call_1"


class TestOutputMessageSchema:
    """Tests that capture_output_messages produces the OTel parts-based schema."""

    def test_text_output_with_finish_reason(self):
        from openlit.instrumentation.google_adk.utils import capture_output_messages

        span = MagicMock()
        llm_response = MagicMock()
        text_part = MagicMock()
        text_part.text = "The weather is sunny."
        text_part.function_call = None
        text_part.function_response = None
        llm_response.content.parts = [text_part]

        capture_output_messages(span, llm_response, True, "stop")

        call_args = span.set_attribute.call_args_list
        msg_call = [c for c in call_args if c[0][0] == SemanticConvention.GEN_AI_OUTPUT_MESSAGES]
        assert len(msg_call) == 1
        messages = json.loads(msg_call[0][0][1])
        assert messages[0]["role"] == "assistant"
        assert messages[0]["finish_reason"] == "stop"
        assert "parts" in messages[0]
        assert messages[0]["parts"][0]["type"] == "text"
        assert "content" not in messages[0]

    def test_tool_call_output(self):
        from openlit.instrumentation.google_adk.utils import capture_output_messages

        span = MagicMock()
        llm_response = MagicMock()
        fc = MagicMock()
        fc.name = "calculate"
        fc.id = "call_2"
        fc.args = {"expr": "1+1"}
        part = MagicMock()
        part.text = None
        part.function_call = fc
        part.function_response = None
        llm_response.content.parts = [part]

        capture_output_messages(span, llm_response, True, "tool_calls")

        call_args = span.set_attribute.call_args_list
        msg_call = [c for c in call_args if c[0][0] == SemanticConvention.GEN_AI_OUTPUT_MESSAGES]
        messages = json.loads(msg_call[0][0][1])
        assert messages[0]["finish_reason"] == "tool_calls"
        assert messages[0]["parts"][0]["type"] == "tool_call"


class TestSystemInstructionsFormat:
    """Tests that gen_ai.system_instructions uses the JSON schema format."""

    def test_llm_span_system_instructions_format(self):
        span = MagicMock()
        llm_request = MagicMock()
        llm_request.model = "gemini-2.0-flash"
        llm_request.config = MagicMock()
        llm_request.config.temperature = None
        llm_request.config.top_p = None
        llm_request.config.max_output_tokens = None
        llm_request.config.system_instruction = "You are a helpful assistant."
        llm_request.contents = []

        llm_response = MagicMock()
        llm_response.usage_metadata = None
        llm_response.finish_reason = None
        llm_response.error_code = None
        llm_response.content = MagicMock()
        llm_response.content.parts = []
        llm_response.model_version = None
        llm_response.response_id = None
        llm_response.id = None

        enrich_llm_span(span, llm_request, llm_response, capture_message_content=True)

        calls = {c[0][0]: c[0][1] for c in span.set_attribute.call_args_list}
        sys_instr = calls.get(SemanticConvention.GEN_AI_SYSTEM_INSTRUCTIONS)
        assert sys_instr is not None
        parsed = json.loads(sys_instr)
        assert isinstance(parsed, list)
        assert parsed[0]["type"] == "text"
        assert parsed[0]["content"] == "You are a helpful assistant."


class TestToolSpanErrorHandling:
    """Tests that enrich_tool_span sets error.type when error is provided."""

    def test_error_sets_error_type_and_status(self):
        span = MagicMock()
        tool = MagicMock()
        tool.name = "failing_tool"
        tool.description = None

        error = ValueError("bad input")
        enrich_tool_span(
            span,
            tool,
            function_args={"x": 1},
            function_response_event=None,
            capture_message_content=False,
            error=error,
        )

        calls = {c[0][0]: c[0][1] for c in span.set_attribute.call_args_list}
        assert calls.get(SemanticConvention.ERROR_TYPE) == "ValueError"
        span.set_status.assert_called_once()

    def test_no_error_does_not_set_error_type(self):
        span = MagicMock()
        tool = MagicMock()
        tool.name = "ok_tool"
        tool.description = None

        enrich_tool_span(
            span,
            tool,
            function_args={},
            function_response_event=None,
            capture_message_content=False,
            error=None,
        )

        calls = {c[0][0]: c[0][1] for c in span.set_attribute.call_args_list}
        assert SemanticConvention.ERROR_TYPE not in calls
        span.set_status.assert_not_called()


class TestLLMSpanResponseId:
    """Tests that enrich_llm_span extracts gen_ai.response.id when available."""

    def test_response_id_extracted(self):
        span = MagicMock()
        llm_request = MagicMock()
        llm_request.model = "gemini-2.0-flash"
        llm_request.config = MagicMock()
        llm_request.config.temperature = None
        llm_request.config.top_p = None
        llm_request.config.max_output_tokens = None
        llm_request.config.system_instruction = None
        llm_request.contents = []

        llm_response = MagicMock()
        llm_response.usage_metadata = None
        llm_response.model_version = None
        llm_response.finish_reason = None
        llm_response.error_code = None
        llm_response.content = MagicMock()
        llm_response.content.parts = []
        llm_response.response_id = "resp_abc123"

        enrich_llm_span(span, llm_request, llm_response, capture_message_content=False)

        calls = {c[0][0]: c[0][1] for c in span.set_attribute.call_args_list}
        assert calls.get(SemanticConvention.GEN_AI_RESPONSE_ID) == "resp_abc123"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
