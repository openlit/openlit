"""
OpenLIT LangChain Instrumentation
"""

import logging
import json
import re
import time
from typing import Any, Collection, Dict, List, Optional, Literal, cast
from uuid import UUID
import importlib.metadata

from opentelemetry.instrumentation.instrumentor import BaseInstrumentor
from opentelemetry.trace import SpanKind, Status, StatusCode

# context_api not needed - callbacks execute in different contexts
from opentelemetry.trace import set_span_in_context
from wrapt import wrap_function_wrapper

from openlit.instrumentation.langchain.utils import (
    build_input_messages,
    common_chat_logic,
)

# Initialize logger
logger = logging.getLogger(__name__)

_instruments = ("langchain-core >= 0.1.20",)


class SpanHolder:
    """Container for span and related metadata with performance optimization via __slots__."""

    __slots__ = (
        "span",
        "token",
        "start_time",
        "children",
        "workflow_name",
        "entity_name",
        "streaming_content",
        "input_tokens",
        "first_token_time",
        "token_timestamps",
        "model_name",
        "model_parameters",
        "prompt_content",
        "input_messages",
        "cache_read_input_tokens",
        "cache_creation_input_tokens",
        "input_messages_raw",
        "prompts",
        "system_instructions",
        "tool_definitions",
        "provider",
        "server_address",
        "server_port",
        "tool_calls",
        "finish_reason",
    )

    def __init__(self, span, token=None, start_time=None):
        self.span = span
        self.token = token
        self.start_time = start_time or time.time()
        self.children: List[UUID] = []
        self.workflow_name = ""
        self.entity_name = ""
        self.streaming_content: List[str] = []
        self.input_tokens = 0
        self.first_token_time: Optional[float] = None
        self.token_timestamps: List[float] = []
        self.model_name = "unknown"
        self.model_parameters: Dict[str, Any] = {}
        self.prompt_content = ""
        self.input_messages: List[Dict[str, Any]] = []
        self.cache_read_input_tokens = 0
        self.cache_creation_input_tokens = 0
        self.input_messages_raw: Any = None
        self.prompts: List[Any] = []
        self.system_instructions: Optional[List[Dict[str, Any]]] = None
        self.tool_definitions: Optional[List[Dict[str, Any]]] = None
        self.provider: str = ""
        self.server_address: str = ""
        self.server_port: int = 0
        self.tool_calls: Optional[List[Dict[str, Any]]] = None
        self.finish_reason: str = "stop"

    def get_duration(self) -> float:
        """Calculate duration from start time to now."""
        return time.time() - self.start_time

    def is_streaming(self) -> bool:
        """Check if this is a streaming response."""
        return len(self.streaming_content) > 0


# =============================================================================
# Model Name Extraction (from Langfuse)
# =============================================================================

# Known model paths for specific providers
MODEL_PATHS_BY_ID = [
    # Google
    ("ChatGoogleGenerativeAI", ["kwargs", "model"], "serialized"),
    ("ChatVertexAI", ["kwargs", "model_name"], "serialized"),
    # Mistral
    ("ChatMistralAI", ["kwargs", "model"], "serialized"),
    # OpenAI
    ("OpenAI", ["invocation_params", "model_name"], "kwargs"),
    ("ChatOpenAI", ["invocation_params", "model_name"], "kwargs"),
    ("AzureChatOpenAI", ["invocation_params", "model"], "kwargs"),
    ("AzureChatOpenAI", ["invocation_params", "model_name"], "kwargs"),
    ("AzureChatOpenAI", ["invocation_params", "azure_deployment"], "kwargs"),
    # HuggingFace
    ("HuggingFacePipeline", ["invocation_params", "model_id"], "kwargs"),
    # Bedrock
    ("BedrockChat", ["kwargs", "model_id"], "serialized"),
    ("Bedrock", ["kwargs", "model_id"], "serialized"),
    ("BedrockLLM", ["kwargs", "model_id"], "serialized"),
    ("ChatBedrock", ["kwargs", "model_id"], "serialized"),
    ("ChatBedrockConverse", ["kwargs", "model_id"], "serialized"),
    # Other
    ("LlamaCpp", ["invocation_params", "model_path"], "kwargs"),
    ("WatsonxLLM", ["invocation_params", "model_id"], "kwargs"),
]

# Regex patterns for models where name is in repr string
MODEL_PATTERNS = [
    ("ChatAnthropic", "model", "anthropic"),
    ("Anthropic", "model", "anthropic"),
    ("ChatTongyi", "model_name", None),
    ("ChatCohere", "model", None),
    ("Cohere", "model", None),
    ("HuggingFaceHub", "model", None),
    ("ChatAnyscale", "model_name", None),
    ("TextGen", "model", "text-gen"),
    ("Ollama", "model", None),
    ("OllamaLLM", "model", None),
    ("ChatOllama", "model", None),
    ("ChatFireworks", "model", None),
    ("ChatPerplexity", "model", None),
    ("VLLM", "model", None),
    ("Xinference", "model_uid", None),
    ("ChatOCIGenAI", "model_id", None),
    ("DeepInfra", "model_id", None),
]

# Fallback paths to try
FALLBACK_PATHS = [
    (["kwargs", "model_name"], "serialized"),
    (["kwargs", "model"], "serialized"),
    (["kwargs", "model_id"], "serialized"),
    (["invocation_params", "model_name"], "kwargs"),
    (["invocation_params", "model"], "kwargs"),
    (["invocation_params", "model_id"], "kwargs"),
]


def _extract_by_path(
    serialized: Optional[Dict[str, Any]],
    kwargs: Dict[str, Any],
    keys: List[str],
    select_from: Literal["serialized", "kwargs"],
) -> Optional[str]:
    """Extract value from nested dict by path."""
    current_obj = kwargs if select_from == "kwargs" else serialized
    if current_obj is None:
        return None

    for key in keys:
        if isinstance(current_obj, dict):
            current_obj = current_obj.get(key)
        else:
            return None
        if current_obj is None:
            return None

    return str(current_obj) if current_obj else None


def _get_class_name(serialized: Optional[Dict[str, Any]]) -> Optional[str]:
    """Get class name from serialized id."""
    if not serialized:
        return None
    serialized_id = serialized.get("id")
    if serialized_id and isinstance(serialized_id, list) and len(serialized_id) > 0:
        return serialized_id[-1]
    return None


def _extract_model_from_repr(
    serialized: Optional[Dict[str, Any]], pattern: str
) -> Optional[str]:
    """Extract model name from repr string using regex."""
    if not serialized:
        return None
    repr_str = serialized.get("repr", "")
    if repr_str:
        match = re.search(rf"{pattern}='(.*?)'", repr_str)
        if match:
            return match.group(1)
    return None


def extract_model_name(
    serialized: Optional[Dict[str, Any]],
    kwargs: Optional[Dict[str, Any]] = None,
) -> str:
    """
    Comprehensive model name extraction (based on Langfuse's approach).

    Tries multiple strategies:
    1. Known model paths for specific providers
    2. Regex patterns from repr strings
    3. Fallback paths
    """
    if kwargs is None:
        kwargs = {}

    class_name = _get_class_name(serialized)

    # 1. Try known model paths
    for model_id, keys, select_from in MODEL_PATHS_BY_ID:
        if class_name == model_id:
            result = _extract_by_path(
                serialized,
                kwargs,
                keys,
                cast(Literal["serialized", "kwargs"], select_from),
            )
            if result:
                return result

    # 2. Try regex patterns
    for model_id, pattern, default in MODEL_PATTERNS:
        if class_name == model_id:
            result = _extract_model_from_repr(serialized, pattern)
            if result:
                return result
            if default:
                return default

    # 3. Try fallback paths
    for keys, select_from in FALLBACK_PATHS:
        result = _extract_by_path(
            serialized, kwargs, keys, cast(Literal["serialized", "kwargs"], select_from)
        )
        if result:
            return result

    # 4. Return class name or unknown
    return class_name or "unknown"


