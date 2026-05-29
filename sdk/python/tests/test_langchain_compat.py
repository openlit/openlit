# pylint: disable=missing-class-docstring, missing-function-docstring, duplicate-code, too-few-public-methods
"""Compatibility tests for LangChain instrumentation."""

import pytest

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
from openlit.instrumentation.langchain.utils import build_input_messages


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
