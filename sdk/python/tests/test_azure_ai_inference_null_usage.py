# pylint: disable=protected-access
"""Regression tests for Azure AI Inference responses with ``usage: null`` (#2023).

An explicit JSON null is not the same as a missing key: ``get("usage", {})``
returns ``None`` when the key is present with a null value, so the following
``.get("prompt_tokens", 0)`` raises ``AttributeError``. The wrapper caught that
error, marked the span ERROR and lost every response attribute. Null usage means
the provider did not report tokens, so it must be treated as an empty mapping:
token counts stay at their zero default while model, id and finish reason are
recorded as usual.
"""

import time
from unittest.mock import MagicMock

from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import (
    InMemorySpanExporter,
)
from opentelemetry.trace import StatusCode

from openlit._config import OpenlitConfig
from openlit.instrumentation.azure_ai_inference import azure_ai_inference as sync_mod
from openlit.instrumentation.azure_ai_inference.utils import (
    process_chat_response,
    process_embedding_response,
)
from openlit.semcov import SemanticConvention

CHAT_REQUEST = {
    "model": "gpt-4o",
    "messages": [{"role": "user", "content": "What is 42?"}],
}

EMBED_REQUEST = {
    "model": "text-embedding-3-small",
    "input": ["hello"],
}

CHAT_RESPONSE = {
    "id": "chatcmpl-null-usage",
    "object": "chat.completion",
    "model": "gpt-4o",
    "choices": [
        {
            "index": 0,
            "message": {"role": "assistant", "content": "The answer is 42."},
            "finish_reason": "stop",
        }
    ],
    "usage": None,
}

EMBED_RESPONSE = {
    "object": "list",
    "model": "text-embedding-3-small",
    "data": [{"object": "embedding", "index": 0, "embedding": [0.1, 0.2]}],
    "usage": None,
}


def _tracer_and_exporter():
    OpenlitConfig.reset_to_defaults()
    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    return provider.get_tracer("test-azure-ai-inference-null-usage"), exporter


def _metrics_dict():
    """Metric instruments mirroring openlit.otel.metrics.build_metrics()."""
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


def _assert_chat_telemetry(span):
    assert span.status.status_code == StatusCode.OK
    attrs = span.attributes
    assert SemanticConvention.ERROR_TYPE not in attrs
    assert attrs[SemanticConvention.GEN_AI_RESPONSE_ID] == "chatcmpl-null-usage"
    assert attrs[SemanticConvention.GEN_AI_RESPONSE_MODEL] == "gpt-4o"
    assert tuple(attrs[SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON]) == ("stop",)


def _assert_embed_telemetry(span):
    assert span.status.status_code == StatusCode.OK
    attrs = span.attributes
    assert SemanticConvention.ERROR_TYPE not in attrs
    assert attrs[SemanticConvention.GEN_AI_RESPONSE_MODEL] == "text-embedding-3-small"


def test_chat_response_with_null_usage_keeps_ok_span_and_metadata():
    """Direct process_chat_response: null usage must not raise AttributeError."""
    tracer, exporter = _tracer_and_exporter()
    with tracer.start_as_current_span("chat null usage") as span:
        result = process_chat_response(
            CHAT_RESPONSE,
            request_model="gpt-4o",
            pricing_info={},
            server_port=443,
            server_address="models.github.ai",
            environment="test-env",
            application_name="test-app",
            metrics=_metrics_dict(),
            start_time=time.time(),
            span=span,
            capture_message_content=False,
            disable_metrics=False,
            version="test-version",
            **CHAT_REQUEST,
        )

    assert result is CHAT_RESPONSE
    _assert_chat_telemetry(exporter.get_finished_spans()[0])


def test_embed_response_with_null_usage_keeps_ok_span_and_metadata():
    """Direct process_embedding_response: null usage must not raise AttributeError."""
    tracer, exporter = _tracer_and_exporter()
    with tracer.start_as_current_span("embed null usage") as span:
        result = process_embedding_response(
            EMBED_RESPONSE,
            request_model="text-embedding-3-small",
            pricing_info={},
            server_port=443,
            server_address="models.github.ai",
            environment="test-env",
            application_name="test-app",
            metrics=_metrics_dict(),
            start_time=time.time(),
            span=span,
            capture_message_content=False,
            disable_metrics=False,
            version="test-version",
            **EMBED_REQUEST,
        )

    assert result is EMBED_RESPONSE
    _assert_embed_telemetry(exporter.get_finished_spans()[0])


def test_chat_wrapper_with_null_usage_keeps_ok_span_and_metadata():
    """Through the public complete() wrapper: no ERROR span, no lost telemetry."""
    tracer, exporter = _tracer_and_exporter()
    wrapper = sync_mod.complete(
        version="test-version",
        environment="test-env",
        application_name="test-app",
        tracer=tracer,
        pricing_info={},
        capture_message_content=False,
        metrics=_metrics_dict(),
        disable_metrics=False,
        event_provider=None,
    )

    result = wrapper(lambda *_args, **_kwargs: CHAT_RESPONSE, None, (), CHAT_REQUEST)

    assert result is CHAT_RESPONSE
    spans = exporter.get_finished_spans()
    assert len(spans) == 1
    _assert_chat_telemetry(spans[0])


def test_embed_wrapper_with_null_usage_keeps_ok_span_and_metadata():
    """Through the public embed() wrapper: no ERROR span, no lost telemetry."""
    tracer, exporter = _tracer_and_exporter()
    wrapper = sync_mod.embed(
        version="test-version",
        environment="test-env",
        application_name="test-app",
        tracer=tracer,
        pricing_info={},
        capture_message_content=False,
        metrics=_metrics_dict(),
        disable_metrics=False,
        event_provider=None,
    )

    result = wrapper(lambda *_args, **_kwargs: EMBED_RESPONSE, None, (), EMBED_REQUEST)

    assert result is EMBED_RESPONSE
    spans = exporter.get_finished_spans()
    assert len(spans) == 1
    _assert_embed_telemetry(spans[0])


def test_streaming_chat_with_null_usage_chunk_keeps_ok_span_and_metadata():
    """A streaming update with ``usage: null`` is ignored, not instrumented."""

    class NullUsageStream:
        """Minimal context-manager stream yielding scripted chunks."""

        def __init__(self, chunks):
            self._it = iter(chunks)

        def __enter__(self):
            return self

        def __exit__(self, *_exc):
            return False

        def __iter__(self):
            return self

        def __next__(self):
            return next(self._it)

    chunks = [
        {
            "id": "chatcmpl-null-usage",
            "model": "gpt-4o",
            "choices": [
                {
                    "index": 0,
                    "delta": {"content": "The answer is 42."},
                    "finish_reason": None,
                }
            ],
        },
        {
            "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}],
            "usage": None,
        },
    ]
    tracer, exporter = _tracer_and_exporter()
    wrapper = sync_mod.complete(
        version="test-version",
        environment="test-env",
        application_name="test-app",
        tracer=tracer,
        pricing_info={},
        capture_message_content=False,
        metrics=_metrics_dict(),
        disable_metrics=False,
        event_provider=None,
    )
    stream = wrapper(
        lambda *_args, **_kwargs: NullUsageStream(chunks),
        None,
        (),
        {**CHAT_REQUEST, "stream": True},
    )
    with stream as open_stream:
        for _ in open_stream:
            pass

    spans = exporter.get_finished_spans()
    assert len(spans) == 1
    _assert_chat_telemetry(spans[0])
