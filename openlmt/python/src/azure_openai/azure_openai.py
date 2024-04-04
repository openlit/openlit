# pylint: disable=duplicate-code
"""
Module for monitoring Azure OpenAI API calls.
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
    Initialize Azure OpenAI monitoring for Doku.
    """

    original_chat_create = llm.chat.completions.create
    original_completions_create = llm.completions.create
    original_embeddings_create = llm.embeddings.create
    original_images_create = llm.images.generate

    def llm_chat_completions(*args, **kwargs):
        """
        Patched version of Azure OpenAI's chat completions create method.

        Args:
            *args: Variable positional arguments.
            **kwargs: Variable keyword arguments.

        Returns:
            OpenAIResponse: The response from Azure OpenAI's chat completions create method.
        """
        try:
            is_streaming = kwargs.get("stream", False)
            start_time = time.time()
            #pylint: disable=no-else-return
            if is_streaming:
                def stream_generator():
                    llmresponse = ""
                    for chunk in original_chat_create(*args, **kwargs):
                        #pylint: disable=line-too-long
                        if len(chunk.choices) > 0:
                            if hasattr(chunk.choices[0], "delta") and hasattr(chunk.choices[0].delta, "content"):
                                content = chunk.choices[0].delta.content
                                if content:
                                    llmresponse += content
                        yield chunk
                        response_id = chunk.id
                        model = "azure_" + chunk.model
                    with tracer.start_as_current_span("azure.openai.chat.completions" , kind= SpanKind.CLIENT) as span:
                        end_time = time.time()
                        duration = end_time - start_time
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
                        prompt_tokens = openai_tokens(prompt, kwargs.get("model", "gpt-3.5-turbo"))
                        completion_tokens = openai_tokens(llmresponse, kwargs.get("model", "gpt-3.5-turbo"))

                        cost = get_chat_model_cost(kwargs.get("model", "gpt-3.5-turbo"), pricing_info, prompt_tokens, completion_tokens)
                        span.set_attribute("llm.provider", "Azuure.OpenAI")
                        span.set_attribute("llm.generation", "chat")
                        span.set_attribute("llm.endpoint", "azure.openai.chat.completions")
                        span.set_attribute("llm.req.id", response_id)
                        span.set_attribute("llm.environment", environment)
                        span.set_attribute("llm.application.name", application_name)
                        span.set_attribute("llm.request.duration", duration)
                        span.set_attribute("llm.model", kwargs.get("model", "gpt-3.5-turbo"))
                        span.set_attribute("llm.user", kwargs.get("user", ""))
                        span.set_attribute("llm.tool.choice", kwargs.get("tool_choice", ""))
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
                response = original_chat_create(*args, **kwargs)
                end_time = time.time()
                with tracer.start_as_current_span("azure.openai.chat.completions", kind= SpanKind.CLIENT) as span:
                    duration = end_time - start_time
                    model = "azure_" + response.model
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
                    span.set_attribute("llm.endpoint", "azure.openai.chat.completions")
                    span.set_attribute("llm.req.id", response.id)
                    span.set_attribute("llm.environment", environment)
                    span.set_attribute("llm.application.name", application_name)
                    span.set_attribute("llm.request.duration", duration)
                    span.set_attribute("llm.model", kwargs.get("model", "gpt-3.5-turbo"))
                    span.set_attribute("llm.user", kwargs.get("user", ""))
                    span.set_attribute("llm.tool.choice", kwargs.get("tool_choice", ""))
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

    def llm_completions(*args, **kwargs):
        """
        Patched version of Azure OpenAI's completions create method.

        Args:
            *args: Variable positional arguments.
            **kwargs: Variable keyword arguments.

        Returns:
            OpenAIResponse: The response from Azure OpenAI's completions create method.
        """
        try:
            start_time = time.time()
            streaming = kwargs.get("stream", False)
            #pylint: disable=no-else-return
            if streaming:
                def stream_generator():
                    llmresponse = ""
                    for chunk in original_completions_create(*args, **kwargs):
                        if len(chunk.choices) > 0:
                            if hasattr(chunk.choices[0], "text"):
                                content = chunk.choices[0].text
                                if content:
                                    llmresponse += content
                        yield chunk
                        response_id = chunk.id
                        model = "azure_" + chunk.model
                    with tracer.start_as_current_span("azure.openai.completions" , kind= SpanKind.CLIENT) as span:
                        end_time = time.time()
                        duration = end_time - start_time
                        prompt = kwargs.get("prompt", "")

                        prompt_tokens = openai_tokens(prompt, "gpt-3.5-turbo")
                        completion_tokens = openai_tokens(llmresponse, "gpt-3.5-turbo")

                        cost = get_chat_model_cost(model, pricing_info, prompt_tokens, completion_tokens)
                        span.set_attribute("llm.provider", "Azure.OpenAI")
                        span.set_attribute("llm.generation", "chat")
                        span.set_attribute("llm.endpoint", "azure.openai.completions")
                        span.set_attribute("llm.req.id", response_id)
                        span.set_attribute("llm.environment", environment)
                        span.set_attribute("llm.application.name", application_name)
                        span.set_attribute("llm.request.duration", duration)
                        span.set_attribute("llm.model", model)
                        span.set_attribute("llm.user", kwargs.get("user", ""))
                        span.set_attribute("llm.tool.choice", kwargs.get("tool_choice", ""))
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
                response = original_completions_create(*args, **kwargs)
                end_time = time.time()
                with tracer.start_as_current_span("azure.openai.completions", kind= SpanKind.CLIENT) as span:
                    duration = end_time - start_time
                    model = "azure_" + response.model

                    span.set_attribute("llm.provider", "Azure.OpenAI")
                    span.set_attribute("llm.generation", "chat")
                    span.set_attribute("llm.endpoint", "azure.openai.completions")
                    span.set_attribute("llm.req.id", response.id)
                    span.set_attribute("llm.environment", environment)
                    span.set_attribute("llm.application.name", application_name)
                    span.set_attribute("llm.request.duration", duration)
                    span.set_attribute("llm.model", kwargs.get("model", "gpt-3.5-turbo"))
                    span.set_attribute("llm.user", kwargs.get("user", ""))
                    span.set_attribute("llm.tool.choice", kwargs.get("tool_choice", ""))
                    span.set_attribute("llm.temperature", kwargs.get("temperature", 1))
                    span.set_attribute("llm.presence.penalty", kwargs.get("presence_penalty", 0))
                    span.set_attribute("llm.frequency.penalty", kwargs.get("frequency_penalty", 0))
                    span.set_attribute("llm.seed", kwargs.get("seed", ""))
                    span.set_attribute("llm.stream", False)
                    span.set_attribute("llm.prompt", kwargs.get("prompt", ""))

                    if "tools" not in kwargs:
                        cost = get_chat_model_cost(model, pricing_info, response.usage.prompt_tokens, response.usage.completion_tokens)
                        span.set_attribute("llm.promptTokens", response.usage.prompt_tokens)
                        span.set_attribute("llm.completionTokens", response.usage.completion_tokens)
                        span.set_attribute("llm.totalTokens", response.usage.total_tokens)
                        span.set_attribute("llm.finish.reason", response.choices[0].finish_reason)
                        span.set_attribute("llm.cost", cost)

                        if "n" not in kwargs or kwargs["n"] == 1:
                            span.set_attribute("llm.response", response.choices[0].text)
                        else:
                            i = 0
                            while i < kwargs["n"]:
                                attribute_name = f"llm.response.{i}"
                                span.set_attribute(attribute_name, response.choices[i].text)
                                i += 1
                            return response
                    elif "tools" in kwargs:
                        cost = get_chat_model_cost(model, pricing_info, response.usage.prompt_tokens, response.usage.completion_tokens)
                        span.set_attribute("llm.response", "Function called with tools")
                        span.set_attribute("llm.promptTokens", response.usage.prompt_tokens)
                        span.set_attribute("llm.completionTokens", response.usage.completion_tokens)
                        span.set_attribute("llm.totalTokens", response.usage.total_tokens)
                        span.set_attribute("llm.cost", cost)

                return response
        except Exception as e:
            logging.error(f"Error generating OTLP data: {str(e)}")

    def patched_embeddings_create(*args, **kwargs):
        """
        Patched version of Azure OpenAI's embeddings create method.

        Args:
            *args: Variable positional arguments.
            **kwargs: Variable keyword arguments.

        Returns:
            OpenAIResponse: The response from Azure OpenAI's embeddings create method.
        """

        start_time = time.time()
        response = original_embeddings_create(*args, **kwargs)
        end_time = time.time()
        try:
            with tracer.start_as_current_span("azure.openai.embeddings", kind= SpanKind.CLIENT) as span:
                duration = end_time - start_time

                cost = get_embed_model_cost("azure_" + response.model, pricing_info, response.usage.prompt_tokens)
                
                span.set_attribute("llm.provider", "Azure.OpenAI")
                span.set_attribute("llm.generation", "Embedding")
                span.set_attribute("llm.endpoint", "azure.openai.embeddings")
                span.set_attribute("llm.environment", environment)
                span.set_attribute("llm.application.name", application_name)
                span.set_attribute("llm.request.duration", duration)
                span.set_attribute("llm.model", "azure_" + response.model)
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

    def patched_image_create(*args, **kwargs):
        """
        Patched version of Azure OpenAI's images generate method.

        Args:
            *args: Variable positional arguments.
            **kwargs: Variable keyword arguments.

        Returns:
            OpenAIResponse: The response from Azure OpenAI's images generate method.
        """

        start_time = time.time()
        response = original_images_create(*args, **kwargs)
        end_time = time.time()
        try:
            with tracer.start_as_current_span("azure.openai.images.generate", kind= SpanKind.CLIENT) as span:
                duration = end_time - start_time

                if "response_format" in kwargs and kwargs["response_format"] == "b64_json":
                    image = "b64_json"
                else:
                    image = "url"
                
                cost = get_image_model_cost("azure_" + kwargs.get("model", "dall-e-3"), pricing_info, kwargs.get("size", "1024x1024"), kwargs.get("quality", "standard"))

                for items in response.data:
                    span.set_attribute("llm.provider", "Azure.OpenAI")
                    span.set_attribute("llm.generation", "Image")
                    span.set_attribute("llm.endpoint", "azure.openai.images.generate")
                    span.set_attribute("llm.req.id", response.created)
                    span.set_attribute("llm.environment", environment)
                    span.set_attribute("llm.application.name", application_name)
                    span.set_attribute("llm.request.duration", duration)
                    span.set_attribute("llm.model", "azure_" + kwargs.get("model", "dall-e-3"))
                    span.set_attribute("llm.prompt", kwargs.get("prompt", ""))
                    span.set_attribute("llm.image.size", kwargs.get("size", "1024x1024"))
                    span.set_attribute("llm.image.quality", kwargs.get("quality", "standard"))
                    span.set_attribute("llm.image.style", kwargs.get("style", "vivid"))
                    span.set_attribute("llm.revised.prompt", items.revised_prompt if response.revised_prompt else "")
                    span.set_attribute("llm.user", kwargs.get("user", ""))

                    attribute_name = f"llm.image.{images_count}"
                    span.set_attribute(attribute_name, getattr(items, image))

                    images_count+=1

                span.set_attribute("llm.cost", len(response.data) * cost)

                return response
        except Exception as e:
            logging.error(f"Error generating OTLP data: {str(e)}")
            return response

    llm.chat.completions.create = llm_chat_completions
    llm.completions.create = llm_completions
    llm.embeddings.create = patched_embeddings_create
    llm.images.generate = patched_image_create
