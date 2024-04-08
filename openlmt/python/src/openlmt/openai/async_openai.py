# pylint: disable=duplicate-code, line-too-long, broad-exception-caught
"""
Module for monitoring OpenAI API calls.
"""

import time
import logging
from opentelemetry.trace import SpanKind
from ..__helpers import get_chat_model_cost, get_embed_model_cost, get_audio_model_cost, get_image_model_cost, openai_tokens, handle_exception

# Initialize logger for logging potential issues and operations
logger = logging.getLogger(__name__)

def async_chat_completions(wrapper_identifier, version, environment, application_name, tracer, pricing_info, trace_content):
    """
    Generates a wrapper around the `messages.create` method to collect telemetry.

    Args:
        wrapper_identifier: Identifier for the wrapper, unused here.
        version: Version of the Anthropic package being instrumented.
        tracer: The OpenTelemetry tracer instance.

    Returns:
        A function that wraps the original method.
    """

    async def wrapper(wrapped, instance, args, kwargs):
        """
        A patched version of the 'chat.completions' method, enabling telemetry data collection.

        This method wraps the original call to 'chat.completions', adding a telemetry layer that
        captures execution time, error handling, and other metrics.

        Args:
            *args: Variable positional arguments passed to the original method.
            **kwargs: Variable keyword arguments passed to the original method.

        Returns:
            The response from the original 'chat.completions' method.
        """

        # Check if streaming is enabled for the API call
        streaming = kwargs.get("stream", False)
        # Record start time for measuring request duration
        start_time = time.time()

        # pylint: disable=no-else-return
        if streaming:
            # Special handling for streaming response to accommodate the nature of data flow
            async def stream_generator():
                # Placeholder for aggregating streaming response
                llmresponse = ""

                try:
                    # Loop through streaming events capturing relevant details
                    async for chunk in await wrapped(*args, **kwargs):
                        # Collect message IDs and aggregated response from events
                        if len(chunk.choices) > 0:
                            # pylint: disable=line-too-long
                            if hasattr(chunk.choices[0], "delta") and hasattr(chunk.choices[0].delta, "content"):
                                content = chunk.choices[0].delta.content
                                if content:
                                    llmresponse += content
                        yield chunk
                        response_id = chunk.id

                    # Sections handling exceptions ensure observability without disrupting operations
                    try:
                        with tracer.start_as_current_span("openai.chat.completions" , kind= SpanKind.CLIENT) as span:
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
                            prompt_tokens = openai_tokens(prompt, kwargs.get("model", "gpt-3.5-turbo"))
                            completion_tokens = openai_tokens(llmresponse, kwargs.get("model", "gpt-3.5-turbo"))

                            # Calculate cost of the operation
                            cost = get_chat_model_cost(kwargs.get("model", "gpt-3.5-turbo"), pricing_info, prompt_tokens, completion_tokens)

                            # Set Span attributes
                            span.set_attribute("gen_ai.system", "openai")
                            span.set_attribute("gen_ai.type", "chat")
                            span.set_attribute("gen_ai.endpoint", "openai.chat.completions")
                            span.set_attribute("gen_ai.response.id", response_id)
                            span.set_attribute("gen_ai.environment", environment)
                            span.set_attribute("gen_ai.application_name", application_name)
                            span.set_attribute("gen_ai.request_duration", duration)
                            span.set_attribute("gen_ai.request.model", kwargs.get("model", "gpt-3.5-turbo"))
                            span.set_attribute("gen_ai.request.user", kwargs.get("user", ""))
                            span.set_attribute("gen_ai.request.top_p", kwargs.get("top_p", 1))
                            span.set_attribute("gen_ai.request.max_tokens", kwargs.get("max_tokens", ""))
                            span.set_attribute("gen_ai.request.temperature", kwargs.get("temperature", 1))
                            span.set_attribute("gen_ai.request.presence_penalty", kwargs.get("presence_penalty", 0))
                            span.set_attribute("gen_ai.request.frequency_penalty", kwargs.get("frequency_penalty", 0))
                            span.set_attribute("gen_ai.openai.request.seed", kwargs.get("seed", ""))
                            span.set_attribute("gen_ai.request.is_stream", True)
                            span.set_attribute("gen_ai.usage.prompt_tokens", prompt_tokens)
                            span.set_attribute("gen_ai.usage.completion_tokens", completion_tokens)
                            span.set_attribute("gen_ai.usage.total_tokens", prompt_tokens + completion_tokens)
                            span.set_attribute("gen_ai.usage.cost", cost)
                            if trace_content:
                                span.set_attribute("gen_ai.content.prompt", prompt)
                                span.set_attribute("gen_ai.content.completion", llmresponse)


                    except Exception as e:
                        handle_exception(tracer, e, "openai.chat.completions")
                        logger.error("Error in patched message creation: %s", e)

                except Exception as e:
                    handle_exception(tracer, e, "openai.chat.completions")
                    raise e

            return stream_generator()

        # Handling for non-streaming responses
        else:
            try:
                response = await wrapped(*args, **kwargs)
                end_time = time.time()

                try:
                    with tracer.start_as_current_span("openai.chat.completions", kind= SpanKind.CLIENT) as span:
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

                        # Set base span attribues
                        span.set_attribute("gen_ai.system", "openai")
                        span.set_attribute("gen_ai.type", "chat")
                        span.set_attribute("gen_ai.endpoint", "openai.chat.completions")
                        span.set_attribute("gen_ai.response.id", response.id)
                        span.set_attribute("gen_ai.environment", environment)
                        span.set_attribute("gen_ai.application_name", application_name)
                        span.set_attribute("gen_ai.request_duration", duration)
                        span.set_attribute("gen_ai.request.model", kwargs.get("model", "gpt-3.5-turbo"))
                        span.set_attribute("gen_ai.request.top_p", kwargs.get("top_p", 1))
                        span.set_attribute("gen_ai.request.max_tokens", kwargs.get("max_tokens", ""))
                        span.set_attribute("gen_ai.request.user", kwargs.get("user", ""))
                        span.set_attribute("gen_ai.request.temperature", kwargs.get("temperature", 1))
                        span.set_attribute("gen_ai.request.presence_penalty", kwargs.get("presence_penalty", 0))
                        span.set_attribute("gen_ai.request.frequency_penalty", kwargs.get("frequency_penalty", 0))
                        span.set_attribute("gen_ai.openai.request.seed", kwargs.get("seed", ""))
                        span.set_attribute("gen_ai.request.is_stream", False)
                        if trace_content:
                            span.set_attribute("gen_ai.content.prompt", prompt)

                        # Set span attributes when tools is not passed to the function call
                        if "tools" not in kwargs:
                            # Calculate cost of the operation
                            cost = get_chat_model_cost(kwargs.get("model", "gpt-3.5-turbo"), pricing_info, response.usage.prompt_tokens, response.usage.completion_tokens)

                            span.set_attribute("gen_ai.usage.prompt_tokens", response.usage.prompt_tokens)
                            span.set_attribute("gen_ai.usage.completion_tokens", response.usage.completion_tokens)
                            span.set_attribute("gen_ai.usage.total_tokens", response.usage.total_tokens)
                            span.set_attribute("gen_ai.response.finish_reason", response.choices[0].finish_reason)
                            span.set_attribute("gen_ai.usage.cost", cost)

                            # Set span attributes for when n = 1 (default)
                            if "n" not in kwargs or kwargs["n"] == 1:
                                if trace_content:
                                    span.set_attribute("gen_ai.content.completion", response.choices[0].message.content)

                            # Set span attributes for when n > 0
                            else:
                                i = 0
                                while i < kwargs["n"] and trace_content == True:
                                    attribute_name = f"gen_ai.content.completion.{i}"
                                    span.set_attribute(attribute_name, response.choices[i].message.content)
                                    i += 1

                                # Return original response
                                return response

                        # Set span attributes when tools is passed to the function call
                        elif "tools" in kwargs:
                            # Calculate cost of the operation
                            cost = get_chat_model_cost(kwargs.get("model", "gpt-3.5-turbo"), pricing_info, response.usage.prompt_tokens, response.usage.completion_tokens)

                            span.set_attribute("gen_ai.content.completion", "Function called with tools")
                            span.set_attribute("gen_ai.usage.prompt_tokens", response.usage.prompt_tokens)
                            span.set_attribute("gen_ai.usage.completion_tokens", response.usage.completion_tokens)
                            span.set_attribute("gen_ai.usage.total_tokens", response.usage.total_tokens)
                            span.set_attribute("gen_ai.usage.cost", cost)

                    # Return original response
                    return response

                except Exception as e:
                    handle_exception(tracer, e, "openai.chat.completions")
                    logger.error("Error in patched message creation: %s", e)

                    # Return original response
                    return response

            except Exception as e:
                handle_exception(tracer, e, "openai.chat.completions")
                raise e

    return wrapper

