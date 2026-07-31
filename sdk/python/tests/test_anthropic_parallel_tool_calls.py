# pylint: disable=protected-access
"""
Regression tests: parallel `tool_use` blocks in an Anthropic turn must not
corrupt the span.

Before the fix, `process_chunk`/`process_chat_response` in
`openlit.instrumentation.anthropic.utils` tracked at most one tool call:
streaming kept `_tool_id`/`_tool_name` as scalars (overwritten by every
`content_block_start`) and appended every block's `partial_json` delta into
one `_tool_arguments` string (concatenating two calls' JSON into one invalid
string), while the non-streaming path `break`-ed after the first `tool_use`
block. A turn with two parallel tool calls therefore reported a single
corrupted or truncated tool call. These tests drive the real
`process_chunk`/`process_streaming_chat_response`/`process_chat_response`
functions (the same ones the `anthropic.py` wrapper classes call) with
synthetic API payloads carrying two parallel tool calls, and assert both
survive intact.

OTel GenAI expects parallel tool calls in `gen_ai.output.messages` as separate
`tool_call` parts with object `arguments`
(https://github.com/open-telemetry/semantic-conventions-genai). Flat
`gen_ai.tool.*` attrs follow the OpenAI instrumentor's comma-join house style.
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
from openlit.instrumentation.anthropic import utils as anthropic_utils
from openlit.semcov import SemanticConvention

REQUEST_KWARGS = {
    "model": "claude-3-5-sonnet-latest",
    "messages": [{"role": "user", "content": "weather in nyc and sf?"}],
}

STREAM_CHUNKS = [
    {
        "type": "message_start",
        "message": {
            "id": "msg_01",
            "model": "claude-3-5-sonnet-latest",
            "role": "assistant",
            "usage": {"input_tokens": 10},
        },
    },
    {
        "type": "content_block_start",
        "index": 0,
        "content_block": {"type": "tool_use", "id": "toolu_01", "name": "get_weather"},
    },
    {
        "type": "content_block_delta",
        "index": 0,
        "delta": {"type": "input_json_delta", "partial_json": '{"city": '},
    },
    {
        "type": "content_block_delta",
        "index": 0,
        "delta": {"type": "input_json_delta", "partial_json": '"nyc"}'},
    },
    {"type": "content_block_stop", "index": 0},
    {
        "type": "content_block_start",
        "index": 1,
        "content_block": {"type": "tool_use", "id": "toolu_02", "name": "get_weather"},
    },
    {
        "type": "content_block_delta",
        "index": 1,
        "delta": {"type": "input_json_delta", "partial_json": '{"city": "sf"}'},
    },
    {"type": "content_block_stop", "index": 1},
    {
        "type": "message_delta",
        "delta": {"stop_reason": "tool_use"},
        "usage": {"output_tokens": 20},
    },
    {"type": "message_stop"},
]

STREAM_CHUNKS_WITH_TEXT = [
    {
        "type": "message_start",
        "message": {
            "id": "msg_03",
            "model": "claude-3-5-sonnet-latest",
            "role": "assistant",
            "usage": {"input_tokens": 10},
        },
    },
    {
        "type": "content_block_start",
        "index": 0,
        "content_block": {"type": "text", "text": ""},
    },
    {
        "type": "content_block_delta",
        "index": 0,
        "delta": {"type": "text_delta", "text": "checking both"},
    },
    {"type": "content_block_stop", "index": 0},
    {
        "type": "content_block_start",
        "index": 1,
        "content_block": {"type": "tool_use", "id": "toolu_21", "name": "get_weather"},
    },
    {
        "type": "content_block_delta",
        "index": 1,
        "delta": {"type": "input_json_delta", "partial_json": '{"city": "nyc"}'},
    },
    {"type": "content_block_stop", "index": 1},
    {
        "type": "message_delta",
        "delta": {"stop_reason": "tool_use"},
        "usage": {"output_tokens": 15},
    },
    {"type": "message_stop"},
]

NON_STREAM_RESPONSE = {
    "id": "msg_02",
    "model": "claude-3-5-sonnet-latest",
    "role": "assistant",
    "stop_reason": "tool_use",
    "usage": {"input_tokens": 10, "output_tokens": 20},
    "content": [
        {"type": "text", "text": "checking both"},
        {
            "type": "tool_use",
            "id": "toolu_11",
            "name": "get_weather",
            "input": {"city": "nyc"},
        },
        {
            "type": "tool_use",
            "id": "toolu_12",
            "name": "get_weather",
            "input": {"city": "sf"},
        },
    ],
}


def _tracer_with_exporter():
    OpenlitConfig.reset_to_defaults()
    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    return provider.get_tracer(__name__), exporter


def _stream_scope(span):
    """Mirrors TracedSyncStream.__init__'s scope state in anthropic.py."""
    return SimpleNamespace(
        _span=span,
        _llmresponse="",
        _response_id="",
        _response_model="",
        _finish_reason="",
        _input_tokens=0,
        _output_tokens=0,
        _cache_read_input_tokens=0,
        _cache_creation_input_tokens=0,
        _tool_calls_by_index={},
        _tool_calls=None,
        _response_role="",
        _kwargs=REQUEST_KWARGS,
        _start_time=time.time(),
        _end_time=None,
        _timestamps=[],
        _ttft=0,
        _tbt=0,
        _server_address="api.anthropic.com",
        _server_port=443,
    )


