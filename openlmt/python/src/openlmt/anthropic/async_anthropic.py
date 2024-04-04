# pylint: disable=duplicate-code
"""
Module for monitoring Anthropic API calls.
"""

import time
import logging
from ..__helpers import get_chat_model_cost
from opentelemetry.trace import SpanKind

# pylint: disable=too-many-arguments, too-many-statements
def init(llm, environment, application_name, tracer, pricing_info):
    """
    Initialize Anthropic integration with Doku.

    Args:
        llm: The Anthropic function to be patched.
        doku_url (str): Doku URL.
        api_key (str): Authentication api_key.
        environment (str): Doku environment.
        application_name (str): Doku application name.
        skip_resp (bool): Skip response processing.
    """

    original_messages_create = llm.messages.create

    # pylint: disable=too-many-locals
    async def patched_messages_create(*args, **kwargs):
        """
        Patched version of Anthropic's messages.create method.

        Args:
            *args: Variable positional arguments.
            **kwargs: Variable keyword arguments.

        Returns:
            AnthropicResponse: The response from Anthropic's messages.create.
        """
        try:
            streaming = kwargs.get("stream", False)
            start_time = time.time()

            # pylint: disable=no-else-return
            if streaming:
                async def stream_generator():
                    llmresponse = ""
                    async for event in await original_messages_create(*args, **kwargs):
                        if event.type == "message_start":
                            response_id = event.message.id
                            prompt_tokens = event.message.usage.input_tokens
                        if event.type == "content_block_delta":
                            llmresponse += event.delta.text
                        if event.type == "message_delta":
                            completion_tokens = event.usage.output_tokens
                            finish_reason = event.delta.stop_reason
                        yield event
                    with tracer.start_as_current_span("anthropic.messages", kind= SpanKind.CLIENT) as span:
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
                        cost = get_chat_model_cost(kwargs.get("model", "claude-3-sonnet-20240229"), pricing_info, prompt_tokens, completion_tokens)
                        span.set_attribute("llm.provider", "Anthropic")
                        span.set_attribute("llm.generation", "chat")
                        span.set_attribute("llm.endpoint", "anthropic.messages")
                        span.set_attribute("llm.req.id", response_id)
                        span.set_attribute("llm.environment", environment)
                        span.set_attribute("llm.application.name", application_name)
                        span.set_attribute("llm.request.duration", duration)
                        span.set_attribute("llm.model", kwargs.get("model", "claude-3-sonnet-20240229"))
                        span.set_attribute("llm.max.tokens", kwargs.get("max_tokens", ""))
                        span.set_attribute("llm.prompt", prompt)
                        span.set_attribute("llm.stream", True)
                        span.set_attribute("llm.temperature", kwargs.get("temperature", 1.0))
                        span.set_attribute("llm.top.p", kwargs.get("top_p", ""))
                        span.set_attribute("llm.top.k", kwargs.get("top_k", ""))
                        span.set_attribute("llm.finish.reason", finish_reason)
                        span.set_attribute("llm.response", llmresponse)
                        span.set_attribute("llm.promptTokens", prompt_tokens)
                        span.set_attribute("llm.completionTokens", completion_tokens)
                        span.set_attribute("llm.totalTokens", prompt_tokens + completion_tokens)
                        span.set_attribute("llm.cost", cost)

                return stream_generator()
            else:
                start_time = time.time()
                response = await original_messages_create(*args, **kwargs)
                end_time = time.time()
                with tracer.start_as_current_span("anthropic.messages", kind=SpanKind.CLIENT) as span:
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
                    cost = get_chat_model_cost(kwargs.get("model", "claude-3-sonnet-20240229"), pricing_info, response.usage.input_tokens, response.usage.output_tokens)
                    span.set_attribute("llm.provider", "Anthropic")
                    span.set_attribute("llm.generation", "chat")
                    span.set_attribute("llm.endpoint", "anthropic.messages")
                    span.set_attribute("llm.req.id", response.id)
                    span.set_attribute("llm.environment", environment)
                    span.set_attribute("llm.application.name", application_name)
                    span.set_attribute("llm.request.duration", duration)
                    span.set_attribute("llm.model", kwargs.get("model", "claude-3-sonnet-20240229"))
                    span.set_attribute("llm.max.tokens", kwargs.get("max_tokens", ""))
                    span.set_attribute("llm.prompt", prompt)
                    span.set_attribute("llm.stream", False)
                    span.set_attribute("llm.temperature", kwargs.get("temperature", 1.0))
                    span.set_attribute("llm.top.p", kwargs.get("top_p", ""))
                    span.set_attribute("llm.top.k", kwargs.get("top_k", ""))
                    span.set_attribute("llm.finish.reason", response.stop_reason)
                    span.set_attribute("llm.response", response.content[0].text if response.content else "")
                    span.set_attribute("llm.promptTokens", response.usage.input_tokens)
                    span.set_attribute("llm.completionTokens", response.usage.output_tokens)
                    span.set_attribute("llm.totalTokens", response.usage.input_tokens + response.usage.output_tokens)
                    span.set_attribute("llm.cost", cost)

                return response
        except Exception as e:
            logging.error(f"Error generating OTLP data: {str(e)}")

    llm.messages.create = patched_messages_create
