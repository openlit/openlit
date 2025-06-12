"""
Module for monitoring Pydantic AI API calls.
"""

import logging
import time
from opentelemetry.trace import SpanKind, Status, StatusCode
from opentelemetry.sdk.resources import SERVICE_NAME, TELEMETRY_SDK_NAME, DEPLOYMENT_ENVIRONMENT
from openlit.__helpers import (
    handle_exception,
    get_chat_model_cost,
)
from openlit.instrumentation.pydantic_ai.utils import (
    common_agent_run
)
from openlit.semcov import SemanticConvention

# Initialize logger for logging potential issues and operations
logger = logging.getLogger(__name__)

def set_span_attributes(span, version, operation_name, environment,
        application_name, server_address, server_port, request_model, agent_name):
    """
    Set common attributes for the span.
    """

    # Set Span attributes (OTel Semconv)
    span.set_attribute(TELEMETRY_SDK_NAME, 'openlit')
    span.set_attribute(SemanticConvention.GEN_AI_OPERATION, operation_name)
    span.set_attribute(SemanticConvention.GEN_AI_SYSTEM, SemanticConvention.GEN_AI_SYSTEM_PYDANTIC_AI)
    span.set_attribute(SemanticConvention.GEN_AI_AGENT_NAME, agent_name)
    span.set_attribute(SemanticConvention.SERVER_ADDRESS, server_address)
    span.set_attribute(SemanticConvention.SERVER_PORT, server_port)
    span.set_attribute(SemanticConvention.GEN_AI_REQUEST_MODEL, request_model)

    # Set Span attributes (Extras)
    span.set_attribute(DEPLOYMENT_ENVIRONMENT, environment)
    span.set_attribute(SERVICE_NAME, application_name)
    span.set_attribute(SemanticConvention.GEN_AI_SDK_VERSION, version)

def agent_create(version, environment, application_name,
    tracer, pricing_info, capture_message_content, metrics, disable_metrics):

    """
    Generates a telemetry wrapper for GenAI function call
    """

    def wrapper(wrapped, instance, args, kwargs):
        server_address, server_port = '127.0.0.1', 80

        agent_name = kwargs.get("name", "pydantic_agent")
        span_name = f'{SemanticConvention.GEN_AI_OPERATION_TYPE_CREATE_AGENT} {agent_name}'

        with tracer.start_as_current_span(span_name, kind=SpanKind.CLIENT) as span:
            try:
                start_time = time.time()
                response = wrapped(*args, **kwargs)
                end_time = time.time()

                request_model = args[0] or kwargs.get("model", "google-gla:gemini-1.5-flash")
                set_span_attributes(span, version, SemanticConvention.GEN_AI_OPERATION_TYPE_CREATE_AGENT,
                    environment, application_name, server_address, server_port, request_model, agent_name)
                span.set_attribute(SemanticConvention.GEN_AI_AGENT_DESCRIPTION, str(kwargs.get("system_prompt", "")))
                span.set_attribute(SemanticConvention.GEN_AI_RESPONSE_MODEL, request_model)

                span.set_status(Status(StatusCode.OK))

                return response

            except Exception as e:
                handle_exception(span, e)
                logger.error('Error in trace creation: %s', e)
                return response

    return wrapper

def common_agent_run(wrapped, instance, args, kwargs, tracer, version, environment, application_name,
                         capture_message_content, response):
    server_address, server_port = instance.model.base_url, 443
    agent_name = instance.name or "pydantic_agent"
    request_model = str(instance.model.model_name)
    span_name = f'{SemanticConvention.GEN_AI_OPERATION_TYPE_EXECUTE_AGENT_TASK} {agent_name}'
    
    with tracer.start_as_current_span(span_name, kind=SpanKind.CLIENT) as span:
        try:
            start_time = time.time()
            end_time = time.time()
            set_span_attributes(span, version, SemanticConvention.GEN_AI_OPERATION_TYPE_EXECUTE_AGENT_TASK,
                                environment, application_name, server_address, server_port, request_model, agent_name)
            span.set_attribute(SemanticConvention.GEN_AI_AGENT_DESCRIPTION, str(instance._system_prompts))
            span.set_attribute(SemanticConvention.GEN_AI_RESPONSE_MODEL, request_model)

            if capture_message_content:
                span.add_event(
                    name=SemanticConvention.GEN_AI_CONTENT_COMPLETION_EVENT,
                    attributes={
                        SemanticConvention.GEN_AI_CONTENT_COMPLETION: response.output,
                    },
                )

            span.set_status(Status(StatusCode.OK))

            return response

        except Exception as e:
            handle_exception(span, e)
            logger.error('Error in trace creation: %s', e)
            return response

def agent_run(version, environment, application_name,
              tracer, pricing_info, capture_message_content, metrics, disable_metrics):
    """
    Generates a telemetry wrapper for GenAI function call
    """

    def wrapper(wrapped, instance, args, kwargs):
        response = wrapped(*args, **kwargs)
        return common_agent_run(wrapped, instance, args, kwargs, tracer, 
                                    version, environment, application_name, 
                                    capture_message_content, response=response)

    return wrapper

def async_agent_run(version, environment, application_name,
                    tracer, pricing_info, capture_message_content, metrics, disable_metrics):
    """
    Generates a telemetry wrapper for GenAI function call
    """

    async def wrapper(wrapped, instance, args, kwargs):
        response = await wrapped(*args, **kwargs)
        return common_agent_run(wrapped, instance, args, kwargs, tracer, 
                                          version, environment, application_name, 
                                          capture_message_content, response=response)

    return wrapper