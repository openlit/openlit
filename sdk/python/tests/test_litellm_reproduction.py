"""Tests for LiteLLM instrumentation reproduction."""

import asyncio
from unittest.mock import MagicMock

from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter
from wrapt import FunctionWrapper
import pytest

import openlit
from openlit.instrumentation.litellm.async_litellm import acompletion as openlit_acompletion


@pytest.mark.asyncio
async def test_litellm_async_stream_premature_close_reproduction():
    """
    Reproduces the issue where premature async stream cancellation (e.g. CancelledError)
    skips the metric recording and span closure in OpenLIT's LiteLLM instrumentation.
    """
    # Setup OTEL in-memory exporter
    exporter = InMemorySpanExporter()
    tracer_provider = TracerProvider()
    tracer_processor = SimpleSpanProcessor(exporter)
    tracer_provider.add_span_processor(tracer_processor)

    # We test the wrapper factory directly
    wrapper_factory = openlit_acompletion(
        version="1.0.0",
        environment="test",
        application_name="test",
        tracer=tracer_provider.get_tracer("test"),
        pricing_info={},
        capture_message_content=True,
        metrics=None,
        disable_metrics=True
    )

    # Original function returns an async generator that raises CancelledError
    async def mock_original_gen():
        yield MagicMock()
        raise asyncio.CancelledError()

    async def mock_original_acompletion(*args, **kwargs):
        return mock_original_gen()

    # Apply the wrapper
    wrapped_stream = await wrapper_factory(
        mock_original_acompletion,
        None,
        [],
        {"model": "gpt-4", "stream": True}
    )

    # Consume the first chunk
    await anext(wrapped_stream)

    # The next call will raise CancelledError
    with pytest.raises(asyncio.CancelledError):
        await anext(wrapped_stream)

    # Check finished spans
    spans = exporter.get_finished_spans()

    # This should fail currently because spans will be 0 due to the bug
    # The span should have been closed even on cancellation/error
    assert len(spans) == 1, f"Reproduction successful: Expected 1 finished span, but got {len(spans)}"


@pytest.mark.asyncio
async def test_litellm_main_patch_missing_reproduction():
    """
    Reproduces the issue where litellm.main.acompletion is not instrumented.
    """
    import litellm.main

    # Initialize OpenLIT
    openlit.init()

    # Check if litellm.main.acompletion is instrumented via wrapt.FunctionWrapper
    is_instrumented = isinstance(litellm.main.acompletion, FunctionWrapper)

    # This should fail currently because it's not instrumented due to the bug
    assert is_instrumented, "Reproduction successful: litellm.main.acompletion is NOT instrumented by OpenLIT!"
