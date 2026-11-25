# pylint: disable=protected-access
"""
Regression tests: google-genai finish reasons are recorded by value.

`response_as_dict` keeps `candidate.finish_reason` as a
`google.genai.types.FinishReason` member, and `str()` of that member is
"FinishReason.STOP". Spans must carry the value ("STOP"), so the output
message maps it to the OTel finish reason, and a streamed chunk without a
finish reason must leave it empty rather than "None".
"""

import json
import time
from types import SimpleNamespace

from google.genai import types
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import (
    InMemorySpanExporter,
)

from openlit._config import OpenlitConfig
from openlit.instrumentation.google_ai_studio import utils as google_ai_studio_utils
from openlit.semcov import SemanticConvention

REQUEST_KWARGS = {"model": "gemini-2.0-flash", "contents": "hi"}


class _FakeResponse(dict):
    """A dict `response_as_dict` passes through unchanged, with the `.text`
    shortcut process_chat_response reads from the real response object."""

    @property
    def text(self):
        """Mirrors the real google-genai response object's `.text` shortcut."""
        return "hello"


def _response(finish_reason):
    return _FakeResponse(
        {
            "response_id": "resp_01",
            "model_version": "gemini-2.0-flash",
            "usage_metadata": {"prompt_token_count": 3, "candidates_token_count": 5},
            "candidates": [
                {
                    "content": {"parts": [{"text": "hello"}]},
                    "finish_reason": finish_reason,
                }
            ],
        }
    )


def _run_non_stream(response):
    OpenlitConfig.reset_to_defaults()
    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    with provider.get_tracer(__name__).start_as_current_span("chat") as span:
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
    return exporter.get_finished_spans()[0].attributes


def _chunk_scope():
    return SimpleNamespace(
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


def test_finish_reason_enum_is_recorded_by_value():
    """A FinishReason member reaches the span as "MAX_TOKENS" and maps to "length"."""
    attrs = _run_non_stream(_response(types.FinishReason.MAX_TOKENS))

    assert attrs[SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON] == ("MAX_TOKENS",)
    output = json.loads(attrs[SemanticConvention.GEN_AI_OUTPUT_MESSAGES])
    assert output[0]["finish_reason"] == "length"


def test_streamed_finish_reason_enum_is_recorded_by_value():
    """A chunk without a finish reason leaves it empty; the last one is kept by value."""
    scope = _chunk_scope()

    google_ai_studio_utils.process_chunk(scope, _response(None))
    assert scope._finish_reason == ""

    google_ai_studio_utils.process_chunk(scope, _response(types.FinishReason.STOP))
    assert scope._finish_reason == "STOP"
