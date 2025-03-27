# pylint: disable=duplicate-code, broad-exception-caught, too-many-statements, unused-argument, unused-import, too-many-function-args
"""
Module for monitoring Langchain applications.
"""

import logging
import time
from opentelemetry.trace import SpanKind, Status, StatusCode
from opentelemetry.sdk.resources import SERVICE_NAME, TELEMETRY_SDK_NAME, DEPLOYMENT_ENVIRONMENT
from openlit.__helpers import (
    get_chat_model_cost,
    handle_exception,
    general_tokens,
    calculate_ttft,
    calculate_tbt,
    create_metrics_attributes,
)
from openlit.semcov import SemanticConvention

# Initialize logger for logging potential issues and operations
logger = logging.getLogger(__name__)

def get_attribute_from_instance_or_kwargs(instance, attribute_name, default=-1):
    """Return attribute from instance or kwargs"""
    # Attempt to retrieve model_kwargs from the instance
    model_kwargs = getattr(instance, 'model_kwargs', None)

    # Check for attribute in model_kwargs if it exists
    if model_kwargs and attribute_name in model_kwargs:
        return model_kwargs[attribute_name]

    # Attempt to get the attribute directly from the instance
    try:
        return getattr(instance, attribute_name)
    except AttributeError:
        # Special handling for 'model' attribute to consider 'model_id'
        if attribute_name == 'model':
            return getattr(instance, 'model_id', 'default_model_id')

        # Default if the attribute isn't found in model_kwargs or the instance
        return default

