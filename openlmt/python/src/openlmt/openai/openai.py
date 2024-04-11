# pylint: disable=duplicate-code, broad-exception-caught, too-many-statements, unused-argument, too-many-branches
"""
Module for monitoring OpenAI API calls.
"""

import logging
from opentelemetry.trace import SpanKind
from ..__helpers import get_chat_model_cost, get_embed_model_cost, get_audio_model_cost
from ..__helpers import get_image_model_cost, openai_tokens, handle_exception

# Initialize logger for logging potential issues and operations
logger = logging.getLogger(__name__)

def chat_completions(gen_ai_endpoint, version, environment, application_name,
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

    def wrapper(wrapped, instance, args, kwargs):
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
        streaming = kwargs.get("stream", False)

        # pylint: disable=no-else-return
        if streaming:
            # Special handling for streaming response to accommodate the nature of data flow
            def stream_generator():
                with tracer.start_as_current_span(gen_ai_endpoint, kind= SpanKind.CLIENT) as span:
                    # Placeholder for aggregating streaming response
                    llmresponse = ""

                    try:
                        # Loop through streaming events capturing relevant details
                        for chunk in wrapped(*args, **kwargs):
                            # Collect message IDs and aggregated response from events
                            if len(chunk.choices) > 0:
                                # pylint: disable=line-too-long
                                if hasattr(chunk.choices[0], "delta") and hasattr(chunk.choices[0].delta, "content"):
                                    content = chunk.choices[0].delta.content
                                    if content:
                                        llmresponse += content
                            yield chunk
                            response_id = chunk.id

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

                            # Calculate tokens using input prompt and aggregated response
                            prompt_tokens = openai_tokens(prompt,
                                                          kwargs.get("model", "gpt-3.5-turbo"))
                            completion_tokens = openai_tokens(llmresponse,
                                                              kwargs.get("model", "gpt-3.5-turbo"))

                            # Calculate cost of the operation
                            cost = get_chat_model_cost(kwargs.get("model", "gpt-3.5-turbo"),
                                                       pricing_info, prompt_tokens,
                                                       completion_tokens)

                            # Set Span attributes
                            span.set_attribute("gen_ai.system", "openai")
                            span.set_attribute("gen_ai.type", "chat")
                            span.set_attribute("gen_ai.endpoint", gen_ai_endpoint)
                            span.set_attribute("gen_ai.response.id", response_id)
                            span.set_attribute("gen_ai.environment", environment)
                            span.set_attribute("gen_ai.application_name", application_name)
                            span.set_attribute("gen_ai.request.model",
                                                kwargs.get("model", "gpt-3.5-turbo"))
                            span.set_attribute("gen_ai.request.user",
                                                kwargs.get("user", ""))
                            span.set_attribute("gen_ai.request.top_p",
                                                kwargs.get("top_p", 1))
                            span.set_attribute("gen_ai.request.max_tokens",
                                                kwargs.get("max_tokens", ""))
                            span.set_attribute("gen_ai.request.temperature",
                                                kwargs.get("temperature", 1))
                            span.set_attribute("gen_ai.request.presence_penalty",
                                                kwargs.get("presence_penalty", 0))
                            span.set_attribute("gen_ai.request.frequency_penalty",
                                                kwargs.get("frequency_penalty", 0))
                            span.set_attribute("gen_ai.request.seed", kwargs.get("seed", ""))
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
                        span.set_attribute("gen_ai.system", "openai")
                        span.set_attribute("gen_ai.type", "chat")
                        span.set_attribute("gen_ai.endpoint", gen_ai_endpoint)
                        span.set_attribute("gen_ai.response.id", response.id)
                        span.set_attribute("gen_ai.environment", environment)
                        span.set_attribute("gen_ai.application_name", application_name)
                        span.set_attribute("gen_ai.request.model",
                                            kwargs.get("model", "gpt-3.5-turbo"))
                        span.set_attribute("gen_ai.request.top_p",
                                            kwargs.get("top_p", 1))
                        span.set_attribute("gen_ai.request.max_tokens",
                                            kwargs.get("max_tokens", ""))
                        span.set_attribute("gen_ai.request.user",
                                            kwargs.get("user", ""))
                        span.set_attribute("gen_ai.request.temperature",
                                            kwargs.get("temperature", 1))
                        span.set_attribute("gen_ai.request.presence_penalty",
                                            kwargs.get("presence_penalty", 0))
                        span.set_attribute("gen_ai.request.frequency_penalty",
                                            kwargs.get("frequency_penalty", 0))
                        span.set_attribute("gen_ai.request.seed", kwargs.get("seed", ""))
                        span.set_attribute("gen_ai.request.is_stream", False)
                        if trace_content:
                            span.set_attribute("gen_ai.content.prompt", prompt)

                        # Set span attributes when tools is not passed to the function call
                        if "tools" not in kwargs:
                            # Calculate cost of the operation
                            cost = get_chat_model_cost(kwargs.get("model", "gpt-3.5-turbo"),
                                                        pricing_info, response.usage.prompt_tokens,
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
                            cost = get_chat_model_cost(kwargs.get("model", "gpt-3.5-turbo"),
                                                        pricing_info, response.usage.prompt_tokens,
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

def embedding(gen_ai_endpoint, version, environment, application_name,
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
            # Handling exception ensure observability without disrupting operation
            try:
                response = wrapped(*args, **kwargs)

                try:
                    # Calculate cost of the operation
                    cost = get_embed_model_cost(kwargs.get("model", "text-embedding-ada-002"),
                                                pricing_info, response.usage.prompt_tokens)

                    # Set Span attributes
                    span.set_attribute("gen_ai.system", "openai")
                    span.set_attribute("gen_ai.type", "embedding")
                    span.set_attribute("gen_ai.endpoint", gen_ai_endpoint)
                    span.set_attribute("gen_ai.environment", environment)
                    span.set_attribute("gen_ai.application_name", application_name)
                    span.set_attribute("gen_ai.request.model",
                                        kwargs.get("model", "text-embedding-ada-002"))
                    span.set_attribute("gen_ai.request.embedding_format",
                                        kwargs.get("encoding_format", "float"))
                    span.set_attribute("gen_ai.request.embedding_dimension",
                                        kwargs.get("dimensions", ""))
                    span.set_attribute("gen_ai.request.user", kwargs.get("user", ""))
                    span.set_attribute("gen_ai.usage.prompt_tokens", response.usage.prompt_tokens)
                    span.set_attribute("gen_ai.usage.total_tokens", response.usage.total_tokens)
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

def finetune(gen_ai_endpoint, version, environment, application_name,
             tracer, pricing_info, trace_content):
    """
    Generates a telemetry wrapper for fine-tuning jobs to collect metrics.
    
    Args:
        gen_ai_endpoint: Endpoint identifier for logging and tracing.
        version: Version of the monitoring package.
        environment: Deployment environment (e.g., production, staging).
        application_name: Name of the application using the OpenAI API.
        tracer: OpenTelemetry tracer for creating spans.
        pricing_info: Information used for calculating the cost of OpenAI usage.
        trace_content: Flag indicating whether to trace the actual content.
    
    Returns:
        A function that wraps the fine tuning creation method to add telemetry.
    """

    def wrapper(wrapped, instance, args, kwargs):
        """
        Wraps the 'fine_tuning.jobs.create' API call to add telemetry.

        This collects metrics such as execution time, usage stats, and handles errors
        gracefully, adding details to the trace for observability.

        Args:
            wrapped: The original 'fine_tuning.jobs.create' method to be wrapped.
            instance: The instance of the class where the original method is defined.
            args: Positional arguments for the method.
            kwargs: Keyword arguments for the method.

        Returns:
            The response from the original 'fine_tuning.jobs.create' method.
        """

        with tracer.start_as_current_span(gen_ai_endpoint, kind= SpanKind.CLIENT) as span:
            # Handling exception ensure observability without disrupting operation
            try:
                response = wrapped(*args, **kwargs)

                try:
                    # Set Span attributes
                    span.set_attribute("gen_ai.system", "openai")
                    span.set_attribute("gen_ai.type", "fine_tuning")
                    span.set_attribute("gen_ai.endpoint", gen_ai_endpoint)
                    span.set_attribute("gen_ai.environment", environment)
                    span.set_attribute("gen_ai.application_name", application_name)
                    span.set_attribute("gen_ai.request.model",
                                        kwargs.get("model", "gpt-3.5-turbo"))
                    span.set_attribute("gen_ai.request.training_file",
                                        kwargs.get("training_file", ""))
                    span.set_attribute("gen_ai.request.validation_file",
                                        kwargs.get("validation_file", ""))
                    span.set_attribute("gen_ai.request.fine_tune_batch_size",
                                        kwargs.get("hyperparameters.batch_size", "auto"))
                    span.set_attribute("gen_ai.request.learning_rate_multiplier",
                                        kwargs.get("hyperparameters.learning_rate_multiplier",
                                                    "auto"))
                    span.set_attribute("gen_ai.request.fine_tune_n_epochs",
                                        kwargs.get("hyperparameters.n_epochs", "auto"))
                    span.set_attribute("gen_ai.request.fine_tune_model_suffix",
                                        kwargs.get("suffix", ""))
                    span.set_attribute("gen_ai.response.id", response.id)
                    span.set_attribute("gen_ai.usage.prompt_tokens", response.usage.prompt_tokens)
                    span.set_attribute("gen_ai.request.fine_tune_status", response.status)

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

def image_generate(gen_ai_endpoint, version, environment, application_name,
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

    def wrapper(wrapped, instance, args, kwargs):
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
            # Handling exception ensure observability without disrupting operation
            try:
                response = wrapped(*args, **kwargs)
                images_count = 0

                try:
                    # Find Image format
                    if "response_format" in kwargs and kwargs["response_format"] == "b64_json":
                        image = "b64_json"
                    else:
                        image = "url"

                    # Calculate cost of the operation
                    cost = get_image_model_cost(kwargs.get("model", "dall-e-2"),
                                                pricing_info, kwargs.get("size", "1024x1024"),
                                                kwargs.get("quality", "standard"))

                    for items in response.data:
                        # Set Span attributes
                        span.set_attribute("gen_ai.system", "openai")
                        span.set_attribute("gen_ai.type", "image")
                        span.set_attribute("gen_ai.endpoint", gen_ai_endpoint)
                        span.set_attribute("gen_ai.response.id", response.created)
                        span.set_attribute("gen_ai.environment", environment)
                        span.set_attribute("gen_ai.application_name", application_name)
                        span.set_attribute("gen_ai.request.model",
                                            kwargs.get("model", "dall-e-2"))
                        span.set_attribute("gen_ai.request.image_size",
                                            kwargs.get("size", "1024x1024"))
                        span.set_attribute("gen_ai.request.image_quality",
                                            kwargs.get("quality", "standard"))
                        span.set_attribute("gen_ai.request.image_style",
                                            kwargs.get("style", "vivid"))
                        span.set_attribute("gen_ai.content.revised_prompt",
                                            items.revised_prompt if items.revised_prompt else "")
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

def image_variatons(gen_ai_endpoint, version, environment, application_name,
                    tracer, pricing_info, trace_content):
    """
    Generates a telemetry wrapper for creating image variations to collect metrics.
    
    Args:
        gen_ai_endpoint: Endpoint identifier for logging and tracing.
        version: Version of the monitoring package.
        environment: Deployment environment (e.g., production, staging).
        application_name: Name of the application using the OpenAI API.
        tracer: OpenTelemetry tracer for creating spans.
        pricing_info: Information used for calculating the cost of generating image variations.
        trace_content: Flag indicating whether to trace the input image and generated variations.
    
    Returns:
        A function that wraps the image variations creation method to add telemetry.
    """

    def wrapper(wrapped, instance, args, kwargs):
        """
        Wraps the 'images.create.variations' API call to add telemetry.

        This collects metrics such as execution time, cost, and handles errors
        gracefully, adding details to the trace for observability.

        Args:
            wrapped: The original 'images.create.variations' method to be wrapped.
            instance: The instance of the class where the original method is defined.
            args: Positional arguments for the method.
            kwargs: Keyword arguments for the method.

        Returns:
            The response from the original 'images.create.variations' method.
        """

        with tracer.start_as_current_span(gen_ai_endpoint, kind= SpanKind.CLIENT) as span:
            # Handling exception ensure observability without disrupting operation
            try:
                response = wrapped(*args, **kwargs)
                images_count = 0

                try:
                    # Find Image format
                    if "response_format" in kwargs and kwargs["response_format"] == "b64_json":
                        image = "b64_json"
                    else:
                        image = "url"

                    # Calculate cost of the operation
                    cost = get_image_model_cost(kwargs.get("model", "dall-e-2"), pricing_info,
                                                kwargs.get("size", "1024x1024"), "standard")

                    for items in response.data:
                        # Set Span attributes
                        span.set_attribute("gen_ai.system", "openai")
                        span.set_attribute("gen_ai.type", "image")
                        span.set_attribute("gen_ai.endpoint", gen_ai_endpoint)
                        span.set_attribute("gen_ai.response.id", response.created)
                        span.set_attribute("gen_ai.environment", environment)
                        span.set_attribute("gen_ai.application_name", application_name)
                        span.set_attribute("gen_ai.request.model",
                                            kwargs.get("model", "dall-e-2"))
                        span.set_attribute("gen_ai.request.user",
                                            kwargs.get("user", ""))
                        span.set_attribute("gen_ai.request.image_size",
                                            kwargs.get("size", "1024x1024"))
                        span.set_attribute("gen_ai.request.image_quality", "standard")
                        if trace_content:
                            span.set_attribute("gen_ai.content.prompt", kwargs.get("image", ""))

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

def audio_create(gen_ai_endpoint, version, environment, application_name,
                 tracer, pricing_info, trace_content):
    """
    Generates a telemetry wrapper for creating speech audio to collect metrics.
    
    Args:
        gen_ai_endpoint: Endpoint identifier for logging and tracing.
        version: Version of the monitoring package.
        environment: Deployment environment (e.g., production, staging).
        application_name: Name of the application using the OpenAI API.
        tracer: OpenTelemetry tracer for creating spans.
        pricing_info: Information used for calculating the cost of generating speech audio.
        trace_content: Flag indicating whether to trace the input text and generated audio.
    
    Returns:
        A function that wraps the speech audio creation method to add telemetry.
    """

    def wrapper(wrapped, instance, args, kwargs):
        """
        Wraps the 'audio.speech.create' API call to add telemetry.

        This collects metrics such as execution time, cost, and handles errors
        gracefully, adding details to the trace for observability.

        Args:
            wrapped: The original 'audio.speech.create' method to be wrapped.
            instance: The instance of the class where the original method is defined.
            args: Positional arguments for the 'audio.speech.create' method.
            kwargs: Keyword arguments for the 'audio.speech.create' method.

        Returns:
            The response from the original 'audio.speech.create' method.
        """

        with tracer.start_as_current_span(gen_ai_endpoint, kind= SpanKind.CLIENT) as span:
            # Handling exception ensure observability without disrupting operation
            try:
                response = wrapped(*args, **kwargs)

                try:
                    # Calculate cost of the operation
                    cost = get_audio_model_cost(kwargs.get("model", "tts-1"),
                                                pricing_info, kwargs.get("input", ""))

                    # Set Span attributes
                    span.set_attribute("gen_ai.system", "openai")
                    span.set_attribute("gen_ai.type", "audio")
                    span.set_attribute("gen_ai.endpoint", gen_ai_endpoint)
                    span.set_attribute("gen_ai.environment", environment)
                    span.set_attribute("gen_ai.application_name", application_name)
                    span.set_attribute("gen_ai.request.model", kwargs.get("model", "tts-1"))
                    span.set_attribute("gen_ai.request.audio_voice", kwargs.get("voice", "alloy"))
                    span.set_attribute("gen_ai.request.audio_response_format",
                                        kwargs.get("response_format", "mp3"))
                    span.set_attribute("gen_ai.request.audio_speed", kwargs.get("speed", 1))
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
