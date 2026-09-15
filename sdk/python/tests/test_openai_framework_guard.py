"""Tests for suppressing OpenAI Responses spans inside framework instrumentation."""

from unittest.mock import AsyncMock, Mock

import pytest

from openlit.__helpers import (
    reset_framework_llm_active,
    set_framework_llm_active,
)
from openlit.instrumentation.openai.async_openai import async_responses
from openlit.instrumentation.openai.openai import responses


def _wrapper_kwargs(tracer):
    """Return common wrapper configuration."""
    return {
        "version": "test-version",
        "environment": "test-env",
        "application_name": "test-app",
        "tracer": tracer,
        "pricing_info": {},
        "capture_message_content": False,
        "metrics": None,
        "disable_metrics": True,
    }


@pytest.mark.parametrize("streaming", [False, True])
def test_responses_skips_span_when_framework_llm_is_active(streaming):
    """Sync Responses calls should pass through without creating a span."""
    tracer = Mock()
    wrapper = responses(**_wrapper_kwargs(tracer))
    sentinel = object()
    wrapped = Mock(return_value=sentinel)
    kwargs = {"model": "gpt-4o", "stream": streaming}

    token = set_framework_llm_active()
    try:
        result = wrapper(wrapped, object(), (), kwargs)
    finally:
        reset_framework_llm_active(token)

    assert result is sentinel
    wrapped.assert_called_once_with(model="gpt-4o", stream=streaming)
    tracer.start_span.assert_not_called()
    tracer.start_as_current_span.assert_not_called()


@pytest.mark.asyncio
@pytest.mark.parametrize("streaming", [False, True])
async def test_async_responses_skips_span_when_framework_llm_is_active(
    streaming,
):
    """Async Responses calls should pass through without creating a span."""
    tracer = Mock()
    wrapper = async_responses(**_wrapper_kwargs(tracer))
    sentinel = object()
    wrapped = AsyncMock(return_value=sentinel)
    kwargs = {"model": "gpt-4o", "stream": streaming}

    token = set_framework_llm_active()
    try:
        result = await wrapper(wrapped, object(), (), kwargs)
    finally:
        reset_framework_llm_active(token)

    assert result is sentinel
    wrapped.assert_awaited_once_with(model="gpt-4o", stream=streaming)
    tracer.start_span.assert_not_called()
    tracer.start_as_current_span.assert_not_called()