def async_embedding(wrapper_identifier, version, environment, application_name, tracer, pricing_info, trace_content):
    """
    Generates a wrapper around the `messages.create` method to collect telemetry.

    Args:
        wrapper_identifier: Identifier for the wrapper, unused here.
        version: Version of the Anthropic package being instrumented.
        tracer: The OpenTelemetry tracer instance.

    Returns:
        A function that wraps the original method.
    """

    async def wrapper(wrapped, instance, args, kwargs):
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
            response = await wrapped(*args, **kwargs)
            end_time = time.time()

            try:
                with tracer.start_as_current_span("openai.embeddings", kind= SpanKind.CLIENT) as span:
                    # Calculate total duration of operation
                    duration = end_time - start_time

                    # Calculate cost of the operation
                    cost = get_embed_model_cost(kwargs.get("model", "text-embedding-ada-002"), pricing_info, response.usage.prompt_tokens)

                    # Set Span attributes
                    span.set_attribute("gen_ai.system", "openai")
                    span.set_attribute("gen_ai.type", "Embedding")
                    span.set_attribute("gen_ai.endpoint", "openai.embeddings")
                    span.set_attribute("gen_ai.environment", environment)
                    span.set_attribute("gen_ai.application_name", application_name)
                    span.set_attribute("gen_ai.request_duration", duration)
                    span.set_attribute("gen_ai.request.model", kwargs.get("model", "text-embedding-ada-002"))
                    span.set_attribute("gen_ai.request.embedding_format", kwargs.get("encoding_format", "float"))
                    span.set_attribute("gen_ai.request.embedding_dimension", kwargs.get("dimensions", ""))
                    span.set_attribute("gen_ai.request.user", kwargs.get("user", ""))
                    span.set_attribute("gen_ai.usage.prompt_tokens", response.usage.prompt_tokens)
                    span.set_attribute("gen_ai.usage.total_tokens", response.usage.total_tokens)
                    span.set_attribute("gen_ai.usage.cost", cost)
                    if trace_content:
                        span.set_attribute("gen_ai.content.prompt", kwargs.get("input", ""))


                # Return original response
                return response

            except Exception as e:
                handle_exception(tracer, e, "openai.embeddings")
                logger.error("Error in patched message creation: %s", e)

                # Return original response
                return response

        except Exception as e:
            handle_exception(tracer, e, "openai.embeddings")
            raise e

    return wrapper

