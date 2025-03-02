"""
Module for monitoring Amazon Bedrock API calls.
"""

import logging
import time
from botocore.response import StreamingBody
from botocore.exceptions import ReadTimeoutError, ResponseStreamingError
from urllib3.exceptions import ProtocolError as URLLib3ProtocolError
from urllib3.exceptions import ReadTimeoutError as URLLib3ReadTimeoutError
from opentelemetry.trace import SpanKind, Status, StatusCode
from opentelemetry.sdk.resources import SERVICE_NAME, TELEMETRY_SDK_NAME, DEPLOYMENT_ENVIRONMENT
from openlit.__helpers import (
    get_chat_model_cost,
    handle_exception,
    response_as_dict,
    create_metrics_attributes,
    set_server_address_and_port
)
from openlit.semcov import SemanticConvetion

# Initialize logger for logging potential issues and operations
logger = logging.getLogger(__name__)

class CustomStreamWrapper(StreamingBody):
    """Handle streaming responses with the ability to read multiple times."""

    def __init__(self, stream_source, length):
        super().__init__(stream_source, length)
        self._stream_data = None
        self._read_position = 0

    def read(self, amt=None):
        if self._stream_data is None:
            try:
                self._stream_data = self._raw_stream.read()
            except URLLib3ReadTimeoutError as error:
                raise ReadTimeoutError(endpoint_url=error.url, error=error) from error
            except URLLib3ProtocolError as error:
                raise ResponseStreamingError(error=error) from error

            self._amount_read += len(self._stream_data)
            if amt is None or (not self._stream_data and amt > 0):
                self._verify_content_length()

        if amt is None:
            data_chunk = self._stream_data[self._read_position:]
        else:
            data_start = self._read_position
            self._read_position += amt
            data_chunk = self._stream_data[data_start:self._read_position]

        return data_chunk

