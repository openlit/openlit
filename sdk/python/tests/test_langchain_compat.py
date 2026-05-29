# pylint: disable=missing-class-docstring, missing-function-docstring, duplicate-code, too-few-public-methods
"""Compatibility tests for LangChain instrumentation."""

from uuid import uuid4

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
