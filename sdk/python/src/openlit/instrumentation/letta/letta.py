# pylint: disable=duplicate-code, broad-exception-caught, too-many-statements, unused-argument, too-many-branches
"""
Module for monitoring Letta calls following OpenTelemetry patterns.
"""

import logging
import time
from opentelemetry.trace import SpanKind, Status, StatusCode
from opentelemetry.sdk.resources import (
    SERVICE_NAME,
    TELEMETRY_SDK_NAME,
    DEPLOYMENT_ENVIRONMENT,
)
from openlit.__helpers import handle_exception, common_span_attributes
from openlit.semcov import SemanticConvention
from .utils import (
    get_span_name,
    process_letta_response,
    TracedLettaStream,
    OPERATION_TYPE_MAP,
)

# Initialize logger for logging potential issues and operations
logger = logging.getLogger(__name__)


def create_letta_wrapper(
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
    Creates a unified telemetry wrapper for Letta operations following OpenTelemetry patterns.
    
    This follows the same pattern as LiteLLM and CrewAI instrumentations.
    """

    def wrapper(wrapped, instance, args, kwargs):
        """
        Wraps the API call to add telemetry following OpenTelemetry semantic conventions.
        """
        
        # Extract operation type from endpoint
        endpoint_parts = gen_ai_endpoint.split('.')
        operation = endpoint_parts[-1] if endpoint_parts else "unknown"
        operation_type = OPERATION_TYPE_MAP.get(operation, "workflow")
        
        # Generate proper span name
        span_name = get_span_name(operation_type, gen_ai_endpoint)
        start_time = time.time()
        
        with tracer.start_as_current_span(span_name, kind=SpanKind.CLIENT) as span:
            try:
                # Execute the operation
                response = wrapped(*args, **kwargs)
                
                # Handle streaming responses (for message operations)
                if (operation_type == "chat" and 
                    hasattr(response, '__iter__') and 
                    hasattr(response, '__next__')):
                    
                    # Return traced streaming wrapper
                    return TracedLettaStream(
                        wrapped_stream=response,
                        span=span,
                        span_name=span_name,
                        kwargs=kwargs,
                        capture_content=capture_message_content
                    )
                
                # Process non-streaming response using common helpers
                process_letta_response(
                    span,
                    response,
                    kwargs,
                    operation_type,
                    instance,
                    start_time,
                    environment,
                    application_name,
                    version,
                    gen_ai_endpoint,
                    capture_message_content,
                    pricing_info,
                )
                
                return response
                
            except Exception as e:
                handle_exception(span, e)
                logger.error("Error in Letta trace creation: %s", e)
                # Re-execute without instrumentation on error
                return wrapped(*args, **kwargs)

    return wrapper


# Agent operations
def create_agent(gen_ai_endpoint, version, environment, application_name, tracer,
                pricing_info, capture_message_content, metrics, disable_metrics):
    """Agent operations wrapper (create, retrieve, modify, delete, list)"""
    return create_letta_wrapper(
        gen_ai_endpoint, version, environment, application_name, tracer,
        pricing_info, capture_message_content, metrics, disable_metrics
    )


# Message operations  
def send_message(gen_ai_endpoint, version, environment, application_name, tracer,
                pricing_info, capture_message_content, metrics, disable_metrics):
    """Message operations wrapper (create, create_stream, list, modify, etc.)"""
    return create_letta_wrapper(
        gen_ai_endpoint, version, environment, application_name, tracer,
        pricing_info, capture_message_content, metrics, disable_metrics
    )


# Memory operations
def memory_operation(gen_ai_endpoint, version, environment, application_name, tracer,
                    pricing_info, capture_message_content, metrics, disable_metrics):
    """Memory operations wrapper (core memory, blocks)"""
    return create_letta_wrapper(
        gen_ai_endpoint, version, environment, application_name, tracer,
        pricing_info, capture_message_content, metrics, disable_metrics
    )


# Tool operations
def tool_operation(gen_ai_endpoint, version, environment, application_name, tracer,
                  pricing_info, capture_message_content, metrics, disable_metrics):
    """Tool operations wrapper (list, attach, detach, create)"""
    return create_letta_wrapper(
        gen_ai_endpoint, version, environment, application_name, tracer,
        pricing_info, capture_message_content, metrics, disable_metrics
    )


# Context operations
def context_operation(gen_ai_endpoint, version, environment, application_name, tracer,
                     pricing_info, capture_message_content, metrics, disable_metrics):
    """Context operations wrapper"""
    return create_letta_wrapper(
        gen_ai_endpoint, version, environment, application_name, tracer,
        pricing_info, capture_message_content, metrics, disable_metrics
    )


# Source operations
def source_operation(gen_ai_endpoint, version, environment, application_name, tracer,
                    pricing_info, capture_message_content, metrics, disable_metrics):
    """Source operations wrapper"""
    return create_letta_wrapper(
        gen_ai_endpoint, version, environment, application_name, tracer,
        pricing_info, capture_message_content, metrics, disable_metrics
    )