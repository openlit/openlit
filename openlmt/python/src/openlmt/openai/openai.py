# pylint: disable=duplicate-code, line-too-long
"""
Module for monitoring OpenAI API calls.
"""

import time
import logging
from opentelemetry.trace import SpanKind
from ..__helpers import get_chat_model_cost, get_embed_model_cost, get_audio_model_cost, get_image_model_cost, openai_tokens, handle_exception

# Initialize logger for logging potential issues and operations
logger = logging.getLogger(__name__)

# pylint: disable=too-many-locals, too-many-arguments, too-many-statements
def init(llm, environment, application_name, tracer, pricing_info):
    """
    Initializes the instrumentation process by patching the OpenAI client
    methods to gather telemetry data during its execution.

    Args:
        llm: Reference to the OpenAI client being instrumented.
        environment (str): Identifier for the environment (e.g., 'production', 'development').
        application_name (str): Name of the application using the instrumented client.
        tracer: OpenTelemetry tracer object used for creating spans.
        pricing_info (dict): Contains pricing information for calculating the cost of operations.
    """

    # Backup original functions for later restoration if needed
    original_chat_create = llm.chat.completions.create
    original_embeddings_create = llm.embeddings.create
    original_fine_tuning_jobs_create = llm.fine_tuning.jobs.create
    original_images_create = llm.images.generate
    original_images_create_variation = llm.images.create_variation
    original_audio_speech_create = llm.audio.speech.create

    def llm_chat_completions(*args, **kwargs):
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
            def stream_generator():
                # Placeholder for aggregating streaming response
                llmresponse = ""

                try:
                    # Loop through streaming events capturing relevant details
                    for chunk in original_chat_create(*args, **kwargs):
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
                            span.set_attribute("llm.provider", "OpenAI")
                            span.set_attribute("llm.generation", "chat")
                            span.set_attribute("llm.endpoint", "openai.chat.completions")
                            span.set_attribute("llm.req.id", response_id)
                            span.set_attribute("llm.environment", environment)
                            span.set_attribute("llm.application.name", application_name)
                            span.set_attribute("llm.request.duration", duration)
                            span.set_attribute("llm.model", kwargs.get("model", "gpt-3.5-turbo"))
                            span.set_attribute("llm.user", kwargs.get("user", ""))
                            span.set_attribute("llm.top.p", kwargs.get("top_p", 1))
                            span.set_attribute("llm.max.tokens", kwargs.get("max_tokens", ""))
                            span.set_attribute("llm.temperature", kwargs.get("temperature", 1))
                            span.set_attribute("llm.presence.penalty", kwargs.get("presence_penalty", 0))
                            span.set_attribute("llm.frequency.penalty", kwargs.get("frequency_penalty", 0))
                            span.set_attribute("llm.seed", kwargs.get("seed", ""))
                            span.set_attribute("llm.stream", True)
                            span.set_attribute("llm.prompt", prompt)
                            span.set_attribute("llm.response", llmresponse)
                            span.set_attribute("llm.promptTokens", prompt_tokens)
                            span.set_attribute("llm.completionTokens", completion_tokens)
                            span.set_attribute("llm.totalTokens", prompt_tokens + completion_tokens)
                            span.set_attribute("llm.cost", cost)

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
                response = original_chat_create(*args, **kwargs)
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
                        span.set_attribute("llm.provider", "OpenAI")
                        span.set_attribute("llm.generation", "chat")
                        span.set_attribute("llm.endpoint", "openai.chat.completions")
                        span.set_attribute("llm.req.id", response.id)
                        span.set_attribute("llm.environment", environment)
                        span.set_attribute("llm.application.name", application_name)
                        span.set_attribute("llm.request.duration", duration)
                        span.set_attribute("llm.model", kwargs.get("model", "gpt-3.5-turbo"))
                        span.set_attribute("llm.top.p", kwargs.get("top_p", 1))
                        span.set_attribute("llm.max.tokens", kwargs.get("max_tokens", ""))
                        span.set_attribute("llm.user", kwargs.get("user", ""))
                        span.set_attribute("llm.temperature", kwargs.get("temperature", 1))
                        span.set_attribute("llm.presence.penalty", kwargs.get("presence_penalty", 0))
                        span.set_attribute("llm.frequency.penalty", kwargs.get("frequency_penalty", 0))
                        span.set_attribute("llm.seed", kwargs.get("seed", ""))
                        span.set_attribute("llm.stream", False)
                        span.set_attribute("llm.prompt", prompt)

                        # Set span attributes when tools is not passed to the function call
                        if "tools" not in kwargs:
                            # Calculate cost of the operation
                            cost = get_chat_model_cost(kwargs.get("model", "gpt-3.5-turbo"), pricing_info, response.usage.prompt_tokens, response.usage.completion_tokens)

                            span.set_attribute("llm.promptTokens", response.usage.prompt_tokens)
                            span.set_attribute("llm.completionTokens", response.usage.completion_tokens)
                            span.set_attribute("llm.totalTokens", response.usage.total_tokens)
                            span.set_attribute("llm.finish.reason", response.choices[0].finish_reason)
                            span.set_attribute("llm.cost", cost)

                            # Set span attributes for when n = 1 (default)
                            if "n" not in kwargs or kwargs["n"] == 1:
                                span.set_attribute("llm.response", response.choices[0].message.content)

                            # Set span attributes for when n > 0
                            else:
                                i = 0
                                while i < kwargs["n"]:
                                    attribute_name = f"llm.response.{i}"
                                    span.set_attribute(attribute_name, response.choices[i].message.content)
                                    i += 1

                                # Return original response
                                return response

                        # Set span attributes when tools is passed to the function call
                        elif "tools" in kwargs:
                            # Calculate cost of the operation
                            cost = get_chat_model_cost(kwargs.get("model", "gpt-3.5-turbo"), pricing_info, response.usage.prompt_tokens, response.usage.completion_tokens)

                            span.set_attribute("llm.response", "Function called with tools")
                            span.set_attribute("llm.promptTokens", response.usage.prompt_tokens)
                            span.set_attribute("llm.completionTokens", response.usage.completion_tokens)
                            span.set_attribute("llm.totalTokens", response.usage.total_tokens)
                            span.set_attribute("llm.cost", cost)

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

    def patched_embeddings_create(*args, **kwargs):
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
            response = original_embeddings_create(*args, **kwargs)
            end_time = time.time()

            try:
                with tracer.start_as_current_span("openai.embeddings", kind= SpanKind.CLIENT) as span:
                    # Calculate total duration of operation
                    duration = end_time - start_time

                    # Calculate cost of the operation
                    cost = get_embed_model_cost(kwargs.get("model", "text-embedding-ada-002"), pricing_info, response.usage.prompt_tokens)

                    # Set Span attributes
                    span.set_attribute("llm.provider", "OpenAI")
                    span.set_attribute("llm.generation", "Embedding")
                    span.set_attribute("llm.endpoint", "openai.embeddings")
                    span.set_attribute("llm.environment", environment)
                    span.set_attribute("llm.application.name", application_name)
                    span.set_attribute("llm.request.duration", duration)
                    span.set_attribute("llm.model", kwargs.get("model", "text-embedding-ada-002"))
                    span.set_attribute("llm.prompt", kwargs.get("input", ""))
                    span.set_attribute("llm.embedding.format", kwargs.get("encoding_format", "float"))
                    span.set_attribute("llm.embedding.dimensions", kwargs.get("dimensions", ""))
                    span.set_attribute("llm.user", kwargs.get("user", ""))
                    span.set_attribute("llm.promptTokens", response.usage.prompt_tokens)
                    span.set_attribute("llm.totalTokens", response.usage.total_tokens)
                    span.set_attribute("llm.cost", cost)

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

    def patched_fine_tuning_create(*args, **kwargs):
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
            response = original_fine_tuning_jobs_create(*args, **kwargs)
            end_time = time.time()

            try:
                with tracer.start_as_current_span("openai.fine.tuning", kind= SpanKind.CLIENT) as span:
                    # Calculate total duration of operation
                    duration = end_time - start_time

                    # Set Span attributes
                    span.set_attribute("llm.provider", "OpenAI")
                    span.set_attribute("llm.generation", "Fine Tuning")
                    span.set_attribute("llm.endpoint", "openai.fine.tuning")
                    span.set_attribute("llm.environment", environment)
                    span.set_attribute("llm.application.name", application_name)
                    span.set_attribute("llm.request.duration", duration)
                    span.set_attribute("llm.model", kwargs.get("model", "gpt-3.5-turbo"))
                    span.set_attribute("llm.fine.tuning.training.file", kwargs.get("training_file", ""))
                    span.set_attribute("llm.fine.tuning.validation.file", kwargs.get("validation_file", ""))
                    span.set_attribute("llm.fine.tuning.batch_size", kwargs.get("hyperparameters.batch_size", "auto"))
                    span.set_attribute("llm.fine.tuning.learning_rate_multiplier", kwargs.get("hyperparameters.learning_rate_multiplier", "auto"))
                    span.set_attribute("llm.fine.tuning.n_epochs", kwargs.get("hyperparameters.n_epochs", "auto"))
                    span.set_attribute("llm.fine.tuning.model.suffix", kwargs.get("suffix", ""))
                    span.set_attribute("llm.req.id", response.id)
                    span.set_attribute("llm.promptTokens", response.usage.prompt_tokens)
                    span.set_attribute("llm.fine.tune.status", response.status)

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

    def patched_image_create(*args, **kwargs):
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
            response = original_images_create(*args, **kwargs)
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
                        span.set_attribute("llm.provider", "OpenAI")
                        span.set_attribute("llm.generation", "Image")
                        span.set_attribute("llm.endpoint", "openai.images.generate")
                        span.set_attribute("llm.req.id", response.created)
                        span.set_attribute("llm.environment", environment)
                        span.set_attribute("llm.application.name", application_name)
                        span.set_attribute("llm.request.duration", duration)
                        span.set_attribute("llm.model", kwargs.get("model", "dall-e-2"))
                        span.set_attribute("llm.prompt", kwargs.get("prompt", ""))
                        span.set_attribute("llm.image.size", kwargs.get("size", "1024x1024"))
                        span.set_attribute("llm.image.quality", kwargs.get("quality", "standard"))
                        span.set_attribute("llm.image.style", kwargs.get("style", "vivid"))
                        span.set_attribute("llm.revised.prompt", items.revised_prompt if items.revised_prompt else "")
                        span.set_attribute("llm.user", kwargs.get("user", ""))

                        attribute_name = f"llm.image.{images_count}"
                        span.set_attribute(attribute_name, getattr(items, image))

                        images_count+=1

                    span.set_attribute("llm.cost", len(response.data) * cost)

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

    def patched_image_create_variation(*args, **kwargs):
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
            response = original_images_create_variation(*args, **kwargs)
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
                        span.set_attribute("llm.provider", "OpenAI")
                        span.set_attribute("llm.generation", "Image")
                        span.set_attribute("llm.endpoint", "openai.images.create.variation")
                        span.set_attribute("llm.req.id", response.created)
                        span.set_attribute("llm.environment", environment)
                        span.set_attribute("llm.application.name", application_name)
                        span.set_attribute("llm.request.duration", duration)
                        span.set_attribute("llm.model", kwargs.get("model", "dall-e-2"))
                        span.set_attribute("llm.image.input", kwargs.get("image", ""))
                        span.set_attribute("llm.user", kwargs.get("user", ""))
                        span.set_attribute("llm.image.image", kwargs.get("image", ""))
                        span.set_attribute("llm.image.size", kwargs.get("size", "1024x1024"))
                        span.set_attribute("llm.image.quality", "standard")

                        attribute_name = f"llm.image.{images_count}"
                        span.set_attribute(attribute_name, getattr(items, image))

                        images_count+=1

                    span.set_attribute("llm.cost", len(response.data) * cost)

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

    def patched_audio_speech_create(*args, **kwargs):
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
            response = original_audio_speech_create(*args, **kwargs)
            end_time = time.time()

            try:
                with tracer.start_as_current_span("openai.audio.speech.create", kind= SpanKind.CLIENT) as span:
                    # Calculate total duration of operation
                    duration = end_time - start_time

                    # Calculate cost of the operation
                    cost = get_audio_model_cost(kwargs.get("model", "tts-1"), pricing_info, kwargs.get("input", ""))

                    # Set Span attributes
                    span.set_attribute("llm.provider", "OpenAI")
                    span.set_attribute("llm.generation", "Audio")
                    span.set_attribute("llm.endpoint", "openai.audio.speech.create")
                    span.set_attribute("llm.environment", environment)
                    span.set_attribute("llm.application.name", application_name)
                    span.set_attribute("llm.request.duration", duration)
                    span.set_attribute("llm.model", kwargs.get("model", "tts-1"))
                    span.set_attribute("llm.prompt", kwargs.get("input", ""))
                    span.set_attribute("llm.audio.voice", kwargs.get("voice", "alloy"))
                    span.set_attribute("llm.audio.response_format", kwargs.get("response_format", "mp3"))
                    span.set_attribute("llm.audio.speed", kwargs.get("speed", 1))
                    span.set_attribute("llm.cost", cost)

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

    llm.chat.completions.create = llm_chat_completions
    llm.embeddings.create = patched_embeddings_create
    llm.fine_tuning.jobs.create = patched_fine_tuning_create
    llm.images.generate = patched_image_create
    llm.images.create_variation = patched_image_create_variation
    llm.audio.speech.create = patched_audio_speech_create