def async_general_wrap(gen_ai_endpoint, version, environment, application_name,
                 tracer, pricing_info, capture_message_content, metrics, disable_metrics):
    """
    Creates a wrapper around a function call to trace and log its execution metrics.

    This function wraps any given function to measure its execution time,
    log its operation, and trace its execution using OpenTelemetry.
    
    Parameters:
    - gen_ai_endpoint (str): A descriptor or name for the endpoint being traced.
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

    async def wrapper(wrapped, instance, args, kwargs):
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
        with tracer.start_as_current_span(gen_ai_endpoint, kind= SpanKind.CLIENT) as span:
            response = await wrapped(*args, **kwargs)

            try:
                span.set_attribute(TELEMETRY_SDK_NAME, "openlit")
                span.set_attribute(SemanticConvention.GEN_AI_SYSTEM,
                                    SemanticConvention.GEN_AI_SYSTEM_LANGCHAIN)
                span.set_attribute(SemanticConvention.GEN_AI_ENDPOINT,
                                    gen_ai_endpoint)
                span.set_attribute(DEPLOYMENT_ENVIRONMENT,
                                    environment)
                span.set_attribute(SemanticConvention.GEN_AI_OPERATION,
                                    SemanticConvention.GEN_AI_OPERATION_TYPE_FRAMEWORK)
                span.set_attribute(SERVICE_NAME,
                                    application_name)
                span.set_attribute(SemanticConvention.GEN_AI_RETRIEVAL_SOURCE,
                                    response[0].metadata["source"])
                span.set_status(Status(StatusCode.OK))

                # Return original response
                return response

            except Exception as e:
                handle_exception(span, e)
                logger.error("Error in trace creation: %s", e)

                # Return original response
                return response

    return wrapper

def async_hub(gen_ai_endpoint, version, environment, application_name, tracer,
        pricing_info, capture_message_content, metrics, disable_metrics):
    """
    Creates a wrapper around Langchain hub operations for tracing and logging.

    Similar to `general_wrap`, this function focuses on wrapping functions involved
    in interacting with the Langchain hub, adding specific metadata relevant to
    hub operations to the span attributes.

    Parameters:
    - gen_ai_endpoint (str): A descriptor or name for the Langchain hub endpoint.
    - version (str): The version of the Langchain application.
    - environment (str): The deployment environment, such as 'production' or 'development'.
    - application_name (str): Name of the Langchain application.
    - tracer (opentelemetry.trace.Tracer): The tracer for OpenTelemetry tracing.
    - pricing_info (dict): Pricing information for the operation (not currently used).
    - capture_message_content (bool): Indicates if the content of the response should be traced.

    Returns:
    - function: A new function that wraps the original hub operation call with added
                logging, tracing, and metric calculation functionalities.
    """

    async def wrapper(wrapped, instance, args, kwargs):
        """
        An inner wrapper specifically designed for Langchain hub operations,
        providing tracing, logging, and execution metrics.

        Parameters:
        - wrapped (Callable): The original hub operation function to be executed.
        - instance (object): The instance of the class where the hub operation
                             method is defined. May be None for static or class methods.
        - args (tuple): Positional arguments to pass to the hub operation function.
        - kwargs (dict): Keyword arguments to pass to the hub operation function.

        Returns:
        - The result of executing the hub operation function.
        
        This wrapper captures additional metadata relevant to Langchain hub operations,
        creating spans with specific attributes and metrics that reflect the nature of
        each hub call.
        """

        with tracer.start_as_current_span(gen_ai_endpoint, kind= SpanKind.CLIENT) as span:
            response = await wrapped(*args, **kwargs)

            try:
                span.set_attribute(TELEMETRY_SDK_NAME, "openlit")
                span.set_attribute(SemanticConvention.GEN_AI_SYSTEM,
                                    SemanticConvention.GEN_AI_SYSTEM_LANGCHAIN)
                span.set_attribute(SemanticConvention.GEN_AI_ENDPOINT,
                                    gen_ai_endpoint)
                span.set_attribute(DEPLOYMENT_ENVIRONMENT,
                                    environment)
                span.set_attribute(SemanticConvention.GEN_AI_OPERATION,
                                    SemanticConvention.GEN_AI_OPERATION_TYPE_FRAMEWORK)
                span.set_attribute(SERVICE_NAME,
                                    application_name)
                span.set_attribute(SemanticConvention.GEN_AI_HUB_OWNER,
                                    response.metadata["lc_hub_owner"])
                span.set_attribute(SemanticConvention.GEN_AI_HUB_REPO,
                                    response.metadata["lc_hub_repo"])
                span.set_status(Status(StatusCode.OK))

                return response

            except Exception as e:
                handle_exception(span, e)
                logger.error("Error in trace creation: %s", e)

                # Return original response
                return response

    return wrapper

def async_chat(gen_ai_endpoint, version, environment, application_name,
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

    async def wrapper(wrapped, instance, args, kwargs):
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

        server_address, server_port = "NOT_FOUND", "NOT_FOUND"

        if hasattr(instance, "model_id"):
            request_model = instance.model_id
        elif hasattr(instance, "model"):
            request_model = instance.model
        elif hasattr(instance, "model_name"):
            request_model = instance.model_name
        else:
            request_model = "NOT_FOUND"

        span_name = f"{SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT} {request_model}"

        with tracer.start_as_current_span(span_name, kind=SpanKind.CLIENT) as span:
            start_time = time.time()
            response = await wrapped(*args, **kwargs)
            end_time = time.time()

            try:
                # Format 'messages' into a single string
                message_prompt = kwargs.get("messages", "") or args[0]
                formatted_messages = []

                for message in message_prompt:
                    # Handle the case where message is a tuple
                    if isinstance(message, tuple) and len(message) == 2:
                        role, content = message
                    # Handle the case where message is a dictionary
                    elif isinstance(message, dict):
                        role = message["role"]
                        content = message["content"]
                    else:
                        continue

                    # Check if the content is a list
                    if isinstance(content, list):
                        content_str = ", ".join(
                            f'{item["type"]}: {item["text"] if "text" in item else item["image_url"]}'
                            if "type" in item else f'text: {item["text"]}'
                            for item in content
                        )
                        formatted_messages.append(f"{role}: {content_str}")
                    else:
                        formatted_messages.append(f"{role}: {content}")

                # Join all formatted messages with newline
                prompt = "\n".join(formatted_messages)

                input_tokens = general_tokens(str(prompt))
                output_tokens = general_tokens(str(response))

                # Calculate cost of the operation
                cost = get_chat_model_cost(
                    request_model,
                    pricing_info, input_tokens, output_tokens
                )

                try:
                    llm_response = response.content
                except AttributeError:
                    llm_response = response

                # Set base span attribues (OTel Semconv)
                span.set_attribute(TELEMETRY_SDK_NAME, "openlit")
                span.set_attribute(SemanticConvention.GEN_AI_OPERATION,
                                    SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT)
                span.set_attribute(SemanticConvention.GEN_AI_SYSTEM,
                                    SemanticConvention.GEN_AI_SYSTEM_LANGCHAIN)
                span.set_attribute(SemanticConvention.GEN_AI_REQUEST_MODEL,
                                    request_model)
                span.set_attribute(SemanticConvention.GEN_AI_RESPONSE_MODEL,
                                    request_model)
                span.set_attribute(SemanticConvention.GEN_AI_REQUEST_TEMPERATURE,
                                    str(getattr(instance, 'temperature', 1)))
                span.set_attribute(SemanticConvention.GEN_AI_REQUEST_TOP_K,
                                    str(getattr(instance, 'top_k', 1)))
                span.set_attribute(SemanticConvention.GEN_AI_REQUEST_TOP_P,
                                    str(getattr(instance, 'top_p', 1)))
                span.set_attribute(SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS,
                                    input_tokens)
                span.set_attribute(SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS,
                                    output_tokens)
                span.set_attribute(SemanticConvention.SERVER_ADDRESS,
                                    server_address)
                span.set_attribute(SemanticConvention.SERVER_PORT,
                                    server_port)

                # Set base span attribues (Extras)
                span.set_attribute(DEPLOYMENT_ENVIRONMENT,
                                     environment)
                span.set_attribute(SERVICE_NAME,
                                    application_name)
                span.set_attribute(SemanticConvention.GEN_AI_REQUEST_IS_STREAM,
                                    False)
                span.set_attribute(SemanticConvention.GEN_AI_USAGE_TOTAL_TOKENS,
                                    input_tokens + output_tokens)
                span.set_attribute(SemanticConvention.GEN_AI_USAGE_COST,
                                    cost)
                span.set_attribute(SemanticConvention.GEN_AI_SERVER_TTFT,
                                    end_time - start_time)
                span.set_attribute(SemanticConvention.GEN_AI_SDK_VERSION,
                                    version)

                if capture_message_content:
                    span.add_event(
                        name=SemanticConvention.GEN_AI_CONTENT_PROMPT_EVENT,
                        attributes={
                            SemanticConvention.GEN_AI_CONTENT_PROMPT: prompt,
                        },
                    )
                    span.add_event(
                        name=SemanticConvention.GEN_AI_CONTENT_COMPLETION_EVENT,
                        attributes={
                            SemanticConvention.GEN_AI_CONTENT_COMPLETION: llm_response,
                        },
                    )

                span.set_status(Status(StatusCode.OK))

                if disable_metrics is False:
                    attributes = create_metrics_attributes(
                        service_name=application_name,
                        deployment_environment=environment,
                        operation=SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
                        system=SemanticConvention.GEN_AI_SYSTEM_LANGCHAIN,
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
