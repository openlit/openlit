# pylint: disable=duplicate-code, broad-exception-caught, too-many-statements, unused-argument
"""
Module for monitoring AG2.
"""

import logging
import time
from opentelemetry.trace import SpanKind, Status, StatusCode
from opentelemetry.sdk.resources import SERVICE_NAME, TELEMETRY_SDK_NAME, DEPLOYMENT_ENVIRONMENT
from openlit.__helpers import (
    handle_exception, 
    concatenate_all_contents,
    get_chat_model_cost,
    response_as_dict,
    otel_event,
)
from openlit.semcov import SemanticConvetion

# Initialize logger for logging potential issues and operations
logger = logging.getLogger(__name__)

AGENT_NAME = ''
REQUEST_MODEL = ''
SYSTEM_MESSAGE = ''
MODEL_AND_NAME_SET = False

def conversable_agent(version, environment, application_name,
                 tracer, event_provider, pricing_info, capture_message_content, metrics, disable_metrics):
    """
    Generates a telemetry wrapper for GenAI function call
    """
    def wrapper(wrapped, instance, args, kwargs):
        """
        Wraps the GenAI function call.
        """

        server_address, server_port = '127.0.0.1', 80
        global AGENT_NAME, MODEL_AND_NAME_SET, REQUEST_MODEL, SYSTEM_MESSAGE
        if MODEL_AND_NAME_SET is False:
            AGENT_NAME = kwargs.get("name", "NOT_FOUND")
            REQUEST_MODEL = kwargs.get("llm_config", {}).get('model', 'gpt-4o')
            SYSTEM_MESSAGE = kwargs.get('system_message', '')
            MODEL_AND_NAME_SET = True

        span_name = f"{SemanticConvetion.GEN_AI_OPERATION_TYPE_CREATE_AGENT} {AGENT_NAME}"

        with tracer.start_as_current_span(span_name, kind= SpanKind.CLIENT) as span:
            start_time = time.time()
            response = wrapped(*args, **kwargs)
            end_time = time.time()

            try:
                span.set_attribute(TELEMETRY_SDK_NAME, "openlit")
                span.set_attribute(SemanticConvetion.GEN_AI_OPERATION,
                                SemanticConvetion.GEN_AI_OPERATION_TYPE_CREATE_AGENT)
                span.set_attribute(SemanticConvetion.GEN_AI_SYSTEM,
                                SemanticConvetion.GEN_AI_SYSTEM_AG2)
                span.set_attribute(SemanticConvetion.GEN_AI_AGENT_NAME,
                                AGENT_NAME)
                span.set_attribute(SemanticConvetion.GEN_AI_AGENT_DESCRIPTION,
                                SYSTEM_MESSAGE)
                span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_MODEL,
                                REQUEST_MODEL)
                span.set_attribute(SemanticConvetion.GEN_AI_RESPONSE_MODEL,
                                REQUEST_MODEL)
                span.set_attribute(SemanticConvetion.SERVER_ADDRESS,
                                server_address)
                span.set_attribute(SemanticConvetion.SERVER_PORT,
                                server_port)

                span.set_attribute(DEPLOYMENT_ENVIRONMENT,
                                environment)
                span.set_attribute(SERVICE_NAME,
                                application_name)
                span.set_attribute(SemanticConvetion.GEN_AI_SDK_VERSION,
                                version)


                span.set_status(Status(StatusCode.OK))

                # Return original response
                return response

            except Exception as e:
                handle_exception(span, e)
                logger.error("Error in trace creation: %s", e)

                # Return original response
                return response

    return wrapper

