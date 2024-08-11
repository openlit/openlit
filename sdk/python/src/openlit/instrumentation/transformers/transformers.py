# pylint: disable=duplicate-code, broad-exception-caught, too-many-statements, unused-argument
"""
Module for monitoring ChromaDB.
"""

import logging
from opentelemetry.trace import SpanKind, Status, StatusCode
from opentelemetry.sdk.resources import TELEMETRY_SDK_NAME
from openlit.__helpers import handle_exception, general_tokens
from openlit.semcov import SemanticConvetion

# Initialize logger for logging potential issues and operations
logger = logging.getLogger(__name__)

def text_wrap(gen_ai_endpoint, version, environment, application_name,
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

            # pylint: disable=protected-access
            forward_params = instance._forward_params

            try:
                if args and len(args) > 0:
                    prompt = args[0]
                else:
                    prompt = kwargs.get("args", "")

                prompt_tokens = general_tokens(prompt)

                span.set_attribute(TELEMETRY_SDK_NAME, "openlit")
                span.set_attribute(SemanticConvetion.GEN_AI_ENDPOINT,
                                   gen_ai_endpoint)
                span.set_attribute(SemanticConvetion.GEN_AI_SYSTEM,
                                   SemanticConvetion.GEN_AI_SYSTEM_HUGGING_FACE)
                span.set_attribute(SemanticConvetion.GEN_AI_ENVIRONMENT,
                                   environment)
                span.set_attribute(SemanticConvetion.GEN_AI_APPLICATION_NAME,
                                   application_name)
                span.set_attribute(SemanticConvetion.GEN_AI_TYPE,
                                   SemanticConvetion.GEN_AI_TYPE_CHAT)
                span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_MODEL,
                                   instance.model.config.name_or_path)
                span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_TEMPERATURE,
                                   forward_params.get("temperature", "null"))
                span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_TOP_P,
                                   forward_params.get("top_p", "null"))
                span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_MAX_TOKENS,
                                   forward_params.get("max_length", -1))
                if trace_content:
                    span.add_event(
                        name=SemanticConvetion.GEN_AI_CONTENT_PROMPT_EVENT,
                        attributes={
                            SemanticConvetion.GEN_AI_CONTENT_PROMPT: prompt,
                        },
                    )
                span.set_attribute(SemanticConvetion.GEN_AI_USAGE_PROMPT_TOKENS,
                                prompt_tokens)

                i = 0
                completion_tokens = 0
                for completion in response:
                    if len(response) > 1:
                        attribute_name = f"gen_ai.content.completion.{i}"
                    else:
                        attribute_name = SemanticConvetion.GEN_AI_CONTENT_COMPLETION_EVENT
                    if trace_content:
                        span.add_event(
                            name=attribute_name,
                            attributes={
                                # pylint: disable=line-too-long
                                SemanticConvetion.GEN_AI_CONTENT_COMPLETION: completion["generated_text"],
                            },
                        )
                    completion_tokens += general_tokens(completion["generated_text"])

                    i=i+1
                span.set_attribute(SemanticConvetion.GEN_AI_USAGE_COMPLETION_TOKENS,
                                   completion_tokens)
                span.set_attribute(SemanticConvetion.GEN_AI_USAGE_TOTAL_TOKENS,
                                   prompt_tokens + completion_tokens)
                span.set_status(Status(StatusCode.OK))

                if disable_metrics is False:
                    attributes = {
                        TELEMETRY_SDK_NAME:
                            "openlit",
                        SemanticConvetion.GEN_AI_APPLICATION_NAME:
                            application_name,
                        SemanticConvetion.GEN_AI_SYSTEM:
                            SemanticConvetion.GEN_AI_SYSTEM_HUGGING_FACE,
                        SemanticConvetion.GEN_AI_ENVIRONMENT:
                            environment,
                        SemanticConvetion.GEN_AI_TYPE:
                            SemanticConvetion.GEN_AI_TYPE_CHAT,
                        SemanticConvetion.GEN_AI_REQUEST_MODEL:
                            instance.model.config.name_or_path
                    }

                    metrics["genai_requests"].add(1, attributes)
                    metrics["genai_total_tokens"].add(
                        prompt_tokens +
                        completion_tokens, attributes)
                    metrics["genai_completion_tokens"].add(
                        completion_tokens, attributes)
                    metrics["genai_prompt_tokens"].add(
                        prompt_tokens, attributes)

                # Return original response
                return response

            except Exception as e:
                handle_exception(span, e)
                logger.error("Error in trace creation: %s", e)

                # Return original response
                return response

    return wrapper
