# pylint: disable=protected-access, missing-class-docstring, missing-function-docstring
"""Mistral responses with ``usage: null`` must not break span finalization."""

import time

from opentelemetry.sdk.trace import TracerProvider

from openlit._config import OpenlitConfig
from openlit.instrumentation.mistral.utils import (
    process_chat_response,
    process_embedding_response,
)


def _tracer():
    OpenlitConfig.reset_to_defaults()
    return TracerProvider().get_tracer("test-mistral-null-usage")


def _kwargs():
    return dict(
        request_model="mistral-small-latest",
        pricing_info=None,
        server_port=443,
        server_address="api.mistral.ai",
        environment="default",
        application_name="test",
        metrics=None,
        start_time=time.time(),
        disable_metrics=True,
    )


def _chat_response(usage):
    return {
        "id": "c1",
        "model": "mistral-small-latest",
        "choices": [
            {
                "message": {"role": "assistant", "content": "hi"},
                "finish_reason": "stop",
            }
        ],
        "usage": usage,
    }


def test_chat_response_with_null_usage_does_not_crash():
    """A null usage in a non-stream chat response must not abort span finalization."""
    span = _tracer().start_span("mistral-chat")
    process_chat_response(response=_chat_response(None), span=span, **_kwargs())
    span.end()


def test_embedding_response_with_null_usage_does_not_crash():
    """A null usage in an embedding response must not abort span finalization."""
    response = {
        "model": "mistral-embed",
        "data": [{"embedding": [0.1, 0.2]}],
        "usage": None,
    }
    span = _tracer().start_span("mistral-embed")
    process_embedding_response(response=response, span=span, **_kwargs())
    span.end()


def test_chat_response_with_real_usage_still_records_tokens():
    """The guard must not change token accounting when usage is present."""
    usage = {
        "prompt_tokens": 11,
        "completion_tokens": 7,
        "prompt_tokens_details": {"cached_tokens": 3},
    }
    span = _tracer().start_span("mistral-chat-usage")
    process_chat_response(response=_chat_response(usage), span=span, **_kwargs())
    span.end()
    assert span.attributes["gen_ai.usage.input_tokens"] == 11
    assert span.attributes["gen_ai.usage.output_tokens"] == 7


def test_embedding_response_with_real_usage_still_records_tokens():
    """Embedding token accounting is unchanged when usage is present."""
    response = {
        "model": "mistral-embed",
        "data": [{"embedding": [0.1]}],
        "usage": {"prompt_tokens": 5},
    }
    span = _tracer().start_span("mistral-embed-usage")
    process_embedding_response(response=response, span=span, **_kwargs())
    span.end()
    assert span.attributes["gen_ai.usage.input_tokens"] == 5
