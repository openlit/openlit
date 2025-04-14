"""
Module for monitoring OpenAI API calls.
"""

import logging
import time
from opentelemetry.trace import SpanKind, Status, StatusCode
from opentelemetry.sdk.resources import SERVICE_NAME, TELEMETRY_SDK_NAME, DEPLOYMENT_ENVIRONMENT
from openlit.__helpers import (
    get_chat_model_cost,
    get_embed_model_cost,
    get_audio_model_cost,
    get_image_model_cost,
    general_tokens,
    handle_exception,
    extract_and_format_input,
    concatenate_all_contents,
    response_as_dict,
    calculate_ttft,
    calculate_tbt,
    create_metrics_attributes,
    set_server_address_and_port
)
from openlit.semcov import SemanticConvention

# Initialize logger for logging potential issues and operations
logger = logging.getLogger(__name__)

def async_responses(version, environment, application_name,
                     tracer, pricing_info, capture_message_content, metrics, disable_metrics):
    """
    Generates a telemetry wrapper for chat completions to collect metrics.

    Args:
        version: Version of the monitoring package.
        environment: Deployment environment (e.g., production, staging).
        application_name: Name of the application using the OpenAI API.
        tracer: OpenTelemetry tracer for creating spans.
        pricing_info: Information used for calculating the cost of OpenAI usage.
        capture_message_content: Flag indicating whether to trace the actual content.

    Returns:
        A function that wraps the chat completions method to add telemetry.
    """

    class TracedAsyncStream:
        """
        Wrapper for streaming responses to collect metrics and trace data.
        Wraps the response to collect message IDs and aggregated response.

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
                server_address,
                server_port,
                **args,
            ):
            self.__wrapped__ = wrapped
            self._span = span
            # Placeholder for aggregating streaming response
            self._llmresponse = ""
            self._response_id = ""
            self._response_model = ""
            self._finish_reason = ""
            self._input_tokens = ""
            self._output_tokens = ""

            self._args = args
            self._kwargs = kwargs
            self._start_time = time.time()
            self._end_time = None
            self._timestamps = []
            self._ttft = 0
            self._tbt = 0
            self._server_address = server_address
            self._server_port = server_port

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
                end_time = time.time()
                # Record the timestamp for the current chunk
                self._timestamps.append(end_time)

                if len(self._timestamps) == 1:
                    # Calculate time to first chunk
                    self._ttft = calculate_ttft(self._timestamps, self._start_time)

                chunked = response_as_dict(chunk)
                # Collect message IDs and aggregated response from events
                if chunked.get('type') == "response.output_text.delta":
                    self._llmresponse += chunked.get('delta')
                if chunked.get('type') == "response.completed":
                    self._response_id = chunked.get('response').get('id')
                    self._response_model = chunked.get('response').get('model')
                    self._finish_reason = chunked.get('response').get('status')
                    self._input_tokens = chunked.get('response').get('usage').get('input_tokens')
                    self._output_tokens = chunked.get('response').get('usage').get('output_tokens')
                return chunk
            except StopAsyncIteration:
                # Handling exception ensure observability without disrupting operation
                try:
                    self._end_time = time.time()
                    if len(self._timestamps) > 1:
                        self._tbt = calculate_tbt(self._timestamps)

                    try:
                        formatted_messages = extract_and_format_input(self._kwargs.get('input', ''))
                        prompt = concatenate_all_contents(formatted_messages)
                    except:
                        prompt = self._kwargs.get('input', '')

                    request_model = self._kwargs.get("model", "gpt-4o")

                    # Calculate cost of the operation
                    cost = get_chat_model_cost(request_model,
                                                pricing_info, self._input_tokens,
                                                self._output_tokens)

                    # Set Span attributes (OTel Semconv)
                    self._span.set_attribute(TELEMETRY_SDK_NAME, "openlit")
                    self._span.set_attribute(SemanticConvention.GEN_AI_OPERATION,
                                        SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT)
                    self._span.set_attribute(SemanticConvention.GEN_AI_SYSTEM,
                                        SemanticConvention.GEN_AI_SYSTEM_OPENAI)
                    self._span.set_attribute(SemanticConvention.GEN_AI_REQUEST_MODEL,
                                        request_model)
                    self._span.set_attribute(SemanticConvention.GEN_AI_REQUEST_SEED,
                                        self._kwargs.get("seed", ""))
                    self._span.set_attribute(SemanticConvention.SERVER_PORT,
                                        self._server_port)
                    self._span.set_attribute(SemanticConvention.GEN_AI_REQUEST_MAX_TOKENS,
                                        self._kwargs.get("max_output_tokens", -1))
                    self._span.set_attribute(SemanticConvention.GEN_AI_REQUEST_STOP_SEQUENCES,
                                        self._kwargs.get("stop", []))
                    self._span.set_attribute(SemanticConvention.GEN_AI_REQUEST_TEMPERATURE,
                                        self._kwargs.get("temperature", 1.0))
                    self._span.set_attribute(SemanticConvention.GEN_AI_REQUEST_TOP_P,
                                        self._kwargs.get("top_p", 1.0))
                    self._span.set_attribute(SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON,
                                        [self._finish_reason])
                    self._span.set_attribute(SemanticConvention.GEN_AI_RESPONSE_ID,
                                        self._response_id)
                    self._span.set_attribute(SemanticConvention.GEN_AI_RESPONSE_MODEL,
                                        self._response_model)
                    self._span.set_attribute(SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS,
                                        self._input_tokens)
                    self._span.set_attribute(SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS,
                                        self._output_tokens)
                    self._span.set_attribute(SemanticConvention.SERVER_ADDRESS,
                                        self._server_address)
                    if isinstance(self._llmresponse, str):
                        self._span.set_attribute(SemanticConvention.GEN_AI_OUTPUT_TYPE,
                                        "text")
                    else:
                        self._span.set_attribute(SemanticConvention.GEN_AI_OUTPUT_TYPE,
                                        "json")

                    # Set Span attributes (Extra)
                    self._span.set_attribute(DEPLOYMENT_ENVIRONMENT,
                                        environment)
                    self._span.set_attribute(SERVICE_NAME,
                                        application_name)
                    self._span.set_attribute(SemanticConvention.GEN_AI_REQUEST_USER,
                                        self._kwargs.get("user", ""))
                    self._span.set_attribute(SemanticConvention.GEN_AI_REQUEST_IS_STREAM,
                                        True)
                    self._span.set_attribute(SemanticConvention.GEN_AI_USAGE_TOTAL_TOKENS,
                                        self._input_tokens + self._output_tokens)
                    self._span.set_attribute(SemanticConvention.GEN_AI_USAGE_COST,
                                        cost)
                    self._span.set_attribute(SemanticConvention.GEN_AI_SERVER_TBT,
                                        self._tbt)
                    self._span.set_attribute(SemanticConvention.GEN_AI_SERVER_TTFT,
                                        self._ttft)
                    self._span.set_attribute(SemanticConvention.GEN_AI_SDK_VERSION,
                                        version)

                    if capture_message_content:
                        self._span.add_event(
                            name=SemanticConvention.GEN_AI_CONTENT_PROMPT_EVENT,
                            attributes={
                                SemanticConvention.GEN_AI_CONTENT_PROMPT: prompt,
                            },
                        )
                        self._span.add_event(
                            name=SemanticConvention.GEN_AI_CONTENT_COMPLETION_EVENT,
                            attributes={
                                SemanticConvention.GEN_AI_CONTENT_COMPLETION: self._llmresponse,
                            },
                        )
                    self._span.set_status(Status(StatusCode.OK))

                    if disable_metrics is False:
                        attributes = create_metrics_attributes(
                            service_name=application_name,
                            deployment_environment=environment,
                            operation=SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
                            system=SemanticConvention.GEN_AI_SYSTEM_OPENAI,
                            request_model=request_model,
                            server_address=self._server_address,
                            server_port=self._server_port,
                            response_model=self._response_model,
                        )

                        metrics["genai_client_usage_tokens"].record(
                            self._input_tokens + self._output_tokens, attributes
                        )
                        metrics["genai_client_operation_duration"].record(
                            self._end_time - self._start_time, attributes
                        )
                        metrics["genai_server_tbt"].record(
                            self._tbt, attributes
                        )
                        metrics["genai_server_ttft"].record(
                            self._ttft, attributes
                        )
                        metrics["genai_requests"].add(1, attributes)
                        metrics["genai_completion_tokens"].add(self._output_tokens, attributes)
                        metrics["genai_prompt_tokens"].add(self._input_tokens, attributes)
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
        server_address, server_port = set_server_address_and_port(instance, "api.openai.com", 443)
        request_model = kwargs.get("model", "gpt-4o")

        span_name = f"{SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT} {request_model}"

        # pylint: disable=no-else-return
        if streaming:
            # Special handling for streaming response to accommodate the nature of data flow
            awaited_wrapped = await wrapped(*args, **kwargs)
            span = tracer.start_span(span_name, kind=SpanKind.CLIENT)

            return TracedAsyncStream(awaited_wrapped, span, kwargs, server_address, server_port)

        # Handling for non-streaming responses
        else:
            with tracer.start_as_current_span(span_name, kind= SpanKind.CLIENT) as span:
                start_time = time.time()
                response = await wrapped(*args, **kwargs)
                end_time = time.time()

                response_dict = response_as_dict(response)

                try:
                    try:
                        formatted_messages = extract_and_format_input(kwargs.get('input', ''))
                        prompt = concatenate_all_contents(formatted_messages)
                    except:
                        prompt = kwargs.get('input', '')

                    input_tokens = response_dict.get('usage').get('input_tokens')
                    output_tokens = response_dict.get('usage').get('output_tokens')

                    # Calculate cost of the operation
                    cost = get_chat_model_cost(request_model,
                                                pricing_info, input_tokens,
                                                output_tokens)

                    # Set base span attribues (OTel Semconv)
                    span.set_attribute(TELEMETRY_SDK_NAME, "openlit")
                    span.set_attribute(SemanticConvention.GEN_AI_OPERATION,
                                        SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT)
                    span.set_attribute(SemanticConvention.GEN_AI_SYSTEM,
                                        SemanticConvention.GEN_AI_SYSTEM_OPENAI)
                    span.set_attribute(SemanticConvention.GEN_AI_REQUEST_MODEL,
                                        request_model)
                    span.set_attribute(SemanticConvention.GEN_AI_REQUEST_SEED,
                                        kwargs.get("seed", ""))
                    span.set_attribute(SemanticConvention.SERVER_PORT,
                                        server_port)
                    span.set_attribute(SemanticConvention.GEN_AI_REQUEST_MAX_TOKENS,
                                        kwargs.get("max_output_tokens", -1))
                    span.set_attribute(SemanticConvention.GEN_AI_REQUEST_STOP_SEQUENCES,
                                        kwargs.get("stop", []))
                    span.set_attribute(SemanticConvention.GEN_AI_REQUEST_TEMPERATURE,
                                        str(response_dict.get("temperature", 1.0)))
                    span.set_attribute(SemanticConvention.GEN_AI_REQUEST_TOP_P,
                                        str(response_dict.get("top_p", 1.0)))
                    span.set_attribute(SemanticConvention.GEN_AI_RESPONSE_ID,
                                        response_dict.get("id"))
                    span.set_attribute(SemanticConvention.GEN_AI_RESPONSE_MODEL,
                                        response_dict.get('model'))
                    span.set_attribute(SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS,
                                        input_tokens)
                    span.set_attribute(SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS,
                                        output_tokens)
                    span.set_attribute(SemanticConvention.SERVER_ADDRESS,
                                        server_address)

                    # Set base span attribues (Extras)
                    span.set_attribute(DEPLOYMENT_ENVIRONMENT,
                                        environment)
                    span.set_attribute(SERVICE_NAME,
                                        application_name)
                    span.set_attribute(SemanticConvention.GEN_AI_REQUEST_USER,
                                        kwargs.get("user", ""))
                    span.set_attribute(SemanticConvention.GEN_AI_REQUEST_IS_STREAM,
                                        False)
                    span.set_attribute(SemanticConvention.GEN_AI_USAGE_TOTAL_TOKENS,
                                        input_tokens + output_tokens)
                    span.set_attribute(SemanticConvention.GEN_AI_USAGE_COST,
                                        cost)
                    span.set_attribute(SemanticConvention.GEN_AI_SERVER_TTFT,
                                        end_time - start_time)
                    span.set_attribute(SemanticConvention.GEN_AI_SDK_VERSION,
                                        version)

                    if capture_message_content:
                        span.add_event(
                            name=SemanticConvention.GEN_AI_CONTENT_PROMPT_EVENT,
                            attributes={
                                SemanticConvention.GEN_AI_CONTENT_PROMPT: prompt,
                            },
                        )

                    for i in range(kwargs.get('n',1)):
                        span.set_attribute(SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON,
                                           [response_dict.get('status')])
                        try:
                            llm_response = str(response_dict.get('output')[i].get('content')[0].get('text',''))
                        except:
                            llm_response = ''

                        if capture_message_content:
                            span.add_event(
                                name=SemanticConvention.GEN_AI_CONTENT_COMPLETION_EVENT,
                                attributes={
                                    # pylint: disable=line-too-long
                                    SemanticConvention.GEN_AI_CONTENT_COMPLETION: llm_response,
                                },
                            )
                        if kwargs.get('tools'):
                            span.set_attribute(SemanticConvention.GEN_AI_TOOL_CALLS,
                                            str(response_dict.get('tools')))

                        if isinstance(llm_response, str):
                            span.set_attribute(SemanticConvention.GEN_AI_OUTPUT_TYPE,
                                            "text")
                        elif llm_response is not None:
                            span.set_attribute(SemanticConvention.GEN_AI_OUTPUT_TYPE,
                                            "json")

                    span.set_status(Status(StatusCode.OK))

                    if disable_metrics is False:
                        attributes = create_metrics_attributes(
                            service_name=application_name,
                            deployment_environment=environment,
                            operation=SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
                            system=SemanticConvention.GEN_AI_SYSTEM_OPENAI,
                            request_model=request_model,
                            server_address=server_address,
                            server_port=server_port,
                            response_model=response_dict.get('model'),
                        )

                        metrics["genai_client_usage_tokens"].record(
                            input_tokens + output_tokens, attributes
                        )
                        metrics["genai_client_operation_duration"].record(
                            end_time - start_time, attributes
                        )
                        metrics["genai_server_ttft"].record(
                            end_time - start_time, attributes
                        )
                        metrics["genai_requests"].add(1, attributes)
                        metrics["genai_completion_tokens"].add(output_tokens, attributes)
                        metrics["genai_prompt_tokens"].add(input_tokens, attributes)
                        metrics["genai_cost"].record(cost, attributes)

                    # Return original response
                    return response

                except Exception as e:
                    handle_exception(span, e)
                    logger.error("Error in trace creation: %s", e)

                    # Return original response
                    return response

    return wrapper

def async_chat_completions(version, environment, application_name,
                           tracer, pricing_info, capture_message_content, metrics, disable_metrics):
    """
    Generates a telemetry wrapper for chat completions to collect metrics.

    Args:
        version: Version of the monitoring package.
        environment: Deployment environment (e.g., production, staging).
        application_name: Name of the application using the OpenAI API.
        tracer: OpenTelemetry tracer for creating spans.
        pricing_info: Information used for calculating the cost of OpenAI usage.
        capture_message_content: Flag indicating whether to trace the actual content.

    Returns:
        A function that wraps the chat completions method to add telemetry.
    """

    class TracedAsyncStream:
        """
        Wrapper for streaming responses to collect metrics and trace data.
        Wraps the response to collect message IDs and aggregated response.

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
                server_address,
                server_port,
                **args,
            ):
            self.__wrapped__ = wrapped
            self._span = span
            # Placeholder for aggregating streaming response
            self._llmresponse = ""
            self._response_id = ""
            self._response_model = ""
            self._finish_reason = ""
            self._openai_response_service_tier = ""
            self._openai_system_fingerprint = ""

            self._args = args
            self._kwargs = kwargs
            self._start_time = time.time()
            self._end_time = None
            self._timestamps = []
            self._ttft = 0
            self._tbt = 0
            self._server_address = server_address
            self._server_port = server_port

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
                end_time = time.time()
                # Record the timestamp for the current chunk
                self._timestamps.append(end_time)

                if len(self._timestamps) == 1:
                    # Calculate time to first chunk
                    self._ttft = calculate_ttft(self._timestamps, self._start_time)

                chunked = response_as_dict(chunk)
                # Collect message IDs and aggregated response from events
                if (len(chunked.get('choices')) > 0 and ('delta' in chunked.get('choices')[0] and
                    'content' in chunked.get('choices')[0].get('delta'))):

                    content = chunked.get('choices')[0].get('delta').get('content')
                    if content:
                        self._llmresponse += content
                self._response_id = chunked.get('id')
                self._response_model = chunked.get('model')
                self._finish_reason = chunked.get('choices')[0].get('finish_reason')
                self._openai_response_service_tier = chunked.get('service_tier') or 'auto'
                self._openai_system_fingerprint = chunked.get('system_fingerprint')
                return chunk
            except StopAsyncIteration:
                # Handling exception ensure observability without disrupting operation
                try:
                    self._end_time = time.time()
                    if len(self._timestamps) > 1:
                        self._tbt = calculate_tbt(self._timestamps)

                    # Format 'messages' into a single string
                    message_prompt = self._kwargs.get("messages", "")
                    formatted_messages = []
                    for message in message_prompt:
                        role = message["role"]
                        content = message["content"]

                        if isinstance(content, list):
                            content_str_list = []
                            for item in content:
                                if item["type"] == "text":
                                    content_str_list.append(f'text: {item["text"]}')
                                elif (item["type"] == "image_url" and
                                      not item["image_url"]["url"].startswith("data:")):
                                    content_str_list.append(f'image_url: {item["image_url"]["url"]}')
                            content_str = ", ".join(content_str_list)
                            formatted_messages.append(f"{role}: {content_str}")
                        else:
                            formatted_messages.append(f"{role}: {content}")
                    prompt = "\n".join(formatted_messages)

                    request_model = self._kwargs.get("model", "gpt-4o")

                    # Calculate tokens using input prompt and aggregated response
                    input_tokens = general_tokens(prompt)
                    output_tokens = general_tokens(self._llmresponse)

                    # Calculate cost of the operation
                    cost = get_chat_model_cost(request_model,
                                                pricing_info, input_tokens,
                                                output_tokens)

                    # Set Span attributes (OTel Semconv)
                    self._span.set_attribute(TELEMETRY_SDK_NAME, "openlit")
                    self._span.set_attribute(SemanticConvention.GEN_AI_OPERATION,
                                        SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT)
                    self._span.set_attribute(SemanticConvention.GEN_AI_SYSTEM,
                                        SemanticConvention.GEN_AI_SYSTEM_OPENAI)
                    self._span.set_attribute(SemanticConvention.GEN_AI_REQUEST_MODEL,
                                        request_model)
                    self._span.set_attribute(SemanticConvention.GEN_AI_REQUEST_SEED,
                                        self._kwargs.get("seed", ""))
                    self._span.set_attribute(SemanticConvention.SERVER_PORT,
                                        self._server_port)
                    self._span.set_attribute(SemanticConvention.GEN_AI_REQUEST_FREQUENCY_PENALTY,
                                        self._kwargs.get("frequency_penalty", 0.0))
                    self._span.set_attribute(SemanticConvention.GEN_AI_REQUEST_MAX_TOKENS,
                                        self._kwargs.get("max_tokens", -1))
                    self._span.set_attribute(SemanticConvention.GEN_AI_REQUEST_PRESENCE_PENALTY,
                                        self._kwargs.get("presence_penalty", 0.0))
                    self._span.set_attribute(SemanticConvention.GEN_AI_REQUEST_STOP_SEQUENCES,
                                        self._kwargs.get("stop", []))
                    self._span.set_attribute(SemanticConvention.GEN_AI_REQUEST_TEMPERATURE,
                                        self._kwargs.get("temperature", 1.0))
                    self._span.set_attribute(SemanticConvention.GEN_AI_REQUEST_TOP_P,
                                        self._kwargs.get("top_p", 1.0))
                    self._span.set_attribute(SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON,
                                        [self._finish_reason])
                    self._span.set_attribute(SemanticConvention.GEN_AI_RESPONSE_ID,
                                        self._response_id)
                    self._span.set_attribute(SemanticConvention.GEN_AI_RESPONSE_MODEL,
                                        self._response_model)
                    self._span.set_attribute(SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS,
                                        input_tokens)
                    self._span.set_attribute(SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS,
                                        output_tokens)
                    self._span.set_attribute(SemanticConvention.SERVER_ADDRESS,
                                        self._server_address)
                    self._span.set_attribute(SemanticConvention.GEN_AI_REQUEST_SERVICE_TIER,
                                        self._kwargs.get("service_tier", "auto"))
                    self._span.set_attribute(SemanticConvention.GEN_AI_RESPONSE_SERVICE_TIER,
                                        self._openai_response_service_tier)
                    self._span.set_attribute(SemanticConvention.GEN_AI_RESPONSE_SYSTEM_FINGERPRINT,
                                        self._openai_system_fingerprint)
                    if isinstance(self._llmresponse, str):
                        self._span.set_attribute(SemanticConvention.GEN_AI_OUTPUT_TYPE,
                                        "text")
                    else:
                        self._span.set_attribute(SemanticConvention.GEN_AI_OUTPUT_TYPE,
                                        "json")

                    # Set Span attributes (Extra)
                    self._span.set_attribute(DEPLOYMENT_ENVIRONMENT,
                                        environment)
                    self._span.set_attribute(SERVICE_NAME,
                                        application_name)
                    self._span.set_attribute(SemanticConvention.GEN_AI_REQUEST_USER,
                                        self._kwargs.get("user", ""))
                    self._span.set_attribute(SemanticConvention.GEN_AI_REQUEST_IS_STREAM,
                                        True)
                    self._span.set_attribute(SemanticConvention.GEN_AI_USAGE_TOTAL_TOKENS,
                                        input_tokens + output_tokens)
                    self._span.set_attribute(SemanticConvention.GEN_AI_USAGE_COST,
                                        cost)
                    self._span.set_attribute(SemanticConvention.GEN_AI_SERVER_TBT,
                                        self._tbt)
                    self._span.set_attribute(SemanticConvention.GEN_AI_SERVER_TTFT,
                                        self._ttft)
                    self._span.set_attribute(SemanticConvention.GEN_AI_SDK_VERSION,
                                        version)
                    if capture_message_content:
                        self._span.add_event(
                            name=SemanticConvention.GEN_AI_CONTENT_PROMPT_EVENT,
                            attributes={
                                SemanticConvention.GEN_AI_CONTENT_PROMPT: prompt,
                            },
                        )
                        self._span.add_event(
                            name=SemanticConvention.GEN_AI_CONTENT_COMPLETION_EVENT,
                            attributes={
                                SemanticConvention.GEN_AI_CONTENT_COMPLETION: self._llmresponse,
                            },
                        )
                    self._span.set_status(Status(StatusCode.OK))

                    if disable_metrics is False:
                        attributes = create_metrics_attributes(
                            service_name=application_name,
                            deployment_environment=environment,
                            operation=SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
                            system=SemanticConvention.GEN_AI_SYSTEM_OPENAI,
                            request_model=request_model,
                            server_address=self._server_address,
                            server_port=self._server_port,
                            response_model=self._response_model,
                        )

                        metrics["genai_client_usage_tokens"].record(
                            input_tokens + output_tokens, attributes
                        )
                        metrics["genai_client_operation_duration"].record(
                            self._end_time - self._start_time, attributes
                        )
                        metrics["genai_server_tbt"].record(
                            self._tbt, attributes
                        )
                        metrics["genai_server_ttft"].record(
                            self._ttft, attributes
                        )
                        metrics["genai_requests"].add(1, attributes)
                        metrics["genai_completion_tokens"].add(output_tokens, attributes)
                        metrics["genai_prompt_tokens"].add(input_tokens, attributes)
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
        server_address, server_port = set_server_address_and_port(instance, "api.openai.com", 443)
        request_model = kwargs.get("model", "gpt-4o")

        span_name = f"{SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT} {request_model}"

        # pylint: disable=no-else-return
        if streaming:
            # Special handling for streaming response to accommodate the nature of data flow
            awaited_wrapped = await wrapped(*args, **kwargs)
            span = tracer.start_span(span_name, kind=SpanKind.CLIENT)

            return TracedAsyncStream(awaited_wrapped, span, kwargs, server_address, server_port)

        # Handling for non-streaming responses
        else:
            with tracer.start_as_current_span(span_name, kind=SpanKind.CLIENT) as span:
                start_time = time.time()
                response = await wrapped(*args, **kwargs)
                end_time = time.time()

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
                                f'{item["type"]}: {item["text"] if "text" in item else item["image_url"]}'
                                if "type" in item else f'text: {item["text"]}'
                                for item in content
                            )
                            formatted_messages.append(f"{role}: {content_str}")
                        else:
                            formatted_messages.append(f"{role}: {content}")
                    prompt = "\n".join(formatted_messages)

                    input_tokens = response_dict.get('usage').get('prompt_tokens')
                    output_tokens = response_dict.get('usage').get('completion_tokens')

                    # Calculate cost of the operation
                    cost = get_chat_model_cost(request_model,
                                                pricing_info, input_tokens,
                                                output_tokens)

                    # Set base span attribues (OTel Semconv)
                    span.set_attribute(TELEMETRY_SDK_NAME, "openlit")
                    span.set_attribute(SemanticConvention.GEN_AI_OPERATION,
                                        SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT)
                    span.set_attribute(SemanticConvention.GEN_AI_SYSTEM,
                                        SemanticConvention.GEN_AI_SYSTEM_OPENAI)
                    span.set_attribute(SemanticConvention.GEN_AI_REQUEST_MODEL,
                                        request_model)
                    span.set_attribute(SemanticConvention.GEN_AI_REQUEST_SEED,
                                        kwargs.get("seed", ""))
                    span.set_attribute(SemanticConvention.SERVER_PORT,
                                        server_port)
                    span.set_attribute(SemanticConvention.GEN_AI_REQUEST_FREQUENCY_PENALTY,
                                        kwargs.get("frequency_penalty", 0.0))
                    span.set_attribute(SemanticConvention.GEN_AI_REQUEST_MAX_TOKENS,
                                        kwargs.get("max_tokens", -1))
                    span.set_attribute(SemanticConvention.GEN_AI_REQUEST_PRESENCE_PENALTY,
                                        kwargs.get("presence_penalty", 0.0))
                    span.set_attribute(SemanticConvention.GEN_AI_REQUEST_STOP_SEQUENCES,
                                        kwargs.get("stop", []))
                    span.set_attribute(SemanticConvention.GEN_AI_REQUEST_TEMPERATURE,
                                        kwargs.get("temperature", 1.0))
                    span.set_attribute(SemanticConvention.GEN_AI_REQUEST_TOP_P,
                                        kwargs.get("top_p", 1.0))
                    span.set_attribute(SemanticConvention.GEN_AI_RESPONSE_ID,
                                        response_dict.get("id"))
                    span.set_attribute(SemanticConvention.GEN_AI_RESPONSE_MODEL,
                                        response_dict.get('model'))
                    span.set_attribute(SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS,
                                        input_tokens)
                    span.set_attribute(SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS,
                                        output_tokens)
                    span.set_attribute(SemanticConvention.SERVER_ADDRESS,
                                        server_address)
                    span.set_attribute(SemanticConvention.GEN_AI_REQUEST_SERVICE_TIER,
                                        kwargs.get("service_tier", "auto"))
                    span.set_attribute(SemanticConvention.GEN_AI_RESPONSE_SERVICE_TIER,
                                        response_dict.get('service_tier', 'auto'))
                    span.set_attribute(SemanticConvention.GEN_AI_RESPONSE_SYSTEM_FINGERPRINT,
                                        response_dict.get('system_fingerprint', ''))

                    # Set base span attribues (Extras)
                    span.set_attribute(DEPLOYMENT_ENVIRONMENT,
                                        environment)
                    span.set_attribute(SERVICE_NAME,
                                        application_name)
                    span.set_attribute(SemanticConvention.GEN_AI_REQUEST_USER,
                                        kwargs.get("user", ""))
                    span.set_attribute(SemanticConvention.GEN_AI_REQUEST_IS_STREAM,
                                        False)
                    span.set_attribute(SemanticConvention.GEN_AI_USAGE_TOTAL_TOKENS,
                                        input_tokens + output_tokens)
                    span.set_attribute(SemanticConvention.GEN_AI_USAGE_COST,
                                        cost)
                    span.set_attribute(SemanticConvention.GEN_AI_SERVER_TTFT,
                                        end_time - start_time)
                    span.set_attribute(SemanticConvention.GEN_AI_SDK_VERSION,
                                        version)
                    if capture_message_content:
                        span.add_event(
                            name=SemanticConvention.GEN_AI_CONTENT_PROMPT_EVENT,
                            attributes={
                                SemanticConvention.GEN_AI_CONTENT_PROMPT: prompt,
                            },
                        )

                    for i in range(kwargs.get('n',1)):
                        span.set_attribute(SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON,
                                           [response_dict.get('choices')[i].get('finish_reason')])
                        if capture_message_content:
                            span.add_event(
                                name=SemanticConvention.GEN_AI_CONTENT_COMPLETION_EVENT,
                                attributes={
                                    # pylint: disable=line-too-long
                                    SemanticConvention.GEN_AI_CONTENT_COMPLETION: str(response_dict.get('choices')[i].get('message').get('content')),
                                },
                            )
                        if kwargs.get('tools'):
                            span.set_attribute(SemanticConvention.GEN_AI_TOOL_CALLS,
                                            str(response_dict.get('choices')[i].get('message').get('tool_calls')))

                        if isinstance(response_dict.get('choices')[i].get('message').get('content'), str):
                            span.set_attribute(SemanticConvention.GEN_AI_OUTPUT_TYPE,
                                            "text")
                        elif response_dict.get('choices')[i].get('message').get('content') is not None:
                            span.set_attribute(SemanticConvention.GEN_AI_OUTPUT_TYPE,
                                            "json")

                    span.set_status(Status(StatusCode.OK))

                    if disable_metrics is False:
                        attributes = create_metrics_attributes(
                            service_name=application_name,
                            deployment_environment=environment,
                            operation=SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
                            system=SemanticConvention.GEN_AI_SYSTEM_OPENAI,
                            request_model=request_model,
                            server_address=server_address,
                            server_port=server_port,
                            response_model=response_dict.get('model'),
                        )

                        metrics["genai_client_usage_tokens"].record(
                            input_tokens + output_tokens, attributes
                        )
                        metrics["genai_client_operation_duration"].record(
                            end_time - start_time, attributes
                        )
                        metrics["genai_server_ttft"].record(
                            end_time - start_time, attributes
                        )
                        metrics["genai_requests"].add(1, attributes)
                        metrics["genai_completion_tokens"].add(output_tokens, attributes)
                        metrics["genai_prompt_tokens"].add(input_tokens, attributes)
                        metrics["genai_cost"].record(cost, attributes)

                    # Return original response
                    return response

                except Exception as e:
                    handle_exception(span, e)
                    logger.error("Error in trace creation: %s", e)

                    # Return original response
                    return response

    return wrapper

