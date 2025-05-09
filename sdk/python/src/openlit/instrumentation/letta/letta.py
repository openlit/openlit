# pylint: disable=duplicate-code, broad-exception-caught, too-many-statements, unused-argument, too-many-branches
"""
Module for monitoring Letta calls.
"""

import logging
from opentelemetry.trace import SpanKind, Status, StatusCode
from opentelemetry.sdk.resources import SERVICE_NAME, TELEMETRY_SDK_NAME, DEPLOYMENT_ENVIRONMENT
from openlit.__helpers import (
    handle_exception, get_chat_model_cost
)
from openlit.semcov import SemanticConvention

# Initialize logger for logging potential issues and operations
logger = logging.getLogger(__name__)

def create_agent(gen_ai_endpoint, version, environment, application_name,
                     tracer, pricing_info, capture_message_content, metrics, disable_metrics):
    """
    Generates a telemetry wrapper for chat completions to collect metrics.

    Args:
        gen_ai_endpoint: Endpoint identifier for logging and tracing.
        version: Version of the monitoring package.
        environment: Deployment environment (e.g., production, staging).
        application_name: Name of the application using the Letta Agent.
        tracer: OpenTelemetry tracer for creating spans.
        pricing_info: Information used for calculating the cost of Letta usage.
        capture_message_content: Flag indicating whether to trace the actual content.

    Returns:
        A function that wraps the chat completions method to add telemetry.
    """

    def wrapper(wrapped, instance, args, kwargs):
        """
        Wraps the API call to add telemetry.

        This collects metrics such as execution time, cost, and token usage, and handles errors
        gracefully, adding details to the trace for observability.

        Args:
            wrapped: The original method to be wrapped.
            instance: The instance of the class where the original method is defined.
            args: Positional arguments for the method.
            kwargs: Keyword arguments for the method.

        Returns:
            The response from the original method.
        """

        # pylint: disable=line-too-long
        with tracer.start_as_current_span(gen_ai_endpoint, kind= SpanKind.CLIENT) as span:
            response = wrapped(*args, **kwargs)

            try:
                # Set base span attribues
                span.set_attribute(TELEMETRY_SDK_NAME, "openlit")
                span.set_attribute(SemanticConvention.GEN_AI_SYSTEM,
                                    SemanticConvention.GEN_AI_SYSTEM_LETTA)
                span.set_attribute(SemanticConvention.GEN_AI_OPERATION,
                                    SemanticConvention.GEN_AI_OPERATION_TYPE_AGENT)
                span.set_attribute(SemanticConvention.GEN_AI_ENDPOINT,
                                    gen_ai_endpoint)
                span.set_attribute(SERVICE_NAME,
                                    application_name)
                span.set_attribute(DEPLOYMENT_ENVIRONMENT,
                                    environment)
                span.set_attribute(SemanticConvention.GEN_AI_AGENT_ID,
                                    response.id)
                span.set_attribute(SemanticConvention.GEN_AI_AGENT_ROLE,
                                    response.name)
                span.set_attribute(SemanticConvention.GEN_AI_AGENT_INSTRUCTIONS,
                                    response.system)
                span.set_attribute(SemanticConvention.GEN_AI_REQUEST_MODEL,
                                    response.llm_config.model)
                span.set_attribute(SemanticConvention.GEN_AI_AGENT_TYPE,
                                    response.agent_type)
                span.set_attribute(SemanticConvention.GEN_AI_AGENT_TOOLS,
                                    response.tool_names)

                span.set_status(Status(StatusCode.OK))

                # Return original response
                return response

            except Exception as e:
                handle_exception(span, e)
                logger.error("Error in trace creation: %s", e)

                # Return original response
                return response

    return wrapper

def send_message(gen_ai_endpoint, version, environment, application_name,
                     tracer, pricing_info, capture_message_content, metrics, disable_metrics):
    """
    Generates a telemetry wrapper for chat completions to collect metrics.

    Args:
        gen_ai_endpoint: Endpoint identifier for logging and tracing.
        version: Version of the monitoring package.
        environment: Deployment environment (e.g., production, staging).
        application_name: Name of the application using the Letta Agent.
        tracer: OpenTelemetry tracer for creating spans.
        pricing_info: Information used for calculating the cost of Letta usage.
        capture_message_content: Flag indicating whether to trace the actual content.

    Returns:
        A function that wraps the chat completions method to add telemetry.
    """

    def wrapper(wrapped, instance, args, kwargs):
        """
        Wraps the API call to add telemetry.

        This collects metrics such as execution time, cost, and token usage, and handles errors
        gracefully, adding details to the trace for observability.

        Args:
            wrapped: The original method to be wrapped.
            instance: The instance of the class where the original method is defined.
            args: Positional arguments for the method.
            kwargs: Keyword arguments for the method.

        Returns:
            The response from the original method.
        """

        # pylint: disable=line-too-long
        with tracer.start_as_current_span(gen_ai_endpoint, kind= SpanKind.CLIENT) as span:
            response = wrapped(*args, **kwargs)

            try:
                # Calculate cost of the operation
                cost = get_chat_model_cost(kwargs.get("model", "gpt-4o"),
                                            pricing_info, response.usage.prompt_tokens,
                                            response.usage.completion_tokens)
                # Set base span attribues
                span.set_attribute(TELEMETRY_SDK_NAME, "openlit")
                span.set_attribute(SemanticConvention.GEN_AI_SYSTEM,
                                    SemanticConvention.GEN_AI_SYSTEM_LETTA)
                span.set_attribute(SemanticConvention.GEN_AI_OPERATION,
                                    SemanticConvention.GEN_AI_OPERATION_TYPE_AGENT)
                span.set_attribute(SemanticConvention.GEN_AI_ENDPOINT,
                                    gen_ai_endpoint)
                span.set_attribute(SERVICE_NAME,
                                    application_name)
                span.set_attribute(SemanticConvention.GEN_AI_AGENT_STEP_COUNT,
                                    response.usage.step_count)
                span.set_attribute(SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS,
                                    response.usage.prompt_tokens)
                span.set_attribute(SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS,
                                    response.usage.completion_tokens)
                span.set_attribute(SemanticConvention.GEN_AI_USAGE_TOTAL_TOKENS,
                                    response.usage.total_tokens)
                span.set_attribute(SemanticConvention.GEN_AI_USAGE_COST,
                                    cost)

                if capture_message_content:
                    span.add_event(
                        name=SemanticConvention.GEN_AI_CONTENT_PROMPT_EVENT,
                        attributes={
                            SemanticConvention.GEN_AI_CONTENT_PROMPT: kwargs.get("message", ""),
                        },
                    )
                    span.add_event(
                        name=SemanticConvention.GEN_AI_CONTENT_COMPLETION_EVENT,
                        # pylint: disable=line-too-long
                        attributes={
                            SemanticConvention.GEN_AI_CONTENT_COMPLETION: str(response.messages),
                        },
                    )

                span.set_status(Status(StatusCode.OK))

                # Return original response
                return response

            except Exception as e:
                handle_exception(span, e)
                logger.error("Error in trace creation: %s", e)

                # Return original response
                return response

    return wrapper