def async_finetune(wrapper_identifier, version, environment, application_name, tracer, pricing_info, trace_content):
    """
    Generates a wrapper around the `messages.create` method to collect telemetry.

    Args:
        wrapper_identifier: Identifier for the wrapper, unused here.
        version: Version of the Anthropic package being instrumented.
        tracer: The OpenTelemetry tracer instance.

    Returns:
        A function that wraps the original method.
    """

    async def wrapper(wrapped, instance, args, kwargs):
        """
        A patched version of the 'fine_tuning.jobs.create' method, enabling telemetry data collection.

        This method wraps the original call to 'fine_tuning.jobs.create', adding a telemetry layer that
        captures execution time, error handling, and other metrics.

        Args:
            *args: Variable positional arguments passed to the original method.
            **kwargs: Variable keyword arguments passed to the original method.

        Returns:
            The response from the original 'fine_tuning.jobs.create' method.
        """

        # Sections handling exceptions ensure observability without disrupting operations
        try:
            start_time = time.time()
            response = await wrapped(*args, **kwargs)
            end_time = time.time()

            try:
                with tracer.start_as_current_span("openai.fine.tuning", kind= SpanKind.CLIENT) as span:
                    # Calculate total duration of operation
                    duration = end_time - start_time

                    # Set Span attributes
                    span.set_attribute("gen_ai.system", "openai")
                    span.set_attribute("gen_ai.type", "Fine Tuning")
                    span.set_attribute("gen_ai.endpoint", "openai.fine.tuning")
                    span.set_attribute("gen_ai.environment", environment)
                    span.set_attribute("gen_ai.application_name", application_name)
                    span.set_attribute("gen_ai.request_duration", duration)
                    span.set_attribute("gen_ai.request.model", kwargs.get("model", "gpt-3.5-turbo"))
                    span.set_attribute("gen_ai.request.training_file", kwargs.get("training_file", ""))
                    span.set_attribute("gen_ai.request.validation_file", kwargs.get("validation_file", ""))
                    span.set_attribute("gen_ai.request.fine_tune_batch_size", kwargs.get("hyperparameters.batch_size", "auto"))
                    span.set_attribute("gen_ai.request.learning_rate_multiplier", kwargs.get("hyperparameters.learning_rate_multiplier", "auto"))
                    span.set_attribute("gen_ai.request.fine_tune_n_epochs", kwargs.get("hyperparameters.n_epochs", "auto"))
                    span.set_attribute("gen_ai.request.fine_tune_model_suffix", kwargs.get("suffix", ""))
                    span.set_attribute("gen_ai.response.id", response.id)
                    span.set_attribute("gen_ai.usage.prompt_tokens", response.usage.prompt_tokens)
                    span.set_attribute("gen_ai.request.fine_tune_status", response.status)

                # Return original response
                return response

            except Exception as e:
                handle_exception(tracer, e, "openai.fine.tuning")
                logger.error("Error in patched message creation: %s", e)

                # Return original response
                return response

        except Exception as e:
            handle_exception(tracer, e, "openai.fine.tuning")
            raise e

    return wrapper