def converse(version, environment, application_name, tracer,
         pricing_info, trace_content, metrics, disable_metrics):
    """
    Generates a telemetry wrapper for messages to collect metrics.

    Args:
        gen_ai_endpoint: Endpoint identifier for logging and tracing.
        version: The monitoring package version.
        environment: Deployment environment (e.g. production, staging).
        application_name: Name of the application using the Bedrock API.
        tracer: OpenTelemetry tracer for creating spans.
        pricing_info: Information for calculating Bedrock usage cost.
        trace_content: Whether to trace the actual content.
        metrics: Metrics collector.
        disable_metrics: Flag to toggle metrics collection.
    Returns:
        A function that wraps the chat method to add telemetry.
    """

    def wrapper(wrapped, instance, args, kwargs):
        """
        Wraps an API call to add telemetry.

        Args:
            wrapped: Original method.
            instance: Instance of the class.
            args: Positional arguments of the 'messages' method.
            kwargs: Keyword arguments of the 'messages' method.
        Returns:
            Response from the original method.
        """

        def converse_wrapper(original_method, *method_args, **method_kwargs):
            """
            Adds instrumentation to the invoke model call.

            Args:
                original_method: The original invoke model method.
                *method_args: Positional arguments for the method.
                **method_kwargs: Keyword arguments for the method.
            Returns:
                The modified response with telemetry.
            """

            server_address, server_port = set_server_address_and_port(instance, 'aws.amazon.com', 443)
            request_model = method_kwargs.get('modelId', 'amazon.titan-text-express-v1')

            span_name = f'{SemanticConvetion.GEN_AI_OPERATION_TYPE_CHAT} {request_model}'

            with tracer.start_as_current_span(span_name, kind=SpanKind.CLIENT) as span:
                start_time = time.time()
                response = original_method(*method_args, **method_kwargs)
                end_time = time.time()

                response_dict = response_as_dict(response)

                try:
                    message_prompt = method_kwargs.get('messages', '')
                    formatted_messages = []
                    for message in message_prompt:
                        role = message['role']
                        content = message['content']

                        if isinstance(content, list):
                            content_str = ", ".join(f'text: {item["text"]}' for item in content if "text" in item)
                            formatted_messages.append(f'{role}: {content_str}')
                        else:
                            formatted_messages.append(f'{role}: {content}')
                    prompt = '\n'.join(formatted_messages)

                    input_tokens = response_dict.get('usage').get('inputTokens')
                    output_tokens = response_dict.get('usage').get('outputTokens')

                    # Calculate cost of the operation
                    cost = get_chat_model_cost(request_model, pricing_info,
                                                input_tokens, output_tokens)

                    llm_response = response_dict.get('output').get('message').get('content')[0].get('text')

                    # Set base span attribues (OTel Semconv)
                    span.set_attribute(TELEMETRY_SDK_NAME, 'openlit')
                    span.set_attribute(SemanticConvetion.GEN_AI_OPERATION,
                                        SemanticConvetion.GEN_AI_OPERATION_TYPE_CHAT)
                    span.set_attribute(SemanticConvetion.GEN_AI_SYSTEM,
                                        SemanticConvetion.GEN_AI_SYSTEM_AWS_BEDROCK)
                    span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_MODEL,
                                        request_model)
                    span.set_attribute(SemanticConvetion.SERVER_PORT,
                                        server_port)

                    inference_config = method_kwargs.get('inferenceConfig', {})

                    # List of attributes and their config keys
                    attributes = [
                        (SemanticConvetion.GEN_AI_REQUEST_FREQUENCY_PENALTY, 'frequencyPenalty'),
                        (SemanticConvetion.GEN_AI_REQUEST_MAX_TOKENS, 'maxTokens'),
                        (SemanticConvetion.GEN_AI_REQUEST_PRESENCE_PENALTY, 'presencePenalty'),
                        (SemanticConvetion.GEN_AI_REQUEST_STOP_SEQUENCES, 'stopSequences'),
                        (SemanticConvetion.GEN_AI_REQUEST_TEMPERATURE, 'temperature'),
                        (SemanticConvetion.GEN_AI_REQUEST_TOP_P, 'topP'),
                        (SemanticConvetion.GEN_AI_REQUEST_TOP_K, 'topK'),
                    ]

                    # Set each attribute if the corresponding value exists and is not None
                    for attribute, key in attributes:
                        value = inference_config.get(key)
                        if value is not None:
                            span.set_attribute(attribute, value)

                    span.set_attribute(SemanticConvetion.GEN_AI_RESPONSE_ID,
                                        response_dict.get('ResponseMetadata').get('RequestId'))
                    span.set_attribute(SemanticConvetion.GEN_AI_RESPONSE_MODEL,
                                        request_model)
                    span.set_attribute(SemanticConvetion.GEN_AI_USAGE_INPUT_TOKENS,
                                        input_tokens)
                    span.set_attribute(SemanticConvetion.GEN_AI_USAGE_OUTPUT_TOKENS,
                                        output_tokens)
                    span.set_attribute(SemanticConvetion.SERVER_ADDRESS,
                                        server_address)
                    if isinstance(llm_response, str):
                        span.set_attribute(SemanticConvetion.GEN_AI_OUTPUT_TYPE,
                                        'text')
                    else:
                        span.set_attribute(SemanticConvetion.GEN_AI_OUTPUT_TYPE,
                                        'json')

                    # Set base span attribues (Extras)
                    span.set_attribute(DEPLOYMENT_ENVIRONMENT,
                                        environment)
                    span.set_attribute(SERVICE_NAME,
                                        application_name)
                    span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_IS_STREAM,
                                        False)
                    span.set_attribute(SemanticConvetion.GEN_AI_USAGE_TOTAL_TOKENS,
                                        input_tokens + output_tokens)
                    span.set_attribute(SemanticConvetion.GEN_AI_USAGE_COST,
                                        cost)
                    span.set_attribute(SemanticConvetion.GEN_AI_SERVER_TTFT,
                                        end_time - start_time)
                    span.set_attribute(SemanticConvetion.GEN_AI_SDK_VERSION,
                                        version)

                    if trace_content:
                        span.add_event(
                            name=SemanticConvetion.GEN_AI_CONTENT_PROMPT_EVENT,
                            attributes={
                                SemanticConvetion.GEN_AI_CONTENT_PROMPT: prompt,
                            },
                        )
                        span.add_event(
                            name=SemanticConvetion.GEN_AI_CONTENT_COMPLETION_EVENT,
                            attributes={
                                SemanticConvetion.GEN_AI_CONTENT_COMPLETION: llm_response,
                            },
                        )

                    span.set_status(Status(StatusCode.OK))

                    if disable_metrics is False:
                        attributes = create_metrics_attributes(
                            service_name=application_name,
                            deployment_environment=environment,
                            operation=SemanticConvetion.GEN_AI_OPERATION_TYPE_CHAT,
                            system=SemanticConvetion.GEN_AI_SYSTEM_AWS_BEDROCK,
                            request_model=request_model,
                            server_address=server_address,
                            server_port=server_port,
                            response_model=request_model,
                        )

                        metrics['genai_client_usage_tokens'].record(
                            input_tokens + output_tokens, attributes
                        )
                        metrics['genai_client_operation_duration'].record(
                            end_time - start_time, attributes
                        )
                        metrics['genai_server_ttft'].record(
                            end_time - start_time, attributes
                        )
                        metrics['genai_requests'].add(1, attributes)
                        metrics['genai_completion_tokens'].add(output_tokens, attributes)
                        metrics['genai_prompt_tokens'].add(input_tokens, attributes)
                        metrics['genai_cost'].record(cost, attributes)

                    return response

                except Exception as e:
                    handle_exception(span, e)
                    logger.error('Error in trace creation: %s', e)

                    # Return original response
                    return response

        # Get the original client instance from the wrapper
        client = wrapped(*args, **kwargs)

        # Replace the original method with the instrumented one
        if kwargs.get('service_name') == 'bedrock-runtime':
            original_invoke_model = client.converse
            client.converse = lambda *args, **kwargs: converse_wrapper(original_invoke_model,
                                                                            *args, **kwargs)

        return client

    return wrapper
