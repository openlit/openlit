# pylint: disable=duplicate-code, broad-exception-caught, too-many-statements, unused-argument
"""
Module for monitoring async Letta calls following OpenTelemetry patterns.
"""

import logging
import asyncio
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
    OPERATION_TYPE_MAP,
)

# Initialize logger for logging potential issues and operations
logger = logging.getLogger(__name__)


def create_async_letta_wrapper(
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
    Creates a unified telemetry wrapper for async Letta operations.
    """

    def wrapper(wrapped, instance, args, kwargs):
        """
        Wraps the async API call to add telemetry.
        """
        
        async def async_wrapper(*args, **kwargs):
            # Extract operation type from endpoint
            endpoint_parts = gen_ai_endpoint.split('.')
            operation = endpoint_parts[-1] if endpoint_parts else "unknown"
            operation_type = OPERATION_TYPE_MAP.get(operation, "workflow")
            
            # Generate proper span name with context
            span_name = get_span_name(operation_type, gen_ai_endpoint, instance, kwargs)
            start_time = time.time()
            
            with tracer.start_as_current_span(span_name, kind=SpanKind.CLIENT) as span:
                try:
                    # Execute async operation
                    if asyncio.iscoroutinefunction(wrapped):
                        response = await wrapped(*args, **kwargs)
                    else:
                        response = wrapped(*args, **kwargs)
                    
                    # Process response using common helpers
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
                    logger.error("Error in async Letta trace creation: %s", e)
                    # Re-execute without instrumentation on error
                    if asyncio.iscoroutinefunction(wrapped):
                        return await wrapped(*args, **kwargs)
                    else:
                        return wrapped(*args, **kwargs)

        return async_wrapper(*args, **kwargs)

    return wrapper


# Async agent operations
def async_create_agent(gen_ai_endpoint, version, environment, application_name, tracer,
                      pricing_info, capture_message_content, metrics, disable_metrics):
    """Async agent operations wrapper"""
    return create_async_letta_wrapper(
        gen_ai_endpoint, version, environment, application_name, tracer,
        pricing_info, capture_message_content, metrics, disable_metrics
    )


# Async message operations  
def async_send_message(gen_ai_endpoint, version, environment, application_name, tracer,
                      pricing_info, capture_message_content, metrics, disable_metrics):
    """Async message operations wrapper"""
    return create_async_letta_wrapper(
        gen_ai_endpoint, version, environment, application_name, tracer,
        pricing_info, capture_message_content, metrics, disable_metrics
    )