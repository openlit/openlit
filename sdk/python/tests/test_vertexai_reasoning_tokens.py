# pylint: disable=protected-access, missing-function-docstring
"""Vertex AI thoughts_token_count is not a subset of output tokens.

Gemini/Vertex report thinking separately from candidate output:

  * ``candidates_token_count`` = visible output only
  * ``thoughts_token_count`` = thinking tokens (an addend to total, not a
    facet of output)
  * ``total_token_count`` = prompt + candidates + thoughts (+ tool-use)

That is the opposite of the OpenAI #1537 subset invariant, where reasoning
is already inside ``output_tokens``. These tests lock the Vertex instrumentor
to the google_ai_studio pattern: emit ``gen_ai.usage.reasoning_tokens`` when
thoughts > 0, and leave ``gen_ai.usage.output_tokens`` as candidates only.
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
from openlit.instrumentation.vertexai import utils as vertexai_utils
from openlit.semcov import SemanticConvention

PROMPT_TOKENS = 100
CANDIDATE_TOKENS = 50
THOUGHT_TOKENS = 25


def _tracer_with_exporter():
    OpenlitConfig.reset_to_defaults()
    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    return provider.get_tracer(__name__), exporter


def _usage(prompt=PROMPT_TOKENS, candidates=CANDIDATE_TOKENS, thoughts=None):
    kwargs = {
        "prompt_token_count": prompt,
        "candidates_token_count": candidates,
        "cached_content_token_count": 0,
        "cache_creation_input_tokens": 0,
    }
    if thoughts is not None:
        kwargs["thoughts_token_count"] = thoughts
    return SimpleNamespace(**kwargs)


def _candidate(finish_reason="STOP"):
    return SimpleNamespace(finish_reason=finish_reason)


def _response(usage, text="hello"):
    return SimpleNamespace(
        text=text,
        usage_metadata=usage,
        candidates=[_candidate()],
        id="resp_vertex_1",
        name=None,
    )


def _stream_scope(span):
    """Mirrors TracedSyncStream.__init__ plus fields process_chunk writes."""
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
        _response_model="gemini-2.5-pro",
        _request_model="gemini-2.5-pro",
        _tools=None,
        _kwargs={"contents": [], "generation_config": {}},
        _args=[[]],
        _start_time=time.time(),
        _end_time=None,
        _timestamps=[],
        _ttft=0,
        _tbt=0,
        _server_address="us-central1-aiplatform.googleapis.com",
        _server_port=443,
    )


def _chunk(text="", usage=None, finish_reason=""):
    return SimpleNamespace(
        text=text,
        usage_metadata=usage,
        candidates=[_candidate(finish_reason)] if finish_reason else [],
    )


def _assert_thoughts_not_folded_into_output(attrs, thoughts=THOUGHT_TOKENS):
    """Thoughts are recorded separately and must not change output_tokens."""
    assert attrs[SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS] == PROMPT_TOKENS
    assert attrs[SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS] == CANDIDATE_TOKENS
    assert attrs[SemanticConvention.GEN_AI_USAGE_REASONING_TOKENS] == thoughts
    # Total usage stays prompt + candidates, matching google_ai_studio.
    assert (
        attrs[SemanticConvention.GEN_AI_CLIENT_TOKEN_USAGE]
        == PROMPT_TOKENS + CANDIDATE_TOKENS
    )
    # OpenAI #1537 subset attributes must not be applied to Vertex/Gemini.
    assert SemanticConvention.GEN_AI_USAGE_REASONING_OUTPUT_TOKENS not in attrs
    assert SemanticConvention.GEN_AI_USAGE_DERIVED_COMPLETED_OUTPUT_TOKENS not in attrs


def test_non_streaming_records_thoughts_separately_from_candidates():
    tracer, exporter = _tracer_with_exporter()
    response = _response(_usage(thoughts=THOUGHT_TOKENS))
    with tracer.start_as_current_span("vertexai.chat") as span:
        vertexai_utils.process_chat_response(
            response=response,
            request_model="gemini-2.5-pro",
            pricing_info={},
            server_port=443,
            server_address="us-central1-aiplatform.googleapis.com",
            environment="test",
            application_name="test",
            metrics=None,
            start_time=time.time(),
            span=span,
            capture_message_content=False,
            disable_metrics=True,
            version="1.0.0",
            contents=[],
        )
    attrs = exporter.get_finished_spans()[0].attributes
    _assert_thoughts_not_folded_into_output(attrs)


def test_streaming_last_chunk_usage_records_thoughts():
    """Vertex streams usage_metadata on the last chunk only."""
    tracer, exporter = _tracer_with_exporter()
    with tracer.start_as_current_span("vertexai.chat") as span:
        scope = _stream_scope(span)
        vertexai_utils.process_chunk(scope, _chunk(text="hel"))
        vertexai_utils.process_chunk(
            scope,
            _chunk(
                text="lo",
                usage=_usage(thoughts=THOUGHT_TOKENS),
                finish_reason="STOP",
            ),
        )
        vertexai_utils.process_streaming_chat_response(
            scope,
            pricing_info={},
            environment="test",
            application_name="test",
            metrics=None,
            capture_message_content=False,
            disable_metrics=True,
            version="1.0.0",
        )
    attrs = exporter.get_finished_spans()[0].attributes
    _assert_thoughts_not_folded_into_output(attrs)


def test_missing_thoughts_does_not_emit_reasoning_attribute():
    tracer, exporter = _tracer_with_exporter()
    response = _response(_usage(thoughts=None))
    with tracer.start_as_current_span("vertexai.chat") as span:
        vertexai_utils.process_chat_response(
            response=response,
            request_model="gemini-2.5-pro",
            pricing_info={},
            server_port=443,
            server_address="us-central1-aiplatform.googleapis.com",
            environment="test",
            application_name="test",
            metrics=None,
            start_time=time.time(),
            span=span,
            capture_message_content=False,
            disable_metrics=True,
            version="1.0.0",
            contents=[],
        )
    attrs = exporter.get_finished_spans()[0].attributes
    assert SemanticConvention.GEN_AI_USAGE_REASONING_TOKENS not in attrs
    assert attrs[SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS] == CANDIDATE_TOKENS


def test_zero_thoughts_does_not_emit_reasoning_attribute():
    tracer, exporter = _tracer_with_exporter()
    response = _response(_usage(thoughts=0))
    with tracer.start_as_current_span("vertexai.chat") as span:
        vertexai_utils.process_chat_response(
            response=response,
            request_model="gemini-2.5-pro",
            pricing_info={},
            server_port=443,
            server_address="us-central1-aiplatform.googleapis.com",
            environment="test",
            application_name="test",
            metrics=None,
            start_time=time.time(),
            span=span,
            capture_message_content=False,
            disable_metrics=True,
            version="1.0.0",
            contents=[],
        )
    attrs = exporter.get_finished_spans()[0].attributes
    assert SemanticConvention.GEN_AI_USAGE_REASONING_TOKENS not in attrs


def test_inference_event_includes_reasoning_tokens():
    tracer, exporter = _tracer_with_exporter()
    event_provider = MagicMock()
    response = _response(_usage(thoughts=THOUGHT_TOKENS))
    with tracer.start_as_current_span("vertexai.chat") as span:
        vertexai_utils.process_chat_response(
            response=response,
            request_model="gemini-2.5-pro",
            pricing_info={},
            server_port=443,
            server_address="us-central1-aiplatform.googleapis.com",
            environment="test",
            application_name="test",
            metrics=None,
            start_time=time.time(),
            span=span,
            capture_message_content=False,
            disable_metrics=True,
            version="1.0.0",
            event_provider=event_provider,
            contents=[],
        )
    exporter.get_finished_spans()
    event_provider.emit.assert_called_once()
    event = event_provider.emit.call_args.args[0]
    assert (
        event.attributes[SemanticConvention.GEN_AI_USAGE_REASONING_TOKENS]
        == THOUGHT_TOKENS
    )
    assert (
        event.attributes[SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS]
        == CANDIDATE_TOKENS
    )
