# pylint: disable=duplicate-code, broad-exception-caught, too-many-statements, unused-argument, too-many-branches
"""
Module for monitoring Azure OpenAI API calls.
"""

import time
import logging
from opentelemetry.trace import SpanKind
from ..__helpers import get_chat_model_cost, get_embed_model_cost
from ..__helpers import get_image_model_cost, openai_tokens, handle_exception

# Initialize logger for logging potential issues and operations
logger = logging.getLogger(__name__)

def azure_async_chat_completions(gen_ai_endpoint, version, environment, application_name,
                                 tracer, pricing_info, trace_content):
    """
    Generates a telemetry wrapper for chat completions to collect metrics.

    Args:
        gen_ai_endpoint: Endpoint identifier for logging and tracing.
        version: Version of the monitoring package.
        environment: Deployment environment (e.g., production, staging).
        application_name: Name of the application using the OpenAI API.
        tracer: OpenTelemetry tracer for creating spans.
        pricing_info: Information used for calculating the cost of OpenAI usage.
        trace_content: Flag indicating whether to trace the actual content.

    Returns:
        A function that wraps the chat completions method to add telemetry.
    """

    async def wrapper(wrapped, instance, args, kwargs):
        """
        Wraps the 'chat.completions' API call to add telemetry.
        
        This collects metrics such as execution time, cost, and token usage, and handles errors
        gracefully, adding details to the trace for observability.

        Args:
            wrapped: The original 'chat.completions' method to be wrapped.
            instance: The instance of the class where the original method is defined.
            args: Positional arguments for the 'chat.completions' method.
            kwargs: Keyword arguments for the 'chat.completions' method.

        Returns:
            The response from the original 'chat.completions' method.
        """

        # Check if streaming is enabled for the API call
        start_time = time.time()
        # Record start time for measuring request duration
        streaming = kwargs.get("stream", False)

        # pylint: disable=no-else-return
        if streaming:
            # Special handling for streaming response to accommodate the nature of data flow
            async def stream_generator():
                # pylint: disable=line-too-long
                with tracer.start_as_current_span(gen_ai_endpoint, kind= SpanKind.CLIENT) as span:
                    # Placeholder for aggregating streaming response
                    llmresponse = ""

                    try:
                        # Loop through streaming events capturing relevant details
                        async for chunk in await wrapped(*args, **kwargs):
                            # Collect message IDs and aggregated response from events
                            # pylint: disable=line-too-long
                            if len(chunk.choices) > 0:
                                if hasattr(chunk.choices[0], "delta") and hasattr(chunk.choices[0].delta, "content"):
                                    content = chunk.choices[0].delta.content
                                    if content:
                                        llmresponse += content
                            yield chunk
                            response_id = chunk.id
                            model = "azure_" + chunk.model

                        # Handling exception ensure observability without disrupting operation
                        try:
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

                            # Calculate tokens using input prompt and aggregated response
                            prompt_tokens = openai_tokens(prompt,
                                                          kwargs.get("model", "gpt-3.5-turbo"))
                            completion_tokens = openai_tokens(llmresponse,
                                                              kwargs.get("model", "gpt-3.5-turbo"))

                            # Calculate cost of the operation
                            cost = get_chat_model_cost(model, pricing_info,
                                                        prompt_tokens, completion_tokens)

                            # Set Span attributes
                            span.set_attribute("gen_ai.system", "Azuure.OpenAI")
                            span.set_attribute("gen_ai.type", "chat")
                            span.set_attribute("gen_ai.endpoint", gen_ai_endpoint)
                            span.set_attribute("gen_ai.response.id", response_id)
                            span.set_attribute("gen_ai.environment", environment)
                            span.set_attribute("gen_ai.application_name", application_name)
                            span.set_attribute("gen_ai.request_duration", duration)
                            span.set_attribute("gen_ai.request.model", model)
                            span.set_attribute("gen_ai.request.user",
                                                kwargs.get("user", ""))
                            span.set_attribute("gen_ai.request.tool_choice",
                                                kwargs.get("tool_choice", ""))
                            span.set_attribute("gen_ai.request.temperature",
                                                kwargs.get("temperature", 1))
                            span.set_attribute("gen_ai.request.presence_penalty",
                                                kwargs.get("presence_penalty", 0))
                            span.set_attribute("gen_ai.request.frequency_penalty",
                                                kwargs.get("frequency_penalty", 0))
                            span.set_attribute("gen_ai.request.seed",
                                                kwargs.get("seed", ""))
                            span.set_attribute("gen_ai.request.is_stream", True)
                            span.set_attribute("gen_ai.usage.prompt_tokens", prompt_tokens)
                            span.set_attribute("gen_ai.usage.completion_tokens", completion_tokens)
                            span.set_attribute("gen_ai.usage.total_tokens",
                                                prompt_tokens + completion_tokens)
                            span.set_attribute("gen_ai.usage.cost", cost)
                            if trace_content:
                                span.set_attribute("gen_ai.content.prompt", prompt)
                                span.set_attribute("gen_ai.content.completion", llmresponse)

                        except Exception as e:
                            handle_exception(span, e)
                            logger.error("Error in patched message creation: %s", e)

                    except Exception as e:
                        handle_exception(span, e)
                        raise e

            return stream_generator()

        # Handling for non-streaming responses
        else:
            # pylint: disable=line-too-long
            with tracer.start_as_current_span(gen_ai_endpoint, kind= SpanKind.CLIENT) as span:
                try:
                    response = await wrapped(*args, **kwargs)
                    end_time = time.time()

                    try:
                        # Calculate total duration of operation
                        duration = end_time - start_time

                        # Find base model from response
                        model = "azure_" + response.model

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
                        span.set_attribute("gen_ai.system", "OpenAI")
                        span.set_attribute("gen_ai.type", "chat")
                        span.set_attribute("gen_ai.endpoint", gen_ai_endpoint)
                        span.set_attribute("gen_ai.response.id", response.id)
                        span.set_attribute("gen_ai.environment", environment)
                        span.set_attribute("gen_ai.application_name", application_name)
                        span.set_attribute("gen_ai.request_duration", duration)
                        span.set_attribute("gen_ai.request.model", model)
                        span.set_attribute("gen_ai.request.user",
                                            kwargs.get("user", ""))
                        span.set_attribute("gen_ai.request.tool_choice",
                                            kwargs.get("tool_choice", ""))
                        span.set_attribute("gen_ai.request.temperature",
                                            kwargs.get("temperature", 1))
                        span.set_attribute("gen_ai.request.presence_penalty",
                                            kwargs.get("presence_penalty", 0))
                        span.set_attribute("gen_ai.request.frequency_penalty",
                                            kwargs.get("frequency_penalty", 0))
                        span.set_attribute("gen_ai.request.seed",
                                            kwargs.get("seed", ""))
                        span.set_attribute("gen_ai.request.is_stream", False)
                        if trace_content:
                            span.set_attribute("gen_ai.content.prompt", prompt)

                        # Set span attributes when tools is not passed to the function call
                        if "tools" not in kwargs:
                            # Calculate cost of the operation
                            cost = get_chat_model_cost(model, pricing_info,
                                                        response.usage.prompt_tokens,
                                                        response.usage.completion_tokens)

                            span.set_attribute("gen_ai.usage.prompt_tokens",
                                                response.usage.prompt_tokens)
                            span.set_attribute("gen_ai.usage.completion_tokens",
                                                response.usage.completion_tokens)
                            span.set_attribute("gen_ai.usage.total_tokens",
                                                response.usage.total_tokens)
                            span.set_attribute("gen_ai.response.finish_reason",
                                                response.choices[0].finish_reason)
                            span.set_attribute("gen_ai.usage.cost", cost)

                            # Set span attributes for when n = 1 (default)
                            if "n" not in kwargs or kwargs["n"] == 1:
                                if trace_content:
                                    span.set_attribute("gen_ai.content.completion",
                                                        response.choices[0].message.content)

                            # Set span attributes for when n > 0
                            else:
                                i = 0
                                while i < kwargs["n"] and trace_content is True:
                                    attribute_name = f"gen_ai.content.completion.{i}"
                                    span.set_attribute(attribute_name,
                                                        response.choices[i].message.content)
                                    i += 1

                                # Return original response
                                return response

                        # Set span attributes when tools is passed to the function call
                        elif "tools" in kwargs:
                            # Calculate cost of the operation
                            cost = get_chat_model_cost(model, pricing_info,
                                                        response.usage.prompt_tokens,
                                                        response.usage.completion_tokens)

                            span.set_attribute("gen_ai.content.completion",
                                                "Function called with tools")
                            span.set_attribute("gen_ai.usage.prompt_tokens",
                                                response.usage.prompt_tokens)
                            span.set_attribute("gen_ai.usage.completion_tokens",
                                                response.usage.completion_tokens)
                            span.set_attribute("gen_ai.usage.total_tokens",
                                                response.usage.total_tokens)
                            span.set_attribute("gen_ai.usage.cost", cost)

                        # Return original response
                        return response

                    except Exception as e:
                        handle_exception(span, e)
                        logger.error("Error in patched message creation: %s", e)

                        # Return original response
                        return response

                except Exception as e:
                    handle_exception(span, e)
                    raise e

    return wrapper

