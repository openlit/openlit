# pylint: disable=missing-class-docstring, missing-function-docstring
"""Regression tests for async LangChain callbacks (#1762).

LangChain runs the async ``on_llm_end`` / ``on_llm_error`` callbacks in a
task with a copied ``contextvars.Context`` (``@shielded`` in
``langchain_core.callbacks.manager``). Tokens created by
``on_chat_model_start`` in the caller's context cannot be detached/reset
from the copied context. The cleanup must tolerate that so the model span
is always ended and exported.
"""

import contextvars
from uuid import uuid4

import pytest
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import (
    InMemorySpanExporter,
)
from opentelemetry.trace import StatusCode

try:
    from langchain_core.messages import HumanMessage
    from langchain_core.outputs import LLMResult

    LANGCHAIN_CORE_AVAILABLE = True
except ImportError:
    LANGCHAIN_CORE_AVAILABLE = False
    HumanMessage = None
    LLMResult = None

from openlit.__helpers import (
    is_framework_llm_active,
    reset_framework_llm_active,
    set_framework_llm_active,
)
from openlit._config import OpenlitConfig
from openlit.instrumentation.langchain import _create_callback_handler_class

pytestmark = pytest.mark.skipif(
    not LANGCHAIN_CORE_AVAILABLE, reason="langchain-core not installed"
)


def _handler_and_exporter():
    OpenlitConfig.reset_to_defaults()
    exporter = InMemorySpanExporter()
    tracer_provider = TracerProvider()
    tracer_provider.add_span_processor(SimpleSpanProcessor(exporter))
    handler_cls = _create_callback_handler_class(
        tracer_provider.get_tracer("test"),
        "test-version",
        "test-env",
        "test-app",
        {},
        False,
        None,
        True,
    )
    return handler_cls(), exporter


def _start_chat_model(handler, run_id):
    handler.on_chat_model_start(
        {"id": ["langchain", "chat_models", "openai", "ChatOpenAI"]},
        [[HumanMessage(content="hello")]],
        run_id=run_id,
        invocation_params={"model_name": "gpt-4o-mini"},
    )


def test_framework_flag_reset_tolerates_foreign_context_token():
    """reset_framework_llm_active must not raise for a token from another Context."""
    token = set_framework_llm_active()
    copied = contextvars.copy_context()
    assert copied.run(is_framework_llm_active)
    try:
        copied.run(reset_framework_llm_active, token)
        assert not copied.run(is_framework_llm_active)
    finally:
        reset_framework_llm_active(token)
    assert not is_framework_llm_active()


def test_async_on_llm_end_exports_span_from_copied_context():
    """A copied-context on_llm_end (LangChain @shielded) still ends the span."""
    handler, exporter = _handler_and_exporter()
    run_id = uuid4()
    _start_chat_model(handler, run_id)

    contextvars.copy_context().run(
        handler.on_llm_end, LLMResult(generations=[[]], llm_output={}), run_id=run_id
    )

    spans = exporter.get_finished_spans()
    assert len(spans) == 1
    assert spans[0].status.status_code == StatusCode.OK


def test_async_on_llm_error_exports_error_span_from_copied_context():
    """A copied-context on_llm_error records the error status on the span."""
    handler, exporter = _handler_and_exporter()
    run_id = uuid4()
    _start_chat_model(handler, run_id)

    contextvars.copy_context().run(
        handler.on_llm_error, TimeoutError("Request timed out."), run_id=run_id
    )

    spans = exporter.get_finished_spans()
    assert len(spans) == 1
    assert spans[0].status.status_code == StatusCode.ERROR