def async_embedding(version, environment, application_name,
              tracer, pricing_info, capture_message_content, metrics, disable_metrics):
    """
    Generates a telemetry wrapper for embeddings to collect metrics.
    
    Args:
        version: Version of the monitoring package.
        environment: Deployment environment (e.g., production, staging).
        application_name: Name of the application using the OpenAI API.
        tracer: OpenTelemetry tracer for creating spans.
        pricing_info: Information used for calculating the cost of OpenAI usage.
        capture_message_content: Flag indicating whether to trace the actual content.
    
    Returns:
        A function that wraps the embeddings method to add telemetry.
    """

    async def wrapper(wrapped, instance, args, kwargs):
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

        server_address, server_port = set_server_address_and_port(instance, "api.openai.com", 443)
        request_model = kwargs.get("model", "text-embedding-ada-002")

        span_name = f"{SemanticConvention.GEN_AI_OPERATION_TYPE_EMBEDDING} {request_model}"

        with tracer.start_as_current_span(span_name, kind= SpanKind.CLIENT) as span:
            start_time = time.time()
            response = await wrapped(*args, **kwargs)
            end_time = time.time()

            response_dict = response_as_dict(response)
            try:
                input_tokens = response_dict.get('usage').get('prompt_tokens')

                # Calculate cost of the operation
                cost = get_embed_model_cost(request_model,
                                    pricing_info, input_tokens)

                # Set Span attributes (OTel Semconv)
                span.set_attribute(TELEMETRY_SDK_NAME, "openlit")
                span.set_attribute(SemanticConvention.GEN_AI_OPERATION,
                                    SemanticConvention.GEN_AI_OPERATION_TYPE_EMBEDDING)
                span.set_attribute(SemanticConvention.GEN_AI_SYSTEM,
                                    SemanticConvention.GEN_AI_SYSTEM_OPENAI)
                span.set_attribute(SemanticConvention.GEN_AI_REQUEST_MODEL,
                                    request_model)
                span.set_attribute(SemanticConvention.GEN_AI_REQUEST_ENCODING_FORMATS,
                                    [kwargs.get('encoding_format', 'float')])
                span.set_attribute(SemanticConvention.GEN_AI_RESPONSE_MODEL,
                                    request_model)
                span.set_attribute(SemanticConvention.SERVER_ADDRESS,
                                    server_address)
                span.set_attribute(SemanticConvention.SERVER_PORT,
                                    server_port)
                span.set_attribute(SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS,
                                    input_tokens)

                # Set Span attributes (Extras)
                span.set_attribute(DEPLOYMENT_ENVIRONMENT,
                                    environment)
                span.set_attribute(SERVICE_NAME,
                                    application_name)
                span.set_attribute(SemanticConvention.GEN_AI_REQUEST_USER,
                                    kwargs.get("user", ""))
                span.set_attribute(SemanticConvention.GEN_AI_USAGE_TOTAL_TOKENS,
                                    input_tokens)
                span.set_attribute(SemanticConvention.GEN_AI_USAGE_COST,
                                    cost)
                span.set_attribute(SemanticConvention.GEN_AI_SDK_VERSION,
                                    version)

                if capture_message_content:
                    span.add_event(
                        name=SemanticConvention.GEN_AI_CONTENT_PROMPT_EVENT,
                        attributes={
                            SemanticConvention.GEN_AI_CONTENT_PROMPT: str(kwargs.get("input", "")),
                        },
                    )

                span.set_status(Status(StatusCode.OK))

                if disable_metrics is False:
                    attributes = create_metrics_attributes(
                        service_name=application_name,
                        deployment_environment=environment,
                        operation=SemanticConvention.GEN_AI_OPERATION_TYPE_EMBEDDING,
                        system=SemanticConvention.GEN_AI_SYSTEM_OPENAI,
                        request_model=request_model,
                        server_address=server_address,
                        server_port=server_port,
                        response_model=request_model,
                    )
                    metrics["genai_client_usage_tokens"].record(
                            input_tokens, attributes
                        )
                    metrics["genai_client_operation_duration"].record(
                        end_time - start_time, attributes
                    )
                    metrics["genai_requests"].add(1, attributes)
                    metrics["genai_prompt_tokens"].add(input_tokens, attributes)
                    metrics["genai_cost"].record(cost, attributes)

                # Return original response
                return response

            except Exception as e:
                handle_exception(span, e)
                logger.error("Error in trace creation: %s", e)

                # Return original response
                return response

    return wrapper