def azure_async_completions(gen_ai_endpoint, version, environment, application_name,
                            tracer, pricing_info, trace_content):
    """
    Generates a telemetry wrapper for completions to collect metrics.

    Args:
        gen_ai_endpoint: Endpoint identifier for logging and tracing.
        version: Version of the monitoring package.
        environment: Deployment environment (e.g., production, staging).
        application_name: Name of the application using the OpenAI API.
        tracer: OpenTelemetry tracer for creating spans.
        pricing_info: Information used for calculating the cost of OpenAI usage.
        trace_content: Flag indicating whether to trace the actual content.

    Returns:
        A function that wraps the chat completions method to add telemetry.
    """

    async def wrapper(wrapped, instance, args, kwargs):
        """
        Wraps the 'completions' API call to add telemetry.
        
        This collects metrics such as execution time, cost, and token usage, and handles errors
        gracefully, adding details to the trace for observability.

        Args:
            wrapped: The original 'completions' method to be wrapped.
            instance: The instance of the class where the original method is defined.
            args: Positional arguments for the 'completions' method.
            kwargs: Keyword arguments for the 'completions' method.

        Returns:
            The response from the original 'chat.completions' method.
        """

        # Check if streaming is enabled for the API call
        start_time = time.time()
        # Record start time for measuring request duration
        streaming = kwargs.get("stream", False)

        # pylint: disable=no-else-return
        if streaming:
            # Special handling for streaming response to accommodate the nature of data flow
            async def stream_generator():
                # pylint: disable=line-too-long
                with tracer.start_as_current_span(gen_ai_endpoint, kind= SpanKind.CLIENT) as span:
                    # Placeholder for aggregating streaming response
                    llmresponse = ""

                    try:
                        # Loop through streaming events capturing relevant details
                        async for chunk in await wrapped(*args, **kwargs):
                            # Collect message IDs and aggregated response from events
                            if len(chunk.choices) > 0:
                                if hasattr(chunk.choices[0], "text"):
                                    content = chunk.choices[0].text
                                    if content:
                                        llmresponse += content
                            yield chunk
                            response_id = chunk.id
                            model = "azure_" + chunk.model

                        # Handling exception ensure observability without disrupting operation
                        try:
                            end_time = time.time()
                            # Calculate total duration of operation
                            duration = end_time - start_time
                            prompt = kwargs.get("prompt", "")

                            # Calculate tokens using input prompt and aggregated response
                            prompt_tokens = openai_tokens(prompt, "gpt-3.5-turbo")
                            completion_tokens = openai_tokens(llmresponse, "gpt-3.5-turbo")

                            # Calculate cost of the operation
                            cost = get_chat_model_cost(model, pricing_info,
                                                        prompt_tokens, completion_tokens)

                            # Set Span attributes
                            span.set_attribute("gen_ai.system", "azure_openai")
                            span.set_attribute("gen_ai.type", "chat")
                            span.set_attribute("gen_ai.endpoint", gen_ai_endpoint)
                            span.set_attribute("gen_ai.response.id", response_id)
                            span.set_attribute("gen_ai.environment", environment)
                            span.set_attribute("gen_ai.application_name", application_name)
                            span.set_attribute("gen_ai.request_duration", duration)
                            span.set_attribute("gen_ai.request.model", model)
                            span.set_attribute("gen_ai.request.user",
                                                kwargs.get("user", ""))
                            span.set_attribute("gen_ai.request.tool_choice",
                                                kwargs.get("tool_choice", ""))
                            span.set_attribute("gen_ai.request.temperature",
                                                kwargs.get("temperature", 1))
                            span.set_attribute("gen_ai.request.presence_penalty",
                                                kwargs.get("presence_penalty", 0))
                            span.set_attribute("gen_ai.request.frequency_penalty",
                                                kwargs.get("frequency_penalty", 0))
                            span.set_attribute("gen_ai.request.seed",
                                                kwargs.get("seed", ""))
                            span.set_attribute("gen_ai.request.is_stream", True)
                            span.set_attribute("gen_ai.usage.prompt_tokens", prompt_tokens)
                            span.set_attribute("gen_ai.usage.completion_tokens", completion_tokens)
                            span.set_attribute("gen_ai.usage.total_tokens",
                                                prompt_tokens + completion_tokens)
                            span.set_attribute("gen_ai.usage.cost", cost)
                            if trace_content:
                                span.set_attribute("gen_ai.content.prompt", prompt)
                                span.set_attribute("gen_ai.content.completion", llmresponse)

                        except Exception as e:
                            handle_exception(span, e)
                            logger.error("Error in patched message creation: %s", e)

                    except Exception as e:
                        handle_exception(span, e)
                        raise e

            return stream_generator()

        # Handling for non-streaming responses
        else:
            # pylint: disable=line-too-long
            with tracer.start_as_current_span(gen_ai_endpoint, kind= SpanKind.CLIENT) as span:
                try:
                    response = wrapped(*args, **kwargs)
                    end_time = time.time()

                    try:
                        # Calculate total duration of operation
                        duration = end_time - start_time

                        # Find base model from response
                        model = "azure_" + response.model

                        # Set base span attribues
                        span.set_attribute("gen_ai.system", "azure_openai")
                        span.set_attribute("gen_ai.type", "chat")
                        span.set_attribute("gen_ai.endpoint", gen_ai_endpoint)
                        span.set_attribute("gen_ai.response.id", response.id)
                        span.set_attribute("gen_ai.environment", environment)
                        span.set_attribute("gen_ai.application_name", application_name)
                        span.set_attribute("gen_ai.request_duration", duration)
                        span.set_attribute("gen_ai.request.model",
                                            kwargs.get("model", "gpt-3.5-turbo"))
                        span.set_attribute("gen_ai.request.user",
                                            kwargs.get("user", ""))
                        span.set_attribute("gen_ai.request.tool_choice",
                                            kwargs.get("tool_choice", ""))
                        span.set_attribute("gen_ai.request.temperature",
                                            kwargs.get("temperature", 1))
                        span.set_attribute("gen_ai.request.presence_penalty",
                                            kwargs.get("presence_penalty", 0))
                        span.set_attribute("gen_ai.request.frequency_penalty",
                                            kwargs.get("frequency_penalty", 0))
                        span.set_attribute("gen_ai.request.seed",
                                            kwargs.get("seed", ""))
                        span.set_attribute("gen_ai.request.is_stream", False)
                        if trace_content:
                            span.set_attribute("gen_ai.content.prompt",
                                                kwargs.get("prompt", ""))

                        # Set span attributes when tools is not passed to the function call
                        if "tools" not in kwargs:
                            # Calculate cost of the operation
                            cost = get_chat_model_cost(model, pricing_info,
                                                        response.usage.prompt_tokens,
                                                        response.usage.completion_tokens)

                            span.set_attribute("gen_ai.usage.prompt_tokens",
                                                response.usage.prompt_tokens)
                            span.set_attribute("gen_ai.usage.completion_tokens",
                                                response.usage.completion_tokens)
                            span.set_attribute("gen_ai.usage.total_tokens",
                                                response.usage.total_tokens)
                            span.set_attribute("gen_ai.response.finish_reason",
                                                response.choices[0].finish_reason)
                            span.set_attribute("gen_ai.usage.cost", cost)

                            # Set span attributes for when n = 1 (default)
                            if "n" not in kwargs or kwargs["n"] == 1:
                                if trace_content:
                                    span.set_attribute("gen_ai.content.completion",
                                                        response.choices[0].text)

                            # Set span attributes for when n > 0
                            else:
                                i = 0
                                while i < kwargs["n"] and trace_content is True:
                                    attribute_name = f"gen_ai.content.completion.{i}"
                                    span.set_attribute(attribute_name, response.choices[i].text)
                                    i += 1
                                return response

                        # Set span attributes when tools is passed to the function call
                        elif "tools" in kwargs:
                            # Calculate cost of the operation
                            cost = get_chat_model_cost(model, pricing_info,
                                                        response.usage.prompt_tokens,
                                                        response.usage.completion_tokens)

                            span.set_attribute("gen_ai.content.completion",
                                                "Function called with tools")
                            span.set_attribute("gen_ai.usage.prompt_tokens",
                                                response.usage.prompt_tokens)
                            span.set_attribute("gen_ai.usage.completion_tokens",
                                                response.usage.completion_tokens)
                            span.set_attribute("gen_ai.usage.total_tokens",
                                                response.usage.total_tokens)
                            span.set_attribute("gen_ai.usage.cost", cost)

                        # Return original response
                        return response

                    except Exception as e:
                        handle_exception(span, e)
                        logger.error("Error in patched message creation: %s", e)

                        # Return original response
                        return response

                except Exception as e:
                    handle_exception(span, e)
                    raise e

    return wrapper

