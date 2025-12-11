"""
Utility functions for LangChain instrumentation.

This module provides:
- Context caching for performance optimization
- Token extraction from various LangChain provider responses
- Span context management for proper parent-child relationships
- Cost calculation helpers
"""

import json
import logging
import time
from typing import Any, Dict, List, Optional, Tuple

from opentelemetry import context as context_api
from opentelemetry.trace import SpanKind, Span, set_span_in_context
from opentelemetry.trace import Status, StatusCode

from openlit.__helpers import (
    record_completion_metrics,
    record_framework_metrics,
)
from openlit.semcov import SemanticConvention

# Initialize logger
logger = logging.getLogger(__name__)

# Provider mapping for LangChain providers to OpenLIT system names
LANGCHAIN_PROVIDER_MAP = {
    "anthropic": "anthropic",
    "azure": "azure",
    "azure_ai": "azure",
    "azure_openai": "azure",
    "bedrock": "aws.bedrock",
    "bedrock_converse": "aws.bedrock",
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


class SpanHolder:
    """
    Holds span information and tracks parent-child relationships.

    Attributes:
        span: The OpenTelemetry span
        start_time: Unix timestamp when span started
        children: List of child run IDs
        context_token: Token for context restoration
        first_token_time: Time when first streaming token was received
        token_timestamps: List of timestamps for TBT calculation
    """

    __slots__ = (
        "span",
        "start_time",
        "children",
        "context_token",
        "first_token_time",
        "token_timestamps",
        "streaming_content",
    )

    def __init__(self, span: Span, start_time: float, context_token=None):
        self.span = span
        self.start_time = start_time
        self.children: List[Any] = []
        self.context_token = context_token
        self.first_token_time: Optional[float] = None
        self.token_timestamps: List[float] = []
        self.streaming_content: List[str] = []


class LangChainInstrumentationContext:
    """
    Context object for caching expensive extractions during instrumentation.

    Uses __slots__ for memory efficiency and lazy loading for performance.
    """

    __slots__ = (
        "serialized",
        "kwargs",
        "version",
        "environment",
        "application_name",
        "_model_name",
        "_provider",
        "_is_streaming",
    )

    def __init__(
        self,
        serialized: Optional[Dict[str, Any]],
        kwargs: Dict[str, Any],
        version: str,
        environment: str,
        application_name: str,
    ):
        self.serialized = serialized or {}
        self.kwargs = kwargs
        self.version = version
        self.environment = environment
        self.application_name = application_name
        self._model_name: Optional[str] = None
        self._provider: Optional[str] = None
        self._is_streaming: Optional[bool] = None

    @property
    def model_name(self) -> str:
        """Extract model name with caching - avoids repeated extraction."""
        if self._model_name is None:
            self._model_name = extract_model_name(self.serialized, self.kwargs)
        return self._model_name

    @property
    def provider(self) -> str:
        """Extract provider with caching."""
        if self._provider is None:
            self._provider = extract_provider(self.serialized, self.kwargs)
        return self._provider

    @property
    def is_streaming(self) -> bool:
        """Check if this is a streaming request."""
        if self._is_streaming is None:
            self._is_streaming = self.kwargs.get("stream", False) or self.kwargs.get(
                "streaming", False
            )
        return self._is_streaming


def extract_model_name(
    serialized: Optional[Dict[str, Any]], kwargs: Dict[str, Any]
) -> str:
    """
    Extract model name from serialized data and kwargs.

    Tries multiple extraction patterns for different LangChain providers:
    1. serialized.kwargs.model_name or model
    2. invocation_params.model or model_name
    3. kwargs.model
    4. serialized.model or model_name
    5. Class name inference from serialized.id
    """
    model_name = "unknown"

    # Pattern 1: From serialized kwargs (most reliable)
    if serialized and "kwargs" in serialized:
        if "model_name" in serialized["kwargs"]:
            model_name = serialized["kwargs"]["model_name"]
        elif "model" in serialized["kwargs"]:
            model_name = serialized["kwargs"]["model"]
        elif "model_id" in serialized["kwargs"]:
            model_name = serialized["kwargs"]["model_id"]

    # Pattern 2: From invocation_params
    if model_name == "unknown":
        invocation_params = kwargs.get("invocation_params", {})
        if invocation_params:
            model_name = (
                invocation_params.get("model")
                or invocation_params.get("model_name")
                or invocation_params.get("model_id")
                or model_name
            )

    # Pattern 3: Direct kwargs
    if model_name == "unknown":
        model_name = kwargs.get("model") or kwargs.get("model_name") or model_name

    # Pattern 4: From serialized directly
    if model_name == "unknown" and serialized:
        model_name = (
            serialized.get("model") or serialized.get("model_name") or model_name
        )

    # Pattern 5: Infer from class name
    if model_name == "unknown" and serialized and "id" in serialized:
        class_info = serialized.get("id", [])
        if isinstance(class_info, list) and class_info:
            class_name = class_info[-1].lower()
            if "chatopenai" in class_name:
                model_name = "gpt-3.5-turbo"
            elif "chatanthropic" in class_name:
                model_name = "claude-3"
            elif "chatgooglevertexai" in class_name or "chatgoogleai" in class_name:
                model_name = "gemini-pro"
            elif "chatbedrock" in class_name:
                model_name = "anthropic.claude-3"

    return model_name


def extract_provider(
    serialized: Optional[Dict[str, Any]], kwargs: Dict[str, Any]
) -> str:
    """
    Extract provider information from serialized data and kwargs.

    Returns the OpenLIT-normalized provider name.
    """
    provider = SemanticConvention.GEN_AI_SYSTEM_LANGCHAIN

    # Try from metadata
    metadata = kwargs.get("metadata", {})
    if isinstance(metadata, dict) and "ls_provider" in metadata:
        raw_provider = metadata["ls_provider"].lower()
        provider = LANGCHAIN_PROVIDER_MAP.get(raw_provider, raw_provider)
        return provider

    # Try from invocation_params model name
    invocation_params = kwargs.get("invocation_params", {})
    if invocation_params:
        model = (
            invocation_params.get("model") or invocation_params.get("model_name") or ""
        )
        if model:
            if "gpt-" in model or "o1-" in model or "o3-" in model:
                return "openai"
            if "claude-" in model:
                return "anthropic"
            if "gemini-" in model or "bison-" in model:
                return "google"
            if "mistral-" in model or "mixtral-" in model:
                return "mistralai"

    # Try from serialized class name
    if serialized and "id" in serialized:
        class_info = serialized.get("id", [])
        if isinstance(class_info, list) and class_info:
            class_name = class_info[-1].lower()
            for provider_key, provider_val in LANGCHAIN_PROVIDER_MAP.items():
                if provider_key in class_name:
                    return provider_val

    return provider


def extract_token_usage(response) -> Tuple[int, int, int]:
    """
    Extract comprehensive token usage from LangChain LLMResult.

    Supports multiple extraction patterns for different providers:
    - Pattern 1: Standard llm_output.token_usage (OpenAI, most providers)
    - Pattern 2: Streaming outputs (stream_usage=True)
    - Pattern 3: VertexAI (generation_info.usage_metadata)
    - Pattern 4: Anthropic-specific fields

    Returns:
        Tuple of (input_tokens, output_tokens, total_tokens)
    """
    input_tokens = 0
    output_tokens = 0
    total_tokens = 0

    try:
        token_usage = None

        # Pattern 1: Standard non-streaming (OpenAI, most providers)
        if hasattr(response, "llm_output") and response.llm_output:
            token_usage = response.llm_output.get(
                "token_usage"
            ) or response.llm_output.get("usage")

        # Pattern 2: Streaming outputs (when stream_usage=True)
        if (
            not token_usage
            and hasattr(response, "generations")
            and response.generations
        ):
            try:
                first_gen = response.generations[0][0]
                if hasattr(first_gen, "message") and hasattr(
                    first_gen.message, "kwargs"
                ):
                    token_usage = first_gen.message.kwargs.get("usage_metadata")
            except (IndexError, AttributeError):
                pass

        # Pattern 3: VertexAI-specific (generation_info.usage_metadata)
        if (
            not token_usage
            and hasattr(response, "generations")
            and response.generations
        ):
            try:
                first_gen = response.generations[0][0]
                if hasattr(first_gen, "generation_info") and first_gen.generation_info:
                    token_usage = first_gen.generation_info.get("usage_metadata")
            except (IndexError, AttributeError):
                pass

        if token_usage:
            # Support multiple token field names from different providers
            input_tokens = (
                token_usage.get("prompt_tokens")
                or token_usage.get("input_tokens")
                or token_usage.get("prompt_token_count")
                or 0
            )

            output_tokens = (
                token_usage.get("completion_tokens")
                or token_usage.get("output_tokens")
                or token_usage.get("candidates_token_count")
                or 0
            )

            total_tokens = (
                token_usage.get("total_tokens")
                or token_usage.get("total_token_count")
                or (input_tokens + output_tokens)
            )

    except Exception as e:
        logger.debug("Failed to extract token usage: %s", e)

    return input_tokens, output_tokens, total_tokens


def extract_token_details(response) -> Dict[str, int]:
    """
    Extract detailed token information (cache tokens, reasoning tokens, etc.).

    Returns a dictionary with detailed token breakdown.
    """
    details = {}

    try:
        token_usage = None

        if hasattr(response, "llm_output") and response.llm_output:
            token_usage = response.llm_output.get(
                "token_usage"
            ) or response.llm_output.get("usage")

        if token_usage:
            # OpenAI completion_tokens_details
            if completion_details := token_usage.get("completion_tokens_details"):
                if audio_tokens := completion_details.get("audio_tokens"):
                    details["completion_audio_tokens"] = audio_tokens
                if reasoning_tokens := completion_details.get("reasoning_tokens"):
                    details["reasoning_tokens"] = reasoning_tokens

            # OpenAI prompt_tokens_details
            if prompt_details := token_usage.get("prompt_tokens_details"):
                if cached_tokens := prompt_details.get("cached_tokens"):
                    details["cached_tokens"] = cached_tokens
                if audio_tokens := prompt_details.get("audio_tokens"):
                    details["prompt_audio_tokens"] = audio_tokens

            # Anthropic cache tokens
            if cache_read := token_usage.get("cache_read_input_tokens"):
                details["cache_read_tokens"] = cache_read
            if cache_write := token_usage.get("cache_creation_input_tokens"):
                details["cache_write_tokens"] = cache_write

    except Exception as e:
        logger.debug("Failed to extract token details: %s", e)

    return details


def format_messages(messages: List[Any]) -> str:
    """
    Format LangChain messages for content capture.

    Args:
        messages: List of LangChain message objects

    Returns:
        Formatted string representation of messages
    """
    formatted = []
    for message in messages:
        role = get_message_role(message)
        content = getattr(message, "content", str(message))
        formatted.append(f"{role}: {content}")
    return "\n".join(formatted)


def get_message_role(message: Any) -> str:
    """Extract role from LangChain message."""
    message_type = message.__class__.__name__.lower()
    if "human" in message_type:
        return "user"
    if "ai" in message_type:
        return "assistant"
    if "system" in message_type:
        return "system"
    if "tool" in message_type:
        return "tool"
    if "function" in message_type:
        return "function"
    return "user"


def calculate_streaming_metrics(
    span_holder: SpanHolder,
) -> Tuple[float, float]:
    """
    Calculate TTFT and TBT from streaming timestamps.

    Returns:
        Tuple of (ttft, tbt) in seconds
    """
    ttft = 0.0
    tbt = 0.0

    if span_holder.first_token_time:
        ttft = span_holder.first_token_time - span_holder.start_time

    if len(span_holder.token_timestamps) > 1:
        # Calculate average time between tokens
        intervals = []
        for i in range(1, len(span_holder.token_timestamps)):
            interval = (
                span_holder.token_timestamps[i] - span_holder.token_timestamps[i - 1]
            )
            intervals.append(interval)
        if intervals:
            tbt = sum(intervals) / len(intervals)

    return ttft, tbt


def create_span_with_context(
    tracer,
    span_name: str,
    parent_run_id: Optional[Any],
    spans_dict: Dict[Any, SpanHolder],
    kind: SpanKind = SpanKind.CLIENT,
) -> Tuple[Span, Any]:
    """
    Create a span with proper parent-child context propagation.

    Args:
        tracer: OpenTelemetry tracer
        span_name: Name for the span
        parent_run_id: Parent run ID if exists
        spans_dict: Dictionary of existing spans
        kind: Span kind (CLIENT, INTERNAL, etc.)

    Returns:
        Tuple of (span, context_token)
    """
    # If we have a parent, create child span in parent context
    if parent_run_id and parent_run_id in spans_dict:
        parent_span = spans_dict[parent_run_id].span
        span = tracer.start_span(
            span_name, context=set_span_in_context(parent_span), kind=kind
        )
        # Track parent-child relationship
        spans_dict[parent_run_id].children.append(parent_run_id)
    else:
        # Create root span
        span = tracer.start_span(span_name, kind=kind)

    # Set this span as the active context
    span_context = set_span_in_context(span)
    context_token = context_api.attach(span_context)

    return span, context_token


def end_span_safely(
    run_id: Any,
    spans_dict: Dict[Any, SpanHolder],
    status: StatusCode = StatusCode.OK,
    error: Optional[Exception] = None,
) -> Optional[float]:
    """
    Safely end a span and restore context.

    Args:
        run_id: Run ID of the span to end
        spans_dict: Dictionary of spans
        status: Status code for the span
        error: Optional exception if error occurred

    Returns:
        Duration of the span in seconds, or None if span not found
    """
    if run_id not in spans_dict:
        return None

    span_holder = spans_dict[run_id]
    span = span_holder.span
    end_time = time.time()
    duration = end_time - span_holder.start_time

    # Set duration attribute
    span.set_attribute(SemanticConvention.GEN_AI_CLIENT_OPERATION_DURATION, duration)

    # Set status
    if error:
        span.set_status(Status(StatusCode.ERROR, str(error)))
        span.record_exception(error)
    else:
        span.set_status(Status(status))

    # End the span
    span.end()

    # Restore context
    if span_holder.context_token:
        context_api.detach(span_holder.context_token)

    # Clean up
    del spans_dict[run_id]

    return duration


def safe_json_dumps(obj: Any, default_str: str = "{}") -> str:
    """Safely serialize object to JSON string."""
    try:
        return json.dumps(obj, default=str)
    except Exception:
        return default_str


def classify_error(error: Exception) -> str:
    """
    Classify errors for better observability.

    Returns an error classification string.
    """
    error_str = str(error).lower()

    if "rate" in error_str or "429" in str(error):
        return "RATE_LIMIT_ERROR"
    if "timeout" in error_str:
        return "TIMEOUT_ERROR"
    if "auth" in error_str or "401" in str(error):
        return "AUTH_ERROR"
    if "not found" in error_str or "404" in str(error):
        return "NOT_FOUND_ERROR"
    if "connection" in error_str:
        return "CONNECTION_ERROR"
    if "validation" in error_str:
        return "VALIDATION_ERROR"
    if "context" in error_str and "length" in error_str:
        return "CONTEXT_LENGTH_ERROR"

    return f"GENERAL_ERROR_{type(error).__name__}"


def set_common_span_attributes(
    span: Span,
    operation_type: str,
    environment: str,
    application_name: str,
    version: str,
    model_name: Optional[str] = None,
    provider: Optional[str] = None,
):
    """
    Set common span attributes for all LangChain operations.

    Args:
        span: The span to set attributes on
        operation_type: Type of operation (chat, workflow, tool, etc.)
        environment: Environment name
        application_name: Application name
        version: SDK version
        model_name: Optional model name
        provider: Optional provider name
    """
    span.set_attribute(
        SemanticConvention.GEN_AI_SYSTEM,
        provider or SemanticConvention.GEN_AI_SYSTEM_LANGCHAIN,
    )
    span.set_attribute(SemanticConvention.GEN_AI_OPERATION, operation_type)
    span.set_attribute(SemanticConvention.GEN_AI_ENVIRONMENT, environment)
    span.set_attribute(SemanticConvention.GEN_AI_APPLICATION_NAME, application_name)
    span.set_attribute(SemanticConvention.GEN_AI_SDK_VERSION, version)

    if model_name and model_name != "unknown":
        span.set_attribute(SemanticConvention.GEN_AI_REQUEST_MODEL, model_name)


def record_llm_metrics(
    metrics: Optional[Dict],
    disable_metrics: bool,
    environment: str,
    application_name: str,
    model_name: str,
    start_time: float,
    end_time: float,
    input_tokens: int,
    output_tokens: int,
    cost: float,
    ttft: float = 0,
    tbt: float = 0,
):
    """
    Record LLM completion metrics.

    Args:
        metrics: Metrics dictionary
        disable_metrics: Whether metrics are disabled
        environment: Environment name
        application_name: Application name
        model_name: Model name
        start_time: Start timestamp
        end_time: End timestamp
        input_tokens: Input token count
        output_tokens: Output token count
        cost: Calculated cost
        ttft: Time to first token
        tbt: Time between tokens
    """
    if disable_metrics or not metrics:
        return

    try:
        record_completion_metrics(
            metrics=metrics,
            gen_ai_operation=SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
            gen_ai_system=SemanticConvention.GEN_AI_SYSTEM_LANGCHAIN,
            server_address="localhost",
            server_port=8080,
            request_model=model_name,
            response_model=model_name,
            environment=environment,
            application_name=application_name,
            start_time=start_time,
            end_time=end_time,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            cost=cost,
            tbt=tbt,
            ttft=ttft,
        )
    except Exception as e:
        logger.debug("Failed to record LLM metrics: %s", e)


def record_workflow_metrics(
    metrics: Optional[Dict],
    disable_metrics: bool,
    environment: str,
    application_name: str,
    operation_type: str,
    start_time: float,
    end_time: float,
):
    """
    Record workflow/framework metrics.

    Args:
        metrics: Metrics dictionary
        disable_metrics: Whether metrics are disabled
        environment: Environment name
        application_name: Application name
        operation_type: Type of operation
        start_time: Start timestamp
        end_time: End timestamp
    """
    if disable_metrics or not metrics:
        return

    try:
        record_framework_metrics(
            metrics=metrics,
            gen_ai_operation=operation_type,
            gen_ai_system=SemanticConvention.GEN_AI_SYSTEM_LANGCHAIN,
            server_address="localhost",
            server_port=8080,
            environment=environment,
            application_name=application_name,
            start_time=start_time,
            end_time=end_time,
        )
    except Exception as e:
        logger.debug("Failed to record workflow metrics: %s", e)
