# pylint: disable=duplicate-code, broad-exception-caught, too-many-statements, unused-argument, too-many-branches
"""
Module for monitoring OpenAI API calls.
"""

import logging
from opentelemetry.trace import SpanKind, Status, StatusCode
from opentelemetry.sdk.resources import TELEMETRY_SDK_NAME
from openlit.__helpers import (
    get_chat_model_cost,
    get_embed_model_cost,
    get_audio_model_cost,
    get_image_model_cost,
    openai_tokens,
    handle_exception,
    response_as_dict,
)
from openlit.semcov import SemanticConvetion

# Initialize logger for logging potential issues and operations
logger = logging.getLogger(__name__)

def chat_completions(gen_ai_endpoint, version, environment, application_name,
                     tracer, pricing_info, trace_content, metrics, disable_metrics):
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

    class TracedSyncStream:
        """
        Wrapper for streaming responses to collect metrics and trace data.
        Wraps the 'openai.AsyncStream' response to collect message IDs and aggregated response.

        This class implements the '__aiter__' and '__anext__' methods that
        handle asynchronous streaming responses.

        This class also implements '__aenter__' and '__aexit__' methods that
        handle asynchronous context management protocol.
        """
        def __init__(
                self,
                wrapped,
                span,
                kwargs,
                **args,
            ):
            self.__wrapped__ = wrapped
            self._span = span
            # Placeholder for aggregating streaming response
            self._llmresponse = ""
            self._response_id = ""

            self._args = args
            self._kwargs = kwargs

        def __enter__(self):
            self.__wrapped__.__enter__()
            return self

        def __exit__(self, exc_type, exc_value, traceback):
            self.__wrapped__.__exit__(exc_type, exc_value, traceback)

        def __iter__(self):
            return self

        def __getattr__(self, name):
            """Delegate attribute access to the wrapped object."""
            return getattr(self.__wrapped__, name)

        def __next__(self):
            try:
                chunk = self.__wrapped__.__next__()
                chunked = response_as_dict(chunk)
                # Collect message IDs and aggregated response from events
                if (len(chunked.get('choices')) > 0 and ('delta' in chunked.get('choices')[0] and
                    'content' in chunked.get('choices')[0].get('delta'))):

                    content = chunked.get('choices')[0].get('delta').get('content')
                    if content:
                        self._llmresponse += content
                self._response_id = chunked.get('id')
                return chunk
            except StopIteration:
                # Handling exception ensure observability without disrupting operation
                try:
                    # Format 'messages' into a single string
                    message_prompt = self._kwargs.get("messages", "")
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
                                                    self._kwargs.get("model", "gpt-3.5-turbo"))
                    completion_tokens = openai_tokens(self._llmresponse,
                                                        self._kwargs.get("model", "gpt-3.5-turbo"))

                    # Calculate cost of the operation
                    cost = get_chat_model_cost(self._kwargs.get("model", "gpt-3.5-turbo"),
                                                pricing_info, prompt_tokens,
                                                completion_tokens)

                    # Set Span attributes
                    self._span.set_attribute(TELEMETRY_SDK_NAME, "openlit")
                    self._span.set_attribute(SemanticConvetion.GEN_AI_SYSTEM,
                                        SemanticConvetion.GEN_AI_SYSTEM_OPENAI)
                    self._span.set_attribute(SemanticConvetion.GEN_AI_TYPE,
                                        SemanticConvetion.GEN_AI_TYPE_CHAT)
                    self._span.set_attribute(SemanticConvetion.GEN_AI_ENDPOINT,
                                        gen_ai_endpoint)
                    self._span.set_attribute(SemanticConvetion.GEN_AI_RESPONSE_ID,
                                        self._response_id)
                    self._span.set_attribute(SemanticConvetion.GEN_AI_ENVIRONMENT,
                                        environment)
                    self._span.set_attribute(SemanticConvetion.GEN_AI_APPLICATION_NAME,
                                        application_name)
                    self._span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_MODEL,
                                        self._kwargs.get("model", "gpt-3.5-turbo"))
                    self._span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_USER,
                                        self._kwargs.get("user", ""))
                    self._span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_TOP_P,
                                        self._kwargs.get("top_p", 1.0))
                    self._span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_MAX_TOKENS,
                                        self._kwargs.get("max_tokens", -1))
                    self._span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_TEMPERATURE,
                                        self._kwargs.get("temperature", 1.0))
                    self._span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_PRESENCE_PENALTY,
                                        self._kwargs.get("presence_penalty", 0.0))
                    self._span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_FREQUENCY_PENALTY,
                                        self._kwargs.get("frequency_penalty", 0.0))
                    self._span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_SEED,
                                        self._kwargs.get("seed", ""))
                    self._span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_IS_STREAM,
                                        True)
                    self._span.set_attribute(SemanticConvetion.GEN_AI_USAGE_PROMPT_TOKENS,
                                        prompt_tokens)
                    self._span.set_attribute(SemanticConvetion.GEN_AI_USAGE_COMPLETION_TOKENS,
                                        completion_tokens)
                    self._span.set_attribute(SemanticConvetion.GEN_AI_USAGE_TOTAL_TOKENS,
                                        prompt_tokens + completion_tokens)
                    self._span.set_attribute(SemanticConvetion.GEN_AI_USAGE_COST,
                                        cost)
                    if trace_content:
                        self._span.add_event(
                            name=SemanticConvetion.GEN_AI_CONTENT_PROMPT_EVENT,
                            attributes={
                                SemanticConvetion.GEN_AI_CONTENT_PROMPT: prompt,
                            },
                        )
                        self._span.add_event(
                            name=SemanticConvetion.GEN_AI_CONTENT_COMPLETION_EVENT,
                            attributes={
                                SemanticConvetion.GEN_AI_CONTENT_COMPLETION: self._llmresponse,
                            },
                        )

                    self._span.set_status(Status(StatusCode.OK))

                    if disable_metrics is False:
                        attributes = {
                            TELEMETRY_SDK_NAME:
                                "openlit",
                            SemanticConvetion.GEN_AI_APPLICATION_NAME:
                                application_name,
                            SemanticConvetion.GEN_AI_SYSTEM:
                                SemanticConvetion.GEN_AI_SYSTEM_OPENAI,
                            SemanticConvetion.GEN_AI_ENVIRONMENT:
                                environment,
                            SemanticConvetion.GEN_AI_TYPE:
                                SemanticConvetion.GEN_AI_TYPE_CHAT,
                            SemanticConvetion.GEN_AI_REQUEST_MODEL:
                                self._kwargs.get("model", "gpt-3.5-turbo")
                        }

                        metrics["genai_requests"].add(1, attributes)
                        metrics["genai_total_tokens"].add(
                            prompt_tokens + completion_tokens, attributes
                        )
                        metrics["genai_completion_tokens"].add(completion_tokens, attributes)
                        metrics["genai_prompt_tokens"].add(prompt_tokens, attributes)
                        metrics["genai_cost"].record(cost, attributes)

                except Exception as e:
                    handle_exception(self._span, e)
                    logger.error("Error in trace creation: %s", e)
                finally:
                    self._span.end()
                raise

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
            awaited_wrapped = wrapped(*args, **kwargs)
            span = tracer.start_span(gen_ai_endpoint, kind=SpanKind.CLIENT)

            return TracedSyncStream(awaited_wrapped, span, kwargs)

        # Handling for non-streaming responses
        else:
            # pylint: disable=line-too-long
            with tracer.start_as_current_span(gen_ai_endpoint, kind= SpanKind.CLIENT) as span:
                response = wrapped(*args, **kwargs)

                response_dict = response_as_dict(response)

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
                    span.set_attribute(TELEMETRY_SDK_NAME, "openlit")
                    span.set_attribute(SemanticConvetion.GEN_AI_SYSTEM,
                                        SemanticConvetion.GEN_AI_SYSTEM_OPENAI)
                    span.set_attribute(SemanticConvetion.GEN_AI_TYPE,
                                        SemanticConvetion.GEN_AI_TYPE_CHAT)
                    span.set_attribute(SemanticConvetion.GEN_AI_ENDPOINT,
                                        gen_ai_endpoint)
                    span.set_attribute(SemanticConvetion.GEN_AI_RESPONSE_ID,
                                        response_dict.get("id"))
                    span.set_attribute(SemanticConvetion.GEN_AI_ENVIRONMENT,
                                        environment)
                    span.set_attribute(SemanticConvetion.GEN_AI_APPLICATION_NAME,
                                        application_name)
                    span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_MODEL,
                                        kwargs.get("model", "gpt-3.5-turbo"))
                    span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_TOP_P,
                                        kwargs.get("top_p", 1.0))
                    span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_MAX_TOKENS,
                                        kwargs.get("max_tokens", -1))
                    span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_USER,
                                        kwargs.get("user", ""))
                    span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_TEMPERATURE,
                                        kwargs.get("temperature", 1.0))
                    span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_PRESENCE_PENALTY,
                                        kwargs.get("presence_penalty", 0.0))
                    span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_FREQUENCY_PENALTY,
                                        kwargs.get("frequency_penalty", 0.0))
                    span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_SEED,
                                        kwargs.get("seed", ""))
                    span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_IS_STREAM,
                                        False)
                    if trace_content:
                        span.add_event(
                            name=SemanticConvetion.GEN_AI_CONTENT_PROMPT_EVENT,
                            attributes={
                                SemanticConvetion.GEN_AI_CONTENT_PROMPT: prompt,
                            },
                        )

                    # Set span attributes when tools is not passed to the function call
                    if "tools" not in kwargs:
                        # Calculate cost of the operation
                        cost = get_chat_model_cost(kwargs.get("model", "gpt-3.5-turbo"),
                                                    pricing_info, response_dict.get('usage', {}).get('prompt_tokens', None),
                                                    response_dict.get('usage', {}).get('completion_tokens', None))

                        span.set_attribute(SemanticConvetion.GEN_AI_USAGE_PROMPT_TOKENS,
                                           response_dict.get('usage', {}).get('prompt_tokens', None))
                        span.set_attribute(SemanticConvetion.GEN_AI_USAGE_COMPLETION_TOKENS,
                                           response_dict.get('usage', {}).get('completion_tokens', None))
                        span.set_attribute(SemanticConvetion.GEN_AI_USAGE_TOTAL_TOKENS,
                                           response_dict.get('usage', {}).get('total_tokens', None))
                        span.set_attribute(SemanticConvetion.GEN_AI_RESPONSE_FINISH_REASON,
                                           [response_dict.get('choices', [])[0].get('finish_reason', None)])
                        span.set_attribute(SemanticConvetion.GEN_AI_USAGE_COST,
                                            cost)

                        # Set span attributes for when n = 1 (default)
                        if "n" not in kwargs or kwargs["n"] == 1:
                            if trace_content:
                                span.add_event(
                                    name=SemanticConvetion.GEN_AI_CONTENT_COMPLETION_EVENT,
                                    attributes={
                                        SemanticConvetion.GEN_AI_CONTENT_COMPLETION: response_dict.get('choices', [])[0].get("message").get("content"),
                                    },
                                )

                        # Set span attributes for when n > 0
                        else:
                            i = 0
                            while i < kwargs["n"] and trace_content is True:
                                attribute_name = f"gen_ai.content.completion.{i}"
                                span.add_event(
                                    name=attribute_name,
                                    attributes={
                                        SemanticConvetion.GEN_AI_CONTENT_COMPLETION: response_dict.get('choices')[i].get("message").get("content"),
                                    },
                                )
                                i += 1

                            # Return original response
                            return response

                    # Set span attributes when tools is passed to the function call
                    elif "tools" in kwargs:
                        # Calculate cost of the operation
                        cost = get_chat_model_cost(kwargs.get("model", "gpt-3.5-turbo"),
                                                    pricing_info, response_dict.get('usage').get('prompt_tokens'),
                                                    response_dict.get('usage').get('completion_tokens'))
                        span.add_event(
                            name=SemanticConvetion.GEN_AI_CONTENT_COMPLETION_EVENT,
                            attributes={
                                SemanticConvetion.GEN_AI_CONTENT_COMPLETION: "Function called with tools",
                            },
                        )
                        span.set_attribute(SemanticConvetion.GEN_AI_USAGE_PROMPT_TOKENS,
                                            response_dict.get('usage').get('prompt_tokens'))
                        span.set_attribute(SemanticConvetion.GEN_AI_USAGE_COMPLETION_TOKENS,
                                            response_dict.get('usage').get('completion_tokens'))
                        span.set_attribute(SemanticConvetion.GEN_AI_USAGE_TOTAL_TOKENS,
                                            response_dict.get('usage').get('total_tokens'))
                        span.set_attribute(SemanticConvetion.GEN_AI_USAGE_COST,
                                            cost)

                    span.set_status(Status(StatusCode.OK))

                    if disable_metrics is False:
                        attributes = {
                            TELEMETRY_SDK_NAME:
                                "openlit",
                            SemanticConvetion.GEN_AI_APPLICATION_NAME:
                                application_name,
                            SemanticConvetion.GEN_AI_SYSTEM:
                                SemanticConvetion.GEN_AI_SYSTEM_OPENAI,
                            SemanticConvetion.GEN_AI_ENVIRONMENT:
                                environment,
                            SemanticConvetion.GEN_AI_TYPE:
                                SemanticConvetion.GEN_AI_TYPE_CHAT,
                            SemanticConvetion.GEN_AI_REQUEST_MODEL:
                                kwargs.get("model", "gpt-3.5-turbo")
                        }

                        metrics["genai_requests"].add(1, attributes)
                        metrics["genai_total_tokens"].add(response_dict.get('usage').get('total_tokens'), attributes)
                        metrics["genai_completion_tokens"].add(response_dict.get('usage').get('completion_tokens'), attributes)
                        metrics["genai_prompt_tokens"].add(response_dict.get('usage').get('prompt_tokens'), attributes)
                        metrics["genai_cost"].record(cost, attributes)

                    # Return original response
                    return response

                except Exception as e:
                    handle_exception(span, e)
                    logger.error("Error in trace creation: %s", e)

                    # Return original response
                    return response

    return wrapper

