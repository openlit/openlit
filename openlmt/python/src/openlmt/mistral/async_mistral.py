# pylint: disable=duplicate-code, broad-exception-caught, too-many-statements, unused-argument
"""
Module for monitoring Mistral API calls.
"""

import logging
from opentelemetry.trace import SpanKind
from ..__helpers import get_chat_model_cost, get_embed_model_cost, handle_exception
from openlmt.semcov import SemanticConvetion

# Initialize logger for logging potential issues and operations
logger = logging.getLogger(__name__)

def async_chat(gen_ai_endpoint, version, environment, application_name,
               tracer, pricing_info, trace_content):
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

    async def wrapper(wrapped, instance, args, kwargs):
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

        with tracer.start_as_current_span(gen_ai_endpoint, kind= SpanKind.CLIENT) as span:
            # Handling exception ensure observability without disrupting operation
            try:
                response = await wrapped(*args, **kwargs)

                try:
                    # Format 'messages' into a single string
                    message_prompt = kwargs.get('messages', "")
                    formatted_messages = []
                    for message in message_prompt:
                        role = message.role
                        content = message.content

                        if isinstance(content, list):
                            content_str = ", ".join(
                                # pylint: disable=line-too-long
                                f"{item['type']}: {item['text'] if 'text' in item else item['image_url']}"
                                if 'type' in item else f"text: {item['text']}"
                                for item in content
                            )
                            formatted_messages.append(f"{role}: {content_str}")
                        else:
                            formatted_messages.append(f"{role}: {content}")
                    prompt = " ".join(formatted_messages)

                    # Calculate cost of the operation
                    cost = get_chat_model_cost(kwargs.get("model", "mistral-small-latest"),
                                                pricing_info, response.usage.prompt_tokens,
                                                response.usage.completion_tokens)

                    # Set Span attributes
                    span.set_attribute(SemanticConvetion.GEN_AI_SYSTEM, SemanticConvetion.GEN_AI_SYSTEM_MISTRAL)
                    span.set_attribute(SemanticConvetion.GEN_AI_TYPE, SemanticConvetion.GEN_AI_TYPE_CHAT)
                    span.set_attribute(SemanticConvetion.GEN_AI_ENDPOINT, gen_ai_endpoint)
                    span.set_attribute(SemanticConvetion.GEN_AI_RESPONSE_ID, response.id)
                    span.set_attribute(SemanticConvetion.GEN_AI_ENVIRONMENT, environment)
                    span.set_attribute(SemanticConvetion.GEN_AI_APPLICATION_NAME, application_name)
                    span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_MODEL,
                                        kwargs.get("model", "mistral-small-latest"))
                    span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_TEMPERATURE,
                                        kwargs.get("temperature", 0.7))
                    span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_TOP_P,
                                        kwargs.get("top_p", 1))
                    span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_MAX_TOKENS,
                                        kwargs.get("max_tokens", ""))
                    span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_SEED,
                                        kwargs.get("random_seed", ""))
                    span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_IS_STREAM, False)
                    span.set_attribute(SemanticConvetion.GEN_AI_RESPONSE_FINISH_REASON,
                                        response.choices[0].finish_reason)
                    span.set_attribute(SemanticConvetion.GEN_AI_USAGE_PROMPT_TOKENS,
                                        response.usage.prompt_tokens)
                    span.set_attribute(SemanticConvetion.GEN_AI_USAGE_COMPLETION_TOKENS,
                                        response.usage.completion_tokens)
                    span.set_attribute(SemanticConvetion.GEN_AI_USAGE_TOTAL_TOKENS,
                                        response.usage.total_tokens)
                    span.set_attribute(SemanticConvetion.GEN_AI_USAGE_COST, cost)
                    if trace_content:
                        span.set_attribute(SemanticConvetion.GEN_AI_CONTENT_PROMPT, prompt)
                        # pylint: disable=line-too-long
                        span.set_attribute(SemanticConvetion.GEN_AI_CONTENT_COMPLETION, response.choices[0].message.content if response.choices[0].message.content else "")

                    # Return original response
                    return response

                except Exception as e:
                    handle_exception(span, e)
                    logger.error("Error in trace creation: %s", e)

                    # Return original response
                    return response

            except Exception as e:
                handle_exception(span, e)
                raise e

    return wrapper

