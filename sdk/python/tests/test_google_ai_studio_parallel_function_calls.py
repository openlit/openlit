# pylint: disable=protected-access
"""
Regression tests: parallel `function_call` parts in a Gemini (google_ai_studio)
turn must not be silently dropped.

Before the fix, `process_chunk`/`process_chat_response` in
`openlit.instrumentation.google_ai_studio.utils` only ever inspected
`parts[0]` of a candidate's content, and streaming additionally overwrote
`scope._tools` on every chunk instead of accumulating across chunks. A turn
with two parallel function calls (Gemini's documented parallel
function-calling) therefore reported at most one call, dropping the rest.

OTel GenAI expects parallel tool calls in `gen_ai.output.messages` as separate
`tool_call` parts with object `arguments`
(https://github.com/open-telemetry/semantic-conventions-genai). Flat
`gen_ai.tool.*` attrs follow the OpenAI/Anthropic instrumentor comma-join
house style.
"""

import json
import time
from types import SimpleNamespace

from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import (
    InMemorySpanExporter,
)

from openlit._config import OpenlitConfig
from openlit.instrumentation.google_ai_studio import utils as google_ai_studio_utils
from openlit.semcov import SemanticConvention

REQUEST_KWARGS = {
    "model": "gemini-2.0-flash",
    "contents": "weather in nyc and sf?",
}

# Gemini streams a function_call as one complete part per chunk (unlike
# Anthropic's incremental partial_json deltas), and parallel calls can land
# in separate chunks -- each chunk only carries its own new parts.
STREAM_CHUNKS = [
    {
        "response_id": "resp_01",
        "model_version": "gemini-2.0-flash",
        "usage_metadata": {"prompt_token_count": 10},
        "candidates": [
            {
                "content": {
                    "parts": [
                        {
                            "function_call": {
                                "name": "get_weather",
                                "args": {"city": "nyc"},
                            }
                        }
                    ]
                },
                "finish_reason": "",
            }
        ],
    },
    {
        "response_id": "resp_01",
        "model_version": "gemini-2.0-flash",
        "usage_metadata": {"candidates_token_count": 20},
        "candidates": [
            {
                "content": {
                    "parts": [
                        {
                            "function_call": {
                                "name": "get_weather",
                                "args": {"city": "sf"},
                            }
                        }
                    ]
                },
                "finish_reason": "STOP",
            }
        ],
    },
]

NON_STREAM_RESPONSE_DICT = {
    "response_id": "resp_02",
    "model_version": "gemini-2.0-flash",
    "usage_metadata": {"prompt_token_count": 10, "candidates_token_count": 20},
    "candidates": [
        {
            "content": {
                "parts": [
                    {"text": "checking both"},
                    {"function_call": {"name": "get_weather", "args": {"city": "nyc"}}},
                    {"function_call": {"name": "get_weather", "args": {"city": "sf"}}},
                ]
            },
            "finish_reason": "STOP",
        }
    ],
}


class _FakeResponse(dict):
    """A dict `response_as_dict` passes through unchanged, that also exposes
    `.text` like the real google-genai response object process_chat_response
    reads directly."""

    @property
    def text(self):
        """Mirrors the real google-genai response object's `.text` shortcut."""
        return self.get("_text", "")


def _tracer_with_exporter():
    OpenlitConfig.reset_to_defaults()
    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    return provider.get_tracer(__name__), exporter


def _stream_scope(span):
    """Mirrors TracedSyncStream.__init__'s scope state in google_ai_studio.py."""
    return SimpleNamespace(
        _span=span,
        _llmresponse="",
        _finish_reason="",
        _response_id="",
        _input_tokens=0,
        _output_tokens=0,
        _reasoning_tokens=0,
        _cache_read_input_tokens=0,
        _cache_creation_input_tokens=0,
        _response_model="",
        _tools=None,
        _kwargs=REQUEST_KWARGS,
        _start_time=time.time(),
        _end_time=None,
        _timestamps=[],
        _ttft=0,
        _tbt=0,
        _server_address="generativelanguage.googleapis.com",
        _server_port=443,
    )


