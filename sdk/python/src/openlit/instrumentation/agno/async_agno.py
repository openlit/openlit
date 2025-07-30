"""
Module for monitoring Agno agent framework async operations.
"""

import logging
import time
from opentelemetry.trace import Status, StatusCode, SpanKind
from opentelemetry import context as context_api
from openlit.__helpers import (
    handle_exception,
)
from openlit.instrumentation.agno.utils import (
    process_agent_request,
    process_tool_request,
    process_memory_request,
    process_reasoning_request,
    process_vectordb_request,
    process_knowledge_request,
    process_workflow_request,
    process_team_request,
)
from openlit.semcov import SemanticConvention

# Initialize logger for Agno async monitoring
logger = logging.getLogger(__name__)


def async_agent_run_wrap(
    gen_ai_endpoint,
    version,
    environment,
    application_name,
    tracer,
    pricing_info,
    capture_message_content,
    metrics,
    disable_metrics,
):
    """
    Wrap Agno Agent.arun method with comprehensive async instrumentation using process functions only.
    """

    async def wrapper(wrapped, instance, args, kwargs):
        # CRITICAL: Suppression check to prevent recursive instrumentation
        if context_api.get_value(context_api._SUPPRESS_INSTRUMENTATION_KEY):
            return await wrapped(*args, **kwargs)

        # Extract agent name for span naming with fallback to agent_id
        agent_name = (
            getattr(instance, "name", None)
            or getattr(instance, "agent_id", None)
            or "default_agent"
        )
        span_name = f"agent {agent_name}"

        # CRITICAL: Capture current OpenTelemetry context to ensure proper nesting
        current_context = context_api.get_current()

        with tracer.start_as_current_span(
            span_name, kind=SpanKind.CLIENT, context=current_context
        ) as span:
            start_time = time.time()
            # CRITICAL: Set the span context as current for nested calls
            token = context_api.attach(
                context_api.set_value("current_span", span, current_context)
            )
            try:
                response = await wrapped(*args, **kwargs)
            finally:
                context_api.detach(token)

            try:
                # Process request using utils function with ALL attributes from semcov
                process_agent_request(
                    span,
                    instance,
                    args,
                    kwargs,
                    response,
                    start_time,
                    pricing_info,
                    environment,
                    application_name,
                    metrics,
                    capture_message_content,
                    disable_metrics,
                    version,
                    SemanticConvention.GEN_AI_OPERATION_TYPE_AGENT,
                )

                # Mark span as successful
                span.set_status(Status(StatusCode.OK))

            except Exception as e:
                # Handle instrumentation exceptions - log but don't raise
                handle_exception(span, e)
                logger.error("Error in async agent.arun trace creation: %s", e)

            return response

    return wrapper


def async_agent_continue_run_wrap(
    gen_ai_endpoint,
    version,
    environment,
    application_name,
    tracer,
    pricing_info,
    capture_message_content,
    metrics,
    disable_metrics,
):
    """
    Wrap Agno Agent.acontinue_run method using process functions only.
    """

    async def wrapper(wrapped, instance, args, kwargs):
        # CRITICAL: Suppression check to prevent recursive instrumentation
        if context_api.get_value(context_api._SUPPRESS_INSTRUMENTATION_KEY):
            return await wrapped(*args, **kwargs)

        agent_name = getattr(instance, "name", "unknown")
        span_name = f"continue {agent_name}"

        with tracer.start_as_current_span(span_name, kind=SpanKind.CLIENT) as span:
            start_time = time.time()
            result = await wrapped(*args, **kwargs)

            try:
                # Process request using utils function with ALL attributes from semcov
                process_agent_request(
                    span,
                    instance,
                    args,
                    kwargs,
                    result,
                    start_time,
                    pricing_info,
                    environment,
                    application_name,
                    metrics,
                    capture_message_content,
                    disable_metrics,
                    version,
                    SemanticConvention.GEN_AI_OPERATION_TYPE_AGENT,
                )

                span.set_status(Status(StatusCode.OK))

            except Exception as e:
                handle_exception(span, e)
                logger.error("Error in async agent.acontinue_run trace creation: %s", e)

            return result

    return wrapper


