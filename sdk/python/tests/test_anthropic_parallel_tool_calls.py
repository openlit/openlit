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

NON_STREAM_RESPONSE = {
    "id": "msg_02",
    "model": "claude-3-5-sonnet-latest",
    "role": "assistant",
    "stop_reason": "tool_use",
    "usage": {"input_tokens": 10, "output_tokens": 20},
    "content": [
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


def _tool_call_parts(attrs):
    output_messages = json.loads(attrs[SemanticConvention.GEN_AI_OUTPUT_MESSAGES])
    return [p for p in output_messages[0]["parts"] if p["type"] == "tool_call"]


def test_streaming_parallel_tool_calls_are_not_corrupted():
    """Two parallel tool_use blocks in a stream must both survive, uncorrupted."""
    tracer, exporter = _tracer_with_exporter()

    with tracer.start_as_current_span("anthropic.chat") as span:
        scope = _stream_scope(span)
        for chunk in STREAM_CHUNKS:
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

    spans = exporter.get_finished_spans()
    assert len(spans) == 1
    attrs = spans[0].attributes

    # Single-value span attributes describe the FIRST tool call, cleanly --
    # not the last call's id/name paired with every block's concatenated
    # (and therefore invalid) JSON.
    assert attrs[SemanticConvention.GEN_AI_TOOL_CALL_ID] == "toolu_01"
    assert attrs[SemanticConvention.GEN_AI_TOOL_NAME] == "get_weather"
    assert json.loads(attrs[SemanticConvention.GEN_AI_TOOL_ARGS]) == {"city": "nyc"}

    tool_call_parts = _tool_call_parts(attrs)
    assert len(tool_call_parts) == 2
    assert tool_call_parts[0]["id"] == "toolu_01"
    assert json.loads(tool_call_parts[0]["arguments"]) == {"city": "nyc"}
    assert tool_call_parts[1]["id"] == "toolu_02"
    assert json.loads(tool_call_parts[1]["arguments"]) == {"city": "sf"}


def test_non_streaming_parallel_tool_calls_are_not_dropped():
    """Two parallel tool_use blocks in a response must both be captured, not just the first."""
    tracer, exporter = _tracer_with_exporter()

    with tracer.start_as_current_span("anthropic.chat") as span:
        anthropic_utils.process_chat_response(
            response=NON_STREAM_RESPONSE,
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

    spans = exporter.get_finished_spans()
    assert len(spans) == 1
    attrs = spans[0].attributes

    assert attrs[SemanticConvention.GEN_AI_TOOL_CALL_ID] == "toolu_11"

    tool_call_parts = _tool_call_parts(attrs)
    assert len(tool_call_parts) == 2
    assert [p["id"] for p in tool_call_parts] == ["toolu_11", "toolu_12"]
    assert tool_call_parts[0]["arguments"] == {"city": "nyc"}
    assert tool_call_parts[1]["arguments"] == {"city": "sf"}