def embedding(gen_ai_endpoint, version, environment, application_name,
              tracer, pricing_info, trace_content, metrics, disable_metrics):
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
            response = wrapped(*args, **kwargs)
            response_dict = response_as_dict(response)
            try:
                # Calculate cost of the operation
                cost = get_embed_model_cost(kwargs.get("model", "text-embedding-ada-002"),
                                    pricing_info, response_dict.get('usage').get('prompt_tokens'))

                # Set Span attributes
                span.set_attribute(TELEMETRY_SDK_NAME, "openlit")
                span.set_attribute(SemanticConvetion.GEN_AI_SYSTEM,
                                    SemanticConvetion.GEN_AI_SYSTEM_OPENAI)
                span.set_attribute(SemanticConvetion.GEN_AI_TYPE,
                                    SemanticConvetion.GEN_AI_TYPE_EMBEDDING)
                span.set_attribute(SemanticConvetion.GEN_AI_ENDPOINT,
                                    gen_ai_endpoint)
                span.set_attribute(SemanticConvetion.GEN_AI_ENVIRONMENT,
                                    environment)
                span.set_attribute(SemanticConvetion.GEN_AI_APPLICATION_NAME,
                                    application_name)
                span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_MODEL,
                                    kwargs.get("model", "text-embedding-ada-002"))
                span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_EMBEDDING_FORMAT,
                                    kwargs.get("encoding_format", "float"))
                # span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_EMBEDDING_DIMENSION,
                #                     kwargs.get("dimensions", "null"))
                span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_USER,
                                    kwargs.get("user", ""))
                span.set_attribute(SemanticConvetion.GEN_AI_USAGE_PROMPT_TOKENS,
                                    response_dict.get('usage').get('prompt_tokens'))
                span.set_attribute(SemanticConvetion.GEN_AI_USAGE_TOTAL_TOKENS,
                                    response_dict.get('usage').get('total_tokens'))
                span.set_attribute(SemanticConvetion.GEN_AI_USAGE_COST,
                                    cost)
                if trace_content:
                    span.add_event(
                        name=SemanticConvetion.GEN_AI_CONTENT_PROMPT_EVENT,
                        attributes={
                            SemanticConvetion.GEN_AI_CONTENT_PROMPT: kwargs.get("input", ""),
                        },
                    )

                span.set_status(Status(StatusCode.OK))

                if disable_metrics is False:
                    attributes = {
                        TELEMETRY_SDK_NAME:
                            "openlit",
                        SemanticConvetion.GEN_AI_APPLICATION_NAME:
                            application_name,
                        SemanticConvetion.GEN_AI_SYSTEM:
                            SemanticConvetion.GEN_AI_SYSTEM_OPENAI,
                        SemanticConvetion.GEN_AI_ENVIRONMENT:
                            environment,
                        SemanticConvetion.GEN_AI_TYPE:
                            SemanticConvetion.GEN_AI_TYPE_EMBEDDING,
                        SemanticConvetion.GEN_AI_REQUEST_MODEL:
                            kwargs.get("model", "text-embedding-ada-002")
                    }

                    metrics["genai_requests"].add(1, attributes)
                    metrics["genai_total_tokens"].add(
                        response_dict.get('usage').get('total_tokens'), attributes)
                    metrics["genai_prompt_tokens"].add(
                        response_dict.get('usage').get('prompt_tokens'), attributes)
                    metrics["genai_cost"].record(cost, attributes)

                # Return original response
                return response

            except Exception as e:
                handle_exception(span, e)
                logger.error("Error in trace creation: %s", e)

                # Return original response
                return response

    return wrapper

