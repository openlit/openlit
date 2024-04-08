# pylint: disable=duplicate-code, line-too-long, broad-exception-caught
"""
Module for monitoring Cohere API calls.
"""

import time
import logging
from opentelemetry.trace import SpanKind
from ..__helpers import get_chat_model_cost, get_embed_model_cost, handle_exception

# Initialize logger for logging potential issues and operations
logger = logging.getLogger(__name__)

def embed(gen_ai_endpoint, version, environment, application_name, tracer, pricing_info, trace_content):
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

        # Sections handling exceptions ensure observability without disrupting operations
        try:
            start_time = time.time()
            response = wrapped(*args, **kwargs)
            end_time = time.time()

            try:
                with tracer.start_as_current_span(gen_ai_endpoint, kind= SpanKind.CLIENT) as span:
                    # Calculate total duration of operation
                    duration = end_time - start_time

                    # Get prompt from kwargs and store as a single string
                    # prompt = " ".join(kwargs.get("texts", []))


                    # Calculate cost of the operation
                    cost = get_embed_model_cost(kwargs.get("model", "embed-english-v2.0"), pricing_info, response.meta.billed_units.input_tokens)

                    # Set Span attributes
                    span.set_attribute("gen_ai.system", "cohere")
                    span.set_attribute("gen_ai.type", "embedding")
                    span.set_attribute("gen_ai.endpoint", gen_ai_endpoint)
                    span.set_attribute("gen_ai.environment", environment)
                    span.set_attribute("gen_ai.application_name", application_name)
                    span.set_attribute("gen_ai.request_duration", duration)
                    span.set_attribute("gen_ai.request.model", kwargs.get("model", "embed-english-v2.0"),)
                    span.set_attribute("gen_ai.request.embedding_format", kwargs.get("embedding_types", "float"))
                    span.set_attribute("gen_ai.request.embedding_dimension", kwargs.get("input_type", ""))
                    span.set_attribute("gen_ai.request.user", kwargs.get("user", ""))
                    span.set_attribute("gen_ai.response.id", response.id)
                    span.set_attribute("gen_ai.usage.prompt_tokens", response.meta.billed_units.input_tokens)
                    span.set_attribute("gen_ai.usage.total_tokens", response.meta.billed_units.input_tokens)
                    span.set_attribute("gen_ai.usage.cost", cost)
                    # if trace_content:
                    #     span.set_attribute("gen_ai.content.prompt", prompt)

                # Return original response
                return response

            except Exception as e:
                handle_exception(tracer, e, gen_ai_endpoint)
                logger.error("Error in patched message creation: %s", e)

                # Return original response
                return response

        except Exception as e:
            handle_exception(tracer, e, gen_ai_endpoint)
            raise e

    return wrapper

def chat(gen_ai_endpoint, version, environment, application_name, tracer, pricing_info, trace_content):
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

        # Sections handling exceptions ensure observability without disrupting operations
        try:
            start_time = time.time()
            response = wrapped(*args, **kwargs)
            end_time = time.time()

            try:
                with tracer.start_as_current_span(gen_ai_endpoint, kind=SpanKind.CLIENT) as span:
                    # Calculate total duration of operation
                    duration = end_time - start_time

                    # Calculate cost of the operation
                    cost = get_chat_model_cost(kwargs.get("model", "command"), pricing_info, response.meta["billed_units"]["input_tokens"], response.meta["billed_units"]["output_tokens"])

                    # Set Span attributes
                    span.set_attribute("gen_ai.system", "cohere")
                    span.set_attribute("gen_ai.type", "chat")
                    span.set_attribute("gen_ai.endpoint", gen_ai_endpoint)
                    span.set_attribute("gen_ai.environment", environment)
                    span.set_attribute("gen_ai.application_name", application_name)
                    span.set_attribute("gen_ai.request_duration", duration)
                    span.set_attribute("gen_ai.request.model", kwargs.get("model", "command"))
                    span.set_attribute("gen_ai.request.temperature", kwargs.get("temperature", 0.3))
                    span.set_attribute("gen_ai.request.max_tokens", kwargs.get("max_tokens", ""))
                    span.set_attribute("gen_ai.request.seed", kwargs.get("seed", ""))
                    span.set_attribute("gen_ai.request.frequency_penalty", kwargs.get("frequency_penalty", 0.0))
                    span.set_attribute("gen_ai.request.presence_penalty", kwargs.get("presence_penalty", 0.0))
                    span.set_attribute("gen_ai.request.is_stream", False)
                    span.set_attribute("gen_ai.response.id", response.response_id)
                    span.set_attribute("gen_ai.response.finish_reason", response.response_id)
                    span.set_attribute("gen_ai.usage.prompt_tokens", response.meta["billed_units"]["input_tokens"])
                    span.set_attribute("gen_ai.usage.completion_tokens", response.meta["billed_units"]["output_tokens"])
                    span.set_attribute("gen_ai.usage.total_tokens", response.meta["billed_units"]["input_tokens"] + response.meta["billed_units"]["output_tokens"])
                    span.set_attribute("gen_ai.usage.cost", cost)
                    if trace_content:
                        span.set_attribute("gen_ai.content.prompt", kwargs.get("message", ""))
                        span.set_attribute("gen_ai.content.completion", response.text)

                # Return original response
                return response

            except Exception as e:
                handle_exception(tracer, e, gen_ai_endpoint)
                logger.error("Error in patched message creation: %s", e)

                # Return original response
                return response

        except Exception as e:
            handle_exception(tracer, e, gen_ai_endpoint)
            raise e

    return wrapper