def async_model_run_function_call_wrap(
    gen_ai_endpoint,
    version,
    environment,
    application_name,
    tracer,
    pricing_info,
    capture_message_content,
    metrics,
    disable_metrics,
):
    """
    Wrap Agno Model.arun_function_call async method to bridge agent and tool span context.
    This is the critical method that connects agent execution to tool execution.
    """

    async def wrapper(wrapped, instance, args, kwargs):
        # CRITICAL: Suppression check to prevent recursive instrumentation
        if context_api.get_value(context_api._SUPPRESS_INSTRUMENTATION_KEY):
            return await wrapped(*args, **kwargs)

        # Extract function call information for span naming
        function_call = args[0] if args else None
        function_name = "unknown_function"
        if function_call and hasattr(function_call, "function"):
            if hasattr(function_call.function, "name"):
                function_name = function_call.function.name
            elif hasattr(function_call.function, "__name__"):
                function_name = function_call.function.__name__

        span_name = f"model run function {function_name}"

        # CRITICAL: Capture current OpenTelemetry context to ensure proper nesting
        current_context = context_api.get_current()

        with tracer.start_as_current_span(
            span_name, kind=SpanKind.INTERNAL, context=current_context
        ) as span:
            start_time = time.time()
            # CRITICAL: Set the span context as current for nested calls
            token = context_api.attach(
                context_api.set_value("current_span", span, current_context)
            )
            try:
                result = await wrapped(*args, **kwargs)
            finally:
                context_api.detach(token)
            try:
                # Process request using utils function with ALL attributes from semcov
                process_tool_request(
                    span,
                    function_call,
                    args,
                    kwargs,
                    result,
                    start_time,
                    pricing_info,
                    environment,
                    application_name,
                    metrics,
                    capture_message_content,
                    disable_metrics,
                    version,
                    function_name,
                )

                span.set_status(Status(StatusCode.OK))

            except Exception as e:
                handle_exception(span, e)
                logger.error(
                    "Error in async model.arun_function_call trace creation: %s", e
                )

            return result

    return wrapper


def async_function_entrypoint_wrap(
    gen_ai_endpoint,
    version,
    environment,
    application_name,
    tracer,
    pricing_info,
    capture_message_content,
    metrics,
    disable_metrics,
):
    """
    Wrap Agno Function.entrypoint async method to catch direct async tool executions.
    """

    async def wrapper(wrapped, instance, args, kwargs):
        # CRITICAL: Suppression check to prevent recursive instrumentation
        if context_api.get_value(context_api._SUPPRESS_INSTRUMENTATION_KEY):
            return await wrapped(*args, **kwargs)

        # Extract function information for span naming
        function_name = getattr(instance, "name", None) or getattr(
            instance, "__name__", "unknown_function"
        )
        span_name = f"tool {function_name}"

        # CRITICAL: Capture current OpenTelemetry context to ensure proper nesting
        current_context = context_api.get_current()

        with tracer.start_as_current_span(
            span_name, kind=SpanKind.INTERNAL, context=current_context
        ) as span:
            start_time = time.time()
            # CRITICAL: Set the span context as current for nested calls
            token = context_api.attach(
                context_api.set_value("current_span", span, current_context)
            )
            try:
                result = await wrapped(*args, **kwargs)
            finally:
                context_api.detach(token)

            try:
                # Process request using utils function with ALL attributes from semcov
                process_tool_request(
                    span,
                    instance,
                    args,
                    kwargs,
                    result,
                    start_time,
                    pricing_info,
                    environment,
                    application_name,
                    metrics,
                    capture_message_content,
                    disable_metrics,
                    version,
                    function_name,
                )

                span.set_status(Status(StatusCode.OK))

            except Exception as e:
                handle_exception(span, e)
                logger.error("Error in async function.entrypoint trace creation: %s", e)

            return result

    return wrapper