def finetune(gen_ai_endpoint, version, environment, application_name,
             tracer, pricing_info, trace_content, metrics, disable_metrics):
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
            response = wrapped(*args, **kwargs)

            # Handling exception ensure observability without disrupting operation
            try:
                # Set Span attributes
                span.set_attribute(TELEMETRY_SDK_NAME, "openlit")
                span.set_attribute(SemanticConvetion.GEN_AI_SYSTEM,
                                    SemanticConvetion.GEN_AI_SYSTEM_OPENAI)
                span.set_attribute(SemanticConvetion.GEN_AI_TYPE,
                                    SemanticConvetion.GEN_AI_TYPE_FINETUNING)
                span.set_attribute(SemanticConvetion.GEN_AI_ENDPOINT,
                                    gen_ai_endpoint)
                span.set_attribute(SemanticConvetion.GEN_AI_ENVIRONMENT,
                                    environment)
                span.set_attribute(SemanticConvetion.GEN_AI_APPLICATION_NAME,
                                    application_name)
                span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_MODEL,
                                    kwargs.get("model", "gpt-3.5-turbo"))
                span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_TRAINING_FILE,
                                    kwargs.get("training_file", ""))
                span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_VALIDATION_FILE,
                                    kwargs.get("validation_file", ""))
                span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_FINETUNE_BATCH_SIZE,
                                    kwargs.get("hyperparameters.batch_size", "auto"))
                span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_FINETUNE_MODEL_LRM,
                                    kwargs.get("hyperparameters.learning_rate_multiplier",
                                                "auto"))
                span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_FINETUNE_MODEL_EPOCHS,
                                    kwargs.get("hyperparameters.n_epochs", "auto"))
                span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_FINETUNE_MODEL_SUFFIX,
                                    kwargs.get("suffix", ""))
                span.set_attribute(SemanticConvetion.GEN_AI_RESPONSE_ID,
                                    response.id)
                span.set_attribute(SemanticConvetion.GEN_AI_USAGE_PROMPT_TOKENS,
                                    response.usage.prompt_tokens)
                span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_FINETUNE_STATUS,
                                    response.status)
                span.set_status(Status(StatusCode.OK))

                if disable_metrics is False:
                    attributes = {
                        TELEMETRY_SDK_NAME:
                            "openlit",
                        SemanticConvetion.GEN_AI_APPLICATION_NAME:
                            application_name,
                        SemanticConvetion.GEN_AI_SYSTEM:
                            SemanticConvetion.GEN_AI_SYSTEM_OPENAI,
                        SemanticConvetion.GEN_AI_ENVIRONMENT:
                            environment,
                        SemanticConvetion.GEN_AI_TYPE:
                            SemanticConvetion.GEN_AI_TYPE_FINETUNING,
                        SemanticConvetion.GEN_AI_REQUEST_MODEL:
                            kwargs.get("model", "gpt-3.5-turbo")
                    }

                    metrics["genai_requests"].add(1, attributes)

                # Return original response
                return response

            except Exception as e:
                handle_exception(span, e)
                logger.error("Error in trace creation: %s", e)

                # Return original response
                return response

    return wrapper