def async_image_generate(version, environment, application_name,
                   tracer, pricing_info, capture_message_content, metrics, disable_metrics):
    """
    Generates a telemetry wrapper for image generation to collect metrics.
    
    Args:
        version: Version of the monitoring package.
        environment: Deployment environment (e.g., production, staging).
        application_name: Name of the application using the OpenAI API.
        tracer: OpenTelemetry tracer for creating spans.
        pricing_info: Information used for calculating the cost of OpenAI image generation.
        capture_message_content: Flag indicating whether to trace the input prompt and generated images.
    
    Returns:
        A function that wraps the image generation method to add telemetry.
    """

    async def wrapper(wrapped, instance, args, kwargs):
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

        server_address, server_port = set_server_address_and_port(instance, "api.openai.com", 443)
        request_model = kwargs.get("model", "dall-e-2")

        span_name = f"{SemanticConvention.GEN_AI_OPERATION_TYPE_IMAGE} {request_model}"

        with tracer.start_as_current_span(span_name, kind= SpanKind.CLIENT) as span:
            start_time = time.time()
            response = await wrapped(*args, **kwargs)
            end_time = time.time()

            images_count = 0

            try:
                # Find Image format
                if "response_format" in kwargs and kwargs["response_format"] == "b64_json":
                    image = "b64_json"
                else:
                    image = "url"

                # Calculate cost of the operation
                cost = get_image_model_cost(request_model,
                                            pricing_info, kwargs.get("size", "1024x1024"),
                                            kwargs.get("quality", "standard"))

                for items in response.data:
                    # Set Span attributes (OTel Semconv)
                    span.set_attribute(TELEMETRY_SDK_NAME, "openlit")
                    span.set_attribute(SemanticConvention.GEN_AI_OPERATION,
                                        SemanticConvention.GEN_AI_OPERATION_TYPE_IMAGE)
                    span.set_attribute(SemanticConvention.GEN_AI_SYSTEM,
                                        SemanticConvention.GEN_AI_SYSTEM_OPENAI)
                    span.set_attribute(SemanticConvention.GEN_AI_REQUEST_MODEL,
                                        request_model)
                    span.set_attribute(SemanticConvention.SERVER_ADDRESS,
                                        server_address)
                    span.set_attribute(SemanticConvention.SERVER_PORT,
                                        server_port)
                    span.set_attribute(SemanticConvention.GEN_AI_RESPONSE_ID,
                                        response.created)
                    span.set_attribute(SemanticConvention.GEN_AI_RESPONSE_MODEL,
                                        request_model)
                    span.set_attribute(SemanticConvention.GEN_AI_OUTPUT_TYPE,
                                        "image")

                    # Set Span attributes (Extras)
                    span.set_attribute(DEPLOYMENT_ENVIRONMENT,
                                        environment)
                    span.set_attribute(SERVICE_NAME,
                                        application_name)
                    span.set_attribute(SemanticConvention.GEN_AI_REQUEST_IMAGE_SIZE,
                                        kwargs.get("size", "1024x1024"))
                    span.set_attribute(SemanticConvention.GEN_AI_REQUEST_IMAGE_QUALITY,
                                        kwargs.get("quality", "standard"))
                    span.set_attribute(SemanticConvention.GEN_AI_REQUEST_IMAGE_STYLE,
                                        kwargs.get("style", "vivid"))
                    span.set_attribute(SemanticConvention.GEN_AI_CONTENT_REVISED_PROMPT,
                                        items.revised_prompt if items.revised_prompt else "")
                    span.set_attribute(SemanticConvention.GEN_AI_REQUEST_USER,
                                        kwargs.get("user", ""))
                    span.set_attribute(SemanticConvention.GEN_AI_SDK_VERSION,
                                        version)

                    if capture_message_content:
                        span.add_event(
                            name=SemanticConvention.GEN_AI_CONTENT_PROMPT_EVENT,
                            attributes={
                                SemanticConvention.GEN_AI_CONTENT_PROMPT: kwargs.get("prompt", ""),
                            },
                        )
                        attribute_name = f"{SemanticConvention.GEN_AI_RESPONSE_IMAGE}.{images_count}"
                        span.add_event(
                            name=attribute_name,
                            attributes={
                                SemanticConvention.GEN_AI_CONTENT_COMPLETION: getattr(items, image),
                            },
                        )

                    images_count+=1

                span.set_attribute(SemanticConvention.GEN_AI_USAGE_COST,
                                    len(response.data) * cost)
                span.set_status(Status(StatusCode.OK))

                if disable_metrics is False:
                    attributes = create_metrics_attributes(
                        service_name=application_name,
                        deployment_environment=environment,
                        operation=SemanticConvention.GEN_AI_OPERATION_TYPE_IMAGE,
                        system=SemanticConvention.GEN_AI_SYSTEM_OPENAI,
                        request_model=request_model,
                        server_address=server_address,
                        server_port=server_port,
                        response_model=request_model,
                    )

                    metrics["genai_client_operation_duration"].record(
                        end_time - start_time, attributes
                    )
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

