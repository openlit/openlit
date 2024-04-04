# pylint: disable=duplicate-code
"""
Module for monitoring Cohere API calls.
"""

import time
import logging
from ..__helpers import get_chat_model_cost, get_embed_model_cost
from opentelemetry.trace import SpanKind

# pylint: disable=too-many-arguments, too-many-statements
def init(llm, environment, application_name, tracer, pricing_info):
    """
    Initialize Cohere monitoring for Doku.
    """

    original_embed = llm.embed
    original_chat = llm.chat
    original_chat_stream = llm.chat_stream

    def embeddings_generate(*args, **kwargs):
        """
        Patched version of Cohere's embeddings generate method.

        Args:
            *args: Variable positional arguments.
            **kwargs: Variable keyword arguments.

        Returns:
            CohereResponse: The response from Cohere's embeddings generate method.
        """

        start_time = time.time()
        response = original_embed(*args, **kwargs)
        end_time = time.time()
        try:
            with tracer.start_as_current_span("cohere.embed", kind= SpanKind.CLIENT) as span:
                duration = end_time - start_time
                prompt = " ".join(kwargs.get("texts", []))

                cost = get_embed_model_cost(kwargs.get("model", "embed-english-v2.0"), pricing_info, response.meta.billed_units.input_tokens)
                
                span.set_attribute("llm.provider", "Cohere")
                span.set_attribute("llm.generation", "Embedding")
                span.set_attribute("llm.endpoint", "cohere.embed")
                span.set_attribute("llm.environment", environment)
                span.set_attribute("llm.application.name", application_name)
                span.set_attribute("llm.request.duration", duration)
                span.set_attribute("llm.model", kwargs.get("model", "embed-english-v2.0"),)
                span.set_attribute("llm.prompt", prompt)
                span.set_attribute("llm.embedding.format", kwargs.get("embedding_types", "float"))
                span.set_attribute("llm.embedding.dimensions", kwargs.get("input_type", ""))
                span.set_attribute("llm.user", kwargs.get("user", ""))
                span.set_attribute("llm.req.id", response.id)
                span.set_attribute("llm.promptTokens", response.meta.billed_units.input_tokens)
                span.set_attribute("llm.totalTokens", response.meta.billed_units.input_tokens)
                span.set_attribute("llm.cost", cost)

            return response
        except Exception as e:
            logging.error(f"Error generating OTLP data: {str(e)}")
            return response

    def chat_generate(*args, **kwargs):
        """
        Patched version of Cohere's chat generate method.

        Args:
            *args: Variable positional arguments.
            **kwargs: Variable keyword arguments.

        Returns:
            CohereResponse: The response from Cohere's chat generate method.
        """

        start_time = time.time()
        response = original_chat(*args, **kwargs)
        end_time = time.time()
        try:
            with tracer.start_as_current_span("cohere.chat", kind=SpanKind.CLIENT) as span:
                duration = end_time - start_time

                cost = get_chat_model_cost(kwargs.get("model", "command"), pricing_info, response.meta["billed_units"]["input_tokens"], response.meta["billed_units"]["output_tokens"])
                span.set_attribute("llm.provider", "Cohere")
                span.set_attribute("llm.generation", "chat")
                span.set_attribute("llm.endpoint", "cohere.chat")
                span.set_attribute("llm.environment", environment)
                span.set_attribute("llm.application.name", application_name)
                span.set_attribute("llm.request.duration", duration)
                span.set_attribute("llm.model", kwargs.get("model", "command"))
                span.set_attribute("llm.temperature", kwargs.get("temperature", 0.3))
                span.set_attribute("llm.max.tokens", kwargs.get("max_tokens", ""))
                span.set_attribute("llm.seed", kwargs.get("seed", ""))
                span.set_attribute("llm.frequency.penalty", kwargs.get("frequency_penalty", 0.0))
                span.set_attribute("llm.presence.penalty", kwargs.get("presence_penalty", 0.0))
                span.set_attribute("llm.stream", False)
                span.set_attribute("llm.prompt", kwargs.get("message", ""))
                span.set_attribute("llm.req.id", response.response_id)
                span.set_attribute("llm.finish.reason", response.response_id)
                span.set_attribute("llm.response", response.text)
                span.set_attribute("llm.promptTokens", response.meta["billed_units"]["input_tokens"])
                span.set_attribute("llm.completionTokens", response.meta["billed_units"]["output_tokens"])
                span.set_attribute("llm.totalTokens", response.token_count["billed_tokens"])
                span.set_attribute("llm.cost", cost)

            return response

        except Exception as e:
            logging.error(f"Error generating OTLP data: {str(e)}")
            return response

    #pylint: disable=too-many-locals
    def patched_chat_stream(*args, **kwargs):
        """
        Patched version of Cohere's chat_stream method.

        Args:
            *args: Variable positional arguments.
            **kwargs: Variable keyword arguments.

        Returns:
            CohereResponse: The response from Cohere's chat_stream.
        """

        try:
            start_time = time.time()
            def stream_generator():
                llmresponse = ""
                response_id = ""
                prompt_tokens = -1
                completion_tokens = -1
                total_tokens = -1
                finish_reason = ""
                for event in original_chat_stream(*args, **kwargs):
                    if event.event_type == "stream-end":
                        llmresponse = event.response.text
                        response_id = event.response.response_id
                        prompt_tokens = event.response.meta["billed_units"]["input_tokens"]
                        completion_tokens = event.response.meta["billed_units"]["output_tokens"]
                        total_tokens = event.response.token_count["billed_tokens"]
                        finish_reason = event.finish_reason
                    yield event
                with tracer.start_as_current_span("cohere.chat", kind= SpanKind.CLIENT) as span:
                    end_time = time.time()
                    duration = end_time - start_time

                    cost = get_chat_model_cost(kwargs.get("model", "command"), pricing_info, prompt_tokens, completion_tokens)
                    span.set_attribute("llm.provider", "Cohere")
                    span.set_attribute("llm.generation", "chat")
                    span.set_attribute("llm.endpoint", "cohere.chat")
                    span.set_attribute("llm.environment", environment)
                    span.set_attribute("llm.application.name", application_name)
                    span.set_attribute("llm.request.duration", duration)
                    span.set_attribute("llm.model", kwargs.get("model", "command"))
                    span.set_attribute("llm.temperature", kwargs.get("temperature", 0.3))
                    span.set_attribute("llm.max.tokens", kwargs.get("max_tokens", ""))
                    span.set_attribute("llm.seed", kwargs.get("seed", ""))
                    span.set_attribute("llm.frequency.penalty", kwargs.get("frequency_penalty", 0.0))
                    span.set_attribute("llm.presence.penalty", kwargs.get("presence_penalty", 0.0))
                    span.set_attribute("llm.stream", True)
                    span.set_attribute("llm.prompt", kwargs.get("message", ""))
                    span.set_attribute("llm.req.id", response_id)
                    span.set_attribute("llm.finish.reason", finish_reason)
                    span.set_attribute("llm.response", llmresponse)
                    span.set_attribute("llm.promptTokens", prompt_tokens)
                    span.set_attribute("llm.completionTokens", completion_tokens)
                    span.set_attribute("llm.totalTokens", total_tokens)
                    span.set_attribute("llm.cost", cost)

            return stream_generator()

        except Exception as e:
            logging.error(f"Error generating OTLP data: {str(e)}")

    llm.embed = embeddings_generate
    llm.chat = chat_generate
    llm.chat_stream = patched_chat_stream