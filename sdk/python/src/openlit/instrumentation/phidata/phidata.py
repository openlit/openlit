# pylint: disable=duplicate-code, broad-exception-caught, too-many-statements, unused-argument
"""
Module for monitoring Phidata calls.
"""

import logging
from opentelemetry.trace import SpanKind, Status, StatusCode
from opentelemetry.sdk.resources import SERVICE_NAME, TELEMETRY_SDK_NAME, DEPLOYMENT_ENVIRONMENT
from openlit.__helpers import (
    handle_exception,
)
from openlit.semcov import SemanticConvention

# Initialize logger for logging potential issues and operations
logger = logging.getLogger(__name__)

def phidata_wrap(gen_ai_endpoint, version, environment, application_name,
                     tracer, pricing_info, capture_message_content, metrics, disable_metrics):
    """
    Generates a telemetry wrapper for chat completions to collect metrics.

    Args:
        gen_ai_endpoint: Endpoint identifier for logging and tracing.
        version: Version of the monitoring package.
        environment: Deployment environment (e.g., production, staging).
        application_name: Name of the application using the Phidata Agent.
        tracer: OpenTelemetry tracer for creating spans.
        pricing_info: Information used for calculating the cost of Phidata usage.
        capture_message_content: Flag indicating whether to trace the actual content.

    Returns:
        A function that wraps the chat completions method to add telemetry.
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

        # pylint: disable=line-too-long
        with tracer.start_as_current_span(gen_ai_endpoint, kind= SpanKind.CLIENT) as span:
            response = wrapped(*args, **kwargs)

            try:
                # Set base span attribues
                span.set_attribute(TELEMETRY_SDK_NAME, "openlit")
                span.set_attribute(SemanticConvention.GEN_AI_SYSTEM,
                                    SemanticConvention.GEN_AI_SYSTEM_PHIDATA)
                span.set_attribute(SemanticConvention.GEN_AI_OPERATION,
                                    SemanticConvention.GEN_AI_OPERATION_TYPE_AGENT)
                span.set_attribute(SemanticConvention.GEN_AI_ENDPOINT,
                                    gen_ai_endpoint)
                span.set_attribute(SERVICE_NAME,
                                    application_name)
                span.set_attribute(DEPLOYMENT_ENVIRONMENT,
                                    environment)
                span.set_attribute(SemanticConvention.GEN_AI_AGENT_ID,
                                    getattr(instance, 'agent_id', '') or '')
                span.set_attribute(SemanticConvention.GEN_AI_AGENT_ROLE,
                                    getattr(instance, 'name', '') or '')
                span.set_attribute(SemanticConvention.GEN_AI_REQUEST_MODEL,
                                    getattr(getattr(instance, 'model', None), 'id', '') or '')
                span.set_attribute(SemanticConvention.GEN_AI_AGENT_TOOLS,
                                    str(getattr(instance, 'tools', '')) or '')
                span.set_attribute(SemanticConvention.GEN_AI_AGENT_CONTEXT,
                                    str(getattr(instance, 'knowledge', '')) or '')
                span.set_attribute(SemanticConvention.GEN_AI_AGENT_TASK,
                                    str(getattr(instance, 'task', '')) or '')
                span.set_attribute(SemanticConvention.GEN_AI_AGENT_INSTRUCTIONS,
                                    str(getattr(instance, 'instructions', '')) or '')
                span.set_attribute(SemanticConvention.GEN_AI_AGENT_STORAGE,
                                    str(getattr(instance, 'storage', '')) or '')
                span.set_attribute(SemanticConvention.GEN_AI_AGENT_ENABLE_HISTORY,
                                    str(getattr(instance, 'add_history_to_messages', '')) or '')

                span.set_status(Status(StatusCode.OK))

                # Return original response
                return response

            except Exception as e:
                handle_exception(span, e)
                logger.error("Error in trace creation: %s", e)

                # Return original response
                return response

    return wrapper