def _run_stream(chunks):
    tracer, exporter = _tracer_with_exporter()
    with tracer.start_as_current_span("anthropic.chat") as span:
        scope = _stream_scope(span)
        for chunk in chunks:
            anthropic_utils.process_chunk(scope, chunk)
        anthropic_utils.process_streaming_chat_response(
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


def _run_non_stream(response):
    tracer, exporter = _tracer_with_exporter()
    with tracer.start_as_current_span("anthropic.chat") as span:
        anthropic_utils.process_chat_response(
            response=response,
            request_model="claude-3-5-sonnet-latest",
            pricing_info={},
            server_port=443,
            server_address="api.anthropic.com",
            environment="test",
            application_name="test",
            metrics=None,
            start_time=time.time(),
            span=span,
            capture_message_content=True,
            disable_metrics=True,
            **REQUEST_KWARGS,
        )
    return exporter.get_finished_spans()[0]


def _tool_call_parts(attrs):
    output_messages = json.loads(attrs[SemanticConvention.GEN_AI_OUTPUT_MESSAGES])
    return [p for p in output_messages[0]["parts"] if p["type"] == "tool_call"]


def test_streaming_parallel_tool_calls_are_not_corrupted():
    """Two parallel tool_use blocks in a stream must both survive, uncorrupted."""
    attrs = _run_stream(STREAM_CHUNKS).attributes

    # Flat attrs join all parallel calls (OpenAI instrumentor house style).
    assert attrs[SemanticConvention.GEN_AI_TOOL_CALL_ID] == "toolu_01, toolu_02"
    assert attrs[SemanticConvention.GEN_AI_TOOL_NAME] == "get_weather, get_weather"
    assert attrs[SemanticConvention.GEN_AI_TOOL_ARGS] == (
        '{"city": "nyc"}, {"city": "sf"}'
    )
    assert json.loads(attrs[SemanticConvention.GEN_AI_TOOL_CALL_ARGUMENTS]) == [
        {"city": "nyc"},
        {"city": "sf"},
    ]

    # OTel output messages: one tool_call part per call, arguments as objects.
    tool_call_parts = _tool_call_parts(attrs)
    assert len(tool_call_parts) == 2
    assert tool_call_parts[0]["id"] == "toolu_01"
    assert tool_call_parts[0]["arguments"] == {"city": "nyc"}
    assert tool_call_parts[1]["id"] == "toolu_02"
    assert tool_call_parts[1]["arguments"] == {"city": "sf"}

    output = json.loads(attrs[SemanticConvention.GEN_AI_OUTPUT_MESSAGES])
    assert output[0]["finish_reason"] == "tool_call"


def test_streaming_text_block_does_not_create_tool_calls():
    """Text content blocks must not pollute the tool-call index map."""
    attrs = _run_stream(STREAM_CHUNKS_WITH_TEXT).attributes

    output = json.loads(attrs[SemanticConvention.GEN_AI_OUTPUT_MESSAGES])
    parts = output[0]["parts"]
    assert parts[0] == {"type": "text", "content": "checking both"}
    assert [p["id"] for p in parts if p["type"] == "tool_call"] == ["toolu_21"]
    assert attrs[SemanticConvention.GEN_AI_TOOL_CALL_ID] == "toolu_21"


def test_non_streaming_parallel_tool_calls_are_not_dropped():
    """Two parallel tool_use blocks in a response must both be captured."""
    attrs = _run_non_stream(NON_STREAM_RESPONSE).attributes

    assert attrs[SemanticConvention.GEN_AI_TOOL_CALL_ID] == "toolu_11, toolu_12"
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
    assert [p["id"] for p in tool_call_parts] == ["toolu_11", "toolu_12"]
    assert tool_call_parts[0]["arguments"] == {"city": "nyc"}
    assert tool_call_parts[1]["arguments"] == {"city": "sf"}

    output = json.loads(attrs[SemanticConvention.GEN_AI_OUTPUT_MESSAGES])
    assert output[0]["parts"][0] == {"type": "text", "content": "checking both"}
    assert output[0]["finish_reason"] == "tool_call"


def test_non_streaming_single_tool_call_attributes_are_unchanged_shape():
    """One tool call must keep a single (non-joined) flat attribute value."""
    response = {
        **NON_STREAM_RESPONSE,
        "content": [
            {
                "type": "tool_use",
                "id": "toolu_01",
                "name": "get_weather",
                "input": {"city": "nyc"},
            }
        ],
    }
    attrs = _run_non_stream(response).attributes

    assert attrs[SemanticConvention.GEN_AI_TOOL_CALL_ID] == "toolu_01"
    assert attrs[SemanticConvention.GEN_AI_TOOL_NAME] == "get_weather"
    assert attrs[SemanticConvention.GEN_AI_TOOL_ARGS] == '{"city": "nyc"}'
    assert attrs[SemanticConvention.GEN_AI_TOOL_CALL_ARGUMENTS] == '{"city": "nyc"}'


def test_build_output_messages_parses_streamed_json_strings():
    """Streamed argument strings become objects in OTel tool_call parts."""
    parts = anthropic_utils.build_output_messages(
        "",
        "tool_use",
        [{"id": "t1", "name": "f", "input": '{"a": 1}'}],
    )[0]["parts"]

    assert parts[0]["arguments"] == {"a": 1}


def test_build_output_messages_accepts_legacy_single_dict():
    parts = anthropic_utils.build_output_messages(
        "hi", "tool_use", {"id": "t1", "name": "n", "input": {"a": 1}}
    )[0]["parts"]

    assert [p["type"] for p in parts] == ["text", "tool_call"]
    assert parts[1]["id"] == "t1"


def test_build_output_messages_skips_empty_entries():
    parts = anthropic_utils.build_output_messages(
        "", "tool_use", [{}, {"id": "t1", "name": "n", "input": {}}, None]
    )[0]["parts"]

    assert len(parts) == 1
    assert parts[0]["id"] == "t1"


def test_join_tool_field_keeps_columns_aligned():
    # From #1416: empty slots must still occupy a position so name/id/args
    # columns stay aligned across parallel calls.
    assert anthropic_utils._join_tool_field(["a", "", "c"]) == "a, , c"
    assert anthropic_utils._join_tool_field(["", ""]) == ""
    assert anthropic_utils._join_tool_field([]) == ""


def test_streaming_accumulates_split_argument_deltas():
    """Direct accumulator check: one tool_use split across many partial_json deltas."""
    scope = SimpleNamespace(
        _timestamps=[],
        _start_time=0,
        _llmresponse="",
        _tool_calls_by_index={},
    )
    for chunk in [
        {
            "type": "content_block_start",
            "index": 0,
            "content_block": {"type": "tool_use", "id": "t1", "name": "f"},
        },
        {
            "type": "content_block_delta",
            "index": 0,
            "delta": {"partial_json": '{"a"'},
        },
        {
            "type": "content_block_delta",
            "index": 0,
            "delta": {"partial_json": ": 1}"},
        },
    ]:
        anthropic_utils.process_chunk(scope, chunk)

    assert json.loads(scope._tool_calls_by_index[0]["input"]) == {"a": 1}
