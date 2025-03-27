"""
Module for monitoring Google AI Studio API calls.
"""

import logging
import time
from opentelemetry.trace import SpanKind, Status, StatusCode
from opentelemetry.sdk.resources import SERVICE_NAME, TELEMETRY_SDK_NAME, DEPLOYMENT_ENVIRONMENT
from openlit.__helpers import (
    get_chat_model_cost,
    handle_exception,
    response_as_dict,
    create_metrics_attributes,
    set_server_address_and_port
)
from openlit.semcov import SemanticConvention

# Initialize logger for logging potential issues and operations
logger = logging.getLogger(__name__)

def generate(version, environment, application_name,
                     tracer, pricing_info, capture_message_content, metrics, disable_metrics):
    """
    Generates a telemetry wrapper for chat to collect metrics.

    Args:
        gen_ai_endpoint: Endpoint identifier for logging and tracing.
        version: Version of the monitoring package.
        environment: Deployment environment (e.g., production, staging).
        application_name: Name of the application using the Google AI Studio API.
        tracer: OpenTelemetry tracer for creating spans.
        pricing_info: Information used for calculating the cost of Google AI Studio usage.
        capture_message_content: Flag indicating whether to trace the actual content.

    Returns:
        A function that wraps the chat method to add telemetry.
    """

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

        server_address, server_port = set_server_address_and_port(instance, "generativelanguage.googleapis.com", 443)
        request_model = kwargs.get("model", "gemini-2.0-flash")

        span_name = f"{SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT} {request_model}"

        with tracer.start_as_current_span(span_name, kind=SpanKind.CLIENT) as span:
            start_time = time.time()
            response = wrapped(*args, **kwargs)
            end_time = time.time()

            response_dict = response_as_dict(response)

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

                prompt = "\n".join(formatted_messages)

                input_tokens = response_dict.get('usage_metadata').get('prompt_token_count')
                output_tokens = response_dict.get('usage_metadata').get('candidates_token_count')

                # Calculate cost of the operation
                cost = get_chat_model_cost(request_model,
                                            pricing_info, input_tokens,
                                            output_tokens)

                # Set base span attribues (OTel Semconv)
                span.set_attribute(TELEMETRY_SDK_NAME, "openlit")
                span.set_attribute(SemanticConvention.GEN_AI_OPERATION,
                                    SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT)
                span.set_attribute(SemanticConvention.GEN_AI_SYSTEM,
                                    SemanticConvention.GEN_AI_SYSTEM_GEMINI)
                span.set_attribute(SemanticConvention.GEN_AI_REQUEST_MODEL,
                                    request_model)
                span.set_attribute(SemanticConvention.SERVER_PORT,
                                    server_port)

                inference_config = kwargs.get('config', {})

                # List of attributes and their config keys
                attributes = [
                    (SemanticConvention.GEN_AI_REQUEST_FREQUENCY_PENALTY, 'frequency_penalty'),
                    (SemanticConvention.GEN_AI_REQUEST_MAX_TOKENS, 'max_tokens'),
                    (SemanticConvention.GEN_AI_REQUEST_PRESENCE_PENALTY, 'presence_penalty'),
                    (SemanticConvention.GEN_AI_REQUEST_STOP_SEQUENCES, 'stop_sequences'),
                    (SemanticConvention.GEN_AI_REQUEST_TEMPERATURE, 'temperature'),
                    (SemanticConvention.GEN_AI_REQUEST_TOP_P, 'top_p'),
                    (SemanticConvention.GEN_AI_REQUEST_TOP_K, 'top_k'),
                ]

                # Set each attribute if the corresponding value exists and is not None
                for attribute, key in attributes:
                    # Use getattr to get the attribute value from the object
                    value = getattr(inference_config, key, None)
                    if value is not None:
                        span.set_attribute(attribute, value)

                span.set_attribute(SemanticConvention.GEN_AI_RESPONSE_MODEL,
                                    response_dict.get('model_version'))
                span.set_attribute(SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS,
                                    input_tokens)
                span.set_attribute(SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS,
                                    output_tokens)
                span.set_attribute(SemanticConvention.SERVER_ADDRESS,
                                    server_address)
                span.set_attribute(SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON,
                                    [str(response_dict.get('candidates')[0].get('finish_reason'))])

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

                    if isinstance(response_dict.get('text'), str):
                        span.set_attribute(SemanticConvention.GEN_AI_OUTPUT_TYPE,
                                        "text")
                    elif response_dict.get('text') is not None:
                        span.set_attribute(SemanticConvention.GEN_AI_OUTPUT_TYPE,
                                        "json")

                span.set_status(Status(StatusCode.OK))

                if disable_metrics is False:
                    attributes = create_metrics_attributes(
                        service_name=application_name,
                        deployment_environment=environment,
                        operation=SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
                        system=SemanticConvention.GEN_AI_SYSTEM_GEMINI,
                        request_model=request_model,
                        server_address=server_address,
                        server_port=server_port,
                        response_model=response_dict.get('model_version'),
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