# Async Tools Component Wrappers
def async_function_call_wrap(
    gen_ai_endpoint,
    version,
    environment,
    application_name,
    tracer,
    pricing_info,
    capture_message_content,
    metrics,
    disable_metrics,
):
    """
    Wrap Agno Function async call method for tool execution tracing using process functions only.
    """

    async def wrapper(wrapped, instance, args, kwargs):
        # CRITICAL: Suppression check to prevent recursive instrumentation
        if context_api.get_value(context_api._SUPPRESS_INSTRUMENTATION_KEY):
            return await wrapped(*args, **kwargs)

        # Extract function information
        function_name = getattr(
            instance, "name", getattr(instance, "__name__", "unknown_function")
        )
        span_name = f"tool {function_name}"

        with tracer.start_as_current_span(span_name, kind=SpanKind.INTERNAL) as span:
            # Execute async function with timing
            start_time = time.time()
            result = await wrapped(*args, **kwargs)

            try:
                # Process request using utils function with ALL attributes from semcov
                process_tool_request(
                    span,
                    instance,
                    args,
                    kwargs,
                    result,
                    start_time,
                    pricing_info,
                    environment,
                    application_name,
                    metrics,
                    capture_message_content,
                    disable_metrics,
                    version,
                    SemanticConvention.GEN_AI_OPERATION_TYPE_TOOLS,
                )

                span.set_status(Status(StatusCode.OK))

            except Exception as e:
                handle_exception(span, e)
                logger.error("Error in async tool execution trace creation: %s", e)

            return result

    return wrapper


# Async Memory Component Wrappers
def async_memory_add_wrap(
    gen_ai_endpoint,
    version,
    environment,
    application_name,
    tracer,
    pricing_info,
    capture_message_content,
    metrics,
    disable_metrics,
):
    """
    Wrap Agno Memory async add method for memory storage tracing using process functions only.
    """

    async def wrapper(wrapped, instance, args, kwargs):
        # CRITICAL: Suppression check to prevent recursive instrumentation
        if context_api.get_value(context_api._SUPPRESS_INSTRUMENTATION_KEY):
            return await wrapped(*args, **kwargs)

        span_name = "memory add"

        with tracer.start_as_current_span(span_name, kind=SpanKind.INTERNAL) as span:
            start_time = time.time()
            result = await wrapped(*args, **kwargs)

            try:
                # Process request using utils function with ALL attributes from semcov
                process_memory_request(
                    span,
                    instance,
                    args,
                    kwargs,
                    result,
                    start_time,
                    pricing_info,
                    environment,
                    application_name,
                    metrics,
                    capture_message_content,
                    disable_metrics,
                    version,
                    SemanticConvention.GEN_AI_OPERATION_TYPE_MEMORY,
                )

                span.set_status(Status(StatusCode.OK))

            except Exception as e:
                handle_exception(span, e)
                logger.error("Error in async memory add trace creation: %s", e)

            return result

    return wrapper


def async_memory_search_wrap(
    gen_ai_endpoint,
    version,
    environment,
    application_name,
    tracer,
    pricing_info,
    capture_message_content,
    metrics,
    disable_metrics,
):
    """
    Wrap Agno Memory async search method for memory retrieval tracing using process functions only.
    """

    async def wrapper(wrapped, instance, args, kwargs):
        # CRITICAL: Suppression check to prevent recursive instrumentation
        if context_api.get_value(context_api._SUPPRESS_INSTRUMENTATION_KEY):
            return await wrapped(*args, **kwargs)

        span_name = "memory search"

        with tracer.start_as_current_span(span_name, kind=SpanKind.INTERNAL) as span:
            start_time = time.time()
            result = await wrapped(*args, **kwargs)

            try:
                # Process request using utils function with ALL attributes from semcov
                process_memory_request(
                    span,
                    instance,
                    args,
                    kwargs,
                    result,
                    start_time,
                    pricing_info,
                    environment,
                    application_name,
                    metrics,
                    capture_message_content,
                    disable_metrics,
                    version,
                    SemanticConvention.GEN_AI_OPERATION_TYPE_MEMORY,
                )

                span.set_status(Status(StatusCode.OK))

            except Exception as e:
                handle_exception(span, e)
                logger.error("Error in async memory search trace creation: %s", e)

            return result

    return wrapper