def chat_stream(gen_ai_endpoint, version, environment, application_name, tracer, pricing_info, trace_content):
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

        # Record start time for measuring request duration
        start_time = time.time()

        def stream_generator():
            # Placeholder for aggregating streaming response
            llmresponse = ""

            try:
                # Loop through streaming events capturing relevant details
                for event in wrapped(*args, **kwargs):
                    # Collect message IDs and aggregated response from events
                    if event.event_type == "stream-end":
                        llmresponse = event.response.text
                        response_id = event.response.response_id
                        prompt_tokens = event.response.meta["billed_units"]["input_tokens"]
                        completion_tokens = event.response.meta["billed_units"]["output_tokens"]
                        finish_reason = event.finish_reason
                    yield event

                # Sections handling exceptions ensure observability without disrupting operations
                try:
                    with tracer.start_as_current_span(gen_ai_endpoint, kind= SpanKind.CLIENT) as span:
                        end_time = time.time()
                        # Calculate total duration of operation
                        duration = end_time - start_time

                        # Calculate cost of the operation
                        cost = get_chat_model_cost(kwargs.get("model", "command"), pricing_info, prompt_tokens, completion_tokens)

                        # Set Span attributes
                        span.set_attribute("gen_ai.system", "cohere")
                        span.set_attribute("gen_ai.type", "chat")
                        span.set_attribute("gen_ai.endpoint", gen_ai_endpoint)
                        span.set_attribute("gen_ai.environment", environment)
                        span.set_attribute("gen_ai.application_name", application_name)
                        span.set_attribute("gen_ai.request_duration", duration)
                        span.set_attribute("gen_ai.request.model", kwargs.get("model", "command"))
                        span.set_attribute("gen_ai.request.temperature", kwargs.get("temperature", 0.3))
                        span.set_attribute("gen_ai.request.max_tokens", kwargs.get("max_tokens", ""))
                        span.set_attribute("gen_ai.request.seed", kwargs.get("seed", ""))
                        span.set_attribute("gen_ai.request.frequency_penalty", kwargs.get("frequency_penalty", 0.0))
                        span.set_attribute("gen_ai.request.presence_penalty", kwargs.get("presence_penalty", 0.0))
                        span.set_attribute("gen_ai.request.is_stream", True)
                        span.set_attribute("gen_ai.response.id", response_id)
                        span.set_attribute("gen_ai.response.finish_reason", finish_reason)
                        span.set_attribute("gen_ai.usage.prompt_tokens", prompt_tokens)
                        span.set_attribute("gen_ai.usage.completion_tokens", completion_tokens)
                        span.set_attribute("gen_ai.usage.total_tokens", prompt_tokens + completion_tokens)
                        span.set_attribute("gen_ai.usage.cost", cost)
                        if trace_content:
                            span.set_attribute("gen_ai.content.prompt", kwargs.get("message", ""))
                            span.set_attribute("gen_ai.content.completion", llmresponse)

                except Exception as e:
                    handle_exception(tracer, e, gen_ai_endpoint)
                    logger.error("Error in patched message creation: %s", e)

            except Exception as e:
                handle_exception(tracer, e, gen_ai_endpoint)
                raise e

        return stream_generator()

    return wrapper
