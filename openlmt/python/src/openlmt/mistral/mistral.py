# pylint: disable=duplicate-code, line-too-long, broad-exception-caught
"""
Module for monitoring Mistral API calls.
"""

import time
import logging
from ..__helpers import get_chat_model_cost, get_embed_model_cost, handle_exception
from opentelemetry.trace import SpanKind

# Initialize logger for logging potential issues and operations
logger = logging.getLogger(__name__)

# pylint: disable=too-many-arguments, too-many-statements
def init(llm, environment, application_name, tracer, pricing_info):
    """
    Initializes the instrumentation process by patching the Mistral client
    methods to gather telemetry data during its execution.

    Args:
        llm: Reference to the Mistral client being instrumented.
        environment (str): Identifier for the environment (e.g., 'production', 'development').
        application_name (str): Name of the application using the instrumented client.
        tracer: OpenTelemetry tracer object used for creating spans.
        pricing_info (dict): Contains pricing information for calculating the cost of operations.
    """

    # Backup original functions for later restoration if needed
    original_mistral_chat = llm.chat
    original_mistral_chat_stream = llm.chat_stream
    original_mistral_embeddings = llm.embeddings

    # pylint: disable=too-many-locals
    def patched_chat(*args, **kwargs):
        """
        A patched version of the 'chat' method, enabling telemetry data collection.

        This method wraps the original call to 'chat', adding a telemetry layer that
        captures execution time, error handling, and other metrics.

        Args:
            *args: Variable positional arguments passed to the original method.
            **kwargs: Variable keyword arguments passed to the original method.

        Returns:
            The response from the original 'chat' method.
        """

        # Sections handling exceptions ensure observability without disrupting operations
        try:
            start_time = time.time()
            response = original_mistral_chat(*args, **kwargs)
            end_time = time.time()

            try:
                with tracer.start_as_current_span("mistral.chat", kind= SpanKind.CLIENT) as span:
                    # Calculate total duration of operation
                    duration = end_time - start_time
                    
                    # Format 'messages' into a single string
                    message_prompt = kwargs.get('messages', "")
                    formatted_messages = []
                    for message in message_prompt:
                        role = message.role
                        content = message.content

                        if isinstance(content, list):
                            content_str = ", ".join(
                                f"{item['type']}: {item['text'] if 'text' in item else item['image_url']}"
                                if 'type' in item else f"text: {item['text']}"
                                for item in content
                            )
                            formatted_messages.append(f"{role}: {content_str}")
                        else:
                            formatted_messages.append(f"{role}: {content}")
                    prompt = " ".join(formatted_messages)

                    # Calculate cost of the operation
                    cost = get_chat_model_cost(kwargs.get("model", "mistral-small-latest"), pricing_info, response.usage.prompt_tokens, response.usage.completion_tokens)

                    # Set Span attributes
                    span.set_attribute("llm.provider", "Mistral")
                    span.set_attribute("llm.generation", "chat")
                    span.set_attribute("llm.endpoint", "mistral.chat")
                    span.set_attribute("llm.req.id", response.id)
                    span.set_attribute("llm.environment", environment)
                    span.set_attribute("llm.application.name", application_name)
                    span.set_attribute("llm.request.duration", duration)
                    span.set_attribute("llm.model", kwargs.get("model", "mistral-small-latest"))
                    span.set_attribute("llm.temperature", kwargs.get("temperature", 0.7))
                    span.set_attribute("llm.top.p", kwargs.get("top_p", 1))
                    span.set_attribute("llm.max.tokens", kwargs.get("max_tokens", ""))
                    span.set_attribute("llm.seed", kwargs.get("random_seed", ""))
                    span.set_attribute("llm.stream", False)
                    span.set_attribute("llm.finish.reason", response.choices[0].finish_reason)
                    span.set_attribute("llm.prompt", prompt)
                    span.set_attribute("llm.response", response.choices[0].message.content if response.choices[0].message.content else "")
                    span.set_attribute("llm.promptTokens", response.usage.prompt_tokens)
                    span.set_attribute("llm.completionTokens", response.usage.completion_tokens)
                    span.set_attribute("llm.totalTokens", response.usage.total_tokens)
                    span.set_attribute("llm.cost", cost)

                # Return original response
                return response
            
            except Exception as e:
                handle_exception(tracer, e, "mistral.chat")
                logger.error("Error in patched message creation: %s", e)

                # Return original response
                return response

        except Exception as e:
            handle_exception(tracer, e, "mistral.chat")
            raise e

    # pylint: disable=too-many-locals
    def patched_chat_stream(*args, **kwargs):
        """
        A patched version of the 'chat_stream' method, enabling telemetry data collection.

        This method wraps the original call to 'chat_stream', adding a telemetry layer that
        captures execution time, error handling, and other metrics.

        Args:
            *args: Variable positional arguments passed to the original method.
            **kwargs: Variable keyword arguments passed to the original method.

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
                for event in original_mistral_chat_stream(*args, **kwargs):
                    response_id = event.id
                    llmresponse += event.choices[0].delta.content
                    if event.usage is not None:
                        prompt_tokens = event.usage.prompt_tokens
                        completion_tokens = event.usage.completion_tokens
                        total_tokens = event.usage.total_tokens
                        finish_reason = event.choices[0].finish_reason
                    yield event
                
                # Sections handling exceptions ensure observability without disrupting operations
                try:
                    with tracer.start_as_current_span("mistral.chat", kind= SpanKind.CLIENT) as span:
                        end_time = time.time()
                        # Calculate total duration of operation
                        duration = end_time - start_time

                        # Format 'messages' into a single string
                        message_prompt = kwargs.get('messages', "")
                        formatted_messages = []
                        for message in message_prompt:
                            role = message.role
                            content = message.content

                            if isinstance(content, list):
                                content_str = ", ".join(
                                    f"{item['type']}: {item['text'] if 'text' in item else item['image_url']}"
                                    if 'type' in item else f"text: {item['text']}"
                                    for item in content
                                )
                                formatted_messages.append(f"{role}: {content_str}")
                            else:
                                formatted_messages.append(f"{role}: {content}")
                        prompt = " ".join(formatted_messages)

                        # Calculate cost of the operation
                        cost = get_chat_model_cost(kwargs.get("model", "mistral-small-latest"), pricing_info, prompt_tokens, completion_tokens)

                        # Set Span attributes
                        span.set_attribute("llm.provider", "Mistral")
                        span.set_attribute("llm.generation", "chat")
                        span.set_attribute("llm.endpoint", "mistral.chat")
                        span.set_attribute("llm.req.id", response_id)
                        span.set_attribute("llm.environment", environment)
                        span.set_attribute("llm.application.name", application_name)
                        span.set_attribute("llm.request.duration", duration)
                        span.set_attribute("llm.model", kwargs.get("model", "mistral-small-latest"))
                        span.set_attribute("llm.temperature", kwargs.get("temperature", 0.7))
                        span.set_attribute("llm.top.p", kwargs.get("top_p", 1))
                        span.set_attribute("llm.max.tokens", kwargs.get("max_tokens", ""))
                        span.set_attribute("llm.seed", kwargs.get("random_seed", ""))
                        span.set_attribute("llm.stream", True)
                        span.set_attribute("llm.finish.reason", finish_reason)
                        span.set_attribute("llm.prompt", prompt)
                        span.set_attribute("llm.response", llmresponse)
                        span.set_attribute("llm.promptTokens", prompt_tokens)
                        span.set_attribute("llm.completionTokens", completion_tokens)
                        span.set_attribute("llm.totalTokens", total_tokens)
                        span.set_attribute("llm.cost", cost)
                
                except Exception as e:
                    handle_exception(tracer, e, "mistral.chat")
                    logger.error("Error in patched message creation: %s", e)

            except Exception as e:
                handle_exception(tracer, e, "mistral.chat")
                raise e

        return stream_generator()

    def patched_embeddings(*args, **kwargs):
        """
        A patched version of the 'embeddings' method, enabling telemetry data collection.

        This method wraps the original call to 'embeddings', adding a telemetry layer that
        captures execution time, error handling, and other metrics.

        Args:
            *args: Variable positional arguments passed to the original method.
            **kwargs: Variable keyword arguments passed to the original method.

        Returns:
            The response from the original 'embeddings' method.
        """

        # Sections handling exceptions ensure observability without disrupting operations
        try:
            start_time = time.time()
            response = original_mistral_embeddings(*args, **kwargs)
            end_time = time.time()

            try:
                with tracer.start_as_current_span("mistral.embeddings", kind= SpanKind.CLIENT) as span:
                    # Calculate total duration of operation
                    duration = end_time - start_time

                    # Get prompt from kwargs and store as a single string
                    prompt = ', '.join(kwargs.get('input', []))

                    # Calculate cost of the operation
                    cost = get_embed_model_cost(kwargs.get('model', "mistral-embed"), pricing_info, response.usage.prompt_tokens)

                    # Set Span attributes
                    span.set_attribute("llm.provider", "Mistral")
                    span.set_attribute("llm.generation", "Embedding")
                    span.set_attribute("llm.endpoint", "mistral.embeddings")
                    span.set_attribute("llm.environment", environment)
                    span.set_attribute("llm.application.name", application_name)
                    span.set_attribute("llm.request.duration", duration)
                    span.set_attribute("llm.model", kwargs.get('model', "mistral-embed"))
                    span.set_attribute("llm.prompt", prompt)
                    span.set_attribute("llm.embedding.format", kwargs.get("encoding_format", "float"))
                    span.set_attribute("llm.req.id", response.id)
                    span.set_attribute("llm.promptTokens", response.usage.prompt_tokens)
                    span.set_attribute("llm.totalTokens", response.usage.total_tokens)
                    span.set_attribute("llm.cost", cost)

                # Return original response
                return response

            except Exception as e:
                handle_exception(tracer, e, "mistral.embeddings")
                logger.error("Error in patched message creation: %s", e)

                # Return original response
                return response

        except Exception as e:
            handle_exception(tracer, e, "mistral.embeddings")
            raise e

    llm.chat = patched_chat
    llm.chat_stream = patched_chat_stream
    llm.embeddings = patched_embeddings
