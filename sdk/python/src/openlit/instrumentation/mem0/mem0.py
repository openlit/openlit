# pylint: disable=duplicate-code, broad-exception-caught, too-many-statements, unused-argument
"""
Module for monitoring mem0 applications with comprehensive business intelligence.
"""

import concurrent.futures
import functools
import json
import logging
import time
from typing import Any, Dict, Optional

from opentelemetry.trace import SpanKind, Status, StatusCode, set_span_in_context
from opentelemetry import context
from opentelemetry.context import Context
from opentelemetry.instrumentation.utils import _SUPPRESS_INSTRUMENTATION_KEY
from opentelemetry.context import attach, detach, get_current
from opentelemetry.propagate import inject
import concurrent.futures
import functools
from opentelemetry.sdk.resources import (
    SERVICE_NAME,
    TELEMETRY_SDK_NAME,
    DEPLOYMENT_ENVIRONMENT,
)
from openlit.__helpers import handle_exception
from openlit.semcov import SemanticConvention

# Initialize logger for logging potential issues and operations
logger = logging.getLogger(__name__)



# Context propagation utilities for threading support


def _patch_concurrent_futures_for_context(instance, current_context):
    """
    Temporarily patches ThreadPoolExecutor.submit to propagate OpenTelemetry context
    across thread boundaries. This fixes the span hierarchy issue where mem0's 
    _add_to_vector_store and _add_to_graph operations run in separate threads
    and lose their parent context, creating separate traces instead of proper
    parent-child relationships.
    
    Args:
        instance: The mem0 Memory instance  
        current_context: The OpenTelemetry context to propagate to worker threads
    
    Returns:
        A function to restore the original ThreadPoolExecutor.submit method
    """
    # Store the original submit method
    original_submit = concurrent.futures.ThreadPoolExecutor.submit
    
    def patched_submit(executor_self, fn, *args, **kwargs):
        # Wrap the function to carry context
        @functools.wraps(fn)
        def context_wrapped_fn(*fn_args, **fn_kwargs):
            # Attach the parent context in the worker thread
            token = context.attach(current_context)
            try:
                return fn(*fn_args, **fn_kwargs)
            finally:
                context.detach(token)
        
        # Call the original submit with the wrapped function
        return original_submit(executor_self, context_wrapped_fn, *args, **kwargs)
    
    # Apply the patch
    concurrent.futures.ThreadPoolExecutor.submit = patched_submit
    
    # Return a function to restore the original
    return lambda: setattr(concurrent.futures.ThreadPoolExecutor, 'submit', original_submit)


class Mem0InstrumentationContext:
    """Optimized context object with lazy loading and minimal overhead."""

    __slots__ = (
        "instance",
        "args",
        "kwargs",
        "version",
        "environment",
        "application_name",
        "_user_id",
        "_agent_id",
        "_run_id",
        "_metadata",
        "_memory_type",
        "_messages",
        "_operation_params",
    )

    def __init__(self, instance, args, kwargs, version, environment, application_name):
        self.instance = instance
        self.args = args
        self.kwargs = kwargs
        self.version = version
        self.environment = environment
        self.application_name = application_name

        # Cache expensive operations with lazy loading - use None as sentinel
        self._user_id = None
        self._agent_id = None
        self._run_id = None
        self._metadata = None
        self._memory_type = None
        self._messages = None
        self._operation_params = None

    @property
    def user_id(self) -> Optional[str]:
        """Get user_id with caching."""
        if self._user_id is None:
            self._user_id = self.kwargs.get("user_id")
        return self._user_id

    @property
    def agent_id(self) -> Optional[str]:
        """Get agent_id with caching."""
        if self._agent_id is None:
            self._agent_id = self.kwargs.get("agent_id")
        return self._agent_id

    @property
    def run_id(self) -> Optional[str]:
        """Get run_id with caching."""
        if self._run_id is None:
            self._run_id = self.kwargs.get("run_id")
        return self._run_id

    @property
    def metadata(self) -> Optional[Dict[str, Any]]:
        """Get metadata with caching."""
        if self._metadata is None:
            self._metadata = self.kwargs.get("metadata")
        return self._metadata

    @property
    def memory_type(self) -> Optional[str]:
        """Get memory_type with caching."""
        if self._memory_type is None:
            self._memory_type = self.kwargs.get("memory_type")
        return self._memory_type

    @property
    def messages(self) -> Any:
        """Get messages with caching."""
        if self._messages is None:
            self._messages = self.args[0] if self.args else self.kwargs.get("messages")
        return self._messages

    @property
    def operation_params(self) -> Dict[str, Any]:
        """Get operation-specific parameters with optimized caching."""
        if self._operation_params is None:
            # Pre-allocate dict size for better performance
            self._operation_params = {}

            # Fast path: direct kwargs access instead of string operations
            if "query" in self.kwargs:
                self._operation_params.update(
                    {
                        "query": self.kwargs["query"],
                        "limit": self.kwargs.get("limit"),
                        "threshold": self.kwargs.get("threshold"),
                    }
                )
            elif "memory_id" in self.kwargs:
                self._operation_params.update(
                    {
                        "memory_id": self.kwargs["memory_id"],
                        "data": self.kwargs.get("data"),
                    }
                )
        return self._operation_params


