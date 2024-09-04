# pylint: disable=duplicate-code, broad-exception-caught, too-many-statements, unused-argument, possibly-used-before-assignment, protected-access
"""
Module for monitoring Google AI Studio API calls.
"""

import logging
from opentelemetry.trace import SpanKind, Status, StatusCode
from opentelemetry.sdk.resources import TELEMETRY_SDK_NAME
from openlit.__helpers import (
    handle_exception,
    get_chat_model_cost,
)
from openlit.semcov import SemanticConvetion

# Initialize logger for logging potential issues and operations
logger = logging.getLogger(__name__)

def generate(gen_ai_endpoint, version, environment, application_name,
                     tracer, pricing_info, trace_content, metrics, disable_metrics):
    """
    Generates a telemetry wrapper for chat to collect metrics.

    Args:
        gen_ai_endpoint: Endpoint identifier for logging and tracing.
        version: Version of the monitoring package.
        environment: Deployment environment (e.g., production, staging).
        application_name: Name of the application using the Google AI Studio API.
        tracer: OpenTelemetry tracer for creating spans.
        pricing_info: Information used for calculating the cost of Google AI Studio usage.
        trace_content: Flag indicating whether to trace the actual content.

    Returns:
        A function that wraps the chat method to add telemetry.
    """

    def wrapper(wrapped, instance, args, kwargs):
        """
        Wraps the 'chat' API call to add telemetry.
        
        This collects metrics such as execution time, cost, and token usage, and handles errors
        gracefully, adding details to the trace for observability.

        Args:
            wrapped: The original 'chat' method to be wrapped.
            instance: The instance of the class where the original method is defined.
            args: Positional arguments for the 'chat' method.
            kwargs: Keyword arguments for the 'chat' method.

        Returns:
            The response from the original 'chat' method.
        """
        # pylint: disable=no-else-return
        if kwargs.get("stream", False) is True:
            # Special handling for streaming response to accommodate the nature of data flow
            def stream_generator():
                with tracer.start_as_current_span(gen_ai_endpoint, kind= SpanKind.CLIENT) as span:
                    # Placeholder for aggregating streaming response
                    llmresponse = ""

                    # Loop through streaming events capturing relevant details
                    for chunk in wrapped(*args, **kwargs):
                        # Collect message IDs and aggregated response from events
                        content = chunk.text
                        if content:
                            llmresponse += content

                        input_tokens = chunk.usage_metadata.prompt_token_count
                        output_tokens = chunk.usage_metadata.candidates_token_count
                        yield chunk

                    # Handling exception ensure observability without disrupting operation
                    try:
                        prompt = ""
                        for arg in args:
                            if isinstance(arg, str):
                                prompt = f"{prompt}{arg}\n"
                            elif isinstance(arg, list):
                                for subarg in arg:
                                    prompt = f"{prompt}{subarg}\n"
                        if hasattr(instance, "_model_id"):
                            model = instance._model_id
                        if hasattr(instance, "_model_name"):
                            model = instance._model_name.replace("publishers/google/models/", "")
                        if model.startswith("models/"):
                            model = model[len("models/"):]

                        total_tokens = input_tokens + output_tokens
                        # Calculate cost of the operation
                        cost = get_chat_model_cost(model,
                                                    pricing_info, input_tokens,
                                                    output_tokens)

                        # Set Span attributes
                        span.set_attribute(TELEMETRY_SDK_NAME, "openlit")
                        span.set_attribute(SemanticConvetion.GEN_AI_SYSTEM,
                                            SemanticConvetion.GEN_AI_SYSTEM_GOOGLE_AI_STUDIO)
                        span.set_attribute(SemanticConvetion.GEN_AI_TYPE,
                                            SemanticConvetion.GEN_AI_TYPE_CHAT)
                        span.set_attribute(SemanticConvetion.GEN_AI_ENDPOINT,
                                            gen_ai_endpoint)
                        span.set_attribute(SemanticConvetion.GEN_AI_ENVIRONMENT,
                                            environment)
                        span.set_attribute(SemanticConvetion.GEN_AI_APPLICATION_NAME,
                                            application_name)
                        span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_MODEL,
                                            model)
                        span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_IS_STREAM,
                                            True)
                        span.set_attribute(SemanticConvetion.GEN_AI_USAGE_PROMPT_TOKENS,
                                            input_tokens)
                        span.set_attribute(SemanticConvetion.GEN_AI_USAGE_COMPLETION_TOKENS,
                                            output_tokens)
                        span.set_attribute(SemanticConvetion.GEN_AI_USAGE_TOTAL_TOKENS,
                                            total_tokens)
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
                                    SemanticConvetion.GEN_AI_CONTENT_COMPLETION: llmresponse,
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
                                    SemanticConvetion.GEN_AI_SYSTEM_GOOGLE_AI_STUDIO,
                                SemanticConvetion.GEN_AI_ENVIRONMENT:
                                    environment,
                                SemanticConvetion.GEN_AI_TYPE:
                                    SemanticConvetion.GEN_AI_TYPE_CHAT,
                                SemanticConvetion.GEN_AI_REQUEST_MODEL:
                                    model
                            }

                            metrics["genai_requests"].add(1, attributes)
                            metrics["genai_total_tokens"].add(
                                total_tokens, attributes
                            )
                            metrics["genai_completion_tokens"].add(output_tokens, attributes)
                            metrics["genai_prompt_tokens"].add(input_tokens, attributes)
                            metrics["genai_cost"].record(cost, attributes)

                    except Exception as e:
                        handle_exception(span, e)
                        logger.error("Error in trace creation: %s", e)

            return stream_generator()
        else:
            # pylint: disable=line-too-long
            with tracer.start_as_current_span(gen_ai_endpoint, kind= SpanKind.CLIENT) as span:
                response = wrapped(*args, **kwargs)

                # print(instance._system_instruction.__dict__["_pb"].parts[0].text)
                try:
                    prompt = ""
                    for arg in args:
                        if isinstance(arg, str):
                            prompt = f"{prompt}{arg}\n"
                        elif isinstance(arg, list):
                            for subarg in arg:
                                prompt = f"{prompt}{subarg}\n"

                    if hasattr(instance, "_model_id"):
                        model = instance._model_id
                    if hasattr(instance, "_model_name"):
                        model = instance._model_name.replace("publishers/google/models/", "")
                    if model.startswith("models/"):
                        model = model[len("models/"):]

                    # Set base span attribues
                    span.set_attribute(TELEMETRY_SDK_NAME, "openlit")
                    span.set_attribute(SemanticConvetion.GEN_AI_SYSTEM,
                                        SemanticConvetion.GEN_AI_SYSTEM_GOOGLE_AI_STUDIO)
                    span.set_attribute(SemanticConvetion.GEN_AI_TYPE,
                                        SemanticConvetion.GEN_AI_TYPE_CHAT)
                    span.set_attribute(SemanticConvetion.GEN_AI_ENDPOINT,
                                        gen_ai_endpoint)
                    span.set_attribute(SemanticConvetion.GEN_AI_ENVIRONMENT,
                                        environment)
                    span.set_attribute(SemanticConvetion.GEN_AI_APPLICATION_NAME,
                                        application_name)
                    span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_MODEL,
                                        model)
                    span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_IS_STREAM,
                                        False)

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
                                SemanticConvetion.GEN_AI_CONTENT_COMPLETION: response.text,
                            },
                        )

                    prompt_tokens = response.usage_metadata.prompt_token_count
                    completion_tokens = response.usage_metadata.candidates_token_count
                    total_tokens = response.usage_metadata.total_token_count
                    # Calculate cost of the operation
                    cost = get_chat_model_cost(model,
                                                pricing_info, prompt_tokens, completion_tokens)

                    span.set_attribute(SemanticConvetion.GEN_AI_USAGE_PROMPT_TOKENS,
                                        prompt_tokens)
                    span.set_attribute(SemanticConvetion.GEN_AI_USAGE_COMPLETION_TOKENS,
                                        completion_tokens)
                    span.set_attribute(SemanticConvetion.GEN_AI_USAGE_TOTAL_TOKENS,
                                        total_tokens)
                    span.set_attribute(SemanticConvetion.GEN_AI_USAGE_COST,
                                        cost)

                    span.set_status(Status(StatusCode.OK))

                    if disable_metrics is False:
                        attributes = {
                            TELEMETRY_SDK_NAME:
                                "openlit",
                            SemanticConvetion.GEN_AI_APPLICATION_NAME:
                                application_name,
                            SemanticConvetion.GEN_AI_SYSTEM:
                                SemanticConvetion.GEN_AI_SYSTEM_GOOGLE_AI_STUDIO,
                            SemanticConvetion.GEN_AI_ENVIRONMENT:
                                environment,
                            SemanticConvetion.GEN_AI_TYPE:
                                SemanticConvetion.GEN_AI_TYPE_CHAT,
                            SemanticConvetion.GEN_AI_REQUEST_MODEL:
                                model
                        }

                        metrics["genai_requests"].add(1, attributes)
                        metrics["genai_total_tokens"].add(total_tokens, attributes)
                        metrics["genai_completion_tokens"].add(completion_tokens, attributes)
                        metrics["genai_prompt_tokens"].add(prompt_tokens, attributes)
                        metrics["genai_cost"].record(cost, attributes)

                    # Return original response
                    return response

                except Exception as e:
                    handle_exception(span, e)
                    logger.error("Error in trace creation: %s", e)

                    # Return original response
                    return response

    return wrapper
