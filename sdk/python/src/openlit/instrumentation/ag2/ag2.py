"""
Module for monitoring AG2 API calls.
"""

import logging
import time
from opentelemetry.trace import SpanKind, Status, StatusCode
from opentelemetry.sdk.resources import SERVICE_NAME, TELEMETRY_SDK_NAME, DEPLOYMENT_ENVIRONMENT
from openlit.__helpers import (
    handle_exception,
    get_chat_model_cost,
    otel_event,
)
from openlit.semcov import SemanticConvention

# Initialize logger for logging potential issues and operations
logger = logging.getLogger(__name__)

AGENT_NAME = ''
REQUEST_MODEL = ''
SYSTEM_MESSAGE = ''
MODEL_AND_NAME_SET = False

def set_span_attributes(span, version, operation_name, environment,
        application_name, server_address, server_port, request_model):
    """
    Set common attributes for the span.
    """

    # Set Span attributes (OTel Semconv)
    span.set_attribute(TELEMETRY_SDK_NAME, 'openlit')
    span.set_attribute(SemanticConvention.GEN_AI_OPERATION, operation_name)
    span.set_attribute(SemanticConvention.GEN_AI_SYSTEM, SemanticConvention.GEN_AI_SYSTEM_AG2)
    span.set_attribute(SemanticConvention.GEN_AI_AGENT_NAME, AGENT_NAME)
    span.set_attribute(SemanticConvention.SERVER_ADDRESS, server_address)
    span.set_attribute(SemanticConvention.SERVER_PORT, server_port)
    span.set_attribute(SemanticConvention.GEN_AI_REQUEST_MODEL, request_model)

    # Set Span attributes (Extras)
    span.set_attribute(DEPLOYMENT_ENVIRONMENT, environment)
    span.set_attribute(SERVICE_NAME, application_name)
    span.set_attribute(SemanticConvention.GEN_AI_SDK_VERSION, version)

def calculate_tokens_and_cost(response, request_model, pricing_info):
    """
    Calculate the input, output tokens, and their respective costs.
    """
    input_tokens = 0
    output_tokens = 0

    for usage_data in response.cost.values():
        if isinstance(usage_data, dict):
            for model_data in usage_data.values():
                if isinstance(model_data, dict):
                    input_tokens += model_data.get('prompt_tokens', 0)
                    output_tokens += model_data.get('completion_tokens', 0)

    cost = get_chat_model_cost(request_model, pricing_info, input_tokens, output_tokens)
    return input_tokens, output_tokens, cost

def emit_events(response, event_provider, capture_message_content):
    """
    Emit OpenTelemetry events for each chat history entry.
    """
    for chat in response.chat_history:
        event_type = (
            SemanticConvention.GEN_AI_CHOICE if chat['role'] == 'user'
            else SemanticConvention.GEN_AI_USER_MESSAGE
        )
        choice_event = otel_event(
            name=event_type,
            attributes={
                SemanticConvention.GEN_AI_SYSTEM: SemanticConvention.GEN_AI_SYSTEM_AG2
            },
            body={
                'index': response.chat_history.index(chat),
                'message': {
                    **({'content': chat['content']} if capture_message_content else {}),
                    'role': 'assistant' if chat['role'] == 'user' else 'user'
                }
            }
        )
        event_provider.emit(choice_event)

def conversable_agent(version, environment, application_name,
                      tracer, event_provider, pricing_info, capture_message_content, metrics, disable_metrics):
    """
    Generates a telemetry wrapper for GenAI function call
    """
    def wrapper(wrapped, instance, args, kwargs):
        server_address, server_port = '127.0.0.1', 80
        global AGENT_NAME, MODEL_AND_NAME_SET, REQUEST_MODEL, SYSTEM_MESSAGE

        if not MODEL_AND_NAME_SET:
            AGENT_NAME = kwargs.get('name', 'NOT_FOUND')
            REQUEST_MODEL = kwargs.get('llm_config', {}).get('model', 'gpt-4o')
            SYSTEM_MESSAGE = kwargs.get('system_message', '')
            MODEL_AND_NAME_SET = True

        span_name = f'{SemanticConvention.GEN_AI_OPERATION_TYPE_CREATE_AGENT} {AGENT_NAME}'

        with tracer.start_as_current_span(span_name, kind=SpanKind.CLIENT) as span:
            try:
                start_time = time.time()
                response = wrapped(*args, **kwargs)
                end_time = time.time()

                set_span_attributes(span, version, SemanticConvention.GEN_AI_OPERATION_TYPE_CREATE_AGENT,
                    environment, application_name, server_address, server_port, REQUEST_MODEL)
                span.set_attribute(SemanticConvention.GEN_AI_AGENT_DESCRIPTION, SYSTEM_MESSAGE)
                span.set_attribute(SemanticConvention.GEN_AI_RESPONSE_MODEL, REQUEST_MODEL)
                span.set_attribute(SemanticConvention.GEN_AI_SERVER_TTFT, end_time - start_time)

                span.set_status(Status(StatusCode.OK))

                return response

            except Exception as e:
                handle_exception(span, e)
                logger.error('Error in trace creation: %s', e)
                return response

    return wrapper

def agent_run(version, environment, application_name,
              tracer, event_provider, pricing_info, capture_message_content, metrics, disable_metrics):
    """
    Generates a telemetry wrapper for GenAI function call
    """
    def wrapper(wrapped, instance, args, kwargs):
        server_address, server_port = '127.0.0.1', 80

        span_name = f'{SemanticConvention.GEN_AI_OPERATION_TYPE_EXECUTE_AGENT_TASK} {AGENT_NAME}'

        with tracer.start_as_current_span(span_name, kind=SpanKind.CLIENT) as span:
            try:
                start_time = time.time()
                response = wrapped(*args, **kwargs)
                end_time = time.time()

                input_tokens, output_tokens, cost = calculate_tokens_and_cost(response, REQUEST_MODEL, pricing_info)
                response_model = list(response.cost.get('usage_including_cached_inference', {}).keys())[1]

                set_span_attributes(span, version, SemanticConvention.GEN_AI_OPERATION_TYPE_EXECUTE_AGENT_TASK,
                    environment, application_name, server_address, server_port, REQUEST_MODEL)
                span.set_attribute(SemanticConvention.GEN_AI_RESPONSE_MODEL, response_model)
                span.set_attribute(SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS, input_tokens)
                span.set_attribute(SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS, output_tokens)
                span.set_attribute(SemanticConvention.GEN_AI_CLIENT_TOKEN_USAGE, input_tokens + output_tokens)
                span.set_attribute(SemanticConvention.GEN_AI_USAGE_COST, cost)
                span.set_attribute(SemanticConvention.GEN_AI_SERVER_TTFT, end_time - start_time)

                emit_events(response, event_provider, capture_message_content)
                span.set_status(Status(StatusCode.OK))

                return response

            except Exception as e:
                handle_exception(span, e)
                logger.error('Error in trace creation: %s', e)
                return response

    return wrapper
