# pylint: disable=missing-function-docstring, protected-access
"""
Unit tests for parallel ``tool_use`` handling in the Anthropic instrumentation.

Claude can emit several ``tool_use`` blocks in a single turn (parallel tool
calling). Both paths used to assume one call per turn:

* streaming -- the id/name were scalars overwritten by each ``content_block_start``
  and every block's ``partial_json`` was appended to one shared string, so two
  calls produced the last call's id next to both calls' JSON concatenated
  together, which does not parse.
* non-streaming -- the loop over content blocks stopped at the first ``tool_use``
  block, so later parallel calls never reached the span at all.

These tests need no API key. The streaming cases drive ``process_chunk``
directly, the way the report for issue #1398 did; the non-streaming cases drive
``process_chat_response`` end to end and assert on the exported span.
"""

import json
import time
from types import SimpleNamespace

from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

from openlit._config import OpenlitConfig
from openlit.instrumentation.anthropic import utils


def _streaming_scope():
    return SimpleNamespace(_timestamps=[], _start_time=0, _llmresponse="", _tools=[])


def _feed(scope, chunks):
    for chunk in chunks:
        utils.process_chunk(scope, chunk)
    return scope


def _tool_use_stream(index, tool_id, name, partial_json):
    return [
        {
            "type": "content_block_start",
            "index": index,
            "content_block": {"type": "tool_use", "id": tool_id, "name": name},
        },
        {
            "type": "content_block_delta",
            "index": index,
            "delta": {"partial_json": partial_json},
        },
    ]


def test_streaming_keeps_parallel_calls_separate():
    scope = _feed(
        _streaming_scope(),
        _tool_use_stream(0, "toolu_01", "get_weather", '{"city": "nyc"}')
        + _tool_use_stream(1, "toolu_02", "get_weather", '{"city": "sf"}'),
    )

    assert scope._tools[0] == {
        "id": "toolu_01",
        "name": "get_weather",
        "input": '{"city": "nyc"}',
    }
    assert scope._tools[1] == {
        "id": "toolu_02",
        "name": "get_weather",
        "input": '{"city": "sf"}',
    }
    # Each block's arguments must stay independently parseable.
    assert json.loads(scope._tools[0]["input"]) == {"city": "nyc"}
    assert json.loads(scope._tools[1]["input"]) == {"city": "sf"}


def test_streaming_accumulates_split_argument_deltas():
    # Anthropic splits one block's JSON across several deltas.
    scope = _feed(
        _streaming_scope(),
        [
            {
                "type": "content_block_start",
                "index": 0,
                "content_block": {"type": "tool_use", "id": "t1", "name": "f"},
            },
            {"type": "content_block_delta", "index": 0, "delta": {"partial_json": '{"a"'}},
            {"type": "content_block_delta", "index": 0, "delta": {"partial_json": ": 1}"}},
        ],
    )

    assert json.loads(scope._tools[0]["input"]) == {"a": 1}


def test_streaming_text_blocks_do_not_create_tool_calls():
    scope = _feed(
        _streaming_scope(),
        [
            {"type": "content_block_start", "index": 0, "content_block": {"type": "text"}},
            {"type": "content_block_delta", "index": 0, "delta": {"text": "thinking "}},
        ]
        + _tool_use_stream(1, "t9", "f", '{"x": 1}'),
    )

    assert scope._llmresponse == "thinking "
    assert [tool for tool in scope._tools if tool] == [
        {"id": "t9", "name": "f", "input": '{"x": 1}'}
    ]


def _exported_span(response):
    """Drive the real non-streaming path and return the finished span."""

    OpenlitConfig.reset_to_defaults()

    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))

    with provider.get_tracer("test").start_as_current_span("anthropic.messages") as span:
        utils.process_chat_response(
            response=response,
            request_model="claude-sonnet-4-20250514",
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
            messages=[{"role": "user", "content": "weather in nyc and sf?"}],
        )

    return exporter.get_finished_spans()[0]


def _parallel_response():
    return {
        "model": "claude-sonnet-4-20250514",
        "stop_reason": "tool_use",
        "id": "msg_01",
        "role": "assistant",
        "usage": {"input_tokens": 10, "output_tokens": 20},
        "content": [
            {"type": "text", "text": "checking both"},
            {
                "type": "tool_use",
                "id": "toolu_01",
                "name": "get_weather",
                "input": {"city": "nyc"},
            },
            {
                "type": "tool_use",
                "id": "toolu_02",
                "name": "get_weather",
                "input": {"city": "sf"},
            },
        ],
    }


def test_non_streaming_keeps_every_tool_use_block():
    # Drives process_chat_response end to end so a regression in the real
    # non-streaming path fails here, not just in a reconstruction of it.
    span = _exported_span(_parallel_response())

    output = json.loads(span.attributes["gen_ai.output.messages"])
    calls = [part for part in output[0]["parts"] if part["type"] == "tool_call"]

    assert [call["id"] for call in calls] == ["toolu_01", "toolu_02"]
    assert [call["arguments"] for call in calls] == [{"city": "nyc"}, {"city": "sf"}]


def test_non_streaming_span_attributes_join_parallel_calls():
    span = _exported_span(_parallel_response())

    assert span.attributes["gen_ai.tool.name"] == "get_weather, get_weather"
    assert span.attributes["gen_ai.tool.call.id"] == "toolu_01, toolu_02"


def test_non_streaming_single_call_attributes_are_unchanged():
    # The one-call case must stay byte-identical to the pre-fix behaviour.
    response = _parallel_response()
    response["content"] = response["content"][:2]

    span = _exported_span(response)

    assert span.attributes["gen_ai.tool.name"] == "get_weather"
    assert span.attributes["gen_ai.tool.call.id"] == "toolu_01"


def test_build_output_messages_accepts_a_single_dict():
    # The pre-existing shape must keep working for any caller still passing one call.
    parts = utils.build_output_messages(
        "hi", "tool_use", {"id": "t1", "name": "n", "input": {"a": 1}}
    )[0]["parts"]

    assert [part["type"] for part in parts] == ["text", "tool_call"]
    assert parts[1]["id"] == "t1"


def test_build_output_messages_skips_empty_entries():
    parts = utils.build_output_messages(
        "", "tool_use", [{}, {"id": "t1", "name": "n", "input": {}}, None]
    )[0]["parts"]

    assert len(parts) == 1
    assert parts[0]["id"] == "t1"