def image_generate(gen_ai_endpoint, version, environment, application_name,
                   tracer, pricing_info, trace_content, metrics, disable_metrics):
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
                    span.set_attribute(TELEMETRY_SDK_NAME, "openlit")
                    span.set_attribute(SemanticConvetion.GEN_AI_SYSTEM,
                                        SemanticConvetion.GEN_AI_SYSTEM_OPENAI)
                    span.set_attribute(SemanticConvetion.GEN_AI_TYPE,
                                        SemanticConvetion.GEN_AI_TYPE_IMAGE)
                    span.set_attribute(SemanticConvetion.GEN_AI_ENDPOINT,
                                        gen_ai_endpoint)
                    span.set_attribute(SemanticConvetion.GEN_AI_RESPONSE_ID,
                                        response.created)
                    span.set_attribute(SemanticConvetion.GEN_AI_ENVIRONMENT,
                                        environment)
                    span.set_attribute(SemanticConvetion.GEN_AI_APPLICATION_NAME,
                                        application_name)
                    span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_MODEL,
                                        kwargs.get("model", "dall-e-2"))
                    span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_IMAGE_SIZE,
                                        kwargs.get("size", "1024x1024"))
                    span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_IMAGE_QUALITY,
                                        kwargs.get("quality", "standard"))
                    span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_IMAGE_STYLE,
                                        kwargs.get("style", "vivid"))
                    span.set_attribute(SemanticConvetion.GEN_AI_CONTENT_REVISED_PROMPT,
                                        items.revised_prompt if items.revised_prompt else "")
                    span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_USER,
                                        kwargs.get("user", ""))
                    if trace_content:
                        span.add_event(
                            name=SemanticConvetion.GEN_AI_CONTENT_PROMPT_EVENT,
                            attributes={
                                SemanticConvetion.GEN_AI_CONTENT_PROMPT: kwargs.get("prompt", ""),
                            },
                        )
                        attribute_name = f"gen_ai.response.image.{images_count}"
                        span.add_event(
                            name=attribute_name,
                            attributes={
                                SemanticConvetion.GEN_AI_CONTENT_COMPLETION: getattr(items, image),
                            },
                        )

                    images_count+=1

                span.set_attribute(SemanticConvetion.GEN_AI_USAGE_COST,
                                    len(response.data) * cost)
                span.set_status(Status(StatusCode.OK))

                if disable_metrics is False:
                    attributes = {
                        TELEMETRY_SDK_NAME:
                            "openlit",
                        SemanticConvetion.GEN_AI_APPLICATION_NAME:
                            application_name,
                        SemanticConvetion.GEN_AI_SYSTEM:
                            SemanticConvetion.GEN_AI_SYSTEM_OPENAI,
                        SemanticConvetion.GEN_AI_ENVIRONMENT:
                            environment,
                        SemanticConvetion.GEN_AI_TYPE:
                            SemanticConvetion.GEN_AI_TYPE_IMAGE,
                        SemanticConvetion.GEN_AI_REQUEST_MODEL:
                            kwargs.get("model", "dall-e-2")
                    }

                    metrics["genai_requests"].add(1, attributes)
                    metrics["genai_cost"].record(cost, attributes)

                # Return original response
                return response

            except Exception as e:
                handle_exception(span, e)
                logger.error("Error in trace creation: %s", e)

                # Return original response
                return response

    return wrapper