# Async VectorDB Component Wrappers
def async_vectordb_search_wrap(
    gen_ai_endpoint,
    version,
    environment,
    application_name,
    tracer,
    pricing_info,
    capture_message_content,
    metrics,
    disable_metrics,
):
    """
    Wrap Agno VectorDb async search method for vector search tracing using process functions only.
    """

    async def wrapper(wrapped, instance, args, kwargs):
        # CRITICAL: Suppression check to prevent recursive instrumentation
        if context_api.get_value(context_api._SUPPRESS_INSTRUMENTATION_KEY):
            return await wrapped(*args, **kwargs)

        span_name = "vectordb search"

        with tracer.start_as_current_span(span_name, kind=SpanKind.CLIENT) as span:
            start_time = time.time()
            result = await wrapped(*args, **kwargs)

            try:
                # Process request using utils function with ALL attributes from semcov
                process_vectordb_request(
                    span,
                    instance,
                    args,
                    kwargs,
                    result,
                    start_time,
                    pricing_info,
                    environment,
                    application_name,
                    metrics,
                    capture_message_content,
                    disable_metrics,
                    version,
                    SemanticConvention.GEN_AI_OPERATION_TYPE_VECTORDB,
                )

                span.set_status(Status(StatusCode.OK))

            except Exception as e:
                handle_exception(span, e)
                logger.error("Error in async vectordb search trace creation: %s", e)

            return result

    return wrapper


# Async Knowledge Component Wrappers
def async_knowledge_search_wrap(
    gen_ai_endpoint,
    version,
    environment,
    application_name,
    tracer,
    pricing_info,
    capture_message_content,
    metrics,
    disable_metrics,
):
    """
    Wrap Agno AgentKnowledge async search method for knowledge search tracing using process functions only.
    """

    async def wrapper(wrapped, instance, args, kwargs):
        # CRITICAL: Suppression check to prevent recursive instrumentation
        if context_api.get_value(context_api._SUPPRESS_INSTRUMENTATION_KEY):
            return await wrapped(*args, **kwargs)

        span_name = "knowledge search"

        with tracer.start_as_current_span(span_name, kind=SpanKind.INTERNAL) as span:
            start_time = time.time()
            result = await wrapped(*args, **kwargs)

            try:
                # Process request using utils function with ALL attributes from semcov
                process_knowledge_request(
                    span,
                    instance,
                    args,
                    kwargs,
                    result,
                    start_time,
                    pricing_info,
                    environment,
                    application_name,
                    metrics,
                    capture_message_content,
                    disable_metrics,
                    version,
                    SemanticConvention.GEN_AI_OPERATION_TYPE_KNOWLEDGE,
                )

                span.set_status(Status(StatusCode.OK))

            except Exception as e:
                handle_exception(span, e)
                logger.error("Error in async knowledge search trace creation: %s", e)

            return result

    return wrapper


# Async Workflow Component Wrappers
def async_workflow_run_wrap(
    gen_ai_endpoint,
    version,
    environment,
    application_name,
    tracer,
    pricing_info,
    capture_message_content,
    metrics,
    disable_metrics,
):
    """
    Wrap Agno Workflow async run method for workflow execution tracing using process functions only.
    """

    async def wrapper(wrapped, instance, args, kwargs):
        # CRITICAL: Suppression check to prevent recursive instrumentation
        if context_api.get_value(context_api._SUPPRESS_INSTRUMENTATION_KEY):
            return await wrapped(*args, **kwargs)

        workflow_name = getattr(instance, "name", "unknown_workflow")
        span_name = f"workflow {workflow_name}"

        with tracer.start_as_current_span(span_name, kind=SpanKind.CLIENT) as span:
            start_time = time.time()
            result = await wrapped(*args, **kwargs)

            try:
                # Process request using utils function with ALL attributes from semcov
                process_workflow_request(
                    span,
                    instance,
                    args,
                    kwargs,
                    result,
                    start_time,
                    pricing_info,
                    environment,
                    application_name,
                    metrics,
                    capture_message_content,
                    disable_metrics,
                    version,
                    SemanticConvention.GEN_AI_OPERATION_TYPE_WORKFLOW,
                )

                span.set_status(Status(StatusCode.OK))

            except Exception as e:
                handle_exception(span, e)
                logger.error("Error in async workflow run trace creation: %s", e)

            return result

    return wrapper