def extract_model_parameters(kwargs: Dict[str, Any]) -> Dict[str, Any]:
    """
    Extract model parameters from invocation_params (based on Langfuse's approach).
    """
    params = {}
    invocation_params = kwargs.get("invocation_params", {})

    param_keys = [
        "temperature",
        "max_tokens",
        "max_completion_tokens",
        "top_p",
        "top_k",
        "frequency_penalty",
        "presence_penalty",
        "request_timeout",
        "stop_sequences",
        "seed",
    ]

    for key in param_keys:
        value = invocation_params.get(key)
        if value is not None:
            params[key] = value

    return params


# =============================================================================
# Provider Detection
# =============================================================================

PROVIDER_MAP = {
    "anthropic": "anthropic",
    "azure": "azure",
    "bedrock": "aws.bedrock",
    "bedrock_converse": "aws.bedrock",
    "cohere": "cohere",
    "google": "google",
    "google_genai": "google",
    "google_vertexai": "google",
    "groq": "groq",
    "mistralai": "mistral_ai",
    "ollama": "ollama",
    "openai": "openai",
    "together": "together",
    "vertexai": "google",
    "fireworks": "fireworks",
    "perplexity": "perplexity",
    "huggingface": "huggingface",
    "deepinfra": "deepinfra",
    "anyscale": "anyscale",
}


PROVIDER_DEFAULT_ENDPOINTS = {
    "openai": ("api.openai.com", 443),
    "anthropic": ("api.anthropic.com", 443),
    "google": ("generativelanguage.googleapis.com", 443),
    "mistral_ai": ("api.mistral.ai", 443),
    "groq": ("api.groq.com", 443),
    "together": ("api.together.xyz", 443),
    "fireworks": ("api.fireworks.ai", 443),
    "perplexity": ("api.perplexity.ai", 443),
    "deepinfra": ("api.deepinfra.com", 443),
    "aws.bedrock": ("bedrock-runtime.amazonaws.com", 443),
    "azure": ("openai.azure.com", 443),
    "cohere": ("api.cohere.ai", 443),
    "ollama": ("localhost", 11434),
}


def detect_provider(serialized: Optional[Dict[str, Any]]) -> str:
    """Detect the LLM provider from serialized class info."""
    from openlit.semcov import SemanticConvention

    if not serialized:
        return SemanticConvention.GEN_AI_SYSTEM_LANGCHAIN

    class_id = serialized.get("id", [])
    if isinstance(class_id, list):
        class_path = ".".join(class_id).lower()
        for provider, system in PROVIDER_MAP.items():
            if provider in class_path:
                return system

    return SemanticConvention.GEN_AI_SYSTEM_LANGCHAIN


_SKIP_CHAIN_CLASS_PREFIXES = frozenset(
    {
        "RunnableSequence",
        "RunnableParallel",
        "RunnableLambda",
        "RunnablePassthrough",
        "RunnableAssign",
        "RunnablePick",
        "RunnableBranch",
        "RunnableEach",
        "Prompt",
        "PromptTemplate",
        "ChatPromptTemplate",
        "MessagesPlaceholder",
        "SystemMessagePromptTemplate",
        "HumanMessagePromptTemplate",
        "AIMessagePromptTemplate",
        "BasePromptTemplate",
        "StrOutputParser",
        "JsonOutputParser",
        "PydanticOutputParser",
    }
)


def _is_internal_chain(serialized: Optional[Dict[str, Any]], name: str) -> bool:
    """Return True if this chain is internal LCEL / LangGraph plumbing that
    should NOT produce a user-visible span."""
    if serialized and "id" in serialized:
        class_path = serialized["id"]
        if isinstance(class_path, list) and class_path:
            class_name = str(class_path[-1])
            if class_name in _SKIP_CHAIN_CLASS_PREFIXES:
                return True
            if class_name.startswith("Runnable"):
                return True

    if name in _SKIP_CHAIN_CLASS_PREFIXES:
        return True

    return False


def detect_observation_type(
    serialized: Optional[Dict[str, Any]], callback_type: str, name: str = ""
) -> str:
    """
    Detect observation type (based on Langfuse's approach).
    Distinguishes agents from regular chains.
    """
    if callback_type == "tool":
        return "tool"
    elif callback_type == "retriever":
        return "retriever"
    elif callback_type == "llm":
        return "generation"
    elif callback_type == "chain":
        # Detect if it's an agent
        if serialized and "id" in serialized:
            class_path = serialized["id"]
            if any("agent" in str(part).lower() for part in class_path):
                return "agent"

        # Check name for agent keywords
        if name and "agent" in name.lower():
            return "agent"

        return "chain"

    return "span"


# =============================================================================
# Helpers
# =============================================================================


def _resolve_conversation_id(metadata: Optional[Dict[str, Any]]) -> Optional[str]:
    """Extract conversation/thread ID from LangChain callback metadata."""
    if not metadata:
        return None
    for key in ("thread_id", "conversation_id", "session_id"):
        val = metadata.get(key)
        if val:
            return str(val)
    configurable = metadata.get("configurable", {})
    for key in ("thread_id", "conversation_id"):
        val = configurable.get(key)
        if val:
            return str(val)
    return None


# =============================================================================
# Callback Handler
# =============================================================================


