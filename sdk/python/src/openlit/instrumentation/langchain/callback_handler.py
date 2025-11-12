"""
OpenLIT LangChain Callback Handler for Hierarchical Span Creation
"""

import time
import json
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from uuid import UUID

from langchain_core.callbacks import BaseCallbackHandler
from langchain_core.messages import BaseMessage
from langchain_core.outputs import LLMResult, ChatGeneration, Generation

from opentelemetry import context as context_api
from opentelemetry.trace import SpanKind, set_span_in_context, Status, StatusCode
from opentelemetry.trace.span import Span

from openlit.__helpers import (
    common_framework_span_attributes,
    handle_exception,
    get_chat_model_cost,
    general_tokens,
)
from openlit.semcov import SemanticConvention

# Enhanced Provider Mapping (inspired by OpenInference)
LANGCHAIN_PROVIDER_MAP = {
    "anthropic": "anthropic",
    "azure": "azure",
    "azure_ai": "azure",
    "azure_openai": "azure",
    "bedrock": "aws",
    "bedrock_converse": "aws",
    "cohere": "cohere",
    "deepseek": "deepseek",
    "fireworks": "fireworks",
    "google": "google",
    "google_anthropic_vertex": "google",
    "google_genai": "google",
    "google_vertexai": "google",
    "groq": "groq",
    "huggingface": "huggingface",
    "ibm": "ibm",
    "mistralai": "mistralai",
    "nvidia": "nvidia",
    "ollama": "ollama",
    "openai": "openai",
    "perplexity": "perplexity",
    "together": "together",
    "vertex": "google",
    "vertexai": "google",
    "xai": "xai",
}


class SpanHolder:  # pylint: disable=too-few-public-methods
    """Holds span information and tracks relationships"""

    def __init__(self, span: Span, start_time: float, context_token=None):
        self.span = span
        self.start_time = start_time
        self.children: List[UUID] = []
        self.workflow_name = ""
        self.entity_name = ""
        self.context_token = context_token  # For context restoration


