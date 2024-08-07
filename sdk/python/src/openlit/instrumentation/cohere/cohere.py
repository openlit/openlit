# pylint: disable=duplicate-code, broad-exception-caught, too-many-statements, unused-argument, possibly-used-before-assignment
"""
Module for monitoring Cohere API calls.
"""

import logging
from opentelemetry.trace import SpanKind, Status, StatusCode
from opentelemetry.sdk.resources import TELEMETRY_SDK_NAME
from openlit.__helpers import get_chat_model_cost, get_embed_model_cost, handle_exception
from openlit.semcov import SemanticConvetion

# Initialize logger for logging potential issues and operations
logger = logging.getLogger(__name__)

def embed(gen_ai_endpoint, version, environment, application_name, tracer,
          pricing_info, trace_content, metrics, disable_metrics):
    """
    Generates a telemetry wrapper for embeddings to collect metrics.
    
    Args:
        gen_ai_endpoint: Endpoint identifier for logging and tracing.
        version: Version of the monitoring package.
        environment: Deployment environment (e.g., production, staging).
        application_name: Name of the application using the OpenAI API.
        tracer: OpenTelemetry tracer for creating spans.
        pricing_info: Information used for calculating the cost of OpenAI usage.
        trace_content: Flag indicating whether to trace the actual content.
    
    Returns:
        A function that wraps the embeddings method to add telemetry.
    """

    def wrapper(wrapped, instance, args, kwargs):
        """
        Wraps the 'embed' API call to add telemetry.

        This collects metrics such as execution time, cost, and token usage, and handles errors
        gracefully, adding details to the trace for observability.

        Args:
            wrapped: The original 'embed' method to be wrapped.
            instance: The instance of the class where the original method is defined.
            args: Positional arguments for the 'embed' method.
            kwargs: Keyword arguments for the 'embed' method.

        Returns:
            The response from the original 'embed' method.
        """

        with tracer.start_as_current_span(gen_ai_endpoint, kind= SpanKind.CLIENT) as span:
            response = wrapped(*args, **kwargs)

            try:
                # Get prompt from kwargs and store as a single string
                prompt = " ".join(kwargs.get("texts", []))


                # Calculate cost of the operation
                cost = get_embed_model_cost(kwargs.get("model", "embed-english-v2.0"),
                                            pricing_info,
                                            response.meta.billed_units.input_tokens)

                # Set Span attributes
                span.set_attribute(TELEMETRY_SDK_NAME, "openlit")
                span.set_attribute(SemanticConvetion.GEN_AI_SYSTEM,
                                    SemanticConvetion.GEN_AI_SYSTEM_COHERE)
                span.set_attribute(SemanticConvetion.GEN_AI_TYPE,
                                    SemanticConvetion.GEN_AI_TYPE_EMBEDDING)
                span.set_attribute(SemanticConvetion.GEN_AI_ENDPOINT,
                                    gen_ai_endpoint)
                span.set_attribute(SemanticConvetion.GEN_AI_ENVIRONMENT,
                                    environment)
                span.set_attribute(SemanticConvetion.GEN_AI_APPLICATION_NAME,
                                    application_name)
                span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_MODEL,
                                    kwargs.get("model", "embed-english-v2.0"))
                span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_EMBEDDING_FORMAT,
                                    kwargs.get("embedding_types", "float"))
                span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_EMBEDDING_DIMENSION,
                                    kwargs.get("input_type", ""))
                span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_USER,
                                    kwargs.get("user", ""))
                span.set_attribute(SemanticConvetion.GEN_AI_RESPONSE_ID,
                                    response.id)
                span.set_attribute(SemanticConvetion.GEN_AI_USAGE_PROMPT_TOKENS,
                                    response.meta.billed_units.input_tokens)
                span.set_attribute(SemanticConvetion.GEN_AI_USAGE_TOTAL_TOKENS,
                                    response.meta.billed_units.input_tokens)
                span.set_attribute(SemanticConvetion.GEN_AI_USAGE_COST,
                                    cost)
                if trace_content:
                    span.add_event(
                        name=SemanticConvetion.GEN_AI_CONTENT_PROMPT_EVENT,
                        attributes={
                            SemanticConvetion.GEN_AI_CONTENT_PROMPT: prompt,
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
                            SemanticConvetion.GEN_AI_SYSTEM_COHERE,
                        SemanticConvetion.GEN_AI_ENVIRONMENT:
                            environment,
                        SemanticConvetion.GEN_AI_TYPE:
                            SemanticConvetion.GEN_AI_TYPE_EMBEDDING,
                        SemanticConvetion.GEN_AI_REQUEST_MODEL:
                            kwargs.get("model", "embed-english-v2.0")
                    }

                    metrics["genai_requests"].add(1, attributes)
                    metrics["genai_total_tokens"].add(
                        response.meta.billed_units.input_tokens, attributes
                    )
                    metrics["genai_prompt_tokens"].add(
                        response.meta.billed_units.input_tokens, attributes
                    )
                    metrics["genai_cost"].record(cost, attributes)

                # Return original response
                return response

            except Exception as e:
                handle_exception(span, e)
                logger.error("Error in trace creation: %s", e)

                # Return original response
                return response

    return wrapper

def chat(gen_ai_endpoint, version, environment, application_name, tracer,
         pricing_info, trace_content, metrics, disable_metrics):
    """
    Generates a telemetry wrapper for chat to collect metrics.

    Args:
        gen_ai_endpoint: Endpoint identifier for logging and tracing.
        version: Version of the monitoring package.
        environment: Deployment environment (e.g., production, staging).
        application_name: Name of the application using the OpenAI API.
        tracer: OpenTelemetry tracer for creating spans.
        pricing_info: Information used for calculating the cost of OpenAI usage.
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

        with tracer.start_as_current_span(gen_ai_endpoint, kind=SpanKind.CLIENT) as span:
            response = wrapped(*args, **kwargs)

            try:
                # Calculate cost of the operation
                cost = get_chat_model_cost(kwargs.get("model", "command"),
                                            pricing_info,
                                            response.meta.billed_units.input_tokens,
                                            response.meta.billed_units.output_tokens)

                # Set Span attributes
                span.set_attribute(TELEMETRY_SDK_NAME, "openlit")
                span.set_attribute(SemanticConvetion.GEN_AI_SYSTEM,
                                    SemanticConvetion.GEN_AI_SYSTEM_COHERE)
                span.set_attribute(SemanticConvetion.GEN_AI_TYPE,
                                    SemanticConvetion.GEN_AI_TYPE_CHAT)
                span.set_attribute(SemanticConvetion.GEN_AI_ENDPOINT,
                                    gen_ai_endpoint)
                span.set_attribute(SemanticConvetion.GEN_AI_ENVIRONMENT,
                                    environment)
                span.set_attribute(SemanticConvetion.GEN_AI_APPLICATION_NAME,
                                    application_name)
                span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_MODEL,
                                    kwargs.get("model", "command"))
                span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_TEMPERATURE,
                                    kwargs.get("temperature", 0.3))
                span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_MAX_TOKENS,
                                    kwargs.get("max_tokens", -1))
                span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_SEED,
                                    kwargs.get("seed", ""))
                span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_FREQUENCY_PENALTY,
                                    kwargs.get("frequency_penalty", 0.0))
                span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_PRESENCE_PENALTY,
                                    kwargs.get("presence_penalty", 0.0))
                span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_IS_STREAM,
                                    False)
                span.set_attribute(SemanticConvetion.GEN_AI_RESPONSE_ID,
                                    response.generation_id)
                span.set_attribute(SemanticConvetion.GEN_AI_RESPONSE_FINISH_REASON,
                                    [response.finish_reason])
                span.set_attribute(SemanticConvetion.GEN_AI_USAGE_PROMPT_TOKENS,
                                    response.meta.billed_units.input_tokens)
                span.set_attribute(SemanticConvetion.GEN_AI_USAGE_COMPLETION_TOKENS,
                                    response.meta.billed_units.output_tokens)
                span.set_attribute(SemanticConvetion.GEN_AI_USAGE_TOTAL_TOKENS,
                                    response.meta.billed_units.input_tokens +
                                    response.meta.billed_units.output_tokens)
                span.set_attribute(SemanticConvetion.GEN_AI_USAGE_COST,
                                    cost)

                if trace_content:
                    span.add_event(
                        name=SemanticConvetion.GEN_AI_CONTENT_PROMPT_EVENT,
                        attributes={
                            SemanticConvetion.GEN_AI_CONTENT_PROMPT: kwargs.get("message", ""),
                        },
                    )
                    span.add_event(
                        name=SemanticConvetion.GEN_AI_CONTENT_COMPLETION_EVENT,
                        attributes={
                            SemanticConvetion.GEN_AI_CONTENT_COMPLETION: response.text,
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
                            SemanticConvetion.GEN_AI_SYSTEM_COHERE,
                        SemanticConvetion.GEN_AI_ENVIRONMENT:
                            environment,
                        SemanticConvetion.GEN_AI_TYPE:
                            SemanticConvetion.GEN_AI_TYPE_CHAT,
                        SemanticConvetion.GEN_AI_REQUEST_MODEL:
                            kwargs.get("model", "command")
                    }

                    metrics["genai_requests"].add(1, attributes)
                    metrics["genai_total_tokens"].add(
                        response.meta.billed_units.input_tokens +
                        response.meta.billed_units.output_tokens, attributes)
                    metrics["genai_completion_tokens"].add(
                        response.meta.billed_units.output_tokens, attributes)
                    metrics["genai_prompt_tokens"].add(
                        response.meta.billed_units.input_tokens, attributes)
                    metrics["genai_cost"].record(cost, attributes)

                # Return original response
                return response

            except Exception as e:
                handle_exception(span, e)
                logger.error("Error in trace creation: %s", e)

                # Return original response
                return response

    return wrapper

def chat_stream(gen_ai_endpoint, version, environment, application_name,
                tracer, pricing_info, trace_content, metrics, disable_metrics):
    """
    Generates a telemetry wrapper for chat_stream to collect metrics.

    Args:
        gen_ai_endpoint: Endpoint identifier for logging and tracing.
        version: Version of the monitoring package.
        environment: Deployment environment (e.g., production, staging).
        application_name: Name of the application using the OpenAI API.
        tracer: OpenTelemetry tracer for creating spans.
        pricing_info: Information used for calculating the cost of OpenAI usage.
        trace_content: Flag indicating whether to trace the actual content.

    Returns:
        A function that wraps the chat method to add telemetry.
    """

    def wrapper(wrapped, instance, args, kwargs):
        """
        Wraps the 'chat_stream' API call to add telemetry.
        
        This collects metrics such as execution time, cost, and token usage, and handles errors
        gracefully, adding details to the trace for observability.

        Args:
            wrapped: The original 'chat_stream' method to be wrapped.
            instance: The instance of the class where the original method is defined.
            args: Positional arguments for the 'chat_stream' method.
            kwargs: Keyword arguments for the 'chat_stream' method.

        Returns:
            The response from the original 'chat_stream' method.
        """

        def stream_generator():
            with tracer.start_as_current_span(gen_ai_endpoint, kind= SpanKind.CLIENT) as span:
                # Placeholder for aggregating streaming response
                llmresponse = ""

                # Loop through streaming events capturing relevant details
                for event in wrapped(*args, **kwargs):
                    # Collect message IDs and aggregated response from events
                    if event.event_type == "stream-end":
                        llmresponse = event.response.text
                        prompt_tokens = event.response.meta.billed_units.input_tokens
                        completion_tokens = event.response.meta.billed_units.output_tokens
                        finish_reason = event.finish_reason
                    if event.event_type == "stream-start":
                        response_id = event.generation_id
                    yield event

                # Handling exception ensure observability without disrupting operation
                try:
                    # Calculate cost of the operation
                    cost = get_chat_model_cost(kwargs.get("model", "command"),
                                                pricing_info, prompt_tokens, completion_tokens)

                    # Set Span attributes
                    span.set_attribute(TELEMETRY_SDK_NAME, "openlit")
                    span.set_attribute(SemanticConvetion.GEN_AI_SYSTEM,
                                        SemanticConvetion.GEN_AI_SYSTEM_COHERE)
                    span.set_attribute(SemanticConvetion.GEN_AI_TYPE,
                                        SemanticConvetion.GEN_AI_TYPE_CHAT)
                    span.set_attribute(SemanticConvetion.GEN_AI_ENDPOINT,
                                        gen_ai_endpoint)
                    span.set_attribute(SemanticConvetion.GEN_AI_ENVIRONMENT,
                                        environment)
                    span.set_attribute(SemanticConvetion.GEN_AI_APPLICATION_NAME,
                                        application_name)
                    span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_MODEL,
                                        kwargs.get("model", "command"))
                    span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_TEMPERATURE,
                                        kwargs.get("temperature", 0.3))
                    span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_MAX_TOKENS,
                                        kwargs.get("max_tokens", -1))
                    span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_SEED,
                                        kwargs.get("seed", ""))
                    span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_FREQUENCY_PENALTY,
                                        kwargs.get("frequency_penalty", 0.0))
                    span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_PRESENCE_PENALTY,
                                        kwargs.get("presence_penalty", 0.0))
                    span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_IS_STREAM,
                                        True)
                    span.set_attribute(SemanticConvetion.GEN_AI_RESPONSE_ID,
                                        response_id)
                    span.set_attribute(SemanticConvetion.GEN_AI_RESPONSE_FINISH_REASON,
                                        [finish_reason])
                    span.set_attribute(SemanticConvetion.GEN_AI_USAGE_PROMPT_TOKENS,
                                        prompt_tokens)
                    span.set_attribute(SemanticConvetion.GEN_AI_USAGE_COMPLETION_TOKENS,
                                        completion_tokens)
                    span.set_attribute(SemanticConvetion.GEN_AI_USAGE_TOTAL_TOKENS,
                                        prompt_tokens + completion_tokens)
                    span.set_attribute(SemanticConvetion.GEN_AI_USAGE_COST,
                                        cost)
                    if trace_content:
                        span.add_event(
                            name=SemanticConvetion.GEN_AI_CONTENT_PROMPT_EVENT,
                            attributes={
                                SemanticConvetion.GEN_AI_CONTENT_PROMPT: kwargs.get("message", ""),
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
                                SemanticConvetion.GEN_AI_SYSTEM_COHERE,
                            SemanticConvetion.GEN_AI_ENVIRONMENT:
                                environment,
                            SemanticConvetion.GEN_AI_TYPE:
                                SemanticConvetion.GEN_AI_TYPE_CHAT,
                            SemanticConvetion.GEN_AI_REQUEST_MODEL:
                                kwargs.get("model", "command")
                        }

                        metrics["genai_requests"].add(1, attributes)
                        metrics["genai_total_tokens"].add(
                            prompt_tokens + completion_tokens, attributes
                        )
                        metrics["genai_completion_tokens"].add(completion_tokens, attributes)
                        metrics["genai_prompt_tokens"].add(prompt_tokens, attributes)
                        metrics["genai_cost"].record(cost, attributes)

                except Exception as e:
                    handle_exception(span, e)
                    logger.error("Error in trace creation: %s", e)

        return stream_generator()

    return wrapper