def image_variatons(gen_ai_endpoint, version, environment, application_name,
                    tracer, pricing_info, trace_content, metrics, disable_metrics):
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
                    span.set_attribute(TELEMETRY_SDK_NAME, "openlit")
                    span.set_attribute(SemanticConvetion.GEN_AI_SYSTEM,
                                        SemanticConvetion.GEN_AI_SYSTEM_OPENAI)
                    span.set_attribute(SemanticConvetion.GEN_AI_TYPE,
                                        SemanticConvetion.GEN_AI_TYPE_IMAGE)
                    span.set_attribute(SemanticConvetion.GEN_AI_ENDPOINT,
                                        gen_ai_endpoint)
                    span.set_attribute(SemanticConvetion.GEN_AI_RESPONSE_ID,
                                        response.created)
                    span.set_attribute(SemanticConvetion.GEN_AI_ENVIRONMENT,
                                        environment)
                    span.set_attribute(SemanticConvetion.GEN_AI_APPLICATION_NAME,
                                        application_name)
                    span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_MODEL,
                                        kwargs.get("model", "dall-e-2"))
                    span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_USER,
                                        kwargs.get("user", ""))
                    span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_IMAGE_SIZE,
                                        kwargs.get("size", "1024x1024"))
                    span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_IMAGE_QUALITY,
                                        "standard")
                    if trace_content:
                        attribute_name = f"gen_ai.response.image.{images_count}"
                        span.add_event(
                            name=attribute_name,
                            attributes={
                                SemanticConvetion.GEN_AI_CONTENT_COMPLETION: getattr(items, image),
                            },
                        )

                    images_count+=1

                span.set_attribute(SemanticConvetion.GEN_AI_USAGE_COST,
                                    len(response.data) * cost)
                span.set_status(Status(StatusCode.OK))

                if disable_metrics is False:
                    attributes = {
                        TELEMETRY_SDK_NAME:
                            "openlit",
                        SemanticConvetion.GEN_AI_APPLICATION_NAME:
                            application_name,
                        SemanticConvetion.GEN_AI_SYSTEM:
                            SemanticConvetion.GEN_AI_SYSTEM_OPENAI,
                        SemanticConvetion.GEN_AI_ENVIRONMENT:
                            environment,
                        SemanticConvetion.GEN_AI_TYPE:
                            SemanticConvetion.GEN_AI_TYPE_IMAGE,
                        SemanticConvetion.GEN_AI_REQUEST_MODEL:
                            kwargs.get("model", "dall-e-2")
                    }

                    metrics["genai_requests"].add(1, attributes)
                    metrics["genai_cost"].record(cost, attributes)

                # Return original response
                return response

            except Exception as e:
                handle_exception(span, e)
                logger.error("Error in trace creation: %s", e)

                # Return original response
                return response

    return wrapper

