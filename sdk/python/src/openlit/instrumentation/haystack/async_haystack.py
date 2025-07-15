# pylint: disable=duplicate-code, broad-exception-caught, too-many-statements, unused-argument
"""
Module for monitoring Haystack async applications.
"""

import time
from opentelemetry.trace import SpanKind
from opentelemetry import context as context_api
from openlit.__helpers import handle_exception
from openlit.instrumentation.haystack.utils import (
    process_haystack_response,
    OPERATION_MAP,
    set_server_address_and_port,
)

def async_general_wrap(gen_ai_endpoint, version, environment, application_name,
    tracer, pricing_info, capture_message_content, metrics, disable_metrics):
    """
    Create a wrapper for Haystack async operations using the general wrap pattern.
    
    Args:
        gen_ai_endpoint (str): The endpoint identifier for the operation
        version (str): Version of the Haystack package
        environment (str): Environment name
        application_name (str): Application name
        tracer: OpenTelemetry tracer instance
        pricing_info (dict): Pricing information for cost tracking
        capture_message_content (bool): Whether to capture message content
        metrics: Metrics collection instance
        disable_metrics (bool): Whether to disable metrics collection
    
    Returns:
        callable: Wrapped async function for telemetry collection
    """

    async def wrapper(wrapped, instance, args, kwargs):
        """
        Wraps the Haystack async function call to add telemetry.
        
        Args:
            wrapped: The original async function being wrapped
            instance: The instance of the class (if method)
            args: Positional arguments
            kwargs: Keyword arguments
            
        Returns:
            The response from the original async function
        """
        # CRITICAL: Suppression check
        if context_api.get_value(context_api._SUPPRESS_INSTRUMENTATION_KEY):
            return await wrapped(*args, **kwargs)

        # Get server address and port using the standard helper
        server_address, server_port = set_server_address_and_port(instance)
        
        # Get operation type from mapping
        operation_type = OPERATION_MAP.get(gen_ai_endpoint, "framework")
        
        # Create span name based on endpoint
        if gen_ai_endpoint == "haystack.async_pipeline_run":
            span_name = "haystack async_pipeline_run"
        elif gen_ai_endpoint == "haystack.async_generator_run":
            span_name = "haystack async_generator_run"
        elif gen_ai_endpoint.startswith("haystack.component."):
            component_name = gen_ai_endpoint.replace("haystack.component.", "")
            span_name = f"haystack async_{component_name}"
        else:
            span_name = f"haystack async_{gen_ai_endpoint.split('.')[-1]}"

        with tracer.start_as_current_span(span_name, kind=SpanKind.CLIENT) as span:
            start_time = time.time()
            response = await wrapped(*args, **kwargs)
            
            try:
                # Process response and generate telemetry
                response = process_haystack_response(
                    response, operation_type, server_address, server_port,
                    environment, application_name, metrics, start_time, span,
                    capture_message_content, disable_metrics, version, 
                    instance, args, endpoint=gen_ai_endpoint, **kwargs
                )
                
            except Exception as e:
                handle_exception(span, e)
                
            return response
    
    return wrapper 