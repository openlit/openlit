"""
Module for monitoring AG2 API calls.
"""

import logging
from opentelemetry.trace import SpanKind, Status, StatusCode
from opentelemetry.sdk.resources import SERVICE_NAME, TELEMETRY_SDK_NAME, DEPLOYMENT_ENVIRONMENT
from openlit.__helpers import (
    handle_exception,
)
from openlit.semcov import SemanticConvention

# Initialize logger for logging potential issues and operations
logger = logging.getLogger(__name__)

def set_span_attributes(span, version, operation_name, environment,
        application_name, server_address, server_port, request_model):
    """
    Set common attributes for the span.
    """

    # Set Span attributes (OTel Semconv)
    span.set_attribute(TELEMETRY_SDK_NAME, 'openlit')
    span.set_attribute(SemanticConvention.GEN_AI_OPERATION, operation_name)
    span.set_attribute(SemanticConvention.GEN_AI_SYSTEM, SemanticConvention.GEN_AI_SYSTEM_AG2)
    span.set_attribute(SemanticConvention.SERVER_ADDRESS, server_address)
    span.set_attribute(SemanticConvention.SERVER_PORT, server_port)
    span.set_attribute(SemanticConvention.GEN_AI_REQUEST_MODEL, request_model)

    # Set Span attributes (Extras)
    span.set_attribute(DEPLOYMENT_ENVIRONMENT, environment)
    span.set_attribute(SERVICE_NAME, application_name)
    span.set_attribute(SemanticConvention.GEN_AI_SDK_VERSION, version)

def create_agent(version, environment, application_name,
                      tracer, event_provider, pricing_info, capture_message_content, metrics, disable_metrics):
    """
    Generates a telemetry wrapper for GenAI function call
    """
    def wrapper(wrapped, instance, args, kwargs):
        server_address, server_port = '127.0.0.1', 80

        agent_name = kwargs.get('name', 'openai_agent')
        span_name = f'{SemanticConvention.GEN_AI_OPERATION_TYPE_CREATE_AGENT} {agent_name}'

        with tracer.start_as_current_span(span_name, kind=SpanKind.CLIENT) as span:
            try:
                response = wrapped(*args, **kwargs)

                set_span_attributes(span, version, SemanticConvention.GEN_AI_OPERATION_TYPE_CREATE_AGENT,
                    environment, application_name, server_address, server_port, kwargs.get('model', 'gpt-4o'))
                span.set_attribute(SemanticConvention.GEN_AI_AGENT_NAME, agent_name)

                span.set_attribute(SemanticConvention.GEN_AI_AGENT_DESCRIPTION, kwargs.get('instructions', ''))

                span.set_status(Status(StatusCode.OK))

                return response

            except Exception as e:
                handle_exception(span, e)
                logger.error('Error in trace creation: %s', e)
                return response

    return wrapper
