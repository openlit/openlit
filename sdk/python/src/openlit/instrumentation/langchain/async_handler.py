"""
OpenLIT LangChain Async Callback Handler.

This module provides an async-aware callback handler that extends
the base callback handler with proper async context handling.

The async handler is used for async LangChain operations like:
- ainvoke()
- astream()
- abatch()
"""

import logging
from typing import Any, Dict, List, Optional, Union
from uuid import UUID

from openlit.instrumentation.langchain.callback_handler import (
    OpenLITLangChainCallbackHandler,
)

# Initialize logger
logger = logging.getLogger(__name__)

# Try to import LangChain async callback handler
try:
    from langchain_core.callbacks import AsyncCallbackHandler
    from langchain_core.messages import BaseMessage
    from langchain_core.outputs import LLMResult

    LANGCHAIN_ASYNC_AVAILABLE = True
except ImportError:
    # Create dummy class when LangChain is not available
    class AsyncCallbackHandler:
        """Dummy AsyncCallbackHandler when LangChain is not available."""

        pass

    class BaseMessage:
        """Dummy BaseMessage when LangChain is not available."""

        pass

    class LLMResult:
        """Dummy LLMResult when LangChain is not available."""

        pass

    LANGCHAIN_ASYNC_AVAILABLE = False


class OpenLITAsyncLangChainCallbackHandler(AsyncCallbackHandler):
    """
    Async callback handler for LangChain operations.

    This handler extends AsyncCallbackHandler to properly handle
    async operations with correct context propagation.
    """

    def __init__(
        self,
        tracer,
        version: str,
        environment: str,
        application_name: str,
        pricing_info: Dict,
        capture_message_content: bool,
        metrics: Optional[Dict],
        disable_metrics: bool,
    ):
        """
        Initialize the async callback handler.

        Args:
            tracer: OpenTelemetry tracer instance
            version: SDK version string
            environment: Environment name
            application_name: Application name for telemetry
            pricing_info: Pricing information for cost calculation
            capture_message_content: Whether to capture message content
            metrics: Metrics dictionary
            disable_metrics: Whether to disable metrics
        """
        super().__init__()

        # Create a sync handler for shared functionality
        self._sync_handler = OpenLITLangChainCallbackHandler(
            tracer=tracer,
            version=version,
            environment=environment,
            application_name=application_name,
            pricing_info=pricing_info,
            capture_message_content=capture_message_content,
            metrics=metrics,
            disable_metrics=disable_metrics,
        )

        # Expose shared properties
        self.tracer = tracer
        self.version = version
        self.environment = environment
        self.application_name = application_name
        self.pricing_info = pricing_info
        self.capture_message_content = capture_message_content
        self.metrics = metrics
        self.disable_metrics = disable_metrics
        self.spans = self._sync_handler.spans

    # =========================================================================
    # Required properties
    # =========================================================================

    @property
    def raise_error(self) -> bool:
        """Should the handler raise errors instead of logging them."""
        return False

    @property
    def run_inline(self) -> bool:
        """Should the handler run inline with the main thread."""
        return True

    @property
    def ignore_llm(self) -> bool:
        """Whether to ignore LLM callbacks."""
        return False

    @property
    def ignore_chain(self) -> bool:
        """Whether to ignore chain callbacks."""
        return False

    @property
    def ignore_agent(self) -> bool:
        """Whether to ignore agent callbacks."""
        return False

    @property
    def ignore_retriever(self) -> bool:
        """Whether to ignore retriever callbacks."""
        return False

    @property
    def ignore_chat_model(self) -> bool:
        """Whether to ignore chat model callbacks."""
        return False

    # =========================================================================
    # Async LLM Callbacks - Delegate to sync handler
    # =========================================================================

    async def on_llm_start(
        self,
        serialized: Dict[str, Any],
        prompts: List[str],
        *,
        run_id: UUID,
        parent_run_id: Optional[UUID] = None,
        tags: Optional[List[str]] = None,
        metadata: Optional[Dict[str, Any]] = None,
        **kwargs: Any,
    ) -> None:
        """Called when an async LLM starts."""
        self._sync_handler.on_llm_start(
            serialized,
            prompts,
            run_id=run_id,
            parent_run_id=parent_run_id,
            tags=tags,
            metadata=metadata,
            **kwargs,
        )

    async def on_chat_model_start(
        self,
        serialized: Dict[str, Any],
        messages: List[List[BaseMessage]],
        *,
        run_id: UUID,
        parent_run_id: Optional[UUID] = None,
        tags: Optional[List[str]] = None,
        metadata: Optional[Dict[str, Any]] = None,
        **kwargs: Any,
    ) -> None:
        """Called when an async chat model starts."""
        self._sync_handler.on_chat_model_start(
            serialized,
            messages,
            run_id=run_id,
            parent_run_id=parent_run_id,
            tags=tags,
            metadata=metadata,
            **kwargs,
        )

    async def on_llm_new_token(
        self,
        token: str,
        *,
        chunk: Optional[Any] = None,
        run_id: UUID,
        parent_run_id: Optional[UUID] = None,
        **kwargs: Any,
    ) -> None:
        """Called when a new token is generated during async streaming."""
        self._sync_handler.on_llm_new_token(
            token,
            chunk=chunk,
            run_id=run_id,
            parent_run_id=parent_run_id,
            **kwargs,
        )

    async def on_llm_end(
        self,
        response: LLMResult,
        *,
        run_id: UUID,
        parent_run_id: Optional[UUID] = None,
        **kwargs: Any,
    ) -> None:
        """Called when an async LLM call ends."""
        self._sync_handler.on_llm_end(
            response,
            run_id=run_id,
            parent_run_id=parent_run_id,
            **kwargs,
        )

    async def on_llm_error(
        self,
        error: Union[Exception, KeyboardInterrupt],
        *,
        run_id: UUID,
        parent_run_id: Optional[UUID] = None,
        **kwargs: Any,
    ) -> None:
        """Called when an async LLM call ends with an error."""
        self._sync_handler.on_llm_error(
            error,
            run_id=run_id,
            parent_run_id=parent_run_id,
            **kwargs,
        )

    # =========================================================================
    # Async Chain Callbacks
    # =========================================================================

    async def on_chain_start(
        self,
        serialized: Dict[str, Any],
        inputs: Dict[str, Any],
        *,
        run_id: UUID,
        parent_run_id: Optional[UUID] = None,
        tags: Optional[List[str]] = None,
        metadata: Optional[Dict[str, Any]] = None,
        **kwargs: Any,
    ) -> None:
        """Called when an async chain starts."""
        self._sync_handler.on_chain_start(
            serialized,
            inputs,
            run_id=run_id,
            parent_run_id=parent_run_id,
            tags=tags,
            metadata=metadata,
            **kwargs,
        )

    async def on_chain_end(
        self,
        outputs: Dict[str, Any],
        *,
        run_id: UUID,
        parent_run_id: Optional[UUID] = None,
        **kwargs: Any,
    ) -> None:
        """Called when an async chain ends."""
        self._sync_handler.on_chain_end(
            outputs,
            run_id=run_id,
            parent_run_id=parent_run_id,
            **kwargs,
        )

    async def on_chain_error(
        self,
        error: Union[Exception, KeyboardInterrupt],
        *,
        run_id: UUID,
        parent_run_id: Optional[UUID] = None,
        **kwargs: Any,
    ) -> None:
        """Called when an async chain ends with an error."""
        self._sync_handler.on_chain_error(
            error,
            run_id=run_id,
            parent_run_id=parent_run_id,
            **kwargs,
        )

    # =========================================================================
    # Async Tool Callbacks
    # =========================================================================

    async def on_tool_start(
        self,
        serialized: Dict[str, Any],
        input_str: str,
        *,
        run_id: UUID,
        parent_run_id: Optional[UUID] = None,
        tags: Optional[List[str]] = None,
        metadata: Optional[Dict[str, Any]] = None,
        **kwargs: Any,
    ) -> None:
        """Called when an async tool starts."""
        self._sync_handler.on_tool_start(
            serialized,
            input_str,
            run_id=run_id,
            parent_run_id=parent_run_id,
            tags=tags,
            metadata=metadata,
            **kwargs,
        )

    async def on_tool_end(
        self,
        output: Any,
        *,
        run_id: UUID,
        parent_run_id: Optional[UUID] = None,
        **kwargs: Any,
    ) -> None:
        """Called when an async tool ends."""
        self._sync_handler.on_tool_end(
            output,
            run_id=run_id,
            parent_run_id=parent_run_id,
            **kwargs,
        )

    async def on_tool_error(
        self,
        error: Union[Exception, KeyboardInterrupt],
        *,
        run_id: UUID,
        parent_run_id: Optional[UUID] = None,
        **kwargs: Any,
    ) -> None:
        """Called when an async tool ends with an error."""
        self._sync_handler.on_tool_error(
            error,
            run_id=run_id,
            parent_run_id=parent_run_id,
            **kwargs,
        )

    # =========================================================================
    # Async Retriever Callbacks
    # =========================================================================

    async def on_retriever_start(
        self,
        serialized: Dict[str, Any],
        query: str,
        *,
        run_id: UUID,
        parent_run_id: Optional[UUID] = None,
        tags: Optional[List[str]] = None,
        metadata: Optional[Dict[str, Any]] = None,
        **kwargs: Any,
    ) -> None:
        """Called when an async retriever starts."""
        self._sync_handler.on_retriever_start(
            serialized,
            query,
            run_id=run_id,
            parent_run_id=parent_run_id,
            tags=tags,
            metadata=metadata,
            **kwargs,
        )

    async def on_retriever_end(
        self,
        documents: List[Any],
        *,
        run_id: UUID,
        parent_run_id: Optional[UUID] = None,
        **kwargs: Any,
    ) -> None:
        """Called when an async retriever ends."""
        self._sync_handler.on_retriever_end(
            documents,
            run_id=run_id,
            parent_run_id=parent_run_id,
            **kwargs,
        )

    async def on_retriever_error(
        self,
        error: Union[Exception, KeyboardInterrupt],
        *,
        run_id: UUID,
        parent_run_id: Optional[UUID] = None,
        **kwargs: Any,
    ) -> None:
        """Called when an async retriever ends with an error."""
        self._sync_handler.on_retriever_error(
            error,
            run_id=run_id,
            parent_run_id=parent_run_id,
            **kwargs,
        )

    # =========================================================================
    # Async Agent Callbacks
    # =========================================================================

    async def on_agent_action(
        self,
        action: Any,
        *,
        run_id: UUID,
        parent_run_id: Optional[UUID] = None,
        **kwargs: Any,
    ) -> None:
        """Called when an async agent takes an action."""
        self._sync_handler.on_agent_action(
            action,
            run_id=run_id,
            parent_run_id=parent_run_id,
            **kwargs,
        )

    async def on_agent_finish(
        self,
        finish: Any,
        *,
        run_id: UUID,
        parent_run_id: Optional[UUID] = None,
        **kwargs: Any,
    ) -> None:
        """Called when an async agent finishes."""
        self._sync_handler.on_agent_finish(
            finish,
            run_id=run_id,
            parent_run_id=parent_run_id,
            **kwargs,
        )

    # =========================================================================
    # Additional Async Callbacks
    # =========================================================================

    async def on_text(
        self,
        text: str,
        *,
        run_id: UUID,
        parent_run_id: Optional[UUID] = None,
        **kwargs: Any,
    ) -> None:
        """Called on arbitrary text output."""
        self._sync_handler.on_text(
            text,
            run_id=run_id,
            parent_run_id=parent_run_id,
            **kwargs,
        )

    async def on_retry(
        self,
        retry_state: Any,
        *,
        run_id: UUID,
        parent_run_id: Optional[UUID] = None,
        **kwargs: Any,
    ) -> None:
        """Called on retry events."""
        self._sync_handler.on_retry(
            retry_state,
            run_id=run_id,
            parent_run_id=parent_run_id,
            **kwargs,
        )

    async def on_custom_event(
        self,
        name: str,
        data: Any,
        *,
        run_id: UUID,
        tags: Optional[List[str]] = None,
        metadata: Optional[Dict[str, Any]] = None,
        **kwargs: Any,
    ) -> None:
        """Called for custom user-defined events."""
        self._sync_handler.on_custom_event(
            name,
            data,
            run_id=run_id,
            tags=tags,
            metadata=metadata,
            **kwargs,
        )
