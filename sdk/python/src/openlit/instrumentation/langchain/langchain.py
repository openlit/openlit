# pylint: disable=duplicate-code, broad-exception-caught, too-many-statements, unused-argument, unused-import, too-many-function-args
"""
Module for monitoring Langchain applications.
"""

import logging
from opentelemetry.trace import SpanKind, Status, StatusCode
from opentelemetry.sdk.resources import TELEMETRY_SDK_NAME
from openlit.__helpers import handle_exception, get_chat_model_cost, general_tokens
from openlit.semcov import SemanticConvetion

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

def general_wrap(gen_ai_endpoint, version, environment, application_name,
                 tracer, pricing_info, trace_content, metrics, disable_metrics):
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
    - trace_content (bool): Flag indicating whether to trace the content of the response.

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
        with tracer.start_as_current_span(gen_ai_endpoint, kind= SpanKind.CLIENT) as span:
            response = wrapped(*args, **kwargs)

            try:
                span.set_attribute(TELEMETRY_SDK_NAME, "openlit")
                span.set_attribute(SemanticConvetion.GEN_AI_SYSTEM,
                                    SemanticConvetion.GEN_AI_SYSTEM_LANGCHAIN)
                span.set_attribute(SemanticConvetion.GEN_AI_ENDPOINT,
                                    gen_ai_endpoint)
                span.set_attribute(SemanticConvetion.GEN_AI_ENVIRONMENT,
                                    environment)
                span.set_attribute(SemanticConvetion.GEN_AI_TYPE,
                                    SemanticConvetion.GEN_AI_TYPE_FRAMEWORK)
                span.set_attribute(SemanticConvetion.GEN_AI_APPLICATION_NAME,
                                    application_name)
                span.set_attribute(SemanticConvetion.GEN_AI_RETRIEVAL_SOURCE,
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

def hub(gen_ai_endpoint, version, environment, application_name, tracer,
        pricing_info, trace_content, metrics, disable_metrics):
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
    - trace_content (bool): Indicates if the content of the response should be traced.

    Returns:
    - function: A new function that wraps the original hub operation call with added
                logging, tracing, and metric calculation functionalities.
    """

    def wrapper(wrapped, instance, args, kwargs):
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
            response = wrapped(*args, **kwargs)

            try:
                span.set_attribute(TELEMETRY_SDK_NAME, "openlit")
                span.set_attribute(SemanticConvetion.GEN_AI_SYSTEM,
                                    SemanticConvetion.GEN_AI_SYSTEM_LANGCHAIN)
                span.set_attribute(SemanticConvetion.GEN_AI_ENDPOINT,
                                    gen_ai_endpoint)
                span.set_attribute(SemanticConvetion.GEN_AI_ENVIRONMENT,
                                    environment)
                span.set_attribute(SemanticConvetion.GEN_AI_TYPE,
                                    SemanticConvetion.GEN_AI_TYPE_FRAMEWORK)
                span.set_attribute(SemanticConvetion.GEN_AI_APPLICATION_NAME,
                                    application_name)
                span.set_attribute(SemanticConvetion.GEN_AI_HUB_OWNER,
                                    response.metadata["lc_hub_owner"])
                span.set_attribute(SemanticConvetion.GEN_AI_HUB_REPO,
                                    response.metadata["lc_hub_repo"])
                span.set_status(Status(StatusCode.OK))

                return response

            except Exception as e:
                handle_exception(span, e)
                logger.error("Error in trace creation: %s", e)

                # Return original response
                return response

    return wrapper


def allm(gen_ai_endpoint, version, environment, application_name,
                 tracer, pricing_info, trace_content, metrics, disable_metrics):
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
    - trace_content (bool): Flag indicating whether to trace the content of the response.

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
                if args:
                    prompt = str(args[0]) if args[0] is not None else ""
                else:
                    prompt = ""
                input_tokens = general_tokens(prompt)
                output_tokens = general_tokens(response)

                # Calculate cost of the operation
                cost = get_chat_model_cost(
                    str(get_attribute_from_instance_or_kwargs(instance, 'model')),
                    pricing_info, input_tokens, output_tokens
                )

                span.set_attribute(TELEMETRY_SDK_NAME, "openlit")
                span.set_attribute(SemanticConvetion.GEN_AI_SYSTEM,
                                    SemanticConvetion.GEN_AI_SYSTEM_LANGCHAIN)
                span.set_attribute(SemanticConvetion.GEN_AI_ENDPOINT,
                                    gen_ai_endpoint)
                span.set_attribute(SemanticConvetion.GEN_AI_ENVIRONMENT,
                                    environment)
                span.set_attribute(SemanticConvetion.GEN_AI_TYPE,
                                    SemanticConvetion.GEN_AI_TYPE_FRAMEWORK)
                span.set_attribute(SemanticConvetion.GEN_AI_APPLICATION_NAME,
                                    application_name)
                span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_MODEL,
                                str(get_attribute_from_instance_or_kwargs(instance, 'model')))
                span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_TEMPERATURE,
                                str(get_attribute_from_instance_or_kwargs(instance, 'temperature')))
                span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_TOP_K,
                                str(get_attribute_from_instance_or_kwargs(instance, 'top_k')))
                span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_TOP_P,
                                str(get_attribute_from_instance_or_kwargs(instance, 'top_p')))
                span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_IS_STREAM,
                                    False)
                span.set_attribute(SemanticConvetion.GEN_AI_USAGE_PROMPT_TOKENS,
                                    input_tokens)
                span.set_attribute(SemanticConvetion.GEN_AI_USAGE_COMPLETION_TOKENS,
                                    output_tokens)
                span.set_attribute(SemanticConvetion.GEN_AI_USAGE_TOTAL_TOKENS,
                                    input_tokens + output_tokens)
                span.set_attribute(SemanticConvetion.GEN_AI_USAGE_COST,
                                    cost)
                if trace_content:
                    span.add_event(
                        name=SemanticConvetion.GEN_AI_CONTENT_PROMPT_EVENT,
                        attributes={
                            SemanticConvetion.GEN_AI_CONTENT_PROMPT: prompt,
                        },
                    )
                    span.add_event(
                        name=SemanticConvetion.GEN_AI_CONTENT_COMPLETION_EVENT,
                        attributes={
                            SemanticConvetion.GEN_AI_CONTENT_COMPLETION: response,
                        },
                    )

                span.set_status(Status(StatusCode.OK))

                if disable_metrics is False:
                    attributes = {
                        TELEMETRY_SDK_NAME:
                            "openlit",
                        SemanticConvetion.GEN_AI_APPLICATION_NAME:
                            application_name,
                        SemanticConvetion.GEN_AI_SYSTEM:
                            SemanticConvetion.GEN_AI_SYSTEM_LANGCHAIN,
                        SemanticConvetion.GEN_AI_ENVIRONMENT:
                            environment,
                        SemanticConvetion.GEN_AI_TYPE:
                            SemanticConvetion.GEN_AI_TYPE_CHAT,
                        SemanticConvetion.GEN_AI_REQUEST_MODEL:
                            str(get_attribute_from_instance_or_kwargs(instance, 'model'))
                    }

                    metrics["genai_requests"].add(1, attributes)
                    metrics["genai_total_tokens"].add(
                        input_tokens + output_tokens, attributes
                    )
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

def llm(gen_ai_endpoint, version, environment, application_name,
                 tracer, pricing_info, trace_content, metrics, disable_metrics):
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
    - trace_content (bool): Flag indicating whether to trace the content of the response.

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
        with tracer.start_as_current_span(gen_ai_endpoint, kind= SpanKind.CLIENT) as span:
            response = wrapped(*args, **kwargs)

            try:
                if args:
                    prompt = str(args[0]) if args[0] is not None else ""
                else:
                    prompt = ""
                input_tokens = general_tokens(prompt)
                output_tokens = general_tokens(response)

                # Calculate cost of the operation
                cost = get_chat_model_cost(
                    str(get_attribute_from_instance_or_kwargs(instance, 'model')),
                    pricing_info, input_tokens, output_tokens
                )

                span.set_attribute(TELEMETRY_SDK_NAME, "openlit")
                span.set_attribute(SemanticConvetion.GEN_AI_SYSTEM,
                                    SemanticConvetion.GEN_AI_SYSTEM_LANGCHAIN)
                span.set_attribute(SemanticConvetion.GEN_AI_ENDPOINT,
                                    gen_ai_endpoint)
                span.set_attribute(SemanticConvetion.GEN_AI_ENVIRONMENT,
                                    environment)
                span.set_attribute(SemanticConvetion.GEN_AI_TYPE,
                                    SemanticConvetion.GEN_AI_TYPE_FRAMEWORK)
                span.set_attribute(SemanticConvetion.GEN_AI_APPLICATION_NAME,
                                    application_name)
                span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_MODEL,
                                str(get_attribute_from_instance_or_kwargs(instance, 'model')))
                span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_TEMPERATURE,
                                str(get_attribute_from_instance_or_kwargs(instance, 'temperature')))
                span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_TOP_K,
                                str(get_attribute_from_instance_or_kwargs(instance, 'top_k')))
                span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_TOP_P,
                                str(get_attribute_from_instance_or_kwargs(instance, 'top_p')))
                span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_IS_STREAM,
                                    False)
                span.set_attribute(SemanticConvetion.GEN_AI_USAGE_PROMPT_TOKENS,
                                    input_tokens)
                span.set_attribute(SemanticConvetion.GEN_AI_USAGE_COMPLETION_TOKENS,
                                    output_tokens)
                span.set_attribute(SemanticConvetion.GEN_AI_USAGE_TOTAL_TOKENS,
                                    input_tokens + output_tokens)
                span.set_attribute(SemanticConvetion.GEN_AI_USAGE_COST,
                                    cost)
                if trace_content:
                    span.add_event(
                        name=SemanticConvetion.GEN_AI_CONTENT_PROMPT_EVENT,
                        attributes={
                            SemanticConvetion.GEN_AI_CONTENT_PROMPT: prompt,
                        },
                    )
                    span.add_event(
                        name=SemanticConvetion.GEN_AI_CONTENT_COMPLETION_EVENT,
                        attributes={
                            SemanticConvetion.GEN_AI_CONTENT_COMPLETION: response,
                        },
                    )

                span.set_status(Status(StatusCode.OK))

                if disable_metrics is False:
                    attributes = {
                        TELEMETRY_SDK_NAME:
                            "openlit",
                        SemanticConvetion.GEN_AI_APPLICATION_NAME:
                            application_name,
                        SemanticConvetion.GEN_AI_SYSTEM:
                            SemanticConvetion.GEN_AI_SYSTEM_LANGCHAIN,
                        SemanticConvetion.GEN_AI_ENVIRONMENT:
                            environment,
                        SemanticConvetion.GEN_AI_TYPE:
                            SemanticConvetion.GEN_AI_TYPE_CHAT,
                        SemanticConvetion.GEN_AI_REQUEST_MODEL:
                            str(get_attribute_from_instance_or_kwargs(instance, 'model'))
                    }

                    metrics["genai_requests"].add(1, attributes)
                    metrics["genai_total_tokens"].add(
                        input_tokens + output_tokens, attributes
                    )
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

def chat(gen_ai_endpoint, version, environment, application_name,
                 tracer, pricing_info, trace_content, metrics, disable_metrics):
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
    - trace_content (bool): Flag indicating whether to trace the content of the response.

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
        with tracer.start_as_current_span(gen_ai_endpoint, kind= SpanKind.CLIENT) as span:
            response = wrapped(*args, **kwargs)

            try:
                prompt = ""
                if hasattr(response, 'usage_metadata') and response.usage_metadata:
                    token_usage = response.usage_metadata
                    input_tokens = token_usage.get("input_tokens", 0)
                    output_tokens = token_usage.get("output_tokens", 0)
                    model = instance.model_id
                    prompt = "" if isinstance(args[0], list) else args[0]
                else:
                    if not isinstance(response, dict) or "output_text" not in response:
                        return response
                    # Fallback: Calculate tokens manually if response_metadata is missing
                    model = "gpt-4o-mini"  # Fallback model
                    input_texts = [
                    doc.page_content for doc in response.get("input_documents", [])
                    if isinstance(doc.page_content, str)
                    ]
                    input_tokens = sum(general_tokens(text) for text in input_texts)
                    output_text = response.get("output_text", "")
                    output_tokens = general_tokens(output_text)

                # Calculate cost of the operation
                cost = get_chat_model_cost(
                    model,
                    pricing_info, input_tokens, output_tokens
                )

                span.set_attribute(TELEMETRY_SDK_NAME, "openlit")
                span.set_attribute(SemanticConvetion.GEN_AI_SYSTEM,
                                    SemanticConvetion.GEN_AI_SYSTEM_LANGCHAIN)
                span.set_attribute(SemanticConvetion.GEN_AI_ENDPOINT,
                                    gen_ai_endpoint)
                span.set_attribute(SemanticConvetion.GEN_AI_ENVIRONMENT,
                                    environment)
                span.set_attribute(SemanticConvetion.GEN_AI_TYPE,
                                    SemanticConvetion.GEN_AI_TYPE_CHAT)
                span.set_attribute(SemanticConvetion.GEN_AI_APPLICATION_NAME,
                                    application_name)
                span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_MODEL,
                                    model)
                span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_TEMPERATURE,
                                    str(getattr(instance, 'temperature', 1)))
                span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_TOP_K,
                                    str(getattr(instance, 'top_k', 1)))
                span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_TOP_P,
                                    str(getattr(instance, 'top_p', 1)))
                span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_IS_STREAM,
                                    False)
                span.set_attribute(SemanticConvetion.GEN_AI_USAGE_PROMPT_TOKENS,
                                    input_tokens)
                span.set_attribute(SemanticConvetion.GEN_AI_USAGE_COMPLETION_TOKENS,
                                    output_tokens)
                span.set_attribute(SemanticConvetion.GEN_AI_USAGE_TOTAL_TOKENS,
                                    input_tokens + output_tokens)
                span.set_attribute(SemanticConvetion.GEN_AI_USAGE_COST,
                                    cost)
                if trace_content:
                    span.add_event(
                        name=SemanticConvetion.GEN_AI_CONTENT_PROMPT_EVENT,
                        attributes={
                            SemanticConvetion.GEN_AI_CONTENT_PROMPT: prompt,
                        },
                    )
                    completion_content = getattr(response, 'content', "")
                    span.add_event(
                        name=SemanticConvetion.GEN_AI_CONTENT_COMPLETION_EVENT,
                        attributes={
                            SemanticConvetion.GEN_AI_CONTENT_COMPLETION: completion_content,
                        },
                    )

                span.set_status(Status(StatusCode.OK))

                if disable_metrics is False:
                    attributes = {
                        TELEMETRY_SDK_NAME:
                            "openlit",
                        SemanticConvetion.GEN_AI_APPLICATION_NAME:
                            application_name,
                        SemanticConvetion.GEN_AI_SYSTEM:
                            SemanticConvetion.GEN_AI_SYSTEM_LANGCHAIN,
                        SemanticConvetion.GEN_AI_ENVIRONMENT:
                            environment,
                        SemanticConvetion.GEN_AI_TYPE:
                            SemanticConvetion.GEN_AI_TYPE_CHAT,
                        SemanticConvetion.GEN_AI_REQUEST_MODEL:
                            model
                    }

                    metrics["genai_requests"].add(1, attributes)
                    metrics["genai_total_tokens"].add(
                        input_tokens + output_tokens, attributes
                    )
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

def achat(gen_ai_endpoint, version, environment, application_name,
                 tracer, pricing_info, trace_content, metrics, disable_metrics):
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
    - trace_content (bool): Flag indicating whether to trace the content of the response.

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
                prompt = ""
                if hasattr(response, 'usage_metadata') and response.usage_metadata:
                    token_usage = response.usage_metadata
                    input_tokens = token_usage.get("input_tokens", 0)
                    output_tokens = token_usage.get("output_tokens", 0)
                    model = instance.model_id
                    prompt = "" if isinstance(args[0], list) else args[0]

                else:
                    if not isinstance(response, dict) or "output_text" not in response:
                        return response
                    # Fallback: Calculate tokens manually if response_metadata is missing
                    model = "gpt-4o-mini"  # Fallback model
                    input_texts = [
                    doc.page_content for doc in response.get("input_documents", [])
                    if isinstance(doc.page_content, str)
                    ]
                    input_tokens = sum(general_tokens(text) for text in input_texts)
                    output_text = response.get("output_text", "")
                    output_tokens = general_tokens(output_text)

                # Calculate cost of the operation
                cost = get_chat_model_cost(
                    model,
                    pricing_info, input_tokens, output_tokens
                )

                span.set_attribute(TELEMETRY_SDK_NAME, "openlit")
                span.set_attribute(SemanticConvetion.GEN_AI_SYSTEM,
                                    SemanticConvetion.GEN_AI_SYSTEM_LANGCHAIN)
                span.set_attribute(SemanticConvetion.GEN_AI_ENDPOINT,
                                    gen_ai_endpoint)
                span.set_attribute(SemanticConvetion.GEN_AI_ENVIRONMENT,
                                    environment)
                span.set_attribute(SemanticConvetion.GEN_AI_TYPE,
                                    SemanticConvetion.GEN_AI_TYPE_CHAT)
                span.set_attribute(SemanticConvetion.GEN_AI_APPLICATION_NAME,
                                    application_name)
                span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_MODEL,
                                    model)
                span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_TEMPERATURE,
                                    str(getattr(instance, 'temperature',1)))
                span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_TOP_K,
                                    str(getattr(instance, 'top_k',1)))
                span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_TOP_P,
                                    str(getattr(instance, 'top_p',1)))
                span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_IS_STREAM,
                                    False)
                span.set_attribute(SemanticConvetion.GEN_AI_USAGE_PROMPT_TOKENS,
                                    input_tokens)
                span.set_attribute(SemanticConvetion.GEN_AI_USAGE_COMPLETION_TOKENS,
                                    output_tokens)
                span.set_attribute(SemanticConvetion.GEN_AI_USAGE_TOTAL_TOKENS,
                                    input_tokens + output_tokens)
                span.set_attribute(SemanticConvetion.GEN_AI_USAGE_COST,
                                    cost)
                if trace_content:
                    span.add_event(
                        name=SemanticConvetion.GEN_AI_CONTENT_PROMPT_EVENT,
                        attributes={
                            SemanticConvetion.GEN_AI_CONTENT_PROMPT: prompt,
                        },
                    )
                    span.add_event(
                        name=SemanticConvetion.GEN_AI_CONTENT_COMPLETION_EVENT,
                        attributes={
                            SemanticConvetion.GEN_AI_CONTENT_COMPLETION: response.content,
                        },
                    )

                span.set_status(Status(StatusCode.OK))

                if disable_metrics is False:
                    attributes = {
                        TELEMETRY_SDK_NAME:
                            "openlit",
                        SemanticConvetion.GEN_AI_APPLICATION_NAME:
                            application_name,
                        SemanticConvetion.GEN_AI_SYSTEM:
                            SemanticConvetion.GEN_AI_SYSTEM_LANGCHAIN,
                        SemanticConvetion.GEN_AI_ENVIRONMENT:
                            environment,
                        SemanticConvetion.GEN_AI_TYPE:
                            SemanticConvetion.GEN_AI_TYPE_CHAT,
                        SemanticConvetion.GEN_AI_REQUEST_MODEL:
                            model
                    }

                    metrics["genai_requests"].add(1, attributes)
                    metrics["genai_total_tokens"].add(
                        input_tokens + output_tokens, attributes
                    )
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