def async_image_generate(wrapper_identifier, version, environment, application_name, tracer, pricing_info, trace_content):
    """
    Generates a wrapper around the `messages.create` method to collect telemetry.

    Args:
        wrapper_identifier: Identifier for the wrapper, unused here.
        version: Version of the Anthropic package being instrumented.
        tracer: The OpenTelemetry tracer instance.

    Returns:
        A function that wraps the original method.
    """

    async def wrapper(wrapped, instance, args, kwargs):
        """
        A patched version of the 'images.generate' method, enabling telemetry data collection.

        This method wraps the original call to 'images.generate', adding a telemetry layer that
        captures execution time, error handling, and other metrics.

        Args:
            *args: Variable positional arguments passed to the original method.
            **kwargs: Variable keyword arguments passed to the original method.

        Returns:
            The response from the original 'images.generate' method.
        """

        # Sections handling exceptions ensure observability without disrupting operations
        try:
            start_time = time.time()
            response = await wrapped(*args, **kwargs)
            end_time = time.time()
            images_count = 0

            try:
                with tracer.start_as_current_span("openai.images.generate", kind= SpanKind.CLIENT) as span:
                    # Calculate total duration of operation
                    duration = end_time - start_time

                    # Find Image format
                    if "response_format" in kwargs and kwargs["response_format"] == "b64_json":
                        image = "b64_json"
                    else:
                        image = "url"

                    # Calculate cost of the operation
                    cost = get_image_model_cost(kwargs.get("model", "dall-e-2"), pricing_info, kwargs.get("size", "1024x1024"), kwargs.get("quality", "standard"))

                    for items in response.data:
                        # Set Span attributes
                        span.set_attribute("gen_ai.system", "openai")
                        span.set_attribute("gen_ai.type", "Image")
                        span.set_attribute("gen_ai.endpoint", "openai.images.generate")
                        span.set_attribute("gen_ai.response.id", response.created)
                        span.set_attribute("gen_ai.environment", environment)
                        span.set_attribute("gen_ai.application_name", application_name)
                        span.set_attribute("gen_ai.request_duration", duration)
                        span.set_attribute("gen_ai.request.model", kwargs.get("model", "dall-e-2"))
                        span.set_attribute("gen_ai.request.image_size", kwargs.get("size", "1024x1024"))
                        span.set_attribute("gen_ai.request.image_quality", kwargs.get("quality", "standard"))
                        span.set_attribute("gen_ai.request.image_style", kwargs.get("style", "vivid"))
                        span.set_attribute("gen_ai.content.revised_prompt", items.revised_prompt if items.revised_prompt else "")
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
                handle_exception(tracer, e, "openai.images.generate")
                logger.error("Error in patched message creation: %s", e)

                # Return original response
                return response

        except Exception as e:
            handle_exception(tracer, e, "openai.images.generate")
            raise e

    return wrapper

