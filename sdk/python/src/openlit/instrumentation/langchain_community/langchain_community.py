"""
Module for monitoring LangChain Community operations.
"""

import logging
from opentelemetry import trace
from opentelemetry.trace import Status, StatusCode

from openlit.__helpers import handle_exception
from openlit.instrumentation.langchain_community.utils import process_general_response

# Initialize logger for LangChain Community instrumentation
logger = logging.getLogger(__name__)


def general_wrap(
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
    Generates a telemetry wrapper for GenAI operations.
    """

    def wrapper(wrapped, instance, args, kwargs):
        """
        Wraps the GenAI operation call.
        """

        # Prepare server address and port
        server_address = "127.0.0.1"
        server_port = "80"

        # Get the parent span from the tracer
        with tracer.start_as_current_span(
            gen_ai_endpoint, kind=trace.SpanKind.CLIENT
        ) as span:
            try:
                # Call the original function
                response = wrapped(*args, **kwargs)

                # Process the response using the utility function
                response = process_general_response(
                    response,
                    gen_ai_endpoint,
                    server_port,
                    server_address,
                    environment,
                    application_name,
                    span,
                    version,
                )

                span.set_status(Status(StatusCode.OK))

            except Exception as e:
                handle_exception(span, e)

            return response

    return wrapper
