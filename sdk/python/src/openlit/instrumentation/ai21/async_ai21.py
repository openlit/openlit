# pylint: disable=duplicate-code, broad-exception-caught, too-many-statements, unused-argument, too-many-branches, too-many-instance-attributes, inconsistent-return-statements
"""
Module for monitoring AI21 calls.
"""

import logging
from opentelemetry.trace import SpanKind, Status, StatusCode
from opentelemetry.sdk.resources import TELEMETRY_SDK_NAME
from openlit.__helpers import (
    get_chat_model_cost,
    handle_exception,
    response_as_dict,
    general_tokens
)
from openlit.semcov import SemanticConvetion

# Initialize logger for logging potential issues and operations
logger = logging.getLogger(__name__)

def async_chat(gen_ai_endpoint, version, environment, application_name,
                     tracer, pricing_info, trace_content, metrics, disable_metrics):
    """
    Generates a telemetry wrapper for chat completions to collect metrics.

    Args:
        gen_ai_endpoint: Endpoint identifier for logging and tracing.
        version: Version of the monitoring package.
        environment: Deployment environment (e.g., production, staging).
        application_name: Name of the application using the AI21 SDK.
        tracer: OpenTelemetry tracer for creating spans.
        pricing_info: Information used for calculating the cost of AI21 usage.
        trace_content: Flag indicating whether to trace the actual content.

    Returns:
        A function that wraps the chat completions method to add telemetry.
    """

    class TracedAsyncStream:
        """
        Wrapper for streaming responses to collect metrics and trace data.

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
            self._prompt_tokens = 0
            self._completion_tokens = 0

            self._args = args
            self._kwargs = kwargs

        async def __aenter__(self):
            await self.__wrapped__.__aenter__()
            return self

        async def __aexit__(self, exc_type, exc_value, traceback):
            await self.__wrapped__.__aexit__(exc_type, exc_value, traceback)

        def __aiter__(self):
            return self

        async def __getattr__(self, name):
            """Delegate attribute access to the wrapped object."""
            return getattr(await self.__wrapped__, name)

        async def __anext__(self):
            try:
                chunk = await self.__wrapped__.__anext__()
                chunked = response_as_dict(chunk)
                # Collect message IDs and aggregated response from events
                if (len(chunked.get('choices')) > 0 and ('delta' in chunked.get('choices')[0] and
                    'content' in chunked.get('choices')[0].get('delta'))):

                    content = chunked.get('choices')[0].get('delta').get('content')
                    if content:
                        self._llmresponse += content

                    if chunked.get('usage'):
                        self._prompt_tokens = chunked.get('usage').get("prompt_tokens")
                        self._completion_tokens = chunked.get('usage').get("completion_tokens")

                self._response_id = chunked.get('id')
                return chunk
            except StopAsyncIteration:
                # Handling exception ensure observability without disrupting operation
                try:
                    # Format 'messages' into a single string
                    message_prompt = self._kwargs.get("messages", "")
                    formatted_messages = []
                    for message in message_prompt:
                        role = message.role
                        content = message.content

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

                    # Calculate cost of the operation
                    cost = get_chat_model_cost(self._kwargs.get("model", "jamba-1.5-mini"),
                                                pricing_info, self._prompt_tokens,
                                                self._completion_tokens)

                    # Set Span attributes
                    self._span.set_attribute(TELEMETRY_SDK_NAME, "openlit")
                    self._span.set_attribute(SemanticConvetion.GEN_AI_SYSTEM,
                                        SemanticConvetion.GEN_AI_SYSTEM_AI21)
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
                                        self._kwargs.get("model", "jamba-1.5-mini"))
                    self._span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_TOP_P,
                                        self._kwargs.get("top_p", 1.0))
                    self._span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_MAX_TOKENS,
                                        self._kwargs.get("max_tokens", -1))
                    self._span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_TEMPERATURE,
                                        self._kwargs.get("temperature", 1.0))
                    self._span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_IS_STREAM,
                                        True)
                    self._span.set_attribute(SemanticConvetion.GEN_AI_USAGE_PROMPT_TOKENS,
                                        self._prompt_tokens)
                    self._span.set_attribute(SemanticConvetion.GEN_AI_USAGE_COMPLETION_TOKENS,
                                        self._completion_tokens)
                    self._span.set_attribute(SemanticConvetion.GEN_AI_USAGE_TOTAL_TOKENS,
                                        self._prompt_tokens + self._completion_tokens)
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
                                SemanticConvetion.GEN_AI_SYSTEM_AI21,
                            SemanticConvetion.GEN_AI_ENVIRONMENT:
                                environment,
                            SemanticConvetion.GEN_AI_TYPE:
                                SemanticConvetion.GEN_AI_TYPE_CHAT,
                            SemanticConvetion.GEN_AI_REQUEST_MODEL:
                                self._kwargs.get("model", "jamba-1.5-mini")
                        }

                        metrics["genai_requests"].add(1, attributes)
                        metrics["genai_total_tokens"].add(
                            self._prompt_tokens + self._completion_tokens, attributes
                        )
                        metrics["genai_completion_tokens"].add(self._completion_tokens, attributes)
                        metrics["genai_prompt_tokens"].add(self._prompt_tokens, attributes)
                        metrics["genai_cost"].record(cost, attributes)

                except Exception as e:
                    handle_exception(self._span, e)
                    logger.error("Error in trace creation: %s", e)
                finally:
                    self._span.end()
                raise

    async def wrapper(wrapped, instance, args, kwargs):
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
            awaited_wrapped = await wrapped(*args, **kwargs)
            span = tracer.start_span(gen_ai_endpoint, kind=SpanKind.CLIENT)

            return TracedAsyncStream(awaited_wrapped, span, kwargs)

        # Handling for non-streaming responses
        else:
            # pylint: disable=line-too-long
            with tracer.start_as_current_span(gen_ai_endpoint, kind= SpanKind.CLIENT) as span:
                response = await wrapped(*args, **kwargs)

                response_dict = response_as_dict(response)

                try:
                    # Format 'messages' into a single string
                    message_prompt = kwargs.get("messages", "")
                    formatted_messages = []
                    for message in message_prompt:
                        role = message.role
                        content = message.content

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
                                        SemanticConvetion.GEN_AI_SYSTEM_AI21)
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
                                        kwargs.get("model", "jamba-1.5-mini"))
                    span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_TOP_P,
                                        kwargs.get("top_p", 1.0))
                    span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_MAX_TOKENS,
                                        kwargs.get("max_tokens", -1))
                    span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_TEMPERATURE,
                                        kwargs.get("temperature", 1.0))
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
                        cost = get_chat_model_cost(kwargs.get("model", "jamba-1.5-mini"),
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
                        cost = get_chat_model_cost(kwargs.get("model", "jamba-1.5-mini"),
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
                                SemanticConvetion.GEN_AI_SYSTEM_AI21,
                            SemanticConvetion.GEN_AI_ENVIRONMENT:
                                environment,
                            SemanticConvetion.GEN_AI_TYPE:
                                SemanticConvetion.GEN_AI_TYPE_CHAT,
                            SemanticConvetion.GEN_AI_REQUEST_MODEL:
                                kwargs.get("model", "jamba-1.5-mini")
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

def async_chat_rag(gen_ai_endpoint, version, environment, application_name,
                     tracer, pricing_info, trace_content, metrics, disable_metrics):
    """
    Generates a telemetry wrapper for chat completions to collect metrics.

    Args:
        gen_ai_endpoint: Endpoint identifier for logging and tracing.
        version: Version of the monitoring package.
        environment: Deployment environment (e.g., production, staging).
        application_name: Name of the application using the AI21 SDK.
        tracer: OpenTelemetry tracer for creating spans.
        pricing_info: Information used for calculating the cost of AI21 usage.
        trace_content: Flag indicating whether to trace the actual content.

    Returns:
        A function that wraps the chat completions method to add telemetry.
    """

    async def wrapper(wrapped, instance, args, kwargs):
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
            # # Special handling for streaming response to accommodate the nature of data flow
            # awaited_wrapped = wrapped(*args, **kwargs)
            # span = tracer.start_span(gen_ai_endpoint, kind=SpanKind.CLIENT)

            # return TracedSyncStream(awaited_wrapped, span, kwargs)

            return

        # Handling for non-streaming responses
        else:
            # pylint: disable=line-too-long
            with tracer.start_as_current_span(gen_ai_endpoint, kind= SpanKind.CLIENT) as span:
                response = await wrapped(*args, **kwargs)

                response_dict = response_as_dict(response)

                try:
                    # Format 'messages' into a single string
                    message_prompt = kwargs.get("messages", "")
                    formatted_messages = []
                    for message in message_prompt:
                        role = message.role
                        content = message.content

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
                                        SemanticConvetion.GEN_AI_SYSTEM_AI21)
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
                                        kwargs.get("model", "jamba-1.5-mini"))
                    span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_IS_STREAM,
                                        False)
                    span.set_attribute(SemanticConvetion.GEN_AI_RAG_MAX_SEGMENTS,
                                        kwargs.get("max_segments", -1))
                    span.set_attribute(SemanticConvetion.GEN_AI_RAG_STRATEGY,
                                        kwargs.get("retrieval_strategy", "segments"))
                    span.set_attribute(SemanticConvetion.GEN_AI_RAG_SIMILARITY_THRESHOLD,
                                        kwargs.get("retrieval_similarity_threshold", -1))
                    span.set_attribute(SemanticConvetion.GEN_AI_RAG_MAX_NEIGHBORS,
                                        kwargs.get("max_neighbors", -1))
                    span.set_attribute(SemanticConvetion.GEN_AI_RAG_FILE_IDS,
                                        str(kwargs.get("file_ids", "")))
                    span.set_attribute(SemanticConvetion.GEN_AI_RAG_DOCUMENTS_PATH,
                                        kwargs.get("path", ""))

                    if trace_content:
                        span.add_event(
                            name=SemanticConvetion.GEN_AI_CONTENT_PROMPT_EVENT,
                            attributes={
                                SemanticConvetion.GEN_AI_CONTENT_PROMPT: prompt,
                            },
                        )
                    prompt_tokens = general_tokens(prompt)


                    # Set span attributes when tools is not passed to the function call
                    if "tools" not in kwargs:
                        prompt_tokens = general_tokens(prompt)

                        # Set span attributes for when n = 1 (default)
                        if "n" not in kwargs or kwargs["n"] == 1:
                            completion_tokens = general_tokens(response_dict.get('choices', [])[0].get("content"))
                            if trace_content:
                                span.add_event(
                                    name=SemanticConvetion.GEN_AI_CONTENT_COMPLETION_EVENT,
                                    attributes={
                                        SemanticConvetion.GEN_AI_CONTENT_COMPLETION: response_dict.get('choices', [])[0].get("content"),
                                    },
                                )

                        # Set span attributes for when n > 0
                        else:
                            i = 0
                            completion_tokens = 0
                            while i < kwargs["n"] and trace_content is True:
                                completion_tokens += general_tokens(response_dict.get('choices')[i].get("message").get("content"))
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
                        completion_tokens = -1
                        # Calculate cost of the operation
                        cost = get_chat_model_cost(kwargs.get("model", "jamba-1.5-mini"),
                                                    pricing_info, response_dict.get('usage').get('prompt_tokens'),
                                                    response_dict.get('usage').get('completion_tokens'))
                        span.add_event(
                            name=SemanticConvetion.GEN_AI_CONTENT_COMPLETION_EVENT,
                            attributes={
                                SemanticConvetion.GEN_AI_CONTENT_COMPLETION: "Function called with tools",
                            },
                        )
                        span.set_attribute(SemanticConvetion.GEN_AI_USAGE_PROMPT_TOKENS,
                                            prompt_tokens)
                        span.set_attribute(SemanticConvetion.GEN_AI_USAGE_COMPLETION_TOKENS,
                                            completion_tokens)
                        span.set_attribute(SemanticConvetion.GEN_AI_USAGE_TOTAL_TOKENS,
                                            prompt_tokens + completion_tokens)

                    # Calculate cost of the operation
                    cost = get_chat_model_cost(kwargs.get("model", "jamba-1.5-mini"),
                                                pricing_info, prompt_tokens,
                                                completion_tokens)
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
                                SemanticConvetion.GEN_AI_SYSTEM_AI21,
                            SemanticConvetion.GEN_AI_ENVIRONMENT:
                                environment,
                            SemanticConvetion.GEN_AI_TYPE:
                                SemanticConvetion.GEN_AI_TYPE_CHAT,
                            SemanticConvetion.GEN_AI_REQUEST_MODEL:
                                kwargs.get("model", "jamba-1.5-mini")
                        }

                        metrics["genai_requests"].add(1, attributes)
                        metrics["genai_total_tokens"].add(prompt_tokens + completion_tokens, attributes)
                        metrics["genai_completion_tokens"].add(completion_tokens, attributes)
                        metrics["genai_prompt_tokens"].add(prompt_tokens, attributes)
                        metrics["genai_cost"].record(cost, attributes)

                    # Return original response
                    return response

                except Exception as e:
                    handle_exception(span, e)
                    logger.error("Error in trace creation: %s", e)

                    # Return original response
                    return response

    return wrapper
