"""
OpenLIT LangChain Callback Handler for Hierarchical Span Creation.

This module implements a comprehensive callback handler that hooks into
LangChain's native callback system to create hierarchical spans with
proper parent-child relationships.

Features:
- Automatic span hierarchy for chains, LLMs, tools, retrievers, and agents
- Comprehensive token extraction from multiple provider formats
- Cost calculation and business intelligence metrics
- Streaming support with TTFT/TBT tracking
- Error classification and handling
"""

import time
import logging
from typing import Any, Dict, List, Optional, Union
from uuid import UUID

from opentelemetry.trace import SpanKind, StatusCode

from openlit.__helpers import (
    general_tokens,
    get_chat_model_cost,
)
from openlit.semcov import SemanticConvention
from openlit.instrumentation.langchain.utils import (
    SpanHolder,
    LangChainInstrumentationContext,
    extract_token_usage,
    extract_token_details,
    format_messages,
    calculate_streaming_metrics,
    create_span_with_context,
    end_span_safely,
    safe_json_dumps,
    classify_error,
    set_common_span_attributes,
    record_llm_metrics,
    record_workflow_metrics,
)

# Initialize logger
logger = logging.getLogger(__name__)

# Try to import LangChain types
try:
    from langchain_core.callbacks import BaseCallbackHandler
    from langchain_core.messages import BaseMessage
    from langchain_core.outputs import LLMResult, ChatGeneration, Generation

    LANGCHAIN_AVAILABLE = True
except ImportError:
    # Create dummy classes for type hints when LangChain is not installed
    class BaseCallbackHandler:
        """Dummy BaseCallbackHandler when LangChain is not available."""

        pass

    class BaseMessage:
        """Dummy BaseMessage when LangChain is not available."""

        pass

    class LLMResult:
        """Dummy LLMResult when LangChain is not available."""

        pass

    class ChatGeneration:
        """Dummy ChatGeneration when LangChain is not available."""

        pass

    class Generation:
        """Dummy Generation when LangChain is not available."""

        pass

    LANGCHAIN_AVAILABLE = False


