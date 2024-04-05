# pylint: disable=duplicate-code
"""
Module for monitoring OpenAI API calls.
"""

import time
import logging
from ..__helpers import get_chat_model_cost, get_embed_model_cost, get_audio_model_cost, get_image_model_cost, openai_tokens
from opentelemetry.trace import SpanKind

# pylint: disable=too-many-locals
# pylint: disable=too-many-arguments
# pylint: disable=too-many-statements
def init(llm, environment, application_name, tracer, pricing_info):
    """
    Initialize OpenAI monitoring for Doku.
    """

    original_chat_create = llm.chat.completions.create
    original_embeddings_create = llm.embeddings.create
    original_fine_tuning_jobs_create = llm.fine_tuning.jobs.create
    original_images_create = llm.images.generate
    original_images_create_variation = llm.images.create_variation
    original_audio_speech_create = llm.audio.speech.create

    async def llm_chat_completions(*args, **kwargs):
        """
        Patched version of OpenAI's chat completions create method.

        Args:
            *args: Variable positional arguments.
            **kwargs: Variable keyword arguments.

        Returns:
            OpenAIResponse: The response from OpenAI's chat completions create method.
        """

        try:
            is_streaming = kwargs.get("stream", False)
            start_time = time.time()
            # pylint: disable=no-else-return
            if is_streaming:
                async def stream_generator():
                    llmresponse = ""
                    async for chunk in await original_chat_create(*args, **kwargs):
                        if len(chunk.choices) > 0:
                            # pylint: disable=line-too-long
                            if hasattr(chunk.choices[0], "delta") and hasattr(chunk.choices[0].delta, "content"):
                                content = chunk.choices[0].delta.content
                                if content:
                                    llmresponse += content
                        yield chunk
                        response_id = chunk.id
                    with tracer.start_as_current_span("openai.chat.completions" , kind= SpanKind.CLIENT) as span:
                        end_time = time.time()
                        duration = end_time - start_time
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
                        prompt_tokens = openai_tokens(prompt, kwargs.get("model", "gpt-3.5-turbo"))
                        completion_tokens = openai_tokens(llmresponse, kwargs.get("model", "gpt-3.5-turbo"))

                        cost = get_chat_model_cost(kwargs.get("model", "gpt-3.5-turbo"), pricing_info, prompt_tokens, completion_tokens)
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

                return stream_generator()
            else:
                start_time = time.time()
                response = await original_chat_create(*args, **kwargs)
                end_time = time.time()
                with tracer.start_as_current_span("openai.chat.completions", kind= SpanKind.CLIENT) as span:
                    duration = end_time - start_time
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

                    if "tools" not in kwargs:
                        cost = get_chat_model_cost(kwargs.get("model", "gpt-3.5-turbo"), pricing_info, response.usage.prompt_tokens, response.usage.completion_tokens)
                        span.set_attribute("llm.promptTokens", response.usage.prompt_tokens)
                        span.set_attribute("llm.completionTokens", response.usage.completion_tokens)
                        span.set_attribute("llm.totalTokens", response.usage.total_tokens)
                        span.set_attribute("llm.finish.reason", response.choices[0].finish_reason)
                        span.set_attribute("llm.cost", cost)


                        if "n" not in kwargs or kwargs["n"] == 1:
                            span.set_attribute("llm.response", response.choices[0].message.content)
                        else:
                            i = 0
                            while i < kwargs["n"]:
                                attribute_name = f"llm.response.{i}"
                                span.set_attribute(attribute_name, response.choices[i].message.content)
                                i += 1
                            return response
                    elif "tools" in kwargs:
                        cost = get_chat_model_cost(kwargs.get("model", "gpt-3.5-turbo"), pricing_info, response.usage.prompt_tokens, response.usage.completion_tokens)
                        span.set_attribute("llm.response", "Function called with tools")
                        span.set_attribute("llm.promptTokens", response.usage.prompt_tokens)
                        span.set_attribute("llm.completionTokens", response.usage.completion_tokens)
                        span.set_attribute("llm.totalTokens", response.usage.total_tokens)
                        span.set_attribute("llm.cost", cost)

                return response
        
        except Exception as e:
            logging.error(f"Error generating OTLP data: {str(e)}")

    async def patched_embeddings_create(*args, **kwargs):
        """
        Patched version of OpenAI's embeddings create method.

        Args:
            *args: Variable positional arguments.
            **kwargs: Variable keyword arguments.

        Returns:
            OpenAIResponse: The response from OpenAI's embeddings create method.
        """

        start_time = time.time()
        response = await original_embeddings_create(*args, **kwargs)
        end_time = time.time()
        try:
            with tracer.start_as_current_span("openai.embeddings", kind= SpanKind.CLIENT) as span:
                duration = end_time - start_time

                cost = get_embed_model_cost(kwargs.get("model", "text-embedding-ada-002"), pricing_info, response.usage.prompt_tokens)
                
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

            return response
        except Exception as e:
            logging.error(f"Error generating OTLP data: {str(e)}")
            return response

    async def patched_fine_tuning_create(*args, **kwargs):
        """
        Patched version of OpenAI's fine-tuning jobs create method.

        Args:
            *args: Variable positional arguments.
            **kwargs: Variable keyword arguments.

        Returns:
            OpenAIResponse: The response from OpenAI's fine-tuning jobs create method.
        """

        start_time = time.time()
        response = await original_fine_tuning_jobs_create(*args, **kwargs)
        end_time = time.time()
        try:
            with tracer.start_as_current_span("openai.fine.tuning", kind= SpanKind.CLIENT) as span:
                duration = end_time - start_time
                
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

            return response
        except Exception as e:
            logging.error(f"Error generating OTLP data: {str(e)}")
            return response

    async def patched_image_create(*args, **kwargs):
        """
        Patched version of OpenAI's images generate method.

        Args:
            *args: Variable positional arguments.
            **kwargs: Variable keyword arguments.

        Returns:
            OpenAIResponse: The response from OpenAI's images generate method.
        """

        start_time = time.time()
        response = await original_images_create(*args, **kwargs)
        end_time = time.time()
        images_count = 0
        try:
            with tracer.start_as_current_span("openai.images.generate", kind= SpanKind.CLIENT) as span:
                duration = end_time - start_time

                if "response_format" in kwargs and kwargs["response_format"] == "b64_json":
                    image = "b64_json"
                else:
                    image = "url"

                cost = get_image_model_cost(kwargs.get("model", "dall-e-2"), pricing_info, kwargs.get("size", "1024x1024"), kwargs.get("quality", "standard"))

                for items in response.data:
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
            
                return response
        except Exception as e:
            logging.error(f"Error generating OTLP data: {str(e)}")
            return response

    async def patched_image_create_variation(*args, **kwargs):
        """
        Patched version of OpenAI's images create variation method.

        Args:
            *args: Variable positional arguments.
            **kwargs: Variable keyword arguments.

        Returns:
            OpenAIResponse: The response from OpenAI's images create variation method.
        """

        start_time = time.time()
        response = await original_images_create_variation(*args, **kwargs)
        end_time = time.time()
        images_count = 0
        try:
            with tracer.start_as_current_span("openai.images.create.variation", kind= SpanKind.CLIENT) as span:
                duration = end_time - start_time

                if "response_format" in kwargs and kwargs["response_format"] == "b64_json":
                    image = "b64_json"
                else:
                    image = "url"

                cost = get_image_model_cost(kwargs.get("model", "dall-e-2"), pricing_info, kwargs.get("size", "1024x1024"), "standard")

                for items in response.data:
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

            return response
        except Exception as e:
            logging.error(f"Error generating OTLP data: {str(e)}")
            return response

    async def patched_audio_speech_create(*args, **kwargs):
        """
        Patched version of OpenAI's audio speech create method.

        Args:
            *args: Variable positional arguments.
            **kwargs: Variable keyword arguments.

        Returns:
            OpenAIResponse: The response from OpenAI's audio speech create method.
        """

        start_time = time.time()
        response = await original_audio_speech_create(*args, **kwargs)
        end_time = time.time()
        try:
            with tracer.start_as_current_span("openai.audio.speech.create", kind= SpanKind.CLIENT) as span:
                duration = end_time - start_time
                cost = get_audio_model_cost(kwargs.get("model", "tts-1"), pricing_info, kwargs.get("input", ""))

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

            return response
        except Exception as e:
            logging.error(f"Error generating OTLP data: {str(e)}")
            return response

    llm.chat.completions.create = llm_chat_completions
    llm.embeddings.create = patched_embeddings_create
    llm.fine_tuning.jobs.create = patched_fine_tuning_create
    llm.images.generate = patched_image_create
    llm.images.create_variation = patched_image_create_variation
    llm.audio.speech.create = patched_audio_speech_create
