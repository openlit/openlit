# pylint: disable=missing-class-docstring, missing-function-docstring, too-few-public-methods
"""capture_message_content=False must suppress message content everywhere (#1763).

With capture off, spans must not record the question, tool-call arguments,
tool results or the answer: LangGraph node spans (gen_ai.input.messages /
gen_ai.output.messages via extract_llm_info_from_result), the graph span
(gen_ai.output.messages via _process_invoke_response) and LangChain chat
spans (gen_ai.tool.call.arguments via common_chat_logic). Tool names, call
ids, message counts and token usage still record.
"""

import time
from types import SimpleNamespace
from unittest.mock import MagicMock

from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import (
    InMemorySpanExporter,
)

from openlit._config import OpenlitConfig
from openlit.instrumentation.langchain.utils import common_chat_logic
from openlit.instrumentation.langgraph.utils import (
    _process_invoke_response,
    extract_llm_info_from_result,
)
from openlit.semcov import SemanticConvention

SECRET = "Jane Roe"


def _tracer_and_exporter():
    OpenlitConfig.reset_to_defaults()
    exporter = InMemorySpanExporter()
    tracer_provider = TracerProvider()
    tracer_provider.add_span_processor(SimpleSpanProcessor(exporter))
    return tracer_provider.get_tracer("test-capture-off"), exporter


def _metrics_dict():
    """MagicMock metric instruments mirroring openlit.otel.metrics.build_metrics()."""
    return {
        "genai_client_usage_tokens": MagicMock(),
        "genai_client_operation_duration": MagicMock(),
        "genai_client_time_to_first_chunk": MagicMock(),
        "genai_client_time_per_output_chunk": MagicMock(),
        "genai_server_tbt": MagicMock(),
        "genai_server_ttft": MagicMock(),
        "genai_server_request_duration": MagicMock(),
        "genai_cost": MagicMock(),
    }


def _message(content, role="assistant"):
    # Shaped like a langchain-core message: role drives get_message_role().
    return SimpleNamespace(
        content=content,
        role=role,
        response_metadata={},
        usage_metadata=None,
    )


class TestLangChainToolArguments:
    def _callback_scope(self, span, tools):
        """Mirrors the scope OpenLITCallbackHandler builds before common_chat_logic."""
        now = time.time()
        return SimpleNamespace(
            _span=span,
            _kwargs={},
            _model_parameters={},
            _start_time=now,
            _end_time=now,
            _server_address="api.openai.com",
            _server_port=443,
            _response_model="m",
            _response_id="chatcmpl_1",
            _llmresponse="The appointment is on Monday.",
            _finish_reason="tool_calls",
            _tools=tools,
            _input_tokens=3,
            _output_tokens=4,
            _cache_read_input_tokens=0,
            _cache_creation_input_tokens=0,
            _timestamps=[],
            _tbt=0,
            _ttft=0,
            _request_model="m",
            _input_messages_raw=None,
            _prompts=["When is my next appointment? I am Jane Roe."],
            _system_instructions=None,
            _tool_definitions=None,
            _provider="openai",
        )

    def _run(self, capture_message_content):
        tracer, exporter = _tracer_and_exporter()
        tools = [
            {
                "id": "call_1",
                "type": "function",
                "function": {"name": "find_patient", "arguments": '{"patient_id": "P-5521"}'},
            }
        ]
        with tracer.start_as_current_span("chat m") as span:
            common_chat_logic(
                self._callback_scope(span, tools),
                pricing_info={},
                environment="test-env",
                application_name="test-app",
                metrics=_metrics_dict(),
                capture_message_content=capture_message_content,
                disable_metrics=False,
                version="test-version",
                is_stream=False,
            )
        return exporter.get_finished_spans()[0].attributes

    def test_arguments_suppressed_when_capture_off(self):
        attrs = self._run(capture_message_content=False)

        assert SemanticConvention.GEN_AI_TOOL_CALL_ARGUMENTS not in attrs
        assert "P-5521" not in str(dict(attrs))
        # Tool names, call ids and token usage still record.
        assert attrs[SemanticConvention.GEN_AI_TOOL_NAME] == "find_patient"
        assert attrs[SemanticConvention.GEN_AI_TOOL_CALL_ID] == "call_1"
        assert attrs[SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS] == 3

    def test_arguments_recorded_when_capture_on(self):
        attrs = self._run(capture_message_content=True)

        assert "P-5521" in attrs[SemanticConvention.GEN_AI_TOOL_CALL_ARGUMENTS]