# Async Team Component Wrappers
def async_team_run_wrap(
    gen_ai_endpoint,
    version,
    environment,
    application_name,
    tracer,
    pricing_info,
    capture_message_content,
    metrics,
    disable_metrics,
):
    """
    Wrap Agno Team async run method for team execution tracing using process functions only.
    """

    async def wrapper(wrapped, instance, args, kwargs):
        # CRITICAL: Suppression check to prevent recursive instrumentation
        if context_api.get_value(context_api._SUPPRESS_INSTRUMENTATION_KEY):
            return await wrapped(*args, **kwargs)

        team_name = getattr(instance, "name", "unknown_team")
        span_name = f"team {team_name}"

        with tracer.start_as_current_span(span_name, kind=SpanKind.CLIENT) as span:
            start_time = time.time()
            result = await wrapped(*args, **kwargs)

            try:
                # Process request using utils function with ALL attributes from semcov
                process_team_request(
                    span,
                    instance,
                    args,
                    kwargs,
                    result,
                    start_time,
                    pricing_info,
                    environment,
                    application_name,
                    metrics,
                    capture_message_content,
                    disable_metrics,
                    version,
                    SemanticConvention.GEN_AI_OPERATION_TYPE_TEAM,
                )

                span.set_status(Status(StatusCode.OK))

            except Exception as e:
                handle_exception(span, e)
                logger.error("Error in async team run trace creation: %s", e)

            return result

    return wrapper


def async_agent_add_tool_wrap(
    gen_ai_endpoint,
    version,
    environment,
    application_name,
    tracer,
    pricing_info,
    capture_message_content,
    metrics,
    disable_metrics,
):
    """
    Wrap Agno Agent.add_tool method for detailed async tracing using process functions only.
    """

    async def wrapper(wrapped, instance, args, kwargs):
        # CRITICAL: Suppression check to prevent recursive instrumentation
        if context_api.get_value(context_api._SUPPRESS_INSTRUMENTATION_KEY):
            return await wrapped(*args, **kwargs)

        agent_name = getattr(instance, "name", "unknown")
        span_name = f"agent {agent_name}"

        with tracer.start_as_current_span(span_name, kind=SpanKind.INTERNAL) as span:
            start_time = time.time()
            result = await wrapped(*args, **kwargs)

            try:
                # Process request using utils function with ALL attributes from semcov
                process_tool_request(
                    span,
                    instance,
                    args,
                    kwargs,
                    result,
                    start_time,
                    pricing_info,
                    environment,
                    application_name,
                    metrics,
                    capture_message_content,
                    disable_metrics,
                    version,
                    SemanticConvention.GEN_AI_OPERATION_TYPE_TOOLS,
                )

                span.set_status(Status(StatusCode.OK))

            except Exception as e:
                handle_exception(span, e)
                logger.error("Error in async agent.add_tool trace creation: %s", e)

            return result

    return wrapper


def async_session_memory_wrap(
    gen_ai_endpoint,
    version,
    environment,
    application_name,
    tracer,
    pricing_info,
    capture_message_content,
    metrics,
    disable_metrics,
):
    """
    Wrap Agno Agent async memory operations (get_session_summary, get_user_memories) using process functions only.
    """

    async def wrapper(wrapped, instance, args, kwargs):
        # CRITICAL: Suppression check to prevent recursive instrumentation
        if context_api.get_value(context_api._SUPPRESS_INSTRUMENTATION_KEY):
            return await wrapped(*args, **kwargs)

        # Extract method name from endpoint
        method_name = gen_ai_endpoint.split(".")[-1]
        span_name = f"memory {method_name.replace('get_', '').replace('_', ' ')}"

        with tracer.start_as_current_span(span_name, kind=SpanKind.INTERNAL) as span:
            # Execute async memory operation with timing
            start_time = time.time()
            result = await wrapped(*args, **kwargs)

            try:
                # Process request using utils function with ALL attributes from semcov
                # Extract method name for operation type
                operation_type = method_name.replace("get_", "").replace("_", " ")
                process_memory_request(
                    span,
                    instance,
                    args,
                    kwargs,
                    result,
                    start_time,
                    pricing_info,
                    environment,
                    application_name,
                    metrics,
                    capture_message_content,
                    disable_metrics,
                    version,
                    operation_type,
                )

                span.set_status(Status(StatusCode.OK))

            except Exception as e:
                handle_exception(span, e)
                logger.error("Error in async memory operation trace creation: %s", e)

            return result

    return wrapper


