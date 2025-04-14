"""
Module for monitoring vLLM API calls.
"""

import logging
import time
from opentelemetry.trace import SpanKind, Status, StatusCode
from opentelemetry.sdk.resources import SERVICE_NAME, TELEMETRY_SDK_NAME, DEPLOYMENT_ENVIRONMENT
from openlit.__helpers import (
    get_chat_model_cost,
    handle_exception,
    general_tokens,
    create_metrics_attributes,
    set_server_address_and_port
)
from openlit.semcov import SemanticConvention

# Initialize logger for logging potential issues and operations
logger = logging.getLogger(__name__)

def generate(version, environment, application_name,
                     tracer, pricing_info, capture_message_content, metrics, disable_metrics):
    """
    Generates a telemetry wrapper for generate to collect metrics.

    Args:
        version: Version of the monitoring package.
        environment: Deployment environment (e.g., production, staging).
        application_name: Name of the application using the vLLM API.
        tracer: OpenTelemetry tracer for creating spans.
        pricing_info: Information used for calculating the cost of vLLM usage.
        capture_message_content: Flag indicating whether to trace the actual content.

    Returns:
        A function that wraps the generate method to add telemetry.
    """

    def wrapper(wrapped, instance, args, kwargs):
        """
        Wraps the 'generate' API call to add telemetry.
        
        This collects metrics such as execution time, cost, and token usage, and handles errors
        gracefully, adding details to the trace for observability.

        Args:
            wrapped: The original 'generate' method to be wrapped.
            instance: The instance of the class where the original method is defined.
            args: Positional arguments for the 'generate' method.
            kwargs: Keyword arguments for the 'generate' method.

        Returns:
            The response from the original 'generate' method.
        """

        server_address, server_port = set_server_address_and_port(instance, "api.cohere.com", 443)
        request_model = instance.llm_engine.model_config.model or "facebook/opt-125m"

        span_name = f"{SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT} {request_model}"

        # pylint: disable=line-too-long
        with tracer.start_as_current_span(span_name, kind= SpanKind.CLIENT) as span:
            start_time = time.time()
            response = wrapped(*args, **kwargs)
            end_time = time.time()

            try:
                # Set base span attribues
                span.set_attribute(TELEMETRY_SDK_NAME, "openlit")
                span.set_attribute(SemanticConvention.GEN_AI_SYSTEM,
                                    SemanticConvention.GEN_AI_SYSTEM_VLLM)
                span.set_attribute(SemanticConvention.GEN_AI_OPERATION,
                                    SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT)
                span.set_attribute(SemanticConvention.SERVER_PORT,
                                    server_port)
                span.set_attribute(SemanticConvention.GEN_AI_REQUEST_MODEL,
                                    request_model)
                span.set_attribute(SemanticConvention.GEN_AI_RESPONSE_MODEL,
                                    request_model)
                span.set_attribute(SemanticConvention.SERVER_ADDRESS,
                                    server_address)
                span.set_attribute(SemanticConvention.GEN_AI_OUTPUT_TYPE,
                                    "text")

                # Set base span attribues (Extras)
                span.set_attribute(DEPLOYMENT_ENVIRONMENT,
                                     environment)
                span.set_attribute(SERVICE_NAME,
                                    application_name)
                span.set_attribute(SemanticConvention.GEN_AI_REQUEST_IS_STREAM,
                                    False)
                span.set_attribute(SemanticConvention.GEN_AI_SERVER_TTFT,
                                    end_time - start_time)
                span.set_attribute(SemanticConvention.GEN_AI_SDK_VERSION,
                                    version)

                input_tokens = 0
                output_tokens = 0
                cost = 0

                if capture_message_content:
                    prompt_attributes = {}
                    completion_attributes = {}

                    for i, output in enumerate(response):
                        prompt_attributes[f"{SemanticConvention.GEN_AI_CONTENT_PROMPT}.{i}"] = output.prompt
                        completion_attributes[f"{SemanticConvention.GEN_AI_CONTENT_COMPLETION}.{i}"] = output.outputs[0].text
                        input_tokens += general_tokens(output.prompt)
                        output_tokens += general_tokens(output.outputs[0].text)

                    # Add a single event for all prompts
                    span.add_event(
                        name=SemanticConvention.GEN_AI_CONTENT_PROMPT_EVENT,
                        attributes=prompt_attributes,
                    )

                    # Add a single event for all completions
                    span.add_event(
                        name=SemanticConvention.GEN_AI_CONTENT_COMPLETION_EVENT,
                        attributes=completion_attributes,
                    )

                span.set_attribute(SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS,
                                    input_tokens)
                span.set_attribute(SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS,
                                    output_tokens)
                span.set_attribute(SemanticConvention.GEN_AI_USAGE_TOTAL_TOKENS,
                                    input_tokens + output_tokens)

                # Calculate cost of the operation
                cost = get_chat_model_cost(request_model, pricing_info,
                                            input_tokens, output_tokens)
                span.set_attribute(SemanticConvention.GEN_AI_USAGE_COST,
                                    cost)

                span.set_status(Status(StatusCode.OK))

                if disable_metrics is False:
                    attributes = create_metrics_attributes(
                        service_name=application_name,
                        deployment_environment=environment,
                        operation=SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
                        system=SemanticConvention.GEN_AI_SYSTEM_VLLM,
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
