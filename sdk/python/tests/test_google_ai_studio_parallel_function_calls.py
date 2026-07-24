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
These tests drive the real `process_chunk`/`process_streaming_chat_response`/
`process_chat_response` functions (the same ones the `google_ai_studio.py`
wrapper classes call) with synthetic API payloads carrying two parallel
function calls, and assert both survive intact.
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


def _tool_call_parts(attrs):
    output_messages = json.loads(attrs[SemanticConvention.GEN_AI_OUTPUT_MESSAGES])
    return [p for p in output_messages[0]["parts"] if p["type"] == "tool_call"]


def test_streaming_parallel_function_calls_are_not_dropped():
    """Two parallel function_call parts, split across two chunks, must both survive."""
    tracer, exporter = _tracer_with_exporter()

    with tracer.start_as_current_span("google_ai_studio.chat") as span:
        scope = _stream_scope(span)
        for chunk in STREAM_CHUNKS:
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

    spans = exporter.get_finished_spans()
    assert len(spans) == 1
    attrs = spans[0].attributes

    # Single-value span attributes describe the FIRST function call, cleanly
    # (GEN_AI_TOOL_ARGS is str()'d, not JSON-encoded -- an existing quirk of
    # this instrumentor, unrelated to this fix).
    assert attrs[SemanticConvention.GEN_AI_TOOL_NAME] == "get_weather"
    assert attrs[SemanticConvention.GEN_AI_TOOL_ARGS] == str({"city": "nyc"})

    tool_call_parts = _tool_call_parts(attrs)
    assert len(tool_call_parts) == 2
    assert tool_call_parts[0]["arguments"] == {"city": "nyc"}
    assert tool_call_parts[1]["arguments"] == {"city": "sf"}


def test_non_streaming_parallel_function_calls_are_not_dropped():
    """Two parallel function_call parts in one candidate must both be captured, not just parts[0]."""
    tracer, exporter = _tracer_with_exporter()
    response = _FakeResponse(NON_STREAM_RESPONSE_DICT)
    response["_text"] = ""

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

    spans = exporter.get_finished_spans()
    assert len(spans) == 1
    attrs = spans[0].attributes

    assert attrs[SemanticConvention.GEN_AI_TOOL_NAME] == "get_weather"

    tool_call_parts = _tool_call_parts(attrs)
    assert len(tool_call_parts) == 2
    assert tool_call_parts[0]["arguments"] == {"city": "nyc"}
    assert tool_call_parts[1]["arguments"] == {"city": "sf"}
