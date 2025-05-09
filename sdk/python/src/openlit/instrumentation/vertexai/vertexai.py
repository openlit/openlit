"""
Module for monitoring VertexAI API calls.
"""

import logging
import time
from opentelemetry.trace import SpanKind, Status, StatusCode
from opentelemetry.sdk.resources import SERVICE_NAME, TELEMETRY_SDK_NAME, DEPLOYMENT_ENVIRONMENT
from openlit.__helpers import (
    get_chat_model_cost,
    handle_exception,
    calculate_ttft,
    calculate_tbt,
    create_metrics_attributes,
)
from openlit.semcov import SemanticConvention

# Initialize logger for logging potential issues and operations
logger = logging.getLogger(__name__)

def send_message(version, environment, application_name, tracer,
             pricing_info, capture_message_content, metrics, disable_metrics):
    """
    Generates a telemetry wrapper for messages to collect metrics.

    Args:
        version: Version of the monitoring package.
        environment: Deployment environment (e.g., production, staging).
        application_name: Name of the application using the VertexAI API.
        tracer: OpenTelemetry tracer for creating spans.
        pricing_info: Information used for calculating the cost of VertexAI usage.
        capture_message_content: Flag indicating whether to trace the actual content.

    Returns:
        A function that wraps the chat method to add telemetry.
    """

    class TracedSyncStream:
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
                request_model,
                args,
            ):
            self.__wrapped__ = wrapped
            self._span = span
            # Placeholder for aggregating streaming response
            self._llmresponse = ""
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
            self._request_model = request_model

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
                end_time = time.time()
                # Record the timestamp for the current chunk
                self._timestamps.append(end_time)

                if len(self._timestamps) == 1:
                    # Calculate time to first chunk
                    self._ttft = calculate_ttft(self._timestamps, self._start_time)

                self._llmresponse += str(chunk.text)
                self._input_tokens = chunk.usage_metadata.prompt_token_count
                self._output_tokens = chunk.usage_metadata.candidates_token_count

                return chunk
            except StopIteration:
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
                    prompt = "\n".join(formatted_messages) or str(self._args[0][0])

                    # Calculate cost of the operation
                    cost = get_chat_model_cost(self._request_model,
                                                pricing_info, self._input_tokens,
                                                self._output_tokens)

                    # Set Span attributes (OTel Semconv)
                    self._span.set_attribute(TELEMETRY_SDK_NAME, "openlit")
                    self._span.set_attribute(SemanticConvention.GEN_AI_OPERATION,
                                        SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT)
                    self._span.set_attribute(SemanticConvention.GEN_AI_SYSTEM,
                                        SemanticConvention.GEN_AI_SYSTEM_VERTEXAI)
                    self._span.set_attribute(SemanticConvention.GEN_AI_REQUEST_MODEL,
                                        self._request_model)
                    self._span.set_attribute(SemanticConvention.SERVER_PORT,
                                        self._server_port)

                    inference_config = self._kwargs.get('generation_config', {})

                    # List of attributes and their config keys
                    attributes = [
                        (SemanticConvention.GEN_AI_REQUEST_FREQUENCY_PENALTY, 'frequency_penalty'),
                        (SemanticConvention.GEN_AI_REQUEST_MAX_TOKENS, 'max_output_tokens'),
                        (SemanticConvention.GEN_AI_REQUEST_PRESENCE_PENALTY, 'presence_penalty'),
                        (SemanticConvention.GEN_AI_REQUEST_STOP_SEQUENCES, 'stop_sequences'),
                        (SemanticConvention.GEN_AI_REQUEST_TEMPERATURE, 'temperature'),
                        (SemanticConvention.GEN_AI_REQUEST_TOP_P, 'top_p'),
                        (SemanticConvention.GEN_AI_REQUEST_TOP_K, 'top_k'),
                    ]

                    # Set each attribute if the corresponding value exists and is not None
                    for attribute, key in attributes:
                        # Use the `get` method to safely access keys in the dictionary
                        value = inference_config.get(key)
                        if value is not None:
                            self._span.set_attribute(attribute, value)

                    self._span.set_attribute(SemanticConvention.GEN_AI_RESPONSE_MODEL,
                                        self._request_model)
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
                            system=SemanticConvention.GEN_AI_SYSTEM_VERTEXAI,
                            request_model=self._request_model,
                            server_address=self._server_address,
                            server_port=self._server_port,
                            response_model=self._request_model,
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

    def wrapper(wrapped, instance, args, kwargs):
        """
        Wraps the 'messages' API call to add telemetry.

        This collects metrics such as execution time, cost, and token usage, and handles errors
        gracefully, adding details to the trace for observability.

        Args:
            wrapped: The original 'messages' method to be wrapped.
            instance: The instance of the class where the original method is defined.
            args: Positional arguments for the 'messages' method.
            kwargs: Keyword arguments for the 'messages' method.

        Returns:
            The response from the original 'messages' method.
        """

        # Check if streaming is enabled for the API call
        streaming = kwargs.get("stream", False)

        try:
            location = instance._model._location
            request_model = "/".join(instance._model._model_name.split("/")[3:])
        except:
            location = instance._location
            request_model = "/".join(instance._model_name.split("/")[3:])

        server_address, server_port = location + '-aiplatform.googleapis.com', 443

        span_name = f"{SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT} {request_model}"

        # pylint: disable=no-else-return
        if streaming:
            # Special handling for streaming response to accommodate the nature of data flow
            awaited_wrapped = wrapped(*args, **kwargs)
            span = tracer.start_span(span_name, kind=SpanKind.CLIENT)

            return TracedSyncStream(awaited_wrapped, span, kwargs, server_address, server_port, request_model, args)

        # Handling for non-streaming responses
        else:
            with tracer.start_as_current_span(span_name, kind=SpanKind.CLIENT) as span:
                start_time = time.time()
                response = wrapped(*args, **kwargs)
                end_time = time.time()

                try:
                    # Format 'messages' into a single string
                    message_prompt = kwargs.get("contents", [])
                    formatted_messages = []

                    for content in message_prompt:
                        role = content.role
                        parts = content.parts
                        content_str = []

                        for part in parts:
                            # Collect relevant fields and handle each type of data that Part could contain
                            if part.text:
                                content_str.append(f"text: {part.text}")
                            if part.video_metadata:
                                content_str.append(f"video_metadata: {part.video_metadata}")
                            if part.thought:
                                content_str.append(f"thought: {part.thought}")
                            if part.code_execution_result:
                                content_str.append(f"code_execution_result: {part.code_execution_result}")
                            if part.executable_code:
                                content_str.append(f"executable_code: {part.executable_code}")
                            if part.file_data:
                                content_str.append(f"file_data: {part.file_data}")
                            if part.function_call:
                                content_str.append(f"function_call: {part.function_call}")
                            if part.function_response:
                                content_str.append(f"function_response: {part.function_response}")
                            if part.inline_data:
                                content_str.append(f"inline_data: {part.inline_data}")

                        formatted_messages.append(f"{role}: {', '.join(content_str)}")

                    prompt = "\n".join(formatted_messages) or str(args[0][0])

                    input_tokens = response.usage_metadata.prompt_token_count
                    output_tokens = response.usage_metadata.candidates_token_count

                    # Calculate cost of the operation
                    cost = get_chat_model_cost(request_model,
                                                pricing_info, input_tokens,
                                                output_tokens)

                    # Set base span attribues (OTel Semconv)
                    span.set_attribute(TELEMETRY_SDK_NAME, "openlit")
                    span.set_attribute(SemanticConvention.GEN_AI_OPERATION,
                                        SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT)
                    span.set_attribute(SemanticConvention.GEN_AI_SYSTEM,
                                        SemanticConvention.GEN_AI_SYSTEM_VERTEXAI)
                    span.set_attribute(SemanticConvention.GEN_AI_REQUEST_MODEL,
                                        request_model)
                    span.set_attribute(SemanticConvention.SERVER_PORT,
                                        server_port)

                    inference_config = kwargs.get('generation_config', {})

                    # List of attributes and their config keys
                    attributes = [
                        (SemanticConvention.GEN_AI_REQUEST_FREQUENCY_PENALTY, 'frequency_penalty'),
                        (SemanticConvention.GEN_AI_REQUEST_MAX_TOKENS, 'max_output_tokens'),
                        (SemanticConvention.GEN_AI_REQUEST_PRESENCE_PENALTY, 'presence_penalty'),
                        (SemanticConvention.GEN_AI_REQUEST_STOP_SEQUENCES, 'stop_sequences'),
                        (SemanticConvention.GEN_AI_REQUEST_TEMPERATURE, 'temperature'),
                        (SemanticConvention.GEN_AI_REQUEST_TOP_P, 'top_p'),
                        (SemanticConvention.GEN_AI_REQUEST_TOP_K, 'top_k'),
                    ]

                    # Set each attribute if the corresponding value exists and is not None
                    for attribute, key in attributes:
                        # Use the `get` method to safely access keys in the dictionary
                        value = inference_config.get(key)
                        if value is not None:
                            span.set_attribute(attribute, value)

                    span.set_attribute(SemanticConvention.GEN_AI_RESPONSE_MODEL,
                                        request_model)
                    span.set_attribute(SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS,
                                        input_tokens)
                    span.set_attribute(SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS,
                                        output_tokens)
                    span.set_attribute(SemanticConvention.SERVER_ADDRESS,
                                        server_address)
                    # span.set_attribute(SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON,
                    #                     [str(response.candidates[0].finish_reason)])

                    # Set base span attribues (Extras)
                    span.set_attribute(DEPLOYMENT_ENVIRONMENT,
                                        environment)
                    span.set_attribute(SERVICE_NAME,
                                        application_name)
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
                        span.add_event(
                            name=SemanticConvention.GEN_AI_CONTENT_COMPLETION_EVENT,
                            attributes={
                                SemanticConvention.GEN_AI_CONTENT_COMPLETION: response.text,
                            },
                        )

                        if isinstance(response.text, str):
                            span.set_attribute(SemanticConvention.GEN_AI_OUTPUT_TYPE,
                                            "text")
                        elif response.text is not None:
                            span.set_attribute(SemanticConvention.GEN_AI_OUTPUT_TYPE,
                                            "json")

                    span.set_status(Status(StatusCode.OK))

                    if disable_metrics is False:
                        attributes = create_metrics_attributes(
                            service_name=application_name,
                            deployment_environment=environment,
                            operation=SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
                            system=SemanticConvention.GEN_AI_SYSTEM_VERTEXAI,
                            request_model=request_model,
                            server_address=server_address,
                            server_port=server_port,
                            response_model=request_model,
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