def async_image_variatons(wrapper_identifier, version, environment, application_name, tracer, pricing_info, trace_content):
    """
    Generates a wrapper around the `messages.create` method to collect telemetry.

    Args:
        wrapper_identifier: Identifier for the wrapper, unused here.
        version: Version of the Anthropic package being instrumented.
        tracer: The OpenTelemetry tracer instance.

    Returns:
        A function that wraps the original method.
    """

    async def wrapper(wrapped, instance, args, kwargs):
        """
        A patched version of the 'images.create.variations' method, enabling telemetry data collection.

        This method wraps the original call to 'images.create.variations', adding a telemetry layer that
        captures execution time, error handling, and other metrics.

        Args:
            *args: Variable positional arguments passed to the original method.
            **kwargs: Variable keyword arguments passed to the original method.

        Returns:
            The response from the original 'images.create.variations' method.
        """

        # Sections handling exceptions ensure observability without disrupting operations
        try:
            start_time = time.time()
            response = await wrapped(*args, **kwargs)
            end_time = time.time()
            images_count = 0

            try:
                with tracer.start_as_current_span("openai.images.create.variation", kind= SpanKind.CLIENT) as span:
                    # Calculate total duration of operation
                    duration = end_time - start_time

                    # Find Image format
                    if "response_format" in kwargs and kwargs["response_format"] == "b64_json":
                        image = "b64_json"
                    else:
                        image = "url"

                    # Calculate cost of the operation
                    cost = get_image_model_cost(kwargs.get("model", "dall-e-2"), pricing_info, kwargs.get("size", "1024x1024"), "standard")

                    for items in response.data:
                        # Set Span attributes
                        span.set_attribute("gen_ai.system", "openai")
                        span.set_attribute("gen_ai.type", "Image")
                        span.set_attribute("gen_ai.endpoint", "openai.images.create.variation")
                        span.set_attribute("gen_ai.response.id", response.created)
                        span.set_attribute("gen_ai.environment", environment)
                        span.set_attribute("gen_ai.application_name", application_name)
                        span.set_attribute("gen_ai.request_duration", duration)
                        span.set_attribute("gen_ai.request.model", kwargs.get("model", "dall-e-2"))
                        span.set_attribute("gen_ai.request.user", kwargs.get("user", ""))
                        span.set_attribute("gen_ai.request.image_size", kwargs.get("size", "1024x1024"))
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
                handle_exception(tracer, e, "openai.images.create.variation")
                logger.error("Error in patched message creation: %s", e)

                # Return original response
                return response

        except Exception as e:
            handle_exception(tracer, e, "openai.images.create.variation")
            raise e
    
    return wrapper

def async_audio_create(wrapper_identifier, version, environment, application_name, tracer, pricing_info, trace_content):
    """
    Generates a wrapper around the `messages.create` method to collect telemetry.

    Args:
        wrapper_identifier: Identifier for the wrapper, unused here.
        version: Version of the Anthropic package being instrumented.
        tracer: The OpenTelemetry tracer instance.

    Returns:
        A function that wraps the original method.
    """

    async def wrapper(wrapped, instance, args, kwargs):
        """
        A patched version of the 'audio.speech.create' method, enabling telemetry data collection.

        This method wraps the original call to 'audio.speech.create', adding a telemetry layer that
        captures execution time, error handling, and other metrics.

        Args:
            *args: Variable positional arguments passed to the original method.
            **kwargs: Variable keyword arguments passed to the original method.

        Returns:
            The response from the original 'audio.speech.create' method.
        """

        # Sections handling exceptions ensure observability without disrupting operations
        try:
            start_time = time.time()
            response = await wrapped(*args, **kwargs)
            end_time = time.time()

            try:
                with tracer.start_as_current_span("openai.audio.speech.create", kind= SpanKind.CLIENT) as span:
                    # Calculate total duration of operation
                    duration = end_time - start_time

                    # Calculate cost of the operation
                    cost = get_audio_model_cost(kwargs.get("model", "tts-1"), pricing_info, kwargs.get("input", ""))

                    # Set Span attributes
                    span.set_attribute("gen_ai.system", "openai")
                    span.set_attribute("gen_ai.type", "Audio")
                    span.set_attribute("gen_ai.endpoint", "openai.audio.speech.create")
                    span.set_attribute("gen_ai.environment", environment)
                    span.set_attribute("gen_ai.application_name", application_name)
                    span.set_attribute("gen_ai.request_duration", duration)
                    span.set_attribute("gen_ai.request.model", kwargs.get("model", "tts-1"))
                    span.set_attribute("gen_ai.request.audio_voice", kwargs.get("voice", "alloy"))
                    span.set_attribute("gen_ai.request.audio_response_format", kwargs.get("response_format", "mp3"))
                    span.set_attribute("gen_ai.request.audio_speed", kwargs.get("speed", 1))
                    span.set_attribute("gen_ai.usage.cost", cost)
                    if trace_content:
                        span.set_attribute("gen_ai.content.prompt", kwargs.get("input", ""))


                # Return original response
                return response

            except Exception as e:
                handle_exception(tracer, e, "openai.audio.speech.create")
                logger.error("Error in patched message creation: %s", e)

                # Return original response
                return response

        except Exception as e:
            handle_exception(tracer, e, "openai.audio.speech.create")
            raise e

    return wrapper