def async_image_variatons(version, environment, application_name,
                    tracer, pricing_info, capture_message_content, metrics, disable_metrics):
    """
    Generates a telemetry wrapper for creating image variations to collect metrics.
    
    Args:
        version: Version of the monitoring package.
        environment: Deployment environment (e.g., production, staging).
        application_name: Name of the application using the OpenAI API.
        tracer: OpenTelemetry tracer for creating spans.
        pricing_info: Information used for calculating the cost of generating image variations.
        capture_message_content: Flag indicating whether to trace the input image and generated variations.
    
    Returns:
        A function that wraps the image variations creation method to add telemetry.
    """

    async def wrapper(wrapped, instance, args, kwargs):
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

        server_address, server_port = set_server_address_and_port(instance, "api.openai.com", 443)
        request_model = kwargs.get("model", "dall-e-2")

        span_name = f"{SemanticConvention.GEN_AI_OPERATION_TYPE_IMAGE} {request_model}"

        with tracer.start_as_current_span(span_name, kind= SpanKind.CLIENT) as span:
            start_time = time.time()
            response = await wrapped(*args, **kwargs)
            end_time = time.time()

            images_count = 0

            try:
                # Find Image format
                if "response_format" in kwargs and kwargs["response_format"] == "b64_json":
                    image = "b64_json"
                else:
                    image = "url"

                # Calculate cost of the operation
                cost = get_image_model_cost(request_model, pricing_info,
                                            kwargs.get("size", "1024x1024"), "standard")

                for items in response.data:
                    # Set Span attributes (OTel Semconv)
                    span.set_attribute(TELEMETRY_SDK_NAME, "openlit")
                    span.set_attribute(SemanticConvention.GEN_AI_OPERATION,
                                        SemanticConvention.GEN_AI_OPERATION_TYPE_IMAGE)
                    span.set_attribute(SemanticConvention.GEN_AI_SYSTEM,
                                        SemanticConvention.GEN_AI_SYSTEM_OPENAI)
                    span.set_attribute(SemanticConvention.GEN_AI_REQUEST_MODEL,
                                        request_model)
                    span.set_attribute(SemanticConvention.SERVER_ADDRESS,
                                        server_address)
                    span.set_attribute(SemanticConvention.SERVER_PORT,
                                        server_port)
                    span.set_attribute(SemanticConvention.GEN_AI_RESPONSE_ID,
                                        response.created)
                    span.set_attribute(SemanticConvention.GEN_AI_RESPONSE_MODEL,
                                        request_model)
                    span.set_attribute(SemanticConvention.GEN_AI_OUTPUT_TYPE,
                                        "image")

                    # Set Span attributes (Extras)
                    span.set_attribute(DEPLOYMENT_ENVIRONMENT,
                                        environment)
                    span.set_attribute(SERVICE_NAME,
                                        application_name)
                    span.set_attribute(SemanticConvention.GEN_AI_REQUEST_IMAGE_SIZE,
                                        kwargs.get("size", "1024x1024"))
                    span.set_attribute(SemanticConvention.GEN_AI_REQUEST_IMAGE_QUALITY,
                                        "standard")
                    span.set_attribute(SemanticConvention.GEN_AI_REQUEST_USER,
                                        kwargs.get("user", ""))
                    span.set_attribute(SemanticConvention.GEN_AI_SDK_VERSION,
                                        version)

                    if capture_message_content:
                        attribute_name = f"{SemanticConvention.GEN_AI_RESPONSE_IMAGE}.{images_count}"
                        span.add_event(
                            name=attribute_name,
                            attributes={
                                SemanticConvention.GEN_AI_CONTENT_COMPLETION: getattr(items, image),
                            },
                        )

                    images_count+=1

                span.set_attribute(SemanticConvention.GEN_AI_USAGE_COST,
                                    len(response.data) * cost)
                span.set_status(Status(StatusCode.OK))

                if disable_metrics is False:
                    attributes = create_metrics_attributes(
                        service_name=application_name,
                        deployment_environment=environment,
                        operation=SemanticConvention.GEN_AI_OPERATION_TYPE_IMAGE,
                        system=SemanticConvention.GEN_AI_SYSTEM_OPENAI,
                        request_model=request_model,
                        server_address=server_address,
                        server_port=server_port,
                        response_model=request_model,
                    )

                    metrics["genai_client_operation_duration"].record(
                        end_time - start_time, attributes
                    )
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

