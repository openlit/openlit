# pylint: disable=duplicate-code
"""
Module for monitoring Azure OpenAI API calls.
"""

import time
import logging
from ..__helpers import get_chat_model_cost, get_embed_model_cost, get_image_model_cost, openai_tokens, handle_exception
from opentelemetry.trace import SpanKind

# Initialize logger for logging potential issues and operations
logger = logging.getLogger(__name__)

# pylint: disable=too-many-locals, too-many-arguments, too-many-statements
def init(llm, environment, application_name, tracer, pricing_info):
    """
    Initializes the instrumentation process by patching the Azure OpenAI client
    methods to gather telemetry data during its execution.

    Args:
        llm: Reference to the Azure OpenAI client being instrumented.
        environment (str): Identifier for the environment (e.g., 'production', 'development').
        application_name (str): Name of the application using the instrumented client.
        tracer: OpenTelemetry tracer object used for creating spans.
        pricing_info (dict): Contains pricing information for calculating the cost of operations.
    """

    # Backup original functions for later restoration if needed
    original_chat_create = llm.chat.completions.create
    original_completions_create = llm.completions.create
    original_embeddings_create = llm.embeddings.create
    original_images_create = llm.images.generate

    def llm_chat_completions(*args, **kwargs):
        """
        A patched version of the 'chat.completions.create' method, enabling telemetry data collection.

        This method wraps the original call to 'chat.completions.create', adding a telemetry layer that
        captures execution time, error handling, and other metrics.

        Args:
            *args: Variable positional arguments passed to the original method.
            **kwargs: Variable keyword arguments passed to the original method.

        Returns:
            The response from the original 'chat.completions.create' method.
        """

        # Check if streaming is enabled for the API call
        start_time = time.time()
        # Record start time for measuring request duration
        streaming = kwargs.get("stream", False)

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
                        # pylint: disable=line-too-long
                        if len(chunk.choices) > 0:
                            if hasattr(chunk.choices[0], "delta") and hasattr(chunk.choices[0].delta, "content"):
                                content = chunk.choices[0].delta.content
                                if content:
                                    llmresponse += content
                        yield chunk
                        response_id = chunk.id
                        model = "azure_" + chunk.model

                    # Sections handling exceptions ensure observability without disrupting operations
                    try:
                        with tracer.start_as_current_span("azure.openai.chat.completions" , kind= SpanKind.CLIENT) as span:
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

                    except Exception as e:
                        handle_exception(tracer, e, "azure.openai.chat.completions")
                        logger.error(f"Error in patched message creation: {e}")

                except Exception as e:
                    handle_exception(tracer, e, "azure.openai.chat.completions")
                    raise e

            return stream_generator()

        # Handling for non-streaming responses
        else:
            try:
                response = original_chat_create(*args, **kwargs)
                end_time = time.time()

                try:
                    with tracer.start_as_current_span("azure.openai.chat.completions", kind= SpanKind.CLIENT) as span:
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
                    handle_exception(tracer, e, "azure.openai.chat.completions")
                    logger.error(f"Error in patched message creation: {e}")

                    # Return original response
                    return response
            
            except Exception as e:
                handle_exception(tracer, e, "azure.openai.chat.completions")
                raise e

    def llm_completions(*args, **kwargs):
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
        start_time = time.time()
        # Record start time for measuring request duration
        streaming = kwargs.get("stream", False)

        # pylint: disable=no-else-return
        if streaming:
            # Special handling for streaming response to accommodate the nature of data flow
            def stream_generator():
                # Placeholder for aggregating streaming response
                llmresponse = ""

                try:
                    # Loop through streaming events capturing relevant details
                    for chunk in original_completions_create(*args, **kwargs):
                        # Collect message IDs and aggregated response from events
                        if len(chunk.choices) > 0:
                            if hasattr(chunk.choices[0], "text"):
                                content = chunk.choices[0].text
                                if content:
                                    llmresponse += content
                        yield chunk
                        response_id = chunk.id
                        model = "azure_" + chunk.model

                    # Sections handling exceptions ensure observability without disrupting operations
                    try:
                        with tracer.start_as_current_span("azure.openai.completions" , kind= SpanKind.CLIENT) as span:
                            end_time = time.time()
                            # Calculate total duration of operation
                            duration = end_time - start_time
                            prompt = kwargs.get("prompt", "")

                            # Calculate tokens using input prompt and aggregated response
                            prompt_tokens = openai_tokens(prompt, "gpt-3.5-turbo")
                            completion_tokens = openai_tokens(llmresponse, "gpt-3.5-turbo")

                            # Calculate cost of the operation
                            cost = get_chat_model_cost(model, pricing_info, prompt_tokens, completion_tokens)

                            # Set Span attributes
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

                    except Exception as e:
                        handle_exception(tracer, e, "azure.openai.completions")
                        logger.error(f"Error in patched message creation: {e}")

                except Exception as e:
                    handle_exception(tracer, e, "azure.openai.completions")
                    raise e

            return stream_generator()

        # Handling for non-streaming responses
        else:
            try:
                response = original_completions_create(*args, **kwargs)
                end_time = time.time()

                try:
                    with tracer.start_as_current_span("azure.openai.completions", kind= SpanKind.CLIENT) as span:
                        # Calculate total duration of operation
                        duration = end_time - start_time

                        # Find base model from response
                        model = "azure_" + response.model

                        # Set base span attribues
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

                        # Set span attributes when tools is not passed to the function call
                        if "tools" not in kwargs:
                            # Calculate cost of the operation
                            cost = get_chat_model_cost(model, pricing_info, response.usage.prompt_tokens, response.usage.completion_tokens)

                            span.set_attribute("llm.promptTokens", response.usage.prompt_tokens)
                            span.set_attribute("llm.completionTokens", response.usage.completion_tokens)
                            span.set_attribute("llm.totalTokens", response.usage.total_tokens)
                            span.set_attribute("llm.finish.reason", response.choices[0].finish_reason)
                            span.set_attribute("llm.cost", cost)

                            # Set span attributes for when n = 1 (default)
                            if "n" not in kwargs or kwargs["n"] == 1:
                                span.set_attribute("llm.response", response.choices[0].text)

                            # Set span attributes for when n > 0
                            else:
                                i = 0
                                while i < kwargs["n"]:
                                    attribute_name = f"llm.response.{i}"
                                    span.set_attribute(attribute_name, response.choices[i].text)
                                    i += 1
                                return response

                        # Set span attributes when tools is passed to the function call
                        elif "tools" in kwargs:
                            # Calculate cost of the operation
                            cost = get_chat_model_cost(model, pricing_info, response.usage.prompt_tokens, response.usage.completion_tokens)

                            span.set_attribute("llm.response", "Function called with tools")
                            span.set_attribute("llm.promptTokens", response.usage.prompt_tokens)
                            span.set_attribute("llm.completionTokens", response.usage.completion_tokens)
                            span.set_attribute("llm.totalTokens", response.usage.total_tokens)
                            span.set_attribute("llm.cost", cost)

                    # Return original response
                    return response

                except Exception as e:
                    handle_exception(tracer, e, "azure.openai.completions")
                    logger.error(f"Error in patched message creation: {e}")

                    # Return original response
                    return response

            except Exception as e:
                handle_exception(tracer, e, "azure.openai.completions")
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
                with tracer.start_as_current_span("azure.openai.embeddings", kind= SpanKind.CLIENT) as span:
                    # Calculate total duration of operation
                    duration = end_time - start_time

                    # Calculate cost of the operation
                    cost = get_embed_model_cost("azure_" + response.model, pricing_info, response.usage.prompt_tokens)

                    # Set Span attributes
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

                    # Return original response
                    return response

            except Exception as e:
                handle_exception(tracer, e, "azure.openai.embeddings")
                logger.error(f"Error in patched message creation: {e}")

                # Return original response
                return response

        except Exception as e:
            handle_exception(tracer, e, "azure.openai.embeddings")
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
                with tracer.start_as_current_span("azure.openai.images.generate", kind= SpanKind.CLIENT) as span:
                    # Calculate total duration of operation
                    duration = end_time - start_time

                    # Find Image format
                    if "response_format" in kwargs and kwargs["response_format"] == "b64_json":
                        image = "b64_json"
                    else:
                        image = "url"

                    # Calculate cost of the operation
                    cost = get_image_model_cost("azure_" + kwargs.get("model", "dall-e-3"), pricing_info, kwargs.get("size", "1024x1024"), kwargs.get("quality", "standard"))

                    for items in response.data:
                        # Set Span attributes
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

                    # Return original response
                    return response

            except Exception as e:
                handle_exception(tracer, e, "azure.openai.images.generate")
                logger.error(f"Error in patched message creation: {e}")

                # Return original response
                return response

        except Exception as e:
            handle_exception(tracer, e, "azure.openai.images.generate")
            raise e

    llm.chat.completions.create = llm_chat_completions
    llm.completions.create = llm_completions
    llm.embeddings.create = patched_embeddings_create
    llm.images.generate = patched_image_create
