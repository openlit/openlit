"""
Module for monitoring async LangChain Community operations.
"""

import logging
from opentelemetry import trace
from opentelemetry.trace import Status, StatusCode

from openlit.__helpers import handle_exception
from openlit.instrumentation.langchain_community.utils import process_general_response

# Initialize logger for LangChain Community instrumentation
logger = logging.getLogger(__name__)

def async_general_wrap(gen_ai_endpoint, version, environment, application_name, tracer, pricing_info, capture_message_content, metrics, disable_metrics):
    """
    Creates a wrapper to monitor async general LangChain Community operations.
    
    Args:
        gen_ai_endpoint: The endpoint identifier for the operation
        version: The version of the LangChain Community package
        environment: The environment name
        application_name: The application name
        tracer: The OpenTelemetry tracer
        pricing_info: Pricing information for cost calculation
        capture_message_content: Whether to capture message content
        metrics: Metrics dictionary
        disable_metrics: Whether to disable metrics collection
    
    Returns:
        A wrapper function for async LangChain Community operations
    """

    def wrapper(wrapped, instance, args, kwargs):
        """
        Wrapper function for async LangChain Community operations.
        
        Args:
            wrapped: The wrapped function
            instance: The instance being wrapped
            args: Positional arguments
            kwargs: Keyword arguments
        
        Returns:
            The result of the wrapped function
        """

        async def traced_method(*args, **kwargs):
            # Prepare server address and port
            server_address = ""
            server_port = ""

            # Get the parent span from the tracer
            with tracer.start_as_current_span(gen_ai_endpoint, kind=trace.SpanKind.CLIENT) as span:
                try:
                    # Call the original async function
                    response = await wrapped(*args, **kwargs)
                    
                    # Process the response using the utility function
                    response = process_general_response(
                        response, gen_ai_endpoint, server_port, server_address,
                        environment, application_name, span, version
                    )

                    span.set_status(Status(StatusCode.OK))
                    return response

                except Exception as e:
                    # Handle any exception that might occur during the function call
                    handle_exception(span, e)
                    logger.error("Error in async LangChain Community operation: %s", e)
                    
                    # Reraise the exception to maintain the original behavior
                    raise

        return traced_method(*args, **kwargs)

    return wrapper 