def async_audio_create(version, environment, application_name,
                 tracer, pricing_info, capture_message_content, metrics, disable_metrics):
    """
    Generates a telemetry wrapper for creating speech audio to collect metrics.
    
    Args:
        version: Version of the monitoring package.
        environment: Deployment environment (e.g., production, staging).
        application_name: Name of the application using the OpenAI API.
        tracer: OpenTelemetry tracer for creating spans.
        pricing_info: Information used for calculating the cost of generating speech audio.
        capture_message_content: Flag indicating whether to trace the input text and generated audio.
    
    Returns:
        A function that wraps the speech audio creation method to add telemetry.
    """

    async def wrapper(wrapped, instance, args, kwargs):
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

        server_address, server_port = set_server_address_and_port(instance, "api.openai.com", 443)
        request_model = kwargs.get("model", "tts-1")

        span_name = f"{SemanticConvention.GEN_AI_OPERATION_TYPE_AUDIO} {request_model}"

        with tracer.start_as_current_span(span_name, kind=SpanKind.CLIENT) as span:
            start_time = time.time()
            response = await wrapped(*args, **kwargs)
            end_time = time.time()

            try:
                # Calculate cost of the operation
                cost = get_audio_model_cost(request_model,
                                            pricing_info, kwargs.get("input", ""))

                # Set Span attributes
                span.set_attribute(TELEMETRY_SDK_NAME, "openlit")
                span.set_attribute(SemanticConvention.GEN_AI_OPERATION,
                                    SemanticConvention.GEN_AI_OPERATION_TYPE_AUDIO)
                span.set_attribute(SemanticConvention.GEN_AI_SYSTEM,
                                    SemanticConvention.GEN_AI_SYSTEM_OPENAI)
                span.set_attribute(SemanticConvention.GEN_AI_REQUEST_MODEL,
                                    request_model)
                span.set_attribute(SemanticConvention.SERVER_ADDRESS,
                                    server_address)
                span.set_attribute(SemanticConvention.SERVER_PORT,
                                    server_port)
                span.set_attribute(SemanticConvention.GEN_AI_RESPONSE_MODEL,
                                    request_model)
                span.set_attribute(SemanticConvention.GEN_AI_OUTPUT_TYPE,
                                    "speech")

                span.set_attribute(DEPLOYMENT_ENVIRONMENT,
                                    environment)
                span.set_attribute(SERVICE_NAME,
                                    application_name)
                span.set_attribute(SemanticConvention.GEN_AI_REQUEST_AUDIO_VOICE,
                                    kwargs.get("voice", "alloy"))
                span.set_attribute(SemanticConvention.GEN_AI_REQUEST_AUDIO_RESPONSE_FORMAT,
                                    kwargs.get("response_format", "mp3"))
                span.set_attribute(SemanticConvention.GEN_AI_REQUEST_AUDIO_SPEED,
                                    kwargs.get("speed", 1))
                span.set_attribute(SemanticConvention.GEN_AI_USAGE_COST,
                                    cost)
                span.set_attribute(SemanticConvention.GEN_AI_SDK_VERSION,
                                    version)
                if capture_message_content:
                    span.add_event(
                        name=SemanticConvention.GEN_AI_CONTENT_PROMPT_EVENT,
                        attributes={
                            SemanticConvention.GEN_AI_CONTENT_PROMPT: kwargs.get("input", ""),
                        },
                    )

                span.set_status(Status(StatusCode.OK))

                if disable_metrics is False:
                    attributes = create_metrics_attributes(
                        service_name=application_name,
                        deployment_environment=environment,
                        operation=SemanticConvention.GEN_AI_OPERATION_TYPE_AUDIO,
                        system=SemanticConvention.GEN_AI_SYSTEM_OPENAI,
                        request_model=request_model,
                        server_address=server_address,
                        server_port=server_port,
                        response_model=request_model,
                    )

                    metrics["genai_client_operation_duration"].record(
                        end_time - start_time, attributes
                    )
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