def set_span_attributes(
    span, operation_name: str, ctx: Mem0InstrumentationContext, response: Any = None
):
    """Set optimized span attributes with batched operations and minimal overhead."""

    # Batch core attributes for better performance
    core_attributes = {
        TELEMETRY_SDK_NAME: "openlit",
        SemanticConvention.GEN_AI_SYSTEM: SemanticConvention.GEN_AI_SYSTEM_MEM0,
        SemanticConvention.GEN_AI_ENDPOINT: operation_name,
        DEPLOYMENT_ENVIRONMENT: ctx.environment,
        SERVICE_NAME: ctx.application_name,
        SemanticConvention.GEN_AI_SDK_VERSION: ctx.version,
    }

    # Set core attributes in batch
    for key, value in core_attributes.items():
        span.set_attribute(key, value)

    # Optimized operation type detection with single pass
    is_internal = (
        "_" in operation_name
        or "vector_store" in operation_name
        or "graph" in operation_name
        or "create_memory" in operation_name
        or "procedural" in operation_name
    )

    if is_internal:
        # Internal operation - component level
        span.set_attribute(
            SemanticConvention.GEN_AI_OPERATION,
            SemanticConvention.GEN_AI_OPERATION_TYPE_FRAMEWORK,
        )

        # Component type mapping for better performance
        component_map = {
            "vector_store": "vector_store",
            "graph": "graph_store",
            "create_memory": "memory_creation",
            "procedural": "procedural_memory",
        }

        for key, component_type in component_map.items():
            if key in operation_name:
                span.set_attribute(
                    SemanticConvention.GEN_AI_FRAMEWORK_COMPONENT_TYPE, component_type
                )
                break
    else:
        # Top-level operation - workflow level
        span.set_attribute(
            SemanticConvention.GEN_AI_OPERATION,
            SemanticConvention.GEN_AI_OPERATION_TYPE_MEMORY,
        )

    # Batch session attributes for better performance
    session_attrs = {}
    if ctx.user_id:
        session_attrs[SemanticConvention.GEN_AI_USER_ID] = ctx.user_id
    if ctx.agent_id:
        session_attrs[SemanticConvention.GEN_AI_AGENT_ID] = ctx.agent_id
    if ctx.run_id:
        session_attrs[SemanticConvention.GEN_AI_RUN_ID] = ctx.run_id

    for key, value in session_attrs.items():
        span.set_attribute(key, value)

    # Set memory-specific attributes
    if ctx.memory_type:
        span.set_attribute(SemanticConvention.GEN_AI_MEMORY_TYPE, ctx.memory_type)

    if ctx.metadata:
        try:
            span.set_attribute(
                SemanticConvention.GEN_AI_MEMORY_METADATA, json.dumps(ctx.metadata)
            )
        except Exception:
            span.set_attribute(
                SemanticConvention.GEN_AI_MEMORY_METADATA, str(ctx.metadata)
            )

    # Set operation-specific attributes based on the operation type
    if "add" in operation_name:
        if "infer" in ctx.kwargs:
            span.set_attribute(
                SemanticConvention.GEN_AI_MEMORY_INFER, ctx.kwargs["infer"]
            )
        if ctx.messages:
            try:
                if isinstance(ctx.messages, (list, tuple)):
                    span.set_attribute(
                        SemanticConvention.GEN_AI_MEMORY_COUNT, len(ctx.messages)
                    )
                elif isinstance(ctx.messages, str):
                    span.set_attribute(SemanticConvention.GEN_AI_MEMORY_COUNT, 1)
            except Exception:
                pass

    elif "search" in operation_name:
        if "query" in ctx.kwargs:
            span.set_attribute(
                SemanticConvention.GEN_AI_MEMORY_SEARCH_QUERY, ctx.kwargs["query"]
            )
        if "limit" in ctx.kwargs:
            span.set_attribute(
                SemanticConvention.GEN_AI_MEMORY_SEARCH_LIMIT, ctx.kwargs["limit"]
            )
        if "threshold" in ctx.kwargs:
            span.set_attribute(
                SemanticConvention.GEN_AI_MEMORY_SEARCH_THRESHOLD,
                ctx.kwargs["threshold"],
            )

    elif "update" in operation_name:
        if "memory_id" in ctx.kwargs:
            span.set_attribute(SemanticConvention.DB_UPDATE_ID, ctx.kwargs["memory_id"])

    elif "delete" in operation_name:
        if "memory_id" in ctx.kwargs:
            span.set_attribute(SemanticConvention.DB_DELETE_ID, ctx.kwargs["memory_id"])

    elif "get" in operation_name:
        if "memory_id" in ctx.kwargs:
            span.set_attribute(
                SemanticConvention.DB_OPERATION_ID, ctx.kwargs["memory_id"]
            )

    # Business Intelligence: Set response attributes
    if response:
        try:
            if isinstance(response, (list, tuple)):
                span.set_attribute(
                    SemanticConvention.GEN_AI_MEMORY_OPERATION_RESULT_COUNT,
                    len(response),
                )
                span.set_attribute(
                    SemanticConvention.GEN_AI_DATA_SOURCES, len(response)
                )
            elif isinstance(response, dict):
                if "results" in response:
                    result_count = (
                        len(response["results"]) if response["results"] else 0
                    )
                    span.set_attribute(
                        SemanticConvention.GEN_AI_MEMORY_OPERATION_RESULT_COUNT,
                        result_count,
                    )
                    span.set_attribute(
                        SemanticConvention.GEN_AI_DATA_SOURCES, result_count
                    )
                else:
                    span.set_attribute(
                        SemanticConvention.GEN_AI_MEMORY_OPERATION_RESULT_COUNT, 1
                    )
                    span.set_attribute(SemanticConvention.GEN_AI_DATA_SOURCES, 1)
            else:
                span.set_attribute(
                    SemanticConvention.GEN_AI_MEMORY_OPERATION_RESULT_COUNT, 1
                )
                span.set_attribute(SemanticConvention.GEN_AI_DATA_SOURCES, 1)
        except Exception:
            pass


