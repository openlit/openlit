# pylint: disable=duplicate-code, broad-exception-caught, too-many-statements, unused-argument
"""
Module for monitoring Anthropic API calls.
"""

import time
import logging
from opentelemetry.trace import SpanKind
from ..__helpers import get_chat_model_cost, handle_exception

# Initialize logger for logging potential issues and operations
logger = logging.getLogger(__name__)


def messages(gen_ai_endpoint, version, environment, application_name, tracer,
             pricing_info, trace_content):
    """
    Generates a telemetry wrapper for messages to collect metrics.

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
        Wraps the 'messages' API call to add telemetry.

        This collects metrics such as execution time, cost, and token usage, and handles errors
        gracefully, adding details to the trace for observability.

        Args:
            wrapped: The original 'messages' method to be wrapped.
            instance: The instance of the class where the original method is defined.
            args: Positional arguments for the 'messages' method.
            kwargs: Keyword arguments for the 'messages' method.

        Returns:
            The response from the original 'messages' method.
        """

        # Check if streaming is enabled for the API call
        streaming = kwargs.get("stream", False)
        # Record start time for measuring request duration
        start_time = time.time()

        # pylint: disable=no-else-return
        if streaming:
            # Special handling for streaming response to accommodate the nature of data flow
            def stream_generator():
                # Placeholder for aggregating streaming response
                llmresponse = ""

                try:
                    # Loop through streaming events capturing relevant details
                    for event in wrapped(*args, **kwargs):

                        # Collect message IDs and input token from events
                        if event.type == "message_start":
                            response_id = event.message.id
                            prompt_tokens = event.message.usage.input_tokens

                        # Aggregate response content
                        if event.type == "content_block_delta":
                            llmresponse += event.delta.text

                        # Collect output tokens and stop reason from events
                        if event.type == "message_delta":
                            completion_tokens = event.usage.output_tokens
                            finish_reason = event.delta.stop_reason
                        yield event

                    # Sections handling exceptions ensure observability without disrupting operations
                    try:
                        with tracer.start_as_current_span(gen_ai_endpoint, kind= SpanKind.CLIENT) as span:
                            end_time = time.time()
                            # Calculate total duration of operation
                            duration = end_time - start_time

                            # Format 'messages' into a single string
                            message_prompt = kwargs.get("messages", "")
                            formatted_messages = []
                            for message in message_prompt:
                                role = message["role"]
                                content = message["content"]

                                if isinstance(content, list):
                                    content_str = ", ".join(
                                        # pylint: disable=line-too-long
                                        f'{item["type"]}: {item["text"] if "text" in item else item["image_url"]}'
                                        if "type" in item else f'text: {item["text"]}'
                                        for item in content
                                    )
                                    formatted_messages.append(f"{role}: {content_str}")
                                else:
                                    formatted_messages.append(f"{role}: {content}")
                            prompt = "\n".join(formatted_messages)

                            # Calculate cost of the operation
                            cost = get_chat_model_cost(
                                kwargs.get("model", "claude-3-sonnet-20240229"),
                                pricing_info, prompt_tokens, completion_tokens)

                            # Set Span attributes
                            span.set_attribute("gen_ai.system", "anthropic")
                            span.set_attribute("gen_ai.type", "chat")
                            span.set_attribute("gen_ai.endpoint", gen_ai_endpoint)
                            span.set_attribute("gen_ai.response.id", response_id)
                            span.set_attribute("gen_ai.environment", environment)
                            span.set_attribute("gen_ai.application_name", application_name)
                            span.set_attribute("gen_ai.request_duration", duration)
                            span.set_attribute("gen_ai.request.model",
                                               kwargs.get("model", "claude-3-sonnet-20240229"))
                            span.set_attribute("gen_ai.request.max_tokens",
                                               kwargs.get("max_tokens", ""))
                            span.set_attribute("gen_ai.request.is_stream", True)
                            span.set_attribute("gen_ai.request.temperature",
                                                kwargs.get("temperature", 1.0))
                            span.set_attribute("gen_ai.request.top_p",
                                               kwargs.get("top_p", ""))
                            span.set_attribute("gen_ai.request.top_k",
                                               kwargs.get("top_k", ""))
                            span.set_attribute("gen_ai.response.finish_reason", finish_reason)
                            span.set_attribute("gen_ai.usage.prompt_tokens", prompt_tokens)
                            span.set_attribute("gen_ai.usage.completion_tokens", completion_tokens)
                            span.set_attribute("gen_ai.usage.total_tokens",
                                               prompt_tokens + completion_tokens)
                            span.set_attribute("gen_ai.usage.cost", cost)
                            if trace_content:
                                span.set_attribute("gen_ai.content.prompt", prompt)
                                span.set_attribute("gen_ai.content.completion", llmresponse)

                    except Exception as e:
                        handle_exception(tracer, e, gen_ai_endpoint)
                        logger.error("Error in patched message creation: %s", e)

                except Exception as e:
                    handle_exception(tracer, e, gen_ai_endpoint)
                    raise e

            return stream_generator()

        # Handling for non-streaming responses
        else:
            try:
                response = wrapped(*args, **kwargs)
                end_time = time.time()

                try:
                    with tracer.start_as_current_span(gen_ai_endpoint, kind=SpanKind.CLIENT) as span:
                        # Calculate total duration of operation
                        duration = end_time - start_time

                        # Format 'messages' into a single string
                        message_prompt = kwargs.get("messages", "")
                        formatted_messages = []
                        for message in message_prompt:
                            role = message["role"]
                            content = message["content"]

                            if isinstance(content, list):
                                content_str = ", ".join(
                                    f'{item["type"]}: {item["text"] if "text" in item else item["image_url"]}'
                                    if "type" in item else f'text: {item["text"]}'
                                    for item in content
                                )
                                formatted_messages.append(f"{role}: {content_str}")
                            else:
                                formatted_messages.append(f"{role}: {content}")
                        prompt = "\n".join(formatted_messages)

                        # Calculate cost of the operation
                        cost = get_chat_model_cost(kwargs.get("model", "claude-3-sonnet-20240229"),
                                                   pricing_info, response.usage.input_tokens,
                                                   response.usage.output_tokens)

                        # Set Span attribues
                        span.set_attribute("gen_ai.system", "anthropic")
                        span.set_attribute("gen_ai.type", "chat")
                        span.set_attribute("gen_ai.endpoint", gen_ai_endpoint)
                        span.set_attribute("gen_ai.response.id", response.id)
                        span.set_attribute("gen_ai.environment", environment)
                        span.set_attribute("gen_ai.application_name", application_name)
                        span.set_attribute("gen_ai.request_duration", duration)
                        span.set_attribute("gen_ai.request.model",
                                           kwargs.get("model", "claude-3-sonnet-20240229"))
                        span.set_attribute("gen_ai.request.max_tokens",
                                           kwargs.get("max_tokens", ""))
                        span.set_attribute("gen_ai.request.is_stream", False)
                        span.set_attribute("gen_ai.request.temperature",
                                           kwargs.get("temperature", 1.0))
                        span.set_attribute("gen_ai.request.top_p",
                                           kwargs.get("top_p", ""))
                        span.set_attribute("gen_ai.request.top_k",
                                           kwargs.get("top_k", ""))
                        span.set_attribute("gen_ai.response.finish_reason",
                                           response.stop_reason)
                        span.set_attribute("gen_ai.usage.prompt_tokens",
                                           response.usage.input_tokens)
                        span.set_attribute("gen_ai.usage.completion_tokens",
                                           response.usage.output_tokens)
                        span.set_attribute("gen_ai.usage.total_tokens",
                                           response.usage.input_tokens +
                                           response.usage.output_tokens)
                        span.set_attribute("gen_ai.usage.cost", cost)
                        if trace_content:
                            span.set_attribute("gen_ai.content.prompt", prompt)
                            span.set_attribute("gen_ai.content.completion",
                                               response.content[0].text if response.content else "")

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
