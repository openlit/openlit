"""
Module for monitoring ChromaDB.
"""

import logging
import time
from opentelemetry.trace import SpanKind, Status, StatusCode
from opentelemetry.sdk.resources import SERVICE_NAME, TELEMETRY_SDK_NAME, DEPLOYMENT_ENVIRONMENT
from openlit.__helpers import (
    get_chat_model_cost,
    handle_exception,
    general_tokens,
    create_metrics_attributes,
    set_server_address_and_port
)
from openlit.semcov import SemanticConvetion

# Initialize logger for logging potential issues and operations
logger = logging.getLogger(__name__)

def text_wrap(version, environment, application_name,
                 tracer, pricing_info, capture_message_content, metrics, disable_metrics):
    """
    Creates a wrapper around a function call to trace and log its execution metrics.

    This function wraps any given function to measure its execution time,
    log its operation, and trace its execution using OpenTelemetry.
    
    Parameters:
    - version (str): The version of the Langchain application.
    - environment (str): The deployment environment (e.g., 'production', 'development').
    - application_name (str): Name of the Langchain application.
    - tracer (opentelemetry.trace.Tracer): The tracer object used for OpenTelemetry tracing.
    - pricing_info (dict): Information about the pricing for internal metrics (currently not used).
    - capture_message_content (bool): Flag indicating whether to trace the content of the response.

    Returns:
    - function: A higher-order function that takes a function 'wrapped' and returns
                a new function that wraps 'wrapped' with additional tracing and logging.
    """

    def wrapper(wrapped, instance, args, kwargs):
        """
        An inner wrapper function that executes the wrapped function, measures execution
        time, and records trace data using OpenTelemetry.

        Parameters:
        - wrapped (Callable): The original function that this wrapper will execute.
        - instance (object): The instance to which the wrapped function belongs. This
                             is used for instance methods. For static and classmethods,
                             this may be None.
        - args (tuple): Positional arguments passed to the wrapped function.
        - kwargs (dict): Keyword arguments passed to the wrapped function.

        Returns:
        - The result of the wrapped function call.
        
        The wrapper initiates a span with the provided tracer, sets various attributes
        on the span based on the function's execution and response, and ensures
        errors are handled and logged appropriately.
        """

        server_address, server_port = set_server_address_and_port(instance, "127.0.0.1", 80)
        request_model = instance.model.config.name_or_path

        span_name = f"{SemanticConvetion.GEN_AI_OPERATION_TYPE_CHAT} {request_model}"

        with tracer.start_as_current_span(span_name, kind= SpanKind.CLIENT) as span:
            start_time = time.time()
            response = wrapped(*args, **kwargs)
            end_time = time.time()

            # pylint: disable=protected-access
            forward_params = instance._forward_params

            try:
                if args and len(args) > 0:
                    prompt = args[0]
                else:
                    prompt = kwargs.get("args", "")

                input_tokens = general_tokens(prompt[0])

                span.set_attribute(TELEMETRY_SDK_NAME, "openlit")
                span.set_attribute(SemanticConvetion.GEN_AI_OPERATION,
                                   SemanticConvetion.GEN_AI_OPERATION_TYPE_CHAT)
                span.set_attribute(SemanticConvetion.GEN_AI_SYSTEM,
                                   SemanticConvetion.GEN_AI_SYSTEM_HUGGING_FACE)
                span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_MODEL,
                                   request_model)
                span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_TEMPERATURE,
                                   forward_params.get("temperature", "null"))
                span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_TOP_P,
                                   forward_params.get("top_p", "null"))
                span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_MAX_TOKENS,
                                   forward_params.get("max_length", -1))
                span.set_attribute(SemanticConvetion.GEN_AI_USAGE_INPUT_TOKENS,
                                   input_tokens)
                span.set_attribute(SemanticConvetion.SERVER_ADDRESS,
                                    server_address)
                span.set_attribute(SemanticConvetion.SERVER_PORT,
                                    server_port)
                span.set_attribute(SemanticConvetion.GEN_AI_RESPONSE_MODEL,
                                    request_model)

                span.set_attribute(DEPLOYMENT_ENVIRONMENT,
                                   environment)
                span.set_attribute(SERVICE_NAME,
                                   application_name)
                span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_IS_STREAM,
                                    False)
                span.set_attribute(SemanticConvetion.GEN_AI_SERVER_TTFT,
                                    end_time - start_time)
                span.set_attribute(SemanticConvetion.GEN_AI_SDK_VERSION,
                                    version)
                if capture_message_content:
                    span.add_event(
                        name=SemanticConvetion.GEN_AI_CONTENT_PROMPT_EVENT,
                        attributes={
                            SemanticConvetion.GEN_AI_CONTENT_PROMPT: prompt,
                        },
                    )

                i = 0
                output_tokens = 0
                for completion in response:
                    if len(response) > 1:
                        attribute_name = f"gen_ai.content.completion.{i}"
                    else:
                        attribute_name = SemanticConvetion.GEN_AI_CONTENT_COMPLETION_EVENT
                    if capture_message_content:
                        # pylint: disable=bare-except
                        try:
                            llm_response = completion.get('generated_text', '')
                        except:
                            llm_response = completion[i].get('generated_text', '')

                        span.add_event(
                            name=attribute_name,
                            attributes={
                                SemanticConvetion.GEN_AI_CONTENT_COMPLETION: llm_response,
                            },
                        )
                    output_tokens += general_tokens(llm_response)

                    i=i+1
                span.set_attribute(SemanticConvetion.GEN_AI_USAGE_OUTPUT_TOKENS,
                                   output_tokens)
                span.set_attribute(SemanticConvetion.GEN_AI_USAGE_TOTAL_TOKENS,
                                   input_tokens + output_tokens)

                # Calculate cost of the operation
                cost = get_chat_model_cost(request_model,
                                            pricing_info, input_tokens,
                                            output_tokens)
                span.set_attribute(SemanticConvetion.GEN_AI_USAGE_COST,
                                    cost)

                span.set_status(Status(StatusCode.OK))

                if disable_metrics is False:
                    attributes = create_metrics_attributes(
                        service_name=application_name,
                        deployment_environment=environment,
                        operation=SemanticConvetion.GEN_AI_OPERATION_TYPE_CHAT,
                        system=SemanticConvetion.GEN_AI_SYSTEM_HUGGING_FACE,
                        request_model=request_model,
                        server_address=server_address,
                        server_port=server_port,
                        response_model=request_model,
                    )

                    metrics["genai_client_usage_tokens"].record(
                        input_tokens + output_tokens, attributes
                    )
                    metrics["genai_client_operation_duration"].record(
                        end_time - start_time, attributes
                    )
                    metrics["genai_server_ttft"].record(
                        end_time - start_time, attributes
                    )
                    metrics["genai_requests"].add(1, attributes)
                    metrics["genai_completion_tokens"].add(output_tokens, attributes)
                    metrics["genai_prompt_tokens"].add(input_tokens, attributes)
                    metrics["genai_cost"].record(cost, attributes)

                # Return original response
                return response

            except Exception as e:
                handle_exception(span, e)
                logger.error("Error in trace creation: %s", e)

                # Return original response
                return response

    return wrapper