def _run_stream(chunks):
    tracer, exporter = _tracer_with_exporter()
    with tracer.start_as_current_span("google_ai_studio.chat") as span:
        scope = _stream_scope(span)
        for chunk in chunks:
            google_ai_studio_utils.process_chunk(scope, chunk)
        google_ai_studio_utils.process_streaming_chat_response(
            scope,
            pricing_info={},
            environment="test",
            application_name="test",
            metrics=None,
            capture_message_content=True,
            disable_metrics=True,
            version="1.0.0",
        )
    return exporter.get_finished_spans()[0]


def _run_non_stream(response_dict, text=""):
    tracer, exporter = _tracer_with_exporter()
    response = _FakeResponse(response_dict)
    response["_text"] = text
    with tracer.start_as_current_span("google_ai_studio.chat") as span:
        google_ai_studio_utils.process_chat_response(
            instance=None,
            response=response,
            request_model="gemini-2.0-flash",
            pricing_info={},
            server_port=443,
            server_address="generativelanguage.googleapis.com",
            environment="test",
            application_name="test",
            metrics=None,
            start_time=time.time(),
            span=span,
            args=(),
            kwargs=REQUEST_KWARGS,
            capture_message_content=True,
            disable_metrics=True,
            version="1.0.0",
        )
    return exporter.get_finished_spans()[0]


def _tool_call_parts(attrs):
    output_messages = json.loads(attrs[SemanticConvention.GEN_AI_OUTPUT_MESSAGES])
    return [p for p in output_messages[0]["parts"] if p["type"] == "tool_call"]


def _fc_chunk(*cities):
    return {
        "model_version": "gemini-2.0-flash",
        "candidates": [
            {
                "finish_reason": "STOP",
                "content": {
                    "parts": [
                        {
                            "function_call": {
                                "name": "get_weather",
                                "args": {"city": city},
                            }
                        }
                        for city in cities
                    ]
                },
            }
        ],
    }


def test_streaming_parallel_function_calls_are_not_dropped():
    """Two parallel function_call parts, split across two chunks, must both survive."""
    attrs = _run_stream(STREAM_CHUNKS).attributes

    assert attrs[SemanticConvention.GEN_AI_TOOL_NAME] == "get_weather, get_weather"
    assert attrs[SemanticConvention.GEN_AI_TOOL_ARGS] == (
        '{"city": "nyc"}, {"city": "sf"}'
    )
    assert json.loads(attrs[SemanticConvention.GEN_AI_TOOL_CALL_ARGUMENTS]) == [
        {"city": "nyc"},
        {"city": "sf"},
    ]
    # Gemini does not supply call ids; empty field collapses rather than ", ".
    assert not attrs.get(SemanticConvention.GEN_AI_TOOL_CALL_ID)

    tool_call_parts = _tool_call_parts(attrs)
    assert len(tool_call_parts) == 2
    assert tool_call_parts[0]["arguments"] == {"city": "nyc"}
    assert tool_call_parts[1]["arguments"] == {"city": "sf"}

    output = json.loads(attrs[SemanticConvention.GEN_AI_OUTPUT_MESSAGES])
    assert output[0]["finish_reason"] == "tool_call"


def test_streaming_keeps_parallel_calls_within_one_chunk():
    """Both function_call parts in a single streamed chunk must be kept."""
    scope = SimpleNamespace(
        _timestamps=[],
        _start_time=0,
        _llmresponse="",
        _tools=None,
        _response_model=None,
        _finish_reason="",
        _response_id="",
        _input_tokens=0,
        _output_tokens=0,
        _reasoning_tokens=0,
        _cache_read_input_tokens=0,
        _cache_creation_input_tokens=0,
    )
    google_ai_studio_utils.process_chunk(scope, _fc_chunk("nyc", "sf"))
    assert [c["args"]["city"] for c in scope._tools] == ["nyc", "sf"]