class OpenLITLangChainCallbackHandler(BaseCallbackHandler):
    """
    OpenLIT callback handler for comprehensive LangChain instrumentation.

    This handler creates hierarchical spans for all LangChain operations
    with proper parent-child relationships, token tracking, cost calculation,
    and comprehensive metrics.
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
        Initialize the callback handler.

        Args:
            tracer: OpenTelemetry tracer instance
            version: SDK version string
            environment: Environment name (e.g., "production", "development")
            application_name: Application name for telemetry
            pricing_info: Pricing information for cost calculation
            capture_message_content: Whether to capture message content
            metrics: Metrics dictionary for recording metrics
            disable_metrics: Whether to disable metrics recording
        """
        super().__init__()
        self.tracer = tracer
        self.version = version
        self.environment = environment
        self.application_name = application_name
        self.pricing_info = pricing_info
        self.capture_message_content = capture_message_content
        self.metrics = metrics
        self.disable_metrics = disable_metrics

        # Track active spans by run_id
        self.spans: Dict[UUID, SpanHolder] = {}

    # =========================================================================
    # Required BaseCallbackHandler properties
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
    # Helper methods
    # =========================================================================

    def _get_span_name(
        self, serialized: Optional[Dict[str, Any]], operation_type: str
    ) -> str:
        """
        Generate OpenLIT-style span names following naming convention.

        Format: {operation_type} {component_name}
        """
        if not serialized:
            return f"{operation_type} RunnableSequence"

        # Extract class name for component identification
        if "id" in serialized and serialized["id"]:
            component_name = serialized["id"][-1]
        elif "name" in serialized:
            component_name = serialized["name"]
        else:
            component_name = "unknown"

        return f"{operation_type} {component_name}"

    def _create_span(
        self,
        run_id: UUID,
        parent_run_id: Optional[UUID],
        span_name: str,
        kind: SpanKind = SpanKind.CLIENT,
    ) -> None:
        """Create a span with proper parent-child relationship."""
        span, context_token = create_span_with_context(
            self.tracer, span_name, parent_run_id, self.spans, kind
        )

        # Store span holder
        start_time = time.time()
        self.spans[run_id] = SpanHolder(span, start_time, context_token)

        # Track parent-child relationship
        if parent_run_id and parent_run_id in self.spans:
            self.spans[parent_run_id].children.append(run_id)

    def _end_span(
        self,
        run_id: UUID,
        status: StatusCode = StatusCode.OK,
        error: Optional[Exception] = None,
    ) -> Optional[float]:
        """End span and return duration."""
        return end_span_safely(run_id, self.spans, status, error)

    # =========================================================================
    # LLM Callbacks
    # =========================================================================

    def on_llm_start(
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
        """Called when a non-chat LLM starts (text completion models)."""
        try:
            ctx = LangChainInstrumentationContext(
                serialized,
                kwargs,
                self.version,
                self.environment,
                self.application_name,
            )

            span_name = f"chat {ctx.model_name}"
            self._create_span(run_id, parent_run_id, span_name, SpanKind.CLIENT)

            span = self.spans[run_id].span

            # Set common attributes
            set_common_span_attributes(
                span,
                SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
                self.environment,
                self.application_name,
                self.version,
                ctx.model_name,
                ctx.provider,
            )

            # Capture prompts
            if self.capture_message_content and prompts:
                prompt_str = "\n".join(prompts)
                span.set_attribute(SemanticConvention.GEN_AI_CONTENT_PROMPT, prompt_str)
                # Calculate input tokens
                input_tokens = general_tokens(prompt_str)
                span.set_attribute(
                    SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS, input_tokens
                )

            # Set streaming flag
            span.set_attribute(
                SemanticConvention.GEN_AI_REQUEST_IS_STREAM, ctx.is_streaming
            )

        except Exception as e:
            logger.debug("Error in on_llm_start: %s", e)

    def on_chat_model_start(
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
        """Called when a chat model starts."""
        try:
            ctx = LangChainInstrumentationContext(
                serialized,
                kwargs,
                self.version,
                self.environment,
                self.application_name,
            )

            span_name = f"chat {ctx.model_name}"
            self._create_span(run_id, parent_run_id, span_name, SpanKind.CLIENT)

            span = self.spans[run_id].span

            # Set common attributes
            set_common_span_attributes(
                span,
                SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
                self.environment,
                self.application_name,
                self.version,
                ctx.model_name,
                ctx.provider,
            )

            # Process messages
            if messages and messages[0]:
                formatted_messages = format_messages(messages[0])

                if self.capture_message_content:
                    span.set_attribute(
                        SemanticConvention.GEN_AI_CONTENT_PROMPT, formatted_messages
                    )

                # Calculate input tokens
                input_tokens = general_tokens(formatted_messages)
                span.set_attribute(
                    SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS, input_tokens
                )

            # Set streaming flag
            span.set_attribute(
                SemanticConvention.GEN_AI_REQUEST_IS_STREAM, ctx.is_streaming
            )

        except Exception as e:
            logger.debug("Error in on_chat_model_start: %s", e)

    def on_llm_new_token(
        self,
        token: str,
        *,
        chunk: Optional[Any] = None,
        run_id: UUID,
        parent_run_id: Optional[UUID] = None,
        **kwargs: Any,
    ) -> None:
        """Called when a new token is generated during streaming."""
        try:
            if run_id not in self.spans:
                return

            span_holder = self.spans[run_id]
            current_time = time.time()

            # Track first token time for TTFT
            if span_holder.first_token_time is None:
                span_holder.first_token_time = current_time

            # Track token timestamps for TBT
            span_holder.token_timestamps.append(current_time)

            # Accumulate streaming content
            if token:
                span_holder.streaming_content.append(token)

        except Exception as e:
            logger.debug("Error in on_llm_new_token: %s", e)

    def on_llm_end(
        self,
        response: LLMResult,
        *,
        run_id: UUID,
        parent_run_id: Optional[UUID] = None,
        **kwargs: Any,
    ) -> None:
        """Called when an LLM/chat model call ends."""
        try:
            if run_id not in self.spans:
                return

            span_holder = self.spans[run_id]
            span = span_holder.span
            end_time = time.time()

            # Process streaming content if available
            if span_holder.streaming_content:
                complete_response = "".join(span_holder.streaming_content)
                if self.capture_message_content:
                    span.set_attribute(
                        SemanticConvention.GEN_AI_CONTENT_COMPLETION, complete_response
                    )
                output_tokens = general_tokens(complete_response)
                span.set_attribute(
                    SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS, output_tokens
                )

            # Extract completion content from response
            completion_content = ""
            if response.generations and response.generations[0]:
                generation = response.generations[0][0]

                if isinstance(generation, ChatGeneration):
                    completion_content = generation.message.content
                elif isinstance(generation, Generation):
                    completion_content = generation.text
                else:
                    completion_content = str(generation)

                if self.capture_message_content and not span_holder.streaming_content:
                    span.set_attribute(
                        SemanticConvention.GEN_AI_CONTENT_COMPLETION, completion_content
                    )

            # Extract token usage from response
            input_tokens, output_tokens, total_tokens = extract_token_usage(response)

            # If no tokens from response, estimate from content
            if output_tokens == 0 and completion_content:
                output_tokens = general_tokens(completion_content)

            # Get input tokens from span if not in response
            if input_tokens == 0:
                input_tokens = span.attributes.get(
                    SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS, 0
                )

            # Set token attributes
            if input_tokens > 0:
                span.set_attribute(
                    SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS, input_tokens
                )
            if output_tokens > 0:
                span.set_attribute(
                    SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS, output_tokens
                )
            if total_tokens > 0:
                span.set_attribute(
                    SemanticConvention.GEN_AI_USAGE_TOTAL_TOKENS, total_tokens
                )

            # Extract and set token details
            token_details = extract_token_details(response)
            for key, value in token_details.items():
                if key == "reasoning_tokens":
                    span.set_attribute(
                        SemanticConvention.GEN_AI_USAGE_COMPLETION_TOKENS_DETAILS_REASONING,
                        value,
                    )
                elif key in ("cached_tokens", "cache_read_tokens"):
                    span.set_attribute(
                        SemanticConvention.GEN_AI_USAGE_PROMPT_TOKENS_DETAILS_CACHE_READ,
                        value,
                    )
                elif key == "cache_write_tokens":
                    span.set_attribute(
                        SemanticConvention.GEN_AI_USAGE_PROMPT_TOKENS_DETAILS_CACHE_WRITE,
                        value,
                    )

            # Extract model name from response if available
            model_name = span.attributes.get(
                SemanticConvention.GEN_AI_REQUEST_MODEL, "unknown"
            )
            if (
                hasattr(response, "llm_output")
                and response.llm_output
                and "model_name" in response.llm_output
            ):
                model_name = response.llm_output["model_name"]
                span.set_attribute(SemanticConvention.GEN_AI_RESPONSE_MODEL, model_name)

            # Calculate cost
            cost = 0.0
            if input_tokens > 0 and output_tokens > 0:
                cost = get_chat_model_cost(
                    model_name, self.pricing_info, input_tokens, output_tokens
                )
                span.set_attribute(SemanticConvention.GEN_AI_USAGE_COST, cost)

            # Calculate streaming metrics
            ttft, tbt = calculate_streaming_metrics(span_holder)

            # Record metrics
            record_llm_metrics(
                self.metrics,
                self.disable_metrics,
                self.environment,
                self.application_name,
                model_name,
                span_holder.start_time,
                end_time,
                input_tokens,
                output_tokens,
                cost,
                ttft,
                tbt,
            )

            # End span
            self._end_span(run_id)

        except Exception as e:
            logger.debug("Error in on_llm_end: %s", e)
            self._end_span(run_id)

    def on_llm_error(
        self,
        error: Union[Exception, KeyboardInterrupt],
        *,
        run_id: UUID,
        parent_run_id: Optional[UUID] = None,
        **kwargs: Any,
    ) -> None:
        """Called when an LLM call ends with an error."""
        try:
            if run_id not in self.spans:
                return

            span = self.spans[run_id].span

            # Classify and record error
            error_class = classify_error(error)
            span.set_attribute(
                SemanticConvention.GEN_AI_FRAMEWORK_ERROR_CLASS, error_class
            )
            span.set_attribute(
                SemanticConvention.GEN_AI_FRAMEWORK_ERROR_TYPE, type(error).__name__
            )
            span.set_attribute(
                SemanticConvention.GEN_AI_FRAMEWORK_ERROR_MESSAGE, str(error)
            )

            self._end_span(run_id, StatusCode.ERROR, error)

        except Exception as e:
            logger.debug("Error in on_llm_error: %s", e)
            self._end_span(run_id, StatusCode.ERROR)

    # =========================================================================
    # Chain Callbacks
    # =========================================================================

    def on_chain_start(
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
        """Called when a chain (RunnableSequence, etc.) starts."""
        try:
            span_name = self._get_span_name(serialized, "workflow")
            self._create_span(run_id, parent_run_id, span_name, SpanKind.INTERNAL)

            span = self.spans[run_id].span

            # Set common attributes
            set_common_span_attributes(
                span,
                SemanticConvention.GEN_AI_OPERATION_TYPE_FRAMEWORK,
                self.environment,
                self.application_name,
                self.version,
            )

            # Set workflow type
            if serialized and "id" in serialized and serialized["id"]:
                span.set_attribute(
                    SemanticConvention.GEN_AI_WORKFLOW_TYPE, serialized["id"][-1]
                )
            else:
                span.set_attribute(
                    SemanticConvention.GEN_AI_WORKFLOW_TYPE, "RunnableSequence"
                )

            # Capture input
            if self.capture_message_content and inputs:
                input_str = safe_json_dumps(inputs)
                span.set_attribute(SemanticConvention.GEN_AI_WORKFLOW_INPUT, input_str)

        except Exception as e:
            logger.debug("Error in on_chain_start: %s", e)

    def on_chain_end(
        self,
        outputs: Dict[str, Any],
        *,
        run_id: UUID,
        parent_run_id: Optional[UUID] = None,
        **kwargs: Any,
    ) -> None:
        """Called when a chain ends."""
        try:
            if run_id not in self.spans:
                return

            span_holder = self.spans[run_id]
            span = span_holder.span
            end_time = time.time()

            # Capture output
            if self.capture_message_content and outputs:
                output_str = safe_json_dumps(outputs)
                span.set_attribute(
                    SemanticConvention.GEN_AI_WORKFLOW_OUTPUT, output_str
                )

            # Record metrics
            record_workflow_metrics(
                self.metrics,
                self.disable_metrics,
                self.environment,
                self.application_name,
                SemanticConvention.GEN_AI_OPERATION_TYPE_FRAMEWORK,
                span_holder.start_time,
                end_time,
            )

            self._end_span(run_id)

        except Exception as e:
            logger.debug("Error in on_chain_end: %s", e)
            self._end_span(run_id)

    def on_chain_error(
        self,
        error: Union[Exception, KeyboardInterrupt],
        *,
        run_id: UUID,
        parent_run_id: Optional[UUID] = None,
        **kwargs: Any,
    ) -> None:
        """Called when a chain ends with an error."""
        try:
            if run_id not in self.spans:
                return

            span = self.spans[run_id].span

            # Classify and record error
            error_class = classify_error(error)
            span.set_attribute(
                SemanticConvention.GEN_AI_FRAMEWORK_ERROR_CLASS, error_class
            )
            span.set_attribute(
                SemanticConvention.GEN_AI_FRAMEWORK_ERROR_TYPE, type(error).__name__
            )
            span.set_attribute(
                SemanticConvention.GEN_AI_FRAMEWORK_ERROR_MESSAGE, str(error)
            )

            self._end_span(run_id, StatusCode.ERROR, error)

        except Exception as e:
            logger.debug("Error in on_chain_error: %s", e)
            self._end_span(run_id, StatusCode.ERROR)

    # =========================================================================
    # Tool Callbacks
    # =========================================================================

    def on_tool_start(
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
        """Called when a tool starts."""
        try:
            span_name = self._get_span_name(serialized, "tool")
            self._create_span(run_id, parent_run_id, span_name, SpanKind.CLIENT)

            span = self.spans[run_id].span

            # Set common attributes
            set_common_span_attributes(
                span,
                SemanticConvention.GEN_AI_OPERATION_TYPE_TOOLS,
                self.environment,
                self.application_name,
                self.version,
            )

            # Set tool name
            tool_name = "unknown"
            if serialized:
                tool_name = (
                    serialized.get("name") or serialized.get("id", ["unknown"])[-1]
                )
            span.set_attribute(SemanticConvention.GEN_AI_TOOL_NAME, tool_name)

            # Capture input
            if self.capture_message_content and input_str:
                span.set_attribute(SemanticConvention.GEN_AI_TOOL_INPUT, str(input_str))

        except Exception as e:
            logger.debug("Error in on_tool_start: %s", e)

    def on_tool_end(
        self,
        output: Any,
        *,
        run_id: UUID,
        parent_run_id: Optional[UUID] = None,
        **kwargs: Any,
    ) -> None:
        """Called when a tool ends."""
        try:
            if run_id not in self.spans:
                return

            span_holder = self.spans[run_id]
            span = span_holder.span
            end_time = time.time()

            # Capture output
            if self.capture_message_content and output:
                span.set_attribute(SemanticConvention.GEN_AI_TOOL_OUTPUT, str(output))

            # Record metrics
            record_workflow_metrics(
                self.metrics,
                self.disable_metrics,
                self.environment,
                self.application_name,
                SemanticConvention.GEN_AI_OPERATION_TYPE_TOOLS,
                span_holder.start_time,
                end_time,
            )

            self._end_span(run_id)

        except Exception as e:
            logger.debug("Error in on_tool_end: %s", e)
            self._end_span(run_id)

    def on_tool_error(
        self,
        error: Union[Exception, KeyboardInterrupt],
        *,
        run_id: UUID,
        parent_run_id: Optional[UUID] = None,
        **kwargs: Any,
    ) -> None:
        """Called when a tool ends with an error."""
        try:
            if run_id not in self.spans:
                return

            span = self.spans[run_id].span

            error_class = classify_error(error)
            span.set_attribute(
                SemanticConvention.GEN_AI_FRAMEWORK_ERROR_CLASS, error_class
            )
            span.set_attribute(
                SemanticConvention.GEN_AI_FRAMEWORK_ERROR_TYPE, type(error).__name__
            )
            span.set_attribute(
                SemanticConvention.GEN_AI_FRAMEWORK_ERROR_MESSAGE, str(error)
            )

            self._end_span(run_id, StatusCode.ERROR, error)

        except Exception as e:
            logger.debug("Error in on_tool_error: %s", e)
            self._end_span(run_id, StatusCode.ERROR)

    # =========================================================================
    # Retriever Callbacks
    # =========================================================================

    def on_retriever_start(
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
        """Called when a retriever starts."""
        try:
            span_name = self._get_span_name(serialized, "retrieval")
            self._create_span(run_id, parent_run_id, span_name, SpanKind.CLIENT)

            span = self.spans[run_id].span

            # Set common attributes
            set_common_span_attributes(
                span,
                SemanticConvention.GEN_AI_OPERATION_TYPE_RETRIEVE,
                self.environment,
                self.application_name,
                self.version,
            )

            # Capture query
            if self.capture_message_content and query:
                span.set_attribute(
                    SemanticConvention.GEN_AI_RETRIEVAL_QUERY, str(query)
                )

        except Exception as e:
            logger.debug("Error in on_retriever_start: %s", e)

    def on_retriever_end(
        self,
        documents: List[Any],
        *,
        run_id: UUID,
        parent_run_id: Optional[UUID] = None,
        **kwargs: Any,
    ) -> None:
        """Called when a retriever ends."""
        try:
            if run_id not in self.spans:
                return

            span_holder = self.spans[run_id]
            span = span_holder.span
            end_time = time.time()

            # Document count
            doc_count = len(documents) if documents else 0
            span.set_attribute(
                SemanticConvention.GEN_AI_RETRIEVAL_DOCUMENT_COUNT, doc_count
            )

            # Capture document content
            if self.capture_message_content and documents:
                sample_docs = []
                for doc in documents[:3]:  # First 3 docs
                    if hasattr(doc, "page_content"):
                        sample_docs.append(doc.page_content[:500])
                    else:
                        sample_docs.append(str(doc)[:500])
                span.set_attribute(
                    SemanticConvention.GEN_AI_RETRIEVAL_DOCUMENTS,
                    "; ".join(sample_docs),
                )

            # Record metrics
            record_workflow_metrics(
                self.metrics,
                self.disable_metrics,
                self.environment,
                self.application_name,
                SemanticConvention.GEN_AI_OPERATION_TYPE_RETRIEVE,
                span_holder.start_time,
                end_time,
            )

            self._end_span(run_id)

        except Exception as e:
            logger.debug("Error in on_retriever_end: %s", e)
            self._end_span(run_id)

    def on_retriever_error(
        self,
        error: Union[Exception, KeyboardInterrupt],
        *,
        run_id: UUID,
        parent_run_id: Optional[UUID] = None,
        **kwargs: Any,
    ) -> None:
        """Called when a retriever ends with an error."""
        try:
            if run_id not in self.spans:
                return

            span = self.spans[run_id].span

            error_class = classify_error(error)
            span.set_attribute(
                SemanticConvention.GEN_AI_FRAMEWORK_ERROR_CLASS, error_class
            )
            span.set_attribute(
                SemanticConvention.GEN_AI_FRAMEWORK_ERROR_TYPE, type(error).__name__
            )
            span.set_attribute(
                SemanticConvention.GEN_AI_FRAMEWORK_ERROR_MESSAGE, str(error)
            )

            self._end_span(run_id, StatusCode.ERROR, error)

        except Exception as e:
            logger.debug("Error in on_retriever_error: %s", e)
            self._end_span(run_id, StatusCode.ERROR)

    # =========================================================================
    # Agent Callbacks
    # =========================================================================

    def on_agent_action(
        self,
        action: Any,
        *,
        run_id: UUID,
        parent_run_id: Optional[UUID] = None,
        **kwargs: Any,
    ) -> None:
        """Called when an agent takes an action."""
        try:
            tool_name = getattr(action, "tool", "unknown")
            span_name = f"agent_action {tool_name}"
            self._create_span(run_id, parent_run_id, span_name, SpanKind.CLIENT)

            span = self.spans[run_id].span

            # Set common attributes
            set_common_span_attributes(
                span,
                SemanticConvention.GEN_AI_OPERATION_TYPE_AGENT,
                self.environment,
                self.application_name,
                self.version,
            )

            # Capture action details
            if hasattr(action, "tool"):
                span.set_attribute(
                    SemanticConvention.GEN_AI_AGENT_ACTION_TOOL, action.tool
                )

            if hasattr(action, "tool_input") and self.capture_message_content:
                tool_input_str = safe_json_dumps(action.tool_input)
                span.set_attribute(
                    SemanticConvention.GEN_AI_AGENT_ACTION_TOOL_INPUT, tool_input_str
                )

            if hasattr(action, "log") and self.capture_message_content:
                span.set_attribute(
                    SemanticConvention.GEN_AI_AGENT_ACTION_LOG, str(action.log)
                )

        except Exception as e:
            logger.debug("Error in on_agent_action: %s", e)

    def on_agent_finish(
        self,
        finish: Any,
        *,
        run_id: UUID,
        parent_run_id: Optional[UUID] = None,
        **kwargs: Any,
    ) -> None:
        """Called when an agent finishes."""
        try:
            if run_id not in self.spans:
                return

            span = self.spans[run_id].span

            # Capture finish output
            if hasattr(finish, "return_values") and self.capture_message_content:
                output_str = safe_json_dumps(finish.return_values)
                span.set_attribute(
                    SemanticConvention.GEN_AI_AGENT_FINISH_OUTPUT, output_str
                )

            if hasattr(finish, "log") and self.capture_message_content:
                span.set_attribute(
                    SemanticConvention.GEN_AI_AGENT_FINISH_LOG, str(finish.log)
                )

            self._end_span(run_id)

        except Exception as e:
            logger.debug("Error in on_agent_finish: %s", e)
            self._end_span(run_id)

    # =========================================================================
    # Additional Callbacks
    # =========================================================================

    def on_text(
        self,
        text: str,
        *,
        run_id: UUID,
        parent_run_id: Optional[UUID] = None,
        **kwargs: Any,
    ) -> None:
        """Called on arbitrary text output."""
        # Skip text events to reduce noise
        pass

    def on_retry(
        self,
        retry_state: Any,
        *,
        run_id: UUID,
        parent_run_id: Optional[UUID] = None,
        **kwargs: Any,
    ) -> None:
        """Called on retry events."""
        try:
            if run_id not in self.spans:
                return

            span = self.spans[run_id].span
            attempt = getattr(retry_state, "attempt_number", "unknown")
            span.add_event("retry", {"attempt": str(attempt)})

        except Exception as e:
            logger.debug("Error in on_retry: %s", e)

    def on_custom_event(
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
        try:
            if run_id not in self.spans:
                return

            span = self.spans[run_id].span

            event_data = {"name": name}
            if self.capture_message_content:
                event_data["data"] = safe_json_dumps(data)[:500]

            span.add_event(f"custom_event.{name}", event_data)

        except Exception as e:
            logger.debug("Error in on_custom_event: %s", e)
