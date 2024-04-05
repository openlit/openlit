# pylint: disable=duplicate-code
"""
Module for monitoring Anthropic API calls.
"""

import time
import logging
from ..__helpers import get_chat_model_cost, handle_exception
from opentelemetry.trace import SpanKind

# Initialize logger for logging potential issues and operations
logger = logging.getLogger(__name__)

# pylint: disable=too-many-arguments, too-many-statements
def init(llm, environment, application_name, tracer, pricing_info):
    """
    Initializes the instrumentation process by patching the Anthropic clients’ 'messages.create'
    method to gather telemetry data during its execution.

    Args:
        llm: Reference to the Anthropic client being instrumented.
        environment (str): Identifier for the environment (e.g., 'production', 'development').
        application_name (str): Name of the application using the instrumented client.
        tracer: OpenTelemetry tracer object used for creating spans.
        pricing_info (dict): Contains pricing information for calculating the cost of operations.
    """

    # Backup original messages.create function for later restoration if needed
    original_messages_create = llm.messages.create

    # pylint: disable=too-many-locals
    def patched_messages_create(*args, **kwargs):
        """
        A patched version of the 'messages.create' method, enabling telemetry data collection.

        This method wraps the original call to 'messages.create', adding a telemetry layer that
        captures execution time, error handling, and other metrics.

        Args:
            *args: Variable positional arguments passed to the original method.
            **kwargs: Variable keyword arguments passed to the original method.

        Returns:
            The response from the original 'messages.create' method.
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
                    for event in original_messages_create(*args, **kwargs):

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
                        with tracer.start_as_current_span("anthropic.messages", kind= SpanKind.CLIENT) as span:
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
                                        #pylint: disable=line-too-long
                                        f'{item["type"]}: {item["text"] if "text" in item else item["image_url"]}'
                                        if "type" in item else f'text: {item["text"]}'
                                        for item in content
                                    )
                                    formatted_messages.append(f"{role}: {content_str}")
                                else:
                                    formatted_messages.append(f"{role}: {content}")
                            prompt = "\n".join(formatted_messages)

                            # Calculate cost of the operation
                            cost = get_chat_model_cost(kwargs.get("model", "claude-3-sonnet-20240229"), pricing_info, prompt_tokens, completion_tokens)

                            # Set Span attributes
                            span.set_attribute("llm.provider", "Anthropic")
                            span.set_attribute("llm.generation", "chat")
                            span.set_attribute("llm.endpoint", "anthropic.messages")
                            span.set_attribute("llm.req.id", response_id)
                            span.set_attribute("llm.environment", environment)
                            span.set_attribute("llm.application.name", application_name)
                            span.set_attribute("llm.request.duration", duration)
                            span.set_attribute("llm.model", kwargs.get("model", "claude-3-sonnet-20240229"))
                            span.set_attribute("llm.max.tokens", kwargs.get("max_tokens", ""))
                            span.set_attribute("llm.prompt", prompt)
                            span.set_attribute("llm.stream", True)
                            span.set_attribute("llm.temperature", kwargs.get("temperature", 1.0))
                            span.set_attribute("llm.top.p", kwargs.get("top_p", ""))
                            span.set_attribute("llm.top.k", kwargs.get("top_k", ""))
                            span.set_attribute("llm.finish.reason", finish_reason)
                            span.set_attribute("llm.response", llmresponse)
                            span.set_attribute("llm.promptTokens", prompt_tokens)
                            span.set_attribute("llm.completionTokens", completion_tokens)
                            span.set_attribute("llm.totalTokens", prompt_tokens + completion_tokens)
                            span.set_attribute("llm.cost", cost)

                    except Exception as e:
                        handle_exception(tracer, e, "anthropic.messages")
                        logger.error(f"Error in patched message creation: {e}")

                except Exception as e:
                    handle_exception(tracer, e, "anthropic.messages")
                    raise e

            return stream_generator()

        # Handling for non-streaming responses
        else:
            try:
                response = original_messages_create(*args, **kwargs)
                end_time = time.time()

                try:
                    with tracer.start_as_current_span("anthropic.messages", kind=SpanKind.CLIENT) as span:
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
                        cost = get_chat_model_cost(kwargs.get("model", "claude-3-sonnet-20240229"), pricing_info, response.usage.input_tokens, response.usage.output_tokens)

                        # Set Span attribues
                        span.set_attribute("llm.provider", "Anthropic")
                        span.set_attribute("llm.generation", "chat")
                        span.set_attribute("llm.endpoint", "anthropic.messages")
                        span.set_attribute("llm.req.id", response.id)
                        span.set_attribute("llm.environment", environment)
                        span.set_attribute("llm.application.name", application_name)
                        span.set_attribute("llm.request.duration", duration)
                        span.set_attribute("llm.model", kwargs.get("model", "claude-3-sonnet-20240229"))
                        span.set_attribute("llm.max.tokens", kwargs.get("max_tokens", ""))
                        span.set_attribute("llm.prompt", prompt)
                        span.set_attribute("llm.stream", False)
                        span.set_attribute("llm.temperature", kwargs.get("temperature", 1.0))
                        span.set_attribute("llm.top.p", kwargs.get("top_p", ""))
                        span.set_attribute("llm.top.k", kwargs.get("top_k", ""))
                        span.set_attribute("llm.finish.reason", response.stop_reason)
                        span.set_attribute("llm.response", response.content[0].text if response.content else "")
                        span.set_attribute("llm.promptTokens", response.usage.input_tokens)
                        span.set_attribute("llm.completionTokens", response.usage.output_tokens)
                        span.set_attribute("llm.totalTokens", response.usage.input_tokens + response.usage.output_tokens)
                        span.set_attribute("llm.cost", cost)

                    # Return original response
                    return response

                except Exception as e:
                    handle_exception(tracer, e, "anthropic.messages")
                    logger.error(f"Error in patched message creation: {e}")

                    # Return original response
                    return response
            
            except Exception as e:
                handle_exception(tracer, e, "anthropic.messages")
                raise e

    llm.messages.create = patched_messages_create
