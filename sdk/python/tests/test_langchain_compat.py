# pylint: disable=missing-class-docstring, missing-function-docstring, duplicate-code, too-few-public-methods
"""Compatibility tests for LangChain instrumentation."""

import logging
from uuid import uuid4

from opentelemetry import trace

import pytest
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import (
    InMemorySpanExporter,
)

try:
    from langchain_core.callbacks.manager import BaseCallbackManager
    from langchain_core.messages import HumanMessage, SystemMessage

    LANGCHAIN_CORE_AVAILABLE = True
except ImportError:
    LANGCHAIN_CORE_AVAILABLE = False
    BaseCallbackManager = None
    HumanMessage = None
    SystemMessage = None

try:
    from langchain.chat_models.base import init_chat_model

    LANGCHAIN_AVAILABLE = True
except ImportError:
    LANGCHAIN_AVAILABLE = False
    init_chat_model = None

from openlit.instrumentation.langchain import _BaseCallbackManagerInitWrapper
from openlit.instrumentation.langchain import _create_callback_handler_class
from openlit.instrumentation.langchain.utils import build_input_messages
from openlit.semcov import SemanticConvention


pytestmark = pytest.mark.skipif(
    not LANGCHAIN_CORE_AVAILABLE, reason="langchain-core not installed"
)


class TestLangChainCompatibility:
    def test_callback_manager_wrapper_injects_handler_once(self):
        class TestHandler:
            pass

        manager = BaseCallbackManager([], None, None)
        wrapper = _BaseCallbackManagerInitWrapper(TestHandler())

        wrapper(lambda *_args, **_kwargs: None, manager, (), {})
        wrapper(lambda *_args, **_kwargs: None, manager, (), {})

        matching_handlers = [
            handler
            for handler in getattr(manager, "inheritable_handlers", []) or []
            if isinstance(handler, TestHandler)
        ]

        assert len(matching_handlers) == 1

    def test_callback_manager_wrapper_respects_existing_handler(self):
        class TestHandler:
            pass

        existing_handler = TestHandler()
        manager = BaseCallbackManager([], None, None)
        manager.inheritable_handlers = [existing_handler]
        wrapper = _BaseCallbackManagerInitWrapper(TestHandler())

        wrapper(lambda *_args, **_kwargs: None, manager, (), {})

        matching_handlers = [
            handler
            for handler in getattr(manager, "inheritable_handlers", []) or []
            if isinstance(handler, TestHandler)
        ]

        assert len(matching_handlers) == 1
        assert matching_handlers[0] is existing_handler

    def test_build_input_messages_handles_langchain_core_messages(self):
        messages = [[SystemMessage(content="system"), HumanMessage(content="hello")]]

        structured_messages = build_input_messages(messages)

        assert structured_messages == [
            {"role": "system", "parts": [{"type": "text", "content": "system"}]},
            {"role": "user", "parts": [{"type": "text", "content": "hello"}]},
        ]

    @pytest.mark.skipif(not LANGCHAIN_AVAILABLE, reason="langchain not installed")
    def test_langchain_chat_model_helper_import_is_available(self):
        assert callable(init_chat_model)

    def test_chat_error_span_keeps_resolved_server_attributes(self):
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
        handler = handler_cls()
        run_id = uuid4()

        handler.on_chat_model_start(
            {"id": ["langchain", "chat_models", "openai", "ChatOpenAI"]},
            [[HumanMessage(content="hello")]],
            run_id=run_id,
            invocation_params={
                "model_name": "gpt-4o-mini",
                "openai_api_base": "http://localhost:11434/v1",
            },
        )
        handler.on_llm_error(TimeoutError("Request timed out."), run_id=run_id)

        spans = exporter.get_finished_spans()
        assert len(spans) == 1
        attrs = spans[0].attributes
        assert attrs[SemanticConvention.GEN_AI_REQUEST_MODEL] == "gpt-4o-mini"
        assert attrs[SemanticConvention.SERVER_ADDRESS] == "localhost"
        assert attrs[SemanticConvention.SERVER_PORT] == 11434
        assert attrs[SemanticConvention.ERROR_TYPE] == "TimeoutError"


try:
    from langgraph.graph import StateGraph, START, END
    from langgraph.types import interrupt, Command
    from langgraph.checkpoint.memory import InMemorySaver
    from typing_extensions import TypedDict

    LANGGRAPH_AVAILABLE = True
except ImportError:
    LANGGRAPH_AVAILABLE = False


class _InterruptState(TypedDict, total=False):
    text: str


def _interrupt_node(_state):
    interrupt({"question": "approve?"})


class TestGraphLifecycleCallbacks:
    def _handler_and_exporter(self):
        # Attach to the GLOBAL provider: when the LangGraph instrumentation is
        # active it owns the workflow span on that provider, and the handler's
        # lifecycle events land there; without it the handler owns the span on
        # whichever tracer it was built with. Reading the global provider sees
        # both arrangements.
        exporter = InMemorySpanExporter()
        provider = trace.get_tracer_provider()
        if not isinstance(provider, TracerProvider):
            provider = TracerProvider()
            trace.set_tracer_provider(provider)
        provider.add_span_processor(SimpleSpanProcessor(exporter))
        handler_cls = _create_callback_handler_class(
            provider.get_tracer("test"),
            "test-version",
            "test-env",
            "test-app",
            {},
            True,
            None,
            True,
        )
        return handler_cls(), exporter

    @pytest.mark.skipif(not LANGGRAPH_AVAILABLE, reason="langgraph not installed")
    def test_graph_interrupt_and_resume_recorded_without_errors(self, caplog):
        handler, exporter = self._handler_and_exporter()

        builder = StateGraph(_InterruptState)
        builder.add_node("human", _interrupt_node)
        builder.add_edge(START, "human")
        builder.add_edge("human", END)
        graph = builder.compile(checkpointer=InMemorySaver())
        config = {"configurable": {"thread_id": "lifecycle-test"}}

        import wrapt

        original_init = BaseCallbackManager.__init__
        wrapper = _BaseCallbackManagerInitWrapper(handler)
        wrapt.wrap_function_wrapper(
            "langchain_core.callbacks.manager",
            "BaseCallbackManager.__init__",
            wrapper,
        )
        try:
            with caplog.at_level(logging.ERROR):
                graph.invoke({"text": "hello"}, config)
                graph.invoke(Command(resume="approved"), config)
        finally:
            BaseCallbackManager.__init__ = original_init

        error_records = [
            record for record in caplog.records if record.levelno >= logging.ERROR
        ]
        assert error_records == []

        event_names = [
            event.name
            for span in exporter.get_finished_spans()
            for event in span.events
        ]
        assert "graph.interrupt" in event_names
        assert "graph.resume" in event_names