def async_chat_stream(gen_ai_endpoint, version, environment, application_name,
                      tracer, pricing_info, trace_content):
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

    async def wrapper(wrapped, instance, args, kwargs):
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

        async def stream_generator():
            # pylint: disable=line-too-long
            with tracer.start_as_current_span(gen_ai_endpoint, kind= SpanKind.CLIENT) as span:
                # Placeholder for aggregating streaming response
                llmresponse = ""

                try:
                    # Loop through streaming events capturing relevant details
                    async for event in wrapped(*args, **kwargs):
                        response_id = event.id
                        llmresponse += event.choices[0].delta.content
                        if event.usage is not None:
                            prompt_tokens = event.usage.prompt_tokens
                            completion_tokens = event.usage.completion_tokens
                            total_tokens = event.usage.total_tokens
                            finish_reason = event.choices[0].finish_reason
                        yield event

                    # Handling exception ensure observability without disrupting operation
                    try:
                        # Format 'messages' into a single string
                        message_prompt = kwargs.get('messages', "")
                        formatted_messages = []
                        for message in message_prompt:
                            role = message.role
                            content = message.content

                            if isinstance(content, list):
                                content_str = ", ".join(
                                    # pylint: disable=line-too-long
                                    f"{item['type']}: {item['text'] if 'text' in item else item['image_url']}"
                                    if 'type' in item else f"text: {item['text']}"
                                    for item in content
                                )
                                formatted_messages.append(f"{role}: {content_str}")
                            else:
                                formatted_messages.append(f"{role}: {content}")
                        prompt = " ".join(formatted_messages)

                        # Calculate cost of the operation
                        cost = get_chat_model_cost(kwargs.get("model", "mistral-small-latest"),
                                                    pricing_info, prompt_tokens, completion_tokens)

                        # Set Span attributes
                        span.set_attribute(SemanticConvetion.GEN_AI_SYSTEM, SemanticConvetion.GEN_AI_SYSTEM_MISTRAL)
                        span.set_attribute(SemanticConvetion.GEN_AI_TYPE, SemanticConvetion.GEN_AI_TYPE_CHAT)
                        span.set_attribute(SemanticConvetion.GEN_AI_ENDPOINT, gen_ai_endpoint)
                        span.set_attribute(SemanticConvetion.GEN_AI_RESPONSE_ID, response_id)
                        span.set_attribute(SemanticConvetion.GEN_AI_ENVIRONMENT, environment)
                        span.set_attribute(SemanticConvetion.GEN_AI_APPLICATION_NAME, application_name)
                        span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_MODEL,
                                            kwargs.get("model", "mistral-small-latest"))
                        span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_TEMPERATURE,
                                            kwargs.get("temperature", 0.7))
                        span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_TOP_P,
                                            kwargs.get("top_p", 1))
                        span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_MAX_TOKENS,
                                            kwargs.get("max_tokens", ""))
                        span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_SEED,
                                            kwargs.get("random_seed", ""))
                        span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_IS_STREAM, True)
                        span.set_attribute(SemanticConvetion.GEN_AI_RESPONSE_FINISH_REASON, finish_reason)
                        span.set_attribute(SemanticConvetion.GEN_AI_USAGE_PROMPT_TOKENS, prompt_tokens)
                        span.set_attribute(SemanticConvetion.GEN_AI_USAGE_COMPLETION_TOKENS, completion_tokens)
                        span.set_attribute(SemanticConvetion.GEN_AI_USAGE_TOTAL_TOKENS, total_tokens)
                        span.set_attribute(SemanticConvetion.GEN_AI_USAGE_COST, cost)
                        if trace_content:
                            span.set_attribute(SemanticConvetion.GEN_AI_CONTENT_PROMPT, prompt)
                            span.set_attribute(SemanticConvetion.GEN_AI_CONTENT_COMPLETION, llmresponse)

                    except Exception as e:
                        handle_exception(span, e)
                        logger.error("Error in trace creation: %s", e)

                except Exception as e:
                    handle_exception(span, e)
                    raise e

        return stream_generator()

    return wrapper

def async_embeddings(gen_ai_endpoint, version, environment, application_name,
                     tracer, pricing_info, trace_content):
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

    async def wrapper(wrapped, instance, args, kwargs):
        """
        Wraps the 'embeddings' API call to add telemetry.

        This collects metrics such as execution time, cost, and token usage, and handles errors
        gracefully, adding details to the trace for observability.

        Args:
            wrapped: The original 'embeddings' method to be wrapped.
            instance: The instance of the class where the original method is defined.
            args: Positional arguments for the 'embeddings' method.
            kwargs: Keyword arguments for the 'embeddings' method.

        Returns:
            The response from the original 'embeddings' method.
        """

        with tracer.start_as_current_span(gen_ai_endpoint, kind= SpanKind.CLIENT) as span:
            # Handling exception ensure observability without disrupting operation
            try:
                response = await wrapped(*args, **kwargs)

                try:
                    # Get prompt from kwargs and store as a single string
                    prompt = ', '.join(kwargs.get('input', []))

                    # Calculate cost of the operation
                    cost = get_embed_model_cost(kwargs.get('model', "mistral-embed"),
                                                pricing_info, response.usage.prompt_tokens)

                    # Set Span attributes
                    span.set_attribute(SemanticConvetion.GEN_AI_SYSTEM, SemanticConvetion.GEN_AI_SYSTEM_MISTRAL)
                    span.set_attribute(SemanticConvetion.GEN_AI_TYPE, SemanticConvetion.GEN_AI_TYPE_EMBEDDING)
                    span.set_attribute(SemanticConvetion.GEN_AI_ENDPOINT, gen_ai_endpoint)
                    span.set_attribute(SemanticConvetion.GEN_AI_ENVIRONMENT, environment)
                    span.set_attribute(SemanticConvetion.GEN_AI_APPLICATION_NAME, application_name)
                    span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_MODEL,
                                        kwargs.get('model', "mistral-embed"))
                    span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_EMBEDDING_FORMAT,
                                        kwargs.get("encoding_format", "float"))
                    span.set_attribute(SemanticConvetion.GEN_AI_RESPONSE_ID, response.id)
                    span.set_attribute(SemanticConvetion.GEN_AI_USAGE_PROMPT_TOKENS,
                                        response.usage.prompt_tokens)
                    span.set_attribute(SemanticConvetion.GEN_AI_USAGE_TOTAL_TOKENS,
                                        response.usage.total_tokens)
                    span.set_attribute(SemanticConvetion.GEN_AI_USAGE_COST, cost)
                    if trace_content:
                        span.set_attribute(SemanticConvetion.GEN_AI_CONTENT_PROMPT, prompt)

                    # Return original response
                    return response

                except Exception as e:
                    handle_exception(span, e)
                    logger.error("Error in trace creation: %s", e)

                    # Return original response
                    return response

            except Exception as e:
                handle_exception(span, e)
                raise e

    return wrapper
