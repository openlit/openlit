# pylint: disable=duplicate-code
"""
Module for monitoring Mistral API calls.
"""

import time
import logging
from ..__helpers import get_chat_model_cost, get_embed_model_cost
from opentelemetry.trace import SpanKind

# pylint: disable=too-many-arguments, too-many-statements
def init(llm, environment, application_name, tracer, pricing_info):
    """
    Initialize Mistral integration with Doku.
    """

    original_mistral_chat = llm.chat
    original_mistral_chat_stream = llm.chat_stream
    original_mistral_embeddings = llm.embeddings

    # pylint: disable=too-many-locals
    def patched_chat(*args, **kwargs):
        """
        Patched version of Mistral's chat method.

        Args:
            *args: Variable positional arguments.
            **kwargs: Variable keyword arguments.

        Returns:
            MistalResponse: The response from Mistral's chat.
        """
        try:
            start_time = time.time()
            response = original_mistral_chat(*args, **kwargs)
            end_time = time.time()
            with tracer.start_as_current_span("mistral.chat.completion", kind= SpanKind.CLIENT) as span:
                duration = end_time - start_time
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
                cost = get_chat_model_cost(kwargs.get("model", "mistral-small-latest"), pricing_info, response.usage.prompt_tokens, response.usage.completion_tokens)
                span.set_attribute("llm.provider", "Mistral")
                span.set_attribute("llm.generation", "chat")
                span.set_attribute("llm.endpoint", "mistral.chat.completion")
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

            return response
        except Exception as e:
            logging.error(f"Error generating OTLP data: {str(e)}")
            return response

    # pylint: disable=too-many-locals
    def patched_chat_stream(*args, **kwargs):
        """
        Patched version of Mistral's chat_stream method.

        Args:
            *args: Variable positional arguments.
            **kwargs: Variable keyword arguments.

        Returns:
            MistalResponse: The response from Mistral's chat_stream.
        """
        try:
            start_time = time.time()
            def stream_generator():
                llmresponse = ""
                prompt_tokens = -1
                completion_tokens = -1
                total_tokens = -1
                finish_reason = ""
                for event in original_mistral_chat_stream(*args, **kwargs):
                    response_id = event.id
                    llmresponse += event.choices[0].delta.content
                    if event.usage is not None:
                        prompt_tokens = event.usage.prompt_tokens
                        completion_tokens = event.usage.completion_tokens
                        total_tokens = event.usage.total_tokens
                        finish_reason = event.choices[0].finish_reason
                    yield event
                with tracer.start_as_current_span("mistral.chat.completion", kind= SpanKind.CLIENT) as span:
                    end_time = time.time()
                    duration = end_time - start_time
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

                    cost = get_chat_model_cost(kwargs.get("model", "mistral-small-latest"), pricing_info, prompt_tokens, completion_tokens)
                    span.set_attribute("llm.provider", "Mistral")
                    span.set_attribute("llm.generation", "chat")
                    span.set_attribute("llm.endpoint", "mistral.chat.completion")
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

            return stream_generator()

        except Exception as e:
            logging.error(f"Error generating OTLP data: {str(e)}")

    def patched_embeddings(*args, **kwargs):
        """
        Patched version of Mistral's embeddings method.

        Args:
            *args: Variable positional arguments.
            **kwargs: Variable keyword arguments.

        Returns:
            MistralResponse: The response from Mistral's embeddings method.
        """

        start_time = time.time()
        response = original_mistral_embeddings(*args, **kwargs)
        end_time = time.time()
        try:
            with tracer.start_as_current_span("mistral.embeddings", kind= SpanKind.CLIENT) as span:
                duration = end_time - start_time
                prompt = ', '.join(kwargs.get('input', []))
                cost = get_embed_model_cost(kwargs.get('model', "mistral-embed"), pricing_info, response.usage.prompt_tokens)
                
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

            return response
        except Exception as e:
            logging.error(f"Error generating OTLP data: {str(e)}")
            return response

    llm.chat = patched_chat
    llm.chat_stream = patched_chat_stream
    llm.embeddings = patched_embeddings