def azure_async_embedding(gen_ai_endpoint, version, environment, application_name,
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
            # Sections handling exceptions ensure observability without disrupting operations
            try:
                start_time = time.time()
                response = await wrapped(*args, **kwargs)
                end_time = time.time()

                try:
                    # Calculate total duration of operation
                    duration = end_time - start_time

                    # Calculate cost of the operation
                    cost = get_embed_model_cost("azure_" + response.model,
                                                 pricing_info, response.usage.prompt_tokens)

                    # Set Span attributes
                    span.set_attribute("gen_ai.system", "azure_openai")
                    span.set_attribute("gen_ai.type", "embedding")
                    span.set_attribute("gen_ai.endpoint", gen_ai_endpoint)
                    span.set_attribute("gen_ai.environment", environment)
                    span.set_attribute("gen_ai.application_name", application_name)
                    span.set_attribute("gen_ai.request_duration", duration)
                    span.set_attribute("gen_ai.request.model", "azure_" + response.model)
                    span.set_attribute("gen_ai.request.embedding_format",
                                        kwargs.get("encoding_format", "float"))
                    span.set_attribute("gen_ai.request.embedding_dimension",
                                        kwargs.get("dimensions", ""))
                    span.set_attribute("gen_ai.request.user",
                                        kwargs.get("user", ""))
                    span.set_attribute("gen_ai.usage.prompt_tokens",
                                        response.usage.prompt_tokens)
                    span.set_attribute("gen_ai.usage.total_tokens",
                                        response.usage.total_tokens)
                    span.set_attribute("gen_ai.usage.cost", cost)
                    if trace_content:
                        span.set_attribute("gen_ai.content.prompt", kwargs.get("input", ""))

                    # Return original response
                    return response

                except Exception as e:
                    handle_exception(span, e)
                    logger.error("Error in patched message creation: %s", e)

                    # Return original response
                    return response

            except Exception as e:
                handle_exception(span, e)
                raise e

    return wrapper

def azure_async_image_generate(gen_ai_endpoint, version, environment, application_name,
                               tracer, pricing_info, trace_content):
    """
    Generates a telemetry wrapper for image generation to collect metrics.
    
    Args:
        gen_ai_endpoint: Endpoint identifier for logging and tracing.
        version: Version of the monitoring package.
        environment: Deployment environment (e.g., production, staging).
        application_name: Name of the application using the OpenAI API.
        tracer: OpenTelemetry tracer for creating spans.
        pricing_info: Information used for calculating the cost of OpenAI image generation.
        trace_content: Flag indicating whether to trace the input prompt and generated images.
    
    Returns:
        A function that wraps the image generation method to add telemetry.
    """

    async def wrapper(wrapped, instance, args, kwargs):
        """
        Wraps the 'images.generate' API call to add telemetry.

        This collects metrics such as execution time, cost, and handles errors
        gracefully, adding details to the trace for observability.

        Args:
            wrapped: The original 'images.generate' method to be wrapped.
            instance: The instance of the class where the original method is defined.
            args: Positional arguments for the 'images.generate' method.
            kwargs: Keyword arguments for the 'images.generate' method.

        Returns:
            The response from the original 'images.generate' method.
        """

        with tracer.start_as_current_span(gen_ai_endpoint, kind= SpanKind.CLIENT) as span:
            # Sections handling exceptions ensure observability without disrupting operations
            try:
                start_time = time.time()
                response = await wrapped(*args, **kwargs)
                end_time = time.time()
                images_count = 0

                try:
                    # Calculate total duration of operation
                    duration = end_time - start_time

                    # Find Image format
                    if "response_format" in kwargs and kwargs["response_format"] == "b64_json":
                        image = "b64_json"
                    else:
                        image = "url"

                    # Calculate cost of the operation
                    cost = get_image_model_cost("azure_" + kwargs.get("model", "dall-e-3"),
                                                pricing_info, kwargs.get("size", "1024x1024"),
                                                kwargs.get("quality", "standard"))

                    for items in response.data:
                        # Set Span attributes
                        span.set_attribute("gen_ai.system", "azure_openai")
                        span.set_attribute("gen_ai.type", "image")
                        span.set_attribute("gen_ai.endpoint", gen_ai_endpoint)
                        span.set_attribute("gen_ai.response.id", response.created)
                        span.set_attribute("gen_ai.environment", environment)
                        span.set_attribute("gen_ai.application_name", application_name)
                        span.set_attribute("gen_ai.request_duration", duration)
                        span.set_attribute("gen_ai.request.model",
                                            "azure_" + kwargs.get("model", "dall-e-3"))
                        span.set_attribute("gen_ai.request.image_size",
                                            kwargs.get("size", "1024x1024"))
                        span.set_attribute("gen_ai.request.image_quality",
                                            kwargs.get("quality", "standard"))
                        span.set_attribute("gen_ai.request.image_style",
                                            kwargs.get("style", "vivid"))
                        span.set_attribute("gen_ai.content.revised_prompt",
                                            items.revised_prompt if response.revised_prompt else "")
                        span.set_attribute("gen_ai.request.user", kwargs.get("user", ""))
                        if trace_content:
                            span.set_attribute("gen_ai.content.prompt", kwargs.get("prompt", ""))

                            attribute_name = f"gen_ai.response.image.{images_count}"
                            span.set_attribute(attribute_name, getattr(items, image))

                        images_count+=1

                    span.set_attribute("gen_ai.usage.cost", len(response.data) * cost)

                    # Return original response
                    return response

                except Exception as e:
                    handle_exception(span, e)
                    logger.error("Error in patched message creation: %s", e)

                    # Return original response
                    return response

            except Exception as e:
                handle_exception(span, e)
                raise e

    return wrapper
