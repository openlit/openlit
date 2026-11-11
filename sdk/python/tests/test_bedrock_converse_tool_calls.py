# pylint: disable=protected-access
"""
Regression tests: tool calls and text-after-reasoning in Bedrock Converse spans.

Before this fix, `process_chat_response` read only `content[0].get("text")` so:
- a response whose first block is `reasoningContent` recorded an empty answer
- a response with `toolUse` blocks dropped them entirely from
  `gen_ai.output.messages` (tool_calls=None was always passed)

For streaming, `process_chunk` handled only text deltas; `contentBlockStart` /
`contentBlockDelta.toolUse` events were silently ignored.

These tests drive `process_chunk` / `process_streaming_chat_response` /
`process_chat_response` directly with synthetic payloads (no AWS credentials
required) and assert the correct content appears in the span.
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
from openlit.instrumentation.bedrock import utils as bedrock_utils
from openlit.semcov import SemanticConvention

# ---------------------------------------------------------------------------
# Shared request kwargs
# ---------------------------------------------------------------------------

REQUEST_KWARGS = {
    "modelId": "us.anthropic.claude-haiku-4-5-20251001-v1:0",
    "messages": [{"role": "user", "content": [{"text": "What is the weather in NYC?"}]}],
}

# ---------------------------------------------------------------------------
# Non-streaming response fixtures
# ---------------------------------------------------------------------------

NON_STREAM_TEXT_ONLY = {
    "output": {"message": {"role": "assistant", "content": [{"text": "It is sunny."}]}},
    "stopReason": "end_turn",
    "usage": {"inputTokens": 10, "outputTokens": 5},
}

NON_STREAM_REASONING_THEN_TEXT = {
    "output": {
        "message": {
            "role": "assistant",
            "content": [
                {"reasoningContent": {"reasoningText": {"text": "Let me think..."}}},
                {"text": "It is 72 degrees."},
            ],
        }
    },
    "stopReason": "end_turn",
    "usage": {"inputTokens": 15, "outputTokens": 20},
}

NON_STREAM_TOOL_USE = {
    "output": {
        "message": {
            "role": "assistant",
            "content": [
                {
                    "toolUse": {
                        "toolUseId": "tooluse_abc",
                        "name": "get_weather",
                        "input": {"city": "NYC"},
                    }
                }
            ],
        }
    },
    "stopReason": "tool_use",
    "usage": {"inputTokens": 12, "outputTokens": 18},
}

NON_STREAM_TEXT_AND_TOOL = {
    "output": {
        "message": {
            "role": "assistant",
            "content": [
                {"text": "Checking now."},
                {
                    "toolUse": {
                        "toolUseId": "tooluse_xyz",
                        "name": "get_weather",
                        "input": {"city": "NYC"},
                    }
                },
            ],
        }
    },
    "stopReason": "tool_use",
    "usage": {"inputTokens": 12, "outputTokens": 22},
}

NON_STREAM_PARALLEL_TOOL_CALLS = {
    "output": {
        "message": {
            "role": "assistant",
            "content": [
                {
                    "toolUse": {
                        "toolUseId": "tooluse_01",
                        "name": "get_weather",
                        "input": {"city": "NYC"},
                    }
                },
                {
                    "toolUse": {
                        "toolUseId": "tooluse_02",
                        "name": "get_weather",
                        "input": {"city": "SF"},
                    }
                },
            ],
        }
    },
    "stopReason": "tool_use",
    "usage": {"inputTokens": 12, "outputTokens": 30},
}

# ---------------------------------------------------------------------------
# Streaming event fixtures
# ---------------------------------------------------------------------------

STREAM_TEXT_ONLY = [
    {"messageStart": {"role": "assistant"}},
    {"contentBlockDelta": {"contentBlockIndex": 0, "delta": {"text": "It is "}}},
    {"contentBlockDelta": {"contentBlockIndex": 0, "delta": {"text": "sunny."}}},
    {"messageStop": {"stopReason": "end_turn"}},
    {"metadata": {"usage": {"inputTokens": 10, "outputTokens": 5}}},
]

STREAM_TOOL_USE = [
    {"messageStart": {"role": "assistant"}},
    {
        "contentBlockStart": {
            "contentBlockIndex": 0,
            "start": {"toolUse": {"toolUseId": "tooluse_s1", "name": "get_weather"}},
        }
    },
    {
        "contentBlockDelta": {
            "contentBlockIndex": 0,
            "delta": {"toolUse": {"input": '{"city": '}},
        }
    },
    {
        "contentBlockDelta": {
            "contentBlockIndex": 0,
            "delta": {"toolUse": {"input": '"NYC"}'}},
        }
    },
    {"messageStop": {"stopReason": "tool_use"}},
    {"metadata": {"usage": {"inputTokens": 12, "outputTokens": 18}}},
]

STREAM_TEXT_THEN_TOOL = [
    {"messageStart": {"role": "assistant"}},
    {"contentBlockDelta": {"contentBlockIndex": 0, "delta": {"text": "Checking now."}}},
    {
        "contentBlockStart": {
            "contentBlockIndex": 1,
            "start": {"toolUse": {"toolUseId": "tooluse_s2", "name": "get_weather"}},
        }
    },
    {
        "contentBlockDelta": {
            "contentBlockIndex": 1,
            "delta": {"toolUse": {"input": '{"city": "NYC"}'}},
        }
    },
    {"messageStop": {"stopReason": "tool_use"}},
    {"metadata": {"usage": {"inputTokens": 12, "outputTokens": 22}}},
]

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _tracer_with_exporter():
    OpenlitConfig.reset_to_defaults()
    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    return provider.get_tracer(__name__), exporter


def _stream_scope(span):
    """Mirrors TracedSyncStream.__init__ state in bedrock.py."""
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
        _response_role="",
        _kwargs=REQUEST_KWARGS,
        _llm_config={},
        _start_time=time.time(),
        _end_time=None,
        _timestamps=[],
        _ttft=0,
        _tbt=0,
        _server_address="bedrock-runtime.us-east-1.amazonaws.com",
        _server_port=443,
    )


def _run_stream(chunks):
    tracer, exporter = _tracer_with_exporter()
    with tracer.start_as_current_span("bedrock.chat") as span:
        scope = _stream_scope(span)
        for chunk in chunks:
            bedrock_utils.process_chunk(scope, chunk)
        bedrock_utils.process_streaming_chat_response(
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
    with tracer.start_as_current_span("bedrock.chat") as span:
        bedrock_utils.process_chat_response(
            response=response,
            request_model=REQUEST_KWARGS["modelId"],
            pricing_info={},
            server_port=443,
            server_address="bedrock-runtime.us-east-1.amazonaws.com",
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


def _output_parts(attrs):
    output = json.loads(attrs[SemanticConvention.GEN_AI_OUTPUT_MESSAGES])
    return output[0]["parts"]


def _tool_call_parts(attrs):
    return [p for p in _output_parts(attrs) if p["type"] == "tool_call"]


# ---------------------------------------------------------------------------
# Non-streaming tests
# ---------------------------------------------------------------------------


def test_non_stream_text_only_records_text():
    """A plain text response is captured in gen_ai.output.messages."""
    attrs = _run_non_stream(NON_STREAM_TEXT_ONLY).attributes
    parts = _output_parts(attrs)
    assert parts == [{"type": "text", "content": "It is sunny."}]


def test_non_stream_text_after_reasoning_is_recorded():
    """Text block after a reasoningContent block must not be dropped."""
    attrs = _run_non_stream(NON_STREAM_REASONING_THEN_TEXT).attributes
    parts = _output_parts(attrs)
    assert parts == [{"type": "text", "content": "It is 72 degrees."}]


def test_non_stream_tool_use_appears_in_output_messages():
    """A toolUse block must become a tool_call part in gen_ai.output.messages."""
    attrs = _run_non_stream(NON_STREAM_TOOL_USE).attributes
    tool_parts = _tool_call_parts(attrs)
    assert len(tool_parts) == 1
    assert tool_parts[0]["id"] == "tooluse_abc"
    assert tool_parts[0]["name"] == "get_weather"
    assert tool_parts[0]["arguments"] == {"city": "NYC"}


def test_non_stream_text_and_tool_both_captured():
    """Text and toolUse blocks in the same response must both appear in parts."""
    attrs = _run_non_stream(NON_STREAM_TEXT_AND_TOOL).attributes
    parts = _output_parts(attrs)
    assert parts[0] == {"type": "text", "content": "Checking now."}
    assert parts[1]["type"] == "tool_call"
    assert parts[1]["id"] == "tooluse_xyz"
    assert parts[1]["arguments"] == {"city": "NYC"}


def test_non_stream_parallel_tool_calls_all_captured():
    """Multiple toolUse blocks must all appear as separate tool_call parts."""
    attrs = _run_non_stream(NON_STREAM_PARALLEL_TOOL_CALLS).attributes
    tool_parts = _tool_call_parts(attrs)
    assert len(tool_parts) == 2
    assert tool_parts[0]["id"] == "tooluse_01"
    assert tool_parts[0]["arguments"] == {"city": "NYC"}
    assert tool_parts[1]["id"] == "tooluse_02"
    assert tool_parts[1]["arguments"] == {"city": "SF"}


# ---------------------------------------------------------------------------
# Streaming tests
# ---------------------------------------------------------------------------


def test_stream_text_only_records_text():
    """Plain text streaming response is captured."""
    attrs = _run_stream(STREAM_TEXT_ONLY).attributes
    parts = _output_parts(attrs)
    assert parts == [{"type": "text", "content": "It is sunny."}]


def test_stream_tool_use_appears_in_output_messages():
    """Streamed toolUse (contentBlockStart + delta sequence) is captured."""
    attrs = _run_stream(STREAM_TOOL_USE).attributes
    tool_parts = _tool_call_parts(attrs)
    assert len(tool_parts) == 1
    assert tool_parts[0]["id"] == "tooluse_s1"
    assert tool_parts[0]["name"] == "get_weather"
    assert tool_parts[0]["arguments"] == {"city": "NYC"}


def test_stream_text_then_tool_both_captured():
    """Text delta followed by toolUse events must both appear in parts."""
    attrs = _run_stream(STREAM_TEXT_THEN_TOOL).attributes
    parts = _output_parts(attrs)
    text_parts = [p for p in parts if p["type"] == "text"]
    tool_parts = [p for p in parts if p["type"] == "tool_call"]
    assert text_parts == [{"type": "text", "content": "Checking now."}]
    assert len(tool_parts) == 1
    assert tool_parts[0]["id"] == "tooluse_s2"
    assert tool_parts[0]["arguments"] == {"city": "NYC"}