def async_function_execute_wrap(
    gen_ai_endpoint,
    version,
    environment,
    application_name,
    tracer,
    pricing_info,
    capture_message_content,
    metrics,
    disable_metrics,
):
    """
    Wrap Agno FunctionCall.aexecute method for async tool execution tracing using process functions only.
    """

    async def wrapper(wrapped, instance, args, kwargs):
        # CRITICAL: Suppression check to prevent recursive instrumentation
        if context_api.get_value(context_api._SUPPRESS_INSTRUMENTATION_KEY):
            return await wrapped(*args, **kwargs)

        # Extract function information
        function_name = getattr(instance.function, "name", "unknown_function")
        span_name = f"tool {function_name}"

        # CRITICAL: Capture current OpenTelemetry context to ensure proper nesting
        current_context = context_api.get_current()

        with tracer.start_as_current_span(
            span_name, kind=SpanKind.INTERNAL, context=current_context
        ) as span:
            # Execute async tool with timing
            start_time = time.time()
            # CRITICAL: Set the span context as current for nested calls
            token = context_api.attach(
                context_api.set_value("current_span", span, current_context)
            )
            try:
                result = await wrapped(*args, **kwargs)
            finally:
                context_api.detach(token)

            try:
                # Process request using utils function with ALL attributes from semcov
                process_tool_request(
                    span,
                    instance,
                    args,
                    kwargs,
                    result,
                    start_time,
                    pricing_info,
                    environment,
                    application_name,
                    metrics,
                    capture_message_content,
                    disable_metrics,
                    version,
                    SemanticConvention.GEN_AI_OPERATION_TYPE_TOOLS,
                )

                span.set_status(Status(StatusCode.OK))

            except Exception as e:
                handle_exception(span, e)
                logger.error("Error in async tool execution trace creation: %s", e)

            return result

    return wrapper


def async_toolkit_run_wrap(
    gen_ai_endpoint,
    version,
    environment,
    application_name,
    tracer,
    pricing_info,
    capture_message_content,
    metrics,
    disable_metrics,
):
    """
    Wrap Agno Toolkit async run method for toolkit execution tracing using process functions only.
    """

    async def wrapper(wrapped, instance, args, kwargs):
        # CRITICAL: Suppression check to prevent recursive instrumentation
        if context_api.get_value(context_api._SUPPRESS_INSTRUMENTATION_KEY):
            return await wrapped(*args, **kwargs)

        # Extract toolkit information
        toolkit_name = getattr(
            instance,
            "name",
            getattr(instance, "__class__", {}).get("__name__", "unknown_toolkit"),
        )
        span_name = f"toolkit {toolkit_name}"

        with tracer.start_as_current_span(span_name, kind=SpanKind.INTERNAL) as span:
            # Execute async toolkit with timing
            start_time = time.time()
            result = await wrapped(*args, **kwargs)

            try:
                # Process request using utils function with ALL attributes from semcov
                process_tool_request(
                    span,
                    instance,
                    args,
                    kwargs,
                    result,
                    start_time,
                    pricing_info,
                    environment,
                    application_name,
                    metrics,
                    capture_message_content,
                    disable_metrics,
                    version,
                    SemanticConvention.GEN_AI_OPERATION_TYPE_TOOLS,
                )

                span.set_status(Status(StatusCode.OK))

            except Exception as e:
                handle_exception(span, e)
                logger.error("Error in async toolkit execution trace creation: %s", e)

            return result

    return wrapper