def mem0_wrap(
    gen_ai_endpoint,
    version,
    environment,
    application_name,
    tracer,
    pricing_info,
    capture_message_content,
):
    """
    Creates a wrapper around mem0 function calls to trace and log execution metrics
    with optimized hierarchy and performance following OpenLIT Framework Guide.

    Parameters:
    - gen_ai_endpoint (str): A descriptor for the endpoint being traced.
    - version (str): The version of the mem0 application.
    - environment (str): The deployment environment.
    - application_name (str): Name of the mem0 application.
    - tracer (opentelemetry.trace.Tracer): The tracer object for OpenTelemetry tracing.
    - pricing_info (dict): Information about pricing for internal metrics.
    - capture_message_content (bool): Flag for tracing response content.

    Returns:
    - function: A higher-order function that wraps mem0 functions with tracing.
    """

    def wrapper(wrapped, instance, args, kwargs):
        """
        Inner wrapper function that executes the wrapped function with comprehensive
        business intelligence tracking and enhanced observability.

        Parameters:
        - wrapped (Callable): The original mem0 function.
        - instance (object): The instance to which the wrapped function belongs.
        - args (tuple): Positional arguments passed to the wrapped function.
        - kwargs (dict): Keyword arguments passed to the wrapped function.

        Returns:
        - The result of the wrapped function call with enhanced tracing.
        """
        # Check if instrumentation is suppressed to avoid double tracing
        if context.get_value(_SUPPRESS_INSTRUMENTATION_KEY):
            return wrapped(*args, **kwargs)
            
        # Handle Memory.__init__ to create parent span for initialization operations
        if gen_ai_endpoint == "memory init":
            with tracer.start_as_current_span("memory init", kind=SpanKind.INTERNAL) as init_span:
                return wrapped(*args, **kwargs)

        # Determine span hierarchy based on operation type
        is_internal_operation = (
            "_" in gen_ai_endpoint
            or "vector_store" in gen_ai_endpoint
            or "graph" in gen_ai_endpoint
            or "create_memory" in gen_ai_endpoint
            or "init" in gen_ai_endpoint  # Memory.__init__ should be internal
        )

        # Use INTERNAL kind for internal operations to maintain hierarchy
        span_kind = SpanKind.INTERNAL if is_internal_operation else SpanKind.CLIENT

        # Create context for performance optimization
        ctx = Mem0InstrumentationContext(
            instance, args, kwargs, version, environment, application_name
        )

        # Get current context - crucial for parent-child relationships
        current_context = context.get_current()
        
        with tracer.start_as_current_span(
            gen_ai_endpoint, 
            kind=span_kind,
            context=current_context
        ) as span:
            # Set this span as the active context
            span_context = set_span_in_context(span, context=current_context)
            token = context.attach(span_context)
            
            # Use high-resolution timer for better performance measurement
            start_time = time.perf_counter()

            try:
                # Special handling for memory operations that use threading
                if (span_kind == SpanKind.CLIENT and 
                    ("memory add" == gen_ai_endpoint or "memory search" == gen_ai_endpoint) and
                    (hasattr(instance, '_add_to_vector_store') or hasattr(instance, '_search_vector_store'))):
                    
                    # Apply context propagation patch for threading
                    restore_patch = _patch_concurrent_futures_for_context(instance, span_context)
                    try:
                        response = wrapped(*args, **kwargs)
                    finally:
                        # Restore original ThreadPoolExecutor.submit
                        restore_patch()
                else:
                    # Normal execution for other operations
                    response = wrapped(*args, **kwargs)

                # Calculate operation duration with high precision
                operation_duration = time.perf_counter() - start_time
                span.set_attribute(
                    SemanticConvention.GEN_AI_CLIENT_OPERATION_DURATION,
                    operation_duration,
                )

                # Set comprehensive span attributes with business intelligence
                set_span_attributes(span, gen_ai_endpoint, ctx, response)

                # Capture content if enabled (OpenLIT competitive advantage)
                if capture_message_content:
                    try:
                        if ctx.messages and "add" in gen_ai_endpoint:
                            if isinstance(ctx.messages, str):
                                span.set_attribute(
                                    SemanticConvention.GEN_AI_CONTENT_PROMPT,
                                    ctx.messages,
                                )
                            elif isinstance(ctx.messages, (list, dict)):
                                span.set_attribute(
                                    SemanticConvention.GEN_AI_CONTENT_PROMPT,
                                    json.dumps(ctx.messages),
                                )

                        if response and "search" in gen_ai_endpoint:
                            content = (
                                json.dumps(response)
                                if isinstance(response, (dict, list))
                                else str(response)
                            )
                            span.set_attribute(
                                SemanticConvention.GEN_AI_CONTENT_COMPLETION, content
                            )
                    except Exception as e:
                        logger.debug("Failed to capture message content: %s", e)

                span.set_status(Status(StatusCode.OK))
                return response

            except Exception as e:
                # Calculate operation duration even on error with high precision
                operation_duration = time.perf_counter() - start_time
                span.set_attribute(
                    SemanticConvention.GEN_AI_CLIENT_OPERATION_DURATION,
                    operation_duration,
                )

                # Set basic attributes even on error
                try:
                    set_span_attributes(span, gen_ai_endpoint, ctx)
                except Exception as attr_error:
                    logger.debug(
                        "Failed to set span attributes on error: %s", attr_error
                    )

                handle_exception(span, e)
                logger.error("Error in mem0 trace creation: %s", e)

                # Re-raise the original exception
                raise
            
            finally:
                # Always detach context since we always attach it
                context.detach(token)

    return wrapper