def agent_run(version, environment, application_name,
                 tracer, event_provider, pricing_info, capture_message_content, metrics, disable_metrics):
    """
    Generates a telemetry wrapper for GenAI function call
    """
    def wrapper(wrapped, instance, args, kwargs):
        """
        Wraps the GenAI function call.
        """

        server_address, server_port = '127.0.0.1', 80
        global AGENT_NAME, REQUEST_MODEL
        span_name = f"{SemanticConvetion.GEN_AI_OPERATION_TYPE_EXECUTE_AGENT_TASK} {AGENT_NAME}"

        with tracer.start_as_current_span(span_name, kind= SpanKind.CLIENT) as span:
            start_time = time.time()
            response = wrapped(*args, **kwargs)
            end_time = time.time()

            try:

                # Initialize totals
                input_tokens = 0
                output_tokens = 0

                for usage_key in response.cost:
                    usage_data = response.cost[usage_key]
                    if isinstance(usage_data, dict):
                        for model_key in usage_data:
                            if model_key != 'total_cost':  # We only want to sum tokens for specific models
                                model_data = usage_data[model_key]
                                input_tokens += model_data.get('prompt_tokens', 0)
                                output_tokens += model_data.get('completion_tokens', 0)
                
                cost = get_chat_model_cost(REQUEST_MODEL, pricing_info, input_tokens, output_tokens)


                span.set_attribute(TELEMETRY_SDK_NAME, "openlit")
                span.set_attribute(SemanticConvetion.GEN_AI_OPERATION,
                                SemanticConvetion.GEN_AI_OPERATION_TYPE_EXECUTE_AGENT_TASK)
                span.set_attribute(SemanticConvetion.GEN_AI_SYSTEM,
                                SemanticConvetion.GEN_AI_SYSTEM_AG2)
                span.set_attribute(SemanticConvetion.GEN_AI_AGENT_NAME,
                                AGENT_NAME)
                span.set_attribute(SemanticConvetion.SERVER_ADDRESS,
                                server_address)
                span.set_attribute(SemanticConvetion.SERVER_PORT,
                                server_port)
                span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_MODEL,
                                REQUEST_MODEL)
                span.set_attribute(SemanticConvetion.GEN_AI_RESPONSE_MODEL,
                                list(response.cost.get('usage_including_cached_inference').keys())[1])
                span.set_attribute(SemanticConvetion.GEN_AI_USAGE_INPUT_TOKENS,
                                input_tokens)
                span.set_attribute(SemanticConvetion.GEN_AI_USAGE_OUTPUT_TOKENS,
                                output_tokens)

                span.set_attribute(DEPLOYMENT_ENVIRONMENT,
                                environment)
                span.set_attribute(SERVICE_NAME,
                                application_name)
                span.set_attribute(SemanticConvetion.GEN_AI_CLIENT_TOKEN_USAGE,
                                input_tokens + output_tokens)
                span.set_attribute(SemanticConvetion.GEN_AI_USAGE_COST,
                                cost)
                span.set_attribute(SemanticConvetion.GEN_AI_SDK_VERSION,
                                version)

                # Iterate through the chat history
                for chat in response.chat_history:
                    if chat['role'] == 'user':                    
                        choice_event = otel_event(
                            name=SemanticConvetion.GEN_AI_CHOICE,
                            attributes={
                                SemanticConvetion.GEN_AI_SYSTEM: SemanticConvetion.GEN_AI_SYSTEM_AG2
                            },
                            body={
                                "index": response.chat_history.index(chat),
                                "message": {
                                    **({"content": chat['content']} if capture_message_content else {}),
                                    "role": chat['role']
                                }
                            }
                        )
                        event_provider.emit(choice_event)

                    elif chat['role'] == 'assistant':                    
                        choice_event = otel_event(
                            name=SemanticConvetion.GEN_AI_USER_MESSAGE,
                            attributes={
                                SemanticConvetion.GEN_AI_SYSTEM: SemanticConvetion.GEN_AI_SYSTEM_AG2
                            },
                            body={
                                **({"content": chat['content']} if capture_message_content else {}),
                                "role": chat['role']
                            }
                        )
                        event_provider.emit(choice_event)

                span.set_status(Status(StatusCode.OK))

                # Return original response
                return response

            except Exception as e:
                handle_exception(span, e)
                logger.error("Error in trace creation: %s", e)

                # Return original response
                return response

    return wrapper