class OpenLITLangChainCallbackHandler(BaseCallbackHandler):
    """
    Enhanced OpenLIT callback handler
    """

    def __init__(
        self,
        tracer,
        version,
        environment,
        application_name,
        pricing_info,
        capture_message_content,
        metrics,
        disable_metrics,
    ):
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

        # Track streaming responses by run_id
        self.streaming_chunks: Dict[UUID, List[str]] = {}

        self.session_name = environment  # Map environment to session
        self.tags_enabled = True  # Enable tagging system
        self.events_enabled = True  # Enable events tracking
        self.performance_baselines = {}  # Store performance baselines
        self.error_classification_enabled = True  # Enable error classification

    # Required BaseCallbackHandler properties
    @property
    def raise_error(self) -> bool:
        """Should the handler raise errors instead of logging them."""
        return False

    @property
    def run_inline(self) -> bool:
        """Should the handler run inline with the main thread."""
        return True

    # Ignore flags - all set to False so we capture everything
    @property
    def ignore_llm(self) -> bool:
        return False

    @property
    def ignore_chain(self) -> bool:
        return False

    @property
    def ignore_agent(self) -> bool:
        return False

    @property
    def ignore_retriever(self) -> bool:
        return False

    @property
    def ignore_chat_model(self) -> bool:
        return False

    def _get_span_name(self, serialized: Dict[str, Any], operation_type: str) -> str:
        """Generate OpenLIT-style span names following our naming convention"""

        # Handle None serialized (common for RunnableSequence)
        if not serialized:
            return f"{operation_type} RunnableSequence"

        # Extract class name for component identification
        if "id" in serialized and serialized["id"]:
            component_name = serialized["id"][-1]  # Last part is usually the class name
        elif "name" in serialized:
            component_name = serialized["name"]
        else:
            component_name = "unknown"

        # Follow OpenLIT naming: {operation_type} {component_name}
        return f"{operation_type} {component_name}"

    def _create_span(
        self,
        run_id: UUID,
        parent_run_id: Optional[UUID],
        span_name: str,
        kind: SpanKind = SpanKind.CLIENT,
        model_name: Optional[str] = None,
    ) -> Span:
        """Create a span with proper parent-child relationship and set as active context"""

        # If we have a parent, create child span in parent context
        if parent_run_id and parent_run_id in self.spans:
            parent_span = self.spans[parent_run_id].span
            span = self.tracer.start_span(
                span_name, context=set_span_in_context(parent_span), kind=kind
            )
            # Track parent-child relationship
            self.spans[parent_run_id].children.append(run_id)
        else:
            # Create root span
            span = self.tracer.start_span(span_name, kind=kind)

        # Set this span as the active context so downstream instrumentations (like OpenAI)
        # will create child spans under it
        span_context = set_span_in_context(span)
        context_token = context_api.attach(span_context)

        # Store span with start time and context token
        start_time = time.time()
        self.spans[run_id] = SpanHolder(span, start_time, context_token)

        # Set common framework span attributes for consistency
        scope = type("GenericScope", (), {})()
        scope._span = span
        scope._start_time = start_time
        scope._end_time = None

        # Create mock instance with model name for common_framework_span_attributes
        mock_instance = None
        if model_name:
            mock_instance = type("MockInstance", (), {"model_name": model_name})()

        common_framework_span_attributes(
            scope,
            SemanticConvention.GEN_AI_SYSTEM_LANGCHAIN,
            "localhost",  # Default server address for LangChain
            8080,  # Default port
            self.environment,
            self.application_name,
            self.version,
            span_name,
            mock_instance,
        )

        return span

    def _end_span(self, run_id: UUID) -> None:
        """End span and all its children, restore context"""
        if run_id not in self.spans:
            return

        span_holder = self.spans[run_id]
        span = span_holder.span

        # End all child spans first
        for child_id in span_holder.children:
            if child_id in self.spans:
                self._end_span(child_id)

        # Restore the previous context before ending span
        if span_holder.context_token:
            context_api.detach(span_holder.context_token)

        # Update end time for duration calculation
        end_time = time.time()
        duration = end_time - span_holder.start_time
        span.set_attribute(
            SemanticConvention.GEN_AI_CLIENT_OPERATION_DURATION, duration
        )

        # End this span
        span.set_status(Status(StatusCode.OK))
        span.end()

        # Clean up
        del self.spans[run_id]

    def _add_langsmith_events(
        self, span: Span, event_type: str, data: Optional[Dict] = None
    ):
        """Add LangSmith-style events to spans"""
        if not self.events_enabled:
            return

        try:
            event_data = {
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "event_type": event_type,
                "session_name": self.session_name,
            }

            if data:
                event_data.update(data)

            span.add_event(f"langchain.{event_type}", event_data)
        except Exception:
            pass  # Graceful degradation

    def _classify_error(self, error: Exception) -> str:
        """Classify errors like LangSmith does"""
        error_type = type(error).__name__

        # LangSmith-style error classification
        if "rate" in str(error).lower() or "429" in str(error):
            return "RATE_LIMIT_ERROR"
        elif "timeout" in str(error).lower():
            return "TIMEOUT_ERROR"
        elif "auth" in str(error).lower() or "401" in str(error):
            return "AUTH_ERROR"
        elif "not found" in str(error).lower() or "404" in str(error):
            return "NOT_FOUND_ERROR"
        elif "connection" in str(error).lower():
            return "CONNECTION_ERROR"
        elif "validation" in str(error).lower():
            return "VALIDATION_ERROR"
        else:
            return f"GENERAL_ERROR_{error_type}"

    def _add_tags_from_context(self, span: Span, run_id: UUID, **kwargs):
        """Add LangSmith-style tags to spans"""
        if not self.tags_enabled:
            return

        try:
            tags = []

            # Auto-generate tags based on context
            if "model" in kwargs:
                tags.append(f"model:{kwargs['model']}")
            if "temperature" in kwargs:
                tags.append(f"temperature:{kwargs['temperature']}")
            if hasattr(kwargs.get("invocation_params", {}), "stream"):
                tags.append(
                    f"streaming:{kwargs['invocation_params'].get('stream', False)}"
                )

            # Add session tag
            tags.append(f"session:{self.session_name}")

            # Add environment tag
            tags.append(f"env:{self.environment}")

            if tags:
                span.set_attribute(SemanticConvention.GEN_AI_FRAMEWORK_TAGS, tags)

        except Exception:
            pass  # Graceful degradation

    def _track_performance_baseline(
        self, span: Span, operation_name: str, duration_ms: float
    ):
        """Track performance against baselines like LangSmith"""
        try:
            # Store baseline if not exists
            if operation_name not in self.performance_baselines:
                self.performance_baselines[operation_name] = {
                    "avg_duration": duration_ms,
                    "min_duration": duration_ms,
                    "max_duration": duration_ms,
                    "count": 1,
                }
            else:
                baseline = self.performance_baselines[operation_name]
                baseline["count"] += 1
                baseline["avg_duration"] = (
                    baseline["avg_duration"] * (baseline["count"] - 1) + duration_ms
                ) / baseline["count"]
                baseline["min_duration"] = min(baseline["min_duration"], duration_ms)
                baseline["max_duration"] = max(baseline["max_duration"], duration_ms)

            # Add performance comparison attributes
            baseline = self.performance_baselines[operation_name]
            span.set_attribute(
                SemanticConvention.GEN_AI_FRAMEWORK_PERFORMANCE_VS_BASELINE,
                duration_ms / baseline["avg_duration"],
            )
            span.set_attribute(
                SemanticConvention.GEN_AI_FRAMEWORK_PERFORMANCE_BASELINE_AVG,
                baseline["avg_duration"],
            )
            span.set_attribute(
                SemanticConvention.GEN_AI_FRAMEWORK_PERFORMANCE_BASELINE_PERCENTILE,
                _calculate_percentile(duration_ms, baseline),
            )

        except Exception:
            pass  # Graceful degradation

    # Enhanced callback methods with new features
    def on_llm_start(
        self,
        serialized: Dict[str, Any],
        prompts: List[str],
        *,
        run_id: UUID,
        parent_run_id: Optional[UUID] = None,
        **kwargs: Any,
    ) -> None:
        """Called when an LLM starts"""

        try:
            # Create workflow span for chain operations
            span_name = self._get_span_name(serialized, "workflow")
            span = self._create_span(
                run_id, parent_run_id, span_name, SpanKind.INTERNAL
            )

            # Set OpenLIT attributes
            span.set_attribute(
                SemanticConvention.GEN_AI_SYSTEM,
                SemanticConvention.GEN_AI_SYSTEM_LANGCHAIN,
            )
            span.set_attribute(
                SemanticConvention.GEN_AI_OPERATION,
                SemanticConvention.GEN_AI_OPERATION_TYPE_FRAMEWORK,
            )

            # Set workflow-specific attributes
            if serialized and "id" in serialized and serialized["id"]:
                span.set_attribute(
                    SemanticConvention.GEN_AI_WORKFLOW_TYPE, serialized["id"][-1]
                )
            else:
                span.set_attribute(
                    SemanticConvention.GEN_AI_WORKFLOW_TYPE, "RunnableSequence"
                )

            # LangSmith-style serialized function capture
            self._capture_serialized_info(span, serialized)

            # Capture input if enabled (with safe JSON serialization)
            if self.capture_message_content:
                try:
                    input_str = json.dumps(prompts, default=str)[:1000]
                    span.set_attribute(
                        SemanticConvention.GEN_AI_WORKFLOW_INPUT, input_str
                    )
                except Exception:
                    span.set_attribute(
                        SemanticConvention.GEN_AI_WORKFLOW_INPUT, str(prompts)[:1000]
                    )

            # Framework enhancements - use attributes only (not events for non-chat operations)

            self._add_tags_from_context(span, run_id, **kwargs)

            # Additional metadata is captured through semantic conventions above

            # Extract provider information (OpenInference-inspired enhancement)
            self._extract_provider_info(span, **kwargs)

        except Exception:
            # Graceful error handling to prevent callback system failure
            pass

    def on_llm_end(
        self,
        response: LLMResult,
        *,
        run_id: UUID,
        parent_run_id: Optional[UUID] = None,
        **kwargs: Any,
    ) -> None:
        """Called when an LLM call ends"""

        try:
            if run_id not in self.spans:
                return

            span_holder = self.spans[run_id]
            span = span_holder.span

            # If this was a streaming call and we accumulated chunks,
            # add the complete streamed response to the span
            if run_id in self.streaming_chunks:
                complete_response = "".join(self.streaming_chunks[run_id])
                if self.capture_message_content and complete_response:
                    # Set the complete streamed content
                    span.set_attribute(
                        SemanticConvention.GEN_AI_CONTENT_COMPLETION, complete_response
                    )
                    # Calculate output tokens for the streamed content
                    output_tokens = general_tokens(complete_response)
                    span.set_attribute(
                        SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS, output_tokens
                    )

                # Clean up streaming chunks
                del self.streaming_chunks[run_id]

            # Process LLM response with OpenLIT's business intelligence
            self._process_llm_response(span, response, run_id)

            # Duration is set in _end_span method

            # NEW: Add performance baseline tracking
            if span_holder:
                duration_ms = (time.time() - span_holder.start_time) * 1000
                self._track_performance_baseline(span, span.name, duration_ms)

            # Framework completion - use attributes only (not events for non-chat operations)

            self._end_span(run_id)

        except Exception:
            # Graceful error handling
            pass

    def on_llm_error(
        self,
        error: Exception,
        *,
        run_id: UUID,
        parent_run_id: Optional[UUID] = None,
        **kwargs: Any,
    ) -> None:
        """Called when an LLM call ends with an error"""

        try:
            if run_id not in self.spans:
                return

            span_holder = self.spans[run_id]
            span = span_holder.span

            # Clean up streaming chunks if this was a streaming call
            if run_id in self.streaming_chunks:
                del self.streaming_chunks[run_id]

            # NEW: Enhanced error classification and tracking
            # Framework error classification
            error_class = self._classify_error(error)
            span.set_attribute(
                SemanticConvention.GEN_AI_FRAMEWORK_ERROR_CLASS, error_class
            )
            span.set_attribute(
                SemanticConvention.GEN_AI_FRAMEWORK_ERROR_TYPE, type(error).__name__
            )
            span.set_attribute(
                SemanticConvention.GEN_AI_FRAMEWORK_ERROR_MESSAGE, str(error)
            )

            # Framework error - use attributes only (not events for non-chat operations)

            # Set error status
            span.set_status(Status(StatusCode.ERROR, str(error)))
            span.record_exception(error)

            self._end_span(run_id)

        except Exception:
            # Graceful error handling
            pass

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
        """Called when a chain (RunnableSequence, etc.) starts"""

        try:
            # Create workflow span for chain operations
            span_name = self._get_span_name(serialized, "workflow")
            span = self._create_span(
                run_id, parent_run_id, span_name, SpanKind.INTERNAL
            )

            # Set OpenLIT attributes
            span.set_attribute(
                SemanticConvention.GEN_AI_SYSTEM,
                SemanticConvention.GEN_AI_SYSTEM_LANGCHAIN,
            )
            span.set_attribute(
                SemanticConvention.GEN_AI_OPERATION,
                SemanticConvention.GEN_AI_OPERATION_TYPE_FRAMEWORK,
            )

            # Set workflow-specific attributes
            if serialized and "id" in serialized and serialized["id"]:
                span.set_attribute(
                    SemanticConvention.GEN_AI_WORKFLOW_TYPE, serialized["id"][-1]
                )
            else:
                span.set_attribute(
                    SemanticConvention.GEN_AI_WORKFLOW_TYPE, "RunnableSequence"
                )

            # LangSmith-style serialized function capture
            self._capture_serialized_info(span, serialized)

            # Capture input if enabled (with safe JSON serialization)
            if self.capture_message_content:
                try:
                    input_str = json.dumps(inputs, default=str)[:1000]
                    span.set_attribute(
                        SemanticConvention.GEN_AI_WORKFLOW_INPUT, input_str
                    )
                except Exception:
                    span.set_attribute(
                        SemanticConvention.GEN_AI_WORKFLOW_INPUT, str(inputs)[:1000]
                    )

            # Enhanced chain tracking - use attributes only (not events for non-chat operations)

            # Add chain-specific tags
            chain_tags = [f"chain_type:{serialized.get('id', ['unknown'])[-1]}"]
            if inputs:
                chain_tags.append(f"input_count:{len(inputs)}")
            span.set_attribute(SemanticConvention.GEN_AI_FRAMEWORK_TAGS, chain_tags)

        except Exception:
            # Graceful error handling to prevent callback system failure
            pass

    def on_chain_end(
        self,
        outputs: Dict[str, Any],
        *,
        run_id: UUID,
        parent_run_id: Optional[UUID] = None,
        **kwargs: Any,
    ) -> None:
        """Called when a chain ends"""

        try:
            if run_id not in self.spans:
                return

            span = self.spans[run_id].span

            # Capture output if enabled (with safe JSON serialization)
            if self.capture_message_content:
                try:
                    output_str = json.dumps(outputs, default=str)[:1000]
                    span.set_attribute(
                        SemanticConvention.GEN_AI_WORKFLOW_OUTPUT, output_str
                    )
                except Exception:
                    span.set_attribute(
                        SemanticConvention.GEN_AI_WORKFLOW_OUTPUT, str(outputs)[:1000]
                    )

            # Duration is set in _end_span method

            self._end_span(run_id)

        except Exception:
            # Graceful error handling
            pass

    def on_chain_error(
        self,
        error: Exception,
        *,
        run_id: UUID,
        parent_run_id: Optional[UUID] = None,
        **kwargs: Any,
    ) -> None:
        """Called when a chain ends with an error"""

        try:
            if run_id not in self.spans:
                return

            span_holder = self.spans[run_id]
            span = span_holder.span

            # Clean up streaming chunks if this was a streaming call
            if run_id in self.streaming_chunks:
                del self.streaming_chunks[run_id]

            # Enhanced error classification and tracking
            error_class = self._classify_error(error)
            span.set_attribute(
                SemanticConvention.GEN_AI_FRAMEWORK_ERROR_CLASS, error_class
            )
            span.set_attribute(
                SemanticConvention.GEN_AI_FRAMEWORK_ERROR_TYPE, type(error).__name__
            )
            span.set_attribute(
                SemanticConvention.GEN_AI_FRAMEWORK_ERROR_MESSAGE, str(error)
            )

            # Set error status
            span.set_status(Status(StatusCode.ERROR, str(error)))
            span.record_exception(error)

            self._end_span(run_id)

        except Exception:
            # Graceful error handling
            pass

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
        """Called when a chat model (ChatOpenAI, etc.) starts"""

        try:
            # Extract model name from multiple sources with fallback chain
            model_name = "unknown"

            # DEBUG: Log serialized data to understand structure
            # This helps us improve model extraction logic
            # print(f"DEBUG: serialized={serialized}")
            # print(f"DEBUG: kwargs={kwargs}")

            # Try extracting from serialized kwargs first (most reliable)
            if (
                serialized
                and "kwargs" in serialized
                and "model" in serialized["kwargs"]
            ):
                model_name = serialized["kwargs"]["model"]
            elif kwargs.get("model"):
                model_name = kwargs["model"]
            elif serialized:
                # Try extracting from different parts of serialized data
                # LangChain often stores model info in various locations
                if "model" in serialized:
                    model_name = serialized["model"]
                elif "model_name" in serialized:
                    model_name = serialized["model_name"]
                elif (
                    "name" in serialized and "model" in str(serialized["name"]).lower()
                ):
                    model_name = serialized["name"]
                elif "id" in serialized and serialized["id"]:
                    # Extract from class identifier - this gives us the framework being used
                    class_info = serialized["id"]
                    if isinstance(class_info, list) and len(class_info) > 0:
                        class_name = class_info[
                            -1
                        ]  # Last part is usually the class name
                        # Infer model based on LangChain provider class
                        if "chatopenai" in class_name.lower():
                            model_name = "gpt-3.5-turbo"  # Default OpenAI model
                        elif "chatanthropic" in class_name.lower():
                            model_name = "claude-3"
                        elif (
                            "chatgooglevertexai" in class_name.lower()
                            or "chatgoogleai" in class_name.lower()
                        ):
                            model_name = "gemini-pro"
                        elif "llama" in class_name.lower():
                            model_name = "llama-2"
                        else:
                            # Use the class name itself as model identifier
                            model_name = class_name

            # Create chat span with model name
            span_name = f"chat {model_name}"
            span = self._create_span(
                run_id, parent_run_id, span_name, SpanKind.CLIENT, model_name
            )

            # Set OpenLIT chat operation attributes
            span.set_attribute(
                SemanticConvention.GEN_AI_SYSTEM, "openai"
            )  # Most common
            span.set_attribute(
                SemanticConvention.GEN_AI_OPERATION,
                SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
            )
            span.set_attribute(SemanticConvention.GEN_AI_REQUEST_MODEL, model_name)

            # Streaming detection
            is_streaming = kwargs.get("stream", False) or kwargs.get("streaming", False)
            span.set_attribute(
                SemanticConvention.GEN_AI_REQUEST_IS_STREAM, is_streaming
            )

            # Process messages for content capture and token counting
            if messages and len(messages) > 0:
                formatted_messages = self._format_messages(messages[0])

                if self.capture_message_content:
                    span.set_attribute(
                        SemanticConvention.GEN_AI_CONTENT_PROMPT, formatted_messages
                    )

                # Calculate input tokens
                input_tokens = general_tokens(formatted_messages)
                span.set_attribute(
                    SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS, input_tokens
                )

        except Exception:
            # Graceful error handling
            pass

    def on_llm_new_token(
        self,
        token: str,
        *,
        chunk: Optional[Any] = None,
        run_id: UUID,
        parent_run_id: Optional[UUID] = None,
        **kwargs: Any,
    ) -> None:
        """Called when a new token is generated during streaming.

        This callback is triggered for each token during astream() operations.
        We accumulate the tokens to build the complete response, which will
        be processed when on_llm_end() is called.

        Args:
            token: The new token generated
            chunk: Optional chunk object containing additional metadata
            run_id: The run ID for this streaming operation
            parent_run_id: The parent run ID if nested
            **kwargs: Additional keyword arguments
        """
        try:
            # Initialize streaming chunks list for this run_id if needed
            if run_id not in self.streaming_chunks:
                self.streaming_chunks[run_id] = []

            # Accumulate the token
            if token:
                self.streaming_chunks[run_id].append(token)

            # The span remains open - it will be closed in on_llm_end()

        except Exception:
            # Graceful error handling to prevent callback system failure
            pass

    def _format_messages(self, messages: List[BaseMessage]) -> str:
        """Format LangChain messages for content capture"""
        formatted = []
        for message in messages:
            role = self._get_message_role(message)
            content = getattr(message, "content", str(message))
            formatted.append(f"{role}: {content}")
        return "\n".join(formatted)

    def _get_message_role(self, message: BaseMessage) -> str:
        """Extract role from LangChain message"""
        message_type = message.__class__.__name__.lower()
        if "human" in message_type:
            return "user"
        elif "ai" in message_type:
            return "assistant"
        elif "system" in message_type:
            return "system"
        elif "tool" in message_type:
            return "tool"
        else:
            return "user"

    def _process_llm_response(
        self, span: Span, response: LLMResult, run_id: UUID
    ) -> None:
        """Process LLM response with OpenLIT's comprehensive business intelligence"""

        try:
            # Extract response content
            if response.generations and len(response.generations) > 0:
                generation = response.generations[0][0]

                if isinstance(generation, ChatGeneration):
                    completion_content = generation.message.content
                elif isinstance(generation, Generation):
                    completion_content = generation.text
                else:
                    completion_content = str(generation)

                # Set completion content
                if self.capture_message_content:
                    span.set_attribute(
                        SemanticConvention.GEN_AI_CONTENT_COMPLETION, completion_content
                    )

                # Calculate output tokens
                output_tokens = general_tokens(completion_content)
                span.set_attribute(
                    SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS, output_tokens
                )

            # Use enhanced token extraction method (inspired by OpenInference)
            self._extract_token_usage(span, response)

            # Extract additional LLM output information
            if hasattr(response, "llm_output") and response.llm_output:
                llm_output = response.llm_output

                # Model information
                if "model_name" in llm_output:
                    span.set_attribute(
                        SemanticConvention.GEN_AI_RESPONSE_MODEL,
                        llm_output["model_name"],
                    )

            # Calculate cost using OpenLIT's cost tracking
            input_tokens = span.attributes.get(
                SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS, 0
            )
            output_tokens = span.attributes.get(
                SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS, 0
            )
            model_name = span.attributes.get(
                SemanticConvention.GEN_AI_REQUEST_MODEL, ""
            )

            if input_tokens and output_tokens and model_name:
                cost = get_chat_model_cost(
                    model_name, self.pricing_info, input_tokens, output_tokens
                )
                span.set_attribute(SemanticConvention.GEN_AI_USAGE_COST, cost)

        except Exception as e:
            handle_exception(span, e)

    def _extract_token_usage(self, span: Span, result: LLMResult) -> None:
        """Extract comprehensive token usage with OpenInference-style parsing"""
        try:
            # Try multiple token usage extraction patterns
            token_usage = None

            # Pattern 1: Standard non-streaming (OpenAI, most providers)
            if hasattr(result, "llm_output") and result.llm_output:
                token_usage = result.llm_output.get(
                    "token_usage"
                ) or result.llm_output.get("usage")

            # Pattern 2: Streaming outputs (when stream_usage=True)
            if not token_usage and result.generations:
                try:
                    first_gen = result.generations[0][0]
                    if hasattr(first_gen, "message") and hasattr(
                        first_gen.message, "kwargs"
                    ):
                        token_usage = first_gen.message.kwargs.get("usage_metadata")
                except (IndexError, AttributeError):
                    pass

            # Pattern 3: VertexAI-specific (generation_info.usage_metadata)
            if not token_usage and result.generations:
                try:
                    first_gen = result.generations[0][0]
                    if (
                        hasattr(first_gen, "generation_info")
                        and first_gen.generation_info
                    ):
                        token_usage = first_gen.generation_info.get("usage_metadata")
                except (IndexError, AttributeError):
                    pass

            if token_usage:
                # Support multiple token field names from different providers
                input_tokens = (
                    token_usage.get("prompt_tokens")
                    or token_usage.get("input_tokens")  # Anthropic
                    or token_usage.get("prompt_token_count")
                )  # Gemini

                output_tokens = (
                    token_usage.get("completion_tokens")
                    or token_usage.get("output_tokens")  # Anthropic
                    or token_usage.get("candidates_token_count")
                )  # Gemini

                total_tokens = token_usage.get("total_tokens") or token_usage.get(
                    "total_token_count"
                )  # Gemini

                if input_tokens:
                    span.set_attribute(
                        SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS, input_tokens
                    )
                if output_tokens:
                    span.set_attribute(
                        SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS, output_tokens
                    )
                if total_tokens:
                    span.set_attribute(
                        SemanticConvention.GEN_AI_USAGE_TOTAL_TOKENS, total_tokens
                    )

                # Enhanced token details (OpenAI-specific)
                if details := token_usage.get("completion_tokens_details"):
                    if audio_tokens := details.get("audio_tokens"):
                        span.set_attribute(
                            SemanticConvention.GEN_AI_USAGE_COMPLETION_TOKENS_DETAILS_AUDIO,
                            audio_tokens,
                        )
                    if reasoning_tokens := details.get("reasoning_tokens"):
                        span.set_attribute(
                            SemanticConvention.GEN_AI_USAGE_COMPLETION_TOKENS_DETAILS_REASONING,
                            reasoning_tokens,
                        )

                if details := token_usage.get("prompt_tokens_details"):
                    if cached_tokens := details.get("cached_tokens"):
                        span.set_attribute(
                            SemanticConvention.GEN_AI_USAGE_PROMPT_TOKENS_DETAILS_CACHE_READ,
                            cached_tokens,
                        )
                    if audio_tokens := details.get("audio_tokens"):
                        span.set_attribute(
                            SemanticConvention.GEN_AI_USAGE_PROMPT_TOKENS_DETAILS_CACHE_READ,
                            audio_tokens,
                        )

                # Anthropic cache tokens
                if cache_read := token_usage.get("cache_read_input_tokens"):
                    span.set_attribute(
                        SemanticConvention.GEN_AI_USAGE_PROMPT_TOKENS_DETAILS_CACHE_READ,
                        cache_read,
                    )
                if cache_write := token_usage.get("cache_creation_input_tokens"):
                    span.set_attribute(
                        SemanticConvention.GEN_AI_USAGE_PROMPT_TOKENS_DETAILS_CACHE_WRITE,
                        cache_write,
                    )

        except Exception as e:
            handle_exception(span, e)

    def _extract_provider_info(self, span: Span, **kwargs) -> None:
        """Extract provider information with OpenInference-style mapping"""
        try:
            # Extract from metadata if available
            if "metadata" in kwargs:
                metadata = kwargs["metadata"]
                if isinstance(metadata, dict) and "ls_provider" in metadata:
                    provider = metadata["ls_provider"].lower()
                    mapped_provider = LANGCHAIN_PROVIDER_MAP.get(provider, provider)
                    span.set_attribute(
                        SemanticConvention.GEN_AI_SYSTEM, mapped_provider
                    )
                    span.set_attribute(
                        SemanticConvention.GEN_AI_REQUEST_PROVIDER, mapped_provider
                    )
                    return

            # Extract from invocation parameters
            if "invocation_params" in kwargs:
                params = kwargs["invocation_params"]
                if isinstance(params, dict):
                    # Look for provider indicators in model names
                    model = params.get("model") or params.get("model_name", "")
                    if model:
                        if "gpt-" in model or "o1-" in model:
                            span.set_attribute(
                                SemanticConvention.GEN_AI_SYSTEM, "openai"
                            )
                        elif "claude-" in model:
                            span.set_attribute(
                                SemanticConvention.GEN_AI_SYSTEM, "anthropic"
                            )
                        elif "gemini-" in model or "bison-" in model:
                            span.set_attribute(
                                SemanticConvention.GEN_AI_SYSTEM, "google"
                            )
                        elif "mistral-" in model:
                            span.set_attribute(
                                SemanticConvention.GEN_AI_SYSTEM, "mistralai"
                            )

        except Exception as e:
            handle_exception(span, e)

    def _capture_serialized_info(self, span: Span, serialized: Dict[str, Any]) -> None:
        """Capture LangSmith-style serialized function information"""
        if not serialized:
            return

        try:
            # Capture function name (LangSmith enhancement)
            if "name" in serialized and serialized["name"]:
                span.set_attribute(
                    SemanticConvention.GEN_AI_SERIALIZED_NAME, serialized["name"]
                )

            # Capture function signature if available
            if "signature" in serialized and serialized["signature"]:
                span.set_attribute(
                    SemanticConvention.GEN_AI_SERIALIZED_SIGNATURE,
                    str(serialized["signature"])[:500],
                )

            # Capture docstring if available
            if "doc" in serialized and serialized["doc"]:
                span.set_attribute(
                    SemanticConvention.GEN_AI_SERIALIZED_DOC,
                    str(serialized["doc"])[:200],
                )

            # Capture module information
            if "id" in serialized and isinstance(serialized["id"], list):
                module_path = (
                    ".".join(serialized["id"][:-1]) if len(serialized["id"]) > 1 else ""
                )
                if module_path:
                    span.set_attribute(
                        SemanticConvention.GEN_AI_SERIALIZED_MODULE, module_path
                    )

        except Exception:
            # Graceful failure for serialized info capture
            pass

    def on_tool_start(
        self,
        serialized: Dict[str, Any],
        input_str: str,
        *,
        run_id: UUID,
        parent_run_id: Optional[UUID] = None,
        **kwargs: Any,
    ) -> None:
        """Called when a tool starts"""

        span_name = self._get_span_name(serialized, "tool")
        span = self._create_span(run_id, parent_run_id, span_name, SpanKind.CLIENT)

        span.set_attribute(
            SemanticConvention.GEN_AI_SYSTEM, SemanticConvention.GEN_AI_SYSTEM_LANGCHAIN
        )
        span.set_attribute(
            SemanticConvention.GEN_AI_OPERATION,
            SemanticConvention.GEN_AI_OPERATION_TYPE_TOOLS,
        )

        if self.capture_message_content:
            span.set_attribute(SemanticConvention.GEN_AI_TOOL_INPUT, input_str[:1000])

    def on_tool_end(
        self,
        output: str,
        *,
        run_id: UUID,
        parent_run_id: Optional[UUID] = None,
        **kwargs: Any,
    ) -> None:
        """Called when a tool ends"""

        if run_id not in self.spans:
            return

        span = self.spans[run_id].span

        if self.capture_message_content:
            span.set_attribute(SemanticConvention.GEN_AI_TOOL_OUTPUT, output[:1000])

        # Duration is set in _end_span method

        self._end_span(run_id)

    def on_retriever_start(
        self,
        serialized: Dict[str, Any],
        query: str,
        *,
        run_id: UUID,
        parent_run_id: Optional[UUID] = None,
        **kwargs: Any,
    ) -> None:
        """Called when a retriever starts"""

        span_name = self._get_span_name(serialized, "retrieval")
        span = self._create_span(run_id, parent_run_id, span_name, SpanKind.CLIENT)

        span.set_attribute(
            SemanticConvention.GEN_AI_SYSTEM, SemanticConvention.GEN_AI_SYSTEM_LANGCHAIN
        )
        span.set_attribute(
            SemanticConvention.GEN_AI_OPERATION,
            SemanticConvention.GEN_AI_OPERATION_TYPE_RETRIEVE,
        )

        if self.capture_message_content:
            span.set_attribute(SemanticConvention.GEN_AI_RETRIEVAL_QUERY, query[:1000])

    def on_retriever_end(
        self,
        documents,
        *,
        run_id: UUID,
        parent_run_id: Optional[UUID] = None,
        **kwargs: Any,
    ) -> None:
        """Called when a retriever ends"""

        if run_id not in self.spans:
            return

        span = self.spans[run_id].span

        # Document count
        doc_count = len(documents) if documents else 0
        span.set_attribute(
            SemanticConvention.GEN_AI_RETRIEVAL_DOCUMENT_COUNT, doc_count
        )

        # Sample document content
        if self.capture_message_content and documents:
            sample_docs = []
            for doc in documents[:3]:  # First 3 docs
                if hasattr(doc, "page_content"):
                    sample_docs.append(doc.page_content[:200])
                else:
                    sample_docs.append(str(doc)[:200])
            span.set_attribute(
                SemanticConvention.GEN_AI_RETRIEVAL_DOCUMENTS, "; ".join(sample_docs)
            )

        # Duration is set in _end_span method

        self._end_span(run_id)


def _calculate_percentile(value: float, baseline: Dict[str, Any]) -> float:
    """Calculate rough percentile based on min/max"""
    try:
        min_val = baseline["min_duration"]
        max_val = baseline["max_duration"]
        if max_val == min_val:
            return 50.0
        return ((value - min_val) / (max_val - min_val)) * 100
    except:
        return 50.0  # Default to median