def audio_create(gen_ai_endpoint, version, environment, application_name,
                 tracer, pricing_info, trace_content, metrics, disable_metrics):
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
            response = wrapped(*args, **kwargs)

            try:
                # Calculate cost of the operation
                cost = get_audio_model_cost(kwargs.get("model", "tts-1"),
                                            pricing_info, kwargs.get("input", ""))

                # Set Span attributes
                span.set_attribute(TELEMETRY_SDK_NAME, "openlit")
                span.set_attribute(SemanticConvetion.GEN_AI_SYSTEM,
                                    SemanticConvetion.GEN_AI_SYSTEM_OPENAI)
                span.set_attribute(SemanticConvetion.GEN_AI_TYPE,
                                    SemanticConvetion.GEN_AI_TYPE_AUDIO)
                span.set_attribute(SemanticConvetion.GEN_AI_ENDPOINT,
                                    gen_ai_endpoint)
                span.set_attribute(SemanticConvetion.GEN_AI_ENVIRONMENT,
                                    environment)
                span.set_attribute(SemanticConvetion.GEN_AI_APPLICATION_NAME,
                                    application_name)
                span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_MODEL,
                                    kwargs.get("model", "tts-1"))
                span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_AUDIO_VOICE,
                                    kwargs.get("voice", "alloy"))
                span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_AUDIO_RESPONSE_FORMAT,
                                    kwargs.get("response_format", "mp3"))
                span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_AUDIO_SPEED,
                                    kwargs.get("speed", 1))
                span.set_attribute(SemanticConvetion.GEN_AI_USAGE_COST,
                                    cost)
                if trace_content:
                    span.add_event(
                        name=SemanticConvetion.GEN_AI_CONTENT_PROMPT_EVENT,
                        attributes={
                            SemanticConvetion.GEN_AI_CONTENT_PROMPT: kwargs.get("input", ""),
                        },
                    )

                span.set_status(Status(StatusCode.OK))

                if disable_metrics is False:
                    attributes = {
                        TELEMETRY_SDK_NAME:
                            "openlit",
                        SemanticConvetion.GEN_AI_APPLICATION_NAME:
                            application_name,
                        SemanticConvetion.GEN_AI_SYSTEM:
                            SemanticConvetion.GEN_AI_SYSTEM_OPENAI,
                        SemanticConvetion.GEN_AI_ENVIRONMENT:
                            environment,
                        SemanticConvetion.GEN_AI_TYPE:
                            SemanticConvetion.GEN_AI_TYPE_AUDIO,
                        SemanticConvetion.GEN_AI_REQUEST_MODEL:
                            kwargs.get("model", "tts-1")
                    }

                    metrics["genai_requests"].add(1, attributes)
                    metrics["genai_cost"].record(cost, attributes)

                # Return original response
                return response

            except Exception as e:
                handle_exception(span, e)
                logger.error("Error in trace creation: %s", e)

                # Return original response
                return response

    return wrapper
