# pylint: disable=protected-access,duplicate-code
"""Regression tests: instrumentations must not crash when a provider response
carries ``"usage": null``.

Azure AI Inference and AI21 were observed returning ``"usage": null`` in the
wild (#2022, #2023). The same OpenAI-shaped response contract is parsed by the
litellm, mistral, cohere and sarvam instrumentations, and gateways or provider
outages can emit the same null payload there. ``dict.get("usage", {})`` does
not help when the key is present with a None value, so the parsers raised
``AttributeError: 'NoneType' object has no attribute 'get'``, marking the span
ERROR and dropping all response telemetry.
"""

import time
from unittest.mock import MagicMock

import pytest
from opentelemetry.sdk.trace import TracerProvider

from openlit._config import OpenlitConfig

OPENAI_SHAPED_RESPONSE = {
    "id": "chatcmpl-null-usage",
    "model": "test-model",
    "choices": [
        {
            "index": 0,
            "message": {"role": "assistant", "content": "hi"},
            "finish_reason": "stop",
        }
    ],
    "usage": None,
}

COHERE_RESPONSE = {
    "id": "cohere-null-usage",
    "message": {"role": "assistant", "content": [{"type": "text", "text": "hi"}]},
    "finish_reason": "COMPLETE",
    "usage": None,
}


def _metrics_dict():
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


def _span():
    OpenlitConfig.reset_to_defaults()
    tracer = TracerProvider().get_tracer("test-null-usage")
    return tracer.start_span("chat test-model")


def _run(process_chat_response, response, **extra):
    span = _span()
    kwargs = dict(
        request_model="test-model",
        pricing_info={},
        server_port=443,
        server_address="api.test",
        environment="test-env",
        application_name="test-app",
        metrics=_metrics_dict(),
        start_time=time.time(),
        span=span,
        capture_message_content=False,
        disable_metrics=False,
        version="test-version",
    )
    kwargs.update(extra)
    try:
        process_chat_response(response, **kwargs)
    finally:
        span.end()


def test_litellm_chat_null_usage_does_not_crash():
    from openlit.instrumentation.litellm.utils import process_chat_response

    _run(process_chat_response, dict(OPENAI_SHAPED_RESPONSE))


def test_mistral_chat_null_usage_does_not_crash():
    from openlit.instrumentation.mistral.utils import process_chat_response

    _run(process_chat_response, dict(OPENAI_SHAPED_RESPONSE))


def test_cohere_chat_null_usage_does_not_crash():
    from openlit.instrumentation.cohere.utils import process_chat_response

    _run(process_chat_response, dict(COHERE_RESPONSE))


def test_sarvam_chat_null_usage_does_not_crash():
    from openlit.instrumentation.sarvam.utils import process_chat_response

    _run(process_chat_response, dict(OPENAI_SHAPED_RESPONSE))