def test_streaming_text_chunk_does_not_clobber_collected_calls():
    """A later text-only chunk must not wipe previously accumulated function calls."""
    scope = SimpleNamespace(
        _timestamps=[],
        _start_time=0,
        _llmresponse="",
        _tools=None,
        _response_model=None,
        _finish_reason="",
        _response_id="",
        _input_tokens=0,
        _output_tokens=0,
        _reasoning_tokens=0,
        _cache_read_input_tokens=0,
        _cache_creation_input_tokens=0,
    )
    google_ai_studio_utils.process_chunk(scope, _fc_chunk("nyc"))
    google_ai_studio_utils.process_chunk(
        scope, {"candidates": [{"content": {"parts": [{"text": "done"}]}}]}
    )
    assert [c["args"]["city"] for c in scope._tools] == ["nyc"]


def test_non_streaming_parallel_function_calls_are_not_dropped():
    """Two parallel function_call parts in one candidate must both be captured."""
    attrs = _run_non_stream(NON_STREAM_RESPONSE_DICT, text="checking both").attributes

    assert attrs[SemanticConvention.GEN_AI_TOOL_NAME] == "get_weather, get_weather"
    assert attrs[SemanticConvention.GEN_AI_TOOL_ARGS] == (
        '{"city": "nyc"}, {"city": "sf"}'
    )
    assert json.loads(attrs[SemanticConvention.GEN_AI_TOOL_CALL_ARGUMENTS]) == [
        {"city": "nyc"},
        {"city": "sf"},
    ]

    tool_call_parts = _tool_call_parts(attrs)
    assert len(tool_call_parts) == 2
    assert tool_call_parts[0]["arguments"] == {"city": "nyc"}
    assert tool_call_parts[1]["arguments"] == {"city": "sf"}

    output = json.loads(attrs[SemanticConvention.GEN_AI_OUTPUT_MESSAGES])
    assert output[0]["parts"][0] == {"type": "text", "content": "checking both"}
    assert output[0]["finish_reason"] == "tool_call"


def test_non_streaming_single_function_call_attribute_shape():
    """One function call must keep a single (non-joined) flat attribute value."""
    response = {
        **NON_STREAM_RESPONSE_DICT,
        "candidates": [
            {
                "content": {
                    "parts": [
                        {
                            "function_call": {
                                "name": "get_weather",
                                "args": {"city": "nyc"},
                            }
                        }
                    ]
                },
                "finish_reason": "STOP",
            }
        ],
    }
    attrs = _run_non_stream(response).attributes

    assert attrs[SemanticConvention.GEN_AI_TOOL_NAME] == "get_weather"
    assert attrs[SemanticConvention.GEN_AI_TOOL_ARGS] == '{"city": "nyc"}'
    assert attrs[SemanticConvention.GEN_AI_TOOL_CALL_ARGUMENTS] == '{"city": "nyc"}'


def test_build_output_messages_accepts_legacy_single_dict():
    """A single function-call dict (pre-list shape) must still emit one tool_call part."""
    parts = google_ai_studio_utils.build_output_messages(
        "hi", "STOP", {"name": "n", "args": {"a": 1}}
    )[0]["parts"]

    assert [p["type"] for p in parts] == ["text", "tool_call"]
    assert parts[1]["name"] == "n"
    assert parts[1]["arguments"] == {"a": 1}


def test_build_output_messages_skips_empty_entries():
    """Empty or None entries in a function_calls list must not become tool_call parts."""
    parts = google_ai_studio_utils.build_output_messages(
        "", "STOP", [{}, {"name": "n", "args": {}}, None]
    )[0]["parts"]

    assert len(parts) == 1
    assert parts[0]["name"] == "n"


def test_join_tool_field_keeps_columns_aligned():
    """Empty slots must still occupy a position so name/id/args columns stay aligned."""
    assert google_ai_studio_utils._join_tool_field(["a", "", "c"]) == "a, , c"
    assert google_ai_studio_utils._join_tool_field(["", ""]) == ""
    assert google_ai_studio_utils._join_tool_field([]) == ""


def test_function_calls_handles_object_shaped_parts():
    """Object-shaped parts (pre-dict conversion) must still yield function calls."""

    class _Part:  # pylint: disable=too-few-public-methods
        def __init__(self, call):
            self.function_call = call

    calls = google_ai_studio_utils._function_calls(
        [_Part({"name": "n", "args": {}}), _Part(None)]
    )
    assert calls == [{"name": "n", "args": {}}]