def async_reasoning_wrap(
    gen_ai_endpoint,
    version,
    environment,
    application_name,
    tracer,
    pricing_info,
    capture_message_content,
    metrics,
    disable_metrics,
):
    """
    Wrap Agno Agent.areason method for async reasoning operation tracing using process functions only.
    """

    async def wrapper(wrapped, instance, args, kwargs):
        # CRITICAL: Suppression check to prevent recursive instrumentation
        if context_api.get_value(context_api._SUPPRESS_INSTRUMENTATION_KEY):
            return await wrapped(*args, **kwargs)

        agent_name = getattr(instance, "name", "unknown_agent")
        span_name = f"reasoning {agent_name}"

        with tracer.start_as_current_span(span_name, kind=SpanKind.INTERNAL) as span:
            # Execute async reasoning with timing
            start_time = time.time()
            result = await wrapped(*args, **kwargs)

            try:
                # Process request using utils function with ALL attributes from semcov
                process_reasoning_request(
                    span,
                    instance,
                    args,
                    kwargs,
                    result,
                    start_time,
                    pricing_info,
                    environment,
                    application_name,
                    metrics,
                    capture_message_content,
                    disable_metrics,
                    version,
                    "reasoning",
                )

                span.set_status(Status(StatusCode.OK))

            except Exception as e:
                handle_exception(span, e)
                logger.error("Error in async reasoning trace creation: %s", e)

            return result

    return wrapper


def async_vectordb_upsert_wrap(
    gen_ai_endpoint,
    version,
    environment,
    application_name,
    tracer,
    pricing_info,
    capture_message_content,
    metrics,
    disable_metrics,
):
    """
    Wrap Agno VectorDb async upsert method for vector upsert tracing using process functions only.
    """

    async def wrapper(wrapped, instance, args, kwargs):
        # CRITICAL: Suppression check to prevent recursive instrumentation
        if context_api.get_value(context_api._SUPPRESS_INSTRUMENTATION_KEY):
            return await wrapped(*args, **kwargs)

        span_name = "vectordb upsert"

        with tracer.start_as_current_span(span_name, kind=SpanKind.CLIENT) as span:
            # Execute async vectordb upsert with timing
            start_time = time.time()
            result = await wrapped(*args, **kwargs)

            try:
                # Process request using utils function with ALL attributes from semcov
                process_vectordb_request(
                    span,
                    instance,
                    args,
                    kwargs,
                    result,
                    start_time,
                    pricing_info,
                    environment,
                    application_name,
                    metrics,
                    capture_message_content,
                    disable_metrics,
                    version,
                    "upsert",
                )

                span.set_status(Status(StatusCode.OK))

            except Exception as e:
                handle_exception(span, e)
                logger.error("Error in async vectordb upsert trace creation: %s", e)

            return result

    return wrapper


def async_knowledge_add_wrap(
    gen_ai_endpoint,
    version,
    environment,
    application_name,
    tracer,
    pricing_info,
    capture_message_content,
    metrics,
    disable_metrics,
):
    """
    Wrap Agno AgentKnowledge async add method for knowledge addition tracing using process functions only.
    """

    async def wrapper(wrapped, instance, args, kwargs):
        # CRITICAL: Suppression check to prevent recursive instrumentation
        if context_api.get_value(context_api._SUPPRESS_INSTRUMENTATION_KEY):
            return await wrapped(*args, **kwargs)

        span_name = "knowledge add"

        with tracer.start_as_current_span(span_name, kind=SpanKind.INTERNAL) as span:
            # Execute async knowledge addition with timing
            start_time = time.time()
            result = await wrapped(*args, **kwargs)

            try:
                # Process request using utils function with ALL attributes from semcov
                process_knowledge_request(
                    span,
                    instance,
                    args,
                    kwargs,
                    result,
                    start_time,
                    pricing_info,
                    environment,
                    application_name,
                    metrics,
                    capture_message_content,
                    disable_metrics,
                    version,
                    "add",
                )

                span.set_status(Status(StatusCode.OK))

            except Exception as e:
                handle_exception(span, e)
                logger.error("Error in async knowledge add trace creation: %s", e)

            return result

    return wrapper
