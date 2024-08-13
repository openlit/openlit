# pylint: disable=duplicate-code, broad-exception-caught, too-many-statements, unused-argument, possibly-used-before-assignment
"""
Module for monitoring Ollama API calls.
"""

import logging
from opentelemetry.trace import SpanKind, Status, StatusCode
from opentelemetry.sdk.resources import TELEMETRY_SDK_NAME
from openlit.__helpers import (
    handle_exception,
    general_tokens,
    get_chat_model_cost,
    get_embed_model_cost
)
from openlit.semcov import SemanticConvetion

# Initialize logger for logging potential issues and operations
logger = logging.getLogger(__name__)

def chat(gen_ai_endpoint, version, environment, application_name,
                     tracer, pricing_info, trace_content, metrics, disable_metrics):
    """
    Generates a telemetry wrapper for chat to collect metrics.

    Args:
        gen_ai_endpoint: Endpoint identifier for logging and tracing.
        version: Version of the monitoring package.
        environment: Deployment environment (e.g., production, staging).
        application_name: Name of the application using the Ollama API.
        tracer: OpenTelemetry tracer for creating spans.
        pricing_info: Information used for calculating the cost of Ollama usage.
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

        # Check if streaming is enabled for the API call
        streaming = kwargs.get("stream", False)

        # pylint: disable=no-else-return
        if streaming:
            # Special handling for streaming response to accommodate the nature of data flow
            def stream_generator():
                with tracer.start_as_current_span(gen_ai_endpoint, kind= SpanKind.CLIENT) as span:
                    # Placeholder for aggregating streaming response
                    llmresponse = ""

                    # Loop through streaming events capturing relevant details
                    for chunk in wrapped(*args, **kwargs):
                        # Collect aggregated response from events
                        content = chunk['message']['content']
                        llmresponse += content

                        if chunk['done'] is True:
                            completion_tokens = chunk["eval_count"]

                        yield chunk

                    # Handling exception ensure observability without disrupting operation
                    try:
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

                        prompt_tokens = general_tokens(prompt)
                        total_tokens = prompt_tokens + completion_tokens
                        # Calculate cost of the operation
                        cost = get_chat_model_cost(kwargs.get("model", "llama3"),
                                                pricing_info, prompt_tokens, completion_tokens)

                        # Set Span attributes
                        span.set_attribute(TELEMETRY_SDK_NAME, "openlit")
                        span.set_attribute(SemanticConvetion.GEN_AI_SYSTEM,
                                            SemanticConvetion.GEN_AI_SYSTEM_OLLAMA)
                        span.set_attribute(SemanticConvetion.GEN_AI_TYPE,
                                            SemanticConvetion.GEN_AI_TYPE_CHAT)
                        span.set_attribute(SemanticConvetion.GEN_AI_ENDPOINT,
                                            gen_ai_endpoint)
                        span.set_attribute(SemanticConvetion.GEN_AI_ENVIRONMENT,
                                            environment)
                        span.set_attribute(SemanticConvetion.GEN_AI_APPLICATION_NAME,
                                            application_name)
                        span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_MODEL,
                                            kwargs.get("model", "llama3"))
                        span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_IS_STREAM,
                                            True)
                        span.set_attribute(SemanticConvetion.GEN_AI_USAGE_PROMPT_TOKENS,
                                            prompt_tokens)
                        span.set_attribute(SemanticConvetion.GEN_AI_USAGE_COMPLETION_TOKENS,
                                            completion_tokens)
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
                                    SemanticConvetion.GEN_AI_SYSTEM_OLLAMA,
                                SemanticConvetion.GEN_AI_ENVIRONMENT:
                                    environment,
                                SemanticConvetion.GEN_AI_TYPE:
                                    SemanticConvetion.GEN_AI_TYPE_CHAT,
                                SemanticConvetion.GEN_AI_REQUEST_MODEL:
                                    kwargs.get("model", "llama3")
                            }

                            metrics["genai_requests"].add(1, attributes)
                            metrics["genai_total_tokens"].add(total_tokens, attributes)
                            metrics["genai_completion_tokens"].add(completion_tokens, attributes)
                            metrics["genai_prompt_tokens"].add(prompt_tokens, attributes)
                            metrics["genai_cost"].record(cost, attributes)

                    except Exception as e:
                        handle_exception(span, e)
                        logger.error("Error in trace creation: %s", e)

            return stream_generator()

        # Handling for non-streaming responses
        else:
            # pylint: disable=line-too-long
            with tracer.start_as_current_span(gen_ai_endpoint, kind= SpanKind.CLIENT) as span:
                response = wrapped(*args, **kwargs)

                try:
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

                    # Set base span attribues
                    span.set_attribute(TELEMETRY_SDK_NAME, "openlit")
                    span.set_attribute(SemanticConvetion.GEN_AI_SYSTEM,
                                        SemanticConvetion.GEN_AI_SYSTEM_OLLAMA)
                    span.set_attribute(SemanticConvetion.GEN_AI_TYPE,
                                        SemanticConvetion.GEN_AI_TYPE_CHAT)
                    span.set_attribute(SemanticConvetion.GEN_AI_ENDPOINT,
                                        gen_ai_endpoint)
                    span.set_attribute(SemanticConvetion.GEN_AI_ENVIRONMENT,
                                        environment)
                    span.set_attribute(SemanticConvetion.GEN_AI_APPLICATION_NAME,
                                        application_name)
                    span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_MODEL,
                                        kwargs.get("model", "llama3"))
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
                                SemanticConvetion.GEN_AI_CONTENT_COMPLETION: response['message']['content'],
                            },
                        )

                    prompt_tokens = general_tokens(prompt)
                    completion_tokens = response["eval_count"]
                    total_tokens = prompt_tokens + completion_tokens
                    # Calculate cost of the operation
                    cost = get_chat_model_cost(kwargs.get("model", "llama3"),
                                                pricing_info, prompt_tokens, completion_tokens)

                    span.set_attribute(SemanticConvetion.GEN_AI_USAGE_PROMPT_TOKENS,
                                        prompt_tokens)
                    span.set_attribute(SemanticConvetion.GEN_AI_USAGE_COMPLETION_TOKENS,
                                        completion_tokens)
                    span.set_attribute(SemanticConvetion.GEN_AI_USAGE_TOTAL_TOKENS,
                                        total_tokens)
                    span.set_attribute(SemanticConvetion.GEN_AI_RESPONSE_FINISH_REASON,
                                        [response["done_reason"]])
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
                                SemanticConvetion.GEN_AI_SYSTEM_OLLAMA,
                            SemanticConvetion.GEN_AI_ENVIRONMENT:
                                environment,
                            SemanticConvetion.GEN_AI_TYPE:
                                SemanticConvetion.GEN_AI_TYPE_CHAT,
                            SemanticConvetion.GEN_AI_REQUEST_MODEL:
                                kwargs.get("model", "llama3")
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

def generate(gen_ai_endpoint, version, environment, application_name,
                     tracer, pricing_info, trace_content, metrics, disable_metrics):
    """
    Generates a telemetry wrapper for generate to collect metrics.

    Args:
        gen_ai_endpoint: Endpoint identifier for logging and tracing.
        version: Version of the monitoring package.
        environment: Deployment environment (e.g., production, staging).
        application_name: Name of the application using the Ollama API.
        tracer: OpenTelemetry tracer for creating spans.
        pricing_info: Information used for calculating the cost of Ollama usage.
        trace_content: Flag indicating whether to trace the actual content.

    Returns:
        A function that wraps the generate method to add telemetry.
    """

    def wrapper(wrapped, instance, args, kwargs):
        """
        Wraps the 'generate' API call to add telemetry.
        
        This collects metrics such as execution time, cost, and token usage, and handles errors
        gracefully, adding details to the trace for observability.

        Args:
            wrapped: The original 'generate' method to be wrapped.
            instance: The instance of the class where the original method is defined.
            args: Positional arguments for the 'generate' method.
            kwargs: Keyword arguments for the 'generate' method.

        Returns:
            The response from the original 'generate' method.
        """

        # Check if streaming is enabled for the API call
        streaming = kwargs.get("stream", False)

        # pylint: disable=no-else-return
        if streaming:
            # Special handling for streaming response to accommodate the nature of data flow
            def stream_generator():
                with tracer.start_as_current_span(gen_ai_endpoint, kind= SpanKind.CLIENT) as span:
                    # Placeholder for aggregating streaming response
                    llmresponse = ""

                    # Loop through streaming events capturing relevant details
                    for chunk in wrapped(*args, **kwargs):
                        # Collect aggregated response from events
                        content = chunk['response']
                        llmresponse += content

                        if chunk['done'] is True:
                            completion_tokens = chunk["eval_count"]

                        yield chunk

                    # Handling exception ensure observability without disrupting operation
                    try:
                        prompt_tokens = general_tokens(kwargs.get("prompt", ""))
                        total_tokens = prompt_tokens + completion_tokens
                        # Calculate cost of the operation
                        cost = get_chat_model_cost(kwargs.get("model", "llama3"),
                                                pricing_info, prompt_tokens, completion_tokens)

                        # Set Span attributes
                        span.set_attribute(TELEMETRY_SDK_NAME, "openlit")
                        span.set_attribute(SemanticConvetion.GEN_AI_SYSTEM,
                                            SemanticConvetion.GEN_AI_SYSTEM_OLLAMA)
                        span.set_attribute(SemanticConvetion.GEN_AI_TYPE,
                                            SemanticConvetion.GEN_AI_TYPE_CHAT)
                        span.set_attribute(SemanticConvetion.GEN_AI_ENDPOINT,
                                            gen_ai_endpoint)
                        span.set_attribute(SemanticConvetion.GEN_AI_ENVIRONMENT,
                                            environment)
                        span.set_attribute(SemanticConvetion.GEN_AI_APPLICATION_NAME,
                                            application_name)
                        span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_MODEL,
                                            kwargs.get("model", "llama3"))
                        span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_IS_STREAM,
                                            True)
                        span.set_attribute(SemanticConvetion.GEN_AI_USAGE_PROMPT_TOKENS,
                                            prompt_tokens)
                        span.set_attribute(SemanticConvetion.GEN_AI_USAGE_COMPLETION_TOKENS,
                                            completion_tokens)
                        span.set_attribute(SemanticConvetion.GEN_AI_USAGE_TOTAL_TOKENS,
                                            total_tokens)
                        span.set_attribute(SemanticConvetion.GEN_AI_USAGE_COST,
                                            cost)
                        if trace_content:
                            span.add_event(
                                name=SemanticConvetion.GEN_AI_CONTENT_PROMPT_EVENT,
                                attributes={
                                    # pylint: disable=line-too-long
                                    SemanticConvetion.GEN_AI_CONTENT_PROMPT: kwargs.get("prompt", ""),
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
                                    SemanticConvetion.GEN_AI_SYSTEM_OLLAMA,
                                SemanticConvetion.GEN_AI_ENVIRONMENT:
                                    environment,
                                SemanticConvetion.GEN_AI_TYPE:
                                    SemanticConvetion.GEN_AI_TYPE_CHAT,
                                SemanticConvetion.GEN_AI_REQUEST_MODEL:
                                    kwargs.get("model", "llama3")
                            }

                            metrics["genai_requests"].add(1, attributes)
                            metrics["genai_total_tokens"].add(total_tokens, attributes)
                            metrics["genai_completion_tokens"].add(completion_tokens, attributes)
                            metrics["genai_prompt_tokens"].add(prompt_tokens, attributes)
                            metrics["genai_cost"].record(cost, attributes)

                    except Exception as e:
                        handle_exception(span, e)
                        logger.error("Error in trace creation: %s", e)

            return stream_generator()

        # Handling for non-streaming responses
        else:
            # pylint: disable=line-too-long
            with tracer.start_as_current_span(gen_ai_endpoint, kind= SpanKind.CLIENT) as span:
                response = wrapped(*args, **kwargs)

                try:
                    # Set base span attribues
                    span.set_attribute(TELEMETRY_SDK_NAME, "openlit")
                    span.set_attribute(SemanticConvetion.GEN_AI_SYSTEM,
                                        SemanticConvetion.GEN_AI_SYSTEM_OLLAMA)
                    span.set_attribute(SemanticConvetion.GEN_AI_TYPE,
                                        SemanticConvetion.GEN_AI_TYPE_CHAT)
                    span.set_attribute(SemanticConvetion.GEN_AI_ENDPOINT,
                                        gen_ai_endpoint)
                    span.set_attribute(SemanticConvetion.GEN_AI_ENVIRONMENT,
                                        environment)
                    span.set_attribute(SemanticConvetion.GEN_AI_APPLICATION_NAME,
                                        application_name)
                    span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_MODEL,
                                        kwargs.get("model", "llama3"))
                    span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_IS_STREAM,
                                        False)
                    if trace_content:
                        span.add_event(
                            name=SemanticConvetion.GEN_AI_CONTENT_PROMPT_EVENT,
                            attributes={
                                SemanticConvetion.GEN_AI_CONTENT_PROMPT: kwargs.get("prompt", ""),
                            },
                        )
                        span.add_event(
                            name=SemanticConvetion.GEN_AI_CONTENT_COMPLETION_EVENT,
                            attributes={
                                SemanticConvetion.GEN_AI_CONTENT_COMPLETION: response['response'],
                            },
                        )

                    prompt_tokens = response["prompt_eval_count"]
                    completion_tokens = response["eval_count"]
                    total_tokens = prompt_tokens + completion_tokens
                    # Calculate cost of the operation
                    cost = get_chat_model_cost(kwargs.get("model", "llama3"),
                                                pricing_info, prompt_tokens, completion_tokens)

                    span.set_attribute(SemanticConvetion.GEN_AI_USAGE_PROMPT_TOKENS,
                                        prompt_tokens)
                    span.set_attribute(SemanticConvetion.GEN_AI_USAGE_COMPLETION_TOKENS,
                                        completion_tokens)
                    span.set_attribute(SemanticConvetion.GEN_AI_USAGE_TOTAL_TOKENS,
                                        total_tokens)
                    span.set_attribute(SemanticConvetion.GEN_AI_RESPONSE_FINISH_REASON,
                                        [response["done_reason"]])
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
                                SemanticConvetion.GEN_AI_SYSTEM_OLLAMA,
                            SemanticConvetion.GEN_AI_ENVIRONMENT:
                                environment,
                            SemanticConvetion.GEN_AI_TYPE:
                                SemanticConvetion.GEN_AI_TYPE_CHAT,
                            SemanticConvetion.GEN_AI_REQUEST_MODEL:
                                kwargs.get("model", "llama3")
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

def embeddings(gen_ai_endpoint, version, environment, application_name,
               tracer, pricing_info, trace_content, metrics, disable_metrics):
    """
    Generates a telemetry wrapper for embeddings to collect metrics.
    
    Args:
        gen_ai_endpoint: Endpoint identifier for logging and tracing.
        version: Version of the monitoring package.
        environment: Deployment environment (e.g., production, staging).
        application_name: Name of the application using the Ollama API.
        tracer: OpenTelemetry tracer for creating spans.
        pricing_info: Information used for calculating the cost of Ollama usage.
        trace_content: Flag indicating whether to trace the actual content.
    
    Returns:
        A function that wraps the embeddings method to add telemetry.
    """

    def wrapper(wrapped, instance, args, kwargs):
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
            response = wrapped(*args, **kwargs)

            try:
                prompt_tokens = general_tokens(kwargs.get('prompt', ""))
                # Calculate cost of the operation
                cost = get_embed_model_cost(kwargs.get('model', "mistral-embed"),
                                            pricing_info, prompt_tokens)
                # Set Span attributes
                span.set_attribute(TELEMETRY_SDK_NAME, "openlit")
                span.set_attribute(SemanticConvetion.GEN_AI_SYSTEM,
                                    SemanticConvetion.GEN_AI_SYSTEM_OLLAMA)
                span.set_attribute(SemanticConvetion.GEN_AI_TYPE,
                                    SemanticConvetion.GEN_AI_TYPE_EMBEDDING)
                span.set_attribute(SemanticConvetion.GEN_AI_ENDPOINT,
                                    gen_ai_endpoint)
                span.set_attribute(SemanticConvetion.GEN_AI_ENVIRONMENT,
                                    environment)
                span.set_attribute(SemanticConvetion.GEN_AI_APPLICATION_NAME,
                                    application_name)
                span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_MODEL,
                                    kwargs.get('model', "llama3"))
                span.set_attribute(SemanticConvetion.GEN_AI_USAGE_PROMPT_TOKENS,
                                    prompt_tokens)
                span.set_attribute(SemanticConvetion.GEN_AI_USAGE_TOTAL_TOKENS,
                                    prompt_tokens)
                span.set_attribute(SemanticConvetion.GEN_AI_USAGE_COST,
                                    cost)
                if trace_content:
                    span.add_event(
                        name=SemanticConvetion.GEN_AI_CONTENT_PROMPT_EVENT,
                        attributes={
                            SemanticConvetion.GEN_AI_CONTENT_PROMPT: kwargs.get("prompt", ""),
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
                            SemanticConvetion.GEN_AI_SYSTEM_OLLAMA,
                        SemanticConvetion.GEN_AI_ENVIRONMENT:
                            environment,
                        SemanticConvetion.GEN_AI_TYPE:
                            SemanticConvetion.GEN_AI_TYPE_EMBEDDING,
                        SemanticConvetion.GEN_AI_REQUEST_MODEL:
                            kwargs.get('model', "llama3")
                    }

                    metrics["genai_requests"].add(1, attributes)
                    metrics["genai_total_tokens"].add(prompt_tokens, attributes)
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