def _create_callback_handler_class(
    tracer,
    version,
    environment,
    application_name,
    pricing_info,
    capture_message_content,
    metrics,
    disable_metrics,
    event_provider=None,
):
    """
    Create and return an OpenLITCallbackHandler class configured with the given parameters.
    """
    try:
        from langchain_core.callbacks import BaseCallbackHandler
        from langchain_core.messages import BaseMessage
        from langchain_core.outputs import LLMResult
    except ImportError:
        logger.debug("langchain_core not available")
        return None

    from openlit.__helpers import (
        general_tokens,
        record_framework_metrics,
        calculate_ttft,
        calculate_tbt,
        truncate_content,
        is_langgraph_wrapper_active,
        set_framework_llm_active,
        reset_framework_llm_active,
    )
    from openlit.semcov import SemanticConvention

    class OpenLITCallbackHandler(BaseCallbackHandler):
        """
        OpenLIT LangChain Callback Handler with comprehensive instrumentation.
        """

        def __init__(self) -> None:
            super().__init__()
            self._tracer = tracer
            self._version = version
            self._environment = environment
            self._application_name = application_name
            self._pricing_info = pricing_info
            self._capture_message_content = capture_message_content
            self._metrics = metrics
            self._disable_metrics = disable_metrics
            self._event_provider = event_provider
            self.spans: Dict[UUID, SpanHolder] = {}
            self.run_inline = True
            # Tracks skipped chain run_ids -> their parent_run_id so children
            # can walk up to find a real (non-skipped) parent span.
            self._skipped_runs: Dict[UUID, Optional[UUID]] = {}

        def _get_name_from_callback(
            self,
            serialized: Optional[Dict[str, Any]],
            **kwargs: Any,
        ) -> str:
            """Get the name to be used for the span."""
            if kwargs.get("name"):
                return kwargs["name"]
            if serialized:
                if "kwargs" in serialized and serialized["kwargs"].get("name"):
                    return serialized["kwargs"]["name"]
                if serialized.get("name"):
                    return serialized["name"]
                if "id" in serialized:
                    class_id = serialized["id"]
                    if isinstance(class_id, list) and len(class_id) > 0:
                        return class_id[-1]
            return "unknown"

        def _resolve_parent_run_id(
            self, parent_run_id: Optional[UUID]
        ) -> Optional[UUID]:
            """Walk up through skipped runs to find the nearest real parent."""
            visited = set()
            current = parent_run_id
            while current is not None and current in self._skipped_runs:
                if current in visited:
                    break
                visited.add(current)
                current = self._skipped_runs[current]
            return current

        def _create_span(
            self,
            run_id: UUID,
            parent_run_id: Optional[UUID],
            span_name: str,
            kind: SpanKind = SpanKind.INTERNAL,
        ) -> Any:
            """Create a new span with proper parent relationship."""
            # For callback-based instrumentation, we manage parent-child relationships
            # via the parent_context parameter, not via context attachment.
            # This avoids "Failed to detach context" errors in streaming scenarios
            # where callbacks may execute in different execution contexts.
            parent_run_id = self._resolve_parent_run_id(parent_run_id)
            parent_context = None
            if parent_run_id is not None and parent_run_id in self.spans:
                parent_span = self.spans[parent_run_id].span
                parent_context = set_span_in_context(parent_span)

            span = self._tracer.start_span(
                span_name,
                context=parent_context,
                kind=kind,
            )

            # Don't attach to context - callbacks can execute in different contexts
            holder = SpanHolder(span, token=None)
            self.spans[run_id] = holder

            if parent_run_id is not None and parent_run_id in self.spans:
                self.spans[parent_run_id].children.append(run_id)

            return span

        def _end_span(self, run_id: UUID, error: Optional[str] = None) -> None:
            """End a span and clean up."""
            if run_id not in self.spans:
                return

            holder = self.spans[run_id]
            span = holder.span

            # End any child spans that are still open
            for child_id in holder.children:
                if child_id in self.spans:
                    child_holder = self.spans[child_id]
                    if child_holder.span.end_time is None:
                        child_holder.span.end()

            if error:
                span.set_status(Status(StatusCode.ERROR, error))
            else:
                span.set_status(Status(StatusCode.OK))

            span.end()

            del self.spans[run_id]

        def _set_common_attributes(self, span, operation_type: str) -> None:
            """Set common attributes on a span."""
            span.set_attribute(SemanticConvention.GEN_AI_OPERATION, operation_type)
            span.set_attribute(SemanticConvention.GEN_AI_ENVIRONMENT, self._environment)
            span.set_attribute(
                SemanticConvention.GEN_AI_APPLICATION_NAME, self._application_name
            )
            span.set_attribute(SemanticConvention.GEN_AI_SDK_VERSION, self._version)

        def _extract_from_generations(
            self,
            holder,
            response,
            input_tokens: int,
            output_tokens: int,
            completion_content: str,
        ) -> tuple:
            """
            Extract token usage and content from response.generations.
            Based on Langfuse's _parse_usage approach for comprehensive extraction.
            """
            if not response.generations:
                return input_tokens, output_tokens, completion_content

            for gen_list in response.generations:
                for gen in gen_list:
                    # Extract content
                    gen_content = self._extract_generation_content(gen)
                    if gen_content and (
                        not completion_content
                        or len(gen_content) > len(completion_content)
                    ):
                        completion_content = gen_content

                    # Extract usage from message (pass holder for cache tokens)
                    tokens = self._extract_message_usage(
                        gen, input_tokens, output_tokens, holder=holder
                    )
                    input_tokens, output_tokens = tokens

                    # Check generation_info as fallback
                    if hasattr(gen, "generation_info") and gen.generation_info:
                        gen_info = gen.generation_info
                        if "usage" in gen_info:
                            usage = gen_info["usage"]
                            input_tokens = usage.get("input_tokens", input_tokens)
                            output_tokens = usage.get("output_tokens", output_tokens)

            return input_tokens, output_tokens, completion_content

        def _extract_generation_content(self, gen) -> Optional[str]:
            """Extract content from a generation object."""
            if hasattr(gen, "text") and gen.text:
                return gen.text
            if hasattr(gen, "message") and gen.message:
                msg = gen.message
                if hasattr(msg, "content") and msg.content:
                    return (
                        msg.content
                        if isinstance(msg.content, str)
                        else str(msg.content)
                    )
            return None

        def _join_streaming_content(self, streaming_content: List[Any]) -> str:
            """
            Join streaming content into a single string.
            Handles nested lists and ensures all items are properly converted.
            """
            if not streaming_content:
                return ""

            str_parts = []
            for item in streaming_content:
                if isinstance(item, str) and item:
                    str_parts.append(item)
                elif isinstance(item, list):
                    str_parts.extend(self._flatten_list_item(item))
                elif item:
                    str_parts.append(str(item))

            return "".join(str_parts) if str_parts else ""

        def _flatten_list_item(self, items: List[Any]) -> List[str]:
            """Flatten a list of items into strings."""
            result = []
            for sub in items:
                if isinstance(sub, str) and sub:
                    result.append(sub)
                elif sub:
                    result.append(str(sub))
            return result

        def _extract_message_usage(
            self, gen, input_tokens: int, output_tokens: int, holder: Any = None
        ) -> tuple:
            """
            Extract token usage from message metadata.
            Handles multiple formats based on Langfuse's comprehensive approach:
            - usage_metadata (standard LangChain)
            - response_metadata.usage (Bedrock-Anthropic)
            - response_metadata.amazon-bedrock-invocationMetrics (Bedrock-Titan)
            When holder is provided, also sets holder.cache_read_input_tokens and
            holder.cache_creation_input_tokens from usage when present.
            """
            if not hasattr(gen, "message") or not gen.message:
                return input_tokens, output_tokens

            msg = gen.message

            # Handle token usage including reasoning tokens and cached tokens
            if hasattr(msg, "usage_metadata") and msg.usage_metadata:
                usage = msg.usage_metadata
                input_tokens = (
                    usage.get("input_tokens")
                    or usage.get("prompt_tokens")
                    or input_tokens
                )
                output_tokens = (
                    usage.get("output_tokens")
                    or usage.get("completion_tokens")
                    or output_tokens
                )
                if holder is not None:
                    # OpenAI-style: prompt_tokens_details.cached_tokens / input_tokens_details.cache_creation_tokens
                    prompt_details = (
                        usage.get("prompt_tokens_details")
                        or usage.get("input_tokens_details")
                        or {}
                    )
                    cached = prompt_details.get("cached_tokens", 0) or 0
                    input_details = usage.get("input_tokens_details") or {}
                    creation = input_details.get("cache_creation_tokens", 0) or 0
                    # LangChain usage_metadata: input_token_details.cache_read / cache_creation
                    langchain_input = usage.get("input_token_details") or {}
                    if cached == 0:
                        cached = langchain_input.get("cache_read", 0) or 0
                    if creation == 0:
                        creation = langchain_input.get("cache_creation", 0) or 0
                    holder.cache_read_input_tokens = cached
                    holder.cache_creation_input_tokens = creation

            # Check response_metadata (Bedrock, OpenAI via LangChain, etc.)
            if hasattr(msg, "response_metadata") and msg.response_metadata:
                metadata = msg.response_metadata
                if isinstance(metadata, dict):
                    # OpenAI-style (e.g. LangChain OpenAI): token_usage with prompt_tokens_details
                    token_usage = metadata.get("token_usage")
                    if token_usage:
                        input_tokens = (
                            token_usage.get("prompt_tokens")
                            or token_usage.get("input_tokens")
                            or input_tokens
                        )
                        output_tokens = (
                            token_usage.get("completion_tokens")
                            or token_usage.get("output_tokens")
                            or output_tokens
                        )
                        if holder is not None:
                            prompt_details = (
                                token_usage.get("prompt_tokens_details")
                                or token_usage.get("input_tokens_details")
                                or {}
                            )
                            if holder.cache_read_input_tokens == 0:
                                holder.cache_read_input_tokens = (
                                    prompt_details.get("cached_tokens", 0) or 0
                                )
                            input_details = (
                                token_usage.get("input_tokens_details") or {}
                            )
                            if holder.cache_creation_input_tokens == 0:
                                holder.cache_creation_input_tokens = (
                                    input_details.get("cache_creation_tokens", 0) or 0
                                )

                    # Bedrock-Anthropic style: usage with inputTokens/outputTokens
                    if "usage" in metadata:
                        usage = metadata["usage"]
                        input_tokens = usage.get(
                            "inputTokens", usage.get("input_tokens", input_tokens)
                        )
                        output_tokens = usage.get(
                            "outputTokens", usage.get("output_tokens", output_tokens)
                        )

                    # Bedrock-Titan style (amazon-bedrock-invocationMetrics)
                    if "amazon-bedrock-invocationMetrics" in metadata:
                        metrics = metadata["amazon-bedrock-invocationMetrics"]
                        input_tokens = metrics.get("inputTokenCount", input_tokens)
                        output_tokens = metrics.get("outputTokenCount", output_tokens)

            return input_tokens, output_tokens

        def _set_model_parameters(self, span, params: Dict[str, Any]) -> None:
            """Set model parameters as span attributes."""
            if params.get("temperature") is not None:
                span.set_attribute(
                    SemanticConvention.GEN_AI_REQUEST_TEMPERATURE, params["temperature"]
                )
            if params.get("max_tokens") is not None:
                span.set_attribute(
                    SemanticConvention.GEN_AI_REQUEST_MAX_TOKENS, params["max_tokens"]
                )
            if params.get("top_p") is not None:
                span.set_attribute(
                    SemanticConvention.GEN_AI_REQUEST_TOP_P, params["top_p"]
                )
            if params.get("top_k") is not None:
                span.set_attribute(
                    SemanticConvention.GEN_AI_REQUEST_TOP_K, params["top_k"]
                )
            if params.get("frequency_penalty") is not None:
                span.set_attribute(
                    SemanticConvention.GEN_AI_REQUEST_FREQUENCY_PENALTY,
                    params["frequency_penalty"],
                )
            if params.get("presence_penalty") is not None:
                span.set_attribute(
                    SemanticConvention.GEN_AI_REQUEST_PRESENCE_PENALTY,
                    params["presence_penalty"],
                )
            if params.get("seed") is not None:
                span.set_attribute(
                    SemanticConvention.GEN_AI_REQUEST_SEED, params["seed"]
                )

        # =================================================================
        # Chain Callbacks
        # =================================================================

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
            """Run when chain starts."""
            try:
                name = self._get_name_from_callback(serialized, **kwargs)
                obs_type = detect_observation_type(serialized, "chain", name=name)

                if obs_type != "agent" and _is_internal_chain(serialized, name):
                    self._skipped_runs[run_id] = parent_run_id
                    return

                # Suppress the top-level graph callback span when LangGraph wrapper
                # already created the root span.
                if (
                    obs_type != "agent"
                    and is_langgraph_wrapper_active()
                    and parent_run_id is None
                ):
                    self._skipped_runs[run_id] = parent_run_id
                    return

                # Skip all non-agent intermediate chains (graph-node wrappers
                # like call_model, should_continue). They don't map to any OTel
                # semantic convention and their parent hierarchy is unreliable.
                # Children are re-parented via _resolve_parent_run_id.
                if obs_type != "agent" and parent_run_id is not None:
                    self._skipped_runs[run_id] = parent_run_id
                    return

                if obs_type == "agent":
                    operation_type = SemanticConvention.GEN_AI_OPERATION_TYPE_AGENT
                    span_name = f"invoke_agent {name}"
                else:
                    operation_type = SemanticConvention.GEN_AI_OPERATION_TYPE_FRAMEWORK
                    span_name = f"invoke_workflow {name}"

                span = self._create_span(run_id, parent_run_id, span_name)

                span.set_attribute(
                    SemanticConvention.GEN_AI_PROVIDER_NAME,
                    SemanticConvention.GEN_AI_SYSTEM_LANGCHAIN,
                )
                self._set_common_attributes(span, operation_type)

                if obs_type == "agent":
                    span.set_attribute(SemanticConvention.GEN_AI_AGENT_NAME, name)
                else:
                    span.set_attribute(SemanticConvention.GEN_AI_WORKFLOW_NAME, name)

                conv_id = _resolve_conversation_id(metadata)
                if conv_id:
                    span.set_attribute(
                        SemanticConvention.GEN_AI_CONVERSATION_ID, conv_id
                    )

                if self._capture_message_content and inputs:
                    try:
                        input_str = truncate_content(json.dumps(inputs, default=str))
                    except Exception:
                        input_str = truncate_content(inputs)
                    span.set_attribute(
                        SemanticConvention.GEN_AI_WORKFLOW_INPUT, input_str
                    )

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
            """Run when chain ends."""
            try:
                self._skipped_runs.pop(run_id, None)
                if run_id not in self.spans:
                    return

                holder = self.spans[run_id]
                span = holder.span
                duration = time.time() - holder.start_time

                span.set_attribute(
                    SemanticConvention.GEN_AI_CLIENT_OPERATION_DURATION, duration
                )

                if self._capture_message_content and outputs:
                    try:
                        output_str = truncate_content(json.dumps(outputs, default=str))
                    except Exception:
                        output_str = truncate_content(outputs)
                    span.set_attribute(
                        SemanticConvention.GEN_AI_WORKFLOW_OUTPUT, output_str
                    )

                # Record metrics
                if not self._disable_metrics and self._metrics:
                    try:
                        record_framework_metrics(
                            metrics=self._metrics,
                            gen_ai_operation=SemanticConvention.GEN_AI_OPERATION_TYPE_FRAMEWORK,
                            GEN_AI_PROVIDER_NAME=SemanticConvention.GEN_AI_SYSTEM_LANGCHAIN,
                            server_address="localhost",
                            server_port=8080,
                            environment=self._environment,
                            application_name=self._application_name,
                            start_time=holder.start_time,
                            end_time=time.time(),
                        )
                    except Exception as e:
                        logger.debug("Error recording chain metrics: %s", e)

                self._end_span(run_id)

            except Exception as e:
                logger.debug("Error in on_chain_end: %s", e)

        def on_chain_error(
            self,
            error: BaseException,
            *,
            run_id: UUID,
            parent_run_id: Optional[UUID] = None,
            **kwargs: Any,
        ) -> None:
            """Run when chain errors."""
            try:
                self._skipped_runs.pop(run_id, None)
                if run_id in self.spans:
                    span = self.spans[run_id].span
                    span.set_attribute(
                        SemanticConvention.GEN_AI_FRAMEWORK_ERROR_MESSAGE,
                        truncate_content(error),
                    )
                self._end_span(run_id, str(error))
            except Exception as e:
                logger.debug("Error in on_chain_error: %s", e)

        # =================================================================
        # LLM Callbacks
        # =================================================================

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
            """Run when LLM starts."""
            try:
                model_name = extract_model_name(serialized, kwargs)
                model_params = extract_model_parameters(kwargs)
                provider = detect_provider(serialized)
                span_name = f"chat {model_name}"

                span = self._create_span(
                    run_id, parent_run_id, span_name, SpanKind.CLIENT
                )

                # Suppress duplicate provider spans while framework owns the LLM span
                fw_token = set_framework_llm_active()
                from opentelemetry import context as otel_context

                ctx_token = otel_context.attach(set_span_in_context(span))
                self.spans[run_id].token = (fw_token, ctx_token)

                span.set_attribute(SemanticConvention.GEN_AI_PROVIDER_NAME, provider)
                self._set_common_attributes(
                    span, SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT
                )
                span.set_attribute(SemanticConvention.GEN_AI_REQUEST_MODEL, model_name)
                self._set_model_parameters(span, model_params)

                conv_id = _resolve_conversation_id(metadata)
                if conv_id:
                    span.set_attribute(
                        SemanticConvention.GEN_AI_CONVERSATION_ID, conv_id
                    )

                # Store model info for later
                self.spans[run_id].model_name = model_name
                self.spans[run_id].model_parameters = model_params
                self.spans[run_id].prompts = prompts if prompts else []
                self.spans[run_id].provider = provider

                # Resolve server address from invocation_params or provider defaults
                invocation_params = kwargs.get("invocation_params", {})
                api_base = invocation_params.get("api_base") or invocation_params.get(
                    "base_url"
                )
                if api_base:
                    try:
                        from urllib.parse import urlparse

                        parsed = urlparse(api_base)
                        self.spans[run_id].server_address = parsed.hostname or ""
                        self.spans[run_id].server_port = parsed.port or 443
                    except Exception:
                        pass
                if (
                    not self.spans[run_id].server_address
                    and provider in PROVIDER_DEFAULT_ENDPOINTS
                ):
                    default_host, default_port = PROVIDER_DEFAULT_ENDPOINTS[provider]
                    self.spans[run_id].server_address = default_host
                    self.spans[run_id].server_port = default_port

                if self._capture_message_content and prompts:
                    prompt_str = truncate_content("\n".join(prompts))
                    span.set_attribute(
                        SemanticConvention.GEN_AI_INPUT_MESSAGES, prompt_str
                    )
                    self.spans[run_id].input_tokens = general_tokens(prompt_str)

                    # Store structured prompts for event emission
                    try:
                        structured_prompts = build_input_messages(prompts)
                        self.spans[run_id].input_messages = structured_prompts
                    except Exception as prompt_err:
                        logger.debug(
                            "Error building structured prompts: %s", prompt_err
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
            """Run when Chat Model starts."""
            try:
                model_name = extract_model_name(serialized, kwargs)
                model_params = extract_model_parameters(kwargs)
                provider = detect_provider(serialized)
                span_name = f"chat {model_name}"

                span = self._create_span(
                    run_id, parent_run_id, span_name, SpanKind.CLIENT
                )

                # Suppress duplicate OpenAI/provider spans while framework owns the LLM span
                fw_token = set_framework_llm_active()

                # Attach our span to OTel context so HTTP client spans nest under it
                from opentelemetry import context as otel_context

                ctx_token = otel_context.attach(set_span_in_context(span))
                self.spans[run_id].token = (fw_token, ctx_token)

                span.set_attribute(SemanticConvention.GEN_AI_PROVIDER_NAME, provider)
                self._set_common_attributes(
                    span, SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT
                )
                span.set_attribute(SemanticConvention.GEN_AI_REQUEST_MODEL, model_name)
                self._set_model_parameters(span, model_params)

                conv_id = _resolve_conversation_id(metadata)
                if conv_id:
                    span.set_attribute(
                        SemanticConvention.GEN_AI_CONVERSATION_ID, conv_id
                    )

                # Store model info and provider/server details
                self.spans[run_id].model_name = model_name
                self.spans[run_id].model_parameters = model_params
                self.spans[run_id].provider = provider

                # Resolve server address from invocation_params or provider defaults
                invocation_params = kwargs.get("invocation_params", {})
                api_base = invocation_params.get("api_base") or invocation_params.get(
                    "base_url"
                )
                if api_base:
                    try:
                        from urllib.parse import urlparse

                        parsed = urlparse(api_base)
                        self.spans[run_id].server_address = parsed.hostname or ""
                        self.spans[run_id].server_port = parsed.port or 443
                    except Exception:
                        pass
                if (
                    not self.spans[run_id].server_address
                    and provider in PROVIDER_DEFAULT_ENDPOINTS
                ):
                    default_host, default_port = PROVIDER_DEFAULT_ENDPOINTS[provider]
                    self.spans[run_id].server_address = default_host
                    self.spans[run_id].server_port = default_port

                # Always calculate prompt content for token estimation
                if messages:
                    formatted = []
                    for msg_list in messages:
                        for msg in msg_list:
                            role = getattr(msg, "type", "unknown")
                            content = getattr(msg, "content", str(msg))
                            formatted.append(f"{role}: {content}")
                    prompt_str = truncate_content("\n".join(formatted))

                    # Store prompt for token estimation and raw messages for common_chat_logic
                    self.spans[run_id].prompt_content = prompt_str
                    self.spans[run_id].input_tokens = general_tokens(prompt_str)
                    self.spans[run_id].input_messages_raw = messages

                    # Extract system instructions from messages
                    if self._capture_message_content:
                        sys_instructions = []
                        for msg_list in messages:
                            for msg in msg_list:
                                role = getattr(msg, "type", "")
                                if role == "system":
                                    content = getattr(msg, "content", "")
                                    if content:
                                        sys_instructions.append(str(content))
                        if sys_instructions:
                            self.spans[run_id].system_instructions = sys_instructions
                            span.set_attribute(
                                SemanticConvention.GEN_AI_SYSTEM_INSTRUCTIONS,
                                json.dumps(sys_instructions),
                            )

                    # Extract tool definitions from invocation params
                    invocation_params = kwargs.get("invocation_params", {})
                    tools = invocation_params.get("tools") or invocation_params.get(
                        "functions"
                    )
                    if tools and isinstance(tools, list):
                        self.spans[run_id].tool_definitions = tools
                        span.set_attribute(
                            SemanticConvention.GEN_AI_TOOL_DEFINITIONS,
                            json.dumps(tools, default=str),
                        )

                    # Set prompt attribute if capturing content
                    if self._capture_message_content:
                        span.set_attribute(
                            SemanticConvention.GEN_AI_INPUT_MESSAGES, prompt_str
                        )

                    # Store structured messages for event emission
                    try:
                        structured_msgs = build_input_messages(messages)
                        self.spans[run_id].input_messages = structured_msgs
                    except Exception as msg_err:
                        logger.debug("Error building structured messages: %s", msg_err)

            except Exception as e:
                logger.debug("Error in on_chat_model_start: %s", e)

        def on_llm_new_token(
            self,
            token: str,
            *,
            run_id: UUID,
            parent_run_id: Optional[UUID] = None,
            chunk: Any = None,
            **kwargs: Any,
        ) -> None:
            """Run on new LLM token (streaming) - tracks TTFT."""
            try:
                if run_id in self.spans:
                    holder = self.spans[run_id]
                    current_time = time.time()

                    # Track first token time for TTFT
                    if holder.first_token_time is None:
                        holder.first_token_time = current_time

                    # Track timestamps for TBT calculation
                    holder.token_timestamps.append(current_time)

                    # Helper to extract string from content (handles list, str, etc.)
                    def extract_str(content):
                        if content is None:
                            return None
                        if isinstance(content, str):
                            return content if content else None
                        if isinstance(content, list):
                            # Flatten list of content items
                            parts = []
                            for item in content:
                                if isinstance(item, str):
                                    parts.append(item)
                                elif isinstance(item, dict) and "text" in item:
                                    parts.append(str(item["text"]))
                                elif hasattr(item, "text"):
                                    parts.append(str(item.text))
                                else:
                                    parts.append(str(item))
                            return "".join(parts) if parts else None
                        return str(content)

                    # Append the token content
                    token_str = extract_str(token)
                    if token_str:
                        holder.streaming_content.append(token_str)

                    # Also try to get content from chunk if available
                    # Some providers (Bedrock, etc.) pass content in chunk
                    if not token_str and chunk is not None:
                        chunk_content = None
                        if hasattr(chunk, "content") and chunk.content:
                            chunk_content = extract_str(chunk.content)
                        elif hasattr(chunk, "text") and chunk.text:
                            chunk_content = extract_str(chunk.text)
                        elif hasattr(chunk, "message"):
                            msg = chunk.message
                            if hasattr(msg, "content") and msg.content:
                                chunk_content = extract_str(msg.content)

                        if chunk_content:
                            holder.streaming_content.append(chunk_content)

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
            """Run when LLM ends."""
            try:
                if run_id not in self.spans:
                    return

                holder = self.spans[run_id]
                span = holder.span
                end_time = time.time()
                duration = end_time - holder.start_time

                span.set_attribute(
                    SemanticConvention.GEN_AI_CLIENT_OPERATION_DURATION, duration
                )

                # Calculate TTFT and TBT
                ttft = 0.0
                tbt = 0.0
                is_streaming = len(holder.streaming_content) > 0

                if is_streaming:
                    ttft = calculate_ttft(holder.token_timestamps, holder.start_time)
                    tbt = calculate_tbt(holder.token_timestamps)

                # Extract response content and token usage
                input_tokens = holder.input_tokens
                output_tokens = 0
                completion_content = self._join_streaming_content(
                    holder.streaming_content
                )
                model_name = holder.model_name

                input_tokens, output_tokens, completion_content = (
                    self._extract_from_generations(
                        holder,
                        response,
                        input_tokens,
                        output_tokens,
                        completion_content,
                    )
                )

                # Extract tool_calls and finish_reason from generations
                if response.generations:
                    for gen_list in response.generations:
                        for gen in gen_list:
                            msg = getattr(gen, "message", None)
                            if msg:
                                tc = getattr(msg, "tool_calls", None)
                                if tc:
                                    formatted_tools = []
                                    for call in tc:
                                        if isinstance(call, dict):
                                            formatted_tools.append(
                                                {
                                                    "id": call.get("id", ""),
                                                    "function": {
                                                        "name": call.get("name", ""),
                                                        "arguments": json.dumps(
                                                            call.get("args", {})
                                                        )
                                                        if isinstance(
                                                            call.get("args"), dict
                                                        )
                                                        else str(call.get("args", "")),
                                                    },
                                                }
                                            )
                                        else:
                                            formatted_tools.append(
                                                {
                                                    "id": getattr(call, "id", ""),
                                                    "function": {
                                                        "name": getattr(
                                                            call, "name", ""
                                                        ),
                                                        "arguments": json.dumps(
                                                            getattr(call, "args", {})
                                                        )
                                                        if isinstance(
                                                            getattr(call, "args", None),
                                                            dict,
                                                        )
                                                        else str(
                                                            getattr(call, "args", "")
                                                        ),
                                                    },
                                                }
                                            )
                                    if formatted_tools:
                                        holder.tool_calls = formatted_tools
                                resp_meta = getattr(msg, "response_metadata", {})
                                if isinstance(resp_meta, dict):
                                    fr = resp_meta.get("finish_reason")
                                    if fr:
                                        holder.finish_reason = fr

                # Handle token usage including reasoning tokens and cached tokens
                if response.llm_output:
                    token_usage = response.llm_output.get(
                        "token_usage"
                    ) or response.llm_output.get("usage", {})
                    if token_usage:
                        input_tokens = (
                            token_usage.get("prompt_tokens")
                            or token_usage.get("input_tokens")
                            or input_tokens
                        )
                        output_tokens = (
                            token_usage.get("completion_tokens")
                            or token_usage.get("output_tokens")
                            or output_tokens
                        )
                        # OpenAI-style: prompt_tokens_details / input_tokens_details
                        prompt_details = (
                            token_usage.get("prompt_tokens_details")
                            or token_usage.get("input_tokens_details")
                            or {}
                        )
                        cached = prompt_details.get("cached_tokens", 0) or 0
                        input_details = token_usage.get("input_tokens_details") or {}
                        creation = input_details.get("cache_creation_tokens", 0) or 0
                        # LangChain streaming: usage often in llm_output with input_token_details
                        langchain_input = token_usage.get("input_token_details") or {}
                        if cached == 0:
                            cached = langchain_input.get("cache_read", 0) or 0
                        if creation == 0:
                            creation = langchain_input.get("cache_creation", 0) or 0
                        holder.cache_read_input_tokens = cached
                        holder.cache_creation_input_tokens = creation

                try:
                    if output_tokens == 0 and completion_content:
                        output_tokens = general_tokens(completion_content)
                except Exception as token_err:
                    logger.debug("Error calculating output tokens: %s", token_err)

                try:
                    if (
                        input_tokens == 0
                        and hasattr(holder, "prompt_content")
                        and holder.prompt_content
                    ):
                        input_tokens = general_tokens(holder.prompt_content)
                except Exception as input_err:
                    logger.debug("Error calculating input tokens: %s", input_err)

                response_model = model_name
                if response.llm_output:
                    response_model = response.llm_output.get(
                        "model_name"
                    ) or response.llm_output.get("model", model_name)

                # For non-streaming calls, TTFT equals the full duration since the
                # entire response arrives at once.
                if not is_streaming:
                    ttft = duration

                # Resolve server address/port: prefer holder values, fall back to defaults
                scope_server_address = holder.server_address or "localhost"
                scope_server_port = holder.server_port or 443

                # Build scope and run common_chat_logic (OTel span/event/metrics)
                scope = type("Scope", (), {})()
                scope._span = span
                scope._kwargs = holder.model_parameters or {}
                scope._model_parameters = holder.model_parameters or {}
                scope._start_time = holder.start_time
                scope._end_time = end_time
                scope._server_address = scope_server_address
                scope._server_port = scope_server_port
                scope._response_model = response_model
                scope._response_id = (response.llm_output or {}).get("id") or None
                scope._llmresponse = completion_content or ""
                scope._finish_reason = holder.finish_reason
                scope._tools = holder.tool_calls
                scope._input_tokens = input_tokens
                scope._output_tokens = output_tokens
                scope._cache_read_input_tokens = getattr(
                    holder, "cache_read_input_tokens", 0
                )
                scope._cache_creation_input_tokens = getattr(
                    holder, "cache_creation_input_tokens", 0
                )
                scope._timestamps = holder.token_timestamps
                scope._tbt = tbt
                scope._ttft = ttft
                scope._request_model = model_name
                scope._input_messages_raw = getattr(holder, "input_messages_raw", None)
                scope._prompts = getattr(holder, "prompts", [])
                scope._system_instructions = getattr(
                    holder, "system_instructions", None
                )
                scope._tool_definitions = getattr(holder, "tool_definitions", None)
                scope._provider = holder.provider or None

                common_chat_logic(
                    scope,
                    self._pricing_info,
                    self._environment,
                    self._application_name,
                    self._metrics,
                    self._capture_message_content,
                    self._disable_metrics,
                    self._version,
                    is_streaming,
                    self._event_provider,
                )

                # Reset the framework LLM flag and detach OTel context
                if holder.token and isinstance(holder.token, tuple):
                    fw_token, ctx_token = holder.token
                    try:
                        from opentelemetry import context as otel_context

                        otel_context.detach(ctx_token)
                    except Exception:
                        pass
                    reset_framework_llm_active(fw_token)

                self._end_span(run_id)

            except Exception as e:
                logger.debug("Error in on_llm_end: %s", e)

        def on_llm_error(
            self,
            error: BaseException,
            *,
            run_id: UUID,
            parent_run_id: Optional[UUID] = None,
            **kwargs: Any,
        ) -> None:
            """Run when LLM errors."""
            try:
                if run_id in self.spans:
                    holder = self.spans[run_id]
                    holder.span.set_attribute(
                        SemanticConvention.GEN_AI_FRAMEWORK_ERROR_MESSAGE,
                        truncate_content(error),
                    )
                    if holder.token and isinstance(holder.token, tuple):
                        fw_token, ctx_token = holder.token
                        try:
                            from opentelemetry import context as otel_context

                            otel_context.detach(ctx_token)
                        except Exception:
                            pass
                        reset_framework_llm_active(fw_token)
                self._end_span(run_id, str(error))
            except Exception as e:
                logger.debug("Error in on_llm_error: %s", e)

        # =================================================================
        # Tool Callbacks
        # =================================================================

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
            """Run when tool starts."""
            try:
                name = self._get_name_from_callback(serialized, **kwargs)
                span_name = f"execute_tool {name}"

                span = self._create_span(run_id, parent_run_id, span_name)

                span.set_attribute(
                    SemanticConvention.GEN_AI_PROVIDER_NAME,
                    SemanticConvention.GEN_AI_SYSTEM_LANGCHAIN,
                )
                self._set_common_attributes(
                    span, SemanticConvention.GEN_AI_OPERATION_TYPE_TOOLS
                )
                span.set_attribute(SemanticConvention.GEN_AI_TOOL_NAME, name)
                span.set_attribute(SemanticConvention.GEN_AI_TOOL_TYPE, "function")

                description = (serialized or {}).get("description")
                if description:
                    span.set_attribute(
                        SemanticConvention.GEN_AI_TOOL_DESCRIPTION, str(description)
                    )

                conv_id = _resolve_conversation_id(metadata)
                if conv_id:
                    span.set_attribute(
                        SemanticConvention.GEN_AI_CONVERSATION_ID, conv_id
                    )

                if self._capture_message_content and input_str:
                    span.set_attribute(
                        SemanticConvention.GEN_AI_TOOL_CALL_ARGUMENTS,
                        truncate_content(input_str),
                    )

            except Exception as e:
                logger.debug("Error in on_tool_start: %s", e)

        def on_tool_end(
            self,
            output: str,
            *,
            run_id: UUID,
            parent_run_id: Optional[UUID] = None,
            **kwargs: Any,
        ) -> None:
            """Run when tool ends."""
            try:
                if run_id not in self.spans:
                    return

                holder = self.spans[run_id]
                span = holder.span
                duration = time.time() - holder.start_time

                span.set_attribute(
                    SemanticConvention.GEN_AI_CLIENT_OPERATION_DURATION, duration
                )

                tool_call_id = None
                if hasattr(output, "tool_call_id"):
                    tool_call_id = output.tool_call_id
                elif isinstance(output, str) and "tool_call_id" in output:
                    import re

                    match = re.search(r"tool_call_id=['\"]([^'\"]+)['\"]", output)
                    if match:
                        tool_call_id = match.group(1)

                if tool_call_id:
                    span.set_attribute(
                        SemanticConvention.GEN_AI_TOOL_CALL_ID, tool_call_id
                    )

                if self._capture_message_content and output:
                    span.set_attribute(
                        SemanticConvention.GEN_AI_TOOL_CALL_RESULT,
                        truncate_content(output),
                    )

                # Record metrics
                if not self._disable_metrics and self._metrics:
                    try:
                        record_framework_metrics(
                            metrics=self._metrics,
                            gen_ai_operation=SemanticConvention.GEN_AI_OPERATION_TYPE_TOOLS,
                            GEN_AI_PROVIDER_NAME=SemanticConvention.GEN_AI_SYSTEM_LANGCHAIN,
                            server_address="localhost",
                            server_port=8080,
                            environment=self._environment,
                            application_name=self._application_name,
                            start_time=holder.start_time,
                            end_time=time.time(),
                        )
                    except Exception as e:
                        logger.debug("Error recording tool metrics: %s", e)

                self._end_span(run_id)

            except Exception as e:
                logger.debug("Error in on_tool_end: %s", e)

        def on_tool_error(
            self,
            error: BaseException,
            *,
            run_id: UUID,
            parent_run_id: Optional[UUID] = None,
            **kwargs: Any,
        ) -> None:
            """Run when tool errors."""
            try:
                if run_id in self.spans:
                    span = self.spans[run_id].span
                    span.set_attribute(
                        SemanticConvention.GEN_AI_FRAMEWORK_ERROR_MESSAGE,
                        truncate_content(error),
                    )
                self._end_span(run_id, str(error))
            except Exception as e:
                logger.debug("Error in on_tool_error: %s", e)

        # =================================================================
        # Retriever Callbacks
        # =================================================================

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
            """Run when retriever starts."""
            try:
                name = self._get_name_from_callback(serialized, **kwargs)
                span_name = f"retrieval {name}"

                span = self._create_span(
                    run_id, parent_run_id, span_name, SpanKind.CLIENT
                )

                span.set_attribute(
                    SemanticConvention.GEN_AI_PROVIDER_NAME,
                    SemanticConvention.GEN_AI_SYSTEM_LANGCHAIN,
                )
                self._set_common_attributes(
                    span, SemanticConvention.GEN_AI_OPERATION_TYPE_RETRIEVE
                )
                span.set_attribute(SemanticConvention.GEN_AI_DATA_SOURCE_ID, name)

                conv_id = _resolve_conversation_id(metadata)
                if conv_id:
                    span.set_attribute(
                        SemanticConvention.GEN_AI_CONVERSATION_ID, conv_id
                    )

                if self._capture_message_content and query:
                    span.set_attribute(
                        SemanticConvention.GEN_AI_RETRIEVAL_QUERY_TEXT,
                        truncate_content(query),
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
            """Run when retriever ends."""
            try:
                if run_id not in self.spans:
                    return

                holder = self.spans[run_id]
                span = holder.span
                duration = time.time() - holder.start_time

                span.set_attribute(
                    SemanticConvention.GEN_AI_CLIENT_OPERATION_DURATION, duration
                )

                span.set_attribute(
                    SemanticConvention.GEN_AI_RETRIEVAL_DOCUMENT_COUNT, len(documents)
                )

                if self._capture_message_content and documents:
                    structured_docs = []
                    for doc in documents[:3]:
                        content = getattr(doc, "page_content", str(doc))
                        doc_entry = {"content": truncate_content(content)}
                        doc_meta = getattr(doc, "metadata", None)
                        if doc_meta and isinstance(doc_meta, dict):
                            doc_id = doc_meta.get("id") or doc_meta.get("source")
                            if doc_id:
                                doc_entry["id"] = str(doc_id)
                        structured_docs.append(doc_entry)
                    span.set_attribute(
                        SemanticConvention.GEN_AI_RETRIEVAL_DOCUMENTS,
                        json.dumps(structured_docs),
                    )

                # Record metrics
                if not self._disable_metrics and self._metrics:
                    try:
                        record_framework_metrics(
                            metrics=self._metrics,
                            gen_ai_operation=SemanticConvention.GEN_AI_OPERATION_TYPE_RETRIEVE,
                            GEN_AI_PROVIDER_NAME=SemanticConvention.GEN_AI_SYSTEM_LANGCHAIN,
                            server_address="localhost",
                            server_port=8080,
                            environment=self._environment,
                            application_name=self._application_name,
                            start_time=holder.start_time,
                            end_time=time.time(),
                        )
                    except Exception as e:
                        logger.debug("Error recording retriever metrics: %s", e)

                self._end_span(run_id)

            except Exception as e:
                logger.debug("Error in on_retriever_end: %s", e)

        def on_retriever_error(
            self,
            error: BaseException,
            *,
            run_id: UUID,
            parent_run_id: Optional[UUID] = None,
            **kwargs: Any,
        ) -> None:
            """Run when retriever errors."""
            try:
                if run_id in self.spans:
                    span = self.spans[run_id].span
                    span.set_attribute(
                        SemanticConvention.GEN_AI_FRAMEWORK_ERROR_MESSAGE,
                        truncate_content(error),
                    )
                self._end_span(run_id, str(error))
            except Exception as e:
                logger.debug("Error in on_retriever_error: %s", e)

        # =================================================================
        # Agent Callbacks
        # =================================================================

        def on_agent_action(
            self,
            action: Any,
            *,
            run_id: UUID,
            parent_run_id: Optional[UUID] = None,
            **kwargs: Any,
        ) -> None:
            """Run on agent action."""
            try:
                if run_id in self.spans:
                    span = self.spans[run_id].span
                    span.set_attribute(
                        SemanticConvention.GEN_AI_OPERATION,
                        SemanticConvention.GEN_AI_OPERATION_TYPE_AGENT,
                    )
                    if self._capture_message_content:
                        # Extract tool and input from action
                        tool = getattr(action, "tool", str(action))
                        tool_input = getattr(action, "tool_input", "")
                        log = getattr(action, "log", "")
                        span.set_attribute(
                            SemanticConvention.GEN_AI_AGENT_ACTION_TOOL,
                            truncate_content(tool),
                        )
                        span.set_attribute(
                            SemanticConvention.GEN_AI_AGENT_ACTION_TOOL_INPUT,
                            truncate_content(tool_input),
                        )
                        if log:
                            span.set_attribute(
                                SemanticConvention.GEN_AI_AGENT_ACTION_LOG,
                                truncate_content(log),
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
            """Run on agent finish."""
            try:
                if run_id in self.spans:
                    span = self.spans[run_id].span
                    if self._capture_message_content:
                        # Extract output and log from finish
                        output = getattr(finish, "return_values", str(finish))
                        log = getattr(finish, "log", "")
                        span.set_attribute(
                            SemanticConvention.GEN_AI_AGENT_FINISH_OUTPUT,
                            truncate_content(output),
                        )
                        if log:
                            span.set_attribute(
                                SemanticConvention.GEN_AI_AGENT_FINISH_LOG,
                                truncate_content(log),
                            )
            except Exception as e:
                logger.debug("Error in on_agent_finish: %s", e)

    return OpenLITCallbackHandler


# =============================================================================
# Callback Manager Wrapper (OpenLLMetry approach)
# =============================================================================


class _BaseCallbackManagerInitWrapper:
    """
    Wrapper to inject OpenLIT callback handler via BaseCallbackManager.__init__.

    This is the same approach used by OpenLLMetry (Traceloop).
    """

    def __init__(self, callback_handler):
        self._callback_handler = callback_handler

    def get_handler(self):
        """Return the callback handler instance."""
        return self._callback_handler

    def is_handler_present(self, handlers) -> bool:
        """Check if OpenLIT handler is already present in handlers list."""
        return any(isinstance(h, type(self._callback_handler)) for h in handlers)

    def __call__(self, wrapped, instance, args, kwargs) -> None:
        wrapped(*args, **kwargs)

        try:
            if self.is_handler_present(instance.inheritable_handlers):
                return

            instance.add_handler(self._callback_handler, True)
        except Exception as e:
            logger.debug("Error adding callback handler: %s", e)


# =============================================================================
# Instrumentor
# =============================================================================


def _wrap_create_agent(tracer, version, environment, application_name):
    """Wraps langchain.agents.create_agent to produce a create_agent span."""
    from openlit.semcov import SemanticConvention
    from openlit.__helpers import (
        handle_exception,
        set_create_agent_active,
        reset_create_agent_active,
    )

    def wrapper(wrapped, instance, args, kwargs):
        import json
        from urllib.parse import urlparse

        llm = args[0] if args else kwargs.get("model")
        model_name = "unknown"
        if llm is not None:
            model_name = (
                getattr(llm, "model_name", None)
                or getattr(llm, "model", None)
                or "unknown"
            )

        agent_name = kwargs.get("name", "default")
        span_name = f"create_agent {agent_name}"

        with tracer.start_as_current_span(span_name, kind=SpanKind.CLIENT) as span:
            span.set_attribute(SemanticConvention.GEN_AI_OPERATION, "create_agent")
            span.set_attribute(SemanticConvention.GEN_AI_PROVIDER_NAME, "langchain")
            span.set_attribute(SemanticConvention.GEN_AI_AGENT_NAME, agent_name)
            span.set_attribute(SemanticConvention.GEN_AI_REQUEST_MODEL, model_name)
            span.set_attribute(SemanticConvention.GEN_AI_ENVIRONMENT, environment)
            span.set_attribute(
                SemanticConvention.GEN_AI_APPLICATION_NAME, application_name
            )
            span.set_attribute(SemanticConvention.GEN_AI_SDK_VERSION, version)

            server_address = "localhost"
            server_port = 443
            try:
                base_url = getattr(llm, "base_url", None) or getattr(
                    llm, "openai_api_base", None
                )
                if base_url:
                    parsed = urlparse(str(base_url))
                    if parsed.hostname:
                        server_address = parsed.hostname
                    if parsed.port:
                        server_port = parsed.port
                    elif parsed.scheme == "https":
                        server_port = 443
                    elif parsed.scheme == "http":
                        server_port = 80
            except Exception:
                pass
            span.set_attribute(SemanticConvention.SERVER_ADDRESS, server_address)
            span.set_attribute(SemanticConvention.SERVER_PORT, server_port)

            tools = args[1] if len(args) > 1 else kwargs.get("tools", [])
            tool_names = []
            if tools:
                for t in tools:
                    name = getattr(t, "name", None) or str(t)
                    tool_names.append(name)
                span.set_attribute("gen_ai.agent.tools", json.dumps(tool_names))

            if tool_names:
                description = f"Agent with tools: {', '.join(tool_names)}"
            else:
                description = "LangChain agent"
            span.set_attribute(SemanticConvention.GEN_AI_AGENT_DESCRIPTION, description)

            ca_token = set_create_agent_active()
            try:
                result = wrapped(*args, **kwargs)
                result._openlit_creation_context = span.get_span_context()
                span.set_status(Status(StatusCode.OK))
                return result
            except Exception as e:
                handle_exception(span, e)
                raise
            finally:
                reset_create_agent_active(ca_token)

    return wrapper


class LangChainInstrumentor(BaseInstrumentor):
    """
    OpenLIT LangChain instrumentor with comprehensive features.

    Features from:
    - OpenLLMetry: Auto-injection via BaseCallbackManager.__init__
    - Langfuse: Model name extraction, parameter tracking, agent detection
    - OpenInference: Thread-safe span tracking
    """

    def instrumentation_dependencies(self) -> Collection[str]:
        return _instruments

    def _instrument(self, **kwargs):
        """Instrument LangChain."""
        try:
            version = importlib.metadata.version("langchain-core")
        except importlib.metadata.PackageNotFoundError:
            version = "unknown"

        environment = kwargs.get("environment", "default")
        application_name = kwargs.get("application_name", "default")
        tracer = kwargs.get("tracer")
        pricing_info = kwargs.get("pricing_info", {})
        capture_message_content = kwargs.get("capture_message_content", False)
        metrics = kwargs.get("metrics_dict")
        disable_metrics = kwargs.get("disable_metrics", False)
        event_provider = kwargs.get("event_provider")

        handler_class = _create_callback_handler_class(
            tracer,
            version,
            environment,
            application_name,
            pricing_info,
            capture_message_content,
            metrics,
            disable_metrics,
            event_provider,
        )

        if handler_class is None:
            logger.debug("Could not create LangChain callback handler class")
            return

        handler_instance = handler_class()

        try:
            wrap_function_wrapper(
                module="langchain_core.callbacks.manager",
                name="BaseCallbackManager.__init__",
                wrapper=_BaseCallbackManagerInitWrapper(handler_instance),
            )
            logger.debug("Successfully wrapped BaseCallbackManager.__init__")
        except Exception as e:
            logger.debug("Failed to wrap BaseCallbackManager.__init__: %s", e)

        try:
            wrap_function_wrapper(
                module="langchain.agents",
                name="create_agent",
                wrapper=_wrap_create_agent(
                    tracer, version, environment, application_name
                ),
            )
            logger.debug("Successfully wrapped langchain.agents.create_agent")
        except Exception:
            logger.debug("langchain.agents.create_agent not available, skipping")

    def _uninstrument(self, **kwargs):
        """Remove instrumentation."""
        try:
            from opentelemetry.instrumentation.utils import unwrap

            unwrap("langchain_core.callbacks.manager", "BaseCallbackManager.__init__")
        except Exception as e:
            logger.debug("Error during uninstrumentation: %s", e)
