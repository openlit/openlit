# pylint: disable=duplicate-code, broad-exception-caught, too-many-statements, unused-argument, protected-access, too-many-branches
"""
Module for monitoring Amazon Bedrock API calls.
"""

import logging
from botocore.response import StreamingBody
from botocore.exceptions import ReadTimeoutError, ResponseStreamingError
from urllib3.exceptions import ProtocolError as URLLib3ProtocolError
from urllib3.exceptions import ReadTimeoutError as URLLib3ReadTimeoutError
from opentelemetry.trace import SpanKind, Status, StatusCode
from opentelemetry.sdk.resources import TELEMETRY_SDK_NAME
from openlit.__helpers import get_chat_model_cost
from openlit.__helpers import handle_exception
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


def converse(gen_ai_endpoint, version, environment, application_name, tracer,
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
            with tracer.start_as_current_span(gen_ai_endpoint, kind=SpanKind.CLIENT) as span:
                response = original_method(*method_args, **method_kwargs)

                try:
                    message_prompt = method_kwargs.get("messages", "")
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

                    model = method_kwargs.get("modelId", "amazon.titan-text-express-v1")
                    input_tokens = response["usage"]["inputTokens"]
                    output_tokens = response["usage"]["outputTokens"]

                    span.set_attribute(TELEMETRY_SDK_NAME, "openlit")
                    span.set_attribute(SemanticConvetion.GEN_AI_SYSTEM,
                                        SemanticConvetion.GEN_AI_SYSTEM_BEDROCK)
                    span.set_attribute(SemanticConvetion.GEN_AI_ENDPOINT,
                                        gen_ai_endpoint)
                    span.set_attribute(SemanticConvetion.GEN_AI_ENVIRONMENT,
                                        environment)
                    span.set_attribute(SemanticConvetion.GEN_AI_APPLICATION_NAME,
                                        application_name)
                    span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_MODEL,
                                        model)
                    span.set_attribute(SemanticConvetion.GEN_AI_USAGE_PROMPT_TOKENS,
                                        input_tokens)
                    span.set_attribute(SemanticConvetion.GEN_AI_USAGE_COMPLETION_TOKENS,
                                        output_tokens)
                    span.set_attribute(SemanticConvetion.GEN_AI_USAGE_TOTAL_TOKENS,
                                        input_tokens + output_tokens)

                    # Calculate cost of the operation
                    cost = get_chat_model_cost(model,
                                            pricing_info, input_tokens,
                                            output_tokens)
                    span.set_attribute(SemanticConvetion.GEN_AI_USAGE_COST,
                                cost)

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
                                # pylint: disable=line-too-long
                                SemanticConvetion.GEN_AI_CONTENT_COMPLETION: response["output"]["message"]["content"][0]["text"],
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
                                SemanticConvetion.GEN_AI_SYSTEM_BEDROCK,
                            SemanticConvetion.GEN_AI_ENVIRONMENT:
                                environment,
                            SemanticConvetion.GEN_AI_TYPE:
                                SemanticConvetion.GEN_AI_TYPE_CHAT,
                            SemanticConvetion.GEN_AI_REQUEST_MODEL:
                                model
                        }

                        metrics["genai_requests"].add(1, attributes)
                        metrics["genai_total_tokens"].add(
                            input_tokens + output_tokens, attributes
                        )
                        metrics["genai_completion_tokens"].add(output_tokens, attributes)
                        metrics["genai_prompt_tokens"].add(input_tokens, attributes)
                        metrics["genai_cost"].record(cost, attributes)

                    return response

                except Exception as e:
                    handle_exception(span, e)
                    logger.error("Error in trace creation: %s", e)

                    # Return original response
                    return response

        # Get the original client instance from the wrapper
        client = wrapped(*args, **kwargs)

        # Replace the original method with the instrumented one
        if kwargs.get("service_name") == "bedrock-runtime":
            original_invoke_model = client.converse
            client.converse = lambda *args, **kwargs: converse_wrapper(original_invoke_model,
                                                                            *args, **kwargs)

        return client

    return wrapper