class TestLangGraphNodeExtract:
    def _run_extract(self, **kwargs):
        tracer, exporter = _tracer_and_exporter()
        state = {"messages": [_message(f"When is my next appointment? I am {SECRET}.", role="user")]}
        result = {"messages": [_message("The appointment is on Monday.")]}
        with tracer.start_as_current_span("invoke_agent agent") as span:
            extract_llm_info_from_result(span, state, result, **kwargs)
        return exporter.get_finished_spans()[0].attributes

    def test_node_span_records_no_content_when_capture_off(self):
        attrs = self._run_extract(set_input_messages=False, set_output_messages=False)

        assert SemanticConvention.GEN_AI_INPUT_MESSAGES not in attrs
        assert SemanticConvention.GEN_AI_OUTPUT_MESSAGES not in attrs
        assert SECRET not in str(dict(attrs))
        assert "Monday" not in str(dict(attrs))

    def test_node_span_records_content_by_default(self):
        attrs = self._run_extract()

        assert SECRET in attrs[SemanticConvention.GEN_AI_INPUT_MESSAGES]
        assert "Monday" in attrs[SemanticConvention.GEN_AI_OUTPUT_MESSAGES]


class TestLangGraphToolCallArguments:
    def _result_with_tool_call(self):
        tool_call = SimpleNamespace(
            name="find_patient", args={"patient_id": "P-5521"}, id="call_1"
        )
        return {
            "messages": [
                SimpleNamespace(
                    content="",
                    role="assistant",
                    response_metadata={},
                    usage_metadata=None,
                    tool_calls=[tool_call],
                )
            ]
        }

    def _run_extract(self, **kwargs):
        tracer, exporter = _tracer_and_exporter()
        with tracer.start_as_current_span("invoke_agent agent") as span:
            extract_llm_info_from_result(
                span, {}, self._result_with_tool_call(), **kwargs
            )
        return exporter.get_finished_spans()[0].attributes

    def test_tool_arguments_suppressed_when_capture_off(self):
        attrs = self._run_extract(set_tool_call_arguments=False)

        assert "gen_ai.tool_call.0.arguments" not in attrs
        assert "P-5521" not in str(dict(attrs))
        # Tool names and call ids still record.
        assert attrs["gen_ai.tool_call.0.name"] == "find_patient"
        assert attrs["gen_ai.tool_call.0.id"] == "call_1"

    def test_tool_arguments_recorded_when_capture_on(self):
        attrs = self._run_extract()

        assert "P-5521" in attrs["gen_ai.tool_call.0.arguments"]


class TestLangGraphInvokeResponse:
    def _run(self, capture_message_content):
        tracer, exporter = _tracer_and_exporter()
        response = {"messages": [_message("The appointment is on Monday.")]}
        with tracer.start_as_current_span("invoke_workflow LangGraph") as span:
            _process_invoke_response(span, response, capture_message_content)
        return exporter.get_finished_spans()[0].attributes

    def test_graph_span_records_no_answer_when_capture_off(self):
        attrs = self._run(capture_message_content=False)

        assert SemanticConvention.GEN_AI_OUTPUT_MESSAGES not in attrs
        assert "Monday" not in str(dict(attrs))
        # The message count still records.
        assert attrs[SemanticConvention.GEN_AI_GRAPH_MESSAGE_COUNT] == 1

    def test_graph_span_records_answer_when_capture_on(self):
        attrs = self._run(capture_message_content=True)

        assert "Monday" in attrs[SemanticConvention.GEN_AI_OUTPUT_MESSAGES]

    def test_graph_span_records_no_tool_arguments_when_capture_off(self):
        tracer, exporter = _tracer_and_exporter()
        tool_call = SimpleNamespace(
            name="find_patient", args={"patient_id": "P-5521"}, id="call_1"
        )
        response = {
            "messages": [
                SimpleNamespace(
                    content="",
                    role="assistant",
                    response_metadata={},
                    usage_metadata=None,
                    tool_calls=[tool_call],
                )
            ]
        }
        with tracer.start_as_current_span("invoke_workflow LangGraph") as span:
            _process_invoke_response(span, response, False)
        attrs = exporter.get_finished_spans()[0].attributes

        assert "gen_ai.tool_call.0.arguments" not in attrs
        assert "P-5521" not in str(dict(attrs))
        assert attrs["gen_ai.tool_call.0.name"] == "find_patient"
