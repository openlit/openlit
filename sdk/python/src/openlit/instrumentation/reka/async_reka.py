"""
Module for monitoring Reka API calls.
"""

import logging
import time
from opentelemetry.trace import SpanKind, Status, StatusCode
from opentelemetry.sdk.resources import SERVICE_NAME, TELEMETRY_SDK_NAME, DEPLOYMENT_ENVIRONMENT
from openlit.__helpers import (
    get_chat_model_cost,
    handle_exception,
    create_metrics_attributes,
    set_server_address_and_port
)
from openlit.semcov import SemanticConvention

# Initialize logger for logging potential issues and operations
logger = logging.getLogger(__name__)

def async_chat(version, environment, application_name,
                     tracer, pricing_info, capture_message_content, metrics, disable_metrics):
    """
    Generates a telemetry wrapper for chat to collect metrics.

    Args:
        version: Version of the monitoring package.
        environment: Deployment environment (e.g., production, staging).
        application_name: Name of the application using the Reka API.
        tracer: OpenTelemetry tracer for creating spans.
        pricing_info: Information used for calculating the cost of Reka usage.
        capture_message_content: Flag indicating whether to trace the actual content.

    Returns:
        A function that wraps the chat method to add telemetry.
    """

    async def wrapper(wrapped, instance, args, kwargs):
        """
        Wraps the 'chat' API call to add telemetry.
        
        This collects metrics such as execution time, cost, and token usage, and handles errors
        gracefully, adding details to the trace for observability.

        Args:
            wrapped: The original 'chat' method to be wrapped.
            instance: The instance of the class where the original method is defined.
            args: Positional arguments for the 'chat' method.
            kwargs: Keyword arguments for the 'chat' method.

        Returns:
            The response from the original 'chat' method.
        """

        server_address, server_port = set_server_address_and_port(instance, "api.reka.ai", 443)
        request_model = kwargs.get("model", "reka-core-20240501")

        span_name = f"{SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT} {request_model}"

        with tracer.start_as_current_span(span_name, kind= SpanKind.CLIENT) as span:
            start_time = time.time()
            response = await wrapped(*args, **kwargs)
            end_time = time.time()

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

                input_tokens = response.usage.input_tokens
                output_tokens = response.usage.output_tokens

                # Calculate cost of the operation
                cost = get_chat_model_cost(request_model,
                                            pricing_info, input_tokens, output_tokens)

                # Set Span attributes (OTel Semconv)
                span.set_attribute(TELEMETRY_SDK_NAME, "openlit")
                span.set_attribute(SemanticConvention.GEN_AI_OPERATION,
                                    SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT)
                span.set_attribute(SemanticConvention.GEN_AI_SYSTEM,
                                    SemanticConvention.GEN_AI_SYSTEM_REKAAI)
                span.set_attribute(SemanticConvention.GEN_AI_REQUEST_MODEL,
                                    request_model)
                span.set_attribute(SemanticConvention.SERVER_PORT,
                                    server_port)
                span.set_attribute(SemanticConvention.GEN_AI_REQUEST_SEED,
                                    kwargs.get("seed", ""))
                span.set_attribute(SemanticConvention.GEN_AI_REQUEST_MAX_TOKENS,
                                    kwargs.get("max_tokens", -1))
                span.set_attribute(SemanticConvention.GEN_AI_REQUEST_STOP_SEQUENCES,
                                    kwargs.get("stop", []))
                span.set_attribute(SemanticConvention.GEN_AI_REQUEST_PRESENCE_PENALTY,
                                    kwargs.get("presence_penalty", 0.0))
                span.set_attribute(SemanticConvention.GEN_AI_REQUEST_TEMPERATURE,
                                    kwargs.get("temperature", 0.4))
                span.set_attribute(SemanticConvention.GEN_AI_REQUEST_TOP_K,
                                    kwargs.get("top_k", 1.0))
                span.set_attribute(SemanticConvention.GEN_AI_REQUEST_TOP_P,
                                    kwargs.get("top_p", 1.0))
                span.set_attribute(SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON,
                                    [response.responses[0].finish_reason])
                span.set_attribute(SemanticConvention.GEN_AI_RESPONSE_ID,
                                    response.id)
                span.set_attribute(SemanticConvention.GEN_AI_RESPONSE_MODEL,
                                    response.model)
                span.set_attribute(SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS,
                                    input_tokens)
                span.set_attribute(SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS,
                                    output_tokens)
                span.set_attribute(SemanticConvention.SERVER_ADDRESS,
                                    server_address)
                span.set_attribute(SemanticConvention.GEN_AI_OUTPUT_TYPE,
                                    'text')

                # Set Span attributes (Extra)
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
                            SemanticConvention.GEN_AI_CONTENT_COMPLETION: response.responses[0].message.content,
                        },
                    )

                span.set_status(Status(StatusCode.OK))

                if disable_metrics is False:
                    attributes = create_metrics_attributes(
                        service_name=application_name,
                        deployment_environment=environment,
                        operation=SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
                        system=SemanticConvention.GEN_AI_SYSTEM_REKAAI,
                        request_model=request_model,
                        server_address=server_address,
                        server_port=server_port,
                        response_model=response.model,
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
